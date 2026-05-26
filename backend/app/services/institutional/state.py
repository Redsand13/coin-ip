"""Per-symbol state objects for institutional order flow analysis."""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Trade:
    ts:     float   # Binance trade time in milliseconds
    price:  float
    qty:    float
    is_buy: bool    # True = taker buy (m=False in aggTrade)


@dataclass
class Detection:
    kind:       str             # e.g. "ACCUMULATION", "WHALE_BUY", "ICEBERG_BID"
    direction:  str             # "LONG" | "SHORT" | "NEUTRAL"
    confidence: float           # 0.0 – 1.0
    details:    dict[str, Any] = field(default_factory=dict)
    ts:         float          = field(default_factory=time.time)


@dataclass
class SymbolState:
    symbol: str

    # ── Prices ────────────────────────────────────────────────────────────────
    spot_price:    float = 0.0
    futures_price: float = 0.0
    high_24h:      float = 0.0
    low_24h:       float = 0.0
    volume_24h:    float = 0.0

    # ── CVD ───────────────────────────────────────────────────────────────────
    cvd_total: float = 0.0   # running lifetime delta
    cvd_5m:    float = 0.0   # 5-minute rolling delta
    cvd_15m:   float = 0.0   # 15-minute rolling delta

    # ── VWAP ──────────────────────────────────────────────────────────────────
    vwap_num: float = 0.0    # Σ(price × qty)
    vwap_den: float = 0.0    # Σ(qty)
    vwap:     float = 0.0
    vwap_std: float = 0.0

    # ── Order book ────────────────────────────────────────────────────────────
    bids:          dict[float, float] = field(default_factory=dict)
    asks:          dict[float, float] = field(default_factory=dict)
    bid_imbalance: float = 0.5   # 0 = ask-heavy, 1 = bid-heavy
    book_pressure: float = 0.0   # signed: positive = bid-heavy

    # Iceberg / spoof tracking
    bid_refresh_counts: dict[float, int] = field(default_factory=dict)
    ask_refresh_counts: dict[float, int] = field(default_factory=dict)
    prev_bids:          dict[float, float] = field(default_factory=dict)
    prev_asks:          dict[float, float] = field(default_factory=dict)
    spoof_events:       deque = field(default_factory=lambda: deque(maxlen=30))

    # ── Futures ───────────────────────────────────────────────────────────────
    mark_price:    float = 0.0
    funding_rate:  float = 0.0
    open_interest: float = 0.0
    oi_prev:       float = 0.0
    oi_delta:      float = 0.0  # absolute change since last OI update

    # ── Liquidations ──────────────────────────────────────────────────────────
    liq_buy_usd:  float = 0.0   # cumulative; forced BUY = shorts liquidated
    liq_sell_usd: float = 0.0   # cumulative; forced SELL = longs liquidated

    # ── Rolling trade history ─────────────────────────────────────────────────
    trades:   deque = field(default_factory=lambda: deque(maxlen=1000))
    vol_ma5:  float = 0.0   # avg USD volume per second over last 5 min
    vol_ma15: float = 0.0   # avg USD volume per second over last 15 min

    # ── Range tracking (for breakout / liquidity grab detection) ─────────────
    range_high: float = 0.0
    range_low:  float = float("inf")
    range_ts:   float = 0.0

    # ── Current detections + score ────────────────────────────────────────────
    detections:        list[Detection] = field(default_factory=list)
    confidence:        float = 0.0
    primary_direction: str   = "NEUTRAL"
    updated_at:        float = 0.0

    # ── Evaluation cooldown ───────────────────────────────────────────────────
    _last_eval: float = field(default=0.0, repr=False)

    def spot_futures_divergence(self) -> float:
        """Basis: (futures − spot) / spot × 100. Positive = futures premium."""
        if self.spot_price == 0:
            return 0.0
        return (self.futures_price - self.spot_price) / self.spot_price * 100
