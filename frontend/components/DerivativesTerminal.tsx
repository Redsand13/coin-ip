"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { ArrowUp, ArrowDown, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CoinIcon } from "@/components/CoinIcon";
import type { DerivativeSymbol } from "@/lib/api-client";

type SortKey = "symbol" | "openInterest" | "fundingRate" | "longShortRatio" | "markPrice";
type SortDir = "asc" | "desc";
type FundFilter = "all" | "extreme" | "negative";

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtOI(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
function fmtFunding(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(4)}%`;
}
function fmtPrice(v: number): string {
  if (v >= 10000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (v >= 1)     return v.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return v.toFixed(6);
}
function fmtLS(v: number | null): string {
  return v === null ? "—" : v.toFixed(2);
}

// ── Color helpers ──────────────────────────────────────────────────────────────

function fundingHex(rate: number): string {
  const p = rate * 100;
  if (p > 0.05)  return "#ef4444";
  if (p > 0.01)  return "#f97316";
  if (p > 0)     return "#eab308";
  if (p > -0.01) return "#10b981";
  if (p > -0.05) return "#3b82f6";
  return "#8b5cf6";
}
function fundingLabel(rate: number): string {
  const p = rate * 100;
  if (p > 0.05)  return "EXTREME";
  if (p > 0.01)  return "HIGH";
  if (p > 0)     return "MILD+";
  if (p > -0.01) return "MILD−";
  if (p > -0.05) return "NEG";
  return "EXTREME";
}
function lsHex(ratio: number | null): string {
  if (ratio === null) return "#9ca3af";
  if (ratio > 1.5) return "#ef4444";
  if (ratio > 1.1) return "#f97316";
  if (ratio > 0.9) return "#9ca3af";
  if (ratio > 0.7) return "#10b981";
  return "#3b82f6";
}
function lsBias(ratio: number | null): string {
  if (ratio === null) return "—";
  if (ratio > 1.5) return "LONG HEAVY";
  if (ratio > 1.1) return "LONG";
  if (ratio > 0.9) return "NEUTRAL";
  if (ratio > 0.7) return "SHORT";
  return "SHORT HEAVY";
}


// ── Main ───────────────────────────────────────────────────────────────────────

interface Props {
  fetchAction: () => Promise<{ symbols: DerivativeSymbol[]; stale: boolean; updatedAt: string | null }>;
}

export default function DerivativesTerminal({ fetchAction }: Props) {
  const [data,       setData]       = React.useState<DerivativeSymbol[]>([]);
  const [stale,      setStale]      = React.useState(true);
  const [updatedAt,  setUpdatedAt]  = React.useState<string | null>(null);
  const [loading,    setLoading]    = React.useState(true);
  const [sortKey,    setSortKey]    = React.useState<SortKey>("openInterest");
  const [sortDir,    setSortDir]    = React.useState<SortDir>("desc");
  const [search,     setSearch]     = React.useState("");
  const [fundFilter, setFundFilter] = React.useState<FundFilter>("all");
  const [showInfo,   setShowInfo]   = React.useState(false);

  const loadingRef = React.useRef(false);

  const load = React.useCallback(async () => {
    if (loadingRef.current) return; // prevent concurrent fetches
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await fetchAction();
      setData(res.symbols);
      setStale(res.stale);
      setUpdatedAt(res.updatedAt);
    } catch {
      // keep stale data on error — don't wipe the table
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [fetchAction]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const stats = React.useMemo(() => {
    if (!data.length) return null;
    const totalOI    = data.reduce((s, r) => s + r.openInterest, 0);
    const avgFunding = data.reduce((s, r) => s + r.fundingRate, 0) / data.length;
    const highPos    = data.filter(r => r.fundingRate * 100 > 0.05).length;
    const highNeg    = data.filter(r => r.fundingRate * 100 < -0.05).length;
    const lsArr      = data.filter(r => r.longShortRatio !== null);
    const avgLS      = lsArr.length ? lsArr.reduce((s, r) => s + r.longShortRatio!, 0) / lsArr.length : null;
    const longPct    = avgLS !== null ? Math.round((avgLS / (avgLS + 1)) * 100) : 50;
    return { totalOI, avgFunding, highPos, highNeg, avgLS, longPct };
  }, [data]);

  const maxOI = React.useMemo(() => data.reduce((m, r) => Math.max(m, r.openInterest), 0), [data]);

  const filtered = React.useMemo(() => {
    let rows = [...data];
    if (search) rows = rows.filter(r => r.symbol.includes(search.toUpperCase()));
    if (fundFilter === "extreme")  rows = rows.filter(r => Math.abs(r.fundingRate * 100) > 0.05);
    if (fundFilter === "negative") rows = rows.filter(r => r.fundingRate < 0);
    rows.sort((a, b) => {
      if (sortKey === "symbol") {
        const v = a.symbol < b.symbol ? -1 : 1;
        return sortDir === "asc" ? v : -v;
      }
      const va = sortKey === "longShortRatio" ? (a.longShortRatio ?? 0) : (a[sortKey] as number);
      const vb = sortKey === "longShortRatio" ? (b.longShortRatio ?? 0) : (b[sortKey] as number);
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return rows;
  }, [data, search, fundFilter, sortKey, sortDir]);

  const timeAgo = React.useMemo(() => {
    if (!updatedAt) return null;
    const s = (Date.now() - new Date(updatedAt).getTime()) / 1000;
    if (s < 60) return `${Math.round(s)}s ago`;
    return `${Math.round(s / 60)}m ago`;
  }, [updatedAt]);

  const SortIco = ({ k }: { k: SortKey }) =>
    sortKey === k
      ? sortDir === "asc"
        ? <ArrowUp size={10} className="ml-1 text-primary shrink-0" />
        : <ArrowDown size={10} className="ml-1 text-primary shrink-0" />
      : <span className="ml-1 opacity-20 text-[10px]">↕</span>;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-[1500px] mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] sm:text-[26px] font-semibold tracking-tight text-foreground leading-none">
            Market Sentiment
          </h1>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Open Interest · Funding Rate · Long/Short Ratio
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-1">
          {timeAgo && <span className="text-[10px] text-muted-foreground hidden sm:block">Updated {timeAgo}</span>}
          {stale && !loading && (
            <span className="text-[9px] px-2 py-1 rounded-full border border-yellow-500/30 text-yellow-600 bg-yellow-50">
              STALE
            </span>
          )}
          <button
            onClick={() => setShowInfo(true)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-xl border border-border bg-card text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M6.5 5.5 L6.5 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <circle cx="6.5" cy="3.8" r="0.7" fill="currentColor"/>
            </svg>
            <span className="hidden sm:inline">How it works</span>
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 h-8 px-3 rounded-xl border border-border bg-card text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={cn(loading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {loading && !stats ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[100px] animate-pulse bg-card border border-border rounded-2xl" />
          ))
        ) : stats ? (
          <>
            <StatCard index={0} label="Open Interest" badge={`${data.length} symbols`}
              value={fmtOI(stats.totalOI)} sub="Total futures OI across all contracts"
              accent="#6366f1" icon={<IconOI color="#6366f1" />} />
            <StatCard index={1} label="Avg Funding Rate" badge={stats.avgFunding >= 0 ? "Longs pay" : "Shorts pay"}
              value={fmtFunding(stats.avgFunding)} sub="8-hour weighted avg funding"
              accent={fundingHex(stats.avgFunding)} icon={<IconFunding color={fundingHex(stats.avgFunding)} />} />
            <StatCard index={2} label="Overextended Long" badge="above +0.05%"
              value={`${stats.highPos}`} sub="Coins at long squeeze risk"
              accent="#ef4444" icon={<IconLongRisk color="#ef4444" />} />
            <StatCard index={3} label="Overextended Short" badge="below −0.05%"
              value={`${stats.highNeg}`} sub="Coins at short squeeze risk"
              accent="#3b82f6" icon={<IconShortRisk color="#3b82f6" />} />
          </>
        ) : null}
      </div>

      {/* ── Sentiment bar ──────────────────────────────────────────────────── */}
      {stats && stats.avgLS !== null && (
        <SentimentBar
          longPct={stats.longPct}
          avgLS={stats.avgLS}
          totalOI={stats.totalOI}
          avgFunding={stats.avgFunding}
          highPos={stats.highPos}
          highNeg={stats.highNeg}
          symbolCount={data.length}
          coins={data}
        />
      )}

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 border-b border-border">
          <div className="relative shrink-0">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search symbol…"
              className="h-8 pl-8 pr-3 w-44 text-[12px] bg-muted/40 border border-border/60 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
            />
          </div>
          <div className="flex items-center bg-muted rounded-xl p-0.5 border border-border/40">
            {(["all", "extreme", "negative"] as FundFilter[]).map(k => (
              <button key={k} onClick={() => setFundFilter(k)}
                className={cn(
                  "px-3 py-1 rounded-lg text-[10px] uppercase tracking-wide transition-all",
                  fundFilter === k
                    ? "bg-card text-foreground shadow-sm border border-border/60 font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}>
                {k === "all" ? "All" : k === "extreme" ? "Extreme" : "Negative"}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground sm:ml-auto">
            {filtered.length} / {data.length} symbols
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20">
                <TH onClick={() => toggleSort("symbol")}         left className="pl-4 sm:pl-5 w-40">Symbol <SortIco k="symbol" /></TH>
                <TH onClick={() => toggleSort("markPrice")}           className="hidden sm:table-cell">Mark Price <SortIco k="markPrice" /></TH>
                <TH onClick={() => toggleSort("openInterest")}   >Open Interest <SortIco k="openInterest" /></TH>
                <TH onClick={() => toggleSort("fundingRate")}    >Funding Rate <SortIco k="fundingRate" /></TH>
                <TH onClick={() => toggleSort("longShortRatio")}      className="pr-4 sm:pr-5">L/S Ratio <SortIco k="longShortRatio" /></TH>
              </tr>
            </thead>
            <tbody>
              {loading && data.length === 0 ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/20 h-[56px]">
                    {[120, 90, 80, 80, 70].map((w, j) => (
                      <td key={j} className={cn("px-3 py-3", j === 1 && "hidden sm:table-cell")}>
                        <div className="h-3.5 animate-pulse bg-muted rounded-lg" style={{ width: w }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-20 text-center">
                    <BarChart2 size={40} className="mx-auto mb-3 opacity-20" />
                    <p className="text-[12px] text-muted-foreground">
                      {stale ? "Waiting for first cache refresh…" : "No symbols match your filters"}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((row, i) => {
                  const coin   = row.symbol.replace(/USDT$/, "").toLowerCase();
                  const fc     = fundingHex(row.fundingRate);
                  const lc     = lsHex(row.longShortRatio);
                  const oiPct  = maxOI > 0 ? (row.openInterest / maxOI) * 100 : 0;
                  const fPct   = Math.min(Math.abs(row.fundingRate * 100) / 0.1 * 100, 100);
                  const lsPct  = row.longShortRatio !== null
                    ? Math.round((row.longShortRatio / (row.longShortRatio + 1)) * 100) : 50;

                  return (
                    <tr key={row.symbol}
                      className={cn("border-b border-border/20 h-[56px] transition-colors",
                        i % 2 === 0 ? "hover:bg-muted/20" : "bg-muted/[0.03] hover:bg-muted/20")}>

                      {/* Symbol */}
                      <td className="pl-4 sm:pl-5 pr-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-muted ring-1 ring-border/50 shrink-0">
                            <CoinIcon symbol={coin} size={32} />
                          </div>
                          <div>
                            <p className="text-[12px] font-semibold text-foreground leading-tight">{coin.toUpperCase()}</p>
                            <p className="text-[9px] text-muted-foreground">USDT PERP</p>
                          </div>
                        </div>
                      </td>

                      {/* Mark price */}
                      <td className="px-3 text-right hidden sm:table-cell">
                        <span className="text-[12px] font-mono text-foreground tabular-nums">${fmtPrice(row.markPrice)}</span>
                      </td>

                      {/* OI */}
                      <td className="px-3 text-right">
                        <p className="text-[12px] font-mono font-medium text-foreground tabular-nums">{fmtOI(row.openInterest)}</p>
                        <div className="w-20 h-1 bg-muted rounded-full overflow-hidden ml-auto mt-1.5">
                          <div className="h-full rounded-full bg-indigo-400/60 transition-all duration-500" style={{ width: `${oiPct}%` }} />
                        </div>
                      </td>

                      {/* Funding */}
                      <td className="px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5 mb-1.5">
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                            style={{ color: fc, background: `${fc}12` }}>{fundingLabel(row.fundingRate)}</span>
                          <span className="text-[12px] font-mono font-medium tabular-nums" style={{ color: fc }}>
                            {fmtFunding(row.fundingRate)}
                          </span>
                        </div>
                        <div className="w-20 h-1 bg-muted rounded-full overflow-hidden ml-auto">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${fPct}%`, background: fc }} />
                        </div>
                      </td>

                      {/* L/S */}
                      <td className="pl-3 pr-4 sm:pr-5 text-right">
                        {row.longShortRatio !== null ? (
                          <>
                            <div className="flex items-center justify-end gap-1.5 mb-1.5">
                              <span className="text-[9px] font-medium hidden sm:inline" style={{ color: lc }}>{lsBias(row.longShortRatio)}</span>
                              <span className="text-[12px] font-mono font-medium tabular-nums" style={{ color: lc }}>{fmtLS(row.longShortRatio)}</span>
                            </div>
                            <div className="w-20 h-1 bg-muted rounded-full overflow-hidden ml-auto flex">
                              <div className="h-full rounded-l-full bg-emerald-500 transition-all duration-500" style={{ width: `${lsPct}%` }} />
                              <div className="h-full rounded-r-full flex-1 bg-red-400" />
                            </div>
                          </>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        {!loading && filtered.length > 0 && (
          <div className="px-5 py-2.5 border-t border-border/30 bg-muted/5 flex items-center justify-between flex-wrap gap-2">
            <span className="text-[10px] text-muted-foreground">
              {filtered.length} of {data.length} symbols · refreshes every 5 min
            </span>
            <div className="flex items-center gap-4 text-[9px] text-muted-foreground">
              <span><span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1" />High funding = long squeeze risk</span>
              <span className="hidden sm:inline"><span className="inline-block w-2 h-2 rounded-full bg-blue-400 mr-1" />Neg funding = short squeeze risk</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Info Modal ─────────────────────────────────────────────────────── */}
      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}
    </div>
  );
}

