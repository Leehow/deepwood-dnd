import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createLogger } from '~/utils/logger';
import { apiFetch } from "~/utils/api-client";
import { useTTS } from '~/hooks/useTTS';
import { useVoiceStore } from '~/stores/voiceStore';

const logger = createLogger('Rules_AIQueryTab');

interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  isStreaming?: boolean;
}

interface Props {
  campaignId: number;
  userId: string;
}

// Arcane rune decorations
const RuneCorner = ({ position }: { position: 'tl' | 'tr' | 'bl' | 'br' }) => {
  const rotations = { tl: '', tr: 'rotate-90', bl: '-rotate-90', br: 'rotate-180' };
  return (
    <svg
      className={`absolute w-4 h-4 text-amber-600/40 ${rotations[position]} ${
        position.includes('t') ? 'top-1' : 'bottom-1'
      } ${position.includes('l') ? 'left-1' : 'right-1'}`}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M3 3h6v2H5v4H3V3zm0 18v-6h2v4h4v2H3z" />
    </svg>
  );
};

// Magical streaming indicator
const ArcaneStream = () => (
  <span className="inline-flex items-center gap-0.5 ml-2">
    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
  </span>
);

export function Rules_AIQueryTab({ campaignId, userId: _userId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { handleTTS, handleTTSBroadcast, handleTTSRegenerate, ttsPlayingId, ttsLoading, stopPlayback } = useTTS(String(campaignId));
  const voiceIsConnected = useVoiceStore(s => s.isConnected);
  const [ttsMenuMsgId, setTtsMenuMsgId] = useState<number | null>(null);
  const ttsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ttsMenuMsgId) return;
    const handler = (e: MouseEvent) => {
      if (ttsMenuRef.current && !ttsMenuRef.current.contains(e.target as Node)) setTtsMenuMsgId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ttsMenuMsgId]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    isAtBottomRef.current = true;
    setShowScrollBtn(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    isAtBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const loadHistory = async () => {
      setIsReady(false);
      try {
        const response = await apiFetch(`/api/campaigns/${campaignId}/rules-chat?limit=50`);
        if (response.ok) {
          const data = await response.json();
          setMessages(data.messages || []);
        }
      } catch (err) {
        logger.error("Failed to load chat history:", err);
      } finally {
        // Use requestAnimationFrame to ensure scroll completes before showing
        requestAnimationFrame(() => {
          scrollToBottom();
          requestAnimationFrame(() => {
            setIsReady(true);
          });
        });
      }
    };
    if (campaignId) loadHistory();
  }, [campaignId, scrollToBottom]);

  const sendMessage = async (overrideContent?: string) => {
    const content = overrideContent || inputValue.trim();
    if (!content || isLoading) return;
    // Reset scroll to bottom when user sends a new message
    isAtBottomRef.current = true;
    setShowScrollBtn(false);
    const userMessage: ChatMessage = { role: 'user', content };
    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setIsLoading(true);
    setError(null);

    const assistantMessage: ChatMessage = { role: 'assistant', content: '', isStreaming: true };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      const response = await apiFetch(`/api/campaigns/${campaignId}/rules-chat/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: userMessage.content }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullContent = '';
      let sources: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'sources') {
                sources = data.sources || [];
              } else if (data.type === 'content') {
                fullContent += data.content;
                setMessages(prev => {
                  const newMessages = [...prev];
                  const lastIdx = newMessages.length - 1;
                  if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                    newMessages[lastIdx] = { ...newMessages[lastIdx], content: fullContent, sources };
                  }
                  return newMessages;
                });
              } else if (data.type === 'done') {
                setMessages(prev => {
                  const newMessages = [...prev];
                  const lastIdx = newMessages.length - 1;
                  if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                    newMessages[lastIdx] = { ...newMessages[lastIdx], id: data.message_id, isStreaming: false };
                  }
                  return newMessages;
                });
              } else if (data.type === 'error') {
                setError(data.error);
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch (err) {
      logger.error("Failed to send message:", err);
      setError(err instanceof Error ? err.message : "发送失败");
      setMessages(prev => prev.filter(m => m.content || m.role !== 'assistant'));
    } finally {
      setIsLoading(false);
    }
  };

  const deleteMessage = async (messageId: number, idx: number) => {
    try {
      await apiFetch(`/api/campaigns/${campaignId}/rules-chat/${messageId}`, { method: 'DELETE' });
      setMessages(prev => prev.filter((_, i) => i !== idx));
    } catch (err) {
      logger.error("Failed to delete message:", err);
    }
  };

  const clearHistory = async () => {
    if (!confirm("确定要清空聊天记录吗？")) return;
    try {
      await apiFetch(`/api/campaigns/${campaignId}/rules-chat`, { method: 'DELETE' });
      setMessages([]);
    } catch (err) {
      logger.error("Failed to clear history:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-stone-900 via-stone-900 to-stone-950 relative overflow-hidden">
      {/* Ambient magical glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-32 h-32 bg-amber-500/5 rounded-full" />
        <div className="absolute bottom-1/4 right-0 w-40 h-40 bg-orange-500/5 rounded-full" />
      </div>

      {/* Header - Oracle Title */}
      <div className="relative px-4 py-3 border-b border-amber-900/30 bg-gradient-to-r from-stone-900 via-stone-800/50 to-stone-900 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Mystical icon */}
            <div className="relative">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-600 to-orange-700 flex items-center justify-center shadow-lg shadow-amber-900/50">
                <svg className="w-5 h-5 text-amber-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-amber-200 tracking-wide">奥术典籍</h3>
              <p className="text-[10px] text-stone-500 tracking-wider uppercase">D&D 5E 规则神谕</p>
            </div>
          </div>
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="text-[10px] px-2 py-1 text-stone-500 hover:text-red-400 hover:bg-red-950/30 rounded transition-all uppercase tracking-wider"
            >
              清除卷轴
            </button>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className={`flex-1 overflow-auto px-3 py-4 space-y-4 relative transition-opacity duration-200 ${isReady ? 'opacity-100' : 'opacity-0'}`}>
        {messages.length === 0 ? (
          /* Empty State - Mystical Oracle */
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="relative mb-6">
              {/* Crystal ball / tome effect */}
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-900/40 to-stone-900 border border-amber-800/30 flex items-center justify-center shadow-2xl shadow-amber-900/20">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-600/20 to-transparent flex items-center justify-center">
                  <svg className="w-8 h-8 text-amber-500/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                  </svg>
                </div>
              </div>
              {/* Floating particles */}
              <div className="absolute -top-2 -left-2 w-2 h-2 bg-amber-400/60 rounded-full animate-bounce" style={{ animationDelay: '0s', animationDuration: '2s' }} />
              <div className="absolute -bottom-1 -right-3 w-1.5 h-1.5 bg-orange-400/60 rounded-full animate-bounce" style={{ animationDelay: '0.5s', animationDuration: '2.5s' }} />
              <div className="absolute top-1/2 -right-4 w-1 h-1 bg-yellow-400/60 rounded-full animate-bounce" style={{ animationDelay: '1s', animationDuration: '3s' }} />
            </div>
            <p className="text-amber-200/80 text-sm font-medium mb-1">向神谕询问规则</p>
            <p className="text-stone-600 text-xs max-w-[200px]">
              「施法材料成分有什么用？」
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                /* User Message - Parchment Note Style */
                <div className="max-w-[85%] group">
                  <div className="relative bg-gradient-to-br from-amber-950/60 to-amber-900/40 rounded-lg px-4 py-3 border border-amber-800/30 shadow-lg">
                    {/* Decorative seal */}
                    <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-gradient-to-br from-red-700 to-red-900 border border-red-600/50 flex items-center justify-center shadow-md">
                      <span className="text-[8px] text-red-200">?</span>
                    </div>
                    <p className="text-amber-100/90 text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  <div className="flex justify-end gap-3 mt-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => sendMessage(msg.content)}
                      disabled={isLoading}
                      className="text-[10px] text-stone-500 hover:text-amber-400 disabled:opacity-50 transition-colors flex items-center gap-1"
                      title="再次发送"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      再次发送
                    </button>
                    {msg.id && (
                      <button
                        onClick={() => deleteMessage(msg.id!, idx)}
                        className="text-[10px] text-stone-500 hover:text-red-400 transition-colors flex items-center gap-1"
                        title="删除消息"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        删除
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* AI Message - Ancient Tome Style */
                <div className="max-w-full group">
                  <div className="relative bg-gradient-to-br from-stone-800/80 to-stone-900/90 rounded-lg border border-stone-700/50 shadow-xl overflow-hidden">
                    {/* Corner runes */}
                    <RuneCorner position="tl" />
                    <RuneCorner position="tr" />
                    <RuneCorner position="bl" />
                    <RuneCorner position="br" />

                    {/* Sources banner */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="px-4 py-2 bg-amber-950/30 border-b border-amber-900/20">
                        <div className="flex items-center gap-2">
                          <svg className="w-3 h-3 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                          </svg>
                          <span className="text-[10px] text-amber-600/80 uppercase tracking-wider">参考典籍: {msg.sources.join(' · ')}</span>
                        </div>
                      </div>
                    )}

                    {/* Content */}
                    <div className="px-4 py-3">
                      <div className="text-sm text-stone-300 leading-relaxed prose-custom">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: ({ children }) => (
                              <h1 className="text-base font-bold text-amber-400 mt-4 mb-2 pb-1 border-b border-amber-900/30 flex items-center gap-2">
                                <span className="text-amber-600">◆</span>{children}
                              </h1>
                            ),
                            h2: ({ children }) => (
                              <h2 className="text-sm font-bold text-amber-300 mt-4 mb-2 flex items-center gap-2">
                                <span className="text-amber-600 text-xs">▸</span>{children}
                              </h2>
                            ),
                            h3: ({ children }) => (
                              <h3 className="text-sm font-semibold text-amber-200/90 mt-3 mb-1">{children}</h3>
                            ),
                            p: ({ children }) => <p className="my-2 leading-relaxed text-stone-300">{children}</p>,
                            ul: ({ children }) => <ul className="my-2 space-y-1 ml-1">{children}</ul>,
                            ol: ({ children }) => <ol className="my-2 space-y-1 ml-1 list-decimal list-inside">{children}</ol>,
                            li: ({ children }) => (
                              <li className="flex items-start gap-2 text-stone-300">
                                <span className="text-amber-600 mt-1.5 text-[6px]">●</span>
                                <span className="flex-1">{children}</span>
                              </li>
                            ),
                            // Table support with fantasy styling
                            table: ({ children }) => (
                              <div className="my-3 overflow-x-auto rounded-lg border border-amber-900/30">
                                <table className="w-full text-sm">{children}</table>
                              </div>
                            ),
                            thead: ({ children }) => (
                              <thead className="bg-amber-950/40 border-b border-amber-900/30">{children}</thead>
                            ),
                            tbody: ({ children }) => <tbody className="divide-y divide-stone-800/50">{children}</tbody>,
                            tr: ({ children }) => <tr className="hover:bg-stone-800/30 transition-colors">{children}</tr>,
                            th: ({ children }) => (
                              <th className="px-3 py-2 text-left text-xs font-semibold text-amber-300 uppercase tracking-wider">{children}</th>
                            ),
                            td: ({ children }) => (
                              <td className="px-3 py-2 text-stone-300">{children}</td>
                            ),
                            code: ({ className, children }) => {
                              const isInline = !className;
                              return isInline ? (
                                <code className="px-1.5 py-0.5 bg-amber-950/50 border border-amber-900/30 rounded text-amber-300 text-xs font-mono">{children}</code>
                              ) : (
                                <code className="block bg-stone-950/50 border border-stone-700/50 p-3 rounded my-2 text-xs font-mono text-stone-300 overflow-x-auto">{children}</code>
                              );
                            },
                            pre: ({ children }) => <pre className="bg-stone-950/50 border border-stone-700/50 rounded my-2 overflow-x-auto">{children}</pre>,
                            blockquote: ({ children }) => (
                              <blockquote className="border-l-2 border-amber-600/50 pl-3 my-3 py-1 bg-amber-950/20 rounded-r text-stone-400 italic">{children}</blockquote>
                            ),
                            hr: () => (
                              <div className="my-4 flex items-center gap-2">
                                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-stone-700 to-transparent" />
                                <span className="text-amber-700 text-xs">✦</span>
                                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-stone-700 to-transparent" />
                              </div>
                            ),
                            strong: ({ children }) => <strong className="font-bold text-amber-200">{children}</strong>,
                            em: ({ children }) => <em className="italic text-stone-400">{children}</em>,
                            a: ({ children, href }) => <a href={href} className="text-amber-400 hover:text-amber-300 underline decoration-amber-600/30">{children}</a>,
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                        {msg.isStreaming && <ArcaneStream />}
                      </div>
                      {/* Action buttons */}
                      {msg.id && !msg.isStreaming && (
                        <div className="mt-2 pt-2 border-t border-stone-700/30 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-3">
                          <div className="relative" ref={ttsMenuMsgId === msg.id ? ttsMenuRef : undefined}>
                            <button
                              onClick={() => {
                                if (ttsPlayingId === String(msg.id)) { stopPlayback(); return; }
                                if (ttsLoading === String(msg.id)) return;
                                setTtsMenuMsgId(ttsMenuMsgId === msg.id! ? null : msg.id!);
                              }}
                              disabled={ttsLoading === String(msg.id)}
                              className={`text-[10px] transition-colors flex items-center gap-1 ${
                                ttsPlayingId === String(msg.id)
                                  ? 'text-amber-400'
                                  : ttsLoading === String(msg.id)
                                    ? 'text-gray-500 cursor-wait'
                                    : 'text-stone-500 hover:text-amber-400'
                              }`}
                              title={ttsPlayingId === String(msg.id) ? '停止朗读' : '朗读'}
                            >
                              {ttsLoading === String(msg.id) ? (
                                <>
                                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  加载中
                                </>
                              ) : ttsPlayingId === String(msg.id) ? (
                                <>
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                                  停止
                                </>
                              ) : (
                                <>
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                                  朗读
                                </>
                              )}
                            </button>
                            {ttsMenuMsgId === msg.id && (
                              <div className="absolute bottom-full left-0 mb-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 whitespace-nowrap text-xs">
                                <button
                                  className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-gray-700 text-gray-200"
                                  onClick={() => { setTtsMenuMsgId(null); handleTTS(String(msg.id), msg.content, msg.id); }}
                                >
                                  <span className="w-4 text-center">🔊</span> 朗读
                                </button>
                                <button
                                  className={`flex items-center gap-2 w-full px-3 py-1.5 ${voiceIsConnected ? 'hover:bg-gray-700 text-gray-200' : 'text-gray-500 cursor-not-allowed'}`}
                                  onClick={() => { if (voiceIsConnected) { setTtsMenuMsgId(null); handleTTSBroadcast(String(msg.id), msg.content, msg.id); } }}
                                  disabled={!voiceIsConnected}
                                  title={voiceIsConnected ? '合成并广播给语音频道' : '需要先连接语音频道'}
                                >
                                  <span className="w-4 text-center">📢</span> 语音播放
                                </button>
                                <button
                                  className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-gray-700 text-gray-200"
                                  onClick={() => { setTtsMenuMsgId(null); handleTTSRegenerate(String(msg.id), msg.content, msg.id); }}
                                >
                                  <span className="w-4 text-center">🔄</span> 重新生成
                                </button>
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => deleteMessage(msg.id!, idx)}
                            className="text-[10px] text-stone-500 hover:text-red-400 transition-colors flex items-center gap-1"
                            title="删除消息"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-24 right-4 z-10 w-8 h-8 bg-amber-600 hover:bg-amber-500 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-110"
          title="跳转到最新消息"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}

      {/* Error Display */}
      {error && (
        <div className="mx-3 mb-2 px-3 py-2 bg-red-950/50 border border-red-900/50 rounded-lg">
          <p className="text-xs text-red-400 flex items-center gap-2">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </p>
        </div>
      )}

      {/* Input Area - Magical Quill */}
      <div className="relative px-3 py-3 border-t border-stone-800/50 bg-gradient-to-t from-stone-950 to-transparent flex-shrink-0">
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
              onKeyDown={handleKeyDown}
              placeholder="向神谕提问..."
              disabled={isLoading}
              rows={1}
              className="w-full px-4 py-2.5 bg-stone-800/50 border border-stone-700/50 rounded-lg text-stone-200 text-sm resize-none overflow-hidden focus:outline-none focus:border-amber-700/50 focus:bg-stone-800/70 disabled:opacity-50 placeholder:text-stone-600 transition-all"
              style={{ minHeight: '42px', maxHeight: '120px' }}
            />
            {/* Quill decoration */}
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-30">
              <svg className="w-4 h-4 text-amber-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34c-.37-.39-1.02-.39-1.41 0l-1.84 1.83 3.75 3.75M3 17.25V21h3.75L17.81 9.93l-3.75-3.75L3 17.25z"/>
              </svg>
            </div>
          </div>
          <button
            onClick={() => sendMessage()}
            disabled={isLoading || !inputValue.trim()}
            className="px-4 py-2.5 bg-gradient-to-r from-amber-700 to-orange-700 hover:from-amber-600 hover:to-orange-600 disabled:from-stone-700 disabled:to-stone-700 disabled:text-stone-500 text-amber-100 rounded-lg text-sm font-medium transition-all shadow-lg shadow-amber-900/20 disabled:shadow-none flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>咨询中</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                <span>询问</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
