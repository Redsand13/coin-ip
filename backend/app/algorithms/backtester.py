"""
Vectorised backtester.

Replays historical OHLCV data through a strategy and returns
per-trade and aggregate performance metrics including equity curve,
Sharpe ratio, max drawdown, profit factor, and expectancy.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from app.algorithms.ema import EMAStrategy
from app.algorithms.ict import ICTEngine
from app.algorithms.confluence import ConfluenceEngine
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class Trade:
    symbol: str
    direction: str
    entry_time: datetime
    entry_price: float
    take_profit: float
    stop_loss: float
    exit_time: datetime | None = None
    exit_price: float | None = None
    pnl_pct: float | None = None
    exit_reason: str | None = None
    bars_held: int = 0


@dataclass
class BacktestReport:
    strategy: str
    symbol: str
    timeframe: str
    start_date: datetime
    end_date: datetime

    total_trades: int = 0
    winning_trades: int = 0
    losing_trades: int = 0
    win_rate: float = 0.0
    total_pnl: float = 0.0
    max_drawdown: float = 0.0
    sharpe_ratio: float = 0.0
    profit_factor: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    expectancy: float = 0.0
    max_consecutive_losses: int = 0
    equity_curve: list[dict] = field(default_factory=list)
    trades: list[Trade] = field(default_factory=list)
    params: dict[str, Any] = field(default_factory=dict)


class Backtester:
    """
    Walk-forward backtester.

    Usage:
        bt = Backtester(strategy="ema3", tp_pct=0.03, sl_pct=0.015)
        report = bt.run(symbol="BTCUSDT", timeframe="1h", df=df)
    """

    STRATEGIES = ("ema3", "ict", "confluence", "ml")

    def __init__(
        self,
        strategy: str = "ema3",
        tp_pct: float = 0.03,          # 3% take profit
        sl_pct: float = 0.015,         # 1.5% stop loss
        max_hold_bars: int = 48,       # exit after N bars if TP/SL not hit
        initial_capital: float = 10_000.0,
        risk_per_trade: float = 0.01,  # 1% of capital per trade
        commission: float = 0.0004,    # 0.04% taker fee
        **strategy_params: Any,
    ) -> None:
        if strategy not in self.STRATEGIES:
            raise ValueError(f"strategy must be one of {self.STRATEGIES}")
        self.strategy = strategy
        self.tp_pct = tp_pct
        self.sl_pct = sl_pct
        self.max_hold_bars = max_hold_bars
        self.capital = initial_capital
        self.risk_per_trade = risk_per_trade
        self.commission = commission
        self.strategy_params = strategy_params

        self._ema_engine = EMAStrategy()
        self._ict_engine = ICTEngine()
        self._conf_engine = ConfluenceEngine()

    # ── public ────────────────────────────────────────────────────────────────

    def run(self, symbol: str, timeframe: str, df: pd.DataFrame) -> BacktestReport:
        df = df.copy().reset_index(drop=True)
        report = BacktestReport(
            strategy=self.strategy,
            symbol=symbol,
            timeframe=timeframe,
            start_date=pd.Timestamp(df["open_time"].iloc[0]).to_pydatetime(),
            end_date=pd.Timestamp(df["open_time"].iloc[-1]).to_pydatetime(),
            params={"tp_pct": self.tp_pct, "sl_pct": self.sl_pct, **self.strategy_params},
        )

        trades: list[Trade] = []
        open_trade: Trade | None = None
        _entry_idx: int = 0
        equity = self.capital
        equity_curve: list[dict] = [{"ts": df["open_time"].iloc[0], "equity": equity}]

        min_bars = max(150, self.max_hold_bars + 10)
        if len(df) < min_bars:
            logger.warning("Insufficient bars for backtest", n=len(df), needed=min_bars)
            return report

        for i in range(100, len(df)):
            window = df.iloc[:i + 1]
            bar = df.iloc[i]
            ts = pd.Timestamp(bar["open_time"]).to_pydatetime()

            # ── manage open trade ────────────────────────────────────────────
            if open_trade is not None:
                exit_price, reason = self._check_exit(bar, open_trade, i - _entry_idx)
                if exit_price is not None:
                    pnl_pct = self._calc_pnl(open_trade.direction, open_trade.entry_price, exit_price)
                    open_trade.exit_time  = ts
                    open_trade.exit_price = exit_price
                    open_trade.pnl_pct    = pnl_pct
                    open_trade.exit_reason = reason
                    open_trade.bars_held   = i - _entry_idx

                    trade_pnl = equity * self.risk_per_trade * pnl_pct / (self.sl_pct or 0.01)
                    equity += trade_pnl - (equity * self.commission * 2)
                    trades.append(open_trade)
                    open_trade = None
                    equity_curve.append({"ts": str(ts), "equity": round(equity, 2)})
                    continue

                # max hold exit
                if (i - _entry_idx) >= self.max_hold_bars:
                    exit_price = float(bar["close"])
                    pnl_pct = self._calc_pnl(open_trade.direction, open_trade.entry_price, exit_price)
                    open_trade.exit_time  = ts
                    open_trade.exit_price = exit_price
                    open_trade.pnl_pct    = pnl_pct
                    open_trade.exit_reason = "TIMEOUT"
                    open_trade.bars_held   = i - _entry_idx
                    trade_pnl = equity * self.risk_per_trade * pnl_pct / (self.sl_pct or 0.01)
                    equity += trade_pnl - (equity * self.commission * 2)
                    trades.append(open_trade)
                    open_trade = None
                continue  # don't open new while one is open

            # ── generate signal ──────────────────────────────────────────────
            direction = self._get_signal(symbol, timeframe, window)
            if direction is None:
                continue

            entry_price = float(bar["close"])
            tp = entry_price * (1 + self.tp_pct) if direction == "LONG" else entry_price * (1 - self.tp_pct)
            sl = entry_price * (1 - self.sl_pct) if direction == "LONG" else entry_price * (1 + self.sl_pct)

            open_trade = Trade(
                symbol=symbol,
                direction=direction,
                entry_time=ts,
                entry_price=entry_price,
                take_profit=tp,
                stop_loss=sl,
            )
            _entry_idx = i

        # ── aggregate results ────────────────────────────────────────────────
        return self._aggregate(report, trades, equity_curve, equity)

    # ── private ───────────────────────────────────────────────────────────────

    def _get_signal(self, symbol: str, tf: str, window: pd.DataFrame) -> str | None:
        if self.strategy == "ema3":
            sig = self._ema_engine.scan(symbol, tf, window)
            return sig.direction if sig else None

        if self.strategy == "ict":
            setups = self._ict_engine.scan(symbol, tf, window)
            if setups:
                return setups[0].direction
            return None

        if self.strategy == "confluence":
            result = self._conf_engine.scan(symbol, {tf: window})
            return result.direction if result else None

        return None  # ml strategy handled externally

    def _check_exit(
        self, bar: pd.Series, trade: Trade, bars_held: int
    ) -> tuple[float | None, str | None]:
        if trade.direction == "LONG":
            if bar["high"] >= trade.take_profit:
                return trade.take_profit, "TP"
            if bar["low"] <= trade.stop_loss:
                return trade.stop_loss, "SL"
        else:
            if bar["low"] <= trade.take_profit:
                return trade.take_profit, "TP"
            if bar["high"] >= trade.stop_loss:
                return trade.stop_loss, "SL"
        return None, None

    @staticmethod
    def _calc_pnl(direction: str, entry: float, exit_: float) -> float:
        if direction == "LONG":
            return (exit_ - entry) / entry
        return (entry - exit_) / entry

    @staticmethod
    def _aggregate(
        report: BacktestReport,
        trades: list[Trade],
        equity_curve: list[dict],
        final_equity: float,
    ) -> BacktestReport:
        report.trades = trades
        report.equity_curve = equity_curve
        report.total_trades = len(trades)

        if not trades:
            return report

        pnls = [t.pnl_pct for t in trades if t.pnl_pct is not None]
        wins  = [p for p in pnls if p > 0]
        losses = [p for p in pnls if p <= 0]

        report.winning_trades = len(wins)
        report.losing_trades  = len(losses)
        report.win_rate       = len(wins) / len(pnls) if pnls else 0
        report.total_pnl      = sum(pnls)
        report.avg_win        = np.mean(wins)  if wins   else 0
        report.avg_loss       = np.mean(losses) if losses else 0
        report.profit_factor  = (sum(wins) / abs(sum(losses))) if losses and sum(losses) != 0 else float("inf")
        report.expectancy     = (report.win_rate * report.avg_win) + ((1 - report.win_rate) * report.avg_loss)

        # Sharpe (annualised, assuming daily returns)
        if len(pnls) > 1:
            ret_arr = np.array(pnls)
            report.sharpe_ratio = float(ret_arr.mean() / (ret_arr.std() + 1e-10) * np.sqrt(252))

        # Max drawdown from equity curve
        equities = np.array([e["equity"] for e in equity_curve])
        peak = np.maximum.accumulate(equities)
        dd = (equities - peak) / peak
        report.max_drawdown = float(dd.min())

        # Max consecutive losses
        streak = max_streak = 0
        for p in pnls:
            if p <= 0:
                streak += 1
                max_streak = max(max_streak, streak)
            else:
                streak = 0
        report.max_consecutive_losses = max_streak

        return report
