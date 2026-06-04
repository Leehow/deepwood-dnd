"""
Unit tests for the UI/Visual effect handlers:
- ResizeTokenHandler
- TokenVisualHandler (apply_token_filter, set_visibility)
- DisguiseHandler
- IllusionHandler
- ZoneVisualHandler
- TransformationHandler
"""
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.effect_engine.types import (
    EffectSource, HandlerContext, SideEffects,
)
from app.services.effect_engine.handlers.resize import ResizeTokenHandler
from app.services.effect_engine.handlers.token_visual import TokenVisualHandler
from app.services.effect_engine.handlers.disguise import DisguiseHandler
from app.services.effect_engine.handlers.illusion import IllusionHandler
from app.services.effect_engine.handlers.zone_visual import ZoneVisualHandler
from app.services.effect_engine.handlers.transformation import TransformationHandler


# ── Fixtures ──────────────────────────────────────────────────

def _make_source(**kw):
    defaults = dict(
        type="spell", id="enlarge_reduce", name="变巨/缩小术",
        caster_token_id=1, concentration=True, slot_level=2,
    )
    defaults.update(kw)
    return EffectSource(**defaults)


def _make_ctx(**kw):
    defaults = dict(
        caster_token_id=1, caster_name="法师", caster_level=5,
        spellcasting_mod=4, proficiency_bonus=3, spell_save_dc=15,
        spell_attack_bonus=7, spell_level=2, slot_level=2,
        spell_id="enlarge_reduce", spell_name="变巨/缩小术",
        concentration=True, campaign_id=1, in_combat=True,
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


def _make_token(token_size="1x1", active_effects=None, **kw):
    """Create a mock Token object."""
    token = MagicMock()
    token.token_size = token_size
    token.active_effects = active_effects or []
    token.disguise_data = None
    token.transformation_data = None
    for k, v in kw.items():
        setattr(token, k, v)
    return token


# ── ResizeTokenHandler ────────────────────────────────────────

class TestResizeTokenHandler:
    @pytest.mark.asyncio
    async def test_enlarge_medium_to_large(self):
        handler = ResizeTokenHandler()
        token = _make_token(token_size="1x1")
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(type="resize_token", sizeDelta=1)
        outcome = await handler.execute(params, hctx, SideEffects())

        assert token.token_size == "2x2"
        assert "large" in outcome.description or "大" in outcome.description

    @pytest.mark.asyncio
    async def test_reduce_medium_to_small(self):
        handler = ResizeTokenHandler()
        token = _make_token(token_size="1x1")
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(type="resize_token", sizeDelta=-1)
        outcome = await handler.execute(params, hctx, SideEffects())

        assert token.token_size == "1x1"  # small is also 1x1
        assert outcome.description  # should have description

    @pytest.mark.asyncio
    async def test_enlarge_large_to_huge(self):
        handler = ResizeTokenHandler()
        token = _make_token(token_size="2x2")
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(type="resize_token", sizeDelta=1)
        outcome = await handler.execute(params, hctx, SideEffects())

        assert token.token_size == "3x3"

    @pytest.mark.asyncio
    async def test_clamps_at_gargantuan(self):
        handler = ResizeTokenHandler()
        token = _make_token(token_size="4x4")
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(type="resize_token", sizeDelta=1)
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "无法继续" in outcome.description

    @pytest.mark.asyncio
    async def test_stores_revert_in_active_effects(self):
        handler = ResizeTokenHandler()
        token = _make_token(token_size="1x1")
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(type="resize_token", sizeDelta=1)
        await handler.execute(params, hctx, SideEffects())

        effects = token.active_effects
        assert len(effects) == 1
        assert effects[0]["effect_type"] == "resize_token"
        assert effects[0]["revert_size"] == "1x1"

    @pytest.mark.asyncio
    async def test_missing_token(self):
        handler = ResizeTokenHandler()
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=None)

        params = handler.get_param_schema()(type="resize_token", sizeDelta=1)
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "不存在" in outcome.description


# ── TokenVisualHandler (apply_token_filter) ───────────────────

