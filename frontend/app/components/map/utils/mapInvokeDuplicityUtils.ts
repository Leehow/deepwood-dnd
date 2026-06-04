import type { CharacterClassAction } from "../SelectionContextMenu";

export const INVOKE_DUPLICITY_SPELL_ID = "invoke_duplicity";
export const INVOKE_DUPLICITY_DURATION_ROUNDS = 10;
export const INVOKE_DUPLICITY_RANGE_FEET = 30;

export interface InvokeDuplicityModalState {
  sourceTokenId: number;
  sourceCharacterId: number;
  sourceName: string;
  action: CharacterClassAction;
  maxDuplicates: number;
}

export interface InvokeDuplicityPlacementMode {
  sourceTokenId: number;
  sourceCharacterId: number;
  sourceName: string;
  action: CharacterClassAction;
  requestedCount: number;
  positions: Array<{ x: number; y: number }>;
  previewPos: { x: number; y: number } | null;
}

export function isInvokeDuplicityConcentration(concentrationSpell: any): boolean {
  return String(concentrationSpell?.spell_id || "").trim().toLowerCase() === INVOKE_DUPLICITY_SPELL_ID;
}

export function getInvokeDuplicityLinkedTokenIds(concentrationSpell: any): number[] {
  if (!isInvokeDuplicityConcentration(concentrationSpell)) return [];
  const ids = Array.isArray(concentrationSpell?.linked_token_ids)
    ? concentrationSpell.linked_token_ids
    : [];
  return Array.from(new Set(
    ids
      .map((value: unknown) => Number(value))
      .filter((value: number) => Number.isInteger(value) && value > 0),
  ));
}

export function getInvokeDuplicityMaxDuplicates(characterData: any): number {
  const level = Number(characterData?.level || 0);
  const subclassId = String(characterData?.subclass_id || "").toLowerCase();
  return subclassId === "trickery" && level >= 17 ? 4 : 1;
}
