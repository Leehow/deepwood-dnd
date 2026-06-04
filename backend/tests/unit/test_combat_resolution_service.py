from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import app.services.passive_feature_service as passive_feature_service
from app.services import combat_resolution_service as service
from app.models.character import Character
from app.models.token import Token


def test_extract_passive_save_condition_ids_deduplicates_and_normalizes():
    active_effects = [
        {"condition": "blinded"},
        {"id": "目盲"},
        {"condition": "incapacitated"},
        {"id": "unknown"},
    ]

    assert service.extract_passive_save_condition_ids(active_effects) == ["blinded", "incapacitated"]


def test_roll_save_d20_supports_advantage(monkeypatch):
    rolls = iter([4, 17])
    monkeypatch.setattr(service.random, "randint", lambda _start, _end: next(rolls))

    total, rolled = service.roll_save_d20(advantage=True)

    assert total == 17
    assert rolled == [4, 17]


def test_apply_heavy_armor_master_requires_heavy_armor_and_physical_damage():
    applied = service.apply_heavy_armor_master(
        total_damage=10,
        damage_type="slashing",
        feat_ids=["heavy_armor_master"],
        equipment=[{"equippedSlot": "armor", "type": "heavy"}],
    )
    skipped = service.apply_heavy_armor_master(
        total_damage=10,
        damage_type="fire",
        feat_ids=["heavy_armor_master"],
        equipment=[{"equippedSlot": "armor", "type": "heavy"}],
    )

    assert applied.applied is True
    assert applied.reduction == 3
    assert applied.damage_after == 7
    assert skipped.applied is False
    assert skipped.damage_after == 10


def test_resolve_thunderbolt_trigger_damage_type_prefers_first_lightning_source():
    base = service.resolve_thunderbolt_trigger_damage_type(
        normalize_damage_type=lambda value: str(value or "").lower(),
        base_damage_type="lightning",
        base_damage=7,
        extra_damage_type="fire",
        extra_damage=3,
        divine_strike_type=None,
        divine_strike_damage=0,
    )
    divine = service.resolve_thunderbolt_trigger_damage_type(
        normalize_damage_type=lambda value: str(value or "").lower(),
        base_damage_type="slashing",
        base_damage=7,
        extra_damage_type="fire",
        extra_damage=3,
        divine_strike_type="lightning",
        divine_strike_damage=4,
    )

    assert base == "lightning"
    assert divine == "lightning"


class _EmptyResult:
    """Stub SQLAlchemy Result (no rows) for fake execute() calls."""

    def scalars(self):
        return self

    def all(self):
        return []

    def first(self):
        return None


class _FakeDB:
    def __init__(self, mapping):
        self.mapping = mapping
        self.commit_calls = 0
        self.added = []

    async def get(self, model, ident):
        return self.mapping.get((model, ident))

    async def commit(self):
        self.commit_calls += 1

    def add(self, value):
        self.added.append(value)

    async def refresh(self, value):
        if getattr(value, "id", None) is None:
            value.id = len(self.added)
        if getattr(value, "created_at", None) is None:
            value.created_at = datetime(2026, 3, 21, 0, 1, 2, tzinfo=timezone.utc)

    async def execute(self, *_args, **_kwargs):
        # notify_target_downed -> _load_runtime_instances_for_campaign issues a
        # SELECT for active runtime instances; none exist in these unit
        # fixtures, so hand back an empty result set.
        return _EmptyResult()


