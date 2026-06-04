/**
 * In-memory character data cache with short TTL.
 * Prevents duplicate `/api/characters/{id}` fetches across components
 * during the same page session (e.g., CharacterPanel + playerAvatars + useMapData).
 */

import { characterQueryKeys, fetchCharacterDetails } from "~/queries/characterQueries";
import { getAppQueryClient } from "~/queries/queryClient";

/**
 * Fetch character data with deduplication and short-lived cache.
 * Concurrent requests for the same ID share one network call.
 */
export async function fetchCharacterCached(
  characterId: number,
  options?: { userId?: string; force?: boolean },
): Promise<any | null> {
  const queryClient = getAppQueryClient();
  const queryKey = characterQueryKeys.detail(characterId);

  if (options?.force) {
    queryClient.removeQueries({ queryKey, exact: true });
  }

  try {
    return await queryClient.fetchQuery({
      queryKey,
      queryFn: () => fetchCharacterDetails(characterId),
      staleTime: 30_000,
    });
  } catch {
    return null;
  }
}

/** Invalidate cache for a specific character */
export function invalidateCharacterCache(characterId: number) {
  getAppQueryClient().invalidateQueries({ queryKey: characterQueryKeys.detail(characterId), exact: true });
}

/** Clear all cached characters */
export function clearCharacterCache() {
  getAppQueryClient().invalidateQueries({ queryKey: ["characterDetails"] });
}
