"""add character_drafts table

Revision ID: add_character_drafts_20260226
Revises: add_companion_fields_20260225
Create Date: 2026-02-26

"""
from alembic import op
import sqlalchemy as sa

revision = 'add_character_drafts_20260226'
down_revision = 'add_companion_fields_20260225'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'character_drafts',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.String(50), nullable=False, unique=True, index=True),
        sa.Column('current_step', sa.Integer(), server_default='1'),
        sa.Column('wizard_state', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('character_drafts')
