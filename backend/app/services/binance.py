"""
Async Binance Futures REST client.

With a valid API key:
  - Requests are identified by key (not just IP) — much harder to get banned
  - Rate limit weight tracked via X-MBX-USED-WEIGHT-1M response header
  - Authenticated endpoints (account data, orders) become available
  - Automatic back-off when approaching weight limit

Rate limit strategy:
  - Track used weight per minute from response headers
  - Pause automatically when approaching the 1200/min ceiling
  - Retry on network errors only — never on 418/429 (would worsen the ban)
  - 418 → raise immediately (IP banned); 429 → sleep Retry-After then raise
"""
import asyncio
import hashlib
import hmac
import time
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

_TF_MAP = {
    "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1h", "2h": "2h", "4h": "4h", "6h": "6h", "1d": "1d", "1w": "1w",
}

_WEIGHT_CEILING = 1100   # pause before we hit 1200 hard limit
_WEIGHT_PAUSE   = 30.0   # seconds to pause when near ceiling


class BinanceFuturesClient:
    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None
        self._symbols_cache: list[str] = []
        self._symbols_cached_at: datetime | None = None
        self._sem = asyncio.Semaphore(settings.BINANCE_REQUEST_LIMIT)
        self._used_weight: int = 0  # track X-MBX-USED-WEIGHT-1M

    async def __aenter__(self) -> "BinanceFuturesClient":
        headers: dict[str, str] = {}
        if settings.BINANCE_API_KEY:
            headers["X-MBX-APIKEY"] = settings.BINANCE_API_KEY
        self._client = httpx.AsyncClient(
            base_url=settings.BINANCE_BASE_URL,
            timeout=httpx.Timeout(15.0, connect=5.0),
            headers=headers,
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

        # Get all active USDT perpetual symbols
        resp = await self._get("/fapi/v1/exchangeInfo")
        valid = {
            s["symbol"]
            for s in resp["symbols"]
            if s["quoteAsset"] == "USDT" and s["status"] == "TRADING"
        }

        # Rank by 24h quote volume — established coins first, micro-caps excluded
        try:
            tickers = await self._get("/fapi/v1/ticker/24hr")
            ranked = sorted(
                (t for t in tickers if t["symbol"] in valid),
                key=lambda t: float(t.get("quoteVolume", 0)),
                reverse=True,
            )
            # Minimum $10M daily USDT volume — filters out micro/low-cap coins
            MIN_VOLUME = 10_000_000
            symbols = [
                t["symbol"] for t in ranked
                if float(t.get("quoteVolume", 0)) >= MIN_VOLUME
            ][: settings.MAX_SYMBOLS_PER_SCAN]
            logger.info("Symbol universe refreshed (volume-ranked)",
                        count=len(symbols), min_volume_m=MIN_VOLUME / 1e6)
        except Exception as exc:
            # Fallback: all valid symbols (no volume filter)
            symbols = sorted(valid)[: settings.MAX_SYMBOLS_PER_SCAN]
            logger.warning("Volume ranking failed, using fallback list",
                           count=len(symbols), error=str(exc))

        self._symbols_cache = symbols
        self._symbols_cached_at = now
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
            params={"symbol": symbol, "interval": _TF_MAP.get(interval, interval), "limit": limit},
        )
        return _parse_klines(raw)

    async def get_klines_batch(
        self,
        symbols: list[str],
        interval: str,
        limit: int = 200,
    ) -> dict[str, pd.DataFrame]:
        results: dict[str, pd.DataFrame] = {}

        async def _fetch(sym: str) -> None:
            async with self._sem:
                try:
                    results[sym] = await self.get_klines(sym, interval, limit)
                except Exception as exc:
                    logger.warning("Kline fetch failed", symbol=sym, error=str(exc))
                await asyncio.sleep(settings.BINANCE_RATE_LIMIT_DELAY)

        await asyncio.gather(*[_fetch(sym) for sym in symbols])
        return results

    async def get_klines_multi_tf(
        self,
        symbol: str,
        timeframes: list[str],
        limit: int = 200,
    ) -> dict[str, pd.DataFrame]:
        results: dict[str, pd.DataFrame] = {}
        for tf in timeframes:
            try:
                results[tf] = await self.get_klines(symbol, tf, limit)
            except Exception as exc:
                logger.warning("Multi-TF kline failed", symbol=symbol, tf=tf, error=str(exc))
        return results

    # ── Ticker ────────────────────────────────────────────────────────────────

    async def get_ticker_24h(self, symbol: str | None = None) -> list[dict]:
        params = {"symbol": symbol} if symbol else {}
        data = await self._get("/fapi/v1/ticker/24hr", params=params)
        return data if isinstance(data, list) else [data]

    # ── Derivatives market data ───────────────────────────────────────────────

    async def get_funding_rates_all(self) -> list[dict]:
        """All symbols' premium index (mark price + funding rate) — single call."""
        return await self._get("/fapi/v1/premiumIndex")

    async def get_open_interest(self, symbol: str) -> dict:
        """Open interest for a single symbol (in contracts)."""
        return await self._get("/fapi/v1/openInterest", params={"symbol": symbol})

    async def get_long_short_ratio(self, symbol: str, period: str = "5m") -> dict | None:
        """Global long/short account ratio. Returns None on failure."""
        try:
            rows = await self._get(
                "/futures/data/globalLongShortAccountRatio",
                params={"symbol": symbol, "period": period, "limit": 1},
            )
            return rows[0] if rows else None
        except Exception:
            return None

    # ── Authenticated endpoints (require API key + signature) ─────────────────

    async def get_account_info(self) -> dict:
        """Account balance and position information (requires auth)."""
        return await self._signed_get("/fapi/v2/account")

    async def get_positions(self) -> list[dict]:
        """Open positions (requires auth)."""
        data = await self._signed_get("/fapi/v2/positionRisk")
        return [p for p in data if float(p.get("positionAmt", 0)) != 0]

    async def get_open_orders(self, symbol: str | None = None) -> list[dict]:
        """Open orders (requires auth)."""
        params: dict[str, Any] = {}
        if symbol:
            params["symbol"] = symbol
        return await self._signed_get("/fapi/v1/openOrders", params=params)

    # ── HTTP helpers ──────────────────────────────────────────────────────────

    async def _get(self, path: str, params: dict | None = None) -> Any:
        assert self._client, "Client not initialised — use as async context manager"

        # Back off automatically when approaching the rate limit ceiling
        if self._used_weight >= _WEIGHT_CEILING:
            logger.warning("Approaching Binance weight limit, pausing",
                           used=self._used_weight, ceiling=_WEIGHT_CEILING)
            await asyncio.sleep(_WEIGHT_PAUSE)
            self._used_weight = 0

        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=2, min=2, max=30),
            retry=retry_if_exception_type(
                (httpx.ConnectError, httpx.TimeoutException, httpx.ReadError)
            ),
            reraise=True,
        ):
            with attempt:
                resp = await self._client.get(path, params=params)
                self._update_weight(resp)

                if resp.status_code == 418:
                    raise httpx.HTTPStatusError(
                        "Binance IP temporarily banned (418)",
                        request=resp.request, response=resp,
                    )
                if resp.status_code == 429:
                    retry_after = int(resp.headers.get("Retry-After", 60))
                    logger.warning("Binance rate limit 429", retry_after=retry_after, path=path)
                    await asyncio.sleep(retry_after)
                    raise httpx.HTTPStatusError(
                        f"Binance rate limited — retrying after {retry_after}s",
                        request=resp.request, response=resp,
                    )
                resp.raise_for_status()
                return resp.json()

    async def _signed_get(self, path: str, params: dict | None = None) -> Any:
        """HMAC-SHA256 signed request for authenticated endpoints."""
        assert settings.BINANCE_SECRET, "BINANCE_SECRET not configured"
        p = dict(params or {})
        p["timestamp"] = int(time.time() * 1000)
        query = "&".join(f"{k}={v}" for k, v in p.items())
        sig = hmac.new(
            settings.BINANCE_SECRET.encode(),
            query.encode(),
            hashlib.sha256,
        ).hexdigest()
        p["signature"] = sig
        return await self._get(path, params=p)

    def _update_weight(self, resp: httpx.Response) -> None:
        w = resp.headers.get("X-MBX-USED-WEIGHT-1M")
        if w:
            try:
                self._used_weight = int(w)
            except ValueError:
                pass


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
