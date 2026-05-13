"""Async CoinGecko client with caching."""
import asyncio
from typing import Any

import httpx
from tenacity import AsyncRetrying, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class CoinGeckoClient:
    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "CoinGeckoClient":
        headers = {}
        if settings.COINGECKO_API_KEY:
            headers["x-cg-pro-api-key"] = settings.COINGECKO_API_KEY
        self._client = httpx.AsyncClient(
            base_url=settings.COINGECKO_BASE_URL,
            timeout=httpx.Timeout(15.0),
            headers=headers,
        )
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._client:
            await self._client.aclose()

    async def get_top_coins(self, limit: int = 250, currency: str = "usd") -> list[dict]:
        pages = (limit + 249) // 250
        results: list[dict] = []
        for page in range(1, pages + 1):
            data = await self._get("/coins/markets", params={
                "vs_currency": currency,
                "order": "market_cap_desc",
                "per_page": min(250, limit - len(results)),
                "page": page,
                "sparkline": False,
                "price_change_percentage": "1h,24h,7d",
            })
            results.extend(data)
            if len(results) >= limit:
                break
            await asyncio.sleep(1.5)
        return results

    async def get_ohlc(self, coin_id: str, days: int = 30, currency: str = "usd") -> list[list]:
        """Returns [[timestamp, open, high, low, close], ...]"""
        return await self._get(f"/coins/{coin_id}/ohlc", params={
            "vs_currency": currency,
            "days": days,
        })

    async def get_coin_info(self, coin_id: str) -> dict:
        return await self._get(f"/coins/{coin_id}", params={
            "localization": False,
            "tickers": False,
            "market_data": True,
            "community_data": False,
            "developer_data": False,
        })

    async def _get(self, path: str, params: dict | None = None) -> Any:
        assert self._client
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1.5, min=2, max=30),
            retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
            reraise=True,
        ):
            with attempt:
                resp = await self._client.get(path, params=params)
                if resp.status_code == 429:
                    logger.warning("CoinGecko rate limit hit")
                    await asyncio.sleep(60)
                    resp = await self._client.get(path, params=params)
                resp.raise_for_status()
                return resp.json()
