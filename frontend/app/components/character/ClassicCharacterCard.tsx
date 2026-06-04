/**
 * ClassicCharacterCard - D&D 5E Classic Parchment Style Character Sheet
 * Inspired by traditional pen-and-paper character sheets
 */
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { StatusEffectsDialog, type CustomStatusEffect, type ConditionWithDuration, type Duration, type SpecialBuffs, PERMANENT_DURATION, SHORT_REST_ROUNDS, LONG_REST_ROUNDS, migrateConditions, migrateCustomEffects, migrateDuration } from "./StatusEffectsDialog";
import { CONDITION_NAMES } from "~/types/effects";
import "~/styles/classic-character-card.css";
import skillsData from "~/data/rules/skills.json";
import racesData from "~/data/rules/races.json";
import classesData from "~/data/rules/classes_with_structured_subclass_features.json";
import classesProgressionData from "~/data/rules/classes-progression.json";
import backgroundsData from "~/data/rules/backgrounds.json";
import xpThresholds from "~/data/rules/xp-thresholds.json";
import godsData from "~/data/rules/gods.json";
import companionsData from "~/data/rules/companions.json";
import invocationsData from "~/data/rules/eldritch_invocations.json";
import featsData from "~/data/rules/feats.json";
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import classResourcesData from "~/data/rules/class_resources.json";
import { formatAlignment, formatFavoredEnemy, formatFavoredTerrain, formatHumanoid, formatFightingStyle, formatEldritchInvocation, formatMetamagic, doesTerrainMatch } from "./CharacterDisplay/utils/formatting";
import type { Character, AbilityScores } from "./CharacterDisplay/types/Character";
import type { Spell } from "./CharacterDisplay/types/Spell";
import type { SpellcastingInfo } from "~/hooks/useCharacterSpellcasting";
import { abilityModNumber } from "./CharacterDisplay/utils/ability";
import { computeAll as computeDerivedAll, getAbilityScoreBreakdown, getACBreakdown, getHPBreakdown } from "./CharacterDisplay/utils/derived";
import { getFeatPassiveBonuses, getFeatProficiencyGrants, getFeatCombatLabels, getFeatRuleOverrides, ADVANTAGE_LABELS } from "./CharacterDisplay/utils/featEffects";
import { StatBreakdownDialog, type StatBreakdownData } from "./CharacterDisplay/sections/Info/StatBreakdownDialog";
import { RaceInfoDialog } from "./CharacterDisplay/sections/Info/RaceInfoDialog";
import { ClassInfoDialog } from "./CharacterDisplay/sections/Info/ClassInfoDialog";
import { BackgroundInfoDialog } from "./CharacterDisplay/sections/Info/BackgroundInfoDialog";
import { AlignmentInfoDialog } from "./CharacterDisplay/sections/Info/AlignmentInfoDialog";
import { DeityInfoDialog } from "./CharacterDisplay/sections/Info/DeityInfoDialog";
import { getSpellSchoolConfig, SpellAttributeTooltip } from "~/components/ui/Rules_SpellDetail";
import { UnifiedSpellCastDialog } from "~/components/spell/UnifiedSpellCastDialog";
import type { SpellCastData } from "~/components/spell/SpellCastActions";
import { SPELL_BUFF_EFFECTS } from "~/components/spell/spell-constants";
import { applyCharacterSpellModifiers } from "~/utils/spellModifiers";
import { castSpellAction, findCharacterToken } from "~/utils/sidebarCasting";
import { getIconPath, findAnyMetaByKey, findArmorMetaById, findWeaponMetaById, getWeaponGroupAndType } from "./CharacterDisplay/utils/rules";
import { getEquipmentSummary, isTwoHandedWeapon, isVersatileWeapon } from "./CharacterDisplay/utils/equipment";
import { checkArmorProficiencyPenalty, checkWeaponProficiency } from "./CharacterDisplay/utils/proficiency";
import { getConsumableData } from "./CharacterDisplay/utils/consumableUtils";
import { calculateFlyingSpeed, hasStormbornFeature, isStormbornEnvironmentActive } from "./CharacterDisplay/utils/speed";
import { getAssetUrl } from "~/utils/asset-url";
import { apiFetch } from "~/utils/api-client";
import { advanceSpecialBuffDurations } from "~/utils/specialBuffs";
import type { EquipmentItem, EquipSlot } from "./CharacterDisplay/types/Character";
import { EquippedItemMenu } from "./CharacterDisplay/sections/Equipment/EquippedItemMenu";
import { ItemInfoModal } from "./CharacterDisplay/sections/Equipment/ItemInfoModal";
import { FeatureDetailDialog, type FeatureResourceInfo } from "~/components/shared/FeatureDetailDialog";
import { showCharacterBubble } from "~/utils/characterBubble";
import type { WorldTime } from "~/utils/timeUtils";

// Resource → spell sound file mapping
const RESOURCE_SOUND_MAP: Record<string, string> = {
  rage: 'enhance_cast.mp3',
  bardic_inspiration: 'inspire_cast.mp3',
  channel_divinity_cleric: 'radiant_cast.mp3',
  wild_shape: 'summon_cast.mp3',
  second_wind: 'heal_cast.mp3',
  action_surge: 'enhance_cast.mp3',
  superiority_dice: 'force_cast.mp3',
  ki: 'enhance_cast.mp3',
  divine_sense: 'radiant_cast.mp3',
  lay_on_hands: 'heal_cast.mp3',
  channel_divinity_paladin: 'radiant_cast.mp3',
  sorcery_points: 'magic_cast.mp3',
  arcane_recovery: 'magic_cast.mp3',
  portent: 'psychic_cast.mp3',
  arcane_ward: 'shield_cast.mp3',
  tides_of_chaos: 'magic_cast.mp3',
  natural_recovery: 'magic_cast.mp3',
  shadow_arts: 'necrotic_cast.mp3',
  elemental_disciplines: 'zone_cast.mp3',
  inv_thief_of_five_fates: 'necrotic_cast.mp3',
  inv_mire_the_mind: 'psychic_cast.mp3',
  inv_sign_of_ill_omen: 'necrotic_cast.mp3',
  inv_bewitching_whispers: 'psychic_cast.mp3',
  inv_dreadful_word: 'psychic_cast.mp3',
  inv_sculptor_of_flesh: 'magic_cast.mp3',
  inv_minions_of_chaos: 'summon_cast.mp3',
  lucky_feat: 'magic_cast.mp3',
  magic_initiate_spell: 'magic_cast.mp3',
  martial_adept_die: 'force_cast.mp3',
  healer_treat: 'heal_cast.mp3',
  inspiring_leader_speech: 'inspire_cast.mp3',
};

function playResourceSound(resourceId: string) {
  const file = RESOURCE_SOUND_MAP[resourceId] || 'magic_cast.mp3';
  const url = getAssetUrl(`sounds/spells/${file}`);
  const audio = new Audio(url);
  audio.volume = 0.5;
  audio.play().catch(() => {});
}

function findResourceExecution(resourceId?: string) {
  if (!resourceId) return null;
  const abilities = ((classResourcesData as any).resourceAbilities || []) as Array<Record<string, any>>;
  return abilities.find((ability) => ability.resourceId === resourceId)?.execution || null;
}

// Transformation data type (wild shape / polymorph)
interface TransformationData {
  beast_name: string;
  beast_name_en: string;
  size: string;
  max_hp: number;
  current_hp: number;
  ac: number;
  avatar?: string;
  speed: { walk?: number; fly?: number; swim?: number; climb?: number };
  ability_scores?: {
    str: number; strMod: number;
    dex: number; dexMod: number;
    con: number; conMod: number;
  };
  actions?: Array<{ name: string; description: string }>;
  special_abilities?: Array<{ name: string; description: string }>;
}

// Resource data from /characters/{id}/resources
interface ClassResourceData {
  id: string;
  name: string;
  nameEn: string;
  current: number;
  max: number;
  maxFormula: string;
  currentRechargeType?: string;
  minLevel: number;
  featId?: string;
  description?: string;
}

interface ClassicCharacterCardProps {
  character: Character;
  campaignId?: string;
  currentMapUrl?: string | null;
  userId?: string;
  isDM?: boolean;
  classResources?: ClassResourceData[];
  onResourceChanged?: () => void;
  onOpenSpells?: () => void;
  onOpenFeatures?: () => void;
  onOpenEquipment?: (slot?: EquipSlot) => void;
  onOpenBag?: () => void;
  onAvatarClick?: () => void;
  onLevelUp?: () => void;
  /** Enter targeting mode for an ability (e.g., lay_on_hands) */
  onStartAbilityTargeting?: (abilityId: string, poolCurrent: number, poolMax: number) => void;
  /** Enter targeting mode for divine smite with spell slot level */
  onStartSmiteTargeting?: (abilityId: string, spellSlotLevel: number) => void;
  /** Trigger breath weapon AoE targeting mode */
  onUseBreathWeapon?: (params: {
    breathWeapon: { shape: string; size: string; save: string; saveCn: string; shapeCn: string };
    damageType: string;
    damageTypeCn: string;
    damageDice: string;
    subraceName: string;
    saveDC: number;
  }) => void;
  // Spellcasting props
  isSpellcaster?: boolean;
  spellsAll?: Spell[];
  cantripsLocal?: string[];
  preparedLocal?: string[];
  spellcasting?: SpellcastingInfo | null;
  remainingSlots?: number[];
  /** Parent already updates slot state optimistically; skip local optimistic consume handling. */
  slotStateManagedByParent?: boolean;
  onConsumeSlot?: (level: number) => void;
  onSetSlot?: (level: number, value: number) => void;
  onCastSpell?: (data: SpellCastData) => void;
  castingSpellName?: string | null;
  // Wild Shape data (when transformed)
  wildShapeData?: TransformationData | null;
  // Temporary HP from spell buffs
  tempHP?: number | null;
  // Companion summon callback
  onSummonCompanion?: () => void;
  onDismissCompanion?: () => void;
  isCompanionOnMap?: boolean;
  // Spell expand state persistence
  spellExpandedLevels?: Set<number>;
  onToggleSpellLevel?: (level: number) => void;
  /** Override status effects button to open floating panel */
  onOpenStatusEffects?: () => void;
  /** 浮动面板状态 tab 是否激活（为 true 时渲染嵌入式 StatusEffectsDialog） */
  floatingStatusActive?: boolean;
  /** Portal 目标容器（浮动面板中的 status tab 容器） */
  floatingStatusContainer?: HTMLDivElement | null;
  /** 全局地形，用于自动匹配地形增益 */
  globalTerrain?: string | null;
  /** 当前战役世界时间，用于实时隐藏已到期状态 */
  currentWorldTime?: WorldTime;
}

const ABILITY_LABELS: Record<string, string> = {
  strength: "力量",
  dexterity: "敏捷",
  constitution: "体质",
  intelligence: "智力",
  wisdom: "感知",
  charisma: "魅力",
};

const ABILITY_SHORT: Record<string, string> = {
  strength: "力",
  dexterity: "敏",
  constitution: "体",
  intelligence: "智",
  wisdom: "感",
  charisma: "魅",
};

const SKILL_ABILITY_MAP: Record<string, keyof AbilityScores> = {
  athletics: "strength",
  acrobatics: "dexterity",
  sleight_of_hand: "dexterity",
  stealth: "dexterity",
  arcana: "intelligence",
  history: "intelligence",
  investigation: "intelligence",
  nature: "intelligence",
  religion: "intelligence",
  animal_handling: "wisdom",
  insight: "wisdom",
  medicine: "wisdom",
  perception: "wisdom",
  survival: "wisdom",
  deception: "charisma",
  intimidation: "charisma",
  performance: "charisma",
  persuasion: "charisma",
};

const ALIGNMENT_NAMES: Record<string, string> = {
  "LG": "守序善良",
  "NG": "中立善良",
  "CG": "混乱善良",
  "LN": "守序中立",
  "N": "绝对中立",
  "CN": "混乱中立",
  "LE": "守序邪恶",
  "NE": "中立邪恶",
  "CE": "混乱邪恶"
};

// Helper to get deity Chinese name by ID
const getDeityName = (deityId: string): string => {
  for (const pantheon of (godsData as any).pantheons) {
    const deity = pantheon.deities?.find((d: any) => d.id === deityId);
    if (deity) return deity.name;
  }
  return deityId;
};

// Spell Section Component with collapsible spell levels
interface SpellSectionProps {
  spellsAll: Spell[];
  cantripsLocal: string[];
  preparedLocal: string[];
  spellcasting?: SpellcastingInfo | null;
  remainingSlots: number[];
  slotStateManagedByParent?: boolean;
  characterId?: number;
  campaignId?: string;
  currentMapUrl?: string | null;
  userId?: string;
  isDM?: boolean;
  onOpenSpells?: () => void;
  onConsumeSlot?: (level: number) => void;
  onSetSlot?: (level: number, value: number) => void;
  onCastSpell?: (data: SpellCastData) => void;
  eldritchInvocations?: string[];
  charismaMod?: number;
  subclassId?: string;
  expandedLevels?: Set<number>;
  onToggleSpellLevel?: (level: number) => void;
  concentrationSpellName?: string | null;
  concentrationSpellId?: string | null;
  castingSpellName?: string | null;
  equipment?: EquipmentItem[];
  hasSomaticFreedom?: boolean;
}

function resolveConsumedSpellSlotLevel(
  level: number,
  maxSlots: number[] | undefined,
): number {
  if (level <= 0 || level >= 10) return level;
  if (!Array.isArray(maxSlots) || maxSlots.length === 0) return level;
  if ((maxSlots[level] ?? 0) > 0) return level;
  for (let index = level + 1; index <= 9; index += 1) {
    if ((maxSlots[index] ?? 0) > 0) return index;
  }
  return level;
}

