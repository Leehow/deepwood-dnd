"""
Tests for Tier 1/2/3 effect handlers:
- ForcedMovementHandler, CreateWallHandler, CreateBarrierHandler,
  CreateMovingAuraHandler, CounterSpellHandler, GrantSenseHandler,
  PreventHealingHandler, StabilizeHandler, InstantKillHandler,
  ResurrectHandler, StoredTriggerHandler, SuppressMagicHandler
"""
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.effect_engine.types import (
    EffectSource, HandlerContext, SideEffects,
)
from app.services.effect_engine.handlers.forced_movement import ForcedMovementHandler
from app.services.effect_engine.handlers.wall import CreateWallHandler
from app.services.effect_engine.handlers.barrier import CreateBarrierHandler
from app.services.effect_engine.handlers.moving_aura import CreateMovingAuraHandler
from app.services.effect_engine.handlers.counter_spell import CounterSpellHandler
from app.services.effect_engine.handlers.sense import GrantSenseHandler
from app.services.effect_engine.handlers.utility import (
    PreventHealingHandler, StabilizeHandler, InstantKillHandler, ResurrectHandler,
    GrantActionHandler,
)
from app.services.effect_engine.handlers.heal import HealHandler
from app.services.effect_engine.handlers.stored_trigger import StoredTriggerHandler
from app.services.effect_engine.handlers.suppress_magic import SuppressMagicHandler


# ── Fixtures ──────────────────────────────────────────────────

def _src(**kw):
    d = dict(type="spell", id="test_spell", name="测试", caster_token_id=1, concentration=False, slot_level=3)
    d.update(kw)
    return EffectSource(**d)

def _ctx(**kw):
    d = dict(
        caster_token_id=1, caster_name="法师", caster_level=5,
        spellcasting_mod=4, proficiency_bonus=3, spell_save_dc=15,
        spell_attack_bonus=7, spell_level=3, slot_level=3,
        spell_id="test_spell", spell_name="测试",
        concentration=False, campaign_id=1, in_combat=True,
        current_world_time=None, variables={},
        caster_class_id=None, caster_subclass_id=None,
    )
    d.update(kw)
    return SimpleNamespace(**d)

def _tgt(**kw):
    d = dict(token_id=10, name="目标", character_id=None, monster_instance_id=None, condition_immunities=[], current_hp=20, max_hp=30)
    d.update(kw)
    return SimpleNamespace(**d)

def _hctx(target=None, ctx=None, **kw):
    d = dict(source=_src(), target=target or _tgt(), caster_ctx=ctx or _ctx(), phase={}, db=AsyncMock(),
             save_cfg=None, save_succeeded=None, attack_hit=None, is_critical=False, scaling=None, phase_damage_dealt=0)
    d.update(kw)
    return HandlerContext(**d)

def _tok(tid=1, ae=None, **kw):
    t = SimpleNamespace(id=tid, active_effects=ae or [], active_auras=[], current_hp=20, is_stable=False, **kw)
    return t


# ── ForcedMovement ────────────────────────────────────────────

class TestForcedMovement:
    @pytest.mark.asyncio
    async def test_push(self):
        h = ForcedMovementHandler()
        from app.services.effect_engine.handlers.forced_movement import ForcedMovementParams
        p = ForcedMovementParams(direction="push", distance=10)
        token = _tok(tid=10)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.forced_movement.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert "推开" in out.description
        assert token.active_effects[0]["distance"] == 10

    @pytest.mark.asyncio
    async def test_pull(self):
        h = ForcedMovementHandler()
        from app.services.effect_engine.handlers.forced_movement import ForcedMovementParams
        p = ForcedMovementParams(direction="pull", distance=15)
        token = _tok(tid=10)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.forced_movement.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert "拉近" in out.description

    @pytest.mark.asyncio
    async def test_missing_token(self):
        h = ForcedMovementHandler()
        from app.services.effect_engine.handlers.forced_movement import ForcedMovementParams
        p = ForcedMovementParams(direction="push", distance=10)
        db = AsyncMock(); db.get = AsyncMock(return_value=None)
        out = await h.execute(p, _hctx(db=db), SideEffects())
        assert "不存在" in out.description


# ── CreateWall ────────────────────────────────────────────────

