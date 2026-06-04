import asyncio
from types import SimpleNamespace

import pytest

from app.models.spell_runtime_instance import SpellRuntimeInstance
from app.models.token import Token
from app.services import spell_runtime_service
from app.services.spell_runtime_service import (
    _append_legacy_spell_visual_projection,
    _append_legacy_granted_actions_projection,
    _build_spell_visual_projection_from_effect,
    _build_runtime_action_ui,
    _build_runtime_visual_spell_buff,
    _move_runtime_spell_buffs_between_targets,
    _remove_runtime_spell_buffs_from_effects,
    _roll_runtime_damage,
    audit_spell_pipeline_support,
    create_runtime_spell_instance,
    get_runtime_bonus_damage,
    resolve_spell_duration_rounds,
    spell_uses_runtime_engine,
)
from app.utils.dice_formula import DiceGroup, FormulaResult
from app.utils.rules_cache import get_spell_by_id


# ── Module-level helpers (no pytest fixtures, so --noconftest works) ──


class _FakeAsyncSession:
    """Minimal stand-in for AsyncSession used by create_runtime_spell_instance."""

    def __init__(self):
        self.added = []
        self.flushed = 0

    def add(self, instance):
        self.added.append(instance)

    async def flush(self):
        self.flushed += 1


def _make_hex_context(*, selected_option: str = "strength", concentration: bool = True):
    return SimpleNamespace(
        spell_id="hex",
        spell_name="脆弱诅咒",
        caster_token_id=10,
        campaign_id=1,
        caster_level=5,
        spellcasting_mod=3,
        proficiency_bonus=3,
        spell_save_dc=15,
        selected_option=selected_option,
        concentration=concentration,
        current_world_time={"day": 0, "hour": 0, "minute": 0, "second": 0},
    )


def _make_target(token_id: int = 20, name: str = "哥布林") -> SimpleNamespace:
    return SimpleNamespace(token_id=token_id, name=name)


def _hex_transfer_action() -> dict:
    hex_data = get_spell_by_id("hex")
    assert hex_data is not None
    for phase in hex_data.get("effects") or []:
        if phase.get("trigger") != "on_cast":
            continue
        for effect in phase.get("effects") or []:
            if effect.get("type") == "grant_action":
                return effect
    raise AssertionError("Hex transfer action not found")


def test_hex_runtime_pipeline_is_fully_supported():
    audit = audit_spell_pipeline_support()

    assert audit["unsupported_triggers"] == []
    assert audit["unsupported_verbs"] == []
    assert "conditional_extra_damage" in audit["verbs_used"]
    assert "apply_mark" in audit["verbs_used"]
    assert "retarget_mark" in audit["verbs_used"]
    assert "on_target_downed" in audit["triggers_used"]
    assert "on_action_invoked" in audit["triggers_used"]


def test_audit_spell_pipeline_support_exposes_engine_audit_fields():
    """Service bridge surfaces engine-audit fields alongside legacy keys."""
    from app.services.spell_runtime_engine import audit_pipeline as engine_audit_fn

    bridged = audit_spell_pipeline_support()
    engine_audit = engine_audit_fn()

    # New executability fields come from the engine audit.
    assert bridged["registered_verbs"] == engine_audit["registered_verbs"]
    assert bridged["dispatched_verbs"] == engine_audit["dispatched_verbs"]
    assert bridged["declared_only_verbs"] == engine_audit["declared_only_verbs"]
    assert bridged["dispatched_triggers"] == engine_audit["dispatched_triggers"]
    assert bridged["declared_only_triggers"] == engine_audit["declared_only_triggers"]

    # Wired triggers must include the Stage 6 set; on_cast is the canonical one.
    assert "on_cast" in bridged["dispatched_triggers"]

    # Legacy verbs_used / triggers_used remain set-derived sorted lists.
    assert bridged["verbs_used"] == engine_audit["declared_verbs"]
    assert bridged["triggers_used"] == engine_audit["declared_triggers"]


def test_hex_uses_runtime_engine_and_slot_duration_scaling():
    hex_data = get_spell_by_id("hex")

    assert hex_data is not None
    assert spell_uses_runtime_engine(hex_data) is True
    assert resolve_spell_duration_rounds(hex_data, 1) == 600
    assert resolve_spell_duration_rounds(hex_data, 3) == 4800
    assert resolve_spell_duration_rounds(hex_data, 5) == 14400

    options = hex_data.get("castOptions") or []
    assert {option["key"] for option in options} == {
        "strength",
        "dexterity",
        "constitution",
        "intelligence",
        "wisdom",
        "charisma",
    }


@pytest.mark.parametrize("transfer_available,expected", [(False, False), (True, True)])
def test_hex_transfer_action_visibility_depends_on_runtime_params(
    transfer_available: bool,
    expected: bool,
):
    raw_action = _hex_transfer_action()
    instance = SpellRuntimeInstance(
        id=1,
        campaign_id=1,
        spell_id="hex",
        spell_name="脆弱诅咒",
        caster_token_id=10,
        concentration_owner_token_id=10,
        primary_target_token_id=20,
        linked_target_token_ids=[20],
        selected_option="dexterity",
        params={
            "slot_level": 1,
            "transfer_available": transfer_available,
        },
        granted_actions=[raw_action],
        status="active",
    )

    action_ui = _build_runtime_action_ui(instance, raw_action, index=0)

    assert action_ui.available is expected
    assert action_ui.requires_target is True
    assert action_ui.action_id == "transfer_hex"
    assert action_ui.action_name == "转移诅咒"


def test_retarget_runtime_spell_buff_moves_visual_effect_to_new_target():
    instance = SpellRuntimeInstance(
        id=1,
        campaign_id=1,
        spell_id="hex",
        spell_name="脆弱诅咒",
        caster_token_id=10,
        concentration_owner_token_id=10,
        primary_target_token_id=20,
        linked_target_token_ids=[20],
        selected_option="strength",
        params={
            "selected_option_label": "力量",
        },
        granted_actions=[],
        status="active",
    )
    spell_data = get_spell_by_id("hex")

    old_target_effects = [
        {
            "id": "spell_buff_hex",
            "name": "脆弱诅咒",
            "spell_buff": True,
            "spell_id": "hex",
            "source_token_id": 10,
            "selected_option": "strength",
            "selected_option_label": "力量",
            "icon": "💀",
            "color": "#7c3aed",
        },
        {
            "id": "other_effect",
            "name": "别的效果",
        },
    ]
    new_target_effects = [
        {
            "id": "bless",
            "name": "祝福术",
            "spell_buff": True,
            "spell_id": "bless",
            "source_token_id": 99,
        },
    ]

    next_old_effects, next_new_effects = _move_runtime_spell_buffs_between_targets(
        instance,
        spell_data=spell_data,
        old_target_effects=old_target_effects,
        new_target_effects=new_target_effects,
    )

    assert next_old_effects == [{"id": "other_effect", "name": "别的效果"}]
    assert next_new_effects is not None
    assert len(next_new_effects) == 2
    moved_hex = next(effect for effect in next_new_effects if effect.get("spell_id") == "hex")
    assert moved_hex["source_token_id"] == 10
    assert moved_hex["selected_option"] == "strength"
    assert moved_hex["selected_option_label"] == "力量"
    assert moved_hex["spell_buff"] is True


def test_remove_runtime_spell_buffs_from_effects_cleans_only_matching_runtime_spell():
    instance = SpellRuntimeInstance(
        id=1,
        campaign_id=1,
        spell_id="hex",
        spell_name="脆弱诅咒",
        caster_token_id=10,
        concentration_owner_token_id=10,
        primary_target_token_id=20,
        linked_target_token_ids=[20],
        selected_option="strength",
        params={},
        granted_actions=[],
        status="active",
    )

    next_effects = _remove_runtime_spell_buffs_from_effects(
        instance,
        effects=[
            {
                "id": "spell_buff_hex",
                "name": "脆弱诅咒",
                "spell_buff": True,
                "spell_id": "hex",
                "source_token_id": 10,
            },
            {
                "id": "spell_buff_hex_other_source",
                "name": "脆弱诅咒",
                "spell_buff": True,
                "spell_id": "hex",
                "source_token_id": 99,
            },
            {
                "id": "spell_buff_bless",
                "name": "祝福术",
                "spell_buff": True,
                "spell_id": "bless",
                "source_token_id": 10,
            },
        ],
    )

    assert next_effects == [
        {
            "id": "spell_buff_hex_other_source",
            "name": "脆弱诅咒",
            "spell_buff": True,
            "spell_id": "hex",
            "source_token_id": 99,
        },
        {
            "id": "spell_buff_bless",
            "name": "祝福术",
            "spell_buff": True,
            "spell_id": "bless",
            "source_token_id": 10,
        },
    ]


def test_runtime_visual_spell_buff_inherits_world_time_expiry_from_instance_params():
    instance = SpellRuntimeInstance(
        id=1,
        campaign_id=1,
        spell_id="hex",
        spell_name="脆弱诅咒",
        caster_token_id=10,
        concentration_owner_token_id=10,
        primary_target_token_id=20,
        linked_target_token_ids=[20],
        selected_option="strength",
        params={
            "selected_option_label": "力量",
            "expires_at": {"day": 124, "hour": 7, "minute": 10, "second": 4},
        },
        granted_actions=[],
        status="active",
    )

    payload = _build_runtime_visual_spell_buff(instance, spell_data=get_spell_by_id("hex"))

    assert payload["expires_at"] == {"day": 124, "hour": 7, "minute": 10, "second": 4}


def test_build_spell_visual_projection_from_effect_keeps_token_filter_metadata():
    visual = _build_spell_visual_projection_from_effect(
        {
            "id": "spell_buff_blur",
            "name": "朦胧术",
            "spell_id": "blur",
            "icon": "🌫️",
            "color": "#a78bfa",
            "source_token_id": 10,
            "tokenFilter": {"blur": 3, "opacity": 0.75},
            "expires_at": {"day": 124, "hour": 7, "minute": 20, "second": 0},
            "duration": 10,
        }
    )

    assert visual is not None
    assert visual.visual_id == "spell_buff_blur"
    assert visual.spell_id == "blur"
    assert visual.token_filter == {"blur": 3, "opacity": 0.75}
    assert visual.expires_at.model_dump(mode="json") == {"day": 124, "hour": 7, "minute": 20, "second": 0}
    assert visual.duration_rounds == 10
    assert visual.remaining_rounds == 10


