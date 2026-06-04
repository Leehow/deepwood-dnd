import { useCallback, useEffect, useMemo, useState } from "react";

import type { Character, AbilityScores } from "~/components/character/CharacterDisplay/types/Character";
import type { Spell } from "~/components/character/CharacterDisplay/types/Spell";

import { useSpells } from "~/components/character/CharacterDisplay/hooks/useSpells";
import { abilityLabelMap } from "~/components/character/CharacterDisplay/utils/formatting";
import { spellcastingAbilityMap } from "~/components/character/CharacterDisplay/utils/spellcasting";
import spellcastingConfig from "~/data/rules/spellcasting.json";
import { apiFetch } from "~/utils/api-client";
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import { getMaxSpellSlots, getSpellcasterType } from "~/utils/spellSlotUtils";

// Only mental stats are used for spellcasting in 5E
export type SpellcastingAbilityId = "intelligence" | "wisdom" | "charisma";

export type SpellcasterType = "full" | "half" | "pact" | "third";

export interface SpellcastingInfo {
  abilityId: SpellcastingAbilityId;
  abilityLabel: string;
  abilityMod: number;
  spellSaveDC: number;
  spellAttackBonus: number;
  spellAttackStr: string;
  type: SpellcasterType;
  /** Spell slot counts per level (index = spell level). Index 0 is always 0, indexes 1-9 correspond to levels 1-9. */
  spellSlots: number[];
}

export interface UseCharacterSpellcastingArgs {
  character: Character;
  abilityMods: AbilityScores;
  proficiencyBonus: number;
  spellsAll: Spell[];
  campaignId?: string;
  persistCharacterPartial: (
    nextEquipment?: any,
    nextPreparedSpells?: string[],
    nextCurrency?: any,
  ) => Promise<any>;
  /** Callback to refetch character data from backend */
  refetchCharacter?: () => void;
}

export interface SpellSlotsState {
  remainingSlots: number[];
  consumeSlot: (level: number) => void;
  recoverSlot: (level: number) => void;
  longRest: () => void;
  shortRest: () => void;
  setRemainingSlots: (slots: number[]) => void;
  canPrepareSpells: boolean;
  markPreparationUsed: () => void;
}