class TestCreateWall:
    @pytest.mark.asyncio
    async def test_basic_wall(self):
        h = CreateWallHandler()
        from app.services.effect_engine.handlers.wall import CreateWallParams
        p = CreateWallParams(shape="line", lengthFt=60, heightFt=20, hpPerSegment=30)
        token = _tok(tid=1)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.wall.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert "60尺" in out.description
        assert token.active_effects[0]["hp_per_segment"] == 30

    @pytest.mark.asyncio
    async def test_indestructible_wall(self):
        h = CreateWallHandler()
        from app.services.effect_engine.handlers.wall import CreateWallParams
        p = CreateWallParams(shape="line", lengthFt=100)
        token = _tok(tid=1)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.wall.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert "hp_per_segment" not in token.active_effects[0]


# ── CreateBarrier ─────────────────────────────────────────────

class TestCreateBarrier:
    @pytest.mark.asyncio
    async def test_sphere_barrier(self):
        h = CreateBarrierHandler()
        from app.services.effect_engine.handlers.barrier import CreateBarrierParams
        p = CreateBarrierParams(shape="sphere", radiusFt=10, indestructible=True)
        token = _tok(tid=1)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.barrier.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert "球形" in out.description
        assert token.active_effects[0]["indestructible"] is True

    @pytest.mark.asyncio
    async def test_cage_barrier(self):
        h = CreateBarrierHandler()
        from app.services.effect_engine.handlers.barrier import CreateBarrierParams
        p = CreateBarrierParams(shape="cage", sideFt=10, teleportBlocked=True)
        token = _tok(tid=1)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.barrier.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert token.active_effects[0]["teleport_blocked"] is True


# ── CreateMovingAura ──────────────────────────────────────────

class TestCreateMovingAura:
    @pytest.mark.asyncio
    async def test_caster_aura(self):
        h = CreateMovingAuraHandler()
        from app.services.effect_engine.handlers.moving_aura import CreateMovingAuraParams
        p = CreateMovingAuraParams(radiusFt=15, anchor="caster", auraType="damage")
        token = _tok(tid=1)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.moving_aura.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert "15尺" in out.description
        assert token.active_effects[0]["anchor"] == "caster"

    @pytest.mark.asyncio
    async def test_target_aura(self):
        h = CreateMovingAuraHandler()
        from app.services.effect_engine.handlers.moving_aura import CreateMovingAuraParams
        p = CreateMovingAuraParams(radiusFt=10, anchor="target")
        token = _tok(tid=10)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.moving_aura.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        db.get.assert_called_once()
        assert db.get.call_args[0][1] == 10  # target token


# ── CounterSpell ──────────────────────────────────────────────

class TestCounterSpell:
    @pytest.mark.asyncio
    async def test_counter(self):
        h = CounterSpellHandler()
        from app.services.effect_engine.handlers.counter_spell import CounterSpellParams
        p = CounterSpellParams(autoCounterLevel=3)
        out = await h.execute(p, _hctx(), SideEffects())
        assert "3环" in out.description


# ── GrantSense ────────────────────────────────────────────────

class TestGrantSense:
    @pytest.mark.asyncio
    async def test_truesight(self):
        h = GrantSenseHandler()
        from app.services.effect_engine.handlers.sense import GrantSenseParams
        p = GrantSenseParams(senseType="truesight", range=120)
        token = _tok(tid=10)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.sense.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert "真实视觉" in out.description
        assert token.active_effects[0]["range"] == 120

    @pytest.mark.asyncio
    async def test_detect_invisible(self):
        h = GrantSenseHandler()
        from app.services.effect_engine.handlers.sense import GrantSenseParams
        p = GrantSenseParams(senseType="detect_invisible")
        token = _tok(tid=10)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.sense.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert token.active_effects[0]["sense_type"] == "detect_invisible"


# ── PreventHealing ────────────────────────────────────────────

class TestPreventHealing:
    @pytest.mark.asyncio
    async def test_prevent(self):
        h = PreventHealingHandler()
        from app.services.effect_engine.handlers.utility import PreventHealingParams
        p = PreventHealingParams()
        token = _tok(tid=10)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.utility.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert "无法恢复" in out.description
        assert token.active_effects[0]["effect_type"] == "prevent_healing"


# ── Stabilize ─────────────────────────────────────────────────

