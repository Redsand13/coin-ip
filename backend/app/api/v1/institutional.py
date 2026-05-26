"""
Institutional Order Flow API.

GET  /institutional/flow          — snapshot of all tracked symbols
GET  /institutional/flow/{symbol} — single symbol snapshot
GET  /institutional/symbols       — list of tracked symbols
GET  /institutional/stream        — SSE real-time alert stream
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone, timedelta

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import ORJSONResponse, StreamingResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select, desc

from app.config import settings
from app.core.logging import get_logger
from app.core.redis import get_redis
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.institutional.pipeline import get_pipeline, state_to_dict

log = get_logger(__name__)

router = APIRouter(prefix="/institutional", tags=["Institutional Flow"])

limiter = Limiter(key_func=get_remote_address)


@router.get("/flow", response_class=ORJSONResponse)
@limiter.limit("120/minute")
async def get_all_flow(
    request: Request,
    min_confidence: float = 0.0,
    direction: str | None = None,
    redis: aioredis.Redis = Depends(get_redis),
) -> dict:
    """
    Snapshot of all tracked symbols sorted by confidence descending.
    Returns every symbol that has price data — no limit.
    Optionally filter by minimum confidence or direction (LONG|SHORT|NEUTRAL).
    Reads from Redis cache; falls back to in-memory pipeline on first startup.
    """
    cache_key = "institutional:flow:all"

    # --- Try cache first ---
    cached = await redis.get(cache_key)
    if cached:
        try:
            all_items: list[dict] = json.loads(cached)
        except Exception:
            all_items = None
    else:
        all_items = None

    tracked_total = 0

    if all_items is None:
        # --- Cache miss: build from per-symbol Redis keys ---
        sym_bytes = await redis.smembers("institutional:symbols")
        symbols   = [s.decode("utf-8") if isinstance(s, bytes) else s for s in sym_bytes] if sym_bytes else []
        tracked_total = len(symbols)

        if symbols:
            # Batch GET all state keys in one round-trip
            async with redis.pipeline(transaction=False) as pipe:
                for sym in symbols:
                    pipe.get(f"institutional:{sym}:state")
                results = await pipe.execute()

            all_items = []
            for raw in results:
                if raw is None:
                    continue
                try:
                    item = json.loads(raw)
                    if item.get("spot_price", 0) == 0:
                        continue
                    all_items.append(item)
                except Exception:
                    continue

            all_items.sort(key=lambda x: x.get("confidence", 0), reverse=True)

        # Fallback to in-memory pipeline when:
        # - institutional:symbols is empty (very first startup), OR
        # - symbols exist in Redis but no state keys populated yet (WebSocket warming up)
        if not all_items:
            pipeline_svc = get_pipeline()
            mem_states   = pipeline_svc.all_states()
            all_items    = []
            for state in mem_states:
                if state.spot_price == 0:
                    continue
                all_items.append(state_to_dict(state.symbol, state))
            all_items.sort(key=lambda x: x.get("confidence", 0), reverse=True)
            tracked_total = tracked_total or len(mem_states)

        # Only cache non-empty results — never lock out warm-up data
        if all_items:
            try:
                await redis.setex(cache_key, settings.FLOW_CACHE_TTL, json.dumps(all_items))
            except Exception as exc:
                log.warning("flow_cache_store_error", error=str(exc))
    else:
        tracked_total = len(all_items)

    # Apply filters in Python after fetching from cache
    items = all_items if all_items else []
    if min_confidence > 0.0:
        items = [x for x in items if x.get("confidence", 0) >= min_confidence]
    if direction:
        dir_upper = direction.upper()
        items = [x for x in items if x.get("direction") == dir_upper]

    return {
        "symbols": items,
        "count":   len(items),
        "tracked": tracked_total,
    }


@router.get("/flow/{symbol}", response_class=ORJSONResponse)
async def get_symbol_flow(
    symbol: str,
    redis: aioredis.Redis = Depends(get_redis),
) -> dict:
    """Single symbol institutional flow snapshot."""
    sym = symbol.upper()

    # Try Redis first
    raw = await redis.get(f"institutional:{sym}:state")
    if raw:
        try:
            return json.loads(raw)
        except Exception:
            pass

    # Fall back to in-memory pipeline
    pipeline = get_pipeline()
    state = pipeline.get_state(sym)
    if state is None:
        raise HTTPException(404, detail=f"Symbol {sym} is not tracked")
    return state_to_dict(state.symbol, state)


@router.get("/symbols", response_class=ORJSONResponse)
async def get_tracked_symbols(
    redis: aioredis.Redis = Depends(get_redis),
) -> dict:
    """List of symbols currently being analysed."""
    sym_bytes = await redis.smembers("institutional:symbols")
    if sym_bytes:
        symbols = sorted(
            s.decode("utf-8") if isinstance(s, bytes) else s for s in sym_bytes
        )
        return {"symbols": symbols, "count": len(symbols)}

    # Fallback to in-memory pipeline during warm-up
    pipeline = get_pipeline()
    return {
        "symbols": pipeline.symbols,
        "count":   len(pipeline.symbols),
    }


@router.get("/history", response_class=ORJSONResponse)
async def get_flow_history(
    symbol: str | None = Query(None, description="Filter by symbol (e.g. BTCUSDT)"),
    hours:  int        = Query(24,   ge=1, le=720, description="Lookback window in hours"),
    db: AsyncSession   = Depends(get_db),
) -> dict:
    """Historical market flow snapshots from PostgreSQL (5-min intervals)."""
    from app.models.market_flow import MarketFlowSnapshot

    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    q = (
        select(MarketFlowSnapshot)
        .where(MarketFlowSnapshot.snapshot_at >= since)
        .order_by(desc(MarketFlowSnapshot.snapshot_at))
    )
    if symbol:
        q = q.where(MarketFlowSnapshot.symbol == symbol.upper())

    result = await db.execute(q)
    rows   = result.scalars().all()

    snapshots = [
        {
            "id":           str(r.id),
            "symbol":       r.symbol,
            "snapshot_at":  r.snapshot_at.isoformat(),
            "spot_price":   r.spot_price,
            "funding_rate": r.funding_rate,
            "open_interest":r.open_interest,
            "oi_delta":     r.oi_delta,
            "cvd_5m":       r.cvd_5m,
            "cvd_15m":      r.cvd_15m,
            "vwap":         r.vwap,
            "vwap_zone":    r.vwap_zone,
            "confidence":   r.confidence,
            "direction":    r.direction,
            "detections":   r.detections or [],
        }
        for r in rows
    ]

    return {"snapshots": snapshots, "count": len(snapshots), "hours": hours}


@router.get("/stream")
@limiter.limit("10/minute")
async def stream_alerts(
    request: Request,
    redis: aioredis.Redis = Depends(get_redis),
) -> StreamingResponse:
    """
    Server-Sent Events stream of live institutional alerts.
    Only signals with confidence >= threshold are published here.
    """
    return StreamingResponse(
        _sse_gen(redis),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":       "keep-alive",
        },
    )


async def _sse_gen(redis: aioredis.Redis):
    pubsub = redis.pubsub()
    await pubsub.subscribe("institutional:live")
    try:
        yield 'data: {"type":"connected"}\n\n'
        while True:
            try:
                msg = await asyncio.wait_for(
                    pubsub.get_message(ignore_subscribe_messages=True),
                    timeout=25.0,
                )
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                continue
            except asyncio.CancelledError:
                break
            except Exception as exc:
                log.error("sse_pubsub_error", error=str(exc))
                yield ": pubsub-error\n\n"
                break

            if msg is None:
                yield ": keepalive\n\n"
                continue

            if msg["type"] == "message":
                data = msg["data"]
                # aioredis may return bytes or str depending on decode_responses setting
                if isinstance(data, bytes):
                    data = data.decode("utf-8", errors="replace")
                yield f"data: {data}\n\n"

    except asyncio.CancelledError:
        pass  # client disconnected — normal
    except Exception as exc:
        log.error("sse_gen_fatal", error=str(exc))
    finally:
        try:
            await pubsub.unsubscribe("institutional:live")
            await pubsub.aclose()
        except Exception as exc:
            log.warning("sse_pubsub_cleanup_failed", error=str(exc))
