"""
Institutional signal detectors.

Each detector receives a SymbolState and returns a Detection or None.
All 10 categories are covered:
  1. Accumulation / Distribution  (CVD-price divergence)
  2. Whale Activity               (single or clustered large trades)
  3. Absorption                   (high volume, no price movement)
  4. Iceberg Orders               (level keeps refreshing in book)
  5. Spoofing-like Behavior       (large order vanishes without fill)
  6. Liquidity Grab               (sweep below/above range, then reversal)
  7. Stop Hunt                    (spike to round number + reversal)
  8. Fake vs Real Breakout        (CVD + volume confirmation)
  9. Smart Money Positioning      (OI + funding + CVD confluence)
 10. Retail Leverage Trap         (extreme funding vs smart-money divergence)
"""
from __future__ import annotations

import time
from typing import TYPE_CHECKING

from app.services.institutional.state import Detection
from app.services.institutional import cvd        as CVD_MOD
from app.services.institutional import order_book as OB_MOD

if TYPE_CHECKING:
    from app.services.institutional.state import SymbolState

# ── Thresholds (tunable) ───────────────────────────────────────────────────────

WHALE_USD_MIN     = 100_000    # single aggTrade USD to classify as whale
WHALE_CLUSTER_N   = 3          # N whale trades within 30 s → cluster
ABSORB_VOL_MULT   = 3.0        # volume must be ≥ N× vol_ma5 for absorption
ABSORB_PRICE_MAX  = 0.0015     # price change < 0.15 % → stalled
OI_DELTA_THRESH   = 0.004      # OI must move ≥ 0.4 % to trigger OI signals
FUNDING_HIGH      =  0.0010    # +0.1 % per 8 h = crowded longs
FUNDING_LOW       = -0.0010    # −0.1 % per 8 h = crowded shorts
BREAKOUT_MARGIN   = 0.004      # 0.4 % beyond range edge = breakout
LIQ_GRAB_MIN      = 0.002      # price must sweep ≥ 0.2 % beyond range edge
STOP_HUNT_MIN_PCT = 0.003      # spike ≥ 0.3 % then return → stop hunt


# ── 1. Accumulation / Distribution ────────────────────────────────────────────

def detect_accum_distrib(state: "SymbolState") -> Detection | None:
    score = CVD_MOD.cvd_divergence_score(state)
    if score > 0.5:
        return Detection(
            kind="ACCUMULATION",
            direction="LONG",
            confidence=min(score, 1.0),
            details={"cvd_5m": round(state.cvd_5m, 2), "price": state.spot_price},
        )
    if score < -0.5:
        return Detection(
            kind="DISTRIBUTION",
            direction="SHORT",
            confidence=min(abs(score), 1.0),
            details={"cvd_5m": round(state.cvd_5m, 2), "price": state.spot_price},
        )
    return None


# ── 2. Whale Activity ─────────────────────────────────────────────────────────

def detect_whale(state: "SymbolState") -> Detection | None:
    now_ms  = time.time() * 1000
    recent  = [t for t in state.trades if now_ms - t.ts <= 30_000]
    whales  = [t for t in recent if t.price * t.qty >= WHALE_USD_MIN]
    if len(whales) < WHALE_CLUSTER_N and not any(
        t.price * t.qty >= WHALE_USD_MIN * 3 for t in whales
    ):
        return None

    buy_usd  = sum(t.price * t.qty for t in whales if t.is_buy)
    sell_usd = sum(t.price * t.qty for t in whales if not t.is_buy)
    total    = buy_usd + sell_usd
    if total == 0:
        return None

    confidence = min(total / (WHALE_USD_MIN * 5), 1.0)

    if buy_usd > sell_usd * 1.4:
        return Detection(
            kind="WHALE_BUY", direction="LONG", confidence=confidence,
            details={"buy_usd": round(buy_usd), "sell_usd": round(sell_usd),
                     "trades": len(whales)},
        )
    if sell_usd > buy_usd * 1.4:
        return Detection(
            kind="WHALE_SELL", direction="SHORT", confidence=confidence,
            details={"buy_usd": round(buy_usd), "sell_usd": round(sell_usd),
                     "trades": len(whales)},
        )
    return None


