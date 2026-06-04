"""Combat action schemas"""
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field, model_validator


class AbilityScores(BaseModel):
    strength: int
    dexterity: int
    constitution: int
    intelligence: int
    wisdom: int
    charisma: int


class ExtraDamage(BaseModel):
    """Extra damage (e.g., poison, fire) added on top of base damage"""
    dice: Optional[str] = None  # e.g., "1d4", "2d6"
    type: Optional[str] = None  # e.g., "poison", "fire", "毒素"


class AttackOption(BaseModel):
    """Attack option from frontend"""
    key: str
    name: str
    name_en: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    weapon_name: Optional[str] = None
    damage: Optional[str] = None  # e.g., "1d8", "2d6"
    damage_type: Optional[str] = None  # e.g., "穿刺", "挥砍"
    extra_damage: Optional[ExtraDamage] = None  # Additional damage (e.g., poison)
    properties: Optional[List[str]] = None
    range: Optional[str] = None
    normal_range: Optional[int] = None
    max_range: Optional[int] = None
    needs_ammo: Optional[bool] = False
    ammo_count: Optional[int] = None
    is_special: Optional[bool] = False
    weapon_proficient: Optional[bool] = True  # Whether attacker is proficient with this weapon
    magic_bonus: Optional[int] = None  # Magic weapon bonus (e.g., +1, +2, +3)
    is_off_hand: Optional[bool] = False  # Off-hand (bonus action) attack — no ability mod to damage unless Two-Weapon Fighting


class AttackerData(BaseModel):
    """Attacker information"""
    name: str
    level: Optional[int] = 1
    class_id: Optional[str] = None
    subclass_id: Optional[str] = None
    class_name: Optional[str] = None
    race_id: Optional[str] = None  # For racial features like Savage Attacks
    ability_scores: AbilityScores
    proficiency_bonus: int = 2
    crit_range: int = 20  # Minimum roll for critical hit (20 = only nat 20, 19 = 19-20, etc.)
    fighting_style: Optional[str] = None  # e.g., 'archery', 'dueling', 'defense', 'great_weapon_fighting'


class TargetData(BaseModel):
    """Target information"""
    name: str
    ac: int
    saving_throws: Optional[Dict[str, int]] = None
    damage_resistances: Optional[List[str]] = None
    damage_immunities: Optional[List[str]] = None
    current_hp: Optional[int] = None
    max_hp: Optional[int] = None
    # Equipment info for narrative generation (prevents LLM hallucination)
    has_shield: Optional[bool] = None  # Whether defender is using a shield
    equipped_weapon: Optional[str] = None  # Main hand weapon name for parry descriptions

    @model_validator(mode="before")
    @classmethod
    def normalize_damage_fields(cls, data):
        if not isinstance(data, dict):
            return data

        normalized = dict(data)
        if normalized.get("damage_resistances") is None and normalized.get("resistances") is not None:
            normalized["damage_resistances"] = normalized.get("resistances")
        if normalized.get("damage_immunities") is None and normalized.get("immunities") is not None:
            normalized["damage_immunities"] = normalized.get("immunities")
        return normalized


class AttackRequest(BaseModel):
    """Request to perform an attack action"""
    campaign_id: int
    attacker_token_id: int
    attacker_character_id: Optional[int] = None
    attacker_monster_instance_id: Optional[int] = None
    target_token_id: int
    attack: AttackOption
    distance_feet: float
    attacker: AttackerData
    target: TargetData
    # Auto-apply damage or require DM confirmation
    auto_apply: bool = True
    # For monsters: use pre-calculated attack bonus instead of computing from ability scores
    attack_bonus_override: Optional[int] = None
    # For monsters: use pre-calculated damage bonus instead of computing
    damage_bonus_override: Optional[int] = None
    # DM-granted advantage/disadvantage for this roll
    roll_modifier: Optional[str] = None  # 'advantage' | 'disadvantage' | None
    # Bardic Inspiration die to add to attack roll (e.g., 'd6', 'd8', 'd10', 'd12')
    inspiration_die: Optional[str] = None
    # Portent: replace d20 roll with a stored value (Divination Wizard)
    portent_value: Optional[int] = None
    # Advantage reasons to display in combat log (e.g., ["🏹 宿敌：不死生物"])
    advantage_reasons: Optional[List[str]] = None
    # Feat: Great Weapon Master / Sharpshooter power attack (-5 hit / +10 damage)
    power_attack: bool = False
    # Rogue Sneak Attack: frontend determines eligibility
    sneak_attack: bool = False
    # Post-roll bonus: forced d20 value (replay same roll with bonus)
    forced_d20: Optional[int] = None
    # Post-roll bonus: additional attack bonus (e.g., Guided Strike +10)
    attack_bonus_add: int = 0
    attack_bonus_add_source: Optional[str] = None


