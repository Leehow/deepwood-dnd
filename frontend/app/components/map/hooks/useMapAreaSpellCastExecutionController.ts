import { useCallback } from "react";

import type { SpellOption } from "../SelectionContextMenu";
import type { AreaSpellModeState } from "./useMapAreaSpellController";
import type { Token } from "../types/TacticalMapTypes";
import {
  getAreaSpellEffectiveCenterPosition,
  isDirectionalAreaSpell,
  resolveAreaSpellFinalTargets,
} from "../utils/mapAreaSpellCastPrelude";
import { prepareAreaSpellCombat } from "../utils/mapAreaSpellCombatPreparation";
import { parseTokenSize } from "../utils/mapCalculations";
import { castSpellViaAPI, syncCharacterSpellSlotsFromBackend, formatSpellChatMessage, buildSpellCastData } from "~/utils/sidebarCasting";
import { publishAppEvent } from "~/events/appEventBus";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapAreaSpellCastExecutionController");

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface SpellBuffEffects {
  acBonus: number;
  resistances: string[];
  immunities: string[];
}

interface UseMapAreaSpellCastExecutionControllerArgs {
  areaSpellMode: AreaSpellModeState | null;
  tokens: Token[];
  sourceCharacterData: any;
  campaignId: string;
  currentMapUrl?: string | null;
  authedFetch: AuthedFetch;
  showToast: ShowToast;
  getTokensInArea: (params: {
    shapeType: AreaSpellModeState["shapeType"];
    centerX?: number;
    centerY?: number;
    originX?: number;
    originY?: number;
    direction?: number;
    size: number;
    lineWidth?: number;
  }) => Token[];
  tokenStatusEffects: Record<number, any[]>;
  getSpellBuffEffects: (token: Token) => SpellBuffEffects;
  handleAreaSpellCancel: () => void;
  handleNonCombatAreaSpell: (args: any) => Promise<boolean>;
  dispatchAreaSpellCombat: (args: any) => Promise<boolean>;
  isCloakOfShadowsEffect: (effect: any) => boolean;
  isDestructiveWrathPendingEffect: (effect: any) => boolean;
  isDestructiveWrathEligibleDamageType: (value: unknown) => boolean;
  getSpellEffectMapping: (spellId: string) => { effectId: string; duration?: number } | undefined;
}

