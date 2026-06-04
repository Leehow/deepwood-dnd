"""Add magic item fields to items table

Revision ID: add_magic_item_fields_20260108
Revises: d16139a978d2
Create Date: 2026-01-08

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = 'add_magic_item_fields_20260108'
down_revision: Union[str, None] = 'd16139a978d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("items"):
        cols = {c["name"] for c in inspector.get_columns("items")}

        # Attunement fields
        if "requires_attunement" not in cols:
            op.add_column("items", sa.Column(
                "requires_attunement", sa.Boolean(),
                nullable=False, server_default=sa.text("false")
            ))
        if "attunement_by" not in cols:
            op.add_column("items", sa.Column(
                "attunement_by", sa.String(200), nullable=True
            ))

        # Magic bonus (+1/+2/+3)
        if "magic_bonus" not in cols:
            op.add_column("items", sa.Column(
                "magic_bonus", sa.Integer(), nullable=True
            ))

        # Extra damage (e.g., 2d6 necrotic)
        if "extra_damage" not in cols:
            op.add_column("items", sa.Column(
                "extra_damage", sa.JSON(), nullable=True
            ))

        # Special abilities array
        if "abilities" not in cols:
            op.add_column("items", sa.Column(
                "abilities", sa.JSON(), nullable=True
            ))

        # Charges system
        if "charges" not in cols:
            op.add_column("items", sa.Column(
                "charges", sa.JSON(), nullable=True
            ))

        # Item spells
        if "item_spells" not in cols:
            op.add_column("items", sa.Column(
                "item_spells", sa.JSON(), nullable=True
            ))

        # Sentient item properties
        if "sentient" not in cols:
            op.add_column("items", sa.Column(
                "sentient", sa.JSON(), nullable=True
            ))

        # Source module tracking
        if "source_module" not in cols:
            op.add_column("items", sa.Column(
                "source_module", sa.String(200), nullable=True
            ))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("items"):
        cols = {c["name"] for c in inspector.get_columns("items")}

        for col in ["source_module", "sentient", "item_spells", "charges",
                    "abilities", "extra_damage", "magic_bonus",
                    "attunement_by", "requires_attunement"]:
            if col in cols:
                op.drop_column("items", col)
