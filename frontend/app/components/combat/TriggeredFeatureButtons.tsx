/**
 * TriggeredFeatureButtons — 在 SelectionContextMenu 中渲染触发型职业特性
 *
 * 显示 on_activate 类型的特性按钮（回气、疾风连击、踏风步等）。
 * 点击后弹出 AbilityPrompt 确认。
 */
import { useState } from 'react'
import type { TriggeredFeatureDefinition, ResolvedFeatureEffects } from '~/types/triggeredFeature'
import { resolveFeatureEffects, filterFeaturesForCharacter } from '~/utils/featureEffectMiddleware'
import { getAllTriggeredFeatures } from '~/hooks/useTriggeredFeatures'
import { AbilityPrompt } from './AbilityPrompt'

interface TriggeredFeatureButtonsProps {
  classId: string
  subclassId?: string | null
  level: number
  characterName: string
  resources: Record<string, { current: number; max: number }>
  /** 触发类型过滤（默认 on_activate） */
  triggerFilter?: string
  /** 确认使用后的回调 */
  onUse: (feature: TriggeredFeatureDefinition, resolved: ResolvedFeatureEffects) => void
  onClose: () => void
}

const ACTION_BADGES: Record<string, { label: string; color: string }> = {
  action: { label: '动作', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  bonus_action: { label: '附赠', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' },
  reaction: { label: '反应', color: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
  none: { label: '', color: '' },
}

export function TriggeredFeatureButtons({
  classId,
  subclassId,
  level,
  characterName,
  resources,
  triggerFilter = 'on_activate',
  onUse,
  onClose,
}: TriggeredFeatureButtonsProps) {
  const [promptFeature, setPromptFeature] = useState<TriggeredFeatureDefinition | null>(null)
  const [resolved, setResolved] = useState<ResolvedFeatureEffects | null>(null)
  const [expanded, setExpanded] = useState(false)

  const allFeatures = getAllTriggeredFeatures()
  const available = filterFeaturesForCharacter(allFeatures, classId, subclassId ?? null, level)
    .filter(f => f.trigger === triggerFilter && f.execution !== 'custom')

  if (available.length === 0) return null

  const handleClick = (feature: TriggeredFeatureDefinition) => {
    const result = resolveFeatureEffects(feature, {
      casterName: characterName,
      casterLevel: level,
      resources,
    })
    // quick_use 且资源足够 → 直接使用，不弹窗
    if (feature.ui.promptType === 'quick_use' && result.resourceCheck.sufficient) {
      onUse(feature, result)
      onClose()
      return
    }
    setPromptFeature(feature)
    setResolved(result)
  }

  const handleConfirm = () => {
    if (promptFeature && resolved) {
      onUse(promptFeature, resolved)
      setPromptFeature(null)
      setResolved(null)
      onClose()
    }
  }

  return (
    <>
      <div
        className="px-3 py-1.5 flex items-center gap-2 text-xs text-indigo-400 bg-indigo-900/20 cursor-pointer hover:bg-indigo-900/30"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex-1">触发型特性</span>
        <span className="text-indigo-500">{expanded ? '▼' : '▶'} {available.length}项</span>
      </div>

      {expanded && available.map(f => {
        const pool = resources[f.cost.resourceId]
        const remaining = pool?.current ?? 0
        const insufficient = !f.cost.spellSlot && (!pool || pool.current < f.cost.amount)
        const badge = ACTION_BADGES[f.actionType]

        return (
          <button
            key={f.id}
            onClick={() => handleClick(f)}
            disabled={insufficient}
            className="w-full px-3 py-2 flex items-center gap-2 hover:bg-gray-700/40 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="text-base">{f.ui.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-200">{f.name}</div>
              <div className="text-xs text-gray-500 truncate">{f.nameEn}</div>
            </div>
            {badge.label && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.color}`}>
                {badge.label}
              </span>
            )}
            {!f.cost.spellSlot && (
              <span className={`text-xs ${insufficient ? 'text-red-400' : 'text-gray-500'}`}>
                {remaining}/{pool?.max ?? '?'}
              </span>
            )}
          </button>
        )
      })}

      {/* AbilityPrompt for non-quick-use features */}
      {promptFeature && resolved && (
        <AbilityPrompt
          isOpen={true}
          onClose={() => { setPromptFeature(null); setResolved(null) }}
          feature={promptFeature}
          resolved={resolved}
          onConfirm={handleConfirm}
        />
      )}
    </>
  )
}
