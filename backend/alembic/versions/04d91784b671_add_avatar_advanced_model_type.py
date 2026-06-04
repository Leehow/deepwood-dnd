"""add_avatar_advanced_model_type

Revision ID: 04d91784b671
Revises: 29a96a4817f5
Create Date: 2026-01-12 02:30:54.137782

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '04d91784b671'
down_revision: Union[str, None] = '29a96a4817f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add AVATAR_ADVANCED to the modeltype enum
    op.execute("ALTER TYPE modeltype ADD VALUE IF NOT EXISTS 'AVATAR_ADVANCED'")


def downgrade() -> None:
    # PostgreSQL doesn't support removing enum values directly
    # Would need to recreate the enum type which is complex
    # Leaving as no-op since removing enum values is rarely needed
    pass
