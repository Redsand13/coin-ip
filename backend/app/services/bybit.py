"""
Bybit V5 public REST client — secondary data source.

Used as a fallback when Binance is rate-limited (418/429).
Bybit's public endpoints allow 120 req/min per IP with no API key.
"""
import asyncio
from typing import Any

import httpx
import pandas as pd

from app.core.logging import get_logger

logger = get_logger(__name__)

_BASE = "https://api.bybit.com"

_TF_MAP = {
    "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
    "1h": "60", "2h": "120", "4h": "240", "1d": "D", "1w": "W",
}


class BybitClient:
    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "BybitClient":
        self._client = httpx.AsyncClient(
            base_url=_BASE,
            timeout=httpx.Timeout(10.0, connect=5.0),
        )
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._client:
            await self._client.aclose()

    async def get_klines(
        self,
        symbol: str,
        interval: str,
        limit: int = 200,
    ) -> pd.DataFrame:
        tf = _TF_MAP.get(interval, interval)
        resp = await self._client.get(  # type: ignore[union-attr]
            "/v5/market/kline",
            params={"category": "linear", "symbol": symbol, "interval": tf, "limit": limit},
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("retCode") != 0:
            raise ValueError(f"Bybit error {data.get('retCode')}: {data.get('retMsg')}")
        rows = data["result"]["list"]
        if not rows:
            return pd.DataFrame()
        # Bybit returns newest first: [startTime, open, high, low, close, volume, turnover]
        df = pd.DataFrame(rows, columns=["open_time", "open", "high", "low", "close", "volume", "turnover"])
        for col in ("open", "high", "low", "close", "volume"):
            df[col] = df[col].astype(float)
        df["open_time"] = pd.to_datetime(df["open_time"].astype("int64"), unit="ms", utc=True)
        return df[["open_time", "open", "high", "low", "close", "volume"]].sort_values("open_time").reset_index(drop=True)

    async def get_tickers(self) -> list[dict]:
        """All linear perpetual USDT tickers — price, volume, change."""
        resp = await self._client.get(  # type: ignore[union-attr]
            "/v5/market/tickers",
            params={"category": "linear"},
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("retCode") != 0:
            return []
        return [
            t for t in data["result"]["list"]
            if t.get("symbol", "").endswith("USDT")
        ]
