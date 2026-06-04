"""
Unit tests for the Effect Engine framework and handlers.

Tests cover:
1. Engine registration, dispatch, and validation
2. DamageHandler — formula evaluation, crit, resistance, immunity, save half
3. HealHandler — formula, max HP cap, half_damage mode
4. NarrativeHandler — description passthrough
5. TempHpHandler — formula, D&D 5E "take higher" rule
6. ConditionHandler — immunity check, active_effects write
7. ModifierHandler — buff entry creation
8. Schema validation — extra fields rejected (anti-injection)
"""
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.effect_engine.engine import (
    EffectEngine, UnknownVerbError, EffectValidationError,
)
from app.services.effect_engine.types import (
    EffectSource, HandlerContext, HandlerOutcome, SideEffects,
)
from app.services.effect_engine.handlers.damage import DamageHandler, DamageParams
from app.services.effect_engine.handlers.heal import HealHandler, HealParams
from app.services.effect_engine.handlers.narrative import NarrativeHandler
from app.services.effect_engine.handlers.temp_hp import TempHpHandler
from app.services.effect_engine.handlers.condition import ConditionHandler
from app.services.effect_engine.handlers.moving_aura import CreateMovingAuraHandler, CreateMovingAuraParams
from app.services.effect_engine.handlers.modifier import ModifierHandler
from app.services.effect_engine.handlers.raw_effect import RawEffectHandler
from app.services.effect_engine.handlers.dispel import DispelHandler
from app.services.effect_engine.handlers.generate_item import GenerateItemHandler
from app.services.effect_engine.handlers.utility import (
    GrantActionHandler, GrantActionParams,
)
from app.services.effect_engine.registry import register_all_handlers


# ── Fixtures ──────────────────────────────────────────────────

def _make_source(**kw):
    defaults = dict(type="spell", id="fireball", name="火球术", caster_token_id=1, concentration=False, slot_level=3)
    defaults.update(kw)
    return EffectSource(**defaults)


def _make_ctx(**kw):
    defaults = dict(
        caster_token_id=1, caster_name="法师", caster_level=5,
        spellcasting_mod=4, proficiency_bonus=3, spell_save_dc=15,
        spell_attack_bonus=7, spell_level=3, slot_level=3,
        spell_id="fireball", spell_name="火球术",
        caster_class_id=None, caster_subclass_id=None,
        caster_ability_scores={}, concentration=False,
        campaign_id=1, in_combat=True, selected_option=None,
        current_world_time=None,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults, variables={"MOD": defaults["spellcasting_mod"], "PROF": defaults["proficiency_bonus"], "LEVEL": defaults["caster_level"]})


def _make_target(**kw):
    defaults = dict(
        token_id=10, name="哥布林", ac=12,
        current_hp=20, max_hp=20,
        character_id=None, monster_instance_id=None,
        damage_resistances=[], damage_immunities=[],
        condition_immunities=[], active_effects=[],
        ability_scores={"dex": 14, "con": 10, "wis": 8},
        level=1, class_id=None, proficiency_bonus=2,
        save_override=None, creature_type="", size="中型",
    )
    defaults.update(kw)
    t = SimpleNamespace(**defaults)
    t.size_index = lambda: {"小型": 1, "中型": 2, "大型": 3}.get(defaults["size"], 2)
    return t


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


# ── Engine Tests ──────────────────────────────────────────────

