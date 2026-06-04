"""add_ruler_type_column

Revision ID: a73e3f94fbef
Revises: 944ab818333d
Create Date: 2026-02-24 16:58:38.251053

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a73e3f94fbef'
down_revision: Union[str, None] = '944ab818333d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('rulers', sa.Column('ruler_type', sa.String(20), nullable=False, server_default='line'))


def downgrade() -> None:
    op.drop_column('rulers', 'ruler_type')
