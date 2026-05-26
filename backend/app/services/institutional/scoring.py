"""Institutional confidence scoring system.

Weighted combination of individual detector outputs → 0–100 score.
Direction = whichever side has materially more weighted confidence.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.institutional.state import Detection

# Per-kind weights (relative importance).
# Higher = stronger institutional footprint, better historical reliability.
WEIGHTS: dict[str, float] = {
    "ACCUMULATION":       28.0,
    "DISTRIBUTION":       28.0,
    "WHALE_BUY":          22.0,
    "WHALE_SELL":         22.0,
    "ABSORPTION_BUY":     16.0,
    "ABSORPTION_SELL":    16.0,
    "ICEBERG_BID":        10.0,
    "ICEBERG_ASK":        10.0,
    "SPOOF_BID":           8.0,
    "SPOOF_ASK":           8.0,
    "LIQUIDITY_GRAB_LOW": 20.0,
    "LIQUIDITY_GRAB_HIGH":20.0,
    "STOP_HUNT_LOW":      17.0,
    "STOP_HUNT_HIGH":     17.0,
    "REAL_BREAKOUT_UP":   22.0,
    "REAL_BREAKOUT_DOWN": 22.0,
    "FAKE_BREAKOUT_UP":   12.0,
    "FAKE_BREAKOUT_DOWN": 12.0,
    "SMART_LONG":         25.0,
    "SMART_SHORT":        25.0,
    "RETAIL_LONG_TRAP":   18.0,
    "RETAIL_SHORT_TRAP":  18.0,
}


def compute(detections: list["Detection"]) -> tuple[float, str]:
    """
    Returns:
      score     – 0.0–100.0 institutional confidence
      direction – "LONG" | "SHORT" | "NEUTRAL"

    Multi-signal confirmation raises the score multiplicatively:
    each additional aligned detection adds more than its base weight alone.
    """
    if not detections:
        return 0.0, "NEUTRAL"

    long_score  = 0.0
    short_score = 0.0

    for d in detections:
        w      = WEIGHTS.get(d.kind, 10.0)
        contrib = w * d.confidence
        if d.direction == "LONG":
            long_score  += contrib
        elif d.direction == "SHORT":
            short_score += contrib

    raw = long_score + short_score
    # Apply a diminishing-returns cap so score stays ≤ 100
    score = min(raw * (100 / max(raw, 100)), 100.0) if raw > 0 else 0.0

    if long_score > short_score * 1.25:
        direction = "LONG"
    elif short_score > long_score * 1.25:
        direction = "SHORT"
    else:
        direction = "NEUTRAL"

    return round(score, 2), direction
