"""
Binance Futures WebSocket stream manager.

Subscribes to the !miniTicker@arr stream (one connection, all symbols, 1s updates)
to maintain a live ranking of symbols by momentum — zero REST calls, zero rate-limit
risk.  The scanner uses this ranking to decide which symbols are worth fetching klines
for, cutting REST requests from ~1800/scan to ~300/scan.
"""
import asyncio
import json
import math
from datetime import datetime, timezone
from typing import Callable

from app.core.logging import get_logger

logger = get_logger(__name__)

_WS_URL = "wss://fstream.binance.com/stream?streams=!miniTicker@arr"


class BinanceStreamManager:
    """
    Maintains a live snapshot of all Binance Futures USDT prices and volumes
    via the miniTicker combined stream.

    Usage:
        mgr = BinanceStreamManager()
        await mgr.start()
        top = mgr.get_top_symbols(50)   # ranked by momentum, no REST call
        ticker = mgr.get_ticker("BTCUSDT")
    """

    def __init__(self) -> None:
        self._tickers: dict[str, dict] = {}
        self._task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._stream_loop(), name="binance_ws")
        logger.info("BinanceStreamManager started")

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("BinanceStreamManager stopped")

    # ── Public API ────────────────────────────────────────────────────────────

    # Minimum 24h USDT volume — excludes micro/low-cap coins from scan
    MIN_VOLUME_USDT = 10_000_000  # $10M

    def get_top_symbols(self, n: int = 50) -> list[str]:
        """
        Return the top-N symbols ranked by momentum score.
        Score = log(quote_volume_24h) × |change_24h%|
        Hard gate: minimum $10M 24h USDT volume (established coins only).
        """
        scored: list[tuple[float, str]] = []
        for sym, d in self._tickers.items():
            vol = d["quote_volume"]
            chg = abs(d["change_pct"])
            if vol >= self.MIN_VOLUME_USDT and chg >= 0.5:
                scored.append((math.log1p(vol) * chg, sym))
        scored.sort(reverse=True)
        return [sym for _, sym in scored[:n]]

    def get_ticker(self, symbol: str) -> dict | None:
        return self._tickers.get(symbol)

    def get_all_tickers(self) -> dict[str, dict]:
        return dict(self._tickers)

    @property
    def connected(self) -> bool:
        return bool(self._tickers)

    @property
    def symbol_count(self) -> int:
        return len(self._tickers)

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _stream_loop(self) -> None:
        backoff = 2.0
        while self._running:
            try:
                await self._connect()
                backoff = 2.0  # reset on successful connection
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.warning(
                    "Binance WS disconnected, reconnecting",
                    error=str(exc), backoff=backoff,
                )
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 120.0)

    async def _connect(self) -> None:
        # Import here to avoid hard dependency at module load time
        try:
            import websockets
        except ImportError:
            logger.error("websockets package not installed — pip install websockets")
            await asyncio.sleep(60)
            return

        async with websockets.connect(
            _WS_URL,
            ping_interval=20,
            ping_timeout=10,
            close_timeout=5,
        ) as ws:
            logger.info("Binance miniTicker stream connected")
            async for raw in ws:
                if not self._running:
                    return
                try:
                    msg = json.loads(raw)
                    data = msg.get("data", msg)  # combined stream wraps in {"data": [...]}
                    if isinstance(data, list):
                        self._ingest(data)
                except Exception as exc:
                    logger.debug("Binance WS parse error", error=str(exc))

    def _ingest(self, tickers: list[dict]) -> None:
        now = datetime.now(timezone.utc)
        for t in tickers:
            sym = t.get("s", "")
            if not sym.endswith("USDT"):
                continue
            try:
                self._tickers[sym] = {
                    "price":        float(t["c"]),
                    "open":         float(t["o"]),
                    "high":         float(t["h"]),
                    "low":          float(t["l"]),
                    "volume":       float(t["v"]),        # base asset volume
                    "quote_volume": float(t["q"]),        # USDT volume
                    "change_pct":   float(t["P"]),        # 24h % change
                    "trades":       int(t["n"]),
                    "ts":           now,
                }
            except (KeyError, ValueError):
                pass


# Module-level singleton — shared across scanner and other services
_manager: BinanceStreamManager | None = None


def get_stream_manager() -> BinanceStreamManager:
    global _manager
    if _manager is None:
        _manager = BinanceStreamManager()
    return _manager
