import { apiFetch } from "~/utils/api-client";
import { createTimedRequestCache, type CachedRequestOptions } from "~/utils/requestCache";

const monsterInstancesCache = createTimedRequestCache<any[]>(2_000);

function getCacheKey(campaignId: string | number, userId?: string) {
  return `${campaignId}:${userId ?? ""}`;
}

export async function fetchCampaignMonsterInstancesCached(
  campaignId: string | number,
  options?: CachedRequestOptions & { userId?: string },
) {
  const cacheKey = getCacheKey(campaignId, options?.userId);
  return monsterInstancesCache.fetch(
    cacheKey,
    async () => {
      const response = await apiFetch(`/api/monster-instances/campaign/${campaignId}`, {
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

export function invalidateCampaignMonsterInstancesCache(
  campaignId?: string | number,
  userId?: string,
) {
  if (campaignId == null) {
    monsterInstancesCache.invalidate();
    return;
  }

  if (userId !== undefined) {
    monsterInstancesCache.invalidate(getCacheKey(campaignId, userId));
    return;
  }

  monsterInstancesCache.invalidate((cacheKey) => cacheKey.startsWith(`${campaignId}:`));
}
