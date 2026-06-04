from __future__ import annotations

import logging
import random
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.character import Character
from app.models.chat_message import ChatMessage
from app.models.monster_instance import MonsterInstance
from app.models.token import Token
from app.services.character_progression_service import calculate_max_hp
from app.services.realtime_publisher import realtime_publisher
from app.utils.class_effects import check_is_raging, is_physical_damage
from app.utils.pending_effects import apply_pending_damage_received_effects
from app.utils.rules_cache import get_spell_by_id, spell_has_effect_type

logger = logging.getLogger(__name__)

PASSIVE_SAVE_CONDITION_ALIASES = {
    "blinded": "blinded",
    "目盲": "blinded",
    "deafened": "deafened",
    "耳聋": "deafened",
    "incapacitated": "incapacitated",
    "失能": "incapacitated",
}


@dataclass(frozen=True)
class HeavyArmorMasterResult:
    damage_after: int
    reduction: int = 0
    applied: bool = False


@dataclass(frozen=True)
class AttackDamageMitigationResult:
    total_damage: int
    damage_before_resistance: int
    rage_resistance_applied: bool = False
    pending_damage_resistance_applied: bool = False
    passive_resistance_applied: bool = False
    heavy_armor_master_reduction: int = 0
    target_active_effects_changed: bool = False
    concentration_touched_token_ids: List[int] = field(default_factory=list)


@dataclass(frozen=True)
class EffectiveHpResolution:
    effective_hp: Optional[int]
    effective_max_hp: Optional[int]


@dataclass(frozen=True)
class AttackHpPersistenceResult:
    persisted: bool
    new_hp: Optional[int]
    target_defeated: bool
    token_id: Optional[int] = None
    character_id: Optional[int] = None
    monster_instance_id: Optional[int] = None
    temp_hp: Any = None
    active_effects: Any = None


@dataclass(frozen=True)
class RelentlessEnduranceResult:
    triggered: bool
    new_hp: Optional[int]
    hp_change: Optional[int]
    target_defeated: bool


@dataclass(frozen=True)
class AttackTargetMeta:
    target_character_id: Optional[int]
    target_monster_instance_id: Optional[int]
    xp_value: int = 0


@dataclass(frozen=True)
class TokenHpChangeResult:
    new_hp: Optional[int]
    hp_change: int
    character_id: Optional[int] = None
    monster_instance_id: Optional[int] = None
    temp_hp: Any = None
    active_effects: Any = None
    target_defeated: bool = False


def resolve_thunderbolt_trigger_damage_type(
    *,
    normalize_damage_type,
    base_damage_type: Optional[str],
    base_damage: int,
    extra_damage_type: Optional[str],
    extra_damage: int,
    divine_strike_type: Optional[str],
    divine_strike_damage: int,
) -> Optional[str]:
    if normalize_damage_type(base_damage_type) == "lightning" and base_damage > 0:
        return base_damage_type
    if normalize_damage_type(extra_damage_type) == "lightning" and extra_damage > 0:
        return extra_damage_type
    if normalize_damage_type(divine_strike_type) == "lightning" and divine_strike_damage > 0:
        return divine_strike_type
    return None


def extract_passive_save_condition_ids(
    active_effects: Optional[List[Dict[str, Any]]],
) -> List[str]:
    if not active_effects:
        return []

    result: List[str] = []
    for effect in active_effects:
        for raw in (effect.get("condition"), effect.get("id")):
            normalized = PASSIVE_SAVE_CONDITION_ALIASES.get(str(raw or "").strip().lower())
            if normalized and normalized not in result:
                result.append(normalized)
    return result


def roll_save_d20(*, advantage: bool = False, disadvantage: bool = False) -> Tuple[int, List[int]]:
    if advantage and not disadvantage:
        roll1 = random.randint(1, 20)
        roll2 = random.randint(1, 20)
        return max(roll1, roll2), [roll1, roll2]
    if disadvantage and not advantage:
        roll1 = random.randint(1, 20)
        roll2 = random.randint(1, 20)
        return min(roll1, roll2), [roll1, roll2]
    roll = random.randint(1, 20)
    return roll, [roll]


