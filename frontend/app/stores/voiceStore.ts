import { create } from 'zustand';

export interface VoiceParticipant {
  identity: string;  // user_id
  name: string;
  userId: number;    // 提取的用户 ID
  isSpeaking: boolean;
  isMuted: boolean;
}

interface VoiceState {
  isConnected: boolean;
  participants: VoiceParticipant[];
  // 全局语音用户列表（通过 WebSocket 同步）
  voiceUserIds: number[];
  setConnected: (connected: boolean) => void;
  setParticipants: (participants: VoiceParticipant[]) => void;
  setVoiceUserIds: (userIds: number[]) => void;
  addVoiceUserId: (userId: number) => void;
  removeVoiceUserId: (userId: number) => void;
  reset: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  isConnected: false,
  participants: [],
  voiceUserIds: [],
  setConnected: (connected) => set({ isConnected: connected }),
  setParticipants: (participants) => set({ participants }),
  setVoiceUserIds: (userIds) => set({ voiceUserIds: userIds }),
  addVoiceUserId: (userId) => set((state) => ({
    voiceUserIds: state.voiceUserIds.includes(userId)
      ? state.voiceUserIds
      : [...state.voiceUserIds, userId]
  })),
  removeVoiceUserId: (userId) => set((state) => ({
    voiceUserIds: state.voiceUserIds.filter(id => id !== userId)
  })),
  reset: () => set({ isConnected: false, participants: [], voiceUserIds: [] }),
}));

// 从 identity 提取用户 ID（格式可能是 "123" 或 "user_123"）
export function extractUserId(identity: string): number | null {
  // 先尝试 user_123 格式
  const prefixMatch = identity.match(/^user_(\d+)$/);
  if (prefixMatch) {
    return parseInt(prefixMatch[1], 10);
  }
  // 直接是数字
  const numMatch = identity.match(/^\d+$/);
  if (numMatch) {
    return parseInt(identity, 10);
  }
  return null;
}
