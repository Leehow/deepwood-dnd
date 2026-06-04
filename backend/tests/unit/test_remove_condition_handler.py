"""
Unit tests for RemoveConditionHandler — remove_condition verb.
"""
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.effect_engine.types import (
    EffectSource, HandlerContext, SideEffects,
)
from app.services.effect_engine.handlers.remove_condition import (
    RemoveConditionHandler, RemoveConditionParams,
)


# ── Fixtures ──────────────────────────────────────────────────

def _make_source(**kw):
    defaults = dict(
        type="spell", id="lesser_restoration", name="次级复原术",
        caster_token_id=1, concentration=False, slot_level=2,
    )
    defaults.update(kw)
    return EffectSource(**defaults)


def _make_ctx(**kw):
    defaults = dict(
        caster_token_id=1, caster_name="牧师", caster_level=5,
        spellcasting_mod=4, proficiency_bonus=3, spell_save_dc=15,
        spell_attack_bonus=7, spell_level=2, slot_level=2,
        spell_id="lesser_restoration", spell_name="次级复原术",
        concentration=False, campaign_id=1, in_combat=True,
        current_world_time=None,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _make_target(**kw):
    defaults = dict(
        token_id=10, name="战士",
        character_id=5, monster_instance_id=None,
        condition_immunities=[],
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _make_hctx(target=None, ctx=None, **kw):
    defaults = dict(
        source=_make_source(),
        target=target or _make_target(),
        caster_ctx=ctx or _make_ctx(),
        phase={},
        db=AsyncMock(),
        save_cfg=None, save_succeeded=None,
        attack_hit=None, is_critical=False,
        scaling=None, phase_damage_dealt=0,
    )
    defaults.update(kw)
    return HandlerContext(**defaults)


def _mock_token(token_id=10, active_effects=None):
    return SimpleNamespace(id=token_id, active_effects=active_effects or [])


def _mock_char(active_conditions=None):
    return SimpleNamespace(
        status_effects={"active_conditions": active_conditions or []},
    )


def _mock_monster(conditions=None):
    return SimpleNamespace(
        status_effects={"conditions": conditions or []},
    )


# ── Tests ─────────────────────────────────────────────────────

class TestRemoveConditionHandler:

    @pytest.mark.asyncio
    async def test_remove_all_matching(self):
        handler = RemoveConditionHandler()
        params = RemoveConditionParams(
            conditions=["blinded", "deafened", "poisoned"],
            mode="all",
        )
        token = _mock_token(active_effects=[
            {"condition": "blinded", "source": "spray"},
            {"condition": "poisoned", "source": "venom"},
            {"id": "shield_buff", "effect_type": "modifier"},
        ])
        char = _mock_char(active_conditions=[
            {"condition": "blinded", "source": {"spell_id": "spray"}},
            {"condition": "poisoned", "source": {"spell_id": "venom"}},
        ])
        db = AsyncMock()
        db.get = AsyncMock(side_effect=lambda cls, id: {
            10: token, 5: char,
        }.get(id))
        db.flush = AsyncMock()

        hctx = _make_hctx(db=db)
        with patch("app.services.effect_engine.handlers.remove_condition.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())

        assert len(outcome.conditions_removed) == 2
        assert "blinded" in outcome.conditions_removed
        assert "poisoned" in outcome.conditions_removed
        # Non-condition effect kept
        assert len(token.active_effects) == 1
        assert token.active_effects[0]["id"] == "shield_buff"

    @pytest.mark.asyncio
    async def test_remove_choose_one(self):
        """In choose_one mode, only the first matching condition is removed."""
        handler = RemoveConditionHandler()
        params = RemoveConditionParams(
            conditions=["blinded", "deafened", "paralyzed", "poisoned"],
            mode="choose_one",
        )
        token = _mock_token(active_effects=[
            {"condition": "blinded", "source": "x"},
            {"condition": "poisoned", "source": "y"},
        ])
        db = AsyncMock()
        db.get = AsyncMock(side_effect=lambda cls, id: token if id == 10 else None)
        db.flush = AsyncMock()

        target = _make_target(character_id=None, monster_instance_id=None)
        hctx = _make_hctx(db=db, target=target)
        with patch("app.services.effect_engine.handlers.remove_condition.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())

        assert len(outcome.conditions_removed) == 1
        # One condition removed, one kept
        assert len(token.active_effects) == 1

    @pytest.mark.asyncio
    async def test_no_matching_conditions(self):
        handler = RemoveConditionHandler()
        params = RemoveConditionParams(conditions=["poisoned"], mode="all")
        token = _mock_token(active_effects=[
            {"id": "shield_buff", "effect_type": "modifier"},
        ])
        db = AsyncMock()
        db.get = AsyncMock(side_effect=lambda cls, id: token if id == 10 else None)
        db.flush = AsyncMock()

        target = _make_target(character_id=None, monster_instance_id=None)
        hctx = _make_hctx(db=db, target=target)
        with patch("app.services.effect_engine.handlers.remove_condition.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())

        assert len(outcome.conditions_removed) == 0
        assert "没有" in outcome.description

    @pytest.mark.asyncio
    async def test_monster_status_effects_cleaned(self):
        handler = RemoveConditionHandler()
        params = RemoveConditionParams(conditions=["paralyzed"], mode="all")
        token = _mock_token(active_effects=[
            {"condition": "paralyzed", "source": "hold"},
        ])
        monster = _mock_monster(conditions=[
            {"condition": "paralyzed", "source": {"spell_id": "hold"}},
            {"condition": "frightened", "source": {"spell_id": "fear"}},
        ])
        db = AsyncMock()
        db.get = AsyncMock(side_effect=lambda cls, id: {
            10: token, 99: monster,
        }.get(id))
        db.flush = AsyncMock()

        target = _make_target(character_id=None, monster_instance_id=99)
        hctx = _make_hctx(db=db, target=target)
        with patch("app.services.effect_engine.handlers.remove_condition.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())

        assert "paralyzed" in outcome.conditions_removed
        # frightened should be kept
        assert len(monster.status_effects["conditions"]) == 1
        assert monster.status_effects["conditions"][0]["condition"] == "frightened"

    @pytest.mark.asyncio
    async def test_token_not_found(self):
        handler = RemoveConditionHandler()
        params = RemoveConditionParams(conditions=["poisoned"], mode="all")
        db = AsyncMock()
        db.get = AsyncMock(return_value=None)
        hctx = _make_hctx(db=db)
        outcome = await handler.execute(params, hctx, SideEffects())
        assert "不存在" in outcome.description

    @pytest.mark.asyncio
    async def test_case_insensitive(self):
        handler = RemoveConditionHandler()
        params = RemoveConditionParams(conditions=["Poisoned"], mode="all")
        token = _mock_token(active_effects=[
            {"condition": "poisoned", "source": "x"},
        ])
        db = AsyncMock()
        db.get = AsyncMock(side_effect=lambda cls, id: token if id == 10 else None)
        db.flush = AsyncMock()

        target = _make_target(character_id=None, monster_instance_id=None)
        hctx = _make_hctx(db=db, target=target)
        with patch("app.services.effect_engine.handlers.remove_condition.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())

        assert len(outcome.conditions_removed) == 1


class TestRemoveConditionSchema:
    def test_rejects_extra_fields(self):
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            RemoveConditionParams(conditions=["poisoned"], evil="payload")

    def test_requires_conditions(self):
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            RemoveConditionParams(mode="all")

    def test_default_mode_is_all(self):
        p = RemoveConditionParams(conditions=["blinded"])
        assert p.mode == "all"
