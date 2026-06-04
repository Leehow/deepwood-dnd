"""add_raw_module_files_table

Revision ID: cb9686fb8e76
Revises: de470725f477
Create Date: 2026-01-01 00:43:31.047092

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'cb9686fb8e76'
down_revision: Union[str, None] = 'de470725f477'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'raw_module_files',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('original_filename', sa.String(500), nullable=False),
        sa.Column('file_type', sa.String(50), nullable=False),
        sa.Column('file_size', sa.BigInteger(), nullable=False),
        sa.Column('status', sa.String(50), server_default='uploaded'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('markdown_content', sa.Text(), nullable=True),
        sa.Column('source_language', sa.String(10), nullable=True),
        sa.Column('is_translated', sa.String(10), server_default='no'),
        sa.Column('created_by', sa.String(100), nullable=False),
        sa.Column('parsed_module_id', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now()),
        sa.Column('converted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('parsed_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_raw_module_files_id', 'raw_module_files', ['id'])
    op.create_index('ix_raw_module_files_created_by', 'raw_module_files', ['created_by'])
    op.create_index('ix_raw_module_files_status', 'raw_module_files', ['status'])


def downgrade() -> None:
    op.drop_index('ix_raw_module_files_status', 'raw_module_files')
    op.drop_index('ix_raw_module_files_created_by', 'raw_module_files')
    op.drop_index('ix_raw_module_files_id', 'raw_module_files')
    op.drop_table('raw_module_files')
