from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.token import Token
from app.schemas.combat import (
    AbilityCheckParticipant,
    AbilityCheckRequest,
    AbilityCheckResult,
    ContestRequest,
    ContestResult,
    DiceRoll,
)
from app.services.combat_check_service import (
    build_ability_check_chat_meta,
    build_ability_check_combat_log,
    build_ability_check_narrative,
    build_ability_check_result,
    build_contest_chat_meta,
    build_contest_combat_log,
    build_contest_narrative,
    build_contest_result,
    resolve_check_display_name,
)
from app.services.runtime_schema_service import (
    normalize_character_status_effects,
    normalize_token_active_effects,
)
from app.services.spell_runtime_service import get_token_runtime_modifier_effects
from app.utils.ability_checks import (
    ABILITY_NAMES_CN as ABILITY_NAMES_CN_UTIL,
    SKILL_ABILITIES,
    calc_ability_check_modifier,
    check_advantage_on_ability_check,
    get_skill_ability,
)
from app.utils.armor_proficiency import check_armor_proficiency_penalty


def _safe_flag_modified(instance: Any, attr: str) -> None:
    try:
        flag_modified(instance, attr)
    except Exception:
        return


@dataclass(frozen=True)
class AbilityCheckExecution:
    result: AbilityCheckResult
    combat_content: str
    chat_meta: dict[str, Any]


@dataclass(frozen=True)
class ContestEffectUpdate:
    token_id: int
    active_effects: list[dict[str, Any]]
    reason: str
    monster_instance_id: Optional[int] = None
    monster_status_effects: Optional[dict[str, Any]] = None
    character_id: Optional[int] = None
    character_status_effects: Optional[dict[str, Any]] = None


@dataclass(frozen=True)
class ContestExecution:
    result: ContestResult
    combat_content: str
    chat_meta: dict[str, Any]
    effect_update: Optional[ContestEffectUpdate]


async def _build_check_roll(
    *,
    db: AsyncSession,
    campaign_id: int,
    participant: AbilityCheckParticipant,
    check_type: str,
    inspiration_die: str | None = None,
    use_lucky: bool = False,
    portent_value: int | None = None,
) -> dict[str, Any]:
    check_type_lower = check_type.lower()
    is_skill_check = check_type_lower in SKILL_ABILITIES

    if participant.check_modifier_override is not None:
        check_mod = participant.check_modifier_override
        ability_used = get_skill_ability(check_type) if is_skill_check else check_type_lower
    else:
        ability_scores_dict = {
            "strength": participant.ability_scores.strength,
            "dexterity": participant.ability_scores.dexterity,
            "constitution": participant.ability_scores.constitution,
            "intelligence": participant.ability_scores.intelligence,
            "wisdom": participant.ability_scores.wisdom,
            "charisma": participant.ability_scores.charisma,
        }
        is_proficient = False
        has_expertise = False
        if is_skill_check:
            if participant.proficient_skills:
                is_proficient = check_type_lower in [skill.lower() for skill in participant.proficient_skills]
            if participant.expertise_skills:
                has_expertise = check_type_lower in [skill.lower() for skill in participant.expertise_skills]

        check_details = calc_ability_check_modifier(
            ability_scores=ability_scores_dict,
            check_type=check_type,
            skill=check_type if is_skill_check else None,
            is_proficient=is_proficient,
            has_expertise=has_expertise,
            level=participant.level,
            proficiency_bonus=participant.proficiency_bonus,
        )
        check_mod = check_details["total"]
        ability_used = check_details["ability"]

    token = await db.get(Token, participant.token_id) if participant.token_id else None
    active_effects = list(token.active_effects or []) if token else []
    if token and participant.token_id:
        active_effects.extend(
            await get_token_runtime_modifier_effects(
                db,
                campaign_id=campaign_id,
                token_id=participant.token_id,
            )
        )

    armor_non_proficient = False
    if participant.character_id:
        character = await db.get(Character, participant.character_id)
        if character:
            armor_non_proficient = check_armor_proficiency_penalty(character)["has_penalty"]

    adv_disadv = check_advantage_on_ability_check(
        ability=ability_used,
        skill=check_type if is_skill_check else None,
        active_effects=active_effects,
        armor_non_proficient=armor_non_proficient,
    )

    advantage = adv_disadv["advantage"]
    disadvantage = adv_disadv["disadvantage"]
    reasons = adv_disadv.get("reasons", [])
    # Numeric ability-check bonus from active effects (e.g. Guidance +1d4),
    # evaluated once inside check_advantage_on_ability_check so the value matches
    # its reason string. Previously surfaced in `reasons` but never added.
    effect_check_bonus = adv_disadv.get("bonus", 0)

    # Portent: replace d20 with stored value
    portent_used = False
    if portent_value is not None:
        d20_roll = portent_value
        rolls = [d20_roll]
        portent_used = True
    elif advantage and not disadvantage:
        roll1 = random.randint(1, 20)
        roll2 = random.randint(1, 20)
        d20_roll = max(roll1, roll2)
        rolls = [roll1, roll2]
    elif disadvantage and not advantage:
        roll1 = random.randint(1, 20)
        roll2 = random.randint(1, 20)
        d20_roll = min(roll1, roll2)
        rolls = [roll1, roll2]
    else:
        d20_roll = random.randint(1, 20)
        rolls = [d20_roll]

    # Halfling Lucky: reroll natural 1 on ability check
    halfling_lucky_reroll = False
    if d20_roll == 1 and participant.character_id:
        character = await db.get(Character, participant.character_id)
        if character:
            from app.utils.race_effects import check_lucky
            if check_lucky(character.subrace_id or character.race_id or ''):
                d20_roll = random.randint(1, 20)
                rolls.append(d20_roll)
                halfling_lucky_reroll = True

    # Lucky feat: roll extra d20, pick best
    if use_lucky:
        extra_d20 = random.randint(1, 20)
        rolls.append(extra_d20)
        d20_roll = max(d20_roll, extra_d20)

    # Bardic Inspiration: add inspiration die to check
    inspiration_value = 0
    if inspiration_die:
        import re
        die_match = re.match(r'd(\d+)', inspiration_die.lower())
        if die_match:
            insp_die_size = int(die_match.group(1))
            inspiration_value = random.randint(1, insp_die_size)

    total = d20_roll + check_mod + inspiration_value + effect_check_bonus
    return {
        "ability_used": ability_used,
        "check_modifier": check_mod,
        "check_roll": DiceRoll(
            dice="1d20" if len(rolls) == 1 else "2d20",
            rolls=rolls,
            modifier=check_mod,
            total=total,
        ),
        "check_total": total,
        "had_advantage": advantage and not disadvantage,
        "had_disadvantage": disadvantage and not advantage,
        "advantage_reasons": reasons,
        "check_type": check_type,
        "is_skill_check": is_skill_check,
    }


