"""add temp_hp column to tokens

Revision ID: add_temp_hp_to_tokens_20260227
Revises: d401cc65913a
Create Date: 2026-02-27

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = 'add_temp_hp_to_tokens_20260227'
down_revision = 'd401cc65913a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("tokens"):
        cols = {c["name"] for c in inspector.get_columns("tokens")}
        if "temp_hp" not in cols:
            op.add_column(
                "tokens",
                sa.Column("temp_hp", sa.Integer(), nullable=True)
            )


def downgrade() -> None:
    op.drop_column("tokens", "temp_hp")
