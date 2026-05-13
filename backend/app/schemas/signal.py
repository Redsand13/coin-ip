import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.signal import SignalDirection, SignalSource


class SignalBase(BaseModel):
    symbol: str
    source: SignalSource
    direction: SignalDirection
    timeframe: str
    signal_time: datetime
    price: float
    volume: float | None = None
    market_cap: float | None = None
    ema_fast: float | None = None
    ema_mid: float | None = None
    ema_slow: float | None = None
    ict_pattern: str | None = None
    sweep_high: float | None = None
    sweep_low: float | None = None
    order_block_top: float | None = None
    order_block_bottom: float | None = None
    fvg_top: float | None = None
    fvg_bottom: float | None = None
    confluence_score: float | None = None
    aligned_timeframes: list[str] | None = None
    ml_score: float | None = None
    ml_confidence: float | None = None
    extra: dict[str, Any] | None = None
    notes: str | None = None


class SignalCreate(SignalBase):
    pass


class SignalRead(SignalBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    notified: bool
    outcome_pnl: float | None = None
    outcome_hit_tp: bool | None = None
    outcome_hit_sl: bool | None = None
    created_at: datetime
    updated_at: datetime


class SignalFilter(BaseModel):
    source: SignalSource | None = None
    direction: SignalDirection | None = None
    timeframe: str | None = None
    symbol: str | None = None
    min_ml_score: float | None = Field(None, ge=0.0, le=1.0)
    min_confluence: float | None = Field(None, ge=0.0, le=1.0)
    from_time: datetime | None = None
    to_time: datetime | None = None
    limit: int = Field(100, ge=1, le=1000)
    offset: int = Field(0, ge=0)


class SignalPage(BaseModel):
    total: int
    items: list[SignalRead]
