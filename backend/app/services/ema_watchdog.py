"""
Real-time EMA crossover watchdog.

Subscribes to Binance Futures kline WebSocket streams and fires EMA crossover
signals the instant each candle closes — no polling delay, 24/7.

Architecture
────────────
1. Startup: seed 200-candle history from REST for top-N symbols × 6 TFs
2. Connect to TWO combined kline streams (30 symbols each, 180 streams/conn)
   to watch up to 60 symbols simultaneously within Binance's per-connection limit
3. On live candle tick: throttled check every 10 s — fires the instant a crossover
   is detected without waiting for candle close
4. On closed candle (k.x == true): permanent buffer append + final crossover check
5. Auto-reconnect with exponential backoff on disconnect
6. Refresh watched symbols every 4 hours from the momentum WS ranking

The periodic REST scanner (every 60 s) acts as a safety net for anything
missed during reconnection windows.
"""
import asyncio
import json
import time
from collections import deque
from datetime import datetime, timezone

import pandas as pd

from app.algorithms.ema import EMAStrategy
from app.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_BUFFER_SIZE          = 250    # rolling candles kept per symbol/TF
_SEED_CANDLES         = 200    # candles to pre-load from REST
_STREAMS_PER_CONN     = 180    # safe cap (Binance hard limit = 200)
_SYMS_PER_CONN        = _STREAMS_PER_CONN // len(settings.TIMEFRAMES or ["5m","15m","30m","1h","4h","1d"])
_MAX_SYMBOLS          = _SYMS_PER_CONN * 2   # 2 connections = 60 symbols (30 each @ 6 TFs)
_SYMBOL_REFRESH_HOURS = 4      # refresh watched symbols every N hours
_LIVE_CHECK_INTERVAL  = 10.0   # seconds between live-candle crossover checks per symbol/TF

_ema_strategy = EMAStrategy(settings.EMA_FAST, settings.EMA_MID, settings.EMA_SLOW)


