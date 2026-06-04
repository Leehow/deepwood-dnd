/**
 * Spell Constants - 法术系统共享常量
 * 学派颜色/名称/图标、伤害类型、豁免类型、区域类型、职业名称等
 */
import type { SupportedLocale } from '~/i18n/config'

// Locale-aware term accessors default to 'zh-CN' so any caller that has not
// been migrated keeps its prior visible Chinese output. Only callers that
// explicitly pass 'en-US' opt in to English chrome.
type TermLocale = SupportedLocale | undefined

// ── 法术学派 ──────────────────────────

/** 默认主题 - 学派颜色 */
export const schoolColors: Record<string, string> = {
  abjuration: 'bg-blue-900/40 text-blue-200 border-blue-700/50',
  conjuration: 'bg-purple-900/40 text-purple-200 border-purple-700/50',
  divination: 'bg-gray-800/40 text-gray-200 border-gray-600/50',
  enchantment: 'bg-pink-900/40 text-pink-200 border-pink-700/50',
  evocation: 'bg-red-900/40 text-red-200 border-red-700/50',
  illusion: 'bg-indigo-900/40 text-indigo-200 border-indigo-700/50',
  necromancy: 'bg-green-900/40 text-green-200 border-green-700/50',
  transmutation: 'bg-yellow-900/40 text-yellow-200 border-yellow-700/50',
}

/** 卷轴/法术书主题 - 学派颜色（低饱和风格） */
export const scrollSchoolColors: Record<string, string> = {
  abjuration: 'bg-blue-900/15 text-blue-300/60 border-blue-700/15',
  conjuration: 'bg-purple-900/15 text-purple-300/60 border-purple-700/15',
  divination: 'bg-amber-900/15 text-amber-300/60 border-amber-700/15',
  enchantment: 'bg-pink-900/15 text-pink-300/60 border-pink-700/15',
  evocation: 'bg-red-900/15 text-red-300/60 border-red-700/15',
  illusion: 'bg-indigo-900/15 text-indigo-300/60 border-indigo-700/15',
  necromancy: 'bg-emerald-900/15 text-emerald-300/60 border-emerald-700/15',
  transmutation: 'bg-yellow-900/15 text-yellow-300/60 border-yellow-700/15',
}

/** 学派中文名称 */
export const schoolNames: Record<string, string> = {
  abjuration: '防护',
  conjuration: '咒法',
  divination: '预言',
  enchantment: '惑控',
  evocation: '塑能',
  illusion: '幻术',
  necromancy: '死灵',
  transmutation: '变化',
}

/** School names in English (canonical D&D 5E school names) */
const schoolNamesEn: Record<string, string> = {
  abjuration: 'Abjuration',
  conjuration: 'Conjuration',
  divination: 'Divination',
  enchantment: 'Enchantment',
  evocation: 'Evocation',
  illusion: 'Illusion',
  necromancy: 'Necromancy',
  transmutation: 'Transmutation',
}

/** Resolve a localized school name. Defaults to zh-CN for backward compat. */
export function getSchoolName(school: string, locale?: TermLocale): string {
  if (locale === 'en-US') return schoolNamesEn[school] || school
  return schoolNames[school] || school
}

/** 学派图标 emoji */
export const schoolIcons: Record<string, string> = {
  abjuration: '🛡️',
  conjuration: '🌀',
  divination: '👁️',
  enchantment: '💫',
  evocation: '🔥',
  illusion: '🌫️',
  necromancy: '💀',
  transmutation: '⚗️',
}

// ── 伤害类型 ──────────────────────────

/** 伤害类型颜色和图标 */
export const damageTypeStyles: Record<string, { color: string; icon: string; name: string }> = {
  fire: { color: 'text-orange-400', icon: '🔥', name: '火焰' },
  cold: { color: 'text-cyan-400', icon: '❄️', name: '冰霜' },
  lightning: { color: 'text-yellow-400', icon: '⚡', name: '闪电' },
  thunder: { color: 'text-purple-400', icon: '💥', name: '雷鸣' },
  acid: { color: 'text-lime-400', icon: '🧪', name: '强酸' },
  poison: { color: 'text-green-400', icon: '☠️', name: '毒素' },
  necrotic: { color: 'text-gray-400', icon: '💀', name: '黯蚀' },
  radiant: { color: 'text-amber-300', icon: '✨', name: '光耀' },
  force: { color: 'text-indigo-400', icon: '💫', name: '力场' },
  psychic: { color: 'text-pink-400', icon: '🧠', name: '精神' },
  piercing: { color: 'text-gray-300', icon: '🗡️', name: '穿刺' },
  slashing: { color: 'text-gray-300', icon: '⚔️', name: '挥砍' },
  bludgeoning: { color: 'text-gray-300', icon: '🔨', name: '钝击' },
}

/** Damage type names in English (kept separate from styles to preserve color/icon). */
const damageTypeNamesEn: Record<string, string> = {
  fire: 'Fire', cold: 'Cold', lightning: 'Lightning', thunder: 'Thunder',
  acid: 'Acid', poison: 'Poison', necrotic: 'Necrotic', radiant: 'Radiant',
  force: 'Force', psychic: 'Psychic',
  piercing: 'Piercing', slashing: 'Slashing', bludgeoning: 'Bludgeoning',
}

