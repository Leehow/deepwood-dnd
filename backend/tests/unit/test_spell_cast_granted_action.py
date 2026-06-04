"""Unit tests for `active_effects` grant_action execution path.

These tests cover the pure helpers behind `/api/spells/granted-actions/execute`:
1. `_find_active_effect_grant_action` correctly picks the matching entry by
   `effect_id` or by `(spell_id, action_kind[, action_name])`.
2. The endpoint logic rejects a request whose `target_token_id` does not
   match the locked target persisted on the grant action entry
   (Witch Bolt's continuous link).

The endpoint itself is async and reaches into DB / SpellResolver / realtime
publisher, so we exercise the locked-target rejection by driving the route
function with monkeypatched dependencies — no DB session required.
"""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import app.api.routes.spell_cast as spell_cast
from app.api.routes.spell_cast import (
    GrantedActionExecuteRequest,
    _build_synthetic_damage_spell_data,
    _find_active_effect_grant_action,
    execute_granted_action,
)
from app.services.effect_engine.handlers.utility import (
    GrantActionHandler,
    GrantActionParams,
)
from app.services.effect_engine.types import (
    EffectSource,
    HandlerContext,
    SideEffects,
)


WITCH_BOLT_GRANT_ENTRY = {
    "id": "witch_bolt_grant_action_巫术箭伤害",
    "name": "巫术箭伤害",
    "source": "巫术箭",
    "source_token_id": 527,
    "spell_id": "witch_bolt",
    "is_concentration": True,
    "effect_type": "grant_action",
    "action_type": "action",
    "action_name": "巫术箭伤害",
    "action_kind": "repeat_damage",
    "damage": {"formula": "1d12", "damage_type": "lightning"},
    "target_token_id": 534,
}


# Spiritual Weapon persists an attack-based grant action: the follow-up bonus
# action must roll a spell attack and only deal damage on a hit.
SPIRITUAL_WEAPON_GRANT_ENTRY = {
    "id": "spiritual_weapon_grant_action_灵体武器攻击",
    "name": "灵体武器攻击",
    "source": "灵体武器",
    "source_token_id": 2557,
    "spell_id": "spiritual_weapon",
    "effect_type": "grant_action",
    "action_type": "bonus_action",
    "action_name": "灵体武器攻击",
    "action_kind": "attack",
    "attack": {"type": "melee_spell", "on_miss": "no_effect"},
    "damage": {"formula": "1d8+MOD", "damage_type": "force"},
    "target_token_id": 2567,
}


# Call Lightning persists a save-based grant action: the follow-up action must
# roll a DEX save and honor on_success (half_damage).
CALL_LIGHTNING_GRANT_ENTRY = {
    "id": "call_lightning_grant_action_召唤闪电",
    "name": "召唤闪电",
    "source": "召雷术",
    "source_token_id": 600,
    "spell_id": "call_lightning",
    "is_concentration": True,
    "effect_type": "grant_action",
    "action_type": "action",
    "action_name": "召唤闪电",
    "action_kind": "save_damage",
    "save": {"ability": "dex", "on_success": "half_damage"},
    "damage": {"formula": "3d10", "damage_type": "lightning"},
}


def test_find_active_effect_grant_action_prefers_effect_id():
    entry = _find_active_effect_grant_action(
        [WITCH_BOLT_GRANT_ENTRY],
        effect_id="witch_bolt_grant_action_巫术箭伤害",
    )
    assert entry is WITCH_BOLT_GRANT_ENTRY


def test_find_active_effect_grant_action_returns_none_when_effect_id_missing():
    entry = _find_active_effect_grant_action(
        [WITCH_BOLT_GRANT_ENTRY],
        effect_id="does-not-exist",
    )
    assert entry is None


def test_find_active_effect_grant_action_matches_by_spell_and_kind():
    entry = _find_active_effect_grant_action(
        [WITCH_BOLT_GRANT_ENTRY],
        spell_id="witch_bolt",
        action_kind="repeat_damage",
    )
    assert entry is WITCH_BOLT_GRANT_ENTRY


def test_find_active_effect_grant_action_filters_by_action_name():
    other = {
        **WITCH_BOLT_GRANT_ENTRY,
        "id": "other",
        "action_name": "另一个动作",
    }
    entry = _find_active_effect_grant_action(
        [other, WITCH_BOLT_GRANT_ENTRY],
        spell_id="witch_bolt",
        action_kind="repeat_damage",
        action_name="巫术箭伤害",
    )
    assert entry is WITCH_BOLT_GRANT_ENTRY


