"""add module_embeddings table

Revision ID: add_module_embeddings_20260124
Revises:
Create Date: 2026-01-24

"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision = 'add_module_embeddings_20260124'
down_revision = '45911e0bbf0e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'module_embeddings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('module_id', sa.String(100), nullable=False),
        sa.Column('chapter_title', sa.String(500), nullable=True),
        sa.Column('chapter_path', sa.String(1000), nullable=True),
        sa.Column('chunk_index', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('embedding', Vector(4096), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_module_embeddings_id', 'module_embeddings', ['id'])
    op.create_index('ix_module_embeddings_module_id', 'module_embeddings', ['module_id'])


def downgrade() -> None:
    op.drop_index('ix_module_embeddings_module_id', table_name='module_embeddings')
    op.drop_index('ix_module_embeddings_id', table_name='module_embeddings')
    op.drop_table('module_embeddings')
