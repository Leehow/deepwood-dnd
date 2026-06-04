import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { SpellOption } from "../SelectionContextMenu";
import type { AreaSpellModeState } from "./useMapAreaSpellController";
import {
  buildIllusionTokenPayload,
  buildPersistentAreaEffectPayload,
  decrementLegacySpellSlots,
  decrementStructuredSpellSlotsState,
  shouldConsumeAreaSpellSlot,
} from "../utils/mapAreaSpellRuntimeUtils";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapAreaSpellPersistence");

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface GridPosition {
  x: number;
  y: number;
}

interface ConsumeAreaSpellSlotArgs {
  slotLevel?: number | null;
  characterId?: number | null;
  freecast?: boolean;
  ritualCast?: boolean;
  localSpellSlotsState?: unknown;
}

interface PersistAreaEffectArgs {
  sourceTokenId: number;
  spell: Pick<SpellOption, "id" | "name" | "school"> & {
    duration?: string;
    damageType?: string;
    zoneEffects?: { color?: string } | null;
  };
  shapeType: NonNullable<AreaSpellModeState["shapeType"]>;
  position: GridPosition;
  sizeFeet: number;
  fromCaster: string;
  color?: string;
  direction?: number | null;
  originPos?: GridPosition | null;
  followCaster?: boolean;
}

interface CreateIllusionTokenArgs {
  sourceTokenId: number;
  sourceCharacterId?: number | null;
  spell: Pick<SpellOption, "id" | "name"> & { concentration?: boolean };
  position: GridPosition;
  sizeFeet: number;
  areaSpellMode: Pick<AreaSpellModeState, "illusionImageUrl" | "illusionDesc" | "illusionDisplayName">;
}

interface UseMapAreaSpellPersistenceArgs {
  authedFetch: AuthedFetch;
  campaignId: string;
  currentMapUrl?: string | null;
  gridUnitLength: number;
  setSourceCharacterData: Dispatch<SetStateAction<any>>;
}

export function useMapAreaSpellPersistence({
  authedFetch,
  campaignId,
  currentMapUrl,
  gridUnitLength,
  setSourceCharacterData,
}: UseMapAreaSpellPersistenceArgs) {
  const consumeAreaSpellSlot = useCallback(async ({
    slotLevel,
    characterId,
    freecast,
    ritualCast,
    localSpellSlotsState,
  }: ConsumeAreaSpellSlotArgs) => {
    if (!shouldConsumeAreaSpellSlot({ slotLevel, characterId, freecast, ritualCast })) {
      return null;
    }

    if (localSpellSlotsState) {
      const nextSpellSlots = decrementStructuredSpellSlotsState(localSpellSlotsState, slotLevel!);
      if (!nextSpellSlots) return null;

      setSourceCharacterData((previous: any) => (
        previous ? { ...previous, spell_slots_state: nextSpellSlots } : previous
      ));

      try {
        await authedFetch(`/api/characters/${characterId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spell_slots_state: nextSpellSlots }),
        });
      } catch (error) {
        logger.warn("[Area Spell] Failed to persist structured spell slot consumption", error);
      }

      return nextSpellSlots;
    }

    try {
      const slotsResponse = await authedFetch(`/api/characters/${characterId}`);
      if (!slotsResponse.ok) return null;

      const characterData = await slotsResponse.json();
      const nextSpellSlots = decrementLegacySpellSlots(characterData.spell_slots_state, slotLevel!);
      if (!nextSpellSlots) return null;

      await authedFetch(`/api/characters/${characterId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spell_slots_state: nextSpellSlots }),
      });

      return nextSpellSlots;
    } catch (error) {
      logger.warn("[Area Spell] Failed to persist fetched spell slot consumption", error);
      return null;
    }
  }, [authedFetch, setSourceCharacterData]);

  const persistAreaEffect = useCallback(async ({
    sourceTokenId,
    spell,
    shapeType,
    position,
    sizeFeet,
    fromCaster,
    color,
    direction,
    originPos,
    followCaster,
  }: PersistAreaEffectArgs) => {
    try {
      await authedFetch(`/api/tokens/${sourceTokenId}/add-effect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildPersistentAreaEffectPayload({
            spell,
            shapeType,
            position,
            sizeFeet,
            currentMapUrl,
            color,
            direction,
            originPos,
            followCaster,
            fromCaster,
          }),
        ),
      });
    } catch (error) {
      logger.warn("[Area Spell] Failed to persist area effect", error);
    }
  }, [authedFetch, currentMapUrl]);

  const createIllusionToken = useCallback(async ({
    sourceTokenId,
    sourceCharacterId,
    spell,
    position,
    sizeFeet,
    areaSpellMode,
  }: CreateIllusionTokenArgs) => {
    const payload = buildIllusionTokenPayload({
      campaignId,
      currentMapUrl,
      position,
      sizeFeet,
      gridUnitLength,
      spell,
      sourceCharacterId,
      illusionImageUrl: areaSpellMode.illusionImageUrl,
      illusionDesc: areaSpellMode.illusionDesc,
      illusionDisplayName: areaSpellMode.illusionDisplayName,
    });

    if (!payload) return null;

    try {
      const response = await authedFetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) return null;

      const illusionToken = await response.json();

      if (illusionToken?.id && spell.concentration) {
        await authedFetch(`/api/tokens/${sourceTokenId}/area-effect-position`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ illusion_token_id: illusionToken.id }),
        });
      }

      return illusionToken;
    } catch (error) {
      logger.warn("[Area Spell] Failed to create illusion token", error);
      return null;
    }
  }, [authedFetch, campaignId, currentMapUrl, gridUnitLength]);

  return {
    consumeAreaSpellSlot,
    createIllusionToken,
    persistAreaEffect,
  };
}
