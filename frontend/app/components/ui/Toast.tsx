import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  publishAppEvent,
  subscribeAppEvent,
  type ShowToastEventPayload,
} from "~/events/appEventBus";

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: number;
  message: string;
  type?: ToastType;
  duration?: number;
  slot?: string;
}

export interface ToastEventDetail extends ShowToastEventPayload {}

export const APP_TOAST_EVENT = 'showToast';

export function showGlobalToast(
  toastOrMessage: ToastEventDetail | string,
  type: ToastType = 'success',
  duration = 3000
) {
  if (typeof window === 'undefined') return;

  const detail: ToastEventDetail = typeof toastOrMessage === 'string'
    ? { message: toastOrMessage, type, duration }
    : toastOrMessage;

  publishAppEvent("showToast", detail);
}

// Render text with **bold** markdown support
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}

const typeConfig = {
  success: {
    bg: 'from-emerald-950/90 to-emerald-900/80',
    border: 'border-emerald-500/30',
    icon: '✦',
    iconColor: 'text-emerald-400',
    textColor: 'text-emerald-100/90',
    glow: '0 0 20px rgba(16,185,129,0.15)',
    progress: 'bg-emerald-400/60',
  },
  error: {
    bg: 'from-red-950/90 to-red-900/80',
    border: 'border-red-500/30',
    icon: '✧',
    iconColor: 'text-red-400',
    textColor: 'text-red-100/90',
    glow: '0 0 20px rgba(239,68,68,0.15)',
    progress: 'bg-red-400/60',
  },
  warning: {
    bg: 'from-amber-950/90 to-amber-900/80',
    border: 'border-amber-500/30',
    icon: '◆',
    iconColor: 'text-amber-400',
    textColor: 'text-amber-100/90',
    glow: '0 0 20px rgba(245,158,11,0.15)',
    progress: 'bg-amber-400/60',
  },
  info: {
    bg: 'from-blue-950/90 to-blue-900/80',
    border: 'border-blue-500/30',
    icon: '◈',
    iconColor: 'text-blue-400',
    textColor: 'text-blue-100/90',
    glow: '0 0 20px rgba(59,130,246,0.15)',
    progress: 'bg-blue-400/60',
  },
} as const;

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose: () => void;
}

export function Toast({ message, type = 'success', duration = 3000, onClose }: ToastProps) {
  const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter');
  const config = typeConfig[type];

  useEffect(() => {
    // Trigger enter → visible on next frame
    const raf = requestAnimationFrame(() => setPhase('visible'));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPhase('exit');
      setTimeout(onClose, 280);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const transform = phase === 'enter'
    ? 'translate3d(120%, 0, 0) scale(0.95)'
    : phase === 'exit'
      ? 'translate3d(120%, 0, 0) scale(0.95)'
      : 'translate3d(0, 0, 0) scale(1)';

  const textContent = typeof message === 'string' ? message : JSON.stringify(message);

  return (
    <div
      className={`
        pointer-events-auto max-w-sm
        bg-gradient-to-r ${config.bg}
        backdrop-blur-xl border ${config.border}
        rounded-lg shadow-2xl
        flex items-start gap-2.5 px-3.5 py-2.5
        ${config.textColor}
      `}
      style={{
        transform,
        opacity: phase === 'visible' ? 1 : 0,
        transition: 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 280ms ease-out',
        boxShadow: `${config.glow}, 0 8px 32px rgba(0,0,0,0.4)`,
      }}
    >
      {/* Type icon */}
      <span className={`${config.iconColor} text-base mt-0.5 flex-shrink-0`}>
        {config.icon}
      </span>

      {/* Message body */}
      <div className="flex-1 min-w-0 text-sm leading-relaxed break-words">
        <RichText text={textContent} />
      </div>

      {/* Close button */}
      <button
        onClick={() => { setPhase('exit'); setTimeout(onClose, 280); }}
        className="flex-shrink-0 mt-0.5 text-white/30 hover:text-white/70 transition-colors text-xs leading-none"
      >
        ✕
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onRemove?: (id: number) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const currentIds = new Set(toasts.map(t => t.id));
    setDismissedIds(prev => {
      const newSet = new Set<number>();
      prev.forEach(id => { if (currentIds.has(id)) newSet.add(id); });
      return newSet.size !== prev.size ? newSet : prev;
    });
  }, [toasts]);

  const handleDismiss = (id: number) => {
    setDismissedIds(prev => new Set(prev).add(id));
    onRemove?.(id);
  };

  const visibleToasts = toasts.filter(t => !dismissedIds.has(t.id));
  if (!mounted) return null;

  return createPortal(
    <div className="pointer-events-none fixed top-4 right-4 z-[11000] flex flex-col gap-2.5 max-w-sm">
      {visibleToasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={() => handleDismiss(toast.id)}
        />
      ))}
    </div>,
    document.body
  );
}

export function GlobalToastViewport() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);

  useEffect(() => {
    const handler = (detail: ShowToastEventPayload) => {
      if (!detail?.message) return;

      const nextToast: ToastItem = {
        id: nextIdRef.current++,
        message: detail.message,
        type: detail.type ?? 'info',
        duration: detail.duration,
        slot: detail.slot,
      };

      setToasts(prev => {
        if (!detail.slot) return [...prev, nextToast];
        return [...prev.filter(toast => toast.slot !== detail.slot), nextToast];
      });
    };

    return subscribeAppEvent("showToast", handler);
  }, []);

  const handleRemove = useCallback((id: number) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  return <ToastContainer toasts={toasts} onRemove={handleRemove} />;
}
