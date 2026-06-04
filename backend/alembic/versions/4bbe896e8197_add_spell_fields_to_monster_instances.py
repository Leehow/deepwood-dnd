"""add spell fields to monster_instances

Revision ID: 4bbe896e8197
Revises: 07aa5c816667
Create Date: 2026-03-10 12:41:11.826731

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '4bbe896e8197'
down_revision: Union[str, None] = '07aa5c816667'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('monster_instances', sa.Column('selected_spells', sa.JSON(), nullable=True))
    op.add_column('monster_instances', sa.Column('spell_slots', sa.JSON(), nullable=True))
    op.add_column('monster_instances', sa.Column('spell_slots_state', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('monster_instances', 'spell_slots_state')
    op.drop_column('monster_instances', 'spell_slots')
    op.drop_column('monster_instances', 'selected_spells')
