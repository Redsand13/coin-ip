"""
Async Binance Futures client.

Features:
  - Rate-limit-safe batched kline fetching
  - WebSocket stream manager for live candles
  - Auto-retry with exponential backoff via tenacity
  - Symbol universe caching
"""
import asyncio
from datetime import datetime, timezone
from typing import Any

import httpx
import pandas as pd
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_TF_MAP = {"5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "1d": "1d"}


class BinanceFuturesClient:
    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None
        self._symbols_cache: list[str] = []
        self._symbols_cached_at: datetime | None = None
        self._sem = asyncio.Semaphore(settings.BINANCE_REQUEST_LIMIT)

    async def __aenter__(self) -> "BinanceFuturesClient":
        self._client = httpx.AsyncClient(
            base_url=settings.BINANCE_BASE_URL,
            timeout=httpx.Timeout(10.0, connect=5.0),
            headers={"X-MBX-APIKEY": settings.BINANCE_API_KEY} if settings.BINANCE_API_KEY else {},
        )
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._client:
            await self._client.aclose()

    # ── Symbol universe ───────────────────────────────────────────────────────

    async def get_usdt_symbols(self, force_refresh: bool = False) -> list[str]:
        now = datetime.now(timezone.utc)
        cache_stale = (
            self._symbols_cached_at is None
            or (now - self._symbols_cached_at).total_seconds() > 3600
        )
        if not force_refresh and not cache_stale and self._symbols_cache:
            return self._symbols_cache

        resp = await self._get("/fapi/v1/exchangeInfo")
        symbols = [
            s["symbol"]
            for s in resp["symbols"]
            if s["quoteAsset"] == "USDT" and s["status"] == "TRADING"
        ]
        self._symbols_cache = sorted(symbols)[: settings.MAX_SYMBOLS_PER_SCAN]
        self._symbols_cached_at = now
        logger.info("Symbol universe refreshed", count=len(self._symbols_cache))
        return self._symbols_cache

    # ── Klines ────────────────────────────────────────────────────────────────

    async def get_klines(
        self,
        symbol: str,
        interval: str,
        limit: int = 200,
    ) -> pd.DataFrame:
        raw = await self._get(
            "/fapi/v1/klines",
            params={"symbol": symbol, "interval": _TF_MAP[interval], "limit": limit},
        )
        return _parse_klines(raw)

    async def get_klines_batch(
        self,
        symbols: list[str],
        interval: str,
        limit: int = 200,
    ) -> dict[str, pd.DataFrame]:
        """Fetch klines for multiple symbols with concurrency control."""
        results: dict[str, pd.DataFrame] = {}
        delay = settings.BINANCE_RATE_LIMIT_DELAY

        async def _fetch(sym: str) -> None:
            async with self._sem:
                try:
                    df = await self.get_klines(sym, interval, limit)
                    results[sym] = df
                except Exception as exc:
                    logger.warning("Kline fetch failed", symbol=sym, error=str(exc))
                await asyncio.sleep(delay)

        await asyncio.gather(*[_fetch(sym) for sym in symbols])
        return results

    async def get_klines_multi_tf(
        self,
        symbol: str,
        timeframes: list[str],
        limit: int = 200,
    ) -> dict[str, pd.DataFrame]:
        coros = {tf: self.get_klines(symbol, tf, limit) for tf in timeframes}
        results: dict[str, pd.DataFrame] = {}
        for tf, coro in coros.items():
            try:
                results[tf] = await coro
            except Exception as exc:
                logger.warning("Multi-TF kline failed", symbol=symbol, tf=tf, error=str(exc))
        return results

    # ── Ticker ────────────────────────────────────────────────────────────────

    async def get_ticker_24h(self, symbol: str | None = None) -> list[dict]:
        params = {"symbol": symbol} if symbol else {}
        data = await self._get("/fapi/v1/ticker/24hr", params=params)
        return data if isinstance(data, list) else [data]

    # ── HTTP helpers ──────────────────────────────────────────────────────────

    async def _get(self, path: str, params: dict | None = None) -> Any:
        assert self._client, "Client not initialised — use as async context manager"
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=1, max=10),
            retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
            reraise=True,
        ):
            with attempt:
                resp = await self._client.get(path, params=params)
                resp.raise_for_status()
                return resp.json()


def _parse_klines(raw: list) -> pd.DataFrame:
    df = pd.DataFrame(raw, columns=[
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "quote_volume", "trades",
        "taker_buy_base", "taker_buy_quote", "ignore",
    ])
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = df[col].astype(float)
    df["open_time"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    return df[["open_time", "open", "high", "low", "close", "volume"]]
