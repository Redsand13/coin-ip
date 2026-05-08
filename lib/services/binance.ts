/**
 * Binance Futures Market — Triple EMA (7 / 25 / 99) Strategy
 * ─────────────────────────────────────────────────────────────
 * BUY  : EMA7 > EMA25 > EMA99
 * SELL : EMA99 > EMA25 > EMA7
 *
 * Data source : Binance Futures public REST API (fapi.binance.com)
 *              + WebSocket real-time klines (after first scan seeds them)
 *
 * Rate-limit strategy (Futures quota: 2400 weight/min = 40/sec):
 *   • Ticker     : WS !ticker@arr (real-time) → REST fallback cached 4 min
 *   • Klines     : WS buffer (real-time, 0 REST calls once seeded)
 *                  → REST fallback: limit=500, weight=2, batched 10/800ms
 *   • Daily data : Binance SPOT API (separate pool) — only for signal pairs
 *
 * Two-phase scan:
 *   Phase 1 — klines + EMA for ALL 300 pairs → find aligned pairs (typically 0-10)
 *   Phase 2 — daily enrichment ONLY for aligned pairs → no wasted requests
 */

import {
  MASignal,
  calculateEMAArray,
  calculateVolatilityScore,
  fetchBinanceKlines,
  BINANCE_TO_COINGECKO,
  findCoinMetadata,
  fetchTopCoins,
} from "./coingecko";

const FAPI = "https://fapi.binance.com/fapi/v1";

const STABLECOIN_SYMBOLS = new Set([
  "USDCUSDT", "BUSDUSDT", "TUSDUSDT", "USDPUSDT", "FRAXUSDT", "DAIUSDT",
  "EURUSDT", "GBPUSDT", "AUDUSDT", "USDTUSDT", "FDUSDUSDT", "PYUSDUSD",
]);

// Tracks the last time we were rate-limited so all subsequent calls back off.
let _rlUntil = 0;

async function fapiFetch(path: string, _retry = 0): Promise<Response> {
  // Honour an active backoff window before sending anything
  const now = Date.now();
  if (_rlUntil > now) await new Promise(r => setTimeout(r, _rlUntil - now));

  const res = await fetch(`${FAPI}${path}`, { cache: "no-store" });

  if (res.status === 429) {
    // Soft rate-limit — back off 10 s and retry once
    const wait = 10_000;
    _rlUntil = Date.now() + wait;
    console.warn(`⚠️ [BF] 429 — backing off ${wait / 1000}s`);
    if (_retry < 1) {
      await new Promise(r => setTimeout(r, wait));
      return fapiFetch(path, _retry + 1);
    }
    throw new Error("Rate limited (429)");
  }
  if (res.status === 418) {
    // IP ban — Binance bans last at least 2 min; back off 120s
    _rlUntil = Date.now() + 120_000;
    console.error("❌ [BF] 418 IP ban — pausing 120s");
    throw new Error("Rate limited (418)");
  }
  if (!res.ok) throw new Error(`Binance API error ${res.status}`);
  return res;
}

type BinanceKline = [number, string, string, string, string, string, number, string, number, string, string, string];

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

// ─── Caches ───────────────────────────────────────────────────────────────────

const signalsCache = new Map<string, { data: MASignal[]; ts: number }>();
let tickerCache: { data: BinanceTicker[]; ts: number } | null = null;
let tickerFetching: Promise<void> | null = null; // deduplicate concurrent ticker REST calls

// Per-symbol REST kline fallback cache (used until WS seeds the symbol)
// Capped at MAX_KLINE_CACHE entries to prevent unbounded memory growth.
const klinesCache = new Map<string, { data: BinanceKline[]; ts: number }>();
const MAX_KLINE_CACHE = 600;
const KLINE_TTL: Record<string, number> = {
  "5m":  4   * 60_000,
  "15m": 14  * 60_000,
  "30m": 29  * 60_000,
  "1h":  59  * 60_000,
  "4h":  239 * 60_000,
  "1d":  23  * 60 * 60_000,
};

// 3 min — covers the ~90s full-cycle scan (6 TFs × 15s each) plus buffer.
// Client polls every 20s and always gets a warm cache hit after the first scan.
const SIGNALS_CACHE_MS = 3 * 60_000;
const TICKER_CACHE_MS  = 4 * 60_000;

