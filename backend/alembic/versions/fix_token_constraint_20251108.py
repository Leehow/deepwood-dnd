"""Fix token type constraint to allow item tokens

Revision ID: fix_token_constraint_20251108
Revises: add_item_token_support
Create Date: 2025-11-08

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'fix_token_constraint_20251108'
down_revision = 'add_item_token_support'
branch_labels = None
depends_on = None


def upgrade():
    # Drop the old constraint that only allowed character OR monster tokens
    op.drop_constraint('check_token_type', 'tokens', type_='check')
    
    # Add new constraint that allows character, monster, OR item tokens
    # A token must be exactly one of:
    # 1. Character token: character_id NOT NULL, monster_instance_id NULL
    # 2. Monster token: character_id NULL, monster_instance_id NOT NULL
    # 3. Item token: character_id NULL, monster_instance_id NULL, item_data NOT NULL
    op.create_check_constraint(
        'check_token_type',
        'tokens',
        """
        (
            (character_id IS NOT NULL AND monster_instance_id IS NULL)
            OR (character_id IS NULL AND monster_instance_id IS NOT NULL)
            OR (character_id IS NULL AND monster_instance_id IS NULL AND item_data IS NOT NULL)
        )
        """
    )


def downgrade():
    # Drop the new constraint
    op.drop_constraint('check_token_type', 'tokens', type_='check')
    
    # Restore the old constraint (only character OR monster)
    op.create_check_constraint(
        'check_token_type',
        'tokens',
        """
        (
            (character_id IS NOT NULL AND monster_instance_id IS NULL)
            OR (character_id IS NULL AND monster_instance_id IS NOT NULL)
        )
        """
    )

