from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.monster_instance import MonsterInstance
from app.models.token import Token
from app.services.entity_creation_service import EntityCreationService
from app.services.module_avatar_generation_service import generate_module_monster_avatar_background
from app.services.module_entity_service import (
    build_encounter_creation_message,
    build_monster_token_payload,
    calculate_spiral_positions,
    match_monster_from_module,
    match_preset_monster_by_name,
    search_monster_in_chapters,
)
from app.services.realtime_publisher import realtime_publisher

ParseModuleMonsterDescription = Callable[
    [str, str, AsyncSession, str, Sequence[dict[str, Any]] | None],
    Awaitable[dict[str, Any]],
]


def normalize_encounter_monsters(
    raw_monsters: Sequence[Any] | None,
    *,
    boss: Mapping[str, Any] | None = None,
    minions: Sequence[Any] | None = None,
) -> list[dict[str, Any]]:
    """Normalize encounter payloads into a canonical monster list."""
    normalized: list[dict[str, Any]] = []
    source_monsters = list(raw_monsters or [])

    if not source_monsters and boss:
        source_monsters.append({**boss, "count": 1})
        for minion in minions or []:
            if isinstance(minion, str):
                source_monsters.append({"name": minion, "count": 1})
            elif isinstance(minion, Mapping):
                source_monsters.append(dict(minion))

    for monster in source_monsters:
        if isinstance(monster, str):
            normalized.append({"name": monster, "count": 1})
        elif isinstance(monster, Mapping):
            monster_dict = dict(monster)
            monster_dict["count"] = _safe_positive_int(monster_dict.get("count"), default=1)
            normalized.append(monster_dict)

    return normalized


def build_marker_position_lookup(
    markers: Sequence[Mapping[str, Any]] | None,
    *,
    grid_size: int = 40,
) -> dict[str, tuple[int, int]]:
    """Convert percentage-based AI markers into approximate grid coordinates."""
    positions: dict[str, tuple[int, int]] = {}
    for marker in markers or []:
        label = str(marker.get("label", "") or "").strip()
        if not label:
            continue

        x_value = _parse_marker_percent(marker.get("x", "50%"))
        y_value = _parse_marker_percent(marker.get("y", "50%"))
        if x_value is None or y_value is None:
            continue

        positions[label] = (int(x_value / 100 * grid_size), int(y_value / 100 * grid_size))
    return positions


