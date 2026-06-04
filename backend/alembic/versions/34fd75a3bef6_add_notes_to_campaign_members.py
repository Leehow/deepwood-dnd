"""add_notes_to_campaign_members

Revision ID: 34fd75a3bef6
Revises: d514aebb11ab
Create Date: 2026-01-04 23:17:58.072580

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '34fd75a3bef6'
down_revision: Union[str, None] = 'd514aebb11ab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add notes column to campaign_members table
    op.add_column('campaign_members', sa.Column('notes', postgresql.JSONB(), nullable=False, server_default='{}'))


def downgrade() -> None:
    # Remove notes column from campaign_members table
    op.drop_column('campaign_members', 'notes')
