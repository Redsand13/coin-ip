"""
Institutional Order Flow Pipeline — singleton orchestrator.

Architecture:
  Binance WS (spot + futures)
    → StreamManager dispatches to handlers
    → SymbolState updated in-memory
    → Detectors run every EVAL_COOLDOWN seconds per symbol
    → Confidence scored
    → State cached in Redis (institutional:{sym}:state)
    → High-confidence alerts published to Redis pub/sub (institutional:live)

Rate-limit strategy:
  - All real-time data (trades, depth, mark price, liquidations) via WebSocket
    — zero REST calls for real-time feeds
  - Open interest polled every OI_INTERVAL_S seconds via REST
    (~20 symbols × 1 req / 30 s ≈ 0.67 req/s, vs Binance limit of 40 req/s)
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx
import redis.asyncio as aioredis

from app.core.logging import get_logger
from app.core.redis import get_pool
from app.services.institutional.stream_manager import StreamManager
from app.services.institutional.state import Detection, SymbolState, Trade
from app.services.institutional import cvd        as CVD_MOD
from app.services.institutional import vwap       as VWAP_MOD
from app.services.institutional import order_book as OB_MOD
from app.services.institutional.detectors import run_all
from app.services.institutional.scoring   import compute as score_compute

log = get_logger(__name__)

ALERT_THRESHOLD  = 58.0    # confidence score that triggers a pub/sub alert
EVAL_COOLDOWN_S  = 2.0     # minimum seconds between evaluations per symbol
STATE_TTL_S      = 120     # Redis TTL for per-symbol state key
ALERT_TTL_S      = 3600    # Redis TTL for alerts sorted set
OI_INTERVAL_S      = 60       # open interest REST poll period (60s to stay well under limits)
OI_STARTUP_DELAY   = 30       # wait after pipeline start before first OI poll
OI_CONCURRENCY     = 10       # parallel OI requests (semaphore)
RANGE_RESET_S      = 14_400   # reset price range every 4 hours
MAX_SYMBOLS        = 75       # top N symbols by 24h futures volume
MIN_VOLUME_USD     = 10_000_000  # $10M minimum 24h volume filter
PERSIST_INTERVAL_S = 300      # write DB snapshot every 5 minutes
PERSIST_WARMUP_S   = 90       # wait before first DB flush (let streams warm up)

FUTURES_BASE = "https://fapi.binance.com"

FALLBACK_SYMBOLS: list[str] = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
    "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "MATICUSDT", "DOTUSDT",
    "LINKUSDT", "UNIUSDT", "LTCUSDT", "ATOMUSDT", "NEARUSDT",
    "APTUSDT", "OPUSDT",  "ARBUSDT", "INJUSDT",  "SUIUSDT",
]


async def _fetch_top_symbols() -> list[str]:
    """Fetch top futures symbols by 24h USDT volume from Binance."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Get all active USDT perpetual symbols
            info = (await client.get(f"{FUTURES_BASE}/fapi/v1/exchangeInfo")).json()
            valid = {
                s["symbol"] for s in info.get("symbols", [])
                if s.get("quoteAsset") == "USDT" and s.get("status") == "TRADING"
            }
            # Rank by 24h quote volume
            tickers = (await client.get(f"{FUTURES_BASE}/fapi/v1/ticker/24hr")).json()
            ranked = sorted(
                (t for t in tickers if t["symbol"] in valid),
                key=lambda t: float(t.get("quoteVolume", 0)),
                reverse=True,
            )
            symbols = [
                t["symbol"] for t in ranked
                if float(t.get("quoteVolume", 0)) >= MIN_VOLUME_USD
            ][:MAX_SYMBOLS]
            log.info("institutional_symbols_fetched", count=len(symbols))
            return symbols
    except Exception as exc:
        log.warning("institutional_symbols_fetch_failed", error=str(exc))
        return FALLBACK_SYMBOLS


