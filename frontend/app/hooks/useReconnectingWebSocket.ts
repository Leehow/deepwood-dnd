/**
 * WebSocket hook with automatic reconnection and exponential backoff.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface WebSocketOptions {
  url: string;
  onMessage?: (data: any) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  initialReconnectDelay?: number;
  maxReconnectDelay?: number;
  heartbeatInterval?: number;
}

interface WebSocketState {
  status: ConnectionStatus;
  reconnectAttempt: number;
  lastError: string | null;
}

export function useReconnectingWebSocket(options: WebSocketOptions) {
  const {
    url,
    onMessage,
    onOpen,
    onClose,
    onError,
    reconnect = true,
    maxReconnectAttempts = 10,
    initialReconnectDelay = 1000,
    maxReconnectDelay = 30000,
    heartbeatInterval = 30000,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const heartbeatIntervalRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptRef = useRef(0);

  const [state, setState] = useState<WebSocketState>({
    status: 'disconnected',
    reconnectAttempt: 0,
    lastError: null,
  });

  // Calculate backoff delay with jitter
  const getBackoffDelay = useCallback((attempt: number): number => {
    const delay = Math.min(
      initialReconnectDelay * Math.pow(2, attempt),
      maxReconnectDelay
    );
    // Add jitter (±25%)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
  }, [initialReconnectDelay, maxReconnectDelay]);

  // Start heartbeat
  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }

    heartbeatIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, heartbeatInterval);
  }, [heartbeatInterval]);

  // Stop heartbeat
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = undefined;
    }
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    // Don't connect if already connected or connecting
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    setState(prev => ({
      ...prev,
      status: reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting',
    }));

    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setState({
          status: 'connected',
          reconnectAttempt: 0,
          lastError: null,
        });
        startHeartbeat();
        onOpen?.();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle pong response
          if (data.type === 'pong') {
            return;
          }

          onMessage?.(data);
        } catch {
          // Handle non-JSON messages
          onMessage?.(event.data);
        }
      };

      ws.onclose = (event) => {
        stopHeartbeat();
        setState(prev => ({
          ...prev,
          status: 'disconnected',
        }));
        onClose?.();

        // Attempt reconnection if enabled
        if (reconnect && reconnectAttemptRef.current < maxReconnectAttempts) {
          const delay = getBackoffDelay(reconnectAttemptRef.current);
          reconnectAttemptRef.current += 1;

          setState(prev => ({
            ...prev,
            reconnectAttempt: reconnectAttemptRef.current,
          }));

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      ws.onerror = (event) => {
        setState(prev => ({
          ...prev,
          lastError: 'WebSocket error occurred',
        }));
        onError?.(event);
      };

      wsRef.current = ws;
    } catch (error) {
      setState(prev => ({
        ...prev,
        status: 'disconnected',
        lastError: error instanceof Error ? error.message : 'Connection failed',
      }));
    }
  }, [url, onMessage, onOpen, onClose, onError, reconnect, maxReconnectAttempts, getBackoffDelay, startHeartbeat, stopHeartbeat]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    // Cancel pending reconnection
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    stopHeartbeat();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    reconnectAttemptRef.current = 0;
    setState({
      status: 'disconnected',
      reconnectAttempt: 0,
      lastError: null,
    });
  }, [stopHeartbeat]);

  // Send message
  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      wsRef.current.send(message);
      return true;
    }
    return false;
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // Reconnect when URL changes
  useEffect(() => {
    disconnect();
    connect();
  }, [url]);

  return {
    ...state,
    send,
    connect,
    disconnect,
    isConnected: state.status === 'connected',
  };
}

/**
 * Simple wrapper for campaign WebSocket connection.
 */
export function useCampaignWebSocket(
  campaignId: string,
  _userId: string,
  onMessage: (data: any) => void
) {
  const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8174';
  const token = typeof window !== 'undefined' ? localStorage.getItem('dnd_auth_token') : null;

  const url = `${WS_BASE_URL}/ws/${campaignId}?token=${encodeURIComponent(token || "")}`;

  return useReconnectingWebSocket({
    url,
    onMessage,
    reconnect: true,
    maxReconnectAttempts: 10,
    heartbeatInterval: 30000,
  });
}
