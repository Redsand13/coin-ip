from fastapi import APIRouter, Depends
from fastapi.responses import ORJSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.coingecko import CgCache

router = APIRouter(prefix="/derivatives", tags=["Derivatives"])


@router.get("", response_class=ORJSONResponse)
async def get_derivatives(db: AsyncSession = Depends(get_db)) -> dict:
    """
    Returns cached derivatives data (OI, funding rate, L/S ratio) from DB.
    Data is refreshed every 5 minutes by the background scheduler.
    """
    row = (await db.execute(
        select(CgCache).where(CgCache.key == "derivatives")
    )).scalar_one_or_none()

    symbols: list[dict] = []
    stale = True

    if row and row.payload:
        symbols = row.payload.get("symbols", [])
        stale = len(symbols) == 0

    return {
        "symbols": symbols,
        "stale": stale,
        "updatedAt": row.updated_at.isoformat() if row and row.updated_at else None,
    }
