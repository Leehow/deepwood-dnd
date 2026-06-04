/**
 * Utility exports for permission system
 * Centralized export point for all permission-related utilities
 */

// Error handling
export {
  PermissionError,
  PermissionErrorType,
  PermissionErrorHandler,
  globalPermissionErrorHandler,
  handlePermissionError,
  createInsufficientRoleError,
  createMissingPermissionError,
  createOwnershipError,
  createCampaignAccessError,
  createResourceNotFoundError,
  withPermissionErrorBoundary,
  consolePermissionLogger
} from './permissionErrors';

// Query utilities
export {
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
} from './permissionQuery';

// Types
export type { PermissionErrorLogger, PermissionErrorBoundaryState } from './permissionErrors';
export type { PermissionFetchOptions } from './permissionQuery';