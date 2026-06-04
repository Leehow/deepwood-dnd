"""
Resolver-level regression tests for the spell-QA correctness fixes.

These drive the REAL ``SpellResolver`` against the REAL ``spells.json`` entries —
the reproducible, offline equivalent of casting via ``POST /api/spells/cast``
against a QA_MODE backend. Each test asserts the corrected runtime behaviour:

  1. Narrative-trigger drops — magic_mouth / major_image / mirage_arcane /
     nystuls_magic_aura must actually run ``spawn_illusion`` (not RP text only);
     mordenkainens_private_sanctum must run ``create_zone_visual``.
  2. speak_with_plants must NOT impose ``restrained``.
  3. power_word_stun — HP≤150 gate + no initial save (auto-stun under the gate,
     no effect above it, immunity still wins).
  4. conjure_barrage damage-type consistency; scrying ``grant_sense`` gated by
     the WIS save (a successful save creates no sensor).

Saves are made deterministic without the forced-roll queue: ``save_override``
large → guaranteed success; ``ctx.target_auto_fail_save = True`` → guaranteed
failure (see ``SpellResolver._roll_save``).
"""
import contextlib
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.utils.rules_cache import get_spell_by_id
from app.services.spell_resolver import SpellContext, SpellResolver, TargetInfo


# flag_modified() needs real SQLAlchemy instrumentation; our mock tokens are
# plain objects, so neutralise it everywhere the resolve path touches it.
_FLAG_MODIFIED_SITES = (
    "app.services.spell_resolver.flag_modified",
    "app.services.effect_engine.handlers.condition.flag_modified",
    "app.services.effect_engine.handlers.illusion.flag_modified",
    "app.services.effect_engine.handlers.zone_visual.flag_modified",
    "app.services.effect_engine.handlers.sense.flag_modified",
)


@pytest.fixture(autouse=True)
def _noop_flag_modified():
    with contextlib.ExitStack() as stack:
        for site in _FLAG_MODIFIED_SITES:
            stack.enter_context(patch(site))
        yield


def _ctx(**kw):
    # target_auto_fail_save is an instance attribute (not a constructor param).
    auto_fail = kw.pop("target_auto_fail_save", False)
    defaults = dict(
        caster_token_id=1, caster_name="法师", caster_level=12,
        spellcasting_mod=5, proficiency_bonus=4, spell_save_dc=18,
        spell_attack_bonus=9, spell_id="", spell_name="",
        caster_class_id=None, caster_subclass_id=None,
        concentration=False, campaign_id=1, in_combat=True,
        current_world_time=None,
    )
    defaults.update(kw)
    ctx = SpellContext(**defaults)
    ctx.target_auto_fail_save = auto_fail
    return ctx


def _target(**kw):
    defaults = dict(token_id=10, name="目标", ac=15, current_hp=80, max_hp=80)
    defaults.update(kw)
    return TargetInfo(**defaults)


def _mock_db():
    """db.get(Token, id) → a fresh token-like row with an appendable
    active_effects list. Handlers only read/append active_effects then flush; we
    assert on the resolver's EffectResults / narrative, not persisted state."""
    db = AsyncMock()

    async def _get(_model, key):
        return SimpleNamespace(
            id=key, active_effects=[], status_effects={},
            character_id=None, monster_instance_id=None, campaign_id=1,
        )

    db.get = AsyncMock(side_effect=_get)
    db.flush = AsyncMock()
    return db


async def _resolve(spell_id, ctx_kw=None, target_kw=None):
    spell = get_spell_by_id(spell_id)
    assert spell is not None, f"{spell_id} missing from spells.json"
    ctx = _ctx(spell_id=spell_id, spell_name=spell.get("name", spell_id), **(ctx_kw or {}))
    target = _target(**(target_kw or {}))
    result = await SpellResolver().resolve(spell, ctx, [target], _mock_db())
    assert result is not None, f"{spell_id} returned None (no effects field?)"
    return result


def _flat(result):
    return [er for phase in result.phase_results for er in phase]


def _types(result):
    return [er.type for er in _flat(result)]


def _narrative(result):
    return "\n".join(result.narrative_parts)


# ── 1. Narrative-trigger drops: spawn_illusion / create_zone_visual ───────────

@pytest.mark.parametrize("spell_id", [
    "magic_mouth", "major_image", "mirage_arcane", "nystuls_magic_aura",
])
@pytest.mark.asyncio
async def test_illusion_spells_actually_spawn_illusion(spell_id):
    """The phase was trigger:"narrative" (RP text only) so spawn_illusion never
    ran. Flipped to on_cast, the handler executes and surfaces "幻象"."""
    result = await _resolve(spell_id)
    assert "spawn_illusion" in _types(result), (
        f"{spell_id}: spawn_illusion did not execute — "
        f"got effect types {_types(result)}"
    )
    assert "幻象" in _narrative(result)


