"""add_medium_model_type

Revision ID: f4121243809e
Revises: afb7c2319273
Create Date: 2026-01-19 14:50:51.970546

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4121243809e'
down_revision: Union[str, None] = 'afb7c2319273'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add MEDIUM value to the modeltype enum
    # PostgreSQL requires ALTER TYPE to add new enum values
    op.execute("ALTER TYPE modeltype ADD VALUE IF NOT EXISTS 'MEDIUM' AFTER 'FAST'")


def downgrade() -> None:
    # Note: PostgreSQL doesn't support removing enum values directly
    # This is a no-op for downgrade as removing enum values requires recreating the type
    pass
