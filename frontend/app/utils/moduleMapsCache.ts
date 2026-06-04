import { fetchCampaignModuleMaps, moduleQueryKeys } from "~/queries/moduleQueries";
import { getAppQueryClient } from "~/queries/queryClient";

export async function fetchCampaignModuleMapsCached(
  campaignId: string | number,
  options?: { userId?: string; force?: boolean },
) {
  const queryClient = getAppQueryClient();
  const queryKey = moduleQueryKeys.campaignMaps(campaignId);

  if (options?.force) {
    queryClient.removeQueries({ queryKey, exact: true });
  }

  return queryClient.fetchQuery({
    queryKey,
    queryFn: () => fetchCampaignModuleMaps(campaignId),
    staleTime: 2_000,
  });
}

export function setCampaignModuleMapsCache(
  campaignId: string | number,
  maps: any[],
  userId?: string,
) {
  getAppQueryClient().setQueryData(moduleQueryKeys.campaignMaps(campaignId), maps);
}

export function invalidateCampaignModuleMapsCache(
  campaignId?: string | number,
  userId?: string,
) {
  if (campaignId == null) {
    getAppQueryClient().invalidateQueries({ queryKey: ["campaign-module-maps"] });
    return;
  }

  getAppQueryClient().invalidateQueries({
    queryKey: ["campaign-module-maps", String(campaignId)],
  });
}
