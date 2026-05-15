"""Add covering index for terminal queries

Revision ID: 002
Revises: 001
Create Date: 2026-05-14
"""
from alembic import op

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_signals_source_score_time",
        "signals",
        ["source", "ml_score", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_signals_source_score_time", table_name="signals")
