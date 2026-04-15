"use client";

import * as React from "react";
import { useState, useEffect, useMemo, useRef } from "react";
import { 
  Database, 
  Search, 
  Filter, 
  Calendar, 
  Download, 
  TrendingUp, 
  TrendingDown,
  RefreshCw,
  Clock,
  ChevronLeft,
  ChevronRight,
  DatabaseZap,
  Lock,
  Info,
  ShieldCheck
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDbSignalsAction, syncAllTimeframesAction } from "@/app/actions";
import type { DbSignal } from "@/lib/db";

const ITEMS_PER_PAGE = 50;

export default function SignalHistoryTerminal() {
  const [loading, setLoading] = useState(true);
  const [signals, setSignals] = useState<DbSignal[]>([]);
  const [total, setTotal] = useState(0);
  const [source, setSource] = useState("all");
  const [timeframe, setTimeframe] = useState("all");
  const [minScore, setMinScore] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [passError, setPassError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ binance: number; coingecko: number; ict: number } | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const SECRET_KEY = "Alpha5!Storm8@Cloud3#Fire";

  useEffect(() => {
    // Check session storage for existing auth
    const auth = sessionStorage.getItem("history_auth");
    if (auth === "true") setIsAuthenticated(true);
  }, []);

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === SECRET_KEY) {
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

  const fetchSignals = async (page = currentPage) => {
    setLoading(true);
    try {
      const fTs = fromDate ? new Date(fromDate).getTime() : undefined;
      const tTs = toDate ? new Date(toDate).setHours(23, 59, 59, 999) : undefined;

      const { signals: data, total: count } = await getDbSignalsAction({
        source: source === "all" ? undefined : source,
        timeframe: timeframe === "all" ? undefined : timeframe,
        minScore,
        fromTs: fTs && !isNaN(fTs) ? fTs : undefined,
        toTs: tTs && !isNaN(tTs) ? tTs : undefined,
        search: search || undefined,
        page,
        pageSize: ITEMS_PER_PAGE,
      });
      setSignals(data);
      setTotal(count);
    } catch (err) {
      console.error("Fetch history failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncAllTimeframesAction();
      setSyncResult(result);
      await fetchSignals(1);
    } catch { /* ignore */ } finally {
      setSyncing(false);
    }
  };

  // Reset to page 1 and fetch when filters change
  useEffect(() => {
    if (!isAuthenticated) return;
    setCurrentPage(1);
    fetchSignals(1);
  }, [isAuthenticated, source, timeframe, minScore, fromDate, toDate, search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch when page changes
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchSignals(currentPage);
  }, [currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce search input — only fires DB query 400ms after user stops typing
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchInput = (val: string) => {
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(val), 400);
  };

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
  const pageStart = (currentPage - 1) * ITEMS_PER_PAGE;

  const stats = useMemo(() => {
    // Count buy/sell from current page signals only (server-paginated)
    const buy = signals.filter(s => s.signal_type === "BUY" || s.signal_type === "LONG").length;
    const sell = signals.filter(s => s.signal_type === "SELL" || s.signal_type === "SHORT").length;
    return { buy, sell };
  }, [signals]);

  if (!isAuthenticated) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-background/80 backdrop-blur-xl" />
        <div className="w-full max-w-[400px] relative">
          <div className="gecko-card p-8 border-t-4 border-t-primary shadow-2xl">
            <div className="flex flex-col items-center text-center gap-4 mb-8">
              <div className="bg-primary/20 p-4 rounded-xl text-primary">
                <Lock size={32} />
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
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className={cn(
                    "w-full bg-muted border border-border rounded-lg px-4 py-3 text-[14px] font-mono tracking-widest focus:ring-1 focus:ring-primary outline-none text-center",
                    passError && "border-red-500 bg-red-500/10 animate-shake"
                  )}
                  autoFocus
                />
                {passError && (
                  <p className="text-[10px] font-bold text-red-500 text-center uppercase">Invalid authentication key</p>
                )}
              </div>
              <Button type="submit" className="w-full h-11 font-black uppercase tracking-widest gap-2">
                Decrypt Records
                <ChevronRight size={16} />
              </Button>
            </form>

            <div className="mt-8 pt-6 border-t border-border flex items-center justify-center gap-2 opacity-50">
              <div className="w-1.5 h-1.5 rounded-full bg-[#0ecb81] animate-pulse" />
              <span className="text-[9px] font-black uppercase tracking-widest">Secure Ledger Connection</span>
            </div>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tighter uppercase flex items-center gap-3">
            <DatabaseZap className="text-primary w-8 h-8" />
            Signal History
          </h1>
          <p className="text-[12px] font-bold text-muted-foreground uppercase opacity-80 text-primary">
            <Lock size={10} className="inline mr-1" /> Authorized Access — Internal Records Only
          </p>
        </div>

        <div className="flex items-center gap-2">
           <Button 
            variant="outline" 
            size="sm" 
            onClick={logout} 
            className="gap-2 h-9 font-bold border-red-500/20 text-red-500 hover:bg-red-500/10 hover:border-red-500/30 transition-all active:scale-95"
          >
            <Lock size={14} />
            Lock Vault
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="gap-2 h-9 font-bold px-3 border-[#2a90f7]/30 text-[#2a90f7] hover:bg-[#2a90f7]/10"
            title="Scan all sources × all timeframes and store to DB"
          >
            <RefreshCw size={14} className={cn(syncing && "animate-spin")} />
            {syncing ? "Syncing..." : "Sync All TFs"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fetchSignals(currentPage)} disabled={loading} className="gap-2 h-9 font-bold px-3">
            <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          </Button>
          <a 
            href={`/api/export?${new URLSearchParams({
              ...(source !== "all" ? { source } : {}),
              ...(timeframe !== "all" ? { timeframe } : {}),
              ...(minScore > 0 ? { minScore: String(minScore) } : {}),
              ...(search ? { search } : {}),
              ...(fromDate && !isNaN(new Date(fromDate).getTime()) ? { fromTs: String(new Date(fromDate).getTime()) } : {}),
              ...(toDate && !isNaN(new Date(toDate).getTime()) ? { toTs: String(new Date(toDate).setHours(23, 59, 59, 999)) } : {}),
            }).toString()}`}
            className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
          >
             <Download size={14} />
             Export CSV
          </a>
        </div>
      </div>

      {/* Sync result banner */}
      {syncResult && !syncing && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#23d565]/10 border border-[#23d565]/20 text-[11px] font-black uppercase tracking-widest text-[#23d565]">
          <ShieldCheck size={14} />
          Sync complete — Binance: +{syncResult.binance} · CoinGecko: +{syncResult.coingecko} · ICT: +{syncResult.ict} new signals stored
          <button onClick={() => setSyncResult(null)} className="ml-auto text-[#23d565]/50 hover:text-[#23d565] font-bold">✕</button>
        </div>
      )}
      {syncing && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#2a90f7]/10 border border-[#2a90f7]/20 text-[11px] font-black uppercase tracking-widest text-[#2a90f7]">
          <RefreshCw size={12} className="animate-spin" />
          Scanning all 6 timeframes across Binance, CoinGecko &amp; ICT — storing to DB...
        </div>
      )}

      {/* Data Integrity Notice */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-4 backdrop-blur-md">
        <div className="bg-primary/10 p-2 rounded-lg text-primary shrink-0">
          <ShieldCheck size={20} />
        </div>
        <div>
          <h3 className="text-sm font-black uppercase tracking-tight text-foreground">Immutable Signal Ledger</h3>
          <p className="text-[11px] text-muted-foreground font-medium leading-relaxed max-w-3xl">
            This database contains <span className="text-primary font-bold underline underline-offset-2">LOCKED</span> historical snapshots. Once a signal is detected and stored, 
            its entry price, score, and timestamp are captured permanently. These records never change, providing a verifiable history of strategy performance over time.
          </p>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="gecko-card p-5 border-l-4 border-l-primary bg-primary/[0.03] backdrop-blur-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:scale-110 transition-transform">
             <Database size={40} />
          </div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1 tracking-widest">Permanent Ledger</p>
          <p className="text-3xl font-black">{total.toLocaleString()}</p>
          <span className="text-[9px] font-bold text-primary/60 uppercase">Deduplicated Records</span>
        </div>
        <div className="gecko-card p-5 border-l-4 border-l-[#23d565] bg-[#23d565]/[0.03] backdrop-blur-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:scale-110 transition-transform">
             <TrendingUp size={40} />
          </div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1 tracking-widest">Bullish Entries</p>
          <p className="text-3xl font-black text-[#23d565]">{stats.buy.toLocaleString()}</p>
          <span className="text-[9px] font-bold text-[#23d565]/60 uppercase">Captured BUY setups</span>
        </div>
        <div className="gecko-card p-5 border-l-4 border-l-[#f6465d] bg-[#f6465d]/[0.03] backdrop-blur-sm relative overflow-hidden group text-[#f6465d]">
          <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:scale-110 transition-transform">
             <TrendingDown size={40} />
          </div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1 tracking-widest text-[#f6465d]/60">Bearish Entries</p>
          <p className="text-3xl font-black">{stats.sell.toLocaleString()}</p>
          <span className="text-[9px] font-bold text-[#f6465d]/60 uppercase text-[#f6465d]/60">Captured SELL setups</span>
        </div>
      </div>

      {/* Filters */}
      <div className="gecko-card p-6 space-y-4">
        <div className="flex flex-wrap items-end gap-6 border-b border-border pb-6">
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Source</span>
            <div className="flex bg-muted rounded-lg p-1 border border-border">
              {["all", "binance", "coingecko", "ict"].map(s => (
                <button
                  key={s}
                  onClick={() => setSource(s)}
                  className={cn(
                    "px-4 py-1.5 text-[11px] font-bold rounded-md transition-all uppercase",
                    source === s ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Timeframe</span>
            <select 
              value={timeframe} 
              onChange={e => setTimeframe(e.target.value)}
              className="bg-muted border border-border rounded-lg px-3 py-1.5 text-[11px] font-bold focus:ring-1 focus:ring-primary outline-none h-9"
            >
              <option value="all">ALL TIMEFRAMES</option>
              {["5m", "15m", "30m", "1h", "4h", "1d"].map(tf => (
                <option key={tf} value={tf}>{tf.toUpperCase()}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[200px] flex flex-col gap-2">
             <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Search Symbol</span>
             <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                <input
                  type="text"
                  placeholder="BTC, ETH, DOGE..."
                  value={searchInput}
                  onChange={e => handleSearchInput(e.target.value)}
                  className="w-full bg-muted border border-border rounded-lg pl-9 pr-4 py-2 text-[12px] font-bold focus:ring-1 focus:ring-primary outline-none h-9"
                />
             </div>
          </div>

          <div className="flex flex-col gap-2">
             <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Date Range</span>
             <div className="flex items-center gap-2 bg-muted rounded-lg p-1 border border-border h-9">
                <input 
                  type="date" 
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  className="bg-transparent border-none text-[11px] font-bold outline-none px-1 uppercase"
                />
                <span className="text-muted-foreground">→</span>
                <input 
                  type="date" 
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  className="bg-transparent border-none text-[11px] font-bold outline-none px-1 uppercase"
                />
             </div>
          </div>
        </div>

        {/* Table Area */}
        <div className="relative border border-border/50 rounded-xl overflow-hidden bg-card/50">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent border-border/50">
                <TableHead className="text-[10px] font-black uppercase py-4">Symbol</TableHead>
                <TableHead className="text-[10px] font-black uppercase">Direction</TableHead>
                <TableHead className="text-[10px] font-black uppercase">Source & TF</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-right flex items-center justify-end gap-1.5 h-[52px]">
                   Entry Price
                   <Lock size={10} className="text-primary/50" />
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase">Detected At</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-center">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 w-full bg-muted animate-pulse rounded" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : signals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-40 text-center text-muted-foreground font-bold uppercase text-[12px]">
                    No historical signals found for these filters
                  </TableCell>
                </TableRow>
              ) : (
                signals.map((sig) => {
                  const isBuy = sig.signal_type === "BUY" || sig.signal_type === "LONG";
                  return (
                    <TableRow key={sig.id} className="group hover:bg-primary/5 transition-colors border-border/30">
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-black text-[14px] text-foreground">{sig.symbol}</span>
                          <span className="text-[10px] text-muted-foreground uppercase font-bold">{sig.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                         <Badge 
                            variant="outline" 
                            className={cn(
                              "font-black text-[10px] px-2 py-0 border-none rounded-sm uppercase",
                              isBuy ? "bg-[#23d565]/15 text-[#23d565]" : "bg-[#f6465d]/15 text-[#f6465d]"
                            )}
                          >
                            {sig.signal_type}
                          </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] font-bold border-primary/20 text-primary/80 uppercase">
                            {sig.source}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px] font-bold uppercase">
                            {sig.timeframe}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="font-mono font-bold text-[14px] text-foreground tabular-nums">
                            ${sig.entry_price < 1 ? sig.entry_price.toFixed(6) : sig.entry_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          <span className="text-[8px] font-black text-primary/40 flex items-center gap-1 uppercase tracking-tighter">
                            <Lock size={8} /> Snapshot Locked
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                           <span className="text-[11px] font-bold text-foreground">
                             {new Date(sig.crossover_timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                           </span>
                           <span className="text-[10px] text-muted-foreground font-mono">
                             {new Date(sig.crossover_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                           </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                         <div className={cn(
                           "inline-flex items-center justify-center w-10 h-10 rounded-lg font-black text-[13px] border-2 shadow-sm",
                           sig.score >= 70 ? "bg-[#23d565]/10 text-[#23d565] border-[#23d565]/20" : "bg-muted text-muted-foreground border-border"
                         )}>
                           {sig.score}
                         </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4">
             <p className="text-[11px] font-bold text-muted-foreground uppercase">
                Showing {pageStart + 1}–{Math.min(total, pageStart + ITEMS_PER_PAGE)} of {total.toLocaleString()} entries
             </p>
             <div className="flex items-center gap-1">
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-8 w-8"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => prev - 1)}
                >
                  <ChevronLeft size={16} />
                </Button>
                <div className="flex items-center gap-1 mx-2">
                   <span className="text-[12px] font-black text-primary">{currentPage}</span>
                   <span className="text-[12px] font-bold text-muted-foreground">/ {totalPages}</span>
                </div>
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-8 w-8"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => prev + 1)}
                >
                  <ChevronRight size={16} />
                </Button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