@pytest.mark.asyncio
async def test_resolve_attack_damage_mitigation_applies_rage_and_pending(monkeypatch):
    token = SimpleNamespace(id=1, character_id=10, active_effects=[{"id": "rage"}])
    character = SimpleNamespace(
        id=10,
        feats=[],
        equipment=[],
        class_id="fighter",
        level=5,
        subclass_id=None,
    )
    db = _FakeDB({
        (Token, 1): token,
        (Character, 10): character,
    })

    pending_damage = AsyncMock(
        return_value=SimpleNamespace(
            damage_after_effects=10,
            granted_resistance=False,
            active_effects_changed=True,
            concentration_touched_token_ids=[],
        )
    )
    monkeypatch.setattr(service, "apply_pending_damage_received_effects", pending_damage)
    monkeypatch.setattr(service, "check_is_raging", lambda _effects: True)

    result = await service.resolve_attack_damage_mitigation(
        db,
        hit=True,
        total_damage=20,
        damage_type="slashing",
        target_token_id=1,
        auto_apply=True,
    )

    assert result.damage_before_resistance == 20
    assert result.total_damage == 10
    assert result.rage_resistance_applied is True
    assert result.target_active_effects_changed is True
    pending_damage.assert_awaited_once()


@pytest.mark.asyncio
async def test_resolve_attack_damage_mitigation_applies_ham_and_passive_resistance(monkeypatch):
    token = SimpleNamespace(id=2, character_id=20, active_effects=None)
    character = SimpleNamespace(
        id=20,
        feats=["heavy_armor_master"],
        equipment=[{"equippedSlot": "armor", "type": "heavy"}],
        class_id="paladin",
        level=9,
        subclass_id="ancients",
    )
    db = _FakeDB({
        (Token, 2): token,
        (Character, 20): character,
    })

    pending_damage = AsyncMock(
        return_value=SimpleNamespace(
            damage_after_effects=10,
            granted_resistance=False,
            active_effects_changed=False,
            concentration_touched_token_ids=[],
        )
    )
    monkeypatch.setattr(service, "apply_pending_damage_received_effects", pending_damage)
    monkeypatch.setattr(
        passive_feature_service,
        "get_passive_features",
        lambda _class_id, _level, _subclass_id: {"resistances": ["slashing"]},
    )

    result = await service.resolve_attack_damage_mitigation(
        db,
        hit=True,
        total_damage=10,
        damage_type="slashing",
        target_token_id=2,
        auto_apply=True,
    )

    assert result.total_damage == 3
    assert result.heavy_armor_master_reduction == 3
    assert result.passive_resistance_applied is True
    assert result.pending_damage_resistance_applied is False


@pytest.mark.asyncio
async def test_resolve_effective_target_hp_prefers_transformation_hp():
    token = SimpleNamespace(
        id=3,
        current_hp=18,
        character_id=30,
        monster_instance_id=None,
        transformation_data={"current_hp": 7, "max_hp": 19},
    )
    character = SimpleNamespace(
        id=30,
        class_id="druid",
        level=6,
        current_hp=14,
        ability_scores={"constitution": 14},
        multiclass_data=None,
    )
    db = _FakeDB({
        (Token, 3): token,
        (Character, 30): character,
    })

    result = await service.resolve_effective_target_hp(
        db,
        request_current_hp=None,
        request_max_hp=None,
        target_token_id=3,
    )

    assert result.effective_hp == 7
    assert result.effective_max_hp == 19


@pytest.mark.asyncio
async def test_resolve_effective_target_hp_computes_character_max_hp(monkeypatch):
    token = SimpleNamespace(
        id=4,
        current_hp=None,
        character_id=40,
        monster_instance_id=None,
        transformation_data=None,
    )
    character = SimpleNamespace(
        id=40,
        class_id="fighter",
        level=5,
        current_hp=None,
        ability_scores={"constitution": 16},
        multiclass_data=None,
    )
    db = _FakeDB({
        (Token, 4): token,
        (Character, 40): character,
    })
    monkeypatch.setattr(service, "calculate_max_hp", lambda _character: 44)

    result = await service.resolve_effective_target_hp(
        db,
        request_current_hp=None,
        request_max_hp=None,
        target_token_id=4,
    )

    assert result.effective_max_hp == 44
    assert result.effective_hp == 44


