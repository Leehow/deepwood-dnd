"""Add current_hp column to characters

Revision ID: add_character_current_hp_20251114
Revises: add_multiclass_support
Create Date: 2025-11-14 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "add_character_current_hp_20251114"
down_revision = "add_multiclass_support"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add current_hp column to characters table."""
    op.add_column("characters", sa.Column("current_hp", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Remove current_hp column from characters table."""
    op.drop_column("characters", "current_hp")

