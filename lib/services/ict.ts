/**
 * ICT / SMC Strategy Scanner
 *
 * ZERO additional Binance API calls — reads entirely from the shared kline cache
 * and ticker data that the Binance EMA scanner already populated.
 *
 * Flow:
 * 1.  Get top pairs + ticker from Binance shared cache (already fetched by EMA scanner)
 * 2.  Get klines from WS buffer or REST cache (already fetched by EMA scanner)
 * 3.  Run full ICT analysis on that cached data:
 *     Market Structure → CHoCH → BOS → Sweep → Displacement → Inducement
 *     → FVG / OB / Breaker → CE / OTE → Premium/Discount → Kill Zones → Score
 */

import {
  getSharedKlines,
  getSharedTopPairs,
  getBinanceFuturesSignals,
} from "./binance";
import {
  fetchTopCoins,
  findCoinMetadata,
  BINANCE_TO_COINGECKO,
} from "./coingecko";

const CANDLE_COUNT = 150;
const SWEEP_LOOKBACK = 30;
const INVALIDATION_BY_TF: Record<string, number> = {
  "5m": 24, "15m": 18, "30m": 12, "1h": 8, "4h": 5, "1d": 3,
};
const PIVOT_PERIOD = 3;
const EQUAL_THRESHOLD = 0.003;
const MIN_RR = 1.5;

const SESSION_CANDLES: Record<string, number> = {
  "5m": 288, "15m": 96, "30m": 48, "1h": 24, "4h": 6, "1d": 7,
};

