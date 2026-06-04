/**
 * Permission checking hook for role-based access control
 * Provides utilities to check user permissions against resources and actions
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  UserRole,
  PermissionAction,
  PermissionResource,
  Permission,
  User,
  PermissionCondition
} from '../types/permissions';

// Default role permissions mapping
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.PLAYER]: [
    {
      id: 'player-character-read',
      name: 'View Own Character',
      resource: PermissionResource.CHARACTER,
      action: PermissionAction.READ,
      conditions: [{ type: 'ownership', value: true }]
    },
    {
      id: 'player-character-write',
      name: 'Edit Own Character',
      resource: PermissionResource.CHARACTER,
      action: PermissionAction.WRITE,
      conditions: [{ type: 'ownership', value: true }]
    },
    {
      id: 'player-map-read',
      name: 'View Map',
      resource: PermissionResource.MAP,
      action: PermissionAction.READ
    },
    {
      id: 'player-notes-read',
      name: 'View Notes',
      resource: PermissionResource.NOTES,
      action: PermissionAction.READ
    },
    {
      id: 'player-notes-write',
      name: 'Edit Own Notes',
      resource: PermissionResource.NOTES,
      action: PermissionAction.WRITE,
      conditions: [{ type: 'ownership', value: true }]
    }
  ],
  [UserRole.DUNGEON_MASTER]: [
    {
      id: 'dm-character-manage',
      name: 'Manage All Characters',
      resource: PermissionResource.CHARACTER,
      action: PermissionAction.MANAGE
    },
    {
      id: 'dm-monster-manage',
      name: 'Manage Monsters',
      resource: PermissionResource.MONSTER,
      action: PermissionAction.MANAGE
    },
    {
      id: 'dm-map-manage',
      name: 'Manage Maps',
      resource: PermissionResource.MAP,
      action: PermissionAction.MANAGE
    },
    {
      id: 'dm-notes-manage',
      name: 'Manage All Notes',
      resource: PermissionResource.NOTES,
      action: PermissionAction.MANAGE
    },
    {
      id: 'dm-scenario-manage',
      name: 'Manage Scenarios',
      resource: PermissionResource.SCENARIO,
      action: PermissionAction.MANAGE
    },
    {
      id: 'dm-campaign-manage',
      name: 'Manage Campaign',
      resource: PermissionResource.CAMPAIGN,
      action: PermissionAction.MANAGE
    }
  ],
  [UserRole.MODERATOR]: [
    {
      id: 'mod-character-manage',
      name: 'Moderate Characters',
      resource: PermissionResource.CHARACTER,
      action: PermissionAction.MANAGE
    },
    {
      id: 'mod-monster-manage',
      name: 'Moderate Monsters',
      resource: PermissionResource.MONSTER,
      action: PermissionAction.MANAGE
    },
    {
      id: 'mod-map-manage',
      name: 'Moderate Maps',
      resource: PermissionResource.MAP,
      action: PermissionAction.MANAGE
    },
    {
      id: 'mod-notes-manage',
      name: 'Moderate Notes',
      resource: PermissionResource.NOTES,
      action: PermissionAction.MANAGE
    }
  ],
  [UserRole.ADMIN]: [
    {
      id: 'admin-all-manage',
      name: 'Full System Access',
      resource: PermissionResource.CHARACTER,
      action: PermissionAction.MANAGE
    },
    {
      id: 'admin-monster-manage',
      name: 'Full Monster Access',
      resource: PermissionResource.MONSTER,
      action: PermissionAction.MANAGE
    },
    {
      id: 'admin-map-manage',
      name: 'Full Map Access',
      resource: PermissionResource.MAP,
      action: PermissionAction.MANAGE
    },
    {
      id: 'admin-notes-manage',
      name: 'Full Notes Access',
      resource: PermissionResource.NOTES,
      action: PermissionAction.MANAGE
    },
    {
      id: 'admin-scenario-manage',
      name: 'Full Scenario Access',
      resource: PermissionResource.SCENARIO,
      action: PermissionAction.MANAGE
    },
    {
      id: 'admin-campaign-manage',
      name: 'Full Campaign Access',
      resource: PermissionResource.CAMPAIGN,
      action: PermissionAction.MANAGE
    }
  ]
};

// Mock API functions - replace with actual API calls
const fetchUserPermissions = async (userId: string): Promise<Permission[]> => {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 100));

  // Mock user - replace with actual authentication context
  const mockUser: User = {
    id: userId,
    username: 'user1',
    email: 'user1@example.com',
    role: UserRole.PLAYER,
    permissions: [],
    profile: {
      displayName: 'User One',
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

  return ROLE_PERMISSIONS[mockUser.role] || [];
};

interface UsePermissionsOptions {
  userId?: string;
  enableQuery?: boolean;
}

interface UsePermissionsResult {
  permissions: Permission[];
  isLoading: boolean;
  error: Error | null;
  hasPermission: (resource: PermissionResource, action: PermissionAction, context?: any) => boolean;
  hasAnyPermission: (permissions: Array<{resource: PermissionResource, action: PermissionAction}>) => boolean;
  hasAllPermissions: (permissions: Array<{resource: PermissionResource, action: PermissionAction}>) => boolean;
  getPermissionsForResource: (resource: PermissionResource) => Permission[];
  canRead: (resource: PermissionResource, context?: any) => boolean;
  canWrite: (resource: PermissionResource, context?: any) => boolean;
  canDelete: (resource: PermissionResource, context?: any) => boolean;
  canManage: (resource: PermissionResource, context?: any) => boolean;
}

export function usePermissions(options: UsePermissionsOptions = {}): UsePermissionsResult {
  const { userId = 'current-user', enableQuery = true } = options;

  const {
    data: permissions = [],
    isLoading,
    error
  } = useQuery({
    queryKey: ['user-permissions', userId],
    queryFn: () => fetchUserPermissions(userId),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: enableQuery && !!userId
  });

  // Check if permission conditions are satisfied
  const checkConditions = (permission: Permission, context?: any): boolean => {
    if (!permission.conditions || permission.conditions.length === 0) {
      return true;
    }

    return permission.conditions.every(condition => {
      switch (condition.type) {
        case 'ownership':
          return context?.ownerId === context?.currentUserId;
        case 'campaign':
          return context?.campaignId === condition.value;
        case 'role':
          return context?.userRole === condition.value;
        default:
          return true;
      }
    });
  };

  // Check if user has specific permission
  const hasPermission = (resource: PermissionResource, action: PermissionAction, context?: any): boolean => {
    return permissions.some(permission =>
      permission.resource === resource &&
      permission.action === action &&
      checkConditions(permission, context)
    );
  };

  // Check if user has any of the specified permissions
  const hasAnyPermission = (permissionChecks: Array<{resource: PermissionResource, action: PermissionAction}>): boolean => {
    return permissionChecks.some(({ resource, action }) => hasPermission(resource, action));
  };

  // Check if user has all of the specified permissions
  const hasAllPermissions = (permissionChecks: Array<{resource: PermissionResource, action: PermissionAction}>): boolean => {
    return permissionChecks.every(({ resource, action }) => hasPermission(resource, action));
  };

  // Get all permissions for a specific resource
  const getPermissionsForResource = (resource: PermissionResource): Permission[] => {
    return permissions.filter(permission => permission.resource === resource);
  };

  // Convenience methods for common actions
  const canRead = (resource: PermissionResource, context?: any) => hasPermission(resource, PermissionAction.READ, context);
  const canWrite = (resource: PermissionResource, context?: any) => hasPermission(resource, PermissionAction.WRITE, context);
  const canDelete = (resource: PermissionResource, context?: any) => hasPermission(resource, PermissionAction.DELETE, context);
  const canManage = (resource: PermissionResource, context?: any) => hasPermission(resource, PermissionAction.MANAGE, context);

  return {
    permissions,
    isLoading,
    error,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    getPermissionsForResource,
    canRead,
    canWrite,
    canDelete,
    canManage
  };
}

// Utility function to check permissions without hook (for use outside components)
export const checkPermission = (
  permissions: Permission[],
  resource: PermissionResource,
  action: PermissionAction,
  context?: any
): boolean => {
  const checkConditions = (permission: Permission, context?: any): boolean => {
    if (!permission.conditions || permission.conditions.length === 0) {
      return true;
    }

    return permission.conditions.every(condition => {
      switch (condition.type) {
        case 'ownership':
          return context?.ownerId === context?.currentUserId;
        case 'campaign':
          return context?.campaignId === condition.value;
        case 'role':
          return context?.userRole === condition.value;
        default:
          return true;
      }
    });
  };

  return permissions.some(permission =>
    permission.resource === resource &&
    permission.action === action &&
    checkConditions(permission, context)
  );
};

// Export permission constants for easy import
export { UserRole, PermissionAction, PermissionResource };