/** Resolve a localized damage type name. Style (color/icon) is read separately. */
export function getDamageTypeName(type: string | undefined | null, locale?: TermLocale): string {
  if (!type) return ''
  if (locale === 'en-US') return damageTypeNamesEn[type] || type
  return damageTypeStyles[type]?.name || type
}

// ── 豁免 / 区域 ──────────────────────────

/** 豁免类型中文 */
export const saveTypeNames: Record<string, string> = {
  strength: '力量',
  dexterity: '敏捷',
  constitution: '体质',
  intelligence: '智力',
  wisdom: '感知',
  charisma: '魅力',
  str: '力量',
  dex: '敏捷',
  con: '体质',
  int: '智力',
  wis: '感知',
  cha: '魅力',
}

/** 区域类型中文 */
export const areaTypeNames: Record<string, string> = {
  sphere: '球形',
  cone: '锥形',
  cube: '立方',
  line: '直线',
  cylinder: '圆柱',
}

const saveTypeNamesEn: Record<string, string> = {
  strength: 'Strength', dexterity: 'Dexterity', constitution: 'Constitution',
  intelligence: 'Intelligence', wisdom: 'Wisdom', charisma: 'Charisma',
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
}

const areaTypeNamesEn: Record<string, string> = {
  sphere: 'Sphere', cone: 'Cone', cube: 'Cube', line: 'Line', cylinder: 'Cylinder',
}

export function getSaveTypeName(ability: string, locale?: TermLocale): string {
  if (locale === 'en-US') return saveTypeNamesEn[ability] || ability.toUpperCase()
  return saveTypeNames[ability] || ability
}

export function getAreaTypeName(type: string, locale?: TermLocale): string {
  if (locale === 'en-US') return areaTypeNamesEn[type] || type
  return areaTypeNames[type] || type
}

// ── 职业 ──────────────────────────

/** 职业名称中文映射 */
export const classNames: Record<string, string> = {
  barbarian: '野蛮人',
  bard: '吟游诗人',
  cleric: '牧师',
  druid: '德鲁伊',
  fighter: '战士',
  monk: '武僧',
  paladin: '圣骑士',
  ranger: '游侠',
  rogue: '游荡者',
  sorcerer: '术士',
  warlock: '邪术师',
  wizard: '法师',
}

const classNamesEn: Record<string, string> = {
  barbarian: 'Barbarian', bard: 'Bard', cleric: 'Cleric', druid: 'Druid',
  fighter: 'Fighter', monk: 'Monk', paladin: 'Paladin', ranger: 'Ranger',
  rogue: 'Rogue', sorcerer: 'Sorcerer', warlock: 'Warlock', wizard: 'Wizard',
}

export function getClassName(cls: string, locale?: TermLocale): string {
  if (locale === 'en-US') return classNamesEn[cls] || cls
  return classNames[cls] || cls
}

// ── 生物类型 ──────────────────────────

/** 生物类型中文映射（与怪物系统 MONSTER_TYPE_CONFIG 保持一致） */
export const creatureTypeNames: Record<string, string> = {
  aberration: '异怪',
  beast: '野兽',
  celestial: '天界生物',
  construct: '构装生物',
  dragon: '龙类',
  elemental: '元素生物',
  fey: '精类',
  fiend: '邪魔',
  giant: '巨人',
  humanoid: '人形生物',
  monstrosity: '怪兽',
  ooze: '泥怪',
  plant: '植物',
  undead: '不死生物',
}

const creatureTypeNamesEn: Record<string, string> = {
  aberration: 'Aberration', beast: 'Beast', celestial: 'Celestial',
  construct: 'Construct', dragon: 'Dragon', elemental: 'Elemental',
  fey: 'Fey', fiend: 'Fiend', giant: 'Giant', humanoid: 'Humanoid',
  monstrosity: 'Monstrosity', ooze: 'Ooze', plant: 'Plant', undead: 'Undead',
}

export function getCreatureTypeName(type: string, locale?: TermLocale): string {
  if (locale === 'en-US') return creatureTypeNamesEn[type] || type
  return creatureTypeNames[type] || type
}

// ── 工具函数 ──────────────────────────

/** 法术等级显示文本。locale 默认 zh-CN 以保持旧调用方行为。 */
export const getLevelDisplay = (level: number, locale?: TermLocale) => {
  if (locale === 'en-US') {
    if (level === 0) return 'Cantrip'
    return `Level ${level}`
  }
  if (level === 0) return '戏法'
  return `${level}环`
}

// ── Spell buffEffects 静态映射（从 spells.json 提取） ──
// 用于在 active_effects 没有存储 buff_effects 时同步查找
import spellsJson from '~/data/rules/spells.json'
const _buffMap: Record<string, Record<string, any>> = {}
const _spellMap: Record<string, any> = {}
for (const s of (spellsJson as any).spells) {
  _spellMap[s.id] = s
  if (s.buffEffects) _buffMap[s.id] = s.buffEffects
}
export const SPELL_BUFF_EFFECTS = _buffMap
export const SPELL_DATA_MAP = _spellMap

/** Look up buffEffects by spell_id (stored data or static fallback) */
export function getBuffEffects(spellId: string, stored?: Record<string, any>): Record<string, any> | undefined {
  return stored || SPELL_BUFF_EFFECTS[spellId]
}

