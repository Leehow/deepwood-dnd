import { getApiEndpoint } from "~/config/api";

const TEMP_QUERY_KEYS = [
  "Expires",
  "OSSAccessKeyId",
  "Signature",
  "x-oss-signature",
  "x-oss-expires",
  "x-oss-credential",
];

function appendCanvasQuery(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_canvas=1`;
}

function hasTemporarySignature(url: URL): boolean {
  return TEMP_QUERY_KEYS.some((key) => url.searchParams.has(key));
}

export function shouldProxyCanvasImageUrl(rawUrl: string): boolean {
  if (!rawUrl || rawUrl.startsWith("data:image/")) return false;
  if (!/^https?:\/\//i.test(rawUrl)) return false;

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();

    if (hasTemporarySignature(parsed)) return true;
    if (host.includes("dashscope") && host.includes("oss-")) return true;
    if (host.includes("oss-accelerate")) return true;

    return false;
  } catch {
    return false;
  }
}

export function getCanvasImageUrl(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) return null;
  if (rawUrl.startsWith("data:image/")) return rawUrl;

  if (shouldProxyCanvasImageUrl(rawUrl)) {
    return getApiEndpoint(`/api/media/image-proxy?url=${encodeURIComponent(rawUrl)}`);
  }

  return appendCanvasQuery(rawUrl);
}