class TestEngine:
    def test_register_and_can_handle(self):
        engine = EffectEngine()
        engine.register("deal_damage", DamageHandler())
        assert engine.can_handle("deal_damage")
        assert not engine.can_handle("unknown")

    @pytest.mark.asyncio
    async def test_unknown_verb_raises(self):
        engine = EffectEngine()
        hctx = _make_hctx()
        with pytest.raises(UnknownVerbError, match="no_such_verb"):
            await engine.execute_effect({"type": "no_such_verb"}, hctx, SideEffects())

    @pytest.mark.asyncio
    async def test_validation_rejects_extra_fields(self):
        engine = EffectEngine()
        engine.register("deal_damage", DamageHandler())
        hctx = _make_hctx()
        with pytest.raises(EffectValidationError, match="deal_damage"):
            await engine.execute_effect(
                {"type": "deal_damage", "formula": "1d6", "damage_type": "fire", "evil": "payload"},
                hctx, SideEffects(),
            )

    def test_register_all_handlers(self):
        engine = EffectEngine()
        register_all_handlers(engine)
        expected = {
            "deal_damage", "heal", "apply_condition", "grant_temp_hp",
            "apply_effect", "generate_item", "dispel_magic", "narrative",
            "modify_stat", "modify_roll", "grant_resistance", "grant_immunity",
            "grant_advantage", "grant_disadvantage",
            "resize_token", "apply_token_filter", "set_visibility",
            "set_disguise", "spawn_illusion", "create_zone_visual",
            "apply_transformation",
            "teleport", "modify_movement", "restrict_movement",
            "apply_illumination", "spawn_summon", "remove_condition",
            "forced_movement", "create_wall", "create_barrier",
            "create_moving_aura", "counter_spell", "grant_sense",
            "prevent_healing", "stabilize", "instant_kill", "resurrect",
            "grant_action",
            "stored_trigger", "suppress_magic",
        }
        assert engine.registered_verbs == expected


# ── DamageHandler Tests ───────────────────────────────────────

class TestDamageHandler:
    @pytest.mark.asyncio
    @patch("app.services.effect_engine.handlers.damage.eval_formula")
    async def test_basic_damage(self, mock_eval):
        mock_eval.return_value = SimpleNamespace(
            total=28, dice_groups=[], modifier=0, breakdown="8d6(28)",
        )
        handler = DamageHandler()
        params = DamageParams(formula="8d6", damage_type="fire")
        hctx = _make_hctx()
        outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.damage_dealt == 28
        assert "8d6" in outcome.formula_breakdown

    @pytest.mark.asyncio
    @patch("app.services.effect_engine.handlers.damage.eval_formula")
    async def test_damage_immunity(self, mock_eval):
        mock_eval.return_value = SimpleNamespace(total=20, dice_groups=[], modifier=0, breakdown="20")
        target = _make_target(damage_immunities=["fire"])
        handler = DamageHandler()
        params = DamageParams(formula="8d6", damage_type="fire")
        hctx = _make_hctx(target=target)
        outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.damage_dealt == 0
        assert "免疫" in outcome.description

    @pytest.mark.asyncio
    @patch("app.services.effect_engine.handlers.damage.eval_formula")
    async def test_damage_resistance_halves(self, mock_eval):
        mock_eval.return_value = SimpleNamespace(total=20, dice_groups=[], modifier=0, breakdown="20")
        target = _make_target(damage_resistances=["fire"])
        handler = DamageHandler()
        params = DamageParams(formula="8d6", damage_type="fire")
        hctx = _make_hctx(target=target)
        outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.damage_dealt == 10

    @pytest.mark.asyncio
    @patch("app.services.effect_engine.handlers.damage.eval_formula")
    async def test_save_half_damage(self, mock_eval):
        mock_eval.return_value = SimpleNamespace(total=20, dice_groups=[], modifier=0, breakdown="20")
        handler = DamageHandler()
        params = DamageParams(formula="8d6", damage_type="fire", half_on_save=True)
        hctx = _make_hctx(
            save_cfg={"on_success": "half_damage"},
            save_succeeded=True,
        )
        outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.damage_dealt == 10

    @pytest.mark.asyncio
    @patch("app.services.effect_engine.handlers.damage.eval_formula")
    async def test_active_effect_resistance_halves_spell_damage(self, mock_eval):
        mock_eval.return_value = SimpleNamespace(total=20, dice_groups=[], modifier=0, breakdown="20")
        target = _make_target(
            active_effects=[
                {
                    "id": "aura_buff_aura_of_life_1",
                    "name": "生命灵光",
                    "aura_applied": True,
                    "modifiers": [
                        {
                            "target": "damage_taken",
                            "type": "resistance",
                            "condition": {"damage_type": "necrotic"},
                        }
                    ],
                }
            ]
        )
        handler = DamageHandler()
        params = DamageParams(formula="8d6", damage_type="necrotic")
        hctx = _make_hctx(target=target)
        outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.damage_dealt == 10

    @pytest.mark.asyncio
    @patch("app.services.effect_engine.handlers.damage.eval_formula")
    async def test_save_success_override_can_zero_spell_damage(self, mock_eval):
        mock_eval.return_value = SimpleNamespace(total=20, dice_groups=[], modifier=0, breakdown="20")
        target = _make_target(
            active_effects=[
                {
                    "id": "aura_buff_circle_of_power_1",
                    "name": "原力法阵",
                    "aura_applied": True,
                    "save_success_override": {
                        "mode": "no_damage_on_success",
                        "scope": "spell",
                    },
                }
            ]
        )
        handler = DamageHandler()
        params = DamageParams(formula="8d6", damage_type="fire")
        hctx = _make_hctx(
            target=target,
            save_cfg={"on_success": "half_damage"},
            save_succeeded=True,
        )
        outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.damage_dealt == 0

    @pytest.mark.asyncio
    @patch("app.services.effect_engine.handlers.damage.eval_formula")
    async def test_critical_doubles_dice(self, mock_eval):
        roll = SimpleNamespace(
            total=15, dice_groups=[SimpleNamespace(total=15)], modifier=0, breakdown="8d6(15)",
        )
        mock_eval.return_value = roll
        handler = DamageHandler()
        params = DamageParams(formula="8d6", damage_type="fire")
        hctx = _make_hctx(is_critical=True)
        outcome = await handler.execute(params, hctx, SideEffects())
        # Two rolls of dice_total each + modifier
        assert outcome.damage_dealt == 30
        assert "暴击" in outcome.formula_breakdown


