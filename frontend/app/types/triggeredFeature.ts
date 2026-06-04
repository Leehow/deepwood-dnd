/**
 * Triggered Feature types — 触发型职业技能的统一类型定义
 *
 * 复用 spellEffect.ts 的 EffectPhase / EffectPrimitive，
 * 新增资源消耗、聊天模板、UI 提示配置。
 */
import type { EffectPhase, TriggerType } from './spellEffect'

// ── 扩展触发类型（职业特性专用）──────────────────────
export type FeatureTriggerType =
  | TriggerType
  | 'on_activate'        // 主动使用（回气、闪避）
  | 'on_enemy_miss'      // 敌方攻击未命中（回击）
  | 'on_enemy_roll'      // 敌方投骰后（辛辣嘲讽）

// ── 资源消耗 ─────────────────────────────────────────
export interface ResourceCost {
  resourceId: string      // 对应 class_resources.json 的 id
  amount: number          // 消耗数量
  /** true = 消耗法术位（神圣惩击） */
  spellSlot?: boolean
  minSlotLevel?: number
  /** 变量消耗（圣疗 = 用户指定量） */
  variable?: boolean
}

// ── 聊天消息模板 ─────────────────────────────────────
export interface ChatTemplates {
  /** 使用时（必有） */
  activate: string
  /** 目标豁免失败 */
  save_fail?: string
  /** 目标豁免成功 */
  save_success?: string
  /** 通用结果 */
  result?: string
}

// ── UI 提示配置 ──────────────────────────────────────
export type PromptType =
  | 'quick_use'           // 一键使用（回气、闪避）
  | 'on_hit_confirm'      // 命中后确认（震慑打击、神圣惩击）
  | 'reaction_prompt'     // 反应提示（回击、辛辣嘲讽）
  | 'pre_roll'            // 投骰前选择（预言骰）
  | 'target_select'       // 需选目标（圣疗、鼓舞）

export interface UIPromptConfig {
  promptType: PromptType
  icon: string
  color: string
}

// ── 主定义 ───────────────────────────────────────────
export interface TriggeredFeatureDefinition {
  id: string
  name: string
  nameEn: string
  description?: string
  class: string[]
  subclass?: string[]
  level: number
  trigger: FeatureTriggerType
  actionType: 'action' | 'bonus_action' | 'reaction' | 'none'
  cost: ResourceCost
  phases: EffectPhase[]
  ui: UIPromptConfig
  chat: ChatTemplates
  /** 骰子随等级成长，如优势骰 { "3": "d8", "10": "d10", "18": "d12" } */
  diceScaling?: Record<string, string>
  /** custom = 需要专用处理器（预言骰、野性变形等） */
  execution?: 'standard' | 'custom'
}

// ── 解析上下文 ───────────────────────────────────────
export interface FeatureResolveContext {
  casterName: string
  casterLevel: number
  targetName?: string
  dc?: number
  /** 角色当前资源池 { ki: { current: 3, max: 5 }, ... } */
  resources: Record<string, { current: number; max: number }>
  /** 额外模板变量 { value: "15", die_result: "8" } */
  extraVars?: Record<string, string>
}

// ── 解析输出 ─────────────────────────────────────────
export interface ResolvedFeatureEffects {
  feature: TriggeredFeatureDefinition
  phases: Array<EffectPhase & { source: string }>
  hasMechanicalEffects: boolean
  mechanicalTypes: Set<string>
  resourceCheck: { resourceId: string; amount: number; sufficient: boolean }
  chatMessages: Record<string, string>
  /** 当前等级对应的骰子大小（如 "d10"） */
  resolvedDie: string | null
}
