/**
 * useChatAI Hook
 * Manages AI chat interactions and streaming
 */

import { useState, useRef, useCallback } from 'react';
import { createLogger } from '~/utils/logger';
import type { Message } from './useChatMessages';
import { apiFetch } from "~/utils/api-client";

const logger = createLogger('useChatAI');

export interface UseChatAIResult {
  aiTyping: boolean;
  aiError: string | null;
  aiStreamingContent: string;
  isAiStreaming: boolean;
  sendToAI: (message: string, onResponse: (content: string, isDone: boolean) => void) => Promise<void>;
  clearAIError: () => void;
  // WebSocket streaming methods
  handleStreamChunk: (chunk: string) => void;
  handleStreamDone: () => void;
  startStreaming: () => void;
  startThinking: () => void;
}

export function useChatAI(campaignId: string): UseChatAIResult {
  const [aiTyping, setAiTyping] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiStreamingContent, setAiStreamingContent] = useState('');
  const [isAiStreaming, setIsAiStreaming] = useState(false);
  const aiTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Clear AI error state
   */
  const clearAIError = useCallback(() => {
    setAiError(null);
  }, []);

  /**
   * Send message to AI and handle streaming response
   */
  const sendToAI = useCallback(
    async (
      message: string,
      onResponse: (content: string, isDone: boolean) => void
    ) => {
      setAiTyping(true);
      setAiError(null);
      setAiStreamingContent('');
      setIsAiStreaming(true);

      // Clear any existing timeout
      if (aiTimeoutRef.current) {
        clearTimeout(aiTimeoutRef.current);
        aiTimeoutRef.current = null;
      }

      try {
        const response = await apiFetch(`/api/campaigns/${campaignId}/chat/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            content: message,
            recipients: ['ai'],
            sender_role: 'player'
          })
        });

        if (!response.ok) {
          throw new Error(`AI request failed: ${response.statusText}`);
        }

        // Check if response is streaming
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error('Response body is not readable');
        }

        let accumulatedContent = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            logger.debug('AI streaming completed');
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          accumulatedContent += chunk;
          setAiStreamingContent(accumulatedContent);

          // Call response callback with streaming content
          onResponse(accumulatedContent, false);
        }

        // Final callback with complete content
        onResponse(accumulatedContent, true);
        setIsAiStreaming(false);
        setAiTyping(false);
      } catch (error) {
        logger.error('Failed to get AI response', error);
        setAiError(error instanceof Error ? error.message : 'AI请求失败');
        setIsAiStreaming(false);
        setAiTyping(false);

        // Auto-clear error after 5 seconds
        aiTimeoutRef.current = setTimeout(() => {
          setAiError(null);
        }, 5000);

        throw error;
      }
    },
    [campaignId]
  );

  /**
   * Start thinking state (called immediately when user sends message to AI)
   */
  const startThinking = useCallback(() => {
    setAiTyping(true);
    setAiError(null);
    setAiStreamingContent('');
    // Safety timeout: clear thinking state if no response after 30s
    if (aiTimeoutRef.current) {
      clearTimeout(aiTimeoutRef.current);
    }
    aiTimeoutRef.current = setTimeout(() => {
      setAiTyping(prev => {
        if (prev) {
          setAiError('AI 响应超时，请重试');
          setTimeout(() => setAiError(null), 5000);
        }
        return false;
      });
    }, 30000);
  }, []);

  /**
   * Start streaming (called when AI begins responding via WebSocket)
   */
  const startStreaming = useCallback(() => {
    if (aiTimeoutRef.current) {
      clearTimeout(aiTimeoutRef.current);
      aiTimeoutRef.current = null;
    }
    setAiTyping(true);
    setIsAiStreaming(true);
    setAiStreamingContent('');
    setAiError(null);
  }, []);

  /**
   * Handle streaming chunk from WebSocket
   */
  const handleStreamChunk = useCallback((chunk: string) => {
    setAiStreamingContent(prev => prev + chunk);
  }, []);

  /**
   * Handle streaming done from WebSocket
   */
  const handleStreamDone = useCallback(() => {
    if (aiTimeoutRef.current) {
      clearTimeout(aiTimeoutRef.current);
      aiTimeoutRef.current = null;
    }
    setIsAiStreaming(false);
    setAiTyping(false);
  }, []);

  return {
    aiTyping,
    aiError,
    aiStreamingContent,
    isAiStreaming,
    sendToAI,
    clearAIError,
    handleStreamChunk,
    handleStreamDone,
    startStreaming,
    startThinking
  };
}
