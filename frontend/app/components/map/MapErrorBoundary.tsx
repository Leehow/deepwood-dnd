/**
 * Specialized error boundary for TacticalMap that auto-recovers from Konva reconciliation errors.
 * These errors can occur during character switches due to react-konva internal state management.
 */

import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  mapKey: string; // Key to force re-render on recovery
  onError?: (error: Error) => void;
}

interface State {
  hasError: boolean;
  retryCount: number;
  isRecovering: boolean;
}

const MAX_RETRIES = 3;
const RECOVERY_DELAY = 200; // ms

export class MapErrorBoundary extends Component<Props, State> {
  private recoveryTimer: NodeJS.Timeout | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      retryCount: 0,
      isRecovering: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Only catch Konva-related errors
    if (error.message?.includes('getParent') || error.message?.includes('Konva')) {
      return { hasError: true, isRecovering: true };
    }
    // Re-throw other errors
    throw error;
  }

  componentDidCatch(error: Error) {
    console.warn('[MapErrorBoundary] Caught Konva error, attempting recovery:', error.message);
    this.props.onError?.(error);

    // Schedule auto-recovery
    if (this.state.retryCount < MAX_RETRIES) {
      this.scheduleRecovery();
    }
  }

  componentDidUpdate(prevProps: Props) {
    // Reset error state when mapKey changes (character switch completed)
    if (this.props.mapKey !== prevProps.mapKey && this.state.hasError) {
      this.reset();
    }
  }

  componentWillUnmount() {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
    }
  }

  private scheduleRecovery = () => {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
    }

    this.recoveryTimer = setTimeout(() => {
      this.setState((prev) => ({
        hasError: false,
        retryCount: prev.retryCount + 1,
        isRecovering: false,
      }));
    }, RECOVERY_DELAY);
  };

  private reset = () => {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
    }
    this.setState({
      hasError: false,
      retryCount: 0,
      isRecovering: false,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.state.retryCount >= MAX_RETRIES) {
        // Show error UI after max retries
        return (
          <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
            <div className="text-center">
              <div className="text-white text-lg mb-4">Map loading error</div>
              <button
                onClick={this.reset}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Retry
              </button>
            </div>
          </div>
        );
      }

      // Show loading during recovery
      return (
        <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
          <div className="text-white text-lg animate-pulse">Loading map...</div>
        </div>
      );
    }

    return this.props.children;
  }
}
