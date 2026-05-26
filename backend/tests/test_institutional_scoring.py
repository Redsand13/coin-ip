"""
Unit tests for:
  - scoring.py  — compute()
  - pipeline.py — state_to_dict(), _update_range(), _update_vol_ma()
"""
import time
from collections import deque

import pytest

from app.services.institutional.state import Detection, SymbolState, Trade
from app.services.institutional.scoring import compute
from app.services.institutional.pipeline import (
    state_to_dict,
    _update_range,
    _update_vol_ma,
    RANGE_RESET_S,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def fresh(symbol: str = "BTCUSDT") -> SymbolState:
    return SymbolState(symbol=symbol)


def det(kind: str, direction: str, confidence: float = 0.8) -> Detection:
    return Detection(kind=kind, direction=direction, confidence=confidence)


def trd(price: float, qty: float, is_buy: bool, age_ms: float = 0) -> Trade:
    return Trade(ts=time.time() * 1000 - age_ms, price=price, qty=qty, is_buy=is_buy)


# ═══════════════════════════════════════════════════════════════════════════════
# SCORING
# ═══════════════════════════════════════════════════════════════════════════════

class TestCompute:
    def test_empty_detections_returns_zero_neutral(self):
        score, direction = compute([])
        assert score == 0.0
        assert direction == "NEUTRAL"

    def test_single_long_detection(self):
        score, direction = compute([det("ACCUMULATION", "LONG", 1.0)])
        assert score > 0
        assert direction == "LONG"

    def test_single_short_detection(self):
        score, direction = compute([det("DISTRIBUTION", "SHORT", 1.0)])
        assert score > 0
        assert direction == "SHORT"

    def test_score_capped_at_100(self):
        """Even with many high-weight signals the score must not exceed 100."""
        detections = [
            det("ACCUMULATION",  "LONG", 1.0),
            det("WHALE_BUY",     "LONG", 1.0),
            det("ABSORPTION_BUY","LONG", 1.0),
            det("SMART_LONG",    "LONG", 1.0),
            det("ICEBERG_BID",   "LONG", 1.0),
            det("REAL_BREAKOUT_UP","LONG", 1.0),
        ]
        score, _ = compute(detections)
        assert score <= 100.0

    def test_score_always_non_negative(self):
        score, _ = compute([det("DISTRIBUTION", "SHORT", 1.0)])
        assert score >= 0.0

    def test_direction_long_when_long_dominates(self):
        detections = [
            det("ACCUMULATION", "LONG",  0.9),
            det("WHALE_BUY",    "LONG",  0.9),
            det("DISTRIBUTION", "SHORT", 0.1),
        ]
        _, direction = compute(detections)
        assert direction == "LONG"

    def test_direction_short_when_short_dominates(self):
        detections = [
            det("DISTRIBUTION", "SHORT", 0.9),
            det("WHALE_SELL",   "SHORT", 0.9),
            det("ACCUMULATION", "LONG",  0.1),
        ]
        _, direction = compute(detections)
        assert direction == "SHORT"

    def test_neutral_when_balanced(self):
        detections = [
            det("ACCUMULATION", "LONG",  0.8),
            det("DISTRIBUTION", "SHORT", 0.8),
        ]
        _, direction = compute(detections)
        assert direction == "NEUTRAL"

    def test_higher_weight_kinds_score_more(self):
        """ACCUMULATION (weight 28) should score more than ICEBERG_BID (weight 10)."""
        score_heavy, _ = compute([det("ACCUMULATION", "LONG", 1.0)])
        score_light, _ = compute([det("ICEBERG_BID",  "LONG", 1.0)])
        assert score_heavy > score_light

    def test_unknown_kind_uses_default_weight(self):
        """Unknown signal kinds fall back to weight=10 and don't raise."""
        score, direction = compute([det("UNKNOWN_SIGNAL", "LONG", 0.8)])
        assert score > 0
        assert direction == "LONG"

    def test_confidence_scales_score(self):
        score_high, _ = compute([det("WHALE_BUY", "LONG", 1.0)])
        score_low,  _ = compute([det("WHALE_BUY", "LONG", 0.1)])
        assert score_high > score_low

    def test_multiple_long_signals_higher_than_single(self):
        single = compute([det("ACCUMULATION", "LONG", 0.8)])[0]
        multi  = compute([
            det("ACCUMULATION", "LONG", 0.8),
            det("WHALE_BUY",    "LONG", 0.8),
        ])[0]
        assert multi > single


# ═══════════════════════════════════════════════════════════════════════════════
# PIPELINE HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

class TestStateToDict:
    def test_returns_dict_with_required_keys(self):
        state = fresh()
        state.spot_price = 50_000.0
        d = state_to_dict("BTCUSDT", state)
        required = [
            "symbol", "spot_price", "futures_price", "mark_price",
            "funding_rate", "open_interest", "oi_delta",
            "cvd_5m", "cvd_15m", "cvd_total",
            "vwap", "vwap_std", "vwap_zone", "vwap_pct",
            "bid_imbalance", "book_pressure",
            "volume_24h", "vol_ma5",
            "liq_buy_usd", "liq_sell_usd",
            "spot_futures_div",
            "high_24h", "low_24h",
            "confidence", "direction",
            "detections", "updated_at",
        ]
        for key in required:
            assert key in d, f"Missing key: {key!r}"

    def test_symbol_matches(self):
        state = fresh("ETHUSDT")
        d = state_to_dict("ETHUSDT", state)
        assert d["symbol"] == "ETHUSDT"

    def test_detections_serialised_correctly(self):
        state = fresh()
        state.detections = [det("WHALE_BUY", "LONG", 0.75)]
        d = state_to_dict("BTCUSDT", state)
        assert len(d["detections"]) == 1
        entry = d["detections"][0]
        assert entry["kind"] == "WHALE_BUY"
        assert entry["direction"] == "LONG"
        assert entry["confidence"] == pytest.approx(0.75, rel=1e-3)

    def test_vwap_zone_is_string(self):
        state = fresh()
        d = state_to_dict("BTCUSDT", state)
        assert isinstance(d["vwap_zone"], str)
        assert d["vwap_zone"] in ("PREMIUM", "DISCOUNT", "EQUILIBRIUM")

    def test_all_numeric_fields_are_finite(self):
        state = fresh()
        state.spot_price     = 50_000.0
        state.futures_price  = 50_010.0
        state.cvd_5m         = 12_345.0
        d = state_to_dict("BTCUSDT", state)
        numeric = [k for k, v in d.items() if isinstance(v, float)]
        for k in numeric:
            assert isinstance(d[k], float), f"{k} not float"
            assert d[k] == d[k], f"{k} is NaN"  # NaN != NaN

    def test_spot_futures_div_correct(self):
        state = fresh()
        state.spot_price    = 100.0
        state.futures_price = 101.0
        d = state_to_dict("BTCUSDT", state)
        assert d["spot_futures_div"] == pytest.approx(1.0, rel=1e-4)


class TestUpdateRange:
    def test_initialises_range_on_first_price(self):
        state = fresh()
        state.spot_price = 50_000.0
        _update_range(state)
        assert state.range_high == pytest.approx(50_000.0)
        assert state.range_low  == pytest.approx(50_000.0)

    def test_range_expands_on_new_high(self):
        state = fresh()
        state.spot_price = 50_000.0
        _update_range(state)
        state.spot_price = 55_000.0
        _update_range(state)
        assert state.range_high == pytest.approx(55_000.0)
        assert state.range_low  == pytest.approx(50_000.0)

    def test_range_expands_on_new_low(self):
        state = fresh()
        state.spot_price = 50_000.0
        _update_range(state)
        state.spot_price = 45_000.0
        _update_range(state)
        assert state.range_low  == pytest.approx(45_000.0)
        assert state.range_high == pytest.approx(50_000.0)

    def test_range_does_not_shrink(self):
        state = fresh()
        state.spot_price = 50_000.0
        _update_range(state)
        # Introduce extremes
        for p in [60_000, 40_000, 55_000, 48_000]:
            state.spot_price = p
            _update_range(state)
        assert state.range_high == pytest.approx(60_000.0)
        assert state.range_low  == pytest.approx(40_000.0)

    def test_range_resets_after_timeout(self):
        state = fresh()
        state.spot_price = 50_000.0
        state.range_ts   = time.time() - (RANGE_RESET_S + 1)
        state.range_high = 50_000.0
        state.range_low  = 50_000.0
        state.spot_price = 30_000.0
        _update_range(state)
        # Reset → both sides set to current price
        assert state.range_high == pytest.approx(30_000.0)
        assert state.range_low  == pytest.approx(30_000.0)

    def test_zero_price_is_ignored(self):
        state = fresh()
        state.spot_price = 0.0
        _update_range(state)
        assert state.range_high == 0.0
        assert state.range_low  == float("inf")  # unchanged from default


class TestUpdateVolMa:
    def test_vol_ma_zero_with_no_trades(self):
        state = fresh()
        _update_vol_ma(state)
        assert state.vol_ma5  == 0.0
        assert state.vol_ma15 == 0.0

    def test_vol_ma5_reflects_recent_trades(self):
        state = fresh()
        # Add trades within 5-minute window
        for _ in range(5):
            state.trades.append(trd(100, 10.0, is_buy=True, age_ms=60_000))
        _update_vol_ma(state)
        # Each trade = 100 * 10 = 1000 USD; 5 trades = 5000 USD / 300s
        assert state.vol_ma5 == pytest.approx(5_000 / 300, rel=1e-2)

    def test_vol_ma5_excludes_old_trades(self):
        state = fresh()
        old = trd(100, 1000.0, is_buy=True, age_ms=400_000)  # 6.7 min old
        new = trd(100, 10.0,  is_buy=True, age_ms=60_000)
        state.trades.extend([old, new])
        _update_vol_ma(state)
        # Only new trade contributes to vol_ma5
        expected = (100 * 10) / 300
        assert state.vol_ma5 == pytest.approx(expected, rel=1e-2)

    def test_vol_ma15_includes_what_5m_excludes(self):
        state = fresh()
        mid_age = trd(100, 100.0, is_buy=True, age_ms=700_000)   # ~12 min, in 15m not 5m
        new     = trd(100, 10.0,  is_buy=True, age_ms=60_000)
        state.trades.extend([mid_age, new])
        _update_vol_ma(state)
        assert state.vol_ma15 > state.vol_ma5
