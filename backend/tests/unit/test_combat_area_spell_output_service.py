from app.schemas.combat import AreaSpellCastResult, AreaSpellTargetResult, DiceRoll, SpellData
from app.services import combat_area_spell_output_service as service


def _roll(dice: str, rolls: list[int], modifier: int = 0) -> DiceRoll:
    return DiceRoll(
        dice=dice,
        rolls=rolls,
        modifier=modifier,
        total=sum(rolls) + modifier,
    )


def _spell() -> SpellData:
    return SpellData(
        id="fireball",
        name="火球术",
        level=3,
        school="evocation",
        casting_time="1 action",
        range="150 feet",
        components=["V", "S", "M"],
        duration="瞬间",
        description="A bright streak flashes.",
        attack_type="save",
        save_type="dex",
        save_effect="half",
        damage="8d6",
        damage_type="fire",
        damage_type_cn="火焰",
        area_of_effect={"type": "sphere", "size": 20},
    )


def _target_result(name: str, succeeded: bool, damage: int, defeated: bool = False) -> AreaSpellTargetResult:
    return AreaSpellTargetResult(
        target_name=name,
        target_token_id=1,
        save_roll=_roll("1d20", [12], 3),
        save_modifier=3,
        save_total=15,
        save_succeeded=succeeded,
        damage_dealt=damage,
        damage_before_modifiers=damage,
        resistance_applied=False,
        immunity_applied=False,
        hp_change=-damage if damage else None,
        new_hp=0 if defeated else 8,
        target_defeated=defeated,
    )


def test_build_area_spell_chat_meta_preserves_contract():
    meta = service.build_area_spell_chat_meta(
        spell_id="fireball",
        spell_name="火球术",
        caster_token_id=3,
        target_count=2,
        total_damage=28,
        center_position={"x": 10, "y": 12},
        slot_consumed=3,
        is_concentration=False,
        has_persistent_area=False,
        narrative_prompt="prompt",
    )

    assert meta["combat_type"] == "area_spell"
    assert meta["spell_id"] == "fireball"
    assert meta["target_count"] == 2
    assert meta["narrative_prompt"] == "prompt"


def test_build_area_spell_narrative_prompt_mentions_targets_and_damage():
    prompt = service.build_area_spell_narrative_prompt(
        spell=_spell(),
        caster_name="Mira",
        target_results=[
            _target_result("Ogre", False, 28, defeated=True),
            _target_result("Goblin", True, 14),
        ],
        base_damage=28,
        total_damage=42,
        spell_save_dc=15,
        save_type_cn="敏捷",
        damage_type_cn="火焰",
        is_control_spell=False,
    )

    assert "火球术" in prompt
    assert "总计造成 42 点伤害" in prompt
    assert "【被击倒】Ogre" in prompt


def test_build_area_spell_combat_message_formats_damage_and_concentration():
    result = AreaSpellCastResult(
        total_targets=2,
        successful_saves=1,
        failed_saves=1,
        total_damage=42,
        target_results=[
            _target_result("Ogre", False, 28, defeated=True),
            _target_result("Goblin", True, 14),
        ],
        hp_updates=[],
        damage_roll=_roll("8d6", [4, 5, 6, 3, 2, 1, 4, 3]),
        spell_save_dc=15,
        caster_name="Mira",
        spell_name="火球术",
        damage_type="fire",
        damage_type_cn="火焰",
        save_type="dex",
        save_type_cn="敏捷",
        is_control_spell=False,
        narrative="炽热火浪吞没了战场。",
    )

    message = service.build_area_spell_combat_message(
        spell=_spell(),
        caster_name="Mira",
        result=result,
        slot_level=3,
        is_concentration=True,
        has_area_effect=True,
    )

    assert "火球术" in message
    assert "**总计伤害**: 42" in message
    assert "⚡ **Mira** 正在专注维持" in message
