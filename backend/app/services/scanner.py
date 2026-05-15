"""
Smart signal scanner.

Data strategy
─────────────
1. BinanceStreamManager (WebSocket, no rate limits) maintains a live momentum
   ranking of ALL Binance Futures USDT symbols.
2. Each scan cycle pulls the top-N symbols by momentum score instead of
   blindly iterating all 300+ symbols.
3. Klines are fetched from Binance REST (primary) → Bybit REST (fallback).
   With ≤50 symbols × 6 TFs at 0.5 s delay ≈ 150 s of fetch time — well
   within both exchanges' public rate limits.
4. CoinGecko enriches market data independently (every 5 min, own job).
5. Signals are scored with the ML ensemble, deduplicated, and persisted to
   PostgreSQL, then published to Redis for WebSocket push.
"""
import asyncio
from datetime import datetime, timezone
from typing import Any

import pandas as pd
import redis.asyncio as aioredis
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert

from app.algorithms.confluence import ConfluenceEngine
from app.algorithms.ema import EMAStrategy
from app.algorithms.ict import ICTEngine
from app.algorithms.smc import SMCEngine
from app.algorithms.ml_scorer import MLScorer
from app.config import settings
from app.core.logging import get_logger
from app.core.redis import get_pool
from app.database import AsyncSessionFactory
from app.models.signal import Signal, SignalSource, SignalDirection
from app.services.binance import BinanceFuturesClient
from app.services.binance_ws import get_stream_manager
from app.services.bybit import BybitClient

logger = get_logger(__name__)

_ema_strategy = EMAStrategy(settings.EMA_FAST, settings.EMA_MID, settings.EMA_SLOW)
_ict_engine   = ICTEngine()
_smc_engine   = SMCEngine()
_conf_engine  = ConfluenceEngine()
_ml_scorer    = MLScorer(settings.ML_MODEL_PATH)


# ── Kline fetcher with Bybit fallback ─────────────────────────────────────────

async def _fetch_klines_with_fallback(
    symbol: str,
    timeframe: str,
    limit: int = 200,
    binance_client: BinanceFuturesClient | None = None,
) -> pd.DataFrame | None:
    """
    Fetch klines from Binance REST.  On rate-limit (418/429), fall back to
    Bybit.  Returns None if both sources fail.
    """
    # Primary: Binance
    if binance_client:
        try:
            return await binance_client.get_klines(symbol, timeframe, limit)
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (418, 429):
                logger.warning("Binance rate-limited, falling back to Bybit",
                               symbol=symbol, tf=timeframe, status=status)
            else:
                logger.debug("Binance kline failed, trying Bybit",
                             symbol=symbol, tf=timeframe, error=str(exc))

    # Fallback: Bybit
    try:
        async with BybitClient() as bybit:
            df = await bybit.get_klines(symbol, timeframe, limit)
            if not df.empty:
                return df
    except Exception as exc:
        logger.debug("Bybit kline failed", symbol=symbol, tf=timeframe, error=str(exc))

    return None


