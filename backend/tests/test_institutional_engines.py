"""
Unit tests for the institutional order-flow engine modules:
  - cvd.py
  - vwap.py
  - order_book.py
"""
import time
from collections import deque

import pytest

from app.services.institutional.state import SymbolState, Trade
from app.services.institutional import cvd as CVD
from app.services.institutional import vwap as VWAP
from app.services.institutional import order_book as OB


# ── Fixtures ──────────────────────────────────────────────────────────────────

def make_state(symbol: str = "BTCUSDT") -> SymbolState:
    return SymbolState(symbol=symbol)


def make_trade(price: float, qty: float, is_buy: bool, age_ms: float = 0) -> Trade:
    """age_ms: how many milliseconds ago the trade happened (0 = now)."""
    ts = time.time() * 1000 - age_ms
    return Trade(ts=ts, price=price, qty=qty, is_buy=is_buy)


# ═══════════════════════════════════════════════════════════════════════════════
# CVD ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class TestCVDUpdate:
    def test_buy_trade_increases_cvd_total(self):
        state = make_state()
        trade = make_trade(price=50_000, qty=1.0, is_buy=True)
        state.trades.append(trade)
        CVD.update_cvd(state, trade)
        assert state.cvd_total == pytest.approx(50_000.0)

    def test_sell_trade_decreases_cvd_total(self):
        state = make_state()
        trade = make_trade(price=50_000, qty=2.0, is_buy=False)
        state.trades.append(trade)
        CVD.update_cvd(state, trade)
        assert state.cvd_total == pytest.approx(-100_000.0)

    def test_mixed_trades_net_cvd(self):
        state = make_state()
        trades = [
            make_trade(50_000, 3.0, is_buy=True),
            make_trade(50_000, 1.0, is_buy=False),
        ]
        for t in trades:
            state.trades.append(t)
            CVD.update_cvd(state, t)
        # net = +150_000 - 50_000 = +100_000
        assert state.cvd_total == pytest.approx(100_000.0)

    def test_cvd_5m_excludes_old_trades(self):
        state = make_state()
        old_trade = make_trade(50_000, 10.0, is_buy=True, age_ms=400_000)  # 6.7 min ago
        new_trade = make_trade(50_000, 1.0,  is_buy=True, age_ms=60_000)   # 1 min ago
        for t in [old_trade, new_trade]:
            state.trades.append(t)
            CVD.update_cvd(state, t)
        # cvd_5m should only include new_trade (1.0 * 50_000 = 50_000)
        assert state.cvd_5m == pytest.approx(50_000.0)

    def test_cvd_5m_includes_recent_trades(self):
        state = make_state()
        trades = [
            make_trade(100, 1.0, is_buy=True,  age_ms=30_000),  # 30s ago
            make_trade(100, 2.0, is_buy=False, age_ms=60_000),  # 1min ago
        ]
        for t in trades:
            state.trades.append(t)
            CVD.update_cvd(state, t)
        # Both within 5 min: +100 - 200 = -100
        assert state.cvd_5m == pytest.approx(-100.0)

    def test_cvd_15m_window_larger_than_5m(self):
        state = make_state()
        old_buy = make_trade(100, 5.0, is_buy=True, age_ms=700_000)   # ~12 min — within 15m
        new_buy = make_trade(100, 1.0, is_buy=True, age_ms=60_000)    # 1 min
        for t in [old_buy, new_buy]:
            state.trades.append(t)
            CVD.update_cvd(state, t)
        # cvd_15m includes both: +500 + 100 = 600
        assert state.cvd_15m == pytest.approx(600.0)
        # cvd_5m includes only recent: +100
        assert state.cvd_5m == pytest.approx(100.0)

    def test_cvd_total_not_affected_by_window_resets(self):
        state = make_state()
        t1 = make_trade(100, 10.0, is_buy=True, age_ms=1_000_000)  # very old
        t2 = make_trade(100, 1.0,  is_buy=True, age_ms=30_000)
        for t in [t1, t2]:
            state.trades.append(t)
            CVD.update_cvd(state, t)
        # cvd_total accumulates all: 1000 + 100 = 1100
        assert state.cvd_total == pytest.approx(1100.0)


