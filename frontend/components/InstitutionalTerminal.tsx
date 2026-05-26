"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, RefreshCw, TrendingUp, TrendingDown,
  Minus, Zap, AlertTriangle, Eye, ChevronUp, ChevronDown, HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { InstitutionalFlow, InstitutionalDetection } from "@/lib/types/signals";

const FLOW_URL   = "/api/institutional/flow";
const STREAM_URL = "/api/institutional/stream";

// ── Detection badge metadata ───────────────────────────────────────────────────

const DETECTION_META: Record<string, { label: string; color: string }> = {
  ACCUMULATION:        { label: "ACCUM",     color: "text-emerald-700 dark:text-emerald-400 border-emerald-500/25 bg-emerald-500/10" },
  DISTRIBUTION:        { label: "DISTR",     color: "text-rose-700 dark:text-rose-400 border-rose-500/25 bg-rose-500/10" },
  WHALE_BUY:           { label: "WHALE↑",    color: "text-emerald-700 dark:text-emerald-300 border-emerald-400/25 bg-emerald-400/8" },
  WHALE_SELL:          { label: "WHALE↓",    color: "text-rose-700 dark:text-rose-300 border-rose-400/25 bg-rose-400/8" },
  ABSORPTION_BUY:      { label: "ABSORB↑",   color: "text-sky-700 dark:text-sky-400 border-sky-500/25 bg-sky-500/8" },
  ABSORPTION_SELL:     { label: "ABSORB↓",   color: "text-amber-700 dark:text-amber-400 border-amber-500/25 bg-amber-500/8" },
  ICEBERG_BID:         { label: "ICEBERG↑",  color: "text-violet-700 dark:text-violet-400 border-violet-500/25 bg-violet-500/8" },
  ICEBERG_ASK:         { label: "ICEBERG↓",  color: "text-purple-700 dark:text-purple-400 border-purple-500/25 bg-purple-500/8" },
  SPOOF_BID:           { label: "SPOOF↑",    color: "text-yellow-700 dark:text-yellow-400 border-yellow-500/25 bg-yellow-500/8" },
  SPOOF_ASK:           { label: "SPOOF↓",    color: "text-orange-700 dark:text-orange-400 border-orange-500/25 bg-orange-500/8" },
  LIQUIDITY_GRAB_LOW:  { label: "LIQ↑",      color: "text-cyan-700 dark:text-cyan-400 border-cyan-500/25 bg-cyan-500/8" },
  LIQUIDITY_GRAB_HIGH: { label: "LIQ↓",      color: "text-orange-600 dark:text-orange-300 border-orange-400/25 bg-orange-400/8" },
  STOP_HUNT_LOW:       { label: "STOP↑",     color: "text-teal-700 dark:text-teal-400 border-teal-500/25 bg-teal-500/8" },
  STOP_HUNT_HIGH:      { label: "STOP↓",     color: "text-pink-700 dark:text-pink-400 border-pink-500/25 bg-pink-500/8" },
  REAL_BREAKOUT_UP:    { label: "BRK↑",      color: "text-emerald-700 dark:text-emerald-300 border-emerald-600/25 bg-emerald-600/8" },
  REAL_BREAKOUT_DOWN:  { label: "BRK↓",      color: "text-rose-700 dark:text-rose-300 border-rose-600/25 bg-rose-600/8" },
  FAKE_BREAKOUT_UP:    { label: "FAKE↑",     color: "text-muted-foreground border-border bg-muted/40" },
  FAKE_BREAKOUT_DOWN:  { label: "FAKE↓",     color: "text-muted-foreground/70 border-border bg-muted/20" },
  SMART_LONG:          { label: "SM↑",       color: "text-emerald-700 dark:text-emerald-200 border-emerald-500/30 bg-emerald-500/10" },
  SMART_SHORT:         { label: "SM↓",       color: "text-rose-700 dark:text-rose-200 border-rose-500/30 bg-rose-500/10" },
  RETAIL_LONG_TRAP:    { label: "TRAP↑",     color: "text-red-700 dark:text-red-400 border-red-600/25 bg-red-600/8" },
  RETAIL_SHORT_TRAP:   { label: "TRAP↓",     color: "text-green-700 dark:text-green-400 border-green-600/25 bg-green-600/8" },
};

// ── Signal legend groups ──────────────────────────────────────────────────────

