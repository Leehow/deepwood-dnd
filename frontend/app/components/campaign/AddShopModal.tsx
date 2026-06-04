import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, Flex, Text, Button, ScrollArea } from '@radix-ui/themes';
import { showGlobalToast } from "../ui/Toast";
import { apiFetch } from '~/utils/api-client';
import { createLogger } from '~/utils/logger';
import { resolveTokenItemImageUrl, serializeItemToTokenData } from '~/utils/itemTokenData';

const logger = createLogger('AddShopModal');
const BASE_PATH = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL.replace(/\/$/, '') : '';

interface InventoryRef {
  source: 'equipment' | 'magic-items';
  sourcePath?: string;
  sourceId: string;
  quantity: number;
  priceGp?: number;
  nameOverride?: string;
  nameEnOverride?: string;
}

interface ShopTemplate {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  appearanceDescription: string;
  avatarUrl?: string;
  avatarUrlLarge?: string;
  goldGp: number;
  discountRate: number;
  acceptsSelling: boolean;
  inventory: InventoryRef[];
}

// Resolved item for display (rich detail)
interface ResolvedDisplayItem {
  name: string;
  nameEn: string;
  priceGp: number;
  quantity: number;
  found: boolean;
  source: 'equipment' | 'magic-items';
  // Detail fields
  weight?: number;
  costCopper?: number;
  damage?: { dice: string; type: string };
  versatileDamage?: string;
  range?: { normal: number; long: number };
  properties?: string[];
  ac?: string;
  acFormula?: { base: number; dexModifier: string };
  strengthRequired?: number;
  stealthDisadvantage?: boolean;
  description?: string;
  rarity?: string;
  rarityCn?: string;
  category?: string;
  categoryCn?: string;
  requiresAttunement?: boolean;
}

// Resolved item for API submission
interface ResolvedApiItem {
  name: string;
  name_cn: string;
  category: string;
  subcategory?: string;
  cost?: Record<string, number>;
  weight?: number;
  damage?: Record<string, string>;
  properties?: string[];
  range?: { normal: number; long: number };
  armor_class?: { base: number; dex_bonus: boolean; max_dex_bonus: number | null };
  strength_requirement?: number;
  stealth_disadvantage?: boolean;
  description?: string;
  description_cn?: string;
  rarity: string;
  requires_attunement: boolean;
  abilities?: Array<{ name: string; description: string }>;
  avatar_url?: string;
  quantity: number;
  price_gp: number;
}

interface AddShopModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  onShopAdded: () => void;
}

const DAMAGE_TYPE_CN: Record<string, string> = {
  slashing: '挥砍', piercing: '穿刺', bludgeoning: '钝击',
  fire: '火焰', cold: '冰冷', lightning: '闪电', thunder: '雷鸣',
  acid: '强酸', poison: '毒素', necrotic: '黯蚀', radiant: '光耀',
  force: '力场', psychic: '心灵',
};

const PROPERTY_CN: Record<string, string> = {
  ammunition: '弹药', finesse: '灵巧', heavy: '沉重', light: '轻型',
  loading: '装填', reach: '长柄', special: '特殊', thrown: '投掷',
  'two-handed': '双手', versatile: '多用',
};

const RARITY_COLORS: Record<string, string> = {
  Common: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  Uncommon: 'bg-green-500/20 text-green-400 border-green-500/30',
  Rare: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Very Rare': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  Legendary: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

const styles = {
  modalContent: {
    background: 'linear-gradient(180deg, #1a1d24 0%, #13151a 100%)',
    border: '1px solid rgba(212, 175, 55, 0.15)',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
    width: 'min(900px, calc(100vw - 16px))',
    maxWidth: '900px',
    maxHeight: '90dvh',
    padding: 0,
    overflow: 'hidden',
  },
  header: {
    background: 'linear-gradient(180deg, rgba(212, 175, 55, 0.08) 0%, transparent 100%)',
    borderBottom: '1px solid rgba(212, 175, 55, 0.1)',
    padding: '12px 16px',
  },
  shopCard: {
    background: 'linear-gradient(135deg, rgba(30, 34, 42, 0.9) 0%, rgba(22, 25, 31, 0.95) 100%)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '8px',
    overflow: 'hidden',
    transition: 'all 0.2s ease',
  },
  shopCardExpanded: {
    border: '1px solid rgba(212, 175, 55, 0.3)',
    boxShadow: '0 4px 20px rgba(212, 175, 55, 0.1)',
  },
} as const;

function getByPath(obj: any, path: string): any[] | null {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return null;
    cur = cur[p];
  }
  return Array.isArray(cur) ? cur : null;
}

