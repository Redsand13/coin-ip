/**
 * SQLite signal storage — server-side persistent database.
 *
 * DB location priority:
 *   1. DATABASE_PATH env var (absolute path — best for production servers)
 *   2. <project-root>/data/signals.db (default for local dev)
 *
 * Set DATABASE_PATH to a directory outside your app folder so data survives
 * code deployments, e.g. DATABASE_PATH=/var/data/coinpree/signals.db
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

function resolveDbPath(): string {
  if (process.env.DATABASE_PATH) {
    const p = process.env.DATABASE_PATH;
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return p;
  }
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "signals.db");
}

const DB_PATH = resolveDbPath();

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("foreign_keys = ON");
  initSchema(_db);
  // Graceful shutdown — flush WAL on process exit
  process.once("exit",    () => { try { _db?.close(); } catch { /* ignore */ } });
  process.once("SIGINT",  () => { try { _db?.close(); } catch { /* ignore */ } process.exit(0); });
  process.once("SIGTERM", () => { try { _db?.close(); } catch { /* ignore */ } process.exit(0); });
  return _db;
}

function tableColumns(db: Database.Database, table: string): Set<string> {
  const rows = db.pragma(`table_info(${table})`) as { name: string }[];
  return new Set(rows.map(r => r.name));
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
) {
  const cols = tableColumns(db, table);
  if (!cols.has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    console.log(`🗄️ [DB] Added column ${table}.${column}`);
  }
}

