"""
Unit tests for Call Lightning (召雷术) area-cast resolution.

Covers two layers:

1. _hydrate_area_spell_raw (the route gate helper in combat.py)
   The confirmed Chrome bug: /api/combat/spell-area receives a SpellData
   payload where `effects` is None (frontend default).  The route's
   `if spell_raw.get("effects"):` gate is never entered, so the resolver
   is never called and the route raises "could not be resolved".
   The helper must fill in effects AND area_of_effect from the rules cache
   BEFORE that gate so the route can proceed.

2. SpellResolver (defense-in-depth: resolver also falls back to cache)
   Positive and edge-case tests using the real spells.json effects.
"""
import contextlib
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.api.routes.combat import (
    _area_spell_slot_source,
    _build_granted_action_area_raw,
    _hydrate_area_spell_raw,
    _match_active_grant_action,
)
from app.core.config import settings
from app.services.qa.forced_roll import clear_forced_rolls, push_forced_rolls
from app.services.spell_resolver import SpellContext, SpellResolver, TargetInfo
from app.utils.rules_cache import get_spell_by_id

_FLAG_SITES = (
    "app.services.spell_resolver.flag_modified",
    "app.services.effect_engine.handlers.modifier.flag_modified",
    "app.services.effect_engine.handlers.utility.flag_modified",
)


@pytest.fixture(autouse=True)
def _qa_mode(monkeypatch):
    monkeypatch.setattr(settings, "QA_MODE", True)
    clear_forced_rolls()
    yield
    clear_forced_rolls()


@pytest.fixture(autouse=True)
def _noop_flag_modified():
    with contextlib.ExitStack() as stack:
        for site in _FLAG_SITES:
            stack.enter_context(patch(site))
        yield


# ── Route gate helper tests ────────────────────────────────────────────────────
# These are the primary regression tests for the Chrome bug.
# They fail before the fix (_hydrate_area_spell_raw is added to combat.py)
# and pass after.

def test_hydrate_fills_effects_when_missing():
    """
    Minimal payload without effects → helper fills effects from cache.
    This is the exact transformation that allows the route's
    `if spell_raw.get("effects"):` gate to pass for call_lightning.
    """
    bare = {"id": "call_lightning", "name": "召雷术", "level": 3}
    result = _hydrate_area_spell_raw(bare, "call_lightning")
    assert result.get("effects"), (
        "effects must be populated from cache so the route gate is entered"
    )
    # Should not mutate input
    assert "effects" not in bare


def test_hydrate_fills_area_of_effect_from_top_level_or_grant_action():
    """
    call_lightning has areaOfEffect in the JSON and grant_action.area_of_effect
    nested in effects.  Helper should populate area_of_effect so concentration
    storage works (lines 4171/4179/4185 in the route use this value).
    """
    bare = {"id": "call_lightning", "name": "召雷术", "level": 3}
    result = _hydrate_area_spell_raw(bare, "call_lightning")
    aoe = result.get("area_of_effect")
    assert aoe is not None, "area_of_effect must be hydrated from cache"
    assert "type" in aoe and "size" in aoe


def test_hydrate_does_not_overwrite_existing_effects():
    """If spell_raw already has effects, helper must leave them untouched."""
    custom_effects = [{"trigger": "on_cast", "effects": [{"type": "deal_damage"}]}]
    spell_raw = {"id": "call_lightning", "effects": custom_effects}
    result = _hydrate_area_spell_raw(spell_raw, "call_lightning")
    assert result["effects"] is custom_effects


def test_hydrate_unknown_id_returns_unchanged():
    """Unknown spell ID → no lookup → unchanged dict returned."""
    spell_raw = {"id": "no_such_spell", "name": "虚构法术"}
    result = _hydrate_area_spell_raw(spell_raw, "no_such_spell")
    assert result is spell_raw or result == spell_raw


def test_hydrate_empty_id_returns_unchanged():
    spell_raw = {"name": "无ID法术"}
    result = _hydrate_area_spell_raw(spell_raw, "")
    assert result is spell_raw or result == spell_raw


# ── SpellResolver tests (defense-in-depth + happy path) ──────────────────────

def _ctx(**kw):
    defaults = dict(
        caster_token_id=1, caster_name="德鲁伊", caster_level=5,
        spellcasting_mod=4, proficiency_bonus=3, spell_save_dc=15,
        spell_attack_bonus=7, spell_id="call_lightning", spell_name="召雷术",
        caster_class_id="druid", caster_subclass_id=None,
        concentration=True, campaign_id=1, in_combat=True,
        current_world_time=None,
    )
    defaults.update(kw)
    return SpellContext(**defaults)


