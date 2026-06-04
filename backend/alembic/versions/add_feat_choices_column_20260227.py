"""add feat_choices column

Revision ID: feat_choices_001
Revises:
Create Date: 2026-02-27
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = 'feat_choices_001'
down_revision = 'add_character_drafts_20260226'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('characters', sa.Column('feat_choices', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('characters', 'feat_choices')
