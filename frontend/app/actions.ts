"use server";

/**
 * Server actions — thin proxy layer between Next.js pages and the FastAPI
 * signal engine. All heavy lifting (scanning, persistence, ML scoring) now
 * runs in the Python backend; these actions just fetch and transform.
 */

import {
  fetchSignals,
  fetchHistory,
  fetchDistinctSymbols,
  fetchSignalsCsv,
  triggerBinanceScan,
  triggerCoinGeckoScan,
  type SignalQueryParams,
} from "@/lib/api-client";

import type { ApiSignal } from "@/lib/types/signals";

// ── Helpers ───────────────────────────────────────────────────────────────────

const CANDLE_MS: Record<string, number> = {
  "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};

/**
 * Maps a FastAPI ApiSignal to the shape ExchangeFuturesTerminal expects.
 * The terminal's toEntry() is very permissive (Record<string,any>), so we
 * just hydrate the right field names.
 */
function toEFShape(sig: ApiSignal) {
  const tsMs = new Date(sig.signal_time).getTime();
  const tf = sig.timeframe;
  const candleMs = CANDLE_MS[tf] ?? 3_600_000;
  const flooredTs = Math.floor(tsMs / candleMs) * candleMs;

  const extra = (sig.extra ?? {}) as Record<string, number>;
  const coinId = sig.symbol.replace(/USDT$|BUSD$|BTC$/, "").toLowerCase();

  return {
    // EFSignalEntry fields
    coinId,
    symbol: sig.symbol,
    name:   coinId.toUpperCase(),
    image:  `https://assets.coingecko.com/coins/images/1/small/${coinId}.png`,
    signalType: sig.direction === "LONG" ? "BUY" : "SELL",
    signalName: sig.ict_pattern
      ? sig.ict_pattern.replace(/_/g, " ").toUpperCase()
      : sig.direction === "LONG"
        ? "Triple Aligned BUY"
        : "Triple Aligned SELL",
    signalKind: sig.confluence_score && sig.confluence_score > 0.7
      ? "TRIPLE_ALIGN"
      : "PULLBACK",
    timeframe: tf,
    score:    Math.round((sig.ml_score ?? sig.confluence_score ?? 0.5) * 100),
    price:    sig.price,
    entryPrice:   sig.price,
    currentPrice: sig.price,
    crossoverTimestamp: flooredTs,
    change1h:  extra.change_1h  ?? extra.change1h  ?? 0,
    change24h: extra.change_24h ?? extra.change24h ?? 0,
    volume24h: sig.volume ?? extra.volume24h ?? 0,
    volatility: extra.volatility ?? 0,
    // EMA values
    ema7:  sig.ema_fast  ?? 0,
    ema25: sig.ema_mid   ?? 0,
    ema99: sig.ema_slow  ?? 0,
    // ML
    mlScore:        sig.ml_score         ?? 0,
    confluenceScore: sig.confluence_score ?? 0,
  };
}

/**
 * Maps a FastAPI ApiSignal (ICT source) to the ICTSignal shape the
 * ICTTerminal component expects.
 */
function toICTShape(sig: ApiSignal) {
  const tsMs = new Date(sig.signal_time).getTime();
  const extra = (sig.extra ?? {}) as Record<string, number | string>;

  // Kill zone from signal hour (UTC)
  const h = new Date(sig.signal_time).getUTCHours();
  let killZone: "LONDON" | "NEW_YORK" | "ASIA" | "LONDON_CLOSE" | undefined;
  if (h >= 0 && h < 4)        killZone = "ASIA";
  else if (h >= 7 && h < 11)  killZone = "LONDON";
  else if (h >= 12 && h < 16) killZone = "NEW_YORK";
  else if (h >= 16 && h < 18) killZone = "LONDON_CLOSE";

  const pattern    = sig.ict_pattern ?? "";
  const hasOB      = pattern.includes("order_block");
  const hasFVG     = pattern.includes("fvg");
  const hasSweep   = pattern.includes("sweep");
  const hasBOS     = pattern.includes("bos");
  const hasCHoCH   = pattern.includes("choch");
  const hasBreaker = pattern.includes("breaker");
  const hasDisp    = hasBOS || hasCHoCH;

  // Entry zone: prefer OB, then FVG, then ±1.5% band
  const slPct = 0.015;
  const tpPct = 0.030;
  const isLong = sig.direction === "LONG";

  const ezHigh = sig.order_block_top  ?? sig.fvg_top    ?? sig.price * (isLong ? 1.005 : 1.020);
  const ezLow  = sig.order_block_bottom ?? sig.fvg_bottom ?? sig.price * (isLong ? 0.980 : 0.995);
  const ceLevel = (ezHigh + ezLow) / 2;

  const stopLoss   = isLong ? ezLow  * (1 - 0.003) : ezHigh * (1 + 0.003);
  const takeProfit = isLong ? ceLevel * (1 + tpPct) : ceLevel * (1 - tpPct);
  const riskReward = Math.round(Math.abs(takeProfit - ceLevel) / Math.abs(ceLevel - stopLoss) * 10) / 10;

  // OTE zone (61.8–78.6 fib between sweep and structure)
  const sweepLevel = sig.sweep_high ?? sig.sweep_low ?? sig.price;
  const structLevel = isLong ? ezLow : ezHigh;
  const range = Math.abs(sweepLevel - structLevel);
  const oteZone = range > 0 ? {
    high:    isLong ? structLevel + range * 0.382 : structLevel - range * 0.214,
    low:     isLong ? structLevel + range * 0.214 : structLevel - range * 0.382,
    optimal: isLong ? structLevel + range * 0.270 : structLevel - range * 0.270,
  } : null;

  // Premium/Discount
  const obMid = (ezHigh + ezLow) / 2;
  let premiumDiscount: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM" = "EQUILIBRIUM";
  if (sig.price > obMid * 1.01) premiumDiscount = "PREMIUM";
  else if (sig.price < obMid * 0.99) premiumDiscount = "DISCOUNT";

  const priceInZone = sig.price >= ezLow && sig.price <= ezHigh;

  const quality = (extra.ict_quality as number) ?? 0.5;
  const score = Math.min(100, Math.round(
    (sig.ml_score ?? quality) * 60 +
    (hasSweep ? 8 : 0) +
    (hasOB || hasFVG ? 8 : 0) +
    (hasBOS || hasCHoCH ? 8 : 0) +
    (killZone ? 8 : 0) +
    (priceInZone ? 8 : 0),
  ));

  const coinId = sig.symbol.replace(/USDT$|BUSD$|BTC$/, "").toLowerCase();

  // Dealing range — rough estimate from structure
  const dealingRangeHigh = sig.sweep_high ?? sig.price * 1.05;
  const dealingRangeLow  = sig.sweep_low  ?? sig.price * 0.95;

  return {
    id:        sig.id,
    coinId,
    symbol:    sig.symbol,
    name:      coinId.toUpperCase(),
    image:     `https://assets.coingecko.com/coins/images/1/small/${coinId}.png`,
    timeframe: sig.timeframe,
    signalType: sig.direction as "LONG" | "SHORT",
    setupType: pattern
      ? pattern.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : isLong ? "BOS Long" : "BOS Short",
    score,
    currentPrice:  sig.price,
    stopLoss,
    takeProfit,
    riskReward:    Math.max(1, riskReward),
    sweepTimestamp: tsMs,
    timestamp:     tsMs,
    candlesSinceSweep: 0,
    change24h:  Number((extra.change_24h ?? extra.change24h) ?? 0),
    volume24h:  sig.volume ?? 0,
    formula: [
      hasSweep   ? "Sweep"   : "",
      hasOB      ? "OB"      : "",
      hasFVG     ? "FVG"     : "",
      hasBOS     ? "BOS"     : "",
      hasCHoCH   ? "CHoCH"   : "",
      hasBreaker ? "Breaker" : "",
    ].filter(Boolean).join(" + ") || "Structure",
    marketStructure: (isLong ? "BULLISH" : "BEARISH") as "BULLISH" | "BEARISH" | "RANGING",
    killZone,
    inKillZone: !!killZone,
    premiumDiscount,
    status: (priceInZone ? "IN_ZONE" : "ACTIVE") as "IN_ZONE" | "ACTIVE",
    priceInZone,
    liquidityType: hasSweep ? "LIQUIDITY_SWEEP" : hasBOS ? "BOS_RETEST" : "STRUCTURE",
    // Confluence booleans
    choch:          hasCHoCH,
    bos:            hasBOS,
    displacement:   hasDisp,
    hasDisplacement: hasDisp,
    hasSweep,
    hasFVG,
    hasOB,
    hasCHoCH,
    hasBOS,
    hasInducement: false,
    isBreaker:     hasBreaker,
    // Entry zone levels
    entryZoneHigh: ezHigh,
    entryZoneLow:  ezLow,
    ceLevel,
    bosLevel:      sig.sweep_high ?? sig.sweep_low ?? sig.price,
    oteZone,
    // Dealing range
    dealingRangeHigh,
    dealingRangeLow,
    // Raw backend levels
    orderBlockTop:    sig.order_block_top    ?? undefined,
    orderBlockBottom: sig.order_block_bottom ?? undefined,
    fvgTop:           sig.fvg_top            ?? undefined,
    fvgBottom:        sig.fvg_bottom         ?? undefined,
    sweepHigh:        sig.sweep_high         ?? undefined,
    sweepLow:         sig.sweep_low          ?? undefined,
    mlScore:         sig.ml_score          ?? 0,
    confluenceScore: sig.confluence_score  ?? 0,
  };
}

// ── Public server actions ──────────────────────────────────────────────────────

/**
 * Fetch Binance Futures EMA signals from the Python backend and return them
 * in the shape ExchangeFuturesTerminal expects.
 */
export async function getBinanceFuturesSignalsAction(timeframe: string = "1h") {
  try {
    const params: SignalQueryParams = {
      source: "binance",
      limit: 200,
    };
    if (timeframe !== "all") params.timeframe = timeframe;

    const data = await fetchSignals(params);
    return data.items.map(toEFShape);
  } catch (error) {
    console.error("[actions] Binance fetch failed:", error);
    return [];
  }
}

/**
 * Fetch CoinGecko signals from the Python backend.
 */
export async function getCoingeckoSignalsAction(timeframe: string = "1h") {
  try {
    const params: SignalQueryParams = {
      source: "coingecko",
      limit: 200,
    };
    if (timeframe !== "all") params.timeframe = timeframe;

    const data = await fetchSignals(params);
    return data.items.map(toEFShape);
  } catch (error) {
    console.error("[actions] CoinGecko fetch failed:", error);
    return [];
  }
}

/**
 * Fetch ICT/SMC signals from the Python backend.
 */
export async function getICTSignalsAction(timeframe: string = "1h") {
  try {
    const params: SignalQueryParams = {
      source: "ict",
      limit: 200,
    };
    if (timeframe !== "all") params.timeframe = timeframe;

    const data = await fetchSignals(params);
    return data.items
      .map(toICTShape)
      .sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error("[actions] ICT fetch failed:", error);
    return [];
  }
}

/**
 * Fetch signal history from the FastAPI backend with optional filters.
 */
export async function getDbSignalsAction(opts: {
  source?: string;
  timeframe?: string;
  minScore?: number;
  fromTs?: number;
  toTs?: number;
  search?: string;
  page?: number;
  pageSize?: number;
  latestPerCoin?: boolean;
} = {}) {
  try {
    return await fetchHistory(opts);
  } catch (error) {
    console.error("[actions] History fetch failed:", error);
    return { signals: [], total: 0 };
  }
}

/**
 * Return distinct symbols stored in the backend DB.
 */
export async function getDbSymbolsAction(source?: string): Promise<string[]> {
  try {
    return await fetchDistinctSymbols(source);
  } catch {
    return [];
  }
}

/**
 * Trigger a manual full scan across all sources via the Python backend.
 * Called from the History page "Sync" button.
 */
export async function syncAllTimeframesAction(): Promise<{
  binance: number;
  coingecko: number;
  ict: number;
}> {
  try {
    await Promise.all([triggerBinanceScan(), triggerCoinGeckoScan()]);
    // ICT scan is triggered automatically by the Binance scan in the backend
    return { binance: 0, coingecko: 0, ict: 0 };
  } catch (error) {
    console.error("[actions] Sync failed:", error);
    return { binance: 0, coingecko: 0, ict: 0 };
  }
}

/**
 * Server-side auth check for the Signal History page.
 */
export async function verifyHistoryKeyAction(password: string): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 400));
  const key = process.env.SIGNAL_HISTORY_KEY;
  if (!key) {
    console.warn("[actions] SIGNAL_HISTORY_KEY not set");
    return false;
  }
  return password.trim() === key.trim();
}

/**
 * Export filtered signals as CSV string.
 */
export async function exportSignalsCsvAction(
  source?: string,
  timeframe?: string,
  minScore?: number
): Promise<string> {
  try {
    const params: SignalQueryParams = {};
    if (source && source !== "all")     params.source = source as SignalQueryParams["source"];
    if (timeframe && timeframe !== "all") params.timeframe = timeframe;
    if (minScore !== undefined)          params.min_ml_score = minScore / 100;

    return await fetchSignalsCsv(params);
  } catch (error) {
    console.error("[actions] CSV export failed:", error);
    return "";
  }
}
