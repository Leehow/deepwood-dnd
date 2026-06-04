/**
 * Shared z-index manager for floating windows.
 * Click a window → it gets the highest z-index → appears on top.
 */
import { create } from 'zustand';

const BASE_Z = 10050;

interface FloatingZState {
  counter: number;
  /** Returns a new z-index higher than all previous ones */
  bringToFront: () => number;
}

export const useFloatingZIndex = create<FloatingZState>((set, get) => ({
  counter: 0,
  bringToFront: () => {
    const next = get().counter + 1;
    set({ counter: next });
    return BASE_Z + next;
  },
}));
