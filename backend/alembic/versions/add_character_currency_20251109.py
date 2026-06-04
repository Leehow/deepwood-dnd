"""Add currency field to characters table

Revision ID: add_character_currency_20251109
Revises: fix_token_constraint_20251108
Create Date: 2025-11-09

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "add_character_currency_20251109"
down_revision = "fix_token_constraint_20251108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # Add currency JSON field if missing
    if inspector.has_table("characters"):
        cols = [c["name"] for c in inspector.get_columns("characters")]
        if "currency" not in cols:
            op.add_column(
                "characters",
                sa.Column(
                    "currency",
                    sa.JSON(),
                    nullable=True,
                    server_default='{"cp":0,"sp":0,"ep":0,"gp":0,"pp":0}',
                ),
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("characters"):
        cols = [c["name"] for c in inspector.get_columns("characters")]
        if "currency" in cols:
            op.drop_column("characters", "currency")