class DiceRoll(BaseModel):
    """A single dice roll result"""
    dice: str  # e.g., "1d20", "2d6"
    rolls: List[int]  # Individual dice results
    modifier: int = 0
    total: int


class AttackResult(BaseModel):
    """Result of an attack action"""
    # Basic result
    hit: bool
    critical: bool = False
    fumble: bool = False

    # Rolls
    attack_roll: DiceRoll
    damage_roll: Optional[DiceRoll] = None
    extra_damage_roll: Optional[DiceRoll] = None  # Extra damage like poison
    savage_attacks_roll: Optional[DiceRoll] = None  # Half-orc Savage Attacks extra die
    brutal_critical_roll: Optional[DiceRoll] = None  # Barbarian Brutal Critical extra dice
    inspiration_roll: Optional[DiceRoll] = None  # Bardic Inspiration die roll

    # Calculated values
    total_attack: int
    target_ac: int
    damage_dealt: int = 0
    damage_type: Optional[str] = None
    extra_damage_dealt: int = 0  # Extra damage amount
    extra_damage_type: Optional[str] = None  # Extra damage type
    savage_attacks_damage: int = 0  # Half-orc Savage Attacks bonus damage
    brutal_critical_damage: int = 0  # Barbarian Brutal Critical bonus damage
    sneak_attack_roll: Optional[DiceRoll] = None  # Rogue Sneak Attack dice
    sneak_attack_damage: int = 0  # Rogue Sneak Attack bonus damage
    enlarge_reduce_roll: Optional[DiceRoll] = None  # Enlarge/Reduce weapon damage modifier
    enlarge_reduce_damage: int = 0  # Enlarge/Reduce bonus/penalty damage
    enlarge_reduce_mode: Optional[str] = None  # "enlarge" or "reduce"

    # Narrative
    narrative: str

    # State updates (for auto-apply mode)
    hp_change: Optional[int] = None
    new_hp: Optional[int] = None
    target_defeated: bool = False

    # Metadata
    attacker_name: str
    target_name: str
    attack_name: str


class AttackResponse(BaseModel):
    """API response for attack action"""
    success: bool
    result: Optional[AttackResult] = None
    error: Optional[str] = None
    # Whether DM confirmation is needed
    pending_confirmation: bool = False


# ============== Saving Throw Schemas ==============

class SavingThrowType(BaseModel):
    """Saving throw type enum values"""
    # Valid values: strength, dexterity, constitution, intelligence, wisdom, charisma

ABILITY_NAMES = {
    "strength": "力量",
    "dexterity": "敏捷",
    "constitution": "体质",
    "intelligence": "智力",
    "wisdom": "感知",
    "charisma": "魅力"
}


class SavingThrowTargetData(BaseModel):
    """Target data for saving throw"""
    name: str
    token_id: int
    character_id: Optional[int] = None
    monster_instance_id: Optional[int] = None
    ability_scores: AbilityScores
    level: int = 1
    class_id: Optional[str] = None  # For determining saving throw proficiency
    proficiency_bonus: int = 2
    # Override saving throw modifier (for monsters with pre-calculated saves)
    saving_throw_override: Optional[int] = None
    current_hp: Optional[int] = None
    max_hp: Optional[int] = None
    # Portent: replace d20 roll with a stored value (Divination Wizard)
    portent_value: Optional[int] = None