function initSchema(db: Database.Database) {
  // Non-destructive migration: only CREATE IF NOT EXISTS + ADD COLUMN IF MISSING.
  // Data is NEVER dropped automatically — survives all server restarts and deployments.

  db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id                  TEXT    PRIMARY KEY,
      coin_id             TEXT    NOT NULL,
      symbol              TEXT    NOT NULL,
      name                TEXT    NOT NULL,
      image               TEXT    DEFAULT '',
      signal_type         TEXT    NOT NULL,
      signal_name         TEXT    DEFAULT '',
      timeframe           TEXT    NOT NULL,
      score               INTEGER NOT NULL,
      entry_price         REAL    NOT NULL,
      detected_at         INTEGER NOT NULL,
      crossover_timestamp INTEGER NOT NULL,
      candles_ago         INTEGER DEFAULT 0,
      stop_loss           REAL    DEFAULT 0,
      take_profit         REAL    DEFAULT 0,
      volatility          REAL    DEFAULT 0,
      formula             TEXT    DEFAULT '',
      ema7                REAL    DEFAULT 0,
      ema25               REAL    DEFAULT 0,
      ema99               REAL    DEFAULT 0,
      crossover_strength  REAL    DEFAULT 0,
      change1h            REAL    DEFAULT 0,
      change24h           REAL    DEFAULT 0,
      volume24h           REAL    DEFAULT 0,
      market_cap          REAL    DEFAULT 0,
      source              TEXT    NOT NULL,
      created_at          INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_source    ON signals(source);
    CREATE INDEX IF NOT EXISTS idx_timeframe ON signals(timeframe);
    CREATE INDEX IF NOT EXISTS idx_created   ON signals(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cross_ts  ON signals(crossover_timestamp DESC);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint    TEXT PRIMARY KEY,
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      pages       TEXT NOT NULL DEFAULT '[]',
      created_at  INTEGER NOT NULL
    );
  `);

  // Additive column migrations — safe to run on existing DBs with older schemas.
  // Add new entries here whenever a new column is needed; never remove old ones.
  addColumnIfMissing(db, "signals", "signal_name",        "TEXT DEFAULT ''");
  addColumnIfMissing(db, "signals", "candles_ago",        "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "signals", "stop_loss",          "REAL DEFAULT 0");
  addColumnIfMissing(db, "signals", "take_profit",        "REAL DEFAULT 0");
  addColumnIfMissing(db, "signals", "volatility",         "REAL DEFAULT 0");
  addColumnIfMissing(db, "signals", "formula",            "TEXT DEFAULT ''");
  addColumnIfMissing(db, "signals", "ema7",               "REAL DEFAULT 0");
  addColumnIfMissing(db, "signals", "ema25",              "REAL DEFAULT 0");
  addColumnIfMissing(db, "signals", "ema99",              "REAL DEFAULT 0");
  addColumnIfMissing(db, "signals", "crossover_strength", "REAL DEFAULT 0");
  addColumnIfMissing(db, "signals", "change1h",           "REAL DEFAULT 0");
  addColumnIfMissing(db, "signals", "change24h",          "REAL DEFAULT 0");
  addColumnIfMissing(db, "signals", "volume24h",          "REAL DEFAULT 0");
  addColumnIfMissing(db, "signals", "market_cap",         "REAL DEFAULT 0");
  addColumnIfMissing(db, "signals", "image",              "TEXT DEFAULT ''");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DbSignal {
  id: string;
  coin_id: string;
  symbol: string;
  name: string;
  image: string;
  signal_type: string;
  signal_name: string;
  timeframe: string;
  score: number;
  entry_price: number;
  detected_at: number;
  crossover_timestamp: number;
  candles_ago: number;
  stop_loss: number;
  take_profit: number;
  volatility: number;
  formula: string;
  ema7: number;
  ema25: number;
  ema99: number;
  crossover_strength: number;
  change1h: number;
  change24h: number;
  volume24h: number;
  market_cap: number;
  source: string;
  created_at: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Same dedup logic as the UI's buildEventId */
export function buildSignalId(
  coinId: string,
  signalType: string,
  timeframe: string,
  crossoverTimestamp: number,
): string {
  const minuteFloor = Math.floor(crossoverTimestamp / 60_000) * 60_000;
  return `${coinId}::${signalType}::${timeframe}::${minuteFloor}`;
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Insert new signals, skip duplicates (INSERT OR IGNORE).
 * Returns the number of newly inserted rows.
 */
export function upsertSignals(
  signals: Array<{
    coinId: string;
    symbol: string;
    name: string;
    image: string;
    signalType: string;
    signalName: string;
    timeframe: string;
    score: number;
    price: number;
    crossoverTimestamp: number;
    candlesAgo: number;
    stopLoss: number;
    takeProfit: number;
    volatility: number;
    formula: string;
    ema7: number;
    ema25?: number;
    ema99: number;
    crossoverStrength: number;
    change1h: number;
    change24h: number;
    volume24h: number;
    marketCap: number;
  }>,
  source: string,
): number {
  const db = getDb();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO signals (
      id, coin_id, symbol, name, image,
      signal_type, signal_name, timeframe, score,
      entry_price, detected_at, crossover_timestamp, candles_ago,
      stop_loss, take_profit, volatility, formula,
      ema7, ema25, ema99, crossover_strength,
      change1h, change24h, volume24h, market_cap,
      source, created_at
    ) VALUES (
      @id, @coin_id, @symbol, @name, @image,
      @signal_type, @signal_name, @timeframe, @score,
      @entry_price, @detected_at, @crossover_timestamp, @candles_ago,
      @stop_loss, @take_profit, @volatility, @formula,
      @ema7, @ema25, @ema99, @crossover_strength,
      @change1h, @change24h, @volume24h, @market_cap,
      @source, @created_at
    )
  `);

  const insertAll = db.transaction((items: typeof signals) => {
    let inserted = 0;
    for (const s of items) {
      const id = buildSignalId(s.coinId, s.signalType, s.timeframe, s.crossoverTimestamp);
      const result = stmt.run({
        id,
        coin_id: s.coinId,
        symbol: s.symbol,
        name: s.name,
        image: s.image ?? "",
        signal_type: s.signalType,
        signal_name: s.signalName ?? "",
        timeframe: s.timeframe,
        score: s.score,
        entry_price: s.price,
        detected_at: now,
        crossover_timestamp: s.crossoverTimestamp,
        candles_ago: s.candlesAgo ?? 0,
        stop_loss: s.stopLoss ?? 0,
        take_profit: s.takeProfit ?? 0,
        volatility: s.volatility ?? 0,
        formula: s.formula ?? "",
        ema7: s.ema7 ?? 0,
        ema25: s.ema25 ?? 0,
        ema99: s.ema99 ?? 0,
        crossover_strength: s.crossoverStrength ?? 0,
        change1h: s.change1h ?? 0,
        change24h: s.change24h ?? 0,
        volume24h: s.volume24h ?? 0,
        market_cap: s.marketCap ?? 0,
        source,
        created_at: now,
      });
      inserted += result.changes;
    }
    return inserted;
  });

  return insertAll(signals) as number;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export function querySignals(opts: {
  source?: string;
  timeframe?: string;
  signalType?: string;
  minScore?: number;
  maxScore?: number;
  fromTs?: number;
  toTs?: number;
  search?: string;
  limit?: number;
  offset?: number;
} = {}): DbSignal[] {
  const db = getDb();
  const params: Record<string, string | number> = {};
  let sql = "SELECT * FROM signals WHERE 1=1";

  if (opts.search) {
    sql += " AND (symbol LIKE @search OR name LIKE @search OR signal_type LIKE @search)";
    params.search = `%${opts.search}%`;
  }

  if (opts.source) {
    sql += " AND source = @source";
    params.source = opts.source;
  }
  if (opts.timeframe) {
    sql += " AND timeframe = @timeframe";
    params.timeframe = opts.timeframe;
  }
  if (opts.signalType) {
    sql += " AND signal_type = @signalType";
    params.signalType = opts.signalType;
  }
  if (opts.minScore != null && opts.minScore > 0) {
    sql += " AND score >= @minScore";
    params.minScore = opts.minScore;
  }
  if (opts.maxScore != null && opts.maxScore > 0) {
    sql += " AND score <= @maxScore";
    params.maxScore = opts.maxScore;
  }
  if (opts.fromTs != null) {
    sql += " AND crossover_timestamp >= @fromTs";
    params.fromTs = opts.fromTs;
  }
  if (opts.toTs != null) {
    sql += " AND crossover_timestamp <= @toTs";
    params.toTs = opts.toTs;
  }

  sql += " ORDER BY crossover_timestamp DESC";
  if (opts.limit != null && opts.limit !== -1) {
    sql += ` LIMIT ${opts.limit}`;
    if (opts.offset != null && opts.offset > 0) {
      sql += ` OFFSET ${opts.offset}`;
    }
  }

  return db.prepare(sql).all(params) as DbSignal[];
}

