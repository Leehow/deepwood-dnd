import React, { useState, useEffect } from 'react';
import { Dialog, Button, TextField, Flex, Text, Box, Badge, ScrollArea } from '@radix-ui/themes';
import * as Tabs from '@radix-ui/react-tabs';

import { showGlobalToast } from "../ui/Toast";
import { apiFetch } from '~/utils/api-client';
import { createLogger } from '~/utils/logger';
import { getAssetUrl } from '~/utils/asset-url';
import { tDamageType, tWeaponProperty } from '~/utils/i18n';
import type { EquipmentItem as CharacterEquipmentItem } from '~/components/character/CharacterDisplay/types/Character';
import { convertTokenItemToEquipment, resolveTokenItemImageUrl, serializeItemToTokenData } from '~/utils/itemTokenData';

const logger = createLogger('AddItemModal');


// Equipment data structure from equipment.json
interface EquipmentItem {
  id: string;
  name: string;
  nameEn: string;
  iconPath?: string;
  cost?: any;
  costCopper?: number;
  weight?: number;
  damage?: string;
  damageType?: string;
  versatileDamage?: string;
  ac?: string;
  acFormula?: any;
  type?: string;
  properties?: string[];
  range?: any;
  strengthRequired?: number | null;
  stealthDisadvantage?: boolean;
  description?: string;
  // Magic item fields
  rarity?: string;
  rarityCn?: string;
  category?: string;
  categoryCn?: string;
  requiresAttunement?: boolean;
  // Computed fields for weapon classification
  weaponGroup?: 'simple' | 'martial';
  weaponType?: 'melee' | 'ranged';
}

interface AddItemModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  onItemAdded: () => void;
  /** When provided, bypass API and directly return selected item data to caller */
  onDirectAdd?: (item: CharacterEquipmentItem) => void;
}