class SavingThrowRequest(BaseModel):
    """Request to perform a saving throw"""
    campaign_id: int
    # Source of the saving throw (caster, trap, etc.)
    source_name: str
    source_token_id: Optional[int] = None
    # Effect details
    effect_name: str  # e.g., "火球术", "毒素喷射"
    effect_description: Optional[str] = None
    # Saving throw parameters
    save_type: str  # strength, dexterity, constitution, intelligence, wisdom, charisma
    save_dc: int  # Difficulty Class
    # Damage on failed save (optional)
    damage_dice: Optional[str] = None  # e.g., "8d6"
    damage_type: Optional[str] = None  # e.g., "火焰"
    half_on_success: bool = True  # If true, successful save = half damage
    # Targets
    targets: List[SavingThrowTargetData]
    # Lucky feat: character IDs that spend a Lucky point for an extra d20
    use_lucky_character_ids: List[int] = []
    # Bardic Inspiration die (e.g., 'd6', 'd8', 'd10', 'd12')
    inspiration_die: Optional[str] = None
    # Character IDs that use Bardic Inspiration on their save
    inspiration_character_ids: List[int] = []
    # Auto-apply damage or require DM confirmation
    auto_apply: bool = True


class SavingThrowTargetResult(BaseModel):
    """Result for a single target's saving throw"""
    target_name: str
    target_token_id: int
    # Roll details
    save_roll: DiceRoll
    save_modifier: int
    save_total: int
    save_dc: int
    # Result
    success: bool
    # Damage (if applicable)
    damage_roll: Optional[DiceRoll] = None
    damage_dealt: int = 0
    damage_type: Optional[str] = None
    # HP changes
    hp_change: Optional[int] = None
    new_hp: Optional[int] = None
    target_defeated: bool = False


class SavingThrowResult(BaseModel):
    """Result of a saving throw effect"""
    effect_name: str
    source_name: str
    save_type: str
    save_dc: int
    # Results for each target
    target_results: List[SavingThrowTargetResult]
    # Summary
    total_targets: int
    successful_saves: int
    failed_saves: int
    # Narrative
    narrative: str


class SavingThrowResponse(BaseModel):
    """API response for saving throw"""
    success: bool
    result: Optional[SavingThrowResult] = None
    error: Optional[str] = None


# ============== Ability Check Schemas ==============

class AbilityCheckParticipant(BaseModel):
    """Participant in an ability check"""
    name: str
    token_id: int
    character_id: Optional[int] = None
    monster_instance_id: Optional[int] = None
    ability_scores: AbilityScores
    level: int = 1
    proficiency_bonus: int = 2
    # Skills this participant is proficient in
    proficient_skills: Optional[List[str]] = None
    # Skills this participant has expertise in
    expertise_skills: Optional[List[str]] = None
    # Override modifier (for monsters with pre-calculated bonuses)
    check_modifier_override: Optional[int] = None


class AbilityCheckRequest(BaseModel):
    """Request to perform an ability check"""
    campaign_id: int
    # Participant making the check
    participant: AbilityCheckParticipant
    # Check details
    check_type: str  # "strength", "athletics", "stealth", etc.
    dc: Optional[int] = None  # Difficulty Class (if not a contest)
    # Description
    description: Optional[str] = None  # e.g., "尝试攀爬城墙"
    # Bardic Inspiration die (e.g., 'd6', 'd8')
    inspiration_die: Optional[str] = None
    # Lucky feat: spend a luck point for extra d20
    use_lucky: bool = False
    # Portent: replace d20 roll with a stored value
    portent_value: Optional[int] = None


class AbilityCheckResult(BaseModel):
    """Result of an ability check"""
    participant_name: str
    participant_token_id: int
    # Check details
    check_type: str
    ability_used: str
    # Roll details
    check_roll: DiceRoll
    check_modifier: int
    check_total: int
    # Advantage/disadvantage info
    had_advantage: bool = False
    had_disadvantage: bool = False
    advantage_reasons: List[str] = []
    # Result (if DC was provided)
    dc: Optional[int] = None
    success: Optional[bool] = None
    # Narrative
    narrative: str


class AbilityCheckResponse(BaseModel):
    """API response for ability check"""
    success: bool
    result: Optional[AbilityCheckResult] = None
    error: Optional[str] = None


# ============== Contest (Opposed Check) Schemas ==============

class ContestRequest(BaseModel):
    """Request for a contested ability check (e.g., grapple, shove)"""
    campaign_id: int
    # Contest type
    contest_type: str  # "grapple", "shove", "custom"
    # Participants
    attacker: AbilityCheckParticipant
    defender: AbilityCheckParticipant
    # For custom contests, specify the check types
    attacker_check_type: Optional[str] = None  # e.g., "athletics"
    defender_check_type: Optional[str] = None  # e.g., "athletics" or "acrobatics"
    # For shove: attacker chooses the effect
    shove_effect: Optional[str] = None  # "prone" (倒地) or "push" (推开5尺)
    # Description
    description: Optional[str] = None


