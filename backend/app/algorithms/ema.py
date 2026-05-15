"""Triple-EMA crossover strategy (7 / 25 / 99) with sideways-market filter.

Signal conditions — ALL must pass:

  LONG
  ─────
  1. Triple alignment  : EMA 7 > EMA 25 > EMA 99
  2. Fresh EMA-7/25 cross : within last CROSS_LOOKBACK (10) closed candles
  3. EMA-25/99 cross within MID_CROSS_LOOKBACK (30) closed candles
     → ensures the "fan" is newly opening, not a stale alignment
  4. All three EMAs rising : each EMA higher than 3 candles ago
  5. Price above EMA 7 : close > EMA 7 (price leading, not lagging)

  ── SIDEWAYS FILTER ──────────────────────────────────────────────────────
  6. ADX > ADX_MIN_TREND (20) : Average Directional Index confirms a trend
     is actually in progress.  In sideways / choppy markets ADX stays below
     20 — those candles generate lots of fake crossovers that quickly reverse.
  7. EMA spread ≥ SPREAD_MIN_PCT (0.3 %) : minimum distance between EMA 7
     and EMA 99 as a % of price.  A cross where all three EMAs are virtually
     on top of each other is not a real fan.

  SHORT — mirror of the above.

ADX(14) is computed here with Wilder-smoothing (standard definition):
  TR, +DM, −DM → Wilder-smooth(14) → +DI, −DI → DX → ADX.
"""
from dataclasses import dataclass
from datetime import datetime

import numpy as np
import pandas as pd


# ── Tunable constants ─────────────────────────────────────────────────────────

CROSS_LOOKBACK     = 10   # bars: EMA 7/25 cross must be within this window (keeps trending coins visible)
MID_CROSS_LOOKBACK = 30   # bars: EMA 25/99 cross must be within this window
ADX_PERIOD         = 14   # standard Wilder ADX period
ADX_MIN_TREND      = 20   # ADX threshold — below = sideways, skip signal
SPREAD_MIN_PCT     = 0.003  # 0.3 % minimum EMA-7/99 spread relative to price


# ── Data class ────────────────────────────────────────────────────────────────

@dataclass
class EMASignal:
    symbol:      str
    direction:   str           # LONG | SHORT
    timeframe:   str
    signal_time: datetime
    price:       float
    ema_fast:    float
    ema_mid:     float
    ema_slow:    float
    volume:      float | None = None
    strength:    float = 0.0   # 0..1 — quality of the fan (EMA spread + ADX)
    adx:         float = 0.0   # ADX value at signal time (stored for reference)


# ── EMA helper ────────────────────────────────────────────────────────────────

def _ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


# ── ADX (Wilder-smoothed, standard definition) ────────────────────────────────

