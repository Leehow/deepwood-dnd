import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { getApiEndpoint } from '../../config/api';
import { publishAppEvent } from '~/events/appEventBus';
import { createLogger } from '~/utils/logger';
import { getAssetUrl } from '~/utils/asset-url';
import { CornerOrnament, SpellDivider } from '../character/CharacterDisplay/sections/Spells/SpellbookSvg';

const logger = createLogger('ShopTransactionModal_v6');

const CATEGORY_CN: Record<string, string> = {
  weapon: '武器', armor: '护甲', adventuring_gear: '冒险装备', tool: '工具', misc: '杂项',
  wondrous_item: '奇物', potion: '药水', scroll: '卷轴', ring: '戒指', rod: '权杖',
  staff: '法杖', wand: '魔杖', weapons: '武器', ammo: '弹药',
};
const RARITY_CN: Record<string, string> = {
  common: '普通', uncommon: '精良', rare: '稀有', very_rare: '极稀有',
  'very rare': '极稀有', legendary: '传说', artifact: '神器',
};
const DAMAGE_TYPE_CN: Record<string, string> = {
  slashing: '挥砍', piercing: '穿刺', bludgeoning: '钝击', fire: '火焰', cold: '冰冷',
  lightning: '闪电', thunder: '雷鸣', acid: '强酸', poison: '毒素', radiant: '光耀',
  necrotic: '黯蚀', force: '力场', psychic: '心灵',
};
const PROPERTY_CN: Record<string, string> = {
  finesse: '灵巧', versatile: '多用', heavy: '重型', light: '轻型', reach: '触及',
  thrown: '投掷', 'two-handed': '双手', loading: '装填', ammunition: '弹药', special: '特殊',
};

// 辅助组件：参数标签
const ItemPropertyTag = ({ label, value }: { label: string; value: string | number | React.ReactNode }) => (
  <div className="flex flex-col bg-amber-900/5 border border-amber-900/10 rounded px-2.5 py-1.5 shadow-sm">
    <span className="text-[9px] uppercase opacity-40 font-black leading-none mb-1 tracking-wider">{label}</span>
    <span className="text-xs font-bold text-amber-950 leading-none">{value}</span>
  </div>
);

// 货币格式化
const formatCurrency = (totalGp: number, isDarkBg = true) => {
  const gp = Math.floor(totalGp);
  const remainingGp = totalGp - gp;
  const sp = Math.floor(remainingGp * 10);
  const cp = Math.round((remainingGp * 10 - sp) * 10);
  
  const textClass = isDarkBg ? 'text-amber-100/90' : 'text-[#362214]';
  const labelClass = isDarkBg ? 'text-amber-500/50' : 'text-[#362214]/60';

  return (
    <div className={`flex items-center gap-1 font-fantasy font-bold ${textClass}`}>
      {gp > 0 && <span className={isDarkBg ? 'text-fantasy-gold' : 'text-yellow-700'}>{gp}<small className={`ml-0.5 text-[9px] ${labelClass}`}>G</small></span>}
      {sp > 0 && <span className={isDarkBg ? 'text-gray-300' : 'text-gray-600'}>{sp}<small className={`ml-0.5 text-[9px] ${labelClass}`}>S</small></span>}
      {cp > 0 && <span className={isDarkBg ? 'text-fantasy-bronze' : 'text-orange-800'}>{cp}<small className={`ml-0.5 text-[9px] ${labelClass}`}>C</small></span>}
      {gp === 0 && sp === 0 && cp === 0 && <span className="opacity-30">0</span>}
    </div>
  );
};

const getRarityStyles = (rarity: string, isLight: boolean) => {
  const r = (rarity || 'common').toLowerCase();
  if (isLight) {
    return {
      common: 'border-[#362214]/20 bg-black/5',
      uncommon: 'border-green-700/50 bg-green-700/5',
      rare: 'border-blue-700/50 bg-blue-700/5',
      very_rare: 'border-purple-700/50 bg-purple-700/5',
      legendary: 'border-orange-600/60 bg-orange-600/5',
      artifact: 'border-amber-600 bg-amber-600/10 shadow-[0_0_8px_rgba(217,119,6,0.2)]',
    }[r] || 'border-[#362214]/20 bg-black/5';
  }
  return {
    common: 'border-[#543822] bg-[#0a0604]',
    uncommon: 'border-green-600/60 bg-[#0a0604]',
    rare: 'border-blue-500/60 bg-[#0a0604]',
    very_rare: 'border-purple-500/60 bg-[#0a0604]',
    legendary: 'border-orange-500/70 bg-[#0a0604]',
    artifact: 'border-amber-400 bg-[#0a0604]',
  }[r] || 'border-[#543822] bg-[#0a0604]';
};

interface InventoryItem { id: number; item_id: number; quantity: number; price_gp: number; }
interface ItemResp { id: number; name: string; name_cn?: string; category?: string; weight?: number; cost?: any; avatar_url?: string | null; rarity?: string; description?: string; description_cn?: string; subcategory?: string; damage?: any; armor_class?: any; properties?: string[]; requires_attunement?: boolean; abilities?: any[]; magic_bonus?: number; range?: any; extra_damage?: any; source_module?: string; }
interface CharacterEquipmentItem { libraryItemId?: number; id?: string; name?: string; quantity?: number; equippedSlot?: string; }

const EQUIPMENT_SELECTION_SEPARATOR = '::';