export function getSpellDataById(spellId?: string | null): any | undefined {
  if (!spellId) return undefined
  return SPELL_DATA_MAP[spellId]
}

function resolveSpellData(spellOrId: any): any | undefined {
  if (!spellOrId) return undefined
  if (typeof spellOrId === 'string') return getSpellDataById(spellOrId)
  return spellOrId.id ? getSpellDataById(spellOrId.id) || spellOrId : spellOrId
}

export function spellHasIllusionSubtype(spellOrId: any, subtype: string): boolean {
  const spell = resolveSpellData(spellOrId)
  return spell?.illusion?.subtype === subtype
}

export function isAppearanceIllusionSpell(spellOrId: any): boolean {
  return spellHasIllusionSubtype(spellOrId, 'appearance')
}

export function isQuasiRealCreatureSpell(spellOrId: any): boolean {
  return spellHasIllusionSubtype(spellOrId, 'quasi_real_creature')
}

export function getSpellSummonTokenConfig(spellOrId: any): Record<string, any> | undefined {
  const spell = resolveSpellData(spellOrId)
  return spell?.summonToken
}

export function getSpellCastOptionByKey(spellOrId: any, optionKey?: string | null): any | undefined {
  if (!optionKey) return undefined
  const spell = resolveSpellData(spellOrId)
  return spell?.castOptions?.find((option: any) => option?.key === optionKey)
}

export function getSpellEffectPhases(spellOrId: any, optionKey?: string | null): any[] {
  const spell = resolveSpellData(spellOrId)
  if (!spell) return []
  const phases = Array.isArray(spell.effects) ? [...spell.effects] : []
  const option = getSpellCastOptionByKey(spell, optionKey)
  if (option?.effects && Array.isArray(option.effects)) phases.push(...option.effects)
  return phases
}

export function getSpellModifierEffects(spellOrId: any, optionKey?: string | null): any[] {
  const phases = getSpellEffectPhases(spellOrId, optionKey)
  const out: any[] = []
  for (const phase of phases) {
    const effects = Array.isArray(phase?.effects) ? phase.effects : []
    for (const eff of effects) {
      if (eff?.type === 'modify_stat') out.push(eff)
    }
  }
  return out
}

/** Translate a buff/condition English term to Chinese */
const buffTermCn: Record<string, string> = {
  // Conditions
  frightened: '恐惧', charmed: '魅惑', poisoned: '中毒', blinded: '目盲',
  deafened: '耳聋', paralyzed: '麻痹', petrified: '石化', stunned: '震慑',
  incapacitated: '失能', restrained: '束缚', grappled: '擒抱', prone: '倒地',
  invisible: '隐形', exhaustion: '力竭', possessed: '附身', possession: '附身',
  disease: '疾病', diseased: '疾病',
  unconscious: '昏迷', weakened: '虚弱', silenced: '沉默', slowed: '减速',
  cursed: '诅咒', confused: '困惑', feebleminded: '痴呆',
  // Damage types
  ...Object.fromEntries(Object.entries(damageTypeStyles).map(([k, v]) => [k, v.name])),
  nonmagical_physical: '非魔法物理', all_damage: '所有伤害',
  all: '全类型', bludgeoning_nonmagical: '非魔法钝击', piercing_nonmagical: '非魔法穿刺',
  slashing_nonmagical: '非魔法挥砍', nonmagical_weapon: '非魔法武器',
  // Checks/saves
  attack_rolls: '攻击检定', ability_checks: '属性检定',
  strength_checks: '力量检定', dexterity_checks: '敏捷检定', constitution_checks: '体质检定',
  intelligence_checks: '智力检定', wisdom_checks: '感知检定', charisma_checks: '魅力检定',
  strength_saves: '力量豁免', dexterity_saves: '敏捷豁免', constitution_saves: '体质豁免',
  intelligence_saves: '智力豁免', wisdom_saves: '感知豁免', charisma_saves: '魅力豁免',
  all_saves: '所有豁免', saving_throws: '豁免检定',
  perception_checks: '感知检定', survival_checks: '生存检定', healing_checks: '治疗检定',
  poison_saves: '毒素豁免', frightened_saves: '恐惧豁免', divination_saves: '预言豁免',
  attack_rolls_against: '对其攻击',
  next_attack_roll_against: '下次对其攻击',
  divination_spells: '预言法术', thought_reading: '读心', emotion_sensing: '情感感应',
}

/** Translate a parenthetical note */
const noteCn: Record<string, string> = {
  'weapon attacks': '武器攻击', 'by chosen types': '被选定类型', 'within area': '区域内',
  'chosen types': '选定类型', 'melee': '近战', Courage: '勇气',
  'Enlarge': '变大', 'Reduce': '缩小', Forceful: '强力之手', Grasping: '抓握之手',
  "Bear's Endurance": '熊之耐力', "Bull's Strength": '牛之力量',
  "Cat's Grace": '猫之优雅', "Eagle's Splendor": '鹰之威仪',
  "Fox's Cunning": '狐之狡黠', "Owl's Wisdom": '枭之睿智',
  'suppressed': '压制', 'undead target': '不死生物', 'chosen alignment': '选定阵营',
  'outlined creatures': '被勾勒生物', 'target wearing metal armor': '穿金属甲目标',
  'tracking target': '追踪目标', 'first attack against target': '首次攻击',
  'warm shield': '暖盾', 'chill shield': '冷盾', 'chosen': '选定',
  'shapechangers': '变形生物', 'plant creatures': '植物生物',
}

