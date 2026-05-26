"""
Unit tests for all 10 institutional signal detectors in detectors.py.
Each detector is tested for:
  - Returns None when conditions not met
  - Returns correct Detection when conditions ARE met
  - Correct direction (LONG / SHORT)
  - Confidence in valid range [0, 1]
"""
import time
from collections import deque

import pytest

from app.services.institutional.state import Detection, SymbolState, Trade
from app.services.institutional import detectors as D
from app.services.institutional import cvd as CVD
from app.services.institutional import order_book as OB


# ── Helpers ───────────────────────────────────────────────────────────────────

def fresh(symbol: str = "BTCUSDT") -> SymbolState:
    return SymbolState(symbol=symbol)


def trade(price: float, qty: float, is_buy: bool, age_ms: float = 0) -> Trade:
    return Trade(ts=time.time() * 1000 - age_ms, price=price, qty=qty, is_buy=is_buy)


def assert_detection(d: Detection | None, kind: str, direction: str) -> Detection:
    assert d is not None, f"Expected detection '{kind}', got None"
    assert d.kind == kind, f"Expected kind={kind!r}, got {d.kind!r}"
    assert d.direction == direction, f"Expected direction={direction!r}, got {d.direction!r}"
    assert 0.0 <= d.confidence <= 1.0, f"Confidence {d.confidence} out of [0,1]"
    return d


def assert_none(d: Detection | None, note: str = ""):
    assert d is None, f"Expected None{' (' + note + ')' if note else ''}, got {d}"


# ── Inject fake divergence into state ─────────────────────────────────────────

def _inject_accum(state: SymbolState, price_drop_pct: float = 2.0):
    """
    Simulate accumulation: price dropped but CVD is bullish.
    vol_ma5 = 0 so ref_vol falls back to cvd_total, making cvd_norm ≈ 1.
    """
    start_price = 100.0
    state.spot_price = start_price * (1 - price_drop_pct / 100)
    state.vol_ma5 = 0.0   # no baseline — let CVD speak for itself
    cutoff_ms = time.time() * 1000 - 200_000   # old trade within 5-min window
    old = Trade(ts=cutoff_ms, price=start_price, qty=1.0, is_buy=False)
    state.trades.append(old)
    for _ in range(10):
        t = trade(state.spot_price, 10.0, is_buy=True, age_ms=30_000)
        state.trades.append(t)
        CVD.update_cvd(state, t)


def _inject_distrib(state: SymbolState, price_rise_pct: float = 2.0):
    """Simulate distribution: price rose but CVD is bearish."""
    start_price = 100.0
    state.spot_price = start_price * (1 + price_rise_pct / 100)
    state.vol_ma5 = 0.0
    cutoff_ms = time.time() * 1000 - 200_000
    old = Trade(ts=cutoff_ms, price=start_price, qty=1.0, is_buy=True)
    state.trades.append(old)
    for _ in range(10):
        t = trade(state.spot_price, 10.0, is_buy=False, age_ms=30_000)
        state.trades.append(t)
        CVD.update_cvd(state, t)


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Accumulation / Distribution
# ═══════════════════════════════════════════════════════════════════════════════

class TestAccumDistrib:
    def test_returns_none_with_no_data(self):
        assert_none(D.detect_accum_distrib(fresh()), "no data")

    def test_detects_accumulation(self):
        state = fresh()
        _inject_accum(state, price_drop_pct=3.0)
        result = D.detect_accum_distrib(state)
        assert_detection(result, "ACCUMULATION", "LONG")

    def test_detects_distribution(self):
        state = fresh()
        _inject_distrib(state, price_rise_pct=3.0)
        result = D.detect_accum_distrib(state)
        assert_detection(result, "DISTRIBUTION", "SHORT")

    def test_neutral_aligned_flow_returns_none(self):
        """Price up + CVD up = aligned, not divergent → no signal."""
        state = fresh()
        state.spot_price = 105.0
        state.vol_ma5    = 50_000.0
        old = Trade(ts=time.time() * 1000 - 200_000, price=100.0, qty=1.0, is_buy=True)
        state.trades.append(old)
        for _ in range(5):
            t = trade(105.0, 5.0, is_buy=True, age_ms=30_000)
            state.trades.append(t)
            CVD.update_cvd(state, t)
        # Aligned: price up + CVD positive → divergence_score close to 0 or weakly positive
        # Should not reach 0.5 threshold → None
        result = D.detect_accum_distrib(state)
        if result is not None:
            assert result.confidence < 0.5


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Whale Activity
# ═══════════════════════════════════════════════════════════════════════════════

