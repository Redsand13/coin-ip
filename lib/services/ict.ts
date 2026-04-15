/**
 * ICT / SMC Strategy Scanner — Binance Futures (all timeframes)
 *
 * Strategy flow:
 * 1. Detect market structure (HH+HL = bullish, LH+LL = bearish)
 * 2. Find liquidity levels: equal highs, equal lows, session H/L
 * 3. Detect a liquidity sweep (wick beyond level, closes back inside)
 * 4. Identify an FVG or Order Block near the sweep (the entry Point of Interest)
 * 5. Setup is ACTIVE if price has not yet returned to the entry zone (<= 6 candles)
 * 6. Setup is IN_ZONE if current price is inside the entry zone
 * 7. SL = just beyond the sweep wick; TP = nearest opposing liquidity; min 1.5:1 R:R
 */

import {
  fetchTopCoins,
  findCoinMetadata,
  BINANCE_TO_COINGECKO,
} from "./coingecko";

const BINANCE_FAPI_BASE = "https://fapi.binance.com/fapi/v1";
const CANDLE_COUNT = 120;         // 120 is plenty — sweep lookback is only 10 candles
const SWEEP_LOOKBACK = 10;       // how many recent candles to scan for a sweep
// Max candles since sweep before a setup is discarded — kept small so only fresh signals show.
// Timeframe-aware: longer candles get a tighter window so signals stay within ~30 min max.
const INVALIDATION_BY_TF: Record<string, number> = {
  "5m":  3,   // ≤ 15 min old
  "15m": 2,   // ≤ 30 min old
  "30m": 1,   // ≤ 30 min old
  "1h":  1,   // ≤ 1 hr  old
  "4h":  1,   // ≤ 4 hr  old
  "1d":  1,   // ≤ 1 day old
};
const PIVOT_PERIOD = 3;          // window each side for pivot high/low detection
const EQUAL_THRESHOLD = 0.003;   // 0.3 % — levels this close count as "equal"
const MIN_RR = 1.5;              // minimum acceptable risk:reward

/** Fetch from Binance Futures — respects 418/429 rate limit responses */
async function fapiFetch(path: string): Promise<Response> {
  const url = `${BINANCE_FAPI_BASE}${path}`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 418 || res.status === 429) {
    // IP banned or rate limited
    throw new Error(`Binance rate limited (${res.status}) — backing off`);
  }
  if (!res.ok) throw new Error(`Binance Futures API error ${res.status} for ${path}`);
  return res;
}

/** Candles that equal roughly 24 h on each timeframe (used for session H/L) */
const SESSION_CANDLES: Record<string, number> = {
  "5m":  288,
  "15m":  96,
  "30m":  48,
  "1h":   24,
  "4h":    6,
  "1d":    7,
};

/** Binance interval strings */
const INTERVAL_MAP: Record<string, string> = {
  "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "4h": "4h",  "1d":  "1d",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SwingPoint {
  idx: number;
  price: number;
}

interface LiquidityLevel {
  type: "EQUAL_HIGHS" | "EQUAL_LOWS" | "SESSION_HIGH" | "SESSION_LOW";
  price: number;
}

interface Sweep {
  direction: "BULLISH" | "BEARISH"; // BULLISH = lows swept → expect LONG
  level: number;
  levelType: string;
  candleIdx: number;
  sweepExtreme: number; // lowest low (bullish) or highest high (bearish)
  sweepTimestamp: number;
  candlesSince: number; // 0 = last candle
}

interface Zone {
  high: number;
  low: number;
}

