"""Add chests and chest_inventory tables, add chest_id to tokens

Revision ID: add_chests_20260123
Revises: 7a8b9c0d1e2f
Create Date: 2026-01-23

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "add_chests_20260123"
down_revision = "7a8b9c0d1e2f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # 1) Create chests table
    if not inspector.has_table("chests"):
        op.create_table(
            "chests",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True),
            # Basic info
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("appearance_description", sa.Text(), nullable=True),
            # State
            sa.Column("state", sa.String(length=20), nullable=False, server_default="locked"),
            # Lock properties
            sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("lock_dc", sa.Integer(), nullable=False, server_default="15"),
            sa.Column("requires_key", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("key_name", sa.String(length=100), nullable=True),
            # Trap properties
            sa.Column("is_trapped", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("trap_detected", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("trap_disarmed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("trap_triggered", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("trap_type", sa.String(length=50), nullable=True),
            sa.Column("trap_detection_dc", sa.Integer(), nullable=False, server_default="15"),
            sa.Column("trap_disarm_dc", sa.Integer(), nullable=False, server_default="15"),
            sa.Column("trap_effect", sa.JSON(), nullable=True),
            # Currency
            sa.Column("cp", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("sp", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("ep", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("gp", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("pp", sa.Integer(), nullable=False, server_default="0"),
            # Avatar
            sa.Column("avatar_url", sa.Text(), nullable=True),
            sa.Column("avatar_url_large", sa.Text(), nullable=True),
            sa.Column("has_avatar", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            # Timestamps
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )

    # 2) Create chest_inventory table
    if not inspector.has_table("chest_inventory"):
        op.create_table(
            "chest_inventory",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("chest_id", sa.Integer(), sa.ForeignKey("chests.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("items.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )

    # 3) Add chest_id to tokens table
    if inspector.has_table("tokens"):
        cols = [c["name"] for c in inspector.get_columns("tokens")]
        if "chest_id" not in cols:
            op.add_column("tokens", sa.Column("chest_id", sa.Integer(), nullable=True, index=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # Remove chest_id from tokens
    if inspector.has_table("tokens"):
        cols = [c["name"] for c in inspector.get_columns("tokens")]
        if "chest_id" in cols:
            op.drop_column("tokens", "chest_id")

    # Drop chest_inventory table
    if inspector.has_table("chest_inventory"):
        op.drop_table("chest_inventory")

    # Drop chests table
    if inspector.has_table("chests"):
        op.drop_table("chests")