def apply_heavy_armor_master(
    *,
    total_damage: int,
    damage_type: Optional[str],
    feat_ids: List[str],
    equipment: Optional[List[Dict[str, Any]]],
) -> HeavyArmorMasterResult:
    if total_damage <= 0 or "heavy_armor_master" not in feat_ids or not is_physical_damage(damage_type):
        return HeavyArmorMasterResult(damage_after=total_damage)

    wearing_heavy = any(
        item.get("type") == "heavy"
        for item in (equipment or [])
        if isinstance(item, dict) and item.get("equippedSlot") == "armor"
    )
    if not wearing_heavy:
        return HeavyArmorMasterResult(damage_after=total_damage)

    reduction = min(3, total_damage)
    return HeavyArmorMasterResult(
        damage_after=total_damage - reduction,
        reduction=reduction,
        applied=reduction > 0,
    )


async def resolve_attack_damage_mitigation(
    db: AsyncSession,
    *,
    hit: bool,
    total_damage: int,
    damage_type: Optional[str],
    target_token_id: Optional[int],
    auto_apply: bool,
) -> AttackDamageMitigationResult:
    damage_before_resistance = total_damage
    rage_resistance_applied = False
    pending_damage_resistance_applied = False
    passive_resistance_applied = False
    heavy_armor_master_reduction = 0
    target_active_effects_changed = False
    concentration_touched_token_ids: List[int] = []

    if not (hit and target_token_id):
        return AttackDamageMitigationResult(
            total_damage=total_damage,
            damage_before_resistance=damage_before_resistance,
        )

    target_token = await db.get(Token, target_token_id)
    target_character = None
    if target_token and target_token.character_id:
        target_character = await db.get(Character, target_token.character_id)

    if target_token and target_token.active_effects and check_is_raging(target_token.active_effects):
        if is_physical_damage(damage_type):
            total_damage = total_damage // 2
            rage_resistance_applied = True

    if target_token and total_damage > 0:
        pending_damage_result = await apply_pending_damage_received_effects(
            token=target_token,
            damage_amount=total_damage,
            damage_type=damage_type,
            db=db,
            resistance_already_applied=rage_resistance_applied,
            consume_effects=auto_apply,
        )
        total_damage = pending_damage_result.damage_after_effects
        pending_damage_resistance_applied = pending_damage_result.granted_resistance
        target_active_effects_changed = pending_damage_result.active_effects_changed
        concentration_touched_token_ids = pending_damage_result.concentration_touched_token_ids

    if (
        total_damage > 0
        and target_token
        and target_token.active_effects
        and damage_type
        and not rage_resistance_applied
        and not pending_damage_resistance_applied
    ):
        from app.services.effect_service import check_resistances

        has_resistance, has_immunity = check_resistances(
            target_token.active_effects,
            damage_type,
            damage_source="attack",
        )
        if has_immunity:
            total_damage = 0
            passive_resistance_applied = True
        elif has_resistance:
            total_damage = total_damage // 2
            passive_resistance_applied = True

    if total_damage > 0 and target_character:
        feat_ids = [
            feat if isinstance(feat, str) else (feat.get("value") or feat.get("id", ""))
            for feat in (target_character.feats or [])
        ]
        ham_result = apply_heavy_armor_master(
            total_damage=total_damage,
            damage_type=damage_type,
            feat_ids=feat_ids,
            equipment=target_character.equipment,
        )
        total_damage = ham_result.damage_after
        heavy_armor_master_reduction = ham_result.reduction

    if (
        total_damage > 0
        and target_character
        and target_character.class_id
        and not rage_resistance_applied
        and not pending_damage_resistance_applied
        and not passive_resistance_applied
    ):
        from app.services.passive_feature_service import get_passive_features

        passive_features = get_passive_features(
            target_character.class_id,
            target_character.level or 1,
            target_character.subclass_id,
        )
        passive_resistances = passive_features.get("resistances", [])
        if passive_resistances and damage_type:
            damage_type_lower = damage_type.lower()
            if any(
                resistance.lower() in damage_type_lower or damage_type_lower in resistance.lower()
                for resistance in passive_resistances
            ):
                total_damage = total_damage // 2
                passive_resistance_applied = True

    return AttackDamageMitigationResult(
        total_damage=total_damage,
        damage_before_resistance=damage_before_resistance,
        rage_resistance_applied=rage_resistance_applied,
        pending_damage_resistance_applied=pending_damage_resistance_applied,
        passive_resistance_applied=passive_resistance_applied,
        heavy_armor_master_reduction=heavy_armor_master_reduction,
        target_active_effects_changed=target_active_effects_changed,
        concentration_touched_token_ids=concentration_touched_token_ids,
    )


