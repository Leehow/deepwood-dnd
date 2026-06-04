"""add fog_of_war table

Revision ID: add_fog_of_war
Revises: add_campaign_storage
Create Date: 2025-11-07 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_fog_of_war'
down_revision = 'add_campaign_storage'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create fog_of_war table
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS fog_of_war (
            id SERIAL PRIMARY KEY,
            campaign_id VARCHAR(255) NOT NULL,
            map_url VARCHAR(1024) NOT NULL,
            cells JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        """
    )

    # Create composite index for efficient lookups
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_campaign_map
        ON fog_of_war (campaign_id, map_url);
        """
    )

    # Create individual indexes
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_fog_of_war_campaign_id
        ON fog_of_war (campaign_id);
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_fog_of_war_id
        ON fog_of_war (id);
        """
    )


def downgrade() -> None:
    # Drop indexes
    op.execute("DROP INDEX IF EXISTS ix_fog_of_war_id;")
    op.execute("DROP INDEX IF EXISTS ix_fog_of_war_campaign_id;")
    op.execute("DROP INDEX IF EXISTS ix_campaign_map;")

    # Drop table
    op.execute("DROP TABLE IF EXISTS fog_of_war;")
