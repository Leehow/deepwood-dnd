import { useState, useEffect, useRef, useCallback, memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createLogger } from '~/utils/logger';
import { API_BASE_URL } from "~/config/api";
import { apiFetch } from "~/utils/api-client";
import { useModuleStore, type MapMarker } from '~/stores/moduleStore';
import { useTTS } from '~/hooks/useTTS';
import { useVoiceStore } from '~/stores/voiceStore';
import { ModuleChatSessionSelector } from './ModuleChatSessionSelector';
import { ChapterContextSelector } from './ChapterContextSelector';

const logger = createLogger('Module_AIQueryTab');
const SESSION_SUMMARY_MARKER = '[[SESSION_SUMMARY_V1]]';

// ===== Type Definitions =====

// Entity data with full info for direct creation (no second LLM call)
interface EntityData {
  name: string;
  [key: string]: unknown;  // Full entity data from analyze-entities
}

// Map entity data for tactical map generation
// Extended with DMG-based options from creator knowledge base
interface MapEntityData {
  name: string;
  name_en?: string;
  description: string;
  environment: string;  // forest, dungeon, town, cave, castle, swamp, desert, mountain, jungle, arctic, coast, grassland, lair, mine, tomb, maze, stronghold, vault, village, city, port, outpost
  lighting?: string;    // bright, dim, dark, magical, firelight
  features?: string[];
  // New fields from creator knowledge base
  creator?: string;     // dwarf, elf, human, giant, mindflayer, undead, cult, natural
  weather?: string;     // clear, rain, storm, snow, fog
  purpose?: string;     // lair, mine, tomb, maze, stronghold, vault (dungeon purpose)
}

// Encounter entity data with DMG-based design fields
// Based on encounters.json from creator knowledge base
interface EncounterEntityData extends EntityData {
  title: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'deadly';
  description: string;
  // New fields from encounters.json
  encounter_type?: 'combat' | 'social' | 'exploration' | 'trap';
  objective?: 'make_peace' | 'protect' | 'retrieve' | 'gauntlet' | 'sneak' | 'stop_ritual' | 'single_target';
  objective_description?: string;
  terrain_features?: string[];
  tactics?: string;
  outcomes?: {
    success: string;
    partial: string;
    failure: string;
  };
  monsters: Array<{
    name: string;
    count: number;
    [key: string]: unknown;
  }>;
}

// Analyzed entities for a message (now with full data)
interface AnalyzedEntities {
  npcs: EntityData[];
  shops: EntityData[];
  items: EntityData[];
  encounters: EncounterEntityData[];
  bosses?: EncounterEntityData[];  // BOSS战遭遇 (same structure as encounters)
  maps?: MapEntityData[];
  isAnalyzing?: boolean;
  // Plan-specific fields (for encounter_plan messages)
  type?: string;  // 'encounter_plan' for plan messages
  plan_text?: string;
  map_url?: string;
}

interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  analyzed_entities?: AnalyzedEntities;
}

interface ChatSessionInfo {
  id: number;
  title: string | null;
  message_count: number;
  updated_at: string;
}

interface Props {
  moduleId: string;
  userId: string;
  moduleTitle?: string;
  campaignId?: number;
  mapUrl?: string;
  getViewportCenter?: () => { x: number; y: number };
}

// ===== UI Components =====

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

const LoadingDots = () => (
  <span className="inline-flex items-center gap-0.5 ml-2">
    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
  </span>
);

// ===== Helper Functions =====

// Parse MAP_MARKERS from AI response content
function parseMapMarkers(content: string): MapMarker[] {
  const regex = /<!--MAP_MARKERS-->\s*([\s\S]*?)\s*<!--\/MAP_MARKERS-->/;
  const match = content.match(regex);
  if (!match) return [];

  try {
    const jsonStr = match[1].trim();
    const markers = JSON.parse(jsonStr);
    if (!Array.isArray(markers)) return [];

    // Validate and filter valid markers
    return markers.filter((m: unknown): m is MapMarker =>
      typeof m === 'object' && m !== null &&
      typeof (m as MapMarker).x === 'string' &&
      typeof (m as MapMarker).y === 'string' &&
      typeof (m as MapMarker).label === 'string' &&
      typeof (m as MapMarker).content === 'string'
    );
  } catch (e) {
    logger.error('Failed to parse MAP_MARKERS:', e);
    return [];
  }
}

// ===== Pure Helper Functions (outside component to avoid re-creation) =====

// Remove entity markers from displayed content
function cleanContent(content: string): string {
  return content
    .replace(/<!--MAP_MARKERS-->\s*[\s\S]*?\s*<!--\/MAP_MARKERS-->/gi, '')
    .replace(/<!--\s?(?:NPC|SHOP|ITEM|ENCOUNTER|BOSS|MAP)(?:[^>]*)-->/gi, '')
    .replace(/<!--HAS:[A-Z,]+-->/gi, '')
    .trim();
}

// Preprocess markdown content to fix rendering issues
function preprocessMarkdown(content: string): string {
  let processed = content;

  // 1. Fix tables: Remove blank lines within table structure
  const tablePattern = /(\|[^\n]+\|)\n+(\|[-:| ]+\|)\n+((?:\|[^\n]+\|\n*)+)/g;
  processed = processed.replace(tablePattern, (_match: string, header: string, separator: string, body: string) => {
    const cleanBody = body.replace(/\n{2,}/g, '\n').trim();
    return `${header}\n${separator}\n${cleanBody}`;
  });
  processed = processed.replace(/([^\n])\n(\|[^\n]+\|\n\|[-:| ]+\|)/g, '$1\n\n$2');

  // 2. Wrap ASCII art diagrams in code blocks
  const lines = processed.split('\n');
  const result: string[] = [];

  const hasBoxChars = (line: string) => /[─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬]/.test(line);
  const hasArrows = (line: string) => /[→←↑↓]/.test(line);
  const hasLeadingSpaces = (line: string) => /^\s{3,}/.test(line) && line.trim().length > 0;
  const isInlineCode = (line: string) => /^`[^`]+`$/.test(line.trim());

  const isAsciiContext: boolean[] = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (hasBoxChars(lines[i]) || hasArrows(lines[i])) {
      isAsciiContext[i] = true;
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        if (hasLeadingSpaces(lines[j]) || lines[j].trim() === '' || isInlineCode(lines[j])) {
          isAsciiContext[j] = true;
        } else break;
      }
      for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
        if (hasLeadingSpaces(lines[j]) || lines[j].trim() === '' || isInlineCode(lines[j])) {
          isAsciiContext[j] = true;
        } else break;
      }
    }
  }

  let inAsciiBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isAsciiContext[i] && !line.startsWith('```') && !line.startsWith('|')) {
      if (!inAsciiBlock) {
        result.push('```');
        inAsciiBlock = true;
      }
      const stripped = line.trim().replace(/^`([^`]+)`$/, '$1');
      result.push(stripped);
    } else {
      if (inAsciiBlock) {
        result.push('```');
        inAsciiBlock = false;
      }
      result.push(line);
    }
  }
  if (inAsciiBlock) {
    result.push('```');
  }

  processed = result.join('\n');
  return processed;
}

