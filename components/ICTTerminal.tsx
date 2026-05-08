"use client";

import * as React from "react";
import { useState, useEffect, memo, useRef } from "react";
import { pushAlerts, AlertsButton } from "@/components/SignalAlerts";
import {
  TrendingUp, TrendingDown, RefreshCw, Target, Zap, AlertTriangle,
  HelpCircle, BookOpen, X, ChevronRight, ArrowDown, ArrowUp, Layers,
  ShieldAlert, CheckCircle2, Clock, BarChart2, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ICTSignal, KillZoneName, PremiumDiscount } from "@/lib/services/ict";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(price: number): string {
  if (price === 0) return "—";
  if (price < 0.001) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  if (price < 100) return price.toFixed(4);
  return price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const KZ_COLORS: Record<KillZoneName, string> = {
  LONDON: "text-blue-400 bg-blue-400/10",
  NEW_YORK: "text-orange-400 bg-orange-400/10",
  ASIA: "text-purple-400 bg-purple-400/10",
  LONDON_CLOSE: "text-cyan-400 bg-cyan-400/10",
};

const KZ_LABELS: Record<KillZoneName, string> = {
  LONDON: "LDN",
  NEW_YORK: "NYC",
  ASIA: "ASIA",
  LONDON_CLOSE: "LDN-CL",
};

const PD_COLORS: Record<PremiumDiscount, string> = {
  PREMIUM: "text-[#f6465d] bg-[#f6465d]/10",
  DISCOUNT: "text-[#0ecb81] bg-[#0ecb81]/10",
  EQUILIBRIUM: "text-muted-foreground bg-muted/50",
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
      <ICTBadge label="CHoCH" active={signal.choch} color="text-purple-400 bg-purple-400/10" />
      <ICTBadge label="BOS" active={signal.bos} color="text-blue-400 bg-blue-400/10" />
      <ICTBadge label="DISP" active={signal.displacement} color="text-orange-400 bg-orange-400/10" />
      <ICTBadge label="IDM" active={signal.hasInducement} color="text-yellow-400 bg-yellow-400/10" />
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

// ─── Signal Row ───────────────────────────────────────────────────────────────

const ICTSignalRow = memo(({ signal, index, now }: { signal: ICTSignal; index: number; now: number }) => {
  const isLong = signal.signalType === "LONG";
  const isInZone = signal.status === "IN_ZONE";
  const mounted = true;

  const detectedTime = mounted
    ? new Date(signal.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  const ageLabel = (() => {
    if (!mounted) return "";
    const secs = Math.floor(Math.max(0, now - signal.timestamp) / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ${secs % 60}s ago`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  })();

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
      <TableCell className="min-w-[160px] py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0 flex items-center justify-center overflow-hidden border border-border group-hover:border-primary/50 transition-colors">
            {signal.image
              ? <img src={signal.image} alt={signal.symbol} className="w-full h-full object-cover" />
              : <span className="text-[10px] font-bold text-muted-foreground">{signal.symbol.slice(0, 2)}</span>
            }
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-[13px] text-foreground group-hover:text-primary transition-colors">{signal.symbol}</span>
            <span className="text-[9px] text-muted-foreground font-medium">{signal.name}</span>
          </div>
        </div>
      </TableCell>

      {/* Direction / Setup / Timeframe */}
      <TableCell className="min-w-[160px]">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge className={cn(
              "font-bold text-[10px] px-2 py-0.5 uppercase border-0 shadow-sm",
              isLong ? "bg-[#0ecb81]/15 text-[#0ecb81]" : "bg-[#f6465d]/15 text-[#f6465d]",
            )}>
              {isLong ? "LONG" : "SHORT"}
            </Badge>
            <Badge className={cn(
              "font-bold text-[9px] px-1.5 py-0 border-0",
              signal.setupType === "FVG+OB" || signal.setupType.includes("BREAKER")
                ? "bg-amber-500/15 text-amber-400"
                : "bg-primary/10 text-primary",
            )}>
              {signal.setupType}
            </Badge>
            <span className="text-[9px] font-black text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
              {signal.timeframe.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
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
          <span className="text-[9px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded w-fit" suppressHydrationWarning>
            {detectedTime}
          </span>
        </div>
      </TableCell>

      {/* ICT Grade */}
      <TableCell>
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
                <div key={label} className={cn("flex items-center gap-2", active ? "text-foreground" : "text-muted-foreground/40 line-through")}>
                  <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", active ? "bg-primary" : "bg-muted")} />
                  {label}
                </div>
              ))}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TableCell>

      {/* Status */}
      <TableCell>
        <div className="flex flex-col gap-1">
          <Badge className={cn(
            "font-bold text-[9px] px-2 py-0.5 uppercase border-0 w-fit",
            isInZone ? "bg-amber-500/20 text-amber-400" : "bg-green-500/15 text-green-400",
          )}>
            {isInZone ? "IN ZONE" : "ACTIVE"}
          </Badge>
          <span className="text-[10px] text-muted-foreground font-bold" suppressHydrationWarning>
            {mounted ? ageLabel || "just now" : "—"}
          </span>
        </div>
      </TableCell>

      {/* Score */}
      <TableCell>
        <div className={cn(
          "w-11 h-11 rounded-lg flex items-center justify-center font-bold text-[15px] border-2",
          signal.score >= 80 ? "bg-[#0ecb81]/5 text-[#0ecb81] border-[#0ecb81]/20"
            : signal.score >= 60 ? "bg-orange-500/5 text-orange-500 border-orange-500/20"
            : "bg-muted/50 text-muted-foreground border-border",
        )}>
          {signal.score}
        </div>
      </TableCell>

      {/* Entry Zone + CE */}
      <TableCell>
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
      <TableCell className="text-right">
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[12px] font-bold text-[#f6465d] tabular-nums">${fmt(signal.stopLoss)}</span>
          <span className="text-[9px] font-bold text-[#f6465d]/70 tabular-nums">−{riskPct.toFixed(2)}%</span>
        </div>
      </TableCell>

      {/* TP */}
      <TableCell className="text-right">
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[12px] font-bold text-[#0ecb81] tabular-nums">${fmt(signal.takeProfit)}</span>
          <span className="text-[9px] font-bold text-[#0ecb81]/70 tabular-nums">+{rewardPct.toFixed(2)}%</span>
        </div>
      </TableCell>

      {/* R:R */}
      <TableCell className="text-right">
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col items-end gap-1 cursor-help">
                <div className={cn(
                  "inline-flex items-center justify-center px-2 h-6 rounded-md font-black text-[11px] border",
                  signal.riskReward >= 4 ? "bg-[#0ecb81]/10 text-[#0ecb81] border-[#0ecb81]/20"
                    : signal.riskReward >= 3 ? "bg-green-500/10 text-green-500 border-green-500/20"
                    : "bg-orange-500/10 text-orange-500 border-orange-500/20",
                )}>
                  1:{signal.riskReward}
                </div>
                <div className="flex items-center gap-0.5 h-2">
                  <div className="h-2 rounded-l-full bg-[#f6465d]/60" style={{ width: `${Math.min(riskPct * 3, 24)}px`, minWidth: "4px" }} />
                  <div className="h-2 rounded-r-full bg-[#0ecb81]/60" style={{ width: `${Math.min(rewardPct * 3, 72)}px`, minWidth: "4px" }} />
                </div>
                <div className="flex items-center gap-2 text-[9px] font-bold tabular-nums">
                  <span className="text-[#f6465d]/80">−{riskPct.toFixed(1)}%</span>
                  <span className="text-muted-foreground/40">/</span>
                  <span className="text-[#0ecb81]/80">+{rewardPct.toFixed(1)}%</span>
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
      <TableCell className="text-right">
        <span className="text-[12px] font-bold tabular-nums">${(signal.volume24h / 1e6).toFixed(0)}M</span>
      </TableCell>
    </TableRow>
  );
});
ICTSignalRow.displayName = "ICTSignalRow";

// ─── Stats Header ─────────────────────────────────────────────────────────────

const StatsHeader = ({ signals }: { signals: ICTSignal[] }) => {
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
    <div className="space-y-4 mb-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="gecko-card p-4 border-l-4 border-l-[#0ecb81] bg-[#0ecb81]/5">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="text-[#0ecb81]" size={20} />
            <Badge className="bg-[#0ecb81]/20 text-[#0ecb81] text-[10px] font-bold">LONG</Badge>
          </div>
          <p className="text-3xl font-black text-[#0ecb81]">{longs}</p>
          <p className="text-[11px] font-bold text-muted-foreground uppercase">Long Setups</p>
        </div>

        <div className="gecko-card p-4 border-l-4 border-l-[#f6465d] bg-[#f6465d]/5">
          <div className="flex items-center justify-between mb-2">
            <TrendingDown className="text-[#f6465d]" size={20} />
            <Badge className="bg-[#f6465d]/20 text-[#f6465d] text-[10px] font-bold">SHORT</Badge>
          </div>
          <p className="text-3xl font-black text-[#f6465d]">{shorts}</p>
          <p className="text-[11px] font-bold text-muted-foreground uppercase">Short Setups</p>
        </div>

        <div className="gecko-card p-4 border-l-4 border-l-amber-500 bg-amber-500/5">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="text-amber-500" size={20} />
            <Badge className="bg-amber-500/20 text-amber-500 text-[10px] font-bold">NOW</Badge>
          </div>
          <p className="text-3xl font-black text-amber-500">{inZone}</p>
          <p className="text-[11px] font-bold text-muted-foreground uppercase">Price In Zone</p>
        </div>

        <div className="gecko-card p-4 border-l-4 border-l-primary bg-primary/5">
          <div className="flex items-center justify-between mb-2">
            <Target className="text-primary" size={20} />
            <Badge className="bg-primary/20 text-primary text-[10px] font-bold">TOP</Badge>
          </div>
          <p className="text-3xl font-black text-primary">{highGrade}</p>
          <p className="text-[11px] font-bold text-muted-foreground uppercase">Score ≥ 80</p>
        </div>
      </div>

      {/* ICT confluence bar */}
      {signals.length > 0 && (
        <div className="gecko-card p-3 border border-border bg-card/50 rounded-xl">
          <p className="text-[10px] font-black uppercase text-muted-foreground mb-2">ICT Confluence Distribution</p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "CHoCH", count: chochCount, color: "text-purple-400 bg-purple-400/10" },
              { label: "BOS", count: bosCount, color: "text-blue-400 bg-blue-400/10" },
              { label: "Displacement", count: dispCount, color: "text-orange-400 bg-orange-400/10" },
              { label: "Inducement", count: idmCount, color: "text-yellow-400 bg-yellow-400/10" },
              { label: "Kill Zone", count: kzCount, color: "text-cyan-400 bg-cyan-400/10" },
              { label: "Breaker", count: breakerCount, color: "text-red-400 bg-red-400/10" },
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
};

// ─── Main Terminal ─────────────────────────────────────────────────────────────

type FilterType = "ALL" | "LONG" | "SHORT" | "IN_ZONE" | "HIGH_GRADE" | "CHOCH" | "KILL_ZONE";

interface ICTTerminalProps {
  initialData?: ICTSignal[];
  fetchAction?: (timeframe?: string) => Promise<ICTSignal[]>;
}

export default function ICTTerminal({ initialData = [], fetchAction }: ICTTerminalProps) {
  const [signals, setSignals] = useState<ICTSignal[]>(initialData);
  const [loading, setLoading] = useState(initialData.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [timeframe, setTimeframe] = useState("15m");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("ALL");
  const [showModal, setShowModal] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const knownIdsRef = useRef<Set<string>>(new Set());
  const suppressNextAlertRef = useRef(true);

  const signalId = (s: ICTSignal) => `${s.coinId}::${s.signalType}::${s.timeframe}::${s.sweepTimestamp}`;

  const refresh = async (tfOverride?: string) => {
    if (!fetchAction) return;
    try {
      setRefreshing(true);
      const activeTf = tfOverride !== undefined ? tfOverride : timeframe;
      const data = await fetchAction(activeTf);
      if (!Array.isArray(data)) return;

      if (suppressNextAlertRef.current) {
        data.forEach(s => knownIdsRef.current.add(signalId(s)));
        suppressNextAlertRef.current = false;
      } else {
        const newSignals = data.filter(s => !knownIdsRef.current.has(signalId(s)));
        data.forEach(s => knownIdsRef.current.add(signalId(s)));
        if (newSignals.length > 0) {
          pushAlerts("ICT / SMC", newSignals.map(s => ({
            symbol: s.symbol, name: s.name, image: s.image,
            signalType: s.signalType, timeframe: s.timeframe,
            score: s.score, setupType: s.setupType,
          })));
        }
      }
      setSignals(data);
    } catch (err) {
      console.warn("[ICT] Fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    suppressNextAlertRef.current = true;
    setLoading(true);
    refresh();
    const interval = setInterval(() => refresh(), 10_000);
    return () => clearInterval(interval);
  }, [timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = signals.filter(s => {
    if (s.timeframe !== timeframe) return false;
    if (filterType === "LONG" && s.signalType !== "LONG") return false;
    if (filterType === "SHORT" && s.signalType !== "SHORT") return false;
    if (filterType === "IN_ZONE" && !s.priceInZone) return false;
    if (filterType === "HIGH_GRADE" && s.score < 80) return false;
    if (filterType === "CHOCH" && !s.choch) return false;
    if (filterType === "KILL_ZONE" && !s.killZone) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
  });

  const FILTERS: { key: FilterType; label: string }[] = [
    { key: "ALL", label: "ALL" },
    { key: "LONG", label: "LONG" },
    { key: "SHORT", label: "SHORT" },
    { key: "IN_ZONE", label: "IN ZONE" },
    { key: "HIGH_GRADE", label: "SCORE 80+" },
    { key: "CHOCH", label: "CHoCH" },
    { key: "KILL_ZONE", label: "KILL ZONE" },
  ];

  return (
    <>
      <HowItWorksModal open={showModal} onClose={() => setShowModal(false)} />

      <div className="space-y-6">
        {/* Title bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-lg md:text-3xl font-black text-foreground tracking-tighter uppercase leading-tight">
              ICT / SMC SCANNER
            </h1>
            <p className="text-[10px] md:text-[12px] font-bold text-muted-foreground uppercase opacity-80">
              Binance Futures · Complete ICT Concept · CHoCH · BOS · Displacement · Inducement · Breaker · P/D · OTE · Kill Zones
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-muted rounded-lg p-1 border border-border">
              {["5m", "15m", "30m", "1h", "4h", "1d"].map(tf => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={cn(
                    "px-3 py-1 text-[11px] font-bold rounded-md transition-all whitespace-nowrap",
                    timeframe === tf ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tf.toUpperCase()}
                </button>
              ))}
            </div>

            <Button variant="outline" size="sm" onClick={() => setShowModal(true)} className="h-8 gap-2 text-[11px] font-bold">
              <BookOpen size={13} />
              <span className="hidden sm:inline">ICT Guide</span>
            </Button>

            <div className="flex items-center gap-2">
              {refreshing ? (
                <><div className="h-2 w-2 rounded-full bg-primary animate-pulse" /><span className="text-[11px] text-muted-foreground font-medium hidden sm:inline">Updating...</span></>
              ) : (
                <><div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" /><span className="text-[11px] text-muted-foreground font-medium hidden sm:inline">Live · 10s</span></>
              )}
            </div>

            <Button variant="outline" size="sm" onClick={() => refresh()} disabled={refreshing} className="h-8">
              <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
            </Button>

            <AlertsButton page="ICT / SMC" />
          </div>
        </div>

        {/* Stats */}
        <StatsHeader signals={filtered} />

        {/* Strategy legend */}
        <div className="gecko-card rounded-xl p-4 border border-border bg-card/50">
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[11px] font-bold text-muted-foreground">
            <span className="flex items-center gap-1.5"><TrendingUp size={12} className="text-[#0ecb81]" />LONG = bullish structure + sweep of lows</span>
            <span className="flex items-center gap-1.5"><TrendingDown size={12} className="text-[#f6465d]" />SHORT = bearish structure + sweep of highs</span>
            <span className="flex items-center gap-1.5"><AlertTriangle size={12} className="text-amber-500" />IN ZONE = price inside FVG/OB — watch for rejection candle</span>
            <span className="flex items-center gap-1.5 text-purple-400">CHoCH = prior structure reversed</span>
            <span className="flex items-center gap-1.5 text-blue-400">BOS = structure confirmed</span>
            <span className="flex items-center gap-1.5 text-orange-400">DISP = displacement present</span>
            <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 text-primary hover:underline">
              <BookOpen size={12} />Full ICT guide →
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex bg-muted rounded-lg p-1 border border-border flex-wrap gap-0.5">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilterType(f.key)}
                className={cn(
                  "px-3 py-1 text-[11px] font-bold rounded-md transition-all whitespace-nowrap",
                  filterType === f.key ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 max-w-sm">
            <input
              type="text"
              placeholder="Search symbol..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-4 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <Target size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
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
            <div className="p-12 text-center">
              <Target size={40} className="mx-auto mb-4 text-muted-foreground/30" />
              <p className="text-sm font-bold text-muted-foreground">
                No ICT setups{timeframe !== "all" ? ` on ${timeframe.toUpperCase()}` : ""}
                {filterType !== "ALL" ? ` matching filter "${FILTERS.find(f => f.key === filterType)?.label}"` : ""}
              </p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                Scanner checks 50 coins across all 6 timeframes every 10 seconds
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="gecko-table-header">
                    <TableHead className="w-10 text-center text-[10px] font-black uppercase">#</TableHead>
                    <TableHead className="text-[10px] font-black uppercase">Coin</TableHead>
                    <TableHead className="text-[10px] font-black uppercase">
                      <HeaderTip title="Signal" tip="Direction (LONG/SHORT), setup type, timeframe, P/D position, and active kill zone." />
                    </TableHead>
                    <TableHead className="text-[10px] font-black uppercase">
                      <HeaderTip title="ICT Grade" tip="Confirmed ICT confluences: CHoCH, BOS, Displacement, Inducement, Kill Zone. Hover for detail. Bar shows how many of 6 are active." />
                    </TableHead>
                    <TableHead className="text-[10px] font-black uppercase">Status</TableHead>
                    <TableHead className="text-[10px] font-black uppercase">Score</TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase">
                      <HeaderTip title="Entry Zone" tip="FVG/OB/Breaker range. CE = 50% (Consequent Encroachment — most magnetic). Hover for OTE fib zone and dealing range." right />
                    </TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase">Price</TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase">
                      <HeaderTip title="SL / Risk%" tip="Stop Loss beyond sweep wick (0.2%). % is distance from zone midpoint to SL." right />
                    </TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase">
                      <HeaderTip title="TP / Reward%" tip="Take Profit at nearest opposing liquidity. % is distance from zone midpoint to TP." right />
                    </TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase">
                      <HeaderTip title="R:R" tip="Risk:Reward ratio + visual bar. Hover for exact %. Green = 1:4+, Orange = 1:3+. Min 1:1.5 shown." right />
                    </TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase">Vol 24h</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((signal, i) => (
                    <ICTSignalRow
                      key={`${signal.coinId}-${signal.sweepTimestamp}`}
                      signal={signal}
                      index={i}
                      now={now}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
