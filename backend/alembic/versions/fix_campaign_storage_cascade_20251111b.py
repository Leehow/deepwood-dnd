"""ensure ON DELETE CASCADE for campaign_storage.campaign_id FK

Revision ID: fix_campaign_storage_cascade_20251111b
Revises: cascade_campaign_fk_20251111
Create Date: 2025-11-11 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "fix_campaign_storage_cascade_20251111b"
down_revision = "cascade_campaign_fk_20251111"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotently ensure campaign_storage.campaign_id -> campaigns(id) has ON DELETE CASCADE
    op.execute(
        """
        DO $$
        DECLARE
            fk_name text;
            del_rule text;
        BEGIN
            SELECT rc.constraint_name, rc.delete_rule
            INTO fk_name, del_rule
            FROM information_schema.referential_constraints rc
            JOIN information_schema.table_constraints tc
              ON tc.constraint_name = rc.constraint_name
            JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_name = rc.constraint_name
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = rc.unique_constraint_name
            WHERE tc.table_name = 'campaign_storage'
              AND tc.constraint_type = 'FOREIGN KEY'
              AND kcu.table_name = 'campaign_storage'
              AND kcu.column_name = 'campaign_id'
              AND ccu.table_name = 'campaigns'
              AND ccu.column_name = 'id'
            LIMIT 1;

            IF fk_name IS NULL THEN
                -- No FK found, create with CASCADE
                EXECUTE 'ALTER TABLE campaign_storage
                         ADD CONSTRAINT fk_campaign_storage_campaigns_cascade
                         FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE';
            ELSIF del_rule IS DISTINCT FROM 'CASCADE' THEN
                -- Found FK but not CASCADE: replace it with CASCADE
                EXECUTE format('ALTER TABLE campaign_storage DROP CONSTRAINT %I', fk_name);
                EXECUTE 'ALTER TABLE campaign_storage
                         ADD CONSTRAINT fk_campaign_storage_campaigns_cascade
                         FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE';
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Revert to a non-CASCADE FK (NO ACTION) if our named constraint exists; otherwise best-effort
    op.execute(
        """
        DO $$
        DECLARE
            fk_name text;
            del_rule text;
        BEGIN
            SELECT rc.constraint_name, rc.delete_rule
            INTO fk_name, del_rule
            FROM information_schema.referential_constraints rc
            JOIN information_schema.table_constraints tc
              ON tc.constraint_name = rc.constraint_name
            JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_name = rc.constraint_name
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = rc.unique_constraint_name
            WHERE tc.table_name = 'campaign_storage'
              AND tc.constraint_type = 'FOREIGN KEY'
              AND kcu.table_name = 'campaign_storage'
              AND kcu.column_name = 'campaign_id'
              AND ccu.table_name = 'campaigns'
              AND ccu.column_name = 'id'
            LIMIT 1;

            IF fk_name IS NOT NULL AND del_rule = 'CASCADE' THEN
                EXECUTE format('ALTER TABLE campaign_storage DROP CONSTRAINT %I', fk_name);
                EXECUTE 'ALTER TABLE campaign_storage
                         ADD CONSTRAINT fk_campaign_storage_campaigns_no_action
                         FOREIGN KEY (campaign_id) REFERENCES campaigns(id)';
            END IF;
        END $$;
        """
    )

