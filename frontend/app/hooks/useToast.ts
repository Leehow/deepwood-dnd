/**
 * Toast notification system for user-friendly messages.
 */

import { useState, useCallback, createContext, useContext } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => string;
  removeToast: (id: string) => void;
  success: (title: string, message?: string) => string;
  error: (title: string, message?: string) => string;
  warning: (title: string, message?: string) => string;
  info: (title: string, message?: string) => string;
}

// Create context
const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Hook to use toast notifications.
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

/**
 * Toast provider hook - use in ToastProvider component.
 */
export function useToastState() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substr(2, 9);
    const newToast: Toast = { ...toast, id };

    setToasts(prev => [...prev, newToast]);

    // Auto-remove after duration
    const duration = toast.duration ?? 5000;
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const success = useCallback((title: string, message?: string) => {
    return addToast({ type: 'success', title, message });
  }, [addToast]);

  const error = useCallback((title: string, message?: string) => {
    return addToast({ type: 'error', title, message, duration: 8000 });
  }, [addToast]);

  const warning = useCallback((title: string, message?: string) => {
    return addToast({ type: 'warning', title, message });
  }, [addToast]);

  const info = useCallback((title: string, message?: string) => {
    return addToast({ type: 'info', title, message });
  }, [addToast]);

  return {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    warning,
    info,
  };
}

export { ToastContext };

/**
 * User-friendly error messages for common errors.
 */
export function getErrorMessage(error: any): { title: string; message: string } {
  // Network errors
  if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
    return {
      title: 'Connection Error',
      message: 'Unable to connect to the server. Please check your internet connection.',
    };
  }

  // HTTP status codes
  const status = error.status || error.response?.status;
  switch (status) {
    case 400:
      return {
        title: 'Invalid Request',
        message: error.message || 'Please check your input and try again.',
      };
    case 401:
      return {
        title: 'Session Expired',
        message: 'Please log in again to continue.',
      };
    case 403:
      return {
        title: 'Access Denied',
        message: 'You do not have permission to perform this action.',
      };
    case 404:
      return {
        title: 'Not Found',
        message: error.message || 'The requested resource was not found.',
      };
    case 429:
      return {
        title: 'Too Many Requests',
        message: 'Please wait a moment before trying again.',
      };
    case 500:
      return {
        title: 'Server Error',
        message: 'Something went wrong on our end. Please try again later.',
      };
    case 502:
    case 503:
    case 504:
      return {
        title: 'Service Unavailable',
        message: 'The service is temporarily unavailable. Please try again in a moment.',
      };
    default:
      return {
        title: 'Error',
        message: error.message || 'An unexpected error occurred.',
      };
  }
}

/**
 * Helper to show error toast with user-friendly message.
 */
export function showErrorToast(toast: ToastContextValue, error: any) {
  const { title, message } = getErrorMessage(error);
  return toast.error(title, message);
}