# ── 3. Absorption ─────────────────────────────────────────────────────────────

def detect_absorption(state: "SymbolState") -> Detection | None:
    if state.vol_ma5 == 0 or len(state.trades) < 20:
        return None

    now_ms = time.time() * 1000
    recent = [t for t in state.trades if now_ms - t.ts <= 60_000]
    if len(recent) < 10:
        return None

    # Volume rate vs baseline
    period_vol_rate = sum(t.price * t.qty for t in recent) / 60.0
    if period_vol_rate < state.vol_ma5 * ABSORB_VOL_MULT:
        return None

    # Price movement over same window
    first_price = recent[0].price
    price_move  = abs(state.spot_price - first_price) / max(first_price, 1)
    if price_move > ABSORB_PRICE_MAX:
        return None

    buy_usd  = sum(t.price * t.qty for t in recent if t.is_buy)
    sell_usd = sum(t.price * t.qty for t in recent if not t.is_buy)

    # Require meaningful imbalance: one side must dominate by ≥25 %
    total_usd = buy_usd + sell_usd
    if total_usd == 0:
        return None
    if abs(buy_usd - sell_usd) < total_usd * 0.25:
        return None   # balanced flow, not absorption

    confidence = min(period_vol_rate / (state.vol_ma5 * 6), 1.0)

    if sell_usd > buy_usd:
        # More taker selling, price not moving → smart money absorbing sells (bullish)
        return Detection(
            kind="ABSORPTION_BUY", direction="LONG", confidence=confidence,
            details={"sell_absorbed_usd": round(sell_usd),
                     "buy_usd": round(buy_usd),
                     "price_move_pct": round(price_move * 100, 3)},
        )
    # More taker buying, price not moving → smart money absorbing buys (bearish)
    return Detection(
        kind="ABSORPTION_SELL", direction="SHORT", confidence=confidence,
        details={"buy_absorbed_usd": round(buy_usd),
                 "sell_usd": round(sell_usd),
                 "price_move_pct": round(price_move * 100, 3)},
    )


# ── 4. Iceberg Orders ─────────────────────────────────────────────────────────

def detect_iceberg(state: "SymbolState") -> Detection | None:
    has_bid, bid_price = OB_MOD.iceberg_bid_level(state)
    has_ask, ask_price = OB_MOD.iceberg_ask_level(state)

    if has_bid and has_ask:
        return None  # both sides → likely market maker, neutral

    if has_bid:
        return Detection(
            kind="ICEBERG_BID", direction="LONG", confidence=0.65,
            details={"price_level": bid_price,
                     "refreshes": state.bid_refresh_counts.get(bid_price, 0)},
        )
    if has_ask:
        return Detection(
            kind="ICEBERG_ASK", direction="SHORT", confidence=0.65,
            details={"price_level": ask_price,
                     "refreshes": state.ask_refresh_counts.get(ask_price, 0)},
        )
    return None


# ── 5. Spoofing-like Behavior ─────────────────────────────────────────────────

def detect_spoof(state: "SymbolState") -> Detection | None:
    spoof_bid = OB_MOD.spoof_bid_active(state)
    spoof_ask = OB_MOD.spoof_ask_active(state)
    if not spoof_bid and not spoof_ask:
        return None

    n          = len(state.spoof_events)
    confidence = min(n / 5, 1.0) * 0.70   # max 0.70 — inherently uncertain

    if spoof_bid and not spoof_ask:
        # Fake bid wall → smart money wants to short
        return Detection(
            kind="SPOOF_BID", direction="SHORT", confidence=confidence,
            details={"spoof_events": n},
        )
    if spoof_ask and not spoof_bid:
        return Detection(
            kind="SPOOF_ASK", direction="LONG", confidence=confidence,
            details={"spoof_events": n},
        )
    return None


