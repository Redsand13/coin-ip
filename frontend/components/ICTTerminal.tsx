"use client";

import * as React from "react";
import { useState, useEffect, useCallback, memo, useRef, useMemo, useDeferredValue } from "react";
import { pushAlerts, AlertsButton } from "@/components/SignalAlerts";
import {
  TrendingUp, TrendingDown, RefreshCw, Target, Zap, AlertTriangle,
  HelpCircle, BookOpen, X, ChevronRight, ArrowDown, ArrowUp, Layers,
  ShieldAlert, CheckCircle2, Clock, BarChart2, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CoinIcon, symbolToCoinId } from "@/components/CoinIcon";
import { SignalAge } from "@/components/SignalAge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ICTSignal, KillZoneName, PremiumDiscount } from "@/lib/types/signals";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(price: number): string {
  if (price === 0) return "—";
  if (price < 0.001) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  if (price < 100) return price.toFixed(4);
  return price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmtVol(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
  return `$${usd.toFixed(0)}`;
}

const KZ_COLORS: Record<KillZoneName, string> = {
  LONDON: "text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-400/10",
  NEW_YORK: "text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-400/10",
  ASIA: "text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-400/10",
  LONDON_CLOSE: "text-cyan-700 dark:text-cyan-300 bg-cyan-100 dark:bg-cyan-400/10",
};

const KZ_LABELS: Record<KillZoneName, string> = {
  LONDON: "LDN",
  NEW_YORK: "NYC",
  ASIA: "ASIA",
  LONDON_CLOSE: "LDN-CL",
};

const PD_COLORS: Record<PremiumDiscount, string> = {
  PREMIUM: "text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-400/10",
  DISCOUNT: "text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-400/10",
  EQUILIBRIUM: "text-foreground/60 bg-muted/50",
};

const PD_LABELS: Record<PremiumDiscount, string> = {
  PREMIUM: "PREM",
  DISCOUNT: "DISC",
  EQUILIBRIUM: "EQ",
};

const HeaderTip = ({ title, tip, right }: { title: string; tip: string; right?: boolean }) => (
  <div className={cn("flex items-center gap-1.5", right && "justify-end")}>
    <span>{title}</span>
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle size={11} className="text-muted-foreground/50 hover:text-primary cursor-help" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] text-xs z-50 p-3 bg-popover text-popover-foreground shadow-xl border-border">
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
);

// ─── ICT Concept Badge ────────────────────────────────────────────────────────

const ICTBadge = ({ label, active, color }: { label: string; active: boolean; color: string }) => (
  active ? (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black tracking-wide", color)}>
      {label}
    </span>
  ) : null
);

// ─── How It Works Modal ───────────────────────────────────────────────────────

function HowItWorksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  const concepts = [
    {
      num: 1, color: "bg-primary/15 text-primary", icon: <Layers size={14} className="text-primary" />,
      title: "Market Structure",
      content: (
        <div className="space-y-2">
          <p>The scanner establishes trend by identifying pivot highs and lows.</p>
          <div className="flex gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-[#0ecb81]/10 rounded-lg px-3 py-2 text-[11px]">
              <TrendingUp size={13} className="text-[#0ecb81]" />
              <span className="font-bold text-[#0ecb81]">BULLISH</span>
              <span className="text-muted-foreground">= HH + HL</span>
            </div>
            <div className="flex items-center gap-2 bg-[#f6465d]/10 rounded-lg px-3 py-2 text-[11px]">
              <TrendingDown size={13} className="text-[#f6465d]" />
              <span className="font-bold text-[#f6465d]">BEARISH</span>
              <span className="text-muted-foreground">= LH + LL</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      num: 2, color: "bg-purple-500/15 text-purple-400", icon: <Activity size={14} className="text-purple-400" />,
      title: "CHoCH — Change of Character",
      content: (
        <p>A CHoCH occurs when the liquidity sweep <strong className="text-foreground">reverses the prior trend</strong>. Example: prior structure was bearish (LH+LL), but price then sweeps the equal lows and rallies — this is a CHoCH, signalling a potential trend flip. CHoCH signals often lead to the biggest moves because they catch the most traders off-side.</p>
      ),
    },
    {
      num: 3, color: "bg-blue-500/15 text-blue-400", icon: <BarChart2 size={14} className="text-blue-400" />,
      title: "BOS — Break of Structure",
      content: (
        <p>After the sweep, a BOS is confirmed when a candle closes <strong className="text-foreground">beyond the most recent swing high (LONG) or swing low (SHORT)</strong>. BOS confirms the new direction is gaining momentum and the reversal is likely real — not just a temporary wick.</p>
      ),
    },
    {
      num: 4, color: "bg-primary/15 text-primary", icon: <Target size={14} className="text-primary" />,
      title: "Liquidity Sweep",
      content: (
        <div className="space-y-2">
          <p>A sweep = wick <strong className="text-foreground">past a key level</strong>, close back inside. This takes out stop-loss orders, then reverses.</p>
          <div className="space-y-1.5">
            <div className="flex items-start gap-2 bg-[#0ecb81]/5 border border-[#0ecb81]/20 rounded-lg p-2 text-[11px]">
              <ArrowUp size={13} className="text-[#0ecb81] mt-0.5 shrink-0" />
              <span><span className="font-bold text-[#0ecb81]">Bullish Sweep</span> — wick below equal lows / session low, closes back above → LONG setup</span>
            </div>
            <div className="flex items-start gap-2 bg-[#f6465d]/5 border border-[#f6465d]/20 rounded-lg p-2 text-[11px]">
              <ArrowDown size={13} className="text-[#f6465d] mt-0.5 shrink-0" />
              <span><span className="font-bold text-[#f6465d]">Bearish Sweep</span> — wick above equal highs / session high, closes back below → SHORT setup</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      num: 5, color: "bg-orange-500/15 text-orange-400", icon: <Zap size={14} className="text-orange-400" />,
      title: "Displacement",
      content: (
        <p>Displacement = <strong className="text-foreground">2+ consecutive large-body candles</strong> (body &gt; 55% of range) moving away from the sweep in the trade direction. This confirms that institutional flow is driving price, not just random noise. Setups with displacement have significantly higher follow-through probability.</p>
      ),
    },
    {
      num: 6, color: "bg-yellow-500/15 text-yellow-400", icon: <AlertTriangle size={14} className="text-yellow-400" />,
      title: "Inducement (IDM)",
      content: (
        <p>Inducement = a minor swing point swept <strong className="text-foreground">3–15 candles before the main sweep</strong>. Institutions first bait retail traders into trades in the wrong direction (sweeping a minor low/high), then execute the real move by sweeping the major level. IDM presence = setup is well-engineered.</p>
      ),
    },
    {
      num: 7, color: "bg-primary/15 text-primary", icon: <Layers size={14} className="text-primary" />,
      title: "FVG & Order Block (Entry Zone)",
      content: (
        <div className="space-y-2">
          <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-1">
            <p className="font-bold text-foreground text-[11px]">Fair Value Gap (FVG)</p>
            <p>3-candle imbalance: candle 1 high &lt; candle 3 low (bullish) or candle 1 low &gt; candle 3 high (bearish). Price tends to return to fill the gap.</p>
          </div>
          <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-1">
            <p className="font-bold text-foreground text-[11px]">Order Block (OB)</p>
            <p>Last opposing candle before the impulse. Body only — where institutions placed orders. Strongest when the next candle closes strongly beyond the OB.</p>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 text-[11px] text-amber-400 font-medium">
            FVG+OB confluence = highest-probability setup. Both identify the same zone from different angles.
          </div>
        </div>
      ),
    },
    {
      num: 8, color: "bg-red-500/15 text-red-400", icon: <Activity size={14} className="text-red-400" />,
      title: "Breaker Block",
      content: (
        <p>A Breaker is a <strong className="text-foreground">failed Order Block that flipped its role</strong>. A bearish OB that was previously swept below (price broke its low) — when price now returns above it, that old OB becomes support. Breaker Blocks often represent the highest-probability entries because they mark exactly where the most trapped traders are sitting.</p>
      ),
    },
    {
      num: 9, color: "bg-green-500/15 text-green-400", icon: <BarChart2 size={14} className="text-green-400" />,
      title: "Premium / Discount (Dealing Range)",
      content: (
        <div className="space-y-2">
          <p>The dealing range is the span between the most recent swing high and swing low. ICT teaches: <strong className="text-foreground">buy in discount, sell in premium</strong>.</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "PREMIUM", desc: "Above 61.8% of range. Ideal for SHORTs.", color: "text-[#f6465d]" },
              { label: "EQUILIBRIUM", desc: "40–62% range. Neutral zone.", color: "text-muted-foreground" },
              { label: "DISCOUNT", desc: "Below 38.2% of range. Ideal for LONGs.", color: "text-[#0ecb81]" },
            ].map(item => (
              <div key={item.label} className="bg-muted/30 border border-border rounded-lg p-2 text-center">
                <p className={cn("font-black text-[10px]", item.color)}>{item.label}</p>
                <p className="text-[9px] text-muted-foreground mt-0.5">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      num: 10, color: "bg-cyan-500/15 text-cyan-400", icon: <Target size={14} className="text-cyan-400" />,
      title: "OTE — Optimal Trade Entry",
      content: (
        <p>OTE is the <strong className="text-foreground">61.8%–78.6% Fibonacci retracement</strong> of the dealing range. ICT teaches that the highest-probability entry point is within this range — deep enough in discount/premium to have a tight SL, but not so deep it suggests a full reversal. When the entry zone overlaps with the OTE zone, the setup grades as elite.</p>
      ),
    },
    {
      num: 11, color: "bg-blue-500/15 text-blue-400", icon: <Clock size={14} className="text-blue-400" />,
      title: "Kill Zones (Session Windows)",
      content: (
        <div className="space-y-2">
          <p>ICT kill zones are the time windows where institutional order flow is highest. Setups that form inside a kill zone are far more likely to deliver fast, clean moves.</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { kz: "LONDON", time: "02:00–05:00 UTC", note: "Highest liquidity — major FX opens" },
              { kz: "NEW YORK", time: "12:00–15:00 UTC", note: "News + equity open confluence" },
              { kz: "ASIA", time: "20:00–01:00 UTC", note: "Range-setting for London" },
              { kz: "LDN CLOSE", time: "15:00–16:00 UTC", note: "Institutional position squaring" },
            ].map(item => (
              <div key={item.kz} className="bg-muted/30 border border-border rounded-lg p-2">
                <p className="font-bold text-foreground text-[10px]">{item.kz}</p>
                <p className="text-[9px] text-primary font-mono">{item.time}</p>
                <p className="text-[9px] text-muted-foreground mt-0.5">{item.note}</p>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      num: 12, color: "bg-amber-500/15 text-amber-400", icon: <AlertTriangle size={14} className="text-amber-400" />,
      title: "CE & OTE Within Zone — Your Entry (ACTION REQUIRED)",
      content: (
        <div className="rounded-xl border-2 border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <p className="font-bold text-amber-400 text-[13px]">When status = IN ZONE:</p>
          <ol className="space-y-1.5">
            {[
              "Open TradingView and locate the signal's symbol",
              "Verify price is inside the Entry Zone (High / Low column)",
              "The CE level (50% of zone) is the most magnetic price — watch it",
              "If the OTE zone overlaps your entry zone, those levels have extra gravity",
              "Wait for a rejection candle: bullish engulfing / large wick from zone for LONG; bearish engulfing for SHORT",
              "Enter on rejection candle close or next candle open",
              "SL: use the value in the SL column (0.2% beyond the sweep wick)",
              "TP: use the TP column (nearest opposing liquidity)",
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <ChevronRight size={12} className="text-amber-500 mt-0.5 shrink-0" />
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      ),
    },
    {
      num: 13, color: "bg-[#f6465d]/15 text-[#f6465d]", icon: <X size={14} className="text-[#f6465d]" />,
      title: "Setup Invalidation",
      content: (
        <div className="space-y-2">
          <p className="text-[12px] text-muted-foreground">A setup expires if price does not return to the entry zone within the timeframe-adjusted window (1–3 candles). Also manually invalidate if:</p>
          <ul className="space-y-1">
            {[
              "Price closes beyond the sweep wick before reaching the zone",
              "The FVG / OB is completely closed (traded through with force)",
              "Market structure breaks against your trade direction",
              "A counter-sweep of the opposite level occurs",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <X size={11} className="text-[#f6465d] mt-0.5 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ),
    },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border bg-card/95 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <BookOpen size={18} className="text-primary" />
            </div>
            <div>
              <h2 className="font-black text-[16px] tracking-tight">Complete ICT / SMC Strategy Guide</h2>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wide">
                All 13 ICT concepts — how they work together
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <p className="text-[13px] font-semibold leading-relaxed">
              This scanner implements the <span className="text-primary font-bold">complete ICT methodology</span>: market structure → CHoCH / BOS → liquidity sweep → displacement → inducement → FVG / OB / Breaker → CE / OTE → Premium/Discount → Kill Zones → R:R. Each setup is scored on how many of these concepts align.
            </p>
          </div>

          {concepts.map(c => (
            <section key={c.num} className="space-y-3">
              <div className="flex items-center gap-2">
                <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black", c.color)}>{c.num}</div>
                <h3 className="font-black text-[14px] flex items-center gap-2">{c.icon}{c.title}</h3>
              </div>
              <div className="pl-8 text-[12px] text-muted-foreground">{c.content}</div>
            </section>
          ))}

          <section className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
            <p className="font-bold text-[13px] flex items-center gap-2">
              <CheckCircle2 size={14} className="text-primary" /> ICT Signal Score
            </p>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {[
                ["Base", "30 pts"],
                ["FVG", "+12 pts"],
                ["OB", "+12 pts"],
                ["FVG+OB confluence", "+6 pts"],
                ["Breaker Block", "+10 pts"],
                ["Fresh sweep (≤1 candle)", "+12–15 pts"],
                ["BOS confirmed", "+8 pts"],
                ["CHoCH detected", "+10 pts"],
                ["Displacement", "+8 pts"],
                ["Inducement (IDM)", "+6 pts"],
                ["P/D aligned", "+8 pts"],
                ["Kill Zone active", "+5 pts"],
                ["Price in zone", "+8 pts"],
                ["R:R ≥ 3", "+4–6 pts"],
              ].map(([label, pts]) => (
                <div key={label} className="flex justify-between bg-muted/40 rounded px-2 py-1">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-bold text-primary">{pts}</span>
                </div>
              ))}
            </div>
          </section>

          <p className="text-[10px] text-muted-foreground/60 border-t border-border pt-4">
            Automated pattern scanner only. Always verify on your own chart before entering any trade. Past patterns do not guarantee future results. Trade at your own risk.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── ICT Grade Column ─────────────────────────────────────────────────────────

const ICTGradeCell = memo(({ signal }: { signal: ICTSignal }) => (
  <div className="flex flex-col gap-1.5 min-w-[120px]">
    <div className="flex flex-wrap gap-1">
      <ICTBadge label="CHoCH" active={signal.choch} color="text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-400/10" />
      <ICTBadge label="BOS" active={signal.bos} color="text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-400/10" />
      <ICTBadge label="DISP" active={signal.displacement} color="text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-400/10" />
      <ICTBadge label="IDM" active={signal.hasInducement} color="text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-400/10" />
      {signal.killZone && (
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black", KZ_COLORS[signal.killZone])}>
          {KZ_LABELS[signal.killZone]}
        </span>
      )}
    </div>
    <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wide">
      {signal.liquidityType.replace(/_/g, " ")}
    </span>
  </div>
));
ICTGradeCell.displayName = "ICTGradeCell";

// ─── Constants (outside component to avoid re-creation) ───────────────────────

const MAX_SIGNALS   = 300;
const PAGE_SIZE     = 50;
const MIN_ICT_GRADE = 4;   // minimum confirmed confluences to display
const ALL_TFS       = ["5m", "15m", "30m", "1h", "4h", "1d"] as const;

function signalId(s: ICTSignal): string {
  return `${s.coinId}::${s.signalType}::${s.timeframe}::${s.sweepTimestamp}`;
}

/** 6-point ICT grade — matches the badge bar in ICTSignalRow. */
function computeGrade(s: ICTSignal): number {
  const oteOverlap = s.oteZone
    ? s.entryZoneLow <= s.oteZone.high && s.entryZoneHigh >= s.oteZone.low
    : false;
  return [
    s.hasSweep,
    s.displacement,
    s.hasOB || s.hasFVG,
    s.bos    || s.choch,
    !!s.killZone,
    s.hasInducement,
    oteOverlap,
  ].filter(Boolean).length;
}

// ─── Signal Row ───────────────────────────────────────────────────────────────

const ICTSignalRow = memo(({ signal, index }: { signal: ICTSignal; index: number }) => {
  const isLong = signal.signalType === "LONG";
  const isInZone = signal.status === "IN_ZONE";

  const detectedTime = new Date(signal.timestamp).toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  const priceVsZone = (() => {
    if (signal.priceInZone) return { label: "IN ZONE", cls: "text-amber-400" };
    if (isLong && signal.currentPrice > signal.entryZoneHigh) return { label: "ABOVE", cls: "text-blue-400" };
    if (!isLong && signal.currentPrice < signal.entryZoneLow) return { label: "BELOW", cls: "text-blue-400" };
    return { label: "NEAR", cls: "text-muted-foreground" };
  })();

  const entryMid = signal.ceLevel;
  const riskPct = entryMid > 0 ? Math.abs(entryMid - signal.stopLoss) / entryMid * 100 : 0;
  const rewardPct = entryMid > 0 ? Math.abs(signal.takeProfit - entryMid) / entryMid * 100 : 0;

  // OTE overlap with entry zone
  const oteOverlap = signal.oteZone
    ? signal.entryZoneLow <= signal.oteZone.high && signal.entryZoneHigh >= signal.oteZone.low
    : false;

  // Confluence count
  const confluences = [signal.choch, signal.bos, signal.displacement, signal.hasInducement, !!signal.killZone, oteOverlap].filter(Boolean).length;

  return (
    <TableRow className={cn("gecko-table-row group transition-colors", isInZone && "bg-amber-500/5")}>
      {/* # */}
      <TableCell className="w-10 text-center text-muted-foreground text-[11px] font-bold">{index + 1}</TableCell>

      {/* Coin */}
      <TableCell className="min-w-0">
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-muted flex-shrink-0 flex items-center justify-center overflow-hidden border border-border group-hover:border-primary/50 transition-colors">
            <CoinIcon symbol={signal.coinId ?? symbolToCoinId(signal.symbol)} size={28} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-[10px] sm:text-[13px] text-foreground group-hover:text-primary transition-colors truncate">{signal.symbol}</span>
            <span className="text-[9px] text-muted-foreground font-medium hidden sm:block">{signal.name}</span>
          </div>
        </div>
      </TableCell>

      {/* Direction / Setup / Timeframe */}
      <TableCell className="min-w-0">
        <div className="flex flex-col gap-0.5 sm:gap-1">
          <div className="flex items-center gap-1 flex-wrap">
            <Badge className={cn(
              "font-bold text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 uppercase border-0 shadow-sm",
              isLong
                ? "bg-green-100 dark:bg-[#0ecb81]/15 text-green-700 dark:text-[#0ecb81]"
                : "bg-red-100 dark:bg-[#f6465d]/15 text-red-700 dark:text-[#f6465d]",
            )}>
              {isLong ? "BULL" : "BEAR"}
            </Badge>
            <span className="text-[9px] font-black text-muted-foreground bg-muted px-1 sm:px-1.5 py-0.5 rounded border border-border">
              {signal.timeframe.toUpperCase()}
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
            <Badge className={cn(
              "font-bold text-[9px] px-1.5 py-0 border-0",
              (signal.hasFVG && signal.hasOB) || signal.isBreaker
                ? "bg-amber-500/15 text-amber-400"
                : "bg-primary/10 text-primary",
            )}>
              {signal.setupType}
            </Badge>
            <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", PD_COLORS[signal.premiumDiscount])}>
              {PD_LABELS[signal.premiumDiscount]}
            </span>
            {signal.killZone && (
              <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1", KZ_COLORS[signal.killZone])}>
                <Clock size={8} />
                {KZ_LABELS[signal.killZone]}
              </span>
            )}
          </div>
          <span className="hidden sm:block text-[9px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded w-fit" suppressHydrationWarning>
            {detectedTime}
          </span>
        </div>
      </TableCell>

      {/* ICT Grade — hidden on mobile */}
      <TableCell className="hidden sm:table-cell">
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-help">
                <ICTGradeCell signal={signal} />
                {confluences > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    <div className="flex gap-0.5">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className={cn("w-1.5 h-1.5 rounded-full", i < confluences ? "bg-primary" : "bg-muted")} />
                      ))}
                    </div>
                    <span className="text-[9px] text-muted-foreground">{confluences}/6</span>
                  </div>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent className="bg-popover text-popover-foreground border-border p-3 shadow-xl max-w-[260px] z-50 space-y-1.5 text-xs">
              <p className="font-bold text-foreground">ICT Confluences</p>
              {[
                { label: "CHoCH (Change of Character)", active: signal.choch },
                { label: `BOS @ $${fmt(signal.bosLevel)}`, active: signal.bos },
                { label: "Displacement (2+ strong candles)", active: signal.displacement },
                { label: "Inducement (IDM) before sweep", active: signal.hasInducement },
                { label: signal.killZone ? `Kill Zone: ${signal.killZone}` : "Kill Zone", active: !!signal.killZone },
                { label: "Entry zone overlaps OTE fib", active: oteOverlap },
              ].map(({ label, active }) => (
                <div key={label} className={cn("flex items-center gap-2", active ? "text-foreground" : "text-muted-foreground/30 line-through")}>
                  <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", active ? "bg-foreground" : "bg-muted")} />
                  {label}
                </div>
              ))}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TableCell>

      {/* Status */}
      <TableCell className="hidden md:table-cell">
        <div className="flex flex-col gap-1">
          <Badge className={cn(
            "font-bold text-[9px] px-2 py-0.5 uppercase border-0 w-fit",
            isInZone
              ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400"
              : "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400",
          )}>
            {isInZone ? "IN ZONE" : "ACTIVE"}
          </Badge>
          <SignalAge ts={signal.timestamp} className="text-[10px] text-muted-foreground font-bold" />
        </div>
      </TableCell>

      {/* Score */}
      <TableCell>
        <div className={cn(
          "w-9 h-9 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-bold text-[12px] sm:text-[15px] border-2",
          signal.score >= 80 ? "bg-green-50 dark:bg-[#0ecb81]/5 text-green-700 dark:text-[#0ecb81] border-green-300 dark:border-[#0ecb81]/20"
            : signal.score >= 60 ? "bg-orange-50 dark:bg-orange-500/5 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-500/20"
            : "bg-muted/50 text-muted-foreground border-border",
        )}>
          {signal.score}
        </div>
      </TableCell>

      {/* Entry Zone + CE */}
      <TableCell className="hidden md:table-cell">
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col items-end gap-0.5 cursor-help">
                <span className="text-[11px] font-bold text-foreground tabular-nums">${fmt(signal.entryZoneHigh)}</span>
                <span className="text-[9px] text-muted-foreground">—</span>
                <span className="text-[11px] font-bold text-foreground tabular-nums">${fmt(signal.entryZoneLow)}</span>
                <div className="flex items-center gap-1">
                  <span className="text-[8px] text-muted-foreground/60">CE</span>
                  <span className="text-[9px] font-bold text-primary tabular-nums">${fmt(signal.ceLevel)}</span>
                </div>
                <span className={cn("text-[9px] font-bold", priceVsZone.cls)}>{priceVsZone.label}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent className="bg-popover text-popover-foreground border-border p-3 shadow-xl max-w-[220px] z-50 space-y-2 text-xs">
              <p className="font-bold text-foreground">Entry Zone Details</p>
              <div className="space-y-1 font-mono text-[11px]">
                <p>Zone High: <span className="text-foreground">${fmt(signal.entryZoneHigh)}</span></p>
                <p>Zone Low: <span className="text-foreground">${fmt(signal.entryZoneLow)}</span></p>
                <p className="text-primary">CE (50%): ${fmt(signal.ceLevel)}</p>
                {signal.oteZone && (
                  <>
                    <div className="border-t border-border pt-1 mt-1">
                      <p className="text-muted-foreground">OTE Zone (61.8–78.6% fib):</p>
                      <p>High: <span className="text-cyan-400">${fmt(signal.oteZone.high)}</span></p>
                      <p>Low: <span className="text-cyan-400">${fmt(signal.oteZone.low)}</span></p>
                      <p>Optimal: <span className="text-cyan-400 font-bold">${fmt(signal.oteZone.optimal)}</span></p>
                    </div>
                    {oteOverlap && <p className="text-amber-400 font-bold">✓ Entry zone overlaps OTE</p>}
                  </>
                )}
                {signal.dealingRangeHigh > 0 && (
                  <div className="border-t border-border pt-1 mt-1 text-muted-foreground">
                    <p>Dealing Range:</p>
                    <p>${fmt(signal.dealingRangeLow)} — ${fmt(signal.dealingRangeHigh)}</p>
                  </div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TableCell>

      {/* Current Price */}
      <TableCell className="text-right">
        <span className="text-[13px] font-bold text-foreground tabular-nums">${fmt(signal.currentPrice)}</span>
      </TableCell>

      {/* SL */}
      <TableCell className="hidden lg:table-cell text-right">
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[12px] font-bold text-red-600 dark:text-[#f6465d] tabular-nums">${fmt(signal.stopLoss)}</span>
          <span className="text-[9px] font-bold text-red-500 dark:text-[#f6465d]/70 tabular-nums">−{riskPct.toFixed(2)}%</span>
        </div>
      </TableCell>

      {/* TP */}
      <TableCell className="hidden lg:table-cell text-right">
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[12px] font-bold text-green-600 dark:text-[#0ecb81] tabular-nums">${fmt(signal.takeProfit)}</span>
          <span className="text-[9px] font-bold text-green-500 dark:text-[#0ecb81]/70 tabular-nums">+{rewardPct.toFixed(2)}%</span>
        </div>
      </TableCell>

      {/* R:R */}
      <TableCell className="hidden sm:table-cell text-right">
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col items-end gap-1 cursor-help">
                <div className={cn(
                  "inline-flex items-center justify-center px-2 h-6 rounded-md font-black text-[11px] border",
                  signal.riskReward >= 4 ? "bg-green-50 dark:bg-[#0ecb81]/10 text-green-700 dark:text-[#0ecb81] border-green-300 dark:border-[#0ecb81]/20"
                    : signal.riskReward >= 3 ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/20"
                    : "bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/20",
                )}>
                  1:{signal.riskReward}
                </div>
                <div className="flex items-center gap-0.5 h-2">
                  <div className="h-2 rounded-l-full bg-red-400 dark:bg-[#f6465d]/60" style={{ width: `${Math.min(riskPct * 3, 24)}px`, minWidth: "4px" }} />
                  <div className="h-2 rounded-r-full bg-green-400 dark:bg-[#0ecb81]/60" style={{ width: `${Math.min(rewardPct * 3, 72)}px`, minWidth: "4px" }} />
                </div>
                <div className="flex items-center gap-2 text-[9px] font-bold tabular-nums">
                  <span className="text-red-600 dark:text-[#f6465d]/80">−{riskPct.toFixed(1)}%</span>
                  <span className="text-muted-foreground/40">/</span>
                  <span className="text-green-600 dark:text-[#0ecb81]/80">+{rewardPct.toFixed(1)}%</span>
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent className="bg-popover text-popover-foreground border-border p-3 shadow-xl max-w-[280px] z-50">
              <div className="space-y-1.5 text-xs font-mono">
                <p className="text-[#f6465d]">Risk:   −{riskPct.toFixed(3)}% to SL</p>
                <p className="text-[#0ecb81]">Reward: +{rewardPct.toFixed(3)}% to TP</p>
                <p className="text-muted-foreground border-t border-border pt-1 mt-1 font-sans text-[10px] break-words">{signal.formula}</p>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TableCell>

      {/* Vol 24h */}
      <TableCell className="hidden lg:table-cell text-right">
        <span className="text-[12px] font-bold tabular-nums">{fmtVol(signal.volume24h)}</span>
      </TableCell>
    </TableRow>
  );
});
ICTSignalRow.displayName = "ICTSignalRow";

// ─── Stats Header ─────────────────────────────────────────────────────────────

const StatsHeader = memo(({ signals }: { signals: ICTSignal[] }) => {
  const longs = signals.filter(s => s.signalType === "LONG").length;
  const shorts = signals.filter(s => s.signalType === "SHORT").length;
  const inZone = signals.filter(s => s.priceInZone).length;
  const highGrade = signals.filter(s => s.score >= 80).length;

  const chochCount = signals.filter(s => s.choch).length;
  const bosCount = signals.filter(s => s.bos).length;
  const dispCount = signals.filter(s => s.displacement).length;
  const idmCount = signals.filter(s => s.hasInducement).length;
  const kzCount = signals.filter(s => s.killZone).length;
  const breakerCount = signals.filter(s => s.isBreaker).length;

  return (
    <div className="space-y-3 mb-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {/* Bullish */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Bullish</span>
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#0ecb81]/12 text-[#0ecb81]">LONG</span>
            </div>
            <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-[#0ecb81]">{longs}</p>
          </div>
          <svg width="60" height="48" viewBox="0 0 72 56" fill="none" className="shrink-0 hidden sm:block text-[#0ecb81] opacity-75">
            <rect x="4" y="44" width="12" height="12" rx="2" fill="currentColor" fillOpacity="0.2"/>
            <rect x="20" y="32" width="12" height="24" rx="2" fill="currentColor" fillOpacity="0.4"/>
            <rect x="36" y="18" width="12" height="38" rx="2" fill="currentColor" fillOpacity="0.65"/>
            <rect x="52" y="6" width="12" height="50" rx="2" fill="currentColor" fillOpacity="0.9"/>
            <polyline points="10,44 26,32 42,18 58,6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.45"/>
            <path d="M54 2L62 2L62 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="54" y1="10" x2="62" y2="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <div className="absolute bottom-0 left-0 h-[3px] w-full" style={{background:"linear-gradient(90deg,#0ecb8190,transparent)"}}/>
        </div>
        {/* Bearish */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Bearish</span>
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#f6465d]/12 text-[#f6465d]">SHORT</span>
            </div>
            <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-[#f6465d]">{shorts}</p>
          </div>
          <svg width="60" height="48" viewBox="0 0 72 56" fill="none" className="shrink-0 hidden sm:block text-[#f6465d] opacity-75">
            <rect x="4" y="4" width="12" height="50" rx="2" fill="currentColor" fillOpacity="0.9"/>
            <rect x="20" y="18" width="12" height="36" rx="2" fill="currentColor" fillOpacity="0.65"/>
            <rect x="36" y="32" width="12" height="22" rx="2" fill="currentColor" fillOpacity="0.4"/>
            <rect x="52" y="44" width="12" height="10" rx="2" fill="currentColor" fillOpacity="0.2"/>
            <polyline points="10,4 26,18 42,32 58,44" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.45"/>
            <path d="M54 54L62 54L62 46" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="54" y1="46" x2="62" y2="54" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <div className="absolute bottom-0 left-0 h-[3px] w-full" style={{background:"linear-gradient(90deg,#f6465d90,transparent)"}}/>
        </div>
        {/* In Zone */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">In Zone</span>
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500/12 text-amber-500">NOW</span>
            </div>
            <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-amber-500 dark:text-amber-400">{inZone}</p>
          </div>
          <svg width="52" height="52" viewBox="0 0 56 56" fill="none" className="shrink-0 hidden sm:block text-amber-500 opacity-80">
            <circle cx="28" cy="28" r="24" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" fill="none"/>
            <circle cx="28" cy="28" r="16" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" fill="none"/>
            <circle cx="28" cy="28" r="8" stroke="currentColor" strokeWidth="2" strokeOpacity="0.7" fill="none"/>
            <circle cx="28" cy="28" r="3" fill="currentColor"/>
            <line x1="28" y1="2" x2="28" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
            <line x1="28" y1="46" x2="28" y2="54" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
            <line x1="2" y1="28" x2="10" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
            <line x1="46" y1="28" x2="54" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
          </svg>
          <div className="absolute bottom-0 left-0 h-[3px] w-full" style={{background:"linear-gradient(90deg,#f59e0b90,transparent)"}}/>
        </div>
        {/* Score 80+ */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Score</span>
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-foreground/10 text-foreground">TOP</span>
            </div>
            <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-foreground">{highGrade}</p>
          </div>
          <svg width="52" height="52" viewBox="0 0 56 56" fill="none" className="shrink-0 hidden sm:block text-foreground opacity-70">
            <circle cx="28" cy="28" r="22" stroke="currentColor" strokeWidth="3" strokeOpacity="0.12" fill="none"/>
            <circle cx="28" cy="28" r="22" stroke="currentColor" strokeWidth="3" strokeDasharray="100 38" strokeLinecap="round" fill="none" transform="rotate(-90 28 28)"/>
            <circle cx="28" cy="28" r="13" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.18" fill="none"/>
            <circle cx="28" cy="28" r="4" fill="currentColor" fillOpacity="0.55"/>
            <line x1="28" y1="6" x2="28" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
            <line x1="50" y1="28" x2="44" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
            <line x1="6" y1="28" x2="12" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
          </svg>
          <div className="absolute bottom-0 left-0 h-[3px] w-full bg-gradient-to-r from-foreground/40 to-transparent"/>
        </div>
      </div>

      {/* ICT confluence bar */}
      {signals.length > 0 && (
        <div className="gecko-card p-3 border border-border bg-card/50 rounded-xl">
          <p className="text-[10px] font-black uppercase text-muted-foreground mb-2">ICT Confluence Distribution</p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "CHoCH",       count: chochCount,   color: "text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-400/10" },
              { label: "BOS",         count: bosCount,     color: "text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-400/10" },
              { label: "Displacement",count: dispCount,    color: "text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-400/10" },
              { label: "Inducement",  count: idmCount,     color: "text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-400/10" },
              { label: "Kill Zone",   count: kzCount,      color: "text-cyan-700 dark:text-cyan-300 bg-cyan-100 dark:bg-cyan-400/10" },
              { label: "Breaker",     count: breakerCount, color: "text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-400/10" },
            ].map(item => (
              <div key={item.label} className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold", item.color)}>
                <span>{item.count}</span>
                <span className="opacity-70">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
StatsHeader.displayName = "StatsHeader";

// ─── Main Terminal ─────────────────────────────────────────────────────────────

type FilterType = "ALL" | "CONFIRMED" | "LONG" | "SHORT" | "IN_ZONE" | "HIGH_GRADE" | "KILL_ZONE";

interface ICTTerminalProps {
  initialData?: ICTSignal[];
  fetchAction?: (timeframe?: string) => Promise<ICTSignal[]>;
  title?: string;
  subtitle?: string;
  mode?: "ict" | "smc";
}

export default function ICTTerminal({ initialData = [], fetchAction, title, subtitle, mode = "ict" }: ICTTerminalProps) {
  const isSMC = mode === "smc";
  const [signals, setSignals] = useState<ICTSignal[]>(initialData);
  const [loading, setLoading] = useState(initialData.length === 0 && !!fetchAction);
  const [refreshing, setRefreshing] = useState(false);
  const [timeframe, setTimeframe] = useState("all");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("CONFIRMED");
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useState(1);

  const knownIdsRef   = useRef<Set<string>>(new Set());
  const suppressCount = useRef(ALL_TFS.length);
  const refreshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const deferredSearch = useDeferredValue(search);

  const refresh = useCallback(async (tf: string, manual = false) => {
    if (!fetchAction) return;
    if (manual) setRefreshing(true);
    try {
      const data = await fetchAction(tf);
      if (!Array.isArray(data)) return;

      if (suppressCount.current > 0) {
        data.forEach(s => knownIdsRef.current.add(signalId(s)));
        suppressCount.current--;
      } else {
        const newSignals = data.filter(s => !knownIdsRef.current.has(signalId(s)));
        data.forEach(s => {
          knownIdsRef.current.add(signalId(s));
          if (knownIdsRef.current.size > 2000) {
            const arr = [...knownIdsRef.current];
            knownIdsRef.current = new Set(arr.slice(arr.length - 1000));
          }
        });
        if (newSignals.length > 0) {
          pushAlerts(isSMC ? "SMC" : "ICT / SMC", newSignals.map(s => ({
            symbol: s.symbol, name: s.name, image: s.image,
            signalType: s.signalType, timeframe: s.timeframe,
            score: s.score, setupType: s.setupType,
          })));
        }
      }

      // Replace this TF's signals, keep other TFs, dedupe by DB id, sort by score desc
      setSignals(prev => {
        const others = prev.filter(s => s.timeframe !== tf);
        const seenIds = new Set(data.map(s => s.id));
        const merged = [...data, ...others.filter(s => !seenIds.has(s.id))];
        return merged
          .sort((a, b) => b.score - a.score || b.sweepTimestamp - a.sweepTimestamp)
          .slice(0, MAX_SIGNALS);
      });
    } catch {
      // silent
    } finally {
      setLoading(false);
      if (manual) setRefreshing(false);
    }
  }, [fetchAction]);

  // Single fetch for all timeframes at once — one HTTP call instead of 6
  useEffect(() => {
    let cancelled = false;
    const scanAll = () => { if (!cancelled) refresh("all"); };
    scanAll();
    const interval = setInterval(scanAll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      refreshTimers.current.forEach(clearTimeout);
      refreshTimers.current = [];
    };
  }, [refresh]);

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    refreshTimers.current.forEach(clearTimeout);
    refreshTimers.current = [];
    await refresh("all");
    setRefreshing(false);
  }, [refresh]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [deferredSearch, timeframe, filterType]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return signals.filter(s => {
      if (timeframe !== "all" && s.timeframe !== timeframe) return false;
      if (filterType === "CONFIRMED"  && computeGrade(s) < MIN_ICT_GRADE) return false;
      if (filterType === "LONG"       && s.signalType !== "LONG")         return false;
      if (filterType === "SHORT"      && s.signalType !== "SHORT")        return false;
      if (filterType === "IN_ZONE"    && !s.priceInZone)                  return false;
      if (filterType === "HIGH_GRADE" && s.score < 80)                    return false;
      if (filterType === "KILL_ZONE"  && !s.killZone)                     return false;
      if (!q) return true;
      return s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
    });
  }, [signals, deferredSearch, timeframe, filterType]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageItems  = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  const FILTERS: { key: FilterType; label: string; tip?: string }[] = [
    { key: "CONFIRMED", label: `CONFIRMED ≥${MIN_ICT_GRADE}`, tip: `ICT grade ${MIN_ICT_GRADE}+ out of 7` },
    { key: "ALL",       label: "ALL SIGNALS" },
    { key: "LONG",      label: "BULLISH" },
    { key: "SHORT",     label: "BEARISH" },
    { key: "IN_ZONE",   label: "IN ZONE" },
    { key: "HIGH_GRADE", label: "SCORE 80+" },
    { key: "KILL_ZONE", label: "KILL ZONE" },
  ];

  return (
    <>
      <HowItWorksModal open={showModal} onClose={() => setShowModal(false)} />

      <div className="space-y-3 sm:space-y-5">
        {/* Title bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 sm:gap-4">
          <div>
            <h1 className="text-[14px] sm:text-lg md:text-3xl font-black text-foreground tracking-tighter uppercase leading-tight">
              {title ?? (isSMC ? "SMC SCANNER" : "ICT SCANNER")}
            </h1>
            {(subtitle || !title) && (
              <p className="text-[9px] sm:text-[10px] md:text-[12px] font-bold text-foreground/60 uppercase opacity-80">
                {subtitle ?? (isSMC
                  ? "Smart Money Concepts · Supply/Demand · BOS/CHoCH · Liquidity · Structure"
                  : "Inner Circle Trader · Kill Zones · OTE · AMD · Order Blocks · Displacement"
                )}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="overflow-x-auto no-scrollbar">
            <div className="flex bg-muted rounded-lg p-1 border border-border">
              {["all", "5m", "15m", "30m", "1h", "4h", "1d"].map(tf => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={cn(
                    "px-3 py-1 text-[11px] font-bold rounded-md transition-all whitespace-nowrap",
                    timeframe === tf ? "bg-background text-foreground font-black shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tf.toUpperCase()}
                </button>
              ))}
            </div>
            </div>

            <Button variant="outline" size="sm" onClick={() => setShowModal(true)} className="h-8 gap-2 text-[11px] font-bold">
              <BookOpen size={13} />
              <span className="hidden sm:inline">{isSMC ? "SMC Guide" : "ICT Guide"}</span>
            </Button>

            <div className="flex items-center gap-2">
              {refreshing ? (
                <><div className="h-2 w-2 rounded-full bg-primary animate-pulse" /><span className="text-[11px] text-muted-foreground font-medium hidden sm:inline">Updating...</span></>
              ) : (
                <><div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" /><span className="text-[11px] text-muted-foreground font-medium hidden sm:inline">Live · 30s</span></>
              )}
            </div>

            <Button variant="outline" size="sm" onClick={handleManualRefresh} disabled={refreshing} className="h-8">
              <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
            </Button>

            <AlertsButton page={isSMC ? "SMC" : "ICT / SMC"} />
          </div>
        </div>

        {/* Stats */}
        <StatsHeader signals={filtered} />

        {/* Strategy legend */}
        <div className="hidden sm:block gecko-card rounded-xl p-4 border border-border bg-card/50">
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] sm:text-[11px] font-bold text-muted-foreground">
            <span className="flex items-center gap-1.5"><TrendingUp size={12} className="text-[#0ecb81]" />LONG = bullish structure + sweep of lows</span>
            <span className="flex items-center gap-1.5"><TrendingDown size={12} className="text-[#f6465d]" />SHORT = bearish structure + sweep of highs</span>
            <span className="flex items-center gap-1.5"><AlertTriangle size={12} className="text-amber-500" />IN ZONE = price inside FVG/OB — watch for rejection candle</span>
            <span className="flex items-center gap-1.5 text-purple-700 dark:text-purple-300">CHoCH = prior structure reversed</span>
            <span className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300">BOS = structure confirmed</span>
            <span className="flex items-center gap-1.5 text-orange-700 dark:text-orange-300">DISP = displacement present</span>
            <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 text-primary hover:underline">
              <BookOpen size={12} />Full ICT guide →
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div className="overflow-x-auto no-scrollbar">
          <div className="flex bg-muted rounded-lg p-1 border border-border gap-0.5 w-max">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilterType(f.key)}
                title={f.tip}
                className={cn(
                  "px-3 py-1 text-[11px] font-bold rounded-md transition-all whitespace-nowrap",
                  filterType === f.key
                    ? f.key === "CONFIRMED"
                      ? "bg-foreground text-background shadow-sm"
                      : "bg-background text-foreground border border-border shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          </div>

          <div className="relative flex-1 max-w-full sm:max-w-sm">
            <input
              type="text"
              placeholder="Search symbol..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-3 rounded-lg border border-border bg-background text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <Target size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>

          <span className="text-[11px] text-muted-foreground font-medium">
            {filtered.length} setup{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Table */}
        <div className="gecko-card rounded-xl overflow-hidden border border-border">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 sm:p-12 text-center">
              <Target size={40} className="mx-auto mb-4 text-muted-foreground/30" />
              <p className="text-sm font-bold text-muted-foreground">
                No confirmed ICT setups{timeframe !== "all" ? ` on ${timeframe.toUpperCase()}` : ""}
                {filterType === "CONFIRMED" ? ` with grade ≥ ${MIN_ICT_GRADE}/6` : filterType !== "ALL" ? ` matching "${FILTERS.find(f => f.key === filterType)?.label}"` : ""}
              </p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                Only showing confirmed setups: Sweep + Displacement + Entry Zone + Structure confirmed (≥{MIN_ICT_GRADE}/6 confluences)
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="gecko-table-header">
                      <TableHead className="w-10 text-center text-[10px] font-black uppercase">#</TableHead>
                      <TableHead className="text-[10px] font-black uppercase">Coin</TableHead>
                      <TableHead className="text-[10px] font-black uppercase">
                        <HeaderTip title="Signal" tip="Direction (LONG/SHORT), setup type, timeframe, P/D position, and active kill zone." />
                      </TableHead>
                      <TableHead className="hidden sm:table-cell text-[10px] font-black uppercase">
                        <HeaderTip title={isSMC ? "SMC Grade" : "ICT Grade"} tip={isSMC ? "Confirmed SMC confluences: BOS, CHoCH, Supply/Demand zone, Displacement, FVG, Equal H/L, Mitigation. Bar shows how many of 6 are active." : "Confirmed ICT confluences: CHoCH, BOS, Displacement, Inducement, Kill Zone. Hover for detail. Bar shows how many of 6 are active."} />
                      </TableHead>
                      <TableHead className="hidden md:table-cell text-[10px] font-black uppercase">Status</TableHead>
                      <TableHead className="text-[10px] font-black uppercase">Score</TableHead>
                      <TableHead className="hidden md:table-cell text-right text-[10px] font-black uppercase">
                        <HeaderTip title="Entry Zone" tip="FVG/OB/Breaker range. CE = 50% (Consequent Encroachment — most magnetic). Hover for OTE fib zone and dealing range." right />
                      </TableHead>
                      <TableHead className="text-right text-[10px] font-black uppercase">Price</TableHead>
                      <TableHead className="hidden lg:table-cell text-right text-[10px] font-black uppercase">
                        <HeaderTip title="SL / Risk%" tip="Stop Loss beyond sweep wick (0.2%). % is distance from zone midpoint to SL." right />
                      </TableHead>
                      <TableHead className="hidden lg:table-cell text-right text-[10px] font-black uppercase">
                        <HeaderTip title="TP / Reward%" tip="Take Profit at nearest opposing liquidity. % is distance from zone midpoint to TP." right />
                      </TableHead>
                      <TableHead className="hidden sm:table-cell text-right text-[10px] font-black uppercase">
                        <HeaderTip title="R:R" tip="Risk:Reward ratio + visual bar. Hover for exact %. Green = 1:4+, Orange = 1:3+. Min 1:1.5 shown." right />
                      </TableHead>
                      <TableHead className="hidden lg:table-cell text-right text-[10px] font-black uppercase">Vol 24h</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageItems.map((signal, i) => (
                      <ICTSignalRow
                        key={signal.id}
                        signal={signal}
                        index={(safePage - 1) * PAGE_SIZE + i}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between px-4 py-3 border-t border-border bg-muted/20 gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {filtered.length} setups · page {safePage} of {totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(1)}
                      disabled={safePage === 1}
                      className="px-2 py-1 text-[11px] font-bold rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
                    >«</button>
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={safePage === 1}
                      className="px-2 py-1 text-[11px] font-bold rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
                    >‹</button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                      const start = Math.max(1, Math.min(safePage - 2, totalPages - 4));
                      const p = start + idx;
                      return (
                        <button
                          key={p}
                          onClick={() => setPage(p)}
                          className={cn(
                            "w-7 h-7 text-[11px] font-bold rounded border transition-colors",
                            p === safePage
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:bg-muted",
                          )}
                        >{p}</button>
                      );
                    })}
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={safePage === totalPages}
                      className="px-2 py-1 text-[11px] font-bold rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
                    >›</button>
                    <button
                      onClick={() => setPage(totalPages)}
                      disabled={safePage === totalPages}
                      className="px-2 py-1 text-[11px] font-bold rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
                    >»</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
