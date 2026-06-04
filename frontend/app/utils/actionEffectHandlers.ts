/**
 * Data-driven action effect handlers.
 * Each handler corresponds to an ActionEffectType declared in effects.json.
 * TacticalMap calls executeActionEffect() instead of per-action if-else.
 */

import type { EffectDefinition, ActiveEffect } from '~/types/effects';
import { getEffectDefinition } from '~/hooks/useEffectSystem';
import { publishAppEvent } from "~/events/appEventBus";

/** Context the caller must provide */
export interface ActionEffectContext {
  sourceTokenId: number;
  sourceName: string;
  targetTokenId?: number;
  targetName?: string;
  /** current token status effects keyed by token id */
  tokenStatusEffects: Record<number, ActiveEffect[]>;
  /** set status effects state */
  setTokenStatusEffects: (fn: (prev: Record<number, ActiveEffect[]>) => Record<number, ActiveEffect[]>) => void;
  /** persist effects to backend */
  persistEffects: (tokenId: number, effects: ActiveEffect[]) => Promise<void>;
  /** send websocket chat message */
  sendChatMessage: (message: string) => void;
  /** show UI toast */
  showToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  /** close the context menu */
  closeMenu: () => void;
  /** action type to consume (default: 'action') */
  consumeActionType?: 'action' | 'bonus_action' | 'free';
  // ─── Class feature fields (optional) ───
  /** character level for formula evaluation */
  characterLevel?: number;
  /** source token data (needs current_hp, max_hp, avatar, character_id) */
  sourceToken?: Record<string, any>;
  /** update tokens state (for HP changes) */
  setTokens?: (fn: (prev: any[]) => any[]) => void;
  /** show floating damage/heal number */
  showDamageNumber?: (params: any) => void;
  /** show character bubble */
  showCharacterBubble?: (params: any) => void;
  /** persist HP change to backend */
  persistHp?: (tokenId: number, hp: number) => Promise<void>;
}

