/**
 * useChatSearch Hook
 * Manages chat message search functionality
 */

import { useState, useCallback } from 'react';
import { chatService } from '~/services';
import { createLogger } from '~/utils/logger';
import type { Message } from './useChatMessages';

const logger = createLogger('useChatSearch');

export interface UseChatSearchResult {
  showSearchModal: boolean;
  searchQuery: string;
  searchResults: Message[];
  isSearching: boolean;
  setShowSearchModal: (show: boolean) => void;
  setSearchQuery: (query: string) => void;
  performSearch: (query?: string) => Promise<void>;
  clearSearch: () => void;
}

export function useChatSearch(campaignId: string, userId: string, role: 'dm' | 'player'): UseChatSearchResult {
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  /**
   * Perform search on server
   */
  const performSearch = useCallback(async (queryOverride?: string) => {
    const query = queryOverride ?? searchQuery;
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await chatService.searchMessages(campaignId, query, userId, role);

      const results: Message[] = response.messages.map((msg) => {
        let displayName = msg.sender_role === 'ai' ? 'AI' : msg.sender_role === 'dm' ? 'DM' : `User ${msg.sender_user_id}`;
        if (msg.meta?.character_name) {
          displayName = msg.meta.character_name;
        } else if (msg.meta?.dice?.actor?.name) {
          displayName = msg.meta.dice.actor.name;
        }
        return {
          id: String(msg.id),
          dbId: msg.id,
          user: displayName,
          senderUserId: msg.sender_user_id,
          senderRole: msg.sender_role,
          content: msg.content,
          type: 'chat',
          timestamp: new Date(msg.created_at),
          createdAt: msg.created_at,
          recipients: msg.recipients,
          isDeleted: msg.is_deleted
        };
      });

      setSearchResults(results);
      logger.debug('Search completed', { query, resultCount: results.length });
    } catch (error) {
      logger.error('Search failed', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [campaignId, userId, role, searchQuery]);

  /**
   * Clear search state
   */
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchModal(false);
  }, []);

  return {
    showSearchModal,
    searchQuery,
    searchResults,
    isSearching,
    setShowSearchModal,
    setSearchQuery,
    performSearch,
    clearSearch
  };
}