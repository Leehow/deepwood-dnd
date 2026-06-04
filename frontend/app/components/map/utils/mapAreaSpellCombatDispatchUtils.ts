import { getAreaSpellSlotText } from "./mapAreaSpellRuntimeUtils";

export function buildAreaSpellCombatQueryString(args: {
  userId?: string | null;
  isDM: boolean;
}): string {
  return new URLSearchParams({
    user_id: args.userId || "anonymous",
    role: args.isDM ? "dm" : "player",
  }).toString();
}

export function getAreaSpellCombatTargetLabel(targetCount: number): string {
  return `${targetCount}个目标`;
}

export function buildAreaSpellCombatStartMessage(args: {
  casterName: string;
  spellName: string;
  slotLevel?: number | null;
  targetCount: number;
}): string {
  return `${args.casterName} 施放 ${args.spellName} ${getAreaSpellSlotText(args.slotLevel)}，影响 ${args.targetCount} 个目标...`;
}

export function shouldUseBreathWeaponSound(spellId: string): boolean {
  return spellId.startsWith("breath_weapon_");
}

export function getAreaSpellCombatErrorMessage(errorText?: string | null): string {
  const normalized = String(errorText || "").trim();
  return normalized ? `范围法术施放失败: ${normalized}` : "范围法术施放失败";
}

export function getAreaSpellUnexpectedResponseMessage(spellName: string): string {
  return `${spellName} 施放返回了无效结果`;
}