def test_find_active_effect_grant_action_skips_non_grant_entries():
    spell_buff = {
        "id": "spell_buff_witch_bolt",
        "spell_buff": True,
        "spell_id": "witch_bolt",
    }
    entry = _find_active_effect_grant_action(
        [spell_buff],
        spell_id="witch_bolt",
        action_kind="repeat_damage",
    )
    assert entry is None


def test_build_synthetic_damage_spell_data_defaults_level_zero_when_unknown():
    spell_data = _build_synthetic_damage_spell_data(
        spell_id="unknown",
        spell_name="未知",
        action_name="未知",
        damage_formula="1d4",
        damage_type="force",
    )
    assert spell_data["level"] == 0


def test_build_synthetic_damage_spell_data_has_single_deal_damage_phase():
    spell_data = _build_synthetic_damage_spell_data(
        spell_id="witch_bolt",
        spell_name="巫术箭",
        action_name="巫术箭伤害",
        damage_formula="1d12",
        damage_type="lightning",
        spell_level=1,
    )
    assert spell_data["concentration"] is False
    # Source spell level carries through so cantrip-only damage bonuses do
    # not apply to follow-up damage from a level-1 spell.
    assert spell_data["level"] == 1
    phases = spell_data["effects"]
    assert len(phases) == 1
    inner = phases[0]["effects"]
    assert len(inner) == 1
    assert inner[0] == {
        "type": "deal_damage",
        "formula": "1d12",
        "damage_type": "lightning",
    }


def test_build_synthetic_damage_spell_data_repeat_damage_has_no_attack_or_save():
    """Witch Bolt repeat_damage carries neither attack nor save → the phase
    stays pure direct damage (regression guard for the unchanged path)."""
    spell_data = _build_synthetic_damage_spell_data(
        spell_id="witch_bolt",
        spell_name="巫术箭",
        action_name="巫术箭伤害",
        damage_formula="1d12",
        damage_type="lightning",
        spell_level=1,
    )
    phase = spell_data["effects"][0]
    assert "attack" not in phase
    assert "save" not in phase


def test_build_synthetic_damage_spell_data_embeds_attack_metadata():
    """Spiritual Weapon attack grant → synthetic phase carries the attack
    block so the resolver rolls a spell attack (would fail before the fix)."""
    attack = {"type": "melee_spell", "on_miss": "no_effect"}
    spell_data = _build_synthetic_damage_spell_data(
        spell_id="spiritual_weapon",
        spell_name="灵体武器",
        action_name="灵体武器攻击",
        damage_formula="1d8+MOD",
        damage_type="force",
        spell_level=2,
        attack=attack,
    )
    phase = spell_data["effects"][0]
    assert phase["attack"] == attack
    assert "save" not in phase
    # Damage leaf is preserved alongside the attack metadata.
    assert phase["effects"][0]["type"] == "deal_damage"


def test_build_synthetic_damage_spell_data_embeds_save_metadata():
    """Call Lightning save grant → synthetic phase carries the save block so
    the resolver rolls a DEX save (would fail before the fix)."""
    save = {"ability": "dex", "on_success": "half_damage"}
    spell_data = _build_synthetic_damage_spell_data(
        spell_id="call_lightning",
        spell_name="召雷术",
        action_name="召唤闪电",
        damage_formula="3d10",
        damage_type="lightning",
        spell_level=3,
        save=save,
    )
    phase = spell_data["effects"][0]
    assert phase["save"] == save
    assert "attack" not in phase


def test_build_synthetic_damage_spell_data_attack_wins_when_both_present():
    """Attack and save are mutually exclusive in the resolver; if a malformed
    entry carries both, attack must win and save must be dropped."""
    spell_data = _build_synthetic_damage_spell_data(
        spell_id="weird",
        spell_name="怪异",
        action_name="怪异",
        damage_formula="1d6",
        damage_type="force",
        attack={"type": "ranged_spell", "on_miss": "no_effect"},
        save={"ability": "dex", "on_success": "half_damage"},
    )
    phase = spell_data["effects"][0]
    assert "attack" in phase
    assert "save" not in phase


