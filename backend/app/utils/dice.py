import random
import re
from typing import Dict, List, Tuple, Optional, Iterable, Set, Any
from app.utils.rules_cache import (
    get_races_data,
    get_classes_data,
    get_backgrounds_data,
    get_equipment_data,
    get_skills_data,
)


def _load_races_data():
    """Load races data from cache."""
    return get_races_data()


def _load_classes_data():
    """Load classes data from cache."""
    return get_classes_data()


def _load_backgrounds_data():
    """Load backgrounds data from cache."""
    return get_backgrounds_data()


def _load_equipment_data():
    """Load equipment data from cache."""
    return get_equipment_data()


def _load_skills_data():
    """Load skills data from cache."""
    return get_skills_data()


ABILITY_LIST = [
    "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"
]

ABILITY_NAME_CN = {
    "strength": "力量",
    "dexterity": "敏捷",
    "constitution": "体质",
    "intelligence": "智力",
    "wisdom": "感知",
    "charisma": "魅力",
}

SKILL_TO_ABILITY = {
    # STR
    "athletics": "strength",
    # DEX
    "acrobatics": "dexterity",
    "sleight_of_hand": "dexterity",
    "stealth": "dexterity",
    # INT
    "arcana": "intelligence",
    "history": "intelligence",
    "investigation": "intelligence",
    "nature": "intelligence",
    "religion": "intelligence",
    # WIS
    "animal_handling": "wisdom",
    "insight": "wisdom",
    "medicine": "wisdom",
    "perception": "wisdom",
    "survival": "wisdom",
    # CHA
    "deception": "charisma",
    "intimidation": "charisma",
    "performance": "charisma",
    "persuasion": "charisma",
}

DICE_RE = re.compile(r"^(\d*)d(\d+)([+\-]\d+)?$", re.IGNORECASE)

TOOL_SYNONYMS = {
    "navigator_tools": "navigators_tools",
    "poisoner_kit": "poisoners_kit",
    "poisoner_tools": "poisoners_kit",
}

TOOL_GENERIC_LABELS = {
    "artisan_tools": "工匠工具",
    "artisans_tools": "工匠工具",
    "musical_instrument": "乐器",
    "gaming_set": "游戏套装",
    "vehicles_land": "陆上载具",
    "vehicles_water": "水上载具",
}

TOOL_CATEGORY_GRANTS = {
    "artisansTools": {"artisan_tools", "artisans_tools"},
    "musicalInstruments": {"musical_instrument"},
    "gamingSets": {"gaming_set"},
}


def normalize_tool_id(tool_id: Optional[str]) -> str:
    if not tool_id:
        return ""
    normalized = str(tool_id).strip().lower().replace("-", "_").replace(" ", "_")
    return TOOL_SYNONYMS.get(normalized, normalized)


def _skill_id_set() -> Set[str]:
    return {
        str(skill.get("id")).strip().lower()
        for skill in (_load_skills_data().get("skills", []) or [])
        if skill.get("id")
    }


def _iter_choice_tool_values(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
        return
    if isinstance(value, list):
        for item in value:
            yield from _iter_choice_tool_values(item)
        return
    if isinstance(value, dict):
        for nested in value.values():
            yield from _iter_choice_tool_values(nested)


def _levelled_feature_groups(entity: Dict[str, Any], level: int) -> Iterable[Dict[str, Any]]:
    if not isinstance(entity, dict):
        return []
    groups: List[Dict[str, Any]] = []
    for key, value in entity.items():
        if not key.startswith("level") or not key.endswith("Features"):
            continue
        level_str = key[5:-8]
        try:
            feature_level = int(level_str)
        except (TypeError, ValueError):
            continue
        if feature_level <= level and isinstance(value, list):
            groups.extend(item for item in value if isinstance(item, dict))
    return groups


def _tool_grants_for_tool(tool_id: str) -> Set[str]:
    normalized = normalize_tool_id(tool_id)
    grants = {normalized} if normalized else set()
    equipment_data = _load_equipment_data()
    tools_data = equipment_data.get("tools", {}) if isinstance(equipment_data, dict) else {}
    for category_key, items in tools_data.items():
        if not isinstance(items, list):
            continue
        if any(normalize_tool_id(item.get("id")) == normalized for item in items if isinstance(item, dict)):
            grants.update(TOOL_CATEGORY_GRANTS.get(category_key, set()))
    return grants


def has_tool_proficiency(tool_ids: Iterable[str], tool_id: str) -> bool:
    normalized_tool_id = normalize_tool_id(tool_id)
    if not normalized_tool_id:
        return False
    known = {normalize_tool_id(value) for value in (tool_ids or []) if normalize_tool_id(value)}
    if normalized_tool_id in known:
        return True
    return any(grant in known for grant in _tool_grants_for_tool(normalized_tool_id))


def get_tool_display_name(tool_id: Optional[str]) -> str:
    normalized = normalize_tool_id(tool_id)
    if not normalized:
        return ""
    equipment_data = _load_equipment_data()
    tools_data = equipment_data.get("tools", {}) if isinstance(equipment_data, dict) else {}
    for items in tools_data.values():
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict) and normalize_tool_id(item.get("id")) == normalized:
                return item.get("name") or normalized
    return TOOL_GENERIC_LABELS.get(normalized, normalized)


