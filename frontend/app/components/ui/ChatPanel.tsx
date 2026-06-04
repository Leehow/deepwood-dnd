import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { createLogger } from "~/utils/logger";
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import { apiFetch } from "~/utils/api-client";

import { useWebSocket, type WebSocketMessage } from "~/hooks/useWebSocket";
import { getApiEndpoint } from "~/config/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const remarkPluginsStable = [remarkGfm];

import type { Token } from "~/components/map/types/TacticalMapTypes";
import { DiceResultCard } from "./DiceResultCard";
import { SpellCastMessageCard } from "./SpellCastMessageCard";
import { DiceResultsGrouped } from "./DiceResultsGrouped";
import { DMAvatarIcon } from "./DMAvatarIcon";
import { DiceIcon } from "./DiceIcons";

// 3D 骰子动画组件（懒加载，仅客户端）
const DiceBox3D = lazy(() => import("~/components/dice/DiceBox3D.client"));
import {
  showDiceRequestBubble,
  onDiceRequestRespond,
  onDiceRequestDismiss,
} from "~/utils/diceRequestBubble";

// Import custom hooks
import { useChatMessages } from "./hooks/useChatMessages";
import { useChatAI } from "./hooks/useChatAI";
import { useChatSearch } from "./hooks/useChatSearch";
import { useChatUI } from "./hooks/useChatUI";
import { chatService } from '~/services';
import { useOnlineStore } from "~/stores/onlineStore";
import { useVoiceStore } from "~/stores/voiceStore";
import { useModalContextStore } from "~/stores/modalContextStore";
import { useTTS } from "~/hooks/useTTS";
import type { Message } from "./hooks/useChatMessages";
import { transformBackendMessage } from "./hooks/useChatMessages";
import { AIAssistantView } from "./AIAssistantView";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { useSlashCommands } from "~/hooks/useSlashCommands";
import { ReactionButtons } from "~/components/combat/ReactionButtons";
import { getAvailableReactions, type ReactionDefinition } from "~/utils/reactionRegistry";
import { useChatMessageBroadcastStore } from "~/stores/chatMessageBroadcastStore";
import { formatCombatDisplay } from "~/utils/combatTextUtils";
import { useFloatingFilterPanelStore } from "~/stores/floatingFilterPanelStore";
import { fetchCharacterCached } from "~/utils/characterCache";
import { fetchCampaignMembersCached } from "~/utils/campaignMembersCache";
import { fetchCampaignMapTokensCached } from "~/utils/mapTokensCache";
import { fetchCampaignAiSessionsCached, fetchCampaignChatMessagesCached } from "~/queries/chatQueries";
import { getChatFilterParams, matchesChatFilter } from "./chatFilterUtils";

const logger = createLogger("ChatPanel");

type ChatMode = 'chatroom' | 'ai-assistant';

interface ChatPanelProps {
  isDM: boolean;
  campaignId: string;
  userId: string;
  currentMapUrl?: string | null;
  activeSubTab?: string;
  onSubTabChange?: (tab: string) => void;
  selectedModule?: string | null;
  enable3DDice?: boolean;
  chatMode?: ChatMode;
  onChatModeChange?: (mode: ChatMode) => void;
}

import { XPRewardModal } from "~/components/character/XPRewardModal";
import { CurrencyRewardModal } from "~/components/character/CurrencyRewardModal";
import { showCharacterBubble, onReplyToMessage, onStartPrivateMessage } from "~/utils/characterBubble";
import { CheckTypeSelectModal, getCheckTypeLabel, getSkillName, getAbilityName } from "./CheckTypeSelectModal";
import { mergeRollModifiers, resolveCheckRollModifierFromStatusEffects, type RollModifier } from "./diceRollResolution";
import { VoiceInput } from "./VoiceInput";

const CLASS_SAVE_PROFICIENCIES: Record<string, string[]> = {
  barbarian: ["strength", "constitution"],
  bard: ["dexterity", "charisma"],
  cleric: ["wisdom", "charisma"],
  druid: ["intelligence", "wisdom"],
  fighter: ["strength", "constitution"],
  monk: ["strength", "dexterity"],
  paladin: ["wisdom", "charisma"],
  ranger: ["strength", "dexterity"],
  rogue: ["dexterity", "intelligence"],
  sorcerer: ["constitution", "charisma"],
  warlock: ["wisdom", "charisma"],
  wizard: ["intelligence", "wisdom"],
};

type DiceCheckInfo = {
  modifier?: number;
  dc?: number;
  label?: string;
  rollMode?: RollModifier;
};

type DiceActorSnapshot =
  | {
      type: "player";
      status_effects?: unknown;
      active_effects?: unknown;
      ability_scores?: Record<string, number>;
      selected_skills?: string[];
      expertise_skills?: string[];
      level?: number;
      class_id?: string | null;
    }
  | {
      type: "monster";
      status_effects?: unknown;
      active_effects?: unknown;
      ability_scores?: Record<string, number>;
      monster_data?: Record<string, unknown> | null;
    };

function getAbilityModifier(score: number | null | undefined) {
  const safeScore = typeof score === "number" ? score : 10;
  return Math.floor((safeScore - 10) / 2);
}

function getProficiencyBonus(level: number | null | undefined) {
  const safeLevel = typeof level === "number" ? level : 1;
  if (safeLevel >= 17) return 6;
  if (safeLevel >= 13) return 5;
  if (safeLevel >= 9) return 4;
  if (safeLevel >= 5) return 3;
  return 2;
}

function computePreviewModifier(snapshot: DiceActorSnapshot | null, check: any): number | undefined {
  if (!snapshot || !check?.ability) return undefined;

  if (snapshot.type === "monster") {
    const abilityScores = snapshot.ability_scores || {};
    const monsterData = snapshot.monster_data || {};

    if (check.type === "save") {
      const savingThrows = (monsterData.saving_throws || {}) as Record<string, unknown>;
      const saveBonus = savingThrows[check.ability];
      if (typeof saveBonus === "number") return saveBonus;
      return getAbilityModifier(abilityScores[check.ability]);
    }

    if (check.skill) {
      const skills = (monsterData.skills || {}) as Record<string, unknown>;
      const skillBonus = skills[check.skill];
      if (typeof skillBonus === "number") return skillBonus;
    }

    return getAbilityModifier(abilityScores[check.ability]);
  }

  const abilityScores = snapshot.ability_scores || {};
  const abilityModifier = getAbilityModifier(abilityScores[check.ability]);

  if (check.type === "save") {
    const proficiencies = CLASS_SAVE_PROFICIENCIES[String(snapshot.class_id || "").toLowerCase()] || [];
    return abilityModifier + (proficiencies.includes(check.ability) ? getProficiencyBonus(snapshot.level) : 0);
  }

  if (check.skill) {
    const isExpertise = (snapshot.expertise_skills || []).includes(check.skill);
    const isProficient = isExpertise || (snapshot.selected_skills || []).includes(check.skill);
    return abilityModifier + (isProficient ? (isExpertise ? getProficiencyBonus(snapshot.level) * 2 : getProficiencyBonus(snapshot.level)) : 0);
  }

  return abilityModifier;
}