/** English buff/condition terms (canonical D&D 5E names). Falls back to raw key. */
const buffTermEn: Record<string, string> = {
  // Conditions
  frightened: 'Frightened', charmed: 'Charmed', poisoned: 'Poisoned', blinded: 'Blinded',
  deafened: 'Deafened', paralyzed: 'Paralyzed', petrified: 'Petrified', stunned: 'Stunned',
  incapacitated: 'Incapacitated', restrained: 'Restrained', grappled: 'Grappled', prone: 'Prone',
  invisible: 'Invisible', exhaustion: 'Exhaustion', possessed: 'Possessed', possession: 'Possessed',
  disease: 'Disease', diseased: 'Diseased',
  unconscious: 'Unconscious', weakened: 'Weakened', silenced: 'Silenced', slowed: 'Slowed',
  cursed: 'Cursed', confused: 'Confused', feebleminded: 'Feebleminded',
  // Damage types (use canonical English names)
  ...damageTypeNamesEn,
  nonmagical_physical: 'Nonmagical Physical', all_damage: 'All Damage',
  all: 'All Types', bludgeoning_nonmagical: 'Nonmagical Bludgeoning',
  piercing_nonmagical: 'Nonmagical Piercing', slashing_nonmagical: 'Nonmagical Slashing',
  nonmagical_weapon: 'Nonmagical Weapon',
  // Checks/saves
  attack_rolls: 'Attack Rolls', ability_checks: 'Ability Checks',
  strength_checks: 'Strength Checks', dexterity_checks: 'Dexterity Checks',
  constitution_checks: 'Constitution Checks',
  intelligence_checks: 'Intelligence Checks', wisdom_checks: 'Wisdom Checks',
  charisma_checks: 'Charisma Checks',
  strength_saves: 'Strength Saves', dexterity_saves: 'Dexterity Saves',
  constitution_saves: 'Constitution Saves',
  intelligence_saves: 'Intelligence Saves', wisdom_saves: 'Wisdom Saves',
  charisma_saves: 'Charisma Saves',
  all_saves: 'All Saves', saving_throws: 'Saving Throws',
  perception_checks: 'Perception Checks', survival_checks: 'Survival Checks',
  healing_checks: 'Healing Checks',
  poison_saves: 'Poison Saves', frightened_saves: 'Frightened Saves',
  divination_saves: 'Divination Saves',
  attack_rolls_against: 'Attacks Against',
  next_attack_roll_against: 'Next Attack Against',
  divination_spells: 'Divination Spells', thought_reading: 'Thought Reading',
  emotion_sensing: 'Emotion Sensing',
}

/** Parenthetical notes in English. */
const noteEn: Record<string, string> = {
  'weapon attacks': 'weapon attacks', 'by chosen types': 'chosen types',
  'within area': 'within area', 'chosen types': 'chosen types',
  melee: 'melee', Courage: 'Courage', Enlarge: 'Enlarge', Reduce: 'Reduce',
  Forceful: 'Forceful', Grasping: 'Grasping',
  "Bear's Endurance": "Bear's Endurance", "Bull's Strength": "Bull's Strength",
  "Cat's Grace": "Cat's Grace", "Eagle's Splendor": "Eagle's Splendor",
  "Fox's Cunning": "Fox's Cunning", "Owl's Wisdom": "Owl's Wisdom",
  suppressed: 'suppressed', 'undead target': 'undead target',
  'chosen alignment': 'chosen alignment', 'outlined creatures': 'outlined creatures',
  'target wearing metal armor': 'metal-armored target',
  'tracking target': 'tracking target', 'first attack against target': 'first attack',
  'warm shield': 'warm shield', 'chill shield': 'chill shield', chosen: 'chosen',
  shapechangers: 'shapechangers', 'plant creatures': 'plant creatures',
}

/** Translate a damageBonus string value like "2d6 thunder" → "2d6 雷鸣" (zh-CN) / "2d6 Thunder" (en-US). */
export function translateDamageBonus(val: string, locale?: TermLocale): string {
  const en = isEn(locale)
  const resolveType = (t: string) =>
    en ? (damageTypeNamesEn[t] || t) : (damageTypeStyles[t]?.name || t)
  // "1d4 (Enlarge)" or "1d4 (acid/cold/fire/lightning/thunder)"
  const parenMatch = val.match(/^(.+?)\s*\((.+)\)$/)
  if (parenMatch) {
    const base = parenMatch[1].trim()
    const note = parenMatch[2].trim()
    const translated = note.split('/').map(s => resolveType(s.trim())).join('/')
    return en ? `${base} (${translated})` : `${base}（${translated}）`
  }
  const parts = val.split(/\s+/)
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]
    if (damageTypeStyles[last]) {
      parts[parts.length - 1] = resolveType(last)
      return parts.join(' ')
    }
  }
  return val
}

