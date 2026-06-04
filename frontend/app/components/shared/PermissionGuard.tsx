/**
 * PermissionGuard component
 * Renders children only if user has required permissions
 * Provides fallback UI for unauthorized access
 */

import React from 'react';
import { usePermissions } from '../../../hooks/usePermissions';
import { PermissionResource, PermissionAction } from '../../../types/permissions';
import { Text, Callout, Button } from '@radix-ui/themes';

interface PermissionGuardProps {
  children: React.ReactNode;
  // Single permission requirement
  resource?: PermissionResource;
  action?: PermissionAction;
  // Multiple permission requirements
  permissions?: Array<{
    resource: PermissionResource;
    action: PermissionAction;
  }>;
  // Require all permissions (AND) or any permission (OR)
  requireAll?: boolean;
  // Context for permission checking
  context?: any;
  // Fallback UI when unauthorized
  fallback?: React.ReactNode;
  // Show error message when unauthorized
  showError?: boolean;
  // Error message customization
  errorMessage?: string;
  // Custom unauthorized action
  onUnauthorized?: () => void;
  // Loading state
  loadingComponent?: React.ReactNode;
  // User ID for permission checking (optional, defaults to current user)
  userId?: string;
  // Enable/disable permission checking (useful for development)
  bypass?: boolean;
}

type PermissionCheckResult = {
  hasPermission: boolean;
  isLoading: boolean;
  error: Error | null;
};

/**
 * Default unauthorized fallback component
 */
const DefaultUnauthorizedFallback: React.FC<{ message?: string; onAction?: () => void }> = ({
  message = 'You do not have permission to access this content.',
  onAction
}) => (
  <Callout.Root color="red" size="2">
    <Callout.Icon>
      <Text size="4">🔒</Text>
    </Callout.Icon>
    <Callout.Text>
      <Text size="3" weight="medium" color="red">
        Access Denied
      </Text>
      <Text size="2" color="gray" as="p">
        {message}
      </Text>
      {onAction && (
        <div style={{ marginTop: '8px' }}>
          <Button size="1" variant="soft" onClick={onAction}>
            Request Access
          </Button>
        </div>
      )}
    </Callout.Text>
  </Callout.Root>
);

/**
 * Default loading component
 */
const DefaultLoadingComponent: React.FC = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    minHeight: '100px'
  }}>
    <Text color="gray" size="2">
      Checking permissions...
    </Text>
  </div>
);

/**
 * Permission validation hook
 */
const usePermissionValidation = (
  resource: PermissionResource | undefined,
  action: PermissionAction | undefined,
  permissions: Array<{ resource: PermissionResource; action: PermissionAction }> | undefined,
  requireAll: boolean = true,
  context: any,
  userId?: string
): PermissionCheckResult => {
  const {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    isLoading,
    error
  } = usePermissions({ userId });

  if (isLoading) {
    return { hasPermission: false, isLoading: true, error: null };
  }

  if (error) {
    return { hasPermission: false, isLoading: false, error };
  }

  // Check single permission
  if (resource && action) {
    const hasRequiredPermission = hasPermission(resource, action, context);
    return { hasPermission: hasRequiredPermission, isLoading: false, error: null };
  }

  // Check multiple permissions
  if (permissions && permissions.length > 0) {
    const hasRequiredPermissions = requireAll
      ? hasAllPermissions(permissions)
      : hasAnyPermission(permissions);

    return { hasPermission: hasRequiredPermissions, isLoading: false, error: null };
  }

  // No permissions specified - allow access
  return { hasPermission: true, isLoading: false, error: null };
};

/**
 * Main PermissionGuard component
 */
