"""Add inventory/currency to monster_instances and loot_bag_data to tokens

Revision ID: add_monster_inventory_lootbag
Revises: 6b1683639c9a
Create Date: 2026-01-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "add_monster_inventory_lootbag"
down_revision = "6b1683639c9a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # Add inventory and currency to monster_instances
    if inspector.has_table("monster_instances"):
        cols = [c["name"] for c in inspector.get_columns("monster_instances")]
        if "inventory" not in cols:
            op.add_column("monster_instances",
                sa.Column("inventory", sa.JSON(), nullable=True, server_default='[]'))
        if "currency" not in cols:
            op.add_column("monster_instances",
                sa.Column("currency", sa.JSON(), nullable=True,
                         server_default='{"cp":0,"sp":0,"ep":0,"gp":0,"pp":0}'))

    # Add loot_bag_data to tokens
    if inspector.has_table("tokens"):
        cols = [c["name"] for c in inspector.get_columns("tokens")]
        if "loot_bag_data" not in cols:
            op.add_column("tokens",
                sa.Column("loot_bag_data", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("monster_instances"):
        cols = [c["name"] for c in inspector.get_columns("monster_instances")]
        if "inventory" in cols:
            op.drop_column("monster_instances", "inventory")
        if "currency" in cols:
            op.drop_column("monster_instances", "currency")

    if inspector.has_table("tokens"):
        cols = [c["name"] for c in inspector.get_columns("tokens")]
        if "loot_bag_data" in cols:
            op.drop_column("tokens", "loot_bag_data")