class SignalScanner:
    """
    Orchestrates the full scan cycle using smart symbol selection.

    Symbol selection
    ────────────────
    If the WebSocket manager has live data (≥10 symbols seen) we rank by
    momentum score and take the top-N.  If the WS hasn't connected yet we
    fall back to fetching the full Binance symbol list via REST (cold start).
    """

    def __init__(self) -> None:
        self._seen: set[str] = set()

    # ── Public entry points ────────────────────────────────────────────────────

    async def run_binance_scan(self) -> int:
        logger.info("Starting smart Binance scan")
        ws = get_stream_manager()

        async with BinanceFuturesClient() as client:
            # Smart symbol selection
            if ws.symbol_count >= 100:
                symbols = ws.get_top_symbols(settings.MAX_SYMBOLS_PER_SCAN)
                logger.info("WS momentum ranking (volume-gated $10M+)",
                            symbols=len(symbols), ws_total=ws.symbol_count)
            else:
                # Cold start: volume-ranked REST list (established coins first)
                symbols = await client.get_usdt_symbols()
                logger.info("Cold-start symbol list (volume-ranked)", symbols=len(symbols))

            # Fetch all 24h tickers in one call — provides change_24h + volume for
            # every symbol without per-symbol REST calls (weight: ~40 total).
            ticker_map: dict[str, dict] = {}
            try:
                tickers = await client.get_ticker_24h()
                ticker_map = {t["symbol"]: t for t in tickers if "symbol" in t}
                logger.info("24h ticker map loaded", count=len(ticker_map))
            except Exception as exc:
                logger.warning("24h ticker fetch failed, using WS fallback", error=str(exc))

            saved = 0
            for i in range(0, len(symbols), 10):
                batch = symbols[i: i + 10]
                tasks = [self._scan_symbol(client, sym, ws, ticker_map) for sym in batch]
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for sym, res in zip(batch, results):
                    if isinstance(res, Exception):
                        logger.warning("Symbol scan failed", symbol=sym, error=str(res))
                    else:
                        saved += res  # type: ignore[operator]
                await asyncio.sleep(0.2)

        logger.info("Binance scan complete", saved=saved)
        return saved

    # ── Per-symbol scan ───────────────────────────────────────────────────────

    async def _scan_symbol(
        self,
        client: BinanceFuturesClient,
        symbol: str,
        ws: Any,
        ticker_map: dict[str, dict] | None = None,
    ) -> int:
        # Fetch all timeframes in parallel — 6× faster than sequential.
        # A single 0.3 s sleep after all fetches is enough to stay well below
        # Binance's 1200-weight/min limit (75 symbols × 6 TFs = 450 req/scan).
        candles: dict[str, pd.DataFrame] = {}

        async def _fetch_tf(tf: str) -> None:
            df = await _fetch_klines_with_fallback(symbol, tf, limit=200, binance_client=client)
            if df is not None and not df.empty:
                candles[tf] = df

        await asyncio.gather(*[_fetch_tf(tf) for tf in settings.TIMEFRAMES])
        await asyncio.sleep(0.3)   # brief pause between symbols to respect rate limits

        if not candles:
            return 0

        # Build market data from best available source:
        # 1. Pre-fetched 24h REST ticker (most reliable, always present)
        # 2. WS miniTicker (live, but only available after stream warms up)
        ticker_map = ticker_map or {}
        rest_tick = ticker_map.get(symbol, {})
        ws_tick   = ws.get_ticker(symbol) if ws.symbol_count > 0 else None

        # 24h change % and USDT volume — REST ticker is authoritative
        change_24h: float = float(rest_tick.get("priceChangePercent", 0) or 0)
        volume_usdt_24h: float = float(rest_tick.get("quoteVolume", 0) or 0)
        if change_24h == 0 and ws_tick:
            change_24h = float(ws_tick.get("change_pct", 0) or 0)
        if volume_usdt_24h == 0 and ws_tick:
            volume_usdt_24h = float(ws_tick.get("quote_volume", 0) or 0)

        # 1h change % — computed from last two closed 1h candles
        change_1h: float = 0.0
        df_1h = candles.get("1h")
        if df_1h is not None and len(df_1h) >= 2:
            c_now  = float(df_1h["close"].iloc[-1])
            c_prev = float(df_1h["close"].iloc[-2])
            if c_prev > 0:
                change_1h = round((c_now - c_prev) / c_prev * 100, 4)

        signals_to_save: list[dict] = []

        # EMA signals per TF — include the live candle so crossovers fire
        # immediately on the first cross, not after the candle closes.
        for tf, df in candles.items():
            sig = _ema_strategy.scan(symbol, tf, df)
            if sig:
                key = f"{symbol}:{SignalSource.BINANCE}:{tf}:{sig.signal_time.isoformat()}"
                if key not in self._seen:
                    self._seen.add(key)
                    d = _ema_to_dict(sig)
                    d.setdefault("extra", {})
                    d["extra"]["change_1h"]        = change_1h
                    d["extra"]["change_24h"]       = change_24h
                    d["extra"]["volume_usdt_24h"]  = volume_usdt_24h
                    adx_val = float(d["extra"].get("adx") or 0)
                    d["extra"]["volatility"] = round(
                        min(10.0, (adx_val / 60.0) * 6.0 + (abs(change_24h) / 20.0) * 4.0), 2
                    )
                    signals_to_save.append(d)

        # Multi-TF confluence — use only closed candles
        closed_candles = {tf: df.iloc[:-1] for tf, df in candles.items()}
        conf = _conf_engine.scan(symbol, closed_candles)
        if conf:
            key = f"{symbol}:confluence:{conf.direction}:{datetime.now(timezone.utc).date()}"
            if key not in self._seen:
                self._seen.add(key)
                ref_df  = closed_candles.get(conf.best_entry_tf, next(iter(closed_candles.values())))
                price   = float(ref_df["close"].iloc[-1])
                ref_ts  = pd.Timestamp(ref_df["open_time"].iloc[-1]).to_pydatetime()

                ml_features = MLScorer.build_features(
                    {"price": price, "direction": conf.direction,
                     "timeframe": conf.best_entry_tf, "signal_time": ref_ts,
                     "confluence_score": conf.score},
                    candle_1h=closed_candles.get("1h"),
                    candle_4h=closed_candles.get("4h"),
                    candle_1d=closed_candles.get("1d"),
                )
                ml_score, ml_conf = _ml_scorer.predict(ml_features)

                signals_to_save.append({
                    "symbol":             symbol,
                    "source":             SignalSource.BINANCE,
                    "direction":          SignalDirection(conf.direction),
                    "timeframe":          conf.best_entry_tf,
                    "signal_time":        ref_ts,
                    "price":              price,
                    "confluence_score":   conf.score,
                    "aligned_timeframes": conf.aligned_timeframes,
                    "ml_score":           ml_score,
                    "ml_confidence":      ml_conf,
                    "ml_features":        ml_features,
                    "extra": {
                        "source_detail":   "confluence",
                        "change_1h":       change_1h,
                        "change_24h":      change_24h,
                        "volume_usdt_24h": volume_usdt_24h,
                        "volatility":      round(min(10.0, (abs(change_24h) / 20.0) * 4.0), 2),
                    },
                })

        # ICT setups — comprehensive confluence scan (≥3/7 confluences)
        for tf, df in closed_candles.items():
            for setup in _ict_engine.scan_comprehensive(symbol, tf, df):
                key = f"{symbol}:ict:{setup.direction}:{tf}:{setup.signal_time.isoformat()}"
                if key not in self._seen:
                    self._seen.add(key)
                    signals_to_save.append(_comprehensive_ict_to_dict(symbol, setup))

        # SMC setups — supply/demand + structure confluence scan
        for tf, df in closed_candles.items():
            for setup in _smc_engine.scan_comprehensive(symbol, tf, df):
                key = f"{symbol}:smc:{setup.direction}:{tf}:{setup.signal_time.isoformat()}"
                if key not in self._seen:
                    self._seen.add(key)
                    signals_to_save.append(_smc_to_dict(symbol, setup))

        return await self._persist_signals(signals_to_save)

    # ── Persistence ───────────────────────────────────────────────────────────

    async def _persist_signals(self, signals: list[dict]) -> int:
        if not signals:
            return 0
        count = 0
        published: list[dict] = []
        async with AsyncSessionFactory() as session:
            for sig in signals:
                clean = {k: v for k, v in sig.items() if v is not None}
                stmt = insert(Signal).values([clean])
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_signal",
                    # On re-scan: refresh market data so stale signals get
                    # correct change_1h / change_24h / volume_usdt_24h.
                    set_={
                        "extra":         stmt.excluded.extra,
                        "price":         stmt.excluded.price,
                        "ml_score":      stmt.excluded.ml_score,
                        "ml_confidence": stmt.excluded.ml_confidence,
                        "updated_at":    func.now(),
                    },
                )
                result = await session.execute(stmt)
                if result.rowcount:
                    count += 1
                    published.append(sig)
            await session.commit()

        if published:
            await self._publish_signals(published)
        return count

    async def _publish_signals(self, signals: list[dict]) -> None:
        try:
            import orjson
            redis = aioredis.Redis(connection_pool=get_pool())
            for sig in signals:
                payload = orjson.dumps({
                    "symbol":           sig["symbol"],
                    "source":           sig["source"].value if hasattr(sig["source"], "value") else sig["source"],
                    "direction":        sig["direction"].value if hasattr(sig["direction"], "value") else sig["direction"],
                    "timeframe":        sig.get("timeframe"),
                    "price":            sig.get("price"),
                    "ml_score":         sig.get("ml_score"),
                    "confluence_score": sig.get("confluence_score"),
                }).decode()
                await redis.publish("signals:live", payload)
            await redis.aclose()
        except Exception as exc:
            logger.warning("Redis publish failed", error=str(exc))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ema_to_dict(sig: Any) -> dict:
    return {
        "symbol":       sig.symbol,
        "source":       SignalSource.BINANCE,
        "direction":    SignalDirection(sig.direction),
        "timeframe":    sig.timeframe,
        "signal_time":  sig.signal_time,
        "price":        sig.price,
        "volume":       sig.volume,
        "ema_fast":     sig.ema_fast,
        "ema_mid":      sig.ema_mid,
        "ema_slow":     sig.ema_slow,
        # Store strength as ml_score so the DB filter and frontend score both work
        "ml_score":     sig.strength,
        "ml_confidence": sig.strength,
        "extra":        {"ema_strength": sig.strength, "adx": getattr(sig, "adx", 0)},
    }


