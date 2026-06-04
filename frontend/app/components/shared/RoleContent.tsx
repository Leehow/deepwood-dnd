/**
 * RoleContent component
 * Renders different content based on user role and permissions
 * Provides flexible role-based UI rendering
 */

import React, { useMemo } from 'react';
import { usePermissions } from '../../../hooks/usePermissions';
import { useRoleBasedContent } from '../../../hooks/useRoleBasedContent';
import { UserRole } from '../../../types/permissions';
import { Card, Tabs, Text, Badge } from '@radix-ui/themes';

interface RoleContentConfig<T = any> {
  role?: UserRole;
  permissions?: Array<{
    resource: string;
    action: string;
  }>;
  component: React.ComponentType<T>;
  props?: T;
  priority?: number;
}

interface RoleContentProps<T = any> {
  // Content configurations for different roles/permissions
  configs: RoleContentConfig<T>[];
  // Fallback content when no config matches
  fallback?: React.ReactNode;
  // Show role badge for debugging
  showRoleBadge?: boolean;
  // Custom wrapper component
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
  // Context for permission checking
  context?: any;
  // User ID for role checking
  userId?: string;
  // Campaign context
  campaignId?: string;
  // Custom matching logic
  customMatcher?: (config: RoleContentConfig<T>, userRole: UserRole, permissions: string[]) => boolean;
}

/**
 * Default fallback component
 */
const DefaultFallback: React.FC = () => (
  <Card size="2">
    <Text align="center" color="gray" size="3">
      No content available for your role or permissions.
    </Text>
  </Card>
);

/**
 * Role badge component for debugging
 */
const RoleBadge: React.FC<{ role: UserRole; permissions: string[] }> = ({ role, permissions }) => (
  <div style={{
    position: 'absolute',
    top: '8px',
    right: '8px',
    zIndex: 1000
  }}>
    <Badge color="blue" size="1">
      {role}
    </Badge>
    {permissions.length > 0 && (
      <Badge color="gray" size="1" style={{ marginLeft: '4px' }}>
        {permissions.length} perms
      </Badge>
    )}
  </div>
);

/**
 * Get effective role from permissions
 */
const getEffectiveRole = (permissions: string[]): UserRole => {
  // Simple role detection based on permission patterns
  if (permissions.some(p => p.includes('admin'))) {
    return UserRole.ADMIN;
  }
  if (permissions.some(p => p.includes('moderator'))) {
    return UserRole.MODERATOR;
  }
  if (permissions.some(p => p.includes('dm') || p.includes('dungeon_master'))) {
    return UserRole.DUNGEON_MASTER;
  }
  return UserRole.PLAYER;
};

/**
 * Main RoleContent component
 */
export const RoleContent = <T,>({
  configs,
  fallback = <DefaultFallback />,
  showRoleBadge = false,
  wrapper: Wrapper = React.Fragment,
  context,
  userId,
  campaignId,
  customMatcher
}: RoleContentProps<T>) => {
  const {
    permissions,
    isLoading: permissionsLoading,
    error: permissionsError,
    hasPermission
  } = usePermissions({ userId });

  const {
    filteredContent,
    isLoading: contentLoading
  } = useRoleBasedContent({
    userId,
    campaignId,
    enableQuery: !!campaignId
  });

  // Memoize permission strings for matching
  const permissionStrings = useMemo(() => {
    return permissions.map(p => `${p.resource}-${p.action}`);
  }, [permissions]);

  // Determine effective user role
  const effectiveRole = useMemo(() => {
    return getEffectiveRole(permissionStrings);
  }, [permissionStrings]);

  // Find matching configuration
  const matchingConfig = useMemo(() => {
    if (permissionsLoading || contentLoading || permissionsError) {
      return null;
    }

    // Sort configs by priority (higher priority first)
    const sortedConfigs = [...configs].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Find first matching config
    for (const config of sortedConfigs) {
      let isMatch = false;

      if (customMatcher) {
        // Use custom matching logic
        isMatch = customMatcher(config, effectiveRole, permissionStrings);
      } else {
        // Default matching logic
        if (config.role && config.role === effectiveRole) {
          isMatch = true;
        }

        if (config.permissions) {
          const hasAllRequiredPermissions = config.permissions.every(({ resource, action }) =>
            hasPermission(resource as any, action as any, context)
          );
          isMatch = hasAllRequiredPermissions;
        }

        if (config.role && config.permissions) {
          // Both role and permissions required
          const hasAllRequiredPermissions = config.permissions.every(({ resource, action }) =>
            hasPermission(resource as any, action as any, context)
          );
          isMatch = config.role === effectiveRole && hasAllRequiredPermissions;
        }
      }

      if (isMatch) {
        return config;
      }
    }

    return null;
  }, [
    configs,
    effectiveRole,
    permissionStrings,
    hasPermission,
    context,
    permissionsLoading,
    contentLoading,
    permissionsError,
    customMatcher
  ]);

  // Handle loading states
  if (permissionsLoading || contentLoading) {
    return (
      <Card size="2">
        <Text align="center" color="gray" size="3">
          Loading role-based content...
        </Text>
      </Card>
    );
  }

  // Handle error states
  if (permissionsError) {
    return (
      <Card size="2">
        <Text align="center" color="red" size="3">
          Error loading permissions: {permissionsError.message}
        </Text>
      </Card>
    );
  }

  // Render matching content
  if (matchingConfig) {
    const Component = matchingConfig.component;
    const props = matchingConfig.props || ({} as T);

    return (
      <Wrapper>
        {showRoleBadge && (
          <RoleBadge role={effectiveRole} permissions={permissionStrings} />
        )}
        {React.createElement(Component as any, props as any)}
      </Wrapper>
    );
  }

  // No matching config - render fallback
  return (
    <Wrapper>
      {showRoleBadge && (
        <RoleBadge role={effectiveRole} permissions={permissionStrings} />
      )}
      {fallback}
    </Wrapper>
  );
};

