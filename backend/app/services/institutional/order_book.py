"""Order book state management + microstructure analysis.

Provides:
  - Bid/ask imbalance (directional pressure)
  - Iceberg order detection (level that keeps refreshing = hidden size)
  - Spoofing detection (large order vanishes before execution)
"""
from __future__ import annotations

import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.institutional.state import SymbolState

BOOK_DEPTH      = 20      # levels used for imbalance calculation
ICEBERG_REFRESH = 3       # same level must refresh ≥ N times within window
SPOOF_USD_MIN   = 50_000  # order size that triggers spoof watch
SPOOF_TTL_S     = 30.0    # spoof event expires after N seconds


def update_order_book(
    state: "SymbolState",
    bids:  list[list[str]],
    asks:  list[list[str]],
) -> None:
    """
    Apply a Binance depth snapshot (bids/asks as [[price, size], ...]).
    Sizes of "0" mean the level was removed.
    """
    new_bids = {float(p): float(s) for p, s in bids if float(s) > 0}
    new_asks = {float(p): float(s) for p, s in asks if float(s) > 0}

    _detect_icebergs(state, new_bids, new_asks)
    _detect_spoofing(state, new_bids, new_asks)

    state.prev_bids = dict(state.bids)
    state.prev_asks = dict(state.asks)
    state.bids = new_bids
    state.asks = new_asks

    _calc_imbalance(state)


# ── Imbalance ──────────────────────────────────────────────────────────────────

def _calc_imbalance(state: "SymbolState") -> None:
    top_bids = sorted(state.bids.keys(), reverse=True)[:BOOK_DEPTH]
    top_asks = sorted(state.asks.keys())[:BOOK_DEPTH]

    bid_usd = sum(state.bids[p] * p for p in top_bids)
    ask_usd = sum(state.asks[p] * p for p in top_asks)
    total   = bid_usd + ask_usd

    if total == 0:
        state.bid_imbalance = 0.5
        state.book_pressure = 0.0
    else:
        state.bid_imbalance = bid_usd / total
        state.book_pressure = (bid_usd - ask_usd) / total


# ── Iceberg detection ──────────────────────────────────────────────────────────

_ICEBERG_GROWTH = 1.20  # size must grow ≥20 % to count as a replenishment event


def _detect_icebergs(
    state:    "SymbolState",
    new_bids: dict[float, float],
    new_asks: dict[float, float],
) -> None:
    """
    Iceberg signature: a price level's size grows ≥ _ICEBERG_GROWTH between
    two consecutive depth snapshots.  This means the hidden portion of a large
    order was refilled after partial consumption.

    NOTE: state.bids holds the previous snapshot at detection time because
    update_order_book calls this function before updating state.bids.
    We compare new_bids (incoming) vs state.bids (last snapshot) — consecutive.
    """
    for p, new_s in new_bids.items():
        curr_s = state.bids.get(p, 0.0)   # size in the LAST snapshot
        if curr_s > 0 and new_s >= curr_s * _ICEBERG_GROWTH:
            # Level grew significantly → replenishment after partial fill
            state.bid_refresh_counts[p] = state.bid_refresh_counts.get(p, 0) + 1
        elif p not in state.bids:
            state.bid_refresh_counts[p] = 1  # brand-new level; start tracking
        # size dropped or unchanged — consumption phase; don't increment

    for p, new_s in new_asks.items():
        curr_s = state.asks.get(p, 0.0)
        if curr_s > 0 and new_s >= curr_s * _ICEBERG_GROWTH:
            state.ask_refresh_counts[p] = state.ask_refresh_counts.get(p, 0) + 1
        elif p not in state.asks:
            state.ask_refresh_counts[p] = 1

    # Prune levels that left the book
    for p in list(state.bid_refresh_counts):
        if p not in new_bids:
            del state.bid_refresh_counts[p]
    for p in list(state.ask_refresh_counts):
        if p not in new_asks:
            del state.ask_refresh_counts[p]


# ── Spoof detection ────────────────────────────────────────────────────────────

def _detect_spoofing(
    state:    "SymbolState",
    new_bids: dict[float, float],
    new_asks: dict[float, float],
) -> None:
    """
    A large order that disappears from the book without a matching aggTrade
    is a spoofing candidate.  Flagged as *spoof-like*, not confirmed.

    Uses state.bids/asks (the current book at detection time, i.e. last snapshot)
    and compares against new_bids/new_asks (incoming snapshot).
    """
    now = time.time()
    for p, s in state.bids.items():    # state.bids = last snapshot
        if s * p >= SPOOF_USD_MIN and p not in new_bids:
            state.spoof_events.append({"side": "bid", "price": p, "usd": s * p, "ts": now})

    for p, s in state.asks.items():
        if s * p >= SPOOF_USD_MIN and p not in new_asks:
            state.spoof_events.append({"side": "ask", "price": p, "usd": s * p, "ts": now})

    # Expire old events
    cutoff = now - SPOOF_TTL_S
    while state.spoof_events and state.spoof_events[0]["ts"] < cutoff:
        state.spoof_events.popleft()


# ── Query helpers ──────────────────────────────────────────────────────────────

def iceberg_bid_level(state: "SymbolState") -> tuple[bool, float]:
    """(detected, best_price_level)"""
    cands = [p for p, c in state.bid_refresh_counts.items() if c >= ICEBERG_REFRESH]
    if cands:
        return True, max(cands)
    return False, 0.0


def iceberg_ask_level(state: "SymbolState") -> tuple[bool, float]:
    cands = [p for p, c in state.ask_refresh_counts.items() if c >= ICEBERG_REFRESH]
    if cands:
        return True, min(cands)
    return False, 0.0


def spoof_bid_active(state: "SymbolState") -> bool:
    return any(e["side"] == "bid" for e in state.spoof_events)


def spoof_ask_active(state: "SymbolState") -> bool:
    return any(e["side"] == "ask" for e in state.spoof_events)