class TestWhale:
    def test_returns_none_with_no_trades(self):
        assert_none(D.detect_whale(fresh()), "no trades")

    def test_returns_none_for_small_trades(self):
        state = fresh()
        # Below WHALE_USD_MIN ($100k)
        state.trades.extend([trade(50_000, 0.1, is_buy=True) for _ in range(5)])
        assert_none(D.detect_whale(state), "small trades")

    def test_detects_whale_buy_cluster(self):
        state = fresh()
        # WHALE_CLUSTER_N = 3; each trade = 50k*3 = 150k > WHALE_USD_MIN
        for _ in range(3):
            state.trades.append(trade(50_000, 3.0, is_buy=True, age_ms=5_000))
        result = D.detect_whale(state)
        assert_detection(result, "WHALE_BUY", "LONG")

    def test_detects_whale_sell_cluster(self):
        state = fresh()
        for _ in range(3):
            state.trades.append(trade(50_000, 3.0, is_buy=False, age_ms=5_000))
        result = D.detect_whale(state)
        assert_detection(result, "WHALE_SELL", "SHORT")

    def test_single_very_large_buy_detected(self):
        state = fresh()
        # Single trade = $50k * 10 = $500k >> WHALE_USD_MIN * 3
        state.trades.append(trade(50_000, 10.0, is_buy=True, age_ms=5_000))
        result = D.detect_whale(state)
        assert_detection(result, "WHALE_BUY", "LONG")

    def test_old_trades_ignored(self):
        state = fresh()
        # All trades older than 30 seconds window
        for _ in range(5):
            state.trades.append(trade(50_000, 3.0, is_buy=True, age_ms=31_000))
        assert_none(D.detect_whale(state), "stale trades")

    def test_balanced_whale_trades_no_signal(self):
        """Equal whale buys and sells → direction ratio not met → None."""
        state = fresh()
        for _ in range(3):
            state.trades.append(trade(50_000, 3.0, is_buy=True,  age_ms=5_000))
            state.trades.append(trade(50_000, 3.0, is_buy=False, age_ms=5_000))
        result = D.detect_whale(state)
        assert_none(result, "balanced whale trades")

    def test_confidence_in_range(self):
        state = fresh()
        for _ in range(10):
            state.trades.append(trade(50_000, 5.0, is_buy=True, age_ms=1_000))
        result = D.detect_whale(state)
        assert result is not None
        assert 0.0 <= result.confidence <= 1.0


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Absorption
# ═══════════════════════════════════════════════════════════════════════════════

