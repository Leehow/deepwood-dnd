import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { VoiceInput } from "./VoiceInput";
import type { Message } from "./hooks/useChatMessages";
import { chatService, type AiSession } from "~/services/chat.service";

interface AIAssistantViewProps {
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onSend: (text: string) => void;
  aiTyping: boolean;
  aiStreamingContent: string;
  isAiStreaming: boolean;
  aiError: string | null;
  userId: string;
  isDM: boolean;
  formatTime: (d: Date) => string;
  renderTtsButton: (msg: Message) => ReactNode;
  onDelete: (dbId: number) => void;
  pendingDeleteId: number | null;
  // Session management
  campaignId: string | number;
  aiSessions: AiSession[];
  currentAiSessionId: number | null;
  onSessionChange: (id: number | null) => void;
  onSessionsUpdate: (sessions: AiSession[]) => void;
}

const COLLAPSE_THRESHOLD = 300;

function generateSummary(content: string): string {
  const plain = content
    .replace(/^#+\s*/gm, '')
    .replace(/\*+([^*]+)\*+/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim();
  const lines = plain.split('\n').filter(l => l.trim().length > 10);
  const firstLine = lines[0] || plain.substring(0, 100);
  if (firstLine.length > 100) return firstLine.substring(0, 97) + '...';
  return firstLine + (lines.length > 1 ? '...' : '');
}

/**
 * Arcane Sage theme — emerald/teal markdown for the AI assistant.
 * Designed to evoke a mystical forest advisor: bioluminescent accents,
 * crystalline decorators, deep-wood atmosphere distinct from the
 * module chat's amber/torchlight palette.
 */
const aiMarkdownComponents = {
  h1: ({ children }: any) => (
    <h1 className="text-base font-bold text-emerald-400 mt-4 mb-2 pb-1.5 border-b border-emerald-800/40 flex items-center gap-2">
      <span className="text-teal-500 text-xs">✧</span>{children}
    </h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="text-sm font-bold text-emerald-300 mt-4 mb-2 flex items-center gap-2">
      <span className="text-emerald-600 text-xs">◈</span>{children}
    </h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="text-sm font-semibold text-teal-300/90 mt-3 mb-1">{children}</h3>
  ),
  p: ({ children }: any) => <p className="my-2 leading-relaxed text-gray-300">{children}</p>,
  ul: ({ children }: any) => <ul className="my-2 space-y-1 ml-1">{children}</ul>,
  ol: ({ children }: any) => <ol className="my-2 space-y-1 ml-4 list-decimal list-outside text-gray-300 marker:text-emerald-700">{children}</ol>,
  li: ({ children }: any) => (
    <li className="flex items-start gap-2 text-gray-300">
      <span className="text-emerald-600 mt-[7px] text-[5px] shrink-0">◆</span>
      <span className="flex-1">{children}</span>
    </li>
  ),
  table: ({ children }: any) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-emerald-900/40">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: any) => (
    <thead className="bg-emerald-950/30 border-b border-emerald-900/40">{children}</thead>
  ),
  tbody: ({ children }: any) => <tbody className="divide-y divide-gray-800/50">{children}</tbody>,
  tr: ({ children }: any) => <tr className="hover:bg-emerald-950/20 transition-colors">{children}</tr>,
  th: ({ children }: any) => (
    <th className="px-3 py-2 text-left text-xs font-semibold text-emerald-300 uppercase tracking-wider">{children}</th>
  ),
  td: ({ children }: any) => (
    <td className="px-3 py-2 text-gray-300">{children}</td>
  ),
  code: ({ className, children }: any) => {
    const isInline = !className;
    return isInline ? (
      <code className="px-1.5 py-0.5 bg-emerald-950/40 border border-emerald-800/30 rounded text-teal-300 text-xs font-mono">{children}</code>
    ) : (
      <code className="block bg-gray-950/60 border border-gray-700/40 p-3 rounded my-2 text-xs font-mono text-gray-300 overflow-x-auto whitespace-pre">{children}</code>
    );
  },
  pre: ({ children }: any) => <pre className="bg-gray-950/60 border border-gray-700/40 rounded my-2 overflow-x-auto whitespace-pre">{children}</pre>,
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-2 border-emerald-700/60 pl-3 my-2 text-gray-400 italic bg-emerald-950/10 py-1 rounded-r">{children}</blockquote>
  ),
  hr: () => (
    <div className="my-4 flex items-center gap-2">
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-emerald-800/50 to-transparent" />
      <span className="text-teal-700 text-[10px]">❋</span>
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-emerald-800/50 to-transparent" />
    </div>
  ),
  strong: ({ children }: any) => <strong className="font-bold text-emerald-200">{children}</strong>,
  em: ({ children }: any) => <em className="italic text-gray-400">{children}</em>,
  a: ({ children, href }: any) => (
    <a href={href} className="text-teal-400 hover:text-teal-300 underline decoration-teal-600/30 underline-offset-2 transition-colors">{children}</a>
  ),
};

