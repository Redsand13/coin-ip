import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, Enum, Float, Index, Integer,
    String, Text, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SignalSource(str, enum.Enum):
    BINANCE = "binance"
    COINGECKO = "coingecko"
    ICT = "ict"


class SignalDirection(str, enum.Enum):
    LONG = "LONG"
    SHORT = "SHORT"


class Signal(Base):
    __tablename__ = "signals"
    __table_args__ = (
        UniqueConstraint("symbol", "source", "timeframe", "signal_time", name="uq_signal"),
        Index("ix_signals_source_tf", "source", "timeframe"),
        Index("ix_signals_symbol", "symbol"),
        Index("ix_signals_created_at", "created_at"),
        Index("ix_signals_score", "ml_score"),
        {"schema": None},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[SignalSource] = mapped_column(Enum(SignalSource), nullable=False)
    direction: Mapped[SignalDirection] = mapped_column(Enum(SignalDirection), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(5), nullable=False)
    signal_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Price data at signal time
    price: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[float | None] = mapped_column(Float)
    market_cap: Mapped[float | None] = mapped_column(Float)

    # EMA values
    ema_fast: Mapped[float | None] = mapped_column(Float)
    ema_mid: Mapped[float | None] = mapped_column(Float)
    ema_slow: Mapped[float | None] = mapped_column(Float)

    # ICT/SMC fields
    ict_pattern: Mapped[str | None] = mapped_column(String(50))
    sweep_high: Mapped[float | None] = mapped_column(Float)
    sweep_low: Mapped[float | None] = mapped_column(Float)
    order_block_top: Mapped[float | None] = mapped_column(Float)
    order_block_bottom: Mapped[float | None] = mapped_column(Float)
    fvg_top: Mapped[float | None] = mapped_column(Float)
    fvg_bottom: Mapped[float | None] = mapped_column(Float)

    # Multi-timeframe confluence
    confluence_score: Mapped[float | None] = mapped_column(Float)
    aligned_timeframes: Mapped[list | None] = mapped_column(JSONB)

    # ML scoring
    ml_score: Mapped[float | None] = mapped_column(Float)
    ml_confidence: Mapped[float | None] = mapped_column(Float)
    ml_features: Mapped[dict | None] = mapped_column(JSONB)

    # Outcome tracking (filled after the fact for ML training)
    outcome_pnl: Mapped[float | None] = mapped_column(Float)
    outcome_hit_tp: Mapped[bool | None] = mapped_column(Boolean)
    outcome_hit_sl: Mapped[bool | None] = mapped_column(Boolean)
    outcome_max_favorable: Mapped[float | None] = mapped_column(Float)
    outcome_max_adverse: Mapped[float | None] = mapped_column(Float)

    # Extra structured metadata
    extra: Mapped[dict | None] = mapped_column(JSONB)
    notes: Mapped[str | None] = mapped_column(Text)

    # Push notification tracking
    notified: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<Signal {self.symbol} {self.direction} {self.timeframe} @ {self.price}>"
