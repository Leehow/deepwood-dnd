from __future__ import annotations

import re
from typing import Any, Mapping, Sequence


_APPEARANCE_KEYWORDS = (
    "穿",
    "戴",
    "身着",
    "披",
    "袍",
    "甲",
    "衣",
    "发",
    "眼",
    "面",
    "肤",
    "高",
    "矮",
    "胖",
    "瘦",
)

_COMBINED_ITEM_PATTERNS = (
    (r"(.+?)（含\d+箭）", "箭矢"),
    (r"(.+?)（含\d+矢）", "弩矢"),
    (r"(.+?)\s*\(含\d+箭\)", "箭矢"),
    (r"(.+?)\s*\(含\d+矢\)", "弩矢"),
)

_HUMANOID_RACE_HINTS = (
    ("精灵", "精灵"),
    ("矮人", "矮人"),
    ("半身人", "半身人"),
    ("半兽人", "半兽人"),
)


def search_character_appearance_in_toc(name: str, toc: Sequence[Mapping[str, Any]] | None) -> str:
    """Search module TOC content for appearance-related snippets for a named NPC."""
    if not toc:
        return ""

    name_parts = re.split(r"[（()）\s]+", name or "")
    search_terms = [part.strip() for part in name_parts if part.strip() and len(part.strip()) > 1]
    if not search_terms:
        return ""

    appearance_hints: list[str] = []

    def search_recursive(items: Sequence[Mapping[str, Any]]) -> None:
        for chapter in items:
            content = str(chapter.get("content", "") or "")
            title = str(chapter.get("title", "") or "")

            for term in search_terms:
                if term not in content and term not in title:
                    continue

                sentences = re.split(r"[。！？\n]", content)
                for sentence in sentences:
                    if any(search_term in sentence for search_term in search_terms) and any(
                        keyword in sentence for keyword in _APPEARANCE_KEYWORDS
                    ):
                        appearance_hints.append(sentence.strip())
                break

            children = chapter.get("children", [])
            if isinstance(children, Sequence) and not isinstance(children, (str, bytes)):
                search_recursive(children)

    search_recursive(toc)
    if not appearance_hints:
        return ""
    return "。".join(appearance_hints[:3])[:300]


def match_preset_monster_by_name(
    name: str,
    monsters: Sequence[Mapping[str, Any]] | None,
) -> dict[str, Any] | None:
    """Match a preset monster by Chinese/English name, including parenthetical aliases."""
    if not monsters:
        return None

    name_lower = (name or "").lower().strip()
    search_names = [name_lower]
    if "(" in name_lower or "（" in name_lower:
        cn_part = re.split(r"[（(]", name_lower)[0].strip()
        if cn_part:
            search_names.append(cn_part)
        en_match = re.search(r"[（(]([^)）]+)[)）]", name_lower)
        if en_match:
            en_part = en_match.group(1).strip()
            search_names.append(en_part)
            search_names.append(en_part + "s")

    for monster in monsters:
        monster_name = str(monster.get("name", "") or "").lower()
        monster_name_en = str(monster.get("nameEn", "") or "").lower()
        for search_name in search_names:
            if monster_name == search_name or monster_name_en == search_name:
                return dict(monster)

    best_match: Mapping[str, Any] | None = None
    best_score = 0.0
    for monster in monsters:
        monster_name = str(monster.get("name", "") or "").lower()
        monster_name_en = str(monster.get("nameEn", "") or "").lower()
        if len(monster_name) <= 1:
            continue

        for search_name in search_names:
            search_len = len(search_name)
            if search_len <= 1:
                continue

            if monster_name and (monster_name in search_name or search_name in monster_name):
                ratio = min(len(monster_name), search_len) / max(len(monster_name), search_len)
                if ratio > best_score:
                    best_score = ratio
                    best_match = monster

            if monster_name_en:
                monster_name_en_base = monster_name_en.rstrip("s")
                search_base = search_name.rstrip("s")
                if monster_name_en_base == search_base or monster_name_en == search_name:
                    return dict(monster)
                if monster_name_en in search_name or search_name in monster_name_en:
                    ratio = min(len(monster_name_en), search_len) / max(len(monster_name_en), search_len)
                    if ratio > best_score:
                        best_score = ratio
                        best_match = monster

    if best_match and best_score >= 0.4:
        return dict(best_match)
    return None


def match_monster_from_module(
    name: str,
    module_monsters: Sequence[Mapping[str, Any]] | None,
) -> dict[str, Any] | None:
    """Match a monster by Chinese or English name from parsed module data."""
    if not module_monsters:
        return None

    name_lower = (name or "").lower().strip()
    for monster in module_monsters:
        monster_name = str(monster.get("name", "") or "").lower()
        monster_name_en = str(monster.get("name_en", "") or monster.get("nameEn", "") or "").lower()
        if monster_name == name_lower or monster_name_en == name_lower:
            return dict(monster)

    for monster in module_monsters:
        monster_name = str(monster.get("name", "") or "").lower()
        monster_name_en = str(monster.get("name_en", "") or monster.get("nameEn", "") or "").lower()
        if name_lower in monster_name or monster_name in name_lower:
            return dict(monster)
        if monster_name_en and (name_lower in monster_name_en or monster_name_en in name_lower):
            return dict(monster)

    return None


