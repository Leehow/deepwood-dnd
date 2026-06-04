/**
 * 法术位纯函数工具库 — 统一法术位计算、消耗、升环预览。
 *
 * 抽取自 campaign.$id.dm.tsx 和 useCharacterSpellcasting.ts 中的重复逻辑，
 * 供前端所有法术位相关场景共用。
 */
import spellcastingConfig from '~/data/rules/spellcasting.json'
import type { Spell } from '~/types/spell'

// ── 类型 ─────────────────────────────────────────────

/** 法术位状态: 简单数组 或 带 pact_slots 的对象(术士) */
export type SpellSlotsStateLike =
  | number[]
  | { slots?: number[]; pact_slots?: number[]; [k: string]: unknown }
  | null
  | undefined

export type SpellcasterType = 'full' | 'half' | 'pact' | 'third'

export interface SlotLevelInfo {
  level: number
  max: number
  remaining: number
  isUpcast: boolean        // level > spell base level
  levelsAbove: number      // distance from base level
}

export interface UpcastPreview {
  damage: string | null          // 缩放后伤害公式 e.g. "9d6"
  healing: string | null         // 缩放后治疗公式
  baseDamage: string | null      // 基础伤害
  baseHealing: string | null
  description: string | null     // atHigherLevels 文本
  levelsAbove: number
}

// ── 基础工具 ─────────────────────────────────────────

/** 将任意值标准化为长度 10 的法术位数组 (index 0-9) */
export function normalizeSpellSlotArray(values: unknown): number[] {
  const slots = new Array(10).fill(0)
  if (!Array.isArray(values)) return slots
  for (let i = 0; i < Math.min(values.length, 10); i++) {
    const raw = values[i]
    const v = typeof raw === 'number' ? raw : Number(raw ?? 0)
    slots[i] = Number.isFinite(v) ? Math.max(0, v) : 0
  }
  return slots
}

// ── 最大法术位 ───────────────────────────────────────

/** 根据职业/等级/子职业计算最大法术位数组 [0..9] */
export function getMaxSpellSlots(
  classId: string,
  level: number,
  subclassId?: string | null,
): number[] {
  const cfg = spellcastingConfig as any

  if (classId === 'warlock') {
    const pactCfg = cfg?.pactMagic?.warlock || {}
    const slots = new Array(10).fill(0)
    // 术士契约魔法表按等级查找(向下匹配最近的)
    let entry: any = null
    for (let lv = level; lv >= 1; lv--) {
      if (pactCfg[String(lv)]) { entry = pactCfg[String(lv)]; break }
    }
    if (entry && typeof entry.slots === 'number') {
      const slotLevel = entry.level ?? 1
      if (slotLevel >= 1 && slotLevel <= 9) {
        slots[slotLevel] = entry.slots
      }
    }
    return slots
  }

  const isThirdCaster =
    (classId === 'fighter' && subclassId === 'eldritch_knight') ||
    (classId === 'rogue' && subclassId === 'arcane_trickster')

  // 非施法者职业（无子职业施法）→ 全零
  const fullCasters = ['wizard', 'cleric', 'druid', 'sorcerer', 'bard']
  const halfCasters = ['paladin', 'ranger']
  if (!isThirdCaster && !fullCasters.includes(classId) && !halfCasters.includes(classId)) {
    return new Array(10).fill(0)
  }

  const tableKey = isThirdCaster
    ? 'thirdCaster'
    : halfCasters.includes(classId) ? 'halfCaster' : 'fullCaster'

  const table = cfg?.slotTables?.[tableKey] || {}
  const raw: number[] = table[String(level)] || []
  const slots = [0, ...raw]
  while (slots.length < 10) slots.push(0)
  return slots
}

/** 推导施法者类型 */
export function getSpellcasterType(
  classId: string,
  subclassId?: string | null,
): SpellcasterType | null {
  const isSubclassCaster =
    (classId === 'fighter' && subclassId === 'eldritch_knight') ||
    (classId === 'rogue' && subclassId === 'arcane_trickster')
  if (isSubclassCaster) return 'third'
  if (classId === 'warlock') return 'pact'
  if (classId === 'paladin' || classId === 'ranger') return 'half'
  // 已知全施法者职业
  const fullCasters = ['wizard', 'cleric', 'druid', 'sorcerer', 'bard']
  if (fullCasters.includes(classId)) return 'full'
  return null
}

// ── 剩余法术位解析 ───────────────────────────────────

/** 从持久化状态 + 最大位 → 各环剩余位 */
export function getRemainingSlots(
  state: SpellSlotsStateLike,
  maxSlots: number[],
): number[] {
  if (Array.isArray(state)) {
    const normalized = normalizeSpellSlotArray(state)
    return maxSlots.map((max, i) => Math.min(max, Math.max(0, normalized[i] ?? 0)))
  }

  if (state && typeof state === 'object') {
    const regular = normalizeSpellSlotArray(state.slots)
    const pact = normalizeSpellSlotArray(state.pact_slots)
    return maxSlots.map((max, i) => Math.min(max, Math.max(0, Math.max(regular[i] ?? 0, pact[i] ?? 0))))
  }

  return maxSlots.slice()
}

// ── 法术位消耗 ───────────────────────────────────────

