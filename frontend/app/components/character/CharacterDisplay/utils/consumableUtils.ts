// Consumable item utilities - dice rolling, data lookup, result formatting
import { findAnyMetaByKey } from "./rules";

export interface ConsumableData {
  type: string;       // "drink" | "thrown" | "apply"
  action: string;     // "action" | "bonus_action"
  consumed: boolean;
  healing?: { dice: string; bonus: number; formula: string };
  damage?: { dice: string; bonus?: number; type: string; formula: string };
  buff?: string;      // Effect description for non-healing/damage consumables
}

export interface DiceResult {
  rolls: number[];
  bonus: number;
  total: number;
}

/** Parse "2d4+2" format and roll, returning individual rolls, bonus, and total */
export function rollConsumableDice(formula: string): DiceResult {
  const match = formula.match(/^(\d+)d(\d+)(?:\+(\d+))?$/i);
  if (!match) return { rolls: [], bonus: 0, total: 0 };
  const count = parseInt(match[1]);
  const sides = parseInt(match[2]);
  const bonus = match[3] ? parseInt(match[3]) : 0;
  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
  const total = rolls.reduce((s, r) => s + r, 0) + bonus;
  return { rolls, bonus, total };
}

/** Get consumable data from item's own field, fallback to equipment.json metadata */
export function getConsumableData(item: { id: string; name?: string; consumable?: any; [key: string]: any }): ConsumableData | null {
  // 1. Check item's own consumable field
  if (item.consumable) return item.consumable as ConsumableData;
  // 2. Search equipment.json via rules utility
  const meta = findAnyMetaByKey(item.id) || (item.name ? findAnyMetaByKey(item.name) : null);
  if (meta && (meta as any).consumable) return (meta as any).consumable as ConsumableData;
  return null;
}

/** Format consumable usage result for toast message */
export function formatConsumableResult(
  itemName: string,
  consumable: ConsumableData,
  diceResult?: DiceResult,
  hpInfo?: { before: number; after: number; max: number }
): string {
  if (consumable.healing && diceResult) {
    const rollsStr = `[${diceResult.rolls.join(',')}]`;
    const bonusStr = diceResult.bonus > 0 ? `+${diceResult.bonus}` : '';
    const hpStr = hpInfo ? ` (HP ${hpInfo.before}→**${hpInfo.after}**/${hpInfo.max})` : '';
    return `使用 ${itemName}(${consumable.healing.formula}): ${rollsStr}${bonusStr} = **${diceResult.total}**，恢复 **${diceResult.total}** HP${hpStr}`;
  }
  if (consumable.damage && diceResult) {
    const rollsStr = `[${diceResult.rolls.join(',')}]`;
    const bonusStr = diceResult.bonus ? `+${diceResult.bonus}` : '';
    return `使用 ${itemName}(${consumable.damage.formula}): ${rollsStr}${bonusStr} = ${diceResult.total} ${consumable.damage.type}伤害`;
  }
  if (consumable.buff) {
    return `使用 ${itemName}: ${consumable.buff}`;
  }
  return `使用了 ${itemName}`;
}

/** Get a brief effect description for display in menus */
export function getConsumableEffectPreview(consumable: ConsumableData): string {
  if (consumable.healing) return `恢复 ${consumable.healing.formula} HP`;
  if (consumable.damage) return `${consumable.damage.formula} ${consumable.damage.type}伤害`;
  if (consumable.buff) return consumable.buff;
  return '';
}

/** Post consumable usage to chat via HTTP API (backend broadcasts via WebSocket) */
export async function broadcastConsumableUsed(
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  campaignId: string,
  _userId: string,
  _role: string,
  characterName: string,
  itemName: string,
  resultText: string,
  consumable: ConsumableData,
  diceResult?: DiceResult
) {
  try {
    await authedFetch(`/api/campaigns/${campaignId}/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: resultText,
        message_type: 'system',
        meta: {
          consumable_use: {
            character_name: characterName,
            item_name: itemName,
            dice_rolls: diceResult?.rolls,
            dice_bonus: diceResult?.bonus,
            dice_total: diceResult?.total,
            healing: consumable.healing ? diceResult?.total : undefined,
          },
        },
      }),
    });
  } catch (e) {
    // Non-critical: don't block consumable usage if chat broadcast fails
  }
}
