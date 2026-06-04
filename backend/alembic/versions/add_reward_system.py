"""Add XP and reward system

Revision ID: add_reward_system
Revises: add_multiclass_support
Create Date: 2025-01-14 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_reward_system'
down_revision = 'add_multiclass_support'
branch_labels = None
depends_on = None


def upgrade():
    # Add experience_points to characters table (if not exists)
    # Check if column exists first
    from sqlalchemy import inspect
    from app.db.session import engine

    # Add experience_points field if it doesn't exist
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='characters' AND column_name='experience_points'
            ) THEN
                ALTER TABLE characters ADD COLUMN experience_points INTEGER DEFAULT 0 NOT NULL;
            END IF;
        END $$;
    """)

    # Add milestone_level field if it doesn't exist
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='characters' AND column_name='milestone_level'
            ) THEN
                ALTER TABLE characters ADD COLUMN milestone_level INTEGER;
            END IF;
        END $$;
    """)

    # Create reward_history table
    op.create_table('reward_history',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('character_id', sa.Integer(), nullable=False),
        sa.Column('campaign_id', sa.Integer(), nullable=False),
        sa.Column('reward_type', sa.String(length=20), nullable=False),

        # XP fields
        sa.Column('xp_amount', sa.Integer(), nullable=True),
        sa.Column('xp_source', sa.String(length=100), nullable=True),

        # Currency fields
        sa.Column('currency_changes', sa.JSON(), nullable=True),
        sa.Column('currency_source', sa.String(length=100), nullable=True),

        # Common fields
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_private', sa.Boolean(), default=False, nullable=False),
        sa.Column('awarded_by', sa.String(length=50), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),

        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['character_id'], ['characters.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['campaign_id'], ['campaigns.id'], ondelete='CASCADE')
    )

    # Create indexes
    op.create_index('idx_reward_character', 'reward_history', ['character_id'])
    op.create_index('idx_reward_campaign', 'reward_history', ['campaign_id'])
    op.create_index('idx_reward_type', 'reward_history', ['reward_type'])
    op.create_index('idx_reward_created', 'reward_history', ['created_at'])


def downgrade():
    # Drop indexes
    op.drop_index('idx_reward_created', 'reward_history')
    op.drop_index('idx_reward_type', 'reward_history')
    op.drop_index('idx_reward_campaign', 'reward_history')
    op.drop_index('idx_reward_character', 'reward_history')

    # Drop table
    op.drop_table('reward_history')

    # Remove columns from characters (optional, comment out if you want to keep)
    # op.drop_column('characters', 'milestone_level')
    # op.drop_column('characters', 'experience_points')
