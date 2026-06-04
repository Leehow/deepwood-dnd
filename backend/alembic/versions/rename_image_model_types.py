"""rename AVATAR/AVATAR_ADVANCED/IMAGE to FAST_IMAGE/MEDIUM_IMAGE/ADVANCED_IMAGE

Revision ID: b7e3f1a2c490
Revises: a4d0bd2988b0
Create Date: 2026-03-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7e3f1a2c490'
down_revision: Union[str, None] = 'a4d0bd2988b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Note: ALTER TYPE ADD VALUE cannot run inside a transaction with asyncpg.
    # The enum values were added via direct asyncpg connection.
    # This migration documents the change for alembic history tracking.
    pass


def downgrade() -> None:
    pass