# ── 6. Liquidity Grab ─────────────────────────────────────────────────────────

def detect_liquidity_grab(state: "SymbolState") -> Detection | None:
    if state.range_high == 0 or state.range_low == float("inf"):
        return None
    price = state.spot_price
    if price == 0:
        return None

    # Sweep below range low with buying CVD → liquidity grab, then long
    below_sweep = price < state.range_low * (1 - LIQ_GRAB_MIN)
    above_sweep = price > state.range_high * (1 + LIQ_GRAB_MIN)

    if below_sweep and state.cvd_5m > 0:
        conf = min(abs(state.cvd_5m) / max(state.vol_ma5 * 300, 1), 0.90)
        return Detection(
            kind="LIQUIDITY_GRAB_LOW", direction="LONG", confidence=conf,
            details={"range_low": state.range_low, "sweep_price": price,
                     "cvd_5m": round(state.cvd_5m, 2)},
        )

    if above_sweep and state.cvd_5m < 0:
        conf = min(abs(state.cvd_5m) / max(state.vol_ma5 * 300, 1), 0.90)
        return Detection(
            kind="LIQUIDITY_GRAB_HIGH", direction="SHORT", confidence=conf,
            details={"range_high": state.range_high, "sweep_price": price,
                     "cvd_5m": round(state.cvd_5m, 2)},
        )
    return None


# ── 7. Stop Hunt ──────────────────────────────────────────────────────────────

def detect_stop_hunt(state: "SymbolState") -> Detection | None:
    if len(state.trades) < 15 or state.spot_price == 0:
        return None

    recent_prices = [t.price for t in list(state.trades)[-20:]]
    max_r  = max(recent_prices)
    min_r  = min(recent_prices)
    spread = max_r - min_r
    price  = state.spot_price

    if spread / price < STOP_HUNT_MIN_PCT:
        return None

    def near_round(p: float) -> bool:
        """True if price is within 0.2 % of a round number (0 or 5 in 2nd sig digit)."""
        if p <= 0:
            return False
        mag = 10 ** max(0, len(str(int(p))) - 2)
        remainder = p % mag
        return remainder / mag < 0.002 or remainder / mag > 0.998

    # Spike low: min_r is notably below current price and near a round number
    if min_r < price * (1 - STOP_HUNT_MIN_PCT) and near_round(min_r) and state.cvd_5m > 0:
        return Detection(
            kind="STOP_HUNT_LOW", direction="LONG", confidence=0.72,
            details={"spike_low": min_r, "current": price,
                     "spread_pct": round(spread / price * 100, 3)},
        )
    # Spike high: max_r is notably above current price and near a round number
    if max_r > price * (1 + STOP_HUNT_MIN_PCT) and near_round(max_r) and state.cvd_5m < 0:
        return Detection(
            kind="STOP_HUNT_HIGH", direction="SHORT", confidence=0.72,
            details={"spike_high": max_r, "current": price,
                     "spread_pct": round(spread / price * 100, 3)},
        )
    return None


# ── 8. Fake vs Real Breakout ──────────────────────────────────────────────────

def detect_breakout(state: "SymbolState") -> Detection | None:
    if state.range_high == 0 or state.range_low == float("inf"):
        return None
    price = state.spot_price
    if price == 0:
        return None

    above = price > state.range_high * (1 + BREAKOUT_MARGIN)
    below = price < state.range_low  * (1 - BREAKOUT_MARGIN)
    if not above and not below:
        return None

    cvd_ok  = (above and state.cvd_5m > 0) or (below and state.cvd_5m < 0)
    vol_ok  = state.vol_ma5 > 0 and _recent_vol_rate(state) > state.vol_ma5 * 1.8
    is_real = cvd_ok and vol_ok

    if above:
        return Detection(
            kind="REAL_BREAKOUT_UP" if is_real else "FAKE_BREAKOUT_UP",
            direction="LONG" if is_real else "SHORT",
            confidence=0.82 if is_real else 0.60,
            details={"range_high": state.range_high, "price": price,
                     "cvd_ok": cvd_ok, "vol_ok": vol_ok},
        )
    return Detection(
        kind="REAL_BREAKOUT_DOWN" if is_real else "FAKE_BREAKOUT_DOWN",
        direction="SHORT" if is_real else "LONG",
        confidence=0.82 if is_real else 0.60,
        details={"range_low": state.range_low, "price": price,
                 "cvd_ok": cvd_ok, "vol_ok": vol_ok},
    )


