import type { EffectPhase } from './spellEffect'

/**
 * D&D 5E Spell System Types
 * 法术系统类型定义
 */

// 法术学派
export type SpellSchool =
  | 'abjuration'    // 防护
  | 'conjuration'   // 咒法
  | 'divination'    // 预言
  | 'enchantment'   // 惑控
  | 'evocation'     // 塑能
  | 'illusion'      // 幻术
  | 'necromancy'    // 死灵
  | 'transmutation' // 变化

// 职业类型
export type SpellClass =
  | 'bard'      // 吟游诗人
  | 'cleric'    // 牧师
  | 'druid'     // 德鲁伊
  | 'paladin'   // 圣骑士
  | 'ranger'    // 游侠
  | 'sorcerer'  // 术士
  | 'warlock'   // 邪术师
  | 'wizard'    // 法师

// 法术成分
export type SpellComponent = 'V' | 'S' | 'M'  // 语言、姿势、材料

// 攻击类型
export type SpellAttackType =
  | 'melee_spell'   // 近战法术攻击
  | 'ranged_spell'  // 远程法术攻击
  | 'save'          // 豁免
  | 'auto'          // 自动命中
  | 'utility'       // 效用法术

// 豁免属性
export type SaveType =
  | 'strength' | 'dexterity' | 'constitution'
  | 'intelligence' | 'wisdom' | 'charisma'

// 豁免效果
export type SaveEffect = 'half' | 'none' | 'partial'

// 效果区域类型
export type AreaType = 'sphere' | 'cone' | 'cube' | 'line' | 'cylinder'

// 效果区域
export interface AreaOfEffect {
  type: AreaType
  size: number  // 尺
  sizeIsMax?: boolean  // true 表示 size 是上限，施法者可选更小
}

// D&D 5E 状态效果
export type ConditionType =
  | 'blinded'       // 目盲
  | 'charmed'       // 魅惑
  | 'deafened'      // 耳聋
  | 'frightened'    // 恐惧
  | 'grappled'      // 擒抱
  | 'incapacitated' // 失能
  | 'invisible'     // 隐形
  | 'paralyzed'     // 麻痹
  | 'petrified'     // 石化
  | 'poisoned'      // 中毒
  | 'prone'         // 倒地
  | 'restrained'    // 束缚
  | 'stunned'       // 震慑
  | 'unconscious'   // 昏迷

// 持续豁免配置（每回合自动重新豁免）
export interface OngoingSave {
  timing: 'end_of_turn' | 'start_of_turn'  // 回合结束/开始时豁免
  saveType?: SaveType                       // 使用的属性（默认使用初始豁免属性）
}

// 动作挣脱配置（用动作尝试解除）
export interface EscapeAction {
  type: 'check' | 'save'     // 检定 or 豁免
  ability: SaveType          // 使用的属性
}

// 效果解除条件
export type BreakCondition =
  | 'damage'           // 受到伤害
  | 'shaken'           // 被摇醒（他人用动作）
  | 'harmful_effect'   // 受到有害效果
  | 'end_of_caster_turn' // 施法者回合结束

// 控制法术效果配置
export interface ControlEffect {
  condition?: ConditionType          // 施加的状态（区域效果法术可能不需要）
  conditionCn?: string               // 状态中文名
  ongoingSave?: OngoingSave          // 持续豁免（每回合自动重骰）
  escapeAction?: EscapeAction        // 动作挣脱
  breakConditions?: BreakCondition[] // 解除条件
  durationRounds?: number            // 持续回合数（用于非专注法术）

  // 效果类型
  effectType?: 'target' | 'zone'     // target=目标型, zone=区域型

  // 区域型法术的触发时机
  zoneTrigger?: 'enter' | 'start_turn' | 'enter_or_start'  // 进入/回合开始/两者

  // 解除提示文本
  escapeHint?: string                // 如: "每回合结束时可重新感知豁免"
}

// Token 视觉滤镜参数（可组合，多个法术效果会合并）
export interface TokenFilter {
  blur?: number            // 高斯模糊半径 px（如 3）
  opacity?: number         // token 透明度 0-1（如 0.15 = 隐形）
  glow?: string            // 发光颜色（如 "#fbbf24"）
  glowRadius?: number      // 发光 shadow blur 半径（默认 10）
  glowAnimation?: 'pulse'  // 脉冲动画
  overlay?: string         // 叠层颜色带 alpha（如 "rgba(100,150,255,0.25)"）
  saturate?: number        // 饱和度 0=灰度 1=正常
  brightness?: number      // 亮度偏移 -1~1
}

// 单个法术定义
export interface Spell {
  id: string
  name: string           // 中文名
  nameEn: string         // 英文名
  level: number          // 0-9，0为戏法
  school: SpellSchool    // 法术学派
  castingTime: string    // 施法时间
  range: string          // 施法距离
  components: SpellComponent[]  // 法术成分
  duration: string       // 持续时间
  ritual: boolean        // 是否可以仪式施法
  concentration: boolean // 是否需要专注
  description: string    // 详细描述
  classes: SpellClass[]  // 可学习的职业
  materials?: string     // 材料说明
  materialCost?: number | null    // 材料金币价格，null表示无价格要求
  materialConsumed?: boolean      // 材料是否在施法时被消耗
  iconPath?: string      // 图标路径