class TestCVDDivergenceScore:
    def test_returns_zero_with_empty_state(self):
        state = make_state()
        assert CVD.cvd_divergence_score(state) == 0.0

    def test_returns_zero_with_zero_spot_price(self):
        state = make_state()
        t = make_trade(100, 1.0, is_buy=True)
        state.trades.append(t)
        CVD.update_cvd(state, t)
        state.spot_price = 0.0
        assert CVD.cvd_divergence_score(state) == 0.0

    def test_accumulation_score_positive(self):
        """Price falling but CVD rising → accumulation → positive score."""
        state = make_state()
        # Old trade at higher price
        old_trade = make_trade(price=110, qty=1.0, is_buy=True, age_ms=200_000)
        recent_buy = make_trade(price=100, qty=5.0, is_buy=True, age_ms=10_000)
        for t in [old_trade, recent_buy]:
            state.trades.append(t)
            CVD.update_cvd(state, t)
        state.spot_price = 95.0   # price fell from 110 to 95
        state.vol_ma5 = 500.0
        score = CVD.cvd_divergence_score(state)
        assert score > 0, f"Expected positive accumulation score, got {score}"

    def test_distribution_score_negative(self):
        """Price rising but CVD falling → distribution → negative score."""
        state = make_state()
        old_trade = make_trade(price=90,  qty=1.0,  is_buy=False, age_ms=200_000)
        recent_sell = make_trade(price=100, qty=5.0, is_buy=False, age_ms=10_000)
        for t in [old_trade, recent_sell]:
            state.trades.append(t)
            CVD.update_cvd(state, t)
        state.spot_price = 110.0  # price rose
        state.vol_ma5 = 500.0
        score = CVD.cvd_divergence_score(state)
        assert score < 0, f"Expected negative distribution score, got {score}"

    def test_score_bounded(self):
        """Score must always be in [-1, +1]."""
        state = make_state()
        for i in range(50):
            t = make_trade(100, 100.0, is_buy=True, age_ms=i * 1000)
            state.trades.append(t)
            CVD.update_cvd(state, t)
        state.spot_price = 50.0
        state.vol_ma5 = 1.0
        score = CVD.cvd_divergence_score(state)
        assert -1.0 <= score <= 1.0


# ═══════════════════════════════════════════════════════════════════════════════
# VWAP ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class TestVWAP:
    def test_single_trade_vwap_equals_price(self):
        state = make_state()
        t = make_trade(50_000, 1.0, is_buy=True)
        state.trades.append(t)
        VWAP.update_vwap(state, t)
        assert state.vwap == pytest.approx(50_000.0)

    def test_equal_trades_vwap_is_mean(self):
        state = make_state()
        trades = [
            make_trade(100, 1.0, is_buy=True),
            make_trade(200, 1.0, is_buy=True),
        ]
        for t in trades:
            state.trades.append(t)
            VWAP.update_vwap(state, t)
        assert state.vwap == pytest.approx(150.0)

    def test_volume_weighted_larger_qty_dominates(self):
        state = make_state()
        trades = [
            make_trade(100, 10.0, is_buy=True),  # low price, high qty
            make_trade(200, 1.0,  is_buy=True),  # high price, low qty
        ]
        for t in trades:
            state.trades.append(t)
            VWAP.update_vwap(state, t)
        # vwap = (100*10 + 200*1) / (10+1) = 1200/11 ≈ 109.09
        assert state.vwap == pytest.approx(1200 / 11, rel=1e-4)

    def test_vwap_updates_incrementally(self):
        state = make_state()
        t1 = make_trade(100, 2.0, is_buy=True)
        state.trades.append(t1)
        VWAP.update_vwap(state, t1)
        assert state.vwap == pytest.approx(100.0)

        t2 = make_trade(200, 2.0, is_buy=True)
        state.trades.append(t2)
        VWAP.update_vwap(state, t2)
        assert state.vwap == pytest.approx(150.0)