class TestStabilize:
    @pytest.mark.asyncio
    async def test_stabilize(self):
        h = StabilizeHandler()
        from app.services.effect_engine.handlers.utility import StabilizeParams
        p = StabilizeParams()
        token = _tok(tid=10, death_saves=None)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.utility.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert isinstance(token.death_saves, dict)
        assert token.death_saves["stabilized"] is True
        assert token.death_saves["successes"] == 0
        assert token.death_saves["failures"] == 0
        assert "稳定" in out.description

    @pytest.mark.asyncio
    async def test_stabilize_preserves_existing_counts(self):
        h = StabilizeHandler()
        from app.services.effect_engine.handlers.utility import StabilizeParams
        p = StabilizeParams()
        token = _tok(tid=10, death_saves={"successes": 2, "failures": 1, "stabilized": False})
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.utility.flag_modified"):
            await h.execute(p, hctx, SideEffects())
        assert token.death_saves["stabilized"] is True
        assert token.death_saves["successes"] == 2
        assert token.death_saves["failures"] == 1

    @pytest.mark.asyncio
    async def test_stabilize_on_real_mapped_token(self):
        """Regression: must not touch unmapped attributes (e.g. is_stable) on a real Token."""
        from app.models.token import Token as RealToken
        h = StabilizeHandler()
        from app.services.effect_engine.handlers.utility import StabilizeParams
        p = StabilizeParams()
        token = RealToken(death_saves=None)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        out = await h.execute(p, hctx, SideEffects())
        assert isinstance(token.death_saves, dict)
        assert token.death_saves["stabilized"] is True
        assert "稳定" in out.description


# ── InstantKill ───────────────────────────────────────────────

class TestInstantKill:
    @pytest.mark.asyncio
    async def test_kill_below_threshold(self):
        h = InstantKillHandler()
        from app.services.effect_engine.handlers.utility import InstantKillParams
        p = InstantKillParams(hpThreshold=100)
        token = _tok(tid=10)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        tgt = _tgt(current_hp=80)
        hctx = _hctx(db=db, target=tgt)
        out = await h.execute(p, hctx, SideEffects())
        assert "杀死" in out.description

    @pytest.mark.asyncio
    async def test_survive_above_threshold(self):
        h = InstantKillHandler()
        from app.services.effect_engine.handlers.utility import InstantKillParams
        p = InstantKillParams(hpThreshold=100)
        tgt = _tgt(current_hp=150)
        hctx = _hctx(target=tgt)
        out = await h.execute(p, hctx, SideEffects())
        assert "未受影响" in out.description


# ── Resurrect ─────────────────────────────────────────────────

