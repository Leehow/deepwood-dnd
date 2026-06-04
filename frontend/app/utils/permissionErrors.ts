/**
 * Permission error handling utilities
 * Provides centralized error handling for permission violations
 */

import { PermissionResource, PermissionAction, UserRole } from '../../types/permissions';
import React from "react";
import { createLogger } from '~/utils/logger';
const logger = createLogger('permissionErrors');



// Error types
export enum PermissionErrorType {
  INSUFFICIENT_ROLE = 'INSUFFICIENT_ROLE',
  MISSING_PERMISSION = 'MISSING_PERMISSION',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  OWNERSHIP_REQUIRED = 'OWNERSHIP_REQUIRED',
  CAMPAIGN_ACCESS_DENIED = 'CAMPAIGN_ACCESS_DENIED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  SUSPENDED_USER = 'SUSPENDED_USER',
  SYSTEM_ERROR = 'SYSTEM_ERROR'
}

// Permission error class
export class PermissionError extends Error {
  public readonly type: PermissionErrorType;
  public readonly resource?: PermissionResource;
  public readonly action?: PermissionAction;
  public readonly requiredRole?: UserRole;
  public readonly userId?: string;
  public readonly resourceId?: string;
  public readonly context?: any;
  public readonly timestamp: Date;
  public readonly retryable: boolean;

  constructor({
    type,
    message,
    resource,
    action,
    requiredRole,
    userId,
    resourceId,
    context,
    retryable = false
  }: {
    type: PermissionErrorType;
    message?: string;
    resource?: PermissionResource;
    action?: PermissionAction;
    requiredRole?: UserRole;
    userId?: string;
    resourceId?: string;
    context?: any;
    retryable?: boolean;
  }) {
    super(message || getDefaultErrorMessage(type));
    this.name = 'PermissionError';
    this.type = type;
    this.resource = resource;
    this.action = action;
    this.requiredRole = requiredRole;
    this.userId = userId;
    this.resourceId = resourceId;
    this.context = context;
    this.timestamp = new Date();
    this.retryable = retryable;
  }
}

// Default error messages
const getDefaultErrorMessage = (type: PermissionErrorType): string => {
  switch (type) {
    case PermissionErrorType.INSUFFICIENT_ROLE:
      return 'Your role does not have sufficient privileges for this action.';
    case PermissionErrorType.MISSING_PERMISSION:
      return 'You do not have the required permissions for this action.';
    case PermissionErrorType.RESOURCE_NOT_FOUND:
      return 'The requested resource was not found or you do not have access to it.';
    case PermissionErrorType.OWNERSHIP_REQUIRED:
      return 'You can only perform this action on your own content.';
    case PermissionErrorType.CAMPAIGN_ACCESS_DENIED:
      return 'You do not have access to this campaign.';
    case PermissionErrorType.QUOTA_EXCEEDED:
      return 'You have exceeded your quota for this resource type.';
    case PermissionErrorType.SUSPENDED_USER:
      return 'Your account has been suspended. Please contact support.';
    case PermissionErrorType.SYSTEM_ERROR:
      return 'A system error occurred while checking permissions.';
    default:
      return 'An unknown permission error occurred.';
  }
};

// Error creation utilities
export const createInsufficientRoleError = (
  requiredRole: UserRole,
  currentRole: UserRole,
  resource?: PermissionResource,
  action?: PermissionAction
): PermissionError => {
  return new PermissionError({
    type: PermissionErrorType.INSUFFICIENT_ROLE,
    message: `This action requires ${requiredRole} role or higher. Your current role is ${currentRole}.`,
    resource,
    action,
    requiredRole,
    context: { currentRole }
  });
};

export const createMissingPermissionError = (
  resource: PermissionResource,
  action: PermissionAction,
  userId?: string,
  resourceId?: string
): PermissionError => {
  return new PermissionError({
    type: PermissionErrorType.MISSING_PERMISSION,
    message: `You need ${action} permission on ${resource} to perform this action.`,
    resource,
    action,
    userId,
    resourceId
  });
};

export const createOwnershipError = (
  resource: PermissionResource,
  action: PermissionAction,
  userId: string,
  resourceId: string
): PermissionError => {
  return new PermissionError({
    type: PermissionErrorType.OWNERSHIP_REQUIRED,
    message: `You can only ${action} your own ${resource}.`,
    resource,
    action,
    userId,
    resourceId
  });
};

export const createCampaignAccessError = (
  campaignId: string,
  userId?: string
): PermissionError => {
  return new PermissionError({
    type: PermissionErrorType.CAMPAIGN_ACCESS_DENIED,
    message: `You do not have access to campaign ${campaignId}.`,
    userId,
    context: { campaignId }
  });
};

export const createResourceNotFoundError = (
  resource: PermissionResource,
  resourceId: string,
  userId?: string
): PermissionError => {
  return new PermissionError({
    type: PermissionErrorType.RESOURCE_NOT_FOUND,
    message: `The ${resource} with ID ${resourceId} was not found or you do not have access to it.`,
    resource,
    resourceId,
    userId,
    retryable: false
  });
};

// Error logging interface
export interface PermissionErrorLogger {
  logError: (error: PermissionError, context?: any) => void;
  logWarning: (message: string, context?: any) => void;
  logInfo: (message: string, context?: any) => void;
}

