"""add_ocr_images_and_classifications_to_raw_module_files

Revision ID: 6f9902eef1bd
Revises: 45e12c7ed5cd
Create Date: 2026-01-01 18:46:06.664557

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '6f9902eef1bd'
down_revision: Union[str, None] = '45e12c7ed5cd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add JSONB columns to raw_module_files for storing OCR images and classifications
    op.add_column('raw_module_files', sa.Column('ocr_images', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('raw_module_files', sa.Column('image_classifications', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    # Remove JSONB columns
    op.drop_column('raw_module_files', 'image_classifications')
    op.drop_column('raw_module_files', 'ocr_images')