def search_module_item(
    item_name: str,
    module_items: Sequence[Mapping[str, Any]] | None,
) -> dict[str, Any] | None:
    """Match a module item by Chinese or English name."""
    if not module_items or not item_name:
        return None

    item_name_lower = item_name.lower().strip()
    for item in module_items:
        module_item_name = str(item.get("name", "") or "")
        if module_item_name.strip() == item_name.strip():
            return dict(item)
        name_en = str(item.get("name_en", "") or item.get("nameEn", "") or "")
        if name_en and name_en.lower() == item_name_lower:
            return dict(item)
        if item_name in module_item_name or module_item_name in item_name:
            return dict(item)

    return None


def search_monster_in_chapters(
    name: str,
    chapters: Sequence[Mapping[str, Any]] | None,
) -> str | None:
    """Search module chapter content for monster-related descriptive context."""
    if not chapters:
        return None

    name_parts = re.split(r"[（()）\s]+", name or "")
    search_terms = [part.lower().strip() for part in name_parts if part.strip()]
    found_content: list[dict[str, Any]] = []

    def search_recursive(items: Sequence[Mapping[str, Any]]) -> None:
        for chapter in items:
            content = str(chapter.get("content", "") or "")
            title = str(chapter.get("title", "") or "")
            content_lower = content.lower()
            title_lower = title.lower()

            for term in search_terms:
                if len(term) < 2:
                    continue
                if term in content_lower or term in title_lower:
                    if content and len(content) > 50:
                        found_content.append(
                            {
                                "title": title,
                                "content": content[:2000],
                                "relevance": content_lower.count(term),
                            }
                        )
                    break

            children = chapter.get("children", [])
            if isinstance(children, Sequence) and not isinstance(children, (str, bytes)):
                search_recursive(children)

    search_recursive(chapters)
    if not found_content:
        return None

    best_match = sorted(found_content, key=lambda item: item["relevance"], reverse=True)[0]
    return f"章节: {best_match['title']}\n\n{best_match['content']}"


def calculate_spiral_positions(
    center: Mapping[str, int],
    count: int,
    spacing: int = 2,
) -> list[dict[str, int]]:
    """Generate deterministic spiral positions for encounter token placement."""
    if count <= 0:
        return []

    cx, cy = int(center["x"]), int(center["y"])
    positions = [{"x": cx, "y": cy}]
    if count == 1:
        return positions

    directions = [(1, 0), (0, 1), (-1, 0), (0, -1)]
    x, y = cx, cy
    steps_in_direction = 1
    direction_index = 0
    steps_taken = 0
    direction_changes = 0

    for _ in range(count - 1):
        dx, dy = directions[direction_index]
        x += dx * spacing
        y += dy * spacing
        positions.append({"x": x, "y": y})

        steps_taken += 1
        if steps_taken == steps_in_direction:
            steps_taken = 0
            direction_index = (direction_index + 1) % 4
            direction_changes += 1
            if direction_changes % 2 == 0:
                steps_in_direction += 1

    return positions


def derive_npc_avatar_appearance(
    *,
    name: str,
    creature_type: str,
    explicit_appearance: str = "",
    toc: Sequence[Mapping[str, Any]] | None = None,
) -> str:
    """Build the appearance text used for NPC avatar generation."""
    if explicit_appearance:
        return explicit_appearance

    toc_appearance = search_character_appearance_in_toc(name, toc)
    if toc_appearance:
        return toc_appearance

    if any(keyword in creature_type for keyword in ("类人生物", "人类", "精灵", "矮人", "半身人", "半兽人")):
        race = "人类"
        for hint, mapped_race in _HUMANOID_RACE_HINTS:
            if hint in creature_type:
                race = mapped_race
                break
        return f"{name}，一个{race}角色，D&D奇幻风格肖像"

    npc_type = creature_type or "未知生物"
    return f"{name}，{npc_type}，D&D奇幻风格"


def split_combined_shop_items(items_list: Sequence[Mapping[str, Any]] | None) -> list[dict[str, Any]]:
    """Split bundled weapon+ammo entries into separate item records."""
    result: list[dict[str, Any]] = []
    for item in items_list or []:
        if not isinstance(item, Mapping):
            continue

        normalized_item = dict(item)
        name = str(normalized_item.get("name", "") or "")
        matched = False

        for pattern, ammo_name in _COMBINED_ITEM_PATTERNS:
            match = re.match(pattern, name)
            if not match:
                continue

            result.append({**normalized_item, "name": match.group(1).strip()})
            result.append(
                {
                    "name": ammo_name,
                    "quantity": normalized_item.get("quantity", 5),
                    "price_gp": 1,
                }
            )
            matched = True
            break

        if not matched:
            result.append(normalized_item)

    return result