class TestApplyTokenFilterHandler:
    @pytest.mark.asyncio
    async def test_applies_glow_filter(self):
        handler = TokenVisualHandler(verb="apply_token_filter")
        token = _make_token()
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(
            type="apply_token_filter",
            filter={"glow": "#22c55e", "glowRadius": 6},
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert len(token.active_effects) == 1
        entry = token.active_effects[0]
        assert entry["effect_type"] == "apply_token_filter"
        assert entry["filter"]["glow"] == "#22c55e"

    @pytest.mark.asyncio
    async def test_upserts_same_spell(self):
        """Second call from same spell replaces, not duplicates."""
        handler = TokenVisualHandler(verb="apply_token_filter")
        token = _make_token(active_effects=[{
            "id": "enlarge_reduce_apply_token_filter",
            "effect_type": "apply_token_filter",
            "filter": {"glow": "#old"},
        }])
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(
            type="apply_token_filter",
            filter={"glow": "#new"},
        )
        await handler.execute(params, hctx, SideEffects())

        assert len(token.active_effects) == 1
        assert token.active_effects[0]["filter"]["glow"] == "#new"


# ── TokenVisualHandler (set_visibility) ───────────────────────

class TestSetVisibilityHandler:
    @pytest.mark.asyncio
    async def test_invisible(self):
        handler = TokenVisualHandler(verb="set_visibility")
        token = _make_token()
        hctx = _make_hctx(
            source=_make_source(id="invisibility", name="隐身术"),
            ctx=_make_ctx(spell_id="invisibility", spell_name="隐身术"),
        )
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(
            type="set_visibility", mode="invisible",
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "隐形" in outcome.description
        entry = token.active_effects[0]
        assert entry["mode"] == "invisible"

    @pytest.mark.asyncio
    async def test_ethereal_with_filter(self):
        handler = TokenVisualHandler(verb="set_visibility")
        token = _make_token()
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(
            type="set_visibility", mode="ethereal",
            filter={"opacity": 0.3},
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "虚体" in outcome.description
        assert token.active_effects[0]["filter"]["opacity"] == 0.3


# ── DisguiseHandler ──────────────────────────────────────────

class TestDisguiseHandler:
    @pytest.mark.asyncio
    async def test_appearance_disguise(self):
        handler = DisguiseHandler()
        token = _make_token()
        hctx = _make_hctx(
            source=_make_source(id="disguise_self", name="易容术"),
            ctx=_make_ctx(spell_id="disguise_self", spell_name="易容术"),
        )
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(
            type="set_disguise", disguiseType="appearance", requiresImage=True,
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "易容" in outcome.description
        assert token.disguise_data["spell_id"] == "disguise_self"
        assert token.disguise_data["requires_image"] is True

    @pytest.mark.asyncio
    async def test_form_change(self):
        handler = DisguiseHandler()
        token = _make_token()
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(
            type="set_disguise", disguiseType="form_change",
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "变形" in outcome.description
        assert token.disguise_data["disguise_type"] == "form_change"


# ── IllusionHandler ──────────────────────────────────────────

class TestIllusionHandler:
    @pytest.mark.asyncio
    async def test_visual_illusion(self):
        handler = IllusionHandler()
        caster_token = _make_token()
        hctx = _make_hctx(
            source=_make_source(id="silent_image", name="静默幻影"),
            ctx=_make_ctx(spell_id="silent_image", spell_name="静默幻影"),
        )
        hctx.db.get = AsyncMock(return_value=caster_token)

        params = handler.get_param_schema()(
            type="spawn_illusion", illusionType="visual", controllable=True,
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "视觉" in outcome.description
        entry = caster_token.active_effects[0]
        assert entry["illusion_type"] == "visual"
        assert entry["controllable"] is True

    @pytest.mark.asyncio
    async def test_auditory_illusion(self):
        handler = IllusionHandler()
        caster_token = _make_token()
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=caster_token)

        params = handler.get_param_schema()(
            type="spawn_illusion", illusionType="auditory",
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "听觉" in outcome.description


# ── ZoneVisualHandler ────────────────────────────────────────

class TestZoneVisualHandler:
    @pytest.mark.asyncio
    async def test_fog_zone(self):
        handler = ZoneVisualHandler()
        caster_token = _make_token()
        hctx = _make_hctx(
            source=_make_source(id="fog_cloud", name="云雾术"),
            ctx=_make_ctx(spell_id="fog_cloud", spell_name="云雾术"),
        )
        hctx.db.get = AsyncMock(return_value=caster_token)

        params = handler.get_param_schema()(
            type="create_zone_visual", zoneType="fog", obscurement="heavy",
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "云雾" in outcome.description
        entry = caster_token.active_effects[0]
        assert entry["zone_type"] == "fog"
        assert entry["obscurement"] == "heavy"

    @pytest.mark.asyncio
    async def test_darkness_with_difficult_terrain(self):
        handler = ZoneVisualHandler()
        caster_token = _make_token()
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=caster_token)

        params = handler.get_param_schema()(
            type="create_zone_visual", zoneType="darkness",
            obscurement="heavy", difficultTerrain=True,
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        entry = caster_token.active_effects[0]
        assert entry["difficult_terrain"] is True

    @pytest.mark.asyncio
    async def test_light_zone_no_obscurement(self):
        handler = ZoneVisualHandler()
        caster_token = _make_token()
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=caster_token)

        params = handler.get_param_schema()(
            type="create_zone_visual", zoneType="light",
        )
        await handler.execute(params, hctx, SideEffects())

        entry = caster_token.active_effects[0]
        assert "obscurement" not in entry


# ── TransformationHandler ────────────────────────────────────

class TestTransformationHandler:
    @pytest.mark.asyncio
    async def test_polymorph(self):
        handler = TransformationHandler()
        token = _make_token()
        hctx = _make_hctx(
            source=_make_source(id="polymorph", name="变形术"),
            ctx=_make_ctx(spell_id="polymorph", spell_name="变形术"),
        )
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(
            type="apply_transformation", transformType="polymorph",
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "变形" in outcome.description
        assert token.transformation_data["source"]["config_id"] == "polymorph"
        assert token.transformation_data["type"] == "full_replace"

    @pytest.mark.asyncio
    async def test_alter_self_is_special_form(self):
        handler = TransformationHandler()
        token = _make_token()
        hctx = _make_hctx(
            source=_make_source(id="alter_self", name="变身自我"),
            ctx=_make_ctx(spell_id="alter_self", spell_name="变身自我"),
        )
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(
            type="apply_transformation", transformType="alter_self",
        )
        await handler.execute(params, hctx, SideEffects())

        assert token.transformation_data["type"] == "special_form"

    @pytest.mark.asyncio
    async def test_missing_token(self):
        handler = TransformationHandler()
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=None)

        params = handler.get_param_schema()(
            type="apply_transformation", transformType="polymorph",
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "不存在" in outcome.description


# ── Schema validation (extra fields rejected) ────────────────

class TestVisualHandlerSchemas:
    def test_resize_rejects_extra(self):
        handler = ResizeTokenHandler()
        schema = handler.get_param_schema()
        with pytest.raises(Exception):
            schema(type="resize_token", sizeDelta=1, evil="payload")

    def test_filter_rejects_extra(self):
        handler = TokenVisualHandler(verb="apply_token_filter")
        schema = handler.get_param_schema()
        with pytest.raises(Exception):
            schema(type="apply_token_filter", filter={"glow": "#f00"}, evil="x")

    def test_disguise_rejects_extra(self):
        handler = DisguiseHandler()
        schema = handler.get_param_schema()
        with pytest.raises(Exception):
            schema(type="set_disguise", disguiseType="appearance", evil="x")

    def test_illusion_rejects_extra(self):
        handler = IllusionHandler()
        schema = handler.get_param_schema()
        with pytest.raises(Exception):
            schema(type="spawn_illusion", illusionType="visual", evil="x")

    def test_zone_visual_rejects_extra(self):
        handler = ZoneVisualHandler()
        schema = handler.get_param_schema()
        with pytest.raises(Exception):
            schema(type="create_zone_visual", zoneType="fog", evil="x")

    def test_transformation_rejects_extra(self):
        handler = TransformationHandler()
        schema = handler.get_param_schema()
        with pytest.raises(Exception):
            schema(type="apply_transformation", transformType="polymorph", evil="x")