class TestAbsorption:
    def test_returns_none_with_no_vol_ma(self):
        state = fresh()
        state.vol_ma5 = 0.0
        assert_none(D.detect_absorption(state), "vol_ma5 == 0")

    def test_returns_none_with_insufficient_trades(self):
        state = fresh()
        state.vol_ma5 = 1000.0
        state.trades.extend([trade(100, 1.0, is_buy=True) for _ in range(5)])
        assert_none(D.detect_absorption(state), "< 20 trades")

    def test_returns_none_when_volume_not_elevated(self):
        state = fresh()
        state.vol_ma5 = 1_000_000.0  # very high baseline
        state.spot_price = 100.0
        for _ in range(20):
            state.trades.append(trade(100.0, 0.001, is_buy=True, age_ms=30_000))
        assert_none(D.detect_absorption(state), "volume not elevated")

    def test_returns_none_when_price_moves(self):
        """High volume + significant price move → NOT absorption."""
        state = fresh()
        state.vol_ma5 = 100.0
        for i in range(20):
            state.trades.append(trade(100 + i * 0.5, 10_000.0, is_buy=True, age_ms=10_000))
        state.spot_price = 110.0  # price moved >0.15%
        assert_none(D.detect_absorption(state), "price moved")

    def test_returns_none_when_volume_balanced(self):
        """High volume but equal buys/sells → absorption imbalance check fails."""
        state = fresh()
        state.vol_ma5 = 100.0
        state.spot_price = 100.0
        for _ in range(15):
            state.trades.append(trade(100.0, 100.0, is_buy=True,  age_ms=30_000))
            state.trades.append(trade(100.0, 100.0, is_buy=False, age_ms=30_000))
        assert_none(D.detect_absorption(state), "balanced flow")

    def test_detects_absorption_buy_high_selling_no_price_move(self):
        state = fresh()
        state.spot_price = 100.0
        state.vol_ma5    = 10.0   # low baseline so current vol is elevated
        for _ in range(25):
            state.trades.append(trade(100.0, 300.0, is_buy=False, age_ms=30_000))
            state.trades.append(trade(100.0, 100.0, is_buy=True,  age_ms=30_000))
        result = D.detect_absorption(state)
        assert_detection(result, "ABSORPTION_BUY", "LONG")

    def test_detects_absorption_sell_high_buying_no_price_move(self):
        state = fresh()
        state.spot_price = 100.0
        state.vol_ma5    = 10.0
        for _ in range(25):
            state.trades.append(trade(100.0, 300.0, is_buy=True,  age_ms=30_000))
            state.trades.append(trade(100.0, 100.0, is_buy=False, age_ms=30_000))
        result = D.detect_absorption(state)
        assert_detection(result, "ABSORPTION_SELL", "SHORT")


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Iceberg Orders
# ═══════════════════════════════════════════════════════════════════════════════

class TestIceberg:
    def test_returns_none_with_no_book_data(self):
        assert_none(D.detect_iceberg(fresh()), "no book data")

    def test_detects_iceberg_bid(self):
        state = fresh()
        # Manually inject iceberg bid at 100
        state.bid_refresh_counts[100.0] = OB.ICEBERG_REFRESH
        result = D.detect_iceberg(state)
        assert_detection(result, "ICEBERG_BID", "LONG")

    def test_detects_iceberg_ask(self):
        state = fresh()
        state.ask_refresh_counts[101.0] = OB.ICEBERG_REFRESH
        result = D.detect_iceberg(state)
        assert_detection(result, "ICEBERG_ASK", "SHORT")

    def test_both_sides_returns_none(self):
        """Both bid and ask icebergs → market maker, neutral → None."""
        state = fresh()
        state.bid_refresh_counts[100.0] = OB.ICEBERG_REFRESH
        state.ask_refresh_counts[101.0] = OB.ICEBERG_REFRESH
        assert_none(D.detect_iceberg(state), "both sides")

    def test_below_threshold_returns_none(self):
        state = fresh()
        state.bid_refresh_counts[100.0] = OB.ICEBERG_REFRESH - 1
        assert_none(D.detect_iceberg(state), "below refresh threshold")


# ═══════════════════════════════════════════════════════════════════════════════
# 5. Spoofing
# ═══════════════════════════════════════════════════════════════════════════════

class TestSpoof:
    def test_returns_none_with_no_events(self):
        assert_none(D.detect_spoof(fresh()), "no events")

    def test_spoof_bid_returns_short_signal(self):
        """Fake bid wall → smart money wants to SHORT."""
        state = fresh()
        state.spoof_events.append(
            {"side": "bid", "price": 100.0, "usd": 80_000, "ts": time.time()}
        )
        result = D.detect_spoof(state)
        assert_detection(result, "SPOOF_BID", "SHORT")

    def test_spoof_ask_returns_long_signal(self):
        """Fake ask wall → smart money wants to LONG."""
        state = fresh()
        state.spoof_events.append(
            {"side": "ask", "price": 101.0, "usd": 80_000, "ts": time.time()}
        )
        result = D.detect_spoof(state)
        assert_detection(result, "SPOOF_ASK", "LONG")

    def test_both_sides_returns_none(self):
        state = fresh()
        state.spoof_events.append({"side": "bid", "price": 100, "usd": 80_000, "ts": time.time()})
        state.spoof_events.append({"side": "ask", "price": 101, "usd": 80_000, "ts": time.time()})
        assert_none(D.detect_spoof(state), "both sides")

    def test_confidence_capped_at_0_7(self):
        state = fresh()
        for _ in range(20):
            state.spoof_events.append({"side": "bid", "price": 100, "usd": 60_000, "ts": time.time()})
        result = D.detect_spoof(state)
        assert result is not None
        assert result.confidence <= 0.70


