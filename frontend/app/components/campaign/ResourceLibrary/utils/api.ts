/**
 * API utility functions for ResourceLibrary
 * Centralizes all API calls and uses configuration instead of hardcoded URLs
 */

import { getApiEndpoint } from '~/config/api';
import type { Item, MonsterInstance, Token } from '../types';

// ============= Items API =============

export const fetchItems = async (campaignId: string): Promise<Item[]> => {
  const response = await fetch(getApiEndpoint(`/api/items/campaign/${campaignId}`));
  if (!response.ok) throw new Error('Failed to fetch items');
  return response.json();
};

export const deleteItem = async (itemId: number): Promise<void> => {
  const response = await fetch(getApiEndpoint(`/api/items/${itemId}`), {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete item');
};

export const deleteAllItems = async (campaignId: string): Promise<{ deleted_count: number; message: string }> => {
  const response = await fetch(getApiEndpoint(`/api/items/campaign/${campaignId}/all`), {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete all items');
  return response.json();
};

// ============= Monster Instances API =============

export const fetchMonsterInstances = async (campaignId: string): Promise<MonsterInstance[]> => {
  const response = await fetch(getApiEndpoint(`/api/monster-instances/campaign/${campaignId}`));
  if (!response.ok) throw new Error('Failed to fetch monster instances');
  return response.json();
};

export const updateMonsterInstance = async (
  monsterInstanceId: number,
  data: Partial<MonsterInstance>
): Promise<void> => {
  const response = await fetch(getApiEndpoint(`/api/monster-instances/${monsterInstanceId}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update monster instance');
};

export const generateMonsterAvatar = async (
  monsterInstanceId: number,
  createdBy: string,
  appearanceDescription?: string
): Promise<{ success: boolean; avatar_url?: string; error?: string }> => {
  const body: Record<string, unknown> = {
    monster_instance_id: monsterInstanceId,
    created_by: createdBy,
  };
  if (appearanceDescription?.trim()) {
    body.appearance_description = appearanceDescription.trim();
  }
  const response = await fetch(getApiEndpoint('/api/monster-instances/generate-avatar'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Failed to generate avatar');
  return response.json();
};

export const deleteMonsterInstance = async (monsterInstanceId: number): Promise<void> => {
  const response = await fetch(getApiEndpoint(`/api/monster-instances/${monsterInstanceId}`), {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete monster instance');
};

export const incrementAvatarUsage = async (avatarId: number): Promise<void> => {
  await fetch(getApiEndpoint(`/api/monster-avatars/library/${avatarId}/use`), {
    method: 'POST',
  });
};

// ============= Tokens API =============

export const fetchMapTokens = async (
  campaignId: string,
  mapUrl: string
): Promise<{ tokens: Token[] }> => {
  const response = await fetch(
    getApiEndpoint(`/api/tokens/campaign/${campaignId}/map?map_url=${encodeURIComponent(mapUrl)}`)
  );
  if (!response.ok) throw new Error('Failed to fetch tokens');
  return response.json();
};

export const createToken = async (tokenData: {
  campaign_id: number;
  monster_instance_id?: number;
  map_url: string;
  position_x: number;
  position_y: number;
  token_size: string;
  instance_name?: string;
  item_data?: any;
  item_quantity?: number;
}): Promise<any> => {
  const response = await fetch(getApiEndpoint('/api/tokens/'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tokenData),
  });
  if (!response.ok) throw new Error('Failed to create token');
  return response.json();
};

export const deleteToken = async (tokenId: number): Promise<void> => {
  const response = await fetch(getApiEndpoint(`/api/tokens/${tokenId}`), {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete token');
};

export const updateTokenHP = async (tokenId: number, currentHp: number): Promise<void> => {
  const response = await fetch(getApiEndpoint(`/api/tokens/${tokenId}/hp`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_hp: currentHp }),
  });
  if (!response.ok) throw new Error('Failed to update token HP');
};