class ContestResult(BaseModel):
    """Result of a contested ability check"""
    contest_type: str
    # Attacker result
    attacker_name: str
    attacker_token_id: int
    attacker_check_type: str
    attacker_roll: DiceRoll
    attacker_modifier: int
    attacker_total: int
    attacker_had_advantage: bool = False
    attacker_had_disadvantage: bool = False
    attacker_advantage_reasons: List[str] = []
    # Defender result
    defender_name: str
    defender_token_id: int
    defender_check_type: str
    defender_roll: DiceRoll
    defender_modifier: int
    defender_total: int
    defender_had_advantage: bool = False
    defender_had_disadvantage: bool = False
    defender_advantage_reasons: List[str] = []
    # Winner
    attacker_wins: bool
    tie: bool = False  # Ties go to defender in D&D 5e
    # Effect applied (for grapple/shove)
    effect_applied: Optional[str] = None  # "grappled", "prone", "pushed_5ft"
    # Narrative
    narrative: str


class ContestResponse(BaseModel):
    """API response for contest"""
    success: bool
    result: Optional[ContestResult] = None
    error: Optional[str] = None


# ============== Spell Casting Schemas ==============

DAMAGE_TYPE_EN_TO_CN = {
    'fire': '火焰', 'cold': '冰冷', 'lightning': '闪电',
    'thunder': '雷鸣', 'poison': '毒素', 'acid': '强酸',
    'necrotic': '黯蚀', 'radiant': '光耀', 'force': '力场',
    'psychic': '心灵', 'piercing': '穿刺', 'slashing': '挥砍',
    'bludgeoning': '钝击'
}

SAVE_TYPE_CN = {
    'str': '力量', 'dex': '敏捷', 'con': '体质',
    'int': '智力', 'wis': '感知', 'cha': '魅力',
    'strength': '力量', 'dexterity': '敏捷', 'constitution': '体质',
    'intelligence': '智力', 'wisdom': '感知', 'charisma': '魅力'
}


class OngoingSave(BaseModel):
    """持续豁免配置"""
    timing: str  # 'end_of_turn' | 'start_of_turn'
    save_type: Optional[str] = Field(None, alias="saveType")

    model_config = {"populate_by_name": True}


class EscapeAction(BaseModel):
    """动作挣脱配置"""
    type: str  # 'check' | 'save'
    ability: str  # 使用的属性

    model_config = {"populate_by_name": True}


class ControlEffect(BaseModel):
    """控制法术效果配置"""
    condition: Optional[str] = None  # 施加的状态: 'paralyzed', 'restrained', etc.
    condition_cn: Optional[str] = Field(None, alias="conditionCn")
    ongoing_save: Optional[OngoingSave] = Field(None, alias="ongoingSave")
    escape_action: Optional[EscapeAction] = Field(None, alias="escapeAction")
    break_conditions: Optional[List[str]] = Field(None, alias="breakConditions")
    duration_rounds: Optional[int] = Field(None, alias="durationRounds")
    # 新增字段
    effect_type: Optional[str] = Field(None, alias="effectType")
    zone_trigger: Optional[str] = Field(None, alias="zoneTrigger")
    escape_hint: Optional[str] = Field(None, alias="escapeHint")

    model_config = {"populate_by_name": True}


class SpellData(BaseModel):
    """Spell data from frontend"""
    id: str
    name: str
    name_en: Optional[str] = None
    level: int  # 0 = cantrip
    school: Optional[str] = None
    # Concentration
    concentration: bool = False  # Whether the spell requires concentration
    # Damage info
    damage: Optional[str] = None  # e.g., "1d10"
    damage_type: Optional[str] = None  # e.g., "fire"
    damage_type_cn: Optional[str] = None
    # For scaling with character level (cantrips)
    damage_at_character_level: Optional[Dict[str, str]] = None
    # For scaling with spell slot level
    damage_at_slot_level: Optional[Dict[str, str]] = None
    # Healing info
    healing: Optional[str] = None  # e.g., "1d4 + MOD"
    healing_at_slot_level: Optional[Dict[str, str]] = None
    # Attack/save type
    attack_type: Optional[str] = None  # 'melee_spell', 'ranged_spell', 'save', 'auto'
    save_type: Optional[str] = None  # 'dex', 'wis', etc.
    save_type_cn: Optional[str] = None
    save_effect: Optional[str] = None  # 'half', 'none', 'partial'
    # Range
    range: Optional[str] = None
    # Area of effect
    area_of_effect: Optional[Dict[str, Any]] = None
    # Override save DC (e.g., breath weapons have pre-calculated DC)
    spell_save_dc: Optional[int] = None
    # Control spell
    is_control_spell: Optional[bool] = None
    control_effect: Optional[ControlEffect] = None
    # Effect pipeline (new system)
    effects: Optional[List[Dict[str, Any]]] = None


