/**
 * Zustand store for managing floating token panels (DM only).
 * Panels are temporary (not persisted) — they close when leaving the map.
 */
import { create } from 'zustand';

export type TokenPanelTab = 'stats' | 'features' | 'equipment' | 'status' | 'spells';

export interface TokenPanelConfig {
  tokenId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  activeTab: TokenPanelTab;
  stage: 'open' | 'minimized';
}

interface FloatingTokenPanelState {
  panels: TokenPanelConfig[];
  openPanel: (tokenId: number) => void;
  closePanel: (tokenId: number) => void;
  updatePanel: (tokenId: number, updates: Partial<TokenPanelConfig>) => void;
  closeAll: () => void;
}

const DEFAULT_W = 480;
const DEFAULT_H = 520;
const STAGGER = 30;

function getStaggeredPosition(index: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const baseX = Math.max(60, vw - DEFAULT_W - 420);
  const baseY = Math.max(50, (vh - DEFAULT_H) / 2);
  return {
    x: baseX + index * STAGGER,
    y: baseY + index * STAGGER,
  };
}

export const useFloatingTokenPanelStore = create<FloatingTokenPanelState>((set, get) => ({
  panels: [],

  openPanel: (tokenId: number) => {
    const { panels } = get();
    const existing = panels.find(p => p.tokenId === tokenId);
    if (existing) {
      // Already open — just restore if minimized
      set({
        panels: panels.map(p =>
          p.tokenId === tokenId ? { ...p, stage: 'open' } : p
        ),
      });
      return;
    }
    const pos = getStaggeredPosition(panels.length);
    set({
      panels: [
        ...panels,
        {
          tokenId,
          x: pos.x,
          y: pos.y,
          w: DEFAULT_W,
          h: DEFAULT_H,
          activeTab: 'stats',
          stage: 'open',
        },
      ],
    });
  },

  closePanel: (tokenId: number) => {
    set({ panels: get().panels.filter(p => p.tokenId !== tokenId) });
  },

  updatePanel: (tokenId: number, updates: Partial<TokenPanelConfig>) => {
    set({
      panels: get().panels.map(p =>
        p.tokenId === tokenId ? { ...p, ...updates } : p
      ),
    });
  },

  closeAll: () => set({ panels: [] }),
}));
