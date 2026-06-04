from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class ShortRestHealing:
    hit_die: int
    con_mod: int
    heal_amount: int


@dataclass(frozen=True)
class RestResourceRestoreResult:
    class_feature_uses: dict[str, Any]
    resources_restored: list[str]
    changed: bool


def get_class_hit_die(class_id: str) -> int:
    hit_die_map = {
        "barbarian": 12,
        "fighter": 10,
        "paladin": 10,
        "ranger": 10,
        "bard": 8,
        "cleric": 8,
        "druid": 8,
        "monk": 8,
        "rogue": 8,
        "warlock": 8,
        "sorcerer": 6,
        "wizard": 6,
    }
    return hit_die_map.get(class_id, 8)


def extract_progression_ids(raw_values: list[Any] | None) -> list[str] | None:
    if not raw_values:
        return None

    return [
        (value if isinstance(value, str) else value.get("id") or value.get("value", ""))
        for value in raw_values
    ]


def build_level_history_snapshot(character: Any, feature_choices: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "level": character.level,
        "class_id": character.class_id,
        "subclass_id": character.subclass_id,
        "ability_scores": character.ability_scores.copy() if character.ability_scores else {},
        "selected_cantrips": (character.selected_cantrips or []).copy(),
        "selected_spells": (character.selected_spells or []).copy(),
        "selected_skills": (character.selected_skills or []).copy(),
        "expertise_skills": (character.expertise_skills or []).copy(),
        "fighting_style": character.fighting_style,
        "favored_enemy": character.favored_enemy,
        "favored_humanoid_races": character.favored_humanoid_races,
        "favored_terrain": character.favored_terrain,
        "eldritch_invocations": (character.eldritch_invocations or []).copy(),
        "feats": (character.feats or []).copy(),
        "feat_choices": (character.feat_choices or {}).copy(),
        "multiclass_data": character.multiclass_data.copy() if character.multiclass_data else {},
        "timestamp": datetime.utcnow().isoformat(),
        "feature_choices": feature_choices,
    }


def ensure_multiclass_data(character: Any) -> dict[str, Any]:
    multiclass_data = character.multiclass_data or {
        "classes": [],
        "level_history": [],
    }

    if not multiclass_data.get("classes"):
        multiclass_data["classes"] = [{
            "class_id": character.class_id,
            "level": character.level,
            "subclass_id": character.subclass_id,
        }]

    return multiclass_data


def apply_level_up_class_choice(
    character: Any,
    multiclass_data: dict[str, Any],
    class_choice: str,
) -> tuple[dict[str, Any], dict[str, Any], int]:
    new_level = (character.level or 1) + 1

    class_entry = next(
        (entry for entry in multiclass_data["classes"] if entry["class_id"] == class_choice),
        None,
    )
    if class_entry:
        class_entry["level"] += 1
    else:
        class_entry = {
            "class_id": class_choice,
            "level": 1,
            "subclass_id": None,
        }
        multiclass_data["classes"].append(class_entry)

    return multiclass_data, class_entry, new_level


