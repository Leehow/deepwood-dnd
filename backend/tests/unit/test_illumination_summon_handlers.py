"""
Unit tests for Illumination and Summon effect handlers:
- IlluminationHandler
- SpawnSummonHandler
"""
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.effect_engine.types import (
    EffectSource, HandlerContext, SideEffects,
)
from app.services.effect_engine.handlers.illumination import (
    IlluminationHandler, ApplyIlluminationParams,
)
from app.services.effect_engine.handlers.summon import (
    SpawnSummonHandler, SpawnSummonParams,
)


# ── Fixtures ──────────────────────────────────────────────────

def _make_source(**kw):
    defaults = dict(
        type="spell", id="light", name="光亮术",
        caster_token_id=1, concentration=False, slot_level=0,
    )
    defaults.update(kw)
    return EffectSource(**defaults)


def _make_ctx(**kw):
    defaults = dict(
        caster_token_id=1, caster_name="法师", caster_level=5,
        spellcasting_mod=4, proficiency_bonus=3, spell_save_dc=15,
        spell_attack_bonus=7, spell_level=0, slot_level=0,
        spell_id="light", spell_name="光亮术",
        concentration=False, campaign_id=1, in_combat=False,
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


def _mock_token(token_id=1, active_effects=None):
    t = SimpleNamespace(
        id=token_id,
        active_effects=active_effects or [],
    )
    return t


# ── IlluminationHandler Tests ─────────────────────────────────

class TestIlluminationHandler:
    @pytest.mark.asyncio
    async def test_light_on_caster(self):
        handler = IlluminationHandler()
        params = ApplyIlluminationParams(
            lightType="light", brightRadius=20, dimRadius=20,
        )
        token = _mock_token(token_id=1)
        db = AsyncMock()
        db.get = AsyncMock(return_value=token)
        hctx = _make_hctx(db=db)

        with patch("app.services.effect_engine.handlers.illumination.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())

        assert "20" in outcome.description
        assert len(token.active_effects) == 1
        eff = token.active_effects[0]
        assert eff["effect_type"] == "apply_illumination"
        assert eff["light_type"] == "light"
        assert eff["bright_radius"] == 20
        assert eff["dim_radius"] == 20

    @pytest.mark.asyncio
    async def test_darkness_spell(self):
        handler = IlluminationHandler()
        params = ApplyIlluminationParams(
            lightType="darkness", darknessRadius=15,
            blocksDarkvision=True,
        )
        token = _mock_token(token_id=1)
        db = AsyncMock()
        db.get = AsyncMock(return_value=token)
        hctx = _make_hctx(db=db)

        with patch("app.services.effect_engine.handlers.illumination.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())

        assert "黑暗" in outcome.description
        eff = token.active_effects[0]
        assert eff["light_type"] == "darkness"
        assert eff["darkness_radius"] == 15
        assert eff["blocks_darkvision"] is True

    @pytest.mark.asyncio
    async def test_attach_to_target(self):
        handler = IlluminationHandler()
        params = ApplyIlluminationParams(
            lightType="light", brightRadius=10, dimRadius=10,
            attachTo="target",
        )
        target_token = _mock_token(token_id=10)
        db = AsyncMock()
        db.get = AsyncMock(return_value=target_token)
        hctx = _make_hctx(db=db)

        with patch("app.services.effect_engine.handlers.illumination.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())

        # Should have fetched target token (id=10), not caster (id=1)
        db.get.assert_called_once()
        call_args = db.get.call_args
        assert call_args[0][1] == 10  # target token_id

    @pytest.mark.asyncio
    async def test_sunlight_and_movable(self):
        handler = IlluminationHandler()
        params = ApplyIlluminationParams(
            lightType="light", brightRadius=60, dimRadius=60,
            isSunlight=True, movable=True, moveAction="bonus_action",
        )
        token = _mock_token(token_id=1)
        db = AsyncMock()
        db.get = AsyncMock(return_value=token)
        hctx = _make_hctx(db=db)

        with patch("app.services.effect_engine.handlers.illumination.flag_modified"):
            await handler.execute(params, hctx, SideEffects())

        eff = token.active_effects[0]
        assert eff["is_sunlight"] is True
        assert eff["movable"] is True
        assert eff["move_action"] == "bonus_action"

    @pytest.mark.asyncio
    async def test_dispels_level(self):
        handler = IlluminationHandler()
        params = ApplyIlluminationParams(
            lightType="light", brightRadius=30, dimRadius=30,
            dispelsLevel=2,
        )
        token = _mock_token(token_id=1)
        db = AsyncMock()
        db.get = AsyncMock(return_value=token)
        hctx = _make_hctx(db=db)

        with patch("app.services.effect_engine.handlers.illumination.flag_modified"):
            await handler.execute(params, hctx, SideEffects())

        eff = token.active_effects[0]
        assert eff["dispels_level"] == 2

    @pytest.mark.asyncio
    async def test_token_not_found(self):
        handler = IlluminationHandler()
        params = ApplyIlluminationParams(lightType="light", brightRadius=10, dimRadius=10)
        db = AsyncMock()
        db.get = AsyncMock(return_value=None)
        hctx = _make_hctx(db=db)
        outcome = await handler.execute(params, hctx, SideEffects())
        assert "不存在" in outcome.description

    @pytest.mark.asyncio
    async def test_replaces_existing_illumination(self):
        handler = IlluminationHandler()
        params = ApplyIlluminationParams(lightType="light", brightRadius=30, dimRadius=30)
        existing = [{"id": "light_illumination", "effect_type": "apply_illumination"}]
        token = _mock_token(token_id=1, active_effects=existing)
        db = AsyncMock()
        db.get = AsyncMock(return_value=token)
        hctx = _make_hctx(db=db)

        with patch("app.services.effect_engine.handlers.illumination.flag_modified"):
            await handler.execute(params, hctx, SideEffects())

        assert len(token.active_effects) == 1
        assert token.active_effects[0]["bright_radius"] == 30


# ── SpawnSummonHandler Tests ──────────────────────────────────

class TestSpawnSummonHandler:
    @pytest.mark.asyncio
    async def test_basic_summon(self):
        handler = SpawnSummonHandler()
        params = SpawnSummonParams(instanceName="火元素")
        token = _mock_token(token_id=1)
        db = AsyncMock()
        db.get = AsyncMock(return_value=token)
        ctx = _make_ctx(spell_id="conjure_elemental", spell_name="召唤元素")
        hctx = _make_hctx(db=db, ctx=ctx)

        with patch("app.services.effect_engine.handlers.summon.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())

        assert "火元素" in outcome.description
        assert len(token.active_effects) == 1
        eff = token.active_effects[0]
        assert eff["effect_type"] == "spawn_summon"
        assert eff["instance_name"] == "火元素"

    @pytest.mark.asyncio
    async def test_summon_with_details(self):
        handler = SpawnSummonHandler()
        params = SpawnSummonParams(
            instanceName="骷髅",
            monsterId="skeleton",
            tokenSize="1x1",
            hpFormula="13",
            count=4,
            faction="player",
        )
        token = _mock_token(token_id=1)
        db = AsyncMock()
        db.get = AsyncMock(return_value=token)
        hctx = _make_hctx(db=db)

        with patch("app.services.effect_engine.handlers.summon.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())

        assert "×4" in outcome.description
        eff = token.active_effects[0]
        assert eff["monster_id"] == "skeleton"
        assert eff["token_size"] == "1x1"
        assert eff["hp_formula"] == "13"
        assert eff["count"] == 4
        assert eff["faction"] == "player"

    @pytest.mark.asyncio
    async def test_summon_replaces_existing(self):
        handler = SpawnSummonHandler()
        params = SpawnSummonParams(instanceName="狼")
        existing = [
            {"id": "conjure_animals_summon", "effect_type": "spawn_summon"},
            {"id": "shield_buff", "effect_type": "modifier"},
        ]
        token = _mock_token(token_id=1, active_effects=existing)
        db = AsyncMock()
        db.get = AsyncMock(return_value=token)
        ctx = _make_ctx(spell_id="conjure_animals", spell_name="召唤动物")
        hctx = _make_hctx(db=db, ctx=ctx)

        with patch("app.services.effect_engine.handlers.summon.flag_modified"):
            await handler.execute(params, hctx, SideEffects())

        # Old summon replaced, other effect kept
        assert len(token.active_effects) == 2
        types = {e["effect_type"] for e in token.active_effects}
        assert "spawn_summon" in types
        assert "modifier" in types

    @pytest.mark.asyncio
    async def test_summon_token_not_found(self):
        handler = SpawnSummonHandler()
        params = SpawnSummonParams(instanceName="元素")
        db = AsyncMock()
        db.get = AsyncMock(return_value=None)
        hctx = _make_hctx(db=db)
        outcome = await handler.execute(params, hctx, SideEffects())
        assert "不存在" in outcome.description

    @pytest.mark.asyncio
    async def test_single_count_no_multiplier(self):
        handler = SpawnSummonHandler()
        params = SpawnSummonParams(instanceName="魔仆", count=1)
        token = _mock_token(token_id=1)
        db = AsyncMock()
        db.get = AsyncMock(return_value=token)
        hctx = _make_hctx(db=db)

        with patch("app.services.effect_engine.handlers.summon.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())

        assert "×" not in outcome.description


# ── Schema Validation ─────────────────────────────────────────

class TestSchemas:
    def test_illumination_rejects_extra(self):
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            ApplyIlluminationParams(lightType="light", evil="payload")

    def test_summon_rejects_extra(self):
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            SpawnSummonParams(instanceName="x", evil="payload")

    def test_illumination_requires_light_type(self):
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            ApplyIlluminationParams(brightRadius=10)

    def test_summon_requires_instance_name(self):
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            SpawnSummonParams()
