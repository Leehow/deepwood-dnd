"""add module_chat_sessions table and session_id column

Revision ID: add_chat_sessions_20260202
Revises: add_tts_20260202
Create Date: 2026-02-02
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_chat_sessions_20260202'
down_revision = 'add_map_anchor_20260202'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Create module_chat_sessions table (skip if already created by Base.metadata.create_all)
    table_exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.tables WHERE table_name='module_chat_sessions'"
    )).fetchone()
    if not table_exists:
        op.create_table(
            'module_chat_sessions',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('module_id', sa.String(100), nullable=False, index=True),
            sa.Column('user_id', sa.String(50), nullable=False, index=True),
            sa.Column('campaign_id', sa.Integer(), nullable=True, index=True),
            sa.Column('title', sa.String(200), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    # Create composite index if not exists
    idx_exists = conn.execute(sa.text(
        "SELECT 1 FROM pg_indexes WHERE indexname='ix_chat_session_module_user_campaign'"
    )).fetchone()
    if not idx_exists:
        op.create_index(
            'ix_chat_session_module_user_campaign',
            'module_chat_sessions',
            ['module_id', 'user_id', 'campaign_id'],
        )

    # Add session_id column to module_chat_messages (skip if already exists)
    col_exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns WHERE table_name='module_chat_messages' AND column_name='session_id'"
    )).fetchone()
    if not col_exists:
        op.add_column(
            'module_chat_messages',
            sa.Column('session_id', sa.Integer(), nullable=True, index=True),
        )

    # Backfill: create default sessions for existing module-level chats
    rows = conn.execute(sa.text(
        """
        SELECT DISTINCT module_id, user_id
        FROM module_chat_messages
        WHERE chapter_title IS NULL AND session_id IS NULL
        """
    )).fetchall()

    for row in rows:
        result = conn.execute(
            sa.text(
                """
                INSERT INTO module_chat_sessions (module_id, user_id, title, created_at, updated_at)
                VALUES (:module_id, :user_id, '默认对话', NOW(), NOW())
                RETURNING id
                """
            ),
            {"module_id": row[0], "user_id": row[1]}
        )
        session_id = result.fetchone()[0]
        conn.execute(
            sa.text(
                """
                UPDATE module_chat_messages
                SET session_id = :session_id
                WHERE module_id = :module_id AND user_id = :user_id
                  AND chapter_title IS NULL AND session_id IS NULL
                """
            ),
            {"session_id": session_id, "module_id": row[0], "user_id": row[1]}
        )


def downgrade() -> None:
    op.drop_column('module_chat_messages', 'session_id')
    op.drop_index('ix_chat_session_module_user_campaign', table_name='module_chat_sessions')
    op.drop_table('module_chat_sessions')
