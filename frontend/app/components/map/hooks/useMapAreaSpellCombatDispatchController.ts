import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { SpellOption } from "../SelectionContextMenu";
import type { Token } from "../types/TacticalMapTypes";
import type { AreaSpellModeState } from "./useMapAreaSpellController";
import {
  buildAreaSpellCombatQueryString,
  buildAreaSpellCombatStartMessage,
  getAreaSpellCombatErrorMessage,
  getAreaSpellCombatTargetLabel,
  getAreaSpellUnexpectedResponseMessage,
  shouldUseBreathWeaponSound,
} from "../utils/mapAreaSpellCombatDispatchUtils";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapAreaSpellCombatDispatchController");

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface SpellEffectMapping {
  effectId: string;
  duration?: number;
}

interface DiceRollingState {
  visible: boolean;
  attackerName?: string;
  targetName?: string;
}

interface ProcessAreaSpellSuccessArgs {
  result: any;
  spell: any;
  finalTargets: Token[];
  sourceToken: Token;
  sourceTokenId: number;
  casterName: string;
  slotLevel: number;
  areaSpellMode: Pick<AreaSpellModeState, "freecast" | "ritualCast">;
  sourceCharacterSpellSlotsState?: unknown;
  shapeType: NonNullable<AreaSpellModeState["shapeType"]>;
  centerPos: { x: number; y: number } | null;
  originPos: { x: number; y: number } | null;
  sizeFeet: number;
  direction?: number | null;
  spellEffectMapping?: SpellEffectMapping;
  maximizeDamage: boolean;
  cloakOfShadowsActive: boolean;
  readyCastTokenId?: number;
}

interface DispatchAreaSpellCombatArgs {
  areaSpellRequest: unknown;
  spell: SpellOption & Record<string, any>;
  finalTargets: Token[];
  sourceToken: Token;
  sourceTokenId: number;
  casterData: { name: string };
  slotLevel: number;
  areaSpellMode: Pick<AreaSpellModeState, "freecast" | "ritualCast">;
  sourceCharacterSpellSlotsState?: unknown;
  shapeType: NonNullable<AreaSpellModeState["shapeType"]>;
  centerPos: { x: number; y: number } | null;
  originPos: { x: number; y: number } | null;
  sizeFeet: number;
  direction?: number | null;
  spellEffectMapping?: SpellEffectMapping;
  maximizeDamage: boolean;
  cloakOfShadowsActive: boolean;
  readyCastTokenId?: number;
}

interface UseMapAreaSpellCombatDispatchControllerArgs {
  authedFetch: AuthedFetch;
  userId?: string | null;
  isDM: boolean;
  showToast: ShowToast;
  playAttackSwing: (attackName: string, damageType: string) => void;
  playCast: (spellId: string, damageType?: string) => void;
  setDiceRolling: Dispatch<SetStateAction<DiceRollingState>>;
  handleAreaSpellCancel: () => void;
  processAreaSpellSuccess: (args: ProcessAreaSpellSuccessArgs) => Promise<void>;
}

export function useMapAreaSpellCombatDispatchController({
  authedFetch,
  userId,
  isDM,
  showToast,
  playAttackSwing,
  playCast,
  setDiceRolling,
  handleAreaSpellCancel,
  processAreaSpellSuccess,
}: UseMapAreaSpellCombatDispatchControllerArgs) {
  const dispatchAreaSpellCombat = useCallback(async ({
    areaSpellRequest,
    spell,
    finalTargets,
    sourceToken,
    sourceTokenId,
    casterData,
    slotLevel,
    areaSpellMode,
    sourceCharacterSpellSlotsState,
    shapeType,
    centerPos,
    originPos,
    sizeFeet,
    direction,
    spellEffectMapping,
    maximizeDamage,
    cloakOfShadowsActive,
    readyCastTokenId,
  }: DispatchAreaSpellCombatArgs) => {
    handleAreaSpellCancel();

    showToast(
      buildAreaSpellCombatStartMessage({
        casterName: casterData.name,
        spellName: spell.name,
        slotLevel,
        targetCount: finalTargets.length,
      }),
      "info",
    );

    if (shouldUseBreathWeaponSound(spell.id)) {
      playAttackSwing("吐息武器", spell.damageTypeCn || "fire");
    } else {
      playCast(spell.id, spell.damageType);
    }

    setDiceRolling({
      visible: true,
      attackerName: casterData.name,
      targetName: getAreaSpellCombatTargetLabel(finalTargets.length),
    });

    try {
      const resp = await authedFetch(
        `/api/combat/spell-area?${buildAreaSpellCombatQueryString({ userId, isDM })}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(areaSpellRequest),
        },
      );

      setDiceRolling({ visible: false });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => "");
        showToast(getAreaSpellCombatErrorMessage(errorText), "error");
        return false;
      }

      const payload = await resp.json().catch(() => null);
      if (!payload?.success || !payload?.results) {
        logger.warn("[Area Spell] Unexpected spell-area response", payload);
        showToast(getAreaSpellUnexpectedResponseMessage(spell.name), "error");
        return false;
      }

      await processAreaSpellSuccess({
        result: payload.results,
        spell,
        finalTargets,
        sourceToken,
        sourceTokenId,
        casterName: casterData.name,
        slotLevel,
        areaSpellMode,
        sourceCharacterSpellSlotsState,
        shapeType,
        centerPos,
        originPos,
        sizeFeet,
        direction,
        spellEffectMapping,
        maximizeDamage,
        cloakOfShadowsActive,
        readyCastTokenId,
      });

      return true;
    } catch (error) {
      setDiceRolling({ visible: false });
      logger.error("[Area Spell] Failed:", error);
      showToast("范围法术施放请求失败", "error");
      return false;
    }
  }, [
    authedFetch,
    handleAreaSpellCancel,
    isDM,
    playAttackSwing,
    playCast,
    processAreaSpellSuccess,
    setDiceRolling,
    showToast,
    userId,
  ]);

  return {
    dispatchAreaSpellCombat,
  };
}
