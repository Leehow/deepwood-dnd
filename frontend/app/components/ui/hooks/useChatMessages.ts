/**
 * useChatMessages Hook
 * Manages chat message state and operations
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { chatService } from '~/services';
import { fetchCampaignChatMessagesCached } from '~/queries/chatQueries';
import type { ChatMessage as BackendChatMessage } from '~/services/chat.service';
import { showGlobalToast } from '~/components/ui/Toast';
import { createLogger } from '~/utils/logger';

const logger = createLogger('useChatMessages');

export interface Message {
  id: string;
  dbId?: number;
  user: string;
  senderUserId?: string;
  senderRole?: string;
  content: string;
  type: 'chat' | 'system' | 'dice' | 'combat';
  timestamp: Date;
  createdAt?: string;
  recipients?: string[];
  isDeleted?: boolean;
  meta?: Record<string, unknown>;
}

/**
 * Transform a backend ChatMessage into a frontend Message.
 * Shared by useChatMessages.loadHistory and ChatPanel.loadFilteredMessages.
 */
export function transformBackendMessage(msg: BackendChatMessage): Message {
  let transformedMeta = msg.meta;
  if (msg.message_type === 'dice' && msg.meta?.dice?.stage === 'result') {
    const actor = msg.meta.dice.actor;
    transformedMeta = {
      ...msg.meta,
      diceRoll: {
        ...msg.meta.dice.roll,
        is_private: msg.is_private,
        actor_name: actor?.name,
        actor_type: actor?.type,
        actor_user_id: actor?.user_id,
        actor_avatar_url: actor?.avatar_url,
        actor_character_id: actor?.character_id,
        actor_monster_instance_id: actor?.monster_instance_id,
      }
    };
  } else if (msg.message_type === 'dice' && msg.meta?.dice?.stage === 'request') {
    transformedMeta = { ...msg.meta, diceRequest: {
      request_id: msg.meta.dice.request_id,
      check: msg.meta.dice.check,
      recipients: msg.meta.dice.recipients,
      completed_by: msg.meta.dice.completed_by || [],
      dismissed_by: msg.meta.dice.dismissed_by || [],
      is_private: msg.is_private,
    }};
  } else if (msg.message_type === 'system' && msg.meta?.requires_claim && !msg.meta?.restGrant) {
    transformedMeta = {
      ...msg.meta,
      rewardPending: {
        reward_type: msg.meta.reward_type,
        amount: msg.meta.amount,
        currency_changes: msg.meta.currency_changes,
        characters: msg.meta.pending_characters || [],
        claimed_by: msg.meta.claimed_by || [],
        is_private: msg.is_private,
      }
    };
  }
  const shouldDisplaySystemCombatAsDM = (msg.sender_role as string) === 'system' && (msg.message_type as string) === 'combat';
  let userName = shouldDisplaySystemCombatAsDM
    ? 'DM'
    : msg.sender_role === 'ai'
      ? 'AI'
      : msg.sender_role === 'dm'
        ? 'DM'
        : `User ${msg.sender_user_id}`;
  if (msg.meta?.dice?.actor?.name) {
    userName = msg.meta.dice.actor.name;
  } else if (msg.meta?.consumable_use?.character_name) {
    userName = msg.meta.consumable_use.character_name;
  } else if (msg.meta?.resource_use?.character_name) {
    userName = msg.meta.resource_use.character_name;
  } else if (msg.meta?.character_name) {
    userName = msg.meta.character_name;
  }
  return {
    id: String(msg.id),
    dbId: msg.id,
    user: userName,
    senderUserId: msg.sender_user_id,
    senderRole: msg.sender_role,
    content: msg.content,
    type: (msg.message_type || 'chat') as Message['type'],
    timestamp: new Date(msg.created_at),
    createdAt: msg.created_at,
    recipients: msg.recipients,
    isDeleted: msg.is_deleted,
    meta: transformedMeta,
  };
}

export interface UseChatMessagesResult {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  deleteMessage: (id: string) => void;
  loadHistory: () => Promise<void>;
  editMessage: (messageId: number, content: string) => Promise<void>;
  loadingHistory: boolean;
  hasMore: boolean;
  showToast: (message: string) => void;
  messagesEndRef: React.RefCallback<HTMLDivElement>;
  scrollToBottom: () => void;
  isReady: boolean;
}

