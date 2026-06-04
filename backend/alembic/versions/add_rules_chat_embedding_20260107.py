"""add rules chat and embedding tables

Revision ID: add_rules_chat_embedding
Revises:
Create Date: 2026-01-07

"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector


# revision identifiers
revision = 'add_rules_chat_embedding'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable pgvector extension (if not already enabled)
    op.execute('CREATE EXTENSION IF NOT EXISTS vector')

    # Create rules_chat_messages table
    op.create_table(
        'rules_chat_messages',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('campaign_id', sa.Integer(), sa.ForeignKey('campaigns.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', sa.String(50), nullable=False, index=True),
        sa.Column('role', sa.String(20), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Create composite index for chat history queries
    op.create_index(
        'ix_rules_chat_campaign_user_created',
        'rules_chat_messages',
        ['campaign_id', 'user_id', 'created_at']
    )

    # Create rules_embeddings table with pgvector
    op.create_table(
        'rules_embeddings',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('source', sa.String(100), nullable=False, index=True),
        sa.Column('page_number', sa.Integer(), nullable=True),
        sa.Column('chunk_index', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('embedding', Vector(1536), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Create index for source lookups
    op.create_index(
        'ix_rules_embeddings_source',
        'rules_embeddings',
        ['source']
    )

    # Create vector similarity search index (IVFFlat for faster approximate search)
    # This helps with performance on larger datasets
    op.execute('''
        CREATE INDEX IF NOT EXISTS ix_rules_embeddings_vector
        ON rules_embeddings
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    ''')


def downgrade() -> None:
    op.drop_index('ix_rules_embeddings_vector', table_name='rules_embeddings')
    op.drop_index('ix_rules_embeddings_source', table_name='rules_embeddings')
    op.drop_table('rules_embeddings')

    op.drop_index('ix_rules_chat_campaign_user_created', table_name='rules_chat_messages')
    op.drop_table('rules_chat_messages')
