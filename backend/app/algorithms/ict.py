"""
ICT / Smart Money Concepts engine.

Detects:
  - Liquidity sweeps (stop hunts above highs / below lows)
  - Order blocks (last opposing candle before an impulsive move)
  - Fair Value Gaps (FVGs / imbalances)
  - Breaker blocks (failed order blocks that flip bias)
  - BOS / CHoCH (break of structure / change of character)
"""
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

import numpy as np
import pandas as pd


class ICTPattern(str, Enum):
    SWEEP_AND_REVERSE   = "sweep_and_reverse"
    ORDER_BLOCK_LONG    = "order_block_long"
    ORDER_BLOCK_SHORT   = "order_block_short"
    FVG_FILL_LONG       = "fvg_fill_long"
    FVG_FILL_SHORT      = "fvg_fill_short"
    BREAKER_LONG        = "breaker_long"
    BREAKER_SHORT       = "breaker_short"
    BOS_LONG            = "bos_long"
    BOS_SHORT           = "bos_short"
    CHOCH_LONG          = "choch_long"
    CHOCH_SHORT         = "choch_short"


@dataclass
class ICTSetup:
    symbol: str
    timeframe: str
    pattern: ICTPattern
    direction: str          # LONG | SHORT
    signal_time: datetime
    price: float
    sweep_high: float | None = None
    sweep_low: float | None = None
    order_block_top: float | None = None
    order_block_bottom: float | None = None
    fvg_top: float | None = None
    fvg_bottom: float | None = None
    structure_level: float | None = None
    quality: float = 0.0    # 0..1


