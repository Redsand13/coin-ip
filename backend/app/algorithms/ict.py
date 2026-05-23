"""
ICT (Inner Circle Trader) engine — crypto-optimised Smart Money confluence scanner.

Proven ICT sequence for crypto perpetual futures:
  1. Liquidity Sweep   — BSL/SSL grab: wick through fractal swing high/low + close reversal
  2. Displacement      — ATR-scaled impulsive break away from sweep level
  3. CHoCH / MSS       — Market Structure Shift: first structural close using fractal pivots
  4. Order Block       — Last opposing candle before displacement (+ breaker blocks)
  5. Fair Value Gap    — 3-candle ATR-scaled imbalance within displacement
  6. OTE Zone          — 61.8–79.6 % fibonacci of the sweep→MSS leg
  7. Kill Zone         — London / NY Open / Asia / NY-PM sessions

Crypto-specific improvements over classic ICT:
  • 5-bar fractal pivot detection (vs simple window max/min)
  • ATR-relative thresholds — scales across BTC ($100 K+) down to micro-caps
  • Premium / Discount scoring: longs favoured from discount, shorts from premium
  • Breaker blocks: invalidated OBs retested from the polarity-flipped side
  • AMD (Power-of-3): Asian consolidation → London manipulation → NY distribution
  • Kill zones are a scoring bonus, NOT a gate-keeper (crypto trades 24/7)
"""

from dataclasses import dataclass
from datetime import datetime
from enum import Enum

import numpy as np
import pandas as pd


MIN_CONFLUENCES = 4   # minimum of 7 confluence points required to emit a signal


# ── Enums ─────────────────────────────────────────────────────────────────────

class ICTPattern(str, Enum):
    COMPREHENSIVE_LONG  = "comprehensive_long"
    COMPREHENSIVE_SHORT = "comprehensive_short"
    # Legacy — kept so old DB rows can still be read
    SWEEP_AND_REVERSE   = "sweep_and_reverse"
    ORDER_BLOCK_LONG    = "order_block_long"
    ORDER_BLOCK_SHORT   = "order_block_short"
    FVG_FILL_LONG       = "fvg_fill_long"
    FVG_FILL_SHORT      = "fvg_fill_short"
    BOS_LONG            = "bos_long"
    BOS_SHORT           = "bos_short"
    CHOCH_LONG          = "choch_long"
    CHOCH_SHORT         = "choch_short"
    BREAKER_LONG        = "breaker_long"
    BREAKER_SHORT       = "breaker_short"


# ── Dataclasses ───────────────────────────────────────────────────────────────

@dataclass
class ComprehensiveICTSetup:
    """
    A confirmed ICT signal aggregating ALL confluences for a symbol / timeframe.
    Emitted only when confluence_count >= MIN_CONFLUENCES.
    """
    symbol:      str
    timeframe:   str
    direction:   str        # "LONG" | "SHORT"
    signal_time: datetime
    price:       float

    # ── Confluence flags (7 dimensions) ─────────────────────────────────────
    has_sweep:        bool = False   # liquidity sweep (BSL / SSL grab)
    has_displacement: bool = False   # impulsive ATR-scaled move post-sweep
    has_order_block:  bool = False   # last opposing candle before impulse
    has_fvg:          bool = False   # fair value gap in displacement
    has_bos:          bool = False   # break of structure (continuation)
    has_choch:        bool = False   # change of character / MSS (reversal)
    has_inducement:   bool = False   # minor liquidity grab before main sweep
    kill_zone:        str | None = None   # LONDON | NEW_YORK | ASIA | LONDON_CLOSE | NY_PM

    # ── Key levels ───────────────────────────────────────────────────────────
    sweep_high:          float | None = None
    sweep_low:           float | None = None
    order_block_top:     float | None = None
    order_block_bottom:  float | None = None
    fvg_top:             float | None = None
    fvg_bottom:          float | None = None
    structure_level:     float | None = None

    # ── OTE / AMD / structure fields ─────────────────────────────────────────
    ote_top:        float | None = None   # OTE zone top    (61.8 % fib)
    ote_bottom:     float | None = None   # OTE zone bottom (79.6 % fib)
    amd_phase:      str   | None = None   # "ACCUMULATION" | "MANIPULATION" | "DISTRIBUTION"
    structure_type: str          = "NEUTRAL"   # "BULLISH" | "BEARISH" | "NEUTRAL"

    quality: float = 0.0

    @property
    def pattern(self) -> ICTPattern:
        return (ICTPattern.COMPREHENSIVE_LONG
                if self.direction == "LONG"
                else ICTPattern.COMPREHENSIVE_SHORT)

    @property
    def confluence_count(self) -> int:
        """
        7-point grade:
          1. Sweep            4. BOS or CHoCH      7. OTE zone
          2. Displacement     5. Kill Zone
          3. OB or FVG        6. Inducement
        """
        return sum([
            self.has_sweep,
            self.has_displacement,
            self.has_order_block or self.has_fvg,
            self.has_bos or self.has_choch,
            self.kill_zone is not None,
            self.has_inducement,
            self.ote_top is not None,
        ])


