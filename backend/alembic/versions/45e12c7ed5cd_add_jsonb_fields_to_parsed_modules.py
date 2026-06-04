"""add_jsonb_fields_to_parsed_modules

Revision ID: 45e12c7ed5cd
Revises: a1b2c3d4e5f6
Create Date: 2026-01-01 17:15:29.882749

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '45e12c7ed5cd'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add JSONB columns to parsed_modules table for storing parsed content
    op.add_column('parsed_modules', sa.Column('module_info', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('parsed_modules', sa.Column('chapters', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('parsed_modules', sa.Column('monsters', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('parsed_modules', sa.Column('items', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('parsed_modules', sa.Column('images', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('parsed_modules', sa.Column('toc', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    # Remove JSONB columns
    op.drop_column('parsed_modules', 'toc')
    op.drop_column('parsed_modules', 'images')
    op.drop_column('parsed_modules', 'items')
    op.drop_column('parsed_modules', 'monsters')
    op.drop_column('parsed_modules', 'chapters')
    op.drop_column('parsed_modules', 'module_info')