const INTERVAL_MAP: Record<string, string> = {
  "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "1d": "1d",
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

interface SwingPoint { idx: number; price: number; }

interface LiquidityLevel {
  type: "EQUAL_HIGHS" | "EQUAL_LOWS" | "SESSION_HIGH" | "SESSION_LOW";
  price: number;
}

interface Sweep {
  direction: "BULLISH" | "BEARISH";
  level: number;
  levelType: string;
  candleIdx: number;
  sweepExtreme: number;
  sweepTimestamp: number;
  candlesSince: number;
}

interface Zone { high: number; low: number; }

export type KillZoneName = "LONDON" | "NEW_YORK" | "ASIA" | "LONDON_CLOSE";
export type PremiumDiscount = "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";

export interface ICTSignal {
  coinId: string;
  symbol: string;
  name: string;
  image: string;
  signalType: "LONG" | "SHORT";
  setupType: "FVG" | "OB" | "FVG+OB" | "BREAKER" | "FVG+BREAKER" | "OB+BREAKER";
  marketStructure: "BULLISH" | "BEARISH";
  sweepLevel: number;
  sweepExtreme: number;
  liquidityType: string;
  candlesSinceSweep: number;
  sweepTimestamp: number;
  entryZoneHigh: number;
  entryZoneLow: number;
  ceLevel: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  currentPrice: number;
  priceInZone: boolean;
  status: "ACTIVE" | "IN_ZONE";
  bos: boolean;
  bosLevel: number;
  choch: boolean;
  displacement: boolean;
  hasInducement: boolean;
  isBreaker: boolean;
  premiumDiscount: PremiumDiscount;
  oteZone: { low: number; high: number; optimal: number } | null;
  killZone: KillZoneName | null;
  dealingRangeHigh: number;
  dealingRangeLow: number;
  score: number;
  timeframe: string;
  timestamp: number;
  volume24h: number;
  change24h: number;
  formula: string;
}

// ─── ICT signal cache ─────────────────────────────────────────────────────────

const ictCache = new Map<string, { data: ICTSignal[]; timestamp: number }>();
const ICT_CACHE_DURATION = 8_000;

// ─── Candle parsing ───────────────────────────────────────────────────────────

// BinanceKline tuple from binance.ts cache: [openTime, o, h, l, c, vol, closeTime, ...]
type CachedKline = [number, string, string, string, string, string, number, ...unknown[]];

function parseCandles(raw: CachedKline[]): Candle[] {
  return raw.map(k => ({
    openTime:  k[0],
    closeTime: k[6] as number,
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

// ─── Pivot detection ──────────────────────────────────────────────────────────

function findPivotHighs(candles: Candle[], period = PIVOT_PERIOD): SwingPoint[] {
  const result: SwingPoint[] = [];
  for (let i = period; i < candles.length - period; i++) {
    const h = candles[i].high;
    let ok = true;
    for (let j = i - period; j <= i + period; j++) {
      if (j !== i && candles[j].high >= h) { ok = false; break; }
    }
    if (ok) result.push({ idx: i, price: h });
  }
  return result;
}

function findPivotLows(candles: Candle[], period = PIVOT_PERIOD): SwingPoint[] {
  const result: SwingPoint[] = [];
  for (let i = period; i < candles.length - period; i++) {
    const l = candles[i].low;
    let ok = true;
    for (let j = i - period; j <= i + period; j++) {
      if (j !== i && candles[j].low <= l) { ok = false; break; }
    }
    if (ok) result.push({ idx: i, price: l });
  }
  return result;
}

// ─── Market structure ─────────────────────────────────────────────────────────

function detectMarketStructure(
  pivotHighs: SwingPoint[], pivotLows: SwingPoint[],
): "BULLISH" | "BEARISH" | "RANGING" {
  if (pivotHighs.length < 2 || pivotLows.length < 2) return "RANGING";
  const lastHighs = pivotHighs.slice(-3);
  const lastLows  = pivotLows.slice(-3);
  const hh = lastHighs.every((h, i) => i === 0 || h.price > lastHighs[i - 1].price);
  const hl = lastLows.every( (l, i) => i === 0 || l.price > lastLows[i - 1].price);
  const lh = lastHighs.every((h, i) => i === 0 || h.price < lastHighs[i - 1].price);
  const ll = lastLows.every( (l, i) => i === 0 || l.price < lastLows[i - 1].price);
  if (hh && hl) return "BULLISH";
  if (lh && ll) return "BEARISH";
  return "RANGING";
}

// ─── BOS — Break of Structure ─────────────────────────────────────────────────

function detectBOS(
  candles: Candle[], pivotHighs: SwingPoint[], pivotLows: SwingPoint[],
  direction: "BULLISH" | "BEARISH", sweepIdx: number,
): { detected: boolean; level: number } {
  if (direction === "BULLISH") {
    const highs = pivotHighs.filter(h => h.idx < sweepIdx);
    if (!highs.length) return { detected: false, level: 0 };
    const target = highs[highs.length - 1].price;
    for (let i = sweepIdx; i < candles.length; i++) {
      if (candles[i].close > target) return { detected: true, level: target };
    }
  } else {
    const lows = pivotLows.filter(l => l.idx < sweepIdx);
    if (!lows.length) return { detected: false, level: 0 };
    const target = lows[lows.length - 1].price;
    for (let i = sweepIdx; i < candles.length; i++) {
      if (candles[i].close < target) return { detected: true, level: target };
    }
  }
  return { detected: false, level: 0 };
}

// ─── CHoCH — Change of Character ─────────────────────────────────────────────

function detectCHoCH(
  pivotHighs: SwingPoint[], pivotLows: SwingPoint[],
  direction: "BULLISH" | "BEARISH", sweepIdx: number,
): boolean {
  const hb = pivotHighs.filter(h => h.idx < sweepIdx - 3).slice(-3);
  const lb = pivotLows.filter( l => l.idx < sweepIdx - 3).slice(-3);
  if (hb.length < 2 || lb.length < 2) return false;
  if (direction === "BULLISH") {
    return hb.every((h, i) => i === 0 || h.price < hb[i - 1].price)
        && lb.every((l, i) => i === 0 || l.price < lb[i - 1].price);
  }
  return hb.every((h, i) => i === 0 || h.price > hb[i - 1].price)
      && lb.every((l, i) => i === 0 || l.price > lb[i - 1].price);
}

// ─── Displacement ─────────────────────────────────────────────────────────────

function detectDisplacement(
  candles: Candle[], sweepIdx: number, direction: "BULLISH" | "BEARISH",
): boolean {
  const end = Math.min(candles.length, sweepIdx + 7);
  let streak = 0;
  for (let i = sweepIdx; i < end; i++) {
    const c = candles[i];
    const range = c.high - c.low;
    if (range === 0) continue;
    const strongBody = Math.abs(c.close - c.open) / range > 0.55;
    const inDir = direction === "BULLISH" ? c.close > c.open : c.close < c.open;
    if (strongBody && inDir) { if (++streak >= 2) return true; }
    else if (!inDir) streak = 0;
  }
  return false;
}

// ─── Inducement ───────────────────────────────────────────────────────────────

function detectInducement(
  candles: Candle[], pivotHighs: SwingPoint[], pivotLows: SwingPoint[],
  sweepIdx: number, direction: "BULLISH" | "BEARISH",
): boolean {
  const start = Math.max(0, sweepIdx - 15);
  const sc = candles[sweepIdx];
  if (direction === "BULLISH")
    return pivotLows.filter(l => l.idx >= start && l.idx < sweepIdx - 2).some(l => sc.low < l.price);
  return pivotHighs.filter(h => h.idx >= start && h.idx < sweepIdx - 2).some(h => sc.high > h.price);
}

// ─── Breaker Block ────────────────────────────────────────────────────────────

function findBreakerBlock(
  candles: Candle[], sweepIdx: number, direction: "BULLISH" | "BEARISH",
): Zone | null {
  const start = Math.max(0, sweepIdx - 25);
  const cp = candles[candles.length - 1].close;
  if (direction === "BULLISH") {
    for (let i = sweepIdx - 2; i >= start; i--) {
      const c = candles[i];
      if (c.close >= c.open) continue;
      const range = c.high - c.low;
      if (!range || (c.open - c.close) / range < 0.25) continue;
      if (candles.slice(i + 1, sweepIdx).some(cx => cx.low < c.low) && cp > c.open)
        return { high: c.open, low: c.close };
    }
  } else {
    for (let i = sweepIdx - 2; i >= start; i--) {
      const c = candles[i];
      if (c.close <= c.open) continue;
      const range = c.high - c.low;
      if (!range || (c.close - c.open) / range < 0.25) continue;
      if (candles.slice(i + 1, sweepIdx).some(cx => cx.high > c.high) && cp < c.open)
        return { high: c.close, low: c.open };
    }
  }
  return null;
}

// ─── Premium / Discount ───────────────────────────────────────────────────────

function analyzePremiumDiscount(
  pivotHighs: SwingPoint[], pivotLows: SwingPoint[], currentPrice: number,
): { zone: PremiumDiscount; high: number; low: number } {
  const F = { zone: "EQUILIBRIUM" as PremiumDiscount, high: 0, low: 0 };
  const rh = pivotHighs.slice(-4), rl = pivotLows.slice(-4);
  if (!rh.length || !rl.length) return F;
  const high = Math.max(...rh.map(h => h.price));
  const low  = Math.min(...rl.map(l => l.price));
  if (high <= low) return F;
  const range = high - low;
  const zone: PremiumDiscount =
    currentPrice > low + range * 0.618 ? "PREMIUM" :
    currentPrice < low + range * 0.382 ? "DISCOUNT" : "EQUILIBRIUM";
  return { zone, high, low };
}

// ─── OTE — Optimal Trade Entry ────────────────────────────────────────────────

function calculateOTE(
  direction: "BULLISH" | "BEARISH", drHigh: number, drLow: number,
): { low: number; high: number; optimal: number } | null {
  if (drHigh <= drLow) return null;
  if (direction === "BULLISH") return {
    high: drHigh - (drHigh - drLow) * 0.618,
    low:  drHigh - (drHigh - drLow) * 0.786,
    optimal: drHigh - (drHigh - drLow) * 0.705,
  };
  return {
    low:  drLow + (drHigh - drLow) * 0.618,
    high: drLow + (drHigh - drLow) * 0.786,
    optimal: drLow + (drHigh - drLow) * 0.705,
  };
}

// ─── Kill Zone ────────────────────────────────────────────────────────────────

function getKillZone(ts: number): KillZoneName | null {
  const m = new Date(ts).getUTCHours() * 60 + new Date(ts).getUTCMinutes();
  if (m >= 120 && m < 300)  return "LONDON";
  if (m >= 720 && m < 900)  return "NEW_YORK";
  if (m >= 900 && m < 960)  return "LONDON_CLOSE";
  if (m >= 1200 || m < 60)  return "ASIA";
  return null;
}

// ─── Liquidity levels ─────────────────────────────────────────────────────────

function findLiquidityLevels(
  candles: Candle[], pivotHighs: SwingPoint[], pivotLows: SwingPoint[], sessionLen: number,
): LiquidityLevel[] {
  const levels: LiquidityLevel[] = [];
  for (let i = 0; i < pivotHighs.length; i++) {
    for (let j = i + 1; j < pivotHighs.length; j++) {
      const diff = Math.abs(pivotHighs[i].price - pivotHighs[j].price) / pivotHighs[i].price;
      if (diff < EQUAL_THRESHOLD) {
        const avg = (pivotHighs[i].price + pivotHighs[j].price) / 2;
        if (!levels.some(l => l.type === "EQUAL_HIGHS" && Math.abs(l.price - avg) / avg < EQUAL_THRESHOLD))
          levels.push({ type: "EQUAL_HIGHS", price: avg });
      }
    }
  }
  for (let i = 0; i < pivotLows.length; i++) {
    for (let j = i + 1; j < pivotLows.length; j++) {
      const diff = Math.abs(pivotLows[i].price - pivotLows[j].price) / pivotLows[i].price;
      if (diff < EQUAL_THRESHOLD) {
        const avg = (pivotLows[i].price + pivotLows[j].price) / 2;
        if (!levels.some(l => l.type === "EQUAL_LOWS" && Math.abs(l.price - avg) / avg < EQUAL_THRESHOLD))
          levels.push({ type: "EQUAL_LOWS", price: avg });
      }
    }
  }
  const sess = candles.slice(-sessionLen);
  levels.push({ type: "SESSION_HIGH", price: Math.max(...sess.map(c => c.high)) });
  levels.push({ type: "SESSION_LOW",  price: Math.min(...sess.map(c => c.low)) });
  return levels;
}

// ─── Sweep detection ──────────────────────────────────────────────────────────

function detectSweeps(
  candles: Candle[], levels: LiquidityLevel[], structure: "BULLISH" | "BEARISH",
): Sweep[] {
  const sweeps: Sweep[] = [];
  const n = candles.length;
  for (let i = Math.max(0, n - SWEEP_LOOKBACK); i < n; i++) {
    const c = candles[i];
    const isLive = i === n - 1;
    const ts = isLive ? c.openTime : c.closeTime;
    const candlesSince = isLive ? 0 : n - 1 - i;
    for (const lv of levels) {
      if (structure === "BULLISH" && (lv.type === "EQUAL_LOWS" || lv.type === "SESSION_LOW")) {
        if (c.low < lv.price && c.close > lv.price)
          sweeps.push({ direction: "BULLISH", level: lv.price, levelType: lv.type, candleIdx: i, sweepExtreme: c.low, sweepTimestamp: ts, candlesSince });
      }
      if (structure === "BEARISH" && (lv.type === "EQUAL_HIGHS" || lv.type === "SESSION_HIGH")) {
        if (c.high > lv.price && c.close < lv.price)
          sweeps.push({ direction: "BEARISH", level: lv.price, levelType: lv.type, candleIdx: i, sweepExtreme: c.high, sweepTimestamp: ts, candlesSince });
      }
    }
  }
  return sweeps.sort((a, b) => a.candlesSince - b.candlesSince);
}

// ─── FVG ──────────────────────────────────────────────────────────────────────

function findFVG(
  candles: Candle[], sweepIdx: number, direction: "BULLISH" | "BEARISH",
): Zone | null {
  const start = Math.max(0, sweepIdx - 2);
  const end   = Math.min(candles.length - 3, sweepIdx + 5);
  for (let i = start; i <= end; i++) {
    const c1 = candles[i], c3 = candles[i + 2];
    if (!c1 || !c3) continue;
    if (direction === "BULLISH" && c1.high < c3.low) return { high: c3.low, low: c1.high };
    if (direction === "BEARISH" && c1.low > c3.high) return { high: c1.low, low: c3.high };
  }
  return null;
}

// ─── Order Block ──────────────────────────────────────────────────────────────

function findOrderBlock(
  candles: Candle[], sweepIdx: number, direction: "BULLISH" | "BEARISH",
): Zone | null {
  for (let i = sweepIdx; i >= Math.max(0, sweepIdx - 4); i--) {
    const c = candles[i], next = candles[i + 1];
    if (!c || !next) continue;
    const range = c.high - c.low;
    if (!range || Math.abs(c.close - c.open) / range < 0.25) continue;
    if (direction === "BULLISH" && c.close < c.open && next.close > c.open * 0.998) return { high: c.open, low: c.close };
    if (direction === "BEARISH" && c.close > c.open && next.close < c.open * 1.002) return { high: c.close, low: c.open };
  }
  return null;
}

// ─── Opposing liquidity (TP target) ──────────────────────────────────────────

function findOpposingLiquidity(
  candles: Candle[], pivotHighs: SwingPoint[], pivotLows: SwingPoint[],
  direction: "BULLISH" | "BEARISH", currentPrice: number, sessionLen: number,
): number {
  if (direction === "BULLISH") {
    const above = pivotHighs.filter(h => h.price > currentPrice * 1.004);
    if (above.length) return Math.min(...above.map(h => h.price));
    return Math.max(...candles.slice(-sessionLen).map(c => c.high));
  }
  const below = pivotLows.filter(l => l.price < currentPrice * 0.996);
  if (below.length) return Math.max(...below.map(l => l.price));
  return Math.min(...candles.slice(-sessionLen).map(c => c.low));
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getICTSignals(timeframe = "15m"): Promise<ICTSignal[]> {
  const tf         = INTERVAL_MAP[timeframe] ?? "15m";
  const sessionLen = SESSION_CANDLES[timeframe] ?? 96;
  const now        = Date.now();

  const cached = ictCache.get(tf);
  if (cached && now - cached.timestamp < ICT_CACHE_DURATION) {
    console.log(`⚡ [ICT] Cache hit — ${tf}`);
    return cached.data;
  }

  // Check if klines exist for THIS specific timeframe — not just the ticker.
  // Ticker can be fresh (from a "1h" Binance scan) while "15m" klines are missing.
  const pairs0 = getSharedTopPairs(3, 10_000_000);
  let hasKlines = false;
  for (const p of pairs0) {
    const k = await getSharedKlines(p.symbol, tf, 5);
    if (k && k.length >= 5) { hasKlines = true; break; }
  }

  if (!hasKlines) {
    console.log(`[ICT] No klines for ${tf} in cache — seeding via Binance scan...`);
    try { await getBinanceFuturesSignals(tf); } catch { /* continue */ }
  }

  const topPairs = getSharedTopPairs(50, 10_000_000);
  if (topPairs.length === 0) {
    console.warn("[ICT] No shared ticker data available yet — returning empty");
    return [];
  }

  // Best-effort coin metadata enrichment
  try { await fetchTopCoins(); } catch { /* ignore */ }

  const stats = { noKlines: 0, ranging: 0, noSweep: 0, sweepStale: 0, noZone: 0, badRR: 0 };
  console.log(`🔎 [ICT] Analysing ${topPairs.length} cached pairs on ${tf} (0 new REST calls)`);

  const results = await Promise.all(
    topPairs.map(async pair => {
      try {
        const rawKlines = await getSharedKlines(pair.symbol, tf, CANDLE_COUNT);
        if (!rawKlines || rawKlines.length < 80) { stats.noKlines++; return null; }

        const candles      = parseCandles(rawKlines as CachedKline[]);
        const currentPrice = candles[candles.length - 1].close;

        // 1. Market structure
        const pivotHighs = findPivotHighs(candles);
        const pivotLows  = findPivotLows(candles);
        const structure  = detectMarketStructure(pivotHighs, pivotLows);
        if (structure === "RANGING") { stats.ranging++; return null; }

        // 2. Liquidity levels
        const levels = findLiquidityLevels(candles, pivotHighs, pivotLows, sessionLen);

        // 3. Sweep
        const sweeps = detectSweeps(candles, levels, structure);
        if (!sweeps.length) { stats.noSweep++; return null; }
        const sweep = sweeps[0];
        if (sweep.candlesSince > (INVALIDATION_BY_TF[tf] ?? 8)) { stats.sweepStale++; return null; }
        const dir = sweep.direction;

        // 4. Entry zones
        const fvg     = findFVG(candles, sweep.candleIdx, dir);
        const ob      = findOrderBlock(candles, sweep.candleIdx, dir);
        const breaker = findBreakerBlock(candles, sweep.candleIdx, dir);
        if (!fvg && !ob && !breaker) { stats.noZone++; return null; }

        // 5. Merge entry zone
        let entryHigh: number, entryLow: number;
        let setupType: ICTSignal["setupType"];
        if (fvg && ob)      { entryHigh = Math.max(fvg.high, ob.high);      entryLow = Math.min(fvg.low, ob.low);      setupType = "FVG+OB"; }
        else if (fvg && breaker) { entryHigh = Math.max(fvg.high, breaker.high); entryLow = Math.min(fvg.low, breaker.low); setupType = "FVG+BREAKER"; }
        else if (ob && breaker)  { entryHigh = Math.max(ob.high, breaker.high);  entryLow = Math.min(ob.low, breaker.low);  setupType = "OB+BREAKER"; }
        else if (fvg)   { entryHigh = fvg.high;     entryLow = fvg.low;     setupType = "FVG"; }
        else if (ob)    { entryHigh = ob.high;      entryLow = ob.low;      setupType = "OB"; }
        else            { entryHigh = breaker!.high; entryLow = breaker!.low; setupType = "BREAKER"; }

        if (entryHigh <= entryLow) return null;
        const priceInZone = currentPrice >= entryLow && currentPrice <= entryHigh;
        if (dir === "BULLISH" && entryLow > currentPrice * 1.03) return null;
        if (dir === "BEARISH" && entryHigh < currentPrice * 0.97) return null;

        const ceLevel = (entryHigh + entryLow) / 2;

        // 6. SL / TP / R:R
        const stopLoss  = dir === "BULLISH" ? sweep.sweepExtreme * 0.998 : sweep.sweepExtreme * 1.002;
        const takeProfit = findOpposingLiquidity(candles, pivotHighs, pivotLows, dir, currentPrice, sessionLen);
        const risk   = Math.abs(ceLevel - stopLoss);
        const reward = Math.abs(takeProfit - ceLevel);
        if (risk <= 0) return null;
        const rr = reward / risk;
        if (rr < MIN_RR) { stats.badRR++; return null; }
        if (dir === "BULLISH" && takeProfit <= currentPrice) { stats.badRR++; return null; }
        if (dir === "BEARISH" && takeProfit >= currentPrice) { stats.badRR++; return null; }

        // 7. Full ICT concepts
        const bosResult     = detectBOS(candles, pivotHighs, pivotLows, dir, sweep.candleIdx);
        const choch         = detectCHoCH(pivotHighs, pivotLows, dir, sweep.candleIdx);
        const displacement  = detectDisplacement(candles, sweep.candleIdx, dir);
        const hasInducement = detectInducement(candles, pivotHighs, pivotLows, sweep.candleIdx, dir);
        const isBreaker     = !fvg && !ob && breaker !== null;

        const pd = analyzePremiumDiscount(pivotHighs, pivotLows, currentPrice);
        const oteZone = pd.high > pd.low ? calculateOTE(dir, pd.high, pd.low) : null;
        const killZone = getKillZone(sweep.sweepTimestamp);

        // 8. Score
        let score = 30;
        if (fvg) score += 12;
        if (ob)  score += 12;
        if (fvg && ob) score += 6;
        if (isBreaker) score += 10;
        const age = sweep.candlesSince;
        if (age === 0)      score += 15;
        else if (age <= 1)  score += 12;
        else if (age <= 3)  score += 7;
        else if (age <= 5)  score += 3;
        if (bosResult.detected) score += 8;
        if (choch)        score += 10;
        if (displacement) score += 8;
        if (hasInducement) score += 6;
        const pdAligned = (dir === "BULLISH" && pd.zone === "DISCOUNT")
          || (dir === "BEARISH" && pd.zone === "PREMIUM");
        if (pdAligned) score += 8;
        if (killZone)  score += 5;
        if (priceInZone) score += 8;
        if (rr >= 4) score += 6; else if (rr >= 3) score += 4; else if (rr >= 2) score += 2;
        score = Math.min(score, 100);

        // 9. Metadata
        const rawSym    = pair.symbol.replace("USDT", "");
        const hardcoded = BINANCE_TO_COINGECKO[pair.symbol];
        const dynamic   = findCoinMetadata(rawSym);
        const finalName = dynamic?.name ?? (hardcoded?.id
          ? hardcoded.id.split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
          : rawSym);
        const finalImage = dynamic?.image ?? hardcoded?.image ?? "";

        // 10. Formula
        const tags: string[] = [];
        if (choch) tags.push("CHoCH");
        if (bosResult.detected) tags.push(`BOS@${bosResult.level.toFixed(2)}`);
        if (displacement) tags.push("Disp");
        if (hasInducement) tags.push("IDM");
        if (killZone) tags.push(`KZ:${killZone}`);
        const formula = [
          `${structure}${tags.length ? ` [${tags.join(" · ")}]` : ""}`,
          `Sweep: ${sweep.levelType}`,
          `Setup: ${setupType}`,
          `P/D: ${pd.zone}`,
          `R:R 1:${rr.toFixed(1)}`,
        ].join(" | ");

        return {
          coinId: pair.symbol, symbol: rawSym, name: finalName, image: finalImage,
          signalType: dir === "BULLISH" ? "LONG" : "SHORT",
          setupType, marketStructure: structure,
          sweepLevel: sweep.level, sweepExtreme: sweep.sweepExtreme,
          liquidityType: sweep.levelType, candlesSinceSweep: sweep.candlesSince,
          sweepTimestamp: sweep.sweepTimestamp,
          entryZoneHigh: entryHigh, entryZoneLow: entryLow, ceLevel,
          stopLoss, takeProfit, riskReward: Math.round(rr * 10) / 10,
          currentPrice, priceInZone, status: priceInZone ? "IN_ZONE" : "ACTIVE",
          bos: bosResult.detected, bosLevel: bosResult.level,
          choch, displacement, hasInducement, isBreaker,
          premiumDiscount: pd.zone, oteZone, killZone,
          dealingRangeHigh: pd.high, dealingRangeLow: pd.low,
          score, timeframe: tf, timestamp: now,
          volume24h: parseFloat(pair.quoteVolume),
          change24h: parseFloat(pair.priceChangePercent),
          formula,
        } as ICTSignal;

      } catch {
        return null;
      }
    }),
  );

  const valid = results
    .filter((s): s is ICTSignal => s !== null)
    .sort((a, b) => b.score - a.score);

  console.log(`✅ [ICT] ${valid.length} setups — LONG:${valid.filter(s => s.signalType === "LONG").length} | SHORT:${valid.filter(s => s.signalType === "SHORT").length} | CHoCH:${valid.filter(s => s.choch).length} | BOS:${valid.filter(s => s.bos).length} | filtered: noKlines=${stats.noKlines} ranging=${stats.ranging} noSweep=${stats.noSweep} stale=${stats.sweepStale} noZone=${stats.noZone} badRR=${stats.badRR}`);

  ictCache.set(tf, { data: valid, timestamp: now });
  return valid;
}