def test_legacy_spell_visual_projection_collects_token_filter_effects():
    token = Token(
        id=10,
        campaign_id=7,
        user_id="u",
        map_url="map",
        position_x=0,
        position_y=0,
        active_effects=[
            {
                "id": "spell_buff_blur",
                "name": "朦胧术",
                "spell_buff": True,
                "spell_id": "blur",
                "source_token_id": 10,
                "tokenFilter": {"blur": 3, "opacity": 0.75},
            },
            {
                "id": "bless",
                "name": "祝福术",
                "spell_buff": True,
                "spell_id": "bless",
            },
        ],
    )
    projection = {"spell_visuals": []}

    _append_legacy_spell_visual_projection(
        projection=projection,
        token=token,
    )

    assert projection["spell_visuals"] == [
        {
            "source": "legacy",
            "visual_id": "spell_buff_blur",
            "spell_id": "blur",
            "spell_name": "朦胧术",
            "icon": None,
            "color": None,
            "source_token_id": 10,
            "runtime_instance_id": None,
            "token_filter": {"blur": 3, "opacity": 0.75},
            "expires_at": None,
            "duration_rounds": None,
            "remaining_rounds": None,
        }
    ]


def test_legacy_granted_actions_projection_hides_hunters_mark_transfer_until_target_is_downed():
    token = Token(
        id=10,
        campaign_id=7,
        user_id="u",
        map_url="map",
        position_x=0,
        position_y=0,
        concentration_spell={
            "spell_id": "hunters_mark",
            "spell_name": "猎人印记",
            "slot_level": 1,
            "affected_token_ids": [42],
        },
    )
    projection = {"granted_actions_ui": []}

    _append_legacy_granted_actions_projection(
        projection=projection,
        token=token,
        token_hp_map={42: 12},
    )
    assert projection["granted_actions_ui"] == []

    _append_legacy_granted_actions_projection(
        projection=projection,
        token=token,
        token_hp_map={42: 0},
    )
    assert len(projection["granted_actions_ui"]) == 1
    action = projection["granted_actions_ui"][0]
    assert action["source"] == "legacy"
    assert action["spell_id"] == "hunters_mark"
    assert action["action_name"] == "转移猎人印记"


def test_legacy_granted_actions_projection_ignores_spell_buffs_from_other_casters():
    token = Token(
        id=10,
        campaign_id=7,
        user_id="u",
        map_url="map",
        position_x=0,
        position_y=0,
        active_effects=[
            {
                "id": "spell_buff_heat_metal",
                "name": "灼热金属",
                "spell_buff": True,
                "spell_id": "heat_metal",
                "source_token_id": 99,
            }
        ],
    )
    projection = {"granted_actions_ui": []}

    _append_legacy_granted_actions_projection(
        projection=projection,
        token=token,
        token_hp_map={},
    )

    assert projection["granted_actions_ui"] == []


def test_legacy_granted_actions_projection_surfaces_non_concentration_grant_action():
    """A non-concentration spell (Spiritual Weapon) whose legacy
    GrantActionHandler wrote a `grant_action` entry to active_effects — without
    a `spell_buff` marker — must still surface its repeatable bonus-action
    attack in granted_actions_ui. There is no concentration_spell to re-derive
    it, so the active_effects branch is the only path. Regression for the
    GrantActionParams attack-field cast fix (these spells used to 500)."""
    token = Token(
        id=10,
        campaign_id=7,
        user_id="u",
        map_url="map",
        position_x=0,
        position_y=0,
        concentration_spell=None,
        active_effects=[
            {
                "id": "spiritual_weapon_grant_action_灵体武器攻击",
                "name": "灵体武器",
                "effect_type": "grant_action",
                "spell_id": "spiritual_weapon",
                "source_token_id": 10,
                "action_name": "灵体武器攻击",
                "action_kind": "attack",
                "action_type": "bonus_action",
                "attack": {"type": "melee_spell", "on_miss": "no_effect"},
                "damage": {"formula": "1d8+MOD", "damage_type": "force"},
            }
        ],
    )
    projection = {"granted_actions_ui": []}

    _append_legacy_granted_actions_projection(
        projection=projection,
        token=token,
        token_hp_map={10: 200},
    )

    assert len(projection["granted_actions_ui"]) == 1
    action = projection["granted_actions_ui"][0]
    assert action["source"] == "legacy"
    assert action["spell_id"] == "spiritual_weapon"
    assert action["action_name"] == "灵体武器攻击"


def test_legacy_granted_actions_projection_dedupes_concentration_and_grant_action_effect():
    """A concentration spell (Flame Blade) surfaces its granted action via the
    concentration branch AND leaves a `grant_action` active_effect. The
    semantic-key dedup must keep granted_actions_ui at a single entry rather
    than double-counting once the active_effects branch also matches."""
    token = Token(
        id=10,
        campaign_id=7,
        user_id="u",
        map_url="map",
        position_x=0,
        position_y=0,
        concentration_spell={
            "spell_id": "flame_blade",
            "spell_name": "火焰刀",
            "slot_level": 2,
        },
        active_effects=[
            {
                "id": "flame_blade_grant_action_火焰刀攻击",
                "name": "火焰刀",
                "effect_type": "grant_action",
                "spell_id": "flame_blade",
                "source_token_id": 10,
                "action_name": "火焰刀攻击",
                "action_kind": "attack",
                "action_type": "action",
            }
        ],
    )
    projection = {"granted_actions_ui": []}

    _append_legacy_granted_actions_projection(
        projection=projection,
        token=token,
        token_hp_map={10: 200},
    )

    flame_blade_actions = [
        a for a in projection["granted_actions_ui"] if a["spell_id"] == "flame_blade"
    ]
    assert len(flame_blade_actions) == 1


def test_runtime_bonus_damage_roll_preserves_individual_dice(monkeypatch: pytest.MonkeyPatch):
    instance = SpellRuntimeInstance(
        id=1,
        campaign_id=1,
        spell_id="hex",
        spell_name="脆弱诅咒",
        caster_token_id=10,
        concentration_owner_token_id=10,
        primary_target_token_id=20,
        linked_target_token_ids=[20],
        selected_option="strength",
        params={},
        granted_actions=[],
        status="active",
    )

    def fake_eval_formula(_formula: str, _variables: dict):
        return FormulaResult(
            total=7,
            dice_groups=[DiceGroup(count=2, sides=6, rolls=[3, 4], total=7)],
            modifier=0,
            breakdown="2d6(3,4)",
        )

    monkeypatch.setattr("app.services.spell_runtime_service.eval_formula", fake_eval_formula)

    total, roll_data = _roll_runtime_damage(formula="2d6", instance=instance, critical=False)

    assert total == 7
    assert roll_data["roll"]["dice"] == "2d6"
    assert roll_data["roll"]["rolls"] == [3, 4]
    assert roll_data["roll"]["modifier"] == 0


def test_runtime_bonus_damage_critical_doubles_only_damage_dice(monkeypatch: pytest.MonkeyPatch):
    instance = SpellRuntimeInstance(
        id=1,
        campaign_id=1,
        spell_id="hex",
        spell_name="脆弱诅咒",
        caster_token_id=10,
        concentration_owner_token_id=10,
        primary_target_token_id=20,
        linked_target_token_ids=[20],
        selected_option="strength",
        params={},
        granted_actions=[],
        status="active",
    )

    rolls = iter(
        [
            FormulaResult(
                total=7,
                dice_groups=[DiceGroup(count=1, sides=6, rolls=[4], total=4)],
                modifier=3,
                breakdown="1d6(4)+3",
            ),
            FormulaResult(
                total=5,
                dice_groups=[DiceGroup(count=1, sides=6, rolls=[2], total=2)],
                modifier=3,
                breakdown="1d6(2)+3",
            ),
        ]
    )

    monkeypatch.setattr(
        "app.services.spell_runtime_service.eval_formula",
        lambda _formula, _variables: next(rolls),
    )

    total, roll_data = _roll_runtime_damage(formula="1d6+3", instance=instance, critical=True)

    assert total == 9
    assert roll_data["roll"]["dice"] == "2d6"
    assert roll_data["roll"]["rolls"] == [4, 2]
    assert roll_data["roll"]["modifier"] == 3


# ── Stage 2 — engine-delegated on_cast tests ─────────────────────────


def test_create_runtime_spell_instance_delegates_hex_on_cast_through_engine():
    db = _FakeAsyncSession()
    ctx = _make_hex_context(selected_option="strength")
    target = _make_target(token_id=20, name="哥布林")
    spell_data = get_spell_by_id("hex")
    assert spell_data is not None

    instance, result = asyncio.run(
        create_runtime_spell_instance(
            db,
            spell_data=spell_data,
            spell_context=ctx,
            targets=[target],
            slot_level=1,
        )
    )

    # Engine populates marked_token_id / marked_target_name via apply_mark.
    assert instance.params["marked_token_id"] == 20
    assert instance.params["marked_target_name"] == "哥布林"

    # Selected option metadata is preserved at the service layer.
    assert instance.params["selected_option"] == "strength"
    assert instance.params["selected_option_label"] == "力量"
    assert instance.selected_option == "strength"

    # Duration / expiry metadata.
    assert instance.duration_rounds == 600
    assert instance.params["expires_at"] == {"day": 1, "hour": 1, "minute": 0, "second": 0}

    # Concentration owner is set by the service layer, not by the engine.
    assert instance.concentration_owner_token_id == 10

    # Exactly one transfer_hex granted action (no duplicate from on_cast
    # phase running through the engine + non-on_cast pre-seeding).
    granted_ids = [action.get("action_id") for action in instance.granted_actions]
    assert granted_ids.count("transfer_hex") == 1
    assert len(instance.granted_actions) == 1

    # apply_token_filter is written into params by the engine, but the
    # service layer does not otherwise surface it on the instance row.
    assert isinstance(instance.params.get("token_filter"), dict)
    assert instance.params["token_filter"]

    # narrative_parts include both the base Hex narrative and the
    # apply_mark narrative produced by the engine.
    assert any("脆弱诅咒 标记了 哥布林" == part for part in result.narrative_parts)
    assert any("诅咒目标" in part for part in result.narrative_parts)

    # phase_results carry EffectResult entries with descriptions for
    # existing callers/tests to walk.
    assert result.phase_results
    descriptions = [
        effect.description
        for phase in result.phase_results
        for effect in phase
        if effect.description
    ]
    assert "脆弱诅咒 标记了 哥布林" in descriptions

    # Service still owns persistence.
    assert db.added == [instance]
    assert db.flushed == 1


def test_create_runtime_spell_instance_does_not_duplicate_grant_action_on_recompute():
    """The on_cast grant_action verb must not also be pre-seeded from
    non-on_cast iteration. Re-running on a fresh instance must still
    produce exactly one transfer_hex action.
    """
    db = _FakeAsyncSession()
    ctx = _make_hex_context(selected_option="dexterity")
    target = _make_target()
    spell_data = get_spell_by_id("hex")

    instance, _ = asyncio.run(
        create_runtime_spell_instance(
            db,
            spell_data=spell_data,
            spell_context=ctx,
            targets=[target],
            slot_level=1,
        )
    )

    grant_actions = [a for a in instance.granted_actions if a.get("action_id") == "transfer_hex"]
    assert len(grant_actions) == 1


