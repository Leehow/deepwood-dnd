"""Add campaign_chat_messages table

Revision ID: campaign_chat_messages
Revises: module_maps_table
Create Date: 2025-11-07 14:00:00

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'campaign_chat_messages'
down_revision = 'module_maps_table'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'campaign_chat_messages',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('campaign_id', sa.Integer(), nullable=False, index=True),
        sa.Column('sender_user_id', sa.String(length=50), nullable=False, index=True),
        sa.Column('sender_role', sa.String(length=20), nullable=False),
        sa.Column('sender_character_id', sa.Integer(), nullable=True, index=True),
        sa.Column('message_type', sa.String(length=20), nullable=False, server_default='chat'),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('recipients', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('is_private', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('mentions', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('meta', sa.JSON(), nullable=True),
        sa.Column('reply_to_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True, server_default=sa.text('NOW()')),
        sa.PrimaryKeyConstraint('id')
    )

    op.create_index('ix_chat_campaign_created_at', 'campaign_chat_messages', ['campaign_id', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_chat_campaign_created_at', table_name='campaign_chat_messages')
    op.drop_table('campaign_chat_messages')

