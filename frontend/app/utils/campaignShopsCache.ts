import { apiFetch } from "~/utils/api-client";
import { createTimedRequestCache, type CachedRequestOptions } from "~/utils/requestCache";

const campaignShopsCache = createTimedRequestCache<any[]>(2_000);

function getCacheKey(campaignId: string | number, userId?: string) {
  return `${campaignId}:${userId ?? ""}`;
}

export async function fetchCampaignShopsCached(
  campaignId: string | number,
  options?: CachedRequestOptions & { userId?: string },
) {
  const cacheKey = getCacheKey(campaignId, options?.userId);
  return campaignShopsCache.fetch(
    cacheKey,
    async () => {
      const response = await apiFetch(`/api/shops/campaign/${campaignId}`, {
        userId: options?.userId,
      });
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
    options,
  );
}

export function invalidateCampaignShopsCache(
  campaignId?: string | number,
  userId?: string,
) {
  if (campaignId == null) {
    campaignShopsCache.invalidate();
    return;
  }

  if (userId !== undefined) {
    campaignShopsCache.invalidate(getCacheKey(campaignId, userId));
    return;
  }

  campaignShopsCache.invalidate((cacheKey) => cacheKey.startsWith(`${campaignId}:`));
}