def test_create_runtime_spell_instance_runs_engine_before_flush():
    """Engine must mutate params/granted_actions before db.add()/flush().

    Verified by snapshotting params on .add() — they should already contain
    the engine-derived keys (marked_token_id, token_filter).
    """
    captured: dict = {}

    class _SnapshottingDB(_FakeAsyncSession):
        def add(self, instance):
            captured["params_keys_on_add"] = set(instance.params.keys())
            captured["granted_actions_on_add"] = list(instance.granted_actions or [])
            super().add(instance)

    db = _SnapshottingDB()
    ctx = _make_hex_context()
    target = _make_target()
    spell_data = get_spell_by_id("hex")

    asyncio.run(
        create_runtime_spell_instance(
            db,
            spell_data=spell_data,
            spell_context=ctx,
            targets=[target],
            slot_level=1,
        )
    )

    assert "marked_token_id" in captured["params_keys_on_add"]
    assert "token_filter" in captured["params_keys_on_add"]
    assert any(a.get("action_id") == "transfer_hex" for a in captured["granted_actions_on_add"])


# ── Stage 3 — engine-delegated get_runtime_bonus_damage tests ────────


def _make_hex_runtime_instance(
    *,
    instance_id: int = 1,
    caster_token_id: int = 10,
    primary_target_token_id: int = 20,
    selected_option: str = "strength",
) -> SpellRuntimeInstance:
    return SpellRuntimeInstance(
        id=instance_id,
        campaign_id=1,
        spell_id="hex",
        spell_name="脆弱诅咒",
        caster_token_id=caster_token_id,
        concentration_owner_token_id=caster_token_id,
        primary_target_token_id=primary_target_token_id,
        linked_target_token_ids=[primary_target_token_id],
        selected_option=selected_option,
        params={"slot_level": 1, "spellcasting_mod": 3, "proficiency_bonus": 3, "caster_level": 5},
        granted_actions=[{"action_id": "transfer_hex"}],
        status="active",
    )


def _snapshot_instance(instance: SpellRuntimeInstance) -> dict:
    return {
        "params": dict(instance.params or {}),
        "granted_actions": [dict(a) for a in (instance.granted_actions or [])],
        "status": instance.status,
        "primary_target_token_id": instance.primary_target_token_id,
        "linked_target_token_ids": list(instance.linked_target_token_ids or []),
    }


def test_get_runtime_bonus_damage_delegates_hex_on_hit_through_engine(
    monkeypatch: pytest.MonkeyPatch,
):
    instance = _make_hex_runtime_instance()
    before = _snapshot_instance(instance)

    async def fake_loader(_db, _campaign_id):
        return [instance]

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )
    monkeypatch.setattr(
        "app.services.spell_runtime_engine.verbs.damage.eval_formula",
        lambda _formula, _vars: FormulaResult(
            total=4,
            dice_groups=[DiceGroup(count=1, sides=6, rolls=[4], total=4)],
            modifier=0,
            breakdown="1d6(4)",
        ),
    )

    bonuses = asyncio.run(
        get_runtime_bonus_damage(
            db=None,
            campaign_id=1,
            attacker_token_id=10,
            target_token_id=20,
            attack_kind="weapon",
            critical=False,
        )
    )

    assert len(bonuses) == 1
    bonus = bonuses[0]
    assert bonus.runtime_instance_id == 1
    assert bonus.spell_id == "hex"
    assert bonus.spell_name == "脆弱诅咒"
    assert bonus.damage == 4
    assert bonus.damage_type == "necrotic"
    assert bonus.formula == "1d6"
    assert "1d6(4)" in bonus.breakdown
    assert bonus.roll["rolls"] == [4]
    assert bonus.roll["dice"] == "1d6"

    # Read-only: instance must not be mutated by evaluation.
    after = _snapshot_instance(instance)
    assert after == before


def test_get_runtime_bonus_damage_returns_empty_for_non_matching_attacker_or_target(
    monkeypatch: pytest.MonkeyPatch,
):
    instance = _make_hex_runtime_instance(caster_token_id=10, primary_target_token_id=20)

    async def fake_loader(_db, _campaign_id):
        return [instance]

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )

    # Wrong attacker — should not even reach the engine, but still returns [].
    bonuses_wrong_attacker = asyncio.run(
        get_runtime_bonus_damage(
            db=None,
            campaign_id=1,
            attacker_token_id=999,
            target_token_id=20,
            attack_kind="weapon",
            critical=False,
        )
    )
    assert bonuses_wrong_attacker == []

    # Wrong target.
    bonuses_wrong_target = asyncio.run(
        get_runtime_bonus_damage(
            db=None,
            campaign_id=1,
            attacker_token_id=10,
            target_token_id=999,
            attack_kind="weapon",
            critical=False,
        )
    )
    assert bonuses_wrong_target == []


def test_get_runtime_bonus_damage_critical_flows_through_engine(
    monkeypatch: pytest.MonkeyPatch,
):
    instance = _make_hex_runtime_instance()

    async def fake_loader(_db, _campaign_id):
        return [instance]

    rolls = iter(
        [
            FormulaResult(
                total=4,
                dice_groups=[DiceGroup(count=1, sides=6, rolls=[4], total=4)],
                modifier=0,
                breakdown="1d6(4)",
            ),
            FormulaResult(
                total=2,
                dice_groups=[DiceGroup(count=1, sides=6, rolls=[2], total=2)],
                modifier=0,
                breakdown="1d6(2)",
            ),
        ]
    )

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )
    monkeypatch.setattr(
        "app.services.spell_runtime_engine.verbs.damage.eval_formula",
        lambda _formula, _vars: next(rolls),
    )

    bonuses = asyncio.run(
        get_runtime_bonus_damage(
            db=None,
            campaign_id=1,
            attacker_token_id=10,
            target_token_id=20,
            attack_kind="weapon",
            critical=True,
        )
    )

    assert len(bonuses) == 1
    bonus = bonuses[0]
    # Critical doubles the damage dice (4 + 2), modifier 0.
    assert bonus.damage == 6
    assert bonus.roll["dice"] == "2d6"
    assert bonus.roll["rolls"] == [4, 2]
    assert "暴击" in bonus.breakdown


# ── Stage 11 — Divine Favor self-buff bonus damage ───────────────────


def _make_divine_favor_runtime_instance(
    *,
    caster_token_id: int = 10,
) -> SpellRuntimeInstance:
    # Divine Favor is a self-buff: primary target == caster.
    return SpellRuntimeInstance(
        id=2,
        campaign_id=1,
        spell_id="divine_favor",
        spell_name="神恩",
        caster_token_id=caster_token_id,
        concentration_owner_token_id=caster_token_id,
        primary_target_token_id=caster_token_id,
        linked_target_token_ids=[caster_token_id],
        selected_option=None,
        params={"slot_level": 1, "spellcasting_mod": 3, "proficiency_bonus": 2, "caster_level": 3},
        granted_actions=[],
        status="active",
    )


def test_divine_favor_spell_declares_runtime_engine_v2():
    spell = get_spell_by_id("divine_favor")
    assert spell is not None
    assert (spell.get("runtime") or {}).get("engine") == "v2"
    assert spell_uses_runtime_engine(spell) is True
    # The hit-damage phase must be on_weapon_hit with target_match=any so the
    # bonus applies to any creature the caster hits, not only the primary.
    weapon_hit_phases = [
        phase for phase in spell.get("effects") or []
        if str(phase.get("trigger") or "") == "on_weapon_hit"
    ]
    assert weapon_hit_phases, "divine_favor must expose an on_weapon_hit phase"
    inner_effects = weapon_hit_phases[0].get("effects") or []
    assert any(
        e.get("type") == "conditional_extra_damage"
        and str(e.get("target_match") or "").lower() == "any"
        for e in inner_effects
    )


def test_get_runtime_bonus_damage_emits_divine_favor_for_non_primary_target(
    monkeypatch: pytest.MonkeyPatch,
):
    instance = _make_divine_favor_runtime_instance(caster_token_id=10)

    async def fake_loader(_db, _campaign_id):
        return [instance]

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )
    monkeypatch.setattr(
        "app.services.spell_runtime_engine.verbs.damage.eval_formula",
        lambda _formula, _vars: FormulaResult(
            total=3,
            dice_groups=[DiceGroup(count=1, sides=4, rolls=[3], total=3)],
            modifier=0,
            breakdown="1d4(3)",
        ),
    )

    # Caster (10) attacks an enemy (777) — primary target is the caster, but
    # divine_favor opts into target_match="any", so the bonus should fire.
    bonuses = asyncio.run(
        get_runtime_bonus_damage(
            db=None,
            campaign_id=1,
            attacker_token_id=10,
            target_token_id=777,
            attack_kind="weapon",
            critical=False,
        )
    )

    assert len(bonuses) == 1
    bonus = bonuses[0]
    assert bonus.spell_id == "divine_favor"
    assert bonus.damage == 3
    assert bonus.damage_type == "radiant"
    assert bonus.formula == "1d4"


def test_get_runtime_bonus_damage_divine_favor_skipped_on_spell_attack(
    monkeypatch: pytest.MonkeyPatch,
):
    instance = _make_divine_favor_runtime_instance(caster_token_id=10)

    async def fake_loader(_db, _campaign_id):
        return [instance]

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )

    # Spell attack should not trigger Divine Favor's weapon-only rider.
    bonuses = asyncio.run(
        get_runtime_bonus_damage(
            db=None,
            campaign_id=1,
            attacker_token_id=10,
            target_token_id=777,
            attack_kind="spell",
            critical=False,
        )
    )

    assert bonuses == []


# ── Stage 4 — engine-delegated execute_runtime_action tests ──────────


def _make_hex_transfer_instance(
    *,
    transfer_available: bool = True,
    primary_target_token_id: int = 20,
) -> SpellRuntimeInstance:
    raw_action = _hex_transfer_action()
    return SpellRuntimeInstance(
        id=1,
        campaign_id=7,
        spell_id="hex",
        spell_name="脆弱诅咒",
        caster_token_id=10,
        concentration_owner_token_id=10,
        primary_target_token_id=primary_target_token_id,
        linked_target_token_ids=[primary_target_token_id],
        selected_option="strength",
        params={
            "slot_level": 1,
            "spellcasting_mod": 3,
            "proficiency_bonus": 3,
            "caster_level": 5,
            "marked_token_id": primary_target_token_id,
            "marked_target_name": "哥布林",
            "transfer_available": transfer_available,
        },
        granted_actions=[raw_action],
        status="active",
    )