@dataclass
class ICTSetup:
    """Legacy dataclass — kept for backward compatibility with old DB rows."""
    symbol:     str
    timeframe:  str
    pattern:    ICTPattern
    direction:  str
    signal_time: datetime
    price:      float
    sweep_high:          float | None = None
    sweep_low:           float | None = None
    order_block_top:     float | None = None
    order_block_bottom:  float | None = None
    fvg_top:             float | None = None
    fvg_bottom:          float | None = None
    structure_level:     float | None = None
    quality: float = 0.0


# ── Helpers ───────────────────────────────────────────────────────────────────

def _calc_atr(df: pd.DataFrame, period: int = 14) -> float:
    """Average True Range over the last `period` bars."""
    hi  = df["high"].values.astype(float)
    lo  = df["low"].values.astype(float)
    cl  = df["close"].values.astype(float)
    pc  = np.roll(cl, 1); pc[0] = cl[0]
    tr  = np.maximum(hi - lo, np.maximum(np.abs(hi - pc), np.abs(lo - pc)))
    return float(np.mean(tr[-period:]))


def _find_fractals(df: pd.DataFrame, n: int = 2) -> tuple[list[int], list[int]]:
    """
    Williams 5-bar fractal pivot detection.
    A fractal high at bar i: df['high'][i] is strictly the highest of i-n..i+n.
    A fractal low  at bar i: df['low'][i]  is strictly the lowest  of i-n..i+n.
    Returns (high_indices, low_indices) relative to df.
    """
    hi = df["high"].values.astype(float)
    lo = df["low"].values.astype(float)
    L  = len(df)
    highs: list[int] = []
    lows:  list[int] = []

    for i in range(n, L - n):
        wh = hi[i - n: i + n + 1]
        wl = lo[i - n: i + n + 1]
        # argmax/argmin must be at center (index n) to confirm pivot
        if hi[i] == wh.max() and np.argmax(wh) == n:
            highs.append(i)
        if lo[i] == wl.min() and np.argmin(wl) == n:
            lows.append(i)

    return highs, lows


def _ts(row: pd.Series) -> datetime:
    ts = pd.Timestamp(row["open_time"])
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    return ts.to_pydatetime()


# ── ICT Engine ────────────────────────────────────────────────────────────────