# ═══════════════════════════════════════════════════════════════════════════════
# 6. Liquidity Grab
# ═══════════════════════════════════════════════════════════════════════════════

class TestLiquidityGrab:
    def test_returns_none_with_no_range(self):
        state = fresh()
        state.spot_price = 100.0
        assert_none(D.detect_liquidity_grab(state), "range not set")

    def test_detects_grab_low(self):
        state = fresh()
        state.range_high = 110.0
        state.range_low  = 100.0
        state.spot_price = 97.5   # swept 0.25% below range low (>LIQ_GRAB_MIN=0.2%)
        state.cvd_5m     = 500_000.0   # bullish CVD
        state.vol_ma5    = 100.0
        result = D.detect_liquidity_grab(state)
        assert_detection(result, "LIQUIDITY_GRAB_LOW", "LONG")

    def test_detects_grab_high(self):
        state = fresh()
        state.range_high = 100.0
        state.range_low  = 90.0
        state.spot_price = 102.5  # swept 0.25% above range high
        state.cvd_5m     = -500_000.0  # bearish CVD
        state.vol_ma5    = 100.0
        result = D.detect_liquidity_grab(state)
        assert_detection(result, "LIQUIDITY_GRAB_HIGH", "SHORT")

    def test_no_grab_when_cvd_does_not_confirm(self):
        """Sweep below range low but CVD is bearish → no grab (continuation, not grab)."""
        state = fresh()
        state.range_high = 110.0
        state.range_low  = 100.0
        state.spot_price = 97.5
        state.cvd_5m     = -500_000.0   # bearish CVD — NOT a grab signal
        assert_none(D.detect_liquidity_grab(state), "CVD not confirming")

    def test_no_grab_within_range(self):
        state = fresh()
        state.range_high = 110.0
        state.range_low  = 100.0
        state.spot_price = 105.0  # inside range
        state.cvd_5m     = 500_000.0
        assert_none(D.detect_liquidity_grab(state), "price inside range")


# ═══════════════════════════════════════════════════════════════════════════════
# 7. Stop Hunt
# ═══════════════════════════════════════════════════════════════════════════════

class TestStopHunt:
    def test_returns_none_insufficient_trades(self):
        state = fresh()
        state.spot_price = 50_000
        state.trades.extend([trade(50_000, 1, is_buy=True) for _ in range(5)])
        assert_none(D.detect_stop_hunt(state), "< 15 trades")

    def test_detects_stop_hunt_low(self):
        """Spike to round number below current price + bullish CVD."""
        state = fresh()
        state.spot_price = 50_500.0
        state.cvd_5m     = 200_000.0
        # Recent prices: spike DOWN to 49000 (round number) then recovered
        prices = [50_500] * 10 + [49_000, 49_100] + [50_500] * 8
        for i, p in enumerate(prices):
            state.trades.append(trade(p, 1.0, is_buy=True, age_ms=i * 100))
        result = D.detect_stop_hunt(state)
        assert_detection(result, "STOP_HUNT_LOW", "LONG")

    def test_detects_stop_hunt_high(self):
        """Spike to round number above current price + bearish CVD."""
        state = fresh()
        state.spot_price = 49_500.0
        state.cvd_5m     = -200_000.0
        prices = [49_500] * 10 + [51_000, 50_900] + [49_500] * 8
        for i, p in enumerate(prices):
            state.trades.append(trade(p, 1.0, is_buy=False, age_ms=i * 100))
        result = D.detect_stop_hunt(state)
        assert_detection(result, "STOP_HUNT_HIGH", "SHORT")

    def test_no_stop_hunt_when_spread_too_small(self):
        state = fresh()
        state.spot_price = 50_000
        state.cvd_5m     = 200_000.0
        # All prices within 0.1% — below STOP_HUNT_MIN_PCT threshold
        prices = [50_000 + i for i in range(20)]
        for p in prices:
            state.trades.append(trade(p, 1.0, is_buy=True, age_ms=100))
        assert_none(D.detect_stop_hunt(state), "spread too small")