class _GetByIdDB(_FakeAsyncSession):
    """Async-session stub that resolves db.get(Model, id) from a dict."""

    def __init__(self, instances=None, tokens=None):
        super().__init__()
        self._instances = {inst.id: inst for inst in (instances or [])}
        self._tokens = {tok.id: tok for tok in (tokens or [])}
        self.commits = 0

    async def get(self, model, ident):
        if model is SpellRuntimeInstance:
            return self._instances.get(ident)
        if model is Token:
            return self._tokens.get(ident)
        return None

    async def commit(self):
        self.commits += 1


def test_execute_runtime_action_delegates_hex_transfer_through_engine(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import execute_runtime_action

    instance = _make_hex_transfer_instance()
    db = _GetByIdDB(instances=[instance])

    sync_calls = []

    async def fake_sync(_db, *, instance, spell_data, old_target_token_id, new_target_token_id):
        sync_calls.append((old_target_token_id, new_target_token_id))
        return []

    publish_active_calls = []

    async def fake_publish_active(campaign_id, **kwargs):
        publish_active_calls.append((campaign_id, kwargs))

    publish_projection_calls = []

    async def fake_publish_projection(_db, *, campaign_id, token_ids):
        publish_projection_calls.append((campaign_id, list(token_ids)))

    monkeypatch.setattr(
        spell_runtime_service,
        "_sync_runtime_visual_spell_buff_targets",
        fake_sync,
    )
    monkeypatch.setattr(
        spell_runtime_service.realtime_publisher,
        "publish_token_active_effects_updated",
        fake_publish_active,
    )
    monkeypatch.setattr(
        spell_runtime_service,
        "publish_runtime_projection_updates",
        fake_publish_projection,
    )

    result_instance, touched = asyncio.run(
        execute_runtime_action(
            db,
            runtime_instance_id=1,
            action_id="transfer_hex",
            actor_token_id=10,
            target_token_id=77,
        )
    )

    # Engine-driven Hex transfer state.
    assert result_instance is instance
    assert instance.primary_target_token_id == 77
    assert instance.linked_target_token_ids == [77]
    assert instance.params["marked_token_id"] == 77
    assert "transfer_available" not in instance.params

    # Visual sync called once with previous + new primary target.
    assert sync_calls == [(20, 77)]

    # Touched ids include caster, previous target, new target.
    assert touched == sorted({10, 20, 77})
    assert publish_projection_calls == [(7, sorted({10, 20, 77}))]

    # No effect-sync tokens returned, so no per-token active-effect publishing.
    assert publish_active_calls == []
    assert db.commits == 1


def test_execute_runtime_action_publishes_sync_tokens_active_effects(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import execute_runtime_action

    instance = _make_hex_transfer_instance()
    old_token = Token(
        id=20,
        campaign_id=7,
        user_id="u",
        map_url="map",
        position_x=0,
        position_y=0,
        character_id=101,
        monster_instance_id=None,
        active_effects=[],
    )
    new_token = Token(
        id=77,
        campaign_id=7,
        user_id="u",
        map_url="map",
        position_x=0,
        position_y=0,
        character_id=None,
        monster_instance_id=202,
        active_effects=[{"id": "spell_buff_hex", "spell_buff": True, "spell_id": "hex"}],
    )
    db = _GetByIdDB(instances=[instance], tokens=[old_token, new_token])

    async def fake_sync(_db, *, instance, spell_data, old_target_token_id, new_target_token_id):
        return [old_token, new_token]

    publish_active_calls = []

    async def fake_publish_active(campaign_id, **kwargs):
        publish_active_calls.append((campaign_id, kwargs["token_id"]))

    publish_projection_calls = []

    async def fake_publish_projection(_db, *, campaign_id, token_ids):
        publish_projection_calls.append((campaign_id, list(token_ids)))

    monkeypatch.setattr(
        spell_runtime_service,
        "_sync_runtime_visual_spell_buff_targets",
        fake_sync,
    )
    monkeypatch.setattr(
        spell_runtime_service.realtime_publisher,
        "publish_token_active_effects_updated",
        fake_publish_active,
    )
    monkeypatch.setattr(
        spell_runtime_service,
        "publish_runtime_projection_updates",
        fake_publish_projection,
    )

    asyncio.run(
        execute_runtime_action(
            db,
            runtime_instance_id=1,
            action_id="transfer_hex",
            actor_token_id=10,
            target_token_id=77,
        )
    )

    assert publish_active_calls == [(7, 20), (7, 77)]
    assert publish_projection_calls == [(7, sorted({10, 20, 77}))]


def test_execute_runtime_action_retargets_concentration_affected_token_ids(
    monkeypatch: pytest.MonkeyPatch,
):
    """A Hex transfer must rewrite the concentration owner's
    ``concentration_spell.affected_token_ids`` from the old target to the new
    one, so a later concentration break sweeps the new target's spell buff."""
    from app.services.spell_runtime_service import execute_runtime_action

    instance = _make_hex_transfer_instance()
    owner_token = Token(
        id=10,
        campaign_id=7,
        user_id="u",
        map_url="map",
        position_x=0,
        position_y=0,
        character_id=303,
        monster_instance_id=None,
        active_effects=[],
        concentration_spell={
            "spell_id": "hex",
            "spell_name": "脆弱诅咒",
            "slot_level": 1,
            "affected_token_ids": [20],
            "linked_token_ids": [20],
        },
    )
    db = _GetByIdDB(instances=[instance], tokens=[owner_token])

    async def fake_sync(_db, *, instance, spell_data, old_target_token_id, new_target_token_id):
        return []

    concentration_publishes = []

    async def fake_publish_concentration(campaign_id, **kwargs):
        concentration_publishes.append((campaign_id, kwargs["token_id"], kwargs["concentration_spell"]))

    async def fake_publish_active(*args, **kwargs):
        return None

    async def fake_publish_projection(_db, *, campaign_id, token_ids):
        return None

    monkeypatch.setattr(
        spell_runtime_service,
        "_sync_runtime_visual_spell_buff_targets",
        fake_sync,
    )
    monkeypatch.setattr(
        spell_runtime_service.realtime_publisher,
        "publish_token_active_effects_updated",
        fake_publish_active,
    )
    monkeypatch.setattr(
        spell_runtime_service.realtime_publisher,
        "publish_token_concentration_updated",
        fake_publish_concentration,
    )
    monkeypatch.setattr(
        spell_runtime_service,
        "publish_runtime_projection_updates",
        fake_publish_projection,
    )

    result_instance, touched = asyncio.run(
        execute_runtime_action(
            db,
            runtime_instance_id=1,
            action_id="transfer_hex",
            actor_token_id=10,
            target_token_id=77,
        )
    )

    # Engine retargeted the runtime primary target.
    assert result_instance.primary_target_token_id == 77

    # Concentration owner's target lists now reference the new target only.
    assert owner_token.concentration_spell["affected_token_ids"] == [77]
    assert owner_token.concentration_spell["linked_token_ids"] == [77]

    # Owner token is included in touched ids and a concentration update is published.
    assert 10 in touched
    assert concentration_publishes == [
        (7, 10, owner_token.concentration_spell),
    ]


def test_execute_runtime_action_skips_concentration_sync_without_owner_record(
    monkeypatch: pytest.MonkeyPatch,
):
    """When the concentration owner token is absent (e.g. no concentration
    metadata persisted), the transfer still succeeds and no concentration
    update is published."""
    from app.services.spell_runtime_service import execute_runtime_action

    instance = _make_hex_transfer_instance()
    db = _GetByIdDB(instances=[instance])  # no owner token in db

    async def fake_sync(*args, **kwargs):
        return []

    concentration_publishes = []

    async def fake_publish_concentration(campaign_id, **kwargs):
        concentration_publishes.append(campaign_id)

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(
        spell_runtime_service, "_sync_runtime_visual_spell_buff_targets", fake_sync
    )
    monkeypatch.setattr(
        spell_runtime_service.realtime_publisher,
        "publish_token_active_effects_updated",
        noop,
    )
    monkeypatch.setattr(
        spell_runtime_service.realtime_publisher,
        "publish_token_concentration_updated",
        fake_publish_concentration,
    )
    monkeypatch.setattr(
        spell_runtime_service, "publish_runtime_projection_updates", noop
    )

    result_instance, _ = asyncio.run(
        execute_runtime_action(
            db,
            runtime_instance_id=1,
            action_id="transfer_hex",
            actor_token_id=10,
            target_token_id=77,
        )
    )

    assert result_instance.primary_target_token_id == 77
    assert concentration_publishes == []


def test_execute_runtime_action_missing_target_raises_before_engine(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import execute_runtime_action

    instance = _make_hex_transfer_instance()
    db = _GetByIdDB(instances=[instance])

    sync_called = False
    publish_active_called = False
    publish_projection_called = False
    engine_called = False

    async def fake_sync(*args, **kwargs):
        nonlocal sync_called
        sync_called = True
        return []

    async def fake_publish_active(*args, **kwargs):
        nonlocal publish_active_called
        publish_active_called = True

    async def fake_publish_projection(*args, **kwargs):
        nonlocal publish_projection_called
        publish_projection_called = True

    async def fake_execute_phase(*args, **kwargs):
        nonlocal engine_called
        engine_called = True
        from app.services.spell_runtime_engine import PhaseResult
        return PhaseResult()

    monkeypatch.setattr(
        spell_runtime_service,
        "_sync_runtime_visual_spell_buff_targets",
        fake_sync,
    )
    monkeypatch.setattr(
        spell_runtime_service.realtime_publisher,
        "publish_token_active_effects_updated",
        fake_publish_active,
    )
    monkeypatch.setattr(
        spell_runtime_service,
        "publish_runtime_projection_updates",
        fake_publish_projection,
    )
    monkeypatch.setattr(spell_runtime_service, "execute_phase", fake_execute_phase)

    with pytest.raises(ValueError, match="requires a target token"):
        asyncio.run(
            execute_runtime_action(
                db,
                runtime_instance_id=1,
                action_id="transfer_hex",
                actor_token_id=10,
                target_token_id=None,
            )
        )

    # Engine and downstream side-effects must not run when validation fails.
    assert engine_called is False
    assert sync_called is False
    assert publish_active_called is False
    assert publish_projection_called is False
    # Instance state untouched.
    assert instance.primary_target_token_id == 20
    assert instance.params["transfer_available"] is True


# ── Stage 5 — engine-delegated downed / concentration-end tests ──────


def test_notify_target_downed_delegates_hex_on_target_downed_through_engine(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import notify_target_downed

    instance = _make_hex_transfer_instance(transfer_available=False)
    db = _GetByIdDB(instances=[instance])

    async def fake_loader(_db, _campaign_id):
        return [instance]

    publish_projection_calls = []

    async def fake_publish_projection(_db, *, campaign_id, token_ids):
        publish_projection_calls.append((campaign_id, list(token_ids)))

    # Wrap the real engine so we can assert delegation through the same path.
    real_execute_phase = spell_runtime_service.execute_phase
    invocations: list[tuple[str, dict]] = []

    async def spying_execute_phase(db_arg, inst, trigger, ctx_overrides=None, *, spell_data=None, apply=True):
        invocations.append((trigger, dict(ctx_overrides or {})))
        return await real_execute_phase(
            db_arg, inst, trigger, ctx_overrides, spell_data=spell_data, apply=apply
        )

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )
    monkeypatch.setattr(
        spell_runtime_service,
        "publish_runtime_projection_updates",
        fake_publish_projection,
    )
    monkeypatch.setattr(spell_runtime_service, "execute_phase", spying_execute_phase)

    touched = asyncio.run(
        notify_target_downed(
            db,
            campaign_id=7,
            target_token_id=20,
        )
    )

    assert invocations and invocations[0][0] == "on_target_downed"
    assert invocations[0][1]["target_token_id"] == 20

    # Engine set transfer_available via set_runtime_param.
    assert instance.params["transfer_available"] is True
    assert touched == sorted({10, 20})
    assert publish_projection_calls == [(7, sorted({10, 20}))]
    assert db.commits == 1


def test_notify_target_downed_no_op_when_transfer_already_available(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import notify_target_downed

    instance = _make_hex_transfer_instance(transfer_available=True)
    db = _GetByIdDB(instances=[instance])

    async def fake_loader(_db, _campaign_id):
        return [instance]

    publish_projection_calls = []

    async def fake_publish_projection(_db, *, campaign_id, token_ids):
        publish_projection_calls.append((campaign_id, list(token_ids)))

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )
    monkeypatch.setattr(
        spell_runtime_service,
        "publish_runtime_projection_updates",
        fake_publish_projection,
    )

    touched = asyncio.run(
        notify_target_downed(
            db,
            campaign_id=7,
            target_token_id=20,
        )
    )

    assert touched == []
    assert publish_projection_calls == []
    assert db.commits == 0
    assert instance.params["transfer_available"] is True


def test_end_concentration_runtime_instances_delegates_hex_through_engine(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import end_concentration_runtime_instances

    instance = _make_hex_transfer_instance(transfer_available=True)

    class _SelectDB(_FakeAsyncSession):
        def __init__(self, instances):
            super().__init__()
            self._instances = list(instances)

        async def execute(self, _stmt):
            instances = self._instances

            class _Scalars:
                def all(self_inner):
                    return list(instances)

            class _Result:
                def scalars(self_inner):
                    return _Scalars()

            return _Result()

    db = _SelectDB([instance])

    real_execute_phase = spell_runtime_service.execute_phase
    invocations: list[str] = []

    async def spying_execute_phase(db_arg, inst, trigger, ctx_overrides=None, *, spell_data=None, apply=True):
        invocations.append(trigger)
        return await real_execute_phase(
            db_arg, inst, trigger, ctx_overrides, spell_data=spell_data, apply=apply
        )

    monkeypatch.setattr(spell_runtime_service, "execute_phase", spying_execute_phase)

    touched = asyncio.run(
        end_concentration_runtime_instances(
            db,
            campaign_id=7,
            concentration_owner_token_ids=[10],
        )
    )

    assert invocations == ["on_concentration_end"]
    # Engine's end_spell_instance verb + service fallback both converge on ended.
    assert instance.status == "ended"
    # Touched ids include caster + primary target; engine also reports them.
    assert touched == sorted({10, 20})
    # Service flushes (does not commit / publish — caller owns realtime).
    assert db.flushed == 1


# ── Stage 6: get_token_runtime_modifier_effects via read-only evaluate_phase ──


def _snapshot_instance(instance: SpellRuntimeInstance) -> dict:
    return {
        "params": dict(instance.params or {}),
        "status": instance.status,
        "primary_target_token_id": instance.primary_target_token_id,
        "linked_target_token_ids": list(instance.linked_target_token_ids or []),
        "granted_actions": [dict(a) for a in (instance.granted_actions or [])],
    }


def test_get_token_runtime_modifier_effects_delegates_to_engine_on_cast(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import get_token_runtime_modifier_effects

    instance = _make_hex_transfer_instance()
    db = _GetByIdDB(instances=[instance])

    async def fake_loader(_db, _campaign_id):
        return [instance]

    real_evaluate_phase = spell_runtime_service.evaluate_phase
    invocations: list[tuple[str, dict, bool]] = []

    async def spying_evaluate_phase(db_arg, inst, trigger, ctx_overrides=None, *, spell_data=None):
        invocations.append((trigger, dict(ctx_overrides or {}), inst is instance))
        return await real_evaluate_phase(
            db_arg, inst, trigger, ctx_overrides, spell_data=spell_data
        )

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )
    monkeypatch.setattr(spell_runtime_service, "evaluate_phase", spying_evaluate_phase)

    effects = asyncio.run(
        get_token_runtime_modifier_effects(db, campaign_id=7, token_id=20)
    )

    # Engine was invoked exactly once for this matching instance with on_cast.
    assert invocations == [("on_cast", {}, True)]

    # Hex strength on_cast emits a single grant_disadvantage modifier envelope.
    assert len(effects) == 1
    envelope = effects[0]
    assert envelope["id"] == f"spell_runtime_{instance.id}_grant_disadvantage"
    assert envelope["name"] == instance.spell_name
    assert envelope["spell_id"] == "hex"
    assert envelope["spell_runtime"] is True
    assert len(envelope["modifiers"]) == 1
    modifier = envelope["modifiers"][0]
    assert modifier["target"] == "ability_check"
    assert modifier["type"] == "disadvantage"
    assert modifier["condition"] == {"ability": "strength"}


def test_get_token_runtime_modifier_effects_is_read_only_under_mutating_effects(
    monkeypatch: pytest.MonkeyPatch,
):
    """Even with mutating verbs in on_cast (apply_mark, grant_action,
    set_runtime_param, end_spell_instance), projection must not mutate
    the instance because evaluate_phase uses apply=False."""
    from app.services.spell_runtime_service import get_token_runtime_modifier_effects

    instance = _make_hex_transfer_instance()
    # Inject extra mutating verbs into the spell on_cast phase by wrapping
    # get_spell_by_id with a synthetic phase set.
    synthetic_spell = {
        "id": "synthetic_modifier_test",
        "name": "Synthetic Modifier Test",
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [
                    {"type": "grant_advantage", "on": "saving_throw"},
                    {"type": "grant_resistance", "damage_types": ["fire"]},
                    {"type": "set_runtime_param", "key": "marked_token_id", "value": 999},
                    {"type": "grant_action", "action": {"id": "ghost_action", "name": "Ghost"}},
                    {"type": "end_spell_instance"},
                ],
            }
        ],
    }
    # Switch instance over to the synthetic spell so engine reads it.
    instance.spell_id = "synthetic_modifier_test"
    instance.spell_name = "Synthetic Modifier Test"
    instance.selected_option = None

    def fake_get_spell_by_id(spell_id):
        if spell_id == "synthetic_modifier_test":
            return synthetic_spell
        return None

    async def fake_loader(_db, _campaign_id):
        return [instance]

    monkeypatch.setattr(spell_runtime_service, "get_spell_by_id", fake_get_spell_by_id)
    monkeypatch.setattr(
        "app.services.spell_runtime_engine.phase_executor.get_spell_by_id",
        fake_get_spell_by_id,
    )
    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )

    db = _GetByIdDB(instances=[instance])
    before = _snapshot_instance(instance)

    effects = asyncio.run(
        get_token_runtime_modifier_effects(db, campaign_id=7, token_id=20)
    )

    after = _snapshot_instance(instance)
    assert after == before, "evaluate_phase must not mutate runtime instance"
    assert db.commits == 0

    # Modifier envelopes from grant_advantage and grant_resistance are returned.
    modifier_targets = {e["modifiers"][0]["target"] for e in effects}
    modifier_types = {e["modifiers"][0]["type"] for e in effects}
    assert "saving_throw" in modifier_targets
    assert "damage_taken" in modifier_targets
    assert {"advantage", "resistance"}.issubset(modifier_types)


def test_get_token_runtime_modifier_effects_skips_non_matching_and_missing_spell(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import get_token_runtime_modifier_effects

    matching = _make_hex_transfer_instance()
    other_target = _make_hex_transfer_instance(primary_target_token_id=77)
    other_target.id = 2
    missing_spell = _make_hex_transfer_instance()
    missing_spell.id = 3
    missing_spell.spell_id = "no_such_spell"

    async def fake_loader(_db, _campaign_id):
        return [other_target, missing_spell, matching]

    invocations: list[int] = []

    real_evaluate_phase = spell_runtime_service.evaluate_phase

    async def spying_evaluate_phase(db_arg, inst, trigger, ctx_overrides=None, *, spell_data=None):
        invocations.append(inst.id)
        return await real_evaluate_phase(
            db_arg, inst, trigger, ctx_overrides, spell_data=spell_data
        )

    real_get_spell_by_id = spell_runtime_service.get_spell_by_id

    def fake_get_spell_by_id(spell_id):
        if spell_id == "no_such_spell":
            return None
        return real_get_spell_by_id(spell_id)

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )
    monkeypatch.setattr(spell_runtime_service, "get_spell_by_id", fake_get_spell_by_id)
    monkeypatch.setattr(spell_runtime_service, "evaluate_phase", spying_evaluate_phase)

    db = _GetByIdDB(instances=[matching, other_target, missing_spell])
    effects = asyncio.run(
        get_token_runtime_modifier_effects(db, campaign_id=7, token_id=20)
    )

    # Only the matching instance triggers evaluate_phase.
    assert invocations == [matching.id]
    # And produces the Hex grant_disadvantage envelope.
    assert len(effects) == 1
    assert effects[0]["spell_id"] == "hex"


# ── Stage 8: combat turn-trigger dispatch tests ────────────────────────


def _make_minimal_runtime_instance(
    *,
    instance_id: int = 100,
    campaign_id: int = 7,
    caster_token_id: int = 10,
    primary_target_token_id: int | None = 20,
    linked_target_token_ids: list[int] | None = None,
    status: str = "active",
) -> SpellRuntimeInstance:
    """Minimal active runtime instance for turn-trigger tests.

    Uses spell_id='hex' so get_spell_by_id resolves to real data; the test
    spies on execute_phase, so the underlying phases are irrelevant.
    """
    return SpellRuntimeInstance(
        id=instance_id,
        campaign_id=campaign_id,
        spell_id="hex",
        spell_name="脆弱诅咒",
        caster_token_id=caster_token_id,
        concentration_owner_token_id=caster_token_id,
        primary_target_token_id=primary_target_token_id,
        linked_target_token_ids=(
            list(linked_target_token_ids)
            if linked_target_token_ids is not None
            else ([primary_target_token_id] if primary_target_token_id else [])
        ),
        selected_option="strength",
        params={"slot_level": 1},
        granted_actions=[],
        status=status,
    )


def _make_turn_trigger_db(instances: list[SpellRuntimeInstance]):
    """Async session stub that returns ``instances`` for select() and tracks commit."""

    class _TurnDB(_FakeAsyncSession):
        def __init__(self, items):
            super().__init__()
            self._items = list(items)
            self.commits = 0

        async def execute(self, _stmt):
            items = self._items

            class _Scalars:
                def all(self_inner):
                    return list(items)

            class _Result:
                def scalars(self_inner):
                    return _Scalars()

            return _Result()

        async def commit(self):
            self.commits += 1

    return _TurnDB(instances)


def _install_turn_trigger_spies(
    monkeypatch: pytest.MonkeyPatch,
    instances: list[SpellRuntimeInstance],
    *,
    state_changes: dict[int, str] | None = None,
):
    """Patch loader / publisher / execute_phase. Returns invocations list.

    ``state_changes`` maps instance_id -> trigger that should mutate that
    instance's status to "ended" when fired, simulating engine apply behavior.
    """
    invocations: list[tuple[int, str, dict]] = []

    async def fake_loader(_db, _campaign_id):
        return list(instances)

    publish_calls: list[tuple[int, list[int]]] = []

    async def fake_publish(_db, *, campaign_id, token_ids):
        publish_calls.append((campaign_id, list(token_ids)))

    changes = dict(state_changes or {})

    async def fake_execute_phase(
        db_arg, inst, trigger, ctx_overrides=None, *, spell_data=None, apply=True
    ):
        invocations.append((inst.id, trigger, dict(ctx_overrides or {})))
        result = spell_runtime_service.PhaseResult() if False else None
        # Import here to avoid touching module-level imports.
        from app.services.spell_runtime_engine.context import PhaseResult

        result = PhaseResult()
        if changes.get(inst.id) == trigger and apply:
            inst.status = "ended"
        return result

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )
    monkeypatch.setattr(
        spell_runtime_service,
        "publish_runtime_projection_updates",
        fake_publish,
    )
    monkeypatch.setattr(spell_runtime_service, "execute_phase", fake_execute_phase)
    return invocations, publish_calls


