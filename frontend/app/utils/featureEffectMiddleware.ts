/**
 * 触发型职业特性中间件 — 纯函数管道
 *
 * 职责：
 *  1. 校验资源是否充足
 *  2. 根据等级解析骰子大小
 *  3. 合并 EffectPhase 并检测机械/视觉效果
 *  4. 填充聊天消息模板
 *
 * 与 spellEffectMiddleware 共享 scanVisualEffects。
 */
import type { EffectPhase } from '~/types/spellEffect'
import type {
  TriggeredFeatureDefinition,
  FeatureResolveContext,
  ResolvedFeatureEffects,
} from '~/types/triggeredFeature'
import { scanVisualEffects, type ResolvedEffectPhase } from './spellEffectMiddleware'

// ── 骰子大小解析 ─────────────────────────────────────

/** 根据 diceScaling 和角色等级，返回当前应使用的骰子（如 "d10"） */
export function resolveDieSize(
  diceScaling: Record<string, string> | undefined,
  level: number,
): string | null {
  if (!diceScaling) return null
  let current: string | null = null
  const entries = Object.entries(diceScaling).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  )
  for (const [lvl, die] of entries) {
    if (level >= Number(lvl)) current = die
  }
  return current
}

// ── 资源校验 ─────────────────────────────────────────

function checkResource(
  cost: TriggeredFeatureDefinition['cost'],
  resources: FeatureResolveContext['resources'],
): ResolvedFeatureEffects['resourceCheck'] {
  // 法术位消耗由调用方单独管理
  if (cost.spellSlot) {
    return { resourceId: 'spell_slots', amount: cost.amount, sufficient: true }
  }
  const pool = resources[cost.resourceId]
  return {
    resourceId: cost.resourceId,
    amount: cost.amount,
    sufficient: pool ? pool.current >= cost.amount : false,
  }
}

// ── 模板填充 ─────────────────────────────────────────

function fillTemplate(
  template: string,
  ctx: FeatureResolveContext,
  resolvedDie: string | null,
): string {
  let msg = template
    .replace(/\{source\}/g, ctx.casterName)
    .replace(/\{target\}/g, ctx.targetName ?? '')
    .replace(/\{dc\}/g, ctx.dc != null ? String(ctx.dc) : '?')
  if (resolvedDie) {
    msg = msg.replace(/\{die\}/g, resolvedDie)
  }
  // extra variables from caller
  if (ctx.extraVars) {
    for (const [k, v] of Object.entries(ctx.extraVars)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), v)
    }
  }
  return msg
}

function buildChatMessages(
  chat: TriggeredFeatureDefinition['chat'],
  ctx: FeatureResolveContext,
  resolvedDie: string | null,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, tmpl] of Object.entries(chat)) {
    if (typeof tmpl === 'string') {
      out[key] = fillTemplate(tmpl, ctx, resolvedDie)
    }
  }
  return out
}

// ── 公式中的 {die} 替换 ─────────────────────────────

/** 将 phase 内 effect formula 中的 {die} 替换为实际骰子 */
function resolveFormulaDie(
  phases: ResolvedEffectPhase[],
  die: string | null,
): ResolvedEffectPhase[] {
  if (!die) return phases
  return phases.map(phase => ({
    ...phase,
    effects: phase.effects.map(eff => {
      if ('formula' in eff && typeof (eff as any).formula === 'string') {
        return { ...eff, formula: (eff as any).formula.replace(/\{die\}/g, die) }
      }
      return eff
    }),
  }))
}

// ── 主函数 ───────────────────────────────────────────

export function resolveFeatureEffects(
  feature: TriggeredFeatureDefinition,
  ctx: FeatureResolveContext,
): ResolvedFeatureEffects {
  // 1. 解析骰子大小
  const resolvedDie = resolveDieSize(feature.diceScaling, ctx.casterLevel)

  // 2. 构建 phases（标记来源 + 替换 {die}）
  const rawPhases: ResolvedEffectPhase[] = feature.phases.map(p => ({
    ...p,
    source: 'class_feature',
  }))
  const phases = resolveFormulaDie(rawPhases, resolvedDie)

  // 3. 资源校验
  const resourceCheck = checkResource(feature.cost, ctx.resources)

  // 4. 扫描机械效果类型
  const mechanicalTypes = new Set<string>()
  let hasMechanical = false
  for (const phase of phases) {
    for (const eff of phase.effects) {
      if (eff.type !== 'narrative') {
        hasMechanical = true
        mechanicalTypes.add(eff.type)
      }
    }
  }

  // 5. 填充聊天消息模板
  const chatMessages = buildChatMessages(feature.chat, ctx, resolvedDie)

  return {
    feature,
    phases,
    hasMechanicalEffects: hasMechanical,
    mechanicalTypes,
    resourceCheck,
    chatMessages,
    resolvedDie,
  }
}

// ── 辅助：按 trigger 筛选特性 ───────────────────────

/** 从特性列表中筛选匹配角色职业/子职/等级的特性 */
export function filterFeaturesForCharacter(
  features: TriggeredFeatureDefinition[],
  classId: string,
  subclassId: string | null,
  level: number,
): TriggeredFeatureDefinition[] {
  return features.filter(f => {
    if (!f.class.includes(classId)) return false
    if (f.subclass && subclassId && !f.subclass.includes(subclassId)) return false
    if (f.subclass && !subclassId) return false
    return level >= f.level
  })
}

/** 按触发类型分组 */
export function groupByTrigger(
  features: TriggeredFeatureDefinition[],
): Record<string, TriggeredFeatureDefinition[]> {
  const groups: Record<string, TriggeredFeatureDefinition[]> = {}
  for (const f of features) {
    const key = f.trigger
    if (!groups[key]) groups[key] = []
    groups[key].push(f)
  }
  return groups
}
