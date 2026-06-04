"""Add ON DELETE CASCADE FKs to campaign_id refs; normalize string campaign_id -> integer

Revision ID: cascade_campaign_fk_20251111
Revises: items_custom_fields_20251109
Create Date: 2025-11-11

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "cascade_campaign_fk_20251111"
down_revision = "items_custom_fields_20251109"
branch_labels = None
depends_on = None


def _fk_exists(inspector, table_name: str, constrained_cols: list[str], referred_table: str) -> bool:
    for fk in inspector.get_foreign_keys(table_name):
        if fk.get("referred_table") == referred_table and fk.get("constrained_columns") == constrained_cols:
            return True
    return False


def _drop_fk_by_columns(inspector, table: str, columns: list[str]):
    # Drop any FK on specified columns for table (used to replace with CASCADE)
    for fk in inspector.get_foreign_keys(table):
        if fk.get("constrained_columns") == columns:
            op.drop_constraint(fk["name"], table, type_="foreignkey")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # 0) Pre-clean orphan rows that would violate new FKs
    if inspector.has_table("campaigns"):
        existing_campaign_ids = [r[0] for r in bind.execute(sa.text("SELECT id FROM campaigns")).fetchall()]
        if existing_campaign_ids:
            ids_csv = ",".join(str(i) for i in existing_campaign_ids)
            for t in [
                "tokens",
                "items",
                "monster_instances",
                "shops",
                "map_settings",
                "campaign_members",
                "campaign_chat_messages",
                "dice_requests",
                "dice_rolls",
                "campaign_storage",
            ]:
                if inspector.has_table(t):
                    bind.execute(sa.text(f"DELETE FROM {t} WHERE campaign_id IS NOT NULL AND campaign_id NOT IN ({ids_csv})"))
        # shop_inventory cleanup (shops/items may be missing)
        if inspector.has_table("shop_inventory"):
            bind.execute(sa.text("DELETE FROM shop_inventory si WHERE NOT EXISTS (SELECT 1 FROM shops s WHERE s.id = si.shop_id)"))
            bind.execute(sa.text("DELETE FROM shop_inventory si WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.id = si.item_id)"))

    # 1) Convert String campaign_id columns to Integer in these tables
    for table in ["map_view_state", "fog_of_war", "drawings", "rulers", "module_maps"]:
        if inspector.has_table(table):
            cols = {c["name"]: c for c in inspector.get_columns(table)}
            if "campaign_id" in cols and isinstance(cols["campaign_id"]["type"], sa.String):
                # PostgreSQL-safe conversion using USING clause
                op.execute(sa.text(f"ALTER TABLE {table} ALTER COLUMN campaign_id TYPE INTEGER USING campaign_id::integer"))
                op.alter_column(table, "campaign_id", existing_type=sa.Integer(), nullable=False)

    # 1.5) After converting, clean five tables now on integer campaign_id
    if inspector.has_table("campaigns"):
        existing_campaign_ids = [r[0] for r in bind.execute(sa.text("SELECT id FROM campaigns")).fetchall()]
        if existing_campaign_ids:
            ids_csv = ",".join(str(i) for i in existing_campaign_ids)
            for t in ["map_view_state", "fog_of_war", "drawings", "rulers", "module_maps"]:
                if inspector.has_table(t):
                    bind.execute(sa.text(f"DELETE FROM {t} WHERE campaign_id IS NOT NULL AND campaign_id NOT IN ({ids_csv})"))

    # 2) Add/replace FKs with ON DELETE CASCADE for campaign_id
    fk_targets = [
        "tokens",
        "items",
        "monster_instances",
        "shops",
        "map_settings",
        "campaign_members",
        "campaign_chat_messages",
        "dice_requests",
        "dice_rolls",
        "map_view_state",
        "fog_of_war",
        "drawings",
        "rulers",
        "module_maps",
        "campaign_storage",  # safety; some installs already had this FK
    ]

    for table in fk_targets:
        if not inspector.has_table(table):
            continue
        # drop existing FK on campaign_id (if any) to replace with CASCADE
        _drop_fk_by_columns(inspector, table, ["campaign_id"])
        if not _fk_exists(inspector, table, ["campaign_id"], "campaigns"):
            op.create_foreign_key(
                constraint_name=f"fk_{table}_campaign_id_campaigns",
                source_table=table,
                referent_table="campaigns",
                local_cols=["campaign_id"],
                remote_cols=["id"],
                ondelete="CASCADE",
            )

    # 3) shop_inventory FKs -> ON DELETE CASCADE
    if inspector.has_table("shop_inventory"):
        _drop_fk_by_columns(inspector, "shop_inventory", ["shop_id"])
        _drop_fk_by_columns(inspector, "shop_inventory", ["item_id"])
        op.create_foreign_key(
            "fk_shop_inventory_shop_id_shops",
            "shop_inventory",
            "shops",
            ["shop_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_foreign_key(
            "fk_shop_inventory_item_id_items",
            "shop_inventory",
            "items",
            ["item_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # Drop shop_inventory FKs
    if inspector.has_table("shop_inventory"):
        for fk in inspector.get_foreign_keys("shop_inventory"):
            if fk.get("constrained_columns") in (["shop_id"], ["item_id"]):
                op.drop_constraint(fk["name"], "shop_inventory", type_="foreignkey")

    # Drop campaign_id FKs we created
    for table in [
        "tokens",
        "items",
        "monster_instances",
        "shops",
        "map_settings",
        "campaign_members",
        "campaign_chat_messages",
        "dice_requests",
        "dice_rolls",
        "map_view_state",
        "fog_of_war",
        "drawings",
        "rulers",
        "module_maps",
        "campaign_storage",
    ]:
        if inspector.has_table(table):
            for fk in inspector.get_foreign_keys(table):
                if fk.get("constrained_columns") == ["campaign_id"] and fk.get("referred_table") == "campaigns":
                    op.drop_constraint(fk["name"], table, type_="foreignkey")

    # Convert Integer campaign_id back to text for the previously string tables
    for table in ["map_view_state", "fog_of_war", "drawings", "rulers", "module_maps"]:
        if inspector.has_table(table):
            cols = {c["name"]: c for c in inspector.get_columns(table)}
            if "campaign_id" in cols and isinstance(cols["campaign_id"]["type"], sa.Integer):
                op.execute(sa.text(f"ALTER TABLE {table} ALTER COLUMN campaign_id TYPE TEXT USING campaign_id::text"))
                op.alter_column(table, "campaign_id", existing_type=sa.Text(), nullable=False)

