import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "~/utils/api-client";

export interface CharacterResourceState {
  id: string;
  current?: number;
  max?: number;
  currentDiceType?: string | null;
  currentRechargeType?: string | null;
  [key: string]: unknown;
}

export interface CharacterResourcesPayload {
  resources: CharacterResourceState[];
  abilities: unknown[];
}

export const characterQueryKeys = {
  all: ["character"] as const,
  mine: (userId: string) => ["myCharacters", userId] as const,
  detail: (characterId: number) => ["characterDetails", characterId] as const,
  resources: (characterId: number) => ["characterResources", characterId] as const,
};

export async function fetchMyCharacters(_userId?: string) {
  const response = await apiFetch(`/api/characters`);
  if (!response.ok) {
    throw new Error(`Failed to load characters: ${response.status}`);
  }
  return response.json();
}

export async function fetchCharacterDetails(characterId: number) {
  const response = await apiFetch(`/api/characters/${characterId}`);
  if (!response.ok) {
    throw new Error(`Failed to load character details: ${response.status}`);
  }
  return response.json();
}

export async function fetchCharacterResources(characterId: number): Promise<CharacterResourcesPayload> {
  const response = await apiFetch(`/api/characters/${characterId}/resources`);
  if (!response.ok) {
    return { resources: [], abilities: [] };
  }

  const payload = await response.json();
  return {
    resources: Array.isArray(payload?.resources) ? payload.resources : [],
    abilities: Array.isArray(payload?.abilities) ? payload.abilities : [],
  };
}

export function useCharacterDetailsQuery(characterId: number | null, userId?: string) {
  return useQuery({
    queryKey: characterId ? characterQueryKeys.detail(characterId) : ["characterDetails", "empty"],
    queryFn: () => fetchCharacterDetails(characterId as number),
    enabled: !!characterId,
    staleTime: 2 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

export function useMyCharactersQuery(userId: string) {
  return useQuery({
    queryKey: characterQueryKeys.mine(userId),
    queryFn: () => fetchMyCharacters(userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

export function useCharacterResourcesQuery(characterId: number | null, userId?: string) {
  return useQuery({
    queryKey: characterId ? characterQueryKeys.resources(characterId) : ["characterResources", "empty"],
    queryFn: () => fetchCharacterResources(characterId as number),
    enabled: !!characterId,
    staleTime: 1_000,
    refetchOnWindowFocus: false,
  });
}
