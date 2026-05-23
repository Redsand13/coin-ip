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
  fetchFuturesExchangeSymbols,
  fetchCoinGeckoMarket,
  fetchDerivatives,
  triggerBinanceScan,
  type SignalQueryParams,
  type DerivativeSymbol,
} from "@/lib/api-client";

import type { ApiSignal, ICTSignal } from "@/lib/types/signals";

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
  // created_at = exact first-detection time (never overwritten on upsert)
  // signal_time = candle open time (used for DB dedup only — not for display)
  const tsMs = new Date(sig.created_at).getTime();
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
    signalType: sig.direction === "LONG" ? "BUY" : "SELL",
    signalName: sig.direction === "LONG"
      ? "Triple Aligned BUY"
      : "Triple Aligned SELL",
    signalKind: (sig.ema_fast != null && sig.ema_mid != null && sig.ema_slow != null)
      ? "TRIPLE_ALIGN"
      : (sig.confluence_score && sig.confluence_score > 0.7 ? "TRIPLE_ALIGN" : "PULLBACK"),
    timeframe: tf,
    score:    Math.round((sig.ml_score ?? (extra.ema_strength as number | undefined) ?? sig.confluence_score ?? 0) * 100),
    price:    sig.price,
    entryPrice:   sig.price,
    currentPrice: sig.price,
    crossoverTimestamp: tsMs,   // exact detection time, not floored to candle boundary
    change1h:  (extra.change_1h as number | undefined)  ?? (extra.change1h as number | undefined)  ?? 0,
    change24h: (extra.change_24h as number | undefined) ?? (extra.change24h as number | undefined) ?? 0,
    // volume_usdt_24h = 24h USDT quote volume from REST ticker (accurate)
    volume24h: (extra.volume_usdt_24h as number | undefined) ?? (extra.ws_volume as number | undefined) ?? (extra.volume24h as number | undefined) ?? 0,
    volatility: (extra.volatility as number | undefined) ?? (() => {
      const adx = (extra.adx as number | undefined) ?? 0;
      const absChange = Math.abs((extra.change_24h as number | undefined) ?? 0);
      return Math.min(10, Math.round(((adx / 60) * 6 + (absChange / 20) * 4) * 10) / 10);
    })(),
    volatilityTooltip: (() => {
      const adx = (extra.adx as number | undefined) ?? 0;
      const ch24 = (extra.change_24h as number | undefined) ?? 0;
      const ch1h = (extra.change_1h as number | undefined) ?? 0;
      return `ADX: ${adx.toFixed(1)} | 24h: ${ch24.toFixed(2)}% | 1h: ${ch1h.toFixed(2)}% | ML: ${Math.round((sig.ml_score ?? 0) * 100)}`;
    })(),
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
  // created_at = exact first-detection time; signal_time = candle open (dedup only)
  const tsMs = new Date(sig.created_at).getTime();
  const extra = (sig.extra ?? {}) as Record<string, unknown>;

  const isComprehensive = extra.ict_comprehensive === true;

  // ── Confluence flags ────────────────────────────────────────────────────────
  // For new comprehensive signals: read directly from extra (always accurate).
  // For old pattern-based signals: infer from ict_pattern string (fallback).
  const pattern    = sig.ict_pattern ?? "";
  let hasSweep:   boolean;
  let hasOB:      boolean;
  let hasFVG:     boolean;
  let hasBOS:     boolean;
  let hasCHoCH:   boolean;
  let hasDisp:    boolean;
  let hasInducement: boolean;
  let killZone: "LONDON" | "NEW_YORK" | "ASIA" | "LONDON_CLOSE" | undefined;
  const hasBreaker = pattern.includes("breaker");

  if (isComprehensive) {
    hasSweep      = extra.has_sweep       as boolean ?? false;
    hasOB         = extra.has_order_block as boolean ?? false;
    hasFVG        = extra.has_fvg         as boolean ?? false;
    hasBOS        = extra.has_bos         as boolean ?? false;
    hasCHoCH      = extra.has_choch       as boolean ?? false;
    hasDisp       = extra.has_displacement as boolean ?? false;
    hasInducement = extra.has_inducement  as boolean ?? false;
    const kzRaw   = extra.kill_zone as string | null;
    killZone      = (kzRaw as typeof killZone) ?? undefined;
  } else {
    // Legacy: infer from pattern string + signal time
    hasSweep      = pattern.includes("sweep");
    hasOB         = pattern.includes("order_block");
    hasFVG        = pattern.includes("fvg");
    hasBOS        = pattern.includes("bos");
    hasCHoCH      = pattern.includes("choch");
    hasDisp       = hasBOS || hasCHoCH;
    hasInducement = false;
    const h = new Date(sig.signal_time).getUTCHours();
    if      (h >= 2  && h <= 5)  killZone = "ASIA";
    else if (h >= 7  && h <= 10) killZone = "LONDON";
    else if (h >= 12 && h <= 15) killZone = "NEW_YORK";
    else if (h >= 15 && h <= 17) killZone = "LONDON_CLOSE";
  }

  // Entry zone: prefer OB, then FVG, then ±1.5% band
  const slPct = 0.015;
  const tpPct = 0.030;
  const isLong = sig.direction === "LONG";

  const ezHigh = sig.order_block_top  ?? sig.fvg_top    ?? sig.price * (isLong ? 1.005 : 1.020);
  const ezLow  = sig.order_block_bottom ?? sig.fvg_bottom ?? sig.price * (isLong ? 0.980 : 0.995);
  const ceLevel = (ezHigh + ezLow) / 2;

  const stopLoss   = isLong ? ezLow  * (1 - slPct) : ezHigh * (1 + slPct);
  const slDist     = Math.abs(ceLevel - stopLoss);
  // TP = at least 2:1 RR from actual SL distance; floor at tpPct to avoid tiny zones
  const minTpDist  = Math.max(slDist * 2, ceLevel * tpPct);
  const takeProfit = isLong ? ceLevel + minTpDist : ceLevel - minTpDist;
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
  // Score: base from ML/quality + 8 pts per confirmed ICT confluence (max 100)
  const score = Math.min(100, Math.round(
    (sig.ml_score ?? quality) * 52 +
    (hasSweep        ? 8 : 0) +
    (hasDisp         ? 8 : 0) +
    (hasOB || hasFVG ? 8 : 0) +
    (hasBOS || hasCHoCH ? 8 : 0) +
    (killZone        ? 8 : 0) +
    (hasInducement   ? 8 : 0),
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
    timeframe: sig.timeframe,
    signalType: sig.direction as "LONG" | "SHORT",
    setupType: isComprehensive
      ? [hasSweep && "Sweep", (hasOB || hasFVG) && (hasOB ? "OB" : "FVG"), (hasBOS || hasCHoCH) && (hasBOS ? "BOS" : "CHoCH")].filter(Boolean).join("+") || "ICT"
      : pattern ? pattern.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : (isLong ? "BOS Long" : "BOS Short"),
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
    hasInducement,
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
      limit: 150,
      skip_count: true,
      latest_per_coin: true,
      min_ml_score: 0.40,  // score >= 40 — filter at DB level, skip noise
    };
    if (timeframe && timeframe !== "all") params.timeframe = timeframe;

    const data = await fetchSignals(params);
    return data.items.map(toEFShape).filter(s => s.score >= 40);
  } catch (error) {
    return [];
  }
}