async def resolve_effective_target_hp(
    db: AsyncSession,
    *,
    request_current_hp: Optional[int],
    request_max_hp: Optional[int],
    target_token_id: Optional[int],
) -> EffectiveHpResolution:
    effective_hp = request_current_hp
    effective_max_hp = request_max_hp
    target_token = None

    if (effective_hp is None or effective_max_hp is None) and target_token_id:
        target_token = await db.get(Token, target_token_id)
        if target_token:
            transformation = target_token.transformation_data or {}
            transformed_hp = transformation.get("current_hp")
            transformed_max_hp = transformation.get("max_hp")
            if effective_hp is None and transformed_hp is not None:
                effective_hp = transformed_hp
            if effective_max_hp is None and transformed_max_hp is not None:
                effective_max_hp = transformed_max_hp

            if effective_hp is None and target_token.current_hp is not None:
                effective_hp = target_token.current_hp

            if target_token.character_id:
                character = await db.get(Character, target_token.character_id)
                if character:
                    if effective_max_hp is None:
                        effective_max_hp = calculate_max_hp(character)
                    if effective_hp is None and character.current_hp is not None:
                        effective_hp = character.current_hp
                    if effective_hp is None and effective_max_hp is not None:
                        effective_hp = effective_max_hp
            elif target_token.monster_instance_id:
                monster = await db.get(MonsterInstance, target_token.monster_instance_id)
                if monster:
                    if effective_max_hp is None and monster.hit_points:
                        effective_max_hp = monster.hit_points
                    if effective_hp is None and monster.current_hp is not None:
                        effective_hp = monster.current_hp
                    elif effective_hp is None and monster.hit_points:
                        effective_hp = monster.hit_points

    if effective_hp is None and effective_max_hp is not None:
        effective_hp = effective_max_hp

    # Active-effects 生命上限加成（如 aid 抬高生命值上限）。无 buff → +0，
    # 故未受 buff 的生物有效最大 HP 不变。
    if effective_max_hp is not None and target_token_id:
        if target_token is None:
            target_token = await db.get(Token, target_token_id)
        if target_token is not None:
            from app.services.effect_service import get_max_hp_bonus
            effective_max_hp += get_max_hp_bonus(getattr(target_token, "active_effects", None))

    return EffectiveHpResolution(
        effective_hp=effective_hp,
        effective_max_hp=effective_max_hp,
    )


async def resolve_attack_target_meta(
    db: AsyncSession,
    *,
    target_token_id: Optional[int],
    target_defeated: bool,
) -> AttackTargetMeta:
    if not target_token_id:
        return AttackTargetMeta(
            target_character_id=None,
            target_monster_instance_id=None,
            xp_value=0,
        )

    target_token = await db.get(Token, target_token_id)
    target_character_id = target_token.character_id if target_token else None
    target_monster_instance_id = target_token.monster_instance_id if target_token else None
    xp_value = 0

    if target_defeated and target_monster_instance_id:
        defeated_monster = await db.get(MonsterInstance, target_monster_instance_id)
        if defeated_monster and defeated_monster.monster_data:
            xp_value = defeated_monster.monster_data.get("xp", 0) or 0

    return AttackTargetMeta(
        target_character_id=target_character_id,
        target_monster_instance_id=target_monster_instance_id,
        xp_value=xp_value,
    )