class TestVWAPZone:
    def _build_state_with_vwap(
        self, vwap: float, std: float, spot: float
    ) -> SymbolState:
        state = make_state()
        state.vwap     = vwap
        state.vwap_std = std
        state.spot_price = spot
        return state

    def test_premium_zone_above_vwap_plus_std(self):
        state = self._build_state_with_vwap(100, 5, spot=106)
        assert VWAP.vwap_zone(state) == "PREMIUM"

    def test_discount_zone_below_vwap_minus_std(self):
        state = self._build_state_with_vwap(100, 5, spot=94)
        assert VWAP.vwap_zone(state) == "DISCOUNT"

    def test_equilibrium_inside_std_bands(self):
        state = self._build_state_with_vwap(100, 5, spot=102)
        assert VWAP.vwap_zone(state) == "EQUILIBRIUM"

    def test_returns_equilibrium_when_vwap_zero(self):
        state = make_state()
        assert VWAP.vwap_zone(state) == "EQUILIBRIUM"

    def test_vwap_pct_positive_above_vwap(self):
        state = self._build_state_with_vwap(100, 5, spot=105)
        assert VWAP.vwap_pct(state) == pytest.approx(5.0)

    def test_vwap_pct_negative_below_vwap(self):
        state = self._build_state_with_vwap(100, 5, spot=90)
        assert VWAP.vwap_pct(state) == pytest.approx(-10.0)

    def test_vwap_pct_zero_when_at_vwap(self):
        state = self._build_state_with_vwap(100, 5, spot=100)
        assert VWAP.vwap_pct(state) == pytest.approx(0.0)

    def test_vwap_pct_zero_when_vwap_unset(self):
        state = make_state()
        assert VWAP.vwap_pct(state) == 0.0


# ═══════════════════════════════════════════════════════════════════════════════
# ORDER BOOK ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

def _book(bids: list[tuple], asks: list[tuple]) -> tuple[list, list]:
    return (
        [[str(p), str(s)] for p, s in bids],
        [[str(p), str(s)] for p, s in asks],
    )


class TestOrderBookImbalance:
    def test_bid_heavy_gives_imbalance_above_half(self):
        state = make_state()
        bids, asks = _book(
            [(100, 100), (99, 80)],   # large bid
            [(101, 5),  (102, 5)],    # tiny ask
        )
        OB.update_order_book(state, bids, asks)
        assert state.bid_imbalance > 0.5

    def test_ask_heavy_gives_imbalance_below_half(self):
        state = make_state()
        bids, asks = _book(
            [(100, 5),  (99, 5)],
            [(101, 100), (102, 80)],
        )
        OB.update_order_book(state, bids, asks)
        assert state.bid_imbalance < 0.5

    def test_equal_sides_near_half(self):
        state = make_state()
        bids, asks = _book([(100, 50)], [(101, 50)])
        OB.update_order_book(state, bids, asks)
        assert state.bid_imbalance == pytest.approx(
            (50 * 100) / (50 * 100 + 50 * 101), rel=1e-4
        )

    def test_book_pressure_positive_when_bid_heavy(self):
        state = make_state()
        bids, asks = _book([(100, 100)], [(101, 1)])
        OB.update_order_book(state, bids, asks)
        assert state.book_pressure > 0

    def test_book_pressure_negative_when_ask_heavy(self):
        state = make_state()
        bids, asks = _book([(100, 1)], [(101, 100)])
        OB.update_order_book(state, bids, asks)
        assert state.book_pressure < 0

    def test_empty_book_gives_neutral_imbalance(self):
        state = make_state()
        OB.update_order_book(state, [], [])
        assert state.bid_imbalance == pytest.approx(0.5)

    def test_zero_size_entries_excluded(self):
        state = make_state()
        bids, asks = _book([(100, 0), (99, 50)], [(101, 0), (102, 50)])
        OB.update_order_book(state, bids, asks)
        assert 99  in state.bids
        assert 100 not in state.bids
        assert 102 in state.asks
        assert 101 not in state.asks


