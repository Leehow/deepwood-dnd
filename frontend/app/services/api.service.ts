/**
 * Base API Service
 * Provides common HTTP methods and error handling
 */

import { API_BASE_URL } from '~/config/api';
import { createLogger } from '~/utils/logger';
import { getAuthToken } from '~/utils/auth';

const logger = createLogger('APIService');

export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export interface RequestConfig {
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean>;
  timeout?: number;
  signal?: AbortSignal;
}

export class BaseAPIService {
  protected baseUrl: string;
  protected defaultHeaders: Record<string, string>;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || API_BASE_URL;
    this.defaultHeaders = {
      'Content-Type': 'application/json'
    };
  }

  /**
   * Set authentication headers
   */
  setAuthHeaders(_userId: string, _role?: string): void {
    // Phase 3 standard is bearer-only transport. Keep this no-op for compatibility.
  }

  /**
   * Clear authentication headers
   */
  clearAuthHeaders(): void {
    // Phase 3 standard is bearer-only transport. Keep this no-op for compatibility.
  }

  /**
   * Build URL with query parameters
   */
  protected buildUrl(path: string, params?: Record<string, string | number | boolean>): string {
    // Normalize base URL and path
    const normalizedBase = this.baseUrl.replace(/\/+$/, '');
    let normalizedPath = path.startsWith('/') ? path : `/${path}`;

    // Handle duplicate /api prefix - if base ends with /api and path starts with /api, strip from path
    if (normalizedBase.endsWith('/api') && normalizedPath.startsWith('/api/')) {
      normalizedPath = normalizedPath.substring(4); // Remove '/api' prefix
    }

    // Concatenate base and path manually to avoid URL constructor's absolute path behavior
    let fullPath = `${normalizedBase}${normalizedPath}`;

    // Add origin if needed for URL parsing
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const url = new URL(fullPath, origin);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });
    }

    return url.toString();
  }

  protected buildHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
    const headers = { ...this.defaultHeaders, ...extraHeaders };
    const token = getAuthToken();
    if (token && !headers.Authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Handle HTTP response
   */
  protected async handleResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type');

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      let errorDetails: unknown;

      try {
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
          errorDetails = errorData;
        } else {
          errorMessage = await response.text();
        }
      } catch (e) {
        logger.error('Failed to parse error response', e);
      }

      logger.error(`API Error: ${errorMessage}`, { status: response.status, details: errorDetails });
      throw new APIError(errorMessage, response.status, undefined, errorDetails);
    }

    if (response.status === 204) {
      return {} as T;
    }

    try {
      if (contentType?.includes('application/json')) {
        return await response.json();
      } else {
        return await response.text() as unknown as T;
      }
    } catch (e) {
      logger.error('Failed to parse response', e);
      throw new APIError('Failed to parse response', response.status);
    }
  }

  /**
   * GET request
   */
  async get<T>(path: string, config?: RequestConfig): Promise<T> {
    const url = this.buildUrl(path, config?.params);
    const headers = this.buildHeaders(config?.headers);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: config?.signal
      });

      return await this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof APIError) throw error;
      logger.error('GET request failed', error);
      throw new APIError('Network request failed', 0, 'NETWORK_ERROR', error);
    }
  }

  /**
   * POST request
   */
  async post<T>(path: string, data?: unknown, config?: RequestConfig): Promise<T> {
    const url = this.buildUrl(path, config?.params);
    const headers = this.buildHeaders(config?.headers);

    logger.debug(`POST ${url}`, data);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: data ? JSON.stringify(data) : undefined,
        signal: config?.signal
      });

      return await this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof APIError) throw error;
      logger.error('POST request failed', error);
      throw new APIError('Network request failed', 0, 'NETWORK_ERROR', error);
    }
  }

  /**
   * PUT request
   */
  async put<T>(path: string, data?: unknown, config?: RequestConfig): Promise<T> {
    const url = this.buildUrl(path, config?.params);
    const headers = this.buildHeaders(config?.headers);

    logger.debug(`PUT ${url}`, data);

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: data ? JSON.stringify(data) : undefined,
        signal: config?.signal
      });

      return await this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof APIError) throw error;
      logger.error('PUT request failed', error);
      throw new APIError('Network request failed', 0, 'NETWORK_ERROR', error);
    }
  }

  /**
   * PATCH request
   */
  async patch<T>(path: string, data?: unknown, config?: RequestConfig): Promise<T> {
    const url = this.buildUrl(path, config?.params);
    const headers = this.buildHeaders(config?.headers);

    logger.debug(`PATCH ${url}`, data);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: data ? JSON.stringify(data) : undefined,
        signal: config?.signal
      });

      return await this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof APIError) throw error;
      logger.error('PATCH request failed', error);
      throw new APIError('Network request failed', 0, 'NETWORK_ERROR', error);
    }
  }

  /**
   * DELETE request
   */
  async delete<T>(path: string, config?: RequestConfig): Promise<T> {
    const url = this.buildUrl(path, config?.params);
    const headers = this.buildHeaders(config?.headers);

    logger.debug(`DELETE ${url}`);

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers,
        signal: config?.signal
      });

      return await this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof APIError) throw error;
      logger.error('DELETE request failed', error);
      throw new APIError('Network request failed', 0, 'NETWORK_ERROR', error);
    }
  }

  /**
   * Upload file
   */
  async upload<T>(path: string, file: File, config?: RequestConfig): Promise<T> {
    const url = this.buildUrl(path, config?.params);
    const formData = new FormData();
    formData.append('file', file);

    // Don't set Content-Type for multipart/form-data
    const headers = this.buildHeaders(config?.headers);
    delete headers['Content-Type'];

    logger.debug(`UPLOAD ${url}`, { fileName: file.name, fileSize: file.size });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
        signal: config?.signal
      });

      return await this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof APIError) throw error;
      logger.error('Upload failed', error);
      throw new APIError('Upload failed', 0, 'UPLOAD_ERROR', error);
    }
  }
}

// Singleton instance
export const apiService = new BaseAPIService();
