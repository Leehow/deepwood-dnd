"""add_tool_calls_to_module_chat

Revision ID: 694b5e7ab9d2
Revises: 96a15d49458b
Create Date: 2026-02-01 13:38:44.144907

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '694b5e7ab9d2'
down_revision: Union[str, None] = '96a15d49458b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('module_chat_messages', sa.Column('tool_calls', postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('module_chat_messages', 'tool_calls')