export function useCharacterSpellcasting({
  character,
  abilityMods,
  proficiencyBonus,
  spellsAll,
  campaignId,
  persistCharacterPartial,
  refetchCharacter,
}: UseCharacterSpellcastingArgs) {
  const spellsState = useSpells({ character, abilityMods, spellsAll, persistCharacterPartial });

  const spellcasting = useMemo<SpellcastingInfo | null>(() => {
    const clsId = character.class_id || (character as any).classId;
    if (!clsId) return null;

    const subclassId = (character as any).subclass_id || (character as any).subclassId;
    const isSubclassCaster =
      (clsId === "fighter" && subclassId === "eldritch_knight") ||
      (clsId === "rogue" && subclassId === "arcane_trickster");

    const lookupKey = isSubclassCaster ? subclassId : clsId;
    const abilityId = (spellcastingAbilityMap as Record<string, SpellcastingAbilityId>)[lookupKey];
    if (!abilityId) return null;

    const abilityLabel = abilityLabelMap[abilityId] ?? abilityId;
    const abilityMod = abilityMods[abilityId] ?? 0;
    const spellSaveDC = 8 + proficiencyBonus + abilityMod;
    const spellAttackBonus = proficiencyBonus + abilityMod;
    const spellAttackStr = `${spellAttackBonus >= 0 ? "+" : ""}${spellAttackBonus}`;

    const type = getSpellcasterType(clsId, subclassId) as SpellcasterType;
    if (!type) return null;

    const spellSlots = getMaxSpellSlots(clsId, character.level || 1, subclassId);

    return {
      abilityId, abilityLabel, abilityMod, spellSaveDC,
      spellAttackBonus, spellAttackStr, type, spellSlots,
    } satisfies SpellcastingInfo;
  }, [character.class_id, (character as any).subclass_id, character.level, abilityMods, proficiencyBonus]);

  // ── Remaining spell slots (fully backend-driven) ──────────────
  const backendSpellSlotsState = (character as any).spell_slots_state as number[] | undefined;

  const [remainingSlots, setRemainingSlots] = useState<number[]>(() => {
    if (!spellcasting) return [];
    return spellcasting.spellSlots.map((max, idx) => {
      const v = Array.isArray(backendSpellSlotsState) ? backendSpellSlotsState[idx] : max;
      if (typeof v !== "number" || v < 0 || v > max) return max;
      return v;
    });
  });

  // Sync from backend whenever character.spell_slots_state changes
  useEffect(() => {
    if (!spellcasting) { setRemainingSlots([]); return; }
    const next = spellcasting.spellSlots.map((max, idx) => {
      const v = Array.isArray(backendSpellSlotsState) ? backendSpellSlotsState[idx] : max;
      if (typeof v !== "number" || v < 0 || v > max) return max;
      return v;
    });
    setRemainingSlots(next);
  }, [spellcasting, backendSpellSlotsState]);

  // ── canPrepareSpells ──────────────────────────────────────────
  const backendCanPrepare = (character as any).can_prepare_spells;
  const [canPrepareSpells, setCanPrepareSpells] = useState<boolean>(
    backendCanPrepare === true || backendCanPrepare === undefined,
  );

  useEffect(() => {
    if (backendCanPrepare !== undefined) setCanPrepareSpells(!!backendCanPrepare);
  }, [backendCanPrepare]);

  // ── Helpers ───────────────────────────────────────────────────
  /** Dispatch spellSlotsChanged event so Hotbar stays in sync */
  const notifySlotChange = useCallback((next: number[]) => {
    if (!spellcasting) return;
    publishAppEvent('spellSlotsChanged', {
      characterId: character.id,
      remaining: next,
      max: spellcasting.spellSlots,
    });
  }, [spellcasting, character.id]);

  /** Fire-and-forget POST spell_slots_state to backend */
  const persistSlots = useCallback((next: number[]) => {
    const payload: Record<string, unknown> = { spell_slots_state: next };
    if (campaignId) payload.broadcast_campaign_id = campaignId;
    apiFetch(`/api/characters/${character.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, [campaignId, character.id]);

  const resetAllSlots = useCallback(() => {
    if (!spellcasting) return;
    const maxSlots = spellcasting.spellSlots.slice();
    setRemainingSlots(maxSlots);
    notifySlotChange(maxSlots);
  }, [spellcasting, notifySlotChange]);

  const setRemainingSlotsExternal = useCallback(
    (slots: number[]) => {
      if (!spellcasting) return;
      if (!Array.isArray(slots)) {
        setRemainingSlots(spellcasting.spellSlots.slice());
        return;
      }
      const next = spellcasting.spellSlots.map((max, idx) => {
        const v = slots[idx];
        if (typeof v !== "number" || v < 0 || v > max) return max;
        return v;
      });
      setRemainingSlots(next);
      notifySlotChange(next);
    },
    [spellcasting, notifySlotChange],
  );

  const consumeSlot = useCallback(
    (level: number) => {
      if (!spellcasting) return;
      if (level <= 0 || level >= remainingSlots.length) return;
      // Pact magic: if requested level has no max slots, search upward for pact slot
      let effectiveLevel = level;
      if ((spellcasting.spellSlots[level] ?? 0) <= 0) {
        for (let i = level + 1; i <= 9; i++) {
          if ((spellcasting.spellSlots[i] ?? 0) > 0) { effectiveLevel = i; break; }
        }
      }
      if ((remainingSlots[effectiveLevel] ?? 0) <= 0) {
        alert("该环的法术位已用完");
        return;
      }
      setRemainingSlots((prev) => {
        const next = [...prev];
        next[effectiveLevel] = (next[effectiveLevel] ?? 0) - 1;
        notifySlotChange(next);
        persistSlots(next);
        return next;
      });
    },
    [remainingSlots, spellcasting, notifySlotChange, persistSlots],
  );

  const recoverSlot = useCallback(
    (level: number) => {
      if (!spellcasting) return;
      if (level <= 0 || level >= remainingSlots.length) return;
      const max = spellcasting.spellSlots[level] ?? 0;
      setRemainingSlots((prev) => {
        const current = prev[level] ?? 0;
        if (current >= max) return prev;
        const next = [...prev];
        next[level] = current + 1;
        notifySlotChange(next);
        persistSlots(next);
        return next;
      });
    },
    [remainingSlots.length, spellcasting, notifySlotChange, persistSlots],
  );

  const longRest = useCallback(() => {
    if (!spellcasting) return;
    const maxSlots = spellcasting.spellSlots.slice();
    setRemainingSlots(maxSlots);
    notifySlotChange(maxSlots);
    setCanPrepareSpells(true);
    // POST max slots → then refetch to ensure consistency
    const payload: Record<string, unknown> = { spell_slots_state: maxSlots };
    if (campaignId) payload.broadcast_campaign_id = campaignId;
    apiFetch(`/api/characters/${character.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(() => refetchCharacter?.()).catch(() => refetchCharacter?.());
  }, [campaignId, spellcasting, notifySlotChange, character.id, refetchCharacter]);

  const shortRest = useCallback(() => {
    if (spellcasting?.type === "pact") {
      resetAllSlots();
    }
  }, [resetAllSlots, spellcasting?.type]);

  const markPreparationUsed = useCallback(() => {
    setCanPrepareSpells(false);
  }, []);

  // ── Listen for restGrant events (DM grants rest via WebSocket) ─
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (detail: { restType?: "short" | "long"; type?: "short" | "long"; rest_type?: "short" | "long" }) => {
      const restType = detail.restType || detail.type || detail.rest_type;
      if (restType === 'long') {
        longRest();
      } else if (restType === 'short') {
        shortRest();
      }
    };
    return subscribeAppEvent('restGrant', handler);
  }, [longRest, shortRest]);

  return {
    ...spellsState,
    spellcasting,
    spellSlotsState: {
      remainingSlots,
      consumeSlot,
      recoverSlot,
      longRest,
      shortRest,
      setRemainingSlots: setRemainingSlotsExternal,
      canPrepareSpells,
      markPreparationUsed,
    } satisfies SpellSlotsState,
  } as const;
}
