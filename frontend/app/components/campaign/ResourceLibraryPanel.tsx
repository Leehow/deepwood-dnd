/**
 * ResourceLibraryPanel Component
 * Main component for managing campaign resources (monsters, items, NPCs, shops)
 * Refactored to use modular components and custom hooks
 */

import { useState, useEffect } from 'react';
import { Card, Text, Flex, Box, TextField, Button } from '@radix-ui/themes';
import * as Tabs from '@radix-ui/react-tabs';
import { useModuleStore } from '~/stores/moduleStore';
import { useWebSocket } from '~/hooks/useWebSocket';
import { CATEGORY_CN, tCategory } from '~/config/item-i18n';

// Modular components
import {
  ItemCard, NPCCard, TokenCard, MonsterInstanceCard,
  MonsterDetailModal, ItemDetailModal, NPCDetailModal
} from './ResourceLibrary/components';
import { AddMonsterModal } from './AddMonsterModal';
import { AddNPCModal } from './AddNPCModal';
import { AddItemModal } from './AddItemModal';
import { AddCustomItemModal } from './AddCustomItemModal';
import { AddCustomMonsterModal } from './AddCustomMonsterModal';
import { AvatarSelectionModal } from './AvatarSelectionModal';
import { EntityAvatarLibraryModal, type EntityAvatarOption } from './EntityAvatarLibraryModal';
import { ShopsTab } from './ShopsTab';
import { ChestsTab } from './ChestsTab';
import { Resource_AIQueryTab } from '../ui/Resource_AIQueryTab';

// Custom hooks
import { useItems, useMonsterInstances, useMapTokens, useShops, useChests, useToast } from './ResourceLibrary/hooks/useResourceData';

// API utilities
import * as api from './ResourceLibrary/utils/api';
import { getViewportCenter, resolveItemIconPath, getCurrentMapUrl } from './ResourceLibrary/utils/helpers';
import { apiFetch } from '~/utils/api-client';
import { serializeItemToTokenData } from '~/utils/itemTokenData';

// Types
import type { MonsterInstance, Item, NPC } from './ResourceLibrary/types';
import { createLogger } from '~/utils/logger';
const logger = createLogger('ResourceLibraryPanel');
const ITEM_CUSTOM_CATEGORY = '__custom__';


interface ResourceLibraryPanelProps {
  campaignId?: string;
  currentMapUrl?: string;
  userId?: string;
  itemsRefreshTrigger?: number;
}

