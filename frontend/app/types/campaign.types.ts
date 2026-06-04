/**
 * Core campaign types
 */

export interface Campaign {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  dm_user_id: string;
  is_active: boolean;
  settings?: CampaignSettings;
  members?: CampaignMember[];
}

export interface CampaignSettings {
  allow_player_secrets: boolean;
  enable_fog_of_war: boolean;
  enable_grid_snap: boolean;
  grid_size: number;
  default_token_size: number;
}

export interface CampaignMember {
  id: string;
  campaign_id: string;
  user_id: string;
  role: 'dm' | 'player' | 'spectator';
  joined_at: string;
  character_id?: string;
  is_active: boolean;
}