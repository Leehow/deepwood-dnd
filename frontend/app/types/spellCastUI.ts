/**
 * 入口中间件类型定义
 *
 * resolveSpellCastUI(spell, ctx) 的输入/输出类型。
 * 组件只读取 descriptor 做渲染，不再自行推导施法 UI 逻辑。
 */
import type { SlotLevelInfo } from '~/utils/spellSlotUtils'

// ── 目标模式 ─────────────────────────────────────────
export type TargetingMode =
  | 'self'              // 自身增益，无区域
  | 'self_area'         // 自身为中心区域 (sphere/cylinder centered on self)
  | 'self_emanation'    // 自身出发的方向性区域 (cone/line from self)
  | 'touch'             // 触及单体
  | 'touch_area'        // 触及区域
  | 'single_target'     // 远程单体
  | 'area'              // 远程区域
  | 'special'           // 视野/无限/特殊
  | 'teleport_destination' // 自身传送 (Misty Step) — 在地图上选择目的地格

// ── 施放禁用原因 ────────────────────────────────────
export type CastDisabledReason =
  | { type: 'silenced' }
  | { type: 'no_free_hand' }
  | { type: 'material_missing' }
  | { type: 'material_not_selected' }
  | { type: 'disguise_no_image' }
  | { type: 'option_not_selected' }
  | { type: 'casting_in_progress'; spellName: string }
  | { type: 'no_slots_available' }

// ── 施法 UI 描述符 (输出) ────────────────────────────
export interface SpellCastUIDescriptor {
  // 按钮文案
  castButtonText: string             // "施放" | "选择目标并施放" | "选择范围并施放"

  // 目标模式
  targetingMode: TargetingMode
  targetingLabel: string             // "自身增益" | "单体" | "范围" | "指定目标" | "指定区域"
  targetingIcon: string              // "👤" | "🎯" | "📐" | "🔵" | "✋"
  rangeLabel: string                 // "自身" | "30 尺" | "触及" | "自身出发"
  areaDetail: string | null          // "20尺球形" | null

  // 施法选项 (e.g. 变巨/缩小)
  hasCastOptions: boolean
  castOptions: { key: string; label: string }[]
  requiresOptionSelection: boolean

  // 材料
  hasMaterialComponent: boolean
  needsGpValidation: boolean         // materialCost > 0
  materialText: string | null

  // 成分警告
  blockedBySilence: boolean          // V + 沉默
  blockedByNoFreeHand: boolean       // S + 双手满

  // 专注
  isConcentration: boolean
  hasConcentrationConflict: boolean  // 已有专注法术

  // 长施法 / 仪式
  isLongCast: boolean                // 施法时间 >= 1 分钟
  canRitualCast: boolean             // ritual && level > 0 && !freecast
  isRitualLongCast: boolean          // ritual 总是长施法

  // 幻象
  needsIllusionInput: boolean        // visual 幻象需要图片输入
  isDisguiseSpell: boolean           // appearance subtype
  illusionRequired: boolean          // disguise + needsIllusion → 图片必须

  // 区域大小选择
  canChooseAreaSize: boolean         // sizeIsMax && size > 5
  areaSizeMax: number
  areaSizeMin: number
  areaType: string | null            // "sphere" | "cone" etc.

  // 升环 & 法术位
  showUpcastSelector: boolean        // level > 0 && !warlock && !freecast
  baseSpellLevel: number
  availableSlotLevels: SlotLevelInfo[] // 可选环位（含剩余位信息）
  hasAnySlots: boolean               // 是否有任何可用法术位
  slotLabel: string                  // "法术位" | "契约位"

  // 禁用状态
  castDisabledReasons: CastDisabledReason[]
  isCastDisabled: boolean

  // DM
  showDmForceCast: boolean
}

// ── 施法上下文 (输入) ────────────────────────────────
export interface SpellCastContext {
  // 角色状态
  isSilenced: boolean
  hasSomaticFreedom: boolean            // 战斗施法者专长等
  equipMainHand: boolean                // 主手有物品
  equipOffHand: boolean                 // 副手有物品

  // 材料
  hasMaterialAvailable: boolean         // 有可用材料
  materialSelected: boolean             // 已选中材料

  // 法术位
  selectedCastLevel: number
  remainingSlots: number                // 当前选中等级的剩余位
  maxSlotsArray: number[]               // 各环最大法术位 [0..9]
  remainingSlotsArray: number[]         // 各环剩余法术位 [0..9]

  // 专注
  concentrationSpellName: string | null // 当前专注法术名

  // 施法中
  castingSpellName: string | null       // 正在施法的法术名

  // 职业
  isWarlock: boolean
  isInvocationFree: boolean             // at-will 邪术师唤魔

  // 幻象
  hasIllusionImage: boolean             // 已选中幻象图片

  // 施法选项
  selectedOptionKey: string | null      // 当前选中的 castOption key

  // DM
  isDM: boolean
}
