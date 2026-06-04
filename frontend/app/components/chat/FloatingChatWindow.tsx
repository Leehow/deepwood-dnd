import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';
import { ChatUnreadBadge } from './ChatUnreadBadge';
import type { FloatingChatConfig } from '~/hooks/useSidebarState';
import { usePhoneLikeLayout } from '~/hooks/usePhoneLikeLayout';
import { useFloatingZIndex } from '~/stores/floatingZIndexStore';
import { useFloatingPointerGuard } from '~/utils/floatingChatGuard';

type ChatMode = 'chatroom' | 'ai-assistant';

interface FloatingChatWindowProps {
  isDM: boolean;
  campaignId: string;
  userId: string;
  sidebarStateLoaded?: boolean;
  currentMapUrl?: string | null;
  activeSubTab?: string;
  onSubTabChange?: (tab: string) => void;
  floatingChat: FloatingChatConfig;
  setFloatingChat: (updates: Partial<FloatingChatConfig>) => void;
  unreadCount: number;
  selectedModule?: string | null;
  enable3DDice?: boolean;
}

const MIN_W = 300;
const MIN_H = 250;
const MAX_W = 800;
const MAX_H = 700;
const DEFAULT_W = 400;
const DEFAULT_H = 500;

const LazyChatPanel = lazy(() =>
  import('~/components/ui/ChatPanel').then((mod) => ({ default: mod.ChatPanel }))
);

// Make resize handles easier to grab (the default react-rnd/re-resizable handles are quite small)
const RESIZE_EDGE_PX = 14;
const RESIZE_CORNER_PX = 18;

// We only render a visible “dot” on the handles users naturally look for (top + corners).
// Other edges still have enlarged hit areas, but no always-visible dot to avoid UI noise.
const resizeHandleDot = (
  <div className="w-full h-full flex items-center justify-center pointer-events-none">
    <div className="w-4 h-4 rounded-full bg-amber-400/90 border border-black/40 shadow-[0_0_10px_rgba(245,158,11,0.35)] opacity-40 group-hover:opacity-100 transition-opacity" />
  </div>
);

const resizeHandleEmpty = <div className="w-full h-full pointer-events-none" />;

function getDefaultPosition() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    x: Math.max(60, vw - DEFAULT_W - 420),
    y: Math.max(50, (vh - DEFAULT_H) / 2),
  };
}

