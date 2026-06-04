/**
 * Character Service
 * Handles all character-related API calls
 */

import { BaseAPIService } from './api.service';
import type { Character, CharacterSheet } from '~/types';

export interface CharacterCreateData {
  name: string;
  race: string;
  class: string;
  level: number;
  campaign_id: number;
  user_id: string;
  background?: string;
  alignment?: string;
  abilities?: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
}

export interface CharacterUpdateData {
  name?: string;
  level?: number;
  experience_points?: number;
  hit_points_current?: number;
  hit_points_max?: number;
  armor_class?: number;
  equipment?: unknown[];
  inventory?: unknown[];
  currency?: {
    copper: number;
    silver: number;
    electrum: number;
    gold: number;
    platinum: number;
  };
  notes?: string;
}

class CharacterService extends BaseAPIService {
  /**
   * Get all characters for a campaign
   */
  async getCampaignCharacters(campaignId: string | number): Promise<Character[]> {
    return this.get<Character[]>(`/api/characters/campaign/${campaignId}`);
  }

  /**
   * Get character by ID
   */
  async getCharacter(characterId: number): Promise<Character> {
    return this.get<Character>(`/api/characters/${characterId}`);
  }

  /**
   * Get character sheet (with features and actions)
   */
  async getCharacterSheet(characterId: number): Promise<CharacterSheet> {
    return this.get<CharacterSheet>(`/api/characters/${characterId}/sheet`);
  }

  /**
   * Create new character
   */
  async createCharacter(data: CharacterCreateData): Promise<Character> {
    return this.post<Character>('/api/characters', data);
  }

  /**
   * Update character
   */
  async updateCharacter(
    characterId: number,
    data: CharacterUpdateData
  ): Promise<Character> {
    return this.put<Character>(`/api/characters/${characterId}`, data);
  }

  /**
   * Delete character
   */
  async deleteCharacter(characterId: number): Promise<void> {
    return this.delete(`/api/characters/${characterId}`);
  }

  /**
   * Update character HP
   */
  async updateHP(
    characterId: number,
    current: number,
    temporary?: number
  ): Promise<Character> {
    return this.patch<Character>(`/api/characters/${characterId}/hp`, {
      hit_points_current: current,
      temporary_hit_points: temporary
    });
  }

  /**
   * Update character currency
   */
  async updateCurrency(
    characterId: number,
    currency: {
      copper?: number;
      silver?: number;
      electrum?: number;
      gold?: number;
      platinum?: number;
    }
  ): Promise<Character> {
    return this.patch<Character>(`/api/characters/${characterId}/currency`, { currency });
  }

  /**
   * Add item to character inventory
   */
  async addInventoryItem(
    characterId: number,
    itemId: number,
    quantity: number
  ): Promise<Character> {
    return this.post<Character>(`/api/characters/${characterId}/inventory`, {
      item_id: itemId,
      quantity
    });
  }

  /**
   * Remove item from character inventory
   */
  async removeInventoryItem(
    characterId: number,
    itemId: number,
    quantity: number
  ): Promise<Character> {
    return this.delete<Character>(
      `/api/characters/${characterId}/inventory/${itemId}`,
      { params: { quantity } }
    );
  }

  /**
   * Equip item
   */
  async equipItem(
    characterId: number,
    itemId: number,
    slot?: string
  ): Promise<Character> {
    return this.post<Character>(`/api/characters/${characterId}/equipment`, {
      item_id: itemId,
      slot
    });
  }

  /**
   * Unequip item
   */
  async unequipItem(characterId: number, itemId: number): Promise<Character> {
    return this.delete<Character>(`/api/characters/${characterId}/equipment/${itemId}`);
  }

  /**
   * Generate character avatar
   */
  async generateAvatar(characterId: number): Promise<{ avatar_url: string }> {
    return this.post<{ avatar_url: string }>(
      `/api/characters/${characterId}/generate-avatar`
    );
  }
}

export const characterService = new CharacterService();