export interface ICTSignal {
  coinId: string;
  symbol: string;
  name: string;
  image: string;
  signalType: "LONG" | "SHORT";
  setupType: "FVG" | "OB" | "FVG+OB";
  marketStructure: "BULLISH" | "BEARISH";
  sweepLevel: number;
  sweepExtreme: number;
  entryZoneHigh: number;
  entryZoneLow: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  currentPrice: number;
  candlesSinceSweep: number;
  priceInZone: boolean;
  status: "ACTIVE" | "IN_ZONE";
  score: number;
  liquidityType: string;
  timeframe: string;
  timestamp: number;
  sweepTimestamp: number;
  volume24h: number;
  change24h: number;
  formula: string;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const ictCache = new Map<string, { data: ICTSignal[]; timestamp: number }>();
const ICT_CACHE_DURATION = 8_000; // 8s — just under the 10s poll interval, guarantees every poll is fresh

// Shared ticker cache — fetched once per 2-min cycle, shared across timeframes
let ictTickerCache: {
  tickers: { symbol: string; quoteVolume: string; priceChangePercent: string }[];
  timestamp: number;
} | null = null;
const ICT_TICKER_CACHE_DURATION = 2 * 60_000; // ticker doesn't change fast — 2 min is fine

// ─── Candle parsing ───────────────────────────────────────────────────────────

type RawKline = [number, string, string, string, string, string, ...unknown[]];

function parseCandles(raw: RawKline[]): Candle[] {
  return raw.map(k => ({
    openTime: k[0],
    closeTime: k[6] as number, // exact candle close time — sweep confirmed at close
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

// ─── Pivot detection ──────────────────────────────────────────────────────────

function findPivotHighs(candles: Candle[], period = PIVOT_PERIOD): SwingPoint[] {
  const result: SwingPoint[] = [];
  for (let i = period; i < candles.length - period; i++) {
    const h = candles[i].high;
    let isPivot = true;
    for (let j = i - period; j <= i + period; j++) {
      if (j !== i && candles[j].high >= h) { isPivot = false; break; }
    }
    if (isPivot) result.push({ idx: i, price: h });
  }
  return result;
}

function findPivotLows(candles: Candle[], period = PIVOT_PERIOD): SwingPoint[] {
  const result: SwingPoint[] = [];
  for (let i = period; i < candles.length - period; i++) {
    const l = candles[i].low;
    let isPivot = true;
    for (let j = i - period; j <= i + period; j++) {
      if (j !== i && candles[j].low <= l) { isPivot = false; break; }
    }
    if (isPivot) result.push({ idx: i, price: l });
  }
  return result;
}

// ─── Market structure ─────────────────────────────────────────────────────────

function detectMarketStructure(
  pivotHighs: SwingPoint[],
  pivotLows: SwingPoint[],
): "BULLISH" | "BEARISH" | "RANGING" {
  if (pivotHighs.length < 2 || pivotLows.length < 2) return "RANGING";

  const lastHighs = pivotHighs.slice(-3);
  const lastLows = pivotLows.slice(-3);

  const higherHighs = lastHighs.every((h, i) => i === 0 || h.price > lastHighs[i - 1].price);
  const higherLows = lastLows.every((l, i) => i === 0 || l.price > lastLows[i - 1].price);
  const lowerHighs = lastHighs.every((h, i) => i === 0 || h.price < lastHighs[i - 1].price);
  const lowerLows = lastLows.every((l, i) => i === 0 || l.price < lastLows[i - 1].price);

  if (higherHighs && higherLows) return "BULLISH";
  if (lowerHighs && lowerLows) return "BEARISH";
  return "RANGING";
}

// ─── Liquidity levels ─────────────────────────────────────────────────────────

function findLiquidityLevels(
  candles: Candle[],
  pivotHighs: SwingPoint[],
  pivotLows: SwingPoint[],
  sessionLen: number,
): LiquidityLevel[] {
  const levels: LiquidityLevel[] = [];

  // Equal highs: two swing highs within EQUAL_THRESHOLD of each other
  for (let i = 0; i < pivotHighs.length; i++) {
    for (let j = i + 1; j < pivotHighs.length; j++) {
      const diff = Math.abs(pivotHighs[i].price - pivotHighs[j].price) / pivotHighs[i].price;
      if (diff < EQUAL_THRESHOLD) {
        const avg = (pivotHighs[i].price + pivotHighs[j].price) / 2;
        const alreadyExists = levels.some(
          l => l.type === "EQUAL_HIGHS" && Math.abs(l.price - avg) / avg < EQUAL_THRESHOLD,
        );
        if (!alreadyExists) levels.push({ type: "EQUAL_HIGHS", price: avg });
      }
    }
  }

  // Equal lows: two swing lows within threshold
  for (let i = 0; i < pivotLows.length; i++) {
    for (let j = i + 1; j < pivotLows.length; j++) {
      const diff = Math.abs(pivotLows[i].price - pivotLows[j].price) / pivotLows[i].price;
      if (diff < EQUAL_THRESHOLD) {
        const avg = (pivotLows[i].price + pivotLows[j].price) / 2;
        const alreadyExists = levels.some(
          l => l.type === "EQUAL_LOWS" && Math.abs(l.price - avg) / avg < EQUAL_THRESHOLD,
        );
        if (!alreadyExists) levels.push({ type: "EQUAL_LOWS", price: avg });
      }
    }
  }

  // Session high/low (timeframe-adjusted lookback)
  const session = candles.slice(-sessionLen);
  const sessionHigh = Math.max(...session.map(c => c.high));
  const sessionLow = Math.min(...session.map(c => c.low));
  levels.push({ type: "SESSION_HIGH", price: sessionHigh });
  levels.push({ type: "SESSION_LOW", price: sessionLow });

  return levels;
}

// ─── Sweep detection ──────────────────────────────────────────────────────────

function detectSweeps(
  candles: Candle[],
  levels: LiquidityLevel[],
  structure: "BULLISH" | "BEARISH",
): Sweep[] {
  const sweeps: Sweep[] = [];
  const totalLen = candles.length;
  const searchStart = Math.max(0, totalLen - SWEEP_LOOKBACK);
  for (let i = searchStart; i < totalLen; i++) { // include live candle — close = current price, low/high already set
    const c = candles[i];
    const isLiveCandle = i === totalLen - 1;
    const candlesSince = isLiveCandle ? 0 : totalLen - 1 - i;
    // Use openTime for live candle — stable for the full candle period so dedup IDs don't change each poll.
    // Use closeTime for closed candles — confirmed sweep.
    const ts = isLiveCandle ? c.openTime : c.closeTime;

    for (const level of levels) {
      if (structure === "BULLISH") {
        // Look for sweeps of lows → LONG setup
        if (level.type === "EQUAL_LOWS" || level.type === "SESSION_LOW") {
          if (c.low < level.price && c.close > level.price) {
            sweeps.push({
              direction: "BULLISH",
              level: level.price,
              levelType: level.type,
              candleIdx: i,
              sweepExtreme: c.low,
              sweepTimestamp: ts,
              candlesSince,
            });
          }
        }
      } else {
        // Look for sweeps of highs → SHORT setup
        if (level.type === "EQUAL_HIGHS" || level.type === "SESSION_HIGH") {
          if (c.high > level.price && c.close < level.price) {
            sweeps.push({
              direction: "BEARISH",
              level: level.price,
              levelType: level.type,
              candleIdx: i,
              sweepExtreme: c.high,
              sweepTimestamp: ts,
              candlesSince,
            });
          }
        }
      }
    }
  }

  return sweeps.sort((a, b) => a.candlesSince - b.candlesSince);
}

// ─── Fair Value Gap ───────────────────────────────────────────────────────────

function findFVG(
  candles: Candle[],
  sweepIdx: number,
  direction: "BULLISH" | "BEARISH",
): Zone | null {
  // Scan a window around the sweep for a 3-candle FVG in the impulse move
  const start = Math.max(0, sweepIdx - 2);
  const end = Math.min(candles.length - 3, sweepIdx + 5);

  for (let i = start; i <= end; i++) {
    const c1 = candles[i];
    const c3 = candles[i + 2];
    if (!c1 || !c3) continue;

    if (direction === "BULLISH" && c1.high < c3.low) {
      // Gap between candle-1 high and candle-3 low = bullish imbalance (entry zone on pullback)
      return { high: c3.low, low: c1.high };
    }
    if (direction === "BEARISH" && c1.low > c3.high) {
      // Gap between candle-1 low and candle-3 high = bearish imbalance
      return { high: c1.low, low: c3.high };
    }
  }
  return null;
}

// ─── Order Block ──────────────────────────────────────────────────────────────

function findOrderBlock(
  candles: Candle[],
  sweepIdx: number,
  direction: "BULLISH" | "BEARISH",
): Zone | null {
  // Search for the last opposing candle right at/before the impulse reversal
  const start = Math.max(0, sweepIdx - 4);

  for (let i = sweepIdx; i >= start; i--) {
    const c = candles[i];
    const next = candles[i + 1];
    if (!c || !next) continue;

    const bodySize = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    const bodyRatio = range > 0 ? bodySize / range : 0;
    if (bodyRatio < 0.25) continue; // ignore doji / weak candles

    if (direction === "BULLISH") {
      // Bullish OB = last bearish candle before the up-impulse after the sweep
      const isBearish = c.close < c.open;
      // Confirmation: next candle closes above the OB body top (open of bearish candle)
      const nextBullish = next.close > c.open * 0.998;
      if (isBearish && nextBullish) {
        // OB zone = body of the bearish candle (open=top, close=bottom — no wick)
        return { high: c.open, low: c.close };
      }
    } else {
      // Bearish OB = last bullish candle before the down-impulse
      const isBullish = c.close > c.open;
      // Confirmation: next candle closes below the OB body bottom (open of bullish candle)
      const nextBearish = next.close < c.open * 1.002;
      if (isBullish && nextBearish) {
        // OB zone = body of the bullish candle (close=top, open=bottom — no wick)
        return { high: c.close, low: c.open };
      }
    }
  }
  return null;
}

// ─── Opposing liquidity target ────────────────────────────────────────────────

function findOpposingLiquidity(
  candles: Candle[],
  pivotHighs: SwingPoint[],
  pivotLows: SwingPoint[],
  direction: "BULLISH" | "BEARISH",
  currentPrice: number,
  sessionLen: number,
): number {
  if (direction === "BULLISH") {
    // TP = nearest swing high ABOVE current price
    const aboveHighs = pivotHighs.filter(h => h.price > currentPrice * 1.004);
    if (aboveHighs.length > 0) return Math.min(...aboveHighs.map(h => h.price));
    return Math.max(...candles.slice(-sessionLen).map(c => c.high));
  } else {
    // TP = nearest swing low BELOW current price
    const belowLows = pivotLows.filter(l => l.price < currentPrice * 0.996);
    if (belowLows.length > 0) return Math.max(...belowLows.map(l => l.price));
    return Math.min(...candles.slice(-sessionLen).map(c => c.low));
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getICTSignals(timeframe: string = "15m"): Promise<ICTSignal[]> {
  const tf = INTERVAL_MAP[timeframe] ?? "15m";
  const sessionLen = SESSION_CANDLES[timeframe] ?? 96;

  const now = Date.now();
  const cached = ictCache.get(tf);
  if (cached && now - cached.timestamp < ICT_CACHE_DURATION) {
    console.log(`⚡ [ICT] Using cached signals for ${tf}`);
    return cached.data;
  }

  // Enrich coin metadata (best-effort)
  try { await fetchTopCoins(); } catch { /* ignore */ }

  // Fetch top USDT perpetuals by 24h volume — shared cache (2-min TTL)
  if (!ictTickerCache || now - ictTickerCache.timestamp > ICT_TICKER_CACHE_DURATION) {
    try {
      const tickerRes = await fapiFetch("/ticker/24hr");
      const allTickers = await tickerRes.json() as any[];
      ictTickerCache = { tickers: allTickers, timestamp: now };
      console.log(`📡 [ICT] Ticker cache refreshed (${allTickers.length} pairs)`);
    } catch (err) {
      console.warn("⚠️ [ICT] Ticker fetch failed:", err);
      if (!ictTickerCache) return []; // first run failed
      // else use old cache
    }
  } else {
    console.log(`⚡ [ICT] Using cached ticker`);
  }

  const topPairs = ictTickerCache.tickers
    .filter(t => t.symbol.endsWith("USDT") && parseFloat(t.quoteVolume) > 10_000_000)
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, 50); // 50 highest-volume pairs — cuts scan time without missing major coins

  console.log(`🔎 [ICT] Scanning ${topPairs.length} pairs on ${tf}...`);

  const results: (ICTSignal | null)[] = [];
  const BATCH = 10;

  for (let b = 0; b < topPairs.length; b += BATCH) {
    const batch = topPairs.slice(b, b + BATCH);

    const batchResults = await Promise.all(
      batch.map(async pair => {
        try {
          const res = await fapiFetch(
            `/klines?symbol=${pair.symbol}&interval=${tf}&limit=${CANDLE_COUNT}`
          );

          const raw: RawKline[] = await res.json();
          if (raw.length < 80) return null;

          const candles = parseCandles(raw);
          const currentPrice = candles[candles.length - 1].close;

          // 1. Market structure
          const pivotHighs = findPivotHighs(candles);
          const pivotLows = findPivotLows(candles);
          const structure = detectMarketStructure(pivotHighs, pivotLows);
          if (structure === "RANGING") return null;

          // 2. Liquidity levels
          const levels = findLiquidityLevels(candles, pivotHighs, pivotLows, sessionLen);

          // 3. Sweeps (only direction matching market structure)
          const sweeps = detectSweeps(candles, levels, structure);
          if (sweeps.length === 0) return null;

          const sweep = sweeps[0]; // freshest sweep
          const maxCandles = INVALIDATION_BY_TF[tf] ?? 1;
          if (sweep.candlesSince > maxCandles) return null;

          const sweepDir = sweep.direction;

          // 4. FVG & Order Block
          const fvg = findFVG(candles, sweep.candleIdx, sweepDir);
          const ob = findOrderBlock(candles, sweep.candleIdx, sweepDir);
          if (!fvg && !ob) return null;

          // 5. Entry zone — merge FVG + OB if both found
          let entryHigh: number;
          let entryLow: number;

          if (fvg && ob) {
            entryHigh = Math.max(fvg.high, ob.high);
            entryLow = Math.min(fvg.low, ob.low);
          } else if (fvg) {
            entryHigh = fvg.high;
            entryLow = fvg.low;
          } else {
            entryHigh = ob!.high;
            entryLow = ob!.low;
          }

          // Sanity: zone must have meaningful size
          if (entryHigh <= entryLow) return null;

          // Validate zone direction relative to current price
          // LONG: entry zone should be below or at current price (pullback target)
          // SHORT: entry zone should be above or at current price
          const priceInZone = currentPrice >= entryLow && currentPrice <= entryHigh;
          if (sweepDir === "BULLISH" && entryLow > currentPrice * 1.01) return null;
          if (sweepDir === "BEARISH" && entryHigh < currentPrice * 0.99) return null;

          // 6. Stop Loss
          const stopLoss = sweepDir === "BULLISH"
            ? sweep.sweepExtreme * 0.998   // just below the sweep wick low
            : sweep.sweepExtreme * 1.002;  // just above the sweep wick high

          // 7. Take Profit — nearest opposing liquidity
          const takeProfit = findOpposingLiquidity(
            candles, pivotHighs, pivotLows, sweepDir, currentPrice, sessionLen,
          );

          // 8. R:R
          const entryMid = (entryHigh + entryLow) / 2;
          const risk = Math.abs(entryMid - stopLoss);
          const reward = Math.abs(takeProfit - entryMid);
          if (risk <= 0) return null;
          const rr = reward / risk;
          if (rr < MIN_RR) return null;

          // Validate TP is in the right direction
          if (sweepDir === "BULLISH" && takeProfit <= currentPrice) return null;
          if (sweepDir === "BEARISH" && takeProfit >= currentPrice) return null;

          // 9. Status
          const status: "ACTIVE" | "IN_ZONE" = priceInZone ? "IN_ZONE" : "ACTIVE";

          // 10. Score
          let score = 40;
          if (fvg) score += 15;
          if (ob) score += 15;
          if (fvg && ob) score += 10; // confluence bonus
          if (sweep.candlesSince <= 1) score += 20;
          else if (sweep.candlesSince <= 3) score += 10;
          else if (sweep.candlesSince <= 5) score += 5;
          if (priceInZone) score += 10;
          if (rr >= 3) score += 8;
          if (rr >= 4) score += 7;
          score = Math.min(score, 100);

          // 11. Coin metadata
          const rawSymbol = pair.symbol.replace("USDT", "");
          const hardcoded = BINANCE_TO_COINGECKO[pair.symbol];
          const dynamic = findCoinMetadata(rawSymbol);
          const finalName =
            dynamic?.name ??
            (hardcoded?.id
              ? hardcoded.id.split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
              : rawSymbol);
          const finalImage = dynamic?.image ?? hardcoded?.image ?? "";

          const setupType: ICTSignal["setupType"] =
            fvg && ob ? "FVG+OB" : fvg ? "FVG" : "OB";

          return {
            coinId: pair.symbol,
            symbol: rawSymbol,
            name: finalName,
            image: finalImage,
            signalType: sweepDir === "BULLISH" ? "LONG" : "SHORT",
            setupType,
            marketStructure: structure,
            sweepLevel: sweep.level,
            sweepExtreme: sweep.sweepExtreme,
            entryZoneHigh: entryHigh,
            entryZoneLow: entryLow,
            stopLoss,
            takeProfit,
            riskReward: Math.round(rr * 10) / 10,
            currentPrice,
            candlesSinceSweep: sweep.candlesSince,
            priceInZone,
            status,
            score,
            liquidityType: sweep.levelType,
            timeframe: tf,
            timestamp: now,
            sweepTimestamp: sweep.sweepTimestamp,
            volume24h: parseFloat(pair.quoteVolume),
            change24h: parseFloat(pair.priceChangePercent),
            formula: `Structure: ${structure} | Sweep: ${sweep.levelType} | Setup: ${setupType} | Risk:Reward = 1:${rr.toFixed(1)}`,
          } as ICTSignal;
        } catch {
          return null;
        }
      }),
    );

    results.push(...batchResults);
    if (b + BATCH < topPairs.length) {
      await new Promise(r => setTimeout(r, 100)); // 100ms between batches — safe within Binance rate limits
    }
  }

  const valid = results
    .filter((s): s is ICTSignal => s !== null)
    .sort((a, b) => b.score - a.score);

  console.log(
    `✅ [ICT] ${valid.length} setups — LONG: ${valid.filter(s => s.signalType === "LONG").length} | SHORT: ${valid.filter(s => s.signalType === "SHORT").length} | IN_ZONE: ${valid.filter(s => s.priceInZone).length}`,
  );

  ictCache.set(tf, { data: valid, timestamp: now });
  return valid;
}