export function translateBuffTerm(term: string, locale?: TermLocale): string {
  const en = isEn(locale)
  const baseDict = en ? buffTermEn : buffTermCn
  const noteDict = en ? noteEn : noteCn
  const creatureDict = en ? creatureTypeNamesEn : creatureTypeNames
  const m = term.match(/^(.+?)\s*\((.+)\)$/)
  if (m) {
    const base = baseDict[m[1].trim()] || m[1].trim()
    const raw = m[2].trim()
    let note = noteDict[raw]
    if (!note && raw.includes(',')) {
      note = raw.split(',').map(s => {
        const t = s.trim()
        return creatureDict[t] || baseDict[t] || noteDict[t] || t
      }).join(en ? ', ' : '、')
    }
    if (!note) note = raw
    return en ? `${base} (${note})` : `${base}（${note}）`
  }
  return baseDict[term] || term
}

// ── Effects 管线渲染常量 ──────────────────────────

/** 触发类型中文标签 + 图标 */
export const triggerLabels: Record<string, { label: string; icon: string }> = {
  on_cast: { label: '施法时', icon: '✦' },
  on_hit: { label: '命中时', icon: '⚔' },
  on_weapon_hit: { label: '武器命中时', icon: '🗡' },
  on_reaction: { label: '反应', icon: '↩' },
  on_target_downed: { label: '目标倒地时', icon: '💀' },
  start_of_turn: { label: '回合开始', icon: '▶' },
  end_of_turn: { label: '回合结束', icon: '■' },
  start_of_target_turn: { label: '回合开始', icon: '▶' },
  end_of_target_turn: { label: '回合结束', icon: '■' },
  on_enter_zone: { label: '进入区域', icon: '◎' },
  on_leave_zone: { label: '离开区域', icon: '◌' },
  on_take_damage: { label: '受伤时', icon: '💔' },
  on_concentration_end: { label: '专注结束', icon: '⊘' },
  on_action_invoked: { label: '执行动作时', icon: '🎯' },
  narrative: { label: '效果', icon: '📜' },
}

const triggerLabelsEn: Record<string, string> = {
  on_cast: 'On Cast',
  on_hit: 'On Hit',
  on_weapon_hit: 'On Weapon Hit',
  on_reaction: 'Reaction',
  on_target_downed: 'On Target Downed',
  start_of_turn: 'Start of Turn',
  end_of_turn: 'End of Turn',
  start_of_target_turn: 'Start of Turn',
  end_of_target_turn: 'End of Turn',
  on_enter_zone: 'On Enter Zone',
  on_leave_zone: 'On Leave Zone',
  on_take_damage: 'On Take Damage',
  on_concentration_end: 'Concentration Ends',
  on_action_invoked: 'On Action Invoked',
  narrative: 'Effect',
}

export function getTriggerLabel(trigger: string, locale?: TermLocale): { label: string; icon: string } {
  const base = triggerLabels[trigger]
  const icon = base?.icon || '•'
  if (locale === 'en-US') return { label: triggerLabelsEn[trigger] || trigger, icon }
  return { label: base?.label || trigger, icon }
}

const statNamesCn: Record<string, string> = {
  ac: 'AC', speed: '速度', hp_max: '最大HP', max_hp: '最大HP', attack_bonus: '攻击', damage_dice: '伤害骰',
  size: '体型', weapon_damage: '武器伤害',
}
const statNamesEn: Record<string, string> = {
  ac: 'AC', speed: 'Speed', hp_max: 'Max HP', max_hp: 'Max HP', attack_bonus: 'Attack',
  damage_dice: 'Damage Dice', size: 'Size', weapon_damage: 'Weapon Damage',
}
const rollNamesCn: Record<string, string> = {
  attack: '攻击', save: '豁免', ability_check: '属性检定', stealth: '潜行',
}
const rollNamesEn: Record<string, string> = {
  attack: 'Attack', save: 'Save', ability_check: 'Ability Check', stealth: 'Stealth',
}
const onLabelsCn: Record<string, string> = {
  attack: '攻击', save: '豁免', incoming_attack: '被攻击',
  saving_throw: '豁免', ability_check: '属性检定', attack_roll: '攻击',
}
const onLabelsEn: Record<string, string> = {
  attack: 'Attack', save: 'Save', incoming_attack: 'Incoming Attack',
  saving_throw: 'Save', ability_check: 'Ability Check', attack_roll: 'Attack',
}

export function getStatName(stat: string, locale?: TermLocale): string {
  if (locale === 'en-US') return statNamesEn[stat] || stat
  return statNamesCn[stat] || stat
}

export function getRollName(roll: string, locale?: TermLocale): string {
  if (locale === 'en-US') return rollNamesEn[roll] || roll
  return rollNamesCn[roll] || roll
}

const isEn = (locale?: TermLocale) => locale === 'en-US'