def collect_character_skill_proficiencies(character: Dict[str, Any]) -> List[str]:
    level = int(character.get("level") or 1)
    skill_ids = _skill_id_set()
    profs: Set[str] = set()

    def add(values: Optional[Iterable[str]]) -> None:
        for value in values or []:
            normalized = str(value).strip().lower().replace(" ", "_")
            if normalized in skill_ids:
                profs.add(normalized)

    add(character.get("selected_skills") or [])
    add((character.get("race_choices") or {}).get("skills") or [])
    add((character.get("subclass_choices") or {}).get("skills") or [])
    add((character.get("subclass_choices") or {}).get("skill") or [])

    background_id = character.get("background_id")
    if background_id:
        for bg in (_load_backgrounds_data().get("backgrounds", []) or []):
            if bg.get("id") == background_id:
                add(bg.get("skillProficiencies") or [])
                break

    race_id = character.get("race_id")
    subrace_id = character.get("subrace_id")
    for race in (_load_races_data().get("races", []) or []):
        if race.get("id") != race_id:
            continue
        race_traits = list(race.get("traits", []) or [])
        subrace = next((sr for sr in (race.get("subraces", []) or []) if sr.get("id") == subrace_id), None)
        if subrace:
            race_traits.extend(subrace.get("traits", []) or [])
        for trait in race_traits:
            if not isinstance(trait, dict):
                continue
            add(trait.get("skillProficiencies") or [])
            add((trait.get("structuredData") or {}).get("skillProficiencies") or [])
        break

    class_id = character.get("class_id")
    subclass_id = character.get("subclass_id")
    for char_class in (_load_classes_data().get("classes", []) or []):
        if char_class.get("id") != class_id:
            continue
        subclass = next((sc for sc in (char_class.get("subclasses", []) or []) if sc.get("id") == subclass_id), None)
        for feature in _levelled_feature_groups(subclass or {}, level):
            add((feature.get("structuredData") or {}).get("skillProficiencies") or [])
        break

    feat_choices = character.get("feat_choices") or {}
    skilled_choices = ((feat_choices.get("skilled") or {}).get("skills") or [])
    add(value for value in skilled_choices if str(value).strip().lower().replace(" ", "_") in skill_ids)

    special_buffs = ((character.get("status_effects") or {}).get("special_buffs") or {})
    add(special_buffs.get("temporary_skill_proficiencies") or [])
    add(special_buffs.get("granted_skill_proficiencies") or [])
    add(special_buffs.get("skill_proficiencies") or [])

    return sorted(profs)


def collect_character_tool_proficiencies(character: Dict[str, Any]) -> List[str]:
    level = int(character.get("level") or 1)
    skill_ids = _skill_id_set()
    profs: Set[str] = set()

    def add(values: Optional[Iterable[str]]) -> None:
        for value in values or []:
            normalized = normalize_tool_id(value)
            if normalized:
                profs.add(normalized)

    class_id = character.get("class_id")
    subclass_id = character.get("subclass_id")
    for char_class in (_load_classes_data().get("classes", []) or []):
        if char_class.get("id") != class_id:
            continue
        add(((char_class.get("proficiencies") or {}).get("tools") or []))
        subclass = next((sc for sc in (char_class.get("subclasses", []) or []) if sc.get("id") == subclass_id), None)
        for feature in _levelled_feature_groups(subclass or {}, level):
            add(feature.get("toolProficiencies") or [])
            add((feature.get("structuredData") or {}).get("toolProficiencies") or [])
        break

    background_id = character.get("background_id")
    if background_id:
        for bg in (_load_backgrounds_data().get("backgrounds", []) or []):
            if bg.get("id") == background_id:
                add(bg.get("toolProficiencies") or [])
                break

    race_id = character.get("race_id")
    subrace_id = character.get("subrace_id")
    for race in (_load_races_data().get("races", []) or []):
        if race.get("id") != race_id:
            continue
        race_traits = list(race.get("traits", []) or [])
        subrace = next((sr for sr in (race.get("subraces", []) or []) if sr.get("id") == subrace_id), None)
        if subrace:
            race_traits.extend(subrace.get("traits", []) or [])
        for trait in race_traits:
            if not isinstance(trait, dict):
                continue
            add(trait.get("toolProficiencies") or [])
            add((trait.get("structuredData") or {}).get("toolProficiencies") or [])
        break

    for key in ("tool", "tools", "toolProficiency", "toolProficiencies"):
        yield_values = (character.get("race_choices") or {}).get(key)
        add(_iter_choice_tool_values(yield_values))
        yield_values = (character.get("subclass_choices") or {}).get(key)
        add(_iter_choice_tool_values(yield_values))

    feat_choices = character.get("feat_choices") or {}
    skilled_choices = ((feat_choices.get("skilled") or {}).get("skills") or [])
    add(value for value in skilled_choices if str(value).strip().lower().replace(" ", "_") not in skill_ids)

    special_buffs = ((character.get("status_effects") or {}).get("special_buffs") or {})
    add(special_buffs.get("temporary_tool_proficiencies") or [])
    add(special_buffs.get("granted_tool_proficiencies") or [])
    add(special_buffs.get("tool_proficiencies") or [])

    return sorted(profs)