def _target(**kw):
    defaults = dict(token_id=10, name="目标怪物", ac=14, current_hp=30, max_hp=30)
    defaults.update(kw)
    return TargetInfo(**defaults)


def _stateful_db():
    tokens: dict = {}
    db = AsyncMock()

    async def _get(_model, key):
        if key not in tokens:
            tokens[key] = SimpleNamespace(
                id=key, active_effects=[], status_effects={},
                character_id=None, monster_instance_id=None, campaign_id=1,
                current_hp=30, max_hp=30, temp_hp=0, transformation_data=None,
            )
        return tokens[key]

    db.get = AsyncMock(side_effect=_get)
    db.flush = AsyncMock()
    return db, tokens


@pytest.mark.asyncio
async def test_call_lightning_on_cast_deals_lightning_damage():
    """Failed dex save → full 3d10 lightning damage applied."""
    push_forced_rolls([5])  # 5 < DC 15 → save fails
    spell = get_spell_by_id("call_lightning")
    assert spell is not None, "call_lightning missing from spells.json"

    result = await SpellResolver().resolve(spell, _ctx(slot_level=3), [_target()], _stateful_db()[0])

    assert result is not None, "resolver returned None for call_lightning"
    all_ers = [er for phase in result.phase_results for er in phase]
    dmg = [er for er in all_ers if er.type == "deal_damage"]
    assert dmg, "no deal_damage result in phase_results"
    assert dmg[0].save_rolled is True
    assert dmg[0].save_succeeded is False
    assert dmg[0].damage_dealt > 0


@pytest.mark.asyncio
async def test_call_lightning_half_damage_on_successful_save():
    """Nat-20 dex save → half damage (> 0)."""
    push_forced_rolls([20])
    spell = get_spell_by_id("call_lightning")
    assert spell is not None

    result = await SpellResolver().resolve(spell, _ctx(slot_level=3), [_target()], _stateful_db()[0])

    assert result is not None
    all_ers = [er for phase in result.phase_results for er in phase]
    dmg = [er for er in all_ers if er.type == "deal_damage"]
    assert dmg
    assert dmg[0].save_succeeded is True
    assert dmg[0].damage_dealt > 0


@pytest.mark.asyncio
async def test_resolver_fallback_when_effects_omitted():
    """
    Defense-in-depth: resolver itself also falls back to the cache when the
    spell dict has no effects field (the fix in spell_resolver.py).
    This ensures that even if a call site bypasses _hydrate_area_spell_raw,
    the resolver still produces a result rather than silently returning None.
    """
    push_forced_rolls([5])
    spell_no_effects = {
        "id": "call_lightning",
        "name": "召雷术",
        "level": 3,
        "concentration": True,
    }

    result = await SpellResolver().resolve(
        spell_no_effects, _ctx(slot_level=3), [_target()], _stateful_db()[0]
    )

    assert result is not None, (
        "resolver should fall back to rules cache; check the fallback in "
        "SpellResolver.resolve() added in spell_resolver.py"
    )
    dmg = [er for phase in result.phase_results for er in phase if er.type == "deal_damage"]
    assert dmg and dmg[0].damage_dealt > 0


# ── v4 regression tests ────────────────────────────────────────────────────────
# These cover the two new bugs found after v3 landed:
#  1. _hydrate_area_spell_raw did not fill `concentration`, so the route always
#     saw spell.concentration=False (frontend default) and skipped concentration
#     storage / chat-meta / SpellContext.
#  2. _consume_spell_slot was called with caster.token_id (e.g. 2557) instead of
#     the character id (e.g. 545), so no slot was ever consumed.

def test_hydrate_fills_concentration_for_call_lightning():
    """
    Bare payload omits `concentration` → hydration must set it from cache.
    call_lightning is concentration=True in spells.json; without this fix the
    route computes is_concentration=False and skips both concentration storage
    and the correct chat-meta flags.
    """
    bare = {"id": "call_lightning", "name": "召雷术", "level": 3}
    result = _hydrate_area_spell_raw(bare, "call_lightning")
    assert result.get("concentration") is True, (
        "hydration must copy concentration=True from the rules cache "
        "so the route can derive is_concentration correctly"
    )
    # Must not mutate input
    assert "concentration" not in bare