/** 效果原语 → 紧凑显示 (text + tailwind color class)。locale 默认 zh-CN。 */
export function formatEffectPrimitive(
  e: Record<string, any>,
  locale?: TermLocale,
): { text: string; color: string } {
  const en = isEn(locale)
  switch (e.type) {
    case 'deal_damage': {
      const dt = e.damage_type || e.damageType || ''
      const s = damageTypeStyles[dt]
      const name = en ? (damageTypeNamesEn[dt] || dt) : (s?.name || dt)
      return { text: `${s?.icon || '💥'} ${e.formula} ${name}`, color: s?.color || 'text-red-300/65' }
    }
    case 'heal':
      return { text: en ? `💚 Heal ${e.formula}` : `💚 治疗 ${e.formula}`, color: 'text-emerald-300/65' }
    case 'apply_condition': {
      // condition term i18n is deferred to a broader status-effects slice;
      // continue to surface the original Chinese label here under both locales.
      const cn = e.condition_cn || e.conditionCn || buffTermCn[e.condition] || e.condition
      if (e.save?.ability) {
        const abilityName = en
          ? (saveTypeNamesEn[e.save.ability] || String(e.save.ability).toUpperCase())
          : (saveTypeNames[e.save.ability] || String(e.save.ability).toUpperCase())
        const saveWord = en ? 'save' : '豁免'
        return { text: en
          ? `Apply ${cn} (${abilityName} ${saveWord})`
          : `施加 ${cn}（${abilityName}${saveWord}）`, color: 'text-purple-300/65' }
      }
      return { text: en ? `Apply ${cn}` : `施加 ${cn}`, color: 'text-purple-300/65' }
    }
    case 'modify_stat': {
      const sn = getStatName(e.stat, locale)
      const op = e.operation === 'set' ? '→' : e.operation === 'set_floor' ? '≥' : e.operation === 'multiply' ? '×' : ''
      const val = op ? `${op}${e.formula}` : `${Number(e.formula) >= 0 ? '+' : ''}${e.formula}`
      return { text: `${sn} ${val}`, color: 'text-blue-300/65' }
    }
    case 'modify_roll': {
      const rolls = (e.roll_types || e.rollTypes || []).map((r: string) => getRollName(r, locale)).join('/')
      const advWord = en ? 'ADV' : '优势'
      const f = e.formula === 'ADV' ? advWord : `${e.operation === 'subtract' ? '-' : '+'}${e.formula}`
      return { text: `${rolls} ${f}`, color: 'text-indigo-300/65' }
    }
    case 'grant_temp_hp':
      return { text: en ? `Temp HP ${e.formula}` : `临时HP ${e.formula}`, color: 'text-yellow-300/65' }
    case 'grant_resistance': {
      const sep = en ? ', ' : '、'
      const types = (e.damage_types || e.damageTypes || []).map((t: string) =>
        en ? (damageTypeNamesEn[t] || t) : (damageTypeStyles[t]?.name || buffTermCn[t] || t)
      ).join(sep)
      return { text: en ? `Resistance: ${types}` : `抗性: ${types}`, color: 'text-sky-300/65' }
    }
    case 'grant_advantage':
      return { text: en
        ? `Advantage: ${getRollContextLabel(e.on, e.condition, locale)}`
        : `优势: ${getRollContextLabel(e.on, e.condition, locale)}`, color: 'text-green-300/65' }
    case 'grant_disadvantage':
      return { text: en
        ? `Disadvantage: ${getRollContextLabel(e.on, e.condition, locale)}`
        : `劣势: ${getRollContextLabel(e.on, e.condition, locale)}`, color: 'text-rose-300/65' }
    case 'grant_immunity': {
      const sep = en ? ', ' : '、'
      const conds = (e.conditions || []).map((c: string) => buffTermCn[c] || c).join(sep)
      return { text: en ? `Immunity: ${conds}` : `免疫: ${conds}`, color: 'text-amber-300/65' }
    }
    case 'apply_mark':
      return { text: en ? 'Mark target' : '标记目标', color: 'text-fuchsia-300/65' }
    case 'retarget_mark':
      return { text: en ? 'Transfer mark to new target' : '转移标记到新目标', color: 'text-fuchsia-300/65' }
    case 'conditional_extra_damage': {
      const dt = e.damage_type || e.damageType || ''
      const s = damageTypeStyles[dt]
      const name = en ? (damageTypeNamesEn[dt] || dt) : (s?.name || dt)
      return { text: en
        ? `Extra ${e.formula} ${name}`
        : `额外造成 ${e.formula} ${name}`, color: s?.color || 'text-fuchsia-300/65' }
    }
    case 'set_runtime_param': {
      if (e.key === 'transfer_available' && e.value === true) {
        return { text: en ? 'Unlock: Transfer action' : '解锁：转移动作', color: 'text-cyan-300/65' }
      }
      return {
        text: en
          ? `Set: ${getRuntimeParamName(e.key, locale)} = ${formatIdentifierValue(e.value, locale)}`
          : `设置：${getRuntimeParamName(e.key, locale)} = ${formatIdentifierValue(e.value, locale)}`,
        color: 'text-cyan-300/65',
      }
    }
    case 'clear_runtime_param':
      return { text: en
        ? `Clear: ${getRuntimeParamName(e.key, locale)}`
        : `清除：${getRuntimeParamName(e.key, locale)}`, color: 'text-cyan-300/65' }
    case 'end_spell_instance':
      return { text: en ? 'End this spell' : '结束此法术', color: 'text-gray-300/65' }
    case 'narrative':
      return { text: e.description || '', color: 'text-amber-100/45' }
    case 'grant_action': {
      const aTypeCn = e.action_type === 'bonus_action' ? '附赠动作' : e.action_type === 'reaction' ? '反应' : '动作'
      const aTypeEn = e.action_type === 'bonus_action' ? 'Bonus Action' : e.action_type === 'reaction' ? 'Reaction' : 'Action'
      const aType = en ? aTypeEn : aTypeCn
      const name = e.action_name || e.action_name_en || ''
      return { text: en ? `Gain ${aType}: ${name}` : `获得${aType}: ${name}`, color: 'text-cyan-300/65' }
    }
    case 'generate_item':
      return { text: en ? `Generate item: ${e.item_name || ''}` : `生成物品: ${e.item_name || ''}`, color: 'text-amber-300/65' }
    default:
      return { text: e.type, color: 'text-gray-400' }
  }
}

