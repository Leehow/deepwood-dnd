/**
 * Fetch wrapper with automatic retry and exponential backoff.
 */

interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  retryOn?: number[];
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_RETRY_ON = [408, 429, 500, 502, 503, 504];

/**
 * Fetch with automatic retry on failure.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    retryOn = DEFAULT_RETRY_ON,
    onRetry,
  } = retryOptions;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Check if we should retry based on status code
      if (!response.ok && retryOn.includes(response.status) && attempt < maxRetries) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        lastError = error;
        onRetry?.(attempt + 1, error);

        // Wait before retrying
        await sleep(getBackoffDelay(attempt, initialDelay, maxDelay));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Network errors - retry
      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, lastError);
        await sleep(getBackoffDelay(attempt, initialDelay, maxDelay));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * Calculate backoff delay with jitter.
 */
function getBackoffDelay(attempt: number, initial: number, max: number): number {
  const delay = Math.min(initial * Math.pow(2, attempt), max);
  const jitter = delay * 0.25 * Math.random();
  return Math.floor(delay + jitter);
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * API client with built-in retry and error handling.
 */
export class ApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private retryOptions: RetryOptions;

  constructor(
    baseUrl: string,
    defaultHeaders: Record<string, string> = {},
    retryOptions: RetryOptions = {}
  ) {
    this.baseUrl = baseUrl;
    this.defaultHeaders = defaultHeaders;
    this.retryOptions = retryOptions;
  }

  private getAuthHeader(): Record<string, string> {
    const token = typeof window !== 'undefined'
      ? localStorage.getItem('dnd_auth_token')
      : null;

    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetchWithRetry(
      `${this.baseUrl}${endpoint}`,
      {
        method: 'GET',
        headers: {
          ...this.defaultHeaders,
          ...this.getAuthHeader(),
          ...options?.headers,
        },
        ...options,
      },
      this.retryOptions
    );

    if (!response.ok) {
      throw await this.handleError(response);
    }

    return response.json();
  }

  async post<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    const response = await fetchWithRetry(
      `${this.baseUrl}${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.defaultHeaders,
          ...this.getAuthHeader(),
          ...options?.headers,
        },
        body: data ? JSON.stringify(data) : undefined,
        ...options,
      },
      this.retryOptions
    );

    if (!response.ok) {
      throw await this.handleError(response);
    }

    return response.json();
  }

  async put<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    const response = await fetchWithRetry(
      `${this.baseUrl}${endpoint}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...this.defaultHeaders,
          ...this.getAuthHeader(),
          ...options?.headers,
        },
        body: data ? JSON.stringify(data) : undefined,
        ...options,
      },
      this.retryOptions
    );

    if (!response.ok) {
      throw await this.handleError(response);
    }

    return response.json();
  }

  async delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetchWithRetry(
      `${this.baseUrl}${endpoint}`,
      {
        method: 'DELETE',
        headers: {
          ...this.defaultHeaders,
          ...this.getAuthHeader(),
          ...options?.headers,
        },
        ...options,
      },
      this.retryOptions
    );

    if (!response.ok) {
      throw await this.handleError(response);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  private async handleError(response: Response): Promise<Error> {
    let message = `HTTP ${response.status}`;

    try {
      const data = await response.json();
      message = data.detail || data.message || message;
    } catch {
      // Response is not JSON
    }

    const error = new Error(message);
    (error as any).status = response.status;
    return error;
  }
}

// Default API client instance
const API_BASE_URL = typeof window !== 'undefined'
  ? import.meta.env.VITE_API_URL || 'http://localhost:8174'
  : 'http://localhost:8174';

export const api = new ApiClient(API_BASE_URL, {}, {
  maxRetries: 3,
  initialDelay: 1000,
  onRetry: (attempt, error) => {
    console.log(`Retry attempt ${attempt}:`, error.message);
  },
});