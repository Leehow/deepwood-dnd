"""add users table

Revision ID: add_users_table
Revises: add_campaigns_metadata_jsonb
Create Date: 2025-11-07 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_users_table'
down_revision = 'add_campaigns_metadata_jsonb'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create users table
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(50) PRIMARY KEY,
            username VARCHAR(100) NOT NULL,
            email VARCHAR(255) UNIQUE,
            role VARCHAR(20) NOT NULL DEFAULT 'regular',
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        );
        """
    )

    # Create indexes
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_users_id ON users (id);
        """
    )
    
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);
        """
    )

    # Insert default admin user (user_0)
    op.execute(
        """
        INSERT INTO users (id, username, email, role, is_active)
        VALUES ('0', 'Admin', 'admin@dnd.local', 'admin', true)
        ON CONFLICT (id) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS users CASCADE;")

