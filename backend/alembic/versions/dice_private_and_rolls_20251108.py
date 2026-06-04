"""Add is_private to dice_requests and create dice_rolls table

Revision ID: dice_private_and_rolls
Revises: add_chat_edit_delete_fields
Create Date: 2025-11-08 10:30:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "dice_private_and_rolls"
down_revision = "add_chat_edit_delete_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # 1) Add is_private to dice_requests if missing
    if inspector.has_table("dice_requests"):
        cols = [c["name"] for c in inspector.get_columns("dice_requests")]
        if "is_private" not in cols:
            op.add_column(
                "dice_requests",
                sa.Column("is_private", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            )
    else:
        # Create dice_requests if it doesn't exist (idempotent fallback)
        op.create_table(
            "dice_requests",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("request_id", sa.String(length=100), nullable=False, unique=True, index=True),
            sa.Column("campaign_id", sa.Integer(), nullable=False, index=True),
            sa.Column("issuer_user_id", sa.String(length=50), nullable=False),
            sa.Column("issuer_role", sa.String(length=20), nullable=False),
            sa.Column("recipients", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("is_private", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("check", sa.JSON(), nullable=False),
            sa.Column("original_message", sa.String(length=1000), nullable=True),
            sa.Column("is_completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("completed_by", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("NOW()")),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_dice_requests_request_id", "dice_requests", ["request_id"])  # safety
        op.create_index("ix_dice_requests_campaign_id", "dice_requests", ["campaign_id"])  # safety
        op.create_index(
            "ix_dice_request_campaign_created",
            "dice_requests",
            ["campaign_id", "created_at"],
            unique=False,
        )
        op.create_index(
            "ix_dice_request_campaign_completed",
            "dice_requests",
            ["campaign_id", "is_completed"],
            unique=False,
        )

    # 2) Create dice_rolls table if not exists
    if not inspector.has_table("dice_rolls"):
        op.create_table(
            "dice_rolls",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("roll_id", sa.String(length=100), nullable=False, unique=True, index=True),
            sa.Column("campaign_id", sa.Integer(), nullable=False, index=True),
            sa.Column("request_id", sa.String(length=100), nullable=True),
            sa.Column("roller_user_id", sa.String(length=50), nullable=False),
            sa.Column("roller_role", sa.String(length=20), nullable=False),
            sa.Column("is_private", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("visible_to", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("roll", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("NOW()")),
        )
        op.create_index("ix_dice_rolls_roll_id", "dice_rolls", ["roll_id"])  # safety
        op.create_index("ix_dice_rolls_campaign_id", "dice_rolls", ["campaign_id"])  # safety
        op.create_index(
            "ix_dice_roll_campaign_created",
            "dice_rolls",
            ["campaign_id", "created_at"],
            unique=False,
        )



def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # Drop dice_rolls
    if inspector.has_table("dice_rolls"):
        op.drop_index("ix_dice_roll_campaign_created", table_name="dice_rolls")
        op.drop_index("ix_dice_rolls_campaign_id", table_name="dice_rolls")
        op.drop_index("ix_dice_rolls_roll_id", table_name="dice_rolls")
        op.drop_table("dice_rolls")

    # Remove is_private from dice_requests if exists
    if inspector.has_table("dice_requests"):
        cols = [c["name"] for c in inspector.get_columns("dice_requests")]
        if "is_private" in cols:
            op.drop_column("dice_requests", "is_private")