def extract_armor_class(preset: Mapping[str, Any]) -> dict[str, Any] | None:
    """Extract armor class from preset equipment data."""
    ac_formula = preset.get("acFormula")
    if not isinstance(ac_formula, Mapping):
        return None

    dex_mod = ac_formula.get("dexModifier", "none")
    return {
        "base": ac_formula.get("base", 10),
        "dex_bonus": dex_mod != "none",
        "max_dex_bonus": 2 if dex_mod == "max2" else None,
    }


def extract_range(preset: Mapping[str, Any]) -> dict[str, Any] | None:
    """Extract weapon range from preset equipment data."""
    range_val = preset.get("range")
    if not range_val:
        return None

    if isinstance(range_val, str) and "/" in range_val:
        normal, long = range_val.split("/", 1)
        return {"normal": int(normal), "long": int(long)}
    if isinstance(range_val, Mapping):
        return dict(range_val)
    return None


def create_item_from_data(
    campaign_id: int,
    item_data: Mapping[str, Any],
    preset: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build Item model kwargs from mixed request/module/preset data."""
    item_name = item_data.get("name", "")

    price_gp = item_data.get("price_gp")
    if price_gp is None and preset:
        if preset.get("costCopper"):
            price_gp = preset["costCopper"] / 100
        elif isinstance(preset.get("cost"), Mapping) and preset["cost"].get("gp"):
            price_gp = preset["cost"]["gp"]
    if price_gp is None:
        price_gp = 10

    damage = item_data.get("damage")
    if not damage and preset and preset.get("damage"):
        damage = {"dice": preset.get("damage"), "type": preset.get("damageType")}

    armor_class = item_data.get("armor_class")
    if not armor_class and preset:
        armor_class = extract_armor_class(preset)

    range_data = item_data.get("range")
    if not range_data and preset:
        range_data = extract_range(preset)

    properties = item_data.get("properties")
    if properties is None and preset:
        properties = preset.get("properties", [])
    if properties is None:
        properties = []

    return {
        "campaign_id": campaign_id,
        "name": preset.get("nameEn", item_name) if preset else item_name,
        "name_cn": item_data.get("name_cn") or (preset.get("name") if preset else item_name),
        "category": item_data.get("category") or (preset.get("category", "gear") if preset else "gear"),
        "subcategory": item_data.get("subcategory") or (preset.get("subcategory") if preset else None),
        "rarity": item_data.get("rarity", "common"),
        "cost": item_data.get("cost") or {"amount": price_gp, "unit": "gp"},
        "weight": item_data.get("weight") or (preset.get("weight") if preset else None),
        "description": item_data.get("description") or (preset.get("description", item_name) if preset else item_name),
        "damage": damage,
        "properties": properties,
        "is_custom": False if preset else (not item_data.get("source_module")),
        "armor_class": armor_class,
        "strength_requirement": item_data.get("strength_requirement") or (preset.get("strengthRequired") if preset else None),
        "stealth_disadvantage": (
            item_data.get("stealth_disadvantage")
            if item_data.get("stealth_disadvantage") is not None
            else (preset.get("stealthDisadvantage", False) if preset else False)
        ),
        "range": range_data,
        "requires_attunement": item_data.get("requires_attunement", False),
        "source_module": item_data.get("source_module"),
        "magic_bonus": item_data.get("magic_bonus"),
        "extra_damage": item_data.get("extra_damage"),
        "abilities": item_data.get("abilities"),
        "charges": item_data.get("charges"),
        "item_spells": item_data.get("item_spells"),
        "attunement_by": item_data.get("attunement_by"),
    }


def build_monster_token_payload(token: Any, monster: Any | None) -> dict[str, Any]:
    """Build a canonical token payload for monster/NPC placement events."""
    payload: dict[str, Any] = {
        "id": getattr(token, "id", None),
        "campaign_id": getattr(token, "campaign_id", None),
        "character_id": getattr(token, "character_id", None),
        "monster_instance_id": getattr(token, "monster_instance_id", None),
        "item_data": getattr(token, "item_data", None),
        "item_quantity": getattr(token, "item_quantity", None),
        "shop_id": getattr(token, "shop_id", None),
        "user_id": getattr(token, "user_id", None),
        "map_url": getattr(token, "map_url", None),
        "position_x": getattr(token, "position_x", None),
        "position_y": getattr(token, "position_y", None),
        "token_size": getattr(token, "token_size", None),
        "instance_name": getattr(token, "instance_name", None),
        "current_hp": getattr(token, "current_hp", None),
        "monster_name": getattr(monster, "name", None),
        "monster_name_cn": getattr(monster, "name_cn", None),
        "monster_type": getattr(monster, "type", None),
        "monster_size": getattr(monster, "size", None),
        "avatar": getattr(monster, "avatar_url", None),
        "avatar_large": getattr(monster, "avatar_url_large", None),
        "monster_avatar_url": getattr(monster, "avatar_url", None),
        "max_hp": getattr(monster, "hit_points", 10) if monster else 10,
    }

    faction = getattr(token, "faction", None)
    if faction is not None:
        payload["faction"] = faction

    return payload


def build_encounter_creation_message(monster_count: int, has_tokens: bool) -> str:
    location = "到地图上" if has_tokens else "到资源库"
    return f"已添加 {monster_count} 个怪物{location}"
