"""add_stt_model_type

Revision ID: bc19d34f7c98
Revises: 9db373c951bd
Create Date: 2026-01-21 14:24:26.199889

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bc19d34f7c98'
down_revision: Union[str, None] = '9db373c951bd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add STT to the modeltype enum
    op.execute("ALTER TYPE modeltype ADD VALUE IF NOT EXISTS 'STT'")


def downgrade() -> None:
    # Note: PostgreSQL doesn't support removing enum values easily
    # This would require recreating the type
    pass