async def restore_direct_token_hp(
    db: AsyncSession,
    *,
    target_token_id: Optional[int],
    restore_amount: int,
) -> TokenHpChangeResult:
    if not target_token_id or restore_amount <= 0:
        return TokenHpChangeResult(new_hp=None, hp_change=0)

    token = await db.get(Token, target_token_id)
    if not token or token.current_hp is None:
        return TokenHpChangeResult(new_hp=None, hp_change=0)

    max_hp = getattr(token, "max_hp", None)
    new_hp = min(max_hp or 9999, token.current_hp + restore_amount)
    actual_restore = max(0, new_hp - token.current_hp)
    token.current_hp = new_hp

    if actual_restore > 0 and getattr(token, "death_saves", None):
        token.death_saves = None
        flag_modified(token, "death_saves")

    if token.character_id:
        character = await db.get(Character, token.character_id)
        if character:
            character.current_hp = new_hp

    if token.monster_instance_id:
        monster = await db.get(MonsterInstance, token.monster_instance_id)
        if monster:
            monster.current_hp = new_hp

    await db.commit()
    return TokenHpChangeResult(
        new_hp=new_hp,
        hp_change=actual_restore,
        character_id=token.character_id,
        monster_instance_id=token.monster_instance_id,
        temp_hp=token.temp_hp,
        active_effects=token.active_effects,
        target_defeated=False,
    )


async def apply_direct_token_damage(
    db: AsyncSession,
    *,
    target_token_id: Optional[int],
    damage_amount: int,
) -> TokenHpChangeResult:
    if not target_token_id or damage_amount <= 0:
        return TokenHpChangeResult(new_hp=None, hp_change=0)

    token = await db.get(Token, target_token_id)
    if not token:
        return TokenHpChangeResult(new_hp=None, hp_change=0)

    actual_damage = await absorb_temp_hp(token, damage_amount, db)
    if token.current_hp is None:
        return TokenHpChangeResult(
            new_hp=None,
            hp_change=0,
            character_id=token.character_id,
            monster_instance_id=token.monster_instance_id,
            temp_hp=token.temp_hp,
            active_effects=token.active_effects,
            target_defeated=False,
        )

    new_hp = max(0, token.current_hp - actual_damage)
    token.current_hp = new_hp

    if token.character_id:
        character = await db.get(Character, token.character_id)
        if character:
            character.current_hp = new_hp

    if token.monster_instance_id:
        monster = await db.get(MonsterInstance, token.monster_instance_id)
        if monster:
            monster.current_hp = new_hp

    await db.commit()
    if new_hp <= 0:
        from app.services.spell_runtime_service import notify_target_downed

        await notify_target_downed(
            db,
            campaign_id=token.campaign_id,
            target_token_id=token.id,
        )
    return TokenHpChangeResult(
        new_hp=new_hp,
        hp_change=-actual_damage,
        character_id=token.character_id,
        monster_instance_id=token.monster_instance_id,
        temp_hp=token.temp_hp,
        active_effects=token.active_effects,
        target_defeated=new_hp <= 0,
    )