const INTERVAL_MS: Record<string, number> = {
  "5m":  5   * 60_000,
  "15m": 15  * 60_000,
  "30m": 30  * 60_000,
  "1h":  60  * 60_000,
  "4h":  4   * 60 * 60_000,
  "1d":  24  * 60 * 60_000,
};

// ─── WS manager (Node.js only) ────────────────────────────────────────────────

type WSManager = {
  isSeeded: (symbol: string, interval: string) => boolean;
  getKlines: (symbol: string, interval: string, limit?: number) => Promise<BinanceKline[]>;
  getAllTickers: () => { s: string; c: string; P: string; q: string }[];
  seedFromData: (symbol: string, interval: string, klines: BinanceKline[]) => void;
};

// Eagerly initialize via dynamic import at module load time (Node.js only).
// By the time the first scan fires (≥10 s after startup) this is always ready.
// Using dynamic import() instead of require() so Next.js bundler handles it correctly.
let _wsm: WSManager | null = null;

if (typeof window === "undefined") {
  import("./binance-ws")
    .then(m => {
      _wsm = m.getBinanceWS() as unknown as WSManager;
      console.log("✅ [BF] WS manager ready");
    })
    .catch(e => console.warn("⚠️ [BF] WS manager unavailable:", e));
}

function getWSManager(): WSManager | null { return _wsm; }

export function isRateLimited(): boolean { return _rlUntil > Date.now(); }
export function getCachedSignals(timeframe: string): MASignal[] | null {
  const cached = signalsCache.get(timeframe);
  return cached ? cached.data : null;
}

// ─── Shared cache accessors for ICT and other scanners ────────────────────────
// Read from the already-populated caches — zero additional REST calls.

export type SharedTicker = { symbol: string; quoteVolume: string; priceChangePercent: string };

/** Klines for a symbol:interval from WS buffer or REST cache — no new API calls. */
export async function getSharedKlines(
  symbol: string,
  interval: string,
  limit = 150,
): Promise<BinanceKline[] | null> {
  const wsm = getWSManager();
  if (wsm?.isSeeded(symbol, interval)) {
    return (await wsm.getKlines(symbol, interval, limit)) as BinanceKline[];
  }
  const hit = klinesCache.get(`${symbol}:${interval}`);
  if (hit) return hit.data.slice(-limit);
  return null;
}

/** Top USDT pairs by volume from the already-cached ticker. */
export function getSharedTopPairs(limit = 50, minVol = 10_000_000): SharedTicker[] {
  if (!tickerCache) return [];
  return (tickerCache.data as BinanceTicker[])
    .filter(t => t.symbol.endsWith("USDT") && !STABLECOIN_SYMBOLS.has(t.symbol) && parseFloat(t.quoteVolume) > minVol)
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, limit);
}

/** True if the ticker cache is fresh enough for ICT to use. */
export function hasFreshBinanceCache(): boolean {
  return !!(tickerCache && Date.now() - tickerCache.ts < TICKER_CACHE_MS);
}

// ─── RSI ─────────────────────────────────────────────────────────────────────

function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) avgGain += delta; else avgLoss -= delta;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const gain  = delta > 0 ? delta : 0;
    const loss  = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ─── ADX ─────────────────────────────────────────────────────────────────────
// Wilder-smoothed ADX (standard 14-period). ADX < 25 → no trend (sideways).

function calculateADX(highs: number[], lows: number[], closes: number[], period = 14): number {
  const len = Math.min(highs.length, lows.length, closes.length);
  if (len < period * 2 + 1) return 0;

  const trs: number[] = [], plusDMs: number[] = [], minusDMs: number[] = [];
  for (let i = 1; i < len; i++) {
    const tr     = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    const upMove = highs[i] - highs[i - 1];
    const dnMove = lows[i - 1] - lows[i];
    trs.push(tr);
    plusDMs.push( upMove > dnMove && upMove > 0 ? upMove : 0);
    minusDMs.push(dnMove > upMove && dnMove > 0 ? dnMove : 0);
  }

  // Seed with first `period` bars
  let smoothTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];
  const addDX = () => {
    const plusDI  = smoothTR > 0 ? (smoothPDM / smoothTR) * 100 : 0;
    const minusDI = smoothTR > 0 ? (smoothMDM / smoothTR) * 100 : 0;
    const sum = plusDI + minusDI;
    dxValues.push(sum > 0 ? (Math.abs(plusDI - minusDI) / sum) * 100 : 0);
  };
  addDX();

  for (let i = period; i < trs.length; i++) {
    smoothTR  = smoothTR  - smoothTR  / period + trs[i];
    smoothPDM = smoothPDM - smoothPDM / period + plusDMs[i];
    smoothMDM = smoothMDM - smoothMDM / period + minusDMs[i];
    addDX();
  }

  if (dxValues.length < period) return 0;
  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period;
  }
  return adx;
}

