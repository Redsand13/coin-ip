"""Cumulative Volume Delta (CVD) engine.

CVD measures buy vs sell pressure over time:
  - Taker buy  → positive delta  (is_buy = True  when buyer_is_maker = False)
  - Taker sell → negative delta  (is_buy = False when buyer_is_maker = True)

Divergence from price movement is the key institutional footprint:
  - Price falling but CVD rising  → accumulation (smart money buying dips)
  - Price rising  but CVD falling → distribution (smart money selling pumps)
"""
from __future__ import annotations

import time
from collections import deque
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.institutional.state import SymbolState, Trade

WINDOW_5M  = 300.0
WINDOW_15M = 900.0


def update_cvd(state: "SymbolState", trade: "Trade") -> None:
    usd_delta = trade.price * trade.qty
    if trade.is_buy:
        state.cvd_total += usd_delta
    else:
        state.cvd_total -= usd_delta

    now_s = time.time()
    state.cvd_5m  = _window_sum(state.trades, now_s - WINDOW_5M)
    state.cvd_15m = _window_sum(state.trades, now_s - WINDOW_15M)


def _window_sum(trades: deque, since_s: float) -> float:
    total = 0.0
    for t in trades:
        if t.ts / 1000.0 >= since_s:
            v = t.price * t.qty
            total += v if t.is_buy else -v
    return total


def cvd_divergence_score(state: "SymbolState") -> float:
    """
    Returns a score in [-1, +1]:
      +1 = strong accumulation (CVD bullish while price flat/falling)
      -1 = strong distribution (CVD bearish while price flat/rising)
       0 = aligned or insufficient data
    """
    if not state.trades or state.spot_price == 0:
        return 0.0

    cutoff = time.time() - WINDOW_5M
    first  = next((t for t in state.trades if t.ts / 1000.0 >= cutoff), None)
    if first is None or first.price == 0:
        return 0.0

    price_change = (state.spot_price - first.price) / first.price  # fraction

    # Normalise CVD against a reference volume to get a comparable fraction
    ref_vol = max(abs(state.cvd_total), state.vol_ma5 * WINDOW_5M, 1.0)
    cvd_norm = state.cvd_5m / ref_vol

    # Price nearly flat → the CVD direction alone is the signal
    if abs(price_change) < 0.001:
        return max(-1.0, min(1.0, cvd_norm * 3))

    # Divergence: CVD direction opposes price direction
    if price_change < -0.001 and state.cvd_5m > 0:
        return min(+1.0, abs(cvd_norm) + abs(price_change) * 5)   # accumulation

    if price_change > +0.001 and state.cvd_5m < 0:
        return max(-1.0, -(abs(cvd_norm) + abs(price_change) * 5))  # distribution

    return 0.0
