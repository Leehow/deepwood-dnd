"""merge heads

Revision ID: d5d1917c662f
Revises: 34fd75a3bef6, add_rules_chat_embedding
Create Date: 2026-01-08 00:34:55.311077

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5d1917c662f'
down_revision: Union[str, None] = ('34fd75a3bef6', 'add_rules_chat_embedding')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