/**
 * Tab-based role content component
 */
export const RoleContentTabs: React.FC<{
  tabs: Array<{
    name: string;
    config: RoleContentConfig;
  }>;
  context?: any;
  userId?: string;
  campaignId?: string;
}> = ({ tabs, context, userId, campaignId }) => {
  const {
    permissions,
    isLoading,
    hasPermission
  } = usePermissions({ userId });

  const effectiveRole = getEffectiveRole(permissions.map(p => `${p.resource}-${p.action}`));

  // Filter tabs based on permissions
  const accessibleTabs = useMemo(() => {
    return tabs.filter(({ config }) => {
      if (config.role && config.role !== effectiveRole) {
        return false;
      }

      if (config.permissions) {
        return config.permissions.every(({ resource, action }) =>
          hasPermission(resource as any, action as any, context)
        );
      }

      return true;
    });
  }, [tabs, effectiveRole, hasPermission, context]);

  if (isLoading) {
    return (
      <Card size="2">
        <Text align="center" color="gray" size="3">
          Loading tabs...
        </Text>
      </Card>
    );
  }

  if (accessibleTabs.length === 0) {
    return <DefaultFallback />;
  }

  return (
    <Tabs.Root defaultValue={accessibleTabs[0].name}>
      <Tabs.List>
        {accessibleTabs.map((tab) => (
          <Tabs.Trigger key={tab.name} value={tab.name}>
            {tab.name}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {accessibleTabs.map((tab) => {
        const Component = tab.config.component;
        const props = tab.config.props || {};

        return (
          <Tabs.Content key={tab.name} value={tab.name} className="data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
            {React.createElement(Component as any, props as any)}
          </Tabs.Content>
        );
      })}
    </Tabs.Root>
  );
};

/**
 * Preset role content configurations for common use cases
 */

// Helper factories defined as functions to avoid TSX generic parsing issues
function presetDmOnly<T>(component: React.ComponentType<T>, props?: T): RoleContentConfig<T> {
  return { role: UserRole.DUNGEON_MASTER, component, props, priority: 10 };
}
function presetPlayerOnly<T>(component: React.ComponentType<T>, props?: T): RoleContentConfig<T> {
  return { role: UserRole.PLAYER, component, props, priority: 10 };
}
function presetAdminOnly<T>(component: React.ComponentType<T>, props?: T): RoleContentConfig<T> {
  return { role: UserRole.ADMIN, component, props, priority: 20 };
}
function presetWithPermissions<T>(
  component: React.ComponentType<T>,
  requiredPermissions: Array<{ resource: string; action: string }>,
  props?: T,
  priority?: number
): RoleContentConfig<T> {
  return { permissions: requiredPermissions, component, props, priority: priority || 5 };
}
function presetMultiRole<T>(
  component: React.ComponentType<T>,
  roles: UserRole[],
  props?: T
): RoleContentConfig<T>[] {
  return roles.map((role) => ({ role, component, props, priority: 10 }));
}

export const RoleContentPresets = {
  dmOnly: presetDmOnly,
  playerOnly: presetPlayerOnly,
  adminOnly: presetAdminOnly,
  withPermissions: presetWithPermissions,
  multiRole: presetMultiRole,
};

// Export for convenience
export default RoleContent;