export const PermissionGuard: React.FC<PermissionGuardProps> = ({
  children,
  resource,
  action,
  permissions,
  requireAll = true,
  context,
  fallback,
  showError = true,
  errorMessage,
  onUnauthorized,
  loadingComponent,
  userId,
  bypass = false
}) => {
  // Bypass for development or admin override
  if (bypass) {
    return <>{children}</>;
  }

  const { hasPermission, isLoading, error } = usePermissionValidation(
    resource,
    action,
    permissions,
    requireAll,
    context,
    userId
  );

  // Handle permission check errors
  if (error) {
    const errorFallback = fallback || (
      <Callout.Root color="red" size="2">
        <Callout.Icon>
          <Text size="4">⚠️</Text>
        </Callout.Icon>
        <Callout.Text>
          <Text size="3" weight="medium" color="red">
            Permission Check Failed
          </Text>
          <Text size="2" color="gray" as="p">
            Unable to verify permissions: {error.message}
          </Text>
        </Callout.Text>
      </Callout.Root>
    );

    return <>{errorFallback}</>;
  }

  // Show loading state
  if (isLoading) {
    const LoadingComponent = loadingComponent || <DefaultLoadingComponent />;
    return <>{LoadingComponent}</>;
  }

  // User has required permissions - render children
  if (hasPermission) {
    return <>{children}</>;
  }

  // User doesn't have permissions - show fallback
  if (onUnauthorized) {
    onUnauthorized();
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  // Show default unauthorized message
  if (showError) {
    return (
      <DefaultUnauthorizedFallback
        message={errorMessage}
        onAction={onUnauthorized}
      />
    );
  }

  // No fallback provided - render nothing
  return null;
};

/**
 * Higher-order component for permission-based route protection
 */
export const withPermissionGuard = <P extends object>(
  Component: React.ComponentType<P>,
  permissionProps: Omit<PermissionGuardProps, 'children'>
): React.FC<P> => {
  const WrappedComponent = (props: P) => (
    <PermissionGuard {...permissionProps}>
      <Component {...props} />
    </PermissionGuard>
  );

  WrappedComponent.displayName = `withPermissionGuard(${Component.displayName || Component.name})`;
  return WrappedComponent;
};

/**
 * Permission guard presets for common use cases
 */
export const DMOnlyGuard: React.FC<{ children: React.ReactNode; fallback?: React.ReactNode }> = ({
  children,
  fallback
}) => (
  <PermissionGuard
    permissions={[
      { resource: PermissionResource.MAP, action: PermissionAction.MANAGE }
    ]}
    fallback={fallback}
    errorMessage="This feature is only available to Dungeon Masters."
  >
    {children}
  </PermissionGuard>
);

export const PlayerOnlyGuard: React.FC<{ children: React.ReactNode; fallback?: React.ReactNode }> = ({
  children,
  fallback
}) => (
  <PermissionGuard
    permissions={[
      { resource: PermissionResource.CHARACTER, action: PermissionAction.READ }
    ]}
    fallback={fallback}
    errorMessage="This feature is only available to players."
  >
    {children}
  </PermissionGuard>
);

export const ContentOwnerGuard: React.FC<{
  children: React.ReactNode;
  ownerId: string;
  fallback?: React.ReactNode;
}> = ({ children, ownerId, fallback }) => (
  <PermissionGuard
    resource={PermissionResource.CHARACTER}
    action={PermissionAction.WRITE}
    context={{ ownerId, currentUserId: 'current-user' }}
    fallback={fallback}
    errorMessage="You can only edit your own content."
  >
    {children}
  </PermissionGuard>
);

export const CampaignMemberGuard: React.FC<{
  children: React.ReactNode;
  campaignId: string;
  fallback?: React.ReactNode;
}> = ({ children, campaignId, fallback }) => (
  <PermissionGuard
    permissions={[
      { resource: PermissionResource.MAP, action: PermissionAction.READ },
      { resource: PermissionResource.CHARACTER, action: PermissionAction.READ }
    ]}
    context={{ campaignId }}
    fallback={fallback}
    errorMessage="You must be a member of this campaign to access this content."
  >
    {children}
  </PermissionGuard>
);

// Export for convenience
export default PermissionGuard;