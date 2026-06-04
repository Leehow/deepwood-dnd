/**
 * FloatingFilterPanel – pop-out a chat category as a draggable floating window.
 *
 * • Non-AI filters (combat / dice / system / chat-only / user-*):  read-only message monitor.
 * • AI mode:  full interactive AI chat with input area + streaming.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const remarkPluginsStable = [remarkGfm];
import { useFloatingZIndex } from '~/stores/floatingZIndexStore';
import { useFloatingPointerGuard } from '~/utils/floatingChatGuard';
import { useFloatingFilterPanelStore, type FilterPanelConfig } from '~/stores/floatingFilterPanelStore';
import { useChatMessageBroadcastStore } from '~/stores/chatMessageBroadcastStore';
import type { AiSession } from '~/services/chat.service';
import { fetchCampaignAiSessionsCached, fetchCampaignChatMessagesCached } from '~/queries/chatQueries';
import { transformBackendMessage, type Message } from '~/components/ui/hooks/useChatMessages';
import { DiceResultCard } from '~/components/ui/DiceResultCard';
import { apiFetch } from '~/utils/api-client';
import { formatCombatDisplay } from '~/utils/combatTextUtils';

// ─── Rnd constants ────────────────────────────────────────────
const MIN_W = 300, MIN_H = 220;
const MAX_W = 700, MAX_H = 650;

const resizeHandleDot = (
  <div className="w-full h-full flex items-center justify-center pointer-events-none">
    <div className="w-3 h-3 rounded-full bg-amber-400/80 border border-black/40 shadow-[0_0_8px_rgba(245,158,11,0.3)] opacity-30 group-hover:opacity-100 transition-opacity" />
  </div>
);
const resizeHandleEmpty = <div className="w-full h-full pointer-events-none" />;

// ─── Font size persistence ────────────────────────────────────
const FONT_SIZES = [11, 12, 13, 14] as const;
const DEFAULT_FONT_SIZE = 12;

function getFontSizeStorageKey(userId: string) {
  return `dw-fp-fontsize-${userId}`;
}

function loadFontSize(userId: string): number {
  try {
    const v = localStorage.getItem(getFontSizeStorageKey(userId));
    if (v) {
      const n = Number(v);
      if (FONT_SIZES.includes(n as any)) return n;
    }
  } catch { /* ignore */ }
  return DEFAULT_FONT_SIZE;
}

function saveFontSize(userId: string, size: number) {
  try { localStorage.setItem(getFontSizeStorageKey(userId), String(size)); } catch { /* ignore */ }
}

