"""RT-2 regression tests: round-duration effects get expiry metadata outside
combat, and concentration semantics are preserved.

Covers the ModifierHandler (the handler whose ``ctx.in_combat`` gate used to
suppress out-of-combat expiry) and the ConditionHandler (which already lacked
the gate and must keep its expiry metadata).
"""
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.effect_engine.types import EffectSource, HandlerContext, SideEffects
from app.services.effect_engine.handlers.modifier import ModifierHandler, GrantAdvantageParams
from app.services.effect_engine.handlers.condition import ConditionHandler, ConditionParams

WORLD_TIME = {"day": 1, "hour": 0, "minute": 0, "second": 0}


def _make_source(**kw):
    defaults = dict(
        type="spell", id="guiding_bolt", name="guiding bolt",
        caster_token_id=1, concentration=False, slot_level=1,
    )
    defaults.update(kw)
    return EffectSource(**defaults)


def _make_ctx(**kw):
    defaults = dict(
        caster_token_id=1, caster_name="cleric", caster_level=5,
        spellcasting_mod=4, proficiency_bonus=3, spell_save_dc=15,
        spell_attack_bonus=7, spell_level=1, slot_level=1,
        spell_id="guiding_bolt", spell_name="guiding bolt",
        concentration=False, campaign_id=1, in_combat=False,
        current_world_time=WORLD_TIME,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _make_target(**kw):
    defaults = dict(
        token_id=10, name="goblin",
        character_id=None, monster_instance_id=None,
        condition_immunities=[],
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _make_hctx(target=None, ctx=None, phase=None, db=None, **kw):
    defaults = dict(
        source=_make_source(),
        target=target or _make_target(),
        caster_ctx=ctx or _make_ctx(),
        phase=phase if phase is not None else {"duration": {"rounds": 1}},
        db=db or AsyncMock(),
        save_cfg=None, save_succeeded=None,
        attack_hit=None, is_critical=False,
        scaling=None, phase_damage_dealt=0,
    )
    defaults.update(kw)
    return HandlerContext(**defaults)


def _mock_token(token_id=10):
    return SimpleNamespace(id=token_id, active_effects=[])


def _make_db(token, char=None):
    db = AsyncMock()
    lookup = {10: token}
    if char is not None:
        lookup[5] = char
    db.get = AsyncMock(side_effect=lambda cls, id: lookup.get(id))
    db.flush = AsyncMock()
    return db


# --- ModifierHandler ---

class TestModifierExpiryOutOfCombat:

    @pytest.mark.asyncio
    async def test_out_of_combat_modifier_gets_duration_and_expires_at(self):
        """A non-concentration buff cast out of combat must store duration +
        expires_at so a later world-time advance can expire it (the RT-2 bug)."""
        handler = ModifierHandler("grant_advantage")
        token = _mock_token()
        ctx = _make_ctx(in_combat=False, concentration=False)
        hctx = _make_hctx(ctx=ctx, db=_make_db(token), phase={"duration": {"rounds": 1}})
        with patch("app.services.effect_engine.handlers.modifier.flag_modified"):
            await handler.execute(GrantAdvantageParams(on="attack"), hctx, SideEffects())

        eff = token.active_effects[0]
        assert eff["duration"] == 1
        assert eff["expires_at"] == {"day": 1, "hour": 0, "minute": 0, "second": 6}

    @pytest.mark.asyncio
    async def test_in_combat_matches_out_of_combat(self):
        """Removing the in_combat gate must not change in-combat behavior:
        both now produce identical duration/expires_at."""
        handler = ModifierHandler("grant_advantage")
        results = {}
        for label, in_combat in (("out", False), ("in", True)):
            token = _mock_token()
            ctx = _make_ctx(in_combat=in_combat, concentration=False)
            hctx = _make_hctx(ctx=ctx, db=_make_db(token), phase={"duration": {"rounds": 1}})
            with patch("app.services.effect_engine.handlers.modifier.flag_modified"):
                await handler.execute(GrantAdvantageParams(on="attack"), hctx, SideEffects())
            eff = token.active_effects[0]
            results[label] = (eff["duration"], eff.get("expires_at"))
        assert results["in"] == results["out"]

    @pytest.mark.asyncio
    async def test_concentration_modifier_has_no_walltime_expiry(self):
        """Concentration effects intentionally get no wall-clock duration/expiry;
        concentration loss ends them earlier than any wall-clock cap."""
        handler = ModifierHandler("grant_advantage")
        token = _mock_token()
        ctx = _make_ctx(in_combat=False, concentration=True)
        hctx = _make_hctx(ctx=ctx, db=_make_db(token), phase={"duration": {"rounds": 10}})
        with patch("app.services.effect_engine.handlers.modifier.flag_modified"):
            await handler.execute(GrantAdvantageParams(on="attack"), hctx, SideEffects())

        eff = token.active_effects[0]
        assert eff["duration"] is None
        assert "expires_at" not in eff
        assert eff["is_concentration"] is True


# --- ConditionHandler ---

class TestConditionExpiryMetadata:

    @pytest.mark.asyncio
    async def test_condition_effect_still_gets_expiry_metadata(self):
        """ConditionHandler already lacked the in_combat gate; confirm it keeps
        writing duration + expires_at on both the active_effect and the
        character status entry."""
        handler = ConditionHandler()
        token = _mock_token()
        char = SimpleNamespace(status_effects={"active_conditions": []})
        ctx = _make_ctx(
            spell_id="hold_person", spell_name="hold person",
            in_combat=False, concentration=False, current_world_time=WORLD_TIME,
        )
        target = _make_target(character_id=5)
        hctx = _make_hctx(
            ctx=ctx, target=target, db=_make_db(token, char),
            phase={"duration": {"rounds": 10}},
        )
        with patch("app.services.effect_engine.handlers.condition.flag_modified"):
            await handler.execute(ConditionParams(condition="restrained"), hctx, SideEffects())

        eff = token.active_effects[-1]
        assert eff["duration"] == 10
        assert eff["expires_at"] == {"day": 1, "hour": 0, "minute": 1, "second": 0}
        cond = char.status_effects["active_conditions"][-1]
        assert cond["expires_at"] == {"day": 1, "hour": 0, "minute": 1, "second": 0}
