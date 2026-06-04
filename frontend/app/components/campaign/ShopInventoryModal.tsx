import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, Button, TextField, Flex, Text, Box, Badge, ScrollArea, TextArea } from '@radix-ui/themes';
import * as Tabs from '@radix-ui/react-tabs';
import { showGlobalToast } from "../ui/Toast";
import { getApiEndpoint } from "../../config/api";
import { createLogger } from '~/utils/logger';
import { getAssetUrl } from '~/utils/asset-url';
import { useModalContextStore } from '~/stores/modalContextStore';
import { isClickInsideFloatingChat } from '~/utils/floatingChatGuard';
import { resolveTokenItemImageUrl, serializeItemToTokenData } from '~/utils/itemTokenData';
const logger = createLogger('ShopInventoryModal');

// Base path for static assets
const BASE_PATH = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL.replace(/\/$/, '') : '';

// Icon components
const PackageIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
  </svg>
);

const SwordIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.5 2L20 7.5l-1.5 1.5-2-2L5 18.5 2 22l3.5-3L17 7.5l-2-2L16.5 4 14.5 2z" />
  </svg>
);

const ShieldIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);

const BackpackIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
  </svg>
);

const SparklesIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  </svg>
);

const Dice6Icon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={2} />
    <circle cx="8" cy="8" r="1" fill="currentColor" />
    <circle cx="16" cy="8" r="1" fill="currentColor" />
    <circle cx="8" cy="12" r="1" fill="currentColor" />
    <circle cx="16" cy="12" r="1" fill="currentColor" />
    <circle cx="8" cy="16" r="1" fill="currentColor" />
    <circle cx="16" cy="16" r="1" fill="currentColor" />
  </svg>
);

const WandIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 4V2m0 2v2m0-2h2m-2 0h-2m-3 10l9-9m-9 9l-4 4m4-4l4 4m-8-8l2-2" />
  </svg>
);

const TrashIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const ImagePlusIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v6m3-3H9" />
  </svg>
);

const CoinsIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <circle cx="9" cy="9" r="6" strokeWidth={2} />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 9a6 6 0 11-6 6" />
  </svg>
);

const HashIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
  </svg>
);

const SettingsIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const RefreshIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const StoreIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);



// Translation maps
const CATEGORY_CN: Record<string, string> = {
  weapon: '武器', armor: '护甲', adventuring_gear: '冒险装备', tool: '工具', misc: '杂项',
  wondrous_item: '奇物', potion: '药水', scroll: '卷轴', ring: '戒指', rod: '权杖',
  staff: '法杖', wand: '魔杖', weapons: '武器',
};
const SUBCATEGORY_CN: Record<string, string> = {
  simple_melee: '简单近战', simple_ranged: '简单远程', martial_melee: '军用近战', martial_ranged: '军用远程',
  light: '轻甲', medium: '中甲', heavy: '重甲', shield: '盾牌',
  standard: '标准', containers: '容器', tools: '工具', kits: '工具包', instruments: '乐器',
  ammunition: '弹药', foodAndDrink: '食物饮品', lodging: '住宿',
  potionsAndPoisons: '药水与毒药', survival: '生存用品', lightSources: '光源',
  arcaneFocus: '奥术法器', druidicFocus: '德鲁伊法器', holySymbol: '圣徽',
};
const DAMAGE_TYPE_CN: Record<string, string> = {
  slashing: '挥砍', piercing: '穿刺', bludgeoning: '钝击',
  fire: '火焰', cold: '冰冷', lightning: '闪电', thunder: '雷鸣',
  acid: '强酸', poison: '毒素', necrotic: '黯蚀', radiant: '光耀',
  force: '力场', psychic: '心灵', healing: '治疗',
};
const PROPERTY_CN: Record<string, string> = {
  ammunition: '弹药', finesse: '灵巧', heavy: '沉重', light: '轻型',
  loading: '装填', reach: '长柄', special: '特殊', thrown: '投掷',
  'two-handed': '双手', versatile: '多用',
};
const RARITY_CN: Record<string, string> = {
  common: '普通', uncommon: '不常见', rare: '稀有', very_rare: '非常稀有',
  'very rare': '非常稀有', legendary: '传说', artifact: '神器',
};

// API types
interface InventoryItem {
  id: number;
  shop_id: number;
  item_id: number;
  quantity: number;
  price_gp: number;
}

interface ItemResp {
  id: number;
  name: string;
  name_cn?: string;
  category?: string;
  subcategory?: string;
  properties?: string[];
  damage?: any;
  armor_class?: any;
  range?: any;
  weight?: number | null;
  cost?: any;
  rarity?: string;
  description?: string;
  description_cn?: string;
  magic_bonus?: number;
  extra_damage?: any;
  requires_attunement?: boolean;
  attunement_by?: string;
  abilities?: any[];
  // custom extensions
  is_custom?: boolean;
  has_avatar?: boolean;
  avatar_url?: string | null;
}

interface EquipmentItem {
  id: string;
  name: string;
  nameEn: string;
  iconPath?: string;
  cost?: any;
  weight?: number;
  damage?: string;
  damageType?: string;
  ac?: string;
  acFormula?: any;
  type?: string;
  properties?: string[];
  range?: any;
  strengthRequired?: number | null;
  stealthDisadvantage?: boolean;
  description?: string;
}

interface MagicItem {
  id: string;
  name: string;
  nameEn: string;
  rarity: string;
  rarityCn: string;
  category: string;
  categoryCn: string;
  requiresAttunement: boolean;
  description: string;
  descriptionEn?: string;
  stats?: any;
  consumable?: any;
}

interface ShopData {
  id: number;
  name: string;
  description?: string;
  appearance_description?: string;
  gold_gp: number;
  accepts_selling: boolean;
  discount_rate: number;
  avatar_url?: string | null;
  avatar_url_large?: string | null;
  has_avatar?: boolean;
}

interface ShopInventoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  shop: ShopData | null;
  onUpdated?: () => void;
}

const buildDamageObject = (damage: any, explicitDamageType?: string) => {
  if (!damage) return undefined;
  if (typeof damage === 'string') {
    return explicitDamageType ? { dice: damage, type: explicitDamageType } : undefined;
  }
  if (typeof damage === 'object') {
    const dice = typeof damage.dice === 'string'
      ? damage.dice
      : (typeof damage.formula === 'string' ? damage.formula : undefined);
    const type = explicitDamageType || damage.type;
    return dice && type ? { dice, type } : undefined;
  }
  return undefined;
};

const buildArmorClassObject = (armorClass: any, fallbackFormula?: any) => {
  if (armorClass && typeof armorClass === 'object' && armorClass.base !== undefined) {
    return {
      base: Number(armorClass.base),
      dex_bonus: Boolean(armorClass.dex_bonus),
      max_dex_bonus: armorClass.max_dex_bonus != null ? Number(armorClass.max_dex_bonus) : null,
    };
  }

  if (typeof armorClass === 'number' || typeof armorClass === 'string') {
    const base = Number(armorClass);
    if (Number.isFinite(base)) {
      return { base, dex_bonus: false, max_dex_bonus: null };
    }
  }

  if (!fallbackFormula) return undefined;

  if (typeof fallbackFormula === 'object' && fallbackFormula.base !== undefined) {
    return {
      base: Number(fallbackFormula.base),
      dex_bonus: fallbackFormula.dexModifier === 'full' || fallbackFormula.dexModifier === 'max2',
      max_dex_bonus: fallbackFormula.dexModifier === 'max2' ? 2 : null,
    };
  }

  if (typeof fallbackFormula === 'string') {
    const baseMatch = fallbackFormula.match(/^(\d+)/);
    const hasDexBonus = fallbackFormula.includes('Dex');
    const maxDexMatch = fallbackFormula.match(/最大\+(\d+)/);
    if (baseMatch) {
      return {
        base: parseInt(baseMatch[1]),
        dex_bonus: hasDexBonus,
        max_dex_bonus: maxDexMatch ? parseInt(maxDexMatch[1]) : null,
      };
    }
  }

  return undefined;
};

