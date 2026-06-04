import { apiFetch } from "~/utils/api-client";
import { createTimedRequestCache, type CachedRequestOptions } from "~/utils/requestCache";

const sidebarStateCache = createTimedRequestCache<any | null>(5_000);

function getCacheKey(
  campaignId: string | number,
  userId: string,
  role: "dm" | "player",
) {
  return `${campaignId}:${userId}:${role}`;
}

export async function fetchSidebarStateCached(
  campaignId: string | number,
  userId: string,
  role: "dm" | "player",
  options?: CachedRequestOptions,
) {
  const cacheKey = getCacheKey(campaignId, userId, role);
  return sidebarStateCache.fetch(
    cacheKey,
    async () => {
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/members/me/sidebar-state/${role}`,
      );
      if (!response.ok) {
        return null;
      }
      return response.json();
    },
    options,
  );
}

export function setSidebarStateCache(
  campaignId: string | number,
  userId: string,
  role: "dm" | "player",
  state: any,
) {
  sidebarStateCache.set(getCacheKey(campaignId, userId, role), state);
}

export function invalidateSidebarStateCache(
  campaignId?: string | number,
  userId?: string,
  role?: "dm" | "player",
) {
  if (campaignId == null) {
    sidebarStateCache.invalidate();
    return;
  }

  if (userId && role) {
    sidebarStateCache.invalidate(getCacheKey(campaignId, userId, role));
    return;
  }

  const prefix = `${campaignId}:${userId ?? ""}`;
  sidebarStateCache.invalidate((cacheKey) => cacheKey.startsWith(prefix));
}
