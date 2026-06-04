/**
 * 功能中间件 — 纯函数，从法术定义解析出所有效果（参数 + 状态 + UI + 召唤）。
 *
 * 职责：
 *  1. 合并 spell.effects[] + castOptions[selectedOption].effects[]
 *  2. 扫描所有 phase 提取 UI 效果摘要
 *  3. 判断是否有机械化效果
 */
import type { Spell, TokenFilter } from '~/types/spell'
import type { EffectPhase, EffectPrimitive, ScalingConfig } from '~/types/spellEffect'

// ── 输出类型 ────────────────────────────────────────

/** UI 效果聚合摘要 */
export interface VisualEffectsSummary {
  tokenFilter: TokenFilter | null
  resizeToken: number | null           // size delta (+1/-1)
  disguise: boolean
  visibility: 'invisible' | 'ethereal' | null
  transformation: string | null        // transformType
  zoneVisual: string | null            // zoneType
  illusion: boolean
  teleport: { range: number; mode: string } | null
  movementMod: { movementType: string; operation: string } | null
  movementRestriction: string | null   // restriction type
  illumination: { lightType: string; brightRadius: number; dimRadius: number } | null
  summon: { instanceName: string; count?: number } | null
}

/** 升环缩放信息 */
export interface UpcastInfo {
  isUpcast: boolean
  levelsAbove: number
  /** 缩放后的伤害公式 (如有) */
  scaledDamageFormula: string | null
  /** 缩放后的治疗公式 (如有) */
  scaledHealingFormula: string | null
  /** 额外目标数 */
  extraTargets: number
  /** 升环临时HP加值 */
  extraTempHp: number
}

/** resolveSpellEffects 的完整输出 */
export interface ResolvedSpellEffects {
  /** 所有效果阶段，含来源标记 */
  phases: ResolvedEffectPhase[]
  /** UI 效果聚合摘要 */
  visualEffects: VisualEffectsSummary
  /** 是否有任何非 narrative 的机械化效果 */
  hasMechanicalEffects: boolean
  /** 非 narrative 的效果类型集合 */
  mechanicalTypes: Set<string>
  /** 升环缩放信息 */
  upcastInfo: UpcastInfo
}

export interface ResolvedEffectPhase extends EffectPhase {
  /** 'spell_effects' | 'cast_option' */
  source: string
}

// ── narrative-only 判断 ─────────────────────────────

const NARRATIVE_TYPES = new Set(['narrative'])

function isMechanical(effect: EffectPrimitive): boolean {
  return !NARRATIVE_TYPES.has(effect.type)
}

// ── 扫描 visual effects ─────────────────────────────

export function scanVisualEffects(phases: ResolvedEffectPhase[]): VisualEffectsSummary {
  const summary: VisualEffectsSummary = {
    tokenFilter: null,
    resizeToken: null,
    disguise: false,
    visibility: null,
    transformation: null,
    zoneVisual: null,
    illusion: false,
    teleport: null,
    movementMod: null,
    movementRestriction: null,
    illumination: null,
    summon: null,
  }

  for (const phase of phases) {
    for (const eff of phase.effects) {
      switch (eff.type) {
        case 'apply_token_filter':
          // 合并多个 filter（取第一个作为基础，后续覆盖）
          summary.tokenFilter = summary.tokenFilter
            ? { ...summary.tokenFilter, ...eff.filter }
            : { ...eff.filter }
          break
        case 'resize_token':
          summary.resizeToken = (summary.resizeToken ?? 0) + eff.sizeDelta
          break
        case 'set_disguise':
          summary.disguise = true
          break
        case 'set_visibility':
          summary.visibility = eff.mode
          break
        case 'apply_transformation':
          summary.transformation = eff.transformType
          break
        case 'create_zone_visual':
          summary.zoneVisual = eff.zoneType
          break
        case 'spawn_illusion':
          summary.illusion = true
          break
        case 'teleport':
          summary.teleport = { range: eff.range, mode: eff.mode }
          break
        case 'modify_movement':
          summary.movementMod = { movementType: eff.movementType, operation: eff.operation }
          break
        case 'restrict_movement':
          summary.movementRestriction = eff.restriction
          break
        case 'apply_illumination':
          summary.illumination = { lightType: eff.lightType, brightRadius: eff.brightRadius, dimRadius: eff.dimRadius }
          break
        case 'spawn_summon':
          summary.summon = { instanceName: eff.instanceName, count: eff.count }
          break
      }
    }
  }

  return summary
}