def test_execute_runtime_turn_triggers_fires_actor_and_target_triggers(
    monkeypatch: pytest.MonkeyPatch,
):
    """End-of-turn for the active token must fire end_of_turn on its caster
    instances and end_of_target_turn on instances that mark it as target."""
    from app.services.spell_runtime_service import execute_runtime_turn_triggers

    # Caster-of-active: token 10 casts spell instance #1 on target 20.
    caster_inst = _make_minimal_runtime_instance(
        instance_id=1, caster_token_id=10, primary_target_token_id=20
    )
    # Target-of-active: token 99 casts on token 10.
    target_inst = _make_minimal_runtime_instance(
        instance_id=2, caster_token_id=99, primary_target_token_id=10
    )
    # Unrelated instance: neither caster nor target is token 10.
    unrelated = _make_minimal_runtime_instance(
        instance_id=3, caster_token_id=50, primary_target_token_id=60
    )

    db = _make_turn_trigger_db([caster_inst, target_inst, unrelated])
    invocations, publish_calls = _install_turn_trigger_spies(
        monkeypatch,
        [caster_inst, target_inst, unrelated],
        # Force at least one instance to mutate so the helper commits/publishes.
        state_changes={1: "end_of_turn"},
    )

    touched = asyncio.run(
        execute_runtime_turn_triggers(
            db,
            campaign_id=7,
            ending_token_id=10,
            starting_token_id=None,
            current_round=3,
        )
    )

    triggers_by_instance = {(inst_id, trig) for inst_id, trig, _ in invocations}
    # Caster-of-active fires end_of_turn.
    assert (1, "end_of_turn") in triggers_by_instance
    # Target-of-active fires end_of_target_turn.
    assert (2, "end_of_target_turn") in triggers_by_instance
    # No start_* triggers since starting_token_id is None.
    assert all(not t.startswith("start_of_") for _, t, _ in invocations)
    # Unrelated instance was never dispatched against.
    assert all(inst_id != 3 for inst_id, _, _ in invocations)
    # Round / target ctx are propagated.
    for inst_id, trig, ctx in invocations:
        assert ctx.get("current_round") == 3
        if trig == "end_of_target_turn":
            assert ctx.get("target_token_id") == 10
    # Mutation propagated commit + publish.
    assert db.commits == 1
    assert publish_calls and publish_calls[0][0] == 7
    assert touched and 10 in touched


