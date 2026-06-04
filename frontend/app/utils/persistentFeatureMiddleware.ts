/**
 * 持久能力效果中间件 — 纯函数，从角色的专长 + 职业特性 + 种族特性
 * 解析出统一的效果栈（修正值 / 战斗选项 / 触发 / 资源 / 规则覆写）。
 *
 * 与法术中间件对称：
 *   spellEffectMiddleware       → 一次性法术触发效果
 *   featureEffectMiddleware     → 触发型职业特性（灵感骰、引导神力等）
 *   persistentFeatureMiddleware → 始终在线的被动 & 可激活战斗能力（本文件）
 */
import featsData from '~/data/rules/feats.json'
import passiveFeaturesData from '~/data/passive-features.json'

import type {
  ModifierSource,
  NumericModifier,
  CombatOption,
  CombatTrigger,
  FeatureResource,
  AdvantageGrant,
  DamageReductionEffect,
  ProficiencyGrants,
  RuleOverrideEntry,
  ResolvedPersistentEffects,
  ACFormula,
  ImmunityGrant,
  ResistanceGrant,
  ClassCombatAbility,
} from '~/types/featureEffect'

// ── 数据加载 ─────────────────────────────────────────

const feats = (featsData as any).feats || {}
const passiveFeatures: any[] = (passiveFeaturesData as any).features || []

// ── 输入类型 ─────────────────────────────────────────

export interface PersistentEffectInput {
  featIds: string[]
  classId?: string
  level?: number
  subclassId?: string
  raceId?: string
  subraceId?: string
  featChoices?: Record<string, any> | null
}

// ── 专长 → 数值修正 ─────────────────────────────────

function extractFeatModifiers(featId: string, feat: any): NumericModifier[] {
  const p = feat.effects?.passive
  if (!p) return []
  const src: ModifierSource = { type: 'feat', id: featId, name: feat.name }
  const mods: NumericModifier[] = []

  const numericMap: Array<[string, string]> = [
    ['initiative_bonus', 'initiative'],
    ['speed_bonus', 'speed'],
    ['hp_per_level', 'hp_per_level'],
    ['passive_perception_bonus', 'passive_perception'],
    ['passive_investigation_bonus', 'passive_investigation'],
    ['medium_armor_dex_cap_bonus', 'medium_armor_dex_cap'],
    ['light_armor_dex_cap_bonus', 'light_armor_dex_cap'],
  ]
  for (const [jsonKey, target] of numericMap) {
    if (typeof p[jsonKey] === 'number')
      mods.push({ target: target as any, value: p[jsonKey], source: src })
  }

  if (p.ac_bonus && typeof p.ac_bonus === 'object')
    mods.push({ target: 'ac', value: p.ac_bonus.value, condition: p.ac_bonus.condition, source: src })
  if (p.dex_save_bonus)
    mods.push({ target: 'dex_save', value: p.dex_save_bonus.value, condition: p.dex_save_bonus.condition, source: src })
  if (typeof p.unarmed_damage_die === 'string')
    mods.push({ target: 'unarmed_damage_die', value: p.unarmed_damage_die, source: src })

  return mods
}

// ── 专长 → 优势 / 伤害减免 / 规则覆写 ──────────────

function extractFeatAdvantages(featId: string, feat: any): AdvantageGrant[] {
  const adv = feat.effects?.passive?.advantage
  if (!Array.isArray(adv)) return []
  const src: ModifierSource = { type: 'feat', id: featId, name: feat.name }
  return adv.map((ctx: string) => ({ context: ctx, source: src }))
}

function extractFeatDamageReduction(featId: string, feat: any): DamageReductionEffect | null {
  const dr = feat.effects?.passive?.damage_reduction
  if (!dr || typeof dr.amount !== 'number') return null
  return { ...dr, source: { type: 'feat' as const, id: featId, name: feat.name } }
}

function extractFeatRuleOverrides(featId: string, feat: any): RuleOverrideEntry[] {
  const arr = feat.effects?.rule_override
  if (!Array.isArray(arr)) return []
  const src: ModifierSource = { type: 'feat', id: featId, name: feat.name }
  return arr.map((key: string) => ({ key, source: src }))
}

// ── 专长 → 战斗选项 / 触发 / 资源 ──────────────────

