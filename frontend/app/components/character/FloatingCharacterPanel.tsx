import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';
import { subscribeAppEvent } from '~/events/appEventBus';
import type { FloatingCharPanelConfig, CharPanelTab } from '~/hooks/useSidebarState';
import { useFloatingZIndex } from '~/stores/floatingZIndexStore';
import { useModalContextStore } from '~/stores/modalContextStore';
import { useFloatingPointerGuard } from '~/utils/floatingChatGuard';

interface FloatingCharacterPanelProps {
  config: FloatingCharPanelConfig;
  setConfig: (updates: Partial<FloatingCharPanelConfig>) => void;
  characterName?: string;
  equipmentContent: React.ReactNode | (() => React.ReactNode);
  featuresContent: React.ReactNode | (() => React.ReactNode);
  statusContent: React.ReactNode | (() => React.ReactNode);
  spellsContent?: React.ReactNode | (() => React.ReactNode);
}

const MIN_W = 350;
const MIN_H = 300;
const MAX_W = 900;
const MAX_H = 750;
const PANEL_Z_MAX = 10190;
const PANEL_Z_SINK_WHEN_MODAL = 10040;
const DEFAULT_W = 500;
const DEFAULT_H = 550;

const RESIZE_EDGE_PX = 14;
const RESIZE_CORNER_PX = 18;

const resizeHandleDot = (
  <div className="w-full h-full flex items-center justify-center pointer-events-none">
    <div className="w-4 h-4 rounded-full bg-amber-400/90 border border-black/40 shadow-[0_0_10px_rgba(245,158,11,0.35)] opacity-40 group-hover:opacity-100 transition-opacity" />
  </div>
);
const resizeHandleEmpty = <div className="w-full h-full pointer-events-none" />;

const TABS: { key: CharPanelTab; label: string; icon: string }[] = [
  { key: 'features', label: '特性', icon: '⚔️' },
  { key: 'equipment', label: '装备', icon: '🎒' },
  { key: 'status', label: '状态', icon: '✨' },
  { key: 'spells', label: '法术', icon: '📖' },
];

function getDefaultPosition() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    x: Math.max(60, vw - DEFAULT_W - 420),
    y: Math.max(50, (vh - DEFAULT_H) / 2),
  };
}

