"""add campaign_templates table

Revision ID: add_campaign_templates_20260222
Revises: add_user_avatars_20260221
Create Date: 2026-02-22

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import JSONB


revision = 'add_campaign_templates_20260222'
down_revision = 'add_user_avatars_20260221'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if not inspector.has_table("campaign_templates"):
        op.create_table(
            "campaign_templates",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("dm_user_id", sa.String(50), nullable=False, index=True),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("cover_image", sa.Text(), nullable=True),
            sa.Column("source_campaign_id", sa.Integer(), nullable=True),
            sa.Column("template_data", JSONB(), nullable=False),
            sa.Column("is_shared", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("shared_by_name", sa.String(100), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("campaign_templates"):
        op.drop_table("campaign_templates")