// ─── Alignment detector ───────────────────────────────────────────────────────

function detectTripleEMAAlignment(
  ema7: number[], ema25: number[], ema99: number[], maxLookback: number,
): { type: "BUY" | "SELL" | null; candlesAgo: number; index: number } {
  const len = Math.min(ema7.length, ema25.length, ema99.length);
  if (len < 100) return { type: null, candlesAgo: -1, index: -1 };

  const e7 = ema7[len - 1], e25 = ema25[len - 1], e99 = ema99[len - 1];
  if (!e7 || !e25 || !e99) return { type: null, candlesAgo: -1, index: -1 };

  const isBull = e7 > e25 && e25 > e99;
  const isBear = e99 > e25 && e25 > e7;
  if (!isBull && !isBear) return { type: null, candlesAgo: -1, index: -1 };

  const type: "BUY" | "SELL" = isBull ? "BUY" : "SELL";

  let crossoverIdx = len - 1;
  for (let i = len - 2; i >= 99; i--) {
    const a7 = ema7[i], a25 = ema25[i], a99 = ema99[i];
    if (!a7 || !a25 || !a99) break;
    const aligned = type === "BUY" ? (a7 > a25 && a25 > a99) : (a99 > a25 && a25 > a7);
    if (aligned) crossoverIdx = i; else break;
  }

  const candlesAgo = len - 1 - crossoverIdx;
  if (candlesAgo > maxLookback) return { type: null, candlesAgo: -1, index: -1 };
  return { type, candlesAgo, index: crossoverIdx };
}

// ─── Kline cache helpers ──────────────────────────────────────────────────────

function setKlineCache(key: string, data: BinanceKline[], ts: number) {
  klinesCache.set(key, { data, ts });
  if (klinesCache.size > MAX_KLINE_CACHE) {
    const oldest = klinesCache.keys().next().value;
    if (oldest) klinesCache.delete(oldest);
  }
}

// ─── Scan deduplication ───────────────────────────────────────────────────────
// Prevents concurrent scans for the same timeframe (background + client + ICT)
// from all firing Binance REST requests simultaneously and hitting 429.

const scanInFlight = new Map<string, Promise<MASignal[]>>();

// ─── Main function ────────────────────────────────────────────────────────────

export function getBinanceFuturesSignals(timeframe = "1h"): Promise<MASignal[]> {
  const now = Date.now();
  const cached = signalsCache.get(timeframe);
  if (cached && now - cached.ts < SIGNALS_CACHE_MS) {
    console.log(`⚡ [BF] Cached signals for ${timeframe}`);
    return Promise.resolve(cached.data);
  }
  // If another scan is already running for this timeframe, share its result
  const inflight = scanInFlight.get(timeframe);
  if (inflight) {
    console.log(`⏳ [BF] Joining in-flight scan for ${timeframe}`);
    return inflight;
  }
  const promise = _scan(timeframe).finally(() => scanInFlight.delete(timeframe));
  scanInFlight.set(timeframe, promise);
  return promise;
}