async def resolve_ability_check(
    *,
    db: AsyncSession,
    request: AbilityCheckRequest,
) -> AbilityCheckExecution:
    participant = request.participant
    check_roll_data = await _build_check_roll(
        db=db,
        campaign_id=request.campaign_id,
        participant=participant,
        check_type=request.check_type,
        inspiration_die=request.inspiration_die,
        use_lucky=request.use_lucky,
        portent_value=request.portent_value,
    )

    success = None if request.dc is None else check_roll_data["check_total"] >= request.dc
    ability_used = check_roll_data["ability_used"]
    check_name = resolve_check_display_name(request.check_type, check_roll_data["is_skill_check"])
    ability_cn = ABILITY_NAMES_CN_UTIL.get(ability_used, ability_used)

    narrative = build_ability_check_narrative(
        participant_name=participant.name,
        check_name=check_name,
        check_total=check_roll_data["check_total"],
        dc=request.dc,
        success=success,
        description=request.description,
    )

    result = build_ability_check_result(
        participant_name=participant.name,
        participant_token_id=participant.token_id,
        check_type=request.check_type,
        ability_used=ability_used,
        check_roll=check_roll_data["check_roll"],
        check_modifier=check_roll_data["check_modifier"],
        check_total=check_roll_data["check_total"],
        had_advantage=check_roll_data["had_advantage"],
        had_disadvantage=check_roll_data["had_disadvantage"],
        advantage_reasons=check_roll_data["advantage_reasons"],
        dc=request.dc,
        success=success,
        narrative=narrative,
    )

    combat_content = build_ability_check_combat_log(
        participant_name=participant.name,
        check_name=check_name,
        ability_cn=ability_cn,
        rolls=check_roll_data["check_roll"].rolls,
        check_modifier=check_roll_data["check_modifier"],
        check_total=check_roll_data["check_total"],
        dc=request.dc,
        success=success,
        had_advantage=check_roll_data["had_advantage"],
        had_disadvantage=check_roll_data["had_disadvantage"],
        advantage_reasons=check_roll_data["advantage_reasons"],
        narrative=narrative,
    )

    chat_meta = build_ability_check_chat_meta(
        participant_name=participant.name,
        participant_token_id=participant.token_id,
        check_type=request.check_type,
        ability_used=ability_used,
        check_total=check_roll_data["check_total"],
        dc=request.dc,
        success=success,
        had_advantage=check_roll_data["had_advantage"],
        had_disadvantage=check_roll_data["had_disadvantage"],
        check_roll=check_roll_data["check_roll"],
    )

    return AbilityCheckExecution(
        result=result,
        combat_content=combat_content,
        chat_meta=chat_meta,
    )