def test_execute_runtime_turn_triggers_dispatches_start_triggers_only_when_starting(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import execute_runtime_turn_triggers

    caster_inst = _make_minimal_runtime_instance(
        instance_id=1, caster_token_id=10, primary_target_token_id=20
    )
    target_inst = _make_minimal_runtime_instance(
        instance_id=2, caster_token_id=99, primary_target_token_id=10
    )

    db = _make_turn_trigger_db([caster_inst, target_inst])
    invocations, _ = _install_turn_trigger_spies(
        monkeypatch, [caster_inst, target_inst]
    )

    asyncio.run(
        execute_runtime_turn_triggers(
            db,
            campaign_id=7,
            ending_token_id=None,
            starting_token_id=10,
            current_round=4,
        )
    )

    triggers = {(inst_id, trig) for inst_id, trig, _ in invocations}
    assert (1, "start_of_turn") in triggers
    assert (2, "start_of_target_turn") in triggers
    assert all(not t.startswith("end_of_") for _, t, _ in invocations)
    # Nothing changed, so no commit / publish.
    assert db.commits == 0


def test_execute_runtime_turn_triggers_is_noop_when_nothing_changes(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import execute_runtime_turn_triggers

    inst = _make_minimal_runtime_instance(
        instance_id=1, caster_token_id=10, primary_target_token_id=20
    )
    db = _make_turn_trigger_db([inst])
    invocations, publish_calls = _install_turn_trigger_spies(monkeypatch, [inst])

    touched = asyncio.run(
        execute_runtime_turn_triggers(
            db,
            campaign_id=7,
            ending_token_id=10,
            starting_token_id=20,
            current_round=2,
        )
    )

    # Triggers dispatched but no state mutation -> no commit, no publish.
    assert invocations  # we still call execute_phase to evaluate matches
    assert db.commits == 0
    assert publish_calls == []
    assert touched == []


def test_execute_runtime_turn_triggers_skips_when_both_tokens_none():
    from app.services.spell_runtime_service import execute_runtime_turn_triggers

    db = _make_turn_trigger_db([])
    touched = asyncio.run(
        execute_runtime_turn_triggers(
            db, campaign_id=7, ending_token_id=None, starting_token_id=None
        )
    )
    assert touched == []
    assert db.commits == 0


def test_execute_runtime_turn_triggers_linked_target_match(
    monkeypatch: pytest.MonkeyPatch,
):
    """end_of_target_turn fires for tokens listed in linked_target_token_ids."""
    from app.services.spell_runtime_service import execute_runtime_turn_triggers

    inst = _make_minimal_runtime_instance(
        instance_id=1,
        caster_token_id=10,
        primary_target_token_id=20,
        linked_target_token_ids=[20, 30],
    )
    db = _make_turn_trigger_db([inst])
    invocations, _ = _install_turn_trigger_spies(monkeypatch, [inst])

    asyncio.run(
        execute_runtime_turn_triggers(
            db,
            campaign_id=7,
            ending_token_id=30,
            starting_token_id=None,
        )
    )

    triggers = {(inst_id, trig) for inst_id, trig, _ in invocations}
    assert (1, "end_of_target_turn") in triggers
    # Caster is not token 30, so no end_of_turn.
    assert (1, "end_of_turn") not in triggers


def test_execute_runtime_turn_triggers_skips_ended_instance_mid_loop(
    monkeypatch: pytest.MonkeyPatch,
):
    """When end_of_turn ends the instance, end_of_target_turn must not fire."""
    from app.services.spell_runtime_service import execute_runtime_turn_triggers

    # Same token is both caster and primary target -> end_of_turn + end_of_target_turn
    # would both match unless we short-circuit after status becomes "ended".
    inst = _make_minimal_runtime_instance(
        instance_id=1, caster_token_id=10, primary_target_token_id=10
    )
    db = _make_turn_trigger_db([inst])
    invocations, _ = _install_turn_trigger_spies(
        monkeypatch, [inst], state_changes={1: "end_of_turn"}
    )

    asyncio.run(
        execute_runtime_turn_triggers(
            db,
            campaign_id=7,
            ending_token_id=10,
            starting_token_id=None,
        )
    )

    triggers = [trig for _, trig, _ in invocations]
    assert "end_of_turn" in triggers
    # end_of_target_turn must NOT fire after status flipped to "ended".
    assert "end_of_target_turn" not in triggers


# ── Stage 10: zone-trigger dispatch tests ─────────────────────────────


def _install_zone_trigger_spies(
    monkeypatch: pytest.MonkeyPatch,
    instances: list[SpellRuntimeInstance],
):
    """Patch loader / publisher / execute_phase for zone-trigger tests.

    Unlike the turn-trigger spy, this one marks every dispatch as "changed"
    via PhaseResult.touched_token_ids without flipping instance status, so
    we can verify that all requested target tokens are dispatched.
    """
    invocations: list[tuple[int, str, dict]] = []
    publish_calls: list[tuple[int, list[int]]] = []

    async def fake_loader(_db, _campaign_id):
        return list(instances)

    async def fake_publish(_db, *, campaign_id, token_ids):
        publish_calls.append((campaign_id, list(token_ids)))

    async def fake_execute_phase(
        _db, inst, trigger, ctx_overrides=None, *, spell_data=None, apply=True
    ):
        from app.services.spell_runtime_engine.context import PhaseResult

        invocations.append((inst.id, trigger, dict(ctx_overrides or {})))
        result = PhaseResult()
        target_token_id = (ctx_overrides or {}).get("target_token_id")
        if target_token_id is not None:
            result.touched_token_ids.add(int(target_token_id))
        return result

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )
    monkeypatch.setattr(
        spell_runtime_service,
        "publish_runtime_projection_updates",
        fake_publish,
    )
    monkeypatch.setattr(spell_runtime_service, "execute_phase", fake_execute_phase)
    return invocations, publish_calls


def test_execute_runtime_zone_triggers_fires_on_enter_for_each_target(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import execute_runtime_zone_triggers

    matching = _make_minimal_runtime_instance(
        instance_id=1, caster_token_id=10, primary_target_token_id=None
    )
    unrelated_caster = _make_minimal_runtime_instance(
        instance_id=2, caster_token_id=99, primary_target_token_id=None
    )

    db = _make_turn_trigger_db([matching, unrelated_caster])
    invocations, publish_calls = _install_zone_trigger_spies(
        monkeypatch, [matching, unrelated_caster]
    )

    touched = asyncio.run(
        execute_runtime_zone_triggers(
            db,
            campaign_id=7,
            caster_token_id=10,
            spell_id="hex",
            target_token_ids=[21, 22],
            timing="enter",
        )
    )

    # Only the matching caster's instance is dispatched against.
    assert all(inst_id == 1 for inst_id, _, _ in invocations)
    triggers = {trig for _, trig, _ in invocations}
    assert triggers == {"on_enter_zone"}
    ctx_seen = [ctx for _, _, ctx in invocations]
    zone_targets = {ctx.get("zone_token_id") for ctx in ctx_seen}
    target_targets = {ctx.get("target_token_id") for ctx in ctx_seen}
    assert zone_targets == {21, 22}
    assert target_targets == {21, 22}
    assert db.commits == 1
    assert publish_calls and publish_calls[0][0] == 7
    assert 21 in touched and 22 in touched and 10 in touched


def test_execute_runtime_zone_triggers_supports_leave_alias(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import execute_runtime_zone_triggers

    instance = _make_minimal_runtime_instance(
        instance_id=1, caster_token_id=10, primary_target_token_id=None
    )
    db = _make_turn_trigger_db([instance])
    invocations, _ = _install_zone_trigger_spies(monkeypatch, [instance])

    touched = asyncio.run(
        execute_runtime_zone_triggers(
            db,
            campaign_id=7,
            caster_token_id=10,
            spell_id="hex",
            target_token_ids=[42],
            timing="leave",
        )
    )

    triggers = [trig for _, trig, _ in invocations]
    assert triggers == ["on_leave_zone"]
    assert 42 in touched


def test_execute_runtime_zone_triggers_skips_when_no_match(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import execute_runtime_zone_triggers

    # Active instance, but caster_token_id does not match the request —
    # runtime dispatch must be a complete no-op.
    instance = _make_minimal_runtime_instance(
        instance_id=1, caster_token_id=99, primary_target_token_id=None
    )
    db = _make_turn_trigger_db([instance])
    invocations, publish_calls = _install_zone_trigger_spies(monkeypatch, [instance])

    touched = asyncio.run(
        execute_runtime_zone_triggers(
            db,
            campaign_id=7,
            caster_token_id=10,
            spell_id="hex",
            target_token_ids=[21],
            timing="enter",
        )
    )

    assert touched == []
    assert invocations == []
    assert publish_calls == []
    assert db.commits == 0


def test_execute_runtime_zone_triggers_fires_on_applied_without_state_change(
    monkeypatch: pytest.MonkeyPatch,
):
    """A runtime-only zone phase that ran but produced no state diff and
    no touched ids must still count as fired — caller depends on a
    non-empty touched id list to publish projections / return success.
    """
    from app.services.spell_runtime_service import execute_runtime_zone_triggers

    instance = _make_minimal_runtime_instance(
        instance_id=1, caster_token_id=10, primary_target_token_id=None
    )
    db = _make_turn_trigger_db([instance])

    invocations: list[tuple[int, str, dict]] = []
    publish_calls: list[tuple[int, list[int]]] = []

    async def fake_loader(_db, _campaign_id):
        return [instance]

    async def fake_publish(_db, *, campaign_id, token_ids):
        publish_calls.append((campaign_id, list(token_ids)))

    async def fake_execute_phase(
        _db, inst, trigger, ctx_overrides=None, *, spell_data=None, apply=True
    ):
        from app.services.spell_runtime_engine.context import PhaseResult

        invocations.append((inst.id, trigger, dict(ctx_overrides or {})))
        # Phase matched and ran, but produced no instance mutations and
        # no touched ids (e.g. pure narrative / runtime bookkeeping).
        result = PhaseResult()
        result.applied = bool(apply)
        return result

    monkeypatch.setattr(
        spell_runtime_service, "_load_runtime_instances_for_campaign", fake_loader
    )
    monkeypatch.setattr(
        spell_runtime_service, "publish_runtime_projection_updates", fake_publish
    )
    monkeypatch.setattr(spell_runtime_service, "execute_phase", fake_execute_phase)

    touched = asyncio.run(
        execute_runtime_zone_triggers(
            db,
            campaign_id=7,
            caster_token_id=10,
            spell_id="hex",
            target_token_ids=[42],
            timing="enter",
        )
    )

    assert invocations and invocations[0][1] == "on_enter_zone"
    # Caster + zone target must be reported even though the phase made
    # no state changes — the route relies on this list to publish refresh
    # events and to return a success contract instead of falling to 400.
    assert 10 in touched
    assert 42 in touched
    assert db.commits == 1
    assert publish_calls and publish_calls[0][0] == 7


def test_execute_runtime_zone_triggers_rejects_unknown_timing():
    from app.services.spell_runtime_service import execute_runtime_zone_triggers

    db = _make_turn_trigger_db([])
    touched = asyncio.run(
        execute_runtime_zone_triggers(
            db,
            campaign_id=7,
            caster_token_id=10,
            spell_id="hex",
            target_token_ids=[21],
            timing="start_turn",
        )
    )
    assert touched == []


# ── Stage 9a: Bless readiness — multi-target linked projection ─────────


def _make_bless_context(*, target_count: int = 3) -> SimpleNamespace:
    return SimpleNamespace(
        spell_id="bless",
        spell_name="祝福术",
        caster_token_id=10,
        campaign_id=1,
        caster_level=5,
        spellcasting_mod=3,
        proficiency_bonus=3,
        spell_save_dc=15,
        selected_option=None,
        concentration=True,
        current_world_time={"day": 0, "hour": 0, "minute": 0, "second": 0},
    )


def test_create_runtime_spell_instance_stores_all_linked_targets_for_multi_target_spell():
    db = _FakeAsyncSession()
    ctx = _make_bless_context()
    spell_data = get_spell_by_id("bless")
    assert spell_data is not None
    targets = [
        _make_target(token_id=21, name="目标A"),
        _make_target(token_id=22, name="目标B"),
        _make_target(token_id=23, name="目标C"),
    ]

    instance, _ = asyncio.run(
        create_runtime_spell_instance(
            db,
            spell_data=spell_data,
            spell_context=ctx,
            targets=targets,
            slot_level=1,
        )
    )

    # Primary stays as the first target; all linked ids preserved in order.
    assert instance.primary_target_token_id == 21
    assert instance.linked_target_token_ids == [21, 22, 23]


def test_create_runtime_spell_instance_dedupes_and_skips_missing_targets():
    db = _FakeAsyncSession()
    ctx = _make_bless_context()
    spell_data = get_spell_by_id("bless")
    targets = [
        _make_target(token_id=21, name="目标A"),
        _make_target(token_id=21, name="目标A 重复"),
        SimpleNamespace(token_id=None, name="无ID"),
        _make_target(token_id=22, name="目标B"),
    ]

    instance, _ = asyncio.run(
        create_runtime_spell_instance(
            db,
            spell_data=spell_data,
            spell_context=ctx,
            targets=targets,
            slot_level=1,
        )
    )

    assert instance.primary_target_token_id == 21
    assert instance.linked_target_token_ids == [21, 22]


def test_create_runtime_spell_instance_keeps_single_target_hex_behavior_unchanged():
    db = _FakeAsyncSession()
    ctx = _make_hex_context(selected_option="strength")
    target = _make_target(token_id=20, name="哥布林")
    spell_data = get_spell_by_id("hex")

    instance, _ = asyncio.run(
        create_runtime_spell_instance(
            db,
            spell_data=spell_data,
            spell_context=ctx,
            targets=[target],
            slot_level=1,
        )
    )

    assert instance.primary_target_token_id == 20
    assert instance.linked_target_token_ids == [20]


def _make_bless_runtime_instance(
    *,
    primary_target_token_id: int = 21,
    linked_target_token_ids: list[int] | None = None,
) -> SpellRuntimeInstance:
    return SpellRuntimeInstance(
        id=1,
        campaign_id=7,
        spell_id="bless",
        spell_name="祝福术",
        caster_token_id=10,
        concentration_owner_token_id=10,
        primary_target_token_id=primary_target_token_id,
        linked_target_token_ids=list(
            linked_target_token_ids
            if linked_target_token_ids is not None
            else [primary_target_token_id]
        ),
        selected_option=None,
        params={"slot_level": 1},
        granted_actions=[],
        status="active",
    )


def test_get_token_runtime_modifier_effects_returns_bless_for_linked_non_primary_target(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import get_token_runtime_modifier_effects

    instance = _make_bless_runtime_instance(
        primary_target_token_id=21, linked_target_token_ids=[21, 22, 23]
    )

    async def fake_loader(_db, _campaign_id):
        return [instance]

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )

    db = _GetByIdDB(instances=[instance])
    before = _snapshot_instance(instance)

    # Query a linked but non-primary target.
    effects = asyncio.run(
        get_token_runtime_modifier_effects(db, campaign_id=7, token_id=23)
    )

    # Two modifier envelopes (attack_roll and saving_throw).
    targets = sorted(env["modifiers"][0]["target"] for env in effects)
    assert targets == ["attack_roll", "saving_throw"]
    for env in effects:
        modifier = env["modifiers"][0]
        assert modifier["type"] == "bonus"
        assert modifier["value"] == "1d4"
        assert modifier.get("operation") == "add"
        assert env["spell_id"] == "bless"
        assert env["spell_runtime"] is True

    # Read-only: no instance mutation, no commit.
    assert _snapshot_instance(instance) == before
    assert db.commits == 0


def test_get_token_runtime_modifier_effects_skips_token_outside_linked_targets(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import get_token_runtime_modifier_effects

    instance = _make_bless_runtime_instance(
        primary_target_token_id=21, linked_target_token_ids=[21, 22, 23]
    )

    async def fake_loader(_db, _campaign_id):
        return [instance]

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )

    db = _GetByIdDB(instances=[instance])

    effects = asyncio.run(
        get_token_runtime_modifier_effects(db, campaign_id=7, token_id=99)
    )

    assert effects == []


def test_end_concentration_runtime_instances_fallback_touches_all_linked_targets(
    monkeypatch: pytest.MonkeyPatch,
):
    from app.services.spell_runtime_service import end_concentration_runtime_instances

    instance = _make_bless_runtime_instance(
        primary_target_token_id=21, linked_target_token_ids=[21, 22, 23]
    )

    # Force the service-owned fallback by making get_spell_by_id return None
    # so the engine on_concentration_end branch is skipped.
    monkeypatch.setattr(
        spell_runtime_service,
        "get_spell_by_id",
        lambda _spell_id: None,
    )

    class _SelectDB(_FakeAsyncSession):
        async def execute(self, _stmt):
            class _Scalars:
                def all(self_inner):
                    return [instance]

            class _Result:
                def scalars(self_inner):
                    return _Scalars()

            return _Result()

    db = _SelectDB()

    touched = asyncio.run(
        end_concentration_runtime_instances(
            db,
            campaign_id=7,
            concentration_owner_token_ids=[10],
        )
    )

    assert instance.status == "ended"
    # caster (10) + primary (21) + linked extras (22, 23) all included.
    assert set(touched).issuperset({10, 21, 22, 23})


def test_build_token_spell_projection_map_emits_overlays_and_filter_for_all_linked_targets(
    monkeypatch: pytest.MonkeyPatch,
):
    """Bless-shaped runtime instance must project overlay/badge/ref + visual
    for every linked target, not just the primary one."""

    from app.services.spell_runtime_service import build_token_spell_projection_map

    instance = _make_bless_runtime_instance(
        primary_target_token_id=21,
        linked_target_token_ids=[21, 22, 23],
    )
    instance.params = {
        **(instance.params or {}),
        "token_filter": {"glow": "#fde68a", "glowRadius": 8},
    }

    async def fake_loader(_db, _campaign_id):
        return [instance]

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )

    async def fake_name_map(_db, _ids):
        return {10: "祭司", 21: "勇士", 22: "盗贼", 23: "法师"}

    monkeypatch.setattr(spell_runtime_service, "_token_name_map", fake_name_map)

    # Build minimal Token rows for the projection-token select. They only need
    # id / campaign_id / active_effects / concentration_spell / current_hp.
    projection_tokens = [
        Token(
            id=tid,
            campaign_id=7,
            active_effects=[],
            concentration_spell=None,
            current_hp=10,
        )
        for tid in (10, 21, 22, 23)
    ]

    class _ProjectionDB(_FakeAsyncSession):
        async def execute(self, _stmt):
            tokens = list(projection_tokens)

            class _Scalars:
                def all(self_inner):
                    return list(tokens)

            class _Result:
                def scalars(self_inner):
                    return _Scalars()

            return _Result()

    db = _ProjectionDB()

    projections = asyncio.run(
        build_token_spell_projection_map(
            db,
            campaign_id=7,
            token_ids=[10, 21, 22, 23],
        )
    )

    # Caster gets a source overlay+badge+ref.
    caster = projections[10]
    assert any(o["role"] == "source" and o["spell_id"] == "bless" for o in caster["spell_overlays"])
    assert any(b["spell_id"] == "bless" for b in caster["spell_badges"])

    # Each linked target — primary and extras — must receive overlay+badge+ref
    # plus a runtime spell visual emitting the cast token_filter.
    for tid in (21, 22, 23):
        proj = projections[tid]
        overlays = [o for o in proj["spell_overlays"] if o["spell_id"] == "bless"]
        assert overlays, f"no Bless overlay for linked target {tid}"
        assert overlays[0]["role"] == "target"
        assert overlays[0]["target_token_id"] == tid

        badges = [b for b in proj["spell_badges"] if b["spell_id"] == "bless"]
        assert badges, f"no Bless badge for linked target {tid}"

        refs = [r for r in proj["attached_runtime_refs"] if r["spell_id"] == "bless"]
        assert refs and refs[0]["role"] == "target"

        visuals = [
            v for v in proj["spell_visuals"]
            if v.get("spell_id") == "bless" and v.get("source") == "runtime"
        ]
        assert visuals, f"no runtime token_filter visual for linked target {tid}"
        assert visuals[0]["token_filter"] == {"glow": "#fde68a", "glowRadius": 8}
        assert visuals[0]["source_token_id"] == 10
        assert visuals[0]["runtime_instance_id"] == instance.id


def test_build_token_spell_projection_map_skips_filter_when_runtime_has_no_token_filter(
    monkeypatch: pytest.MonkeyPatch,
):
    """Without `params.token_filter`, the projection must not emit a runtime visual."""

    from app.services.spell_runtime_service import build_token_spell_projection_map

    instance = _make_bless_runtime_instance(
        primary_target_token_id=21,
        linked_target_token_ids=[21, 22],
    )
    # Explicitly clear token_filter so the runtime visual branch is skipped.
    instance.params = {"slot_level": 1}

    async def fake_loader(_db, _campaign_id):
        return [instance]

    monkeypatch.setattr(
        spell_runtime_service,
        "_load_runtime_instances_for_campaign",
        fake_loader,
    )

    async def fake_name_map(_db, _ids):
        return {10: "祭司", 21: "勇士", 22: "盗贼"}

    monkeypatch.setattr(spell_runtime_service, "_token_name_map", fake_name_map)

    projection_tokens = [
        Token(id=tid, campaign_id=7, active_effects=[], concentration_spell=None, current_hp=10)
        for tid in (10, 21, 22)
    ]

    class _ProjectionDB(_FakeAsyncSession):
        async def execute(self, _stmt):
            tokens = list(projection_tokens)

            class _Scalars:
                def all(self_inner):
                    return list(tokens)

            class _Result:
                def scalars(self_inner):
                    return _Scalars()

            return _Result()

    db = _ProjectionDB()

    projections = asyncio.run(
        build_token_spell_projection_map(db, campaign_id=7, token_ids=[10, 21, 22])
    )

    for tid in (21, 22):
        runtime_visuals = [
            v for v in projections[tid]["spell_visuals"]
            if v.get("spell_id") == "bless" and v.get("source") == "runtime"
        ]
        assert runtime_visuals == []


def test_bless_uses_runtime_engine_after_spells_json_flag():
    """spells.json declares Bless `runtime.engine: "v2"` for Stage 9b."""
    bless = get_spell_by_id("bless")
    assert bless is not None
    assert spell_uses_runtime_engine(bless) is True


def test_strip_bonus_modifiers_drops_bonus_only_envelopes_and_keeps_adv():
    """Bless-shaped bonus envelopes are dropped; advantage envelopes survive
    intact so adv/disadv checks still see them after stripping."""
    from app.services.spell_runtime_service import (
        strip_bonus_modifiers_from_runtime_effects,
    )

    effects = [
        # Bless-shaped attack_roll bonus — should be removed entirely.
        {
            "id": "spell_runtime_1_modify_roll_attack_roll",
            "name": "祝福术",
            "spell_id": "bless",
            "spell_runtime": True,
            "modifiers": [
                {"target": "attack_roll", "type": "bonus", "value": "1d4", "operation": "add"}
            ],
        },
        # Hypothetical adv-granting envelope — should pass through.
        {
            "id": "spell_runtime_2_grant_advantage",
            "name": "祝福术变体",
            "spell_id": "bless_variant",
            "spell_runtime": True,
            "modifiers": [
                {"target": "attack_roll", "type": "advantage"}
            ],
        },
        # Mixed envelope: bonus stripped, advantage kept, envelope preserved.
        {
            "id": "spell_runtime_3_mixed",
            "name": "复合效果",
            "spell_id": "mixed_spell",
            "spell_runtime": True,
            "modifiers": [
                {"target": "attack_roll", "type": "bonus", "value": "1d4", "operation": "add"},
                {"target": "saving_throw", "type": "advantage"},
            ],
        },
    ]

    stripped = strip_bonus_modifiers_from_runtime_effects(effects)

    # The bonus-only envelope is removed entirely.
    ids = [env["id"] for env in stripped]
    assert "spell_runtime_1_modify_roll_attack_roll" not in ids
    # The advantage envelope passes through untouched.
    adv = next(env for env in stripped if env["id"] == "spell_runtime_2_grant_advantage")
    assert adv["modifiers"] == [{"target": "attack_roll", "type": "advantage"}]
    # The mixed envelope keeps only the non-bonus modifier.
    mixed = next(env for env in stripped if env["id"] == "spell_runtime_3_mixed")
    assert mixed["modifiers"] == [{"target": "saving_throw", "type": "advantage"}]
    # Original input must not be mutated (shallow-copy contract).
    assert len(effects[2]["modifiers"]) == 2


def test_strip_bonus_modifiers_handles_empty_and_malformed_envelopes():
    """Malformed or empty envelopes are silently dropped."""
    from app.services.spell_runtime_service import (
        strip_bonus_modifiers_from_runtime_effects,
    )

    # None / non-dict entries should be ignored without raising.
    assert strip_bonus_modifiers_from_runtime_effects([]) == []
    assert strip_bonus_modifiers_from_runtime_effects([None, "junk", 123]) == []  # type: ignore[list-item]
    # Envelope missing `modifiers` key is dropped.
    assert strip_bonus_modifiers_from_runtime_effects([{"id": "x"}]) == []
    # Envelope whose only modifier is a bonus collapses to nothing.
    assert (
        strip_bonus_modifiers_from_runtime_effects(
            [{"id": "x", "modifiers": [{"type": "bonus", "value": "1d4"}]}]
        )
        == []
    )


def test_strip_bonus_then_get_modifiers_for_target_yields_zero_bonus():
    """After stripping, get_modifiers_for_target reports no formula bonus —
    proves the adv/disadv path can't re-roll the Bless 1d4."""
    from app.services.effect_service import get_modifiers_for_target
    from app.services.spell_runtime_service import (
        strip_bonus_modifiers_from_runtime_effects,
    )

    bless_envelope = {
        "id": "spell_runtime_1_modify_roll_attack_roll",
        "name": "祝福术",
        "spell_id": "bless",
        "spell_runtime": True,
        "modifiers": [
            {"target": "attack_roll", "type": "bonus", "value": "1d4", "operation": "add"}
        ],
    }

    # Full envelope — bonus path sees the formula bonus.
    full = get_modifiers_for_target([bless_envelope], "attack_roll")
    assert full["bonuses"], "expected Bless 1d4 in bonus aggregation"

    # Stripped envelope — adv/disadv path sees no bonus and no reasons.
    stripped = strip_bonus_modifiers_from_runtime_effects([bless_envelope])
    after = get_modifiers_for_target(stripped, "attack_roll")
    assert after["bonuses"] == []
    assert after["has_advantage"] is False
    assert after["has_disadvantage"] is False
    assert after["reasons"] == []
