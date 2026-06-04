import { useCallback } from "react";

import type { AreaSpellModeState } from "./useMapAreaSpellController";
import type { SpellOption } from "../SelectionContextMenu";
import type { Token } from "../types/TacticalMapTypes";
import {
  buildAreaEffectData,
  getAreaSpellSlotText,
  isLastingAreaSpellDuration,
  shouldConsumeAreaSpellSlot,
} from "../utils/mapAreaSpellRuntimeUtils";
import { canCastAreaSpellOnEmptyGround, isUtilityAreaSpell } from "../utils/mapAreaSpellCastPrelude";
import { publishAppEvent } from "~/events/appEventBus";
import { startSpellCastViaAPI, syncCharacterSpellSlotsFromBackend } from "~/utils/sidebarCasting";

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

type SetConcentrationOnToken = (
  tokenId: number,
  spell: any,
  level: number,
  userId?: string,
  targetName?: string,
  affectedIds?: number[],
  areaEffect?: {
    shape: string;
    center_x: number;
    center_y: number;
    radius: number;
    map_url: string;
    color?: string;
    direction?: number;
    origin_x?: number;
    origin_y?: number;
  },
) => Promise<unknown>;

interface UseMapAreaSpellNonCombatControllerArgs {
  currentMapUrl?: string | null;
  showToast: ShowToast;
  sendMessage: (payload: any) => void;
  playCast: (spellId: string, damageType?: string) => void;
  handleAreaSpellCancel: () => void;
  clearReadyCast: (tokenId: number) => Promise<unknown>;
  setConcentrationOnTokenFn: SetConcentrationOnToken;
  consumeAreaSpellSlot: (args: {
    slotLevel?: number | null;
    characterId?: number | null;
    freecast?: boolean;
    ritualCast?: boolean;
    localSpellSlotsState?: unknown;
  }) => Promise<unknown>;
  createIllusionToken: (args: {
    sourceTokenId: number;
    sourceCharacterId?: number | null;
    spell: Pick<SpellOption, "id" | "name"> & { concentration?: boolean };
    position: { x: number; y: number };
    sizeFeet: number;
    areaSpellMode: Pick<AreaSpellModeState, "illusionImageUrl" | "illusionDesc" | "illusionDisplayName">;
  }) => Promise<unknown>;
  persistAreaEffect: (args: {
    sourceTokenId: number;
    spell: any;
    shapeType: NonNullable<AreaSpellModeState["shapeType"]>;
    position: { x: number; y: number };
    sizeFeet: number;
    fromCaster: string;
    color?: string;
    direction?: number | null;
    originPos?: { x: number; y: number } | null;
    followCaster?: boolean;
  }) => Promise<void>;
}

interface HandleNonCombatAreaSpellArgs {
  areaSpellMode: Pick<
    AreaSpellModeState,
    | "freecast"
    | "ritualCast"
    | "illusionImageUrl"
    | "illusionDesc"
    | "illusionDisplayName"
    | "longCast"
    | "confirmBreakConcentration"
  >;
  campaignId?: string;
  spell: SpellOption & Record<string, any>;
  slotLevel: number;
  sourceToken: Token;
  sourceTokenId: number;
  shapeType: NonNullable<AreaSpellModeState["shapeType"]>;
  centerPos: { x: number; y: number } | null;
  originPos: { x: number; y: number } | null;
  effectiveCenterPos: { x: number; y: number } | null;
  followCaster: boolean;
  sizeFeet: number;
  direction?: number;
  finalTargets: Token[];
  readyCastTokenId?: number;
  sourceCharacterSpellSlotsState?: unknown;
}

