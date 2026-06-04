"""add unique constraint to campaign_members

Revision ID: 7a8b9c0d1e2f
Revises: 5d792d070ea0
Create Date: 2026-01-22

This migration adds a unique constraint on (campaign_id, user_id) to prevent
duplicate campaign member records caused by race conditions in concurrent requests.
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '7a8b9c0d1e2f'
down_revision = '5d792d070ea0'
branch_labels = None
depends_on = None


def upgrade():
    # First, remove any duplicate records (keep the one with lowest id)
    # This is necessary to add the unique constraint
    op.execute("""
        DELETE FROM campaign_members cm1
        USING campaign_members cm2
        WHERE cm1.campaign_id = cm2.campaign_id
          AND cm1.user_id = cm2.user_id
          AND cm1.id > cm2.id
    """)

    # Add unique constraint on (campaign_id, user_id)
    # A user can only be in a campaign once
    op.create_unique_constraint(
        'uq_campaign_members_campaign_user',
        'campaign_members',
        ['campaign_id', 'user_id']
    )


def downgrade():
    op.drop_constraint('uq_campaign_members_campaign_user', 'campaign_members', type_='unique')
