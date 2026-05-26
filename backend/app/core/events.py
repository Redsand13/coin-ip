from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from sqlalchemy import text

from app.core.logging import configure_logging
from app.database import engine, Base

logger = structlog.get_logger(__name__)


async def _migrate_native_enums() -> None:
    """
    Convert PostgreSQL native enum columns to VARCHAR.

    SQLAlchemy's native_enum=True (the old default) creates PostgreSQL
    ENUM types that asyncpg cannot bind string parameters to without an
    explicit cast. Switching to native_enum=False uses VARCHAR instead,
    which works transparently with asyncpg.

    This migration is idempotent: it checks the column's data_type before
    altering, so it is safe to run on every startup.
    """
    migration = text("""
        DO $$
        BEGIN
            -- signals.source / signals.direction
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'signals'
                  AND column_name = 'source'
                  AND data_type = 'USER-DEFINED'
            ) THEN
                ALTER TABLE signals
                    ALTER COLUMN source    TYPE VARCHAR(20) USING source::TEXT,
                    ALTER COLUMN direction TYPE VARCHAR(10) USING direction::TEXT;
            END IF;

        END $$;
    """)

    async with engine.begin() as conn:
        await conn.execute(migration)
        # asyncpg requires each statement to be issued separately
        for drop_sql in (
            "DROP TYPE IF EXISTS signalsource   CASCADE",
            "DROP TYPE IF EXISTS signaldirection CASCADE",
        ):
            await conn.execute(text(drop_sql))

    logger.info("Enum migration complete")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    configure_logging()
    logger.info("Starting Coinpree Signal Engine")

    # Migrate native PostgreSQL enums → VARCHAR (idempotent, safe on fresh DBs)
    await _migrate_native_enums()

    # Import all models so Base.metadata knows about them before create_all
    import app.models.signal       # noqa: F401
    import app.models.market_flow  # noqa: F401

    # Create tables that do not yet exist
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Start background scanner
    from app.tasks.scheduler import start_scheduler
    await start_scheduler()
    logger.info("Background scheduler started")

    # Start institutional order flow pipeline (only on the dedicated pipeline worker)
    from app.config import settings
    from app.services.institutional.pipeline import get_pipeline
    if settings.PIPELINE_ENABLED:
        try:
            pipeline = get_pipeline()
            await pipeline.start()
            logger.info("Institutional pipeline started")
        except Exception as exc:
            logger.warning("Institutional pipeline failed to start", error=str(exc))
    else:
        logger.info("Institutional pipeline disabled (API-only replica)")

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    from app.tasks.scheduler import stop_scheduler
    await stop_scheduler()

    from app.config import settings as _s
    if _s.PIPELINE_ENABLED:
        from app.services.institutional.pipeline import get_pipeline as _gp
        await _gp().stop()

    await engine.dispose()
    logger.info("Engine shutdown complete")
