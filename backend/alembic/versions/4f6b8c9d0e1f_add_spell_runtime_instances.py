"""add spell runtime instances

Revision ID: 4f6b8c9d0e1f
Revises: 1d3f5e6a7b8c
Create Date: 2026-03-23

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "4f6b8c9d0e1f"
down_revision = "1d3f5e6a7b8c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if not inspector.has_table("spell_runtime_instances"):
        op.create_table(
            "spell_runtime_instances",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("campaign_id", sa.Integer(), nullable=False),
            sa.Column("spell_id", sa.String(length=100), nullable=False),
            sa.Column("spell_name", sa.String(length=200), nullable=False),
            sa.Column("caster_token_id", sa.Integer(), nullable=False),
            sa.Column("concentration_owner_token_id", sa.Integer(), nullable=True),
            sa.Column("primary_target_token_id", sa.Integer(), nullable=True),
            sa.Column("linked_target_token_ids", sa.JSON(), nullable=True),
            sa.Column("selected_option", sa.String(length=100), nullable=True),
            sa.Column("params", sa.JSON(), nullable=True),
            sa.Column("duration_rounds", sa.Integer(), nullable=True),
            sa.Column("current_round", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("expires_at_round", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'active'")),
            sa.Column("granted_actions", sa.JSON(), nullable=True),
            sa.Column("host_entities", sa.JSON(), nullable=True),
            sa.Column("ui_projection_version", sa.Integer(), nullable=False, server_default=sa.text("1")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["caster_token_id"], ["tokens.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["concentration_owner_token_id"], ["tokens.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["primary_target_token_id"], ["tokens.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )

    existing_indexes = {index["name"] for index in inspector.get_indexes("spell_runtime_instances")}
    indexes = {
        "ix_spell_runtime_instances_campaign_id": ["campaign_id"],
        "ix_spell_runtime_instances_spell_id": ["spell_id"],
        "ix_spell_runtime_instances_caster_token_id": ["caster_token_id"],
        "ix_spell_runtime_instances_concentration_owner_token_id": ["concentration_owner_token_id"],
        "ix_spell_runtime_instances_primary_target_token_id": ["primary_target_token_id"],
        "ix_spell_runtime_instances_status": ["status"],
    }
    for index_name, columns in indexes.items():
        if index_name not in existing_indexes:
            op.create_index(index_name, "spell_runtime_instances", columns, unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("spell_runtime_instances"):
        for index_name in [
            "ix_spell_runtime_instances_status",
            "ix_spell_runtime_instances_primary_target_token_id",
            "ix_spell_runtime_instances_concentration_owner_token_id",
            "ix_spell_runtime_instances_caster_token_id",
            "ix_spell_runtime_instances_spell_id",
            "ix_spell_runtime_instances_campaign_id",
        ]:
            existing_indexes = {index["name"] for index in inspector.get_indexes("spell_runtime_instances")}
            if index_name in existing_indexes:
                op.drop_index(index_name, table_name="spell_runtime_instances")

        op.drop_table("spell_runtime_instances")