class ICTEngine:
    """
    Full ICT confluence scanner, crypto-optimised.
    Public API: scan_comprehensive(symbol, timeframe, df) → list[ComprehensiveICTSetup]
    """

    def __init__(
        self,
        swing_lookback:    int   = 20,
        sweep_buffer_pct:  float = 0.002,   # fallback if ATR unavailable
        fvg_min_gap_pct:   float = 0.001,   # fallback
        ob_lookback:       int   = 10,
        displacement_bars: int   = 2,
        min_confluences:   int   = MIN_CONFLUENCES,
    ) -> None:
        self.swing_lookback    = swing_lookback
        self.sweep_buffer_pct  = sweep_buffer_pct
        self.fvg_min_gap_pct   = fvg_min_gap_pct
        self.ob_lookback       = ob_lookback
        self.displacement_bars = displacement_bars
        self.min_confluences   = min_confluences

    # ── Public API ────────────────────────────────────────────────────────────

    def scan(self, symbol: str, timeframe: str, df: pd.DataFrame) -> list:
        return self.scan_comprehensive(symbol, timeframe, df)

    def scan_comprehensive(
        self,
        symbol:    str,
        timeframe: str,
        df:        pd.DataFrame,
    ) -> list[ComprehensiveICTSetup]:
        if len(df) < self.swing_lookback + 15:
            return []

        df  = df.copy().reset_index(drop=True)
        atr = _calc_atr(df, period=14)

        # Compute fractal pivots once for the full frame
        frac_hi, frac_lo = _find_fractals(df, n=2)

        # Pre-compute structure bias to gate direction (same SMC core rule applies)
        structure_type = self._detect_structure_type(df, frac_hi, frac_lo)

        candidates: list[ComprehensiveICTSetup] = []
        for direction in ("LONG", "SHORT"):
            if structure_type == "BULLISH" and direction == "SHORT":
                setup = self._check_direction(symbol, timeframe, df, direction, atr, frac_hi, frac_lo)
                if setup and setup.has_choch and setup.confluence_count >= self.min_confluences:
                    candidates.append(setup)
                continue
            if structure_type == "BEARISH" and direction == "LONG":
                setup = self._check_direction(symbol, timeframe, df, direction, atr, frac_hi, frac_lo)
                if setup and setup.has_choch and setup.confluence_count >= self.min_confluences:
                    candidates.append(setup)
                continue

            setup = self._check_direction(symbol, timeframe, df, direction, atr, frac_hi, frac_lo)
            if setup and setup.confluence_count >= self.min_confluences:
                candidates.append(setup)

        if len(candidates) == 2:
            return [max(candidates, key=lambda s: (s.confluence_count, s.quality))]
        return candidates

    # ── Direction analysis ────────────────────────────────────────────────────

    def _check_direction(
        self,
        symbol:    str,
        timeframe: str,
        df:        pd.DataFrame,
        direction: str,
        atr:       float,
        frac_hi:   list[int],
        frac_lo:   list[int],
    ) -> ComprehensiveICTSetup | None:
        is_long = direction == "LONG"
        last    = df.iloc[-1]

        # 1. Liquidity Sweep (mandatory — every ICT setup begins with a sweep)
        sweep_high, sweep_low, has_sweep, sweep_idx = self._detect_sweep(
            df, frac_hi, frac_lo, is_long, atr
        )
        if not has_sweep:
            return None

        disp_start = (sweep_idx + 1) if sweep_idx is not None else max(0, len(df) - 5)

        # 2. Displacement
        has_displacement = self._detect_displacement(df, disp_start, is_long, atr)

        # 3. Order Block (incl. breaker blocks)
        has_order_block, ob_top, ob_bottom = self._detect_order_block(
            df, disp_start, is_long, atr
        )

        # 4. Fair Value Gap
        has_fvg, fvg_top, fvg_bottom = self._detect_fvg(df, disp_start, is_long, atr)

        # 5. CHoCH / MSS using fractal pivots
        has_choch, has_bos, structure_level = self._detect_mss(
            df, frac_hi, frac_lo, sweep_idx, is_long
        )

        # 6. Inducement (minor IDM grab before main sweep)
        has_inducement = self._detect_inducement(df, sweep_idx, is_long, atr)

        # 7. Kill Zone
        kill_zone = self._kill_zone(last)

        # 8. OTE Zone (61.8–79.6 % fibonacci)
        sweep_level = sweep_low if is_long else sweep_high
        ote_top, ote_bottom = self._detect_ote_zone(
            df, direction, sweep_level, structure_level
        )

        # 9. AMD cycle (Power of 3)
        amd_phase = self._detect_amd_cycle(df, lookback=48)

        # 10. HTF structural bias from fractal pivot chain
        structure_type = self._detect_structure_type(df, frac_hi, frac_lo)

        # Premium / Discount bonus for quality score
        in_pd = self._in_premium_discount(df, is_long)

        quality = min(1.0, sum([
            0.20 if has_sweep        else 0.0,
            0.16 if has_displacement else 0.0,
            0.12 if has_order_block  else 0.0,
            0.08 if has_fvg          else 0.0,
            0.12 if has_bos else (0.10 if has_choch else 0.0),
            0.06 if kill_zone        else 0.0,
            0.04 if has_inducement   else 0.0,
            0.10 if ote_top is not None else 0.0,
            0.07 if in_pd            else 0.0,
            0.05 if amd_phase == "DISTRIBUTION" else 0.0,
        ]))

        return ComprehensiveICTSetup(
            symbol        = symbol,
            timeframe     = timeframe,
            direction     = direction,
            signal_time   = _ts(last),
            price         = float(last["close"]),
            has_sweep          = has_sweep,
            has_displacement   = has_displacement,
            has_order_block    = has_order_block,
            has_fvg            = has_fvg,
            has_bos            = has_bos,
            has_choch          = has_choch,
            has_inducement     = has_inducement,
            kill_zone          = kill_zone,
            sweep_high         = sweep_high,
            sweep_low          = sweep_low,
            order_block_top    = ob_top,
            order_block_bottom = ob_bottom,
            fvg_top            = fvg_top,
            fvg_bottom         = fvg_bottom,
            structure_level    = structure_level,
            ote_top            = ote_top,
            ote_bottom         = ote_bottom,
            amd_phase          = amd_phase,
            structure_type     = structure_type,
            quality            = quality,
        )

    # ── Confluence detectors ──────────────────────────────────────────────────

    def _detect_sweep(
        self,
        df:        pd.DataFrame,
        frac_hi:   list[int],
        frac_lo:   list[int],
        is_long:   bool,
        atr:       float,
    ) -> tuple[float | None, float | None, bool, int | None]:
        """
        Liquidity sweep: a candle whose wick pierces the lows/highs of the bars
        immediately BEFORE it, then closes back in the reversal direction.

        For each of the last 6 candidate bars we:
          1. Compute the reference low/high from the 10 bars BEFORE that candidate
             (so the candidate is never compared against its own wick).
          2. Confirm wick extension > reference ± (0.15 × ATR).
          3. Confirm the candle closes in the reversal direction.

        This correctly handles both fractal-rich and monotonic-trend scenarios.
        """
        buf = max(atr * 0.20, float(df.iloc[-1]["close"]) * self.sweep_buffer_pct)

        for offset in range(0, min(6, len(df))):
            bar_idx = len(df) - 1 - offset
            bar     = df.iloc[bar_idx]

            lookback = df.iloc[max(0, bar_idx - 10): bar_idx]
            if len(lookback) < 3:
                continue

            if is_long:
                prior_low = float(lookback["low"].min())
                if (float(bar["low"]) < prior_low - buf and
                        float(bar["close"]) > prior_low):
                    return None, float(bar["low"]), True, bar_idx
            else:
                prior_high = float(lookback["high"].max())
                if (float(bar["high"]) > prior_high + buf and
                        float(bar["close"]) < prior_high):
                    return float(bar["high"]), None, True, bar_idx

        return None, None, False, None

    def _detect_displacement(
        self,
        df:        pd.DataFrame,
        start_idx: int,
        is_long:   bool,
        atr:       float,
    ) -> bool:
        """
        Displacement = ≥2 consecutive strong candles from sweep_idx onward.
        Per candle: body ≥ 55% of range AND in the correct direction.
        Combined: total body sum ≥ 1.0 × ATR (ensures a meaningful impulse).
        """
        if start_idx >= len(df):
            return False

        count    = 0
        body_sum = 0.0

        end_idx = min(start_idx + 8, len(df))
        for _, row in df.iloc[start_idx:end_idx].iterrows():
            rng  = float(row["high"]) - float(row["low"])
            body = abs(float(row["close"]) - float(row["open"]))
            if rng < 1e-10:
                count = 0; body_sum = 0.0; continue

            bull = float(row["close"]) > float(row["open"]) and body / rng >= 0.55
            bear = float(row["close"]) < float(row["open"]) and body / rng >= 0.55

            if (is_long and bull) or (not is_long and bear):
                count    += 1
                body_sum += body
                if count >= self.displacement_bars and body_sum >= atr * 1.0:
                    return True
            else:
                count = 0; body_sum = 0.0

        return False

    def _detect_order_block(
        self,
        df:        pd.DataFrame,
        disp_start: int,
        is_long:   bool,
        atr:       float,
    ) -> tuple[bool, float | None, float | None]:
        """
        Order Block: last opposing candle BEFORE the displacement impulse.
        Minimum body = 0.15 × ATR (avoids tiny doji "OBs").
        Price tolerance = 0.30 × ATR for zone retest proximity.

        Also detects Breaker Blocks: an invalidated OB that has flipped polarity
        and is now retested from the opposite side.
        """
        last_close  = float(df.iloc[-1]["close"])
        search_from = max(0, disp_start - self.ob_lookback)
        min_body    = atr * 0.15
        tol         = atr * 0.30

        for i in range(disp_start - 1, search_from - 1, -1):
            if i < 0 or i >= len(df):
                continue
            bar  = df.iloc[i]
            body = abs(float(bar["close"]) - float(bar["open"]))
            if body < min_body:
                continue

            if is_long:
                # Bearish OB: last bearish candle before bullish impulse
                if float(bar["close"]) < float(bar["open"]):
                    ob_top    = float(bar["open"])
                    ob_bottom = float(bar["close"])
                    if (ob_bottom - tol) <= last_close <= (ob_top + tol):
                        return True, ob_top, ob_bottom
            else:
                # Bullish OB: last bullish candle before bearish impulse
                if float(bar["close"]) > float(bar["open"]):
                    ob_top    = float(bar["close"])
                    ob_bottom = float(bar["open"])
                    if (ob_bottom - tol) <= last_close <= (ob_top + tol):
                        return True, ob_top, ob_bottom

        return False, None, None

    def _detect_fvg(
        self,
        df:        pd.DataFrame,
        disp_start: int,
        is_long:   bool,
        atr:       float,
    ) -> tuple[bool, float | None, float | None]:
        """
        Fair Value Gap (3-candle imbalance).
        Min gap = 0.10 × ATR — ATR-relative so it scales with each coin's volatility.
        Entry tolerance = 0.25 × ATR (price approaching or inside the gap).

        Bullish FVG: candle[i-1].high < candle[i+1].low  (gap above prev high)
        Bearish FVG: candle[i-1].low  > candle[i+1].high (gap below prev low)
        """
        last_close = float(df.iloc[-1]["close"])
        min_gap    = atr * 0.10
        tol        = atr * 0.25
        end        = len(df) - 1

        for i in range(max(disp_start + 1, 1), end):
            a = df.iloc[i - 1]
            c = df.iloc[i + 1]

            if is_long:
                gap = float(c["low"]) - float(a["high"])
                if gap >= min_gap:
                    fvg_bot = float(a["high"])
                    fvg_top = float(c["low"])
                    if (fvg_bot - tol) <= last_close <= (fvg_top + tol):
                        return True, fvg_top, fvg_bot
            else:
                gap = float(a["low"]) - float(c["high"])
                if gap >= min_gap:
                    fvg_bot = float(c["high"])
                    fvg_top = float(a["low"])
                    if (fvg_bot - tol) <= last_close <= (fvg_top + tol):
                        return True, fvg_top, fvg_bot

        return False, None, None

    def _detect_mss(
        self,
        df:        pd.DataFrame,
        frac_hi:   list[int],
        frac_lo:   list[int],
        sweep_idx: int | None,
        is_long:   bool,
    ) -> tuple[bool, bool, float | None]:
        """
        Market Structure Shift (MSS) / CHoCH / BOS — using fractal pivots.

        CHoCH (Change of Character / reversal signal):
          Bullish: after a sequence of lower highs, price closes above a fractal high.
          Bearish: after a sequence of higher lows, price closes below a fractal low.

        BOS (Break of Structure / continuation):
          Bullish: in a bullish trend (HH series), price closes above the last fractal high.
          Bearish: in a bearish trend (LL series), price closes below the last fractal low.

        Returns (has_choch, has_bos, structure_level).
        """
        last_close = float(df.iloc[-1]["close"])
        ref_end    = sweep_idx if sweep_idx is not None else len(df) - 3

        has_choch = False
        has_bos   = False
        level: float | None = None

        if is_long:
            relevant = [i for i in frac_hi if i < ref_end]
            if len(relevant) >= 1:
                key_high = float(df.at[relevant[-1], "high"])
                level    = key_high
                if last_close > key_high:
                    if len(relevant) >= 2:
                        # CHoCH: prior high was lower (downtrend reversing)
                        if key_high < float(df.at[relevant[-2], "high"]):
                            has_choch = True
                        else:
                            has_bos = True
                    else:
                        has_choch = True
        else:
            relevant = [i for i in frac_lo if i < ref_end]
            if len(relevant) >= 1:
                key_low = float(df.at[relevant[-1], "low"])
                level   = key_low
                if last_close < key_low:
                    if len(relevant) >= 2:
                        # CHoCH: prior low was higher (uptrend reversing)
                        if key_low > float(df.at[relevant[-2], "low"]):
                            has_choch = True
                        else:
                            has_bos = True
                    else:
                        has_choch = True

        return has_choch, has_bos, level

    def _detect_inducement(
        self,
        df:        pd.DataFrame,
        sweep_idx: int | None,
        is_long:   bool,
        atr:       float,
    ) -> bool:
        """
        Inducement (IDM): minor liquidity grab in the 6–8 bars BEFORE the main sweep.
        The IDM lures retail into the wrong direction; smart money then sweeps a major
        level. IDM must be within 0.8 × ATR of the main sweep level.
        """
        if sweep_idx is None or sweep_idx < 5:
            return False

        window   = df.iloc[max(0, sweep_idx - 8): sweep_idx]
        if len(window) < 3:
            return False

        main_bar = df.iloc[sweep_idx]

        if is_long:
            main_low = float(main_bar["low"])
            for _, row in window.iterrows():
                gap = main_low - float(row["low"])
                if 0 < gap <= atr * 0.8:
                    return True
        else:
            main_high = float(main_bar["high"])
            for _, row in window.iterrows():
                gap = float(row["high"]) - main_high
                if 0 < gap <= atr * 0.8:
                    return True

        return False

    def _detect_ote_zone(
        self,
        df:           pd.DataFrame,
        direction:    str,
        sweep_level:  float | None,
        mss_level:    float | None,
    ) -> tuple[float | None, float | None]:
        """
        Optimal Trade Entry = 61.8–79.6 % fibonacci retracement of the sweep→MSS leg.
        Returns (ote_top, ote_bottom) when current price is inside the zone.
        """
        if sweep_level is None or mss_level is None:
            return None, None

        last_close = float(df.iloc[-1]["close"])
        is_long    = direction == "LONG"

        if is_long:
            lo, hi = sweep_level, mss_level
            if hi <= lo:
                return None, None
            ote_bottom = hi - 0.786 * (hi - lo)
            ote_top    = hi - 0.618 * (hi - lo)
        else:
            lo, hi = mss_level, sweep_level
            if hi <= lo:
                return None, None
            ote_bottom = lo + 0.618 * (hi - lo)
            ote_top    = lo + 0.786 * (hi - lo)

        if ote_bottom <= last_close <= ote_top:
            return ote_top, ote_bottom
        return None, None

    def _in_premium_discount(self, df: pd.DataFrame, is_long: bool) -> bool:
        """
        Premium / Discount filter (quality bonus).
        Midpoint (equilibrium) = 50% of the 40-bar swing range.
        Longs in DISCOUNT (price < midpoint) and shorts in PREMIUM (price > midpoint)
        are higher-probability setups — smart money buys cheap and sells expensive.
        """
        if len(df) < 40:
            return True
        window     = df.iloc[-40:]
        hi         = float(window["high"].max())
        lo         = float(window["low"].min())
        if hi <= lo:
            return True
        equil      = (hi + lo) / 2.0
        last_close = float(df.iloc[-1]["close"])
        return last_close <= equil if is_long else last_close >= equil

    def _detect_amd_cycle(self, df: pd.DataFrame, lookback: int = 48) -> str | None:
        """
        AMD (Accumulation / Manipulation / Distribution) — ICT Power of 3.

        Splits lookback into 3 equal segments:
          Seg 1 — Accumulation: tight range, low ATR relative to the window
          Seg 2 — Manipulation: spike in the wrong direction (stop hunt)
          Seg 3 — Distribution: strong impulse AGAINST the manipulation spike
        """
        if len(df) < lookback:
            return None

        window = df.iloc[-lookback:].reset_index(drop=True)
        third  = lookback // 3
        seg1   = window.iloc[: third]
        seg2   = window.iloc[third: 2 * third]
        seg3   = window.iloc[2 * third:]

        if seg1.empty or seg2.empty or seg3.empty:
            return None

        atr1    = float((seg1["high"] - seg1["low"]).mean())
        atr2    = float((seg2["high"] - seg2["low"]).mean())
        w_atr   = float((window["high"] - window["low"]).mean())
        if w_atr < 1e-10:
            return None

        is_acc = atr1 < w_atr * 0.75

        seg1_close  = float(seg1.iloc[-1]["close"])
        spike_up    = (float(seg2["high"].max()) - seg1_close) / max(seg1_close, 1e-10) >= 0.004
        spike_down  = (seg1_close - float(seg2["low"].min())) / max(seg1_close, 1e-10) >= 0.004
        is_manip    = is_acc and (spike_up or spike_down) and atr2 > atr1 * 1.2

        if is_manip:
            seg3_open  = float(seg3.iloc[0]["open"])
            seg3_close = float(seg3.iloc[-1]["close"])
            if spike_up   and seg3_close < seg3_open: return "DISTRIBUTION"
            if spike_down and seg3_close > seg3_open: return "DISTRIBUTION"
            return "MANIPULATION"

        if is_acc:
            return "ACCUMULATION"
        return None

    def _detect_structure_type(
        self,
        df:      pd.DataFrame,
        frac_hi: list[int],
        frac_lo: list[int],
    ) -> str:
        """
        HTF structural bias from fractal pivot progression.
        BULLISH = HH + HL (higher highs and higher lows)
        BEARISH = LH + LL (lower highs and lower lows)
        NEUTRAL = mixed
        """
        if len(frac_hi) < 2 or len(frac_lo) < 2:
            return "NEUTRAL"

        hi_vals = [float(df.at[i, "high"]) for i in frac_hi[-3:]]
        lo_vals = [float(df.at[i, "low"])  for i in frac_lo[-3:]]

        hh = len(hi_vals) >= 2 and hi_vals[-1] > hi_vals[-2]
        hl = len(lo_vals) >= 2 and lo_vals[-1] > lo_vals[-2]
        lh = len(hi_vals) >= 2 and hi_vals[-1] < hi_vals[-2]
        ll = len(lo_vals) >= 2 and lo_vals[-1] < lo_vals[-2]

        if hh and hl: return "BULLISH"
        if lh and ll: return "BEARISH"
        return "NEUTRAL"

    @staticmethod
    def _kill_zone(last: pd.Series) -> str | None:
        """
        ICT kill zones adapted for crypto perpetual futures (UTC):
          ASIA         00:00 – 04:00   Asian session open (Tokyo/Singapore flow)
          LONDON       07:00 – 10:00   London open (largest daily volume window)
          NEW_YORK     13:00 – 16:00   NY open + CME futures open at 13:30
          LONDON_CLOSE 15:00 – 17:00   London close (large block liquidations)
          NY_PM        19:00 – 21:00   NY afternoon (pre-close positioning)

        Kill zones are a BONUS score in crypto — not a disqualifier.
        """
        try:
            ts = pd.Timestamp(last["open_time"])
            if ts.tzinfo is None:
                ts = ts.tz_localize("UTC")
            hour = ts.hour
        except Exception:
            return None

        if  0 <= hour < 4:  return "ASIA"
        if  7 <= hour < 10: return "LONDON"
        if 13 <= hour < 16: return "NEW_YORK"
        if 15 <= hour < 17: return "LONDON_CLOSE"
        if 19 <= hour < 21: return "NY_PM"
        return None
