"""add_ai_chat_sessions

Revision ID: e2fbf7a0a544
Revises: 5a2683fbf3c1
Create Date: 2026-03-11 13:11:53.160077

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e2fbf7a0a544'
down_revision: Union[str, None] = '5a2683fbf3c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create ai_chat_sessions table
    op.create_table(
        'ai_chat_sessions',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('campaign_id', sa.Integer(), sa.ForeignKey('campaigns.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(50), nullable=False),
        sa.Column('title', sa.String(100), nullable=False, server_default='新会话'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.create_index('ix_ai_chat_sessions_id', 'ai_chat_sessions', ['id'])
    op.create_index('ix_ai_session_campaign_user', 'ai_chat_sessions', ['campaign_id', 'user_id'])

    # Add ai_session_id column to campaign_chat_messages
    op.add_column(
        'campaign_chat_messages',
        sa.Column('ai_session_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_chat_message_ai_session',
        'campaign_chat_messages',
        'ai_chat_sessions',
        ['ai_session_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_chat_message_ai_session', 'campaign_chat_messages', type_='foreignkey')
    op.drop_column('campaign_chat_messages', 'ai_session_id')
    op.drop_index('ix_ai_session_campaign_user', table_name='ai_chat_sessions')
    op.drop_index('ix_ai_chat_sessions_id', table_name='ai_chat_sessions')
    op.drop_table('ai_chat_sessions')