// ===== Markdown Components (stable reference, never re-created) =====

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-base font-bold text-amber-400 mt-4 mb-2 pb-1 border-b border-amber-900/30 flex items-center gap-2">
      <span className="text-amber-600">◆</span>{children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-sm font-bold text-amber-300 mt-4 mb-2 flex items-center gap-2">
      <span className="text-amber-600 text-xs">▸</span>{children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-semibold text-amber-200/90 mt-3 mb-1">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => <p className="my-2 leading-relaxed text-stone-300">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="my-2 space-y-1 ml-1">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="my-2 space-y-1 ml-1 list-decimal list-inside">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="flex items-start gap-2 text-stone-300">
      <span className="text-amber-600 mt-1.5 text-[6px]">●</span>
      <span className="flex-1">{children}</span>
    </li>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-amber-900/30">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-amber-950/40 border-b border-amber-900/30">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => <tbody className="divide-y divide-stone-800/50">{children}</tbody>,
  tr: ({ children }: { children?: React.ReactNode }) => <tr className="hover:bg-stone-800/30 transition-colors">{children}</tr>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-2 text-left text-xs font-semibold text-amber-300 uppercase tracking-wider">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-3 py-2 text-stone-300">{children}</td>
  ),
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const isInline = !className;
    return isInline ? (
      <code className="px-1.5 py-0.5 bg-amber-950/50 border border-amber-900/30 rounded text-amber-300 text-xs font-mono">{children}</code>
    ) : (
      <code className="block bg-stone-950/50 border border-stone-700/50 p-3 rounded my-2 text-xs font-mono text-stone-300 overflow-x-auto whitespace-pre">{children}</code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="bg-stone-950/50 border border-stone-700/50 rounded my-2 overflow-x-auto whitespace-pre">{children}</pre>,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-stone-600 pl-3 my-2 text-stone-400">{children}</blockquote>
  ),
  hr: () => (
    <div className="my-4 flex items-center gap-2">
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-stone-700 to-transparent" />
      <span className="text-amber-700 text-xs">✦</span>
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-stone-700 to-transparent" />
    </div>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-bold text-amber-200">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic text-stone-400">{children}</em>,
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => <a href={href} className="text-amber-400 hover:text-amber-300 underline decoration-amber-600/30">{children}</a>,
} as const;

const remarkPluginsStable = [remarkGfm];

// ===== Memoized Markdown Renderer =====
// Only re-renders when content actually changes, not on parent re-renders
const MemoizedMarkdown = memo(function MemoizedMarkdown({ content }: { content: string }) {
  const processed = useMemo(() => preprocessMarkdown(cleanContent(content)), [content]);
  return (
    <ReactMarkdown
      remarkPlugins={remarkPluginsStable}
      components={markdownComponents as any}
    >
      {processed}
    </ReactMarkdown>
  );
});

// ===== Main Component =====

export function Module_AIQueryTab({ moduleId, userId, moduleTitle, campaignId, mapUrl, getViewportCenter }: Props) {
  // Store hooks
  const setMapMarkers = useModuleStore(state => state.setMapMarkers);
  const saveAIMapMarkers = useModuleStore(state => state.saveAIMapMarkers);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingNoteIdx, setSavingNoteIdx] = useState<number | null>(null);
  const [savedNoteIdxs, setSavedNoteIdxs] = useState<Set<number>>(new Set());
  const [creatingNPC, setCreatingNPC] = useState<string | null>(null); // NPC name being created
  const [creatingEncounter, setCreatingEncounter] = useState<string | null>(null); // Encounter name being created
  const [creatingBoss, setCreatingBoss] = useState<string | null>(null); // Boss encounter being created
  const [creatingItem, setCreatingItem] = useState<string | null>(null); // Item name being created
  const [creatingShop, setCreatingShop] = useState<string | null>(null); // Shop name being created
  const [generatingMap, setGeneratingMap] = useState<string | null>(null); // Map name being generated
  const [collapsedMessages, setCollapsedMessages] = useState<Set<number>>(new Set()); // Collapsed message IDs (not indices)
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState<number | null>(null); // Message pending delete confirmation
  const [analyzedEntities, setAnalyzedEntities] = useState<Map<number, AnalyzedEntities>>(new Map()); // Message ID -> entities
  const [expandedEntities, setExpandedEntities] = useState<Set<number>>(new Set()); // Message IDs with expanded entity sections
  const [analyzeMap, setAnalyzeMap] = useState(false); // Whether to use multimodal analysis for map
  const [showPresetMenu, setShowPresetMenu] = useState(false); // Preset functions dropdown
  const [extractingMapPoints, setExtractingMapPoints] = useState(false); // Extracting map points loading state
  const [planningEncounter, setPlanningEncounter] = useState(false); // Planning encounter loading state
  const [executingEncounter, setExecutingEncounter] = useState(false); // Executing encounter loading state
  const [modifyingPlan, setModifyingPlan] = useState(false); // Modifying plan loading state
  const [currentPlan, setCurrentPlan] = useState<{ text: string; mapUrl: string } | null>(null); // Current plan for execution
  const [showDensityMenu, setShowDensityMenu] = useState(false); // Density selection menu
  const [showSourceModeMenu, setShowSourceModeMenu] = useState(false); // Source mode selection
  const [selectedSourceMode, setSelectedSourceMode] = useState<string>('module_extend'); // Default source mode
  const [showModifyInput, setShowModifyInput] = useState(false); // Show modify input
  const [modifyText, setModifyText] = useState(''); // Modification text
  const [copiedMsgId, setCopiedMsgId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [selectedChapterTitles, setSelectedChapterTitles] = useState<Set<string>>(new Set());
  const [moduleChapters, setModuleChapters] = useState<any[]>([]);

  const { handleTTS, handleTTSBroadcast, handleTTSRegenerate, ttsPlayingId, ttsLoading, stopPlayback } = useTTS(campaignId ? String(campaignId) : undefined);
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const presetMenuRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

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

  // Close preset menu when clicking outside
  useEffect(() => {
    if (!showPresetMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (presetMenuRef.current && !presetMenuRef.current.contains(e.target as Node)) {
        setShowPresetMenu(false);
        setShowSourceModeMenu(false);
        setShowDensityMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPresetMenu]);

  // Load module chapters for chapter context selector
  useEffect(() => {
    const loadChapters = async () => {
      try {
        const resp = await fetch(`${API_BASE_URL}/api/modules/parsed/${moduleId}`);
        if (resp.ok) {
          const data = await resp.json();
          setModuleChapters(data.chapter_tree || []);
        }
      } catch (err) {
        logger.error("Failed to load module chapters:", err);
      }
    };
    if (moduleId) loadChapters();
  }, [moduleId]);

  // Load sessions on mount, then load messages for the most recent session
  useEffect(() => {
    const loadSessions = async () => {
      setIsReady(false);
      try {
        const params = new URLSearchParams();
        if (campaignId) params.append('campaign_id', campaignId.toString());
        const qs = params.toString();
        const resp = await apiFetch(`/api/modules/${moduleId}/chat/sessions${qs ? `?${qs}` : ''}`);
        if (resp.ok) {
          const data: ChatSessionInfo[] = await resp.json();
          setSessions(data);
          if (data.length > 0) {
            setCurrentSessionId(data[0].id);
          }
        }
      } catch (err) {
        logger.error("Failed to load sessions:", err);
      }
    };
    if (moduleId && userId) loadSessions();
  }, [moduleId, userId, campaignId]);

  // Load messages when currentSessionId changes
  useEffect(() => {
    const loadHistory = async () => {
      setIsReady(false);
      try {
        const params = new URLSearchParams({ limit: '100' });
        if (currentSessionId) params.append('session_id', currentSessionId.toString());
        const response = await apiFetch(`/api/modules/${moduleId}/chat?${params}`);
        if (response.ok) {
          const data = await response.json();
          const rawMsgs = data.messages || [];
          const msgs = rawMsgs.filter(
            (msg: { content?: string }) =>
              !(typeof msg.content === 'string' && msg.content.startsWith(SESSION_SUMMARY_MARKER))
          );
          setMessages(msgs);

          // Initialize analyzed entities from database
          const entitiesMap = new Map<number, AnalyzedEntities>();
          msgs.forEach((msg: { id?: number; analyzed_entities?: AnalyzedEntities }) => {
            if (msg.id && msg.analyzed_entities) {
              entitiesMap.set(msg.id, msg.analyzed_entities);
            }
          });
          if (entitiesMap.size > 0) {
            setAnalyzedEntities(entitiesMap);
          }

          // Restore currentPlan from the last encounter_plan message (for Execute/Modify buttons)
          setCurrentPlan(null);
          for (let i = msgs.length - 1; i >= 0; i--) {
            const msg = msgs[i];
            if (msg.analyzed_entities?.type === 'encounter_plan' && msg.analyzed_entities?.plan_text && msg.analyzed_entities?.map_url) {
              setCurrentPlan({
                text: msg.analyzed_entities.plan_text,
                mapUrl: msg.analyzed_entities.map_url
              });
              break;
            }
          }
        }
      } catch (err) {
        logger.error("Failed to load chat history:", err);
      } finally {
        requestAnimationFrame(() => {
          scrollToBottom();
          requestAnimationFrame(() => {
            setIsReady(true);
          });
        });
      }
    };
    if (moduleId && userId && currentSessionId) loadHistory();
  }, [moduleId, userId, currentSessionId, scrollToBottom]);

  // Parse entity markers from AI response
  // Simplified detection: <!--NPC--> or <!-- NPC --> or <!--NPC: xxx --> all match
  const parseEntityMarkers = (content: string): string[] => {
    const types: string[] = [];
    const entityTypes = ['NPC', 'SHOP', 'ITEM', 'ENCOUNTER', 'BOSS', 'MAP'];

    for (const type of entityTypes) {
      // Match: <!--NPC, <!-- NPC, <!--NPC:, <!-- NPC:, etc.
      // Pattern: <!-- followed by optional space, then the type
      const pattern = new RegExp(`<!--\\s?${type}`, 'i');
      if (pattern.test(content)) {
        types.push(type);
      }
    }

    // Also support legacy HAS format: <!--HAS:NPC,SHOP-->
    const hasMatch = content.match(/<!--HAS:([A-Z,]+)-->/i);
    if (hasMatch) {
      types.push(...hasMatch[1].split(',').filter(t => entityTypes.includes(t.toUpperCase())).map(t => t.toUpperCase()));
    }

    return [...new Set(types)];
  };

  // Fetch saved analyzed_entities for a message from backend
  const fetchSavedEntities = useCallback(async (messageId: number, retryCount = 0): Promise<boolean> => {
    const MAX_RETRIES = 3;

    try {
      // Fetch chat history and find this message
      const response = await apiFetch(`/api/modules/${moduleId}/chat?limit=100`, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const data = await response.json();
        const msg = data.messages?.find((m: { id?: number }) => m.id === messageId);
        if (msg?.analyzed_entities && Object.keys(msg.analyzed_entities).length > 0) {
          setAnalyzedEntities(prev => {
            const newMap = new Map(prev);
            newMap.set(messageId, { ...msg.analyzed_entities, isAnalyzing: false });
            return newMap;
          });
          return true;
        }
      }

      // No result yet, retry after delay
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return fetchSavedEntities(messageId, retryCount + 1);
      }

      return false;
    } catch {
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return fetchSavedEntities(messageId, retryCount + 1);
      }
      return false;
    }
  }, [moduleId, userId]);

  // Call backend to analyze entities in AI response (saves to database)
  const analyzeEntitiesFromResponse = useCallback(async (messageId: number, content: string, entityTypes: string[]) => {
    if (!moduleId || entityTypes.length === 0) return;

    // Mark as analyzing
    setAnalyzedEntities(prev => {
      const newMap = new Map(prev);
      newMap.set(messageId, { npcs: [], shops: [], items: [], encounters: [], bosses: [], isAnalyzing: true });
      return newMap;
    });

    // Create abort controller for timeout (match backend's 180s timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 180s timeout

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/modules/${moduleId}/chat/analyze-entities`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: cleanContent(content),
            entity_types: entityTypes,
            message_id: messageId,  // Backend will save to database
            campaign_id: campaignId  // For searching resource library
          }),
          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);

      if (response.ok) {
        const entities = await response.json();
        setAnalyzedEntities(prev => {
          const newMap = new Map(prev);
          newMap.set(messageId, { ...entities, isAnalyzing: false });
          return newMap;
        });
      } else {
        // Request failed, try to fetch saved result (backend may have succeeded)
        const found = await fetchSavedEntities(messageId);
        if (!found) {
          setAnalyzedEntities(prev => {
            const newMap = new Map(prev);
            newMap.set(messageId, { npcs: [], shops: [], items: [], encounters: [], bosses: [], isAnalyzing: false });
            return newMap;
          });
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);

      // Check if it was a timeout (abort)
      if (err instanceof Error && err.name === 'AbortError') {
        logger.warn("Entity analysis request timed out, checking for saved results...");
      } else {
        logger.error("Failed to analyze entities:", err);
      }

      // Request failed or timed out, try to fetch saved result (backend may have succeeded)
      const found = await fetchSavedEntities(messageId);
      if (!found) {
        setAnalyzedEntities(prev => {
          const newMap = new Map(prev);
          newMap.set(messageId, { npcs: [], shops: [], items: [], encounters: [], bosses: [], isAnalyzing: false });
          return newMap;
        });
      }
    }
  }, [moduleId, campaignId, fetchSavedEntities]);

  // Trigger entity analysis when a message finishes streaming
  useEffect(() => {
    messages.forEach((msg) => {
      if (msg.role === 'assistant' && msg.id && !msg.isStreaming && !analyzedEntities.has(msg.id)) {
        const entityTypes = parseEntityMarkers(msg.content);
        if (entityTypes.length > 0) {
          analyzeEntitiesFromResponse(msg.id, msg.content, entityTypes);
        }
      }
    });
  }, [messages, analyzedEntities, analyzeEntitiesFromResponse]);

  // Extract potential NPC/monster names from AI response (prefer Chinese names)
  const extractEntityNames = (content: string): string[] => {
    const chineseNames: string[] = [];

    // Pattern 1: Match heading patterns like "### 1. 总督塔尔·埃尔塔 (Governor Tarbaw Nighthill)"
    // Also handles markdown bold like "### **1. 总督塔尔·埃尔塔**"
    const headingPattern = /###?\s*\**\d*\.?\s*([^(（\n*]+?)\**\s*(?:[（(]([^)）]+)[)）])?/gm;
    let match;
    while ((match = headingPattern.exec(content)) !== null) {
      let chineseName = match[1]?.trim().replace(/\*+/g, '').trim(); // Remove any remaining asterisks
      // Filter out section headers
      if (chineseName && !['重要NPC', '总览', 'DM', '小结', '建议', '章', '遭遇', '辅助'].some(w => chineseName.includes(w))) {
        if (chineseName.length >= 2 && chineseName.length <= 15) {
          if (!chineseNames.includes(chineseName)) {
            chineseNames.push(chineseName);
          }
        }
      }
    }

    // Pattern 2: Match Chinese names with · separator like 兰德卓萨·青怒
    const chineseNamePattern = /([^\s，。！？|\n*]{2,6}·[^\s，。！？|\n*]{2,6})/g;
    while ((match = chineseNamePattern.exec(content)) !== null) {
      const name = match[1]?.trim().replace(/\*+/g, '');
      if (name && !chineseNames.includes(name)) {
        chineseNames.push(name);
      }
    }

    // If we found Chinese names, use them; otherwise fall back to English from tables
    if (chineseNames.length > 0) {
      return chineseNames.slice(0, 5);
    }

    // Fallback: Look for English names in table rows if no Chinese names found
    const names: string[] = [];
    const tableRowPattern = /\|\s*([A-Z][a-z]+(?:\s+[A-Za-z]+){1,4})\s*\|/g;
    while ((match = tableRowPattern.exec(content)) !== null) {
      const name = match[1]?.trim();
      if (name && name.length > 3 && !names.includes(name)) {
        names.push(name);
      }
    }

    return names.slice(0, 5);
  };

  // Check if content mentions NPCs/monsters that could be created
  const shouldShowCreateButton = (content: string, entityNames: string[]): boolean => {
    // Only show if we actually found entity names
    if (entityNames.length === 0) return false;
    // And if the content suggests creation might be useful
    const keywords = ['属性', '创建', '生成', 'NPC', '怪物', '角色', 'CR', 'HP', 'AC'];
    return keywords.some(kw => content.includes(kw));
  };

  // Check if content contains encounter design
  const isEncounterContent = (content: string): boolean => {
    const encounterKeywords = ['遭遇', '敌方阵容', '挑战等级', '敌人构成', '战斗', 'CR 1', 'CR 2', 'CR 3', 'CR 4', 'CR 5'];
    const structureKeywords = ['遭遇目标', '遭遇流程', '奖励建议', '敌方阵容', '环境'];
    const hasEncounterKeywords = encounterKeywords.filter(kw => content.includes(kw)).length >= 2;
    const hasStructure = structureKeywords.filter(kw => content.includes(kw)).length >= 2;
    return hasEncounterKeywords && hasStructure;
  };

  // Extract encounter title from content
  const extractEncounterTitle = (content: string): string => {
    // Look for patterns like "遭遇标题：燃烧的哨岗" or "### 🐉 遭遇标题：..."
    const titlePatterns = [
      /遭遇标题[：:]\s*([^\n（(]+)/,
      /###?\s*[🐉⚔️🎯]?\s*遭遇[：:]\s*([^\n（(]+)/,
      /###?\s*[🐉⚔️🎯]?\s*([^\n（(]+遭遇[^\n（(]*)/,
    ];
    for (const pattern of titlePatterns) {
      const match = content.match(pattern);
      if (match?.[1]) {
        return match[1].trim().replace(/\*+/g, '').substring(0, 30);
      }
    }
    return '新遭遇';
  };

  // Generate a simple summary for collapsed messages (max 2 lines ~100 chars)
  const generateSummary = (content: string): string => {
    // First clean entity markers, then remove markdown formatting for cleaner summary
    let plain = cleanContent(content)
      .replace(/^#+\s*/gm, '') // Remove headings
      .replace(/\*+([^*]+)\*+/g, '$1') // Remove bold/italic
      .replace(/[─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬→←↑↓]/g, '') // Remove box chars
      .replace(/\n{2,}/g, '\n') // Collapse multiple newlines
      .trim();

    // Get first meaningful line that's not too short
    const lines = plain.split('\n').filter(l => l.trim().length > 10);
    const firstLine = lines[0] || plain.substring(0, 100);

    if (firstLine.length > 100) {
      return firstLine.substring(0, 97) + '...';
    }
    return firstLine + (lines.length > 1 ? '...' : '');
  };

  // Toggle collapse state for a message (using message ID for stability)
  const toggleCollapse = (messageId: number) => {
    setCollapsedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      // Persist to localStorage
      const storageKey = `module_chat_collapsed_${moduleId}_${userId}`;
      localStorage.setItem(storageKey, JSON.stringify([...newSet]));
      return newSet;
    });
  };

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const storageKey = `module_chat_collapsed_${moduleId}_${userId}`;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const ids = JSON.parse(saved) as number[];
        setCollapsedMessages(new Set(ids));
      } catch {
        // ignore invalid data
      }
    }
  }, [moduleId, userId]);

  // Save to notes
  const saveToNotes = async (content: string, idx: number) => {
    if (!content.trim()) return;
    setSavingNoteIdx(idx);
    try {
      const response = await fetch(`${API_BASE_URL}/api/modules/${moduleId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ content: content.trim() })
      });
      if (response.ok) {
        setSavingNoteIdx(null);
        setSavedNoteIdxs(prev => new Set(prev).add(idx));
      } else {
        throw new Error('保存失败');
      }
    } catch (err) {
      logger.error('Failed to save note:', err);
      setError('保存笔记失败');
      setSavingNoteIdx(null);
    }
  };

  // Quick create NPC from pre-generated data (no LLM call)
  const quickCreateNPC = async (entityData: EntityData) => {
    if (!campaignId) {
      setError("需要选择战役才能创建NPC");
      return;
    }
    setCreatingNPC(entityData.name);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/modules/${moduleId}/chat/create-entity?campaign_id=${campaignId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_type: 'npc', data: entityData })
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || '创建失败');
      }

      const result = await response.json();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ **${result.name}** 已创建成功！\n\n- CR: ${entityData.challenge_rating || '?'}\n- HP: ${entityData.hit_points || '?'}\n- AC: ${entityData.armor_class || '?'}\n\n头像正在生成中...`
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreatingNPC(null);
    }
  };

  // Create encounter from pre-generated data (no LLM call)
  const createEncounter = async (entityData: EntityData) => {
    if (!campaignId) {
      setError("需要选择战役才能创建遭遇");
      return;
    }
    setCreatingEncounter(entityData.name || entityData.title as string);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/modules/${moduleId}/chat/create-entity?campaign_id=${campaignId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_type: 'encounter', data: entityData })
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || '创建遭遇失败');
      }

      const result = await response.json();

      // Build success message showing created monsters
      const title = entityData.title || entityData.name || '遭遇';
      let successMsg = `✅ 遭遇「**${title}**」已创建！\n\n`;
      if (result.monsters && result.monsters.length > 0) {
        successMsg += `**已创建 ${result.monsters.length} 个怪物到资源库：**\n`;
        for (const m of result.monsters) {
          successMsg += `- ${m.name} (CR ${m.challenge_rating}, HP ${m.hit_points})\n`;
        }
        successMsg += `\n头像生成后将自动添加到地图。`;
      } else {
        successMsg += `遭遇已保存。`;
      }

      setMessages(prev => [...prev, { role: 'assistant', content: successMsg }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建遭遇失败");
    } finally {
      setCreatingEncounter(null);
    }
  };

  // Extract potential item names from AI response
  const extractItemNames = (content: string): string[] => {
    const itemNames: string[] = [];
    // Pattern for items in headings like "### 龙牙匕首 (Dagger of the Dragon)"
    const headingPattern = /###?\s*\**\d*\.?\s*([^(（\n*]+?)\**\s*(?:[（(]([^)）]+)[)）])?/gm;
    // Pattern for items in bullet points like "● 皮甲" or "- 长剑"
    const bulletPattern = /[●•\-*]\s*\**([^(（\n●•*:：]{2,15}?)\**/gm;
    // Item-related keywords for filtering
    const itemKeywords = ['甲', '剑', '斧', '锤', '弓', '弩', '盾', '杖', '匕首', '长矛', '药水', '卷轴', '戒指', '护符', '火把', '绳索', 'armor', 'sword', 'shield', 'potion', 'scroll'];
    const excludeWords = ['物品', '装备', '武器', '防具', '道具', '商店', '总览', '章', '来源', '类型', '备注', '可能', '模组', '身份', '描述', '角色', '位置', '玩家'];

    let match;
    while ((match = headingPattern.exec(content)) !== null) {
      const name = match[1]?.trim().replace(/\*+/g, '').trim();
      if (name && name.length >= 2 && name.length <= 20) {
        if (!excludeWords.some(w => name.includes(w))) {
          if (itemKeywords.some(kw => name.toLowerCase().includes(kw.toLowerCase()))) {
            if (!itemNames.includes(name)) itemNames.push(name);
          }
        }
      }
    }
    // Also check bullet points for specific items
    while ((match = bulletPattern.exec(content)) !== null) {
      const name = match[1]?.trim().replace(/\*+/g, '').trim();
      if (name && name.length >= 2 && name.length <= 15) {
        if (!excludeWords.some(w => name.includes(w))) {
          if (itemKeywords.some(kw => name.toLowerCase().includes(kw.toLowerCase()))) {
            if (!itemNames.includes(name)) itemNames.push(name);
          }
        }
      }
    }
    return itemNames.slice(0, 5);
  };

  // Check if content mentions items that could be created
  const shouldShowCreateItemButton = (content: string, itemNames: string[]): boolean => {
    if (itemNames.length === 0) return false;
    const keywords = ['物品', '装备', '武器', '防具', '道具', '魔法', '价格', 'gp', '金币', '稀有度'];
    return keywords.some(kw => content.toLowerCase().includes(kw.toLowerCase()));
  };

  // Extract potential shop names from AI response
  const extractShopNames = (content: string): string[] => {
    const shopNames: string[] = [];
    // Pattern for shops in headings
    const headingPattern = /###?\s*\**\d*\.?\s*([^(（\n*]+?)\**\s*(?:[（(]([^)）]+)[)）])?/gm;
    // Shop-related keywords (expanded to include armory, market, etc.)
    const shopKeywords = ['店', '铺', '商', '军械库', '市场', '铁匠', '药剂', '酒馆', '旅店', 'shop', 'store', 'market', 'armory', 'smithy', 'tavern', 'inn'];
    let match;
    while ((match = headingPattern.exec(content)) !== null) {
      const name = match[1]?.trim().replace(/\*+/g, '').trim();
      if (name && name.length >= 2 && name.length <= 30) {
        // Check for shop-related keywords in name
        if (shopKeywords.some(w => name.toLowerCase().includes(w.toLowerCase()))) {
          if (!shopNames.includes(name)) shopNames.push(name);
        }
      }
    }
    return shopNames.slice(0, 5);
  };

  // Check if content mentions shops
  const shouldShowCreateShopButton = (content: string, shopNames: string[]): boolean => {
    if (shopNames.length === 0) return false;
    const keywords = ['商店', '店铺', '商人', '经营', '出售', '购买', '库存', '装备来源', '物资', '军械库'];
    return keywords.some(kw => content.includes(kw));
  };

  // Quick create Item from pre-generated data (no LLM call)
  const quickCreateItem = async (entityData: EntityData) => {
    if (!campaignId) {
      setError("需要选择战役才能创建物品");
      return;
    }
    setCreatingItem(entityData.name);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/modules/${moduleId}/chat/create-entity?campaign_id=${campaignId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_type: 'item', data: entityData })
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || '创建失败');
      }

      const result = await response.json();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ **${result.name}** 已创建成功！\n\n- 分类: ${entityData.category || '?'}\n- 稀有度: ${entityData.rarity || '?'}\n\n已添加到资源库`
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreatingItem(null);
    }
  };

  // Quick create Shop from pre-generated data (no LLM call)
  const quickCreateShop = async (entityData: EntityData) => {
    if (!campaignId) {
      setError("需要选择战役才能创建商店");
      return;
    }
    setCreatingShop(entityData.name);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/modules/${moduleId}/chat/create-entity?campaign_id=${campaignId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_type: 'shop', data: entityData })
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || '创建失败');
      }

      const result = await response.json();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ **${result.name}** 商店已创建成功！\n\n${entityData.description ? `描述: ${entityData.description}\n\n` : ''}已添加到资源库`
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreatingShop(null);
    }
  };

  // Generate tactical map from pre-analyzed map data
  const generateMap = async (mapData: MapEntityData) => {
    if (!campaignId) {
      setError("需要选择战役才能生成地图");
      return;
    }
    setGeneratingMap(mapData.name);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/modules/${moduleId}/chat/generate-map?campaign_id=${campaignId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            map_data: mapData,
            reference_map_url: null  // Could add current map as reference in the future
          })
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || '生成地图失败');
      }

      const result = await response.json();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ 地图「**${result.map_name}**」已生成成功！\n\n地图已添加到战役地图列表中，可在地图选择器中找到。\n\n- 环境: ${mapData.environment || '未知'}\n- 光照: ${mapData.lighting || '未知'}`
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成地图失败");
    } finally {
      setGeneratingMap(null);
    }
  };

  // Extract map points (preset function) - loads from database or generates via AI
  const extractMapPoints = async () => {
    if (!campaignId || !mapUrl) {
      setError("需要选择战役和地图才能获取地图要点");
      return;
    }
    setExtractingMapPoints(true);
    setShowPresetMenu(false);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/modules/${moduleId}/chat/extract-map-points?campaign_id=${campaignId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ map_url: mapUrl })
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || '获取地图要点失败');
      }

      const result = await response.json();
      const markers = result.markers || [];

      if (markers.length > 0) {
        setMapMarkers(markers);
        const sourceText = result.source === 'ai_generated' ? '（AI 分析生成）' : '（从数据库加载）';
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ 已加载 **${markers.length}** 个地图要点${sourceText}\n\n${markers.slice(0, 5).map((m: MapMarker) => `- **${m.label}**: ${m.content}`).join('\n')}${markers.length > 5 ? `\n- ...还有 ${markers.length - 5} 个标记` : ''}`
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⚠️ ${result.message || 'AI分析地图失败，请稍后重试。'}`
        }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取地图要点失败");
    } finally {
      setExtractingMapPoints(false);
    }
  };

  // Plan map encounter (preset function - Step 1)
  const planMapEncounter = async (density: string = 'normal', sourceMode: string = 'module_extend') => {
    if (!campaignId || !mapUrl) {
      setError("需要选择战役和地图才能规划遭遇");
      return;
    }
    setPlanningEncounter(true);
    setShowPresetMenu(false);
    setShowDensityMenu(false);
    setShowSourceModeMenu(false);
    setError(null);
    setCurrentPlan(null);
    setShowModifyInput(false);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/modules/${moduleId}/chat/plan-map-encounter?campaign_id=${campaignId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ map_url: mapUrl, density, source_mode: sourceMode })
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || '规划遭遇失败');
      }

      const result = await response.json();
      const planText = result.plan_text || '';
      const playerInfo = result.player_info || {};

      if (planText) {
        // Store plan for potential execution
        setCurrentPlan({ text: planText, mapUrl: mapUrl });

        // Build player info summary
        let playerSummary = '';
        if (playerInfo.players && playerInfo.players.length > 0) {
          playerSummary = `\n\n**队伍信息**: ${playerInfo.count}名玩家，平均等级 ${playerInfo.average_level}`;
        }

        // Add plan as assistant message (with ID from database for persistence)
        setMessages(prev => [...prev, {
          id: result.message_id,
          role: 'assistant',
          content: `## 🗺️ 地图遭遇规划${playerSummary}\n\n${planText}\n\n---\n*使用下方按钮执行或修改规划*`,
          analyzed_entities: {
            npcs: [], shops: [], items: [], encounters: [],
            type: 'encounter_plan',
            plan_text: planText,
            map_url: mapUrl
          }
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⚠️ 未能生成遭遇规划。请确保地图和模组数据已正确加载。`
        }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "规划遭遇失败");
    } finally {
      setPlanningEncounter(false);
    }
  };

  // Modify encounter plan
  const modifyEncounterPlan = async () => {
    if (!currentPlan || !modifyText.trim()) {
      return;
    }
    setModifyingPlan(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/modules/${moduleId}/chat/modify-encounter-plan?campaign_id=${campaignId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            map_url: currentPlan.mapUrl,
            current_plan: currentPlan.text,
            modification: modifyText
          })
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || '修改规划失败');
      }

      const result = await response.json();
      const newPlanText = result.plan_text || '';

      if (newPlanText) {
        setCurrentPlan({ text: newPlanText, mapUrl: currentPlan.mapUrl });
        setMessages(prev => [...prev, {
          id: result.message_id,
          role: 'assistant',
          content: `## 🗺️ 修改后的遭遇规划\n\n**修改内容**: ${modifyText}\n\n${newPlanText}\n\n---\n*使用下方按钮执行或继续修改*`,
          analyzed_entities: {
            npcs: [], shops: [], items: [], encounters: [],
            type: 'encounter_plan',
            plan_text: newPlanText,
            map_url: currentPlan.mapUrl
          }
        }]);
        setModifyText('');
        setShowModifyInput(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改规划失败");
    } finally {
      setModifyingPlan(false);
    }
  };

  // Execute map encounter plan (Step 2)
  const executeMapEncounter = async (planOverride?: { text: string; mapUrl: string }) => {
    const planToExecute = planOverride || currentPlan;
    if (!campaignId || !planToExecute) {
      setError("没有可执行的规划");
      return;
    }
    setExecutingEncounter(true);
    setError(null);

    try {
      // Get viewport center for positioning tokens
      // Default to (15, 15) in grid coordinates - should be visible on most maps
      const viewportCenter = getViewportCenter?.() || { x: 15, y: 15 };
      console.log('[DEBUG executeMapEncounter] Using viewport center (grid):', viewportCenter);

      const response = await fetch(
        `${API_BASE_URL}/api/modules/${moduleId}/chat/execute-map-encounter?campaign_id=${campaignId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            map_url: planToExecute.mapUrl,
            plan_text: planToExecute.text,
            viewport_center_x: viewportCenter.x,
            viewport_center_y: viewportCenter.y
          })
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || '执行规划失败');
      }

      const result = await response.json();

      // Clear the current plan after execution
      setCurrentPlan(null);

      // Show success message
      const entities = result.entities || [];
      const areaGroups = entities.reduce((acc: Record<string, string[]>, e: { area: string; name: string }) => {
        if (!acc[e.area]) acc[e.area] = [];
        acc[e.area].push(e.name);
        return acc;
      }, {});

      let successMsg = `✅ **遭遇已部署到地图！**\n\n已创建 **${result.created_count}** 个实体：\n\n`;
      for (const [area, names] of Object.entries(areaGroups)) {
        successMsg += `**${area}**: ${(names as string[]).join(', ')}\n`;
      }
      successMsg += `\n怪物Token已放置到对应位置。`;

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: successMsg
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "执行规划失败");
    } finally {
      setExecutingEncounter(false);
    }
  };

  // Send message with SSE streaming
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

    // Add placeholder assistant message for streaming
    setMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true }]);

    try {
      // Build query params
      const params = new URLSearchParams();
      if (campaignId) {
        params.append('campaign_id', campaignId.toString());
      }
      if (currentSessionId) {
        params.append('session_id', currentSessionId.toString());
      }
      if (analyzeMap) {
        params.append('analyze_map', 'true');
      }

      const response = await apiFetch(`/api/modules/${moduleId}/chat/query?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          ...(selectedChapterTitles.size > 0 && { chapter_titles: Array.from(selectedChapterTitles) }),
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let messageId: number | undefined;
      let streamSessionId: number | null = null;
      let streamSessionSwitched = false;
      let streamPreviousSessionId: number | null = null;
      let streamSessionTitle: string | null = null;
      let streamSessionMessageCount: number | null = null;
      let streamSessionUpdatedAt: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (typeof data.session_id === 'number') {
                streamSessionId = data.session_id;
              }
              if (typeof data.session_switched === 'boolean') {
                streamSessionSwitched = data.session_switched;
              }
              if (typeof data.previous_session_id === 'number') {
                streamPreviousSessionId = data.previous_session_id;
              } else if (data.previous_session_id === null) {
                streamPreviousSessionId = null;
              }
              if (typeof data.session_title === 'string') {
                streamSessionTitle = data.session_title;
              } else if (data.session_title === null) {
                streamSessionTitle = null;
              }
              if (typeof data.session_message_count === 'number') {
                streamSessionMessageCount = data.session_message_count;
              }
              if (typeof data.session_updated_at === 'string') {
                streamSessionUpdatedAt = data.session_updated_at;
              } else if (data.session_updated_at === null) {
                streamSessionUpdatedAt = null;
              }

              if (data.content) {
                setMessages(prev => {
                  const newMessages = [...prev];
                  const lastIdx = newMessages.length - 1;
                  if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                    newMessages[lastIdx] = {
                      ...newMessages[lastIdx],
                      content: newMessages[lastIdx].content + data.content
                    };
                  }
                  return newMessages;
                });
              }
              if (data.user_message_id) {
                setMessages(prev => {
                  const newMessages = [...prev];
                  for (let j = newMessages.length - 1; j >= 0; j--) {
                    if (newMessages[j].role === 'user' && !newMessages[j].id) {
                      newMessages[j] = { ...newMessages[j], id: data.user_message_id };
                      break;
                    }
                  }
                  return newMessages;
                });
              }
              if (data.done) {
                messageId = data.message_id;
                // If AI used [[RANDOM:...]] tags, backend processed them and sent final content
                // Replace the streamed content with the processed version
                if (data.processed_content) {
                  setMessages(prev => {
                    const newMessages = [...prev];
                    const lastIdx = newMessages.length - 1;
                    if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                      newMessages[lastIdx] = {
                        ...newMessages[lastIdx],
                        content: data.processed_content
                      };
                    }
                    return newMessages;
                  });
                }
              }
              if (data.error) {
                throw new Error(data.error);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }

      // Mark streaming as complete and parse map markers
      setMessages(prev => {
        const newMessages = [...prev];
        const lastIdx = newMessages.length - 1;
        if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
          const finalContent = newMessages[lastIdx].content;
          newMessages[lastIdx] = {
            ...newMessages[lastIdx],
            id: messageId,
            isStreaming: false
          };

          // Parse and set map markers if analyze_map was enabled
          if (analyzeMap && finalContent) {
            const markers = parseMapMarkers(finalContent);
            if (markers.length > 0) {
              logger.info(`Found ${markers.length} map markers from AI response`);
              setMapMarkers(markers);
              // Save to database if we have campaign and map context
              if (campaignId && mapUrl) {
                saveAIMapMarkers(campaignId, mapUrl, markers);
              }
            }
          }
        }
        return newMessages;
      });

      const respondedSessionId = streamSessionId ?? currentSessionId;
      const switchedToNewSession =
        Boolean(streamSessionSwitched) &&
        typeof respondedSessionId === 'number' &&
        respondedSessionId !== currentSessionId;

      // Auto-generate session title after first response (only for normal non-rollover flow)
      if (respondedSessionId && !switchedToNewSession) {
        const currentSess = sessions.find(s => s.id === respondedSessionId);
        if (currentSess && (currentSess.title === '新对话' || !currentSess.title) && currentSess.message_count === 0) {
          apiFetch(`/api/modules/${moduleId}/chat/sessions/${respondedSessionId}/generate-title`, { method: 'POST' })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data?.title) {
                setSessions(prev => prev.map(s => s.id === respondedSessionId ? { ...s, title: data.title } : s));
              }
            })
            .catch(() => {});
        }
      }

      if (respondedSessionId) {
        setSessions(prev => {
          const current = prev.find(s => s.id === respondedSessionId);
          const nextTitle =
            streamSessionTitle
            ?? current?.title
            ?? (switchedToNewSession ? '新对话（续）' : '新对话');
          const nextCount =
            typeof streamSessionMessageCount === 'number'
              ? streamSessionMessageCount
              : (current?.message_count ?? 0) + (switchedToNewSession ? 0 : 2);
          const nextUpdatedAt = streamSessionUpdatedAt ?? new Date().toISOString();
          const updatedSession: ChatSessionInfo = {
            id: respondedSessionId,
            title: nextTitle,
            message_count: nextCount,
            updated_at: nextUpdatedAt,
          };
          const others = prev.filter(s => s.id !== respondedSessionId);
          return [updatedSession, ...others];
        });
      }

      if (switchedToNewSession && respondedSessionId) {
        logger.info(
          `Auto-switched module chat session: ${streamPreviousSessionId ?? 'unknown'} -> ${respondedSessionId}`
        );
        setCurrentSessionId(respondedSessionId);
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
    // First click: show confirmation
    if (pendingDeleteIdx !== idx) {
      setPendingDeleteIdx(idx);
      // Auto-reset after 3 seconds
      setTimeout(() => {
        setPendingDeleteIdx(prev => prev === idx ? null : prev);
      }, 3000);
      return;
    }

    // Second click: actually delete
    try {
      await apiFetch(`/api/modules/${moduleId}/chat/${messageId}`, { method: 'DELETE' });
      setMessages(prev => prev.filter((_, i) => i !== idx));
      setPendingDeleteIdx(null);

      // Clean up collapsed state for deleted message
      setCollapsedMessages(prev => {
        if (prev.has(messageId)) {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          const storageKey = `module_chat_collapsed_${moduleId}_${userId}`;
          localStorage.setItem(storageKey, JSON.stringify([...newSet]));
          return newSet;
        }
        return prev;
      });
    } catch (err) {
      logger.error("Failed to delete message:", err);
    }
  };

  const clearHistory = async () => {
    if (!confirm("确定要清空当前对话的聊天记录吗？")) return;
    try {
      const params = new URLSearchParams();
      if (currentSessionId) params.append('session_id', currentSessionId.toString());
      await apiFetch(`/api/modules/${moduleId}/chat?${params}`, { method: 'DELETE' });
      setMessages([]);
      setCollapsedMessages(new Set());
      const storageKey = `module_chat_collapsed_${moduleId}_${userId}`;
      localStorage.removeItem(storageKey);
      // Update local session message count
      if (currentSessionId) {
        setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, message_count: 0 } : s));
      }
    } catch (err) {
      logger.error("Failed to clear history:", err);
    }
  };

  // ===== Session handlers =====
  const createSession = async () => {
    try {
      const params = new URLSearchParams();
      if (campaignId) params.append('campaign_id', campaignId.toString());
      const qs = params.toString();
      const resp = await apiFetch(`/api/modules/${moduleId}/chat/sessions${qs ? `?${qs}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (resp.ok) {
        const newSession: ChatSessionInfo = await resp.json();
        setSessions(prev => [newSession, ...prev]);
        setCurrentSessionId(newSession.id);
      }
    } catch (err) {
      logger.error("Failed to create session:", err);
    }
  };

  const deleteSession = async (id: number) => {
    try {
      await apiFetch(`/api/modules/${moduleId}/chat/sessions/${id}`, { method: 'DELETE' });
      setSessions(prev => {
        const remaining = prev.filter(s => s.id !== id);
        if (currentSessionId === id && remaining.length > 0) {
          setCurrentSessionId(remaining[0].id);
        }
        return remaining;
      });
    } catch (err) {
      logger.error("Failed to delete session:", err);
    }
  };

  const renameSession = async (id: number, title: string) => {
    try {
      const resp = await apiFetch(`/api/modules/${moduleId}/chat/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (resp.ok) {
        const updated: ChatSessionInfo = await resp.json();
        setSessions(prev => prev.map(s => s.id === id ? { ...s, title: updated.title } : s));
      }
    } catch (err) {
      logger.error("Failed to rename session:", err);
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

      {/* Header */}
      <div className="relative px-2 py-1.5 border-b border-amber-900/30 bg-stone-900/80 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 min-w-0">
            <ModuleChatSessionSelector
              sessions={sessions}
              currentSessionId={currentSessionId}
              onSelect={setCurrentSessionId}
              onCreate={createSession}
              onDelete={deleteSession}
              onRename={renameSession}
            />
          </div>
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="flex-shrink-0 p-1 text-stone-500 hover:text-red-400 hover:bg-red-950/30 rounded transition-all"
              title="清除记录"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className={`flex-1 overflow-auto px-3 py-4 space-y-4 relative transition-opacity duration-200 ${isReady ? 'opacity-100' : 'opacity-0'}`}>
        {messages.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="relative mb-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-900/40 to-stone-900 border border-amber-800/30 flex items-center justify-center shadow-2xl shadow-amber-900/20">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-600/20 to-transparent flex items-center justify-center">
                  <svg className="w-6 h-6 text-amber-500/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                  </svg>
                </div>
              </div>
            </div>
            <p className="text-amber-200/80 text-sm font-medium mb-1">模组智能助手</p>
            <p className="text-stone-500 text-xs mb-4">
              {moduleTitle ? `关于「${moduleTitle}」` : "请先选择模组"}
            </p>
            <div className="w-full max-w-[280px] space-y-2">
              <p className="text-stone-600 text-[10px] mb-2">试试问我：</p>
              {[
                "这个模组如何备团？",
                "第一章有哪些重要NPC？",
                "模组中有哪些怪物？",
                "介绍一下主要敌人"
              ].map((q, i) => (
                <button
                  key={i}
                  onClick={() => setInputValue(q)}
                  disabled={!moduleId}
                  className="w-full text-left text-xs px-3 py-2 bg-stone-800/50 hover:bg-stone-700/50 disabled:opacity-50 disabled:cursor-not-allowed border border-stone-700/50 hover:border-amber-700/30 rounded-lg text-stone-400 hover:text-amber-200 transition-all"
                >
                  <span className="text-amber-600/60 mr-1.5">→</span>{q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                /* User Message */
                <div className="max-w-[85%] group">
                  <div className="relative bg-gradient-to-br from-amber-950/60 to-amber-900/40 rounded-lg px-4 py-3 border border-amber-800/30 shadow-lg">
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
                        className={`text-[10px] transition-colors flex items-center gap-1 ${
                          pendingDeleteIdx === idx
                            ? 'text-red-400 bg-red-950/50 px-1.5 py-0.5 rounded'
                            : 'text-stone-500 hover:text-red-400'
                        }`}
                        title={pendingDeleteIdx === idx ? "再次点击确认删除" : "删除消息"}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        {pendingDeleteIdx === idx ? '确认删除?' : '删除'}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* AI Message */
                <div className="max-w-full group">
                  <div className="relative bg-gradient-to-br from-stone-800/80 to-stone-900/90 rounded-lg border border-stone-700/50 shadow-xl overflow-hidden">
                    <RuneCorner position="tl" />
                    <RuneCorner position="tr" />
                    <RuneCorner position="bl" />
                    <RuneCorner position="br" />

                    <div className="px-4 py-3">
                      {/* Collapsed view: show summary */}
                      {msg.id && collapsedMessages.has(msg.id) ? (
                        <div className="text-sm text-stone-400 italic">
                          {generateSummary(msg.content)}
                        </div>
                      ) : (
                        /* Expanded view: full content */
                        <div className="text-sm text-stone-300 leading-relaxed prose-custom">
                          <MemoizedMarkdown content={msg.content} />
                        {msg.isStreaming && <LoadingDots />}
                      </div>
                      )}

                      {/* Analyzed Entities - unified quick create section */}
                      {(() => {
                        if (msg.isStreaming || !msg.content || !campaignId || !msg.id) return null;

                        const entities = analyzedEntities.get(msg.id);

                        // Still analyzing
                        if (entities?.isAnalyzing) {
                          return (
                            <div className="mt-3 pt-2 border-t border-stone-700/30">
                              <p className="text-xs text-stone-500 flex items-center gap-2">
                                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                正在分析可创建的实体...
                              </p>
                            </div>
                          );
                        }

                        // No entities or no analysis needed
                        if (!entities) return null;

                        const hasEntities = (entities.npcs?.length ?? 0) > 0 || (entities.shops?.length ?? 0) > 0 ||
                                           (entities.items?.length ?? 0) > 0 || (entities.encounters?.length ?? 0) > 0 ||
                                           (entities.bosses?.length ?? 0) > 0 ||
                                           (entities.maps?.length ?? 0) > 0;
                        if (!hasEntities) return null;

                        const isExpanded = expandedEntities.has(msg.id);

                        // Build summary parts for collapsed view
                        const summaryParts: string[] = [];
                        if (entities.npcs?.length) summaryParts.push(`👤 ${entities.npcs.length}个NPC`);
                        if (entities.encounters?.length) summaryParts.push(`⚔️ ${entities.encounters.length}个遭遇`);
                        if (entities.bosses?.length) summaryParts.push(`👹 ${entities.bosses.length}个BOSS`);
                        if (entities.items?.length) summaryParts.push(`📦 ${entities.items.length}个物品`);
                        if (entities.shops?.length) summaryParts.push(`🏪 ${entities.shops.length}个商店`);
                        if (entities.maps?.length) summaryParts.push(`🗺️ ${entities.maps.length}个地图`);

                        const toggleExpand = () => setExpandedEntities(prev => {
                          const next = new Set(prev);
                          if (next.has(msg.id!)) next.delete(msg.id!);
                          else next.add(msg.id!);
                          return next;
                        });

                        return (
                          <div className="mt-3 pt-2 border-t border-stone-700/30">
                            {!isExpanded ? (
                              <button
                                onClick={toggleExpand}
                                className="w-full text-left text-[11px] text-stone-400 hover:text-stone-200 transition-colors flex items-center gap-1.5 py-0.5"
                              >
                                <span>识别到 {summaryParts.join(' ')}</span>
                                <svg className="w-3 h-3 ml-auto flex-shrink-0 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            ) : (
                              <>
                              <div className="space-y-3">
                            {/* NPCs */}
                            {(entities.npcs?.length ?? 0) > 0 && (
                              <div>
                                <p className="text-xs text-stone-500 mb-2">👤 角色/NPC：</p>
                                <div className="flex flex-wrap gap-2">
                                  {entities.npcs.map((npc, i) => (
                                    <button
                                      key={i}
                                      onClick={() => quickCreateNPC(npc)}
                                      disabled={creatingNPC !== null}
                                      className="px-3 py-1.5 text-xs bg-violet-900/50 hover:bg-violet-800/60 disabled:bg-stone-800 disabled:cursor-not-allowed text-violet-300 hover:text-violet-200 disabled:text-stone-500 border border-violet-700/50 rounded transition-all flex items-center gap-1.5"
                                    >
                                      {creatingNPC === npc.name ? (
                                        <>
                                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                          </svg>
                                          创建中...
                                        </>
                                      ) : `创建「${npc.name}」`}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Encounters */}
                            {(entities.encounters?.length ?? 0) > 0 && (
                              <div>
                                <p className="text-xs text-stone-500 mb-2">⚔️ 遭遇：</p>
                                <div className="flex flex-wrap gap-2">
                                  {entities.encounters.map((enc, i) => (
                                    <button
                                      key={i}
                                      onClick={() => createEncounter(enc)}
                                      disabled={creatingEncounter !== null}
                                      className="px-3 py-1.5 text-xs bg-orange-900/50 hover:bg-orange-800/60 disabled:bg-stone-800 disabled:cursor-not-allowed text-orange-300 hover:text-orange-200 disabled:text-stone-500 border border-orange-700/50 rounded transition-all flex items-center gap-1.5"
                                    >
                                      {creatingEncounter === (enc.name || enc.title) ? (
                                        <>
                                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                          </svg>
                                          创建中...
                                        </>
                                      ) : `创建「${enc.title || enc.name}」`}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Boss Encounters */}
                            {entities.bosses && entities.bosses.length > 0 && (
                              <div>
                                <p className="text-xs text-stone-500 mb-2">👹 BOSS战：</p>
                                <div className="flex flex-wrap gap-2">
                                  {entities.bosses.map((boss, i) => {
                                    const bossName = (boss.title as string | undefined) || boss.name || 'BOSS';
                                    return (
                                    <button
                                      key={i}
                                      onClick={() => {
                                        setCreatingBoss(bossName);
                                        createEncounter(boss).finally(() => { setCreatingBoss(null); });
                                      }}
                                      disabled={creatingBoss !== null || creatingEncounter !== null}
                                      className="px-3 py-1.5 text-xs bg-red-900/50 hover:bg-red-800/60 disabled:bg-stone-800 disabled:cursor-not-allowed text-red-300 hover:text-red-200 disabled:text-stone-500 border border-red-700/50 rounded transition-all flex items-center gap-1.5"
                                    >
                                      {creatingBoss === bossName ? (
                                        <>
                                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                          </svg>
                                          创建中...
                                        </>
                                      ) : `创建「${bossName}」`}
                                    </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Items */}
                            {(entities.items?.length ?? 0) > 0 && (
                              <div>
                                <p className="text-xs text-stone-500 mb-2">📦 物品：</p>
                                <div className="flex flex-wrap gap-2">
                                  {entities.items.map((item, i) => (
                                    <button
                                      key={i}
                                      onClick={() => quickCreateItem(item)}
                                      disabled={creatingItem !== null}
                                      className="px-3 py-1.5 text-xs bg-emerald-900/50 hover:bg-emerald-800/60 disabled:bg-stone-800 disabled:cursor-not-allowed text-emerald-300 hover:text-emerald-200 disabled:text-stone-500 border border-emerald-700/50 rounded transition-all flex items-center gap-1.5"
                                    >
                                      {creatingItem === item.name ? (
                                        <>
                                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                          </svg>
                                          创建中...
                                        </>
                                      ) : `创建「${item.name}」`}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Shops */}
                            {(entities.shops?.length ?? 0) > 0 && (
                              <div>
                                <p className="text-xs text-stone-500 mb-2">🏪 商店：</p>
                                <div className="flex flex-wrap gap-2">
                                  {entities.shops.map((shop, i) => (
                                    <button
                                      key={i}
                                      onClick={() => quickCreateShop(shop)}
                                      disabled={creatingShop !== null}
                                      className="px-3 py-1.5 text-xs bg-amber-900/50 hover:bg-amber-800/60 disabled:bg-stone-800 disabled:cursor-not-allowed text-amber-300 hover:text-amber-200 disabled:text-stone-500 border border-amber-700/50 rounded transition-all flex items-center gap-1.5"
                                    >
                                      {creatingShop === shop.name ? (
                                        <>
                                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                          </svg>
                                          创建中...
                                        </>
                                      ) : `创建「${shop.name}」`}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Maps */}
                            {entities.maps && entities.maps.length > 0 && (
                              <div>
                                <p className="text-xs text-stone-500 mb-2">🗺️ 场景地图：</p>
                                <div className="flex flex-wrap gap-2">
                                  {entities.maps.map((map, i) => (
                                    <button
                                      key={i}
                                      onClick={() => generateMap(map)}
                                      disabled={generatingMap !== null}
                                      className="px-3 py-1.5 text-xs bg-sky-900/50 hover:bg-sky-800/60 disabled:bg-stone-800 disabled:cursor-not-allowed text-sky-300 hover:text-sky-200 disabled:text-stone-500 border border-sky-700/50 rounded transition-all flex items-center gap-1.5"
                                    >
                                      {generatingMap === map.name ? (
                                        <>
                                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                          </svg>
                                          生成中...
                                        </>
                                      ) : `生成「${map.name}」地图`}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                              <button
                                onClick={toggleExpand}
                                className="mt-2 text-[11px] text-stone-400 hover:text-stone-200 transition-colors flex items-center gap-1.5 px-2 py-1 rounded bg-stone-800/60 hover:bg-stone-700/60 border border-stone-700/40"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                                </svg>
                                收起
                              </button>
                              </>
                            )}
                          </div>
                        );
                      })()}

                      {/* Encounter Plan Action Buttons - shown for encounter_plan messages */}
                      {msg.analyzed_entities?.type === 'encounter_plan' && msg.analyzed_entities?.plan_text && msg.analyzed_entities?.map_url && (
                        <div className="mt-3 pt-2 border-t border-stone-700/30">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Modify Plan Button */}
                            <button
                              onClick={() => {
                                setCurrentPlan({ text: msg.analyzed_entities!.plan_text!, mapUrl: msg.analyzed_entities!.map_url! });
                                setShowModifyInput(!showModifyInput);
                              }}
                              disabled={modifyingPlan}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-stone-800/60 hover:bg-stone-700/70 text-stone-300 hover:text-stone-100 border border-stone-600/50 rounded-lg transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                              </svg>
                              <span>修改规划</span>
                            </button>
                            {/* Execute Plan Button */}
                            <button
                              onClick={() => executeMapEncounter({ text: msg.analyzed_entities!.plan_text!, mapUrl: msg.analyzed_entities!.map_url! })}
                              disabled={executingEncounter}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-orange-900/60 hover:bg-orange-800/70 disabled:bg-stone-800 text-orange-200 hover:text-orange-100 disabled:text-stone-500 border border-orange-700/50 rounded-lg transition-colors"
                            >
                              {executingEncounter ? (
                                <>
                                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  <span>部署中...</span>
                                </>
                              ) : (
                                <>
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                  <span>执行规划</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Action bar: Notes + Copy + TTS | Delete */}
                      {!msg.isStreaming && msg.content && (
                        <div className="mt-2 pt-1.5 border-t border-stone-700/30">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-1 sm:gap-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                              {msg.role === 'assistant' && (
                                <>
                                  {savedNoteIdxs.has(idx) ? (
                                    <span className="flex items-center gap-1 text-green-500 text-[10px] px-1">
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                      已收入笔记
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => saveToNotes(msg.content, idx)}
                                      disabled={savingNoteIdx === idx}
                                      className={`p-1 rounded transition-colors flex items-center gap-1 ${
                                        savingNoteIdx === idx ? 'text-stone-500 cursor-wait' : 'text-stone-600 hover:text-green-400'
                                      }`}
                                      title="收入笔记"
                                    >
                                      {savingNoteIdx === idx ? (
                                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                      ) : (
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                                          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                                          <line x1="12" y1="6" x2="12" y2="14"/>
                                          <line x1="8" y1="10" x2="16" y2="10"/>
                                        </svg>
                                      )}
                                      <span className="hidden sm:inline text-[10px]">{savingNoteIdx === idx ? '保存中' : '笔记'}</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(msg.content);
                                      setCopiedMsgId(msg.id ?? null);
                                      setTimeout(() => setCopiedMsgId(null), 1500);
                                    }}
                                    className={`p-1 rounded transition-colors flex items-center gap-1 ${
                                      copiedMsgId === msg.id ? 'text-green-400' : 'text-stone-600 hover:text-amber-400'
                                    }`}
                                    title="复制"
                                  >
                                    {copiedMsgId === msg.id ? (
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    ) : (
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                      </svg>
                                    )}
                                    <span className="hidden sm:inline text-[10px]">{copiedMsgId === msg.id ? '已复制' : '复制'}</span>
                                  </button>
                                  <div className="relative" ref={ttsMenuMsgId === msg.id ? ttsMenuRef : undefined}>
                                    <button
                                      onClick={() => {
                                        if (ttsPlayingId === String(msg.id)) { stopPlayback(); return; }
                                        if (ttsLoading === String(msg.id)) return;
                                        setTtsMenuMsgId(ttsMenuMsgId === msg.id! ? null : msg.id!);
                                      }}
                                      disabled={ttsLoading === String(msg.id)}
                                      className={`p-1 rounded transition-colors flex items-center gap-1 ${
                                        ttsPlayingId === String(msg.id)
                                          ? 'text-amber-400'
                                          : ttsLoading === String(msg.id)
                                            ? 'text-gray-500 cursor-wait'
                                            : 'text-stone-600 hover:text-amber-400'
                                      }`}
                                      title={ttsPlayingId === String(msg.id) ? '停止朗读' : '朗读'}
                                    >
                                      {ttsLoading === String(msg.id) ? (
                                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                      ) : ttsPlayingId === String(msg.id) ? (
                                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                                      ) : (
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                                        </svg>
                                      )}
                                      <span className="hidden sm:inline text-[10px]">
                                        {ttsLoading === String(msg.id) ? '加载中' : ttsPlayingId === String(msg.id) ? '停止' : '朗读'}
                                      </span>
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
                                </>
                              )}
                            </div>
                            {msg.id && (
                              <button
                                onClick={() => deleteMessage(msg.id!, idx)}
                                className={`p-1 rounded transition-colors flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 ${
                                  pendingDeleteIdx === idx
                                    ? 'text-red-400 bg-red-950/50'
                                    : 'text-stone-600 hover:text-red-400'
                                }`}
                                title={pendingDeleteIdx === idx ? "再次点击确认删除" : "删除消息"}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                <span className="hidden sm:inline text-[10px]">{pendingDeleteIdx === idx ? '确认?' : '删除'}</span>
                              </button>
                            )}
                          </div>
                          {/* Collapse bar - full width at bottom */}
                          {msg.content.length > 300 && msg.id && (
                            <button
                              onClick={() => toggleCollapse(msg.id!)}
                              className="mt-1.5 w-full py-1 rounded bg-stone-800/50 hover:bg-stone-700/50 text-stone-500 hover:text-amber-400 transition-colors flex items-center justify-center gap-1 text-[10px]"
                              title={collapsedMessages.has(msg.id) ? "展开内容" : "折叠内容"}
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d={collapsedMessages.has(msg.id) ? "M19 9l-7 7-7-7" : "M5 15l7-7 7 7"} />
                              </svg>
                              {collapsedMessages.has(msg.id) ? '展开' : '收起'}
                            </button>
                          )}
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
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-400">✕</button>
          </p>
        </div>
      )}

      {/* Input Area */}
      <div className="relative px-2 py-1.5 border-t border-stone-800/50 bg-stone-950/80 flex-shrink-0">
        {/* Map Analysis Toggle & Preset Functions */}
        <div className="flex items-center gap-2 mb-1 flex-nowrap">
          <label className="flex items-center gap-2 cursor-pointer group flex-shrink-0">
            <input
              type="checkbox"
              checked={analyzeMap}
              onChange={(e) => setAnalyzeMap(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-stone-600 bg-stone-800 text-amber-600 focus:ring-amber-600/50 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-xs text-stone-500 group-hover:text-stone-400 transition-colors flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
              </svg>
              分析地图
            </span>
          </label>

          {/* Preset Functions Dropdown */}
          <div className="relative flex-shrink-0" ref={presetMenuRef}>
            <button
              onClick={() => setShowPresetMenu(!showPresetMenu)}
              disabled={extractingMapPoints || planningEncounter}
              className="flex items-center gap-1 px-2 py-1 text-xs text-stone-500 hover:text-amber-400 hover:bg-stone-800/50 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
              title="预设功能"
            >
              {(extractingMapPoints || planningEncounter) ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>{planningEncounter ? '规划中...' : '提取中...'}</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                  </svg>
                  <span>预设功能</span>
                  <svg className={`w-3 h-3 transition-transform ${showPresetMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </>
              )}
            </button>

            {/* Dropdown Menu */}
            {showPresetMenu && (
              <div className="absolute left-0 bottom-full mb-1 w-52 bg-stone-800 border border-stone-700/50 rounded-lg shadow-xl z-50">
                <button
                  onClick={() => {
                    if (!mapUrl) {
                      alert('请先在地图管理面板中点击"使用地图"按钮设置当前地图');
                      return;
                    }
                    extractMapPoints();
                  }}
                  disabled={extractingMapPoints}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-stone-300 hover:bg-stone-700/50 hover:text-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-left"
                >
                  <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  <div>
                    <div className="font-medium">获取地图要点</div>
                    <div className="text-[10px] text-stone-500">加载已保存的位置标记</div>
                  </div>
                </button>
                <div className="border-t border-stone-700/50" />
                {/* Source mode submenu trigger */}
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      console.log('[DEBUG] 规划地图遭遇 clicked, mapUrl:', mapUrl);
                      console.log('[DEBUG] showSourceModeMenu before:', showSourceModeMenu);
                      if (!mapUrl) {
                        setError('请先在"🗺️ 地图"标签页中点击某张地图的"使用地图"按钮');
                        setShowPresetMenu(false);
                        return;
                      }
                      const newValue = !showSourceModeMenu;
                      console.log('[DEBUG] Setting showSourceModeMenu to:', newValue);
                      setShowSourceModeMenu(newValue);
                      setShowDensityMenu(false);
                    }}
                    disabled={planningEncounter || !mapUrl}
                    title={!mapUrl ? '请先选择地图' : '选择来源和密度'}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs transition-colors text-left ${
                      !mapUrl
                        ? 'text-stone-500 cursor-not-allowed opacity-50'
                        : 'text-stone-300 hover:bg-stone-700/50 hover:text-orange-300'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                      </svg>
                      <div>
                        <div className="font-medium">规划地图遭遇</div>
                        <div className="text-[10px] text-stone-500">选择来源和密度</div>
                      </div>
                    </div>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  {/* Source mode submenu */}
                  {showSourceModeMenu && (
                    <div className="absolute left-0 bottom-full mb-1 w-full bg-stone-800 border border-stone-700/50 rounded-lg shadow-xl overflow-hidden z-50">
                      <div className="px-3 py-1.5 text-[10px] text-stone-500 border-b border-stone-700/50 font-medium">
                        遭遇来源
                      </div>
                      <button
                        onClick={() => {
                          setSelectedSourceMode('module_only');
                          setShowSourceModeMenu(false);
                          setShowDensityMenu(true);
                        }}
                        className={`w-full px-3 py-2 text-xs text-stone-300 hover:bg-stone-700/50 hover:text-blue-300 text-left ${selectedSourceMode === 'module_only' ? 'bg-stone-700/30' : ''}`}
                      >
                        <div className="font-medium">📖 仅模组</div>
                        <div className="text-[10px] text-stone-500">只用模组定义的遭遇</div>
                      </button>
                      <button
                        onClick={() => {
                          setSelectedSourceMode('module_extend');
                          setShowSourceModeMenu(false);
                          setShowDensityMenu(true);
                        }}
                        className={`w-full px-3 py-2 text-xs text-stone-300 hover:bg-stone-700/50 hover:text-purple-300 text-left ${selectedSourceMode === 'module_extend' ? 'bg-stone-700/30' : ''}`}
                      >
                        <div className="font-medium">📖✨ 模组+扩展</div>
                        <div className="text-[10px] text-stone-500">模组为主，AI补充扩展</div>
                      </button>
                      <button
                        onClick={() => {
                          setSelectedSourceMode('ai_free');
                          setShowSourceModeMenu(false);
                          setShowDensityMenu(true);
                        }}
                        className={`w-full px-3 py-2 text-xs text-stone-300 hover:bg-stone-700/50 hover:text-cyan-300 text-left ${selectedSourceMode === 'ai_free' ? 'bg-stone-700/30' : ''}`}
                      >
                        <div className="font-medium">🤖 AI自由创造</div>
                        <div className="text-[10px] text-stone-500">AI自由设计遭遇</div>
                      </button>
                    </div>
                  )}
                  {/* Density submenu - shows after source mode selection */}
                  {showDensityMenu && !showSourceModeMenu && (
                    <div className="absolute left-0 bottom-full mb-1 w-full bg-stone-800 border border-stone-700/50 rounded-lg shadow-xl overflow-hidden z-50">
                      <div className="px-3 py-1.5 text-[10px] text-stone-500 border-b border-stone-700/50 font-medium">
                        怪物密度 ({selectedSourceMode === 'module_only' ? '📖模组' : selectedSourceMode === 'ai_free' ? '🤖AI' : '📖+✨'})
                      </div>
                      <button
                        onClick={() => planMapEncounter('sparse', selectedSourceMode)}
                        className="w-full px-3 py-2 text-xs text-stone-300 hover:bg-stone-700/50 hover:text-green-300 text-left"
                      >
                        <div className="font-medium">🌿 稀疏</div>
                        <div className="text-[10px] text-stone-500">5-8只怪物</div>
                      </button>
                      <button
                        onClick={() => planMapEncounter('normal', selectedSourceMode)}
                        className="w-full px-3 py-2 text-xs text-stone-300 hover:bg-stone-700/50 hover:text-amber-300 text-left"
                      >
                        <div className="font-medium">⚔️ 正常</div>
                        <div className="text-[10px] text-stone-500">10-15只怪物</div>
                      </button>
                      <button
                        onClick={() => planMapEncounter('dense', selectedSourceMode)}
                        className="w-full px-3 py-2 text-xs text-stone-300 hover:bg-stone-700/50 hover:text-red-300 text-left"
                      >
                        <div className="font-medium">🔥 密集</div>
                        <div className="text-[10px] text-stone-500">15-25只怪物</div>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Chapter Context Selector */}
          <ChapterContextSelector
            chapters={moduleChapters}
            selectedTitles={selectedChapterTitles}
            onSelectionChange={setSelectedChapterTitles}
            disabled={isLoading}
          />

          {analyzeMap && (
            <span className="text-[10px] text-amber-600/70 bg-amber-950/30 px-1.5 py-0.5 rounded flex-shrink-0 whitespace-nowrap">
              +视觉分析
            </span>
          )}
        </div>

        {/* Modify Plan Input - shown when user clicks modify button */}
        {showModifyInput && currentPlan && (
          <div className="flex gap-2 items-end mb-2">
            <div className="flex-1 relative">
              <textarea
                value={modifyText}
                onChange={(e) => { setModifyText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px'; }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && modifyText.trim()) {
                    e.preventDefault();
                    modifyEncounterPlan();
                  }
                }}
                placeholder="输入修改要求，如：把入口的地精换成兽人，增加一个陷阱..."
                disabled={modifyingPlan}
                rows={1}
                className="w-full px-3 py-2 bg-stone-800/70 border border-stone-600/50 rounded-lg text-stone-200 text-sm resize-none overflow-hidden focus:outline-none focus:border-orange-700/50 disabled:opacity-50 placeholder:text-stone-500 transition-all"
                style={{ minHeight: '38px', maxHeight: '80px' }}
              />
            </div>
            <button
              onClick={modifyEncounterPlan}
              disabled={modifyingPlan || !modifyText.trim()}
              className="px-3 py-2 bg-stone-700 hover:bg-stone-600 disabled:bg-stone-800 text-stone-200 disabled:text-stone-500 rounded-lg text-sm transition-colors flex items-center gap-1.5"
            >
              {modifyingPlan ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>修改中</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  <span>应用</span>
                </>
              )}
            </button>
            <button
              onClick={() => { setShowModifyInput(false); setModifyText(''); }}
              className="px-2 py-2 text-stone-500 hover:text-stone-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <div className="flex gap-1.5 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'; }}
              onKeyDown={handleKeyDown}
              placeholder="询问模组内容..."
              disabled={isLoading}
              rows={1}
              className="w-full px-3 py-2 bg-stone-800/50 border border-stone-700/50 rounded-lg text-stone-200 text-sm resize-none overflow-hidden focus:outline-none focus:border-amber-700/50 focus:bg-stone-800/70 disabled:opacity-50 placeholder:text-stone-600 transition-all"
              style={{ minHeight: '36px', maxHeight: '100px' }}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-30">
              <svg className="w-4 h-4 text-amber-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34c-.37-.39-1.02-.39-1.41 0l-1.84 1.83 3.75 3.75M3 17.25V21h3.75L17.81 9.93l-3.75-3.75L3 17.25z"/>
              </svg>
            </div>
          </div>
          <button
            onClick={() => sendMessage()}
            disabled={isLoading || !inputValue.trim()}
            className="px-3 py-2 bg-gradient-to-r from-amber-700 to-orange-700 hover:from-amber-600 hover:to-orange-600 disabled:from-stone-700 disabled:to-stone-700 disabled:text-stone-500 text-amber-100 rounded-lg text-sm font-medium transition-all shadow-md shadow-amber-900/20 disabled:shadow-none flex items-center gap-1.5"
          >
            {isLoading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>思考中</span>
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
