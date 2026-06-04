import { subscribeAppEvent } from "~/events/appEventBus";
import { characterQueryKeys, fetchCharacterResources } from "~/queries/characterQueries";
import { getAppQueryClient } from "~/queries/queryClient";

export async function fetchCharacterResourcesCached(
  characterId: number,
  options?: { userId?: string; force?: boolean },
) {
  const queryClient = getAppQueryClient();
  const queryKey = characterQueryKeys.resources(characterId);

  if (options?.force) {
    queryClient.removeQueries({ queryKey, exact: true });
  }

  const payload = await queryClient.fetchQuery({
    queryKey,
    queryFn: () => fetchCharacterResources(characterId),
    staleTime: 1_000,
  });
  return payload.resources;
}

export function setCharacterResourcesCache(
  characterId: number,
  resources: any[],
  userId?: string,
) {
  getAppQueryClient().setQueryData(
    characterQueryKeys.resources(characterId),
    { resources, abilities: [] },
  );
}

export function invalidateCharacterResourcesCache(
  characterId?: number,
  userId?: string,
) {
  if (characterId == null) {
    getAppQueryClient().invalidateQueries({ queryKey: ["characterResources"] });
    return;
  }

  getAppQueryClient().invalidateQueries({
    queryKey: ["characterResources", characterId],
  });
}

if (typeof window !== "undefined" && !(window as any).__CHARACTER_RESOURCES_CACHE_EVENTS__) {
  subscribeAppEvent("classFeatureUsesUpdated", (detail) => {
    const characterId = detail?.characterId;
    if (typeof characterId === "number") {
      invalidateCharacterResourcesCache(characterId);
    } else {
      invalidateCharacterResourcesCache();
    }
  });
  (window as any).__CHARACTER_RESOURCES_CACHE_EVENTS__ = true;
}