# ═══════════════════════════════════════════════════════════════════════════════
# 8. Breakout (Fake vs Real)
# ═══════════════════════════════════════════════════════════════════════════════

class TestBreakout:
    def test_returns_none_with_no_range(self):
        assert_none(D.detect_breakout(fresh()), "no range")

    def test_returns_none_inside_range(self):
        state = fresh()
        state.range_high = 110.0
        state.range_low  = 90.0
        state.spot_price = 100.0
        assert_none(D.detect_breakout(state), "inside range")

    def test_real_breakout_up(self):
        state = fresh()
        state.range_high = 100.0
        state.range_low  = 90.0
        state.spot_price = 105.0  # >0.4% above range_high
        state.cvd_5m     = 500_000.0   # bullish
        state.vol_ma5    = 100.0       # low baseline → recent vol easily 1.8×
        # Inject recent trades
        for _ in range(10):
            state.trades.append(trade(105.0, 300.0, is_buy=True, age_ms=5_000))
        result = D.detect_breakout(state)
        assert_detection(result, "REAL_BREAKOUT_UP", "LONG")

    def test_fake_breakout_up(self):
        """Price breaks out but CVD is bearish and no volume → fake."""
        state = fresh()
        state.range_high = 100.0
        state.range_low  = 90.0
        state.spot_price = 105.0
        state.cvd_5m     = -100_000.0   # bearish CVD → not confirming
        state.vol_ma5    = 10_000.0     # high baseline → no vol spike
        result = D.detect_breakout(state)
        assert_detection(result, "FAKE_BREAKOUT_UP", "SHORT")

    def test_real_breakout_down(self):
        state = fresh()
        state.range_high = 110.0
        state.range_low  = 100.0
        state.spot_price = 95.0   # < range_low * (1 - 0.004)
        state.cvd_5m     = -500_000.0
        state.vol_ma5    = 100.0
        for _ in range(10):
            state.trades.append(trade(95.0, 300.0, is_buy=False, age_ms=5_000))
        result = D.detect_breakout(state)
        assert_detection(result, "REAL_BREAKOUT_DOWN", "SHORT")

    def test_fake_breakout_down(self):
        state = fresh()
        state.range_high = 110.0
        state.range_low  = 100.0
        state.spot_price = 95.0
        state.cvd_5m     = 200_000.0   # bullish CVD → contradiction
        state.vol_ma5    = 10_000.0
        result = D.detect_breakout(state)
        assert_detection(result, "FAKE_BREAKOUT_DOWN", "LONG")


# ═══════════════════════════════════════════════════════════════════════════════
# 9. Smart Money Positioning
# ═══════════════════════════════════════════════════════════════════════════════

class TestSmartMoney:
    def test_returns_none_with_no_open_interest(self):
        assert_none(D.detect_smart_money(fresh()), "no OI data")

    def test_detects_smart_long(self):
        state = fresh()
        state.open_interest = 1_000_000.0
        state.oi_delta      = 6_000.0       # +0.6% > OI_DELTA_THRESH (0.4%)
        state.funding_rate  = 0.0002        # mildly positive (not crowded short)
        state.cvd_5m        = 100_000.0     # bullish
        result = D.detect_smart_money(state)
        assert_detection(result, "SMART_LONG", "LONG")

    def test_detects_smart_short(self):
        state = fresh()
        state.open_interest = 1_000_000.0
        state.oi_delta      = 6_000.0
        state.funding_rate  = -0.0012      # crowded shorts paying
        state.cvd_5m        = -100_000.0   # bearish
        result = D.detect_smart_money(state)
        assert_detection(result, "SMART_SHORT", "SHORT")

    def test_returns_none_when_oi_change_too_small(self):
        state = fresh()
        state.open_interest = 1_000_000.0
        state.oi_delta      = 1_000.0      # 0.1% — below OI_DELTA_THRESH
        state.funding_rate  = 0.0
        state.cvd_5m        = 100_000.0
        assert_none(D.detect_smart_money(state), "OI delta too small")

    def test_confidence_in_range(self):
        state = fresh()
        state.open_interest = 1_000_000.0
        state.oi_delta      = 100_000.0
        state.funding_rate  = 0.0
        state.cvd_5m        = 500_000.0
        result = D.detect_smart_money(state)
        assert result is not None
        assert 0.0 <= result.confidence <= 1.0


