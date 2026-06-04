/**
 * 规则数据 JSON 路径常量
 *
 * 所有数据统一存放在 ~/data/ 下，前后端共用。
 * 前端通过 Vite 动态 import() 加载，后端通过 rules_cache.py 读取同一目录。
 *
 * 注意：Vite 的 import() 需要字符串字面量，此文件仅作为路径的文档和查找中心。
 */

/** 核心规则数据 (~/data/rules/) */
export const RULES_PATHS = {
  spells: '~/data/rules/spells.json',
  equipment: '~/data/rules/equipment.json',
  classes: '~/data/rules/classes.json',
  classesStructured: '~/data/rules/classes_with_structured_subclass_features.json',
  races: '~/data/rules/races.json',
  abilities: '~/data/rules/abilities.json',
  skills: '~/data/rules/skills.json',
  feats: '~/data/rules/feats.json',
  backgrounds: '~/data/rules/backgrounds.json',
  classResources: '~/data/rules/class_resources.json',
  eldritchInvocations: '~/data/rules/eldritch_invocations.json',
  companions: '~/data/rules/companions.json',
  spellcasting: '~/data/rules/spellcasting.json',
  subclassSpells: '~/data/rules/subclass-spells.json',
  gods: '~/data/rules/gods.json',
  multiclassRequirements: '~/data/rules/multiclass-requirements.json',
  xpThresholds: '~/data/rules/xp-thresholds.json',
  // 从 public/rules/ 迁入
  conditions: '~/data/rules/conditions.json',
  diseases: '~/data/rules/diseases.json',
  combatRules: '~/data/rules/combat-rules.json',
  coreRules: '~/data/rules/core-rules.json',
  magicItems: '~/data/rules/magic-items.json',
  shopTemplates: '~/data/rules/shop-templates.json',
  npcTemplates: '~/data/rules/npc-templates.json',
  encounterTables: '~/data/rules/encounter-tables.json',
  creatures: '~/data/rules/creatures.json',
  languages: '~/data/rules/languages.json',
  planes: '~/data/rules/planes.json',
  poisons: '~/data/rules/poisons.json',
  worldLore: '~/data/rules/world-lore.json',
  // 从 dnd-platform/configs/rules/ 迁入
  classesProgression: '~/data/rules/classes-progression.json',
  avatarDescriptions: '~/data/rules/avatar-descriptions.json',
} as const

/** NPC 数据 (~/data/npc/) */
export const NPC_PATHS = {
  monsters: '~/data/npc/monsters.json',
} as const

/** 模组数据 (~/data/modules/) */
export const MODULES_PATHS = {
  lostMineOfPhandelver: '~/data/modules/lost_mine_of_phandelver/',
} as const

/** 后端专有数据 (~/data/backend/) */
export const BACKEND_PATHS = {
  effects: '~/data/backend/effects.json',
  companions: '~/data/backend/companions.json',
  passiveFeatures: '~/data/backend/passive_features.json',
  classResources: '~/data/backend/class_resources.json',
  moduleTemplates: '~/data/backend/templates/module_templates.json',
} as const

/** 创作者知识库 (~/data/creator/) */
export const CREATOR_PATHS = {
  index: '~/data/creator/index.json',
} as const

// 向后兼容
export const DATA_PATHS = RULES_PATHS
