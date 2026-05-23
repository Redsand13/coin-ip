from fastapi import APIRouter

from app.api.v1.signals     import router as signals_router
from app.api.v1.scanner     import router as scanner_router
from app.api.v1.websocket   import router as ws_router
from app.api.v1.health      import router as health_router
from app.api.v1.push        import router as push_router
from app.api.v1.exchanges   import router as exchanges_router
from app.api.v1.coingecko   import router as coingecko_router
from app.api.v1.derivatives import router as derivatives_router

api_v1 = APIRouter(prefix="/api/v1")
api_v1.include_router(signals_router)
api_v1.include_router(scanner_router)
api_v1.include_router(ws_router)
api_v1.include_router(health_router)
api_v1.include_router(push_router)
api_v1.include_router(exchanges_router)
api_v1.include_router(coingecko_router)
api_v1.include_router(derivatives_router)
