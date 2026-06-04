export type Visibility = 'dm_only' | 'all_players' | 'specific_players';

export interface CampaignStorageObject {
  id: number;
  campaign_id: number;
  object_type: string;
  object_id: string;
  object_name: string;
  category?: string | null;
  tags?: string[] | null;
  data: any;
  source?: string | null;
  source_id?: string | null;
  visibility: Visibility;
  is_active?: boolean;
  version?: number;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  updated_by?: string | null;
}