// Default console logger
export const consolePermissionLogger: PermissionErrorLogger = {
  logError: (error: PermissionError, context?: any) => {
    logger.error(`[Permission Error] ${error.type}: ${error.message}`, {
      error: {
        type: error.type,
        resource: error.resource,
        action: error.action,
        userId: error.userId,
        resourceId: error.resourceId,
        timestamp: error.timestamp,
        retryable: error.retryable
      },
      context
    });
  },

  logWarning: (message: string, context?: any) => {
    logger.warn(`[Permission Warning] ${message}`, context);
  },

  logInfo: (message: string, context?: any) => {
    console.info(`[Permission Info] ${message}`, context);
  }
};

// Error handler class
export class PermissionErrorHandler {
  private logger: PermissionErrorLogger;
  private errorCallbacks: Map<PermissionErrorType, Array<(error: PermissionError) => void>>;
  private telemetryEnabled: boolean;

  constructor(logger: PermissionErrorLogger = consolePermissionLogger) {
    this.logger = logger;
    this.errorCallbacks = new Map();
    this.telemetryEnabled = true;
  }

  // Handle permission errors
  handleError(error: PermissionError, context?: any): void {
    // Log the error
    this.logger.logError(error, context);

    // Send telemetry if enabled
    if (this.telemetryEnabled) {
      this.sendTelemetry(error, context);
    }

    // Execute registered callbacks
    const callbacks = this.errorCallbacks.get(error.type) || [];
    callbacks.forEach(callback => {
      try {
        callback(error);
      } catch (callbackError) {
        this.logger.logError(
          new PermissionError({
            type: PermissionErrorType.SYSTEM_ERROR,
            message: 'Error in permission error callback'
          }),
          { callbackError }
        );
      }
    });
  }

  // Register error callback
  registerErrorCallback(
    errorType: PermissionErrorType,
    callback: (error: PermissionError) => void
  ): void {
    const callbacks = this.errorCallbacks.get(errorType) || [];
    callbacks.push(callback);
    this.errorCallbacks.set(errorType, callbacks);
  }

  // Unregister error callback
  unregisterErrorCallback(
    errorType: PermissionErrorType,
    callback: (error: PermissionError) => void
  ): void {
    const callbacks = this.errorCallbacks.get(errorType) || [];
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
      this.errorCallbacks.set(errorType, callbacks);
    }
  }

  // Enable/disable telemetry
  setTelemetryEnabled(enabled: boolean): void {
    this.telemetryEnabled = enabled;
  }

  // Send telemetry data
  private sendTelemetry(error: PermissionError, context?: any): void {
    // In a real implementation, this would send to analytics service
    this.logger.logInfo('Permission error telemetry sent', {
      errorType: error.type,
      resource: error.resource,
      action: error.action,
      userId: error.userId,
      timestamp: error.timestamp,
      context
    });
  }
}

// Global error handler instance
export const globalPermissionErrorHandler = new PermissionErrorHandler();

// Error handling utilities
export const handlePermissionError = (
  error: unknown,
  context?: any,
  customHandler?: PermissionErrorHandler
): PermissionError | null => {
  const handler = customHandler || globalPermissionErrorHandler;

  if (error instanceof PermissionError) {
    handler.handleError(error, context);
    return error;
  }

  // Handle other error types
  if (error instanceof Error) {
    const permissionError = new PermissionError({
      type: PermissionErrorType.SYSTEM_ERROR,
      message: `Unexpected error during permission check: ${error.message}`,
      context: { originalError: error }
    });
    handler.handleError(permissionError, context);
    return permissionError;
  }

  // Handle unknown errors
  const permissionError = new PermissionError({
    type: PermissionErrorType.SYSTEM_ERROR,
    message: 'Unknown error during permission check',
    context: { originalError: error }
  });
  handler.handleError(permissionError, context);
  return permissionError;
};

// React error boundary for permission errors
export interface PermissionErrorBoundaryState {
  hasError: boolean;
  error?: PermissionError;
}

export const withPermissionErrorBoundary = <P extends object>(
  Component: React.ComponentType<P>,
  fallback?: React.ComponentType<{ error: PermissionError; retry: () => void }>
): React.ComponentType<P> => {
  return class PermissionErrorBoundary extends React.Component<P, PermissionErrorBoundaryState> {
    constructor(props: P) {
      super(props);
      this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): PermissionErrorBoundaryState {
      if (error instanceof PermissionError) {
        return { hasError: true, error };
      }
      return {
        hasError: true,
        error: new PermissionError({
          type: PermissionErrorType.SYSTEM_ERROR,
          message: error.message
        })
      };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
      handlePermissionError(error, errorInfo);
    }

    retry = () => {
      this.setState({ hasError: false, error: undefined });
    };

    render() {
      if (this.state.hasError && this.state.error) {
        if (fallback) {
          const FallbackComponent = fallback;
          return React.createElement(FallbackComponent, { error: this.state.error, retry: this.retry });
        }

        return React.createElement(
          'div',
          { style: { padding: '20px', textAlign: 'center' } as React.CSSProperties },
          React.createElement('h3', null, 'Permission Error'),
          React.createElement('p', null, this.state.error.message),
          React.createElement('button', { onClick: this.retry }, 'Retry'),
        );
      }

      return React.createElement(Component as any, this.props as any);
    }
  };
};

// Export for convenience
export default {
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
  withPermissionErrorBoundary
};