"use client";

import * as React from "react";
import { useState, useEffect, memo, useRef } from "react";
import { pushAlerts, AlertsButton } from "@/components/SignalAlerts";
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Target,
  Zap,
  AlertTriangle,
  HelpCircle,
  BookOpen,
  X,
  ChevronRight,
  ArrowDown,
  ArrowUp,
  Layers,
  ShieldAlert,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ICTSignal } from "@/lib/services/ict";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(price: number): string {
  if (price === 0) return "—";
  if (price < 0.001) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  if (price < 100) return price.toFixed(4);
  return price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const HeaderTip = ({ title, tip, right }: { title: string; tip: string; right?: boolean }) => (
  <div className={cn("flex items-center gap-1.5", right && "justify-end")}>
    <span>{title}</span>
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle size={11} className="text-muted-foreground/50 hover:text-primary cursor-help" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px] text-xs font-medium z-50 p-3 bg-popover text-popover-foreground shadow-xl border-border">
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
);

// ─── How It Works Modal ───────────────────────────────────────────────────────

function HowItWorksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border bg-card/95 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <BookOpen size={18} className="text-primary" />
            </div>
            <div>
              <h2 className="font-black text-[16px] tracking-tight">ICT / SMC Strategy Guide</h2>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wide">
                How to use this scanner to take trades
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-6">

          {/* Quick overview */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <p className="text-[13px] font-semibold text-foreground leading-relaxed">
              This scanner identifies <span className="text-primary font-bold">liquidity sweeps</span> on Binance Futures
              across all timeframes. A sweep happens when price takes out a key level (equal highs/lows, session H/L),
              then snaps back — leaving smart money trapped on the wrong side. The scanner then finds a{" "}
              <span className="text-primary font-bold">Fair Value Gap (FVG)</span> or{" "}
              <span className="text-primary font-bold">Order Block (OB)</span> near the sweep as your entry zone.
            </p>
          </div>

          {/* Step 1 */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[11px] font-black">1</div>
              <h3 className="font-black text-[14px] flex items-center gap-2">
                <Layers size={14} className="text-primary" /> Market Structure
              </h3>
            </div>
            <div className="pl-8 space-y-2 text-[12px] text-muted-foreground">
              <p>The scanner first establishes the trend by finding pivot highs and lows.</p>
              <div className="flex gap-4">
                <div className="flex items-center gap-2 bg-[#0ecb81]/10 rounded-lg px-3 py-2">
                  <TrendingUp size={14} className="text-[#0ecb81]" />
                  <span className="font-bold text-[#0ecb81]">BULLISH</span>
                  <span className="text-muted-foreground">= Higher Highs + Higher Lows</span>
                </div>
                <div className="flex items-center gap-2 bg-[#f6465d]/10 rounded-lg px-3 py-2">
                  <TrendingDown size={14} className="text-[#f6465d]" />
                  <span className="font-bold text-[#f6465d]">BEARISH</span>
                  <span className="text-muted-foreground">= Lower Highs + Lower Lows</span>
                </div>
              </div>
              <p className="text-[11px] bg-muted/50 rounded-lg px-3 py-2">
                Only setups that align with the current structure are shown. No counter-trend trades.
              </p>
            </div>
          </section>

          {/* Step 2 */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[11px] font-black">2</div>
              <h3 className="font-black text-[14px] flex items-center gap-2">
                <Target size={14} className="text-primary" /> Liquidity Levels
              </h3>
            </div>
            <div className="pl-8 space-y-2 text-[12px] text-muted-foreground">
              <p>The scanner automatically maps these key liquidity pools:</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Equal Highs", desc: "Two or more wicks touching the same high (within 0.3%)" },
                  { label: "Equal Lows", desc: "Two or more wicks touching the same low (within 0.3%)" },
                  { label: "Session High", desc: "Highest point of the previous ~24 hours" },
                  { label: "Session Low", desc: "Lowest point of the previous ~24 hours" },
                ].map(item => (
                  <div key={item.label} className="rounded-lg border border-border bg-muted/30 p-3">
                    <p className="font-bold text-foreground text-[11px]">{item.label}</p>
                    <p className="text-[10px] mt-0.5">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Step 3 */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[11px] font-black">3</div>
              <h3 className="font-black text-[14px] flex items-center gap-2">
                <Zap size={14} className="text-primary" /> Liquidity Sweep
              </h3>
            </div>
            <div className="pl-8 space-y-2 text-[12px] text-muted-foreground">
              <p>A sweep = a candle wick that <strong className="text-foreground">pierces through a key level</strong> but the candle <strong className="text-foreground">closes back on the other side</strong>.</p>
              <div className="space-y-2">
                <div className="flex items-start gap-3 rounded-lg bg-[#0ecb81]/5 border border-[#0ecb81]/20 p-3">
                  <ArrowUp size={16} className="text-[#0ecb81] mt-0.5 shrink-0" />
                  <div>
                    <p className="font-bold text-[#0ecb81] text-[11px]">Bullish Sweep (LONG setup)</p>
                    <p>Candle wick goes <em>below</em> equal lows / session low, then <em>closes back above</em> the level. Stop hunters took out longs — now price can rally.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg bg-[#f6465d]/5 border border-[#f6465d]/20 p-3">
                  <ArrowDown size={16} className="text-[#f6465d] mt-0.5 shrink-0" />
                  <div>
                    <p className="font-bold text-[#f6465d] text-[11px]">Bearish Sweep (SHORT setup)</p>
                    <p>Candle wick goes <em>above</em> equal highs / session high, then <em>closes back below</em> the level. Stop hunters took out shorts — now price can drop.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Step 4 */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[11px] font-black">4</div>
              <h3 className="font-black text-[14px]">FVG & Order Block (Entry Zone)</h3>
            </div>
            <div className="pl-8 space-y-3 text-[12px] text-muted-foreground">
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
                <p className="font-bold text-foreground text-[11px]">Fair Value Gap (FVG)</p>
                <p>A 3-candle pattern where candle 1&apos;s high is below candle 3&apos;s low (bullish) or candle 1&apos;s low is above candle 3&apos;s high (bearish). The gap = an imbalance in price delivery — market tends to fill it.</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
                <p className="font-bold text-foreground text-[11px]">Order Block (OB)</p>
                <p>The last opposing candle before the big impulse move away from the sweep. For a LONG: the last bearish candle before the up-move — entry zone = the candle <strong className="text-foreground">body</strong> (open → close, no wicks). For a SHORT: the last bullish candle before the down-move — entry zone = the candle body (close → open). Represents where institutions placed their orders.</p>
              </div>
              <p className="text-[11px] bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-amber-400 font-medium">
                FVG+OB setups score highest — double confluence = higher probability
              </p>
            </div>
          </section>

          {/* Step 5 — Entry */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-amber-500/15 text-amber-500 flex items-center justify-center text-[11px] font-black">5</div>
              <h3 className="font-black text-[14px] flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-500" /> Your Entry (ACTION REQUIRED)
              </h3>
            </div>
            <div className="pl-8 space-y-3 text-[12px] text-muted-foreground">
              <div className="rounded-xl border-2 border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                <p className="font-bold text-amber-400 text-[13px]">When status = IN ZONE:</p>
                <ol className="space-y-2 list-none">
                  {[
                    "Switch to your charting platform (TradingView, etc.)",
                    "Verify price is inside the Entry Zone shown in the table",
                    "Wait for a rejection candle: strong bullish engulfing / big wick from the zone for LONG, or strong bearish engulfing / big wick for SHORT",
                    "Enter on the close of the rejection candle or open of the next",
                    "Set Stop Loss below the zone low (LONG) or above the zone high (SHORT) — or use the SL column which is already set just beyond the sweep wick",
                    "Set Take Profit at the value in the TP column — the nearest opposing liquidity pool",
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <ChevronRight size={13} className="text-amber-500 mt-0.5 shrink-0" />
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <p className="text-[11px]">
                If status = <strong className="text-foreground">ACTIVE</strong>, the setup exists but price has not yet returned to the zone. Watch it on your chart and wait.
              </p>
            </div>
          </section>

          {/* Step 6 — SL/TP */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[11px] font-black">6</div>
              <h3 className="font-black text-[14px] flex items-center gap-2">
                <ShieldAlert size={14} className="text-primary" /> Stop Loss & Take Profit
              </h3>
            </div>
            <div className="pl-8 grid grid-cols-2 gap-3 text-[12px]">
              <div className="rounded-lg bg-[#f6465d]/5 border border-[#f6465d]/20 p-3 space-y-1">
                <p className="font-bold text-[#f6465d] text-[11px]">Stop Loss (SL)</p>
                <p className="text-muted-foreground">Placed 0.2% beyond the sweep wick extreme — the absolute low of the sweep candle for LONG, absolute high for SHORT.</p>
              </div>
              <div className="rounded-lg bg-[#0ecb81]/5 border border-[#0ecb81]/20 p-3 space-y-1">
                <p className="font-bold text-[#0ecb81] text-[11px]">Take Profit (TP)</p>
                <p className="text-muted-foreground">Set at the nearest opposing liquidity pool — next equal highs above (LONG) or next equal lows below (SHORT).</p>
              </div>
            </div>
            <p className="pl-8 text-[11px] text-muted-foreground">
              R:R is shown as <strong className="text-foreground">1:X</strong> — risk 1 unit, reward X units. Only setups with at least 1:1.5 are shown. Setups with 1:3 or better are highlighted in green.
            </p>
          </section>

          {/* Step 7 — Invalidation */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-[#f6465d]/15 text-[#f6465d] flex items-center justify-center text-[11px] font-black">7</div>
              <h3 className="font-black text-[14px] flex items-center gap-2">
                <X size={14} className="text-[#f6465d]" /> Setup Invalidation
              </h3>
            </div>
            <div className="pl-8 space-y-2 text-[12px] text-muted-foreground">
              <p>A setup <strong className="text-foreground">expires</strong> if price does not return to the entry zone within <strong className="text-foreground">6 candles</strong> after the sweep. When expired, it is removed from the scanner automatically.</p>
              <p>Also manually invalidate the trade if:</p>
              <ul className="space-y-1">
                {[
                  "Price closes beyond the sweep wick before entering the zone",
                  "The FVG / OB zone is completely closed (price traded through it with force)",
                  "Market structure breaks against your trade direction",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <X size={11} className="text-[#f6465d] mt-0.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Timeframes note */}
          <section className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
            <p className="font-bold text-[13px] flex items-center gap-2">
              <CheckCircle2 size={14} className="text-primary" /> Timeframe Selection
            </p>
            <p className="text-[12px] text-muted-foreground">
              The scanner runs on all timeframes (5m to 1D). Higher timeframes = more reliable setups with larger R:R
              but fewer opportunities. Lower timeframes = more setups with faster invalidation.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { tf: "5m", note: "Scalp" },
                { tf: "15m", note: "Intraday" },
                { tf: "30m", note: "Intraday" },
                { tf: "1h", note: "Swing" },
                { tf: "4h", note: "Swing" },
                { tf: "1d", note: "Position" },
              ].map(item => (
                <div key={item.tf} className="flex items-center gap-1.5 bg-background border border-border rounded-md px-2 py-1">
                  <span className="font-black text-[11px] text-foreground">{item.tf}</span>
                  <span className="text-[9px] text-muted-foreground font-bold uppercase">{item.note}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Disclaimer */}
          <p className="text-[10px] text-muted-foreground/60 border-t border-border pt-4">
            This is an automated pattern scanner. It identifies setups algorithmically — always verify on your own
            chart before entering any trade. Past patterns do not guarantee future results. Trade at your own risk.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Signal row ───────────────────────────────────────────────────────────────

const ICTSignalRow = memo(({ signal, index }: { signal: ICTSignal; index: number }) => {
  const isLong = signal.signalType === "LONG";
  const isInZone = signal.status === "IN_ZONE";
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setMounted(true); }, []);
  // Tick every second so the "X sec ago" label stays live
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const detectedTime = mounted
    ? new Date(signal.timestamp).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  // Live "X sec / X min ago" label
  const ageLabel = (() => {
    if (!mounted) return "";
    const diffMs = now - signal.timestamp;
    if (diffMs < 0) return "just now";
    const secs = Math.floor(diffMs / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ${secs % 60}s ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m ago`;
  })();

  const priceVsZone = (() => {
    if (signal.priceInZone) return { label: "IN ZONE", cls: "text-amber-400" };
    if (isLong && signal.currentPrice > signal.entryZoneHigh)
      return { label: "ABOVE", cls: "text-blue-400" };
    if (!isLong && signal.currentPrice < signal.entryZoneLow)
      return { label: "BELOW", cls: "text-blue-400" };
    return { label: "NEAR", cls: "text-muted-foreground" };
  })();

  return (
    <TableRow className={cn("gecko-table-row group transition-colors", isInZone && "bg-amber-500/5")}>
      {/* # */}
      <TableCell className="w-10 text-center text-muted-foreground text-[11px] font-bold">
        {index + 1}
      </TableCell>

      {/* Coin */}
      <TableCell className="min-w-[180px] py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0 flex items-center justify-center overflow-hidden border border-border group-hover:border-primary/50 transition-colors">
            {signal.image ? (
              <img src={signal.image} alt={signal.symbol} className="w-full h-full object-cover" />
            ) : (
              <span className="text-[10px] font-bold text-muted-foreground">{signal.symbol.slice(0, 2)}</span>
            )}
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-[14px] text-foreground group-hover:text-primary transition-colors">
              {signal.symbol}
            </span>
            <span className="text-[10px] text-muted-foreground font-medium">{signal.name}</span>
          </div>
        </div>
      </TableCell>

      {/* Direction + Setup */}
      <TableCell>
        <div className="flex flex-col gap-1 items-start">
          <div className="flex items-center gap-1.5">
            <Badge className={cn(
              "font-bold text-[10px] px-2 py-0.5 uppercase tracking-wide border-0 shadow-sm",
              isLong ? "bg-[#0ecb81]/15 text-[#0ecb81]" : "bg-[#f6465d]/15 text-[#f6465d]",
            )}>
              {isLong ? "LONG" : "SHORT"}
            </Badge>
            <Badge className="font-bold text-[9px] px-1.5 py-0 bg-primary/10 text-primary border-0">
              {signal.setupType}
            </Badge>
            <span className="text-[9px] font-black text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
              {signal.timeframe.toUpperCase()}
            </span>
          </div>
          <span className="text-[9px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded" suppressHydrationWarning>
            {detectedTime}
          </span>
        </div>
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
          signal.score >= 80
            ? "bg-[#0ecb81]/5 text-[#0ecb81] border-[#0ecb81]/20"
            : signal.score >= 60
              ? "bg-orange-500/5 text-orange-500 border-orange-500/20"
              : "bg-muted/50 text-muted-foreground border-border",
        )}>
          {signal.score}
        </div>
      </TableCell>

      {/* Entry Zone */}
      <TableCell>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[11px] font-bold text-foreground tabular-nums">${fmt(signal.entryZoneHigh)}</span>
          <span className="text-[9px] text-muted-foreground">—</span>
          <span className="text-[11px] font-bold text-foreground tabular-nums">${fmt(signal.entryZoneLow)}</span>
          <span className={cn("text-[9px] font-bold", priceVsZone.cls)}>{priceVsZone.label}</span>
        </div>
      </TableCell>

      {/* Current Price */}
      <TableCell className="text-right">
        <span className="text-[13px] font-bold text-foreground tabular-nums">${fmt(signal.currentPrice)}</span>
      </TableCell>

      {/* SL */}
      <TableCell className="text-right">
        {(() => {
          const entryMid = (signal.entryZoneHigh + signal.entryZoneLow) / 2;
          const riskPct = entryMid > 0 ? Math.abs(entryMid - signal.stopLoss) / entryMid * 100 : 0;
          return (
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[12px] font-bold text-[#f6465d] tabular-nums">${fmt(signal.stopLoss)}</span>
              <span className="text-[9px] font-bold text-[#f6465d]/70 tabular-nums">−{riskPct.toFixed(2)}% risk</span>
            </div>
          );
        })()}
      </TableCell>

      {/* TP */}
      <TableCell className="text-right">
        {(() => {
          const entryMid = (signal.entryZoneHigh + signal.entryZoneLow) / 2;
          const rewardPct = entryMid > 0 ? Math.abs(signal.takeProfit - entryMid) / entryMid * 100 : 0;
          return (
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[12px] font-bold text-[#0ecb81] tabular-nums">${fmt(signal.takeProfit)}</span>
              <span className="text-[9px] font-bold text-[#0ecb81]/70 tabular-nums">+{rewardPct.toFixed(2)}% reward</span>
            </div>
          );
        })()}
      </TableCell>

      {/* R:R */}
      <TableCell className="text-right">
        {(() => {
          const entryMid = (signal.entryZoneHigh + signal.entryZoneLow) / 2;
          const riskPct = entryMid > 0 ? Math.abs(entryMid - signal.stopLoss) / entryMid * 100 : 0;
          const rewardPct = entryMid > 0 ? Math.abs(signal.takeProfit - entryMid) / entryMid * 100 : 0;
          return (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex flex-col items-end gap-1 cursor-help">
                    {/* Ratio badge */}
                    <div className={cn(
                      "inline-flex items-center justify-center px-2 h-6 rounded-md font-black text-[11px] border",
                      signal.riskReward >= 4
                        ? "bg-[#0ecb81]/10 text-[#0ecb81] border-[#0ecb81]/20"
                        : signal.riskReward >= 3
                          ? "bg-green-500/10 text-green-500 border-green-500/20"
                          : "bg-orange-500/10 text-orange-500 border-orange-500/20",
                    )}>
                      1:{signal.riskReward}
                    </div>
                    {/* Visual bar */}
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
                <TooltipContent className="bg-popover text-popover-foreground border-border p-3 shadow-xl max-w-[260px] z-50">
                  <div className="space-y-1.5 text-xs font-mono">
                    <p className="text-[#f6465d]">Risk:  −{riskPct.toFixed(3)}% from entry to SL</p>
                    <p className="text-[#0ecb81]">Reward: +{rewardPct.toFixed(3)}% from entry to TP</p>
                    <p className="text-muted-foreground pt-1 border-t border-border">{signal.formula}</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })()}
      </TableCell>

      {/* Liquidity Type */}
      <TableCell>
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide bg-muted/50 px-1.5 py-0.5 rounded">
          {signal.liquidityType.replace(/_/g, " ")}
        </span>
      </TableCell>

      {/* Volume */}
      <TableCell className="text-right">
        <span className="text-[12px] font-bold tabular-nums">${(signal.volume24h / 1e6).toFixed(0)}M</span>
      </TableCell>
    </TableRow>
  );
});
ICTSignalRow.displayName = "ICTSignalRow";

// ─── Stats header ─────────────────────────────────────────────────────────────

const StatsHeader = ({ signals }: { signals: ICTSignal[] }) => {
  const longs = signals.filter(s => s.signalType === "LONG").length;
  const shorts = signals.filter(s => s.signalType === "SHORT").length;
  const inZone = signals.filter(s => s.priceInZone).length;
  const avgRR = signals.length > 0
    ? (signals.reduce((sum, s) => sum + s.riskReward, 0) / signals.length).toFixed(1)
    : "0";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
          <Badge className="bg-primary/20 text-primary text-[10px] font-bold">AVG</Badge>
        </div>
        <p className="text-3xl font-black text-primary">{avgRR}:1</p>
        <p className="text-[11px] font-bold text-muted-foreground uppercase">Avg Risk:Reward</p>
      </div>
    </div>
  );
};

// ─── Main terminal ────────────────────────────────────────────────────────────

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
  const [filterType, setFilterType] = useState<"ALL" | "LONG" | "SHORT" | "IN_ZONE">("ALL");
  const [showModal, setShowModal] = useState(false);

  // Track known signal IDs to detect new ones between refreshes
  const knownIdsRef = useRef<Set<string>>(new Set());
  // Suppress alerts on the very first poll AND on the first poll after a timeframe switch
  // — avoids flooding alerts with already-existing signals
  const suppressNextAlertRef = useRef(true);

  const signalId = (s: ICTSignal) =>
    `${s.coinId}::${s.signalType}::${s.timeframe}::${s.sweepTimestamp}`;

  const refresh = async (tfOverride?: string) => {
    if (!fetchAction) return;
    try {
      setRefreshing(true);
      const activeTf = tfOverride !== undefined ? tfOverride : timeframe;
      const data = await fetchAction(activeTf);
      if (!Array.isArray(data)) return;

      if (suppressNextAlertRef.current) {
        // First poll for this timeframe — seed knownIds without firing alerts
        data.forEach(s => knownIdsRef.current.add(signalId(s)));
        suppressNextAlertRef.current = false;
      } else {
        // Detect signals not seen in a previous poll
        const newSignals = data.filter(s => !knownIdsRef.current.has(signalId(s)));
        data.forEach(s => knownIdsRef.current.add(signalId(s)));

        if (newSignals.length > 0) {
          pushAlerts("ICT / SMC", newSignals.map(s => ({
            symbol: s.symbol,
            name: s.name,
            image: s.image,
            signalType: s.signalType,
            timeframe: s.timeframe,
            score: s.score,
            setupType: s.setupType,
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

  // Auto-refresh every 10s — cache is 8s so every poll triggers a real scan.
  // On timeframe change: suppress alerts for the first poll of the new timeframe.
  useEffect(() => {
    suppressNextAlertRef.current = true;
    setLoading(true);
    refresh();
    const interval = setInterval(() => refresh(), 10_000);
    return () => clearInterval(interval);
  }, [timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  // All-timeframes DB persistence is handled server-side by instrumentation.ts (every 3 min).

  const filtered = signals.filter(s => {
    if (s.timeframe !== timeframe) return false;
    if (filterType === "LONG" && s.signalType !== "LONG") return false;
    if (filterType === "SHORT" && s.signalType !== "SHORT") return false;
    if (filterType === "IN_ZONE" && !s.priceInZone) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
  });

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
              Binance Futures · Liquidity Sweep + FVG / Order Block
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Timeframe selector — view filter only, no re-fetch */}
            <div className="flex bg-muted rounded-lg p-1 border border-border">
              {["5m", "15m", "30m", "1h", "4h", "1d"].map(tf => (
                <button
                  key={tf}
                  onClick={() => {
                    setTimeframe(tf);
                    // useEffect [timeframe] handles the fetch after state update
                  }}
                  className={cn(
                    "px-3 py-1 text-[11px] font-bold rounded-md transition-all whitespace-nowrap",
                    timeframe === tf
                      ? "bg-background text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tf === "all" ? "ALL" : tf.toUpperCase()}
                </button>
              ))}
            </div>

            {/* How it works button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowModal(true)}
              className="h-8 gap-2 text-[11px] font-bold"
            >
              <BookOpen size={13} />
              <span className="hidden sm:inline">How It Works</span>
            </Button>

            {/* Live indicator */}
            <div className="flex items-center gap-2">
              {refreshing ? (
                <>
                  <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                  <span className="text-[11px] text-muted-foreground font-medium hidden sm:inline">Updating...</span>
                </>
              ) : (
                <>
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[11px] text-muted-foreground font-medium hidden sm:inline">Live · 20s</span>
                </>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh()}
              disabled={refreshing}
              className="h-8"
            >
              <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
            </Button>

            <AlertsButton page="ICT / SMC" />
          </div>
        </div>

        {/* Stats */}
        <StatsHeader signals={filtered} />

        {/* Strategy legend + How It Works hint */}
        <div className="gecko-card rounded-xl p-4 border border-border bg-card/50">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[11px] font-bold text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <TrendingUp size={12} className="text-[#0ecb81]" />
              LONG = bullish structure + sweep of lows
            </span>
            <span className="flex items-center gap-1.5">
              <TrendingDown size={12} className="text-[#f6465d]" />
              SHORT = bearish structure + sweep of highs
            </span>
            <span className="flex items-center gap-1.5">
              <AlertTriangle size={12} className="text-amber-500" />
              IN ZONE = price is inside the FVG/OB now — watch for rejection candle to enter
            </span>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 text-primary hover:underline"
            >
              <BookOpen size={12} />
              Full guide on how to take the trade →
            </button>
          </div>
        </div>

        {/* Filter + Search */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex bg-muted rounded-lg p-1 border border-border">
            {(["ALL", "LONG", "SHORT", "IN_ZONE"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilterType(f)}
                className={cn(
                  "px-3 py-1 text-[11px] font-bold rounded-md transition-all whitespace-nowrap",
                  filterType === f
                    ? "bg-background text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.replace("_", " ")}
              </button>
            ))}
          </div>

          <div className="relative flex-1 max-w-sm">
            <input
              type="text"
              placeholder="Search symbol or name..."
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
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Target size={40} className="mx-auto mb-4 text-muted-foreground/30" />
              <p className="text-sm font-bold text-muted-foreground">
                No active ICT setups{timeframe !== "all" ? ` on ${timeframe.toUpperCase()}` : " across all timeframes"}
              </p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                Scanner checks 75 coins across all 6 timeframes every 30 seconds
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
                      <HeaderTip title="Direction / Setup" tip="LONG or SHORT based on market structure. FVG = Fair Value Gap, OB = Order Block, FVG+OB = both (highest confluence)." />
                    </TableHead>
                    <TableHead className="text-[10px] font-black uppercase">
                      <HeaderTip title="Status" tip="ACTIVE = waiting for price to return to zone. IN ZONE = price is inside the entry zone — look for a rejection candle to enter." />
                    </TableHead>
                    <TableHead className="text-[10px] font-black uppercase">Score</TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase">
                      <HeaderTip title="Entry Zone" tip="The FVG or OB range. Enter when price is here and prints a rejection candle (engulfing / strong wick)." right />
                    </TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase">Price</TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase">
                      <HeaderTip title="SL / Risk%" tip="Stop Loss price + % distance from entry zone mid to SL." right />
                    </TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase">
                      <HeaderTip title="TP / Reward%" tip="Take Profit price + % distance from entry zone mid to TP." right />
                    </TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase">
                      <HeaderTip title="R:R" tip="1:X ratio + visual bar (red=risk%, green=reward%). Hover for exact percentages. Min 1:1.5 shown. Green = 1:3 or better." right />
                    </TableHead>
                    <TableHead className="text-[10px] font-black uppercase">Liquidity</TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase">Vol 24h</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((signal, i) => (
                    <ICTSignalRow
                      key={`${signal.coinId}-${signal.sweepTimestamp}`}
                      signal={signal}
                      index={i}
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
