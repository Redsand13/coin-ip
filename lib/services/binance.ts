/**
 * Binance Futures Market — Triple EMA (7 / 25 / 99) Strategy
 * ─────────────────────────────────────────────────────────────
 * BUY  : EMA7 > EMA25 > EMA99
 * SELL : EMA99 > EMA25 > EMA7
 *
 * Data source : Binance Futures public REST API (fapi.binance.com)
 *
 * Rate-limit strategy (Futures quota: 2400 weight/min = 40/sec):
 *   • Ticker     : 1 REST call, weight=40, cached 4 min
 *   • Klines     : limit=500 → weight=2 each, batched 10/800ms = 25/sec ✓
 *                  Per-symbol TTL cache → 0 REST calls between candle closes
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

async function fapiFetch(path: string): Promise<Response> {
  const res = await fetch(`${FAPI}${path}`, { cache: "no-store" });
  if (res.status === 418 || res.status === 429) throw new Error(`Rate limited (${res.status})`);
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

// Per-symbol kline cache; TTL ≈ interval duration so we refetch at most once per closed candle
const klinesCache = new Map<string, { data: BinanceKline[]; ts: number }>();
const KLINE_TTL: Record<string, number> = {
  "5m":  4   * 60_000,
  "15m": 14  * 60_000,
  "30m": 29  * 60_000,
  "1h":  59  * 60_000,
  "4h":  239 * 60_000,
  "1d":  23  * 60 * 60_000,
};

const SIGNALS_CACHE_MS = 25_000; // 25s cache — shorter than the 30s client poll so every cycle gets fresh data
const TICKER_CACHE_MS  = 4 * 60_000;

// Exact candle duration in ms — used to compute crossover close time from candlesAgo
const INTERVAL_MS: Record<string, number> = {
  "5m":  5   * 60_000,
  "15m": 15  * 60_000,
  "30m": 30  * 60_000,
  "1h":  60  * 60_000,
  "4h":  4   * 60 * 60_000,
  "1d":  24  * 60 * 60_000,
};

// ─── Alignment detector ───────────────────────────────────────────────────────
/**
 * Walks backwards while the full EMA7>EMA25>EMA99 (or reverse) alignment holds
 * continuously. Returns the index of the FIRST candle of the unbroken run.
 *
 * If the run started more than maxLookback candles ago the signal is stale
 * (alignment has been running for a long time → not a fresh crossover).
 */
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

