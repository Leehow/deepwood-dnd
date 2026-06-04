"""add_tables_to_parsed_module

Revision ID: d514aebb11ab
Revises: 6f9902eef1bd
Create Date: 2026-01-03 18:45:34.464669

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd514aebb11ab'
down_revision: Union[str, None] = '6f9902eef1bd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add tables_count column
    op.add_column('parsed_modules', sa.Column('tables_count', sa.Integer(), nullable=True, server_default='0'))
    # Add tables JSONB column
    op.add_column('parsed_modules', sa.Column('tables', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('parsed_modules', 'tables')
    op.drop_column('parsed_modules', 'tables_count')