class CasterData(BaseModel):
    """Caster information"""
    name: str
    token_id: int
    character_id: Optional[int] = None
    level: int = 1
    class_id: Optional[str] = None
    subclass_id: Optional[str] = None
    ability_scores: AbilityScores
    proficiency_bonus: int = 2
    # Spellcasting ability - determines spell attack bonus and save DC
    spellcasting_ability: str = "intelligence"  # 'intelligence', 'wisdom', 'charisma'


class SpellTargetData(BaseModel):
    """Target data for spell"""
    name: str
    token_id: int
    character_id: Optional[int] = None
    monster_instance_id: Optional[int] = None
    ac: int = 10
    # For saving throws
    ability_scores: Optional[AbilityScores] = None
    saving_throw_override: Optional[int] = None  # For monsters
    saving_throw_auto_fail: bool = False
    level: int = 1
    class_id: Optional[str] = None
    race_id: Optional[str] = None  # For race-based immunities (e.g., elf sleep immunity)
    proficiency_bonus: int = 2
    # HP tracking
    current_hp: Optional[int] = None
    max_hp: Optional[int] = None
    # Damage resistances/immunities
    damage_resistances: Optional[List[str]] = None
    damage_immunities: Optional[List[str]] = None
    # Condition immunities (for control effects)
    condition_immunities: Optional[List[str]] = None


class SpellCastRequest(BaseModel):
    """Request to cast a spell"""
    campaign_id: int
    # Caster info
    caster: CasterData
    # Target info
    target: SpellTargetData
    # Spell info
    spell: SpellData
    slot_level: int  # 0 for cantrips, actual slot level for leveled spells
    distance_feet: float
    # Auto-apply damage/healing
    auto_apply: bool = True
    # DM-granted advantage/disadvantage
    roll_modifier: Optional[str] = None  # 'advantage' | 'disadvantage' | None
    # Use warlock pact slot instead of regular slot
    use_pact_slot: bool = False
    # Channel Divinity: Destructive Wrath (maximize lightning/thunder damage)
    maximize_damage: bool = False


class SpellCastResult(BaseModel):
    """Result of spell casting"""
    # Basic result
    hit: Optional[bool] = None  # None for auto-hit spells
    critical: bool = False
    fumble: bool = False
    save_succeeded: Optional[bool] = None  # For save-based spells
    # Rolls
    attack_roll: Optional[DiceRoll] = None
    save_roll: Optional[DiceRoll] = None
    damage_roll: Optional[DiceRoll] = None
    extra_damage_roll: Optional[DiceRoll] = None  # Runtime extra damage like Hex
    healing_roll: Optional[DiceRoll] = None
    # Secondary save for control effects on attack spells (e.g., Ray of Sickness)
    control_save_roll: Optional[DiceRoll] = None
    control_save_succeeded: Optional[bool] = None
    # Calculated values
    spell_attack_bonus: Optional[int] = None
    spell_save_dc: Optional[int] = None
    save_modifier: Optional[int] = None
    # Damage/healing
    damage_dealt: int = 0
    damage_type: Optional[str] = None
    damage_type_cn: Optional[str] = None
    extra_damage_dealt: int = 0
    extra_damage_type: Optional[str] = None
    healing_done: int = 0
    # Resistance handling
    resistance_applied: bool = False
    immunity_applied: bool = False
    damage_before_resistance: Optional[int] = None
    # HP changes
    hp_change: Optional[int] = None
    new_hp: Optional[int] = None
    target_defeated: bool = False
    # Slot consumption
    slot_consumed: int = 0  # 0 for cantrips
    # Narrative
    narrative: str
    # Metadata
    caster_name: str
    target_name: str
    spell_name: str