export function ChatPanel({ isDM, campaignId, userId, currentMapUrl, activeSubTab, onSubTabChange, selectedModule, enable3DDice = true, chatMode: chatModeProp, onChatModeChange }: ChatPanelProps) {
  // Track if chat is scrolled to bottom
  const isAtBottomRef = useRef(true);

  // Use custom hooks
  const messagesHook = useChatMessages(campaignId, userId, isDM ? 'dm' : 'player', isAtBottomRef);
  const aiHook = useChatAI(campaignId);
  const searchHook = useChatSearch(campaignId, userId, isDM ? 'dm' : 'player');
  const uiHook = useChatUI();

  // Sidebar filter state (replaces top tab bar + filter dropdown)
  const [sidebarFilter, setSidebarFilter] = useState<string>('all');
  const isDiceMode = sidebarFilter === 'dice';
  // Any non-'all' non-'dice' filter uses backend-loaded messages
  const isFilteredMode = sidebarFilter !== 'all' && sidebarFilter !== 'dice';

  // Chat mode: chatroom vs AI assistant (controlled or uncontrolled)
  const [chatModeInternal, setChatModeInternal] = useState<ChatMode>('chatroom');
  const chatMode = chatModeProp ?? chatModeInternal;
  const setChatMode = useCallback((mode: ChatMode) => {
    if (onChatModeChange) onChatModeChange(mode);
    else setChatModeInternal(mode);
  }, [onChatModeChange]);

  // AI assistant independent state
  const [aiAssistantMessages, setAiAssistantMessages] = useState<Message[]>([]);
  const [aiAssistantLoading, setAiAssistantLoading] = useState(false);
  const [aiAssistantHasMore, setAiAssistantHasMore] = useState(true);

  // AI session management
  const [aiSessions, setAiSessions] = useState<import('~/services/chat.service').AiSession[]>([]);
  const [currentAiSessionId, setCurrentAiSessionId] = useState<number | null>(null);

  // Filtered messages: backend-loaded messages for any active filter (separate from main messages)
  const [filteredMessages, setFilteredMessages] = useState<Message[]>([]);
  const [filteredLoading, setFilteredLoading] = useState(false);
  const [filteredHasMore, setFilteredHasMore] = useState(true);
  const pendingScrollToBottomRef = useRef(false);

  /**
   * Map sidebar filter to backend query params.
   * Returns null for 'all' and 'dice' (handled differently).
   */
  const getFilterParams = useCallback(
    (filter: string) => getChatFilterParams(filter),
    [],
  );

  /**
   * Check if a WebSocket message matches the current sidebar filter.
   */
  const matchesFilter = useCallback(
    (msg: Message, filter: string): boolean => matchesChatFilter(msg, filter, userId),
    [userId],
  );

  const loadFilteredMessages = useCallback(async (reset = false) => {
    if (filteredLoading || (!reset && !filteredHasMore)) return;
    const params = getFilterParams(sidebarFilter);
    if (!params) return;
    setFilteredLoading(true);
    try {
      const oldestDbId = reset ? undefined : filteredMessages
        .map(m => m.dbId)
        .filter((id): id is number => typeof id === 'number')
        .reduce((min, id) => (min === null ? id : Math.min(min, id)), null as number | null) ?? undefined;
      const response = await fetchCampaignChatMessagesCached(
        campaignId,
        { beforeId: oldestDbId, limit: 50, ...params },
      );
      if (response.messages && response.messages.length > 0) {
        const msgs: Message[] = response.messages.map(transformBackendMessage);
        if (reset) {
          setFilteredMessages(msgs.reverse());
          // Flag to scroll to bottom after React renders the new messages
          pendingScrollToBottomRef.current = true;
        } else {
          setFilteredMessages(prev => {
            const existingIds = new Set(prev.map(m => m.dbId).filter((id): id is number => typeof id === 'number'));
            const deduped = msgs.filter(m => !m.dbId || !existingIds.has(m.dbId));
            return [...deduped.reverse(), ...prev];
          });
        }
        setFilteredHasMore(response.messages.length === 50);
      } else {
        setFilteredHasMore(false);
      }
    } catch (e) {
      messagesHook.showToast('加载筛选消息失败');
    } finally {
      setFilteredLoading(false);
    }
  }, [campaignId, userId, isDM, filteredLoading, filteredHasMore, filteredMessages, sidebarFilter, getFilterParams, messagesHook]);

  // Load filtered messages when entering any filter mode
  useEffect(() => {
    if (isFilteredMode) {
      setFilteredMessages([]);
      setFilteredHasMore(true);
      loadFilteredMessages(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarFilter]);

  // Add new messages from WebSocket in real-time when in filter mode
  useEffect(() => {
    if (!isFilteredMode) return;
    const allMsgs = messagesHook.messages;
    if (allMsgs.length === 0) return;
    const lastMsg = allMsgs[allMsgs.length - 1];
    if (!matchesFilter(lastMsg, sidebarFilter)) return;
    setFilteredMessages(prev => {
      if (lastMsg.dbId && prev.some(m => m.dbId === lastMsg.dbId)) return prev;
      if (prev.some(m => m.id === lastMsg.id)) return prev;
      return [...prev, lastMsg];
    });
  }, [isFilteredMode, sidebarFilter, messagesHook.messages, matchesFilter]);

  // Broadcast latest message to floating filter panels
  const broadcast = useChatMessageBroadcastStore(s => s.broadcast);
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    const msgs = messagesHook.messages;
    if (msgs.length > prevMsgCountRef.current && msgs.length > 0) {
      broadcast(msgs[msgs.length - 1]);
    }
    prevMsgCountRef.current = msgs.length;
  }, [messagesHook.messages, broadcast]);

  // Floating filter panel store
  const openFilterPanel = useFloatingFilterPanelStore(s => s.openPanel);

  // Scroll to bottom after filtered messages render (triggered by reset load)
  useEffect(() => {
    if (pendingScrollToBottomRef.current && filteredMessages.length > 0) {
      pendingScrollToBottomRef.current = false;
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current!.scrollHeight, behavior: 'instant' });
      });
    }
  }, [filteredMessages]);

  // --- AI Assistant: load messages ---
  const loadAiAssistantMessages = useCallback(async (reset = false) => {
    if (!currentAiSessionId) return; // Must have a session
    if (aiAssistantLoading || (!reset && !aiAssistantHasMore)) return;
    setAiAssistantLoading(true);
    try {
      const oldestDbId = reset ? undefined : aiAssistantMessages
        .map(m => m.dbId)
        .filter((id): id is number => typeof id === 'number')
        .reduce((min, id) => (min === null ? id : Math.min(min, id)), null as number | null) ?? undefined;
      const response = await fetchCampaignChatMessagesCached(
        campaignId,
        { beforeId: oldestDbId, limit: 50, aiSessionId: currentAiSessionId! },
      );
      if (response.messages && response.messages.length > 0) {
        const msgs: Message[] = response.messages.map(transformBackendMessage);
        if (reset) {
          setAiAssistantMessages(msgs.reverse());
        } else {
          setAiAssistantMessages(prev => {
            const existingIds = new Set(prev.map(m => m.dbId).filter((id): id is number => typeof id === 'number'));
            const deduped = msgs.filter(m => !m.dbId || !existingIds.has(m.dbId));
            return [...deduped.reverse(), ...prev];
          });
        }
        setAiAssistantHasMore(response.messages.length === 50);
      } else {
        setAiAssistantHasMore(false);
      }
    } catch {
      messagesHook.showToast('加载AI消息失败');
    } finally {
      setAiAssistantLoading(false);
    }
  }, [campaignId, userId, isDM, aiAssistantLoading, aiAssistantHasMore, aiAssistantMessages, messagesHook, currentAiSessionId]);

  // Load AI messages when switching to ai-assistant tab
  useEffect(() => {
    if (chatMode === 'ai-assistant') {
      setAiAssistantMessages([]);
      setAiAssistantHasMore(true);
      setTtsMenuMsgId(null);
      // Load sessions list, auto-create if empty
      fetchCampaignAiSessionsCached(campaignId).then(async (sessions) => {
        if (sessions.length === 0) {
          const newSession = await chatService.createAiSession(campaignId, userId);
          setAiSessions([newSession]);
          setCurrentAiSessionId(newSession.id);
        } else {
          setAiSessions(sessions);
          if (!currentAiSessionId || !sessions.some(s => s.id === currentAiSessionId)) {
            setCurrentAiSessionId(sessions[0].id);
          }
        }
      }).catch(() => {});
    } else {
      setTtsMenuMsgId(null);
      // Switching back to chatroom: scroll to bottom
      requestAnimationFrame(() => {
        messagesHook.scrollToBottom();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMode]);

  // Reload AI messages when switching session
  useEffect(() => {
    if (chatMode !== 'ai-assistant') return;
    setAiAssistantMessages([]);
    setAiAssistantHasMore(true);
    loadAiAssistantMessages(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAiSessionId]);

  // Append new AI messages from WebSocket in real-time
  useEffect(() => {
    if (chatMode !== 'ai-assistant') return;
    const allMsgs = messagesHook.messages;
    if (allMsgs.length === 0) return;
    const lastMsg = allMsgs[allMsgs.length - 1];
    // Check if it's an AI conversation message
    const isAiMsg = lastMsg.senderRole === 'ai' || lastMsg.user === 'AI' ||
      (lastMsg.senderUserId === userId && !!lastMsg.recipients?.includes('ai'));
    if (!isAiMsg) return;
    setAiAssistantMessages(prev => {
      if (lastMsg.dbId && prev.some(m => m.dbId === lastMsg.dbId)) return prev;
      if (prev.some(m => m.id === lastMsg.id)) return prev;
      return [...prev, lastMsg];
    });
  }, [chatMode, messagesHook.messages, userId]);

  const slashCmd = useSlashCommands({ input: uiHook.input });
  const { setOnline, setOffline } = useOnlineStore();
  const { modalDescription: activeModalDescription } = useModalContextStore();

  // TTS - sendMessage ref allows useTTS to be called before useWebSocket
  const sendMessageRef = useRef<((msg: { type: string; data: Record<string, unknown> }) => void) | null>(null);
  const stableSendMessage = useCallback((msg: { type: string; data: Record<string, unknown> }) => sendMessageRef.current?.(msg), []);
  const { handleTTS, handleTTSRegenerate, handleTTSBroadcast, ttsPlayingId, ttsLoading, stopPlayback, handleTTSWebSocketMessage, clearTtsCache } = useTTS(campaignId, stableSendMessage);

  // TTS dropdown menu state
  const [ttsMenuMsgId, setTtsMenuMsgId] = useState<string | null>(null);
  const [ttsMenuPos, setTtsMenuPos] = useState<{ top: number; right: number } | null>(null);
  const ttsMenuRef = useRef<HTMLDivElement | null>(null);
  const ttsButtonRef = useRef<HTMLButtonElement | null>(null);
  const voiceIsConnected = useVoiceStore(s => s.isConnected);

  // Close TTS menu on outside click
  useEffect(() => {
    if (!ttsMenuMsgId) return;
    const handler = (e: MouseEvent) => {
      if (ttsMenuRef.current && !ttsMenuRef.current.contains(e.target as Node)) {
        setTtsMenuMsgId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ttsMenuMsgId]);

  // Image lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Narrative generation loading state
  const [narrativeLoadingIds, setNarrativeLoadingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!lightboxSrc) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxSrc(null); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxSrc]);

  const markdownComponents = useMemo(() => ({
    img: ({ src, alt, title, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
      <img
        src={src}
        alt={alt || ''}
        {...props}
        className="max-w-full rounded cursor-pointer hover:opacity-80 transition-opacity"
        onClick={(e) => { e.stopPropagation(); setLightboxSrc(title || src || ''); }}
      />
    ),
  }), []);

  // Sync external activeSubTab with sidebar filter
  useEffect(() => {
    if (activeSubTab === 'dice' && sidebarFilter !== 'dice') {
      setSidebarFilter('dice');
    } else if (activeSubTab === 'chat' && sidebarFilter === 'dice') {
      setSidebarFilter('all');
    }
  }, [activeSubTab]);

  // Sync sidebar filter changes back to parent + uiHook
  useEffect(() => {
    uiHook.setActiveTab(isDiceMode ? 'dice' : 'chat');
    onSubTabChange?.(isDiceMode ? 'dice' : 'chat');
  }, [isDiceMode]);

  // 监听回复消息事件（从气泡点击触发）
  useEffect(() => {
    const unsubscribe = onReplyToMessage((payload) => {
      // 切换到聊天模式
      if (sidebarFilter === 'dice') setSidebarFilter('all');
      // 设置回复目标
      uiHook.setReplyingTo({
        messageId: payload.messageId,
        senderUserId: payload.senderUserId,
        senderName: payload.senderName,
        content: payload.content,
      });
    });
    return unsubscribe;
  }, [sidebarFilter, uiHook]);

  // 监听私信事件（从左下角头像点击触发）
  useEffect(() => {
    const unsubscribe = onStartPrivateMessage((payload) => {
      if (sidebarFilter === 'dice') setSidebarFilter('all');
      uiHook.setSelectedRecipients([payload.targetUserId]);
    });
    return unsubscribe;
  }, [sidebarFilter, uiHook]);

  const listRef = useRef<HTMLDivElement>(null);

  const [members, setMembers] = useState<Array<{ user_id: string; role: string; character_name?: string; selected_character_id?: number; avatar?: string; character_level?: number; ability_scores?: Record<string, number>; selected_skills?: string[]; expertise_skills?: string[]; is_virtual?: boolean }>>([]);
  // Check if current filter is a virtual character (no private chat allowed)
  const isVirtualCharacterFilter = sidebarFilter.startsWith('user-') && members.some(m => m.user_id === sidebarFilter.slice(5) && m.is_virtual);

  // Voice input mode
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [chatBoxHeight, setChatBoxHeight] = useState<number | null>(null);
  const chatResizeRef = useRef<{ startY: number; startH: number } | null>(null);

  // Map tokens for DM actor selection
  const [mapTokens, setMapTokens] = useState<Token[]>([]);

  // DM grant dropdown state
  const [showGrantMenu, setShowGrantMenu] = useState(false);
  const [restProcessingMsgId, setRestProcessingMsgId] = useState<string | null>(null);
  const [rewardClaimingMsgId, setRewardClaimingMsgId] = useState<string | null>(null);
  const [extraEffectLoadingMsgId, setExtraEffectLoadingMsgId] = useState<string | null>(null);
  const [showXPModal, setShowXPModal] = useState(false);
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);
  const grantMenuRef = useRef<HTMLDivElement>(null);

  // Quick dice roll state - track which dice is currently rolling for animation
  const [rollingDice, setRollingDice] = useState<string | null>(null);

  // 3D dice animation state
  const [dice3DVisible, setDice3DVisible] = useState(false);
  const [dice3DNotation, setDice3DNotation] = useState('1d20');
  const [dice3DCheckInfo, setDice3DCheckInfo] = useState<DiceCheckInfo | null>(null);

  // Pending dice roll — 3D骰子开启时，等物理结果再发送
  const pendingDiceRollRef = useRef<{ payloads: WebSocketMessage[] } | null>(null);
  // Pending /roll command — 3D骰子完成后用物理结果构建消息
  const pendingSlashRollRef = useRef<{ buildMessage: (rolls: number[], total: number) => string } | null>(null);

  // Player reaction state for combat chat messages
  const [chatReactions, setChatReactions] = useState<ReactionDefinition[]>([]);
  const [chatReactionUsed, setChatReactionUsed] = useState(false);
  const [chatMyTokenId, setChatMyTokenId] = useState<number | null>(null);

  // Compute player's available reactions from their character data
  useEffect(() => {
    if (isDM || !userId) return;
    const myToken = mapTokens.find(t => t.user_id === userId && t.character_id);
    if (!myToken?.character_id) { setChatMyTokenId(null); return; }
    setChatMyTokenId(myToken.id);
    // Fetch character sheet to get class/feats/spells
    (async () => {
      try {
        const resp = await fetch(getApiEndpoint(`/api/characters/${myToken.character_id}/sheet`));
        if (resp.ok) {
          const data = await resp.json();
          const char = data.character || {};
          setChatReactions(getAvailableReactions({
            class_id: char.class_id || '', subclass_id: char.subclass_id,
            level: char.level || 1, feats: char.feats,
            prepared_spells: char.prepared_spells,
            selected_spells: char.selected_spells,
            selected_cantrips: char.selected_cantrips,
          }));
        }
      } catch { /* ignore */ }
    })();
  }, [isDM, userId, mapTokens]);

  // Listen for reaction used events
  useEffect(() => {
    const handler = (detail: { type?: string }) => {
      if (detail?.type === 'reaction') setChatReactionUsed(true);
    };
    return subscribeAppEvent("combatActionUsed", handler);
  }, []);

  // Reset reaction used on new round (listen for combat storage updates)
  useEffect(() => {
    const handler = () => setChatReactionUsed(false);
    return subscribeAppEvent("combatNewRound", handler);
  }, []);

  // Filter dropdown state (checkbox-based exclude filter)
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [isInputCollapsed, setIsInputCollapsed] = useState(false);
  const [hiddenTypes, setHiddenTypes] = useState<string[]>([]);
  const [hiddenUsers, setHiddenUsers] = useState<string[]>([]);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const toggleHiddenType = (type: string) => {
    setHiddenTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  };
  const toggleHiddenUser = (uid: string) => {
    setHiddenUsers(prev => prev.includes(uid) ? prev.filter(u => u !== uid) : [...prev, uid]);
  };

  // Close grant menu when clicking outside
  useEffect(() => {
    if (!showGrantMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (grantMenuRef.current && !grantMenuRef.current.contains(e.target as Node)) {
        setShowGrantMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showGrantMenu]);



  // Close filter menu when clicking outside
  useEffect(() => {
    if (!showFilterMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setShowFilterMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilterMenu]);

  // Dice rolls state - 存储所有骰子结果用于"骰子结果"tab
  const [diceRolls, setDiceRolls] = useState<Array<{
    id: string;
    user: string;
    senderUserId?: string;
    senderRole?: string;
    timestamp: Date;
    roll: any;
  }>>([]);

  // Track which message is loading narrative
  const [narrativeLoadingId, setNarrativeLoadingId] = useState<string | number | null>(null);

  // Ref for dice results tab auto-scroll
  const diceResultsEndRef = useRef<HTMLDivElement>(null);
  const prevFilterRef = useRef<string>(sidebarFilter);
  const initialChatAutoScrollDoneRef = useRef(false);

  // Track if chat is scrolled to bottom (for showing "scroll to bottom" button)
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Scroll to bottom when switching filters (so user sees latest messages, not triggering endless history loads)
  useEffect(() => {
    if (prevFilterRef.current !== sidebarFilter) {
      // Delay scroll to after filtered/main messages render
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'auto' });
      });
    }
    prevFilterRef.current = sidebarFilter;
  }, [sidebarFilter]);

  useEffect(() => {
    initialChatAutoScrollDoneRef.current = false;
  }, [campaignId]);

  useEffect(() => {
    if (initialChatAutoScrollDoneRef.current) return;
    if (isDiceMode || !messagesHook.isReady) return;

    initialChatAutoScrollDoneRef.current = true;
    requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      list.scrollTo({ top: list.scrollHeight, behavior: 'auto' });
      requestAnimationFrame(() => {
        list.scrollTo({ top: list.scrollHeight, behavior: 'auto' });
      });
    });
    setIsAtBottom(true);
    isAtBottomRef.current = true;
  }, [isDiceMode, messagesHook.isReady]);

  // Listen for combat turn notification events → insert system message into chat
  useEffect(() => {
    const handler = ({ name, round }: { name: string; round: number }) => {
      messagesHook.addMessage({
        id: `turn-${Date.now()}`,
        user: "系统",
        senderUserId: "system",
        senderRole: "system",
        content: `⚔️ 第${round}轮 — 轮到 **${name}**`,
        timestamp: new Date(),
        type: "system",
      } as any);
    };
    return subscribeAppEvent("combatTurnNotification", handler);
  }, [messagesHook]);

  // Auto-scroll to latest dice result when switching to dice mode or new result arrives
  useEffect(() => {
    if (isDiceMode && diceResultsEndRef.current) {
      diceResultsEndRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, [isDiceMode, diceRolls]);

  // Play notification sound for new messages
  const playMessageSound = (isPrivate: boolean = false) => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      if (isPrivate) {
        // Private message: two-tone notification (more attention-grabbing)
        const oscillator1 = audioContext.createOscillator();
        const oscillator2 = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator1.connect(gainNode);
        oscillator2.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // First tone: 900Hz
        oscillator1.frequency.value = 900;
        oscillator1.type = 'sine';

        // Second tone: 1200Hz (higher pitch)
        oscillator2.frequency.value = 1200;
        oscillator2.type = 'sine';

        gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);

        oscillator1.start(audioContext.currentTime);
        oscillator1.stop(audioContext.currentTime + 0.08);

        oscillator2.start(audioContext.currentTime + 0.08);
        oscillator2.stop(audioContext.currentTime + 0.15);
      } else {
        // Regular message: simple beep
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
      }
    } catch (e) {
      logger.error('Failed to play sound:', e);
    }
  };

  // Play dice request notification sound - distinctive three-tone alert
  const playDiceRequestSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const currentTime = audioContext.currentTime;

      // Three ascending tones like a fanfare
      const frequencies = [523, 659, 784]; // C5, E5, G5 - major chord arpeggio
      const duration = 0.12;

      frequencies.forEach((freq, i) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = freq;
        oscillator.type = 'triangle'; // Softer, more pleasant tone

        const startTime = currentTime + i * duration;
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.5, startTime + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
      });
    } catch (e) {
      logger.error('Failed to play dice request sound:', e);
    }
  };

  // Play dice roll sound effect - simulates dice tumbling with result feedback
  const playDiceSound = (options: {
    critical?: boolean;
    fumble?: boolean;
    success?: boolean;
  } = {}) => {
    const { critical = false, fumble = false, success } = options;
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const currentTime = audioContext.currentTime;

      // Create multiple short clicks to simulate dice tumbling
      const clickCount = 4;
      for (let i = 0; i < clickCount; i++) {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);

        // Vary frequency slightly for each click (wooden dice sound)
        osc.frequency.value = 200 + Math.random() * 100;
        osc.type = 'square';

        const clickTime = currentTime + i * 0.06;
        gain.gain.setValueAtTime(0.15, clickTime);
        gain.gain.exponentialRampToValueAtTime(0.01, clickTime + 0.03);

        osc.start(clickTime);
        osc.stop(clickTime + 0.03);
      }

      // Final result sound
      const finalTime = currentTime + clickCount * 0.06 + 0.05;

      if (critical) {
        // Critical success (natural 20): triumphant ascending fanfare
        const freqs = [523, 659, 784]; // C5, E5, G5 (major chord arpeggio)
        freqs.forEach((freq, i) => {
          const osc = audioContext.createOscillator();
          const gain = audioContext.createGain();
          osc.connect(gain);
          gain.connect(audioContext.destination);
          osc.frequency.value = freq;
          osc.type = 'sine';
          const t = finalTime + i * 0.08;
          gain.gain.setValueAtTime(0.35, t);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
          osc.start(t);
          osc.stop(t + 0.18);
        });
      } else if (fumble) {
        // Critical failure (natural 1): descending sad tones
        const freqs = [392, 311, 261]; // G4, Eb4, C4 (minor feel, descending)
        freqs.forEach((freq, i) => {
          const osc = audioContext.createOscillator();
          const gain = audioContext.createGain();
          osc.connect(gain);
          gain.connect(audioContext.destination);
          osc.frequency.value = freq;
          osc.type = 'sine';
          const t = finalTime + i * 0.1;
          gain.gain.setValueAtTime(0.28, t);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.22);
          osc.start(t);
          osc.stop(t + 0.22);
        });
      } else if (success === true) {
        // Normal success: positive two-tone confirmation
        const successFreqs = [440, 554]; // A4, C#5 (major third - positive)
        successFreqs.forEach((freq, i) => {
          const osc = audioContext.createOscillator();
          const gain = audioContext.createGain();
          osc.connect(gain);
          gain.connect(audioContext.destination);
          osc.frequency.value = freq;
          osc.type = 'sine';
          const t = finalTime + i * 0.08;
          gain.gain.setValueAtTime(0.25, t);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
          osc.start(t);
          osc.stop(t + 0.12);
        });
      } else if (success === false) {
        // Normal failure: negative two-tone (descending)
        const failFreqs = [392, 330]; // G4, E4 (descending - negative)
        failFreqs.forEach((freq, i) => {
          const osc = audioContext.createOscillator();
          const gain = audioContext.createGain();
          osc.connect(gain);
          gain.connect(audioContext.destination);
          osc.frequency.value = freq;
          osc.type = 'sine';
          const t = finalTime + i * 0.1;
          gain.gain.setValueAtTime(0.22, t);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.14);
          osc.start(t);
          osc.stop(t + 0.14);
        });
      } else {
        // Neutral result (no DC check): simple confirmation tone
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.value = 440; // A4
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.25, finalTime);
        gain.gain.exponentialRampToValueAtTime(0.01, finalTime + 0.12);
        osc.start(finalTime);
        osc.stop(finalTime + 0.12);
      }
    } catch (e) {
      logger.error('Failed to play dice sound:', e);
    }
  };

  // Play combat sound effect with attack type differentiation
  type AttackType = 'melee' | 'ranged';
  const playCombatSound = (options: {
    attackType?: AttackType;
    hit?: boolean;
    critical?: boolean;
    fumble?: boolean;
  } = {}) => {
    const { attackType = 'melee', hit = false, critical = false, fumble = false } = options;
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const currentTime = audioContext.currentTime;

      // Step 1: Attack sound based on attack type
      if (attackType === 'ranged') {
        // Ranged attack: arrow/projectile whoosh sound
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const filter = audioContext.createBiquadFilter();

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(audioContext.destination);

        // High-frequency descending sweep (arrow flying)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2000, currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, currentTime + 0.15);

        filter.type = 'lowpass';
        filter.frequency.value = 3000;

        gain.gain.setValueAtTime(0.25, currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, currentTime + 0.15);

        osc.start(currentTime);
        osc.stop(currentTime + 0.15);
      } else {
        // Melee attack: sword clash / metallic noise
        const noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 0.1, audioContext.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseData.length; i++) {
          noiseData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioContext.sampleRate * 0.02));
        }
        const noiseSource = audioContext.createBufferSource();
        noiseSource.buffer = noiseBuffer;

        const filter = audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 3000;
        filter.Q.value = 2;

        const noiseGain = audioContext.createGain();
        noiseSource.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(audioContext.destination);
        noiseGain.gain.setValueAtTime(0.4, currentTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, currentTime + 0.1);
        noiseSource.start(currentTime);
      }

      // Step 2: Result indicator sound
      const resultTime = currentTime + 0.18;

      if (critical) {
        // Critical hit: powerful impact + triumphant fanfare
        const impactFreqs = [150, 100, 75];
        impactFreqs.forEach((freq, i) => {
          const osc = audioContext.createOscillator();
          const gain = audioContext.createGain();
          osc.connect(gain);
          gain.connect(audioContext.destination);
          osc.frequency.value = freq;
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.4 - i * 0.1, resultTime);
          gain.gain.exponentialRampToValueAtTime(0.01, resultTime + 0.15);
          osc.start(resultTime);
          osc.stop(resultTime + 0.15);
        });
        // Triumphant ascending chord
        const chordFreqs = [523, 659, 784]; // C major
        chordFreqs.forEach((freq, i) => {
          const osc = audioContext.createOscillator();
          const gain = audioContext.createGain();
          osc.connect(gain);
          gain.connect(audioContext.destination);
          osc.frequency.value = freq;
          osc.type = 'sine';
          const t = resultTime + 0.12 + i * 0.06;
          gain.gain.setValueAtTime(0.3, t);
          gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
          osc.start(t);
          osc.stop(t + 0.2);
        });
      } else if (fumble) {
        // Fumble (critical miss): comical descending slide
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.setValueAtTime(500, resultTime);
        osc.frequency.exponentialRampToValueAtTime(80, resultTime + 0.4);
        osc.type = 'sawtooth';
        gain.gain.setValueAtTime(0.25, resultTime);
        gain.gain.exponentialRampToValueAtTime(0.01, resultTime + 0.4);
        osc.start(resultTime);
        osc.stop(resultTime + 0.4);
      } else if (!hit) {
        // Miss (not critical): whoosh + low disappointed tone
        // Whoosh sound (swing and miss)
        const whooshOsc = audioContext.createOscillator();
        const whooshGain = audioContext.createGain();
        whooshOsc.connect(whooshGain);
        whooshGain.connect(audioContext.destination);
        whooshOsc.type = 'sine';
        whooshOsc.frequency.setValueAtTime(600, resultTime);
        whooshOsc.frequency.exponentialRampToValueAtTime(200, resultTime + 0.12);
        whooshGain.gain.setValueAtTime(0.15, resultTime);
        whooshGain.gain.exponentialRampToValueAtTime(0.01, resultTime + 0.12);
        whooshOsc.start(resultTime);
        whooshOsc.stop(resultTime + 0.12);

        // Low disappointed tone
        const lowOsc = audioContext.createOscillator();
        const lowGain = audioContext.createGain();
        lowOsc.connect(lowGain);
        lowGain.connect(audioContext.destination);
        lowOsc.frequency.value = 180;
        lowOsc.type = 'sine';
        const t = resultTime + 0.1;
        lowGain.gain.setValueAtTime(0.18, t);
        lowGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
        lowOsc.start(t);
        lowOsc.stop(t + 0.15);
      } else {
        // Normal hit: solid impact sound
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.value = 280;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.25, resultTime);
        gain.gain.exponentialRampToValueAtTime(0.01, resultTime + 0.1);
        osc.start(resultTime);
        osc.stop(resultTime + 0.1);

        // Quick confirmation tone
        const confirmOsc = audioContext.createOscillator();
        const confirmGain = audioContext.createGain();
        confirmOsc.connect(confirmGain);
        confirmGain.connect(audioContext.destination);
        confirmOsc.frequency.value = 440;
        confirmOsc.type = 'sine';
        const ct = resultTime + 0.08;
        confirmGain.gain.setValueAtTime(0.15, ct);
        confirmGain.gain.exponentialRampToValueAtTime(0.01, ct + 0.1);
        confirmOsc.start(ct);
        confirmOsc.stop(ct + 0.1);
      }
    } catch (e) {
      logger.error('Failed to play combat sound:', e);
    }
  };

  // Fetch campaign members and their avatars/names
  const fetchMembers = useCallback(async () => {
    try {
      const data = await fetchCampaignMembersCached(campaignId, { userId });
      const membersList: Array<{ user_id: string; role: string; character_name?: string; selected_character_id?: number; avatar?: string; character_level?: number; ability_scores?: Record<string, number>; selected_skills?: string[]; expertise_skills?: string[]; is_virtual?: boolean }> = (data || [])
        // Filter out virtual players without a selected character
        .filter((m: any) => !m.is_virtual || m.selected_character_id);

      // Try to fetch character info for those with selected_character_id
      const withCharacters = await Promise.all(
        membersList.map(async (m) => {
          if (m.selected_character_id) {
            try {
              const c = await fetchCharacterCached(m.selected_character_id, { userId });
              return {
                ...m,
                character_name: c?.name || m.character_name,
                avatar: c?.avatar,
                character_level: typeof c?.level === "number" ? c.level : m.character_level,
                ability_scores: c?.ability_scores,
                selected_skills: c?.selected_skills || [],
                expertise_skills: c?.expertise_skills || [],
              };
            } catch (err) {
              logger.error(`Failed to load character ${m.selected_character_id} for user ${m.user_id}`, err);
              return m;
            }
          }
          return m;
        })
      );
      setMembers(withCharacters);
    } catch (e) {
      logger.error("Failed to load members", e);
    }
  }, [campaignId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // Listen for character selection changes to refresh members
  useEffect(() => {
    const handler = () => {
      logger.debug('[ChatPanel] Character selected, refreshing members');
      fetchMembers();
    };
    return subscribeAppEvent("characterSelected", handler);
  }, [fetchMembers]);

  // Build player characters list for XP rewards and skill lookups
  const campaignCharacters = useMemo(() => {
    return members
      .filter(m => m.selected_character_id)
      .map(m => ({
        id: m.selected_character_id!,
        name: m.character_name || 'Unknown',
        user_id: m.user_id,
        avatar_url: m.avatar
      }));
  }, [members]);

  // Build recipients list for currency modals (characters + monsters/NPCs from map)
  const rewardRecipients = useMemo(() => {
    // Player characters
    const characters = members
      .filter(m => m.selected_character_id)
      .map(m => ({
        id: m.selected_character_id!,
        name: m.character_name || 'Unknown',
        user_id: m.user_id,
        avatar_url: m.avatar,
        type: 'character' as const
      }));

    // Monsters/NPCs from current map tokens
    const monsters = mapTokens
      .filter(t => t.monster_instance_id)
      .map(t => ({
        id: `m_${t.monster_instance_id}`,
        name: t.instance_name || t.monster_name || t.monster_name_cn || '怪物',
        avatar_url: t.avatar || undefined,
        type: 'monster' as const
      }));

    return [...characters, ...monsters];
  }, [members, mapTokens]);

  // 计算当前玩家控制的伙伴/召唤物（用于骰子请求卡的伙伴投骰按钮）
  const playerCompanions = useMemo(() => {
    if (isDM || !userId) return [];
    return mapTokens
      .filter(t =>
        t.monster_instance_id &&
        t.control_type &&
        t.controller_character_id &&
        mapTokens.some(ct => ct.character_id === t.controller_character_id && ct.user_id === userId)
      )
      .map(t => ({
        monster_instance_id: t.monster_instance_id!,
        name: t.instance_name || t.monster_name_cn || t.monster_name || '伙伴',
        control_type: t.control_type!,
      }));
  }, [mapTokens, isDM, userId]);

  // Helper function to get display name for a user
  const getUserDisplayName = useCallback((userId: string, role?: string) => {
    if (role === "ai") return "AI";
    if (role === "dm") return "DM";
    // Find member: prefer player role, fallback to any member with character (DM in player mode)
    const member = members.find(m => m.user_id === userId && m.role === "player")
      || members.find(m => m.user_id === userId && m.selected_character_id);
    return member?.character_name || userId || "玩家";
  }, [members]);

  const getMessageDisplayName = useCallback((userId: string, role?: string, messageType?: Message['type']) => {
    if (role === 'system' && messageType === 'combat') return 'DM';
    return getUserDisplayName(userId, role);
  }, [getUserDisplayName]);

  // Helper function to get avatar for a user
  const getUserAvatar = useCallback((userId: string, role?: string) => {
    if (role === "ai" || role === "dm") return null;
    // Find member: prefer player role, fallback to any member with character
    const member = members.find(m => m.user_id === userId && m.role === "player")
      || members.find(m => m.user_id === userId && m.selected_character_id);
    return member?.avatar || null;
  }, [members]);

  // Helper function to get character info for a user (for bubble display)
  const getCharacterInfo = useCallback((userId: string, role?: string) => {
    if (role === "ai") return null;
    // DM messages show bubble on DM avatar
    if (role === "dm") return { characterId: "dm" as number | string, characterName: "DM" };
    const member = members.find(m => m.user_id === userId && m.role === "player")
      || members.find(m => m.user_id === userId && m.selected_character_id);
    if (member?.selected_character_id) {
      return {
        characterId: member.selected_character_id,
        characterName: member.character_name || userId,
      };
    }
    return null;
  }, [members]);

  // Update message display names when members change (covers both main and filtered messages)
  // Use refs to avoid infinite loop: updateMessage changes messagesHook which would re-trigger
  const messagesHookRef = useRef(messagesHook);
  messagesHookRef.current = messagesHook;
  const getMessageDisplayNameRef = useRef(getMessageDisplayName);
  getMessageDisplayNameRef.current = getMessageDisplayName;

  useEffect(() => {
    if (members.length === 0) return;
    const hook = messagesHookRef.current;
    const getDisplayName = getMessageDisplayNameRef.current;
    hook.messages.forEach((msg) => {
      if (msg.senderUserId) {
        const newDisplayName = getDisplayName(msg.senderUserId, msg.senderRole, msg.type);
        if (newDisplayName !== msg.user) {
          hook.updateMessage(msg.id, { user: newDisplayName });
        }
      }
    });
    // Also update filtered messages
    setFilteredMessages(prev => {
      if (prev.length === 0) return prev;
      let changed = false;
      const updated = prev.map(msg => {
        if (!msg.senderUserId) return msg;
        const newDisplayName = getDisplayName(msg.senderUserId, msg.senderRole, msg.type);
        if (newDisplayName !== msg.user) { changed = true; return { ...msg, user: newDisplayName }; }
        return msg;
      });
      return changed ? updated : prev;
    });
  }, [members]);

  // WebSocket message handler
  const handleWebSocketMessage = useCallback((wsMessage: WebSocketMessage<any>) => {
    const data = (wsMessage.data ?? {}) as any;

    // Handle connection message with online users list
    if (wsMessage.type === "connection" && data.online_users) {
      // Initialize online users from server
      for (const onlineUserId of data.online_users) {
        setOnline(campaignId, onlineUserId);
      }
      // Also set self as online
      setOnline(campaignId, userId);
      return;
    }

    if (wsMessage.type === "chat") {
      const messageId = String(data.id ?? data.timestamp ?? Date.now());
      const dbId = typeof data.id === "number" ? (data.id as number) : undefined;

      // Check if this is a dice message (new format with meta.dice)
      const msgType = data.message_type;
      const normalizedMsgType = (msgType === 'combat' ? 'combat' : 'chat') as 'chat' | 'combat';
      const displayName = data.character_name || getMessageDisplayName(data.user_id || "", data.role, normalizedMsgType);
      const diceMeta = data.meta?.dice;
      // Handle dice messages (from new backend format)
      if (msgType === "dice" && diceMeta) {
        if (diceMeta.stage === "request") {
          // Dice request message
          const c = diceMeta.check || {};
          const recipients = diceMeta.recipients || [];
          const isPrivate = data.is_private || false;

          // Build display text
          const parts: string[] = [];
          if (c.skill) parts.push(getSkillName(c.skill));
          else if (c.ability) parts.push(`${getAbilityName(c.ability)}检定`);
          const dcVal = typeof c.dc === "number" ? c.dc : null;
          if (dcVal != null) parts.push(`DC ${dcVal}`);
          if (c.dice) parts.push(`${c.dice}`);
          const desc = c.description ? `\n${c.description}` : "";
          const privacy = isPrivate ? "🔒 暗投" : "🔓 明骰";
          const text = `[${privacy}] 发起检定：${parts.join(" · ")}${desc}`;

          const newMessage: Message = {
            id: messageId,
            dbId: dbId,
            user: displayName,
            senderUserId: data.user_id,
            senderRole: data.role,
            content: text,
            type: "dice",
            timestamp: data.created_at ? new Date(data.created_at) : new Date(data.timestamp || Date.now()),
            createdAt: data.created_at,
            recipients: recipients,
            // Convert to old format for compatibility with existing render logic
            meta: {
              diceRequest: {
                request_id: diceMeta.request_id,
                check: c,
                recipients: recipients,
                completed_by: diceMeta.completed_by || [],
                dismissed_by: diceMeta.dismissed_by || [],
                is_private: isPrivate,
              }
            },
          };
          messagesHook.addMessage(newMessage);
          if (recipients.includes(userId) || !recipients.length) {
            playDiceRequestSound();
            // 触发骰子请求气泡显示
            if (!isDM) {
              showDiceRequestBubble({
                requestId: diceMeta.request_id || messageId,
                messageId: messageId,
                checkType: c.type === 'save' ? 'save' : c.type === 'contest' ? 'contest' : 'check',
                skill: c.skill,
                ability: c.ability,
                dc: typeof c.dc === 'number' ? c.dc : undefined,
                dice: c.dice || '1d20',
                description: c.description,
                isPrivate: isPrivate,
              });
            }
          }
        } else if (diceMeta.stage === "result") {
          // Dice result message
          const r = diceMeta.roll || {};
          const actor = diceMeta.actor;
          const isPrivate = data.is_private || false;
          const recipients = data.recipients || [];

          // Visibility filter for private rolls
          // Only show if: user is DM, or user is the target, or user is in recipients list
          if (isPrivate && !isDM) {
            const actorUserId = actor?.user_id;
            const isTargetActor = actorUserId === userId;
            const isInRecipients = recipients.includes(userId);
            const isSender = data.user_id === userId;
            if (!isTargetActor && !isInRecipients && !isSender) {
              return;
            }
          }

          // Get actor display name
          let actorLabel: string | null = null;
          if (actor && actor.type === "monster") {
            actorLabel = `${actor.name || "怪物"}（怪物）`;
          } else if (actor && actor.type === "player") {
            actorLabel = actor.name || getUserDisplayName(actor.user_id || data.user_id || "", "player");
          }
          if (!actorLabel) {
            actorLabel = getUserDisplayName(data.user_id || "", data.role);
          }

          // Store dice result for dice tab
          // 优先使用 created_at (ISO格式) 以保持与历史数据一致
          const createdAt = data.created_at;
          const ts = createdAt ? new Date(createdAt) : new Date(data.timestamp || Date.now());
          const diceRollEntry = {
            id: messageId,
            user: actorLabel,
            senderUserId: actor?.user_id || data.user_id,
            senderRole: data.role,
            timestamp: ts,
            roll: {
              ...r,
              actor_name: actor?.name,
              actor_type: actor?.type,
              actor_user_id: actor?.user_id,
              actor_avatar_url: actor?.avatar_url,
              control_type: actor?.control_type,
              is_private: isPrivate,
            },
          };
          setDiceRolls((prev) => [...prev, diceRollEntry]);
          uiHook.setDiceExecuteLoading(null);

          // 触发角色气泡显示骰子结果（支持玩家角色和怪物）
          // 玩家角色用 character_id，怪物用 "m_" + monster_instance_id
          console.log('[DiceBubble] actor:', JSON.stringify(actor));
          const bubbleCharacterId = actor?.character_id
            ? actor.character_id
            : actor?.monster_instance_id
              ? `m_${actor.monster_instance_id}`
              : null;
          console.log('[DiceBubble] bubbleCharacterId:', bubbleCharacterId);

          if (bubbleCharacterId) {
            console.log('[DiceBubble] Showing bubble for:', bubbleCharacterId, actor?.name);
            showCharacterBubble({
              characterId: bubbleCharacterId,
              characterName: actor?.name || actorLabel,
              message: r.description || r.skill || r.ability || '投骰',
              type: 'dice',
              diceResult: r.total,
              diceExpression: r.expression,
              messageId: messageId,
              senderUserId: actor?.user_id || data.user_id,
            });
          } else {
            console.log('[DiceBubble] No bubbleCharacterId, skipping bubble');
          }

          // Build simplified content for chat display
          const descText = typeof r.description === "string" && r.description.trim() ? r.description.trim() : "";
          const header = `${actorLabel}${descText ? ` ${descText}` : ""}`;
          let simplifiedContent = `${header ? `${header}：` : ""}投掷结果: ${typeof r.total === "number" ? r.total : "?"}`;
          if (typeof r.dc === "number") {
            if (r.is_critical) {
              simplifiedContent += ` vs DC ${r.dc} => 🎯 大成功！`;
            } else if (r.is_fumble) {
              simplifiedContent += ` vs DC ${r.dc} => 💥 大失败！`;
            } else if (r.success) {
              simplifiedContent += ` vs DC ${r.dc} => ✓ 成功`;
            } else {
              simplifiedContent += ` vs DC ${r.dc} => ✗ 失败`;
            }
          }
          if (r.narrative) {
            simplifiedContent += `\n\n${r.narrative}`;
          }

          const newMessage: Message = {
            id: messageId,
            dbId: dbId,
            user: actorLabel,
            senderUserId: data.user_id,
            senderRole: data.role,
            content: simplifiedContent,
            type: "dice",
            timestamp: data.created_at ? new Date(data.created_at) : new Date(data.timestamp || Date.now()),
            createdAt: data.created_at,
            // Convert to old format for compatibility, including privacy and actor info
            meta: {
              diceRoll: {
                ...r,
                is_private: isPrivate,
                actor_name: actor?.name,
                actor_type: actor?.type,
                actor_avatar_url: actor?.avatar_url,
                control_type: actor?.control_type,
              }
            },
          };
          messagesHook.addMessage(newMessage);

          // Update in-memory completed_by on the original request message
          // so the pendingRequest filter immediately skips it
          const resultRequestId = data.request_id || diceMeta.request_id;
          const resultCompletedBy = data.request_completed_by;
          if (resultRequestId && resultCompletedBy) {
            messagesHook.setMessages(prev => prev.map(m => {
              const req = (m.meta as any)?.diceRequest;
              if (req && (req.request_id === resultRequestId)) {
                return { ...m, meta: { ...m.meta, diceRequest: { ...req, completed_by: resultCompletedBy } } };
              }
              return m;
            }));
          }

          // Play dice sound for all dice results (including own rolls for feedback)
          playDiceSound({
            critical: r.is_critical === true,
            fumble: r.is_fumble === true,
            success: r.success
          });
        }
        return; // Don't process as regular chat
      }

      // Regular chat message (or combat message)
      const newMessage: Message = {
        id: messageId,
        dbId: dbId,
        user: displayName,
        senderUserId: data.user_id,
        senderRole: data.role,
        content: data.message || "",
        type: normalizedMsgType,
        timestamp: data.created_at ? new Date(data.created_at) : new Date(data.timestamp || Date.now()),
        createdAt: data.created_at,
        recipients: data.recipients,
        meta: data.meta,
      };

      messagesHook.addMessage(newMessage);

      // 触发角色气泡显示（私信不显示气泡）
      const isPrivateMessage = Array.isArray(data.recipients) && data.recipients.length > 0;

      if (!isPrivateMessage) {
        // Combat messages: show bubble for attacker (character or monster)
        if (msgType === 'combat') {
          const meta = data.meta || {};
          const attackerCharacterId = meta.attacker_character_id;
          const attackerMonsterInstanceId = meta.attacker_monster_instance_id;
          const attackerName = meta.attacker_name || '攻击者';
          const targetName = meta.target_name || '目标';
          const attackName = meta.attack_name || '攻击';
          // For combat, we use the attacker's name and show attack result
          const hit = meta.hit;
          const critical = meta.critical;
          const fumble = meta.fumble;
          const damage = meta.damage_dealt || 0;

          // Build descriptive bubble message: "用[武器]攻击[目标]，[结果]"
          let resultPart = '';
          if (critical) {
            resultPart = `暴击! ${damage}点伤害`;
          } else if (fumble) {
            resultPart = '大失败!';
          } else if (hit) {
            resultPart = `命中! ${damage}点伤害`;
          } else {
            resultPart = '未命中';
          }
          const bubbleMsg = `用${attackName}攻击${targetName}，${resultPart}`;

          // Use attacker_character_id for player characters, or monster_instance_id with "m_" prefix for monsters
          // This matches the avatar ID format in ZoomControls
          const bubbleId = attackerCharacterId || (attackerMonsterInstanceId ? `m_${attackerMonsterInstanceId}` : null);
          if (bubbleId) {
            showCharacterBubble({
              characterId: bubbleId,
              characterName: attackerName,
              message: bubbleMsg,
              type: 'combat',
              messageId: messageId,
              senderUserId: data.user_id,
            });
          }
        } else {
          // Regular chat messages
          const charInfo = getCharacterInfo(data.user_id || "", data.role);
          if (charInfo) {
            showCharacterBubble({
              characterId: charInfo.characterId,
              characterName: charInfo.characterName,
              message: data.message || "",
              type: 'chat',
              messageId: messageId,
              senderUserId: data.user_id,
            });
          }
        }
      }

      // Play sound for new messages
      // For combat messages, always play sound (even for own attacks) for feedback
      // For regular messages, skip sound for own messages
      if (msgType === 'combat') {
        // Combat sound - play a different sound based on result and attack type
        const meta = data.meta || {};
        const critical = meta.critical;
        const fumble = meta.fumble;
        const hit = meta.hit;
        const attackType = meta.attack_type as 'melee' | 'ranged' | undefined;
        playCombatSound({ attackType: attackType || 'melee', hit, critical, fumble });
      } else if (data.user_id !== userId) {
        const isPrivateToMe = Array.isArray(data.recipients) && data.recipients.length > 0 && data.recipients.includes(userId);
        playMessageSound(isPrivateToMe);
      }

      // If AI just responded, clear typing state
      if (data.role === "ai") {
        aiHook.clearAIError();
      }
    } else if (wsMessage.type === "rest_grant") {
      const restType = data.rest_type || 'short';
      const pendingCharacters = data.pending_characters || [];
      const claimedBy = data.claimed_by || [];
      const text = `DM 发放：${restType === 'long' ? '长休' : '短休'}`;
      const newMessage: Message = {
        id: String(data.id || data.timestamp || Date.now()),
        dbId: typeof data.id === 'number' ? data.id : undefined, // Use database ID for deduplication
        user: 'DM',
        senderUserId: data.user_id,
        senderRole: 'dm',
        content: text,
        type: 'system', // Use 'system' type to match database
        timestamp: new Date(data.created_at || data.timestamp || Date.now()),
        createdAt: data.created_at,
        meta: {
          restGrant: { type: restType },
          pending_characters: pendingCharacters,
          claimed_by: claimedBy,
        },
      } as any;
      messagesHook.addMessage(newMessage);
      if (data.user_id !== userId) {
        playMessageSound();
      }

    } else if (wsMessage.type === "consumable_use") {
      const charName = data.character_name || '角色';
      const newMessage: Message = {
        id: String(data.id || Date.now()),
        dbId: typeof data.id === 'number' ? data.id : undefined,
        user: charName,
        senderUserId: data.user_id,
        senderRole: 'system',
        content: data.result_text || `${charName} 使用了 ${data.item_name || '消耗品'}`,
        type: 'system',
        timestamp: new Date(data.created_at || data.timestamp || Date.now()),
        createdAt: data.created_at,
        meta: { consumable_use: data },
      };
      messagesHook.addMessage(newMessage);
      if (data.user_id !== userId) {
        playMessageSound();
      }

    } else if (wsMessage.type === "resource_use") {
      const charName = data.character_name || '角色';
      const isOwnResourceUse = data.user_id === userId;
      const newMessage: Message = {
        id: String(data.id || Date.now()),
        dbId: typeof data.id === 'number' ? data.id : undefined,
        user: charName,
        senderUserId: data.user_id,
        senderRole: 'system',
        content: data.content || `${charName} 使用了 ${data.resource_name || '技能'}（剩余 ${data.current}/${data.max}）`,
        type: 'system',
        timestamp: new Date(data.created_at || data.timestamp || Date.now()),
        createdAt: data.created_at,
        meta: { resource_use: data },
      };
      messagesHook.addMessage(newMessage);
      if (!isOwnResourceUse) {
        playMessageSound();
        const charInfo = getCharacterInfo(data.user_id, 'player');
        if (charInfo) {
          showCharacterBubble({
            characterId: charInfo.characterId,
            characterName: charName,
            message: `使用了 ${data.resource_name || '技能'}`,
            type: 'combat',
            messageId: String(data.id || Date.now()),
            senderUserId: data.user_id,
          });
        }
      }

    } else if (wsMessage.type === "rest_claimed") {
      // Update the message to reflect who has claimed the rest
      const messageId = data.message_id;
      const claimedBy = data.claimed_by || [];
      const restResult = data.rest_result;

      // Update the message's claimed_by list and rest_results
      messagesHook.setMessages((prev) =>
        prev.map((msg) => {
          if (msg.dbId === messageId && msg.meta?.restGrant) {
            const existingResults = (msg.meta as any)?.rest_results || {};
            return {
              ...msg,
              meta: {
                ...msg.meta,
                claimed_by: claimedBy,
                rest_results: restResult
                  ? { ...existingResults, [data.user_id]: restResult }
                  : existingResults,
              }
            };
          }
          return msg;
        })
      );

    } else if (wsMessage.type === "reward_pending") {
      // Handle pending reward that requires player acceptance
      const rewardData = data;
      const rewardType = data.reward_type;
      const messageId = data.message_id;
      const isPrivate = Boolean(data.is_private);

      let text = '';
      if (rewardType === 'xp') {
        const amount = rewardData.amount;
        const source = rewardData.source || '手动';
        const sourceMap: Record<string, string> = {
          'Combat': '战斗',
          'Quest': '任务',
          'Roleplay': '角色扮演',
          'Exploration': '探索',
          'Puzzle': '谜题',
          'Social': '社交',
          'Manual': '手动'
        };
        const sourceText = sourceMap[source] || source;
        const charNames = rewardData.characters?.map((c: any) => c.name).join(', ') || '未知';
        text = `${isPrivate ? '🔒 ' : '⚡ '}DM发放了 ${amount} 点经验值（${sourceText}）给 ${charNames}`;
        if (rewardData.description) {
          text += `：${rewardData.description}`;
        }
      } else if (rewardType === 'currency') {
        const changes = rewardData.currency_changes || {};
        const changesText = Object.entries(changes)
          .map(([type, amt]) => `${amt}${type}`)
          .join(', ');
        const charNames = rewardData.characters?.map((c: any) => c.name).join(', ') || '未知';
        text = `${isPrivate ? '🔒 ' : '💰 '}DM发放了金币（${changesText}）给 ${charNames}`;
        if (rewardData.description) {
          text += `：${rewardData.description}`;
        }
      }

      if (text) {
        const newMessage: Message = {
          id: String(messageId || data.timestamp || Date.now()),
          dbId: messageId,
          user: 'DM',
          senderUserId: rewardData.awarded_by,
          senderRole: 'dm',
          content: text,
          type: 'system',
          timestamp: new Date(data.created_at || rewardData.timestamp || Date.now()),
          createdAt: data.created_at,
          meta: {
            rewardPending: {
              reward_type: rewardType,
              amount: rewardData.amount,
              currency_changes: rewardData.currency_changes,
              characters: rewardData.characters,
              claimed_by: rewardData.claimed_by || [],
              is_private: isPrivate,
            }
          }
        } as any;
        messagesHook.addMessage(newMessage);
        playMessageSound(isPrivate);
      }

    } else if (wsMessage.type === "reward_claimed") {
      // Update the message to reflect who has claimed
      const messageId = data.message_id;
      const claimedBy = data.claimed_by || [];

      // Update the message's claimed_by list
      messagesHook.setMessages((prev) =>
        prev.map((msg) => {
          if (msg.dbId === messageId && msg.meta?.rewardPending) {
            return {
              ...msg,
              meta: {
                ...msg.meta,
                rewardPending: {
                  ...(msg.meta.rewardPending as any),
                  claimed_by: claimedBy,
                }
              }
            };
          }
          return msg;
        })
      );

    } else if (wsMessage.type === "dice_execute_result") {
      // Clear any client-side pending execute loading when backend sends simplified result
      uiHook.setDiceExecuteLoading(null);

    } else if (wsMessage.type === "dice_result") {
      // Quick dice roll result from dice_quick message
      const msg = data;
      console.log('[DiceResult] Full message:', JSON.stringify(msg));
      const result = msg.result || {};
      console.log('[DiceResult] result:', JSON.stringify(result));
      const isPrivate = msg.is_private;
      const visibleTo = msg.visible_to || [];

      // Check visibility for private rolls
      if (isPrivate && !visibleTo.includes(userId)) {
        return; // Not visible to this user
      }

      const messageId = String(msg.id || Date.now());
      const actorName = result.actor_name || getUserDisplayName(msg.user_id, msg.role);

      // Add to chat messages
      const newMessage: Message = {
        id: messageId,
        dbId: msg.id,
        user: actorName,
        senderUserId: msg.user_id,
        senderRole: msg.role,
        content: msg.content,
        type: 'dice',
        timestamp: msg.created_at ? new Date(msg.created_at) : new Date(),
        createdAt: msg.created_at,
        meta: {
          diceRoll: {
            expression: result.expression,
            total: result.total,
            rolls: result.rolls,
            is_private: isPrivate,
            actor_name: result.actor_name,
            actor_avatar_url: result.actor_avatar_url,
            control_type: result.control_type,
          }
        }
      };
      messagesHook.addMessage(newMessage);

      // Add to dice rolls tab
      const diceRollEntry = {
        id: messageId,
        user: actorName,
        senderUserId: msg.user_id,
        senderRole: msg.role,
        timestamp: msg.created_at ? new Date(msg.created_at) : new Date(),
        roll: {
          expression: result.expression,
          total: result.total,
          rolls: result.rolls,
          is_private: isPrivate,
          actor_name: result.actor_name,
          actor_type: result.actor_type,
          actor_user_id: result.actor_user_id,
          actor_avatar_url: result.actor_avatar_url,
          control_type: result.control_type,
        },
      };
      setDiceRolls((prev) => [...prev, diceRollEntry]);

      // 触发角色气泡显示骰子结果（支持玩家角色和怪物）
      // 玩家角色用 character_id，怪物用 "m_" + monster_instance_id
      const actorCharacterId = result.actor_character_id;
      const actorMonsterInstanceId = result.actor_monster_instance_id;
      const charInfo = actorCharacterId ? null : getCharacterInfo(msg.user_id, msg.role);

      // 优先使用 character_id，其次怪物 id（带前缀），最后从 user_id 查找
      const characterId = actorCharacterId
        ? actorCharacterId
        : actorMonsterInstanceId
          ? `m_${actorMonsterInstanceId}`
          : charInfo?.characterId;

      console.log('[DiceResult] Bubble info:', { actorCharacterId, actorMonsterInstanceId, charInfo, characterId, actorName });

      if (characterId) {
        showCharacterBubble({
          characterId,
          characterName: actorName,
          message: result.expression || '投骰',
          type: 'dice',
          diceResult: result.total,
          diceExpression: result.expression,
          messageId: messageId,
          senderUserId: msg.user_id,
          avatarUrl: result.actor_avatar_url,
        });
      }

      // Play sound
      playMessageSound(isPrivate);

      // 3D骰子开启时，自己投的骰子不需要额外处理 — 结果已经是3D物理结果
      // 其他人投的骰子不触发3D动画，避免数字不一致

    } else if (wsMessage.type === "user_connected") {
      // Update online status in store
      if (data.user_id && data.user_id !== userId) {
        setOnline(campaignId, data.user_id);
      }
    } else if (wsMessage.type === "user_disconnected") {
      // Update online status in store
      if (data.user_id && data.user_id !== userId) {
        setOffline(campaignId, data.user_id);
      }
    } else if (wsMessage.type === "chat_edit") {
      messagesHook.updateMessage(String(data.id), {
        content: data.content,
        meta: { edited: true }
      });
    } else if (wsMessage.type === "combat_narrative_update") {
      // Update combat message with generated narrative
      const msgId = String(data.chat_message_id);
      messagesHook.setMessages((prev) =>
        prev.map((msg) =>
          msg.id === msgId
            ? { ...msg, content: data.content, meta: { ...msg.meta, has_narrative: true, narrative: data.narrative } }
            : msg
        )
      );
    } else if (wsMessage.type === "chat_delete") {
      messagesHook.deleteMessage(String(data.id));
      // Also remove from AI assistant messages
      setAiAssistantMessages(prev => prev.filter(m => m.dbId !== data.id));
    } else if (wsMessage.type === "chat_clear") {
      // Clear all messages
      messagesHook.setMessages([]);
      if (!data.preserve_ai) {
        setAiAssistantMessages([]);
      }
      messagesHook.showToast(data.preserve_ai ? "聊天室已被DM清空，AI助手历史已保留" : "聊天室已被DM清空");
    } else if (wsMessage.type === "tts_generating" || wsMessage.type === "tts_ready" || wsMessage.type === "tts_broadcast") {
      handleTTSWebSocketMessage(wsMessage.type, data);
    } else if (wsMessage.type === "dice_clear") {
      setDiceRolls([]);
      messagesHook.showToast("骰子结果已被DM清空");
    } else if (wsMessage.type === "dice_narrative_result") {
      // Narrative generated for a dice result
      const messageId = String(data.message_id);
      const narrative = data.narrative;
      setNarrativeLoadingId(null);

      // 剧情生成后清除该消息的 TTS 缓存，确保下次朗读包含剧情
      clearTtsCache(Number(data.message_id) || undefined, messageId);

      // Update diceRolls state
      setDiceRolls((prev) =>
        prev.map((entry) =>
          entry.id === messageId
            ? { ...entry, roll: { ...entry.roll, narrative } }
            : entry
        )
      );

      // Also update messages directly via setMessages in hook
      // (updateMessage doesn't handle nested meta updates well)
      messagesHook.setMessages?.((prev: Message[]) =>
        prev.map((msg) => {
          // 匹配 msg.dbId 或 msg.id（数据库ID可能存储在dbId字段）
          const msgDbId = String(msg.dbId || msg.id);
          if (msgDbId === messageId && msg.meta?.diceRoll) {
            const updatedRoll = { ...msg.meta.diceRoll, narrative };
            return {
              ...msg,
              meta: { ...msg.meta, diceRoll: updatedRoll },
            };
          }
          return msg;
        })
      );
    } else if (wsMessage.type === "ai_stream") {
      // Handle AI streaming from WebSocket
      const streamData = data as { chunk: string; done: boolean };
      if (streamData.done) {
        aiHook.handleStreamDone();
      } else {
        // First chunk - start streaming
        if (!aiHook.isAiStreaming) {
          aiHook.startStreaming();
        }
        aiHook.handleStreamChunk(streamData.chunk);
      }
    } else if (wsMessage.type === "ai_session_title") {
      // Auto-generated session title update
      const { session_id, title } = data as { session_id: number; title: string };
      setAiSessions(prev => prev.map(s => s.id === session_id ? { ...s, title } : s));
    } else if (wsMessage.type === "concentration_check_result") {
      // Handle concentration check result (auto-rolled when token takes damage)
      const result = data as {
        token_id: number;
        token_name: string;
        spell_name: string;
        damage: number;
        dc: number;
        roll: number;
        roll_details: string;
        bonus: number;
        total: number;
        success: boolean;
        advantage: boolean;
      };

      // Create a system message showing the concentration check result
      const successText = result.success ? "✅ 专注维持" : "❌ 专注中断";
      const advantageNote = result.advantage ? " (战斗施法者优势)" : "";
      const rollText = result.advantage
        ? `2d20kh1+${result.bonus} = ${result.roll_details}+${result.bonus} = ${result.total}`
        : `1d20+${result.bonus} = ${result.roll_details}+${result.bonus} = ${result.total}`;

      const content = `🎯 **专注检定**\n「${result.token_name}」受到 ${result.damage} 点伤害\n维持「${result.spell_name}」· DC ${result.dc} 体质豁免${advantageNote}\n\n🎲 ${rollText} ${successText}`;

      messagesHook.addMessage({
        id: `conc-${Date.now()}`,
        user: "系统",
        content,
        timestamp: new Date(),
        type: "system",
        senderRole: "system",
        meta: {
          isConcentrationCheck: true,
          concentrationResult: result,
        },
      });

      // Play sound
      playMessageSound(false);
    }
  }, [getUserDisplayName, getCharacterInfo, userId, isDM, messagesHook, aiHook, uiHook, setOnline, setOffline, campaignId, handleTTSWebSocketMessage, clearTtsCache]);

  // WebSocket connection
  const { isConnected, sendMessage } = useWebSocket({
    campaignId,
    userId,
    role: isDM ? "dm" : "player",
    onMessage: handleWebSocketMessage,
    onConnect: () => {
      logger.debug("Chat WebSocket connected");
    },
    onDisconnect: () => {
      logger.debug("Chat WebSocket disconnected");
    },
  });

  // Keep sendMessageRef in sync for useTTS
  sendMessageRef.current = sendMessage;

  // 追踪已处理的骰子请求（本地状态，避免重复显示气泡）
  const processedDiceRequestsRef = useRef<Set<string>>(new Set());
  // 追踪当前显示的骰子请求 ID，避免重复触发事件
  const currentShowingRequestRef = useRef<string | null>(null);

  // 监听骰子请求响应事件（从 DM 头像气泡点击触发）
  useEffect(() => {
    if (isDM) return; // DM 不需要监听

    const unsubscribeRespond = onDiceRequestRespond(({ messageId, companionActor }) => {
      // 标记为已处理
      processedDiceRequestsRef.current.add(messageId);
      // 找到对应的消息
      const msg = messagesHook.messages.find(m => m.id === messageId);
      if (msg) {
        const check = (msg.meta as any)?.diceRequest?.check;
        const reqId = (msg.meta as any)?.diceRequest?.request_id;
        const isPriv = Boolean((msg.meta as any)?.diceRequest?.is_private);
        uiHook.setDiceExecuteLoading(msg.id);
        // 直接执行投骰
        const payload: WebSocketMessage<any> = {
          type: "dice_execute",
          data: {
            message: msg.content,
            timestamp: Date.now(),
            ...(check ? { check } : {}),
            ...(reqId ? { request_id: reqId } : {}),
            ...(typeof isPriv === "boolean" ? { is_private: isPriv } : {}),
            // 伙伴投骰时，覆盖 actor 为伙伴信息
            ...(companionActor ? { actor: companionActor } : {}),
          },
        };
        sendDiceExecute(payload);
      }
    });

    const unsubscribeDismiss = onDiceRequestDismiss(({ requestId }) => {
      // 标记为已处理
      processedDiceRequestsRef.current.add(requestId);
      // 发送到后端持久化
      sendMessage({
        type: "dice_dismiss",
        data: {
          request_id: requestId,
        },
      });
    });

    return () => {
      unsubscribeRespond();
      unsubscribeDismiss();
    };
  }, [isDM, messagesHook.messages, userId, sendMessage, uiHook]);

  // 检查未完成的骰子请求并触发气泡显示（仅玩家）
  useEffect(() => {
    if (isDM) return;
    if (!messagesHook.isReady) return;

    // 找到最近一个未完成的骰子请求（针对当前用户）
    const pendingRequest = messagesHook.messages
      .filter(msg => {
        const req = (msg.meta as any)?.diceRequest;
        if (!req) return false;
        // 检查本地是否已处理
        const requestId = req.request_id || msg.id;
        if (processedDiceRequestsRef.current.has(requestId) || processedDiceRequestsRef.current.has(msg.id)) {
          console.log(`[DiceRequest] Skipping locally processed: ${requestId}`);
          return false;
        }
        // 检查是否已完成（当前用户在 completed_by 中）
        const completedBy = req.completed_by || [];
        if (completedBy.includes(userId)) {
          console.log(`[DiceRequest] Skipping completed: ${requestId}, completed_by:`, completedBy);
          return false;
        }
        // 检查是否已关闭（当前用户在 dismissed_by 中）
        const dismissedBy = req.dismissed_by || [];
        console.log(`[DiceRequest] Checking dismissed_by for ${requestId}:`, dismissedBy, 'userId:', userId);
        if (dismissedBy.includes(userId)) {
          console.log(`[DiceRequest] Skipping dismissed: ${requestId}`);
          return false;
        }
        // 检查是否是发给当前用户的（recipients 为空表示发给所有人）
        const recipients = req.recipients || [];
        if (recipients.length > 0 && !recipients.includes(userId)) return false;
        console.log(`[DiceRequest] Found pending request: ${requestId}`);
        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

    if (pendingRequest) {
      const req = (pendingRequest.meta as any).diceRequest;
      const requestId = req.request_id || pendingRequest.id;
      // 只有当请求 ID 变化时才触发气泡显示
      if (currentShowingRequestRef.current !== requestId) {
        currentShowingRequestRef.current = requestId;
        const check = req.check || {};
        showDiceRequestBubble({
          requestId: requestId,
          messageId: pendingRequest.id,
          checkType: check.type === 'save' ? 'save' : check.type === 'contest' ? 'contest' : 'check',
          skill: check.skill,
          ability: check.ability,
          dc: typeof check.dc === 'number' ? check.dc : undefined,
          dice: check.dice || '1d20',
          description: check.description,
          isPrivate: req.is_private || false,
        });
      }
    } else {
      // 没有待处理请求，清空当前显示状态
      currentShowingRequestRef.current = null;
    }
  }, [isDM, messagesHook.messages, messagesHook.isReady, userId]);

  // Load dice roll history (persisted results)
  const loadDiceRollHistory = useCallback(async () => {
    try {
      const response = await fetchCampaignChatMessagesCached(
        campaignId,
        { messageType: "dice", limit: 50 },
      );
      const data = response.messages;
      // Filter for dice results (stage === "result") and map to diceRolls format
      const mapped = (Array.isArray(data) ? data : [])
        .filter((msg: any) => msg.meta?.dice?.stage === "result")
        .map((msg: any) => {
          const dice = msg.meta?.dice || {};
          const roll = dice.roll || {};
          const actor = dice.actor || {};
          const actorName = actor.name || "";
          const actorType = actor.type || "";
          const controlType = actor.control_type || "";
          const controlLabel = controlType === 'companion' ? '伙伴'
            : controlType === 'familiar' ? '魔宠'
            : controlType === 'summon' ? '召唤'
            : controlType === 'mount' ? '坐骑'
            : '怪物';
          const display = actorName
            ? (actorType === "monster" ? `${actorName}（${controlLabel}）` : actorName)
            : getUserDisplayName(msg.sender_user_id, msg.sender_role);
          return {
            id: msg.id?.toString() || String(Date.now()),
            user: display,
            senderUserId: actor.user_id || msg.sender_user_id,
            senderRole: msg.sender_role,
            timestamp: new Date(msg.created_at || Date.now()),
            roll: {
              ...roll,
              actor_name: actorName,
              actor_type: actorType,
              actor_user_id: actor.user_id,
              actor_avatar_url: actor.avatar_url,
              control_type: controlType || undefined,
              is_private: msg.is_private,
            },
          };
        });
      setDiceRolls(mapped);
    } catch (e) {
      logger.error("Failed to load dice roll history", e);
    }
  }, [campaignId, userId, isDM, getUserDisplayName]);

  useEffect(() => {
    loadDiceRollHistory();
  }, [loadDiceRollHistory]);

  const formatTime = (d: Date) => {
    // Check for invalid date
    if (!d || isNaN(d.getTime())) {
      return "--:--";
    }
    // Always show date for clarity, especially for system messages
    return d.toLocaleString([], {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Check if message is within 2 minutes for edit/delete
  const canEditOrDelete = (msg: Message): boolean => {
    const now = new Date();
    const messageTime = msg.timestamp;
    const diffInMinutes = (now.getTime() - messageTime.getTime()) / (1000 * 60);
    return diffInMinutes <= 2;
  };

  const renderTtsButton = (msg: Message) => {
    const diceNarrative = (msg.meta?.diceRoll as Record<string, unknown> | undefined)?.narrative as string | undefined;
    const ttsText = msg.type === 'dice' && diceNarrative
      ? (msg.content ? msg.content + '。' : '') + diceNarrative
      : msg.content;
    const isPlaying = ttsPlayingId === msg.id;
    const isLoading = ttsLoading === msg.id;
    const menuOpen = ttsMenuMsgId === msg.id;

    const onButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (isPlaying) { stopPlayback(); return; }
      if (isLoading) return;
      if (menuOpen) {
        setTtsMenuMsgId(null);
      } else {
        const rect = e.currentTarget.getBoundingClientRect();
        setTtsMenuPos({ top: rect.top, right: window.innerWidth - rect.right });
        setTtsMenuMsgId(msg.id);
      }
    };

    const onMenuItem = (action: 'play' | 'broadcast' | 'regenerate') => {
      setTtsMenuMsgId(null);
      if (action === 'play') handleTTS(msg.id, ttsText, msg.dbId);
      else if (action === 'broadcast') handleTTSBroadcast(msg.id, ttsText, msg.dbId);
      else handleTTSRegenerate(msg.id, ttsText, msg.dbId);
    };

    return (
      <div className="relative">
        <button
          ref={menuOpen ? ttsButtonRef : undefined}
          onClick={onButtonClick}
          disabled={isLoading}
          className={`transition-colors ${
            isPlaying ? 'text-amber-400'
              : isLoading ? 'text-gray-500 cursor-wait'
              : 'text-gray-400 hover:text-amber-300'
          }`}
          title={isPlaying ? '停止朗读' : '朗读'}
        >
          {isLoading ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="31.4" strokeDashoffset="10"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg>
          ) : isPlaying ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          )}
        </button>
        {menuOpen && ttsMenuPos && createPortal(
          <div
            ref={ttsMenuRef}
            className="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-[10200] whitespace-nowrap text-xs"
            style={{ top: ttsMenuPos.top, right: ttsMenuPos.right, transform: 'translateY(-100%) translateY(-4px)' }}
          >
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-gray-700 text-gray-200"
              onClick={() => onMenuItem('play')}
            >
              <span className="w-4 text-center">🔊</span> 朗读
            </button>
            <button
              className={`flex items-center gap-2 w-full px-3 py-1.5 ${voiceIsConnected ? 'hover:bg-gray-700 text-gray-200' : 'text-gray-500 cursor-not-allowed'}`}
              onClick={() => voiceIsConnected && onMenuItem('broadcast')}
              disabled={!voiceIsConnected}
              title={voiceIsConnected ? '合成并广播给语音频道' : '需要先连接语音频道'}
            >
              <span className="w-4 text-center">📢</span> 语音播放
            </button>
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-gray-700 text-gray-200"
              onClick={() => onMenuItem('regenerate')}
            >
              <span className="w-4 text-center">🔄</span> 重新生成
            </button>
          </div>,
          document.body
        )}
      </div>
    );
  };

  const handleScroll = useCallback(async () => {
    const el = listRef.current;
    if (!el) return;

    // Check if at bottom (within 50px threshold)
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setIsAtBottom(atBottom);
    isAtBottomRef.current = atBottom;

    // Load more history when scrolled to top
    if (el.scrollTop <= 30) {
      if (isFilteredMode) {
        if (filteredHasMore && !filteredLoading) {
          await loadFilteredMessages();
        }
      } else if (messagesHook.hasMore && !messagesHook.loadingHistory) {
        await messagesHook.loadHistory();
      }
    }
  }, [isFilteredMode, filteredHasMore, filteredLoading, loadFilteredMessages, messagesHook]);

  // Scroll to a specific message by ID
  const scrollToMessage = useCallback((messageId: string) => {
    const element = document.getElementById(`chat-msg-${messageId}`);
    if (element) {
      // Find the scrollable container (the one containing chat messages)
      const containers = document.querySelectorAll('.overflow-y-auto');
      let container: HTMLElement | null = null;
      for (let i = 0; i < containers.length; i++) {
        if (containers[i].querySelector('[id^="chat-msg-"]')) {
          container = containers[i] as HTMLElement;
          break;
        }
      }
      if (container) {
        // Calculate scroll position using getBoundingClientRect for accurate positioning
        // offsetTop is relative to offsetParent, not the scroll container
        const containerRect = container.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        // Calculate how much to scroll: current scroll + element's position relative to container - padding
        const scrollTo = container.scrollTop + (elementRect.top - containerRect.top) - 20;
        // Use requestAnimationFrame to ensure scroll happens after all DOM updates
        const targetContainer = container;
        requestAnimationFrame(() => {
          targetContainer.scrollTo({ top: Math.max(0, scrollTo), behavior: 'instant' });
        });
      } else {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      // Highlight effect
      element.classList.add('ring-2', 'ring-amber-500', 'ring-offset-2', 'ring-offset-gray-900');
      setTimeout(() => {
        element.classList.remove('ring-2', 'ring-amber-500', 'ring-offset-2', 'ring-offset-gray-900');
      }, 2000);
    } else {
      // Message not in current view - need to load more history
      messagesHook.showToast('消息不在当前视图中，请向上滚动加载更多历史');
    }
  }, [messagesHook]);

  const handleSend = () => {
    if (!uiHook.input.trim()) return;

    // 斜杠命令拦截
    if (slashCmd.isSlashInput) {
      const me = members.find(m => m.user_id === userId && m.ability_scores) || members.find(m => m.user_id === userId);
      const characterStats = me?.ability_scores ? {
        name: me.character_name || '',
        level: me.character_level || 1,
        abilityScores: me.ability_scores,
        selectedSkills: me.selected_skills || [],
        expertiseSkills: me.expertise_skills || [],
      } : undefined;
      const ok = slashCmd.tryExecute({
        sendMessage,
        showToast: messagesHook.showToast,
        characterStats,
        requestDiceRoll: enable3DDice ? (req) => {
          pendingSlashRollRef.current = { buildMessage: req.buildMessage };
          setDice3DNotation(req.notation);
          setDice3DCheckInfo(req.checkInfo ?? null);
          setDice3DVisible(true);
        } : undefined,
      });
      if (ok) {
        uiHook.setInput("");
        // /ai 命令发送后自动切换到 AI 助手 tab
        if (slashCmd.matchedCommand?.name === 'ai') {
          setChatMode('ai-assistant');
          aiHook.startThinking();
        }
      }
      // 无论成功失败都不走普通发送
      return;
    }

    // 如果有引用，在消息前添加引用块（简短版）
    let messageContent = uiHook.input;
    if (uiHook.replyingTo) {
      const quotedContent = uiHook.replyingTo.content.slice(0, 30) + (uiHook.replyingTo.content.length > 30 ? '...' : '');
      messageContent = `> ${uiHook.replyingTo.senderName}: ${quotedContent}\n\n${uiHook.input}`;
    }

	    const payload: WebSocketMessage = {
	      type: "chat",
	      data: {
	        message: messageContent,
	        timestamp: Date.now(),
	        ...(uiHook.selectedRecipients.length > 0 ? { recipients: uiHook.selectedRecipients } : {}),
	        ...(activeModalDescription ? { ui_context: activeModalDescription } : {}),
	      },
	    };

    sendMessage(payload);

    // 如果消息目标包含 AI，立即显示"正在思考"提示
    const isAiTargeted = uiHook.selectedRecipients.some(r => r.toLowerCase() === 'ai') ||
                         messageContent.includes('@ai');
    if (isAiTargeted) {
      aiHook.startThinking();
    }

    uiHook.setInput("");
    uiHook.clearReply(); // 清除引用
  };

  // 直接发送文本消息（用于语音转文字）
  const handleSendDirect = useCallback((text: string) => {
    if (!text.trim()) return;

    const payload: WebSocketMessage = {
      type: "chat",
      data: {
        message: text,
        timestamp: Date.now(),
        ...(uiHook.selectedRecipients.length > 0 ? { recipients: uiHook.selectedRecipients } : {}),
        ...(activeModalDescription ? { ui_context: activeModalDescription } : {}),
      },
    };

    sendMessage(payload);

    // 如果消息目标包含 AI，立即显示"正在思考"提示
    const isAiTargeted = uiHook.selectedRecipients.some(r => r.toLowerCase() === 'ai') ||
                         text.includes('@ai');
    if (isAiTargeted) {
      aiHook.startThinking();
    }
  }, [sendMessage, uiHook.selectedRecipients, aiHook]);

  // AI Assistant send: always targets AI only
  const handleAISend = useCallback((text: string) => {
    if (!text.trim()) return;
    const payload: WebSocketMessage = {
      type: "chat",
      data: {
        message: text,
        timestamp: Date.now(),
        recipients: ['ai'],
        ...(currentAiSessionId ? { ai_session_id: currentAiSessionId } : {}),
        ...(activeModalDescription ? { ui_context: activeModalDescription } : {}),
      },
    };
    sendMessage(payload);
    aiHook.startThinking();
  }, [sendMessage, aiHook, activeModalDescription, currentAiSessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 斜杠命令菜单导航
    if (slashCmd.isMenuOpen) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        slashCmd.moveUp();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        slashCmd.moveDown();
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        uiHook.setInput(slashCmd.selectCommand());
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        uiHook.setInput("");
        return;
      }
    }
    if (e.key === "Enter") {
      if (isChatExpanded) {
        // 展开状态：Ctrl/Cmd+Enter 发送
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          handleSend();
        }
      } else {
        // 收起状态：Enter 直接发送（Shift+Enter 换行）
        if (!e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      }
    }
  };

  const saveEdit = async () => {
    if (!uiHook.editingMessageId) return;
    try {
      await messagesHook.editMessage(uiHook.editingMessageId, uiHook.editingText);
      uiHook.cancelEditing();
    } catch (e) {
      logger.error('Failed to save edit', e);
    }
  };

  // --- Dice helpers ---
  const openSendDice = (msg: Message) => {
    if (!isDM) return;
    uiHook.setDiceModalSourceMessage(msg);
    const allPlayers = members.filter((m) => m.role !== "dm").map((m) => m.user_id);
    uiHook.setDiceRecipientsSelection(allPlayers);
    uiHook.setDcValue("");
    uiHook.setAiDcReason("");
    uiHook.setShowDiceRecipientsModal(true);
  };

  const generateAiDc = async () => {
    if (!uiHook.diceModalSourceMessage) return;
    uiHook.setIsGeneratingDc(true);
    uiHook.setAiDcReason("");
    try {
      let response = await fetch(getApiEndpoint("/api/ai-settings/generate-dc"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: uiHook.diceModalSourceMessage.content,
          user_id: userId,
        }),
      });

      if (!response.ok && response.status === 404) {
        response = await fetch(getApiEndpoint("/api/ai-settings/generate-dc"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: uiHook.diceModalSourceMessage.content,
            user_id: "global",
          }),
        });
      }

      if (!response.ok) {
        throw new Error(`AI生成DC失败: ${response.status}`);
      }
      const data = await response.json();
      uiHook.setDcValue(String(data.dc || ""));
      uiHook.setAiDcReason(data.reason || "");
    } catch (error) {
      logger.error("AI生成DC失败", error);
      uiHook.setAiDcReason("AI生成失败，请手动设定DC");
    } finally {

      uiHook.setIsGeneratingDc(false);
    }
  };

  // AI分析检定类型
  const analyzeCheck = async () => {
    if (!uiHook.diceSceneDescription.trim()) return;
    uiHook.setIsAnalyzingCheck(true);
    uiHook.setAiCheckSuggestion(null);
    try {
      const requestBody: any = {
        description: uiHook.diceSceneDescription,
        user_id: userId,
      };
      // 与模组关联：传递 module_id 让后端用 RAG 搜索模组上下文
      if (uiHook.useModuleContext && selectedModule) {
        requestBody.module_id = selectedModule;
      }

      let response = await fetch(getApiEndpoint("/api/ai-settings/analyze-check"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok && response.status === 404) {
        response = await fetch(getApiEndpoint("/api/ai-settings/analyze-check"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...requestBody,
            user_id: "global",
          }),
        });
      }

      if (!response.ok) {
        throw new Error(`AI分析失败: ${response.status}`);
      }
      const data = await response.json();
      uiHook.setAiCheckSuggestion(data);
      // 自动填充检定类型（支持多个）
      const checks = data.checks.map((c: any) => ({
        type: c.check_type,
        ability: c.ability,
        skill: c.skill,
        dc: c.dc,
      }));
      uiHook.setSelectedCheckTypes(checks);
      uiHook.setAiDcReason(data.reason || "");
    } catch (error) {
      logger.error("AI分析检定失败", error);
      messagesHook.showToast("AI分析失败，请手动选择检定类型");
    } finally {
      uiHook.setIsAnalyzingCheck(false);
    }
  };

  // 确认新的发骰请求（从工具栏发起）
  const confirmNewDiceRequest = async () => {
    if (uiHook.selectedCheckTypes.length === 0) {
      messagesHook.showToast("请先选择检定类型");
      return;
    }
    if (uiHook.diceRecipientsSelection.length === 0) {
      messagesHook.showToast("请至少选择一个玩家");
      return;
    }

    // 为每个检定发送一个消息
    for (const checkType of uiHook.selectedCheckTypes) {
      // 构建检定描述
      const checkLabel = getCheckTypeLabel(checkType);
      const description = uiHook.diceSceneDescription.trim() || checkLabel;

      // 获取DC（优先使用检定自带的DC，否则使用手动输入的）
      let finalDc: number | undefined = checkType.dc;
      if (finalDc === undefined && uiHook.dcValue && !isNaN(Number(uiHook.dcValue))) {
        finalDc = Number(uiHook.dcValue);
      }

      // 构建检定对象
      const check = {
        type: checkType.type === "saving_throw" ? "save" : "check",
        ability: checkType.ability,
        skill: checkType.skill,
        dc: finalDc,
        dice: "1d20",
        description: description,
      };

	      const payload: WebSocketMessage = {
	        type: "dice_analyze",
	        data: {
	          message: description,
	          recipients: uiHook.diceRecipientsSelection,
	          timestamp: Date.now(),
	          is_private: uiHook.isPrivateRoll,
	          check,
	          ...(finalDc !== undefined ? { dc: finalDc } : {}),
	          ...(uiHook.diceRollModifier ? { roll_modifier: uiHook.diceRollModifier } : {}),
	        },
	      };

      sendMessage(payload);
    }

    // 关闭模态框并重置状态
    uiHook.setShowNewDiceModal(false);
    uiHook.setSelectedCheckTypes([]);
    uiHook.setDiceSceneDescription('');
    uiHook.setAiCheckSuggestion(null);
    uiHook.setDcValue("");
    uiHook.setAiDcReason("");
    uiHook.setDiceRollModifier(null);  // 重置优势/劣势
  };

  const confirmSendDice = async () => {
    if (!uiHook.diceModalSourceMessage) return;

    // 如果没有设置DC，自动调用AI生成
    let finalDc: number | undefined;
    if (uiHook.dcValue && !isNaN(Number(uiHook.dcValue))) {
      finalDc = Number(uiHook.dcValue);
    } else {
      // 自动生成DC
      uiHook.setIsGeneratingDc(true);
      try {
        let response = await fetch(getApiEndpoint("/api/ai-settings/generate-dc"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: uiHook.diceModalSourceMessage.content,
            user_id: userId,
          }),
        });

        if (!response.ok && response.status === 404) {
          response = await fetch(getApiEndpoint("/api/ai-settings/generate-dc"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              description: uiHook.diceModalSourceMessage.content,
              user_id: "global",
            }),
          });
        }

        if (response.ok) {
          const data = await response.json();
          finalDc = data.dc;
        }
      } catch (error) {
        logger.error("AI自动生成DC失败", error);
      } finally {
        uiHook.setIsGeneratingDc(false);
      }
    }

	    const payload: WebSocketMessage = {
	      type: "dice_analyze",
	      data: {
	        message: uiHook.diceModalSourceMessage.content,
	        recipients: uiHook.diceRecipientsSelection,
	        timestamp: Date.now(),
	        is_private: uiHook.isPrivateRoll,
	        ...(finalDc !== undefined ? { dc: finalDc } : {}),
	      },
	    };
    sendMessage(payload);
    uiHook.setShowDiceRecipientsModal(false);
    uiHook.setDiceModalSourceMessage(null);
    uiHook.setDcValue("");
    uiHook.setAiDcReason("");
  };

  const openRollOut = (msg: Message, check?: any) => {
    if (!isDM) {
      uiHook.setDiceExecuteLoading(msg.id);
      const reqId = (msg as any)?.meta?.diceRequest?.request_id as string | undefined;
      const isPriv = Boolean((msg as any)?.meta?.diceRequest?.is_private);
      executeDice(check, msg.content, undefined, reqId, isPriv);
      return;
    }
    uiHook.setDiceRollSource({ message: msg, check });
    uiHook.setActorSelection(null);
    loadMapTokens();
    uiHook.setShowActorSelectModal(true);
  };

  const fetchDiceActorSnapshot = useCallback(async (payload: WebSocketMessage<any>): Promise<DiceActorSnapshot | null> => {
    const actor = payload.data?.actor;
    let latestMapTokens = mapTokens;

    if (currentMapUrl) {
      try {
        const latestTokensPayload = await fetchCampaignMapTokensCached(campaignId, currentMapUrl, {
          userId,
          force: true,
          ttlMs: 0,
        });
        latestMapTokens = latestTokensPayload.tokens || [];
        setMapTokens(latestMapTokens);
      } catch (error) {
        logger.warn("Failed to refresh map tokens before dice roll", error);
      }
    }

    if (actor?.type === "monster" || actor?.monster_instance_id) {
      const monsterInstanceId = actor?.monster_instance_id
        ?? latestMapTokens.find((token) => token.id === actor?.token_id)?.monster_instance_id;
      const actorToken = latestMapTokens.find((token) =>
        token.id === actor?.token_id || token.monster_instance_id === monsterInstanceId,
      );
      if (!monsterInstanceId) return null;

      try {
        const response = await apiFetch(`/api/monster-instances/${monsterInstanceId}`, { userId });
        if (!response.ok) return null;
        const monster = await response.json();
        return {
          type: "monster",
          status_effects: monster?.status_effects,
          active_effects: actorToken?.active_effects,
          ability_scores: monster?.ability_scores,
          monster_data: monster?.monster_data,
        };
      } catch (error) {
        logger.error("Failed to load monster snapshot for dice roll", error);
        return null;
      }
    }

    const actorUserId = actor?.user_id || userId;
    const member = members.find((entry) => entry.user_id === actorUserId);
    const characterId = actor?.character_id ?? member?.selected_character_id;
    const actorToken = latestMapTokens.find((token) =>
      token.id === actor?.token_id || (characterId != null && token.character_id === characterId),
    );

    if (!characterId) {
      return member ? {
        type: "player",
        active_effects: actorToken?.active_effects,
        ability_scores: member.ability_scores,
        selected_skills: member.selected_skills || [],
        expertise_skills: member.expertise_skills || [],
        level: member.character_level,
      } : null;
    }

    try {
      const response = await apiFetch(`/api/characters/${characterId}`, { userId });
      if (!response.ok) {
        return member ? {
          type: "player",
          ability_scores: member.ability_scores,
          selected_skills: member.selected_skills || [],
          expertise_skills: member.expertise_skills || [],
          level: member.character_level,
        } : null;
      }
      const character = await response.json();
      return {
        type: "player",
        status_effects: character?.status_effects,
        active_effects: actorToken?.active_effects,
        ability_scores: character?.ability_scores,
        selected_skills: character?.selected_skills || [],
        expertise_skills: character?.expertise_skills || [],
        level: character?.level,
        class_id: character?.class_id,
      };
    } catch (error) {
      logger.error("Failed to load character snapshot for dice roll", error);
      return member ? {
        type: "player",
        active_effects: actorToken?.active_effects,
        ability_scores: member.ability_scores,
        selected_skills: member.selected_skills || [],
        expertise_skills: member.expertise_skills || [],
        level: member.character_level,
      } : null;
    }
  }, [campaignId, currentMapUrl, mapTokens, members, userId]);

  const prepareDiceExecutePayload = useCallback(async (payload: WebSocketMessage<any>) => {
    const check = payload.data?.check;
    if (!check) {
      return {
        payload,
        notation: payload.data?.check?.dice || "1d20",
        checkInfo: null as DiceCheckInfo | null,
      };
    }

    const actorSnapshot = await fetchDiceActorSnapshot(payload);
    const manualRollModifier: RollModifier =
      check.roll_modifier === "advantage" || check.roll_modifier === "disadvantage"
        ? check.roll_modifier
        : null;
    const autoResolution = resolveCheckRollModifierFromStatusEffects(
      actorSnapshot?.status_effects,
      check,
      actorSnapshot?.active_effects,
    );
    const autoRollModifier = autoResolution.rollModifier;
    const finalRollModifier = mergeRollModifiers(manualRollModifier, autoRollModifier);
    const manualReason = manualRollModifier
      ? `手动设置: ${manualRollModifier === "advantage" ? "优势" : "劣势"}`
      : null;
    const rollModifierReasons = finalRollModifier
      ? Array.from(new Set([
          ...(autoRollModifier === finalRollModifier ? autoResolution.reasons : []),
          ...(manualRollModifier === finalRollModifier && manualReason ? [manualReason] : []),
        ]))
      : [];

    const nextCheck = { ...check };
    if (finalRollModifier) {
      nextCheck.roll_modifier = finalRollModifier;
    } else {
      delete nextCheck.roll_modifier;
    }
    if (rollModifierReasons.length > 0) {
      nextCheck.roll_modifier_reasons = rollModifierReasons;
    } else {
      delete nextCheck.roll_modifier_reasons;
    }

    const preparedPayload = {
      ...payload,
      data: {
        ...payload.data,
        check: nextCheck,
      },
    };

    const skillName = nextCheck.skill ? getSkillName(nextCheck.skill) : null;
    const abilityName = nextCheck.ability ? getAbilityName(nextCheck.ability) : null;
    const label = nextCheck.description || skillName || abilityName || undefined;
    const isD20Check = String(nextCheck.dice || "1d20").toLowerCase().includes("d20");

    return {
      payload: preparedPayload,
      notation: finalRollModifier && isD20Check ? "2d20" : (nextCheck.dice || "1d20"),
      checkInfo: {
        modifier: computePreviewModifier(actorSnapshot, nextCheck),
        dc: typeof nextCheck.dc === "number" ? nextCheck.dc : undefined,
        label,
        rollMode: finalRollModifier,
      } satisfies DiceCheckInfo,
    };
  }, [fetchDiceActorSnapshot]);

  // 伙伴投骰：玩家为自己的伙伴/召唤物投骰
  const openCompanionRollOut = (msg: Message, check: any | undefined, companion: { monster_instance_id: number; name: string }) => {
    uiHook.setDiceExecuteLoading(msg.id);
    const reqId = (msg as any)?.meta?.diceRequest?.request_id as string | undefined;
    const isPriv = Boolean((msg as any)?.meta?.diceRequest?.is_private);
    const payload: WebSocketMessage<any> = {
      type: "dice_execute",
      data: {
        message: msg.content,
        timestamp: Date.now(),
        ...(check ? { check } : {}),
        ...(reqId ? { request_id: reqId } : {}),
        ...(typeof isPriv === "boolean" ? { is_private: isPriv } : {}),
        actor: {
          type: "monster",
          monster_instance_id: companion.monster_instance_id,
        },
      },
    };
    sendDiceExecute(payload);
  };

  // 发送 dice_execute，支持3D骰子模式
  const sendDiceExecute = useCallback(async (payload: WebSocketMessage<any>) => {
    const prepared = await prepareDiceExecutePayload(payload);

    if (enable3DDice) {
      setDice3DNotation(prepared.notation);
      setDice3DCheckInfo(prepared.checkInfo);
      setDice3DVisible(true);
      pendingDiceRollRef.current = { payloads: [prepared.payload] };
      return;
    }

    sendMessage(prepared.payload);
  }, [enable3DDice, prepareDiceExecutePayload, sendMessage]);

	  const executeDice = useCallback((
    check: any | undefined,
    original: string,
    actorUserId?: string,
    requestId?: string,
    isPrivate?: boolean
  ) => {
	    const payload: WebSocketMessage<any> = {
	      type: "dice_execute",
	      data: {
	        message: original,
	        timestamp: Date.now(),
	        ...(check ? { check } : {}),
	        ...(requestId ? { request_id: requestId } : {}),
	        ...(typeof isPrivate === "boolean" ? { is_private: isPrivate } : {}),
	      },
	    };
	    const resolvedActorUserId = actorUserId || (!isDM ? userId : undefined);
	    if (resolvedActorUserId) {
	      if (resolvedActorUserId.startsWith("monster-")) {
        const tokenId = parseInt(resolvedActorUserId.replace("monster-", ""));
        const token = mapTokens.find((t) => t.id === tokenId);
        if (token && token.monster_instance_id) {
	          payload.data.actor = {
            type: "monster",
            token_id: token.id,
            monster_instance_id: token.monster_instance_id,
          };
        }
      } else {
	        const member = members.find((entry) => entry.user_id === resolvedActorUserId);
	        const actor: Record<string, unknown> = { type: "player", user_id: resolvedActorUserId };
	        if (member?.selected_character_id) {
            actor.character_id = member.selected_character_id;
            const token = mapTokens.find((entry) => entry.character_id === member.selected_character_id);
            if (token) {
              actor.token_id = token.id;
            }
          }
	        payload.data.actor = actor;
      }
    }
    sendDiceExecute(payload);
  }, [userId, isDM, mapTokens, members, sendDiceExecute]);

  // Helper to get proxy actor display name
  const getProxyActorName = useCallback((actorId: string): string => {
    if (actorId.startsWith("monster-")) {
      const tokenId = parseInt(actorId.replace("monster-", ""));
      const token = mapTokens.find((t) => t.id === tokenId);
      return token?.instance_name || token?.monster_name || "怪物";
    } else {
      const member = members.find((m) => m.user_id === actorId);
      return member?.character_name || actorId;
    }
  }, [mapTokens, members]);

  // Quick dice roll from bottom bar - uses lightweight dice_quick message
  const handleQuickDiceRoll = useCallback((diceName: string, sides: number) => {
    if (!isConnected) return;

    // Set rolling state for animation
    setRollingDice(diceName);

    // For DM with proxy actors selected, roll for each actor
    const proxyIds = isDM && uiHook.proxyActorIds.length > 0 ? uiHook.proxyActorIds : [undefined];
    const isPrivateRoll = isDM && uiHook.proxyPrivateRoll;

    // Show toast feedback
    if (isDM && uiHook.proxyActorIds.length > 0) {
      const names = uiHook.proxyActorIds.map(id => getProxyActorName(id)).join(", ");
      const privateLabel = isPrivateRoll ? " (暗投)" : "";
      messagesHook.showToast(`🎲 代替 ${names} 投掷 ${diceName}${privateLabel}...`);
    } else {
      messagesHook.showToast(`🎲 正在投掷 ${diceName}...`);
    }

    // Build payloads for each proxy actor
    const payloads: WebSocketMessage[] = proxyIds.map(proxyId => {
      const actorName = proxyId ? getProxyActorName(proxyId) : undefined;
      let actorCharacterId: number | undefined;
      if (proxyId && !proxyId.startsWith("monster-")) {
        const member = members.find(m => m.user_id === proxyId);
        actorCharacterId = member?.selected_character_id;
      }
      return {
        type: "dice_quick",
        data: {
          dice: `1d${sides}`,
          is_private: isPrivateRoll,
          actor_id: proxyId,
          actor_name: actorName,
          actor_character_id: actorCharacterId,
          timestamp: Date.now(),
        },
      } as WebSocketMessage;
    });

    // 3D骰子开启时：先播动画，等物理结果后再发送
    if (enable3DDice) {
      setDice3DNotation(`1d${sides}`);
      setDice3DCheckInfo(null);
      setDice3DVisible(true);
      pendingDiceRollRef.current = { payloads };
    } else {
      // 3D关闭：立即发送
      payloads.forEach(p => sendMessage(p));
    }

    // Clear rolling state after animation
    setTimeout(() => {
      setRollingDice(null);
    }, 600);
  }, [isConnected, messagesHook, isDM, uiHook.proxyActorIds, uiHook.proxyPrivateRoll, userId, sendMessage, getProxyActorName, enable3DDice, members]);

  // --- DM: Grant Rest buttons ---
  const handleGrantRest = (restType: 'short' | 'long') => {
    if (!isDM) return;
	    sendMessage({
	      type: 'rest_grant',
	      data: {
	        rest_type: restType,
	        timestamp: Date.now(),
	      },
	    });
    setShowGrantMenu(false);
  };

  // --- DM: Grant XP ---
  const handleGrantXP = (data: {
    recipients: number[];
    amount: number;
    source: string;
    description: string;
    is_private: boolean;
  }) => {
    if (!isDM) return;
	    sendMessage({
	      type: 'reward_grant',
	      data: {
	        reward_type: 'xp',
	        ...data,
	        timestamp: Date.now(),
	      },
	    });
    setShowXPModal(false);
    setShowGrantMenu(false);
    logger.info('Granted XP:', data);
  };

  // --- DM: Grant Currency ---
  const handleGrantCurrency = (data: {
    recipients: (number | string)[];
    currency_changes: any;
    source: string;
    description: string;
    is_private: boolean;
  }) => {
    if (!isDM) return;
	    sendMessage({
	      type: 'reward_grant',
	      data: {
	        reward_type: 'currency',
	        ...data,
	        timestamp: Date.now(),
	      },
	    });
    setShowCurrencyModal(false);
    setShowGrantMenu(false);
    logger.info('Granted currency:', data);
  };

  // Generate combat narrative on demand
  const handleGenerateNarrative = useCallback(async (msgId: string, dbId?: number) => {
    if (!dbId) return;
    setNarrativeLoadingIds((prev) => new Set(prev).add(msgId));
    try {
      const params = new URLSearchParams({
        user_id: userId || 'anonymous',
        role: isDM ? 'dm' : 'player'
      });
      const res = await fetch(getApiEndpoint(`/api/combat/generate-narrative?${params}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_message_id: dbId, campaign_id: Number(campaignId) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Failed to generate narrative:', err);
      }
    } catch (e) {
      console.error('Failed to generate narrative:', e);
    } finally {
      setNarrativeLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(msgId);
        return next;
      });
    }
  }, [campaignId, userId, isDM]);

  // Request narrative for a dice result
  const requestNarrative = useCallback((messageId: string | number) => {
    setNarrativeLoadingId(messageId);
	    sendMessage({
	      type: 'dice_narrative',
	      data: { message_id: messageId, timestamp: Date.now() },
	    });
    logger.info('Requesting narrative for message:', messageId);
	  }, [sendMessage]);

  // Player takes rest from a message button
  const takeRestFromMessage = async (msg: Message, restType: 'short' | 'long', targetCharId?: number, targetUserId?: string, targetCharName?: string) => {
    try {
      let charId = targetCharId;
      let charUserId = targetUserId || userId;
      let characterName = targetCharName || '未知角色';

      if (!charId) {
        // Self rest: find own character
        const me = members.find(m => m.user_id === userId && m.role === 'player')
                 || members.find(m => m.user_id === userId && m.selected_character_id);
        charId = me?.selected_character_id;
        charUserId = userId;
        if (!charId) {
          messagesHook.showToast('未找到你的角色，无法执行休息');
          return;
        }
        const pendingChars = (msg.meta as any)?.pending_characters || [];
        const myChar = pendingChars.find((c: any) => c.user_id === userId);
        characterName = myChar?.name || me?.character_name || '未知角色';
      }

      // Check if already claimed
      const claimedBy = (msg.meta as any)?.claimed_by || [];
      if (claimedBy.includes(charUserId)) {
        messagesHook.showToast('该角色已经执行过这次休息了');
        return;
      }

      setRestProcessingMsgId(msg.id);
      const res = await fetch(getApiEndpoint(`/api/characters/${charId}/rest`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rest_type: restType, campaign_id: Number(campaignId) }),
      });
      if (!res.ok) throw new Error(`rest failed ${res.status}`);
      const data = await res.json();
      const compInfo = Array.isArray(data.companion_healed) && data.companion_healed.length > 0
        ? `，${data.companion_healed.map((c: any) => `${c.name} HP→${c.current_hp}/${c.max_hp}`).join('，')}`
        : '';
      messagesHook.showToast(`${characterName} ${restType === 'long' ? '长休' : '短休'}完成（HP → ${data?.current_hp}/${data?.max_hp}）${compInfo}`);

      // Send claim message (use target user_id so claimed_by tracks correctly)
      sendMessage({
        type: 'rest_claim',
        data: {
          message_id: msg.dbId,
          claim_user_id: charUserId,
          rest_result: {
            character_name: characterName,
            healed: data.healed,
            current_hp: data.current_hp,
            max_hp: data.max_hp,
            hit_die: data.hit_die,
            con_mod: data.con_mod,
            companion_healed: data.companion_healed || [],
          },
        }
	      });

      if (typeof window !== 'undefined') {
        try {
          if (restType === 'long') {
            const charLevel = data?.level;
            if (typeof charLevel === 'number' && charLevel > 0) {
              const prepareKey = `dnd_spell_prepare_v1_${charId}_L${charLevel}`;
              window.localStorage.setItem(prepareKey, JSON.stringify({ canPrepareSpells: true }));
            }
          }
        } catch (err) {
          logger.error('Failed to update spell prepare state after rest', err);
        }

        publishAppEvent("restGrant", {
          restType,
          source: "chat-takeRestFromMessage",
          characterId: charId,
          apiResponse: data,
        });
      }

      publishAppEvent("openRightPanelTab", { tab: "chat" });
    } catch (e) {
      logger.error('takeRest failed', e);
      messagesHook.showToast('执行休息失败');
    } finally {
      setRestProcessingMsgId(null);
    }
  };

  // Player claims a pending reward from a message
  const claimRewardFromMessage = async (msg: Message, targetCharId?: number, targetUserId?: string) => {
    try {
      let charId = targetCharId;
      let charUserId = targetUserId || userId;

      if (!charId) {
        // Self claim: find own character
        const me = members.find(m => m.user_id === userId && m.role === 'player')
                 || members.find(m => m.user_id === userId && m.selected_character_id);
        charId = me?.selected_character_id;
        charUserId = userId;
        if (!charId) {
          messagesHook.showToast('未找到你的角色，无法领取奖励');
          return;
        }
      }
      setRewardClaimingMsgId(msg.id);

      // Send claim via WebSocket
      sendMessage({
        type: 'reward_claim',
        data: {
          message_id: msg.dbId,
          character_id: charId,
          claim_user_id: charUserId,
        }
	      });

      // The actual update will come back via reward_claimed WebSocket message
      messagesHook.showToast('领取请求已发送');
    } catch (e) {
      logger.error('claimReward failed', e);
      messagesHook.showToast('领取奖励失败');
    } finally {
      setRewardClaimingMsgId(null);
    }
  };

  // Generate extra effect for critical hit or fumble
  const generateExtraEffect = async (msg: Message, effectType: 'critical' | 'fumble') => {
    const meta = msg.meta as any;
    if (!meta) return;

    try {
      setExtraEffectLoadingMsgId(msg.id);
      const res = await apiFetch(`/api/combat/extra-effect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          effect_type: effectType,
          attacker_name: meta.attacker_name || '攻击者',
          target_name: meta.target_name || '目标',
          attack_name: meta.attack_roll?.dice || '攻击',
          damage_dealt: meta.damage_dealt || 0,
          campaign_id: Number(campaignId),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `API error ${res.status}`);
      }
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || '生成失败');
      }
      // Effect will be broadcast via WebSocket, no need to update local state
      messagesHook.showToast(`${effectType === 'critical' ? '暴击奖励' : '大失败惩罚'}已生成`);
    } catch (e) {
      logger.error('generateExtraEffect failed', e);
      messagesHook.showToast(`生成${effectType === 'critical' ? '暴击奖励' : '大失败惩罚'}失败`);
    } finally {
      setExtraEffectLoadingMsgId(null);
    }
  };

  const loadMapTokens = async () => {
    if (!currentMapUrl) return;
    try {
      const data = await fetchCampaignMapTokensCached(campaignId, currentMapUrl, { userId });
      setMapTokens(data.tokens || []);
    } catch (e) {
      logger.error("加载地图Token失败", e);
    }
  };

  // 在骰子模式激活时加载 tokens（用于显示怪物头像）
  // 玩家首次加载也需要 tokens（用于伙伴投骰按钮）
  useEffect(() => {
    if (isDiceMode || !isDM) {
      loadMapTokens();
    }
  }, [isDiceMode, currentMapUrl]);

  const confirmActorRoll = () => {
    if (!uiHook.diceRollSource) return;
    const reqId = (uiHook.diceRollSource.message as any)?.meta?.diceRequest?.request_id as string | undefined;
    const isPriv = Boolean((uiHook.diceRollSource.message as any)?.meta?.diceRequest?.is_private);
    uiHook.setDiceExecuteLoading(uiHook.diceRollSource.message.id);
    executeDice(
      uiHook.diceRollSource.check,
      uiHook.diceRollSource.message.content,
      uiHook.actorSelection || undefined,
      reqId,
      isPriv
    );
    uiHook.setShowActorSelectModal(false);
    uiHook.setDiceRollSource(null);
  };

  const deleteMessageById = async (id: number) => {
    // First click: show confirmation
    if (uiHook.pendingDeleteId !== id) {
      uiHook.setPendingDeleteId(id);
      // Auto-reset after 3 seconds
      const currentId = id;
      setTimeout(() => {
        // Only reset if still the same pending id
        if (uiHook.pendingDeleteId === currentId) {
          uiHook.setPendingDeleteId(null);
        }
      }, 3000);
      return;
    }

    // Second click: actually delete
    try {
      await chatService.deleteMessage(campaignId, id);
      uiHook.setPendingDeleteId(null);
      // Remove from local state immediately
      messagesHook.deleteMessage(String(id));
      setAiAssistantMessages(prev => prev.filter(m => m.dbId !== id));
    } catch (e) {
      logger.error('Delete failed', e);
    }
  };

  const clearChat = async () => {
    if (!isDM) return;
    const ok = window.confirm("确定要清空聊天室消息吗？此操作不可撤销，AI 助手历史会保留。");
    if (!ok) return;
    try {
      const res = await apiFetch(`/api/campaigns/${campaignId}/chat/messages?preserve_ai=true`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`清空失败: ${res.status}`);
      messagesHook.showToast("已清空聊天室消息，AI助手历史已保留");
    } catch (e) {
      logger.error('Clear chat failed', e);
    }
  };

  const clearDiceResults = async () => {
    if (!isDM) return;
    const ok = window.confirm("确定要清空所有骰子结果吗？此操作不可撤销。");
    if (!ok) return;
    try {
      const res = await apiFetch(`/api/dice-rolls/campaign/${campaignId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`清空失败: ${res.status}`);
      setDiceRolls([]);
      messagesHook.showToast("已清空骰子结果");
    } catch (e) {
      logger.error('Clear dice failed', e);
    }
  };

  return (
    <>
      <div className="flex-1 min-h-0 flex flex-col">

      {/* Tab bar: only rendered when not controlled from parent (e.g. standalone usage) */}
      {!chatModeProp && (
      <div className="flex border-b border-gray-700/40 bg-gray-900/50 shrink-0">
        <button
          onClick={() => setChatMode('chatroom')}
          className={`flex-1 py-1.5 text-xs font-medium text-center transition-all relative ${
            chatMode === 'chatroom' ? 'text-amber-400' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          聊天室
          {chatMode === 'chatroom' && <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-amber-400 rounded-full" />}
        </button>
        <button
          onClick={() => setChatMode('ai-assistant')}
          className={`flex-1 py-1.5 text-xs font-medium text-center transition-all relative ${
            chatMode === 'ai-assistant' ? 'text-emerald-400' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          AI 助手
          {chatMode === 'ai-assistant' && <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-emerald-400 rounded-full" />}
        </button>
      </div>
      )}

      {/* Main content: sidebar + content area */}
      <div className="flex-1 min-h-0 flex flex-row">
        {/* Left sidebar filter icons - always visible, clicking switches to chatroom */}
        <div className="w-9 shrink-0 flex flex-col items-center py-1.5 gap-0.5 border-r border-gray-700/30 bg-gray-900/40 overflow-y-auto scrollbar-none">
          {/* All messages */}
          <button
            onClick={() => {
              if (chatMode !== 'chatroom') setChatMode('chatroom');
              setSidebarFilter('all');
              uiHook.setSelectedRecipients([]);
            }}
            title="全部"
            className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold transition-all ${
              chatMode === 'chatroom' && sidebarFilter === 'all'
                ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
          >
            全
          </button>
          {/* AI messages */}
          <div className="relative group/pop">
          <button
            onClick={() => {
              setChatMode('ai-assistant');
            }}
            title="AI助手"
            className={`w-7 h-7 rounded-md flex items-center justify-center text-xs transition-all ${
              chatMode === 'ai-assistant'
                ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
          >
            🤖
          </button>
          <button className="hidden md:flex absolute -right-1 -top-1 w-3.5 h-3.5 items-center justify-center rounded-full bg-gray-700/90 text-[7px] text-gray-400 opacity-0 group-hover/pop:opacity-100 transition-opacity hover:bg-emerald-600 hover:text-white z-10 border border-gray-600/50"
            onClick={(e) => { e.stopPropagation(); openFilterPanel('ai', 'AI 助手', '🤖'); }} title="弹出为浮动窗口">↗</button>
          </div>
          {/* Divider */}
          <div className="w-5 h-px bg-gray-700/40 my-0.5" />
          {/* Player avatars */}
          {members.filter(m => m.selected_character_id).map(m => {
            const isActive = chatMode === 'chatroom' && sidebarFilter === `user-${m.user_id}`;
            const displayName = m.character_name || m.user_id.slice(0, 8);
            const isVirtual = m.is_virtual;
            return (
              <div key={m.user_id} className="relative group/pop">
              <button
                onClick={() => {
                  if (chatMode !== 'chatroom') setChatMode('chatroom');
                  setSidebarFilter(`user-${m.user_id}`);
                  if (!isVirtual) {
                    uiHook.setSelectedRecipients([m.user_id]);
                  } else {
                    uiHook.setSelectedRecipients([]);
                  }
                }}
                title={displayName}
                className={`w-7 h-7 rounded-md flex items-center justify-center text-[10px] transition-all overflow-hidden ${
                  isActive
                    ? 'ring-1 ring-amber-500/30 bg-amber-500/15'
                    : 'hover:bg-gray-800/50 opacity-70 hover:opacity-100'
                }`}
              >
                {m.avatar ? (
                  <img src={m.avatar} alt={displayName} className="w-full h-full object-cover rounded-md" />
                ) : (
                  <span className="text-blue-400">{displayName.slice(0, 2)}</span>
                )}
              </button>
              <button className="hidden md:flex absolute -right-1 -top-1 w-3.5 h-3.5 items-center justify-center rounded-full bg-gray-700/90 text-[7px] text-gray-400 opacity-0 group-hover/pop:opacity-100 transition-opacity hover:bg-amber-600 hover:text-white z-10 border border-gray-600/50"
                onClick={(e) => { e.stopPropagation(); openFilterPanel(`user-${m.user_id}`, displayName, '👤'); }} title="弹出为浮动窗口">↗</button>
              </div>
            );
          })}
          {/* Divider */}
          <div className="w-5 h-px bg-gray-700/40 my-0.5" />
          {/* Chat messages filter */}
          <div className="relative group/pop">
          <button
            onClick={() => {
              if (chatMode !== 'chatroom') setChatMode('chatroom');
              setSidebarFilter('chat-only');
              uiHook.setSelectedRecipients([]);
            }}
            title="聊天消息"
            className={`w-7 h-7 rounded-md flex items-center justify-center text-xs transition-all ${
              chatMode === 'chatroom' && sidebarFilter === 'chat-only'
                ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
          >
            💬
          </button>
          <button className="hidden md:flex absolute -right-1 -top-1 w-3.5 h-3.5 items-center justify-center rounded-full bg-gray-700/90 text-[7px] text-gray-400 opacity-0 group-hover/pop:opacity-100 transition-opacity hover:bg-amber-600 hover:text-white z-10 border border-gray-600/50"
            onClick={(e) => { e.stopPropagation(); openFilterPanel('chat-only', '聊天消息', '💬'); }} title="弹出为浮动窗口">↗</button>
          </div>
          {/* Dice messages filter (发骰筛选) */}
          <div className="relative group/pop">
          <button
            onClick={() => {
              if (chatMode !== 'chatroom') setChatMode('chatroom');
              setSidebarFilter('dice-filter');
              uiHook.setSelectedRecipients([]);
            }}
            title="骰子消息"
            className={`w-7 h-7 rounded-md flex items-center justify-center text-xs transition-all ${
              chatMode === 'chatroom' && sidebarFilter === 'dice-filter'
                ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
          >
            🎲
          </button>
          <button className="hidden md:flex absolute -right-1 -top-1 w-3.5 h-3.5 items-center justify-center rounded-full bg-gray-700/90 text-[7px] text-gray-400 opacity-0 group-hover/pop:opacity-100 transition-opacity hover:bg-amber-600 hover:text-white z-10 border border-gray-600/50"
            onClick={(e) => { e.stopPropagation(); openFilterPanel('dice-filter', '骰子消息', '🎲'); }} title="弹出为浮动窗口">↗</button>
          </div>
          {/* System messages */}
          <div className="relative group/pop">
          <button
            onClick={() => {
              if (chatMode !== 'chatroom') setChatMode('chatroom');
              setSidebarFilter('system');
              uiHook.setSelectedRecipients([]);
            }}
            title="系统消息"
            className={`w-7 h-7 rounded-md flex items-center justify-center text-xs transition-all ${
              chatMode === 'chatroom' && sidebarFilter === 'system'
                ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
          >
            📢
          </button>
          <button className="hidden md:flex absolute -right-1 -top-1 w-3.5 h-3.5 items-center justify-center rounded-full bg-gray-700/90 text-[7px] text-gray-400 opacity-0 group-hover/pop:opacity-100 transition-opacity hover:bg-amber-600 hover:text-white z-10 border border-gray-600/50"
            onClick={(e) => { e.stopPropagation(); openFilterPanel('system', '系统消息', '📢'); }} title="弹出为浮动窗口">↗</button>
          </div>
          {/* Combat messages */}
          <div className="relative group/pop">
          <button
            onClick={() => {
              if (chatMode !== 'chatroom') setChatMode('chatroom');
              setSidebarFilter('combat');
              uiHook.setSelectedRecipients([]);
            }}
            title="战斗消息"
            className={`w-7 h-7 rounded-md flex items-center justify-center text-xs transition-all ${
              chatMode === 'chatroom' && sidebarFilter === 'combat'
                ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
          >
            ⚔️
          </button>
          <button className="hidden md:flex absolute -right-1 -top-1 w-3.5 h-3.5 items-center justify-center rounded-full bg-gray-700/90 text-[7px] text-gray-400 opacity-0 group-hover/pop:opacity-100 transition-opacity hover:bg-amber-600 hover:text-white z-10 border border-gray-600/50"
            onClick={(e) => { e.stopPropagation(); openFilterPanel('combat', '战斗消息', '⚔️'); }} title="弹出为浮动窗口">↗</button>
          </div>
          {/* Spacer to push dice to bottom */}
          <div className="flex-1" />
          {/* Dice mode */}
          <button
            onClick={() => {
              if (chatMode !== 'chatroom') setChatMode('chatroom');
              setSidebarFilter('dice');
              uiHook.setSelectedRecipients([]);
            }}
            title="骰子"
            className={`w-7 h-7 rounded-md flex items-center justify-center text-xs transition-all ${
              chatMode === 'chatroom' && isDiceMode
                ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
          >
            🎲
          </button>
        </div>

        {/* Right content area */}
        <div className="flex-1 min-w-0 flex flex-col">

      {/* AI Assistant mode */}
      {chatMode === 'ai-assistant' ? (
        <AIAssistantView
          messages={aiAssistantMessages}
          loading={aiAssistantLoading}
          hasMore={aiAssistantHasMore}
          onLoadMore={() => loadAiAssistantMessages(false)}
          onSend={handleAISend}
          aiTyping={aiHook.aiTyping}
          aiStreamingContent={aiHook.aiStreamingContent}
          isAiStreaming={aiHook.isAiStreaming}
          aiError={aiHook.aiError}
          userId={userId}
          isDM={isDM}
          formatTime={formatTime}
          renderTtsButton={renderTtsButton}
          onDelete={deleteMessageById}
          pendingDeleteId={uiHook.pendingDeleteId}
          campaignId={campaignId}
          aiSessions={aiSessions}
          currentAiSessionId={currentAiSessionId}
          onSessionChange={(id) => setCurrentAiSessionId(id)}
          onSessionsUpdate={(sessions) => setAiSessions(sessions)}
        />
      ) : (
      <>
      {/* Chat content (non-dice mode) */}
      {!isDiceMode && (
        <div className="relative flex-1 flex flex-col overflow-hidden animate-fade-in">
        {/* 顶部工具栏：搜索框 + 清空按钮（点击底部放大镜展开） */}
        {showSearchBar && (
        <>
        <div className="flex items-center gap-1.5 px-2 py-1 border-b border-gray-800/40 bg-gray-900/40">
          <div className="flex-1 relative">
            <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input
              type="text"
              value={searchHook.searchQuery}
              onChange={(e) => {
                const value = e.target.value;
                searchHook.setSearchQuery(value);
                if (value) {
                  searchHook.performSearch(value);
                }
              }}
              placeholder="搜索聊天记录..."
              autoFocus
              className="w-full pl-7 pr-3 py-1 text-xs bg-gray-800/60 border border-gray-700/40 rounded-md text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500/40 transition-all"
            />
            {searchHook.searchQuery && (
              <button
                onClick={() => {
                  searchHook.setSearchQuery('');
                  searchHook.clearSearch();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
              >
                ✕
              </button>
            )}
          </div>
          {/* 筛选按钮 - 全部模式和聊天模式下显示 */}
          {(sidebarFilter === 'all' || sidebarFilter === 'chat-only') && (
          <div className="relative shrink-0" ref={filterMenuRef}>
            <button
              onClick={() => setShowFilterMenu(!showFilterMenu)}
              className={`p-1.5 rounded-lg text-xs shrink-0 transition-all ${
                (sidebarFilter === 'all' && hiddenTypes.length > 0) || (sidebarFilter === 'chat-only' && hiddenUsers.length > 0)
                  ? 'text-amber-400 bg-amber-500/15 border border-amber-500/30'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 border border-transparent'
              }`}
              title="筛选消息"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M3 4h18M6 8h12M9 12h6M11 16h2"/></svg>
            </button>
            {showFilterMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-2 max-h-[300px] overflow-y-auto">
                {sidebarFilter === 'all' ? (
                  <>
                    <div className="px-3 py-1 text-[10px] text-gray-500 uppercase tracking-wider">显示/隐藏消息类型</div>
                    {[
                      { key: 'chat', label: '💬 聊天消息' },
                      { key: 'dice', label: '🎲 骰子消息' },
                      { key: 'combat', label: '⚔️ 战斗消息' },
                      { key: 'system', label: '📢 系统消息' },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!hiddenTypes.includes(key)}
                          onChange={() => toggleHiddenType(key)}
                          className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-amber-500 focus:ring-amber-500/30 focus:ring-offset-0 cursor-pointer"
                        />
                        <span className="text-xs text-gray-300">{label}</span>
                      </label>
                    ))}
                    {hiddenTypes.length > 0 && (
                      <>
                        <div className="border-t border-gray-700 my-1" />
                        <button
                          onClick={() => setHiddenTypes([])}
                          className="w-full px-3 py-1.5 text-left text-xs text-amber-400 hover:bg-gray-700/50"
                        >
                          重置筛选
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <div className="px-3 py-1 text-[10px] text-gray-500 uppercase tracking-wider">显示/隐藏玩家消息</div>
                    {members.map(m => {
                      const name = m.character_name || m.user_id.slice(0, 8);
                      return (
                        <label key={m.user_id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700/50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!hiddenUsers.includes(m.user_id)}
                            onChange={() => toggleHiddenUser(m.user_id)}
                            className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-amber-500 focus:ring-amber-500/30 focus:ring-offset-0 cursor-pointer"
                          />
                          <span className="text-xs text-gray-300 flex items-center gap-1.5">
                            {m.avatar ? (
                              <img src={m.avatar} alt={name} className="w-4 h-4 rounded-full object-cover" />
                            ) : null}
                            {name}
                            {m.role === 'dm' && <span className="text-[10px] text-amber-500/70">DM</span>}
                          </span>
                        </label>
                      );
                    })}
                    {hiddenUsers.length > 0 && (
                      <>
                        <div className="border-t border-gray-700 my-1" />
                        <button
                          onClick={() => setHiddenUsers([])}
                          className="w-full px-3 py-1.5 text-left text-xs text-amber-400 hover:bg-gray-700/50"
                        >
                          重置筛选
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          )}
          {isDM && (
            <button onClick={clearChat} className="p-1.5 rounded-lg text-xs text-red-400/60 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all shrink-0" title="清空聊天室消息（保留AI助手历史）">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          )}
        </div>

        {/* 搜索结果显示 */}
        {searchHook.searchQuery && (
          <div className="px-4 py-2 bg-gray-800/50 border-b border-gray-700/50 max-h-[200px] overflow-y-auto">
            {searchHook.isSearching ? (
              <div className="text-xs text-gray-400">搜索中...</div>
            ) : searchHook.searchResults.length === 0 ? (
              <div className="text-xs text-gray-500">未找到匹配的消息</div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs text-gray-500">找到 {searchHook.searchResults.length} 条消息</div>
                {searchHook.searchResults.slice(0, 5).map((msg) => (
                  <div key={msg.id} className="bg-gray-900/50 rounded p-2 border border-gray-700/50 text-xs flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="font-semibold text-blue-400">{msg.user}</span>
                        <span className="text-[10px] text-gray-500">{formatTime(msg.timestamp)}</span>
                      </div>
                      <div className="text-gray-300 line-clamp-2">
                        {msg.content}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        // 先保存要跳转的消息ID
                        const targetId = msg.id;
                        // 先清空搜索（关闭搜索结果区域）
                        searchHook.setSearchQuery('');
                        // 延迟执行滚动，等待 DOM 更新后再滚动
                        setTimeout(() => scrollToMessage(targetId), 50);
                      }}
                      className="shrink-0 px-2 py-1 text-[10px] bg-amber-600/20 hover:bg-amber-600/40 text-amber-400 rounded transition-colors"
                      title="跳转到该消息"
                    >
                      跳转
                    </button>
                  </div>
                ))}
                {searchHook.searchResults.length > 5 && (
                  <div className="text-[10px] text-gray-500 text-center">还有 {searchHook.searchResults.length - 5} 条结果...</div>
                )}
              </div>
            )}
          </div>
        )}
        </>
        )}

      {/* 消息列表 */}
      <div ref={listRef} onScroll={handleScroll} className={`flex-1 overflow-y-auto px-3 py-3 space-y-2 transition-opacity duration-200 ${isFilteredMode || messagesHook.isReady ? 'opacity-100' : 'opacity-0'}`}>
        {isFilteredMode ? (
          /* 筛选模式：使用后端加载的筛选消息 */
          <>
            {filteredHasMore && (
              <div className="flex justify-center">
                <button
                  onClick={() => loadFilteredMessages()}
                  disabled={filteredLoading}
                  className="text-xs px-4 py-1.5 border border-gray-600/40 rounded-lg hover:bg-gray-700/50 hover:border-gray-500/50 disabled:opacity-50 text-gray-400 transition-all"
                >
                  {filteredLoading ? "加载中..." : "加载更多"}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {messagesHook.hasMore && (
              <div className="flex justify-center">
                <button
                  onClick={() => messagesHook.loadHistory()}
                  disabled={messagesHook.loadingHistory}
                  className="text-xs px-4 py-1.5 border border-gray-600/40 rounded-lg hover:bg-gray-700/50 hover:border-gray-500/50 disabled:opacity-50 text-gray-400 transition-all"
                >
                  {messagesHook.loadingHistory ? "加载中..." : "加载更多"}
                </button>
              </div>
            )}
          </>
        )}
        {(isFilteredMode ? filteredMessages : messagesHook.messages)
          .slice()
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
          .filter((msg) => {
            if (msg.isDeleted) return false;
            // Hide current player's AI conversation in chatroom (dedicated AI assistant tab exists)
            if (sidebarFilter !== 'ai') {
              if (msg.senderRole === 'ai' || msg.user === 'AI' || (msg.senderUserId === userId && !!msg.recipients?.includes('ai'))) return false;
            }
            // Dropdown exclude filter (checkbox-based) only applies in 'all' mode
            if (hiddenTypes.length > 0 && sidebarFilter === 'all') {
              let msgType = msg.type === 'combat' ? 'combat' : msg.type === 'system' ? 'system' : msg.type === 'dice' ? 'dice' : 'chat';
              // Reclassify chat messages that are actually dice rolls or spell casts
              if (msgType === 'chat' && msg.content) {
                if (msg.content.startsWith('🎲')) msgType = 'dice';
                else if (msg.content.startsWith('🔮')) msgType = 'system';
              }
              if (hiddenTypes.includes(msgType)) return false;
            }
            // Exclude old combat messages loaded from DB with type='chat'
            if (sidebarFilter === 'chat-only' && msg.content) {
              const c = msg.content;
              if (c.startsWith('🔮') || c.startsWith('⚔️') || c.startsWith('🛡️') || c.startsWith('💨') || c.startsWith('🌀')) return false;
            }
            // Player exclude filter only applies in 'chat-only' mode
            if (hiddenUsers.length > 0 && sidebarFilter === 'chat-only') {
              if (msg.senderUserId && hiddenUsers.includes(msg.senderUserId)) return false;
            }
            return true;
          })
          .map((msg) => (
          <div
            key={msg.id}
            id={`chat-msg-${msg.id}`}
            className={`group/msg rounded-lg transition-colors duration-150 ${
              msg.type === "system"
                ? "text-gray-500 text-sm px-3 py-1.5 bg-gray-800/20"
                : msg.type === "combat"
                ? "bg-red-950/30 border border-red-500/20 p-3 hover:border-red-500/35"
                : msg.type === "dice"
                ? "bg-gray-800/30 border border-amber-500/10 p-3 hover:border-amber-500/25"
                : "bg-gray-800/25 border border-gray-700/30 p-3 hover:bg-gray-800/40 hover:border-gray-600/40"
            }`}
          >
            {msg.type !== "system" && (
              <div className="flex items-start gap-2">
                {/* Avatar */}
                <div className="shrink-0 hidden sm:block">
                  {(() => {
                    const isSystemCombatMessage = msg.type === "combat" && msg.senderRole === "system" && msg.user === "DM";
                    // For dice messages with actor_name (DM proxy), show actor's avatar
                    const diceRoll = (msg.meta as any)?.diceRoll;
                    const actorName = diceRoll?.actor_name;
                    const actorAvatarUrl = diceRoll?.actor_avatar_url;
                    const actorUserId = diceRoll?.actor_user_id;
                    const isDMProxy = msg.senderRole === "dm" && actorName && actorName !== "DM";

                    if (isDMProxy) {
                      // Use actor_avatar_url if available (for monsters or characters with avatar)
                      if (actorAvatarUrl) {
                        return <img src={actorAvatarUrl} alt={actorName} className="w-8 h-8 rounded-full object-cover" />;
                      }
                      // Find member by character name OR user_id for proxy rolls
                      const actorMember = members.find(m =>
                        m.role === "player" && (m.character_name === actorName || m.user_id === actorUserId)
                      );
                      if (actorMember?.avatar) {
                        return <img src={actorMember.avatar} alt={actorName} className="w-8 h-8 rounded-full object-cover" />;
                      }
                      // Player without avatar - show blue avatar with initials
                      if (actorMember) {
                        const displayName = actorMember.character_name || actorName;
                        return <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-xs">{displayName.slice(0, 2)}</div>;
                      }
                      // Monster or unknown - show red avatar with initials
                      return <div className="w-8 h-8 rounded-full bg-red-700 flex items-center justify-center text-xs">{actorName.slice(0, 2)}</div>;
                    }

                    const avatar = getUserAvatar(msg.senderUserId || "", msg.senderRole);
                    if (msg.senderRole === "ai" || msg.user === "AI") {
                      return <div className="w-8 h-8 rounded-full bg-emerald-700 flex items-center justify-center text-xs">🤖</div>;
                    } else if (msg.senderRole === "dm" || msg.user === "DM" || isSystemCombatMessage) {
                      return <div className="w-8 h-8 rounded-full overflow-hidden"><DMAvatarIcon className="w-full h-full" /></div>;
                    } else if (avatar) {
                      return <img src={avatar} alt={msg.user} className="w-8 h-8 rounded-full object-cover" />;
                    } else {
                      return <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-xs">{msg.user.slice(0, 2)}</div>;
                    }
                  })()}
                </div>
                {/* Name and content */}
                <div className="flex-1">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span
                      className={`font-semibold text-sm ${
                        msg.user === "DM" ? "text-amber-400" : msg.user === "AI" ? "text-emerald-300" : "text-blue-400"
                      }`}
                    >
                      {msg.user}
                    </span>
                    <span className="text-[10px] text-gray-500">{formatTime(msg.timestamp)}</span>
                    {msg.type === "dice" && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400/90 border border-amber-500/20 leading-none font-medium">骰子</span>}
                    {msg.type === "combat" && (() => {
                      const isSystemCombatMessage = msg.senderRole === 'system' && msg.user === 'DM';
                      return isSystemCombatMessage
                        ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-700/50 text-gray-300 border border-gray-600/30 leading-none font-medium">系统</span>
                        : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400/90 border border-red-500/20 leading-none font-medium">战斗</span>;
                    })()}
                  </div>
                <div className={`${
                  msg.recipients?.length
                    ? msg.recipients.includes(userId)
                      ? "bg-pink-900/30 border-2 border-pink-500/60 rounded px-3 py-2 shadow-lg shadow-pink-500/20"
                      : "bg-slate-800/60 border border-slate-600 rounded px-2 py-1"
                    : ""
                }`}>
                  <div className="flex flex-col gap-1">
                    {/* 消息内容 */}
                    <div>
                      {uiHook.editingMessageId === msg.dbId ? (
                        <div className="flex flex-col gap-2 w-full">
                          <textarea
                            value={uiHook.editingText}
                            onChange={(e) => uiHook.setEditingText(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 resize-none focus:outline-none focus:border-amber-500"
                            rows={3}
                            autoFocus
                          />
                          <div className="flex items-center gap-2 justify-end">
                            <button onClick={() => uiHook.cancelEditing()} className="text-xs text-gray-400 hover:text-gray-200">取消</button>
                            <button onClick={saveEdit} className="text-xs text-emerald-300 hover:text-emerald-200">保存</button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-300 prose prose-invert prose-sm max-w-none">
                          {msg.type === "dice" && msg.meta?.diceRoll ? (
                            <DiceResultCard
                              roll={msg.meta.diceRoll}
                              userName={msg.user}
                              timestamp={msg.timestamp}
                              messageId={msg.dbId || msg.id}
                              onRequestNarrative={requestNarrative}
                              narrativeLoading={narrativeLoadingId === (msg.dbId || msg.id)}
                              isDM={isDM}
                              compact={true}
                            />
                          ) : (msg.meta as any)?.diceRequest ? (
                            /* 发骰请求卡片 */
                            (() => {
                              const req = (msg.meta as any).diceRequest;
                              const check = req.check || {};
                              const isPrivate = req.is_private;
                              const skillName = check.skill ? getSkillName(check.skill) : null;
                              const abilityName = check.ability ? getAbilityName(check.ability) : null;
                              const dcVal = typeof check.dc === "number" ? check.dc : null;
                              const checkTypeLabel = check.type === "save" ? "豁免" : check.type === "contest" ? "对抗" : "检定";

                              return (
                                <div className="bg-gradient-to-r from-amber-900/40 to-amber-800/20 border border-amber-500/30 rounded-lg p-3 not-prose">
                                  {/* 标题栏 */}
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="text-lg">🎲</span>
                                    <span className="font-semibold text-amber-300">发起{checkTypeLabel}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${isPrivate ? "bg-purple-500/30 text-purple-300 border border-purple-500/50" : "bg-emerald-500/30 text-emerald-300 border border-emerald-500/50"}`}>
                                      {isPrivate ? "🔒 暗投" : "🔓 明骰"}
                                    </span>
                                  </div>
                                  {/* 检定信息 */}
                                  <div className="flex flex-wrap items-center gap-2 mb-2">
                                    {skillName && (
                                      <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 text-sm font-medium">
                                        {skillName}
                                      </span>
                                    )}
                                    {!skillName && abilityName && (
                                      <span className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-sm font-medium">
                                        {abilityName}{checkTypeLabel}
                                      </span>
                                    )}
                                    {dcVal != null && (
                                      <span className="px-2 py-1 rounded bg-red-500/20 text-red-300 border border-red-500/40 text-sm font-medium">
                                        DC {dcVal}
                                      </span>
                                    )}
                                    <span className="px-2 py-1 rounded bg-gray-500/20 text-gray-300 border border-gray-500/40 text-sm">
                                      {check.dice || "1d20"}
                                    </span>
                                  </div>
                                  {/* 描述 */}
                                  {check.description && (
                                    <div className="text-sm text-gray-400 italic border-l-2 border-amber-500/30 pl-2">
                                      {check.description}
                                    </div>
                                  )}
                                </div>
                              );
                            })()
                          ) : msg.type === 'combat' && (msg.meta as any)?.combat_type === 'attack' ? (
                            // Combat attack message - structured display + AC for DM
                            <div className="combat-msg space-y-1">
                              <ReactMarkdown remarkPlugins={remarkPluginsStable} components={markdownComponents}>
                                {formatCombatDisplay(msg.content)}
                              </ReactMarkdown>
                              {/* DM-only: Show target AC */}
                              {isDM && (msg.meta as any)?.target_ac != null && (
                                <div className="mt-1 text-xs text-gray-500">
                                  <span className="px-1.5 py-0.5 rounded bg-gray-700/50 border border-gray-600">
                                    🛡️ 目标 AC: {(msg.meta as any).target_ac}
                                  </span>
                                </div>
                              )}
                              {/* Generate narrative button */}
                              {!(msg.meta as any)?.has_narrative && (msg.meta as any)?.narrative_prompt && (
                                <button
                                  onClick={() => handleGenerateNarrative(msg.id, msg.dbId)}
                                  disabled={narrativeLoadingIds.has(msg.id)}
                                  className="mt-1.5 px-2 py-0.5 text-xs rounded border border-purple-500/40 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
                                >
                                  {narrativeLoadingIds.has(msg.id) ? '生成中...' : '✨ 生成剧情'}
                                </button>
                              )}
                              {/* Reaction buttons for target player */}
                              {!isDM && chatReactions.length > 0 && (
                                <ReactionButtons
                                  messageDbId={msg.dbId}
                                  messageMeta={msg.meta as Record<string, any>}
                                  myTokenId={chatMyTokenId}
                                  availableReactions={chatReactions}
                                  isReactionUsed={chatReactionUsed}
                                  campaignId={campaignId}
                                  onReactionUsed={() => setChatReactionUsed(true)}
                                />
                              )}
                            </div>
                          ) : msg.type === 'combat' ? (
                            // Other combat messages (spell, area_spell, etc.)
                            <div className="combat-msg space-y-1">
                              <ReactMarkdown remarkPlugins={remarkPluginsStable} components={markdownComponents}>
                                {formatCombatDisplay(msg.content)}
                              </ReactMarkdown>
                              {/* Generate narrative button */}
                              {!(msg.meta as any)?.has_narrative && (msg.meta as any)?.narrative_prompt && (
                                <button
                                  onClick={() => handleGenerateNarrative(msg.id, msg.dbId)}
                                  disabled={narrativeLoadingIds.has(msg.id)}
                                  className="mt-1.5 px-2 py-0.5 text-xs rounded border border-purple-500/40 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
                                >
                                  {narrativeLoadingIds.has(msg.id) ? '生成中...' : '✨ 生成剧情'}
                                </button>
                              )}
                            </div>
                          ) : (msg.meta as any)?.spell_cast && (msg.meta as any)?.spellCastData ? (
                            <div className="space-y-1">
                              <SpellCastMessageCard data={(msg.meta as any).spellCastData} />
                              {!isDM && chatReactions.length > 0 && (() => {
                                const scd = (msg.meta as any).spellCastData || {};
                                if (scd.casterTokenId == null) return null;
                                const synthesizedMeta: Record<string, any> = {
                                  combat_type: 'spell',
                                  caster_token_id: scd.casterTokenId,
                                  spell_id: scd.spellId,
                                  spell_name: scd.spellName,
                                  spell_level: scd.slotLevel,
                                };
                                return (
                                  <ReactionButtons
                                    messageDbId={msg.dbId}
                                    messageMeta={synthesizedMeta}
                                    myTokenId={chatMyTokenId}
                                    availableReactions={chatReactions}
                                    isReactionUsed={chatReactionUsed}
                                    campaignId={campaignId}
                                    onReactionUsed={() => setChatReactionUsed(true)}
                                  />
                                );
                              })()}
                            </div>
                          ) : (
                            <ReactMarkdown remarkPlugins={remarkPluginsStable} components={markdownComponents}>
                              {msg.content}
                            </ReactMarkdown>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 底部操作栏 */}
                    <div className="mt-1 space-y-1">
                      {msg.recipients && msg.recipients.length > 0 && (
                        <div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${
                            msg.recipients.includes(userId)
                              ? "border-pink-400 bg-pink-500/20 text-pink-200 animate-pulse"
                              : "border-pink-500/60 text-pink-300"
                          }`}>
                            {`🔒 私信${(msg.recipients || []).length ? " -> " + (msg.recipients || []).filter((rid) => members.some(m => m.user_id === rid)).map((rid) => getUserDisplayName(rid, "player")).join("、") : ""}`}
                          </span>
                        </div>
                      )}


	                      {(msg.meta as any)?.restGrant && (() => {
	                        const restType = (msg.meta as any).restGrant?.type || 'short';
	                        const claimedBy = (msg.meta as any)?.claimed_by || [];
	                        const pendingChars = (msg.meta as any)?.pending_characters || [];
	                        const hasClaimed = claimedBy.includes(userId);
	                        const canClaim = !hasClaimed && !isDM;
	                        const allClaimed = pendingChars.length > 0 && pendingChars.every((c: any) => claimedBy.includes(c.user_id));
	                        const restResults = (msg.meta as any)?.rest_results || {};
	                        const unclaimedChars = pendingChars.filter((c: any) => !claimedBy.includes(c.user_id));

	                        return (
	                          <div className="mt-1">
	                            <div className="flex items-center gap-2 flex-wrap">
	                              {canClaim && (
	                                <button
	                                  onClick={() => takeRestFromMessage(msg, restType)}
	                                  disabled={restProcessingMsgId === msg.id}
	                                  className="text-[10px] px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
	                                >
	                                  {restProcessingMsgId === msg.id ? '处理中...' : (restType === 'long' ? '进行长休' : '进行短休')}
	                                </button>
	                              )}
	                              {hasClaimed && !isDM && (
	                                <span className="text-[10px] text-emerald-400">✓ 已完成</span>
	                              )}
	                              {isDM && (
	                                <>
	                                  {allClaimed ? (
	                                    <span className="text-[10px] text-emerald-400">✓ 全部已完成</span>
	                                  ) : (
	                                    <>
	                                      <span className="text-[10px] text-gray-400">已完成: {claimedBy.length}/{pendingChars.length}</span>
	                                      {unclaimedChars.map((c: any) => (
	                                        <button
	                                          key={c.user_id}
	                                          onClick={() => takeRestFromMessage(msg, restType, c.id, c.user_id, c.name)}
	                                          disabled={restProcessingMsgId === msg.id}
	                                          className="text-[10px] px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
	                                        >
	                                          {restProcessingMsgId === msg.id ? '...' : `${c.name} ${restType === 'long' ? '长休' : '短休'}`}
	                                        </button>
	                                      ))}
	                                    </>
	                                  )}
	                                </>
	                              )}
	                            </div>
	                            {Object.keys(restResults).length > 0 && (
	                              <div className="mt-1 space-y-0.5">
	                                {Object.values(restResults).map((r: any, i: number) => (
	                                  <div key={i}>
	                                    <div className="text-[10px] text-emerald-300/80">
	                                      {restType === 'short'
	                                        ? `${r.character_name} 🎲 d${r.hit_die}+${r.con_mod} → 恢复 ${r.healed} HP（${r.current_hp}/${r.max_hp}）`
	                                        : `${r.character_name} → HP 完全恢复（${r.current_hp}/${r.max_hp}）`}
	                                    </div>
	                                    {Array.isArray(r.companion_healed) && r.companion_healed.map((ch: any, ci: number) => (
	                                      <div key={ci} className="text-[10px] text-amber-300/80 ml-2">
	                                        🐾 {ch.name} → HP {ch.before_hp}→{ch.current_hp}/{ch.max_hp}
	                                      </div>
	                                    ))}
	                                  </div>
	                                ))}
	                              </div>
	                            )}
	                          </div>
	                        );
	                      })()}

                      {/* Reward claim button for pending rewards (not for rest messages) */}
                      {(msg.meta as any)?.rewardPending && !(msg.meta as any)?.restGrant && (() => {
                        const rewardMeta = (msg.meta as any).rewardPending;
                        const claimedBy = rewardMeta.claimed_by || [];
                        const characters = rewardMeta.characters || [];
                        const myChar = characters.find((c: any) => c.user_id === userId);
                        const hasClaimed = claimedBy.includes(userId);
                        const canClaim = myChar && !hasClaimed && !isDM;
                        const allClaimed = characters.every((c: any) => claimedBy.includes(c.user_id));
                        const unclaimedChars = characters.filter((c: any) => !claimedBy.includes(c.user_id));

                        return (
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            {canClaim && (
                              <button
                                onClick={() => claimRewardFromMessage(msg)}
                                disabled={rewardClaimingMsgId === msg.id}
                                className="text-[10px] px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
                              >
                                {rewardClaimingMsgId === msg.id ? '领取中...' : '接受'}
                              </button>
                            )}
                            {hasClaimed && !isDM && (
                              <span className="text-[10px] text-emerald-400">✓ 已领取</span>
                            )}
                            {isDM && (
                              <>
                                {allClaimed ? (
                                  <span className="text-[10px] text-emerald-400">✓ 全部已领取</span>
                                ) : (
                                  <>
                                    <span className="text-[10px] text-gray-400">已领取: {claimedBy.length}/{characters.length}</span>
                                    {unclaimedChars.map((c: any) => (
                                      <button
                                        key={c.user_id}
                                        onClick={() => claimRewardFromMessage(msg, c.id, c.user_id)}
                                        disabled={rewardClaimingMsgId === msg.id}
                                        className="text-[10px] px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
                                      >
                                        {rewardClaimingMsgId === msg.id ? '...' : `${c.name} 领取`}
                                      </button>
                                    ))}
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })()}

                      {/* Extra effect button for critical/fumble combat messages (DM only) */}
                      {isDM && msg.type === 'combat' && (msg.meta as any)?.combat_type === 'attack' && ((msg.meta as any)?.critical || (msg.meta as any)?.fumble) && (
                        <div>
                          <button
                            onClick={() => generateExtraEffect(msg, (msg.meta as any)?.critical ? 'critical' : 'fumble')}
                            disabled={extraEffectLoadingMsgId === msg.id}
                            className={`text-[10px] px-2 py-1 rounded text-white disabled:opacity-50 flex items-center gap-1 ${
                              (msg.meta as any)?.critical
                                ? 'bg-amber-600 hover:bg-amber-500'
                                : 'bg-purple-600 hover:bg-purple-500'
                            }`}
                          >
                            {extraEffectLoadingMsgId === msg.id ? (
                              '生成中...'
                            ) : (
                              <>
                                <span>{(msg.meta as any)?.critical ? '🌟' : '💥'}</span>
                                <span>生成{(msg.meta as any)?.critical ? '暴击奖励' : '大失败惩罚'}</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {(isDM || msg.senderRole === "dm" || msg.senderRole === "ai" || msg.senderUserId === userId) && !(msg.meta as any)?.diceRequest && (
                        <div className="flex items-center gap-1.5">
                          {isDM && (
                            <button onClick={() => openSendDice(msg)} className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400/80 hover:bg-amber-500/20 hover:text-amber-300 border border-amber-500/15 hover:border-amber-500/30 transition-all">🎲 发骰</button>
                          )}
                          <button onClick={() => openRollOut(msg)} disabled={uiHook.diceExecuteLoading === msg.id} className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400/80 hover:bg-emerald-500/20 hover:text-emerald-300 border border-emerald-500/15 hover:border-emerald-500/30 transition-all disabled:opacity-50">
                            {uiHook.diceExecuteLoading === msg.id ? "处理中..." : "🎯 投出"}
                          </button>
                        </div>
                      )}

                      {Boolean((msg.meta as any)?.diceRequest) && (
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {!isDM && (msg.recipients?.includes(userId) || !msg.recipients?.length) && (
                            <>
                              <button
                                onClick={() => openRollOut(msg, (msg.meta as any).diceRequest?.check)}
                                disabled={uiHook.diceExecuteLoading === msg.id}
                                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-emerald-900/50 flex items-center gap-1.5"
                              >
                                <DiceIcon
                                  expression={(msg.meta as any).diceRequest?.dice || '1d20'}
                                  size={16}
                                  className="text-white"
                                />
                                {uiHook.diceExecuteLoading === msg.id ? "处理中..." : "投出"}
                              </button>
                              {playerCompanions.map((comp) => (
                                <button
                                  key={comp.monster_instance_id}
                                  onClick={() => openCompanionRollOut(msg, (msg.meta as any).diceRequest?.check, comp)}
                                  disabled={uiHook.diceExecuteLoading === msg.id}
                                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-amber-900/50 flex items-center gap-1"
                                >
                                  <span>🐾</span>
                                  <span className="truncate max-w-[100px]">{comp.name}投骰</span>
                                </button>
                              ))}
                            </>
                          )}
                          {isDM && (
                            <button
                              onClick={() => openRollOut(msg, (msg.meta as any).diceRequest?.check)}
                              disabled={uiHook.diceExecuteLoading === msg.id}
                              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-amber-900/50 flex items-center gap-1.5"
                            >
                              <DiceIcon
                                expression={(msg.meta as any).diceRequest?.dice || '1d20'}
                                size={16}
                                className="text-white"
                              />
                              {uiHook.diceExecuteLoading === msg.id ? "处理中..." : "选择角色投出"}
                            </button>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200">
                        {/* 语音朗读按钮 */}
                        {renderTtsButton(msg)}
                        {/* 回复按钮 */}
                        {msg.senderUserId && (
                          <button
                            onClick={() => uiHook.setReplyingTo({
                              messageId: msg.dbId?.toString() || msg.id,
                              senderUserId: msg.senderUserId!,
                              senderName: msg.user,
                              content: msg.content
                            })}
                            className="text-[10px] px-1.5 py-0.5 rounded text-gray-500 hover:text-amber-300 hover:bg-amber-500/10 transition-all"
                          >
                            回复
                          </button>
                        )}
                        {(msg.senderUserId && msg.senderUserId === userId && canEditOrDelete(msg)) && (
                          <button onClick={() => uiHook.startEditing(msg.dbId!, msg.content)} className="text-[10px] px-1.5 py-0.5 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700/50 transition-all">编辑</button>
                        )}
                        {/* 非DM用户：撤回自己的消息（有时间限制） */}
                        {msg.dbId && !isDM && msg.senderUserId === userId && canEditOrDelete(msg) && (
                          <button
                            onClick={() => deleteMessageById(msg.dbId!)}
                            className={`text-[10px] px-1.5 py-0.5 rounded transition-all ${
                              uiHook.pendingDeleteId === msg.dbId
                                ? 'text-red-400 bg-red-500/15 border border-red-500/30'
                                : 'text-gray-500 hover:text-red-300 hover:bg-red-500/10'
                            }`}
                          >
                            {uiHook.pendingDeleteId === msg.dbId ? '确认撤回?' : '撤回'}
                          </button>
                        )}
                        {/* DM用户：删除任何消息（无时间限制） */}
                        {msg.dbId && isDM && (
                          <button
                            onClick={() => deleteMessageById(msg.dbId!)}
                            className={`text-[10px] px-1.5 py-0.5 rounded transition-all ${
                              uiHook.pendingDeleteId === msg.dbId
                                ? 'text-red-400 bg-red-500/15 border border-red-500/30'
                                : 'text-gray-500 hover:text-red-300 hover:bg-red-500/10'
                            }`}
                          >
                            {uiHook.pendingDeleteId === msg.dbId ? '确认删除?' : '删除'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            )}
            {msg.type === "system" && (
              <div className="flex items-start gap-2">
                {/* Avatar for system messages */}
                <div className="shrink-0 hidden sm:block">
                  {(() => {
                    const cu = (msg.meta as any)?.consumable_use;
                    const ru = (msg.meta as any)?.resource_use;
                    if ((cu || ru) && msg.senderUserId) {
                      const avatar = getUserAvatar(msg.senderUserId);
                      if (avatar) return <img src={avatar} alt={msg.user} className="w-8 h-8 rounded-full object-cover" />;
                      return <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-xs">{(msg.user || '?').slice(0, 2)}</div>;
                    }
                    return <div className="w-8 h-8 rounded-full overflow-hidden"><DMAvatarIcon className="w-full h-full" /></div>;
                  })()}
                </div>
                <div className="flex-1">
                  {/* Header with sender and timestamp */}
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className={`font-semibold text-sm ${(msg.meta as any)?.consumable_use || (msg.meta as any)?.resource_use ? 'text-blue-400' : 'text-amber-300'}`}>{(msg.meta as any)?.consumable_use || (msg.meta as any)?.resource_use ? msg.user : 'DM'}</span>
                    <span className="text-[10px] text-gray-500">{formatTime(msg.timestamp)}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-700/50 text-gray-400/90 border border-gray-600/30 leading-none font-medium">{(msg.meta as any)?.restGrant ? '休息' : (msg.meta as any)?.consumable_use ? '消耗品' : (msg.meta as any)?.resource_use ? '技能' : '系统'}</span>
                  </div>
                  {/* Message content */}
                  <div className="text-sm text-gray-300">
                    <ReactMarkdown remarkPlugins={remarkPluginsStable} components={markdownComponents}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                  {/* Rest grant button for system messages */}
                  {(msg.meta as any)?.restGrant && (() => {
                    const restType = (msg.meta as any).restGrant?.type || 'short';
                    const claimedBy = (msg.meta as any)?.claimed_by || [];
                    const pendingChars = (msg.meta as any)?.pending_characters || [];
                    const hasClaimed = claimedBy.includes(userId);
                    const canClaim = !hasClaimed && !isDM;
                    const allClaimed = pendingChars.length > 0 && pendingChars.every((c: any) => claimedBy.includes(c.user_id));
                    const restResults = (msg.meta as any)?.rest_results || {};
                    const unclaimedChars = pendingChars.filter((c: any) => !claimedBy.includes(c.user_id));

                    return (
                      <div className="mt-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Player: single button for self */}
                          {canClaim && (
                            <button
                              onClick={() => takeRestFromMessage(msg, restType)}
                              disabled={restProcessingMsgId === msg.id}
                              className="text-[10px] px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
                            >
                              {restProcessingMsgId === msg.id ? '处理中...' : (restType === 'long' ? '进行长休' : '进行短休')}
                            </button>
                          )}
                          {hasClaimed && !isDM && (
                            <span className="text-[10px] text-emerald-400">✓ 已完成</span>
                          )}
                          {/* DM: per-character buttons for unclaimed + status */}
                          {isDM && (
                            <>
                              {allClaimed ? (
                                <span className="text-[10px] text-emerald-400">✓ 全部已完成</span>
                              ) : (
                                <>
                                  <span className="text-[10px] text-gray-400">已完成: {claimedBy.length}/{pendingChars.length}</span>
                                  {unclaimedChars.map((c: any) => (
                                    <button
                                      key={c.user_id}
                                      onClick={() => takeRestFromMessage(msg, restType, c.id, c.user_id, c.name)}
                                      disabled={restProcessingMsgId === msg.id}
                                      className="text-[10px] px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
                                    >
                                      {restProcessingMsgId === msg.id ? '...' : `${c.name} ${restType === 'long' ? '长休' : '短休'}`}
                                    </button>
                                  ))}
                                </>
                              )}
                            </>
                          )}
                        </div>
                        {Object.keys(restResults).length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {Object.values(restResults).map((r: any, i: number) => (
                              <div key={i}>
                                <div className="text-[10px] text-emerald-300/80">
                                  {restType === 'short'
                                    ? `${r.character_name} 🎲 d${r.hit_die}+${r.con_mod} → 恢复 ${r.healed} HP（${r.current_hp}/${r.max_hp}）`
                                    : `${r.character_name} → HP 完全恢复（${r.current_hp}/${r.max_hp}）`}
                                </div>
                                {Array.isArray(r.companion_healed) && r.companion_healed.map((ch: any, ci: number) => (
                                  <div key={ci} className="text-[10px] text-amber-300/80 ml-2">
                                    🐾 {ch.name} → HP {ch.before_hp}→{ch.current_hp}/{ch.max_hp}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* Reward claim button for pending rewards */}
                  {(msg.meta as any)?.rewardPending && (() => {
                    const rewardMeta = (msg.meta as any).rewardPending;
                    const claimedBy = rewardMeta.claimed_by || [];
                    const characters = rewardMeta.characters || [];
                    const myChar = characters.find((c: any) => c.user_id === userId);
                    const hasClaimed = claimedBy.includes(userId);
                    const canClaim = myChar && !hasClaimed && !isDM;
                    const allClaimed = characters.every((c: any) => claimedBy.includes(c.user_id));
                    const unclaimedChars = characters.filter((c: any) => !claimedBy.includes(c.user_id));

                    return (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {canClaim && (
                          <button
                            onClick={() => claimRewardFromMessage(msg)}
                            disabled={rewardClaimingMsgId === msg.id}
                            className="text-[10px] px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
                          >
                            {rewardClaimingMsgId === msg.id ? '领取中...' : '接受'}
                          </button>
                        )}
                        {hasClaimed && !isDM && (
                          <span className="text-[10px] text-emerald-400">✓ 已领取</span>
                        )}
                        {isDM && (
                          <>
                            {allClaimed ? (
                              <span className="text-[10px] text-emerald-400">✓ 全部已领取</span>
                            ) : (
                              <>
                                <span className="text-[10px] text-gray-400">已领取: {claimedBy.length}/{characters.length}</span>
                                {unclaimedChars.map((c: any) => (
                                  <button
                                    key={c.user_id}
                                    onClick={() => claimRewardFromMessage(msg, c.id, c.user_id)}
                                    disabled={rewardClaimingMsgId === msg.id}
                                    className="text-[10px] px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
                                  >
                                    {rewardClaimingMsgId === msg.id ? '...' : `${c.name} 领取`}
                                  </button>
                                ))}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                  {/* 系统消息操作按钮 */}
                  <div className="flex items-center gap-2 mt-1">
                    {renderTtsButton(msg)}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* AI Streaming Message */}
        {aiHook.isAiStreaming && aiHook.aiStreamingContent && (
          <div className="flex items-start gap-2">
            <div className="shrink-0 hidden sm:block">
              <div className="w-8 h-8 rounded-full bg-emerald-700 flex items-center justify-center text-xs">🤖</div>
            </div>
            <div className="flex-1">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-semibold text-sm text-emerald-300">AI</span>
                <span className="text-[10px] text-gray-500">正在输入...</span>
              </div>
              <div className="text-sm text-gray-200 prose prose-invert prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={remarkPluginsStable} components={markdownComponents}>
                  {aiHook.aiStreamingContent}
                </ReactMarkdown>
                <span className="inline-block w-2 h-4 bg-emerald-500 ml-1 animate-pulse"></span>
              </div>
            </div>
          </div>
        )}

        {/* AI Thinking Indicator */}
        {aiHook.aiTyping && !aiHook.isAiStreaming && (
          <div className="flex items-start gap-2">
            <div className="shrink-0 hidden sm:block">
              <div className="w-8 h-8 rounded-full bg-emerald-700 flex items-center justify-center text-xs">🤖</div>
            </div>
            <div className="flex-1">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-semibold text-sm text-emerald-300">AI</span>
              </div>
              <div className="text-sm text-gray-400 flex items-center gap-1">
                <span>正在思考</span>
                <span className="inline-flex gap-0.5">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </span>
              </div>
            </div>
          </div>
        )}
        {aiHook.aiError && <div className="text-red-400 text-xs">{aiHook.aiError}</div>}
        <div ref={messagesHook.messagesEndRef} />
      </div>

      {/* 跳转到最新消息按钮 */}
      {!isAtBottom && (
        <button
          onClick={() => {
            messagesHook.scrollToBottom();
            setIsAtBottom(true);
            isAtBottomRef.current = true;
          }}
          className="absolute bottom-24 right-4 z-10 w-8 h-8 bg-gray-700/80 hover:bg-amber-600/80 text-gray-300 hover:text-white rounded-full shadow-lg shadow-black/30 flex items-center justify-center transition-all duration-200 hover:scale-110 backdrop-blur-sm border border-gray-600/30 hover:border-amber-500/40"
          title="跳转到最新消息"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}

      </div>
      )}

      {/* 工具栏 + 输入区域（折叠时全部隐藏） */}
      {!isInputCollapsed ? (
      <>
      {/* 工具栏：连接状态、搜索 */}
      <div className="px-2 py-1 border-t border-gray-700/30 flex items-center justify-between gap-1.5 bg-gray-850/50">
        {/* 左侧：私信 + 语音 + 展开 按钮 */}
        <div className="flex items-center gap-1.5">
          {/* 私信多选下拉按钮 */}
          <div className="relative recipients-dropdown-container">
            <button
              onClick={() => uiHook.setShowRecipientsDropdown(!uiHook.showRecipientsDropdown)}
              className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${
                uiHook.selectedRecipients.length > 0
                  ? 'text-amber-400 bg-amber-500/20 hover:bg-amber-500/30'
                  : 'text-gray-500 hover:text-gray-400 hover:bg-gray-700/50'
              }`}
              title={uiHook.selectedRecipients.length > 0 ? `私信给 ${uiHook.selectedRecipients.length} 人` : '点击选择私信对象'}
            >
              {uiHook.selectedRecipients.length > 0 ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
                </svg>
              )}
            </button>
            {/* 私信选择下拉菜单 */}
            {uiHook.showRecipientsDropdown && (
              <div className="absolute left-0 bottom-full mb-1 bg-gray-800 border border-amber-500/20 rounded-lg shadow-xl shadow-black/50 z-50 min-w-[200px] max-h-[400px] overflow-y-auto">
                {/* 成员列表 */}
                {members.filter((m) => (m.role === "dm" || m.selected_character_id) && !m.is_virtual).map((m, index) => {
                  const label = m.character_name || m.user_id;
                  const isSelected = uiHook.selectedRecipients.includes(m.user_id);
                  return (
                    <button
                      key={`${m.user_id}-${m.role || index}`}
                      className={`w-full px-3 py-2 flex items-center gap-2 text-xs hover:bg-gray-700 ${isSelected ? "bg-blue-900/30 text-blue-300" : "text-gray-300"}`}
                      onClick={() => uiHook.toggleRecipient(m.user_id)}
                    >
                      {m.avatar ? (
                        <img src={m.avatar} alt={label} className="w-8 h-8 rounded-full object-cover shrink-0" />
                      ) : (
                        <span className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center shrink-0">{label.slice(0, 2)}</span>
                      )}
                      <div className="flex-1 text-left">
                        <div className="font-semibold">{label}</div>
                        <div className="text-[10px] text-gray-400">{m.role === "dm" ? "DM" : "玩家"}</div>
                      </div>
                      {isSelected && <span className="text-blue-400">✓</span>}
                    </button>
                  );
                })}
                {/* 取消全部选择 */}
                {uiHook.selectedRecipients.length > 0 && (
                  <button
                    className="w-full px-3 py-2 flex items-center gap-2 text-xs hover:bg-gray-700 border-t border-gray-700 text-gray-400"
                    onClick={() => {
                      uiHook.clearRecipients();
                      uiHook.setShowRecipientsDropdown(false);
                    }}
                  >
                    <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs shrink-0">✕</div>
                    <div className="flex-1 text-left">
                      <div className="font-semibold">取消私信</div>
                      <div className="text-[10px] text-gray-500">发送公开消息</div>
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>
          {/* 语音/文字切换按钮 */}
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
          {/* 展开/收起聊天框 */}
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
          {/* 搜索按钮 */}
          <button
            onClick={() => {
              setShowSearchBar(v => {
                if (v) {
                  searchHook.setSearchQuery('');
                  searchHook.clearSearch();
                }
                return !v;
              });
            }}
            className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${
              showSearchBar
                ? 'text-amber-400 bg-amber-500/20 hover:bg-amber-500/30'
                : 'text-gray-500 hover:text-gray-400 hover:bg-gray-700/50'
            }`}
            title={showSearchBar ? '关闭搜索' : '搜索聊天记录'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path strokeLinecap="round" d="m21 21-4.3-4.3"/></svg>
          </button>
          {/* 折叠输入区域按钮 */}
          <button
            onClick={() => setIsInputCollapsed(true)}
            className="flex-shrink-0 p-1.5 rounded-lg transition-colors text-gray-500 hover:text-gray-400 hover:bg-gray-700/50"
            title="折叠输入区域"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>
        </div>

        {/* 右侧：DM发骰 + 发放按钮 */}
        <div className="flex items-center gap-2">
        {isDM && (
          <button
            onClick={() => {
              // 重置状态
              uiHook.setDiceRequestMode('manual');
              uiHook.setDiceSceneDescription('');
              uiHook.setSelectedCheckTypes([]);
              uiHook.setAiCheckSuggestion(null);
              uiHook.setDcValue('');
              uiHook.setAiDcReason('');
              uiHook.setIsPrivateRoll(false);
              const allPlayers = members.filter((m) => m.role !== "dm").map((m) => m.user_id);
              uiHook.setDiceRecipientsSelection(allPlayers);
              uiHook.setShowNewDiceModal(true);
            }}
            className="shrink-0 px-2.5 h-7 rounded-lg flex items-center gap-1.5 text-xs font-medium border border-amber-500/25 text-amber-400/90 bg-amber-500/8 hover:bg-amber-500/15 hover:border-amber-500/40 hover:text-amber-300 transition-all"
            title="发起检定"
          >
            {/* D20骰子SVG图标 */}
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 1L18 6V14L10 19L2 14V6L10 1Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <path d="M10 1V19M2 6L18 14M18 6L2 14" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
              <circle cx="10" cy="10" r="2" fill="currentColor"/>
            </svg>
            <span className="hidden sm:inline">发骰</span>
          </button>
        )}

          {/* DM 发放（短休/长休） */}
          {isDM && (
            <div className="relative" ref={grantMenuRef}>
              <button
                onClick={() => setShowGrantMenu(v => !v)}
                className="px-2.5 h-7 rounded-lg flex items-center gap-1.5 text-xs font-medium border border-purple-500/25 text-purple-400/90 bg-purple-500/8 hover:bg-purple-500/15 hover:border-purple-500/40 hover:text-purple-300 transition-all"
                title="向玩家发放操作"
              >
                <span>🎁</span> 发放 <svg className={`w-3 h-3 transition-transform ${showGrantMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="m18 15-6-6-6 6"/></svg>
              </button>
              {showGrantMenu && (
                <div className="absolute right-0 bottom-full mb-1 bg-gray-800/95 backdrop-blur-sm border border-gray-600/40 rounded-xl shadow-2xl shadow-black/40 min-w-[150px] z-20 overflow-hidden py-1">
                  <button onClick={() => handleGrantRest('short')} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700/50 flex items-center gap-2.5 text-gray-300 transition-colors">
                    <span>☕</span> 短休
                  </button>
                  <button onClick={() => handleGrantRest('long')} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700/50 flex items-center gap-2.5 text-gray-300 transition-colors">
                    <span>🌙</span> 长休
                  </button>
                  <div className="h-px bg-gray-700/50 mx-2 my-0.5" />
                  <button onClick={() => { setShowXPModal(true); setShowGrantMenu(false); }} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700/50 text-purple-300 flex items-center gap-2.5 transition-colors">
                    <span>⚡</span> 经验值
                  </button>
                  <button onClick={() => { setShowCurrencyModal(true); setShowGrantMenu(false); }} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700/50 text-amber-300 flex items-center gap-2.5 transition-colors">
                    <span>💰</span> 货币
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Dice Mode */}
      {isDiceMode && (
        <div className="flex-1 min-h-0 overflow-y-auto animate-fade-in">
          <DiceResultsGrouped
            diceRolls={diceRolls}
            members={members}
            tokens={mapTokens}
            isDM={isDM}
            onClearDice={clearDiceResults}
            onRequestNarrative={requestNarrative}
            narrativeLoadingId={narrativeLoadingId}
          />
        </div>
      )}

      {/* 底部区域：聊天输入框 或 骰子快捷按钮 */}
      <div className="border-t border-gray-700/30 px-2 py-1.5 bg-gray-900/60">
        {isDiceMode ? (
          /* 骰子快捷按钮 - SVG 图标 */
          <div className="flex flex-col gap-2">
            {/* DM 代投角色选择器 - 多选 */}
            {isDM && (
              <div className="flex items-center justify-start gap-2 text-xs flex-wrap max-h-16 overflow-y-auto px-1 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
                <span className="text-gray-400">代投:</span>
                {/* 玩家角色 */}
                {members.filter((m) => m.selected_character_id).map((m) => {
                  const isSelected = uiHook.proxyActorIds.includes(m.user_id);
                  return (
                    <button
                      key={m.user_id}
                      onClick={() => {
                        if (isSelected) {
                          uiHook.setProxyActorIds(uiHook.proxyActorIds.filter(id => id !== m.user_id));
                        } else {
                          uiHook.setProxyActorIds([...uiHook.proxyActorIds, m.user_id]);
                        }
                      }}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${
                        isSelected
                          ? "bg-amber-600/80 text-white border border-amber-500"
                          : "bg-gray-700/60 text-gray-300 border border-gray-600 hover:bg-gray-600/60"
                      }`}
                    >
                      {m.character_name || m.user_id}
                    </button>
                  );
                })}
                {/* 怪物 token */}
                {mapTokens.filter((t) => t.monster_instance_id).map((t) => {
                  const actorId = `monster-${t.id}`;
                  const isSelected = uiHook.proxyActorIds.includes(actorId);
                  return (
                    <button
                      key={actorId}
                      onClick={() => {
                        if (isSelected) {
                          uiHook.setProxyActorIds(uiHook.proxyActorIds.filter(id => id !== actorId));
                        } else {
                          uiHook.setProxyActorIds([...uiHook.proxyActorIds, actorId]);
                        }
                      }}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${
                        isSelected
                          ? "bg-red-600/80 text-white border border-red-500"
                          : "bg-gray-700/60 text-gray-300 border border-gray-600 hover:bg-gray-600/60"
                      }`}
                    >
                      🐉 {t.instance_name || t.monster_name || `怪物#${t.id}`}
                    </button>
                  );
                })}
                {/* 清空按钮 */}
                {uiHook.proxyActorIds.length > 0 && (
                  <button
                    onClick={() => uiHook.setProxyActorIds([])}
                    className="px-1.5 py-0.5 rounded text-xs bg-gray-600/60 text-gray-400 hover:bg-gray-500/60 hover:text-gray-200"
                    title="清空选择"
                  >
                    ✕
                  </button>
                )}
                {/* 暗投开关 */}
                <button
                  onClick={() => uiHook.setProxyPrivateRoll(!uiHook.proxyPrivateRoll)}
                  className={`ml-2 px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1 ${
                    uiHook.proxyPrivateRoll
                      ? "bg-purple-600/80 text-white border border-purple-500"
                      : "bg-gray-700/60 text-gray-400 border border-gray-600 hover:bg-gray-600/60"
                  }`}
                  title={uiHook.proxyPrivateRoll ? "暗投：只有DM和当事人能看到结果" : "明投：所有人可见"}
                >
                  {uiHook.proxyPrivateRoll ? "🔒 暗投" : "👁 明投"}
                </button>
              </div>
            )}
            <div className="flex items-center justify-center gap-3">
            {[
              { name: "D20", sides: 20, color: "amber", svg: (
                <svg viewBox="0 0 32 32" className="w-7 h-7">
                  <polygon points="16,2 28,10 28,22 16,30 4,22 4,10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  <line x1="16" y1="2" x2="16" y2="30" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
                  <line x1="4" y1="10" x2="28" y2="22" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
                  <line x1="28" y1="10" x2="4" y2="22" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
                </svg>
              )},
              { name: "D12", sides: 12, color: "purple", svg: (
                <svg viewBox="0 0 32 32" className="w-7 h-7">
                  <polygon points="16,2 26,7 28,18 20,28 12,28 4,18 6,7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  <line x1="16" y1="2" x2="16" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
                  <line x1="6" y1="7" x2="16" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
                  <line x1="26" y1="7" x2="16" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
                </svg>
              )},
              { name: "D10", sides: 10, color: "blue", svg: (
                <svg viewBox="0 0 32 32" className="w-7 h-7">
                  <polygon points="16,2 28,16 16,30 4,16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  <line x1="16" y1="2" x2="16" y2="30" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
                  <line x1="4" y1="16" x2="28" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
                </svg>
              )},
              { name: "D8", sides: 8, color: "emerald", svg: (
                <svg viewBox="0 0 32 32" className="w-7 h-7">
                  <polygon points="16,2 28,16 16,30 4,16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  <line x1="16" y1="2" x2="4" y2="16" stroke="currentColor" strokeWidth="1.2"/>
                  <line x1="16" y1="2" x2="28" y2="16" stroke="currentColor" strokeWidth="1.2"/>
                  <line x1="16" y1="16" x2="4" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.6"/>
                  <line x1="16" y1="16" x2="28" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.6"/>
                  <line x1="16" y1="16" x2="16" y2="30" stroke="currentColor" strokeWidth="1" opacity="0.6"/>
                </svg>
              )},
              { name: "D6", sides: 6, color: "red", svg: (
                <svg viewBox="0 0 32 32" className="w-7 h-7">
                  <polygon points="6,8 16,4 26,8 26,24 16,28 6,24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  <line x1="6" y1="8" x2="16" y2="12" stroke="currentColor" strokeWidth="1.2"/>
                  <line x1="26" y1="8" x2="16" y2="12" stroke="currentColor" strokeWidth="1.2"/>
                  <line x1="16" y1="12" x2="16" y2="28" stroke="currentColor" strokeWidth="1.2"/>
                  <circle cx="10" cy="16" r="1.2" fill="currentColor" opacity="0.6"/>
                  <circle cx="21" cy="12" r="1.2" fill="currentColor" opacity="0.6"/>
                  <circle cx="21" cy="16" r="1.2" fill="currentColor" opacity="0.6"/>
                </svg>
              )},
              { name: "D4", sides: 4, color: "pink", svg: (
                <svg viewBox="0 0 32 32" className="w-7 h-7">
                  <polygon points="16,4 28,26 4,26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  <line x1="16" y1="4" x2="16" y2="26" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
                  <line x1="10" y1="15" x2="22" y2="15" stroke="currentColor" strokeWidth="1" opacity="0.4"/>
                </svg>
              )},
            ].map((dice) => {
              const isRolling = rollingDice === dice.name;
              const colorClasses: Record<string, { bg: string, border: string, text: string, shadow: string }> = {
                amber: { bg: "from-amber-500/20 to-amber-700/30 hover:from-amber-500/40 hover:to-amber-600/50", border: "border-amber-500/30 hover:border-amber-400/60", text: "text-amber-400 group-hover:text-amber-300", shadow: "drop-shadow-[0_0_3px_rgba(251,191,36,0.5)]" },
                purple: { bg: "from-purple-500/20 to-purple-700/30 hover:from-purple-500/40 hover:to-purple-600/50", border: "border-purple-500/30 hover:border-purple-400/60", text: "text-purple-400 group-hover:text-purple-300", shadow: "drop-shadow-[0_0_3px_rgba(192,132,252,0.5)]" },
                blue: { bg: "from-blue-500/20 to-blue-700/30 hover:from-blue-500/40 hover:to-blue-600/50", border: "border-blue-500/30 hover:border-blue-400/60", text: "text-blue-400 group-hover:text-blue-300", shadow: "drop-shadow-[0_0_3px_rgba(96,165,250,0.5)]" },
                emerald: { bg: "from-emerald-500/20 to-emerald-700/30 hover:from-emerald-500/40 hover:to-emerald-600/50", border: "border-emerald-500/30 hover:border-emerald-400/60", text: "text-emerald-400 group-hover:text-emerald-300", shadow: "drop-shadow-[0_0_3px_rgba(52,211,153,0.5)]" },
                red: { bg: "from-red-500/20 to-red-700/30 hover:from-red-500/40 hover:to-red-600/50", border: "border-red-500/30 hover:border-red-400/60", text: "text-red-400 group-hover:text-red-300", shadow: "drop-shadow-[0_0_3px_rgba(248,113,113,0.5)]" },
                pink: { bg: "from-pink-500/20 to-pink-700/30 hover:from-pink-500/40 hover:to-pink-600/50", border: "border-pink-500/30 hover:border-pink-400/60", text: "text-pink-400 group-hover:text-pink-300", shadow: "drop-shadow-[0_0_3px_rgba(244,114,182,0.5)]" },
                yellow: { bg: "from-yellow-500/20 to-yellow-700/30 hover:from-yellow-500/40 hover:to-yellow-600/50", border: "border-yellow-500/30 hover:border-yellow-400/60", text: "text-yellow-400 group-hover:text-yellow-300", shadow: "drop-shadow-[0_0_3px_rgba(250,204,21,0.5)]" },
              };
              const colors = colorClasses[dice.color];

              return (
                <button
                  key={dice.name}
                  onClick={() => handleQuickDiceRoll(dice.name, dice.sides)}
                  disabled={!isConnected || isRolling}
                  className={`group flex flex-col items-center justify-center w-11 h-14 rounded-lg bg-gradient-to-b ${colors.bg} active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed border ${colors.border} ${isRolling ? 'animate-bounce' : ''}`}
                  title={`投掷 ${dice.name}`}
                >
                  <div className={`${colors.text} ${colors.shadow} ${isRolling ? 'animate-spin' : ''}`}>
                    {dice.svg}
                  </div>
                  <span className={`text-[10px] ${colors.text.split(' ')[0]}/80 font-medium mt-0.5`}>{dice.name}</span>
                </button>
              );
            })}
            </div>
          </div>
        ) : (
          /* 聊天输入框 */
          <div className="flex flex-col gap-1">
            {/* 引用预览框 */}
            {uiHook.replyingTo && (
              <div className="flex items-start gap-2 px-3 py-2 bg-gray-800/40 border-l-2 border-amber-500/50 rounded-r-lg">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-amber-400 font-medium mb-0.5">
                    回复 {uiHook.replyingTo.senderName}
                  </div>
                  <div className="text-xs text-gray-400 line-clamp-2 break-words">
                    {uiHook.replyingTo.content}
                  </div>
                </div>
                <button
                  onClick={() => uiHook.clearReply()}
                  className="text-gray-500 hover:text-gray-300 text-lg leading-none"
                  title="取消引用"
                >
                  ×
                </button>
              </div>
            )}
            <div className="relative">
              <SlashCommandMenu
                commands={slashCmd.filteredCommands}
                selectedIndex={slashCmd.selectedIndex}
                onSelect={(i) => uiHook.setInput(slashCmd.selectCommand(i))}
              />
              <div className="flex flex-col gap-1">
              {/* 拖动调整手柄 - 仅展开状态显示 */}
              {isChatExpanded && (
              <div
                className="h-1.5 cursor-ns-resize flex items-center justify-center group"
                onMouseDown={(e) => {
                  const textarea = (e.currentTarget.parentElement?.querySelector('textarea') || e.currentTarget.parentElement?.querySelector('.voice-input-container')) as HTMLElement;
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
                  const textarea = (e.currentTarget.parentElement?.querySelector('textarea') || e.currentTarget.parentElement?.querySelector('.voice-input-container')) as HTMLElement;
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
              {/* 语音输入模式 */}
              {isVoiceMode ? (
                <div className="voice-input-container flex">
                  <VoiceInput
                    onTranscribed={(text) => {
                      handleSendDirect(text);
                    }}
                    disabled={!isConnected}
                  />
                </div>
              ) : (
                <div className="flex items-end gap-1.5">
                  {/* 自动高度 textarea */}
                  <textarea
                    id="chat-message-input"
                    name="chatMessage"
                    value={uiHook.input}
                    onChange={(e) => {
                      uiHook.setInput(e.target.value);
                      if (!chatBoxHeight) {
                        // 自动调整高度
                        e.target.style.height = 'auto';
                        e.target.style.height = Math.min(e.target.scrollHeight, isChatExpanded ? 200 : 120) + 'px';
                      }
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={!isConnected || isVirtualCharacterFilter}
                    placeholder={!isConnected ? "连接失败..." : isVirtualCharacterFilter ? "无法与虚拟角色对话，请直接告诉 DM" : slashCmd.matchedCommand ? slashCmd.matchedCommand.argPlaceholder : uiHook.selectedRecipients.length > 0 ? `私信 ${uiHook.selectedRecipients.length} 人...${isChatExpanded ? ' (Ctrl+Enter发送)' : ''}` : isChatExpanded ? "输入消息... (Ctrl+Enter发送, / 查看命令)" : "输入消息... (/ 查看命令)"}
                    rows={isChatExpanded ? 4 : 1}
                    className={`flex-1 px-3 py-2 bg-gray-800/60 border rounded-xl text-gray-100 text-sm placeholder-gray-500 focus:outline-none transition-all resize-none ${
                      chatBoxHeight ? 'overflow-y-auto' : 'overflow-hidden'
                    } ${
                      !isConnected || isVirtualCharacterFilter
                        ? "border-red-500/50 shadow-[0_0_12px_rgba(239,68,68,0.25)] cursor-not-allowed opacity-70"
                        : "border-gray-700/40 focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500/40"
                    }`}
                    style={{
                      minHeight: '36px',
                      maxHeight: '300px',
                      ...(chatBoxHeight ? { height: `${chatBoxHeight}px` } : isChatExpanded ? { minHeight: '120px' } : {}),
                    }}
                  />
                  {/* 发送按钮 */}
                  <button
                    onClick={handleSend}
                    disabled={!isConnected || !uiHook.input.trim() || isVirtualCharacterFilter}
                    className="flex-shrink-0 p-2 rounded-xl text-amber-400/80 hover:text-amber-300 hover:bg-amber-500/15 disabled:text-gray-600 disabled:hover:bg-transparent transition-all active:scale-95"
                    title={isChatExpanded ? `发送 (${typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Enter)` : '发送 (Enter)'}
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
        )}
      </div>
      </>
      ) : (
        /* 折叠时：右下角浮动展开按钮 */
        <button
          onClick={() => setIsInputCollapsed(false)}
          className="absolute bottom-2 right-3 z-10 w-8 h-8 bg-gray-700/80 hover:bg-amber-600/80 text-gray-300 hover:text-white rounded-full shadow-lg shadow-black/30 flex items-center justify-center transition-all duration-200 hover:scale-110 backdrop-blur-sm border border-gray-600/30 hover:border-amber-500/40"
          title="展开输入区域"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m18 15-6-6-6 6"/>
          </svg>
        </button>
      )}
      </>
      )}
      </div>
      </div>
    </div>

    {/* Search Modal - Simplified UI only */}
    {searchHook.showSearchModal && (
      <div className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-lg w-full max-w-4xl max-h-[90dvh] flex flex-col">
          <div className="p-4 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-amber-400">搜索聊天记录</h2>
            <button onClick={() => searchHook.clearSearch()} className="text-gray-400 hover:text-gray-200">✕</button>
          </div>
          <div className="p-4 border-b border-gray-700">
            <input
              type="text"
              value={searchHook.searchQuery}
              onChange={(e) => {
                const value = e.target.value;
                searchHook.setSearchQuery(value);
                if (value) {
                  searchHook.performSearch(value);
                }
              }}
              placeholder="搜索消息内容或用户名..."
              className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              autoFocus
            />
            {searchHook.isSearching && (
              <div className="mt-2 text-xs text-gray-400">搜索中...</div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {searchHook.searchQuery && searchHook.searchResults.length === 0 && !searchHook.isSearching && (
              <div className="text-center text-gray-500 py-8">未找到匹配的消息</div>
            )}
            {!searchHook.searchQuery && (
              <div className="text-center text-gray-500 py-8">输入关键词开始搜索</div>
            )}
            {searchHook.searchResults.map((msg) => (
              <div key={msg.id} className="bg-gray-900/50 rounded p-3 border border-gray-700">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-semibold text-sm text-blue-400">{msg.user}</span>
                  <span className="text-[10px] text-gray-500">{formatTime(msg.timestamp)}</span>
                </div>
                <div className="text-sm text-gray-300">
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-gray-700 text-xs text-gray-500 text-center">
            找到 {searchHook.searchResults.length} 条消息
          </div>
        </div>
      </div>
    )}

    {/* Dice Recipients Modal */}
    {uiHook.showDiceRecipientsModal && createPortal(
      <div
        className="fixed inset-0 bg-black/70 z-[9999] flex items-center justify-center p-4"
        onClick={() => { uiHook.setShowDiceRecipientsModal(false); uiHook.setIsPrivateRoll(false); }}
      >
        <div className="bg-gray-800 rounded-lg w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="p-4 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-amber-400">发骰给谁</h2>
            <button onClick={() => { uiHook.setShowDiceRecipientsModal(false); uiHook.setIsPrivateRoll(false); }} className="text-gray-400 hover:text-gray-200">✕</button>
          </div>
          <div className="p-4 space-y-2 max-h-[50dvh] overflow-y-auto">
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-gray-300">全员</span>
              <input
                type="checkbox"
                checked={uiHook.diceRecipientsSelection.length === members.filter((m) => m.role !== "dm").length}
                onChange={(e) => {
                  if (e.target.checked) {
                    uiHook.setDiceRecipientsSelection(members.filter((m) => m.role !== "dm").map((m) => m.user_id));
                  } else {
                    uiHook.setDiceRecipientsSelection([]);
                  }
                }}
              />
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-gray-300">暗投（仅投出者和DM可见）</span>
              <input
                type="checkbox"
                checked={uiHook.isPrivateRoll}
                onChange={(e) => uiHook.setIsPrivateRoll(e.target.checked)}
              />
            </div>
            <div className="h-px bg-gray-700" />
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-300 shrink-0">DC难度：</label>
                <input
                  type="number"
                  value={uiHook.dcValue}
                  onChange={(e) => uiHook.setDcValue(e.target.value)}
                  placeholder="可选"
                  className="flex-1 px-2 py-1 text-sm bg-gray-900 border border-gray-600 rounded text-gray-200"
                />
                <button
                  onClick={generateAiDc}
                  disabled={uiHook.isGeneratingDc}
                  className="px-3 py-1 text-xs rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-500/30 disabled:opacity-50 shrink-0"
                >
                  {uiHook.isGeneratingDc ? "生成中..." : "AI设定"}
                </button>
              </div>
              {uiHook.aiDcReason && (
                <div className="text-xs text-gray-400 bg-gray-900/50 p-2 rounded border border-gray-700">
                  <span className="text-emerald-400">AI建议：</span> {uiHook.aiDcReason}
                </div>
              )}
            </div>
            <div className="h-px bg-gray-700" />
            {members.filter((m) => m.role !== "dm").map((m) => (
              <label key={m.user_id} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  {m.avatar ? (
                    <img src={m.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-xs">{(m.character_name || m.user_id).slice(0,2)}</div>
                  )}
                  <div className="text-sm text-gray-200">{m.character_name || m.user_id}</div>
                </div>
                <input
                  type="checkbox"
                  checked={uiHook.diceRecipientsSelection.includes(m.user_id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      uiHook.setDiceRecipientsSelection([...uiHook.diceRecipientsSelection, m.user_id]);
                    } else {
                      uiHook.setDiceRecipientsSelection(uiHook.diceRecipientsSelection.filter((id) => id !== m.user_id));
                    }
                  }}
                />
              </label>
            ))}
          </div>
          <div className="p-4 border-t border-gray-700 flex items-center justify-end gap-2">
            <button className="px-3 py-1 text-xs border border-gray-600 rounded hover:bg-gray-700" onClick={() => { uiHook.setShowDiceRecipientsModal(false); uiHook.setIsPrivateRoll(false); }}>取消</button>
            <button disabled={uiHook.diceRecipientsSelection.length === 0 || uiHook.isGeneratingDc} className="px-3 py-1 text-xs rounded bg-amber-500/20 text-amber-300 border border-amber-500/50 disabled:opacity-50 hover:bg-amber-500/30" onClick={confirmSendDice}>{uiHook.isGeneratingDc ? "生成DC中..." : "确认发送"}</button>
          </div>
        </div>
      </div>, document.body)}

    {/* Actor Select Modal */}
    {uiHook.showActorSelectModal && createPortal(
      <div
        className="fixed inset-0 bg-black/70 z-[10200] flex items-center justify-center p-4"
        onClick={() => uiHook.setShowActorSelectModal(false)}
      >
        <div className="bg-gray-800 rounded-lg w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="p-4 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-emerald-300">选择执行检定的角色</h2>
            <button onClick={() => uiHook.setShowActorSelectModal(false)} className="text-gray-400 hover:text-gray-200">✕</button>
          </div>
          <div className="p-2 max-h-[50dvh] overflow-y-auto">
            <div className="px-2 py-1 text-xs text-gray-500">玩家角色</div>
            {members.filter((m) => m.role !== "dm").map((m) => (
              <button
                key={`player-${m.user_id}`}
                className={`w-full px-3 py-2 flex items-center gap-2 rounded text-sm hover:bg-gray-700 ${uiHook.actorSelection === m.user_id ? "bg-gray-700 border border-emerald-600" : ""}`}
                onClick={() => uiHook.setActorSelection(m.user_id)}
              >
                <div className="w-7 h-7 rounded-full bg-blue-700 flex items-center justify-center text-[10px] shrink-0 overflow-hidden">
                  {m.avatar ? (
                    <img src={m.avatar} alt={m.character_name || m.user_id} className="w-full h-full object-cover" />
                  ) : (
                    (m.character_name || m.user_id).slice(0,2)
                  )}
                </div>
                <div className="flex-1 text-left">
                  <div className="font-semibold text-gray-200">{m.character_name || m.user_id}</div>
                  <div className="text-[10px] text-gray-500">玩家</div>
                </div>
                {uiHook.actorSelection === m.user_id && <span className="text-emerald-400">✓</span>}
              </button>
            ))}

            {mapTokens.filter((t) => t.monster_instance_id).length > 0 && (
              <>
                <div className="px-2 py-1 text-xs text-gray-500 mt-2">怪物 / NPC</div>
                {mapTokens.filter((t) => t.monster_instance_id).map((t) => (
                  <button
                    key={`monster-${t.id}`}
                    className={`w-full px-3 py-2 flex items-center gap-2 rounded text-sm hover:bg-gray-700 ${uiHook.actorSelection === `monster-${t.id}` ? "bg-gray-700 border border-emerald-600" : ""}`}
                    onClick={() => uiHook.setActorSelection(`monster-${t.id}`)}
                  >
                    <div className="w-7 h-7 rounded-full bg-red-700 flex items-center justify-center text-[10px] shrink-0 overflow-hidden">
                      {t.avatar ? (
                        <img src={t.avatar} alt={t.instance_name || t.monster_name || "M"} className="w-full h-full object-cover" />
                      ) : (
                        (t.instance_name || t.monster_name || "M").slice(0,2)
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-semibold text-gray-200">{t.instance_name || t.monster_name}</div>
                      {typeof t.current_hp === "number" && (
                        <div className="text-[10px] text-red-400">HP: {t.current_hp}</div>
                      )}
                    </div>
                    {uiHook.actorSelection === `monster-${t.id}` && <span className="text-emerald-400">✓</span>}
                  </button>
                ))}
              </>
            )}
          </div>
          <div className="p-4 border-t border-gray-700 flex items-center justify-end gap-2">
            <button className="px-3 py-1 text-xs border border-gray-600 rounded hover:bg-gray-700" onClick={() => uiHook.setShowActorSelectModal(false)}>取消</button>
            <button disabled={!uiHook.actorSelection} className="px-3 py-1 text-xs rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 disabled:opacity-50 hover:bg-emerald-500/30" onClick={confirmActorRoll}>确认投出</button>
          </div>
        </div>
      </div>, document.body)}

      {/* XP Reward Modal */}
      <XPRewardModal
        isOpen={showXPModal}
        characters={campaignCharacters}
        campaignId={campaignId}
        onConfirm={handleGrantXP}
        onCancel={() => setShowXPModal(false)}
      />

      {/* Currency Reward Modal */}
      <CurrencyRewardModal
        isOpen={showCurrencyModal}
        recipients={rewardRecipients}
        campaignId={campaignId}
        onConfirm={handleGrantCurrency}
        onCancel={() => setShowCurrencyModal(false)}
      />

      {/* New Dice Request Modal (DM发起检定) */}
      {uiHook.showNewDiceModal && createPortal(
        <div
          className="fixed inset-0 bg-black/70 z-[10200] flex items-center justify-center p-4"
          onClick={() => uiHook.setShowNewDiceModal(false)}
        >
          <div className="bg-gray-800 rounded-lg w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-amber-400">发起检定</h2>
              <button onClick={() => uiHook.setShowNewDiceModal(false)} className="text-gray-400 hover:text-gray-200">✕</button>
            </div>
            <div className="p-4 space-y-4 max-h-[60dvh] overflow-y-auto">
              {/* 模式选择 */}
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="diceMode"
                    checked={uiHook.diceRequestMode === 'manual'}
                    onChange={() => uiHook.setDiceRequestMode('manual')}
                    className="text-amber-500"
                  />
                  <span className="text-sm text-gray-300">手动选择检定类型</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="diceMode"
                    checked={uiHook.diceRequestMode === 'ai'}
                    onChange={() => uiHook.setDiceRequestMode('ai')}
                    className="text-amber-500"
                  />
                  <span className="text-sm text-gray-300">描述场景（AI智能判断）</span>
                </label>
              </div>

              <div className="h-px bg-gray-700" />

              {/* 手动模式：检定类型选择 */}
              {uiHook.diceRequestMode === 'manual' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-gray-400">检定类型</label>
                    {uiHook.selectedCheckTypes.length < 3 && (
                      <button
                        onClick={() => uiHook.setShowCheckTypeModal(true)}
                        className="px-2 py-1 text-xs rounded bg-amber-500/20 text-amber-300 border border-amber-500/50 hover:bg-amber-500/30"
                      >
                        + 添加
                      </button>
                    )}
                  </div>
                  {/* 已选检定列表 */}
                  {uiHook.selectedCheckTypes.length > 0 ? (
                    <div className="space-y-2">
                      {uiHook.selectedCheckTypes.map((check, index) => (
                        <div key={index} className="flex items-center gap-2 px-3 py-2 bg-gray-900 border border-gray-600 rounded">
                          <span className="flex-1 text-sm text-amber-300">{getCheckTypeLabel(check)}</span>
                          {check.dc && <span className="text-xs text-gray-400">DC {check.dc}</span>}
                          <button
                            onClick={() => {
                              uiHook.setSelectedCheckTypes(uiHook.selectedCheckTypes.filter((_, i) => i !== index));
                            }}
                            className="text-gray-500 hover:text-red-400 text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <button
                      onClick={() => uiHook.setShowCheckTypeModal(true)}
                      className="w-full px-3 py-2 text-left text-sm bg-gray-900 border border-gray-600 rounded hover:border-amber-500/50 transition-colors"
                    >
                      <span className="text-gray-500">点击选择检定类型...</span>
                    </button>
                  )}
                </div>
              )}

              {/* AI模式：场景描述 */}
              {uiHook.diceRequestMode === 'ai' && (
                <div className="space-y-2">
                  <label className="text-sm text-gray-400">场景描述</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={uiHook.diceSceneDescription}
                      onChange={(e) => uiHook.setDiceSceneDescription(e.target.value)}
                      placeholder="描述需要检定的场景..."
                      className="flex-1 px-3 py-2 text-sm bg-gray-900 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-500/50"
                    />
                    <VoiceInput
                      compact
                      onTranscribed={(text) => {
                        uiHook.setDiceSceneDescription(uiHook.diceSceneDescription ? uiHook.diceSceneDescription + text : text);
                      }}
                    />
                    <button
                      onClick={analyzeCheck}
                      disabled={uiHook.isAnalyzingCheck || !uiHook.diceSceneDescription.trim()}
                      className="px-3 py-2 text-xs rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-500/30 disabled:opacity-50 shrink-0"
                    >
                      {uiHook.isAnalyzingCheck ? "分析中..." : "AI分析"}
                    </button>
                  </div>
                  {/* 与模组关联勾选 */}
                  {selectedModule && (
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={uiHook.useModuleContext}
                        onChange={(e) => uiHook.setUseModuleContext(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-900 text-amber-500 focus:ring-amber-500/30 accent-amber-500"
                      />
                      <span className="text-xs text-gray-400">与模组关联</span>
                      <span className="text-xs text-gray-600">（搜索模组内容辅助分析）</span>
                    </label>
                  )}
                  {uiHook.aiCheckSuggestion && (
                    <div className="text-xs text-gray-400 bg-gray-900/50 p-2 rounded border border-gray-700 space-y-1">
                      <div>
                        <span className="text-emerald-400">AI建议：</span>
                        {uiHook.aiCheckSuggestion.reason && (
                          <span className="text-gray-400 ml-1">{uiHook.aiCheckSuggestion.reason}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {uiHook.aiCheckSuggestion.checks.map((c, i) => (
                          <span key={i} className="px-2 py-1 bg-amber-500/10 text-amber-300 rounded text-xs">
                            {getCheckTypeLabel({ type: c.check_type, ability: c.ability, skill: c.skill })}
                            {c.dc && <span className="text-gray-400 ml-1">DC {c.dc}</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 显示已选检定（AI模式下也可以修改） */}
                  {uiHook.selectedCheckTypes.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-gray-500">已选检定</label>
                        {uiHook.selectedCheckTypes.length < 3 && (
                          <button
                            onClick={() => uiHook.setShowCheckTypeModal(true)}
                            className="px-2 py-0.5 text-xs rounded bg-amber-500/20 text-amber-300 border border-amber-500/50 hover:bg-amber-500/30"
                          >
                            + 添加
                          </button>
                        )}
                      </div>
                      {uiHook.selectedCheckTypes.map((check, index) => (
                        <div key={index} className="flex items-center gap-2 px-3 py-2 bg-gray-900 border border-gray-600 rounded">
                          <span className="flex-1 text-sm text-amber-300">{getCheckTypeLabel(check)}</span>
                          {check.dc && <span className="text-xs text-gray-400">DC {check.dc}</span>}
                          <button
                            onClick={() => {
                              uiHook.setSelectedCheckTypes(uiHook.selectedCheckTypes.filter((_, i) => i !== index));
                            }}
                            className="text-gray-500 hover:text-red-400 text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="h-px bg-gray-700" />

              {/* DC难度 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-400 shrink-0">DC难度：</label>
                  <input
                    type="number"
                    value={uiHook.dcValue}
                    onChange={(e) => uiHook.setDcValue(e.target.value)}
                    placeholder="可选"
                    className="flex-1 px-2 py-1 text-sm bg-gray-900 border border-gray-600 rounded text-gray-200"
                  />
                  <button
                    onClick={generateAiDc}
                    disabled={uiHook.isGeneratingDc}
                    className="px-3 py-1 text-xs rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-500/30 disabled:opacity-50 shrink-0"
                  >
                    {uiHook.isGeneratingDc ? "生成中..." : "AI设定"}
                  </button>
                </div>
                {uiHook.aiDcReason && (
                  <div className="text-xs text-gray-400 bg-gray-900/50 p-2 rounded border border-gray-700">
                    <span className="text-emerald-400">AI建议：</span> {uiHook.aiDcReason}
                  </div>
                )}
              </div>

              <div className="h-px bg-gray-700" />

              {/* 暗投选项 */}
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-300">暗投（仅投出者和DM可见）</span>
                <input
                  type="checkbox"
                  checked={uiHook.isPrivateRoll}
                  onChange={(e) => uiHook.setIsPrivateRoll(e.target.checked)}
                />
              </div>

              {/* 优势/劣势骰选项 */}
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-300">优势/劣势</span>
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={uiHook.diceRollModifier === 'advantage'}
                      onChange={(e) => {
                        uiHook.setDiceRollModifier(e.target.checked ? 'advantage' : null);
                      }}
                      className="w-3.5 h-3.5 rounded border-gray-500 bg-gray-700 text-green-500 focus:ring-green-500 focus:ring-offset-0"
                    />
                    <span className="text-xs text-green-400">🟢优势</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={uiHook.diceRollModifier === 'disadvantage'}
                      onChange={(e) => {
                        uiHook.setDiceRollModifier(e.target.checked ? 'disadvantage' : null);
                      }}
                      className="w-3.5 h-3.5 rounded border-gray-500 bg-gray-700 text-red-500 focus:ring-red-500 focus:ring-offset-0"
                    />
                    <span className="text-xs text-red-400">🔴劣势</span>
                  </label>
                </div>
              </div>

              <div className="h-px bg-gray-700" />

              {/* 玩家选择 */}
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-300">全员</span>
                <input
                  type="checkbox"
                  checked={uiHook.diceRecipientsSelection.length === members.filter((m) => m.role !== "dm").length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      uiHook.setDiceRecipientsSelection(members.filter((m) => m.role !== "dm").map((m) => m.user_id));
                    } else {
                      uiHook.setDiceRecipientsSelection([]);
                    }
                  }}
                />
              </div>
              {members.filter((m) => m.selected_character_id).map((m) => (
                <label key={m.user_id} className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    {m.avatar ? (
                      <img src={m.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-xs">{(m.character_name || m.user_id).slice(0,2)}</div>
                    )}
                    <div className="text-sm text-gray-200">{m.character_name || m.user_id}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={uiHook.diceRecipientsSelection.includes(m.user_id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        uiHook.setDiceRecipientsSelection([...uiHook.diceRecipientsSelection, m.user_id]);
                      } else {
                        uiHook.setDiceRecipientsSelection(uiHook.diceRecipientsSelection.filter((id) => id !== m.user_id));
                      }
                    }}
                  />
                </label>
              ))}
            </div>
            <div className="p-4 border-t border-gray-700 flex items-center justify-end gap-2">
              <button
                className="px-3 py-1 text-xs border border-gray-600 rounded hover:bg-gray-700"
                onClick={() => uiHook.setShowNewDiceModal(false)}
              >
                取消
              </button>
              <button
                disabled={uiHook.selectedCheckTypes.length === 0 || uiHook.diceRecipientsSelection.length === 0 || uiHook.isGeneratingDc || uiHook.isAnalyzingCheck}
                className="px-3 py-1 text-xs rounded bg-amber-500/20 text-amber-300 border border-amber-500/50 disabled:opacity-50 hover:bg-amber-500/30"
                onClick={confirmNewDiceRequest}
              >
                {uiHook.isGeneratingDc || uiHook.isAnalyzingCheck ? "处理中..." : "确认发送"}
              </button>
            </div>
          </div>
        </div>, document.body)}

      {/* Check Type Select Modal */}
      <CheckTypeSelectModal
        isOpen={uiHook.showCheckTypeModal}
        onClose={() => uiHook.setShowCheckTypeModal(false)}
        onSelect={(check) => {
          uiHook.setSelectedCheckTypes([...uiHook.selectedCheckTypes, check]);
          uiHook.setShowCheckTypeModal(false);
        }}
        proficientSkills={
          // 收集所有选中玩家的熟练技能
          members
            .filter(m => uiHook.diceRecipientsSelection.includes(m.user_id))
            .flatMap(m => (campaignCharacters.find(c => c.id === m.selected_character_id) as any)?.selected_skills || [])
        }
        expertiseSkills={
          // 收集所有选中玩家的专精技能
          members
            .filter(m => uiHook.diceRecipientsSelection.includes(m.user_id))
            .flatMap(m => (campaignCharacters.find(c => c.id === m.selected_character_id) as any)?.expertise_skills || [])
        }
      />

      {/* 3D Dice Animation Overlay - 始终挂载保持 canvas 存活 */}
      {createPortal(
        <Suspense fallback={null}>
          <DiceBox3D
            visible={dice3DVisible}
            notation={dice3DNotation}
            checkInfo={dice3DCheckInfo}
            onRollComplete={(result) => {
              // Handle pending /roll slash command
              const slashPending = pendingSlashRollRef.current;
              if (slashPending) {
                const msg = slashPending.buildMessage(result.rolls, result.total);
                sendMessage({
                  type: "chat",
                  data: { message: msg, timestamp: Date.now(), meta: { inline_roll: true } },
                });
                pendingSlashRollRef.current = null;
                return;
              }
              // Handle pending dice_quick / dice_execute
              const pending = pendingDiceRollRef.current;
              if (pending) {
                pending.payloads.forEach(p => {
                  p.data = { ...p.data, client_total: result.total, client_rolls: result.rolls };
                  sendMessage(p);
                });
                pendingDiceRollRef.current = null;
              }
            }}
            onClose={() => setDice3DVisible(false)}
            autoCloseDelay={2500}
          />
        </Suspense>,
        document.body
      )}

      {/* Image Lightbox */}
      {lightboxSrc && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white bg-black/40 rounded-full w-10 h-10 flex items-center justify-center text-2xl"
            onClick={() => setLightboxSrc(null)}
            title="关闭 (Esc)"
          >
            ✕
          </button>
          <img
            src={lightboxSrc}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}
    </>
  );
}
