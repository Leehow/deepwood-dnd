"""Add custom fields to items (is_custom, avatar_url, has_avatar)

Revision ID: items_custom_fields_20251109
Revises: shops_discount_rate_20251109
Create Date: 2025-11-09

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "items_custom_fields_20251109"
down_revision = "shops_discount_rate_20251109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("items"):
        cols = {c["name"] for c in inspector.get_columns("items")}
        if "is_custom" not in cols:
            op.add_column("items", sa.Column("is_custom", sa.Boolean(), nullable=False, server_default=sa.text("false")))
        if "avatar_url" not in cols:
            op.add_column("items", sa.Column("avatar_url", sa.Text(), nullable=True))
        if "has_avatar" not in cols:
            op.add_column("items", sa.Column("has_avatar", sa.Boolean(), nullable=False, server_default=sa.text("false")))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("items"):
        cols = {c["name"] for c in inspector.get_columns("items")}
        if "has_avatar" in cols:
            op.drop_column("items", "has_avatar")
        if "avatar_url" in cols:
            op.drop_column("items", "avatar_url")
        if "is_custom" in cols:
            op.drop_column("items", "is_custom")

