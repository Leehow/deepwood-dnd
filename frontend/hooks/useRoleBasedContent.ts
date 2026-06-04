/**
 * Role-based content filtering hook
 * Provides utilities to filter and manage content based on user roles and permissions
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo, useCallback } from 'react';
import { UserRole, PermissionResource, PermissionAction, User } from '../types/permissions';
import { usePermissions } from './usePermissions';

// Content types that can be filtered by role
export interface RoleBasedContent<T = any> {
  id: string;
  type: string;
  data: T;
  permissions: {
    requiredRole?: UserRole;
    requiredPermissions?: Array<{
      resource: PermissionResource;
      action: PermissionAction;
    }>;
    owner?: string;
    visibility?: 'public' | 'private' | 'role' | 'campaign';
  };
  metadata?: {
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    tags?: string[];
  };
}

// Filter configuration
interface ContentFilterOptions {
  userId?: string;
  campaignId?: string;
  includePrivate?: boolean;
  includePublic?: boolean;
  contentTypes?: string[];
  tags?: string[];
  createdBy?: string;
}

// Mock API functions
const fetchRoleBasedContent = async (
  contentType: string,
  options: ContentFilterOptions = {}
): Promise<RoleBasedContent[]> => {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 150));

  // Mock data based on content type
  const mockData: Record<string, RoleBasedContent[]> = {
    characters: [
      {
        id: 'char-1',
        type: 'character',
        data: { name: 'Fighter', level: 5, class: 'Fighter' },
        permissions: {
          owner: 'user-1',
          visibility: 'private'
        },
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: 'user-1',
          tags: ['player', 'active']
        }
      },
      {
        id: 'char-2',
        type: 'character',
        data: { name: 'Wizard', level: 3, class: 'Wizard' },
        permissions: {
          owner: 'user-2',
          visibility: 'public'
        },
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: 'user-2',
          tags: ['player', 'active']
        }
      }
    ],
    monsters: [
      {
        id: 'monster-1',
        type: 'monster',
        data: { name: 'Goblin', cr: 0.25, hp: 7 },
        permissions: {
          requiredRole: UserRole.DUNGEON_MASTER
        },
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: 'dm-1',
          tags: ['low-level', 'common']
        }
      }
    ],
    maps: [
      {
        id: 'map-1',
        type: 'map',
        data: { name: 'Dungeon Entrance', gridSize: 40, width: 800, height: 600 },
        permissions: {
          visibility: 'campaign',
          requiredPermissions: [
            { resource: PermissionResource.MAP, action: PermissionAction.READ }
          ]
        },
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: 'dm-1',
          tags: ['dungeon', 'indoor']
        }
      }
    ],
    notes: [
      {
        id: 'note-1',
        type: 'note',
        data: { title: 'Session Notes', content: 'Players found the secret door...' },
        permissions: {
          owner: 'dm-1',
          visibility: 'private'
        },
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: 'dm-1',
          tags: ['session', 'dm-only']
        }
      }
    ]
  };

  return mockData[contentType] || [];
};

interface UseRoleBasedContentOptions extends ContentFilterOptions {
  contentType?: string;
  enableQuery?: boolean;
}

interface UseRoleBasedContentResult<T = any> {
  content: RoleBasedContent<T>[];
  isLoading: boolean;
  error: Error | null;
  filteredContent: RoleBasedContent<T>[];
  canViewContent: (content: RoleBasedContent<T>) => boolean;
  canEditContent: (content: RoleBasedContent<T>) => boolean;
  canDeleteContent: (content: RoleBasedContent<T>) => boolean;
  getContentById: (id: string) => RoleBasedContent<T> | undefined;
  getContentByOwner: (ownerId: string) => RoleBasedContent<T>[];
  getContentByTags: (tags: string[]) => RoleBasedContent<T>[];
  refreshContent: () => void;
}

export function useRoleBasedContent<T = any>(
  options: UseRoleBasedContentOptions = {}
): UseRoleBasedContentResult<T> {
  const {
    contentType = '',
    userId = 'current-user',
    campaignId = '',
    includePrivate = true,
    includePublic = true,
    contentTypes = [],
    tags = [],
    createdBy,
    enableQuery = true
  } = options;

  const {
    hasPermission,
    canRead,
    canWrite,
    canDelete,
    permissions: userPermissions
  } = usePermissions({ userId, enableQuery });

  // Fetch content based on type
  const {
    data: content = [],
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['role-based-content', contentType, userId, campaignId],
    queryFn: () => fetchRoleBasedContent(contentType, { userId, campaignId }),
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: enableQuery && !!contentType
  });

  // Filter content based on permissions and options
  const filteredContent = useMemo(() => {
    return content.filter(item => {
      // Filter by content types if specified
      if (contentTypes.length > 0 && !contentTypes.includes(item.type)) {
        return false;
      }

      // Filter by creator if specified
      if (createdBy && item.metadata?.createdBy !== createdBy) {
        return false;
      }

      // Filter by tags if specified
      if (tags.length > 0) {
        const itemTags = item.metadata?.tags || [];
        if (!tags.some(tag => itemTags.includes(tag))) {
          return false;
        }
      }

      // Check visibility permissions
      const { visibility, requiredRole, requiredPermissions, owner } = item.permissions;

      // Check role requirement
      if (requiredRole) {
        // This would need access to user role - for now assume basic check
        // In a real implementation, you'd get the user's role from auth context
        return true; // Simplified for demo
      }

      // Check specific permission requirements
      if (requiredPermissions && requiredPermissions.length > 0) {
        const hasAllRequiredPermissions = requiredPermissions.every(
          ({ resource, action }) => hasPermission(resource, action, {
            ownerId: owner,
            currentUserId: userId,
            campaignId
          })
        );
        if (!hasAllRequiredPermissions) {
          return false;
        }
      }

      // Check visibility
      switch (visibility) {
        case 'private':
          return includePrivate && owner === userId;
        case 'public':
          return includePublic;
        case 'campaign':
          return campaignId !== ''; // User must be in a campaign
        case 'role':
          return true; // Role-based visibility would need user role
        default:
          return includePublic;
      }
    });
  }, [content, contentTypes, createdBy, tags, includePrivate, includePublic, userId, campaignId, hasPermission]);

  // Check if user can view specific content
  const canViewContent = useCallback((contentItem: RoleBasedContent<T>): boolean => {
    const { visibility, requiredRole, requiredPermissions, owner } = contentItem.permissions;

    // Check if user is the owner
    if (owner === userId) {
      return true;
    }

    // Check role requirement
    if (requiredRole) {
      // This would need access to user role from auth context
      return true; // Simplified for demo
    }

    // Check specific permission requirements
    if (requiredPermissions && requiredPermissions.length > 0) {
      return requiredPermissions.some(({ resource, action }) =>
        canRead(resource, { ownerId: owner, currentUserId: userId, campaignId })
      );
    }

    // Check visibility
    switch (visibility) {
      case 'private':
        return owner === userId;
      case 'public':
        return true;
      case 'campaign':
        return campaignId !== '';
      case 'role':
        return true; // Role-based visibility
      default:
        return true;
    }
  }, [userId, campaignId, canRead]);

  // Check if user can edit specific content
  const canEditContent = useCallback((contentItem: RoleBasedContent<T>): boolean => {
    const { owner, requiredPermissions } = contentItem.permissions;

    // Owners can always edit their content
    if (owner === userId) {
      return true;
    }

    // Check write permissions
    if (requiredPermissions && requiredPermissions.length > 0) {
      return requiredPermissions.some(({ resource, action }) =>
        canWrite(resource, { ownerId: owner, currentUserId: userId, campaignId })
      );
    }

    return false;
  }, [userId, campaignId, canWrite]);

  // Check if user can delete specific content
  const canDeleteContent = useCallback((contentItem: RoleBasedContent<T>): boolean => {
    const { owner, requiredPermissions } = contentItem.permissions;

    // Owners can always delete their content
    if (owner === userId) {
      return true;
    }

    // Check delete permissions
    if (requiredPermissions && requiredPermissions.length > 0) {
      return requiredPermissions.some(({ resource, action }) =>
        canDelete(resource, { ownerId: owner, currentUserId: userId, campaignId })
      );
    }

    return false;
  }, [userId, campaignId, canDelete]);

  // Get content by ID
  const getContentById = useCallback((id: string): RoleBasedContent<T> | undefined => {
    return filteredContent.find(item => item.id === id);
  }, [filteredContent]);

  // Get content by owner
  const getContentByOwner = useCallback((ownerId: string): RoleBasedContent<T>[] => {
    return filteredContent.filter(item => item.permissions.owner === ownerId);
  }, [filteredContent]);

  // Get content by tags
  const getContentByTags = useCallback((searchTags: string[]): RoleBasedContent<T>[] => {
    return filteredContent.filter(item => {
      const itemTags = item.metadata?.tags || [];
      return searchTags.some(tag => itemTags.includes(tag));
    });
  }, [filteredContent]);

  // Refresh content
  const refreshContent = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    content,
    isLoading,
    error,
    filteredContent,
    canViewContent,
    canEditContent,
    canDeleteContent,
    getContentById,
    getContentByOwner,
    getContentByTags,
    refreshContent
  };
}

// Utility function to create role-based content
export const createRoleBasedContent = <T>(
  id: string,
  type: string,
  data: T,
  permissions: RoleBasedContent<T>['permissions'],
  metadata?: Partial<RoleBasedContent<T>['metadata']>
): RoleBasedContent<T> => {
  return {
    id,
    type,
    data,
    permissions,
    metadata: {
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'current-user', // This would come from auth context
      ...metadata
    }
  };
};

// Export types for external use
export type { ContentFilterOptions, UseRoleBasedContentOptions, UseRoleBasedContentResult };