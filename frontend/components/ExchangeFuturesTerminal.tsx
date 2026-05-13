"use client";

import { useState, useEffect, useMemo, useCallback, useRef, memo, useDeferredValue } from "react";
import { TrendingUp, TrendingDown, RefreshCw, Activity, Calculator, Trophy, HelpCircle, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { pushAlerts, AlertsButton } from "@/components/SignalAlerts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EFSignalEntry {
    entryId: string;
    symbol: string;
    name: string;
    image: string;
    signalType: "BUY" | "SELL";
    signalName?: string;
    signalKind?: "TRIPLE_ALIGN" | "PULLBACK";
    timeframe: string;
    score: number;
    entryPrice: number;
    currentPrice: number;
    crossoverTimestamp: number;
    change1h: number;
    change24h: number;
    volume24h: number;
    volatility: number;
    volatilityTooltip?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawSignal = Record<string, any>;

interface EFTerminalProps {
    title?: string;
    description?: string;
    storageKey?: string;
    exportSource?: string;
    scanInterval?: number;
    initialData?: RawSignal[];
    fetchAction?: (timeframe?: string) => Promise<RawSignal[] | undefined | null>;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const DEFAULT_KEY = "coinpree_ef_signals_v7";
const MAX_STORED = 500;

function loadEntries(key: string): EFSignalEntry[] {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr.filter(
            (e): e is EFSignalEntry =>
                e && typeof e.entryId === "string" &&
                typeof e.symbol === "string" &&
                typeof e.crossoverTimestamp === "number",
        );
    } catch { return []; }
}

function saveEntries(entries: EFSignalEntry[], key: string) {
    try { localStorage.setItem(key, JSON.stringify(entries.slice(0, MAX_STORED))); }
    catch { /* quota */ }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CANDLE_MS: Record<string, number> = {
    "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};

function buildEntryId(coinId: string, signalType: string, tf: string, ts: number): string {
    const floor = CANDLE_MS[tf] ?? 60_000;
    return `${coinId}::${signalType}::${tf}::${Math.floor(ts / floor) * floor}`;
}

function toEntry(sig: RawSignal): EFSignalEntry {
    const tf: string = sig.timeframe ?? "1h";
    const candleMs = CANDLE_MS[tf] ?? 3_600_000;
    const ts: number = sig.crossoverTimestamp
        ?? (Math.floor(Date.now() / candleMs) * candleMs - ((sig.candlesAgo ?? 0) + 1) * candleMs);
    return {
        entryId: buildEntryId(sig.coinId ?? sig.symbol, sig.signalType, tf, ts),
        symbol: sig.symbol,
        name: sig.name ?? sig.symbol,
        image: sig.image ?? "",
        signalType: sig.signalType,
        signalName: sig.signalName ?? undefined,
        signalKind: sig.signalKind ?? inferKind(sig.signalName),
        timeframe: tf,
        score: sig.score ?? 0,
        entryPrice: sig.price ?? sig.entryPrice ?? 0,
        currentPrice: sig.currentPrice ?? sig.price ?? 0,
        crossoverTimestamp: ts,
        change1h: sig.change1h ?? 0,
        change24h: sig.change24h ?? 0,
        volume24h: sig.volume24h ?? 0,
        volatility: sig.volatility ?? 0,
        volatilityTooltip: sig.volatilityTooltip,
    };
}

function inferKind(name?: string): EFSignalEntry["signalKind"] {
    if (!name) return undefined;
    if (name.includes("Aligned"))  return "TRIPLE_ALIGN";
    if (name.includes("PULLBACK")) return "PULLBACK";
    return undefined;
}

function seedFromRaw(raw: RawSignal[]): EFSignalEntry[] {
    const seen = new Set<string>();
    const out: EFSignalEntry[] = [];
    for (const sig of raw) {
        if (!sig?.signalType) continue;
        const e = toEntry(sig);
        if (seen.has(e.entryId)) continue;
        seen.add(e.entryId);
        out.push(e);
    }
    return out.sort((a, b) => b.crossoverTimestamp - a.crossoverTimestamp).slice(0, MAX_STORED);
}

function formatPrice(p: number): string {
    if (!p || isNaN(p)) return "0.00";
    if (p < 0.0001) return p.toFixed(8);
    if (p < 0.1)    return p.toFixed(6);
    if (p < 10)     return p.toFixed(4);
    if (p < 1000)   return p.toFixed(2);
    return p.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const Pct = memo(({ val }: { val: number }) => {
    const v = val || 0;
    return (
        <span className={cn("inline-flex items-center font-bold text-[13px] tabular-nums", v >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]")}>
            {v >= 0 ? "▲" : "▼"} {Math.abs(v).toFixed(2)}%
        </span>
    );
});
Pct.displayName = "Pct";

const ColTip = ({ title, tip, right }: { title: string; tip: string; right?: boolean }) => (
    <div className={cn("flex items-center gap-1.5", right && "justify-end")}>
        <span>{title}</span>
        <Tooltip>
            <TooltipTrigger asChild>
                <HelpCircle size={12} className="text-muted-foreground/50 hover:text-primary cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[200px] text-xs z-50 p-3 bg-popover text-popover-foreground shadow-xl border-border">
                {tip}
            </TooltipContent>
        </Tooltip>
    </div>
);

const KIND_META: Record<NonNullable<EFSignalEntry["signalKind"]>, { label: string; cls: string }> = {
    TRIPLE_ALIGN: { label: "🔥 ALIGNED",  cls: "bg-violet-500/15 text-violet-400 border-violet-500/20" },
    PULLBACK:     { label: "🎯 PULLBACK", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
};

const KindBadge = memo(({ kind }: { kind: string }) => {
    const m = KIND_META[kind as "TRIPLE_ALIGN" | "PULLBACK"];
    if (!m) return null;
    return (
        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap", m.cls)}>
            {m.label}
        </span>
    );
});
KindBadge.displayName = "KindBadge";

const SignalRow = memo(({ entry, index, isNew }: { entry: EFSignalEntry; index: number; isNew: boolean }) => {
    const isBuy = entry.signalType === "BUY";
    const priceMoved = entry.currentPrice > 0 && entry.currentPrice !== entry.entryPrice;
    const time = new Date(entry.crossoverTimestamp).toLocaleString([], {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });

    return (
        <TableRow className={cn("gecko-table-row group transition-colors", isNew && "animate-pulse bg-primary/5")}>
            <TableCell className="w-10 text-center text-muted-foreground text-[11px] font-bold">{index + 1}</TableCell>

            <TableCell className="min-w-[200px] py-3">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0 flex items-center justify-center overflow-hidden border border-border">
                        {entry.image
                            ? <img src={entry.image} alt={entry.symbol} width={32} height={32} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                            : <span className="text-[10px] font-bold text-muted-foreground">{entry.symbol.slice(0, 2)}</span>
                        }
                    </div>
                    <div>
                        <div className="flex items-center gap-1.5">
                            <span className="font-bold text-[14px] text-foreground group-hover:text-primary transition-colors">{entry.symbol}</span>
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-bold border-border/50">#{index + 1}</Badge>
                        </div>
                        <span className="text-[11px] text-muted-foreground">{entry.name}</span>
                    </div>
                </div>
            </TableCell>

            <TableCell>
                <div className="flex flex-col gap-1 items-start">
                    <div className="flex items-center gap-1 flex-wrap">
                        <Badge className={cn("font-bold text-[10px] px-2 py-0.5 uppercase border-0",
                            isBuy ? "bg-[#0ecb81]/15 text-[#0ecb81]" : "bg-[#f6465d]/15 text-[#f6465d]")}>
                            {entry.signalType}
                        </Badge>
                        {entry.signalKind && <KindBadge kind={entry.signalKind} />}
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded">{time}</span>
                    <span className="text-[9px] font-bold uppercase text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded">{entry.timeframe}</span>
                </div>
            </TableCell>

            <TableCell>
                <div className="flex items-center gap-1.5">
                    <div className={cn("w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg border-2",
                        entry.score >= 70 ? "bg-[#0ecb81]/5 text-[#0ecb81] border-[#0ecb81]/20"
                        : entry.score >= 50 ? "bg-orange-500/5 text-orange-500 border-orange-500/20"
                        : "bg-[#f6465d]/5 text-[#f6465d] border-[#f6465d]/20")}>
                        {entry.score}
                    </div>
                    <div className="flex flex-col text-[10px] text-muted-foreground font-medium">
                        <span>SIGNAL</span><span>SCORE</span>
                    </div>
                </div>
            </TableCell>

            <TableCell className="text-right">
                <div className="flex flex-col items-end gap-0.5">
                    <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest">Entry</span>
                    <span className="text-[13px] font-bold text-foreground tabular-nums">${formatPrice(entry.entryPrice)}</span>
                    {priceMoved && (
                        <span className={cn("text-[11px] font-semibold tabular-nums",
                            entry.currentPrice > entry.entryPrice ? "text-[#0ecb81]" : "text-[#f6465d]")}>
                            Now ${formatPrice(entry.currentPrice)}
                        </span>
                    )}
                </div>
            </TableCell>

            <TableCell className="text-right"><Pct val={entry.change1h} /></TableCell>
            <TableCell className="text-right"><Pct val={entry.change24h} /></TableCell>

            <TableCell className="text-right">
                <span className="text-[13px] font-bold tabular-nums">
                    ${entry.volume24h ? (entry.volume24h / 1e6).toFixed(2) : "0.00"}M
                </span>
            </TableCell>

            <TableCell className="text-right">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className={cn("inline-flex items-center justify-center w-10 h-8 rounded-md font-bold text-sm cursor-help border",
                            entry.volatility >= 8 ? "bg-red-500/10 text-red-500 border-red-500/20"
                            : entry.volatility >= 6 ? "bg-orange-500/10 text-orange-500 border-orange-500/20"
                            : entry.volatility >= 4 ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                            : "bg-green-500/10 text-green-500 border-green-500/20")}>
                            {entry.volatility.toFixed(1)}
                        </div>
                    </TooltipTrigger>
                    <TooltipContent className="bg-popover border-border p-3 shadow-xl max-w-[250px] z-50">
                        <p className="text-xs font-mono whitespace-pre-wrap">{entry.volatilityTooltip || "No data"}</p>
                    </TooltipContent>
                </Tooltip>
            </TableCell>
        </TableRow>
    );
});
SignalRow.displayName = "SignalRow";

const StatsBar = memo(({ entries }: { entries: EFSignalEntry[] }) => {
    const buy  = entries.filter(e => e.signalType === "BUY").length;
    const sell = entries.filter(e => e.signalType === "SELL").length;
    const avg  = entries.length ? Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length) : 0;
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="gecko-card p-4 border-l-4 border-l-[#0ecb81] bg-[#0ecb81]/5">
                <div className="flex items-center justify-between mb-2">
                    <TrendingUp className="text-[#0ecb81]" size={20} />
                    <Badge className="bg-[#0ecb81]/20 text-[#0ecb81] text-[10px] font-bold">7›25›99</Badge>
                </div>
                <p className="text-3xl font-black text-[#0ecb81]">{buy}</p>
                <p className="text-[11px] font-bold text-muted-foreground uppercase">Buy Signals</p>
            </div>
            <div className="gecko-card p-4 border-l-4 border-l-[#f6465d] bg-[#f6465d]/5">
                <div className="flex items-center justify-between mb-2">
                    <TrendingDown className="text-[#f6465d]" size={20} />
                    <Badge className="bg-[#f6465d]/20 text-[#f6465d] text-[10px] font-bold">99›25›7</Badge>
                </div>
                <p className="text-3xl font-black text-[#f6465d]">{sell}</p>
                <p className="text-[11px] font-bold text-muted-foreground uppercase">Sell Signals</p>
            </div>
            <div className="gecko-card p-4 border-l-4 border-l-primary bg-primary/5">
                <div className="flex items-center justify-between mb-2">
                    <Calculator className="text-primary" size={20} />
                    <Badge className="bg-primary/20 text-primary text-[10px] font-bold">AVG</Badge>
                </div>
                <p className="text-3xl font-black text-primary">{avg}</p>
                <p className="text-[11px] font-bold text-muted-foreground uppercase">Avg Score</p>
            </div>
            <div className="gecko-card p-4 border-l-4 border-l-orange-500 bg-orange-500/5">
                <div className="flex items-center justify-between mb-2">
                    <Trophy className="text-orange-500" size={20} />
                    <Badge className="bg-orange-500/20 text-orange-500 text-[10px] font-bold">TOTAL</Badge>
                </div>
                <p className="text-3xl font-black text-orange-500">{entries.length}</p>
                <p className="text-[11px] font-bold text-muted-foreground uppercase">Stored Signals</p>
            </div>
        </div>
    );
});
StatsBar.displayName = "StatsBar";

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ExchangeFuturesTerminal({
    title = "EXCHANGE FUTURES MARKET",
    description = "Triple EMA Strategy 7 › 25 › 99",
    storageKey = DEFAULT_KEY,
    exportSource,
    scanInterval = 30_000,
    initialData = [],
    fetchAction,
}: EFTerminalProps) {
    // Initialize from initialData (available on both server + client — no hydration mismatch).
    // After mount, localStorage silently upgrades to historical data.
    const [entries, setEntries] = useState<EFSignalEntry[]>(() =>
        initialData.length > 0 ? seedFromRaw(initialData) : []
    );
    const [newIds,     setNewIds]     = useState<Set<string>>(new Set());
    const [refreshing, setRefreshing] = useState(false);
    const [timeframe,  setTimeframe]  = useState("all");
    const [search,     setSearch]     = useState("");
    const [page,       setPage]       = useState(1);
    const PAGE = 50;

    const [lastScan,    setLastScan]    = useState<number>(0);
    const [exportOpen,  setExportOpen]  = useState(false);
    const [exportTf,    setExportTf]    = useState("all");
    const [exportType,  setExportType]  = useState("all");
    const [exportScore, setExportScore] = useState(70);

    // After mount: upgrade from localStorage (has more history than initialData)
    useEffect(() => {
        const stored = loadEntries(storageKey);
        if (stored.length > 0) setEntries(stored);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { setPage(1); }, [search, timeframe]);

    // Stable ref so fetchAndMerge doesn't need timeframe in its deps
    const tfRef = useRef(timeframe);
    useEffect(() => { tfRef.current = timeframe; }, [timeframe]);

    // Debounced save — at most once per 3 s
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const save = useCallback((data: EFSignalEntry[]) => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => saveEntries(data, storageKey), 3000);
    }, [storageKey]);

    const knownIds  = useRef<Set<string>>(new Set());
    const didLoad   = useRef(false);

    // Seed knownIds once from initial entries (runs once after mount)
    const knownIdsSeeded = useRef(false);
    useEffect(() => {
        if (knownIdsSeeded.current) return;
        knownIdsSeeded.current = true;
        entries.forEach(e => knownIds.current.add(e.entryId));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const fetchAndMerge = useCallback(async (tfOverride?: string, manual = false) => {
        if (!fetchAction) return;
        if (manual) setRefreshing(true);
        try {
            const activeTf = tfOverride ?? tfRef.current;
            const raw = await fetchAction(activeTf);
            setLastScan(Date.now());
            if (!raw?.length) return;

            const fresh: EFSignalEntry[] = [];
            const brandNew: EFSignalEntry[] = [];
            const newEntryIds: string[] = [];

            for (const sig of raw) {
                if (!sig?.signalType) continue;
                const e = toEntry(sig);
                fresh.push(e);
                if (!knownIds.current.has(e.entryId)) {
                    newEntryIds.push(e.entryId);
                    brandNew.push(e);
                    knownIds.current.add(e.entryId);
                }
            }

            if (newEntryIds.length > 0) {
                setNewIds(new Set(newEntryIds));
                setTimeout(() => setNewIds(new Set()), 8000);
                if (didLoad.current) {
                    pushAlerts("Binance Futures", brandNew.map(e => ({
                        symbol: e.symbol, name: e.name, image: e.image,
                        signalType: e.signalType, timeframe: e.timeframe, score: e.score,
                    })));
                }
            }
            didLoad.current = true;

            setEntries(prev => {
                // Use a Map to guarantee unique entryIds — concurrent TF polls can produce duplicates
                const map = new Map<string, EFSignalEntry>();
                for (const e of [...fresh, ...prev.filter(e => e.timeframe !== activeTf)]) {
                    if (!map.has(e.entryId)) map.set(e.entryId, e);
                }
                const merged = [...map.values()]
                    .sort((a, b) => b.crossoverTimestamp - a.crossoverTimestamp)
                    .slice(0, MAX_STORED);

                // Skip re-render if nothing actually changed
                if (
                    merged.length === prev.length &&
                    merged.every((e, i) => e.entryId === prev[i].entryId && e.currentPrice === prev[i].currentPrice)
                ) return prev;

                save(merged);
                return merged;
            });
        } catch (err) {
            console.warn("[EF]", err);
        } finally {
            if (manual) setRefreshing(false);
        }
    }, [fetchAction, save]);

    // Poll all timeframes in one "all" call — same as manual refresh.
    // Server-side scans all 6 TFs sequentially and returns the union.
    useEffect(() => {
        fetchAndMerge("all");
        const id = setInterval(() => fetchAndMerge("all"), scanInterval);
        return () => clearInterval(id);
    }, [fetchAndMerge, scanInterval]);

    // Tick every second to keep "last scanned" display fresh
    const [, setTick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setTick(n => n + 1), 1000);
        return () => clearInterval(t);
    }, []);

    // Immediate fetch when switching to a specific TF — show spinner since user expects it
    const prevTf = useRef(timeframe);
    useEffect(() => {
        if (prevTf.current === timeframe) return;
        prevTf.current = timeframe;
        if (timeframe !== "all") fetchAndMerge(timeframe, true);
    }, [timeframe, fetchAndMerge]);

    const deferredSearch = useDeferredValue(search);
    const filtered = useMemo(() => {
        const byTf = timeframe === "all" ? entries : entries.filter(e => e.timeframe === timeframe);
        if (!deferredSearch.trim()) return byTf;
        const terms = deferredSearch.toLowerCase().split(/[\s,]+/).filter(Boolean);
        return byTf.filter(e => terms.some(t =>
            e.symbol.toLowerCase().includes(t) ||
            e.name.toLowerCase().includes(t) ||
            e.signalType.toLowerCase() === t ||
            e.timeframe === t ||
            (e.signalKind ?? "").toLowerCase().includes(t) ||
            (e.signalName ?? "").toLowerCase().includes(t)
        ));
    }, [entries, deferredSearch, timeframe]);

    const totalPages = Math.ceil(filtered.length / PAGE);
    const pageStart  = (page - 1) * PAGE;
    const pageItems  = useMemo(() => filtered.slice(pageStart, pageStart + PAGE), [filtered, pageStart]);

    return (
        <TooltipProvider delayDuration={0}>
        <div className="space-y-6">

            {/* Title Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-lg md:text-3xl font-black text-foreground tracking-tighter uppercase leading-tight">{title}</h1>
                    <p className="text-[10px] md:text-[12px] font-bold text-muted-foreground uppercase opacity-80">{description}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {/* Timeframe */}
                    <div className="flex bg-muted rounded-lg p-1 border border-border">
                        {["all","5m","15m","30m","1h","4h","1d"].map(tf => (
                            <button key={tf} onClick={() => { setTimeframe(tf); setPage(1); }}
                                className={cn("px-3 py-1 text-[11px] font-bold rounded-md transition-all whitespace-nowrap",
                                    timeframe === tf ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                                {tf.toUpperCase()}
                            </button>
                        ))}
                    </div>
                    {/* Live dot */}
                    <div className="flex items-center gap-1.5">
                        <div className={cn("h-2 w-2 rounded-full animate-pulse", refreshing ? "bg-primary" : "bg-green-500")} />
                        <span className="text-[11px] text-muted-foreground hidden sm:inline">
                            {refreshing ? "Updating…" : lastScan ? `Scanned ${Math.floor((Date.now() - lastScan) / 1000)}s ago` : "Scanning…"}
                        </span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => fetchAndMerge(undefined, true)} disabled={refreshing} className="h-8">
                        <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
                    </Button>
                    <AlertsButton page="Binance Futures" />

                    {/* Export */}
                    <Dialog open={exportOpen} onOpenChange={setExportOpen}>
                        <DialogTrigger asChild>
                            <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                                <Download size={12} strokeWidth={2.5} /> Export
                            </button>
                        </DialogTrigger>
                        <DialogContent className="max-w-sm">
                            <DialogHeader>
                                <DialogTitle className="text-sm font-bold flex items-center gap-2">
                                    <Download size={14} /> Export Signals as CSV
                                </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 pt-2">
                                <div>
                                    <p className="text-[11px] text-muted-foreground font-semibold uppercase mb-1.5">Timeframe</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {["all","5m","15m","30m","1h","4h","1d"].map(tf => (
                                            <button key={tf} onClick={() => setExportTf(tf)}
                                                className={cn("px-2.5 py-1 rounded text-[11px] font-bold border transition-all",
                                                    exportTf === tf ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                                                {tf.toUpperCase()}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-[11px] text-muted-foreground font-semibold uppercase mb-1.5">Signal Type</p>
                                    <div className="flex gap-1.5">
                                        {["all","BUY","SELL"].map(t => (
                                            <button key={t} onClick={() => setExportType(t)}
                                                className={cn("px-2.5 py-1 rounded text-[11px] font-bold border transition-all",
                                                    exportType === t ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                                                {t}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-[11px] text-muted-foreground font-semibold uppercase mb-1.5">
                                        Min Score: <span className="text-foreground">{exportScore}</span>
                                    </p>
                                    <input type="range" min={70} max={100} step={1} value={exportScore}
                                        onChange={e => setExportScore(Number(e.target.value))} className="w-full accent-primary" />
                                    <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                                        <span>70</span><span>85</span><span>100</span>
                                    </div>
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                    Matching: <span className="text-foreground font-bold">
                                        {entries.filter(e =>
                                            (exportTf === "all" || e.timeframe === exportTf) &&
                                            (exportType === "all" || e.signalType === exportType) &&
                                            e.score >= exportScore
                                        ).length}
                                    </span>
                                </p>
                                <a
                                    href={`/api/export?${new URLSearchParams({
                                        ...(exportSource ? { source: exportSource } : {}),
                                        ...(exportTf !== "all" ? { timeframe: exportTf } : {}),
                                        ...(exportType !== "all" ? { signalType: exportType } : {}),
                                        minScore: String(exportScore),
                                    })}`}
                                    download onClick={() => setExportOpen(false)}
                                    className="flex items-center justify-center gap-2 w-full h-9 rounded-lg text-[12px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                                >
                                    <Download size={13} strokeWidth={2.5} /> Download CSV
                                </a>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <StatsBar entries={filtered} />

            {/* Search */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                    <input type="text" placeholder="Search coins or signal type…" value={search}
                        onChange={e => { setSearch(e.target.value); setPage(1); }}
                        className="w-full h-9 pl-9 pr-4 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                    <Activity size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                </div>
                <span className="text-[11px] text-muted-foreground">{filtered.length} entries</span>
            </div>

            {/* Table */}
            <div className="gecko-card rounded-xl overflow-hidden border border-border">
                {filtered.length === 0 ? (
                    <div className="p-12 text-center">
                        <Activity size={40} className="mx-auto mb-4 text-muted-foreground/30" />
                        <p className="text-sm font-bold text-muted-foreground">No signals yet</p>
                        <p className="text-[11px] text-muted-foreground/60 mt-1">Scanner runs every 5s · EMA 7/25/99 · PRE-CROSS → ALIGNED → PULLBACK</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="gecko-table-header">
                                    <TableHead className="w-10 text-center text-[10px] font-black uppercase">#</TableHead>
                                    <TableHead className="text-[10px] font-black uppercase">Coin</TableHead>
                                    <TableHead className="text-[10px] font-black uppercase">
                                        <ColTip title="Signal & Timing" tip="EMA 7>25>99 (Bull) · 99>25>7 (Bear)" />
                                    </TableHead>
                                    <TableHead className="text-[10px] font-black uppercase">
                                        <ColTip title="Score" tip="Signal quality 0–100" />
                                    </TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">
                                        <ColTip title="Price" tip="Entry price + live now price" right />
                                    </TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">
                                        <ColTip title="1H %" tip="Change vs ~1h ago" right />
                                    </TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">24H %</TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">Volume</TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">
                                        <ColTip title="Vol." tip="Volatility 0–10" right />
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pageItems.map((entry, i) => (
                                    <SignalRow key={entry.entryId} entry={entry} index={pageStart + i} isNew={newIds.has(entry.entryId)} />
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                        <span className="text-[11px] text-muted-foreground">Page {page} of {totalPages} ({filtered.length})</span>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</Button>
                            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</Button>
                        </div>
                    </div>
                )}
            </div>

        </div>
        </TooltipProvider>
    );
}