/**
 * Maps a FastAPI ApiSignal (SMC source) to the SMCSignal shape SMCTerminal expects.
 * All 7 confluence flags, zone levels, OB levels, and pd_context are mapped here.
 */
function toSMCShape(sig: ApiSignal) {
  // created_at = exact first-detection time; signal_time = candle open (dedup only)
  const tsMs       = new Date(sig.created_at).getTime();
  const extra      = (sig.extra ?? {}) as Record<string, unknown>;
  const isLong     = sig.direction === "LONG";

  // ── Setup metadata ─────────────────────────────────────────────────────────
  const setupType    = (extra.smc_setup_type  as string)  ?? (isLong ? "DEMAND_RETEST" : "SUPPLY_RETEST");
  const structureType= (extra.structure_type  as string)  ?? "NEUTRAL";
  const zoneTests    = (extra.zone_tests       as number)  ?? 0;
  const pdCtx        = (extra.pd_context       as string)  ?? (isLong ? "DISCOUNT" : "PREMIUM");

  // ── Confluence flags (7 dimensions) ───────────────────────────────────────
  const hasBOS       = (extra.has_bos          as boolean) ?? false;
  const hasCHoCH     = (extra.has_choch        as boolean) ?? false;
  const hasSD        = (extra.has_supply_demand as boolean) ?? false;
  const hasOB        = (extra.has_order_block  as boolean) ?? false;
  const hasDisp      = (extra.has_displacement as boolean) ?? false;
  const hasFVG       = (extra.has_fvg          as boolean) ?? false;
  const hasEHL       = (extra.has_equal_hl     as boolean) ?? false;
  const hasIDM       = (extra.has_inducement   as boolean) ?? false;
  const hasMit       = (extra.has_mitigation   as boolean) ?? false;

  // ── Key levels ─────────────────────────────────────────────────────────────
  const zoneTop      = (extra.zone_top         as number)  ?? sig.order_block_top    ?? sig.price * (isLong ? 1.010 : 1.020);
  const zoneBottom   = (extra.zone_bottom      as number)  ?? sig.order_block_bottom ?? sig.price * (isLong ? 0.980 : 0.990);
  const obTop        = (extra.ob_top           as number)  ?? zoneTop;
  const obBottom     = (extra.ob_bottom        as number)  ?? zoneBottom;
  const structLevel  = (extra.structure_level  as number)  ?? undefined;
  const liqLevel     = (extra.liquidity_level  as number)  ?? undefined;

  const quality      = (extra.smc_quality      as number)  ?? sig.confluence_score ?? 0.5;
  const confluenceCount = [
    hasBOS || hasCHoCH, hasSD, hasOB, hasDisp, hasFVG, hasEHL || hasIDM, hasMit,
  ].filter(Boolean).length;

  // Entry zone: prefer OB if detected, else SD zone
  const ezHigh = hasOB ? obTop    : zoneTop;
  const ezLow  = hasOB ? obBottom : zoneBottom;
  const ceLevel = (ezHigh + ezLow) / 2;

  const slPct  = 0.012;
  const tpPct  = hasCHoCH ? 0.030 : 0.022;
  const stopLoss   = isLong ? ezLow  * (1 - slPct)  : ezHigh * (1 + slPct);
  const slDist     = Math.abs(ceLevel - stopLoss);
  const minTpDist  = Math.max(slDist * 2, ceLevel * tpPct);
  const takeProfit = isLong ? ceLevel + minTpDist : ceLevel - minTpDist;
  const riskReward = Math.round(
    Math.abs(takeProfit - ceLevel) / Math.max(Math.abs(ceLevel - stopLoss), 1e-10) * 10
  ) / 10;

  // Score: quality × 55 + confluence contribution (max 100)
  const score = Math.min(100, Math.round(
    quality * 55 +
    confluenceCount * 6 +
    (zoneTests === 0 ? 4 : 0) +
    (hasCHoCH       ? 3 : 0) +   // CHoCH = higher-grade reversal
    ((pdCtx === "DISCOUNT" &&  isLong) || (pdCtx === "PREMIUM" && !isLong) ? 3 : 0),
  ));

  const coinId = sig.symbol.replace(/USDT$|BUSD$|BTC$/, "").toLowerCase();

  const setupLabel: Record<string, string> = {
    CHoCH:            "CHoCH",
    BOS_RETEST:       "BOS Retest",
    DEMAND_RETEST:    "Demand Retest",
    SUPPLY_RETEST:    "Supply Retest",
    LIQUIDITY_SWEEP:  "Liq Sweep",
    MITIGATION:       "Mitigation",
    // legacy keys kept for old DB rows
    BULLISH_CHOCH:    "CHoCH",
    BEARISH_CHOCH:    "CHoCH",
    BOS_PULLBACK:     "BOS Retest",
  };

  const formula = [
    hasBOS   ? "BOS"        : "",
    hasCHoCH ? "CHoCH"      : "",
    hasSD    ? "S/D Zone"   : "",
    hasOB    ? "OB"         : "",
    hasDisp  ? "Disp"       : "",
    hasFVG   ? "FVG"        : "",
    hasEHL   ? "Eq H/L"     : "",
    hasIDM   ? "IDM"        : "",
    hasMit   ? "Mitigation" : "",
  ].filter(Boolean).join(" + ") || "Structure";

  const premiumDiscount: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM" =
    pdCtx === "PREMIUM"  ? "PREMIUM"  :
    pdCtx === "DISCOUNT" ? "DISCOUNT" : "EQUILIBRIUM";

  return {
    id:         sig.id,
    coinId,
    symbol:     sig.symbol,
    name:       coinId.toUpperCase(),
    timeframe:  sig.timeframe,
    signalType: sig.direction as "LONG" | "SHORT",
    setupType:  setupLabel[setupType] ?? setupType.replace(/_/g, " "),
    score,
    currentPrice:  sig.price,
    stopLoss,
    takeProfit,
    riskReward:    Math.max(1, riskReward),
    sweepTimestamp: tsMs,
    timestamp:     tsMs,
    candlesSinceSweep: 0,
    change24h: Number((extra.change_24h ?? extra.change24h) ?? 0),
    volume24h: sig.volume ?? 0,
    formula,
    marketStructure: (structureType === "BULLISH" ? "BULLISH" : structureType === "BEARISH" ? "BEARISH" : "RANGING") as "BULLISH" | "BEARISH" | "RANGING",
    killZone:    undefined,
    inKillZone:  false,
    premiumDiscount,
    status:      (sig.price >= ezLow && sig.price <= ezHigh ? "IN_ZONE" : "ACTIVE") as "IN_ZONE" | "ACTIVE",
    priceInZone: sig.price >= ezLow && sig.price <= ezHigh,
    liquidityType: hasEHL || hasIDM ? "LIQUIDITY_SWEEP" : hasBOS ? "BOS_RETEST" : "STRUCTURE",
    // Confluence flags (both flat + prefixed for SMCTerminal)
    choch:          hasCHoCH,
    bos:            hasBOS,
    displacement:   hasDisp,
    hasDisplacement: hasDisp,
    hasSweep:       hasEHL || hasIDM,
    hasFVG,
    hasOB,
    hasCHoCH,
    hasBOS,
    hasSD,
    hasIDM,
    hasInducement:  hasIDM,
    hasMitigation:  hasMit,
    hasEqualHL:     hasEHL,
    isBreaker:      hasMit,
    // Entry zone
    entryZoneHigh: ezHigh,
    entryZoneLow:  ezLow,
    ceLevel,
    bosLevel:  structLevel ?? sig.price,
    oteZone:   null,
    dealingRangeHigh: zoneTop,
    dealingRangeLow:  zoneBottom,
    orderBlockTop:    obTop,
    orderBlockBottom: obBottom,
    fvgTop:    sig.fvg_top    ?? undefined,
    fvgBottom: sig.fvg_bottom ?? undefined,
    sweepHigh: isLong ? undefined : (liqLevel ?? undefined),
    sweepLow:  isLong ? (liqLevel ?? undefined) : undefined,
    mlScore:         sig.ml_score         ?? quality,
    confluenceScore: sig.confluence_score ?? 0,
    // SMC-specific fields for SMCTerminal display
    structureType,
    zoneTests,
    pdContext: pdCtx,
    liquidityLevel: liqLevel,
    structureLevel: structLevel,
  };
}

