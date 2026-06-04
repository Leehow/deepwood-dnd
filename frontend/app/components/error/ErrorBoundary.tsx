/**
 * Error boundary component for graceful error handling.
 * Catches JavaScript errors and displays fallback UI.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetKeys?: any[];
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });

    // Call custom error handler
    this.props.onError?.(error, errorInfo);

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    // Report to error tracking service
    this.reportError(error, errorInfo);
  }

  componentDidUpdate(prevProps: Props) {
    // Reset error state when resetKeys change
    if (this.state.hasError && this.props.resetKeys) {
      const hasChanged = this.props.resetKeys.some(
        (key, index) => key !== prevProps.resetKeys?.[index]
      );
      if (hasChanged) {
        this.reset();
      }
    }
  }

  reset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  private async reportError(error: Error, errorInfo: ErrorInfo) {
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8174';

      await fetch(`${API_BASE_URL}/api/optimization/errors/recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error_type: error.name,
          component: errorInfo.componentStack?.split('\n')[1]?.trim() || 'Unknown',
          context: {
            message: error.message,
            stack: error.stack,
            componentStack: errorInfo.componentStack,
          },
        }),
      });
    } catch {
      // Silently fail - don't crash on error reporting
    }
  }

  render() {
    if (this.state.hasError) {
      // Render custom fallback or default error UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 bg-red-50 rounded-lg border border-red-200">
          <div className="text-red-600 text-lg font-semibold mb-2">
            Something went wrong
          </div>
          <div className="text-red-500 text-sm mb-4">
            {this.state.error?.message || 'An unexpected error occurred'}
          </div>
          <button
            onClick={this.reset}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Try Again
          </button>
          {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
            <details className="mt-4 text-xs text-gray-600 max-w-full overflow-auto">
              <summary className="cursor-pointer">Stack trace</summary>
              <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-x-auto">
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * HOC to wrap components with error boundary.
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode
) {
  return function WrappedComponent(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}

/**
 * Hook-friendly error boundary using render props.
 */
interface ErrorBoundaryRenderProps {
  children: (props: { reset: () => void }) => ReactNode;
  fallback: (props: { error: Error; reset: () => void }) => ReactNode;
}

export function ErrorBoundaryWithReset({ children, fallback }: ErrorBoundaryRenderProps) {
  return (
    <ErrorBoundary
      fallback={
        <ErrorBoundaryFallback fallback={fallback} />
      }
    >
      {children({ reset: () => {} })}
    </ErrorBoundary>
  );
}

// Helper component for fallback with reset
class ErrorBoundaryFallback extends Component<{
  fallback: (props: { error: Error; reset: () => void }) => ReactNode;
}> {
  render() {
    // This will be rendered when parent ErrorBoundary catches an error
    return null;
  }
}