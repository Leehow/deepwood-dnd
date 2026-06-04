export interface MapData {
  id: number;
  campaign_id: number;
  name: string;
  image_url: string;
  width?: number;
  height?: number;
  grid_size?: number;
  grid_enabled?: boolean;
  fog_of_war_enabled?: boolean;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ShopInventoryItem {
  id: number;
  shop_id: number;
  item_id: number;
  quantity: number;
  price_gp: number;
  discount_percentage?: number;
  is_available?: boolean;
  restocks_at?: string;
}

export interface Shop {
  id: number;
  campaign_id: number;
  name: string;
  description?: string;
  appearance_description?: string;
  shop_type?: string;
  location?: string;
  discount_rate: number;
  avatar_url?: string;
  inventory: ShopInventoryItem[];
}