/** Returns distinct symbols stored in the DB, optionally filtered by source. */
export function queryDistinctSymbols(source?: string): string[] {
  const db = getDb();
  if (source && source !== "all") {
    const rows = db
      .prepare("SELECT DISTINCT symbol FROM signals WHERE source = ? ORDER BY symbol ASC")
      .all(source) as { symbol: string }[];
    return rows.map(r => r.symbol);
  }
  const rows = db
    .prepare("SELECT DISTINCT symbol FROM signals ORDER BY symbol ASC")
    .all() as { symbol: string }[];
  return rows.map(r => r.symbol);
}

export function getSignalCount(source?: string): number {
  const db = getDb();
  if (source) {
    return (
      db
        .prepare("SELECT COUNT(*) as c FROM signals WHERE source = ?")
        .get(source) as { c: number }
    ).c;
  }
  return (db.prepare("SELECT COUNT(*) as c FROM signals").get() as { c: number }).c;
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  "Symbol", "Coin", "Type", "Timeframe", "Score", "Price", "Date", "Time", "Source"
];

function escCsv(val: unknown): string {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtDate(ts: any): { date: string; time: string } {
  if (!ts) return { date: "", time: "" };
  try {
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return { date: "", time: "" };
    const iso = d.toISOString(); // 2024-04-08T12:30:00.000Z
    return {
      date: iso.slice(0, 10),
      time: iso.slice(11, 19)
    };
  } catch {
    return { date: "", time: "" };
  }
}

// ─── Push Subscriptions ───────────────────────────────────────────────────────

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  pages: string; // JSON array of AlertPage strings
  created_at: number;
}

export function upsertPushSubscription(
  endpoint: string,
  p256dh: string,
  auth: string,
  pages: string[],
) {
  const db = getDb();
  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, pages, created_at)
    VALUES (@endpoint, @p256dh, @auth, @pages, @created_at)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, pages=excluded.pages
  `).run({ endpoint, p256dh, auth, pages: JSON.stringify(pages), created_at: Date.now() });
}

export function updatePushSubscriptionPages(endpoint: string, pages: string[]) {
  const db = getDb();
  db.prepare(`UPDATE push_subscriptions SET pages=@pages WHERE endpoint=@endpoint`)
    .run({ endpoint, pages: JSON.stringify(pages) });
}

export function deletePushSubscription(endpoint: string) {
  const db = getDb();
  db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=@endpoint`).run({ endpoint });
}

export function getPushSubscriptionsForPage(page: string): PushSubscriptionRow[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM push_subscriptions`).all() as PushSubscriptionRow[];
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function exportCsv(opts: {
  source?: string; 
  timeframe?: string; 
  signalType?: string; 
  minScore?: number;
  fromTs?: number;
  toTs?: number;
  search?: string;
} = {}): string {
  const rows = querySignals({ ...opts, limit: -1 });
  const lines: string[] = [CSV_HEADERS.join(",")];

  for (const r of rows) {
    const { date, time } = fmtDate(r.crossover_timestamp);
    lines.push([
      escCsv(r.symbol),
      escCsv(r.name),
      escCsv(r.signal_type),
      escCsv(r.timeframe),
      escCsv(r.score),
      escCsv(r.entry_price),
      escCsv(date),
      escCsv(time),
      escCsv(r.source),
    ].join(","));
  }

  return lines.join("\r\n");
}
