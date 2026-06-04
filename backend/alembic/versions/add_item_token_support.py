"""Add item token support to tokens table

Revision ID: add_item_token_support
Revises: dice_private_and_rolls
Create Date: 2025-01-08

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_item_token_support'
down_revision = 'dice_private_and_rolls'
branch_labels = None
depends_on = None


def upgrade():
    # Add new columns for item token support
    op.add_column('tokens', sa.Column('item_data', postgresql.JSON(astext_type=sa.Text()), nullable=True))
    op.add_column('tokens', sa.Column('item_quantity', sa.Integer(), nullable=True))


def downgrade():
    # Remove item token columns
    op.drop_column('tokens', 'item_quantity')
    op.drop_column('tokens', 'item_data')

