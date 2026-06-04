import type { SpellOption } from "../SelectionContextMenu";
import type { AreaSpellModeState } from "../hooks/useMapAreaSpellController";
import type { Token } from "../types/TacticalMapTypes";
import {
  buildAreaSpellCasterData,
  buildAreaSpellRequest,
  buildAreaSpellTargetsData,
} from "./mapAreaSpellCombatPayload";

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface SpellBuffEffects {
  acBonus: number;
  resistances: string[];
  immunities: string[];
}

interface PrepareAreaSpellCombatArgs {
  campaignId: string;
  currentMapUrl?: string | null;
  sourceToken: Token;
  sourceCharacterData: any;
  sourceTokenId: number;
  finalTargets: Token[];
  spell: SpellOption & Record<string, any>;
  slotLevel: number;
  centerPos: { x: number; y: number } | null;
  originPos: { x: number; y: number } | null;
  direction?: number | null;
  shapeType: NonNullable<AreaSpellModeState["shapeType"]>;
  tokenStatusEffects: Record<number, any[]>;
  authedFetch: AuthedFetch;
  getSpellBuffEffects: (token: Token) => SpellBuffEffects;
  isCloakOfShadowsEffect: (effect: any) => boolean;
  isDestructiveWrathPendingEffect: (effect: any) => boolean;
  isDestructiveWrathEligibleDamageType: (value: unknown) => boolean;
}

export async function prepareAreaSpellCombat({
  campaignId,
  currentMapUrl,
  sourceToken,
  sourceCharacterData,
  sourceTokenId,
  finalTargets,
  spell,
  slotLevel,
  centerPos,
  originPos,
  direction,
  shapeType,
  tokenStatusEffects,
  authedFetch,
  getSpellBuffEffects,
  isCloakOfShadowsEffect,
  isDestructiveWrathPendingEffect,
  isDestructiveWrathEligibleDamageType,
}: PrepareAreaSpellCombatArgs) {
  const casterData = buildAreaSpellCasterData(sourceToken, sourceCharacterData);
  const sourceEffects = tokenStatusEffects[sourceTokenId] || [];
  const cloakOfShadowsActive = sourceEffects.some((effect) => isCloakOfShadowsEffect(effect));

  const targetsData = await buildAreaSpellTargetsData({
    targets: finalTargets,
    spell,
    authedFetch,
    getSpellBuffEffects,
  });

  const maximizeDamage = (
    sourceEffects.some((effect) => isDestructiveWrathPendingEffect(effect))
    && isDestructiveWrathEligibleDamageType(spell.damageType || spell.damageTypeCn)
  );

  const areaSpellRequest = buildAreaSpellRequest({
    campaignId,
    casterData,
    targetsData,
    spell,
    slotLevel,
    centerPos,
    originPos,
    direction: direction || 0,
    shapeType,
    currentMapUrl,
    maximizeDamage,
  });

  return {
    areaSpellRequest,
    casterData,
    cloakOfShadowsActive,
    maximizeDamage,
  };
}
