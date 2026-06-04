"""Add EMBEDDING and RERANK model types

Revision ID: add_embedding_rerank_models_20251120
Revises: add_reward_system
Create Date: 2025-11-20 12:50:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_embedding_rerank_models_20251120'
down_revision = 'add_reward_system'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add EMBEDDING and RERANK to the ModelType enum
    # Split into separate statements for asyncpg compatibility
    op.execute("ALTER TYPE modeltype ADD VALUE IF NOT EXISTS 'EMBEDDING'")
    op.execute("ALTER TYPE modeltype ADD VALUE IF NOT EXISTS 'RERANK'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values
    # This would require recreating the enum type
    pass
