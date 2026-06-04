"""Change fighting_style, favored_enemy, favored_terrain to JSON

Revision ID: change_feature_columns_to_json
Revises:
Create Date: 2026-01-19

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'change_feature_columns_to_json'
down_revision: Union[str, None] = 'f4121243809e'  # Previous head
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Convert string columns to JSONB
    # First, temporarily store the old values
    op.execute("""
        ALTER TABLE characters
        ALTER COLUMN fighting_style TYPE JSONB
        USING CASE
            WHEN fighting_style IS NULL THEN NULL
            WHEN fighting_style = '' THEN NULL
            ELSE jsonb_build_object('value', fighting_style, 'level_acquired', 2, 'source', class_id)
        END
    """)

    op.execute("""
        ALTER TABLE characters
        ALTER COLUMN favored_enemy TYPE JSONB
        USING CASE
            WHEN favored_enemy IS NULL THEN NULL
            WHEN favored_enemy = '' THEN NULL
            ELSE jsonb_build_object('value', favored_enemy, 'level_acquired', 1, 'source', 'ranger')
        END
    """)

    op.execute("""
        ALTER TABLE characters
        ALTER COLUMN favored_terrain TYPE JSONB
        USING CASE
            WHEN favored_terrain IS NULL THEN NULL
            WHEN favored_terrain = '' THEN NULL
            ELSE jsonb_build_object('value', favored_terrain, 'level_acquired', 1, 'source', 'ranger')
        END
    """)


def downgrade() -> None:
    # Convert back to string (extract value from JSON)
    op.execute("""
        ALTER TABLE characters
        ALTER COLUMN fighting_style TYPE VARCHAR(50)
        USING CASE
            WHEN fighting_style IS NULL THEN NULL
            ELSE fighting_style->>'value'
        END
    """)

    op.execute("""
        ALTER TABLE characters
        ALTER COLUMN favored_enemy TYPE VARCHAR(50)
        USING CASE
            WHEN favored_enemy IS NULL THEN NULL
            ELSE favored_enemy->>'value'
        END
    """)

    op.execute("""
        ALTER TABLE characters
        ALTER COLUMN favored_terrain TYPE VARCHAR(50)
        USING CASE
            WHEN favored_terrain IS NULL THEN NULL
            ELSE favored_terrain->>'value'
        END
    """)
