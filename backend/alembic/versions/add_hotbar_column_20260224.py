"""add hotbar JSON column to characters

Revision ID: add_hotbar_column_20260224
Revises: add_status_effects_20260223
Create Date: 2026-02-24

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = 'add_hotbar_column_20260224'
down_revision = 'add_status_effects_20260223'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("characters"):
        cols = {c["name"] for c in inspector.get_columns("characters")}
        if "hotbar" not in cols:
            op.add_column(
                "characters",
                sa.Column("hotbar", sa.JSON(), nullable=True)
            )


def downgrade() -> None:
    op.drop_column("characters", "hotbar")
