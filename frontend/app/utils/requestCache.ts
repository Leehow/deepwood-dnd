interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export interface CachedRequestOptions {
  force?: boolean;
  ttlMs?: number;
}

export function createTimedRequestCache<T>(defaultTtlMs: number) {
  const cache = new Map<string, CacheEntry<T>>();
  const pendingRequests = new Map<string, Promise<T>>();

  const fetch = async (
    cacheKey: string,
    fetcher: () => Promise<T>,
    options?: CachedRequestOptions,
  ): Promise<T> => {
    const ttlMs = options?.ttlMs ?? defaultTtlMs;

    if (!options?.force) {
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ttlMs) {
        return cached.data;
      }
    }

    const pending = pendingRequests.get(cacheKey);
    if (pending) {
      return pending;
    }

    const request = fetcher()
      .then((data) => {
        cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
      })
      .finally(() => {
        pendingRequests.delete(cacheKey);
      });

    pendingRequests.set(cacheKey, request);
    return request;
  };

  const set = (cacheKey: string, data: T) => {
    cache.set(cacheKey, { data, timestamp: Date.now() });
  };

  const invalidate = (matcher?: string | ((cacheKey: string) => boolean)) => {
    if (matcher == null) {
      cache.clear();
      return;
    }

    if (typeof matcher === "string") {
      cache.delete(matcher);
      return;
    }

    for (const cacheKey of cache.keys()) {
      if (matcher(cacheKey)) {
        cache.delete(cacheKey);
      }
    }
  };

  return {
    fetch,
    set,
    invalidate,
  };
}
