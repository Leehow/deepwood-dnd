"""add controller_character_id and control_type to monster_instances

Revision ID: add_companion_fields_20260225
Revises: 06b83c220c2c
Create Date: 2026-02-25

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = 'add_companion_fields_20260225'
down_revision = '06b83c220c2c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [c['name'] for c in inspector.get_columns('monster_instances')]

    if 'controller_character_id' not in columns:
        op.add_column('monster_instances', sa.Column(
            'controller_character_id', sa.Integer(),
            sa.ForeignKey('characters.id', ondelete='SET NULL'),
            nullable=True
        ))
        op.create_index('ix_mi_controller', 'monster_instances', ['controller_character_id'])

    if 'control_type' not in columns:
        op.add_column('monster_instances', sa.Column(
            'control_type', sa.String(20), nullable=True
        ))


def downgrade() -> None:
    op.drop_index('ix_mi_controller', table_name='monster_instances')
    op.drop_column('monster_instances', 'control_type')
    op.drop_column('monster_instances', 'controller_character_id')