# ── HealHandler Tests ─────────────────────────────────────────

class TestHealHandler:
    @pytest.mark.asyncio
    @patch("app.services.effect_engine.handlers.heal.eval_formula")
    async def test_basic_heal(self, mock_eval):
        mock_eval.return_value = SimpleNamespace(
            total=10, dice_groups=[], modifier=0, breakdown="1d8+4",
        )
        handler = HealHandler()
        params = HealParams(formula="1d8+MOD")
        target = _make_target(current_hp=15, max_hp=20)
        hctx = _make_hctx(target=target)
        outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.healing_done == 5  # capped at max_hp - current_hp

    @pytest.mark.asyncio
    async def test_half_damage_heal(self):
        handler = HealHandler()
        params = HealParams(formula="half_damage")
        target = _make_target(current_hp=5, max_hp=20)
        hctx = _make_hctx(target=target, phase_damage_dealt=20)
        outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.healing_done == 10


# ── NarrativeHandler Tests ────────────────────────────────────

class TestNarrativeHandler:
    @pytest.mark.asyncio
    async def test_returns_description(self):
        handler = NarrativeHandler()
        from app.services.effect_engine.handlers.narrative import NarrativeParams
        params = NarrativeParams(description="一道光芒闪过")
        hctx = _make_hctx()
        outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.description == "一道光芒闪过"


class TestCreateMovingAuraHandler:
    @pytest.mark.asyncio
    async def test_populates_active_auras_and_runtime_touched_tokens(self):
        token = SimpleNamespace(
            id=1,
            active_effects=[],
            active_auras=[],
        )
        db = AsyncMock()
        db.get = AsyncMock(return_value=token)
        db.flush = AsyncMock()
        hctx = _make_hctx(
            db=db,
            target=_make_target(token_id=2, name="盟友"),
            ctx=_make_ctx(spell_id="holy_aura", spell_name="圣洁灵光", concentration=True),
        )
        handler = CreateMovingAuraHandler()
        params = CreateMovingAuraParams(radiusFt=30, anchor="caster", auraType="protection")
        side_effects = SideEffects()

        with patch("app.services.effect_engine.handlers.moving_aura.flag_modified"):
            outcome = await handler.execute(params, hctx, side_effects)

        assert outcome.description == "创建30尺跟随光环"
        assert token.active_auras[0]["id"] == "holy_aura"
        assert token.active_auras[0]["selected_target_token_ids"] == [2]
        assert token.active_effects[0]["spell_buff"] is True
        assert 1 in side_effects.runtime_touched_token_ids


# ── TempHpHandler Tests ───────────────────────────────────────

