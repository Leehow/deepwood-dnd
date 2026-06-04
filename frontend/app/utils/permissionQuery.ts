/**
 * TanStack Query configuration for permission-based data fetching
 * Provides query keys, fetchers, and configurations that integrate with the permission system
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  QueryClient,
  QueryKey,
  QueryFunctionContext,
  UseQueryOptions,
  UseMutationOptions
} from '@tanstack/react-query';
import { PermissionResource, PermissionAction, User } from '../../types/permissions';
import { usePermissions } from '../../hooks/usePermissions';
import {
  PermissionError,
  PermissionErrorType,
  handlePermissionError,
  createMissingPermissionError,
  createResourceNotFoundError
} from './permissionErrors';

// Query key factory for permission-based queries
export const permissionQueryKeys = {
  // Base keys
  all: ['permission'] as const,
  users: () => [...permissionQueryKeys.all, 'users'] as const,
  user: (userId: string) => [...permissionQueryKeys.users(), userId] as const,

  // Resource-specific keys
  resource: (resource: PermissionResource) => [...permissionQueryKeys.all, 'resource', resource] as const,
  resourceAction: (resource: PermissionResource, action: PermissionAction) =>
    [...permissionQueryKeys.resource(resource), action] as const,

  // Content keys
  content: (type: string) => [...permissionQueryKeys.all, 'content', type] as const,
  contentByUser: (type: string, userId: string) =>
    [...permissionQueryKeys.content(type), 'user', userId] as const,
  contentByCampaign: (type: string, campaignId: string) =>
    [...permissionQueryKeys.content(type), 'campaign', campaignId] as const,

  // Campaign keys
  campaigns: () => [...permissionQueryKeys.all, 'campaigns'] as const,
  campaign: (campaignId: string) => [...permissionQueryKeys.campaigns(), campaignId] as const,
  campaignUsers: (campaignId: string) =>
    [...permissionQueryKeys.campaign(campaignId), 'users'] as const,
};

// Permission-aware fetcher options
export interface PermissionFetchOptions {
  resource: PermissionResource;
  action: PermissionAction;
  userId?: string;
  resourceId?: string;
  campaignId?: string;
  context?: any;
}

// Generic permission-aware fetcher
const permissionAwareFetcher = async <T>(
  { queryKey, signal }: Pick<QueryFunctionContext, 'queryKey' | 'signal'>,
  fetchFn: (options: PermissionFetchOptions) => Promise<T>
): Promise<T> => {
  const [, resource, action, userId, resourceId, campaignId, context] = queryKey as [
    string, PermissionResource, PermissionAction, string?, string?, string?, any?
  ];

  const options: PermissionFetchOptions = {
    resource,
    action,
    userId,
    resourceId,
    campaignId,
    context
  };

  try {
    const result = await fetchFn(options);
    return result;
  } catch (error) {
    if (error instanceof PermissionError) {
      throw error;
    }

    // Convert other errors to permission errors where appropriate
    if (error instanceof Error) {
      if (error.message.includes('403') || error.message.includes('forbidden')) {
        throw createMissingPermissionError(resource, action, userId, resourceId);
      }
      if (error.message.includes('404') || error.message.includes('not found')) {
        throw createResourceNotFoundError(resource, resourceId || 'unknown', userId);
      }
    }

    throw error;
  }
};

// Mock data fetchers - replace with actual API calls
const mockFetchers = {
  // Fetch user data with permission check
  fetchUser: async (options: PermissionFetchOptions): Promise<User> => {
    await new Promise(resolve => setTimeout(resolve, 100));

    // Mock user data
    return {
      id: options.userId || 'user-1',
      username: 'test-user',
      email: 'test@example.com',
      role: 'player' as any,
      permissions: [],
      profile: {
        displayName: 'Test User',
        preferences: {
          theme: 'dark',
          sidebarCollapsed: false,
          activePanel: 'character' as any,
          mapZoom: 1,
          autoSave: true
        },
        language: 'en'
      }
    };
  },

  // Fetch content by type with permission check
  fetchContent: async (options: PermissionFetchOptions): Promise<any[]> => {
    await new Promise(resolve => setTimeout(resolve, 150));

    // Mock content data based on resource type
    switch (options.resource) {
      case PermissionResource.CHARACTER:
        return [
          { id: 'char-1', name: 'Fighter', ownerId: options.userId },
          { id: 'char-2', name: 'Wizard', ownerId: 'user-2' }
        ];
      case PermissionResource.MONSTER:
        return [
          { id: 'monster-1', name: 'Goblin', cr: 0.25 },
          { id: 'monster-2', name: 'Orc', cr: 0.5 }
        ];
      case PermissionResource.MAP:
        return [
          { id: 'map-1', name: 'Dungeon', campaignId: options.campaignId },
          { id: 'map-2', name: 'Forest', campaignId: options.campaignId }
        ];
      default:
        return [];
    }
  },

  // Fetch campaign data
  fetchCampaign: async (options: PermissionFetchOptions): Promise<any> => {
    await new Promise(resolve => setTimeout(resolve, 120));

    return {
      id: options.campaignId || 'campaign-1',
      name: 'The Lost Dungeon',
      dmId: 'dm-1',
      players: ['player-1', 'player-2'],
      status: 'active'
    };
  }
};

// Permission-aware query hooks
export const usePermissionQuery = <T>(
  resource: PermissionResource,
  action: PermissionAction,
  fetchFn: (options: PermissionFetchOptions) => Promise<T>,
  options: Omit<PermissionFetchOptions, 'resource' | 'action'> = {},
  queryOptions?: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>
) => {
  const { hasPermission } = usePermissions();

  const queryKey: QueryKey = [
    'permission',
    resource,
    action,
    options.userId,
    options.resourceId,
    options.campaignId,
    options.context
  ];

  return useQuery({
    queryKey,
    queryFn: (context) => permissionAwareFetcher(context, fetchFn),
    enabled: queryOptions?.enabled !== false &&
             hasPermission(resource, action, options.context),
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: (failureCount, error) => {
      // Don't retry permission errors
      if (error instanceof PermissionError && !error.retryable) {
        return false;
      }
      return failureCount < 3;
    },
    ...queryOptions
  });
};

// Specific query hooks for common use cases
export const useUserQuery = (userId: string, options?: UseQueryOptions<User, Error>) => {
  return usePermissionQuery(
    PermissionResource.CHARACTER,
    PermissionAction.READ,
    mockFetchers.fetchUser,
    { userId },
    options
  );
};

export const useCharacterQuery = (
  userId: string,
  campaignId?: string,
  options?: UseQueryOptions<any[], Error>
) => {
  return usePermissionQuery(
    PermissionResource.CHARACTER,
    PermissionAction.READ,
    mockFetchers.fetchContent,
    { userId, campaignId },
    options
  );
};

export const useMonsterQuery = (
  userId: string,
  options?: UseQueryOptions<any[], Error>
) => {
  return usePermissionQuery(
    PermissionResource.MONSTER,
    PermissionAction.READ,
    mockFetchers.fetchContent,
    { userId },
    options
  );
};

export const useMapQuery = (
  userId: string,
  campaignId: string,
  options?: UseQueryOptions<any[], Error>
) => {
  return usePermissionQuery(
    PermissionResource.MAP,
    PermissionAction.READ,
    mockFetchers.fetchContent,
    { userId, campaignId },
    options
  );
};

export const useCampaignQuery = (
  userId: string,
  campaignId: string,
  options?: UseQueryOptions<any, Error>
) => {
  return usePermissionQuery(
    PermissionResource.CAMPAIGN,
    PermissionAction.READ,
    mockFetchers.fetchCampaign,
    { userId, campaignId },
    options
  );
};

// Permission-aware mutation hooks
export const usePermissionMutation = <T, V = void>(
  resource: PermissionResource,
  action: PermissionAction,
  mutationFn: (variables: V, options: PermissionFetchOptions) => Promise<T>,
  options: Omit<PermissionFetchOptions, 'resource' | 'action'> = {},
  mutationOptions?: UseMutationOptions<T, Error, V>
) => {
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: V) => {
      const fetchOptions: PermissionFetchOptions = {
        resource,
        action,
        ...options
      };

      // Check permissions before executing mutation
      if (!hasPermission(resource, action, options.context)) {
        throw createMissingPermissionError(resource, action, options.userId);
      }

      try {
        const result = await mutationFn(variables, fetchOptions);

        // Invalidate relevant queries on success
        queryClient.invalidateQueries({
          queryKey: permissionQueryKeys.resource(resource)
        });

        if (options.campaignId) {
          queryClient.invalidateQueries({
            queryKey: permissionQueryKeys.campaign(options.campaignId)
          });
        }

        return result;
      } catch (error) {
        if (error instanceof PermissionError) {
          throw error;
        }

        // Convert other errors to permission errors where appropriate
        if (error instanceof Error) {
          if (error.message.includes('403') || error.message.includes('forbidden')) {
            throw createMissingPermissionError(resource, action, options.userId);
          }
        }

        throw error;
      }
    },
    retry: (failureCount, error) => {
      // Don't retry permission errors
      if (error instanceof PermissionError && !error.retryable) {
        return false;
      }
      return failureCount < 2;
    },
    ...mutationOptions
  });
};

// Query client configuration
export const createPermissionQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * 60 * 1000, // 2 minutes
        retry: (failureCount, error) => {
          // Don't retry permission errors
          if (error instanceof PermissionError && !error.retryable) {
            return false;
          }
          return failureCount < 3;
        },
        refetchOnWindowFocus: false,
        refetchOnReconnect: true
      },
      mutations: {
        retry: (failureCount, error) => {
          // Don't retry permission errors
          if (error instanceof PermissionError && !error.retryable) {
            return false;
          }
          return failureCount < 2;
        }
      }
    }
  });

  // Global error handler
  queryClient.setMutationDefaults(['permission-mutation'], {
    mutationFn: async () => {
      throw new Error('Not implemented');
    },
    onError: (error) => {
      handlePermissionError(error);
    }
  });

  return queryClient;
};

// Utility functions for query invalidation
export const invalidatePermissionQueries = (
  queryClient: QueryClient,
  resource: PermissionResource,
  userId?: string,
  campaignId?: string
) => {
  // Invalidate all queries for this resource
  queryClient.invalidateQueries({
    queryKey: permissionQueryKeys.resource(resource)
  });

  // Invalidate user-specific queries
  if (userId) {
    queryClient.invalidateQueries({
      queryKey: permissionQueryKeys.user(userId)
    });
  }

  // Invalidate campaign-specific queries
  if (campaignId) {
    queryClient.invalidateQueries({
      queryKey: permissionQueryKeys.campaign(campaignId)
    });
  }
};

// Prefetch utilities
export const prefetchPermissionQueries = async (
  queryClient: QueryClient,
  permissions: Array<{
    resource: PermissionResource;
    action: PermissionAction;
    userId?: string;
    campaignId?: string;
  }>
) => {
  const prefetchPromises = permissions.map(({ resource, action, userId, campaignId }) => {
    const queryKey = [
      'permission',
      resource,
      action,
      userId,
      undefined, // resourceId
      campaignId,
      undefined // context
    ];

    return queryClient.prefetchQuery({
      queryKey,
      queryFn: () => permissionAwareFetcher(
        { queryKey, signal: new AbortController().signal },
        (options) => mockFetchers.fetchContent(options)
      ),
      staleTime: 2 * 60 * 1000
    });
  });

  await Promise.all(prefetchPromises);
};

// Export for convenience
export default {
  permissionQueryKeys,
  usePermissionQuery,
  useUserQuery,
  useCharacterQuery,
  useMonsterQuery,
  useMapQuery,
  useCampaignQuery,
  usePermissionMutation,
  createPermissionQueryClient,
  invalidatePermissionQueries,
  prefetchPermissionQueries
};