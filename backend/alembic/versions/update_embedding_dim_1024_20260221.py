"""update embedding dimension from 4096 to 1024 for dashscope text-embedding-v4

Revision ID: update_embedding_dim_1024
Revises: add_chat_sessions_20260202
Create Date: 2026-02-21

"""
from alembic import op


# revision identifiers
revision = 'update_embedding_dim_1024'
down_revision = 'add_chat_sessions_20260202'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Clear existing embeddings (incompatible dimensions)
    op.execute('DELETE FROM module_embeddings')
    op.execute('DELETE FROM rules_embeddings')

    # Change dimension from 4096 to 1024
    op.execute('ALTER TABLE module_embeddings ALTER COLUMN embedding TYPE vector(1024)')
    op.execute('ALTER TABLE rules_embeddings ALTER COLUMN embedding TYPE vector(1024)')

    # 1024 dims supports HNSW index for faster search
    op.execute('''
        CREATE INDEX IF NOT EXISTS ix_module_embeddings_vector
        ON module_embeddings
        USING hnsw (embedding vector_cosine_ops)
    ''')
    op.execute('''
        CREATE INDEX IF NOT EXISTS ix_rules_embeddings_vector
        ON rules_embeddings
        USING hnsw (embedding vector_cosine_ops)
    ''')


def downgrade() -> None:
    op.execute('DROP INDEX IF EXISTS ix_module_embeddings_vector')
    op.execute('DROP INDEX IF EXISTS ix_rules_embeddings_vector')

    op.execute('DELETE FROM module_embeddings')
    op.execute('DELETE FROM rules_embeddings')

    op.execute('ALTER TABLE module_embeddings ALTER COLUMN embedding TYPE vector(4096)')
    op.execute('ALTER TABLE rules_embeddings ALTER COLUMN embedding TYPE vector(4096)')