/**
 * Fetch ICT/SMC signals from the Python backend.
 */
export async function getICTSignalsAction(timeframe: string = "1h") {
  try {
    const params: SignalQueryParams = {
      source: "ict",
      limit: 200,
      skip_count: true,
      from_ts: 1,          // bypass 48h default window — show all historical signals
    };
    if (timeframe && timeframe !== "all") params.timeframe = timeframe;

    const data = await fetchSignals(params);
    const mapped = data.items.map(toICTShape).filter(s => s.score >= 55);

    // Deduplicate: same coin + same timeframe → keep highest score only.
    const seen = new Map<string, typeof mapped[0]>();
    for (const s of mapped) {
      const key = `${s.symbol}:${s.timeframe}`;
      const existing = seen.get(key);
      if (!existing || s.score > existing.score) seen.set(key, s);
    }
    return [...seen.values()].sort((a, b) => b.score - a.score);
  } catch (error) {
    return [];
  }
}

/**
 * Fetch SMC signals from the Python backend.
 */
export async function getSMCSignalsAction(timeframe: string = "1h"): Promise<ICTSignal[]> {
  try {
    const params: SignalQueryParams = {
      source: "smc",
      limit: 200,
      skip_count: true,
      from_ts: 1,          // bypass 48h default window
    };
    if (timeframe && timeframe !== "all") params.timeframe = timeframe;

    const data = await fetchSignals(params);
    const mapped = data.items.map(toSMCShape).filter(s => s.score >= 50);

    // Deduplicate: same coin + same timeframe → keep highest score only.
    const seen = new Map<string, typeof mapped[0]>();
    for (const s of mapped) {
      const key = `${s.symbol}:${s.timeframe}`;
      const existing = seen.get(key);
      if (!existing || s.score > existing.score) seen.set(key, s);
    }
    return [...seen.values()].sort((a, b) => b.score - a.score) as unknown as ICTSignal[];
  } catch {
    return [];
  }
}

