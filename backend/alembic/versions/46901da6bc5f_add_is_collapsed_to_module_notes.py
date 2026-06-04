"""add is_collapsed to module_notes

Revision ID: 46901da6bc5f
Revises: add_module_chat_20260108
Create Date: 2026-01-09 23:11:56.167046

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '46901da6bc5f'
down_revision: Union[str, None] = 'add_module_chat_20260108'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('module_notes', sa.Column('is_collapsed', sa.Boolean(), nullable=False, server_default='true'))


def downgrade() -> None:
    op.drop_column('module_notes', 'is_collapsed')
