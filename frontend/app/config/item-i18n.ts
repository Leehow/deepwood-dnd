/**
 * 统一的物品/装备/熟练度 英文ID → 中文 翻译映射
 * 所有组件应从此文件导入，避免重复定义和不一致
 */

// ── 物品大类 ──
export const CATEGORY_CN: Record<string, string> = {
  weapon: '武器',
  armor: '护甲',
  adventuring_gear: '冒险装备',
  tool: '工具',
  wondrous_item: '奇物',
  potion: '药水',
  scroll: '卷轴',
  ring: '戒指',
  rod: '权杖',
  staff: '法杖',
  wand: '魔杖',
  mount: '坐骑',
  vehicle: '载具',
  trade_good: '贸易品',
  treasure: '宝藏',
  ammo: '弹药',
  misc: '杂项',
  document: '文件',
  other: '其他',
  // 兼容复数形式
  weapons: '武器',
}

// ── 物品子类 ──
export const SUBCATEGORY_CN: Record<string, string> = {
  simple_melee: '简单近战',
  simple_ranged: '简单远程',
  martial_melee: '军用近战',
  martial_ranged: '军用远程',
  light: '轻甲',
  medium: '中甲',
  heavy: '重甲',
  shield: '盾牌',
  standard: '标准',
  containers: '容器',
  tools: '工具',
  kits: '工具包',
  instruments: '乐器',
  ammunition: '弹药',
  foodAndDrink: '食物饮品',
  lodging: '住宿',
  potionsAndPoisons: '药水与毒药',
  survival: '生存用品',
  lightSources: '光源',
  arcaneFocus: '奥术法器',
  druidicFocus: '德鲁伊法器',
  holySymbol: '圣徽',
}

// ── 稀有度 ──
export const RARITY_CN: Record<string, string> = {
  common: '普通',
  uncommon: '精良',
  rare: '稀有',
  very_rare: '极稀有',
  'very rare': '极稀有',
  legendary: '传说',
  artifact: '神器',
}

// ── 伤害类型 ──
export const DAMAGE_TYPE_CN: Record<string, string> = {
  slashing: '挥砍',
  piercing: '穿刺',
  bludgeoning: '钝击',
  fire: '火焰',
  cold: '冰冷',
  lightning: '闪电',
  thunder: '雷鸣',
  acid: '强酸',
  poison: '毒素',
  necrotic: '黯蚀',
  radiant: '光耀',
  force: '力场',
  psychic: '心灵',
  healing: '治疗',
}

// ── 武器属性 ──
export const PROPERTY_CN: Record<string, string> = {
  finesse: '灵巧',
  versatile: '多用',
  heavy: '沉重',
  light: '轻型',
  reach: '长柄',
  thrown: '投掷',
  'two-handed': '双手',
  loading: '装填',
  ammunition: '弹药',
  special: '特殊',
}

// ── 便捷翻译函数 ──
export function tCategory(id: string): string { return CATEGORY_CN[id] || id }
export function tSubcategory(id: string): string { return SUBCATEGORY_CN[id] || id }
export function tRarity(id: string): string { return RARITY_CN[id] || id }
export function tDamageType(id: string): string { return DAMAGE_TYPE_CN[id] || id }
export function tProperty(id: string): string { return PROPERTY_CN[id] || id }