class TestResurrect:
    @pytest.mark.asyncio
    async def test_resurrect_1hp(self):
        h = ResurrectHandler()
        from app.services.effect_engine.handlers.utility import ResurrectParams
        p = ResurrectParams(hpRestored="1")
        token = _tok(tid=10)
        token.current_hp = 0
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.utility.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert token.current_hp == 1
        assert "复活" in out.description

    @pytest.mark.asyncio
    async def test_resurrect_full(self):
        h = ResurrectHandler()
        from app.services.effect_engine.handlers.utility import ResurrectParams
        p = ResurrectParams(hpRestored="full")
        token = _tok(tid=10)
        token.current_hp = 0
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        tgt = _tgt(max_hp=50)
        hctx = _hctx(db=db, target=tgt)
        with patch("app.services.effect_engine.handlers.utility.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert token.current_hp == 50
        assert "满血" in out.description

    @pytest.mark.asyncio
    async def test_resurrect_clears_failed_death_saves(self):
        """Resurrect must clear residual death-save failures once HP > 0."""
        h = ResurrectHandler()
        from app.services.effect_engine.handlers.utility import ResurrectParams
        p = ResurrectParams(hpRestored="1")
        token = _tok(tid=10, death_saves={"successes": 0, "failures": 3, "stabilized": False})
        token.current_hp = 0
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.utility.flag_modified"):
            await h.execute(p, hctx, SideEffects())
        assert token.current_hp == 1
        assert token.death_saves == {"successes": 0, "failures": 0, "stabilized": False}


# ── Heal (downed-target death-save normalization) ─────────────

class TestHealDeathSaveNormalization:
    @pytest.mark.asyncio
    async def test_heal_clears_death_saves_when_target_was_downed(self):
        """Revivify-style heal on a 0-HP target with failed death saves must
        normalize ``death_saves`` so the runtime projection no longer reports
        the token as dying."""
        from app.services.effect_engine.handlers.heal import HealParams
        h = HealHandler()
        p = HealParams(formula="1")
        token = _tok(tid=10, death_saves={"successes": 0, "failures": 3, "stabilized": False})
        token.current_hp = 0
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        tgt = _tgt(token_id=10, current_hp=0, max_hp=30)
        hctx = _hctx(db=db, target=tgt)
        with patch("app.services.effect_engine.handlers.heal.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert out.healing_done >= 1
        assert token.death_saves == {"successes": 0, "failures": 0, "stabilized": False}

    @pytest.mark.asyncio
    async def test_heal_above_zero_leaves_death_saves_untouched(self):
        """Heal on an already-conscious target must not touch ``death_saves``."""
        from app.services.effect_engine.handlers.heal import HealParams
        h = HealHandler()
        p = HealParams(formula="1")
        token = _tok(tid=10, death_saves=None)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        tgt = _tgt(token_id=10, current_hp=10, max_hp=30)
        hctx = _hctx(db=db, target=tgt)
        await h.execute(p, hctx, SideEffects())
        assert token.death_saves is None


# ── GrantAction ───────────────────────────────────────────────

class TestGrantAction:
    @pytest.mark.asyncio
    async def test_registry_registers_grant_action(self):
        from app.services.effect_engine.engine import EffectEngine
        from app.services.effect_engine.registry import register_all_handlers

        engine = EffectEngine()
        register_all_handlers(engine)
        assert engine.can_handle("grant_action")
        assert "grant_action" in engine.registered_verbs

    @pytest.mark.asyncio
    async def test_grant_action_writes_active_effect_on_caster(self):
        from app.services.effect_engine.handlers.utility import (
            GrantActionParams, GrantActionDamage,
        )
        h = GrantActionHandler()
        p = GrantActionParams(
            action_type="action",
            action_name="巫术箭伤害",
            action_name_en="Witch Bolt Damage",
            icon="⚡",
            action_kind="repeat_damage",
            damage=GrantActionDamage(formula="1d12", damage_type="lightning"),
        )
        caster = _tok(tid=1)
        db = AsyncMock(); db.get = AsyncMock(return_value=caster)
        ctx = _ctx(spell_id="witch_bolt", spell_name="巫术箭", concentration=True, caster_token_id=1)
        tgt = _tgt(token_id=10)
        hctx = _hctx(db=db, target=tgt, ctx=ctx)
        with patch("app.services.effect_engine.handlers.utility.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert "巫术箭伤害" in out.description
        assert len(caster.active_effects) == 1
        entry = caster.active_effects[0]
        assert entry["effect_type"] == "grant_action"
        assert entry["spell_id"] == "witch_bolt"
        assert entry["action_type"] == "action"
        assert entry["action_name"] == "巫术箭伤害"
        assert entry["icon"] == "⚡"
        assert entry["action_kind"] == "repeat_damage"
        assert entry["damage"] == {"formula": "1d12", "damage_type": "lightning"}
        assert entry["is_concentration"] is True
        assert entry["target_token_id"] == 10

    @pytest.mark.asyncio
    async def test_grant_action_is_idempotent_per_action_name(self):
        from app.services.effect_engine.handlers.utility import GrantActionParams
        h = GrantActionHandler()
        p = GrantActionParams(action_type="action", action_name="后续动作")
        caster = _tok(tid=1)
        db = AsyncMock(); db.get = AsyncMock(return_value=caster)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.utility.flag_modified"):
            await h.execute(p, hctx, SideEffects())
            await h.execute(p, hctx, SideEffects())
        assert len(caster.active_effects) == 1


# ── StoredTrigger ─────────────────────────────────────────────

class TestStoredTrigger:
    @pytest.mark.asyncio
    async def test_enter_area(self):
        h = StoredTriggerHandler()
        from app.services.effect_engine.handlers.stored_trigger import StoredTriggerParams
        p = StoredTriggerParams(triggerCondition="enter_area", storedSpellId="fireball")
        token = _tok(tid=1)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.stored_trigger.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert "进入区域" in out.description
        assert token.active_effects[0]["stored_spell_id"] == "fireball"


# ── SuppressMagic ─────────────────────────────────────────────

class TestSuppressMagic:
    @pytest.mark.asyncio
    async def test_suppress_all(self):
        h = SuppressMagicHandler()
        from app.services.effect_engine.handlers.suppress_magic import SuppressMagicParams
        p = SuppressMagicParams(scope="zone")
        token = _tok(tid=1)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.suppress_magic.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert "所有" in out.description

    @pytest.mark.asyncio
    async def test_suppress_level_limit(self):
        h = SuppressMagicHandler()
        from app.services.effect_engine.handlers.suppress_magic import SuppressMagicParams
        p = SuppressMagicParams(maxSpellLevel=5, scope="zone")
        token = _tok(tid=1)
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        hctx = _hctx(db=db)
        with patch("app.services.effect_engine.handlers.suppress_magic.flag_modified"):
            out = await h.execute(p, hctx, SideEffects())
        assert "5环" in out.description
        assert token.active_effects[0]["max_spell_level"] == 5


# ── ModifierHandler ───────────────────────────────────────────

class TestModifierHandler:
    """Regression coverage for grant_resistance / grant_immunity / modify_roll
    multi-entry persistence (blade_ward bug — only last damage type was kept)."""

    @pytest.mark.asyncio
    async def test_grant_resistance_persists_all_damage_types(self):
        """blade_ward repro: 3 damage_types must yield 3 modifier entries."""
        from app.services.effect_engine.handlers.modifier import (
            ModifierHandler, GrantResistanceParams,
        )
        h = ModifierHandler(verb="grant_resistance")
        p = GrantResistanceParams(damage_types=["bludgeoning", "piercing", "slashing"])
        token = _tok(tid=10, ae=[])
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        ctx = _ctx(spell_id="blade_ward", spell_name="剑刃防护")
        hctx = _hctx(db=db, ctx=ctx, target=_tgt(token_id=10))
        with patch("app.services.effect_engine.handlers.modifier.flag_modified"):
            await h.execute(p, hctx, SideEffects())

        assert len(token.active_effects) == 1
        effect = token.active_effects[0]
        assert effect["id"] == "blade_ward_buff"
        mods = effect["modifiers"]
        assert len(mods) == 3
        dmg_types = [m["condition"]["damage_type"] for m in mods]
        assert dmg_types == ["bludgeoning", "piercing", "slashing"]
        for m in mods:
            assert m["target"] == "damage_taken"
            assert m["type"] == "resistance"

    @pytest.mark.asyncio
    async def test_grant_resistance_single_damage_type_shape_unchanged(self):
        """Single damage type: still one modifier with condition.damage_type as string."""
        from app.services.effect_engine.handlers.modifier import (
            ModifierHandler, GrantResistanceParams,
        )
        h = ModifierHandler(verb="grant_resistance")
        p = GrantResistanceParams(damage_types=["fire"])
        token = _tok(tid=10, ae=[])
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        ctx = _ctx(spell_id="resist_fire", spell_name="抗火")
        hctx = _hctx(db=db, ctx=ctx, target=_tgt(token_id=10))
        with patch("app.services.effect_engine.handlers.modifier.flag_modified"):
            await h.execute(p, hctx, SideEffects())

        mods = token.active_effects[0]["modifiers"]
        assert mods == [
            {"target": "damage_taken", "type": "resistance",
             "condition": {"damage_type": "fire"}},
        ]

    @pytest.mark.asyncio
    async def test_grant_resistance_extends_existing_effect(self):
        """Re-casting onto an effect that already exists must extend, not replace."""
        from app.services.effect_engine.handlers.modifier import (
            ModifierHandler, GrantResistanceParams,
        )
        h = ModifierHandler(verb="grant_resistance")
        p = GrantResistanceParams(damage_types=["cold", "fire"])
        prior = {
            "id": "blade_ward_buff",
            "name": "剑刃防护",
            "modifiers": [
                {"target": "damage_taken", "type": "resistance",
                 "condition": {"damage_type": "necrotic"}},
            ],
        }
        token = _tok(tid=10, ae=[prior])
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        ctx = _ctx(spell_id="blade_ward", spell_name="剑刃防护")
        hctx = _hctx(db=db, ctx=ctx, target=_tgt(token_id=10))
        with patch("app.services.effect_engine.handlers.modifier.flag_modified"):
            await h.execute(p, hctx, SideEffects())

        mods = token.active_effects[0]["modifiers"]
        dmg_types = [m["condition"]["damage_type"] for m in mods]
        assert dmg_types == ["necrotic", "cold", "fire"]

    @pytest.mark.asyncio
    async def test_grant_immunity_persists_all_damage_types(self):
        """grant_immunity had the same multi-entry overwrite bug."""
        from app.services.effect_engine.handlers.modifier import (
            ModifierHandler, GrantImmunityParams,
        )
        h = ModifierHandler(verb="grant_immunity")
        p = GrantImmunityParams(damage_types=["poison", "acid"])
        token = _tok(tid=10, ae=[])
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        ctx = _ctx(spell_id="immune_test", spell_name="免疫测试")
        hctx = _hctx(db=db, ctx=ctx, target=_tgt(token_id=10))
        with patch("app.services.effect_engine.handlers.modifier.flag_modified"):
            await h.execute(p, hctx, SideEffects())

        mods = token.active_effects[0]["modifiers"]
        assert [m["condition"]["damage_type"] for m in mods] == ["poison", "acid"]
        assert all(m["type"] == "immunity" for m in mods)

    @pytest.mark.asyncio
    async def test_modify_roll_persists_all_roll_types(self):
        """modify_roll loop also overwrote — bless-style multi-roll-type fix."""
        from app.services.effect_engine.handlers.modifier import (
            ModifierHandler, ModifyRollParams,
        )
        h = ModifierHandler(verb="modify_roll")
        p = ModifyRollParams(roll_types=["attack", "save"], formula="1d4")
        token = _tok(tid=10, ae=[])
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        ctx = _ctx(spell_id="bless_like", spell_name="测试祝福")
        hctx = _hctx(db=db, ctx=ctx, target=_tgt(token_id=10))
        with patch("app.services.effect_engine.handlers.modifier.flag_modified"):
            await h.execute(p, hctx, SideEffects())

        mods = token.active_effects[0]["modifiers"]
        targets = [m["target"] for m in mods]
        assert targets == ["attack_roll", "saving_throw"]
        assert all(m["type"] == "bonus" and m["value"] == "1d4" for m in mods)

    @pytest.mark.asyncio
    async def test_grant_advantage_single_entry_unchanged(self):
        """Sanity check: non-multi-list verbs still produce one entry."""
        from app.services.effect_engine.handlers.modifier import (
            ModifierHandler, GrantAdvantageParams,
        )
        h = ModifierHandler(verb="grant_advantage")
        p = GrantAdvantageParams(on="attack")
        token = _tok(tid=10, ae=[])
        db = AsyncMock(); db.get = AsyncMock(return_value=token)
        ctx = _ctx(spell_id="adv_test", spell_name="优势测试")
        hctx = _hctx(db=db, ctx=ctx, target=_tgt(token_id=10))
        with patch("app.services.effect_engine.handlers.modifier.flag_modified"):
            await h.execute(p, hctx, SideEffects())

        mods = token.active_effects[0]["modifiers"]
        assert mods == [{"target": "attack", "type": "advantage"}]


# ── Schema rejection tests ───────────────────────────────────

class TestSchemaRejection:
    def test_forced_movement_rejects_extra(self):
        from pydantic import ValidationError
        from app.services.effect_engine.handlers.forced_movement import ForcedMovementParams
        with pytest.raises(ValidationError):
            ForcedMovementParams(direction="push", distance=10, evil="x")

    def test_wall_rejects_extra(self):
        from pydantic import ValidationError
        from app.services.effect_engine.handlers.wall import CreateWallParams
        with pytest.raises(ValidationError):
            CreateWallParams(evil="x")

    def test_barrier_rejects_extra(self):
        from pydantic import ValidationError
        from app.services.effect_engine.handlers.barrier import CreateBarrierParams
        with pytest.raises(ValidationError):
            CreateBarrierParams(evil="x")

    def test_sense_rejects_extra(self):
        from pydantic import ValidationError
        from app.services.effect_engine.handlers.sense import GrantSenseParams
        with pytest.raises(ValidationError):
            GrantSenseParams(senseType="x", evil="x")

    def test_counter_rejects_extra(self):
        from pydantic import ValidationError
        from app.services.effect_engine.handlers.counter_spell import CounterSpellParams
        with pytest.raises(ValidationError):
            CounterSpellParams(evil="x")

    def test_suppress_rejects_extra(self):
        from pydantic import ValidationError
        from app.services.effect_engine.handlers.suppress_magic import SuppressMagicParams
        with pytest.raises(ValidationError):
            SuppressMagicParams(scope="zone", evil="x")
