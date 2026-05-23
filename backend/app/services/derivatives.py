"""
Fetches Open Interest, Funding Rate, and Long/Short Ratio for top Binance Futures symbols.
Cached in the cg_cache table under key "derivatives". Refreshed every 5 min by scheduler.
"""
import asyncio

from app.core.logging import get_logger
from app.database import AsyncSessionFactory
from app.models.coingecko import CgCache
from app.services.binance import BinanceFuturesClient

logger = get_logger(__name__)

_TOP_N = 50  # symbols to fetch OI + L/S ratio for


async def refresh_derivatives_cache() -> None:
    try:
        data = await _fetch_derivatives()
    except Exception as exc:
        logger.error("Derivatives fetch failed entirely", error=str(exc))
        return

    if not data:
        logger.warning("Derivatives: no data returned — keeping existing cache")
        return

    async with AsyncSessionFactory() as session:
        row = await session.get(CgCache, "derivatives")
        payload = {"symbols": data}
        if row:
            row.payload = payload
        else:
            session.add(CgCache(key="derivatives", payload=payload))
        await session.commit()

    logger.info("Derivatives cache refreshed", symbols=len(data))


async def _fetch_derivatives() -> list[dict]:
    async with BinanceFuturesClient() as client:
        # Single call gets funding rate + mark price for all symbols
        all_funding = await client.get_funding_rates_all()

        # Build a lookup: symbol → funding info
        funding_map: dict[str, dict] = {}
        for item in all_funding:
            sym = item.get("symbol", "")
            if sym.endswith("USDT"):
                funding_map[sym] = item

        # Get top symbols (cached, volume-ranked)
        top_symbols = await client.get_usdt_symbols()
        symbols = [s for s in top_symbols[:_TOP_N] if s in funding_map]

        # Fetch OI and L/S ratio concurrently
        sem = asyncio.Semaphore(10)

        async def _fetch_symbol(sym: str) -> dict | None:
            async with sem:
                try:
                    fi = funding_map[sym]
                    oi_resp = await client.get_open_interest(sym)
                    ls_resp = await client.get_long_short_ratio(sym)

                    mark_price = float(fi.get("markPrice", 0))
                    oi_contracts = float(oi_resp.get("openInterest", 0))
                    oi_usdt = oi_contracts * mark_price

                    ls_ratio = None
                    if ls_resp:
                        try:
                            ls_ratio = float(ls_resp.get("longShortRatio", 0))
                        except (ValueError, TypeError):
                            pass

                    return {
                        "symbol": sym,
                        "markPrice": mark_price,
                        "fundingRate": float(fi.get("lastFundingRate", 0)),
                        "openInterest": oi_usdt,
                        "longShortRatio": ls_ratio,
                    }
                except Exception as exc:
                    logger.warning("Derivatives fetch failed for symbol", symbol=sym, error=str(exc))
                    return None

        results = await asyncio.gather(*[_fetch_symbol(s) for s in symbols])
        return [r for r in results if r is not None]
