from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import app.api.routes.combat as combat
from app.api.routes.combat import (
    ZoneSpellSettleRequest,
    _get_structured_zone_settlement_phases,
    _resolve_zone_target_ability_scores,
    _resolve_zone_target_max_hp,
    _resolve_zone_settlement_timing,
    _settle_structured_zone_spell,
    _spell_has_structured_zone_settlement,
)
from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.token import Token
from app.services.effect_engine import HandlerOutcome
from app.utils.rules_cache import get_spell_by_id


def test_web_structured_zone_settlement_prefers_explicit_timing():
    spell = get_spell_by_id("web")

    assert spell is not None
    assert spell.get("controlEffect") is None
    assert (spell.get("zoneEffects") or {}).get("settlement") is None
    assert _spell_has_structured_zone_settlement(spell) is True
    assert _resolve_zone_settlement_timing(spell, "enter") == "enter"
    assert _resolve_zone_settlement_timing(spell, "start_turn") == "start_turn"
    assert [phase["trigger"] for phase in _get_structured_zone_settlement_phases(spell, timing="enter")] == [
        "on_enter_zone",
    ]
    assert [phase["trigger"] for phase in _get_structured_zone_settlement_phases(spell, timing="start_turn")] == [
        "start_of_target_turn",
    ]


def test_grease_structured_zone_settlement_does_not_match_start_turn():
    spell = get_spell_by_id("grease")

    assert spell is not None
    assert spell.get("controlEffect") is None
    assert (spell.get("zoneEffects") or {}).get("settlement") is None
    assert _spell_has_structured_zone_settlement(spell) is True
    assert _resolve_zone_settlement_timing(spell, "end_turn") == "end_turn"
    assert [phase["trigger"] for phase in _get_structured_zone_settlement_phases(spell, timing="end_turn")] == [
        "end_of_target_turn",
    ]
    assert _get_structured_zone_settlement_phases(spell, timing="start_turn") == []


def test_entangle_structured_zone_settlement_supports_enter_and_start_turn():
    spell = get_spell_by_id("entangle")

    assert spell is not None
    assert spell.get("controlEffect") is None
    assert (spell.get("zoneEffects") or {}).get("settlement") is None
    assert _spell_has_structured_zone_settlement(spell) is True
    assert _resolve_zone_settlement_timing(spell, "enter") == "enter"
    assert _resolve_zone_settlement_timing(spell, "start_turn") == "start_turn"
    assert [phase["trigger"] for phase in _get_structured_zone_settlement_phases(spell, timing="enter")] == [
        "on_enter_zone",
    ]
    assert [phase["trigger"] for phase in _get_structured_zone_settlement_phases(spell, timing="start_turn")] == [
        "start_of_target_turn",
    ]


def test_migrated_control_spells_no_longer_use_legacy_control_effect():
    migrated_spell_ids = [
        "tashas_hideous_laughter",
        "sleep",
        "hypnotic_pattern",
        "wrathful_smite",
        "ray_of_sickness",
        "ensnaring_strike",
        "hold_person",
        "blindness-deafness",
        "fear",
        "blinding_smite",
        "dominate_beast",
        "hold_monster",
        "dominate_person",
        "power_word_stun",
        "dominate_monster",
    ]

    for spell_id in migrated_spell_ids:
        spell = get_spell_by_id(spell_id)
        assert spell is not None, spell_id
        assert spell.get("controlEffect") is None, spell_id


def test_resolve_zone_target_max_hp_uses_character_progression_rules():
    character = Character(
        name="测试术士",
        race_id="human",
        class_id="warlock",
        level=3,
        ability_scores={
            "strength": 10,
            "dexterity": 14,
            "constitution": 14,
            "intelligence": 10,
            "wisdom": 10,
            "charisma": 16,
        },
    )

    assert _resolve_zone_target_max_hp(character, None) == 24


def test_resolve_zone_target_max_hp_prefers_monster_hit_points():
    monster = MonsterInstance(
        campaign_id=1,
        name="测试怪物",
        monster_id="test-goblin",
        type="goblin",
        hit_points=11,
        armor_class=13,
        monster_data={},
    )

    assert _resolve_zone_target_max_hp(None, monster) == 11


