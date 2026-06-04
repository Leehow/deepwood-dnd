"""add selected_character_id to campaign_members

Revision ID: add_selected_character
Revises: 
Create Date: 2025-11-02 23:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_selected_character'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent guards for column, FK, and index
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'campaign_members'
                AND column_name = 'selected_character_id'
            ) THEN
                ALTER TABLE campaign_members
                ADD COLUMN selected_character_id INTEGER;
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.table_constraints tc
                WHERE tc.constraint_name = 'fk_campaign_members_selected_character'
            ) THEN
                ALTER TABLE campaign_members
                ADD CONSTRAINT fk_campaign_members_selected_character
                FOREIGN KEY (selected_character_id)
                REFERENCES characters(id)
                ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'ix_campaign_members_selected_character_id'
            ) THEN
                CREATE INDEX ix_campaign_members_selected_character_id
                ON campaign_members(selected_character_id);
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Safe drops if exist
    op.execute("DROP INDEX IF EXISTS ix_campaign_members_selected_character_id;")
    op.execute("ALTER TABLE campaign_members DROP CONSTRAINT IF EXISTS fk_campaign_members_selected_character;")
    op.execute("ALTER TABLE campaign_members DROP COLUMN IF EXISTS selected_character_id;")

