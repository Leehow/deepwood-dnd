"""Add module_maps table

Revision ID: module_maps_table
Revises:
Create Date: 2025-11-06 13:30:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'module_maps_table'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create module_maps table
    op.create_table(
        'module_maps',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('campaign_id', sa.String(length=255), nullable=False, index=True),
        sa.Column('module_id', sa.String(length=255), nullable=False, index=True),
        sa.Column('maps', postgresql.JSON(astext_type=sa.Text()), nullable=False, default=list),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # Create composite index
    op.create_index('ix_campaign_module', 'module_maps', ['campaign_id', 'module_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_campaign_module', table_name='module_maps')
    op.drop_table('module_maps')