def parse_dice_expression(expr: str) -> Tuple[int, int, int]:
    """Parse dice expression like '1d20+5' into (count, sides, modifier).
    Defaults count=1 if omitted.
    """
    expr = expr.strip().lower()
    m = DICE_RE.match(expr)
    if not m:
        raise ValueError(f"Invalid dice expression: {expr}")
    count = int(m.group(1)) if m.group(1) else 1
    sides = int(m.group(2))
    modifier = int(m.group(3) or 0)
    return count, sides, modifier


def roll_dice(count: int, sides: int) -> List[int]:
    return [random.randint(1, sides) for _ in range(count)]


def format_expression(count: int, sides: int, modifier: int) -> str:
    s = f"{count}d{sides}"
    if modifier:
        s += ("+" if modifier > 0 else "") + str(modifier)
    return s


def ability_modifier(score: Optional[int]) -> int:
    if score is None:
        return 0
    return (int(score) - 10) // 2


def proficiency_bonus(level: Optional[int]) -> int:
    lvl = level or 1
    # Standard 5e proficiency progression
    if lvl <= 4:
        return 2
    if lvl <= 8:
        return 3
    if lvl <= 12:
        return 4
    if lvl <= 16:
        return 5
    return 6


def compute_final_ability_scores(character: dict) -> Dict[str, int]:
    """Compute final ability scores including racial bonuses.

    character should include:
    - ability_scores: base ability scores
    - race_id: race identifier
    - subrace_id: subrace identifier (optional)
    - race_choices: flexible ability score choices (optional)
    """
    base = character.get("ability_scores") or {}
    race_id = character.get("race_id")
    subrace_id = character.get("subrace_id")
    race_choices = character.get("race_choices") or {}

    # Load race data
    races_data = _load_races_data()
    race = None
    subrace = None

    for r in races_data.get("races", []):
        if r.get("id") == race_id:
            race = r
            if subrace_id:
                for sr in r.get("subraces", []):
                    if sr.get("id") == subrace_id:
                        subrace = sr
                        break
            break

    def get_bonus(ability_id: str) -> int:
        bonus = 0
        # Race bonus
        if race:
            race_inc = race.get("abilityScoreIncrease") or {}
            bonus += int(race_inc.get(ability_id) or 0)
        # Subrace bonus
        if subrace:
            subrace_inc = subrace.get("abilityScoreIncrease") or {}
            bonus += int(subrace_inc.get(ability_id) or 0)
        # Flexible ability score choices (e.g., half-elf +1 to two abilities)
        chosen_abilities = race_choices.get("abilityScores") or []
        if ability_id in chosen_abilities:
            bonus += 1
        return bonus

    def to_num(v, fallback=10):
        try:
            return int(v)
        except (TypeError, ValueError):
            return fallback

    return {
        "strength": to_num(base.get("strength"), 10) + get_bonus("strength"),
        "dexterity": to_num(base.get("dexterity"), 10) + get_bonus("dexterity"),
        "constitution": to_num(base.get("constitution"), 10) + get_bonus("constitution"),
        "intelligence": to_num(base.get("intelligence"), 10) + get_bonus("intelligence"),
        "wisdom": to_num(base.get("wisdom"), 10) + get_bonus("wisdom"),
        "charisma": to_num(base.get("charisma"), 10) + get_bonus("charisma"),
    }


def skill_modifier(character: dict, skill_id: str) -> int:
    """Compute total modifier for a given skill based on character sheet dict.
    character should include: ability_scores, selected_skills, expertise_skills, level
    """
    ability = SKILL_TO_ABILITY.get(skill_id)
    if not ability:
        return 0
    base = ability_modifier((character.get("ability_scores") or {}).get(ability))
    prof_ids = set((character.get("selected_skills") or []) or [])
    exp_ids = set((character.get("expertise_skills") or []) or [])
    prof = 0
    if skill_id in prof_ids or skill_id in exp_ids:
        pb = proficiency_bonus(character.get("level"))
        prof = pb * (2 if skill_id in exp_ids else 1)
    return base + prof