@pytest.mark.asyncio
async def test_resolve_attack_target_meta_loads_token_links_and_xp():
    token = SimpleNamespace(id=9, character_id=90, monster_instance_id=91)
    monster = SimpleNamespace(id=91, monster_data={"xp": 450})
    db = _FakeDB({
        (Token, 9): token,
        (service.MonsterInstance, 91): monster,
    })

    result = await service.resolve_attack_target_meta(
        db,
        target_token_id=9,
        target_defeated=True,
    )

    assert result.target_character_id == 90
    assert result.target_monster_instance_id == 91
    assert result.xp_value == 450


@pytest.mark.asyncio
async def test_restore_direct_token_hp_caps_at_max_and_clears_death_saves(monkeypatch):
    token = SimpleNamespace(
        id=11,
        current_hp=4,
        max_hp=10,
        temp_hp=None,
        active_effects=[{"id": "bless"}],
        character_id=110,
        monster_instance_id=None,
        death_saves={"successes": 1, "failures": 0, "stabilized": False},
    )
    character = SimpleNamespace(id=110, current_hp=4)
    db = _FakeDB({
        (Token, 11): token,
        (Character, 110): character,
    })
    monkeypatch.setattr(service, "flag_modified", lambda *_args, **_kwargs: None)

    result = await service.restore_direct_token_hp(
        db,
        target_token_id=11,
        restore_amount=9,
    )

    assert result.new_hp == 10
    assert result.hp_change == 6
    assert token.current_hp == 10
    assert character.current_hp == 10
    assert token.death_saves is None
    assert db.commit_calls == 1


@pytest.mark.asyncio
async def test_apply_direct_token_damage_absorbs_temp_hp_and_syncs_monster():
    token = SimpleNamespace(
        id=12,
        current_hp=20,
        temp_hp=5,
        active_effects=[{"id": "rage"}],
        character_id=None,
        monster_instance_id=120,
    )
    monster = SimpleNamespace(id=120, current_hp=20)
    db = _FakeDB({
        (Token, 12): token,
        (service.MonsterInstance, 120): monster,
    })

    result = await service.apply_direct_token_damage(
        db,
        target_token_id=12,
        damage_amount=9,
    )

    assert result.new_hp == 16
    assert result.hp_change == -4
    assert result.temp_hp is None
    assert result.target_defeated is False
    assert token.current_hp == 16
    assert monster.current_hp == 16
    assert db.commit_calls == 1


@pytest.mark.asyncio
async def test_persist_attack_hp_change_updates_normal_token_and_initializes_death_saves(monkeypatch):
    token = SimpleNamespace(
        id=5,
        character_id=50,
        monster_instance_id=None,
        current_hp=12,
        temp_hp=3,
        active_effects=[{"id": "rage"}],
        transformation_data=None,
        death_saves=None,
    )
    character = SimpleNamespace(id=50, current_hp=12)
    db = _FakeDB({
        (Token, 5): token,
        (Character, 50): character,
    })
    monkeypatch.setattr(service, "flag_modified", lambda *_args, **_kwargs: None)

    result = await service.persist_attack_hp_change(
        db,
        campaign_id=77,
        target_token_id=5,
        target_character_id=None,
        target_monster_instance_id=None,
        hp_change=-12,
        new_hp=0,
        target_defeated=True,
        auto_apply=True,
    )

    assert result.persisted is True
    assert result.new_hp == 0
    assert token.current_hp == 0
    assert character.current_hp == 0
    assert token.death_saves == {"successes": 0, "failures": 0, "stabilized": False}
    assert db.commit_calls == 1


