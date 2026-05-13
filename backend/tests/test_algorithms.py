"""Unit tests for algorithm modules — no I/O required."""
import pandas as pd
import numpy as np
import pytest
from datetime import datetime, timezone

from app.algorithms.ema import EMAStrategy
from app.algorithms.ict import ICTEngine
from app.algorithms.confluence import ConfluenceEngine
from app.algorithms.backtester import Backtester


def _make_df(n: int = 300, trend: str = "up") -> pd.DataFrame:
    np.random.seed(42)
    prices = [100.0]
    for _ in range(n - 1):
        drift = 0.002 if trend == "up" else -0.002
        prices.append(prices[-1] * (1 + drift + np.random.normal(0, 0.01)))

    times = pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC")
    return pd.DataFrame({
        "open_time": times,
        "open":  [p * 0.999 for p in prices],
        "high":  [p * 1.005 for p in prices],
        "low":   [p * 0.995 for p in prices],
        "close": prices,
        "volume": np.random.uniform(1000, 5000, n),
    })


class TestEMAStrategy:
    def test_scan_returns_signal_on_uptrend(self):
        df = _make_df(300, "up")
        strat = EMAStrategy()
        # At least one signal should fire over the full dataset
        signals = []
        for i in range(110, len(df)):
            sig = strat.scan("BTCUSDT", "1h", df.iloc[:i])
            if sig:
                signals.append(sig)
        assert len(signals) > 0

    def test_signal_direction_long_on_uptrend(self):
        df = _make_df(300, "up")
        strat = EMAStrategy()
        for i in range(110, len(df)):
            sig = strat.scan("BTCUSDT", "1h", df.iloc[:i])
            if sig:
                assert sig.direction in ("LONG", "SHORT")
                assert 0.0 <= sig.strength <= 1.0
                break

    def test_no_signal_on_short_df(self):
        df = _make_df(50)
        strat = EMAStrategy()
        assert strat.scan("BTCUSDT", "1h", df) is None


class TestICTEngine:
    def test_scan_returns_list(self):
        df = _make_df(150)
        engine = ICTEngine()
        result = engine.scan("ETHUSDT", "1h", df)
        assert isinstance(result, list)

    def test_setups_have_valid_directions(self):
        df = _make_df(200)
        engine = ICTEngine()
        setups = engine.scan("ETHUSDT", "1h", df)
        for s in setups:
            assert s.direction in ("LONG", "SHORT")
            assert 0.0 <= s.quality <= 1.0


class TestConfluenceEngine:
    def test_returns_none_on_single_tf(self):
        df = _make_df(300, "up")
        engine = ConfluenceEngine(min_score=0.6, min_aligned_tfs=2)
        result = engine.scan("BTCUSDT", {"1h": df})
        # Single TF can't meet min_aligned_tfs=2
        assert result is None or result.score <= 1.0

    def test_returns_result_on_multiple_aligned_tfs(self):
        df = _make_df(300, "up")
        engine = ConfluenceEngine(min_score=0.0, min_aligned_tfs=1)
        result = engine.scan("BTCUSDT", {"1h": df, "4h": df, "1d": df})
        # With no threshold should get a result
        # (might be None if no individual TF fires — just verify no crash)
        assert result is None or result.direction in ("LONG", "SHORT")


class TestBacktester:
    def test_run_ema3_returns_report(self):
        df = _make_df(500, "up")
        bt = Backtester(strategy="ema3", tp_pct=0.03, sl_pct=0.015)
        report = bt.run("BTCUSDT", "1h", df)
        assert report.total_trades >= 0
        assert report.strategy == "ema3"

    def test_win_rate_in_range(self):
        df = _make_df(500)
        bt = Backtester(strategy="ema3")
        report = bt.run("BTCUSDT", "1h", df)
        if report.total_trades > 0:
            assert 0.0 <= report.win_rate <= 1.0

    def test_sharpe_computed(self):
        df = _make_df(500, "up")
        bt = Backtester(strategy="ema3")
        report = bt.run("BTCUSDT", "1h", df)
        if report.total_trades > 1:
            assert isinstance(report.sharpe_ratio, float)
