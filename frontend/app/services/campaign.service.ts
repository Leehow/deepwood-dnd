/**
 * Campaign Service
 * Handles all campaign-related API calls
 */

import { BaseAPIService } from './api.service';
import type { Campaign, CampaignMember } from '~/types';

export interface CampaignCreateData {
  name: string;
  description?: string;
  dm_user_id: string;
  max_players?: number;
  level_range?: string;
}

export interface CampaignUpdateData {
  name?: string;
  description?: string;
  status?: 'active' | 'paused' | 'completed';
  current_map_url?: string;
  selected_module_id?: string;
}

export interface CampaignMemberCreateData {
  user_id: string;
  role: 'dm' | 'player' | 'spectator';
  character_id?: number;
}

class CampaignService extends BaseAPIService {
  /**
   * Get all campaigns
   */
  async getCampaigns(status?: string): Promise<Campaign[]> {
    return this.get<Campaign[]>('/campaigns', {
      params: status ? { status } : undefined
    });
  }

  /**
   * Get campaign by ID
   */
  async getCampaign(campaignId: string | number): Promise<Campaign> {
    return this.get<Campaign>(`/campaigns/${campaignId}`);
  }

  /**
   * Create new campaign
   */
  async createCampaign(data: CampaignCreateData): Promise<Campaign> {
    return this.post<Campaign>('/campaigns', data);
  }

  /**
   * Update campaign
   */
  async updateCampaign(
    campaignId: string | number,
    data: CampaignUpdateData
  ): Promise<Campaign> {
    return this.put<Campaign>(`/campaigns/${campaignId}`, data);
  }

  /**
   * Delete campaign
   */
  async deleteCampaign(campaignId: string | number): Promise<void> {
    return this.delete(`/campaigns/${campaignId}`);
  }

  /**
   * Get campaign members
   */
  async getCampaignMembers(campaignId: string | number): Promise<CampaignMember[]> {
    return this.get<CampaignMember[]>(`/campaigns/${campaignId}/members`);
  }

  /**
   * Add member to campaign
   */
  async addCampaignMember(
    campaignId: string | number,
    data: CampaignMemberCreateData
  ): Promise<CampaignMember> {
    return this.post<CampaignMember>(`/campaigns/${campaignId}/members`, data);
  }

  /**
   * Remove member from campaign
   */
  async removeCampaignMember(
    campaignId: string | number,
    userId: string
  ): Promise<void> {
    return this.delete(`/campaigns/${campaignId}/members/${userId}`);
  }

  /**
   * Update member's selected character
   */
  async updateMemberCharacter(
    campaignId: string | number,
    userId: string,
    characterId: number
  ): Promise<CampaignMember> {
    return this.put<CampaignMember>(
      `/campaigns/${campaignId}/members/${userId}`,
      { selected_character_id: characterId }
    );
  }

  /**
   * Get member's selected character
   */
  async getMemberCharacter(
    campaignId: string | number,
    _userId: string
  ): Promise<{ character_id: number } | null> {
    return this.get(`/campaigns/${campaignId}/members/me/selected-character`);
  }
}

export const campaignService = new CampaignService();
