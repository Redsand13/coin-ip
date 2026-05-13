import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.backtest import BacktestStatus


class BacktestRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    strategy: str = Field(..., pattern="^(ema3|ict|confluence|ml)$")
    symbol: str | None = None
    timeframe: str = "1h"
    start_date: datetime
    end_date: datetime
    params: dict[str, Any] = Field(default_factory=dict)


class BacktestTradeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    symbol: str
    direction: str
    entry_time: datetime
    exit_time: datetime | None
    entry_price: float
    exit_price: float | None
    pnl_pct: float | None
    exit_reason: str | None
    bars_held: int | None


class BacktestResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    strategy: str
    symbol: str | None
    timeframe: str
    start_date: datetime
    end_date: datetime
    status: BacktestStatus
    error: str | None = None

    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float | None
    total_pnl: float | None
    max_drawdown: float | None
    sharpe_ratio: float | None
    profit_factor: float | None
    avg_win: float | None
    avg_loss: float | None
    expectancy: float | None
    max_consecutive_losses: int | None
    equity_curve: list[dict] | None = None

    created_at: datetime
    completed_at: datetime | None = None