async function _scan(timeframe: string): Promise<MASignal[]> {
  try {
    const now = Date.now();

    // Fire-and-forget — metadata enriches names/images but must never block a scan
    fetchTopCoins().catch(() => {});

    const intervalMap: Record<string, string> = {
      "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "1d": "1d",
    };
    const interval = intervalMap[timeframe] ?? "1h";
    const LOOKBACK: Record<string, number> = {
      "5m": 5, "15m": 5, "30m": 5, "1h": 5, "4h": 5, "1d": 5,
    };
    const lookback = LOOKBACK[timeframe] ?? 5;

    const wsm = getWSManager();

    // ── Ticker ─────────────────────────────────────────────────────────────
    // Prefer WS real-time ticker (zero REST calls); fall back to REST with dedup.
    const wsTickers = wsm?.getAllTickers() ?? [];
    if (wsTickers.length > 200) {
      // WS ticker has live data — use it and refresh the cache timestamp
      tickerCache = {
        data: wsTickers.map(t => ({
          symbol: t.s,
          lastPrice: t.c,
          priceChangePercent: t.P || "0",
          quoteVolume: t.q,
        })),
        ts: now,
      };
    } else if (!tickerCache || now - tickerCache.ts > TICKER_CACHE_MS) {
      // Deduplicate concurrent REST ticker fetches (e.g. parallel TF scans)
      if (!tickerFetching) {
        tickerFetching = fapiFetch("/ticker/24hr")
          .then(r => r.json())
          .then(data => { tickerCache = { data, ts: Date.now() }; })
          .finally(() => { tickerFetching = null; });
      }
      await tickerFetching;
    }

    const topPairs = (tickerCache!.data as BinanceTicker[])
      .filter(t =>
        t.symbol.endsWith("USDT") &&
        !STABLECOIN_SYMBOLS.has(t.symbol) &&
        parseFloat(t.quoteVolume) > 5_000_000,
      )
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 300);

    console.log(`🚀 [BF] Scanning ${topPairs.length} pairs on ${timeframe}...`);

    // ── PHASE 1: Klines + EMA for ALL pairs ────────────────────────────────
    // WS-seeded pairs return instantly from memory (0 REST calls, always fresh).
    // Non-seeded pairs use REST + cache AND kick off a background WS seed so
    // the next scan will be WS-backed too.

    type Candidate = {
      pair: BinanceTicker;
      closes: number[];
      openTimes: number[];
      alignment: ReturnType<typeof detectTripleEMAAlignment>;
      ema7Arr: number[];
      ema25Arr: number[];
      ema99Arr: number[];
      adx: number;
      rsi: number;
    };

    const candidates: Candidate[] = [];
    const BATCH = 10;
    // Binance Futures REST: 2400 weight/min (40/sec).
    // /klines?limit=1000 costs 10 weight. 10 calls/batch → 100 weight/batch.
    // 3000ms between REST batches → 33 weight/sec, safely under limit.
    const REST_BATCH_DELAY = 3_000;
    // On first startup the WS is unseeded — cap REST calls to avoid blowing the
    // rate limit. WS-seeded pairs are free (served from memory), so we scan all of
    // those regardless. Once the WS warms up (usually after 1-2 scans) this cap
    // has no effect because everything is served from the WS buffer.
    const MAX_REST_PAIRS = 50;

    // Partition: WS-seeded (free) vs needs REST/cache
    const seededPairs: typeof topPairs = [];
    const restPairs:   typeof topPairs = [];
    for (const pair of topPairs) {
      const hit = klinesCache.get(`${pair.symbol}:${interval}`);
      const cacheOk = hit && now - hit.ts < (KLINE_TTL[timeframe] ?? 4 * 60_000);
      if (wsm?.isSeeded(pair.symbol, interval) || cacheOk) {
        seededPairs.push(pair);
      } else {
        if (restPairs.length < MAX_REST_PAIRS) restPairs.push(pair);
      }
    }
    const scanPairs = [...seededPairs, ...restPairs];
    if (restPairs.length > 0) {
      console.log(`📡 [BF] ${seededPairs.length} WS-seeded + ${restPairs.length} REST pairs (cap ${MAX_REST_PAIRS})`);
    }

    for (let i = 0; i < scanPairs.length; i += BATCH) {
      const batch = scanPairs.slice(i, i + BATCH);
      let anyFetched = false;

      const batchResults = await Promise.all(batch.map(async (pair): Promise<Candidate | null> => {
        try {
          const klineKey = `${pair.symbol}:${interval}`;
          const klineTTL = KLINE_TTL[timeframe] ?? 4 * 60_000;
          let closedKlines: BinanceKline[];

          if (wsm?.isSeeded(pair.symbol, interval)) {
            // ✅ Real-time WS data — use full buffer for better EMA warmup
            closedKlines = await wsm.getKlines(pair.symbol, interval, 1000) as BinanceKline[];
          } else {
            // REST fallback cache
            const hit = klinesCache.get(klineKey);
            if (hit && now - hit.ts < klineTTL) {
              closedKlines = hit.data;
            } else {
              anyFetched = true;
              const res = await fapiFetch(`/klines?symbol=${pair.symbol}&interval=${interval}&limit=1000`);
              const raw: BinanceKline[] = await res.json();
              closedKlines = raw.slice(0, -1);
              setKlineCache(klineKey, closedKlines, now);
              // Feed into WS buffer directly — no second REST call needed.
              // From next candle close onward, WS stream keeps it updated.
              wsm?.seedFromData(pair.symbol, interval, closedKlines);
            }
          }

          if (closedKlines.length < 200) return null;

          const closes    = closedKlines.map(k => parseFloat(k[4]));
          const highs     = closedKlines.map(k => parseFloat(k[2]));
          const lows      = closedKlines.map(k => parseFloat(k[3]));
          const openTimes = closedKlines.map(k => k[0]);
          const ema7Arr   = calculateEMAArray(closes, 7);
          const ema25Arr  = calculateEMAArray(closes, 25);
          const ema99Arr  = calculateEMAArray(closes, 99);
          if (ema99Arr.length < 100) return null;

          const alignment = detectTripleEMAAlignment(ema7Arr, ema25Arr, ema99Arr, lookback);
          if (!alignment.type) return null;

          // ADX < 20 = extreme chop — skip only the flattest markets.
          // Threshold kept at 20 (not 25) because EMA crossovers fire at trend onset,
          // before ADX has time to rise. RSI filter removed for the same reason.
          const adx = calculateADX(highs, lows, closes);
          if (adx < 20) return null;

          const rsi = calculateRSI(closes);

          return { pair, closes, openTimes, alignment, ema7Arr, ema25Arr, ema99Arr, adx, rsi };
        } catch { return null; }
      }));

      for (const r of batchResults) if (r) candidates.push(r);

      // Throttle only when REST calls were made — WS/cached batches need no delay
      if (i + BATCH < scanPairs.length && anyFetched) {
        await new Promise(r => setTimeout(r, REST_BATCH_DELAY));
      }
    }

    console.log(`🎯 [BF] ${candidates.length} aligned pairs — enriching...`);

    // ── PHASE 2: Enrich all aligned pairs IN PARALLEL ─────────────────────
    // Each pair needs one Spot API daily-klines call (separate rate-limit pool)
    // and optionally one Futures 1h call for 1d precision.
    // Running them concurrently cuts wait time from N×500ms to ~500ms total.

    const enriched = await Promise.all(
      candidates.map(async ({ pair, closes, openTimes, alignment, ema7Arr, ema25Arr, ema99Arr, adx, rsi }) => {
        try {
          const ema7Val  = ema7Arr[ema7Arr.length - 1];
          const ema25Val = ema25Arr[ema25Arr.length - 1];
          const ema99Val = ema99Arr[ema99Arr.length - 1];
          const currentPrice = parseFloat(pair.lastPrice);
          const change24h    = parseFloat(pair.priceChangePercent);
          const quoteVol     = parseFloat(pair.quoteVolume);

          const freshText  = alignment.candlesAgo === 0 ? "(FRESH!)" : `(${alignment.candlesAgo} candle${alignment.candlesAgo > 1 ? "s" : ""} ago)`;
          const signalName = alignment.type === "BUY"
            ? `🔥 Bull Align 7>25>99 ${freshText}`
            : `🔥 Bear Align 99>25>7 ${freshText}`;

          let score = 70;
          if      (alignment.candlesAgo === 0) score += 15;
          else if (alignment.candlesAgo === 1) score += 10;
          else                                 score += 5;

          if ((alignment.type === "BUY" && change24h > 0) || (alignment.type === "SELL" && change24h < 0)) score += 5;

          const crossoverStrength = Math.abs(ema7Val - ema99Val) / ema99Val * 100;
          if (crossoverStrength > 0.5) score += 2;
          if (crossoverStrength > 1.5) score += 2;
          if (crossoverStrength > 3.0) score += 3;

          if (quoteVol > 100_000_000)   score += 2;
          if (quoteVol > 500_000_000)   score += 3;
          if (quoteVol > 1_000_000_000) score += 3;
          score = Math.min(Math.max(Math.round(score), 0), 100);
          if (score < 70) return null;

          const crossoverPrice = closes[alignment.index] ?? currentPrice;
          const stopLoss   = alignment.type === "BUY"  ? crossoverPrice * 0.95 : crossoverPrice * 1.05;
          const takeProfit = alignment.type === "BUY"  ? crossoverPrice * 1.10 : crossoverPrice * 0.90;

          let change1h = 0;
          if      (timeframe === "5m"  && closes.length > 12) change1h = ((currentPrice - closes[closes.length - 13]) / closes[closes.length - 13]) * 100;
          else if (timeframe === "15m" && closes.length > 4)  change1h = ((currentPrice - closes[closes.length - 5])  / closes[closes.length - 5])  * 100;
          else if (timeframe === "30m" && closes.length > 2)  change1h = ((currentPrice - closes[closes.length - 3])  / closes[closes.length - 3])  * 100;
          else if (timeframe === "1h"  && closes.length > 1)  change1h = ((currentPrice - closes[closes.length - 2])  / closes[closes.length - 2])  * 100;

          // Fetch daily volatility + 1d precision in parallel (both are optional enrichments)
          const [dailyData, crossoverTimestamp] = await Promise.all([
            fetchBinanceKlines(pair.symbol, "1d"),
            (async () => {
              let ts = openTimes[alignment.index] ?? (Date.now() - (alignment.candlesAgo + 1) * (INTERVAL_MS[timeframe] ?? 60_000));
              if (timeframe === "1d" && alignment.index > 0) {
                try {
                  const dayOpen = openTimes[alignment.index];
                  const res = await fapiFetch(`/klines?symbol=${pair.symbol}&interval=1h&startTime=${dayOpen}&endTime=${dayOpen + 86_400_000}&limit=24`);
                  const hourlyKlines: BinanceKline[] = await res.json();
                  const e7p = ema7Arr[alignment.index - 1], e25p = ema25Arr[alignment.index - 1], e99p = ema99Arr[alignment.index - 1];
                  const a7 = 2/8, a25 = 2/26, a99 = 2/100;
                  for (const hk of hourlyKlines) {
                    const p = parseFloat(hk[4]);
                    const e7 = e7p*(1-a7)+p*a7, e25 = e25p*(1-a25)+p*a25, e99 = e99p*(1-a99)+p*a99;
                    if (alignment.type === "BUY" ? (e7>e25&&e25>e99) : (e99>e25&&e25>e7)) { ts = hk[0]; break; }
                  }
                } catch { /* keep daily open time */ }
              }
              return ts;
            })(),
          ]);

          const volMetric = calculateVolatilityScore(dailyData, currentPrice, quoteVol, change24h);

          const rawSymbol  = pair.symbol.replace("USDT", "");
          const hardcoded  = BINANCE_TO_COINGECKO[pair.symbol];
          const dynamic    = findCoinMetadata(rawSymbol);
          const finalName  = dynamic?.name ?? (hardcoded?.id
            ? hardcoded.id.split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
            : rawSymbol);
          const finalImage = dynamic?.image ?? hardcoded?.image ?? "";

          return {
            coinId: pair.symbol, symbol: rawSymbol, name: finalName, image: finalImage,
            signalType: alignment.type, signalName, timeframe, score,
            price: crossoverPrice, currentPrice, change1h, change24h,
            change7d: 0, volume24h: quoteVol, marketCap: 0,
            timestamp: now, crossoverTimestamp,
            candlesAgo: alignment.candlesAgo,
            entryPrice: crossoverPrice, stopLoss, takeProfit,
            volatility: volMetric.score, volatilityTooltip: volMetric.tooltip,
            formula: `EMA7=${ema7Val.toFixed(4)} | EMA25=${ema25Val.toFixed(4)} | EMA99=${ema99Val.toFixed(4)} | RSI=${rsi.toFixed(1)} | ADX=${adx.toFixed(1)} | Binance Futures`,
            ema7: ema7Val, ema25: ema25Val, ema99: ema99Val,
            ema7Prev: ema7Arr[ema7Arr.length - 2] ?? 0,
            ema99Prev: ema99Arr[ema99Arr.length - 2] ?? 0,
            crossoverStrength,
          } as MASignal;
        } catch { return null; }
      })
    );

    const validSignals = enriched.filter((s): s is MASignal => s !== null);

    validSignals.sort((a, b) => b.crossoverTimestamp - a.crossoverTimestamp);

    console.log(`✅ [BF] ${validSignals.length} signals — BUY: ${validSignals.filter(s => s.signalType === "BUY").length} SELL: ${validSignals.filter(s => s.signalType === "SELL").length}`);

    signalsCache.set(timeframe, { data: validSignals, ts: now });
    return validSignals;
  } catch (error) {
    console.error("❌ [BF] Error:", error);
    return [];
  }
}
