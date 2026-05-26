import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MarketFlowSnapshot(Base):
    """Periodic snapshot of every tracked symbol's market flow state.

    Written every PERSIST_INTERVAL_S seconds by the institutional pipeline.
    Indexed for efficient time-range + symbol queries.
    """
    __tablename__ = "market_flow_snapshots"
    __table_args__ = (
        Index("ix_mfs_symbol_ts",    "symbol", "snapshot_at"),
        Index("ix_mfs_snapshot_at",  "snapshot_at"),
        Index("ix_mfs_confidence",   "confidence"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    symbol:      Mapped[str]      = mapped_column(String(20), nullable=False)
    snapshot_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Prices
    spot_price:    Mapped[float] = mapped_column(Float, default=0.0)
    futures_price: Mapped[float] = mapped_column(Float, default=0.0)
    mark_price:    Mapped[float] = mapped_column(Float, default=0.0)
    funding_rate:  Mapped[float] = mapped_column(Float, default=0.0)

    # Open interest
    open_interest: Mapped[float] = mapped_column(Float, default=0.0)
    oi_delta:      Mapped[float] = mapped_column(Float, default=0.0)

    # CVD
    cvd_5m:    Mapped[float] = mapped_column(Float, default=0.0)
    cvd_15m:   Mapped[float] = mapped_column(Float, default=0.0)
    cvd_total: Mapped[float] = mapped_column(Float, default=0.0)

    # VWAP
    vwap:      Mapped[float]       = mapped_column(Float, default=0.0)
    vwap_zone: Mapped[str | None]  = mapped_column(String(20))
    vwap_pct:  Mapped[float]       = mapped_column(Float, default=0.0)

    # Order book
    bid_imbalance: Mapped[float] = mapped_column(Float, default=0.0)
    book_pressure: Mapped[float] = mapped_column(Float, default=0.0)

    # Volume & liquidations
    volume_24h:   Mapped[float] = mapped_column(Float, default=0.0)
    liq_buy_usd:  Mapped[float] = mapped_column(Float, default=0.0)
    liq_sell_usd: Mapped[float] = mapped_column(Float, default=0.0)

    # Signal output
    confidence: Mapped[float]      = mapped_column(Float, default=0.0)
    direction:  Mapped[str]        = mapped_column(String(10), default="NEUTRAL")
    detections: Mapped[list | None] = mapped_column(JSONB)
