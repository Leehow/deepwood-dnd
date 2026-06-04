/**
 * React Query hooks for player character data with caching
 */

import { useQueryClient } from '@tanstack/react-query';
import {
  characterQueryKeys,
  useCharacterDetailsQuery,
  useMyCharactersQuery,
} from '~/queries/characterQueries';
import { createLogger } from '~/utils/logger';

const logger = createLogger('usePlayerCharacters');

/**
 * Hook to fetch and cache user's characters list
 */
export const useMyCharacters = (userId: string) => {
  const queryClient = useQueryClient();
  const { data: characters = [], isLoading, error } = useMyCharactersQuery(userId);

  const refetch = () => {
    if (userId) {
      // Use refetchQueries to force immediate refresh (ignoring staleTime)
      logger.debug('[useMyCharacters] Force refetching characters for user:', userId);
      queryClient.refetchQueries({ queryKey: characterQueryKeys.mine(userId) });
    }
  };

  return { characters, isLoading, error, refetch };
};

/**
 * Hook to fetch and cache character details
 */
export const useCharacterDetails = (characterId: number | null) => {
  const queryClient = useQueryClient();
  const { data: character, isLoading, error, isFetching } = useCharacterDetailsQuery(characterId);

  const refetch = () => {
    if (characterId) {
      queryClient.invalidateQueries({ queryKey: characterQueryKeys.detail(characterId) });
    }
  };

  // Silent refetch without loading state
  const silentRefetch = () => {
    if (characterId) {
      queryClient.refetchQueries({
        queryKey: characterQueryKeys.detail(characterId),
        type: 'active',
      });
    }
  };

  return {
    character,
    isLoading: isLoading && !character, // 只在首次加载时显示loading
    isFetching,
    error,
    refetch,
    silentRefetch,
  };
};
