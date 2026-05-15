"use client";

import { useState, useEffect, useMemo, useCallback, useRef, memo, useDeferredValue } from "react";
import { TrendingUp, TrendingDown, RefreshCw, Activity, Calculator, Trophy, HelpCircle, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { pushAlerts, AlertsButton, type AlertPage } from "@/components/SignalAlerts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { EFSignalEntry } from "@/lib/types/signals";
import { CoinIcon, symbolToCoinId } from "@/components/CoinIcon";
import { ScannedAgo } from "@/components/SignalAge";
import { exportSignalsCsvAction } from "@/app/actions";

export type { EFSignalEntry };

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
    alertPage?: AlertPage;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const DEFAULT_KEY = "coinpree_ef_signals_v10";
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
                typeof e.crossoverTimestamp === "number" &&
                (e.score ?? 0) >= 40,
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

// One entry per coin+direction+timeframe — new crossovers overwrite old ones.
function buildEntryId(coinId: string, signalType: string, tf: string): string {
    return `${coinId}::${signalType}::${tf}`;
}

function toEntry(sig: RawSignal): EFSignalEntry {
    const tf: string = sig.timeframe ?? "1h";
    const candleMs = CANDLE_MS[tf] ?? 3_600_000;
    const ts: number = sig.crossoverTimestamp
        ?? (Math.floor(Date.now() / candleMs) * candleMs - ((sig.candlesAgo ?? 0) + 1) * candleMs);
    return {
        entryId: buildEntryId(sig.coinId ?? sig.symbol, sig.signalType, tf),
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


// ─── Delay indicator ──────────────────────────────────────────────────────────

function signalDelayLabel(crossoverTimestamp: number, tf: string): { label: string; warn: boolean } | null {
    const candleMs = CANDLE_MS[tf] ?? 3_600_000;
    const delaySec = Math.floor((Date.now() - (crossoverTimestamp + candleMs)) / 1000);
    if (delaySec < candleMs / 1000 * 1.5) return null;
    const mins = Math.floor(delaySec / 60);
    const hrs  = Math.floor(mins / 60);
    return {
        label: hrs > 0 ? `${hrs}h late` : `${mins}m late`,
        warn: delaySec >= candleMs / 1000 * 3,
    };
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

const SignalRow = memo(({ entry, index, isNew }: {
    entry: EFSignalEntry; index: number; isNew: boolean;
}) => {
    const isBuy = entry.signalType === "BUY";
    const priceMoved = entry.currentPrice > 0 && entry.currentPrice !== entry.entryPrice;
    const time = new Date(entry.crossoverTimestamp).toLocaleString([], {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const delay = signalDelayLabel(entry.crossoverTimestamp, entry.timeframe);

    return (
        <TableRow className={cn("gecko-table-row group transition-colors", isNew && "animate-pulse bg-primary/5")}>
            <TableCell className="w-10 text-center text-muted-foreground text-[11px] font-bold">{index + 1}</TableCell>

            <TableCell className="min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2">
                    <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-muted flex-shrink-0 flex items-center justify-center overflow-hidden border border-border">
                        <CoinIcon symbol={entry.coinId ?? symbolToCoinId(entry.symbol)} size={28} />
                    </div>
                    <div className="min-w-0">
                        <span className="font-bold text-[11px] sm:text-[14px] text-foreground group-hover:text-primary transition-colors truncate block">{entry.symbol}</span>
                        <span className="text-[9px] sm:text-[10px] text-muted-foreground hidden sm:block">{entry.name}</span>
                    </div>
                </div>
            </TableCell>

            <TableCell className="min-w-0">
                <div className="flex flex-col gap-0.5 sm:gap-1 items-start">
                    <div className="flex items-center gap-1 flex-wrap">
                        <Badge className={cn("font-bold text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 uppercase border-0",
                            isBuy ? "bg-[#0ecb81]/15 text-[#0ecb81]" : "bg-[#f6465d]/15 text-[#f6465d]")}>
                            {isBuy ? "BULL" : "BEAR"}
                        </Badge>
                        {entry.signalKind && <KindBadge kind={entry.signalKind} />}
                    </div>
                    <div className="hidden sm:flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded" suppressHydrationWarning>{time}</span>
                        {delay && (
                            <span suppressHydrationWarning className={cn(
                                "text-[9px] font-bold px-1.5 py-0.5 rounded",
                                delay.warn ? "bg-orange-500/15 text-orange-400" : "bg-muted text-muted-foreground",
                            )}>
                                {delay.warn ? "⚠ " : ""}{delay.label}
                            </span>
                        )}
                    </div>
                    <span className="text-[9px] font-bold uppercase text-primary/70 bg-primary/10 px-1 sm:px-1.5 py-0.5 rounded">{entry.timeframe}</span>
                </div>
            </TableCell>

            <TableCell>
                <div className="flex items-center gap-1.5">
                    <div className={cn("w-9 h-9 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center font-bold text-[13px] sm:text-[15px] border-2",
                        entry.score >= 70 ? "bg-[#0ecb81]/5 text-[#0ecb81] border-[#0ecb81]/20"
                        : entry.score >= 50 ? "bg-orange-500/5 text-orange-500 border-orange-500/20"
                        : "bg-[#f6465d]/5 text-[#f6465d] border-[#f6465d]/20")}>
                        {entry.score}
                    </div>
                    <div className="flex-col text-[9px] text-muted-foreground font-medium hidden sm:flex">
                        <span>SIGNAL</span><span>SCORE</span>
                    </div>
                </div>
            </TableCell>

            <TableCell className="text-right">
                <div className="flex flex-col items-end gap-0.5">
                    <span className="text-[11px] sm:text-[13px] font-bold text-foreground tabular-nums">${formatPrice(entry.entryPrice)}</span>
                    {priceMoved && (
                        <span className={cn("text-[11px] font-semibold tabular-nums",
                            entry.currentPrice > entry.entryPrice ? "text-[#0ecb81]" : "text-[#f6465d]")}>
                            Now ${formatPrice(entry.currentPrice)}
                        </span>
                    )}
                </div>
            </TableCell>

            <TableCell className="hidden md:table-cell text-right"><Pct val={entry.change1h} /></TableCell>
            <TableCell className="hidden sm:table-cell text-right"><Pct val={entry.change24h} /></TableCell>

            <TableCell className="hidden lg:table-cell text-right">
                <span className="text-[13px] font-bold tabular-nums">
                    ${entry.volume24h ? (entry.volume24h / 1e6).toFixed(2) : "0.00"}M
                </span>
            </TableCell>

            <TableCell className="hidden lg:table-cell text-right">
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
                    <TooltipContent side="top" className="bg-popover text-popover-foreground border-border p-3 shadow-xl max-w-[250px] z-50">
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            {/* Bullish */}
            <div className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Bullish</span>
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#0ecb81]/12 text-[#0ecb81]">7›25›99</span>
                    </div>
                    <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-[#0ecb81]">{buy}</p>
                </div>
                <svg width="60" height="48" viewBox="0 0 72 56" fill="none" className="shrink-0 hidden sm:block text-[#0ecb81] opacity-80">
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
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#f6465d]/12 text-[#f6465d]">99›25›7</span>
                    </div>
                    <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-[#f6465d]">{sell}</p>
                </div>
                <svg width="60" height="48" viewBox="0 0 72 56" fill="none" className="shrink-0 hidden sm:block text-[#f6465d] opacity-80">
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
            {/* Avg Score */}
            <div className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Avg Score</span>
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-foreground/10 text-foreground">AVG</span>
                    </div>
                    <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-foreground">{avg}</p>
                </div>
                <svg width="52" height="52" viewBox="0 0 56 56" fill="none" className="shrink-0 hidden sm:block text-foreground opacity-70">
                    <circle cx="28" cy="28" r="22" stroke="currentColor" strokeWidth="3" strokeOpacity="0.12"/>
                    <circle cx="28" cy="28" r="22" stroke="currentColor" strokeWidth="3" strokeDasharray="100 38" strokeLinecap="round" fill="none" transform="rotate(-90 28 28)"/>
                    <circle cx="28" cy="28" r="13" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.18" fill="none"/>
                    <circle cx="28" cy="28" r="4" fill="currentColor" fillOpacity="0.55"/>
                    <line x1="28" y1="6" x2="28" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
                    <line x1="50" y1="28" x2="44" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
                    <line x1="6" y1="28" x2="12" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35"/>
                </svg>
                <div className="absolute bottom-0 left-0 h-[3px] w-full bg-gradient-to-r from-foreground/40 to-transparent"/>
            </div>
            {/* Total */}
            <div className="relative overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Stored</span>
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-orange-500/12 text-orange-500">TOTAL</span>
                    </div>
                    <p className="text-[18px] sm:text-[30px] font-black tracking-tighter leading-none text-orange-500">{entries.length}</p>
                </div>
                <svg width="52" height="52" viewBox="0 0 60 56" fill="none" className="shrink-0 hidden sm:block text-orange-500 opacity-80">
                    <ellipse cx="30" cy="44" rx="22" ry="7" fill="currentColor" fillOpacity="0.25"/>
                    <path d="M8 28L8 44C8 48.4 18 51 30 51C42 51 52 48.4 52 44L52 28" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.35" fill="none"/>
                    <ellipse cx="30" cy="28" rx="22" ry="7" fill="currentColor" fillOpacity="0.5"/>
                    <path d="M8 12L8 28C8 32.4 18 35 30 35C42 35 52 32.4 52 28L52 12" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5" fill="none"/>
                    <ellipse cx="30" cy="12" rx="22" ry="7" fill="currentColor" fillOpacity="0.8"/>
                </svg>
                <div className="absolute bottom-0 left-0 h-[3px] w-full" style={{background:"linear-gradient(90deg,#f9731690,transparent)"}}/>
            </div>
        </div>
    );
});
StatsBar.displayName = "StatsBar";

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ExchangeFuturesTerminal({
    title = "",
    description = "Triple EMA Strategy 7 › 25 › 99",
    storageKey = DEFAULT_KEY,
    exportSource,
    scanInterval = 30_000,
    initialData = [],
    fetchAction,
    alertPage = "Futures",
}: EFTerminalProps) {
    const [entries, setEntries] = useState<EFSignalEntry[]>(() => {
        if (initialData.length > 0) return seedFromRaw(initialData);
        if (typeof window === "undefined") return [];
        return loadEntries(DEFAULT_KEY);
    });
    const [newIds,       setNewIds]       = useState<Set<string>>(new Set());
    const [refreshing,   setRefreshing]   = useState(false);
    const [timeframe,    setTimeframe]    = useState("all");
    const [search,       setSearch]       = useState("");
    const [page,         setPage]         = useState(1);
    const [lastScan,     setLastScan]     = useState<number>(0);
    const [exportOpen,   setExportOpen]   = useState(false);
    const [exportTf,     setExportTf]     = useState("all");
    const [exportType,   setExportType]   = useState("all");
    const [exportScore,  setExportScore]  = useState(70);
    const [filterDirection, setFilterDirection] = useState<"all"|"BUY"|"SELL">("all");
    const [filterKind,      setFilterKind]      = useState<"all"|"TRIPLE_ALIGN"|"PULLBACK">("all");
    const [sortBy,          setSortBy]          = useState<"time"|"score"|"volume"|"change24h">("time");
    const PAGE = 50;

    useEffect(() => { setPage(1); }, [search, timeframe, filterDirection, filterKind, sortBy]);

    const tfRef = useRef(timeframe);
    useEffect(() => { tfRef.current = timeframe; }, [timeframe]);

    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const save = useCallback((data: EFSignalEntry[]) => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => saveEntries(data, storageKey), 3000);
    }, [storageKey]);

    // Maps entryId → last seen crossoverTimestamp; new signal if ts advanced.
    const knownIdsWithTs = useRef<Map<string, number>>(new Map());
    const didLoad        = useRef(false);
    const newIdsTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sseNudgeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

    const knownIdsSeeded = useRef(false);
    useEffect(() => {
        if (knownIdsSeeded.current) return;
        knownIdsSeeded.current = true;
        entries.forEach(e => knownIdsWithTs.current.set(e.entryId, e.crossoverTimestamp));
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
                const knownTs = knownIdsWithTs.current.get(e.entryId);
                if (knownTs === undefined || e.crossoverTimestamp > knownTs) {
                    newEntryIds.push(e.entryId);
                    brandNew.push(e);
                    knownIdsWithTs.current.set(e.entryId, e.crossoverTimestamp);
                    if (knownIdsWithTs.current.size > 2000) {
                        const arr = [...knownIdsWithTs.current.entries()];
                        knownIdsWithTs.current = new Map(arr.slice(arr.length - 1000));
                    }
                }
            }

            if (newEntryIds.length > 0) {
                setNewIds(new Set(newEntryIds));
                if (newIdsTimer.current) clearTimeout(newIdsTimer.current);
                newIdsTimer.current = setTimeout(() => setNewIds(new Set()), 8000);
                if (didLoad.current) {
                    pushAlerts(alertPage, brandNew.map(e => ({
                        symbol: e.symbol, name: e.name, image: e.image,
                        signalType: e.signalType, timeframe: e.timeframe, score: e.score,
                    })));
                }
            }
            didLoad.current = true;

            setEntries(prev => {
                const map = new Map<string, EFSignalEntry>();
                for (const e of [...fresh, ...prev]) {
                    const existing = map.get(e.entryId);
                    if (!existing || e.crossoverTimestamp > existing.crossoverTimestamp)
                        map.set(e.entryId, e);
                }
                const merged = [...map.values()]
                    .sort((a, b) => b.crossoverTimestamp - a.crossoverTimestamp)
                    .slice(0, MAX_STORED);

                if (
                    merged.length === prev.length &&
                    merged.every((e, i) => e.entryId === prev[i].entryId && e.currentPrice === prev[i].currentPrice)
                ) return prev;

                save(merged);
                return merged;
            });
        } catch {
            // silent
        } finally {
            if (manual) setRefreshing(false);
        }
    }, [fetchAction, save, alertPage]);

    useEffect(() => {
        fetchAndMerge("all");
        const id = setInterval(() => fetchAndMerge("all"), scanInterval);
        return () => clearInterval(id);
    }, [fetchAndMerge, scanInterval]);

    // SSE: trigger immediate fetch when a binance signal arrives
    useEffect(() => {
        if (!fetchAction) return;
        const es = new EventSource("/api/stream");
        es.onmessage = (e: MessageEvent) => {
            try {
                const sig = JSON.parse(e.data as string) as { source?: string };
                if (sig.source !== "binance") return;
                if (sseNudgeTimer.current) clearTimeout(sseNudgeTimer.current);
                sseNudgeTimer.current = setTimeout(() => fetchAndMerge("all"), 600);
            } catch { /* malformed */ }
        };
        es.onerror = () => { es.close(); };
        return () => {
            es.close();
            if (sseNudgeTimer.current) clearTimeout(sseNudgeTimer.current);
        };
    }, [fetchAction, fetchAndMerge]);


    const prevTf = useRef(timeframe);
    useEffect(() => {
        if (prevTf.current === timeframe) return;
        prevTf.current = timeframe;
        if (timeframe !== "all") fetchAndMerge(timeframe, true);
    }, [timeframe, fetchAndMerge]);

    const deferredSearch = useDeferredValue(search);
    const filtered = useMemo(() => {
        let list = timeframe === "all" ? entries : entries.filter(e => e.timeframe === timeframe);
        if (filterDirection !== "all") list = list.filter(e => e.signalType === filterDirection);
        if (filterKind !== "all")      list = list.filter(e => e.signalKind === filterKind);
        if (deferredSearch.trim()) {
            const terms = deferredSearch.toLowerCase().split(/[\s,]+/).filter(Boolean);
            list = list.filter(e => terms.some(t =>
                e.symbol.toLowerCase().includes(t) ||
                e.name.toLowerCase().includes(t) ||
                e.signalType.toLowerCase() === t ||
                e.timeframe === t ||
                (e.signalKind ?? "").toLowerCase().includes(t) ||
                (e.signalName ?? "").toLowerCase().includes(t)
            ));
        }
        return [...list].sort((a, b) => {
            if (sortBy === "score")     return b.score - a.score;
            if (sortBy === "volume")    return (b.volume24h ?? 0) - (a.volume24h ?? 0);
            if (sortBy === "change24h") return Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0);
            return b.crossoverTimestamp - a.crossoverTimestamp;
        });
    }, [entries, deferredSearch, timeframe, filterDirection, filterKind, sortBy]);

    const totalPages = Math.ceil(filtered.length / PAGE);
    const pageStart  = (page - 1) * PAGE;
    const pageItems  = useMemo(() => filtered.slice(pageStart, pageStart + PAGE), [filtered, pageStart]);

    return (
        <TooltipProvider delayDuration={0}>
        <div className="space-y-3 sm:space-y-5">

            {/* Title Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 sm:gap-4">
                <div>
                    {title && <h1 className="text-[14px] sm:text-lg md:text-3xl font-black text-foreground tracking-tighter uppercase leading-tight">{title}</h1>}
                    {description && <p className="text-[9px] sm:text-[10px] md:text-[12px] font-bold text-muted-foreground uppercase opacity-80">{description}</p>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {/* Timeframe */}
                    <div className="overflow-x-auto no-scrollbar">
                    <div className="flex bg-muted rounded-lg p-1 border border-border">
                        {["all","5m","15m","30m","1h","4h","1d"].map(tf => (
                            <button key={tf} onClick={() => { setTimeframe(tf); setPage(1); }}
                                className={cn("px-3 py-1 text-[11px] font-bold rounded-md transition-all whitespace-nowrap",
                                    timeframe === tf ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                                {tf.toUpperCase()}
                            </button>
                        ))}
                    </div>
                    </div>
                    {/* Live dot */}
                    <div className="flex items-center gap-1.5">
                        <div className={cn("h-2 w-2 rounded-full animate-pulse", refreshing ? "bg-primary" : "bg-green-500")} />
                        <span className="text-[11px] text-muted-foreground hidden sm:inline">
                            {refreshing ? "Updating…" : lastScan ? <>Scanned <ScannedAgo ts={lastScan} /></> : "Scanning…"}
                        </span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => fetchAndMerge(undefined, true)} disabled={refreshing} className="h-8">
                        <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
                    </Button>
                    <AlertsButton page={alertPage} />

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
                                                {t === "BUY" ? "BULLISH" : t === "SELL" ? "BEARISH" : t}
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
                                <button
                                    onClick={async () => {
                                        const csv = await exportSignalsCsvAction(
                                            exportSource,
                                            exportTf !== "all" ? exportTf : undefined,
                                            exportScore,
                                        );
                                        const filteredCsv = exportType === "all" ? csv : csv
                                            .split("\n")
                                            .filter((l, i) => i === 0 || l.toLowerCase().includes(exportType.toLowerCase()))
                                            .join("\n");
                                        const blob = new Blob([filteredCsv], { type: "text/csv" });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement("a");
                                        a.href = url; a.download = "signals.csv"; a.click();
                                        URL.revokeObjectURL(url);
                                        setExportOpen(false);
                                    }}
                                    className="flex items-center justify-center gap-2 w-full h-9 rounded-lg text-[12px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                                >
                                    <Download size={13} strokeWidth={2.5} /> Download CSV
                                </button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <StatsBar entries={filtered} />

            {/* Search + Filters */}
            <div className="space-y-2">
                <div className="flex items-center gap-3">
                    <div className="relative flex-1 max-w-full sm:max-w-sm">
                        <input type="text" placeholder="Search coins or signal type…" value={search}
                            onChange={e => { setSearch(e.target.value); setPage(1); }}
                            className="w-full h-8 pl-8 pr-3 rounded-lg border border-border bg-background text-[12px] focus:outline-none focus:ring-1 focus:ring-primary" />
                        <Activity size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    </div>
                    <span className="text-[11px] text-muted-foreground">{filtered.length} entries</span>
                </div>

                {/* Filter row */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    {/* Direction */}
                    <div className="flex bg-muted rounded-lg p-0.5 border border-border">
                        {([["all","ALL"],["BUY","BULLISH"],["SELL","BEARISH"]] as const).map(([val, label]) => (
                            <button key={val} onClick={() => { setFilterDirection(val); setPage(1); }}
                                className={cn("px-2.5 py-1 text-[11px] font-bold rounded-md transition-all",
                                    filterDirection === val ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                                {label}
                            </button>
                        ))}
                    </div>

                    {/* Kind */}
                    <div className="flex bg-muted rounded-lg p-0.5 border border-border">
                        {([["all","ALL KIND"],["TRIPLE_ALIGN","🔥 ALIGNED"],["PULLBACK","🎯 PULLBACK"]] as const).map(([val, label]) => (
                            <button key={val} onClick={() => { setFilterKind(val); setPage(1); }}
                                className={cn("px-2.5 py-1 text-[11px] font-bold rounded-md transition-all",
                                    filterKind === val ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                                {label}
                            </button>
                        ))}
                    </div>

                    {/* Sort */}
                    <div className="flex items-center gap-1.5 ml-0 sm:ml-auto">
                        <span className="text-[11px] text-muted-foreground font-semibold hidden sm:inline">Sort:</span>
                        <div className="flex bg-muted rounded-lg p-0.5 border border-border">
                            {([["time","Time"],["score","Score"],["volume","Vol"],["change24h","24h%"]] as const).map(([val, label]) => (
                                <button key={val} onClick={() => setSortBy(val)}
                                    className={cn("px-2.5 py-1 text-[11px] font-bold rounded-md transition-all",
                                        sortBy === val ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="gecko-card rounded-xl overflow-hidden border border-border">
                {filtered.length === 0 ? (
                    <div className="p-8 sm:p-12 text-center">
                        <Activity size={40} className="mx-auto mb-4 text-muted-foreground/30" />
                        <p className="text-sm font-bold text-muted-foreground">No signals yet</p>
                        <p className="text-[11px] text-muted-foreground/60 mt-1">Scanner runs every 30s · EMA 7/25/99 · Score ≥ 60</p>
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
                                    <TableHead className="hidden md:table-cell text-right text-[10px] font-black uppercase">
                                        <ColTip title="1H %" tip="Change vs ~1h ago" right />
                                    </TableHead>
                                    <TableHead className="hidden sm:table-cell text-right text-[10px] font-black uppercase">24H %</TableHead>
                                    <TableHead className="hidden lg:table-cell text-right text-[10px] font-black uppercase">Volume</TableHead>
                                    <TableHead className="hidden lg:table-cell text-right text-[10px] font-black uppercase">
                                        <ColTip title="Vol." tip="Volatility 0–10" right />
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pageItems.map((entry, i) => (
                                    <SignalRow
                                        key={entry.entryId}
                                        entry={entry}
                                        index={pageStart + i}
                                        isNew={newIds.has(entry.entryId)}
                                    />
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {totalPages > 1 && (
                    <div className="flex flex-wrap items-center justify-between px-4 py-3 border-t border-border gap-2">
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