/** 消耗指定环位法术位，返回新状态。不可消耗时返回原状态（引用相同） */
export function consumeSpellSlotState(
  state: SpellSlotsStateLike,
  level: number,
  fallbackMaxSlots: number[],
): SpellSlotsStateLike {
  if (level <= 0 || level >= 10) return state

  if (Array.isArray(state) || state == null) {
    const next = normalizeSpellSlotArray(Array.isArray(state) ? state : fallbackMaxSlots)
    if ((next[level] ?? 0) <= 0) return state
    next[level] -= 1
    return next
  }

  const regular = normalizeSpellSlotArray(state.slots)
  const pact = normalizeSpellSlotArray(state.pact_slots)
  if ((regular[level] ?? 0) > 0) {
    regular[level] -= 1
  } else if ((pact[level] ?? 0) > 0) {
    pact[level] -= 1
  } else {
    return state
  }

  return { ...state, slots: regular, pact_slots: pact }
}

// ── 可用环位 ─────────────────────────────────────────

/** 给定法术基础环位 + 法术位表 → 可施放的所有环位信息 */
export function getAvailableSlotLevels(
  spellLevel: number,
  maxSlots: number[],
  remainingSlots: number[],
): SlotLevelInfo[] {
  if (spellLevel <= 0) return [] // 戏法不消耗法术位
  const levels: SlotLevelInfo[] = []
  for (let lv = spellLevel; lv <= 9; lv++) {
    const max = maxSlots[lv] ?? 0
    if (max <= 0) continue
    levels.push({
      level: lv,
      max,
      remaining: remainingSlots[lv] ?? 0,
      isUpcast: lv > spellLevel,
      levelsAbove: lv - spellLevel,
    })
  }
  return levels
}

/** 是否有至少一个可用法术位能施放此法术 */
export function canCastSpell(
  spellLevel: number,
  remainingSlots: number[],
  maxSlots: number[],
): boolean {
  if (spellLevel <= 0) return true // 戏法
  for (let lv = spellLevel; lv <= 9; lv++) {
    if ((maxSlots[lv] ?? 0) > 0 && (remainingSlots[lv] ?? 0) > 0) return true
  }
  return false
}

// ── 升环预览 ─────────────────────────────────────────

/** 计算升环后的伤害/治疗预览 */
export function resolveUpcastPreview(
  spell: Spell,
  castLevel: number,
): UpcastPreview {
  const baseLevel = spell.level ?? 0
  const levelsAbove = Math.max(0, castLevel - baseLevel)

  const baseDamage = spell.damageAtSlotLevel?.[String(baseLevel)] ?? spell.damage ?? null
  const baseHealing = spell.healingAtSlotLevel?.[String(baseLevel)] ?? spell.healing ?? null

  // 从 damageAtSlotLevel / healingAtSlotLevel 表直接查
  const tableDamage = spell.damageAtSlotLevel?.[String(castLevel)] ?? null
  const tableHealing = spell.healingAtSlotLevel?.[String(castLevel)] ?? null

  // 升环描述
  const desc = levelsAbove > 0 ? (spell.atHigherLevels ?? null) : null

  if (levelsAbove === 0) {
    return { damage: baseDamage, healing: baseHealing, baseDamage, baseHealing, description: null, levelsAbove: 0 }
  }

  // 优先用预定义表
  if (tableDamage || tableHealing) {
    return {
      damage: tableDamage ?? baseDamage,
      healing: tableHealing ?? baseHealing,
      baseDamage, baseHealing, description: desc, levelsAbove,
    }
  }

  // 从 effect phases 的 ScalingConfig 推算
  const scaling = findFirstScaling(spell)
  if (scaling && baseDamage) {
    const scaledDamage = applyScalingFormula(baseDamage, scaling, levelsAbove)
    return { damage: scaledDamage, healing: baseHealing, baseDamage, baseHealing, description: desc, levelsAbove }
  }
  if (scaling && baseHealing) {
    const scaledHealing = applyScalingFormula(baseHealing, scaling, levelsAbove)
    return { damage: baseDamage, healing: scaledHealing, baseDamage, baseHealing, description: desc, levelsAbove }
  }

  return { damage: baseDamage, healing: baseHealing, baseDamage, baseHealing, description: desc, levelsAbove }
}

// ── 内部: scaling 计算 ───────────────────────────────

interface ScalingLike {
  extraDice?: string
  extraValue?: number
}

function findFirstScaling(spell: Spell): ScalingLike | null {
  if (!Array.isArray(spell.effects)) return null
  for (const phase of spell.effects) {
    if (phase.scaling) return phase.scaling as ScalingLike
  }
  return null
}

/** 将 "8d6" + scaling "1d6" × levelsAbove → "8d6+2d6" */
function applyScalingFormula(
  base: string,
  scaling: ScalingLike,
  levelsAbove: number,
): string {
  if (levelsAbove <= 0) return base

  if (scaling.extraDice) {
    const m = scaling.extraDice.match(/^(\d*)d(\d+)$/)
    if (m) {
      const count = (parseInt(m[1] || '1', 10)) * levelsAbove
      const sides = m[2]
      return `${base}+${count}d${sides}`
    }
  }

  if (scaling.extraValue) {
    const bonus = scaling.extraValue * levelsAbove
    return `${base}+${bonus}`
  }

  return base
}
