"""APScheduler-based background task runner."""
import asyncio
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def _run_binance_scan() -> None:
    from app.services.scanner import SignalScanner
    scanner = SignalScanner()
    try:
        n = await scanner.run_binance_scan()
        logger.info("Binance scan job complete", saved=n)
    except Exception as exc:
        logger.error("Binance scan job failed", error=str(exc))


async def _run_coingecko_scan() -> None:
    from app.services.scanner import SignalScanner
    scanner = SignalScanner()
    try:
        n = await scanner.run_coingecko_scan()
        logger.info("CoinGecko scan job complete", saved=n)
    except Exception as exc:
        logger.error("CoinGecko scan job failed", error=str(exc))


async def _retrain_ml() -> None:
    """Pull labelled signals from DB and retrain the ML model."""
    from app.algorithms.ml_scorer import MLScorer, _FEATURE_COLS
    from app.database import AsyncSessionFactory
    from sqlalchemy import select, text
    from app.models.signal import Signal
    import pandas as pd

    async with AsyncSessionFactory() as session:
        result = await session.execute(
            text("""
                SELECT symbol, source, direction, timeframe, price,
                       ema_fast, ema_mid, ema_slow, confluence_score,
                       ml_features, signal_time, outcome_pnl, outcome_hit_tp
                FROM signals
                WHERE outcome_pnl IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 10000
            """)
        )
        rows = result.mappings().all()

    if not rows:
        logger.info("No labelled signals for ML retraining")
        return

    df = pd.DataFrame(rows)
    df["label"] = (df["outcome_pnl"] > 0).astype(int)

    # Expand ml_features JSON into columns
    if "ml_features" in df.columns:
        feats = df["ml_features"].apply(lambda x: x if isinstance(x, dict) else {})
        feat_df = pd.DataFrame(feats.tolist())
        df = pd.concat([df, feat_df], axis=1)

    scorer = MLScorer(settings.ML_MODEL_PATH)
    metrics = scorer.train(df, min_samples=settings.ML_MIN_SAMPLES)
    logger.info("ML retrain complete", **metrics)


async def start_scheduler() -> None:
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")

    _scheduler.add_job(
        _run_binance_scan,
        trigger=IntervalTrigger(seconds=settings.SCANNER_INTERVAL_SECONDS),
        id="binance_scan",
        max_instances=1,
        coalesce=True,
        next_run_time=datetime.now(timezone.utc),
    )
    _scheduler.add_job(
        _run_coingecko_scan,
        trigger=IntervalTrigger(minutes=5),
        id="coingecko_scan",
        max_instances=1,
        coalesce=True,
    )
    _scheduler.add_job(
        _retrain_ml,
        trigger=IntervalTrigger(hours=settings.ML_RETRAIN_HOURS),
        id="ml_retrain",
        max_instances=1,
        coalesce=True,
    )

    _scheduler.start()


async def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
