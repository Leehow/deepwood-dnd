"""
Spell Effect Pipeline schemas.

Defines the structured effect format for spell data.
Spells with an `effects` field use these types to describe
executable effects that SpellResolver can process.
"""
from typing import Optional, List, Dict, Any, Union, Literal
from pydantic import BaseModel, Field


# ── Trigger types ──────────────────────────────────────────────
TriggerType = Literal[
    "on_cast",               # 施法瞬间
    "on_hit",                # 攻击命中时（smite类）
    "on_weapon_hit",         # 武器命中时
    "on_reaction",           # 反应触发
    "on_target_downed",      # 目标生命降至 0
    "start_of_target_turn",  # 目标回合开始
    "end_of_target_turn",    # 目标回合结束
    "start_of_turn",         # 任意绑定主体回合开始
    "end_of_turn",           # 任意绑定主体回合结束
    "on_enter_zone",         # 进入区域
    "on_leave_zone",         # 离开区域
    "on_take_damage",        # 受伤时
    "on_concentration_end",  # 专注结束
    "on_action_invoked",     # 执行授予动作时
    "narrative",             # 纯RP/叙事型，无机械效果
]


# ── Target config ──────────────────────────────────────────────
class TargetConfig(BaseModel):
    type: Literal["self", "single", "multiple", "zone", "all_in_area"] = "single"
    count: Optional[Union[int, str]] = None  # 数字或 "spell_mod"
    filter: Optional[Dict[str, Any]] = None  # creature type / alignment / maxHP 等


# ── Save config ────────────────────────────────────────────────
class SaveConfig(BaseModel):
    ability: str  # "dex", "wis", "con", etc.
    on_success: Literal["no_effect", "half_damage", "partial"] = "no_effect"
    on_failure: Optional[str] = None  # 额外效果说明


# ── Escape config ──────────────────────────────────────────────
class EscapeConfig(BaseModel):
    trigger: str  # "end_of_turn", "on_take_damage", "action"
    method: Literal["save", "check", "auto_end"] = "save"
    ability: Optional[str] = None  # 用于 save/check 的属性


# ── Attack config ──────────────────────────────────────────────
class AttackConfig(BaseModel):
    type: Literal["melee_spell", "ranged_spell"] = "ranged_spell"
    on_miss: Literal["no_effect", "half_damage"] = "no_effect"
    # 多发射物（魔能爆束 / 灼热射线道）：每个发射物各掷一次独立法术攻击骰
    projectiles: int = 1
    projectilesAtCharacterLevel: Optional[Dict[str, int]] = None


# ── Scaling config ─────────────────────────────────────────────
class ScalingConfig(BaseModel):
    per_slot_above: int = 1           # 基础环位
    extra_dice: Optional[str] = None  # 每升一环加的骰子, e.g. "1d6"
    extra_targets: Optional[int] = None
    extra_duration: Optional[str] = None
    extra_value: Optional[int] = None  # 每升一环固定值, e.g. tempHp +5
    extra_projectiles: Optional[int] = None  # 每高于 per_slot_above 一环额外发射物数


# ── Effect primitives ─────────────────────────────────────────
class DealDamageEffect(BaseModel):
    type: Literal["deal_damage"] = "deal_damage"
    formula: str           # "8d6", "2d6+MOD"
    damage_type: str       # "fire", "radiant", etc.
    scaling: Optional[ScalingConfig] = None


class HealEffect(BaseModel):
    type: Literal["heal"] = "heal"
    formula: str           # "1d8+MOD"
    scaling: Optional[ScalingConfig] = None


class ApplyConditionEffect(BaseModel):
    type: Literal["apply_condition"] = "apply_condition"
    condition: str         # "paralyzed", "frightened", etc.
    condition_cn: Optional[str] = None
    escape: Optional[EscapeConfig] = None


class ModifyStatEffect(BaseModel):
    """Static stat modifier, e.g. AC +5, speed +10"""
    type: Literal["modify_stat"] = "modify_stat"
    stat: str              # "ac", "speed", "hp_max"
    formula: str           # "5", "13+DEX_MOD", "10"
    operation: Literal["add", "set"] = "add"


class ModifyRollEffect(BaseModel):
    """Roll modifier like Bless +1d4 to attack/save"""
    type: Literal["modify_roll"] = "modify_roll"
    roll_types: List[str]  # ["attack", "save"], ["ability_check"]
    formula: str           # "1d4", "PROF"
    operation: Literal["add", "subtract"] = "add"
    consume_on_use: bool = False  # 一次性修正（如导引之光的下次攻击优势）


