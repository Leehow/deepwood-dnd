/**
 * ReactionButtons - 在战斗聊天消息下方显示可用反应按钮
 * 当玩家角色是攻击目标时，根据触发场景筛选匹配的反应
 * 同时支持 triggered-features.json 定义的反应型特性（回击、辛辣嘲讽等）
 */
import { useState } from 'react';
import { publishAppEvent } from '~/events/appEventBus';
import { filterReactionsByTrigger, getCombatMessageTrigger, type ReactionDefinition } from '~/utils/reactionRegistry';
import { apiFetch } from '~/utils/api-client';
import type { TriggeredFeatureDefinition } from '~/types/triggeredFeature';
import { resolveFeatureEffects } from '~/utils/featureEffectMiddleware';

interface ReactionButtonsProps {
  messageDbId?: number;
  messageMeta?: Record<string, any>;
  myTokenId: number | null;
  availableReactions: ReactionDefinition[];
  isReactionUsed: boolean;
  campaignId: string;
  onReactionUsed: () => void;
  /** 触发型反应特性（回击、辛辣嘲讽等），由父组件通过 useTriggeredFeatures 筛选 */
  triggeredReactions?: TriggeredFeatureDefinition[];
  /** 角色数据（用于 resolve） */
  reactorName?: string;
  reactorLevel?: number;
  reactorResources?: Record<string, { current: number; max: number }>;
}

export function ReactionButtons({
  messageDbId,
  messageMeta,
  myTokenId,
  availableReactions,
  isReactionUsed,
  campaignId,
  onReactionUsed,
  triggeredReactions = [],
  reactorName,
  reactorLevel,
  reactorResources,
}: ReactionButtonsProps) {
  const [loading, setLoading] = useState<string | null>(null);

  if (!messageMeta || !myTokenId || isReactionUsed) return null;

  // Only show for attack/spell combat messages
  const combatType = messageMeta.combat_type;
  if (combatType !== 'attack' && combatType !== 'spell' && combatType !== 'area_spell') return null;

  // Determine trigger type
  const trigger = getCombatMessageTrigger(messageMeta);
  if (!trigger) return null;

  // Source-caster token id for on_spell_cast (Counterspell etc.)
  const sourceCasterTokenId =
    messageMeta.caster_token_id ?? messageMeta.attacker_token_id ?? null;

  if (trigger === 'on_spell_cast') {
    // Counterspell / on-cast reactions: triggered by ANOTHER creature casting,
    // not by being the target. Hide for the caster themselves.
    if (sourceCasterTokenId != null && sourceCasterTokenId === myTokenId) return null;
  } else {
    // Attack-style reactions still require being the attack target.
    const targetTokenId = messageMeta.target_token_id;
    if (targetTokenId !== myTokenId) return null;
  }

  // Filter standard reactions matching this trigger
  const matchingReactions = filterReactionsByTrigger(availableReactions, trigger);

  // Filter triggered reaction features matching combat context
  const isHit = messageMeta.hit;
  const isMiss = messageMeta.hit === false;
  const matchingTriggered = triggeredReactions.filter(f => {
    // on_enemy_miss（回击）→ 只在未命中时显示
    if (f.trigger === 'on_enemy_miss') return isMiss;
    // on_enemy_roll（辛辣嘲讽）→ 任何投骰后
    if (f.trigger === 'on_enemy_roll') return true;
    // on_reaction → 命中时
    if (f.trigger === 'on_reaction') return isHit;
    return false;
  }).filter(f => {
    // 检查资源是否足够
    if (f.cost.spellSlot) return true;
    const pool = reactorResources?.[f.cost.resourceId];
    return pool && pool.current >= f.cost.amount;
  });

  if (matchingReactions.length === 0 && matchingTriggered.length === 0) return null;

  const handleReaction = async (reaction: ReactionDefinition) => {
    setLoading(reaction.id);
    try {
      const body: Record<string, any> = {
        campaign_id: parseInt(campaignId),
        reactor_token_id: myTokenId,
        reaction_id: reaction.id,
        category: reaction.category,
        original_chat_message_id: messageDbId,
      };
      if (reaction.requiresSpellSlot) {
        body.spell_slot_level = reaction.spellLevel || 1;
      }
      // For on_spell_cast (Counterspell): target = the source caster token.
      // For attack reactions (riposte, etc.): target = the attacker token.
      const reactionTargetId =
        trigger === 'on_spell_cast'
          ? sourceCasterTokenId ?? messageMeta.attacker_token_id ?? null
          : messageMeta.attacker_token_id ?? null;
      if (reactionTargetId != null) {
        body.target_token_id = reactionTargetId;
      }

      const resp = await apiFetch(
        `/api/combat/reaction`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (resp.ok) {
        onReactionUsed();
        publishAppEvent("combatActionUsed", { type: "reaction" });
      }
    } catch (e) {
      console.error('[ReactionButtons] Failed to use reaction:', e);
    } finally {
      setLoading(null);
    }
  };

  const handleTriggeredReaction = (feature: TriggeredFeatureDefinition) => {
    if (!reactorName || !reactorLevel || !reactorResources) return;
    setLoading(feature.id);

    const resolved = resolveFeatureEffects(feature, {
      casterName: reactorName,
      casterLevel: reactorLevel,
      targetName: messageMeta.attacker_name || '',
      resources: reactorResources,
    });

    publishAppEvent('triggeredFeatureUsed', {
      featureId: feature.id,
      sourceName: reactorName,
      targetName: messageMeta.attacker_name || '',
      chatMessage: resolved.chatMessages.activate || '',
      resourceId: feature.cost.resourceId,
      amount: feature.cost.amount,
    });

    onReactionUsed();
    publishAppEvent("combatActionUsed", { type: "reaction" });
    setLoading(null);
  };

  return (
    <div className="mt-1.5 flex items-center gap-1 flex-wrap">
      <span className="text-[10px] text-blue-400 font-medium">⚡ 反应:</span>
      {matchingReactions.map((r) => (
        <button
          key={r.id}
          disabled={loading !== null}
          onClick={() => handleReaction(r)}
          className="px-1.5 py-0.5 text-[10px] rounded border border-blue-500/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
        >
          {loading === r.id ? '...' : `${r.icon} ${r.name}`}
        </button>
      ))}
      {matchingTriggered.map((f) => (
        <button
          key={f.id}
          disabled={loading !== null}
          onClick={() => handleTriggeredReaction(f)}
          className="px-1.5 py-0.5 text-[10px] rounded border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
        >
          {loading === f.id ? '...' : `${f.ui.icon} ${f.name}`}
        </button>
      ))}
    </div>
  );
}
