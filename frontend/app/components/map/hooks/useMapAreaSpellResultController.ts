import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { Token } from "../types/TacticalMapTypes";
import type { AreaSpellModeState } from "./useMapAreaSpellController";
import { showDamageNumber } from "../DamageNumberOverlay";
import {
  buildAreaSpellAppliedEffect,
  buildAreaSpellEffectChatMessage,
  getAffectedAreaSpellTargetIds,
  getAreaSpellResultToastMessage,
  getAreaSpellTargetNames,
} from "../utils/mapAreaSpellResultUtils";
import { isLastingAreaSpellDuration, shouldConsumeAreaSpellSlot } from "../utils/mapAreaSpellRuntimeUtils";
import { publishAppEvent } from "~/events/appEventBus";
import type { EffectDefinition } from "~/types/effects";
import { showCharacterBubble } from "~/utils/characterBubble";
import { syncCharacterSpellSlotsFromBackend } from "~/utils/sidebarCasting";

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

interface AreaSpellPersistenceApi {
  consumeAreaSpellSlot: (args: {
    slotLevel?: number | null;
    characterId?: number | null;
    freecast?: boolean;
    ritualCast?: boolean;
    localSpellSlotsState?: unknown;
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

interface UseMapAreaSpellResultControllerArgs extends AreaSpellPersistenceApi {
  authedFetch: AuthedFetch;
  showToast: ShowToast;
  sendMessage: (payload: any) => void;
  playEffect: (spellId: string, damageType?: string) => void;
  playHit: (spellId: string, damageType?: string) => void;
  clearCloakOfShadowsEffect: (
    tokenId: number,
    reason: "attack" | "spell" | "turn_end" | "manual",
  ) => Promise<unknown>;
  clearReadyCast: (tokenId: number) => Promise<unknown>;
  consumePendingDestructiveWrath: (
    sourceTokenId: number,
    casterName: string,
    damageType?: string,
  ) => Promise<unknown>;
  setTokens: Dispatch<SetStateAction<Token[]>>;
  setTokenStatusEffects: Dispatch<SetStateAction<Record<number, any[]>>>;
  tokenStatusEffects: Record<number, any[]>;
  resolveEffectDefinition: (effectId: string) => EffectDefinition | undefined;
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

export function useMapAreaSpellResultController({
  authedFetch,
  showToast,
  sendMessage,
  playEffect,
  playHit,
  clearCloakOfShadowsEffect,
  clearReadyCast,
  consumePendingDestructiveWrath,
  consumeAreaSpellSlot,
  persistAreaEffect,
  setTokens,
  setTokenStatusEffects,
  tokenStatusEffects,
  resolveEffectDefinition,
}: UseMapAreaSpellResultControllerArgs) {
  const processAreaSpellSuccess = useCallback(async ({
    result,
    spell,
    finalTargets,
    sourceToken,
    sourceTokenId,
    casterName,
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
  }: ProcessAreaSpellSuccessArgs) => {
    showToast(
      getAreaSpellResultToastMessage(spell.name, finalTargets.length, result.narrative, result.hits),
      "success",
      6000,
    );

    if (result.total_damage > 0 || result.hits > 0) {
      playHit(spell.id, spell.damageType);
    } else {
      playEffect(spell.id, spell.damageType);
    }

    if (result.hp_updates) {
      setTokens((previous) => previous.map((token) => {
        const hpUpdate = result.hp_updates.find((update: any) => update.token_id === token.id);
        return hpUpdate ? { ...token, current_hp: hpUpdate.new_hp } : token;
      }));

      result.hp_updates.forEach((update: { token_id: number; damage_dealt: number }) => {
        if (update.damage_dealt > 0) {
          showDamageNumber({
            targetTokenId: update.token_id,
            damage: update.damage_dealt,
            hit: true,
            critical: false,
            fumble: false,
            heal: false,
          });
        }
      });
    }

    if (maximizeDamage && result.damage_roll) {
      await consumePendingDestructiveWrath(
        sourceTokenId,
        casterName,
        spell.damageType || spell.damageTypeCn,
      );
    }

    if (sourceToken.character_id) {
      showCharacterBubble({
        characterId: sourceToken.character_id,
        characterName: casterName,
        message: `🔮 ${spell.name} - ${result.total_damage || 0} 点伤害`,
        type: "combat",
      });
    }

    if (spellEffectMapping) {
      const effectDefinition = resolveEffectDefinition(spellEffectMapping.effectId);
      if (effectDefinition) {
        const affectedTokenIds = getAffectedAreaSpellTargetIds(result.target_results, finalTargets);
        const effectDuration = spellEffectMapping.duration
          || effectDefinition.duration?.rounds
          || (effectDefinition.duration?.minutes ? effectDefinition.duration.minutes * 10 : undefined);

        for (const targetTokenId of affectedTokenIds) {
          const currentEffects = tokenStatusEffects[targetTokenId] || [];
          if (currentEffects.some((effect) => effect.id === effectDefinition.id)) {
            continue;
          }

          const updatedEffects = [
            ...currentEffects,
            buildAreaSpellAppliedEffect(effectDefinition, spell.name, casterName, effectDuration),
          ];

          setTokenStatusEffects((previous) => ({
            ...previous,
            [targetTokenId]: updatedEffects,
          }));

          try {
            await authedFetch(`/api/tokens/${targetTokenId}/active-effects`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ active_effects: updatedEffects }),
            });
          } catch {
            // Keep local effect optimistic even if persistence fails.
          }
        }

        if (affectedTokenIds.length > 0) {
          sendMessage({
            type: "chat",
            data: {
              message: buildAreaSpellEffectChatMessage(
                spell.name,
                effectDefinition,
                getAreaSpellTargetNames(affectedTokenIds, finalTargets),
              ),
              message_type: "combat",
            },
          });
        }
      }
    }

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

    if (
      isLastingAreaSpellDuration(spell.duration || "")
      && !spell.concentration
      && spell.areaOfEffect
      && (centerPos || originPos)
    ) {
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

    if (cloakOfShadowsActive) {
      await clearCloakOfShadowsEffect(sourceTokenId, "spell");
    }
    if (readyCastTokenId) {
      await clearReadyCast(readyCastTokenId);
    }
  }, [
    authedFetch,
    clearCloakOfShadowsEffect,
    clearReadyCast,
    consumeAreaSpellSlot,
    consumePendingDestructiveWrath,
    persistAreaEffect,
    playEffect,
    playHit,
    resolveEffectDefinition,
    sendMessage,
    setTokenStatusEffects,
    setTokens,
    showToast,
    tokenStatusEffects,
  ]);

  return {
    processAreaSpellSuccess,
  };
}
