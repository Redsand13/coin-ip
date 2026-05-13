"""Triple-EMA crossover strategy (7/25/99)."""
from dataclasses import dataclass
from datetime import datetime

import numpy as np
import pandas as pd


@dataclass
class EMASignal:
    symbol: str
    direction: str           # LONG | SHORT
    timeframe: str
    signal_time: datetime
    price: float
    ema_fast: float
    ema_mid: float
    ema_slow: float
    volume: float | None = None
    strength: float = 0.0    # 0..1 — how cleanly separated the EMAs are


def _ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


class EMAStrategy:
    """
    Fires a signal when:
      LONG : ema_fast > ema_mid > ema_slow  (bullish alignment)
             AND the previous bar had ema_fast <= ema_mid  (fresh cross)
      SHORT: ema_fast < ema_mid < ema_slow
             AND the previous bar had ema_fast >= ema_mid

    Strength = (ema_fast - ema_slow) / ema_slow * 100  (normalised 0..1 via tanh)
    """

    def __init__(self, fast: int = 7, mid: int = 25, slow: int = 99) -> None:
        self.fast = fast
        self.mid = mid
        self.slow = slow

    # ── public API ────────────────────────────────────────────────────────────

    def scan(
        self,
        symbol: str,
        timeframe: str,
        df: pd.DataFrame,
    ) -> EMASignal | None:
        """
        df must have columns: open_time, open, high, low, close, volume
        Returns the latest signal or None.
        """
        if len(df) < self.slow + 5:
            return None

        df = df.copy().reset_index(drop=True)
        df["ema_fast"] = _ema(df["close"], self.fast)
        df["ema_mid"] = _ema(df["close"], self.mid)
        df["ema_slow"] = _ema(df["close"], self.slow)

        last = df.iloc[-1]
        prev = df.iloc[-2]

        direction = self._detect_cross(last, prev)
        if direction is None:
            return None

        spread = abs(last["ema_fast"] - last["ema_slow"]) / last["ema_slow"]
        strength = float(np.tanh(spread * 50))  # saturates at ~2% spread → strength ~1

        return EMASignal(
            symbol=symbol,
            direction=direction,
            timeframe=timeframe,
            signal_time=pd.Timestamp(last["open_time"]).to_pydatetime(),
            price=float(last["close"]),
            ema_fast=float(last["ema_fast"]),
            ema_mid=float(last["ema_mid"]),
            ema_slow=float(last["ema_slow"]),
            volume=float(last["volume"]) if "volume" in last else None,
            strength=strength,
        )

    def scan_all_timeframes(
        self,
        symbol: str,
        candles_by_tf: dict[str, pd.DataFrame],
    ) -> list[EMASignal]:
        results = []
        for tf, df in candles_by_tf.items():
            sig = self.scan(symbol, tf, df)
            if sig:
                results.append(sig)
        return results

    # ── helpers ───────────────────────────────────────────────────────────────

    def _detect_cross(self, last: pd.Series, prev: pd.Series) -> str | None:
        bullish_now = last["ema_fast"] > last["ema_mid"] > last["ema_slow"]
        bearish_now = last["ema_fast"] < last["ema_mid"] < last["ema_slow"]
        was_not_bullish = prev["ema_fast"] <= prev["ema_mid"]
        was_not_bearish = prev["ema_fast"] >= prev["ema_mid"]

        if bullish_now and was_not_bullish:
            return "LONG"
        if bearish_now and was_not_bearish:
            return "SHORT"
        return None
