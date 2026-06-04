/**
 * 入口中间件 — 纯函数，从法术定义 + 角色状态推导完整施法 UI 描述符。
 *
 * 吸收了以下分散逻辑：
 *  - Rules_SpellDetail.tsx → analyzeSpellTargeting / isSelfCenteredAreaSpell
 *  - sidebarCasting.ts → requiresCastingInProgress / parseCastingTimeToSeconds
 *  - SpellCastActions.tsx → needsIllusionInput / isDisguiseSpell / castVerb / castDisabled
 */
import type { Spell } from '~/types/spell'
import type {
  SpellCastContext,
  SpellCastUIDescriptor,
  TargetingMode,
  CastDisabledReason,
} from '~/types/spellCastUI'
import { getAvailableSlotLevels, canCastSpell } from '~/utils/spellSlotUtils'

// ── area type 中文映射 ──────────────────────────────
const AREA_TYPE_NAMES: Record<string, string> = {
  sphere: '球形', cone: '锥形', cube: '方形', line: '线状', cylinder: '柱形',
}

// ── 内部: 目标分析 ──────────────────────────────────
function deriveTargeting(spell: Spell): {
  mode: TargetingMode
  label: string
  icon: string
  rangeLabel: string
  areaDetail: string | null
} {
  const range: string = spell.range || ''
  const area = spell.areaOfEffect

  // ① 自身出发方向性: "自身 15 尺锥状"
  const selfArea = range.match(/自身\s*(\d+)\s*尺\s*(.+)/)
  if (selfArea) {
    const shape = selfArea[2].replace(/状$/, '').replace(/形$/, '')
    return {
      mode: 'self_emanation',
      label: '范围', icon: '📐', rangeLabel: '自身出发',
      areaDetail: `${selfArea[1]}尺${shape}`,
    }
  }

  // ② 自身
  if (range === '自身') {
    if (area) {
      const shapeCn = AREA_TYPE_NAMES[area.type] || area.type || ''
      const maxPrefix = area.sizeIsMax ? '至多' : ''
      const areaType = String(area.type || '').toLowerCase()
      // cone/line 从自身出发 → emanation; 其它 → self_area
      const mode: TargetingMode = (areaType === 'cone' || areaType === 'line')
        ? 'self_emanation' : 'self_area'
      return {
        mode,
        label: '范围', icon: mode === 'self_area' ? '🔵' : '📐',
        rangeLabel: mode === 'self_area' ? '自身为中心' : '自身出发',
        areaDetail: `${maxPrefix}${area.size}尺${shapeCn}`,
      }
    }
    return { mode: 'self', label: '自身增益', icon: '👤', rangeLabel: '自身', areaDetail: null }
  }

  // ③ 触及
  if (range === '触及') {
    if (area) {
      const shapeCn = AREA_TYPE_NAMES[area.type] || area.type || ''
      const maxPrefix = area.sizeIsMax ? '至多' : ''
      return {
        mode: 'touch_area',
        label: '范围', icon: '📐', rangeLabel: '触及',
        areaDetail: `${maxPrefix}${area.size}尺${shapeCn}`,
      }
    }
    return { mode: 'touch', label: '单体', icon: '✋', rangeLabel: '触及', areaDetail: null }
  }

  // ④ 视野 / 无限 / 特殊
  if (range.includes('视野') || range.includes('无限') || range === '特殊') {
    if (area) {
      const shapeCn = AREA_TYPE_NAMES[area.type] || area.type || ''
      const maxPrefix = area.sizeIsMax ? '至多' : ''
      return {
        mode: 'area',
        label: '范围', icon: '📐', rangeLabel: range,
        areaDetail: `${maxPrefix}${area.size}尺${shapeCn}`,
      }
    }
    return { mode: 'special', label: '指定目标', icon: '🎯', rangeLabel: range, areaDetail: null }
  }

  // ⑤ 远程 + 区域
  if (area) {
    const shapeCn = AREA_TYPE_NAMES[area.type] || area.type || ''
    const maxPrefix = area.sizeIsMax ? '至多' : ''
    return {
      mode: 'area',
      label: '指定区域', icon: '📐', rangeLabel: range,
      areaDetail: `${maxPrefix}${area.size}尺${shapeCn}`,
    }
  }

  // ⑥ 远程单体
  return { mode: 'single_target', label: '指定目标', icon: '🎯', rangeLabel: range, areaDetail: null }
}

// ── 内部: 施法时间 → 秒 ──────────────────────────────
function parseCastingTimeToSeconds(castingTime: string | undefined): number {
  if (!castingTime) return 1
  const raw = castingTime.trim().toLowerCase()
  const match = raw.match(
    /(\d+)\s*(bonus action|bonus_action|reaction|action|round|rounds|minute|minutes|hour|hours|轮|分钟|小时)/,
  )
  if (match) {
    const value = parseInt(match[1], 10)
    const unit = match[2]
    if (unit === 'minute' || unit === 'minutes' || unit === '分钟') return value * 60
    if (unit === 'hour' || unit === 'hours' || unit === '小时') return value * 3600
    if (unit === 'round' || unit === 'rounds' || unit === '轮') return value * 6
    return 1
  }
  if (castingTime.includes('分钟')) return 60
  if (castingTime.includes('小时')) return 3600
  if (castingTime.includes('轮')) return 6
  return 1
}

