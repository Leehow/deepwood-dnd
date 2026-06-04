/**
 * Zustand store for managing floating chat-filter panels.
 * Each panel shows a filtered subset of chat messages (or a full AI assistant).
 */
import { create } from 'zustand';

export interface FilterPanelConfig {
  filterKey: string;     // 'combat' | 'system' | 'dice-filter' | 'chat-only' | 'ai' | 'user-{id}'
  filterLabel: string;   // "战斗消息" etc.
  filterEmoji: string;   // ⚔️ etc.
  x: number;
  y: number;
  w: number;
  h: number;
  stage: 'open' | 'minimized';
}

interface FloatingFilterPanelState {
  panels: FilterPanelConfig[];
  openPanel: (filterKey: string, filterLabel: string, filterEmoji: string) => void;
  closePanel: (filterKey: string) => void;
  updatePanel: (filterKey: string, updates: Partial<FilterPanelConfig>) => void;
  closeAll: () => void;
}

const DEFAULT_W = 360;
const DEFAULT_H = 420;
const STAGGER = 30;

function getStaggeredPosition(index: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const baseX = Math.max(60, vw - DEFAULT_W - 480);
  const baseY = Math.max(50, (vh - DEFAULT_H) / 2);
  return {
    x: baseX + index * STAGGER,
    y: baseY + index * STAGGER,
  };
}

export const useFloatingFilterPanelStore = create<FloatingFilterPanelState>((set, get) => ({
  panels: [],

  openPanel: (filterKey, filterLabel, filterEmoji) => {
    const { panels } = get();
    const existing = panels.find(p => p.filterKey === filterKey);
    if (existing) {
      set({
        panels: panels.map(p =>
          p.filterKey === filterKey ? { ...p, stage: 'open' } : p
        ),
      });
      return;
    }
    const pos = getStaggeredPosition(panels.length);
    set({
      panels: [
        ...panels,
        {
          filterKey,
          filterLabel,
          filterEmoji,
          x: pos.x,
          y: pos.y,
          w: DEFAULT_W,
          h: DEFAULT_H,
          stage: 'open',
        },
      ],
    });
  },

  closePanel: (filterKey) => {
    set({ panels: get().panels.filter(p => p.filterKey !== filterKey) });
  },

  updatePanel: (filterKey, updates) => {
    set({
      panels: get().panels.map(p =>
        p.filterKey === filterKey ? { ...p, ...updates } : p
      ),
    });
  },

  closeAll: () => set({ panels: [] }),
}));
