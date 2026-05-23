"""
SMC (Smart Money Concepts) engine — full-concept crypto-optimised scanner.

Complete SMC sequence for crypto perpetual futures:
  1. Market Structure    — Fractal HH/HL (bullish) or LH/LL (bearish) chain
  2. BOS / CHoCH         — Break of Structure (continuation) or Change of Character (reversal)
  3. Order Block (OB)    — Last opposing candle before the impulse; institutional footprint
  4. Supply / Demand     — ATR-scaled consolidation base → impulse origin zone
  5. Fair Value Gap      — 3-candle ATR-scaled imbalance (precision entry)
  6. Displacement        — ATR-scaled strong candle validating zone rejection
  7. Equal H/L (Liquidity) — Cluster of equal swing highs/lows swept before entry
  8. Inducement (IDM)    — Minor liquidity grab drawing price toward the main move
  9. Mitigation Blocks   — Invalidated OBs retested from the polarity-flipped side
 10. Premium / Discount  — Longs from discount (<50% midpoint), shorts from premium

Setup types emitted:
  CHoCH           — Change of Character (trend reversal signal)
  BOS_RETEST      — Break of Structure pullback (continuation)
  DEMAND_RETEST   — Fresh demand zone being tested
  SUPPLY_RETEST   — Fresh supply zone being tested
  LIQUIDITY_SWEEP — Equal highs/lows taken before reversal entry
  MITIGATION      — Old OB retested from flipped side

7-point confluence grade:
  1. BOS or CHoCH (structure context)
  2. Supply / Demand zone present
  3. Order Block at entry
  4. Displacement from zone
  5. Fair Value Gap
  6. Liquidity (equal H/L swept or inducement)
  7. Mitigation block
"""

from dataclasses import dataclass
from datetime import datetime

import numpy as np
import pandas as pd


MIN_CONFLUENCES = 3   # require at least 3 of 7 to emit a signal


# ── Dataclass ─────────────────────────────────────────────────────────────────

@dataclass
class SMCSetup:
    """
    A confirmed SMC signal aggregating all price-action confluences.
    Emitted only when confluence_count >= MIN_CONFLUENCES.
    """
    symbol:      str
    timeframe:   str
    direction:   str        # "LONG" | "SHORT"
    signal_time: datetime
    price:       float
    setup_type:  str        # "CHoCH" | "BOS_RETEST" | "DEMAND_RETEST" |
                            # "SUPPLY_RETEST" | "LIQUIDITY_SWEEP" | "MITIGATION"

    # ── Confluence flags (7 dimensions) ──────────────────────────────────────
    has_bos:           bool = False   # break of structure (continuation)
    has_choch:         bool = False   # change of character (reversal)
    has_supply_demand: bool = False   # price inside supply/demand zone
    has_order_block:   bool = False   # order block at entry zone
    has_displacement:  bool = False   # strong impulsive candle from zone
    has_fvg:           bool = False   # fair value gap / imbalance
    has_equal_hl:      bool = False   # equal highs/lows liquidity swept
    has_inducement:    bool = False   # minor IDM grab before main move
    has_mitigation:    bool = False   # mitigation block retested

    # ── Key levels ────────────────────────────────────────────────────────────
    zone_top:         float | None = None   # supply / demand zone top
    zone_bottom:      float | None = None   # supply / demand zone bottom
    ob_top:           float | None = None   # order block top
    ob_bottom:        float | None = None   # order block bottom
    structure_level:  float | None = None   # BOS / CHoCH structural level
    liquidity_level:  float | None = None   # equal H/L pool level
    fvg_top:          float | None = None
    fvg_bottom:       float | None = None

    # ── Scoring / metadata ────────────────────────────────────────────────────
    quality:        float = 0.0
    structure_type: str   = "NEUTRAL"   # "BULLISH" | "BEARISH" | "NEUTRAL"
    zone_tests:     int   = 0           # 0 = untested (freshest)
    pd_context:     str   = "NEUTRAL"   # "PREMIUM" | "DISCOUNT" | "NEUTRAL"

    @property
    def confluence_count(self) -> int:
        """
        7-point grade:
          1. BOS / CHoCH        4. Displacement    7. Mitigation
          2. Supply / Demand    5. FVG
          3. Order Block        6. Liquidity (eq H/L or inducement)
        """
        return sum([
            self.has_bos or self.has_choch,
            self.has_supply_demand,
            self.has_order_block,
            self.has_displacement,
            self.has_fvg,
            self.has_equal_hl or self.has_inducement,
            self.has_mitigation,
        ])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _calc_atr(df: pd.DataFrame, period: int = 14) -> float:
    hi  = df["high"].values.astype(float)
    lo  = df["low"].values.astype(float)
    cl  = df["close"].values.astype(float)
    pc  = np.roll(cl, 1); pc[0] = cl[0]
    tr  = np.maximum(hi - lo, np.maximum(np.abs(hi - pc), np.abs(lo - pc)))
    return float(np.mean(tr[-period:]))