export function ResourceLibraryPanel({ campaignId, currentMapUrl: mapUrl, userId, itemsRefreshTrigger }: ResourceLibraryPanelProps) {
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('monsters');
  const [outerTab, setOuterTab] = useState('browse'); // 外层tab: browse | ai

  // Data hooks
  const { items, isLoading: isLoadingItems, loadItems } = useItems(campaignId || '', activeTab);
  const { monsterInstances, isLoading: isLoadingMonsters, loadMonsterInstances } =
    useMonsterInstances(campaignId || '', activeTab);
  const { mapTokens, isLoading: isLoadingTokens, loadMapTokens } =
    useMapTokens(campaignId || '', mapUrl, activeTab);
  const { shops } = useShops(campaignId || '');
  const { chests } = useChests(campaignId || '');

  // 当 itemsRefreshTrigger 变化时刷新物品列表
  useEffect(() => {
    if (itemsRefreshTrigger && campaignId) {
      loadItems();
    }
  }, [itemsRefreshTrigger]);

  // UI state
  const [showAddMonsterModal, setShowAddMonsterModal] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showAddCustomItemModal, setShowAddCustomItemModal] = useState(false);
  const [showAddCustomMonsterModal, setShowAddCustomMonsterModal] = useState(false);
  const [showAddCustomNPCModal, setShowAddCustomNPCModal] = useState(false);
  const [showAddPresetNPCModal, setShowAddPresetNPCModal] = useState(false);
  const [generatingAvatarId, setGeneratingAvatarId] = useState<number | null>(null);
  const [isQuickGeneratingNPC, setIsQuickGeneratingNPC] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [selectedMonsterForAvatar, setSelectedMonsterForAvatar] = useState<MonsterInstance | null>(null);

  // Collapsed state for map token sections - default to collapsed
  const [monsterTokensCollapsed, setMonsterTokensCollapsed] = useState(true);
  const [itemTokensCollapsed, setItemTokensCollapsed] = useState(true);
  const [npcTokensCollapsed, setNpcTokensCollapsed] = useState(true);

  // Collapsed state for item categories - default all collapsed
  const [collapsedItemCategories, setCollapsedItemCategories] = useState<Set<string>>(new Set());

  // Detail modal state
  const [selectedMonsterForDetail, setSelectedMonsterForDetail] = useState<MonsterInstance | null>(null);
  const [selectedItemForDetail, setSelectedItemForDetail] = useState<Item | null>(null);
  const [selectedItemForAvatarLibrary, setSelectedItemForAvatarLibrary] = useState<Item | null>(null);
  const [selectedNPCForDetail, setSelectedNPCForDetail] = useState<NPC | null>(null);
  const [isGeneratingItemIcon, setIsGeneratingItemIcon] = useState(false);
  const [isClearingItems, setIsClearingItems] = useState(false);
  const [showItemAvatarLibrary, setShowItemAvatarLibrary] = useState(false);

  const allMonsters = useModuleStore(state => state.allMonsters);
  const loadMonsters = useModuleStore(state => state.loadMonsters);
  const currentModule = useModuleStore(state => state.currentModule);

  const isNpcMonsterInstance = (monster: MonsterInstance | null | undefined) =>
    !!monster && monster.entity_type === 'npc';

  // Load monster library
  useEffect(() => {
    if (allMonsters.length === 0) {
      loadMonsters();
    }
  }, []);

  // WebSocket for real-time updates
  useWebSocket({
    campaignId: campaignId || "",
    userId: userId || "resource-library",
    role: "dm",
    onMessage: (message) => {
      if (message.type === 'token_hp_update' || message.type === 'token_placed' || message.type === 'token_removed') {
        loadMapTokens();
      }
      // Handle monster/item added from AI query
      if (message.type === 'monster_added') {
        loadMonsterInstances();
        showToast(`怪物「${message.data?.name || ''}」已添加到资源库`, 'success');
      }
      if (message.type === 'item_created') {
        loadItems();
        showToast(`物品「${message.data?.name || ''}」已添加到资源库`, 'success');
      }
    },
  });

  // ============= Monster Instance Handlers =============

  const handleOpenAvatarModal = (monsterInstanceId: number) => {
    const monster = monsterInstances.find(m => m.id === monsterInstanceId);
    if (monster) {
      setSelectedMonsterForAvatar(monster);
      setShowAvatarModal(true);
    }
  };

  const handleSelectExistingAvatar = async (avatarUrl: string, avatarUrlLarge: string | null, avatarId: number) => {
    if (!selectedMonsterForAvatar) return;

    try {
      await api.updateMonsterInstance(selectedMonsterForAvatar.id, {
        avatar_url: avatarUrl,
        avatar_url_large: avatarUrlLarge || avatarUrl,
        has_avatar: true,
      });

      await api.incrementAvatarUsage(avatarId);
      loadMonsterInstances();
    } catch (error) {
      logger.error('[ResourceLibrary] Error selecting avatar:', error);
    }
  };

  const handleGenerateNewAvatar = async (appearanceDescription?: string) => {
    if (!selectedMonsterForAvatar) return;

    setGeneratingAvatarId(selectedMonsterForAvatar.id);
    try {
      const data = await api.generateMonsterAvatar(
        selectedMonsterForAvatar.id,
        userId || 'unknown',
        appearanceDescription
      );
      if (data.success) {
        loadMonsterInstances();
        setShowAvatarModal(false);
        setSelectedMonsterForAvatar(null);
      } else {
        showToast('生成头像失败: ' + data.error, 'error');
      }
    } catch (error) {
      logger.error('[ResourceLibrary] Error generating avatar:', error);
      showToast('生成头像失败', 'error');
    } finally {
      setGeneratingAvatarId(null);
    }
  };

  const handleUpdateSize = async (monsterInstanceId: number, size: string) => {
    try {
      await api.updateMonsterInstance(monsterInstanceId, { token_size: size });
      loadMonsterInstances();
    } catch (error) {
      logger.error('[ResourceLibrary] Error updating token size:', error);
    }
  };

  const handleUpdateMonster = async (monsterInstanceId: number, data: Partial<MonsterInstance>) => {
    try {
      await api.updateMonsterInstance(monsterInstanceId, data);
      loadMonsterInstances();
      // Update the selected monster if it's the one being edited
      if (selectedMonsterForDetail?.id === monsterInstanceId) {
        setSelectedMonsterForDetail(prev => prev ? { ...prev, ...data } : null);
      }
    } catch (error) {
      logger.error('[ResourceLibrary] Error updating monster:', error);
      showToast('更新怪物数据失败', 'error');
    }
  };

  const handlePlaceMonsterToken = async (monsterInstanceId: number, tokenSize?: string) => {
    if (!campaignId) return;

    try {
      const monster = monsterInstances.find(m => m.id === monsterInstanceId);
      if (!monster) return;

      const { x: posX, y: posY } = getViewportCenter();

      await api.createToken({
        campaign_id: parseInt(campaignId),
        monster_instance_id: monsterInstanceId,
        map_url: 'current',
        position_x: posX,
        position_y: posY,
        token_size: tokenSize || monster.token_size || '1x1',
      });

      await loadMapTokens();
    } catch (error) {
      logger.error('[ResourceLibrary] Error placing token:', error);
    }
  };

  const handleQuickGenerateNPC = async () => {
    if (!campaignId) return;
    setIsQuickGeneratingNPC(true);
    try {
      const response = await fetch('/api/monster-instances/quick-generate-npc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: parseInt(campaignId) }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || '快速生成NPC失败');
      }
      const npc = await response.json();
      loadMonsterInstances();
      showToast(`NPC「${npc.name}」已生成`, 'success');
    } catch (error) {
      logger.error('[ResourceLibrary] Quick generate NPC failed:', error);
      showToast(error instanceof Error ? error.message : '快速生成NPC失败', 'error');
    } finally {
      setIsQuickGeneratingNPC(false);
    }
  };

  const handleDeleteMonster = async (monsterInstanceId: number) => {
    if (!campaignId) return;

    const monster = monsterInstances.find(m => m.id === monsterInstanceId);
    if (!monster) return;

    try {
      // Delete all tokens for this monster instance
      const data = await api.fetchMapTokens(campaignId, 'current');
      const monsterTokens = (data.tokens || []).filter(
        (token: any) => token.monster_instance_id === monsterInstanceId
      );

      await Promise.all(monsterTokens.map((token: any) => api.deleteToken(token.id)));

      // Delete the monster instance
      await api.deleteMonsterInstance(monsterInstanceId);
      loadMonsterInstances();
      showToast('怪物已删除', 'success');
    } catch (error) {
      logger.error('[ResourceLibrary] Error deleting monster:', error);
      showToast('删除怪物失败', 'error');
    }
  };

  const handleClearAllMonsterTokens = async () => {
    if (!campaignId || !mapUrl || !confirm('确定要清除所有怪物Token吗？')) return;

    try {
      const data = await api.fetchMapTokens(campaignId, mapUrl);
      const monsterTokens = (data.tokens || []).filter((token: any) => token.monster_instance_id !== null);

      if (monsterTokens.length === 0) {
        showToast('地图上没有怪物Token', 'info');
        return;
      }

      await Promise.all(monsterTokens.map((token: any) => api.deleteToken(token.id)));
      showToast(`已清除 ${monsterTokens.length} 个怪物Token`, 'success');
    } catch (error) {
      logger.error('[ResourceLibrary] Error clearing tokens:', error);
      showToast('清除怪物Token失败', 'error');
    }
  };

  const handleClearAllMonsters = async () => {
    if (!campaignId || !confirm('确定要清除所有怪物吗？这将同时删除地图上所有怪物Token。')) return;

    try {
      if (filteredMonsterInstances.length === 0) {
        showToast('没有怪物可清除', 'info');
        return;
      }

      // Delete all tokens for all monster instances first
      const data = await api.fetchMapTokens(campaignId, 'current');
      const monsterTokens = (data.tokens || []).filter((token: any) => token.monster_instance_id !== null);
      await Promise.all(monsterTokens.map((token: any) => api.deleteToken(token.id)));

      // Delete all monster instances
      await Promise.all(filteredMonsterInstances.map(m => api.deleteMonsterInstance(m.id)));

      loadMonsterInstances();
      loadMapTokens();
      showToast(`已清除 ${filteredMonsterInstances.length} 个怪物`, 'success');
    } catch (error) {
      logger.error('[ResourceLibrary] Error clearing monsters:', error);
      showToast('清除怪物失败', 'error');
    }
  };

  // ============= Token Handlers =============

  const handleFocusToken = (tokenId: number, position: { x: number; y: number }) => {
    const focusFunction = (window as any).__focusToken;
    if (focusFunction) {
      focusFunction(tokenId, position);
    }
  };

  const handleDeleteToken = async (tokenId: number) => {
    try {
      await api.deleteToken(tokenId);
      loadMapTokens();
    } catch (error) {
      logger.error('[ResourceLibrary] Error deleting token:', error);
      showToast('删除Token失败', 'error');
    }
  };

  const handleHPUpdate = async (tokenId: number, hp: number) => {
    try {
      await api.updateTokenHP(tokenId, hp);
      await loadMapTokens();
    } catch (error) {
      logger.error('[ResourceLibrary] Error updating token HP:', error);
      showToast('更新HP失败', 'error');
    }
  };

  // ============= Item Handlers =============

  const handleGenerateItemIcon = async (itemId: number) => {
    setIsGeneratingItemIcon(true);
    try {
      const response = await fetch(`/api/items/${itemId}/generate-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to generate icon');
      }
      const updatedItem = await response.json();
      // Update the selected item if it's open in the modal
      if (selectedItemForDetail?.id === itemId) {
        setSelectedItemForDetail({
          ...selectedItemForDetail,
          avatar_url: updatedItem.avatar_url,
          avatar_url_large: updatedItem.avatar_url_large,
        });
      }
      loadItems();
      showToast('图标生成成功', 'success');
    } catch (error) {
      console.error('Failed to generate icon:', error);
      showToast('生成图标失败: ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
    } finally {
      setIsGeneratingItemIcon(false);
    }
  };

  const handleOpenItemAvatarLibrary = (item: Item) => {
    setSelectedItemForAvatarLibrary(item);
    setShowItemAvatarLibrary(true);
  };

  const handleSelectItemAvatarFromLibrary = async (avatar: EntityAvatarOption) => {
    if (!selectedItemForAvatarLibrary) return;

    try {
      const response = await apiFetch(`/api/items/${selectedItemForAvatarLibrary.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatar_url: avatar.avatar_url,
          avatar_url_large: avatar.avatar_url_large || avatar.avatar_url,
          has_avatar: true,
        }),
      });
      if (!response.ok) throw new Error('Failed to update item avatar');

      const updatedItem = await response.json();
      if (selectedItemForDetail?.id === updatedItem.id) {
        setSelectedItemForDetail(updatedItem);
      }
      loadItems();
      showToast('已从图库应用物品图片', 'success');
    } catch (error) {
      logger.error('[ResourceLibrary] Error selecting item avatar:', error);
      showToast('应用物品图片失败', 'error');
      throw error;
    }
  };

  const handlePlaceItemToken = async (itemId: number, tokenSize?: string) => {
    if (!campaignId) return;

    try {
      const item = items.find(i => i.id === itemId);
      if (!item) return;

      const { x: posX, y: posY } = getViewportCenter();
      const staticIconPath = await resolveItemIconPath(item);
      // Prioritize AI-generated avatar_url over static icon
      const iconPath = item.avatar_url || staticIconPath;
      const mapUrl = getCurrentMapUrl();
      const qty = item.quantity || 1;
      const instanceName = `${item.name_cn || item.name}${qty > 1 ? ` ×${qty}` : ''}`;

      await api.createToken({
        campaign_id: parseInt(campaignId),
        map_url: mapUrl,
        position_x: posX,
        position_y: posY,
        token_size: tokenSize || '1x1',
        instance_name: instanceName,
        item_data: {
          ...serializeItemToTokenData({
            ...item,
            name: item.name_cn || item.name,
            description: item.description_cn || item.description,
            iconPath: staticIconPath || undefined,
          }),
          icon: iconPath || undefined,
        },
        item_quantity: qty,
      });

      showToast('已生成到地图中心', 'success');
    } catch (error) {
      logger.error('[ResourceLibrary] Error placing item token:', error);
      showToast('生成物品Token失败', 'error');
    }
  };

  const handleDeleteItem = async (itemId: number) => {
    if (!campaignId) return;

    try {
      await api.deleteItem(itemId);
      loadItems();
      showToast('物品已删除', 'success');
    } catch (error) {
      logger.error('[ResourceLibrary] Error deleting item:', error);
      showToast('删除物品失败', 'error');
    }
  };

  const handleClearAllItems = async () => {
    if (!campaignId) return;

    // Confirm before deleting
    if (!window.confirm(`确定要清除所有 ${items.length} 个物品吗？此操作不可撤销。`)) {
      return;
    }

    setIsClearingItems(true);
    try {
      const result = await api.deleteAllItems(campaignId);
      loadItems();
      showToast(`已清除 ${result.deleted_count} 个物品`, 'success');
    } catch (error) {
      logger.error('[ResourceLibrary] Error clearing all items:', error);
      showToast('清除物品失败', 'error');
    } finally {
      setIsClearingItems(false);
    }
  };

  // ============= Filter Results =============

  const filteredMonsterInstances = [...monsterInstances]
    .filter(monster =>
      !isNpcMonsterInstance(monster) &&
      (monster.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (monster.name_cn && monster.name_cn.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (monster.type && monster.type.toLowerCase().includes(searchQuery.toLowerCase())))
    )
    .sort((a, b) => b.id - a.id);

  const filteredItems = [...items]
    .filter(item =>
      (item.name && item.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.name_cn && item.name_cn.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.category && item.category.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.subcategory && item.subcategory.toLowerCase().includes(searchQuery.toLowerCase()))
    )
    .sort((a, b) => b.id - a.id);

  // 过滤地图上的Token，排除NPC的Token
  const monsterMapTokens = mapTokens.filter(token => {
    if (!token.monster_instance_id) return false;
    const monster = monsterInstances.find(m => m.id === token.monster_instance_id);
    return monster && !isNpcMonsterInstance(monster);
  });

  // 过滤地图上的NPC Token
  const npcMapTokens = mapTokens.filter(token => {
    if (!token.monster_instance_id) return false;
    const monster = monsterInstances.find(m => m.id === token.monster_instance_id);
    return monster && isNpcMonsterInstance(monster);
  });

  // 过滤地图上的物品Token
  const itemMapTokens = mapTokens.filter(token => token.item_data != null);

  // 过滤NPC列表（用于显示数量）
  const filteredNPCs = [...monsterInstances]
    .filter(m =>
      isNpcMonsterInstance(m) &&
      (m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
       (m.name_cn && m.name_cn.toLowerCase().includes(searchQuery.toLowerCase())))
    )
    .sort((a, b) => b.id - a.id);

  // ============= Item Category Grouping =============
  // Group filtered items by category
  const groupedItems = filteredItems.reduce((acc, item) => {
    const category = item.is_custom ? ITEM_CUSTOM_CATEGORY : (item.category || 'other');
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, typeof filteredItems>);

  // Sort categories by predefined order
  const categoryOrder = Object.keys(CATEGORY_CN);
  const sortedCategories = Object.keys(groupedItems).sort((a, b) => {
    if (a === ITEM_CUSTOM_CATEGORY) return -1;
    if (b === ITEM_CUSTOM_CATEGORY) return 1;
    const indexA = categoryOrder.indexOf(a);
    const indexB = categoryOrder.indexOf(b);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });

  // Toggle category collapse
  const toggleCategoryCollapse = (category: string) => {
    setCollapsedItemCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Collapse/Expand all categories
  const collapseAllCategories = () => setCollapsedItemCategories(new Set(sortedCategories));
  const expandAllCategories = () => setCollapsedItemCategories(new Set());

  return (
    <Card className="resource-library-panel h-full flex flex-col">
      {/* 外层 Tabs: 资源浏览 | AI询问 */}
      <Tabs.Root value={outerTab} onValueChange={setOuterTab} className="h-full flex flex-col">
        <Tabs.List className="panel-sub-tabs flex border-b border-amber-500/10 flex-shrink-0 bg-gradient-to-r from-gray-800/50 to-gray-900/50">
          <Tabs.Trigger
            value="browse"
            className="flex-1 px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-all data-[state=active]:bg-gradient-to-b data-[state=active]:from-amber-500/10 data-[state=active]:to-transparent data-[state=active]:text-amber-400 data-[state=active]:border-b-2 data-[state=active]:border-amber-500 data-[state=active]:shadow-inner text-gray-400 hover:text-amber-300 hover:bg-gray-800/50"
          >
            <span>📦</span> 资源浏览
          </Tabs.Trigger>
          <Tabs.Trigger
            value="ai"
            className="flex-1 px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-all data-[state=active]:bg-gradient-to-b data-[state=active]:from-emerald-500/10 data-[state=active]:to-transparent data-[state=active]:text-emerald-400 data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 data-[state=active]:shadow-inner text-gray-400 hover:text-emerald-300 hover:bg-gray-800/50"
          >
            <span>🤖</span> AI 询问
          </Tabs.Trigger>
        </Tabs.List>

        {/* 资源浏览 Tab */}
        <Tabs.Content value="browse" className="flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
          <Flex direction="column" gap="2" style={{ height: '100%' }} p="2">
            {/* Search Box */}
            <Box>
              <TextField.Root
                placeholder="搜索怪物、物品、NPC、商店..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </Box>

            {/* 内层 Tabs */}
            <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
              <Tabs.List className="flex border-b border-amber-500/10 flex-shrink-0 bg-gradient-to-r from-gray-800/30 to-gray-900/30 rounded-t-lg overflow-x-auto scrollbar-hide">
                <Tabs.Trigger
                  value="monsters"
                  className="flex-shrink-0 px-3 py-1.5 text-xs font-medium flex items-center justify-center gap-1 transition-all data-[state=active]:bg-gradient-to-b data-[state=active]:from-red-500/10 data-[state=active]:to-transparent data-[state=active]:text-red-400 data-[state=active]:border-b-2 data-[state=active]:border-red-500 text-gray-400 hover:text-red-300 hover:bg-gray-800/30"
                >
                  <span className="text-sm">👹</span><span>怪物</span>
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="items"
                  className="flex-shrink-0 px-3 py-1.5 text-xs font-medium flex items-center justify-center gap-1 transition-all data-[state=active]:bg-gradient-to-b data-[state=active]:from-blue-500/10 data-[state=active]:to-transparent data-[state=active]:text-blue-400 data-[state=active]:border-b-2 data-[state=active]:border-blue-500 text-gray-400 hover:text-blue-300 hover:bg-gray-800/30"
                >
                  <span className="text-sm">🎒</span><span>物品</span>
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="npcs"
                  className="flex-shrink-0 px-3 py-1.5 text-xs font-medium flex items-center justify-center gap-1 transition-all data-[state=active]:bg-gradient-to-b data-[state=active]:from-violet-500/10 data-[state=active]:to-transparent data-[state=active]:text-violet-400 data-[state=active]:border-b-2 data-[state=active]:border-violet-500 text-gray-400 hover:text-violet-300 hover:bg-gray-800/30"
                >
                  <span className="text-sm">👤</span><span>NPC</span>
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="shops"
                  className="flex-shrink-0 px-3 py-1.5 text-xs font-medium flex items-center justify-center gap-1 transition-all data-[state=active]:bg-gradient-to-b data-[state=active]:from-amber-500/10 data-[state=active]:to-transparent data-[state=active]:text-amber-400 data-[state=active]:border-b-2 data-[state=active]:border-amber-500 text-gray-400 hover:text-amber-300 hover:bg-gray-800/30"
                >
                  <span className="text-sm">🏪</span><span>商店</span>
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="chests"
                  className="flex-shrink-0 px-3 py-1.5 text-xs font-medium flex items-center justify-center gap-1 transition-all data-[state=active]:bg-gradient-to-b data-[state=active]:from-yellow-500/10 data-[state=active]:to-transparent data-[state=active]:text-yellow-400 data-[state=active]:border-b-2 data-[state=active]:border-yellow-500 text-gray-400 hover:text-yellow-300 hover:bg-gray-800/30"
                >
                  <span className="text-sm">📦</span><span>宝箱</span>
                </Tabs.Trigger>
              </Tabs.List>

          {/* Monsters Tab */}
          <Tabs.Content value="monsters" className="flex-1 min-h-0 overflow-auto p-2 data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
            <Flex direction="column" gap="3">
              <Flex gap="1" wrap="wrap">
                <Button size="1" variant="soft" onClick={() => setShowAddMonsterModal(true)} title="添加预设怪物">
                  <span>+</span><span className="hidden sm:inline">预设</span>
                </Button>
                <Button size="1" variant="soft" color="gray" onClick={() => setShowAddCustomMonsterModal(true)} title="添加自定义怪物">
                  <span>+</span><span className="hidden sm:inline">自定义</span>
                </Button>
                <Button
                  size="1"
                  variant="soft"
                  color="red"
                  onClick={handleClearAllMonsterTokens}
                  disabled={filteredMonsterInstances.length === 0}
                  title="清除所有怪物Token"
                >
                  <span className="sm:hidden">清T</span><span className="hidden sm:inline">清除Token</span>
                </Button>
                <Button
                  size="1"
                  variant="soft"
                  color="red"
                  onClick={handleClearAllMonsters}
                  disabled={filteredMonsterInstances.length === 0}
                  title="清除所有怪物"
                >
                  <span className="sm:hidden">清怪</span><span className="hidden sm:inline">清除怪物</span>
                </Button>
              </Flex>

              {/* Map Tokens Section - Collapsible */}
              {mapUrl && (
                <Box className="border-t border-amber-500/20 pt-3 bg-gradient-to-b from-amber-500/5 to-transparent rounded-lg">
                  <Flex
                    align="center"
                    justify="between"
                    className="cursor-pointer select-none pr-4 px-2"
                    onClick={() => setMonsterTokensCollapsed(!monsterTokensCollapsed)}
                  >
                    <Text size="2" weight="bold" className="text-amber-400 flex items-center gap-2">
                      <span>🗺️</span> 地图上的怪物 ({monsterMapTokens.length})
                    </Text>
                    <Text size="1" color="gray" className="transition-transform" style={{ transform: monsterTokensCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</Text>
                  </Flex>
                  {!monsterTokensCollapsed && (
                    isLoadingTokens ? (
                      <Text size="2" color="gray" className="mt-2">加载中...</Text>
                    ) : monsterMapTokens.length > 0 ? (
                      <Flex direction="column" gap="2" className="mt-2">
                        {monsterMapTokens.map(token => (
                          <TokenCard
                            key={token.id}
                            token={token}
                            onFocus={handleFocusToken}
                            onDelete={handleDeleteToken}
                            onHPUpdate={handleHPUpdate}
                          />
                        ))}
                      </Flex>
                    ) : (
                      <Text size="1" color="gray" className="mt-2">地图上没有怪物Token</Text>
                    )
                  )}
                </Box>
              )}

              {/* Monster Instances List */}
              {isLoadingMonsters ? (
                <Text size="2" color="gray">加载中...</Text>
              ) : filteredMonsterInstances.length > 0 ? (
                <Flex direction="column" gap="2">
                  {filteredMonsterInstances.map(monster => (
                    <MonsterInstanceCard
                      key={monster.id}
                      monsterInstance={monster}
                      onGenerateAvatar={handleOpenAvatarModal}
                      onPlaceToken={handlePlaceMonsterToken}
                      onUpdateSize={handleUpdateSize}
                      onDelete={handleDeleteMonster}
                      onOpenDetail={setSelectedMonsterForDetail}
                      isGeneratingAvatar={generatingAvatarId === monster.id}
                      hasTokenOnMap={mapTokens.some(t => t.monster_instance_id === monster.id)}
                    />
                  ))}
                </Flex>
              ) : (
                <Text size="2" color="gray">
                  {searchQuery ? '未找到匹配的怪物' : '暂无怪物，点击上方按钮添加'}
                </Text>
              )}
            </Flex>
          </Tabs.Content>

          {/* Items Tab */}
          <Tabs.Content value="items" className="flex-1 min-h-0 overflow-auto p-2 data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
            <Flex direction="column" gap="3">
              <Flex gap="1" align="center" justify="between">
                <Flex gap="1" align="center">
                  <Button size="1" variant="soft" onClick={() => setShowAddItemModal(true)}>+预设</Button>
                  <Button size="1" variant="soft" color="gray" onClick={() => setShowAddCustomItemModal(true)}>
                    +自定义
                  </Button>
                </Flex>
                <Flex gap="1" align="center">
                  {/* 清除全部物品按钮 */}
                  {filteredItems.length > 0 && (
                    <button
                      className="text-[10px] px-1.5 py-0.5 rounded bg-red-600/30 hover:bg-red-600/50 text-red-400 transition-colors"
                      onClick={handleClearAllItems}
                      disabled={isClearingItems}
                      title="清除所有物品"
                    >
                      {isClearingItems ? '清除中...' : '🗑️ 清空'}
                    </button>
                  )}
                  {/* 折叠/展开全部按钮 */}
                  {sortedCategories.length > 1 && (
                    <>
                      <button
                        className="text-[10px] px-1.5 py-0.5 rounded bg-gray-600/30 hover:bg-gray-600/50 text-gray-400 transition-colors"
                        onClick={expandAllCategories}
                        title="展开全部"
                      >
                        展开
                      </button>
                      <button
                        className="text-[10px] px-1.5 py-0.5 rounded bg-gray-600/30 hover:bg-gray-600/50 text-gray-400 transition-colors"
                        onClick={collapseAllCategories}
                        title="折叠全部"
                      >
                        折叠
                      </button>
                    </>
                  )}
                </Flex>
              </Flex>

              {/* Item Map Tokens Section - Collapsible */}
              {mapUrl && (
                <Box className="border-t border-blue-500/20 pt-3 bg-gradient-to-b from-blue-500/5 to-transparent rounded-lg">
                  <Flex
                    align="center"
                    justify="between"
                    className="cursor-pointer select-none pr-4 px-2"
                    onClick={() => setItemTokensCollapsed(!itemTokensCollapsed)}
                  >
                    <Text size="2" weight="bold" className="text-blue-400 flex items-center gap-2">
                      <span>🗺️</span> 地图上的物品 ({itemMapTokens.length})
                    </Text>
                    <Text size="1" color="gray" className="transition-transform" style={{ transform: itemTokensCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</Text>
                  </Flex>
                  {!itemTokensCollapsed && (
                    isLoadingTokens ? (
                      <Text size="2" color="gray" className="mt-2">加载中...</Text>
                    ) : itemMapTokens.length > 0 ? (
                      <Flex direction="column" gap="2" className="mt-2">
                        {itemMapTokens.map(token => (
                          <TokenCard
                            key={token.id}
                            token={token}
                            onFocus={handleFocusToken}
                            onDelete={handleDeleteToken}
                          />
                        ))}
                      </Flex>
                    ) : (
                      <Text size="1" color="gray" className="mt-2">地图上没有物品Token</Text>
                    )
                  )}
                </Box>
              )}

              {/* Items List - Grouped by Category */}
              {isLoadingItems ? (
                <Text size="2" color="gray">加载中...</Text>
              ) : filteredItems.length > 0 ? (
                <Flex direction="column" gap="2">
                  {sortedCategories.map(category => {
                    const categoryItems = groupedItems[category];
                    const isCollapsed = collapsedItemCategories.has(category);
                    const categoryLabel = category === ITEM_CUSTOM_CATEGORY ? '自定义物品' : tCategory(category);

                    return (
                      <Box key={category} className="border border-blue-500/20 rounded-lg overflow-hidden">
                        {/* Category Header */}
                        <Flex
                          align="center"
                          justify="between"
                          className="cursor-pointer select-none px-3 py-2 bg-gradient-to-r from-blue-500/10 to-transparent hover:from-blue-500/20"
                          onClick={() => toggleCategoryCollapse(category)}
                        >
                          <Flex align="center" gap="2">
                            <Text size="2" weight="bold" className="text-blue-300">
                              {categoryLabel}
                            </Text>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
                              {categoryItems.length}
                            </span>
                          </Flex>
                          <Text
                            size="1"
                            color="gray"
                            className="transition-transform duration-200"
                            style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                          >
                            ▼
                          </Text>
                        </Flex>

                        {/* Category Items */}
                        {!isCollapsed && (
                          <Flex direction="column" gap="1" className="p-2 pt-1">
                            {categoryItems.map(item => (
                              <ItemCard
                                key={item.id}
                                item={item}
                                onPlaceToken={handlePlaceItemToken}
                                onDelete={handleDeleteItem}
                                onOpenDetail={setSelectedItemForDetail}
                                onChooseAvatarFromLibrary={handleOpenItemAvatarLibrary}
                              />
                            ))}
                          </Flex>
                        )}
                      </Box>
                    );
                  })}
                </Flex>
              ) : (
                <Text size="2" color="gray">
                  {searchQuery ? '未找到匹配的物品' : '暂无物品，点击上方按钮添加'}
                </Text>
              )}
            </Flex>
          </Tabs.Content>

          {/* NPCs Tab */}
          <Tabs.Content value="npcs" className="flex-1 min-h-0 overflow-auto p-2 data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
            <Flex direction="column" gap="3">
              <Flex gap="1">
                <Button size="1" variant="soft" onClick={() => setShowAddPresetNPCModal(true)}>
                  +预设
                </Button>
                <Button size="1" variant="soft" color="gray" onClick={() => setShowAddCustomNPCModal(true)}>
                  +自定义
                </Button>
                <Button
                  size="1"
                  variant="soft"
                  color="violet"
                  onClick={handleQuickGenerateNPC}
                  disabled={isQuickGeneratingNPC}
                >
                  {isQuickGeneratingNPC ? '生成中...' : '快速生成'}
                </Button>
              </Flex>

              {/* Map NPC Tokens Section - Collapsible */}
              {mapUrl && (
                <Box className="border-b border-violet-500/20 pb-3 mb-2 bg-gradient-to-b from-violet-500/5 to-transparent rounded-lg">
                  <Flex
                    align="center"
                    justify="between"
                    className="cursor-pointer select-none pr-4 px-2"
                    onClick={() => setNpcTokensCollapsed(!npcTokensCollapsed)}
                  >
                    <Text size="2" weight="bold" className="text-violet-400 flex items-center gap-2">
                      <span>🗺️</span> 地图上的 NPC ({npcMapTokens.length})
                    </Text>
                    <Text size="1" color="gray" className="transition-transform" style={{ transform: npcTokensCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</Text>
                  </Flex>
                  {!npcTokensCollapsed && (
                    npcMapTokens.length > 0 ? (
                      <Flex direction="column" gap="2" className="mt-2">
                        {npcMapTokens.map(token => (
                          <TokenCard
                            key={token.id}
                            token={token}
                            onFocus={handleFocusToken}
                            onDelete={handleDeleteToken}
                            onHPUpdate={handleHPUpdate}
                          />
                        ))}
                      </Flex>
                    ) : (
                      <Text size="1" color="gray" className="mt-2">地图上没有NPC Token</Text>
                    )
                  )}
                </Box>
              )}

              {/* Created NPCs from MonsterInstances */}
              {(() => {
                const createdNPCs = monsterInstances.filter(m =>
                  isNpcMonsterInstance(m) &&
                  (m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                   (m.name_cn && m.name_cn.toLowerCase().includes(searchQuery.toLowerCase())))
                );
                const moduleNPCs = (currentModule?.npcs || []).filter(npc =>
                  npc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  (npc.name_en && npc.name_en.toLowerCase().includes(searchQuery.toLowerCase())) ||
                  (npc.race && npc.race.toLowerCase().includes(searchQuery.toLowerCase()))
                );

                if (createdNPCs.length === 0 && moduleNPCs.length === 0) {
                  return (
                    <Text size="2" color="gray">
                      {searchQuery ? '未找到匹配的 NPC' : '暂无 NPC（可通过模组AI询问创建）'}
                    </Text>
                  );
                }

                return (
                  <Flex direction="column" gap="2">
                    {/* Created NPCs section */}
                    {createdNPCs.length > 0 && (
                      <>
                        <Text size="1" color="gray" className="mb-1">已创建的 NPC ({createdNPCs.length})</Text>
                        {createdNPCs.map(npc => (
                          <MonsterInstanceCard
                            key={`created-npc-${npc.id}`}
                            monsterInstance={npc}
                            onGenerateAvatar={handleOpenAvatarModal}
                            onPlaceToken={handlePlaceMonsterToken}
                            onUpdateSize={handleUpdateSize}
                            onDelete={handleDeleteMonster}
                            onOpenDetail={setSelectedMonsterForDetail}
                            isGeneratingAvatar={generatingAvatarId === npc.id}
                            hasTokenOnMap={mapTokens.some(t => t.monster_instance_id === npc.id)}
                          />
                        ))}
                      </>
                    )}
                    {/* Module NPCs section */}
                    {moduleNPCs.length > 0 && (
                      <>
                        {createdNPCs.length > 0 && <Text size="1" color="gray" className="mt-3 mb-1">模组 NPC ({moduleNPCs.length})</Text>}
                        {moduleNPCs.map(npc => (
                          <NPCCard
                            key={npc.id}
                            npc={npc}
                            onSelect={(id) => useModuleStore.getState().selectNPC(id)}
                            onOpenDetail={setSelectedNPCForDetail}
                          />
                        ))}
                      </>
                    )}
                  </Flex>
                );
              })()}
            </Flex>
          </Tabs.Content>

          {/* Shops Tab */}
          <Tabs.Content value="shops" className="flex-1 min-h-0 overflow-auto p-2 data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
            <ShopsTab campaignId={campaignId || ''} currentMapUrl={mapUrl} />
          </Tabs.Content>

          {/* Chests Tab */}
          <Tabs.Content value="chests" className="flex-1 min-h-0 overflow-auto p-2 data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
            <ChestsTab campaignId={campaignId || ''} currentMapUrl={mapUrl} />
          </Tabs.Content>
            </Tabs.Root>
          </Flex>
        </Tabs.Content>

        {/* AI 询问 Tab (外层) */}
        <Tabs.Content value="ai" className="flex-1 min-h-0 overflow-hidden data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
          {campaignId && userId ? (
            <Resource_AIQueryTab campaignId={parseInt(campaignId)} userId={userId} />
          ) : (
            <div className="p-4 text-center text-gray-500">请先选择战役</div>
          )}
        </Tabs.Content>
      </Tabs.Root>

      {/* Modals */}
      {campaignId && (
        <>
          <AddMonsterModal
            open={showAddMonsterModal}
            onOpenChange={setShowAddMonsterModal}
            campaignId={campaignId}
            onMonsterAdded={loadMonsterInstances}
          />

          <AddItemModal
            open={showAddItemModal}
            onOpenChange={setShowAddItemModal}
            campaignId={campaignId}
            onItemAdded={() => {
              loadItems();
              showToast('物品已添加', 'success');
            }}
          />

          <AddCustomItemModal
            open={showAddCustomItemModal}
            onOpenChange={setShowAddCustomItemModal}
            campaignId={campaignId || ''}
            onItemAdded={() => {
              loadItems();
              showToast('自定义物品已创建', 'success');
            }}
          />

          <AddCustomMonsterModal
            open={showAddCustomMonsterModal}
            onOpenChange={setShowAddCustomMonsterModal}
            campaignId={campaignId || ''}
            isNpc={false}
            onCreated={() => {
              loadMonsterInstances();
              showToast('自定义怪物已创建', 'success');
            }}
          />

          <AddCustomMonsterModal
            open={showAddCustomNPCModal}
            onOpenChange={setShowAddCustomNPCModal}
            campaignId={campaignId || ''}
            isNpc={true}
            onCreated={() => {
              loadMonsterInstances();
              showToast('自定义NPC已创建', 'success');
            }}
          />

          <AddNPCModal
            open={showAddPresetNPCModal}
            onOpenChange={setShowAddPresetNPCModal}
            campaignId={campaignId || ''}
            onNPCAdded={() => {
              loadMonsterInstances();
              showToast('预设NPC已添加', 'success');
            }}
          />

          {selectedMonsterForAvatar && (
            <AvatarSelectionModal
              open={showAvatarModal}
              onClose={() => {
                setShowAvatarModal(false);
                setSelectedMonsterForAvatar(null);
              }}
              monsterId={selectedMonsterForAvatar.monster_id}
              monsterName={selectedMonsterForAvatar.name}
              monsterAppearance={
                selectedMonsterForAvatar.monster_data?.appearanceEn
                || selectedMonsterForAvatar.monster_data?.appearance
                || ''
              }
              onSelectExisting={handleSelectExistingAvatar}
              onGenerateNew={handleGenerateNewAvatar}
              isGenerating={generatingAvatarId === selectedMonsterForAvatar.id}
            />
          )}
        </>
      )}

      {/* Detail Modals */}
      <MonsterDetailModal
        monster={selectedMonsterForDetail}
        open={!!selectedMonsterForDetail}
        onOpenChange={(open) => !open && setSelectedMonsterForDetail(null)}
        onGenerateAvatar={(id) => {
          setSelectedMonsterForDetail(null);
          handleOpenAvatarModal(id);
        }}
        onPlaceToken={handlePlaceMonsterToken}
        onUpdateSize={handleUpdateSize}
        onUpdate={handleUpdateMonster}
        isGeneratingAvatar={generatingAvatarId === selectedMonsterForDetail?.id}
        campaignItems={items}
      />

      <ItemDetailModal
        item={selectedItemForDetail}
        open={!!selectedItemForDetail}
        onOpenChange={(open) => !open && setSelectedItemForDetail(null)}
        onPlaceToken={handlePlaceItemToken}
        onGenerateIcon={handleGenerateItemIcon}
        onChooseAvatarFromLibrary={handleOpenItemAvatarLibrary}
        isGeneratingIcon={isGeneratingItemIcon}
      />

      {selectedItemForAvatarLibrary && (
        <EntityAvatarLibraryModal
          open={showItemAvatarLibrary}
          onClose={() => {
            setShowItemAvatarLibrary(false);
            setSelectedItemForAvatarLibrary(null);
          }}
          title={`选择物品图片 - ${selectedItemForAvatarLibrary.name_cn || selectedItemForAvatarLibrary.name}`}
          fetchPath={`/api/items/avatar-library?campaign_id=${campaignId || ''}`}
          onSelect={handleSelectItemAvatarFromLibrary}
          emptyText="物品图库里还没有可复用的图片"
          imageFit="contain"
        />
      )}

      <NPCDetailModal
        npc={selectedNPCForDetail}
        open={!!selectedNPCForDetail}
        onOpenChange={(open) => !open && setSelectedNPCForDetail(null)}
        onSelect={(id) => useModuleStore.getState().selectNPC(id)}
      />
    </Card>
  );
}