// ─── Helpers ──────────────────────────────────────────────────
function formatTime(d: Date) {
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function matchesFilter(msg: Message, filter: string, userId: string): boolean {
  if (filter === 'dice-filter') return msg.type === 'dice';
  if (filter === 'chat-only') {
    if (msg.type && msg.type !== 'chat' && (msg.type as string) !== 'text') return false;
    const c = msg.content;
    if (c && (c.startsWith('🔮') || c.startsWith('⚔️') || c.startsWith('🛡️') || c.startsWith('💨') || c.startsWith('🌀'))) return false;
    return true;
  }
  if (filter === 'ai') return msg.senderRole === 'ai' || msg.user === 'AI' || (msg.senderUserId === userId && !!msg.recipients?.includes('ai'));
  if (filter === 'system') return msg.type === 'system';
  if (filter === 'combat') return msg.type === 'combat';
  if (filter.startsWith('user-')) {
    const tid = filter.slice(5);
    return msg.senderUserId === tid || (msg.senderUserId === userId && !!msg.recipients?.includes(tid));
  }
  return false;
}

function getFilterQueryParams(filter: string): Record<string, any> | null {
  if (filter === 'dice-filter') return { messageType: 'dice' };
  if (filter === 'chat-only') return { messageType: 'chat' };
  if (filter === 'ai') return { aiConversation: true };
  if (filter === 'system') return { messageType: 'system' };
  if (filter === 'combat') return { messageType: 'combat' };
  if (filter.startsWith('user-')) return { filterUserId: filter.slice(5) };
  return null;
}

// ─── Single panel ─────────────────────────────────────────────
interface PanelProps {
  cfg: FilterPanelConfig;
  campaignId: string;
  userId: string;
  isDM: boolean;
}

function FloatingFilterPanelSingle({ cfg, campaignId, userId, isDM }: PanelProps) {
  const { closePanel, updatePanel } = useFloatingFilterPanelStore();
  const bringToFront = useFloatingZIndex(s => s.bringToFront);
  const [zIndex, setZIndex] = useState(() => bringToFront());

  // Font size (persisted per user)
  const [fontSize, setFontSize] = useState(() => loadFontSize(userId));
  const adjustFontSize = useCallback((delta: number) => {
    setFontSize(prev => {
      const idx = FONT_SIZES.indexOf(prev as any);
      const next = FONT_SIZES[Math.max(0, Math.min(FONT_SIZES.length - 1, idx + delta))];
      saveFontSize(userId, next);
      return next;
    });
  }, [userId]);

  // Messages state
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);

  // AI-specific state
  const isAI = cfg.filterKey === 'ai';
  const [aiInput, setAiInput] = useState('');
  const [aiTyping, setAiTyping] = useState(false);
  const [aiStreaming, setAiStreaming] = useState('');
  const [aiSessions, setAiSessions] = useState<AiSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);

  const handleFocus = useCallback(() => setZIndex(bringToFront()), [bringToFront]);

  // ── Load initial messages ──
  const loadMessages = useCallback(async (reset = false) => {
    if (loading || (!reset && !hasMore)) return;
    const params = getFilterQueryParams(cfg.filterKey);
    if (!params) return;
    setLoading(true);
    try {
      const oldestDbId = reset ? undefined : messages
        .map(m => m.dbId).filter((id): id is number => typeof id === 'number')
        .reduce((min, id) => (min === null ? id : Math.min(min, id)), null as number | null) ?? undefined;
      const opts: any = { beforeId: oldestDbId, limit: 50, ...params };
      if (isAI && currentSessionId) opts.aiSessionId = currentSessionId;
      const res = await fetchCampaignChatMessagesCached(campaignId, opts);
      if (res.messages?.length) {
        const msgs = res.messages.map(transformBackendMessage);
        if (reset) setMessages(msgs.reverse());
        else setMessages(prev => {
          const ids = new Set(prev.map(m => m.dbId).filter(Boolean));
          return [...msgs.filter(m => !m.dbId || !ids.has(m.dbId)).reverse(), ...prev];
        });
        setHasMore(res.messages.length === 50);
      } else {
        setHasMore(false);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [loading, hasMore, messages, cfg.filterKey, campaignId, userId, isDM, isAI, currentSessionId]);

  // Load on mount / session change
  useEffect(() => {
    setMessages([]);
    setHasMore(true);
    const t = setTimeout(() => loadMessages(true), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.filterKey, currentSessionId]);

  // ── Real-time: subscribe to broadcast store ──
  const broadcastSeq = useChatMessageBroadcastStore(s => s.seq);
  const latestMsg = useChatMessageBroadcastStore(s => s.latestMessage);
  useEffect(() => {
    if (!latestMsg) return;
    if (!matchesFilter(latestMsg, cfg.filterKey, userId)) return;
    setMessages(prev => {
      if (latestMsg.dbId && prev.some(m => m.dbId === latestMsg.dbId)) return prev;
      if (prev.some(m => m.id === latestMsg.id)) return prev;
      return [...prev, latestMsg];
    });
  }, [broadcastSeq, latestMsg, cfg.filterKey, userId]);

  // ── Auto-scroll to bottom ──
  useEffect(() => {
    if (isAtBottom.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, aiStreaming]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  // ── AI: Load sessions ──
  useEffect(() => {
    if (!isAI) return;
    fetchCampaignAiSessionsCached(campaignId).then(setAiSessions).catch(() => {});
  }, [isAI, campaignId]);

  // ── AI: Send message ──
  const handleAISend = useCallback(async () => {
    const text = aiInput.trim();
    if (!text || aiTyping) return;
    setAiInput('');
    const userMsg: Message = {
      id: `fp-user-${Date.now()}`,
      user: isDM ? 'DM' : userId.slice(0, 8),
      senderUserId: userId,
      senderRole: isDM ? 'dm' : 'player',
      content: text,
      type: 'chat',
      timestamp: new Date(),
      recipients: ['ai'],
    };
    setMessages(prev => [...prev, userMsg]);
    isAtBottom.current = true;

    setAiTyping(true);
    setAiStreaming('');
    try {
      const body: any = { content: text, recipients: ['ai'], sender_role: isDM ? 'dm' : 'player' };
      if (currentSessionId) body.ai_session_id = currentSessionId;
      const response = await apiFetch(`/api/campaigns/${campaignId}/chat/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('AI request failed');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setAiStreaming(acc);
      }
      const aiMsg: Message = {
        id: `fp-ai-${Date.now()}`,
        user: 'AI',
        senderRole: 'ai',
        content: acc,
        type: 'chat',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiMsg]);
      setAiStreaming('');
    } catch {
      setAiStreaming('');
    } finally {
      setAiTyping(false);
    }
  }, [aiInput, aiTyping, campaignId, userId, isDM, currentSessionId]);

  // ── Minimized badge ──
  if (cfg.stage === 'minimized') {
    return createPortal(
      <div
        className="floating-filter-panel-window fixed z-[10100] flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg bg-gray-800/95 border border-gray-600/50 shadow-lg cursor-pointer hover:bg-gray-700/90 transition-all"
        style={{ bottom: 0, right: 120 + useFloatingFilterPanelStore.getState().panels.indexOf(cfg) * 120 }}
        onClick={() => updatePanel(cfg.filterKey, { stage: 'open' })}
        onMouseDown={handleFocus}
      >
        <span className="text-sm">{cfg.filterEmoji}</span>
        <span className="text-xs text-gray-300 font-medium">{cfg.filterLabel}</span>
      </div>,
      document.body,
    );
  }

  // ── Full window ──
  const sorted = useMemo(() =>
    messages.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
    [messages],
  );

  // Dynamic style for message content based on font size
  const contentStyle = useMemo(() => ({ fontSize: `${fontSize}px`, lineHeight: '1.5' }), [fontSize]);

  return createPortal(
    <Rnd
      default={{ x: cfg.x, y: cfg.y, width: cfg.w, height: cfg.h }}
      minWidth={MIN_W} minHeight={MIN_H}
      maxWidth={MAX_W} maxHeight={MAX_H}
      dragHandleClassName="floating-filter-titlebar"
      bounds="window"
      className="floating-filter-panel-window group"
      resizeHandleStyles={{
        top: { height: '12px' }, bottom: { height: '12px' },
        left: { width: '12px' }, right: { width: '12px' },
        topLeft: { width: '16px', height: '16px' }, topRight: { width: '16px', height: '16px' },
        bottomLeft: { width: '16px', height: '16px' }, bottomRight: { width: '16px', height: '16px' },
      }}
      resizeHandleComponent={{
        top: resizeHandleDot, topLeft: resizeHandleDot, topRight: resizeHandleDot,
        bottomLeft: resizeHandleDot, bottomRight: resizeHandleDot,
        bottom: resizeHandleEmpty, left: resizeHandleEmpty, right: resizeHandleEmpty,
      }}
      style={{ zIndex }}
      onMouseDown={handleFocus}
      onDragStop={(_e, d) => updatePanel(cfg.filterKey, { x: d.x, y: d.y })}
      onResizeStop={(_e, _d, ref, _delta, pos) => updatePanel(cfg.filterKey, {
        w: parseInt(ref.style.width), h: parseInt(ref.style.height), x: pos.x, y: pos.y,
      })}
    >
      <div className="flex flex-col w-full h-full rounded-xl overflow-hidden border border-gray-600/50 bg-gray-900/95 backdrop-blur-md shadow-2xl">
        {/* Title bar */}
        <div className="floating-filter-titlebar flex items-center justify-between px-3 py-1.5 bg-gray-800/80 border-b border-gray-700/40 select-none cursor-move">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">{cfg.filterEmoji}</span>
            <span className="text-xs text-gray-200 font-medium">{cfg.filterLabel}</span>
          </div>
          <div className="flex items-center gap-0.5">
            {/* AI session selector */}
            {isAI && aiSessions.length > 0 && (
              <select
                value={currentSessionId ?? ''}
                onChange={(e) => setCurrentSessionId(e.target.value ? Number(e.target.value) : null)}
                className="text-[10px] bg-gray-700/60 border border-gray-600/40 rounded px-1 py-0.5 text-gray-300 mr-1 max-w-[100px]"
              >
                <option value="">默认会话</option>
                {aiSessions.map(s => (
                  <option key={s.id} value={s.id}>{s.title || `会话 ${s.id}`}</option>
                ))}
              </select>
            )}
            {/* Font size controls */}
            <button
              onClick={() => adjustFontSize(-1)}
              disabled={fontSize <= FONT_SIZES[0]}
              className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-amber-300 disabled:opacity-30 disabled:hover:text-gray-400 transition-colors rounded text-[10px] font-bold"
              title={`缩小字号 (${fontSize}px)`}
            >A-</button>
            <button
              onClick={() => adjustFontSize(1)}
              disabled={fontSize >= FONT_SIZES[FONT_SIZES.length - 1]}
              className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-amber-300 disabled:opacity-30 disabled:hover:text-gray-400 transition-colors rounded text-[10px] font-bold"
              title={`放大字号 (${fontSize}px)`}
            >A+</button>
            <div className="w-px h-3 bg-gray-600/40 mx-0.5" />
            <button
              onClick={() => updatePanel(cfg.filterKey, { stage: 'minimized' })}
              className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-amber-300 transition-colors rounded"
              title="最小化"
            ><span className="text-xs leading-none">_</span></button>
            <button
              onClick={() => closePanel(cfg.filterKey)}
              className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors rounded"
              title="关闭"
            ><span className="text-xs leading-none">✕</span></button>
          </div>
        </div>

        {/* Message list */}
        <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-2.5 py-2 space-y-1 scrollbar-thin scrollbar-thumb-gray-700" style={contentStyle}>
          {hasMore && (
            <div className="flex justify-center">
              <button onClick={() => loadMessages()} disabled={loading}
                className="text-[10px] px-3 py-1 border border-gray-600/40 rounded-lg hover:bg-gray-700/50 disabled:opacity-50 text-gray-400 transition-all"
              >{loading ? '加载中...' : '加载更多'}</button>
            </div>
          )}
          {sorted.map(msg => (
            <div key={msg.id} className={`rounded-lg transition-colors ${
              msg.type === 'system' ? 'text-gray-500 px-2 py-1 bg-gray-800/20'
              : msg.type === 'combat' ? 'bg-red-950/30 border border-red-500/20 px-2 py-1.5'
              : msg.type === 'dice' ? 'bg-gray-800/30 border border-amber-500/10 px-2 py-1.5'
              : msg.senderRole === 'ai' ? 'bg-emerald-950/20 border border-emerald-500/15 px-2 py-1.5'
              : 'bg-gray-800/25 border border-gray-700/30 px-2 py-1.5'
            }`}>
              {msg.type === 'system' ? (
                <div className="text-gray-500 italic">{msg.content}</div>
              ) : (
                <>
                  <div className="flex items-baseline gap-1.5 mb-0.5">
                    <span className={`font-semibold ${
                      msg.senderRole === 'dm' ? 'text-amber-400'
                      : msg.senderRole === 'ai' ? 'text-emerald-300'
                      : 'text-blue-400'
                    }`} style={{ fontSize: `${fontSize}px` }}>{msg.user}</span>
                    <span className="text-gray-600" style={{ fontSize: `${Math.max(9, fontSize - 3)}px` }}>{formatTime(msg.timestamp)}</span>
                    {msg.type === 'dice' && <span className="px-1 py-0.5 rounded-full bg-amber-500/15 text-amber-400/90 border border-amber-500/20 leading-none" style={{ fontSize: `${Math.max(8, fontSize - 4)}px` }}>骰子</span>}
                    {msg.type === 'combat' && <span className="px-1 py-0.5 rounded-full bg-red-500/15 text-red-400/90 border border-red-500/20 leading-none" style={{ fontSize: `${Math.max(8, fontSize - 4)}px` }}>战斗</span>}
                  </div>
                  <div className="text-gray-300 max-w-none [&_p]:my-0.5 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:my-0 [&_strong]:text-gray-200 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs">
                    {msg.type === 'dice' && (msg.meta as any)?.diceRoll ? (
                      <DiceResultCard roll={(msg.meta as any).diceRoll} userName={msg.user} timestamp={msg.timestamp} messageId={msg.dbId || msg.id} compact />
                    ) : msg.type === 'combat' ? (
                      <div className="combat-msg space-y-0.5">
                        <ReactMarkdown remarkPlugins={remarkPluginsStable}>{formatCombatDisplay(msg.content)}</ReactMarkdown>
                        {/* DM-only: Show target AC */}
                        {isDM && (msg.meta as any)?.target_ac != null && (
                          <div className="mt-0.5">
                            <span className="px-1.5 py-0.5 rounded bg-gray-700/50 border border-gray-600 text-gray-400" style={{ fontSize: `${Math.max(9, fontSize - 3)}px` }}>
                              🛡️ AC: {(msg.meta as any).target_ac}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <ReactMarkdown remarkPlugins={remarkPluginsStable}>{msg.content}</ReactMarkdown>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}

          {/* AI streaming indicator */}
          {aiTyping && (
            <div className="rounded-lg bg-emerald-950/20 border border-emerald-500/15 px-2 py-1.5">
              <div className="flex items-baseline gap-1.5 mb-0.5">
                <span className="font-semibold text-emerald-300" style={{ fontSize: `${fontSize}px` }}>AI</span>
                <span className="text-gray-600" style={{ fontSize: `${Math.max(9, fontSize - 3)}px` }}>{formatTime(new Date())}</span>
              </div>
              {aiStreaming ? (
                <div className="text-gray-300 max-w-none [&_p]:my-0.5">
                  <ReactMarkdown remarkPlugins={remarkPluginsStable}>{aiStreaming}</ReactMarkdown>
                  <span className="inline-block w-1.5 h-3 bg-emerald-400/70 animate-pulse ml-0.5 rounded-sm" />
                </div>
              ) : (
                <div className="flex items-center gap-1 text-emerald-400/70">
                  <span className="animate-pulse">●</span>
                  <span>思考中...</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* AI input area */}
        {isAI && (
          <div className="border-t border-gray-700/40 px-2.5 py-1.5 bg-gray-800/40">
            <div className="flex items-end gap-1.5">
              <textarea
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAISend(); }
                }}
                placeholder="向 AI 助手提问..."
                rows={1}
                className="flex-1 bg-gray-800/60 border border-gray-600/40 rounded-lg px-2.5 py-1.5 text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 resize-none"
                style={{ fontSize: `${fontSize}px` }}
              />
              <button
                onClick={handleAISend}
                disabled={!aiInput.trim() || aiTyping}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/50 disabled:opacity-40 transition-all"
              >发送</button>
            </div>
          </div>
        )}
      </div>
    </Rnd>,
    document.body,
  );
}

// ─── Container ────────────────────────────────────────────────
interface FloatingFilterPanelsProps {
  campaignId: string;
  userId: string;
  isDM: boolean;
}

export function FloatingFilterPanels({ campaignId, userId, isDM }: FloatingFilterPanelsProps) {
  const panels = useFloatingFilterPanelStore(s => s.panels);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useFloatingPointerGuard();

  useEffect(() => {
    setMounted(true);
    setIsMobile(window.innerWidth < 768);
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!mounted || isMobile || panels.length === 0) return null;

  return (
    <>
      {panels.map(p => (
        <FloatingFilterPanelSingle key={p.filterKey} cfg={p} campaignId={campaignId} userId={userId} isDM={isDM} />
      ))}
    </>
  );
}
