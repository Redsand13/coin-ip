"""Initial schema — signals, assets, backtest tables

Revision ID: 001
Revises:
Create Date: 2026-05-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── signals ───────────────────────────────────────────────────────────────
    op.create_table(
        "signals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("symbol", sa.String(20), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("direction", sa.String(5), nullable=False),
        sa.Column("timeframe", sa.String(5), nullable=False),
        sa.Column("signal_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("price", sa.Float, nullable=False),
        sa.Column("volume", sa.Float),
        sa.Column("market_cap", sa.Float),
        sa.Column("ema_fast", sa.Float),
        sa.Column("ema_mid", sa.Float),
        sa.Column("ema_slow", sa.Float),
        sa.Column("ict_pattern", sa.String(50)),
        sa.Column("sweep_high", sa.Float),
        sa.Column("sweep_low", sa.Float),
        sa.Column("order_block_top", sa.Float),
        sa.Column("order_block_bottom", sa.Float),
        sa.Column("fvg_top", sa.Float),
        sa.Column("fvg_bottom", sa.Float),
        sa.Column("confluence_score", sa.Float),
        sa.Column("aligned_timeframes", postgresql.JSONB),
        sa.Column("ml_score", sa.Float),
        sa.Column("ml_confidence", sa.Float),
        sa.Column("ml_features", postgresql.JSONB),
        sa.Column("outcome_pnl", sa.Float),
        sa.Column("outcome_hit_tp", sa.Boolean),
        sa.Column("outcome_hit_sl", sa.Boolean),
        sa.Column("outcome_max_favorable", sa.Float),
        sa.Column("outcome_max_adverse", sa.Float),
        sa.Column("extra", postgresql.JSONB),
        sa.Column("notes", sa.Text),
        sa.Column("notified", sa.Boolean, default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_unique_constraint("uq_signal", "signals", ["symbol", "source", "timeframe", "signal_time"])
    op.create_index("ix_signals_source_tf",  "signals", ["source", "timeframe"])
    op.create_index("ix_signals_symbol",     "signals", ["symbol"])
    op.create_index("ix_signals_created_at", "signals", ["created_at"])
    op.create_index("ix_signals_score",      "signals", ["ml_score"])

    # ── assets ────────────────────────────────────────────────────────────────
    op.create_table(
        "assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("symbol", sa.String(20), nullable=False, unique=True),
        sa.Column("base_asset", sa.String(20)),
        sa.Column("quote_asset", sa.String(10), default="USDT"),
        sa.Column("exchange", sa.String(20), default="binance"),
        sa.Column("last_price", sa.Float),
        sa.Column("price_change_24h", sa.Float),
        sa.Column("volume_24h", sa.Float),
        sa.Column("market_cap", sa.Float),
        sa.Column("rank", sa.Integer),
        sa.Column("signal_count_7d", sa.Integer, default=0),
        sa.Column("win_rate_7d", sa.Float),
        sa.Column("meta", postgresql.JSONB),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("last_seen", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── backtest_runs ─────────────────────────────────────────────────────────
    op.create_table(
        "backtest_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(100)),
        sa.Column("strategy", sa.String(50)),
        sa.Column("symbol", sa.String(20)),
        sa.Column("timeframe", sa.String(5)),
        sa.Column("start_date", sa.DateTime(timezone=True)),
        sa.Column("end_date", sa.DateTime(timezone=True)),
        sa.Column("params", postgresql.JSONB),
        sa.Column("status", sa.String(20), default="pending"),
        sa.Column("error", sa.String(500)),
        sa.Column("total_trades", sa.Integer, default=0),
        sa.Column("winning_trades", sa.Integer, default=0),
        sa.Column("losing_trades", sa.Integer, default=0),
        sa.Column("win_rate", sa.Float),
        sa.Column("total_pnl", sa.Float),
        sa.Column("max_drawdown", sa.Float),
        sa.Column("sharpe_ratio", sa.Float),
        sa.Column("profit_factor", sa.Float),
        sa.Column("avg_win", sa.Float),
        sa.Column("avg_loss", sa.Float),
        sa.Column("expectancy", sa.Float),
        sa.Column("max_consecutive_losses", sa.Integer),
        sa.Column("equity_curve", postgresql.JSONB),
        sa.Column("summary", postgresql.JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )

    # ── backtest_trades ───────────────────────────────────────────────────────
    op.create_table(
        "backtest_trades",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("backtest_runs.id", ondelete="CASCADE")),
        sa.Column("symbol", sa.String(20)),
        sa.Column("direction", sa.String(5)),
        sa.Column("entry_time", sa.DateTime(timezone=True)),
        sa.Column("exit_time", sa.DateTime(timezone=True)),
        sa.Column("entry_price", sa.Float),
        sa.Column("exit_price", sa.Float),
        sa.Column("take_profit", sa.Float),
        sa.Column("stop_loss", sa.Float),
        sa.Column("pnl_pct", sa.Float),
        sa.Column("pnl_abs", sa.Float),
        sa.Column("exit_reason", sa.String(20)),
        sa.Column("bars_held", sa.Integer),
    )
    op.create_index("ix_backtest_trades_run_id", "backtest_trades", ["run_id"])


def downgrade() -> None:
    op.drop_table("backtest_trades")
    op.drop_table("backtest_runs")
    op.drop_table("assets")
    op.drop_table("signals")