def _ict_to_dict(symbol: str, setup: Any) -> dict:
    return _comprehensive_ict_to_dict(symbol, setup)


def _comprehensive_ict_to_dict(symbol: str, setup: Any) -> dict:
    """Persist all ICT confluence flags so the frontend can read them exactly."""
    return {
        "symbol":             symbol,
        "source":             SignalSource.ICT,
        "direction":          SignalDirection(setup.direction),
        "timeframe":          setup.timeframe,
        "signal_time":        setup.signal_time,
        "price":              setup.price,
        "ict_pattern":        setup.pattern.value,
        "sweep_high":         setup.sweep_high,
        "sweep_low":          setup.sweep_low,
        "order_block_top":    setup.order_block_top,
        "order_block_bottom": setup.order_block_bottom,
        "fvg_top":            setup.fvg_top,
        "fvg_bottom":         setup.fvg_bottom,
        "confluence_score":   setup.confluence_count / 7.0,   # 0..1 (now 7-point scale)
        "extra": {
            "ict_quality":       setup.quality,
            "ict_comprehensive": True,
            "confluence_count":  setup.confluence_count,
            "has_sweep":         setup.has_sweep,
            "has_displacement":  setup.has_displacement,
            "has_order_block":   setup.has_order_block,
            "has_fvg":           setup.has_fvg,
            "has_bos":           setup.has_bos,
            "has_choch":         setup.has_choch,
            "has_inducement":    setup.has_inducement,
            "kill_zone":         setup.kill_zone,
            "ote_top":           getattr(setup, "ote_top", None),
            "ote_bottom":        getattr(setup, "ote_bottom", None),
            "amd_phase":         getattr(setup, "amd_phase", None),
            "structure_type":    getattr(setup, "structure_type", "NEUTRAL"),
        },
    }


