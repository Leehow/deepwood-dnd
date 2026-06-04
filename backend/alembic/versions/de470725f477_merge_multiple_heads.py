"""merge_multiple_heads

Revision ID: de470725f477
Revises: add_embedding_rerank_models_20251120, optimization_001, unified_level_tracking_20251119
Create Date: 2026-01-01 00:43:10.700406

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'de470725f477'
down_revision: Union[str, None] = ('add_embedding_rerank_models_20251120', 'optimization_001', 'unified_level_tracking_20251119')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
