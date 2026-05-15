from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import ORJSONResponse, StreamingResponse
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.security import require_api_key
from app.database import get_db
from app.models.signal import Signal, SignalSource, SignalDirection
from app.schemas.signal import SignalPage, SignalRead
import time

import httpx

from app.services.binance_ws import get_stream_manager

logger = get_logger(__name__)

router = APIRouter(prefix="/signals", tags=["Signals"])


# In-process ticker cache: (data_dict, fetched_at)
_ticker_cache: dict[str, float | str] = {}
_ticker_cache_ts: float = 0.0
_TICKER_CACHE_TTL = 60.0  # seconds


async def _get_ticker_map() -> dict[str, dict]:
    """
    Returns {symbol: ticker_dict} with 24h Binance Futures data.
    Tries in-memory WS first (zero cost), falls back to REST (one bulk call,
    cached 60s). Always returns data regardless of which uvicorn instance answers.
    """
    global _ticker_cache, _ticker_cache_ts

    # 1. WS manager — instant, no network
    ws = get_stream_manager()
    if ws.symbol_count >= 50:
        return {sym: d for sym, d in ws.get_all_tickers().items()}

    # 2. In-process REST cache
    now = time.monotonic()
    if _ticker_cache and (now - _ticker_cache_ts) < _TICKER_CACHE_TTL:
        return _ticker_cache  # type: ignore[return-value]

    # 3. Fetch from Binance (one bulk call ~40 weight)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=4.0)) as c:
            r = await c.get("https://fapi.binance.com/fapi/v1/ticker/24hr")
            r.raise_for_status()
            raw = r.json()
        _ticker_cache = {t["symbol"]: t for t in raw if "symbol" in t}
        _ticker_cache_ts = time.monotonic()
        return _ticker_cache  # type: ignore[return-value]
    except Exception as exc:
        logger.warning("Ticker cache fetch failed", error=str(exc))
        return {}


async def _enrich_with_live(signals: list[SignalRead]) -> list[SignalRead]:
    """
    Inject live 24h market data into signals that are missing change_24h /
    volume_usdt_24h.  Works in every uvicorn instance — uses WS manager when
    warm, falls back to a cached REST call otherwise.
    """
    needs_enrichment = any(
        s.extra is None or
        s.extra.get("change_24h") is None or
        s.extra.get("volume_usdt_24h") is None
        for s in signals
    )
    if not needs_enrichment:
        return signals

    ticker_map = await _get_ticker_map()
    if not ticker_map:
        return signals

    enriched = []
    for sig in signals:
        extra = dict(sig.extra or {})
        if extra.get("change_24h") is None or extra.get("volume_usdt_24h") is None:
            tick = ticker_map.get(sig.symbol)
            if tick:
                # WS ticker keys differ from REST ticker keys — handle both
                if extra.get("change_24h") is None:
                    val = tick.get("change_pct") or tick.get("priceChangePercent")
                    if val is not None:
                        extra["change_24h"] = round(float(val), 4)
                if extra.get("volume_usdt_24h") is None:
                    val = tick.get("quote_volume") or tick.get("quoteVolume")
                    if val is not None:
                        extra["volume_usdt_24h"] = round(float(val), 2)
                sig = sig.model_copy(update={"extra": extra})
        enriched.append(sig)
    return enriched

# Default look-back window for terminal queries (no explicit from_ts)
_DEFAULT_WINDOW_HOURS = 48


def _apply_filters(q, *, source, direction, timeframe, symbol, min_ml_score,
                   min_confluence, from_ts, to_ts):
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
    if from_ts is not None:
        q = q.where(Signal.created_at >= datetime.fromtimestamp(from_ts / 1000, tz=timezone.utc))
    if to_ts is not None:
        q = q.where(Signal.created_at <= datetime.fromtimestamp(to_ts / 1000, tz=timezone.utc))
    return q


@router.get("/stream")
async def signal_stream(request: Request) -> StreamingResponse:
    """
    Server-Sent Events stream.  Pushes new signals to the browser in real-time
    by subscribing to the Redis 'signals:live' pub/sub channel.
    Each event is a JSON object with symbol, source, direction, timeframe, price.
    """
    async def _generate():
        try:
            import redis.asyncio as aioredis
            from app.core.redis import get_pool
            redis = aioredis.Redis(connection_pool=get_pool())
            pubsub = redis.pubsub()
            await pubsub.subscribe("signals:live")
            # Immediate keepalive so the browser doesn't time out before the first signal
            yield ": keepalive\n\n"
            async for msg in pubsub.listen():
                if await request.is_disconnected():
                    break
                if msg["type"] != "message":
                    continue
                data = msg["data"]
                if isinstance(data, bytes):
                    data = data.decode()
                yield f"data: {data}\n\n"
        except Exception as exc:
            logger.warning("SSE stream error", error=str(exc))
        finally:
            try:
                await pubsub.unsubscribe("signals:live")
                await redis.aclose()
            except Exception as exc:
                logger.debug("SSE cleanup error", error=str(exc))

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("", response_model=SignalPage, response_class=ORJSONResponse)
async def list_signals(
    source: SignalSource | None = None,
    direction: SignalDirection | None = None,
    timeframe: str | None = None,
    symbol: str | None = None,
    min_ml_score: float | None = Query(None, ge=0.0, le=1.0),
    min_confluence: float | None = Query(None, ge=0.0, le=1.0),
    from_ts: int | None = Query(None, description="Start epoch milliseconds"),
    to_ts: int | None = Query(None, description="End epoch milliseconds"),
    latest_per_coin: bool = Query(False, description="Return only the latest signal per symbol"),
    skip_count: bool = Query(False, description="Skip COUNT(*) for faster terminal queries"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    # Apply implicit 48h window when no explicit time range given — keeps queries fast
    if from_ts is None and to_ts is None:
        from_ts = int((datetime.now(timezone.utc) - timedelta(hours=_DEFAULT_WINDOW_HOURS)).timestamp() * 1000)

    kw = dict(source=source, direction=direction, timeframe=timeframe, symbol=symbol,
              min_ml_score=min_ml_score, min_confluence=min_confluence,
              from_ts=from_ts, to_ts=to_ts)

    if latest_per_coin:
        # DISTINCT ON (symbol, source, timeframe) gives the single most-recent row
        # per (symbol, source, timeframe) triplet — one signal per coin per TF.
        rows_q = (
            _apply_filters(select(Signal), **kw)
            .order_by(Signal.symbol, Signal.source, Signal.timeframe, Signal.created_at.desc())
            .distinct(Signal.symbol, Signal.source, Signal.timeframe)
            .limit(limit)
            .offset(offset)
        )
        rows  = (await db.execute(rows_q)).scalars().all()
        # Re-sort result in Python by score desc so best signals appear first
        rows  = sorted(rows, key=lambda r: (r.ml_score or 0), reverse=True)
        total = -1 if skip_count else len(rows)
    else:
        base_q = _apply_filters(select(Signal), **kw)
        if skip_count:
            total = -1
        else:
            total = (await db.execute(select(func.count()).select_from(base_q.subquery()))).scalar_one()
        rows = (
            await db.execute(base_q.order_by(Signal.created_at.desc()).limit(limit).offset(offset))
        ).scalars().all()

    items = await _enrich_with_live([SignalRead.model_validate(r) for r in rows])
    return {"total": total, "items": items}


@router.get("/top", response_class=ORJSONResponse)
async def top_signals(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Highest ML-scored signals from the last 24 hours."""
    from datetime import timedelta
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
