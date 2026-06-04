import { combatQueryKeys, fetchCampaignCombatState } from "~/queries/combatQueries";
import { getAppQueryClient } from "~/queries/queryClient";

export async function fetchCampaignCombatStateCached(
  campaignId: string | number,
  options?: { userId?: string; force?: boolean },
) {
  const queryClient = getAppQueryClient();
  const queryKey = combatQueryKeys.current(campaignId);

  if (options?.force) {
    queryClient.removeQueries({ queryKey, exact: true });
  }

  return queryClient.fetchQuery({
    queryKey,
    queryFn: () => fetchCampaignCombatState(campaignId),
    staleTime: 10_000,
  });
}

export function invalidateCampaignCombatStateCache(
  campaignId?: string | number,
  _userId?: string,
) {
  if (campaignId == null) {
    getAppQueryClient().invalidateQueries({ queryKey: ["combat-storage-current"] });
    return;
  }

  getAppQueryClient().invalidateQueries({
    queryKey: ["combat-storage-current", String(campaignId)],
  });
}
