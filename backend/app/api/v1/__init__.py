from fastapi import APIRouter

from app.api.v1.signals  import router as signals_router
from app.api.v1.scanner  import router as scanner_router
from app.api.v1.backtest import router as backtest_router
from app.api.v1.websocket import router as ws_router
from app.api.v1.health   import router as health_router

api_v1 = APIRouter(prefix="/api/v1")
api_v1.include_router(signals_router)
api_v1.include_router(scanner_router)
api_v1.include_router(backtest_router)
api_v1.include_router(ws_router)
api_v1.include_router(health_router)
