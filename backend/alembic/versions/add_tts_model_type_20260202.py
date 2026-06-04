"""add TTS to modeltype enum

Revision ID: add_tts_20260202
Revises: f7e8d9c0b1a2
Create Date: 2026-02-02
"""
from alembic import op

revision = 'add_tts_20260202'
down_revision = 'f7e8d9c0b1a2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE modeltype ADD VALUE IF NOT EXISTS 'TTS'")


def downgrade() -> None:
    # PostgreSQL doesn't support removing enum values directly.
    # A full recreation would be needed, which is rarely done.
    pass