export function useChatMessages(
  campaignId: string,
  userId: string,
  role: 'dm' | 'player',
  isAtBottomRef?: React.RefObject<boolean>
): UseChatMessagesResult {
  const [messages, setMessages] = useState<Message[]>([]);

  const [loadingHistory, setLoadingHistory] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const messagesEndElementRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToBottomRef = useRef(false);
  // Track recent toast messages to prevent duplicates
  const recentToastsRef = useRef<Map<string, number>>(new Map());

  /**
   * Scroll to bottom of chat
   */
  const scrollToBottomNow = useCallback(() => {
    const node = messagesEndElementRef.current;
    if (!node) {
      pendingScrollToBottomRef.current = true;
      return false;
    }
    node.scrollIntoView({ behavior: 'auto', block: 'end' });
    pendingScrollToBottomRef.current = false;
    return true;
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const didScroll = scrollToBottomNow();
      if (!didScroll) return;
      requestAnimationFrame(() => {
        scrollToBottomNow();
      });
    });
  }, [scrollToBottomNow]);

  const messagesEndRef = useCallback((node: HTMLDivElement | null) => {
    messagesEndElementRef.current = node;
    if (node && pendingScrollToBottomRef.current) {
      requestAnimationFrame(() => {
        scrollToBottomNow();
      });
    }
  }, [scrollToBottomNow]);

  /**
   * Show toast notification (with deduplication for same message within 2s)
   */
  const showToast = useCallback((message: string) => {
    const now = Date.now();
    const lastShown = recentToastsRef.current.get(message);

    // Skip if same message was shown within 2 seconds
    if (lastShown && now - lastShown < 2000) {
      return;
    }

    recentToastsRef.current.set(message, now);
    showGlobalToast({ message, type: 'info' });

    // Clean up old entries from recentToastsRef (older than 5s)
    for (const [msg, timestamp] of recentToastsRef.current.entries()) {
      if (now - timestamp > 5000) {
        recentToastsRef.current.delete(msg);
      }
    }
  }, []);

  /**
   * Add new message to the list
   */
  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => {
      // Avoid duplicates by dbId or id
      if (message.dbId && prev.some(m => m.dbId === message.dbId)) {
        logger.debug('Skipping duplicate message by dbId', { dbId: message.dbId });
        return prev;
      }
      if (message.id && prev.some(m => m.id === message.id)) {
        logger.debug('Skipping duplicate message by id', { id: message.id });
        return prev;
      }
      return [...prev, message];
    });

    // Auto-scroll to new message (only if user is at bottom)
    if (!isAtBottomRef || isAtBottomRef.current) {
      setTimeout(scrollToBottom, 100);
    }
  }, [scrollToBottom, isAtBottomRef]);

  /**
   * Update existing message
   */
  const updateMessage = useCallback((id: string, updates: Partial<Message>) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg
      )
    );
  }, []);

  /**
   * Delete message
   */
  const deleteMessage = useCallback((id: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === id ? { ...msg, isDeleted: true } : msg
      )
    );
  }, []);

  /**
   * Load chat history from server
   */
  const loadHistory = useCallback(async () => {
    if (loadingHistory || !hasMore) return;

    setLoadingHistory(true);
    try {
      // Use id-based pagination (before_id) compatible with backend
      const oldestDbId = messages
        .map((m) => m.dbId)
        .filter((id): id is number => typeof id === 'number')
        .reduce((min, id) => (min === null ? id : Math.min(min, id)), null as number | null);

      const response = await fetchCampaignChatMessagesCached(
        campaignId,
        { beforeId: oldestDbId ?? undefined, limit: 50 },
      );

      if (response.messages && response.messages.length > 0) {
        const historyMessages: Message[] = response.messages.map(transformBackendMessage);

        // Backend returns messages in desc order (newest first).
        // 1) De-duplicate against existing messages by dbId
        // 2) Reverse to oldest-first and prepend so that overall order stays chronological.
        setMessages((prev) => {
          const existingIds = new Set(
            prev
              .map((m) => m.dbId)
              .filter((id): id is number => typeof id === 'number')
          );
          const deduped = historyMessages.filter((m) => !m.dbId || !existingIds.has(m.dbId));
          return [...deduped.reverse(), ...prev];
        });
        setHasMore(response.messages.length === 50);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      logger.error('Failed to load chat history', error);
      showToast('加载历史消息失败');
    } finally {
      setLoadingHistory(false);
    }
  }, [campaignId, userId, role, loadingHistory, hasMore, messages.length, showToast]);

  /**
   * Edit message on server
   */
  const editMessage = useCallback(
    async (messageId: number, content: string) => {
      try {
        await chatService.editMessage(campaignId, messageId, { content }, userId, role);

        // Update local state
        setMessages((prev) =>
          prev.map((msg) =>
            msg.dbId === messageId ? { ...msg, content } : msg
          )
        );

        showToast('消息已更新');
      } catch (error) {
        logger.error('Failed to edit message', error);
        showToast('编辑消息失败');
        throw error;
      }
    },
    [campaignId, userId, role, showToast]
  );

  /**
   * Auto-scroll to bottom on new messages (only if user is at bottom)
   */
  useEffect(() => {
    if (!isAtBottomRef || isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [messages.length, scrollToBottom, isAtBottomRef]);

  /**
   * Load initial history on mount and set ready state after scroll
   */
  useEffect(() => {
    setIsReady(false);
    loadHistory().finally(() => {
      scrollToBottom();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsReady(true);
        });
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]); // Only run when campaign changes

  return {
    messages,
    setMessages,
    addMessage,
    updateMessage,
    deleteMessage,
    loadHistory,
    editMessage,
    loadingHistory,
    hasMore,
    showToast,
    messagesEndRef,
    scrollToBottom,
    isReady
  };
}
