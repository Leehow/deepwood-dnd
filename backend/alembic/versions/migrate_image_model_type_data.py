"""migrate data from old image model types to new ones

Revision ID: c8f4d2b1e591
Revises: b7e3f1a2c490
Create Date: 2026-03-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8f4d2b1e591'
down_revision: Union[str, None] = 'b7e3f1a2c490'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Data was migrated via direct asyncpg connection (ADD VALUE + UPDATE).
    # This migration documents the change for alembic history tracking.
    # AVATAR -> FAST_IMAGE, AVATAR_ADVANCED -> MEDIUM_IMAGE, IMAGE -> ADVANCED_IMAGE
    pass


def downgrade() -> None:
    op.execute(sa.text(
        "UPDATE ai_model_configs SET model_type = 'AVATAR' "
        "WHERE model_type = 'FAST_IMAGE'"
    ))
    op.execute(sa.text(
        "UPDATE ai_model_configs SET model_type = 'AVATAR_ADVANCED' "
        "WHERE model_type = 'MEDIUM_IMAGE'"
    ))
    op.execute(sa.text(
        "UPDATE ai_model_configs SET model_type = 'IMAGE' "
        "WHERE model_type = 'ADVANCED_IMAGE'"
    ))