class InstitutionalPipeline:
    def __init__(self) -> None:
        self._states: dict[str, SymbolState] = {}
        self._stream  = StreamManager()
        self._redis:        aioredis.Redis | None = None
        self._oi_task:      asyncio.Task | None   = None
        self._persist_task: asyncio.Task | None   = None
        self._running  = False
        self.symbols:  list[str] = list(FALLBACK_SYMBOLS)

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    async def start(self, symbols: list[str] | None = None) -> None:
        if self._running:
            return

        # Start immediately with fallback so the API is never blocked.
        # Symbol list is expanded to the full volume-ranked set in the background.
        self.symbols = [s.upper() for s in symbols] if symbols else list(FALLBACK_SYMBOLS)

        for sym in self.symbols:
            self._states[sym] = SymbolState(symbol=sym)

        self._redis   = aioredis.Redis(connection_pool=get_pool())
        self._running = True

        await self._sync_symbols_to_redis()

        for sym in self.symbols:
            sl = sym.lower()
            # Spot streams
            self._stream.add_spot(f"{sl}@aggTrade",       self._trade_handler(sym, futures=False))
            self._stream.add_spot(f"{sl}@depth20@500ms",  self._depth_handler(sym))
            self._stream.add_spot(f"{sl}@miniTicker",     self._ticker_handler(sym))
            # Futures streams — one aggTrade + forceOrder per symbol
            self._stream.add_futures(f"{sl}@aggTrade",   self._trade_handler(sym, futures=True))
            self._stream.add_futures(f"{sl}@forceOrder", self._liq_handler(sym))

        # Single all-market mark price stream replaces N per-symbol streams.
        # Pushes mark price + funding rate for every symbol every second.
        self._stream.add_futures("!markPrice@arr@1s", self._all_mark_handler())

        await self._stream.start()
        self._oi_task      = asyncio.create_task(self._poll_oi())
        self._persist_task = asyncio.create_task(self._persist_loop())
        # Expand to full volume-ranked symbol list in background (non-blocking)
        asyncio.create_task(self._expand_symbols())
        log.info("institutional_pipeline_started", symbols=len(self.symbols))

    async def stop(self) -> None:
        if not self._running:
            return
        self._running = False
        await self._stream.stop()
        for task in (self._oi_task, self._persist_task):
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        if self._redis:
            await self._redis.aclose()
        log.info("institutional_pipeline_stopped")

    # ── Redis symbol sync ─────────────────────────────────────────────────────

    async def _sync_symbols_to_redis(self) -> None:
        if not self._redis or not self.symbols:
            return
        try:
            # atomic: delete + re-add
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.delete("institutional:symbols")
                pipe.sadd("institutional:symbols", *self.symbols)
                await pipe.execute()
        except Exception as exc:
            log.warning("redis_symbols_sync_error", error=str(exc))

    # ── Symbol expansion ──────────────────────────────────────────────────────

    async def _expand_symbols(self) -> None:
        """Fetch full volume-ranked symbol list and add any new symbols."""
        full = await _fetch_top_symbols()
        new_syms = [s for s in full if s not in self._states]
        if not new_syms:
            return
        for sym in new_syms:
            self._states[sym] = SymbolState(symbol=sym)
            sl = sym.lower()
            self._stream.add_spot(f"{sl}@aggTrade",      self._trade_handler(sym, futures=False))
            self._stream.add_spot(f"{sl}@depth20@500ms", self._depth_handler(sym))
            self._stream.add_spot(f"{sl}@miniTicker",    self._ticker_handler(sym))
            self._stream.add_futures(f"{sl}@aggTrade",   self._trade_handler(sym, futures=True))
            self._stream.add_futures(f"{sl}@forceOrder", self._liq_handler(sym))
        self.symbols = list(self._states.keys())
        await self._sync_symbols_to_redis()
        log.info("institutional_symbols_expanded", added=len(new_syms), total=len(self.symbols))

    # ── WebSocket handlers ─────────────────────────────────────────────────────

    def _trade_handler(self, symbol: str, futures: bool):
        async def handle(data: dict) -> None:
            state = self._states.get(symbol)
            if state is None:
                return
            try:
                trade = Trade(
                    ts=float(data["T"]),
                    price=float(data["p"]),
                    qty=float(data["q"]),
                    is_buy=not bool(data["m"]),  # m=True → maker buyer → taker sold
                )
            except (KeyError, ValueError) as exc:
                log.debug("trade_parse_error", symbol=symbol, error=str(exc))
                return

            state.trades.append(trade)
            CVD_MOD.update_cvd(state, trade)
            VWAP_MOD.update_vwap(state, trade)
            _update_vol_ma(state)

            if futures:
                state.futures_price = trade.price
            else:
                state.spot_price = trade.price
                _update_range(state)

            await self._maybe_evaluate(symbol, state)
        return handle

    def _depth_handler(self, symbol: str):
        async def handle(data: dict) -> None:
            state = self._states.get(symbol)
            if state is None:
                return
            OB_MOD.update_order_book(
                state,
                data.get("bids", []),
                data.get("asks", []),
            )
        return handle

    def _ticker_handler(self, symbol: str):
        async def handle(data: dict) -> None:
            state = self._states.get(symbol)
            if state is None:
                return
            try:
                state.high_24h   = float(data["h"])
                state.low_24h    = float(data["l"])
                state.volume_24h = float(data["q"])  # quote volume in USDT
            except (KeyError, ValueError):
                pass
        return handle

    def _all_mark_handler(self):
        """Handles !markPrice@arr@1s — one push per second for ALL symbols."""
        async def handle(data) -> None:
            items = data if isinstance(data, list) else [data]
            for item in items:
                sym = item.get("s", "")
                state = self._states.get(sym)
                if state is None:
                    continue
                try:
                    state.mark_price   = float(item["p"])
                    state.funding_rate = float(item["r"])
                    if state.futures_price == 0:
                        state.futures_price = state.mark_price
                except (KeyError, ValueError):
                    pass
        return handle

    def _liq_handler(self, symbol: str):
        async def handle(data: dict) -> None:
            state = self._states.get(symbol)
            if state is None:
                return
            try:
                order = data.get("o", {})
                side  = order.get("S", "")
                qty   = float(order.get("q", 0))
                price = float(order.get("p", 0))
                usd   = qty * price
                if side == "BUY":
                    state.liq_buy_usd  += usd   # forced buy = shorts liquidated
                else:
                    state.liq_sell_usd += usd   # forced sell = longs liquidated
            except (KeyError, ValueError, TypeError):
                pass
        return handle

    # ── DB persistence ────────────────────────────────────────────────────────

    async def _persist_loop(self) -> None:
        """Write snapshots of all tracked symbols to PostgreSQL every PERSIST_INTERVAL_S."""
        await asyncio.sleep(PERSIST_WARMUP_S)
        while self._running:
            try:
                await self._flush_to_db()
            except Exception as exc:
                log.warning("persist_flush_error", error=str(exc))
            await asyncio.sleep(PERSIST_INTERVAL_S)

    async def _flush_to_db(self) -> None:
        from datetime import datetime, timezone
        from app.database import AsyncSessionFactory
        from app.models.market_flow import MarketFlowSnapshot

        now = datetime.now(timezone.utc)
        rows: list[MarketFlowSnapshot] = []
        for sym, state in list(self._states.items()):
            if state.spot_price == 0:
                continue
            d = state_to_dict(sym, state)
            rows.append(MarketFlowSnapshot(
                symbol=sym,
                snapshot_at=now,
                spot_price=d["spot_price"],
                futures_price=d["futures_price"],
                mark_price=d["mark_price"],
                funding_rate=d["funding_rate"],
                open_interest=d["open_interest"],
                oi_delta=d["oi_delta"],
                cvd_5m=d["cvd_5m"],
                cvd_15m=d["cvd_15m"],
                cvd_total=d["cvd_total"],
                vwap=d["vwap"],
                vwap_zone=d["vwap_zone"],
                vwap_pct=d["vwap_pct"],
                bid_imbalance=d["bid_imbalance"],
                book_pressure=d["book_pressure"],
                volume_24h=d["volume_24h"],
                liq_buy_usd=d["liq_buy_usd"],
                liq_sell_usd=d["liq_sell_usd"],
                confidence=d["confidence"],
                direction=d["direction"],
                detections=d["detections"],
            ))

        if not rows:
            return

        async with AsyncSessionFactory() as session:
            session.add_all(rows)
            await session.commit()

        log.info("market_flow_persisted", symbols=len(rows), timestamp=now.isoformat())

    # ── Open Interest REST poll ────────────────────────────────────────────────

    async def _poll_oi(self) -> None:
        # Wait for WebSocket streams to warm up before first REST poll
        await asyncio.sleep(OI_STARTUP_DELAY)
        sem     = asyncio.Semaphore(OI_CONCURRENCY)
        backoff = OI_INTERVAL_S

        async def _fetch_one(client: httpx.AsyncClient, sym: str) -> None:
            async with sem:
                try:
                    resp = await client.get(
                        f"{FUTURES_BASE}/fapi/v1/openInterest",
                        params={"symbol": sym},
                    )
                    if resp.status_code == 200:
                        oi    = float(resp.json().get("openInterest", 0))
                        state = self._states.get(sym)
                        if state:
                            state.oi_delta      = oi - state.open_interest
                            state.oi_prev       = state.open_interest
                            state.open_interest = oi
                    elif resp.status_code == 429:
                        log.warning("oi_rate_limited", symbol=sym)
                    else:
                        log.debug("oi_poll_skip", symbol=sym, status=resp.status_code)
                except Exception as exc:
                    log.debug("oi_poll_error", symbol=sym, error=str(exc))

        async with httpx.AsyncClient(timeout=10.0) as client:
            while self._running:
                # Fetch all symbols concurrently (OI_CONCURRENCY at a time)
                await asyncio.gather(*[_fetch_one(client, sym) for sym in self.symbols])
                log.debug("oi_poll_complete", symbols=len(self.symbols))
                await asyncio.sleep(backoff)

    # ── Evaluation ────────────────────────────────────────────────────────────

    async def _maybe_evaluate(self, symbol: str, state: SymbolState) -> None:
        now = time.time()
        if now - state._last_eval < EVAL_COOLDOWN_S:
            return
        state._last_eval = now

        state.detections        = run_all(state)
        score, direction         = score_compute(state.detections)
        state.confidence        = score
        state.primary_direction = direction
        state.updated_at        = now

        await self._store_state(symbol, state)

        if score >= ALERT_THRESHOLD and state.detections:
            await self._publish_alert(symbol, state)

    async def _store_state(self, symbol: str, state: SymbolState) -> None:
        if not self._redis:
            return
        try:
            await self._redis.setex(
                f"institutional:{symbol}:state",
                STATE_TTL_S,
                json.dumps(state_to_dict(symbol, state)),
            )
        except Exception as exc:
            log.warning("redis_store_error", symbol=symbol, error=str(exc))

    async def _publish_alert(self, symbol: str, state: SymbolState) -> None:
        if not self._redis:
            return
        payload = json.dumps(state_to_dict(symbol, state))
        try:
            await self._redis.zadd(
                "institutional:alerts",
                {payload: state.confidence},
            )
            await self._redis.expire("institutional:alerts", ALERT_TTL_S)
            await self._redis.publish("institutional:live", payload)
        except Exception as exc:
            log.warning("redis_publish_error", symbol=symbol, error=str(exc))

    # ── Public read API ────────────────────────────────────────────────────────

    def get_state(self, symbol: str) -> SymbolState | None:
        return self._states.get(symbol.upper())

    def all_states(self) -> list[SymbolState]:
        return list(self._states.values())

    def snapshot_dict(self, symbol: str) -> dict[str, Any] | None:
        state = self._states.get(symbol.upper())
        return state_to_dict(symbol.upper(), state) if state else None

    def all_snapshots(self) -> list[dict[str, Any]]:
        return [state_to_dict(sym, s) for sym, s in self._states.items()]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _update_range(state: SymbolState) -> None:
    price = state.spot_price
    if price == 0:
        return
    now = time.time()
    if now - state.range_ts > RANGE_RESET_S:
        state.range_high = price
        state.range_low  = price
        state.range_ts   = now
    else:
        if price > state.range_high:
            state.range_high = price
        if price < state.range_low:
            state.range_low = price