@pytest.mark.asyncio
async def test_execute_granted_action_rejects_locked_target_mismatch(monkeypatch):
    """Selecting a token other than the locked Witch Bolt target must
    short-circuit with a clear error and never touch the resolver."""
    caster_token = SimpleNamespace(
        id=527,
        campaign_id=8,
        active_effects=[WITCH_BOLT_GRANT_ENTRY],
        character_id=None,
        instance_name="女巫",
    )

    async def fake_check_campaign_member(*args, **kwargs):
        return None

    async def fake_db_get(model, key):
        if key == 527:
            return caster_token
        raise AssertionError(f"Unexpected db.get for {model} {key}")

    db = SimpleNamespace(get=fake_db_get, commit=AsyncMock(), refresh=AsyncMock())

    monkeypatch.setattr(spell_cast, "check_campaign_member", fake_check_campaign_member)
    # Surface a loud failure if the resolver gets reached.
    resolver_sentinel = MagicMock(side_effect=AssertionError("resolver invoked despite locked-target mismatch"))
    monkeypatch.setattr(spell_cast, "SpellResolver", resolver_sentinel)

    req = GrantedActionExecuteRequest(
        campaign_id=8,
        caster_token_id=527,
        target_token_id=999,  # wrong target — locked is 534
        effect_id="witch_bolt_grant_action_巫术箭伤害",
    )

    resp = await execute_granted_action(req=req, db=db, current_user={"user_id": 1})

    assert resp.success is False
    assert "原始目标" in (resp.error or "")
    resolver_sentinel.assert_not_called()
    db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_execute_granted_action_runs_resolver_for_locked_target(monkeypatch):
    """Happy path: locked target matches → resolver is invoked with the
    synthetic deal_damage payload; no slot consumption side effects."""
    caster_token = SimpleNamespace(
        id=527,
        campaign_id=8,
        active_effects=[WITCH_BOLT_GRANT_ENTRY],
        character_id=None,
        instance_name="女巫",
    )
    target_token = SimpleNamespace(
        id=534,
        campaign_id=8,
        character_id=None,
        monster_instance_id=None,
        instance_name="目标",
        token_size="1x1",
        current_hp=12,
        temp_hp=0,
        active_effects=None,
        transformation_data=None,
    )

    async def fake_check_campaign_member(*args, **kwargs):
        return None

    async def fake_db_get(model, key):
        if key == 527:
            return caster_token
        if key == 534:
            return target_token
        return None

    db = SimpleNamespace(get=fake_db_get, commit=AsyncMock(), refresh=AsyncMock())

    monkeypatch.setattr(spell_cast, "check_campaign_member", fake_check_campaign_member)

    async def fake_build_target_info(token, _db):
        return SimpleNamespace(token_id=token.id, name=token.instance_name)

    monkeypatch.setattr(spell_cast, "_build_target_info", fake_build_target_info)

    async def fake_check_in_combat(_db, _cid):
        return False

    monkeypatch.setattr(spell_cast, "_check_in_combat", fake_check_in_combat)

    async def fake_get_campaign_time(_db, _cid):
        return {"day": 1, "hour": 0, "minute": 0, "second": 0}

    monkeypatch.setattr(spell_cast, "_get_campaign_time", fake_get_campaign_time)

    captured_calls = {}

    fake_phase_result = SimpleNamespace(
        damage_dealt=7,
        target_name="目标",
        model_dump=lambda: {"damage_dealt": 7, "target_token_id": 534},
        target_token_id=534,
    )
    fake_result = SimpleNamespace(
        phase_results=[[fake_phase_result]],
        total_damage=7,
        total_healing=0,
    )

    class FakeResolver:
        async def resolve(self, spell_data, ctx, targets, db):
            captured_calls["spell_data"] = spell_data
            captured_calls["targets"] = targets
            captured_calls["ctx"] = ctx
            return fake_result

    monkeypatch.setattr(spell_cast, "SpellResolver", lambda: FakeResolver())

    publisher_mock = SimpleNamespace(
        publish_spell_cast_result=AsyncMock(),
        publish_token_hp_updated=AsyncMock(),
    )
    monkeypatch.setattr(spell_cast, "realtime_publisher", publisher_mock)
    monkeypatch.setattr(spell_cast, "notify_target_downed", AsyncMock())
    # Spell lookup is best-effort; if it returns None, the entry's `source`
    # / `name` field is used. Force a fixed spell-name lookup so we can
    # assert the broadcast payload.
    monkeypatch.setattr(spell_cast, "get_spell_by_id", lambda sid: {"name": "巫术箭", "level": 1})

    req = GrantedActionExecuteRequest(
        campaign_id=8,
        caster_token_id=527,
        target_token_id=534,
        effect_id="witch_bolt_grant_action_巫术箭伤害",
    )

    resp = await execute_granted_action(req=req, db=db, current_user={"user_id": 1})

    assert resp.success is True
    assert resp.total_damage == 7
    assert resp.action_name == "巫术箭伤害"
    spell_data = captured_calls["spell_data"]
    assert spell_data["concentration"] is False
    # Witch Bolt is level 1; synthetic spell carries the source level so
    # cantrip-only damage passives stay off.
    assert spell_data["level"] == 1
    assert spell_data["effects"][0]["effects"][0]["type"] == "deal_damage"
    # Resolver is invoked exactly once with one target.
    assert len(captured_calls["targets"]) == 1
    publisher_mock.publish_spell_cast_result.assert_awaited()
    publisher_mock.publish_token_hp_updated.assert_awaited()
    # SpellContext indicates freecast intent (no slot consumption) while
    # still carrying the source spell's true level so cantrip-only passives
    # are not mistakenly applied.
    assert captured_calls["ctx"].slot_level == 0
    assert captured_calls["ctx"].spell_level == 1
    assert captured_calls["ctx"].concentration is False


