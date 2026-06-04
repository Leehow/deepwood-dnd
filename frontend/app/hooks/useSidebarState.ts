/**
 * Hook for persisting sidebar state (tab + width + subTabs + chatFilters) per campaign and role.
 * Saves to backend with debouncing to avoid excessive API calls.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '~/utils/api-client';
import { getApiEndpoint } from '~/config/api';
import { fetchSidebarStateCached, setSidebarStateCache } from '~/utils/sidebarStateCache';

interface SubTabs {
  [panelKey: string]: string;
}

// 聊天筛选状态
export interface ChatFilters {
  // 按用户ID筛选（不在列表中的用户消息会被隐藏）
  hiddenUsers: string[];
  // 按消息类型筛选
  hiddenTypes: string[]; // 'dice' | 'system' | 'chat'
}

// 浮动聊天窗口配置
export interface FloatingChatConfig {
  stage: 'open' | 'minimized' | 'closed';
  hasOpened: boolean;
  x: number;  // -1 = 使用默认值
  y: number;
  w: number;
  h: number;
}

const DEFAULT_FLOATING_CHAT: FloatingChatConfig = {
  stage: 'closed',
  hasOpened: false,
  x: -1,
  y: -1,
  w: 400,
  h: 500,
};

// 浮动角色面板配置（装备/特性/状态）
export type CharPanelTab = 'equipment' | 'features' | 'status' | 'spells';
export interface FloatingCharPanelConfig {
  stage: 'open' | 'minimized' | 'closed';
  activeTab: CharPanelTab;
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT_FLOATING_CHAR_PANEL: FloatingCharPanelConfig = {
  stage: 'closed',
  activeTab: 'equipment',
  x: -1,
  y: -1,
  w: 500,
  h: 550,
};

interface SidebarState {
  tab: string;
  width: number;
  subTabs: SubTabs;
  chatFilters: ChatFilters;
  hotbarExpanded: boolean;
  dmSelectedCharacterId: number | null;
  spellExpandedLevels: Record<string, number[]>;
  floatingChat: FloatingChatConfig;
  floatingCharPanel: FloatingCharPanelConfig;
}

const DEFAULT_CHAT_FILTERS: ChatFilters = {
  hiddenUsers: [],
  hiddenTypes: []
};

const DEFAULT_STATE: SidebarState = {
  tab: 'characters',
  width: 384,
  subTabs: {},
  chatFilters: DEFAULT_CHAT_FILTERS,
  hotbarExpanded: false,
  dmSelectedCharacterId: null,
  spellExpandedLevels: {},
  floatingChat: DEFAULT_FLOATING_CHAT,
  floatingCharPanel: DEFAULT_FLOATING_CHAR_PANEL
};

export function useSidebarState(
  campaignId: string | undefined,
  userId: string | undefined,
  role: 'dm' | 'player'
) {
  const [tab, setTabInternal] = useState<string>(DEFAULT_STATE.tab);
  const [width, setWidthInternal] = useState<number>(DEFAULT_STATE.width);
  const [subTabs, setSubTabsInternal] = useState<SubTabs>(DEFAULT_STATE.subTabs);
  const [chatFilters, setChatFiltersInternal] = useState<ChatFilters>(DEFAULT_STATE.chatFilters);
  const [hotbarExpanded, setHotbarExpandedInternal] = useState<boolean>(DEFAULT_STATE.hotbarExpanded);
  const [dmSelectedCharacterId, setDmSelectedCharacterIdInternal] = useState<number | null>(DEFAULT_STATE.dmSelectedCharacterId);
  const [spellExpandedLevels, setSpellExpandedLevelsInternal] = useState<Record<string, number[]>>(DEFAULT_STATE.spellExpandedLevels);
  const [floatingChat, setFloatingChatInternal] = useState<FloatingChatConfig>(DEFAULT_STATE.floatingChat);
  const [floatingCharPanel, setFloatingCharPanelInternal] = useState<FloatingCharPanelConfig>(DEFAULT_STATE.floatingCharPanel);
  const [isLoaded, setIsLoaded] = useState(false);

  // Debounce timer ref
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track current values for debounced save
  const currentStateRef = useRef<SidebarState>({ tab, width, subTabs, chatFilters, hotbarExpanded, dmSelectedCharacterId, spellExpandedLevels, floatingChat, floatingCharPanel });
  currentStateRef.current = { tab, width, subTabs, chatFilters, hotbarExpanded, dmSelectedCharacterId, spellExpandedLevels, floatingChat, floatingCharPanel };

  // Track last persisted state to avoid redundant saves
  const persistedStateRef = useRef<SidebarState | null>(null);

  const buildPersistedPayload = useCallback((state: SidebarState) => ({
    role,
    tab: state.tab,
    width: state.width,
    subTabs: state.subTabs,
    chatFilters: state.chatFilters,
    hotbarExpanded: state.hotbarExpanded,
    dmSelectedCharacterId: state.dmSelectedCharacterId,
    spellExpandedLevels: state.spellExpandedLevels,
    floatingChat: state.floatingChat,
    floatingCharPanel: state.floatingCharPanel,
  }), [role]);

  // Load initial state from backend
  useEffect(() => {
    if (!campaignId || !userId) return;

    const loadState = async () => {
      try {
        const data = await fetchSidebarStateCached(campaignId, userId, role);
        if (data) {
          const loadedTab = data.tab || DEFAULT_STATE.tab;
          const loadedWidth = data.width || DEFAULT_STATE.width;
          const loadedSubTabs = data.subTabs || DEFAULT_STATE.subTabs;
          const loadedChatFilters = data.chatFilters || DEFAULT_STATE.chatFilters;
          const loadedHotbarExpanded = data.hotbarExpanded ?? DEFAULT_STATE.hotbarExpanded;
          const loadedDmSelectedCharacterId = data.dmSelectedCharacterId ?? DEFAULT_STATE.dmSelectedCharacterId;
          const loadedSpellExpandedLevels = data.spellExpandedLevels ?? DEFAULT_STATE.spellExpandedLevels;
          const loadedFloatingChat = data.floatingChat
            ? {
                ...DEFAULT_FLOATING_CHAT,
                ...data.floatingChat,
                hasOpened: data.floatingChat.hasOpened ?? true,
              }
            : DEFAULT_STATE.floatingChat;
          const loadedFloatingCharPanel = data.floatingCharPanel ? { ...DEFAULT_FLOATING_CHAR_PANEL, ...data.floatingCharPanel } : DEFAULT_STATE.floatingCharPanel;

          setTabInternal(loadedTab);
          setWidthInternal(loadedWidth);
          setSubTabsInternal(loadedSubTabs);
          setChatFiltersInternal(loadedChatFilters);
          setHotbarExpandedInternal(loadedHotbarExpanded);
          setDmSelectedCharacterIdInternal(loadedDmSelectedCharacterId);
          setSpellExpandedLevelsInternal(loadedSpellExpandedLevels);
          setFloatingChatInternal(loadedFloatingChat);
          setFloatingCharPanelInternal(loadedFloatingCharPanel);

          // Record what we loaded as the persisted state
          persistedStateRef.current = {
            tab: loadedTab,
            width: loadedWidth,
            subTabs: loadedSubTabs,
            chatFilters: loadedChatFilters,
            hotbarExpanded: loadedHotbarExpanded,
            dmSelectedCharacterId: loadedDmSelectedCharacterId,
            spellExpandedLevels: loadedSpellExpandedLevels,
            floatingChat: loadedFloatingChat,
            floatingCharPanel: loadedFloatingCharPanel
          };
        }
      } catch (error) {
        console.error('Failed to load sidebar state:', error);
      } finally {
        setIsLoaded(true);
      }
    };

    loadState();
  }, [campaignId, userId, role]);

  // Helper to check if state has changed from persisted
  const hasStateChanged = useCallback((current: SidebarState, persisted: SidebarState | null): boolean => {
    if (!persisted) return true;
    if (current.tab !== persisted.tab) return true;
    if (current.width !== persisted.width) return true;
    // Deep compare subTabs
    const currentKeys = Object.keys(current.subTabs);
    const persistedKeys = Object.keys(persisted.subTabs);
    if (currentKeys.length !== persistedKeys.length) return true;
    for (const key of currentKeys) {
      if (current.subTabs[key] !== persisted.subTabs[key]) return true;
    }
    // Deep compare chatFilters
    const arraysEqual = (a: string[], b: string[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    if (!arraysEqual(current.chatFilters.hiddenUsers, persisted.chatFilters?.hiddenUsers || [])) return true;
    if (!arraysEqual(current.chatFilters.hiddenTypes, persisted.chatFilters?.hiddenTypes || [])) return true;
    if (current.hotbarExpanded !== persisted.hotbarExpanded) return true;
    if (current.dmSelectedCharacterId !== persisted.dmSelectedCharacterId) return true;
    // Deep compare spellExpandedLevels
    const spelCurrentKeys = Object.keys(current.spellExpandedLevels);
    const spelPersistedKeys = Object.keys(persisted.spellExpandedLevels || {});
    if (spelCurrentKeys.length !== spelPersistedKeys.length) return true;
    for (const key of spelCurrentKeys) {
      if (!arraysEqual(
        (current.spellExpandedLevels[key] || []).map(String),
        ((persisted.spellExpandedLevels || {})[key] || []).map(String)
      )) return true;
    }
    // Compare floatingChat
    const fc = current.floatingChat;
    const pfc = persisted.floatingChat || DEFAULT_FLOATING_CHAT;
    if (
      fc.stage !== pfc.stage ||
      fc.hasOpened !== pfc.hasOpened ||
      fc.x !== pfc.x ||
      fc.y !== pfc.y ||
      fc.w !== pfc.w ||
      fc.h !== pfc.h
    ) return true;
    // Compare floatingCharPanel
    const fcp = current.floatingCharPanel;
    const pfcp = persisted.floatingCharPanel || DEFAULT_FLOATING_CHAR_PANEL;
    if (fcp.stage !== pfcp.stage || fcp.activeTab !== pfcp.activeTab || fcp.x !== pfcp.x || fcp.y !== pfcp.y || fcp.w !== pfcp.w || fcp.h !== pfcp.h) return true;
    return false;
  }, []);

  // Debounced save function
  const saveState = useCallback(() => {
    if (!campaignId || !userId || !isLoaded) return;

    // Clear existing timer
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    // Set new timer for debounced save (500ms)
    saveTimerRef.current = setTimeout(async () => {
      const stateToSave = currentStateRef.current;

      // Skip save if state hasn't changed from persisted
      if (!hasStateChanged(stateToSave, persistedStateRef.current)) {
        return;
      }

      try {
        await apiFetch(
          `/api/campaigns/${campaignId}/members/me/sidebar-state`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildPersistedPayload(stateToSave))
          }
        );

        // Update persisted state after successful save
        persistedStateRef.current = { ...stateToSave };
        setSidebarStateCache(campaignId, userId, role, buildPersistedPayload(stateToSave));
      } catch (error) {
        console.error('Failed to save sidebar state:', error);
      }
    }, 500);
  }, [campaignId, userId, role, isLoaded, hasStateChanged, buildPersistedPayload]);

  // Flush pending save immediately (for unmount / beforeunload)
  const flushSave = useCallback(() => {
    if (!campaignId || !userId || !isLoaded) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const stateToSave = currentStateRef.current;
    if (!hasStateChanged(stateToSave, persistedStateRef.current)) return;

    const url = getApiEndpoint(`/api/campaigns/${campaignId}/members/me/sidebar-state`);
    const payload = buildPersistedPayload(stateToSave);
    const body = JSON.stringify(payload);
    apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
    persistedStateRef.current = { ...stateToSave };
    setSidebarStateCache(campaignId, userId, role, payload);
  }, [campaignId, userId, role, isLoaded, hasStateChanged, buildPersistedPayload]);

  // Cleanup: flush on unmount + beforeunload
  useEffect(() => {
    const onBeforeUnload = () => flushSave();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      flushSave();
    };
  }, [flushSave]);

  // Wrapped setters that trigger save
  const setTab = useCallback((newTab: string) => {
    if (currentStateRef.current.tab === newTab) {
      return;
    }
    setTabInternal(newTab);
    saveState();
  }, [saveState]);

  const setWidth = useCallback((newWidth: number) => {
    if (currentStateRef.current.width === newWidth) {
      return;
    }
    setWidthInternal(newWidth);
    saveState();
  }, [saveState]);

  // Set a specific sub-tab for a panel
  const setSubTab = useCallback((panelKey: string, subTabValue: string) => {
    // Only update if value actually changed
    if (currentStateRef.current.subTabs[panelKey] === subTabValue) {
      return;
    }
    setSubTabsInternal(prev => ({ ...prev, [panelKey]: subTabValue }));
    saveState();
  }, [saveState]);

  // Get sub-tab for a panel with default fallback
  const getSubTab = useCallback((panelKey: string, defaultValue: string): string => {
    return subTabs[panelKey] || defaultValue;
  }, [subTabs]);

  // Set chat filters
  const setChatFilters = useCallback((filters: ChatFilters) => {
    setChatFiltersInternal(filters);
    saveState();
  }, [saveState]);

  // Toggle a user in hidden list
  const toggleHiddenUser = useCallback((visitorUserId: string) => {
    setChatFiltersInternal(prev => {
      const newHiddenUsers = prev.hiddenUsers.includes(visitorUserId)
        ? prev.hiddenUsers.filter(id => id !== visitorUserId)
        : [...prev.hiddenUsers, visitorUserId];
      return { ...prev, hiddenUsers: newHiddenUsers };
    });
    saveState();
  }, [saveState]);

  // Toggle a message type in hidden list
  const toggleHiddenType = useCallback((msgType: string) => {
    setChatFiltersInternal(prev => {
      const newHiddenTypes = prev.hiddenTypes.includes(msgType)
        ? prev.hiddenTypes.filter(t => t !== msgType)
        : [...prev.hiddenTypes, msgType];
      return { ...prev, hiddenTypes: newHiddenTypes };
    });
    saveState();
  }, [saveState]);

  const setHotbarExpanded = useCallback((value: boolean) => {
    if (currentStateRef.current.hotbarExpanded === value) return;
    setHotbarExpandedInternal(value);
    saveState();
  }, [saveState]);

  const setDmSelectedCharacterId = useCallback((value: number | null) => {
    if (currentStateRef.current.dmSelectedCharacterId === value) return;
    setDmSelectedCharacterIdInternal(value);
    saveState();
  }, [saveState]);

  // Get expanded spell levels for a character (default: cantrips + level 1)
  const getSpellExpandedLevels = useCallback((characterId: number): Set<number> => {
    const key = String(characterId);
    const stored = spellExpandedLevels[key];
    if (stored) return new Set(stored);
    return new Set([0, 1]); // default
  }, [spellExpandedLevels]);

  // Toggle a spell level for a character
  const toggleSpellExpandedLevel = useCallback((characterId: number, level: number) => {
    setSpellExpandedLevelsInternal(prev => {
      const key = String(characterId);
      const current = new Set(prev[key] ?? [0, 1]);
      if (current.has(level)) current.delete(level);
      else current.add(level);
      return { ...prev, [key]: Array.from(current) };
    });
    saveState();
  }, [saveState]);

  // Update floating chat config (partial merge)
  const setFloatingChat = useCallback((updates: Partial<FloatingChatConfig>) => {
    setFloatingChatInternal(prev => {
      const next = { ...prev, ...updates };
      if (updates.hasOpened === undefined && (prev.hasOpened || updates.stage === 'open')) {
        next.hasOpened = true;
      }
      return next;
    });
    saveState();
  }, [saveState]);

  // Update floating character panel config (partial merge)
  const setFloatingCharPanel = useCallback((updates: Partial<FloatingCharPanelConfig>) => {
    setFloatingCharPanelInternal(prev => ({ ...prev, ...updates }));
    saveState();
  }, [saveState]);

  return {
    tab,
    setTab,
    width,
    setWidth,
    subTabs,
    setSubTab,
    getSubTab,
    chatFilters,
    setChatFilters,
    toggleHiddenUser,
    toggleHiddenType,
    hotbarExpanded,
    setHotbarExpanded,
    dmSelectedCharacterId,
    setDmSelectedCharacterId,
    getSpellExpandedLevels,
    toggleSpellExpandedLevel,
    floatingChat,
    setFloatingChat,
    floatingCharPanel,
    setFloatingCharPanel,
    isLoaded
  };
}
