import type { Token } from "../types/TacticalMapTypes";
import type { EffectDefinition } from "~/types/effects";

export function getAreaSpellResultToastMessage(
  spellName: string,
  targetCount: number,
  narrative?: string,
  hitCount?: number,
): string {
  return narrative || `${spellName} 影响了 ${hitCount || 0}/${targetCount} 个目标`;
}

export function getAffectedAreaSpellTargetIds(
  targetResults: Array<{ target_token_id: number; save_succeeded?: boolean }> | undefined,
  fallbackTargets: Token[],
): number[] {
  if (!targetResults) {
    return fallbackTargets.map((token) => token.id);
  }

  return targetResults
    .filter((targetResult) => !targetResult.save_succeeded)
    .map((targetResult) => targetResult.target_token_id);
}

export function buildAreaSpellAppliedEffect(
  effectDefinition: EffectDefinition,
  spellName: string,
  casterName: string,
  effectDuration?: number,
) {
  return {
    id: effectDefinition.id,
    name: effectDefinition.name,
    icon: effectDefinition.visual.icon,
    color: effectDefinition.visual.color,
    duration: effectDuration,
    maxDuration: effectDuration,
    metadata: { source: spellName, caster: casterName },
  };
}

export function getAreaSpellTargetNames(targetIds: number[], targets: Token[]): string {
  return targetIds
    .map((id) => {
      const target = targets.find((token) => token.id === id);
      return target?.instance_name || target?.monster_name || "目标";
    })
    .join("、");
}

export function buildAreaSpellEffectChatMessage(
  spellName: string,
  effectDefinition: EffectDefinition,
  targetNames: string,
): string {
  return `${effectDefinition.visual.icon} **${spellName}** 使 ${targetNames} 陷入 **${effectDefinition.name}** 状态！`;
}
