/**
 * PermissionExample component
 * Demonstrates comprehensive usage of the permission system
 * Shows integration of hooks, components, and error handling
 */

import React from 'react';
import { Card, Grid, Button, Text, Heading, Tabs, Callout } from '@radix-ui/themes';
import PermissionGuard from './PermissionGuard';
import RoleContent from './RoleContent';
import { usePermissions } from '../../../hooks/usePermissions';
import { useRoleBasedContent } from '../../../hooks/useRoleBasedContent';
import { PermissionResource, PermissionAction, UserRole } from '../../../types/permissions';
import { createLogger } from '~/utils/logger';
import {
  PermissionErrorType,
  globalPermissionErrorHandler,
  handlePermissionError,
} from '../../utils';

const logger = createLogger('PermissionExample');

// Example components for different roles
const PlayerDashboard: React.FC = () => (
  <Card size="2">
    <Heading size="4">Player Dashboard</Heading>
    <Text as="p">Welcome, player! Here you can manage your characters and view campaign information.</Text>
    <div style={{ marginTop: '16px' }}>
      <Button size="2">View Character Sheet</Button>
      <Button size="2" variant="soft" style={{ marginLeft: '8px' }}>Roll Dice</Button>
    </div>
  </Card>
);

const DMDashboard: React.FC = () => (
  <Card size="2">
    <Heading size="4">Dungeon Master Dashboard</Heading>
    <Text as="p">Welcome, DM! You have full control over the campaign and all game elements.</Text>
    <div style={{ marginTop: '16px' }}>
      <Button size="2">Manage Campaign</Button>
      <Button size="2" variant="soft" style={{ marginLeft: '8px' }}>Add Monster</Button>
      <Button size="2" variant="outline" style={{ marginLeft: '8px' }}>Edit Map</Button>
    </div>
  </Card>
);

const AdminPanel: React.FC = () => (
  <Card size="2">
    <Heading size="4">Admin Panel</Heading>
    <Text as="p">System administration and user management tools.</Text>
    <div style={{ marginTop: '16px' }}>
      <Button size="2" color="red">Manage Users</Button>
      <Button size="2" variant="soft" style={{ marginLeft: '8px' }}>System Settings</Button>
    </div>
  </Card>
);

const MonsterManagement: React.FC = () => (
  <Card size="2">
    <Heading size="4">Monster Management</Heading>
    <Text as="p">Add, edit, and manage monsters for your campaign.</Text>
    <div style={{ marginTop: '16px' }}>
      <Button size="2">Add New Monster</Button>
      <Button size="2" variant="soft" style={{ marginLeft: '8px' }}>Import Bestiary</Button>
    </div>
  </Card>
);

const CharacterSheet: React.FC<{ editable?: boolean }> = ({ editable = false }) => (
  <Card size="2">
    <Heading size="4">Character Sheet</Heading>
    <Text as="p">
      {editable ? 'Edit your character details, stats, and abilities.' : 'View your character information.'}
    </Text>
    <div style={{ marginTop: '16px' }}>
      <Button size="2" disabled={!editable}>
        {editable ? 'Save Changes' : 'View Character'}
      </Button>
    </div>
  </Card>
);

/**
 * Main PermissionExample component
 */