// ── Info Modal ────────────────────────────────────────────────────────────────

function InfoModal({ onClose }: { onClose: () => void }) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const sections = [
    {
      color: "#6366f1",
      title: "Market Sentiment Score",
      items: [
        { label: "What it is", text: "A 0–100 score derived from the average Long/Short ratio across all tracked contracts. Above 50 means more longs than shorts in the market." },
        { label: "Zones", text: "0–20 Extreme Fear · 20–40 Fear · 40–60 Neutral · 60–80 Greed · 80–100 Extreme Greed. Extreme zones often precede reversals." },
        { label: "How to use", text: "Use this as a contrarian indicator. Extreme Greed (score 80+) suggests the market may be overheated. Extreme Fear (score <20) can signal undervalued conditions." },
      ],
    },
    {
      color: "#8b5cf6",
      title: "Open Interest (OI)",
      items: [
        { label: "What it is", text: "The total USD value of all open (unsettled) futures contracts across tracked exchanges. It shows how much capital is actively at risk in the derivatives market." },
        { label: "High OI", text: "High open interest means more liquidity and stronger conviction behind the current trend. However, it also means more potential for violent liquidation cascades." },
        { label: "Drops in OI", text: "Sudden drops in OI usually mean mass liquidations occurred. A price pump with falling OI = short squeeze. A price dump with falling OI = long liquidation." },
      ],
    },
    {
      color: "#f97316",
      title: "Funding Rate",
      items: [
        { label: "What it is", text: "A fee exchanged every 8 hours between long and short holders to keep the futures price aligned with the spot (real) price. It is not a fee paid to the exchange." },
        { label: "Positive rate", text: "Longs pay shorts. Happens when futures price trades above spot — the market is long-heavy. Sustained positive funding increases cost of holding long positions." },
        { label: "Negative rate", text: "Shorts pay longs. Happens when futures trade below spot — market is short-heavy. Sustained negative funding can trigger short squeezes as shorts exit." },
        { label: "Extremes", text: "Funding above +0.05% or below −0.05% per 8 hours is considered overextended. These extremes historically precede sharp reversals in the opposite direction." },
      ],
    },
    {
      color: "#22c55e",
      title: "OI Heatmap",
      items: [
        { label: "Tile size", text: "Each tile represents one futures contract. The tile area is proportional to its open interest — larger tiles have more capital at risk. BTC and ETH tiles are slightly scaled down so smaller coins remain visible." },
        { label: "Tile color", text: "Green shades = long-heavy (L/S ratio > 1). Red shades = short-heavy (L/S ratio < 1). Gray = neutral (ratio near 1.0). Darker green = stronger long bias." },
        { label: "Hover", text: "Hover any tile to see the exact OI, Long/Short ratio, and current funding rate for that contract in a floating tooltip." },
      ],
    },
    {
      color: "#0ea5e9",
      title: "Long/Short Ratio",
      items: [
        { label: "What it is", text: "The ratio of accounts (or volume) holding long positions vs short positions for a given contract. A ratio of 2.0 means twice as many longs as shorts." },
        { label: "Reading it", text: "Ratio > 1.5 = heavily long-biased (contrarian bearish signal). Ratio < 0.7 = heavily short-biased (contrarian bullish signal). Near 1.0 = balanced market." },
        { label: "Limitations", text: "L/S ratio reflects account count or volume, not dollar value. A few large short positions can offset many small longs. Use with OI and funding for full context." },
      ],
    },
    {
      color: "#ef4444",
      title: "Funding Rate Chart",
      items: [
        { label: "How to read", text: "Each horizontal bar is one contract sorted by funding rate. Bars extending right (red/orange) = positive funding (longs pay). Bars extending left (blue/purple) = negative funding (shorts pay)." },
        { label: "Bar length", text: "Bar length is relative to the maximum absolute funding rate in the current dataset. Longer bar = more extreme funding rate compared to other contracts right now." },
        { label: "Outliers", text: "Coins with very long bars (in either direction) are the most overextended and carry the highest squeeze risk. These are the most dangerous positions to hold." },
      ],
    },
  ];

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
            <h2 className="text-[16px] font-black text-foreground">How Market Sentiment Works</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">A complete guide to every feature on this page</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-6 py-5 space-y-6">
          {sections.map((section, si) => (
            <div key={section.title}>
              {/* Section header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-black"
                  style={{ background: `${section.color}18`, color: section.color }}>
                  {si + 1}
                </div>
                <h3 className="text-[13px] font-black text-foreground">{section.title}</h3>
                <div className="h-px flex-1" style={{ background: `${section.color}25` }} />
              </div>

              {/* Items */}
              <div className="ml-10 space-y-2.5">
                {section.items.map((item) => (
                  <div key={item.label} className="flex gap-3">
                    <span className="text-[9px] font-black uppercase tracking-wider shrink-0 mt-0.5 w-[72px] leading-tight"
                      style={{ color: section.color }}>
                      {item.label}
                    </span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Footer note */}
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-[10px] text-muted-foreground leading-relaxed">
            <span className="font-bold text-foreground">Disclaimer:</span> All data is sourced from exchange APIs and refreshed every 5 minutes.
            This information is for educational purposes only and does not constitute financial advice.
            Derivatives trading involves significant risk of loss.
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Sentiment ─────────────────────────────────────────────────────────────────

const GAUGE_ZONES = [
  { label: "Extreme Fear", color: "#dc2626", from: 0,  to: 20  },
  { label: "Fear",         color: "#f97316", from: 20, to: 40  },
  { label: "Neutral",      color: "#eab308", from: 40, to: 60  },
  { label: "Greed",        color: "#22c55e", from: 60, to: 80  },
  { label: "Extreme Greed",color: "#16a34a", from: 80, to: 100 },
];

function lsColor(ratio: number | null): string {
  if (ratio === null) return "#64748b";
  if (ratio > 2.0)  return "#15803d";
  if (ratio > 1.5)  return "#16a34a";
  if (ratio > 1.2)  return "#22c55e";
  if (ratio > 1.05) return "#4ade80";
  if (ratio > 0.95) return "#64748b";
  if (ratio > 0.85) return "#fca5a5";
  if (ratio > 0.65) return "#f87171";
  if (ratio > 0.5)  return "#ef4444";
  return "#dc2626";
}

// Recursive binary-split treemap — naturally responsive, no library needed
interface TmItem {
  name: string; size: number; fill: string;
  oiLabel: string; ratio: number | null; fundingRate: number; funding: string;
}
interface TmRect extends TmItem { rx: number; ry: number; rw: number; rh: number; }

function binaryTreemap(items: TmItem[], x: number, y: number, w: number, h: number): TmRect[] {
  if (!items.length) return [];
  if (items.length === 1) return [{ ...items[0], rx: x, ry: y, rw: w, rh: h }];
  const total = items.reduce((s, i) => s + i.size, 0);
  let acc = 0, split = 1;
  for (let i = 0; i < items.length - 1; i++) {
    acc += items[i].size;
    split = i + 1;
    if (acc >= total * 0.5) break;
  }
  const aFrac = items.slice(0, split).reduce((s, i) => s + i.size, 0) / total;
  if (w >= h) {
    const aw = w * aFrac;
    return [
      ...binaryTreemap(items.slice(0, split), x,      y, aw,     h),
      ...binaryTreemap(items.slice(split),     x + aw, y, w - aw, h),
    ];
  } else {
    const ah = h * aFrac;
    return [
      ...binaryTreemap(items.slice(0, split), x, y,      w, ah),
      ...binaryTreemap(items.slice(split),     x, y + ah, w, h - ah),
    ];
  }
}

const TM_H = 460;

function SentimentBar({ longPct, avgLS, totalOI, avgFunding, highPos, highNeg, symbolCount, coins }: {
  longPct: number; avgLS: number;
  totalOI: number; avgFunding: number;
  highPos: number; highNeg: number; symbolCount: number;
  coins: DerivativeSymbol[];
}) {
  const [display, setDisplay] = React.useState(50);
  React.useEffect(() => {
    let raf: number; let start: number | null = null;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / 1600, 1);
      setDisplay(Math.round(50 + (longPct - 50) * (1 - Math.pow(2, -10 * p))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [longPct]);

  // Track treemap container width for layout recalculation
  const tmRef = React.useRef<HTMLDivElement>(null);
  const [tmW, setTmW] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!tmRef.current) return;
    setTmW(tmRef.current.getBoundingClientRect().width);
    const ro = new ResizeObserver(entries => setTmW(entries[0].contentRect.width));
    ro.observe(tmRef.current);
    return () => ro.disconnect();
  }, []);

  const [hovered, setHovered]   = React.useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = React.useState({ x: 0, y: 0 });

  const zoneIdx  = GAUGE_ZONES.findIndex(z => display >= z.from && display < z.to);
  const zone     = GAUGE_ZONES[zoneIdx === -1 ? GAUGE_ZONES.length - 1 : zoneIdx];
  const fc       = avgFunding >= 0 ? "#ef4444" : "#3b82f6";
  const shortPct = 100 - display;

  const tmData = React.useMemo<TmItem[]>(() =>
    [...coins]
      .filter(c => c.openInterest > 0)
      .sort((a, b) => b.openInterest - a.openInterest)
      .slice(0, 30)
      .map(c => ({
        name:        c.symbol.replace(/USDT$/, ""),
        size:        Math.pow(c.openInterest, 0.45),
        fill:        lsColor(c.longShortRatio),
        oiLabel:     fmtOI(c.openInterest),
        ratio:       c.longShortRatio,
        fundingRate: c.fundingRate,
        funding:     fmtFunding(c.fundingRate),
      })),
    [coins]
  );

  const tmRects = React.useMemo<TmRect[]>(() => {
    if (!tmW || !tmData.length) return [];
    return binaryTreemap(tmData, 0, 0, tmW, TM_H);
  }, [tmData, tmW]);

  const fundingData = React.useMemo(() =>
    [...coins]
      .sort((a, b) => a.fundingRate - b.fundingRate)
      .map(c => ({
        name:  c.symbol.replace(/USDT$/, ""),
        value: parseFloat((c.fundingRate * 100).toFixed(5)),
        fill:  fundingHex(c.fundingRate),
      })),
    [coins]
  );

  const hoveredCoin = hovered ? tmData.find(d => d.name === hovered) ?? null : null;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <style>{`@keyframes sb-ping{0%{transform:scale(1);opacity:.6}100%{transform:scale(2.6);opacity:0}}`}</style>

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inset-0 rounded-full bg-emerald-400" style={{ animation: "sb-ping 2s ease-out infinite" }} />
          <span className="relative rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="text-[13px] font-bold text-foreground">Market Sentiment</span>
        <span className="text-border/60">·</span>
        <span className="text-[11px] text-muted-foreground">Derivatives Analysis</span>
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground hidden sm:block">{symbolCount} contracts</span>
        <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg"
          style={{ color: zone.color, background: `${zone.color}18`, border: `1px solid ${zone.color}35` }}>
          {zone.label}
        </span>
      </div>

      {/* ── Score strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-border">
        {/* Score cell */}
        <div className="px-5 py-5 flex items-center gap-4 relative overflow-hidden"
          style={{ background: `linear-gradient(135deg,${zone.color}10 0%,transparent 65%)` }}>
          <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full" style={{ background: zone.color }} />
          <span className="text-[56px] font-black leading-none tabular-nums" style={{ color: zone.color }}>{display}</span>
          <div className="min-w-0">
            <div className="text-[12px] font-black leading-tight mb-2" style={{ color: zone.color }}>{zone.label}</div>
            <div className="h-2 w-28 rounded-full overflow-hidden flex">
              <div className="h-full transition-all duration-[1600ms] rounded-l-full" style={{ width: `${display}%`, background: "#10b981" }} />
              <div className="h-full flex-1 rounded-r-full" style={{ background: "#ef4444" }} />
            </div>
            <div className="flex justify-between text-[9px] font-bold mt-1 w-28">
              <span style={{ color: "#10b981" }}>{display}% L</span>
              <span style={{ color: "#ef4444" }}>{shortPct}% S</span>
            </div>
          </div>
        </div>
        {/* Metric cells */}
        {([
          { label: "Avg L/S Ratio",   value: avgLS.toFixed(2),  sub: zone.label,               color: zone.color },
          { label: "Total Open Int.", value: fmtOI(totalOI),    sub: `${symbolCount} futures`, color: "#6366f1"  },
          { label: "Avg Funding",     value: `${avgFunding >= 0 ? "+" : ""}${(avgFunding * 100).toFixed(4)}%`,
            sub: avgFunding >= 0 ? "Longs pay" : "Shorts pay",  color: fc },
        ] as const).map((m, i) => (
          <div key={i} className="px-5 py-5 border-l border-border flex flex-col justify-center relative overflow-hidden"
            style={{ background: `linear-gradient(135deg,${m.color}06 0%,transparent 60%)` }}>
            <div className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full opacity-60" style={{ background: m.color }} />
            <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">{m.label}</div>
            <div className="text-[24px] font-black tabular-nums leading-none tracking-tight" style={{ color: m.color }}>{m.value}</div>
            <div className="text-[9px] font-medium mt-1.5" style={{ color: m.color, opacity: 0.55 }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Charts ── */}
      <div className="flex flex-col 2xl:flex-row divide-y 2xl:divide-y-0 2xl:divide-x divide-border">

        {/* LEFT: div-based treemap */}
        <div className="flex-1 min-w-0 p-4">
          {/* Legend row */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[12px] font-bold text-foreground">OI Heatmap</span>
              <span className="text-[10px] text-muted-foreground">top {tmData.length} · size = OI · color = L/S</span>
            </div>
            <div className="flex items-center gap-3 text-[9px] flex-wrap">
              {([
                ["#dc2626","Short heavy"],["#f87171","Short"],
                ["#64748b","Neutral"],["#22c55e","Long"],["#15803d","Long heavy"],
              ] as const).map(([bg, lbl]) => (
                <span key={lbl} className="flex items-center gap-1">
                  <span style={{ display:"inline-block", width:8, height:8, borderRadius:2, background:bg }} />
                  <span className="text-muted-foreground">{lbl}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Treemap canvas — divs absolutely positioned inside */}
          <div ref={tmRef} style={{ position: "relative", width: "100%", height: TM_H }}>
            {tmRects.map((rect) => {
              const GAP = 2;
              const cx = rect.rx + GAP;
              const cy = rect.ry + GAP;
              const cw = rect.rw - GAP * 2;
              const ch = rect.rh - GAP * 2;
              if (cw < 6 || ch < 6) return null;

              const iW       = cw - 6;
              // 0.52 = slightly wide chars; keeps full name in one line
              const fsByW    = iW / (rect.name.length * 0.52);
              const fsByH    = ch * 0.28;
              const tFs      = Math.min(Math.max(Math.min(fsByW, fsByH), 0), 18);
              const sFs      = Math.max(Math.floor(tFs * 0.66), 0);
              const showName = tFs >= 6 && cw >= 10 && ch >= tFs;
              const showOI   = showName && sFs >= 6 && ch >= tFs + sFs + 4;
              const isNeutral = rect.ratio !== null && rect.ratio > 0.95 && rect.ratio < 1.05;
              const textCol  = isNeutral ? "#0f172a" : "#ffffff";
              const isHov    = hovered === rect.name;

              return (
                <div
                  key={rect.name}
                  onMouseEnter={(e) => { setHovered(rect.name); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
                  onMouseMove={(e)  => setTooltipPos({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    position:      "absolute",
                    left:          cx,
                    top:           cy,
                    width:         cw,
                    height:        ch,
                    background:    rect.fill,
                    borderRadius:  6,
                    display:       "flex",
                    flexDirection: "column",
                    alignItems:    "center",
                    justifyContent:"center",
                    overflow:      "hidden",
                    cursor:        "default",
                    transition:    "filter 0.15s, transform 0.15s",
                    filter:        isHov ? "brightness(1.18)" : "brightness(1)",
                    transform:     isHov ? "scale(1.015)" : "scale(1)",
                    zIndex:        isHov ? 2 : 1,
                    boxSizing:     "border-box",
                  }}
                >
                  {showName && (
                    <span style={{
                      fontSize:   tFs,
                      fontWeight: 800,
                      color:      textCol,
                      lineHeight: 1,
                      textAlign:  "center",
                      padding:    "0 4px",
                      userSelect: "none",
                    }}>
                      {rect.name}
                    </span>
                  )}
                  {showOI && (
                    <span style={{
                      fontSize:   sFs,
                      fontWeight: 500,
                      color:      textCol,
                      opacity:    0.78,
                      lineHeight: 1,
                      marginTop:  4,
                      textAlign:  "center",
                      userSelect: "none",
                    }}>
                      {rect.oiLabel}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Floating tooltip — rendered via portal-like fixed positioning */}
          {hoveredCoin && (
            <div style={{
              position: "fixed",
              left: tooltipPos.x + 14,
              top:  tooltipPos.y - 10,
              zIndex: 9999,
              pointerEvents: "none",
            }}>
              <div className="bg-card border border-border rounded-xl shadow-xl px-3 py-2.5 text-[11px] min-w-[160px]">
                <p className="font-black text-foreground text-[13px] mb-1.5">{hoveredCoin.name}</p>
                <div className="space-y-0.5">
                  <div className="flex justify-between gap-6">
                    <span className="text-muted-foreground">Open Interest</span>
                    <span className="font-semibold text-foreground">{hoveredCoin.oiLabel}</span>
                  </div>
                  <div className="flex justify-between gap-6">
                    <span className="text-muted-foreground">L/S Ratio</span>
                    <span className="font-semibold text-foreground">{hoveredCoin.ratio?.toFixed(2) ?? "—"}</span>
                  </div>
                  <div className="flex justify-between gap-6">
                    <span className="text-muted-foreground">Funding</span>
                    <span className="font-semibold" style={{ color: fundingHex(hoveredCoin.fundingRate) }}>{hoveredCoin.funding}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Funding Rate horizontal bar list */}
        <div className="2xl:w-[320px] shrink-0 p-4 flex flex-col gap-3">
          {/* Header */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-foreground">Funding Rate</span>
              <span className="text-[10px] text-muted-foreground">{coins.length} contracts</span>
            </div>
            <div className="flex items-center gap-4 mt-1.5 text-[9px]">
              <span className="flex items-center gap-1" style={{ color:"#ef4444" }}>
                <span style={{ display:"inline-block",width:8,height:3,borderRadius:2,background:"#ef4444" }} />
                Longs pay
              </span>
              <span className="flex items-center gap-1" style={{ color:"#3b82f6" }}>
                <span style={{ display:"inline-block",width:8,height:3,borderRadius:2,background:"#3b82f6" }} />
                Shorts pay
              </span>
            </div>
          </div>

          {/* Horizontal bar rows */}
          {(() => {
            const maxAbs = Math.max(...fundingData.map(x => Math.abs(x.value)));
            return (
          <div className="flex-1 overflow-y-auto space-y-[3px]" style={{ maxHeight: TM_H - 20 }}>
            {fundingData.map((d) => {
              const barPct  = maxAbs > 0 ? (Math.abs(d.value) / maxAbs) * 48 : 0;
              const isPos   = d.value >= 0;
              return (
                <div key={d.name} className="flex items-center gap-2 h-[22px] group">
                  {/* Coin name */}
                  <span className="w-[52px] text-right text-[10px] font-bold text-foreground shrink-0 truncate">
                    {d.name}
                  </span>
                  {/* Bar track — center line at 50% */}
                  <div className="flex-1 relative h-[14px] flex items-center">
                    {/* center axis line */}
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border/60" />
                    {isPos ? (
                      <div style={{
                        position:     "absolute",
                        left:         "50%",
                        width:        `${barPct}%`,
                        height:       "100%",
                        background:   d.fill,
                        borderRadius: "0 3px 3px 0",
                      }} />
                    ) : (
                      <div style={{
                        position:     "absolute",
                        right:        "50%",
                        width:        `${barPct}%`,
                        height:       "100%",
                        background:   d.fill,
                        borderRadius: "3px 0 0 3px",
                      }} />
                    )}
                  </div>
                  {/* Value */}
                  <span className="w-[56px] text-[9px] font-mono tabular-nums shrink-0"
                    style={{ color: d.fill }}>
                    {isPos ? "+" : ""}{d.value.toFixed(4)}%
                  </span>
                </div>
              );
            })}
          </div>
            );
          })()}

          {/* Summary chips */}
          <div className="flex gap-2 flex-wrap pt-1 border-t border-border/40">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold border"
              style={{ color:"#ef4444", borderColor:"#ef444430", background:"#ef444408" }}>
              <span className="font-black">{highPos}</span> coins &gt; +0.05%
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold border"
              style={{ color:"#3b82f6", borderColor:"#3b82f630", background:"#3b82f608" }}>
              <span className="font-black">{highNeg}</span> coins &lt; −0.05%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stat card icons ───────────────────────────────────────────────────────────

function IconOI({ color }: { color: string }) {
  return (
    <svg width="72" height="64" viewBox="0 0 72 64" fill="none">
      <rect x="4"  y="44" width="12" height="18" rx="3" fill={color} fillOpacity="0.25"/>
      <rect x="20" y="32" width="12" height="30" rx="3" fill={color} fillOpacity="0.45"/>
      <rect x="36" y="20" width="12" height="42" rx="3" fill={color} fillOpacity="0.7"/>
      <rect x="52" y="8"  width="12" height="54" rx="3" fill={color}/>
      <circle cx="10" cy="41"  r="3" fill={color} fillOpacity="0.5"/>
      <circle cx="26" cy="29"  r="3" fill={color} fillOpacity="0.65"/>
      <circle cx="42" cy="17"  r="3" fill={color} fillOpacity="0.85"/>
      <circle cx="58" cy="5"   r="3" fill={color}/>
      <polyline points="10,41 26,29 42,17 58,5" stroke={color} strokeWidth="1.5" strokeOpacity="0.4" fill="none"/>
    </svg>
  );
}

function IconFunding({ color }: { color: string }) {
  return (
    <svg width="72" height="64" viewBox="0 0 72 64" fill="none">
      {/* outer ring */}
      <circle cx="36" cy="32" r="26" stroke={color} strokeOpacity="0.15" strokeWidth="6" fill="none"/>
      {/* progress arc ~220° */}
      <circle cx="36" cy="32" r="26" stroke={color} strokeWidth="6" fill="none"
        strokeLinecap="round" strokeDasharray="96 68" strokeDashoffset="17"
        transform="rotate(-110 36 32)"/>
      {/* inner percent */}
      <circle cx="24" cy="26" r="5" stroke={color} strokeWidth="2.5" fill="none"/>
      <circle cx="48" cy="38" r="5" stroke={color} strokeWidth="2.5" fill="none"/>
      <line x1="46" y1="26" x2="26" y2="38" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}

function IconLongRisk({ color }: { color: string }) {
  return (
    <svg width="72" height="64" viewBox="0 0 72 64" fill="none">
      <rect x="6"  y="36" width="14" height="24" rx="3" fill={color} fillOpacity="0.3"/>
      <rect x="26" y="22" width="14" height="38" rx="3" fill={color} fillOpacity="0.6"/>
      <rect x="46" y="8"  width="14" height="52" rx="3" fill={color}/>
    </svg>
  );
}

function IconShortRisk({ color }: { color: string }) {
  return (
    <svg width="72" height="64" viewBox="0 0 72 64" fill="none">
      <rect x="6"  y="4"  width="14" height="52" rx="3" fill={color}/>
      <rect x="26" y="18" width="14" height="38" rx="3" fill={color} fillOpacity="0.6"/>
      <rect x="46" y="32" width="14" height="24" rx="3" fill={color} fillOpacity="0.3"/>
    </svg>
  );
}

// ── Count-up hook ─────────────────────────────────────────────────────────────

function useCountUp(value: string, duration = 1400): string {
  const [display, setDisplay] = React.useState("0");
  React.useEffect(() => {
    const m = value.match(/^([^0-9]*)(-?)([\d.]+)(.*)$/);
    if (!m) { setDisplay(value); return; }
    const [, pre, neg, numStr, suf] = m;
    const target = parseFloat(numStr);
    const decimals = (numStr.split(".")[1] ?? "").length;
    let start: number | null = null;
    let raf: number;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(2, -10 * p);
      setDisplay(`${pre}${neg}${(target * ease).toFixed(decimals)}${suf}`);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, badge, value, sub, accent, icon, index = 0 }: {
  label: string; badge?: string; value: string; sub: string;
  accent: string; icon: React.ReactNode; index?: number;
}) {
  const animated = useCountUp(value);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2, boxShadow: `0 8px 30px ${accent}18`, transition: { duration: 0.18 } }}
      className="relative rounded-2xl bg-card border border-border overflow-hidden cursor-default select-none flex items-center justify-between gap-2 px-5 py-4"
    >
      {/* left: label → value → sub */}
      <div className="flex flex-col gap-1 min-w-0">
        {/* label + badge row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-foreground">{label}</span>
          {badge && (
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-md leading-tight"
              style={{ color: accent, background: `${accent}18` }}>
              {badge}
            </span>
          )}
        </div>

        {/* big value */}
        <motion.p
          key={value}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: index * 0.08 + 0.15 }}
          className="text-[38px] sm:text-[42px] font-black leading-none tabular-nums tracking-tight"
          style={{ color: accent }}
        >
          {animated}
        </motion.p>

        {/* sub */}
        <p className="text-[9px] text-muted-foreground leading-snug truncate">{sub}</p>
      </div>

      {/* right: illustrated icon */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: index * 0.08 + 0.25, ease: [0.34, 1.56, 0.64, 1] }}
        className="shrink-0"
      >
        {icon}
      </motion.div>
    </motion.div>
  );
}

// ── TH helper ─────────────────────────────────────────────────────────────────

function TH({ children, onClick, left, className }: {
  children: React.ReactNode; onClick?: () => void; left?: boolean; className?: string;
}) {
  return (
    <th onClick={onClick}
      className={cn(
        "py-2.5 px-3 text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap",
        !left && "text-right",
        onClick && "cursor-pointer hover:text-foreground select-none",
        className,
      )}>
      <span className={cn("inline-flex items-center", !left && "justify-end w-full")}>{children}</span>
    </th>
  );
}