class GrantTempHpEffect(BaseModel):
    type: Literal["grant_temp_hp"] = "grant_temp_hp"
    formula: str           # "5", "1d4+4"
    scaling: Optional[ScalingConfig] = None


class GrantResistanceEffect(BaseModel):
    type: Literal["grant_resistance"] = "grant_resistance"
    damage_types: List[str]  # ["bludgeoning", "piercing", "slashing"]


class GrantAdvantageEffect(BaseModel):
    type: Literal["grant_advantage"] = "grant_advantage"
    on: str                # "attack", "save", "ability_check", "incoming_attack"
    condition: Optional[Dict[str, Any]] = None  # {"ability": "dex"} etc.
    consume_on_use: bool = False  # 一次性效果


class ApplyEffectEffect(BaseModel):
    """Apply a full active_effect object (for complex effects)."""
    type: Literal["apply_effect"] = "apply_effect"
    effect_data: Dict[str, Any]  # 直接就是 active_effects 的一条


class NarrativeEffect(BaseModel):
    """Non-mechanical effect handled by DM/AI narration."""
    type: Literal["narrative"] = "narrative"
    description: Optional[str] = None


# Union of all effect primitives
EffectPrimitive = Union[
    DealDamageEffect,
    HealEffect,
    ApplyConditionEffect,
    ModifyStatEffect,
    ModifyRollEffect,
    GrantTempHpEffect,
    GrantResistanceEffect,
    GrantAdvantageEffect,
    ApplyEffectEffect,
    NarrativeEffect,
]


# ── Effect Phase ───────────────────────────────────────────────
class EffectPhase(BaseModel):
    """A single phase of spell execution."""
    trigger: TriggerType = "on_cast"
    target: Optional[TargetConfig] = None
    attack: Optional[AttackConfig] = None  # 法术攻击骰（近战/远程法术攻击）
    save: Optional[SaveConfig] = None
    effects: List[Dict[str, Any]] = Field(default_factory=list)  # 用 Dict 以保持 JSON 灵活性
    escape: Optional[EscapeConfig] = None
    duration: Optional[Dict[str, Any]] = None  # {"rounds": 10, "concentration": true}
    scaling: Optional[ScalingConfig] = None
    condition: Optional[Dict[str, Any]] = None  # 触发前置条件


# ── Resolve result ─────────────────────────────────────────────
class EffectResult(BaseModel):
    """Result of a single effect execution."""
    type: str
    target_token_id: Optional[int] = None
    target_name: Optional[str] = None
    # Damage/healing
    damage_dealt: int = 0
    healing_done: int = 0
    temp_hp_granted: int = 0
    # Condition
    condition_applied: Optional[str] = None
    condition_immune: bool = False
    # Save
    save_rolled: bool = False
    save_succeeded: Optional[bool] = None
    save_total: Optional[int] = None
    save_dc: Optional[int] = None
    # Attack
    attack_rolled: bool = False
    attack_hit: Optional[bool] = None
    attack_roll: Optional[int] = None   # d20 result (natural)
    attack_total: Optional[int] = None  # d20 + bonus
    target_ac: Optional[int] = None
    critical_hit: bool = False
    # Formula details
    formula_breakdown: Optional[str] = None
    # Misc
    description: Optional[str] = None


class SpellResolveResult(BaseModel):
    """Full result of spell resolution through the pipeline."""
    resolved: bool = True
    phase_results: List[List[EffectResult]] = Field(default_factory=list)
    # Aggregated
    total_damage: int = 0
    total_healing: int = 0
    narrative_parts: List[str] = Field(default_factory=list)
    # Effects applied (for WebSocket broadcast)
    effects_applied: List[Dict[str, Any]] = Field(default_factory=list)
    concentration_set: bool = False
    # Items generated by spell effects (e.g. generate_item)
    items_generated: List[Dict[str, Any]] = Field(default_factory=list)
    # Caster tokens whose concentration was broken by dispel_magic
    concentration_broken_token_ids: List[int] = Field(default_factory=list)
    # Caster tokens whose concentration targets changed because a damaged target escaped/ended the effect
    concentration_touched_token_ids: List[int] = Field(default_factory=list)
    # Tokens whose runtime spell projections should be refreshed
    runtime_touched_token_ids: List[int] = Field(default_factory=list)