function extractFeatCombatOptions(featId: string, feat: any): CombatOption[] {
  const opts = feat.effects?.combat_option
  if (!Array.isArray(opts)) return []
  const src: ModifierSource = { type: 'feat', id: featId, name: feat.name }
  return opts.map((o: any, i: number) => ({
    id: `${featId}_opt_${i}`,
    name: o.name ?? '', nameEn: o.nameEn ?? '',
    actionType: o.action ?? 'action',
    condition: o.condition,
    attackPenalty: o.attack_penalty, damageBonus: o.damage_bonus,
    acBonus: o.ac_bonus, heal: o.heal,
    damageDie: o.damage_die, damageType: o.damage_type,
    tempHp: o.temp_hp, targets: o.targets,
    effect: o.effect, limit: o.limit,
    source: src,
  }))
}

function extractFeatCombatTriggers(featId: string, feat: any): CombatTrigger[] {
  const arr = feat.effects?.combat_trigger
  if (!Array.isArray(arr)) return []
  const src: ModifierSource = { type: 'feat', id: featId, name: feat.name }
  return arr.map((t: any, i: number) => ({
    id: `${featId}_trig_${i}`,
    trigger: t.trigger, effect: t.effect,
    condition: t.condition, actionType: t.action,
    source: src,
  }))
}

function extractFeatResources(featId: string, feat: any): FeatureResource[] {
  const arr = feat.effects?.resource
  if (!Array.isArray(arr)) return []
  const src: ModifierSource = { type: 'feat', id: featId, name: feat.name }
  return arr.map((r: any) => ({
    id: `feat_${featId}_${(r.nameEn ?? 'res').toLowerCase().replace(/\s+/g, '_')}`,
    name: r.name, nameEn: r.nameEn ?? '',
    max: r.max, recharge: r.recharge,
    usage: r.usage, die: r.die,
    source: src,
  }))
}

// ── 专长 → 熟练授予 ─────────────────────────────────

function extractFeatProficiencies(
  featId: string,
  feat: any,
  choices?: Record<string, any> | null,
): Partial<ProficiencyGrants> {
  const pg = feat.effects?.proficiency_grant
  if (!pg) return {}
  const r: Partial<ProficiencyGrants> = {}
  if (pg.saving_throw === 'chosen_ability') {
    const c = choices?.[featId]?.abilityChoice
    if (c) r.savingThrows = [c]
  }
  if (Array.isArray(pg.armor)) r.armor = pg.armor
  if (Array.isArray(pg.weapon)) r.weapons = pg.weapon
  if (typeof pg.weapons === 'number') {
    const c = choices?.[featId]?.weapons
    if (Array.isArray(c)) r.weapons = c
  }
  if (typeof pg.languages === 'number') r.languages = pg.languages
  if (typeof pg.cantrips === 'number') r.cantrips = pg.cantrips
  if (pg.skills_or_tools) {
    const c = choices?.[featId]?.skills
    if (Array.isArray(c)) r.skills = c
  }
  return r
}

// ── 效果累积器（Handler 共用写入目标）────────────────

interface EffectAccumulator {
  modifiers: NumericModifier[]
  ruleOverrides: RuleOverrideEntry[]
  advantages: AdvantageGrant[]
  acFormulas: ACFormula[]
  immunities: ImmunityGrant[]
  resistances: ResistanceGrant[]
  classAbilities: ClassCombatAbility[]
  proficiencyGrants: ProficiencyGrants
}

// ── 通用工具 ─────────────────────────────────────────

/** 从 scaling 对象中按等级取值（如 { "2": 10, "6": 15 }） */
function resolveScaling(scaling: Record<string, any> | undefined, level: number): any {
  if (!scaling) return undefined
  let result: any = undefined
  for (const [k, v] of Object.entries(scaling)) {
    if (level >= Number(k)) result = v
  }
  return result
}

function conditionKey(cond: any): string | undefined {
  if (!cond) return undefined
  if (cond.unarmored && cond.noShield) return 'unarmored_no_shield'
  if (cond.unarmored) return 'unarmored'
  if (cond.unarmoredOrLightArmor) return 'not_heavy_armor'
  return undefined
}

