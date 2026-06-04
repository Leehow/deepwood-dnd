/**
 * API Configuration
 * Uses environment variables for backend URL
 */

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

// Get API URL from environment variables with fallback
const getApiUrl = () => {
  // For development, use Vite env vars (VITE_API_URL)
  // For production, this would come from the deployed environment
  const base = import.meta.env.VITE_API_URL || "http://localhost:8174";
  return normalizeBaseUrl(base);
};

export const API_BASE_URL = getApiUrl();

const getWsBaseUrl = () => {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  const base = configured || API_BASE_URL.replace(/^http/, "ws");
  return normalizeBaseUrl(base);
};

export const API_WS_BASE_URL = getWsBaseUrl();

/**
 * Get full API endpoint URL
 * @param endpoint - API endpoint path (e.g., '/api/campaigns/3/module-maps')
 * @returns Full API URL
 */
export const getApiEndpoint = (endpoint: string): string => {
  if (!endpoint) {
    return API_BASE_URL;
  }

  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint;
  }

  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  return `${API_BASE_URL}${normalizedEndpoint}`;
};

/**
 * Build WebSocket endpoint from API/WS base
 * @param endpoint - websocket path, e.g. '/ws/{campaignId}'
 */
export const getWebSocketEndpoint = (endpoint: string): string => {
  if (!endpoint) {
    return API_WS_BASE_URL;
  }

  if (endpoint.startsWith("ws://") || endpoint.startsWith("wss://")) {
    return endpoint;
  }

  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  return `${API_WS_BASE_URL}${normalizedEndpoint}`;
};
