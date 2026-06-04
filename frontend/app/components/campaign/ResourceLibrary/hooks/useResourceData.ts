/**
 * Custom hooks for ResourceLibrary - with smart caching
 * 🚀 优化：添加合理的缓存策略，减少不必要的网络请求
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Item, MonsterInstance, Token } from '../types';
import * as api from '../utils/api';
import { showGlobalToast } from '~/components/ui/Toast';
import { createLogger } from '~/utils/logger';
const logger = createLogger('useResourceData');

// 🚀 缓存配置：2分钟内数据视为新鲜，不会重新请求
const CACHE_CONFIG = {
  staleTime: 2 * 60 * 1000,     // 2分钟内数据视为新鲜
  gcTime: 5 * 60 * 1000,        // 5分钟后清理缓存
  refetchOnMount: true as const,       // 挂载时检查是否过期（受 staleTime 约束）
  refetchOnWindowFocus: false,   // 切换窗口不刷新
};

/**
 * Hook to manage items data and operations - with smart caching
 */
export const useItems = (campaignId: string, activeTab: string) => {
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['items', campaignId],
    queryFn: async () => {
      const data = await api.fetchItems(campaignId);
      return data;
    },
    enabled: !!campaignId,
    ...CACHE_CONFIG,
  });

  const loadItems = () => {
    if (campaignId) {
      queryClient.invalidateQueries({ queryKey: ['items', campaignId] });
    }
  };

  return { items, isLoading, loadItems };
};

/**
 * Hook to manage monster instances data and operations - with smart caching
 */
export const useMonsterInstances = (campaignId: string, activeTab: string) => {
  const queryClient = useQueryClient();

  const { data: monsterInstances = [], isLoading } = useQuery({
    queryKey: ['monsterInstances', campaignId],
    queryFn: async () => {
      const data = await api.fetchMonsterInstances(campaignId);
      logger.debug('[useMonsterInstances] Loaded:', data);
      return data;
    },
    enabled: !!campaignId,
    ...CACHE_CONFIG,
  });

  const loadMonsterInstances = () => {
    if (campaignId) {
      queryClient.invalidateQueries({ queryKey: ['monsterInstances', campaignId] });
    }
  };

  return { monsterInstances, isLoading, loadMonsterInstances };
};

/**
 * Hook to manage map tokens data and operations - with smart caching
 */
export const useMapTokens = (campaignId: string, mapUrl: string | undefined, activeTab: string) => {
  const queryClient = useQueryClient();

  const { data: mapTokens = [], isLoading } = useQuery({
    queryKey: ['mapTokens', campaignId, mapUrl],
    queryFn: async () => {
      const data = await api.fetchMapTokens(campaignId, mapUrl!);
      const allTokens = data.tokens || [];
      logger.debug('[useMapTokens] Loaded:', allTokens);
      return allTokens;
    },
    enabled: !!campaignId && !!mapUrl,
    ...CACHE_CONFIG,
  });

  const loadMapTokens = () => {
    if (campaignId && mapUrl) {
      queryClient.invalidateQueries({ queryKey: ['mapTokens', campaignId, mapUrl] });
    }
  };

  return { mapTokens, isLoading, loadMapTokens };
};

/**
 * Hook to manage shops data - with smart caching
 */
export const useShops = (campaignId: string) => {
  const queryClient = useQueryClient();

  const { data: shops = [], isLoading } = useQuery({
    queryKey: ['shops', campaignId],
    queryFn: async () => {
      const resp = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/shops/campaign/${campaignId}`);
      if (resp.ok) {
        const data = await resp.json();
        return data || [];
      }
      return [];
    },
    enabled: !!campaignId,
    ...CACHE_CONFIG,
  });

  const loadShops = () => {
    if (campaignId) {
      queryClient.invalidateQueries({ queryKey: ['shops', campaignId] });
    }
  };

  return { shops, isLoading, loadShops };
};

/**
 * Hook to manage chests data - with smart caching
 */
export const useChests = (campaignId: string) => {
  const queryClient = useQueryClient();

  const { data: chests = [], isLoading } = useQuery({
    queryKey: ['chests', campaignId],
    queryFn: async () => {
      const resp = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/chests/campaign/${campaignId}`);
      if (resp.ok) {
        const data = await resp.json();
        return data || [];
      }
      return [];
    },
    enabled: !!campaignId,
    ...CACHE_CONFIG,
  });

  const loadChests = () => {
    if (campaignId) {
      queryClient.invalidateQueries({ queryKey: ['chests', campaignId] });
    }
  };

  return { chests, isLoading, loadChests };
};

/**
 * Hook to manage toast notifications
 */
export const useToast = () => {
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    showGlobalToast({ message, type });
  };

  return { showToast };
};