def _wire_granted_action_route(
    monkeypatch,
    *,
    grant_entry,
    caster_token_id,
    target_token_id,
    captured_calls,
    spell_lookup,
):
    """Monkeypatch the route's collaborators and return (caster_token, db).

    The fake resolver records the spell_data / ctx / targets it is handed so a
    test can assert what phase metadata reached the resolver. HP/down side
    effects are stubbed; we only care about the synthetic payload here."""
    caster_token = SimpleNamespace(
        id=caster_token_id,
        campaign_id=8,
        active_effects=[grant_entry],
        character_id=None,
        instance_name="施法者",
    )
    target_token = SimpleNamespace(
        id=target_token_id,
        campaign_id=8,
        character_id=None,
        monster_instance_id=None,
        instance_name="目标",
        token_size="1x1",
        current_hp=24,
        temp_hp=0,
        active_effects=None,
        transformation_data=None,
    )

    async def fake_check_campaign_member(*args, **kwargs):
        return None

    async def fake_db_get(model, key):
        if key == caster_token_id:
            return caster_token
        if key == target_token_id:
            return target_token
        return None

    db = SimpleNamespace(get=fake_db_get, commit=AsyncMock(), refresh=AsyncMock())

    async def fake_build_target_info(token, _db):
        return SimpleNamespace(token_id=token.id, name=token.instance_name)

    async def fake_check_in_combat(_db, _cid):
        return True

    async def fake_get_campaign_time(_db, _cid):
        return {"day": 1, "hour": 0, "minute": 0, "second": 0}

    fake_phase_result = SimpleNamespace(
        damage_dealt=0,
        target_name="目标",
        model_dump=lambda: {"damage_dealt": 0, "target_token_id": target_token_id},
        target_token_id=target_token_id,
    )
    fake_result = SimpleNamespace(
        phase_results=[[fake_phase_result]],
        total_damage=0,
        total_healing=0,
    )

    class FakeResolver:
        async def resolve(self, spell_data, ctx, targets, db):
            captured_calls["spell_data"] = spell_data
            captured_calls["targets"] = targets
            captured_calls["ctx"] = ctx
            return fake_result

    publisher_mock = SimpleNamespace(
        publish_spell_cast_result=AsyncMock(),
        publish_token_hp_updated=AsyncMock(),
    )

    monkeypatch.setattr(spell_cast, "check_campaign_member", fake_check_campaign_member)
    monkeypatch.setattr(spell_cast, "_build_target_info", fake_build_target_info)
    monkeypatch.setattr(spell_cast, "_check_in_combat", fake_check_in_combat)
    monkeypatch.setattr(spell_cast, "_get_campaign_time", fake_get_campaign_time)
    monkeypatch.setattr(spell_cast, "SpellResolver", lambda: FakeResolver())
    monkeypatch.setattr(spell_cast, "realtime_publisher", publisher_mock)
    monkeypatch.setattr(spell_cast, "notify_target_downed", AsyncMock())
    monkeypatch.setattr(spell_cast, "get_spell_by_id", lambda sid: spell_lookup)
    return caster_token, db


