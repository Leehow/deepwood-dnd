#!/usr/bin/env python3
"""
Normalize legacy item payload JSON into the canonical schema.

Targets:
- characters.equipment
- tokens.item_data + tokens.item_quantity
- tokens.loot_bag_data
- monster_instances.inventory
- monster_instances.equipment
"""

import argparse
import asyncio
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db.session import async_session_maker
from app.models.campaign import Campaign  # noqa: F401
from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.token import Token
from app.utils.item_payload_normalizer import (
    normalize_character_equipment_payloads,
    normalize_loot_bag_data,
    normalize_token_item_fields,
)


EMPTY_CURRENCY = {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}


def merge_currency(base_currency: dict | None, extra_currency: dict | None) -> dict:
    currency = dict(base_currency or EMPTY_CURRENCY)
    for coin_type in EMPTY_CURRENCY:
        amount = int((extra_currency or {}).get(coin_type) or 0)
        if amount:
            currency[coin_type] = int(currency.get(coin_type) or 0) + amount
    return currency


async def normalize_characters(*, execute: bool) -> dict:
    stats = {"scanned": 0, "updated": 0, "currency_merged": 0}

    async with async_session_maker() as db:
        result = await db.execute(select(Character))
        characters = result.scalars().all()
        stats["scanned"] = len(characters)

        for character in characters:
            normalized_equipment, currency_extracted, equipment_changed = normalize_character_equipment_payloads(
                character.equipment
            )
            merged_currency = merge_currency(character.currency, currency_extracted)
            currency_changed = merged_currency != (character.currency or EMPTY_CURRENCY)

            if equipment_changed:
                character.equipment = normalized_equipment
                flag_modified(character, "equipment")
            if currency_changed:
                character.currency = merged_currency
                flag_modified(character, "currency")
                if any(currency_extracted.values()):
                    stats["currency_merged"] += 1

            if equipment_changed or currency_changed:
                stats["updated"] += 1

        if execute:
            await db.commit()
        else:
            await db.rollback()

    return stats


async def normalize_tokens(*, execute: bool) -> dict:
    stats = {"scanned": 0, "updated": 0, "item_data_updated": 0, "loot_bags_updated": 0, "quantity_fixed": 0}

    async with async_session_maker() as db:
        result = await db.execute(select(Token))
        tokens = result.scalars().all()
        stats["scanned"] = len(tokens)

        for token in tokens:
            record_changed = False

            normalized_item_data, normalized_item_quantity, item_changed = normalize_token_item_fields(
                token.item_data,
                token.item_quantity,
            )
            if token.item_data is not None and item_changed:
                if token.item_data != normalized_item_data:
                    token.item_data = normalized_item_data
                    flag_modified(token, "item_data")
                    stats["item_data_updated"] += 1
                if token.item_quantity != normalized_item_quantity:
                    token.item_quantity = normalized_item_quantity
                    stats["quantity_fixed"] += 1
                record_changed = True

            normalized_loot_bag_data, loot_bag_changed = normalize_loot_bag_data(token.loot_bag_data)
            if loot_bag_changed:
                token.loot_bag_data = normalized_loot_bag_data
                flag_modified(token, "loot_bag_data")
                stats["loot_bags_updated"] += 1
                record_changed = True

            if record_changed:
                stats["updated"] += 1

        if execute:
            await db.commit()
        else:
            await db.rollback()

    return stats


async def normalize_monster_instances(*, execute: bool) -> dict:
    stats = {"scanned": 0, "updated": 0, "inventory_updated": 0, "equipment_updated": 0, "currency_merged": 0}

    async with async_session_maker() as db:
        result = await db.execute(select(MonsterInstance))
        monsters = result.scalars().all()
        stats["scanned"] = len(monsters)

        for monster in monsters:
            record_changed = False

            normalized_inventory, inventory_currency, inventory_changed = normalize_character_equipment_payloads(
                monster.inventory
            )
            normalized_equipment, equipment_currency, equipment_changed = normalize_character_equipment_payloads(
                monster.equipment
            )
            merged_currency = merge_currency(monster.currency, inventory_currency)
            merged_currency = merge_currency(merged_currency, equipment_currency)
            currency_changed = merged_currency != (monster.currency or EMPTY_CURRENCY)

            if inventory_changed:
                monster.inventory = normalized_inventory
                flag_modified(monster, "inventory")
                stats["inventory_updated"] += 1
                record_changed = True

            if equipment_changed:
                monster.equipment = normalized_equipment
                flag_modified(monster, "equipment")
                stats["equipment_updated"] += 1
                record_changed = True

            if currency_changed:
                monster.currency = merged_currency
                flag_modified(monster, "currency")
                if any(inventory_currency.values()) or any(equipment_currency.values()):
                    stats["currency_merged"] += 1
                record_changed = True

            if record_changed:
                stats["updated"] += 1

        if execute:
            await db.commit()
        else:
            await db.rollback()

    return stats


def print_stats(section: str, stats: dict) -> None:
    print(f"\n[{section}]")
    for key, value in stats.items():
        print(f"  {key}: {value}")


async def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize legacy item payload JSON")
    parser.add_argument("--execute", action="store_true", help="Persist changes (default is dry-run)")
    args = parser.parse_args()

    print("Mode:", "EXECUTE" if args.execute else "DRY RUN")

    character_stats = await normalize_characters(execute=args.execute)
    token_stats = await normalize_tokens(execute=args.execute)
    monster_stats = await normalize_monster_instances(execute=args.execute)

    print_stats("characters", character_stats)
    print_stats("tokens", token_stats)
    print_stats("monster_instances", monster_stats)


if __name__ == "__main__":
    asyncio.run(main())