def resolve_area_base_position(
    *,
    area_name: str,
    area_index: int,
    viewport_center_x: int,
    viewport_center_y: int,
    area_positions: Mapping[str, tuple[int, int]],
) -> tuple[int, int]:
    """Resolve the base placement coordinate for an encounter area."""
    for marker_label, position in area_positions.items():
        if marker_label in area_name or area_name in marker_label:
            return position

    area_offset_x = ((area_index % 3) - 1) * 4
    area_offset_y = (area_index // 3) * 4
    return viewport_center_x + area_offset_x, viewport_center_y + area_offset_y


async def create_module_encounter(
    *,
    db: AsyncSession,
    campaign: Any,
    campaign_id: int,
    module_id: str,
    module: Any | None,
    data: dict[str, Any],
    preset_monsters: Sequence[Mapping[str, Any]],
    parse_module_monster_description: ParseModuleMonsterDescription,
) -> dict[str, Any]:
    """Create an encounter from pre-generated module data."""
    title = data.get("title") or data.get("name") or "遭遇"
    monsters_data = normalize_encounter_monsters(
        data.get("monsters", []),
        boss=data.get("boss"),
        minions=data.get("minions", []),
    )
    map_url = data.get("map_url") or campaign.current_map_url
    viewport_center = data.get("viewport_center", {"x": 10, "y": 10})

    total_monsters = sum(_safe_positive_int(monster.get("count"), default=1) for monster in monsters_data)
    positions = calculate_spiral_positions(viewport_center, total_monsters)
    position_index = 0

    module_monsters = module.monsters if module and getattr(module, "monsters", None) else []
    created_monsters: list[dict[str, Any]] = []
    created_token_pairs: list[dict[str, Any]] = []

    for monster_request in monsters_data:
        count = _safe_positive_int(monster_request.get("count"), default=1)
        monster_name = str(monster_request.get("name", "未知怪物") or "未知怪物")

        resolved = await _resolve_encounter_monster_seed(
            db=db,
            campaign_id=campaign_id,
            monster_name=monster_name,
            monster_request=monster_request,
            module=module,
            module_monsters=module_monsters,
            preset_monsters=preset_monsters,
            parse_module_monster_description=parse_module_monster_description,
        )
        raw_data = resolved["raw_data"]
        source = resolved["source"]
        monster_id = resolved["monster_id"]
        matched_source = resolved["matched_source"]
        existing_monster = resolved["existing_monster"]
        appearance = resolved["appearance"]

        inventory, currency = _extract_loot_payload(monster_request)

        for index in range(count):
            instance_name = monster_name if count == 1 else f"{monster_name} #{index + 1}"

            if source == "existing" and existing_monster and index == 0:
                monster_instance = existing_monster
                if inventory or currency:
                    monster_instance.inventory = inventory
                    monster_instance.currency = currency
                    await db.flush()
            else:
                monster_instance = await EntityCreationService.create_from_raw_data(
                    db=db,
                    campaign_id=campaign_id,
                    raw_data=raw_data,
                    source=source,
                    instance_name=instance_name,
                    monster_id=monster_id,
                    source_module=module_id,
                    source_encounter=title,
                    suggested_count=count,
                    inventory=inventory if inventory else None,
                    currency=currency if currency else None,
                )

            created_monsters.append(
                {
                    "id": monster_instance.id,
                    "name": monster_instance.name,
                    "challenge_rating": monster_instance.challenge_rating,
                    "hit_points": monster_instance.hit_points,
                    "armor_class": monster_instance.armor_class,
                    "matched_source": matched_source,
                    "appearance": appearance or f"{monster_name}，一个危险的敌人",
                    "has_loot": bool(inventory or currency),
                    "loot_summary": (
                        f"{sum(currency.values())}钱币, {len(inventory)}物品" if (inventory or currency) else None
                    ),
                }
            )

            if map_url:
                token_position = (
                    positions[position_index]
                    if position_index < len(positions)
                    else positions[-1]
                    if positions
                    else {"x": 10, "y": 10}
                )
                position_index += 1

                token = Token(
                    campaign_id=campaign_id,
                    map_url=map_url,
                    monster_instance_id=monster_instance.id,
                    user_id=campaign.dm_user_id,
                    instance_name=instance_name,
                    position_x=token_position["x"],
                    position_y=token_position["y"],
                    token_size=monster_instance.token_size,
                    current_hp=monster_instance.current_hp,
                )
                db.add(token)
                await db.flush()
                created_token_pairs.append({"token": token, "monster_instance": monster_instance})

    await db.commit()

    for monster_info in created_monsters:
        asyncio.create_task(
            generate_module_monster_avatar_background(
                monster_instance_id=monster_info["id"],
                campaign_id=campaign_id,
                name=monster_info["name"],
                appearance=monster_info.get("appearance", f"{monster_info['name']}，一个危险的敌人"),
            )
        )

    for token_pair in created_token_pairs:
        await realtime_publisher.publish_token_placed(
            campaign_id,
            token=build_monster_token_payload(token_pair["token"], token_pair["monster_instance"]),
        )

    return {
        "success": True,
        "title": title,
        "monsters": created_monsters,
        "token_ids": [pair["token"].id for pair in created_token_pairs],
        "type": "encounter",
        "message": build_encounter_creation_message(
            monster_count=len(created_monsters),
            has_tokens=bool(created_token_pairs),
        ),
    }


async def execute_structured_map_encounter(
    *,
    db: AsyncSession,
    campaign_id: int,
    module_id: str,
    module: Any | None,
    map_url: str,
    areas: Sequence[Mapping[str, Any]],
    viewport_center_x: int,
    viewport_center_y: int,
    preset_monsters: Sequence[Mapping[str, Any]],
    markers: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Execute a structured encounter plan by creating monsters and placing tokens."""
    module_monsters = module.monsters if module and getattr(module, "monsters", None) else []
    area_positions = build_marker_position_lookup(markers)

    created_entities: list[dict[str, Any]] = []
    created_tokens: list[Token] = []

    for area_index, area in enumerate(areas):
        area_name = str(area.get("name", "未知区域") or "未知区域")
        base_x, base_y = resolve_area_base_position(
            area_name=area_name,
            area_index=area_index,
            viewport_center_x=viewport_center_x,
            viewport_center_y=viewport_center_y,
            area_positions=area_positions,
        )

        for monster_info in area.get("monsters", []):
            if not isinstance(monster_info, Mapping):
                continue

            monster_name = str(monster_info.get("name", "") or "")
            if not monster_name:
                continue

            count = _safe_positive_int(monster_info.get("count"), default=1)
            raw_data, source = _resolve_plan_monster_seed(
                monster_name=monster_name,
                module_monsters=module_monsters,
                preset_monsters=preset_monsters,
            )
            loot_currency, loot_items = _extract_area_loot(area.get("loot", {}))

            existing_result = await db.execute(
                select(MonsterInstance)
                .where(
                    MonsterInstance.campaign_id == campaign_id,
                    MonsterInstance.name == raw_data.get("name", monster_name),
                )
                .limit(1)
            )
            existing_monster = existing_result.scalar_one_or_none()

            for index in range(count):
                instance_name = monster_name if count == 1 else f"{monster_name} #{index + 1}"
                monster_instance = existing_monster

                if not monster_instance:
                    inventory = []
                    currency: dict[str, int] = {}
                    if index == 0 and loot_items:
                        inventory = [{"name": item, "quantity": 1} for item in loot_items]
                    if index == 0 and loot_currency:
                        currency = {
                            "cp": loot_currency.get("cp", 0),
                            "sp": loot_currency.get("sp", 0),
                            "gp": loot_currency.get("gp", 0),
                            "pp": loot_currency.get("pp", 0),
                        }

                    monster_instance = await EntityCreationService.create_from_raw_data(
                        db=db,
                        campaign_id=campaign_id,
                        raw_data=raw_data,
                        source=source,
                        instance_name=None,
                        inventory=inventory if inventory else None,
                        currency=currency if any(currency.values()) else None,
                        source_module=module_id,
                        source_encounter=area_name,
                    )
                    existing_monster = monster_instance

                token = Token(
                    campaign_id=campaign_id,
                    monster_instance_id=monster_instance.id,
                    instance_name=instance_name,
                    position_x=base_x + ((index % 3) - 1),
                    position_y=base_y + (index // 3),
                    token_size=_map_token_size(raw_data.get("size", "中型")),
                    map_url=map_url,
                    user_id="system",
                    faction="enemy",
                    current_hp=_initial_hp(raw_data),
                )
                db.add(token)

                created_entities.append(
                    {
                        "id": monster_instance.id,
                        "name": instance_name,
                        "type": "monster",
                        "source": source,
                        "area": area_name,
                        "x": token.position_x,
                        "y": token.position_y,
                    }
                )
                created_tokens.append(token)

    await db.commit()

    for token in created_tokens:
        await db.refresh(token)
        monster_result = await db.execute(
            select(MonsterInstance).where(MonsterInstance.id == token.monster_instance_id)
        )
        monster = monster_result.scalar_one_or_none()
        await realtime_publisher.publish_token_placed(
            campaign_id,
            token=build_monster_token_payload(token, monster),
        )

    return {
        "success": True,
        "created_count": len(created_entities),
        "entities": created_entities,
        "message": f"已创建 {len(created_entities)} 个实体并放置到地图上",
    }


async def _resolve_encounter_monster_seed(
    *,
    db: AsyncSession,
    campaign_id: int,
    monster_name: str,
    monster_request: Mapping[str, Any],
    module: Any | None,
    module_monsters: Sequence[Mapping[str, Any]],
    preset_monsters: Sequence[Mapping[str, Any]],
    parse_module_monster_description: ParseModuleMonsterDescription,
) -> dict[str, Any]:
    existing_result = await db.execute(
        select(MonsterInstance)
        .where(
            MonsterInstance.campaign_id == campaign_id,
            (MonsterInstance.name.ilike(f"%{monster_name}%"))
            | (MonsterInstance.name_cn.ilike(f"%{monster_name}%")),
        )
        .order_by(MonsterInstance.created_at.desc())
        .limit(1)
    )
    existing_monster = existing_result.scalar_one_or_none()
    if existing_monster and existing_monster.hit_points and existing_monster.hit_points > 10:
        raw_data = {
            "name": existing_monster.name,
            "name_cn": existing_monster.name_cn,
            "size": existing_monster.size,
            "type": existing_monster.type,
            "alignment": existing_monster.alignment,
            "cr": existing_monster.challenge_rating,
            "hp": existing_monster.hit_points,
            "hp_formula": existing_monster.hit_dice,
            "ac": existing_monster.armor_class,
            "ability_scores": existing_monster.ability_scores,
            "speeds": existing_monster.speeds,
            "appearance": (
                existing_monster.monster_data.get("appearance", "") if existing_monster.monster_data else ""
            ),
            **(existing_monster.monster_data or {}),
        }
        return {
            "raw_data": raw_data,
            "source": "existing",
            "monster_id": existing_monster.monster_id or f"exist_{uuid4().hex[:8]}",
            "matched_source": "existing_campaign",
            "existing_monster": existing_monster,
            "appearance": raw_data.get("appearance", ""),
        }

    preset_monster = match_preset_monster_by_name(monster_name, preset_monsters)
    if preset_monster:
        return {
            "raw_data": dict(preset_monster),
            "source": "preset",
            "monster_id": preset_monster.get("id", f"enc_{uuid4().hex[:8]}"),
            "matched_source": "preset",
            "existing_monster": None,
            "appearance": preset_monster.get("appearance", monster_request.get("appearance", "")),
        }

    module_monster = match_monster_from_module(monster_name, module_monsters)
    if module_monster:
        merged_module_monster = dict(module_monster)
        has_structured_data = any(
            merged_module_monster.get(field) is not None
            for field in ("hp", "hit_points", "ac", "armor_class")
        )
        if not has_structured_data and merged_module_monster.get("description"):
            raw_actions = merged_module_monster.get("actions")
            if isinstance(raw_actions, str):
                actions_text = raw_actions
            elif isinstance(raw_actions, list):
                actions_text = "; ".join(
                    f"{action.get('name', '')}: {action.get('description', '')}"
                    for action in raw_actions
                    if isinstance(action, Mapping)
                )
            else:
                actions_text = ""

            parsed = await parse_module_monster_description(
                merged_module_monster.get("description", ""),
                monster_name,
                db,
                actions_text=actions_text,
                all_module_monsters=module_monsters,
            )
            if parsed:
                merged_module_monster = {**merged_module_monster, **parsed}

        return {
            "raw_data": merged_module_monster,
            "source": "module",
            "monster_id": f"mod_{uuid4().hex[:8]}",
            "matched_source": "module",
            "existing_monster": None,
            "appearance": merged_module_monster.get("appearance", monster_request.get("appearance", "")),
        }

    module_chapters = (module.chapters or module.toc) if module else []
    chapter_content = search_monster_in_chapters(monster_name, module_chapters)
    if chapter_content:
        parsed = await parse_module_monster_description(
            chapter_content,
            monster_name,
            db,
            actions_text="",
            all_module_monsters=module_monsters,
        )
        if parsed and (parsed.get("hp") or parsed.get("ac")):
            raw_data = {"name": monster_name, "description": chapter_content, **parsed}
            return {
                "raw_data": raw_data,
                "source": "module_chapter",
                "monster_id": f"chap_{uuid4().hex[:8]}",
                "matched_source": "module_chapter",
                "existing_monster": None,
                "appearance": raw_data.get("appearance", monster_request.get("appearance", "")),
            }

    return {
        "raw_data": dict(monster_request),
        "source": "ai",
        "monster_id": f"enc_{uuid4().hex[:8]}",
        "matched_source": "ai",
        "existing_monster": None,
        "appearance": monster_request.get("appearance", ""),
    }


def _resolve_plan_monster_seed(
    *,
    monster_name: str,
    module_monsters: Sequence[Mapping[str, Any]],
    preset_monsters: Sequence[Mapping[str, Any]],
) -> tuple[dict[str, Any], str]:
    for monster in module_monsters:
        if monster.get("name") == monster_name or monster.get("name_en") == monster_name:
            return dict(monster), "module"

    for monster in preset_monsters:
        if monster.get("name") == monster_name or monster.get("name_en") == monster_name:
            return dict(monster), "preset"

    return (
        {
            "name": monster_name,
            "cr": "1",
            "hp": 10,
            "ac": 12,
            "size": "中型",
            "type": "类人生物",
        },
        "generated",
    )


def _extract_loot_payload(monster_request: Mapping[str, Any]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    loot = monster_request.get("loot", {})
    if not isinstance(loot, Mapping):
        return [], {}

    loot_currency = loot.get("currency", {})
    loot_items = loot.get("items", [])
    inventory = [
        {"name": item.get("name", ""), "quantity": item.get("quantity", 1)}
        for item in loot_items
        if isinstance(item, Mapping) and item.get("name")
    ]
    currency = {
        "cp": loot_currency.get("cp", 0),
        "sp": loot_currency.get("sp", 0),
        "ep": loot_currency.get("ep", 0),
        "gp": loot_currency.get("gp", 0),
        "pp": loot_currency.get("pp", 0),
    }
    return inventory, {key: value for key, value in currency.items() if value > 0}


def _extract_area_loot(area_loot: Any) -> tuple[dict[str, int], list[str]]:
    if not isinstance(area_loot, Mapping):
        return {}, []
    currency = area_loot.get("currency", {})
    items = [item for item in area_loot.get("items", []) if isinstance(item, str) and item]
    return currency if isinstance(currency, Mapping) else {}, items


def _initial_hp(raw_data: Mapping[str, Any]) -> int:
    initial_hp = raw_data.get("hp", 10)
    if isinstance(initial_hp, Mapping):
        initial_hp = initial_hp.get("average", 10)
    return _safe_positive_int(initial_hp, default=10)


def _map_token_size(size: Any) -> str:
    size_map = {
        "微型": "0.5x0.5",
        "超小型": "0.5x0.5",
        "小型": "1x1",
        "中型": "1x1",
        "大型": "2x2",
        "巨型": "3x3",
        "超巨型": "4x4",
    }
    return size_map.get(str(size or "中型"), "1x1")


def _parse_marker_percent(value: Any) -> float | None:
    try:
        return float(str(value).replace("%", ""))
    except (TypeError, ValueError):
        return None


def _safe_positive_int(value: Any, *, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default