@pytest.mark.asyncio
async def test_execute_granted_action_passes_attack_phase_for_spiritual_weapon(monkeypatch):
    """Spiritual Weapon follow-up → resolver receives an attack phase so it
    rolls a spell attack instead of auto-applying damage. Fails before fix."""
    captured_calls = {}
    _, db = _wire_granted_action_route(
        monkeypatch,
        grant_entry=SPIRITUAL_WEAPON_GRANT_ENTRY,
        caster_token_id=2557,
        target_token_id=2567,
        captured_calls=captured_calls,
        spell_lookup={"name": "灵体武器", "level": 2},
    )

    req = GrantedActionExecuteRequest(
        campaign_id=8,
        caster_token_id=2557,
        target_token_id=2567,
        effect_id="spiritual_weapon_grant_action_灵体武器攻击",
    )

    resp = await execute_granted_action(req=req, db=db, current_user={"user_id": 1})

    assert resp.success is True
    phase = captured_calls["spell_data"]["effects"][0]
    assert phase["attack"] == {"type": "melee_spell", "on_miss": "no_effect"}
    assert "save" not in phase
    assert phase["effects"][0]["type"] == "deal_damage"


@pytest.mark.asyncio
async def test_execute_granted_action_passes_save_phase_for_call_lightning(monkeypatch):
    """Call Lightning follow-up → resolver receives a save phase so it rolls a
    DEX save and honors on_success. Fails before fix."""
    captured_calls = {}
    _, db = _wire_granted_action_route(
        monkeypatch,
        grant_entry=CALL_LIGHTNING_GRANT_ENTRY,
        caster_token_id=600,
        target_token_id=601,
        captured_calls=captured_calls,
        spell_lookup={"name": "召雷术", "level": 3},
    )

    req = GrantedActionExecuteRequest(
        campaign_id=8,
        caster_token_id=600,
        target_token_id=601,
        effect_id="call_lightning_grant_action_召唤闪电",
    )

    resp = await execute_granted_action(req=req, db=db, current_user={"user_id": 1})

    assert resp.success is True
    phase = captured_calls["spell_data"]["effects"][0]
    assert phase["save"] == {"ability": "dex", "on_success": "half_damage"}
    assert "attack" not in phase


# ── GrantActionHandler target-locking by action_kind ──────────────────────


class _GrantStubToken:
    """Minimal token stand-in covering only what GrantActionHandler touches."""

    def __init__(self, token_id: int):
        self.id = token_id
        self.active_effects = []
        self.campaign_id = 8


class _GrantStubDB:
    def __init__(self, token: "_GrantStubToken"):
        self._token = token

    async def get(self, _model, _key):
        return self._token

    async def flush(self):
        return None


def _run_grant_handler(action_kind: str, *, spell_id: str, spell_name: str) -> dict:
    """Run GrantActionHandler for a self-cast grant and return the persisted
    entry. The on-cast target is the caster itself (token 7), matching how a
    self-range spell like Dispel Evil and Good is cast."""
    token = _GrantStubToken(token_id=7)
    # GrantActionHandler reads only a few attrs off caster_ctx / target, and
    # HandlerContext types them as Any, so lightweight stand-ins suffice.
    caster_ctx = SimpleNamespace(
        caster_token_id=7,
        caster_name="测试施法者",
        spell_id=spell_id,
        spell_name=spell_name,
        concentration=True,
    )
    target_ctx = SimpleNamespace(token_id=7, name="施法者自己")
    source = EffectSource(
        type="spell",
        id=spell_id,
        name=spell_name,
        caster_token_id=7,
        concentration=True,
        slot_level=0,
    )
    hctx = HandlerContext(
        source=source,
        target=target_ctx,
        caster_ctx=caster_ctx,
        phase={},
        db=_GrantStubDB(token),
    )
    shape = {
        "type": "grant_action",
        "action_type": "action",
        "action_name": f"{spell_name}动作",
        "action_kind": action_kind,
    }
    if action_kind == "repeat_damage":
        shape["damage"] = {"formula": "1d12", "damage_type": "lightning"}
    params = GrantActionParams.model_validate(shape)

    async def _run():
        # flag_modified needs a real SQLAlchemy instance; the stub token isn't
        # one, so patch it out (mirrors test_effect_engine handler tests).
        with patch("app.services.effect_engine.handlers.utility.flag_modified"):
            await GrantActionHandler().execute(params, hctx, SideEffects())
        return token.active_effects[-1]

    return asyncio.run(_run())


