import { useQuery } from "@tanstack/react-query";

import type { RuntimeCampaignStorageRecord, RuntimeCombatStorage } from "~/types/runtime";
import { apiFetch } from "~/utils/api-client";

export type CombatRuntimeState = RuntimeCombatStorage;
export type CombatStorageResponse = RuntimeCampaignStorageRecord<CombatRuntimeState>;

export const combatQueryKeys = {
  all: ["combat"] as const,
  current: (campaignId: string | number) => ["combat-storage-current", String(campaignId)] as const,
};

export async function fetchCampaignCombatState(
  campaignId: string | number,
): Promise<CombatStorageResponse | null> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/storage/combat/current`);
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return payload && typeof payload === "object" ? payload : null;
}

export function useCampaignCombatStateQuery(campaignId?: string, _userId?: string) {
  return useQuery({
    queryKey: campaignId ? combatQueryKeys.current(campaignId) : ["combat-storage-current", "empty"],
    queryFn: () => fetchCampaignCombatState(campaignId as string),
    enabled: !!campaignId,
    staleTime: 10_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}