export function FloatingCharacterPanel({
  config, setConfig, characterName,
  equipmentContent, featuresContent, statusContent, spellsContent,
}: FloatingCharacterPanelProps) {
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const preMaxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const rndRef = useRef<Rnd | null>(null);
  const [zIndex, setZIndex] = useState(10050);
  const [sinkForForegroundModal, setSinkForForegroundModal] = useState(false);
  const bringToFront = useFloatingZIndex(s => s.bringToFront);
  const setModalContext = useModalContextStore(s => s.setModalContext);
  const clearModalContext = useModalContextStore(s => s.clearModalContext);

  // Local activeTab state — avoids parent re-render on tab switch
  const [activeTab, setActiveTabLocal] = useState<CharPanelTab>(config.activeTab);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  // Sync from parent config when it changes externally (e.g. restored from persistence)
  useEffect(() => {
    setActiveTabLocal(config.activeTab);
  }, [config.activeTab]);

  // Persist activeTab on unmount so it's saved for next session
  useEffect(() => {
    return () => {
      setConfig({ activeTab: activeTabRef.current });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setActiveTab = useCallback((tab: CharPanelTab) => {
    setActiveTabLocal(tab);
  }, []);

  // Prevent pointerdown on floating windows from reaching Radix DismissableLayer
  useFloatingPointerGuard();

  const visibleTabs = useMemo(() =>
    TABS.filter(t => t.key !== 'spells' || spellsContent),
    [spellsContent]
  );

  const normalizePanelZ = useCallback((rawZ: number) => Math.min(rawZ, PANEL_Z_MAX), []);
  const handleFocus = useCallback(() => {
    setZIndex(normalizePanelZ(bringToFront()));
  }, [bringToFront, normalizePanelZ]);

  useEffect(() => {
    setMounted(true);
    setIsMobile(window.innerWidth < 768);
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Sync active tab → modal context for AI assistant
  const TAB_DESCRIPTIONS: Record<CharPanelTab, string> = {
    equipment: '玩家正在查看装备/背包面板，可以询问装备相关问题',
    features: '玩家正在查看职业特性面板，可以询问特性/能力相关问题',
    status: '玩家正在查看状态效果面板，可以询问状态/增减益相关问题',
    spells: '玩家正在查看法术书面板，可以询问法术相关问题',
  };

  useEffect(() => {
    if (config.stage === 'open') {
      setModalContext('floatingCharPanel', TAB_DESCRIPTIONS[activeTab]);
    } else {
      clearModalContext('floatingCharPanel');
    }
  }, [config.stage, activeTab, setModalContext, clearModalContext]);

  const handleMinimize = useCallback(() => {
    setIsMaximized(false);
    setConfig({ stage: 'minimized', activeTab: activeTabRef.current });
  }, [setConfig]);

  // Auto-minimize when spell targeting starts (so map is visible)
  useEffect(() => {
    const handler = () => {
      if (config.stage === 'open') handleMinimize();
    };
    return subscribeAppEvent("startSpellTargeting", handler);
  }, [config.stage, handleMinimize]);

  const handleClose = useCallback(() => {
    setIsMaximized(false);
    setConfig({ stage: 'closed', activeTab: activeTabRef.current });
    clearModalContext('floatingCharPanel');
  }, [setConfig, clearModalContext]);

  const handleRestore = useCallback(() => {
    setConfig({ stage: 'open' });
  }, [setConfig]);

  const handleToggleMaximize = useCallback(() => {
    if (isMaximized) {
      const prev = preMaxRef.current;
      if (prev) {
        setConfig({ x: prev.x, y: prev.y, w: prev.w, h: prev.h });
        rndRef.current?.updatePosition({ x: prev.x, y: prev.y });
        rndRef.current?.updateSize({ width: prev.w, height: prev.h });
      }
      setIsMaximized(false);
    } else {
      preMaxRef.current = {
        x: config.x === -1 ? getDefaultPosition().x : config.x,
        y: config.x === -1 ? getDefaultPosition().y : config.y,
        w: config.w || DEFAULT_W,
        h: config.h || DEFAULT_H,
      };
      const pad = 8;
      const mw = window.innerWidth - pad * 2;
      const mh = window.innerHeight - pad * 2;
      setConfig({ x: pad, y: pad, w: mw, h: mh });
      rndRef.current?.updatePosition({ x: pad, y: pad });
      rndRef.current?.updateSize({ width: mw, height: mh });
      setIsMaximized(true);
    }
  }, [isMaximized, config, setConfig]);

  const { stage } = config;
  const isOpen = stage === 'open';

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      setSinkForForegroundModal(false);
      return;
    }

    let rafId: number | null = null;
    const updateSinkState = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')) as HTMLElement[];
        const hasForegroundDialog = dialogs.some((el) => {
          if (!el.isConnected) return false;
          if (el.classList.contains('floating-char-panel-window')) return false;
          if (el.closest('.floating-char-panel-window')) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });
        setSinkForForegroundModal(hasForegroundDialog);
      });
    };

    updateSinkState();
    const observer = new MutationObserver(updateSinkState);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-state', 'aria-hidden'],
    });
    window.addEventListener('focusin', updateSinkState);

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('focusin', updateSinkState);
    };
  }, [isOpen]);

  if (!mounted) return null;

  const resolve = (c: React.ReactNode | (() => React.ReactNode)) =>
    typeof c === 'function' ? c() : c;

  const tabContent = activeTab === 'equipment' ? resolve(equipmentContent)
    : activeTab === 'features' ? resolve(featuresContent)
    : activeTab === 'spells' ? resolve(spellsContent)
    : resolve(statusContent);

  // Mobile: modal with backdrop, no drag/resize, only close button
  if (isMobile) {
    if (!isOpen) return null;
    return createPortal(
      <div
        className="fixed inset-0 z-[10100] flex items-center justify-center"
        style={{ paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)' }}
        onClick={handleClose}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/60" />
        {/* Modal */}
        <div
          className="relative floating-char-panel-window flex flex-col rounded-xl shadow-2xl border border-amber-500/20"
          style={{ width: 'calc(100% - 24px)', height: 'calc(100% - 48px)', maxWidth: '100%', maxHeight: '100%' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Title bar with tabs + close */}
          <div className="floating-char-panel-titlebar flex items-center justify-between px-2 py-1.5 select-none rounded-t-xl">
            <div className="flex items-center gap-0.5 min-w-0">
              {characterName && (
                <span className="text-xs text-amber-300/80 font-medium truncate max-w-[80px] shrink-0 mr-1" title={characterName}>{characterName}</span>
              )}
              {visibleTabs.map(tab => (
                <button
                  key={tab.key}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    activeTab === tab.key
                      ? 'bg-amber-600/30 text-amber-200 font-medium'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                  }`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <span className="mr-1">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              onClick={handleClose}
              className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors rounded"
              title="关闭"
            >
              <span className="text-sm leading-none">✕</span>
            </button>
          </div>
          {/* Content */}
          <div className="flex-1 min-h-0 overflow-hidden rounded-b-xl">
            {tabContent}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // Desktop: draggable/resizable floating panel
  const pos = config.x === -1 ? getDefaultPosition() : { x: config.x, y: config.y };
  const size = { width: config.w || DEFAULT_W, height: config.h || DEFAULT_H };

  return createPortal(
    <>
      {/* Minimized badge */}
      {stage === 'minimized' && (
        <div
          className="floating-char-panel-minimized fixed z-[10100] flex items-center gap-2 px-3 py-2 rounded-t-lg shadow-lg cursor-pointer transition-all hover:brightness-110"
          style={{ bottom: 0, right: 120, pointerEvents: 'auto' }}
          onClick={handleRestore}
        >
          <span className="text-sm">🎒</span>
          <span className="text-xs text-amber-200/80 font-medium">
            {characterName || visibleTabs.find(t => t.key === activeTab)?.label || '装备'}
          </span>
          <button
            className="ml-1 text-gray-400 hover:text-white text-xs"
            onClick={(e) => { e.stopPropagation(); handleRestore(); }}
            title="恢复"
          >↗</button>
        </div>
      )}

      {/* Full window */}
      <Rnd
        ref={rndRef}
        default={{ ...pos, ...size }}
        position={config.x !== -1 ? pos : undefined}
        size={config.x !== -1 ? size : undefined}
        minWidth={MIN_W}
        minHeight={MIN_H}
        maxWidth={isMaximized ? undefined : MAX_W}
        maxHeight={isMaximized ? undefined : MAX_H}
        disableDragging={isMaximized}
        enableResizing={!isMaximized}
        dragHandleClassName="floating-char-panel-titlebar"
        bounds="window"
        className="floating-char-panel-window group"
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
          zIndex: isOpen ? (sinkForForegroundModal ? PANEL_Z_SINK_WHEN_MODAL : zIndex) : -1,
          visibility: isOpen ? 'visible' : 'hidden',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
        onMouseDown={handleFocus}
        onDragStop={(_e, d) => {
          setIsMaximized(false);
          setConfig({ x: d.x, y: d.y });
        }}
        onResizeStop={(_e, _dir, ref, _delta, position) => {
          setIsMaximized(false);
          setConfig({
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
        <div className="floating-char-panel-titlebar flex items-center justify-between px-2 py-1 select-none">
          <div className="flex items-center gap-0.5 min-w-0">
            {characterName && (
              <span className="text-xs text-amber-300/80 font-medium truncate max-w-[80px] shrink-0 mr-1" title={characterName}>{characterName}</span>
            )}
            {visibleTabs.map(tab => (
              <button
                key={tab.key}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  activeTab === tab.key
                    ? 'bg-amber-600/30 text-amber-200 font-medium'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                }`}
                onClick={() => setConfig({ activeTab: tab.key })}
              >
                <span className="mr-1">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
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

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-hidden" style={{ height: 'calc(100% - 36px)' }}>
          {tabContent}
        </div>
        </div>
      </Rnd>
    </>,
    document.body
  );
}
