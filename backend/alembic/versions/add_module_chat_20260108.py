"""add_module_chat_messages

Revision ID: add_module_chat_20260108
Revises: add_magic_item_fields_20260108
Create Date: 2026-01-08 22:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'add_module_chat_20260108'
down_revision: Union[str, None] = 'add_magic_item_fields_20260108'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create module_chat_messages table
    op.create_table(
        'module_chat_messages',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('module_id', sa.String(length=100), nullable=False),
        sa.Column('user_id', sa.String(length=50), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_module_chat_messages_id', 'module_chat_messages', ['id'], unique=False)
    op.create_index('ix_module_chat_messages_module_id', 'module_chat_messages', ['module_id'], unique=False)
    op.create_index('ix_module_chat_messages_user_id', 'module_chat_messages', ['user_id'], unique=False)
    op.create_index('ix_module_chat_module_user_created', 'module_chat_messages', ['module_id', 'user_id', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_module_chat_module_user_created', table_name='module_chat_messages')
    op.drop_index('ix_module_chat_messages_user_id', table_name='module_chat_messages')
    op.drop_index('ix_module_chat_messages_module_id', table_name='module_chat_messages')
    op.drop_index('ix_module_chat_messages_id', table_name='module_chat_messages')
    op.drop_table('module_chat_messages')
