"""add casting_in_progress column to tokens

Revision ID: 7c3f9b2e8a1d
Revises: 3a624964e00d
Create Date: 2026-03-19

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "7c3f9b2e8a1d"
down_revision = "3a624964e00d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("tokens"):
        cols = {c["name"] for c in inspector.get_columns("tokens")}
        if "casting_in_progress" not in cols:
            op.add_column(
                "tokens",
                sa.Column("casting_in_progress", sa.JSON(), nullable=True),
            )


def downgrade() -> None:
    op.drop_column("tokens", "casting_in_progress")
