"""update rules embeddings vector dimension to 4096

Revision ID: update_embedding_dim
Revises: add_rules_chat_embedding
Create Date: 2026-01-23

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = 'update_embedding_dim'
down_revision = 'add_chests_20260123'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop existing indexes that depend on the embedding column
    op.execute('DROP INDEX IF EXISTS ix_rules_embeddings_vector')

    # Alter the embedding column to use 4096 dimensions
    op.execute('ALTER TABLE rules_embeddings ALTER COLUMN embedding TYPE vector(4096)')

    # Note: pgvector indexes (IVFFlat, HNSW) have a 2000 dimension limit
    # For 4096 dimensions, we skip the index and use sequential scan
    # Performance is acceptable for smaller datasets (< 10k entries)


def downgrade() -> None:
    # Drop existing index
    op.execute('DROP INDEX IF EXISTS ix_rules_embeddings_vector')

    # Change back to 1536 dimensions
    op.execute('ALTER TABLE rules_embeddings ALTER COLUMN embedding TYPE vector(1536)')

    # Recreate index using IVFFlat (works for <= 2000 dims)
    op.execute('''
        CREATE INDEX IF NOT EXISTS ix_rules_embeddings_vector
        ON rules_embeddings
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    ''')
