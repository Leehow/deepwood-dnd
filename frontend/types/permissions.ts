/**
 * Permission and role type definitions for the frontend permission system
 */

// User roles in the application
export enum UserRole {
  PLAYER = 'player',
  DUNGEON_MASTER = 'dm',
  MODERATOR = 'moderator',
  ADMIN = 'admin',
}

// Resources that can be protected by permissions
export enum PermissionResource {
  CHARACTER = 'character',
  MONSTER = 'monster',
  MAP = 'map',
  NOTES = 'notes',
  SCENARIO = 'scenario',
  CAMPAIGN = 'campaign',
}

// Actions that can be performed on resources
export enum PermissionAction {
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete',
  MANAGE = 'manage',
}

// Optional conditions attached to a permission
export interface PermissionCondition {
  type: 'ownership' | 'campaign' | 'role';
  value?: any;
}

// Permission record
export interface Permission {
  id: string;
  name: string;
  resource: PermissionResource;
  action: PermissionAction;
  conditions?: PermissionCondition[];
}

// User profile (only fields needed by current code)
export interface UserProfile {
  displayName: string;
  preferences?: {
    theme?: 'dark' | 'light';
    sidebarCollapsed?: boolean;
    activePanel?: string;
    mapZoom?: number;
    autoSave?: boolean;
  };
  language?: string;
}

// Basic user type used in permission utilities
export interface User {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  permissions: Permission[];
  profile?: UserProfile;
}

export type { PermissionCondition as DefaultPermissionCondition };

