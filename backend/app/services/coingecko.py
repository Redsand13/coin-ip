"""
Fetches CoinGecko market data and upserts it into the cg_cache table.
Called by the scheduler every 2 minutes — users never hit CoinGecko directly.
"""
import asyncio

import httpx

from app.core.logging import get_logger
from app.database import AsyncSessionFactory
from app.models.coingecko import CgCache

logger = get_logger(__name__)

_BASE = "https://api.coingecko.com/api/v3"
_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


async def refresh_coingecko_cache() -> None:
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers={"Accept": "application/json"}) as client:
        trending_raw, markets_raw = await _fetch_both(client)

    trending = _parse_trending(trending_raw)
    gainers, losers = _parse_markets(markets_raw)

    async with AsyncSessionFactory() as session:
        for key, payload in [
            ("trending", {"coins": trending}),
            ("gainers",  {"coins": gainers}),
            ("losers",   {"coins": losers}),
        ]:
            row = await session.get(CgCache, key)
            if row:
                row.payload = payload
            else:
                session.add(CgCache(key=key, payload=payload))
        await session.commit()

    logger.info("CoinGecko cache refreshed",
                trending=len(trending), gainers=len(gainers), losers=len(losers))


async def _fetch_both(client: httpx.AsyncClient):
    async def _get(url: str):
        try:
            r = await client.get(url)
            if r.status_code == 429:
                logger.warning("CoinGecko rate limited", url=url)
                return None
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            logger.warning("CoinGecko fetch failed", url=url, error=str(exc))
            return None

    return await asyncio.gather(
        _get(f"{_BASE}/search/trending"),
        _get(
            f"{_BASE}/coins/markets"
            "?vs_currency=usd"
            "&order=price_change_percentage_24h_desc"
            "&per_page=20"
            "&sparkline=true"
            "&price_change_percentage=24h"
        ),
    )


def _parse_trending(raw) -> list:
    if not raw:
        return []
    out = []
    for c in (raw.get("coins", []))[:10]:
        item = c.get("item", {})
        out.append({
            "item": {
                "id":              item.get("id"),
                "name":            item.get("name"),
                "symbol":          item.get("symbol"),
                "thumb":           item.get("thumb"),
                "market_cap_rank": item.get("market_cap_rank"),
                "data": {
                    "price": item.get("data", {}).get("price"),
                    "price_change_percentage_24h": item.get("data", {}).get("price_change_percentage_24h"),
                },
            }
        })
    return out


def _parse_markets(raw) -> tuple[list, list]:
    if not isinstance(raw, list):
        return [], []

    keep = {
        "id", "symbol", "name", "image",
        "current_price", "price_change_percentage_24h",
        "market_cap", "total_volume", "sparkline_in_7d",
    }
    coins = [{k: v for k, v in c.items() if k in keep} for c in raw]

    gainers = sorted(
        [c for c in coins if (c.get("price_change_percentage_24h") or 0) > 0],
        key=lambda c: c.get("price_change_percentage_24h", 0), reverse=True,
    )[:7]
    losers = sorted(
        [c for c in coins if (c.get("price_change_percentage_24h") or 0) < 0],
        key=lambda c: c.get("price_change_percentage_24h", 0),
    )[:7]

    return gainers, losers
