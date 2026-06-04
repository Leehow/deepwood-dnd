/**
 * 特性动作中间件 — 纯函数，从战斗选项/触发 + 角色上下文
 * 推导 UI 描述符（能否使用、条件是否满足、禁用原因）。
 *
 * 与 spellCastMiddleware 对称：
 *   spellCastMiddleware     → 法术施放可行性 & UI 决策
 *   featureActionMiddleware  → 特性动作可行性 & UI 决策（本文件）
 */
import type {
  CombatOption,
  FeatureActionContext,
  FeatureActionDescriptor,
  FeatureDisabledReason,
  FeatureResource,
  ResolvedPersistentEffects,
} from '~/types/featureEffect'

// ── 条件 → 装备/状态检查 ────────────────────────────

const CONDITION_CHECKS: Record<string, (ctx: FeatureActionContext) => boolean> = {
  heavy_melee_weapon: ctx => ctx.weaponType === 'heavy_melee',
  ranged_weapon: ctx => ctx.weaponType === 'ranged',
  wielding_finesse_weapon: ctx => ctx.weaponType === 'finesse',
  wielding_polearm: ctx => ctx.weaponType === 'polearm',
  attacked_with_one_handed_weapon: ctx => ctx.weaponType === 'one_handed',
  dual_wielding: ctx => !!ctx.isDualWielding,
  grappling_creature: ctx => !!ctx.isGrappling,
  after_dash_10ft_straight: ctx => !!ctx.justDashed,
  has_healers_kit: ctx => !!ctx.hasHealersKit,
  has_shield: ctx => !!ctx.hasShield,
  after_attack_action: ctx => !!ctx.tookAttackAction,
}

/** 条件 key → 中文提示 */
const CONDITION_LABELS: Record<string, string> = {
  heavy_melee_weapon: '需要重型近战武器',
  ranged_weapon: '需要远程武器',
  wielding_finesse_weapon: '需要灵巧武器',
  wielding_polearm: '需要长柄武器',
  attacked_with_one_handed_weapon: '需要先使用单手武器攻击',
  dual_wielding: '需要双持武器',
  grappling_creature: '需要正在擒抱',
  after_dash_10ft_straight: '需要冲刺至少10尺直线',
  has_healers_kit: '需要治疗包',
  has_shield: '需要盾牌',
  after_attack_action: '需要先使用攻击动作',
}

/** actionType → 中文标签 */
const ACTION_TYPE_LABELS: Record<string, string> = {
  action: '动作',
  bonus_action: '附赠动作',
  reaction: '反应',
  '10_minutes': '10分钟',
}

// ── 主函数：战斗选项 UI 描述符 ──────────────────────

export function resolveFeatureActionUI(
  option: CombatOption,
  ctx: FeatureActionContext,
): FeatureActionDescriptor {
  const reasons: FeatureDisabledReason[] = []

  // 1. 条件检查
  let conditionsMet = true
  if (option.condition) {
    const checker = CONDITION_CHECKS[option.condition]
    if (checker && !checker(ctx)) {
      conditionsMet = false
      reasons.push({
        type: 'condition_not_met',
        detail: CONDITION_LABELS[option.condition] || option.condition,
      })
    }
  }

  // 2. 使用次数限制
  if (option.limit && ctx.usedThisTurn?.has(option.limit)) {
    reasons.push({ type: 'already_used', detail: formatLimitLabel(option.limit) })
  }

  return {
    canUse: reasons.length === 0,
    actionType: option.actionType,
    actionLabel: ACTION_TYPE_LABELS[option.actionType] || option.actionType,
    conditionsMet,
    conditionLabel: option.condition ? (CONDITION_LABELS[option.condition] || option.condition) : undefined,
    disabledReasons: reasons,
  }
}

// ── 资源型动作 UI 描述符 ─────────────────────────────

export function resolveResourceActionUI(
  resource: FeatureResource,
  ctx: FeatureActionContext,
): FeatureActionDescriptor {
  const reasons: FeatureDisabledReason[] = []
  const remaining = ctx.resourcesRemaining?.[resource.id] ?? 0
  const cost = typeof resource.max === 'number' ? 1 : 1

  if (remaining < cost) {
    reasons.push({ type: 'resource_exhausted', detail: `${resource.name}已耗尽` })
  }

  return {
    canUse: reasons.length === 0,
    actionType: 'action',
    actionLabel: '动作',
    resourceCost: { resourceId: resource.id, amount: cost },
    conditionsMet: true,
    disabledReasons: reasons,
  }
}

// ── 批量：从 resolved 中提取可用动作 ────────────────

export interface AvailableFeatureAction {
  option: CombatOption
  descriptor: FeatureActionDescriptor
}

/** 从完整效果栈中提取所有战斗选项及其可用性 */
export function getAvailableActions(
  resolved: ResolvedPersistentEffects,
  ctx: FeatureActionContext,
): AvailableFeatureAction[] {
  return resolved.combatOptions.map(option => ({
    option,
    descriptor: resolveFeatureActionUI(option, ctx),
  }))
}

/** 仅返回当前可用（canUse = true）的战斗选项 */
export function getUsableActions(
  resolved: ResolvedPersistentEffects,
  ctx: FeatureActionContext,
): AvailableFeatureAction[] {
  return getAvailableActions(resolved, ctx).filter(a => a.descriptor.canUse)
}

/** 按 actionType 分组返回可用动作 */
export function getActionsByType(
  resolved: ResolvedPersistentEffects,
  ctx: FeatureActionContext,
): Record<string, AvailableFeatureAction[]> {
  const all = getAvailableActions(resolved, ctx)
  const groups: Record<string, AvailableFeatureAction[]> = {}
  for (const a of all) {
    const key = a.option.actionType
    if (!groups[key]) groups[key] = []
    groups[key].push(a)
  }
  return groups
}

// ── 内部辅助 ─────────────────────────────────────────

function formatLimitLabel(limit: string): string {
  const labels: Record<string, string> = {
    once_per_creature_per_short_rest: '每个生物每次短休一次',
    once_per_turn: '每轮一次',
  }
  return labels[limit] || limit
}
