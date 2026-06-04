import { useQuery } from "@tanstack/react-query";

import { chatService, type AiSession, type PaginatedMessages } from "~/services/chat.service";
import { getAppQueryClient } from "~/queries/queryClient";

export type ChatHistoryOptions = {
  beforeId?: number;
  limit?: number;
  messageType?: string;
  senderRole?: string;
  filterUserId?: string;
  aiConversation?: boolean;
  aiSessionId?: number;
};

const DEFAULT_CHAT_STALE_MS = 5_000;

function normalizeHistoryOptions(options?: ChatHistoryOptions): Required<ChatHistoryOptions> {
  return {
    beforeId: options?.beforeId ?? -1,
    limit: options?.limit ?? 50,
    messageType: options?.messageType ?? "",
    senderRole: options?.senderRole ?? "",
    filterUserId: options?.filterUserId ?? "",
    aiConversation: options?.aiConversation ?? false,
    aiSessionId: options?.aiSessionId ?? -1,
  };
}

export const chatQueryKeys = {
  all: ["chat"] as const,
  history: (campaignId: string | number, options?: ChatHistoryOptions) =>
    ["chat-history", String(campaignId), normalizeHistoryOptions(options)] as const,
  aiSessions: (campaignId: string | number) => ["chat-ai-sessions", String(campaignId)] as const,
};

export async function fetchCampaignChatMessages(
  campaignId: string | number,
  options?: ChatHistoryOptions,
): Promise<PaginatedMessages> {
  return chatService.getMessages(campaignId, "", "player", options);
}

export async function fetchCampaignChatMessagesCached(
  campaignId: string | number,
  options?: ChatHistoryOptions,
  queryOptions?: { staleTime?: number; force?: boolean },
): Promise<PaginatedMessages> {
  const queryClient = getAppQueryClient();
  const queryKey = chatQueryKeys.history(campaignId, options);
  if (queryOptions?.force) {
    await queryClient.invalidateQueries({ queryKey, exact: true });
  }
  return queryClient.fetchQuery({
    queryKey,
    queryFn: () => fetchCampaignChatMessages(campaignId, options),
    staleTime: queryOptions?.staleTime ?? DEFAULT_CHAT_STALE_MS,
  });
}

export async function fetchCampaignAiSessions(
  campaignId: string | number,
): Promise<AiSession[]> {
  return chatService.listAiSessions(campaignId);
}

export async function fetchCampaignAiSessionsCached(
  campaignId: string | number,
  options?: { staleTime?: number; force?: boolean },
): Promise<AiSession[]> {
  const queryClient = getAppQueryClient();
  const queryKey = chatQueryKeys.aiSessions(campaignId);
  if (options?.force) {
    await queryClient.invalidateQueries({ queryKey, exact: true });
  }
  return queryClient.fetchQuery({
    queryKey,
    queryFn: () => fetchCampaignAiSessions(campaignId),
    staleTime: options?.staleTime ?? 30_000,
  });
}

export function useCampaignChatMessagesQuery(
  campaignId?: string,
  options?: ChatHistoryOptions,
  enabled = true,
) {
  return useQuery({
    queryKey: campaignId ? chatQueryKeys.history(campaignId, options) : ["chat-history", "empty"],
    queryFn: () => fetchCampaignChatMessages(campaignId as string, options),
    enabled: !!campaignId && enabled,
    staleTime: DEFAULT_CHAT_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

export function useCampaignAiSessionsQuery(campaignId?: string, enabled = true) {
  return useQuery({
    queryKey: campaignId ? chatQueryKeys.aiSessions(campaignId) : ["chat-ai-sessions", "empty"],
    queryFn: () => fetchCampaignAiSessions(campaignId as string),
    enabled: !!campaignId && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