const getEquipmentLibraryItemId = (item: CharacterEquipmentItem): number | undefined => {
  const value = item.libraryItemId;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const getEquipmentIdentity = (item: CharacterEquipmentItem, index: number): string => {
  const libraryItemId = getEquipmentLibraryItemId(item);
  if (libraryItemId != null) return String(libraryItemId);
  if (item.id) return item.id;
  if (item.name) return item.name;
  return `item-${index}`;
};

const getEquipmentSelectionKey = (item: CharacterEquipmentItem, index: number): string =>
  `${getEquipmentIdentity(item, index)}${EQUIPMENT_SELECTION_SEPARATOR}${index}`;

const parseEquipmentSelectionKey = (key: string): { identity: string; index: number } => {
  const separatorIndex = key.lastIndexOf(EQUIPMENT_SELECTION_SEPARATOR);
  if (separatorIndex < 0) {
    return { identity: key, index: -1 };
  }

  return {
    identity: key.slice(0, separatorIndex),
    index: Number(key.slice(separatorIndex + EQUIPMENT_SELECTION_SEPARATOR.length)),
  };
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  shop: { id: number; name: string; discount_rate: number; accepts_selling?: boolean; campaign_id?: number } | null;
  defaultCharacterId?: number;
  campaignId?: string;
  isDM?: boolean;
  tokenId?: number;
  onDeleteToken?: (tokenId: number) => void;
}

export const ShopTransactionModal: React.FC<Props> = ({ open, onOpenChange, shop, defaultCharacterId, campaignId, isDM }) => {
  const [activeTab, setActiveTab] = useState<'shop' | 'deal' | 'backpack'>('shop');
  const [isMobile, setIsMobile] = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [playerItems, setPlayerItems] = useState<CharacterEquipmentItem[]>([]);
  const [itemDetails, setItemDetails] = useState<Record<string | number, ItemResp>>({});
  const [wallet, setWallet] = useState<any>({ gp: 0, sp: 0, cp: 0 });
  const [characterData, setCharacterData] = useState<any>(null);
  const [characterId, setCharacterId] = useState<string>(defaultCharacterId ? String(defaultCharacterId) : '');
  const [characters, setCharacters] = useState<any[]>([]);
  const [loadingCharacters, setLoadingCharacters] = useState(false);
  const [equipmentData, setEquipmentData] = useState<any>(null);
  const [selectedDetail, setSelectedDetail] = useState<ItemResp | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [toGet, setToGet] = useState<Record<number, number>>({});
  const [toGive, setToGive] = useState<Record<string, number>>({});

  useEffect(() => {
    // Client-only: used to gate mobile-only UI (inline -qty+ under items) and avoid mis-taps.
    const check = () => setIsMobile(window.matchMedia('(max-width: 767px)').matches);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // 加载本地数据
  useEffect(() => {
    if (!open) return;
    import('~/data/rules/equipment.json').then(m => setEquipmentData(m.default)).catch(() => {});
  }, [open]);

  const presetMaps = useMemo(() => {
    const iconMap: Record<string, string> = {};
    const priceMap: Record<string, number> = {};
    const infoMap: Record<string, { category: string; weight: number; description?: string; damage?: string; damageType?: string; properties?: string[]; range?: any; ac?: string; armorType?: string; stealthDisadvantage?: boolean }> = {};
    if (!equipmentData) return { iconMap, priceMap, infoMap };
    const costToGp = (c: any): number => {
      if (!c) return 0;
      if (typeof c.gp === 'number') return c.gp;
      if (typeof c.sp === 'number') return c.sp * 0.1;
      if (typeof c.cp === 'number') return c.cp * 0.01;
      return 0;
    };
    const processList = (list: any[], category: string) => {
      if (!Array.isArray(list)) return;
      list.forEach(p => {
        const gp = typeof p.costCopper === 'number' ? p.costCopper / 100 : costToGp(p.cost);
        const info: typeof infoMap[string] = { category, weight: p.weight || 0, description: p.description, damage: p.damage, damageType: p.damageType, properties: p.properties, range: p.range, ac: p.ac, armorType: p.type, stealthDisadvantage: p.stealthDisadvantage };
        if (p.nameEn) { const en = p.nameEn.toLowerCase(); iconMap[en] = p.iconPath; priceMap[en] = gp; infoMap[en] = info; }
        if (p.name) { const cn = p.name.toLowerCase(); iconMap[cn] = p.iconPath; priceMap[cn] = gp; infoMap[cn] = info; }
      });
    };
    const g = equipmentData.adventuringGear || {}, w = equipmentData.weapons || {}, a = equipmentData.armor || {}, t = equipmentData.tools || {};
    [w.simple?.melee, w.simple?.ranged, w.martial?.melee, w.martial?.ranged].forEach(l => processList(l, 'weapon'));
    [a.light, a.medium, a.heavy, a.shields].forEach(l => processList(l, 'armor'));
    Object.values(g).forEach(l => processList(l as any[], 'adventuring_gear'));
    Object.values(t).forEach(l => processList(l as any[], 'tool'));
    return { iconMap, priceMap, infoMap };
  }, [equipmentData]);

  // 从物品属性自动生成描述
  const generateItemDescription = (item: ItemResp, fallbackName?: string): string => {
    if (item.description_cn || item.description) return item.description_cn || item.description || '';
    const fb = (fallbackName || item.name)?.toLowerCase();
    const preset = fb ? presetMaps.infoMap[fb] : undefined;
    if (preset?.description) return preset.description;
    const parts: string[] = [];
    const cat = item.category || preset?.category;
    const dmg = item.damage || (preset?.damage ? { dice: preset.damage, type: preset.damageType } : null);
    if (cat === 'weapon' || dmg) {
      parts.push(`伤害: ${typeof dmg === 'object' ? dmg.dice : dmg || '—'} ${DAMAGE_TYPE_CN[(typeof dmg === 'object' ? dmg.type : preset?.damageType) || ''] || ''}`);
      const props = item.properties || preset?.properties;
      if (props?.length) parts.push(`属性: ${props.map((p: string) => PROPERTY_CN[p.toLowerCase()] || p).join('、')}`);
      const range = item.range || preset?.range;
      if (range) parts.push(`射程: ${range.normal || range}/${range.long || '—'}尺`);
    } else if (cat === 'armor') {
      const ac = preset?.ac;
      if (ac) parts.push(`AC: ${ac}`);
      if (preset?.stealthDisadvantage) parts.push('穿戴此护甲时，隐匿检定具有劣势');
    }
    if (parts.length) parts.push(`重量: ${item.weight || preset?.weight || 0} 磅`);
    return parts.length ? parts.join('。\n') + '。' : '标准装备，无特殊描述。';
  };

  const getItemIcon = (item?: ItemResp, fallbackName?: string): string | undefined => {
    if (item?.avatar_url) return item.avatar_url.startsWith('http') ? item.avatar_url : getAssetUrl(item.avatar_url.replace(/^\//, ''));
    const en = item?.name?.toLowerCase(), cn = item?.name_cn?.toLowerCase(), fb = fallbackName?.toLowerCase();
    const path = (en && presetMaps.iconMap[en]) || (cn && presetMaps.iconMap[cn]) || (fb && presetMaps.iconMap[fb]);
    return path ? getAssetUrl(path.replace(/^\//, '')) : undefined;
  };

  const getBasePriceGp = (item?: ItemResp, fallbackName?: string): number => {
    if (item?.cost?.amount) {
      const u = (item.cost.unit || 'gp').toLowerCase();
      const a = Number(item.cost.amount);
      if (u === 'gp') return a; if (u === 'sp') return a * 0.1; if (u === 'cp') return a * 0.01;
    }
    const en = item?.name?.toLowerCase(), cn = item?.name_cn?.toLowerCase(), fb = fallbackName?.toLowerCase();
    return (en && presetMaps.priceMap[en]) || (cn && presetMaps.priceMap[cn]) || (fb && presetMaps.priceMap[fb]) || 0;
  };

  useEffect(() => {
    if (open && defaultCharacterId) setCharacterId(String(defaultCharacterId));
  }, [open, defaultCharacterId]);

  useEffect(() => {
    const loadChars = async () => {
      const cid = campaignId || shop?.campaign_id;
      if (!open || !isDM || !cid) return;
      try {
        setLoadingCharacters(true);
        const resp = await fetch(getApiEndpoint(`/api/campaigns/${cid}/members`));
        const members = await resp.json();
        const charPromises = members.filter((m: any) => m.role === 'player' && m.selected_character_id).map(async (m: any) => {
          const r = await fetch(getApiEndpoint(`/api/characters/${m.selected_character_id}`));
          const c = await r.json();
          return { id: c.id, name: c.name, level: c.level };
        });
        setCharacters((await Promise.all(charPromises)).filter(Boolean));
      } catch {} finally { setLoadingCharacters(false); }
    };
    loadChars();
  }, [open, isDM, campaignId, shop?.campaign_id]);

  useEffect(() => {
    if (!open || !shop) return;
    const run = async () => {
      try {
        const invR = await fetch(getApiEndpoint(`/api/shops/${shop.id}/inventory`));
        const inv = await invR.json();
        setInventory(inv);
        const ids = new Set<string | number>();
        inv.forEach((i: any) => ids.add(i.item_id));
        if (characterId) {
          const charR = await fetch(getApiEndpoint(`/api/characters/${characterId}`));
          const char = await charR.json();
          setCharacterData(char);
          setPlayerItems(char.equipment || []);
          setWallet(char.currency || { gp: 0, sp: 0, cp: 0 });
          (char.equipment || []).forEach((e: any) => {
            const id = getEquipmentLibraryItemId(e);
            if (id != null) ids.add(id);
          });
        }
        for (const id of Array.from(ids)) {
          if (!itemDetails[id]) {
            fetch(getApiEndpoint(`/api/items/${id}`)).then(r => r.json()).then(d => {
              setItemDetails(prev => ({ ...prev, [id]: d }));
            }).catch(() => {});
          }
        }
      } catch {}
    };
    run();
  }, [open, shop?.id, characterId]);

  const charismaModifier = useMemo(() => Math.floor(((characterData?.ability_scores?.charisma || 10) - 10) / 2), [characterData]);
  const finalDiscountRate = useMemo(() => Math.min(0.95, (shop?.discount_rate || 0.5) + (charismaModifier * 0.02)), [shop?.discount_rate, charismaModifier]);

  const dealSummary = useMemo(() => {
    let cost = 0, gain = 0, weight = 0;
    Object.entries(toGet).forEach(([id, q]) => {
      const inv = inventory.find(i => i.id === Number(id));
      if (inv) { cost += inv.price_gp * q; weight += (itemDetails[inv.item_id]?.weight || 0) * q; }
    });
    Object.entries(toGive).forEach(([key, q]) => {
      const { index } = parseEquipmentSelectionKey(key);
      const item = playerItems[index];
      if (item) {
        const libraryItemId = getEquipmentLibraryItemId(item);
        const detail = libraryItemId != null ? itemDetails[libraryItemId] : undefined;
        gain += (getBasePriceGp(detail, item.name) * finalDiscountRate) * q;
        weight -= (detail?.weight || 0) * q;
      }
    });
    return { balance: cost - gain, weight, totalCost: cost, totalGain: gain };
  }, [toGet, toGive, inventory, playerItems, itemDetails, finalDiscountRate, presetMaps]);

  const handleItemClick = (id: string | number, type: 'shop' | 'player') => {
    if (type === 'shop') {
      const invId = Number(id);
      const inv = inventory.find(i => i.id === invId);
      if (!inv || inv.quantity <= 0) return;
      setToGet(p => ({ ...p, [invId]: Math.min((p[invId] || 0) + 1, inv.quantity) }));
    } else {
      const { index } = parseEquipmentSelectionKey(String(id));
      const item = playerItems[index];
      if (!item || (item as any).equippedSlot) return;
      setToGive(p => ({ ...p, [id]: Math.min((p[id] || 0) + 1, (item as any).quantity || 1) }));
    }
  };

  const updateQty = (id: string | number, delta: number, type: 'shop' | 'player') => {
    if (type === 'shop') {
      const invId = Number(id), inv = inventory.find(i => i.id === invId);
      if (!inv) return;
      setToGet(p => {
        const next = { ...p }, n = (next[invId] || 0) + delta;
        const capped = Math.min(n, inv.quantity);
        if (capped <= 0) delete next[invId]; else next[invId] = capped;
        return next;
      });
    } else {
      const key = String(id);
      const { index } = parseEquipmentSelectionKey(key);
      const item = playerItems[index];
      if (!item) return;
      setToGive(p => {
        const next = { ...p }, n = (next[key] || 0) + delta;
        if (n <= 0) delete next[key]; else next[key] = Math.min(n, item.quantity || 1);
        return next;
      });
    }
  };

  const handleCheckout = async () => {
    if (!shop || !characterId) { setErrMsg('未选择角色'); return; }
    if (dealSummary.balance > (wallet.gp + wallet.sp/10 + wallet.cp/100)) { setErrMsg('金钱不足'); return; }
    setBusy(true); setErrMsg('');
    try {
      for (const [key, qty] of Object.entries(toGive)) {
        const { index } = parseEquipmentSelectionKey(key);
        const equip = playerItems[index];
        if (!equip) continue;
        const libraryItemId = getEquipmentLibraryItemId(equip);
        if (libraryItemId == null) {
          throw new Error(`物品“${equip.name || '未命名物品'}”没有资源库条目，当前不能卖给商店`);
        }
        let inv = inventory.find(i => i.item_id === libraryItemId);
        if (!inv) {
          const r = await fetch(getApiEndpoint(`/api/shops/${shop.id}/inventory`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              item_id: libraryItemId,
              quantity: 0,
              price_gp: getBasePriceGp(itemDetails[libraryItemId], equip.name),
            }),
          });
          const created = (await r.json()) as InventoryItem;
          if (!created) throw new Error('创建商店库存失败');
          inv = created;
          setInventory(p => [...p, created]);
        }
        if (!inv) throw new Error('创建商店库存失败');
        await fetch(getApiEndpoint(`/api/shops/${shop.id}/sell`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ character_id: Number(characterId), inventory_id: inv.id, quantity: qty }) });
      }
      for (const [id, qty] of Object.entries(toGet)) {
        await fetch(getApiEndpoint(`/api/shops/${shop.id}/buy`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ character_id: Number(characterId), inventory_id: Number(id), quantity: qty }) });
      }
      setToGet({}); setToGive({});
      const charR = await fetch(getApiEndpoint(`/api/characters/${characterId}`));
      const char = await charR.json(); setCharacterData(char); setPlayerItems(char.equipment || []); setWallet(char.currency || {gp:0,sp:0,cp:0});
      publishAppEvent('characterEquipmentUpdated', {
        characterId: Number(characterId),
        currency: char.currency,
      });
    } catch (e: any) { setErrMsg(e.message || '交易失败'); } finally { setBusy(false); }
  };

  // 子组件: 物品格
  const ItemSlot = ({ id, itemId, quantity, type, isSelected, isLight = false, showControls = false, fallbackName }: any) => {
    const detail = itemId != null ? itemDetails[itemId] : undefined;
    const iconUrl = getItemIcon(detail, fallbackName);
    const name = detail ? (detail.name_cn || detail.name) : (fallbackName || '...');

    const selectedQty = type === 'shop' ? (toGet[Number(id)] || 0) : (toGive[String(id)] || 0);
    const maxQty = (() => {
      if (type === 'shop') {
        return inventory.find(i => i.id === Number(id))?.quantity || 0;
      }
      const { index } = parseEquipmentSelectionKey(String(id));
      return playerItems[index]?.quantity || 1;
    })();

    // Mobile: when the "契约" panel isn't visible, show inline -qty+ under each item.
    const showInlineQtyControls = isMobile && !showControls && (
      (activeTab === 'shop' && type === 'shop') ||
      (activeTab === 'backpack' && type === 'player')
    );

    const openDetail = () => {
      if (detail) {
        setSelectedDetail(detail);
        setDetailOpen(true);
        return;
      }
      const fb = fallbackName?.toLowerCase();
      const preset = fb ? presetMaps.infoMap[fb] : undefined;
      setSelectedDetail({
        name: fallbackName || '未知物品',
        name_cn: fallbackName,
        category: preset?.category,
        weight: preset?.weight,
        description: preset?.description,
        rarity: 'common',
      } as ItemResp);
      setDetailOpen(true);
    };
    let priceDisp = 0;
    if (type === 'shop') {
      priceDisp = inventory.find(i => i.id === Number(id))?.price_gp || 0;
    } else if (type === 'player') {
      const { index } = parseEquipmentSelectionKey(String(id));
      priceDisp = getBasePriceGp(detail, playerItems[index]?.name) * finalDiscountRate;
    }
    return (
      <div className="flex flex-col items-center gap-1 group min-w-[68px]">
        <div 
          className={`relative w-[64px] h-[64px] border-[1.5px] rounded-sm flex items-center justify-center cursor-pointer transition-all hover:scale-105 active:scale-95 ${getRarityStyles(detail?.rarity || 'common', isLight)} ${isSelected ? 'ring-2 ring-amber-500' : ''}`}
	          onClick={() => {
	            if (isMobile) {
	              openDetail();
	              return;
	            }
	            handleItemClick(id, type);
	          }}
        >
          {iconUrl ? (
            <img src={iconUrl} className="w-[85%] h-[85%] object-contain pointer-events-none drop-shadow-md" alt="" />
          ) : (
            <div className={`text-[8px] font-bold text-center px-1 break-all line-clamp-3 uppercase ${isLight ? 'text-[#362214]' : 'text-amber-100/60'}`}>{name}</div>
          )}
          {quantity > 1 && !showControls && (
            <span className="absolute bottom-0.5 right-1 text-[9px] font-bold px-1 bg-black/80 text-amber-400 rounded-sm border border-white/10">{quantity}</span>
          )}
          {selectedQty > 0 && !showControls && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-amber-500 text-[#1a100a] text-[11px] font-black flex items-center justify-center shadow">
              {selectedQty}
            </span>
          )}
        </div>
        <div 
          className={`text-[9px] font-bold text-center w-full truncate px-1 max-w-[68px] leading-tight cursor-help hover:underline underline-offset-2 decoration-dotted transition-colors ${isLight ? 'text-[#362214]/80 hover:text-[#362214]' : 'text-amber-100/50 hover:text-amber-100'}`}
          onClick={(e) => { e.stopPropagation(); openDetail(); }}
          title="点击查看详情"
        >{name}</div>
        {showControls ? (
          <div className="flex items-center gap-1.5 bg-[#362214]/5 rounded-full px-1 py-0.5 border border-[#362214]/20 scale-95 mt-0.5">
            <button onClick={e => { e.stopPropagation(); updateQty(id, -1, type); }} className="hover:text-red-700 font-black px-1 text-xs">－</button>
            <span className="text-[11px] font-black min-w-[20px] text-center text-[#ebd8b7] bg-[#362214] rounded-sm px-1 shadow-sm">{quantity}</span>
            <button onClick={e => { e.stopPropagation(); updateQty(id, 1, type); }} className="hover:text-green-700 font-black px-1 text-xs">＋</button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            {showInlineQtyControls && (
              <div className={`flex items-center gap-1.5 rounded-full px-1 py-0.5 border scale-95 ${isLight ? 'bg-[#362214]/5 border-[#362214]/20' : 'bg-black/30 border-[#3e2716]'}`}>
                <button
                  onClick={(e) => { e.stopPropagation(); updateQty(id, -1, type); }}
                  disabled={selectedQty <= 0}
                  className={`px-1 text-sm font-black ${selectedQty <= 0 ? 'opacity-40' : ''} ${isLight ? 'text-[#362214] hover:text-red-700' : 'text-amber-100/80 hover:text-red-300'}`}
                  aria-label="减少数量"
                >
                  －
                </button>
                <span className={`text-[11px] font-black min-w-[20px] text-center rounded-sm px-1 shadow-sm ${isLight ? 'text-[#ebd8b7] bg-[#362214]' : 'text-[#1a100a] bg-amber-500'}`}>
                  {selectedQty}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); updateQty(id, 1, type); }}
                  disabled={maxQty <= 0 || selectedQty >= maxQty}
                  className={`px-1 text-sm font-black ${(maxQty <= 0 || selectedQty >= maxQty) ? 'opacity-40' : ''} ${isLight ? 'text-[#362214] hover:text-green-700' : 'text-amber-100/80 hover:text-green-300'}`}
                  aria-label="增加数量"
                >
                  ＋
                </button>
              </div>
            )}
            <div className="mt-[-1px] scale-90">{formatCurrency(priceDisp, !isLight)}</div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] pointer-events-none" />
        <Dialog.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[98vw] md:w-[95vw] max-w-[1400px] z-[101] flex flex-col max-h-[94dvh] overflow-hidden rounded shadow-2xl bg-[#22150d] border border-[#4a3018] ring-4 ring-[#150d08] font-serif">
          {/* Header */}
          <div className="px-6 py-4 flex flex-col md:flex-row items-center justify-between bg-gradient-to-b from-[#1a100a] to-[#22150d] border-b-2 border-[#100905] relative gap-4">
            <div className="absolute inset-0 bg-[url('/assets/textures/wood-pattern.png')] opacity-10 mix-blend-overlay pointer-events-none" />
            <div className="relative z-10 w-full md:w-auto flex justify-between items-center">
              <div>
                <Dialog.Title className="text-2xl font-fantasy tracking-[0.2em] uppercase m-0 text-amber-500 drop-shadow-[0_2px_2px_rgba(0,0,0,1)] flex items-center gap-3">{shop?.name || '商会库房'}</Dialog.Title>
                <div className="text-[11px] font-bold uppercase tracking-widest mt-1 text-amber-200/50">议价加成: +{Math.round(charismaModifier * 2)}% | 折价: {(finalDiscountRate*100).toFixed(0)}%</div>
              </div>
              <Dialog.Close className="md:hidden w-10 h-10 flex items-center justify-center text-amber-500/60 hover:text-amber-400 text-2xl">✕</Dialog.Close>
            </div>
            <div className="relative z-10 flex items-center gap-4 w-full md:w-auto justify-end">
              {isDM && (
                <div className="flex items-center gap-2 bg-[#170e09] border border-[#3e2716] rounded px-3 py-1.5 shadow-inner">
                  <span className="text-[10px] text-amber-500/50 uppercase tracking-widest font-bold">代理:</span>
                  <select value={characterId} onChange={e => setCharacterId(e.target.value)} className="bg-transparent border-none text-amber-100 text-xs focus:ring-0 max-w-[150px] truncate cursor-pointer">
                    <option value="" className="bg-[#1a100a]">-- 选择角色 --</option>
                    {characters.map(c => <option key={c.id} value={c.id} className="bg-[#1a100a]">{c.name} (Lv.{c.level})</option>)}
                  </select>
                </div>
              )}
              <Dialog.Close className="hidden md:flex w-10 h-10 items-center justify-center hover:bg-white/5 rounded-sm transition-colors text-2xl text-amber-500/60 hover:text-amber-400">✕</Dialog.Close>
            </div>
          </div>

			  <div className="flex-1 overflow-hidden min-h-0 flex flex-col md:flex-row p-4 md:p-6 gap-6 bg-[#2a1a10] relative">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0)_0%,rgba(0,0,0,0.6)_100%)] pointer-events-none" />
            <div className={`flex-[1.2] flex flex-col min-h-0 overflow-hidden p-5 bg-[#170e09] border border-[#3e2716] rounded shadow-inner relative ${activeTab !== 'shop' && 'hidden md:flex'}`}>
              <CornerOrnament className="absolute top-1 left-1 opacity-20 text-amber-700" />
              <h3 className="text-xs font-bold uppercase mb-4 text-amber-500/70 tracking-widest text-center border-b border-[#3e2716] pb-2 flex-shrink-0">供货架</h3>
              <div className="flex-1 min-h-0 grid grid-cols-4 sm:grid-cols-5 xl:grid-cols-6 gap-x-2.5 gap-y-4 overflow-y-auto overscroll-contain pr-2 custom-scrollbar touch-pan-y">
                {inventory.map(inv => <ItemSlot key={inv.id} id={inv.id} itemId={inv.item_id} quantity={inv.quantity} type="shop" isSelected={!!toGet[inv.id]} />)}
              </div>
            </div>
            <div className={`flex-1 flex flex-col min-h-0 overflow-hidden p-4 bg-[#ebd8b7] spellbook-page-texture relative border border-[#d4af37]/40 rounded shadow-2xl z-20 ${activeTab !== 'deal' && 'hidden md:flex'}`}>
              <CornerOrnament className="absolute top-2 left-2 text-amber-700/50" /><CornerOrnament className="absolute top-2 right-2 -scale-x-100 text-amber-700/50" />
              <h3 className="text-base font-fantasy font-bold uppercase mb-2 text-center tracking-[0.3em] border-b-2 border-[#362214]/10 pb-1.5 text-[#362214] flex-shrink-0">交易契约</h3>
              <div className="flex-1 flex flex-col gap-2 overflow-y-auto spellbook-scroll min-h-0">
                {/* 购入清单 */}
                <div className="flex-shrink-0">
                  <div className="text-[10px] font-bold uppercase opacity-50 mb-1 flex justify-between text-[#362214]">
                    <span>购入项目</span>
                    {Object.keys(toGet).length > 0 && <span className="cursor-pointer hover:underline text-red-800" onClick={() => setToGet({})}>清空</span>}
                  </div>
                  {Object.keys(toGet).length === 0 ? (
                    <div className="text-[11px] italic opacity-30 text-center py-2 text-[#362214]">点击货架物品添加</div>
                  ) : (
                    <div className="space-y-0.5">
                      {Object.entries(toGet).map(([id, q]) => {
                        const inv = inventory.find(i => i.id === Number(id));
                        if (!inv) return null;
                        const detail = itemDetails[inv.item_id];
                        const name = detail ? (detail.name_cn || detail.name) : '...';
                        const unitPrice = inv.price_gp;
                        return (
                          <div key={id} className="flex items-center gap-1 text-[11px] text-[#362214] group">
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              <button onClick={() => updateQty(Number(id), -1, 'shop')} className="w-4 h-4 flex items-center justify-center text-[10px] font-black opacity-40 hover:opacity-100 hover:text-red-700">－</button>
                              <span className="font-black min-w-[14px] text-center text-[10px] bg-[#362214] text-[#ebd8b7] rounded-sm px-0.5">{q}</span>
                              <button onClick={() => updateQty(Number(id), 1, 'shop')} className="w-4 h-4 flex items-center justify-center text-[10px] font-black opacity-40 hover:opacity-100 hover:text-green-700">＋</button>
                            </div>
                            <span className="truncate flex-1 font-bold">{name}</span>
                            <span className="flex-shrink-0 text-[10px] opacity-50">{unitPrice}g×{q}</span>
                            <span className="flex-shrink-0 font-bold text-amber-900 min-w-[32px] text-right">{(unitPrice * q).toFixed(unitPrice * q % 1 ? 1 : 0)}g</span>
                          </div>
                        );
                      })}
                      <div className="flex justify-end items-center gap-2 pt-1 border-t border-[#362214]/15 mt-1">
                        <span className="text-[10px] opacity-40 uppercase font-bold">购入总计</span>
                        <span className="text-xs font-black text-red-800">{dealSummary.totalCost.toFixed(dealSummary.totalCost % 1 ? 1 : 0)} GP</span>
                      </div>
                    </div>
                  )}
                </div>

                <SpellDivider className="opacity-30 text-amber-900 flex-shrink-0" />

                {/* 折抵清单 */}
                <div className="flex-shrink-0">
                  <div className="text-[10px] font-bold uppercase opacity-50 mb-1 flex justify-between text-[#362214]">
                    <span>折抵项目 ({(finalDiscountRate*100).toFixed(0)}%)</span>
                    {Object.keys(toGive).length > 0 && <span className="cursor-pointer hover:underline text-red-800" onClick={() => setToGive({})}>清空</span>}
                  </div>
                  {Object.keys(toGive).length === 0 ? (
                    <div className="text-[11px] italic opacity-30 text-center py-2 text-[#362214]">点击行囊物品折抵</div>
                  ) : (
                    <div className="space-y-0.5">
                      {Object.entries(toGive).map(([key, q]) => {
                        const { index } = parseEquipmentSelectionKey(key);
                        const item = playerItems[index];
                        if (!item) return null;
                        const libraryItemId = getEquipmentLibraryItemId(item);
                        const detail = libraryItemId != null ? itemDetails[libraryItemId] : undefined;
                        const name = detail ? (detail.name_cn || detail.name) : (item.name || '...');
                        const unitPrice = getBasePriceGp(detail, item.name) * finalDiscountRate;
                        return (
                          <div key={key} className="flex items-center gap-1 text-[11px] text-[#362214] group">
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              <button onClick={() => updateQty(key, -1, 'player')} className="w-4 h-4 flex items-center justify-center text-[10px] font-black opacity-40 hover:opacity-100 hover:text-red-700">－</button>
                              <span className="font-black min-w-[14px] text-center text-[10px] bg-[#362214] text-[#ebd8b7] rounded-sm px-0.5">{q}</span>
                              <button onClick={() => updateQty(key, 1, 'player')} className="w-4 h-4 flex items-center justify-center text-[10px] font-black opacity-40 hover:opacity-100 hover:text-green-700">＋</button>
                            </div>
                            <span className="truncate flex-1 font-bold">{name}</span>
                            <span className="flex-shrink-0 text-[10px] opacity-50">{unitPrice.toFixed(1)}g×{q}</span>
                            <span className="flex-shrink-0 font-bold text-green-800 min-w-[32px] text-right">{(unitPrice * q).toFixed((unitPrice * q) % 1 ? 1 : 0)}g</span>
                          </div>
                        );
                      })}
                      <div className="flex justify-end items-center gap-2 pt-1 border-t border-[#362214]/15 mt-1">
                        <span className="text-[10px] opacity-40 uppercase font-bold">折抵总计</span>
                        <span className="text-xs font-black text-green-800">{dealSummary.totalGain.toFixed(dealSummary.totalGain % 1 ? 1 : 0)} GP</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 结算 */}
                {(Object.keys(toGet).length > 0 || Object.keys(toGive).length > 0) && (
                  <>
                    <SpellDivider className="opacity-30 text-amber-900 flex-shrink-0" />
                    <div className="flex justify-between items-center px-1 flex-shrink-0">
                      <span className="text-[11px] font-bold text-[#362214]/60">应付/找回</span>
                      <span className={`text-sm font-fantasy font-black ${dealSummary.balance > 0 ? 'text-red-800' : 'text-green-800'}`}>
                        {dealSummary.balance > 0 ? '支付 ' : '找回 '}{Math.abs(dealSummary.balance).toFixed(Math.abs(dealSummary.balance) % 1 ? 1 : 0)} GP
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className={`flex-[1.2] flex flex-col min-h-0 overflow-hidden p-5 bg-[#170e09] border border-[#3e2716] rounded shadow-inner relative ${activeTab !== 'backpack' && 'hidden md:flex'}`}>
              <CornerOrnament className="absolute top-1 right-1 -scale-x-100 opacity-20 text-amber-700" />
              <h3 className="text-xs font-bold uppercase mb-4 text-amber-500/70 tracking-widest text-center border-b border-[#3e2716] pb-2 flex-shrink-0">个人行囊</h3>
              <div className="flex-1 min-h-0 grid grid-cols-4 sm:grid-cols-5 xl:grid-cols-6 gap-x-2.5 gap-y-4 overflow-y-auto overscroll-contain pr-2 custom-scrollbar touch-pan-y">
                {playerItems.map((item, idx) => {
                  const selectionKey = getEquipmentSelectionKey(item, idx);
                  return (
                    <ItemSlot
                      key={selectionKey}
                      id={selectionKey}
                      itemId={getEquipmentLibraryItemId(item)}
                      quantity={item.quantity || 1}
                      type="player"
                      isSelected={!!toGive[selectionKey]}
                      fallbackName={item.name}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Mobile Tabs */}
          <div className="flex md:hidden bg-[#0a0604] border-t-2 border-[#3e2716] p-2 gap-1">
            <button onClick={()=>setActiveTab('shop')} className={`flex-1 text-sm font-bold py-2.5 rounded ${activeTab==='shop'?'bg-[#3e2716] text-amber-400':'text-amber-100/50'}`}>货架</button>
            <button onClick={()=>setActiveTab('deal')} className={`flex-1 text-sm font-bold py-2.5 rounded ${activeTab==='deal'?'bg-[#3e2716] text-amber-400':'text-amber-100/50'}`}>契约</button>
            <button onClick={()=>setActiveTab('backpack')} className={`flex-1 text-sm font-bold py-2.5 rounded ${activeTab==='backpack'?'bg-[#3e2716] text-amber-400':'text-amber-100/50'}`}>行囊</button>
          </div>
          {/* Footer */}
          <div className="p-3 md:p-6 bg-gradient-to-t from-[#0a0604] to-[#1a100a] border-t border-[#3e2716] flex flex-col md:flex-row items-center justify-between gap-3 md:gap-6 shadow-2xl z-30">
            <div className="flex items-center gap-6 md:gap-16 w-full md:w-auto justify-between md:justify-start">
              <div className="flex flex-col bg-black/40 px-4 md:px-6 py-2 rounded border border-white/5 shadow-inner">
                <span className="text-[10px] font-bold uppercase opacity-50 tracking-widest mb-1 text-amber-100">持有金钱</span>
                <div className="text-lg">{formatCurrency(wallet.gp + wallet.sp/10 + wallet.cp/100)}</div>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase opacity-50 tracking-widest mb-1 text-amber-100">交易结余</span>
                <div className="text-xl md:text-2xl font-fantasy font-bold drop-shadow-md">
                  {dealSummary.balance > 0 ? <span className="text-red-500">支付 </span> : <span className="text-green-500">找回 </span>}
                  {formatCurrency(Math.abs(dealSummary.balance))}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 w-full md:w-auto">
              <div className="hidden md:block text-[10px] font-bold text-amber-500/40 uppercase tracking-widest">负重变动: <span className="text-amber-100/80">{dealSummary.weight > 0 ? '+' : ''}{dealSummary.weight.toFixed(1)} LB</span></div>
              {errMsg && <div className="text-red-500 text-xs font-bold mb-1">{errMsg}</div>}
              <button className={`w-full md:w-auto px-12 py-3 md:py-4 bg-gradient-to-b from-amber-600 to-amber-800 text-[#1a100a] font-fantasy font-bold uppercase tracking-[0.4em] rounded shadow-xl hover:brightness-125 transition-all disabled:opacity-30 text-sm md:text-base border border-amber-400/50`} disabled={busy || (Object.keys(toGet).length === 0 && Object.keys(toGive).length === 0)} onClick={handleCheckout}>{busy ? '处理中...' : '签署协议'}</button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      {/* Detail Dialog */}
      <Dialog.Root open={detailOpen} onOpenChange={setDetailOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200]" />
          <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-xl bg-[#f4e4bc] text-[#3d2b1f] border-4 border-[#3d2b1f] rounded-lg p-0 z-[201] font-serif shadow-2xl overflow-hidden">
            {selectedDetail && (
              <div className="flex flex-col max-h-[85dvh]">
                <div className={`p-6 border-b-2 border-amber-900/20 relative overflow-hidden bg-gradient-to-br from-white/20 to-transparent`}>
                  <div className="flex justify-between items-start relative z-10">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase text-white bg-amber-900/80`}>{RARITY_CN[selectedDetail.rarity?.toLowerCase() || 'common'] || selectedDetail.rarity}</span>
                        <span className="text-xs opacity-60 font-bold uppercase tracking-widest">{CATEGORY_CN[selectedDetail.category || ''] || selectedDetail.category}</span>
                      </div>
                      <Dialog.Title className="text-3xl font-fantasy font-bold text-amber-950 leading-tight">{selectedDetail.name_cn || selectedDetail.name}</Dialog.Title>
                      {selectedDetail.name_cn && selectedDetail.name && <div className="text-xs italic opacity-40 font-bold">{selectedDetail.name}</div>}
                    </div>
                    <Dialog.Close className="w-8 h-8 flex items-center justify-center hover:bg-black/5 rounded-full transition-colors text-2xl font-sans">✕</Dialog.Close>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto spellbook-scroll p-6 space-y-6">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <ItemPropertyTag label="重量" value={`${selectedDetail.weight || 0} LB`} />
                    <ItemPropertyTag label="基础价值" value={`${getBasePriceGp(selectedDetail)} GP`} />
                    {selectedDetail.damage && <ItemPropertyTag label="伤害" value={<div className="flex items-center gap-1"><span>{selectedDetail.damage.dice}</span><span className="opacity-50 text-[10px]">{DAMAGE_TYPE_CN[selectedDetail.damage.type] || selectedDetail.damage.type}</span></div>} />}
                    {selectedDetail.armor_class && <ItemPropertyTag label="AC" value={selectedDetail.armor_class.base + (selectedDetail.armor_class.dex_bonus ? ` + Dex(max ${selectedDetail.armor_class.max_dex_bonus || '∞'})` : '')} />}
                    {selectedDetail.magic_bonus && <ItemPropertyTag label="增强" value={`+${selectedDetail.magic_bonus}`} />}
                  </div>
                  {(selectedDetail.properties?.length || selectedDetail.requires_attunement) && (
                    <div className="flex flex-wrap gap-2">
                      {selectedDetail.requires_attunement && <span className="px-2 py-1 bg-purple-900/10 border border-purple-900/20 text-purple-900 text-[10px] font-black uppercase rounded-sm">需要同调</span>}
                      {selectedDetail.properties?.map((p: string) => <span key={p} className="px-2 py-1 bg-amber-900/10 border border-amber-900/20 text-amber-900 text-[10px] font-black uppercase rounded-sm">{PROPERTY_CN[p.toLowerCase()] || p}</span>)}
                    </div>
                  )}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2"><div className="h-[1px] flex-1 bg-amber-900/10" /><span className="text-[10px] font-black uppercase opacity-30 tracking-[0.2em]">物品描述</span><div className="h-[1px] flex-1 bg-amber-900/10" /></div>
                    <div className="text-sm leading-relaxed text-amber-950/80 italic space-y-4">{generateItemDescription(selectedDetail).split('\n').map((line, i) => <p key={i}>{line}</p>)}</div>
                  </div>
                  {selectedDetail.abilities && selectedDetail.abilities.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2"><div className="h-[1px] flex-1 bg-amber-900/10" /><span className="text-[10px] font-black uppercase opacity-30 tracking-[0.2em]">特殊能力</span><div className="h-[1px] flex-1 bg-amber-900/10" /></div>
                      <div className="space-y-4">{selectedDetail.abilities.map((abi: any, i: number) => <div key={i} className="bg-white/30 border border-amber-900/5 rounded p-3"><div className="flex justify-between items-center mb-1"><span className="font-bold text-amber-900 text-sm">{abi.name_cn || abi.name}</span><span className="text-[9px] uppercase opacity-40 font-black">{abi.type}</span></div><p className="text-xs opacity-70 leading-normal">{abi.description}</p></div>)}</div>
                    </div>
                  )}
                </div>
                <div className="p-4 bg-amber-900/5 border-t border-amber-900/10 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded border border-amber-900/20 bg-white/50 flex items-center justify-center p-1 overflow-hidden shadow-inner"><img src={getItemIcon(selectedDetail)} className="w-full h-full object-contain" alt="" /></div>
                    <span className="text-[9px] font-bold opacity-30 uppercase tracking-tighter max-w-[120px] truncate">{selectedDetail.source_module || '通用资源库'}</span>
                  </div>
                  <div className="text-right"><div className="text-[9px] opacity-30 uppercase font-black">ID: {selectedDetail.id}</div></div>
                </div>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Dialog.Root>
  );
};