export function ShopInventoryModal({ open, onOpenChange, campaignId, shop, onUpdated }: ShopInventoryModalProps) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [itemsById, setItemsById] = useState<Record<number, ItemResp>>({});
  const [loading, setLoading] = useState(false);

  // Register modal context for AI chat awareness
  const setModalContext = useModalContextStore(s => s.setModalContext);
  const clearModalContext = useModalContextStore(s => s.clearModalContext);
  useEffect(() => {
    if (open && shop) {
      const parts = [`正在浏览商店「${shop.name}」，商店金币：${shop.gold_gp ?? '未知'}gp`];
      if (inventory.length > 0) {
        const itemNames = inventory.slice(0, 10).map(i => {
          const detail = itemsById[i.item_id];
          return detail?.name_cn || detail?.name || `#${i.item_id}`;
        }).join('、');
        const extra = inventory.length > 10 ? `…等共${inventory.length}件` : '';
        parts.push(`商品：${itemNames}${extra}`);
      }
      setModalContext('shop', parts.join('。'));
    } else if (!open) {
      clearModalContext('shop');
    }
  }, [open, shop?.name, shop?.gold_gp, inventory, itemsById, setModalContext, clearModalContext]);

  // Item detail dialog state
  const [selectedItemDetail, setSelectedItemDetail] = useState<ItemResp | null>(null);
  const [itemDetailOpen, setItemDetailOpen] = useState(false);

  const showItemDetail = (item: ItemResp | undefined) => {
    if (item) {
      setSelectedItemDetail(item);
      setItemDetailOpen(true);
    }
  };

  // Convert preset EquipmentItem to ItemResp for detail view
  const equipmentToItemResp = (item: EquipmentItem): ItemResp => {
    const canonicalItem = serializeItemToTokenData(item as any);
    return {
      id: 0,
      name: item.nameEn || item.name,
      name_cn: item.name,
      category: canonicalItem.category || activeCategory,
      subcategory: item.type,
      properties: canonicalItem.properties || item.properties,
      weight: canonicalItem.weight ?? item.weight,
      cost: item.cost,
      damage: buildDamageObject(canonicalItem.damage, canonicalItem.damageType),
      armor_class: buildArmorClassObject(canonicalItem.armor_class, item.acFormula),
      range: canonicalItem.range ?? item.range,
      rarity: 'common',
      description: item.description,
      avatar_url: resolveTokenItemImageUrl(canonicalItem) || null,
      is_custom: false,
      has_avatar: !!resolveTokenItemImageUrl(canonicalItem),
    };
  };

  // Convert MagicItem to ItemResp for detail view
  const magicItemToItemResp = (mi: MagicItem): ItemResp => {
    const stats = mi.stats || {};
    const consumable = mi.consumable || {};
    let damage: any = undefined;
    if (stats.healing || consumable.healing) {
      const formula = consumable.healing?.formula || stats.healing;
      damage = formula ? { dice: formula, type: 'healing' } : undefined;
    } else if (stats.damage) {
      const parts = String(stats.damage).split(' ');
      damage = { dice: parts[0], type: parts[1] || '' };
    }
    const abilities: any[] = [];
    if (stats.duration) abilities.push({ name: '持续时间', description: stats.duration });
    if (stats.save_dc) abilities.push({ name: '豁免DC', description: String(stats.save_dc) });
    if (stats.effects?.length) abilities.push({ name: '效果', description: stats.effects.join('、') });
    return {
      id: 0, name: mi.nameEn || mi.name, name_cn: mi.name,
      category: mi.category, rarity: mi.rarity?.toLowerCase(),
      requires_attunement: mi.requiresAttunement,
      description_cn: mi.description, description: mi.descriptionEn,
      damage, abilities: abilities.length > 0 ? abilities : undefined,
    };
  };
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    showGlobalToast({ message, type });
  };

  // Preset equipment tab state
  const [eqLoading, setEqLoading] = useState(false);
  const [equipmentData, setEquipmentData] = useState<any>(null);
  const [magicItemsData, setMagicItemsData] = useState<MagicItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'weapons' | 'armor' | 'gear' | 'magic'>('weapons');
  const [magicSubCategory, setMagicSubCategory] = useState<string>('all');
  const [selectedPreset, setSelectedPreset] = useState<EquipmentItem | null>(null);
  const [selectedMagicItem, setSelectedMagicItem] = useState<MagicItem | null>(null);
  const [presetQty, setPresetQty] = useState(1);
  const [presetPrice, setPresetPrice] = useState<number>(0);

  // Custom item tab state (AI-based)
  const [customDescription, setCustomDescription] = useState('');
  const [customQty, setCustomQty] = useState(1);
  const [customPrice, setCustomPrice] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  // Shop settings tab state
  const [settingsName, setSettingsName] = useState('');
  const [settingsDescription, setSettingsDescription] = useState('');
  const [settingsAppearance, setSettingsAppearance] = useState('');
  const [settingsGold, setSettingsGold] = useState(0);
  const [settingsAcceptsSelling, setSettingsAcceptsSelling] = useState(true);
  const [settingsDiscountRate, setSettingsDiscountRate] = useState(0.5);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);

  // Helper to convert cost object to gp
  const costToGp = (cost: any): number => {
    if (!cost) return 0;
    if (typeof cost === 'number') return cost;
    // cost can be {gp: 10}, {sp: 5}, {cp: 100}, etc.
    const cp = cost.cp || 0;
    const sp = cost.sp || 0;
    const ep = cost.ep || 0;
    const gp = cost.gp || 0;
    const pp = cost.pp || 0;
    // Convert to gp: 1pp=10gp, 1gp=1gp, 1ep=0.5gp, 1sp=0.1gp, 1cp=0.01gp
    return pp * 10 + gp + ep * 0.5 + sp * 0.1 + cp * 0.01;
  };

  // Helpers
  const isNonTradable = (price: number | null | undefined) => !price || price <= 0;

  const loadInventory = async () => {
    if (!shop) return;
    setLoading(true);
    try {
      const resp = await fetch(getApiEndpoint(`/api/shops/${shop.id}/inventory`));
      const inv: InventoryItem[] = resp.ok ? await resp.json() : [];
      setInventory(inv);
      // Load item details for each inventory item
      const ids = Array.from(new Set(inv.map(i => i.item_id)));
      const entries: [number, ItemResp][] = [];
      for (const id of ids) {
        try {
          const r = await fetch(getApiEndpoint(`/api/items/${id}`));
          if (r.ok) {
            const data = await r.json();
            entries.push([id, data]);
          }
        } catch (e) {
          logger.warn('[ShopInventoryModal] load item failed', id, e);
        }
      }
      setItemsById(Object.fromEntries(entries));
    } catch (e) {
      logger.error('[ShopInventoryModal] loadInventory error:', e);
      showToast('加载库存失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Load equipment.json and magic-items.json when preset tab is used
  useEffect(() => {
    const loadEq = async () => {
      setEqLoading(true);
      try {
        const [eqData, miModule] = await Promise.all([
          import('~/data/rules/equipment.json').then(m => m.default),
          import('~/data/rules/magic-items.json').then(m => m.default),
        ]);
        setEquipmentData(eqData);
        setMagicItemsData(miModule.items || []);
      } catch (e) {
        logger.error('[ShopInventoryModal] load equipment/magic-items failed', e);
      } finally {
        setEqLoading(false);
      }
    };
    if (open) loadEq();
  }, [open]);

  // Reset & load
  useEffect(() => {
    if (open && shop) {
      setSearchQuery('');
      setSelectedPreset(null);
      setSelectedMagicItem(null);
      setPresetQty(1);
      setPresetPrice(0);
      // Initialize shop settings from props
      setSettingsName(shop.name || '');
      setSettingsDescription(shop.description || '');
      setSettingsAppearance(shop.appearance_description || '');
      setSettingsGold(shop.gold_gp || 0);
      setSettingsAcceptsSelling(shop.accepts_selling ?? true);
      setSettingsDiscountRate(shop.discount_rate ?? 0.5);
      loadInventory();
    }
  }, [open, shop?.id]);

  const getPresetItems = (): EquipmentItem[] => {
    if (!equipmentData) return [];
    let items: EquipmentItem[] = [];
    if (activeCategory === 'weapons') {
      const simple = equipmentData.weapons?.simple || {};
      const martial = equipmentData.weapons?.martial || {};
      items = [ ...(simple.melee || []), ...(simple.ranged || []), ...(martial.melee || []), ...(martial.ranged || []) ];
    } else if (activeCategory === 'armor') {
      items = [ ...(equipmentData.armor?.light || []), ...(equipmentData.armor?.medium || []), ...(equipmentData.armor?.heavy || []), ...(equipmentData.armor?.shields || []) ];
    } else {
      const gear = equipmentData.adventuringGear || {};
      const tools = equipmentData.tools || {};
      items = [ ...(gear.ammunition || []), ...(gear.standard || []), ...(gear.containers || []), ...(gear.tools || []), ...(gear.kits || []), ...(gear.instruments || []), ...(tools.artisansTools || []), ...(tools.specializedTools || []), ...(tools.gamingSets || []), ...(tools.musicalInstruments || []) ];
    }
    return items;
  };

  const filteredPreset = useMemo(() => getPresetItems().filter(it =>
    it.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    it.nameEn.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (it.type && it.type.toLowerCase().includes(searchQuery.toLowerCase()))
  ), [equipmentData, activeCategory, searchQuery]);

  // Magic items: subcategories and filtered list
  const magicSubCategories = useMemo(() => {
    const cats = new Map<string, string>();
    for (const mi of magicItemsData) {
      if (!cats.has(mi.category)) cats.set(mi.category, mi.categoryCn || mi.category);
    }
    return Array.from(cats.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [magicItemsData]);

  const filteredMagicItems = useMemo(() => {
    let items = magicItemsData;
    if (magicSubCategory !== 'all') {
      items = items.filter(mi => mi.category === magicSubCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(mi =>
        mi.name.toLowerCase().includes(q) ||
        mi.nameEn.toLowerCase().includes(q) ||
        mi.categoryCn?.toLowerCase().includes(q) ||
        mi.rarityCn?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [magicItemsData, magicSubCategory, searchQuery]);

  const RARITY_PRICE_GP: Record<string, number> = {
    common: 50, uncommon: 250, rare: 2500, 'very rare': 25000, 'very_rare': 25000, legendary: 50000,
  };


  // Fallback: resolve preset icon for items without avatar_url by matching names
  const getAllPresetItems = (): EquipmentItem[] => {
    if (!equipmentData) return [];
    const items: EquipmentItem[] = [];
    const w = equipmentData.weapons || {};
    const a = equipmentData.armor || {};
    const g = equipmentData.adventuringGear || {};
    const t = equipmentData.tools || {};
    items.push(...(w.simple?.melee || []), ...(w.simple?.ranged || []), ...(w.martial?.melee || []), ...(w.martial?.ranged || []));
    items.push(...(a.light || []), ...(a.medium || []), ...(a.heavy || []), ...(a.shields || []));
    // Iterate all adventuringGear subcategories dynamically
    for (const key of Object.keys(g)) {
      if (Array.isArray(g[key])) items.push(...g[key]);
    }
    for (const key of Object.keys(t)) {
      if (Array.isArray(t[key])) items.push(...t[key]);
    }
    return items;
  };

  const presetIconMap = useMemo(() => {
    const map: Record<string, string> = {};
    const arr = getAllPresetItems();
    for (const p of arr) {
      if (p.nameEn) map[p.nameEn.toLowerCase()] = p.iconPath || '';
      if (p.name) map[p.name.toLowerCase()] = p.iconPath || '';
    }
    return map;
  }, [equipmentData]);

  const getItemIcon = (item?: ItemResp): string | undefined => {
    if (!item) return undefined;
    const helperIcon = resolveTokenItemImageUrl(item as any);
    if (helperIcon) return helperIcon;
    if (item.avatar_url) {
      // If avatar_url is a relative path (starts with /assets/), use getAssetUrl
      // If it's already an absolute URL (https://), return as-is
      if (item.avatar_url.startsWith('/assets/') || item.avatar_url.startsWith('assets/')) {
        return getAssetUrl(item.avatar_url.replace(/^\//, ''));
      }
      return item.avatar_url;
    }
    const en = item.name?.toLowerCase();
    const cn = item.name_cn?.toLowerCase();
    const byEn = en ? presetIconMap[en] : undefined;
    const byCn = cn ? presetIconMap[cn] : undefined;
    const iconPath = byEn || byCn || undefined;
    return iconPath ? getAssetUrl(iconPath.replace(/^\//, '')) : undefined;
  };

  const isPresetItem = (item?: ItemResp): boolean => {
    if (!item) return false;
    if (typeof item.is_custom === 'boolean') {
      return item.is_custom === false;
    }
    if (item.avatar_url && item.avatar_url.startsWith('/assets/equipment-icons/')) return true;
    return false;
  };

  const buildItemPayloadFromPreset = (preset: EquipmentItem) => {
    const canonicalItem = serializeItemToTokenData(preset as any);
    const resolvedAvatarUrl = resolveTokenItemImageUrl(canonicalItem);
    return {
      campaign_id: parseInt(campaignId),
      name: preset.nameEn || preset.name,
      name_cn: preset.name,
      category: canonicalItem.category || activeCategory,
      subcategory: preset.type,
      cost: preset.cost,
      weight: canonicalItem.weight ?? preset.weight,
      rarity: 'common',
      damage: buildDamageObject(canonicalItem.damage, canonicalItem.damageType) || null,
      properties: canonicalItem.properties || preset.properties || [],
      range: canonicalItem.range ?? preset.range,
      armor_class: buildArmorClassObject(canonicalItem.armor_class, preset.acFormula) || null,
      strength_requirement: preset.strengthRequired,
      stealth_disadvantage: preset.stealthDisadvantage || false,
      description: preset.description || '',
      description_cn: preset.description || '',
      quantity: 1,
      notes: '',
      is_custom: false,  // Preset items are not custom, they have built-in icons
      avatar_url: resolvedAvatarUrl || null,
      has_avatar: !!resolvedAvatarUrl,
    };
  };

  const buildItemPayloadFromMagicItem = (mi: MagicItem) => {
    const stats = mi.stats || {};
    const consumable = mi.consumable || {};
    let damage: any = null;
    if (stats.healing || consumable.healing) {
      const formula = consumable.healing?.formula || stats.healing;
      damage = formula ? { dice: formula, type: 'healing' } : null;
    } else if (stats.damage) {
      const parts = String(stats.damage).split(' ');
      damage = { dice: parts[0], type: parts[1] || '' };
    }
    const abilities: Array<{ name: string; description: string }> = [];
    if (stats.duration) abilities.push({ name: '持续时间', description: stats.duration });
    if (stats.save_dc) abilities.push({ name: '豁免DC', description: String(stats.save_dc) });
    if (stats.effects?.length) abilities.push({ name: '效果', description: stats.effects.join('、') });
    if (consumable.action) abilities.push({ name: '使用动作', description: consumable.action === 'action' ? '一个动作' : consumable.action === 'bonus' ? '附赠动作' : consumable.action });

    return {
      campaign_id: parseInt(campaignId),
      name: mi.nameEn || mi.name,
      name_cn: mi.name,
      category: (mi.category || 'wondrous_item').toLowerCase().replace(/\s+/g, '_'),
      description: mi.descriptionEn || '',
      description_cn: mi.description || '',
      rarity: (mi.rarity || 'common').toLowerCase().replace(/\s+/g, '_'),
      requires_attunement: mi.requiresAttunement || false,
      damage,
      abilities: abilities.length > 0 ? abilities : undefined,
      quantity: 1,
    };
  };

  const handleAddFromPreset = async () => {
    if (!shop) return;
    // Handle magic item
    if (selectedMagicItem) {
      const qty = Math.max(1, presetQty | 0);
      const price = Number.isFinite(presetPrice) ? presetPrice : 0;
      try {
        const itemPayload = buildItemPayloadFromMagicItem(selectedMagicItem);
        const r1 = await fetch(getApiEndpoint('/api/items/'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(itemPayload) });
        if (!r1.ok) {
          const err = await r1.json().catch(() => ({}));
          showToast('创建物品失败: ' + (err.detail || r1.status), 'error');
          return;
        }
        const newItem: ItemResp = await r1.json();
        const r2 = await fetch(getApiEndpoint(`/api/shops/${shop.id}/inventory`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: newItem.id, quantity: qty, price_gp: price }) });
        if (!r2.ok) {
          const err = await r2.json().catch(() => ({}));
          showToast('加入库存失败: ' + (err.detail || r2.status), 'error');
          return;
        }
        showToast('已添加到库存', 'success');
        setSelectedMagicItem(null);
        setPresetQty(1);
        setPresetPrice(0);
        await loadInventory();
        onUpdated?.();
      } catch (e) {
        logger.error('[ShopInventoryModal] add magic item failed', e);
        showToast('添加失败', 'error');
      }
      return;
    }
    // Handle equipment item
    if (!selectedPreset) return;
    const qty = Math.max(1, presetQty | 0);
    const price = Number.isFinite(presetPrice) ? presetPrice : 0;
    try {
      // 1) Create campaign item first
      const itemPayload = buildItemPayloadFromPreset(selectedPreset);
      const r1 = await fetch(getApiEndpoint('/api/items/'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(itemPayload) });
      if (!r1.ok) {
        const err = await r1.json().catch(() => ({}));
        showToast('创建物品失败: ' + (err.detail || r1.status), 'error');
        return;
      }
      const newItem: ItemResp = await r1.json();

      // 2) Add to shop inventory
      const r2 = await fetch(getApiEndpoint(`/api/shops/${shop.id}/inventory`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: newItem.id, quantity: qty, price_gp: price }) });
      if (!r2.ok) {
        const err = await r2.json().catch(() => ({}));
        showToast('加入库存失败: ' + (err.detail || r2.status), 'error');
        return;
      }
      showToast('已添加到库存', 'success');
      setSelectedPreset(null);
      setPresetQty(1);
      setPresetPrice(0);
      await loadInventory();
      onUpdated?.();
    } catch (e) {
      logger.error('[ShopInventoryModal] add preset failed', e);
      showToast('添加失败', 'error');
    }
  };

  // Custom item handlers (AI-based)
  const handleGenerateDescription = async (random: boolean) => {
    if (!random && (!customDescription.trim() || customDescription.trim().length < 2)) {
      setCustomError('请先输入简短描述');
      return;
    }
    setIsGenerating(true);
    setCustomError(null);
    try {
      const response = await fetch(getApiEndpoint('/api/ai-settings/expand-prompt'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: customDescription.trim(),
          entity_type: 'item',
          random,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || '生成失败');
      }
      const data = await response.json();
      if (data.expanded_description) {
        setCustomDescription(data.expanded_description);
      }
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateCustomItem = async () => {
    if (!shop || !customDescription.trim() || customDescription.trim().length < 5) {
      setCustomError('请输入至少5个字符的物品描述');
      return;
    }
    setIsCreating(true);
    setCustomError(null);
    try {
      // 1) Call AI to parse and create item
      const r1 = await fetch(getApiEndpoint('/api/items/parse-custom'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId),
          description: customDescription.trim(),
        }),
      });
      if (!r1.ok) {
        const errorData = await r1.json();
        throw new Error(errorData.detail || '创建物品失败');
      }
      const newItem: ItemResp = await r1.json();

      // 2) Add to shop inventory
      const qty = Math.max(1, customQty | 0);
      const price = Number.isFinite(customPrice) ? customPrice : 0;
      const r2 = await fetch(getApiEndpoint(`/api/shops/${shop.id}/inventory`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: newItem.id, quantity: qty, price_gp: price }),
      });
      if (!r2.ok) {
        const err = await r2.json().catch(() => ({}));
        throw new Error('加入库存失败: ' + (err.detail || r2.status));
      }

      showToast('已创建物品并加入库存', 'success');
      setCustomDescription('');
      setCustomQty(1);
      setCustomPrice(0);
      await loadInventory();
      onUpdated?.();
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateInv = async (inv: InventoryItem, next: Partial<InventoryItem>) => {
    try {
      const r = await fetch(getApiEndpoint(`/api/shops/${inv.shop_id}/inventory/${inv.id}`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          quantity: next.quantity ?? inv.quantity,
          price_gp: next.price_gp ?? inv.price_gp,
        })
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        showToast('更新失败: ' + (err.detail || r.status), 'error');
        return;
      }
      await loadInventory();
      onUpdated?.();
    } catch (e) {
      logger.error('[ShopInventoryModal] update inv failed', e);
      showToast('更新失败', 'error');
    }
  };

  const handleGenerateAvatar = async (itemId: number) => {
    try {
      const r = await fetch(getApiEndpoint(`/api/items/${itemId}/generate-avatar`), { method: 'POST' });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        showToast('生成头像失败: ' + (err.detail || r.status), 'error');
        return;
      }
      showToast('已生成占位头像', 'success');
      await loadInventory();
    } catch (e) {
      logger.error('[ShopInventoryModal] generate avatar failed', e);
      showToast('生成头像失败', 'error');
    }
  };

  const handleDeleteInv = async (inv: InventoryItem) => {
    if (!confirm('确定删除该库存条目？')) return;
    try {
      const r = await fetch(getApiEndpoint(`/api/shops/${inv.shop_id}/inventory/${inv.id}`), { method: 'DELETE' });
      if (!r.ok) {
        showToast('删除失败', 'error');
        return;
      }
      await loadInventory();
      onUpdated?.();
    } catch (e) {
      logger.error('[ShopInventoryModal] delete inv failed', e);
      showToast('删除失败', 'error');
    }
  };

  // Shop settings handlers - auto-save on change
  const updateShopField = async (field: string, value: any) => {
    if (!shop) return;
    try {
      const r = await fetch(getApiEndpoint(`/api/shops/${shop.id}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        showToast('保存失败: ' + (err.detail || r.status), 'error');
        return;
      }
      onUpdated?.();
    } catch (e) {
      logger.error('[ShopInventoryModal] update shop field failed', e);
      showToast('保存失败', 'error');
    }
  };

  // Debounced update for text fields
  const debounceTimerRef = React.useRef<Record<string, NodeJS.Timeout>>({});
  const debouncedUpdateField = (field: string, value: any, delay = 500) => {
    if (debounceTimerRef.current[field]) {
      clearTimeout(debounceTimerRef.current[field]);
    }
    debounceTimerRef.current[field] = setTimeout(() => {
      updateShopField(field, value);
    }, delay);
  };

  const handleGenerateShopAvatar = async () => {
    if (!shop) return;
    if (!settingsAppearance.trim()) {
      showToast('请先填写外观描述', 'error');
      return;
    }
    setIsGeneratingAvatar(true);
    try {
      // First save the appearance description
      await fetch(getApiEndpoint(`/api/shops/${shop.id}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appearance_description: settingsAppearance.trim() }),
      });
      // Then generate avatar
      const r = await fetch(getApiEndpoint(`/api/shops/${shop.id}/generate-avatar`), { method: 'POST' });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        showToast('生成头像失败: ' + (err.detail || r.status), 'error');
        return;
      }
      showToast('头像生成中，请稍后刷新查看', 'success');
      onUpdated?.();
    } catch (e) {
      logger.error('[ShopInventoryModal] generate shop avatar failed', e);
      showToast('生成头像失败', 'error');
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} {...{modal: false}}>
      <Dialog.Content
        aria-describedby={undefined}
        style={{ maxWidth: '900px', maxHeight: '85vh' }}
        className="!bg-gradient-to-b !from-gray-900 !to-gray-950 !border !border-amber-900/30"
        onPointerDownOutside={(e: any) => { if (isClickInsideFloatingChat(e)) e.preventDefault(); }}
      >
        {/* Header with fantasy styling */}
        <div className="relative mb-4">
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-transparent to-amber-500/10 rounded-lg" />
          <div className="relative flex items-center justify-between gap-3 p-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500/20 to-amber-700/20 border border-amber-500/30 flex items-center justify-center">
                <PackageIcon className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <Dialog.Title className="!text-lg !font-bold !text-amber-100 !mb-0">
                  <span>库存管理{shop ? `：${shop.name}` : ''}</span>
                </Dialog.Title>
                <Dialog.Description size="1" className="!text-gray-400 !mt-0.5">
                  <span>维护商店库存（价格≤0的条目会在交易界面视为"不可交易"）</span>
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              <span>✕</span>
            </Dialog.Close>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
        </div>

        <Tabs.Root defaultValue="list">
          <Tabs.List className="flex gap-1 p-1 bg-gray-800/50 rounded-lg border border-gray-700/50 mb-4">
            <Tabs.Trigger
              value="settings"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md transition-all duration-200 text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-600/20 data-[state=active]:to-amber-500/10 data-[state=active]:text-amber-300 data-[state=active]:border data-[state=active]:border-amber-500/30 data-[state=active]:shadow-lg data-[state=active]:shadow-amber-500/10"
            >
              <SettingsIcon className="w-4 h-4" />
              商店设置
            </Tabs.Trigger>
            <Tabs.Trigger
              value="list"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md transition-all duration-200 text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-600/20 data-[state=active]:to-amber-500/10 data-[state=active]:text-amber-300 data-[state=active]:border data-[state=active]:border-amber-500/30 data-[state=active]:shadow-lg data-[state=active]:shadow-amber-500/10"
            >
              <PackageIcon className="w-4 h-4" />
              库存列表
            </Tabs.Trigger>
            <Tabs.Trigger
              value="preset"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md transition-all duration-200 text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-600/20 data-[state=active]:to-amber-500/10 data-[state=active]:text-amber-300 data-[state=active]:border data-[state=active]:border-amber-500/30 data-[state=active]:shadow-lg data-[state=active]:shadow-amber-500/10"
            >
              <SwordIcon className="w-4 h-4" />
              添加预设物品
            </Tabs.Trigger>
            <Tabs.Trigger
              value="custom"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md transition-all duration-200 text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-600/20 data-[state=active]:to-amber-500/10 data-[state=active]:text-amber-300 data-[state=active]:border data-[state=active]:border-amber-500/30 data-[state=active]:shadow-lg data-[state=active]:shadow-amber-500/10"
            >
              <SparklesIcon className="w-4 h-4" />
              添加自定义物品
            </Tabs.Trigger>
          </Tabs.List>

          {/* 商店设置 */}
          <Tabs.Content value="settings" className="data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
            <ScrollArea style={{ height: 420 }} className="pr-2">
              <div className="space-y-4">
                {/* Avatar section */}
                <div className="flex items-start gap-4 p-4 rounded-lg bg-gray-800/30 border border-gray-700/30">
                  <div className="relative flex-shrink-0">
                    {shop?.avatar_url ? (
                      <img
                        src={shop.avatar_url}
                        alt={shop.name}
                        className="w-24 h-24 rounded-xl object-cover border-2 border-gray-600"
                      />
                    ) : (
                      <div className="w-24 h-24 rounded-xl bg-gray-700/50 border-2 border-gray-600 flex items-center justify-center">
                        <StoreIcon className="w-10 h-10 text-gray-500" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <Text size="2" className="text-gray-300 font-medium mb-2 block">商店头像</Text>
                    <Text size="1" className="text-gray-500 mb-3 block">
                      填写外观描述后可生成AI头像
                    </Text>
                    <button
                      onClick={handleGenerateShopAvatar}
                      disabled={isGeneratingAvatar || !settingsAppearance.trim()}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-600/20 text-amber-300 border border-amber-500/30 text-sm font-medium hover:bg-amber-600/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGeneratingAvatar ? (
                        <>
                          <RefreshIcon className="w-4 h-4 animate-spin" />
                          生成中...
                        </>
                      ) : (
                        <>
                          <SparklesIcon className="w-4 h-4" />
                          生成头像
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Basic info */}
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-gray-400 mb-1.5 block">商店名称</label>
                    <input
                      type="text"
                      value={settingsName}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSettingsName(val);
                        if (val.trim()) debouncedUpdateField('name', val.trim());
                      }}
                      placeholder="输入商店名称"
                      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-all"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-gray-400 mb-1.5 block">商店描述</label>
                    <textarea
                      value={settingsDescription}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSettingsDescription(val);
                        debouncedUpdateField('description', val.trim() || null);
                      }}
                      placeholder="描述商店的背景故事、特色商品等..."
                      rows={3}
                      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-all resize-none"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-gray-400 mb-1.5 block">外观描述（用于生成头像）</label>
                    <textarea
                      value={settingsAppearance}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSettingsAppearance(val);
                        debouncedUpdateField('appearance_description', val.trim() || null);
                      }}
                      placeholder="描述商店的外观，如：一间古老的魔法商店，门口挂着发光的水晶灯笼，橱窗里陈列着各种神秘的药水和卷轴..."
                      rows={2}
                      className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all resize-none"
                    />
                  </div>
                </div>

                {/* Financial settings */}
                <div className="p-4 rounded-lg bg-gradient-to-r from-amber-500/5 to-transparent border border-amber-500/20">
                  <div className="flex items-center gap-2 mb-3">
                    <CoinsIcon className="w-4 h-4 text-amber-400" />
                    <Text size="2" className="text-amber-200 font-medium">财务设置</Text>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-gray-400 mb-1.5 block">商店金币储备</label>
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900/50 border border-gray-700/50">
                        <CoinsIcon className="w-4 h-4 text-amber-500/70" />
                        <input
                          type="number"
                          min={0}
                          value={settingsGold}
                          onChange={(e) => {
                            const val = Math.max(0, parseInt(e.target.value || '0'));
                            setSettingsGold(val);
                            debouncedUpdateField('gold_gp', val, 300);
                          }}
                          className="flex-1 bg-transparent border-none text-sm text-amber-200 focus:outline-none focus:ring-0"
                        />
                        <span className="text-xs text-gray-500">gp</span>
                      </div>
                      <Text size="1" className="text-gray-500 mt-1 block">用于回收物品时支付给玩家</Text>
                    </div>

                    <div>
                      <label className="text-sm text-gray-400 mb-1.5 block">回收折扣率</label>
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900/50 border border-gray-700/50">
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={settingsDiscountRate}
                          onChange={(e) => {
                            const val = Math.min(1, Math.max(0, parseFloat(e.target.value || '0')));
                            setSettingsDiscountRate(val);
                            debouncedUpdateField('discount_rate', val, 300);
                          }}
                          className="flex-1 bg-transparent border-none text-sm text-gray-200 focus:outline-none focus:ring-0"
                        />
                        <span className="text-xs text-gray-500">({Math.round(settingsDiscountRate * 100)}%)</span>
                      </div>
                      <Text size="1" className="text-gray-500 mt-1 block">玩家出售物品时获得原价的百分比</Text>
                    </div>
                  </div>
                </div>

                {/* Buyback toggle */}
                <div className="p-4 rounded-lg bg-gray-800/30 border border-gray-700/30">
                  <div className="flex items-center justify-between">
                    <div>
                      <Text size="2" className="text-gray-200 font-medium block">允许回收物品</Text>
                      <Text size="1" className="text-gray-500 mt-0.5 block">
                        开启后玩家可以将物品出售给商店
                      </Text>
                    </div>
                    <button
                      onClick={() => {
                        const newVal = !settingsAcceptsSelling;
                        setSettingsAcceptsSelling(newVal);
                        updateShopField('accepts_selling', newVal);
                      }}
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        settingsAcceptsSelling
                          ? 'bg-gradient-to-r from-green-500 to-green-600'
                          : 'bg-gray-700'
                      }`}
                    >
                      <div
                        className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform ${
                          settingsAcceptsSelling ? 'translate-x-7' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </Tabs.Content>

          {/* 库存列表 */}
          <Tabs.Content value="list" className="data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
            <ScrollArea style={{ height: 380 }} className="pr-2">
              <Flex direction="column" gap="2">
                {loading && (
                  <div className="flex items-center justify-center py-12">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
                      <Text size="2" className="text-gray-400">加载库存中...</Text>
                    </div>
                  </div>
                )}
                {!loading && inventory.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-16 h-16 rounded-full bg-gray-800/50 border border-gray-700 flex items-center justify-center mb-3">
                      <PackageIcon className="w-8 h-8 text-gray-600" />
                    </div>
                    <Text size="2" className="text-gray-500">暂无库存物品</Text>
                    <Text size="1" className="text-gray-600 mt-1">切换到"添加预设物品"或"添加自定义物品"标签页添加商品</Text>
                  </div>
                )}
                {inventory.map(inv => {
                  const item = itemsById[inv.item_id];
                  return (
                    <div
                      key={inv.id}
                      className="group relative p-3 rounded-lg bg-gradient-to-r from-gray-800/80 to-gray-800/40 border border-gray-700/50 hover:border-amber-500/30 hover:from-gray-800 hover:to-gray-800/60 transition-all duration-200"
                    >
                      <Flex justify="between" align="start" gap="3">
                        <div
                          className="cursor-pointer flex-1 min-w-0"
                          onClick={() => showItemDetail(item)}
                        >
                          <Flex align="center" gap="3">
                            <div className="relative flex-shrink-0">
                              {getItemIcon(item) ? (
                                <img src={getItemIcon(item)!} alt="" className="w-12 h-12 rounded-lg object-cover border border-gray-600 group-hover:border-amber-500/50 transition-colors" />
                              ) : (
                                <div className="w-12 h-12 rounded-lg bg-gray-700/50 border border-gray-600 flex items-center justify-center">
                                  <PackageIcon className="w-5 h-5 text-gray-500" />
                                </div>
                              )}
                              {isNonTradable(inv.price_gp) && (
                                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gray-700 border border-gray-600 flex items-center justify-center" title="不可交易">
                                  <span className="text-[10px] text-gray-400">×</span>
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Text size="2" weight="bold" className="text-gray-100 group-hover:text-amber-200 transition-colors">
                                  {item ? (item.name_cn ? `${item.name_cn}` : item.name) : `#${inv.item_id}`}
                                </Text>
                                {item?.name_cn && item?.name && (
                                  <Text size="1" className="text-gray-500">({item.name})</Text>
                                )}
                              </div>
                              <Flex gap="1.5" mt="1.5" wrap="wrap">
                                {item?.subcategory && (
                                  <Badge size="1" variant="soft" className="!bg-gray-700/50 !text-gray-300">{SUBCATEGORY_CN[item.subcategory] || item.subcategory}</Badge>
                                )}
                                {item?.damage && (
                                  <Badge size="1" variant="soft" className={item.damage.type === 'healing'
                                    ? '!bg-green-500/10 !text-green-300 !border !border-green-500/20'
                                    : '!bg-red-500/10 !text-red-300 !border !border-red-500/20'
                                  }>
                                    {item.damage.dice} {DAMAGE_TYPE_CN[item.damage.type] || item.damage.type}
                                  </Badge>
                                )}
                                {item?.armor_class && (
                                  <Badge size="1" variant="soft" className="!bg-blue-500/10 !text-blue-300 !border !border-blue-500/20">
                                    AC {item.armor_class.base}
                                  </Badge>
                                )}
                                {typeof item?.weight !== 'undefined' && item?.weight !== null && (
                                  <Badge size="1" variant="outline" className="!text-gray-400 !border-gray-600">
                                    {item.weight} lb
                                  </Badge>
                                )}
                              </Flex>
                            </div>
                          </Flex>
                        </div>
                        <Flex gap="3" align="center" className="flex-shrink-0">
                          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-900/50 border border-gray-700/50">
                            <HashIcon className="w-3.5 h-3.5 text-gray-500" />
                            <input
                              type="number"
                              min={0}
                              value={inv.quantity}
                              onChange={(e) => handleUpdateInv(inv, { quantity: Math.max(0, parseInt(e.target.value || '0')) })}
                              className="w-14 bg-transparent border-none text-sm text-gray-200 focus:outline-none focus:ring-0 text-center"
                            />
                          </div>
                          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-900/50 border border-gray-700/50">
                            <CoinsIcon className="w-3.5 h-3.5 text-amber-500/70" />
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={inv.price_gp}
                              onChange={(e) => handleUpdateInv(inv, { price_gp: parseFloat(e.target.value || '0') })}
                              className="w-20 bg-transparent border-none text-sm text-amber-200 focus:outline-none focus:ring-0 text-center"
                            />
                            <span className="text-xs text-gray-500">gp</span>
                          </div>
                          {!item?.has_avatar && item && !isPresetItem(item) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleGenerateAvatar(item.id); }}
                              className="p-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-colors"
                              title="生成头像"
                            >
                              <ImagePlusIcon className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteInv(inv)}
                            className="p-1.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                            title="删除"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </Flex>
                      </Flex>
                    </div>
                  );
                })}
              </Flex>
            </ScrollArea>
          </Tabs.Content>

          {/* 预设物品 */}
          <Tabs.Content value="preset" className="data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
            <Flex direction="column" gap="3">
              {/* Search input */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="搜索预设物品..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-4 py-2.5 pl-10 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-all"
                />
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

              {/* Category buttons */}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => { setActiveCategory('weapons'); setSelectedPreset(null); setSelectedMagicItem(null); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeCategory === 'weapons'
                      ? 'bg-gradient-to-r from-red-500/20 to-red-600/10 text-red-300 border border-red-500/30 shadow-lg shadow-red-500/10'
                      : 'bg-gray-800/50 text-gray-400 border border-gray-700/50 hover:border-gray-600 hover:text-gray-300'
                  }`}
                >
                  <SwordIcon className="w-4 h-4" />
                  武器
                </button>
                <button
                  onClick={() => { setActiveCategory('armor'); setSelectedPreset(null); setSelectedMagicItem(null); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeCategory === 'armor'
                      ? 'bg-gradient-to-r from-blue-500/20 to-blue-600/10 text-blue-300 border border-blue-500/30 shadow-lg shadow-blue-500/10'
                      : 'bg-gray-800/50 text-gray-400 border border-gray-700/50 hover:border-gray-600 hover:text-gray-300'
                  }`}
                >
                  <ShieldIcon className="w-4 h-4" />
                  护甲
                </button>
                <button
                  onClick={() => { setActiveCategory('gear'); setSelectedPreset(null); setSelectedMagicItem(null); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeCategory === 'gear'
                      ? 'bg-gradient-to-r from-green-500/20 to-green-600/10 text-green-300 border border-green-500/30 shadow-lg shadow-green-500/10'
                      : 'bg-gray-800/50 text-gray-400 border border-gray-700/50 hover:border-gray-600 hover:text-gray-300'
                  }`}
                >
                  <BackpackIcon className="w-4 h-4" />
                  冒险装备
                </button>
                <button
                  onClick={() => { setActiveCategory('magic'); setSelectedPreset(null); setSelectedMagicItem(null); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeCategory === 'magic'
                      ? 'bg-gradient-to-r from-purple-500/20 to-purple-600/10 text-purple-300 border border-purple-500/30 shadow-lg shadow-purple-500/10'
                      : 'bg-gray-800/50 text-gray-400 border border-gray-700/50 hover:border-gray-600 hover:text-gray-300'
                  }`}
                >
                  <SparklesIcon className="w-4 h-4" />
                  魔法物品
                </button>
              </div>

              {/* Magic item subcategory filter */}
              {activeCategory === 'magic' && (
                <div className="flex gap-1.5 flex-wrap">
                  <button
                    onClick={() => setMagicSubCategory('all')}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${magicSubCategory === 'all' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-gray-800/50 text-gray-500 border border-gray-700/50 hover:text-gray-400'}`}
                  >
                    全部
                  </button>
                  {magicSubCategories.map(([cat, catCn]) => (
                    <button
                      key={cat}
                      onClick={() => setMagicSubCategory(cat)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${magicSubCategory === cat ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-gray-800/50 text-gray-500 border border-gray-700/50 hover:text-gray-400'}`}
                    >
                      {catCn}
                    </button>
                  ))}
                </div>
              )}

              {/* Item list */}
              <ScrollArea style={{ height: activeCategory === 'magic' ? 230 : 260 }} className="pr-2">
                <Flex direction="column" gap="2">
                  {eqLoading && (
                    <div className="flex items-center justify-center py-8">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-6 h-6 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
                        <Text size="2" className="text-gray-400">加载预设中...</Text>
                      </div>
                    </div>
                  )}
                  {/* Equipment items (weapons/armor/gear) */}
                  {!eqLoading && activeCategory !== 'magic' && filteredPreset.map(item => (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      className={`p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
                        selectedPreset?.id === item.id
                          ? 'bg-gradient-to-r from-amber-500/15 to-amber-600/5 border-amber-500/40 shadow-lg shadow-amber-500/10'
                          : 'bg-gray-800/30 border-gray-700/50 hover:border-gray-600 hover:bg-gray-800/50'
                      }`}
                      onClick={() => {
                        setSelectedPreset(item);
                        setSelectedMagicItem(null);
                        const gp = costToGp(item.cost);
                        setPresetPrice(gp);
                      }}
                    >
                      <Flex gap="3" align="center">
                        {item.iconPath ? (
                          <img src={getAssetUrl(item.iconPath.replace(/^\//, ''))} alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-600" />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-gray-700/50 border border-gray-600 flex items-center justify-center">
                            {activeCategory === 'weapons' && <SwordIcon className="w-4 h-4 text-gray-500" />}
                            {activeCategory === 'armor' && <ShieldIcon className="w-4 h-4 text-gray-500" />}
                            {activeCategory === 'gear' && <BackpackIcon className="w-4 h-4 text-gray-500" />}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <Text size="2" className={selectedPreset?.id === item.id ? 'text-amber-200' : 'text-gray-200'}>
                            {item.name} <span className="text-gray-500">({item.nameEn})</span>
                          </Text>
                          <Flex gap="1.5" mt="1" wrap="wrap">
                            {item.damage && (
                              <Badge size="1" variant="soft" className="!bg-red-500/10 !text-red-300 !border !border-red-500/20">
                                {item.damage} {item.damageType}
                              </Badge>
                            )}
                            {item.ac && (
                              <Badge size="1" variant="soft" className="!bg-blue-500/10 !text-blue-300 !border !border-blue-500/20">
                                AC {item.ac}
                              </Badge>
                            )}
                            {item.cost && (
                              <Badge size="1" variant="soft" className="!bg-amber-500/10 !text-amber-300 !border !border-amber-500/20">
                                <CoinsIcon className="w-3 h-3 mr-1" />
                                {costToGp(item.cost).toFixed(2)} gp
                              </Badge>
                            )}
                          </Flex>
                        </div>
                        <button
                          className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-700/50 hover:bg-gray-600/70 border border-gray-600 hover:border-gray-500 flex items-center justify-center transition-colors"
                          title="查看详情"
                          onClick={(e) => { e.stopPropagation(); showItemDetail(equipmentToItemResp(item)); }}
                        >
                          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        </button>
                        {selectedPreset?.id === item.id && (
                          <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                            <svg className="w-3 h-3 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </Flex>
                    </div>
                  ))}
                  {/* Magic items */}
                  {!eqLoading && activeCategory === 'magic' && filteredMagicItems.map(mi => {
                    const rarityKey = mi.rarity?.toLowerCase().replace(/\s+/g, '_');
                    const rarityColor = rarityKey === 'legendary' ? '!bg-orange-500/10 !text-orange-300 !border-orange-500/20'
                      : rarityKey === 'very_rare' || rarityKey === 'very rare' ? '!bg-purple-500/10 !text-purple-300 !border-purple-500/20'
                      : rarityKey === 'rare' ? '!bg-blue-500/10 !text-blue-300 !border-blue-500/20'
                      : rarityKey === 'uncommon' ? '!bg-green-500/10 !text-green-300 !border-green-500/20'
                      : '!bg-gray-700/50 !text-gray-400';
                    const isSelected = selectedMagicItem?.id === mi.id;
                    const healing = mi.consumable?.healing?.formula || mi.stats?.healing;
                    return (
                      <div
                        key={mi.id}
                        role="button"
                        tabIndex={0}
                        className={`p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
                          isSelected
                            ? 'bg-gradient-to-r from-purple-500/15 to-purple-600/5 border-purple-500/40 shadow-lg shadow-purple-500/10'
                            : 'bg-gray-800/30 border-gray-700/50 hover:border-gray-600 hover:bg-gray-800/50'
                        }`}
                        onClick={() => {
                          setSelectedMagicItem(mi);
                          setSelectedPreset(null);
                          setPresetPrice(RARITY_PRICE_GP[mi.rarity?.toLowerCase()] || 0);
                        }}
                      >
                        <Flex gap="3" align="center">
                          <div className="w-10 h-10 rounded-lg bg-purple-900/30 border border-purple-700/50 flex items-center justify-center">
                            <SparklesIcon className="w-4 h-4 text-purple-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <Text size="2" className={isSelected ? 'text-purple-200' : 'text-gray-200'}>
                              {mi.name} <span className="text-gray-500">({mi.nameEn})</span>
                            </Text>
                            <Flex gap="1.5" mt="1" wrap="wrap">
                              <Badge size="1" variant="soft" className={`!border ${rarityColor}`}>
                                {mi.rarityCn || mi.rarity}
                              </Badge>
                              <Badge size="1" variant="soft" className="!bg-gray-700/50 !text-gray-400">
                                {mi.categoryCn}
                              </Badge>
                              {healing && (
                                <Badge size="1" variant="soft" className="!bg-green-500/10 !text-green-300 !border !border-green-500/20">
                                  {healing} HP
                                </Badge>
                              )}
                              {mi.requiresAttunement && (
                                <Badge size="1" variant="soft" className="!bg-violet-500/10 !text-violet-300 !border !border-violet-500/20">
                                  调谐
                                </Badge>
                              )}
                            </Flex>
                          </div>
                          <button
                            className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-700/50 hover:bg-gray-600/70 border border-gray-600 hover:border-gray-500 flex items-center justify-center transition-colors"
                            title="查看详情"
                            onClick={(e) => { e.stopPropagation(); showItemDetail(magicItemToItemResp(mi)); }}
                          >
                            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                          </button>
                          {isSelected && (
                            <div className="w-5 h-5 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center">
                              <svg className="w-3 h-3 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </div>
                          )}
                        </Flex>
                      </div>
                    );
                  })}
                  {!eqLoading && activeCategory !== 'magic' && filteredPreset.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Text size="2" className="text-gray-500">未找到匹配的预设物品</Text>
                    </div>
                  )}
                  {!eqLoading && activeCategory === 'magic' && filteredMagicItems.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Text size="2" className="text-gray-500">未找到匹配的魔法物品</Text>
                    </div>
                  )}
                </Flex>
              </ScrollArea>

              {/* Selected item actions */}
              {(selectedPreset || selectedMagicItem) && (
                <div className="p-3 rounded-lg bg-gradient-to-r from-amber-500/5 to-transparent border border-amber-500/20">
                  <Flex gap="3" align="center" justify="between" wrap="wrap">
                    <div className="flex items-center gap-2">
                      <Text size="2" className="text-amber-200 font-medium">已选择：{selectedPreset?.name || selectedMagicItem?.name}</Text>
                    </div>
                    <Flex gap="3" align="center" wrap="wrap">
                      <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-900/50 border border-gray-700/50">
                        <HashIcon className="w-3.5 h-3.5 text-gray-500" />
                        <input
                          type="number"
                          min={1}
                          value={presetQty}
                          onChange={(e) => setPresetQty(Math.max(1, parseInt(e.target.value || '1')))}
                          className="w-14 bg-transparent border-none text-sm text-gray-200 focus:outline-none focus:ring-0 text-center"
                        />
                      </div>
                      <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-900/50 border border-gray-700/50">
                        <CoinsIcon className="w-3.5 h-3.5 text-amber-500/70" />
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={presetPrice}
                          onChange={(e) => setPresetPrice(parseFloat(e.target.value || '0'))}
                          className="w-20 bg-transparent border-none text-sm text-amber-200 focus:outline-none focus:ring-0 text-center"
                        />
                        <span className="text-xs text-gray-500">gp</span>
                      </div>
                      {isNonTradable(presetPrice) && (
                        <Badge size="1" variant="soft" className="!bg-gray-700/50 !text-gray-400">不可交易</Badge>
                      )}
                      <button
                        onClick={handleAddFromPreset}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-600 to-amber-700 text-white text-sm font-medium hover:from-amber-500 hover:to-amber-600 transition-all shadow-lg shadow-amber-500/20"
                      >
                        <PackageIcon className="w-4 h-4" />
                        添加到库存
                      </button>
                    </Flex>
                  </Flex>
                </div>
              )}
            </Flex>
          </Tabs.Content>

          {/* 自定义物品 (AI解析) */}
          <Tabs.Content value="custom" className="data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
            <Flex direction="column" gap="4">
              {/* Info banner */}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-900/15 border border-amber-600/30">
                <div className="w-8 h-8 rounded-lg bg-amber-600/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
                  <SparklesIcon className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <Text size="2" className="text-amber-200 font-medium">AI 智能创建</Text>
                  <Text size="1" className="text-gray-400 mt-0.5 block">
                    输入物品描述，AI将自动解析并创建结构化物品数据，然后加入商店库存
                  </Text>
                </div>
              </div>

              {/* Description textarea */}
              <div className="relative">
                <textarea
                  placeholder="例如：寒冰长剑，一把稀有的+1长剑，命中时额外造成1d6冷冻伤害。剑身覆盖着永不融化的冰霜，握柄处刻有古老的矮人符文。需要同调。"
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  disabled={isGenerating || isCreating}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all resize-none disabled:opacity-50"
                  style={{ minHeight: 120 }}
                />
                {(isGenerating || isCreating) && (
                  <div className="absolute inset-0 bg-gray-900/50 rounded-lg flex items-center justify-center">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                      <Text size="2" className="text-purple-300">{isGenerating ? '生成中...' : 'AI分析中...'}</Text>
                    </div>
                  </div>
                )}
              </div>

              {/* AI action buttons */}
              <Flex gap="2" align="center" wrap="wrap">
                <button
                  onClick={() => handleGenerateDescription(true)}
                  disabled={isGenerating || isCreating}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-orange-500/20 to-orange-600/10 text-orange-300 border border-orange-500/30 text-sm font-medium hover:from-orange-500/30 hover:to-orange-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Dice6Icon className="w-4 h-4" />
                  随机生成
                </button>
                <button
                  onClick={() => handleGenerateDescription(false)}
                  disabled={isGenerating || isCreating || !customDescription.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500/20 to-cyan-600/10 text-cyan-300 border border-cyan-500/30 text-sm font-medium hover:from-cyan-500/30 hover:to-cyan-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <WandIcon className="w-4 h-4" />
                  扩展描述
                </button>
                <Text size="1" className="text-gray-500">可多次点击生成不同内容</Text>
              </Flex>

              {/* Quantity and price inputs */}
              <div className="flex items-center gap-4 p-3 rounded-lg bg-gray-800/30 border border-gray-700/30">
                <div className="flex items-center gap-2">
                  <Text size="2" className="text-gray-400">数量</Text>
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-900/50 border border-gray-700/50">
                    <HashIcon className="w-3.5 h-3.5 text-gray-500" />
                    <input
                      type="number"
                      min={1}
                      value={customQty}
                      onChange={(e) => setCustomQty(Math.max(1, parseInt(e.target.value || '1')))}
                      disabled={isGenerating || isCreating}
                      className="w-14 bg-transparent border-none text-sm text-gray-200 focus:outline-none focus:ring-0 text-center disabled:opacity-50"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Text size="2" className="text-gray-400">价格</Text>
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-900/50 border border-gray-700/50">
                    <CoinsIcon className="w-3.5 h-3.5 text-amber-500/70" />
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={customPrice}
                      onChange={(e) => setCustomPrice(parseFloat(e.target.value || '0'))}
                      disabled={isGenerating || isCreating}
                      className="w-20 bg-transparent border-none text-sm text-amber-200 focus:outline-none focus:ring-0 text-center disabled:opacity-50"
                    />
                    <span className="text-xs text-gray-500">gp</span>
                  </div>
                </div>
                {isNonTradable(customPrice) && (
                  <Badge size="1" variant="soft" className="!bg-gray-700/50 !text-gray-400">不可交易</Badge>
                )}
              </div>

              {/* Error message */}
              {customError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <Text size="2" className="text-red-300">{customError}</Text>
                </div>
              )}

              {/* Create button */}
              <Flex justify="end">
                <button
                  onClick={handleCreateCustomItem}
                  disabled={isGenerating || isCreating || !customDescription.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-black text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <SparklesIcon className="w-4 h-4" />
                  {isCreating ? 'AI分析中...' : '创建并加入库存'}
                </button>
              </Flex>
            </Flex>
          </Tabs.Content>
        </Tabs.Root>

        {/* Footer */}
        <div className="mt-4 pt-4 border-t border-gray-800">
          <Flex justify="end">
            <button
              onClick={() => onOpenChange(false)}
              className="px-5 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm font-medium border border-gray-700 hover:bg-gray-700 hover:text-gray-200 transition-all"
            >
              关闭
            </button>
          </Flex>
        </div>
      </Dialog.Content>

      {/* Item Detail Dialog */}
      <Dialog.Root open={itemDetailOpen} onOpenChange={setItemDetailOpen}>
        <Dialog.Content aria-describedby={undefined} style={{ maxWidth: '520px' }} className="!bg-gradient-to-b !from-gray-900 !to-gray-950 !border !border-gray-700/50">
          {selectedItemDetail && (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  {getItemIcon(selectedItemDetail) ? (
                    <img
                      src={getItemIcon(selectedItemDetail)!}
                      alt={selectedItemDetail.name}
                      className="w-20 h-20 rounded-xl object-cover border-2 border-gray-600 shadow-lg"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-xl bg-gray-800 border-2 border-gray-600 flex items-center justify-center">
                      <PackageIcon className="w-8 h-8 text-gray-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <Dialog.Title className="!text-lg !font-bold !text-amber-100 !mb-1">
                      <span>{selectedItemDetail.name_cn || selectedItemDetail.name}</span>
                    </Dialog.Title>
                  {selectedItemDetail.name_cn && selectedItemDetail.name && (
                    <Text size="2" className="text-gray-400 block mb-2"><span>{selectedItemDetail.name}</span></Text>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {selectedItemDetail.category && (
                      <Badge size="1" variant="soft" className="!bg-blue-500/10 !text-blue-300 !border !border-blue-500/20">
                        <span>{CATEGORY_CN[selectedItemDetail.category] || selectedItemDetail.category}</span>
                      </Badge>
                    )}
                    {selectedItemDetail.subcategory && (
                      <Badge size="1" variant="soft" className="!bg-gray-700/50 !text-gray-300">
                        <span>{SUBCATEGORY_CN[selectedItemDetail.subcategory] || selectedItemDetail.subcategory}</span>
                      </Badge>
                    )}
                    {selectedItemDetail.rarity && selectedItemDetail.rarity !== 'common' && (
                      <Badge
                        size="1"
                        variant="soft"
                        className={
                          selectedItemDetail.rarity === 'legendary' ? '!bg-orange-500/10 !text-orange-300 !border !border-orange-500/20' :
                          selectedItemDetail.rarity === 'very rare' || selectedItemDetail.rarity === 'very_rare' ? '!bg-purple-500/10 !text-purple-300 !border !border-purple-500/20' :
                          selectedItemDetail.rarity === 'rare' ? '!bg-blue-500/10 !text-blue-300 !border !border-blue-500/20' :
                          selectedItemDetail.rarity === 'uncommon' ? '!bg-green-500/10 !text-green-300 !border !border-green-500/20' :
                          '!bg-gray-700/50 !text-gray-300'
                        }
                      >
                        <span>{RARITY_CN[selectedItemDetail.rarity] || selectedItemDetail.rarity}</span>
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    {selectedItemDetail.weight != null && (
                      <span className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                        </svg>
                        {selectedItemDetail.weight} lb
                      </span>
                    )}
                    {selectedItemDetail.cost && (
                      <span className="flex items-center gap-1 text-amber-400">
                        <CoinsIcon className="w-3.5 h-3.5" />
                        {costToGp(selectedItemDetail.cost).toFixed(2)} gp
                      </span>
                    )}
                  </div>
                </div>
                </div>
                <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors flex-shrink-0 self-start">
                  <span>✕</span>
                </Dialog.Close>
              </div>

              {/* Damage / Healing info */}
              {selectedItemDetail.damage && (() => {
                const isHealing = selectedItemDetail.damage?.type === 'healing';
                return (
                <div className={`p-3 rounded-lg bg-gradient-to-r ${isHealing ? 'from-green-500/10' : 'from-red-500/10'} to-transparent border ${isHealing ? 'border-green-500/20' : 'border-red-500/20'}`}>
                  <div className={`text-xs mb-1 font-medium ${isHealing ? 'text-green-400/70' : 'text-red-400/70'}`}>
                    {isHealing ? '治疗效果' : '伤害'}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-lg font-bold ${isHealing ? 'text-green-300' : 'text-red-300'}`}>{selectedItemDetail.damage.dice}</span>
                    {isHealing && (
                      <Badge size="1" variant="soft" className="!bg-green-500/10 !text-green-300">HP</Badge>
                    )}
                    {selectedItemDetail.damage.type && !isHealing && (
                      <Badge size="1" variant="soft" className="!bg-red-500/10 !text-red-300">
                        {DAMAGE_TYPE_CN[selectedItemDetail.damage.type] || selectedItemDetail.damage.type}
                      </Badge>
                    )}
                    {selectedItemDetail.magic_bonus != null && selectedItemDetail.magic_bonus > 0 && (
                      <Badge size="1" variant="soft" className="!bg-purple-500/10 !text-purple-300">
                        +{selectedItemDetail.magic_bonus} 魔法
                      </Badge>
                    )}
                  </div>
                  {selectedItemDetail.range && (
                    <div className="text-xs text-gray-400 mt-2">
                      {selectedItemDetail.properties?.some((p: string) => p === 'thrown' || p.includes('投掷')) ? '投掷射程' : '射程'}：{selectedItemDetail.range.normal}尺
                      {selectedItemDetail.range.long && ` / ${selectedItemDetail.range.long}尺`}
                    </div>
                  )}
                  {selectedItemDetail.extra_damage && (
                    <div className="text-xs text-purple-300 mt-1">
                      额外伤害：{selectedItemDetail.extra_damage.dice} {DAMAGE_TYPE_CN[selectedItemDetail.extra_damage.type] || selectedItemDetail.extra_damage.type}
                    </div>
                  )}
                </div>
                );
              })()}

              {/* Armor info */}
              {selectedItemDetail.armor_class && (
                <div className="p-3 rounded-lg bg-gradient-to-r from-blue-500/10 to-transparent border border-blue-500/20">
                  <div className="text-xs text-blue-400/70 mb-1 font-medium">护甲等级</div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-blue-300">{selectedItemDetail.armor_class.base}</span>
                    {selectedItemDetail.armor_class.dex_bonus && (
                      <span className="text-sm text-gray-400">
                        + 敏捷{selectedItemDetail.armor_class.max_dex_bonus != null && `（最大+${selectedItemDetail.armor_class.max_dex_bonus}）`}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Properties */}
              {selectedItemDetail.properties && selectedItemDetail.properties.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedItemDetail.properties.map((prop, i) => (
                    <Badge key={i} size="1" variant="outline" className="!text-gray-300 !border-gray-600">
                      {PROPERTY_CN[prop] || prop}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Attunement */}
              {selectedItemDetail.requires_attunement && (
                <div className="flex items-center gap-2 text-sm text-purple-300">
                  <SparklesIcon className="w-4 h-4" />
                  需要同调{selectedItemDetail.attunement_by && `（${selectedItemDetail.attunement_by}）`}
                </div>
              )}

              {/* Abilities */}
              {selectedItemDetail.abilities && selectedItemDetail.abilities.length > 0 && (
                <div className="space-y-2">
                  {selectedItemDetail.abilities.map((ability, i) => (
                    <div key={i} className="p-3 rounded-lg bg-gradient-to-r from-amber-500/10 to-transparent border border-amber-500/20">
                      <div className="text-sm font-semibold text-amber-300 mb-1">{ability.name}</div>
                      <div className="text-xs text-gray-300 leading-relaxed">{ability.description}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Description */}
              {(selectedItemDetail.description || selectedItemDetail.description_cn) && (
                <div className="p-3 rounded-lg bg-gray-800/30 border border-gray-700/30">
                  <div className="text-xs text-gray-500 mb-1.5 font-medium">描述</div>
                  <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {selectedItemDetail.description_cn || selectedItemDetail.description}
                  </div>
                </div>
              )}

              {/* Close button */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setItemDetailOpen(false)}
                  className="px-5 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm font-medium border border-gray-700 hover:bg-gray-700 hover:text-gray-200 transition-all"
                >
                  关闭
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Root>
    </Dialog.Root>
  );
}
