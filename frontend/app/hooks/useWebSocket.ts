import { useEffect, useRef, useState, useCallback } from "react";
import { createLogger } from "~/utils/logger";
import { getWebSocketEndpoint } from "~/config/api";
import { getAuthToken } from "~/utils/auth";

const logger = createLogger("useWebSocket");

const NOISY_MESSAGE_TYPES = new Set([
  "connected",
  "connection",
  "user_connected",
  "user_disconnected",
  "user_joined",
  "user_left",
]);

let nextSubscriberId = 1;
const sharedConnections = new Map<string, SharedConnection>();

// Canonical WS message format (enforced across backend + frontend):
//   { type: string, data: object }
// NOTE: Backend WebSocketManager normalizes outgoing payloads to this shape.
export interface WebSocketMessage<TData extends Record<string, any> = Record<string, any>> {
  type: string;
  data: TData;
}

export interface UseWebSocketOptions {
  campaignId: string;
  userId?: string;
  role?: "dm" | "player";
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  autoReconnect?: boolean;
}

export interface ConnectionHealth {
  latency: number | null;
  lastHeartbeat: number | null;
  isHealthy: boolean;
}

interface SharedConnectionState {
  isConnected: boolean;
  connectionError: string | null;
  connectionHealth: ConnectionHealth;
}

interface SharedSubscriber {
  id: number;
  autoReconnect: boolean;
  onStateChange: (state: SharedConnectionState) => void;
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

function getConnectionKey(campaignId: string) {
  return `${campaignId}`;
}

class SharedConnection {
  private ws: WebSocket | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private disposeTimeout: ReturnType<typeof setTimeout> | null = null;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly pingTimestampRef: Record<number, number> = {};
  private readonly subscribers = new Map<number, SharedSubscriber>();
  private isDisposed = false;
  private healthWarningLogged = false;
  private state: SharedConnectionState = {
    isConnected: false,
    connectionError: null,
    connectionHealth: {
      latency: null,
      lastHeartbeat: null,
      isHealthy: false,
    },
  };

  constructor(
    private readonly key: string,
    private readonly campaignId: string,
  ) {}

  subscribe(subscriber: SharedSubscriber) {
    if (this.isDisposed) return;
    if (this.disposeTimeout) {
      clearTimeout(this.disposeTimeout);
      this.disposeTimeout = null;
    }
    this.subscribers.set(subscriber.id, subscriber);
    subscriber.onStateChange(this.snapshot());
    this.connect();
  }

  unsubscribe(subscriberId: number) {
    this.subscribers.delete(subscriberId);
    if (this.subscribers.size === 0) {
      this.disposeTimeout = setTimeout(() => {
        if (this.subscribers.size === 0) {
          this.dispose();
        }
      }, 100);
    }
  }

  connect() {
    if (this.isDisposed || this.subscribers.size === 0) return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    try {
      const token = getAuthToken();
      if (!token) {
        this.state = {
          ...this.state,
          connectionError: "Missing auth token",
        };
        this.notifyState();
        return;
      }

      const wsUrl = getWebSocketEndpoint(
        `/ws/${this.campaignId}?token=${encodeURIComponent(token)}`,
      );

      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (this.reconnectAttempts > 0) {
          logger.debug("WebSocket reconnected successfully");
        }

        this.reconnectAttempts = 0;
        this.healthWarningLogged = false;
        this.state = {
          isConnected: true,
          connectionError: null,
          connectionHealth: {
            ...this.state.connectionHealth,
            isHealthy: this.state.connectionHealth.isHealthy,
          },
        };
        this.startHealthMonitor();
        this.notifyState();
        this.subscribers.forEach((subscriber) => subscriber.onConnect?.());

        setTimeout(() => {
          try {
            this.measureLatency();
          } catch {
            // no-op
          }
        }, 100);
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          if (!raw || typeof raw.type !== "string") {
            logger.warn("Ignoring invalid WebSocket message (missing type):", raw);
            return;
          }
          const data = raw.data;
          if (!data || typeof data !== "object" || Array.isArray(data)) {
            logger.warn("Ignoring invalid WebSocket message (missing data object):", raw);
            return;
          }
          const message: WebSocketMessage = { type: raw.type, data };

          if (message.type === "ping") {
            const timestamp = Number(message.data.timestamp ?? Date.now());
            this.ws?.send(JSON.stringify({
              type: "pong",
              data: { timestamp },
            }));
            this.updateHealth({
              latency: null,
              lastHeartbeat: Date.now(),
              isHealthy: true,
            });
            return;
          }

          if (message.type === "pong") {
            const ts = Number(message.data.timestamp);
            if (!Number.isFinite(ts)) return;
            const sentTime = this.pingTimestampRef[ts];
            if (sentTime) {
              const latency = Date.now() - sentTime;
              delete this.pingTimestampRef[ts];
              this.updateHealth({
                latency,
                lastHeartbeat: Date.now(),
                isHealthy: true,
              });
            }
            return;
          }

          if (!NOISY_MESSAGE_TYPES.has(message.type)) {
            logger.debug("WebSocket message received:", message);
          }

          this.subscribers.forEach((subscriber) => subscriber.onMessage?.(message));
        } catch (error) {
          logger.error("Failed to parse WebSocket message:", error);
        }
      };

      ws.onerror = (error) => {
        if (this.reconnectAttempts === 0) {
          logger.error("WebSocket error:", error);
        }
        this.state = {
          ...this.state,
          connectionError: "WebSocket connection error",
        };
        this.notifyState();
      };