export function useMapAreaSpellNonCombatController({
  currentMapUrl,
  showToast,
  sendMessage,
  playCast,
  handleAreaSpellCancel,
  clearReadyCast,
  setConcentrationOnTokenFn,
  consumeAreaSpellSlot,
  createIllusionToken,
  persistAreaEffect,
}: UseMapAreaSpellNonCombatControllerArgs) {
  const handleNonCombatAreaSpell = useCallback(async ({
    areaSpellMode,
    spell,
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
    sourceCharacterSpellSlotsState,
    campaignId,
  }: HandleNonCombatAreaSpellArgs) => {
    // Long-cast / ritual placement: don't resolve the spell now. Persist the
    // chosen area on `casting_in_progress.area_effect` via /api/spells/start-cast
    // so the ready-cast release flow can fire with the same placement. No slot
    // consumption for rituals; non-ritual long casts keep their slot semantics
    // via the backend release path.
    if (areaSpellMode.longCast && campaignId) {
      const areaEffectPosition = effectiveCenterPos || centerPos || originPos;
      if (!areaEffectPosition) {
        return false;
      }
      const areaEffect = buildAreaEffectData({
        shapeType,
        position: areaEffectPosition,
        sizeFeet,
        currentMapUrl,
        color: (spell as any).zoneEffects?.color,
        followCaster,
        direction,
        originPos,
      });
      const startResult = await startSpellCastViaAPI(
        spell.id,
        slotLevel,
        sourceTokenId,
        campaignId,
        undefined,
        {
          freecast: areaSpellMode.freecast,
          ritualCast: areaSpellMode.ritualCast,
          confirmBreakConcentration: areaSpellMode.confirmBreakConcentration,
          areaEffect,
        },
      );
      if (!startResult || !startResult.success) {
        showToast(startResult?.error || "开始施法失败", "error");
        return true;
      }
      const casterName = sourceToken.instance_name || sourceToken.character_name || "施法者";
      const prefix = areaSpellMode.ritualCast ? "开始进行仪式施法" : "开始长时间施法";
      sendMessage({
        type: "chat",
        data: {
          message: `⏳ **${casterName}** ${prefix}【${spell.name}】`,
          message_type: "combat",
        },
      });
      playCast(spell.id, spell.damageType);
      showToast(`${casterName} ${prefix}「${spell.name}」`, "info");
      handleAreaSpellCancel();
      if (readyCastTokenId) {
        await clearReadyCast(readyCastTokenId);
      }
      return true;
    }

    const utilitySpell = isUtilityAreaSpell(spell);
    const emptyGroundZoneCast = finalTargets.length === 0 && canCastAreaSpellOnEmptyGround(spell);
    if (!utilitySpell && !emptyGroundZoneCast) {
      return false;
    }

    const casterName = sourceToken.instance_name || sourceToken.character_name || "施法者";
    const slotText = getAreaSpellSlotText(slotLevel);

    sendMessage({
      type: "chat",
      data: {
        message: `🔮 **${casterName}** 施放了 **${spell.name}** ${slotText}`,
        message_type: "combat",
      },
    });

    if (shouldConsumeAreaSpellSlot({
      slotLevel,
      characterId: sourceToken.character_id,
      freecast: areaSpellMode.freecast,
      ritualCast: areaSpellMode.ritualCast,
    })) {
      const nextSpellSlotsState = await consumeAreaSpellSlot({
        slotLevel,
        characterId: sourceToken.character_id,
        freecast: areaSpellMode.freecast,
        ritualCast: areaSpellMode.ritualCast,
        localSpellSlotsState: sourceCharacterSpellSlotsState,
      });
      if (nextSpellSlotsState) {
        publishAppEvent("spellSlotsUpdate", {
          character_id: sourceToken.character_id!,
          spell_slots_state: nextSpellSlotsState,
        });
      }
      void syncCharacterSpellSlotsFromBackend(sourceToken.character_id!, { delayMs: 1200 });
    }

    // Set concentration for any concentration zone spell (utility or
    // control) cast on empty ground or as a utility area. Chrome QA
    // 2026-05-28: Web previously consumed a slot and dropped a visual area
    // but never replaced prior concentration because the gate required
    // `utilitySpell`.
    if (spell.concentration && sourceToken.character_id) {
      const areaEffectPosition = effectiveCenterPos || originPos;
      const areaEffect = areaEffectPosition
        ? buildAreaEffectData({
            shapeType,
            position: areaEffectPosition,
            sizeFeet,
            currentMapUrl,
            color: spell.zoneEffects?.color,
            followCaster,
            direction,
            originPos,
          })
        : undefined;
      await setConcentrationOnTokenFn(
        sourceTokenId,
        spell,
        slotLevel,
        undefined,
        undefined,
        [],
        areaEffect,
      );
    }

    // Concentration zone spells (e.g. Web) own their area through the
    // caster's concentration_spell.area_effect record. Persisting a separate
    // non-concentration `spell_area_*` buff in that case duplicates the
    // visual and leaves an orphaned area if the caster later drops
    // concentration — see Chrome QA 2026-05-28.
    //
    // Non-concentration illusion area spells (e.g. Minor Illusion) carry no
    // `zoneEffects` and no structured zone phases, yet still need a visible
    // record so the cast leaves a DB trace consistent with other lasting
    // area spells. Without this branch the empty-ground placement chat fires
    // but no `spell_area_*` entry lands on the caster — see Chrome QA
    // 2026-05-28 third slice.
    const isNonConcentrationVisualIllusion = (
      !!(spell as any).illusion
      && !spell.concentration
      && !!utilitySpell
    );
    const shouldPersistArea = (
      (utilitySpell && !spell.concentration && !!spell.zoneEffects)
      || (emptyGroundZoneCast && !spell.concentration)
      || isNonConcentrationVisualIllusion
    ) && (centerPos || originPos) && isLastingAreaSpellDuration(spell.duration || "");

    if (shouldPersistArea) {
      await persistAreaEffect({
        sourceTokenId,
        spell,
        shapeType,
        position: centerPos || originPos!,
        sizeFeet,
        direction,
        fromCaster: casterName,
      });
    }

    if (utilitySpell && areaSpellMode.illusionImageUrl && (centerPos || originPos)) {
      await createIllusionToken({
        sourceTokenId,
        sourceCharacterId: sourceToken.character_id,
        spell,
        position: centerPos || originPos!,
        sizeFeet,
        areaSpellMode,
      });
    }

    playCast(spell.id, spell.damageType);
    showToast(`${casterName} 施放了 ${spell.name} ${slotText}`, "success");
    handleAreaSpellCancel();
    if (readyCastTokenId) {
      await clearReadyCast(readyCastTokenId);
    }

    return true;
  }, [
    clearReadyCast,
    consumeAreaSpellSlot,
    createIllusionToken,
    currentMapUrl,
    handleAreaSpellCancel,
    persistAreaEffect,
    playCast,
    sendMessage,
    setConcentrationOnTokenFn,
    showToast,
  ]);

  return {
    handleNonCombatAreaSpell,
  };
}