async def resolve_contest(
    *,
    db: AsyncSession,
    request: ContestRequest,
) -> ContestExecution:
    if request.contest_type in {"grapple", "shove"}:
        attacker_check = request.attacker_check_type or "athletics"
        defender_check = request.defender_check_type or "athletics"
    else:
        attacker_check = request.attacker_check_type or "strength"
        defender_check = request.defender_check_type or "strength"

    attacker_result = await _build_check_roll(
        db=db,
        campaign_id=request.campaign_id,
        participant=request.attacker,
        check_type=attacker_check,
    )
    defender_result = await _build_check_roll(
        db=db,
        campaign_id=request.campaign_id,
        participant=request.defender,
        check_type=defender_check,
    )

    if request.contest_type == "grapple" and request.attacker.character_id:
        grappler_char = await db.get(Character, request.attacker.character_id)
        if grappler_char and grappler_char.feats:
            grappler_ids = [
                feat if isinstance(feat, str) else (feat.get("value") or feat.get("id", ""))
                for feat in grappler_char.feats
            ]
            if "grappler" in grappler_ids and not attacker_result["had_advantage"]:
                roll2 = random.randint(1, 20)
                original_d20 = attacker_result["check_roll"].rolls[0]
                if roll2 > original_d20:
                    new_total = roll2 + attacker_result["check_modifier"]
                    attacker_result["check_roll"] = DiceRoll(
                        dice="2d20",
                        rolls=[original_d20, roll2],
                        modifier=attacker_result["check_modifier"],
                        total=new_total,
                    )
                    attacker_result["check_total"] = new_total
                    attacker_result["had_advantage"] = True
                    attacker_result["advantage_reasons"] = list(attacker_result.get("advantage_reasons", [])) + [
                        "擒抱者专长: 优势"
                    ]

    tie = attacker_result["check_total"] == defender_result["check_total"]
    attacker_wins = attacker_result["check_total"] > defender_result["check_total"]

    effect_applied = None
    if attacker_wins:
        if request.contest_type == "grapple":
            effect_applied = "grappled"
        elif request.contest_type == "shove":
            effect_applied = "prone" if (request.shove_effect or "prone") == "prone" else "pushed_5ft"

    narrative = build_contest_narrative(
        contest_type=request.contest_type,
        attacker_name=request.attacker.name,
        defender_name=request.defender.name,
        attacker_wins=attacker_wins,
        tie=tie,
        effect_applied=effect_applied,
        description=request.description,
    )

    result = build_contest_result(
        contest_type=request.contest_type,
        attacker_name=request.attacker.name,
        attacker_token_id=request.attacker.token_id,
        attacker_check_type=attacker_check,
        attacker_roll=attacker_result["check_roll"],
        attacker_modifier=attacker_result["check_modifier"],
        attacker_total=attacker_result["check_total"],
        attacker_had_advantage=attacker_result["had_advantage"],
        attacker_had_disadvantage=attacker_result["had_disadvantage"],
        attacker_advantage_reasons=attacker_result["advantage_reasons"],
        defender_name=request.defender.name,
        defender_token_id=request.defender.token_id,
        defender_check_type=defender_check,
        defender_roll=defender_result["check_roll"],
        defender_modifier=defender_result["check_modifier"],
        defender_total=defender_result["check_total"],
        defender_had_advantage=defender_result["had_advantage"],
        defender_had_disadvantage=defender_result["had_disadvantage"],
        defender_advantage_reasons=defender_result["advantage_reasons"],
        attacker_wins=attacker_wins,
        tie=tie,
        effect_applied=effect_applied,
        narrative=narrative,
    )

    effect_update: Optional[ContestEffectUpdate] = None
    defender_token = None
    if attacker_wins and effect_applied in {"grappled", "prone"}:
        cond_entry = {
            "condition": effect_applied,
            "duration": {"type": "permanent", "value": 0, "remaining": 0, "v": 2},
            "source": {"type": "ability", "name": request.attacker.name},
            "removal": {"type": "manual"},
        }
        defender_token = await db.get(Token, request.defender.token_id)
        if defender_token:
            if effect_applied == "grappled":
                atk_strength = getattr(request.attacker.ability_scores, "strength", 10)
                atk_strength_mod = (atk_strength - 10) // 2
                atk_athletics_mod = atk_strength_mod
                if request.attacker.proficient_skills and "athletics" in [
                    skill.lower() for skill in request.attacker.proficient_skills
                ]:
                    atk_athletics_mod += request.attacker.proficiency_bonus
                escape_dc = 10 + atk_athletics_mod
                grapple_effect = {
                    "id": f"grapple_{request.attacker.token_id}_{int(datetime.utcnow().timestamp())}",
                    "name": f"擒抱 ({request.attacker.name})",
                    "condition": "grappled",
                    "icon": "🤼",
                    "color": "#f59e0b",
                    "source": request.attacker.name,
                    "sourceTokenId": request.attacker.token_id,
                    "escapeHint": f"使用动作尝试挣脱 (DC {escape_dc}，运动或杂技取高)",
                    "appliedAt": datetime.utcnow().isoformat(),
                    "escape_action": {
                        "type": "check",
                        "ability": "athletics_or_acrobatics",
                        "dc": escape_dc,
                    },
                }
                effects = list(normalize_token_active_effects(defender_token.active_effects, strict=False) or [])
                effects.append(grapple_effect)
                defender_token.active_effects = normalize_token_active_effects(effects, strict=True)
                _safe_flag_modified(defender_token, "active_effects")

            if defender_token.monster_instance_id:
                monster = await db.get(MonsterInstance, defender_token.monster_instance_id)
                if monster:
                    status = dict(monster.status_effects or {})
                    conditions = list(status.get("conditions", []))
                    if not any(condition.get("condition") == effect_applied for condition in conditions):
                        conditions.append(cond_entry)
                        status["conditions"] = conditions
                        monster.status_effects = status
                        _safe_flag_modified(monster, "status_effects")
                    effect_update = ContestEffectUpdate(
                        token_id=request.defender.token_id,
                        active_effects=defender_token.active_effects or [],
                        reason=f"contest:{request.contest_type}",
                        monster_instance_id=monster.id,
                        monster_status_effects=monster.status_effects,
                    )
            elif defender_token.character_id:
                character = await db.get(Character, defender_token.character_id)
                if character:
                    status = dict(normalize_character_status_effects(character.status_effects, strict=False) or {})
                    conditions = list(status.get("active_conditions", []))
                    if not any(condition.get("condition") == effect_applied for condition in conditions):
                        conditions.append(cond_entry)
                        status["active_conditions"] = conditions
                        character.status_effects = normalize_character_status_effects(status, strict=True)
                        _safe_flag_modified(character, "status_effects")
                    effect_update = ContestEffectUpdate(
                        token_id=request.defender.token_id,
                        active_effects=defender_token.active_effects or [],
                        reason=f"contest:{request.contest_type}",
                        character_id=character.id,
                        character_status_effects=character.status_effects,
                    )

    await db.commit()

    combat_content = build_contest_combat_log(
        contest_type=request.contest_type,
        attacker_name=request.attacker.name,
        attacker_check_type=attacker_check,
        attacker_roll=attacker_result["check_roll"],
        attacker_modifier=attacker_result["check_modifier"],
        attacker_total=attacker_result["check_total"],
        attacker_had_advantage=attacker_result["had_advantage"],
        attacker_had_disadvantage=attacker_result["had_disadvantage"],
        attacker_advantage_reasons=attacker_result["advantage_reasons"],
        defender_name=request.defender.name,
        defender_check_type=defender_check,
        defender_roll=defender_result["check_roll"],
        defender_modifier=defender_result["check_modifier"],
        defender_total=defender_result["check_total"],
        defender_had_advantage=defender_result["had_advantage"],
        defender_had_disadvantage=defender_result["had_disadvantage"],
        defender_advantage_reasons=defender_result["advantage_reasons"],
        attacker_wins=attacker_wins,
        tie=tie,
        effect_applied=effect_applied,
        narrative=narrative,
    )
    chat_meta = build_contest_chat_meta(
        contest_type=request.contest_type,
        attacker_name=request.attacker.name,
        attacker_token_id=request.attacker.token_id,
        defender_name=request.defender.name,
        defender_token_id=request.defender.token_id,
        attacker_total=attacker_result["check_total"],
        defender_total=defender_result["check_total"],
        attacker_wins=attacker_wins,
        tie=tie,
        effect_applied=effect_applied,
        attacker_roll=attacker_result["check_roll"],
        defender_roll=defender_result["check_roll"],
        attacker_advantage_reasons=attacker_result["advantage_reasons"],
        defender_advantage_reasons=defender_result["advantage_reasons"],
    )

    return ContestExecution(
        result=result,
        combat_content=combat_content,
        chat_meta=chat_meta,
        effect_update=effect_update,
    )
