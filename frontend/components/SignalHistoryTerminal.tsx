"use client";

import * as React from "react";
import { useState, useEffect, useMemo, useRef } from "react";
import {
  Database, Search, Download, TrendingUp, TrendingDown,
  RefreshCw, ChevronLeft, ChevronRight, DatabaseZap,
  Lock, ShieldCheck, X, SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getDbSignalsAction, syncAllTimeframesAction,
  verifyHistoryKeyAction, exportSignalsCsvAction,
} from "@/app/actions";
import type { DbSignal } from "@/lib/types/signals";

// ── Constants ─────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 50;

const SOURCES    = ["all", "binance", "coingecko", "ict", "smc"] as const;
const TIMEFRAMES = ["all", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
const SCORE_PRESETS = [
  { label: "Any",  value: 0  },
  { label: "40+",  value: 40 },
  { label: "60+",  value: 60 },
  { label: "70+",  value: 70 },
  { label: "80+",  value: 80 },
] as const;

type Direction = "all" | "LONG" | "SHORT";
type DatePreset = "all" | "24h" | "7d" | "30d" | "custom";

function presetToRange(p: DatePreset): { from: string; to: string } {
  if (p === "all" || p === "custom") return { from: "", to: "" };
  const now  = new Date();
  const days = p === "24h" ? 1 : p === "7d" ? 7 : 30;
  const from = new Date(now.getTime() - days * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to:   now.toISOString().slice(0, 10),
  };
}

// ── Price formatter ────────────────────────────────────────────────────────────

function fmtPrice(p: number) {
  if (!p) return "—";
  if (p < 0.001) return p.toFixed(8);
  if (p < 1)     return p.toFixed(6);
  if (p < 1000)  return p.toFixed(2);
  return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Pill helper ───────────────────────────────────────────────────────────────

function Pill({
  label, active, onClick, accent,
}: { label: string; active: boolean; onClick: () => void; accent?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-md text-[11px] font-bold transition-all whitespace-nowrap uppercase",
        active
          ? accent ?? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
      )}
    >
      {label}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SignalHistoryTerminal() {
  // Auth
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password,        setPassword]        = useState("");
  const [passError,       setPassError]       = useState(false);

  // Filters
  const [source,        setSource]        = useState("all");
  const [direction,     setDirection]     = useState<Direction>("all");
  const [timeframe,     setTimeframe]     = useState("all");
  const [minScore,      setMinScore]      = useState(0);
  const [search,        setSearch]        = useState("");
  const [searchInput,   setSearchInput]   = useState("");
  const [datePreset,    setDatePreset]    = useState<DatePreset>("all");
  const [fromDate,      setFromDate]      = useState("");
  const [toDate,        setToDate]        = useState("");
  const [latestPerCoin, setLatestPerCoin] = useState(false);

  // Data
  const [loading,     setLoading]     = useState(true);
  const [signals,     setSignals]     = useState<DbSignal[]>([]);
  const [total,       setTotal]       = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  // Actions
  const [syncing,     setSyncing]     = useState(false);
  const [syncResult,  setSyncResult]  = useState<{ binance: number; ict: number } | null>(null);
  const [exporting,   setExporting]   = useState(false);

  const skipPageFetchRef = useRef(false);
  const debounceRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (sessionStorage.getItem("history_auth") === "true") setIsAuthenticated(true);
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await verifyHistoryKeyAction(password);
    if (ok) {
      setIsAuthenticated(true);
      sessionStorage.setItem("history_auth", "true");
      setPassError(false);
    } else {
      setPassError(true);
      setTimeout(() => setPassError(false), 2000);
    }
  };

  const logout = () => {
    setIsAuthenticated(false);
    sessionStorage.removeItem("history_auth");
    setPassword("");
  };

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchSignals = async (page = currentPage) => {
    setLoading(true);
    try {
      const fTs = fromDate ? new Date(fromDate).getTime() : undefined;
      const tTs = toDate   ? new Date(toDate).setHours(23, 59, 59, 999) : undefined;

      const { signals: data, total: count } = await getDbSignalsAction({
        source:       source === "all" ? undefined : source,
        direction:    direction === "all" ? undefined : direction,
        timeframe:    timeframe === "all" ? undefined : timeframe,
        minScore,
        fromTs:       fTs && !isNaN(fTs) ? fTs : undefined,
        toTs:         tTs && !isNaN(Number(tTs)) ? Number(tTs) : undefined,
        search:       search || undefined,
        page,
        pageSize:     ITEMS_PER_PAGE,
        latestPerCoin,
      });
      setSignals(data);
      setTotal(count);
    } catch (err) {
    } finally {
      setLoading(false);
    }
  };

  // Reset to page 1 on any filter change
  useEffect(() => {
    if (!isAuthenticated) return;
    skipPageFetchRef.current = true;
    setCurrentPage(1);
    fetchSignals(1);
  }, [isAuthenticated, source, direction, timeframe, minScore, fromDate, toDate, search, latestPerCoin]); // eslint-disable-line

  // Fetch on page navigation
  useEffect(() => {
    if (!isAuthenticated) return;
    if (skipPageFetchRef.current) { skipPageFetchRef.current = false; return; }
    fetchSignals(currentPage);
  }, [currentPage]); // eslint-disable-line

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSearchInput = (val: string) => {
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(val), 400);
  };

  const handleDatePreset = (p: DatePreset) => {
    setDatePreset(p);
    if (p !== "custom") {
      const r = presetToRange(p);
      setFromDate(r.from);
      setToDate(r.to);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await exportSignalsCsvAction(
        source !== "all" ? source : undefined,
        timeframe !== "all" ? timeframe : undefined,
        minScore > 0 ? minScore : undefined,
      );
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `signals-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
    finally { setExporting(false); }
  };

  const handleSync = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const result = await syncAllTimeframesAction();
      setSyncResult(result);
      await fetchSignals(1);
    } catch { /* ignore */ } finally { setSyncing(false); }
  };

  const clearAllFilters = () => {
    setSource("all"); setDirection("all"); setTimeframe("all");
    setMinScore(0); setSearch(""); setSearchInput("");
    setDatePreset("all"); setFromDate(""); setToDate("");
    setLatestPerCoin(false);
  };

  const hasActiveFilters =
    source !== "all" || direction !== "all" || timeframe !== "all" ||
    minScore > 0 || search || fromDate || toDate || latestPerCoin;

  // ── Derived ───────────────────────────────────────────────────────────────

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
  const pageStart  = (currentPage - 1) * ITEMS_PER_PAGE;

  const stats = useMemo(() => ({
    buy:  signals.filter(s => s.signal_type === "BUY"  || s.signal_type === "LONG").length,
    sell: signals.filter(s => s.signal_type === "SELL" || s.signal_type === "SHORT").length,
  }), [signals]);

  // ── Auth gate ─────────────────────────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-background/80 backdrop-blur-xl" />
        <div className="w-full max-w-[400px] relative">
          <div className="gecko-card p-8 border-t-4 border-t-foreground shadow-2xl">
            <div className="flex flex-col items-center text-center gap-4 mb-8">
              <div className="bg-foreground/10 p-4 rounded-xl">
                <Lock size={32} className="text-foreground" />
              </div>
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tight">Vault Locked</h2>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Authorized Personnel Only</p>
              </div>
            </div>
            <form onSubmit={handleAuth} className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Secret Key</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className={cn(
                    "w-full bg-muted border border-border rounded-lg px-4 py-3 text-[14px] font-mono tracking-widest focus:ring-1 focus:ring-foreground outline-none text-center",
                    passError && "border-red-500 bg-red-50 dark:bg-red-500/10",
                  )}
                  autoFocus
                />
                {passError && <p className="text-[10px] font-bold text-red-600 text-center uppercase">Invalid authentication key</p>}
              </div>
              <Button type="submit" className="w-full h-11 font-black uppercase tracking-widest gap-2">
                Unlock Records <ChevronRight size={16} />
              </Button>
            </form>
            <div className="mt-8 pt-6 border-t border-border flex items-center justify-center gap-2 opacity-40">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[9px] font-black uppercase tracking-widest">Secure Ledger Connection</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3 sm:space-y-5">

      {/* ── Title bar ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-[18px] sm:text-3xl font-black tracking-tighter uppercase flex items-center gap-2 sm:gap-3">
            <DatabaseZap className="text-foreground w-6 h-6 sm:w-8 sm:h-8" />
            Signal History
          </h1>
          <p className="text-[9px] sm:text-[11px] font-bold text-muted-foreground uppercase mt-0.5">
            <Lock size={10} className="inline mr-1" />Authorized Access — Internal Records
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={logout} className="gap-2 h-9 font-bold border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">
            <Lock size={13} /> Lock Vault
          </Button>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} className="gap-2 h-9 font-bold">
            <RefreshCw size={13} className={cn(syncing && "animate-spin")} />
            {syncing ? "Syncing…" : "Sync All"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fetchSignals(currentPage)} disabled={loading} className="h-9 w-9 p-0">
            <RefreshCw size={13} className={cn(loading && "animate-spin")} />
          </Button>
          <Button size="sm" onClick={handleExport} disabled={exporting} className="gap-2 h-9 font-bold">
            <Download size={13} className={cn(exporting && "animate-bounce")} />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      {/* ── Banners ── */}
      {syncing && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-400/10 border border-blue-200 dark:border-blue-400/20 text-[11px] font-black uppercase text-blue-700 dark:text-blue-300">
          <RefreshCw size={12} className="animate-spin" /> Scanning all timeframes across all sources…
        </div>
      )}
      {syncResult && !syncing && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-green-50 dark:bg-green-400/10 border border-green-200 dark:border-green-400/20 text-[11px] font-black uppercase text-green-700 dark:text-green-300">
          <ShieldCheck size={13} />
          Sync complete — Binance: +{syncResult.binance} · ICT: +{syncResult.ict} new signals
          <button onClick={() => setSyncResult(null)} className="ml-auto opacity-50 hover:opacity-100"><X size={12} /></button>
        </div>
      )}

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Records</span>
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-foreground/10 text-foreground">ALL</span>
            </div>
            <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-foreground">{total.toLocaleString()}</p>
          </div>
          <svg width="52" height="48" viewBox="0 0 60 56" fill="none" className="shrink-0 text-foreground opacity-65">
            <ellipse cx="30" cy="44" rx="22" ry="7" fill="currentColor" fillOpacity="0.2"/>
            <path d="M8 28L8 44C8 48.4 18 51 30 51C42 51 52 48.4 52 44L52 28" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" fill="none"/>
            <ellipse cx="30" cy="28" rx="22" ry="7" fill="currentColor" fillOpacity="0.45"/>
            <path d="M8 12L8 28C8 32.4 18 35 30 35C42 35 52 32.4 52 28L52 12" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.45" fill="none"/>
            <ellipse cx="30" cy="12" rx="22" ry="7" fill="currentColor" fillOpacity="0.75"/>
          </svg>
          <div className="absolute bottom-0 left-0 h-[3px] w-full bg-gradient-to-r from-foreground/40 to-transparent"/>
        </div>
        <div className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Bullish</span>
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#0ecb81]/12 text-[#0ecb81]">LONG</span>
            </div>
            <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-[#0ecb81]">{stats.buy.toLocaleString()}</p>
          </div>
          <svg width="60" height="48" viewBox="0 0 72 56" fill="none" className="shrink-0 text-[#0ecb81] opacity-75">
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
        <div className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Bearish</span>
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#f6465d]/12 text-[#f6465d]">SHORT</span>
            </div>
            <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-[#f6465d]">{stats.sell.toLocaleString()}</p>
          </div>
          <svg width="60" height="48" viewBox="0 0 72 56" fill="none" className="shrink-0 text-[#f6465d] opacity-75">
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
      </div>

      {/* ── Filters panel ── */}
      <div className="gecko-card p-5 space-y-4 border border-border">

        {/* Row 1: source + direction + search + clear */}
        <div className="flex flex-wrap items-end gap-4">

          {/* Source */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-1">
              <SlidersHorizontal size={10} /> Source
            </span>
            <div className="flex bg-muted rounded-lg p-0.5 gap-0.5 border border-border">
              {SOURCES.map(s => (
                <Pill key={s} label={s} active={source === s} onClick={() => setSource(s)} />
              ))}
            </div>
          </div>

          {/* Direction */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Direction</span>
            <div className="flex bg-muted rounded-lg p-0.5 gap-0.5 border border-border">
              <Pill label="All"   active={direction === "all"}   onClick={() => setDirection("all")} />
              <Pill label="Bullish" active={direction === "LONG"}  onClick={() => setDirection("LONG")}
                accent="bg-green-600 dark:bg-green-700 text-white" />
              <Pill label="Bearish" active={direction === "SHORT"} onClick={() => setDirection("SHORT")}
                accent="bg-red-600 dark:bg-red-700 text-white" />
            </div>
          </div>

          {/* Search */}
          <div className="flex flex-col gap-1.5 flex-1 min-w-[180px]">
            <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Search Symbol</span>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="BTC, ETH, SOL…"
                value={searchInput}
                onChange={e => handleSearchInput(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg pl-8 pr-8 py-1.5 text-[12px] font-bold focus:ring-1 focus:ring-foreground outline-none h-9"
              />
              {searchInput && (
                <button onClick={() => { handleSearchInput(""); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Clear all */}
          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="h-9 px-3 rounded-lg text-[11px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-400/10 border border-red-200 dark:border-red-400/20 hover:bg-red-100 dark:hover:bg-red-400/20 transition-colors flex items-center gap-1.5 self-end"
            >
              <X size={12} /> Clear Filters
            </button>
          )}
        </div>

        {/* Row 2: timeframe + score + date + latest-per-coin */}
        <div className="flex flex-wrap items-end gap-4 pt-3 border-t border-border/50">

          {/* Timeframe */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Timeframe</span>
            <div className="flex bg-muted rounded-lg p-0.5 gap-0.5 border border-border">
              {TIMEFRAMES.map(tf => (
                <Pill key={tf} label={tf} active={timeframe === tf} onClick={() => setTimeframe(tf)} />
              ))}
            </div>
          </div>

          {/* Min Score */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">
              Min Score
            </span>
            <div className="flex bg-muted rounded-lg p-0.5 gap-0.5 border border-border">
              {SCORE_PRESETS.map(p => (
                <Pill key={p.label} label={p.label} active={minScore === p.value} onClick={() => setMinScore(p.value)} />
              ))}
            </div>
          </div>

          {/* Date Range */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Date Range</span>
            <div className="flex items-center gap-2">
              <div className="flex bg-muted rounded-lg p-0.5 gap-0.5 border border-border">
                {(["all", "24h", "7d", "30d", "custom"] as DatePreset[]).map(p => (
                  <Pill key={p} label={p === "all" ? "All Time" : p.toUpperCase()} active={datePreset === p} onClick={() => handleDatePreset(p)} />
                ))}
              </div>
              {datePreset === "custom" && (
                <div className="flex items-center gap-1.5 bg-muted border border-border rounded-lg px-2 py-1 h-9">
                  <input
                    type="date"
                    value={fromDate}
                    onChange={e => setFromDate(e.target.value)}
                    className="bg-transparent border-none text-[11px] font-bold outline-none w-28"
                  />
                  <span className="text-muted-foreground text-[11px]">→</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={e => setToDate(e.target.value)}
                    className="bg-transparent border-none text-[11px] font-bold outline-none w-28"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Latest per coin toggle */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Dedup</span>
            <button
              onClick={() => setLatestPerCoin(v => !v)}
              className={cn(
                "h-9 px-4 rounded-lg text-[11px] font-black uppercase tracking-wide border transition-all",
                latestPerCoin
                  ? "bg-foreground text-background border-foreground"
                  : "bg-muted text-muted-foreground border-border hover:text-foreground",
              )}
            >
              {latestPerCoin ? "✓ Latest Per Coin" : "Latest Per Coin"}
            </button>
          </div>
        </div>

        {/* Active filter summary */}
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border/50">
            <span className="text-[10px] font-bold text-muted-foreground self-center">Active:</span>
            {source !== "all"    && <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-[10px] font-bold">Source: {source}</span>}
            {direction !== "all" && <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-[10px] font-bold">Dir: {direction}</span>}
            {timeframe !== "all" && <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-[10px] font-bold">TF: {timeframe}</span>}
            {minScore > 0        && <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-[10px] font-bold">Score: {minScore}+</span>}
            {search              && <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-[10px] font-bold">"{search}"</span>}
            {fromDate            && <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-[10px] font-bold">From: {fromDate}</span>}
            {toDate              && <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-[10px] font-bold">To: {toDate}</span>}
            {latestPerCoin       && <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-foreground text-[10px] font-bold">Latest per coin</span>}
            <span className="text-[10px] font-bold text-muted-foreground self-center ml-1">{total.toLocaleString()} results</span>
          </div>
        )}
      </div>

      {/* ── Table ── */}
      <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <Table className="table-fixed w-full min-w-[784px]">
            <colgroup>
              <col className="w-[180px]" />
              <col className="w-[110px]" />
              <col className="w-[100px]" />
              <col className="w-[64px]" />
              <col className="w-[140px]" />
              <col className="w-[160px]" />
              <col className="w-[80px]" />
            </colgroup>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent border-border/50 h-10">
                <TableHead className="text-[10px] font-black uppercase pl-4">Symbol</TableHead>
                <TableHead className="text-[10px] font-black uppercase pl-3">Direction</TableHead>
                <TableHead className="text-[10px] font-black uppercase pl-3">Source</TableHead>
                <TableHead className="text-[10px] font-black uppercase pl-3">TF</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-right pr-4">Price</TableHead>
                <TableHead className="text-[10px] font-black uppercase pl-3">Detected At</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-center">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i} className="h-12">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : signals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-36 text-center text-muted-foreground font-bold text-[12px] uppercase">
                    No records match these filters
                  </TableCell>
                </TableRow>
              ) : (
                signals.map(sig => {
                  const isLong = sig.signal_type === "BUY" || sig.signal_type === "LONG";
                  return (
                    <TableRow key={sig.id} className="h-12 hover:bg-muted/30 transition-colors">
                      <TableCell className="py-2 pl-4">
                        <div className="flex flex-col leading-tight">
                          <span className="font-black text-[13px] text-foreground">{sig.symbol}</span>
                          <span className="text-[9px] text-muted-foreground uppercase font-bold">{sig.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2 pl-3">
                        <span className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase",
                          isLong
                            ? "bg-green-100 dark:bg-[#0ecb81]/15 text-green-700 dark:text-[#0ecb81]"
                            : "bg-red-100 dark:bg-[#f6465d]/15 text-red-700 dark:text-[#f6465d]",
                        )}>
                          {isLong ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                          {isLong ? "BULLISH" : "BEARISH"}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 pl-3">
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-muted border border-border text-foreground/80">
                          {sig.source}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 pl-3">
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-muted border border-border text-foreground/80">
                          {sig.timeframe}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 text-right pr-4">
                        <span className="font-mono font-bold text-[13px] tabular-nums">${fmtPrice(sig.entry_price)}</span>
                      </TableCell>
                      <TableCell className="py-2 pl-3">
                        <div className="flex flex-col leading-tight">
                          <span className="text-[11px] font-bold text-foreground">
                            {new Date(sig.crossover_timestamp).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {new Date(sig.crossover_timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2 text-center">
                        <span className={cn(
                          "inline-flex items-center justify-center w-9 h-9 rounded-lg font-black text-[12px] border",
                          sig.score >= 70
                            ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/20"
                            : sig.score >= 40
                            ? "bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/20"
                            : "bg-muted text-muted-foreground border-border",
                        )}>
                          {sig.score}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
            <p className="text-[11px] font-bold text-muted-foreground">
              {pageStart + 1}–{Math.min(total, pageStart + ITEMS_PER_PAGE)} of {total.toLocaleString()}
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage === 1}
                onClick={() => setCurrentPage(1)}>«</Button>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => p - 1)}><ChevronLeft size={14} /></Button>

              {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
                const p = start + idx;
                return (
                  <button key={p} onClick={() => setCurrentPage(p)}
                    className={cn(
                      "w-8 h-8 text-[11px] font-bold rounded border transition-colors",
                      p === currentPage ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:bg-muted",
                    )}>
                    {p}
                  </button>
                );
              })}

              <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => p + 1)}><ChevronRight size={14} /></Button>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(totalPages)}>»</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
