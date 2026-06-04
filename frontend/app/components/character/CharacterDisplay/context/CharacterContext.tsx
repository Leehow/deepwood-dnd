import React, { createContext, useContext, useMemo } from "react";
import { useCharacterComputed } from "../hooks/useCharacterComputed";
import type { Character, CharacterComputed, EquipmentItem, Currency } from "../types/Character";
import equipmentData from "~/data/rules/equipment.json";

export interface CharacterContextValue {
  character: Character;
  campaignId: string;
  currentMapUrl: string | null;
  userId: string;
  isDM: boolean;
  computed: CharacterComputed;
  // Common equipment metadata sets
  focusIds: Set<string>;
  lightSourceIds: Set<string>;
  showToast?: (message: string, type?: "success" | "error" | "info") => void;
  persistCharacterPartial?: (
    nextEquipment?: EquipmentItem[] | undefined,
    nextPreparedSpells?: string[] | undefined,
    nextCurrency?: Currency | undefined,
  ) => Promise<boolean | any>;
}

const CharacterContext = createContext<CharacterContextValue | undefined>(undefined);

export interface CharacterProviderProps {
  character: Character;
  campaignId: string;
  currentMapUrl: string | null;
  userId: string;
  isDM?: boolean;
  showToast?: (message: string, type?: "success" | "error" | "info") => void;
  persistCharacterPartial?: (
    nextEquipment?: EquipmentItem[] | undefined,
    nextPreparedSpells?: string[] | undefined,
    nextCurrency?: Currency | undefined,
  ) => Promise<boolean | any>;
  children: React.ReactNode;
}

export function CharacterProvider({
  character,
  campaignId,
  currentMapUrl,
  userId,
  isDM = false,
  showToast,
  persistCharacterPartial,
  children,
}: CharacterProviderProps) {
  const computed = useCharacterComputed(character);

  // Equipment metadata sets for summaries
  const focusIds = useMemo(() => new Set<string>([
    ...(((equipmentData as any)?.adventuringGear?.arcaneFocus) || []).map((i: any) => i.id),
    ...(((equipmentData as any)?.adventuringGear?.druidicFocus) || []).map((i: any) => i.id),
    ...(((equipmentData as any)?.adventuringGear?.holySymbol) || []).map((i: any) => i.id),
  ]), []);
  const lightSourceIds = useMemo(() => new Set<string>(
    ((((equipmentData as any)?.adventuringGear?.lightSources) || []).map((i: any) => i.id))
  ), []);

  const value = useMemo< CharacterContextValue >(() => ({
    character,
    campaignId,
    currentMapUrl,
    userId,
    isDM,
    computed,
    focusIds,
    lightSourceIds,
    showToast,
    persistCharacterPartial,
  }), [character, campaignId, currentMapUrl, userId, isDM, showToast, persistCharacterPartial, computed, focusIds, lightSourceIds]);

  return (
    <CharacterContext.Provider value={value}>
      {children}
    </CharacterContext.Provider>
  );
}

export function useCharacterContext(): CharacterContextValue {
  const ctx = useContext(CharacterContext);
  if (!ctx) throw new Error("useCharacterContext must be used within CharacterProvider");
  return ctx;
}