function buildChatMessage(template: string, ctx: ActionEffectContext, extraValues?: Record<string, string>): string {
  let msg = template
    .replace(/\{source\}/g, ctx.sourceName)
    .replace(/\{target\}/g, ctx.targetName || '');
  if (extraValues) {
    for (const [k, v] of Object.entries(extraValues)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return msg;
}

function createActiveEffect(def: EffectDefinition): ActiveEffect {
  let duration: number | undefined;
  let maxDuration: number | undefined;
  if (def.duration?.rounds) {
    duration = def.duration.rounds;
    maxDuration = def.duration.rounds;
  } else if (def.duration?.minutes) {
    duration = def.duration.minutes * 10;
    maxDuration = def.duration.minutes * 10;
  }
  return {
    id: def.id,
    instanceId: `${def.id}_${Date.now()}`,
    name: def.name,
    icon: def.visual.icon,
    color: def.visual.color,
    duration,
    maxDuration,
  };
}

function consumeAction(type: 'action' | 'bonus_action' | 'free' = 'action') {
  if (type !== 'free') {
    publishAppEvent("combatActionUsed", { type });
  }
}

function dispatchBonusActionResult(ctx: ActionEffectContext, def: EffectDefinition) {
  publishAppEvent("combatBonusActionResult", {
    tokenId: ctx.sourceTokenId,
    tokenName: ctx.sourceName,
    actionName: def.name,
    actionIcon: def.visual.icon,
  });
}

// ─── self_buff ───────────────────────────────────────────────
function handleSelfBuff(def: EffectDefinition, ctx: ActionEffectContext) {
  const current = ctx.tokenStatusEffects[ctx.sourceTokenId] || [];
  if (current.some(e => e.id === def.id)) {
    ctx.showToast(`${ctx.sourceName} 已处于${def.name}状态`, 'info');
    ctx.closeMenu();
    return;
  }
  // Only add persistent effect if it has duration
  if (def.duration) {
    const newEffect = createActiveEffect(def);
    const updated = [...current, newEffect];
    ctx.setTokenStatusEffects(prev => ({ ...prev, [ctx.sourceTokenId]: updated }));
    ctx.persistEffects(ctx.sourceTokenId, updated);
  }
  ctx.sendChatMessage(buildChatMessage(def.actionEffect!.chatTemplate, ctx));
  const actionType = ctx.consumeActionType || 'action';
  consumeAction(actionType);
  if (actionType === 'bonus_action') dispatchBonusActionResult(ctx, def);
  ctx.showToast(`${ctx.sourceName} ${def.name}`, 'info');
  ctx.closeMenu();
}

// ─── movement_bonus ──────────────────────────────────────────
function handleMovementBonus(def: EffectDefinition, ctx: ActionEffectContext) {
  const currentMax = (window as any).__combatMovementMax ?? 30;
  ctx.sendChatMessage(buildChatMessage(def.actionEffect!.chatTemplate, ctx, { value: String(currentMax) }));
  consumeAction(ctx.consumeActionType || 'action');
  publishAppEvent("combatActionUsed", { type: 'dash', amount: currentMax });
  (window as any).__combatDashedThisTurn = true;
  ctx.showToast(`${ctx.sourceName} ${def.name}！移动力 +${currentMax}尺`, 'info');
  ctx.closeMenu();
}

// ─── ally_buff ───────────────────────────────────────────────
function handleAllyBuff(def: EffectDefinition, ctx: ActionEffectContext) {
  if (!ctx.targetTokenId) {
    ctx.showToast('请先选择要协助的目标', 'error');
    return;
  }
  const targetCurrent = ctx.tokenStatusEffects[ctx.targetTokenId] || [];
  if (targetCurrent.some(e => e.id === def.id)) {
    ctx.showToast(`目标已有${def.name}效果`, 'info');
    ctx.closeMenu();
    return;
  }
  const newEffect = createActiveEffect(def);
  newEffect.source = ctx.sourceName;
  const updated = [...targetCurrent, newEffect];
  ctx.setTokenStatusEffects(prev => ({ ...prev, [ctx.targetTokenId!]: updated }));
  ctx.persistEffects(ctx.targetTokenId, updated);
  ctx.sendChatMessage(buildChatMessage(def.actionEffect!.chatTemplate, ctx));
  const actionType = ctx.consumeActionType || 'action';
  consumeAction(actionType);
  if (actionType === 'bonus_action') dispatchBonusActionResult(ctx, def);
  ctx.showToast(`${ctx.sourceName} 协助 ${ctx.targetName}`, 'info');
  ctx.closeMenu();
}

// ─── check_then_buff ─────────────────────────────────────────
function handleCheckThenBuff(def: EffectDefinition, ctx: ActionEffectContext) {
  ctx.sendChatMessage(buildChatMessage(def.actionEffect!.chatTemplate, ctx));
  consumeAction(ctx.consumeActionType || 'action');
  ctx.showToast(`${ctx.sourceName} ${def.name}`, 'info');
  ctx.closeMenu();
}

// ─── narrative ───────────────────────────────────────────────
function handleNarrative(def: EffectDefinition, ctx: ActionEffectContext) {
  ctx.sendChatMessage(buildChatMessage(def.actionEffect!.chatTemplate, ctx));
  consumeAction(ctx.consumeActionType || 'action');
  ctx.showToast(`${ctx.sourceName} ${def.name}`, 'info');
  ctx.closeMenu();
}

// ─── instant_heal ────────────────────────────────────────────
function handleInstantHeal(def: EffectDefinition, ctx: ActionEffectContext) {
  const level = ctx.characterLevel || 1;
  const token = ctx.sourceToken;
  if (!token) {
    ctx.showToast('缺少角色数据', 'error');
    return;
  }

  // Parse formula "1d10+level" → roll dice + add level
  const formula = def.actionEffect!.healFormula || '1d10+level';
  const diceMatch = formula.match(/(\d+)d(\d+)/);
  let diceTotal = 0;
  let diceStr = '';
  if (diceMatch) {
    const [, count, sides] = diceMatch;
    const rolls: number[] = [];
    for (let i = 0; i < Number(count); i++) {
      rolls.push(Math.floor(Math.random() * Number(sides)) + 1);
    }
    diceTotal = rolls.reduce((a, b) => a + b, 0);
    diceStr = `${count}d${sides}(${rolls.join('+')})`;
  }
  const levelBonus = formula.includes('level') ? level : 0;
  const healingAmount = diceTotal + levelBonus;
  const rollDetail = levelBonus > 0
    ? `${diceStr} + ${levelBonus}(等级) = **${healingAmount}**`
    : `${diceStr} = **${healingAmount}**`;

  // Calculate HP
  const currentHP = token.current_hp ?? 0;
  const maxHP = token.max_hp ?? currentHP;
  const newHP = Math.min(currentHP + healingAmount, maxHP);
  const actualHealing = newHP - currentHP;

  // Update token HP
  ctx.setTokens?.(prev => prev.map((t: any) =>
    t.id === ctx.sourceTokenId ? { ...t, current_hp: newHP } : t
  ));

  // Show floating heal number
  if (actualHealing > 0 && ctx.showDamageNumber) {
    ctx.showDamageNumber({
      targetTokenId: ctx.sourceTokenId,
      damage: actualHealing,
      hit: true, critical: false, fumble: false, heal: true,
    });
  }

  // Persist HP
  ctx.persistHp?.(ctx.sourceTokenId, newHP);

  // Build and send chat message
  const hpSuffix = actualHealing < healingAmount ? ' (已满)' : '';
  ctx.sendChatMessage(buildChatMessage(def.actionEffect!.chatTemplate, ctx, {
    rollDetail: `${rollDetail} 点治疗`,
    hpBefore: String(currentHP),
    hpAfter: String(newHP),
    hpMax: String(maxHP),
  }));

  // Character bubble
  if (token.character_id && ctx.showCharacterBubble) {
    ctx.showCharacterBubble({
      characterId: token.character_id,
      characterName: ctx.sourceName,
      message: `${def.visual.icon} ${def.name}！恢复 ${actualHealing} HP (${currentHP}→${newHP})`,
      type: 'combat',
      avatarUrl: token.avatar ?? undefined,
    });
  }

  const actionType = ctx.consumeActionType || 'bonus_action';
  consumeAction(actionType);
  if (actionType === 'bonus_action') dispatchBonusActionResult(ctx, def);
  ctx.showToast(`${def.name}恢复 ${actualHealing} 点生命值！`, 'success');
  ctx.closeMenu();
}

/**
 * Execute an action based on its actionEffect declaration.
 * Works for both standard actions and class features.
 * Returns true if handled, false if no actionEffect found (caller should fallback).
 */
export function executeActionEffect(actionKey: string, ctx: ActionEffectContext): boolean {
  const def = getEffectDefinition(actionKey);
  if (!def?.actionEffect) return false;

  switch (def.actionEffect.type) {
    case 'self_buff':
      handleSelfBuff(def, ctx);
      return true;
    case 'movement_bonus':
      handleMovementBonus(def, ctx);
      return true;
    case 'ally_buff':
      handleAllyBuff(def, ctx);
      return true;
    case 'check_then_buff':
      handleCheckThenBuff(def, ctx);
      return true;
    case 'narrative':
      handleNarrative(def, ctx);
      return true;
    case 'instant_heal':
      handleInstantHeal(def, ctx);
      return true;
    default:
      return false;
  }
}
