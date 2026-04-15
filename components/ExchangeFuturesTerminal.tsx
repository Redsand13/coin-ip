"use client";

import * as React from "react";
import { useState, useEffect, useMemo, memo } from "react";
import {
    TrendingUp,
    TrendingDown,
    RefreshCw,
    Activity,
    Calculator,
    Trophy,
    HelpCircle,
    Lock,
    Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { pushAlerts, AlertsButton } from "@/components/SignalAlerts";
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
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EFSignalEntry {
    /** Unique entry ID — never changes after first detection */
    entryId: string;
    coinId: string;
    symbol: string;
    name: string;
    image: string;
    signalType: "BUY" | "SELL";
    signalName: string;
    timeframe: string;
    score: number;
    /** Price at the exact moment the signal was first detected — NEVER updated */
    entryPrice: number;
    /** Exact ISO timestamp when this entry was first created */
    detectedAt: number;
    crossoverTimestamp: number;
    candlesAgo: number;
    stopLoss: number;
    takeProfit: number;
    volatility: number;
    volatilityTooltip?: string;
    formula: string;
    ema7: number;
    ema25?: number;
    ema99: number;
    crossoverStrength: number;
    change1h: number;
    change24h: number;
    volume24h: number;
    marketCap: number;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

// Default storage key — overridden per page via prop
// v7: crossoverTimestamp now uses candle CLOSE time (confirmed crossover moment)
const DEFAULT_STORAGE_KEY = "coinpree_ef_signals_v7";
const MAX_STORED = 2000; // Keep last 2000 entries to avoid localStorage blowup

function loadStoredEntries(key: string): EFSignalEntry[] {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        return JSON.parse(raw) as EFSignalEntry[];
    } catch {
        return [];
    }
}

function saveEntries(entries: EFSignalEntry[], key: string) {
    try {
        // Always keep only the newest MAX_STORED records
        const trimmed = entries.slice(0, MAX_STORED);
        localStorage.setItem(key, JSON.stringify(trimmed));
    } catch {
        // Storage quota? Silently ignore.
    }
}

// Candle duration in ms per timeframe — used to compute exact crossover close time
const CANDLE_MS: Record<string, number> = {
    "5m":  5   * 60_000,
    "15m": 15  * 60_000,
    "30m": 30  * 60_000,
    "1h":  60  * 60_000,
    "4h":  4   * 60 * 60_000,
    "1d":  24  * 60 * 60_000,
};

/**
 * Compute the exact OPEN time of the crossover candle — this matches what
 * TradingView and all charts show (a candle is labelled by its open time).
 * floor(now / interval) = start of current OPEN (unfinished) candle.
 * Subtract (candlesAgo + 1) intervals to reach the open of the crossover candle.
 * e.g. 1H at 17:29 UTC, candlesAgo=0 → 16:00:00 UTC  ("04:00 PM")
 *      1H at 17:29 UTC, candlesAgo=1 → 15:00:00 UTC  ("03:00 PM")
 *      5M at 17:29 UTC, candlesAgo=0 → 17:20:00 UTC  ("05:20 PM")
 */
function crossoverCloseTime(timeframe: string, candlesAgo: number): number {
    const candleMs = CANDLE_MS[timeframe] ?? 60 * 60_000;
    const now = Date.now();
    return Math.floor(now / candleMs) * candleMs - (candlesAgo + 1) * candleMs;
}

/**
 * Build a stable "event ID" that uniquely identifies a specific signal occurrence.
 * We use coinId + signalType + crossoverTimestamp (floor to minute) so that the
 * same alignment detected multiple times in the same minute doesn't create
 * duplicate rows, but a NEW alignment for the same coin DOES create a new row.
 */
function buildEventId(
    coinId: string,
    signalType: string,
    timeframe: string,
    crossoverTimestamp: number,
): string {
    const minuteFloor = Math.floor(crossoverTimestamp / 60_000) * 60_000;
    return `${coinId}::${signalType}::${timeframe}::${minuteFloor}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const FormatPercent = ({ val }: { val: number }) => {
    const v = val || 0;
    const isUp = v >= 0;
    return (
        <span
            className={cn(
                "inline-flex items-center font-bold text-[13px] tabular-nums",
                isUp ? "text-[#0ecb81]" : "text-[#f6465d]",
            )}
        >
            {isUp ? "▲" : "▼"} {Math.abs(v).toFixed(2)}%
        </span>
    );
};

const HeaderTip = ({
    title,
    tip,
    right,
}: {
    title: string;
    tip: string;
    right?: boolean;
}) => (
    <div className={cn("flex items-center gap-1.5", right && "justify-end")}>
        <span>{title}</span>
        <Tooltip>
            <TooltipTrigger asChild>
                <HelpCircle
                    size={12}
                    className="text-muted-foreground/50 hover:text-primary cursor-help"
                />
            </TooltipTrigger>
            <TooltipContent
                side="top"
                className="max-w-[200px] text-xs font-medium z-50 p-3 bg-popover text-popover-foreground shadow-xl border-border"
            >
                {tip}
            </TooltipContent>
        </Tooltip>
    </div>
);

// ─── Signal Row ───────────────────────────────────────────────────────────────

const EFSignalRow = memo(
    ({ entry, index, isNew, mounted }: { entry: EFSignalEntry; index: number; isNew: boolean; mounted: boolean }) => {
        const isBuy = entry.signalType === "BUY";

        // crossoverTimestamp = exact candle where the EMA alignment was confirmed
        const signalTime = mounted
            ? new Date(entry.crossoverTimestamp).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            })
            : "—";

        const formattedPrice =
            entry.entryPrice < 1
                ? entry.entryPrice.toFixed(6)
                : entry.entryPrice.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

        return (
            <TableRow
                className={cn(
                    "gecko-table-row group transition-colors",
                    isNew && "animate-pulse bg-primary/5",
                )}
            >
                {/* # */}
                <TableCell className="w-10 text-center text-muted-foreground text-[11px] font-bold">
                    {index + 1}
                </TableCell>

                {/* Coin */}
                <TableCell className="min-w-[240px] py-3">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0 flex items-center justify-center overflow-hidden border border-border group-hover:border-primary/50 transition-colors">
                            {entry.image ? (
                                <img
                                    src={entry.image}
                                    alt={entry.symbol}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />
                            ) : (
                                <span className="text-[10px] font-bold text-muted-foreground">
                                    {entry.symbol.slice(0, 2)}
                                </span>
                            )}
                        </div>
                        <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-[14px] text-foreground group-hover:text-primary transition-colors">
                                    {entry.symbol}
                                </span>
                                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-bold border-border/50">
                                    #{index + 1}
                                </Badge>
                            </div>
                            <span className="text-[11px] text-muted-foreground font-medium">
                                {entry.name}
                            </span>
                        </div>
                    </div>
                </TableCell>

                {/* Signal */}
                <TableCell>
                    <div className="flex flex-col gap-1.5 items-start">
                        <Badge
                            className={cn(
                                "font-bold text-[10px] px-2 py-0.5 uppercase tracking-wide w-fit border-0 shadow-sm",
                                isBuy
                                    ? "bg-[#0ecb81]/15 text-[#0ecb81]"
                                    : "bg-[#f6465d]/15 text-[#f6465d]",
                            )}
                        >
                            {isBuy ? "BUY" : "SELL"}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded" suppressHydrationWarning>
                            {signalTime}
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-wide text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded">
                            {entry.timeframe}
                        </span>
                    </div>
                </TableCell>

                {/* Score */}
                <TableCell>
                    <div className="flex items-center gap-1.5">
                        <div
                            className={cn(
                                "w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg border-2",
                                entry.score >= 70
                                    ? "bg-[#0ecb81]/5 text-[#0ecb81] border-[#0ecb81]/20"
                                    : entry.score >= 50
                                        ? "bg-orange-500/5 text-orange-500 border-orange-500/20"
                                        : "bg-[#f6465d]/5 text-[#f6465d] border-[#f6465d]/20",
                            )}
                        >
                            {entry.score}
                        </div>
                        <div className="flex flex-col text-[10px]">
                            <span className="text-muted-foreground font-medium">SIGNAL</span>
                            <span className="text-muted-foreground font-medium">SCORE</span>
                        </div>
                    </div>
                </TableCell>

                {/* Entry Price (LOCKED) */}
                <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-1">
                        <span className="text-[14px] font-bold text-foreground tabular-nums" suppressHydrationWarning>
                            ${formattedPrice}
                        </span>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-widest text-zinc-500 cursor-help select-none">
                                    <Lock size={8} strokeWidth={2.5} />
                                    LOCKED
                                </span>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="bg-popover text-popover-foreground border-border p-3 shadow-xl z-50 max-w-[200px]">
                                <p className="text-[11px] font-bold text-zinc-300 mb-1.5 flex items-center gap-1">
                                    <Lock size={10} /> Price Locked at Crossover
                                </p>
                                <p className="text-[10px] text-muted-foreground">Crossover candle:</p>
                                <p className="text-[11px] font-mono text-foreground" suppressHydrationWarning>
                                    {mounted ? new Date(entry.crossoverTimestamp).toLocaleString([], {
                                        month: "short",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                        second: "2-digit",
                                    }) : "—"}
                                </p>
                                <p className="text-[10px] text-muted-foreground mt-1.5">Scanner detected:</p>
                                <p className="text-[11px] font-mono text-foreground/70" suppressHydrationWarning>
                                    {mounted ? new Date(entry.detectedAt).toLocaleString([], {
                                        month: "short",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                    }) : "—"}
                                </p>
                                <p className="text-[10px] text-muted-foreground/60 mt-1.5">
                                    Entry price = candle close at crossover.
                                </p>
                            </TooltipContent>
                        </Tooltip>
                    </div>
                </TableCell>

                {/* 1h Change */}
                <TableCell className="text-right">
                    <FormatPercent val={entry.change1h} />
                </TableCell>

                {/* 24h Change */}
                <TableCell className="text-right">
                    <FormatPercent val={entry.change24h} />
                </TableCell>

                {/* Volume */}
                <TableCell className="text-right">
                    <span className="text-[13px] font-bold text-foreground tabular-nums">
                        ${entry.volume24h ? (entry.volume24h / 1e6).toFixed(2) : "0.00"}M
                    </span>
                </TableCell>

                {/* Volatility */}
                <TableCell className="text-right">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div
                                className={cn(
                                    "inline-flex items-center justify-center w-10 h-8 rounded-md font-bold text-sm cursor-help select-none transition-colors border",
                                    entry.volatility >= 8
                                        ? "bg-red-500/10 text-red-500 border-red-500/20"
                                        : entry.volatility >= 6
                                            ? "bg-orange-500/10 text-orange-500 border-orange-500/20"
                                            : entry.volatility >= 4
                                                ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                                                : "bg-green-500/10 text-green-500 border-green-500/20",
                                )}
                            >
                                {entry.volatility.toFixed(1)}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent className="bg-popover text-popover-foreground border-border p-3 shadow-xl max-w-[250px] z-50">
                            <div className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-left">
                                {entry.volatilityTooltip || "No volatility data"}
                            </div>
                        </TooltipContent>
                    </Tooltip>
                </TableCell>

            </TableRow>
        );
    },
);
EFSignalRow.displayName = "EFSignalRow";

// ─── Stats Header ─────────────────────────────────────────────────────────────

const StatsHeader = memo(({ entries }: { entries: EFSignalEntry[] }) => {
    const buy = entries.filter(e => e.signalType === "BUY").length;
    const sell = entries.filter(e => e.signalType === "SELL").length;
    const avg = entries.length > 0
        ? Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length)
        : 0;

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
                <p className="text-[11px] font-bold text-muted-foreground uppercase">Avg Signal Score</p>
            </div>

            <div className="gecko-card p-4 border-l-4 border-l-orange-500 bg-orange-500/5">
                <div className="flex items-center justify-between mb-2">
                    <Trophy className="text-orange-500" size={20} />
                    <Badge className="bg-orange-500/20 text-orange-500 text-[10px] font-bold">TOTAL</Badge>
                </div>
                <p className="text-3xl font-black text-orange-500">{entries.length}</p>
                <p className="text-[11px] font-bold text-muted-foreground uppercase">All Signals Stored</p>
            </div>
        </div>
    );
});
StatsHeader.displayName = "StatsHeader";

// ─── Main Terminal ────────────────────────────────────────────────────────────

interface ExchangeFuturesTerminalProps {
    title?: string;
    description?: string;
    storageKey?: string;
    /** Source name passed to the CSV export API (e.g. "binance", "coingecko") */
    exportSource?: string;
    /** Auto-scan interval in ms (default 30 000 = 30 s) */
    scanInterval?: number;
    initialData?: Array<{
        coinId: string;
        symbol: string;
        name: string;
        image: string;
        signalType: "BUY" | "SELL";
        signalName: string;
        timeframe: string;
        score: number;
        price: number;
        currentPrice: number;
        change1h: number;
        change24h: number;
        change7d: number;
        volume24h: number;
        marketCap: number;
        timestamp: number;
        crossoverTimestamp: number;
        candlesAgo: number;
        entryPrice: number;
        stopLoss: number;
        takeProfit: number;
        volatility: number;
        volatilityTooltip?: string;
        formula: string;
        ema7: number;
        ema25?: number;
        ema99: number;
        ema7Prev: number;
        ema99Prev: number;
        crossoverStrength: number;
    }>;
    fetchAction?: (timeframe?: string) => Promise<ExchangeFuturesTerminalProps["initialData"]>;
}

export default function ExchangeFuturesTerminal({
    title = "EXCHANGE FUTURES MARKET",
    description = "CoinGecko · Triple EMA Strategy 7 › 25 › 99",
    storageKey = DEFAULT_STORAGE_KEY,
    exportSource,
    scanInterval = 30_000,
    initialData = [],
    fetchAction,
}: ExchangeFuturesTerminalProps) {
    const [entries, setEntries] = useState<EFSignalEntry[]>([]);
    const [newIds, setNewIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [timeframe, setTimeframe] = useState("1h");
    const [search, setSearch] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [mounted, setMounted] = useState(false);
    const ITEMS_PER_PAGE = 50;

    // Export dialog state
    const [exportOpen, setExportOpen] = useState(false);
    const [exportTf, setExportTf] = useState("all");
    const [exportSignalType, setExportSignalType] = useState("all");
    const [exportMinScore, setExportMinScore] = useState(70);

    // ── Load persisted entries on mount ────────────────────────────────────────
    useEffect(() => {
        setMounted(true);
        const stored = loadStoredEntries(storageKey);
        if (stored.length > 0) {
            setEntries(stored);
            setLoading(false); // has cached data — show immediately, no skeleton needed
        } else if (initialData.length > 0) {
            // Seed from server-side prefetch
            const seeded = convertAndMerge(initialData, [], timeframe);
            setEntries(seeded.entries);
            setTimeout(() => saveEntries(seeded.entries, storageKey), 0);
            setLoading(false);
        }
        // If both empty: keep loading=true → skeleton shows until first fetch completes
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Reset pagination on filter change
    useEffect(() => { setCurrentPage(1); }, [search, timeframe]);

    function convertAndMerge(
        rawSignals: NonNullable<ExchangeFuturesTerminalProps["initialData"]>,
        prevEntries: EFSignalEntry[],
        _tf: string,
    ): { entries: EFSignalEntry[]; newCount: number; newEntryIds: string[] } {
        const existingIds = new Set(prevEntries.map(e => e.entryId));
        const freshEntries: EFSignalEntry[] = [];
        const freshIds: string[] = [];

        for (const sig of rawSignals) {
            const exactCrossoverTs = crossoverCloseTime(sig.timeframe, sig.candlesAgo ?? 0);
            const eventId = buildEventId(sig.coinId, sig.signalType, sig.timeframe, exactCrossoverTs);
            if (existingIds.has(eventId)) continue; // Already stored — skip

            const entry: EFSignalEntry = {
                entryId: eventId,
                coinId: sig.coinId,
                symbol: sig.symbol,
                name: sig.name,
                image: sig.image,
                signalType: sig.signalType,
                signalName: sig.signalName,
                timeframe: sig.timeframe,
                score: sig.score,
                entryPrice: sig.price,
                detectedAt: Date.now(),
                crossoverTimestamp: exactCrossoverTs,
                candlesAgo: sig.candlesAgo,
                stopLoss: sig.stopLoss,
                takeProfit: sig.takeProfit,
                volatility: sig.volatility,
                volatilityTooltip: sig.volatilityTooltip,
                formula: sig.formula,
                ema7: sig.ema7,
                ema25: sig.ema25,
                ema99: sig.ema99,
                crossoverStrength: sig.crossoverStrength,
                change1h: sig.change1h,
                change24h: sig.change24h,
                volume24h: sig.volume24h,
                marketCap: sig.marketCap,
            };

            freshEntries.push(entry);
            freshIds.push(eventId);
        }

        // Merge new + old, sort by crossoverTimestamp descending (newest crossover first — stable)
        const merged = [...freshEntries, ...prevEntries]
            .sort((a, b) => b.crossoverTimestamp - a.crossoverTimestamp)
            .slice(0, MAX_STORED);

        return { entries: merged, newCount: freshEntries.length, newEntryIds: freshIds };
    }

    // Tracks known entry IDs to detect truly new signals across refreshes
    const knownIdsRef = React.useRef<Set<string>>(new Set());
    // True after first successful fetch — don't alert on initial load
    const hasLoadedOnceRef = React.useRef(false);

    // ── Fetch & merge function ─────────────────────────────────────────────────
    const fetchAndMerge = async (isFirstLoad = false, tfOverride?: string) => {
        if (!fetchAction) return;
        try {
            if (isFirstLoad) setLoading(true); else setRefreshing(true);

            const activeTf = tfOverride !== undefined ? tfOverride : timeframe;

            // Fetch requested timeframe (action handles "all" by scanning everything)
            const rawData = await fetchAction(activeTf);
            if (!rawData || !Array.isArray(rawData)) return;

            // Build fresh entries outside the state updater (updaters must be pure)
            const freshEntries: EFSignalEntry[] = [];
            const trulyNewEntries: EFSignalEntry[] = []; // new since last fetch
            const freshIds: string[] = [];

            for (const sig of rawData) {
                const tf = sig.timeframe ?? activeTf;
                const exactCrossoverTs = crossoverCloseTime(tf, sig.candlesAgo ?? 0);
                const eventId = buildEventId(sig.coinId, sig.signalType, tf, exactCrossoverTs);
                const entry: EFSignalEntry = {
                    entryId: eventId,
                    coinId: sig.coinId,
                    symbol: sig.symbol,
                    name: sig.name,
                    image: sig.image,
                    signalType: sig.signalType,
                    signalName: sig.signalName,
                    timeframe: tf,
                    score: sig.score,
                    entryPrice: sig.price,
                    detectedAt: Date.now(),
                    crossoverTimestamp: exactCrossoverTs,
                    candlesAgo: sig.candlesAgo,
                    stopLoss: sig.stopLoss,
                    takeProfit: sig.takeProfit,
                    volatility: sig.volatility,
                    volatilityTooltip: sig.volatilityTooltip,
                    formula: sig.formula,
                    ema7: sig.ema7,
                    ema25: sig.ema25,
                    ema99: sig.ema99,
                    crossoverStrength: sig.crossoverStrength,
                    change1h: sig.change1h,
                    change24h: sig.change24h,
                    volume24h: sig.volume24h,
                    marketCap: sig.marketCap,
                };
                freshEntries.push(entry);
                if (!knownIdsRef.current.has(eventId)) {
                    freshIds.push(eventId);
                    trulyNewEntries.push(entry);
                }
            }

            // Update known IDs set
            freshEntries.forEach(e => knownIdsRef.current.add(e.entryId));

            if (freshIds.length > 0) {
                console.log(`🆕 [EF] ${freshIds.length} new signal entries added`);
                const highlight = new Set(freshIds);
                setNewIds(highlight);
                setTimeout(() => setNewIds(new Set()), 8000);

                // Push alert notifications — only after first load (skip initial seed)
                if (hasLoadedOnceRef.current) {
                    pushAlerts("Binance Futures", trulyNewEntries.map(e => ({
                        symbol: e.symbol,
                        name: e.name,
                        image: e.image,
                        signalType: e.signalType,
                        timeframe: e.timeframe,
                        score: e.score,
                    })));
                }
            }

            hasLoadedOnceRef.current = true;

            setEntries(prev => {
                const otherTfEntries = prev.filter(e => e.timeframe !== activeTf);
                const merged = [...freshEntries, ...otherTfEntries]
                    .sort((a, b) => b.crossoverTimestamp - a.crossoverTimestamp)
                    .slice(0, MAX_STORED);
                setTimeout(() => saveEntries(merged, storageKey), 0);
                return merged;
            });
        } catch (err) {
            console.warn("[EF] Fetch error:", err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    // ── Auto-refresh (selected timeframe) ─────────────────────────────────────
    useEffect(() => {
        fetchAndMerge(false);
        const interval = setInterval(() => fetchAndMerge(false), scanInterval);
        return () => clearInterval(interval);
    }, [storageKey, timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

    // All-timeframes DB persistence is handled server-side by instrumentation.ts (every 3 min).
    // No client-side bg scan needed — avoids duplicate Binance API calls.

    // ── Filtered + paginated view ──────────────────────────────────────────────
    const filtered = useMemo(() => {
        // 1. Filter by timeframe
        let result = entries.filter(e => e.timeframe === timeframe);

        if (!search.trim()) return result;

        // Split search string by commas or spaces into an array of search terms
        const terms = search.toLowerCase()
            .split(/[\s,]+/)
            .filter(t => t.length > 0);

        return result.filter(e => {
            const sym = e.symbol.toLowerCase();
            const name = e.name.toLowerCase();
            const type = e.signalType.toLowerCase();

            // Check if ANY of the search terms match this entry (OR logic)
            // Example: searching "btc eth" will show both BTC and ETH entries
            return terms.some(term =>
                sym.includes(term) ||
                name.includes(term) ||
                type === term // allow searching for "buy" or "sell"
            );
        });
    }, [entries, search, timeframe]);

    const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
    const pageStart = (currentPage - 1) * ITEMS_PER_PAGE;
    const pageItems = filtered.slice(pageStart, pageStart + ITEMS_PER_PAGE);

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <TooltipProvider delayDuration={0}>
        <div className="space-y-6">
            {/* ── Title Bar ── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-lg md:text-3xl font-black text-foreground tracking-tighter uppercase leading-tight">
                        {title}
                    </h1>
                    <p className="text-[10px] md:text-[12px] font-bold text-muted-foreground uppercase opacity-80">
                        {description}
                    </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {/* Timeframe selector */}
                    <div className="flex bg-muted rounded-lg p-1 border border-border">
                        {["5m", "15m", "30m", "1h", "4h", "1d"].map(tf => (
                            <button
                                key={tf}
                                onClick={() => {
                                    setTimeframe(tf);
                                    setCurrentPage(1);
                                    // useEffect [storageKey, timeframe] handles the fetch after state update
                                }}
                                className={cn(
                                    "px-3 py-1 text-[11px] font-bold rounded-md transition-all whitespace-nowrap",
                                    timeframe === tf
                                        ? "bg-background text-primary shadow-sm"
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {tf.toUpperCase()}
                            </button>
                        ))}
                    </div>

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
                                <span className="text-[11px] text-muted-foreground font-medium hidden sm:inline">Live · {scanInterval >= 60_000 ? `${scanInterval / 60_000}m` : `${scanInterval / 1_000}s`}</span>
                            </>
                        )}
                    </div>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchAndMerge(false)}
                        disabled={refreshing}
                        className="h-8 gap-2"
                    >
                        <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
                    </Button>

                    <AlertsButton page="Binance Futures" />

                    {/* Export Dialog */}
                    <Dialog open={exportOpen} onOpenChange={setExportOpen}>
                        <DialogTrigger asChild>
                            <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">
                                <Download size={12} strokeWidth={2.5} />
                                Export
                            </button>
                        </DialogTrigger>
                        <DialogContent className="max-w-sm">
                            <DialogHeader>
                                <DialogTitle className="text-sm font-bold flex items-center gap-2">
                                    <Download size={14} /> Export Signals as CSV
                                </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 pt-2">
                                {/* Timeframe filter */}
                                <div>
                                    <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide mb-1.5">Timeframe</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {["all", "5m", "15m", "30m", "1h", "4h", "1d"].map(tf => (
                                            <button
                                                key={tf}
                                                onClick={() => setExportTf(tf)}
                                                className={cn(
                                                    "px-2.5 py-1 rounded text-[11px] font-bold border transition-all",
                                                    exportTf === tf
                                                        ? "bg-primary text-primary-foreground border-primary"
                                                        : "border-border text-muted-foreground hover:text-foreground"
                                                )}
                                            >
                                                {tf.toUpperCase()}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Signal type filter */}
                                <div>
                                    <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide mb-1.5">Signal Type</p>
                                    <div className="flex gap-1.5">
                                        {["all", "BUY", "SELL"].map(t => (
                                            <button
                                                key={t}
                                                onClick={() => setExportSignalType(t)}
                                                className={cn(
                                                    "px-2.5 py-1 rounded text-[11px] font-bold border transition-all",
                                                    exportSignalType === t
                                                        ? "bg-primary text-primary-foreground border-primary"
                                                        : "border-border text-muted-foreground hover:text-foreground"
                                                )}
                                            >
                                                {t}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Min score filter */}
                                <div>
                                    <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide mb-1.5">
                                        Min Score: <span className="text-foreground">{exportMinScore}</span>
                                    </p>
                                    <input
                                        type="range"
                                        min={70}
                                        max={100}
                                        step={1}
                                        value={exportMinScore}
                                        onChange={e => setExportMinScore(Number(e.target.value))}
                                        className="w-full accent-primary"
                                    />
                                    <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                                        <span>70</span><span>85</span><span>100</span>
                                    </div>
                                </div>

                                {/* Preview count */}
                                <p className="text-[11px] text-muted-foreground">
                                    Matching entries:{" "}
                                    <span className="text-foreground font-bold">
                                        {entries.filter(e =>
                                            (exportTf === "all" || e.timeframe === exportTf) &&
                                            (exportSignalType === "all" || e.signalType === exportSignalType) &&
                                            e.score >= exportMinScore
                                        ).length}
                                    </span>
                                </p>

                                {/* Download button */}
                                <a
                                    href={`/api/export?${new URLSearchParams({
                                        ...(exportSource ? { source: exportSource } : {}),
                                        ...(exportTf !== "all" ? { timeframe: exportTf } : {}),
                                        ...(exportSignalType !== "all" ? { signalType: exportSignalType } : {}),
                                        minScore: String(exportMinScore),
                                    }).toString()}`}
                                    download
                                    onClick={() => setExportOpen(false)}
                                    className="flex items-center justify-center gap-2 w-full h-9 rounded-lg text-[12px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                                >
                                    <Download size={13} strokeWidth={2.5} />
                                    Download CSV
                                </a>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* ── Stats ── */}
            <StatsHeader entries={filtered} />


            {/* ── Search ── */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                    <input
                        type="text"
                        placeholder="Search multiple coins (e.g. BTC, ETH) or signal type..."
                        value={search}
                        onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                        className="w-full h-9 pl-9 pr-4 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <Activity size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                </div>
                <span className="text-[11px] text-muted-foreground font-medium">
                    {filtered.length} entries
                </span>
            </div>

            {/* ── Table ── */}
            <div className="gecko-card rounded-xl overflow-hidden border border-border">
                {loading ? (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="gecko-table-header">
                                    <TableHead className="w-10" />
                                    <TableHead>Coin</TableHead>
                                    <TableHead>Signal</TableHead>
                                    <TableHead>Score</TableHead>
                                    <TableHead className="text-right">Entry Price</TableHead>
                                    <TableHead className="text-right">1h %</TableHead>
                                    <TableHead className="text-right">24h %</TableHead>
                                    <TableHead className="text-right">Volume</TableHead>
                                    <TableHead className="text-right">Vol.</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {Array.from({ length: 10 }).map((_, i) => (
                                    <TableRow key={i} className="border-b border-border/50">
                                        {/* # */}
                                        <TableCell><Skeleton className="h-4 w-5 mx-auto" /></TableCell>
                                        {/* Coin */}
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                                                <div className="space-y-1.5">
                                                    <Skeleton className="h-3 w-20" />
                                                    <Skeleton className="h-2.5 w-12" />
                                                </div>
                                            </div>
                                        </TableCell>
                                        {/* Signal */}
                                        <TableCell>
                                            <div className="space-y-1.5">
                                                <Skeleton className="h-5 w-14 rounded-full" />
                                                <Skeleton className="h-3 w-24" />
                                                <Skeleton className="h-4 w-8 rounded-full" />
                                            </div>
                                        </TableCell>
                                        {/* Score */}
                                        <TableCell><Skeleton className="h-8 w-14 rounded-lg" /></TableCell>
                                        {/* Entry Price */}
                                        <TableCell className="text-right">
                                            <div className="flex flex-col items-end gap-1">
                                                <Skeleton className="h-3 w-20" />
                                                <Skeleton className="h-2.5 w-14" />
                                            </div>
                                        </TableCell>
                                        {/* 1h % */}
                                        <TableCell className="text-right"><Skeleton className="h-3 w-12 ml-auto" /></TableCell>
                                        {/* 24h % */}
                                        <TableCell className="text-right"><Skeleton className="h-3 w-12 ml-auto" /></TableCell>
                                        {/* Volume */}
                                        <TableCell className="text-right"><Skeleton className="h-3 w-16 ml-auto" /></TableCell>
                                        {/* Vol score */}
                                        <TableCell className="text-right"><Skeleton className="h-6 w-10 rounded-full ml-auto" /></TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="p-12 text-center">
                        <Activity size={40} className="mx-auto mb-4 text-muted-foreground/30" />
                        <p className="text-sm font-bold text-muted-foreground">No signals detected yet</p>
                        <p className="text-[11px] text-muted-foreground/60 mt-1">
                            Scanner runs every 60 seconds • Signals appear when 7/25/99 EMA alignment occurs
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
                                        <HeaderTip
                                            title="Signal"
                                            tip="EMA alignment: 7>25>99 (Bull) or 99>25>7 (Bear). Each detected alignment is a new entry — never overwritten."
                                        />
                                    </TableHead>
                                    <TableHead className="text-[10px] font-black uppercase">
                                        <HeaderTip title="Score" tip="Signal quality score 0–100." />
                                    </TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">
                                        <HeaderTip title="Entry Price" tip="Price locked at signal detection. Never changes even when a new signal arrives for the same coin." right />
                                    </TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">
                                        <HeaderTip title="1h %" tip="Price change vs ~1h ago. For 4h/1d timeframes: change vs previous candle close." right />
                                    </TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">24h %</TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">Volume</TableHead>
                                    <TableHead className="text-right text-[10px] font-black uppercase">
                                        <HeaderTip title="Vol." tip="Volatility score 0–10. Higher = more volatile." right />
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pageItems.map((entry, i) => (
                                    <EFSignalRow
                                        key={entry.entryId}
                                        entry={entry}
                                        index={pageStart + i}
                                        isNew={newIds.has(entry.entryId)}
                                        mounted={mounted}
                                    />
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                        <span className="text-[11px] text-muted-foreground font-medium">
                            Page {currentPage} of {totalPages} ({filtered.length} entries)
                        </span>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage(p => p - 1)}
                            >
                                ← Prev
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={currentPage === totalPages}
                                onClick={() => setCurrentPage(p => p + 1)}
                            >
                                Next →
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
        </TooltipProvider>
    );
}