function matchesCharacter(
  f: any, classId?: string, subclassId?: string, raceId?: string, subraceId?: string,
): boolean {
  const isClass = classId && Array.isArray(f.class) && f.class.includes(classId)
  const isSub = subclassId && Array.isArray(f.subclass) && f.subclass.includes(subclassId)
  const isRace = raceId && Array.isArray(f.race) && f.race.includes(raceId)
  const isSubrace = subraceId && Array.isArray(f.subrace) && f.subrace.includes(subraceId)
  return !!(isClass || isSub || isRace || isSubrace)
}

// ── 被动特性 Handler 注册表 ─────────────────────────
// 每个 handler: (feature, level, source, accumulator) → void
// 新增职业/种族只需在 passive-features.json 添加数据，自动匹配

type PassiveHandler = (f: any, lv: number, src: ModifierSource, acc: EffectAccumulator) => void

const PASSIVE_HANDLERS: Record<string, PassiveHandler> = {
  ac_formula: (f, _lv, src, acc) => {
    if (f.effect?.formula)
      acc.acFormulas.push({ formula: f.effect.formula, condition: conditionKey(f.condition), source: src })
  },

  speed_bonus: (f, lv, src, acc) => {
    const val = f.effect?.scaling ? resolveScaling(f.effect.scaling, lv) : f.effect?.value
    if (typeof val === 'number' && val > 0)
      acc.modifiers.push({ target: 'speed', value: val, condition: conditionKey(f.condition), source: src })
  },

  flying_speed: (f, _lv, src, acc) => {
    acc.modifiers.push({ target: 'flying_speed', value: f.effect?.flyingSpeedFormula ?? 'walking_speed', source: src })
  },

  extra_attack: (f, lv, src, acc) => {
    const val = f.effect?.scaling ? resolveScaling(f.effect.scaling, lv) : f.effect?.value
    if (typeof val === 'number')
      acc.modifiers.push({ target: 'extra_attack', value: val, source: src })
  },

  brutal_critical: (f, lv, src, acc) => {
    // 残忍重击(额外骰数) vs 精通重击(扩展重击范围)
    if (f.effect?.scaling) {
      const val = resolveScaling(f.effect.scaling, lv)
      if (typeof val === 'number' && val < 20) // 18/19 = crit range, 1/2/3 = extra dice
        acc.modifiers.push({ target: val >= 10 ? 'crit_range' : 'brutal_critical_dice', value: val, source: src })
    } else if (typeof f.effect?.value === 'number') {
      acc.modifiers.push({ target: f.effect.value < 20 ? 'crit_range' : 'brutal_critical_dice', value: f.effect.value, source: src })
    }
  },

  sneak_attack: (f, lv, src, acc) => {
    const dice = f.effect?.scaling ? resolveScaling(f.effect.scaling, lv) : null
    acc.classAbilities.push({
      id: f.id, name: f.name, nameEn: f.nameEn ?? '', type: 'sneak_attack',
      trigger: f.trigger, damage: dice, condition: f.condition,
      usesPerTurn: f.usesPerTurn, source: src,
    })
  },

  damage_reduction: (f, _lv, src, acc) => {
    acc.classAbilities.push({
      id: f.id, name: f.name, nameEn: f.nameEn ?? '', type: 'damage_reduction',
      trigger: f.trigger, condition: f.condition,
      actionType: typeof f.cost === 'string' && f.cost.includes('reaction') ? 'reaction' : undefined,
      source: src,
    })
  },

  evasion: (_f, _lv, src, acc) => {
    acc.ruleOverrides.push({ key: 'evasion', source: src })
  },

  saving_throw_bonus: (f, _lv, src, acc) => {
    // 护卫灵光等 — 使用 abilityModifier 或固定值
    if (f.effect?.abilityModifier)
      acc.modifiers.push({ target: 'all_saves', value: f.effect.abilityModifier, source: src })
    else if (typeof f.effect?.value === 'number')
      acc.modifiers.push({ target: 'all_saves', value: f.effect.value, source: src })
  },

  saving_throw_proficiency: (_f, _lv, src, acc) => {
    acc.proficiencyGrants.savingThrows.push('all')
    acc.ruleOverrides.push({ key: 'all_save_proficiency', source: src })
  },

  minimum_roll: (f, _lv, src, acc) => {
    acc.ruleOverrides.push({ key: `minimum_roll_${f.effect?.value ?? 10}`, source: src })
  },

  advantage_grant: (f, _lv, src, acc) => {
    // 统一提取：trigger + 条件
    const ctx = [f.trigger, f.condition?.savingThrowAbility, f.condition?.canSeeEffect ? 'visible_effect' : '']
      .filter(Boolean).join('_')
    acc.advantages.push({ context: ctx || f.id, source: src })
    // 附带的豁免优势（如精类血统的 charmed 豁免优势）
    if (Array.isArray(f.effect?.savingThrowAdvantage)) {
      for (const st of f.effect.savingThrowAdvantage)
        acc.advantages.push({ context: `save_vs_${st}`, source: src })
    }
  },

  advantage_deny: (_f, _lv, src, acc) => {
    acc.ruleOverrides.push({ key: 'deny_attack_advantage', source: src })
  },

  immunity: (f, _lv, src, acc) => {
    if (Array.isArray(f.effect?.immuneTo)) {
      for (const im of f.effect.immuneTo)
        acc.immunities.push({ immuneTo: im, source: src })
    }
    if (Array.isArray(f.effect?.savingThrowAdvantage)) {
      for (const st of f.effect.savingThrowAdvantage)
        acc.advantages.push({ context: `save_vs_${st}`, source: src })
    }
    if (Array.isArray(f.effect?.damageResistance)) {
      for (const dr of f.effect.damageResistance)
        acc.resistances.push({ damageType: dr, source: src })
    }
  },

  resistance: (f, _lv, src, acc) => {
    if (Array.isArray(f.effect?.damageResistance)) {
      for (const dr of f.effect.damageResistance)
        acc.resistances.push({ damageType: dr, source: src })
    }
    if (Array.isArray(f.effect?.resistTo)) {
      for (const dr of f.effect.resistTo)
        acc.resistances.push({ damageType: dr, source: src })
    }
    if (Array.isArray(f.effect?.savingThrowAdvantage)) {
      for (const st of f.effect.savingThrowAdvantage)
        acc.advantages.push({ context: `save_vs_${st}`, source: src })
    }
  },

  healing_bonus: (f, _lv, src, acc) => {
    if (typeof f.effect?.value === 'number')
      acc.modifiers.push({ target: 'healing_bonus', value: f.effect.value, source: src })
  },

  expertise: (f, _lv, src, acc) => {
    if (Array.isArray(f.effect?.skills))
      acc.proficiencyGrants.skills.push(...f.effect.skills.map((s: string) => `expertise:${s}`))
  },

  destroy_undead: (f, lv, src, acc) => {
    const cr = resolveScaling(f.effect?.scaling, lv)
    if (cr != null)
      acc.modifiers.push({ target: 'destroy_undead_cr', value: cr, source: src })
  },

  divine_strike: (f, lv, src, acc) => {
    const damage = f.effect?.scaling ? resolveScaling(f.effect.scaling, lv) : f.effect?.damage
    acc.classAbilities.push({
      id: f.id, name: f.name, nameEn: f.nameEn ?? '', type: 'divine_strike',
      trigger: f.trigger, damage, damageType: f.effect?.damageType,
      usesPerTurn: f.usesPerTurn, source: src,
    })
  },

  cantrip_damage_bonus: (f, _lv, src, acc) => {
    acc.modifiers.push({ target: 'cantrip_damage_bonus', value: f.effect?.abilityModifier ?? 'wisdom', source: src })
  },
}

