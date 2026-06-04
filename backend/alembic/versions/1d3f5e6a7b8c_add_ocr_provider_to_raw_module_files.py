"""add ocr_provider to raw_module_files

Revision ID: 1d3f5e6a7b8c
Revises: 7c3f9b2e8a1d
Create Date: 2026-03-22

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "1d3f5e6a7b8c"
down_revision = "7c3f9b2e8a1d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("raw_module_files"):
        cols = {c["name"] for c in inspector.get_columns("raw_module_files")}
        if "ocr_provider" not in cols:
            op.add_column(
                "raw_module_files",
                sa.Column("ocr_provider", sa.String(length=50), nullable=True),
            )


def downgrade() -> None:
    op.drop_column("raw_module_files", "ocr_provider")
