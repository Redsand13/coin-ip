from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CgCache(Base):
    """One row per cache key — upserted by the scheduler every 2 minutes."""
    __tablename__ = "cg_cache"

    key:        Mapped[str]      = mapped_column(String(64), primary_key=True)
    payload:    Mapped[dict]     = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
