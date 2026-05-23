"""APScheduler background task runner + WebSocket lifecycle."""
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def _refresh_coingecko() -> None:
    from app.services.coingecko import refresh_coingecko_cache
    try:
        await refresh_coingecko_cache()
    except Exception as exc:
        logger.error("CoinGecko cache refresh failed", error=str(exc))


async def _run_binance_scan() -> None:
    from app.services.scanner import SignalScanner
    scanner = SignalScanner()
    try:
        n = await scanner.run_binance_scan()
        logger.info("Binance scan job complete", saved=n)
    except Exception as exc:
        logger.error("Binance scan job failed", error=str(exc))


async def _refresh_derivatives() -> None:
    from app.services.derivatives import refresh_derivatives_cache
    try:
        await refresh_derivatives_cache()
    except Exception as exc:
        logger.error("Derivatives cache refresh failed", error=str(exc))


async def _retrain_ml() -> None:
    from app.algorithms.ml_scorer import MLScorer
    from app.database import AsyncSessionFactory
    from sqlalchemy import text
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

    if "ml_features" in df.columns:
        feats = df["ml_features"].apply(lambda x: x if isinstance(x, dict) else {})
        feat_df = pd.DataFrame(feats.tolist())
        df = pd.concat([df, feat_df], axis=1)

    scorer = MLScorer(settings.ML_MODEL_PATH)
    metrics = scorer.train(df, min_samples=settings.ML_MIN_SAMPLES)
    logger.info("ML retrain complete", **metrics)


async def start_scheduler() -> None:
    global _scheduler

    # Start Binance miniTicker WS — provides live momentum ranking
    from app.services.binance_ws import get_stream_manager
    ws = get_stream_manager()
    await ws.start()
    logger.info("Binance WebSocket stream manager started")

    # Start real-time EMA watchdog — detects crossovers at candle close, 24/7
    from app.services.ema_watchdog import get_ema_watchdog
    watchdog = get_ema_watchdog()
    await watchdog.start()
    logger.info("EMA real-time watchdog started")

    _scheduler = AsyncIOScheduler(timezone="UTC")

    # Binance REST scan — uses WS ranking, only fetches candles for top symbols
    _scheduler.add_job(
        _run_binance_scan,
        trigger=IntervalTrigger(seconds=settings.SCANNER_INTERVAL_SECONDS),
        id="binance_scan",
        max_instances=1,
        coalesce=True,
        next_run_time=datetime.now(timezone.utc),
    )

    # CoinGecko market cache — fetch once, serve all users from DB
    _scheduler.add_job(
        _refresh_coingecko,
        trigger=IntervalTrigger(minutes=2),
        id="coingecko_cache",
        max_instances=1,
        coalesce=True,
        next_run_time=datetime.now(timezone.utc),  # run immediately on startup
    )

    # Derivatives market data — OI, funding rate, L/S ratio
    _scheduler.add_job(
        _refresh_derivatives,
        trigger=IntervalTrigger(minutes=5),
        id="derivatives_cache",
        max_instances=1,
        coalesce=True,
        next_run_time=datetime.now(timezone.utc),
    )

    # ML retrain on labelled outcomes
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

    from app.services.binance_ws import get_stream_manager
    await get_stream_manager().stop()

    from app.services.ema_watchdog import get_ema_watchdog
    await get_ema_watchdog().stop()

    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