export function FloatingChatWindow({
  isDM, campaignId, userId, sidebarStateLoaded = true, currentMapUrl,
  activeSubTab, onSubTabChange,
  floatingChat, setFloatingChat, unreadCount,
  selectedModule, enable3DDice,
}: FloatingChatWindowProps) {
  const [mounted, setMounted] = useState(false);
  const isPhoneLike = usePhoneLikeLayout();
  const [isMaximized, setIsMaximized] = useState(false);
  const [shouldMountChatPanel, setShouldMountChatPanel] = useState(false);
  const preMaxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const rndRef = useRef<Rnd | null>(null);
  const warmupTimeoutRef = useRef<number | null>(null);
  const idleCallbackRef = useRef<number | null>(null);
  const [zIndex, setZIndex] = useState(10051);
  const [chatMode, setChatMode] = useState<ChatMode>('chatroom');
  const bringToFront = useFloatingZIndex(s => s.bringToFront);

  // Prevent pointerdown on floating windows from reaching Radix DismissableLayer
  useFloatingPointerGuard();

  const handleFocus = useCallback(() => {
    setZIndex(bringToFront());
  }, [bringToFront]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleMinimize = useCallback(() => {
    setIsMaximized(false);
    setFloatingChat({ stage: 'minimized' });
  }, [setFloatingChat]);

  const handleClose = useCallback(() => {
    setIsMaximized(false);
    setFloatingChat({ stage: 'closed' });
  }, [setFloatingChat]);

  const handleRestore = useCallback(() => {
    setFloatingChat({ stage: 'open' });
  }, [setFloatingChat]);

  const handleToggleMaximize = useCallback(() => {
    if (isMaximized) {
      // Restore previous size/position
      const prev = preMaxRef.current;
      if (prev) {
        setFloatingChat({ x: prev.x, y: prev.y, w: prev.w, h: prev.h });
        rndRef.current?.updatePosition({ x: prev.x, y: prev.y });
        rndRef.current?.updateSize({ width: prev.w, height: prev.h });
      }
      setIsMaximized(false);
    } else {
      // Save current size/position, then maximize
      preMaxRef.current = {
        x: floatingChat.x === -1 ? getDefaultPosition().x : floatingChat.x,
        y: floatingChat.x === -1 ? getDefaultPosition().y : floatingChat.y,
        w: floatingChat.w || DEFAULT_W,
        h: floatingChat.h || DEFAULT_H,
      };
      const pad = 8;
      const mw = window.innerWidth - pad * 2;
      const mh = window.innerHeight - pad * 2;
      setFloatingChat({ x: pad, y: pad, w: mw, h: mh });
      rndRef.current?.updatePosition({ x: pad, y: pad });
      rndRef.current?.updateSize({ width: mw, height: mh });
      setIsMaximized(true);
    }
  }, [isMaximized, floatingChat, setFloatingChat]);

  // Auto-minimize is disabled: chat window stays accessible over modals
  // The z-index (200) ensures it floats above dialog overlays (z-100)

  useEffect(() => {
    if (!mounted || isPhoneLike || !sidebarStateLoaded || shouldMountChatPanel) {
      return;
    }

    const clearScheduledWarmup = () => {
      if (warmupTimeoutRef.current !== null) {
        window.clearTimeout(warmupTimeoutRef.current);
        warmupTimeoutRef.current = null;
      }
      if (idleCallbackRef.current !== null && 'cancelIdleCallback' in window) {
        (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(idleCallbackRef.current);
        idleCallbackRef.current = null;
      }
    };

    if (floatingChat.stage === 'open') {
      setShouldMountChatPanel(true);
      return clearScheduledWarmup;
    }

    if (!floatingChat.hasOpened) {
      return clearScheduledWarmup;
    }

    const warmup = () => {
      setShouldMountChatPanel(true);
      warmupTimeoutRef.current = null;
      idleCallbackRef.current = null;
    };

    if ('requestIdleCallback' in window) {
      idleCallbackRef.current = (
        window as Window & { requestIdleCallback: (cb: () => void, options?: { timeout: number }) => number }
      ).requestIdleCallback(warmup, { timeout: 1500 });
    } else {
      warmupTimeoutRef.current = (window as any).setTimeout(warmup, 350);
    }

    return clearScheduledWarmup;
  }, [mounted, isPhoneLike, sidebarStateLoaded, shouldMountChatPanel, floatingChat.stage, floatingChat.hasOpened]);

  if (!mounted || isPhoneLike) return null;

  const { stage } = floatingChat;
  const isOpen = stage === 'open';

  // Open state position/size
  const pos = floatingChat.x === -1 ? getDefaultPosition() : { x: floatingChat.x, y: floatingChat.y };
  const size = { width: floatingChat.w || DEFAULT_W, height: floatingChat.h || DEFAULT_H };

  return createPortal(
    <>
      {/* Minimized badge - always rendered, visible when not open */}
      {!isOpen && (
        <div
          className="floating-chat-minimized fixed z-[10100] flex items-center gap-2 px-3 py-2 rounded-t-lg shadow-lg cursor-pointer transition-all hover:brightness-110"
          style={{ bottom: 0, right: 420, pointerEvents: 'auto' }}
          onClick={handleRestore}
        >
          <span className="text-sm">💬</span>
          <span className="text-xs text-amber-200/80 font-medium">聊天</span>
          {unreadCount > 0 && <ChatUnreadBadge count={unreadCount} />}
          <button
            className="ml-1 text-gray-400 hover:text-white text-xs"
            onClick={(e) => { e.stopPropagation(); handleRestore(); }}
            title="恢复"
          >↗</button>
        </div>
      )}

      {/* Full window stays mounted; chat content mounts on first open, then remains available */}
      <Rnd
        ref={rndRef}
        default={{ ...pos, ...size }}
        position={floatingChat.x !== -1 ? pos : undefined}
        size={floatingChat.x !== -1 ? size : undefined}
        minWidth={MIN_W}
        minHeight={MIN_H}
        maxWidth={isMaximized ? undefined : MAX_W}
        maxHeight={isMaximized ? undefined : MAX_H}
        disableDragging={isMaximized}
        enableResizing={!isMaximized}
        dragHandleClassName="floating-chat-titlebar"
        bounds="window"
        className="floating-chat-window group"
        resizeHandleStyles={{
          top: { height: `${RESIZE_EDGE_PX}px` },
          bottom: { height: `${RESIZE_EDGE_PX}px` },
          left: { width: `${RESIZE_EDGE_PX}px` },
          right: { width: `${RESIZE_EDGE_PX}px` },
          topLeft: { width: `${RESIZE_CORNER_PX}px`, height: `${RESIZE_CORNER_PX}px` },
          topRight: { width: `${RESIZE_CORNER_PX}px`, height: `${RESIZE_CORNER_PX}px` },
          bottomLeft: { width: `${RESIZE_CORNER_PX}px`, height: `${RESIZE_CORNER_PX}px` },
          bottomRight: { width: `${RESIZE_CORNER_PX}px`, height: `${RESIZE_CORNER_PX}px` },
        }}
        resizeHandleComponent={{
          top: resizeHandleDot,
          bottom: resizeHandleEmpty,
          left: resizeHandleEmpty,
          right: resizeHandleEmpty,
          topLeft: resizeHandleDot,
          topRight: resizeHandleDot,
          bottomLeft: resizeHandleDot,
          bottomRight: resizeHandleDot,
        }}
        style={{
          zIndex: isOpen ? zIndex : -1,
          visibility: isOpen ? 'visible' : 'hidden',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
        onMouseDown={handleFocus}
        onDragStop={(_e, d) => {
          setIsMaximized(false);
          setFloatingChat({ x: d.x, y: d.y });
        }}
        onResizeStop={(_e, _dir, ref, _delta, position) => {
          setIsMaximized(false);
          setFloatingChat({
            w: parseInt(ref.style.width),
            h: parseInt(ref.style.height),
            x: position.x,
            y: position.y,
          });
        }}
      >
        {/* Inner wrapper */}
        <div className="flex flex-col w-full h-full">
          {/* Title bar with tabs */}
          <div className="floating-chat-titlebar flex items-center justify-between px-2 py-1 select-none">
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setChatMode('chatroom')}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  chatMode === 'chatroom'
                    ? 'bg-amber-600/30 text-amber-200 font-medium'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                }`}
              >
                <span className="mr-1">💬</span>
                聊天室
              </button>
              <button
                onClick={() => setChatMode('ai-assistant')}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  chatMode === 'ai-assistant'
                    ? 'bg-amber-600/30 text-amber-200 font-medium'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                }`}
              >
                <span className="mr-1">🤖</span>
                AI 助手
              </button>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={handleMinimize}
                className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-amber-300 transition-colors rounded"
                title="最小化"
              >
                <span className="text-xs leading-none">_</span>
              </button>
              <button
                onClick={handleToggleMaximize}
                className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-amber-300 transition-colors rounded"
                title={isMaximized ? '恢复' : '最大化'}
              >
                <span className="text-xs leading-none">{isMaximized ? '⧉' : '□'}</span>
              </button>
              <button
                onClick={handleClose}
                className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors rounded"
                title="关闭"
              >
                <span className="text-xs leading-none">✕</span>
              </button>
            </div>
          </div>

          {/* Chat content mounts lazily on first use, then stays mounted for state and live updates */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ height: 'calc(100% - 32px)' }}>
            {shouldMountChatPanel ? (
              <Suspense fallback={null}>
                <LazyChatPanel
                  isDM={isDM}
                  campaignId={campaignId}
                  userId={userId}
                  currentMapUrl={currentMapUrl}
                  activeSubTab={activeSubTab}
                  onSubTabChange={onSubTabChange}
                  selectedModule={selectedModule}
                  enable3DDice={enable3DDice}
                  chatMode={chatMode}
                  onChatModeChange={setChatMode}
                />
              </Suspense>
            ) : isOpen ? (
              <div className="flex-1 flex items-center justify-center text-xs text-gray-400">
                正在恢复聊天...
              </div>
            ) : null}
          </div>
        </div>
        </Rnd>
    </>,
    document.body
  );
}
