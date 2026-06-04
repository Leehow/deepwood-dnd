import { create } from 'zustand';

interface ModalContextState {
  /** All active modal contexts, keyed by modal name */
  contexts: Record<string, string>;

  /** Backward-compatible: combined description of all active modals */
  modalDescription: string | null;
  /** Backward-compatible: first active modal name (or null) */
  activeModal: string | null;

  /** Set/update context for a specific modal */
  setModalContext: (modal: string, description: string | null) => void;
  /** Clear context for a specific modal (pass key), or clear ALL if no arg */
  clearModalContext: (modal?: string) => void;
}

function deriveCompat(contexts: Record<string, string>) {
  const entries = Object.entries(contexts);
  if (entries.length === 0) return { activeModal: null, modalDescription: null };
  const activeModal = entries[0][0];
  const modalDescription = entries.map(([, desc]) => desc).join('；');
  return { activeModal, modalDescription };
}

export const useModalContextStore = create<ModalContextState>((set) => ({
  contexts: {},
  activeModal: null,
  modalDescription: null,

  setModalContext: (modal, description) => set((state) => {
    if (!description) {
      // Treat null description as removal
      const { [modal]: _, ...rest } = state.contexts;
      return { contexts: rest, ...deriveCompat(rest) };
    }
    const next = { ...state.contexts, [modal]: description };
    return { contexts: next, ...deriveCompat(next) };
  }),

  clearModalContext: (modal?: string) => set((state) => {
    if (modal) {
      const { [modal]: _, ...rest } = state.contexts;
      return { contexts: rest, ...deriveCompat(rest) };
    }
    // Clear all
    return { contexts: {}, activeModal: null, modalDescription: null };
  }),
}));