def test_hydrate_overrides_pydantic_default_concentration_false():
    """
    THE Chrome-path regression (v4 false-green gap).

    In the real route, `spell.model_dump()` ALWAYS includes the Pydantic
    default `concentration: False` even when the frontend omits the field.
    So the dict reaching the helper looks exactly like this fixture.  The
    rules cache is authoritative for a known spell_id: call_lightning is
    concentration=True, so the hydrated dict MUST become True, overriding the
    default False.

    Under v4 (`if "concentration" not in result`) the key was present, the
    override never ran, and the route saw is_concentration=False — the bug.
    """
    payload = {"id": "call_lightning", "name": "召雷术", "level": 3, "concentration": False}
    result = _hydrate_area_spell_raw(payload, "call_lightning")
    assert result.get("concentration") is True, (
        "cache is authoritative for known spell_id: the Pydantic default "
        "False must be overridden to the cached True"
    )
    # Must not mutate input
    assert payload["concentration"] is False


def test_hydrate_sets_concentration_false_for_non_concentration_spell():
    """
    A cached non-concentration spell must hydrate concentration to False even
    if the incoming dict carries a stray truthy value — the cache wins.
    fireball is concentration=False in spells.json.
    """
    fb = get_spell_by_id("fireball")
    assert fb is not None and fb.get("concentration") is False, (
        "fixture assumes fireball is a known non-concentration spell"
    )
    payload = {"id": "fireball", "name": "火球术", "level": 3, "concentration": True}
    result = _hydrate_area_spell_raw(payload, "fireball")
    assert result.get("concentration") is False


# ── Slot-source helper tests ────────────────────────────────────────────────────
# _area_spell_slot_source(caster, caster_char) decides what to hand
# _consume_spell_slot.  It must NEVER yield caster.token_id, because that
# function looks up by Character.id and a token_id silently resolves the wrong
# (or no) character — the v4 bug.

def test_slot_source_prefers_already_fetched_caster_char():
    """When the route already fetched the Character, that object wins."""
    caster = SimpleNamespace(token_id=2557, character_id=545)
    caster_char = SimpleNamespace(id=545, name="德鲁伊")
    assert _area_spell_slot_source(caster, caster_char) is caster_char


def test_slot_source_falls_back_to_character_id_never_token_id():
    """No fetched Character → fall back to character_id, never the token_id."""
    caster = SimpleNamespace(token_id=2557, character_id=545)
    source = _area_spell_slot_source(caster, None)
    assert source == 545
    assert source != caster.token_id


def test_slot_source_returns_none_when_no_character_available():
    """No Character and no character_id → None (route then tries token lookup)."""
    caster = SimpleNamespace(token_id=2557, character_id=None)
    assert _area_spell_slot_source(caster, None) is None


# ── Granted-action area follow-up (召唤闪电) ──────────────────────────────────────
# The persisted call_lightning grant_action is routed through
# /api/combat/spell-area with a synthetic "granted_<spell_id>_<kind>" id and an
# emoji-prefixed name ("⚡ 召唤闪电"). These helpers recognize the active grant
# action and build a freecast synthetic payload.

def _call_lightning_grant_entry():
    """Grant-action entry persisted on the caster token after call_lightning."""
    return {
        "id": "call_lightning_grant_action_召唤闪电",
        "name": "召唤闪电",
        "source": "召雷术",
        "source_token_id": 2557,
        "spell_id": "call_lightning",
        "is_concentration": True,
        "effect_type": "grant_action",
        "action_type": "action",
        "action_name": "召唤闪电",
        "action_kind": "save_damage",
        "damage": {"formula": "3d10", "damage_type": "lightning"},
        "save": {"ability": "dex", "on_success": "half_damage"},
        "area_of_effect": {"type": "cylinder", "size": 5},
        "target_token_id": 2568,
    }


def test_match_grant_action_from_composite_id():
    payload = {"id": "granted_call_lightning_save_damage", "name": "⚡ 召唤闪电"}
    entry = _match_active_grant_action(payload, [_call_lightning_grant_entry()])
    assert entry is not None
    assert entry["spell_id"] == "call_lightning"
    assert entry["action_kind"] == "save_damage"


def test_match_grant_action_from_emoji_name():
    payload = {"id": "not_a_real_spell", "name": "⚡ 召唤闪电"}
    entry = _match_active_grant_action(payload, [_call_lightning_grant_entry()])
    assert entry is not None
    assert entry["spell_id"] == "call_lightning"


