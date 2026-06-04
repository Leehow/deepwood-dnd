"""merge feat_choices and character_drafts

Revision ID: d401cc65913a
Revises: feat_choices_001
Create Date: 2026-02-27 16:21:59.462034

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd401cc65913a'
down_revision: Union[str, None] = 'feat_choices_001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
