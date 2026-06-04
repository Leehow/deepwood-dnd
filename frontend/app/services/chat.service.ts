/**
 * Chat Service
 * Handles all chat-related API calls
 */

import { BaseAPIService } from './api.service';

export interface ChatMessage {
  id: number;
  campaign_id: number;
  sender_user_id: string;
  sender_role: 'dm' | 'player' | 'ai';
  content: string;
  recipients: string[];
  is_deleted: boolean;
  is_private?: boolean;
  message_type?: 'chat' | 'system' | 'dice';
  meta?: Record<string, any>;
  ai_session_id?: number | null;
  created_at: string;
  updated_at?: string;
}

export interface ChatMessageCreate {
  content: string;
  recipients?: string[];
  message_type?: string;
  reply_to_id?: number;
  meta?: Record<string, any>;
}

export interface ChatMessageUpdate {
  content: string;
}

export interface PaginatedMessages {
  messages: ChatMessage[];
  total: number;
  page: number;
  page_size: number;
}

export interface AiSession {
  id: number;
  campaign_id: number;
  user_id: string;
  title: string;
  created_at: string;
  updated_at?: string;
}

class ChatService extends BaseAPIService {
  /**
   * Get chat messages for a campaign
   */
  async getMessages(
    campaignId: string | number,
    _userId: string,
    _role: 'dm' | 'player',
    opts?: { beforeId?: number; limit?: number; messageType?: string; senderRole?: string; filterUserId?: string; aiConversation?: boolean; aiSessionId?: number }
  ): Promise<PaginatedMessages> {
    const limit = opts?.limit ?? 50;
    const params: Record<string, string | number | boolean> = {
      limit,
    };
    if (typeof opts?.beforeId === 'number') {
      (params as any).before_id = opts.beforeId;
    }
    if (opts?.messageType) {
      (params as any).message_type = opts.messageType;
    }
    if (opts?.senderRole) {
      (params as any).sender_role = opts.senderRole;
    }
    if (opts?.filterUserId) {
      (params as any).filter_user_id = opts.filterUserId;
    }
    if (opts?.aiConversation) {
      (params as any).ai_conversation = true;
    }
    if (typeof opts?.aiSessionId === 'number') {
      (params as any).ai_session_id = opts.aiSessionId;
    }
    const data = await this.get<any>(`/api/campaigns/${campaignId}/chat/messages`, {
      params,
    });
    const messages: ChatMessage[] = Array.isArray(data)
      ? data
      : (data?.messages ?? []);
    return {
      messages,
      total: Array.isArray(data) ? messages.length : (data?.total ?? messages.length),
      page: 1,
      page_size: limit,
    };
  }

  /**
   * Send a chat message
   */
  async sendMessage(
    campaignId: string | number,
    data: ChatMessageCreate,
    _userId?: string,
    _role?: 'dm' | 'player'
  ): Promise<ChatMessage> {
    return this.post<ChatMessage>(
      `/api/campaigns/${campaignId}/chat/messages`,
      data
    );
  }

  /**
   * Edit a chat message
   */
  async editMessage(
    campaignId: string | number,
    messageId: number,
    data: ChatMessageUpdate,
    _userId: string,
    _role: 'dm' | 'player'
  ): Promise<ChatMessage> {
    return this.put<ChatMessage>(
      `/api/campaigns/${campaignId}/chat/messages/${messageId}`,
      data
    );
  }

  /**
   * Delete a chat message
   */
  async deleteMessage(
    campaignId: string | number,
    messageId: number
  ): Promise<void> {
    return this.delete(`/api/campaigns/${campaignId}/chat/messages/${messageId}`);
  }

  /**
   * Search messages
   */
  async searchMessages(
    campaignId: string | number,
    query: string,
    _userId: string,
    _role: 'dm' | 'player',
    page: number = 1
  ): Promise<PaginatedMessages> {
    return this.get<PaginatedMessages>(`/api/campaigns/${campaignId}/chat/search`, {
      params: { q: query, page }
    });
  }

  // --- AI Sessions ---

  async listAiSessions(campaignId: string | number, _userId?: string): Promise<AiSession[]> {
    return this.get<AiSession[]>(`/api/campaigns/${campaignId}/ai-sessions`);
  }

  async createAiSession(campaignId: string | number, _userId: string, title?: string): Promise<AiSession> {
    return this.post<AiSession>(
      `/api/campaigns/${campaignId}/ai-sessions`,
      { title: title || '新会话' },
    );
  }

  async renameAiSession(campaignId: string | number, sessionId: number, _userId: string, title: string): Promise<AiSession> {
    return this.patch<AiSession>(
      `/api/campaigns/${campaignId}/ai-sessions/${sessionId}`,
      { title },
    );
  }

  async deleteAiSession(campaignId: string | number, sessionId: number, _userId: string): Promise<void> {
    return this.delete(`/api/campaigns/${campaignId}/ai-sessions/${sessionId}`);
  }
}

export const chatService = new ChatService();