// ── 内部: 幻象判断 ──────────────────────────────────
function checkNeedsIllusionInput(spell: Spell): boolean {
  const ill = spell.illusion
  if (!ill) return false
  if (!ill.types?.includes('visual')) return false
  const excluded = ['self_duplicate', 'mental', 'duplicates', 'quasi_real_creature']
  if (ill.subtype && excluded.includes(ill.subtype)) return false
  return true
}

function checkIsDisguiseSpell(spell: Spell): boolean {
  return spell.illusion?.subtype === 'appearance'
}

// ── 内部: 材料检查 ──────────────────────────────────
function checkHasMaterialComponent(spell: Spell): boolean {
  return (spell.components as string[] | undefined)?.includes('M') ?? false
}

function checkNeedsGpValidation(spell: Spell): boolean {
  return typeof spell.materialCost === 'number' && spell.materialCost > 0
}

// Detect spells whose only payload is a top-level `spawn_summon` leaf
// (e.g. Conjure Animals). These ship without `areaOfEffect`, so the default
// `deriveTargeting` flow routes them to `single_target` and the empty-ground
// placement path silently no-ops. Local helper avoids an upward import from
// `components/map/utils/mapAreaSpellCastPrelude.ts`; the two predicates must
// stay in sync.
function checkIsSummonSpell(spell: Spell): boolean {
  const phases = Array.isArray((spell as any).effects) ? (spell as any).effects : []
  for (const phase of phases) {
    const leaves = Array.isArray(phase?.effects) ? phase.effects : []
    for (const leaf of leaves) {
      if (leaf?.type === 'spawn_summon') return true
    }
  }
  return false
}

// Detect spells whose only mechanic is a self-teleport requiring a
// destination picker (e.g. Misty Step). These route through a dedicated
// map picker so a slot is never spent without the caster actually moving.
// Exported so dialogs that build `SpellCastData` manually (e.g. the
// legacy SpellsDialog spell-book) can stamp `targetingMode` correctly
// without duplicating the predicate. See Chrome QA 2026-05-28.
export function checkNeedsTeleportDestination(spell: Spell): boolean {
  const range = String((spell as any).range || '').trim()
  if (range !== '自身' && !range.startsWith('Self')) return false
  const effects = Array.isArray((spell as any).effects) ? (spell as any).effects : []
  for (const phase of effects) {
    const sub = Array.isArray(phase?.effects) ? phase.effects : []
    for (const leaf of sub) {
      if (leaf?.type !== 'teleport') continue
      const mode = String(leaf.mode || 'self').toLowerCase()
      const rangeFeet = Number(leaf.range || 0)
      if (mode === 'self' && rangeFeet > 0) return true
    }
  }
  return false
}