export function AddItemModal({ open, onOpenChange, campaignId, onItemAdded, onDirectAdd }: AddItemModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'weapons' | 'armor' | 'gear' | 'tools' | 'packs' | 'magic'>('weapons');
  const [equipmentData, setEquipmentData] = useState<any>(null);
  const [magicItemsData, setMagicItemsData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<EquipmentItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [detailItem, setDetailItem] = useState<EquipmentItem | null>(null);

  // Toast state for this modal
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    showGlobalToast({ message, type });
  };

  // Load equipment data
  useEffect(() => {
    const loadEquipment = async () => {
      try {
        // Load equipment data
        const eqModule = await import('~/data/rules/equipment.json');
        setEquipmentData(eqModule.default);

        // Load magic items data
        const magicModule = await import('~/data/rules/magic-items.json');
        const magicData = magicModule.default;
        setMagicItemsData(magicData);
        logger.debug('[AddItemModal] Loaded magic items data:', magicData);
      } catch (error) {
        logger.error('[AddItemModal] Failed to load equipment data:', error);
      }
    };

    if (open) {
      loadEquipment();
    }
  }, [open]);

  // Reset modal state when opened
  useEffect(() => {
    if (open) {
      setSearchQuery('');
      setSelectedItem(null);
      setQuantity(1);
      setActiveCategory('weapons');
    }
  }, [open]);


  // Get all items from current category
  const getAllItems = (): EquipmentItem[] => {
    if (activeCategory === 'magic') {
      // Return magic items
      if (!magicItemsData?.items) return [];
      return magicItemsData.items.map((item: any) => ({
        ...item,
        name: item.name,
        nameEn: item.nameEn,
        type: item.categoryCn,
      }));
    }

    if (!equipmentData) return [];

    let items: EquipmentItem[] = [];

    if (activeCategory === 'weapons') {
      // Combine all weapon types, tagging each with group/type
      const simple = equipmentData.weapons?.simple || {};
      const martial = equipmentData.weapons?.martial || {};
      const tag = (arr: any[], group: 'simple' | 'martial', type: 'melee' | 'ranged') =>
        (arr || []).map((w: any) => ({ ...w, weaponGroup: group, weaponType: type }));

      items = [
        ...tag(simple.melee, 'simple', 'melee'),
        ...tag(simple.ranged, 'simple', 'ranged'),
        ...tag(martial.melee, 'martial', 'melee'),
        ...tag(martial.ranged, 'martial', 'ranged'),
      ];
    } else if (activeCategory === 'armor') {
      // Combine all armor types
      items = [
        ...(equipmentData.armor?.light || []),
        ...(equipmentData.armor?.medium || []),
        ...(equipmentData.armor?.heavy || []),
        ...(equipmentData.armor?.shields || []),
      ];
    } else if (activeCategory === 'gear') {
      // Combine all adventuring gear sub-categories
      const gear = equipmentData.adventuringGear || {};
      const subKeys = Object.keys(gear);
      for (const key of subKeys) {
        if (Array.isArray(gear[key])) {
          items.push(...gear[key]);
        }
      }
    } else if (activeCategory === 'tools') {
      // All tools (artisan tools, specialized tools, gaming sets, instruments)
      const tools = equipmentData.tools || {};
      items = [
        ...(tools.artisansTools || []),
        ...(tools.specializedTools || []),
        ...(tools.gamingSets || []),
        ...(tools.musicalInstruments || []),
      ];
    } else if (activeCategory === 'packs') {
      // Equipment packs (Explorer's Pack, Dungeoneer's Pack, etc.)
      items = (equipmentData.packs || []).map((pack: any) => ({
        ...pack,
        type: '装备套装',
      }));
    }

    return items;
  };

  // Filter items by search query
  const filteredItems = getAllItems().filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.nameEn.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.type && item.type.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Format cost from object { gp: 5 } or { sp: 10 } etc.
  const formatCostObj = (cost: any) => {
    if (!cost) return null;
    if (typeof cost === 'string') return cost;
    return Object.entries(cost).map(([unit, value]) => `${value} ${unit}`).join(', ');
  };

  // Format range
  const formatRange = (r: any) => {
    if (!r) return null;
    if (typeof r === 'string') return r;
    if (typeof r.normal === 'number') return `${r.normal}/${r.long ?? r.normal} ft`;
    return null;
  };

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

    if (!fallbackFormula) return null;

    if (typeof fallbackFormula === 'object' && fallbackFormula.base !== undefined) {
      return {
        base: fallbackFormula.base,
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

    return null;
  };

  // Add item to campaign
  const handleAddItem = async () => {
    if (!selectedItem) return;
    const canonicalItem = serializeItemToTokenData(selectedItem as any);
    const resolvedAvatarUrl = resolveTokenItemImageUrl(canonicalItem);

    // Direct-add mode: bypass API, return item data to caller
    if (onDirectAdd) {
      onDirectAdd(convertTokenItemToEquipment(canonicalItem, quantity));
      setSelectedItem(null);
      setQuantity(1);
      showToast(`已添加 ${selectedItem.name}`, 'success');
      return;
    }

    setIsLoading(true);
    try {
      // Determine rarity - use magic item rarity or default to common
      const rarityMapping: Record<string, string> = {
        'Common': 'common',
        'Uncommon': 'uncommon',
        'Rare': 'rare',
        'Very Rare': 'very_rare',
        'Legendary': 'legendary',
        'Artifact': 'artifact',
        'Varies': 'varies',
      };
      const itemRarity = selectedItem.rarity
        ? (rarityMapping[selectedItem.rarity] || selectedItem.rarity.toLowerCase().replace(' ', '_'))
        : 'common';

      // Prepare item data for backend
      const itemData = {
        campaign_id: parseInt(campaignId),
        name: selectedItem.nameEn || selectedItem.name,
        name_cn: selectedItem.name,
        category: canonicalItem.category || (activeCategory === 'packs' ? 'gear' : activeCategory === 'weapons' ? 'weapon' : activeCategory === 'tools' ? 'tool' : activeCategory),
        subcategory: selectedItem.type || selectedItem.categoryCn,
        cost: selectedItem.cost,
        weight: canonicalItem.weight ?? selectedItem.weight,
        rarity: itemRarity,
        damage: buildDamageObject(canonicalItem.damage, canonicalItem.damageType) || null,
        properties: canonicalItem.properties || selectedItem.properties || [],
        range: canonicalItem.range ?? selectedItem.range,
        armor_class: buildArmorClassObject(canonicalItem.armor_class, selectedItem.acFormula),
        strength_requirement: selectedItem.strengthRequired,
        stealth_disadvantage: selectedItem.stealthDisadvantage || false,
        description: selectedItem.description || '',
        description_cn: selectedItem.description || '',
        quantity: quantity,
        notes: '',
        requires_attunement: selectedItem.requiresAttunement || false,
        avatar_url: resolvedAvatarUrl || null,
        has_avatar: !!resolvedAvatarUrl,
      };

      const response = await apiFetch('/api/items/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(itemData),
      });

      if (response.ok) {
        const data = await response.json();
        logger.debug('[AddItemModal] Item added:', data);
        onItemAdded();
        onOpenChange(false);
        setSelectedItem(null);
        setQuantity(1);
        setSearchQuery('');
      } else {
        const error = await response.json();
        logger.error('[AddItemModal] Failed to add item:', error);
        showToast('添加物品失败: ' + (error.detail || '未知错误'), 'error');
      }
    } catch (error) {
      logger.error('[AddItemModal] Error adding item:', error);
      showToast('添加物品失败', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} {...{modal: false}}>
      <Dialog.Content aria-describedby={undefined} style={{ maxWidth: '800px', maxHeight: '80vh', zIndex: 10300 }}>
        <div className="flex items-center justify-between mb-2">
          <Dialog.Title><span>{onDirectAdd ? '添加物品到背包' : '添加物品到资源库'}</span></Dialog.Title>
          <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
            <span>✕</span>
          </Dialog.Close>
        </div>
        <Dialog.Description size="2" mb="4">
          <span>{onDirectAdd ? '从装备列表中选择物品添加到背包' : '从装备列表中选择物品添加到战役资源库'}</span>
        </Dialog.Description>

        <Flex direction="column" gap="3" style={{ height: '60vh' }}>
          {/* Search */}
          <TextField.Root
            placeholder="搜索物品..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          {/* Category Tabs */}
          <Tabs.Root value={activeCategory} onValueChange={(v) => { setActiveCategory(v as any); setSearchQuery(''); setSelectedItem(null); }}>
            <Tabs.List className="flex border-b border-gray-700 overflow-x-auto scrollbar-hide">
              <Tabs.Trigger
                value="weapons"
                className="flex-1 px-3 py-2 text-sm font-medium data-[state=active]:bg-gray-700 data-[state=active]:text-amber-400"
              >
                武器
              </Tabs.Trigger>
              <Tabs.Trigger
                value="armor"
                className="flex-1 px-3 py-2 text-sm font-medium data-[state=active]:bg-gray-700 data-[state=active]:text-amber-400"
              >
                护甲
              </Tabs.Trigger>
              <Tabs.Trigger
                value="gear"
                className="flex-1 px-3 py-2 text-sm font-medium data-[state=active]:bg-gray-700 data-[state=active]:text-amber-400"
              >
                冒险装备
              </Tabs.Trigger>
              <Tabs.Trigger
                value="tools"
                className="flex-1 px-3 py-2 text-sm font-medium data-[state=active]:bg-gray-700 data-[state=active]:text-amber-400"
              >
                工具
              </Tabs.Trigger>
              <Tabs.Trigger
                value="packs"
                className="flex-1 px-3 py-2 text-sm font-medium data-[state=active]:bg-gray-700 data-[state=active]:text-green-400"
              >
                套装
              </Tabs.Trigger>
              <Tabs.Trigger
                value="magic"
                className="flex-1 px-3 py-2 text-sm font-medium data-[state=active]:bg-gray-700 data-[state=active]:text-purple-400"
              >
                魔法物品
              </Tabs.Trigger>
            </Tabs.List>

            {/* Item List */}
            <ScrollArea style={{ height: '400px' }} className="mt-3">
              <Flex direction="column" gap="2" p="2">
                {filteredItems.map((item) => (
                  <Box
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    className={`p-3 rounded cursor-pointer border ${
                      selectedItem?.id === item.id
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-gray-700 hover:border-gray-600'
                    }`}
                    onClick={() => { logger.debug('[AddItemModal] Selected:', item.name); setSelectedItem(item); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedItem(item); } }}
                  >
                    <Flex gap="3" align="center">
                      {/* Icon */}
                      {item.iconPath && (
                        <img
                          src={getAssetUrl(item.iconPath)}
                          alt={item.name}
                          style={{ width: '40px', height: '40px', objectFit: 'contain' }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      )}

                      {/* Item Info */}
                      <Flex direction="column" gap="1" style={{ flex: 1 }}>
                        <Flex align="center" gap="2">
                          <Text size="2" weight="bold"><span>{item.name}</span></Text>
                          <Text size="1" color="gray"><span>({item.nameEn})</span></Text>
                        </Flex>
                        <Flex gap="2" wrap="wrap">
                          {/* Weapon category: 简易近战 / 军用远程 etc. */}
                          {item.weaponGroup && (
                            <Badge size="1" variant="soft" color="gray">
                              <span>{item.weaponGroup === 'simple' ? '简易' : '军用'}{item.weaponType === 'melee' ? '近战' : '远程'}</span>
                            </Badge>
                          )}
                          {/* Non-weapon type */}
                          {!item.weaponGroup && item.type && <Badge size="1" variant="soft"><span>{item.type}</span></Badge>}
                          {/* Damage + type in Chinese */}
                          {item.damage && (
                            <Badge size="1" variant="soft" color="red">
                              <span>{item.damage}{item.versatileDamage ? `/${item.versatileDamage}` : ''} {item.damageType ? tDamageType(item.damageType) : ''}</span>
                            </Badge>
                          )}
                          {/* Range */}
                          {item.range && (
                            <Badge size="1" variant="soft" color="cyan">
                              <span>{typeof item.range === 'object' ? `${item.range.normal}/${item.range.long} ft` : item.range}</span>
                            </Badge>
                          )}
                          {/* Properties in Chinese */}
                          {item.properties && item.properties.length > 0 && (
                            <Badge size="1" variant="outline" color="gray">
                              <span>{item.properties.map((p: string) => tWeaponProperty(p)).join(', ')}</span>
                            </Badge>
                          )}
                          {/* AC */}
                          {item.ac && (
                            <Badge size="1" variant="soft" color="blue">
                              <span>AC {item.ac}</span>
                            </Badge>
                          )}
                          {/* Magic item rarity */}
                          {item.rarityCn && (
                            <Badge size="1" variant="soft" color="purple">
                              <span>{item.rarityCn}</span>
                            </Badge>
                          )}
                          {item.requiresAttunement && (
                            <Badge size="1" variant="soft" color="yellow">
                              <span>需调谐</span>
                            </Badge>
                          )}
                          {/* Magic item stats: bonus, charges, effects */}
                          {(item as any).stats?.bonus && (
                            <Badge size="1" variant="soft" color="green">
                              <span>+{(item as any).stats.bonus}</span>
                            </Badge>
                          )}
                          {(item as any).stats?.bonusAC && (
                            <Badge size="1" variant="soft" color="blue">
                              <span>AC +{(item as any).stats.bonusAC}</span>
                            </Badge>
                          )}
                          {(item as any).stats?.bonusAttack && (
                            <Badge size="1" variant="soft" color="red">
                              <span>攻击 +{(item as any).stats.bonusAttack}</span>
                            </Badge>
                          )}
                          {(item as any).stats?.charges && (
                            <Badge size="1" variant="outline" color="cyan">
                              <span>{(item as any).stats.charges} 充能</span>
                            </Badge>
                          )}
                          {(item as any).stats?.effects && (item as any).stats.effects.length > 0 && (
                            <Badge size="1" variant="outline" color="gray">
                              <span>{(item as any).stats.effects.slice(0, 2).join(', ')}{(item as any).stats.effects.length > 2 ? '...' : ''}</span>
                            </Badge>
                          )}
                          {/* Consumable: healing, damage, effect */}
                          {(item as any).effect && (
                            <Badge size="1" variant="soft" color="green">
                              <span>{(item as any).effect}</span>
                            </Badge>
                          )}
                          {!(item as any).effect && (item as any).consumable?.healing?.formula && (
                            <Badge size="1" variant="soft" color="green">
                              <span>治疗 {(item as any).consumable.healing.formula}</span>
                            </Badge>
                          )}
                          {!(item as any).effect && (item as any).consumable?.damage && (
                            <Badge size="1" variant="soft" color="red">
                              <span>{(item as any).consumable.damage.dice} {(item as any).consumable.damage.type || ''}</span>
                            </Badge>
                          )}
                          {(item as any).uses && (
                            <Badge size="1" variant="outline" color="cyan">
                              <span>{(item as any).uses}次使用</span>
                            </Badge>
                          )}
                          {/* Cost */}
                          {item.cost && (
                            <Badge size="1" variant="outline">
                              <span>{Object.entries(item.cost).map(([unit, value]) => `${value} ${unit}`).join(', ')}</span>
                            </Badge>
                          )}
                          {/* Weight */}
                          {typeof item.weight !== 'undefined' && (
                            <Badge size="1" variant="outline">
                              <span>{item.weight} lb</span>
                            </Badge>
                          )}
                        </Flex>
                        {/* Pack description preview */}
                        {item.description && activeCategory === 'packs' && (
                          <Text size="1" color="gray"><span>{item.description}</span></Text>
                        )}
                      </Flex>

                      {/* Detail button */}
                      <button
                        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-amber-400 transition-colors"
                        title="查看详情"
                        onClick={(e) => { e.stopPropagation(); setDetailItem(item); }}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2.5a1 1 0 110 2 1 1 0 010-2zM6.5 7h3v5h-3V7z" />
                        </svg>
                      </button>
                    </Flex>
                  </Box>
                ))}
                {filteredItems.length === 0 && (
                  <Text size="2" color="gray" align="center">
                    <span>未找到匹配的物品</span>
                  </Text>
                )}
              </Flex>
            </ScrollArea>

          </Tabs.Root>

          {/* Item Detail Modal Overlay */}
          {detailItem && (
            <div className="fixed inset-0 z-[10350] flex items-center justify-center bg-black/50" onClick={() => setDetailItem(null)}>
              <div
                className="w-[90vw] max-w-md bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3 max-h-[70vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-start gap-3">
                  {detailItem.iconPath && (
                    <img
                      src={getAssetUrl(detailItem.iconPath)}
                      alt={detailItem.name}
                      className="w-14 h-14 rounded-lg object-contain border border-gray-600"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-semibold text-gray-100 truncate">{detailItem.name}</div>
                    <div className="text-sm text-gray-400">{detailItem.nameEn}</div>
                  </div>
                  <button
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors"
                    onClick={() => setDetailItem(null)}
                  >
                    ✕
                  </button>
                </div>

                {/* Type & Category */}
                <div className="flex flex-wrap gap-2">
                  {detailItem.weaponGroup && (
                    <Badge size="1" variant="soft" color="gray">
                      <span>{detailItem.weaponGroup === 'simple' ? '简易' : '军用'}{detailItem.weaponType === 'melee' ? '近战' : '远程'}武器</span>
                    </Badge>
                  )}
                  {!detailItem.weaponGroup && detailItem.type && <Badge size="1" variant="soft"><span>{detailItem.type}</span></Badge>}
                  {detailItem.categoryCn && <Badge size="1" variant="soft"><span>{detailItem.categoryCn}</span></Badge>}
                  {detailItem.rarityCn && <Badge size="1" variant="soft" color="purple"><span>{detailItem.rarityCn}</span></Badge>}
                  {detailItem.requiresAttunement && <Badge size="1" variant="soft" color="yellow"><span>需调谐</span></Badge>}
                </div>

                {/* Core Stats */}
                <div className="space-y-2 text-sm">
                  {/* Damage */}
                  {detailItem.damage && (
                    <div className="flex items-center gap-2 text-gray-300">
                      <span className="text-gray-500">伤害：</span>
                      <span className="text-red-400">{detailItem.damage}{detailItem.versatileDamage ? ` / ${detailItem.versatileDamage}` : ''}</span>
                      {detailItem.versatileDamage && <span className="text-gray-500 text-xs">(单手/双手)</span>}
                      {detailItem.damageType && <span className="text-gray-400">({tDamageType(detailItem.damageType)})</span>}
                    </div>
                  )}

                  {/* AC */}
                  {detailItem.ac && (
                    <div className="flex items-center gap-2 text-gray-300">
                      <span className="text-gray-500">AC：</span>
                      <span className="text-blue-400">{detailItem.ac}</span>
                      {detailItem.acFormula && (
                        <span className="text-gray-400 text-xs">
                          ({typeof detailItem.acFormula === 'object'
                            ? `${detailItem.acFormula.base}${detailItem.acFormula.dexModifier === 'full' ? ' + DEX' : detailItem.acFormula.dexModifier === 'max2' ? ' + DEX(max +2)' : ''}`
                            : detailItem.acFormula})
                        </span>
                      )}
                    </div>
                  )}

                  {/* Range */}
                  {detailItem.range && (
                    <div className="flex items-center gap-2 text-gray-300">
                      <span className="text-gray-500">{detailItem.properties?.some((p: string) => p === 'thrown' || p.includes('投掷')) ? '投掷射程：' : '射程：'}</span>
                      <span>{formatRange(detailItem.range)}</span>
                    </div>
                  )}

                  {/* Cost */}
                  {detailItem.cost && (
                    <div className="flex items-center gap-2 text-gray-300">
                      <span className="text-gray-500">价格：</span>
                      <span className="text-amber-400">{formatCostObj(detailItem.cost)}</span>
                    </div>
                  )}

                  {/* Weight */}
                  {typeof detailItem.weight !== 'undefined' && (
                    <div className="flex items-center gap-2 text-gray-300">
                      <span className="text-gray-500">重量：</span>
                      <span>{detailItem.weight} lb</span>
                    </div>
                  )}

                  {/* Strength Requirement */}
                  {detailItem.strengthRequired && (
                    <div className="flex items-center gap-2 text-gray-300">
                      <span className="text-gray-500">力量要求：</span>
                      <span>{detailItem.strengthRequired}</span>
                    </div>
                  )}

                  {/* Stealth Disadvantage */}
                  {detailItem.stealthDisadvantage && (
                    <div className="flex items-center gap-2 text-red-400">
                      <span className="text-gray-500">潜行劣势：</span>
                      <span>是</span>
                    </div>
                  )}
                </div>

                {/* Properties */}
                {detailItem.properties && detailItem.properties.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-500 mb-1">武器属性</div>
                    <div className="flex flex-wrap gap-1.5">
                      {detailItem.properties.map((p: string) => (
                        <span key={p} className="px-2 py-0.5 bg-gray-700/60 rounded text-xs text-gray-300">{tWeaponProperty(p)}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Magic Item Stats */}
                {(detailItem as any).stats && (
                  <div className="space-y-1.5 text-sm">
                    {(detailItem as any).stats.bonus && (
                      <div className="flex items-center gap-2 text-gray-300">
                        <span className="text-gray-500">加值：</span>
                        <span className="text-green-400">+{(detailItem as any).stats.bonus}</span>
                      </div>
                    )}
                    {(detailItem as any).stats.bonusAC && (
                      <div className="flex items-center gap-2 text-gray-300">
                        <span className="text-gray-500">AC加值：</span>
                        <span className="text-blue-400">+{(detailItem as any).stats.bonusAC}</span>
                      </div>
                    )}
                    {(detailItem as any).stats.bonusAttack && (
                      <div className="flex items-center gap-2 text-gray-300">
                        <span className="text-gray-500">攻击加值：</span>
                        <span className="text-red-400">+{(detailItem as any).stats.bonusAttack}</span>
                      </div>
                    )}
                    {(detailItem as any).stats.charges && (
                      <div className="flex items-center gap-2 text-gray-300">
                        <span className="text-gray-500">充能：</span>
                        <span className="text-cyan-400">{(detailItem as any).stats.charges}</span>
                        {(detailItem as any).stats.recharge && (
                          <span className="text-gray-500 text-xs">({(detailItem as any).stats.recharge})</span>
                        )}
                      </div>
                    )}
                    {(detailItem as any).stats.effects && (detailItem as any).stats.effects.length > 0 && (
                      <div>
                        <div className="text-gray-500 mb-0.5">效果：</div>
                        <div className="flex flex-wrap gap-1.5">
                          {(detailItem as any).stats.effects.map((eff: string, i: number) => (
                            <span key={i} className="px-2 py-0.5 bg-purple-900/30 border border-purple-700/30 rounded text-xs text-purple-300">{eff}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Consumable / Effect stats */}
                {((detailItem as any).effect || (detailItem as any).consumable || (detailItem as any).uses) && (
                  <div className="space-y-1.5 text-sm">
                    {(detailItem as any).effect && (
                      <div className="flex items-center gap-2 text-gray-300">
                        <span className="text-gray-500">效果：</span>
                        <span className="text-green-400">{(detailItem as any).effect}</span>
                      </div>
                    )}
                    {(detailItem as any).consumable?.healing && (
                      <div className="flex items-center gap-2 text-gray-300">
                        <span className="text-gray-500">治疗：</span>
                        <span className="text-green-400">{(detailItem as any).consumable.healing.formula || `${(detailItem as any).consumable.healing.dice}+${(detailItem as any).consumable.healing.bonus}`}</span>
                      </div>
                    )}
                    {(detailItem as any).consumable?.damage && (
                      <div className="flex items-center gap-2 text-gray-300">
                        <span className="text-gray-500">伤害：</span>
                        <span className="text-red-400">{(detailItem as any).consumable.damage.dice} {(detailItem as any).consumable.damage.type || ''}</span>
                        {(detailItem as any).consumable.damage.save && (
                          <span className="text-gray-400 text-xs">(DC{(detailItem as any).consumable.damage.save.dc} {(detailItem as any).consumable.damage.save.ability?.toUpperCase()})</span>
                        )}
                      </div>
                    )}
                    {(detailItem as any).consumable?.type && (
                      <div className="flex items-center gap-2 text-gray-300">
                        <span className="text-gray-500">类型：</span>
                        <span>{(detailItem as any).consumable.type === 'drink' ? '饮用' : (detailItem as any).consumable.type === 'apply' ? '涂抹' : (detailItem as any).consumable.type}</span>
                        {(detailItem as any).consumable.consumed && <span className="text-gray-500 text-xs">(消耗)</span>}
                      </div>
                    )}
                    {(detailItem as any).uses && (
                      <div className="flex items-center gap-2 text-gray-300">
                        <span className="text-gray-500">使用次数：</span>
                        <span className="text-cyan-400">{(detailItem as any).uses}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Description */}
                {detailItem.description && (
                  <div className="p-2.5 bg-gray-800/40 border border-gray-700/50 rounded-lg">
                    <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">{detailItem.description}</div>
                  </div>
                )}

                {/* Pack Contents */}
                {(detailItem as any).contents && (
                  <div>
                    <div className="text-xs text-gray-500 mb-1">套装内容</div>
                    <div className="p-2.5 bg-gray-800/40 border border-gray-700/50 rounded-lg space-y-1">
                      {(detailItem as any).contents.map((c: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-sm text-gray-300">
                          <span className="text-gray-500">-</span>
                          <span>{c.item}</span>
                          {c.quantity > 1 && <span className="text-amber-400">x{c.quantity}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Select & Close Buttons */}
                <div className="flex gap-2 justify-end pt-1">
                  <button
                    className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors"
                    onClick={() => setDetailItem(null)}
                  >
                    关闭
                  </button>
                  <button
                    className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 rounded text-white transition-colors"
                    onClick={() => { setSelectedItem(detailItem); setDetailItem(null); }}
                  >
                    选择此物品
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Quantity Input */}
          {selectedItem && (
            <Flex gap="2" align="center">
              <Text size="2"><span>数量:</span></Text>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm w-20"
              />
            </Flex>
          )}
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Button variant="soft" color="gray" onClick={() => onOpenChange(false)}>
            <span>取消</span>
          </Button>
          <Button
            onClick={handleAddItem}
            disabled={!selectedItem || isLoading}
          >
            <span>{isLoading ? '添加中...' : '添加物品'}</span>
          </Button>
        </Flex>
      </Dialog.Content>

    </Dialog.Root>
  );
}
