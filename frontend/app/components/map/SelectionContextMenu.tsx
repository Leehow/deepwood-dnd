/**
 * SelectionContextMenu - Context-aware menu for RTS-style token selection
 * Actions shown are based on the SOURCE unit (selected token), not the target
 * - Source is player → show standard D&D actions
 * - Source is monster → show monster's actions from monster_data
 *
 * On touch devices, renders as a modal dialog for better usability
 */
import { useEffect, useRef, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { Token, StatusEffect } from "./types/TacticalMapTypes";
import { publishAppEvent } from "~/events/appEventBus";
import { showGlobalToast } from "../ui/Toast";
import { apiFetch } from "~/utils/api-client";
import equipmentRulesData from "~/data/rules/equipment.json";
import classesData from "~/data/rules/classes.json";
import spellsData from "~/data/rules/spells.json";
import racesData from "~/data/rules/races.json";
import { isProficientWithWeaponId } from "~/components/character/CharacterDisplay/utils/proficiency";
import { getConsumableData, getConsumableEffectPreview } from "~/components/character/CharacterDisplay/utils/consumableUtils";
import { parseTokenSize, getEdgeToEdgeDistance } from "./utils/mapCalculations";
import { parseRangeValue } from "./utils/rangeUtils";
import { getAvailableReactions, type ReactionDefinition } from "~/utils/reactionRegistry";
import { tWeaponProperty, tWeaponPropertyDesc } from "~/utils/i18n";
import { getAssetUrl } from "~/utils/asset-url";
import { isPointInObscuredZone, type ObscurementZone } from "./utils/obscurementUtils";
import { extractAllGrantedActions, executeGrantedAction, grantedActionToSpellOption, getActionTypeLabel, getActionSummary, actionNeedsTarget } from "~/utils/grantedActions";
import { getEffectiveMovementSpeed } from "~/components/character/CharacterDisplay/utils/speed";
import { TriggeredFeatureButtons } from "~/components/combat/TriggeredFeatureButtons";

// Spell slots state type - supports multiple formats from backend
type SpellSlotsState = Record<string, { current: number; max: number }> | number[] | { slots: number[]; pact_slots?: number[] };

// D&D 5E Standard Actions (for player characters)
// Primary actions shown by default
const PRIMARY_ACTIONS = [
  { key: 'attack', name: '攻击', nameEn: 'Attack', icon: '⚔️',
    description: '进行一次近战或远程攻击。你可以用武器或徒手攻击。攻击动作还包括特殊攻击如擒抱和推撞。',
    hasSubMenu: true },
  { key: 'cast_spell', name: '施法', nameEn: 'Cast a Spell', icon: '✨',
    description: '施放一个施法时间为1动作的法术。你必须遵守法术的所有规则，包括法术位消耗和专注要求。' },
  { key: 'dodge', name: '回避', nameEn: 'Dodge', icon: '🛡️',
    description: '直到你下回合开始前，任何你能看到的攻击者对你的攻击检定具有劣势，且你的敏捷豁免具有优势。如果你失能或速度降为0则失去此效果。' },
];

// D&D 5E Attack Options (sub-menu for Attack action)
export interface AttackOption {
  key: string;
  name: string;
  nameEn: string;
  icon: string;
  description: string;
  // For weapon attacks
  weaponName?: string;
  damage?: string;
  damageType?: string;
  properties?: string[];
  range?: string;
  // Numeric range for distance calculation (in feet)
  normalRange?: number;  // Normal range (no penalty)
  maxRange?: number;     // Max range (with disadvantage beyond normal)
  // Ammunition tracking
  needsAmmo?: boolean;   // Whether weapon requires ammunition
  ammoCount?: number;    // Number of ammo available (undefined if doesn't need ammo)
  ammoName?: string;     // Name of the ammo type (e.g., "箭矢")
  // Attack bonus info
  attackBonus?: number;  // Total attack bonus (ability mod + proficiency if proficient)
  abilityName?: string;  // Which ability is used ("力量" or "敏捷")
  abilityMod?: number;   // The ability modifier
  profBonus?: number;    // Proficiency bonus
  // Weapon proficiency - D&D 5E: if not proficient, don't add proficiency bonus to attack
  weaponProficient?: boolean;
  // Whether this is a ranged weapon attack (for auto-disadvantage rules)
  isRanged?: boolean;
  // For special attacks
  isSpecial?: boolean;
  // Two-weapon fighting
  isBonusAction?: boolean;   // Marks this as a bonus action attack (off-hand)
  damageNote?: string;       // e.g., "不含属性调整值"
  // Thrown weapon attack
  isThrown?: boolean;           // This is a thrown weapon attack
  isImprovisedThrow?: boolean;  // No thrown property → improvised weapon (1d4, no proficiency)
  thrownWeaponItem?: {          // Weapon info for post-throw drop
    id: string;
    name: string;
    equippedSlot: string;
    iconPath?: string;
    weight?: number;
  };
  // Magic weapon properties
  magicBonus?: number;           // Magic weapon bonus (+1, +2, +3)
  extraDamage?: { dice: string; type: string };  // Extra damage (e.g., 1d4 radiant)
  // Class-feature backed bonus attacks (e.g. War Priest)
  resourceId?: string;
  featureActionId?: string;
  featureActionName?: string;
  featureUsesLabel?: string;
}

// Spell option for casting spells
export interface SpellOption {
  id: string;
  name: string;
  nameEn?: string;
  level: number;  // 0 = cantrip
  school?: string;
  // Damage info
  damage?: string;
  damageType?: string;
  damageTypeCn?: string;
  damageAtCharacterLevel?: Record<string, string>;
  damageAtSlotLevel?: Record<string, string>;
  // Healing info
  healing?: string;
  healingAtSlotLevel?: Record<string, string>;
  // Attack/save type
  attackType?: 'melee_spell' | 'ranged_spell' | 'save' | 'auto';
  saveType?: string;
  saveTypeCn?: string;
  saveEffect?: 'half' | 'none' | 'partial';
  // Range
  range?: string;
  // Calculated values (set by useMemo)
  spellAttackBonus?: number;
  spellSaveDC?: number;
  // Casting time (for action economy deduction)
  castingTime?: string;
  // Area of effect (for filtering)
  areaOfEffect?: { type?: string; size?: number };
  // Icon
  iconPath?: string;
}

// Damage type translations
const DAMAGE_TYPE_CN: Record<string, string> = {
  'piercing': '穿刺',
  'slashing': '挥砍',
  'bludgeoning': '钝击',
  'fire': '火焰',
  'cold': '冰冷',
  'lightning': '闪电',
  'thunder': '雷鸣',
  'poison': '毒素',
  'acid': '强酸',
  'necrotic': '黯蚀',
  'radiant': '光耀',
  'force': '力场',
  'psychic': '心灵',
};

// Built-in special attack options (always available)
const SPECIAL_ATTACK_OPTIONS: AttackOption[] = [
  { key: 'unarmed', name: '徒手打击', nameEn: 'Unarmed Strike', icon: '👊',
    description: '用拳头、脚或其他身体部位进行近战攻击。造成1+力量调整值的钝击伤害。',
    damage: '1+力量', damageType: '钝击', range: '5尺', normalRange: 5, maxRange: 5, isSpecial: true },
  { key: 'grapple', name: '擒抱', nameEn: 'Grapple', icon: '🤼',
    description: '尝试擒抱目标（需要一只空手）。你的力量(运动)检定对抗目标的力量(运动)或敏捷(杂技)。成功则目标获得擒抱状态，速度变为0。',
    range: '5尺', normalRange: 5, maxRange: 5, isSpecial: true },
  { key: 'shove', name: '推撞', nameEn: 'Shove', icon: '🫸',
    description: '尝试推开或击倒目标。你的力量(运动)检定对抗目标的力量(运动)或敏捷(杂技)。成功可选择推开5尺或击倒。',
    range: '5尺', normalRange: 5, maxRange: 5, isSpecial: true },
];

// Other actions collapsed by default
const OTHER_ACTIONS = [
  { key: 'dash', name: '疾走', nameEn: 'Dash', icon: '💨',
    description: '本回合额外获得等同于你速度的移动力（计算任何加值后）。例如，速度30尺的角色使用疾走后本回合可移动60尺。' },
  { key: 'disengage', name: '撤离', nameEn: 'Disengage', icon: '🏃',
    description: '你的移动在本回合内不会引发借机攻击。' },
  { key: 'help', name: '协助', nameEn: 'Help', icon: '🤝',
    description: '协助一个生物完成任务，该生物在下次进行相关属性检定时获得优势（本回合内）。或者，协助攻击5尺内的目标，下个攻击该目标的盟友获得优势。' },
  { key: 'hide', name: '躲藏', nameEn: 'Hide', icon: '👤',
    description: '进行敏捷（隐匿）检定尝试躲藏。成功后，你获得"未被察觉"状态，直到被发现或停止躲藏。' },
  { key: 'ready', name: '预备', nameEn: 'Ready', icon: '⏳',
    description: '准备一个动作，当特定触发条件发生时作为反应执行。你必须指定触发条件和要执行的动作。预备法术需维持专注直到触发。' },
  { key: 'search', name: '搜索', nameEn: 'Search', icon: '🔍',
    description: '进行感知（察觉）或智力（调查）检定来寻找隐藏的事物。' },
  { key: 'use_object', name: '使用物件', nameEn: 'Use an Object', icon: '📦',
    description: '使用一件需要动作来激活的物品，或与环境中的物体互动（如拉杆、开门）。部分简单互动可作为移动或动作的一部分免费进行。' },
  { key: 'improvise', name: '即兴动作', nameEn: 'Improvised', icon: '🎭',
    description: '执行任何不在标准动作列表中的创意行动。DM将决定是否可行、如何解决以及是否需要检定。' },
];

// Combined for backward compatibility
const STANDARD_ACTIONS = [...PRIMARY_ACTIONS, ...OTHER_ACTIONS];

export interface MonsterAction {
  name: string;
  description: string;
  type: 'action' | 'legendaryAction' | 'reaction';
  cost?: number;
  attack_bonus?: number;
  attack_type?: string;  // melee/ranged/melee_or_ranged
  reach?: string;
  range?: string;
  damage?: {
    dice?: string;
    bonus?: number;
    average?: number;
    type?: string;
  };
  extra_damage?: {
    dice?: string;
    type?: string;
  };
  save?: {
    ability?: string;
    dc?: number;
    success_effect?: string;
    fail_effect?: string;
  };
  area?: {
    shape?: string;
    size?: string;
  };
}

// Character equipment item (for weapon extraction)
export interface CharacterEquipmentItem {
  id: string;
  name: string;
  quantity?: number;
  equippedSlot?: 'main_hand' | 'off_hand' | 'armor';
  equipmentType?: 'weapon' | 'armor' | 'gear' | 'tool' | string;
  category?: string;  // Alternative to equipmentType (e.g., 'weapon')
  damage?: string | { dice: string; type?: string };
  damageType?: string;
  properties?: string[];
  range?: string | { normal: number; long?: number };
  gripMode?: 'one-hand' | 'two-hand';
  description?: string;
}

// Character action from class features (bonus actions, reactions, etc.)
export interface CharacterClassAction {
  id: string;
  name: string;
  nameEn?: string;
  action_type: 'action' | 'bonus_action' | 'reaction' | 'free';
  description: string;
  source?: string;
  resourceId?: string;
  execution?: Record<string, any>;
  passive_feature_id?: string;
  uses?: {
    current: number;
    max: number;
    recharge: 'short_rest' | 'long_rest';
  };
}

// Simplified character data for attack options
export interface SourceCharacterData {
  id: number;
  name: string;
  equipment?: CharacterEquipmentItem[];
  ability_scores?: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  level?: number;
  race_id?: string;
  subrace_id?: string;
  class_id?: string;
  subclass_id?: string;
  actions?: CharacterClassAction[];  // Class feature actions (bonus actions, reactions, etc.)
  // Battle Master specific
  maneuvers_known?: string[];  // Array of maneuver IDs
  maneuvers_data?: {
    superiority_dice: {
      current: number;
      max: number;
      die: string;
    };
    maneuvers_known: string[];
  };
  // Ranger specific
  favored_enemy?: string | { value: string };  // e.g., "aberrations", "undead"
  favored_humanoid_races?: string[];  // When favored_enemy is "humanoids"
  favored_terrain?: string | { value: string };  // e.g., "forest", "mountain"
  // Spell casting
  selected_cantrips?: string[];
  prepared_spells?: string[];
  spell_slots_state?: SpellSlotsState;
  spellcasting_ability?: string;  // 'intelligence', 'wisdom', 'charisma'
  proficient_skills?: string[];
  proficient_tools?: string[];
  // Combat style & feats
  fighting_style?: string | { value: string };
  feats?: Array<string | { value: string }>;
  // Movement
  speed?: number;  // Character's base movement speed in feet
  fly_speed?: number;  // Character's passive flying speed in feet
  // Class resource pools (e.g., lay_on_hands)
  class_feature_uses?: Record<string, { current: number; max: number }>;
  // Status effects (for condition checks like incapacitated)
  status_effects?: { active_conditions?: Array<{ condition: string }> };
}

// Maneuver definition (from classes.json)
export interface Maneuver {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  cost: number;
  timing: string;  // "attack_action", "attack_hit", "reaction", etc.
  effect: string;
  save?: string;  // "strength" | "wisdom" etc. from classes.json
}

interface SelectionContextMenuProps {
  x: number;
  y: number;
  sourceToken: Token;
  targetToken: Token | null;
  targetGridPos: { x: number; y: number } | null;
  sourceMonsterData?: any;  // Monster data for SOURCE token (if source is monster)
  sourceCharacterData?: SourceCharacterData;  // Character data for SOURCE token (if source is player)
  sourceActiveEffects?: StatusEffect[];  // Active effects on source token (for duration display)
  targetActiveEffects?: StatusEffect[];  // Active effects on target token (for wake up)
  pendingManeuver?: { maneuver: Maneuver; targetTokenId?: number } | null;  // Battle Master pending maneuver
  targetChestData?: { is_locked: boolean; lock_dc: number; state: string; is_trapped?: boolean; trap_detected?: boolean } | null;  // Chest data for target chest token
  gridUnitLength?: number;  // Grid unit length in feet (default 5)
  isDM?: boolean;  // Whether user is DM (affects edit/delete visibility)
  globalTerrain?: string | null;
  reactionOnlyMode?: boolean;  // Off-turn manual reaction mode: only show reaction-capable options
  companionTokens?: Token[];  // 当前玩家控制的伙伴/召唤物 token
  companionMonsterDataMap?: Record<number, any>;  // monster_instance_id -> monster_data
  // Advantage/Disadvantage modifier for next roll
  rollModifier?: 'advantage' | 'disadvantage' | null;
  onSetRollModifier?: (tokenId: number, modifier: 'advantage' | 'disadvantage' | null) => void;
  onClose: () => void;
  onDeselect: () => void;  // Deselect the current token
  onViewDetails: (tokenId: number) => void;
  onEditToken: (tokenId: number) => void;
  onDeleteToken: (tokenId: number) => void;
  onMoveTo: (gridX: number, gridY: number, sourceTokenId: number) => void;
  onStandardAction: (actionKey: string, sourceTokenId: number, targetTokenId?: number) => void;
  onMonsterAction: (action: MonsterAction, sourceTokenId: number, targetTokenId?: number) => void;
  onAttackAction?: (attack: AttackOption, sourceTokenId: number, targetTokenId?: number, inspirationDie?: string | null) => void;
  onBonusAction?: (action: CharacterClassAction, sourceTokenId: number, targetTokenId?: number) => void;
  onManeuverAction?: (maneuver: Maneuver, sourceTokenId: number, targetTokenId?: number) => void;  // Battle Master maneuvers
  onCancelManeuver?: (sourceTokenId: number) => void;  // Cancel pending maneuver
  onEditEffectDuration?: (sourceTokenId: number, effectId: string, newDuration: number) => void;
  onEditActionUses?: (characterId: number, actionId: string, newUses: number, maxUses: number) => void;
  onPickupItem?: (characterId: number, itemTokenId: number) => void;  // Pick up an item token
  onRangerAbility?: (abilityType: 'favored_enemy' | 'natural_explorer', sourceTokenId: number, isActivating: boolean) => void;  // Ranger buff toggle
  onSpellAction?: (spell: SpellOption, sourceTokenId: number, targetTokenId?: number, slotLevel?: number) => void;  // Cast a spell
  onAreaSpellSelect?: (spell: SpellOption, sourceTokenId: number, slotLevel: number) => void;  // Select area spell (enters targeting mode)
  onWildShape?: (sourceTokenId: number) => void;  // Druid wild shape - opens beast selection modal
  onEndWildShape?: (sourceTokenId: number) => void;  // End wild shape transformation
  onTransform?: (tokenId: number, configId: string) => void;  // Universal transformation
  onEndTransformation?: (tokenId: number) => void;  // End any transformation
  // Control effect escape/save callbacks
  onEscapeAttempt?: (tokenId: number, effectId: string) => void;
  onOngoingSave?: (tokenId: number, effectId: string) => void;
  onWakeUp?: (tokenId: number, effectId: string) => void;
  onUseConsumable?: (item: any, sourceTokenId: number) => void;
  onTrade?: (sourceCharacterId: number, targetToken: Token) => void;  // Player-to-player trade
  onLayOnHands?: (sourceCharacterId: number, targetToken: Token, distanceFeet: number, poolCurrent: number, poolMax: number) => void;
  onOpenToolCheck?: (request: {
    characterId: number;
    characterName?: string;
    title?: string;
    toolId?: string;
    toolLocked?: boolean;
    ability?: "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma";
    abilityLocked?: boolean;
    dc?: number;
    dcLocked?: boolean;
    description?: string;
    confirmLabel?: string;
    context?: Record<string, any>;
  }) => void;
  onReactionAttack?: (data: {
    reactionId: string;
    sourceTokenId: number;
    targetTokenId: number;
    sourceCharData: SourceCharacterData;
    attackOption: AttackOption | null;
    targetName: string;
    targetAC: number;
    distanceFeet: number;
  }) => void;
  onConditionSave?: (tokenId: number, effectId: string) => void;
  obscurementZones?: import("./utils/obscurementUtils").ObscurementZone[];
  onBlindAttack?: (attack: AttackOption, sourceTokenId: number, gridX: number, gridY: number) => void;
}

export function SelectionContextMenu({
  x, y, sourceToken, targetToken, targetGridPos, sourceMonsterData, sourceCharacterData, sourceActiveEffects, targetActiveEffects, pendingManeuver, targetChestData, gridUnitLength = 5, isDM = false,
  globalTerrain,
  reactionOnlyMode = false,
  companionTokens = [], companionMonsterDataMap = {},
  rollModifier, onSetRollModifier,
  onClose, onDeselect, onViewDetails, onEditToken, onDeleteToken, onMoveTo,
  onStandardAction, onMonsterAction, onAttackAction, onBonusAction, onManeuverAction, onCancelManeuver, onEditEffectDuration, onEditActionUses, onPickupItem, onRangerAbility, onSpellAction, onAreaSpellSelect,
  onWildShape, onEndWildShape,
  onTransform, onEndTransformation,
  onEscapeAttempt, onOngoingSave, onWakeUp,
  onUseConsumable,
  onTrade,
  onLayOnHands,
  onOpenToolCheck,
  onReactionAttack,
  obscurementZones,
  onBlindAttack,
}: SelectionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const activeTransformationConfigId = sourceToken.transformation_data?.source?.config_id
    || sourceToken.transformation_data?.source?.spell_id
    || null;
  const shouldHideLegacyTransformationMagic = activeTransformationConfigId === "enlarge-reduce";

  // Detect touch device for modal rendering
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  // Delay allowing close to prevent ghost clicks from closing the modal
  const [allowClose, setAllowClose] = useState(false);
  useEffect(() => {
    if (isTouchDevice) {
      setAllowClose(false);
      const timer = setTimeout(() => setAllowClose(true), 400);
      return () => clearTimeout(timer);
    }
  }, [isTouchDevice]);

  // Determine SOURCE type (what kind of unit is selected)
  const sourceType = useMemo(() => {
    if (sourceToken.character_id) return 'player';
    if (sourceToken.monster_instance_id) return 'monster';
    if (sourceToken.item_data) return 'item';
    return 'unknown';
  }, [sourceToken]);

  // Check if source is incapacitated (can't take actions or reactions)
  const isSourceIncapacitated = useMemo(() => {
    const INCAPACITATING = ['incapacitated', 'stunned', 'paralyzed', 'unconscious', 'petrified'];
    // Player character: check status_effects from character data
    if (sourceCharacterData?.status_effects?.active_conditions) {
      return sourceCharacterData.status_effects.active_conditions.some(
        (c: any) => INCAPACITATING.includes(c.condition || c)
      );
    }
    // Monster: check sourceToken.active_effects for incapacitated modifier
    if (sourceToken.active_effects) {
      return (sourceToken.active_effects as any[]).some((e: any) => {
        const cond = e.condition || e.id || '';
        return INCAPACITATING.includes(cond);
      });
    }
    return false;
  }, [sourceCharacterData, sourceToken.active_effects]);

  // Determine menu context (what are we right-clicking on)
  const menuContext = useMemo(() => {
    if (targetToken?.id === sourceToken.id) return 'self';
    if (targetToken) return 'target';
    if (targetGridPos) return 'ground';
    return 'self';
  }, [sourceToken, targetToken, targetGridPos]);

  // Calculate distance from source token to target (grid or token)
  // Uses edge-to-edge measurement for multi-cell tokens (D&D 5E rules)
  const distanceInfo = useMemo(() => {
    let targetX: number, targetY: number;
    let targetW = 1, targetH = 1;
    if (targetGridPos) {
      targetX = targetGridPos.x;
      targetY = targetGridPos.y;
    } else if (targetToken) {
      targetX = targetToken.position_x;
      targetY = targetToken.position_y;
      const tSize = parseTokenSize(targetToken.token_size);
      targetW = tSize.width;
      targetH = tSize.height;
    } else {
      return null;
    }
    const sSize = parseTokenSize(sourceToken.token_size);
    const gridDistance = getEdgeToEdgeDistance(
      sourceToken.position_x, sourceToken.position_y, sSize.width, sSize.height,
      targetX, targetY, targetW, targetH,
    );
    const feetDistance = gridDistance * gridUnitLength;
    return { grids: gridDistance, feet: Math.round(feetDistance * 10) / 10 };
  }, [sourceToken, targetToken, targetGridPos, gridUnitLength]);

  // Calculate movement speed - use wild shape speed if transformed, otherwise character/monster speed
  const movementSpeed = useMemo(() => {
    // Wild shape / transformation: prefer the best mobility mode currently available
    if (sourceToken.transformation_data?.speed) {
      const speed = sourceToken.transformation_data.speed;
      return Math.max(speed.walk || 0, speed.fly || 0, 30);
    }
    // Monster: use monster's speed from monster data
    if (sourceType === 'monster' && sourceMonsterData?.speed) {
      // Parse speed string like "30 ft." or {walk: 30, fly: 60}
      if (typeof sourceMonsterData.speed === 'object') {
        return sourceMonsterData.speed.walk || 30;
      }
      const match = String(sourceMonsterData.speed).match(/(\d+)/);
      return match ? parseInt(match[1], 10) : 30;
    }
    // Character: use character's speed (calculated from race + bonuses)
    if (sourceCharacterData) {
      return getEffectiveMovementSpeed(sourceCharacterData, globalTerrain);
    }
    // Default fallback
    return 30;
  }, [sourceToken, sourceType, sourceMonsterData, sourceCharacterData, globalTerrain]);

  // Compute Battle Master maneuver save DC: 8 + proficiency + max(STR mod, DEX mod)
  const maneuverDC = useMemo(() => {
    if (!sourceCharacterData?.ability_scores || !sourceCharacterData?.maneuvers_data) return undefined;
    const { strength, dexterity } = sourceCharacterData.ability_scores;
    const strMod = Math.floor((strength - 10) / 2);
    const dexMod = Math.floor((dexterity - 10) / 2);
    const lvl = sourceCharacterData.level || 1;
    const profBonus = lvl < 5 ? 2 : lvl < 9 ? 3 : lvl < 13 ? 4 : lvl < 17 ? 5 : 6;
    return 8 + profBonus + Math.max(strMod, dexMod);
  }, [sourceCharacterData]);

  // Extract monster actions from SOURCE token (if source is monster)
  const sourceMonsterActions = useMemo(() => {
    if (sourceType !== 'monster' || !sourceMonsterData) return [];
    const actions: MonsterAction[] = [];

    (sourceMonsterData.actions || []).forEach((a: any) => {
      if (a.name) {
        actions.push({
          name: a.name,
          description: a.description || '',
          type: 'action',
          attack_bonus: a.attack_bonus,
          attack_type: a.attack_type,
          reach: a.reach,
          range: a.range,
          damage: a.damage,
          extra_damage: a.extra_damage,
          save: a.save,
          area: a.area,
        });
      }
    });
    (sourceMonsterData.legendaryActions || []).forEach((a: any) => {
      if (a.name) {
        actions.push({
          name: a.name,
          description: a.description || '',
          type: 'legendaryAction',
          cost: a.cost || 1,
          attack_bonus: a.attack_bonus,
          attack_type: a.attack_type,
          reach: a.reach,
          range: a.range,
          damage: a.damage,
          extra_damage: a.extra_damage,
          save: a.save,
          area: a.area,
        });
      }
    });

    return actions;
  }, [sourceType, sourceMonsterData]);

  // Build attack options from character equipment (for player source)
  // When in Wild Shape, use beast actions instead
  const { attacks: attackOptions, bonusAttacks, thrownAttacks } = useMemo((): { attacks: AttackOption[], bonusAttacks: AttackOption[], thrownAttacks: AttackOption[] } => {
    if (sourceType !== 'player') return { attacks: [], bonusAttacks: [], thrownAttacks: [] };

    // Check for Wild Shape - use beast attacks instead of character weapons
    const wildShapeData = sourceToken.transformation_data;
    if (wildShapeData && wildShapeData.actions) {
      const beastOptions: AttackOption[] = [];
      const beastStrMod = wildShapeData.ability_scores?.strMod ?? 0;
      const beastDexMod = wildShapeData.ability_scores?.dexMod ?? 0;

      // Convert beast actions to AttackOption format
      wildShapeData.actions.forEach((action: any, idx: number) => {
        if (!action.name) return;

        // Determine if melee or ranged based on action name
        const isRanged = /ranged|远程|投掷|thrown/i.test(action.description || '');
        const abilityMod = isRanged ? beastDexMod : beastStrMod;
        const abilityName = isRanged ? '敏捷' : '力量';

        // Format damage from action.damage
        let damageStr = '';
        let damageType = '';
        if (action.damage) {
          damageStr = action.damage.dice || '';
          if (action.damage.bonus) {
            damageStr += action.damage.bonus >= 0 ? `+${action.damage.bonus}` : `${action.damage.bonus}`;
          }
          damageType = action.damage.type || '';
        }

        beastOptions.push({
          key: `beast_${idx}_${action.name}`,
          name: action.name,
          nameEn: action.name,
          icon: isRanged ? '🏹' : '🐾',
          description: action.description || `${wildShapeData.beast_name}的${action.name}攻击`,
          weaponName: action.name,
          damage: damageStr,
          damageType: damageType,
          range: isRanged ? '远程' : '5尺',
          normalRange: isRanged ? 20 : 5,
          maxRange: isRanged ? 60 : 5,
          attackBonus: action.attack_bonus ?? (abilityMod + 2),  // Use stored or calculate
          abilityName,
          abilityMod,
          profBonus: 2,  // Beasts use natural proficiency
          weaponProficient: true,  // Natural attacks are always "proficient"
        });
      });

      return { attacks: beastOptions, bonusAttacks: [], thrownAttacks: [] };
    }

    // Normal character weapon attacks follow...

    const options: AttackOption[] = [];
    const equipment = sourceCharacterData?.equipment || [];

    // Build weapon lookup from rules data
    const weaponLookup: Record<string, any> = {};
    const rules = equipmentRulesData as any;
    const addWeapons = (arr: any[], isMelee: boolean) => {
      (arr || []).forEach(w => {
        if (w.id) weaponLookup[w.id.toLowerCase()] = { ...w, _isMelee: isMelee };
      });
    };
    addWeapons(rules.weapons?.simple?.melee, true);
    addWeapons(rules.weapons?.simple?.ranged, false);
    addWeapons(rules.weapons?.martial?.melee, true);
    addWeapons(rules.weapons?.martial?.ranged, false);

    // Helper to format damage string
    const formatDamage = (dmg: string | { dice: string } | undefined): string => {
      if (!dmg) return '';
      if (typeof dmg === 'string') return dmg;
      return dmg.dice || '';
    };

    // Helper to translate damage type to Chinese
    const translateDamageType = (type: string | undefined): string => {
      if (!type) return '';
      return DAMAGE_TYPE_CN[type.toLowerCase()] || type;
    };

    // Helper to get weapon range info
    const getWeaponRangeInfo = (weaponData: any): { range: string; normalRange: number; maxRange: number } => {
      const hasReach = weaponData.properties?.some((p: string) =>
        p.toLowerCase() === 'reach' || p.includes('长柄')
      );

      // Ranged weapon with range object
      if (weaponData.range && typeof weaponData.range === 'object') {
        const normal = weaponData.range.normal || 0;
        const long = weaponData.range.long || normal;
        return {
          range: long > normal ? `${normal}/${long}尺` : `${normal}尺`,
          normalRange: normal,
          maxRange: long,
        };
      }

      // Ranged weapon without range object: use default ranged weapon range
      if (!weaponData._isMelee) {
        // Default ranged weapon range (80/320 similar to light crossbow)
        return { range: '80/320尺', normalRange: 80, maxRange: 320 };
      }

      // Melee weapon: use melee range (thrown range handled separately in thrownAttacks)
      const reach = hasReach ? 10 : 5;
      return {
        range: `${reach}尺`,
        normalRange: reach,
        maxRange: reach,
      };
    };

    // Helper to check if item is a weapon (by looking up in rules)
    const getWeaponData = (itemId: string): any | null => {
      return weaponLookup[itemId.toLowerCase()] || null;
    };

    // Helper to find ammunition in equipment
    // Maps weapon types to their ammo IDs
    const AMMO_MAP: Record<string, { ids: string[]; name: string }> = {
      'longbow': { ids: ['arrow', 'arrows'], name: '箭矢' },
      'shortbow': { ids: ['arrow', 'arrows'], name: '箭矢' },
      'light_crossbow': { ids: ['crossbow_bolt', 'crossbow_bolts', 'bolt', 'bolts'], name: '弩矢' },
      'heavy_crossbow': { ids: ['crossbow_bolt', 'crossbow_bolts', 'bolt', 'bolts'], name: '弩矢' },
      'hand_crossbow': { ids: ['crossbow_bolt', 'crossbow_bolts', 'bolt', 'bolts'], name: '弩矢' },
      'blowgun': { ids: ['blowgun_needle', 'blowgun_needles', 'needle', 'needles'], name: '吹箭针' },
      'sling': { ids: ['sling_bullet', 'sling_bullets', 'bullet', 'bullets'], name: '弹丸' },
    };

    const getAmmoInfo = (weaponId: string, itemProps?: string[]): { needsAmmo: boolean; ammoCount?: number; ammoName?: string } => {
      const weaponIdLower = weaponId.toLowerCase();
      const ammoConfig = AMMO_MAP[weaponIdLower];

      if (!ammoConfig) {
        // Check if weapon has ammunition property — look in both standard data and item's own properties
        const weaponData = getWeaponData(weaponId);
        const standardProps = weaponData?.properties;
        const propsToCheck = standardProps || itemProps;
        const hasAmmoProp = propsToCheck?.some((p: string) =>
          p.toLowerCase().includes('ammunition') || p.includes('弹药')
        );
        if (hasAmmoProp) {
          // Search equipment for any ammo-like item (equipped in ammo slot or generic ammo items)
          const ammoSlotItem = equipment.find((item: any) => item.equippedSlot === 'ammo');
          const genericAmmoItem = equipment.find((item: any) =>
            ['arrow', 'arrows', 'crossbow_bolt', 'crossbow_bolts', 'bolt', 'bolts', 'bullet', 'bullets', 'sling_bullet', 'sling_bullets'].includes(String(item.id ?? '').toLowerCase())
            || (item.category === 'ammunition' || item.equipmentType === 'ammunition')
          );
          const ammoItem = ammoSlotItem || genericAmmoItem;
          return {
            needsAmmo: true,
            ammoCount: ammoItem?.quantity || 0,
            ammoName: ammoItem?.name || '弹药',
          };
        }
        return { needsAmmo: false };
      }

      // Find ammo in equipment
      const ammoItem = equipment.find((item: any) =>
        ammoConfig.ids.includes(String(item.id ?? '').toLowerCase())
      );

      return {
        needsAmmo: true,
        ammoCount: ammoItem?.quantity || 0,
        ammoName: ammoConfig.name,
      };
    };

    // Helper to calculate ability modifier
    const calcAbilityMod = (score: number | undefined): number => {
      if (!score) return 0;
      return Math.floor((score - 10) / 2);
    };

    // Helper to get proficiency bonus based on level
    const getProfBonus = (level: number | undefined): number => {
      const lvl = level || 1;
      if (lvl < 5) return 2;
      if (lvl < 9) return 3;
      if (lvl < 13) return 4;
      if (lvl < 17) return 5;
      return 6;
    };

    // Get character stats
    const charLevel = sourceCharacterData?.level || 1;
    const profBonus = getProfBonus(charLevel);
    const strMod = calcAbilityMod(sourceCharacterData?.ability_scores?.strength);
    const dexMod = calcAbilityMod(sourceCharacterData?.ability_scores?.dexterity);

    // Helper to create weapon attack option
    const createWeaponOption = (weaponData: any, item: any, nameOverride?: string, keyOverride?: string): AttackOption => {
      const rangeInfo = getWeaponRangeInfo(weaponData);
      const isRanged = !weaponData._isMelee || weaponData.properties?.some((p: string) =>
        p.toLowerCase().includes('ammunition') || p.includes('弹药')
      );
      const hasFinesse = weaponData.properties?.some((p: string) =>
        p.toLowerCase().includes('finesse') || p.includes('灵巧')
      );
      const ammoInfo = getAmmoInfo(item.id, item.properties);

      // Check weapon proficiency - D&D 5E: if not proficient, don't add proficiency bonus
      const weaponProficient = isProficientWithWeaponId(item.id, sourceCharacterData);

      // Determine which ability to use
      let abilityName: string;
      let abilityMod: number;
      if (isRanged) {
        abilityName = '敏捷';
        abilityMod = dexMod;
      } else if (hasFinesse) {
        // Finesse: use the higher of STR or DEX
        if (dexMod >= strMod) {
          abilityName = '敏捷';
          abilityMod = dexMod;
        } else {
          abilityName = '力量';
          abilityMod = strMod;
        }
      } else {
        abilityName = '力量';
        abilityMod = strMod;
      }

      // Only add proficiency bonus if proficient
      const magicBonus = item.magic_bonus || 0;
      const attackBonus = (weaponProficient ? abilityMod + profBonus : abilityMod) + magicBonus;

      const sign = abilityMod >= 0 ? '+' : '';

      return {
        key: keyOverride || `weapon_${item.id}`,
        name: nameOverride || weaponData.name || item.name,
        nameEn: item.id,
        icon: isRanged ? '🏹' : '⚔️',
        description: `使用${weaponData.name || item.name}进行攻击`,
        weaponName: weaponData.name || item.name,
        damage: (item.gripMode === 'two-hand' && weaponData.versatileDamage)
          ? weaponData.versatileDamage
          : formatDamage(weaponData.damage),
        damageNote: `${sign}${abilityMod}${abilityName}${magicBonus ? `+${magicBonus}魔法` : ''}`,
        damageType: translateDamageType(weaponData.damageType),
        properties: weaponData.properties,
        range: rangeInfo.range,
        normalRange: rangeInfo.normalRange,
        maxRange: rangeInfo.maxRange,
        needsAmmo: ammoInfo.needsAmmo,
        ammoCount: ammoInfo.ammoCount,
        ammoName: ammoInfo.ammoName,
        attackBonus,
        abilityName,
        abilityMod,
        profBonus: weaponProficient ? profBonus : 0,  // Only show proficiency if proficient
        weaponProficient,
        isRanged,
        magicBonus: magicBonus || undefined,
        extraDamage: item.extra_damage || undefined,
      };
    };

    const bonusAttacks: AttackOption[] = [];
    const warPriestAction = sourceCharacterData?.actions?.find(action =>
      action.id === 'passive_war_priest'
      || action.passive_feature_id === 'war_priest'
      || action.name === '战争祭司'
      || action.name === 'War Priest'
    );
    const combatIsActive = typeof window !== 'undefined' ? Boolean((window as any).__combatIsActive) : false;
    const attacksUsedThisTurn = typeof window !== 'undefined' ? Number((window as any).__combatAttacksUsed ?? 0) : 0;
    const warPriestReady = Boolean(
      warPriestAction
      && (warPriestAction.uses?.current ?? 0) > 0
      && (!combatIsActive || attacksUsedThisTurn > 0)
    );

    // Get equipped items
    const mainHandItem = equipment.find((item: any) => item.equippedSlot === 'main_hand');
    const offHandItem = equipment.find((item: any) => item.equippedSlot === 'off_hand');

    // Add main hand weapon (if equipped and is a weapon)
    if (mainHandItem) {
      let weaponData = getWeaponData(mainHandItem.id);
      // Fallback for custom weapons: build weaponData from item fields
      if (!weaponData && mainHandItem.damage) {
        const dmg = mainHandItem.damage;
        const props: string[] = mainHandItem.properties || [];
        const hasRangedProp = props.some((p: string) =>
          p.toLowerCase() === 'ammunition' || p.toLowerCase() === 'range' || p === '弹药' || p === '射程'
        );
        const hasRangeObj = mainHandItem.range && typeof mainHandItem.range === 'object' && mainHandItem.range.normal > 10;
        weaponData = {
          name: mainHandItem.name,
          damage: typeof dmg === 'object' && dmg.dice ? dmg.dice : dmg,
          damageType: (typeof dmg === 'object' ? dmg.type : null) || mainHandItem.damageType,
          properties: props,
          range: mainHandItem.range,
          description: mainHandItem.description,
          _isMelee: !hasRangedProp && !hasRangeObj,
        };
      }
      if (weaponData && weaponData.damage) {
        const gripLabel = mainHandItem.gripMode === 'two-hand' ? '主武器攻击(双手)' : '主武器攻击';
        options.push(createWeaponOption(weaponData, mainHandItem, gripLabel, `weapon_${mainHandItem.id}_main`));
        if (warPriestReady) {
          const warPriestOption = createWeaponOption(
            weaponData,
            mainHandItem,
            '战争祭司攻击',
            `war_priest_${mainHandItem.id}`
          );
          warPriestOption.isBonusAction = true;
          warPriestOption.description = '战争祭司：在本回合使用攻击动作后，用附赠动作再进行一次武器攻击。';
          warPriestOption.resourceId = warPriestAction?.resourceId || 'war_priest';
          warPriestOption.featureActionId = warPriestAction?.id;
          warPriestOption.featureActionName = warPriestAction?.name;
          warPriestOption.featureUsesLabel = warPriestAction?.uses
            ? `${warPriestAction.uses.current}/${warPriestAction.uses.max}`
            : undefined;
          bonusAttacks.push(warPriestOption);
        }
      }
    }

    // Two-Weapon Fighting: off-hand attack as bonus action
    // D&D 5E rules:
    // - Both weapons must be light melee, OR character has Dual Wielder feat
    // - Off-hand damage does NOT add ability modifier, unless character has Two-Weapon Fighting style

    const hasFightingStyle = (id: string): boolean => {
      const fs = sourceCharacterData?.fighting_style;
      if (!fs) return false;
      const val = typeof fs === 'string' ? fs : (fs as any)?.value;
      return val === id;
    };

    const hasFeat = (id: string): boolean => {
      const feats = sourceCharacterData?.feats;
      if (!feats || !Array.isArray(feats)) return false;
      return feats.some(f => (typeof f === 'string' ? f : (f as any)?.value) === id);
    };

    const isLightWeapon = (weaponData: any): boolean => {
      return weaponData?.properties?.some((p: string) =>
        p.toLowerCase() === 'light' || p === '轻型'
      ) ?? false;
    };

    if (mainHandItem && offHandItem) {
      const mainWeaponData = getWeaponData(mainHandItem.id);
      const offWeaponData = getWeaponData(offHandItem.id);

      // Off-hand must be a melee weapon with damage, main hand must also be melee
      if (mainWeaponData?.damage && mainWeaponData._isMelee && offWeaponData?.damage && offWeaponData._isMelee) {
        const hasDualWielder = hasFeat('dual_wielder');
        const bothLight = isLightWeapon(mainWeaponData) && isLightWeapon(offWeaponData);

        // Dual Wielder feat removes light requirement; otherwise both must be light
        if (bothLight || hasDualWielder) {
          const hasTWFStyle = hasFightingStyle('two_weapon_fighting') || hasFightingStyle('two_weapon');
          const offOption = createWeaponOption(offWeaponData, offHandItem, '副手攻击(附赠)', `weapon_${offHandItem.id}_off`);

          // Without TWF style, damage is dice only (no ability modifier)
          if (!hasTWFStyle) {
            const baseDmg = (offHandItem.gripMode === 'two-hand' && offWeaponData.versatileDamage)
              ? offWeaponData.versatileDamage
              : formatDamage(offWeaponData.damage);
            offOption.damage = baseDmg;
            offOption.damageNote = '不含属性调整值';
          } else {
            const mod = offOption.abilityMod ?? 0;
            const sign = mod >= 0 ? '+' : '';
            offOption.damageNote = `${sign}${mod}${offOption.abilityName || ''}`;
          }

          offOption.isBonusAction = true;
          bonusAttacks.push(offOption);
        }
      }
    }

    // Polearm Master: bonus action butt-end attack (1d4 bludgeoning)
    if (mainHandItem && hasFeat('polearm_master')) {
      const weaponData = getWeaponData(mainHandItem.id);
      const POLEARM_IDS = ['glaive', 'halberd', 'quarterstaff', 'pike', 'spear'];
      const isPolearm = POLEARM_IDS.some(w => mainHandItem.id?.toLowerCase().includes(w))
        || (weaponData?.name && ['关刀', '戟', '长棍', '长矛', '矛'].some((w: string) => weaponData.name.includes(w)));
      if (isPolearm && weaponData) {
        const sign = strMod >= 0 ? '+' : '';
        bonusAttacks.push({
          key: `polearm_butt_${mainHandItem.id}`,
          name: '枪尾打击(附赠)',
          nameEn: 'Polearm Butt End',
          icon: '🔱',
          description: '用长柄武器的尾端进行打击',
          weaponName: weaponData.name || mainHandItem.name,
          damage: `1d4${sign}${strMod}`,
          damageType: '钝击',
          properties: weaponData.properties,
          range: '5尺',
          normalRange: 5,
          maxRange: 5,
          attackBonus: strMod + profBonus,
          abilityName: '力量',
          abilityMod: strMod,
          profBonus: profBonus,
          weaponProficient: true,
          isBonusAction: true,
        });
      }
    }

    // Charger: bonus action melee attack after Dash (+5 damage)
    if (mainHandItem && hasFeat('charger') && (window as any).__combatDashedThisTurn) {
      const weaponData = getWeaponData(mainHandItem.id);
      if (weaponData?.damage && weaponData._isMelee) {
        const abilityMod = weaponData.properties?.some((p: string) =>
          p.toLowerCase() === 'finesse' || p === '灵巧'
        ) ? Math.max(strMod, dexMod) : strMod;
        const baseDmg = mainHandItem.gripMode === 'two-hand' && weaponData.versatileDamage
          ? weaponData.versatileDamage
          : formatDamage(weaponData.damage);
        bonusAttacks.push({
          key: `charger_${mainHandItem.id}`,
          name: '冲锋打击(附赠)',
          nameEn: 'Charger Strike',
          icon: '💨',
          description: '疾走后用附赠动作发动近战攻击，伤害+5',
          weaponName: weaponData.name || mainHandItem.name,
          damage: baseDmg,
          damageType: weaponData.damageType || '挥砍',
          properties: weaponData.properties,
          range: '5尺',
          normalRange: 5,
          maxRange: 5,
          attackBonus: abilityMod + profBonus,
          abilityName: abilityMod === strMod ? '力量' : '敏捷',
          abilityMod: abilityMod,
          profBonus: profBonus,
          weaponProficient: true,
          isBonusAction: true,
        });
      }
    }

    // Crossbow Expert: bonus action hand crossbow attack after one-handed weapon attack
    if (hasFeat('crossbow_expert')) {
      // Find hand crossbow in either hand
      const handXbow = [mainHandItem, offHandItem].find(
        (item: any) => item && item.id?.toLowerCase().includes('hand_crossbow')
      );
      if (handXbow) {
        const xbowData = getWeaponData(handXbow.id);
        if (xbowData) {
          const ammoInfo = getAmmoInfo(handXbow.id);
          const sign = dexMod >= 0 ? '+' : '';
          bonusAttacks.push({
            key: `crossbow_expert_${handXbow.id}`,
            name: '手弩射击(附赠)',
            nameEn: 'Crossbow Expert Shot',
            icon: '🏹',
            description: '使用手弩进行附赠动作攻击',
            weaponName: xbowData.name || handXbow.name,
            damage: `1d6${sign}${dexMod}`,
            damageType: '穿刺',
            properties: xbowData.properties,
            range: '30/120尺',
            normalRange: 30,
            maxRange: 120,
            needsAmmo: ammoInfo.needsAmmo,
            ammoCount: ammoInfo.ammoCount,
            attackBonus: dexMod + profBonus,
            abilityName: '敏捷',
            abilityMod: dexMod,
            profBonus: profBonus,
            weaponProficient: true,
            isBonusAction: true,
          });
        }
      }
    }

    // Only show equipped weapons - unequipped weapons in inventory cannot be used to attack
    // (Player would need to draw them first, which costs an item interaction or action)

    // Add special attack options with calculated bonuses
    // Unarmed Strike uses STR + proficiency (attack roll) - all characters are proficient
    // Tavern Brawler: unarmed damage becomes 1d4 instead of 1
    const hasTavernBrawler = hasFeat('tavern_brawler');
    const unarmedDamage = hasTavernBrawler
      ? `1d4${strMod >= 0 ? '+' : ''}${strMod}`
      : `1${strMod >= 0 ? '+' : ''}${strMod}`;
    const unarmedDesc = hasTavernBrawler
      ? '酒馆斗殴者：徒手攻击造成1d4+力量调整值的钝击伤害。'
      : '用拳头、脚或其他身体部位进行近战攻击。造成1+力量调整值的钝击伤害。';
    options.push({
      key: 'unarmed',
      name: '徒手打击',
      nameEn: 'Unarmed Strike',
      icon: '👊',
      description: unarmedDesc,
      damage: unarmedDamage,
      damageType: '钝击',
      range: '5尺',
      normalRange: 5,
      maxRange: 5,
      isSpecial: true,
      attackBonus: strMod + profBonus,
      abilityName: '力量',
      abilityMod: strMod,
      profBonus: profBonus,
      weaponProficient: true,  // All characters are proficient with unarmed strikes
    });

    // Grapple and Shove are STR(Athletics) contested checks, not attack rolls
    // They don't have attack bonus in the traditional sense
    options.push({
      key: 'grapple',
      name: '擒抱',
      nameEn: 'Grapple',
      icon: '🤼',
      description: '力量(运动)检定 对抗 目标的力量(运动)或敏捷(杂技)。需要一只空手。成功则目标获得擒抱状态，速度变为0。',
      range: '5尺',
      normalRange: 5,
      maxRange: 5,
      isSpecial: true,
      // Show STR mod for reference, but note it's a skill check
      abilityName: '力量(运动)',
      abilityMod: strMod,
    });

    options.push({
      key: 'shove',
      name: '推撞',
      nameEn: 'Shove',
      icon: '🫸',
      description: '力量(运动)检定 对抗 目标的力量(运动)或敏捷(杂技)。成功可选择推开5尺或击倒(俯卧)。',
      range: '5尺',
      normalRange: 5,
      maxRange: 5,
      isSpecial: true,
      // Show STR mod for reference, but note it's a skill check
      abilityName: '力量(运动)',
      abilityMod: strMod,
    });

    // --- Thrown attack options ---
    // Melee weapons can be thrown. Weapons with "thrown" property use normal damage/range;
    // weapons without "thrown" use improvised weapon rules (1d4, 20/60ft, no proficiency).
    // Two-handed weapons cannot be thrown.
    const thrownAttacks: AttackOption[] = [];

    const hasThrown = (weaponData: any): boolean =>
      weaponData?.properties?.some((p: string) =>
        p.toLowerCase() === 'thrown' || p.includes('投掷')
      ) ?? false;

    const hasTwoHanded = (weaponData: any): boolean =>
      weaponData?.properties?.some((p: string) =>
        p.toLowerCase() === 'two-handed' || p === '双手'
      ) ?? false;

    const createThrownOption = (weaponData: any, item: any, slotLabel: string): AttackOption | null => {
      if (!weaponData || !weaponData.damage) return null;
      // Two-handed weapons cannot be thrown
      if (hasTwoHanded(weaponData)) return null;
      // Only melee weapons can be "thrown"; ranged weapons already shoot
      if (!weaponData._isMelee) return null;

      const isProperThrown = hasThrown(weaponData);
      const hasFinesse = weaponData.properties?.some((p: string) =>
        p.toLowerCase().includes('finesse') || p.includes('灵巧')
      );

      // Determine ability: thrown defaults to STR, finesse lets you pick higher
      let abilityName: string;
      let abilityMod: number;
      if (hasFinesse) {
        if (dexMod >= strMod) { abilityName = '敏捷'; abilityMod = dexMod; }
        else { abilityName = '力量'; abilityMod = strMod; }
      } else {
        abilityName = '力量'; abilityMod = strMod;
      }

      let damage: string;
      let damageType: string;
      let normalRange: number;
      let maxRange: number;
      let weaponProficient: boolean;
      let label: string;

      if (isProperThrown) {
        // Has thrown property: use weapon's base damage (not versatile), weapon's thrown range
        damage = formatDamage(weaponData.damage);  // Always base, not versatile
        damageType = translateDamageType(weaponData.damageType);
        const r = typeof weaponData.range === 'object'
          ? weaponData.range
          : { normal: 20, long: 60 };
        normalRange = r.normal || 20;
        maxRange = r.long || 60;
        weaponProficient = isProficientWithWeaponId(item.id, sourceCharacterData);
        label = `投掷${slotLabel} (${weaponData.name || item.name})`;
      } else {
        // Improvised throw: 1d4, 20/60ft, no proficiency
        damage = '1d4';
        damageType = translateDamageType(weaponData.damageType) || '钝击';
        normalRange = 20;
        maxRange = 60;
        weaponProficient = false;
        label = `投掷${slotLabel} (${weaponData.name || item.name}, 即兴武器)`;
      }

      const attackBonus = weaponProficient ? abilityMod + profBonus : abilityMod;

      return {
        key: `thrown_${item.id}_${item.equippedSlot}`,
        name: label,
        nameEn: `Throw ${item.id}`,
        icon: '🪃',
        description: isProperThrown
          ? `投掷${weaponData.name || item.name}进行远程攻击。武器将落在目标附近。`
          : `将${weaponData.name || item.name}作为即兴武器投掷。1d4伤害，无熟练加值，20/60尺射程。`,
        weaponName: weaponData.name || item.name,
        damage,
        damageType,
        properties: weaponData.properties,
        range: `${normalRange}/${maxRange}尺`,
        normalRange,
        maxRange,
        attackBonus,
        abilityName,
        abilityMod,
        profBonus: weaponProficient ? profBonus : 0,
        weaponProficient,
        isRanged: true,  // Thrown = ranged attack → existing disadvantage logic applies
        isThrown: true,
        isImprovisedThrow: !isProperThrown,
        thrownWeaponItem: {
          id: item.id,
          name: item.name || weaponData.name,
          equippedSlot: item.equippedSlot,
          iconPath: item.iconPath,
          weight: weaponData.weight,
        },
      };
    };

    if (mainHandItem) {
      const wd = getWeaponData(mainHandItem.id);
      const opt = createThrownOption(wd, mainHandItem, '主手');
      if (opt) thrownAttacks.push(opt);
    }
    if (offHandItem) {
      const wd = getWeaponData(offHandItem.id);
      const opt = createThrownOption(wd, offHandItem, '副手');
      if (opt) thrownAttacks.push(opt);
    }

    return { attacks: options, bonusAttacks, thrownAttacks };
  }, [sourceType, sourceCharacterData, sourceToken.transformation_data]);

  // Extract spell options for player character SOURCE
  const spellOptions = useMemo(() => {
    if (sourceType !== 'player' || !sourceCharacterData) return { cantrips: [], leveledSpells: [] };

    const allSpells = (spellsData as any).spells || [];
    const cantrips: SpellOption[] = [];
    const leveledSpells: SpellOption[] = [];

    // Helper: calculate ability modifier
    const calcAbilityMod = (score?: number) => score ? Math.floor((score - 10) / 2) : 0;

    // Determine spellcasting ability based on class
    const getSpellcastingAbility = (classId?: string): string => {
      const spellcastingClasses: Record<string, string> = {
        wizard: 'intelligence',
        artificer: 'intelligence',
        cleric: 'wisdom',
        druid: 'wisdom',
        ranger: 'wisdom',
        monk: 'wisdom',
        bard: 'charisma',
        paladin: 'charisma',
        sorcerer: 'charisma',
        warlock: 'charisma',
      };
      return classId ? (spellcastingClasses[classId] || 'intelligence') : 'intelligence';
    };

    const spellcastingAbility = sourceCharacterData.spellcasting_ability || getSpellcastingAbility(sourceCharacterData.class_id);
    const charLevel = sourceCharacterData.level || 1;
    const profBonus = Math.floor((charLevel - 1) / 4) + 2;

    // Get spellcasting modifier
    const abilityScores = sourceCharacterData.ability_scores || { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 };
    const spellMod = calcAbilityMod(abilityScores[spellcastingAbility as keyof typeof abilityScores] ?? 10);

    const spellAttackBonus = profBonus + spellMod;
    const spellSaveDC = 8 + profBonus + spellMod;

    // Helper to convert spell data to SpellOption
    const convertToSpellOption = (spell: any): SpellOption | null => {
      // Filter: must have damage or healing (area spells are now allowed)
      if (!spell.damage && !spell.healing) return null;

      return {
        id: spell.id,
        name: spell.name,
        nameEn: spell.nameEn,
        level: spell.level,
        school: spell.school,
        damage: spell.damage,
        damageType: spell.damageType,
        damageTypeCn: spell.damageTypeCn || DAMAGE_TYPE_CN[spell.damageType?.toLowerCase()] || spell.damageType,
        damageAtCharacterLevel: spell.damageAtCharacterLevel,
        damageAtSlotLevel: spell.damageAtSlotLevel,
        healing: spell.healing,
        healingAtSlotLevel: spell.healingAtSlotLevel,
        attackType: spell.attackType,
        saveType: spell.saveType,
        saveTypeCn: spell.saveTypeCn,
        saveEffect: spell.saveEffect,
        range: spell.range,
        spellAttackBonus,
        spellSaveDC,
        castingTime: spell.castingTime,
        areaOfEffect: spell.areaOfEffect,
        iconPath: spell.iconPath,
      };
    };

    // Get cantrips
    const cantripIds = sourceCharacterData.selected_cantrips || [];
    for (const cantripId of cantripIds) {
      const spell = allSpells.find((s: any) => s.id === cantripId);
      if (spell) {
        const option = convertToSpellOption(spell);
        if (option) cantrips.push(option);
      }
    }

    // Get prepared spells (check spell slot availability)
    const preparedSpellIds = sourceCharacterData.prepared_spells || [];
    const spellSlots = sourceCharacterData.spell_slots_state;

    // Helper function to check if a slot is available at a given level
    const hasSlotAtLevel = (lvl: number): boolean => {
      if (!spellSlots) return false;

      // New multiclass format with pact slots: {"slots": [...], "pact_slots": [...]}
      if (typeof spellSlots === 'object' && !Array.isArray(spellSlots) && spellSlots.slots) {
        const regularSlots = spellSlots.slots as number[];
        const pactSlots = spellSlots.pact_slots as number[] | undefined;

        // Check regular slots
        if (regularSlots[lvl] && regularSlots[lvl] > 0) return true;

        // Check pact slots (warlock can use pact slots for any spell)
        if (pactSlots) {
          for (let pactLvl = lvl; pactLvl <= 9; pactLvl++) {
            if (pactSlots[pactLvl] && pactSlots[pactLvl] > 0) return true;
          }
        }
        return false;
      }

      // Array format: [0, slots1, slots2, ...]
      if (Array.isArray(spellSlots)) {
        return (spellSlots[lvl] ?? 0) > 0;
      }

      // Dict format: {"1": {current: N, max: M}}
      if (typeof spellSlots === 'object') {
        const slotState = (spellSlots as Record<string, { current: number; max: number }>)[String(lvl)];
        return slotState && slotState.current > 0;
      }

      return false;
    };

    for (const spellId of preparedSpellIds) {
      const spell = allSpells.find((s: any) => s.id === spellId);
      if (!spell || spell.level === 0) continue;

      // Check if player has a spell slot of this level or higher available
      let hasAvailableSlot = false;
      for (let lvl = spell.level; lvl <= 9; lvl++) {
        if (hasSlotAtLevel(lvl)) {
          hasAvailableSlot = true;
          break;
        }
      }

      if (!hasAvailableSlot) continue;

      const option = convertToSpellOption(spell);
      if (option) leveledSpells.push(option);
    }

    // Sort by level
    leveledSpells.sort((a, b) => a.level - b.level);

    return { cantrips, leveledSpells, spellSlots, spellcastingAbility, spellAttackBonus, spellSaveDC };
  }, [sourceType, sourceCharacterData]);

  // Extract granted actions from source token's concentration spell + active effects
  const grantedActions = useMemo(() => {
    if (sourceType !== 'player') return [];
    const cs = sourceToken.concentration_spell;
    const effects = (sourceToken.active_effects || []) as any[];
    const buffs = effects.filter((e: any) => e.spell_buff);
    const grantActionEffects = effects.filter((e: any) => e?.effect_type === 'grant_action');
    return extractAllGrantedActions(
      cs ? { spell_id: cs.spell_id, slot_level: cs.slot_level ?? 0 } : null,
      buffs as any,
      sourceToken.granted_actions_ui,
      sourceToken.attached_runtime_refs,
      grantActionEffects,
    );
  }, [
    sourceType,
    sourceToken.active_effects,
    sourceToken.attached_runtime_refs,
    sourceToken.concentration_spell,
    sourceToken.granted_actions_ui,
  ]);

  // Racial abilities (e.g., Dragonborn breath weapon)
  const racialAbilities = useMemo(() => {
    if (!sourceCharacterData?.race_id) return null;
    const race = (racesData as any).races?.find((r: any) => r.id === sourceCharacterData.race_id);
    if (!race) return null;
    const subrace = sourceCharacterData.subrace_id
      ? race.subraces?.find((sr: any) => sr.id === sourceCharacterData.subrace_id)
      : null;
    if (!subrace?.breathWeapon) return null;

    const level = sourceCharacterData.level || 1;
    const bwTrait = race.traits?.find((t: any) => t.nameEn === 'Breath Weapon');
    let dice = '2d6';
    if (bwTrait?.damage?.length) {
      for (const d of bwTrait.damage) { if (d.level <= level) dice = d.dice; }
    }
    const conScore = sourceCharacterData.ability_scores?.constitution ?? 10;
    const conMod = Math.floor((conScore - 10) / 2);
    const profBonus = Math.floor((level - 1) / 4) + 2;
    const saveDC = 8 + profBonus + conMod;

    return {
      breathWeapon: subrace.breathWeapon,
      damageType: subrace.damageType,
      damageTypeCn: subrace.damageTypeCn,
      damageDice: dice,
      saveDC,
    };
  }, [sourceCharacterData]);

  // Close handlers - only for desktop (fixed position menu)
  // On touch devices, Dialog handles its own close logic
  useEffect(() => {
    // Skip adding listeners on touch devices - Dialog handles closing
    if (isTouchDevice) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose, isTouchDevice]);

  // Position adjustment
  const adjustedX = Math.min(x, window.innerWidth - 260);
  const adjustedY = Math.min(y, window.innerHeight - 400);

  const sourceName = sourceToken.instance_name || (sourceToken as any).character_name || (sourceToken as any).monster_name || '源';
  const targetName = targetToken
    ? (targetToken.instance_name || (targetToken as any).character_name || (targetToken as any).monster_name || '目标')
    : targetGridPos ? `(${targetGridPos.x}, ${targetGridPos.y})` : '';

  // Menu content (shared between modal and fixed positioning)
  const menuContent = (
    <>
      {/* Header: Source → Target + Distance */}
      <div className="px-3 py-2 text-xs border-b border-gray-700 flex items-center gap-2 bg-gray-800/50">
        <span className="text-amber-400 font-medium truncate max-w-[80px]">{sourceName}</span>
        {targetName && (
          <>
            <span className="text-gray-500">→</span>
            <span className="text-white truncate max-w-[80px]">{targetName}</span>
          </>
        )}
        {distanceInfo && distanceInfo.grids > 0 && (
          <span className="ml-auto text-green-400 font-medium">{distanceInfo.feet}尺</span>
        )}
      </div>

      {/* DM: Advantage/Disadvantage toggle for next roll */}
      {isDM && (sourceType === 'player' || sourceType === 'monster') && onSetRollModifier && (
        <div className="px-3 py-2 border-b border-gray-700 bg-gray-800/30">
          <div className="text-xs text-gray-400 mb-1">下次骰子检定:</div>
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={rollModifier === 'advantage'}
                onChange={(e) => {
                  onSetRollModifier(sourceToken.id, e.target.checked ? 'advantage' : null);
                }}
                className="w-3.5 h-3.5 rounded border-gray-500 bg-gray-700 text-green-500 focus:ring-green-500 focus:ring-offset-0"
              />
              <span className="text-xs text-green-400">优势骰</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={rollModifier === 'disadvantage'}
                onChange={(e) => {
                  onSetRollModifier(sourceToken.id, e.target.checked ? 'disadvantage' : null);
                }}
                className="w-3.5 h-3.5 rounded border-gray-500 bg-gray-700 text-red-500 focus:ring-red-500 focus:ring-offset-0"
              />
              <span className="text-xs text-red-400">劣势骰</span>
            </label>
          </div>
          {rollModifier && (
            <div className="text-xs text-amber-400 mt-1">
              ⚡ 已设置{rollModifier === 'advantage' ? '优势' : '劣势'}，下次检定后自动清除
            </div>
          )}
        </div>
      )}

      {reactionOnlyMode ? (
        <ReactionOnlySection
          sourceToken={sourceToken}
          targetToken={targetToken}
          sourceCharacterData={sourceCharacterData}
          attackOptions={attackOptions}
          distanceFeet={distanceInfo?.feet}
          isSourceIncapacitated={isSourceIncapacitated}
          onBonusAction={onBonusAction}
          onReactionAttack={onReactionAttack}
          onClose={onClose}
        />
      ) : (
        <>
      {/* Self Menu - right-click on selected token itself */}
      {menuContext === 'self' && (
        <>
          {/* Player source → Standard D&D actions (same as target menu) */}
          {sourceType === 'player' && (
            <StandardActionsSection
              sourceTokenId={sourceToken.id}
              targetTokenId={sourceToken.id}
              characterId={sourceToken.character_id}
              attackOptions={attackOptions}
              bonusAttacks={bonusAttacks}
              thrownAttacks={thrownAttacks}
              spellOptions={spellOptions}
              distanceFeet={0}
              characterActions={sourceCharacterData?.actions}
              activeEffects={sourceActiveEffects}
              maneuversData={sourceCharacterData?.maneuvers_data}
              maneuverDC={maneuverDC}
              pendingManeuver={pendingManeuver}
              isDM={isDM}
              isIncapacitated={isSourceIncapacitated}
              onStandardAction={onStandardAction}
              onAttackAction={onAttackAction}
              onBonusAction={onBonusAction}
              onManeuverAction={onManeuverAction}
              onCancelManeuver={onCancelManeuver}
              onEditEffectDuration={onEditEffectDuration}
              onEditActionUses={onEditActionUses}
              onSpellAction={onSpellAction}
              onAreaSpellSelect={onAreaSpellSelect}
              racialAbilities={racialAbilities}
              sourceCharacterData={sourceCharacterData}
              sourceTokenName={sourceToken.character_name ?? sourceToken.monster_name ?? ''}
              onClose={onClose}
            />
          )}
          {sourceType === 'player' && !isSourceIncapacitated && sourceToken.character_id && onOpenToolCheck && (
            <div className="border-t border-gray-700 pt-1">
              <MenuItem
                icon="🧰"
                label="工具检定"
                sublabel={
                  sourceCharacterData?.proficient_tools?.length
                    ? `熟练 ${sourceCharacterData.proficient_tools.length} 项`
                    : "通用工具链路"
                }
                onClick={() => {
                  onOpenToolCheck({
                    characterId: sourceToken.character_id!,
                    characterName: sourceCharacterData?.name || sourceToken.character_name || undefined,
                    title: "工具检定",
                  });
                  onClose();
                }}
              />
            </div>
          )}
          {/* Granted spell actions (from concentration spells / buffs) */}
          {sourceType === 'player' && !isSourceIncapacitated && grantedActions.length > 0 && (
            <div className="border-t border-gray-700 pt-1">
              <div className="px-3 py-1 text-xs text-gray-500 flex items-center gap-1">
                <span className="text-amber-400/80">✦</span> 法术动作
              </div>
              {grantedActions.map((action, i) => (
                <MenuItem
                  key={`granted-${action.spellId}-${action.effect.actionKind}-${i}`}
                  icon={action.effect.icon || '✦'}
                  label={action.effect.actionName}
                  sublabel={`${getActionTypeLabel(action.effect.actionType)} · ${action.spellName} · ${getActionSummary(action)}`}
                  onClick={() => {
                    // Area / moving-area grants (move_effect, e.g. Moonbeam /
                    // Flaming Sphere) must enter the area placement flow even
                    // when a target token sits under the menu — the single-
                    // target `sidebarSpellCast` shortcut is only correct for
                    // locked single-target grants (Witch Bolt repeat_damage,
                    // Spiritual Weapon attack).
                    const spellOpt = grantedActionToSpellOption(action) as any;
                    const isAreaOrMoveGrant =
                      action.effect.actionKind === 'move_effect' || !!spellOpt.areaOfEffect;
                    if (targetToken && actionNeedsTarget(action) && !isAreaOrMoveGrant) {
                      if (action.effect.actionType) {
                        publishAppEvent("combatActionUsed", { type: action.effect.actionType });
                      }
                      publishAppEvent("sidebarSpellCast", {
                        spell: spellOpt,
                        sourceTokenId: sourceToken.id,
                        targetTokenId: targetToken.id,
                        slotLevel: 0,
                        characterId: sourceToken.character_id || 0,
                        freecast: true,
                        runtimeAction: action.runtimeAction,
                      });
                    } else {
                      executeGrantedAction(action, sourceToken.character_id || 0, undefined, sourceToken.id);
                    }
                    onClose();
                  }}
                />
              ))}
            </div>
          )}
          {/* Ranger abilities section */}
          {sourceType === 'player' && !isSourceIncapacitated && sourceCharacterData?.class_id === 'ranger' && (
            <RangerAbilitiesSection
              sourceTokenId={sourceToken.id}
              favoredEnemy={sourceCharacterData?.favored_enemy && typeof sourceCharacterData.favored_enemy === 'object'
                ? (sourceCharacterData.favored_enemy as { value?: string })?.value
                : sourceCharacterData?.favored_enemy as string | undefined}
              favoredTerrain={sourceCharacterData?.favored_terrain && typeof sourceCharacterData.favored_terrain === 'object'
                ? (sourceCharacterData.favored_terrain as { value?: string })?.value
                : sourceCharacterData?.favored_terrain as string | undefined}
              isEnemyBuffActive={sourceActiveEffects?.some(e => e.id === 'favored_enemy')}
              isTerrainBuffActive={sourceActiveEffects?.some(e => e.id === 'natural_explorer')}
              isDM={isDM}
              onRangerAbility={onRangerAbility}
              onClose={onClose}
            />
          )}
          {/* Disguise dismiss section */}
          {!isSourceIncapacitated && sourceToken.disguise_data && (
            <div className="border-t border-gray-700 pt-1">
              <div className="px-3 py-1 text-xs text-purple-400/80">
                🌀 伪装中 · {sourceToken.disguise_data.spell_name || '伪装术'}
              </div>
              <MenuItem
                icon="✨"
                label="解除伪装"
                onClick={async () => {
                  try {
                    await apiFetch(`/api/tokens/${sourceToken.id}/disguise`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ disguise_data: null }),
                    });
                  } catch { /* ignore */ }
                  onClose();
                }}
              />
            </div>
          )}
          {/* Druid Wild Shape section */}
          {sourceType === 'player' && !isSourceIncapacitated && sourceCharacterData?.class_id === 'druid' && (sourceCharacterData?.level || 0) >= 2 && (
            <div className="border-t border-gray-700 pt-1">
              <div className="px-3 py-1 text-xs text-gray-500">🐺 野性形态</div>
              {sourceToken.transformation_data ? (
                <>
                  <div className="px-3 py-1 text-xs text-green-400">
                    当前形态: {sourceToken.transformation_data.beast_name}
                    <span className="text-gray-500 ml-1">
                      (HP: {sourceToken.transformation_data.current_hp}/{sourceToken.transformation_data.max_hp})
                    </span>
                  </div>
                  <MenuItem
                    icon="🔄"
                    label="结束变形"
                    onClick={() => {
                      (onEndTransformation || onEndWildShape)?.(sourceToken.id);
                      onClose();
                    }}
                  />
                </>
              ) : (
                <MenuItem
                  icon="🐺"
                  label="变形"
                  onClick={() => {
                    if (onTransform) {
                      onTransform(sourceToken.id, 'wild_shape');
                    } else {
                      onWildShape?.(sourceToken.id);
                    }
                    onClose();
                  }}
                />
              )}
            </div>
          )}
          {/* DM Transformation Magic section - apply polymorph etc. to any token */}
          {isDM && onTransform && !shouldHideLegacyTransformationMagic && (
            <div className="border-t border-gray-700 pt-1">
              <div className="px-3 py-1 text-xs text-gray-500">✨ 变化魔法</div>
              {sourceToken.transformation_data ? (
                <>
                  <div className="px-3 py-1 text-xs text-purple-400">
                    {sourceToken.transformation_data.source?.spell_name || '变化'}
                    {sourceToken.transformation_data.type === 'modifier'
                      ? `: ${sourceToken.transformation_data.activeMode === 'enlarge' ? '变巨' : '缩小'}`
                      : `: ${sourceToken.transformation_data.beast_name}`}
                    {sourceToken.transformation_data.current_hp != null && (
                      <span className="text-gray-500 ml-1">
                        (HP: {sourceToken.transformation_data.current_hp}/{sourceToken.transformation_data.max_hp})
                      </span>
                    )}
                  </div>
                  <MenuItem
                    icon="🔄"
                    label="结束变化"
                    onClick={() => {
                      onEndTransformation?.(sourceToken.id);
                      onClose();
                    }}
                  />
                  <MenuItem
                    icon="✨"
                    label="更换形态"
                    sublabel="重新选择变化目标"
                    onClick={() => {
                      const currentConfig = sourceToken.transformation_data?.source?.config_id || 'polymorph';
                      onTransform(sourceToken.id, currentConfig);
                      onClose();
                    }}
                  />
                </>
              ) : (
                <>
                  <MenuItem
                    icon="✨"
                    label="变形术"
                    sublabel="变为野兽（CR ≤ 目标等级/CR）"
                    onClick={() => { onTransform(sourceToken.id, 'polymorph'); onClose(); }}
                  />
                  <MenuItem
                    icon="🌟"
                    label="完全变形术"
                    sublabel="变为任意生物（CR ≤ 目标等级/CR）"
                    onClick={() => { onTransform(sourceToken.id, 'true_polymorph'); onClose(); }}
                  />
                </>
              )}
            </div>
          )}
          {/* Paladin Lay on Hands - when source is a paladin with pool > 0 */}
          {sourceType === 'player' && !isSourceIncapacitated && sourceCharacterData?.class_id === 'paladin' && onLayOnHands && (() => {
            const pool = sourceCharacterData?.class_feature_uses?.lay_on_hands;
            if (!pool || pool.current <= 0) return null;
            const targetTk = targetToken || sourceToken;
            return (
              <div className="border-t border-gray-700 pt-1">
                <MenuItem
                  icon="✋"
                  label={`圣疗术（${pool.current}/${pool.max}）`}
                  sublabel="触碰范围，治疗/祛病/解毒"
                  onClick={() => {
                    if (sourceToken.character_id) {
                      onLayOnHands(sourceToken.character_id, targetTk, distanceInfo?.feet || 0, pool.current, pool.max);
                    }
                    onClose();
                  }}
                />
              </div>
            );
          })()}
          {/* Consumable items section */}
          {sourceType === 'player' && !isSourceIncapacitated && onUseConsumable && (() => {
            const consumables = (sourceCharacterData?.equipment || []).filter((it: any) => {
              const c = getConsumableData(it);
              return c && (it.quantity || 1) > 0;
            });
            if (consumables.length === 0) return null;
            return (
              <div className="border-t border-gray-700 pt-1">
                <div className="px-3 py-1 text-xs text-gray-500">🧪 使用消耗品</div>
                {consumables.map((it: any, idx: number) => {
                  const consumable = getConsumableData(it)!;
                  const preview = getConsumableEffectPreview(consumable);
                  return (
                    <MenuItem
                      key={`${it.id}-${idx}`}
                      icon="🧪"
                      label={`${it.name}${(it.quantity || 1) > 1 ? ` x${it.quantity}` : ''}`}
                      sublabel={preview}
                      onClick={() => {
                        onUseConsumable(it, sourceToken.id);
                        onClose();
                      }}
                    />
                  );
                })}
              </div>
            );
          })()}
          {/* Control Effect Escape Section - show if source has escapable effects */}
          {(() => {
            // Find effects that can be escaped (have escape_action or ongoing_save)
            const escapableEffects = (sourceActiveEffects || []).filter(
              (e: any) => e.escape_action || e.ongoing_save
            );
            if (escapableEffects.length === 0) return null;
            return (
              <div className="border-t border-gray-700 pt-1">
                <div className="px-3 py-1 text-xs text-gray-500">🔗 挣脱效果</div>
                {escapableEffects.map((effect: any) => {
                  const hasEscape = !!effect.escape_action;
                  const hasOngoing = !!effect.ongoing_save;
                  return (
                    <div key={effect.id} className="px-3 py-1.5">
                      <div className="text-sm text-gray-300 mb-1">{effect.name}</div>
                      <div className="flex gap-2">
                        {hasEscape && onEscapeAttempt && (
                          <button
                            className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded"
                            onClick={() => { onEscapeAttempt(sourceToken.id, effect.id); onClose(); }}
                          >
                            🎲 尝试挣脱
                          </button>
                        )}
                        {hasOngoing && onOngoingSave && (
                          <button
                            className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded"
                            onClick={() => { onOngoingSave(sourceToken.id, effect.id); onClose(); }}
                          >
                            🎲 回合豁免
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          <MenuItem icon="👁️" label="查看详情" onClick={() => { onViewDetails(sourceToken.id); onClose(); }} />
          {isDM && (
            <MenuItem icon="✏️" label="编辑" onClick={() => { onEditToken(sourceToken.id); onClose(); }} />
          )}
          {isDM && (
            <>
              <div className="border-t border-gray-700" />
              <MenuItem icon="🗑️" label="删除" className="text-red-400 hover:bg-red-900/30" onClick={() => { onDeleteToken(sourceToken.id); onClose(); }} />
            </>
          )}
        </>
      )}

      {/* Ground Menu - right-click on empty space */}
      {menuContext === 'ground' && targetGridPos && (
        <GroundActionsSection
          sourceTokenId={sourceToken.id}
          targetGridPos={targetGridPos}
          distanceFeet={distanceInfo?.feet}
          movementSpeed={movementSpeed}
          isRanger={sourceCharacterData?.class_id === 'ranger'}
          favoredTerrain={typeof sourceCharacterData?.favored_terrain === 'object'
            ? sourceCharacterData?.favored_terrain?.value
            : sourceCharacterData?.favored_terrain}
          isTerrainBuffActive={sourceActiveEffects?.some(e => e.id === 'natural_explorer')}
          spellOptions={spellOptions}
          companionTokens={companionTokens}
          companionMonsterDataMap={companionMonsterDataMap}
          gridUnitLength={gridUnitLength}
          attackOptions={attackOptions}
          obscurementZones={obscurementZones}
          isIncapacitated={isSourceIncapacitated}
          onMoveTo={onMoveTo}
          onRangerAbility={onRangerAbility}
          onAreaSpellSelect={onAreaSpellSelect}
          onBlindAttack={onBlindAttack}
          onClose={onClose}
        />
      )}

      {/* Target Menu - right-click on another token */}
      {menuContext === 'target' && (
        <>
          {/* Pickup option when player targets an item - show first */}
          {sourceType === 'player' && targetToken?.item_data && sourceToken.character_id && onPickupItem && (
            <>
              {(() => {
                const pickupRange = 5; // Standard interaction range in feet
                const isTooFar = distanceInfo && distanceInfo.feet > pickupRange;
                return (
                  <MenuItem
                    icon="🎒"
                    label="捡起物品"
                    sublabel={distanceInfo ? `${distanceInfo.feet}尺` : undefined}
                    className={isTooFar ? 'text-yellow-400' : ''}
                    hint={isTooFar ? '超出范围' : undefined}
                    onClick={() => {
                      if (isTooFar) {
                        // Show confirmation for out-of-range pickup
                        if (window.confirm(`目标距离${distanceInfo?.feet}尺，超出正常交互范围(5尺)。确定要捡起吗？`)) {
                          onPickupItem(sourceToken.character_id!, targetToken.id);
                          onClose();
                        }
                      } else {
                        onPickupItem(sourceToken.character_id!, targetToken.id);
                        onClose();
                      }
                    }}
                  />
                );
              })()}
              <div className="border-t border-gray-700" />
            </>
          )}

          {/* Chest interaction - show prominently at the top */}
          {targetToken?.chest_id && (
            <>
              {(() => {
                const interactRange = 5; // Standard interaction range in feet
                const isTooFar = distanceInfo && distanceInfo.feet > interactRange;
                // Determine chest status and action
                const isLocked = targetChestData?.is_locked;
                const isOpen = targetChestData?.state === 'open' || targetChestData?.state === 'looted';
                const lockDc = targetChestData?.lock_dc || 15;

                // Check if character has thieves' tools
                const hasThievesTools = sourceCharacterData?.equipment?.some((item: any) => {
                  const itemId = String(item?.id ?? '').toLowerCase();
                  const itemName = String(item?.name ?? '').toLowerCase();
                  return itemId.includes('thieves') || itemName.includes('thieves') || itemName.includes('盗贼工具');
                }) || false;

                // Different actions based on chest state
                if (isLocked) {
                  // Locked: Show pick lock action - requires thieves' tools
                  if (!hasThievesTools) {
                    // No thieves' tools - show disabled action
                    return (
                      <MenuItem
                        icon="🔒"
                        label="撬锁"
                        sublabel="需要盗贼工具"
                        className="text-gray-500 cursor-not-allowed opacity-60"
                        hint="背包中没有盗贼工具"
                        onClick={() => {
                          // Show a toast or alert
                          alert('撬锁需要盗贼工具！请先获取盗贼工具。');
                        }}
                      />
                    );
                  }
                  // Has thieves' tools - show normal pick lock action
                  return (
                    <MenuItem
                      icon="🔒"
                      label="撬锁"
                      sublabel={`DC ${lockDc}${distanceInfo ? ` · ${distanceInfo.feet}尺` : ''}`}
                      className={isTooFar ? "text-yellow-400" : "bg-amber-900/30 text-amber-300 font-medium"}
                      hint={isTooFar ? "超出范围" : undefined}
                      onClick={() => {
                        if (isTooFar) {
                          if (!window.confirm(`目标距离${distanceInfo?.feet}尺，超出正常交互范围(5尺)。确定要尝试撬锁吗？`)) {
                            return;
                          }
                        }
                        if (!sourceToken.character_id || !onOpenToolCheck) return;
                        onOpenToolCheck({
                          characterId: sourceToken.character_id,
                          characterName: sourceCharacterData?.name || sourceToken.character_name || undefined,
                          title: "撬锁检定",
                          toolId: "thieves_tools",
                          toolLocked: true,
                          ability: "dexterity",
                          abilityLocked: true,
                          dc: lockDc,
                          dcLocked: true,
                          description: `撬锁 (DC ${lockDc})`,
                          confirmLabel: "开始撬锁",
                          context: {
                            action: "pick_lock",
                            chest_id: targetToken.chest_id,
                          },
                        });
                        onClose();
                      }}
                    />
                  );
                } else if (isOpen) {
                  // Open: Show loot action
                  return (
                    <MenuItem
                      icon="📭"
                      label={`查看${targetName}`}
                      sublabel={distanceInfo ? `${distanceInfo.feet}尺` : undefined}
                      className={isTooFar ? "text-yellow-400" : "bg-amber-900/30 text-amber-300 font-medium"}
                      hint={isTooFar ? "超出范围" : undefined}
                      onClick={() => {
                        const chestId = targetToken.chest_id;
                        if (typeof chestId !== "number") return;
                        if (isTooFar) {
                          if (!window.confirm(`目标距离${distanceInfo?.feet}尺，超出正常交互范围(5尺)。确定要查看吗？`)) {
                            return;
                          }
                        }
                        publishAppEvent("openChestInteraction", {
                          chestId,
                          tokenId: targetToken.id,
                        });
                        onClose();
                      }}
                    />
                  );
                } else {
                  // Unlocked: Show open action
                  return (
                    <MenuItem
                      icon="📦"
                      label="打开宝箱"
                      sublabel={distanceInfo ? `${distanceInfo.feet}尺` : undefined}
                      className={isTooFar ? "text-yellow-400" : "bg-green-900/30 text-green-300 font-medium"}
                      hint={isTooFar ? "超出范围" : undefined}
                      onClick={() => {
                        const chestId = targetToken.chest_id;
                        if (typeof chestId !== "number") return;
                        if (isTooFar) {
                          if (!window.confirm(`目标距离${distanceInfo?.feet}尺，超出正常交互范围(5尺)。确定要打开吗？`)) {
                            return;
                          }
                        }
                        publishAppEvent("chestOpen", {
                          chestId,
                          tokenId: targetToken.id,
                          characterId:
                            typeof sourceToken.character_id === "number"
                              ? sourceToken.character_id
                              : undefined,
                        });
                        onClose();
                      }}
                    />
                  );
                }
              })()}
              <div className="border-t border-gray-700" />
            </>
          )}

          {/* Wake Up option - when targeting a creature with shaken break_condition within 5ft */}
          {targetToken && !targetToken.item_data && !targetToken.chest_id && onWakeUp && (() => {
            // Find effects on target that can be broken by shaking
            const shakenEffects = (targetActiveEffects || []).filter(
              (e: any) => e.break_conditions?.includes('shaken')
            );
            if (shakenEffects.length === 0) return null;

            const wakeRange = 5; // Must be within 5ft to shake someone awake
            const isTooFar = distanceInfo && distanceInfo.feet > wakeRange;

            return (
              <>
                <div className="border-t border-gray-700 pt-1">
                  <div className="px-3 py-1 text-xs text-gray-500">💤 昏睡效果</div>
                  {shakenEffects.map((effect: any) => (
                    <MenuItem
                      key={effect.id}
                      icon="👋"
                      label={`摇醒 (${effect.name})`}
                      sublabel={distanceInfo ? `${distanceInfo.feet}尺` : undefined}
                      className={isTooFar ? 'text-yellow-400' : 'bg-green-900/30 text-green-300'}
                      hint={isTooFar ? '超出范围(需5尺内)' : undefined}
                      onClick={() => {
                        if (isTooFar) {
                          alert(`目标距离${distanceInfo?.feet}尺，超出摇醒范围(5尺)。请先靠近目标。`);
                          return;
                        }
                        onWakeUp(targetToken.id, effect.id);
                        onClose();
                      }}
                    />
                  ))}
                </div>
                <div className="border-t border-gray-700" />
              </>
            );
          })()}

          {/* Player source → Standard D&D actions */}
          {sourceType === 'player' && (
            <StandardActionsSection
              sourceTokenId={sourceToken.id}
              targetTokenId={targetToken?.id}
              characterId={sourceToken.character_id}
              attackOptions={attackOptions}
              bonusAttacks={bonusAttacks}
              thrownAttacks={thrownAttacks}
              spellOptions={spellOptions}
              distanceFeet={distanceInfo?.feet}
              characterActions={sourceCharacterData?.actions}
              activeEffects={sourceActiveEffects}
              maneuversData={sourceCharacterData?.maneuvers_data}
              maneuverDC={maneuverDC}
              pendingManeuver={pendingManeuver}
              isDM={isDM}
              isIncapacitated={isSourceIncapacitated}
              onStandardAction={onStandardAction}
              onAttackAction={onAttackAction}
              onBonusAction={onBonusAction}
              onManeuverAction={onManeuverAction}
              onCancelManeuver={onCancelManeuver}
              onEditEffectDuration={onEditEffectDuration}
              onEditActionUses={onEditActionUses}
              onSpellAction={onSpellAction}
              onAreaSpellSelect={onAreaSpellSelect}
              racialAbilities={racialAbilities}
              sourceCharacterData={sourceCharacterData}
              sourceTokenName={sourceToken.character_name ?? sourceToken.monster_name ?? ''}
              onClose={onClose}
            />
          )}

          {/* Granted spell actions in target menu */}
          {sourceType === 'player' && !isSourceIncapacitated && grantedActions.length > 0 && (
            <div className="border-t border-gray-700 pt-1">
              <div className="px-3 py-1 text-xs text-gray-500 flex items-center gap-1">
                <span className="text-amber-400/80">✦</span> 法术动作
              </div>
              {grantedActions.map((action, i) => (
                <MenuItem
                  key={`granted-target-${action.spellId}-${action.effect.actionKind}-${i}`}
                  icon={action.effect.icon || '✦'}
                  label={action.effect.actionName}
                  sublabel={`${getActionTypeLabel(action.effect.actionType)} · ${action.spellName} · ${getActionSummary(action)}`}
                  onClick={() => {
                    executeGrantedAction(action, sourceToken.character_id || 0, undefined, sourceToken.id);
                    onClose();
                  }}
                />
              ))}
            </div>
          )}

          {/* Paladin Lay on Hands - in target menu */}
          {sourceType === 'player' && !isSourceIncapacitated && sourceCharacterData?.class_id === 'paladin' && onLayOnHands && targetToken && (() => {
            const pool = sourceCharacterData?.class_feature_uses?.lay_on_hands;
            if (!pool || pool.current <= 0) return null;
            return (
              <div className="border-t border-gray-700 pt-1">
                <MenuItem
                  icon="✋"
                  label={`圣疗术（${pool.current}/${pool.max}）`}
                  sublabel={`触碰范围${distanceInfo ? ` · ${distanceInfo.feet}尺` : ''}`}
                  onClick={() => {
                    if (sourceToken.character_id) {
                      onLayOnHands(sourceToken.character_id, targetToken, distanceInfo?.feet || 0, pool.current, pool.max);
                    }
                    onClose();
                  }}
                />
              </div>
            );
          })()}

          {/* ⚡ 反应动作 (非自己回合时，source=player，target=enemy) */}
          {sourceType === 'player' && !isSourceIncapacitated && targetToken && onReactionAttack && sourceCharacterData && (() => {
            const reactions = getAvailableReactions({
              class_id: sourceCharacterData.class_id || '',
              subclass_id: sourceCharacterData.subclass_id,
              level: sourceCharacterData.level || 1,
              feats: sourceCharacterData.feats,
              prepared_spells: sourceCharacterData.prepared_spells,
              selected_cantrips: sourceCharacterData.selected_cantrips,
            });
            const attackReactions = reactions.filter(r => r.category === 'attack');
            if (attackReactions.length === 0) return null;
            // 找第一个近战武器作为反应攻击的武器
            const meleeWeapon = attackOptions.find(a => !a.isSpecial && (a.normalRange || 999) <= 10) || attackOptions[0] || null;
            const targetAC = (targetToken as any).ac ?? (targetToken as any).armor_class ?? 10;
            const targetName = targetToken.instance_name || (targetToken as any).character_name || (targetToken as any).monster_name || '目标';
            return (
              <>
                <div className="px-3 py-1.5 text-xs text-blue-400 bg-blue-900/20 font-medium">
                  ⚡ 反应动作
                </div>
                {attackReactions.map(r => (
                  <MenuItem key={r.id} icon={r.icon} label={r.name}
                    sublabel={distanceInfo ? `${distanceInfo.feet}尺` : undefined}
                    onClick={() => {
                      onReactionAttack({
                        reactionId: r.id,
                        sourceTokenId: sourceToken.id,
                        targetTokenId: targetToken.id,
                        sourceCharData: sourceCharacterData,
                        attackOption: meleeWeapon,
                        targetName,
                        targetAC,
                        distanceFeet: distanceInfo?.feet || 5,
                      });
                      onClose();
                    }}
                  />
                ))}
              </>
            );
          })()}

          {/* Monster source → Monster's own actions */}
          {sourceType === 'monster' && isSourceIncapacitated && (
            <div className="px-3 py-2 text-xs text-purple-300 bg-purple-900/30 border border-purple-500/20 rounded mx-2 my-1">
              💫 失能状态 — 无法执行动作或反应
            </div>
          )}
          {sourceType === 'monster' && !isSourceIncapacitated && (
            <>
              {sourceMonsterActions.length > 0 ? (
                <>
                  <div className="px-3 py-1.5 text-xs text-amber-400 bg-amber-900/20 font-medium">
                    {sourceName} 的动作
                  </div>
                  {sourceMonsterActions.map((action, idx) => (
                    <MonsterActionItem
                      key={`${action.name}-${idx}`}
                      action={action}
                      distanceFeet={distanceInfo?.feet}
                      onClick={() => { onMonsterAction(action, sourceToken.id, targetToken?.id); onClose(); }}
                    />
                  ))}
                </>
              ) : (
                <div className="px-3 py-2 text-sm text-gray-500 italic">加载动作中...</div>
              )}
              {/* Other standard actions for monsters too */}
              <OtherActionsSection
                sourceTokenId={sourceToken.id}
                targetTokenId={targetToken?.id}
                onStandardAction={onStandardAction}
                onClose={onClose}
              />
            </>
          )}

          {/* Item source → limited options */}
          {sourceType === 'item' && (
            <div className="px-3 py-2 text-sm text-gray-500 italic">物品无法执行动作</div>
          )}

          {/* 伙伴/召唤物动作（当源是玩家角色时） */}
          {sourceType === 'player' && !isSourceIncapacitated && companionTokens.length > 0 && (
            <>
              <div className="border-t border-gray-700" />
              {companionTokens.map((ct) => {
                const compName = ct.instance_name || ct.monster_name_cn || ct.monster_name || '伙伴';
                const compMd = ct.monster_instance_id ? companionMonsterDataMap[ct.monster_instance_id] : null;
                const compActions: MonsterAction[] = [];
                if (compMd) {
                  (compMd.actions || []).forEach((a: any) => {
                    if (a.name) compActions.push({
                      name: a.name, description: a.description || '', type: 'action',
                      attack_bonus: a.attack_bonus, attack_type: a.attack_type, reach: a.reach, range: a.range,
                      damage: a.damage, extra_damage: a.extra_damage, save: a.save, area: a.area,
                    });
                  });
                }
                const controlLabel = ct.control_type === 'companion' ? '🐾'
                  : ct.control_type === 'familiar' ? '🔮'
                  : ct.control_type === 'summon' ? '✨'
                  : ct.control_type === 'nature_charm' ? '🌳'
                  : ct.control_type === 'mount' ? '🐴' : '🐾';
                return (
                  <div key={ct.id}>
                    <div className="px-3 py-1.5 text-xs text-green-400 bg-green-900/20 font-medium">
                      {controlLabel} {compName} 的动作
                    </div>
                    {compActions.length > 0 ? compActions.map((action, idx) => (
                      <MonsterActionItem
                        key={`comp-${ct.id}-${idx}`}
                        action={action}
                        distanceFeet={(() => {
                          if (!targetToken) return undefined;
                          const sSize = parseTokenSize(ct.token_size);
                          const tSize = parseTokenSize(targetToken.token_size);
                          return getEdgeToEdgeDistance(ct.position_x, ct.position_y, sSize.width, sSize.height, targetToken.position_x, targetToken.position_y, tSize.width, tSize.height) * gridUnitLength;
                        })()}
                        onClick={() => { onMonsterAction(action, ct.id, targetToken?.id); onClose(); }}
                      />
                    )) : (
                      <div className="px-3 py-2 text-sm text-gray-500 italic">加载动作中...</div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Trade option: player→player (not DM, both are player characters, different users) */}
          {!isDM && onTrade && targetToken?.character_id && targetToken.user_id
            && sourceToken.character_id && String(targetToken.user_id) !== String(sourceToken.user_id) && (
            <>
              <div className="border-t border-gray-700" />
              <MenuItem icon="🤝" label={`与${targetName}交易`} onClick={() => {
                onTrade(sourceToken.character_id!, targetToken!);
                onClose();
              }} />
            </>
          )}

          {/* View target details option (not for chests - they have interaction at top) */}
          {!targetToken?.chest_id && (
            <>
              <div className="border-t border-gray-700" />
              <MenuItem icon="👁️" label={`查看${targetName}`} onClick={() => { onViewDetails(targetToken!.id); onClose(); }} />
            </>
          )}
        </>
      )}

        </>
      )}

      {/* Footer: Deselect */}
      <div className="border-t border-gray-700">
        <MenuItem icon="⭕" label="取消选中" className="text-gray-400" onClick={() => { onDeselect(); onClose(); }} />
      </div>
    </>
  );

  // Render as modal on touch devices, fixed position on desktop
  if (isTouchDevice) {
    return (
      <Dialog.Root open={true} onOpenChange={(open) => { if (!open && allowClose) onClose(); }}>
        <Dialog.Portal>
          <Dialog.Overlay
            className="fixed inset-0 bg-black/60 z-[10198]"
          />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-sm max-h-[80dvh] bg-gray-900 rounded-xl border border-gray-700 shadow-2xl z-[10199] overflow-hidden flex flex-col"
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <Dialog.Title className="sr-only">角色操作菜单</Dialog.Title>
            <div className="flex-1 overflow-y-auto">
              {menuContent}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <div
      ref={menuRef}
      className="fixed bg-gray-900 border border-gray-600 rounded-lg shadow-xl z-[10200] min-w-[220px] max-h-[400px] overflow-y-auto"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {menuContent}
    </div>
  );
}

function ReactionOnlySection({
  sourceToken,
  targetToken,
  sourceCharacterData,
  attackOptions,
  distanceFeet,
  isSourceIncapacitated,
  onBonusAction,
  onReactionAttack,
  onClose,
}: {
  sourceToken: Token;
  targetToken: Token | null;
  sourceCharacterData?: SourceCharacterData;
  attackOptions: AttackOption[];
  distanceFeet?: number;
  isSourceIncapacitated: boolean;
  onBonusAction?: (action: CharacterClassAction, sourceTokenId: number, targetTokenId?: number) => void;
  onReactionAttack?: (data: {
    reactionId: string;
    sourceTokenId: number;
    targetTokenId: number;
    sourceCharData: SourceCharacterData;
    attackOption: AttackOption | null;
    targetName: string;
    targetAC: number;
    distanceFeet: number;
  }) => void;
  onClose: () => void;
}) {
  const characterReactionActions = (sourceCharacterData?.actions || []).filter(a => a.action_type === 'reaction');
  const registeredReactions = sourceCharacterData ? getAvailableReactions({
    class_id: sourceCharacterData.class_id || '',
    subclass_id: sourceCharacterData.subclass_id,
    level: sourceCharacterData.level || 1,
    feats: sourceCharacterData.feats,
    prepared_spells: sourceCharacterData.prepared_spells,
    selected_cantrips: sourceCharacterData.selected_cantrips,
  }) : [];
  const attackReactions = targetToken ? registeredReactions.filter(r => r.category === 'attack') : [];
  const meleeWeapon = attackOptions.find(a => !a.isSpecial && (a.normalRange || 999) <= 10) || attackOptions[0] || null;
  const targetAC = targetToken ? ((targetToken as any).ac ?? (targetToken as any).armor_class ?? 10) : 10;
  const targetName = targetToken
    ? (targetToken.instance_name || (targetToken as any).character_name || (targetToken as any).monster_name || '目标')
    : '目标';
  const hasEntries = characterReactionActions.length > 0 || attackReactions.length > 0;

  return (
    <>
      <div className="px-3 py-1.5 text-xs text-cyan-300 bg-cyan-900/20 font-medium">
        ⚡ 反应行动模式
      </div>
      <div className="px-3 py-2 text-xs text-gray-400 bg-gray-800/30 border-b border-gray-700">
        非自己回合可用。这里只显示反应相关选项，避免误用普通动作。
      </div>

      {isSourceIncapacitated ? (
        <div className="px-3 py-2 text-xs text-purple-300 bg-purple-900/30 border-b border-purple-500/20">
          💫 失能状态，无法使用反应。
        </div>
      ) : (
        <>
          {characterReactionActions.length > 0 && (
            <>
              <div className="px-3 py-1 text-xs text-blue-400 bg-blue-900/15">职业/领域反应</div>
              {characterReactionActions.map(action => (
                <MenuItem
                  key={action.id}
                  icon="⚡"
                  label={action.name}
                  sublabel={action.uses ? `${action.uses.current}/${action.uses.max}` : undefined}
                  disabled={!!action.uses && action.uses.current <= 0}
                  onClick={() => {
                    onBonusAction?.(action, sourceToken.id, targetToken?.id);
                    onClose();
                  }}
                />
              ))}
            </>
          )}

          {attackReactions.length > 0 && targetToken && sourceCharacterData && onReactionAttack && (
            <>
              <div className="px-3 py-1 text-xs text-blue-400 bg-blue-900/15">通用攻击反应</div>
              {attackReactions.map(reaction => (
                <MenuItem
                  key={reaction.id}
                  icon={reaction.icon}
                  label={reaction.name}
                  sublabel={distanceFeet ? `${distanceFeet}尺` : undefined}
                  onClick={() => {
                    onReactionAttack({
                      reactionId: reaction.id,
                      sourceTokenId: sourceToken.id,
                      targetTokenId: targetToken.id,
                      sourceCharData: sourceCharacterData,
                      attackOption: meleeWeapon,
                      targetName,
                      targetAC,
                      distanceFeet: distanceFeet || 5,
                    });
                    onClose();
                  }}
                />
              ))}
            </>
          )}

          {!hasEntries && (
            <div className="px-3 py-2 text-sm text-gray-500 italic">
              当前没有可用的反应动作。
            </div>
          )}
        </>
      )}
    </>
  );
}

// MenuItem subcomponent
function MenuItem({
  icon, label, sublabel, className = '', disabled, hint, onClick
}: {
  icon: string;
  label: string;
  sublabel?: string;
  className?: string;
  disabled?: boolean;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`px-3 py-2 flex items-center gap-2 text-sm ${
        disabled
          ? 'text-gray-600 cursor-not-allowed'
          : `hover:bg-gray-700 cursor-pointer text-gray-200 ${className}`
      }`}
      onClick={(e) => {
        if (disabled || !onClick) return;
        e.stopPropagation();
        onClick();
      }}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      {icon && <span className="w-5 text-center">{icon}</span>}
      <span className="flex-1">{label}</span>
      {sublabel && <span className="text-xs text-gray-500">{sublabel}</span>}
      {hint && <span className="text-xs text-gray-600 italic">{hint}</span>}
    </div>
  );
}

// StandardActionItem - D&D standard action with description toggle
function StandardActionItem({
  action,
  onClick
}: {
  action: typeof STANDARD_ACTIONS[0];
  onClick: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="relative">
      <div className="flex items-center px-3 py-2 hover:bg-gray-700 text-gray-200">
        {/* Main clickable area - executes action */}
        <div
          className="flex-1 flex items-center gap-2 cursor-pointer"
          onClick={onClick}
        >
          <span className="w-5 text-center">{action.icon}</span>
          <span className="flex-1 text-sm">{action.name}</span>
          <span className="text-xs text-gray-500">{action.nameEn}</span>
        </div>
        {/* Info button - shows description */}
        <button
          className="ml-2 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-600 rounded"
          onClick={(e) => {
            e.stopPropagation();
            setShowDetails(!showDetails);
          }}
        >
          ?
        </button>
      </div>

      {/* Description panel (toggle) */}
      {showDetails && (
        <div className="px-3 py-2 bg-gray-800/80 border-t border-gray-700 text-xs text-gray-300 whitespace-pre-wrap">
          {action.description}
        </div>
      )}
    </div>
  );
}

// MonsterActionItem - shows damage info with info button for details
function MonsterActionItem({
  action,
  distanceFeet,
  onClick
}: {
  action: MonsterAction;
  distanceFeet?: number;
  onClick: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  // Translate damage type to Chinese
  const translateDamageType = (type: string | undefined): string => {
    if (!type) return '';
    return DAMAGE_TYPE_CN[type.toLowerCase()] || type;
  };

  // Format damage display (dice + bonus)
  const damageDisplay = action.damage?.dice
    ? `${action.damage.dice}${action.damage.bonus ? (action.damage.bonus > 0 ? `+${action.damage.bonus}` : action.damage.bonus) : ''}${action.damage.type ? ` ${translateDamageType(action.damage.type)}` : ''}`
    : null;

  // Format attack bonus
  const attackDisplay = action.attack_bonus != null
    ? `+${action.attack_bonus}`
    : null;

  // Determine attack type label
  const getAttackTypeLabel = (): string | null => {
    if (!action.attack_type) return null;
    switch (action.attack_type) {
      case 'melee': return '近战(力量)';
      case 'ranged': return '远程(敏捷)';
      case 'melee_or_ranged': return '近战/远程';
      default: return action.attack_type;
    }
  };
  const attackTypeLabel = getAttackTypeLabel();

  // Format save DC
  const saveDisplay = action.save?.dc
    ? `DC${action.save.dc}${action.save.ability ? ` ${action.save.ability}` : ''}`
    : null;

  // Format range/reach - prefer reach, then range, then area size
  const rangeDisplay = action.reach || action.range || (action.area?.size ? `◎${action.area.size}` : null);

  // Parse range string to get numeric values (e.g., "5尺" -> 5, "30/120尺" -> {normal: 30, max: 120})
  // Uses shared parseRangeValue from utils/rangeUtils

  // Determine range color based on distance
  const getRangeColorClass = (): string => {
    if (distanceFeet === undefined) return 'text-green-400';

    // Try to parse reach first (melee), then range (ranged)
    const reachRange = parseRangeValue(action.reach);
    const rangedRange = parseRangeValue(action.range);
    const areaRange = parseRangeValue(action.area?.size);

    // Use reach for melee attacks, range for ranged attacks
    const effectiveRange = reachRange || rangedRange || areaRange;

    if (!effectiveRange) return 'text-green-400';  // No range info, default green

    if (distanceFeet <= effectiveRange.normal) {
      return 'text-green-400';  // In normal range
    } else if (distanceFeet <= effectiveRange.max) {
      return 'text-yellow-400';  // Disadvantage range
    } else {
      return 'text-red-400';  // Out of range
    }
  };

  const rangeColorClass = getRangeColorClass();

  return (
    <div
      className="relative"
      onPointerEnter={() => {
        const reachRange = parseRangeValue(action.reach);
        const rangedRange = parseRangeValue(action.range);
        const effectiveRange = reachRange || rangedRange;
        if (effectiveRange) {
          publishAppEvent("attackDistanceLine", {
            normalRange: effectiveRange.normal,
            maxRange: effectiveRange.max,
          });
        }
      }}
      onPointerLeave={() => {
        publishAppEvent("attackDistanceLine", null);
      }}
    >
      <div className="flex items-center px-3 py-2 hover:bg-gray-700 text-gray-200">
        {/* Main clickable area - executes action */}
        <div
          className="flex-1 flex items-center gap-2 cursor-pointer"
          onClick={onClick}
        >
          <span className="w-5 text-center text-sm">
            {action.type === 'legendaryAction' ? '⭐' : '🎯'}
          </span>
          <span className="flex-1 truncate text-sm">{action.name}</span>
          {/* Quick stats on row */}
          <div className="flex items-center gap-1 text-xs flex-wrap justify-end">
            {attackDisplay && (
              <span className="text-blue-400" title={attackTypeLabel || undefined}>
                {attackDisplay}
                {attackTypeLabel && (
                  <span className="text-gray-500 text-[10px]">
                    ({action.attack_type === 'melee' ? '力' : action.attack_type === 'ranged' ? '敏' : '力/敏'})
                  </span>
                )}
              </span>
            )}
            {saveDisplay && (
              <span className="text-yellow-400">{saveDisplay}</span>
            )}
            {damageDisplay && (
              <span className="text-red-400">{damageDisplay}</span>
            )}
            {rangeDisplay && (
              <span className={rangeColorClass}>{rangeDisplay}</span>
            )}
            {action.type === 'legendaryAction' && (
              <span className="text-amber-500">({action.cost || 1})</span>
            )}
          </div>
        </div>
        {/* Info button - shows details */}
        {action.description && (
          <button
            className="ml-2 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-600 rounded"
            onClick={(e) => {
              e.stopPropagation();
              setShowDetails(!showDetails);
            }}
          >
            ?
          </button>
        )}
      </div>

      {/* Details panel (toggle) */}
      {showDetails && action.description && (
        <div className="px-3 py-2 bg-gray-800/80 border-t border-gray-700 text-xs">
          <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-gray-400">
            {attackDisplay && <span>命中: <span className="text-blue-400">{attackDisplay}</span></span>}
            {saveDisplay && <span>豁免: <span className="text-yellow-400">{saveDisplay}</span></span>}
            {damageDisplay && <span>伤害: <span className="text-red-400">{damageDisplay}</span></span>}
            {action.extra_damage?.dice && (
              <span>额外: <span className="text-orange-400">{action.extra_damage.dice} {translateDamageType(action.extra_damage.type)}</span></span>
            )}
            {action.reach && <span>触及: <span className={rangeColorClass}>{action.reach}</span></span>}
            {action.range && <span>射程: <span className={rangeColorClass}>{action.range}</span></span>}
            {action.area?.size && <span>范围: <span className="text-cyan-400">{action.area.size}</span></span>}
            {action.attack_type && <span>类型: <span className="text-purple-400">{action.attack_type === 'melee' ? '近战' : action.attack_type === 'ranged' ? '远程' : '近战/远程'}</span></span>}
          </div>
          {action.save?.success_effect && (
            <div className="text-green-400 mb-1">成功: {action.save.success_effect}</div>
          )}
          <div className="text-gray-300 whitespace-pre-wrap">{action.description}</div>
        </div>
      )}
    </div>
  );
}

// StandardActionsSection - shows primary actions + collapsible other actions
function StandardActionsSection({
  sourceTokenId,
  targetTokenId,
  characterId,
  attackOptions,
  bonusAttacks,
  thrownAttacks,
  spellOptions,
  distanceFeet,
  characterActions,
  activeEffects,
  maneuversData,
  maneuverDC,
  pendingManeuver,
  isDM,
  isIncapacitated,
  onStandardAction,
  onAttackAction,
  onBonusAction,
  onManeuverAction,
  onCancelManeuver,
  onEditEffectDuration,
  onEditActionUses,
  onSpellAction,
  onAreaSpellSelect,
  racialAbilities,
  sourceCharacterData,
  sourceTokenName,
  onTriggeredFeatureUse,
  onClose
}: {
  sourceTokenId: number;
  targetTokenId?: number;
  characterId?: number | null;
  attackOptions: AttackOption[];
  bonusAttacks: AttackOption[];
  thrownAttacks: AttackOption[];
  spellOptions: {
    cantrips: SpellOption[];
    leveledSpells: SpellOption[];
    spellSlots?: SpellSlotsState;
    spellAttackBonus?: number;
    spellSaveDC?: number;
  };
  distanceFeet?: number;
  characterActions?: CharacterClassAction[];
  activeEffects?: StatusEffect[];
  maneuversData?: {
    superiority_dice: { current: number; max: number; die: string };
    maneuvers_known: string[];
  };
  maneuverDC?: number;
  pendingManeuver?: { maneuver: Maneuver; targetTokenId?: number } | null;
  isDM?: boolean;
  isIncapacitated?: boolean;
  onStandardAction: (actionKey: string, sourceTokenId: number, targetTokenId?: number) => void;
  onAttackAction?: (attack: AttackOption, sourceTokenId: number, targetTokenId?: number, inspirationDie?: string | null) => void;
  onBonusAction?: (action: CharacterClassAction, sourceTokenId: number, targetTokenId?: number) => void;
  onManeuverAction?: (maneuver: Maneuver, sourceTokenId: number, targetTokenId?: number) => void;
  onCancelManeuver?: (sourceTokenId: number) => void;
  onEditEffectDuration?: (sourceTokenId: number, effectId: string, newDuration: number) => void;
  onEditActionUses?: (characterId: number, actionId: string, newUses: number, maxUses: number) => void;
  onSpellAction?: (spell: SpellOption, sourceTokenId: number, targetTokenId?: number, slotLevel?: number) => void;
  onAreaSpellSelect?: (spell: SpellOption, sourceTokenId: number, slotLevel: number) => void;
  racialAbilities?: {
    breathWeapon: { shape: string; size: string; save: string; shapeCn: string; saveCn: string };
    damageType: string;
    damageTypeCn: string;
    damageDice: string;
    saveDC: number;
  } | null;
  sourceCharacterData?: SourceCharacterData;
  sourceTokenName?: string;
  onTriggeredFeatureUse?: (featureId: string, resolved: any) => void;
  onClose: () => void;
}) {
  const [showAttackSubMenu, setShowAttackSubMenu] = useState(false);
  const [showSpellSubMenu, setShowSpellSubMenu] = useState(false);
  const [useInspiration, setUseInspiration] = useState(false);
  const [showInspirationHelp, setShowInspirationHelp] = useState(false);

  // Check if source has Bardic Inspiration effect
  const inspirationEffect = activeEffects?.find(e => e.id === 'bardic_inspiration');
  const hasInspiration = inspirationEffect && (inspirationEffect as any).usesRemaining > 0;
  // Get dice size from effect metadata or name
  const inspirationDiceSize = hasInspiration
    ? ((inspirationEffect as any).metadata?.diceSize as string) ||
      inspirationEffect?.name?.match(/\((d\d+)\)/)?.[1] || 'd6'
    : null;

  return (
    <>
      <div className="px-3 py-1.5 text-xs text-gray-400 bg-gray-800/30 font-medium">基础动作</div>

      {/* Incapacitated warning banner */}
      {isIncapacitated && (
        <div className="px-3 py-2 bg-purple-900/30 border-y border-purple-500/40">
          <div className="flex items-center gap-2 text-purple-300 text-xs">
            <span>💫</span>
            <span className="font-medium">失能状态 — 无法执行动作或反应</span>
          </div>
        </div>
      )}

      {/* Bardic Inspiration checkbox - show when attacking with inspiration available */}
      {hasInspiration && showAttackSubMenu && (
        <div className="px-3 py-2 bg-purple-900/20 border-y border-purple-600/30">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer flex-1">
              <input
                type="checkbox"
                checked={useInspiration}
                onChange={(e) => setUseInspiration(e.target.checked)}
                className="w-4 h-4 rounded border-purple-500 bg-gray-700 text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
              />
              <span className="text-sm text-purple-300">🎵 使用激励骰 ({inspirationDiceSize})</span>
            </label>
            <button
              className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-600 rounded text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setShowInspirationHelp(!showInspirationHelp);
              }}
            >
              ?
            </button>
          </div>
          {showInspirationHelp && (
            <div className="mt-2 p-2 bg-gray-800/80 rounded text-xs text-gray-300 leading-relaxed">
              <div className="font-medium text-purple-400 mb-1">🎵 激励骰</div>
              <div>诗人赋予的激励骰可以加到攻击检定上。</div>
              <div className="mt-1 text-amber-400">⚠️ 一次性使用，用后消失</div>
            </div>
          )}
        </div>
      )}

      {/* Primary actions always visible */}
      {!isIncapacitated && PRIMARY_ACTIONS.map(action => {
        // Special handling for Attack action - show sub-menu
        if (action.key === 'attack' && (attackOptions.length > 0 || bonusAttacks.length > 0 || thrownAttacks.length > 0)) {
          return (
            <AttackActionWithSubMenu
              key={action.key}
              action={action}
              attackOptions={attackOptions}
              bonusAttacks={bonusAttacks}
              thrownAttacks={thrownAttacks}
              distanceFeet={distanceFeet}
              isDM={isDM}
              expanded={showAttackSubMenu}
              onToggle={() => setShowAttackSubMenu(!showAttackSubMenu)}
              racialAbilities={racialAbilities}
              onRacialAbility={racialAbilities && onAreaSpellSelect ? () => {
                const bw = racialAbilities.breathWeapon;
                const shapeType = bw.shape === 'line' ? 'line' : 'cone';
                let sizeFeet = 15;
                const sizeMatch = bw.size.match(/(\d+)尺/);
                if (sizeMatch) sizeFeet = parseInt(sizeMatch[1], 10);

                const pseudoSpell: SpellOption = {
                  id: `breath_weapon_${racialAbilities.damageType}`,
                  name: `吐息武器（${racialAbilities.damageTypeCn}）`,
                  nameEn: 'Breath Weapon',
                  level: 0,
                  school: 'evocation',
                  damage: racialAbilities.damageDice,
                  damageType: racialAbilities.damageType,
                  damageTypeCn: racialAbilities.damageTypeCn,
                  attackType: 'save',
                  saveType: bw.save.substring(0, 3),
                  saveTypeCn: bw.saveCn,
                  saveEffect: 'half',
                  range: '自身',
                  spellSaveDC: racialAbilities.saveDC,
                  areaOfEffect: { type: shapeType, size: sizeFeet },
                };
                onAreaSpellSelect(pseudoSpell, sourceTokenId, 0);
                onClose();
              } : undefined}
              onSelectAttack={(attack) => {
                if (onAttackAction) {
                  // Pass inspirationDie if checkbox is checked
                  const inspirationDie = useInspiration && inspirationDiceSize ? inspirationDiceSize : null;
                  onAttackAction(attack, sourceTokenId, targetTokenId, inspirationDie);
                } else {
                  // Fallback to standard action
                  onStandardAction(`attack_${attack.key}`, sourceTokenId, targetTokenId);
                }
                onClose();
              }}
            />
          );
        }
        // Special handling for Cast Spell action - show sub-menu
        if (action.key === 'cast_spell' && (onSpellAction || onAreaSpellSelect)) {
          return (
            <SpellActionWithSubMenu
              key={action.key}
              action={action}
              spellOptions={spellOptions}
              distanceFeet={distanceFeet}
              isDM={isDM}
              expanded={showSpellSubMenu}
              onToggle={() => setShowSpellSubMenu(!showSpellSubMenu)}
              onSelectSpell={(spell, slotLevel) => {
                // Check if this is an area spell
                if (spell.areaOfEffect && onAreaSpellSelect) {
                  // Area spell - enter targeting mode, don't close menu
                  onAreaSpellSelect(spell, sourceTokenId, slotLevel);
                  onClose();  // Close menu, TacticalMap will enter targeting mode
                } else if (onSpellAction) {
                  // Single target spell - cast immediately
                  onSpellAction(spell, sourceTokenId, targetTokenId, slotLevel);
                  onClose();
                }
              }}
            />
          );
        }
        return (
          <StandardActionItem
            key={action.key}
            action={action}
            onClick={() => { onStandardAction(action.key, sourceTokenId, targetTokenId); onClose(); }}
          />
        );
      })}

      {/* Battle Master maneuvers (if available) */}
      {!isIncapacitated && maneuversData && onManeuverAction && maneuversData.maneuvers_known.length > 0 && (
        <ManeuversSection
          maneuversData={maneuversData}
          maneuverDC={maneuverDC}
          sourceTokenId={sourceTokenId}
          targetTokenId={targetTokenId}
          pendingManeuver={pendingManeuver}
          onManeuverAction={onManeuverAction}
          onCancelManeuver={onCancelManeuver}
          onClose={onClose}
        />
      )}

      {/* Bonus actions from class features */}
      {!isIncapacitated && characterActions && characterActions.length > 0 && onBonusAction && (
        <BonusActionsSection
          actions={characterActions}
          activeEffects={activeEffects}
          sourceTokenId={sourceTokenId}
          targetTokenId={targetTokenId}
          characterId={characterId}
          isDM={isDM}
          onBonusAction={onBonusAction}
          onEditEffectDuration={onEditEffectDuration}
          onEditActionUses={onEditActionUses}
          onClose={onClose}
        />
      )}

      {/* Triggered class features (on_activate) */}
      {!isIncapacitated && sourceCharacterData?.class_id && (
        <TriggeredFeatureButtons
          classId={sourceCharacterData.class_id}
          subclassId={sourceCharacterData.subclass_id}
          level={sourceCharacterData.level ?? 1}
          characterName={sourceTokenName ?? ''}
          resources={sourceCharacterData.class_feature_uses ?? {}}
          onUse={(feature, resolved) => onTriggeredFeatureUse?.(feature.id, resolved)}
          onClose={onClose}
        />
      )}

      {/* Toggle for other actions */}
      {!isIncapacitated && (
      <OtherActionsSection
        sourceTokenId={sourceTokenId}
        targetTokenId={targetTokenId}
        onStandardAction={onStandardAction}
        onClose={onClose}
      />
      )}
    </>
  );
}

// AttackActionWithSubMenu - Attack action with expandable weapon/special attack options
function AttackActionWithSubMenu({
  action,
  attackOptions,
  bonusAttacks,
  thrownAttacks,
  distanceFeet,
  isDM,
  expanded,
  onToggle,
  onSelectAttack,
  racialAbilities,
  onRacialAbility,
}: {
  action: typeof PRIMARY_ACTIONS[0];
  attackOptions: AttackOption[];
  bonusAttacks: AttackOption[];
  thrownAttacks: AttackOption[];
  distanceFeet?: number;
  isDM?: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelectAttack: (attack: AttackOption) => void;
  racialAbilities?: {
    breathWeapon: { shape: string; size: string; save: string; shapeCn: string; saveCn: string };
    damageType: string;
    damageTypeCn: string;
    damageDice: string;
    saveDC: number;
  } | null;
  onRacialAbility?: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  // Separate weapon attacks from special attacks
  const weaponAttacks = attackOptions.filter(a => !a.isSpecial);
  const specialAttacks = attackOptions.filter(a => a.isSpecial);

  return (
    <div className="relative">
      {/* Main Attack button */}
      <div className="flex items-center px-3 py-2 hover:bg-gray-700 text-gray-200">
        <div
          className="flex-1 flex items-center gap-2 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onTouchEnd={(e) => {
            // Prevent ghost click on touch devices
            e.stopPropagation();
          }}
        >
          <span className="w-5 text-center">{action.icon}</span>
          <span className="flex-1 text-sm">{action.name}</span>
          <span className="text-xs text-gray-500">{action.nameEn}</span>
          <span className="text-gray-400 ml-1">{expanded ? '▼' : '▶'}</span>
        </div>
        <button
          className="ml-2 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-600 rounded"
          onClick={(e) => {
            e.stopPropagation();
            setShowDetails(!showDetails);
          }}
        >
          ?
        </button>
      </div>

      {/* Action description */}
      {showDetails && (
        <div className="px-3 py-2 bg-gray-800/80 border-t border-gray-700 text-xs text-gray-300 whitespace-pre-wrap">
          {action.description}
        </div>
      )}

      {/* Sub-menu - Attack options */}
      {expanded && (
        <div className="bg-gray-800/50 border-l-2 border-amber-600/50">
          {/* Weapon attacks section */}
          {weaponAttacks.length > 0 && (
            <>
              <div className="px-4 py-1 text-xs text-amber-400/80 bg-gray-900/30">武器攻击</div>
              {weaponAttacks.map(attack => (
                <AttackOptionItem key={attack.key} attack={attack} distanceFeet={distanceFeet} isDM={isDM} onSelect={() => onSelectAttack(attack)} />
              ))}
            </>
          )}

          {/* Racial attacks (e.g., Dragonborn Breath Weapon) */}
          {racialAbilities && onRacialAbility && (
            <>
              <div className="px-4 py-1 text-xs text-teal-400/80 bg-gray-900/30">种族攻击</div>
              <button
                className="w-full px-4 py-1.5 flex items-center gap-2 text-xs hover:bg-teal-900/30 text-left transition-colors"
                onClick={onRacialAbility}
              >
                <img
                  src={getAssetUrl(`assets/spell-icons/breath_weapon_${racialAbilities.damageType}.png`)}
                  alt="吐息武器"
                  className="w-5 h-5 rounded"
                />
                <span className="text-teal-300">吐息武器</span>
                <span className="text-gray-400 text-[10px]">
                  {racialAbilities.damageDice} {racialAbilities.damageTypeCn}
                </span>
                <span className="ml-auto text-gray-500 text-[10px]">
                  DC {racialAbilities.saveDC} {racialAbilities.breathWeapon.saveCn}
                </span>
              </button>
            </>
          )}

          {/* Bonus action attacks (two-weapon fighting) */}
          {bonusAttacks.length > 0 && (
            <>
              <div className="px-4 py-1 text-xs text-amber-400 bg-amber-900/20">附赠动作攻击</div>
              {bonusAttacks.map(attack => (
                <AttackOptionItem key={attack.key} attack={attack} distanceFeet={distanceFeet} isDM={isDM} onSelect={() => onSelectAttack(attack)} />
              ))}
            </>
          )}

          {/* Thrown weapon attacks */}
          {thrownAttacks.length > 0 && (
            <>
              <div className="px-4 py-1 text-xs text-orange-400/80 bg-gray-900/30">投掷攻击</div>
              {thrownAttacks.map(attack => (
                <AttackOptionItem key={attack.key} attack={attack} distanceFeet={distanceFeet} isDM={isDM} onSelect={() => onSelectAttack(attack)} />
              ))}
            </>
          )}

          {/* Special attacks section */}
          <div className="px-4 py-1 text-xs text-cyan-400/80 bg-gray-900/30">特殊攻击</div>
          {specialAttacks.map(attack => (
            <AttackOptionItem key={attack.key} attack={attack} distanceFeet={distanceFeet} isDM={isDM} onSelect={() => onSelectAttack(attack)} />
          ))}
        </div>
      )}
    </div>
  );
}

// AttackOptionItem - Single attack option in sub-menu
function AttackOptionItem({
  attack,
  distanceFeet,
  isDM,
  onSelect
}: {
  attack: AttackOption;
  distanceFeet?: number;
  isDM?: boolean;
  onSelect: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  // Determine range color based on distance
  // Green: within normal range (no penalty)
  // Yellow: between normal and max range (disadvantage for ranged attacks), or close-range ranged
  // Red: beyond max range (cannot attack)
  const isRangedAttack = attack.isRanged || (attack.normalRange && attack.normalRange > 10);
  const isCloseRangeDisadvantage = isRangedAttack && !attack.isSpecial && distanceFeet !== undefined && distanceFeet <= 5;
  const isLongRangeDisadvantage = isRangedAttack && !attack.isSpecial && distanceFeet !== undefined
    && attack.normalRange && attack.maxRange && attack.normalRange < attack.maxRange
    && distanceFeet > attack.normalRange && distanceFeet <= attack.maxRange;

  const getRangeColorClass = (): string => {
    if (distanceFeet === undefined || !attack.maxRange) {
      return 'text-green-400';  // Default green when no distance info
    }

    // Close-range ranged attack → yellow (disadvantage)
    if (isCloseRangeDisadvantage) {
      return 'text-yellow-400';
    }

    const normalRange = attack.normalRange || attack.maxRange;
    const maxRange = attack.maxRange;

    if (distanceFeet <= normalRange) {
      return 'text-green-400';  // In normal range
    } else if (distanceFeet <= maxRange) {
      return 'text-yellow-400';  // Disadvantage range (for ranged attacks)
    } else {
      return 'text-red-400';  // Out of range
    }
  };

  const rangeColorClass = getRangeColorClass();

  // Check if weapon needs ammo and has none
  const noAmmo = attack.needsAmmo && (attack.ammoCount === 0 || attack.ammoCount === undefined);
  const hasAmmo = attack.needsAmmo && attack.ammoCount && attack.ammoCount > 0;

  // Combat attack exhaustion check (non-DM only)
  const combatIsActive = (window as any).__combatIsActive;
  const attacksUsed = (window as any).__combatAttacksUsed ?? 0;
  const attacksMax = (window as any).__combatAttacksMax ?? 1;
  const bonusActionUsed = (window as any).__combatBonusActionUsed ?? false;
  const attacksExhausted = combatIsActive && !isDM && attacksUsed >= attacksMax;
  const bonusActionExhausted = combatIsActive && !isDM && !!attack.isBonusAction && bonusActionUsed;

  // Out of range check (non-DM: hard disable)
  const isOutOfRange = !isDM && distanceFeet !== undefined && attack.maxRange !== undefined && distanceFeet > attack.maxRange;

  // DMs can bypass ammo check (warning only), players are blocked
  const isDisabled = (noAmmo && !isDM) || attacksExhausted || bonusActionExhausted || isOutOfRange;

  // Format attack bonus display
  const attackBonusStr = attack.attackBonus !== undefined
    ? (attack.attackBonus >= 0 ? `+${attack.attackBonus}` : `${attack.attackBonus}`)
    : null;

  // For contested checks (grapple/shove), show ability mod instead of attack bonus
  const isContestedCheck = attack.key === 'grapple' || attack.key === 'shove';
  const abilityModStr = attack.abilityMod !== undefined
    ? (attack.abilityMod >= 0 ? `+${attack.abilityMod}` : `${attack.abilityMod}`)
    : null;
  const isOffHandAttack = attack.key.startsWith('weapon_') && attack.key.endsWith('_off');

  return (
    <div
      className="relative"
      onPointerEnter={() => {
        if (attack.normalRange !== undefined || attack.maxRange !== undefined) {
          publishAppEvent("attackDistanceLine", {
            normalRange: attack.normalRange ?? attack.maxRange ?? 5,
            maxRange: attack.maxRange ?? attack.normalRange ?? 5,
          });
        }
      }}
      onPointerLeave={() => {
        publishAppEvent("attackDistanceLine", null);
      }}
    >
      <div className={`flex items-center px-4 py-1.5 ${isDisabled ? 'text-gray-500 cursor-not-allowed' : 'hover:bg-gray-700/70 text-gray-200'}`}>
        <div
          className={`flex-1 flex items-center gap-2 ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          onClick={(e) => {
            if (isDisabled) {
              e.stopPropagation();
              // Show appropriate toast
              if (attacksExhausted) {
                showGlobalToast({ message: `本回合攻击次数已用尽 (${attacksUsed}/${attacksMax})`, type: 'warning' });
              } else if (bonusActionExhausted) {
                showGlobalToast({ message: '本回合附赠动作已用尽', type: 'warning' });
              } else if (isOutOfRange) {
                showGlobalToast({ message: `超出攻击距离 (${Math.round(distanceFeet!)}尺 > 最大射程${attack.maxRange}尺)`, type: 'warning' });
              }
              return;
            }
            e.stopPropagation();
            onSelect();
          }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <span className="w-5 text-center text-sm">{attack.icon}</span>
          <span className="flex-1 text-sm truncate">{attack.weaponName || attack.name}</span>
          {/* Quick stats */}
          <div className="flex items-center gap-1.5 text-xs flex-wrap justify-end">
            {/* Attack bonus with ability indicator (for attack rolls) */}
            {attackBonusStr && !isContestedCheck && !(isOffHandAttack && attack.damageNote) && (
              <span
                className={isDisabled ? 'text-gray-600' : (attack.weaponProficient === false ? 'text-amber-400' : 'text-blue-400')}
                title={attack.weaponProficient === false
                  ? `${attack.abilityName}${attack.abilityMod! >= 0 ? '+' : ''}${attack.abilityMod} ⚠️不熟练(无熟练加值)`
                  : `${attack.abilityName}${attack.abilityMod! >= 0 ? '+' : ''}${attack.abilityMod} + 熟练${attack.profBonus}`}
              >
                {attackBonusStr}
                <span className="text-gray-500 text-[10px]">({attack.abilityName?.charAt(0)})</span>
                {attack.weaponProficient === false && <span className="text-amber-500 ml-0.5">⚠️</span>}
              </span>
            )}
            {/* For contested checks, show ability name and mod */}
            {isContestedCheck && attack.abilityName && (
              <span className="text-purple-400" title={`${attack.abilityName}检定`}>
                {abilityModStr}
                <span className="text-gray-500 text-[10px]">({attack.abilityName})</span>
              </span>
            )}
            {attack.damage && <span className={isDisabled ? 'text-gray-600' : 'text-red-400'}>{attack.damage}</span>}
            {attack.damageType && <span className={isDisabled ? 'text-gray-600' : 'text-orange-400'}>{attack.damageType}</span>}
            {attack.damageNote && (
              <span className={`text-[10px] ${attack.damageNote.includes('不含') ? 'text-gray-500' : 'text-blue-400'}`}
                title={attack.damageNote.includes('不含')
                  ? '副手攻击不含属性调整值（需要双武器战斗风格）'
                  : `伤害加值：${attack.damageNote}`}
              >[{attack.damageNote}]</span>
            )}
            {attack.isBonusAction && <span className="text-amber-400 text-[10px]">附赠</span>}
            {attack.featureUsesLabel && (
              <span className={isDisabled ? 'text-gray-600 text-[10px]' : 'text-amber-300 text-[10px]'}>
                {attack.featureUsesLabel}
              </span>
            )}
            {attack.range && <span className={isDisabled ? 'text-gray-600' : rangeColorClass}>{attack.range}</span>}
            {/* Ammo display */}
            {hasAmmo && (
              <span className="text-cyan-400">🏹{attack.ammoCount}</span>
            )}
            {noAmmo && (
              <span className="text-red-500">⚠️无{attack.ammoName || '弹药'}</span>
            )}
            {attacksExhausted && (
              <span className="text-red-500">⚠️攻击已用尽</span>
            )}
            {bonusActionExhausted && (
              <span className="text-red-500">⚠️附赠已用尽</span>
            )}
            {isOutOfRange && !noAmmo && (
              <span className="text-red-500">⚠️超距</span>
            )}
            {isCloseRangeDisadvantage && !isDisabled && (
              <span className="text-yellow-400" title="近身远程攻击（5尺内），劣势">⚠️贴脸</span>
            )}
            {isLongRangeDisadvantage && !isDisabled && (
              <span className="text-yellow-400" title={`超出常规射程（${Math.round(distanceFeet!)}尺 > ${attack.normalRange}尺），劣势`}>⚠️远距</span>
            )}
          </div>
        </div>
        <button
          className="ml-1 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-600 rounded text-xs"
          onClick={(e) => {
            e.stopPropagation();
            setShowDetails(!showDetails);
          }}
        >
          ?
        </button>
      </div>

      {/* Details panel */}
      {showDetails && (
        <div className="px-4 py-2 bg-gray-900/50 text-xs">
          {/* Attack bonus breakdown (for attack rolls) */}
          {attack.attackBonus !== undefined && !isContestedCheck && (
            <div className={attack.weaponProficient === false ? "text-amber-300 mb-1" : "text-blue-300 mb-1"}>
              攻击加值: {attackBonusStr} = {attack.abilityName}{attack.abilityMod! >= 0 ? '+' : ''}{attack.abilityMod}
              {attack.weaponProficient === false
                ? " ⚠️不熟练"
                : ` + 熟练+${attack.profBonus}`}
            </div>
          )}
          {/* For contested checks */}
          {isContestedCheck && (
            <div className="text-purple-300 mb-1">
              对抗检定: {attack.abilityName} {abilityModStr} (+ 运动熟练加值，如有)
            </div>
          )}
          {/* Damage note explanation */}
          {attack.damageNote && (
            <div className={`mb-1 ${attack.damageNote.includes('不含') ? 'text-amber-300' : 'text-blue-300'}`}>
              {attack.damageNote.includes('不含')
                ? '副手伤害: 仅武器骰（无属性调整值加成，需要「双武器战斗」风格）'
                : isOffHandAttack
                  ? `副手伤害: 武器骰 ${attack.damageNote}（「双武器战斗」风格）`
                  : `伤害: 武器骰 ${attack.damageNote}`}
            </div>
          )}
          {attack.featureUsesLabel && (
            <div className="text-amber-300 mb-1">
              资源次数: {attack.featureUsesLabel}
            </div>
          )}
          <div className="text-gray-300 mb-1">{attack.description}</div>
          {bonusActionExhausted && (
            <div className="text-yellow-400 mb-1">⚠️ 本回合附赠动作已使用，当前无法发动这次攻击。</div>
          )}
          {/* Disadvantage warnings */}
          {isCloseRangeDisadvantage && (
            <div className="text-yellow-400 mb-1">⚠️ 近身远程攻击（目标在5尺内），攻击骰劣势。弩专家专长可免除。</div>
          )}
          {isRangedAttack && !attack.isSpecial && distanceFeet !== undefined && attack.normalRange && attack.maxRange && distanceFeet > attack.normalRange && distanceFeet <= attack.maxRange && (
            <div className="text-yellow-400 mb-1">⚠️ 超出常规射程（{Math.round(distanceFeet)}尺 &gt; {attack.normalRange}尺），攻击骰劣势。</div>
          )}
          {/* Weapon properties with descriptions */}
          {attack.properties && attack.properties.length > 0 && (
            <div className="text-gray-400 mb-1 space-y-0.5">
              {attack.properties.map((p: string) => {
                const name = tWeaponProperty(p);
                const desc = tWeaponPropertyDesc(p);
                const hasDesc = desc !== p;
                return (
                  <div key={p}>
                    <span className="text-gray-300">{name}</span>
                    {hasDesc && <span className="text-gray-500"> — {desc}</span>}
                  </div>
                );
              })}
            </div>
          )}
          {/* Range explanation for ranged weapons */}
          {attack.normalRange && attack.maxRange && attack.normalRange < attack.maxRange && (
            <div className="text-gray-500 mb-1">
              射程 {attack.normalRange}/{attack.maxRange}尺 — {attack.normalRange}尺内正常攻击，{attack.normalRange}~{attack.maxRange}尺劣势，超{attack.maxRange}尺无法攻击
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// SpellActionWithSubMenu - Cast Spell action with spell selection submenu
function SpellActionWithSubMenu({
  action,
  spellOptions,
  distanceFeet,
  isDM,
  expanded,
  onToggle,
  onSelectSpell
}: {
  action: typeof PRIMARY_ACTIONS[0];
  spellOptions: {
    cantrips: SpellOption[];
    leveledSpells: SpellOption[];
    spellSlots?: SpellSlotsState;
    spellAttackBonus?: number;
    spellSaveDC?: number;
  };
  distanceFeet?: number;
  isDM?: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelectSpell: (spell: SpellOption, slotLevel: number) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const { cantrips, leveledSpells, spellSlots } = spellOptions;
  const hasSpells = cantrips.length > 0 || leveledSpells.length > 0;

  if (!hasSpells) {
    // No spells available - show disabled
    return (
      <div className="flex items-center px-3 py-2 text-gray-500 cursor-not-allowed">
        <span className="w-5 text-center">{action.icon}</span>
        <span className="flex-1 text-sm">{action.name}</span>
        <span className="text-xs text-gray-600">无可用法术</span>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Main Cast Spell button */}
      <div className="flex items-center px-3 py-2 hover:bg-gray-700 text-gray-200">
        <div
          className="flex-1 flex items-center gap-2 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <span className="w-5 text-center">{action.icon}</span>
          <span className="flex-1 text-sm">{action.name}</span>
          <span className="text-xs text-gray-500">{action.nameEn}</span>
          <span className="text-gray-400 ml-1">{expanded ? '▼' : '▶'}</span>
        </div>
        <button
          className="ml-2 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-600 rounded"
          onClick={(e) => {
            e.stopPropagation();
            setShowDetails(!showDetails);
          }}
        >
          ?
        </button>
      </div>

      {/* Action description */}
      {showDetails && (
        <div className="px-3 py-2 bg-gray-800/80 border-t border-gray-700 text-xs text-gray-300 whitespace-pre-wrap">
          {action.description}
        </div>
      )}

      {/* Sub-menu - Spell options */}
      {expanded && (
        <div className="bg-gray-800/50 border-l-2 border-purple-600/50">
          {/* Cantrips section */}
          {cantrips.length > 0 && (
            <>
              <div className="px-4 py-1 text-xs text-purple-400/80 bg-gray-900/30">戏法 (无限)</div>
              {cantrips.map(spell => (
                <SpellOptionItem
                  key={spell.id}
                  spell={spell}
                  distanceFeet={distanceFeet}
                  slotLevel={0}
                  isDM={isDM}
                  onSelect={() => onSelectSpell(spell, 0)}
                />
              ))}
            </>
          )}

          {/* Leveled spells section */}
          {leveledSpells.length > 0 && (
            <>
              <div className="px-4 py-1 text-xs text-cyan-400/80 bg-gray-900/30">
                有环法术
                {spellSlots && (
                  <span className="ml-2 text-gray-500">
                    {Object.entries(spellSlots)
                      .filter(([_, v]) => v.max > 0)
                      .map(([lvl, slot]) => `${lvl}环:${slot.current}/${slot.max}`)
                      .join(' ')}
                  </span>
                )}
              </div>
              {leveledSpells.map(spell => (
                <SpellOptionItemWithSlotSelector
                  key={spell.id}
                  spell={spell}
                  spellSlots={spellSlots || {}}
                  distanceFeet={distanceFeet}
                  isDM={isDM}
                  onSelect={(slotLevel) => onSelectSpell(spell, slotLevel)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// SpellOptionItem - Single spell option (for cantrips)
function SpellOptionItem({
  spell,
  distanceFeet,
  slotLevel,
  isDM,
  onSelect
}: {
  spell: SpellOption;
  distanceFeet?: number;
  slotLevel: number;
  isDM?: boolean;
  onSelect: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  // Parse range to get numeric value
  const parseRange = (rangeStr?: string): number | null => {
    if (!rangeStr) return null;
    const match = rangeStr.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  };

  const spellRange = parseRange(spell.range);
  const isTooFar = distanceFeet !== undefined && spellRange !== null && distanceFeet > spellRange;
  // Non-DM: hard disable when out of range
  const isDisabled = isTooFar && !isDM;

  // Get attack type label
  const getAttackTypeLabel = (): string => {
    switch (spell.attackType) {
      case 'melee_spell': return '近战法术';
      case 'ranged_spell': return '远程法术';
      case 'save': return `${spell.saveTypeCn || spell.saveType || ''}豁免`;
      default: return '自动';
    }
  };

  return (
    <div className="relative">
      <div className={`flex items-center px-4 py-1.5 ${isDisabled ? 'text-gray-500 cursor-not-allowed' : isTooFar ? 'text-yellow-400' : 'text-gray-200'} hover:bg-gray-700/70`}>
        <div
          className={`flex-1 flex items-center gap-2 ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          onClick={(e) => {
            e.stopPropagation();
            if (isDisabled) {
              showGlobalToast({ message: `超出法术射程 (${Math.round(distanceFeet!)}尺 > 射程${spellRange}尺)`, type: 'warning' });
              return;
            }
            onSelect();
          }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <span className="w-5 text-center text-sm" title={spell.areaOfEffect ? `范围: ${spell.areaOfEffect.size}尺 ${spell.areaOfEffect.type || '球形'}` : undefined}>
            {spell.areaOfEffect ? '🎯' : '🔮'}
          </span>
          <span className="flex-1 text-sm truncate">{spell.name}</span>
          {/* Quick stats */}
          <div className="flex items-center gap-1.5 text-xs flex-wrap justify-end">
            {/* Area indicator */}
            {spell.areaOfEffect && (
              <span className="text-cyan-400" title={`${spell.areaOfEffect.size}尺范围`}>
                ◎{spell.areaOfEffect.size}尺
              </span>
            )}
            {/* Attack bonus or Save DC */}
            {spell.attackType === 'melee_spell' || spell.attackType === 'ranged_spell' ? (
              <span className="text-blue-400" title={getAttackTypeLabel()}>
                +{spell.spellAttackBonus}
              </span>
            ) : spell.attackType === 'save' ? (
              <span className="text-yellow-400" title={getAttackTypeLabel()}>
                DC{spell.spellSaveDC}
              </span>
            ) : null}
            {/* Damage or Healing */}
            {spell.damage && (
              <span className="text-red-400">{spell.damage}</span>
            )}
            {spell.damageTypeCn && (
              <span className="text-orange-400">{spell.damageTypeCn}</span>
            )}
            {spell.healing && (
              <span className="text-green-400">{spell.healing.replace('MOD', '')}</span>
            )}
            {/* Range */}
            {spell.range && (
              <span className={isTooFar ? 'text-red-400' : 'text-green-400'}>{spell.range}</span>
            )}
          </div>
        </div>
        <button
          className="ml-1 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-600 rounded text-xs"
          onClick={(e) => {
            e.stopPropagation();
            setShowDetails(!showDetails);
          }}
        >
          ?
        </button>
      </div>

      {/* Details panel */}
      {showDetails && (
        <div className="px-4 py-2 bg-gray-900/50 text-xs">
          <div className="text-purple-300 mb-1">
            {getAttackTypeLabel()}
            {spell.attackType === 'save' && spell.saveEffect && (
              <span className="text-gray-400 ml-2">
                成功: {spell.saveEffect === 'half' ? '伤害减半' : spell.saveEffect === 'none' ? '无效果' : '部分效果'}
              </span>
            )}
          </div>
          {spell.spellAttackBonus !== undefined && (spell.attackType === 'melee_spell' || spell.attackType === 'ranged_spell') && (
            <div className="text-blue-300 mb-1">法术攻击: +{spell.spellAttackBonus}</div>
          )}
          {spell.spellSaveDC !== undefined && spell.attackType === 'save' && (
            <div className="text-yellow-300 mb-1">豁免DC: {spell.spellSaveDC}</div>
          )}
        </div>
      )}
    </div>
  );
}

// SpellOptionItemWithSlotSelector - Leveled spell with slot selection
function SpellOptionItemWithSlotSelector({
  spell,
  spellSlots,
  distanceFeet,
  isDM,
  onSelect
}: {
  spell: SpellOption;
  spellSlots: SpellSlotsState;
  distanceFeet?: number;
  isDM?: boolean;
  onSelect: (slotLevel: number) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(spell.level);

  // Helper to check if a slot is available at a given level
  const getSlotAvailable = (lvl: number): boolean => {
    if (!spellSlots) return false;
    if (Array.isArray(spellSlots)) {
      return (spellSlots[lvl] ?? 0) > 0;
    }
    // Check for multiclass format with slots array
    if ('slots' in spellSlots && Array.isArray((spellSlots as { slots: number[] }).slots)) {
      return ((spellSlots as { slots: number[] }).slots[lvl] ?? 0) > 0;
    }
    // Dict format: {"1": {current: N, max: M}}
    const slot = (spellSlots as Record<string, { current: number; max: number }>)[String(lvl)];
    return slot && slot.current > 0;
  };

  // Get available slot levels (>= spell level with available slots)
  const availableSlots: number[] = [];
  for (let lvl = spell.level; lvl <= 9; lvl++) {
    if (getSlotAvailable(lvl)) {
      availableSlots.push(lvl);
    }
  }

  // Parse range
  const parseRange = (rangeStr?: string): number | null => {
    if (!rangeStr) return null;
    const match = rangeStr.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  };

  const spellRange = parseRange(spell.range);
  const isTooFar = distanceFeet !== undefined && spellRange !== null && distanceFeet > spellRange;
  // Non-DM: hard disable when out of range
  const isDisabled = isTooFar && !isDM;

  // Get scaled damage/healing for selected slot
  const getScaledDamage = (): string | undefined => {
    if (spell.damageAtSlotLevel && spell.damageAtSlotLevel[String(selectedSlot)]) {
      return spell.damageAtSlotLevel[String(selectedSlot)];
    }
    return spell.damage;
  };

  const getScaledHealing = (): string | undefined => {
    if (spell.healingAtSlotLevel && spell.healingAtSlotLevel[String(selectedSlot)]) {
      return spell.healingAtSlotLevel[String(selectedSlot)];
    }
    return spell.healing;
  };

  const scaledDamage = getScaledDamage();
  const scaledHealing = getScaledHealing();

  // Get attack type label
  const getAttackTypeLabel = (): string => {
    switch (spell.attackType) {
      case 'melee_spell': return '近战法术';
      case 'ranged_spell': return '远程法术';
      case 'save': return `${spell.saveTypeCn || spell.saveType || ''}豁免`;
      default: return '自动';
    }
  };

  if (availableSlots.length === 0) {
    return null; // No slots available
  }

  return (
    <div className="relative">
      <div className={`flex items-center px-4 py-1.5 ${isDisabled ? 'text-gray-500 cursor-not-allowed' : isTooFar ? 'text-yellow-400' : 'text-gray-200'} hover:bg-gray-700/70`}>
        <div
          className={`flex-1 flex items-center gap-2 ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          onClick={(e) => {
            e.stopPropagation();
            if (isDisabled) {
              showGlobalToast({ message: `超出法术射程 (${Math.round(distanceFeet!)}尺 > 射程${spellRange}尺)`, type: 'warning' });
              return;
            }
            onSelect(selectedSlot);
          }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <span className="w-5 text-center text-sm" title={spell.areaOfEffect ? `范围: ${spell.areaOfEffect.size}尺 ${spell.areaOfEffect.type || '球形'}` : undefined}>
            {spell.areaOfEffect ? '🎯' : '🔮'}
          </span>
          <span className="flex-1 text-sm truncate">{spell.name}</span>
          {/* Quick stats */}
          <div className="flex items-center gap-1.5 text-xs flex-wrap justify-end">
            {/* Area indicator */}
            {spell.areaOfEffect && (
              <span className="text-cyan-400" title={`${spell.areaOfEffect.size}尺范围`}>
                ◎{spell.areaOfEffect.size}尺
              </span>
            )}
            {/* Slot selector */}
            {availableSlots.length > 1 && (
              <select
                value={selectedSlot}
                onChange={(e) => {
                  e.stopPropagation();
                  setSelectedSlot(parseInt(e.target.value, 10));
                }}
                onClick={(e) => e.stopPropagation()}
                className="bg-gray-700 text-cyan-400 text-xs px-1 py-0.5 rounded border border-gray-600"
              >
                {availableSlots.map(lvl => (
                  <option key={lvl} value={lvl}>{lvl}环</option>
                ))}
              </select>
            )}
            {availableSlots.length === 1 && (
              <span className="text-cyan-400">{selectedSlot}环</span>
            )}
            {/* Attack bonus or Save DC */}
            {spell.attackType === 'melee_spell' || spell.attackType === 'ranged_spell' ? (
              <span className="text-blue-400">+{spell.spellAttackBonus}</span>
            ) : spell.attackType === 'save' ? (
              <span className="text-yellow-400">DC{spell.spellSaveDC}</span>
            ) : null}
            {/* Damage or Healing (scaled) */}
            {scaledDamage && (
              <span className="text-red-400">{scaledDamage}</span>
            )}
            {spell.damageTypeCn && (
              <span className="text-orange-400">{spell.damageTypeCn}</span>
            )}
            {scaledHealing && (
              <span className="text-green-400">{scaledHealing.replace('MOD', '')}</span>
            )}
            {/* Range */}
            {spell.range && (
              <span className={isTooFar ? 'text-red-400' : 'text-green-400'}>{spell.range}</span>
            )}
          </div>
        </div>
        <button
          className="ml-1 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-600 rounded text-xs"
          onClick={(e) => {
            e.stopPropagation();
            setShowDetails(!showDetails);
          }}
        >
          ?
        </button>
      </div>

      {/* Details panel */}
      {showDetails && (
        <div className="px-4 py-2 bg-gray-900/50 text-xs">
          <div className="text-purple-300 mb-1">
            {spell.level}环{spell.school && ` · ${spell.school}`}
            {' · '}{getAttackTypeLabel()}
            {spell.attackType === 'save' && spell.saveEffect && (
              <span className="text-gray-400 ml-2">
                成功: {spell.saveEffect === 'half' ? '伤害减半' : spell.saveEffect === 'none' ? '无效果' : '部分效果'}
              </span>
            )}
          </div>
          {spell.damageAtSlotLevel && (
            <div className="text-cyan-300 mb-1">
              升环效应: {Object.entries(spell.damageAtSlotLevel)
                .filter(([lvl]) => parseInt(lvl, 10) > spell.level)
                .slice(0, 3)
                .map(([lvl, dmg]) => `${lvl}环:${dmg}`)
                .join(', ')}
            </div>
          )}
          {spell.healingAtSlotLevel && (
            <div className="text-cyan-300 mb-1">
              升环效应: {Object.entries(spell.healingAtSlotLevel)
                .filter(([lvl]) => parseInt(lvl, 10) > spell.level)
                .slice(0, 3)
                .map(([lvl, heal]) => `${lvl}环:${heal.replace('MOD', '')}`)
                .join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// OtherActionsSection - collapsible other standard actions (for both players and monsters)
function OtherActionsSection({
  sourceTokenId,
  targetTokenId,
  onStandardAction,
  onClose
}: {
  sourceTokenId: number;
  targetTokenId?: number;
  onStandardAction: (actionKey: string, sourceTokenId: number, targetTokenId?: number) => void;
  onClose: () => void;
}) {
  const [showOtherActions, setShowOtherActions] = useState(false);

  return (
    <>
      <div
        className="px-3 py-1.5 flex items-center gap-2 text-xs text-gray-400 bg-gray-800/30 cursor-pointer hover:bg-gray-700/50"
        onClick={() => setShowOtherActions(!showOtherActions)}
      >
        <span className="flex-1">其他动作</span>
        <span className="text-gray-500">{showOtherActions ? '▼' : '▶'} {OTHER_ACTIONS.length}项</span>
      </div>

      {showOtherActions && OTHER_ACTIONS.map(action => (
        <StandardActionItem
          key={action.key}
          action={action}
          onClick={() => { onStandardAction(action.key, sourceTokenId, targetTokenId); onClose(); }}
        />
      ))}
    </>
  );
}

// BonusActionsSection - collapsible bonus actions from class features
function BonusActionsSection({
  actions,
  activeEffects,
  sourceTokenId,
  targetTokenId,
  characterId,
  isDM,
  onBonusAction,
  onEditEffectDuration,
  onEditActionUses,
  onClose
}: {
  actions: CharacterClassAction[];
  activeEffects?: StatusEffect[];
  sourceTokenId: number;
  targetTokenId?: number;
  characterId?: number | null;
  isDM?: boolean;
  onBonusAction: (action: CharacterClassAction, sourceTokenId: number, targetTokenId?: number) => void;
  onEditEffectDuration?: (sourceTokenId: number, effectId: string, newDuration: number) => void;
  onEditActionUses?: (characterId: number, actionId: string, newUses: number, maxUses: number) => void;
  onClose: () => void;
}) {
  const [showBonusActions, setShowBonusActions] = useState(false);

  // Actions that require a different target (cannot be used on self)
  const REQUIRES_OTHER_TARGET = [
    'bardic_inspiration',
    '激励',
    'Bardic Inspiration',
    'blessing_of_the_trickster',
    '诡术祝福',
    'Blessing of the Trickster',
    'read_thoughts',
    '阅读思想',
    'Read Thoughts',
  ];
  const isSelfTarget = !targetTokenId || targetTokenId === sourceTokenId;

  // Only expose class actions that already have real in-system handlers.
  const isImplementedAction = (action: CharacterClassAction): boolean => {
    const executionType = String(action.execution?.type || "");
    if (
      executionType === "spell_slot_recovery"
      || executionType === "self_heal"
      || executionType === "target_save_effect"
    ) {
      return true;
    }
    const id = `${action.passive_feature_id || ''} ${action.id || ''}`.toLowerCase();
    const name = action.name || '';
    const isClericTrickeryCloak = action.resourceId === 'channel_divinity_cleric' && (
      id.includes('cloak_of_shadows')
      || name === '诡术斗篷'
      || name === 'Cloak of Shadows'
    );
    return (
      id.includes('turn_undead')
      || id.includes('preserve_life')
      || id.includes('radiance_of_the_dawn')
      || id.includes('corona_of_light')
      || id.includes('invoke_duplicity')
      || id.includes('knowledge_of_the_ages')
      || id.includes('read_thoughts')
      || id.includes('visions_of_the_past')
      || id.includes('charm_animals_and_plants')
      || id.includes('blessing_of_the_trickster')
      || id.includes('guided_strike')
      || id.includes('war_gods_blessing')
      || id.includes('dampen_elements')
      || isClericTrickeryCloak
      || name === '驱散不死生物'
      || name === 'Turn Undead'
      || name === '保命通道'
      || name === 'Preserve Life'
      || name === '光辉通道'
      || name === 'Radiance of the Dawn'
      || name === '日冕'
      || name === 'Corona of Light'
      || name === '诡术通道'
      || name === 'Invoke Duplicity'
      || name === '知识通道'
      || name === 'Knowledge of the Ages'
      || name === '阅读思想'
      || name === 'Read Thoughts'
      || name === '异象'
      || name === 'Visions of the Past'
      || name === '魅惑动植物通道'
      || name === 'Charm Animals and Plants'
      || name === '诡术祝福'
      || name === 'Blessing of the Trickster'
      || name.includes('引导打击')
      || name === 'Guided Strike'
      || name.includes('战神祝福')
      || name === "War God's Blessing"
      || name === '自然之怒'
      || name === 'Dampen Elements'
    );
  };

  // Filter bonus_action, free, reaction, and implemented action-type abilities
  const actionAbilities = actions.filter(a => a.action_type === 'action' && isImplementedAction(a));
  const bonusActions = actions.filter(a => a.action_type === 'bonus_action');
  const freeActions = actions.filter(a => a.action_type === 'free');
  const reactionActions = actions.filter(a => a.action_type === 'reaction');
  let allSpecialActions = [...actionAbilities, ...bonusActions, ...freeActions, ...reactionActions];

  // Filter out actions that require a different target when self-targeting
  if (isSelfTarget) {
    allSpecialActions = allSpecialActions.filter(a =>
      !REQUIRES_OTHER_TARGET.includes(a.id)
      && !REQUIRES_OTHER_TARGET.includes(a.name)
      && !(a.execution?.target?.required && a.execution?.target?.allowSelf === false)
    );
  }

  if (allSpecialActions.length === 0) return null;

  // Find active effect for an action (by matching action id)
  const getActiveEffect = (action: CharacterClassAction): StatusEffect | undefined => {
    return activeEffects?.find(e =>
      e.id === action.id
      || (!!action.passive_feature_id && e.id === action.passive_feature_id)
      || (!!action.passive_feature_id && (e as any).metadata?.sourceFeatureId === action.passive_feature_id)
    );
  };

  return (
    <>
      <div
        className="px-3 py-1.5 flex items-center gap-2 text-xs text-amber-400 bg-amber-900/20 cursor-pointer hover:bg-amber-900/30"
        onClick={() => setShowBonusActions(!showBonusActions)}
      >
        <span className="flex-1">职业动作/特殊能力</span>
        <span className="text-amber-500">{showBonusActions ? '▼' : '▶'} {allSpecialActions.length}项</span>
      </div>

      {showBonusActions && allSpecialActions.map(action => (
        <BonusActionItem
          key={action.id}
          action={action}
          activeEffect={getActiveEffect(action)}
          isDM={isDM}
          sourceTokenId={sourceTokenId}
          characterId={characterId}
          onEditEffectDuration={onEditEffectDuration}
          onEditActionUses={onEditActionUses}
          onClick={() => { onBonusAction(action, sourceTokenId, targetTokenId); onClose(); }}
        />
      ))}
    </>
  );
}

// BonusActionItem - single bonus action with description toggle
function BonusActionItem({
  action,
  activeEffect,
  isDM,
  sourceTokenId,
  characterId,
  onEditEffectDuration,
  onEditActionUses,
  onClick
}: {
  action: CharacterClassAction;
  activeEffect?: StatusEffect;  // Current active effect (if this action is active)
  isDM?: boolean;
  sourceTokenId?: number;
  characterId?: number | null;
  onEditEffectDuration?: (sourceTokenId: number, effectId: string, newDuration: number) => void;
  onEditActionUses?: (characterId: number, actionId: string, newUses: number, maxUses: number) => void;
  onClick: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  // Format uses display
  const usesDisplay = action.uses
    ? `${action.uses.current}/${action.uses.max}`
    : null;
  const rechargeLabel = action.uses?.recharge === 'short_rest' ? '短休' : '长休';

  // Check if effect is currently active
  const isActive = !!activeEffect;
  const currentDuration = activeEffect?.duration;
  const durationDisplay = currentDuration !== undefined ? `${currentDuration}轮` : null;

  // Handle duration change
  const handleDurationChange = (delta: number) => {
    if (sourceTokenId !== undefined && onEditEffectDuration && currentDuration !== undefined) {
      const newDuration = Math.max(0, currentDuration + delta);
      onEditEffectDuration(sourceTokenId, action.id, newDuration);
    }
  };

  // Handle direct input
  const handleDurationInput = (value: string) => {
    const newDuration = parseInt(value, 10);
    if (!isNaN(newDuration) && newDuration >= 0 && sourceTokenId !== undefined && onEditEffectDuration) {
      onEditEffectDuration(sourceTokenId, action.id, newDuration);
    }
  };

  // Handle uses change (for DM editing ability uses)
  const handleUsesChange = (delta: number) => {
    if (characterId && onEditActionUses && action.uses) {
      const newUses = Math.max(0, Math.min(action.uses.max, action.uses.current + delta));
      onEditActionUses(characterId, action.id, newUses, action.uses.max);
    }
  };

  // Handle direct uses input
  const handleUsesInput = (value: string) => {
    const newUses = parseInt(value, 10);
    if (!isNaN(newUses) && newUses >= 0 && characterId && onEditActionUses && action.uses) {
      const clampedUses = Math.min(newUses, action.uses.max);
      onEditActionUses(characterId, action.id, clampedUses, action.uses.max);
    }
  };

  return (
    <div className="relative">
      <div className={`flex items-center px-3 py-2 ${isActive ? 'bg-amber-900/40 hover:bg-amber-900/50' : 'hover:bg-amber-900/30'} text-gray-200`}>
        {/* Main clickable area - executes action */}
        <div
          className="flex-1 flex items-center gap-2 cursor-pointer"
          onClick={onClick}
        >
          <span className="w-5 text-center">{isActive ? activeEffect.icon : action.source?.startsWith('种族') ? '🧬' : '⚡'}</span>
          <span className="flex-1 text-sm">{action.name}</span>
          {action.action_type === 'action' && (
            <span className="text-[10px] text-amber-300 bg-amber-900/30 px-1 rounded">动作</span>
          )}
          {action.action_type === 'bonus_action' && (
            <span className="text-[10px] text-yellow-300 bg-yellow-900/30 px-1 rounded">附赠</span>
          )}
          {action.action_type === 'reaction' && (
            <span className="text-[10px] text-blue-400 bg-blue-900/30 px-1 rounded">反应</span>
          )}
          {/* Active indicator with duration */}
          {isActive && (
            <span
              className="px-1.5 py-0.5 text-xs rounded font-medium"
              style={{ backgroundColor: activeEffect.color + '40', color: activeEffect.color }}
              title={durationDisplay ? `剩余${durationDisplay}` : '点击结束'}
            >
              {durationDisplay || '激活中'}
              <span className="ml-1 text-[10px] opacity-70">⏹</span>
            </span>
          )}
          {/* Uses indicator (when not active) */}
          {!isActive && usesDisplay && (
            <span className="text-xs text-cyan-400" title={`每${rechargeLabel}恢复`}>
              {usesDisplay}
              <span className="text-gray-500 ml-0.5">({rechargeLabel})</span>
            </span>
          )}
        </div>
        {/* Info button - shows description */}
        {action.description && (
          <button
            className="ml-2 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-600 rounded"
            onClick={(e) => {
              e.stopPropagation();
              setShowDetails(!showDetails);
            }}
          >
            ?
          </button>
        )}
      </div>

      {/* DM Duration Editor - shown when effect is active */}
      {isDM && isActive && currentDuration !== undefined && onEditEffectDuration && sourceTokenId !== undefined && (
        <div
          className="px-3 py-2 bg-gray-800/60 border-t border-gray-700 flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-xs text-gray-400">轮数:</span>
          <button
            className="w-6 h-6 flex items-center justify-center bg-gray-700 hover:bg-gray-600 text-white rounded text-sm font-bold"
            onClick={() => handleDurationChange(-1)}
          >
            -
          </button>
          <input
            type="number"
            min="0"
            value={currentDuration}
            onChange={(e) => handleDurationInput(e.target.value)}
            className="w-12 px-1 py-0.5 text-xs bg-gray-700 border border-gray-600 rounded text-center text-white"
          />
          <button
            className="w-6 h-6 flex items-center justify-center bg-gray-700 hover:bg-gray-600 text-white rounded text-sm font-bold"
            onClick={() => handleDurationChange(1)}
          >
            +
          </button>
          <span className="text-xs text-gray-500">（0=结束）</span>
        </div>
      )}

      {/* DM Uses Editor - shown when action has uses and user is DM */}
      {isDM && action.uses && characterId && onEditActionUses && (
        <div
          className="px-3 py-2 bg-gray-800/60 border-t border-gray-700 flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-xs text-gray-400">次数:</span>
          <button
            className="w-6 h-6 flex items-center justify-center bg-gray-700 hover:bg-gray-600 text-white rounded text-sm font-bold"
            onClick={() => handleUsesChange(-1)}
          >
            -
          </button>
          <input
            type="number"
            min="0"
            max={action.uses.max}
            value={action.uses.current}
            onChange={(e) => handleUsesInput(e.target.value)}
            className="w-12 px-1 py-0.5 text-xs bg-gray-700 border border-gray-600 rounded text-center text-white"
          />
          <button
            className="w-6 h-6 flex items-center justify-center bg-gray-700 hover:bg-gray-600 text-white rounded text-sm font-bold"
            onClick={() => handleUsesChange(1)}
          >
            +
          </button>
          <span className="text-xs text-gray-500">/ {action.uses.max}（{rechargeLabel}）</span>
        </div>
      )}

      {/* Description panel (toggle) */}
      {showDetails && action.description && (
        <div className="px-3 py-2 bg-gray-800/80 border-t border-gray-700 text-xs">
          {action.source && (
            <div className="text-amber-400 mb-1">{action.source}</div>
          )}
          <div className="text-gray-300 whitespace-pre-wrap">{action.description}</div>
        </div>
      )}
    </div>
  );
}

// Terrain name translations for Ranger Natural Explorer
const TERRAIN_NAMES: Record<string, string> = {
  arctic: '极地',
  coast: '海岸',
  desert: '沙漠',
  forest: '森林',
  grassland: '草原',
  mountain: '山地',
  swamp: '沼泽',
  underdark: '幽暗地域',
};

// Favored enemy name translations for Ranger
const ENEMY_NAMES: Record<string, string> = {
  aberrations: '异怪',
  beasts: '野兽',
  celestials: '天界生物',
  constructs: '构装体',
  dragons: '龙',
  elementals: '元素',
  fey: '妖精',
  fiends: '邪魔',
  giants: '巨人',
  monstrosities: '怪物',
  oozes: '软泥怪',
  plants: '植物',
  undead: '不死生物',
  humanoids: '类人生物',
};

// RangerAbilitiesSection - Ranger class abilities (Favored Enemy, Natural Explorer)
function RangerAbilitiesSection({
  sourceTokenId,
  favoredEnemy,
  favoredTerrain,
  isEnemyBuffActive,
  isTerrainBuffActive,
  isDM,
  onRangerAbility,
  onClose
}: {
  sourceTokenId: number;
  favoredEnemy?: string;
  favoredTerrain?: string;
  isEnemyBuffActive?: boolean;
  isTerrainBuffActive?: boolean;
  isDM?: boolean;
  onRangerAbility?: (abilityType: 'favored_enemy' | 'natural_explorer', sourceTokenId: number, isActivating: boolean) => void;
  onClose: () => void;
}) {
  const [showSection, setShowSection] = useState(true);

  // Don't render if no ranger abilities
  if (!favoredEnemy && !favoredTerrain) return null;

  const enemyName = favoredEnemy ? ENEMY_NAMES[favoredEnemy] || favoredEnemy : '';
  const terrainName = favoredTerrain ? TERRAIN_NAMES[favoredTerrain] || favoredTerrain : '';

  // Count active buffs for header display
  const activeCount = (isEnemyBuffActive ? 1 : 0) + (isTerrainBuffActive ? 1 : 0);

  return (
    <>
      <div className="border-t border-gray-700" />
      <div
        className="px-3 py-2 flex items-center gap-2 text-sm hover:bg-gray-700 cursor-pointer text-green-400"
        onClick={() => setShowSection(!showSection)}
      >
        <span className="w-5 text-center">🏹</span>
        <span className="flex-1 font-medium">游侠能力</span>
        {activeCount > 0 && <span className="text-xs text-green-500">{activeCount}个激活</span>}
        <span className="text-xs text-gray-400">{showSection ? '▼' : '▶'}</span>
      </div>
      {showSection && (
        <div className="bg-gray-800/50 border-l-2 border-green-600">
          {/* Favored Enemy buff */}
          {favoredEnemy && (
            <div
              className={`px-3 py-2 flex items-center gap-2 text-sm hover:bg-gray-700 cursor-pointer ${isEnemyBuffActive ? 'text-green-400' : 'text-gray-200'}`}
              onClick={() => {
                if (onRangerAbility) {
                  onRangerAbility('favored_enemy', sourceTokenId, !isEnemyBuffActive);
                }
                onClose();
              }}
            >
              <span className="w-5 text-center">🎯</span>
              <span className="flex-1">
                宿敌
                <span className="text-xs text-gray-400 ml-1">({enemyName})</span>
              </span>
              {isEnemyBuffActive ? (
                <span className="text-xs text-red-400 hover:text-red-300">✕ 点击取消</span>
              ) : (
                <span className="text-xs text-gray-500">点击激活</span>
              )}
            </div>
          )}
          {/* Natural Explorer buff */}
          {favoredTerrain && (
            <div
              className={`px-3 py-2 flex items-center gap-2 text-sm hover:bg-gray-700 cursor-pointer ${isTerrainBuffActive ? 'text-green-400' : 'text-gray-200'}`}
              onClick={() => {
                if (onRangerAbility) {
                  onRangerAbility('natural_explorer', sourceTokenId, !isTerrainBuffActive);
                }
                onClose();
              }}
            >
              <span className="w-5 text-center">🌲</span>
              <span className="flex-1">
                自然探索者
                <span className="text-xs text-gray-400 ml-1">({terrainName})</span>
              </span>
              {isTerrainBuffActive ? (
                <span className="text-xs text-red-400 hover:text-red-300">✕ 点击取消</span>
              ) : (
                <span className="text-xs text-gray-500">点击激活</span>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// GroundActionsSection - actions when right-clicking on empty ground
function GroundActionsSection({
  sourceTokenId,
  targetGridPos,
  distanceFeet,
  movementSpeed,
  isRanger,
  favoredTerrain,
  isTerrainBuffActive,
  spellOptions,
  companionTokens = [],
  companionMonsterDataMap = {},
  gridUnitLength = 5,
  attackOptions = [],
  obscurementZones,
  isIncapacitated,
  onMoveTo,
  onRangerAbility,
  onAreaSpellSelect,
  onBlindAttack,
  onClose
}: {
  sourceTokenId: number;
  targetGridPos: { x: number; y: number };
  distanceFeet?: number;
  movementSpeed: number;
  isRanger?: boolean;
  favoredTerrain?: string;
  isTerrainBuffActive?: boolean;
  spellOptions?: {
    cantrips: SpellOption[];
    leveledSpells: SpellOption[];
    spellSlots?: SpellSlotsState;
    spellAttackBonus?: number;
    spellSaveDC?: number;
  };
  companionTokens?: Token[];
  companionMonsterDataMap?: Record<number, any>;
  gridUnitLength?: number;
  attackOptions?: AttackOption[];
  obscurementZones?: ObscurementZone[];
  isIncapacitated?: boolean;
  onMoveTo: (gridX: number, gridY: number, sourceTokenId: number) => void;
  onRangerAbility?: (abilityType: 'favored_enemy' | 'natural_explorer', sourceTokenId: number, isActivating: boolean) => void;
  onAreaSpellSelect?: (spell: SpellOption, sourceTokenId: number, slotLevel: number) => void;
  onBlindAttack?: (attack: AttackOption, sourceTokenId: number, gridX: number, gridY: number) => void;
  onClose: () => void;
}) {
  const [showSkillsMenu, setShowSkillsMenu] = useState(false);
  const [showSpellsMenu, setShowSpellsMenu] = useState(false);
  const [showBlindAttackMenu, setShowBlindAttackMenu] = useState(false);
  const [selectedSlotLevel, setSelectedSlotLevel] = useState<Record<string, number>>({});

  // Check if target position is in heavy obscurement
  const targetObscLevel = obscurementZones?.length
    ? isPointInObscuredZone(targetGridPos.x, targetGridPos.y, obscurementZones, gridUnitLength)
    : null;
  const isInHeavyObscurement = targetObscLevel === 'heavy';

  // Determine if movement is within range
  const isWithinMovement = distanceFeet !== undefined && distanceFeet <= movementSpeed;
  const moveColorClass = distanceFeet !== undefined
    ? (isWithinMovement ? 'text-green-400' : 'text-red-400')
    : 'text-gray-400';

  const terrainName = favoredTerrain ? TERRAIN_NAMES[favoredTerrain] || favoredTerrain : '';

  // Helper function to check if a slot is available at a given level
  // Handles multiple formats: array, dict, multiclass
  const hasSlotAtLevel = (lvl: number): boolean => {
    const spellSlots = spellOptions?.spellSlots;
    if (!spellSlots) return false;

    // New multiclass format with pact slots: {"slots": [...], "pact_slots": [...]}
    if (typeof spellSlots === 'object' && !Array.isArray(spellSlots) && (spellSlots as any).slots) {
      const regularSlots = (spellSlots as any).slots as number[];
      const pactSlots = (spellSlots as any).pact_slots as number[] | undefined;

      // Check regular slots
      if (regularSlots[lvl] && regularSlots[lvl] > 0) return true;

      // Check pact slots (warlock can use pact slots for any spell)
      if (pactSlots) {
        for (let pactLvl = lvl; pactLvl <= 9; pactLvl++) {
          if (pactSlots[pactLvl] && pactSlots[pactLvl] > 0) return true;
        }
      }
      return false;
    }

    // Array format: [0, slots1, slots2, ...]
    if (Array.isArray(spellSlots)) {
      return (spellSlots as number[])[lvl] > 0;
    }

    // Dict format: {"1": {current: N, max: M}}
    if (typeof spellSlots === 'object') {
      const slotState = (spellSlots as Record<string, { current: number; max: number }>)[String(lvl)];
      return slotState && slotState.current > 0;
    }

    return false;
  };

  // Get available slot levels for a spell
  const getAvailableSlots = (spellLevel: number): number[] => {
    const available: number[] = [];
    for (let l = spellLevel; l <= 9; l++) {
      if (hasSlotAtLevel(l)) available.push(l);
    }
    return available;
  };

  return (
    <>
      {/* Move action with distance indicator */}
      <div
        className="px-3 py-2 flex items-center gap-2 text-sm hover:bg-gray-700 cursor-pointer text-gray-200"
        onClick={() => { onMoveTo(targetGridPos.x, targetGridPos.y, sourceTokenId); onClose(); }}
      >
        <span className="w-5 text-center">🚶</span>
        <span className="flex-1">移动到此</span>
        {distanceFeet !== undefined && (
          <span className={`text-xs ${moveColorClass}`}>
            {distanceFeet}尺
            {!isWithinMovement && <span className="ml-1 text-gray-500">(超出{movementSpeed}尺)</span>}
          </span>
        )}
      </div>

      {/* 伙伴/召唤物移动选项 */}
      {companionTokens.map((ct) => {
        const compName = ct.instance_name || ct.monster_name_cn || ct.monster_name || '伙伴';
        const compMonsterData = ct.monster_instance_id ? companionMonsterDataMap[ct.monster_instance_id] : null;
        const compSpeed = compMonsterData?.speeds?.walk || compMonsterData?.speeds?.fly || 30;
        const dx = targetGridPos.x - ct.position_x;
        const dy = targetGridPos.y - ct.position_y;
        const compDist = Math.max(Math.abs(dx), Math.abs(dy)) * gridUnitLength;
        const compInRange = compDist <= compSpeed;
        const compMoveColor = compInRange ? 'text-green-400' : 'text-red-400';
        const controlLabel = ct.control_type === 'companion' ? '🐾'
          : ct.control_type === 'familiar' ? '🔮'
          : ct.control_type === 'summon' ? '✨'
          : ct.control_type === 'nature_charm' ? '🌳'
          : ct.control_type === 'mount' ? '🐴'
          : '🐾';
        return (
          <div
            key={ct.id}
            className="px-3 py-2 flex items-center gap-2 text-sm hover:bg-gray-700 cursor-pointer text-amber-200"
            onClick={() => { onMoveTo(targetGridPos.x, targetGridPos.y, ct.id); onClose(); }}
          >
            <span className="w-5 text-center">{controlLabel}</span>
            <span className="flex-1 truncate">{compName} 移动到此</span>
            <span className={`text-xs ${compMoveColor}`}>
              {compDist}尺
              {!compInRange && <span className="ml-1 text-gray-500">(超出{compSpeed}尺)</span>}
            </span>
          </div>
        );
      })}

      {/* Blind Attack - when targeting heavy obscurement zone */}
      {!isIncapacitated && isInHeavyObscurement && onBlindAttack && attackOptions.length > 0 && (
        <div>
          <div
            className="px-3 py-2 flex items-center gap-2 text-sm hover:bg-gray-700 cursor-pointer text-red-300"
            onClick={() => setShowBlindAttackMenu(!showBlindAttackMenu)}
          >
            <span className="w-5 text-center">🎯</span>
            <span className="flex-1">攻击此位置</span>
            <span className="text-xs text-red-400">盲攻</span>
            <span className="text-xs text-gray-400">{showBlindAttackMenu ? '▼' : '▶'}</span>
          </div>
          {showBlindAttackMenu && (
            <div className="bg-gray-800/50 border-l-2 border-red-600 max-h-48 overflow-y-auto">
              {attackOptions.map(atk => (
                <div
                  key={atk.key}
                  className="px-4 py-1.5 flex items-center gap-2 text-sm hover:bg-gray-700 cursor-pointer text-gray-200"
                  onClick={() => {
                    onBlindAttack(atk, sourceTokenId, targetGridPos.x, targetGridPos.y);
                    onClose();
                  }}
                >
                  <span className="w-5 text-center">{atk.icon}</span>
                  <span className="flex-1 truncate">{atk.weaponName || atk.name}</span>
                  <span className="text-xs text-yellow-400">(劣势)</span>
                  {atk.damage && <span className="text-xs text-gray-500">{atk.damage}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Spells menu - show area spells that can be cast on ground */}
      {!isIncapacitated && (() => {
        // Filter to only area spells
        const areaCantrips = spellOptions?.cantrips?.filter(s => s.areaOfEffect) || [];
        const areaLeveledSpells = spellOptions?.leveledSpells?.filter(s => s.areaOfEffect) || [];
        const hasAreaSpells = areaCantrips.length > 0 || areaLeveledSpells.length > 0;

        if (!hasAreaSpells || !onAreaSpellSelect) {
          return <MenuItem icon="✨" label="施法" disabled hint="无范围法术" />;
        }

        return (
          <div>
            <div
              className="px-3 py-2 flex items-center gap-2 text-sm hover:bg-gray-700 cursor-pointer text-gray-200"
              onClick={() => setShowSpellsMenu(!showSpellsMenu)}
            >
              <span className="w-5 text-center">✨</span>
              <span className="flex-1">施法</span>
              <span className="text-xs text-cyan-400">{areaCantrips.length + areaLeveledSpells.length}个范围</span>
              <span className="text-xs text-gray-400">{showSpellsMenu ? '▼' : '▶'}</span>
            </div>
            {showSpellsMenu && (
              <div className="bg-gray-800/50 border-l-2 border-purple-600 max-h-60 overflow-y-auto">
                {/* Area Cantrips */}
                {areaCantrips.map(spell => (
                  <div
                    key={spell.id}
                    className="px-4 py-1.5 flex items-center gap-2 text-sm hover:bg-gray-700 cursor-pointer text-gray-200"
                    onClick={() => {
                      onAreaSpellSelect(spell, sourceTokenId, 0);
                      onClose();
                    }}
                  >
                    <span className="w-5 text-center">🎯</span>
                    <span className="flex-1 truncate">{spell.name}</span>
                    <span className="text-xs text-cyan-400">◎{spell.areaOfEffect?.size}尺</span>
                    <span className="text-xs text-gray-500">戏法</span>
                  </div>
                ))}
                {/* Area Leveled Spells */}
                {areaLeveledSpells.map(spell => {
                  const availableSlots = getAvailableSlots(spell.level);
                  const currentSlot = selectedSlotLevel[spell.id] || (availableSlots[0] ?? spell.level);
                  const hasSlot = availableSlots.length > 0;

                  return (
                    <div
                      key={spell.id}
                      className={`px-4 py-1.5 flex items-center gap-2 text-sm hover:bg-gray-700 ${hasSlot ? 'cursor-pointer text-gray-200' : 'text-gray-500 cursor-not-allowed'}`}
                      onClick={() => {
                        if (hasSlot) {
                          onAreaSpellSelect(spell, sourceTokenId, currentSlot);
                          onClose();
                        }
                      }}
                    >
                      <span className="w-5 text-center">🎯</span>
                      <span className="flex-1 truncate">{spell.name}</span>
                      <span className="text-xs text-cyan-400">◎{spell.areaOfEffect?.size}尺</span>
                      {hasSlot ? (
                        availableSlots.length > 1 ? (
                          <select
                            value={currentSlot}
                            onChange={(e) => {
                              e.stopPropagation();
                              setSelectedSlotLevel(prev => ({ ...prev, [spell.id]: parseInt(e.target.value) }));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-gray-700 text-cyan-400 text-xs px-1 py-0.5 rounded border border-gray-600"
                          >
                            {availableSlots.map(lvl => (
                              <option key={lvl} value={lvl}>{lvl}环</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-cyan-400">{currentSlot}环</span>
                        )
                      ) : (
                        <span className="text-xs text-red-400">无法术位</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Skills menu - enabled for Rangers with favored terrain */}
      {!isIncapacitated && (isRanger && favoredTerrain ? (
        <div>
          <div
            className="px-3 py-2 flex items-center gap-2 text-sm hover:bg-gray-700 cursor-pointer text-gray-200"
            onClick={() => setShowSkillsMenu(!showSkillsMenu)}
          >
            <span className="w-5 text-center">⚡</span>
            <span className="flex-1">技能</span>
            <span className="text-xs text-gray-400">{showSkillsMenu ? '▼' : '▶'}</span>
          </div>
          {showSkillsMenu && (
            <div className="bg-gray-800/50 border-l-2 border-green-600">
              {/* Natural Explorer terrain buff */}
              <div
                className={`px-3 py-2 flex items-center gap-2 text-sm hover:bg-gray-700 cursor-pointer ${isTerrainBuffActive ? 'text-green-400' : 'text-gray-200'}`}
                onClick={() => {
                  if (onRangerAbility) {
                    onRangerAbility('natural_explorer', sourceTokenId, !isTerrainBuffActive);
                  }
                  onClose();
                }}
              >
                <span className="w-5 text-center">🌲</span>
                <span className="flex-1">
                  自然探索者
                  <span className="text-xs text-gray-400 ml-1">({terrainName})</span>
                </span>
                {isTerrainBuffActive && <span className="text-xs text-green-400">✓ 已激活</span>}
              </div>
            </div>
          )}
        </div>
      ) : (
        <MenuItem icon="⚡" label="技能" disabled hint={isRanger ? '无偏好地形' : 'Phase 2'} />
      ))}
    </>
  );
}

// Helper to get Battle Master maneuvers data from classes.json
function getBattleMasterManeuvers(): Maneuver[] {
  const fighter = (classesData as any).classes?.find((c: any) => c.id === 'fighter');
  const battleMaster = fighter?.subclasses?.find((s: any) => s.id === 'battle_master');
  return battleMaster?.maneuvers || [];
}

// Timing label translations
const TIMING_LABELS: Record<string, string> = {
  'attack_action': '攻击动作',
  'attack_hit': '命中时',
  'reaction': '反应',
  'bonus_action': '附赠动作',
  'creature_miss': '敌人未命中时',
};

// ManeuversSection - Battle Master maneuvers (shown in attack sub-menu)
function ManeuversSection({
  maneuversData,
  maneuverDC,
  sourceTokenId,
  targetTokenId,
  pendingManeuver,
  onManeuverAction,
  onCancelManeuver,
  onClose
}: {
  maneuversData: {
    superiority_dice: { current: number; max: number; die: string };
    maneuvers_known: string[];
  };
  maneuverDC?: number;
  sourceTokenId: number;
  targetTokenId?: number;
  pendingManeuver?: { maneuver: Maneuver; targetTokenId?: number } | null;
  onManeuverAction: (maneuver: Maneuver, sourceTokenId: number, targetTokenId?: number) => void;
  onCancelManeuver?: (sourceTokenId: number) => void;
  onClose: () => void;
}) {
  const [showManeuvers, setShowManeuvers] = useState(true);
  const allManeuvers = getBattleMasterManeuvers();

  // Filter to only known maneuvers
  const knownManeuvers = allManeuvers.filter(m => maneuversData.maneuvers_known.includes(m.id));

  if (knownManeuvers.length === 0) return null;

  const { superiority_dice } = maneuversData;
  const hasNoDice = superiority_dice.current <= 0;

  // Get timing description for pending maneuver
  const getTimingDescription = (timing: string) => {
    const descriptions: Record<string, string> = {
      on_hit: '攻击命中时触发',
      on_attack: '发起攻击时触发',
      on_attack_roll: '攻击骰时触发',
      on_move: '移动时触发',
      reaction_on_hit: '被命中时触发',
      reaction_on_miss: '敌人未命中时触发',
    };
    return descriptions[timing] || '触发时生效';
  };

  return (
    <>
      {/* Pending maneuver display */}
      {pendingManeuver && (
        <div className="px-3 py-2 bg-amber-900/30 border-l-2 border-amber-500">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-amber-500">⚔️</span>
              <span className="text-amber-400 font-medium text-sm">准备中：{pendingManeuver.maneuver.name}</span>
            </div>
            {onCancelManeuver && (
              <button
                onClick={() => { onCancelManeuver(sourceTokenId); onClose(); }}
                className="text-xs text-red-400 hover:text-red-300 px-2 py-0.5 rounded bg-red-900/30 hover:bg-red-900/50"
              >
                取消
              </button>
            )}
          </div>
          <div className="text-xs text-amber-500/70 mt-1">
            {getTimingDescription(pendingManeuver.maneuver.timing)}
          </div>
        </div>
      )}

      <div
        className="px-3 py-1.5 flex items-center gap-2 text-xs bg-purple-900/20 cursor-pointer hover:bg-purple-900/30"
        onClick={() => setShowManeuvers(!showManeuvers)}
      >
        <span className="flex-1 text-purple-400 font-medium">战技</span>
        <span className={`text-xs ${hasNoDice ? 'text-red-400' : 'text-purple-400'}`}>
          🎲 {superiority_dice.current}/{superiority_dice.max} {superiority_dice.die}
        </span>
        <span className="text-purple-500">{showManeuvers ? '▼' : '▶'}</span>
      </div>

      {showManeuvers && knownManeuvers.map(maneuver => (
        <ManeuverItem
          key={maneuver.id}
          maneuver={maneuver}
          maneuverDC={maneuverDC}
          disabled={hasNoDice || !!pendingManeuver}
          isPending={pendingManeuver?.maneuver.id === maneuver.id}
          onClick={() => { onManeuverAction(maneuver, sourceTokenId, targetTokenId); onClose(); }}
        />
      ))}
    </>
  );
}

// ManeuverItem - single maneuver option
function ManeuverItem({
  maneuver,
  maneuverDC,
  disabled,
  isPending,
  onClick
}: {
  maneuver: Maneuver;
  maneuverDC?: number;
  disabled: boolean;
  isPending?: boolean;
  onClick: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  const timingLabel = TIMING_LABELS[maneuver.timing] || maneuver.timing;
  const ABILITY_NAMES: Record<string, string> = {
    strength: '力量', dexterity: '敏捷', constitution: '体质',
    intelligence: '智力', wisdom: '感知', charisma: '魅力',
  };

  return (
    <div className="relative">
      <div className={`flex items-center px-4 py-1.5 ${isPending ? 'bg-amber-900/20 text-amber-400' : disabled ? 'text-gray-500 cursor-not-allowed' : 'hover:bg-purple-900/30 text-gray-200 cursor-pointer'}`}>
        <div
          className={`flex-1 flex items-center gap-2 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          onClick={disabled ? undefined : onClick}
        >
          <span className="w-5 text-center text-sm">{isPending ? '✓' : '⚔️'}</span>
          <span className="flex-1 text-sm truncate">{maneuver.name}</span>
          <span className="text-xs text-purple-400">{timingLabel}</span>
          {maneuver.save && maneuverDC && (
            <span className="text-xs text-yellow-400">DC{maneuverDC}</span>
          )}
        </div>
        <button
          className="ml-1 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-600 rounded text-xs"
          onClick={(e) => {
            e.stopPropagation();
            setShowDetails(!showDetails);
          }}
        >
          ?
        </button>
      </div>

      {showDetails && (
        <div className="px-4 py-2 bg-gray-900/50 text-xs">
          <div className="text-purple-300 mb-1">{maneuver.nameEn}</div>
          <div className="text-gray-300 whitespace-pre-wrap">{maneuver.description}</div>
          {maneuver.save && (
            <div className="text-yellow-300 mt-1">
              豁免: {maneuverDC ? `DC ${maneuverDC}` : 'DC ?'} {ABILITY_NAMES[maneuver.save] || maneuver.save}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
