"""Pydantic response schemas for the institutional order flow API."""
from __future__ import annotations

from pydantic import BaseModel, Field


class DetectionOut(BaseModel):
    kind:       str
    direction:  str
    confidence: float
    details:    dict = Field(default_factory=dict)


class SymbolFlowOut(BaseModel):
    symbol:           str
    spot_price:       float
    futures_price:    float
    mark_price:       float
    funding_rate:     float
    open_interest:    float
    oi_delta:         float
    cvd_5m:           float
    cvd_15m:          float
    cvd_total:        float
    vwap:             float
    vwap_std:         float
    vwap_zone:        str
    vwap_pct:         float
    bid_imbalance:    float
    book_pressure:    float
    volume_24h:       float
    vol_ma5:          float
    liq_buy_usd:      float
    liq_sell_usd:     float
    spot_futures_div: float
    high_24h:         float
    low_24h:          float
    confidence:       float
    direction:        str
    detections:       list[DetectionOut]
    updated_at:       float


class FlowListOut(BaseModel):
    symbols: list[SymbolFlowOut]
    count:   int
    tracked: int