// ─── Main function ────────────────────────────────────────────────────────────
export async function getBinanceFuturesSignals(timeframe = "1h"): Promise<MASignal[]> {
  try {
    const now = Date.now();

    const cached = signalsCache.get(timeframe);
    if (cached && now - cached.ts < SIGNALS_CACHE_MS) {
      console.log(`⚡ [BF] Cached signals for ${timeframe}`);
      return cached.data;
    }

    try { await fetchTopCoins(); } catch { /* metadata best-effort */ }

    const intervalMap: Record<string, string> = {
      "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "1d": "1d",
    };
    const interval = intervalMap[timeframe] ?? "1h";
    // Per-timeframe lookback — enough to surface signals on every timeframe
    const LOOKBACK: Record<string, number> = {
      "5m": 5, "15m": 5, "30m": 5, "1h": 5, "4h": 5, "1d": 5,
    };
    const lookback = LOOKBACK[timeframe] ?? 5;

    // ── Ticker ─────────────────────────────────────────────────────────────
    if (!tickerCache || now - tickerCache.ts > TICKER_CACHE_MS) {
      const res = await fapiFetch("/ticker/24hr");
      tickerCache = { data: await res.json(), ts: now };
    }

    const topPairs = (tickerCache.data as BinanceTicker[])
      .filter(t =>
        t.symbol.endsWith("USDT") &&
        !STABLECOIN_SYMBOLS.has(t.symbol) &&
        parseFloat(t.quoteVolume) > 5_000_000, // lowered to $5M to capture more pairs
      )
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 300); // up from 150 → 300 pairs

    console.log(`🚀 [BF] Scanning ${topPairs.length} Binance Futures pairs on ${timeframe}...`);

    // ── PHASE 1: Klines + EMA for ALL pairs ────────────────────────────────
    // Batched 10/800ms → 25 weight/sec (limit=500 costs 2 weight each)
    // Per-symbol cache means 0 REST calls on re-scans within the same candle period.

    type Candidate = {
      pair: BinanceTicker;
      closes: number[];
      openTimes: number[];
      alignment: ReturnType<typeof detectTripleEMAAlignment>;
      ema7Arr: number[];
      ema25Arr: number[];
      ema99Arr: number[];
    };

    const candidates: Candidate[] = [];
    const BATCH = 10;

    for (let i = 0; i < topPairs.length; i += BATCH) {
      const batch = topPairs.slice(i, i + BATCH);
      let anyFetched = false; // track whether this batch made real API calls

      const batchResults = await Promise.all(batch.map(async (pair): Promise<Candidate | null> => {
        try {
          const klineKey = `${pair.symbol}:${interval}`;
          const klineTTL = KLINE_TTL[timeframe] ?? 4 * 60_000;
          let closedKlines: BinanceKline[];

          const hit = klinesCache.get(klineKey);
          if (hit && now - hit.ts < klineTTL) {
            closedKlines = hit.data; // cache hit — no API call
          } else {
            anyFetched = true; // real API call — need rate-limit delay after batch
            const res = await fapiFetch(`/klines?symbol=${pair.symbol}&interval=${interval}&limit=500`);
            const raw: BinanceKline[] = await res.json();
            closedKlines = raw.slice(0, -1); // strip open/in-progress candle
            klinesCache.set(klineKey, { data: closedKlines, ts: now });
          }

          if (closedKlines.length < 200) return null;

          const closes    = closedKlines.map(k => parseFloat(k[4]));
          const openTimes = closedKlines.map(k => k[0]);
          const ema7Arr   = calculateEMAArray(closes, 7);
          const ema25Arr  = calculateEMAArray(closes, 25);
          const ema99Arr  = calculateEMAArray(closes, 99);
          if (ema99Arr.length < 100) return null;

          const alignment = detectTripleEMAAlignment(ema7Arr, ema25Arr, ema99Arr, lookback);
          if (!alignment.type) return null;

          return { pair, closes, openTimes, alignment, ema7Arr, ema25Arr, ema99Arr };
        } catch { return null; }
      }));

      for (const r of batchResults) if (r) candidates.push(r);

      // Only throttle when real API calls were made — cached batches run instantly
      if (i + BATCH < topPairs.length && anyFetched) {
        await new Promise(r => setTimeout(r, 800)); // 10 req / 800ms = 25 weight/sec ✓
      }
    }

    console.log(`🎯 [BF] ${candidates.length} aligned pairs found — enriching with daily data...`);

    // ── PHASE 2: Enrich ONLY aligned pairs (daily klines via Spot API) ─────
    // Spot API has its own rate-limit pool — zero impact on Futures quota.
    // Typically 0-10 aligned pairs per scan → negligible requests.

    const validSignals: MASignal[] = [];

    for (const { pair, closes, openTimes, alignment, ema7Arr, ema25Arr, ema99Arr } of candidates) {
      try {
        const ema7Val  = ema7Arr[ema7Arr.length - 1];
        const ema25Val = ema25Arr[ema25Arr.length - 1];
        const ema99Val = ema99Arr[ema99Arr.length - 1];
        const currentPrice = parseFloat(pair.lastPrice);
        const change24h    = parseFloat(pair.priceChangePercent);
        const quoteVol     = parseFloat(pair.quoteVolume);

        // Signal name
        const freshText  = alignment.candlesAgo === 0 ? "(FRESH!)" : `(${alignment.candlesAgo} candle${alignment.candlesAgo > 1 ? "s" : ""} ago)`;
        const signalName = alignment.type === "BUY"
          ? `🔥 Bull Align 7>25>99 ${freshText}`
          : `🔥 Bear Align 99>25>7 ${freshText}`;

        // Score
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
        if (score < 70) continue;

        // Trade levels
        const crossoverPrice = closes[alignment.index] ?? currentPrice;
        const stopLoss   = alignment.type === "BUY"  ? crossoverPrice * 0.95 : crossoverPrice * 1.05;
        const takeProfit = alignment.type === "BUY"  ? crossoverPrice * 1.10 : crossoverPrice * 0.90;

        // 1h-equivalent change
        let change1h = 0;
        const prevClose = closes[closes.length - 2];
        if      (timeframe === "5m"  && closes.length > 12) change1h = ((currentPrice - closes[closes.length - 13]) / closes[closes.length - 13]) * 100;
        else if (timeframe === "15m" && closes.length > 4)  change1h = ((currentPrice - closes[closes.length - 5])  / closes[closes.length - 5])  * 100;
        else if (timeframe === "30m" && closes.length > 2)  change1h = ((currentPrice - closes[closes.length - 3])  / closes[closes.length - 3])  * 100;
        else if (closes.length > 1)                         change1h = ((currentPrice - prevClose) / prevClose) * 100;

        // Daily volatility via Spot API (separate rate-limit pool)
        const dailyData = await fetchBinanceKlines(pair.symbol, "1d");
        const volMetric = calculateVolatilityScore(dailyData, currentPrice, quoteVol, change24h);

        // For 1d timeframe: find the exact hour within the crossover day when the daily
        // EMAs would have crossed by simulating EMA values against each 1H candle close.
        // For other timeframes: the kline open time is already precise enough.
        let crossoverTimestamp = openTimes[alignment.index] ?? (Date.now() - (alignment.candlesAgo + 1) * (INTERVAL_MS[timeframe] ?? 60_000));

        if (timeframe === "1d" && alignment.index > 0) {
          try {
            const dayOpen = openTimes[alignment.index];
            const dayEnd  = dayOpen + 24 * 60 * 60_000;
            const res = await fapiFetch(`/klines?symbol=${pair.symbol}&interval=1h&startTime=${dayOpen}&endTime=${dayEnd}&limit=24`);
            const hourlyKlines: BinanceKline[] = await res.json();

            const ema7Prev  = ema7Arr[alignment.index - 1];
            const ema25Prev = ema25Arr[alignment.index - 1];
            const ema99Prev = ema99Arr[alignment.index - 1];
            const a7  = 2 / (7  + 1);
            const a25 = 2 / (25 + 1);
            const a99 = 2 / (99 + 1);

            for (const hk of hourlyKlines) {
              const p   = parseFloat(hk[4]);
              const e7  = ema7Prev  * (1 - a7)  + p * a7;
              const e25 = ema25Prev * (1 - a25) + p * a25;
              const e99 = ema99Prev * (1 - a99) + p * a99;
              const aligned = alignment.type === "BUY" ? (e7 > e25 && e25 > e99) : (e99 > e25 && e25 > e7);
              if (aligned) { crossoverTimestamp = hk[0]; break; }
            }
          } catch { /* keep daily open time as fallback */ }
        }

        // Coin metadata
        const rawSymbol  = pair.symbol.replace("USDT", "");
        const hardcoded  = BINANCE_TO_COINGECKO[pair.symbol];
        const dynamic    = findCoinMetadata(rawSymbol);
        const finalName  = dynamic?.name ?? (hardcoded?.id
          ? hardcoded.id.split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
          : rawSymbol);
        const finalImage = dynamic?.image ?? hardcoded?.image ?? "";

        validSignals.push({
          coinId: pair.symbol, symbol: rawSymbol, name: finalName, image: finalImage,
          signalType: alignment.type, signalName, timeframe, score,
          price: crossoverPrice, currentPrice, change1h, change24h,
          change7d: 0, volume24h: quoteVol, marketCap: 0,
          timestamp: now, crossoverTimestamp,
          candlesAgo: alignment.candlesAgo,
          entryPrice: crossoverPrice, stopLoss, takeProfit,
          volatility: volMetric.score, volatilityTooltip: volMetric.tooltip,
          formula: `EMA7=${ema7Val.toFixed(4)} | EMA25=${ema25Val.toFixed(4)} | EMA99=${ema99Val.toFixed(4)} | Binance Futures`,
          ema7: ema7Val, ema25: ema25Val, ema99: ema99Val,
          ema7Prev: ema7Arr[ema7Arr.length - 2] ?? 0,
          ema99Prev: ema99Arr[ema99Arr.length - 2] ?? 0,
          crossoverStrength,
        } as MASignal);
      } catch { /* skip this candidate */ }
    }

    validSignals.sort((a, b) => b.crossoverTimestamp - a.crossoverTimestamp);

    console.log(`✅ [BF] ${validSignals.length} signals — BUY: ${validSignals.filter(s => s.signalType === "BUY").length} SELL: ${validSignals.filter(s => s.signalType === "SELL").length}`);

    signalsCache.set(timeframe, { data: validSignals, ts: now });
    return validSignals;
  } catch (error) {
    console.error("❌ [BF] Error:", error);
    return [];
  }
}
