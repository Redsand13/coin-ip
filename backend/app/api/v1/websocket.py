"""
WebSocket endpoint — streams live signals from Redis pub/sub
to connected browser clients.
"""
import asyncio

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.logging import get_logger
from app.core.redis import get_pool

logger = get_logger(__name__)
router = APIRouter(tags=["WebSocket"])

_CHANNEL = "signals:live"


class ConnectionManager:
    def __init__(self) -> None:
        self._active: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._active.add(ws)
        logger.info("WS client connected", total=len(self._active))

    def disconnect(self, ws: WebSocket) -> None:
        self._active.discard(ws)
        logger.info("WS client disconnected", total=len(self._active))

    async def broadcast(self, message: str) -> None:
        dead: set[WebSocket] = set()
        for ws in self._active:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._active.discard(ws)

    @property
    def count(self) -> int:
        return len(self._active)


manager = ConnectionManager()


@router.websocket("/ws/signals")
async def signals_ws(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    redis = aioredis.Redis(connection_pool=get_pool())
    pubsub = redis.pubsub()
    await pubsub.subscribe(_CHANNEL)

    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                await websocket.send_text(message["data"])
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("WS error", error=str(exc))
    finally:
        await pubsub.unsubscribe(_CHANNEL)
        await redis.aclose()
        manager.disconnect(websocket)


@router.get("/ws/status")
async def ws_status() -> dict:
    return {"connected_clients": manager.count}