// ── 职业/种族被动特性提取 ───────────────────────────

function extractPassiveFeatures(
  classId?: string, level?: number,
  subclassId?: string, raceId?: string, subraceId?: string,
  acc?: EffectAccumulator,
): void {
  if (!acc || (!classId && !raceId)) return
  const lv = level ?? 1

  for (const f of passiveFeatures) {
    if (!matchesCharacter(f, classId, subclassId, raceId, subraceId)) continue
    if (typeof f.level === 'number' && lv < f.level) continue

    const handler = PASSIVE_HANDLERS[f.type]
    if (!handler) continue // bonus_action 等由 featureEffectMiddleware 处理

    const isRace = !!(raceId && f.race?.includes(raceId)) || !!(subraceId && f.subrace?.includes(subraceId))
    const src: ModifierSource = { type: isRace ? 'race_feature' : 'class_feature', id: f.id, name: f.name }
    handler(f, lv, src, acc)
  }
}

// ── 主函数 ──────────────────────────────────────────

export function resolvePersistentEffects(input: PersistentEffectInput): ResolvedPersistentEffects {
  const { featIds, classId, level, subclassId, raceId, subraceId, featChoices } = input

  const combatOptions: CombatOption[] = []
  const combatTriggers: CombatTrigger[] = []
  const resources: FeatureResource[] = []
  let damageReduction: DamageReductionEffect | null = null

  const acc: EffectAccumulator = {
    modifiers: [], ruleOverrides: [], advantages: [],
    acFormulas: [], immunities: [], resistances: [], classAbilities: [],
    proficiencyGrants: { savingThrows: [], armor: [], weapons: [], skills: [], languages: 0, cantrips: 0 },
  }

  // 1. 专长效果
  for (const id of featIds) {
    const feat = feats[id]
    if (!feat) continue
    acc.modifiers.push(...extractFeatModifiers(id, feat))
    acc.advantages.push(...extractFeatAdvantages(id, feat))
    acc.ruleOverrides.push(...extractFeatRuleOverrides(id, feat))
    combatOptions.push(...extractFeatCombatOptions(id, feat))
    combatTriggers.push(...extractFeatCombatTriggers(id, feat))
    resources.push(...extractFeatResources(id, feat))
    const dr = extractFeatDamageReduction(id, feat)
    if (dr) damageReduction = dr
    mergeProficiencies(acc.proficiencyGrants, extractFeatProficiencies(id, feat, featChoices))
  }

  // 2. 职业/种族被动特性 — handler 注册表自动分发
  extractPassiveFeatures(classId, level, subclassId, raceId, subraceId, acc)

  return {
    modifiers: acc.modifiers,
    ruleOverrides: acc.ruleOverrides,
    combatOptions,
    combatTriggers,
    resources,
    advantages: acc.advantages,
    proficiencyGrants: acc.proficiencyGrants,
    damageReduction,
    acFormulas: acc.acFormulas,
    immunities: acc.immunities,
    resistances: acc.resistances,
    classAbilities: acc.classAbilities,
    hasCombatOptions: combatOptions.length > 0,
    hasCombatTriggers: combatTriggers.length > 0,
    hasResources: resources.length > 0,
  }
}

