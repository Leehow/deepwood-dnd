/**
 * Client-side fetch interceptor to unify API base URL and authorization headers.
 * Rewrites hardcoded localhost URLs to the configured endpoint and injects
 * Authorization Bearer token for authenticated API calls.
 */
import { API_BASE_URL, getApiEndpoint } from "~/config/api";
import { getAuthToken } from "./auth";

type ApiFetchOptions = RequestInit & {
  skipAuth?: boolean;
  userId?: string; // Optional explicit user ID to override auth user
};

const LOCAL_API_HOST = "http://localhost:8174";
const nativeFetch = typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined;

/**
 * Normalize API URL: replace localhost host or relative /api paths with configured base.
 */
export function buildApiUrl(input: string | URL): { url: string; isApi: boolean } {
  let raw = typeof input === "string" ? input : input.toString();
  let isApi = false;

  if (raw.startsWith(LOCAL_API_HOST)) {
    const path = raw.slice(LOCAL_API_HOST.length);
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    raw = getApiEndpoint(normalizedPath);
    isApi = true;
  } else if (raw.startsWith("/api") || raw.startsWith("api/")) {
    raw = getApiEndpoint(raw);
    isApi = true;
  } else if (raw.startsWith(API_BASE_URL)) {
    isApi = true;
  }

  return { url: raw, isApi };
}

async function performFetch(
  targetFetch: typeof fetch,
  input: RequestInfo | URL,
  init?: ApiFetchOptions
): Promise<Response> {
  let requestInit: ApiFetchOptions = { ...init };
  let targetInput: RequestInfo | URL = input;

  // Preserve Request options when a Request object is passed in
  if (input instanceof Request) {
    const clonedHeaders = new Headers(input.headers);
    const mergedHeaders = new Headers(requestInit.headers || clonedHeaders);
    requestInit = {
      method: requestInit.method || input.method,
      headers: mergedHeaders,
      body: requestInit.body || input.body,
      mode: requestInit.mode || input.mode,
      credentials: requestInit.credentials || input.credentials,
      cache: requestInit.cache || input.cache,
      redirect: requestInit.redirect || input.redirect,
      referrer: requestInit.referrer || input.referrer,
      referrerPolicy: requestInit.referrerPolicy || input.referrerPolicy,
      integrity: requestInit.integrity || input.integrity,
      keepalive: requestInit.keepalive || input.keepalive,
      signal: requestInit.signal || input.signal,
    };
    targetInput = input.url;
  }

  const { url, isApi } = buildApiUrl(
    targetInput instanceof URL ? targetInput.toString() : (targetInput as string)
  );

  const headers = new Headers(requestInit.headers || {});
  if (isApi && !requestInit.skipAuth && !headers.has("Authorization")) {
    const token = getAuthToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  // Legacy compatibility only. `userId` is ignored for transport identity in Phase 3.

  // Only override URL; leave other options untouched
  if (input instanceof Request) {
    const request = new Request(url, { ...requestInit, headers });
    return targetFetch(request);
  }

  return targetFetch(url, { ...requestInit, headers });
}

/**
 * Fetch helper that normalizes API URLs and injects auth headers
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: ApiFetchOptions
): Promise<Response> {
  if (!nativeFetch) {
    throw new Error("Fetch API is not available in this environment");
  }
  return performFetch(nativeFetch, input, init);
}

/**
 * Patch window.fetch to:
 * - rewrite localhost API URLs to the configured API base
 * - default to /api prefix handling
 * - attach Authorization header for API calls unless explicitly skipped
 */
export function installApiFetchInterceptor(): void {
  if (typeof window === "undefined") return;
  if ((window as any).__API_FETCH_PATCHED__) return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: ApiFetchOptions): Promise<Response> =>
    performFetch(originalFetch, input, init);

  (window as any).__API_FETCH_PATCHED__ = true;
}