def test_grant_action_handler_does_not_lock_remove_condition_to_self():
    """Dispel Evil and Good is self-cast, so its on-cast target is the caster.
    A `remove_condition` follow-up must target a *future* afflicted ally, so it
    must NOT be pinned to the caster token."""
    entry = _run_grant_handler(
        "remove_condition", spell_id="dispel_evil_and_good", spell_name="驱散善恶"
    )
    assert entry["action_kind"] == "remove_condition"
    assert "target_token_id" not in entry


def test_grant_action_handler_still_locks_repeat_damage():
    """Regression guard: Witch Bolt / Heat Metal repeat_damage must stay pinned
    to the on-cast target."""
    entry = _run_grant_handler(
        "repeat_damage", spell_id="witch_bolt", spell_name="巫术箭"
    )
    assert entry["action_kind"] == "repeat_damage"
    assert entry["target_token_id"] == 7


# ── /granted-actions/execute remove_condition branch ──────────────────────


DISPEL_GRANT_ENTRY = {
    "id": "dispel_evil_and_good_grant_action_破除附魔",
    "name": "破除附魔",
    "source": "驱散善恶",
    "source_token_id": 2581,
    "spell_id": "dispel_evil_and_good",
    "is_concentration": True,
    "effect_type": "grant_action",
    "action_type": "action",
    "action_name": "破除附魔",
    "action_kind": "remove_condition",
    # No target_token_id — the handler no longer locks remove_condition to self.
}


