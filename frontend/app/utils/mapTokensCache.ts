import { getAppQueryClient } from "~/queries/queryClient";
import { apiFetch } from "~/utils/api-client";

interface MapTokensPayload {
  tokens: any[];
  [key: string]: unknown;
}

const DEFAULT_STALE_TIME_MS = 10_000;

export function buildMapTokensQueryKey(campaignId: string | number, mapUrl: string) {
  return ["campaign-map-tokens", String(campaignId), mapUrl] as const;
}

function normalizeTokensPayload(data: unknown): MapTokensPayload {
  if (Array.isArray(data)) {
    return { tokens: data };
  }
  if (data && typeof data === "object") {
    return data as MapTokensPayload;
  }
  return { tokens: [] };
}

async function fetchCampaignMapTokens(
  campaignId: string | number,
  mapUrl: string,
): Promise<MapTokensPayload> {
  const response = await apiFetch(
    `/api/tokens/campaign/${campaignId}/map?map_url=${encodeURIComponent(mapUrl)}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to load map tokens: ${response.status}`);
  }
  return normalizeTokensPayload(await response.json());
}

export async function fetchCampaignMapTokensCached(
  campaignId: string | number,
  mapUrl: string,
  options?: { userId?: string; force?: boolean; ttlMs?: number },
) {
  void options?.userId; // legacy compatibility: bearer-only transport does not use explicit userId
  const queryClient = getAppQueryClient();
  const queryKey = buildMapTokensQueryKey(campaignId, mapUrl);

  if (options?.force) {
    await queryClient.invalidateQueries({ queryKey, exact: true });
  }

  return queryClient.fetchQuery({
    queryKey,
    queryFn: () => fetchCampaignMapTokens(campaignId, mapUrl),
    staleTime: options?.ttlMs ?? DEFAULT_STALE_TIME_MS,
  });
}

export function primeCampaignMapTokensCache(
  campaignId: string | number,
  mapUrl: string,
  payload: unknown,
) {
  const queryClient = getAppQueryClient();
  queryClient.setQueryData(
    buildMapTokensQueryKey(campaignId, mapUrl),
    normalizeTokensPayload(payload),
  );
}

export function invalidateCampaignMapTokensCache(
  campaignId?: string | number,
  mapUrl?: string,
  userId?: string,
) {
  void userId; // legacy compatibility
  const queryClient = getAppQueryClient();

  if (campaignId == null) {
    void queryClient.invalidateQueries({ queryKey: ["campaign-map-tokens"] });
    return;
  }

  if (!mapUrl) {
    void queryClient.invalidateQueries({
      queryKey: ["campaign-map-tokens", String(campaignId)],
    });
    return;
  }

  void queryClient.invalidateQueries({
    queryKey: buildMapTokensQueryKey(campaignId, mapUrl),
    exact: true,
  });
}
