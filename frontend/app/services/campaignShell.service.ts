import {
  campaignQueryKeys,
  fetchCampaignDetail,
  fetchCampaignMapBulkData,
  fetchCampaignMapSettings,
} from "~/queries/campaignQueries";
import { fetchCampaignCombatStateCached } from "~/utils/combatStateCache";
import { primeCampaignMapTokensCache } from "~/utils/mapTokensCache";
import { getAppQueryClient } from "~/queries/queryClient";

export interface CampaignShellLoadResult {
  status: number;
  campaign: any | null;
  mapSettings: any | null;
  combatState: any | null;
  mapBulkData: any | null;
}

export const campaignShellService = {
  async loadState(
    campaignId: string | number,
    options?: { userId?: string },
  ): Promise<CampaignShellLoadResult> {
    const queryClient = getAppQueryClient();
    const campaign = await queryClient.fetchQuery({
      queryKey: campaignQueryKeys.detail(campaignId),
      queryFn: () => fetchCampaignDetail(campaignId),
      staleTime: 30_000,
    });

    if (!campaign) {
      return {
        status: 404,
        campaign: null,
        mapSettings: null,
        combatState: null,
        mapBulkData: null,
      };
    }

    const currentMapUrl = typeof campaign.current_map_url === "string" ? campaign.current_map_url : null;

    const mapSettingsPromise = currentMapUrl
      ? queryClient
          .fetchQuery({
            queryKey: campaignQueryKeys.mapSettings(campaignId, currentMapUrl),
            queryFn: () => fetchCampaignMapSettings(campaignId, currentMapUrl),
            staleTime: 10_000,
          })
          .catch(() => null)
      : Promise.resolve(null);

    const combatStatePromise = fetchCampaignCombatStateCached(campaignId).catch(() => null);
    const mapBulkDataPromise = currentMapUrl
      ? queryClient
          .fetchQuery({
            queryKey: campaignQueryKeys.mapBulkData(campaignId, currentMapUrl),
            queryFn: () => fetchCampaignMapBulkData(campaignId, currentMapUrl),
            staleTime: 10_000,
          })
          .catch(() => null)
      : Promise.resolve(null);

    const [mapSettings, combatState, mapBulkData] = await Promise.all([
      mapSettingsPromise,
      combatStatePromise,
      mapBulkDataPromise,
    ]);

    if (currentMapUrl && mapBulkData?.tokens) {
      primeCampaignMapTokensCache(campaignId, currentMapUrl, { tokens: mapBulkData.tokens });
    }

    return {
      status: 200,
      campaign,
      mapSettings,
      combatState,
      mapBulkData,
    };
  },
};
