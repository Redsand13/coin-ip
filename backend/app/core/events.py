from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from app.core.logging import configure_logging
from app.database import engine, Base

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    configure_logging()
    logger.info("Starting Coinpree Signal Engine")

    # Create all tables if not using Alembic in dev
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Start background scanner
    from app.tasks.scheduler import start_scheduler
    await start_scheduler()
    logger.info("Background scheduler started")

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    from app.tasks.scheduler import stop_scheduler
    await stop_scheduler()

    await engine.dispose()
    logger.info("Engine shutdown complete")
