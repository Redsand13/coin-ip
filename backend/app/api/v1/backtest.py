"""Backtest endpoints — submit runs, poll results, fetch trades."""
import asyncio
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import ORJSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_api_key
from app.database import get_db
from app.models.backtest import BacktestRun, BacktestStatus, BacktestTrade
from app.schemas.backtest import BacktestRequest, BacktestResult, BacktestTradeRead

router = APIRouter(prefix="/backtest", tags=["Backtest"])


@router.post("", response_model=BacktestResult, response_class=ORJSONResponse)
async def submit_backtest(
    req: BacktestRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_api_key),
) -> BacktestResult:
    run = BacktestRun(
        name=req.name,
        strategy=req.strategy,
        symbol=req.symbol,
        timeframe=req.timeframe,
        start_date=req.start_date,
        end_date=req.end_date,
        params=req.params,
        status=BacktestStatus.PENDING,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    background_tasks.add_task(_execute_backtest, str(run.id), req.model_dump())
    return BacktestResult.model_validate(run)


@router.get("", response_class=ORJSONResponse)
async def list_backtests(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    q = select(BacktestRun).order_by(BacktestRun.created_at.desc()).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return [BacktestResult.model_validate(r).model_dump() for r in rows]


@router.get("/{run_id}", response_model=BacktestResult, response_class=ORJSONResponse)
async def get_backtest(
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> BacktestResult:
    run = await db.get(BacktestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Backtest run not found")
    return BacktestResult.model_validate(run)


@router.get("/{run_id}/trades", response_class=ORJSONResponse)
async def get_trades(
    run_id: UUID,
    limit: int = 500,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    q = (
        select(BacktestTrade)
        .where(BacktestTrade.run_id == run_id)
        .order_by(BacktestTrade.entry_time)
        .limit(limit)
    )
    rows = (await db.execute(q)).scalars().all()
    return [BacktestTradeRead.model_validate(r).model_dump() for r in rows]


# ── background execution ──────────────────────────────────────────────────────

async def _execute_backtest(run_id: str, params: dict) -> None:
    from datetime import datetime, timezone
    from app.database import AsyncSessionFactory
    from app.algorithms.backtester import Backtester
    from app.services.binance import BinanceFuturesClient
    from app.models.backtest import BacktestTrade

    async with AsyncSessionFactory() as session:
        run = await session.get(BacktestRun, run_id)
        if not run:
            return
        run.status = BacktestStatus.RUNNING
        await session.commit()

        try:
            bt = Backtester(
                strategy=params["strategy"],
                tp_pct=params.get("params", {}).get("tp_pct", 0.03),
                sl_pct=params.get("params", {}).get("sl_pct", 0.015),
            )

            # Fetch historical candles from Binance
            symbols = [params["symbol"]] if params.get("symbol") else None
            async with BinanceFuturesClient() as client:
                if not symbols:
                    symbols = (await client.get_usdt_symbols())[:50]

                all_trades = []
                for sym in symbols:
                    df = await client.get_klines(sym, params["timeframe"], limit=1000)
                    if len(df) < 150:
                        continue
                    report = bt.run(sym, params["timeframe"], df)
                    all_trades.extend(report.trades)

            # Aggregate across symbols
            if all_trades:
                import numpy as np
                pnls = [t.pnl_pct for t in all_trades if t.pnl_pct is not None]
                wins  = [p for p in pnls if p > 0]
                losses = [p for p in pnls if p <= 0]

                run.total_trades   = len(all_trades)
                run.winning_trades = len(wins)
                run.losing_trades  = len(losses)
                run.win_rate       = len(wins) / len(pnls) if pnls else 0
                run.total_pnl      = sum(pnls)
                run.avg_win        = float(np.mean(wins)) if wins else 0
                run.avg_loss       = float(np.mean(losses)) if losses else 0
                run.profit_factor  = (sum(wins) / abs(sum(losses))) if losses and sum(losses) != 0 else 0
                run.expectancy     = (run.win_rate * run.avg_win) + ((1 - run.win_rate) * run.avg_loss)
                if len(pnls) > 1:
                    ret_arr = np.array(pnls)
                    run.sharpe_ratio = float(ret_arr.mean() / (ret_arr.std() + 1e-10) * np.sqrt(252))

                # Persist individual trades
                for t in all_trades[:5000]:  # cap at 5k for storage
                    session.add(BacktestTrade(
                        run_id=run.id,
                        symbol=t.symbol,
                        direction=t.direction,
                        entry_time=t.entry_time,
                        exit_time=t.exit_time,
                        entry_price=t.entry_price,
                        exit_price=t.exit_price,
                        pnl_pct=t.pnl_pct,
                        exit_reason=t.exit_reason,
                        bars_held=t.bars_held,
                    ))

            run.status = BacktestStatus.COMPLETED
            run.completed_at = datetime.now(timezone.utc)

        except Exception as exc:
            run.status = BacktestStatus.FAILED
            run.error = str(exc)[:500]

        await session.commit()
