"""
Main signal scanner service.

Orchestrates Binance + CoinGecko + ICT scans, scores with ML,
persists to PostgreSQL, and publishes to Redis pub/sub.
"""
import asyncio
from datetime import datetime, timezone
from typing import Any

import pandas as pd
import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.algorithms.backtester import Backtester
from app.algorithms.confluence import ConfluenceEngine
from app.algorithms.ema import EMAStrategy
from app.algorithms.ict import ICTEngine
from app.algorithms.ml_scorer import MLScorer
from app.config import settings
from app.core.logging import get_logger
from app.core.redis import get_pool
from app.database import AsyncSessionFactory
from app.models.signal import Signal, SignalSource, SignalDirection
from app.services.binance import BinanceFuturesClient
from app.services.coingecko import CoinGeckoClient

logger = get_logger(__name__)

_ema_strategy  = EMAStrategy(settings.EMA_FAST, settings.EMA_MID, settings.EMA_SLOW)
_ict_engine    = ICTEngine()
_conf_engine   = ConfluenceEngine()
_ml_scorer     = MLScorer(settings.ML_MODEL_PATH)


class SignalScanner:
    """
    Runs a full scan cycle:
      1. Fetch symbol universe from Binance
      2. Fetch klines for all TFs
      3. Run EMA + ICT + Confluence per symbol
      4. Score with ML
      5. Deduplicate + persist
      6. Publish to Redis channel for WebSocket push
    """

    def __init__(self) -> None:
        self._seen: set[str] = set()  # dedup cache (in-memory, resets on restart)

    async def run_binance_scan(self) -> int:
        logger.info("Starting Binance scan")
        saved = 0
        async with BinanceFuturesClient() as client:
            symbols = await client.get_usdt_symbols()

            # Batch fetch 1h candles for confluence; per-symbol TF fetch for signals
            for i in range(0, len(symbols), 20):
                batch = symbols[i: i + 20]
                tasks = [self._scan_symbol_binance(client, sym) for sym in batch]
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for sym, res in zip(batch, results):
                    if isinstance(res, Exception):
                        logger.warning("Symbol scan failed", symbol=sym, error=str(res))
                    else:
                        saved += res  # type: ignore[operator]

        logger.info("Binance scan complete", saved=saved)
        return saved

    async def _scan_symbol_binance(self, client: BinanceFuturesClient, symbol: str) -> int:
        candles: dict[str, pd.DataFrame] = {}
        for tf in settings.TIMEFRAMES:
            try:
                candles[tf] = await client.get_klines(symbol, tf, limit=200)
                await asyncio.sleep(settings.BINANCE_RATE_LIMIT_DELAY)
            except Exception:
                pass

        if not candles:
            return 0

        signals_to_save: list[dict] = []

        # EMA signals per TF
        for tf, df in candles.items():
            sig = _ema_strategy.scan(symbol, tf, df)
            if sig:
                key = f"{symbol}:{SignalSource.BINANCE}:{tf}:{sig.signal_time.isoformat()}"
                if key not in self._seen:
                    self._seen.add(key)
                    signals_to_save.append(_ema_to_dict(sig))

        # Multi-TF confluence
        conf = _conf_engine.scan(symbol, candles)
        if conf:
            key = f"{symbol}:confluence:{conf.direction}:{datetime.now(timezone.utc).date()}"
            if key not in self._seen:
                self._seen.add(key)
                # Use the best-entry-tf candle for price
                ref_df = candles.get(conf.best_entry_tf, next(iter(candles.values())))
                price = float(ref_df["close"].iloc[-1])
                ref_ts = pd.Timestamp(ref_df["open_time"].iloc[-1]).to_pydatetime()

                ml_features = MLScorer.build_features(
                    {"price": price, "direction": conf.direction,
                     "timeframe": conf.best_entry_tf, "signal_time": ref_ts,
                     "confluence_score": conf.score},
                    candle_1h=candles.get("1h"),
                    candle_4h=candles.get("4h"),
                    candle_1d=candles.get("1d"),
                )
                ml_score, ml_conf = _ml_scorer.predict(ml_features)

                signals_to_save.append({
                    "symbol": symbol,
                    "source": SignalSource.BINANCE,
                    "direction": conf.direction,
                    "timeframe": conf.best_entry_tf,
                    "signal_time": ref_ts,
                    "price": price,
                    "confluence_score": conf.score,
                    "aligned_timeframes": conf.aligned_timeframes,
                    "ml_score": ml_score,
                    "ml_confidence": ml_conf,
                    "ml_features": ml_features,
                    "extra": {"source_detail": "confluence"},
                })

        # ICT setups
        for tf, df in candles.items():
            setups = _ict_engine.scan(symbol, tf, df)
            for setup in setups:
                key = f"{symbol}:ict:{setup.pattern.value}:{tf}:{setup.signal_time.isoformat()}"
                if key not in self._seen:
                    self._seen.add(key)
                    signals_to_save.append(_ict_to_dict(symbol, setup))

        return await self._persist_signals(signals_to_save)

    async def run_coingecko_scan(self) -> int:
        logger.info("Starting CoinGecko scan")
        saved = 0
        try:
            async with CoinGeckoClient() as cg:
                coins = await cg.get_top_coins(limit=200)
                for coin in coins:
                    change_1h  = coin.get("price_change_percentage_1h_in_currency", 0) or 0
                    change_24h = coin.get("price_change_percentage_24h", 0) or 0

                    if abs(change_1h) < 3 and abs(change_24h) < 5:
                        continue  # not significant enough

                    direction = "LONG" if change_1h > 0 else "SHORT"
                    symbol = f"{coin['symbol'].upper()}USDT"
                    key = f"{symbol}:coingecko:{direction}:{datetime.now(timezone.utc).date()}"
                    if key in self._seen:
                        continue
                    self._seen.add(key)

                    ml_features = MLScorer.build_features({
                        "price": coin.get("current_price", 0),
                        "direction": direction,
                        "timeframe": "1d",
                        "signal_time": datetime.now(timezone.utc),
                        "confluence_score": min(1.0, abs(change_24h) / 20),
                    })
                    ml_score, ml_conf = _ml_scorer.predict(ml_features)

                    saved += await self._persist_signals([{
                        "symbol": symbol,
                        "source": SignalSource.COINGECKO,
                        "direction": direction,
                        "timeframe": "1d",
                        "signal_time": datetime.now(timezone.utc),
                        "price": coin.get("current_price", 0),
                        "volume": coin.get("total_volume"),
                        "market_cap": coin.get("market_cap"),
                        "ml_score": ml_score,
                        "ml_confidence": ml_conf,
                        "extra": {
                            "change_1h": change_1h,
                            "change_24h": change_24h,
                            "rank": coin.get("market_cap_rank"),
                        },
                    }])
        except Exception as exc:
            logger.error("CoinGecko scan error", error=str(exc))

        return saved

    # ── persistence ───────────────────────────────────────────────────────────

    async def _persist_signals(self, signals: list[dict]) -> int:
        if not signals:
            return 0
        async with AsyncSessionFactory() as session:
            stmt = (
                insert(Signal)
                .values(signals)
                .on_conflict_do_nothing(constraint="uq_signal")
            )
            result = await session.execute(stmt)
            await session.commit()
            count = result.rowcount

        if count > 0:
            await self._publish_signals(signals[:count])

        return count

    async def _publish_signals(self, signals: list[dict]) -> None:
        try:
            redis = aioredis.Redis(connection_pool=get_pool())
            import orjson
            for sig in signals:
                payload = orjson.dumps({
                    "symbol": sig["symbol"],
                    "source": sig["source"].value if hasattr(sig["source"], "value") else sig["source"],
                    "direction": sig["direction"],
                    "timeframe": sig.get("timeframe"),
                    "price": sig.get("price"),
                    "ml_score": sig.get("ml_score"),
                    "confluence_score": sig.get("confluence_score"),
                }).decode()
                await redis.publish("signals:live", payload)
            await redis.aclose()
        except Exception as exc:
            logger.warning("Redis publish failed", error=str(exc))


