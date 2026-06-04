"""remove dice_requests and dice_rolls tables

Revision ID: 29a96a4817f5
Revises: 0b3651cc6968
Create Date: 2026-01-12 00:15:11.844681

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '29a96a4817f5'
down_revision: Union[str, None] = '0b3651cc6968'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop dice_rolls table first (it has FK to dice_requests)
    op.drop_table('dice_rolls')
    # Then drop dice_requests table
    op.drop_table('dice_requests')


def downgrade() -> None:
    # Recreate dice_requests table
    op.create_table(
        'dice_requests',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('request_id', sa.String(36), nullable=False),
        sa.Column('campaign_id', sa.Integer(), nullable=False),
        sa.Column('issuer_user_id', sa.String(255), nullable=False),
        sa.Column('issuer_role', sa.String(20), nullable=False),
        sa.Column('recipients', sa.JSON(), nullable=True),
        sa.Column('is_private', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('check', sa.JSON(), nullable=True),
        sa.Column('original_message', sa.Text(), nullable=True),
        sa.Column('is_completed', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('completed_by', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('request_id')
    )
    op.create_index('ix_dice_requests_campaign_id', 'dice_requests', ['campaign_id'])
    op.create_index('ix_dice_requests_request_id', 'dice_requests', ['request_id'])

    # Recreate dice_rolls table
    op.create_table(
        'dice_rolls',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('roll_id', sa.String(36), nullable=False),
        sa.Column('campaign_id', sa.Integer(), nullable=False),
        sa.Column('request_id', sa.String(36), nullable=True),
        sa.Column('roller_user_id', sa.String(255), nullable=False),
        sa.Column('roller_role', sa.String(20), nullable=False),
        sa.Column('is_private', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('visible_to', sa.JSON(), nullable=True),
        sa.Column('roll', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('roll_id')
    )
    op.create_index('ix_dice_rolls_campaign_id', 'dice_rolls', ['campaign_id'])
    op.create_index('ix_dice_rolls_request_id', 'dice_rolls', ['request_id'])
    op.create_index('ix_dice_rolls_roll_id', 'dice_rolls', ['roll_id'])