  // 结构化数据（新增）
  damage?: string                    // 伤害骰，如"8d6"
  damageType?: string                // 伤害类型，如"fire"
  damageTypeCn?: string              // 伤害类型中文，如"火焰"
  damageAtSlotLevel?: Record<string, string>  // 各法术位伤害
  damageAtCharacterLevel?: Record<string, string>  // 戏法按角色等级伤害
  attackType?: SpellAttackType       // 攻击类型
  saveType?: SaveType                // 豁免属性
  saveTypeCn?: string                // 豁免属性中文
  saveEffect?: SaveEffect            // 豁免成功效果
  healing?: string                   // 治疗骰
  healingAtSlotLevel?: Record<string, string>  // 各法术位治疗
  areaOfEffect?: AreaOfEffect        // 效果区域
  conditions?: string[]              // 造成的状态（旧字段，保留兼容）
  atHigherLevels?: string            // 升环效果（中文）
  atHigherLevelsEn?: string          // 升环效果（英文）
  cantripScaling?: string            // 戏法成长描述
  descriptionEn?: string             // 英文描述

  // 受影响的生物类型
  affectedCreatureTypes?: string[]   // 如 ["undead", "fiend", "aberration"]

  // 结构化机械效果（buff/debuff）
  buffEffects?: {
    acBonus?: number                  // AC加值，如护盾术+5
    attackBonus?: number              // 攻击检定加值
    damageBonus?: string              // 额外伤害，如"1d4 radiant"
    tempHp?: string                   // 临时生命值，如"1d4+4"、"CHA_mod/round"
    resistances?: string[]            // 伤害抗性，如["fire","cold"]
    immunities?: string[]             // 免疫，如["poison","frightened"]
    vulnerabilities?: string[]        // 易伤
    speedBonus?: number               // 速度加值(尺)
    advantageOn?: string[]            // 获得优势的检定
    disadvantageOn?: string[]         // 获得劣势的检定
    grantDisadvantage?: string[]      // 使敌人劣势
  }

  // 控制法术相关
  isControlSpell?: boolean           // 是否是控制法术
  controlEffect?: ControlEffect      // 控制效果配置

  // 区域效果（遮蔽、困难地形等）
  zoneEffects?: {
    obscurement?: 'heavy' | 'light'
    difficultTerrain?: boolean
    spreadsAroundCorners?: boolean
    cloudMovement?: { distance: number; direction: string; timing: string }
    windDispel?: Record<string, number>
  }

  // 结构化效果管线（新系统）
  effects?: EffectPhase[]            // 可执行效果定义

  // 施放选项（如变巨/缩小术的两种模式）
  castOptions?: { key: string; label: string; effects: EffectPhase[] }[]

  // 新 runtime 引擎元数据
  runtime?: {
    engine?: string
    durationBySlotLevel?: Record<string, number>
    [key: string]: any
  }

  // Token 视觉滤镜 — 已迁移到 effects[] 中的 apply_token_filter primitive
  // 保留字段定义供旧数据兼容，新法术不应使用
  tokenFilter?: TokenFilter

  // 幻影法术数据
  illusion?: {
    types?: string[]                 // 感官类型 ["visual", "auditory", ...]
    subtype?: string                 // 子类型 "self_duplicate" | "mental" | "duplicates" | ...
    controllable?: boolean           // 是否可控
    reshapeable?: boolean            // 是否可改变外观（移动时/随时）
    physicalPass?: boolean           // 是否可穿透（纯幻象）
    size?: { type: string; size?: number }
    [key: string]: any
  }

  // 来源
  source?: string                    // 来源书籍，如 "PHB"
}

// 法术等级信息
export interface SpellLevel {
  level: number
  name: string
  nameEn: string
  description?: string
}

// 法术学派信息
export interface SpellSchoolInfo {
  id: SpellSchool
  name: string
  nameEn: string
  description: string
}

// 法术系统概览
export interface SpellSystemOverview {
  description: string
  descriptionEn: string
  totalSpells: number
  purpose: string
  relatedRules: string[]
  quickReference: string
}

// 完整的法术数据结构
export interface SpellData {
  overview: SpellSystemOverview
  spellSystem: {
    description: string
    totalSpells: number
    spellLevels: SpellLevel[]
    schools: SpellSchoolInfo[]
  }
  spells: Spell[]
}

// 法术筛选器选项
export interface SpellFilterOptions {
  searchText?: string      // 搜索文本
  levels?: number[]        // 法术等级
  schools?: SpellSchool[]  // 法术学派
  classes?: SpellClass[]   // 职业
  ritual?: boolean          // 仪式法术
  concentration?: boolean   // 专注法术
}

// 法术排序选项
export type SpellSortOption =
  | 'name'        // 按名称
  | 'level'       // 按等级
  | 'school'      // 按学派
  | 'castingTime' // 按施法时间
