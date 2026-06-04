"""add headings_inferred to raw_module_files

Revision ID: 6045cbc1bc88
Revises: 4f6b8c9d0e1f
Create Date: 2026-04-02 16:02:34.519437

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6045cbc1bc88'
down_revision: Union[str, None] = '4f6b8c9d0e1f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'raw_module_files',
        sa.Column('headings_inferred', sa.Boolean(), nullable=True, server_default='false'),
    )


def downgrade() -> None:
    op.drop_column('raw_module_files', 'headings_inferred')
