import { useState, useEffect, useCallback, useRef } from 'react';
import type { FloatingChatConfig } from '~/hooks/useSidebarState';
import { subscribeAppEvent } from "~/events/appEventBus";

interface UseUnreadChatParams {
  userId: string;
  floatingChat: FloatingChatConfig;
  currentTab: string;
  isSidebarExpanded: boolean;
  sidebarStateLoaded?: boolean;
}

export function useUnreadChat({
  userId,
  floatingChat,
  currentTab,
  isSidebarExpanded,
  sidebarStateLoaded = true,
}: UseUnreadChatParams) {
  const [unreadCount, setUnreadCount] = useState(0);
  const isDesktopRef = useRef(false);

  // Track desktop vs mobile
  useEffect(() => {
    const check = () => { isDesktopRef.current = window.innerWidth >= 768; };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Determine if chat is currently visible
  const isChatVisible = useCallback(() => {
    if (!sidebarStateLoaded) return false;
    if (isDesktopRef.current) {
      return floatingChat.stage === 'open';
    }
    return currentTab === 'chat' && isSidebarExpanded;
  }, [sidebarStateLoaded, floatingChat.stage, currentTab, isSidebarExpanded]);

  // Listen for chat messages
  useEffect(() => {
    const unsubscribe = subscribeAppEvent("wsChatMessage", (detail) => {
      // Ignore own messages
      if (String(detail?.user_id) === String(userId)) return;
      if (!isChatVisible()) {
        setUnreadCount(prev => prev + 1);
      }
    });
    return unsubscribe;
  }, [userId, isChatVisible]);

  // Auto-reset when chat becomes visible
  useEffect(() => {
    if (isChatVisible() && unreadCount > 0) {
      setUnreadCount(0);
    }
  }, [sidebarStateLoaded, floatingChat.stage, currentTab, isSidebarExpanded, isChatVisible, unreadCount]);

  const resetUnread = useCallback(() => setUnreadCount(0), []);

  return { unreadCount, resetUnread };
}
