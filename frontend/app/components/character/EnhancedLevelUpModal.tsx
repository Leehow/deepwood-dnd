import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMulticlass } from '~/hooks/useMulticlass';
import { useAllClassData } from '~/hooks/useClassData';
import { ASISelector } from './ASISelector';
import { ExpertiseSelector } from './ExpertiseSelector';
import { SpellSelector } from './SpellSelector';
import { ManeuverSelector } from './ManeuverSelector';
import { EldritchInvocationSelector } from './EldritchInvocationSelector';
import multiclassConfig from '~/data/rules/multiclass-requirements.json';
import subclassSpellsData from '~/data/rules/subclass-spells.json';
import spellsJsonData from '~/data/rules/spells.json';
import companionsData from '~/data/rules/companions.json';
import spellcastingJsonData from '~/data/rules/spellcasting.json';
import { isPreparedCaster as isPreparedCasterUtil, maxSpellLevelForClass, spellcastingAbilityMap, getRacialSpells } from './CharacterDisplay/utils/spellcasting';
import type { SpellSelection } from './CharacterDisplay/types/Character';
import { extractSpellIds } from '~/utils/spellHelpers';
import { SpellDetailModal } from '~/components/spell/SpellSelectableCard';
import type { Spell } from '~/types/spell';
import { getAssetUrl } from '~/utils/asset-url';
import { Sparkles, X, ChevronRight, ChevronDown, Info, ArrowRight, Shield, BookOpen, Star, AlertCircle, Eye, Sword, Heart, Dices, Zap } from 'lucide-react';
import { computeFinalAbilityScores, computeProficiencyBonus, computeHP } from './CharacterDisplay/utils/derived';
import { getModifier } from './CharacterDisplay/utils/ability';
import classesWithSubclassFeatures from '~/data/rules/classes_with_structured_subclass_features.json';
import classesProgressionData from '~/data/rules/classes-progression.json';
import { useModalContextStore } from '~/stores/modalContextStore';
import { buildCharacterSummary } from '~/utils/buildCharacterSummary';
import { isClickInsideFloatingChat } from '~/utils/floatingChatGuard';

/** 查找稀疏表中 <= level 的最大键对应的值（如 {2:2, 5:4} 查 level=4 返回 2） */
function lookupSparse(table: Record<string | number, number> | undefined, level: number): number {
  if (!table) return 0;
  let result = 0;
  for (const key of Object.keys(table)) {
    const k = Number(key);
    if (k <= level) result = table[key];
  }
  return result;
}

const ABILITY_NAMES: Record<string, string> = {
  strength: '力量', dexterity: '敏捷', constitution: '体质',
  intelligence: '智力', wisdom: '感知', charisma: '魅力',
};

function formatPrerequisite(prereq: Record<string, any>): string {
  if (prereq.or) {
    return prereq.or.map((p: Record<string, number>) => {
      const [attr, val] = Object.entries(p)[0];
      return `${ABILITY_NAMES[attr] || attr} ${val}`;
    }).join(' 或 ');
  }
  return Object.entries(prereq)
    .map(([attr, val]) => `${ABILITY_NAMES[attr] || attr} ${val}`)
    .join('、');
}

const SCHOOL_ICONS: Record<string, string> = {
  abjuration: '🛡️', conjuration: '🌀', divination: '👁️', enchantment: '💫',
  evocation: '🔥', illusion: '🌫️', necromancy: '💀', transmutation: '⚗️',
};
const SCHOOL_CN: Record<string, string> = {
  abjuration: '防护', conjuration: '咒法', divination: '预言', enchantment: '惑控',
  evocation: '塑能', illusion: '幻术', necromancy: '死灵', transmutation: '变化'
};

// Subclass feature types that should resolve to specific subclass feature names
const SUBCLASS_FEATURE_TYPES = new Set([
  'tradition_feature', 'domain_feature', 'oath_feature', 'patron_feature',
  'path_feature', 'archetype_feature', 'college_feature', 'circle_feature',
  'origin_feature',
]);

/**
 * Look up the character's subclass and return the specific feature name for a given level.
 * Parses the "features" string like "防护学者（2级）、奥术护盾（2级）、投影护盾（6级）" etc.
 */
function resolveSubclassFeature(classId: string, subclassId: string | null | undefined, level: number): { subclassName: string; featureNames: string[]; featureDescriptions: string[] } | null {
  if (!subclassId) return null;
  const cls = (classesWithSubclassFeatures as any).classes?.find((c: any) => c.id === classId);
  if (!cls?.subclasses) return null;
  const sc = cls.subclasses.find((s: any) => s.id === subclassId);
  if (!sc) return null;

  const featuresStr: string = sc.features || '';
  // Parse "特性名（N级）" patterns, separated by "、"
  const parts = featuresStr.split('、');
  const featureNames: string[] = [];
  for (const part of parts) {
    const match = part.trim().match(/^(.+?)（(\d+)级）$/);
    if (match && parseInt(match[2]) === level) {
      featureNames.push(match[1]);
    }
  }
  if (featureNames.length === 0) return null;

  // Look up detailed descriptions from classes-progression.json
  // Subclass choices are nested in levelProgression[level].features[].choices[]
  const featureDescriptions: string[] = [];
  const progClass = (classesProgressionData as any).classes?.[classId];
  let progSubclass: any = null;
  if (progClass?.levelProgression) {
    for (const lvlData of Object.values(progClass.levelProgression) as any[]) {
      for (const feat of lvlData.features || []) {
        if (feat.type === 'subclass' && feat.choices) {
          const found = feat.choices.find((c: any) => c.id === subclassId);
          if (found) { progSubclass = found; break; }
        }
      }
      if (progSubclass) break;
    }
  }
  for (const name of featureNames) {
    const feat = progSubclass?.features?.find((f: any) => f.name === name && f.level === level);
    featureDescriptions.push(feat?.description || '');
  }

  return { subclassName: sc.name, featureNames, featureDescriptions };
}

/**
 * 获取子职业赠送的戏法列表（合并 structuredData.bonusCantrips + grantedCantrip 字段）
 */
function getSubclassBonusCantrips(classId: string, subclassId: string): string[] {
  const result: string[] = [];

  // 1. 从 classes_with_structured_subclass_features.json 读取 bonusCantrips
  const cls = (classesWithSubclassFeatures as any).classes?.find((c: any) => c.id === classId);
  if (cls?.subclasses) {
    const sc = cls.subclasses.find((s: any) => s.id === subclassId);
    if (sc?.level1Features) {
      for (const f of sc.level1Features) {
        if (f.structuredData?.bonusCantrips?.length) {
          result.push(...f.structuredData.bonusCantrips);
        }
      }
    }
  }

  // 2. 从 classes-progression.json 读取子职业特性的 grantedCantrip 字段
  const progClass = (classesProgressionData as any).classes?.[classId];
  if (progClass?.levelProgression) {
    for (const levelData of Object.values(progClass.levelProgression) as any[]) {
      for (const feature of (levelData.features || [])) {
        if (feature.type === 'subclass' && feature.choices) {
          const choice = feature.choices.find((c: any) => c.id === subclassId);
          if (choice?.features) {
            for (const feat of choice.features) {
              if (feat.grantedCantrip) {
                result.push(feat.grantedCantrip);
              }
            }
          }
        }
      }
    }
  }

  // 去重
  return [...new Set(result)];
}

/**
 * 获取子职业的"可选赠送戏法"配置（如自然领域选一个德鲁伊戏法）
 * 返回 { list: string, count: number } 或 null
 */
function getSubclassBonusCantripChoice(classId: string, subclassId: string): { list: string; count: number } | null {
  // 优先从 structured subclass features 读取
  const cls = (classesWithSubclassFeatures as any).classes?.find((c: any) => c.id === classId);
  if (cls?.subclasses) {
    const sc = cls.subclasses.find((s: any) => s.id === subclassId);
    if (sc?.level1Features) {
      for (const f of sc.level1Features) {
        if (f.structuredData?.bonusCantripChoice) {
          return f.structuredData.bonusCantripChoice;
        }
      }
    }
  }

  // 也从 classes-progression.json 读取
  const progClass = (classesProgressionData as any).classes?.[classId];
  if (progClass?.levelProgression) {
    for (const levelData of Object.values(progClass.levelProgression) as any[]) {
      for (const feature of (levelData.features || [])) {
        if (feature.type === 'subclass' && feature.choices) {
          const choice = feature.choices.find((c: any) => c.id === subclassId);
          if (choice?.features) {
            for (const feat of choice.features) {
              if (feat.bonusCantripChoice) {
                return feat.bonusCantripChoice;
              }
            }
          }
        }
      }
    }
  }

  return null;
}

interface Character {
  id: number;
  name: string;
  class_id: string;
  level: number;
  race_id?: string;
  subrace_id?: string | null;
  subclass_id?: string | null;
  multiclass_data?: any;
  ability_scores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  feats?: (string | { id?: string; value?: string })[];
  fighting_style?: string;
  eldritch_invocations?: string[];
  selected_skills?: string[];
  expertise_skills?: string[];
  // Support both old and new spell formats
  selected_spells?: SpellSelection[] | string[];
  selected_cantrips?: SpellSelection[] | string[];
  prepared_spells?: string[];
  // Battle Master maneuvers
  maneuvers_known?: string[];
  race_choices?: Record<string, any>;
}

interface LevelUpModalProps {
  isOpen: boolean;
  character: Character;
  newLevel: number;
  onConfirm: (classChoice: string, featureChoices?: any) => void;
  onCancel: () => void;
}

