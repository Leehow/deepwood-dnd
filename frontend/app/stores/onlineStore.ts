import { create } from 'zustand';

interface OnlineState {
  // Set of online user IDs per campaign
  onlineUsers: Map<string, Set<string>>;

  // Add user as online
  setOnline: (campaignId: string, userId: string) => void;

  // Remove user from online
  setOffline: (campaignId: string, userId: string) => void;

  // Set all online users for a campaign (replaces existing)
  setOnlineUsers: (campaignId: string, userIds: string[]) => void;

  // Check if user is online (non-reactive, use with onlineUsers subscription)
  isOnline: (campaignId: string, userId: string) => boolean;

  // Clear all online users for a campaign
  clearCampaign: (campaignId: string) => void;
}

export const useOnlineStore = create<OnlineState>((set, get) => ({
  onlineUsers: new Map(),

  setOnline: (campaignId, userId) => {
    set((state) => {
      const newMap = new Map(state.onlineUsers);
      const users = new Set(newMap.get(campaignId) || []);
      users.add(userId);
      newMap.set(campaignId, users);
      return { onlineUsers: newMap };
    });
  },

  setOffline: (campaignId, userId) => {
    set((state) => {
      const newMap = new Map(state.onlineUsers);
      const users = newMap.get(campaignId);
      if (users) {
        const newUsers = new Set(users);
        newUsers.delete(userId);
        newMap.set(campaignId, newUsers);
      }
      return { onlineUsers: newMap };
    });
  },

  setOnlineUsers: (campaignId, userIds) => {
    set((state) => {
      const newMap = new Map(state.onlineUsers);
      newMap.set(campaignId, new Set(userIds));
      return { onlineUsers: newMap };
    });
  },

  isOnline: (campaignId, userId) => {
    const users = get().onlineUsers.get(campaignId);
    return users?.has(userId) ?? false;
  },

  clearCampaign: (campaignId) => {
    set((state) => {
      const newMap = new Map(state.onlineUsers);
      newMap.delete(campaignId);
      return { onlineUsers: newMap };
    });
  },
}));

// Hook to check if a user is online with reactive updates
export function useIsOnline(campaignId: string | undefined, userId: string | undefined): boolean {
  return useOnlineStore((state) => {
    if (!campaignId || !userId) return false;
    return state.onlineUsers.get(campaignId)?.has(userId) ?? false;
  });
}
