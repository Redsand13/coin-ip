"""Manual scanner trigger + status endpoints."""
import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import ORJSONResponse

from app.core.security import require_api_key
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/scanner", tags=["Scanner"])

_scan_status: dict = {"running": False, "last_run": None, "last_saved": 0}


@router.get("/status", response_class=ORJSONResponse)
async def scanner_status() -> dict:
    return _scan_status


@router.post("/trigger/binance", response_class=ORJSONResponse)
async def trigger_binance(
    background_tasks: BackgroundTasks,
    _: str = Depends(require_api_key),
) -> dict:
    if _scan_status["running"]:
        return {"status": "already_running"}
    background_tasks.add_task(_run_binance_bg)
    return {"status": "triggered"}


@router.post("/trigger/coingecko", response_class=ORJSONResponse)
async def trigger_coingecko(
    background_tasks: BackgroundTasks,
    _: str = Depends(require_api_key),
) -> dict:
    background_tasks.add_task(_run_coingecko_bg)
    return {"status": "triggered"}


@router.get("/symbols", response_class=ORJSONResponse)
async def list_symbols() -> dict:
    from app.services.binance import BinanceFuturesClient
    async with BinanceFuturesClient() as client:
        symbols = await client.get_usdt_symbols()
    return {"symbols": symbols, "count": len(symbols)}


@router.get("/ml/status", response_class=ORJSONResponse)
async def ml_status() -> dict:
    from app.algorithms.ml_scorer import MLScorer
    from app.config import settings
    scorer = MLScorer(settings.ML_MODEL_PATH)
    return {
        "is_trained": scorer.is_trained,
        "trained_at": scorer.trained_at.isoformat() if scorer.trained_at else None,
        "n_samples": scorer.n_samples,
    }


async def _run_binance_bg() -> None:
    from app.services.scanner import SignalScanner
    from datetime import datetime, timezone
    _scan_status["running"] = True
    try:
        scanner = SignalScanner()
        n = await scanner.run_binance_scan()
        _scan_status["last_saved"] = n
        _scan_status["last_run"] = datetime.now(timezone.utc).isoformat()
    finally:
        _scan_status["running"] = False


async def _run_coingecko_bg() -> None:
    from app.services.scanner import SignalScanner
    scanner = SignalScanner()
    await scanner.run_coingecko_scan()
