from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from sqlalchemy import select

from app.database import get_db
from app.models.coingecko import CgCache
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/coingecko", tags=["CoinGecko"])


@router.get("/market", response_class=ORJSONResponse)
async def get_market_data(db: AsyncSession = Depends(get_db)) -> dict:
    """
    Returns cached CoinGecko trending/gainers/losers from DB.
    Data is refreshed every 2 minutes by the background scheduler.
    No request ever hits CoinGecko directly from this endpoint.
    """
    rows = (await db.execute(
        select(CgCache).where(CgCache.key.in_(["trending", "gainers", "losers"]))
    )).scalars().all()

    data = {r.key: r.payload for r in rows}

    return {
        "trending":    data.get("trending", {}).get("coins", []),
        "gainers":     data.get("gainers",  {}).get("coins", []),
        "losers":      data.get("losers",   {}).get("coins", []),
        "rateLimited": False,
        "stale":       len(data) < 3,  # true if DB has no rows yet
    }
