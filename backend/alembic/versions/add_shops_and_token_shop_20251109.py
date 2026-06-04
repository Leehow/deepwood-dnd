"""Add shops and shop_inventory tables, add shop_id to tokens

Revision ID: shops_and_shopinv_20251109
Revises: add_character_currency_20251109
Create Date: 2025-11-09

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "shops_and_shopinv_20251109"
down_revision = "add_character_currency_20251109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # 1) Create shops table
    if not inspector.has_table("shops"):
        op.create_table(
            "shops",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("campaign_id", sa.Integer(), nullable=False, index=True),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("appearance_description", sa.Text(), nullable=True),
            sa.Column("gold_gp", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("accepts_selling", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("avatar_url", sa.Text(), nullable=True),
            sa.Column("has_avatar", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_shops_campaign_id", "shops", ["campaign_id"])  # safety

    # 2) Create shop_inventory table
    if not inspector.has_table("shop_inventory"):
        op.create_table(
            "shop_inventory",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("shop_id", sa.Integer(), nullable=False, index=True),
            sa.Column("item_id", sa.Integer(), nullable=False, index=True),
            sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("price_gp", sa.Float(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_shop_inventory_shop_id", "shop_inventory", ["shop_id"])  # safety
        op.create_index("ix_shop_inventory_item_id", "shop_inventory", ["item_id"])  # safety

    # 3) Add shop_id to tokens
    if inspector.has_table("tokens"):
        cols = [c["name"] for c in inspector.get_columns("tokens")]
        if "shop_id" not in cols:
            op.add_column("tokens", sa.Column("shop_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("tokens"):
        cols = [c["name"] for c in inspector.get_columns("tokens")]
        if "shop_id" in cols:
            op.drop_column("tokens", "shop_id")

    if inspector.has_table("shop_inventory"):
        op.drop_index("ix_shop_inventory_item_id", table_name="shop_inventory")
        op.drop_index("ix_shop_inventory_shop_id", table_name="shop_inventory")
        op.drop_table("shop_inventory")

    if inspector.has_table("shops"):
        op.drop_index("ix_shops_campaign_id", table_name="shops")
        op.drop_table("shops")