      ws.onclose = () => {
        if (this.reconnectAttempts === 0) {
          logger.debug("WebSocket disconnected");
        }

        this.stopHealthMonitor();
        this.healthWarningLogged = false;
        this.state = {
          isConnected: false,
          connectionError: null,
          connectionHealth: {
            latency: null,
            lastHeartbeat: null,
            isHealthy: false,
          },
        };
        this.notifyState();
        this.subscribers.forEach((subscriber) => subscriber.onDisconnect?.());

        if (this.subscribers.size > 0 && this.shouldAutoReconnect()) {
          this.reconnectAttempts += 1;
          if (this.reconnectAttempts <= this.maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            if (this.reconnectAttempts === 1) {
              logger.debug(`Reconnecting in ${delay}ms...`);
            }
            if (this.reconnectTimeout) {
              clearTimeout(this.reconnectTimeout);
            }
            this.reconnectTimeout = setTimeout(() => {
              this.connect();
            }, delay);
          }
        }
      };
    } catch (error) {
      logger.error("Failed to create WebSocket connection:", error);
      this.state = {
        ...this.state,
        connectionError: "Failed to connect",
      };
      this.notifyState();
    }
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.stopHealthMonitor();
    this.healthWarningLogged = false;

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }

    this.reconnectAttempts = 0;
    this.state = {
      isConnected: false,
      connectionError: null,
      connectionHealth: {
        latency: null,
        lastHeartbeat: null,
        isHealthy: false,
      },
    };
    this.notifyState();
  }

  sendMessage(message: WebSocketMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      logger.debug("WebSocket message sent:", message);
    } else {
      logger.warn("WebSocket is not connected, cannot send message");
    }
  }

  measureLatency() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const timestamp = Date.now();
      this.pingTimestampRef[timestamp] = timestamp;
      this.ws.send(JSON.stringify({
        type: "ping",
        data: { timestamp },
      }));

      const tenSecondsAgo = timestamp - 10000;
      Object.keys(this.pingTimestampRef).forEach((key) => {
        const ts = Number(key);
        if (ts < tenSecondsAgo) {
          delete this.pingTimestampRef[ts];
        }
      });
    }
  }

  private dispose() {
    this.disconnect();
    this.isDisposed = true;
    sharedConnections.delete(this.key);
  }

  private notifyState() {
    const snapshot = this.snapshot();
    this.subscribers.forEach((subscriber) => subscriber.onStateChange(snapshot));
  }

  private snapshot(): SharedConnectionState {
    return {
      isConnected: this.state.isConnected,
      connectionError: this.state.connectionError,
      connectionHealth: { ...this.state.connectionHealth },
    };
  }

  private updateHealth(connectionHealth: ConnectionHealth) {
    if (connectionHealth.isHealthy) {
      this.healthWarningLogged = false;
    }
    this.state = {
      ...this.state,
      connectionHealth,
    };
    this.notifyState();
  }

  private startHealthMonitor() {
    this.stopHealthMonitor();
    this.healthCheckInterval = setInterval(() => {
      const { lastHeartbeat } = this.state.connectionHealth;
      if (!lastHeartbeat) return;

      if (Date.now() - lastHeartbeat > 45000) {
        this.state = {
          ...this.state,
          connectionHealth: {
            ...this.state.connectionHealth,
            isHealthy: false,
          },
        };
        this.notifyState();
        if (!this.healthWarningLogged) {
          this.healthWarningLogged = true;
          logger.warn("Connection health degraded - no heartbeat for 45s");
        }
      }
    }, 5000);
  }

  private stopHealthMonitor() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private shouldAutoReconnect() {
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.autoReconnect) {
        return true;
      }
    }
    return false;
  }
}

export function useWebSocket({
  campaignId,
  userId: _userId,
  role: _role,
  onMessage,
  onConnect,
  onDisconnect,
  autoReconnect = true,
}: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionHealth, setConnectionHealth] = useState<ConnectionHealth>({
    latency: null,
    lastHeartbeat: null,
    isHealthy: false,
  });
  const sharedRef = useRef<SharedConnection | null>(null);
  const callbacksRef = useRef({ onMessage, onConnect, onDisconnect });

  useEffect(() => {
    callbacksRef.current = { onMessage, onConnect, onDisconnect };
  }, [onMessage, onConnect, onDisconnect]);

  useEffect(() => {
    const connectionKey = getConnectionKey(campaignId);
    let shared = sharedConnections.get(connectionKey);
    if (!shared) {
      shared = new SharedConnection(connectionKey, campaignId);
      sharedConnections.set(connectionKey, shared);
    }
    sharedRef.current = shared;

    const subscriberId = nextSubscriberId++;
    shared.subscribe({
      id: subscriberId,
      autoReconnect,
      onStateChange: (state) => {
        setIsConnected(state.isConnected);
        setConnectionError(state.connectionError);
        setConnectionHealth(state.connectionHealth);
      },
      onMessage: (message) => callbacksRef.current.onMessage?.(message),
      onConnect: () => callbacksRef.current.onConnect?.(),
      onDisconnect: () => callbacksRef.current.onDisconnect?.(),
    });

    return () => {
      shared?.unsubscribe(subscriberId);
      if (sharedRef.current === shared) {
        sharedRef.current = null;
      }
    };
  }, [campaignId, autoReconnect]);

  const sendMessage = useCallback((message: WebSocketMessage) => {
    sharedRef.current?.sendMessage(message);
  }, []);

  const measureLatency = useCallback(() => {
    sharedRef.current?.measureLatency();
  }, []);

  const connect = useCallback(() => {
    sharedRef.current?.connect();
  }, []);

  const disconnect = useCallback(() => {
    sharedRef.current?.disconnect();
  }, []);

  return {
    isConnected,
    connectionError,
    connectionHealth,
    sendMessage,
    measureLatency,
    connect,
    disconnect,
  };
}