def _update_vol_ma(state: SymbolState) -> None:
    now_ms = time.time() * 1000

    def _rate(window_ms: float) -> float:
        recent = [t for t in state.trades if now_ms - t.ts <= window_ms]
        return sum(t.price * t.qty for t in recent) / (window_ms / 1000) if recent else 0.0

    state.vol_ma5  = _rate(300_000)
    state.vol_ma15 = _rate(900_000)


def state_to_dict(symbol: str, state: SymbolState) -> dict[str, Any]:
    return {
        "symbol":           symbol,
        "spot_price":       state.spot_price,
        "futures_price":    state.futures_price,
        "mark_price":       state.mark_price,
        "funding_rate":     state.funding_rate,
        "open_interest":    state.open_interest,
        "oi_delta":         state.oi_delta,
        "cvd_5m":           round(state.cvd_5m, 2),
        "cvd_15m":          round(state.cvd_15m, 2),
        "cvd_total":        round(state.cvd_total, 2),
        "vwap":             state.vwap,
        "vwap_std":         state.vwap_std,
        "vwap_zone":        VWAP_MOD.vwap_zone(state),
        "vwap_pct":         round(VWAP_MOD.vwap_pct(state), 3),
        "bid_imbalance":    round(state.bid_imbalance, 4),
        "book_pressure":    round(state.book_pressure, 4),
        "volume_24h":       state.volume_24h,
        "vol_ma5":          round(state.vol_ma5, 2),
        "liq_buy_usd":      round(state.liq_buy_usd, 2),
        "liq_sell_usd":     round(state.liq_sell_usd, 2),
        "spot_futures_div": round(state.spot_futures_divergence(), 4),
        "high_24h":         state.high_24h,
        "low_24h":          state.low_24h,
        "confidence":       state.confidence,
        "direction":        state.primary_direction,
        "detections": [
            {
                "kind":       d.kind,
                "direction":  d.direction,
                "confidence": round(d.confidence, 3),
                "details":    d.details,
            }
            for d in state.detections
        ],
        "updated_at": state.updated_at,
    }


# ── Singleton ──────────────────────────────────────────────────────────────────

_instance: InstitutionalPipeline | None = None


def get_pipeline() -> InstitutionalPipeline:
    global _instance
    if _instance is None:
        _instance = InstitutionalPipeline()
    return _instance