async def persist_attack_hp_change(
    db: AsyncSession,
    *,
    campaign_id: int | str,
    target_token_id: Optional[int],
    target_character_id: Optional[int],
    target_monster_instance_id: Optional[int],
    hp_change: Optional[int],
    new_hp: Optional[int],
    target_defeated: bool,
    auto_apply: bool,
) -> AttackHpPersistenceResult:
    if not auto_apply or hp_change is None or new_hp is None:
        return AttackHpPersistenceResult(
            persisted=False,
            new_hp=new_hp,
            target_defeated=target_defeated,
        )

    if target_token_id:
        token = await db.get(Token, target_token_id)
        if token and token.transformation_data:
            beast_current_hp = token.transformation_data.get("current_hp", 0)
            beast_new_hp = beast_current_hp + hp_change

            if beast_new_hp <= 0:
                overflow_damage = abs(beast_new_hp)
                token.transformation_data = None
                flag_modified(token, "transformation_data")

                if token.character_id:
                    character = await db.get(Character, token.character_id)
                    if character and character.current_hp is not None:
                        character.current_hp = max(0, character.current_hp - overflow_damage)
                        token.current_hp = character.current_hp
                        new_hp = character.current_hp
                        target_defeated = character.current_hp <= 0

                await db.commit()
                await realtime_publisher.publish_transformation_updated(
                    campaign_id,
                    token_id=token.id,
                    transformation_data=None,
                )
            else:
                token.transformation_data["current_hp"] = beast_new_hp
                flag_modified(token, "transformation_data")
                new_hp = beast_new_hp
                target_defeated = False
                await db.commit()
                await realtime_publisher.publish_transformation_updated(
                    campaign_id,
                    token_id=token.id,
                    transformation_data=token.transformation_data,
                )

            return AttackHpPersistenceResult(
                persisted=True,
                new_hp=new_hp,
                target_defeated=target_defeated,
                token_id=token.id,
                character_id=token.character_id,
                monster_instance_id=token.monster_instance_id,
                temp_hp=token.temp_hp,
                active_effects=token.active_effects,
            )

        if token:
            token.current_hp = new_hp
            if new_hp <= 0 and token.character_id:
                token.death_saves = {"successes": 0, "failures": 0, "stabilized": False}
                flag_modified(token, "death_saves")

        if target_character_id:
            character = await db.get(Character, target_character_id)
            if character:
                character.current_hp = new_hp
        elif token and token.character_id:
            character = await db.get(Character, token.character_id)
            if character:
                character.current_hp = new_hp

        if target_monster_instance_id:
            monster = await db.get(MonsterInstance, target_monster_instance_id)
            if monster:
                monster.current_hp = new_hp
        elif token and token.monster_instance_id:
            monster = await db.get(MonsterInstance, token.monster_instance_id)
            if monster:
                monster.current_hp = new_hp

        await db.commit()
        if token and new_hp <= 0:
            from app.services.spell_runtime_service import notify_target_downed

            await notify_target_downed(
                db,
                campaign_id=int(campaign_id),
                target_token_id=token.id,
            )
        return AttackHpPersistenceResult(
            persisted=True,
            new_hp=new_hp,
            target_defeated=target_defeated,
            token_id=token.id if token else None,
            character_id=token.character_id if token else target_character_id,
            monster_instance_id=token.monster_instance_id if token else target_monster_instance_id,
            temp_hp=token.temp_hp if token else None,
            active_effects=token.active_effects if token else None,
        )

    if target_character_id:
        character = await db.get(Character, target_character_id)
        if character:
            character.current_hp = new_hp

    if target_monster_instance_id:
        monster = await db.get(MonsterInstance, target_monster_instance_id)
        if monster:
            monster.current_hp = new_hp

    await db.commit()
    return AttackHpPersistenceResult(
        persisted=True,
        new_hp=new_hp,
        target_defeated=target_defeated,
        character_id=target_character_id,
        monster_instance_id=target_monster_instance_id,
    )


