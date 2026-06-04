import type { SpellOption } from "../SelectionContextMenu";
import type { Token } from "../types/TacticalMapTypes";
import { getEdgeToEdgeDistance, parseTokenSize } from "./mapCalculations";

interface ResolveSpellCastDistanceArgs {
  spell: SpellOption & Record<string, any>;
  sourceToken: Token;
  targetToken: Token;
  sourceTokenId: number;
  gridUnitLength: number;
  sourceCharacterData?: any;
  isDM: boolean;
  getBestInvokeDuplicityDistanceToToken: (sourceTokenId: number, targetToken: Token) => number | null;
}

interface ResolveSpellCastDistanceResult {
  distanceFeet: number;
  effectiveDistanceFeet: number;
  spellRange: number | null;
  rangeError: string | null;
}

export function resolveSpellCastDistance({
  spell,
  sourceToken,
  targetToken,
  sourceTokenId,
  gridUnitLength,
  sourceCharacterData,
  isDM,
  getBestInvokeDuplicityDistanceToToken,
}: ResolveSpellCastDistanceArgs): ResolveSpellCastDistanceResult {
  const sourceSize = parseTokenSize(sourceToken.token_size);
  const targetSize = parseTokenSize(targetToken.token_size);
  const distanceFeet = getEdgeToEdgeDistance(
    sourceToken.position_x,
    sourceToken.position_y,
    sourceSize.width,
    sourceSize.height,
    targetToken.position_x,
    targetToken.position_y,
    targetSize.width,
    targetSize.height,
  ) * gridUnitLength;
  const effectiveDistanceFeet =
    getBestInvokeDuplicityDistanceToToken(sourceTokenId, targetToken) ?? distanceFeet;

  if (isDM || !spell.range) {
    return {
      distanceFeet,
      effectiveDistanceFeet,
      spellRange: null,
      rangeError: null,
    };
  }

  const rangeMatch = spell.range.match(/(\d+)/);
  let spellRange = rangeMatch ? parseInt(rangeMatch[1], 10) : null;
  if (spellRange !== null && spell.attackType) {
    const hasSpellSniper = sourceCharacterData?.feats?.some((feat: any) => {
      const value = typeof feat === "string" ? feat : feat?.value;
      return value === "spell_sniper";
    });
    if (hasSpellSniper) spellRange *= 2;
  }

  return {
    distanceFeet,
    effectiveDistanceFeet,
    spellRange,
    rangeError:
      spellRange !== null && effectiveDistanceFeet > spellRange
        ? `超出法术射程 (${Math.round(effectiveDistanceFeet)}尺 > 射程${spellRange}尺)`
        : null,
  };
}