def test_resolve_zone_target_ability_scores_apply_racial_bonuses_for_characters():
    character = Character(
        name="瓦莱里乌斯·加兰诺德",
        race_id="elf",
        subrace_id="high_elf",
        class_id="wizard",
        level=1,
        race_choices={},
        ability_scores={
            "strength": 10,
            "dexterity": 13,
            "constitution": 14,
            "intelligence": 16,
            "wisdom": 10,
            "charisma": 10,
        },
    )

    assert _resolve_zone_target_ability_scores(character, None)["dexterity"] == 15


class _SettleFakeDB:
    """Minimal AsyncSession stand-in for the zone-spell-settle damage path."""

    def __init__(self, mapping):
        self.mapping = mapping
        self.commit_calls = 0

    async def get(self, model, ident):
        return self.mapping.get((model, ident))

    async def commit(self):
        self.commit_calls += 1

    async def flush(self):
        pass


@pytest.mark.asyncio
async def test_zone_spell_settle_damages_monster_current_hp_not_max_hp(monkeypatch):
    """A damaging zone spell settling on a monster must decrement current_hp
    and leave hit_points (the max-HP column) untouched.

    Regression: the deal_damage branch used to write
    ``target_monster.hit_points = target_token.current_hp``, which corrupted the
    monster's MAX HP — a monster reduced to 0 had its max permanently zeroed and
    could never be healed or reset.
    """
    spell = get_spell_by_id("cloud_of_daggers")  # no save, single deal_damage phase
    assert spell is not None

    monster = MonsterInstance(
        id=501,
        campaign_id=1,
        name="测试怪物",
        monster_id="test-goblin",
        type="goblin",
        hit_points=30,   # MAX HP — must stay 30
        current_hp=30,   # damage-tracking HP — must drop to 20
        armor_class=13,
        monster_data={},
    )
    target_token = Token(
        id=42,
        campaign_id=1,
        monster_instance_id=monster.id,
        character_id=None,
        user_id="dm",
        map_url="map://test",
        position_x=0,
        position_y=0,
        instance_name="测试怪物",
        current_hp=30,
        temp_hp=0,
        active_effects=[],
        concentration_spell=None,
    )
    caster_token = Token(
        id=7,
        campaign_id=1,
        monster_instance_id=None,
        character_id=99,
        user_id="dm",
        map_url="map://test",
        position_x=1,
        position_y=1,
        current_hp=40,
        concentration_spell=None,
    )

    db = _SettleFakeDB(
        {
            (Token, target_token.id): target_token,
            (MonsterInstance, monster.id): monster,
            # Campaign intentionally absent -> db.get returns None (tolerated).
        }
    )

    # Deterministic damage isolates the field-write (the bug) from dice rolls.
    fake_engine = SimpleNamespace(
        execute_effect=AsyncMock(
            return_value=HandlerOutcome(damage_dealt=10, formula_breakdown="4d4 → 10")
        )
    )
    monkeypatch.setattr("app.services.effect_engine.get_engine", lambda: fake_engine)

    # Silence the I/O surfaces (combat chat + websocket publishes).
    monkeypatch.setattr(combat, "_broadcast_combat_chat", AsyncMock())
    monkeypatch.setattr(combat, "_broadcast_concentration_updates", AsyncMock())
    monkeypatch.setattr(combat.realtime_publisher, "publish_token_hp_updated", AsyncMock())

    request = ZoneSpellSettleRequest(
        campaign_id=1,
        caster_token_id=caster_token.id,
        spell_id="cloud_of_daggers",
        target_token_ids=[target_token.id],
        timing="start_turn",
    )

    response = await _settle_structured_zone_spell(
        request=request,
        db=db,
        caster_token=caster_token,
        spell_source={"slot_level": 2},
        spell_data=spell,
        spell_name="匕首云",
        caster_name="法师",
        spell_save_dc=13,
        caster_level=5,
        spellcasting_mod=3,
        proficiency_bonus=3,
        caster_class_id="wizard",
        caster_subclass_id=None,
        caster_ability_scores={"intelligence": 16},
        user_id="1",
        role="dm",
    )

    # Damage hit the token...
    assert target_token.current_hp == 20
    # ...and was mirrored into the monster's CURRENT HP, not its MAX HP.
    assert monster.current_hp == 20, "zone-spell damage must decrement monster.current_hp"
    assert monster.hit_points == 30, "zone-spell damage must NOT touch monster.hit_points (max HP)"

    assert response is not None
    assert response.target_results[0].damage_dealt == 10
    assert response.target_results[0].new_hp == 20
