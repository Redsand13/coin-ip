"""
Smart WebSocket manager for Binance spot + futures streams.
Uses combined stream endpoints to batch subscriptions and avoid rate limits.
Max 200 streams per connection; auto-reconnects with exponential backoff.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import TypeAlias

import websockets
from websockets.exceptions import ConnectionClosed

from app.core.logging import get_logger

log = get_logger(__name__)

Handler: TypeAlias = Callable[[dict], Awaitable[None]]

SPOT_WS    = "wss://stream.binance.com:9443/stream"
FUTURES_WS = "wss://fstream.binance.com/stream"
MAX_PER_CONN = 200  # Binance allows up to 1024; 200 is conservative


class StreamManager:
    """
    Manages batched WebSocket connections to Binance spot and futures.
    Each connection handles up to MAX_PER_CONN streams; additional batches
    get their own connection automatically.
    """

    def __init__(self) -> None:
        self._spot:    dict[str, Handler] = {}
        self._futures: dict[str, Handler] = {}
        self._running  = False
        self._tasks:   list[asyncio.Task] = []

    def add_spot(self, stream: str, handler: Handler) -> None:
        self._spot[stream] = handler

    def add_futures(self, stream: str, handler: Handler) -> None:
        self._futures[stream] = handler

    async def start(self) -> None:
        self._running = True
        self._tasks   = []
        for base_url, handlers in (
            (SPOT_WS,    self._spot),
            (FUTURES_WS, self._futures),
        ):
            streams = list(handlers.keys())
            if not streams:
                continue
            for i in range(0, len(streams), MAX_PER_CONN):
                batch = streams[i : i + MAX_PER_CONN]
                t = asyncio.create_task(self._run(base_url, batch, handlers))
                self._tasks.append(t)

    async def stop(self) -> None:
        self._running = False
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []

    async def _run(
        self,
        base_url: str,
        streams:  list[str],
        handlers: dict[str, Handler],
    ) -> None:
        url     = f"{base_url}?streams={'/'.join(streams)}"
        backoff = 1.0

        while self._running:
            try:
                async with websockets.connect(
                    url,
                    ping_interval=20,
                    ping_timeout=10,
                    close_timeout=5,
                ) as ws:
                    backoff = 1.0
                    log.info("ws_connected", base=base_url, n_streams=len(streams))

                    async for raw in ws:
                        if not self._running:
                            break
                        try:
                            msg  = json.loads(raw)
                            name = msg.get("stream", "")
                            data = msg.get("data", msg)
                            h    = handlers.get(name)
                            if h:
                                await h(data)
                        except Exception as exc:
                            log.warning("dispatch_error", error=str(exc))

            except ConnectionClosed as exc:
                log.warning("ws_closed", reason=str(exc), backoff=backoff)
            except Exception as exc:
                log.error("ws_error", error=str(exc), backoff=backoff)

            if self._running:
                await asyncio.sleep(min(backoff, 60.0))
                backoff = min(backoff * 2, 60.0)