function mergeProficiencies(target: ProficiencyGrants, partial: Partial<ProficiencyGrants>) {
  if (partial.savingThrows) target.savingThrows.push(...partial.savingThrows)
  if (partial.armor) target.armor.push(...partial.armor)
  if (partial.weapons) target.weapons.push(...partial.weapons)
  if (partial.skills) target.skills.push(...partial.skills)
  if (partial.languages) target.languages += partial.languages
  if (partial.cantrips) target.cantrips += partial.cantrips
}

// ── 便捷查询 ─────────────────────────────────────────

/** 检查某个 rule_override 是否激活 */
export function hasRuleOverride(resolved: ResolvedPersistentEffects, key: string): boolean {
  return resolved.ruleOverrides.some(r => r.key === key)
}

/** 获取某个 target 的无条件修正值之和 */
export function getUnconditionalModifierSum(
  resolved: ResolvedPersistentEffects, target: string,
): number {
  let sum = 0
  for (const m of resolved.modifiers) {
    if (m.target === target && !m.condition && typeof m.value === 'number') sum += m.value
  }
  return sum
}

/** 获取某个 target 在给定条件集下的修正值之和 */
export function getConditionalModifierSum(
  resolved: ResolvedPersistentEffects, target: string, activeConditions: Set<string>,
): number {
  let sum = 0
  for (const m of resolved.modifiers) {
    if (m.target !== target || typeof m.value !== 'number') continue
    if (!m.condition || activeConditions.has(m.condition)) sum += m.value
  }
  return sum
}

/** 获取指定 trigger 类型的所有被动触发 */
export function getTriggersByType(
  resolved: ResolvedPersistentEffects, trigger: string,
): CombatTrigger[] {
  return resolved.combatTriggers.filter(t => t.trigger === trigger)
}