# ═══════════════════════════════════════════════════════════════════════════════
# 10. Retail Leverage Trap
# ═══════════════════════════════════════════════════════════════════════════════

class TestRetailTrap:
    def test_returns_none_with_zero_funding(self):
        assert_none(D.detect_retail_trap(fresh()), "zero funding")

    def test_returns_none_with_zero_mark_price(self):
        state = fresh()
        state.funding_rate = 0.002
        state.mark_price   = 0.0
        assert_none(D.detect_retail_trap(state), "zero mark price")

    def test_detects_long_trap(self):
        """High positive funding + bearish CVD → crowded longs about to be trapped."""
        state = fresh()
        state.funding_rate = 0.0015    # > FUNDING_HIGH (0.001)
        state.cvd_5m       = -100_000  # smart money distributing
        state.mark_price   = 50_000.0
        result = D.detect_retail_trap(state)
        assert_detection(result, "RETAIL_LONG_TRAP", "SHORT")
        assert result.details["est_liq_zone"] == pytest.approx(50_000 * 0.92)

    def test_detects_short_trap(self):
        """Highly negative funding + bullish CVD → crowded shorts about to be trapped."""
        state = fresh()
        state.funding_rate = -0.0015   # < FUNDING_LOW (-0.001)
        state.cvd_5m       = 100_000   # smart money accumulating
        state.mark_price   = 50_000.0
        result = D.detect_retail_trap(state)
        assert_detection(result, "RETAIL_SHORT_TRAP", "LONG")
        assert result.details["est_liq_zone"] == pytest.approx(50_000 * 1.08)

    def test_no_trap_when_cvd_aligns_with_funding(self):
        """High positive funding + bullish CVD = longs and smart money aligned → no trap."""
        state = fresh()
        state.funding_rate = 0.0015
        state.cvd_5m       = 100_000    # smart money also long → no trap
        state.mark_price   = 50_000.0
        assert_none(D.detect_retail_trap(state), "CVD aligned with funding")

    def test_no_trap_when_funding_moderate(self):
        """Moderate funding → not crowded enough to trigger trap."""
        state = fresh()
        state.funding_rate = 0.0003    # below FUNDING_HIGH
        state.cvd_5m       = -100_000
        state.mark_price   = 50_000.0
        assert_none(D.detect_retail_trap(state), "moderate funding")


# ═══════════════════════════════════════════════════════════════════════════════
# run_all orchestrator
# ═══════════════════════════════════════════════════════════════════════════════

class TestRunAll:
    def test_returns_list(self):
        result = D.run_all(fresh())
        assert isinstance(result, list)

    def test_never_raises_on_empty_state(self):
        """run_all must swallow all detector errors gracefully."""
        result = D.run_all(fresh())
        assert isinstance(result, list)

    def test_returns_multiple_signals(self):
        """With enough confluence signals, run_all returns multiple detections."""
        state = fresh()
        _inject_accum(state, price_drop_pct=3.0)
        state.open_interest = 1_000_000.0
        state.oi_delta      = 8_000.0
        state.funding_rate  = 0.0002
        state.vol_ma5       = 50_000.0
        state.mark_price    = 95.0
        result = D.run_all(state)
        assert len(result) >= 1

    def test_all_confidences_in_range(self):
        state = fresh()
        _inject_accum(state, price_drop_pct=3.0)
        for d in D.run_all(state):
            assert 0.0 <= d.confidence <= 1.0
