/**
 * Type-safe API client wrapper for D&D platform.
 * Provides fully typed request/response handling with error recovery.
 */

import { API_BASE_URL } from '~/config/api';
import type {
  Campaign,
  Character,
  DiceRequest,
  DiceRoll,
  MapData,
  Module,
  Shop,
  ShopInventoryItem,
} from '~/types';

// Type aliases for missing types
type User = { id: string; username: string; email?: string };
type ShopItem = ShopInventoryItem;

/**
 * API error with typed details
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Base request options
 */
interface RequestOptions extends Omit<RequestInit, 'body'> {
  params?: Record<string, string | number | boolean>;
  body?: any;
  token?: string;
}

/**
 * Type-safe API response
 */
type ApiResponse<T> = {
  success: true;
  data: T;
} | {
  success: false;
  error: ApiError;
};

/**
 * Base API client class
 */
class ApiClient {
  protected baseUrl: string;
  protected defaultHeaders: Record<string, string>;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    };
  }

  /**
   * Set authorization token
   */
  setToken(token: string): void {
    this.defaultHeaders = {
      ...this.defaultHeaders,
      'Authorization': `Bearer ${token}`,
    };
  }

  /**
   * Clear authorization token
   */
  clearToken(): void {
    const { Authorization, ...headers } = this.defaultHeaders;
    this.defaultHeaders = headers;
  }

  /**
   * Build URL with query parameters
   */
  private buildUrl(endpoint: string, params?: Record<string, string | number | boolean>): string {
    const url = new URL(`${this.baseUrl}${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  /**
   * Make typed API request
   */
  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const { params, body, token, ...fetchOptions } = options;

    const url = this.buildUrl(endpoint, params);

    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...(fetchOptions.headers as Record<string, string> | undefined),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config: RequestInit = {
      ...fetchOptions,
      headers,
    };

    if (body !== undefined) {
      config.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(
          errorData.detail || `HTTP ${response.status}`,
          response.status,
          errorData
        );
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(
        error instanceof Error ? error.message : 'Network error',
        0
      );
    }
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body });
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body });
  }

  /**
   * PATCH request
   */
  async patch<T>(endpoint: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body });
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

/**
 * Type-safe API methods
 */
export class TypedApiClient extends ApiClient {
  // User endpoints
  async getCurrentUser(): Promise<User> {
    return this.get<User>('/api/users/me');
  }

  async updateUser(userId: string, data: Partial<User>): Promise<User> {
    return this.put<User>(`/api/users/${userId}`, data);
  }

  // Campaign endpoints
  async getCampaigns(): Promise<Campaign[]> {
    return this.get<Campaign[]>('/api/campaigns');
  }

  async getCampaign(id: string): Promise<Campaign> {
    return this.get<Campaign>(`/api/campaigns/${id}`);
  }

  async createCampaign(data: {
    name: string;
    description?: string;
    setting?: string;
  }): Promise<Campaign> {
    return this.post<Campaign>('/api/campaigns', data);
  }

  async updateCampaign(id: string, data: Partial<Campaign>): Promise<Campaign> {
    return this.put<Campaign>(`/api/campaigns/${id}`, data);
  }

  async deleteCampaign(id: string): Promise<void> {
    return this.delete<void>(`/api/campaigns/${id}`);
  }

  // Character endpoints
  async getCharacters(campaignId: string): Promise<Character[]> {
    return this.get<Character[]>(`/api/campaigns/${campaignId}/characters`);
  }

  async getCharacter(id: string): Promise<Character> {
    return this.get<Character>(`/api/characters/${id}`);
  }

  async createCharacter(data: Partial<Character>): Promise<Character> {
    return this.post<Character>('/api/characters', data);
  }

  async updateCharacter(id: string, data: Partial<Character>): Promise<Character> {
    return this.put<Character>(`/api/characters/${id}`, data);
  }

  async deleteCharacter(id: string): Promise<void> {
    return this.delete<void>(`/api/characters/${id}`);
  }

  async levelUpCharacter(id: string, data: {
    new_level: number;
    hit_points_increase: number;
    ability_score_improvements?: Record<string, number>;
    new_features?: string[];
    new_spells?: string[];
  }): Promise<Character> {
    return this.post<Character>(`/api/characters/${id}/level-up`, data);
  }

  // Map endpoints
  async getMap(campaignId: string): Promise<MapData> {
    return this.get<MapData>(`/api/campaigns/${campaignId}/map`);
  }

  async updateMap(campaignId: string, data: Partial<MapData>): Promise<MapData> {
    return this.put<MapData>(`/api/campaigns/${campaignId}/map`, data);
  }

  // Dice endpoints
  async createDiceRequest(data: {
    campaign_id: string;
    request_type: string;
    description?: string;
    target_dc?: number;
    modifiers?: Record<string, any>;
  }): Promise<DiceRequest> {
    return this.post<DiceRequest>('/api/dice/request', data);
  }

  async submitDiceRoll(requestId: string, data: {
    dice_values: number[];
    roller_id: string;
  }): Promise<DiceRoll> {
    return this.post<DiceRoll>(`/api/dice/request/${requestId}/roll`, data);
  }

  async analyzeDiceRoll(requestId: string): Promise<{
    success: boolean;
    analysis: string;
    total: number;
  }> {
    return this.post(`/api/dice/request/${requestId}/analyze`);
  }

  // Module endpoints
  async getModules(): Promise<Module[]> {
    return this.get<Module[]>('/api/modules');
  }

  async getModule(id: string): Promise<Module> {
    return this.get<Module>(`/api/modules/${id}`);
  }

  async uploadModule(file: File): Promise<Module> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseUrl}/api/modules/upload`, {
      method: 'POST',
      headers: {
        'Authorization': (this.defaultHeaders as any).Authorization || '',
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(error.detail || 'Upload failed', response.status, error);
    }

    return response.json();
  }

  async parseModule(id: string): Promise<{ task_id: string }> {
    return this.post(`/api/modules/${id}/parse`);
  }

  async getParseStatus(id: string): Promise<{
    status: string;
    progress: number;
    current_stage?: string;
    error?: string;
  }> {
    return this.get(`/api/modules/${id}/parse-status`);
  }

  // Shop endpoints
  async getShops(campaignId: string): Promise<Shop[]> {
    return this.get<Shop[]>(`/api/campaigns/${campaignId}/shops`);
  }

  async getShop(id: string): Promise<Shop> {
    return this.get<Shop>(`/api/shops/${id}`);
  }

  async createShop(data: {
    campaign_id: string;
    name: string;
    description?: string;
    location?: string;
  }): Promise<Shop> {
    return this.post<Shop>('/api/shops', data);
  }

  async updateShop(id: string, data: Partial<Shop>): Promise<Shop> {
    return this.put<Shop>(`/api/shops/${id}`, data);
  }

  async addShopItem(shopId: string, item: ShopItem): Promise<ShopItem> {
    return this.post<ShopItem>(`/api/shops/${shopId}/items`, item);
  }

  async updateShopItem(shopId: string, itemId: string, data: Partial<ShopItem>): Promise<ShopItem> {
    return this.put<ShopItem>(`/api/shops/${shopId}/items/${itemId}`, data);
  }

  async deleteShopItem(shopId: string, itemId: string): Promise<void> {
    return this.delete<void>(`/api/shops/${shopId}/items/${itemId}`);
  }

  // WebSocket URL helper
  getWebSocketUrl(campaignId: string, token: string): string {
    const wsUrl = this.baseUrl.replace('http://', 'ws://').replace('https://', 'wss://');
    return `${wsUrl}/ws/${campaignId}?token=${token}`;
  }
}

// Export singleton instance
export const api = new TypedApiClient();

// Export type-safe hooks
export function useApi() {
  return api;
}

// React Query integration helper
export function createQueryKey(
  entity: string,
  id?: string | number,
  params?: Record<string, any>
): string[] {
  const key = [entity];
  if (id !== undefined) key.push(String(id));
  if (params) key.push(JSON.stringify(params));
  return key;
}