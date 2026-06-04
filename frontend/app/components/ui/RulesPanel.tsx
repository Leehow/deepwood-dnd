import { useState, useEffect, useCallback, useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";

// Import types
import { RuleFile, SearchResult, RULE_FILES } from "./Rules_Types";

// Import detail renderers
import { renderClassDetail } from "./Rules_ClassDetail";
import { renderRaceDetail } from "./Rules_RaceDetail";
import { getSpellSchoolConfig } from "./Rules_SpellDetail";
import { SpellCard } from "~/components/spell/SpellCard";
import { normalizeSpellData } from "~/components/spell/normalizeSpell";
import { renderEquipmentDetail } from "./Rules_EquipmentDetail";
import { renderMonsterDetail } from "./Rules_MonsterDetail";
import { createLogger } from '~/utils/logger';
import {
  renderGenericDetail,
  renderBackgroundDetail,
  renderConditionDetail,
  renderCreatureDetail,
  renderPlaneDetail,
  renderSkillDetail,
  renderAbilityDetail,
  renderCoreRuleDetail,
  renderCombatRuleDetail,
  renderDeityDetail,
  renderDiseaseDetail,
  renderPoisonDetail,
  renderNPCTemplateDetail,
  renderEncounterTableDetail,
} from "./Rules_OtherDetails";
import { Rules_AIQueryTab } from "./Rules_AIQueryTab";

const logger = createLogger('RulesPanel');

// Base path for static assets (still used for rules-with-ai)
const BASE_PATH = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL.replace(/\/$/, '') : '';

// Dynamic import map for rule files
const RULES_IMPORT_MAP: Record<string, () => Promise<any>> = {
  abilities: () => import('~/data/rules/abilities.json'),
  backgrounds: () => import('~/data/rules/backgrounds.json'),
  classes: () => import('~/data/rules/classes.json'),
  'combat-rules': () => import('~/data/rules/combat-rules.json'),
  conditions: () => import('~/data/rules/conditions.json'),
  'core-rules': () => import('~/data/rules/core-rules.json'),
  creatures: () => import('~/data/rules/creatures.json'),
  diseases: () => import('~/data/rules/diseases.json'),
  'encounter-tables': () => import('~/data/rules/encounter-tables.json'),
  equipment: () => import('~/data/rules/equipment.json'),
  'magic-items': () => import('~/data/rules/magic-items.json'),
  gods: () => import('~/data/rules/gods.json'),
  monsters: () => import('~/data/npc/monsters.json'),
  'npc-templates': () => import('~/data/rules/npc-templates.json'),
  planes: () => import('~/data/rules/planes.json'),
  poisons: () => import('~/data/rules/poisons.json'),
  races: () => import('~/data/rules/races.json'),
  skills: () => import('~/data/rules/skills.json'),
  spells: () => import('~/data/rules/spells.json'),
};

// Module-level cache (persists across component remounts/tab switches)
// Map from displayName to RuleFile
const rulesDataCache = new Map<string, RuleFile>();
const loadingTypes = new Set<string>();

// Known AI-enhanced files
const AI_ENHANCED_FILES = new Set(['classes']);

// Fetch a single rule file by its config
async function fetchRuleFile(file: typeof RULE_FILES[number]): Promise<RuleFile | null> {
  try {
    // Try AI-enhanced version first for known files
    if (AI_ENHANCED_FILES.has(file.name)) {
      try {
        const response = await fetch(`${BASE_PATH}/rules-with-ai/${file.name}.json`);
        if (response.ok) {
          const data = await response.json();
          return { name: file.name, displayName: file.displayName, data };
        }
      } catch { /* fall through to import */ }
    }
    // Use dynamic import from unified data directory
    const importer = RULES_IMPORT_MAP[file.name];
    if (importer) {
      const module = await importer();
      return { name: file.name, displayName: file.displayName, data: module.default };
    }
  } catch (error) {
    logger.error(`Failed to load ${file.name}:`, error);
  }
  return null;
}

// 核心规则键名到中文名称的映射
const CORE_RULES_NAMES: Record<string, { name: string; nameEn: string }> = {
  dice: { name: "骰子类型", nameEn: "Dice Types" },
  d20System: { name: "d20系统", nameEn: "d20 System" },
  advantageDisadvantage: { name: "优势与劣势", nameEn: "Advantage & Disadvantage" },
  proficiencyBonus: { name: "熟练加值", nameEn: "Proficiency Bonus" },
  inspiration: { name: "激励", nameEn: "Inspiration" },
  specificBeatsGeneral: { name: "特例优先于常规", nameEn: "Specific Beats General" },
  roundDown: { name: "向下取整", nameEn: "Round Down" },
  time: { name: "时间", nameEn: "Time" },
  movement: { name: "移动", nameEn: "Movement" },
  vision: { name: "视觉与光照", nameEn: "Vision & Light" },
  cover: { name: "掩护", nameEn: "Cover" },
  resting: { name: "休息", nameEn: "Resting" },
  conditions: { name: "状态", nameEn: "Conditions" },
  damageTypes: { name: "伤害类型", nameEn: "Damage Types" },
  damageResistance: { name: "伤害抗性", nameEn: "Damage Resistance" },
  healingAndDying: { name: "治疗与死亡", nameEn: "Healing & Dying" },
};

// 战斗规则键名到中文名称的映射
const COMBAT_RULES_NAMES: Record<string, { name: string; nameEn: string }> = {
  initiative: { name: "先攻顺序", nameEn: "Initiative" },
  surprise: { name: "突袭", nameEn: "Surprise" },
  combatRound: { name: "回合", nameEn: "Round" },
  turn: { name: "轮次", nameEn: "Turn" },
  actions: { name: "动作", nameEn: "Actions" },
  bonusActions: { name: "附赠动作", nameEn: "Bonus Actions" },
  reactions: { name: "反应", nameEn: "Reactions" },
  movement: { name: "移动", nameEn: "Movement" },
  attacking: { name: "攻击", nameEn: "Attacking" },
  cover: { name: "掩护", nameEn: "Cover" },
  damage: { name: "伤害", nameEn: "Damage" },
  healing: { name: "治疗", nameEn: "Healing" },
  droppingTo0HitPoints: { name: "生命值降至0", nameEn: "Dropping to 0 HP" },
  knockingCreatureOut: { name: "击晕生物", nameEn: "Knocking Out" },
  temporaryHitPoints: { name: "临时生命值", nameEn: "Temporary HP" },
  mountedCombat: { name: "骑乘战斗", nameEn: "Mounted Combat" },
  underwaterCombat: { name: "水下战斗", nameEn: "Underwater Combat" },
};

// 装备类型颜色配置
const EQUIPMENT_CATEGORY_CONFIG: Record<string, {
  name: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  armor: { name: '护甲', color: 'text-blue-400', bgColor: 'bg-blue-900/30', borderColor: 'border-blue-700/50' },
  weapon: { name: '武器', color: 'text-red-400', bgColor: 'bg-red-900/30', borderColor: 'border-red-700/50' },
  gear: { name: '冒险装备', color: 'text-amber-400', bgColor: 'bg-amber-900/30', borderColor: 'border-amber-700/50' },
  tool: { name: '工具', color: 'text-green-400', bgColor: 'bg-green-900/30', borderColor: 'border-green-700/50' },
  pack: { name: '装备包', color: 'text-purple-400', bgColor: 'bg-purple-900/30', borderColor: 'border-purple-700/50' },
};

// 属性颜色配置（用于技能分组）
const ABILITY_CONFIG: Record<string, {
  name: string;
  nameEn: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  strength: { name: '力量', nameEn: 'STR', color: 'text-red-400', bgColor: 'bg-red-900/30', borderColor: 'border-red-700/50' },
  dexterity: { name: '敏捷', nameEn: 'DEX', color: 'text-green-400', bgColor: 'bg-green-900/30', borderColor: 'border-green-700/50' },
  constitution: { name: '体质', nameEn: 'CON', color: 'text-orange-400', bgColor: 'bg-orange-900/30', borderColor: 'border-orange-700/50' },
  intelligence: { name: '智力', nameEn: 'INT', color: 'text-blue-400', bgColor: 'bg-blue-900/30', borderColor: 'border-blue-700/50' },
  wisdom: { name: '感知', nameEn: 'WIS', color: 'text-cyan-400', bgColor: 'bg-cyan-900/30', borderColor: 'border-cyan-700/50' },
  charisma: { name: '魅力', nameEn: 'CHA', color: 'text-pink-400', bgColor: 'bg-pink-900/30', borderColor: 'border-pink-700/50' },
};

function getAbilityConfig(ability: string) {
  return ABILITY_CONFIG[ability?.toLowerCase()] || {
    name: ability || '未知',
    nameEn: ability || '???',
    color: 'text-gray-400',
    bgColor: 'bg-gray-900/30',
    borderColor: 'border-gray-700/50'
  };
}

// 魔法物品稀有度颜色配置
const MAGIC_ITEM_RARITY_CONFIG: Record<string, {
  name: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  '普通': { name: '普通', color: 'text-gray-400', bgColor: 'bg-gray-800/30', borderColor: 'border-gray-700/50' },
  '罕见': { name: '罕见', color: 'text-green-400', bgColor: 'bg-green-900/30', borderColor: 'border-green-700/50' },
  '稀有': { name: '稀有', color: 'text-blue-400', bgColor: 'bg-blue-900/30', borderColor: 'border-blue-700/50' },
  '非常稀有': { name: '非常稀有', color: 'text-purple-400', bgColor: 'bg-purple-900/30', borderColor: 'border-purple-700/50' },
  '传说': { name: '传说', color: 'text-orange-400', bgColor: 'bg-orange-900/30', borderColor: 'border-orange-700/50' },
  '神器': { name: '神器', color: 'text-red-400', bgColor: 'bg-red-900/30', borderColor: 'border-red-700/50' },
  '不定': { name: '不定', color: 'text-cyan-400', bgColor: 'bg-cyan-900/30', borderColor: 'border-cyan-700/50' },
};

function getMagicItemRarityConfig(rarity: string) {
  return MAGIC_ITEM_RARITY_CONFIG[rarity] || {
    name: rarity || '未知',
    color: 'text-gray-400',
    bgColor: 'bg-gray-900/30',
    borderColor: 'border-gray-700/50'
  };
}

// 魔法物品类别颜色配置
const MAGIC_ITEM_CATEGORY_CONFIG: Record<string, {
  name: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  '奇物': { name: '奇物', color: 'text-purple-400', bgColor: 'bg-purple-900/30', borderColor: 'border-purple-700/50' },
  '药水': { name: '药水', color: 'text-pink-400', bgColor: 'bg-pink-900/30', borderColor: 'border-pink-700/50' },
  '戒指': { name: '戒指', color: 'text-yellow-400', bgColor: 'bg-yellow-900/30', borderColor: 'border-yellow-700/50' },
  '武器': { name: '武器', color: 'text-red-400', bgColor: 'bg-red-900/30', borderColor: 'border-red-700/50' },
  '护甲': { name: '护甲', color: 'text-blue-400', bgColor: 'bg-blue-900/30', borderColor: 'border-blue-700/50' },
  '魔杖': { name: '魔杖', color: 'text-cyan-400', bgColor: 'bg-cyan-900/30', borderColor: 'border-cyan-700/50' },
  '法杖': { name: '法杖', color: 'text-emerald-400', bgColor: 'bg-emerald-900/30', borderColor: 'border-emerald-700/50' },
  '卷轴': { name: '卷轴', color: 'text-amber-400', bgColor: 'bg-amber-900/30', borderColor: 'border-amber-700/50' },
  '权杖': { name: '权杖', color: 'text-orange-400', bgColor: 'bg-orange-900/30', borderColor: 'border-orange-700/50' },
  '弹药': { name: '弹药', color: 'text-gray-400', bgColor: 'bg-gray-800/30', borderColor: 'border-gray-700/50' },
};

function getMagicItemCategoryConfig(category: string) {
  return MAGIC_ITEM_CATEGORY_CONFIG[category] || {
    name: category || '其他',
    color: 'text-gray-400',
    bgColor: 'bg-gray-900/30',
    borderColor: 'border-gray-700/50'
  };
}

// 怪物类型颜色配置
const MONSTER_TYPE_CONFIG: Record<string, {
  name: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  '异怪': { name: '异怪', color: 'text-purple-400', bgColor: 'bg-purple-900/30', borderColor: 'border-purple-700/50' },
  '野兽': { name: '野兽', color: 'text-green-400', bgColor: 'bg-green-900/30', borderColor: 'border-green-700/50' },
  '天界生物': { name: '天界生物', color: 'text-yellow-300', bgColor: 'bg-yellow-900/30', borderColor: 'border-yellow-700/50' },
  '构装生物': { name: '构装生物', color: 'text-gray-400', bgColor: 'bg-gray-800/30', borderColor: 'border-gray-700/50' },
  '龙类': { name: '龙类', color: 'text-red-400', bgColor: 'bg-red-900/30', borderColor: 'border-red-700/50' },
  '元素生物': { name: '元素生物', color: 'text-cyan-400', bgColor: 'bg-cyan-900/30', borderColor: 'border-cyan-700/50' },
  '精类': { name: '精类', color: 'text-emerald-400', bgColor: 'bg-emerald-900/30', borderColor: 'border-emerald-700/50' },
  '邪魔': { name: '邪魔', color: 'text-rose-500', bgColor: 'bg-rose-900/30', borderColor: 'border-rose-700/50' },
  '巨人': { name: '巨人', color: 'text-orange-400', bgColor: 'bg-orange-900/30', borderColor: 'border-orange-700/50' },
  '人形生物': { name: '人形生物', color: 'text-blue-400', bgColor: 'bg-blue-900/30', borderColor: 'border-blue-700/50' },
  '怪兽': { name: '怪兽', color: 'text-amber-500', bgColor: 'bg-amber-900/30', borderColor: 'border-amber-700/50' },
  '泥怪': { name: '泥怪', color: 'text-lime-400', bgColor: 'bg-lime-900/30', borderColor: 'border-lime-700/50' },
  '植物': { name: '植物', color: 'text-green-500', bgColor: 'bg-green-800/30', borderColor: 'border-green-600/50' },
  '不死生物': { name: '不死生物', color: 'text-gray-300', bgColor: 'bg-gray-700/30', borderColor: 'border-gray-600/50' },
};

function getMonsterTypeConfig(type: string) {
  // Extract base type from composite strings like "邪魔 (魔鬼)"
  const baseType = type?.split(/[（(]/)[0]?.trim() || type;
  return MONSTER_TYPE_CONFIG[baseType] || {
    name: type || '未知',
    color: 'text-gray-400',
    bgColor: 'bg-gray-900/30',
    borderColor: 'border-gray-700/50'
  };
}

// CR颜色配置（按危险程度）
function getCRColor(cr: string | number): string {
  const crStr = String(cr);
  const crNum = crStr === '0' ? 0 : crStr.includes('/') ? eval(crStr) : parseFloat(crStr);
  if (crNum <= 1) return 'text-green-400';
  if (crNum <= 4) return 'text-yellow-400';
  if (crNum <= 10) return 'text-orange-400';
  if (crNum <= 17) return 'text-red-400';
  return 'text-purple-400'; // CR 18+
}

// 装备子类型名称映射
const EQUIPMENT_SUBCATEGORY_NAMES: Record<string, string> = {
  light: '轻甲',
  medium: '中甲',
  heavy: '重甲',
  shield: '盾牌',
  'simple-melee': '简易近战武器',
  'simple-ranged': '简易远程武器',
  'martial-melee': '军用近战武器',
  'martial-ranged': '军用远程武器',
  general: '通用装备',
  artisansTools: '工匠工具',
  specializedTools: '专业工具',
  gamingSets: '游戏组',
  musicalInstruments: '乐器',
  pack: '装备包',
};

function getEquipmentCategoryConfig(category: string) {
  return EQUIPMENT_CATEGORY_CONFIG[category] || {
    name: category,
    color: 'text-gray-400',
    bgColor: 'bg-gray-900/30',
    borderColor: 'border-gray-700/50'
  };
}

interface RulesPanelProps {
  campaignId?: string;
  userId?: string;
  activeSubTab?: string;
  onSubTabChange?: (tab: string) => void;
}

export function RulesPanel({ campaignId, userId, activeSubTab, onSubTabChange }: RulesPanelProps = {}) {
  const [activeTab, setActiveTabInternal] = useState<string>(activeSubTab || "browse");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState<string | null>(null); // Selected rule type
  const [selectedItem, setSelectedItem] = useState<any | null>(null); // Selected item within type
  const [currentTypeData, setCurrentTypeData] = useState<RuleFile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<SearchResult | null>(null);
  const [aiDescription, setAiDescription] = useState<string>("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");

  // Sync external activeSubTab with internal state
  useEffect(() => {
    if (activeSubTab && activeSubTab !== activeTab) {
      setActiveTabInternal(activeSubTab);
    }
  }, [activeSubTab]);

  // Wrapper to notify parent when tab changes
  const setActiveTab = useCallback((tab: string) => {
    setActiveTabInternal(tab);
    onSubTabChange?.(tab);
  }, [onSubTabChange]);

  // Spell filters
  const [spellLevelFilter, setSpellLevelFilter] = useState<number | null>(null); // null = all levels
  const [spellSchoolFilter, setSpellSchoolFilter] = useState<string | null>(null); // null = all schools

  // Equipment filters
  const [equipmentCategoryFilter, setEquipmentCategoryFilter] = useState<string | null>(null); // null = all categories

  // Monster filters
  const [monsterTypeFilter, setMonsterTypeFilter] = useState<string | null>(null); // null = all types
  const [monsterCRFilter, setMonsterCRFilter] = useState<string | null>(null); // null = all CRs

  // Magic item filters
  const [magicItemRarityFilter, setMagicItemRarityFilter] = useState<string | null>(null);
  const [magicItemCategoryFilter, setMagicItemCategoryFilter] = useState<string | null>(null);

  // Load AI description when detail changes
  useEffect(() => {
    if (selectedDetail && selectedDetail.content && selectedDetail.content.aiDescription) {
      setAiDescription(selectedDetail.content.aiDescription);
    } else {
      setAiDescription("");
    }
  }, [selectedDetail]);

  // Debounce search term (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Load rule file lazily when a type is selected
  useEffect(() => {
    if (!selectedType) {
      setCurrentTypeData(null);
      setIsLoading(false);
      return;
    }

    // Check cache first
    const cached = rulesDataCache.get(selectedType);
    if (cached) {
      setCurrentTypeData(cached);
      setIsLoading(false);
      return;
    }

    // Find file config
    const fileConfig = RULE_FILES.find(f => f.displayName === selectedType);
    if (!fileConfig) {
      setIsLoading(false);
      return;
    }

    // Prevent duplicate loading
    if (loadingTypes.has(selectedType)) return;

    let cancelled = false;
    loadingTypes.add(selectedType);
    setIsLoading(true);

    fetchRuleFile(fileConfig).then(result => {
      loadingTypes.delete(selectedType);
      if (cancelled) return;
      if (result) {
        rulesDataCache.set(result.displayName, result);
        setCurrentTypeData(result);
      }
      setIsLoading(false);
    });

    return () => { cancelled = true; };
  }, [selectedType]);

  // Get items for selected type
  const getItemsForType = (typeDisplayName: string) => {
    const ruleFile = currentTypeData?.displayName === typeDisplayName ? currentTypeData : rulesDataCache.get(typeDisplayName);
    if (!ruleFile) return [];

    const data = ruleFile.data;

    // Extract items based on data structure
    if (Array.isArray(data)) {
      return data;
    } else if (data.classes) {
      return data.classes;
    } else if (data.races) {
      return data.races;
    } else if (data.spells) {
      return data.spells;
    } else if (data.abilities) {
      return data.abilities;
    } else if (data.skills) {
      return data.skills;
    } else if (data.backgrounds) {
      return data.backgrounds;
    } else if (data.conditions) {
      return data.conditions;
    } else if (data.creatureCategories) {
      // Creatures: flatten all creatures from all categories
      const items: any[] = [];
      data.creatureCategories.forEach((category: any) => {
        if (category.creatures) {
          items.push(...category.creatures);
        }
      });
      return items;
    } else if (data.monsters) {
      // Monsters: return monsters array directly
      return data.monsters;
    } else if (data.pantheons) {
      // Gods: return pantheons and nonhumanDeities combined
      const items = [...data.pantheons];
      if (data.nonhumanDeities) {
        items.push(data.nonhumanDeities); // nonhumanDeities is an object, not an array
      }
      return items;
    } else if (data.materialPlane || data.innerPlanes || data.outerPlanes) {
      // Planes: collect all planes from different categories
      const items: any[] = [];

      // Material Plane (single object)
      if (data.materialPlane) {
        items.push(data.materialPlane);
      }

      // Echo Planes
      if (data.echoPlanes?.planes) {
        items.push(...data.echoPlanes.planes);
      }

      // Energy Planes
      if (data.energyPlanes?.planes) {
        items.push(...data.energyPlanes.planes);
      }

      // Transitive Planes
      if (data.transitivePlanes?.planes) {
        items.push(...data.transitivePlanes.planes);
      }

      // Inner Planes (elemental)
      if (data.innerPlanes?.elementalPlanes) {
        items.push(...data.innerPlanes.elementalPlanes);
      }

      // Outer Planes
      if (data.outerPlanes?.planes) {
        items.push(...data.outerPlanes.planes);
      }

      // Outlands (single object)
      if (data.outlands) {
        items.push(data.outlands);
      }

      return items;
    } else if (data.coreRules) {
      // Core rules is an object, convert to array of entries
      return Object.entries(data.coreRules).map(([key, value]: [string, any]) => {
        const nameInfo = CORE_RULES_NAMES[key];
        return {
          id: key,
          name: value.name || nameInfo?.name || key,
          nameEn: value.nameEn || nameInfo?.nameEn || key,
          ...value,
        };
      });
    } else if (data.combat) {
      // Combat rules is an object, convert to array of entries
      return Object.entries(data.combat).map(([key, value]: [string, any]) => {
        const nameInfo = COMBAT_RULES_NAMES[key];
        return {
          id: key,
          name: value.name || nameInfo?.name || key,
          nameEn: value.nameEn || nameInfo?.nameEn || key,
          ...value,
        };
      });
    } else if (data.armor || data.weapons || data.adventuringGear || data.tools) {
      // Equipment is complex, return all items flattened with category info
      const items: any[] = [];
      if (data.armor) {
        Object.entries(data.armor).forEach(([subcat, category]: [string, any]) => {
          if (Array.isArray(category)) {
            category.forEach(item => items.push({
              ...item,
              equipmentCategory: 'armor',
              equipmentSubcategory: subcat
            }));
          }
        });
      }
      if (data.weapons) {
        const { simple, martial } = data.weapons;
        if (simple?.melee) simple.melee.forEach((item: any) => items.push({
          ...item,
          equipmentCategory: 'weapon',
          equipmentSubcategory: 'simple-melee'
        }));
        if (simple?.ranged) simple.ranged.forEach((item: any) => items.push({
          ...item,
          equipmentCategory: 'weapon',
          equipmentSubcategory: 'simple-ranged'
        }));
        if (martial?.melee) martial.melee.forEach((item: any) => items.push({
          ...item,
          equipmentCategory: 'weapon',
          equipmentSubcategory: 'martial-melee'
        }));
        if (martial?.ranged) martial.ranged.forEach((item: any) => items.push({
          ...item,
          equipmentCategory: 'weapon',
          equipmentSubcategory: 'martial-ranged'
        }));
      }
      if (data.adventuringGear) {
        if (Array.isArray(data.adventuringGear)) {
          data.adventuringGear.forEach((item: any) => items.push({
            ...item,
            equipmentCategory: 'gear',
            equipmentSubcategory: 'general'
          }));
        } else {
          Object.entries(data.adventuringGear).forEach(([subcat, category]: [string, any]) => {
            if (Array.isArray(category)) {
              category.forEach(item => items.push({
                ...item,
                equipmentCategory: 'gear',
                equipmentSubcategory: subcat
              }));
            }
          });
        }
      }
      if (data.tools) {
        Object.entries(data.tools).forEach(([subcat, category]: [string, any]) => {
          if (Array.isArray(category)) {
            category.forEach(item => items.push({
              ...item,
              equipmentCategory: 'tool',
              equipmentSubcategory: subcat
            }));
          }
        });
      }
      if (data.packs) {
        if (Array.isArray(data.packs)) {
          data.packs.forEach((item: any) => items.push({
            ...item,
            equipmentCategory: 'pack',
            equipmentSubcategory: 'pack'
          }));
        }
      }
      return items;
    } else if (data.items && data.totalCount !== undefined) {
      // Magic items format
      return data.items;
    } else if (data.diseases && Array.isArray(data.diseases)) {
      // Diseases format
      return data.diseases;
    } else if (data.poisons && Array.isArray(data.poisons)) {
      // Poisons format
      return data.poisons;
    } else if (data.npcs && Array.isArray(data.npcs)) {
      // NPC templates format
      return data.npcs;
    } else if (data.environments && typeof data.environments === 'object' && !Array.isArray(data.environments)) {
      // Encounter tables format - environments is an object, convert to array
      return Object.values(data.environments);
    }

    return [];
  };

  // Search function (only when search term is provided)
  const performSearch = useCallback(() => {
    if (!debouncedSearchTerm.trim()) return [];

    const results: SearchResult[] = [];
    const query = useRegex ? new RegExp(debouncedSearchTerm, "i") : debouncedSearchTerm;

    const searchInObject = (obj: any, path: string, fileName: string) => {
      const matchText = (text: string): boolean => {
        if (typeof query === "string") {
          return text.toLowerCase().includes(query.toLowerCase());
        } else {
          return query.test(text);
        }
      };

      const search = (current: any, currentPath: string) => {
        if (typeof current === "string") {
          if (matchText(current)) {
            results.push({
              fileName,
              path: currentPath,
              content: current,
              matchText: current,
            });
          }
        } else if (Array.isArray(current)) {
          current.forEach((item, index) => {
            search(item, `${currentPath}[${index}]`);
          });
        } else if (typeof current === "object" && current !== null) {
          Object.entries(current).forEach(([key, value]: [string, any]) => {
            const newPath = currentPath ? `${currentPath}.${key}` : key;

            // Check if key matches
            if (matchText(key)) {
              results.push({
                fileName,
                path: newPath,
                content: value,
                matchText: key,
              });
            }

            // Check if value matches (for specific keys we care about)
            if (
              (key === "name" ||
                key === "nameEn" ||
                key === "description" ||
                key === "id") &&
              typeof value === "string" &&
              matchText(value)
            ) {
              // Include parent object for better context
              results.push({
                fileName,
                path: currentPath || "root",
                content: current,
                matchText: value,
              });
            }

            search(value, newPath);
          });
        }
      };

      search(obj, path);
    };

    // If a type is selected, only search within that type's data
    // Otherwise, search only already-cached files
    const dataToSearch: RuleFile[] = selectedType
      ? (currentTypeData ? [currentTypeData] : [])
      : Array.from(rulesDataCache.values());

    dataToSearch.forEach((file) => {
      searchInObject(file.data, "", file.displayName);
    });

    // Deduplicate results based on content
    const seen = new Set();
    return results.filter((r) => {
      const key = `${r.fileName}-${r.matchText}-${JSON.stringify(r.content).substring(0, 100)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [debouncedSearchTerm, useRegex, selectedType, currentTypeData]);

  const searchResults = useMemo(() => debouncedSearchTerm.trim() ? performSearch() : [], [performSearch, debouncedSearchTerm]);

  // Render detailed content based on data type
  const renderDetailContent = (result: SearchResult): React.ReactNode => {
    const { fileName, content } = result;

    if (fileName === "职业" && content.id && content.features) {
      return renderClassDetail(content);
    }
    if (fileName === "种族" && content.id && content.traits) {
      return renderRaceDetail(content);
    }
    if (fileName === "法术" && content.id && content.level !== undefined) {
      return <SpellCard spell={normalizeSpellData(content)} variant="full" showTargeting />;
    }
    if (fileName === "背景" && content.id && content.skillProficiencies) {
      return renderBackgroundDetail(content);
    }
    if (fileName === "状态" && content.id && content.effects) {
      return renderConditionDetail(content);
    }
    if (fileName === "生物" && content.category && content.creatures) {
      return renderCreatureDetail(content);
    }
    if (fileName === "装备" && content.id) {
      return renderEquipmentDetail(content);
    }
    if (fileName === "位面" && content.id) {
      return renderPlaneDetail(content);
    }
    if (fileName === "技能" && content.id && content.ability) {
      return renderSkillDetail(content);
    }
    if (fileName === "属性" && content.id && content.abbreviation) {
      return renderAbilityDetail(content);
    }
    if (fileName === "核心规则" && content.id) {
      return renderCoreRuleDetail(content);
    }
    if (fileName === "战斗规则" && content.id) {
      return renderCombatRuleDetail(content);
    }
    if (fileName === "神祇") {
      return renderDeityDetail(content);
    }
    if (fileName === "怪物" && content.id && content.cr !== undefined) {
      return renderMonsterDetail(content);
    }
    if (fileName === "魔法物品" && content.id) {
      // Inline magic item detail rendering
      const item = content;
      const rarityConfig = getMagicItemRarityConfig(item.rarityCn);
      const catConfig = getMagicItemCategoryConfig(item.categoryCn);
      return (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${rarityConfig.bgColor} ${rarityConfig.color} border ${rarityConfig.borderColor}`}>
              {item.rarityCn}
            </span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${catConfig.bgColor} ${catConfig.color} border ${catConfig.borderColor}`}>
              {item.categoryCn}
            </span>
            {item.requiresAttunement && (
              <span className="px-3 py-1 rounded-full text-sm font-medium bg-yellow-900/30 text-yellow-400 border border-yellow-700/50">
                需调谐
              </span>
            )}
          </div>

          {/* English name */}
          {item.nameEn && (
            <div className="text-gray-400 text-sm italic">{item.nameEn}</div>
          )}

          {/* Description */}
          {item.description && (
            <div className="space-y-2">
              <h4 className="text-amber-400 font-medium">描述</h4>
              <div className="text-gray-300 leading-relaxed whitespace-pre-line">{item.description}</div>
            </div>
          )}

          {/* Stats - 数值属性 */}
          {item.stats && Object.keys(item.stats).length > 0 && (
            <div className="space-y-2">
              <h4 className="text-amber-400 font-medium">属性</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {item.stats.bonus && (
                  <div className="bg-green-900/20 border border-green-700/30 rounded px-2 py-1">
                    <span className="text-gray-400">加成:</span>
                    <span className="text-green-400 ml-1">+{item.stats.bonus}</span>
                  </div>
                )}
                {item.stats.ac_bonus && (
                  <div className="bg-blue-900/20 border border-blue-700/30 rounded px-2 py-1">
                    <span className="text-gray-400">AC:</span>
                    <span className="text-blue-400 ml-1">+{item.stats.ac_bonus}</span>
                  </div>
                )}
                {item.stats.charges && (
                  <div className="bg-purple-900/20 border border-purple-700/30 rounded px-2 py-1">
                    <span className="text-gray-400">充能:</span>
                    <span className="text-purple-400 ml-1">{item.stats.charges}</span>
                    {item.stats.recharge && <span className="text-gray-500 ml-1">({item.stats.recharge})</span>}
                  </div>
                )}
                {item.stats.damage && (
                  <div className="bg-red-900/20 border border-red-700/30 rounded px-2 py-1">
                    <span className="text-gray-400">伤害:</span>
                    <span className="text-red-400 ml-1">{item.stats.damage}</span>
                  </div>
                )}
                {item.stats.healing && (
                  <div className="bg-emerald-900/20 border border-emerald-700/30 rounded px-2 py-1">
                    <span className="text-gray-400">治疗:</span>
                    <span className="text-emerald-400 ml-1">{item.stats.healing}</span>
                  </div>
                )}
                {item.stats.save_dc && (
                  <div className="bg-orange-900/20 border border-orange-700/30 rounded px-2 py-1">
                    <span className="text-gray-400">DC:</span>
                    <span className="text-orange-400 ml-1">{item.stats.save_dc}</span>
                  </div>
                )}
                {item.stats.uses && (
                  <div className="bg-cyan-900/20 border border-cyan-700/30 rounded px-2 py-1">
                    <span className="text-gray-400">使用:</span>
                    <span className="text-cyan-400 ml-1">{item.stats.uses}</span>
                  </div>
                )}
                {item.stats.duration && (
                  <div className="bg-indigo-900/20 border border-indigo-700/30 rounded px-2 py-1">
                    <span className="text-gray-400">持续:</span>
                    <span className="text-indigo-400 ml-1">{item.stats.duration}</span>
                  </div>
                )}
              </div>
              {item.stats.effects && item.stats.effects.length > 0 && (
                <div className="mt-2">
                  <span className="text-gray-400 text-sm">效果: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {item.stats.effects.map((effect: string, idx: number) => (
                      <span key={idx} className="px-2 py-0.5 bg-amber-900/20 border border-amber-700/30 rounded text-amber-400 text-xs">
                        {effect}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Rarity info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">稀有度:</span>
              <span className={`ml-2 ${rarityConfig.color}`}>{item.rarityCn}</span>
            </div>
            <div>
              <span className="text-gray-500">类别:</span>
              <span className={`ml-2 ${catConfig.color}`}>{item.categoryCn}</span>
            </div>
          </div>
        </div>
      );
    }
    if (fileName === "疾病" && content.id) {
      return renderDiseaseDetail(content);
    }
    if (fileName === "毒素" && content.id) {
      return renderPoisonDetail(content);
    }
    if (fileName === "NPC模板" && content.id) {
      return renderNPCTemplateDetail(content);
    }
    if (fileName === "遭遇表" && content.id) {
      return renderEncounterTableDetail(content);
    }

    return renderGenericDetail(content);
  };

  return (
    <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col overflow-hidden">
      {/* Tab List */}
      <Tabs.List className="panel-sub-tabs flex border-b border-amber-500/10 flex-shrink-0 bg-gradient-to-r from-gray-800/50 to-gray-900/50">
        <Tabs.Trigger
          value="browse"
          className="flex-1 px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-all data-[state=active]:bg-gradient-to-b data-[state=active]:from-amber-500/10 data-[state=active]:to-transparent data-[state=active]:text-amber-400 data-[state=active]:border-b-2 data-[state=active]:border-amber-500 data-[state=active]:shadow-inner text-gray-400 hover:text-amber-300 hover:bg-gray-800/50"
        >
          <span>📚</span> 规则浏览
        </Tabs.Trigger>
        {campaignId && userId && (
          <Tabs.Trigger
            value="ai-query"
            className="flex-1 px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-all data-[state=active]:bg-gradient-to-b data-[state=active]:from-amber-500/10 data-[state=active]:to-transparent data-[state=active]:text-amber-400 data-[state=active]:border-b-2 data-[state=active]:border-amber-500 data-[state=active]:shadow-inner text-gray-400 hover:text-amber-300 hover:bg-gray-800/50"
          >
            <span>🤖</span> AI 询问
          </Tabs.Trigger>
        )}
      </Tabs.List>

      {/* Browse Tab Content */}
      <Tabs.Content value="browse" className="flex-1 flex flex-col overflow-hidden data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
        {/* Search Bar */}
        <div className="p-4 border-b border-amber-500/10 flex-shrink-0 bg-gradient-to-b from-gray-800/30 to-transparent">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">🔍</span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={selectedType ? `在${selectedType}中搜索...` : "搜索已加载的规则..."}
                className="w-full pl-9 pr-4 py-2.5 bg-gray-800/80 border border-gray-700/50 rounded-lg text-gray-200 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-400 px-3 py-2 bg-gray-800/50 rounded-lg border border-gray-700/50 cursor-pointer hover:bg-gray-800 hover:border-amber-500/30 transition-all">
              <input
                type="checkbox"
                checked={useRegex}
                onChange={(e) => setUseRegex(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700 text-amber-500 focus:ring-amber-500/50"
              />
              <span>正则</span>
            </label>
          </div>
          {debouncedSearchTerm && (
            <div className="text-xs text-amber-400/70 mt-2 flex items-center gap-1">
              <span>✨</span> 找到 {searchResults.length} 个结果
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-auto p-4">
        {selectedType ? (
          // Item List View (when a type is selected) - with filtering support
          isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin"></div>
              <div className="text-gray-400 text-sm">加载{selectedType}数据中...</div>
            </div>
          ) : (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => {
                  setSelectedType(null);
                  setSearchTerm("");
                  setSpellLevelFilter(null);
                  setSpellSchoolFilter(null);
                  setEquipmentCategoryFilter(null);
                  setMagicItemRarityFilter(null);
                  setMagicItemCategoryFilter(null);
                }}
                className="fantasy-btn text-sm flex items-center gap-1.5"
              >
                <span>←</span> 返回
              </button>
              <h2 className="text-lg font-semibold text-amber-400 font-fantasy tracking-wide">{selectedType}</h2>
            </div>

            {/* Spell Filters - only show for spells */}
            {selectedType === "法术" && (
              <div className="mb-4 flex flex-wrap gap-2">
                {/* Level Filter */}
                <select
                  value={spellLevelFilter === null ? "" : spellLevelFilter}
                  onChange={(e) => setSpellLevelFilter(e.target.value === "" ? null : Number(e.target.value))}
                  className="px-3 py-2 bg-gray-800/80 border border-gray-700/50 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all cursor-pointer"
                >
                  <option value="">全部环数</option>
                  <option value="0">戏法</option>
                  <option value="1">1环</option>
                  <option value="2">2环</option>
                  <option value="3">3环</option>
                  <option value="4">4环</option>
                  <option value="5">5环</option>
                  <option value="6">6环</option>
                  <option value="7">7环</option>
                  <option value="8">8环</option>
                  <option value="9">9环</option>
                </select>

                {/* School Filter */}
                <select
                  value={spellSchoolFilter || ""}
                  onChange={(e) => setSpellSchoolFilter(e.target.value || null)}
                  className="px-3 py-2 bg-gray-800/80 border border-gray-700/50 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all cursor-pointer"
                >
                  <option value="">全部学派</option>
                  <option value="abjuration">防护</option>
                  <option value="conjuration">咒法</option>
                  <option value="divination">预言</option>
                  <option value="enchantment">惑控</option>
                  <option value="evocation">塑能</option>
                  <option value="illusion">幻术</option>
                  <option value="necromancy">死灵</option>
                  <option value="transmutation">变化</option>
                </select>

                {/* Clear filters button */}
                {(spellLevelFilter !== null || spellSchoolFilter !== null) && (
                  <button
                    onClick={() => {
                      setSpellLevelFilter(null);
                      setSpellSchoolFilter(null);
                    }}
                    className="fantasy-btn text-sm"
                  >
                    清除筛选
                  </button>
                )}
              </div>
            )}

            {/* Equipment Filters - only show for equipment */}
            {selectedType === "装备" && (
              <div className="mb-4 flex flex-wrap gap-2">
                <select
                  value={equipmentCategoryFilter || ""}
                  onChange={(e) => setEquipmentCategoryFilter(e.target.value || null)}
                  className="px-3 py-2 bg-gray-800/80 border border-gray-700/50 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all cursor-pointer"
                >
                  <option value="">全部类型</option>
                  <option value="armor">护甲</option>
                  <option value="weapon">武器</option>
                  <option value="gear">冒险装备</option>
                  <option value="tool">工具</option>
                  <option value="pack">装备包</option>
                </select>

                {equipmentCategoryFilter && (
                  <button
                    onClick={() => setEquipmentCategoryFilter(null)}
                    className="fantasy-btn text-sm"
                  >
                    清除筛选
                  </button>
                )}
              </div>
            )}

            {/* Monster Filters - only show for monsters */}
            {selectedType === "怪物" && (
              <div className="mb-4 flex flex-wrap gap-2">
                <select
                  value={monsterTypeFilter || ""}
                  onChange={(e) => setMonsterTypeFilter(e.target.value || null)}
                  className="px-3 py-2 bg-gray-800/80 border border-gray-700/50 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all cursor-pointer"
                >
                  <option value="">全部类型</option>
                  <option value="人形生物">人形生物</option>
                  <option value="野兽">野兽</option>
                  <option value="怪兽">怪兽</option>
                  <option value="龙类">龙类</option>
                  <option value="不死生物">不死生物</option>
                  <option value="邪魔">邪魔</option>
                  <option value="天界生物">天界生物</option>
                  <option value="元素生物">元素生物</option>
                  <option value="精类">精类</option>
                  <option value="异怪">异怪</option>
                  <option value="构装生物">构装生物</option>
                  <option value="泥怪">泥怪</option>
                  <option value="植物">植物</option>
                  <option value="巨人">巨人</option>
                </select>

                <select
                  value={monsterCRFilter || ""}
                  onChange={(e) => setMonsterCRFilter(e.target.value || null)}
                  className="px-3 py-2 bg-gray-800/80 border border-gray-700/50 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all cursor-pointer"
                >
                  <option value="">全部CR</option>
                  <option value="0">CR 0</option>
                  <option value="1/8">CR 1/8</option>
                  <option value="1/4">CR 1/4</option>
                  <option value="1/2">CR 1/2</option>
                  <option value="1">CR 1</option>
                  <option value="2">CR 2</option>
                  <option value="3">CR 3</option>
                  <option value="4">CR 4</option>
                  <option value="5">CR 5</option>
                  <option value="6-10">CR 6-10</option>
                  <option value="11-15">CR 11-15</option>
                  <option value="16-20">CR 16-20</option>
                  <option value="21+">CR 21+</option>
                </select>

                {(monsterTypeFilter || monsterCRFilter) && (
                  <button
                    onClick={() => {
                      setMonsterTypeFilter(null);
                      setMonsterCRFilter(null);
                    }}
                    className="fantasy-btn text-sm"
                  >
                    清除筛选
                  </button>
                )}
              </div>
            )}

            {/* Magic Item Filters - only show for magic items */}
            {selectedType === "魔法物品" && (
              <div className="mb-4 flex flex-wrap gap-2">
                <select
                  value={magicItemRarityFilter || ""}
                  onChange={(e) => setMagicItemRarityFilter(e.target.value || null)}
                  className="px-3 py-2 bg-gray-800/80 border border-gray-700/50 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all cursor-pointer"
                >
                  <option value="">全部稀有度</option>
                  <option value="普通">普通</option>
                  <option value="罕见">罕见</option>
                  <option value="稀有">稀有</option>
                  <option value="非常稀有">非常稀有</option>
                  <option value="传说">传说</option>
                  <option value="神器">神器</option>
                  <option value="不定">不定</option>
                </select>

                <select
                  value={magicItemCategoryFilter || ""}
                  onChange={(e) => setMagicItemCategoryFilter(e.target.value || null)}
                  className="px-3 py-2 bg-gray-800/80 border border-gray-700/50 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all cursor-pointer"
                >
                  <option value="">全部类别</option>
                  <option value="奇物">奇物</option>
                  <option value="药水">药水</option>
                  <option value="戒指">戒指</option>
                  <option value="武器">武器</option>
                  <option value="护甲">护甲</option>
                  <option value="魔杖">魔杖</option>
                  <option value="法杖">法杖</option>
                  <option value="卷轴">卷轴</option>
                  <option value="权杖">权杖</option>
                  <option value="弹药">弹药</option>
                </select>

                {(magicItemRarityFilter || magicItemCategoryFilter) && (
                  <button
                    onClick={() => {
                      setMagicItemRarityFilter(null);
                      setMagicItemCategoryFilter(null);
                    }}
                    className="fantasy-btn text-sm"
                  >
                    清除筛选
                  </button>
                )}
              </div>
            )}

            {(() => {
              // Filter items by search term and spell filters
              const allItems = getItemsForType(selectedType);
              let filteredItems = allItems;

              // Apply search filter
              if (searchTerm.trim()) {
                const query = searchTerm.toLowerCase();
                filteredItems = filteredItems.filter((item: any) => {
                  const name = (item.name || '').toLowerCase();
                  const nameEn = (item.nameEn || '').toLowerCase();
                  const category = (item.category || '').toLowerCase();
                  return name.includes(query) || nameEn.includes(query) || category.includes(query);
                });
              }

              // Apply spell level filter
              if (selectedType === "法术" && spellLevelFilter !== null) {
                filteredItems = filteredItems.filter((item: any) => item.level === spellLevelFilter);
              }

              // Apply spell school filter
              if (selectedType === "法术" && spellSchoolFilter) {
                filteredItems = filteredItems.filter((item: any) =>
                  item.school?.toLowerCase() === spellSchoolFilter.toLowerCase()
                );
              }

              // Apply equipment category filter
              if (selectedType === "装备" && equipmentCategoryFilter) {
                filteredItems = filteredItems.filter((item: any) =>
                  item.equipmentCategory === equipmentCategoryFilter
                );
              }

              // Apply monster type filter
              if (selectedType === "怪物" && monsterTypeFilter) {
                filteredItems = filteredItems.filter((item: any) => {
                  const baseType = item.type?.split(/[（(]/)[0]?.trim() || '';
                  return baseType === monsterTypeFilter;
                });
              }

              // Apply monster CR filter
              if (selectedType === "怪物" && monsterCRFilter) {
                filteredItems = filteredItems.filter((item: any) => {
                  const cr = item.cr;
                  if (monsterCRFilter === '6-10') {
                    const crNum = cr === '0' ? 0 : cr?.includes('/') ? eval(cr) : parseFloat(cr);
                    return crNum >= 6 && crNum <= 10;
                  } else if (monsterCRFilter === '11-15') {
                    const crNum = cr === '0' ? 0 : cr?.includes('/') ? eval(cr) : parseFloat(cr);
                    return crNum >= 11 && crNum <= 15;
                  } else if (monsterCRFilter === '16-20') {
                    const crNum = cr === '0' ? 0 : cr?.includes('/') ? eval(cr) : parseFloat(cr);
                    return crNum >= 16 && crNum <= 20;
                  } else if (monsterCRFilter === '21+') {
                    const crNum = cr === '0' ? 0 : cr?.includes('/') ? eval(cr) : parseFloat(cr);
                    return crNum >= 21;
                  }
                  return cr === monsterCRFilter;
                });
              }

              // Apply magic item rarity filter
              if (selectedType === "魔法物品" && magicItemRarityFilter) {
                filteredItems = filteredItems.filter((item: any) =>
                  item.rarityCn === magicItemRarityFilter
                );
              }

              // Apply magic item category filter
              if (selectedType === "魔法物品" && magicItemCategoryFilter) {
                filteredItems = filteredItems.filter((item: any) =>
                  item.categoryCn === magicItemCategoryFilter
                );
              }

              if (filteredItems.length === 0) {
                return (
                  <div className="fantasy-card text-center py-8">
                    <div className="text-3xl mb-3 opacity-50">🔮</div>
                    <div className="text-gray-400">
                      {searchTerm.trim() || spellLevelFilter !== null || spellSchoolFilter || equipmentCategoryFilter || monsterTypeFilter || monsterCRFilter || magicItemRarityFilter || magicItemCategoryFilter
                        ? '未找到匹配的结果，请尝试调整筛选条件'
                        : '暂无数据'}
                    </div>
                  </div>
                );
              }

              // Show count when filters are active
              const hasActiveFilters = searchTerm.trim() || spellLevelFilter !== null || spellSchoolFilter || equipmentCategoryFilter || monsterTypeFilter || monsterCRFilter || magicItemRarityFilter || magicItemCategoryFilter;

              // For equipment, group by category
              if (selectedType === "装备") {
                // Group items by category
                const groupedItems: Record<string, any[]> = {};
                filteredItems.forEach((item: any) => {
                  const cat = item.equipmentCategory || 'other';
                  if (!groupedItems[cat]) groupedItems[cat] = [];
                  groupedItems[cat].push(item);
                });

                // Define category order
                const categoryOrder = ['armor', 'weapon', 'gear', 'tool', 'pack'];
                const sortedCategories = categoryOrder.filter(c => groupedItems[c]);

                // Helper to format cost
                const formatCost = (item: any) => {
                  if (item.cost) {
                    if (item.cost.gp) return `${item.cost.gp} gp`;
                    if (item.cost.sp) return `${item.cost.sp} sp`;
                    if (item.cost.cp) return `${item.cost.cp} cp`;
                  }
                  return null;
                };

                return (
                  <>
                    {hasActiveFilters && (
                      <div className="text-sm text-gray-400 mb-3">
                        找到 {filteredItems.length} 件装备
                      </div>
                    )}
                    <div className="space-y-6">
                      {sortedCategories.map((category) => {
                        const items = groupedItems[category];
                        const catConfig = getEquipmentCategoryConfig(category);

                        // Group by subcategory
                        const subgrouped: Record<string, any[]> = {};
                        items.forEach((item: any) => {
                          const subcat = item.equipmentSubcategory || 'other';
                          if (!subgrouped[subcat]) subgrouped[subcat] = [];
                          subgrouped[subcat].push(item);
                        });

                        return (
                          <div key={category}>
                            <h3 className={`text-lg font-semibold ${catConfig.color} mb-3 border-b border-gray-700 pb-2`}>
                              {catConfig.name}
                            </h3>
                            {Object.entries(subgrouped).map(([subcat, subItems]) => (
                              <div key={subcat} className="mb-4">
                                <h4 className="text-sm text-gray-400 mb-2">
                                  {EQUIPMENT_SUBCATEGORY_NAMES[subcat] || subcat}
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                  {subItems.map((item: any, idx: number) => (
                                    <div
                                      key={idx}
                                      onClick={() => {
                                        setSelectedDetail({
                                          fileName: selectedType,
                                          path: item.id || item.name || `item-${idx}`,
                                          content: item,
                                          matchText: item.name || item.nameEn || `Item ${idx + 1}`,
                                        });
                                      }}
                                      className={`rounded-lg p-3 cursor-pointer transition-colors border ${catConfig.bgColor} ${catConfig.borderColor} hover:brightness-110`}
                                    >
                                      <div className={`font-medium ${catConfig.color}`}>
                                        {item.name}
                                      </div>
                                      {item.nameEn && (
                                        <div className="text-xs text-gray-500 mt-0.5">{item.nameEn}</div>
                                      )}
                                      {/* Parameters display */}
                                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs">
                                        {item.ac && (
                                          <span className="text-cyan-400">AC {item.ac}</span>
                                        )}
                                        {item.damage && (
                                          <span className="text-orange-400">{item.damage} {item.damageType?.slice(0, 1)?.toUpperCase()}</span>
                                        )}
                                        {formatCost(item) && (
                                          <span className="text-yellow-400">{formatCost(item)}</span>
                                        )}
                                        {item.weight !== undefined && (
                                          <span className="text-gray-500">{item.weight} lb</span>
                                        )}
                                      </div>
                                      {item.properties && item.properties.length > 0 && (
                                        <div className="text-xs text-gray-500 mt-1 truncate">
                                          {item.properties.slice(0, 3).join(', ')}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              }

              // For skills, group by ability
              if (selectedType === "技能") {
                // Group skills by ability
                const skillsByAbility: Record<string, any[]> = {};
                filteredItems.forEach((skill: any) => {
                  const ability = skill.ability || 'other';
                  if (!skillsByAbility[ability]) skillsByAbility[ability] = [];
                  skillsByAbility[ability].push(skill);
                });

                // Ability order
                const abilityOrder = ['strength', 'dexterity', 'intelligence', 'wisdom', 'charisma'];
                const sortedAbilities = abilityOrder.filter(a => skillsByAbility[a]);

                return (
                  <>
                    {hasActiveFilters && (
                      <div className="text-sm text-gray-400 mb-3">
                        找到 {filteredItems.length} 个技能
                      </div>
                    )}
                    <div className="space-y-6">
                      {sortedAbilities.map((ability) => {
                        const skills = skillsByAbility[ability];
                        const abilityConfig = getAbilityConfig(ability);

                        return (
                          <div key={ability}>
                            <h3 className={`text-lg font-semibold ${abilityConfig.color} mb-3 border-b border-gray-700 pb-2`}>
                              {abilityConfig.name} ({abilityConfig.nameEn})
                              <span className="text-sm text-gray-500 ml-2">({skills.length})</span>
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              {skills.map((skill: any, idx: number) => (
                                <div
                                  key={idx}
                                  onClick={() => {
                                    setSelectedDetail({
                                      fileName: selectedType,
                                      path: skill.id || skill.name || `skill-${idx}`,
                                      content: skill,
                                      matchText: skill.name || skill.nameEn || `Skill ${idx + 1}`,
                                    });
                                  }}
                                  className={`rounded-lg p-3 cursor-pointer transition-colors border ${abilityConfig.bgColor} ${abilityConfig.borderColor} hover:brightness-110`}
                                >
                                  <div className={`font-medium ${abilityConfig.color}`}>
                                    {skill.name}
                                  </div>
                                  {skill.nameEn && (
                                    <div className="text-xs text-gray-500 mt-0.5">{skill.nameEn}</div>
                                  )}
                                  {skill.description && (
                                    <div className="text-xs text-gray-400 mt-2 line-clamp-2">
                                      {skill.description}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              }

              // For spells, group by level and sort by school within each level
              if (selectedType === "法术") {
                // Group spells by level
                const spellsByLevel: Record<number, any[]> = {};
                filteredItems.forEach((spell: any) => {
                  const level = spell.level ?? 0;
                  if (!spellsByLevel[level]) spellsByLevel[level] = [];
                  spellsByLevel[level].push(spell);
                });

                // School order for sorting
                const schoolOrder = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'];

                // Sort spells within each level by school
                Object.keys(spellsByLevel).forEach(level => {
                  spellsByLevel[Number(level)].sort((a, b) => {
                    const aSchoolIdx = schoolOrder.indexOf(a.school?.toLowerCase() || '');
                    const bSchoolIdx = schoolOrder.indexOf(b.school?.toLowerCase() || '');
                    if (aSchoolIdx !== bSchoolIdx) return aSchoolIdx - bSchoolIdx;
                    // If same school, sort by name
                    return (a.name || '').localeCompare(b.name || '');
                  });
                });

                // Level order (0-9)
                const levelOrder = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
                const sortedLevels = levelOrder.filter(l => spellsByLevel[l]);

                // Level names
                const getLevelName = (level: number) => level === 0 ? '戏法' : `${level}环法术`;

                return (
                  <>
                    {hasActiveFilters && (
                      <div className="text-sm text-gray-400 mb-3">
                        找到 {filteredItems.length} 个法术
                      </div>
                    )}
                    <div className="space-y-6">
                      {sortedLevels.map((level) => {
                        const spells = spellsByLevel[level];

                        return (
                          <div key={level}>
                            <h3 className="text-lg font-semibold text-amber-400 mb-3 border-b border-gray-700 pb-2">
                              {getLevelName(level)}
                              <span className="text-sm text-gray-500 ml-2">({spells.length})</span>
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              {spells.map((spell: any, idx: number) => {
                                const schoolConfig = getSpellSchoolConfig(spell.school);
                                return (
                                  <div
                                    key={idx}
                                    onClick={() => {
                                      setSelectedDetail({
                                        fileName: selectedType,
                                        path: spell.id || spell.name || `spell-${idx}`,
                                        content: spell,
                                        matchText: spell.name || spell.nameEn || `Spell ${idx + 1}`,
                                      });
                                    }}
                                    className={`rounded-lg p-3 cursor-pointer transition-colors border ${schoolConfig.bgColor} ${schoolConfig.borderColor} hover:brightness-110`}
                                  >
                                    <div className={`font-medium ${schoolConfig.color}`}>
                                      {spell.name}
                                    </div>
                                    {spell.nameEn && (
                                      <div className="text-xs text-gray-500 mt-0.5">{spell.nameEn}</div>
                                    )}
                                    <div className="flex items-center gap-2 mt-2 text-xs">
                                      <span className={schoolConfig.color}>{schoolConfig.name}</span>
                                      {spell.concentration && (
                                        <span className="text-yellow-500">专注</span>
                                      )}
                                      {spell.ritual && (
                                        <span className="text-purple-400">仪式</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              }

              // For monsters, group by type
              if (selectedType === "怪物") {
                // Group monsters by type
                const monstersByType: Record<string, any[]> = {};
                filteredItems.forEach((monster: any) => {
                  const baseType = monster.type?.split(/[（(]/)[0]?.trim() || '其他';
                  if (!monstersByType[baseType]) monstersByType[baseType] = [];
                  monstersByType[baseType].push(monster);
                });

                // Type order (common types first)
                const typeOrder = ['人形生物', '野兽', '怪兽', '龙类', '不死生物', '邪魔', '天界生物', '元素生物', '精类', '异怪', '构装生物', '泥怪', '植物', '巨人'];
                const sortedTypes = [
                  ...typeOrder.filter(t => monstersByType[t]),
                  ...Object.keys(monstersByType).filter(t => !typeOrder.includes(t))
                ];

                // Sort monsters within each type by CR (ascending) then name
                sortedTypes.forEach(type => {
                  monstersByType[type].sort((a, b) => {
                    const crA = typeof a.cr === 'number' ? a.cr : (a.cr === '0' ? 0 : a.cr?.includes('/') ? parseFloat(a.cr.split('/')[0]) / parseFloat(a.cr.split('/')[1]) : parseFloat(a.cr) || 0);
                    const crB = typeof b.cr === 'number' ? b.cr : (b.cr === '0' ? 0 : b.cr?.includes('/') ? parseFloat(b.cr.split('/')[0]) / parseFloat(b.cr.split('/')[1]) : parseFloat(b.cr) || 0);
                    if (crA !== crB) return crA - crB;
                    return (a.name || '').localeCompare(b.name || '');
                  });
                });

                return (
                  <>
                    {hasActiveFilters && (
                      <div className="text-sm text-gray-400 mb-3">
                        找到 {filteredItems.length} 个怪物
                      </div>
                    )}
                    <div className="space-y-6">
                      {sortedTypes.map((type) => {
                        const monsters = monstersByType[type];
                        const typeConfig = getMonsterTypeConfig(type);

                        return (
                          <div key={type}>
                            <h3 className={`text-lg font-semibold ${typeConfig.color} mb-3 border-b border-gray-700 pb-2`}>
                              {type}
                              <span className="text-sm text-gray-500 ml-2">({monsters.length})</span>
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              {monsters.map((monster: any, idx: number) => (
                                <div
                                  key={idx}
                                  onClick={() => {
                                    setSelectedDetail({
                                      fileName: selectedType,
                                      path: monster.id || monster.name || `monster-${idx}`,
                                      content: monster,
                                      matchText: monster.name || monster.nameEn || `Monster ${idx + 1}`,
                                    });
                                  }}
                                  className={`rounded-lg p-3 cursor-pointer transition-colors border ${typeConfig.bgColor} ${typeConfig.borderColor} hover:brightness-110`}
                                >
                                  <div className="flex items-start justify-between">
                                    <div className={`font-medium ${typeConfig.color}`}>
                                      {monster.name}
                                    </div>
                                    <div className={`text-sm font-bold ${getCRColor(monster.cr)}`}>
                                      CR {monster.cr}
                                    </div>
                                  </div>
                                  {monster.nameEn && (
                                    <div className="text-xs text-gray-500 mt-0.5">{monster.nameEn}</div>
                                  )}
                                  <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                                    <span>{monster.size}</span>
                                    <span>AC {typeof monster.ac === 'object' ? (monster.ac?.value || monster.ac?.base || '') : monster.ac}</span>
                                    <span>HP {typeof monster.hp === 'object' ? (monster.hp?.average || monster.hp?.dice || '') : monster.hp}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              }

              // For magic items, group by category
              if (selectedType === "魔法物品") {
                // Group items by category
                const itemsByCategory: Record<string, any[]> = {};
                filteredItems.forEach((item: any) => {
                  const cat = item.categoryCn || '其他';
                  if (!itemsByCategory[cat]) itemsByCategory[cat] = [];
                  itemsByCategory[cat].push(item);
                });

                // Category order
                const categoryOrder = ['奇物', '药水', '戒指', '武器', '护甲', '魔杖', '法杖', '卷轴', '权杖', '弹药'];
                const sortedCategories = [
                  ...categoryOrder.filter(c => itemsByCategory[c]),
                  ...Object.keys(itemsByCategory).filter(c => !categoryOrder.includes(c))
                ];

                // Rarity order for sorting within categories
                const rarityOrder = ['普通', '罕见', '稀有', '非常稀有', '传说', '神器', '不定'];

                // Sort items within each category by rarity then name
                sortedCategories.forEach(category => {
                  itemsByCategory[category].sort((a, b) => {
                    const rarityA = rarityOrder.indexOf(a.rarityCn || '');
                    const rarityB = rarityOrder.indexOf(b.rarityCn || '');
                    if (rarityA !== rarityB) return rarityA - rarityB;
                    return (a.name || '').localeCompare(b.name || '');
                  });
                });

                return (
                  <>
                    {hasActiveFilters && (
                      <div className="text-sm text-gray-400 mb-3">
                        找到 {filteredItems.length} 件魔法物品
                      </div>
                    )}
                    <div className="space-y-6">
                      {sortedCategories.map((category) => {
                        const items = itemsByCategory[category];
                        const catConfig = getMagicItemCategoryConfig(category);

                        return (
                          <div key={category}>
                            <h3 className={`text-lg font-semibold ${catConfig.color} mb-3 border-b border-gray-700 pb-2`}>
                              {category}
                              <span className="text-sm text-gray-500 ml-2">({items.length})</span>
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              {items.map((item: any, idx: number) => {
                                const rarityConfig = getMagicItemRarityConfig(item.rarityCn);
                                return (
                                  <div
                                    key={idx}
                                    onClick={() => {
                                      setSelectedDetail({
                                        fileName: selectedType,
                                        path: item.id || item.name || `magic-item-${idx}`,
                                        content: item,
                                        matchText: item.name || item.nameEn || `Magic Item ${idx + 1}`,
                                      });
                                    }}
                                    className={`rounded-lg p-3 cursor-pointer transition-colors border ${rarityConfig.bgColor} ${rarityConfig.borderColor} hover:brightness-110`}
                                  >
                                    <div className={`font-medium ${rarityConfig.color}`}>
                                      {item.name}
                                    </div>
                                    {item.nameEn && (
                                      <div className="text-xs text-gray-500 mt-0.5">{item.nameEn}</div>
                                    )}
                                    <div className="flex items-center gap-2 mt-2 text-xs">
                                      <span className={rarityConfig.color}>{item.rarityCn}</span>
                                      {item.requiresAttunement && (
                                        <span className="text-yellow-500">需调谐</span>
                                      )}
                                    </div>
                                    {item.description && (
                                      <div className="text-xs text-gray-400 mt-2 line-clamp-2">
                                        {item.description}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              }

              // Default rendering for other types
              return (
                <>
                  {hasActiveFilters && selectedType === "法术" && (
                    <div className="text-sm text-gray-400 mb-3">
                      找到 {filteredItems.length} 个法术
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredItems.map((item: any, idx: number) => {
                    // Get spell school config if it's a spell
                    const schoolConfig = item.school ? getSpellSchoolConfig(item.school) : null;

                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          setSelectedDetail({
                            fileName: selectedType,
                            path: item.id || item.name || `item-${idx}`,
                            content: item,
                            matchText: item.name || item.nameEn || `Item ${idx + 1}`,
                          });
                        }}
                        className={`rounded-lg p-4 cursor-pointer transition-colors border ${
                          schoolConfig
                            ? `${schoolConfig.bgColor} ${schoolConfig.borderColor} hover:brightness-110`
                            : 'bg-gray-800 hover:bg-gray-750 border-gray-700'
                        }`}
                      >
                        <div className={`font-medium ${schoolConfig ? schoolConfig.color : 'text-gray-200'}`}>
                          {item.name || item.category}
                        </div>
                        {item.nameEn && (
                          <div className="text-xs text-gray-500 mt-1">{item.nameEn}</div>
                        )}
                        {item.level !== undefined && (
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-xs text-amber-400">
                              {item.level === 0 ? "戏法" : `${item.level}环`}
                            </span>
                            {schoolConfig && (
                              <span className={`text-xs ${schoolConfig.color}`}>
                                {schoolConfig.name}
                              </span>
                            )}
                          </div>
                        )}
                        {item.cr !== undefined && (
                          <div className="text-xs text-green-400 mt-2">CR {item.cr}</div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </>
              );
            })()}
          </div>
          )
        ) : debouncedSearchTerm.trim() ? (
          // Global Search Results View (when no type is selected but search term exists)
          <div className="space-y-3">
            <div className="text-sm text-amber-400/70 mb-4 flex items-center gap-1">
              <span>✨</span> 找到 {searchResults.length} 个结果
              {rulesDataCache.size < RULE_FILES.length && (
                <span className="text-gray-500 ml-1">(已加载 {rulesDataCache.size}/{RULE_FILES.length} 类)</span>
              )}
            </div>
            {searchResults.length === 0 ? (
              <div className="fantasy-card text-center py-8">
                <div className="text-3xl mb-3 opacity-50">🔮</div>
                <div className="text-gray-400">未找到匹配结果</div>
              </div>
            ) : (
              searchResults.map((result, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedDetail(result)}
                  className="fantasy-card cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">{result.fileName}</span>
                    <span className="text-xs text-gray-500">{result.path}</span>
                  </div>
                  <div className="text-sm text-gray-300">{result.matchText}</div>
                </div>
              ))
            )}
          </div>
        ) : (
          // Type Grid View (default)
          <div>
            <div className="fantasy-section-header !mb-4">
              <h3>规则类型</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {RULE_FILES.map((file) => (
                <div
                  key={file.name}
                  onClick={() => setSelectedType(file.displayName)}
                  className="group fantasy-card cursor-pointer text-center hover:border-amber-500/40 hover:shadow-[0_0_20px_rgba(251,191,36,0.1)]"
                >
                  <div className="text-3xl mb-2 transition-transform group-hover:scale-110 group-hover:drop-shadow-[0_0_8px_rgba(251,191,36,0.3)]">
                    {file.displayName === "种族" && "👥"}
                    {file.displayName === "职业" && "⚔️"}
                    {file.displayName === "法术" && "✨"}
                    {file.displayName === "装备" && "🛡️"}
                    {file.displayName === "魔法物品" && "💎"}
                    {file.displayName === "背景" && "📜"}
                    {file.displayName === "技能" && "🎯"}
                    {file.displayName === "属性" && "💪"}
                    {file.displayName === "状态" && "🔴"}
                    {file.displayName === "生物" && "🐉"}
                    {file.displayName === "怪物" && "👹"}
                    {file.displayName === "神祇" && "⚡"}
                    {file.displayName === "位面" && "🌌"}
                    {file.displayName === "核心规则" && "📖"}
                    {file.displayName === "战斗规则" && "⚔️"}
                    {file.displayName === "疾病" && "🦠"}
                    {file.displayName === "遭遇表" && "🎲"}
                    {file.displayName === "NPC模板" && "🧙"}
                    {file.displayName === "毒素" && "☠️"}
                  </div>
                  <div className="font-medium text-gray-200 group-hover:text-amber-400 transition-colors">{file.displayName}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </Tabs.Content>

      {/* AI Query Tab Content */}
      {campaignId && userId && (
        <Tabs.Content value="ai-query" className="flex-1 overflow-hidden data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
          <Rules_AIQueryTab
            campaignId={parseInt(campaignId, 10)}
            userId={userId}
          />
        </Tabs.Content>
      )}

      {/* Detail Modal */}
      <Dialog.Root open={!!selectedDetail} onOpenChange={(open) => !open && setSelectedDetail(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gradient-to-b from-gray-800 to-gray-900 border border-amber-500/20 rounded-xl shadow-2xl shadow-amber-500/5 z-50 w-[90vw] max-w-4xl max-h-[85dvh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-amber-500/10 bg-gradient-to-r from-gray-800/50 to-gray-900/50">
              <Dialog.Title className="text-lg font-semibold text-amber-400 font-fantasy tracking-wide flex items-center gap-2">
                <span className="text-base">📜</span>
                {selectedDetail?.matchText || "详细信息"}
              </Dialog.Title>
              <Dialog.Close className="text-gray-400 hover:text-amber-400 transition-colors p-2 hover:bg-gray-800/50 rounded-lg">
                <svg width="20" height="20" viewBox="0 0 15 15" fill="none">
                  <path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"/>
                </svg>
              </Dialog.Close>
            </div>

            {aiDescription && (
              <div className="border-b border-amber-500/10 bg-gradient-to-r from-amber-500/5 to-transparent">
                <div className="p-4">
                  <div className="text-sm text-gray-300 leading-relaxed">
                    {aiDescription}
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-auto p-6">
              {selectedDetail && renderDetailContent(selectedDetail)}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Tabs.Root>
  );
}
