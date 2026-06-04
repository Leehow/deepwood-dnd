/**
 * 持久能力效果类型 — 专长 / 职业特性 / 种族特性的统一效果描述。
 *
 * 与 spellEffect.ts 对称：法术中间件处理一次性触发效果，
 * 本类型系统处理始终在线的被动效果与可激活的战斗能力。
 */

// ── 效果来源 ──────────────────────────────────────────

export type FeatureSourceType = 'feat' | 'class_feature' | 'race_feature'

export interface ModifierSource {
  type: FeatureSourceType
  id: string
  name: string
}

// ── 数值修正 ──────────────────────────────────────────

export type ModifierTarget =
  | 'ac'
  | 'initiative'
  | 'speed'
  | 'flying_speed'
  | 'hp_per_level'
  | 'passive_perception'
  | 'passive_investigation'
  | 'medium_armor_dex_cap'
  | 'light_armor_dex_cap'
  | 'dex_save'
  | 'all_saves'
  | 'unarmed_damage_die'
  | 'extra_attack'
  | 'crit_range'
  | 'brutal_critical_dice'
  | 'sneak_attack_dice'
  | 'healing_bonus'
  | 'cantrip_damage_bonus'
  | 'destroy_undead_cr'

export interface NumericModifier {
  target: ModifierTarget
  value: number | string          // string 用于 "shield_ac"、"1d4" 等公式
  condition?: string              // 生效条件 key
  source: ModifierSource
}

// ── 战斗选项（玩家主动激活）──────────────────────────

export interface CombatOption {
  id: string
  name: string
  nameEn: string
  actionType: 'action' | 'bonus_action' | 'reaction' | '10_minutes'
  condition?: string
  attackPenalty?: number
  damageBonus?: number
  acBonus?: string | number
  heal?: string
  damageDie?: string
  damageType?: string
  tempHp?: string
  targets?: number
  effect?: string
  limit?: string
  source: ModifierSource
}

// ── 被动战斗触发 ─────────────────────────────────────

export interface CombatTrigger {
  id: string
  trigger: string
  effect: string
  condition?: string
  actionType?: string             // 消耗反应则为 'reaction'
  source: ModifierSource
}

// ── 可追踪资源 ───────────────────────────────────────

export interface FeatureResource {
  id: string
  name: string
  nameEn: string
  max: number | string
  recharge: 'short_rest' | 'long_rest'
  usage: string
  die?: string
  source: ModifierSource
}

// ── 优势/伤害减免 ───────────────────────────────────

export interface AdvantageGrant {
  context: string
  source: ModifierSource
}

export interface DamageReductionEffect {
  amount: number
  types: string[]
  condition: string
  source: ModifierSource
}

// ── 熟练授予 ─────────────────────────────────────────

export interface ProficiencyGrants {
  savingThrows: string[]
  armor: string[]
  weapons: string[]
  skills: string[]
  languages: number
  cantrips: number
}

// ── 规则覆写 ─────────────────────────────────────────

export interface RuleOverrideEntry {
  key: string
  source: ModifierSource
}

// ── AC 公式（无甲防御等替代公式）────────────────────

export interface ACFormula {
  formula: string            // "10 + dex + con"
  condition?: string
  source: ModifierSource
}

// ── 免疫 / 抗性 ─────────────────────────────────────

export interface ImmunityGrant {
  immuneTo: string           // "diseased", "poisoned", "sleep", "aging"
  source: ModifierSource
}

export interface ResistanceGrant {
  damageType: string         // "poison", "fire", "bludgeoning_nonmagical"
  source: ModifierSource
}

// ── 职业战斗能力（偷袭/神圣打击等复杂被动）─────────

export interface ClassCombatAbility {
  id: string
  name: string
  nameEn: string
  type: string               // 'sneak_attack', 'divine_strike', 'damage_reduction' 等
  trigger: string            // 'on_hit', 'on_critical', 'on_damage_received'
  damage?: string            // 当前等级的伤害公式
  damageType?: string[]
  condition?: Record<string, unknown>
  usesPerTurn?: number
  actionType?: string        // 'reaction' for uncanny dodge
  source: ModifierSource
}

// ── resolvePersistentEffects 完整输出 ────────────────

export interface ResolvedPersistentEffects {
  /** 所有数值修正（含来源与条件） */
  modifiers: NumericModifier[]
  /** 活跃的规则覆写 */
  ruleOverrides: RuleOverrideEntry[]
  /** 可激活的战斗选项（专长来源） */
  combatOptions: CombatOption[]
  /** 被动战斗触发（专长来源） */
  combatTriggers: CombatTrigger[]
  /** 专长/特性授予的资源 */
  resources: FeatureResource[]
  /** 优势授予 */
  advantages: AdvantageGrant[]
  /** 熟练授予汇总 */
  proficiencyGrants: ProficiencyGrants
  /** 伤害减免（专长来源） */
  damageReduction: DamageReductionEffect | null
  /** AC 替代公式（无甲防御等） */
  acFormulas: ACFormula[]
  /** 免疫授予 */
  immunities: ImmunityGrant[]
  /** 抗性授予 */
  resistances: ResistanceGrant[]
  /** 职业战斗能力（偷袭/神圣打击/反制等） */
  classAbilities: ClassCombatAbility[]
  /** 快速标记 */
  hasCombatOptions: boolean
  hasCombatTriggers: boolean
  hasResources: boolean
}

// ── 特性动作 UI 描述符（featureActionMiddleware 输出）──

export interface FeatureActionDescriptor {
  canUse: boolean
  actionType: string
  actionLabel: string
  resourceCost?: { resourceId: string; amount: number }
  conditionsMet: boolean
  conditionLabel?: string
  disabledReasons: FeatureDisabledReason[]
}

export type FeatureDisabledReasonType =
  | 'resource_exhausted'
  | 'condition_not_met'
  | 'already_used'
  | 'wrong_equipment'

export interface FeatureDisabledReason {
  type: FeatureDisabledReasonType
  detail?: string
}

// ── 特性动作上下文 ──────────────────────────────────

export interface FeatureActionContext {
  weaponType?: 'heavy_melee' | 'ranged' | 'finesse' | 'polearm' | 'one_handed' | null
  isDualWielding?: boolean
  hasHeavyArmor?: boolean
  hasShield?: boolean
  isGrappling?: boolean
  justDashed?: boolean
  hasHealersKit?: boolean
  /** 各资源剩余量 { resourceId: remaining } */
  resourcesRemaining?: Record<string, number>
  /** 本轮已使用的 limit key */
  usedThisTurn?: Set<string>
  /** 是否已使用攻击动作 */
  tookAttackAction?: boolean
}
