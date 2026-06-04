"""add status_effects JSONB column to characters

Revision ID: add_status_effects_20260223
Revises: update_embedding_dim_1024
Create Date: 2026-02-23

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = 'add_status_effects_20260223'
down_revision = 'add_resterlab_user_id_20260223'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("characters"):
        cols = {c["name"] for c in inspector.get_columns("characters")}
        if "status_effects" not in cols:
            op.add_column(
                "characters",
                sa.Column("status_effects", sa.JSON(), nullable=True)
            )


def downgrade() -> None:
    op.drop_column("characters", "status_effects")
