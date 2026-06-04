/**
 * AbilityPrompt — 触发型职业特性统一提示组件
 *
 * 根据 feature.ui.promptType 渲染不同交互模式：
 *  - quick_use:       底部简洁确认条
 *  - on_hit_confirm:  命中后确认弹窗
 *  - reaction_prompt: 反应提示弹窗
 *  - pre_roll:        投骰前选择
 *  - target_select:   需选目标
 */
import { createPortal } from 'react-dom'
import type { TriggeredFeatureDefinition, ResolvedFeatureEffects } from '~/types/triggeredFeature'

export interface AbilityPromptProps {
  isOpen: boolean
  onClose: () => void
  feature: TriggeredFeatureDefinition
  resolved: ResolvedFeatureEffects
  onConfirm: () => void
  loading?: boolean
  /** 可选：展示结果后的内容 */
  resultText?: string
}

// ── 资源名映射 ───────────────────────────────────────

const RESOURCE_NAMES: Record<string, string> = {
  ki: '气',
  second_wind: '回气',
  action_surge: '行动如潮',
  superiority_dice: '战技骰',
  bardic_inspiration: '激励骰',
  channel_divinity_cleric: '引导神力',
  channel_divinity_paladin: '引导神力',
  lay_on_hands: '圣疗',
  spell_slots: '法术位',
  sorcery_points: '术法点',
}

function getResourceLabel(resourceId: string): string {
  return RESOURCE_NAMES[resourceId] ?? resourceId
}

// ── 动作类型标签 ─────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  action: '动作',
  bonus_action: '附赠动作',
  reaction: '反应',
  none: '',
}

// ── 主组件 ───────────────────────────────────────────

export function AbilityPrompt({
  isOpen,
  onClose,
  feature,
  resolved,
  onConfirm,
  loading = false,
  resultText,
}: AbilityPromptProps) {
  if (!isOpen) return null

  const { ui, chat, cost } = feature
  const { resourceCheck, resolvedDie } = resolved
  const sufficient = resourceCheck.sufficient

  // 根据 promptType 选择定位方式
  const isBottom = ui.promptType === 'quick_use' || ui.promptType === 'reaction_prompt'
  const containerClass = isBottom
    ? 'fixed inset-0 bg-black/40 z-[10400] flex items-end justify-center pb-24'
    : 'fixed inset-0 bg-black/50 z-[10400] flex items-center justify-center p-4'

  // 边框颜色跟随特性配色
  const borderColor = `border-[${ui.color}]`
  // 使用安全的 opacity 写法
  const borderStyle = { borderColor: `${ui.color}66` }
  const shadowStyle = { boxShadow: `0 4px 12px ${ui.color}1a` }

  return createPortal(
    <div className={containerClass} onClick={onClose}>
      <div
        className="bg-gray-800 rounded-lg border shadow-lg p-4 w-full max-w-sm"
        style={{ ...borderStyle, ...shadowStyle }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: icon + name + action type */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">{ui.icon}</span>
          <span className="font-semibold text-gray-100">{feature.name}</span>
          <span className="text-xs text-gray-400 ml-1">({feature.nameEn})</span>
          {ACTION_LABELS[feature.actionType] && (
            <span className="text-xs text-gray-500 ml-auto">
              {ACTION_LABELS[feature.actionType]}
            </span>
          )}
        </div>

        {/* Cost + Resource info */}
        <div className="flex items-center justify-between text-sm mb-3">
          <span className="text-gray-400">
            消耗: <span className={sufficient ? 'text-white' : 'text-red-400'}>
              {cost.variable ? '自定' : cost.amount} {getResourceLabel(cost.resourceId)}
            </span>
          </span>
          {!cost.spellSlot && (
            <span className="text-gray-500">
              剩余: {resolved.resourceCheck.sufficient ? '充足' : '不足'}
            </span>
          )}
          {resolvedDie && (
            <span className="text-gray-500">
              骰子: <span className="text-gray-300">{resolvedDie}</span>
            </span>
          )}
        </div>

        {/* Chat preview (activate message) */}
        {resolved.chatMessages.activate && (
          <p className="text-sm text-gray-300 mb-3 bg-gray-900/50 rounded px-3 py-2">
            {resolved.chatMessages.activate}
          </p>
        )}

        {/* Result display (after execution) */}
        {resultText ? (
          <div className="bg-gray-900 rounded p-3 text-center space-y-2">
            <div className="text-gray-200">{resultText}</div>
            <button
              onClick={onClose}
              className="mt-2 px-4 py-1.5 rounded text-sm bg-gray-700 text-gray-300 hover:bg-gray-600"
            >
              关闭
            </button>
          </div>
        ) : (
          /* Action buttons */
          <div className="flex gap-2">
            <button
              onClick={onConfirm}
              disabled={loading || !sufficient}
              className="flex-1 px-3 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: `${ui.color}33`,
                color: ui.color,
                borderWidth: 1,
                borderColor: `${ui.color}66`,
              }}
            >
              {loading
                ? '执行中...'
                : `使用${feature.name}${resolvedDie ? ` (${resolvedDie})` : ''}`}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-2 rounded text-sm bg-gray-700 text-gray-400 hover:bg-gray-600"
            >
              {ui.promptType === 'reaction_prompt' ? '跳过' : '取消'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ── 多特性选择面板（命中后多个可用特性时） ──────────

export interface AbilityPickerProps {
  isOpen: boolean
  onClose: () => void
  features: TriggeredFeatureDefinition[]
  onSelect: (feature: TriggeredFeatureDefinition) => void
  title?: string
}

export function AbilityPicker({
  isOpen,
  onClose,
  features,
  onSelect,
  title = '可用特性',
}: AbilityPickerProps) {
  if (!isOpen || features.length === 0) return null

  return createPortal(
    <div
      className="fixed inset-0 bg-black/40 z-[10400] flex items-end justify-center pb-24"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg border border-gray-600 shadow-lg p-4 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm text-gray-400 mb-3">{title}</div>
        <div className="space-y-2">
          {features.map((f) => (
            <button
              key={f.id}
              onClick={() => onSelect(f)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-600 hover:border-gray-400 hover:bg-gray-700/50 transition-colors text-left"
            >
              <span className="text-lg">{f.ui.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-200">{f.name}</div>
                <div className="text-xs text-gray-500">{f.nameEn}</div>
              </div>
              {ACTION_LABELS[f.actionType] && (
                <span className="text-xs text-gray-500 shrink-0">
                  {ACTION_LABELS[f.actionType]}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-3 w-full px-3 py-2 rounded text-sm bg-gray-700 text-gray-400 hover:bg-gray-600"
        >
          跳过
        </button>
      </div>
    </div>,
    document.body,
  )
}
