"""add user avatar library table

Revision ID: add_user_avatars_20260221
Revises: update_embedding_dim_1024
Create Date: 2026-02-21

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = 'add_user_avatars_20260221'
down_revision = 'update_embedding_dim_1024'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'user_avatars',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.String(100), nullable=False),
        sa.Column('avatar_url', sa.Text(), nullable=False),
        sa.Column('avatar_url_large', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_user_avatars_user_id', 'user_avatars', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_user_avatars_user_id', table_name='user_avatars')
    op.drop_table('user_avatars')
