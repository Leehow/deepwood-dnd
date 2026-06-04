import { apiFetch } from "~/utils/api-client";

interface BlobCacheEntry {
  url?: string;
  refs: number;
  inflight?: Promise<string>;
}

const moduleAssetBlobCache = new Map<string, BlobCacheEntry>();
const moduleAssetDataUrlCache = new Map<string, Promise<string>>();

function buildAssetKey(moduleId: string, assetPath: string) {
  return `${moduleId}::${assetPath}`;
}

async function fetchModuleAssetObjectUrl(moduleId: string, assetPath: string): Promise<string> {
  const response = await apiFetch(
    `/api/modules/parsed/${moduleId}/asset?path=${encodeURIComponent(assetPath)}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to load module asset: ${response.status}`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to convert blob to data URL"));
      }
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

export async function fetchModuleAssetDataUrl(moduleId: string, assetPath: string): Promise<string> {
  const key = buildAssetKey(moduleId, assetPath);
  const cached = moduleAssetDataUrlCache.get(key);
  if (cached) {
    return cached;
  }

  const task = apiFetch(
    `/api/modules/parsed/${moduleId}/asset?path=${encodeURIComponent(assetPath)}`,
  )
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load module asset: ${response.status}`);
      }
      const blob = await response.blob();
      return blobToDataUrl(blob);
    })
    .catch((error) => {
      moduleAssetDataUrlCache.delete(key);
      throw error;
    });

  moduleAssetDataUrlCache.set(key, task);
  return task;
}

export async function retainModuleAssetBlobUrl(moduleId: string, assetPath: string): Promise<string> {
  const key = buildAssetKey(moduleId, assetPath);
  const cached = moduleAssetBlobCache.get(key);
  if (cached?.url) {
    cached.refs += 1;
    return cached.url;
  }
  if (cached?.inflight) {
    cached.refs += 1;
    return cached.inflight;
  }

  const entry: BlobCacheEntry = { refs: 1 };
  entry.inflight = fetchModuleAssetObjectUrl(moduleId, assetPath)
    .then((url) => {
      entry.url = url;
      entry.inflight = undefined;
      return url;
    })
    .catch((error) => {
      moduleAssetBlobCache.delete(key);
      throw error;
    });

  moduleAssetBlobCache.set(key, entry);
  return entry.inflight;
}

export function releaseModuleAssetBlobUrl(moduleId: string, assetPath: string): void {
  const key = buildAssetKey(moduleId, assetPath);
  const entry = moduleAssetBlobCache.get(key);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs <= 0) {
    if (entry.url) {
      URL.revokeObjectURL(entry.url);
    }
    moduleAssetBlobCache.delete(key);
  }
}

export function clearModuleAssetBlobCache(): void {
  for (const entry of moduleAssetBlobCache.values()) {
    if (entry.url) {
      URL.revokeObjectURL(entry.url);
    }
  }
  moduleAssetBlobCache.clear();
  moduleAssetDataUrlCache.clear();
}