class ICTEngine:
    """
    Runs multiple ICT pattern detectors on OHLCV data and returns
    all valid setups found at the current bar.
    """

    def __init__(
        self,
        swing_lookback: int = 20,
        sweep_buffer_pct: float = 0.002,
        fvg_min_gap_pct: float = 0.001,
        ob_lookback: int = 5,
    ) -> None:
        self.swing_lookback = swing_lookback
        self.sweep_buffer = sweep_buffer_pct
        self.fvg_min_gap = fvg_min_gap_pct
        self.ob_lookback = ob_lookback

    # ── public ────────────────────────────────────────────────────────────────

    def scan(self, symbol: str, timeframe: str, df: pd.DataFrame) -> list[ICTSetup]:
        if len(df) < self.swing_lookback + 10:
            return []

        df = df.copy().reset_index(drop=True)
        setups: list[ICTSetup] = []

        setups.extend(self._detect_sweeps(symbol, timeframe, df))
        setups.extend(self._detect_order_blocks(symbol, timeframe, df))
        setups.extend(self._detect_fvg(symbol, timeframe, df))
        setups.extend(self._detect_bos_choch(symbol, timeframe, df))

        return setups

    # ── sweeps ────────────────────────────────────────────────────────────────

    def _detect_sweeps(self, symbol: str, tf: str, df: pd.DataFrame) -> list[ICTSetup]:
        results = []
        lb = self.swing_lookback
        last = df.iloc[-1]
        window = df.iloc[-(lb + 1):-1]

        swing_high = window["high"].max()
        swing_low = window["low"].min()

        swept_high = last["high"] > swing_high * (1 + self.sweep_buffer)
        swept_low = last["low"] < swing_low * (1 - self.sweep_buffer)

        # Bearish sweep (hunt highs then reverse short)
        if swept_high and last["close"] < last["open"]:
            quality = min(1.0, (last["high"] - swing_high) / swing_high * 500)
            results.append(ICTSetup(
                symbol=symbol, timeframe=tf,
                pattern=ICTPattern.SWEEP_AND_REVERSE,
                direction="SHORT",
                signal_time=_ts(last),
                price=float(last["close"]),
                sweep_high=float(last["high"]),
                quality=float(quality),
            ))

        # Bullish sweep (hunt lows then reverse long)
        if swept_low and last["close"] > last["open"]:
            quality = min(1.0, (swing_low - last["low"]) / swing_low * 500)
            results.append(ICTSetup(
                symbol=symbol, timeframe=tf,
                pattern=ICTPattern.SWEEP_AND_REVERSE,
                direction="LONG",
                signal_time=_ts(last),
                price=float(last["close"]),
                sweep_low=float(last["low"]),
                quality=float(quality),
            ))

        return results

    # ── order blocks ──────────────────────────────────────────────────────────

    def _detect_order_blocks(self, symbol: str, tf: str, df: pd.DataFrame) -> list[ICTSetup]:
        results = []
        if len(df) < self.ob_lookback + 3:
            return results

        last_close = df["close"].iloc[-1]
        last_open  = df["open"].iloc[-1]
        last_time  = _ts(df.iloc[-1])

        # Look back for the last bearish candle before bullish impulse → bullish OB
        for i in range(2, self.ob_lookback + 2):
            idx = len(df) - i
            if idx < 1:
                break
            bar = df.iloc[idx]
            prev_bar = df.iloc[idx - 1]

            # Bullish OB: last red candle before a strong green impulse
            if (bar["close"] < bar["open"]  # red
                    and df["close"].iloc[idx + 1] > bar["high"]  # impulse above
                    and last_close > bar["low"]                   # price in OB zone
                    and last_close < bar["high"]):
                quality = (bar["open"] - bar["close"]) / bar["open"]
                results.append(ICTSetup(
                    symbol=symbol, timeframe=tf,
                    pattern=ICTPattern.ORDER_BLOCK_LONG,
                    direction="LONG",
                    signal_time=last_time,
                    price=float(last_close),
                    order_block_top=float(bar["open"]),
                    order_block_bottom=float(bar["close"]),
                    quality=min(1.0, float(quality) * 20),
                ))
                break

            # Bearish OB: last green candle before strong red impulse
            if (bar["close"] > bar["open"]  # green
                    and df["close"].iloc[idx + 1] < bar["low"]   # impulse below
                    and last_close < bar["high"]
                    and last_close > bar["low"]):
                quality = (bar["close"] - bar["open"]) / bar["open"]
                results.append(ICTSetup(
                    symbol=symbol, timeframe=tf,
                    pattern=ICTPattern.ORDER_BLOCK_SHORT,
                    direction="SHORT",
                    signal_time=last_time,
                    price=float(last_close),
                    order_block_top=float(bar["close"]),
                    order_block_bottom=float(bar["open"]),
                    quality=min(1.0, float(quality) * 20),
                ))
                break

        return results

    # ── fair value gaps ───────────────────────────────────────────────────────

    def _detect_fvg(self, symbol: str, tf: str, df: pd.DataFrame) -> list[ICTSetup]:
        results = []
        last = df.iloc[-1]
        last_close = float(last["close"])
        last_time  = _ts(last)

        for i in range(1, min(30, len(df) - 2)):
            idx = len(df) - 1 - i
            a = df.iloc[idx - 1]
            b = df.iloc[idx]
            c = df.iloc[idx + 1]

            # Bullish FVG: gap between a.high and c.low (c.low > a.high)
            if c["low"] > a["high"]:
                gap_pct = (c["low"] - a["high"]) / a["high"]
                if gap_pct >= self.fvg_min_gap:
                    fvg_mid = (c["low"] + a["high"]) / 2
                    # Price returning into FVG from above = bullish entry
                    if a["high"] <= last_close <= c["low"]:
                        quality = min(1.0, gap_pct * 200)
                        results.append(ICTSetup(
                            symbol=symbol, timeframe=tf,
                            pattern=ICTPattern.FVG_FILL_LONG,
                            direction="LONG",
                            signal_time=last_time,
                            price=last_close,
                            fvg_top=float(c["low"]),
                            fvg_bottom=float(a["high"]),
                            quality=float(quality),
                        ))

            # Bearish FVG: gap between a.low and c.high (a.low > c.high)
            if a["low"] > c["high"]:
                gap_pct = (a["low"] - c["high"]) / a["low"]
                if gap_pct >= self.fvg_min_gap:
                    if c["high"] <= last_close <= a["low"]:
                        quality = min(1.0, gap_pct * 200)
                        results.append(ICTSetup(
                            symbol=symbol, timeframe=tf,
                            pattern=ICTPattern.FVG_FILL_SHORT,
                            direction="SHORT",
                            signal_time=last_time,
                            price=last_close,
                            fvg_top=float(a["low"]),
                            fvg_bottom=float(c["high"]),
                            quality=float(quality),
                        ))

        return results[:3]  # cap to 3 most recent FVGs

    # ── BOS / CHoCH ───────────────────────────────────────────────────────────

    def _detect_bos_choch(self, symbol: str, tf: str, df: pd.DataFrame) -> list[ICTSetup]:
        results = []
        lb = self.swing_lookback
        last = df.iloc[-1]
        window_highs = df["high"].iloc[-(lb + 1):-1]
        window_lows  = df["low"].iloc[-(lb + 1):-1]

        prev_swing_high = window_highs.max()
        prev_swing_low  = window_lows.min()
        last_close = float(last["close"])
        last_time  = _ts(last)

        # BOS Long: price closes above previous swing high
        if last_close > prev_swing_high:
            results.append(ICTSetup(
                symbol=symbol, timeframe=tf,
                pattern=ICTPattern.BOS_LONG,
                direction="LONG",
                signal_time=last_time,
                price=last_close,
                structure_level=float(prev_swing_high),
                quality=min(1.0, (last_close - prev_swing_high) / prev_swing_high * 100),
            ))

        # BOS Short: price closes below previous swing low
        if last_close < prev_swing_low:
            results.append(ICTSetup(
                symbol=symbol, timeframe=tf,
                pattern=ICTPattern.BOS_SHORT,
                direction="SHORT",
                signal_time=last_time,
                price=last_close,
                structure_level=float(prev_swing_low),
                quality=min(1.0, (prev_swing_low - last_close) / prev_swing_low * 100),
            ))

        return results


def _ts(row: pd.Series) -> datetime:
    return pd.Timestamp(row["open_time"]).to_pydatetime()