def _recent_vol_rate(state: "SymbolState") -> float:
    now_ms = time.time() * 1000
    window = [t for t in state.trades if now_ms - t.ts <= 300_000]
    return sum(t.price * t.qty for t in window) / 300.0 if window else 0.0


# ── 9. Smart Money Positioning ────────────────────────────────────────────────

def detect_smart_money(state: "SymbolState") -> Detection | None:
    if state.open_interest == 0:
        return None

    oi_rising  = state.oi_delta > state.open_interest * OI_DELTA_THRESH
    oi_falling = state.oi_delta < -(state.open_interest * OI_DELTA_THRESH)
    fund_long  = state.funding_rate > FUNDING_HIGH * 0.5
    fund_short = state.funding_rate < FUNDING_LOW  * 0.5
    cvd_bull   = state.cvd_5m > 0
    cvd_bear   = state.cvd_5m < 0

    if oi_rising and not fund_short and cvd_bull:
        conf = min(0.55 + abs(state.oi_delta / state.open_interest) * 8, 0.92)
        return Detection(
            kind="SMART_LONG", direction="LONG", confidence=conf,
            details={"oi_delta_pct": round(state.oi_delta / state.open_interest * 100, 3),
                     "funding_rate": state.funding_rate},
        )

    if oi_rising and fund_short and cvd_bear:
        conf = min(0.55 + abs(state.oi_delta / state.open_interest) * 8, 0.92)
        return Detection(
            kind="SMART_SHORT", direction="SHORT", confidence=conf,
            details={"oi_delta_pct": round(state.oi_delta / state.open_interest * 100, 3),
                     "funding_rate": state.funding_rate},
        )

    return None


# ── 10. Retail Leverage Trap ──────────────────────────────────────────────────

def detect_retail_trap(state: "SymbolState") -> Detection | None:
    if state.funding_rate == 0 or state.mark_price == 0:
        return None

    # Crowded longs + smart money distributing → long trap
    if state.funding_rate > FUNDING_HIGH and state.cvd_5m < 0:
        est_liq = state.mark_price * 0.92   # rough ~10× leverage liq level
        return Detection(
            kind="RETAIL_LONG_TRAP", direction="SHORT", confidence=0.76,
            details={"funding_rate": state.funding_rate,
                     "est_liq_zone": round(est_liq, 4),
                     "cvd_5m": round(state.cvd_5m, 2)},
        )

    # Crowded shorts + smart money accumulating → short trap
    if state.funding_rate < FUNDING_LOW and state.cvd_5m > 0:
        est_liq = state.mark_price * 1.08
        return Detection(
            kind="RETAIL_SHORT_TRAP", direction="LONG", confidence=0.76,
            details={"funding_rate": state.funding_rate,
                     "est_liq_zone": round(est_liq, 4),
                     "cvd_5m": round(state.cvd_5m, 2)},
        )

    return None


# ── Orchestrator ──────────────────────────────────────────────────────────────

_ALL = [
    detect_accum_distrib,
    detect_whale,
    detect_absorption,
    detect_iceberg,
    detect_spoof,
    detect_liquidity_grab,
    detect_stop_hunt,
    detect_breakout,
    detect_smart_money,
    detect_retail_trap,
]


def run_all(state: "SymbolState") -> list[Detection]:
    results: list[Detection] = []
    for fn in _ALL:
        try:
            d = fn(state)
            if d is not None:
                results.append(d)
        except Exception:
            pass   # never let a detector crash the pipeline
    return results