export function EnhancedLevelUpModal({
  isOpen,
  character,
  newLevel,
  onConfirm,
  onCancel
}: LevelUpModalProps) {
  const { multiclassData, getAvailableClasses, getClassName, canMulticlass } = useMulticlass(character);
  const { classesData, loading: loadingClasses } = useAllClassData();
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [featureChoices, setFeatureChoices] = useState<Record<string, any>>({});
  const [currentStep, setCurrentStep] = useState<'class' | 'features'>('class');
  const [expandedSubclassId, setExpandedSubclassId] = useState<string | null>(null);
  const [preparedCasterSpells, setPreparedCasterSpells] = useState<Spell[]>([]);
  const [detailSpell, setDetailSpell] = useState<Spell | null>(null);
  const [companionDetail, setCompanionDetail] = useState<string | null>(null);
  const [familiarDetail, setFamiliarDetail] = useState<string | null>(null);
  const [familiarAvatarPreview, setFamiliarAvatarPreview] = useState<string | null>(null);

  // Reset state when modal is closed
  useEffect(() => {
    if (!isOpen) {
      setSelectedClass('');
      setFeatureChoices({});
      setCurrentStep('class');
      setExpandedSubclassId(null);
    }
  }, [isOpen]);

  // Register modal context for AI chat awareness
  const setModalContext = useModalContextStore(s => s.setModalContext);
  const clearModalContext = useModalContextStore(s => s.clearModalContext);
  useEffect(() => {
    if (isOpen) {
      const charSummary = buildCharacterSummary(character);
      const parts = [`正在升级角色，${character.level}级→${newLevel}级`];
      if (selectedClass) parts.push(`升级选择的职业：${selectedClass}`);
      if (currentStep === 'features') parts.push('当前在选择职业特性');
      // Include in-progress feature choices
      if (featureChoices.subclass) parts.push(`已选子职业：${featureChoices.subclass}`);
      if (featureChoices.asiOrFeat) {
        const asi = featureChoices.asiOrFeat;
        if (asi.type === 'feat') parts.push(`已选专长：${asi.feat}`);
        else if (asi.type === 'asi') parts.push(`已选属性提升：${JSON.stringify(asi.increases)}`);
      }
      if (featureChoices.spells?.learned?.length) {
        const spellNames = featureChoices.spells.learned.map((s: any) => {
          const id = typeof s === 'string' ? s : s.name || s.id;
          // Look up Chinese name from already-imported spells data
          const sp = (spellsJsonData as any).spells?.find((sp: any) => sp.id === id);
          return sp?.name || id;
        }).join('、');
        parts.push(`本次升级已选法术：${spellNames}`);
      }
      if (featureChoices.expertise?.length) parts.push(`已选专精：${featureChoices.expertise.join('、')}`);
      if (featureChoices.fighting_style) parts.push(`已选战斗风格：${featureChoices.fighting_style}`);
      if (featureChoices.eldritch_invocations?.length) parts.push(`已选魔能祈唤：${featureChoices.eldritch_invocations.join('、')}`);
      parts.push(charSummary);
      setModalContext('level-up', parts.join('。'));
    } else {
      clearModalContext('level-up');
    }
  }, [isOpen, character, newLevel, selectedClass, currentStep, featureChoices, setModalContext, clearModalContext]);

  // Load spell list for prepared casters (read-only display)
  useEffect(() => {
    if (!selectedClass || !classesData) { setPreparedCasterSpells([]); return; }
    const isPrepared = isPreparedCasterUtil(selectedClass) && selectedClass !== 'wizard';
    if (!isPrepared) { setPreparedCasterSpells([]); return; }
    const newClassLevel = getNewClassLevel(selectedClass);
    const maxLevel = maxSpellLevelForClass(selectedClass, newClassLevel);
    if (maxLevel <= 0) { setPreparedCasterSpells([]); return; }
    import('~/data/rules/spells.json')
      .then(m => {
        const spells = ((m.default as any).spells || [])
          .filter((s: any) => s.level > 0 && s.level <= maxLevel && s.classes?.includes(selectedClass))
          .sort((a: any, b: any) => a.level - b.level || a.name.localeCompare(b.name, 'zh'));
        setPreparedCasterSpells(spells);
      })
      .catch(() => setPreparedCasterSpells([]));
    setDetailSpell(null);
  }, [selectedClass, classesData]);

  // Get the level in the selected class BEFORE this level up
  // The newLevel prop represents the total character level AFTER level up
  // We need to figure out what the class level was before
  const getClassLevelBeforeLevelUp = (classId: string) => {
    const classData = multiclassData.classes.find(c => c.class_id === classId);
    if (!classData) return 0;

    // The classData.level represents the current level in that class
    // If we're leveling up in this class, it's not yet updated
    return classData.level;
  };

  // Get the NEW level for the selected class after this level up
  const getNewClassLevel = (classId: string) => {
    // When leveling up, we're adding 1 level to the selected class
    const currentLevel = getClassLevelBeforeLevelUp(classId);
    return currentLevel + 1;
  };

  // Get spell slot changes in natural language format
  const getSpellSlotChangesText = (classId?: string) => {
    const changes = getSpellSlotChanges(classId);
    if (!changes) return [];

    const descriptions: string[] = [];
    for (let level = 1; level <= 9; level++) {
      const currentSlots = changes.current?.[level] || 0;
      const newSlots = changes.new?.[level] || 0;

      if (currentSlots === 0 && newSlots > 0) {
        // First time gaining this spell level
        descriptions.push(`🎉 解锁${level}环法术！获得 ${newSlots} 个${level}环法术位`);
      } else if (newSlots > currentSlots) {
        const increase = newSlots - currentSlots;
        descriptions.push(`${level}环法术位增加 ${increase} 个（从 ${currentSlots} 个到 ${newSlots} 个）`);
      } else if (newSlots < currentSlots) {
        const decrease = currentSlots - newSlots;
        descriptions.push(`${level}环法术位减少 ${decrease} 个（从 ${currentSlots} 个到 ${newSlots} 个）`);
      }
    }

    // Add summary if multiple changes
    if (descriptions.length > 1) {
      const totalNew = Object.values(changes.new || {}).reduce((sum, n) => sum + (n || 0), 0);
      const totalCurrent = Object.values(changes.current || {}).reduce((sum, n) => sum + (n || 0), 0);
      if (totalNew > totalCurrent) {
        descriptions.unshift(`📚 总法术位数量：${totalCurrent} → ${totalNew}`);
      }
    }

    return descriptions;
  };

  // Get features for the new level
  const getNewFeatures = () => {
    if (!selectedClass || !classesData) return [];

    const classInfo = classesData[selectedClass];
    if (!classInfo) return [];

    const newClassLevel = getNewClassLevel(selectedClass);
    const levelData = classInfo.levelProgression[newClassLevel.toString()];

    return levelData?.features || [];
  };

  // Get spell slot changes
  const getSpellSlotChanges = (classId?: string) => {
    const cls = classId || selectedClass;
    if (!cls || !classesData) return null;

    const classInfo = classesData[cls];
    const currentClassLevel = getClassLevelBeforeLevelUp(cls);
    const newClassLevel = getNewClassLevel(cls);

    // Subclass casters: use spellcasting.json thirdCaster table
    const subclassId = character.subclass_id;
    const isSubclassCaster =
      (cls === 'fighter' && subclassId === 'eldritch_knight') ||
      (cls === 'rogue' && subclassId === 'arcane_trickster');

    if (isSubclassCaster) {
      const thirdTable = (spellcastingJsonData as any)?.slotTables?.thirdCaster || {};
      const currentSlots = thirdTable[String(currentClassLevel)] || [];
      const newSlots = thirdTable[String(newClassLevel)] || [];
      // Convert arrays to {level: count} format for display
      const toObj = (arr: number[]) => {
        const obj: Record<string, number> = {};
        arr.forEach((v: number, i: number) => { if (v > 0) obj[String(i + 1)] = v; });
        return obj;
      };
      return { current: toObj(currentSlots), new: toObj(newSlots) };
    }

    if (!classInfo?.spellcasting) return null;

    const currentSlots = currentClassLevel > 0
      ? classInfo.levelProgression[currentClassLevel.toString()]?.spellSlots
      : {};
    const newSlots = classInfo.levelProgression[newClassLevel.toString()]?.spellSlots || {};

    return { current: currentSlots, new: newSlots };
  };

  // Get newly unlocked racial spells at the new total level
  const getNewRacialSpells = () => {
    if (!character.race_id) return [];
    const oldLevel = character.level;
    const raceChoices = (character as any).race_choices || (character as any).raceChoices;
    const oldSpells = getRacialSpells(character.race_id, character.subrace_id ?? null, oldLevel, raceChoices);
    const newSpells = getRacialSpells(character.race_id, character.subrace_id ?? null, newLevel, raceChoices);
    const oldIds = new Set(oldSpells.map((s) => s.id));
    const unlocked = newSpells.filter((s) => !oldIds.has(s.id));
    // Resolve display names
    const allSpells = (spellsJsonData as any).spells || [];
    return unlocked.map((rs) => {
      const sp = allSpells.find((s: any) => s.id === rs.id);
      return { ...rs, displayName: sp?.name || rs.id, usesPerDay: rs.usesPerDay };
    });
  };

  // Compute stat changes for a given class choice (used in cards and features header)
  const computeLevelUpStats = (classId: string) => {
    const ci = classesData?.[classId];
    if (!ci) return null;
    const hitDie = ci.hitDie || 8;
    const finalScores = computeFinalAbilityScores(character);
    const conMod = getModifier(finalScores.constitution);
    const classLevelBefore = getClassLevelBeforeLevelUp(classId);
    // 1st level in a class = full hit die; subsequent levels = average
    const hpGain = classLevelBefore === 0
      ? hitDie + conMod
      : Math.ceil(hitDie / 2) + 1 + conMod;
    const currentHP = computeHP(character);
    const newHP = currentHP + hpGain;
    const currentHitDice = character.level;
    const newHitDice = newLevel;
    const oldProf = computeProficiencyBonus(character.level);
    const newProf = computeProficiencyBonus(newLevel);
    const profChanged = newProf !== oldProf;
    const slotChanges = getSpellSlotChangesText(classId);
    const racialSpells = getNewRacialSpells();
    return { hitDie, conMod, hpGain, currentHP, newHP, currentHitDice, newHitDice, classLevelBefore, oldProf, newProf, profChanged, slotChanges, racialSpells };
  };

  // Get spells to learn at new level
  const getSpellsToLearn = () => {
    if (!selectedClass || !classesData) return null;

    const classInfo = classesData[selectedClass];
    const currentClassLevel = getClassLevelBeforeLevelUp(selectedClass);
    const newClassLevel = getNewClassLevel(selectedClass);

    // Check for subclass spellcasting (Eldritch Knight, Arcane Trickster)
    const subclassId = character.subclass_id;
    const subclassChoice = classInfo?.levelProgression?.["3"]?.features
      ?.find((f: any) => f.type === 'subclass')
      ?.choices?.find((c: any) => c.id === subclassId);
    const subclassSpellcasting = subclassChoice?.spellcasting;

    if (!classInfo?.spellcasting && !subclassSpellcasting) return null;

    // Subclass casters (Eldritch Knight, Arcane Trickster): 1/3 caster
    if (!classInfo?.spellcasting && subclassSpellcasting) {
      const sc = subclassChoice;
      const currentCantrips = lookupSparse(sc.cantripsKnown, currentClassLevel);
      const newCantrips = lookupSparse(sc.cantripsKnown, newClassLevel);
      const cantripsToLearn = newCantrips - currentCantrips;

      const currentSpells = lookupSparse(sc.spellsKnown, currentClassLevel);
      const newSpells = lookupSparse(sc.spellsKnown, newClassLevel);
      const spellsToLearn = newSpells - currentSpells;

      const canReplaceLevels: number[] = sc.canReplaceSpellLevels || [];
      const canReplaceSpells = canReplaceLevels.includes(newClassLevel);

      // 1/3 caster max spell level
      const maxSpellLevel = newClassLevel < 3 ? 0
        : newClassLevel < 7 ? 1
        : newClassLevel < 13 ? 2
        : newClassLevel < 19 ? 3
        : 4;

      return {
        cantripsToLearn,
        spellsToLearn,
        canReplaceSpells,
        maxSpellLevel,
        isSubclassCaster: true,
        spellList: sc.spellList || 'wizard',
        schoolRestriction: sc.schoolRestriction,
        freeSchoolLevels: sc.freeSchoolLevels,
      };
    }

    // Calculate cantrips to learn
    const currentCantrips = lookupSparse(classInfo.cantripsKnown, currentClassLevel);
    const newCantrips = lookupSparse(classInfo.cantripsKnown, newClassLevel);
    let cantripsToLearn = newCantrips - currentCantrips;

    // 子职业赠送戏法：角色已有赠送戏法时，额外+1戏法选择名额
    if (featureChoices.subclass) {
      const bonusCantrips = getSubclassBonusCantrips(selectedClass, featureChoices.subclass);
      if (bonusCantrips.length > 0) {
        const existingCantrips = new Set([
          ...extractSpellIds(character.selected_cantrips || []),
          ...extractSpellIds(character.selected_spells || []),
          // Also check racial cantrips (may not be in selected_cantrips for older characters)
          ...getRacialSpells(character.race_id, character.subrace_id ?? null, character.level || 1, character.race_choices || (character as any).raceChoices)
            .filter(rs => rs.level === 0).map(rs => rs.id),
        ]);
        const alreadyOwned = bonusCantrips.filter(c => existingCantrips.has(c));
        cantripsToLearn += alreadyOwned.length;
      }
    }

    // Calculate spells to learn (for known casters like Bard, Sorcerer, Warlock, Ranger, Paladin)
    if (classInfo.spellsKnown) {
      const currentSpells = lookupSparse(classInfo.spellsKnown, currentClassLevel);
      const newSpells = lookupSparse(classInfo.spellsKnown, newClassLevel);
      const spellsToLearn = newSpells - currentSpells;

      // Can replace spells? (Bard, Sorcerer, Warlock, Ranger can replace one spell on level up)
      const canReplaceSpells = ['bard', 'sorcerer', 'warlock', 'ranger'].includes(selectedClass) && newClassLevel > 1;

      return {
        cantripsToLearn,
        spellsToLearn,
        canReplaceSpells,
        maxSpellLevel: maxSpellLevelForClass(selectedClass, newClassLevel)
      };
    }

    // For prepared casters (Wizard, Cleric, Druid)
    // Wizard learns 2 spells per level automatically
    if (selectedClass === 'wizard') {
      console.log('[DEBUG] Wizard spell learning:', {
        cantripsToLearn,
        spellsToLearn: 2,
        newClassLevel,
        maxSpellLevel: maxSpellLevelForClass(selectedClass, newClassLevel)
      });
      return {
        cantripsToLearn,
        spellsToLearn: 2,  // Wizards always learn 2 spells per level
        canReplaceSpells: false,
        maxSpellLevel: maxSpellLevelForClass(selectedClass, newClassLevel)
      };
    }

    // Cleric and Druid don't "learn" spells, they prepare them
    // Paladin also prepares spells (and doesn't have spellsKnown field)
    if (isPreparedCasterUtil(selectedClass) && selectedClass !== 'wizard') {
      const abilityId = spellcastingAbilityMap[selectedClass];
      const abilityScore = abilityId ? (character.ability_scores?.[abilityId] || 10) : 10;
      const abilityMod = Math.floor((abilityScore - 10) / 2);
      let prepMax: number;
      if (selectedClass === 'paladin') {
        prepMax = Math.max(1, Math.floor(newClassLevel / 2) + abilityMod);
      } else if (selectedClass === 'artificer') {
        prepMax = Math.max(1, Math.ceil(newClassLevel / 2) + abilityMod);
      } else {
        // Cleric / Druid: level + ability mod
        prepMax = Math.max(1, newClassLevel + abilityMod);
      }
      return {
        cantripsToLearn,
        spellsToLearn: prepMax,
        canReplaceSpells: false,
        maxSpellLevel: maxSpellLevelForClass(selectedClass, newClassLevel),
        isPreparedSelection: true,
      };
    }

    return null;
  };

  const handleClassSelect = (classId: string) => {
    setSelectedClass(classId);

    // Use classId directly instead of waiting for state update
    if (!classesData) {
      return;
    }
    const classInfo = classesData[classId];
    if (!classInfo) {
      return;
    }

    const levelBefore = getClassLevelBeforeLevelUp(classId);
    const newClassLevel = getNewClassLevel(classId);

    const levelData = classInfo.levelProgression[newClassLevel.toString()];
    const features = levelData?.features || [];

    // If there are choices to make, go to features step
    const hasChoices = features.some(f =>
      f.type === 'choice' ||
      f.type === 'subclass' ||
      f.type === 'expertise' ||
      f.type === 'asi_or_feat' ||
      f.type === 'spell_learning' ||
      (f.options && f.options.length > 0 && !f.type)
    );

    if (hasChoices) {
      setCurrentStep('features');
    }
  };

  const canConfirmLevelUp = (): boolean => {
    if (!selectedClass) return false;

    const features = getNewFeatures();

    // Check if we're in class step but have required features to choose
    if (currentStep === 'class') {
      const hasRequiredChoices = features.some(f => f.required &&
        (f.type === 'choice' || f.type === 'subclass' || f.type === 'expertise' || f.type === 'asi_or_feat' || f.type === 'spell_learning')
      );
      // Features with options (like Fighting Style) also require choices
      const hasOptionsChoices = features.some(f => f.options && f.options.length > 0 && !f.type);
      // If there are required choices, we need to be in features step
      if (hasRequiredChoices || hasOptionsChoices) return false;
      // Otherwise, can confirm from class step
      return true;
    }

    // In features step, verify all required choices are made
    if (currentStep === 'features') {
      for (const feature of features) {
        // Features with options (like Fighting Style) always require selection
        if (feature.options && feature.options.length > 0 && !feature.type) {
          const optionKey = feature.nameEn?.replace(/\s+/g, '_').toLowerCase() || feature.name;
          if (!featureChoices[optionKey]) return false;
        }

        if (!feature.required) continue;

        if (feature.type === 'choice' && feature.id === 'eldritch_invocations') {
          const count = feature.count || 2;
          if ((featureChoices.eldritch_invocations || []).length < count) return false;
        } else if (feature.type === 'choice' && !featureChoices[feature.id || feature.nameEn]) {
          return false;
        }
        if (feature.type === 'subclass' && !featureChoices.subclass) {
          return false;
        }
        if (feature.type === 'expertise' && !featureChoices.expertise) {
          return false;
        }
        if (feature.type === 'asi_or_feat' && !featureChoices.asiOrFeat) {
          return false;
        }
      }

      // Validate Beast Master companion selection
      if (featureChoices.subclass === 'beast_master' && !featureChoices.companion) {
        return false;
      }

      // Validate Circle of the Land terrain selection
      if (featureChoices.subclass === 'land' && !featureChoices.landType) {
        return false;
      }

      // Validate bonusCantripChoice (e.g. Nature Domain, Circle of the Land)
      if (featureChoices.subclass && selectedClass) {
        const cantripChoice = getSubclassBonusCantripChoice(selectedClass, featureChoices.subclass);
        if (cantripChoice && !featureChoices.bonusCantripChoice) {
          return false;
        }
      }

      // Validate Chain Pact familiar selection
      if (featureChoices.pact_boon === 'chain' && !featureChoices.familiar) {
        return false;
      }

      // Validate spell selections if spells need to be learned
      const spellData = getSpellsToLearn();
      if (spellData && (spellData.cantripsToLearn > 0 || spellData.spellsToLearn > 0)) {
        const isPrepared = (spellData as any).isPreparedSelection;
        if (isPrepared) {
          // Prepared casters: only require cantrip selection (if any); leveled spells managed in character sheet
          if (spellData.cantripsToLearn > 0) {
            const learned = featureChoices.spells?.learned || [];
            if (learned.length < spellData.cantripsToLearn) return false;
          }
        } else {
          // Known casters: require full spell selection
          const learned = featureChoices.spells?.learned || [];
          const totalRequired = spellData.cantripsToLearn + spellData.spellsToLearn;
          if (learned.length < totalRequired) return false;
        }
      }

      return true;
    }

    return true;
  };

  const handleConfirm = () => {
    if (!selectedClass) return;

    const features = getNewFeatures();
    const hasRequiredChoices = features.some(f => f.required &&
      (f.type === 'choice' || f.type === 'subclass' || f.type === 'expertise' || f.type === 'asi_or_feat' || f.type === 'spell_learning')
    );
    const hasOptionsChoices = features.some(f => f.options && f.options.length > 0 && !f.type);

    // If in class step and there are required choices, switch to features step
    if (currentStep === 'class' && (hasRequiredChoices || hasOptionsChoices)) {
      setCurrentStep('features');
      return;
    }

    // Otherwise, confirm the level up
    // 注入子职业赠送的 bonusCantrips
    const finalChoices = { ...featureChoices };
    if (finalChoices.subclass) {
      const bonusCantrips = getSubclassBonusCantrips(selectedClass, finalChoices.subclass);
      if (bonusCantrips.length > 0) {
        const existingCantrips = new Set([
          ...extractSpellIds(character.selected_cantrips || []),
          ...extractSpellIds(character.selected_spells || []),
          // Also check racial cantrips (may not be in selected_cantrips for older characters)
          ...getRacialSpells(character.race_id, character.subrace_id ?? null, character.level || 1, character.race_choices || (character as any).raceChoices)
            .filter(rs => rs.level === 0).map(rs => rs.id),
        ]);
        const alreadyChosen = new Set(finalChoices.spells?.learned || []);
        const newCantrips = bonusCantrips.filter(c => !existingCantrips.has(c) && !alreadyChosen.has(c));
        if (newCantrips.length > 0) {
          // 角色没有该戏法 → 自动加入已学戏法
          const currentLearned = finalChoices.spells?.learned || [];
          finalChoices.spells = { ...finalChoices.spells, learned: [...currentLearned, ...newCantrips] };
        }
        // 角色已有赠送戏法 → cantripsToLearn 的增加在 getSpellsToLearn 中处理
      }
      // 注入用户选择的 bonusCantripChoice（如自然领域选的德鲁伊戏法）
      if (finalChoices.bonusCantripChoice) {
        const currentLearned = finalChoices.spells?.learned || [];
        if (!currentLearned.includes(finalChoices.bonusCantripChoice)) {
          finalChoices.spells = { ...finalChoices.spells, learned: [...currentLearned, finalChoices.bonusCantripChoice] };
        }
      }
    }
    onConfirm(selectedClass, finalChoices);
  };

  if (!isOpen) return null;

  // Show loading state
  if (loadingClasses || !classesData) {
    return createPortal(
      <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 sm:p-6" onClick={(e) => { if (!isClickInsideFloatingChat(e)) onCancel(); }}>
        <div className="bg-gray-900 rounded-lg p-6" onClick={e => e.stopPropagation()}>
          <div className="text-white">加载职业数据中...</div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 sm:p-6" onClick={(e) => { if (!isClickInsideFloatingChat(e)) onCancel(); }}>
      <div className="bg-slate-900 border border-slate-700/50 rounded-2xl p-6 sm:p-8 max-w-4xl w-full max-h-[90dvh] overflow-y-auto shadow-2xl shadow-purple-900/20" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-4 mb-2">
            <div className="bg-gradient-to-br from-purple-500 to-pink-500 p-3 rounded-xl shadow-lg shadow-purple-500/20">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent flex-1 tracking-tight">
              恭喜升级！
            </h2>
            <button onClick={onCancel} className="text-slate-400 hover:text-white hover:bg-slate-800 p-2 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-purple-500" aria-label="关闭"><X className="w-6 h-6" /></button>
          </div>
          <p className="text-xl font-medium text-slate-300 ml-16">
            {character.name} 达到了 {newLevel} 级
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center mb-8 ml-16 max-w-md">
          <div className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors duration-300 ${
            currentStep === 'class' ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30' : 'bg-emerald-500 text-white'
          } font-bold text-lg`}>
            {currentStep === 'class' ? '1' : <Shield className="w-5 h-5" />}
          </div>
          <div className="flex-1 h-1.5 bg-slate-800 mx-4 rounded-full overflow-hidden">
            <div className={`h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500 ease-out ${
              currentStep === 'features' ? 'w-full' : 'w-0'
            }`} />
          </div>
          <div className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors duration-300 ${
            currentStep === 'features' ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30' : 'bg-slate-800 text-slate-500 border border-slate-700'
          } font-bold text-lg`}>
            2
          </div>
        </div>

        {/* Step Content */}
        {currentStep === 'class' ? (
          <div className="space-y-6">
            {/* Existing Classes */}
            <div>
              <h3 className="text-sm font-semibold mb-4 text-slate-400 uppercase tracking-wider flex items-center gap-2">
                继续提升现有职业
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {multiclassData.classes.map(classLevel => {
                  const classInfo = classesData[classLevel.class_id];
                  const nextLevel = classLevel.level + 1;
                  const features = classInfo?.levelProgression[nextLevel.toString()]?.features || [];

                  return (
                    <button
                      key={classLevel.class_id}
                      onClick={() => handleClassSelect(classLevel.class_id)}
                      className={`p-5 rounded-xl border-2 transition-all duration-200 text-left ${
                        selectedClass === classLevel.class_id
                          ? 'border-purple-500 bg-purple-900/30 shadow-[0_0_20px_rgba(168,85,247,0.2)] transform -translate-y-1'
                          : 'border-slate-700/80 hover:border-slate-500 bg-slate-800/50 hover:bg-slate-800 hover:-translate-y-0.5'
                      }`}
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                <div className="flex items-center justify-between mb-3 relative z-10">
                        <div className="text-lg font-bold text-white">
                          {getClassName(classLevel.class_id)}
                        </div>
                        <div className="text-2xl font-bold bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent flex items-center gap-2">
                          {classLevel.level} <ArrowRight className="w-5 h-5 text-purple-400" /> {classLevel.level + 1}
                        </div>
                      </div>

                      {/* Preview of features */}
                      {features.length > 0 && (
                        <div className="mt-2 text-xs text-gray-400">
                          <div className="font-medium text-gray-300 mb-1">获得特性:</div>
                          {features.map((f, i) => (
                            <div key={i}>• {f.name}</div>
                          ))}
                        </div>
                      )}

                      {/* Stats changes preview */}
                      {(() => {
                        const stats = computeLevelUpStats(classLevel.class_id);
                        if (!stats) return null;
                        return (
                          <div className="mt-3 pt-3 border-t border-slate-700/40 space-y-1.5">
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                              <span className="text-emerald-400 flex items-center gap-1">
                                <Heart className="w-3 h-3" /> HP {stats.currentHP} → {stats.newHP}
                                <span className="text-slate-500">(+{stats.hpGain})</span>
                              </span>
                              <span className="text-amber-300 flex items-center gap-1">
                                <Dices className="w-3 h-3" /> {stats.currentHitDice}d → {stats.newHitDice}d
                              </span>
                              {stats.profChanged && (
                                <span className="text-purple-300 flex items-center gap-1">
                                  <Zap className="w-3 h-3" /> 熟练 +{stats.oldProf} → +{stats.newProf}
                                </span>
                              )}
                            </div>
                            {stats.slotChanges.length > 0 && (
                              <div className="text-[11px] text-blue-400 space-y-0.5">
                                {stats.slotChanges.map((desc, i) => (
                                  <div key={i}>{desc}</div>
                                ))}
                              </div>
                            )}
                            {stats.racialSpells.length > 0 && (
                              <div className="text-[11px] text-amber-400">
                                {stats.racialSpells.map((rs, i) => (
                                  <div key={i}>解锁种族法术：{rs.displayName}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Multiclass Options */}
            {getAvailableClasses().filter(c => !multiclassData.classes.find(mc => mc.class_id === c)).length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide">
                    开始兼职新职业
                  </h3>
                  <div className="relative group">
                    <button
                      type="button"
                      className="w-4 h-4 rounded-full bg-gray-600 text-gray-300 text-xs flex items-center justify-center hover:bg-gray-500 transition-colors"
                    >
                      ?
                    </button>
                    <div className="absolute left-6 top-1/2 -translate-y-1/2 z-50 w-64 p-3 bg-gray-800 border border-gray-600 rounded-lg shadow-xl text-xs text-gray-300 hidden group-hover:block">
                      <p className="font-medium text-white mb-2">兼职属性要求</p>
                      <p className="mb-2 text-gray-400">兼职需同时满足当前职业和目标职业的最低属性要求，未达标的职业不会显示：</p>
                      <div className="space-y-1">
                        {Object.entries(multiclassConfig.prerequisites).map(([cls, prereq]) => (
                          <div key={cls} className="flex justify-between">
                            <span className="text-gray-300">{multiclassConfig.classNames[cls as keyof typeof multiclassConfig.classNames]}</span>
                            <span className="text-gray-400">{formatPrerequisite(prereq as Record<string, any>)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {getAvailableClasses()
                    .filter(c => !multiclassData.classes.find(mc => mc.class_id === c))
                    .map(className => {
                      const meetsRequirements = canMulticlass(className);
                      return (
                        <button
                          key={className}
                          onClick={() => meetsRequirements && handleClassSelect(className)}
                          disabled={!meetsRequirements}
                          className={`p-5 rounded-xl border-2 transition-all duration-200 text-left ${
                            selectedClass === className
                              ? 'border-emerald-500 bg-emerald-900/30 shadow-[0_0_20px_rgba(16,185,129,0.2)] transform -translate-y-1'
                              : meetsRequirements
                              ? 'border-slate-700/80 hover:border-slate-500 bg-slate-800/50 hover:bg-slate-800 hover:-translate-y-0.5'
                              : 'border-slate-800 bg-slate-900/50 opacity-40 cursor-not-allowed grayscale'
                          }`}
                        >
                          <div className="text-lg font-bold text-white">
                            {getClassName(className)}
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            {meetsRequirements ? '开始兼职' : '不满足要求'}
                          </div>
                          {/* Stats preview for multiclass 1st level */}
                          {meetsRequirements && (() => {
                            const stats = computeLevelUpStats(className);
                            if (!stats) return null;
                            return (
                              <div className="mt-2 pt-2 border-t border-slate-700/40 space-y-0.5">
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                                  <span className="text-emerald-400 flex items-center gap-1">
                                    <Heart className="w-3 h-3" /> HP {stats.currentHP} → {stats.newHP}
                                    <span className="text-slate-500">(+{stats.hpGain})</span>
                                  </span>
                                  <span className="text-amber-300 flex items-center gap-1">
                                    <Dices className="w-3 h-3" /> {stats.currentHitDice}d → {stats.newHitDice}d
                                  </span>
                                </div>
                              </div>
                            );
                          })()}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Features Step */
          <div className="space-y-6">
            <h3 className="text-2xl font-bold text-slate-100 flex items-center gap-3 border-b border-slate-800 pb-4">
              <Star className="w-6 h-6 text-purple-400" /> 选择 {getClassName(selectedClass)} {getNewClassLevel(selectedClass)} 级特性
            </h3>

            {/* Stats summary banner */}
            {(() => {
              const stats = computeLevelUpStats(selectedClass);
              if (!stats) return null;
              return (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/50 text-xs">
                  <span className="text-emerald-400 flex items-center gap-1">
                    <Heart className="w-3.5 h-3.5" /> HP {stats.currentHP} → {stats.newHP}
                  </span>
                  <span className="text-amber-300 flex items-center gap-1">
                    <Dices className="w-3.5 h-3.5" /> {stats.currentHitDice}d → {stats.newHitDice}d
                  </span>
                  {stats.profChanged && (
                    <span className="text-purple-300 flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5" /> 熟练 +{stats.oldProf} → +{stats.newProf}
                    </span>
                  )}
                  {stats.slotChanges.length > 0 && (
                    <span className="text-blue-400">{stats.slotChanges[0]}</span>
                  )}
                </div>
              );
            })()}

            {getNewFeatures().map((feature, index) => {
              // Resolve subclass-specific feature info
              const isSubclassFeature = SUBCLASS_FEATURE_TYPES.has(feature.type);
              const subclassInfo = isSubclassFeature
                ? resolveSubclassFeature(selectedClass, character.subclass_id, getNewClassLevel(selectedClass))
                : null;
              const displayName = subclassInfo
                ? `${subclassInfo.subclassName}: ${subclassInfo.featureNames.join('、')}`
                : feature.name;
              const displayDesc = subclassInfo
                ? subclassInfo.featureDescriptions.filter(Boolean).join('\n') || `${subclassInfo.subclassName}${getNewClassLevel(selectedClass)}级特性`
                : feature.description;

              return (
              <div key={index} className="p-6 bg-slate-800/40 rounded-2xl border border-slate-700/60 backdrop-blur-md shadow-lg shadow-black/20 hover:border-slate-600 transition-colors duration-300 relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                <div className="flex items-center justify-between mb-3 relative z-10">
                  <h4 className="text-xl font-bold bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent flex items-center gap-2">
                    {feature.type === 'feature' ? <Star className="w-5 h-5 text-amber-400" /> : <BookOpen className="w-5 h-5 text-purple-400" />}
                    {displayName}
                  </h4>
                  <span className="text-[10px] font-bold tracking-widest text-slate-500 uppercase px-2 py-1 bg-slate-900/50 rounded-full border border-slate-700/50">{feature.nameEn}</span>
                </div>

                {subclassInfo && subclassInfo.featureNames.length > 0 ? (
                  <div className="space-y-3 mb-4">
                    {subclassInfo.featureNames.map((fname, fi) => (
                      <div key={fi} className="bg-slate-900/40 p-3 rounded-lg border border-slate-800/80 shadow-inner">
                        {subclassInfo.featureNames.length > 1 && (
                          <p className="text-sm font-semibold text-purple-300 mb-1">{fname}</p>
                        )}
                        {subclassInfo.featureDescriptions[fi] && (
                          <p className="text-sm text-slate-300 leading-relaxed">{subclassInfo.featureDescriptions[fi]}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : displayDesc ? (
                  <p className="text-sm text-slate-300 mb-4 leading-relaxed bg-slate-900/40 p-3 rounded-lg border border-slate-800/80 shadow-inner">{displayDesc}</p>
                ) : null}

                {/* Handle different feature types */}
                {feature.type === 'choice' && feature.id === 'eldritch_invocations' && (
                  <EldritchInvocationSelector
                    character={{
                      eldritchInvocations: featureChoices.eldritch_invocations || [],
                      level: getNewClassLevel(selectedClass),
                      selectedCantrips: extractSpellIds(character.selected_cantrips || []),
                      subclassId: character.subclass_id || '',
                    }}
                    setCharacter={(updater) => {
                      const updated = updater({ eldritchInvocations: featureChoices.eldritch_invocations || [] });
                      setFeatureChoices({ ...featureChoices, eldritch_invocations: updated.eldritchInvocations });
                    }}
                  />
                )}
                {feature.type === 'choice' && feature.id !== 'eldritch_invocations' && (
                  <div className="grid grid-cols-1 gap-2 mt-3">
                    {feature.choices?.map((choice: any) => {
                      const choiceKey = feature.id || feature.nameEn;
                      return (
                        <button
                          key={choice.id}
                          onClick={() => setFeatureChoices({
                            ...featureChoices,
                            [choiceKey]: choice.id
                          })}
                          className={`p-3 rounded border transition-all text-left ${
                            featureChoices[choiceKey] === choice.id
                              ? 'border-purple-500 bg-purple-900/30'
                              : 'border-gray-600 hover:border-gray-500'
                          }`}
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="font-medium text-white">{choice.name}</span>
                            {choice.nameEn && <span className="text-xs text-gray-500">{choice.nameEn}</span>}
                          </div>
                          {choice.description && (
                            <div className="text-xs text-gray-400 mt-1 leading-relaxed">{choice.description}</div>
                          )}
                          {choice.relatedInvocations?.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-gray-700/50">
                              <div className="text-xs text-purple-400 mb-1">相关魔能祈唤：</div>
                              {choice.relatedInvocations.map((inv: any) => (
                                <div key={inv.nameEn} className="text-xs text-gray-400 flex items-baseline gap-1 mt-0.5">
                                  <span className="text-purple-300">{inv.name}</span>
                                  <span className="text-gray-600">Lv{inv.level}</span>
                                  <span className="text-gray-500">- {inv.brief}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Features with options array (Fighting Style, etc.) */}
                {feature.options && feature.options.length > 0 && !feature.type && (() => {
                  const optionKey = feature.nameEn?.replace(/\s+/g, '_').toLowerCase() || feature.name;
                  return (
                    <div className="grid grid-cols-1 gap-2 mt-3">
                      {feature.options.map((opt: any) => (
                        <button
                          key={opt.id}
                          onClick={() => setFeatureChoices({
                            ...featureChoices,
                            [optionKey]: opt.id
                          })}
                          className={`p-3 rounded border transition-all text-left ${
                            featureChoices[optionKey] === opt.id
                              ? 'border-purple-500 bg-purple-900/30'
                              : 'border-gray-600 hover:border-gray-500'
                          }`}
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="font-medium text-white">{opt.name}</span>
                            <span className="text-xs text-gray-500">{opt.nameEn}</span>
                          </div>
                          {opt.description && (
                            <div className="text-xs text-gray-400 mt-1 leading-relaxed">{opt.description}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })()}

                {feature.type === 'subclass' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
                    {feature.choices?.map((choice: any) => {
                      const isExpanded = expandedSubclassId === choice.id;
                      const choiceBonusCantrips = selectedClass ? getSubclassBonusCantrips(selectedClass, choice.id) : [];
                      const cantripChoiceConfig = selectedClass ? getSubclassBonusCantripChoice(selectedClass, choice.id) : null;
                      const allSpells = (spellsJsonData as any).spells || [];
                      // 计算该子职业可选的戏法列表
                      const cantripChoiceOptions = cantripChoiceConfig ? allSpells.filter((s: any) =>
                        s.level === 0 &&
                        s.classes?.includes(cantripChoiceConfig.list) &&
                        !extractSpellIds(character.selected_cantrips || []).includes(s.id)
                      ) : [];
                      return (
                        <div
                          key={choice.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            const newChoices: Record<string, any> = { ...featureChoices, subclass: choice.id };
                            // 切换子职业时清除之前的 bonusCantripChoice
                            if (featureChoices.subclass !== choice.id) {
                              delete newChoices.bonusCantripChoice;
                            }
                            setFeatureChoices(newChoices);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              const newChoices: Record<string, any> = { ...featureChoices, subclass: choice.id };
                              if (featureChoices.subclass !== choice.id) delete newChoices.bonusCantripChoice;
                              setFeatureChoices(newChoices);
                            }
                          }}
                          className={`p-4 rounded border-2 transition-all text-left cursor-pointer ${
                            featureChoices.subclass === choice.id
                              ? 'border-yellow-500 bg-yellow-900/30 shadow-lg'
                              : 'border-gray-600 hover:border-gray-500'
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className="font-bold text-lg text-white">{choice.name}</div>
                              <div className="text-xs text-yellow-400">{choice.nameEn}</div>
                            </div>
                            {featureChoices.subclass === choice.id && (
                              <div className="text-yellow-500 text-xl">✓</div>
                            )}
                          </div>
                          {choice.description && (
                            <div className="text-sm text-gray-300 mb-3">{choice.description}</div>
                          )}
                          {choiceBonusCantrips.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {choiceBonusCantrips.map((cantripId: string) => {
                                const spellInfo = allSpells.find((s: any) => s.id === cantripId);
                                const displayName = spellInfo?.name || cantripId;
                                return (
                                  <span key={cantripId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-900/40 border border-green-700/50 text-green-300 text-xs">
                                    <Star className="w-3 h-3" />
                                    赠送戏法: {displayName}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          {cantripChoiceConfig && (
                            <div className="mb-3">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-900/40 border border-blue-700/50 text-blue-300 text-xs">
                                <BookOpen className="w-3 h-3" />
                                选择{cantripChoiceConfig.count}个{cantripChoiceConfig.list === 'druid' ? '德鲁伊' : '法师'}戏法
                              </span>
                            </div>
                          )}
                          {/* 选中该子职业时，显示戏法选择列表 */}
                          {featureChoices.subclass === choice.id && cantripChoiceConfig && cantripChoiceOptions.length > 0 && (
                            <div className="mt-2 mb-3 p-3 bg-blue-950/30 border border-blue-800/50 rounded-lg" onClick={(e) => e.stopPropagation()}>
                              <h6 className="text-sm font-semibold text-blue-300 mb-2">选择赠送戏法（{cantripChoiceConfig.list === 'druid' ? '德鲁伊' : '法师'}列表）</h6>
                              <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                                {cantripChoiceOptions.map((spell: any) => (
                                  <button
                                    key={spell.id}
                                    onClick={() => setFeatureChoices({ ...featureChoices, bonusCantripChoice: spell.id })}
                                    className={`px-2 py-1.5 rounded text-xs text-left transition-all ${
                                      featureChoices.bonusCantripChoice === spell.id
                                        ? 'bg-blue-600 text-white border border-blue-400'
                                        : 'bg-slate-800 text-gray-300 border border-slate-700 hover:border-blue-600'
                                    }`}
                                  >
                                    {spell.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {choice.features && choice.features.length > 0 && (
                            <div className="mt-3 border-t border-gray-700 pt-3">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedSubclassId(isExpanded ? null : choice.id);
                                }}
                                className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-300 transition-colors w-full text-left"
                              >
                                <span>{isExpanded ? '▼' : '▶'}</span>
                                <span>特性进程</span>
                              </button>
                              {isExpanded && (
                                <div className="mt-2 space-y-2">
                                  {choice.features.map((feat: any, idx: number) => (
                                    <div key={idx} className="text-xs">
                                      <span className="inline-block w-12 text-yellow-500 font-bold">{feat.level}级</span>
                                      <span className="text-white font-medium">{feat.name}</span>
                                      {feat.description && (
                                        <div className="ml-12 text-gray-400 mt-0.5">{feat.description}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Battle Master Maneuver Selection - shown when selecting battle_master subclass */}
                {feature.type === 'subclass' && featureChoices.subclass === 'battle_master' && (
                  <div className="mt-4 p-4 bg-orange-900/20 border border-orange-700 rounded-lg">
                    <h5 className="text-lg font-bold text-white mb-2">选择战技</h5>
                    <p className="text-sm text-gray-400 mb-3">
                      作为战斗大师，你学会了运用战技来掌控战场。选择3个战技学习。
                      你获得4个d8战技骰，在短休或长休后恢复。
                    </p>
                    <ManeuverSelector
                      count={3}
                      knownManeuvers={character.maneuvers_known || []}
                      onSelect={(maneuvers) => {
                        setFeatureChoices({
                          ...featureChoices,
                          maneuvers: maneuvers
                        });
                      }}
                    />
                  </div>
                )}

                {/* Beast Master Companion Selection - shown when selecting beast_master subclass */}
                {feature.type === 'subclass' && featureChoices.subclass === 'beast_master' && (
                  <div className="mt-4 p-4 bg-green-900/20 border border-green-700 rounded-lg">
                    <h5 className="text-lg font-bold text-white mb-2">选择动物伙伴</h5>
                    <p className="text-sm text-gray-400 mb-3">
                      作为驭兽师，你与一只野兽建立了神秘的联结。选择一只 CR ≤ 1/4、体型中型或更小的野兽作为你的动物伙伴。
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {companionsData.categories.beast_master.creatures.map((beast) => (
                        <button
                          key={beast.id}
                          onClick={() => setFeatureChoices({ ...featureChoices, companion: beast.id })}
                          className={`text-left p-2.5 rounded-lg border transition-colors ${
                            featureChoices.companion === beast.id
                              ? 'bg-green-900/40 border-green-500 ring-1 ring-green-500'
                              : 'bg-gray-800/50 border-gray-600 hover:border-green-600'
                          }`}
                        >
                          <div className="flex gap-2.5">
                            <img
                              src={getAssetUrl(`assets/monster-avatars/${beast.id}_128.webp`)}
                              alt={beast.name}
                              className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-gray-600"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-white text-sm truncate">{beast.name}</span>
                                <span className="text-xs text-gray-400 flex-shrink-0 ml-1">CR {beast.cr}</span>
                              </div>
                              <div className="text-xs text-gray-500">{beast.nameEn} · {beast.size}</div>
                              <div className="flex items-center justify-between mt-0.5">
                                <div className="flex gap-2 text-xs text-gray-400">
                                  <span>AC {beast.ac}</span>
                                  <span>HP {beast.hp}</span>
                                </div>
                                <span
                                  role="button"
                                  className="text-xs text-green-400 hover:text-green-300 cursor-pointer"
                                  onClick={(e) => { e.stopPropagation(); setCompanionDetail(companionDetail === beast.id ? null : beast.id); }}
                                >
                                  详情
                                </span>
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Companion detail panel */}
                    {companionDetail && (() => {
                      const beast = companionsData.categories.beast_master.creatures.find(b => b.id === companionDetail);
                      if (!beast) return null;
                      const ab = beast.abilityScores;
                      const speedText = Object.entries(beast.speed).map(([k, v]) => {
                        const labels: Record<string, string> = { walk: '步行', fly: '飞行', swim: '游泳', climb: '攀爬', burrow: '掘穴' };
                        return `${labels[k] || k} ${v}尺`;
                      }).join('，');
                      return (
                        <div className="mt-3 border-t border-green-700/50 pt-3">
                          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                <div className="flex items-center justify-between mb-3 relative z-10">
                            <div className="flex items-center gap-2">
                              <img src={getAssetUrl(`assets/monster-avatars/${beast.id}_128.webp`)} alt={beast.name} className="w-8 h-8 rounded" />
                              <span className="font-bold text-white text-sm">{beast.name} <span className="text-gray-400 font-normal">{beast.nameEn}</span></span>
                            </div>
                            <button type="button" onClick={() => setCompanionDetail(null)} className="text-xs text-gray-400 hover:text-white">收起</button>
                          </div>
                          <div className="text-xs space-y-2 text-gray-300">
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              <span><span className="text-gray-500">AC</span> {beast.ac}</span>
                              <span><span className="text-gray-500">HP</span> {beast.hp} ({beast.hpFormula})</span>
                              <span><span className="text-gray-500">速度</span> {speedText}</span>
                              <span><span className="text-gray-500">CR</span> {beast.cr} ({beast.xp} XP)</span>
                            </div>
                            <div className="grid grid-cols-6 gap-1 text-center bg-gray-800/60 rounded p-1.5">
                              {(['str','dex','con','int','wis','cha'] as const).map(key => (
                                <div key={key}>
                                  <div className="text-gray-500 uppercase">{({str:'力量',dex:'敏捷',con:'体质',int:'智力',wis:'感知',cha:'魅力'} as const)[key]}</div>
                                  <div className="text-white font-bold">{ab[key]}</div>
                                  <div className="text-gray-400">({ab[`${key}Mod` as keyof typeof ab] >= 0 ? '+' : ''}{ab[`${key}Mod` as keyof typeof ab]})</div>
                                </div>
                              ))}
                            </div>
                            {beast.skills && <div><span className="text-gray-500">技能</span> {beast.skills}</div>}
                            {beast.senses && <div><span className="text-gray-500">感官</span> {Object.entries(beast.senses).map(([k, v]) => {
                              const labels: Record<string, string> = { darkvision: '黑暗视觉', blindsight: '盲视', passivePerception: '被动察觉' };
                              return `${labels[k] || k} ${v}${k === 'passivePerception' ? '' : '尺'}`;
                            }).join('，')}</div>}
                            {beast.specialAbilities && beast.specialAbilities.length > 0 && (
                              <div>
                                <div className="text-gray-500 mb-1">特殊能力</div>
                                {beast.specialAbilities.map((sa, i) => (
                                  <div key={i} className="mb-1"><span className="text-green-400">{sa.name}</span> {sa.description}</div>
                                ))}
                              </div>
                            )}
                            <div>
                              <div className="text-gray-500 mb-1">动作</div>
                              {beast.actions.map((a, i) => (
                                <div key={i} className="mb-1"><span className="text-amber-400">{a.name}</span> {a.description}</div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Circle of the Land Terrain Selection */}
                {feature.type === 'subclass' && featureChoices.subclass === 'land' && (
                  <div className="mt-4 p-4 bg-emerald-900/20 border border-emerald-700 rounded-lg">
                    <h5 className="text-lg font-bold text-white mb-2">选择大地结社地形</h5>
                    <p className="text-sm text-gray-400 mb-3">
                      你与某种特定地形建立了神秘的联结。选择一种地形，你将获得该地形的额外法术，并在匹配地形时获得探索增益。
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { id: 'arctic', name: '极地', icon: '❄️' },
                        { id: 'coast', name: '海岸', icon: '🏖️' },
                        { id: 'desert', name: '沙漠', icon: '🏜️' },
                        { id: 'forest', name: '森林', icon: '🌲' },
                        { id: 'grassland', name: '草原', icon: '🌾' },
                        { id: 'mountain', name: '山脉', icon: '⛰️' },
                        { id: 'swamp', name: '沼泽', icon: '🌿' },
                        { id: 'underdark', name: '幽暗地域', icon: '🕳️' },
                      ].map(t => (
                        <button
                          key={t.id}
                          onClick={() => setFeatureChoices({ ...featureChoices, landType: t.id })}
                          className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border transition-colors ${
                            featureChoices.landType === t.id
                              ? 'bg-emerald-900/40 border-emerald-500 ring-1 ring-emerald-500'
                              : 'bg-gray-800/50 border-gray-600 hover:border-emerald-600'
                          }`}
                        >
                          <span className="text-xl">{t.icon}</span>
                          <span className="text-xs text-white font-medium">{t.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Chain Pact Familiar Selection - shown when pact_boon=chain */}
                {feature.type === 'choice' && feature.id === 'pact_boon' && featureChoices.pact_boon === 'chain' && (
                  <div className="mt-4 p-4 bg-purple-900/20 border border-purple-700 rounded-lg">
                    <h5 className="text-lg font-bold text-white mb-2">选择魔宠形态</h5>
                    <p className="text-sm text-gray-400 mb-3">
                      作为锁链契约的邪术士，你的护佑者赐予你召唤特殊魔宠的能力。选择一个魔宠形态。
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {(companionsData as any).categories.find_familiar.creatures.map((beast: any) => (
                        <button
                          key={beast.id}
                          onClick={() => setFeatureChoices({ ...featureChoices, familiar: beast.id })}
                          className={`text-left p-2.5 rounded-lg border transition-colors ${
                            featureChoices.familiar === beast.id
                              ? 'bg-purple-900/40 border-purple-500 ring-1 ring-purple-500'
                              : 'bg-gray-800/50 border-gray-600 hover:border-purple-600'
                          }`}
                        >
                          <div className="flex gap-2.5">
                            <img
                              src={getAssetUrl(`assets/monster-avatars/${beast.id}_128.webp`)}
                              alt={beast.name}
                              className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-purple-700/50 hover:ring-2 hover:ring-purple-400 transition-all cursor-zoom-in"
                              onClick={(e) => { e.stopPropagation(); setFamiliarAvatarPreview(beast.id); }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-white text-sm truncate">{beast.name}</span>
                                <span className="text-xs text-gray-400 flex-shrink-0 ml-1">CR {beast.cr}</span>
                              </div>
                              <div className="text-xs text-gray-500">{beast.nameEn} · {beast.size}</div>
                              <div className="flex items-center justify-between mt-0.5">
                                <div className="flex gap-2 text-xs text-gray-400">
                                  <span>AC {beast.ac}</span>
                                  <span>HP {beast.hp}</span>
                                </div>
                                <span
                                  role="button"
                                  className="text-xs text-purple-400 hover:text-purple-300 cursor-pointer"
                                  onClick={(e) => { e.stopPropagation(); setFamiliarDetail(familiarDetail === beast.id ? null : beast.id); }}
                                >
                                  详情
                                </span>
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Familiar detail panel */}
                    {familiarDetail && (() => {
                      const beast = (companionsData as any).categories.find_familiar.creatures.find((b: any) => b.id === familiarDetail);
                      if (!beast) return null;
                      const ab = beast.abilityScores;
                      const speedText = Object.entries(beast.speed).map(([k, v]) => {
                        const labels: Record<string, string> = { walk: '步行', fly: '飞行', swim: '游泳', climb: '攀爬', burrow: '掘穴' };
                        return `${labels[k] || k} ${v}尺`;
                      }).join('，');
                      return (
                        <div className="mt-3 border-t border-purple-700/50 pt-3">
                          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                <div className="flex items-center justify-between mb-3 relative z-10">
                            <span className="font-bold text-white text-sm">{beast.name} <span className="text-gray-400 font-normal">{beast.nameEn}</span></span>
                            <button type="button" onClick={() => setFamiliarDetail(null)} className="text-xs text-gray-400 hover:text-white">收起</button>
                          </div>
                          <div className="text-xs space-y-2 text-gray-300">
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              <span><span className="text-gray-500">AC</span> {beast.ac}</span>
                              <span><span className="text-gray-500">HP</span> {beast.hp} ({beast.hpFormula})</span>
                              <span><span className="text-gray-500">速度</span> {speedText}</span>
                              <span><span className="text-gray-500">CR</span> {beast.cr} ({beast.xp} XP)</span>
                            </div>
                            <div className="grid grid-cols-6 gap-1 text-center bg-gray-800/60 rounded p-1.5">
                              {(['str','dex','con','int','wis','cha'] as const).map(key => (
                                <div key={key}>
                                  <div className="text-gray-500 uppercase">{({str:'力量',dex:'敏捷',con:'体质',int:'智力',wis:'感知',cha:'魅力'} as const)[key]}</div>
                                  <div className="text-white font-bold">{ab[key]}</div>
                                  <div className="text-gray-400">({ab[`${key}Mod` as keyof typeof ab] >= 0 ? '+' : ''}{ab[`${key}Mod` as keyof typeof ab]})</div>
                                </div>
                              ))}
                            </div>
                            {beast.skills && <div><span className="text-gray-500">技能</span> {beast.skills}</div>}
                            {beast.senses && <div><span className="text-gray-500">感官</span> {Object.entries(beast.senses).map(([k, v]: [string, any]) => {
                              const labels: Record<string, string> = { darkvision: '黑暗视觉', blindsight: '盲视', passivePerception: '被动察觉' };
                              return `${labels[k] || k} ${v}${k === 'passivePerception' ? '' : '尺'}`;
                            }).join('，')}</div>}
                            {beast.specialAbilities?.length > 0 && (
                              <div>
                                <div className="text-gray-500 mb-1">特殊能力</div>
                                {beast.specialAbilities.map((sa: any, i: number) => (
                                  <div key={i} className="mb-1"><span className="text-purple-400">{sa.name}</span> {sa.description}</div>
                                ))}
                              </div>
                            )}
                            <div>
                              <div className="text-gray-500 mb-1">动作</div>
                              {beast.actions.map((a: any, i: number) => (
                                <div key={i} className="mb-1"><span className="text-amber-400">{a.name}</span> {a.description}</div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Battle Master Additional Maneuvers - for archetype_feature at levels 7, 10, 15 */}
                {feature.type === 'archetype_feature' && character.subclass_id === 'battle_master' && feature.archetypeFeatures?.battle_master?.maneuverSelection && (
                  <div className="mt-4 p-4 bg-orange-900/20 border border-orange-700 rounded-lg">
                    <h5 className="text-lg font-bold text-white mb-2">
                      {feature.archetypeFeatures.battle_master.name}
                    </h5>
                    <p className="text-sm text-gray-400 mb-3">
                      {feature.archetypeFeatures.battle_master.description}
                    </p>
                    <ManeuverSelector
                      count={feature.archetypeFeatures.battle_master.maneuverSelection.count}
                      knownManeuvers={character.maneuvers_known || []}
                      onSelect={(maneuvers) => {
                        setFeatureChoices({
                          ...featureChoices,
                          maneuvers: maneuvers
                        });
                      }}
                    />
                  </div>
                )}

                {feature.type === 'asi_or_feat' && (
                  <div className="mt-3">
                    <ASISelector
                      currentAbilities={character.ability_scores}
                      characterClassId={character.class_id}
                      excludeFeats={(character.feats || []).map((f: any) => typeof f === 'string' ? f : f.id || f.value || '')}
                      onSelect={(choices) => {
                        setFeatureChoices({
                          ...featureChoices,
                          asiOrFeat: choices.type,
                          asiChoices: choices.asiChoices,
                          featId: choices.featId,
                          featAdditionalChoices: choices.featAdditionalChoices
                        });
                      }}
                    />
                  </div>
                )}

                {feature.type === 'expertise' && (
                  <div className="mt-3">
                    <ExpertiseSelector
                      count={feature.count || 2}
                      proficientSkills={character.selected_skills || []}
                      existingExpertise={character.expertise_skills || []}
                      onSelect={(selectedSkills) => {
                        setFeatureChoices({
                          ...featureChoices,
                          expertise: selectedSkills
                        });
                      }}
                    />
                  </div>
                )}
              </div>
              );
            })}

            {/* Spell Slot Changes */}
            {getSpellSlotChanges() && getSpellSlotChangesText().length > 0 && (
              <div className="p-5 bg-blue-950/40 border border-blue-800/60 rounded-xl backdrop-blur-sm">
                <h4 className="text-lg font-bold text-white mb-3">法术位变化</h4>
                <div className="space-y-2">
                  {getSpellSlotChangesText().map((description, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      <span className="text-white">{description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Newly Unlocked Racial Spells */}
            {getNewRacialSpells().length > 0 && (
              <div className="p-5 bg-violet-950/40 border border-violet-800/60 rounded-xl backdrop-blur-sm">
                <h4 className="text-lg font-bold text-white mb-3">解锁种族法术</h4>
                <div className="space-y-2">
                  {getNewRacialSpells().map((rs) => (
                    <div key={rs.id} className="flex items-center gap-2">
                      <span className="text-violet-400">✨</span>
                      <span className="text-white">
                        {rs.displayName}
                        {rs.usesPerDay && <span className="text-violet-300 ml-1">（每日{rs.usesPerDay}次）</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Spell Section for Casters */}
            {(() => {
              const spellData = getSpellsToLearn();
              // Compute expanded spell IDs from subclass data
              const subId = character.subclass_id;
              const classSpellData = (subclassSpellsData as any)[selectedClass];
              const subSpellData = subId ? classSpellData?.[subId] : null;
              const allExpandedIds: string[] = [];
              if (subSpellData) {
                const spellMap = subSpellData.expandedSpells || subSpellData.domainSpells || subSpellData.oathSpells;
                if (spellMap) {
                  Object.values(spellMap).forEach((ids: any) => allExpandedIds.push(...ids));
                }
              }
              if (!spellData) return null;
              const isPrepared = (spellData as any).isPreparedSelection;

              // Prepared casters (Cleric/Druid/Paladin): read-only informational display
              if (isPrepared) {
                const prevMaxLevel = maxSpellLevelForClass(selectedClass, getClassLevelBeforeLevelUp(selectedClass));
                const newMaxLevel = spellData.maxSpellLevel || 0;
                if (newMaxLevel <= 0 && spellData.cantripsToLearn <= 0) return null;
                return (
                  <div className="p-5 bg-purple-950/40 border border-purple-800/60 rounded-xl backdrop-blur-sm">
                    <h4 className="text-lg font-bold text-white mb-2">职业法术列表</h4>
                    <div className="text-sm text-gray-300 mb-3">
                      可准备 <span className="text-purple-300 font-bold">{spellData.spellsToLearn}</span> 个法术
                    </div>
                    {/* Cantrip selection if applicable (Cleric/Druid) */}
                    {spellData.cantripsToLearn > 0 && (
                      <div className="mb-4 p-3 bg-gray-800/50 rounded-lg">
                        <div className="text-sm text-yellow-400 mb-2 font-medium">
                          选择 {spellData.cantripsToLearn} 个新戏法：
                        </div>
                        {/* Show hint when subclass bonus cantrip overlaps with racial cantrip */}
                        {featureChoices.subclass && (() => {
                          const bc = getSubclassBonusCantrips(selectedClass, featureChoices.subclass);
                          const racialIds = new Set(getRacialSpells(character.race_id, character.subrace_id ?? null, character.level || 1, character.race_choices || (character as any).raceChoices)
                            .filter(rs => rs.level === 0).map(rs => rs.id));
                          const overlap = bc.filter(c => racialIds.has(c) || extractSpellIds(character.selected_cantrips || []).includes(c));
                          return overlap.length > 0 ? (
                            <p className="text-xs text-purple-300 mb-2 bg-purple-900/20 border border-purple-700/30 rounded px-2 py-1">
                              你已通过种族特性习得了子职业赠送的戏法，因此可额外自选 {overlap.length} 个戏法作为替代
                            </p>
                          ) : null;
                        })()}
                        <SpellSelector
                          characterClass={selectedClass}
                          characterLevel={getNewClassLevel(selectedClass)}
                          knownSpells={[
                            ...extractSpellIds(character.selected_cantrips || []),
                            ...getRacialSpells(character.race_id, character.subrace_id ?? null, character.level || 1, character.race_choices || (character as any).raceChoices)
                              .filter(rs => rs.level === 0).map(rs => rs.id),
                          ]}
                          cantripsKnown={spellData.cantripsToLearn}
                          spellsKnown={0}
                          maxSpellLevel={0}
                          canReplaceSpells={false}
                          expandedSpellIds={allExpandedIds}
                          onSelect={(spells) => setFeatureChoices({ ...featureChoices, spells: { learned: spells.learned } })}
                        />
                      </div>
                    )}
                    {/* Read-only spell list grouped by level */}
                    {newMaxLevel > 0 && (
                      <div className="space-y-3">
                        {Array.from({ length: newMaxLevel }, (_, i) => i + 1).map(level => {
                          const spellsAtLevel = preparedCasterSpells.filter(s => s.level === level);
                          if (spellsAtLevel.length === 0) return null;
                          const isNewLevel = level > prevMaxLevel;
                          return (
                            <div key={level}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-bold text-blue-400">{level}环法术</span>
                                <span className="text-xs text-gray-500">({spellsAtLevel.length}个)</span>
                                {isNewLevel && <span className="text-xs bg-green-600 text-white px-1.5 py-0.5 rounded">新解锁</span>}
                              </div>
                              <div className="grid grid-cols-2 gap-1">
                                {spellsAtLevel.map(spell => (
                                  <button
                                    key={spell.id}
                                    type="button"
                                    onClick={() => setDetailSpell(detailSpell?.id === spell.id ? null : spell)}
                                    className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded cursor-pointer text-left transition-colors ${
                                      detailSpell?.id === spell.id
                                        ? 'bg-purple-700/50 text-white ring-1 ring-purple-500'
                                        : 'text-gray-300 bg-gray-800/50 hover:bg-gray-700/60'
                                    }`}
                                  >
                                    <span className="flex-shrink-0 w-6 h-6 rounded overflow-hidden bg-gray-700/50 flex items-center justify-center">
                                      {spell.iconPath ? (
                                        <img
                                          src={getAssetUrl(spell.iconPath)}
                                          alt={spell.name}
                                          className="w-full h-full object-cover"
                                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }}
                                        />
                                      ) : null}
                                      <span className={`text-sm ${spell.iconPath ? 'hidden' : ''}`}>{SCHOOL_ICONS[spell.school] || '✨'}</span>
                                    </span>
                                    <span className="truncate">{spell.name}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <p className="text-xs text-emerald-400 mt-3">
                      📖 在角色施法面板中管理准备列表，每次长休后可更换。
                    </p>
                    <SpellDetailModal spell={detailSpell as any} onClose={() => setDetailSpell(null)} />
                  </div>
                );
              }

              // Known casters (Bard/Sorcerer/Warlock/Ranger/Wizard) & subclass casters (EK/AT): SpellSelector
              if (spellData.cantripsToLearn > 0 || spellData.spellsToLearn > 0 || spellData.canReplaceSpells) {
                const sd = spellData as any;
                return (
                  <div className="p-5 bg-purple-950/40 border border-purple-800/60 rounded-xl backdrop-blur-sm">
                    <h4 className="text-lg font-bold text-white mb-3">学习新法术</h4>
                    <div className="text-sm text-gray-300 mb-3">
                      {spellData.cantripsToLearn > 0 && <div>可学习 {spellData.cantripsToLearn} 个戏法</div>}
                      {spellData.spellsToLearn > 0 && <div>可学习 {spellData.spellsToLearn} 个法术</div>}
                      {sd.schoolRestriction && (
                        <div className="text-xs text-amber-400 mt-1">
                          限定学派：{sd.schoolRestriction.map((s: string) => SCHOOL_CN[s] || s).join('、')}
                          {sd.freeSchoolLevels?.includes(getNewClassLevel(selectedClass)) && '（本级可选任意学派）'}
                        </div>
                      )}
                    </div>
                    {/* Show hint when subclass bonus cantrip overlaps with existing cantrip */}
                    {featureChoices.subclass && (() => {
                      const bc = getSubclassBonusCantrips(selectedClass, featureChoices.subclass);
                      if (!bc.length) return null;
                      const existingIds = new Set([
                        ...extractSpellIds(character.selected_cantrips || []),
                        ...getRacialSpells(character.race_id, character.subrace_id ?? null, character.level || 1, character.race_choices || (character as any).raceChoices)
                          .filter(rs => rs.level === 0).map(rs => rs.id),
                      ]);
                      const overlap = bc.filter(c => existingIds.has(c));
                      return overlap.length > 0 ? (
                        <p className="text-sm text-purple-300 mb-3 bg-purple-900/20 border border-purple-700/30 rounded px-3 py-1.5">
                          你已习得子职业赠送的戏法，因此可额外自选 {overlap.length} 个戏法作为替代
                        </p>
                      ) : null;
                    })()}
                    <SpellSelector
                      characterClass={sd.spellList || selectedClass}
                      characterLevel={getNewClassLevel(selectedClass)}
                      knownSpells={[
                        ...extractSpellIds(character.selected_spells || []),
                        ...extractSpellIds(character.selected_cantrips || []),
                        // Include racial cantrips so they can't be picked again
                        ...getRacialSpells(character.race_id, character.subrace_id ?? null, character.level || 1, character.race_choices || (character as any).raceChoices)
                          .filter(rs => rs.level === 0).map(rs => rs.id),
                      ]}
                      cantripsKnown={spellData.cantripsToLearn}
                      spellsKnown={spellData.spellsToLearn}
                      maxSpellLevel={spellData.maxSpellLevel}
                      canReplaceSpells={spellData.canReplaceSpells}
                      expandedSpellIds={allExpandedIds}
                      schoolRestriction={sd.freeSchoolLevels?.includes(getNewClassLevel(selectedClass)) ? undefined : sd.schoolRestriction}
                      onSelect={(spells) => setFeatureChoices({ ...featureChoices, spells })}
                    />
                  </div>
                );
              }
              return null;
            })()}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between items-center mt-6 pt-6 border-t border-gray-700">
          <button
            onClick={() => {
              if (currentStep === 'features') {
                setCurrentStep('class');
                setSelectedClass(''); // Clear selection when going back
                setFeatureChoices({}); // Clear any choices made
              } else {
                onCancel();
              }
            }}
            className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white rounded-xl transition-all font-medium"
          >
            {currentStep === 'features' ? '返回' : '取消'}
          </button>

          <button
            onClick={handleConfirm}
            disabled={!canConfirmLevelUp()}
            className="px-8 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-xl transition-all shadow-lg shadow-purple-600/20 font-bold flex items-center gap-2"
          >
            {currentStep === 'class' && getNewFeatures().some(f => f.required || (f.options && f.options.length > 0 && !f.type)) ? (
              <>下一步 <ChevronRight className="w-5 h-5 -mr-1" /></>
            ) : (
              <>确认升级 <Sparkles className="w-5 h-5 -mr-1" /></>
            )}
          </button>
        </div>
      </div>

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
    </div>,
    document.body
  );
}
