/**
 * useOnHitFeaturePrompt — 攻击命中后弹出触发型特性选择
 *
 * 监听 combatAttackResult 事件，当命中且攻击者有 on_hit 特性可用时，
 * 发布 promptOnHitFeature 事件，由 UI 层（TacticalMap）消费展示选择面板。
 */
import { useEffect, useCallback } from 'react'
import {
  subscribeAppEvent,
  publishAppEvent,
  type CombatAttackResultEventPayload,
} from '~/events/appEventBus'
import { filterFeaturesForCharacter } from '~/utils/featureEffectMiddleware'
import { getAllTriggeredFeatures } from '~/hooks/useTriggeredFeatures'

interface CharacterLookup {
  getCharacterData: (tokenId: number) => {
    characterId: number
    name: string
    classId: string
    subclassId?: string | null
    level: number
    resources: Record<string, { current: number; max: number }>
  } | null
}

/**
 * Hook: 监听攻击结果，命中时检查是否有 on_hit 特性可触发
 */
export function useOnHitFeaturePrompt(lookup: CharacterLookup) {
  const allFeatures = getAllTriggeredFeatures()

  const handleAttackResult = useCallback(
    (payload: CombatAttackResultEventPayload) => {
      const { result } = payload
      if (!result.hit || !result.attacker_token_id) return

      const charData = lookup.getCharacterData(result.attacker_token_id)
      if (!charData) return

      // 筛选该角色可用的 on_hit 特性
      const onHitFeatures = filterFeaturesForCharacter(
        allFeatures,
        charData.classId,
        charData.subclassId ?? null,
        charData.level,
      ).filter(f => f.trigger === 'on_hit' && f.execution !== 'custom')

      if (onHitFeatures.length === 0) return

      // 检查是否有至少一个特性有足够资源
      const hasUsable = onHitFeatures.some(f => {
        if (f.cost.spellSlot) return true
        const pool = charData.resources[f.cost.resourceId]
        return pool && pool.current >= f.cost.amount
      })

      if (!hasUsable) return

      publishAppEvent('promptOnHitFeature', {
        attackerTokenId: result.attacker_token_id,
        attackerName: result.attacker_name,
        attackerCharacterId: charData.characterId,
        targetTokenId: result.target_token_id ?? 0,
        targetName: result.target_name,
        classId: charData.classId,
        subclassId: charData.subclassId,
        level: charData.level,
        resources: charData.resources,
        hit: true,
        critical: result.critical,
      })
    },
    [allFeatures, lookup],
  )

  useEffect(() => {
    return subscribeAppEvent('combatAttackResult', handleAttackResult)
  }, [handleAttackResult])
}