@pytest.mark.asyncio
async def test_execute_granted_action_remove_condition_strips_target_condition(monkeypatch):
    """remove_condition removes a charm condition from the chosen target,
    leaves unrelated buffs intact, never touches the damage resolver, AND ends
    the source concentration (clearing the caster's concentration_spell + its
    concentration-bound buff/grant effects) per "使用后法术结束"."""
    caster_token = SimpleNamespace(
        id=2581,
        campaign_id=8,
        active_effects=[
            DISPEL_GRANT_ENTRY,
            {
                "id": "spell_buff_dispel_evil_and_good",
                "name": "驱散善恶",
                "spell_buff": True,
                "spell_id": "dispel_evil_and_good",
                "is_concentration": True,
                "source_token_id": 2581,
            },
        ],
        concentration_spell={
            "spell_id": "dispel_evil_and_good",
            "spell_name": "驱散善恶",
            "slot_level": 5,
        },
        character_id=None,
        instance_name="圣武士",
    )
    target_token = SimpleNamespace(
        id=2591,
        campaign_id=8,
        character_id=None,
        monster_instance_id=None,
        instance_name="被魅惑的盟友",
        active_effects=[
            {
                "id": "qa_charmed_by_undead",
                "name": "charmed",
                "condition": "charmed",
                "effect_type": "condition",
                "source": "不死生物",
            },
            {
                "id": "spell_buff_bless",
                "name": "祝福",
                "spell_buff": True,
                "spell_id": "bless",
            },
        ],
    )

    async def fake_check_campaign_member(*args, **kwargs):
        return None

    async def fake_db_get(model, key):
        if key == 2581:
            return caster_token
        if key == 2591:
            return target_token
        return None

    db = SimpleNamespace(get=fake_db_get, commit=AsyncMock(), refresh=AsyncMock())
    monkeypatch.setattr(spell_cast, "check_campaign_member", fake_check_campaign_member)

    publisher_mock = SimpleNamespace(
        publish_spell_cast_result=AsyncMock(),
        publish_token_active_effects_updated=AsyncMock(),
        publish_token_concentration_updated=AsyncMock(),
    )
    monkeypatch.setattr(spell_cast, "realtime_publisher", publisher_mock)
    # SimpleNamespace tokens aren't ORM instances, so neutralize flag_modified.
    monkeypatch.setattr(spell_cast, "flag_modified", lambda *a, **k: None)
    # The resolver is damage-only; remove_condition must never reach it.
    monkeypatch.setattr(
        spell_cast,
        "SpellResolver",
        MagicMock(side_effect=AssertionError("resolver invoked for remove_condition")),
    )

    req = GrantedActionExecuteRequest(
        campaign_id=8,
        caster_token_id=2581,
        target_token_id=2591,
        effect_id="dispel_evil_and_good_grant_action_破除附魔",
    )

    resp = await execute_granted_action(req=req, db=db, current_user={"user_id": 1})

    assert resp.success is True
    assert resp.action_name == "破除附魔"
    assert resp.affected_token_ids == [2591]
    # Target condition stripped, unrelated bless buff preserved.
    remaining_ids = [e.get("id") for e in target_token.active_effects]
    assert "qa_charmed_by_undead" not in remaining_ids
    assert "spell_buff_bless" in remaining_ids
    # Source concentration ended: caster concentration cleared and its
    # concentration-bound effects (buff + grant action) dropped.
    assert caster_token.concentration_spell is None
    caster_ids = [e.get("id") for e in (caster_token.active_effects or [])]
    assert "dispel_evil_and_good_grant_action_破除附魔" not in caster_ids
    assert "spell_buff_dispel_evil_and_good" not in caster_ids
    # Concentration update broadcast with the broken spell.
    publisher_mock.publish_token_concentration_updated.assert_awaited_once()
    conc_kwargs = publisher_mock.publish_token_concentration_updated.await_args.kwargs
    assert conc_kwargs["token_id"] == 2581
    assert conc_kwargs["concentration_spell"] is None
    assert conc_kwargs["broken_spell"]["spell_id"] == "dispel_evil_and_good"
    # Active-effects update fired for both target (2591) and caster (2581).
    effect_token_ids = [
        call.kwargs["token_id"]
        for call in publisher_mock.publish_token_active_effects_updated.await_args_list
    ]
    assert 2591 in effect_token_ids
    assert 2581 in effect_token_ids
    publisher_mock.publish_spell_cast_result.assert_awaited()
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_execute_granted_action_remove_condition_needs_no_damage_metadata(monkeypatch):
    """The remove_condition entry carries no damage block — it must still
    succeed (no "没有可执行的伤害定义" error) and simply report nothing cleansed
    when the target has no matching condition. A no-op must NOT end the source
    concentration (acceptance #3: wrong-target clicks must not consume the
    spell)."""
    concentration_before = {
        "spell_id": "dispel_evil_and_good",
        "spell_name": "驱散善恶",
        "slot_level": 5,
    }
    caster_token = SimpleNamespace(
        id=2581,
        campaign_id=8,
        active_effects=[DISPEL_GRANT_ENTRY],
        concentration_spell=concentration_before,
        character_id=None,
        instance_name="圣武士",
    )
    target_token = SimpleNamespace(
        id=2599,
        campaign_id=8,
        character_id=None,
        monster_instance_id=None,
        instance_name="未受影响者",
        active_effects=[],
    )

    async def fake_check_campaign_member(*args, **kwargs):
        return None

    async def fake_db_get(model, key):
        return {2581: caster_token, 2599: target_token}.get(key)

    db = SimpleNamespace(get=fake_db_get, commit=AsyncMock(), refresh=AsyncMock())
    monkeypatch.setattr(spell_cast, "check_campaign_member", fake_check_campaign_member)

    publisher_mock = SimpleNamespace(
        publish_spell_cast_result=AsyncMock(),
        publish_token_active_effects_updated=AsyncMock(),
        publish_token_concentration_updated=AsyncMock(),
    )
    monkeypatch.setattr(spell_cast, "realtime_publisher", publisher_mock)

    req = GrantedActionExecuteRequest(
        campaign_id=8,
        caster_token_id=2581,
        target_token_id=2599,
        effect_id="dispel_evil_and_good_grant_action_破除附魔",
    )

    resp = await execute_granted_action(req=req, db=db, current_user={"user_id": 1})

    assert resp.success is True
    assert resp.error is None
    assert resp.affected_token_ids == []
    # No removal → concentration must be untouched and no concentration update.
    assert caster_token.concentration_spell is concentration_before
    assert caster_token.active_effects == [DISPEL_GRANT_ENTRY]
    publisher_mock.publish_token_concentration_updated.assert_not_awaited()
    publisher_mock.publish_spell_cast_result.assert_awaited()