// ── 主函数 ──────────────────────────────────────────
export function resolveSpellCastUI(
  spell: Spell,
  ctx: SpellCastContext,
): SpellCastUIDescriptor {
  const spellLevel = spell.level ?? 0
  let targeting = deriveTargeting(spell)

  // 长施法 / 仪式 (提前到 targeting override 之前，让长施法的召唤系不被改写为 area 模式)
  const castSecondsEarly = parseCastingTimeToSeconds(spell.castingTime)
  const isLongCastEarly = castSecondsEarly >= 60

  // Summon spells (Conjure Animals 等) 没有 areaOfEffect，
  // 默认走 single_target，导致施法弹窗按钮变成"选择目标并施放"，
  // 空地落点路径在 castSpellAction 中也会被分发到 single 模式。
  // 这里把短时施法的召唤系改写为 area 模式，让 UI 给出范围选择并施放，
  // 同时由 sidebarCasting.spellToSpellOption 合成一个 5 尺球形 areaOfEffect
  // 让地图控制器不要回落到 20 尺默认值。长施法/仪式分支不在本切片范围内。
  if (
    targeting.mode === 'single_target' &&
    !isLongCastEarly &&
    checkIsSummonSpell(spell)
  ) {
    targeting = {
      mode: 'area',
      label: '指定区域',
      icon: '📐',
      rangeLabel: targeting.rangeLabel,
      areaDetail: '5尺球形',
    }
  }

  // Self-teleport spells (Misty Step): override the default `self` mode so
  // the cast button routes through the map destination picker instead of
  // silently consuming a slot. Long casts (e.g. ritual teleports) are not in
  // scope for this picker yet — keep them on their existing path.
  if (
    !isLongCastEarly &&
    (targeting.mode === 'self' || targeting.mode === 'self_area' || targeting.mode === 'self_emanation') &&
    checkNeedsTeleportDestination(spell)
  ) {
    targeting = {
      mode: 'teleport_destination',
      label: '指定位置',
      icon: '✨',
      rangeLabel: '30 尺内空格',
      areaDetail: null,
    }
  }

  // 按钮文案
  const castButtonText =
    targeting.mode === 'teleport_destination'
      ? '选择目的地并施放'
      : targeting.mode === 'self' || targeting.mode === 'self_area'
        ? '施放'
        : targeting.areaDetail
          ? '选择范围并施放'
          : '选择目标并施放'

  // 施法选项
  const castOptions = (spell.castOptions || []).map(o => ({ key: o.key, label: o.label }))
  const hasCastOptions = castOptions.length > 0

  // 材料
  const hasM = checkHasMaterialComponent(spell)
  const needsGp = checkNeedsGpValidation(spell)
  const materialText = spell.materials || null

  // 成分
  const hasV = (spell.components as string[] | undefined)?.includes('V') ?? false
  const hasS = (spell.components as string[] | undefined)?.includes('S') ?? false
  const blockedBySilence = hasV && ctx.isSilenced
  const blockedByNoFreeHand = hasS && !ctx.hasSomaticFreedom && ctx.equipMainHand && ctx.equipOffHand

  // 专注
  const isConcentration = !!spell.concentration
  const hasConcentrationConflict = !!ctx.concentrationSpellName

  // 长施法 / 仪式 (复用 targeting override 阶段已算出的 castSeconds)
  const castSeconds = castSecondsEarly
  const isLongCast = isLongCastEarly
  const canRitualCast = !!spell.ritual && spellLevel > 0 && !ctx.isInvocationFree
  const isRitualLongCast = canRitualCast && (castSeconds + 600) >= 60

  // 幻象
  const needsIllusion = checkNeedsIllusionInput(spell)
  const isDisguise = checkIsDisguiseSpell(spell)
  const illusionRequired = isDisguise && needsIllusion

  // 区域大小
  const aoe = spell.areaOfEffect
  const canChooseAreaSize = !!(aoe && aoe.sizeIsMax && aoe.size > 5)

  // 升环 & 法术位
  const showUpcastSelector = spellLevel > 0 && !ctx.isWarlock && !ctx.isInvocationFree
  const maxArr = ctx.maxSlotsArray ?? []
  const remArr = ctx.remainingSlotsArray ?? []
  const availableLevels = getAvailableSlotLevels(spellLevel, maxArr, remArr)
  const hasAnySlots = spellLevel <= 0 || ctx.isInvocationFree || canCastSpell(spellLevel, remArr, maxArr)
  const slotLabel = ctx.isWarlock ? '契约位' : '法术位'

  // 禁用原因
  const reasons: CastDisabledReason[] = []
  if (blockedBySilence) reasons.push({ type: 'silenced' })
  if (blockedByNoFreeHand) reasons.push({ type: 'no_free_hand' })
  if (hasM && !ctx.hasMaterialAvailable) reasons.push({ type: 'material_missing' })
  if (hasM && ctx.hasMaterialAvailable && !ctx.materialSelected) reasons.push({ type: 'material_not_selected' })
  if (illusionRequired && !ctx.hasIllusionImage) reasons.push({ type: 'disguise_no_image' })
  if (hasCastOptions && !ctx.selectedOptionKey) reasons.push({ type: 'option_not_selected' })
  if (ctx.castingSpellName) reasons.push({ type: 'casting_in_progress', spellName: ctx.castingSpellName })
  if (!hasAnySlots && !ctx.isInvocationFree) reasons.push({ type: 'no_slots_available' })

  return {
    castButtonText,
    targetingMode: targeting.mode,
    targetingLabel: targeting.label,
    targetingIcon: targeting.icon,
    rangeLabel: targeting.rangeLabel,
    areaDetail: targeting.areaDetail,

    hasCastOptions,
    castOptions,
    requiresOptionSelection: hasCastOptions,

    hasMaterialComponent: hasM,
    needsGpValidation: needsGp,
    materialText,

    blockedBySilence,
    blockedByNoFreeHand,

    isConcentration,
    hasConcentrationConflict,

    isLongCast,
    canRitualCast,
    isRitualLongCast,

    needsIllusionInput: needsIllusion,
    isDisguiseSpell: isDisguise,
    illusionRequired,

    canChooseAreaSize,
    areaSizeMax: aoe?.size ?? 5,
    areaSizeMin: 5,
    areaType: aoe?.type ?? null,

    showUpcastSelector,
    baseSpellLevel: spellLevel,
    availableSlotLevels: availableLevels,
    hasAnySlots,
    slotLabel,

    castDisabledReasons: reasons,
    isCastDisabled: reasons.length > 0,

    showDmForceCast: ctx.isDM && reasons.length > 0,
  }
}