def _smc_to_dict(symbol: str, setup: Any) -> dict:
    """Persist all SMC confluence flags for the frontend (7-point scale)."""
    return {
        "symbol":           symbol,
        "source":           SignalSource.SMC,
        "direction":        SignalDirection(setup.direction),
        "timeframe":        setup.timeframe,
        "signal_time":      setup.signal_time,
        "price":            setup.price,
        "fvg_top":          setup.fvg_top,
        "fvg_bottom":       setup.fvg_bottom,
        "confluence_score": setup.confluence_count / 7.0,   # 7-point scale
        "extra": {
            "smc_quality":       setup.quality,
            "smc_setup_type":    setup.setup_type,
            "confluence_count":  setup.confluence_count,
            "structure_type":    setup.structure_type,
            "zone_tests":        setup.zone_tests,
            "pd_context":        setup.pd_context,
            # Confluence flags
            "has_bos":           setup.has_bos,
            "has_choch":         setup.has_choch,
            "has_supply_demand": setup.has_supply_demand,
            "has_order_block":   setup.has_order_block,
            "has_displacement":  setup.has_displacement,
            "has_fvg":           setup.has_fvg,
            "has_equal_hl":      setup.has_equal_hl,
            "has_inducement":    setup.has_inducement,
            "has_mitigation":    setup.has_mitigation,
            # Key levels
            "zone_top":          setup.zone_top,
            "zone_bottom":       setup.zone_bottom,
            "ob_top":            setup.ob_top,
            "ob_bottom":         setup.ob_bottom,
            "liquidity_level":   setup.liquidity_level,
            "structure_level":   setup.structure_level,
        },
    }