// ── 升环缩放扫描 ────────────────────────────────────

function scanUpcastInfo(
  phases: ResolvedEffectPhase[],
  spell: Spell,
  slotLevel?: number,
): UpcastInfo {
  const baseLevel = spell.level ?? 0
  const castLevel = slotLevel ?? baseLevel
  const levelsAbove = Math.max(0, castLevel - baseLevel)
  const info: UpcastInfo = {
    isUpcast: levelsAbove > 0,
    levelsAbove,
    scaledDamageFormula: null,
    scaledHealingFormula: null,
    extraTargets: 0,
    extraTempHp: 0,
  }
  if (levelsAbove <= 0) return info

  // 优先从 damageAtSlotLevel / healingAtSlotLevel 查表
  const tableDmg = spell.damageAtSlotLevel?.[String(castLevel)]
  const tableHeal = spell.healingAtSlotLevel?.[String(castLevel)]
  if (tableDmg) info.scaledDamageFormula = tableDmg
  if (tableHeal) info.scaledHealingFormula = tableHeal

  // 从 effect phases 中扫描 ScalingConfig
  for (const phase of phases) {
    const sc = phase.scaling as ScalingConfig | undefined
    if (!sc) continue
    const perSlot = sc.perSlotAbove ?? baseLevel
    const above = Math.max(0, castLevel - perSlot)
    if (above <= 0) continue

    if (sc.extraTargets) info.extraTargets += sc.extraTargets * above
    if (sc.extraValue) info.extraTempHp += sc.extraValue * above

    // 从 deal_damage / heal 公式推算
    if (!info.scaledDamageFormula) {
      for (const eff of phase.effects) {
        if (eff.type === 'deal_damage' && sc.extraDice) {
          info.scaledDamageFormula = applyScaling(eff.formula, sc.extraDice, above)
          break
        }
      }
    }
    if (!info.scaledHealingFormula) {
      for (const eff of phase.effects) {
        if (eff.type === 'heal' && (sc.extraDice || sc.extraValue)) {
          info.scaledHealingFormula = sc.extraDice
            ? applyScaling(eff.formula, sc.extraDice, above)
            : `${eff.formula}+${sc.extraValue! * above}`
          break
        }
      }
    }
  }

  return info
}

function applyScaling(base: string, extraDice: string, levels: number): string {
  const m = extraDice.match(/^(\d*)d(\d+)$/)
  if (m) {
    const count = (parseInt(m[1] || '1', 10)) * levels
    return `${base}+${count}d${m[2]}`
  }
  return base
}

// ── 主函数 ──────────────────────────────────────────

export function resolveSpellEffects(
  spell: Spell,
  selectedOption?: string | null,
  slotLevel?: number,
): ResolvedSpellEffects {
  const phases: ResolvedEffectPhase[] = []

  // 1. spell.effects[] — 基础效果
  if (Array.isArray(spell.effects)) {
    for (const phase of spell.effects) {
      phases.push({ ...phase, source: 'spell_effects' })
    }
  }

  // 2. castOptions[selectedOption].effects[] — 施法选项效果
  if (selectedOption && Array.isArray(spell.castOptions)) {
    const option = spell.castOptions.find(o => o.key === selectedOption)
    if (option?.effects) {
      for (const phase of option.effects) {
        phases.push({ ...phase, source: 'cast_option' })
      }
    }
  }

  // 3. 扫描所有 phase，提取机械化效果类型
  const mechanicalTypes = new Set<string>()
  let hasMechanical = false
  for (const phase of phases) {
    for (const eff of phase.effects) {
      if (isMechanical(eff)) {
        hasMechanical = true
        mechanicalTypes.add(eff.type)
      }
    }
  }

  // 5. 扫描 UI 效果摘要
  const visualEffects = scanVisualEffects(phases)

  // 6. 升环缩放信息
  const upcastInfo = scanUpcastInfo(phases, spell, slotLevel)

  return {
    phases,
    visualEffects,
    hasMechanicalEffects: hasMechanical,
    mechanicalTypes,
    upcastInfo,
  }
}
