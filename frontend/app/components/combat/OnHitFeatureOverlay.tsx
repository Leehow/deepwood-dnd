/**
 * OnHitFeatureOverlay — 攻击命中后的触发型特性选择浮层
 *
 * 监听 promptOnHitFeature 事件，弹出可用 on_hit 特性列表。
 * 用户选择后展示 AbilityPrompt 确认。
 */
import { useState, useEffect, useCallback } from 'react'
import {
  subscribeAppEvent,
  publishAppEvent,
  type PromptOnHitFeatureEventPayload,
} from '~/events/appEventBus'
import type { TriggeredFeatureDefinition, ResolvedFeatureEffects } from '~/types/triggeredFeature'
import { resolveFeatureEffects, filterFeaturesForCharacter } from '~/utils/featureEffectMiddleware'
import { getAllTriggeredFeatures } from '~/hooks/useTriggeredFeatures'
import { AbilityPicker, AbilityPrompt } from './AbilityPrompt'

export function OnHitFeatureOverlay() {
  const [eventData, setEventData] = useState<PromptOnHitFeatureEventPayload | null>(null)
  const [availableFeatures, setAvailableFeatures] = useState<TriggeredFeatureDefinition[]>([])
  const [selectedFeature, setSelectedFeature] = useState<TriggeredFeatureDefinition | null>(null)
  const [resolved, setResolved] = useState<ResolvedFeatureEffects | null>(null)
  const [loading, setLoading] = useState(false)
  const [resultText, setResultText] = useState<string | null>(null)

  useEffect(() => {
    return subscribeAppEvent('promptOnHitFeature', (payload) => {
      const allFeatures = getAllTriggeredFeatures()
      const onHitFeatures = filterFeaturesForCharacter(
        allFeatures,
        payload.classId,
        payload.subclassId ?? null,
        payload.level,
      ).filter(f => {
        if (f.trigger !== 'on_hit' || f.execution === 'custom') return false
        if (f.cost.spellSlot) return true
        const pool = payload.resources[f.cost.resourceId]
        return pool && pool.current >= f.cost.amount
      })

      if (onHitFeatures.length > 0) {
        setEventData(payload)
        setAvailableFeatures(onHitFeatures)
        setSelectedFeature(null)
        setResolved(null)
        setResultText(null)
      }
    })
  }, [])

  const handleClose = useCallback(() => {
    setEventData(null)
    setAvailableFeatures([])
    setSelectedFeature(null)
    setResolved(null)
    setResultText(null)
  }, [])

  const handleSelect = useCallback((feature: TriggeredFeatureDefinition) => {
    if (!eventData) return
    const result = resolveFeatureEffects(feature, {
      casterName: eventData.attackerName,
      casterLevel: eventData.level,
      targetName: eventData.targetName,
      resources: eventData.resources,
    })
    setSelectedFeature(feature)
    setResolved(result)
  }, [eventData])

  const handleConfirm = useCallback(() => {
    if (!selectedFeature || !resolved || !eventData) return
    setLoading(true)

    // 发布特性使用事件（由父层处理实际效果执行和资源扣减）
    publishAppEvent('triggeredFeatureUsed', {
      featureId: selectedFeature.id,
      sourceName: eventData.attackerName,
      targetName: eventData.targetName,
      chatMessage: resolved.chatMessages.activate || '',
      resourceId: selectedFeature.cost.resourceId,
      amount: selectedFeature.cost.amount,
    })

    setResultText(resolved.chatMessages.result || resolved.chatMessages.activate || '已使用')
    setLoading(false)
  }, [selectedFeature, resolved, eventData])

  // 未选择具体特性 → 展示特性列表
  if (eventData && !selectedFeature) {
    return (
      <AbilityPicker
        isOpen={true}
        onClose={handleClose}
        features={availableFeatures}
        onSelect={handleSelect}
        title={`${eventData.attackerName} 命中 ${eventData.targetName} — 可用特性`}
      />
    )
  }

  // 已选择 → 展示确认弹窗
  if (selectedFeature && resolved) {
    return (
      <AbilityPrompt
        isOpen={true}
        onClose={handleClose}
        feature={selectedFeature}
        resolved={resolved}
        onConfirm={handleConfirm}
        loading={loading}
        resultText={resultText ?? undefined}
      />
    )
  }

  return null
}
