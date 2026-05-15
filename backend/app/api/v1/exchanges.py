"""
Exchange futures symbol availability endpoint.
Fetches USDT perpetual symbol lists from major exchanges in parallel,
caches in-process for 1 hour.
"""
import asyncio
import re
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

from app.core.logging import get_logger
from app.services.binance import BinanceFuturesClient
from app.services.bybit import BybitClient

logger = get_logger(__name__)

router = APIRouter(prefix="/exchanges", tags=["Exchanges"])

_TIMEOUT = httpx.Timeout(10.0, connect=5.0)
_cache: dict = {}
_cached_at: datetime | None = None
_CACHE_TTL_S = 3600  # 1 hour


# ── Per-exchange fetchers ──────────────────────────────────────────────────────

async def _binance() -> list[str]:
    try:
        async with BinanceFuturesClient() as cl:
            return await cl.get_usdt_symbols()
    except Exception as exc:
        logger.warning("Exchange symbols: Binance failed", error=str(exc))
        return []


async def _bybit() -> list[str]:
    try:
        async with BybitClient() as cl:
            tickers = await cl.get_tickers()
            return [t["symbol"] for t in tickers if t.get("symbol", "").endswith("USDT")]
    except Exception as exc:
        logger.warning("Exchange symbols: Bybit failed", error=str(exc))
        return []


async def _gate() -> list[str]:
    """Gate.io USDT perpetual futures — symbols like BTC_USDT → BTCUSDT"""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get("https://api.gateio.ws/api/v4/futures/usdt/contracts",
                            params={"limit": 1000})
            r.raise_for_status()
            return [
                item["name"].replace("_", "")   # BTC_USDT → BTCUSDT
                for item in r.json()
                if item.get("name", "").endswith("_USDT")
                and not item.get("in_delisting", False)
            ]
    except Exception as exc:
        logger.warning("Exchange symbols: Gate.io failed", error=str(exc))
        return []


async def _mexc() -> list[str]:
    """MEXC USDT perpetual futures — symbols like BTC_USDT → BTCUSDT"""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get("https://contract.mexc.com/api/v1/contract/detail")
            r.raise_for_status()
            data = r.json()
            return [
                item["symbol"].replace("_", "")
                for item in (data.get("data") or [])
                if item.get("symbol", "").endswith("_USDT")
                and item.get("state") == 1
            ]
    except Exception as exc:
        logger.warning("Exchange symbols: MEXC failed", error=str(exc))
        return []


async def _bitget() -> list[str]:
    """Bitget USDT perpetual futures"""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(
                "https://api.bitget.com/api/v2/mix/market/tickers",
                params={"productType": "USDT-FUTURES"},
            )
            r.raise_for_status()
            data = r.json()
            return [
                item["symbol"].replace("USDT", "USDT")   # already BTCUSDT format
                for item in (data.get("data") or [])
                if item.get("symbol", "").endswith("USDT")
            ]
    except Exception as exc:
        logger.warning("Exchange symbols: Bitget failed", error=str(exc))
        return []


async def _kucoin() -> list[str]:
    """KuCoin Futures USDT perpetuals — strip trailing M, map XBT→BTC"""
    _REMAP = {"XBT": "BTC"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get("https://api-futures.kucoin.com/api/v1/contracts/active")
            r.raise_for_status()
            out: list[str] = []
            for item in (r.json().get("data") or []):
                sym: str = item.get("symbol", "")
                # XBTUSDTM → strip trailing M → XBTUSDT → remap base → BTCUSDT
                if not sym.endswith("USDTM"):
                    continue
                sym = sym[:-1]  # drop M
                base = sym.replace("USDT", "")
                base = _REMAP.get(base, base)
                out.append(base + "USDT")
            return out
    except Exception as exc:
        logger.warning("Exchange symbols: KuCoin failed", error=str(exc))
        return []


async def _htx() -> list[str]:
    """HTX (Huobi) linear swap USDT contracts"""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(
                "https://api.hbdm.com/linear-swap-api/v1/swap_contract_info",
                params={"support_margin_mode": "cross"},
            )
            r.raise_for_status()
            return [
                item["contract_code"].replace("-", "").replace("_", "")
                for item in (r.json().get("data") or [])
                if str(item.get("contract_code", "")).endswith("USDT")
                and item.get("contract_status") == 1
            ]
    except Exception as exc:
        logger.warning("Exchange symbols: HTX failed", error=str(exc))
        return []


# ── Main endpoint ──────────────────────────────────────────────────────────────

async def _fetch_all() -> dict[str, list[str]]:
    global _cache, _cached_at

    now = datetime.now(timezone.utc)
    if _cached_at and (now - _cached_at).total_seconds() < _CACHE_TTL_S and _cache:
        return _cache

    results = await asyncio.gather(
        _binance(), _bybit(), _gate(), _mexc(), _bitget(), _kucoin(), _htx(),
        return_exceptions=True,
    )

    names = ["binance", "bybit", "gate", "mexc", "bitget", "kucoin", "htx"]
    out: dict[str, list[str]] = {}
    for name, res in zip(names, results):
        out[name] = res if isinstance(res, list) else []

    logger.info("Exchange symbol cache refreshed",
                **{k: len(v) for k, v in out.items()})
    _cache = out
    _cached_at = now
    return out


@router.get("/futures-symbols", response_class=ORJSONResponse)
async def futures_symbols() -> dict:
    """
    USDT perpetual futures symbol lists per exchange (cached 1 h).
    Shape: { "binance": ["BTCUSDT", ...], "bybit": [...], ... }
    """
    return await _fetch_all()
