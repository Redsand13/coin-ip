"""VWAP (Volume-Weighted Average Price) engine with std-dev bands."""
from __future__ import annotations

import math
from collections import deque
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.institutional.state import SymbolState, Trade

STD_WINDOW = 200  # number of recent trades for rolling std dev


def update_vwap(state: "SymbolState", trade: "Trade") -> None:
    state.vwap_num += trade.price * trade.qty
    state.vwap_den += trade.qty
    if state.vwap_den > 0:
        state.vwap = state.vwap_num / state.vwap_den

    state.vwap_std = _rolling_std(state.trades, state.vwap)


def _rolling_std(trades: deque, mean: float) -> float:
    recent = list(trades)[-STD_WINDOW:]
    if len(recent) < 10:
        return 0.0
    sq = sum((t.price - mean) ** 2 * t.qty for t in recent)
    wt = sum(t.qty for t in recent)
    return math.sqrt(sq / wt) if wt > 0 else 0.0


def vwap_zone(state: "SymbolState") -> str:
    """PREMIUM | DISCOUNT | EQUILIBRIUM relative to 1-std VWAP bands."""
    if state.vwap == 0 or state.vwap_std == 0:
        return "EQUILIBRIUM"
    p = state.spot_price
    if p > state.vwap + state.vwap_std:
        return "PREMIUM"
    if p < state.vwap - state.vwap_std:
        return "DISCOUNT"
    return "EQUILIBRIUM"


def vwap_pct(state: "SymbolState") -> float:
    """% distance from VWAP. Negative = below."""
    if state.vwap == 0:
        return 0.0
    return (state.spot_price - state.vwap) / state.vwap * 100
