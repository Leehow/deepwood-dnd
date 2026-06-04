"""Add discount_rate to shops

Revision ID: shops_discount_rate_20251109
Revises: shops_and_shopinv_20251109
Create Date: 2025-11-09

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "shops_discount_rate_20251109"
down_revision = "shops_and_shopinv_20251109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("shops"):
        cols = [c["name"] for c in inspector.get_columns("shops")]
        if "discount_rate" not in cols:
            op.add_column(
                "shops",
                sa.Column("discount_rate", sa.Float(), nullable=False, server_default="0.5"),
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("shops"):
        cols = [c["name"] for c in inspector.get_columns("shops")]
        if "discount_rate" in cols:
            op.drop_column("shops", "discount_rate")

