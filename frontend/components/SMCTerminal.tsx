"use client";

/**
 * SMCTerminal — Dedicated Smart Money Concepts signal terminal.
 *
 * Displays SMC signals with full SMC terminology:
 *  • Market structure (BULLISH / BEARISH / NEUTRAL)
 *  • Setup types: CHoCH · BOS Retest · Demand/Supply · Liq Sweep · Mitigation
 *  • 7-point confluence grade: BOS/CHoCH · S/D Zone · OB · Disp · FVG · Liq · Mit
 *  • Zone levels (top / bottom / CE), OB levels, FVG
 *  • Premium / Discount context
 *  • Zone freshness (untested = highest quality)
 *  • Inline "How SMC Works" guide (13 concepts)
 */

import * as React from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge }    from "@/components/ui/badge";
import { Button }   from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CoinIcon } from "@/components/CoinIcon";
import {
  TrendingUp, TrendingDown, RefreshCw, BookOpen, X,
  ArrowUpRight, ArrowDownRight, Minus, ChevronLeft, ChevronRight,
  Target, Zap, BarChart2, Layers, GitMerge, Waves, ShieldCheck,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SMCSignal {
  id?: string | number;
  coinId:    string;
  symbol:    string;
  name:      string;
  timeframe: string;
  signalType: "LONG" | "SHORT";
  setupType:  string;
  score:      number;
  currentPrice: number;
  stopLoss:     number;
  takeProfit:   number;
  riskReward:   number;
  timestamp:    number;
  change24h:    number;
  volume24h:    number;
  formula:      string;
  // SMC confluences
  hasBOS:       boolean;
  hasCHoCH:     boolean;
  hasSD:        boolean;
  hasOB:        boolean;
  hasDisplacement: boolean;
  hasFVG:       boolean;
  hasEqualHL:   boolean;
  hasInducement: boolean;
  hasMitigation: boolean;
  // Levels
  entryZoneHigh: number;
  entryZoneLow:  number;
  ceLevel:       number;
  orderBlockTop?:    number;
  orderBlockBottom?: number;
  fvgTop?:           number;
  fvgBottom?:        number;
  sweepHigh?:        number;
  sweepLow?:         number;
  // Metadata
  structureType:  string;
  zoneTests:      number;
  pdContext:      string;
  premiumDiscount: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";
  status:         "IN_ZONE" | "ACTIVE";
  priceInZone:    boolean;
  mlScore:        number;
  confluenceScore: number;
}

interface SMCTerminalProps {
  initialData?: SMCSignal[];
  fetchAction?: (timeframe?: string) => Promise<SMCSignal[]>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE   = 50;
const TIMEFRAMES  = ["all", "5m", "15m", "30m", "1h", "4h", "1d"] as const;

const SETUP_COLORS: Record<string, string> = {
  "CHoCH":         "text-amber-400 bg-amber-400/10 border-amber-400/30",
  "BOS Retest":    "text-blue-400 bg-blue-400/10 border-blue-400/30",
  "Demand Retest": "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  "Supply Retest": "text-rose-400 bg-rose-400/10 border-rose-400/30",
  "Liq Sweep":     "text-purple-400 bg-purple-400/10 border-purple-400/30",
  "Mitigation":    "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
};

const PD_COLORS: Record<string, string> = {
  PREMIUM:     "text-rose-400 bg-rose-400/10",
  DISCOUNT:    "text-emerald-400 bg-emerald-400/10",
  EQUILIBRIUM: "text-muted-foreground bg-muted/50",
};

const STRUCT_COLORS: Record<string, string> = {
  BULLISH: "text-emerald-400",
  BEARISH: "text-rose-400",
  NEUTRAL: "text-muted-foreground",
};

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmt(price: number): string {
  if (!price) return "–";
  if (price >= 10000) return price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (price >= 1000)  return price.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (price >= 1)     return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  if (price >= 0.1)   return price.toFixed(4);
  if (price >= 0.001) return price.toFixed(5);
  return price.toFixed(8);
}

function fmtVol(usd: number): string {
  if (!usd) return "$0";
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${usd.toFixed(0)}`;
}

function signalId(s: SMCSignal): string {
  return `${s.symbol}:${s.timeframe}:${s.signalType}:${s.timestamp}`;
}

function timeAgo(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000)   return `${Math.floor(d / 1000)}s ago`;
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86400_000)return `${Math.floor(d / 3600_000)}h ago`;
  return `${Math.floor(d / 86400_000)}d ago`;
}

// ── SMC Confluence Grade Cell ─────────────────────────────────────────────────

const SMCGradeCell = React.memo(function SMCGradeCell({ s }: { s: SMCSignal }) {
  const checks = [
    { label: "Structure",  active: s.hasBOS || s.hasCHoCH,  detail: s.hasCHoCH ? "CHoCH" : "BOS", color: "text-amber-400"   },
    { label: "S/D Zone",   active: s.hasSD,                  detail: "Supply/Demand",               color: "text-emerald-400" },
    { label: "OB",         active: s.hasOB,                  detail: "Order Block",                 color: "text-blue-400"    },
    { label: "Disp",       active: s.hasDisplacement,        detail: "Displacement",                color: "text-purple-400"  },
    { label: "FVG",        active: s.hasFVG,                 detail: "Fair Value Gap",              color: "text-cyan-400"    },
    { label: "Liq",        active: s.hasEqualHL || s.hasInducement, detail: s.hasEqualHL ? "Equal H/L" : "Inducement", color: "text-orange-400" },
    { label: "Mit",        active: s.hasMitigation,          detail: "Mitigation Block",            color: "text-rose-400"    },
  ];
  const count = checks.filter(c => c.active).length;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex flex-col gap-1 cursor-default">
            <div className="flex gap-0.5 flex-wrap">
              {checks.map((c, i) => (
                <span
                  key={i}
                  className={cn(
                    "inline-flex items-center px-1 py-0.5 rounded text-[8px] font-black tracking-wide border",
                    c.active
                      ? `${c.color} bg-current/10 border-current/20 opacity-100`
                      : "text-muted-foreground/30 bg-muted/20 border-muted/20 opacity-50"
                  )}
                >
                  {c.label}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <div className="flex gap-px">
                {checks.map((c, i) => (
                  <div
                    key={i}
                    className={cn("w-2.5 h-1.5 rounded-sm", c.active ? "bg-primary" : "bg-muted/40")}
                  />
                ))}
              </div>
              <span className="text-[9px] font-bold text-muted-foreground">{count}/7</span>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="bg-popover text-popover-foreground border-border p-3 shadow-xl max-w-[220px] z-50">
          <p className="text-[10px] font-black uppercase tracking-wider mb-2 text-primary">SMC Confluences</p>
          {checks.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5 mb-1">
              <span className={cn("text-[10px]", c.active ? "text-primary" : "text-muted-foreground/40")}>
                {c.active ? "✓" : "–"}
              </span>
              <span className={cn("text-[10px]", c.active ? "text-foreground" : "line-through text-muted-foreground/40")}>
                {c.detail}
              </span>
            </div>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

// ── Signal Row ────────────────────────────────────────────────────────────────

const SMCSignalRow = React.memo(function SMCSignalRow({
  index, signal,
}: { index: number; signal: SMCSignal }) {
  const isLong      = signal.signalType === "LONG";
  const setupColor  = SETUP_COLORS[signal.setupType] ?? "text-muted-foreground bg-muted/20 border-muted/30";
  const scoreColor  = signal.score >= 80
    ? "text-[#0ecb81] border-[#0ecb81]/50 bg-[#0ecb81]/10"
    : signal.score >= 60
    ? "text-orange-400 border-orange-400/50 bg-orange-400/10"
    : "text-muted-foreground border-border bg-muted/50";
  const structColor = STRUCT_COLORS[signal.structureType] ?? "text-muted-foreground";
  const rrBadge     = signal.riskReward >= 3
    ? "text-[#0ecb81] bg-[#0ecb81]/10 border-[#0ecb81]/30"
    : signal.riskReward >= 2
    ? "text-green-500 bg-green-500/10 border-green-500/30"
    : "text-orange-400 bg-orange-400/10 border-orange-400/30";

  const inZone  = signal.priceInZone || signal.status === "IN_ZONE";
  const ezMid   = signal.ceLevel;
  const riskPct = Math.abs(ezMid - signal.stopLoss)   / signal.currentPrice * 100;
  const rewPct  = Math.abs(signal.takeProfit - ezMid) / signal.currentPrice * 100;

  return (
    <TableRow className={cn("h-[44px] sm:h-[52px] hover:bg-muted/30 transition-colors", inZone && "bg-amber-500/5")}>
      {/* Rank */}
      <TableCell className="w-8 text-center text-[11px] text-muted-foreground font-mono">{index + 1}</TableCell>

      {/* Coin */}
      <TableCell className="min-w-0">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <CoinIcon symbol={signal.coinId ?? signal.symbol} size={24} className="w-6 h-6 sm:w-7 sm:h-7 border border-border rounded-full shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] sm:text-[13px] font-black text-foreground leading-none truncate">{signal.symbol.replace(/USDT$/, "")}</p>
            <p className="text-[9px] text-muted-foreground font-medium mt-0.5 hidden sm:block">{signal.name}</p>
          </div>
        </div>
      </TableCell>

      {/* Direction + Setup */}
      <TableCell className="min-w-0">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1 flex-wrap">
            <span className={cn(
              "inline-flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-black border",
              isLong
                ? "text-[#0ecb81] bg-[#0ecb81]/10 border-[#0ecb81]/30"
                : "text-[#f6465d] bg-[#f6465d]/10 border-[#f6465d]/30"
            )}>
              {isLong ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
              {isLong ? "BULL" : "BEAR"}
            </span>
            <span className="inline-flex px-1 py-0 rounded text-[8px] font-mono text-muted-foreground bg-muted/40">
              {signal.timeframe}
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-1">
            <span className={cn("inline-flex px-1.5 py-0.5 rounded text-[9px] font-black border", setupColor)}>
              {signal.setupType}
            </span>
            <span className={cn("text-[8px] font-bold", PD_COLORS[signal.pdContext] ?? "text-muted-foreground")}>
              {signal.pdContext === "DISCOUNT" ? "DISC" : signal.pdContext === "PREMIUM" ? "PREM" : "EQ"}
            </span>
            {signal.zoneTests === 0 && (
              <span className="text-[8px] font-black text-emerald-400 bg-emerald-400/10 px-1 rounded">FRESH</span>
            )}
          </div>
          <p className="text-[9px] text-muted-foreground font-mono hidden sm:block">{timeAgo(signal.timestamp)}</p>
        </div>
      </TableCell>

      {/* Structure */}
      <TableCell className="hidden sm:table-cell w-[90px]">
        <div className="flex flex-col items-start gap-0.5">
          <div className={cn("flex items-center gap-0.5 text-[11px] font-black", structColor)}>
            {signal.structureType === "BULLISH" && <TrendingUp size={10} />}
            {signal.structureType === "BEARISH" && <TrendingDown size={10} />}
            {signal.structureType === "NEUTRAL" && <Minus size={10} />}
            {signal.structureType}
          </div>
          <span className={cn(
            "text-[8px] font-bold px-1 py-0 rounded",
            inZone ? "text-amber-400 bg-amber-400/10" : "text-muted-foreground bg-muted/30"
          )}>
            {inZone ? "IN ZONE" : "ACTIVE"}
          </span>
        </div>
      </TableCell>

      {/* SMC Grade — hidden on mobile */}
      <TableCell className="hidden sm:table-cell w-[170px]">
        <SMCGradeCell s={signal} />
      </TableCell>

      {/* Score */}
      <TableCell className="text-center">
        <div className={cn(
          "inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full text-[12px] sm:text-[13px] font-black border-2",
          scoreColor
        )}>
          {signal.score}
        </div>
      </TableCell>

      {/* Entry Zone */}
      <TableCell className="hidden md:table-cell w-[115px]">
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-default space-y-0.5">
                <p className="text-[11px] font-black text-foreground tabular-nums">{fmt(signal.entryZoneHigh)}</p>
                <div className="h-px bg-border/60 w-full" />
                <p className="text-[11px] font-black text-foreground tabular-nums">{fmt(signal.entryZoneLow)}</p>
                <p className="text-[9px] text-primary font-bold tabular-nums">CE {fmt(signal.ceLevel)}</p>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-popover text-popover-foreground border-border p-3 shadow-xl max-w-[200px] z-50">
              <p className="text-[10px] font-black uppercase tracking-wider mb-2 text-primary">Entry Zone</p>
              <div className="space-y-1 font-mono text-[10px]">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Zone H:</span>
                  <span>{fmt(signal.entryZoneHigh)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Zone L:</span>
                  <span>{fmt(signal.entryZoneLow)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">CE:</span>
                  <span className="text-primary">{fmt(signal.ceLevel)}</span>
                </div>
                {signal.orderBlockTop && (
                  <>
                    <div className="my-1 border-t border-border/50" />
                    <p className="text-[9px] text-blue-400 font-bold">Order Block</p>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">OB H:</span>
                      <span>{fmt(signal.orderBlockTop)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">OB L:</span>
                      <span>{fmt(signal.orderBlockBottom ?? 0)}</span>
                    </div>
                  </>
                )}
                {signal.fvgTop && (
                  <>
                    <div className="my-1 border-t border-border/50" />
                    <p className="text-[9px] text-cyan-400 font-bold">FVG</p>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">FVG H:</span>
                      <span>{fmt(signal.fvgTop)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">FVG L:</span>
                      <span>{fmt(signal.fvgBottom ?? 0)}</span>
                    </div>
                  </>
                )}
                {signal.zoneTests === 0 && (
                  <p className="text-[9px] text-emerald-400 font-bold mt-1">✓ Untested (fresh) zone</p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TableCell>

      {/* Current Price */}
      <TableCell className="text-right">
        <p className="text-[11px] sm:text-[13px] font-black tabular-nums">{fmt(signal.currentPrice)}</p>
        <p className={cn("text-[9px] font-bold tabular-nums", signal.change24h >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]")}>
          {signal.change24h >= 0 ? "+" : ""}{signal.change24h.toFixed(2)}%
        </p>
      </TableCell>

      {/* SL */}
      <TableCell className="hidden lg:table-cell w-[90px] text-right">
        <p className="text-[12px] font-bold text-[#f6465d] tabular-nums">{fmt(signal.stopLoss)}</p>
        <p className="text-[9px] text-muted-foreground/70 tabular-nums">{riskPct.toFixed(2)}%</p>
      </TableCell>

      {/* TP */}
      <TableCell className="hidden lg:table-cell w-[90px] text-right">
        <p className="text-[12px] font-bold text-[#0ecb81] tabular-nums">{fmt(signal.takeProfit)}</p>
        <p className="text-[9px] text-muted-foreground/70 tabular-nums">{rewPct.toFixed(2)}%</p>
      </TableCell>

      {/* R:R */}
      <TableCell className="hidden sm:table-cell w-[72px] text-center">
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-default flex flex-col items-center gap-1">
                <span className={cn("px-1.5 py-0.5 rounded text-[11px] font-black border", rrBadge)}>
                  1:{signal.riskReward}
                </span>
                <div className="flex gap-0.5">
                  <div className="h-2 bg-[#f6465d]/60 rounded-sm" style={{ width: Math.min(riskPct * 3, 20) }} />
                  <div className="h-2 bg-[#0ecb81]/60 rounded-sm" style={{ width: Math.min(rewPct * 3, 52) }} />
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-popover text-popover-foreground border-border p-2 shadow-xl z-50">
              <p className="text-[10px] font-mono">Risk {riskPct.toFixed(2)}% → Reward {rewPct.toFixed(2)}%</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TableCell>

      {/* Volume */}
      <TableCell className="hidden lg:table-cell w-[72px] text-right text-[11px] font-bold text-muted-foreground">
        {fmtVol(signal.volume24h)}
      </TableCell>
    </TableRow>
  );
});

// ── How SMC Works Guide ───────────────────────────────────────────────────────

const SMC_GUIDE = [
  {
    icon: <BarChart2 size={14} />,
    color: "text-blue-400 bg-blue-400/10 border-blue-400/30",
    title: "Market Structure",
    body: "Price moves in fractal swing chains. BULLISH = Higher Highs + Higher Lows (HH/HL). BEARISH = Lower Highs + Lower Lows (LH/LL). Structure identifies trend direction before looking for entries.",
  },
  {
    icon: <ArrowUpRight size={14} />,
    color: "text-blue-400 bg-blue-400/10 border-blue-400/30",
    title: "BOS – Break of Structure",
    body: "Price closes beyond the last swing high (bullish BOS) or swing low (bearish BOS) in the direction of the existing trend. A BOS confirms continuation — look for pullbacks into OBs or FVGs.",
  },
  {
    icon: <GitMerge size={14} />,
    color: "text-amber-400 bg-amber-400/10 border-amber-400/30",
    title: "CHoCH – Change of Character",
    body: "The FIRST structural break AGAINST the current trend. A bearish trend making a CHoCH means bulls closed above the last swing high — the highest-quality reversal signal in SMC. Always confirmed by displacement.",
  },
  {
    icon: <Layers size={14} />,
    color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
    title: "Demand & Supply Zones",
    body: "The origin of an impulse move. Demand zone: tight consolidation (base) just before a strong bullish candle series. Supply zone: base before a strong bearish impulse. Price tends to revisit these zones to fill unfilled orders.",
  },
  {
    icon: <Target size={14} />,
    color: "text-blue-400 bg-blue-400/10 border-blue-400/30",
    title: "Order Blocks (OB)",
    body: "The LAST opposing candle before a displacement impulse. Bullish OB = last bearish candle before bullish push. Bearish OB = last bullish candle before bearish push. This is where institutions entered. Price returning to the OB = high-probability entry.",
  },
  {
    icon: <Zap size={14} />,
    color: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
    title: "Fair Value Gap (FVG)",
    body: "A 3-candle price imbalance where the middle candle moved so fast it left a gap between candle[i-1].high and candle[i+1].low (bullish FVG). Price tends to return to fill this gap. FVG within an OB = precision entry confluence.",
  },
  {
    icon: <Waves size={14} />,
    color: "text-purple-400 bg-purple-400/10 border-purple-400/30",
    title: "Equal Highs & Equal Lows (Liquidity)",
    body: "When two or more swing highs/lows align at the same price level (within 0.15%), retail stop orders cluster there. Smart money sweeps this liquidity pool before reversing. A sweep of equal lows before a bullish entry is confirmation.",
  },
  {
    icon: <ArrowDownRight size={14} />,
    color: "text-orange-400 bg-orange-400/10 border-orange-400/30",
    title: "Inducement (IDM)",
    body: "A minor swing level swept just BEFORE the main structural move. Smart money induces retail into one direction, hunts their stops, then reverses. IDM before a CHoCH greatly increases setup quality.",
  },
  {
    icon: <ShieldCheck size={14} />,
    color: "text-rose-400 bg-rose-400/10 border-rose-400/30",
    title: "Mitigation Blocks",
    body: "An old supply zone that was broken bullish (or demand zone broken bearish). When price returns to test it from the new direction, the old zone acts as support/resistance from the opposite side — this is the mitigation block.",
  },
  {
    icon: <BarChart2 size={14} />,
    color: "text-green-400 bg-green-400/10 border-green-400/30",
    title: "Premium vs Discount",
    body: "The 50% midpoint of the recent 40-bar range is equilibrium. DISCOUNT = below midpoint (value buys). PREMIUM = above midpoint (value sells). ICT principle: buy in discount, sell in premium. Discount LONG and Premium SHORT signals score higher.",
  },
  {
    icon: <Zap size={14} />,
    color: "text-teal-400 bg-teal-400/10 border-teal-400/30",
    title: "Displacement",
    body: "A strong impulsive candle (body ≥ 65% of range, size ≥ 1.2× ATR) that breaks away from the zone. Displacement is institutional intent made visible. No displacement = no high-probability SMC entry.",
  },
  {
    icon: <Target size={14} />,
    color: "text-primary bg-primary/10 border-primary/30",
    title: "Zone Freshness",
    body: "An UNTESTED (fresh) zone is the highest quality — no prior touches means full order flow remains. Each retest removes some of the resting orders. Fresh zones are marked with a green FRESH badge.",
  },
  {
    icon: <TrendingUp size={14} />,
    color: "text-primary bg-primary/10 border-primary/30",
    title: "How to Trade SMC Setups",
    body: "1) Confirm structure (CHoCH for reversal, BOS for continuation). 2) Identify the zone (Demand/Supply or OB). 3) Wait for price to return to zone. 4) Enter at CE (50% of zone) or OB/FVG within zone. 5) SL below zone low (longs) or above zone high (shorts). 6) TP at next liquidity pool or structure level.",
  },
] as const;

// ── Stats Header ──────────────────────────────────────────────────────────────

function StatsHeader({ signals }: { signals: SMCSignal[] }) {
  const longs      = signals.filter(s => s.signalType === "LONG").length;
  const shorts     = signals.filter(s => s.signalType === "SHORT").length;
  const inZone     = signals.filter(s => s.priceInZone).length;
  const highGrade  = signals.filter(s => s.score >= 80).length;
  const chochCount = signals.filter(s => s.hasCHoCH).length;
  const bosCount   = signals.filter(s => s.hasBOS).length;
  const obCount    = signals.filter(s => s.hasOB).length;
  const fvgCount   = signals.filter(s => s.hasFVG).length;

  const stats = [
    { label: "BULLISH", sublabel: "Long",    value: longs,     color: "#0ecb81" },
    { label: "BEARISH", sublabel: "Short",   value: shorts,    color: "#f6465d" },
    { label: "IN ZONE", sublabel: "Active",  value: inZone,    color: "#f59e0b" },
    { label: "GRADE",   sublabel: "80+",     value: highGrade, color: "#a855f7" },
  ];

  const StatSVG = ({ idx, color }: { idx: number; color: string }) => {
    if (idx === 0) return (
      <svg width="60" height="48" viewBox="0 0 72 56" fill="none" style={{color}}>
        <rect x="4" y="44" width="12" height="12" rx="2" fill="currentColor" fillOpacity="0.2"/>
        <rect x="20" y="32" width="12" height="24" rx="2" fill="currentColor" fillOpacity="0.4"/>
        <rect x="36" y="18" width="12" height="38" rx="2" fill="currentColor" fillOpacity="0.65"/>
        <rect x="52" y="6" width="12" height="50" rx="2" fill="currentColor" fillOpacity="0.9"/>
        <polyline points="10,44 26,32 42,18 58,6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.45"/>
        <path d="M54 2L62 2L62 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <line x1="54" y1="10" x2="62" y2="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    );
    if (idx === 1) return (
      <svg width="60" height="48" viewBox="0 0 72 56" fill="none" style={{color}}>
        <rect x="4" y="4" width="12" height="50" rx="2" fill="currentColor" fillOpacity="0.9"/>
        <rect x="20" y="18" width="12" height="36" rx="2" fill="currentColor" fillOpacity="0.65"/>
        <rect x="36" y="32" width="12" height="22" rx="2" fill="currentColor" fillOpacity="0.4"/>
        <rect x="52" y="44" width="12" height="10" rx="2" fill="currentColor" fillOpacity="0.2"/>
        <polyline points="10,4 26,18 42,32 58,44" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.45"/>
        <path d="M54 54L62 54L62 46" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <line x1="54" y1="46" x2="62" y2="54" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    );
    if (idx === 2) return (
      <svg width="52" height="52" viewBox="0 0 56 56" fill="none" style={{color}}>
        <circle cx="28" cy="28" r="24" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" fill="none"/>
        <circle cx="28" cy="28" r="16" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" fill="none"/>
        <circle cx="28" cy="28" r="8" stroke="currentColor" strokeWidth="2" strokeOpacity="0.7" fill="none"/>
        <circle cx="28" cy="28" r="3" fill="currentColor"/>
        <line x1="28" y1="2" x2="28" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
        <line x1="28" y1="46" x2="28" y2="54" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
        <line x1="2" y1="28" x2="10" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
        <line x1="46" y1="28" x2="54" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
      </svg>
    );
    return (
      <svg width="52" height="52" viewBox="0 0 56 56" fill="none" style={{color}}>
        <circle cx="28" cy="28" r="22" stroke="currentColor" strokeWidth="3" strokeOpacity="0.12" fill="none"/>
        <circle cx="28" cy="28" r="22" stroke="currentColor" strokeWidth="3" strokeDasharray="100 38" strokeLinecap="round" fill="none" transform="rotate(-90 28 28)"/>
        <circle cx="28" cy="28" r="13" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.18" fill="none"/>
        <circle cx="28" cy="28" r="4" fill="currentColor" fillOpacity="0.6"/>
        <line x1="28" y1="6" x2="28" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
        <line x1="50" y1="28" x2="44" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
        <line x1="6" y1="28" x2="12" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
      </svg>
    );
  };

  return (
    <div className="space-y-3 mb-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map(({ label, sublabel, value, color }, idx) => (
          <div key={label} className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1 mb-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded" style={{background:`${color}18`, color}}>{sublabel}</span>
              </div>
              <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none" style={{color}}>{value}</p>
            </div>
            <div className="shrink-0 hidden sm:block opacity-80"><StatSVG idx={idx} color={color} /></div>
            <div className="absolute bottom-0 left-0 h-[3px] w-full" style={{background:`linear-gradient(90deg,${color}90,transparent)`}}/>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[
          { label: "CHoCH",        count: chochCount, color: "text-amber-400 bg-amber-400/10" },
          { label: "BOS",          count: bosCount,   color: "text-blue-400 bg-blue-400/10" },
          { label: "Order Block",  count: obCount,    color: "text-blue-400 bg-blue-400/10" },
          { label: "FVG",          count: fvgCount,   color: "text-cyan-400 bg-cyan-400/10" },
        ].map(({ label, count, color }) => (
          <span key={label} className={cn("px-2 py-0.5 rounded text-[10px] font-bold", color)}>
            {label} <span className="font-black">{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Table header helper ───────────────────────────────────────────────────────

function Th({ title, tip }: { title: string; tip: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
            {title}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="bg-popover text-popover-foreground border-border p-2 shadow-lg z-50 max-w-[200px] text-[11px]">
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Main SMCTerminal ──────────────────────────────────────────────────────────

export default function SMCTerminal({ initialData = [], fetchAction }: SMCTerminalProps) {
  const [signals,    setSignals]    = React.useState<SMCSignal[]>(initialData);
  const [timeframe,  setTimeframe]  = React.useState("all");
  const [loading,    setLoading]    = React.useState(initialData.length === 0);
  const [refreshing, setRefreshing] = React.useState(false);
  const [showGuide,  setShowGuide]  = React.useState(false);
  const [filterDir,  setFilterDir]  = React.useState<"all" | "LONG" | "SHORT">("all");
  const [filterSetup,setFilterSetup]= React.useState("all");
  const [sortBy,     setSortBy]     = React.useState<"time" | "score" | "volume">("time");
  const [page,       setPage]       = React.useState(0);
  const deferredSearch = React.useDeferredValue("");
  const knownIds       = React.useRef<Set<string>>(new Set());

  const load = React.useCallback(async (tf: string, isRefresh = false) => {
    if (!fetchAction) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const data = await fetchAction(tf);
      setSignals(prev => {
        const merged = [...data];
        const newIds = new Set(merged.map(signalId));
        knownIds.current = newIds;
        return merged;
      });
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [fetchAction]);

  React.useEffect(() => {
    if (initialData.length === 0) load("all");
  }, [load, initialData.length]);

  React.useEffect(() => {
    const id = setInterval(() => load(timeframe, true), 30_000);
    return () => clearInterval(id);
  }, [load, timeframe]);

  const handleTimeframe = (tf: string) => {
    setTimeframe(tf); setPage(0); load(tf);
  };

  const setupTypes = React.useMemo(() => {
    const s = new Set(signals.map(s => s.setupType));
    return ["all", ...Array.from(s)];
  }, [signals]);

  const filtered = React.useMemo(() => {
    let list = timeframe === "all" ? signals : signals.filter(s => s.timeframe === timeframe);
    if (filterDir !== "all")   list = list.filter(s => s.signalType === filterDir);
    if (filterSetup !== "all") list = list.filter(s => s.setupType  === filterSetup);
    if (sortBy === "score")  return [...list].sort((a, b) => b.score    - a.score);
    if (sortBy === "volume") return [...list].sort((a, b) => b.volume24h - a.volume24h);
    return [...list].sort((a, b) => b.timestamp - a.timestamp);
  }, [signals, timeframe, filterDir, filterSetup, sortBy]);

  const pages      = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSlice  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const safePage   = Math.min(page, pages - 1);
  React.useEffect(() => { if (safePage !== page) setPage(safePage); }, [safePage, page]);

  const PILL = (label: string, active: boolean, onClick: () => void, color?: string) => (
    <button
      key={label}
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded text-[11px] font-bold transition-all",
        active
          ? color ?? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-2 sm:gap-4">
      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[14px] sm:text-[22px] font-black tracking-tight leading-none text-foreground">
            SMC <span className="text-primary">SCANNER</span>
          </h1>
          <p className="text-[9px] sm:text-[11px] text-muted-foreground mt-1 font-medium">
            Smart Money Concepts · Structure · OB · FVG · Supply & Demand · Liquidity
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGuide(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-teal-400 bg-teal-400/10 border border-teal-400/20 hover:bg-teal-400/15 transition-colors"
          >
            <BookOpen size={13} /> SMC Guide
          </button>
          <button
            onClick={() => load(timeframe, true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-muted-foreground bg-muted/40 border border-border hover:text-foreground hover:bg-muted/70 transition-colors"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── SMC Guide Modal ── */}
      {showGuide && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-3xl max-h-[88vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-lg font-black text-foreground">How SMC Works</h2>
                <p className="text-[11px] text-muted-foreground">Smart Money Concepts — complete trading guide</p>
              </div>
              <button onClick={() => setShowGuide(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {SMC_GUIDE.map((item, i) => (
                <div key={i} className="flex gap-3 p-3 rounded-xl border border-border/50 bg-muted/20">
                  <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border", item.color)}>
                    {item.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[9px] font-black text-muted-foreground/60">{String(i + 1).padStart(2, "0")}</span>
                      <p className="text-[12px] font-black text-foreground">{item.title}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Stats ── */}
      {!loading && signals.length > 0 && <StatsHeader signals={signals} />}

      {/* ── Timeframe Tabs ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="overflow-x-auto no-scrollbar">
        <div className="flex bg-muted/50 rounded-lg p-0.5 gap-0.5">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => handleTimeframe(tf)}
              className={cn(
                "px-3 py-1.5 rounded-md text-[11px] font-bold transition-all",
                timeframe === tf
                  ? "bg-background text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono ml-1">
          {filtered.length} setup{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Filter Pills ── */}
      <div className="flex flex-wrap gap-1 items-center">
        <div className="overflow-x-auto no-scrollbar">
        <div className="flex bg-muted/40 rounded-lg p-0.5 gap-px w-max">
          {PILL("ALL",   filterDir === "all",   () => setFilterDir("all"))}
          {PILL("BULLISH", filterDir === "LONG",  () => setFilterDir("LONG"),  "bg-[#0ecb81]/15 text-[#0ecb81]")}
          {PILL("BEARISH", filterDir === "SHORT", () => setFilterDir("SHORT"), "bg-[#f6465d]/15 text-[#f6465d]")}
        </div>
        </div>
        <div className="overflow-x-auto no-scrollbar">
        <div className="flex bg-muted/40 rounded-lg p-0.5 gap-px w-max">
          {setupTypes.slice(0, 8).map(t =>
            PILL(t === "all" ? "ALL SETUPS" : t, filterSetup === t, () => setFilterSetup(t))
          )}
        </div>
        </div>
        <div className="flex bg-muted/40 rounded-lg p-0.5 gap-px ml-0 sm:ml-auto">
          {PILL("Time",   sortBy === "time",   () => setSortBy("time"))}
          {PILL("Score",  sortBy === "score",  () => setSortBy("score"))}
          {PILL("Volume", sortBy === "volume", () => setSortBy("volume"))}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="gecko-card rounded-xl overflow-hidden border border-border">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 sm:py-24 text-muted-foreground">
            <Target size={40} className="mb-3 opacity-20" />
            <p className="text-[13px] font-bold">No SMC setups found</p>
            <p className="text-[11px] mt-1 opacity-60">Try a different timeframe or wait for the next scan cycle</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border h-9">
                  <TableHead className="w-8 text-center">#</TableHead>
                  <TableHead><Th title="Coin" tip="Symbol and name" /></TableHead>
                  <TableHead><Th title="Direction · Setup" tip="Signal direction and SMC setup type" /></TableHead>
                  <TableHead className="hidden sm:table-cell"><Th title="Structure" tip="Market structure: HH/HL = BULLISH, LH/LL = BEARISH" /></TableHead>
                  <TableHead className="hidden sm:table-cell"><Th title="SMC Grade" tip="7-point confluence: Structure · S/D · OB · Disp · FVG · Liq · Mitigation" /></TableHead>
                  <TableHead className="text-center"><Th title="Score" tip="Combined quality score (0–100)" /></TableHead>
                  <TableHead className="hidden md:table-cell"><Th title="Entry Zone" tip="Supply/Demand zone top/bottom with CE midpoint. Hover for OB and FVG levels." /></TableHead>
                  <TableHead className="text-right"><Th title="Price" tip="Current price and 24h change" /></TableHead>
                  <TableHead className="hidden lg:table-cell text-right"><Th title="Stop Loss" tip="Stop loss below zone low (longs) or above zone high (shorts)" /></TableHead>
                  <TableHead className="hidden lg:table-cell text-right"><Th title="Take Profit" tip="Take profit at next liquidity or structure level" /></TableHead>
                  <TableHead className="hidden sm:table-cell text-center"><Th title="R:R" tip="Risk to reward ratio" /></TableHead>
                  <TableHead className="hidden lg:table-cell text-right"><Th title="Vol 24h" tip="24-hour USDT volume" /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageSlice.map((signal, i) => (
                  <SMCSignalRow key={signalId(signal)} index={page * PAGE_SIZE + i} signal={signal} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* ── Pagination ── */}
      {pages > 1 && (
        <div className="flex flex-wrap items-center justify-between text-[11px] text-muted-foreground px-1 gap-2">
          <span>{filtered.length} setups · page {page + 1}/{pages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
              <ChevronLeft size={13} />
            </Button>
            <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>
              <ChevronRight size={13} />
            </Button>
          </div>
        </div>
      )}

      {/* ── SMC Concept Quick Reference ── */}
      <div className="gecko-card rounded-xl border border-border p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">SMC Quick Reference</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { label: "CHoCH",       desc: "Trend reversal signal. First structural break against the trend.",     color: "text-amber-400"   },
            { label: "BOS Retest",  desc: "Trend continuation. Pull back into OB/FVG after a BOS.",               color: "text-blue-400"    },
            { label: "Demand",      desc: "Fresh demand zone. Base → strong bullish impulse.",                    color: "text-emerald-400" },
            { label: "Supply",      desc: "Fresh supply zone. Base → strong bearish impulse.",                   color: "text-rose-400"    },
            { label: "Liq Sweep",   desc: "Equal H/L taken out. Smart money hunted stops before reversing.",     color: "text-purple-400"  },
            { label: "Mitigation",  desc: "Old OB retested from flipped polarity (support → resistance, etc.).", color: "text-cyan-400"    },
          ].map(({ label, desc, color }) => (
            <div key={label} className="p-2 rounded-lg bg-muted/20 border border-border/40">
              <p className={cn("text-[10px] font-black mb-1", color)}>{label}</p>
              <p className="text-[9px] text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
