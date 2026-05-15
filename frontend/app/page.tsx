"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CoinIcon } from "@/components/CoinIcon";
import type { ApiSignal } from "@/lib/types/signals";
import { getHomeDataAction, getCoinGeckoDataAction, getFearGreedAction, getMarketGlobalAction } from "@/app/actions";
import type { CGTrendingItem, CGMarketCoin } from "@/app/actions";

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtAge(ts: string) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function fmtAgeShort(ts: string) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function fmtPrice(n: number) {
  if (!n) return "—";
  if (n < 0.000001) return "$" + n.toExponential(3);
  if (n < 0.001)    return "$" + n.toFixed(6);
  if (n < 1)        return "$" + n.toFixed(4);
  if (n < 1000)     return "$" + n.toFixed(2);
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtCGPrice(s: string | number | undefined) {
  if (s == null) return "$—";
  if (typeof s === "number") return fmtPrice(s);
  const n = parseFloat(s.replace(/[$,]/g, ""));
  return isNaN(n) ? (s.startsWith("$") ? s : "$" + s) : fmtPrice(n);
}
function fmtPct(n: number) {
  return (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2) + "%";
}
function fmtVol(n: number) {
  if (!n) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(0);
}
function scoreColor(n: number) {
  if (n >= 70) return "#0ecb81";
  if (n >= 45) return "#f59e0b";
  return "#f6465d";
}
function scoreGrade(n: number) {
  if (n >= 80) return "S";
  if (n >= 65) return "A";
  if (n >= 50) return "B";
  if (n >= 35) return "C";
  return "D";
}

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

/* ── EMA: three smooth curves with gradient glow dots ─────────────────────── */
const IcoEMA = () => (
  <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
    <defs>
      <linearGradient id="ema-g1" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.15"/>
        <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.9"/>
      </linearGradient>
      <linearGradient id="ema-g2" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.2"/>
        <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.85"/>
      </linearGradient>
      <linearGradient id="ema-g3" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#0ecb81" stopOpacity="0.25"/>
        <stop offset="100%" stopColor="#0ecb81" stopOpacity="1"/>
      </linearGradient>
    </defs>
    {/* slow EMA */}
    <path d="M4 34 C10 32 18 28 36 22" stroke="url(#ema-g1)" strokeWidth="2" strokeLinecap="round"/>
    {/* mid EMA */}
    <path d="M4 34 C10 28 18 20 36 14" stroke="url(#ema-g2)" strokeWidth="2" strokeLinecap="round"/>
    {/* fast EMA */}
    <path d="M4 34 C10 24 18 12 36 6"  stroke="url(#ema-g3)" strokeWidth="2.5" strokeLinecap="round"/>
    {/* crossover glow */}
    <circle cx="36" cy="6"  r="3.5" fill="#0ecb81" fillOpacity="0.25"/>
    <circle cx="36" cy="6"  r="2"   fill="#0ecb81"/>
    <circle cx="36" cy="14" r="2.5" fill="#f59e0b" fillOpacity="0.2"/>
    <circle cx="36" cy="14" r="1.5" fill="#f59e0b"/>
    <circle cx="36" cy="22" r="2"   fill="#60a5fa" fillOpacity="0.2"/>
    <circle cx="36" cy="22" r="1.2" fill="#60a5fa"/>
    {/* base axis */}
    <line x1="4" y1="37" x2="37" y2="37" stroke="currentColor" strokeWidth="1" strokeOpacity="0.12" strokeLinecap="round"/>
  </svg>
);

/* ── ICT: candlestick chart with highlighted order block ─────────────────── */
const IcoICT = () => (
  <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
    {/* order block zone */}
    <rect x="2" y="4" width="36" height="9" rx="2" fill="#a855f7" fillOpacity="0.08"/>
    <rect x="2" y="4" width="36" height="9" rx="2" stroke="#a855f7" strokeWidth="1" strokeOpacity="0.4"/>
    <line x1="2" y1="8.5" x2="38" y2="8.5" stroke="#a855f7" strokeWidth="0.8" strokeDasharray="3 2.5" strokeOpacity="0.5"/>
    {/* candles */}
    {/* candle 1 – bullish */}
    <line x1="9"  y1="16" x2="9"  y2="38" stroke="#0ecb81" strokeWidth="1.2" strokeLinecap="round"/>
    <rect x="6"  y="20" width="6" height="12" rx="1.2" fill="#0ecb81"/>
    {/* candle 2 – bearish */}
    <line x1="20" y1="13" x2="20" y2="37" stroke="#f6465d" strokeWidth="1.2" strokeLinecap="round"/>
    <rect x="17" y="17" width="6" height="13" rx="1.2" fill="#f6465d"/>
    {/* candle 3 – bullish */}
    <line x1="31" y1="15" x2="31" y2="37" stroke="#0ecb81" strokeWidth="1.2" strokeLinecap="round"/>
    <rect x="28" y="19" width="6" height="11" rx="1.2" fill="#0ecb81"/>
  </svg>
);

/* ── SMC: clean structure break + supply/demand zones ────────────────────── */
const IcoSMC = () => (
  <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
    {/* supply zone */}
    <rect x="2" y="3" width="36" height="8" rx="2" fill="#f6465d" fillOpacity="0.1" stroke="#f6465d" strokeWidth="1" strokeOpacity="0.5"/>
    {/* demand zone */}
    <rect x="2" y="29" width="36" height="8" rx="2" fill="#0ecb81" fillOpacity="0.1" stroke="#0ecb81" strokeWidth="1" strokeOpacity="0.5"/>
    {/* price path */}
    <polyline
      points="4,34 10,26 16,30 22,18 28,22 34,10"
      stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"
    />
    {/* BOS break line */}
    <line x1="22" y1="19" x2="38" y2="19" stroke="#f59e0b" strokeWidth="1.2" strokeDasharray="3 2" strokeOpacity="0.8" strokeLinecap="round"/>
    {/* BOS arrow */}
    <path d="M33 16 L37 19 L33 22" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    {/* CHoCH dot */}
    <circle cx="22" cy="19" r="2.5" fill="#f59e0b" fillOpacity="0.3"/>
    <circle cx="22" cy="19" r="1.5" fill="#f59e0b"/>
  </svg>
);

/* ── DB: stacked cylinder database ───────────────────────────────────────── */
const IcoDB = () => (
  <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
    <defs>
      <linearGradient id="db-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#0ecb81" stopOpacity="0.9"/>
        <stop offset="100%" stopColor="#0ecb81" stopOpacity="0.3"/>
      </linearGradient>
    </defs>
    {/* tier 3 (bottom) */}
    <ellipse cx="20" cy="31" rx="13" ry="4" fill="#0ecb81" fillOpacity="0.2"/>
    <path d="M7 27 C7 24.8 13 23 20 23 C27 23 33 24.8 33 27 L33 31 C33 33.2 27 35 20 35 C13 35 7 33.2 7 31 Z" fill="#0ecb81" fillOpacity="0.18" stroke="#0ecb81" strokeWidth="1" strokeOpacity="0.35"/>
    {/* tier 2 */}
    <ellipse cx="20" cy="20" rx="13" ry="4" fill="#0ecb81" fillOpacity="0.35"/>
    <path d="M7 16 C7 13.8 13 12 20 12 C27 12 33 13.8 33 16 L33 20 C33 22.2 27 24 20 24 C13 24 7 22.2 7 20 Z" fill="#0ecb81" fillOpacity="0.25" stroke="#0ecb81" strokeWidth="1" strokeOpacity="0.5"/>
    {/* tier 1 (top) */}
    <ellipse cx="20" cy="9" rx="13" ry="4" fill="url(#db-g)"/>
    <path d="M7 5 C7 2.8 13 1 20 1 C27 1 33 2.8 33 5 L33 9 C33 11.2 27 13 20 13 C13 13 7 11.2 7 9 Z" fill="#0ecb81" fillOpacity="0.35" stroke="#0ecb81" strokeWidth="1.2" strokeOpacity="0.7"/>
    {/* shine lines */}
    <line x1="13" y1="8" x2="27" y2="8" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.5"/>
    <line x1="15" y1="19" x2="25" y2="19" stroke="white" strokeWidth="1" strokeLinecap="round" strokeOpacity="0.3"/>
  </svg>
);

/* ── Fire: polished flame ────────────────────────────────────────────────── */
const IcoFire = () => (
  <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 shrink-0">
    <path d="M8 15C10.76 15 13 12.76 13 10c0-1.8-.9-3.4-2.3-4.4.1.6.1 1.2-.1 1.8-.4 1.2-1.4 1.9-2.4 1.9-.5 0-1-.2-1.4-.5C6.3 9.8 6 10.9 6 12c0 .6.1 1.1.4 1.6C5.6 13 5 11.9 5 10.7c0-1.3.5-2.5 1.4-3.4-.2-.7-.4-1.5-.4-2.3 0-.5.1-1.1.2-1.6C5 4.4 4 6 4 7.8c0 .6.1 1.1.3 1.6C3.5 10.4 3 11.6 3 13c0 1.1 1.7 2 5 2z" fill="#f97316" fillOpacity="0.9"/>
    <path d="M8 15c1 0 1.8-.8 1.8-1.8S9 11.4 8 11.4s-1.8.8-1.8 1.8S7 15 8 15z" fill="#fde68a"/>
  </svg>
);

/* ── Refresh: clean circular arrow ───────────────────────────────────────── */
const IcoRefresh = () => (
  <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
    <path d="M2.5 8a5.5 5.5 0 1 0 1-3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2.5 2.5v3h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/* ── Arrow: clean chevron right ──────────────────────────────────────────── */
const IcoArrow = () => (
  <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0">
    <path d="M1.5 6h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    <path d="M7 2.5L10.5 6 7 9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/* ── TrendUp: upward arrow with line ─────────────────────────────────────── */
const IcoTrendUp = () => (
  <svg viewBox="0 0 14 14" fill="none" className="w-3.5 h-3.5 shrink-0">
    <polyline points="1,11 4.5,7 7,9.5 13,3" stroke="#0ecb81" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    <polyline points="9.5,3 13,3 13,6.5" stroke="#0ecb81" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/* ── TrendDown: downward arrow with line ─────────────────────────────────── */
const IcoTrendDown = () => (
  <svg viewBox="0 0 14 14" fill="none" className="w-3.5 h-3.5 shrink-0">
    <polyline points="1,3 4.5,7 7,4.5 13,11" stroke="#f6465d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    <polyline points="9.5,11 13,11 13,7.5" stroke="#f6465d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/* ── Zap: filled lightning bolt ──────────────────────────────────────────── */
const IcoZap = () => (
  <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 shrink-0" aria-hidden>
    <path d="M9.5 1.5 L3.5 8.5 H7.5 L6.5 14.5 L12.5 7.5 H8.5 Z" fill="currentColor" stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round"/>
  </svg>
);

// ─── Coin image with fallback ─────────────────────────────────────────────────

function CoinImg({ src, alt, size = 32 }: { src: string; alt: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (err) return (
    <div className="rounded-full bg-muted flex items-center justify-center text-[9px] font-black text-muted-foreground shrink-0 uppercase ring-1 ring-border/60"
      style={{ width: size, height: size }}>{alt.slice(0, 2)}</div>
  );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={size} height={size} onError={() => setErr(true)}
      className="rounded-full shrink-0 object-cover ring-1 ring-border/60"
      style={{ width: size, height: size }} />
  );
}

// ─── Real sparkline from price array ─────────────────────────────────────────

function CoinSparkline({ prices, positive, w = 72, h = 28, fillOpacity = 0.22, fluid = false }: { prices: number[]; positive: boolean; w?: number; h?: number; fillOpacity?: number; fluid?: boolean }) {
  if (!prices || prices.length < 4) return <div style={fluid ? { width: "100%", height: h } : { width: w, height: h }} />;
  const step = Math.max(1, Math.floor(prices.length / 36));
  const pts = prices.filter((_, i) => i % step === 0);
  const min = Math.min(...pts); const max = Math.max(...pts); const range = max - min || 1;
  const vw = fluid ? 100 : w;
  const norm = pts.map((p, i) => [
    (i / (pts.length - 1)) * (vw - 2) + 1,
    (h - 3) - ((p - min) / range) * (h - 6) + 1,
  ] as [number, number]);
  const line = norm.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const fill = `${line}L${(vw - 1)},${h}L1,${h}Z`;
  const color = positive ? "#0ecb81" : "#f6465d";
  const uid = `cs${Math.abs(pts[0] * 100) | 0}${pts.length}${vw}`;
  return (
    <svg viewBox={`0 0 ${vw} ${h}`} fill="none" preserveAspectRatio="none"
      style={fluid ? { width: "100%", height: h, display: "block" } : { width: w, height: h }}
      className={fluid ? "" : "shrink-0"}>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={fillOpacity} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${uid})`} />
      <path d={line} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ─── Deterministic sparkline (for our signals) ────────────────────────────────

function SigSparkline({ symbol, isLong }: { symbol: string; isLong: boolean }) {
  const seed = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = (i: number) => { const x = Math.sin(seed + i * 17.13) * 10000; return x - Math.floor(x); };
  const n = 20; let val = 50; const trend = isLong ? 1.2 : -1.2;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) { val = Math.max(4, Math.min(96, val + trend + (rand(i) - 0.45) * 9)); pts.push([i * (68 / (n - 1)), val]); }
  const minY = Math.min(...pts.map(p => p[1])); const maxY = Math.max(...pts.map(p => p[1]));
  const norm = pts.map(([x, y]) => [x, 2 + ((y - minY) / (maxY - minY || 1)) * 22] as [number, number]);
  const line = norm.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${(26 - y).toFixed(1)}`).join(" ");
  const fill = `${line}L${norm[n - 1][0].toFixed(1)},26L0,26Z`;
  const color = isLong ? "#0ecb81" : "#f6465d";
  const uid = `ss${seed}`;
  return (
    <svg viewBox="0 0 68 26" fill="none" className="w-[68px] h-[26px] shrink-0">
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${uid})`} />
      <path d={line} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Sentiment arc gauge ──────────────────────────────────────────────────────

function SentimentGauge({ bulls, total }: { bulls: number; total: number }) {
  const pct  = total > 0 ? Math.round((bulls / total) * 100) : 50;
  const bears = total - bulls;
  const [live, setLive] = React.useState(0);
  React.useEffect(() => { const t = setTimeout(() => setLive(pct), 100); return () => clearTimeout(t); }, [pct]);

  const lc    = live >= 60 ? "#0ecb81" : live <= 40 ? "#ef4444" : "#f59e0b";
  const label = live >= 75 ? "Bullish" : live >= 60 ? "Slight Bull" : live >= 40 ? "Neutral" : live >= 25 ? "Slight Bear" : "Bearish";

  // 270° arc ring (starts bottom-left, ends bottom-right)
  const r = 43, sw = 9;
  const circ = 2 * Math.PI * r;
  const arcLen = circ * 0.75;                     // 270° = 75% of full circle
  const filled = arcLen * (live / 100);
  const dashArr = `${filled} ${circ}`;
  // rotate so arc starts at 135° (bottom-left)
  const rotation = 135;

  return (
    <div className="w-full select-none py-1 sm:py-2">
      <div className="flex items-center gap-2 sm:gap-4 px-2 sm:px-3">

        {/* ── ring ── */}
        <div className="relative shrink-0 w-[72px] h-[72px] sm:w-[100px] sm:h-[100px]">
          <svg width="100%" height="100%" viewBox="0 0 100 100">
            <defs>
              <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="#ef4444" />
                <stop offset="35%"  stopColor="#f97316" />
                <stop offset="55%"  stopColor="#f59e0b" />
                <stop offset="80%"  stopColor="#22c55e" />
                <stop offset="100%" stopColor="#0ecb81" />
              </linearGradient>
              <filter id="ring-glow">
                <feGaussianBlur stdDeviation="2.5" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>

            {/* track */}
            <circle cx="50" cy="50" r={r} fill="none"
              stroke="currentColor" strokeWidth={sw} strokeDasharray={`${arcLen} ${circ}`}
              strokeDashoffset={0} strokeLinecap="round" opacity="0.08"
              transform={`rotate(${rotation} 50 50)`} />

            {/* progress */}
            <circle cx="50" cy="50" r={r} fill="none"
              stroke="url(#ring-grad)" strokeWidth={sw}
              strokeDasharray={dashArr}
              strokeLinecap="round"
              transform={`rotate(${rotation} 50 50)`}
              filter="url(#ring-glow)"
              style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.34,1.56,0.64,1)" }} />
          </svg>

          {/* centre text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[16px] sm:text-[22px] font-bold tabular-nums leading-none"
              style={{ color: lc, transition: "color 0.5s" }}>{live}</span>
            <span className="text-[7px] sm:text-[8px] font-semibold uppercase tracking-widest mt-0.5"
              style={{ color: lc, transition: "color 0.5s", opacity: 0.8 }}>{label}</span>
          </div>
        </div>

        {/* ── stats ── */}
        <div className="flex flex-col gap-2 sm:gap-3 flex-1 min-w-0">
          {/* bull */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-[#0ecb81]">Bullish</span>
              <span className="text-[11px] font-bold tabular-nums text-[#0ecb81]">{bulls}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-[#0ecb81] transition-all duration-1000"
                style={{ width: `${live}%` }} />
            </div>
          </div>
          {/* bear */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-[#ef4444]">Bearish</span>
              <span className="text-[11px] font-bold tabular-nums text-[#ef4444]">{bears}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-[#ef4444] transition-all duration-1000"
                style={{ width: `${100 - live}%` }} />
            </div>
          </div>
          {/* ratio bar */}
          <div className="h-1 rounded-full overflow-hidden flex">
            <div className="h-full bg-[#0ecb81] transition-all duration-1000 rounded-l-full"
              style={{ width: `${live}%` }} />
            <div className="h-full bg-[#ef4444] transition-all duration-1000 rounded-r-full"
              style={{ width: `${100 - live}%` }} />
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Fear & Greed Card ────────────────────────────────────────────────────────

function FearGreedCard({ data }: { data: { value: number; classification: string; yesterday: number; lastWeek: number } | null }) {
  const [live, setLive] = React.useState(0);
  React.useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => setLive(data.value), 150);
    return () => clearTimeout(t);
  }, [data]);

  const color  = live >= 60 ? "#0ecb81" : live <= 40 ? "#ef4444" : "#f59e0b";
  const glow   = live >= 60 ? "#0ecb8130" : live <= 40 ? "#ef444430" : "#f59e0b30";
  const label  = live >= 80 ? "Extreme Greed" : live >= 60 ? "Greed" : live >= 45 ? "Neutral" : live >= 25 ? "Fear" : "Extreme Fear";

  const delta     = data ? data.value - data.yesterday : 0;
  const weekDelta = data ? data.value - data.lastWeek  : 0;

  const zones = [
    { label: "E.Fear", max: 25, color: "#ef4444" },
    { label: "Fear",   max: 45, color: "#f97316" },
    { label: "Neutral",max: 55, color: "#f59e0b" },
    { label: "Greed",  max: 75, color: "#22c55e" },
    { label: "E.Greed",max: 100,color: "#0ecb81" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* top accent bar */}
      <div className="h-[2px]" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />

      <div className="p-3 sm:p-4">
        {!data ? (
          <div className="space-y-3">
            <div className="h-14 animate-pulse bg-muted rounded-xl" />
            <div className="h-3 animate-pulse bg-muted rounded w-3/4" />
            <div className="h-3 animate-pulse bg-muted rounded w-1/2" />
          </div>
        ) : (
          <>
            {/* header row */}
            <div className="flex items-start justify-between mb-2 sm:mb-4">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Fear &amp; Greed</p>
                <div className="flex items-end gap-1.5 sm:gap-2">
                  <span className="text-[18px] sm:text-[28px] font-black tabular-nums leading-none"
                    style={{ color, textShadow: `0 0 32px ${glow}`, transition: "color 0.6s, text-shadow 0.6s" }}>
                    {live}
                  </span>
                  <span className="text-[10px] sm:text-[11px] font-semibold mb-1 leading-tight" style={{ color, opacity: 0.85 }}>
                    {label}
                  </span>
                </div>
              </div>
              {/* mini ring */}
              <div className="relative shrink-0 mt-0.5" style={{ width: 36, height: 36 }}>
                <svg width="36" height="36" viewBox="0 0 48 48">
                  <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="5" opacity="0.08"
                    strokeDasharray={`${2*Math.PI*20*0.75} ${2*Math.PI*20}`} strokeLinecap="round"
                    transform="rotate(135 24 24)" />
                  <circle cx="24" cy="24" r="20" fill="none" strokeWidth="5" strokeLinecap="round"
                    stroke={color}
                    strokeDasharray={`${2*Math.PI*20*0.75*(live/100)} ${2*Math.PI*20}`}
                    transform="rotate(135 24 24)"
                    style={{ transition: "stroke-dasharray 1.4s cubic-bezier(0.34,1.56,0.64,1), stroke 0.6s", filter: `drop-shadow(0 0 4px ${glow})` }} />
                </svg>
              </div>
            </div>

            {/* gradient meter */}
            <div className="relative h-2 rounded-full mb-1 overflow-visible"
              style={{ background: "linear-gradient(90deg,#ef4444 0%,#f97316 25%,#f59e0b 45%,#22c55e 65%,#0ecb81 100%)" }}>
              <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-card shadow-lg transition-all duration-[1400ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                style={{ left: `calc(${live}% - 6px)`, background: color, boxShadow: `0 0 8px ${glow}` }} />
            </div>

            {/* zone labels */}
            <div className="flex justify-between mb-2 sm:mb-4">
              {zones.map(z => (
                <span key={z.label} className="text-[7px] font-medium" style={{ color: z.color, opacity: 0.6 }}>{z.label}</span>
              ))}
            </div>

            {/* comparison pills */}
            <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
              {[
                { label: "Yesterday", val: data.yesterday, d: delta },
                { label: "Last Week", val: data.lastWeek,  d: weekDelta },
              ].map(({ label: lb, val, d }) => {
                const c = val >= 60 ? "#0ecb81" : val <= 40 ? "#ef4444" : "#f59e0b";
                const dc = d > 0 ? "#0ecb81" : d < 0 ? "#ef4444" : "#888";
                const arrow = d > 0 ? "↑" : d < 0 ? "↓" : "→";
                return (
                  <div key={lb} className="rounded-lg bg-muted/40 border border-border/30 px-2 sm:px-3 py-1.5 sm:py-2">
                    <p className="text-[8px] text-muted-foreground mb-0.5 sm:mb-1">{lb}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] sm:text-[14px] font-bold tabular-nums" style={{ color: c }}>{val}</span>
                      <span className="text-[9px] font-semibold" style={{ color: dc }}>{arrow}{Math.abs(d)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Market Stats Card ────────────────────────────────────────────────────────

function MarketStatsCard({ data }: { data: { btcDominance: number; totalMarketCap: number; totalVolume24h: number; marketCapChange24h: number } | null }) {
  const [btcLive, setBtcLive] = React.useState(0);
  React.useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => setBtcLive(data.btcDominance), 200);
    return () => clearTimeout(t);
  }, [data]);

  function fmtT(n: number) {
    if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
    if (n >= 1e9)  return (n / 1e9).toFixed(1) + "B";
    return (n / 1e6).toFixed(0) + "M";
  }

  const changeColor = data && data.marketCapChange24h >= 0 ? "#0ecb81" : "#ef4444";
  const changeArrow = data && data.marketCapChange24h >= 0 ? "↑" : "↓";

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* top accent bar */}
      <div className="h-[2px]" style={{ background: "linear-gradient(90deg, #f59e0b, transparent)" }} />

      <div className="p-3 sm:p-4">
        {!data ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 animate-pulse bg-muted rounded-xl" />)}
          </div>
        ) : (
          <>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 sm:mb-3">Market Overview</p>

            {/* 2x2 stat grid */}
            <div className="grid grid-cols-2 gap-1.5 sm:gap-2 mb-2 sm:mb-4">
              {/* Total Market Cap */}
              <div className="col-span-2 rounded-lg bg-muted/40 border border-border/30 px-2 sm:px-3 py-1.5 sm:py-2.5">
                <p className="text-[8px] text-muted-foreground mb-0.5 sm:mb-1">Total Market Cap</p>
                <div className="flex items-end justify-between">
                  <span className="text-[13px] sm:text-[16px] font-black tabular-nums leading-none text-foreground">${fmtT(data.totalMarketCap)}</span>
                  <span className="text-[10px] font-semibold tabular-nums" style={{ color: changeColor }}>
                    {changeArrow}{Math.abs(data.marketCapChange24h)}%
                  </span>
                </div>
              </div>

              {/* 24h Volume */}
              <div className="rounded-lg bg-muted/40 border border-border/30 px-2 sm:px-3 py-1.5 sm:py-2.5">
                <p className="text-[8px] text-muted-foreground mb-0.5 sm:mb-1">24h Volume</p>
                <span className="text-[12px] sm:text-[15px] font-bold tabular-nums text-foreground">${fmtT(data.totalVolume24h)}</span>
              </div>

              {/* BTC dominance */}
              <div className="rounded-lg border border-border/30 px-2 sm:px-3 py-1.5 sm:py-2.5"
                style={{ background: "#f59e0b0d" }}>
                <p className="text-[8px] text-muted-foreground mb-0.5 sm:mb-1">BTC Dom.</p>
                <span className="text-[12px] sm:text-[15px] font-bold tabular-nums" style={{ color: "#f59e0b" }}>{data.btcDominance}%</span>
              </div>
            </div>

            {/* BTC vs Alt dominance bar */}
            <div>
              <div className="flex items-center justify-between mb-1.5 sm:mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#f59e0b" }} />
                  <span className="text-[9px] font-semibold text-foreground">Bitcoin</span>
                  <span className="text-[9px] font-bold tabular-nums" style={{ color: "#f59e0b" }}>{data.btcDominance}%</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold tabular-nums" style={{ color: "#60a5fa" }}>{(100 - data.btcDominance).toFixed(1)}%</span>
                  <span className="text-[9px] font-semibold text-foreground">Altcoins</span>
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#60a5fa" }} />
                </div>
              </div>

              <div className="h-2.5 rounded-full overflow-hidden flex gap-0.5">
                <div className="h-full rounded-l-full transition-all duration-[1200ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                  style={{ width: `${btcLive}%`, background: "linear-gradient(90deg,#d97706,#f59e0b)" }} />
                <div className="h-full rounded-r-full flex-1"
                  style={{ background: "linear-gradient(90deg,#3b82f6,#60a5fa)" }} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SK({ w, h = 12, rounded, className }: { w?: number | string; h?: number; rounded?: boolean; className?: string }) {
  return <div className={cn("animate-pulse bg-muted", rounded ? "rounded-full" : "rounded", className)} style={{ width: w, height: h }} />;
}

// ─── Scanner modules ──────────────────────────────────────────────────────────

const MODULES = [
  { href: "/ema3crossover", key: "binance", label: "EMA 3 Cross",    sub: "Triple alignment · 7 › 25 › 99",    color: "#60a5fa", Ico: IcoEMA,
    desc: "EMA fan patterns with ADX filter, spread gate and ML score. Fires immediately on crossover." },
  { href: "/ict",           key: "ict",     label: "ICT Scanner",     sub: "Smart Money · OB · FVG · Kill Zones", color: "#a855f7", Ico: IcoICT,
    desc: "ICT framework: liquidity sweeps, order blocks, fair value gaps, CHoCH and BOS structure." },
  { href: "/smc",           key: "smc",     label: "SMC Scanner",     sub: "Structure · BOS · CHoCH · S/D Zones", color: "#f59e0b", Ico: IcoSMC,
    desc: "Smart Money Concepts: 7-point confluence, supply/demand zones, inducement and mitigation." },
  { href: "/history",       key: "history", label: "Signal Database", sub: "Historical · Filters · Export",       color: "#0ecb81", Ico: IcoDB,
    desc: "Full signal history with direction, source, score and date filters. CSV export." },
];

// ─── Trending coin card ───────────────────────────────────────────────────────

const CARD_THEMES = [
  { from: "#f97316", to: "#ef4444", label: "orange" },
  { from: "#a855f7", to: "#6366f1", label: "purple" },
  { from: "#0ea5e9", to: "#22d3ee", label: "blue"   },
  { from: "#0ecb81", to: "#34d399", label: "green"  },
  { from: "#f59e0b", to: "#fb923c", label: "amber"  },
  { from: "#ec4899", to: "#a855f7", label: "pink"   },
  { from: "#6366f1", to: "#0ea5e9", label: "indigo" },
];

function TrendingCoinCard({ item, rank }: { item: CGTrendingItem; rank: number }) {
  const { name, symbol, thumb, market_cap_rank, data } = item.item;
  const pct    = data?.price_change_percentage_24h?.usd ?? 0;
  const pos    = pct >= 0;
  const accent = CARD_THEMES[(rank - 1) % CARD_THEMES.length].from;
  const pctColor = pos ? "#0ecb81" : "#f6465d";

  return (
    <div className="shrink-0 min-w-[150px] w-[150px] sm:w-[180px] rounded-xl bg-card border border-border hover:border-border/80 hover:shadow-md transition-all duration-150 cursor-pointer select-none overflow-hidden">

      {/* accent line */}
      <div className="h-[2px]" style={{ background: accent }} />

      <div className="p-2.5 sm:p-3 flex flex-col gap-2.5">

        {/* Top row: icon + rank + mc */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full overflow-hidden bg-muted/50 ring-1 ring-border shrink-0">
            <CoinImg src={thumb} alt={symbol} size={32} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-foreground leading-tight truncate">{name}</p>
            <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">{symbol}</p>
          </div>
          <span className="text-[10px] font-semibold tabular-nums shrink-0" style={{ color: accent }}>#{rank}</span>
        </div>

        {/* Bottom row: price + change pill */}
        <div className="flex items-center justify-between gap-1">
          <p className="text-[11px] font-semibold text-foreground tabular-nums">{fmtCGPrice(data?.price)}</p>
          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-semibold tabular-nums"
            style={{ color: pctColor, background: `${pctColor}14` }}>
            {pos ? "▲" : "▼"} {fmtPct(pct)}
          </span>
        </div>

        {/* MC rank */}
        {market_cap_rank && (
          <p className="text-[8px] font-normal text-muted-foreground">Market Cap Rank #{market_cap_rank}</p>
        )}
      </div>
    </div>
  );
}

// ─── Gainers / Losers panel ───────────────────────────────────────────────────

function MarketCard({
  title, accent, positive, coins, loading, error,
}: {
  title: string; accent: string; positive: boolean;
  coins: CGMarketCoin[]; loading: boolean; error: boolean;
}) {
  const hero   = coins[0];
  const rest   = coins.slice(1);
  const heroPct = hero ? Math.abs(hero.price_change_percentage_24h ?? 0).toFixed(2) : "0";

  if (loading) return (
    <div className="rounded-3xl border border-border/50 bg-card overflow-hidden flex flex-col gap-0">
      <div className="h-[140px] animate-pulse bg-muted/60" />
      <table className="w-full" style={{ tableLayout: "fixed", borderCollapse: "collapse" }}>
        <colgroup>
          <col style={{ width: 32 }} />
          <col style={{ width: 36 }} />
          <col />
          <col className="hidden sm:table-column" style={{ width: 80 }} />
          <col className="hidden md:table-column" style={{ width: 80 }} />
          <col style={{ width: 100 }} />
        </colgroup>
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i} className="border-t border-border/20">
              <td className="pl-5 pr-1 py-3"><SK w={12} h={10} /></td>
              <td className="px-1 py-3"><SK w={26} h={26} rounded /></td>
              <td className="px-2 py-2"><div className="flex items-center gap-2"><div className="space-y-1.5 shrink-0"><SK w={80} /><SK w={44} h={8} /></div><SK className="flex-1" h={30} /></div></td>
              <td className="hidden sm:table-cell px-2 py-3"><SK w={52} h={10} className="ml-auto" /></td>
              <td className="hidden md:table-cell px-2 py-3"><SK w={52} h={10} className="ml-auto" /></td>
              <td className="pl-2 pr-5 py-3"><div className="space-y-1 flex flex-col items-end"><SK w={64} /><SK w={36} h={8} /></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (error || coins.length === 0) return (
    <div className="rounded-3xl border border-border/50 bg-card flex items-center justify-center h-48">
      <p className="text-[11px] text-muted-foreground">No data available</p>
    </div>
  );

  return (
    <div className="rounded-3xl border overflow-hidden flex flex-col bg-card"
      style={{ borderColor: `${accent}22` }}>

      {/* ── HERO — #1 coin ── */}
      <div className="relative overflow-hidden" style={{ minHeight: 110 }}>
        {/* layered background */}
        <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${accent}22 0%, ${accent}08 60%, transparent 100%)` }} />
        <div className="absolute -right-8 -top-8 w-48 h-48 rounded-full blur-3xl pointer-events-none opacity-30"
          style={{ background: accent }} />

        {/* sparkline as hero background art */}
        {hero && (
          <div className="absolute bottom-0 right-0 left-0 opacity-20 pointer-events-none">
            <CoinSparkline prices={hero.sparkline_in_7d?.price ?? []} positive={positive} w={999} h={80} />
          </div>
        )}

        <div className="relative px-5 pt-5 pb-5 flex items-start gap-4">
          {/* coin image */}
          <div className="relative shrink-0 mt-1">
            <div className="absolute inset-0 rounded-full blur-xl opacity-50" style={{ background: accent }} />
            <div className="relative w-12 h-12 sm:w-16 sm:h-16 rounded-full overflow-hidden bg-card/50"
              style={{ outline: `2px solid ${accent}50` }}>
              <CoinImg src={hero?.image ?? ""} alt={hero?.symbol ?? ""} size={64} />
            </div>
          </div>

          {/* info block */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[8px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full"
                style={{ background: `${accent}20`, color: accent, border: `1px solid ${accent}35` }}>
                {positive ? "▲ TOP GAINER" : "▼ TOP LOSER"}
              </span>
              <span className="text-[8px] font-medium text-muted-foreground uppercase tracking-widest">24H</span>
            </div>
            <p className="text-[15px] sm:text-[19px] font-bold text-foreground leading-tight truncate">{hero?.name}</p>
            <p className="text-[9px] font-medium uppercase tracking-widest mt-0.5 mb-3" style={{ color: `${accent}70` }}>{hero?.symbol}</p>

            {/* stat pills row */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* volume */}
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-background/60 border border-border/40">
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0 text-muted-foreground">
                  <rect x="1" y="4" width="2.5" height="7" rx="0.8" fill="currentColor" opacity="0.4"/>
                  <rect x="4.75" y="2" width="2.5" height="9" rx="0.8" fill="currentColor" opacity="0.65"/>
                  <rect x="8.5" y="0.5" width="2.5" height="10.5" rx="0.8" fill="currentColor"/>
                </svg>
                <div>
                  <p className="text-[7px] font-medium text-muted-foreground uppercase tracking-wide leading-none mb-0.5">Vol 24H</p>
                  <p className="text-[10px] font-semibold text-foreground tabular-nums">{fmtVol(hero?.total_volume ?? 0)}</p>
                </div>
              </div>
              {/* market cap */}
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-background/60 border border-border/40">
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0 text-muted-foreground">
                  <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" opacity="0.5"/>
                  <path d="M6 3v6M4 4.5h2.5a1 1 0 0 1 0 2H4m0 0h3a1 1 0 0 1 0 2H4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                </svg>
                <div>
                  <p className="text-[7px] font-medium text-muted-foreground uppercase tracking-wide leading-none mb-0.5">Mkt Cap</p>
                  <p className="text-[10px] font-semibold text-foreground tabular-nums">{fmtVol(hero?.market_cap ?? 0)}</p>
                </div>
              </div>
              {/* price */}
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-background/60 border border-border/40">
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0 text-muted-foreground">
                  <path d="M2 9L5 6l2.5 2L10 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.8"/>
                </svg>
                <div>
                  <p className="text-[7px] font-medium text-muted-foreground uppercase tracking-wide leading-none mb-0.5">Price</p>
                  <p className="text-[10px] font-semibold text-foreground tabular-nums">{fmtPrice(hero?.current_price ?? 0)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* big % hero number */}
          <div className="shrink-0 text-right">
            <p className="font-bold tabular-nums leading-none text-[22px] sm:text-[30px]" style={{ color: accent }}>
              {positive ? "+" : "−"}{heroPct}%
            </p>
            <p className="text-[8px] font-medium text-muted-foreground mt-1.5 uppercase tracking-widest">24h change</p>
          </div>
        </div>
      </div>

      {/* ── divider ── */}
      <div className="h-px" style={{ background: `linear-gradient(90deg, ${accent}25, transparent)` }} />

      {/* ── table ── */}
      <table className="w-full text-left" style={{ tableLayout: "fixed", borderCollapse: "collapse" }}>
        <colgroup>
          <col style={{ width: 32 }} />
          <col style={{ width: 36 }} />
          <col />
          <col className="hidden sm:table-column" style={{ width: 80 }} />
          <col className="hidden md:table-column" style={{ width: 80 }} />
          <col style={{ width: 100 }} />
        </colgroup>
        <thead>
          <tr className="bg-muted/20">
            <th className="pl-5 pr-1 py-2 text-center text-[8px] font-medium text-muted-foreground uppercase tracking-wider">#</th>
            <th className="px-1 py-2"></th>
            <th className="px-2 py-2 text-[8px] font-medium text-muted-foreground uppercase tracking-wider">Coin</th>
            <th className="hidden sm:table-cell px-2 py-2 text-right text-[8px] font-medium text-muted-foreground uppercase tracking-wider">Volume</th>
            <th className="hidden md:table-cell px-2 py-2 text-right text-[8px] font-medium text-muted-foreground uppercase tracking-wider">Mkt Cap</th>
            <th className="pl-2 pr-5 py-2 text-right text-[8px] font-medium text-muted-foreground uppercase tracking-wider">Price</th>
          </tr>
        </thead>
        <tbody>
          {rest.map((coin, i) => {
            const pct    = coin.price_change_percentage_24h ?? 0;
            const absPct = Math.abs(pct).toFixed(2);
            return (
              <tr key={coin.id}
                className="group border-t border-border/10 hover:bg-muted/20 transition-colors duration-100 cursor-default">

                <td className="pl-5 pr-1 py-2.5 text-center align-middle">
                  <span className="text-[9px] font-normal tabular-nums text-muted-foreground">{i + 2}</span>
                </td>

                <td className="px-1 py-2.5 align-middle">
                  <CoinImg src={coin.image} alt={coin.symbol} size={26} />
                </td>

                {/* Coin name + inline sparkline fills the gap */}
                <td className="px-2 py-1.5 align-middle overflow-hidden">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="shrink-0">
                      <p className="text-[11px] font-semibold text-foreground leading-tight whitespace-nowrap">{coin.name}</p>
                      <p className="text-[8px] font-normal text-muted-foreground uppercase tracking-wide mt-0.5">{coin.symbol}</p>
                    </div>
                    <div className="flex-1 min-w-[40px] rounded-md overflow-hidden" style={{ background: `${accent}0d` }}>
                      <CoinSparkline
                        prices={coin.sparkline_in_7d?.price ?? []}
                        positive={positive}
                        h={30}
                        fillOpacity={0.40}
                        fluid
                      />
                    </div>
                  </div>
                </td>

                <td className="hidden sm:table-cell px-2 py-2.5 text-right align-middle">
                  <span className="text-[10px] font-medium text-foreground tabular-nums">{fmtVol(coin.total_volume)}</span>
                </td>

                <td className="hidden md:table-cell px-2 py-2.5 text-right align-middle">
                  <span className="text-[10px] font-medium text-foreground tabular-nums">{fmtVol(coin.market_cap)}</span>
                </td>

                <td className="pl-2 pr-5 py-2.5 text-right align-middle">
                  <p className="text-[11px] font-semibold text-foreground tabular-nums leading-tight">{fmtPrice(coin.current_price)}</p>
                  <p className="text-[9px] font-medium tabular-nums mt-0.5" style={{ color: accent }}>{positive ? "+" : "−"}{absPct}%</p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Signal card (hot signals row) ───────────────────────────────────────────

function SignalCard({ sig, rank }: { sig: ApiSignal; rank: number }) {
  const isLong = sig.direction === "LONG";
  const score = Math.round((sig.ml_score ?? sig.confluence_score ?? 0) * 100);
  const coin = sig.symbol.replace(/USDT$|BUSD$|BTC$/, "").toLowerCase();
  const color = isLong ? "#0ecb81" : "#f6465d";
  const href = sig.source === "binance" ? "/ema3crossover" : sig.source === "ict" ? "/ict" : "/smc";
  const extra = (sig.extra ?? {}) as Record<string, number>;
  const change = extra.change_24h ?? 0;
  return (
    <Link href={href}>
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-3 sm:p-4 min-w-[138px] sm:min-w-[148px] shrink-0 hover:border-foreground/25 hover:shadow-md transition-all cursor-pointer group">
        <div className="absolute top-0 left-0 right-0 h-[2.5px] rounded-t-2xl"
          style={{ background: `linear-gradient(90deg,${color}cc,transparent)` }} />
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black text-muted-foreground">#{rank}</span>
            <div className="w-7 h-7 rounded-full overflow-hidden bg-muted ring-1 ring-border/40">
              <CoinIcon symbol={coin} size={28} />
            </div>
          </div>
          <span className={cn(
            "text-[9px] font-black px-1.5 py-0.5 rounded-full",
            isLong ? "bg-[#0ecb81]/10 text-[#0ecb81]" : "bg-[#f6465d]/10 text-[#f6465d]"
          )}>
            {isLong ? "↑ BULL" : "↓ BEAR"}
          </span>
        </div>
        <p className="text-[13px] font-black text-foreground leading-tight">{sig.symbol}</p>
        <div className="flex items-center gap-2 mt-0.5 mb-3">
          <span className="text-[9px] font-bold text-muted-foreground uppercase">
            {sig.source === "binance" ? "EMA" : sig.source.toUpperCase()} · {sig.timeframe}
          </span>
          {change !== 0 && (
            <span className={cn("text-[9px] font-black tabular-nums", change >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]")}>
              {fmtPct(change)}
            </span>
          )}
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[9px] font-bold text-muted-foreground uppercase mb-0.5">Score</p>
            <p className="text-[18px] sm:text-[22px] font-black leading-none tabular-nums" style={{ color }}>{score}</p>
          </div>
          <SigSparkline symbol={sig.symbol} isLong={isLong} />
        </div>
      </div>
    </Link>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [signals,    setSignals]    = useState<ApiSignal[]>([]);
  const [total,      setTotal]      = useState(0);
  const [scanner,    setScanner]    = useState<{ running: boolean; last_run: string | null; last_saved: number }>
    ({ running: false, last_run: null, last_saved: 0 });
  const [cgData,     setCgData]     = useState<{ trending: CGTrendingItem[]; gainers: CGMarketCoin[]; losers: CGMarketCoin[] }>
    ({ trending: [], gainers: [], losers: [] });
  const [sigsLoading, setSigsLoading] = useState(true);
  const [cgLoading,   setCgLoading]   = useState(true);
  const [cgError,     setCgError]     = useState(false);
  const [sortBy,      setSortBy]      = useState<"score" | "age">("score");
  const [filterSrc,   setFilterSrc]   = useState<"all" | "binance" | "ict" | "smc">("all");
  const [refreshing,  setRefreshing]  = useState(false);
  const [fearGreed,   setFearGreed]   = useState<{ value: number; classification: string; yesterday: number; lastWeek: number } | null>(null);
  const [marketGlobal, setMarketGlobal] = useState<{ btcDominance: number; totalMarketCap: number; totalVolume24h: number; marketCapChange24h: number } | null>(null);

  const loadSignals = async (spinner = false) => {
    if (spinner) setRefreshing(true);
    try {
      const d = await getHomeDataAction();
      setSignals(d.topSignals);
      setTotal(d.total);
      setScanner(d.scanner);
    } catch {
      // backend unavailable — leave previous state, stop spinner
    } finally { setSigsLoading(false); setRefreshing(false); }
  };

  const loadCG = async () => {
    setCgLoading(true);
    try {
      const d = await getCoinGeckoDataAction();
      if (d.rateLimited) setCgError(true);
      else { setCgData(d); setCgError(false); }
    } catch { setCgError(true); }
    finally { setCgLoading(false); }
  };

  const loadMarketExtras = async () => {
    try {
      const [fg, mg] = await Promise.allSettled([getFearGreedAction(), getMarketGlobalAction()]);
      if (fg.status === "fulfilled" && fg.value) setFearGreed(fg.value);
      if (mg.status === "fulfilled" && mg.value) setMarketGlobal(mg.value);
    } catch {
      // silently degrade — cards show skeleton state
    }
  };

  useEffect(() => { loadSignals(); loadCG(); loadMarketExtras(); }, []);

  const bulls    = signals.filter(s => s.direction === "LONG").length;
  const bears    = signals.filter(s => s.direction === "SHORT").length;
  const avgScore = signals.length
    ? Math.round(signals.reduce((a, s) => a + Math.round((s.ml_score ?? s.confluence_score ?? 0) * 100), 0) / signals.length)
    : 0;

  const hotSignals = [...signals]
    .sort((a, b) => (b.ml_score ?? b.confluence_score ?? 0) - (a.ml_score ?? a.confluence_score ?? 0))
    .slice(0, 8);

  const filtered = filterSrc === "all" ? signals : signals.filter(s => s.source === filterSrc);

  const sorted = [...filtered].sort((a, b) =>
    sortBy === "score"
      ? (b.ml_score ?? b.confluence_score ?? 0) - (a.ml_score ?? a.confluence_score ?? 0)
      : new Date(b.signal_time).getTime() - new Date(a.signal_time).getTime()
  );

  const srcCounts: Record<string, number> = {};
  signals.forEach(s => { srcCounts[s.source] = (srcCounts[s.source] ?? 0) + 1; });

  return (
    <div className="space-y-3 sm:space-y-5 max-w-[1500px] mx-auto">

      {/* ── Stats strip ── */}
      <div className="flex items-center gap-3 sm:gap-5 py-2 border-b border-border/40 overflow-x-auto text-[10px] sm:text-[11px] font-normal" style={{ scrollbarWidth: "none" }}>
        {[
          { label: "Signals",    val: sigsLoading ? "…" : total.toLocaleString(),  color: "" },
          { label: "Bullish",    val: sigsLoading ? "…" : `${signals.length ? Math.round(bulls / signals.length * 100) : 0}%`, color: "text-[#0ecb81]" },
          { label: "Bearish",    val: sigsLoading ? "…" : `${signals.length ? Math.round(bears / signals.length * 100) : 0}%`, color: "text-[#f6465d]" },
          { label: "Avg Score",  val: sigsLoading ? "…" : String(avgScore), color: "" },
        ].map(({ label, val, color }, i) => (
          <React.Fragment key={label}>
            {i > 0 && <span className="text-muted-foreground/50 shrink-0">|</span>}
            <span className="text-muted-foreground shrink-0">
              {label}: <span className={cn("font-semibold text-foreground", color)}>{val}</span>
            </span>
          </React.Fragment>
        ))}
        <span className="text-muted-foreground/50 shrink-0">|</span>
        <span className="shrink-0 flex items-center gap-1.5 text-muted-foreground">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", scanner.running ? "bg-[#0ecb81] animate-pulse" : "bg-muted-foreground/40")} />
          <span className={scanner.running ? "text-[#0ecb81] font-medium" : "font-normal"}>{scanner.running ? "Scanner Live" : "Scanner Idle"}</span>
          {scanner.last_run && <span className="text-[10px] text-muted-foreground">· {fmtAge(scanner.last_run)}</span>}
        </span>
        <div className="flex-1" />
        <button onClick={() => loadSignals(true)} disabled={refreshing}
          className="shrink-0 flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
          <span className={cn(refreshing && "animate-spin")}><IcoRefresh /></span>
          <span className="text-[10px]">Refresh</span>
        </button>
      </div>

      {/* ══ CoinGecko market section ══════════════════════════════════════════ */}

      {/* Trending coins */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <IcoFire />
            <h2 className="text-[11px] sm:text-[12px] font-semibold uppercase tracking-widest text-foreground">Trending Coins</h2>
            <span className="text-[9px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full border border-border/40">Trending</span>
          </div>
          <div className="flex items-center gap-2">
            {cgError && (
              <button onClick={loadCG} className="text-[10px] font-bold text-orange-400 hover:text-orange-300 transition-colors flex items-center gap-1">
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/><path d="M6 3.5v3M6 8v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                Rate limited — retry
              </button>
            )}
            {/* Scroll arrows */}
            <div className="hidden sm:flex items-center gap-1">
              <button id="trend-prev"
                className="w-7 h-7 rounded-lg border border-border bg-card hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => { document.getElementById("trend-scroll")?.scrollBy({ left: -480, behavior: "smooth" }); }}>
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3"><path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <button id="trend-next"
                className="w-7 h-7 rounded-lg border border-border bg-card hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => { document.getElementById("trend-scroll")?.scrollBy({ left: 480, behavior: "smooth" }); }}>
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3"><path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable row */}
        <div id="trend-scroll"
          className="flex gap-3 overflow-x-auto [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}>
          {cgLoading
            ? Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="min-w-[210px] h-[148px] rounded-2xl bg-muted animate-pulse shrink-0" />
              ))
            : cgError || cgData.trending.length === 0
            ? <p className="text-[11px] text-muted-foreground py-4 flex items-center gap-2">
                <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-orange-400 shrink-0"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                Market data rate-limited. Try again in a moment.
                <button onClick={loadCG} className="underline hover:text-foreground">Retry</button>
              </p>
            : cgData.trending.map((t, i) => <TrendingCoinCard key={t.item.id} item={t} rank={i + 1} />)
          }
        </div>
      </section>

      {/* Gainers + Losers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <MarketCard title="Top Gainers" accent="#0ecb81" positive={true}
          coins={cgData.gainers} loading={cgLoading} error={cgError} />
        <MarketCard title="Top Losers"  accent="#f6465d" positive={false}
          coins={cgData.losers}  loading={cgLoading} error={cgError} />
      </div>

      {/* ══ Hot signals ══════════════════════════════════════════════════════ */}

      {(sigsLoading || hotSignals.length > 0) && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <IcoFire />
            <h3 className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Hot Signals</h3>
            <span className="text-[9px] font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full border border-border/40">
              top {sigsLoading ? "…" : hotSignals.length} by score
            </span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
            {sigsLoading
              ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="min-w-[168px] h-[140px] rounded-2xl bg-muted animate-pulse shrink-0" />)
              : hotSignals.map((sig, i) => <SignalCard key={sig.id} sig={sig} rank={i + 1} />)
            }
          </div>
        </section>
      )}

      {/* ══ Signal table + sidebar ═══════════════════════════════════════════ */}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_304px] gap-5">

        {/* Signal table */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-3 sm:px-5 py-2.5 sm:py-3.5 border-b border-border">
            <div className="flex flex-col gap-2 sm:gap-3 w-full">
              {/* Row 1: title + sort + refresh */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <div className="min-w-0">
                    <h3 className="text-[12px] sm:text-[13px] font-semibold tracking-tight">Signal List</h3>
                    <p className="text-[8px] sm:text-[9px] text-muted-foreground font-normal uppercase tracking-widest mt-0.5 truncate">
                      {sigsLoading ? "Loading…" : `${sorted.length} Coins · ${filterSrc === "all" ? "All Sources" : filterSrc === "binance" ? "EMA" : filterSrc.toUpperCase()}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 bg-muted rounded-xl p-0.5 sm:p-1 border border-border/40 shrink-0">
                    {(["score", "age"] as const).map(v => (
                      <button key={v} onClick={() => setSortBy(v)}
                        className={cn(
                          "px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[9px] sm:text-[10px] font-black uppercase transition-all",
                          sortBy === v ? "bg-card text-foreground shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground"
                        )}>
                        {v === "score" ? "Score" : "Age"}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={() => loadSignals(true)} disabled={refreshing}
                  className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0">
                  <span className={cn(refreshing && "animate-spin")}><IcoRefresh /></span>
                </button>
              </div>

              {/* Row 2: strategy filter tabs */}
              <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar">
                {([
                  { key: "all",     label: "All",  color: "", count: signals.length },
                  { key: "binance", label: "EMA",  color: "#60a5fa", count: srcCounts["binance"] ?? 0 },
                  { key: "ict",     label: "ICT",  color: "#a855f7", count: srcCounts["ict"] ?? 0 },
                  { key: "smc",     label: "SMC",  color: "#f59e0b", count: srcCounts["smc"] ?? 0 },
                ] as const).map(tab => {
                  const active = filterSrc === tab.key;
                  return (
                    <button key={tab.key} onClick={() => setFilterSrc(tab.key)}
                      className={cn(
                        "flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl text-[9px] sm:text-[10px] font-black uppercase border transition-all shrink-0",
                        active
                          ? "bg-card text-foreground border-border shadow-sm"
                          : "text-muted-foreground border-transparent hover:border-border/50 hover:text-foreground"
                      )}
                      style={active && tab.color ? { borderColor: `${tab.color}50`, color: tab.color } : {}}>
                      {tab.color && (
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tab.color }} />
                      )}
                      {tab.label}
                      <span className={cn(
                        "text-[8px] sm:text-[9px] px-1 sm:px-1.5 py-0.5 rounded-full tabular-nums",
                        active ? "bg-muted" : "bg-muted/50"
                      )}>
                        {sigsLoading ? "…" : tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border/30 bg-muted/10">
                  <th className="pl-3 sm:pl-5 pr-1 w-7 sm:w-10 text-left text-[9px] font-medium uppercase tracking-wider text-muted-foreground py-2.5">#</th>
                  <th className="px-1.5 sm:px-2 text-left text-[9px] font-medium uppercase tracking-wider text-muted-foreground py-2.5">Coin</th>
                  <th className="px-1.5 sm:px-2 text-left text-[9px] font-medium uppercase tracking-wider text-muted-foreground py-2.5">Price</th>
                  <th className="px-1 sm:px-2 text-left text-[9px] font-medium uppercase tracking-wider text-muted-foreground py-2.5">Dir</th>
                  <th className="px-1 sm:px-2 text-left text-[9px] font-medium uppercase tracking-wider text-muted-foreground py-2.5">Strat</th>
                  <th className="hidden sm:table-cell px-2 text-left text-[9px] font-medium uppercase tracking-wider text-muted-foreground py-2.5">TF</th>
                  <th className="hidden sm:table-cell px-2 text-left text-[9px] font-medium uppercase tracking-wider text-muted-foreground py-2.5">Score</th>
                  <th className="hidden md:table-cell px-2 text-center text-[9px] font-medium uppercase tracking-wider text-muted-foreground py-2.5">7d</th>
                  <th className="pr-3 sm:pr-5 pl-1 sm:pl-2 text-right text-[9px] font-medium uppercase tracking-wider text-muted-foreground py-2.5">Age</th>
                </tr>
              </thead>
              <tbody>
                {sigsLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/10 h-[42px] sm:h-[52px]">
                      {[10, 120, 60, 40, 45, 45, 80, 68, 30].map((w, j) => (
                        <td key={j} className={cn("px-1.5 py-2", j === 5 || j === 6 ? "hidden sm:table-cell" : j === 7 ? "hidden md:table-cell" : "")}><SK w={w} /></td>
                      ))}
                    </tr>
                  ))
                ) : sorted.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-16 text-muted-foreground text-[11px] font-bold uppercase">
                    {signals.length > 0
                      ? `No ${filterSrc === "binance" ? "EMA" : filterSrc.toUpperCase()} signals`
                      : "No signals · start a scanner to generate data"}
                  </td></tr>
                ) : (
                  sorted.map((s, idx) => {
                    const isLong = s.direction === "LONG";
                    const score  = Math.round((s.ml_score ?? s.confluence_score ?? 0) * 100);
                    const coin   = s.symbol.replace(/USDT$|BUSD$|BTC$/, "").toLowerCase();
                    const sc     = scoreColor(score);
                    const extra  = (s.extra ?? {}) as Record<string, number>;
                    const change = extra.change_24h ?? 0;
                    const stratHref  = s.source === "binance" ? "/ema3crossover" : s.source === "ict" ? "/ict" : "/smc";
                    const stratColor = s.source === "binance" ? "#60a5fa" : s.source === "ict" ? "#a855f7" : "#f59e0b";
                    const stratLabel = s.source === "binance" ? "EMA" : s.source.toUpperCase();
                    return (
                      <tr key={s.id} className="border-b border-border/10 hover:bg-muted/15 transition-colors h-[42px] sm:h-[52px] group">
                        {/* # */}
                        <td className="pl-3 sm:pl-5 pr-1 text-[10px] font-normal text-muted-foreground tabular-nums">{idx + 1}</td>

                        {/* Coin */}
                        <td className="px-1.5 sm:px-2">
                          <div className="flex items-center gap-1.5 sm:gap-2.5">
                            <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full overflow-hidden bg-muted ring-1 ring-border/60 shrink-0">
                              <CoinIcon symbol={coin} size={28} />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-[10px] sm:text-[12px] text-foreground leading-tight truncate max-w-[70px] sm:max-w-none">{s.symbol.replace(/USDT$/, "")}<span className="hidden sm:inline">USDT</span></p>
                              <p className="hidden sm:block text-[8.5px] font-normal text-muted-foreground uppercase">{coin}</p>
                            </div>
                          </div>
                        </td>

                        {/* Price */}
                        <td className="px-1.5 sm:px-2">
                          <p className="text-[10px] sm:text-[11px] font-semibold text-foreground tabular-nums whitespace-nowrap">{fmtPrice(s.price)}</p>
                          {change !== 0 && (
                            <p className={cn("text-[8px] sm:text-[9px] font-medium tabular-nums", change >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]")}>
                              {fmtPct(change)}
                            </p>
                          )}
                        </td>

                        {/* Dir */}
                        <td className="px-1 sm:px-2">
                          <span className={cn(
                            "inline-flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg text-[8.5px] sm:text-[9.5px] font-medium uppercase",
                            isLong ? "bg-[#0ecb81]/10 text-[#0ecb81]" : "bg-[#f6465d]/10 text-[#f6465d]"
                          )}>
                            {isLong ? <IcoTrendUp /> : <IcoTrendDown />}
                            <span className="hidden xs:inline sm:inline">{isLong ? "Bull" : "Bear"}</span>
                          </span>
                        </td>

                        {/* Strategy */}
                        <td className="px-1 sm:px-2">
                          <Link href={stratHref}>
                            <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg text-[9px] sm:text-[10px] font-medium uppercase border hover:border-foreground/20 transition-colors"
                              style={{ color: stratColor, background: `${stratColor}0d`, borderColor: `${stratColor}25` }}>
                              {stratLabel}
                            </span>
                          </Link>
                        </td>

                        {/* TF — hidden on mobile */}
                        <td className="hidden sm:table-cell px-2">
                          <span className="px-2 py-1 rounded-lg text-[10px] font-normal bg-muted/50 border border-border/25 text-foreground">
                            {s.timeframe}
                          </span>
                        </td>

                        {/* Score — hidden on mobile */}
                        <td className="hidden sm:table-cell px-2">
                          <div className="flex items-center gap-1.5">
                            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden min-w-[36px]">
                              <div className="h-full rounded-full" style={{ width: `${score}%`, background: sc }} />
                            </div>
                            <span className="text-[11px] font-semibold w-6 text-right tabular-nums" style={{ color: sc }}>{score}</span>
                            <span className="text-[8px] font-normal w-3 text-muted-foreground">{scoreGrade(score)}</span>
                          </div>
                        </td>

                        {/* 7d sparkline — hidden on mobile */}
                        <td className="hidden md:table-cell px-2 text-center">
                          <div className="flex justify-center"><SigSparkline symbol={s.symbol} isLong={isLong} /></div>
                        </td>

                        {/* Age */}
                        <td className="pr-3 sm:pr-5 pl-1 sm:pl-2 text-right text-[9px] sm:text-[10px] font-normal text-muted-foreground tabular-nums whitespace-nowrap">
                          {fmtAgeShort(s.signal_time)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {!sigsLoading && sorted.length > 0 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border/20 bg-muted/5">
              <span className="text-[10px] font-bold text-muted-foreground">
                Showing {sorted.length}{filterSrc !== "all" ? ` ${filterSrc === "binance" ? "EMA" : filterSrc.toUpperCase()}` : ""} of {total.toLocaleString()} total
              </span>
              <Link href="/history" className="flex items-center gap-1.5 text-[10px] font-medium uppercase text-primary hover:opacity-70 transition-opacity">
                View full database <IcoArrow />
              </Link>
            </div>
          )}
        </div>

        {/* ── Sidebar ── */}
        <div className="flex flex-col gap-3 min-w-0">

          {/* ── Signal Sentiment ── */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-3 sm:px-4 pt-2.5 sm:pt-3 pb-0 flex items-center justify-between">
              <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Signal Sentiment</span>
              {!sigsLoading && (
                <span className="text-[9px] font-medium px-1.5 sm:px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{signals.length}</span>
              )}
            </div>
            <div className="px-1.5 sm:px-2 pt-0.5 sm:pt-1 pb-0">
              {sigsLoading
                ? <div className="h-[120px] bg-muted/60 animate-pulse rounded-xl my-3" />
                : <SentimentGauge bulls={bulls} total={signals.length} />
              }
            </div>
            {!sigsLoading && (
              <div className="grid grid-cols-2 border-t border-border" style={{ gap: 1, background: "hsl(var(--border))" }}>
                {[
                  { val: bulls, label: "Bullish", color: "#0ecb81" },
                  { val: bears, label: "Bearish", color: "#f6465d" },
                ].map(({ val, label, color }) => (
                  <div key={label} className="bg-card py-1.5 sm:py-2.5 flex flex-col items-center gap-0.5">
                    <p className="text-[13px] sm:text-[17px] font-bold tabular-nums leading-none" style={{ color }}>{val}</p>
                    <p className="text-[7px] sm:text-[8px] font-medium uppercase tracking-widest text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Fear & Greed Index + Market Stats ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-3">
            <FearGreedCard data={fearGreed} />
            <MarketStatsCard data={marketGlobal} />
          </div>

        </div>
      </div>

    </div>
  );
}
