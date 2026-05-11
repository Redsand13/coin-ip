/**
 * Binance Futures WebSocket Manager — singleton, Node.js only.
 *
 * !ticker@arr   → live 24hr ticker for ALL futures pairs (has P/p change% fields)
 * <sym>@kline_<tf> → closed candle updates, seeded once from REST then maintained live
 *
 * Rate-limit protection: kline REST seeds are serialised through a semaphore
 * (max 5 concurrent) so we never burst above ~50 weight/s on startup.
 */

const FSTREAM = "wss://fstream.binance.com";
const FAPI    = "https://fapi.binance.com/fapi/v1";

// Binance max klines per request = 1500 (costs 10 weight each).
// EMA99 needs ~5×99 ≈ 500 bars to converge after SMA seed.
// 1499 closed candles → 1400 bars after seed → matches TradingView exactly.
const BUFFER_SIZE        = 1500;
const MAX_STREAMS_PER_WS = 200; // Binance hard limit per connection
// Keep concurrency low: /klines?limit=1500 costs 10 weight each.
// 3 concurrent × 10 weight = 30 weight/batch, leaving headroom under 40/sec limit.
const SEED_CONCURRENCY   = 3;

// ── Types ──────────────────────────────────────────────────────────────────────

// Matches Binance REST kline tuple exactly
export type BinanceKline = [
  number, string, string, string, string, string, // 0-5: openTime,o,h,l,c,vol
  number, string, number, string, string, string, // 6-11: closeTime,qVol,trades,tbBase,tbQuote,_
];

export interface MiniTicker {
  s: string; // symbol
  c: string; // last price
  o: string; // open price (24h)
  h: string; // high
  l: string; // low
  v: string; // base volume
  q: string; // quote volume
  P: string; // price change % (24h) — present in !ticker@arr, absent in !miniTicker@arr
  p: string; // price change (24h)
}

// ── Semaphore ──────────────────────────────────────────────────────────────────

class Semaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  async acquire() {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    await new Promise<void>(r => this.queue.push(r));
    this.running++;
  }

  release() {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ── Manager ────────────────────────────────────────────────────────────────────

class BinanceWSManager {
  private tickers  = new Map<string, MiniTicker>();
  private klines   = new Map<string, BinanceKline[]>();  // "BTCUSDT:1h" → closed candles
  private seeded   = new Set<string>();
  private seeding  = new Set<string>();
  private seedSem  = new Semaphore(SEED_CONCURRENCY);
  // Tracks last candle close timestamp per interval — used to bust the signal cache
  private lastClose = new Map<string, number>();          // "1h" → epoch ms

  private tickerWs: WebSocket | null = null;
  private klineConns: WebSocket[]    = [];

  private pendingStreams: string[]                   = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.connectTicker();
  }

  // ── Ticker WebSocket ────────────────────────────────────────────────────────
  // Uses !ticker@arr (full 24hr ticker) — includes P (price change %)

  private connectTicker() {
    const connect = () => {
      try {
        // Direct stream endpoint: /ws/<streamName> — message IS the data (no wrapper)
        const ws = new WebSocket(`${FSTREAM}/ws/!ticker@arr`);

        ws.onopen  = () => console.log("✅ [WS] Binance !ticker@arr connected");

        ws.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data as string);
            const list: MiniTicker[] = Array.isArray(data) ? data : (data.data ?? []);
            for (const t of list) {
              // !ticker@arr has P/p natively; compute them as fallback just in case
              if (!t.P && t.c && t.o) {
                const chg = ((parseFloat(t.c) - parseFloat(t.o)) / parseFloat(t.o)) * 100;
                t.P = chg.toFixed(2);
                t.p = (parseFloat(t.c) - parseFloat(t.o)).toFixed(8);
              }
              this.tickers.set(t.s, t);
            }
          } catch { /* ignore malformed frame */ }
        };

        ws.onclose = (evt) => {
          console.warn(`⚠️ [WS] ticker closed (code=${evt.code}) — reconnecting in 5s`);
          this.tickerWs = null;
          setTimeout(connect, 5_000);
        };

        ws.onerror = (evt) => {
          console.error("❌ [WS] ticker error:", (evt as ErrorEvent).message ?? evt);
          ws.close();
        };

        this.tickerWs = ws;
      } catch (e) {
        console.error("❌ [WS] ticker connect threw:", e);
        setTimeout(connect, 10_000);
      }
    };
    connect();
  }

  getAllTickers(): MiniTicker[] { return Array.from(this.tickers.values()); }
  getTicker(s: string): MiniTicker | undefined { return this.tickers.get(s); }
  isSeeded(symbol: string, interval: string): boolean { return this.seeded.has(`${symbol}:${interval}`); }
  getLastCandleClose(interval: string): number { return this.lastClose.get(interval) ?? 0; }

  /**
   * Inject already-fetched klines into the WS buffer and subscribe to the live
   * stream — no extra REST call needed. Call this after a REST kline fetch so the
   * WS manager stays up-to-date from the next candle close onward.
   */
  seedFromData(symbol: string, interval: string, klines: BinanceKline[]): void {
    const key = `${symbol}:${interval}`;
    if (this.seeded.has(key) || this.seeding.has(key)) return;
    this.klines.set(key, klines.slice(-BUFFER_SIZE));
    this.seeded.add(key);
    this.scheduleStream(`${symbol.toLowerCase()}@kline_${interval}`);
  }

  // ── Kline WebSocket ─────────────────────────────────────────────────────────

  private scheduleStream(stream: string) {
    this.pendingStreams.push(stream);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flushStreams(), 300);
  }

  private flushStreams() {
    const all = [...this.pendingStreams];
    this.pendingStreams = [];
    for (let i = 0; i < all.length; i += MAX_STREAMS_PER_WS) {
      this.connectKlines(all.slice(i, i + MAX_STREAMS_PER_WS));
    }
  }

  private connectKlines(streams: string[]) {
    // Combined stream endpoint: /stream?streams=s1/s2/...
    const url = `${FSTREAM}/stream?streams=${streams.join("/")}`;

    const connect = () => {
      try {
        const ws = new WebSocket(url);

        ws.onopen = () =>
          console.log(`✅ [WS] kline WebSocket connected (${streams.length} streams)`);

        ws.onmessage = (evt) => {
          try {
            const msg  = JSON.parse(evt.data as string);
            const data = msg.data ?? msg;          // combined stream wraps in {stream,data}
            if (data.e !== "kline") return;

            const k = data.k;
            if (!k.x) return; // only CLOSED candles

            const key = `${k.s}:${k.i}`;
            const buf = this.klines.get(key);
            if (!buf) return;

            buf.push([k.t, k.o, k.h, k.l, k.c, k.v, k.T, k.q, k.n, k.V, k.Q, "0"]);
            if (buf.length > BUFFER_SIZE) buf.shift();
            // Record close time so the signal cache can be busted immediately
            this.lastClose.set(k.i, Date.now());
          } catch { /* ignore */ }
        };

        ws.onclose = (evt) => {
          console.warn(`⚠️ [WS] kline WS closed (code=${evt.code}) — reconnecting in 5s`);
          this.klineConns = this.klineConns.filter(c => c !== ws);
          setTimeout(connect, 5_000);
        };

        ws.onerror = (evt) => {
          console.error("❌ [WS] kline error:", (evt as ErrorEvent).message ?? evt);
          ws.close();
        };

        this.klineConns.push(ws);
      } catch (e) {
        console.error("❌ [WS] kline connect threw:", e);
        setTimeout(connect, 10_000);
      }
    };
    connect();
  }

  // ── Public kline API ────────────────────────────────────────────────────────

  async getKlines(symbol: string, interval: string, limit = 500): Promise<BinanceKline[]> {
    const key = `${symbol}:${interval}`;

    if (this.seeded.has(key)) {
      return (this.klines.get(key) ?? []).slice(-limit);
    }

    // Wait if another coroutine is already seeding this key
    if (this.seeding.has(key)) {
      for (let i = 0; i < 150; i++) {
        await delay(100);
        if (this.seeded.has(key)) return (this.klines.get(key) ?? []).slice(-limit);
      }
      return [];
    }

    // First access — seed from REST (throttled by semaphore)
    this.seeding.add(key);
    await this.seedSem.acquire();
    try {
      const res = await fetch(
        `${FAPI}/klines?symbol=${symbol}&interval=${interval}&limit=${BUFFER_SIZE}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${key}`);

      const raw: BinanceKline[] = await res.json();
      // Strip the last (open/in-progress) candle — buffer holds CLOSED only
      const closed = raw.slice(0, -1);

      this.klines.set(key, closed);
      this.seeded.add(key);
      this.scheduleStream(`${symbol.toLowerCase()}@kline_${interval}`);

      // Small inter-seed pause so concurrent seeds don't spike weight
      await delay(200);
      console.log(`🌱 [WS] Seeded ${closed.length} closed candles for ${key}`);
      return closed.slice(-limit);
    } catch (e) {
      console.warn(`⚠️ [WS] Seed failed for ${key}:`, (e as Error).message);
      return [];
    } finally {
      this.seeding.delete(key);
      this.seedSem.release();
    }
  }

}

function delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// ── Singleton ──────────────────────────────────────────────────────────────────

let _instance: BinanceWSManager | null = null;

export function getBinanceWS(): BinanceWSManager {
  if (!_instance) _instance = new BinanceWSManager();
  return _instance;
}
