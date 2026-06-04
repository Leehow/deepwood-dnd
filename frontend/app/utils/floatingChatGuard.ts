import { useRef, useEffect, useCallback } from 'react';

const FLOATING_SELECTORS =
  '.floating-chat-window, .floating-chat-titlebar, .floating-chat-minimized, ' +
  '.floating-char-panel-window, .floating-char-panel-titlebar, .floating-char-panel-minimized, ' +
  '.floating-filter-panel-window, .floating-filter-titlebar';

/**
 * Check if a pointer/interact event target is inside a floating window.
 * Used by @radix-ui/react-dialog modals (onInteractOutside / onPointerDownOutside).
 */
export function isClickInsideFloatingChat(e: { target: EventTarget | null }): boolean {
  if (!(e.target instanceof HTMLElement)) return false;
  return !!e.target.closest(FLOATING_SELECTORS);
}

/**
 * Hook for @radix-ui/themes Dialog modals that don't reliably forward
 * onInteractOutside / onPointerDownOutside. Wraps onClose so that
 * clicks on floating windows (chat, character panel) don't close the dialog.
 */
export function useFloatingGuardedClose(onClose: () => void) {
  const lastPointerTarget = useRef<EventTarget | null>(null);
  useEffect(() => {
    const handler = (e: PointerEvent) => { lastPointerTarget.current = e.target; };
    window.addEventListener('pointerdown', handler, true);
    return () => window.removeEventListener('pointerdown', handler, true);
  }, []);

  const guardedOnOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen && lastPointerTarget.current instanceof HTMLElement) {
      if (lastPointerTarget.current.closest(FLOATING_SELECTORS)) return;
    }
    if (!isOpen) onClose();
  }, [onClose]);

  return guardedOnOpenChange;
}

/**
 * Hook that prevents pointerdown events on floating windows from reaching
 * document, where Radix's DismissableLayer listens. Uses native DOM events
 * (not React synthetic) for reliable interception.
 *
 * Call this once in each floating window component (FloatingChatWindow,
 * FloatingCharacterPanel). It attaches a native listener on document that
 * intercepts pointerdown in the CAPTURE phase and stops propagation when
 * the target is inside a floating window.
 */
export function useFloatingPointerGuard() {
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof HTMLElement && target.closest(FLOATING_SELECTORS)) {
        // Don't intercept if target (or ancestor) is draggable — HTML5 drag
        // needs pointerdown to propagate normally to initiate the drag sequence.
        if (target.closest('[draggable="true"]')) return;
        // Stop this event from reaching Radix's DismissableLayer listener
        // which is on document in bubble phase. We use capture on document
        // and stopImmediatePropagation to prevent any other document-level
        // capture handlers from seeing it too.
        e.stopPropagation();
      }
    };
    // Capture phase on document.body: fires before bubble phase handlers on document
    document.body.addEventListener('pointerdown', handler, false);
    return () => document.body.removeEventListener('pointerdown', handler, false);
  }, []);
}