/**
 * Fetch signal history from the FastAPI backend with optional filters.
 */
export async function getDbSignalsAction(opts: {
  source?: string;
  direction?: "LONG" | "SHORT";
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
  ict: number;
}> {
  try {
    await triggerBinanceScan();
    return { binance: 0, ict: 0 };
  } catch (error) {
    return { binance: 0, ict: 0 };
  }
}

/**
 * Server-side auth check for the Signal History page.
 */
export async function verifyHistoryKeyAction(password: string): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 400));
  const key = process.env.SIGNAL_HISTORY_KEY;
  if (!key) return false;
  return password.trim() === key.trim();
}

/**
 * Returns a map of symbol → exchanges[] for futures availability badges.
 * Shape: { "BTCUSDT": ["binance", "bybit"], ... }
 */
export async function getExchangeAvailabilityAction(): Promise<Record<string, string[]>> {
  try {
    const raw = await fetchFuturesExchangeSymbols();
    // Invert: { exchange: symbol[] } → { symbol: exchange[] }
    const out: Record<string, string[]> = {};
    for (const [exchange, symbols] of Object.entries(raw)) {
      for (const sym of symbols) {
        (out[sym] ??= []).push(exchange);
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Home page — recent signals + scanner status.
 *
 * Uses from_ts=1 to bypass the backend's default 48-hour window so we always
 * return data regardless of when the last scan ran.
 * Deduplication (one entry per symbol+source) is done here rather than via
 * the DISTINCT ON / latest_per_coin DB path, which can silently return 0
 * rows when the query planner mis-estimates the cardinality.
 */
export async function getHomeDataAction() {
  const [sigResult, statusResult] = await Promise.allSettled([
    // 100 most-recent signals, all time, with total count
    fetchSignals({ limit: 100, skip_count: false, from_ts: 1 }),
    import("@/lib/api-client").then(m => m.fetchScannerStatus()),
  ]);

  const allItems = sigResult.status === "fulfilled" ? sigResult.value.items : [];
  const total    = sigResult.status === "fulfilled" ? sigResult.value.total : 0;

  // Keep only the latest signal per (symbol, source) pair — already ordered by created_at desc
  const seen = new Set<string>();
  const topSignals = allItems.filter(s => {
    const key = `${s.symbol}|${s.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    topSignals,
    total,
    scanner: statusResult.status === "fulfilled"
      ? statusResult.value
      : { running: false, last_run: null as string | null, last_saved: 0 },
  };
}

// ── CoinGecko types ────────────────────────────────────────────────────────────

export type CGTrendingItem = {
  item: {
    id: string;
    name: string;
    symbol: string;
    thumb: string;
    market_cap_rank: number | null;
    data?: {
      price?: string | number;
      price_change_percentage_24h?: { usd?: number };
    };
  };
};

export type CGMarketCoin = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
  sparkline_in_7d?: { price: number[] };
};

/**
 * Fetch CoinGecko trending + top gainers/losers (server-side, no CORS issues).
 */
export async function getCoinGeckoDataAction(): Promise<{
  trending: CGTrendingItem[];
  gainers: CGMarketCoin[];
  losers: CGMarketCoin[];
  rateLimited: boolean;
}> {
  try {
    // Data is fetched once every 2 min by the backend scheduler and stored in
    // PostgreSQL — this call never hits CoinGecko directly regardless of user count.
    const d = await fetchCoinGeckoMarket();
    const trending = (d.trending ?? []) as CGTrendingItem[];
    const gainers  = (d.gainers  ?? []) as CGMarketCoin[];
    const losers   = (d.losers   ?? []) as CGMarketCoin[];
    // Only flag rate-limited if cache is truly empty (stale + no data)
    const rateLimited = d.stale && trending.length === 0 && gainers.length === 0;
    return { trending, gainers, losers, rateLimited };
  } catch {
    return { trending: [], gainers: [], losers: [], rateLimited: false };
  }
}

/**
 * Fear & Greed Index from alternative.me (no key required).
 */
export async function getFearGreedAction(): Promise<{
  value: number;
  classification: string;
  yesterday: number;
  lastWeek: number;
} | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch("https://api.alternative.me/fng/?limit=8", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    }).finally(() => clearTimeout(tid));
    if (!res.ok) return null;
    const json = await res.json();
    const data: { value: string; value_classification: string }[] = json?.data ?? [];
    if (!data.length) return null;
    return {
      value:          Number(data[0].value),
      classification: data[0].value_classification,
      yesterday:      data[1] ? Number(data[1].value) : Number(data[0].value),
      lastWeek:       data[7] ? Number(data[7].value) : Number(data[0].value),
    };
  } catch {
    return null;
  }
}

/**
 * CoinGecko global market stats (BTC dominance, total market cap, 24h volume).
 */
export async function getMarketGlobalAction(): Promise<{
  btcDominance: number;
  totalMarketCap: number;
  totalVolume24h: number;
  marketCapChange24h: number;
} | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch("https://api.coingecko.com/api/v3/global", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    }).finally(() => clearTimeout(tid));
    if (!res.ok) return null;
    const json = await res.json();
    const d = json?.data;
    return {
      btcDominance:       Math.round(d.market_cap_percentage?.btc * 10) / 10,
      totalMarketCap:     d.total_market_cap?.usd ?? 0,
      totalVolume24h:     d.total_volume?.usd ?? 0,
      marketCapChange24h: Math.round((d.market_cap_change_percentage_24h_usd ?? 0) * 100) / 100,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch derivatives market data (OI, funding rate, L/S ratio) from cached backend.
 */
export async function getDerivativesAction(): Promise<{
  symbols: DerivativeSymbol[];
  stale: boolean;
  updatedAt: string | null;
}> {
  try {
    return await fetchDerivatives();
  } catch {
    return { symbols: [], stale: true, updatedAt: null };
  }
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
    return "";
  }
}
