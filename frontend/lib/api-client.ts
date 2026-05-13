/**
 * Typed client for the Coinpree FastAPI backend.
 * All calls are server-side (Next.js server actions / API routes).
 */

import type {
  ApiSignal,
  ApiSignalPage,
  DbSignal,
} from "@/lib/types/signals";

const API_BASE =
  process.env.BACKEND_URL ?? "http://localhost:8000";

const API_KEY = process.env.BACKEND_API_KEY ?? "";

// ── Shared fetch wrapper ───────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit & { params?: Record<string, string | number | boolean | undefined> } = {}
): Promise<T> {
  const { params, ...init } = options;

  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
      ...(init.headers ?? {}),
    },
    next: { revalidate: 0 },   // always fresh — signals change every 30s
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`FastAPI ${res.status} ${res.statusText}: ${path} — ${body}`);
  }

  return res.json() as Promise<T>;
}

// ── Signal endpoints ───────────────────────────────────────────────────────────

export interface SignalQueryParams {
  source?: "binance" | "coingecko" | "ict";
  direction?: "LONG" | "SHORT";
  timeframe?: string;
  symbol?: string;
  min_ml_score?: number;
  min_confluence?: number;
  limit?: number;
  offset?: number;
}

export async function fetchSignals(
  params: SignalQueryParams = {}
): Promise<ApiSignalPage> {
  return apiFetch<ApiSignalPage>("/api/v1/signals", {
    params: params as Record<string, string | number | boolean | undefined>,
  });
}

export async function fetchTopSignals(limit = 50): Promise<ApiSignal[]> {
  return apiFetch<ApiSignal[]>("/api/v1/signals/top", {
    params: { limit },
  });
}

export async function fetchSignalById(id: string): Promise<ApiSignal> {
  return apiFetch<ApiSignal>(`/api/v1/signals/${id}`);
}

export async function recordOutcome(
  id: string,
  outcome_pnl: number,
  outcome_hit_tp?: boolean,
  outcome_hit_sl?: boolean
): Promise<void> {
  await apiFetch(`/api/v1/signals/${id}/outcome`, {
    method: "PATCH",
    params: {
      outcome_pnl,
      ...(outcome_hit_tp !== undefined ? { outcome_hit_tp } : {}),
      ...(outcome_hit_sl !== undefined ? { outcome_hit_sl } : {}),
    },
  });
}

// ── History / DB-backed queries ───────────────────────────────────────────────

export interface HistoryQueryParams {
  source?: string;
  timeframe?: string;
  minScore?: number;
  fromTs?: number;   // epoch ms
  toTs?: number;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchHistory(
  opts: HistoryQueryParams = {}
): Promise<{ signals: DbSignal[]; total: number }> {
  const pageSize = opts.pageSize ?? 50;
  const page = opts.page ?? 1;
  const offset = (page - 1) * pageSize;

  const params: Record<string, string | number | boolean | undefined> = {
    limit: pageSize,
    offset,
  };
  if (opts.source && opts.source !== "all") params.source = opts.source;
  if (opts.timeframe && opts.timeframe !== "all") params.timeframe = opts.timeframe;
  if (opts.minScore !== undefined) params.min_ml_score = opts.minScore / 100;
  if (opts.search) params.symbol = opts.search;

  const data = await apiFetch<ApiSignalPage>("/api/v1/signals", { params });

  // Map ApiSignal → DbSignal for the History terminal
  const signals: DbSignal[] = data.items.map((s) => {
    const coinId = s.symbol.replace(/USDT$|BUSD$|BTC$/, "");
    return {
      id:           s.id,
      symbol:       s.symbol,
      name:         coinId,
      source:       s.source,
      direction:    s.direction,
      signal_type:  s.direction,  // backward-compat alias
      timeframe:    s.timeframe,
      signal_time:  s.signal_time,
      price:        s.price,
      entry_price:  s.price,      // backward-compat alias
      volume:       s.volume,
      market_cap:   s.market_cap,
      ema_fast:     s.ema_fast,
      ema_mid:      s.ema_mid,
      ema_slow:     s.ema_slow,
      ict_pattern:  s.ict_pattern,
      confluence_score: s.confluence_score,
      ml_score:     s.ml_score,
      ml_confidence: s.ml_confidence,
      score:               Math.round((s.ml_score ?? s.confluence_score ?? 0) * 100),
      crossover_timestamp: new Date(s.signal_time).getTime(),
      notified:     s.notified,
      created_at:   s.created_at,
    };
  });

  return { signals, total: data.total };
}

export async function fetchDistinctSymbols(source?: string): Promise<string[]> {
  // Fetch recent signals and extract unique symbols as a lightweight approach
  const params: Record<string, string | number | boolean | undefined> = { limit: 500 };
  if (source && source !== "all") params.source = source as "binance" | "coingecko" | "ict";
  const data = await apiFetch<ApiSignalPage>("/api/v1/signals", { params });
  return [...new Set(data.items.map((s) => s.symbol))].sort();
}

// ── Scanner control ───────────────────────────────────────────────────────────

export async function triggerBinanceScan(): Promise<{ status: string }> {
  return apiFetch<{ status: string }>("/api/v1/scanner/trigger/binance", {
    method: "POST",
  });
}

export async function triggerCoinGeckoScan(): Promise<{ status: string }> {
  return apiFetch<{ status: string }>("/api/v1/scanner/trigger/coingecko", {
    method: "POST",
  });
}

export async function fetchScannerStatus(): Promise<{
  running: boolean;
  last_run: string | null;
  last_saved: number;
}> {
  return apiFetch("/api/v1/scanner/status");
}

export async function fetchMlStatus(): Promise<{
  is_trained: boolean;
  trained_at: string | null;
  n_samples: number;
}> {
  return apiFetch("/api/v1/scanner/ml/status");
}

// ── Export / CSV ──────────────────────────────────────────────────────────────

export async function fetchSignalsCsv(
  params: SignalQueryParams = {}
): Promise<string> {
  // Fetch all matching signals and convert to CSV client-side
  const all = await apiFetch<ApiSignalPage>("/api/v1/signals", {
    params: { ...params, limit: 5000 } as Record<string, string | number | boolean | undefined>,
  });

  const headers = [
    "symbol", "source", "direction", "timeframe", "price",
    "ml_score", "confluence_score", "ict_pattern",
    "ema_fast", "ema_mid", "ema_slow",
    "signal_time", "created_at",
  ];

  const rows = all.items.map((s) =>
    headers
      .map((h) => {
        const v = (s as unknown as Record<string, unknown>)[h];
        return v === null || v === undefined ? "" : String(v);
      })
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function fetchHealth(): Promise<{
  status: string;
  db: string;
  redis: string;
}> {
  return apiFetch("/api/v1/health");
}