def calculate_max_hp(character) -> int:
    con_modifier = (character.ability_scores.get("constitution", 10) - 10) // 2

    if character.multiclass_data and character.multiclass_data.get("classes"):
        total_hp = 0
        # 5e PHB multiclassing: only the VERY FIRST character level (the first class
        # entry's first level) gets the max hit die. Every other level — including the
        # first level gained in a multiclassed class — uses the average roll.
        for idx, class_entry in enumerate(character.multiclass_data["classes"]):
            class_id = class_entry["class_id"]
            class_level = class_entry["level"]
            if class_level < 1:
                continue
            hit_die = get_class_hit_die(class_id)
            avg_roll = (hit_die // 2) + 1
            if idx == 0:
                total_hp += hit_die + con_modifier
                total_hp += (avg_roll + con_modifier) * (class_level - 1)
            else:
                total_hp += (avg_roll + con_modifier) * class_level

        return max(total_hp, character.level)

    hit_die = get_class_hit_die(character.class_id)
    level = character.level
    max_hp = hit_die + con_modifier

    if level > 1:
        avg_roll = (hit_die // 2) + 1
        max_hp += (avg_roll + con_modifier) * (level - 1)

    return max(max_hp, level)


def calculate_short_rest_heal(character: Any) -> ShortRestHealing:
    hit_die = get_class_hit_die(character.class_id)
    con_mod = (character.ability_scores.get("constitution", 10) - 10) // 2
    heal_amount = max(1, (hit_die // 2) + 1 + con_mod)

    feat_ids = extract_progression_ids(character.feats or []) or []
    if "durable" in feat_ids:
        heal_amount = max(heal_amount, max(1, 2 * con_mod))

    return ShortRestHealing(
        hit_die=hit_die,
        con_mod=con_mod,
        heal_amount=heal_amount,
    )


def apply_character_rest(character: Any, *, rest_type: str, max_hp: int, short_heal: int) -> None:
    before_char_hp = character.current_hp if isinstance(getattr(character, "current_hp", None), int) else max_hp

    if rest_type == "long":
        character.current_hp = int(max_hp)
        character.can_prepare_spells = True
        return

    character.current_hp = int(min(max_hp, before_char_hp + short_heal))


def restore_pact_slots_on_short_rest(character: Any) -> bool:
    warlock_level = 0

    if character.class_id == "warlock":
        warlock_level = character.level
    elif character.multiclass_data and character.multiclass_data.get("classes"):
        for cls in character.multiclass_data["classes"]:
            if cls.get("class_id") == "warlock":
                warlock_level = cls.get("level", 0)
                break

    if warlock_level == 0:
        return False

    warlock_pact = {
        1: (1, 1), 2: (1, 2), 3: (2, 2), 4: (2, 2),
        5: (3, 2), 6: (3, 2), 7: (4, 2), 8: (4, 2),
        9: (5, 2), 10: (5, 2), 11: (5, 3), 12: (5, 3),
        13: (5, 3), 14: (5, 3), 15: (5, 3), 16: (5, 3),
        17: (5, 4), 18: (5, 4), 19: (5, 4), 20: (5, 4),
    }
    pact_level, pact_count = warlock_pact.get(warlock_level, (1, 1))

    current_state = character.spell_slots_state
    if current_state is None:
        if character.class_id == "warlock" and not character.multiclass_data:
            slots = [0] * 10
            slots[pact_level] = pact_count
            character.spell_slots_state = slots
        else:
            character.spell_slots_state = {
                "slots": [0] * 10,
                "pact_slots": [0] * 10,
                "pact_level": pact_level,
                "pact_count": pact_count,
            }
            character.spell_slots_state["pact_slots"][pact_level] = pact_count
        return True

    if isinstance(current_state, dict):
        pact_slots = [0] * 10
        pact_slots[pact_level] = pact_count
        current_state["pact_slots"] = pact_slots
        current_state["pact_level"] = pact_level
        current_state["pact_count"] = pact_count
        character.spell_slots_state = current_state
        return True

    if isinstance(current_state, list) and character.class_id == "warlock":
        slots = [0] * 10
        slots[pact_level] = pact_count
        character.spell_slots_state = slots
        return True

    return False


def restore_class_resources_for_rest(
    character: Any,
    *,
    rest_type: str,
    class_resource_service_module: Any,
) -> RestResourceRestoreResult:
    ability_scores = character.ability_scores or {}
    charisma = ability_scores.get("charisma", 10)
    wisdom = ability_scores.get("wisdom", 10)
    intelligence = ability_scores.get("intelligence", 10)
    rest_invocations = extract_progression_ids(character.eldritch_invocations or []) if character.class_id == "warlock" else None
    rest_feat_ids = extract_progression_ids(character.feats or [])

    if rest_type == "long":
        new_resource_states = class_resource_service_module.process_long_rest(
            class_id=character.class_id,
            subclass_id=character.subclass_id,
            level=character.level,
            charisma=charisma,
            wisdom=wisdom,
            intelligence=intelligence,
            character_invocations=rest_invocations,
            character_feats=rest_feat_ids,
        )
    else:
        raw_states = character.class_feature_uses or {}
        current_states = {
            resource_id: value.get("current", 0) if isinstance(value, dict) else value
            for resource_id, value in raw_states.items()
        }
        new_resource_states = class_resource_service_module.process_short_rest(
            class_id=character.class_id,
            subclass_id=character.subclass_id,
            level=character.level,
            current_states=current_states,
            charisma=charisma,
            wisdom=wisdom,
            intelligence=intelligence,
            character_invocations=rest_invocations,
            character_feats=rest_feat_ids,
        )

    class_feature_uses = dict(character.class_feature_uses or {})
    resources_restored: list[str] = []
    for resource_id, max_value in new_resource_states.items():
        if rest_type == "long":
            class_feature_uses[resource_id] = {"current": max_value, "max": max_value}
        else:
            old_value = class_feature_uses.get(resource_id, {}).get("current", 0)
            if max_value > old_value:
                class_feature_uses[resource_id] = {"current": max_value, "max": max_value}
                resources_restored.append(resource_id)

    if rest_type == "long":
        resources_restored = list(new_resource_states.keys())

    return RestResourceRestoreResult(
        class_feature_uses=class_feature_uses,
        resources_restored=resources_restored,
        changed=bool(resources_restored),
    )
