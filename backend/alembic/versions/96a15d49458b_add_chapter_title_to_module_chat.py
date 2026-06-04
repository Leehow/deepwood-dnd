"""add_chapter_title_to_module_chat

Revision ID: 96a15d49458b
Revises: add_custom_modules_20260129
Create Date: 2026-01-30 17:42:18.501334

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '96a15d49458b'
down_revision: Union[str, None] = 'add_custom_modules_20260129'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'module_chat_messages',
        sa.Column('chapter_title', sa.String(300), nullable=True)
    )
    op.create_index(
        'ix_module_chat_messages_chapter_title',
        'module_chat_messages',
        ['chapter_title']
    )


def downgrade() -> None:
    op.drop_index('ix_module_chat_messages_chapter_title', table_name='module_chat_messages')
    op.drop_column('module_chat_messages', 'chapter_title')