def _find_fractals(df: pd.DataFrame, n: int = 2) -> tuple[list[int], list[int]]:
    """
    Williams 5-bar fractal pivot detection.
    High at i: df['high'][i] is strictly the max of i-n..i+n.
    Low  at i: df['low'][i]  is strictly the min  of i-n..i+n.
    """
    hi = df["high"].values.astype(float)
    lo = df["low"].values.astype(float)
    L  = len(df)
    highs: list[int] = []
    lows:  list[int] = []

    for i in range(n, L - n):
        wh = hi[i - n: i + n + 1]
        wl = lo[i - n: i + n + 1]
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


# ── SMC Engine ────────────────────────────────────────────────────────────────

class SMCEngine:
    """
    Full SMC confluence scanner, crypto-optimised.
    Public API: scan_comprehensive(symbol, timeframe, df) → list[SMCSetup]
    """

    def __init__(
        self,
        swing_lookback:      int   = 20,
        fvg_min_gap_pct:     float = 0.001,
        eq_threshold_pct:    float = 0.0015,
        sweep_threshold_pct: float = 0.003,
        min_confluences:     int   = MIN_CONFLUENCES,
    ) -> None:
        self.swing_lookback      = swing_lookback
        self.fvg_min_gap_pct     = fvg_min_gap_pct
        self.eq_threshold        = eq_threshold_pct
        self.sweep_threshold     = sweep_threshold_pct
        self.min_confluences     = min_confluences

    # ── Public API ─────────────────────────────────────────────────────────────

    def scan_comprehensive(
        self,
        symbol:    str,
        timeframe: str,
        df:        pd.DataFrame,
    ) -> list[SMCSetup]:
        if len(df) < self.swing_lookback + 15:
            return []

        df  = df.copy().reset_index(drop=True)
        atr = _calc_atr(df, period=14)
        frac_hi, frac_lo = _find_fractals(df, n=2)

        # Pre-compute structure so we can gate direction before running full checks
        structure_type, _ = self._detect_market_structure(df, frac_hi, frac_lo)

        candidates: list[SMCSetup] = []
        for direction in ("LONG", "SHORT"):
            # SMC core rule: only trade WITH structure unless it's a CHoCH reversal.
            # A BOS Retest / Demand / Supply / Mitigation in a BEARISH structure is
            # a counter-trend trade — high noise, low quality. Skip it.
            # CHoCH is exempt because it IS the reversal signal (against structure by design).
            if structure_type == "BULLISH" and direction == "SHORT":
                # Allow only if a CHoCH is likely — do a quick fractal check
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

    def scan(self, symbol: str, timeframe: str, df: pd.DataFrame) -> list[SMCSetup]:
        return self.scan_comprehensive(symbol, timeframe, df)

    # ── Direction analysis ─────────────────────────────────────────────────────

    def _check_direction(
        self,
        symbol:    str,
        timeframe: str,
        df:        pd.DataFrame,
        direction: str,
        atr:       float,
        frac_hi:   list[int],
        frac_lo:   list[int],
    ) -> SMCSetup | None:
        is_long = direction == "LONG"
        last    = df.iloc[-1]
        price   = float(last["close"])

        # 1. Market structure (fractal pivot chain + slope fallback)
        structure_type, structure_level = self._detect_market_structure(df, frac_hi, frac_lo)

        # 2. BOS / CHoCH — fractal-based structural break
        has_bos, has_choch, struct_lvl = self._detect_bos_choch(
            df, frac_hi, frac_lo, structure_type, is_long
        )
        if structure_level is None:
            structure_level = struct_lvl

        # 3. Supply / Demand zone (ATR-relative base → impulse)
        has_sd, zone_top, zone_bottom, zone_tests = self._detect_supply_demand_zone(
            df, direction, atr, lookback=40
        )

        # 4. Order Block at entry zone
        disp_start = max(0, len(df) - 20)
        has_ob, ob_top, ob_bottom = self._detect_order_block_smc(
            df, direction, disp_start, atr
        )

        # 5. Displacement from zone (ATR-relative)
        has_disp = self._detect_displacement_smc(df, direction, disp_start, atr)

        # 6. Fair Value Gap (ATR-relative)
        has_fvg, fvg_top, fvg_bottom = self._detect_fvg_smc(df, direction, disp_start, atr)

        # 7. Equal highs / lows (liquidity pool swept)
        has_eq, liq_level = self._detect_equal_highs_lows(df, direction, lookback=30)

        # 8. Inducement (minor IDM grab before main move)
        has_idm = self._detect_inducement(df, frac_hi, frac_lo, direction, atr)

        # 9. Mitigation block
        has_mit = self._detect_mitigation(df, direction, atr, lookback=30)

        # 10. Premium / Discount context
        pd_ctx = self._premium_discount_context(df)

        # ── Quality score ────────────────────────────────────────────────────
        pd_bonus = (is_long and pd_ctx == "DISCOUNT") or (not is_long and pd_ctx == "PREMIUM")
        quality = min(1.0, sum([
            0.20 if (has_bos or has_choch) else 0.0,
            0.15 if has_sd     else 0.0,
            0.12 if has_ob     else 0.0,
            0.12 if has_disp   else 0.0,
            0.10 if has_fvg    else 0.0,
            0.10 if has_eq     else (0.07 if has_idm else 0.0),
            0.10 if has_mit    else 0.0,
            0.05 if zone_tests == 0 else 0.0,
            0.06 if pd_bonus   else 0.0,
        ]))

        # ── Setup type ───────────────────────────────────────────────────────
        if has_choch:
            setup_type = "CHoCH"
        elif has_mit:
            setup_type = "MITIGATION"
        elif has_eq or has_idm:
            setup_type = "LIQUIDITY_SWEEP"
        elif has_bos and has_sd:
            setup_type = "DEMAND_RETEST" if is_long else "SUPPLY_RETEST"
        else:
            setup_type = "BOS_RETEST"

        return SMCSetup(
            symbol           = symbol,
            timeframe        = timeframe,
            direction        = direction,
            signal_time      = _ts(last),
            price            = price,
            setup_type       = setup_type,
            has_bos          = has_bos,
            has_choch        = has_choch,
            has_supply_demand= has_sd,
            has_order_block  = has_ob,
            has_displacement = has_disp,
            has_fvg          = has_fvg,
            has_equal_hl     = has_eq,
            has_inducement   = has_idm,
            has_mitigation   = has_mit,
            zone_top         = zone_top,
            zone_bottom      = zone_bottom,
            ob_top           = ob_top,
            ob_bottom        = ob_bottom,
            structure_level  = structure_level,
            liquidity_level  = liq_level,
            fvg_top          = fvg_top,
            fvg_bottom       = fvg_bottom,
            quality          = quality,
            structure_type   = structure_type,
            zone_tests       = zone_tests,
            pd_context       = pd_ctx,
        )

    # ── Confluence detectors ───────────────────────────────────────────────────

    def _detect_market_structure(
        self,
        df:      pd.DataFrame,
        frac_hi: list[int],
        frac_lo: list[int],
    ) -> tuple[str, float | None]:
        """
        BULLISH = HH + HL (fractal chain).  BEARISH = LH + LL.
        Slope fallback when < 2 fractals of each type.
        """
        if len(frac_hi) >= 2 and len(frac_lo) >= 2:
            hi_vals = [float(df.at[i, "high"]) for i in frac_hi[-3:]]
            lo_vals = [float(df.at[i, "low"])  for i in frac_lo[-3:]]
            hh = hi_vals[-1] > hi_vals[-2]
            hl = lo_vals[-1] > lo_vals[-2]
            lh = hi_vals[-1] < hi_vals[-2]
            ll = lo_vals[-1] < lo_vals[-2]
            if hh and hl: return "BULLISH", lo_vals[-1]
            if lh and ll: return "BEARISH", hi_vals[-1]

        # Slope fallback
        if len(df) >= 20:
            rc = float(df["close"].iloc[-10:].mean())
            pc = float(df["close"].iloc[-20:-10].mean())
            if rc > pc * 1.002:
                return "BULLISH", float(df["low"].iloc[-10:].min())
            if rc < pc * 0.998:
                return "BEARISH", float(df["high"].iloc[-10:].max())

        return "NEUTRAL", None

    def _detect_bos_choch(
        self,
        df:             pd.DataFrame,
        frac_hi:        list[int],
        frac_lo:        list[int],
        structure_type: str,
        is_long:        bool,
        lookback:       int = 35,
    ) -> tuple[bool, bool, float | None]:
        """
        BOS  = any bar in the last `lookback` bars closed above a prior fractal
               high (LONG) or below a prior fractal low (SHORT) — continuation.
        CHoCH = same cross but AGAINST the established trend — reversal signal.

        Checks both the current bar (last_high/last_low wick) and historical
        breaks within lookback, so demand/supply zone retest setups are captured
        even when price has pulled back below the fractal swing.
        """
        L       = len(df)
        ref_end = max(0, L - 3)
        has_bos   = False
        has_choch = False
        level: float | None = None

        scan_start = max(0, L - lookback)

        if is_long:
            valid_hi = [i for i in frac_hi if i < ref_end]
            if not valid_hi:
                fallback = float(df["high"].iloc[max(0, ref_end - self.swing_lookback): ref_end].max())
                level = fallback
                last_high = float(df.iloc[-1]["high"])
                if float(df.iloc[-1]["close"]) > fallback:
                    has_bos   = structure_type == "BULLISH"
                    has_choch = not has_bos
                return has_bos, has_choch, level

            # Check each fractal high against all bars AFTER it (within lookback).
            # BOS/CHoCH require a candle CLOSE beyond the level — wicks don't confirm.
            for fh_idx in reversed(valid_hi):
                swing_h = float(df.at[fh_idx, "high"])
                level   = swing_h
                for bar_i in range(max(scan_start, fh_idx + 1), L):
                    bar = df.iloc[bar_i]
                    if float(bar["close"]) > swing_h:
                        has_bos   = structure_type == "BULLISH"
                        has_choch = not has_bos
                        return has_bos, has_choch, swing_h
        else:
            valid_lo = [i for i in frac_lo if i < ref_end]
            if not valid_lo:
                fallback = float(df["low"].iloc[max(0, ref_end - self.swing_lookback): ref_end].min())
                level = fallback
                last_low = float(df.iloc[-1]["low"])
                if float(df.iloc[-1]["close"]) < fallback:
                    has_bos   = structure_type == "BEARISH"
                    has_choch = not has_bos
                return has_bos, has_choch, level

            for fl_idx in reversed(valid_lo):
                swing_l = float(df.at[fl_idx, "low"])
                level   = swing_l
                for bar_i in range(max(scan_start, fl_idx + 1), L):
                    bar = df.iloc[bar_i]
                    if float(bar["close"]) < swing_l:
                        has_bos   = structure_type == "BEARISH"
                        has_choch = not has_bos
                        return has_bos, has_choch, swing_l

        return has_bos, has_choch, level

    def _detect_supply_demand_zone(
        self,
        df:        pd.DataFrame,
        direction: str,
        atr:       float,
        lookback:  int = 40,
    ) -> tuple[bool, float | None, float | None, int]:
        """
        Supply/Demand zone: tight consolidation base → ATR-scaled impulse → retest.
        Zone proximity tolerance = 0.20 × ATR.
        Impulse body must be ≥ 1.2 × ATR and ≥ 60% of candle range.
        """
        is_long    = direction == "LONG"
        window     = df.iloc[-lookback:].reset_index(drop=True)
        n          = len(window)
        last_close = float(df.iloc[-1]["close"])
        avg_range  = float((window["high"] - window["low"]).mean())
        if avg_range < 1e-10 or atr < 1e-10:
            return False, None, None, 0

        tol = atr * 0.60

        for i in range(3, n - 1):
            base_end   = i - 1
            base_start = max(0, base_end - 5)
            base_slice = window.iloc[base_start: base_end + 1]
            if len(base_slice) < 2:
                continue

            base_ranges = base_slice["high"] - base_slice["low"]
            base_bodies = (base_slice["close"] - base_slice["open"]).abs()
            tight = (
                (base_ranges < avg_range * 0.95).all() and
                (base_bodies < base_ranges * 0.72).all()
            )
            if not tight:
                continue

            imp  = window.iloc[i]
            rng  = float(imp["high"] - imp["low"])
            body = abs(float(imp["close"]) - float(imp["open"]))
            if rng < 1e-10:
                continue

            base_high = float(base_slice["high"].max())
            base_low  = float(base_slice["low"].min())

            if is_long:
                valid_impulse = (
                    float(imp["close"]) > float(imp["open"]) and
                    body / rng >= 0.55 and body >= atr * 1.0 and
                    float(imp["close"]) > base_high
                )
            else:
                valid_impulse = (
                    float(imp["close"]) < float(imp["open"]) and
                    body / rng >= 0.55 and body >= atr * 1.0 and
                    float(imp["close"]) < base_low
                )
            if not valid_impulse:
                continue

            in_zone = (base_low - tol) <= last_close <= (base_high + tol)
            if not in_zone:
                continue

            test_count = 0
            inside     = False
            for j in range(i + 1, n):
                bh, bl = float(window.at[j, "high"]), float(window.at[j, "low"])
                entered = bl <= base_high and bh >= base_low
                if entered and not inside:
                    test_count += 1
                inside = entered

            return True, base_high, base_low, max(0, test_count - 1)

        return False, None, None, 0

    def _detect_order_block_smc(
        self,
        df:        pd.DataFrame,
        direction: str,
        disp_start: int,
        atr:       float,
    ) -> tuple[bool, float | None, float | None]:
        """
        Order Block: last opposing candle before the recent displacement.
        Minimum body = 0.15 × ATR.  Zone tolerance = 0.30 × ATR.

        For LONG: last bearish candle before bullish impulse.
        For SHORT: last bullish candle before bearish impulse.
        """
        is_long    = direction == "LONG"
        last_close = float(df.iloc[-1]["close"])
        min_body   = atr * 0.10
        tol        = atr * 0.40
        search_from = max(0, disp_start - 20)

        for i in range(disp_start - 1, search_from - 1, -1):
            if i < 0 or i >= len(df):
                continue
            bar  = df.iloc[i]
            body = abs(float(bar["close"]) - float(bar["open"]))
            if body < min_body:
                continue

            if is_long and float(bar["close"]) < float(bar["open"]):
                ob_top    = float(bar["open"])
                ob_bottom = float(bar["close"])
                if (ob_bottom - tol) <= last_close <= (ob_top + tol):
                    return True, ob_top, ob_bottom

            elif not is_long and float(bar["close"]) > float(bar["open"]):
                ob_top    = float(bar["close"])
                ob_bottom = float(bar["open"])
                if (ob_bottom - tol) <= last_close <= (ob_top + tol):
                    return True, ob_top, ob_bottom

        return False, None, None

    def _detect_equal_highs_lows(
        self,
        df:        pd.DataFrame,
        direction: str,
        lookback:  int = 30,
    ) -> tuple[bool, float | None]:
        """
        Equal Highs (SHORT) / Equal Lows (LONG): ≥2 swing levels within 0.15%.
        Valid when the current bar swept (taken out) the liquidity pool.
        """
        is_long    = direction == "LONG"
        window     = df.iloc[-lookback:].reset_index(drop=True)
        n          = len(window)
        last_low   = float(df.iloc[-1]["low"])
        last_high  = float(df.iloc[-1]["high"])

        levels: list[float] = []
        for i in range(2, n - 2):
            if is_long:
                val = float(window.at[i, "low"])
                if val == window["low"].iloc[i - 2: i + 3].min():
                    levels.append(val)
            else:
                val = float(window.at[i, "high"])
                if val == window["high"].iloc[i - 2: i + 3].max():
                    levels.append(val)

        if len(levels) < 2:
            return False, None

        for ref in levels:
            if ref <= 0:
                continue
            cluster = [v for v in levels if abs(v - ref) / ref <= self.eq_threshold]
            if len(cluster) < 2:
                continue
            pool = float(np.mean(cluster))
            swept = (is_long and last_low <= pool * (1 - self.sweep_threshold)) or \
                    (not is_long and last_high >= pool * (1 + self.sweep_threshold))
            if swept:
                return True, pool

        return False, None

    def _detect_inducement(
        self,
        df:      pd.DataFrame,
        frac_hi: list[int],
        frac_lo: list[int],
        direction: str,
        atr:     float,
    ) -> bool:
        """
        Inducement (IDM): a minor swing level taken out BEFORE the main structural move.
        Price sweeps a small fractal high/low, drawing retail traders in, then reverses.

        For LONG: a minor fractal low was swept in the last 8 bars and price closed above it.
        For SHORT: a minor fractal high was swept in the last 8 bars and price closed below it.
        """
        is_long   = direction == "LONG"
        last_5    = max(0, len(df) - 8)
        buf       = atr * 0.10

        if is_long:
            recent_lows = [i for i in frac_lo if last_5 <= i < len(df) - 1]
            for idx in recent_lows:
                pivot_low  = float(df.at[idx, "low"])
                # A bar near idx swept below it then close reversed above
                for offset in range(0, min(3, len(df))):
                    bar = df.iloc[-(1 + offset)]
                    if float(bar["low"]) < pivot_low - buf and float(bar["close"]) > pivot_low:
                        return True
        else:
            recent_highs = [i for i in frac_hi if last_5 <= i < len(df) - 1]
            for idx in recent_highs:
                pivot_high = float(df.at[idx, "high"])
                for offset in range(0, min(3, len(df))):
                    bar = df.iloc[-(1 + offset)]
                    if float(bar["high"]) > pivot_high + buf and float(bar["close"]) < pivot_high:
                        return True

        return False

    def _detect_displacement_smc(
        self,
        df:        pd.DataFrame,
        direction: str,
        start_idx: int,
        atr:       float,
    ) -> bool:
        """
        Displacement: ≥1 candle with body ≥ 65% of range AND range ≥ 1.2 × ATR.
        """
        is_long = direction == "LONG"
        if atr < 1e-10:
            return False

        for _, row in df.iloc[start_idx:].iterrows():
            rng  = float(row["high"]) - float(row["low"])
            body = abs(float(row["close"]) - float(row["open"]))
            if rng < 1e-10:
                continue
            dir_ok  = (is_long and float(row["close"]) > float(row["open"])) or \
                      (not is_long and float(row["close"]) < float(row["open"]))
            if rng >= atr * 1.2 and body / rng >= 0.65 and dir_ok:
                return True

        return False

    def _detect_fvg_smc(
        self,
        df:        pd.DataFrame,
        direction: str,
        start_idx: int,
        atr:       float,
    ) -> tuple[bool, float | None, float | None]:
        """
        Fair Value Gap (3-candle imbalance).
        Min gap = 0.10 × ATR.  Entry tolerance = 0.25 × ATR.
        """
        is_long    = direction == "LONG"
        last_close = float(df.iloc[-1]["close"])
        min_gap    = max(atr * 0.10, float(df.iloc[-1]["close"]) * self.fvg_min_gap_pct)
        tol        = atr * 0.25
        end        = len(df) - 1

        for i in range(max(start_idx + 1, 1), end):
            a = df.iloc[i - 1]
            c = df.iloc[i + 1]

            if is_long:
                gap = float(c["low"]) - float(a["high"])
                if gap >= min_gap:
                    fvg_bot, fvg_top = float(a["high"]), float(c["low"])
                    if (fvg_bot - tol) <= last_close <= (fvg_top + tol):
                        return True, fvg_top, fvg_bot
            else:
                gap = float(a["low"]) - float(c["high"])
                if gap >= min_gap:
                    fvg_bot, fvg_top = float(c["high"]), float(a["low"])
                    if (fvg_bot - tol) <= last_close <= (fvg_top + tol):
                        return True, fvg_top, fvg_bot

        return False, None, None

    def _detect_mitigation(
        self,
        df:        pd.DataFrame,
        direction: str,
        atr:       float,
        lookback:  int = 30,
    ) -> bool:
        """
        Mitigation block: an invalidated OB retested from the polarity-flipped side.
        LONG: old supply OB broken bullish → now retesting as support.
        SHORT: old demand OB broken bearish → now retesting as resistance.
        """
        is_long    = direction == "LONG"
        window     = df.iloc[-lookback:].reset_index(drop=True)
        n          = len(window)
        last_close = float(df.iloc[-1]["close"])
        tol        = atr * 0.40
        min_body   = atr * 0.10

        for i in range(1, n - 3):
            bar  = window.iloc[i]
            body = abs(float(bar["close"]) - float(bar["open"]))
            if body < min_body:
                continue

            if is_long and float(bar["close"]) < float(bar["open"]):
                ob_top    = float(bar["open"])
                ob_bottom = float(bar["close"])
                future    = window.iloc[i + 1: min(i + 8, n)]
                if not (future["close"] > ob_top).any():
                    continue
                if (ob_bottom - tol) <= last_close <= (ob_top + tol):
                    return True

            elif not is_long and float(bar["close"]) > float(bar["open"]):
                ob_top    = float(bar["close"])
                ob_bottom = float(bar["open"])
                future    = window.iloc[i + 1: min(i + 8, n)]
                if not (future["close"] < ob_bottom).any():
                    continue
                if (ob_bottom - tol) <= last_close <= (ob_top + tol):
                    return True

        return False

    def _premium_discount_context(self, df: pd.DataFrame) -> str:
        """
        Classify current price position relative to the 40-bar range midpoint.
        DISCOUNT = below midpoint (favourable for longs).
        PREMIUM  = above midpoint (favourable for shorts).
        """
        if len(df) < 40:
            return "NEUTRAL"
        window     = df.iloc[-40:]
        hi         = float(window["high"].max())
        lo         = float(window["low"].min())
        if hi <= lo:
            return "NEUTRAL"
        equil      = (hi + lo) / 2.0
        last_close = float(df.iloc[-1]["close"])
        if last_close < equil * 0.998:
            return "DISCOUNT"
        if last_close > equil * 1.002:
            return "PREMIUM"
        return "NEUTRAL"