class TestTempHpHandler:
    @pytest.mark.asyncio
    @patch("app.services.effect_engine.handlers.temp_hp.eval_formula")
    async def test_temp_hp_take_higher(self, mock_eval):
        mock_eval.return_value = SimpleNamespace(total=8, dice_groups=[], modifier=0, breakdown="8")
        handler = TempHpHandler()
        from app.services.effect_engine.handlers.temp_hp import TempHpParams
        params = TempHpParams(formula="8")
        # Token already has 5 temp HP → should take 8 (higher)
        mock_token = SimpleNamespace(temp_hp=5)
        db = AsyncMock()
        db.get = AsyncMock(return_value=mock_token)
        hctx = _make_hctx(db=db)
        outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.temp_hp_granted == 8
        assert mock_token.temp_hp == 8


# ── ConditionHandler Tests ────────────────────────────────────

class TestConditionHandler:
    @pytest.mark.asyncio
    async def test_condition_immunity(self):
        handler = ConditionHandler()
        from app.services.effect_engine.handlers.condition import ConditionParams
        params = ConditionParams(condition="paralyzed")
        target = _make_target(condition_immunities=["paralyzed"])
        hctx = _make_hctx(target=target)
        outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.condition_immune is True
        assert "免疫" in outcome.description

    @pytest.mark.asyncio
    async def test_condition_applied(self):
        handler = ConditionHandler()
        from app.services.effect_engine.handlers.condition import ConditionParams
        params = ConditionParams(condition="frightened", condition_cn="恐惧")

        mock_token = SimpleNamespace(active_effects=[], campaign_id=1)
        db = AsyncMock()
        db.get = AsyncMock(return_value=mock_token)
        db.flush = AsyncMock()

        target = _make_target()
        hctx = _make_hctx(target=target, db=db)

        with patch("app.services.effect_engine.handlers.condition.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())

        assert outcome.condition_applied == "frightened"


class TestConditionHpGate:
    """power_word_stun: the stun applies only when the target is at or below an
    HP threshold (RAW: ≤150 HP, otherwise no effect). Mirrors the instant_kill
    `hpThreshold` mechanism that power_word_kill uses (≤100 HP). The gate is an
    optional `hpThreshold` on apply_condition; absent it, behaviour is unchanged.
    """

    @pytest.mark.asyncio
    async def test_hp_gate_blocks_above_threshold(self):
        """200-HP target → no stun (current_hp > hpThreshold)."""
        handler = ConditionHandler()
        from app.services.effect_engine.handlers.condition import ConditionParams
        params = ConditionParams(condition="stunned", condition_cn="震慑", hpThreshold=150)
        target = _make_target(current_hp=200, max_hp=200)
        hctx = _make_hctx(target=target)
        outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.condition_applied is None
        assert "150" in (outcome.description or "")

    @pytest.mark.asyncio
    async def test_hp_gate_applies_at_threshold_without_save(self):
        """≤150-HP target → stunned automatically (no initial save in params)."""
        handler = ConditionHandler()
        from app.services.effect_engine.handlers.condition import ConditionParams
        params = ConditionParams(condition="stunned", condition_cn="震慑", hpThreshold=150)
        mock_token = SimpleNamespace(active_effects=[], campaign_id=1)
        db = AsyncMock()
        db.get = AsyncMock(return_value=mock_token)
        db.flush = AsyncMock()
        target = _make_target(current_hp=150, max_hp=200)
        hctx = _make_hctx(target=target, db=db)
        with patch("app.services.effect_engine.handlers.condition.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.condition_applied == "stunned"

    @pytest.mark.asyncio
    async def test_hp_gate_immune_target_not_stunned(self):
        """Condition-immune target → not stunned (immunity wins over HP gate)."""
        handler = ConditionHandler()
        from app.services.effect_engine.handlers.condition import ConditionParams
        params = ConditionParams(condition="stunned", condition_cn="震慑", hpThreshold=150)
        target = _make_target(current_hp=100, max_hp=200, condition_immunities=["stunned"])
        hctx = _make_hctx(target=target)
        outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.condition_immune is True
        assert outcome.condition_applied is None

    @pytest.mark.asyncio
    async def test_no_hp_threshold_means_no_gate(self):
        """Without hpThreshold, a high-HP target is still affected (regression)."""
        handler = ConditionHandler()
        from app.services.effect_engine.handlers.condition import ConditionParams
        params = ConditionParams(condition="frightened", condition_cn="恐惧")
        mock_token = SimpleNamespace(active_effects=[], campaign_id=1)
        db = AsyncMock()
        db.get = AsyncMock(return_value=mock_token)
        db.flush = AsyncMock()
        target = _make_target(current_hp=9999, max_hp=9999)
        hctx = _make_hctx(target=target, db=db)
        with patch("app.services.effect_engine.handlers.condition.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())
        assert outcome.condition_applied == "frightened"


# ── Schema Validation Tests ───────────────────────────────────

class TestSchemaValidation:
    def test_damage_rejects_extra_fields(self):
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            DamageParams(formula="1d6", damage_type="fire", injected_field="DROP TABLE")

    def test_heal_rejects_extra_fields(self):
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            HealParams(formula="1d6", evil="true")

    def test_damage_accepts_valid_fields(self):
        p = DamageParams(formula="8d6", damage_type="fire", half_on_save=True)
        assert p.formula == "8d6"
        assert p.damage_type == "fire"
        assert p.half_on_save is True


# ── GrantActionHandler Tests ──────────────────────────────────

class TestGrantActionHandler:
    """Regression coverage for `grant_action` effects that carry an `attack`
    sub-block (plus movement / scaling / healing passthrough keys).

    These four spells used to raise ``EffectValidationError`` — and therefore
    HTTP 500 on ``POST /api/spells/cast`` — because ``GrantActionParams`` was
    ``extra="forbid"`` and declared none of those fields. The v2 runtime verb
    (``spell_runtime_engine/verbs/granted_action.py``) keeps the raw effect
    dict, so the legacy handler is brought in line: it tolerates and preserves
    the full granted-action payload.
    """

    # Verbatim grant_action shapes from frontend/app/data/rules/spells.json.
    SPELL_SHAPES = {
        "flame_blade": {
            "type": "grant_action", "action_type": "action",
            "action_name": "火焰刀攻击", "action_name_en": "Flame Blade Attack",
            "icon": "🔥", "action_kind": "attack",
            "attack": {"type": "melee_spell", "on_miss": "no_effect"},
            "damage": {"formula": "3d6", "damage_type": "fire"},
            "scaling": {"per_slot_above": 2, "extra_dice": "1d6"},
        },
        "spiritual_weapon": {
            "type": "grant_action", "action_type": "bonus_action",
            "action_name": "灵体武器攻击", "action_name_en": "Spiritual Weapon Attack",
            "icon": "⚔️", "action_kind": "attack",
            "attack": {"type": "melee_spell", "on_miss": "no_effect"},
            "damage": {"formula": "1d8+MOD", "damage_type": "force"},
            "movement": {"range": 20},
            "scaling": {"per_slot_above": 2, "extra_dice": "1d8"},
        },
        "vampiric_touch": {
            "type": "grant_action", "action_type": "action",
            "action_name": "吸血鬼之触攻击", "action_name_en": "Vampiric Touch Attack",
            "icon": "🧛", "action_kind": "attack",
            "attack": {"type": "melee_spell", "on_miss": "no_effect"},
            "damage": {"formula": "3d6", "damage_type": "necrotic"},
            "healing": {"formula": "half_damage"},
            "scaling": {"per_slot_above": 3, "extra_dice": "1d6"},
        },
        "mordenkainens_sword": {
            "type": "grant_action", "action_type": "bonus_action",
            "action_name": "摩登肯之剑攻击", "action_name_en": "Mordenkainen's Sword Attack",
            "icon": "⚔️", "action_kind": "attack",
            "attack": {"type": "melee_spell", "on_miss": "no_effect"},
            "damage": {"formula": "3d10", "damage_type": "force"},
            "movement": {"range": 20},
        },
    }

    def test_schema_accepts_attack_grant_actions(self):
        for spell_id, shape in self.SPELL_SHAPES.items():
            params = GrantActionParams.model_validate(shape)
            assert params.attack is not None, spell_id
            assert params.attack.type == "melee_spell", spell_id
            assert params.damage is not None, spell_id

    @pytest.mark.asyncio
    async def test_handler_persists_attack_and_passthrough(self):
        token = SimpleNamespace(active_effects=[])
        db = AsyncMock()
        db.get = AsyncMock(return_value=token)
        db.flush = AsyncMock()
        hctx = _make_hctx(
            db=db,
            target=_make_target(token_id=10, name="哥布林"),
            ctx=_make_ctx(
                spell_id="spiritual_weapon", spell_name="灵体武器",
                caster_token_id=1, concentration=False,
            ),
        )
        params = GrantActionParams.model_validate(self.SPELL_SHAPES["spiritual_weapon"])
        handler = GrantActionHandler()
        with patch("app.services.effect_engine.handlers.utility.flag_modified"):
            outcome = await handler.execute(params, hctx, SideEffects())

        assert token.active_effects, "granted action not persisted on caster"
        entry = token.active_effects[0]
        assert entry["effect_type"] == "grant_action"
        assert entry["action_name"] == "灵体武器攻击"
        assert entry["attack"] == {"type": "melee_spell", "on_miss": "no_effect"}
        assert entry["damage"] == {"formula": "1d8+MOD", "damage_type": "force"}
        # Passthrough sub-objects preserved verbatim (mirrors v2 raw dict).
        assert entry["movement"] == {"range": 20}
        assert entry["target_token_id"] == 10
        assert "获得后续动作" in outcome.description

    @pytest.mark.asyncio
    async def test_move_effect_grant_does_not_lock_target_token(self):
        """A `move_effect` grant (Moonbeam / Flaming Sphere) relocates an area,
        so the on-cast area target must NOT be pinned as `target_token_id` — that
        stale lock is what mis-routed the follow-up to single-target casting."""
        token = SimpleNamespace(active_effects=[])
        db = AsyncMock()
        db.get = AsyncMock(return_value=token)
        db.flush = AsyncMock()
        hctx = _make_hctx(
            db=db,
            target=_make_target(token_id=10, name="哥布林"),
            ctx=_make_ctx(
                spell_id="moonbeam", spell_name="月华之光",
                caster_token_id=1, concentration=True,
            ),
        )
        params = GrantActionParams.model_validate({
            "type": "grant_action", "action_type": "action",
            "action_name": "移动月华之光", "action_kind": "move_effect",
            "save": {"ability": "con", "on_success": "half_damage"},
            "damage": {"formula": "2d10", "damage_type": "radiant"},
            "movement": {"range": 60},
        })
        with patch("app.services.effect_engine.handlers.utility.flag_modified"):
            await GrantActionHandler().execute(params, hctx, SideEffects())

        entry = token.active_effects[0]
        assert entry["action_kind"] == "move_effect"
        assert "target_token_id" not in entry, (
            "move_effect must not lock the on-cast area target"
        )

    @pytest.mark.asyncio
    async def test_repeat_damage_grant_still_locks_target_token(self):
        """Witch Bolt style repeat_damage must keep the locked single target."""
        token = SimpleNamespace(active_effects=[])
        db = AsyncMock()
        db.get = AsyncMock(return_value=token)
        db.flush = AsyncMock()
        hctx = _make_hctx(
            db=db,
            target=_make_target(token_id=42, name="目标"),
            ctx=_make_ctx(
                spell_id="witch_bolt", spell_name="巫术箭",
                caster_token_id=1, concentration=True,
            ),
        )
        params = GrantActionParams.model_validate({
            "type": "grant_action", "action_type": "action",
            "action_name": "巫术箭伤害", "action_kind": "repeat_damage",
            "damage": {"formula": "1d12", "damage_type": "lightning"},
        })
        with patch("app.services.effect_engine.handlers.utility.flag_modified"):
            await GrantActionHandler().execute(params, hctx, SideEffects())

        entry = token.active_effects[0]
        assert entry["action_kind"] == "repeat_damage"
        assert entry["target_token_id"] == 42

    @pytest.mark.asyncio
    async def test_engine_does_not_reject_attack_grant_action(self):
        # Exercises the exact boundary that produced the 500: the engine
        # validates effect params before dispatch.
        engine = EffectEngine()
        engine.register("grant_action", GrantActionHandler())
        token = SimpleNamespace(active_effects=[])
        db = AsyncMock()
        db.get = AsyncMock(return_value=token)
        db.flush = AsyncMock()
        hctx = _make_hctx(
            db=db,
            ctx=_make_ctx(spell_id="flame_blade", spell_name="火焰刀"),
        )
        with patch("app.services.effect_engine.handlers.utility.flag_modified"):
            outcome = await engine.execute_effect(
                self.SPELL_SHAPES["flame_blade"], hctx, SideEffects(),
            )
        assert outcome.description
