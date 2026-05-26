// ── Shared signal type definitions ────────────────────────────────────────────

// ── Exchange Futures (Binance / CoinGecko) ────────────────────────────────────

export interface EFSignalEntry {
  entryId: string;
  symbol: string;
  name: string;
  image?: string;
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
  ema7?: number;
  ema25?: number;
  ema99?: number;
  mlScore?: number;
  confluenceScore?: number;
  coinId?: string;
}

// ── ICT / SMC ─────────────────────────────────────────────────────────────────

export type KillZoneName = "LONDON" | "NEW_YORK" | "ASIA" | "LONDON_CLOSE";
export type PremiumDiscount = "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";
export type MarketStructure = "BULLISH" | "BEARISH" | "RANGING";

export interface OTEZone {
  high: number;
  low: number;
  optimal: number;
}

export interface ICTSignal {
  id: string;
  coinId: string;
  symbol: string;
  name: string;
  image?: string;
  timeframe: string;
  signalType: "LONG" | "SHORT";
  setupType: string;
  score: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  sweepTimestamp: number;
  /** Alias of sweepTimestamp — used by ICTTerminal for age calculation */
  timestamp: number;
  candlesSinceSweep: number;
  change24h: number;
  volume24h: number;
  formula: string;
  marketStructure: MarketStructure;
  killZone?: KillZoneName;
  inKillZone: boolean;
  premiumDiscount: PremiumDiscount;
  /** Status of the setup relative to the entry zone */
  status: "IN_ZONE" | "ACTIVE";
  priceInZone: boolean;
  /** Whether price is currently in the entry zone */
  liquidityType: string;

  // ICT confluences (boolean flags)
  /** Alias for hasCHoCH */
  choch: boolean;
  /** Alias for hasBOS */
  bos: boolean;
  /** Alias for hasDisplacement */
  displacement: boolean;
  hasDisplacement: boolean;
  hasSweep: boolean;
  hasFVG: boolean;
  hasOB: boolean;
  hasCHoCH: boolean;
  hasBOS: boolean;
  hasInducement: boolean;
  isBreaker: boolean;

  // Entry zone levels
  entryZoneHigh: number;
  entryZoneLow: number;
  /** CE = Consequent Encroachment — midpoint of entry zone */
  ceLevel: number;
  bosLevel: number;
  oteZone: OTEZone | null;

  // Dealing range (higher TF structure)
  dealingRangeHigh: number;
  dealingRangeLow: number;

  // Raw structure levels from backend
  orderBlockTop?: number;
  orderBlockBottom?: number;
  fvgTop?: number;
  fvgBottom?: number;
  sweepHigh?: number;
  sweepLow?: number;

  // ML enrichment
  mlScore?: number;
  confluenceScore?: number;
}

// ── FastAPI raw response shape ─────────────────────────────────────────────────

export interface ApiSignal {
  id: string;
  symbol: string;
  source: "binance" | "coingecko" | "ict";
  direction: "LONG" | "SHORT";
  timeframe: string;
  signal_time: string;
  price: number;
  volume?: number | null;
  market_cap?: number | null;
  ema_fast?: number | null;
  ema_mid?: number | null;
  ema_slow?: number | null;
  ict_pattern?: string | null;
  sweep_high?: number | null;
  sweep_low?: number | null;
  order_block_top?: number | null;
  order_block_bottom?: number | null;
  fvg_top?: number | null;
  fvg_bottom?: number | null;
  confluence_score?: number | null;
  aligned_timeframes?: string[] | null;
  ml_score?: number | null;
  ml_confidence?: number | null;
  ml_features?: Record<string, number> | null;
  extra?: Record<string, unknown> | null;
  notified: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiSignalPage {
  total: number;
  items: ApiSignal[];
}

// ── History page (DB signal shape from FastAPI) ────────────────────────────────

// ── Institutional Order Flow ───────────────────────────────────────────────────

export interface InstitutionalDetection {
  kind: string;
  direction: "LONG" | "SHORT" | "NEUTRAL";
  confidence: number;
  details: Record<string, unknown>;
}

export type VwapZone = "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";

export interface InstitutionalFlow {
  symbol: string;
  spot_price: number;
  futures_price: number;
  mark_price: number;
  funding_rate: number;
  open_interest: number;
  oi_delta: number;
  cvd_5m: number;
  cvd_15m: number;
  cvd_total: number;
  vwap: number;
  vwap_std: number;
  vwap_zone: VwapZone;
  vwap_pct: number;
  bid_imbalance: number;
  book_pressure: number;
  volume_24h: number;
  vol_ma5: number;
  liq_buy_usd: number;
  liq_sell_usd: number;
  spot_futures_div: number;
  high_24h: number;
  low_24h: number;
  confidence: number;
  direction: "LONG" | "SHORT" | "NEUTRAL";
  detections: InstitutionalDetection[];
  updated_at: number;
}

export interface InstitutionalFlowList {
  symbols: InstitutionalFlow[];
  count: number;
  tracked: number;
}

export interface DbSignal {
  id: string;
  symbol: string;
  /** Coin display name — derived from symbol when not available */
  name: string;
  source: string;
  direction: string;
  /** Alias for direction — kept for backward compat with SignalHistoryTerminal */
  signal_type: string;
  timeframe: string;
  signal_time: string;
  price: number;
  /** Alias for price — kept for backward compat with SignalHistoryTerminal */
  entry_price: number;
  volume?: number | null;
  market_cap?: number | null;
  ema_fast?: number | null;
  ema_mid?: number | null;
  ema_slow?: number | null;
  ict_pattern?: string | null;
  confluence_score?: number | null;
  ml_score?: number | null;
  ml_confidence?: number | null;
  /** Alias for ml_score * 100 — used by SignalHistoryTerminal */
  score: number;
  /** Alias for signal_time as ms — used by SignalHistoryTerminal */
  crossover_timestamp: number;
  notified: boolean;
  created_at: string;
}