function inferCategory(sourcePath: string): { category: string; subcategory: string } {
  if (sourcePath.startsWith('weapons.simple.melee')) return { category: 'weapon', subcategory: 'simple_melee' };
  if (sourcePath.startsWith('weapons.simple.ranged')) return { category: 'weapon', subcategory: 'simple_ranged' };
  if (sourcePath.startsWith('weapons.martial.melee')) return { category: 'weapon', subcategory: 'martial_melee' };
  if (sourcePath.startsWith('weapons.martial.ranged')) return { category: 'weapon', subcategory: 'martial_ranged' };
  if (sourcePath.startsWith('armor.light')) return { category: 'armor', subcategory: 'light' };
  if (sourcePath.startsWith('armor.medium')) return { category: 'armor', subcategory: 'medium' };
  if (sourcePath.startsWith('armor.heavy')) return { category: 'armor', subcategory: 'heavy' };
  if (sourcePath.startsWith('armor.shield')) return { category: 'armor', subcategory: 'shield' };
  if (sourcePath.startsWith('adventuringGear')) return { category: 'adventuring_gear', subcategory: sourcePath.split('.')[1] || '' };
  return { category: 'misc', subcategory: '' };
}

/* ---- Item Detail Popup (nested Radix Dialog) ---- */
function ItemDetailPopup({ item, onClose }: { item: ResolvedDisplayItem; onClose: () => void }) {
  const formatCost = (cp?: number) => {
    if (cp == null) return null;
    const gp = Math.floor(cp / 100);
    const sp = Math.floor((cp % 100) / 10);
    const rcp = cp % 10;
    const parts: string[] = [];
    if (gp) parts.push(`${gp} gp`);
    if (sp) parts.push(`${sp} sp`);
    if (rcp || parts.length === 0) parts.push(`${rcp} cp`);
    return parts.join(' ');
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content
        aria-describedby={undefined}
        style={{
          background: 'linear-gradient(180deg, #1a1d24 0%, #13151a 100%)',
          border: '1px solid rgba(100, 100, 120, 0.4)',
          maxWidth: '380px', width: '90vw', padding: '16px',
        }}
      >
        <Dialog.Title className="m-0 mb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-gray-100 truncate m-0">{item.name}</h3>
              {item.nameEn && <p className="text-xs text-gray-500 mt-0.5">{item.nameEn}</p>}
            </div>
          </div>
        </Dialog.Title>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {item.rarity && item.rarity !== 'common' && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${RARITY_COLORS[item.rarity] || 'bg-gray-700/50 text-gray-300'}`}>
              {item.rarityCn || item.rarity}
            </span>
          )}
          {item.categoryCn && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-700/50 text-gray-400">
              {item.categoryCn}
            </span>
          )}
          {item.requiresAttunement && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-500/20 text-violet-400 border border-violet-500/30">
              需要调谐
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="space-y-2 mb-3">
          {(item.costCopper != null || item.weight != null || item.priceGp > 0) && (
            <div className="flex items-center gap-4 text-sm text-gray-400">
              {item.priceGp > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-amber-400">💰</span>
                  <span>{item.priceGp} gp</span>
                </div>
              )}
              {item.costCopper != null && item.costCopper > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-amber-400">$</span>
                  <span>{formatCost(item.costCopper)}</span>
                </div>
              )}
              {item.weight != null && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">⚖</span>
                  <span>{item.weight} lb</span>
                </div>
              )}
            </div>
          )}
          {item.damage && (
            <div className="flex flex-wrap gap-3 text-sm text-gray-400">
              <span>伤害：<span className="text-red-400">{item.damage.dice}</span></span>
              <span>类型：{DAMAGE_TYPE_CN[item.damage.type] || item.damage.type}</span>
              {item.versatileDamage && <span>双手：<span className="text-red-400">{item.versatileDamage}</span></span>}
            </div>
          )}
          {item.range && (
            <div className="text-sm text-gray-400">
              {item.properties?.some((p: string) => p === 'thrown' || p.includes('投掷')) ? '投掷射程' : '射程'}：<span className="text-blue-400">{item.range.normal}/{item.range.long} ft</span>
            </div>
          )}
          {(item.ac || item.acFormula) && (
            <div className="flex flex-wrap gap-3 text-sm text-gray-400">
              {item.ac && <span>AC：<span className="text-blue-400">{item.ac}</span></span>}
              {item.acFormula && (
                <span>
                  {item.acFormula.base}
                  {item.acFormula.dexModifier === 'full' ? ' + DEX' : item.acFormula.dexModifier === 'max2' ? ' + DEX(≤+2)' : ''}
                </span>
              )}
              {item.strengthRequired && <span>力量要求：{item.strengthRequired}</span>}
              {item.stealthDisadvantage && <span className="text-red-400">潜行劣势</span>}
            </div>
          )}
          {item.properties && item.properties.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.properties.map((p: string) => (
                <span key={p} className="px-1.5 py-0.5 bg-gray-700/60 rounded text-xs text-gray-400">
                  {PROPERTY_CN[p] || p}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Description */}
        {item.description && (
          <div className="p-2.5 bg-gray-800/40 border border-gray-700/50 rounded-lg mb-3">
            <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">{item.description}</p>
          </div>
        )}

        {!item.description && !item.damage && !item.ac && !item.properties?.length && (
          <p className="text-sm text-gray-500 text-center py-2">暂无物品详情</p>
        )}

        <Flex justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" size="1"><span>关闭</span></Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/* ---- Main Component ---- */
export function AddShopModal({ open, onOpenChange, campaignId, onShopAdded }: AddShopModalProps) {
  const [templates, setTemplates] = useState<ShopTemplate[]>([]);
  const [equipmentData, setEquipmentData] = useState<any>(null);
  const [magicItemsData, setMagicItemsData] = useState<any[]>([]);
  const [expandedShop, setExpandedShop] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<ResolvedDisplayItem | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    showGlobalToast({ message, type });
  };

  useEffect(() => {
    if (open) loadData();
  }, [open]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [tplData, eqData, miData] = await Promise.all([
        import('~/data/rules/shop-templates.json').then(m => m.default),
        import('~/data/rules/equipment.json').then(m => m.default),
        import('~/data/rules/magic-items.json').then(m => m.default),
      ]);
      setTemplates((tplData.templates || []) as ShopTemplate[]);
      setEquipmentData(eqData);
      setMagicItemsData(miData.items || []);
    } catch (e) {
      logger.error('[AddShopModal] load data error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Resolve inventory reference → rich display item
  const resolveItem = (ref: InventoryRef): ResolvedDisplayItem => {
    if (ref.source === 'equipment' && ref.sourcePath && equipmentData) {
      const arr = getByPath(equipmentData, ref.sourcePath);
      const item = arr?.find((i: any) => i.id === ref.sourceId);
      if (item) {
        const priceGp = ref.priceGp ?? (item.costCopper ? item.costCopper / 100 : (item.cost?.gp || 0));
        return {
          name: ref.nameOverride || item.name, nameEn: ref.nameEnOverride || item.nameEn || '', priceGp, quantity: ref.quantity, found: true,
          source: 'equipment',
          weight: item.weight, costCopper: item.costCopper,
          damage: item.damage ? { dice: item.damage, type: item.damageType || '' } : undefined,
          versatileDamage: item.versatileDamage,
          range: item.range,
          properties: item.properties,
          ac: item.ac, acFormula: item.acFormula,
          strengthRequired: item.strengthRequired, stealthDisadvantage: item.stealthDisadvantage,
          description: item.description,
        };
      }
    }
    if (ref.source === 'magic-items') {
      const item = magicItemsData.find((i: any) => i.id === ref.sourceId);
      if (item) {
        return {
          name: item.name, nameEn: item.nameEn || '', priceGp: ref.priceGp || 0, quantity: ref.quantity, found: true,
          source: 'magic-items',
          description: item.description,
          rarity: item.rarity, rarityCn: item.rarityCn,
          category: item.category, categoryCn: item.categoryCn,
          requiresAttunement: item.requiresAttunement,
        };
      }
    }
    return { name: ref.sourceId, nameEn: '', priceGp: ref.priceGp || 0, quantity: ref.quantity, found: false, source: ref.source };
  };

  // Resolve all items for API submission
  const resolveAllItems = (template: ShopTemplate): ResolvedApiItem[] => {
    const items: ResolvedApiItem[] = [];
    for (const ref of template.inventory) {
      if (ref.source === 'equipment' && ref.sourcePath && equipmentData) {
        const arr = getByPath(equipmentData, ref.sourcePath);
        const item = arr?.find((i: any) => i.id === ref.sourceId);
        if (!item) continue;
        const { category, subcategory } = inferCategory(ref.sourcePath);
        const priceGp = ref.priceGp ?? (item.costCopper ? item.costCopper / 100 : (item.cost?.gp || 0));
        const canonicalItem = serializeItemToTokenData(item);
        let armorClass: any = undefined;
        if (canonicalItem.armor_class && typeof canonicalItem.armor_class === 'object' && canonicalItem.armor_class.base !== undefined) {
          armorClass = canonicalItem.armor_class;
        } else if ((typeof canonicalItem.armor_class === 'number' || typeof canonicalItem.armor_class === 'string') && Number.isFinite(Number(canonicalItem.armor_class))) {
          armorClass = { base: Number(canonicalItem.armor_class), dex_bonus: false, max_dex_bonus: null };
        } else if (item.acFormula && typeof item.acFormula === 'object' && item.acFormula.base !== undefined) {
          armorClass = { base: item.acFormula.base, dex_bonus: item.acFormula.dexModifier === 'full' || item.acFormula.dexModifier === 'max2', max_dex_bonus: item.acFormula.dexModifier === 'max2' ? 2 : null };
        }
        const damage = (() => {
          if (!canonicalItem.damage) return undefined;
          if (typeof canonicalItem.damage === 'string') {
            return canonicalItem.damageType ? { dice: canonicalItem.damage, type: canonicalItem.damageType } : undefined;
          }
          const dice = canonicalItem.damage.dice || canonicalItem.damage.formula;
          const type = canonicalItem.damageType || canonicalItem.damage.type;
          return dice && type ? { dice, type } : undefined;
        })();
        const resolvedAvatarUrl = resolveTokenItemImageUrl(canonicalItem);
        items.push({
          name: ref.nameEnOverride || item.nameEn || item.name, name_cn: ref.nameOverride || item.name, category, subcategory,
          cost: item.cost, weight: canonicalItem.weight ?? item.weight,
          damage,
          properties: canonicalItem.properties || item.properties,
          range: canonicalItem.range ?? item.range,
          armor_class: armorClass,
          strength_requirement: item.strengthRequired,
          stealth_disadvantage: item.stealthDisadvantage || false,
          description: item.description,
          rarity: 'common', requires_attunement: false,
          avatar_url: resolvedAvatarUrl || undefined,
          quantity: ref.quantity, price_gp: priceGp,
        });
      } else if (ref.source === 'magic-items') {
        const item = magicItemsData.find((i: any) => i.id === ref.sourceId);
        if (!item) continue;
        // Map stats to Item model fields
        const stats = item.stats || {};
        const consumable = item.consumable || {};
        let damage: any = undefined;
        if (stats.healing || consumable.healing) {
          const formula = consumable.healing?.formula || stats.healing;
          damage = formula ? { dice: formula, type: 'healing' } : undefined;
        } else if (stats.damage) {
          const parts = String(stats.damage).split(' ');
          damage = { dice: parts[0], type: parts[1] || '' };
        }
        // Build abilities from effects, duration, save_dc
        const abilities: Array<{ name: string; description: string }> = [];
        if (stats.duration) abilities.push({ name: '持续时间', description: stats.duration });
        if (stats.save_dc) abilities.push({ name: '豁免DC', description: String(stats.save_dc) });
        if (stats.effects?.length) abilities.push({ name: '效果', description: stats.effects.join('、') });
        if (consumable.action) abilities.push({ name: '使用动作', description: consumable.action === 'action' ? '一个动作' : consumable.action === 'bonus' ? '附赠动作' : consumable.action });

        items.push({
          name: item.nameEn || item.name, name_cn: item.name,
          category: (item.category || 'wondrous_item').toLowerCase().replace(/\s+/g, '_'),
          description: item.descriptionEn, description_cn: item.description,
          rarity: (item.rarity || 'uncommon').toLowerCase().replace(/\s+/g, '_'),
          requires_attunement: item.requiresAttunement || false,
          damage,
          abilities: abilities.length > 0 ? abilities : undefined,
          quantity: ref.quantity, price_gp: ref.priceGp || 0,
        });
      }
    }
    return items;
  };

  const handleAddShop = async (template: ShopTemplate) => {
    setAddingId(template.id);
    try {
      const items = resolveAllItems(template);
      if (items.length === 0) { showToast('无法解析物品数据', 'error'); return; }
      logger.info('[AddShopModal] creating shop', { name: template.name, avatarUrl: template.avatarUrl, itemCount: items.length });
      console.warn('[AddShopModal] DEBUG avatar_url:', template.avatarUrl, 'avatar_url_large:', template.avatarUrlLarge);
      const resp = await apiFetch('/api/shops/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId),
          name: template.name, description: template.description,
          appearance_description: template.appearanceDescription,
          gold_gp: template.goldGp, accepts_selling: template.acceptsSelling,
          discount_rate: template.discountRate,
          avatar_url: template.avatarUrl, avatar_url_large: template.avatarUrlLarge,
          items,
        }),
      });
      if (resp.ok) {
        showToast(`${template.name} 已添加到战役`, 'success');
        onShopAdded();
        onOpenChange(false);
      } else {
        const err = await resp.json().catch(() => ({}));
        showToast('创建失败: ' + (err.detail || '未知错误'), 'error');
      }
    } catch (e) {
      logger.error('[AddShopModal] create error:', e);
      showToast('创建失败', 'error');
    } finally {
      setAddingId(null);
    }
  };

  const resolvedInventories = useMemo(() => {
    if (!equipmentData || magicItemsData.length === 0) return {};
    const map: Record<string, ResolvedDisplayItem[]> = {};
    for (const t of templates) {
      map[t.id] = t.inventory.map(resolveItem);
    }
    return map;
  }, [templates, equipmentData, magicItemsData]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        aria-describedby={undefined}
        style={styles.modalContent}
        onInteractOutside={(e) => { if (detailItem) e.preventDefault(); }}
      >
        {/* Header */}
        <div style={styles.header}>
          <div className="flex items-center justify-between">
            <Dialog.Title className="m-0">
              <div className="flex items-center gap-2">
                <span className="text-xl sm:text-2xl">🏪</span>
                <div>
                  <h2 className="text-base sm:text-xl font-bold text-white m-0" style={{ fontFamily: 'Georgia, serif' }}>
                    预设商店模板
                  </h2>
                  <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5 hidden sm:block">选择一个预设商店模板，一键添加到战役</p>
                </div>
              </div>
            </Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              <span>✕</span>
            </Dialog.Close>
          </div>
        </div>

        {/* Shop List */}
        <ScrollArea style={{ height: 'calc(90dvh - 120px)' }}>
          <div className="p-3 space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <div className="animate-spin text-4xl mb-3">🏪</div>
                  <Text size="2" color="gray"><span>正在加载商店模板...</span></Text>
                </div>
              </div>
            ) : templates.length > 0 ? (
              templates.map(template => {
                const isExpanded = expandedShop === template.id;
                const isAdding = addingId === template.id;
                const resolved = resolvedInventories[template.id] || [];
                const itemCount = resolved.reduce((s, r) => s + r.quantity, 0);

                return (
                  <div key={template.id} style={{ ...styles.shopCard, ...(isExpanded ? styles.shopCardExpanded : {}) }}>
                    {/* Card Header */}
                    <div
                      className="p-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                      onClick={() => setExpandedShop(isExpanded ? null : template.id)}
                    >
                      <div className="flex justify-between items-start gap-2 sm:gap-4">
                        {/* Avatar */}
                        {template.avatarUrl && (
                          <div className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden border border-gray-600/50 bg-gray-700/50">
                            <img src={template.avatarUrl} alt={template.name} className="w-full h-full object-cover" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1 sm:gap-2 mb-1 sm:mb-2">
                            <h3 className="text-sm sm:text-lg font-bold text-white truncate">{template.name}</h3>
                            <span className="text-xs sm:text-sm text-gray-500 truncate hidden sm:inline">({template.nameEn})</span>
                            <span className={`ml-auto text-gray-500 transition-transform text-xs ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                          </div>
                          <div className="flex flex-wrap gap-1 sm:gap-2 mb-1.5">
                            <span className="px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                              💰 {template.goldGp}gp
                            </span>
                            <span className="px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                              📦 {resolved.length}种 / {itemCount}件
                            </span>
                            <span className="px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30">
                              {(template.discountRate * 100).toFixed(0)}%回收
                            </span>
                            {template.acceptsSelling && (
                              <span className="px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                                可回收
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{template.description}</p>
                        </div>
                        <div className="shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleAddShop(template); }}
                            disabled={isAdding}
                            className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                              isAdding
                                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-amber-600 to-amber-700 text-white hover:from-amber-500 hover:to-amber-600 shadow-lg shadow-amber-900/30'
                            }`}
                          >
                            {isAdding ? '...' : '添加'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded: Inventory List */}
                    {isExpanded && (
                      <div className="border-t border-gray-700/50 bg-black/20">
                        <div className="p-3">
                          <h4 className="text-xs text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span>📋</span> 库存清单 <span className="text-gray-600 normal-case">（点击查看详情）</span>
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                            {resolved.map((item, idx) => (
                              <div
                                key={idx}
                                className={`flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                                  item.found
                                    ? 'bg-gray-800/50 hover:bg-gray-700/60'
                                    : 'bg-red-900/20'
                                }`}
                                onClick={(e) => { e.stopPropagation(); if (item.found) setDetailItem(item); }}
                              >
                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                  <span className="text-gray-500 w-5 text-right flex-shrink-0">x{item.quantity}</span>
                                  <span className={`truncate ${item.found ? 'text-gray-200 hover:text-amber-300' : 'text-red-400'}`}>
                                    {item.name}
                                  </span>
                                  {/* Inline mini badges */}
                                  {item.damage && <span className="text-red-400/70 flex-shrink-0">{item.damage.dice}</span>}
                                  {item.ac && <span className="text-blue-400/70 flex-shrink-0">AC{typeof item.ac === 'string' ? '' : item.ac}</span>}
                                  {item.rarity && item.rarity !== 'Common' && item.source === 'magic-items' && (
                                    <span className={`px-1 py-0 rounded text-[9px] flex-shrink-0 border ${RARITY_COLORS[item.rarity] || ''}`}>
                                      {item.rarityCn || item.rarity}
                                    </span>
                                  )}
                                </div>
                                <span className="text-yellow-400 flex-shrink-0 ml-2">
                                  {item.priceGp > 0 ? `${item.priceGp}gp` : '-'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="flex items-center justify-center py-20">
                <Text size="2" color="gray"><span>暂无商店模板数据</span></Text>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="p-3 border-t border-gray-800 bg-gray-900/50">
          <Flex justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray" className="px-6"><span>关闭</span></Button>
            </Dialog.Close>
          </Flex>
        </div>
      </Dialog.Content>

      {/* Item Detail Popup (nested Radix Dialog) */}
      {detailItem && (
        <ItemDetailPopup item={detailItem} onClose={() => setDetailItem(null)} />
      )}
    </Dialog.Root>
  );
}