export function AIAssistantView({
  messages, loading, hasMore, onLoadMore, onSend,
  aiTyping, aiStreamingContent, isAiStreaming, aiError,
  userId, isDM, formatTime, renderTtsButton, onDelete, pendingDeleteId,
  campaignId, aiSessions, currentAiSessionId, onSessionChange, onSessionsUpdate,
}: AIAssistantViewProps) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isInitialLoadRef = useRef(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [collapsedMessages, setCollapsedMessages] = useState<Set<string>>(new Set());
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [chatBoxHeight, setChatBoxHeight] = useState<number | null>(null);
  const chatResizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<number | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);

  const toggleCollapse = useCallback((msgId: string) => {
    setCollapsedMessages(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }, []);

  const scrollToBottom = useCallback((instant = false) => {
    requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior: instant ? "auto" : "auto", block: "end" });
    });
  }, []);

  useEffect(() => {
    if (isInitialLoadRef.current && messages.length > 0 && !loading) {
      isInitialLoadRef.current = false;
      scrollToBottom(true);
    }
  }, [messages, loading, scrollToBottom]);

  useEffect(() => {
    if (isAtBottom) scrollToBottom();
  }, [messages, aiStreamingContent, aiTyping, isAtBottom, scrollToBottom]);

  // Close session menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sessionMenuRef.current && !sessionMenuRef.current.contains(e.target as Node)) {
        setShowSessionMenu(false);
        setPendingDeleteSessionId(null);
      }
    };
    if (showSessionMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSessionMenu]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setIsAtBottom(atBottom);
    if (el.scrollTop < 40 && hasMore && !loading) onLoadMore();
  }, [hasMore, loading, onLoadMore]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isChatExpanded) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend(); }
    } else {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    }
  };

  // Session actions
  const handleCreateSession = async () => {
    try {
      const session = await chatService.createAiSession(campaignId, userId);
      onSessionsUpdate([session, ...aiSessions]);
      onSessionChange(session.id);
      setShowSessionMenu(false);
    } catch { /* ignore */ }
  };

  const handleDeleteSession = async (sessionId: number) => {
    if (pendingDeleteSessionId !== sessionId) {
      setPendingDeleteSessionId(sessionId);
      // Auto-clear after 3 seconds
      setTimeout(() => setPendingDeleteSessionId(prev => prev === sessionId ? null : prev), 3000);
      return;
    }
    // Confirmed
    setPendingDeleteSessionId(null);
    try {
      await chatService.deleteAiSession(campaignId, sessionId, userId);
      const updated = aiSessions.filter(s => s.id !== sessionId);
      onSessionsUpdate(updated);
      if (currentAiSessionId === sessionId) {
        const next = updated[0];
        if (next) {
          onSessionChange(next.id);
        } else {
          handleCreateSession();
        }
      }
    } catch { /* ignore */ }
  };

  const handleRenameSession = async (sessionId: number) => {
    if (!editingTitle.trim()) return;
    try {
      const updated = await chatService.renameAiSession(campaignId, sessionId, userId, editingTitle.trim());
      onSessionsUpdate(aiSessions.map(s => s.id === sessionId ? updated : s));
      setEditingSessionId(null);
    } catch { /* ignore */ }
  };

  const currentSessionTitle = aiSessions.find(s => s.id === currentAiSessionId)?.title || '新会话';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Session bar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-700/30 bg-gray-900/40">
        <div className="relative" ref={sessionMenuRef}>
          <button
            onClick={() => setShowSessionMenu(!showSessionMenu)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-300 hover:text-white bg-gray-800/60 hover:bg-gray-700/60 border border-gray-700/40 transition-colors max-w-[180px]"
          >
            <svg className="w-3.5 h-3.5 shrink-0 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="truncate">{currentSessionTitle}</span>
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {showSessionMenu && (
            <div className="absolute left-0 top-full mt-1 bg-gray-800 border border-gray-700/60 rounded-lg shadow-xl shadow-black/50 z-50 min-w-[220px] max-h-[320px] overflow-y-auto">
              {/* Sessions list */}
              {aiSessions.map(s => (
                <div
                  key={s.id}
                  className={`group/session flex items-center gap-1 px-3 py-2 text-xs hover:bg-gray-700/60 transition-colors cursor-pointer ${
                    currentAiSessionId === s.id ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-300'
                  }`}
                  onClick={() => { onSessionChange(s.id); setShowSessionMenu(false); }}
                >
                  {editingSessionId === s.id ? (
                    <input
                      autoFocus
                      value={editingTitle}
                      onChange={e => setEditingTitle(e.target.value)}
                      onBlur={() => handleRenameSession(s.id)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRenameSession(s.id); if (e.key === 'Escape') setEditingSessionId(null); }}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 bg-gray-700 border border-emerald-500/40 rounded px-1.5 py-0.5 text-xs text-gray-200 outline-none"
                    />
                  ) : (
                    <>
                      <span className="flex-1 truncate">{s.title}</span>
                      <div className={`${pendingDeleteSessionId === s.id ? 'flex' : 'hidden group-hover/session:flex'} items-center gap-0.5`}>
                        <button
                          onClick={e => { e.stopPropagation(); setEditingSessionId(s.id); setEditingTitle(s.title); }}
                          className="p-0.5 rounded hover:bg-gray-600 text-gray-500 hover:text-gray-300"
                          title="重命名"
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteSession(s.id); }}
                          className={`p-0.5 rounded transition-all ${
                            pendingDeleteSessionId === s.id
                              ? 'bg-red-500/20 text-red-400'
                              : 'hover:bg-red-500/20 text-gray-500 hover:text-red-400'
                          }`}
                          title={pendingDeleteSessionId === s.id ? '再次点击确认删除' : '删除会话'}
                        >
                          {pendingDeleteSessionId === s.id ? (
                            <span className="text-[10px] px-1">确认?</span>
                          ) : (
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}

              {/* New session button */}
              <div className="border-t border-gray-700/40">
                <button
                  onClick={handleCreateSession}
                  className="w-full px-3 py-2 text-left text-xs text-emerald-400 hover:bg-emerald-500/10 transition-colors flex items-center gap-2"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  新建会话
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Quick new session button */}
        <button
          onClick={handleCreateSession}
          className="p-1 rounded-lg text-gray-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
          title="新建会话"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Messages area */}
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent"
        onScroll={handleScroll}
      >
        {loading && <div className="text-center text-gray-500 text-xs py-2">加载中...</div>}
        {!loading && !hasMore && messages.length > 0 && (
          <div className="text-center text-gray-600 text-xs py-1">已到最早消息</div>
        )}
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm gap-2 py-8">
            <div className="w-12 h-12 rounded-full bg-emerald-700/30 flex items-center justify-center text-2xl">
              🤖
            </div>
            <p>向 AI 助手提问</p>
            <p className="text-xs text-gray-600">消息仅自己和 AI 可见</p>
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.senderUserId === userId || (msg.senderRole !== 'ai' && msg.user !== 'AI');
          const isCollapsed = collapsedMessages.has(msg.id);
          const canCollapse = !isUser && msg.content.length > COLLAPSE_THRESHOLD;
          return (
            <div key={msg.id} className={`group/msg flex items-start gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
              <div className="shrink-0 hidden sm:block">
                {isUser ? (
                  <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs text-white">我</div>
                ) : (
                  <div className="w-7 h-7 rounded-full bg-emerald-700 flex items-center justify-center text-xs">🤖</div>
                )}
              </div>
              <div className={`flex-1 min-w-0 ${isUser ? 'text-right' : ''}`}>
                <div className={`inline-block max-w-full sm:max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  isUser ? 'bg-blue-600/20 text-gray-200 text-left' : 'bg-gray-800/60 text-gray-200 text-left'
                }`}>
                  {isCollapsed ? (
                    <div className="text-sm text-gray-400 italic cursor-pointer" onClick={() => toggleCollapse(msg.id)}>
                      {generateSummary(msg.content)}
                    </div>
                  ) : isUser ? (
                    <div className="prose prose-invert prose-sm max-w-none break-words">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="text-sm text-stone-300 leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={aiMarkdownComponents}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
                <div className={`flex items-center gap-1 mt-0.5 ${isUser ? 'justify-end' : ''}`}>
                  <span className="text-[10px] text-gray-600">{formatTime(msg.timestamp)}</span>
                  <div className="inline-flex items-center gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                    {renderTtsButton(msg)}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(msg.content);
                        setCopiedId(msg.id);
                        setTimeout(() => setCopiedId(prev => prev === msg.id ? null : prev), 1500);
                      }}
                      className={`transition-colors ${
                        copiedId === msg.id ? 'text-emerald-400' : 'text-gray-400 hover:text-amber-300'
                      }`}
                      title={copiedId === msg.id ? '已复制' : '复制'}
                    >
                      {copiedId === msg.id ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                    {isUser && (
                      <button
                        onClick={() => onSend(msg.content)}
                        className="text-gray-400 hover:text-amber-300 transition-colors"
                        title="再发一次"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                        </svg>
                      </button>
                    )}
                    {canCollapse && (
                      <button
                        onClick={() => toggleCollapse(msg.id)}
                        className="text-gray-400 hover:text-amber-300 transition-colors"
                        title={isCollapsed ? '展开' : '折叠'}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d={isCollapsed ? "M19 9l-7 7-7-7" : "M5 15l7-7 7 7"} />
                        </svg>
                      </button>
                    )}
                    {msg.dbId && (
                      <button
                        onClick={() => onDelete(msg.dbId!)}
                        className={`transition-colors ${
                          pendingDeleteId === msg.dbId
                            ? 'text-red-400'
                            : 'text-gray-400 hover:text-amber-300'
                        }`}
                        title={pendingDeleteId === msg.dbId ? '再次点击确认删除' : '删除'}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* AI Streaming */}
        {isAiStreaming && aiStreamingContent && (
          <div className="flex items-start gap-2">
            <div className="shrink-0 hidden sm:block">
              <div className="w-7 h-7 rounded-full bg-emerald-700 flex items-center justify-center text-xs">🤖</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="inline-block max-w-full sm:max-w-[85%] rounded-lg px-3 py-2 text-sm bg-gray-800/60 text-gray-200">
                <div className="text-sm text-stone-300 leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={aiMarkdownComponents}>{aiStreamingContent}</ReactMarkdown>
                  <span className="inline-block w-1.5 h-3.5 bg-emerald-500 ml-0.5 animate-pulse" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AI Thinking */}
        {aiTyping && !isAiStreaming && (
          <div className="flex items-start gap-2">
            <div className="shrink-0 hidden sm:block">
              <div className="w-7 h-7 rounded-full bg-emerald-700 flex items-center justify-center text-xs">🤖</div>
            </div>
            <div className="text-sm text-gray-400 flex items-center gap-1 py-2">
              <span>正在思考</span>
              <span className="inline-flex gap-0.5">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}

        {aiError && <div className="text-red-400 text-xs px-2">{aiError}</div>}
        <div ref={endRef} />
      </div>

      {/* Input area — chatroom style toolbar */}
      <div className="border-t border-gray-700/30 bg-gray-900/60">
        {/* Toolbar row */}
        <div className="px-2 py-1 flex items-center gap-1.5">
          {/* Voice toggle */}
          <button
            onClick={() => setIsVoiceMode(!isVoiceMode)}
            className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${
              isVoiceMode
                ? 'text-green-400 bg-green-500/20 hover:bg-green-500/30'
                : 'text-gray-500 hover:text-gray-400 hover:bg-gray-700/50'
            }`}
            title={isVoiceMode ? '切换到文字输入' : '切换到语音输入'}
          >
            {isVoiceMode ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            )}
          </button>
          {/* Expand/collapse */}
          <button
            onClick={() => {
              setIsChatExpanded(v => !v);
              setChatBoxHeight(null);
            }}
            className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${
              isChatExpanded
                ? 'text-amber-400 bg-amber-500/20 hover:bg-amber-500/30'
                : 'text-gray-500 hover:text-gray-400 hover:bg-gray-700/50'
            }`}
            title={isChatExpanded ? '收起输入框' : '展开输入框'}
          >
            {isChatExpanded ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        </div>

        {/* Resize handle — only when expanded */}
        {isChatExpanded && (
          <div
            className="h-1.5 cursor-ns-resize flex items-center justify-center group"
            onMouseDown={(e) => {
              const textarea = e.currentTarget.parentElement?.querySelector('textarea') as HTMLElement;
              if (!textarea) return;
              const startY = e.clientY;
              const startH = textarea.offsetHeight || (isChatExpanded ? 120 : 36);
              chatResizeRef.current = { startY, startH };
              const onMouseMove = (ev: MouseEvent) => {
                if (!chatResizeRef.current) return;
                const delta = chatResizeRef.current.startY - ev.clientY;
                const newH = Math.max(36, Math.min(300, chatResizeRef.current.startH + delta));
                setChatBoxHeight(newH);
              };
              const onMouseUp = () => {
                chatResizeRef.current = null;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
              };
              document.addEventListener('mousemove', onMouseMove);
              document.addEventListener('mouseup', onMouseUp);
            }}
            onTouchStart={(e) => {
              const touch = e.touches[0];
              const textarea = e.currentTarget.parentElement?.querySelector('textarea') as HTMLElement;
              if (!textarea) return;
              const startY = touch.clientY;
              const startH = textarea.offsetHeight || (isChatExpanded ? 120 : 36);
              chatResizeRef.current = { startY, startH };
              const onTouchMove = (ev: TouchEvent) => {
                if (!chatResizeRef.current) return;
                const delta = chatResizeRef.current.startY - ev.touches[0].clientY;
                const newH = Math.max(36, Math.min(300, chatResizeRef.current.startH + delta));
                setChatBoxHeight(newH);
              };
              const onTouchEnd = () => {
                chatResizeRef.current = null;
                document.removeEventListener('touchmove', onTouchMove);
                document.removeEventListener('touchend', onTouchEnd);
              };
              document.addEventListener('touchmove', onTouchMove);
              document.addEventListener('touchend', onTouchEnd);
            }}
          >
            <div className="w-10 h-0.5 rounded-full bg-gray-700 group-hover:bg-amber-500/50 transition-colors" />
          </div>
        )}

        {/* Input row */}
        <div className="px-2 pb-2">
          {isVoiceMode ? (
            <div className="flex items-center justify-center py-2">
              <VoiceInput
                compact
                showCancel
                onTranscribed={(text) => onSend(text)}
              />
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (!chatBoxHeight) {
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, isChatExpanded ? 200 : 120) + 'px';
                  }
                }}
                onKeyDown={handleKeyDown}
                placeholder={isChatExpanded ? '向 AI 助手提问... (Ctrl+Enter 发送)' : '向 AI 助手提问...'}
                rows={isChatExpanded ? 4 : 1}
                className={`flex-1 px-3 py-2 bg-gray-800/60 border rounded-xl text-gray-100 text-sm placeholder-gray-500 focus:outline-none transition-all resize-none ${
                  chatBoxHeight ? 'overflow-y-auto' : 'overflow-hidden'
                } border-gray-700/40 focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500/40`}
                style={{
                  minHeight: '36px',
                  maxHeight: '300px',
                  ...(chatBoxHeight ? { height: `${chatBoxHeight}px` } : isChatExpanded ? { minHeight: '120px' } : {}),
                }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="flex-shrink-0 p-2 rounded-xl text-amber-400/80 hover:text-amber-300 hover:bg-amber-500/15 disabled:text-gray-600 disabled:hover:bg-transparent transition-all active:scale-95"
                title={isChatExpanded ? `发送 (Ctrl+Enter)` : '发送 (Enter)'}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
