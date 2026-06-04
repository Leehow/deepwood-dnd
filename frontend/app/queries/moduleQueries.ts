import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "~/utils/api-client";

export interface CampaignModuleMap {
  id: string;
  name: string;
  url: string;
  chapter?: string;
  metadata?: Record<string, unknown> | null;
}

export const moduleQueryKeys = {
  all: ["module"] as const,
  campaignMaps: (campaignId: string | number) =>
    ["campaign-module-maps", String(campaignId)] as const,
};

export async function fetchCampaignModuleMaps(
  campaignId: string | number,
): Promise<CampaignModuleMap[]> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/module-maps`);
  if (!response.ok) {
    throw new Error(`Failed to load module maps: ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.maps) ? payload.maps : [];
}

export function useCampaignModuleMapsQuery(campaignId?: string, userId?: string) {
  return useQuery({
    queryKey: campaignId ? moduleQueryKeys.campaignMaps(campaignId) : ["campaign-module-maps", "empty"],
    queryFn: () => fetchCampaignModuleMaps(campaignId as string),
    enabled: !!campaignId,
    staleTime: 2_000,
    refetchOnWindowFocus: false,
  });
}
