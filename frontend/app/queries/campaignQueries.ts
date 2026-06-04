import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "~/utils/api-client";
import { fetchCharacterDetails, characterQueryKeys } from "~/queries/characterQueries";
import { getAppQueryClient } from "~/queries/queryClient";

export interface CampaignMemberRecord {
  id?: number;
  user_id: string;
  role?: string;
  selected_character_id?: number | null;
  is_virtual?: boolean;
  display_name?: string | null;
  [key: string]: unknown;
}

export interface CampaignRosterItem {
  user_id: string;
  role?: string;
  selected_character_id: number | null;
  character: any | null;
  is_virtual: boolean;
  display_name: string | null;
  member_id?: number;
}

export interface CampaignDetailRecord {
  id: number;
  name: string;
  current_map_url?: string | null;
  selected_module_id?: string | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface CampaignRuleOptionsRecord {
  [key: string]: unknown;
}

export interface CampaignMapSettingsRecord {
  id?: number;
  campaign_id: number;
  map_url: string;
  scale?: number;
  grid_unit_length?: number;
  global_terrain?: string | null;
  [key: string]: unknown;
}

export interface CampaignMapBulkDataRecord {
  tokens?: unknown[];
  fog?: Record<string, unknown> | null;
  terrain?: Record<string, unknown> | null;
  rulers?: unknown[];
  drawings?: unknown[];
  markers?: unknown[];
  ai_markers?: Record<string, unknown> | null;
  map_settings?: Record<string, unknown> | null;
  view_state?: Record<string, unknown> | null;
}

export const campaignQueryKeys = {
  all: ["campaign"] as const,
  detail: (campaignId: string | number) => ["campaign-detail", String(campaignId)] as const,
  ruleOptions: (campaignId: string | number) => ["campaign-rule-options", String(campaignId)] as const,
  mapSettings: (campaignId: string | number, mapUrl: string) =>
    ["campaign-map-settings", String(campaignId), mapUrl] as const,
  mapBulkData: (campaignId: string | number, mapUrl: string) =>
    ["campaign-map-bulk-data", String(campaignId), mapUrl] as const,
  members: (campaignId: string | number) => ["campaign-members", String(campaignId)] as const,
  roster: (campaignId: string | number, userId?: string) =>
    ["campaign-roster", String(campaignId), userId ?? ""] as const,
};

export async function fetchCampaignDetail(
  campaignId: string | number,
): Promise<CampaignDetailRecord | null> {
  const response = await apiFetch(`/api/campaigns/${campaignId}`);
  if (!response.ok) {
    return null;
  }
  const payload = await response.json();
  return payload && typeof payload === "object" ? payload : null;
}

export async function fetchCampaignRuleOptions(
  campaignId: string | number,
): Promise<CampaignRuleOptionsRecord | null> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/rule-options`);
  if (!response.ok) {
    return null;
  }
  const payload = await response.json();
  return payload && typeof payload === "object" ? payload : null;
}

export async function fetchCampaignMapSettings(
  campaignId: string | number,
  mapUrl: string,
): Promise<CampaignMapSettingsRecord | null> {
  const response = await apiFetch(
    `/api/map-settings/${campaignId}/${encodeURIComponent(mapUrl)}`,
  );
  if (!response.ok) {
    return null;
  }
  const payload = await response.json();
  return payload && typeof payload === "object" ? payload : null;
}

export async function fetchCampaignMapBulkData(
  campaignId: string | number,
  mapUrl: string,
): Promise<CampaignMapBulkDataRecord | null> {
  const response = await apiFetch(
    `/api/campaigns/${campaignId}/map-bulk-data?map_url=${encodeURIComponent(mapUrl)}`,
  );
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return payload && typeof payload === "object" ? payload : null;
}

export async function fetchCampaignMembers(
  campaignId: string | number,
): Promise<CampaignMemberRecord[]> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/members`);
  if (!response.ok) {
    throw new Error(`Failed to load campaign members: ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

export async function fetchCampaignRoster(
  campaignId: string | number,
  options?: { userId?: string },
): Promise<CampaignRosterItem[]> {
  const members = await fetchCampaignMembers(campaignId);
  const visibleMembers = members.filter(
    (member) => member.role === "player" || member.user_id === options?.userId,
  );

  return Promise.all(
    visibleMembers.map(async (member) => {
      const characterId = member.selected_character_id ?? null;
      const character = characterId
        ? await getAppQueryClient()
            .fetchQuery({
              queryKey: characterQueryKeys.detail(characterId),
              queryFn: () => fetchCharacterDetails(characterId),
              staleTime: 30 * 1000,
            })
            .catch(() => null)
        : null;

      return {
        user_id: member.user_id,
        role: member.role,
        selected_character_id: characterId,
        character,
        is_virtual: !!member.is_virtual,
        display_name: member.display_name ?? null,
        member_id: member.id,
      };
    }),
  );
}

export function useCampaignRosterQuery(campaignId?: string, userId?: string) {
  return useQuery({
    queryKey: campaignId ? campaignQueryKeys.roster(campaignId, userId) : ["campaign-roster", "empty"],
    queryFn: () => fetchCampaignRoster(campaignId as string, { userId }),
    enabled: !!campaignId,
    staleTime: 30 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}

export function useCampaignDetailQuery(campaignId?: string) {
  return useQuery({
    queryKey: campaignId ? campaignQueryKeys.detail(campaignId) : ["campaign-detail", "empty"],
    queryFn: () => fetchCampaignDetail(campaignId as string),
    enabled: !!campaignId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useCampaignRuleOptionsQuery(campaignId?: string) {
  return useQuery({
    queryKey: campaignId ? campaignQueryKeys.ruleOptions(campaignId) : ["campaign-rule-options", "empty"],
    queryFn: () => fetchCampaignRuleOptions(campaignId as string),
    enabled: !!campaignId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
