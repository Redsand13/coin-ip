from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

from app.core.redis import check_redis_health
from app.database import check_db_health

router = APIRouter(tags=["Health"])


@router.get("/health", response_class=ORJSONResponse)
async def health() -> dict:
    db_ok    = await check_db_health()
    redis_ok = await check_redis_health()
    status   = "ok" if (db_ok and redis_ok) else "degraded"
    return {
        "status": status,
        "db": "ok" if db_ok else "error",
        "redis": "ok" if redis_ok else "error",
    }