const LEGEND_GROUPS = [
  {
    label: "Position Building",
    color: "#0ecb81",
    signals: [
      { kind: "ACCUMULATION", meaning: "Large buyers quietly building positions over time" },
      { kind: "DISTRIBUTION", meaning: "Large sellers offloading into retail buying" },
    ],
  },
  {
    label: "Whale Activity",
    color: "#6366f1",
    signals: [
      { kind: "WHALE_BUY",  meaning: "Single outsized buy order detected" },
      { kind: "WHALE_SELL", meaning: "Single outsized sell order detected" },
    ],
  },
  {
    label: "Absorption",
    color: "#0ea5e9",
    signals: [
      { kind: "ABSORPTION_BUY",  meaning: "Buyers absorbing all sell pressure without price drop" },
      { kind: "ABSORPTION_SELL", meaning: "Sellers absorbing all buy pressure without price rise" },
    ],
  },
  {
    label: "Iceberg Orders",
    color: "#a855f7",
    signals: [
      { kind: "ICEBERG_BID", meaning: "Hidden buy order refilling at the same level" },
      { kind: "ICEBERG_ASK", meaning: "Hidden sell order refilling at the same level" },
    ],
  },
  {
    label: "Spoofing",
    color: "#eab308",
    signals: [
      { kind: "SPOOF_BID", meaning: "Large fake buy wall placed then cancelled" },
      { kind: "SPOOF_ASK", meaning: "Large fake sell wall placed then cancelled" },
    ],
  },
  {
    label: "Liquidity Grabs",
    color: "#f97316",
    signals: [
      { kind: "LIQUIDITY_GRAB_LOW",  meaning: "Spike below key lows to sweep stops, then reversal" },
      { kind: "LIQUIDITY_GRAB_HIGH", meaning: "Spike above key highs to sweep stops, then reversal" },
    ],
  },
  {
    label: "Stop Hunts",
    color: "#f6465d",
    signals: [
      { kind: "STOP_HUNT_LOW",  meaning: "Price swept below swing low to trigger stops" },
      { kind: "STOP_HUNT_HIGH", meaning: "Price swept above swing high to trigger stops" },
    ],
  },
  {
    label: "Breakouts",
    color: "#22c55e",
    signals: [
      { kind: "REAL_BREAKOUT_UP",    meaning: "Confirmed breakout with volume and CVD support" },
      { kind: "REAL_BREAKOUT_DOWN",  meaning: "Confirmed breakdown with volume and CVD support" },
      { kind: "FAKE_BREAKOUT_UP",    meaning: "Failed breakout above resistance, reversal likely" },
      { kind: "FAKE_BREAKOUT_DOWN",  meaning: "Failed breakdown below support, reversal likely" },
    ],
  },
  {
    label: "Smart Money",
    color: "#10b981",
    signals: [
      { kind: "SMART_LONG",        meaning: "Institutional footprint aligned bullish" },
      { kind: "SMART_SHORT",       meaning: "Institutional footprint aligned bearish" },
      { kind: "RETAIL_LONG_TRAP",  meaning: "Retail buyers trapped — smart money selling into them" },
      { kind: "RETAIL_SHORT_TRAP", meaning: "Retail sellers trapped — smart money buying from them" },
    ],
  },
];

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number, d = 2) {
  if (!isFinite(n) || n === 0) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtUSD(n: number) {
  if (!isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtCVD(n: number) {
  if (!isFinite(n)) return "—";
  const s = n >= 0 ? "+" : "";
  if (Math.abs(n) >= 1_000_000) return `${s}${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `${s}${(n / 1_000).toFixed(0)}K`;
  return `${s}${n.toFixed(0)}`;
}
function fmtFunding(r: number) { return `${(r * 100).toFixed(4)}%`; }
function fmtOI(n: number) {
  if (!isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

// ── Skeleton loading components ───────────────────────────────────────────────

function SkeletonBlock({
  className,
  delay = 0,
}: {
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={cn("relative overflow-hidden rounded bg-foreground/[0.06]", className)}
      aria-hidden="true"
    >
      <motion.div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.09) 50%, transparent 100%)",
        }}
        animate={{ x: ["-100%", "200%"] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "linear", delay }}
      />
    </div>
  );
}

function SkeletonTableRow({ index }: { index: number }) {
  const d = (index % 5) * 0.14;
  return (
    <motion.tr
      className="border-b border-border"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
    >
      <td className="px-3 py-3">
        <SkeletonBlock className="h-3 w-16" delay={d} />
      </td>
      <td className="px-3 py-3">
        <SkeletonBlock className="h-3 w-20 ml-auto" delay={d} />
        <SkeletonBlock className="h-2 w-12 ml-auto mt-1.5" delay={d} />
      </td>
      <td className="px-3 py-3">
        <SkeletonBlock className="h-3 w-28" delay={d} />
      </td>
      <td className="px-3 py-3">
        <SkeletonBlock className="h-3 w-10" delay={d} />
        <SkeletonBlock className="h-2 w-16 mt-1" delay={d} />
      </td>
      <td className="px-3 py-3">
        <SkeletonBlock className="h-4 w-12" delay={d} />
        <SkeletonBlock className="h-2 w-10 mt-1" delay={d} />
      </td>
      <td className="px-3 py-3">
        <SkeletonBlock className="h-3 w-14 ml-auto" delay={d} />
      </td>
      <td className="px-3 py-3">
        <SkeletonBlock className="h-3 w-14 ml-auto" delay={d} />
        <SkeletonBlock className="h-2 w-10 ml-auto mt-1" delay={d} />
      </td>
      <td className="px-3 py-3">
        <SkeletonBlock className="h-2 w-14" delay={d} />
        <SkeletonBlock className="h-2 w-12 mt-1" delay={d} />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-[3px] flex-1" delay={d} />
          <SkeletonBlock className="h-2 w-5" delay={d} />
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex gap-1">
          <SkeletonBlock className="h-4 w-12" delay={d} />
          <SkeletonBlock className="h-4 w-14" delay={d + 0.1} />
          <SkeletonBlock className="h-4 w-10" delay={d + 0.2} />
        </div>
      </td>
      <td className="px-3 py-3">
        <SkeletonBlock className="h-5 w-16" delay={d} />
      </td>
    </motion.tr>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DetectionBadge({ d }: { d: InstitutionalDetection }) {
  const meta = DETECTION_META[d.kind] ?? { label: d.kind, color: "text-muted-foreground border-border bg-muted/20" };
  return (
    <span
      className={cn("inline-flex items-center px-1 py-px rounded text-[8px] font-bold border mr-0.5 mb-0.5 tracking-wide", meta.color)}
      title={`${d.kind} · ${Math.round(d.confidence * 100)}%`}
    >
      {meta.label}
    </span>
  );
}

function DirectionBadge({ d }: { d: string }) {
  if (d === "LONG") return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#0ecb81]/12 text-[#0ecb81] border border-[#0ecb81]/20 tracking-wide">
      <TrendingUp size={9} /> BULLISH
    </span>
  );
  if (d === "SHORT") return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#f6465d]/12 text-[#f6465d] border border-[#f6465d]/20 tracking-wide">
      <TrendingDown size={9} /> BEARISH
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-muted text-muted-foreground border border-border tracking-wide">
      <Minus size={9} /> —
    </span>
  );
}

function VwapBadge({ zone }: { zone: string }) {
  const map: Record<string, string> = {
    PREMIUM:     "text-[#f6465d] border-[#f6465d]/20 bg-[#f6465d]/10",
    DISCOUNT:    "text-[#0ecb81] border-[#0ecb81]/20 bg-[#0ecb81]/10",
    EQUILIBRIUM: "text-muted-foreground border-border bg-muted/30",
  };
  return (
    <span className={cn("px-1 py-px rounded text-[8px] font-bold border tracking-wide", map[zone] ?? map.EQUILIBRIUM)}>
      {zone === "EQUILIBRIUM" ? "EQUI" : zone.slice(0, 4)}
    </span>
  );
}

function CVDBar({ cvd }: { cvd: number }) {
  const pct = Math.min(Math.abs(cvd) / 2_000_000 * 100, 100);
  const pos  = cvd >= 0;
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-[3px] rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full transition-all duration-300", pos ? "bg-[#0ecb81]/70" : "bg-[#f6465d]/70")} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-[10px] font-bold font-mono w-[48px] text-right tabular-nums", pos ? "text-[#0ecb81]" : "text-[#f6465d]")}>
        {fmtCVD(cvd)}
      </span>
    </div>
  );
}

function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-[#0ecb81]/80" : score >= 50 ? "bg-yellow-500/80" : score >= 30 ? "bg-orange-500/70" : "bg-muted-foreground/30";
  const text  = score >= 70 ? "text-[#0ecb81]" : score >= 50 ? "text-yellow-600 dark:text-yellow-400" : score >= 30 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground/50";
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 h-[3px] rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full transition-all duration-300", color)} style={{ width: `${score}%` }} />
      </div>
      <span className={cn("text-[10px] font-bold tabular-nums w-5 text-right", text)}>{Math.round(score)}</span>
    </div>
  );
}

// ── Table row ─────────────────────────────────────────────────────────────────

function FlowRow({ item, highlight }: { item: InstitutionalFlow; highlight: boolean }) {
  const fundColor = item.funding_rate > 0.001 ? "text-[#f6465d]" : item.funding_rate < -0.001 ? "text-[#0ecb81]" : "text-muted-foreground";
  const oiColor   = item.oi_delta > 0 ? "text-[#0ecb81]" : item.oi_delta < 0 ? "text-[#f6465d]" : "text-muted-foreground";
  const divColor  = Math.abs(item.spot_futures_div) > 0.05
    ? item.spot_futures_div > 0 ? "text-[#f6465d]" : "text-[#0ecb81]"
    : "text-muted-foreground";
  const imbColor  = item.bid_imbalance > 0.6 ? "text-[#0ecb81]" : item.bid_imbalance < 0.4 ? "text-[#f6465d]" : "text-muted-foreground";

  return (
    <motion.tr
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={cn(
        "border-b border-border hover:bg-muted/40 transition-colors",
        highlight && "bg-primary/5",
      )}
    >
      {/* Symbol */}
      <td className="px-3 py-2.5 min-w-[88px]">
        <span className="text-[12px] font-black text-foreground tracking-tight">
          {item.symbol.replace("USDT", "")}
        </span>
        <span className="text-[9px] text-muted-foreground/60 ml-0.5">USDT</span>
      </td>

      {/* Price / Basis */}
      <td className="px-3 py-2.5 text-right min-w-[110px]">
        <div className="text-[11px] font-bold font-mono text-foreground tabular-nums">
          ${fmt(item.spot_price, item.spot_price > 100 ? 2 : 4)}
        </div>
        {item.futures_price > 0 && (
          <div className={cn("text-[9px] font-bold font-mono tabular-nums", divColor)}>
            {item.spot_futures_div > 0 ? "+" : ""}{item.spot_futures_div.toFixed(3)}%
          </div>
        )}
      </td>

      {/* CVD 5m */}
      <td className="px-3 py-2.5 min-w-[130px]">
        <CVDBar cvd={item.cvd_5m} />
      </td>

      {/* Imbalance */}
      <td className="px-3 py-2.5 min-w-[70px]">
        <div className={cn("text-[11px] font-bold tabular-nums", imbColor)}>
          {Math.round(item.bid_imbalance * 100)}%
        </div>
        <div className="text-[8px] font-bold text-muted-foreground/60 mt-px uppercase tracking-wide">
          {item.bid_imbalance > 0.55 ? "bid-heavy" : item.bid_imbalance < 0.45 ? "ask-heavy" : "balanced"}
        </div>
      </td>

      {/* VWAP */}
      <td className="px-3 py-2.5 min-w-[76px]">
        <VwapBadge zone={item.vwap_zone} />
        <div className={cn("text-[9px] font-bold font-mono tabular-nums mt-0.5", item.vwap_pct > 0 ? "text-[#f6465d]" : "text-[#0ecb81]")}>
          {item.vwap_pct > 0 ? "+" : ""}{item.vwap_pct.toFixed(2)}%
        </div>
      </td>

      {/* Funding */}
      <td className="px-3 py-2.5 text-right min-w-[72px]">
        <span className={cn("text-[10px] font-bold font-mono tabular-nums", fundColor)}>
          {item.funding_rate !== 0 ? fmtFunding(item.funding_rate) : "—"}
        </span>
      </td>

      {/* Open Interest */}
      <td className="px-3 py-2.5 text-right min-w-[90px]">
        <div className="text-[11px] font-bold font-mono text-foreground tabular-nums">{fmtOI(item.open_interest)}</div>
        {item.oi_delta !== 0 && (
          <div className={cn("flex items-center justify-end gap-0.5 text-[9px] font-bold font-mono", oiColor)}>
            {item.oi_delta > 0 ? <ChevronUp size={8} /> : <ChevronDown size={8} />}
            {fmtOI(Math.abs(item.oi_delta))}
          </div>
        )}
      </td>

      {/* Liquidations */}
      <td className="px-3 py-2.5 min-w-[90px]">
        {item.liq_sell_usd > 0 && (
          <div className="text-[9px] font-bold font-mono text-[#f6465d] tabular-nums">L {fmtUSD(item.liq_sell_usd)}</div>
        )}
        {item.liq_buy_usd > 0 && (
          <div className="text-[9px] font-bold font-mono text-[#0ecb81] tabular-nums">S {fmtUSD(item.liq_buy_usd)}</div>
        )}
        {item.liq_sell_usd === 0 && item.liq_buy_usd === 0 && (
          <span className="text-[9px] text-muted-foreground/40">—</span>
        )}
      </td>

      {/* Confidence */}
      <td className="px-3 py-2.5 min-w-[90px]">
        <ConfidenceBar score={item.confidence} />
      </td>

      {/* Active Signals */}
      <td className="px-3 py-2.5 min-w-[140px] max-w-[220px]">
        <div className="flex flex-wrap gap-px">
          {item.detections.slice(0, 5).map((d, i) => <DetectionBadge key={i} d={d} />)}
          {item.detections.length > 5 && (
            <span className="text-[8px] font-bold text-muted-foreground/50 self-center ml-0.5">+{item.detections.length - 5}</span>
          )}
          {item.detections.length === 0 && <span className="text-[9px] text-muted-foreground/40">—</span>}
        </div>
      </td>

      {/* Direction */}
      <td className="px-3 py-2.5">
        <DirectionBadge d={item.direction} />
      </td>
    </motion.tr>
  );
}

// ── How it works modal ────────────────────────────────────────────────────────

const DOCS = [
  {
    color: "#6366f1",
    title: "Cumulative Volume Delta (CVD)",
    items: [
      { label: "What it is", text: "CVD tracks the net difference between buy-initiated and sell-initiated volume over a rolling window (5m / 15m). Positive CVD = buyers dominate; negative = sellers dominate." },
      { label: "Why it matters", text: "Price can move up on low buying pressure (short squeeze) or down on low selling pressure (long liquidation). CVD separates genuine demand from price manipulation." },
      { label: "Divergence", text: "When price makes a new high but CVD falls — institutional sellers are distributing into retail buying. The opposite (price low, CVD rising) signals accumulation." },
    ],
  },
  {
    color: "#0ea5e9",
    title: "VWAP Zones",
    items: [
      { label: "What it is", text: "Volume-Weighted Average Price with ±1 and ±2 standard deviation bands. VWAP resets daily and anchors to the open of each session." },
      { label: "Premium", text: "Price is above VWAP. Retail is paying above fair value. Smart money typically looks to sell into premium zones or wait for a pullback." },
      { label: "Discount", text: "Price is below VWAP. Institutions often accumulate in discount — this is where the best long setups tend to form." },
      { label: "Equilibrium", text: "Price is at or near VWAP. Both sides are fairly valued. Breakouts from equilibrium often signal the start of a directional move." },
    ],
  },
  {
    color: "#0ecb81",
    title: "Order Book Imbalance",
    items: [
      { label: "What it is", text: "The ratio of total bid size to total ask size across the top 20 levels of the order book. Values above 60% = bid-heavy; below 40% = ask-heavy." },
      { label: "Bid-heavy", text: "Strong buy-side depth. Suggests buyers are willing to defend price. Often precedes upward moves, but large bids can also be spoofed (fake orders)." },
      { label: "Ask-heavy", text: "Strong sell-side depth. Sellers are queued aggressively above. Can signal distribution or resistance walls being built before a breakdown." },
    ],
  },
  {
    color: "#f97316",
    title: "Iceberg Orders",
    items: [
      { label: "What it is", text: "Institutional orders too large to display fully — only a fraction appears in the book. When an order is filled but immediately re-appears at the same level, that is an iceberg." },
      { label: "Detection", text: "The scanner detects rapid replenishment events where size disappears and reloads within milliseconds — a signature that only algorithmic smart money order routing exhibits." },
      { label: "Implication", text: "An ICEBERG↑ at a key support level signals a large buyer absorbing sell pressure. ICEBERG↓ signals a large seller distributing at resistance." },
    ],
  },
  {
    color: "#f6465d",
    title: "Spoofing Detection",
    items: [
      { label: "What it is", text: "Spoofers place large orders to create a false impression of supply or demand, then cancel before execution. It's illegal on regulated exchanges but common in crypto." },
      { label: "How detected", text: "A large order (>3× average depth) that vanishes within 2 seconds without being filled is flagged as a spoof. The scanner tracks order placements and cancellations per level." },
      { label: "Trading edge", text: "A SPOOF↑ (fake buy wall) followed by price rejection is a bearish signal. SPOOF↓ (fake sell wall) that disappears on strength is bullish — the wall was deterrent, not real supply." },
    ],
  },
  {
    color: "#a855f7",
    title: "Liquidity Grabs & Stop Hunts",
    items: [
      { label: "Liquidity grab", text: "A fast spike through a key level (equal highs/lows, previous session extremes) that reverses immediately. Smart money hunts stop-loss clusters to fill their own large orders at better prices." },
      { label: "Stop hunt", text: "Specifically targets the most predictable stop-loss placement zones — just below swing lows (stop hunt low) or above swing highs (stop hunt high)." },
      { label: "How to trade", text: "A liquidity grab followed by a strong reclaim of the level is one of the highest-probability reversal setups in institutional trading. Wait for confirmation (CVD divergence, volume spike, imbalance flip)." },
    ],
  },
  {
    color: "#eab308",
    title: "Real vs Fake Breakouts",
    items: [
      { label: "Real breakout", text: "Price clears a key level with increasing volume, expanding CVD in the breakout direction, and the order book imbalance shifts to support continuation. Tagged BRK↑ or BRK↓." },
      { label: "Fake breakout", text: "Price briefly breaches a level but volume is weak or declining, CVD diverges, and the move reverses within 1–3 candles. Tagged FAKE↑ or FAKE↓. Common retail trap." },
      { label: "Key filter", text: "Always check CVD on a breakout. If price breaks up but CVD is flat or falling, institutional sellers are absorbing retail breakout buyers — expect a reversal." },
    ],
  },
  {
    color: "#22c55e",
    title: "Confidence Score & Direction",
    items: [
      { label: "Scoring", text: "Each detection carries a confidence weight (0–1). The final score is the weighted sum of all active signals, normalized to 0–100." },
      { label: "Direction", text: "LONG is assigned when bullish signal weight is ≥1.25× the bearish weight. SHORT is the reverse. Otherwise the instrument shows neutral." },
      { label: "Threshold guide", text: "Score ≥70: high conviction — all key microstructure signals align. 50–69: moderate — directional bias with some conflicting signals. <50: weak — use caution or wait for more data." },
    ],
  },
];

function HowItWorksModal({ onClose }: { onClose: () => void }) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[999] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 24 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-[16px] font-black text-foreground">How Market Flow Works</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">A complete guide to every signal and metric on this page</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-6">
          {DOCS.map((section, si) => (
            <div key={section.title}>
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-black"
                  style={{ background: `${section.color}18`, color: section.color }}
                >
                  {si + 1}
                </div>
                <h3 className="text-[13px] font-black text-foreground">{section.title}</h3>
                <div className="h-px flex-1" style={{ background: `${section.color}25` }} />
              </div>
              <div className="ml-10 space-y-2.5">
                {section.items.map(item => (
                  <div key={item.label} className="flex gap-3">
                    <span
                      className="text-[9px] font-black uppercase tracking-wider shrink-0 mt-0.5 w-[72px] leading-tight"
                      style={{ color: section.color }}
                    >
                      {item.label}
                    </span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-[10px] text-muted-foreground leading-relaxed">
            <span className="font-bold text-foreground">Disclaimer:</span> All data is sourced from Binance WebSocket streams in real time.
            This information is for educational purposes only and does not constitute financial advice.
            Derivatives trading involves significant risk of loss.
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Stat cards ────────────────────────────────────────────────────────────────

function StatsBar({ tracked, highConf, longCount, shortCount, isLoading }: {
  tracked: number; highConf: number; longCount: number; shortCount: number; isLoading?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
      {/* Bullish */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Bullish</span>
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#0ecb81]/12 text-[#0ecb81]">BULLISH</span>
          </div>
          {isLoading
            ? <SkeletonBlock className="h-7 sm:h-9 w-14 mt-1" delay={0} />
            : <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-[#0ecb81]">{longCount}</p>
          }
        </div>
        <svg width="60" height="48" viewBox="0 0 72 56" fill="none" className="shrink-0 hidden sm:block text-[#0ecb81] opacity-80">
          <rect x="4" y="44" width="12" height="12" rx="2" fill="currentColor" fillOpacity="0.2"/>
          <rect x="20" y="32" width="12" height="24" rx="2" fill="currentColor" fillOpacity="0.4"/>
          <rect x="36" y="18" width="12" height="38" rx="2" fill="currentColor" fillOpacity="0.65"/>
          <rect x="52" y="6" width="12" height="50" rx="2" fill="currentColor" fillOpacity="0.9"/>
          <polyline points="10,44 26,32 42,18 58,6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.45"/>
        </svg>
        <div className="absolute bottom-0 left-0 h-[3px] w-full" style={{background:"linear-gradient(90deg,#0ecb8190,transparent)"}}/>
      </div>
      {/* Bearish */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Bearish</span>
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#f6465d]/12 text-[#f6465d]">BEARISH</span>
          </div>
          {isLoading
            ? <SkeletonBlock className="h-7 sm:h-9 w-14 mt-1" delay={0.15} />
            : <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-[#f6465d]">{shortCount}</p>
          }
        </div>
        <svg width="60" height="48" viewBox="0 0 72 56" fill="none" className="shrink-0 hidden sm:block text-[#f6465d] opacity-80">
          <rect x="4" y="4" width="12" height="50" rx="2" fill="currentColor" fillOpacity="0.9"/>
          <rect x="20" y="18" width="12" height="36" rx="2" fill="currentColor" fillOpacity="0.65"/>
          <rect x="36" y="32" width="12" height="22" rx="2" fill="currentColor" fillOpacity="0.4"/>
          <rect x="52" y="44" width="12" height="10" rx="2" fill="currentColor" fillOpacity="0.2"/>
          <polyline points="10,4 26,18 42,32 58,44" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.45"/>
        </svg>
        <div className="absolute bottom-0 left-0 h-[3px] w-full" style={{background:"linear-gradient(90deg,#f6465d90,transparent)"}}/>
      </div>
      {/* High Confidence */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">High Conf</span>
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-yellow-500/12 text-yellow-600 dark:text-yellow-400">≥70</span>
          </div>
          {isLoading
            ? <SkeletonBlock className="h-7 sm:h-9 w-14 mt-1" delay={0.3} />
            : <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-yellow-600 dark:text-yellow-400">{highConf}</p>
          }
        </div>
        <svg width="52" height="52" viewBox="0 0 56 56" fill="none" className="shrink-0 hidden sm:block text-yellow-500 opacity-80">
          <polygon points="28,6 34,22 52,22 38,33 43,50 28,40 13,50 18,33 4,22 22,22" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
          <polygon points="28,14 32,24 43,24 35,31 38,42 28,35 18,42 21,31 13,24 24,24" fill="currentColor" fillOpacity="0.5"/>
        </svg>
        <div className="absolute bottom-0 left-0 h-[3px] w-full" style={{background:"linear-gradient(90deg,#eab30890,transparent)"}}/>
      </div>
      {/* Tracked */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Tracked</span>
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-foreground/10 text-foreground">LIVE</span>
          </div>
          {isLoading
            ? <SkeletonBlock className="h-7 sm:h-9 w-14 mt-1" delay={0.45} />
            : <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-foreground">{tracked}</p>
          }
        </div>
        <svg width="52" height="52" viewBox="0 0 56 56" fill="none" className="shrink-0 hidden sm:block text-foreground opacity-60">
          <circle cx="28" cy="28" r="22" stroke="currentColor" strokeWidth="3" strokeOpacity="0.12"/>
          <circle cx="28" cy="28" r="22" stroke="currentColor" strokeWidth="3" strokeDasharray="100 38" strokeLinecap="round" fill="none" transform="rotate(-90 28 28)"/>
          <circle cx="28" cy="28" r="4" fill="currentColor" fillOpacity="0.55"/>
        </svg>
        <div className="absolute bottom-0 left-0 h-[3px] w-full bg-gradient-to-r from-foreground/40 to-transparent"/>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function InstitutionalTerminal() {
  const [rows, setRows]                 = React.useState<InstitutionalFlow[]>([]);
  const [tracked, setTracked]           = React.useState(0);
  const [error, setError]               = React.useState<string | null>(null);
  const [liveCount, setLiveCount]       = React.useState(0);
  const [connected, setConnected]       = React.useState(false);
  const [newSymbols, setNewSymbols]     = React.useState<Set<string>>(new Set());
  const [filter, setFilter]             = React.useState<"ALL" | "LONG" | "SHORT">("ALL");
  const [minConf, setMinConf]           = React.useState(0);
  const [showInfo, setShowInfo]         = React.useState(false);
  const [isInitialLoad, setIsInitialLoad] = React.useState(true);

  const hasData = rows.length > 0;

  const fetchSnapshot = React.useCallback(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const resp = await fetch(FLOW_URL, { cache: "no-store", signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setRows(data.symbols ?? []);
      setTracked(data.tracked ?? data.count ?? 0);
      setError(null);
      setIsInitialLoad(false);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to load");
      setIsInitialLoad(false);
    } finally {
      clearTimeout(timer);
    }
  }, []);

  React.useEffect(() => { fetchSnapshot(); }, [fetchSnapshot]);

  React.useEffect(() => {
    const id = setInterval(fetchSnapshot, hasData ? 15_000 : 5_000);
    return () => clearInterval(id);
  }, [fetchSnapshot, hasData]);

  React.useEffect(() => {
    let es: EventSource;
    const connect = () => {
      es = new EventSource(STREAM_URL);
      es.addEventListener("open", () => setConnected(true));
      es.addEventListener("error", () => {
        if (es.readyState === EventSource.CLOSED) setConnected(false);
      });
      es.addEventListener("message", (ev) => {
        try {
          const item: InstitutionalFlow = JSON.parse(ev.data);
          if (!item?.symbol) return;
          setLiveCount(c => c + 1);
          setNewSymbols(prev => new Set(prev).add(item.symbol));
          setTimeout(() => setNewSymbols(prev => { const n = new Set(prev); n.delete(item.symbol); return n; }), 2000);
          setRows(prev => {
            const idx = prev.findIndex(r => r.symbol === item.symbol);
            if (idx === -1) return [item, ...prev].sort((a, b) => b.confidence - a.confidence);
            const next = [...prev]; next[idx] = item;
            return next.sort((a, b) => b.confidence - a.confidence);
          });
        } catch (err) { console.warn("[InstitutionalTerminal] SSE parse error", err); }
      });
    };
    connect();
    return () => { es?.close(); setConnected(false); };
  }, []);

  const visible = React.useMemo(() =>
    rows.filter(r => filter === "ALL" || r.direction === filter).filter(r => r.confidence >= minConf),
  [rows, filter, minConf]);

  const highConf   = rows.filter(r => r.confidence >= 70).length;
  const longCount  = rows.filter(r => r.direction === "LONG").length;
  const shortCount = rows.filter(r => r.direction === "SHORT").length;

  const TH  = "px-3 py-2 text-[9px] font-black uppercase tracking-widest text-muted-foreground whitespace-nowrap";
  const THR = "px-3 py-2 text-[9px] font-black uppercase tracking-widest text-muted-foreground whitespace-nowrap text-right";

  return (
    <div className="space-y-3 sm:space-y-5">

      {/* Title Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 sm:gap-4">
        <div>
          <h1 className="text-[14px] sm:text-lg md:text-3xl font-black text-foreground tracking-tighter uppercase leading-tight flex items-center gap-2">
            <Eye className="w-5 h-5 md:w-7 md:h-7" />
            Market Flow
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {liveCount > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground border border-border rounded-lg px-2.5 py-1 bg-card">
              <Zap size={11} className="text-yellow-500" />
              {liveCount} alerts
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <div className={cn("h-2 w-2 rounded-full", connected ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40")} />
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              {connected ? "Live" : "Connecting…"}
            </span>
          </div>
          <button
            onClick={() => setShowInfo(true)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <HelpCircle size={12} />
            <span className="hidden sm:inline">How it works</span>
          </button>
          <button
            onClick={fetchSnapshot}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <StatsBar tracked={tracked || rows.length} highConf={highConf} longCount={longCount} shortCount={shortCount} isLoading={isInitialLoad} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <div className="flex bg-muted rounded-lg p-0.5 border border-border">
          {(["ALL", "LONG", "SHORT"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={cn(
              "px-2.5 py-1 text-[11px] font-bold rounded-md transition-all",
              filter === f ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}>
              {f === "LONG" ? "BULLISH" : f === "SHORT" ? "BEARISH" : "ALL"}
            </button>
          ))}
        </div>

        <div className="flex bg-muted rounded-lg p-0.5 border border-border">
          {[0, 30, 50, 70].map(v => (
            <button key={v} onClick={() => setMinConf(v)} className={cn(
              "px-2.5 py-1 text-[11px] font-bold rounded-md transition-all",
              minConf === v ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}>
              {v === 0 ? "All conf" : `≥${v}`}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden border border-border bg-card">
        {error && (
          <div className="flex items-center gap-2 px-4 py-2.5 text-destructive border-b border-border text-[11px] font-bold">
            <AlertTriangle size={12} /> {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className={cn(TH,  "min-w-[88px]")}>Symbol</th>
                <th className={cn(THR, "min-w-[110px]")}>Price / Basis</th>
                <th className={cn(TH,  "min-w-[130px]")}>CVD 5m</th>
                <th className={cn(TH,  "min-w-[80px]")}>Imbalance</th>
                <th className={cn(TH,  "min-w-[80px]")}>VWAP</th>
                <th className={cn(THR, "min-w-[72px]")}>Funding</th>
                <th className={cn(THR, "min-w-[100px]")}>Open Interest</th>
                <th className={cn(TH,  "min-w-[90px]")}>Liquidations</th>
                <th className={cn(TH,  "min-w-[100px]")}>Confidence</th>
                <th className={cn(TH,  "min-w-[160px]")}>Active Signals</th>
                <th className={cn(TH,  "min-w-[100px]")}>Direction</th>
              </tr>
            </thead>
            <tbody>
              {isInitialLoad && !error ? (
                Array.from({ length: 9 }, (_, i) => <SkeletonTableRow key={i} index={i} />)
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center">
                    <Activity size={36} className="mx-auto mb-3 text-muted-foreground/30" />
                    <p className="text-sm font-bold text-muted-foreground">
                      {rows.length === 0
                        ? tracked > 0 ? `Tracking ${tracked} symbols` : "Pipeline warming up"
                        : "No symbols match current filters"}
                    </p>
                    <p className="text-[11px] text-muted-foreground/60 mt-1">Data arrives within 30 s of pipeline start</p>
                  </td>
                </tr>
              ) : (
                visible.map(item => (
                  <FlowRow key={item.symbol} item={item} highlight={newSymbols.has(item.symbol)} />
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2 border-t border-border flex items-center justify-between">
          <span className="text-[9px] font-bold text-muted-foreground">
            {visible.length} / {rows.length} symbols
          </span>
          <span className="text-[9px] font-bold text-muted-foreground/50">
            Sorted by confidence · live via SSE
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <p className="text-[11px] font-black text-foreground uppercase tracking-widest">Signal Legend</p>
          <span className="text-[10px] text-muted-foreground">what each badge means</span>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {LEGEND_GROUPS.map(group => (
            <div key={group.label} className="rounded-xl border border-border overflow-hidden">
              {/* Group header */}
              <div
                className="px-3 py-1.5 flex items-center gap-2"
                style={{ background: `${group.color}10`, borderBottom: `1px solid ${group.color}20` }}
              >
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: group.color }} />
                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: group.color }}>
                  {group.label}
                </span>
              </div>
              {/* Signals */}
              <div className="divide-y divide-border">
                {group.signals.map(({ kind, meaning }) => {
                  const meta = DETECTION_META[kind];
                  if (!meta) return null;
                  return (
                    <div key={kind} className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/30 transition-colors">
                      <span className={cn(
                        "inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[8px] font-black border tracking-wide shrink-0 min-w-[52px]",
                        meta.color
                      )}>
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground leading-snug">{meaning}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {showInfo && <HowItWorksModal onClose={() => setShowInfo(false)} />}
      </AnimatePresence>

    </div>
  );
}
