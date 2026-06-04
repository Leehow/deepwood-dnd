"""add resterlab_user_id column to users table

Revision ID: add_resterlab_user_id_20260223
Revises: 7519b0af82eb
Create Date: 2026-02-23

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'add_resterlab_user_id_20260223'
down_revision = '7519b0af82eb'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS resterlab_user_id VARCHAR(50) UNIQUE;
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_users_resterlab_user_id
        ON users (resterlab_user_id);
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_resterlab_user_id;")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS resterlab_user_id;")