const abilityNamesCn: Record<string, string> = {
  strength: '力量', dexterity: '敏捷', constitution: '体质',
  intelligence: '智力', wisdom: '感知', charisma: '魅力',
}
const abilityNamesEn: Record<string, string> = {
  strength: 'Strength', dexterity: 'Dexterity', constitution: 'Constitution',
  intelligence: 'Intelligence', wisdom: 'Wisdom', charisma: 'Charisma',
}
const targetNamesCn: Record<string, string> = {
  ability_check: '属性检定', saving_throw: '豁免', attack_roll: '攻击',
  weapon_damage: '武器伤害', ac: 'AC', speed: '速度',
}

const runtimeParamNamesCn: Record<string, string> = {
  transfer_available: '转移动作',
  marked_token_id: '当前标记目标',
  selected_option: '已选施法选项',
}
const runtimeParamNamesEn: Record<string, string> = {
  transfer_available: 'Transfer Action',
  marked_token_id: 'Marked Target',
  selected_option: 'Selected Cast Option',
}

const actionIdNamesCn: Record<string, string> = {
  transfer_hex: '转移诅咒',
}
const actionIdNamesEn: Record<string, string> = {
  transfer_hex: 'Transfer Hex',
}

function formatIdentifierValue(value: unknown, locale?: TermLocale): string {
  if (typeof value === 'boolean') return value ? (isEn(locale) ? 'yes' : '是') : (isEn(locale) ? 'no' : '否')
  if (typeof value === 'string') return value
  if (typeof value === 'number') return `${value}`
  if (value == null) return isEn(locale) ? 'null' : '空'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function getRuntimeParamName(key?: string, locale?: TermLocale): string {
  if (!key) return isEn(locale) ? 'runtime param' : '运行时参数'
  if (isEn(locale)) return runtimeParamNamesEn[key] || key
  return runtimeParamNamesCn[key] || key
}

function getRuntimeActionName(actionId?: string, locale?: TermLocale): string {
  if (!actionId) return isEn(locale) ? 'action' : '动作'
  if (isEn(locale)) return actionIdNamesEn[actionId] || actionId
  return actionIdNamesCn[actionId] || actionId
}

export function getRollContextLabel(
  on?: string,
  condition?: Record<string, any>,
  locale?: TermLocale,
): string {
  const en = isEn(locale)
  if (!on) return en ? 'Check' : '检定'
  const abilityKey = condition?.ability
  const ability = abilityKey
    ? (en ? (abilityNamesEn[abilityKey] || abilityKey) : (abilityNamesCn[abilityKey] || abilityKey))
    : ''

  switch (on) {
    case 'ability_check':
      if (en) return ability ? `${ability} Check` : 'Ability Check'
      return ability ? `${ability}属性检定` : '属性检定'
    case 'save':
    case 'saving_throw':
      if (en) return ability ? `${ability} Save` : 'Save'
      return ability ? `${ability}豁免` : '豁免'
    case 'attack':
    case 'attack_roll':
      return en ? 'Attack' : '攻击'
    case 'incoming_attack':
      return en ? 'Incoming Attack' : '被攻击'
    default: {
      const onLabel = en ? (onLabelsEn[on] || on) : (onLabelsCn[on] || on)
      return en ? (ability ? `${ability} ${onLabel}` : onLabel) : `${ability}${onLabel}`
    }
  }
}

export function formatPhaseConditionText(
  condition?: Record<string, any>,
  locale?: TermLocale,
): string | null {
  if (!condition) return null
  const en = isEn(locale)
  if (condition.action_id) {
    return en
      ? `Action: ${getRuntimeActionName(condition.action_id, locale)}`
      : `动作：${getRuntimeActionName(condition.action_id, locale)}`
  }
  if (condition.ability) {
    const ability = en
      ? (abilityNamesEn[condition.ability] || condition.ability)
      : (abilityNamesCn[condition.ability] || condition.ability)
    return en ? `Ability: ${ability}` : `属性：${ability}`
  }
  return null
}

const targetNamesEn: Record<string, string> = {
  ability_check: 'Ability Check', saving_throw: 'Save', attack_roll: 'Attack',
  weapon_damage: 'Weapon Damage', ac: 'AC', speed: 'Speed',
}

/** Format buffEffects into display labels (e.g. "AC +2", "Speed +10 ft"). */
export function formatBuffEffects(
  effects: Record<string, any> | undefined,
  modifiers?: any[],
  conditions?: string[],
  locale?: TermLocale,
): string[] {
  if (!effects && !modifiers?.length && !conditions?.length) return []
  const en = isEn(locale)
  const sep = en ? ', ' : '、'
  const colon = en ? ': ' : '：'
  const join = (xs: string[]) => xs.map(c => translateBuffTerm(c, locale)).join(sep)
  const labels: string[] = []
  if (effects) {
    if (effects.acBonus) labels.push(`AC +${effects.acBonus}`)
    if (effects.attackBonus) labels.push(en ? `Attack +${effects.attackBonus}` : `攻击 +${effects.attackBonus}`)
    if (effects.damageBonus) labels.push(en ? `Damage +${effects.damageBonus}` : `伤害 +${effects.damageBonus}`)
    if (effects.speedBonus) labels.push(en ? `Speed +${effects.speedBonus} ft` : `速度 +${effects.speedBonus}尺`)
    if (effects.tempHp) labels.push(en ? `Temp HP: ${effects.tempHp}` : `临时HP: ${effects.tempHp}`)
    if (effects.resistances?.length) {
      labels.push(`${en ? 'Resistance' : '抗性'}${colon}${join(effects.resistances)}`)
    }
    if (effects.immunities?.length) {
      labels.push(`${en ? 'Immunity' : '免疫'}${colon}${join(effects.immunities)}`)
    }
    if (effects.advantageOn?.length) {
      labels.push(`${en ? 'Advantage' : '优势'}${colon}${join(effects.advantageOn)}`)
    }
    if (effects.disadvantageOn?.length) {
      labels.push(`${en ? 'Disadvantage' : '劣势'}${colon}${join(effects.disadvantageOn)}`)
    }
    if (effects.grantDisadvantage?.length) {
      labels.push(`${en ? 'Attackers Disadvantage' : '使攻击者劣势'}${colon}${join(effects.grantDisadvantage)}`)
    }
  }
  if (conditions?.length) {
    labels.push(`${en ? 'Status' : '状态'}${colon}${join(conditions)}`)
  }
  if (modifiers?.length && labels.length === 0) {
    const targets = en ? targetNamesEn : targetNamesCn
    const abilities = en ? abilityNamesEn : abilityNamesCn
    for (const m of modifiers) {
      const ability = m.condition?.ability ? abilities[m.condition.ability] || m.condition.ability : ''
      if (m.type === 'advantage') {
        const target = targets[m.target] || m.target
        labels.push(`${en ? 'Advantage' : '优势'}${colon}${ability}${en && ability ? ' ' : ''}${target}`)
      } else if (m.type === 'disadvantage') {
        const target = targets[m.target] || m.target
        labels.push(`${en ? 'Disadvantage' : '劣势'}${colon}${ability}${en && ability ? ' ' : ''}${target}`)
      } else if (m.stat === 'weapon_damage') {
        labels.push(en ? `Weapon Damage ${m.value}` : `武器伤害 ${m.value}`)
      } else if (m.stat && m.stat !== 'size') {
        const sn = targets[m.stat] || m.stat
        labels.push(`${sn} ${m.value >= 0 ? '+' : ''}${m.value}`)
      }
    }
  }
  return labels
}

const STATUS_SUMMARY_IGNORED_EFFECT_TYPES = new Set([
  'narrative',
  'grant_action',
  'apply_mark',
  'retarget_mark',
  'set_runtime_param',
  'clear_runtime_param',
  'end_spell_instance',
])

function buildStatusSummaryLabel(
  trigger: string,
  effect: Record<string, any>,
  perspective: 'source' | 'target',
  locale?: TermLocale,
): string | null {
  if (!effect?.type || STATUS_SUMMARY_IGNORED_EFFECT_TYPES.has(effect.type)) return null
  const en = isEn(locale)

  if (effect.type === 'conditional_extra_damage') {
    const dt = effect.damage_type || effect.damageType || ''
    const typeName = en
      ? (damageTypeNamesEn[dt] || buffTermEn[dt] || dt || 'extra')
      : (damageTypeStyles[dt]?.name || buffTermCn[dt] || dt || '额外')
    if (perspective === 'target') {
      if (trigger === 'on_weapon_hit') {
        return en
          ? `When caster hits with a weapon: take ${effect.formula} extra ${typeName} damage`
          : `施法者武器命中时：额外受到 ${effect.formula} ${typeName}伤害`
      }
      if (trigger === 'on_hit') {
        return en
          ? `When caster hits: take ${effect.formula} extra ${typeName} damage`
          : `施法者命中时：额外受到 ${effect.formula} ${typeName}伤害`
      }
    }
  }

  const primitive = formatEffectPrimitive(effect, locale).text
  if (!primitive) return null
  if (trigger === 'on_cast') return primitive

  const triggerLabel = getTriggerLabel(trigger, locale).label
  if (!triggerLabel) return primitive
  return en ? `${triggerLabel}: ${primitive}` : `${triggerLabel}：${primitive}`
}

export function getSpellStatusSummaryLabels(
  spellId?: string | null,
  selectedOption?: string | null,
  perspective: 'source' | 'target' = 'target',
  locale?: TermLocale,
): string[] {
  if (!spellId) return []
  const phases = getSpellEffectPhases(spellId, selectedOption)
  const labels: string[] = []
  const seen = new Set<string>()

  for (const phase of phases) {
    const trigger = String(phase?.trigger || 'on_cast')
    for (const effect of Array.isArray(phase?.effects) ? phase.effects : []) {
      const label = buildStatusSummaryLabel(trigger, effect, perspective, locale)
      if (!label || seen.has(label)) continue
      seen.add(label)
      labels.push(label)
    }
  }

  return labels
}