class SpellCastResponse(BaseModel):
    """API response for spell casting"""
    success: bool
    result: Optional[SpellCastResult] = None
    error: Optional[str] = None


# ============== Area Spell Casting Schemas ==============

class AreaSpellCastRequest(BaseModel):
    """Request to cast an area spell (e.g., Fireball, Shatter)"""
    campaign_id: int
    caster: CasterData
    targets: List[SpellTargetData]  # Multiple targets in the area
    spell: SpellData
    slot_level: int
    center_position: Dict[str, float]  # { x: gridX, y: gridY }
    auto_apply: bool = True
    use_pact_slot: bool = False
    maximize_damage: bool = False
    # Area shape info for persistent effects
    shape_type: Optional[str] = "sphere"  # sphere, cone, line, cube, cylinder
    origin_position: Optional[Dict[str, float]] = None  # For cone/line: { x: gridX, y: gridY }
    direction: Optional[float] = None  # For cone/line: angle in degrees
    map_url: Optional[str] = None  # Map URL where the spell is cast


class AreaSpellTargetResult(BaseModel):
    """Result for a single target in area spell"""
    target_name: str
    target_token_id: int
    # Saving throw
    save_roll: DiceRoll
    save_modifier: int
    save_total: int
    save_succeeded: bool
    # Damage
    damage_dealt: int
    damage_before_modifiers: int
    resistance_applied: bool = False
    immunity_applied: bool = False
    # HP changes
    hp_change: Optional[int] = None
    new_hp: Optional[int] = None
    target_defeated: bool = False


class AreaSpellCastResult(BaseModel):
    """Result of area spell casting"""
    # Summary
    total_targets: int
    successful_saves: int
    failed_saves: int
    total_damage: int
    # Individual results
    target_results: List[AreaSpellTargetResult]
    hp_updates: List[Dict[str, Any]]  # [{token_id, new_hp, hp_change}]
    # Rolls
    damage_roll: Optional[DiceRoll] = None  # None for control spells
    spell_save_dc: int
    # Metadata
    caster_name: str
    spell_name: str
    damage_type: Optional[str] = None
    damage_type_cn: Optional[str] = None
    save_type: Optional[str] = None
    save_type_cn: Optional[str] = None
    # Control spell flag
    is_control_spell: bool = False
    # Narrative
    narrative: str


class AreaSpellCastResponse(BaseModel):
    """API response for area spell casting"""
    success: bool
    results: Optional[AreaSpellCastResult] = None
    error: Optional[str] = None


# ============== Reaction Schemas ==============

class ReactionRequest(BaseModel):
    """Request to use a reaction"""
    campaign_id: int
    reactor_token_id: int       # Token using the reaction
    reactor_character_id: Optional[int] = None
    target_token_id: Optional[int] = None  # Target of reaction attack, or attacker who triggered
    reaction_id: str            # e.g., "uncanny_dodge", "shield_spell", "opportunity_attack"
    category: str               # "attack" | "defense" | "spell"
    # For defense reactions: the original attack message to modify
    original_chat_message_id: Optional[int] = None
    # For spell reactions that consume a slot
    spell_slot_level: Optional[int] = None
    # Reactor info
    reactor_name: str = ""
    reactor_level: int = 1
    reactor_class_id: Optional[str] = None
    reactor_subclass_id: Optional[str] = None
    reactor_ability_scores: Optional[AbilityScores] = None
    reactor_proficiency_bonus: int = 2
    # For attack reactions: attack info
    attack: Optional[AttackOption] = None
    attacker_data: Optional[AttackerData] = None
    target_data: Optional[TargetData] = None
    distance_feet: Optional[float] = None


class ReactionResult(BaseModel):
    """Result of a reaction"""
    reaction_id: str
    reaction_name: str
    reactor_name: str
    # For defense: damage reduction
    damage_reduced: int = 0
    original_damage: int = 0
    new_damage: int = 0
    ac_bonus: int = 0
    attack_now_misses: bool = False
    hp_restored: int = 0
    new_hp: Optional[int] = None
    # For attack: attack result
    attack_result: Optional[AttackResult] = None
    # For counterspell: whether an in-progress cast on the target was interrupted
    countered: bool = False
    interrupted_spell_name: Optional[str] = None
    # Description
    description: str = ""


class ReactionResponse(BaseModel):
    """API response for reaction"""
    success: bool
    result: Optional[ReactionResult] = None
    error: Optional[str] = None
