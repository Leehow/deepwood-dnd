/**
 * Services Index
 * Central export for all API services
 */

import { apiService as _apiService, BaseAPIService, APIError } from './api.service';
import { campaignService as _campaignService } from './campaign.service';
import { campaignShellService as _campaignShellService } from './campaignShell.service';
import { characterService as _characterService } from './character.service';
import { moduleService as _moduleService } from './module.service';
import { chatService as _chatService } from './chat.service';

// Re-export services
export const apiService = _apiService;
export const campaignService = _campaignService;
export const campaignShellService = _campaignShellService;
export const characterService = _characterService;
export const moduleService = _moduleService;
export const chatService = _chatService;

// Re-export types and classes
export { BaseAPIService, APIError };
export type { RequestConfig } from './api.service';

export type {
  CampaignCreateData,
  CampaignUpdateData,
  CampaignMemberCreateData
} from './campaign.service';

export type {
  CharacterCreateData,
  CharacterUpdateData
} from './character.service';

export type {
  ModuleUploadResponse,
  ParseRequest
} from './module.service';

export type {
  ChatMessage,
  ChatMessageCreate,
  ChatMessageUpdate,
  PaginatedMessages,
  AiSession
} from './chat.service';

/**
 * Initialize all services with authentication
 */
export function initializeServices(userId: string, role?: string): void {
  apiService.setAuthHeaders(userId, role);
  campaignService.setAuthHeaders(userId, role);
  characterService.setAuthHeaders(userId, role);
  moduleService.setAuthHeaders(userId, role);
  chatService.setAuthHeaders(userId, role);
}

/**
 * Clear authentication from all services
 */
export function clearServiceAuth(): void {
  apiService.clearAuthHeaders();
  campaignService.clearAuthHeaders();
  characterService.clearAuthHeaders();
  moduleService.clearAuthHeaders();
  chatService.clearAuthHeaders();
}
