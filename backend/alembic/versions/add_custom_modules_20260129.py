"""add custom_modules table

Revision ID: add_custom_modules_20260129
Revises: add_user_preferences_20260125
Create Date: 2026-01-29

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = 'add_custom_modules_20260129'
down_revision = 'add_user_preferences_20260125'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if not inspector.has_table("custom_modules"):
        op.create_table(
            "custom_modules",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("module_id", sa.String(length=100), nullable=False, unique=True, index=True),
            sa.Column("title", sa.String(length=500), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("template_id", sa.String(length=50), nullable=True),
            # JSONB content fields
            sa.Column("chapters", JSONB(), nullable=True, server_default="[]"),
            sa.Column("npcs", JSONB(), nullable=True, server_default="[]"),
            sa.Column("locations", JSONB(), nullable=True, server_default="[]"),
            sa.Column("encounters", JSONB(), nullable=True, server_default="[]"),
            sa.Column("treasures", JSONB(), nullable=True, server_default="[]"),
            # Metadata
            sa.Column("recommended_level_min", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("recommended_level_max", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("estimated_sessions", sa.String(length=20), nullable=True),
            # Permissions
            sa.Column("created_by", sa.String(length=100), nullable=False, index=True),
            sa.Column("is_shared", sa.Boolean(), nullable=False, server_default=sa.text("false"), index=True),
            # Timestamps
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("custom_modules"):
        op.drop_table("custom_modules")