class EMAWatchdog:
    """
    Detects EMA 7/25/99 crossovers in real-time via two Binance kline WS connections.
    A crossover is detected and stored within ~1 s of candle close.
    """

    def __init__(self) -> None:
        self._buffers: dict[tuple[str, str], deque] = {}
        self._seen: set[str] = set()
        self._symbols: list[str] = []
        self._stream_tasks: list[asyncio.Task] = []
        self._refresh_task: asyncio.Task | None = None
        self._running = False
        self._db_sem = asyncio.Semaphore(4)
        self._last_live_check: dict[tuple[str, str], float] = {}

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def start(self) -> None:
        self._running = True
        await self._refresh_symbols()
        # Seed buffers in background — server starts immediately, WS skips
        # crossover checks for unseeded symbols until their buffers fill up.
        asyncio.create_task(self._seed_all_buffers(), name="ema_watchdog_seed")
        self._start_stream_tasks()
        self._refresh_task = asyncio.create_task(self._refresh_loop(), name="ema_watchdog_refresh")
        logger.info("EMAWatchdog started", symbols=len(self._symbols),
                    timeframes=len(settings.TIMEFRAMES), connections=len(self._stream_tasks))

    async def stop(self) -> None:
        self._running = False
        for t in self._stream_tasks + ([self._refresh_task] if self._refresh_task else []):
            if t and not t.done():
                t.cancel()
                try:
                    await t
                except asyncio.CancelledError:
                    pass
        self._stream_tasks = []
        logger.info("EMAWatchdog stopped")

    def _start_stream_tasks(self) -> None:
        """Create one WS task per symbol chunk."""
        for t in self._stream_tasks:
            if not t.done():
                t.cancel()
        self._stream_tasks = []
        chunks = self._symbol_chunks()
        for idx, chunk in enumerate(chunks):
            task = asyncio.create_task(
                self._stream_loop(chunk),
                name=f"ema_watchdog_ws_{idx}",
            )
            self._stream_tasks.append(task)

    def _symbol_chunks(self) -> list[list[str]]:
        """Split symbols into groups that fit within per-connection stream limit."""
        n = max(1, _SYMS_PER_CONN)
        return [self._symbols[i: i + n] for i in range(0, len(self._symbols), n)]

    # ── Symbol management ─────────────────────────────────────────────────────

    async def _refresh_symbols(self) -> None:
        from app.services.binance_ws import get_stream_manager
        from app.services.binance import BinanceFuturesClient

        ws = get_stream_manager()
        if ws.symbol_count >= 10:
            self._symbols = ws.get_top_symbols(_MAX_SYMBOLS)
        else:
            try:
                async with BinanceFuturesClient() as client:
                    all_syms = await client.get_usdt_symbols()
                self._symbols = all_syms[:_MAX_SYMBOLS]
            except Exception as exc:
                logger.warning("EMAWatchdog cold-start symbol fetch failed", error=str(exc))
                self._symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]

        logger.info("EMAWatchdog watching symbols", count=len(self._symbols))

    async def _refresh_loop(self) -> None:
        while self._running:
            await asyncio.sleep(_SYMBOL_REFRESH_HOURS * 3600)
            if not self._running:
                return

            old = set(self._symbols)
            await self._refresh_symbols()
            new = set(self._symbols)
            added = new - old

            if added:
                logger.info("EMAWatchdog: new symbols detected, seeding in background", added=len(added))
                asyncio.create_task(self._seed_symbols(list(added)), name="ema_watchdog_reseed")

            # Restart all stream tasks with updated symbol set
            self._start_stream_tasks()

    # ── Buffer seeding (REST) ─────────────────────────────────────────────────

    async def _seed_all_buffers(self) -> None:
        await self._seed_symbols(list(self._symbols))

    async def _seed_symbols(self, symbols: list[str]) -> None:
        from app.services.binance import BinanceFuturesClient

        logger.info("EMAWatchdog seeding candle buffers", symbols=len(symbols))
        async with BinanceFuturesClient() as client:
            for sym in symbols:
                for tf in settings.TIMEFRAMES:
                    await self._seed_one(client, sym, tf)
                    await asyncio.sleep(0.08)
        logger.info("EMAWatchdog seeding complete", symbols=len(symbols))

    async def _seed_one(self, client, symbol: str, tf: str) -> None:
        try:
            df = await client.get_klines(symbol, tf, limit=_SEED_CANDLES)
            if df is None or df.empty:
                return
            key = (symbol, tf)
            buf: deque = deque(maxlen=_BUFFER_SIZE)
            for _, row in df.iloc[:-1].iterrows():
                buf.append({
                    "open_time": row["open_time"],
                    "open":   float(row["open"]),
                    "high":   float(row["high"]),
                    "low":    float(row["low"]),
                    "close":  float(row["close"]),
                    "volume": float(row["volume"]),
                })
            self._buffers[key] = buf
        except Exception as exc:
            logger.debug("EMAWatchdog seed failed", symbol=symbol, tf=tf, error=str(exc))

    # ── WebSocket stream ──────────────────────────────────────────────────────

    def _build_stream_url(self, symbols: list[str]) -> str:
        tfs = settings.TIMEFRAMES or ["5m", "15m", "30m", "1h", "4h", "1d"]
        streams = [f"{sym.lower()}@kline_{tf}" for sym in symbols for tf in tfs]
        streams = streams[:_STREAMS_PER_CONN]
        base = settings.BINANCE_WS_URL.rstrip("/")
        return f"{base}/stream?streams={'/'.join(streams)}"

    async def _stream_loop(self, symbols: list[str]) -> None:
        backoff = 2.0
        while self._running:
            try:
                await self._connect(symbols)
                backoff = 2.0
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.warning("EMAWatchdog WS disconnected, reconnecting",
                               error=str(exc), backoff=backoff, syms=len(symbols))
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60.0)

    async def _connect(self, symbols: list[str]) -> None:
        try:
            import websockets
        except ImportError:
            logger.error("websockets package not installed — pip install websockets")
            await asyncio.sleep(60)
            return

        if not symbols:
            await asyncio.sleep(30)
            return

        url = self._build_stream_url(symbols)
        logger.info("EMAWatchdog kline stream connecting", syms=len(symbols))

        async with websockets.connect(
            url,
            ping_interval=20,
            ping_timeout=10,
            close_timeout=5,
        ) as ws:
            logger.info("EMAWatchdog kline stream connected", syms=len(symbols))
            async for raw in ws:
                if not self._running:
                    return
                try:
                    self._on_message(json.loads(raw))
                except Exception as exc:
                    logger.debug("EMAWatchdog WS parse error", error=str(exc))

    # ── Candle processing ─────────────────────────────────────────────────────

    def _on_message(self, msg: dict) -> None:
        data = msg.get("data", msg)
        if data.get("e") != "kline":
            return
        k = data["k"]

        symbol    = k["s"]
        tf        = k["i"]
        key       = (symbol, tf)
        is_closed = bool(k.get("x", False))

        candle = {
            "open_time": datetime.fromtimestamp(k["t"] / 1000, tz=timezone.utc),
            "open":   float(k["o"]),
            "high":   float(k["h"]),
            "low":    float(k["l"]),
            "close":  float(k["c"]),
            "volume": float(k["v"]),
        }

        if key not in self._buffers:
            self._buffers[key] = deque(maxlen=_BUFFER_SIZE)

        if is_closed:
            # Permanent: commit the finished candle to the buffer
            self._buffers[key].append(candle)
            asyncio.create_task(
                self._check_crossover(symbol, tf, key, live_candle=None),
                name=f"ema_check_{symbol}_{tf}",
            )
        else:
            # Live candle: throttle checks to once per _LIVE_CHECK_INTERVAL seconds
            # so we don't spawn a task on every single WebSocket tick (~1 s).
            now = time.monotonic()
            if now - self._last_live_check.get(key, 0.0) >= _LIVE_CHECK_INTERVAL:
                self._last_live_check[key] = now
                asyncio.create_task(
                    self._check_crossover(symbol, tf, key, live_candle=candle),
                    name=f"ema_live_{symbol}_{tf}",
                )

    async def _check_crossover(
        self,
        symbol: str,
        tf: str,
        key: tuple,
        live_candle: dict | None,
    ) -> None:
        buf = self._buffers.get(key)
        if not buf or len(buf) < _ema_strategy.slow + 50:
            return

        # Append the live (open) candle to get a real-time EMA reading.
        # For a closed-candle check live_candle is None so nothing is appended.
        rows = list(buf)
        if live_candle is not None:
            rows = rows + [live_candle]

        df = pd.DataFrame(rows)
        sig = _ema_strategy.scan(symbol, tf, df)
        if not sig:
            return

        dedup_key = f"{symbol}:binance:{tf}:{sig.signal_time.isoformat()}"
        if dedup_key in self._seen:
            return
        self._seen.add(dedup_key)

        logger.info(
            "⚡ Real-time EMA crossover",
            symbol=symbol, tf=tf, direction=sig.direction, price=sig.price,
            live=live_candle is not None,
        )

        async with self._db_sem:
            await self._persist(sig)

    async def _persist(self, sig) -> None:
        from app.services.scanner import _ema_to_dict, SignalScanner
        scanner = SignalScanner()
        await scanner._persist_signals([_ema_to_dict(sig)])


# ── Module-level singleton ────────────────────────────────────────────────────

_watchdog: "EMAWatchdog | None" = None


def get_ema_watchdog() -> EMAWatchdog:
    global _watchdog
    if _watchdog is None:
        _watchdog = EMAWatchdog()
    return _watchdog