def _adx(df: pd.DataFrame, period: int = ADX_PERIOD) -> pd.Series:
    """
    Returns the ADX series aligned with df's index.
    Requires columns: high, low, close.
    """
    high  = df["high"].astype(float)
    low   = df["low"].astype(float)
    close = df["close"].astype(float)

    prev_high  = high.shift(1)
    prev_low   = low.shift(1)
    prev_close = close.shift(1)

    # True Range
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low  - prev_close).abs(),
    ], axis=1).max(axis=1)

    # Directional Movement
    up_move   = high - prev_high
    down_move = prev_low - low

    plus_dm  = np.where((up_move > down_move) & (up_move > 0), up_move,   0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

    plus_dm_s  = pd.Series(plus_dm,  index=df.index)
    minus_dm_s = pd.Series(minus_dm, index=df.index)

    # Wilder smoothing (equivalent to EWM with alpha = 1/period)
    atr       = tr.ewm(      alpha=1/period, adjust=False).mean()
    plus_di   = 100 * plus_dm_s.ewm( alpha=1/period, adjust=False).mean() / atr.replace(0, np.nan)
    minus_di  = 100 * minus_dm_s.ewm(alpha=1/period, adjust=False).mean() / atr.replace(0, np.nan)

    dx_denom  = (plus_di + minus_di).replace(0, np.nan)
    dx        = 100 * (plus_di - minus_di).abs() / dx_denom

    adx_series = dx.ewm(alpha=1/period, adjust=False).mean()
    return adx_series.fillna(0)


# ── Strategy ──────────────────────────────────────────────────────────────────

class EMAStrategy:

    def __init__(self, fast: int = 7, mid: int = 25, slow: int = 99) -> None:
        self.fast = fast
        self.mid  = mid
        self.slow = slow

    # ── Public API ────────────────────────────────────────────────────────────

    def scan(
        self,
        symbol: str,
        timeframe: str,
        df: pd.DataFrame,
    ) -> "EMASignal | None":
        """
        df must have columns: open_time, open, high, low, close, volume.
        Returns a confirmed, trend-filtered crossover signal or None.
        """
        min_len = self.slow + MID_CROSS_LOOKBACK + ADX_PERIOD + 5
        if len(df) < min_len:
            return None

        df = df.copy().reset_index(drop=True)
        df["ef"]  = _ema(df["close"], self.fast)
        df["em"]  = _ema(df["close"], self.mid)
        df["es"]  = _ema(df["close"], self.slow)
        df["adx"] = _adx(df, ADX_PERIOD)

        direction = self._confirmed_cross(df)
        if direction is None:
            return None

        last = df.iloc[-1]
        ef, em, es = float(last["ef"]), float(last["em"]), float(last["es"])
        adx_val    = float(last["adx"])

        spread       = abs(ef - es) / es
        adx_bonus    = min(0.30, (adx_val - ADX_MIN_TREND) / 200.0)
        spread_bonus = min(0.20, spread / 0.15)
        strength     = round(min(1.0, 0.50 + adx_bonus + spread_bonus), 4)

        # Pin signal_time to the ACTUAL crossover candle so rescans always
        # hit the same uq_signal row (on_conflict_do_update refreshes market data)
        # rather than inserting a new row each time the last-closed bar advances.
        cross_bar = self._find_cross_bar(df, direction)

        return EMASignal(
            symbol      = symbol,
            direction   = direction,
            timeframe   = timeframe,
            signal_time = pd.Timestamp(cross_bar["open_time"]).to_pydatetime(),
            price       = float(last["close"]),   # current price (refreshed on rescan)
            ema_fast    = ef,
            ema_mid     = em,
            ema_slow    = es,
            volume      = float(last["volume"]) if "volume" in last else None,
            strength    = strength,
            adx         = adx_val,
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

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _find_cross_bar(self, df: pd.DataFrame, direction: str):
        """
        Walk backwards up to CROSS_LOOKBACK+1 bars to find the candle where
        EMA 7 actually crossed EMA 25.  Returns that bar so callers can use its
        open_time as the canonical signal_time (dedup anchor in the DB).
        Falls back to the last bar if no transition is found.
        """
        for i in range(1, CROSS_LOOKBACK + 2):
            if len(df) <= i + 1:
                break
            curr_ef = float(df.iloc[-i]["ef"])
            curr_em = float(df.iloc[-i]["em"])
            prev_ef = float(df.iloc[-i - 1]["ef"])
            prev_em = float(df.iloc[-i - 1]["em"])
            if direction == "LONG"  and prev_ef <= prev_em and curr_ef > curr_em:
                return df.iloc[-i]
            if direction == "SHORT" and prev_ef >= prev_em and curr_ef < curr_em:
                return df.iloc[-i]
        return df.iloc[-1]

    # ── Core detection ────────────────────────────────────────────────────────

    def _confirmed_cross(self, df: pd.DataFrame) -> str | None:
        """
        Returns "LONG" | "SHORT" | None.
        All 7 gates must pass (see module docstring).
        """
        last = df.iloc[-1]
        ef, em, es = float(last["ef"]), float(last["em"]), float(last["es"])
        price      = float(last["close"])

        # ── Gate 1: triple alignment ──────────────────────────────────────────
        bullish = ef > em > es
        bearish = ef < em < es
        if not bullish and not bearish:
            return None
        direction = "LONG" if bullish else "SHORT"

        # ── Gate 2: fresh EMA-7/25 cross within CROSS_LOOKBACK bars ──────────
        window_fm = df.iloc[-(CROSS_LOOKBACK + 1):-1]
        if direction == "LONG":
            if not (window_fm["ef"] <= window_fm["em"]).any():
                return None
        else:
            if not (window_fm["ef"] >= window_fm["em"]).any():
                return None

        # ── Gate 3: EMA-25/99 cross within MID_CROSS_LOOKBACK bars ───────────
        window_ms = df.iloc[-(MID_CROSS_LOOKBACK + 1):-1]
        if direction == "LONG":
            if not (window_ms["em"] <= window_ms["es"]).any():
                return None
        else:
            if not (window_ms["em"] >= window_ms["es"]).any():
                return None

        # ── Gate 4: all three EMAs sloping the right way (vs 3 bars ago) ─────
        ref    = df.iloc[-4]
        ref_ef = float(ref["ef"])
        ref_em = float(ref["em"])
        ref_es = float(ref["es"])
        if direction == "LONG":
            if not (ef > ref_ef and em > ref_em and es > ref_es):
                return None
        else:
            if not (ef < ref_ef and em < ref_em and es < ref_es):
                return None

        # ── Gate 5: price on the right side of EMA 7 ─────────────────────────
        if direction == "LONG"  and price <= ef:
            return None
        if direction == "SHORT" and price >= ef:
            return None

        # ── Gate 6: ADX confirms a trend (sideways filter) ───────────────────
        adx_val = float(last["adx"])
        if adx_val < ADX_MIN_TREND:
            return None

        # ── Gate 7: meaningful EMA spread (fan is actually open) ─────────────
        spread_pct = abs(ef - es) / es
        if spread_pct < SPREAD_MIN_PCT:
            return None

        return direction