def test_match_grant_action_none_for_normal_initial_cast():
    """A normal initial cast must not be treated as a freecast follow-up."""
    payload = {"id": "call_lightning", "name": "召雷术"}
    assert _match_active_grant_action(payload, [_call_lightning_grant_entry()]) is None


def test_match_grant_action_none_without_entries():
    payload = {"id": "granted_call_lightning_save_damage", "name": "⚡ 召唤闪电"}
    assert _match_active_grant_action(payload, []) is None
    assert _match_active_grant_action(payload, None) is None


def test_build_granted_area_raw_maps_to_canonical_spell_id():
    payload = {
        "id": "granted_call_lightning_save_damage",
        "name": "⚡ 召唤闪电",
        "level": 0,
        "concentration": False,
    }
    built = _build_granted_action_area_raw(payload, _call_lightning_grant_entry())
    assert built["id"] == "call_lightning"


def test_build_granted_area_raw_has_save_damage_area_no_concentration_no_grant_leaf():
    payload = {
        "id": "granted_call_lightning_save_damage",
        "name": "⚡ 召唤闪电",
        "level": 0,
        "concentration": False,
    }
    built = _build_granted_action_area_raw(payload, _call_lightning_grant_entry())

    assert built.get("concentration") is False
    assert built.get("area_of_effect") == {"type": "cylinder", "size": 5}

    phases = built.get("effects") or []
    assert phases, "synthetic payload must carry an effects phase"
    leaf_types = [e.get("type") for ph in phases for e in (ph.get("effects") or [])]
    assert "deal_damage" in leaf_types
    assert "grant_action" not in leaf_types, "must not re-grant the action"

    save_blocks = [ph.get("save") for ph in phases if ph.get("save")]
    assert save_blocks and save_blocks[0].get("ability") == "dex"
    assert save_blocks[0].get("on_success") == "half_damage"


def test_build_granted_area_raw_does_not_mutate_input():
    payload = {
        "id": "granted_call_lightning_save_damage",
        "name": "⚡ 召唤闪电",
        "level": 0,
        "concentration": False,
    }
    _build_granted_action_area_raw(payload, _call_lightning_grant_entry())
    assert payload.get("effects") is None or payload.get("effects") == []
    assert "area_of_effect" not in payload


# ── Granted-action area follow-up (move_effect: 月华之光 / 炽焰法球) ──────────────
# A `move_effect` relocation must stay a concentration cast (so the persistent
# area moves), hydrate its shape from the canonical spell, and never re-grant
# the action — unlike Call Lightning's transient `save_damage` follow-up.

def _moonbeam_move_grant_entry():
    """Grant-action entry persisted on the caster token after moonbeam.
    Note: no `area_of_effect` (the grant entry omits it) and — after the
    handler fix — no `target_token_id` lock."""
    return {
        "id": "moonbeam_grant_action_移动月华之光",
        "name": "移动月华之光",
        "source": "月华之光",
        "source_token_id": 2557,
        "spell_id": "moonbeam",
        "is_concentration": True,
        "effect_type": "grant_action",
        "action_type": "action",
        "action_name": "移动月华之光",
        "action_kind": "move_effect",
        "save": {"ability": "con", "on_success": "half_damage"},
        "damage": {"formula": "2d10", "damage_type": "radiant"},
        "movement": {"range": 60},
    }


def test_build_move_effect_raw_stays_concentration_and_canonical_id():
    payload = {
        "id": "granted_moonbeam_move_effect",
        "name": "🌙 移动月华之光",
        "level": 0,
        "concentration": False,
    }
    built = _build_granted_action_area_raw(payload, _moonbeam_move_grant_entry())
    # Canonical spell id, not the synthetic granted_* id.
    assert built["id"] == "moonbeam"
    # move_effect relocates the persistent area → must remain concentration.
    assert built.get("concentration") is True


def test_build_move_effect_raw_hydrates_area_from_canonical_spell():
    """The grant entry omits area_of_effect; the builder must fall back to the
    source spell's top-level shape (moonbeam = cylinder/5) so the moved zone
    keeps its size."""
    moonbeam = get_spell_by_id("moonbeam")
    expected = moonbeam.get("areaOfEffect") or moonbeam.get("area_of_effect")
    assert expected, "fixture assumes moonbeam has a top-level area shape"
    payload = {"id": "granted_moonbeam_move_effect", "name": "🌙 移动月华之光", "level": 0}
    built = _build_granted_action_area_raw(payload, _moonbeam_move_grant_entry())
    assert built.get("area_of_effect") == expected


