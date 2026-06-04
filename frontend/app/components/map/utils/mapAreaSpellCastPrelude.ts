import type { Token } from "../types/TacticalMapTypes";
import type { AreaSpellModeState } from "../hooks/useMapAreaSpellController";
import { parseTokenSize } from "./mapCalculations";
import { hasZoneControlBehavior } from "./zoneSpellDefinitionUtils";

type ShapeType = NonNullable<AreaSpellModeState["shapeType"]>;

export function isDirectionalAreaSpell(shapeType: ShapeType): boolean {
  return shapeType === "cone" || shapeType === "line";
}

export function getAreaSpellCasterCenterPosition(sourceToken: Pick<Token, "position_x" | "position_y" | "token_size">) {
  const size = parseTokenSize(sourceToken.token_size);
  return {
    x: sourceToken.position_x + Math.max(size.width, 1) / 2,
    y: sourceToken.position_y + Math.max(size.height, 1) / 2,
  };
}

export function getAreaSpellEffectiveCenterPosition(
  areaSpellMode: Pick<AreaSpellModeState, "isSelfRange" | "centerPos">,
  shapeType: ShapeType,
  sourceToken: Pick<Token, "position_x" | "position_y" | "token_size">,
) {
  const followCaster = areaSpellMode.isSelfRange && !isDirectionalAreaSpell(shapeType);
  return {
    followCaster,
    effectiveCenterPos: followCaster
      ? getAreaSpellCasterCenterPosition(sourceToken)
      : areaSpellMode.centerPos,
  };
}

export function resolveAreaSpellFinalTargets(
  spell: { healing?: string | null },
  sourceTokenId: number,
  targetsInArea: Token[],
): Token[] {
  return spell.healing
    ? targetsInArea
    : targetsInArea.filter((token) => token.id !== sourceTokenId);
}

export function isUtilityAreaSpell(spell: any): boolean {
  return !spell?.damage && !spell?.healing && !spell?.attackType && (!spell?.controlEffect || hasZoneControlBehavior(spell));
}

export function canCastAreaSpellOnEmptyGround(spell: any): boolean {
  const duration = String(spell?.duration || "").trim();
  const isLasting = !!duration && !["立即", "瞬间", "Instantaneous"].includes(duration);
  return (isLasting && hasZoneControlBehavior(spell)) || isSummonSpell(spell);
}

/**
 * Detect summon spells (Conjure Animals, Find Familiar, etc.) by looking for a
 * top-level `spawn_summon` effect. These spells have no `areaOfEffect` block,
 * so `spellCastMiddleware.deriveTargeting` currently routes them to
 * `single_target` mode and the empty-ground placement silently dead-ends —
 * Chrome QA 2026-05-28 confirmed Conjure Animals consumed nothing on an
 * empty click. Code that owns area-cast placement uses this predicate to
 * keep concentration + summon intent metadata if the spell can reach the
 * empty-ground path. Routing the spell itself into area mode lives in
 * `frontend/app/utils/spellCastMiddleware.ts`, which is outside this
 * dispatch's scope_own; see the handoff for the residual gap.
 */
export function isSummonSpell(spell: any): boolean {
  const phases = Array.isArray(spell?.effects) ? spell.effects : [];
  for (const phase of phases) {
    const leaves = Array.isArray(phase?.effects) ? phase.effects : [];
    for (const leaf of leaves) {
      if (leaf?.type === "spawn_summon") return true;
    }
  }
  return false;
}
