import { campaignQueryKeys, fetchCampaignMembers } from "~/queries/campaignQueries";
import { getAppQueryClient } from "~/queries/queryClient";

export async function fetchCampaignMembersCached(
  campaignId: string | number,
  options?: { userId?: string; force?: boolean },
): Promise<any[]> {
  const queryClient = getAppQueryClient();
  const queryKey = campaignQueryKeys.members(campaignId);

  if (options?.force) {
    queryClient.removeQueries({ queryKey, exact: true });
  }

  return queryClient.fetchQuery({
    queryKey,
    queryFn: () => fetchCampaignMembers(campaignId),
    staleTime: 2_000,
  });
}

export function invalidateCampaignMembersCache(campaignId?: string | number, userId?: string) {
  if (campaignId == null) {
    getAppQueryClient().invalidateQueries({ queryKey: ["campaign-members"] });
    return;
  }

  getAppQueryClient().invalidateQueries({
    queryKey: campaignQueryKeys.members(campaignId),
    exact: true,
  });
}