class TestIcebergDetection:
    def test_no_iceberg_on_first_snapshot(self):
        state = make_state()
        bids, asks = _book([(100, 50)], [(101, 50)])
        OB.update_order_book(state, bids, asks)
        detected, _ = OB.iceberg_bid_level(state)
        assert not detected

    def test_iceberg_bid_detected_after_replenishments(self):
        """
        Iceberg pattern: level gets partially consumed (size drops), then
        replenished (size grows ≥ 20%).  We need ICEBERG_REFRESH cycles.
        """
        state = make_state()
        asks1 = _book([], [(101, 5)])[1]

        # Seed initial level
        OB.update_order_book(state, _book([(100, 50)], [(101, 5)])[0], asks1)

        # Alternate: consumption (size drops) → replenishment (size grows)
        for _ in range(OB.ICEBERG_REFRESH):
            OB.update_order_book(state, _book([(100, 30)], [(101, 5)])[0], asks1)  # drop
            OB.update_order_book(state, _book([(100, 80)], [(101, 5)])[0], asks1)  # grow (80≥30×1.2)

        detected, price = OB.iceberg_bid_level(state)
        assert detected, f"Iceberg not detected; counts={state.bid_refresh_counts}"
        assert price == pytest.approx(100.0)

    def test_iceberg_ask_detected_after_replenishments(self):
        state = make_state()
        bids1 = _book([(99, 5)], [])[0]

        OB.update_order_book(state, bids1, _book([], [(101, 50)])[1])

        for _ in range(OB.ICEBERG_REFRESH):
            OB.update_order_book(state, bids1, _book([], [(101, 30)])[1])  # drop
            OB.update_order_book(state, bids1, _book([], [(101, 80)])[1])  # grow

        detected, price = OB.iceberg_ask_level(state)
        assert detected, f"Iceberg ask not detected; counts={state.ask_refresh_counts}"
        assert price == pytest.approx(101.0)

    def test_iceberg_cleared_when_level_leaves_book(self):
        state = make_state()
        bids1, asks1 = _book([(100, 50)], [(101, 5)])
        OB.update_order_book(state, bids1, asks1)

        for _ in range(OB.ICEBERG_REFRESH + 1):
            OB.update_order_book(state, bids1, asks1)

        # Level disappears
        OB.update_order_book(state, [], asks1)
        detected, _ = OB.iceberg_bid_level(state)
        assert not detected

    def test_no_iceberg_for_slowly_growing_level(self):
        state = make_state()
        bids, asks = _book([(100, 50)], [(101, 5)])
        OB.update_order_book(state, bids, asks)

        # Size grows by only 5% — below _ICEBERG_GROWTH threshold
        for _ in range(OB.ICEBERG_REFRESH + 1):
            bids_slow, _ = _book([(100, 52)], [(101, 5)])  # 4% growth, not 20%
            OB.update_order_book(state, bids_slow, asks)

        # Verify iceberg count did not increment for the small growth
        count = state.bid_refresh_counts.get(100, 0)
        assert count < OB.ICEBERG_REFRESH


class TestSpoofDetection:
    def test_large_bid_vanish_triggers_spoof(self):
        state = make_state()
        # Snapshot 1: large bid wall
        bids1, asks1 = _book([(100, 600)], [(101, 5)])  # 600 * 100 = 60,000 USD
        OB.update_order_book(state, bids1, asks1)

        # Snapshot 2: bid wall gone (no trade executed at that level)
        OB.update_order_book(state, [], asks1)

        assert OB.spoof_bid_active(state)

    def test_small_bid_vanish_no_spoof(self):
        state = make_state()
        bids1, asks1 = _book([(100, 1)], [(101, 5)])  # only $100 USD
        OB.update_order_book(state, bids1, asks1)
        OB.update_order_book(state, [], asks1)
        assert not OB.spoof_bid_active(state)

    def test_large_ask_vanish_triggers_spoof(self):
        state = make_state()
        bids1, asks1 = _book([(99, 5)], [(100, 600)])
        OB.update_order_book(state, bids1, asks1)
        OB.update_order_book(state, bids1, [])
        assert OB.spoof_ask_active(state)

    def test_spoof_expires_after_ttl(self):
        state = make_state()
        # Trigger a spoof event: large bid (600*100 = 60k >= 50k threshold) vanishes
        OB.update_order_book(state, _book([(100, 600)], [(101, 5)])[0], _book([], [(101, 5)])[1])
        OB.update_order_book(state, [],                                  _book([], [(101, 5)])[1])
        assert OB.spoof_bid_active(state), "Spoof should be active before expiry"

        # Backdate all events past the TTL
        for ev in state.spoof_events:
            ev["ts"] = time.time() - (OB.SPOOF_TTL_S + 1)

        # Next update triggers expiry cleanup in _detect_spoofing
        OB.update_order_book(state, [], _book([], [(101, 5)])[1])
        assert not OB.spoof_bid_active(state), "Spoof should have expired"