function SpellSection({
  spellsAll,
  cantripsLocal,
  preparedLocal,
  spellcasting,
  remainingSlots,
  slotStateManagedByParent = false,
  characterId,
  campaignId,
  currentMapUrl,
  userId,
  isDM,
  onOpenSpells,
  onConsumeSlot,
  onSetSlot,
  onCastSpell,
  eldritchInvocations,
  charismaMod,
  subclassId,
  expandedLevels: expandedLevelsProp,
  onToggleSpellLevel,
  concentrationSpellName,
  concentrationSpellId,
  castingSpellName,
  equipment,
  hasSomaticFreedom,
}: SpellSectionProps) {
  // Fallback to local state if no persisted state provided
  const [localExpandedLevels, setLocalExpandedLevels] = useState<Set<number>>(new Set([0, 1]));
  const expandedLevels = expandedLevelsProp ?? localExpandedLevels;
  const [selectedSpell, setSelectedSpell] = useState<Spell | null>(null);
  const [selectedCastLevel, setSelectedCastLevel] = useState<number>(0);
  const [editingSlotLevel, setEditingSlotLevel] = useState<number | null>(null);
  // Optimistic slot overrides: show new value immediately before refetch completes
  const [optimisticSlots, setOptimisticSlots] = useState<Record<number, number>>({});
  const prevSlotsRef = useRef(remainingSlots);
  if (prevSlotsRef.current !== remainingSlots) {
    prevSlotsRef.current = remainingSlots;
    if (Object.keys(optimisticSlots).length > 0) setOptimisticSlots({});
  }
  const getRemaining = (level: number) =>
    level in optimisticSlots ? optimisticSlots[level] : (remainingSlots[level] ?? 0);

  useEffect(() => {
    if (slotStateManagedByParent || !characterId) return;
    if (!characterId) return;
    return subscribeAppEvent("consumeSpellSlot", ({ level, characterId: eventCharacterId }) => {
      if (String(eventCharacterId) !== String(characterId) || typeof level !== "number" || level <= 0) {
        return;
      }
      const effectiveLevel = resolveConsumedSpellSlotLevel(level, spellcasting?.spellSlots);
      setOptimisticSlots((prev) => {
        const maxForLevel = spellcasting?.spellSlots?.[effectiveLevel] ?? 0;
        const current =
          prev[effectiveLevel]
          ?? remainingSlots[effectiveLevel]
          ?? maxForLevel;
        if (current <= 0) {
          return prev;
        }
        return {
          ...prev,
          [effectiveLevel]: current - 1,
        };
      });
    });
  }, [characterId, remainingSlots, slotStateManagedByParent, spellcasting?.spellSlots]);

  // Universal cast handler: use onCastSpell prop if provided, else castSpellAction
  const doCast = useCallback((castData: SpellCastData) => {
    if (onCastSpell) {
      onCastSpell(castData);
    } else if (characterId) {
      castSpellAction(castData.spell, castData.level, characterId, {
        campaignId, currentMapUrl, userId,
        spellSaveDC: spellcasting?.spellSaveDC ?? undefined,
        illusionImageUrl: castData.illusionData?.imageUrl,
        illusionDesc: castData.illusionData?.description,
        illusionDisplayName: castData.illusionData?.displayName,
        areaSize: castData.areaSize,
        freecast: castData.freecast,
        ritualCast: castData.ritualCast,
        confirmBreakConcentration: castData.confirmBreakConcentration,
        selectedOption: castData.selectedOption,
        materialId: castData.materialId,
        targetingMode: castData.targetingMode,
      });
    }
    setSelectedSpell(null);
  }, [onCastSpell, characterId, campaignId, currentMapUrl, userId, spellcasting?.spellSaveDC]);

  const toggleLevel = (level: number) => {
    if (onToggleSpellLevel) {
      onToggleSpellLevel(level);
    } else {
      setLocalExpandedLevels(prev => {
        const next = new Set(prev);
        if (next.has(level)) next.delete(level);
        else next.add(level);
        return next;
      });
    }
  };

  const openSpellDetail = (spellId: string) => {
    const spell = spellsAll.find(s => s.id === spellId);
    if (spell) {
      setSelectedSpell(spell);
      setSelectedCastLevel((spell as any).level ?? 0);
    }
  };

  // Normalize spell data is now handled by normalizeSpellData from spell module

  // 邪术师契约位等级（所有法术位共享同一等级）
  const pactSlotLevel = useMemo(() => {
    if (spellcasting?.type !== 'pact') return null;
    for (let i = 9; i >= 1; i--) {
      if ((spellcasting.spellSlots[i] ?? 0) > 0) return i;
    }
    return null;
  }, [spellcasting]);

  // 按环数分组法术（邪术师：所有有环法术归到契约位等级）
  const spellsByLevel = useMemo(() => {
    const groups: Record<number, { id: string; name: string; level: number; iconPath?: string; school?: string }[]> = {};
    cantripsLocal.forEach(spellId => {
      const spell = spellsAll.find(s => s.id === spellId) as any;
      if (spell) {
        if (!groups[0]) groups[0] = [];
        groups[0].push({ id: spellId, name: spell.name, level: 0, iconPath: spell.iconPath, school: spell.school });
      }
    });
    preparedLocal.forEach(spellId => {
      const spell = spellsAll.find(s => s.id === spellId) as any;
      if (spell) {
        const level = spell.level ?? 1;
        if (level > 0) {
          // 邪术师：所有有环法术归到契约位等级
          const groupLevel = pactSlotLevel ?? level;
          if (!groups[groupLevel]) groups[groupLevel] = [];
          groups[groupLevel].push({ id: spellId, name: spell.name, level, iconPath: spell.iconPath, school: spell.school });
        }
      }
    });
    return groups;
  }, [cantripsLocal, preparedLocal, spellsAll, pactSlotLevel]);

  const sortedLevels = Object.keys(spellsByLevel).map(Number).sort((a, b) => a - b);

  return (
    <div className="mt-1.5 pt-1.5 border-t border-gray-700/30">
      {/* Header */}
      <div className="section-header !text-[9px] !mb-1 !pb-0.5 text-center">法术</div>

      {/* Spell Book Button */}
      <button
        onClick={onOpenSpells}
        className="w-full flex items-center justify-center gap-1 py-1 px-2 rounded border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 hover:border-amber-500/50 transition-colors text-[9px] text-amber-400 mb-1"
      >
        ✨ 法术书
      </button>

      {/* Spellcasting Stats */}
      {spellcasting && (() => {
        const modVal = spellcasting.abilityMod;
        const modStr = modVal >= 0 ? `+${modVal}` : `${modVal}`;
        const profBonus = (spellcasting.spellSaveDC ?? 10) - 8 - modVal;
        return (
        <div className="grid grid-cols-3 gap-1 mb-1.5 text-center">
          <SpellAttributeTooltip attributeKey="spellcastingAbility">
            <div className="py-1 bg-gray-800/40 rounded border border-gray-700/30 cursor-help">
              <div className="text-[7px] text-gray-500 leading-none">属性</div>
              <div className="text-[10px] text-blue-400 font-medium">{spellcasting.abilityLabel}</div>
            </div>
          </SpellAttributeTooltip>
          <SpellAttributeTooltip attributeKey="spellSaveDC" extra={
            <div className="text-xs text-amber-300/80 font-mono">
              DC {spellcasting.spellSaveDC} = 8(基础) + {profBonus}(熟练) + {modStr}({spellcasting.abilityLabel})
            </div>
          }>
            <div className="py-1 bg-gray-800/40 rounded border border-gray-700/30 cursor-help">
              <div className="text-[7px] text-gray-500 leading-none">DC</div>
              <div className="text-[10px] text-amber-400 font-medium">{spellcasting.spellSaveDC}</div>
            </div>
          </SpellAttributeTooltip>
          <SpellAttributeTooltip attributeKey="spellAttackBonus" extra={
            <div className="text-xs text-amber-300/80 font-mono">
              {spellcasting.spellAttackStr} = {profBonus}(熟练) + {modStr}({spellcasting.abilityLabel})
            </div>
          }>
            <div className="py-1 bg-gray-800/40 rounded border border-gray-700/30 cursor-help">
              <div className="text-[7px] text-gray-500 leading-none">攻击</div>
              <div className="text-[10px] text-green-400 font-medium">{spellcasting.spellAttackStr}</div>
            </div>
          </SpellAttributeTooltip>
        </div>
        );
      })()}

      {/* Spells by Level - Collapsible */}
      <div className="space-y-0.5 max-h-[50vh] overflow-y-auto">
        {sortedLevels.map(level => {
          const spells = spellsByLevel[level] || [];
          const isExpanded = expandedLevels.has(level);
          const levelLabel = level === 0 ? '戏法' : (pactSlotLevel ? `${level}环 契约` : `${level}环`);

          return (
            <div key={level} className="rounded border border-gray-700/30 overflow-hidden">
              <div
                onClick={() => { if (editingSlotLevel === null) toggleLevel(level); }}
                className="w-full flex items-center justify-between px-1.5 py-0.5 bg-gray-800/40 hover:bg-gray-700/40 transition-colors cursor-pointer select-none"
              >
                <span className={`text-[9px] font-medium ${level === 0 ? 'text-purple-400' : 'text-amber-400'}`}>
                  {levelLabel} ({spells.length})
                  {level > 0 && spellcasting && (() => {
                    // 邪术师用契约位等级查法术位
                    const slotLv = pactSlotLevel ?? level;
                    const max = spellcasting.spellSlots[slotLv] || 0;
                    if (max <= 0) return null;
                    const remaining = slotLv in optimisticSlots ? optimisticSlots[slotLv] : (remainingSlots[slotLv] ?? max);
                    if (isDM && onSetSlot && editingSlotLevel === slotLv) {
                      return (
                        <span className="ml-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="number"
                            className="w-8 bg-gray-800 border border-amber-500/50 rounded px-0.5 text-[9px] text-gray-200 text-center outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            defaultValue={remaining}
                            min={0}
                            max={max}
                            autoFocus
                            onBlur={(e) => {
                              const v = Math.min(max, Math.max(0, parseInt(e.target.value, 10) || 0));
                              setOptimisticSlots(prev => ({ ...prev, [slotLv]: v }));
                              onSetSlot(slotLv, v);
                              setEditingSlotLevel(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const v = Math.min(max, Math.max(0, parseInt((e.target as HTMLInputElement).value, 10) || 0));
                                setOptimisticSlots(prev => ({ ...prev, [slotLv]: v }));
                                onSetSlot(slotLv, v);
                                setEditingSlotLevel(null);
                              }
                              if (e.key === 'Escape') setEditingSlotLevel(null);
                            }}
                          />
                          <span className="text-[8px] text-gray-500">/{max}</span>
                        </span>
                      );
                    }
                    return (
                      <span
                        className={`ml-1 text-[8px] font-normal ${remaining > 0 ? 'text-blue-400/70' : 'text-gray-500'} ${isDM && onSetSlot ? 'cursor-pointer hover:text-amber-300' : ''}`}
                        onClick={isDM && onSetSlot ? (e) => { e.stopPropagation(); setEditingSlotLevel(slotLv); } : undefined}
                        title={isDM ? '点击编辑法术位' : undefined}
                      >
                        [{remaining}/{max}]
                      </span>
                    );
                  })()}
                </span>
                <span className="text-gray-500 text-[8px]">{isExpanded ? '▼' : '▶'}</span>
              </div>
              {isExpanded && (
                <div className="px-1.5 py-0.5 bg-gray-900/20 space-y-0">
                  {spells.map(spell => {
                    const isConcentrating = !!(concentrationSpellId
                      ? spell.id === concentrationSpellId
                      : concentrationSpellName && spell.name === concentrationSpellName);
                    return (
                    <button
                      key={spell.id}
                      onClick={() => openSpellDetail(spell.id)}
                      className={`w-full text-left text-[9px] truncate py-0.5 cursor-pointer transition-colors flex items-center gap-1 rounded-sm px-0.5 ${
                        isConcentrating
                          ? 'text-yellow-200 bg-yellow-500/15 border border-yellow-500/30'
                          : 'text-gray-300 hover:text-amber-300'
                      }`}
                      title={isConcentrating ? `正在专注 ${spell.name}` : `点击查看 ${spell.name}`}
                    >
                      {isConcentrating && (
                        <span className="flex-shrink-0 text-yellow-400 text-[8px]">👁️</span>
                      )}
                      {spell.iconPath ? (
                        <img
                          src={getAssetUrl(spell.iconPath.replace(/^\//, ''))}
                          alt=""
                          className="w-3.5 h-3.5 rounded-sm object-cover flex-shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <span className={`flex-shrink-0 ${isConcentrating ? 'text-yellow-400' : level === 0 ? 'text-purple-400' : getSpellSchoolConfig(spell.school || '').color}`}>✦</span>
                      )}
                      <span className="truncate">{spell.name}</span>
                      {isConcentrating && (
                        <span className="flex-shrink-0 text-[7px] text-yellow-400/80 border border-yellow-500/30 rounded px-0.5">专注</span>
                      )}
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Spell Detail Modal - 卷轴风格 */}
      <UnifiedSpellCastDialog
        spell={selectedSpell}
        onClose={() => setSelectedSpell(null)}
        spellTransform={(s) => applyCharacterSpellModifiers(s, { eldritchInvocations, charismaMod, subclassId })}
        spellSlots={spellcasting?.spellSlots || []}
        remainingSlots={spellcasting ? Object.keys(remainingSlots).reduce((arr, k) => {
          arr[Number(k)] = getRemaining(Number(k));
          return arr;
        }, [...spellcasting.spellSlots]) : []}
        selectedCastLevel={selectedSpell && ((selectedSpell as any).level ?? 0) > 0 ? (pactSlotLevel || selectedCastLevel) : 0}
        onSelectCastLevel={setSelectedCastLevel}
        concentrationSpellName={concentrationSpellName}
        castingSpellName={castingSpellName}
        isWarlock={!!pactSlotLevel}
        equipment={equipment}
        hasSomaticFreedom={hasSomaticFreedom}
        onCast={(castData) => {
          const spellLevel = (selectedSpell as any)?.level ?? 0;
          const castLv = spellLevel > 0 ? (pactSlotLevel || selectedCastLevel) : 0;
          if (selectedSpell) doCast({ ...castData, level: castLv });
          else onConsumeSlot?.(castLv);
        }}
      />
    </div>
  );
}

export function ClassicCharacterCard({
  character,
  campaignId,
  currentMapUrl,
  userId,
  isDM,
  classResources,
  onResourceChanged,
  onOpenSpells,
  onOpenFeatures,
  onOpenEquipment,
  onOpenBag,
  onAvatarClick,
  onLevelUp,
  onStartAbilityTargeting,
  onStartSmiteTargeting,
  onUseBreathWeapon,
  isSpellcaster = false,
  spellsAll = [],
  cantripsLocal = [],
  preparedLocal = [],
  spellcasting,
  remainingSlots = [],
  slotStateManagedByParent = false,
  onConsumeSlot,
  onSetSlot,
  onCastSpell,
  castingSpellName,
  wildShapeData,
  tempHP,
  onSummonCompanion,
  onDismissCompanion,
  isCompanionOnMap = false,
  spellExpandedLevels,
  onToggleSpellLevel,
  onOpenStatusEffects,
  floatingStatusActive,
  floatingStatusContainer,
  globalTerrain,
  currentWorldTime,
}: ClassicCharacterCardProps) {
  // Get race, class, background data
  const race = useMemo(() =>
    (racesData as any).races?.find((r: any) => r.id === character.race_id),
    [character.race_id]
  );
  const subrace = useMemo(() =>
    race?.subraces?.find((s: any) => s.id === character.subrace_id),
    [race, character.subrace_id]
  );
  const charClass = useMemo(() =>
    (classesData as any).classes?.find((c: any) => c.id === character.class_id),
    [character.class_id]
  );
  const subclass = useMemo(() =>
    charClass?.subclasses?.find((s: any) => s.id === (character.subclass_id?.split(',')[0] || character.subclass_id)),
    [charClass, character.subclass_id]
  );
  // All selected subclasses (supports comma-separated IDs from multi-subclass debug mode)
  const allSubclasses = useMemo(() => {
    if (!charClass?.subclasses || !character.subclass_id) return [];
    const ids = character.subclass_id.split(',').filter(Boolean);
    return ids.map((id: string) => charClass.subclasses.find((s: any) => s.id === id)).filter(Boolean);
  }, [charClass, character.subclass_id]);
  const background = useMemo(() =>
    (backgroundsData as any).backgrounds?.find((b: any) => b.id === character.background_id),
    [character.background_id]
  );

  // Compute derived stats
  const derived = useMemo(() => computeDerivedAll(character, { hpOptions: { includeFlatSubraceHP: true, includeSubraceLevelBonuses: true } }), [character]);

  // Normalize feat IDs from LevelTrackedSelection[] to string[]
  const featIds = useMemo(() =>
    (character?.feats || []).map((f: any) => typeof f === 'string' ? f : f.value || f.id || '').filter(Boolean),
    [character?.feats]
  );

  const hasSomaticFreedom = useMemo(() => getFeatRuleOverrides(featIds).has('somatic_with_hands_full'), [featIds]);

  // Build class features list (filtered by level, skip ASI/subclass placeholders)
  const classFeatures = useMemo(() => {
    const level = character.level || 1;
    const features: Array<{ id?: string; name: string; nameEn: string; level: number; description: string; source?: string }> = [];
    const skipNames = new Set(["属性值提升", "Ability Score Improvement"]);

    // Main class features — cross-reference classes-progression.json for id
    const progClass = (classesProgressionData as any).classes?.[character.class_id];
    if (charClass?.features) {
      for (const f of charClass.features) {
        if (f.level > level) continue;
        if (skipNames.has(f.name) || skipNames.has(f.nameEn)) continue;
        // Skip subclass placeholder features (e.g. "原始道途特性")
        if (f.description && /选择你的|你获得所选/.test(f.description) && f.description.length < 30) continue;
        // Look up id from classes-progression.json
        const progLevel = progClass?.levelProgression?.[String(f.level)];
        const progFeat = progLevel?.features?.find((pf: any) => pf.nameEn === f.nameEn || pf.name === f.name);
        features.push({ id: progFeat?.id, name: f.name, nameEn: f.nameEn, level: f.level, description: f.description || '', source: charClass.name });
      }
    }
    // Subclass features — data may use array OR string summary format
    // Supports multiple subclasses (comma-separated IDs from debug mode)
    for (const sub of allSubclasses) {
      if (Array.isArray(sub.features)) {
        // Array format: direct feature objects
        for (const f of sub.features) {
          const fLevel = f.level || 1;
          if (fLevel > level) continue;
          features.push({ id: f.id, name: f.name, nameEn: f.nameEn || '', level: fLevel, description: f.description || '', source: sub.name });
        }
      } else if (typeof sub.features === 'string' && sub.features.trim()) {
        // String format: "特性名（N级）、特性名（N级）、..."
        // Parse and look up descriptions + id from classes-progression.json (reuse progClass)
        let progSubclass: any = null;
        if (progClass?.levelProgression) {
          for (const lvlData of Object.values(progClass.levelProgression) as any[]) {
            for (const feat of lvlData.features || []) {
              if (feat.type === 'subclass' && feat.choices) {
                const found = feat.choices.find((c: any) => c.id === sub.id);
                if (found) { progSubclass = found; break; }
              }
            }
            if (progSubclass) break;
          }
        }
        const featureMatches = sub.features.match(/([^、]+?（\d+级）)/g);
        if (featureMatches) {
          for (const match of featureMatches) {
            const m = match.match(/(.+?)（(\d+)级）/);
            if (!m) continue;
            const fName = m[1].trim();
            const fLevel = parseInt(m[2], 10);
            if (fLevel > level) continue;
            const progFeat = progSubclass?.features?.find((f: any) => f.name === fName && f.level === fLevel);
            features.push({ id: progFeat?.id, name: fName, nameEn: progFeat?.nameEn || '', level: fLevel, description: progFeat?.description || '', source: sub.name });
          }
        }
      } else {
        // Fallback: use level1Features
        for (const f of (sub.level1Features || [])) {
          const fLevel = f.level || 1;
          if (fLevel > level) continue;
          features.push({ id: f.id, name: f.name, nameEn: f.nameEn || '', level: fLevel, description: f.description || '', source: sub.name });
        }
      }
    }
    return features;
  }, [charClass, allSubclasses, character.level]);

  // Build racial traits list (only active abilities: innate spellcasting, damage, cantrips)
  const racialTraits = useMemo(() => {
    const level = character.level || 1;
    const isActiveAbility = (t: any): boolean => {
      if (t.spells?.length > 0) return true;
      if (t.damage?.length > 0) return true;
      if (t.cantrip) return true;
      if (t.cantripChoice) return true;
      return false;
    };
    const result: Array<{ name: string; nameEn: string; description: string; source: string; annotation?: string; spellIds?: string[] }> = [];

    const process = (list: any[], src: string) => {
      for (const t of list) {
        if (!isActiveAbility(t)) continue;
        let annotation: string | undefined;
        const spellIds: string[] = [];
        if (t.damage?.length) {
          let dice = t.damage[0].dice;
          for (const d of t.damage) { if (d.level <= level) dice = d.dice; }
          annotation = dice;
        }
        if (t.spells?.length) {
          for (const s of t.spells) {
            if (!s.minCharacterLevel || s.minCharacterLevel <= level) {
              if (s.name) spellIds.push(s.name);
            }
          }
        }
        if (t.cantrip) spellIds.push(t.cantrip);
        if (t.cantripChoice && character.race_choices?.cantrip) {
          spellIds.push(character.race_choices.cantrip);
        }
        // Enrich Breath Weapon description with subrace-specific details
        let desc = t.description || '';
        if (t.nameEn === 'Breath Weapon' && subrace?.breathWeapon) {
          const bw = subrace.breathWeapon;
          const dtCn = subrace.damageTypeCn || subrace.damageType || '';
          desc += `\n\n【${subrace.name}】${bw.shapeCn || bw.shape}（${bw.size}），${dtCn}伤害，${bw.saveCn || bw.save}豁免。`;
        }
        const uniqueSpellIds = [...new Set(spellIds)];
        result.push({ name: t.name, nameEn: t.nameEn || '', description: desc, source: src, annotation, spellIds: uniqueSpellIds.length > 0 ? uniqueSpellIds : undefined });
      }
    };

    if (race?.traits) process(race.traits, race.name);
    if (subrace?.traits) process(subrace.traits, subrace.name);
    return result;
  }, [race, subrace, character.level, character.race_choices]);

  // Map resource id → resource data for quick lookup
  const resourceMap = useMemo(() => {
    const map = new Map<string, ClassResourceData>();
    if (classResources) {
      for (const r of classResources) map.set(r.id, r);
    }
    return map;
  }, [classResources]);

  // Only show class features that have an active resource pool (not passive, not spell_slots)
  const activeClassFeatures = useMemo(() => {
    if (!classResources?.length) return [];
    return classFeatures.filter(feat => {
      const res = classResources.find(r => feat.id ? r.id === feat.id : (r.name === feat.name || r.nameEn === feat.nameEn));
      return res && res.maxFormula !== 'passive';
    });
  }, [classFeatures, classResources]);

  // Feat resources: resources with featId (lucky, magic_initiate, martial_adept)
  const activeFeatResources = useMemo(() => {
    if (!classResources?.length) return [];
    return classResources.filter(r => r.featId && r.maxFormula !== 'passive');
  }, [classResources]);

  // Passive feats (war_caster, tough, etc.) that have no resource counter
  const passiveFeats = useMemo(() => {
    const activeIds = new Set(activeFeatResources.map(r => r.featId));
    const allFeats = (featsData as any).feats || {};
    return featIds.filter(id => !activeIds.has(id) && allFeats[id]).map(id => allFeats[id]);
  }, [featIds, activeFeatResources]);

  // Activatable invocations (warlock only): invocations with grantedSpell
  const activatableInvocations = useMemo(() => {
    if (character.class_id !== 'warlock') return [];
    const charInvIds = ((character as any).eldritch_invocations || (character as any).eldritchInvocations || [])
      .map((v: any) => typeof v === 'string' ? v : v?.id || v?.value || '')
      .filter(Boolean);
    if (charInvIds.length === 0) return [];
    return invocationsData.invocations
      .filter(inv => charInvIds.includes(inv.id) && inv.grantedSpell)
      .map(inv => {
        const gs = inv.grantedSpell!;
        const isAtWill = gs.atWill === true;
        // Find matching resource from classResources for limited-use invocations
        const matchedResource = !isAtWill ? classResources?.find(r => r.id === `inv_${inv.id}`) : null;
        return { ...inv, isAtWill, matchedResource };
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.class_id, character, classResources]);

  // Invocation detail dialog state
  const [invDetailOpen, setInvDetailOpen] = useState(false);
  const [selectedInv, setSelectedInv] = useState<typeof activatableInvocations[number] | null>(null);

  // Stat breakdown dialog state
  const [statDialogOpen, setStatDialogOpen] = useState(false);
  const [statDialogData, setStatDialogData] = useState<StatBreakdownData | null>(null);

  // Character details modal state
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);

  // Info dialogs state
  const [raceInfoOpen, setRaceInfoOpen] = useState(false);
  const [classInfoOpen, setClassInfoOpen] = useState(false);
  const [backgroundInfoOpen, setBackgroundInfoOpen] = useState(false);
  const [alignmentInfoOpen, setAlignmentInfoOpen] = useState(false);
  const [deityInfoOpen, setDeityInfoOpen] = useState(false);
  const [statusEffectsOpen, setStatusEffectsOpen] = useState(false);
  const [concentrationSpell, setConcentrationSpell] = useState<{
    spell_id: string; spell_name: string; slot_level: number; duration_rounds?: number; current_round?: number; target_name?: string;
  } | null>(null);
  const [concentrationTokenId, setConcentrationTokenId] = useState<number | null>(null);
  const [runtimeSpellOverlays, setRuntimeSpellOverlays] = useState<any[]>([]);
  const [tokenActiveEffects, setTokenActiveEffects] = useState<any[]>([]);
  // Spell buffs on this character's token (from other casters)
  const [incomingSpellBuffs, setIncomingSpellBuffs] = useState<Array<{ id: string; name: string; icon: string; color: string; from_caster?: string }>>([]);

  // Aggregate spell buff bonuses from active spell buffs on token
  const spellBuffs = useMemo(() => {
    const r = { acBonus: 0, speedBonus: 0, attackBonus: 0 };
    for (const b of incomingSpellBuffs) {
      const sid = (b as any).spell_id || b.id.replace('spell_buff_', '');
      const e = (b as any).buff_effects || SPELL_BUFF_EFFECTS[sid];
      if (e) {
        if (e.acBonus) r.acBonus += e.acBonus;
        if (e.speedBonus) r.speedBonus += e.speedBonus;
        if (e.attackBonus) r.attackBonus += e.attackBonus;
        continue;
      }
      // Fallback: read modifiers directly from the active effect
      const AC_SET_SPELLS = ['mage_armor', 'barkskin'];
      for (const m of (b as any).modifiers || []) {
        const stat = m.stat || (m.target === 'incoming_attack' || m.target === 'ac' ? 'ac' : m.target);
        const val = Number(m.value) || 0;
        const isSet = m.operation === 'set' || m.operation === 'set_floor'
          || m.type === 'set_base' || m.type === 'set_floor' || AC_SET_SPELLS.includes(sid);
        // "set"/"set_floor" AC is handled in getACBreakdown; only aggregate "add" bonuses here
        if (stat === 'ac' && !isSet) r.acBonus += val;
        else if (stat === 'speed' && !isSet) r.speedBonus += val;
        else if (stat === 'attack_bonus' && !isSet) r.attackBonus += val;
      }
    }
    return r;
  }, [incomingSpellBuffs]);

  // Compute spell-aware AC (uses getACBreakdown with active spell effects)
  const spellAwareAC = useMemo(() => {
    return getACBreakdown(character, { activeSpellEffects: incomingSpellBuffs }).final;
  }, [character, incomingSpellBuffs]);
  const [equipMenuState, setEquipMenuState] = useState<{ x: number; y: number; slot: EquipSlot; item: EquipmentItem } | null>(null);
  const [equipDetailItem, setEquipDetailItem] = useState<EquipmentItem | null>(null);
  const [equipDetailOpen, setEquipDetailOpen] = useState(false);

  // Listen for concentration changes from map tokens
  useEffect(() => {
    const handler = (detail: {
      characterId?: number | string;
      tokenId?: number | string;
      concentrationSpell?: any;
    }) => {
      if (detail?.characterId === character.id) {
        setConcentrationSpell(detail.concentrationSpell || null);
        setConcentrationTokenId(typeof detail.tokenId === "number" ? detail.tokenId : null);
      }
    };
    return subscribeAppEvent('characterConcentrationChanged', handler);
  }, [character.id]);

  // Listen for active_effects changes on this character's token (WebSocket)
  useEffect(() => {
    const handler = ({
      characterId,
      activeEffects,
    }: {
      characterId?: number | string;
      activeEffects?: any[];
    }) => {
      if (characterId === character.id) {
        const effects = activeEffects || [];
        setTokenActiveEffects(effects);
        setIncomingSpellBuffs(effects.filter((e: any) => e.spell_buff));
      }
    };
    return subscribeAppEvent("characterActiveEffectsChanged", handler);
  }, [character.id]);

  // Fetch initial concentration state + spell buffs from token
  useEffect(() => {
    if (!campaignId || !currentMapUrl) return;
    findCharacterToken(character.id, campaignId, currentMapUrl, userId)
      .then(result => {
        setConcentrationSpell(result?.data?.concentration_spell || null);
        const effects = result?.data?.active_effects || [];
        setTokenActiveEffects(effects);
        setIncomingSpellBuffs(effects.filter((e: any) => e.spell_buff));
        setRuntimeSpellOverlays(result?.data?.spell_overlays || []);
      })
      .catch(() => {});
  }, [character.id, campaignId, currentMapUrl, userId]);
  const [featDetailOpen, setFeatDetailOpen] = useState(false);
  const [selectedFeat, setSelectedFeat] = useState<{ name: string; nameEn: string; level?: number; description: string; source?: string } | null>(null);
  const [selectedFeatSelection, setSelectedFeatSelection] = useState('');
  const [racialSpellDetail, setRacialSpellDetail] = useState<Spell | null>(null);

  // Initialize status effects from DB (character.status_effects)
  const savedStatus = character.status_effects as { custom_effects?: any[]; active_conditions?: unknown[]; exhaustion_level?: number; exhaustion_duration?: any; special_buffs?: SpecialBuffs } | null;
  const [customEffects, setCustomEffects] = useState<CustomStatusEffect[]>(() => migrateCustomEffects(savedStatus?.custom_effects));
  const [activeConditions, setActiveConditions] = useState<ConditionWithDuration[]>(() => migrateConditions(savedStatus?.active_conditions));
  const [exhaustionLevel, setExhaustionLevel] = useState(() => savedStatus?.exhaustion_level ?? 0);
  const [exhaustionDuration, setExhaustionDuration] = useState<Duration>(() => migrateDuration(savedStatus?.exhaustion_duration));
  const [specialBuffs, setSpecialBuffs] = useState<SpecialBuffs>(() => savedStatus?.special_buffs ?? {});

  // Sync from DB when character prop changes (e.g. after WebSocket update or refetch)
  const lastCharIdRef = useRef(character.id);
  const lastStatusRef = useRef(character.status_effects);
  useEffect(() => {
    const s = character.status_effects as typeof savedStatus;
    // Re-sync if character changed or if external update arrived
    if (character.id !== lastCharIdRef.current || character.status_effects !== lastStatusRef.current) {
      lastCharIdRef.current = character.id;
      lastStatusRef.current = character.status_effects;
      setCustomEffects(migrateCustomEffects(s?.custom_effects));
      setActiveConditions(migrateConditions(s?.active_conditions));
      setExhaustionLevel(s?.exhaustion_level ?? 0);
      setExhaustionDuration(migrateDuration(s?.exhaustion_duration));
      setSpecialBuffs(s?.special_buffs ?? {});
    }
  }, [character.id, character.status_effects]);

  // Check if character is incapacitated (can't take actions or reactions)
  const isIncapacitated = useMemo(() => {
    const INCAPACITATING = ['incapacitated', 'stunned', 'paralyzed', 'unconscious', 'petrified'];
    return activeConditions.some(c => INCAPACITATING.includes((c as any).condition || c));
  }, [activeConditions]);

  // Persist status effects to DB (debounced)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const companionSummoningRef = useRef(false);
  const [companionDetailOpen, setCompanionDetailOpen] = useState(false);
  const [familiarDetailOpen, setFamiliarDetailOpen] = useState(false);
  const [familiarPickOpen, setFamiliarPickOpen] = useState(false);
  const [familiarPickDetail, setFamiliarPickDetail] = useState<string | null>(null);
  const [familiarAvatarPreview, setFamiliarAvatarPreview] = useState<string | null>(null);
  const [localFamiliarForm, setLocalFamiliarForm] = useState<string | null>(null);

  // Independent familiar on-map tracking & summon/dismiss
  const activeFamiliarId = character.subclass_choices?.familiarForm || localFamiliarForm;
  const [familiarOnMap, setFamiliarOnMap] = useState(false);
  useEffect(() => {
    if (!activeFamiliarId || !currentMapUrl || !campaignId) { setFamiliarOnMap(false); return; }
    let cancelled = false;
    apiFetch(`/api/tokens/campaign/${campaignId}/map?map_url=${encodeURIComponent(currentMapUrl)}`)
      .then(async resp => {
        if (cancelled || !resp.ok) return;
        const data = await resp.json();
        const tokens: any[] = data.tokens || data;
        setFamiliarOnMap(tokens.some((t: any) => t.controller_character_id === character.id && t.control_type === 'familiar'));
      }).catch(() => {});
    const onRemoved = () => {
      if (!currentMapUrl || !campaignId) return;
      apiFetch(`/api/tokens/campaign/${campaignId}/map?map_url=${encodeURIComponent(currentMapUrl)}`)
        .then(async resp => {
          if (cancelled || !resp.ok) return;
          const data = await resp.json();
          const tokens: any[] = data.tokens || data;
          setFamiliarOnMap(tokens.some((t: any) => t.controller_character_id === character.id && t.control_type === 'familiar'));
        }).catch(() => {});
    };
    const unsubscribePlaced = subscribeAppEvent("tokenPlaced", (detail) => {
      const tk = detail?.token as any;
      if (tk?.controller_character_id === character.id && tk?.control_type === 'familiar') setFamiliarOnMap(true);
    });
    const unsubscribeRemoved = subscribeAppEvent("tokenRemoved", () => {
      onRemoved();
    });
    return () => {
      cancelled = true;
      unsubscribePlaced();
      unsubscribeRemoved();
    };
  }, [activeFamiliarId, currentMapUrl, campaignId, character.id]);

  const handleSummonFamiliar = useCallback(async () => {
    if (!currentMapUrl || !campaignId || companionSummoningRef.current) return;
    companionSummoningRef.current = true;
    try {
      const resp = await apiFetch('/api/monster-instances/summon-companion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_id: character.id, campaign_id: parseInt(campaignId as string), map_url: currentMapUrl }),
      });
      if (resp.ok) setFamiliarOnMap(true);
    } catch (e) { /* ignore */ }
    setTimeout(() => { companionSummoningRef.current = false; }, 2000);
  }, [character.id, campaignId, currentMapUrl]);

  const handleDismissFamiliar = useCallback(async () => {
    if (!currentMapUrl || !campaignId || companionSummoningRef.current) return;
    companionSummoningRef.current = true;
    try {
      const resp = await apiFetch('/api/monster-instances/dismiss-companion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_id: character.id, campaign_id: parseInt(campaignId as string), map_url: currentMapUrl }),
      });
      if (resp.ok) setFamiliarOnMap(false);
    } catch (e) { /* ignore */ }
    setTimeout(() => { companionSummoningRef.current = false; }, 2000);
  }, [character.id, campaignId, currentMapUrl]);
  const [editingXP, setEditingXP] = useState(false);
  const [editXPValue, setEditXPValue] = useState('');
  const [optimisticXP, setOptimisticXP] = useState<number | null>(null);
  // Reset optimistic XP when character data changes (refetch arrived)
  const prevXPRef = useRef(character.experience_points);
  if (prevXPRef.current !== character.experience_points) {
    prevXPRef.current = character.experience_points;
    if (optimisticXP !== null) setOptimisticXP(null);
  }
  const persistStatusEffects = useCallback((
    effects: CustomStatusEffect[],
    conditions: ConditionWithDuration[],
    exhaustion: number,
    exhDuration?: Duration,
    buffs?: SpecialBuffs,
  ) => {
    const payload = {
      status_effects: {
        custom_effects: effects,
        active_conditions: conditions,
        exhaustion_level: exhaustion,
        exhaustion_duration: exhDuration,
        special_buffs: buffs,
      },
      broadcast_campaign_id: campaignId || undefined,
    };
    clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(async () => {
      try {
        await apiFetch(`/api/characters/${character.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch { /* silent */ }
    }, 300);
  }, [character.id, campaignId]);

  // Auto-match terrain: ranger favored_terrain & druid circle of the land
  const prevGlobalTerrainRef = useRef(globalTerrain);
  useEffect(() => {
    if (globalTerrain === prevGlobalTerrainRef.current) return;
    prevGlobalTerrainRef.current = globalTerrain;

    const rangerTerrain = (character as any).favored_terrain || (character as any).favoredTerrain;
    const rt = typeof rangerTerrain === 'string' ? rangerTerrain : rangerTerrain?.value;
    const druidTerrain = (character as any).subclass_choices?.landType || (character as any).subclassChoices?.landType;

    let changed = false;
    const next = { ...specialBuffs };

    if (rt) {
      const shouldActive = doesTerrainMatch(rt, globalTerrain);
      if (next.favored_terrain_active !== shouldActive) {
        next.favored_terrain_active = shouldActive;
        changed = true;
      }
    }
    if (druidTerrain) {
      const shouldActive = doesTerrainMatch(druidTerrain, globalTerrain);
      if (next.circle_land_terrain_active !== shouldActive) {
        next.circle_land_terrain_active = shouldActive;
        changed = true;
      }
    }

    if (changed) {
      setSpecialBuffs(next);
      persistStatusEffects(customEffects, activeConditions, exhaustionLevel, exhaustionDuration, next);
    }
  }, [globalTerrain]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Unified time advance: advance round (-1), short rest (-600), long rest (-4800 + exhaustion -1) */
  const advanceTime = (rounds: number, exhaustionReduction = 0) => {
    const decrement = (dur: Duration | undefined) =>
      dur && dur.type !== 'permanent' ? { ...dur, remaining: dur.remaining - rounds } : dur;
    const alive = (dur: Duration | undefined) =>
      !dur || dur.type === 'permanent' || dur.remaining > 0;

    const nextEffects = customEffects.map(e => ({ ...e, duration: decrement(e.duration)! })).filter(e => alive(e.duration));
    setCustomEffects(nextEffects);
    const nextConditions = activeConditions.map(c => ({ ...c, duration: decrement(c.duration)! })).filter(c => alive(c.duration));
    setActiveConditions(nextConditions);

    let nextExhLv = exhaustionLevel;
    let nextExhDur = exhaustionDuration;
    if (nextExhDur?.type !== 'permanent' && nextExhDur?.remaining > 0) {
      nextExhDur = { ...nextExhDur, remaining: nextExhDur.remaining - rounds };
      if (nextExhDur.remaining <= 0) { nextExhLv = 0; nextExhDur = { ...PERMANENT_DURATION }; }
    }
    if (exhaustionReduction > 0 && nextExhLv > 0) {
      nextExhLv = Math.max(0, nextExhLv - exhaustionReduction);
      if (nextExhLv === 0) nextExhDur = { ...PERMANENT_DURATION };
    }
    setExhaustionLevel(nextExhLv);
    setExhaustionDuration(nextExhDur);
    const nextBuffs = advanceSpecialBuffDurations(specialBuffs, rounds) as SpecialBuffs;
    setSpecialBuffs(nextBuffs);
    persistStatusEffects(nextEffects, nextConditions, nextExhLv, nextExhDur, nextBuffs);
  };

  // Sum custom effect modifiers for a given param (only 'bonus' type; also checks "all_saves"/"all_checks")
  const getEffectMod = (param: string) => {
    let total = 0;
    for (const e of customEffects) {
      for (const m of e.modifiers) {
        if (m.type === 'advantage' || m.type === 'disadvantage') continue;
        if (m.param === param) total += m.value;
        if (m.param === 'all_saves' && param.endsWith('_save')) total += m.value;
        if (m.param === 'all_checks' && !['ac','hp_max','attack','damage','speed','initiative'].includes(param) && !param.endsWith('_save')) total += m.value;
      }
    }
    return total;
  };

  // D&D 5E exhaustion & condition mechanical effects
  const activeConditionTypes = activeConditions.map(c => c.condition);
  const speedZeroConditions: string[] = ['paralyzed', 'petrified', 'unconscious', 'grappled', 'restrained', 'stunned'];
  const isSpeedZero = exhaustionLevel >= 5 || speedZeroConditions.some(c => activeConditionTypes.includes(c as any));
  const isProne = activeConditionTypes.includes('prone' as any);
  const isSpeedHalved = !isSpeedZero && (exhaustionLevel >= 2 || isProne);

  // Proficiency warnings for status effects dialog
  const proficiencyWarnings = useMemo(() => {
    const warnings: { label: string; desc: string }[] = [];
    const armorPenalty = checkArmorProficiencyPenalty(character);
    const weaponProf = checkWeaponProficiency(character);
    for (const item of armorPenalty.nonProficientItems) {
      const meta = findArmorMetaById(item.id);
      const tierLabel = meta?.tier === 'light' ? '轻甲' : meta?.tier === 'medium' ? '中甲' : meta?.tier === 'heavy' ? '重甲' : meta?.tier === 'shield' ? '盾牌' : '护甲';
      warnings.push({ label: `${item.name}（${tierLabel}不熟练）`, desc: '力量/敏捷检定和豁免劣势、攻击检定劣势、无法施法' });
    }
    if (weaponProf.mainHand && !weaponProf.mainHand.proficient) {
      const info = getWeaponGroupAndType(weaponProf.mainHand.id);
      const groupLabel = info?.group === 'simple' ? '简易武器' : info?.group === 'martial' ? '军用武器' : '武器';
      warnings.push({ label: `${weaponProf.mainHand.name}（${groupLabel}不熟练）`, desc: '攻击检定不加熟练加值' });
    }
    if (weaponProf.offHand && !weaponProf.offHand.proficient) {
      const info = getWeaponGroupAndType(weaponProf.offHand.id);
      const groupLabel = info?.group === 'simple' ? '简易武器' : info?.group === 'martial' ? '军用武器' : '武器';
      warnings.push({ label: `${weaponProf.offHand.name}（${groupLabel}不熟练）`, desc: '攻击检定不加熟练加值' });
    }
    return warnings;
  }, [character]);
  const isHPHalved = exhaustionLevel >= 4;

  /** Apply exhaustion/condition effects to speed */
  const applySpeedEffects = (baseSpeed: number) => {
    if (isSpeedZero) return 0;
    if (isSpeedHalved) return Math.floor(baseSpeed / 2);
    return baseSpeed;
  };

  const currentWalkingSpeed = wildShapeData
    ? (wildShapeData.speed?.walk ?? 30)
    : applySpeedEffects(derived.speed + getEffectMod('speed') + spellBuffs.speedBonus);
  const hasStormborn = hasStormbornFeature(character);
  const stormbornActive = hasStormborn && isStormbornEnvironmentActive(globalTerrain);
  const baseFlyingSpeed = wildShapeData ? wildShapeData.speed?.fly : calculateFlyingSpeed(character, globalTerrain);
  const currentFlyingSpeed = wildShapeData
    ? wildShapeData.speed?.fly
    : baseFlyingSpeed === undefined
      ? undefined
      : applySpeedEffects(baseFlyingSpeed + getEffectMod('speed') + spellBuffs.speedBonus);

  /** Apply exhaustion effects to HP max */
  const applyHPMaxEffects = (baseHP: number) => {
    if (isHPHalved) return Math.floor(baseHP / 2);
    return baseHP;
  };

  // XP helper functions
  const getXPInfo = () => {
    const currentLevel = character.level || 1;
    const currentXP = optimisticXP ?? character.experience_points ?? 0;
    const levels = (xpThresholds as any).levels;
    const currentLevelXP = levels[currentLevel.toString()] || 0;
    const nextLevelXP = currentLevel < 20 ? (levels[(currentLevel + 1).toString()] || 0) : currentLevelXP;
    return { currentXP, currentLevelXP, nextLevelXP };
  };

  const canLevelUp = () => {
    const { currentXP, nextLevelXP } = getXPInfo();
    const currentLevel = character.level || 1;
    return currentLevel < 20 && currentXP >= nextLevelXP;
  };

  // Get final ability scores (with racial bonuses) - use derived utility for consistency
  const finalAbilityScores = derived.finalAbilityScores;

  // Proficiency bonus
  const profBonus = derived.proficiencyBonus;

  // Get selected skills (normalized to string array)
  const selectedSkills = useMemo(() => {
    const skills = character.selected_skills || [];
    const baseSkills = skills.map((s: any) => typeof s === 'string' ? s : s.id);

    // 种族选择的技能
    const raceChoiceSkills = (character.race_choices?.skills as string[]) || [];

    // 子职业选择的技能
    const subclassChoiceSkills = (character.subclass_choices?.skills as string[]) ||
      (character.subclass_choices?.skill ? [character.subclass_choices.skill as string] : []);

    // 种族特性固定给予的技能（如精灵的"敏锐感官"给予察觉）
    const raceTraitSkills: string[] = [];
    const traits = [...(race?.traits || []), ...(subrace?.traits || [])];
    traits.forEach((t: any) => {
      if (t.skillProficiencies) raceTraitSkills.push(...t.skillProficiencies);
      if (t.structuredData?.skillProficiencies) raceTraitSkills.push(...t.structuredData.skillProficiencies);
    });

    // 专长授予的技能（如 skilled）
    const featGrants = getFeatProficiencyGrants(featIds, character?.feat_choices);

    return [...new Set([...baseSkills, ...raceChoiceSkills, ...subclassChoiceSkills, ...raceTraitSkills, ...featGrants.skills])];
  }, [character.selected_skills, character.race_choices, character.subclass_choices, race, subrace, featIds, character?.feat_choices]);

  // Get expertise skills
  const expertiseSkills = useMemo(() => {
    const skills = character.expertise_skills || [];
    return skills.map((s: any) => typeof s === 'string' ? s : s.id);
  }, [character.expertise_skills]);

  // Saving throw proficiencies (class + feats like resilient)
  const savingThrowProfs = useMemo(() => {
    const classProfs = charClass?.saving_throw_proficiencies || [];
    const featGrants = getFeatProficiencyGrants(
      featIds, character?.feat_choices
    );
    return [...new Set([...classProfs, ...featGrants.savingThrows])];
  }, [charClass, featIds, character?.feat_choices]);

  // Calculate skill modifier
  const getSkillMod = (skillId: string) => {
    const ability = SKILL_ABILITY_MAP[skillId];
    if (!ability) return 0;
    const abilityMod = Math.floor(((finalAbilityScores[ability] + getEffectMod(ability)) - 10) / 2);
    const isProf = selectedSkills.includes(skillId);
    const isExpert = expertiseSkills.includes(skillId);

    let base = abilityMod;
    if (isExpert) base = abilityMod + profBonus * 2;
    else if (isProf) base = abilityMod + profBonus;
    return base + getEffectMod(skillId);
  };

  // Calculate saving throw modifier
  const getSaveMod = (ability: keyof AbilityScores) => {
    const abilityMod = Math.floor(((finalAbilityScores[ability] + getEffectMod(ability)) - 10) / 2);
    const isProf = savingThrowProfs.includes(ability);
    const saveKey = ability.substring(0, 3) + '_save'; // strength -> str_save
    let base = (isProf ? abilityMod + profBonus : abilityMod) + getEffectMod(saveKey);
    // Shield Master: add shield AC bonus (+2) to Dex saves
    if (ability === 'dexterity') {
      const fb = getFeatPassiveBonuses(featIds);
      if (fb.has_shield_dex_save_bonus) {
        const equipment = character?.equipment || [];
        const hasShield = equipment.some((it: any) => it?.equippedSlot === "off_hand" && it?.id === "shield");
        if (hasShield) base += 2;
      }
    }
    return base;
  };

  // Format modifier with sign
  const formatMod = (mod: number) => mod >= 0 ? `+${mod}` : `${mod}`;

  // Stat breakdown click handlers
  const showACBreakdown = () => {
    const breakdown = getACBreakdown(character, { activeSpellEffects: incomingSpellBuffs });
    const acMod = getEffectMod('ac');
    const items = [...breakdown.items];
    if (acMod !== 0) items.push({ label: '状态效果', value: acMod });
    setStatDialogData({ title: "护甲等级 (AC)", final: breakdown.final + acMod, items, description: "AC代表你有多难被击中。敌人的攻击骰结果≥你的AC才能命中你。穿护甲、持盾牌、敏捷高都能提升AC。无护甲时AC = 10 + 敏捷调整值。" });
    setStatDialogOpen(true);
  };

  const showInitiativeBreakdown = () => {
    const initMod = getEffectMod('initiative');
    const items: { label: string; value: number }[] = [{ label: "敏捷调整值", value: Math.floor((finalAbilityScores.dexterity - 10) / 2) }];
    if (initMod !== 0) items.push({ label: "状态效果", value: initMod });
    setStatDialogData({
      title: "先攻",
      final: derived.initiative + initMod,
      unit: "+",
      items,
      description: "先攻决定战斗中的行动顺序。战斗开始时每人掷1d20+先攻加值，结果高的先行动。先攻加值 = 敏捷调整值。"
    });
    setStatDialogOpen(true);
  };

  const showSpeedBreakdown = () => {
    const spdMod = getEffectMod('speed');
    let baseSpeed = derived.speed + spdMod + spellBuffs.speedBonus;
    const items: { label: string; value: number }[] = [{ label: `${race?.name || "种族"}基础速度`, value: race?.speed || 30 }];
    if (spdMod !== 0) items.push({ label: "状态效果", value: spdMod });
    if (spellBuffs.speedBonus !== 0) items.push({ label: "法术增益", value: spellBuffs.speedBonus });
    const detailNotes: string[] = [];
    if (currentFlyingSpeed !== undefined) {
      detailNotes.push(`当前飞行速度：${currentFlyingSpeed}尺。`);
    } else if (hasStormborn) {
      detailNotes.push(stormbornActive
        ? "风暴之子当前可用。"
        : `风暴之子当前未生效${globalTerrain ? `（当前环境：${globalTerrain}）` : "（当前未判定为户外环境）"}。`);
    }
    const desc = `速度代表每回合能移动多远（单位：尺，1尺≈0.3米）。大多数种族基础30尺。在战术地图上5尺=1格。穿重甲可能降低速度，某些职业特性可提升速度。${detailNotes.length ? ` ${detailNotes.join(" ")}` : ""}`;
    let warning: string | undefined;
    if (isSpeedZero) {
      const reasons: string[] = [];
      if (exhaustionLevel >= 5) reasons.push(`力竭${exhaustionLevel}级`);
      speedZeroConditions.forEach(c => { if (activeConditionTypes.includes(c as any)) reasons.push(CONDITION_NAMES[c as keyof typeof CONDITION_NAMES] || c); });
      warning = `${reasons.join('、')}导致速度降为 0`;
      baseSpeed = 0;
    } else if (isSpeedHalved) {
      const reasons: string[] = [];
      if (exhaustionLevel >= 2) reasons.push(`力竭${exhaustionLevel}级`);
      if (isProne) reasons.push('倒地（爬行）');
      warning = `${reasons.join('、')}：速度减半（${baseSpeed} → ${Math.floor(baseSpeed / 2)}）`;
      baseSpeed = Math.floor(baseSpeed / 2);
    }
    setStatDialogData({ title: "速度", final: baseSpeed, unit: "ft", items, description: desc, warning });
    setStatDialogOpen(true);
  };

  const showHitDiceBreakdown = () => {
    setStatDialogData({
      title: "生命骰",
      final: character.level || 1,
      unit: "dice",
      diceSize: charClass?.hit_die || 8,
      items: [{ label: `${charClass?.name || "职业"}生命骰`, value: character.level || 1 }],
      description: "生命骰用于短休息时恢复生命值。短休时你可以掷生命骰（加体质调整值）来回血。骰面由职业决定（如战士d10、法师d6），骰子数量等于你的等级。长休后恢复一半已用的生命骰。"
    });
    setStatDialogOpen(true);
  };

  const showProficiencyBreakdown = () => {
    setStatDialogData({
      title: "熟练加值",
      final: profBonus,
      unit: "+",
      items: [{ label: `${character.level || 1}级熟练加值`, value: profBonus }],
      description: "熟练加值加到你擅长的技能检定、攻击骰和豁免检定上。1级时为+2，之后每4级增加1（5级+3，9级+4…最高20级+6）。"
    });
    setStatDialogOpen(true);
  };

  const showHPBreakdown = () => {
    const hpMod = getEffectMod('hp_max');
    const breakdown = getHPBreakdown(character, { includeFlatSubraceHP: true, includeSubraceLevelBonuses: true });
    const items = [...breakdown.items];
    if (hpMod !== 0) items.push({ label: '状态效果', value: hpMod });
    const baseHP = maxHP + hpMod;
    const finalHP = applyHPMaxEffects(baseHP);
    const desc = "生命值代表你的角色能承受多少伤害。当HP降到0时角色濒死。HP由职业生命骰+体质调整值决定，每次升级会增加。可通过休息、治疗法术、药水恢复。";
    if (tempHP != null && tempHP > 0) items.push({ label: '🛡️ 临时生命值', value: tempHP });
    const warning = isHPHalved ? `力竭${exhaustionLevel}级：HP上限减半（${baseHP} → ${finalHP}）` : undefined;
    setStatDialogData({ title: "生命值 (HP)", final: finalHP, items, description: desc, warning });
    setStatDialogOpen(true);
  };

  // Show ability score breakdown
  const showAbilityBreakdown = (abilityKey: keyof AbilityScores) => {
    const breakdown = getAbilityScoreBreakdown(character, abilityKey);
    const abilityMod = getEffectMod(abilityKey);
    const items = [...breakdown.items];
    if (abilityMod !== 0) items.push({ label: '状态效果', value: abilityMod });
    setStatDialogData({
      title: ABILITY_LABELS[abilityKey],
      final: breakdown.final + abilityMod,
      items,
    });
    setStatDialogOpen(true);
  };

  // HP values
  const currentHP = character.current_hp ?? derived.hp;
  const maxHP = character.max_hp ?? derived.hp;

  // Skills list from data
  const allSkills = (skillsData as any).skills || [];

  // Equipment helpers
  const equipment = character.equipment || [];
  const getEquipped = (slot: EquipSlot): EquipmentItem | null => {
    return equipment.find((it: EquipmentItem) => it.equippedSlot === slot) || null;
  };

  // Calculate total weight and carrying capacity
  const { totalWeight, carryingCapacity } = useMemo(() => {
    let weight = 0;
    for (const item of equipment) {
      const meta = findAnyMetaByKey(item.id) || (item.name ? findAnyMetaByKey(item.name) : null);
      const itemWeight = (meta as any)?.weight ?? item.weight ?? 0;
      weight += itemWeight * (item.quantity || 1);
    }
    const str = finalAbilityScores.strength ?? 10;
    const capacity = str * 15;
    return { totalWeight: Math.round(weight * 10) / 10, carryingCapacity: capacity };
  }, [equipment, finalAbilityScores.strength]);

  const EQUIP_SLOTS: { slot: EquipSlot; label: string; icon: string }[] = [
    { slot: "main_hand", label: "主手", icon: "⚔️" },
    { slot: "off_hand", label: "副手", icon: "🛡️" },
    { slot: "armor", label: "护甲", icon: "🎽" },
    { slot: "ammo", label: "弹药", icon: "🏹" },
    { slot: "quick_item", label: "快捷", icon: "🎒" },
  ];

  return (
    <div className="classic-card compact p-2">
      {/* Top Section: Avatar + Name/Info + Combat Stats */}
      <div className="flex gap-2 mb-2 items-stretch">
        {/* Avatar - height matches right stats */}
        <div className="relative flex-shrink-0">
          <div
            className="w-[72px] rounded border-2 border-amber-500/30 overflow-hidden cursor-pointer hover:opacity-90"
            onClick={onAvatarClick}
          >
            {character.avatar ? (
              <img src={character.avatar} alt={character.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gray-800 flex items-center justify-center text-gray-500 text-xs">
                无头像
              </div>
            )}
          </div>
        </div>

        {/* Name & Info */}
        <div className="flex-1 min-w-0">
          <div
            className="char-name text-left !text-base !border-b-0 !pb-0 !mb-1 truncate cursor-pointer hover:text-amber-300 transition-colors"
            onClick={() => setDetailsModalOpen(true)}
            title="点击查看角色详情"
          >
            {character.name}
          </div>
          {/* Wild Shape Indicator */}
          {wildShapeData && (
            <div className="flex items-center gap-1.5 mb-1 px-1.5 py-0.5 bg-green-900/40 border border-green-600/50 rounded text-[9px]">
              <span>🐺</span>
              <span className="text-green-400 font-medium">{wildShapeData.beast_name}</span>
              <span className="text-green-600">({wildShapeData.size})</span>
            </div>
          )}
          <div className="char-info !text-left text-[10px] leading-tight space-y-0.5">
            <div>
              <span
                className="cursor-pointer hover:text-blue-300 transition-colors"
                onClick={() => setRaceInfoOpen(true)}
                title="点击查看种族信息"
              >
                {race?.name}{subrace ? ` (${subrace.name})` : ""}
              </span>
              {character.gender && <span className="text-gray-400"> · {character.gender}</span>}
            </div>
            {/* Class + Alignment on same row */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="cursor-pointer hover:text-amber-300 transition-colors"
                onClick={() => setClassInfoOpen(true)}
                title="点击查看职业信息"
              >
                {charClass?.name} {character.level}级
              </span>
              {character.alignment && (
                <span
                  className="text-gray-400 cursor-pointer hover:text-purple-300 transition-colors"
                  onClick={() => setAlignmentInfoOpen(true)}
                  title="点击查看阵营信息"
                >
                  · {formatAlignment(character.alignment)}
                </span>
              )}
            </div>
            {/* Background & Deity */}
            <div className="flex items-center gap-2 text-[9px] text-gray-400 flex-wrap">
              {background && (
                <span
                  className="text-[#8b7355] cursor-pointer hover:text-green-300 transition-colors"
                  onClick={() => setBackgroundInfoOpen(true)}
                  title="点击查看背景信息"
                >
                  {background.name}
                </span>
              )}
              {character.deity_id && (
                <span
                  className="cursor-pointer hover:text-amber-300 transition-colors"
                  onClick={() => setDeityInfoOpen(true)}
                  title="点击查看神祇信息"
                >
                  🙏 {getDeityName(character.deity_id)}
                </span>
              )}
            </div>
            {/* XP Progress Bar */}
            {(() => {
              const { currentXP, currentLevelXP, nextLevelXP } = getXPInfo();
              const currentLevel = character.level || 1;
              const xpInLevel = currentXP - currentLevelXP;
              const xpNeeded = nextLevelXP - currentLevelXP;
              const progress = currentLevel >= 20 ? 100 : Math.min(100, Math.max(0, (xpInLevel / xpNeeded) * 100));
              const canLevel = canLevelUp();
              const saveXP = async (val: string) => {
                const num = parseInt(val, 10);
                if (isNaN(num) || num < 0) { setEditingXP(false); return; }
                setOptimisticXP(num);
                setEditingXP(false);
                try {
                  await apiFetch(`/api/characters/${character.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ experience_points: num }),
                  });
                  publishAppEvent('characterUpdated', { character_id: character.id, experience_points: num });
                } catch { /* silent */ }
              };
              return (
                <div
                  className={`mt-1 ${canLevel ? 'animate-pulse' : ''}`}
                  title={canLevel ? '点击升级！' : `当前 ${currentXP} / 下一级 ${nextLevelXP} XP`}
                >
                  <div className="flex items-center justify-between text-[8px] text-gray-400 mb-0.5">
                    <span
                      className={canLevel && onLevelUp ? 'cursor-pointer hover:text-amber-300' : ''}
                      onClick={canLevel && onLevelUp ? onLevelUp : undefined}
                    >经验值{canLevel && ' ⬆'}</span>
                    {editingXP ? (
                      <input
                        type="number"
                        className="w-16 bg-gray-800 border border-amber-500/50 rounded px-1 text-[9px] text-gray-200 text-right outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        defaultValue={currentXP}
                        autoFocus
                        onBlur={(e) => saveXP(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveXP((e.target as HTMLInputElement).value);
                          if (e.key === 'Escape') setEditingXP(false);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        className={`${canLevel ? 'text-amber-400 font-bold' : ''} ${isDM ? 'cursor-pointer hover:text-amber-300' : ''}`}
                        onClick={(e) => {
                          if (isDM) { e.stopPropagation(); setEditXPValue(String(currentXP)); setEditingXP(true); }
                        }}
                        title={isDM ? '点击编辑经验值' : undefined}
                      >
                        {currentXP} / {currentLevel >= 20 ? 'MAX' : nextLevelXP}
                      </span>
                    )}
                  </div>
                  <div
                    className={`h-1.5 bg-gray-700/50 rounded-full overflow-hidden ${canLevel && onLevelUp ? 'cursor-pointer' : ''}`}
                    onClick={canLevel && onLevelUp ? onLevelUp : undefined}
                  >
                    <div
                      className={`h-full rounded-full transition-all ${canLevel ? 'bg-amber-500' : 'bg-blue-500/70'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Quick Stats: AC, Initiative */}
        <div className="flex flex-col gap-1">
          <div className={`stat-box !p-1 min-w-[44px] cursor-pointer hover:border-amber-500/50 ${wildShapeData ? 'border-green-500/50' : ''}`} onClick={showACBreakdown}>
            <div className={`stat-label !text-[8px] ${wildShapeData ? 'text-green-400' : ''}`}>AC</div>
            <div className={`stat-value !text-base ${wildShapeData ? 'text-green-400' : ''}`}>{wildShapeData ? wildShapeData.ac : spellAwareAC + getEffectMod('ac') + spellBuffs.acBonus}</div>
          </div>
          <div className="stat-box !p-1 cursor-pointer hover:border-amber-500/50" onClick={showInitiativeBreakdown}>
            <div className="stat-label !text-[8px]">先攻</div>
            <div className="stat-value !text-base">{formatMod(wildShapeData ? (wildShapeData.ability_scores?.dexMod ?? derived.initiative) : derived.initiative + getEffectMod('initiative'))}</div>
          </div>
        </div>
      </div>

      {/* Stats Row: Speed, Hit Dice, Proficiency */}
      <div className="flex items-center gap-1.5 mb-2">
        <div className={`misc-stat flex-1 justify-center !py-1 !px-1.5 !gap-1 cursor-pointer ${wildShapeData ? 'border-green-500/50' : (isSpeedZero || isSpeedHalved) ? 'border-red-500/50' : ''}`} onClick={showSpeedBreakdown}>
          <span className={`text-[8px] ${wildShapeData ? 'text-green-400' : (isSpeedZero || isSpeedHalved) ? 'text-red-400' : ''}`}>速度{isSpeedZero ? ' ⛔' : isSpeedHalved ? ' ½' : ''}</span>
          <span className={`misc-stat-value !text-[11px] ${wildShapeData ? 'text-green-400' : (isSpeedZero || isSpeedHalved) ? 'text-red-400' : ''}`}>{currentWalkingSpeed}尺</span>
          {currentFlyingSpeed !== undefined && (
            <span className="text-[8px] font-medium text-sky-400">飞{currentFlyingSpeed}</span>
          )}
        </div>
        <div className="misc-stat flex-1 justify-center !py-1 !px-1.5 !gap-1 cursor-pointer" onClick={showHitDiceBreakdown}>
          <span className="text-[8px]">生命骰</span>
          <span className="misc-stat-value !text-[11px]">{character.level}d{charClass?.hit_die || 8}</span>
        </div>
        <div className="misc-stat flex-1 justify-center !py-1 !px-1.5 !gap-1 cursor-pointer" onClick={showProficiencyBreakdown}>
          <span className="text-[8px]">熟练</span>
          <span className="misc-stat-value !text-[11px]">+{profBonus}</span>
        </div>
      </div>

      {/* HP Bar + Features Button + Status Button */}
      <div className="flex items-center gap-2 mb-2">
        <div className={`hp-box flex-1 flex items-center justify-center gap-2 !py-1 cursor-pointer ${wildShapeData ? 'border-green-500/50' : isHPHalved ? 'border-red-500/50' : ''}`} onClick={showHPBreakdown}>
          <span className={`text-[9px] ${wildShapeData ? 'text-green-400' : isHPHalved ? 'text-red-400' : 'text-gray-400'}`}>{wildShapeData ? '野兽HP' : isHPHalved ? 'HP ½' : 'HP'}</span>
          <span className={`hp-current !text-lg ${wildShapeData ? '!text-green-400' : ''}`}>{wildShapeData ? wildShapeData.current_hp : currentHP}</span>
          <span className={`hp-max !text-xs ${wildShapeData ? '!text-green-400' : isHPHalved ? '!text-red-400' : ''}`}>/ {wildShapeData ? wildShapeData.max_hp : applyHPMaxEffects(maxHP + getEffectMod('hp_max'))}</span>
          {tempHP != null && tempHP > 0 && (
            <span className="text-amber-400 font-bold text-xs">+{tempHP}</span>
          )}
        </div>
        <button
          className="px-2 py-1.5 text-[10px] bg-gray-700/60 hover:bg-gray-600 text-gray-300 hover:text-amber-300 rounded border border-gray-600/50 hover:border-amber-500/30 transition-colors"
          onClick={onOpenFeatures}
          title="查看角色特性"
        >
          ✨ 特性
        </button>
        <button
          className="px-2 py-1.5 text-[10px] bg-gray-700/60 hover:bg-gray-600 text-gray-300 hover:text-cyan-300 rounded border border-gray-600/50 hover:border-cyan-500/30 transition-colors flex items-center gap-1"
          onClick={() => onOpenStatusEffects ? onOpenStatusEffects() : setStatusEffectsOpen(true)}
          title="查看状态效果"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
            <path d="M8 1l2.12 4.3 4.74.69-3.43 3.34.81 4.72L8 11.77l-4.24 2.28.81-4.72L1.14 5.99l4.74-.69L8 1z" fill="currentColor" opacity="0.9"/>
            <circle cx="12" cy="12" r="4" fill="#0e7490" stroke="currentColor" strokeWidth="1"/>
            <path d="M10 12h4M12 10v4" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          状态
        </button>
      </div>

      {/* Main Content: Attributes + Skills + Equipment */}
      <div className="ccc-main flex gap-2 flex-wrap" style={{ alignItems: 'flex-start' }}>
        {/* Left: Ability Scores */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          {(Object.keys(ABILITY_LABELS) as (keyof AbilityScores)[]).map((key) => {
            const wsKeyMap: Record<string, 'str' | 'dex' | 'con' | null> = {
              strength: 'str', dexterity: 'dex', constitution: 'con',
              intelligence: null, wisdom: null, charisma: null
            };
            const wsKey = wsKeyMap[key];
            const isWildShapePhysical = wildShapeData && wsKey;
            const score = isWildShapePhysical
              ? (wildShapeData.ability_scores?.[wsKey] ?? finalAbilityScores[key])
              : finalAbilityScores[key] + getEffectMod(key);
            const mod = isWildShapePhysical
              ? (wildShapeData.ability_scores?.[`${wsKey}Mod` as 'strMod' | 'dexMod' | 'conMod'] ?? Math.floor((score - 10) / 2))
              : Math.floor((score - 10) / 2);

            return (
              <div
                key={key}
                className={`attr-box cursor-pointer hover:border-amber-500/50 transition-colors ${isWildShapePhysical ? 'border-green-500/50' : ''}`}
                onClick={() => showAbilityBreakdown(key)}
                title="点击查看属性来源"
              >
                <div className={`attr-label ${isWildShapePhysical ? 'text-green-400' : ''}`}>{ABILITY_SHORT[key]}</div>
                <div className={`attr-mod ${isWildShapePhysical ? 'text-green-400' : ''}`}>{formatMod(mod)}</div>
                <div className={`attr-score ${isWildShapePhysical ? 'text-green-400' : ''}`}>{score}</div>
              </div>
            );
          })}
          {/* Passive Perception */}
          <div
            className="text-center text-[8px] text-gray-400 mt-1 px-1 py-0.5 bg-gray-800/30 rounded border border-gray-700/30 cursor-pointer hover:border-amber-500/40 hover:text-gray-300 transition-colors"
            title="点击查看被动感知详情"
            onClick={() => {
              const ability: keyof AbilityScores = 'wisdom';
              const abilityMod = Math.floor(((finalAbilityScores[ability] + getEffectMod(ability)) - 10) / 2);
              const isProf = selectedSkills.includes('perception');
              const isExpert = expertiseSkills.includes('perception');
              const effectMod = getEffectMod('perception');
              const featBonuses = getFeatPassiveBonuses(featIds);
              const items: { label: string; value: number }[] = [
                { label: '基础值', value: 10 },
                { label: '感知调整值', value: abilityMod },
              ];
              if (isExpert) items.push({ label: '专精（熟练×2）', value: profBonus * 2 });
              else if (isProf) items.push({ label: '熟练加值', value: profBonus });
              if (effectMod !== 0) items.push({ label: '状态效果', value: effectMod });
              if (featBonuses.passive_perception_bonus) items.push({ label: '专长：观察入微', value: featBonuses.passive_perception_bonus });
              let passiveTotal = 10 + getSkillMod('perception') + featBonuses.passive_perception_bonus;
              setStatDialogData({
                title: '被动感知（被动察觉）',
                final: passiveTotal,
                items,
                unit: '',
                description: '被动感知代表角色在不主动搜索时的基础警觉度。DM 用它来判断角色是否注意到隐藏的敌人、陷阱或秘密门等，无需玩家主动掷骰。计算方式为 10 + 察觉技能修正值。',
              });
              setStatDialogOpen(true);
            }}
          >
            <span>被动感知</span>
            <span className="text-amber-400 ml-1 font-medium">{10 + getSkillMod('perception') + getFeatPassiveBonuses(featIds).passive_perception_bonus}</span>
          </div>
          {/* Passive Investigation (only shown when Observant feat grants bonus) */}
          {getFeatPassiveBonuses(featIds).passive_investigation_bonus > 0 && (
            <div
              className="text-center text-[8px] text-gray-400 mt-0.5 px-1 py-0.5 bg-gray-800/30 rounded border border-gray-700/30 cursor-pointer hover:border-amber-500/40 hover:text-gray-300 transition-colors"
              title="点击查看被动调查详情"
              onClick={() => {
                const ability: keyof AbilityScores = 'intelligence';
                const abilityMod = Math.floor(((finalAbilityScores[ability] + getEffectMod(ability)) - 10) / 2);
                const isProf = selectedSkills.includes('investigation');
                const isExpert = expertiseSkills.includes('investigation');
                const effectMod = getEffectMod('investigation');
                const featBonuses = getFeatPassiveBonuses(featIds);
                const items: { label: string; value: number }[] = [
                  { label: '基础值', value: 10 },
                  { label: '智力调整值', value: abilityMod },
                ];
                if (isExpert) items.push({ label: '专精（熟练×2）', value: profBonus * 2 });
                else if (isProf) items.push({ label: '熟练加值', value: profBonus });
                if (effectMod !== 0) items.push({ label: '状态效果', value: effectMod });
                if (featBonuses.passive_investigation_bonus) items.push({ label: '专长：观察入微', value: featBonuses.passive_investigation_bonus });
                const passiveTotal = 10 + getSkillMod('investigation') + featBonuses.passive_investigation_bonus;
                setStatDialogData({
                  title: '被动调查',
                  final: passiveTotal,
                  items,
                  unit: '',
                  description: '被动调查代表角色在不主动搜索时推理线索的能力。DM 用它来判断角色是否自然注意到不合理的细节或逻辑线索。计算方式为 10 + 调查技能修正值。',
                });
                setStatDialogOpen(true);
              }}
            >
              <span>被动调查</span>
              <span className="text-amber-400 ml-1 font-medium">{10 + getSkillMod('investigation') + getFeatPassiveBonuses(featIds).passive_investigation_bonus}</span>
            </div>
          )}
        </div>

        {/* Middle: Skills & Saves */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Saving Throws */}
          <div className="section-header !text-[9px] !mb-1">豁免</div>
          <div className="grid grid-cols-3 gap-x-2 mb-2">
            {(Object.keys(ABILITY_LABELS) as (keyof AbilityScores)[]).map((key) => (
              <div key={key} className="save-row">
                <div className={`save-prof ${savingThrowProfs.includes(key) ? 'filled' : ''}`} />
                <span className="save-name">{ABILITY_SHORT[key]}</span>
                <span className="save-mod">{formatMod(getSaveMod(key))}</span>
              </div>
            ))}
          </div>

          {/* Skills */}
          <div className="section-header !text-[9px] !mb-1">技能</div>
          <div>
            {allSkills.map((skill: any) => {
              const isProf = selectedSkills.includes(skill.id);
              const isExpert = expertiseSkills.includes(skill.id);
              const mod = getSkillMod(skill.id);

              return (
                <div key={skill.id} className="skill-row">
                  <div className={`skill-prof ${isExpert ? 'expertise' : isProf ? 'filled' : ''}`}>
                    {isExpert && <span className="text-white text-[6px]">E</span>}
                  </div>
                  <span className="skill-name">{skill.name}</span>
                  <span className="skill-ability">{ABILITY_SHORT[SKILL_ABILITY_MAP[skill.id]]}</span>
                  <span className="skill-mod">{formatMod(mod)}</span>
                </div>
              );
            })}
          </div>

          {/* Feat passive markers */}
          {(() => {
            const fb = getFeatPassiveBonuses(featIds);
            const tags: { label: string; color: string }[] = [];
            // Advantage markers
            for (const adv of fb.advantage) {
              const label = ADVANTAGE_LABELS[adv];
              if (label) tags.push({ label, color: "text-blue-400 border-blue-500/30" });
            }
            // Damage reduction
            if (fb.damage_reduction) {
              tags.push({ label: `伤害减免 ${fb.damage_reduction.amount}（非魔法物理）`, color: "text-orange-400 border-orange-500/30" });
            }
            // Shield dex save
            if (fb.has_shield_dex_save_bonus) {
              const hasShield = (character?.equipment || []).some((it: any) => it?.equippedSlot === "off_hand" && it?.id === "shield");
              if (hasShield) tags.push({ label: "盾牌大师：敏捷豁免+2", color: "text-cyan-400 border-cyan-500/30" });
            }
            // Unarmed damage die
            if (fb.unarmed_damage_die) {
              tags.push({ label: `徒手伤害骰 ${fb.unarmed_damage_die}`, color: "text-amber-400 border-amber-500/30" });
            }
            // Combat labels (combat_option, combat_trigger, rule_override)
            const combatLabels = getFeatCombatLabels(featIds);
            for (const cl of combatLabels) {
              tags.push({ label: cl.label, color: cl.color });
            }
            if (tags.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-0.5 mt-1">
                {tags.map((t, i) => (
                  <span key={i} className={`text-[7px] px-1 py-0.5 rounded border bg-gray-800/40 ${t.color}`}>{t.label}</span>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Right/Bottom: Equipment — uses container query for responsive layout */}
        <div className="ccc-equip-col flex flex-col gap-1">
          {/* Header + Bag Button */}
          <div className="ccc-equip-header">
            <div className="section-header !text-[9px] !mb-0 !pb-0.5 flex-shrink-0">装备</div>
            <button
              onClick={onOpenBag}
              className="ccc-bag-btn flex items-center justify-center gap-1 py-1 px-2 rounded border border-gray-700/50 bg-gray-800/30 hover:border-amber-500/40 hover:bg-gray-700/40 transition-colors text-[9px] text-gray-400 hover:text-amber-400"
              title={`背包 - 负重 ${totalWeight}/${carryingCapacity} lb`}
            >
              <span>🎒</span>
              <span className={totalWeight > carryingCapacity ? 'text-red-400' : ''}>
                {totalWeight}/{carryingCapacity}lb
              </span>
            </button>
          </div>
          {/* Equipment Slots — container-query responsive */}
          <div className="ccc-equip-grid grid gap-1">
            {EQUIP_SLOTS.map(({ slot, label, icon }) => {
              const equipped = getEquipped(slot);
              const summary = equipped ? getEquipmentSummary(equipped) : '';

              // 双手武器占用副手槽位检测
              const mainHandItem = getEquipped("main_hand");
              const isTwoHandedOccupied = slot === "off_hand" && !equipped && (
                isTwoHandedWeapon(mainHandItem) ||
                (isVersatileWeapon(mainHandItem) && mainHandItem?.gripMode === "two-hand")
              );

              return (
                <button
                  key={slot}
                  onClick={(e) => {
                    if (isTwoHandedOccupied) return;
                    if (equipped) {
                      const rect = (e.target as HTMLElement).closest('button')!.getBoundingClientRect();
                      setEquipMenuState({ x: rect.right + 4, y: rect.top, slot, item: equipped });
                    } else {
                      onOpenEquipment?.(slot);
                    }
                  }}
                  className={`ccc-equip-slot equip-slot-row flex items-center p-1 rounded border bg-gray-800/30 transition-colors ${
                    isTwoHandedOccupied
                      ? "border-gray-700/30 cursor-default"
                      : "border-gray-700/50 hover:border-amber-500/40 hover:bg-gray-700/40"
                  }`}
                  title={isTwoHandedOccupied ? "双手武器占用" : equipped ? `${label}: ${equipped.name || equipped.id}${summary ? ` (${summary})` : ''}` : `${label}: 未装备`}
                >
                  {/* Icon */}
                  <div className="w-7 h-7 rounded border border-gray-600/50 overflow-hidden flex-shrink-0 bg-gray-900/50 relative">
                    {isTwoHandedOccupied && getIconPath(mainHandItem!) ? (
                      <img
                        src={getIconPath(mainHandItem!) as string}
                        alt="双手"
                        className="w-full h-full object-cover opacity-30"
                      />
                    ) : equipped && getIconPath(equipped) ? (
                      <img
                        src={getIconPath(equipped) as string}
                        alt={label}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center text-[12px] text-gray-600">{icon}</span>
                    )}
                  </div>
                  {/* Narrow: short label below icon */}
                  <div className="ccc-equip-mobile-label text-[8px] text-gray-400 truncate leading-tight w-full">
                    {isTwoHandedOccupied ? "双手" : equipped ? (equipped.name || equipped.id).slice(0, 3) : label}
                  </div>
                  {/* Wide: full info */}
                  <div className="ccc-equip-desktop-label flex-1 min-w-0">
                    {isTwoHandedOccupied ? (
                      <div className="text-[9px] text-gray-500">双手</div>
                    ) : equipped ? (
                      <>
                        <div className="text-[9px] text-gray-200 leading-tight break-words">
                          {equipped.name || equipped.id}
                          {equipped.quantity && equipped.quantity > 1 && (
                            <span className="text-amber-400 ml-0.5">x{equipped.quantity}</span>
                          )}
                        </div>
                        {summary && <div className="text-[8px] text-amber-400/80 leading-tight break-words">{summary}</div>}
                      </>
                    ) : (
                      <div className="text-[9px] text-gray-500">{label}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Class Features Section (only active features with resource pools) */}
          {activeClassFeatures.length > 0 && (
            <div className="mt-1">
              <div className="section-header !text-[9px] !mb-1 !pb-0.5 flex items-center gap-1">
                <span>职业技能</span>
                <button
                  onClick={onOpenFeatures}
                  className="ml-auto text-[8px] text-gray-500 hover:text-amber-400 transition-colors"
                  title="查看全部职业技能详情"
                >
                  详情 ▸
                </button>
              </div>
              <div className="space-y-0.5">
                {activeClassFeatures.map((feat, idx) => {
                  // Match feature to resource by ID (fallback to name for features without id)
                  const matchedResource = classResources?.find(
                    r => feat.id ? r.id === feat.id : (r.name === feat.name || r.nameEn === feat.nameEn)
                  );
                  const hasResource = matchedResource && matchedResource.maxFormula !== 'passive' && matchedResource.maxFormula !== 'spell_slots';
                  const isSpellSlotFeature = matchedResource && matchedResource.maxFormula === 'spell_slots';
                  const rechargeText = matchedResource?.currentRechargeType === 'short_rest' ? '短休恢复' : matchedResource?.currentRechargeType === 'long_rest' ? '长休恢复' : null;

                  // Get selection text for features with choices
                  const featureName = feat.name || '';
                  let selectionText = '';
                  if (/宿敌|Favored Enemy/.test(featureName)) {
                    const val = (character as any).favored_enemy || (character as any).favoredEnemy;
                    const enemy = typeof val === 'string' ? val : val?.value;
                    if (enemy) {
                      const humanoids = ((character as any).favored_humanoid_races || (character as any).favoredHumanoidRaces as string[]) || [];
                      selectionText = enemy === 'humanoids'
                        ? `类人生物（${humanoids.map(formatHumanoid).join('、')}）`
                        : formatFavoredEnemy(enemy);
                    }
                  } else if (/自然探索者|天生探险家|Natural Explorer/.test(featureName)) {
                    const val = (character as any).favored_terrain || (character as any).favoredTerrain;
                    const terrain = typeof val === 'string' ? val : val?.value;
                    if (terrain) selectionText = formatFavoredTerrain(terrain);
                  } else if (/战斗风格|Fighting Style/.test(featureName)) {
                    const val = (character as any).fighting_style || (character as any).fightingStyle;
                    const style = typeof val === 'string' ? val : val?.value;
                    if (style) selectionText = formatFightingStyle(style);
                  } else if (/魔能祈唤|Eldritch Invocations/.test(featureName)) {
                    const inv = (character as any).eldritch_invocations || (character as any).eldritchInvocations || [];
                    const arr = inv.map((v: any) => typeof v === 'string' ? v : v?.id || v?.value).filter(Boolean);
                    if (arr.length > 0) selectionText = arr.map(formatEldritchInvocation).join('、');
                  } else if (/超魔|Metamagic/.test(featureName)) {
                    const mm = (character as any).metamagic_options || (character as any).metamagicOptions || [];
                    const arr = mm.map((v: any) => typeof v === 'string' ? v : v?.id || v?.value).filter(Boolean);
                    if (arr.length > 0) selectionText = arr.map(formatMetamagic).join('、');
                  } else if (/战技|Maneuvers|Combat Superiority/.test(featureName)) {
                    const mn = (character as any).maneuvers_known || (character as any).maneuversKnown || [];
                    const arr = mn.map((v: any) => typeof v === 'string' ? v : v?.id || v?.value).filter(Boolean);
                    if (arr.length > 0) selectionText = `${arr.length}个战技`;
                  }

                  return (
                    <div
                      key={`${feat.nameEn}-${feat.level}-${idx}`}
                      className="ccc-feat-row px-1 py-0.5 rounded hover:bg-amber-500/5 transition-colors cursor-pointer"
                      onClick={() => { setSelectedFeat(feat); setSelectedFeatSelection(selectionText); setFeatDetailOpen(true); }}
                    >
                      <div className="flex items-center gap-1 text-[9px]">
                        <span className="text-gray-400 text-[8px] w-3 text-right flex-shrink-0">{feat.level}</span>
                        {matchedResource && (
                          <img
                            src={getAssetUrl(`assets/class-feature-icons/${matchedResource.id}.png`)}
                            alt=""
                            className="w-4 h-4 rounded-sm flex-shrink-0 object-cover"
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        )}
                        <span className="text-gray-200 truncate">{feat.name}</span>
                      </div>
                      {selectionText && (
                        <div className="text-green-400 text-[8px] ml-4 truncate">{selectionText}</div>
                      )}
                      {(hasResource || isSpellSlotFeature || rechargeText) && (
                        <div className="flex items-center gap-1.5 ml-4 mt-0.5 text-[8px]">
                          {hasResource && (
                            <span className="text-amber-400 font-medium tabular-nums">
                              {matchedResource.current}/{matchedResource.max}
                            </span>
                          )}
                          {isSpellSlotFeature && (
                            <span className="px-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-700/30">
                              消耗法术位
                            </span>
                          )}
                          {rechargeText && (
                            <span className={`px-0.5 rounded ${
                              rechargeText === '短休恢复' ? 'bg-blue-900/40 text-blue-400 border border-blue-700/30' : 'bg-purple-900/40 text-purple-400 border border-purple-700/30'
                            }`}>
                              {rechargeText}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Feat Resources Section (lucky, magic_initiate, martial_adept) */}
          {(activeFeatResources.length > 0 || passiveFeats.length > 0) && (
            <div className="mt-1">
              <div className="section-header !text-[9px] !mb-1 !pb-0.5">专长</div>
              <div className="space-y-0.5">
                {activeFeatResources.map(res => {
                  const rechargeText = res.currentRechargeType === 'short_rest' ? '短休恢复' : res.currentRechargeType === 'long_rest' ? '长休恢复' : null;
                  return (
                    <div
                      key={res.id}
                      className="ccc-feat-row px-1 py-0.5 rounded hover:bg-amber-500/5 transition-colors cursor-pointer"
                      onClick={() => {
                        setSelectedFeat({ name: res.name, nameEn: res.nameEn, description: res.description || '' });
                        setSelectedFeatSelection('');
                        setFeatDetailOpen(true);
                      }}
                    >
                      <div className="flex items-center gap-1 text-[9px]">
                        <img
                          src={getAssetUrl(`assets/class-feature-icons/${res.id}.png`)}
                          alt=""
                          className="w-4 h-4 rounded-sm flex-shrink-0 object-cover"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <span className="text-gray-200 truncate">{res.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 ml-4 mt-0.5 text-[8px]">
                        <span className="text-amber-400 font-medium tabular-nums">
                          {res.current}/{res.max}
                        </span>
                        {rechargeText && (
                          <span className={`px-0.5 rounded ${
                            rechargeText === '短休恢复' ? 'bg-blue-900/40 text-blue-400 border border-blue-700/30' : 'bg-purple-900/40 text-purple-400 border border-purple-700/30'
                          }`}>
                            {rechargeText}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {passiveFeats.map((feat: any) => (
                  <div
                    key={feat.id}
                    className="ccc-feat-row px-1 py-0.5 rounded hover:bg-amber-500/5 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedFeat({ name: feat.name, nameEn: feat.nameEn, description: feat.benefits?.join('；') || feat.description || '' });
                      setSelectedFeatSelection('');
                      setFeatDetailOpen(true);
                    }}
                  >
                    <div className="flex items-center gap-1 text-[9px]">
                      <span className="text-amber-500/60 text-[8px] w-4 text-center flex-shrink-0">◆</span>
                      <span className="text-gray-200 truncate">{feat.name}</span>
                      <span className="ml-auto text-[8px] text-gray-500">被动</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activatable Eldritch Invocations (warlock only) */}
          {activatableInvocations.length > 0 && (
            <div className="mt-1">
              <div className="section-header !text-[9px] !mb-1 !pb-0.5">魔能祈唤</div>
              <div className="space-y-0.5">
                {activatableInvocations.map(inv => {
                  const rechargeText = inv.matchedResource?.currentRechargeType === 'short_rest' ? '短休恢复'
                    : inv.matchedResource?.currentRechargeType === 'long_rest' ? '长休恢复' : null;
                  return (
                    <div
                      key={inv.id}
                      className="ccc-feat-row px-1 py-0.5 rounded hover:bg-purple-500/5 transition-colors cursor-pointer"
                      onClick={() => { setSelectedInv(inv); setInvDetailOpen(true); }}
                    >
                      <div className="flex items-center gap-1 text-[9px]">
                        <span className="text-purple-500/60 text-[8px] w-3 text-right flex-shrink-0">✦</span>
                        <span className="text-gray-200 truncate">{inv.name}</span>
                        <div className="ml-auto flex items-center gap-1">
                          {inv.isAtWill ? (
                            <span className="px-0.5 rounded bg-purple-900/40 text-purple-400 border border-purple-700/30 text-[8px]">
                              随意
                            </span>
                          ) : inv.matchedResource ? (
                            <>
                              <span className="text-amber-400 font-medium tabular-nums text-[8px]">
                                {inv.matchedResource.current}/{inv.matchedResource.max}
                              </span>
                              {rechargeText && (
                                <span className="px-0.5 rounded bg-purple-900/40 text-purple-400 border border-purple-700/30 text-[8px]">
                                  {rechargeText}
                                </span>
                              )}
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Beast Companion Button */}
          {character.subclass_choices?.beastCompanion && (() => {
            const beastId = character.subclass_choices!.beastCompanion;
            const beast = (companionsData as any).categories.beast_master.creatures.find((c: any) => c.id === beastId);
            if (!beast) return null;
            return (
              <div className="mt-1">
                <div className="section-header !text-[9px] !mb-1 !pb-0.5">动物伙伴</div>
                <div className="px-1 py-1 rounded bg-green-900/15 border border-green-700/30">
                  <div className="flex items-center gap-1.5 text-[9px]">
                    <span className="text-green-500">🐾</span>
                    <span className="text-green-300 font-medium">{beast.name}</span>
                    <span className="text-green-500/50 text-[8px]">{beast.nameEn}</span>
                    <span className="ml-auto text-[8px] text-gray-400">AC{beast.ac} HP{beast.hp}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {isCompanionOnMap && onDismissCompanion ? (
                      <button
                        className="flex-1 px-1.5 py-0.5 text-[8px] bg-red-900/40 hover:bg-red-800/50 text-red-300 rounded border border-red-600/30 transition-colors"
                        onClick={() => {
                          if (companionSummoningRef.current) return;
                          companionSummoningRef.current = true;
                          Promise.resolve(onDismissCompanion()).finally(() => {
                            setTimeout(() => { companionSummoningRef.current = false; }, 2000);
                          });
                        }}
                      >
                        🔙 收回伙伴
                      </button>
                    ) : onSummonCompanion ? (
                      <button
                        className="flex-1 px-1.5 py-0.5 text-[8px] bg-green-800/40 hover:bg-green-700/50 text-green-300 rounded border border-green-600/30 transition-colors"
                        onClick={() => {
                          if (companionSummoningRef.current) return;
                          companionSummoningRef.current = true;
                          Promise.resolve(onSummonCompanion()).finally(() => {
                            setTimeout(() => { companionSummoningRef.current = false; }, 2000);
                          });
                        }}
                      >
                        📍 召唤到身边
                      </button>
                    ) : null}
                    <button
                      className="flex-1 px-1.5 py-0.5 text-[8px] bg-gray-700/40 hover:bg-gray-600/50 text-gray-300 rounded border border-gray-600/30 transition-colors"
                      onClick={() => setCompanionDetailOpen(true)}
                    >
                      📋 详细信息
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Familiar Pick (for existing Chain Pact warlocks without familiar) */}
          {character.subclass_choices?.pactBoon === 'chain' && !character.subclass_choices?.familiarForm && !localFamiliarForm && (
            <div className="mt-1">
              <div className="section-header !text-[9px] !mb-1 !pb-0.5">魔宠</div>
              <button
                className="w-full px-1.5 py-1 text-[9px] bg-purple-900/20 hover:bg-purple-800/30 text-purple-300 rounded border border-purple-700/30 transition-colors"
                onClick={() => setFamiliarPickOpen(true)}
              >
                🔮 选择魔宠形态
              </button>
            </div>
          )}

          {/* Familiar Button */}
          {(character.subclass_choices?.familiarForm || localFamiliarForm) && (() => {
            const familiarId = character.subclass_choices?.familiarForm || localFamiliarForm;
            const familiar = (companionsData as any).categories.find_familiar?.creatures?.find((c: any) => c.id === familiarId);
            if (!familiar) return null;
            return (
              <div className="mt-1">
                <div className="section-header !text-[9px] !mb-1 !pb-0.5">魔宠</div>
                <div className="px-1 py-1 rounded bg-purple-900/15 border border-purple-700/30">
                  <div className="flex items-center gap-1 text-[8px]">
                    <img src={getAssetUrl(`assets/monster-avatars/${familiarId}_128.webp`)} alt={familiar.name} className="w-4 h-4 rounded object-cover border border-purple-700/50" />
                    <span className="text-purple-300 font-medium truncate">{familiar.name}</span>
                    <span className="ml-auto text-gray-500 flex-shrink-0">HP {familiar.hp}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {familiarOnMap ? (
                      <button
                        className="flex-1 px-1 py-px text-[7px] bg-red-900/40 hover:bg-red-800/50 text-red-300 rounded border border-red-600/30 transition-colors"
                        onClick={handleDismissFamiliar}
                      >
                        收回
                      </button>
                    ) : campaignId && currentMapUrl ? (
                      <button
                        className="flex-1 px-1 py-px text-[7px] bg-purple-800/40 hover:bg-purple-700/50 text-purple-300 rounded border border-purple-600/30 transition-colors"
                        onClick={handleSummonFamiliar}
                      >
                        召唤
                      </button>
                    ) : null}
                    <button
                      className="flex-1 px-1 py-px text-[7px] bg-gray-700/40 hover:bg-gray-600/50 text-gray-300 rounded border border-gray-600/30 transition-colors"
                      onClick={() => setFamiliarDetailOpen(true)}
                    >
                      详情
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Racial Traits Section */}
          {racialTraits.length > 0 && (
            <div className="mt-1">
              <div className="section-header !text-[9px] !mb-1 !pb-0.5">种族技能</div>
              <div className="space-y-0.5">
                {racialTraits.map((trait, idx) => (
                  <div
                    key={`racial-${idx}`}
                    className="ccc-racial-row px-1 py-0.5 rounded hover:bg-teal-500/5 cursor-pointer transition-colors"
                    onClick={() => { setSelectedFeat({ name: trait.name, nameEn: trait.nameEn, description: trait.description, source: trait.source }); setSelectedFeatSelection(''); setFeatDetailOpen(true); }}
                  >
                    <div className="flex items-center gap-1 text-[9px]">
                      {trait.nameEn === 'Breath Weapon' && subrace?.damageType ? (
                        <img src={getAssetUrl(`assets/spell-icons/breath_weapon_${subrace.damageType}.png`)} alt="" className="w-3 h-3 rounded flex-shrink-0" />
                      ) : (
                        <span className="text-teal-500/60 text-[8px] w-3 text-right flex-shrink-0">◆</span>
                      )}
                      <span className="text-gray-200 truncate">{trait.name}</span>
                      {trait.nameEn === 'Breath Weapon' && subrace?.breathWeapon && onUseBreathWeapon && (
                        <button
                          className="ml-auto text-[8px] px-1 py-0.5 rounded bg-teal-900/40 text-teal-300 border border-teal-700/30 hover:bg-teal-800/60 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            const level = character.level || 1;
                            const bwTrait = race?.traits?.find((t: any) => t.nameEn === 'Breath Weapon');
                            let dice = '2d6';
                            if (bwTrait?.damage?.length) {
                              for (const d of bwTrait.damage) { if (d.level <= level) dice = d.dice; }
                            }
                            // Pre-calculate save DC = 8 + proficiency + CON mod
                            const conScore = (character as any).ability_scores?.constitution ?? (character as any).abilities?.constitution ?? 10;
                            const conMod = Math.floor((conScore - 10) / 2);
                            const profBonus = Math.floor((level - 1) / 4) + 2;
                            const saveDC = 8 + profBonus + conMod;
                            onUseBreathWeapon({
                              breathWeapon: subrace.breathWeapon,
                              damageType: subrace.damageType,
                              damageTypeCn: subrace.damageTypeCn,
                              damageDice: dice,
                              subraceName: subrace.name,
                              saveDC,
                            });
                          }}
                          disabled={isIncapacitated}
                          title={isIncapacitated ? '💫 失能状态下无法使用' : undefined}
                        >
                          使用
                        </button>
                      )}
                    </div>
                    {trait.annotation && <div className="text-teal-400 text-[8px] ml-4 truncate">{trait.annotation}</div>}
                    {trait.spellIds && trait.spellIds.length > 0 && (
                      <div className="ml-4 mt-0.5 space-y-0.5">
                        {trait.spellIds.map(sid => {
                          const spell = spellsAll.find(s => s.id === sid);
                          const spellName = spell?.name || sid;
                          const iconSrc = spell?.iconPath
                            ? getAssetUrl(spell.iconPath.replace(/^\//, ''))
                            : getAssetUrl(`assets/spell-icons/${sid}.png`);
                          return (
                            <div
                              key={sid}
                              className="flex items-center gap-1 text-[8px] text-cyan-400 hover:text-cyan-300 cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); if (spell) setRacialSpellDetail(spell as Spell); }}
                            >
                              <img src={iconSrc} alt="" className="w-3 h-3 rounded flex-shrink-0 object-cover"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              <span className="truncate">{spellName}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Spell Section */}
          {isSpellcaster && (
            <SpellSection
              spellsAll={spellsAll}
              cantripsLocal={cantripsLocal}
              preparedLocal={preparedLocal}
              spellcasting={spellcasting}
              remainingSlots={remainingSlots}
              slotStateManagedByParent={slotStateManagedByParent}
              characterId={character.id}
              campaignId={campaignId}
              currentMapUrl={currentMapUrl}
              userId={userId}
              isDM={isDM}
              onOpenSpells={onOpenSpells}
              onConsumeSlot={onConsumeSlot}
              onSetSlot={onSetSlot}
              onCastSpell={isIncapacitated ? () => {
                publishAppEvent("showToast", { message: '💫 失能状态下无法施法', type: 'warning' });
              } : onCastSpell}
              eldritchInvocations={
                ((character as any).eldritch_invocations || [])
                  .map((i: any) => typeof i === 'string' ? i : i.value || i.id || '')
              }
              charismaMod={Math.floor(((finalAbilityScores?.charisma ?? 10) - 10) / 2)}
              subclassId={character.subclass_id ?? undefined}
              expandedLevels={spellExpandedLevels}
              onToggleSpellLevel={onToggleSpellLevel}
              concentrationSpellName={concentrationSpell?.spell_name}
              concentrationSpellId={concentrationSpell?.spell_id}
              castingSpellName={castingSpellName}
              equipment={equipment}
              hasSomaticFreedom={hasSomaticFreedom}
            />
          )}
        </div>
      </div>

      {/* Stat Breakdown Dialog */}
      <StatBreakdownDialog
        open={statDialogOpen}
        onOpenChange={setStatDialogOpen}
        data={statDialogData}
      />

      {/* Character Details Modal */}
      <Dialog.Root open={detailsModalOpen} onOpenChange={setDetailsModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/70 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-gray-900 border border-amber-500/30 rounded-lg p-5 w-[90vw] max-w-lg max-h-[80dvh] overflow-y-auto">
            <Dialog.Title className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
              <span>📜</span> {character.name} 的故事
            </Dialog.Title>

            <div className="space-y-4">
              {/* Appearance */}
              {character.appearance && Object.keys(character.appearance).length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-amber-300 mb-2 flex items-center gap-1.5">
                    <span>👁️</span> 外貌特征
                  </h3>
                  <div className="bg-gray-800/50 rounded-lg p-3 text-sm text-gray-300 space-y-1.5">
                    {character.appearance.height && (
                      <div className="flex"><span className="text-gray-500 w-16">身高:</span> {character.appearance.height}</div>
                    )}
                    {character.appearance.weight && (
                      <div className="flex"><span className="text-gray-500 w-16">体重:</span> {character.appearance.weight}</div>
                    )}
                    {character.appearance.eyes && (
                      <div className="flex"><span className="text-gray-500 w-16">眼睛:</span> {character.appearance.eyes}</div>
                    )}
                    {character.appearance.hair && (
                      <div className="flex"><span className="text-gray-500 w-16">头发:</span> {character.appearance.hair}</div>
                    )}
                    {character.appearance.skin && (
                      <div className="flex"><span className="text-gray-500 w-16">肤色:</span> {character.appearance.skin}</div>
                    )}
                    {character.appearance.distinguishingMarks && (
                      <div className="flex"><span className="text-gray-500 w-16 flex-shrink-0">特征:</span> <span>{character.appearance.distinguishingMarks}</span></div>
                    )}
                  </div>
                </div>
              )}

              {/* Personality */}
              {character.personality && Object.keys(character.personality).length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-amber-300 mb-2 flex items-center gap-1.5">
                    <span>💭</span> 性格特质
                  </h3>
                  <div className="bg-gray-800/50 rounded-lg p-3 text-sm space-y-2">
                    {character.personality.traits && character.personality.traits.length > 0 && (
                      <div>
                        <div className="text-gray-500 text-xs mb-1">个性特点</div>
                        <ul className="text-gray-300 space-y-0.5">
                          {(Array.isArray(character.personality.traits) ? character.personality.traits : [character.personality.traits]).map((t: string, i: number) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-amber-500/60">•</span> {t}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {character.personality.ideals && (
                      <div>
                        <div className="text-gray-500 text-xs mb-1">理想</div>
                        <p className="text-gray-300">{character.personality.ideals}</p>
                      </div>
                    )}
                    {character.personality.bonds && (
                      <div>
                        <div className="text-gray-500 text-xs mb-1">羁绊</div>
                        <p className="text-gray-300">{character.personality.bonds}</p>
                      </div>
                    )}
                    {character.personality.flaws && (
                      <div>
                        <div className="text-gray-500 text-xs mb-1">缺陷</div>
                        <p className="text-gray-300">{character.personality.flaws}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Backstory */}
              {character.backstory && (
                <div>
                  <h3 className="text-sm font-semibold text-amber-300 mb-2 flex items-center gap-1.5">
                    <span>📖</span> 背景故事
                  </h3>
                  <div className="bg-gray-800/50 rounded-lg p-3 text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                    {character.backstory}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {(!character.appearance || Object.keys(character.appearance).length === 0) &&
               (!character.personality || Object.keys(character.personality).length === 0) &&
               !character.backstory && (
                <div className="text-center text-gray-500 py-6">
                  <div className="text-3xl mb-2">📝</div>
                  <div>暂无角色详细信息</div>
                  <div className="text-xs mt-1">可在详细视图中编辑</div>
                </div>
              )}
            </div>

            <div className="mt-4 text-right">
              <button
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
                onClick={() => setDetailsModalOpen(false)}
              >
                关闭
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Race Info Dialog */}
      <RaceInfoDialog
        open={raceInfoOpen}
        onOpenChange={setRaceInfoOpen}
        race={race}
        subrace={subrace}
      />

      {/* Class Info Dialog */}
      <ClassInfoDialog
        open={classInfoOpen}
        onOpenChange={setClassInfoOpen}
        character={character}
        charClass={charClass}
        subclass={subclass}
      />

      {/* Background Info Dialog */}
      <BackgroundInfoDialog
        open={backgroundInfoOpen}
        onOpenChange={setBackgroundInfoOpen}
        background={background}
      />

      {/* Alignment Info Dialog */}
      <AlignmentInfoDialog
        open={alignmentInfoOpen}
        onOpenChange={setAlignmentInfoOpen}
        currentAlignment={character.alignment || undefined}
      />

      {/* Deity Info Dialog */}
      <DeityInfoDialog
        open={deityInfoOpen}
        onOpenChange={setDeityInfoOpen}
        deityId={character.deity_id || undefined}
      />
      <StatusEffectsDialog
        open={statusEffectsOpen}
        onOpenChange={setStatusEffectsOpen}
        isDM={isDM}
        characterName={character.name}
        concentrationSpell={concentrationSpell}
        onConcentrationBreak={concentrationTokenId ? async () => {
          try {
            await apiFetch(`/api/tokens/${concentrationTokenId}/concentration?reason=manual_break`, { method: 'DELETE' });
            setConcentrationSpell(null);
            setConcentrationTokenId(null);
          } catch (err) {
            console.error('Failed to break concentration:', err);
          }
        } : undefined}
        tokenActiveEffects={tokenActiveEffects}
        incomingSpellBuffs={incomingSpellBuffs}
        runtimeSpellOverlays={runtimeSpellOverlays}
        proficiencyWarnings={proficiencyWarnings}
        customEffects={customEffects}
        onAddEffect={(e) => setCustomEffects(prev => {
          const next = [...prev, e];
          persistStatusEffects(next, activeConditions, exhaustionLevel, exhaustionDuration, specialBuffs);
          return next;
        })}
        onRemoveEffect={(id) => setCustomEffects(prev => {
          const next = prev.filter(e => e.id !== id);
          persistStatusEffects(next, activeConditions, exhaustionLevel, exhaustionDuration, specialBuffs);
          return next;
        })}
        onUpdateEffect={(id, patch) => setCustomEffects(prev => {
          const next = prev.map(e => e.id === id ? { ...e, ...patch } : e);
          persistStatusEffects(next, activeConditions, exhaustionLevel, exhaustionDuration, specialBuffs);
          return next;
        })}
        onAdvanceRound={() => advanceTime(1)}
        onShortRest={() => advanceTime(SHORT_REST_ROUNDS)}
        onLongRest={() => advanceTime(LONG_REST_ROUNDS, 1)}
        activeConditions={activeConditions}
        onToggleCondition={(c) => setActiveConditions(prev => {
          const exists = prev.find(x => x.condition === c);
          const next = exists ? prev.filter(x => x.condition !== c) : [...prev, { condition: c, duration: { ...PERMANENT_DURATION }, source: { type: 'dm' as const }, removal: { type: 'manual' as const } }];
          persistStatusEffects(customEffects, next, exhaustionLevel, exhaustionDuration, specialBuffs);
          return next;
        })}
        onUpdateConditionDuration={(c, dur) => setActiveConditions(prev => {
          const next = prev.map(x => x.condition === c ? { ...x, duration: dur } : x);
          persistStatusEffects(customEffects, next, exhaustionLevel, exhaustionDuration, specialBuffs);
          return next;
        })}
        exhaustionLevel={exhaustionLevel}
        onSetExhaustion={(lv) => {
          setExhaustionLevel(lv);
          const dur = lv === 0 ? { ...PERMANENT_DURATION } : exhaustionDuration;
          if (lv === 0) setExhaustionDuration(dur);
          persistStatusEffects(customEffects, activeConditions, lv, dur, specialBuffs);
        }}
        exhaustionDuration={exhaustionDuration}
        onSetExhaustionDuration={(dur) => {
          setExhaustionDuration(dur);
          persistStatusEffects(customEffects, activeConditions, exhaustionLevel, dur, specialBuffs);
        }}
        currentWorldTime={currentWorldTime}
        favoredEnemy={(() => {
          const val = (character as any).favored_enemy || (character as any).favoredEnemy;
          return typeof val === 'string' ? val : val?.value;
        })()}
        favoredHumanoidRaces={((character as any).favored_humanoid_races || (character as any).favoredHumanoidRaces) as string[] | undefined}
        favoredTerrain={(() => {
          const val = (character as any).favored_terrain || (character as any).favoredTerrain;
          return typeof val === 'string' ? val : val?.value;
        })()}
        circleLandTerrain={(character as any).subclass_choices?.landType || (character as any).subclassChoices?.landType}
        globalTerrain={globalTerrain}
        specialBuffs={specialBuffs}
        onToggleSpecialBuff={(key, active) => {
          const next = { ...specialBuffs, [key]: active };
          setSpecialBuffs(next);
          persistStatusEffects(customEffects, activeConditions, exhaustionLevel, exhaustionDuration, next);
        }}
        formatFavoredEnemy={formatFavoredEnemy}
        formatFavoredTerrain={formatFavoredTerrain}
        formatHumanoid={formatHumanoid}
      />

      {/* Embedded StatusEffectsDialog for floating panel */}
      {floatingStatusActive && floatingStatusContainer && createPortal(
        <StatusEffectsDialog
          open={true}
          onOpenChange={() => {}}
          isDM={isDM}
          characterName={character.name}
          concentrationSpell={concentrationSpell}
          onConcentrationBreak={concentrationTokenId ? async () => {
            try {
              await apiFetch(`/api/tokens/${concentrationTokenId}/concentration?reason=manual_break`, { method: 'DELETE' });
              setConcentrationSpell(null);
              setConcentrationTokenId(null);
            } catch (err) {
              console.error('Failed to break concentration:', err);
            }
          } : undefined}
          tokenActiveEffects={tokenActiveEffects}
          incomingSpellBuffs={incomingSpellBuffs}
          runtimeSpellOverlays={runtimeSpellOverlays}
          proficiencyWarnings={proficiencyWarnings}
          customEffects={customEffects}
          onAddEffect={(e) => setCustomEffects(prev => {
            const next = [...prev, e];
            persistStatusEffects(next, activeConditions, exhaustionLevel, exhaustionDuration, specialBuffs);
            return next;
          })}
          onRemoveEffect={(id) => setCustomEffects(prev => {
            const next = prev.filter(e => e.id !== id);
            persistStatusEffects(next, activeConditions, exhaustionLevel, exhaustionDuration, specialBuffs);
            return next;
          })}
          onUpdateEffect={(id, patch) => setCustomEffects(prev => {
            const next = prev.map(e => e.id === id ? { ...e, ...patch } : e);
            persistStatusEffects(next, activeConditions, exhaustionLevel, exhaustionDuration, specialBuffs);
            return next;
          })}
          onAdvanceRound={() => advanceTime(1)}
          onShortRest={() => advanceTime(SHORT_REST_ROUNDS)}
          onLongRest={() => advanceTime(LONG_REST_ROUNDS, 1)}
          activeConditions={activeConditions}
          onToggleCondition={(c) => setActiveConditions(prev => {
            const exists = prev.find(x => x.condition === c);
            const next = exists ? prev.filter(x => x.condition !== c) : [...prev, { condition: c, duration: { ...PERMANENT_DURATION }, source: { type: 'dm' as const }, removal: { type: 'manual' as const } }];
            persistStatusEffects(customEffects, next, exhaustionLevel, exhaustionDuration, specialBuffs);
            return next;
          })}
          onUpdateConditionDuration={(c, dur) => setActiveConditions(prev => {
            const next = prev.map(x => x.condition === c ? { ...x, duration: dur } : x);
            persistStatusEffects(customEffects, next, exhaustionLevel, exhaustionDuration, specialBuffs);
            return next;
          })}
          exhaustionLevel={exhaustionLevel}
          onSetExhaustion={(lv) => {
            setExhaustionLevel(lv);
            const dur = lv === 0 ? { ...PERMANENT_DURATION } : exhaustionDuration;
            if (lv === 0) setExhaustionDuration(dur);
            persistStatusEffects(customEffects, activeConditions, lv, dur, specialBuffs);
          }}
          exhaustionDuration={exhaustionDuration}
          onSetExhaustionDuration={(dur) => {
            setExhaustionDuration(dur);
            persistStatusEffects(customEffects, activeConditions, exhaustionLevel, dur, specialBuffs);
          }}
          currentWorldTime={currentWorldTime}
          favoredEnemy={(() => {
            const val = (character as any).favored_enemy || (character as any).favoredEnemy;
            return typeof val === 'string' ? val : val?.value;
          })()}
          favoredHumanoidRaces={((character as any).favored_humanoid_races || (character as any).favoredHumanoidRaces) as string[] | undefined}
          favoredTerrain={(() => {
            const val = (character as any).favored_terrain || (character as any).favoredTerrain;
            return typeof val === 'string' ? val : val?.value;
          })()}
          circleLandTerrain={(character as any).subclass_choices?.landType || (character as any).subclassChoices?.landType}
          globalTerrain={globalTerrain}
          specialBuffs={specialBuffs}
          onToggleSpecialBuff={(key, active) => {
            const next = { ...specialBuffs, [key]: active };
            setSpecialBuffs(next);
            persistStatusEffects(customEffects, activeConditions, exhaustionLevel, exhaustionDuration, next);
          }}
          formatFavoredEnemy={formatFavoredEnemy}
          formatFavoredTerrain={formatFavoredTerrain}
          formatHumanoid={formatHumanoid}
          embedded
        />,
        floatingStatusContainer
      )}

      {/* Feature Detail Modal */}
      <FeatureDetailDialog
        open={featDetailOpen}
        onOpenChange={setFeatDetailOpen}
        feature={selectedFeat}
        resource={(() => {
          if (!selectedFeat || !classResources) return null;
          const res = classResources.find(r => (selectedFeat as any).id ? r.id === (selectedFeat as any).id : (r.name === selectedFeat.name || r.nameEn === selectedFeat.nameEn));
          if (!res || res.maxFormula === 'passive') return null;
          // spell_slots type: compute total from spellcasting info
          if (res.maxFormula === 'spell_slots') {
            if (!spellcasting) return null;
            let totalRemaining = 0, totalMax = 0;
            for (let i = 1; i <= 9; i++) {
              totalRemaining += (remainingSlots?.[i] ?? spellcasting.spellSlots[i] ?? 0);
              totalMax += (spellcasting.spellSlots[i] ?? 0);
            }
            if (totalMax <= 0) return null;
            return { id: res.id, current: totalRemaining, max: totalMax, maxFormula: res.maxFormula, rechargeType: res.currentRechargeType } as FeatureResourceInfo;
          }
          return { id: res.id, current: res.current, max: res.max, maxFormula: res.maxFormula, rechargeType: res.currentRechargeType } as FeatureResourceInfo;
        })()}
        execution={(() => {
          if (!selectedFeat || !classResources) return null;
          const res = classResources.find(r => (selectedFeat as any).id ? r.id === (selectedFeat as any).id : (r.name === selectedFeat.name || r.nameEn === selectedFeat.nameEn));
          return findResourceExecution(res?.id);
        })()}
        spellSlotInfo={(() => {
          if (!spellcasting) return undefined;
          return { max: spellcasting.spellSlots, remaining: remainingSlots?.length ? remainingSlots : spellcasting.spellSlots };
        })()}
        abilityScores={finalAbilityScores}
        characterLevel={character.level || 1}
        selectionText={selectedFeatSelection}
        onUseResource={async (resourceId, amount) => {
          try {
            const resp = await apiFetch(`/api/characters/${character.id}/resources/use`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ resource_id: resourceId, amount, campaign_id: campaignId ? Number(campaignId) : undefined }),
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            publishAppEvent('classFeatureUsesUpdated', { characterId: character.id });
            // Play sound and show bubble
            playResourceSound(resourceId);
            const resName = classResources?.find(r => r.id === resourceId)?.name || resourceId;
            showCharacterBubble({
              characterId: character.id,
              characterName: character.name,
              message: `使用了 ${resName}`,
              type: 'action',
              avatarUrl: character.avatar_url || undefined,
            });
            return data.current ?? null;
          } catch { return null; }
        }}
        isDM={isDM}
        onStartTargeting={onStartAbilityTargeting ? (resourceId, poolCurrent, poolMax) => {
          if (isIncapacitated) { publishAppEvent("showToast", { message: '💫 失能状态下无法使用', type: 'warning' }); return; }
          onStartAbilityTargeting(resourceId, poolCurrent, poolMax);
        } : undefined}
        onStartSmiteTargeting={isIncapacitated ? undefined : onStartSmiteTargeting}
        onConsumeSpellSlot={onConsumeSlot ? (level, resourceId) => {
          onConsumeSlot(level);
          // Broadcast usage in chat via backend
          apiFetch(`/api/characters/${character.id}/resources/use`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resource_id: resourceId, amount: 1, spell_slot_level: level, campaign_id: campaignId ? Number(campaignId) : undefined }),
          }).catch(() => {});
          const resName = classResources?.find(r => r.id === resourceId)?.name || resourceId;
          playResourceSound(resourceId);
          showCharacterBubble({
            characterId: character.id,
            characterName: character.name,
            message: `使用了 ${resName}`,
            type: 'action',
            avatarUrl: character.avatar_url || undefined,
          });
        } : undefined}
        onSetResource={isDM ? async (resourceId, value) => {
          try {
            const resp = await apiFetch(`/api/characters/${character.id}/resources/set`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ resource_id: resourceId, value, campaign_id: campaignId ? Number(campaignId) : undefined }),
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            onResourceChanged?.();
            publishAppEvent('classFeatureUsesUpdated', { characterId: character.id });
            return data.current ?? null;
          } catch { return null; }
        } : undefined}
      />

      {/* Invocation Detail Modal */}
      <FeatureDetailDialog
        open={invDetailOpen}
        onOpenChange={setInvDetailOpen}
        feature={selectedInv ? {
          name: selectedInv.name,
          nameEn: selectedInv.nameEn,
          level: selectedInv.level || undefined,
          description: selectedInv.description,
          source: '魔能祈唤',
        } : null}
        resource={(() => {
          if (!selectedInv || selectedInv.isAtWill || !selectedInv.matchedResource) return null;
          const r = selectedInv.matchedResource;
          return { id: r.id, current: r.current, max: r.max, maxFormula: r.maxFormula, rechargeType: r.currentRechargeType } as FeatureResourceInfo;
        })()}
        abilityScores={finalAbilityScores}
        characterLevel={character.level || 1}
        onUseResource={async (resourceId, amount) => {
          try {
            const resp = await apiFetch(`/api/characters/${character.id}/resources/use`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ resource_id: resourceId, amount, campaign_id: campaignId ? Number(campaignId) : undefined }),
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            publishAppEvent('classFeatureUsesUpdated', { characterId: character.id });
            playResourceSound(resourceId);
            showCharacterBubble({
              characterId: character.id,
              characterName: character.name,
              message: `施展了 ${selectedInv?.name || resourceId}`,
              type: 'action',
              avatarUrl: character.avatar_url || undefined,
            });
            return data.current ?? null;
          } catch { return null; }
        }}
        isDM={isDM}
        onSetResource={isDM ? async (resourceId, value) => {
          try {
            const resp = await apiFetch(`/api/characters/${character.id}/resources/set`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ resource_id: resourceId, value, campaign_id: campaignId ? Number(campaignId) : undefined }),
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            onResourceChanged?.();
            publishAppEvent('classFeatureUsesUpdated', { characterId: character.id });
            return data.current ?? null;
          } catch { return null; }
        } : undefined}
        onAtWillCast={selectedInv?.isAtWill ? () => {
          playResourceSound('inv_at_will');
          showCharacterBubble({
            characterId: character.id,
            characterName: character.name,
            message: `施展了 ${selectedInv.name}（随意）`,
            type: 'action',
            avatarUrl: character.avatar_url || undefined,
          });
        } : undefined}
        atWillCastLabel="随意施展"
      />

      {/* Companion Detail Modal */}
      {character.subclass_choices?.beastCompanion && (() => {
        const beastId = character.subclass_choices!.beastCompanion;
        const beast = (companionsData as any).categories.beast_master.creatures.find((c: any) => c.id === beastId);
        if (!beast) return null;
        const abs = beast.abilityScores || {};
        const speeds = beast.speed || {};
        const speedStr = Object.entries(speeds).map(([k, v]) => {
          const labels: Record<string, string> = { walk: '步行', fly: '飞行', swim: '游泳', climb: '攀爬', burrow: '掘地' };
          return `${labels[k] || k} ${v}ft`;
        }).join(', ');
        return (
          <Dialog.Root open={companionDetailOpen} onOpenChange={setCompanionDetailOpen}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[10198]" />
              <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[10200] w-[480px] max-h-[85vh] overflow-y-auto bg-gray-900 border border-green-700/50 rounded-lg shadow-xl p-5">
                <Dialog.Title className="text-base font-bold text-green-400 flex items-center gap-2 mb-3">
                  <span>🐾</span> {beast.name} <span className="text-green-600 text-sm font-normal">{beast.nameEn}</span>
                </Dialog.Title>

                {/* Basic Info */}
                <div className="text-xs text-gray-400 mb-3">
                  {beast.size} {beast.type}，挑战等级 {beast.cr} ({beast.xp} XP)
                </div>

                {/* Core Stats */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-gray-800/60 rounded-lg p-2.5 text-center border border-gray-700/50">
                    <div className="text-[10px] text-gray-500">护甲等级</div>
                    <div className="text-xl font-bold text-amber-400">{beast.ac}</div>
                  </div>
                  <div className="bg-gray-800/60 rounded-lg p-2.5 text-center border border-gray-700/50">
                    <div className="text-[10px] text-gray-500">生命值</div>
                    <div className="text-xl font-bold text-red-400">{beast.hp}</div>
                    <div className="text-[10px] text-gray-500">{beast.hpFormula}</div>
                  </div>
                  <div className="bg-gray-800/60 rounded-lg p-2.5 text-center border border-gray-700/50">
                    <div className="text-[10px] text-gray-500">速度</div>
                    <div className="text-sm font-medium text-blue-400">{speedStr}</div>
                  </div>
                </div>

                {/* Ability Scores */}
                <div className="grid grid-cols-6 gap-1.5 mb-4">
                  {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map(k => {
                    const labels: Record<string, string> = { str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力' };
                    const val = abs[k] ?? 10;
                    const mod = abs[`${k}Mod`] ?? Math.floor((val - 10) / 2);
                    return (
                      <div key={k} className="bg-gray-800/40 rounded-lg p-1.5 text-center border border-gray-700/30">
                        <div className="text-[9px] text-gray-500">{labels[k]}</div>
                        <div className="text-sm font-bold text-gray-200">{val}</div>
                        <div className="text-[10px] text-gray-400">({mod >= 0 ? '+' : ''}{mod})</div>
                      </div>
                    );
                  })}
                </div>

                {/* Skills & Senses */}
                {(beast.skills || beast.senses) && (
                  <div className="mb-4 space-y-1.5 bg-gray-800/30 rounded-lg p-2.5 border border-gray-700/30">
                    {beast.skills && (
                      <div className="text-xs"><span className="text-gray-500">技能：</span><span className="text-gray-300">{beast.skills}</span></div>
                    )}
                    {beast.senses?.passivePerception && (
                      <div className="text-xs"><span className="text-gray-500">被动察觉：</span><span className="text-gray-300">{beast.senses.passivePerception}</span></div>
                    )}
                  </div>
                )}

                {/* Special Abilities */}
                {beast.specialAbilities?.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-bold text-amber-400 mb-2 border-b border-amber-400/20 pb-1">特殊能力</div>
                    {beast.specialAbilities.map((a: any, i: number) => (
                      <div key={i} className="mb-2">
                        <div className="text-xs font-medium text-green-300">{a.name}</div>
                        <div className="text-[11px] text-gray-400 leading-relaxed mt-0.5">{a.description}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions */}
                {beast.actions?.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs font-bold text-red-400 mb-2 border-b border-red-400/20 pb-1">动作</div>
                    {beast.actions.map((a: any, i: number) => (
                      <div key={i} className="mb-2">
                        <div className="text-xs font-medium text-orange-300">{a.name}</div>
                        <div className="text-[11px] text-gray-400 leading-relaxed mt-0.5">{a.description}</div>
                      </div>
                    ))}
                  </div>
                )}

                <Dialog.Close asChild>
                  <button className="mt-2 w-full py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-600/50 transition-colors">
                    关闭
                  </button>
                </Dialog.Close>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        );
      })()}

      {/* Familiar Detail Modal */}
      {(character.subclass_choices?.familiarForm || localFamiliarForm) && (() => {
        const familiarId = character.subclass_choices?.familiarForm || localFamiliarForm;
        const familiar = (companionsData as any).categories.find_familiar?.creatures?.find((c: any) => c.id === familiarId);
        if (!familiar) return null;
        const abs = familiar.abilityScores || {};
        const speeds = familiar.speed || {};
        const speedStr = Object.entries(speeds).map(([k, v]) => {
          const labels: Record<string, string> = { walk: '步行', fly: '飞行', swim: '游泳', climb: '攀爬', burrow: '掘地' };
          return `${labels[k] || k} ${v}ft`;
        }).join(', ');
        return (
          <Dialog.Root open={familiarDetailOpen} onOpenChange={setFamiliarDetailOpen}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[10198]" />
              <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[10200] w-[480px] max-h-[85vh] overflow-y-auto bg-gray-900 border border-purple-700/50 rounded-lg shadow-xl p-5">
                <Dialog.Title className="text-base font-bold text-purple-400 flex items-center gap-2 mb-3">
                  <span>🔮</span> {familiar.name} <span className="text-purple-600 text-sm font-normal">{familiar.nameEn}</span>
                </Dialog.Title>

                <div className="text-xs text-gray-400 mb-3">
                  {familiar.size} {familiar.type}，挑战等级 {familiar.cr} ({familiar.xp} XP)
                </div>

                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-gray-800/60 rounded-lg p-2.5 text-center border border-gray-700/50">
                    <div className="text-[10px] text-gray-500">护甲等级</div>
                    <div className="text-xl font-bold text-amber-400">{familiar.ac}</div>
                  </div>
                  <div className="bg-gray-800/60 rounded-lg p-2.5 text-center border border-gray-700/50">
                    <div className="text-[10px] text-gray-500">生命值</div>
                    <div className="text-xl font-bold text-red-400">{familiar.hp}</div>
                    <div className="text-[10px] text-gray-500">{familiar.hpFormula}</div>
                  </div>
                  <div className="bg-gray-800/60 rounded-lg p-2.5 text-center border border-gray-700/50">
                    <div className="text-[10px] text-gray-500">速度</div>
                    <div className="text-sm font-medium text-blue-400">{speedStr}</div>
                  </div>
                </div>

                <div className="grid grid-cols-6 gap-1.5 mb-4">
                  {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map(k => {
                    const labels: Record<string, string> = { str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力' };
                    const val = abs[k] ?? 10;
                    const mod = abs[`${k}Mod`] ?? Math.floor((val - 10) / 2);
                    return (
                      <div key={k} className="bg-gray-800/40 rounded-lg p-1.5 text-center border border-gray-700/30">
                        <div className="text-[9px] text-gray-500">{labels[k]}</div>
                        <div className="text-sm font-bold text-gray-200">{val}</div>
                        <div className="text-[10px] text-gray-400">({mod >= 0 ? '+' : ''}{mod})</div>
                      </div>
                    );
                  })}
                </div>

                {(familiar.skills || familiar.senses) && (
                  <div className="mb-4 space-y-1.5 bg-gray-800/30 rounded-lg p-2.5 border border-gray-700/30">
                    {familiar.skills && (
                      <div className="text-xs"><span className="text-gray-500">技能：</span><span className="text-gray-300">{familiar.skills}</span></div>
                    )}
                    {familiar.senses?.darkvision && (
                      <div className="text-xs"><span className="text-gray-500">黑暗视觉：</span><span className="text-gray-300">{familiar.senses.darkvision}尺</span></div>
                    )}
                    {familiar.senses?.blindsight && (
                      <div className="text-xs"><span className="text-gray-500">盲视：</span><span className="text-gray-300">{familiar.senses.blindsight}尺</span></div>
                    )}
                    {familiar.senses?.passivePerception && (
                      <div className="text-xs"><span className="text-gray-500">被动察觉：</span><span className="text-gray-300">{familiar.senses.passivePerception}</span></div>
                    )}
                  </div>
                )}

                {familiar.specialAbilities?.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-bold text-amber-400 mb-2 border-b border-amber-400/20 pb-1">特殊能力</div>
                    {familiar.specialAbilities.map((a: any, i: number) => (
                      <div key={i} className="mb-2">
                        <div className="text-xs font-medium text-purple-300">{a.name}</div>
                        <div className="text-[11px] text-gray-400 leading-relaxed mt-0.5">{a.description}</div>
                      </div>
                    ))}
                  </div>
                )}

                {familiar.actions?.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs font-bold text-red-400 mb-2 border-b border-red-400/20 pb-1">动作</div>
                    {familiar.actions.map((a: any, i: number) => (
                      <div key={i} className="mb-2">
                        <div className="text-xs font-medium text-orange-300">{a.name}</div>
                        <div className="text-[11px] text-gray-400 leading-relaxed mt-0.5">{a.description}</div>
                      </div>
                    ))}
                  </div>
                )}

                <Dialog.Close asChild>
                  <button className="mt-2 w-full py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-600/50 transition-colors">
                    关闭
                  </button>
                </Dialog.Close>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        );
      })()}

      {/* Familiar Pick Modal */}
      <Dialog.Root open={familiarPickOpen} onOpenChange={(open) => { setFamiliarPickOpen(open); if (!open) setFamiliarPickDetail(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[10198]" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[10200] w-[520px] max-h-[85vh] overflow-y-auto bg-gray-900 border border-purple-700/50 rounded-lg shadow-xl p-5">
            <Dialog.Title className="text-base font-bold text-purple-400 flex items-center gap-2 mb-2">
              🔮 选择魔宠形态
            </Dialog.Title>
            <p className="text-sm text-gray-400 mb-4">
              作为锁链契约的邪术士，你的护佑者赐予你召唤特殊魔宠的能力。选择一个魔宠形态。
            </p>
            <div className="space-y-2">
              {(companionsData as any).categories.find_familiar.creatures.map((f: any) => {
                const isExpanded = familiarPickDetail === f.id;
                const ab = f.abilityScores;
                return (
                  <div key={f.id} className="rounded-lg border border-gray-700 hover:border-purple-600 transition-colors overflow-hidden">
                    <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => setFamiliarPickDetail(isExpanded ? null : f.id)}>
                      <img
                        src={getAssetUrl(`assets/monster-avatars/${f.id}_128.webp`)}
                        alt={f.name}
                        className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-purple-700/50 hover:ring-2 hover:ring-purple-400 transition-all cursor-zoom-in"
                        onClick={(e) => { e.stopPropagation(); setFamiliarAvatarPreview(f.id); }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm">{f.name}</span>
                          <span className="text-xs text-gray-500">{f.nameEn}</span>
                          <span className="text-xs text-gray-500 ml-auto">CR {f.cr}</span>
                        </div>
                        <div className="flex gap-3 text-xs text-gray-400 mt-0.5">
                          <span>AC {f.ac}</span>
                          <span>HP {f.hp}</span>
                          <span>{f.size} {f.type}</span>
                          <span className="text-purple-400/70">{f.trait}</span>
                        </div>
                      </div>
                      <span className={`text-gray-500 text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                    </div>

                    {isExpanded && (
                      <div className="px-3 pb-3 border-t border-gray-700/50 pt-2 space-y-2.5">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-300">
                          <span><span className="text-gray-500">HP</span> {f.hp} ({f.hpFormula})</span>
                          <span><span className="text-gray-500">速度</span> {Object.entries(f.speed).map(([k, v]) => {
                            const labels: Record<string, string> = { walk: '步行', fly: '飞行', swim: '游泳', climb: '攀爬', burrow: '掘穴' };
                            return `${labels[k] || k} ${v}尺`;
                          }).join('，')}</span>
                        </div>
                        <div className="grid grid-cols-6 gap-1 text-center bg-gray-800/60 rounded p-1.5 text-xs">
                          {(['str','dex','con','int','wis','cha'] as const).map(key => (
                            <div key={key}>
                              <div className="text-gray-500 text-[9px]">{({str:'力量',dex:'敏捷',con:'体质',int:'智力',wis:'感知',cha:'魅力'} as const)[key]}</div>
                              <div className="text-white font-bold">{ab[key]}</div>
                              <div className="text-gray-400 text-[10px]">({ab[`${key}Mod` as keyof typeof ab] >= 0 ? '+' : ''}{ab[`${key}Mod` as keyof typeof ab]})</div>
                            </div>
                          ))}
                        </div>
                        {f.skills && <div className="text-xs"><span className="text-gray-500">技能</span> <span className="text-gray-300">{f.skills}</span></div>}
                        {f.senses && <div className="text-xs"><span className="text-gray-500">感官</span> <span className="text-gray-300">{Object.entries(f.senses).map(([k, v]: [string, any]) => {
                          const labels: Record<string, string> = { darkvision: '黑暗视觉', blindsight: '盲视', passivePerception: '被动察觉' };
                          return `${labels[k] || k} ${v}${k === 'passivePerception' ? '' : '尺'}`;
                        }).join('，')}</span></div>}
                        {f.specialAbilities?.length > 0 && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1">特殊能力</div>
                            {f.specialAbilities.map((sa: any, i: number) => (
                              <div key={i} className="text-xs mb-1"><span className="text-purple-400">{sa.name}</span> <span className="text-gray-400">{sa.description}</span></div>
                            ))}
                          </div>
                        )}
                        <div>
                          <div className="text-xs text-gray-500 mb-1">动作</div>
                          {f.actions.map((a: any, i: number) => (
                            <div key={i} className="text-xs mb-1"><span className="text-amber-400">{a.name}</span> <span className="text-gray-400">{a.description}</span></div>
                          ))}
                        </div>
                        <button
                          className="w-full mt-1 py-1.5 text-sm bg-purple-800/50 hover:bg-purple-700/60 text-purple-200 rounded-lg border border-purple-600/50 transition-colors font-medium"
                          onClick={async () => {
                            try {
                              const resp = await apiFetch(`/api/characters/${character.id}/set-familiar`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  familiar_id: f.id,
                                  campaign_id: campaignId ? parseInt(campaignId as string) : undefined,
                                }),
                              });
                              if (resp.ok) {
                                setLocalFamiliarForm(f.id);
                                setFamiliarPickOpen(false);
                                setFamiliarPickDetail(null);
                                publishAppEvent('characterUpdated', {});
                              }
                            } catch (e) { /* ignore */ }
                          }}
                        >
                          选择 {f.name}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Dialog.Close asChild>
              <button className="mt-4 w-full py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-600/50 transition-colors">
                取消
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Racial Spell Detail Modal — same style as SpellSection detail */}
      <UnifiedSpellCastDialog
        spell={racialSpellDetail}
        onClose={() => setRacialSpellDetail(null)}
        spellTransform={(s) => applyCharacterSpellModifiers(s, { subclassId: character.subclass_id ?? undefined })}
        spellSlots={spellcasting?.spellSlots || []}
        remainingSlots={spellcasting ? Object.keys(remainingSlots).reduce((arr, k) => {
          const i = Number(k);
          arr[i] = remainingSlots[i] ?? spellcasting.spellSlots[i] ?? 0;
          return arr;
        }, [...spellcasting.spellSlots]) : []}
        selectedCastLevel={(racialSpellDetail as any)?.level ?? 0}
        onSelectCastLevel={() => {}}
        concentrationSpellName={concentrationSpell?.spell_name}
        castingSpellName={castingSpellName}
        equipment={equipment}
        hasSomaticFreedom={hasSomaticFreedom}
        onCast={(castData) => {
          const spellLevel = (racialSpellDetail as any)?.level ?? 0;
          if (onCastSpell) {
            onCastSpell({ ...castData, level: spellLevel });
          } else if (racialSpellDetail && character.id && campaignId) {
            castSpellAction(racialSpellDetail, spellLevel, character.id, {
              campaignId, currentMapUrl, userId,
              spellSaveDC: spellcasting?.spellSaveDC,
              ritualCast: castData.ritualCast,
              confirmBreakConcentration: castData.confirmBreakConcentration,
              illusionImageUrl: castData.illusionData?.imageUrl,
              illusionDesc: castData.illusionData?.description,
              illusionDisplayName: castData.illusionData?.displayName,
              areaSize: castData.areaSize,
              selectedOption: castData.selectedOption,
              materialId: castData.materialId,
              targetingMode: castData.targetingMode,
            });
          }
          setRacialSpellDetail(null);
        }}
      />

      {/* Familiar Avatar Preview */}
      {familiarAvatarPreview && (
        <div
          className="fixed inset-0 bg-black/80 z-[10200] flex items-center justify-center cursor-pointer"
          onClick={() => setFamiliarAvatarPreview(null)}
        >
          <img
            src={getAssetUrl(`assets/monster-avatars/${familiarAvatarPreview}_512.webp`)}
            alt=""
            className="max-w-[400px] max-h-[400px] rounded-xl border-2 border-purple-600/50 shadow-2xl"
          />
        </div>
      )}

      {/* Equipment slot context menu */}
      {equipMenuState && (
        <EquippedItemMenu
          x={equipMenuState.x}
          y={equipMenuState.y}
          item={equipMenuState.item}
          slot={equipMenuState.slot}
          onClose={() => setEquipMenuState(null)}
          onUse={() => {
            if (isIncapacitated) {
              publishAppEvent("showToast", { message: '💫 失能状态下无法使用', type: 'warning' });
              return;
            }
            const { item, slot } = equipMenuState;
            if (
              (slot === "main_hand" || slot === "off_hand") &&
              (findWeaponMetaById(item.id) || item.equipmentType === "weapon" || item.damage)
            ) {
              publishAppEvent("equipmentWeaponUse", {
                characterId: character.id,
                item,
                slot,
              });
            } else if (getConsumableData(item)) {
              // Consumable use: dispatch event for parent to handle
              publishAppEvent("equipmentConsumableUse", {
                characterId: character.id,
                item,
              });
            }
          }}
          onReplace={() => onOpenEquipment?.(equipMenuState.slot)}
          onDetail={() => {
            setEquipDetailItem(equipMenuState.item);
            setEquipDetailOpen(true);
          }}
        />
      )}

      {/* Equipment item detail modal */}
      <ItemInfoModal
        open={equipDetailOpen}
        onOpenChange={setEquipDetailOpen}
        item={equipDetailItem}
        character={character}
      />
    </div>
  );
}