def test_build_move_effect_raw_does_not_regrant_action():
    payload = {"id": "granted_moonbeam_move_effect", "name": "🌙 移动月华之光", "level": 0}
    built = _build_granted_action_area_raw(payload, _moonbeam_move_grant_entry())
    leaf_types = [
        e.get("type") for ph in (built.get("effects") or []) for e in (ph.get("effects") or [])
    ]
    assert "grant_action" not in leaf_types, "move_effect must not re-grant the action"
    assert "deal_damage" in leaf_types


def test_match_move_effect_grant_from_composite_id():
    payload = {"id": "granted_moonbeam_move_effect", "name": "🌙 移动月华之光"}
    entry = _match_active_grant_action(payload, [_moonbeam_move_grant_entry()])
    assert entry is not None
    assert entry["spell_id"] == "moonbeam"
    assert entry["action_kind"] == "move_effect"


# ── Flaming Sphere move_effect (no top-level area in spells.json) ────────────────
# Unlike Moonbeam, flaming_sphere carries no top-level areaOfEffect, so the
# canonical-spell fallback yields nothing. The builder must use a concrete
# per-spell fallback shape (sphere/5) so concentration relocation still writes
# an area_effect instead of nothing.

def _flaming_sphere_move_grant_entry():
    """Grant-action entry persisted after flaming_sphere. No area_of_effect."""
    return {
        "id": "flaming_sphere_grant_action_移动炽焰法球",
        "name": "移动炽焰法球",
        "source": "炽焰法球",
        "source_token_id": 2557,
        "spell_id": "flaming_sphere",
        "is_concentration": True,
        "effect_type": "grant_action",
        "action_type": "bonus_action",
        "action_name": "移动炽焰法球",
        "action_kind": "move_effect",
        "damage": {"formula": "2d6", "damage_type": "fire"},
        "movement": {"range": 30},
    }


def test_build_flaming_sphere_move_effect_uses_concrete_fallback_area():
    """flaming_sphere has no top-level area; builder must fall back to sphere/5,
    stay concentration, use the canonical id, and not re-grant the action."""
    fs = get_spell_by_id("flaming_sphere")
    assert fs is not None and not (
        fs.get("areaOfEffect") or fs.get("area_of_effect")
    ), "fixture assumes flaming_sphere has no top-level area shape"

    payload = {
        "id": "granted_flaming_sphere_move_effect",
        "name": "🔥 移动炽焰法球",
        "level": 0,
        "concentration": False,
    }
    built = _build_granted_action_area_raw(payload, _flaming_sphere_move_grant_entry())

    assert built["id"] == "flaming_sphere"
    assert built.get("concentration") is True
    assert built.get("area_of_effect") == {"type": "sphere", "size": 5}

    leaf_types = [
        e.get("type") for ph in (built.get("effects") or []) for e in (ph.get("effects") or [])
    ]
    assert "grant_action" not in leaf_types, "move_effect must not re-grant the action"
    assert "deal_damage" in leaf_types


def test_build_flaming_sphere_explicit_area_wins_over_fallback():
    """An explicit area_of_effect on the entry must beat the sphere/5 fallback."""
    entry = _flaming_sphere_move_grant_entry()
    entry["area_of_effect"] = {"type": "cube", "size": 10}
    payload = {"id": "granted_flaming_sphere_move_effect", "name": "🔥 移动炽焰法球", "level": 0}
    built = _build_granted_action_area_raw(payload, entry)
    assert built.get("area_of_effect") == {"type": "cube", "size": 10}


@pytest.mark.asyncio
async def test_granted_area_followup_resolves_save_damage_freecast():
    """Synthetic follow-up rolls DEX saves and deals lightning as a freecast."""
    push_forced_rolls([5])  # 5 < DC 15 → save fails → full damage
    payload = {
        "id": "granted_call_lightning_save_damage",
        "name": "⚡ 召唤闪电",
        "level": 0,
        "concentration": False,
    }
    built = _build_granted_action_area_raw(payload, _call_lightning_grant_entry())

    result = await SpellResolver().resolve(
        built, _ctx(slot_level=0, concentration=False), [_target()], _stateful_db()[0]
    )
    assert result is not None
    dmg = [er for phase in result.phase_results for er in phase if er.type == "deal_damage"]
    assert dmg, "no deal_damage result from the synthetic follow-up"
    assert dmg[0].save_rolled is True
    assert dmg[0].save_succeeded is False
    assert dmg[0].damage_dealt > 0