async def resolve_relentless_endurance(
    db: AsyncSession,
    *,
    target_token_id: Optional[int],
    effective_hp: Optional[int],
    new_hp: Optional[int],
    hp_change: Optional[int],
    target_defeated: bool,
) -> RelentlessEnduranceResult:
    if not (target_defeated and new_hp is not None and target_token_id):
        return RelentlessEnduranceResult(
            triggered=False,
            new_hp=new_hp,
            hp_change=hp_change,
            target_defeated=target_defeated,
        )

    token = await db.get(Token, target_token_id)
    if not token or not token.character_id:
        return RelentlessEnduranceResult(
            triggered=False,
            new_hp=new_hp,
            hp_change=hp_change,
            target_defeated=target_defeated,
        )

    character = await db.get(Character, token.character_id)
    if not character:
        return RelentlessEnduranceResult(
            triggered=False,
            new_hp=new_hp,
            hp_change=hp_change,
            target_defeated=target_defeated,
        )

    race_id = (
        character.subrace_id
        if hasattr(character, "subrace_id") and character.subrace_id
        else character.race_id or ""
    ).lower().replace("-", "_")
    if race_id != "half_orc":
        return RelentlessEnduranceResult(
            triggered=False,
            new_hp=new_hp,
            hp_change=hp_change,
            target_defeated=target_defeated,
        )

    class_feature_uses = character.class_feature_uses or {}
    relentless_uses = class_feature_uses.get("relentless_endurance", {})
    if relentless_uses.get("current", 1) <= 0:
        return RelentlessEnduranceResult(
            triggered=False,
            new_hp=new_hp,
            hp_change=hp_change,
            target_defeated=target_defeated,
        )

    class_feature_uses["relentless_endurance"] = {"current": 0, "max": 1}
    character.class_feature_uses = class_feature_uses
    flag_modified(character, "class_feature_uses")

    adjusted_new_hp = 1
    adjusted_hp_change = -(effective_hp - 1) if effective_hp is not None else hp_change
    return RelentlessEnduranceResult(
        triggered=True,
        new_hp=adjusted_new_hp,
        hp_change=adjusted_hp_change,
        target_defeated=False,
    )


async def absorb_temp_hp(
    token: Token,
    damage: int,
    db: AsyncSession,
) -> int:
    if damage <= 0 or not token.temp_hp or token.temp_hp <= 0:
        return damage

    absorbed = min(token.temp_hp, damage)
    token.temp_hp -= absorbed
    actual_damage = damage - absorbed

    if token.temp_hp <= 0:
        token.temp_hp = None
        if token.active_effects:
            new_effects = [
                effect
                for effect in token.active_effects
                if not (
                    effect.get("spell_buff")
                    and spell_has_effect_type(get_spell_by_id(effect.get("spell_id")), "grant_temp_hp")
                )
            ]
            if len(new_effects) != len(token.active_effects):
                token.active_effects = new_effects
                flag_modified(token, "active_effects")

    logger.info(
        f"[TempHP] Token {token.id} temp HP absorbed {absorbed}, "
        f"remaining={token.temp_hp}, actual_damage={actual_damage}"
    )
    return actual_damage


async def create_combat_chat_message(
    db: AsyncSession,
    *,
    campaign_id: int,
    sender_user_id: str,
    sender_role: str,
    content: str,
    meta: dict[str, Any],
    recipients: Optional[list[str]] = None,
    is_private: bool = False,
) -> ChatMessage:
    message = ChatMessage(
        campaign_id=campaign_id,
        sender_user_id=sender_user_id,
        sender_role=sender_role,
        message_type="combat",
        content=content,
        recipients=recipients or [],
        is_private=is_private,
        meta=meta,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return message


def combat_chat_timestamp_ms(message: ChatMessage) -> int:
    timestamp = message.created_at or datetime.utcnow()
    return int(timestamp.timestamp() * 1000)


async def publish_token_active_effects_update(
    token: Optional[Token],
    campaign_id: int | str,
) -> None:
    if not token:
        return
    await realtime_publisher.publish_token_active_effects_updated(
        campaign_id,
        token_id=token.id,
        active_effects=token.active_effects,
        character_id=token.character_id,
    )