def tool_modifier(character: dict, tool_id: str, ability: str) -> int:
    normalized_tool_id = normalize_tool_id(tool_id)
    normalized_ability = str(ability or "").strip().lower()
    if normalized_ability not in ABILITY_LIST:
        normalized_ability = "dexterity"
    base = ability_modifier((character.get("ability_scores") or {}).get(normalized_ability))
    prof = proficiency_bonus(character.get("level")) if has_tool_proficiency(character.get("proficient_tools") or [], normalized_tool_id) else 0
    return base + prof


def ability_check_modifier(character: dict, ability: str) -> int:
    return ability_modifier((character.get("ability_scores") or {}).get(ability))


def add_modifier_to_expr(expr: str, mod: int) -> str:
    # Merge modifier into an existing dice expression
    c, s, m = parse_dice_expression(expr)
    total_mod = m + (mod or 0)
    return format_expression(c, s, total_mod)


def roll_expression(expr: str) -> Dict:
    c, s, m = parse_dice_expression(expr)
    rolls = roll_dice(c, s)
    total = sum(rolls) + m
    return {
        "expression": format_expression(c, s, m),
        "rolls": rolls,
        "modifier": m,
        "total": total,
        "result": total,  # compatibility field
    }


def normalize_check(check: Dict) -> Dict:
    """Normalize check dict returned by AI.
    Base shape:
    { type?: 'check'|'save'|'contest'|'tool_check', ability?: str, skill?: str, tool?: str, dc?: int,
      dice?: str, description?: str, roll_modifier?: 'advantage'|'disadvantage',
      roll_modifier_reasons?: string[],
      contest?: { attacker?: {ability?|skill?}, defender?: {ability?|skill?}, tie_rule?: str } }
    Defaults: dice='1d20', lowercased keys. Runtime metadata needed by dice execution is preserved.
    """
    out: Dict = {}
    if not isinstance(check, dict):
        return {"dice": "1d20"}

    # Type (optional)
    t = (check.get("type") or "").strip().lower()
    if t in ("check", "save", "contest", "tool_check"):
        out["type"] = t

    # Ability/Skill/DC/Dice/Description
    ability = (check.get("ability") or "").strip().lower()
    skill = (check.get("skill") or "").strip().lower()
    tool = normalize_tool_id(check.get("tool"))
    dc = check.get("dc")
    dice = (check.get("dice") or "1d20").strip().lower()
    desc = (check.get("description") or "").strip()
    roll_modifier = (check.get("roll_modifier") or "").strip().lower()
    original_message = (check.get("original_message") or "").strip()
    roll_modifier_reasons_raw = check.get("roll_modifier_reasons")
    if ability in ABILITY_LIST:
        out["ability"] = ability
    if skill in SKILL_TO_ABILITY:
        out["skill"] = skill
    if tool:
        out["tool"] = tool
    if isinstance(dc, (int, float)):
        out["dc"] = int(dc)
    out["dice"] = dice if re.match(r"^\d*d\d+(?:[+\-]\d+)?$", dice) else "1d20"
    if desc:
        out["description"] = desc
    if roll_modifier in ("advantage", "disadvantage"):
        out["roll_modifier"] = roll_modifier
    if isinstance(roll_modifier_reasons_raw, list):
        reasons = [
            str(reason).strip()
            for reason in roll_modifier_reasons_raw
            if str(reason).strip()
        ]
        if reasons:
            out["roll_modifier_reasons"] = reasons
    if original_message:
        out["original_message"] = original_message

    # Contest (optional)
    contest = check.get("contest")
    if isinstance(contest, dict):
        def _norm_party(p):
            if not isinstance(p, dict):
                return {}
            pa = (p.get("ability") or "").strip().lower()
            ps = (p.get("skill") or "").strip().lower()
            outp = {}
            if pa in ABILITY_LIST:
                outp["ability"] = pa
            if ps in SKILL_TO_ABILITY:
                outp["skill"] = ps
            return outp
        c_out = {}
        if "attacker" in contest:
            c_out["attacker"] = _norm_party(contest.get("attacker"))
        if "defender" in contest:
            c_out["defender"] = _norm_party(contest.get("defender"))
        tie_rule = (contest.get("tie_rule") or "").strip().lower() if isinstance(contest.get("tie_rule"), str) else None
        if tie_rule:
            c_out["tie_rule"] = tie_rule
        if c_out:
            out["contest"] = c_out

    return out