@pytest.mark.asyncio
async def test_private_sanctum_creates_zone_visual():
    result = await _resolve("mordenkainens_private_sanctum")
    assert "create_zone_visual" in _types(result), (
        f"create_zone_visual did not execute — got {_types(result)}"
    )
    assert "区域" in _narrative(result)


# ── 2. speak_with_plants must not impose restrained ───────────────────────────

@pytest.mark.asyncio
async def test_speak_with_plants_never_restrains():
    """Even with a guaranteed-failed save (worst case), no restrained is applied;
    the narrative effects still surface."""
    result = await _resolve("speak_with_plants", ctx_kw={"target_auto_fail_save": True})
    applied = [er.condition_applied for er in _flat(result)]
    assert "restrained" not in applied, f"restrained wrongly applied: {applied}"
    assert "apply_condition" not in _types(result)
    # The useful narrative content is preserved.
    assert "植物" in _narrative(result)


@pytest.mark.asyncio
async def test_speak_with_plants_narrative_survives_a_would_be_save():
    """RAW speak_with_plants has no saving throw. The phase-level STR save only
    existed to gate the bogus restrained, and on success it would negate the
    whole phase — suppressing the narratives. With it removed, a target that
    would 'succeed' that save still gets the full narrative."""
    result = await _resolve("speak_with_plants", target_kw={"save_override": 100})
    assert "植物" in _narrative(result), "narrative wrongly suppressed by a stray save"
    assert "restrained" not in [er.condition_applied for er in _flat(result)]


# ── 3. power_word_stun: HP≤150 gate + no initial save ─────────────────────────

@pytest.mark.asyncio
async def test_power_word_stun_no_effect_above_150_hp():
    """201-HP target → no stun, even on a failed save (gate is absolute)."""
    result = await _resolve(
        "power_word_stun",
        ctx_kw={"target_auto_fail_save": True},
        target_kw={"current_hp": 201, "max_hp": 201},
    )
    applied = [er.condition_applied for er in _flat(result)]
    assert "stunned" not in applied, f"stunned despite >150 HP: {applied}"


@pytest.mark.asyncio
async def test_power_word_stun_auto_stuns_at_or_below_150_without_save():
    """150-HP target → stunned automatically. save_override makes any initial
    save SUCCEED; the target is still stunned, proving no initial save gates it."""
    result = await _resolve(
        "power_word_stun",
        target_kw={"current_hp": 150, "max_hp": 200, "save_override": 100},
    )
    applied = [er.condition_applied for er in _flat(result)]
    assert "stunned" in applied, f"expected auto-stun ≤150 HP, got {applied}"


@pytest.mark.asyncio
async def test_power_word_stun_respects_condition_immunity():
    result = await _resolve(
        "power_word_stun",
        ctx_kw={"target_auto_fail_save": True},
        target_kw={"current_hp": 100, "max_hp": 200, "condition_immunities": ["stunned"]},
    )
    flat = _flat(result)
    assert any(er.condition_immune for er in flat), "immunity not honoured"
    assert "stunned" not in [er.condition_applied for er in flat]


def test_power_word_stun_data_has_no_initial_save_and_an_hp_gate():
    """Structural guard: the apply_condition carries hpThreshold and NO save."""
    spell = get_spell_by_id("power_word_stun")
    on_cast = next(p for p in spell["effects"] if p.get("trigger") == "on_cast")
    cond = next(e for e in on_cast["effects"] if e.get("type") == "apply_condition")
    assert cond.get("hpThreshold") == 150
    assert "save" not in cond, "initial save must be removed (it auto-stuns)"


# ── 4a. conjure_barrage damage-type consistency ───────────────────────────────

def test_conjure_barrage_damage_type_consistent():
    spell = get_spell_by_id("conjure_barrage")
    top = spell.get("damageType")
    dmg = next(
        e for phase in spell["effects"] for e in phase["effects"]
        if e.get("type") == "deal_damage"
    )
    assert dmg["damage_type"] == top, (
        f"top-level damageType={top!r} != effect damage_type={dmg['damage_type']!r}"
    )


# ── 4b. scrying grant_sense gated by the WIS save ─────────────────────────────

@pytest.mark.asyncio
async def test_scrying_successful_save_creates_no_sensor():
    """A successful WIS save must stop the sensor. save_override → guaranteed
    success; no remote sensor ("感应器") may be granted."""
    result = await _resolve("scrying", target_kw={"save_override": 100})
    assert "感应器" not in _narrative(result), (
        f"sensor granted despite successful save: {_narrative(result)!r}"
    )


@pytest.mark.asyncio
async def test_scrying_failed_save_creates_sensor():
    result = await _resolve("scrying", ctx_kw={"target_auto_fail_save": True})
    assert "感应器" in _narrative(result), "sensor should be granted on a failed save"
