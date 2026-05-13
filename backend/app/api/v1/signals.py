from uuid import UUID

import orjson
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import ORJSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_api_key
from app.database import get_db
from app.models.signal import Signal, SignalSource, SignalDirection
from app.schemas.signal import SignalFilter, SignalPage, SignalRead

router = APIRouter(prefix="/signals", tags=["Signals"])


@router.get("", response_model=SignalPage, response_class=ORJSONResponse)
async def list_signals(
    source: SignalSource | None = None,
    direction: SignalDirection | None = None,
    timeframe: str | None = None,
    symbol: str | None = None,
    min_ml_score: float | None = Query(None, ge=0.0, le=1.0),
    min_confluence: float | None = Query(None, ge=0.0, le=1.0),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    q = select(Signal)
    if source:
        q = q.where(Signal.source == source)
    if direction:
        q = q.where(Signal.direction == direction)
    if timeframe:
        q = q.where(Signal.timeframe == timeframe)
    if symbol:
        q = q.where(Signal.symbol.ilike(f"%{symbol}%"))
    if min_ml_score is not None:
        q = q.where(Signal.ml_score >= min_ml_score)
    if min_confluence is not None:
        q = q.where(Signal.confluence_score >= min_confluence)

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()

    q = q.order_by(Signal.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(q)).scalars().all()

    return {"total": total, "items": [SignalRead.model_validate(r) for r in rows]}


@router.get("/top", response_class=ORJSONResponse)
async def top_signals(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Highest ML-scored signals from the last 24 hours."""
    from datetime import datetime, timedelta, timezone
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    q = (
        select(Signal)
        .where(Signal.created_at >= cutoff, Signal.ml_score.isnot(None))
        .order_by(Signal.ml_score.desc())
        .limit(limit)
    )
    rows = (await db.execute(q)).scalars().all()
    return [SignalRead.model_validate(r).model_dump() for r in rows]


@router.get("/{signal_id}", response_model=SignalRead, response_class=ORJSONResponse)
async def get_signal(
    signal_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SignalRead:
    row = await db.get(Signal, signal_id)
    if not row:
        raise HTTPException(status_code=404, detail="Signal not found")
    return SignalRead.model_validate(row)


@router.patch("/{signal_id}/outcome", response_class=ORJSONResponse)
async def record_outcome(
    signal_id: UUID,
    outcome_pnl: float,
    outcome_hit_tp: bool | None = None,
    outcome_hit_sl: bool | None = None,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_api_key),
) -> dict:
    row = await db.get(Signal, signal_id)
    if not row:
        raise HTTPException(status_code=404, detail="Signal not found")
    row.outcome_pnl = outcome_pnl
    row.outcome_hit_tp = outcome_hit_tp
    row.outcome_hit_sl = outcome_hit_sl
    await db.commit()
    return {"status": "updated"}
