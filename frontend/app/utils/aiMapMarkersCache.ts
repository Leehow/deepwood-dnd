import { apiFetch } from "~/utils/api-client";
import { createTimedRequestCache, type CachedRequestOptions } from "~/utils/requestCache";

type CachedMapMarker = {
  x: string;
  y: string;
  label: string;
  content: string;
};

const aiMapMarkersCache = createTimedRequestCache<CachedMapMarker[]>(2_000);

function getCacheKey(campaignId: number, mapUrl: string) {
  return `${campaignId}:${mapUrl}`;
}

export async function fetchAIMapMarkersCached(
  campaignId: number,
  mapUrl: string,
  options?: CachedRequestOptions & { userId?: string },
) {
  return aiMapMarkersCache.fetch(
    getCacheKey(campaignId, mapUrl),
    async () => {
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/ai-map-markers?map_url=${encodeURIComponent(mapUrl)}`,
        { userId: options?.userId },
      );
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return Array.isArray(data?.markers) ? data.markers : [];
    },
    options,
  );
}

export function setAIMapMarkersCache(
  campaignId: number,
  mapUrl: string,
  markers: CachedMapMarker[],
) {
  aiMapMarkersCache.set(getCacheKey(campaignId, mapUrl), markers);
}

export function invalidateAIMapMarkersCache(campaignId?: number, mapUrl?: string) {
  if (campaignId == null) {
    aiMapMarkersCache.invalidate();
    return;
  }

  if (mapUrl) {
    aiMapMarkersCache.invalidate(getCacheKey(campaignId, mapUrl));
    return;
  }

  aiMapMarkersCache.invalidate((cacheKey) => cacheKey.startsWith(`${campaignId}:`));
}