# ── helpers ───────────────────────────────────────────────────────────────────

def _ema_to_dict(sig: Any) -> dict:
    from app.models.signal import SignalSource
    return {
        "symbol": sig.symbol,
        "source": SignalSource.BINANCE,
        "direction": sig.direction,
        "timeframe": sig.timeframe,
        "signal_time": sig.signal_time,
        "price": sig.price,
        "volume": sig.volume,
        "ema_fast": sig.ema_fast,
        "ema_mid": sig.ema_mid,
        "ema_slow": sig.ema_slow,
        "extra": {"ema_strength": sig.strength},
    }


def _ict_to_dict(symbol: str, setup: Any) -> dict:
    from app.models.signal import SignalSource
    return {
        "symbol": symbol,
        "source": SignalSource.ICT,
        "direction": setup.direction,
        "timeframe": setup.timeframe,
        "signal_time": setup.signal_time,
        "price": setup.price,
        "ict_pattern": setup.pattern.value,
        "sweep_high": setup.sweep_high,
        "sweep_low": setup.sweep_low,
        "order_block_top": setup.order_block_top,
        "order_block_bottom": setup.order_block_bottom,
        "fvg_top": setup.fvg_top,
        "fvg_bottom": setup.fvg_bottom,
        "extra": {"ict_quality": setup.quality},
    }