export const PermissionExample: React.FC = () => {
  const {
    permissions,
    isLoading: permissionsLoading,
    hasPermission,
    canRead,
    canWrite,
    canManage,
    error: permissionsError
  } = usePermissions();

  const {
    filteredContent,
    isLoading: contentLoading,
    canViewContent,
    canEditContent
  } = useRoleBasedContent({
    contentType: 'characters',
    includePrivate: true,
    includePublic: true
  });

  // Demonstrate error handling
  const handlePermissionTest = () => {
    try {
      // Simulate a permission check that might fail
      if (!hasPermission(PermissionResource.MONSTER, PermissionAction.MANAGE)) {
        throw new Error('User does not have monster management permissions');
      }
    } catch (error) {
      handlePermissionError(error, { component: 'PermissionExample', action: 'permissionTest' });
    }
  };

  // Register error callbacks for demonstration
  React.useEffect(() => {
    const handleInsufficientRole = (error: any) => {
      logger.debug('Insufficient role error handled:', error.type);
    };

    const handleMissingPermission = (error: any) => {
      logger.debug('Missing permission error handled:', error.type);
    };

    // Register callbacks
    globalPermissionErrorHandler.registerErrorCallback(
      PermissionErrorType.INSUFFICIENT_ROLE,
      handleInsufficientRole
    );
    globalPermissionErrorHandler.registerErrorCallback(
      PermissionErrorType.MISSING_PERMISSION,
      handleMissingPermission
    );

    // Cleanup
    return () => {
      globalPermissionErrorHandler.unregisterErrorCallback(
        PermissionErrorType.INSUFFICIENT_ROLE,
        handleInsufficientRole
      );
      globalPermissionErrorHandler.unregisterErrorCallback(
        PermissionErrorType.MISSING_PERMISSION,
        handleMissingPermission
      );
    };
  }, []);

  if (permissionsLoading || contentLoading) {
    return (
      <Card size="3">
        <Text align="center" size="3">Loading permission system...</Text>
      </Card>
    );
  }

  if (permissionsError) {
    return (
      <Callout.Root color="red" size="2">
        <Callout.Icon>
          <Text size="4">⚠️</Text>
        </Callout.Icon>
        <Callout.Text>
          <Text weight="medium" color="red">Permission Error</Text>
          <Text as="p">{permissionsError.message}</Text>
        </Callout.Text>
      </Callout.Root>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <Heading size="6" mb="6">Permission System Demonstration</Heading>

      <Tabs.Root defaultValue="overview">
        <Tabs.List>
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="role-content">Role-Based Content</Tabs.Trigger>
          <Tabs.Trigger value="permission-guards">Permission Guards</Tabs.Trigger>
          <Tabs.Trigger value="error-handling">Error Handling</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview">
          <Grid columns="2" gap="4" mt="4">
            <Card size="2">
              <Heading size="4">Permission Status</Heading>
              <Text as="p">
                <strong>Total Permissions:</strong> {permissions.length}
              </Text>
              <Text as="p">
                <strong>Can Read Characters:</strong> {canRead(PermissionResource.CHARACTER) ? 'Yes' : 'No'}
              </Text>
              <Text as="p">
                <strong>Can Write Characters:</strong> {canWrite(PermissionResource.CHARACTER) ? 'Yes' : 'No'}
              </Text>
              <Text as="p">
                <strong>Can Manage Maps:</strong> {canManage(PermissionResource.MAP) ? 'Yes' : 'No'}
              </Text>
            </Card>

            <Card size="2">
              <Heading size="4">Content Access</Heading>
              <Text as="p">
                <strong>Accessible Characters:</strong> {filteredContent.length}
              </Text>
              <Text as="p">
                <strong>Content Loading:</strong> {contentLoading ? 'Yes' : 'No'}
              </Text>
              <Button size="2" onClick={handlePermissionTest} mt="3">
                Test Permission Error
              </Button>
            </Card>
          </Grid>
        </Tabs.Content>

        <Tabs.Content value="role-content">
          <div className="mt-4">
            <Heading size="4" mb="4">Role-Based Content Rendering</Heading>
            <RoleContent
              configs={[
                {
                  role: UserRole.PLAYER,
                  component: PlayerDashboard,
                  priority: 1
                },
                {
                  role: UserRole.DUNGEON_MASTER,
                  component: DMDashboard,
                  priority: 10
                },
                {
                  role: UserRole.ADMIN,
                  component: AdminPanel,
                  priority: 20
                }
              ]}
              showRoleBadge={true}
            />
          </div>
        </Tabs.Content>

        <Tabs.Content value="permission-guards">
          <div className="mt-4">
            <Heading size="4" mb="4">Permission Guard Examples</Heading>
            <Grid columns="2" gap="4">
              <PermissionGuard
                resource={PermissionResource.CHARACTER}
                action={PermissionAction.READ}
                fallback={
                  <Card size="2">
                    <Text color="gray">You don't have permission to view characters.</Text>
                  </Card>
                }
              >
                <CharacterSheet editable={false} />
              </PermissionGuard>

              <PermissionGuard
                resource={PermissionResource.CHARACTER}
                action={PermissionAction.WRITE}
                fallback={
                  <Card size="2">
                    <Text color="gray">You don't have permission to edit characters.</Text>
                  </Card>
                }
              >
                <CharacterSheet editable={true} />
              </PermissionGuard>

              <PermissionGuard
                resource={PermissionResource.MONSTER}
                action={PermissionAction.MANAGE}
                fallback={
                  <Card size="2">
                    <Text color="gray">You don't have permission to manage monsters.</Text>
                  </Card>
                }
              >
                <MonsterManagement />
              </PermissionGuard>

              <PermissionGuard
                permissions={[
                  { resource: PermissionResource.MAP, action: PermissionAction.READ },
                  { resource: PermissionResource.CHARACTER, action: PermissionAction.READ }
                ]}
                requireAll={true}
                fallback={
                  <Card size="2">
                    <Text color="gray">You need both map and character read permissions.</Text>
                  </Card>
                }
              >
                <Card size="2">
                  <Heading size="4">Combined Permissions Content</Heading>
                  <Text>This content requires multiple permissions to access.</Text>
                </Card>
              </PermissionGuard>
            </Grid>
          </div>
        </Tabs.Content>

        <Tabs.Content value="error-handling">
          <div className="mt-4">
            <Heading size="4" mb="4">Error Handling Demonstration</Heading>
            <Grid columns="2" gap="4">
              <Card size="2">
                <Heading size="5">Permission Error Types</Heading>
                <Text as="p" size="2" mb="2">
                  • INSUFFICIENT_ROLE - User role too low
                </Text>
                <Text as="p" size="2" mb="2">
                  • MISSING_PERMISSION - Required permission missing
                </Text>
                <Text as="p" size="2" mb="2">
                  • OWNERSHIP_REQUIRED - Must own the resource
                </Text>
                <Text as="p" size="2" mb="2">
                  • CAMPAIGN_ACCESS_DENIED - Not in campaign
                </Text>
                <Text as="p" size="2">
                  • SYSTEM_ERROR - Internal error occurred
                </Text>
              </Card>

              <Card size="2">
                <Heading size="5">Error Handling Features</Heading>
                <Text as="p" size="2" mb="2">
                  • Automatic error logging
                </Text>
                <Text as="p" size="2" mb="2">
                  • Custom error callbacks
                </Text>
                <Text as="p" size="2" mb="2">
                  • Telemetry integration
                </Text>
                <Text as="p" size="2" mb="2">
                  • React error boundaries
                </Text>
                <Button size="2" onClick={handlePermissionTest} mt="3">
                  Trigger Test Error
                </Button>
              </Card>
            </Grid>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
};

export default PermissionExample;