export function useMapAreaSpellCastExecutionController({
  areaSpellMode,
  tokens,
  sourceCharacterData,
  campaignId,
  currentMapUrl,
  authedFetch,
  showToast,
  getTokensInArea,
  tokenStatusEffects,
  getSpellBuffEffects,
  handleAreaSpellCancel,
  handleNonCombatAreaSpell,
  dispatchAreaSpellCombat,
  isCloakOfShadowsEffect,
  isDestructiveWrathPendingEffect,
  isDestructiveWrathEligibleDamageType,
  getSpellEffectMapping,
}: UseMapAreaSpellCastExecutionControllerArgs) {
  const handleAreaSpellCast = useCallback(async () => {
    if (!areaSpellMode || !areaSpellMode.spell) {
      logger.warn("[Area Spell] Invalid state for casting");
      return;
    }

    const {
      spell,
      slotLevel,
      sourceTokenId,
      shapeType,
      centerPos,
      originPos,
      direction,
    } = areaSpellMode;
    const readyCastTokenId = (spell as any).__readyCastTokenId as number | undefined;

    const isDirectional = isDirectionalAreaSpell(shapeType);
    if (isDirectional && !originPos) {
      logger.warn("[Area Spell] Missing origin position for directional spell");
      return;
    }
    if (!isDirectional && !centerPos) {
      logger.warn("[Area Spell] Missing center position for area spell");
      return;
    }

    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    if (!sourceToken) {
      showToast("无法找到施法者", "error");
      handleAreaSpellCancel();
      return;
    }

    // Misty Step / self-teleport: the area picker was used as a destination
    // picker (synthetic 1-grid sphere). Call `/api/spells/cast` with a
    // typed `teleport_destination` and let `TeleportHandler` move the
    // caster on the backend. Range was already validated by the picker;
    // we only need to gate occupancy here.
    if ((spell as any).__teleportDestination && centerPos) {
      const destX = Math.round(centerPos.x);
      const destY = Math.round(centerPos.y);
      const occupant = tokens.find((t) => {
        if (t.id === sourceTokenId) return false;
        const sz = parseTokenSize(t.token_size);
        const w = Math.max(sz.width, 1);
        const h = Math.max(sz.height, 1);
        return (
          destX >= t.position_x && destX < t.position_x + w
          && destY >= t.position_y && destY < t.position_y + h
        );
      });
      if (occupant) {
        showToast("目标位置已被占据", "error");
        return;
      }
      const characterId = sourceToken.character_id;
      const apiResult = await castSpellViaAPI(
        spell.id,
        slotLevel,
        sourceTokenId,
        [sourceTokenId],
        campaignId,
        undefined,
        areaSpellMode.freecast,
        areaSpellMode.ritualCast,
        areaSpellMode.selectedOption,
        areaSpellMode.materialId,
        undefined,
        false,
        { x: destX, y: destY },
      );
      if (!apiResult?.success) {
        showToast(apiResult?.error || "传送失败", "error");
        return;
      }
      if (characterId) {
        void syncCharacterSpellSlotsFromBackend(characterId, { delayMs: 50 });
      }
      publishAppEvent("spellCastChat", {
        message: formatSpellChatMessage(spell.name, slotLevel, apiResult),
        characterId: characterId ?? 0,
        spellCastData: buildSpellCastData(spell.name, slotLevel, apiResult),
      });
      handleAreaSpellCancel();
      return;
    }

    const sizeFeet = spell.areaOfEffect?.size || 20;
    const { followCaster, effectiveCenterPos } = getAreaSpellEffectiveCenterPosition(
      areaSpellMode,
      shapeType,
      sourceToken,
    );

    const targetsInArea = getTokensInArea({
      shapeType,
      centerX: effectiveCenterPos?.x,
      centerY: effectiveCenterPos?.y,
      originX: originPos?.x,
      originY: originPos?.y,
      direction,
      size: sizeFeet,
    });

    const finalTargets = resolveAreaSpellFinalTargets(spell, sourceTokenId, targetsInArea);

    if (await handleNonCombatAreaSpell({
      areaSpellMode,
      spell: spell as SpellOption & Record<string, any>,
      slotLevel,
      sourceToken,
      sourceTokenId,
      shapeType,
      centerPos,
      originPos,
      effectiveCenterPos,
      followCaster,
      sizeFeet,
      direction,
      finalTargets,
      readyCastTokenId,
      sourceCharacterSpellSlotsState: sourceCharacterData?.spell_slots_state,
      campaignId,
    })) {
      return;
    }

    // Granted moving-area relocations (Moonbeam / Flaming Sphere) reposition
    // an existing area and are allowed to fire on an empty cell — the backend
    // accepts empty targets for `move_effect`. Detect this narrowly so normal
    // damaging area spells (Fireball, etc.) still warn/cancel on zero targets.
    const spellId = (spell as any).id;
    const isMoveEffectGrant =
      (typeof spellId === "string"
        && spellId.startsWith("granted_")
        && spellId.endsWith("_move_effect"))
      || (spell as any).__activeEffectGrantAction?.actionKind === "move_effect";

    if (finalTargets.length === 0 && !isMoveEffectGrant) {
      showToast("范围内没有目标", "warning");
      handleAreaSpellCancel();
      return;
    }

    logger.info("[Area Spell] Casting", {
      spell: spell.name,
      shapeType,
      center: centerPos,
      origin: originPos,
      direction,
      sizeFeet,
      targetCount: finalTargets.length,
      targets: finalTargets.map((token) => token.instance_name || token.id),
    });

    const {
      areaSpellRequest,
      casterData,
      cloakOfShadowsActive,
      maximizeDamage,
    } = await prepareAreaSpellCombat({
      campaignId,
      currentMapUrl,
      sourceToken,
      sourceCharacterData,
      sourceTokenId,
      finalTargets,
      spell: spell as SpellOption & Record<string, any>,
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
    });

    await dispatchAreaSpellCombat({
      areaSpellRequest,
      spell,
      finalTargets,
      sourceToken,
      sourceTokenId,
      casterData,
      slotLevel,
      areaSpellMode,
      sourceCharacterSpellSlotsState: sourceCharacterData?.spell_slots_state,
      shapeType,
      centerPos,
      originPos,
      sizeFeet,
      direction,
      spellEffectMapping: getSpellEffectMapping(spell.id),
      maximizeDamage,
      cloakOfShadowsActive,
      readyCastTokenId,
    });
  }, [
    areaSpellMode,
    authedFetch,
    campaignId,
    currentMapUrl,
    dispatchAreaSpellCombat,
    getSpellBuffEffects,
    getSpellEffectMapping,
    getTokensInArea,
    handleAreaSpellCancel,
    handleNonCombatAreaSpell,
    isCloakOfShadowsEffect,
    isDestructiveWrathEligibleDamageType,
    isDestructiveWrathPendingEffect,
    showToast,
    sourceCharacterData,
    tokenStatusEffects,
    tokens,
  ]);

  return {
    handleAreaSpellCast,
  };
}
