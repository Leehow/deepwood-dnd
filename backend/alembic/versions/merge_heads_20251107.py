"""Merge heads to single lineage

Revision ID: merge_heads_20251107
Revises: add_campaign_storage_acl2, add_fog_of_war, add_users_table
Create Date: 2025-11-07 18:10:00

"""
from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401

# revision identifiers, used by Alembic.
revision = "merge_heads_20251107"
down_revision = ("add_campaign_storage_acl2", "add_fog_of_war", "add_users_table")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Merge migration; no-op.
    pass


def downgrade() -> None:
    # Cannot unmerge once merged; keep as no-op.
    pass

