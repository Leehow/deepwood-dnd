"""
Unit tests for Movement / Teleportation effect handlers:
- TeleportHandler
- MovementModHandler
- RestrictMovementHandler
"""
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.effect_engine.types import (
    EffectSource, HandlerContext, SideEffects,
)
from app.services.effect_engine.handlers.teleport import TeleportHandler
from app.services.effect_engine.handlers.movement import (
    MovementModHandler, RestrictMovementHandler,
)


# ── Fixtures ──────────────────────────────────────────────────

def _make_source(**kw):
    defaults = dict(
        type="spell", id="misty_step", name="迷踪步",
        caster_token_id=1, concentration=False, slot_level=2,
    )
    defaults.update(kw)
    return EffectSource(**defaults)


def _make_ctx(**kw):
    defaults = dict(
        caster_token_id=1, caster_name="法师", caster_level=5,
        spellcasting_mod=4, proficiency_bonus=3, spell_save_dc=15,
        spell_attack_bonus=7, spell_level=2, slot_level=2,
        spell_id="misty_step", spell_name="迷踪步",
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


def _make_hctx(target=None, ctx=None, phase=None, **kw):
    defaults = dict(
        source=_make_source(),
        target=target or _make_target(),
        caster_ctx=ctx or _make_ctx(),
        phase=phase or {},
        db=AsyncMock(),
        save_cfg=None, save_succeeded=None,
        attack_hit=None, is_critical=False,
        scaling=None, phase_damage_dealt=0,
    )
    defaults.update(kw)
    return HandlerContext(**defaults)


def _make_token(**kw):
    token = MagicMock()
    token.position_x = 100
    token.position_y = 200
    token.active_effects = []
    for k, v in kw.items():
        setattr(token, k, v)
    return token


# ── TeleportHandler ──────────────────────────────────────────

class TestTeleportHandler:
    @pytest.mark.asyncio
    async def test_self_teleport(self):
        handler = TeleportHandler()
        token = _make_token()
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(type="teleport", range=30, mode="self")
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "自身传送" in outcome.description
        assert "30尺" in outcome.description

    @pytest.mark.asyncio
    async def test_teleport_with_destination(self):
        handler = TeleportHandler()
        token = _make_token()
        hctx = _make_hctx(phase={"teleport_destination": {"x": 500, "y": 600}})
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(type="teleport", range=30, mode="self")
        await handler.execute(params, hctx, SideEffects())

        assert token.position_x == 500
        assert token.position_y == 600

    @pytest.mark.asyncio
    async def test_target_teleport(self):
        handler = TeleportHandler()
        token = _make_token()
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(type="teleport", range=500, mode="target")
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "传送目标" in outcome.description

    @pytest.mark.asyncio
    async def test_missing_token(self):
        handler = TeleportHandler()
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=None)

        params = handler.get_param_schema()(type="teleport", range=30, mode="self")
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "不存在" in outcome.description

    def test_rejects_extra_fields(self):
        handler = TeleportHandler()
        with pytest.raises(Exception):
            handler.get_param_schema()(type="teleport", range=30, mode="self", evil="x")


# ── MovementModHandler ───────────────────────────────────────

class TestMovementModHandler:
    @pytest.mark.asyncio
    async def test_grant_fly(self):
        handler = MovementModHandler()
        token = _make_token()
        hctx = _make_hctx(
            source=_make_source(id="fly", name="飞行术"),
            ctx=_make_ctx(spell_id="fly", spell_name="飞行术", concentration=True),
        )
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(
            type="modify_movement", movementType="fly",
            formula="60", operation="grant", hover=False,
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "飞行" in outcome.description
        assert "60尺" in outcome.description
        entry = token.active_effects[0]
        assert entry["movement_type"] == "fly"
        assert entry["formula"] == "60"
        assert entry["hover"] is False

    @pytest.mark.asyncio
    async def test_grant_swim(self):
        handler = MovementModHandler()
        token = _make_token()
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(
            type="modify_movement", movementType="swim",
            formula="walk_speed", operation="grant",
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "游泳" in outcome.description

    @pytest.mark.asyncio
    async def test_add_speed(self):
        handler = MovementModHandler()
        token = _make_token()
        hctx = _make_hctx(
            source=_make_source(id="longstrider", name="大步奔行"),
            ctx=_make_ctx(spell_id="longstrider", spell_name="大步奔行"),
        )
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(
            type="modify_movement", movementType="walk",
            formula="10", operation="add",
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "增加" in outcome.description
        assert "步行" in outcome.description

    @pytest.mark.asyncio
    async def test_upserts_same_spell(self):
        handler = MovementModHandler()
        token = _make_token(active_effects=[{
            "id": "fly_movement_fly", "effect_type": "modify_movement",
        }])
        hctx = _make_hctx(
            source=_make_source(id="fly", name="飞行术"),
            ctx=_make_ctx(spell_id="fly", spell_name="飞行术"),
        )
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(
            type="modify_movement", movementType="fly",
            formula="60", operation="grant",
        )
        await handler.execute(params, hctx, SideEffects())

        assert len(token.active_effects) == 1

    def test_rejects_extra_fields(self):
        handler = MovementModHandler()
        with pytest.raises(Exception):
            handler.get_param_schema()(
                type="modify_movement", movementType="fly", operation="grant", evil="x",
            )


# ── RestrictMovementHandler ──────────────────────────────────

class TestRestrictMovementHandler:
    @pytest.mark.asyncio
    async def test_immobilized(self):
        handler = RestrictMovementHandler()
        token = _make_token()
        hctx = _make_hctx(
            source=_make_source(id="entangle", name="纠缠术"),
            ctx=_make_ctx(spell_id="entangle", spell_name="纠缠术", concentration=True),
        )
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(
            type="restrict_movement", restriction="immobilized",
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "无法移动" in outcome.description
        entry = token.active_effects[0]
        assert entry["restriction"] == "immobilized"

    @pytest.mark.asyncio
    async def test_halved(self):
        handler = RestrictMovementHandler()
        token = _make_token()
        hctx = _make_hctx(
            source=_make_source(id="slow", name="减速术"),
            ctx=_make_ctx(spell_id="slow", spell_name="减速术"),
        )
        hctx.db.get = AsyncMock(return_value=token)

        params = handler.get_param_schema()(
            type="restrict_movement", restriction="halved",
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "速度减半" in outcome.description

    @pytest.mark.asyncio
    async def test_missing_token(self):
        handler = RestrictMovementHandler()
        hctx = _make_hctx()
        hctx.db.get = AsyncMock(return_value=None)

        params = handler.get_param_schema()(
            type="restrict_movement", restriction="zero",
        )
        outcome = await handler.execute(params, hctx, SideEffects())

        assert "不存在" in outcome.description

    def test_rejects_extra_fields(self):
        handler = RestrictMovementHandler()
        with pytest.raises(Exception):
            handler.get_param_schema()(
                type="restrict_movement", restriction="halved", evil="x",
            )
