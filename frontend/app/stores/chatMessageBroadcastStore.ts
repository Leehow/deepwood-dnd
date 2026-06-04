/**
 * Broadcast store for relaying chat messages from the main ChatPanel
 * to floating filter panels. ChatPanel writes here on each new WebSocket
 * message; floating panels subscribe and filter by their own criteria.
 */
import { create } from 'zustand';
import type { Message } from '~/components/ui/hooks/useChatMessages';

interface ChatMessageBroadcastState {
  /** Increments on every broadcast so selectors always fire. */
  seq: number;
  latestMessage: Message | null;
  broadcast: (msg: Message) => void;
}

export const useChatMessageBroadcastStore = create<ChatMessageBroadcastState>((set) => ({
  seq: 0,
  latestMessage: null,
  broadcast: (msg) => set((s) => ({ latestMessage: msg, seq: s.seq + 1 })),
}));