@pytest.mark.asyncio
async def test_persist_attack_hp_change_handles_transformation_overflow(monkeypatch):
    token = SimpleNamespace(
        id=6,
        character_id=60,
        monster_instance_id=None,
        current_hp=18,
        temp_hp=None,
        active_effects=[],
        transformation_data={"current_hp": 4, "max_hp": 12},
    )
    character = SimpleNamespace(id=60, current_hp=18)
    db = _FakeDB({
        (Token, 6): token,
        (Character, 60): character,
    })
    publish_transformation = AsyncMock()
    monkeypatch.setattr(service, "flag_modified", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service.realtime_publisher, "publish_transformation_updated", publish_transformation)

    result = await service.persist_attack_hp_change(
        db,
        campaign_id=88,
        target_token_id=6,
        target_character_id=None,
        target_monster_instance_id=None,
        hp_change=-7,
        new_hp=0,
        target_defeated=True,
        auto_apply=True,
    )

    assert result.persisted is True
    assert result.new_hp == 15
    assert result.target_defeated is False
    assert token.transformation_data is None
    assert token.current_hp == 15
    assert character.current_hp == 15
    publish_transformation.assert_awaited_once_with(
        88,
        token_id=6,
        transformation_data=None,
    )


@pytest.mark.asyncio
async def test_resolve_relentless_endurance_consumes_feature_use(monkeypatch):
    token = SimpleNamespace(id=8, character_id=80)
    character = SimpleNamespace(
        id=80,
        race_id="half_orc",
        subrace_id=None,
        class_feature_uses={"relentless_endurance": {"current": 1, "max": 1}},
    )
    db = _FakeDB({
        (Token, 8): token,
        (Character, 80): character,
    })
    monkeypatch.setattr(service, "flag_modified", lambda *_args, **_kwargs: None)

    result = await service.resolve_relentless_endurance(
        db,
        target_token_id=8,
        effective_hp=14,
        new_hp=0,
        hp_change=-14,
        target_defeated=True,
    )

    assert result.triggered is True
    assert result.new_hp == 1
    assert result.hp_change == -13
    assert result.target_defeated is False
    assert character.class_feature_uses["relentless_endurance"]["current"] == 0


@pytest.mark.asyncio
async def test_absorb_temp_hp_removes_expired_spell_buff(monkeypatch):
    token = SimpleNamespace(
        id=7,
        temp_hp=5,
        active_effects=[
            {"spell_buff": True, "spell_id": "aid-temp"},
            {"id": "rage"},
        ],
    )
    monkeypatch.setattr(service, "get_spell_by_id", lambda _spell_id: {"id": "aid-temp"})
    monkeypatch.setattr(service, "spell_has_effect_type", lambda _spell, effect_type: effect_type == "grant_temp_hp")
    monkeypatch.setattr(service, "flag_modified", lambda *_args, **_kwargs: None)

    actual_damage = await service.absorb_temp_hp(token, 7, None)

    assert actual_damage == 2
    assert token.temp_hp is None
    assert token.active_effects == [{"id": "rage"}]


@pytest.mark.asyncio
async def test_create_combat_chat_message_persists_and_refreshes():
    db = _FakeDB({})

    message = await service.create_combat_chat_message(
        db,
        campaign_id=12,
        sender_user_id="user-1",
        sender_role="player",
        content="combat log",
        meta={"combat_type": "attack"},
    )

    assert db.commit_calls == 1
    assert db.added[0] is message
    assert message.id == 1
    assert message.message_type == "combat"
    assert message.meta["combat_type"] == "attack"


def test_combat_chat_timestamp_ms_uses_message_created_at():
    message = SimpleNamespace(created_at=datetime(2026, 3, 21, 0, 1, 2, tzinfo=timezone.utc))

    assert service.combat_chat_timestamp_ms(message) == 1774051262000


@pytest.mark.asyncio
async def test_publish_token_active_effects_update_delegates_to_realtime_publisher(monkeypatch):
    publish = AsyncMock()
    monkeypatch.setattr(service.realtime_publisher, "publish_token_active_effects_updated", publish)

    token = type("Token", (), {"id": 10, "active_effects": [{"id": "rage"}], "character_id": 8})()
    await service.publish_token_active_effects_update(token, 55)

    publish.assert_awaited_once_with(
        55,
        token_id=10,
        active_effects=[{"id": "rage"}],
        character_id=8,
    )
