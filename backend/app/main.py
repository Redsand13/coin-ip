from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse, Response
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.api.v1 import api_v1
from app.config import settings
from app.core.events import lifespan

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)

# ── Rate limiting ─────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Middleware ────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key", "Authorization", "Accept"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ── Prometheus metrics ────────────────────────────────────────────────────────
Instrumentator(
    should_group_status_codes=True,
    should_ignore_untemplated=True,
    excluded_handlers=["/health", "/metrics"],
).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(api_v1)


# Root endpoint — API info
@app.get("/", include_in_schema=False, response_class=ORJSONResponse)
async def root() -> dict:
    return {"name": settings.APP_NAME, "version": settings.APP_VERSION, "docs": "/docs"}


# Silence browser favicon requests
@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> Response:
    return Response(status_code=204)


# Root-level /health for load balancers / Docker healthchecks / uptime monitors
@app.get("/health", include_in_schema=False, response_class=ORJSONResponse)
async def root_health() -> dict:
    from app.database import check_db_health
    from app.core.redis import check_redis_health
    from app.core.logging import get_logger
    _log = get_logger("health")
    db_ok    = await check_db_health()
    redis_ok = await check_redis_health()
    status = "ok" if (db_ok and redis_ok) else "degraded"
    if status == "degraded":
        _log.warning("Health degraded", db=db_ok, redis=redis_ok)
    return {
        "status": status,
        "db":    "ok" if db_ok    else "error",
        "redis": "ok" if redis_ok else "error",
    }


# ── Error handlers ────────────────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> ORJSONResponse:
    from app.core.logging import get_logger
    logger = get_logger("exception_handler")
    logger.error("Unhandled exception", path=str(request.url), error=str(exc), exc_info=True)
    return ORJSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )
