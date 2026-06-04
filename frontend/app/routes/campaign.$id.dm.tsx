import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { LinksFunction, MetaFunction } from "react-router";
import { TacticalMap } from "~/components/map/TacticalMap";
import { ToolbarV2 } from "~/components/ui/ToolbarV2";
import { CharacterPanel } from "~/components/character/CharacterPanel";
import { GridUnitSettingsDialog } from "~/components/ui/GridUnitSettingsDialog";
import { CampaignHeader } from "~/components/campaign/CampaignHeader";
import { VoicePanel } from "~/components/campaign/VoicePanel";
import { useVoiceStore } from "~/stores/voiceStore";
import { useOnlineStore } from "~/stores/onlineStore";
import { useCampaignMusicStore } from "~/stores/campaignMusicStore";
import { LevelUpNotification } from "~/components/ui/LevelUpNotification";
import { showGlobalToast } from "~/components/ui/Toast";
import { useWebSocket } from "~/hooks/useWebSocket";
import { useSidebarState } from "~/hooks/useSidebarState";
import { useUnreadChat } from "~/hooks/useUnreadChat";
import { usePhoneLikeLayout } from "~/hooks/usePhoneLikeLayout";
import { useCampaignShellBootstrap } from "~/campaign-shell/bootstrap/useCampaignShellBootstrap";
import {
  type CampaignAbilityConfirm,
  type CampaignHotbarConfirm,
  type CampaignHotbarTargeting,
  type CampaignSourceModalState,
} from "~/campaign-shell/hotbar/hotbarTypes";
import { useCampaignHotbarBindings } from "~/campaign-shell/hotbar/useCampaignHotbarBindings";
import {
  confirmDivineSmiteAction,
  confirmFlexibleCastingAction,
  confirmLayOnHandsAction,
  confirmSpellSlotRecoveryAction,
} from "~/campaign-shell/hotbar/hotbarModalActions";
import { useCharacterCastingState } from "~/campaign-shell/hotbar/useCharacterCastingState";
import { useCampaignPanelOrchestration } from "~/campaign-shell/panel/useCampaignPanelOrchestration";
import { CampaignFloatingOverlayShell } from "~/campaign-shell/panel/CampaignFloatingOverlayShell";
import { CampaignRightSidebarShell } from "~/campaign-shell/panel/CampaignRightSidebarShell";
import { CampaignSidebarTabList } from "~/campaign-shell/panel/CampaignSidebarTabList";
import { useCampaignSidebarResize } from "~/campaign-shell/panel/useCampaignSidebarResize";
import { useCampaignSidebarTabs } from "~/campaign-shell/panel/useCampaignSidebarTabs";
import { bridgeCampaignRealtimeMessage } from "~/campaign-shell/realtime/campaignRealtimeBridge";
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import { resolveMultiTargetSpec } from "~/components/map/utils/multiTargetSpellUtils";
import { getCurrentUserId } from "~/utils/user";
import { apiFetch } from "~/utils/api-client";
import { consumeMaterial } from "~/components/spell/spellMaterialUtils";
import { Hotbar } from "~/components/hotbar/Hotbar";
import type { WorldTime } from "~/utils/timeUtils";
import {
  normalizeTime, advanceTimeByRounds, advanceTimeBySeconds, DEFAULT_TIME,
  isSameWorldTime,
  formatDayDisplay, formatTimeDisplay,
  shortRest, longRest,
  playRoundAdvanceSound, playRealTimeStartSound, playRealTimeStopSound,
  playShortRestSound, playLongRestSound,
} from "~/utils/timeUtils";
import { HotbarAttackConfirmModal, computeAttackInfo } from "~/components/hotbar/HotbarAttackConfirmModal";
import { LayOnHandsConfirmModal } from "~/components/hotbar/LayOnHandsConfirmModal";
import { ArcaneRecoveryModal } from "~/components/hotbar/ArcaneRecoveryModal";
import { FlexibleCastingModal } from "~/components/hotbar/FlexibleCastingModal";
import { DivineSmiteConfirmModal } from "~/components/hotbar/DivineSmiteConfirmModal";
import type { HotbarSlot } from "~/components/character/CharacterDisplay/types/Character";
import { showCharacterBubble } from "~/utils/characterBubble";
import { fetchCharacterCached } from "~/utils/characterCache";
import { fetchCampaignMembersCached } from "~/utils/campaignMembersCache";
import {
  fetchCampaignModuleMapsCached,
  invalidateCampaignModuleMapsCache,
} from "~/utils/moduleMapsCache";
import { showDamageNumber } from "~/components/map/DamageNumberOverlay";
import { getAssetUrl } from "~/utils/asset-url";
import { LoadingScreen } from "~/components/ui/LoadingScreen";
import { castSpellAction } from "~/utils/sidebarCasting";
import type { SpellCastData } from "~/components/spell/SpellCastActions";
import racesData from "~/data/rules/races.json";
import classResourcesData from "~/data/rules/class_resources.json";
import spellcastingConfig from "~/data/rules/spellcasting.json";
import {
  normalizeSpellSlotArray,
  getMaxSpellSlots,
  getRemainingSlots,
  consumeSpellSlotState,
  type SpellSlotsStateLike,
} from "~/utils/spellSlotUtils";
import * as Tabs from "@radix-ui/react-tabs";
import { createLogger } from '~/utils/logger';
const logger = createLogger('campaign.$id.dm');

const LazyChatPanel = lazy(() =>
  import("~/components/ui/ChatPanel").then((mod) => ({ default: mod.ChatPanel }))
);
const LazyFloatingChatWindow = lazy(() =>
  import("~/components/chat/FloatingChatWindow").then((mod) => ({ default: mod.FloatingChatWindow }))
);
const LazyFloatingFilterPanels = lazy(() =>
  import("~/components/chat/FloatingFilterPanel").then((mod) => ({ default: mod.FloatingFilterPanels }))
);
const LazyRulesPanel = lazy(() =>
  import("~/components/ui/RulesPanel").then((mod) => ({ default: mod.RulesPanel }))
);
const LazyResourceLibraryPanel = lazy(() =>
  import("~/components/campaign/ResourceLibraryPanel").then((mod) => ({ default: mod.ResourceLibraryPanel }))
);
const LazyModuleScriptPanel = lazy(() =>
  import("~/components/campaign/ModuleScriptPanel").then((mod) => ({ default: mod.ModuleScriptPanel }))
);
const LazyMapManagementPanel = lazy(() =>
  import("~/components/campaign/MapManagementPanel").then((mod) => ({ default: mod.MapManagementPanel }))
);
const LazyCombatPanel = lazy(() =>
  import("~/components/combat/CombatPanel").then((mod) => ({ default: mod.CombatPanel }))
);
const LazyTimeSettingModal = lazy(() =>
  import("~/components/campaign/TimeSettingModal").then((mod) => ({ default: mod.TimeSettingModal }))
);
const LazyCampaignSettingsDialog = lazy(() =>
  import("~/components/campaign/CampaignSettingsDialog").then((mod) => ({ default: mod.CampaignSettingsDialog }))
);

function PanelFallback({ label = "加载中..." }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-gray-400">
      {label}
    </div>
  );
}

const RESOURCE_SOUND_MAP: Record<string, string> = {
  rage: 'enhance_cast.mp3', bardic_inspiration: 'inspire_cast.mp3',
  channel_divinity_cleric: 'radiant_cast.mp3', wild_shape: 'summon_cast.mp3',
  second_wind: 'heal_cast.mp3', action_surge: 'enhance_cast.mp3',
  superiority_dice: 'force_cast.mp3', ki: 'enhance_cast.mp3',
  divine_sense: 'radiant_cast.mp3', lay_on_hands: 'heal_cast.mp3',
  channel_divinity_paladin: 'radiant_cast.mp3', sorcery_points: 'magic_cast.mp3',
  arcane_recovery: 'magic_cast.mp3', portent: 'psychic_cast.mp3',
  arcane_ward: 'shield_cast.mp3', tides_of_chaos: 'magic_cast.mp3',
  natural_recovery: 'magic_cast.mp3', shadow_arts: 'necrotic_cast.mp3',
  elemental_disciplines: 'zone_cast.mp3',
};

// 法术位函数已迁移至 ~/utils/spellSlotUtils

function playResourceSound(resourceId: string) {
  const file = RESOURCE_SOUND_MAP[resourceId] || 'magic_cast.mp3';
  const audio = new Audio(getAssetUrl(`sounds/spells/${file}`));
  audio.volume = 0.5;
  audio.play().catch(() => {});
}

function findResourceByIdOrSlot(resourceIdOrSlot: string | HotbarSlot): { id: string; name: string } | null {
  const res = (classResourcesData as any).classResources as any[];
  if (typeof resourceIdOrSlot === 'string') {
    return res.find((r: any) => r.id === resourceIdOrSlot) || null;
  }
  return res.find((r: any) => resourceIdOrSlot.meta?.resourceId ? r.id === resourceIdOrSlot.meta.resourceId : (r.name === resourceIdOrSlot.name || r.nameEn === resourceIdOrSlot.id)) || null;
}


export const meta: MetaFunction = () => {
  return [{ title: "DM 控制台 - DND 5E" }];
};

export const links: LinksFunction = () => {
  return [
    {
      rel: "preload",
      href: "/assets/ui/classic-card-bg.jpg",
      as: "image",
    },
  ];
};

export default function DMView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isPhoneLike = usePhoneLikeLayout();
  const [selectedTool, setSelectedTool] = useState<string>("move");
  const [showFogOfWar, setShowFogOfWar] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showAIMarkers, setShowAIMarkers] = useState(true);
  const [isClient, setIsClient] = useState(false);
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [isSidebarFullscreen, setIsSidebarFullscreen] = useState(false);
  const [moduleMaps, setModuleMaps] = useState<any[]>([]);
  const [selectedMap, setSelectedMap] = useState<any | null>(null);
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [currentMapUrl, setCurrentMapUrl] = useState<string | null>(null);
  // Map transition state - completely hide TacticalMap during map switch to avoid Konva race conditions
  const [isMapTransitioning, setIsMapTransitioning] = useState(false);
  const mapTransitionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [mapImageScale, setMapImageScale] = useState<number>(1);
  const [mapTransform, setMapTransform] = useState<{ rotation: number; flipH: boolean; flipV: boolean }>({
    rotation: 0,
    flipH: false,
    flipV: false,
  });
  const [fogMode, setFogMode] = useState<"brush" | "eraser">("brush"); // 迷雾绘制模式
  const [fogBrushSize, setFogBrushSize] = useState<number>(1); // 迷雾笔刷大小（1-5格）
  const [terrainMode, setTerrainMode] = useState<"brush" | "eraser">("brush");
  const [terrainBrushSize, setTerrainBrushSize] = useState<number>(1);
  const [terrainType, setTerrainType] = useState<string>("difficult");
  const [showTerrainToPlayers, setShowTerrainToPlayers] = useState(false);
  const [globalTerrain, setGlobalTerrain] = useState<string | null>(null);
  const [isDetectingTerrain, setIsDetectingTerrain] = useState(false);
  const [rulerMode, setRulerMode] = useState<"measure" | "circle" | "erase" | null>(null); // 测距模式
  const [drawTool, setDrawTool] = useState<"circle" | "sketch" | "arrow" | "eraser" | null>(null); // 绘图工具
  const [drawColor, setDrawColor] = useState<string>("#ff0000"); // 绘图颜色
  const [drawStrokeWidth, setDrawStrokeWidth] = useState<number>(2); // 绘图笔宽
  const [drawingsRefreshVersion, setDrawingsRefreshVersion] = useState(0);
  const [gridUnitLength, setGridUnitLength] = useState<number>(5); // 网格单位长度（英尺）
  const [markerIcon, setMarkerIcon] = useState<string>("📍"); // 标记图标
  const [markerColor, setMarkerColor] = useState<string>("#ef4444"); // 标记颜色
  const [tokenMode, setTokenMode] = useState<"place" | "delete">("place"); // Token模式
  const [showGridUnitDialog, setShowGridUnitDialog] = useState(false); // 显示网格单位设置对话框
  const [mapListRefreshTrigger, setMapListRefreshTrigger] = useState(0); // 触发地图列表刷新
  const [itemsRefreshTrigger, setItemsRefreshTrigger] = useState(0); // 触发物品列表刷新
  const [isResizing, setIsResizing] = useState(false);
  const [campaignMembers, setCampaignMembers] = useState<Array<{ user_id: string; role: string; character_name?: string; display_name?: string; selected_character_id?: number; is_virtual?: boolean }>>([]);
  const [playerAvatars, setPlayerAvatars] = useState<Array<{ id: number | string; name: string; avatar_url?: string; type: 'player'; userId?: number; isOnline?: boolean }>>([]);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false); // 显示战役设置对话框
  const [campaignData, setCampaignData] = useState<{ name: string; description?: string; cover_image?: string; metadata?: { enable_deity_system?: boolean; enable_3d_dice?: boolean }; max_players?: number }>({ name: '' });
  const [isCombatActive, setIsCombatActive] = useState(false); // 战斗是否进行中
  const [timeOfDay, setTimeOfDay] = useState<WorldTime>(DEFAULT_TIME);
  const timeOfDayRef = useRef<WorldTime>(DEFAULT_TIME);
  const realtimePendingSeqRef = useRef<number | null>(null);
  const realtimePendingSinceRef = useRef<number>(0);
  const realtimeSyncSeqRef = useRef(0);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [bootstrappedCampaign, setBootstrappedCampaign] = useState<any>(null);
  const [hotbarCharacter, setHotbarCharacter] = useState<any>(null); // Selected character for hotbar
  // Concentration spell name for hotbar spell detail modal
  const [concentrationSpellName, setConcentrationSpellName] = useState<string | null>(null);
  const [castingSpellName, setCastingSpellName] = useState<string | null>(null);
  // Spell data cache for hotbar spell casting
  const spellsCacheRef = useRef<any[]>([]);
  useEffect(() => {
    import('~/data/rules/spells.json')
      .then(m => { spellsCacheRef.current = (m.default as any).spells || []; })
      .catch(() => {});
  }, []);
  const [hotbarTargeting, setHotbarTargeting] = useState<CampaignHotbarTargeting | null>(null);
  const spellHotbarIndexRef = useRef(-1);
  const [hotbarConfirm, setHotbarConfirm] = useState<CampaignHotbarConfirm | null>(null);
  const [abilityConfirm, setAbilityConfirm] = useState<CampaignAbilityConfirm | null>(null);
  const [arcaneRecoveryOpen, setArcaneRecoveryOpen] = useState<CampaignSourceModalState | null>(null);
  const [flexibleCastingOpen, setFlexibleCastingOpen] = useState<CampaignSourceModalState | null>(null);
  const [naturalRecoveryOpen, setNaturalRecoveryOpen] = useState<CampaignSourceModalState | null>(null);
  const [restConfirm, setRestConfirm] = useState<'short' | 'long' | null>(null);
  const [restProcessing, setRestProcessing] = useState(false);
  const currentUserId = getCurrentUserId();

  useCharacterCastingState({
    characterId: hotbarCharacter?.id,
    campaignId: id,
    currentMapUrl,
    userId: currentUserId,
    setConcentrationSpellName,
    setCastingSpellName,
  });

  // Voice store for global voice state
  const { addVoiceUserId, removeVoiceUserId, setVoiceUserIds } = useVoiceStore();

  // Online store for tracking user online status
  const { setOnline, setOffline, setOnlineUsers, isOnline } = useOnlineStore();

  // Ref for fetching campaign members (used in WebSocket callback)
  const fetchCampaignMembersRef = useRef<() => Promise<void>>();
  const sendMessageRef = useRef<(message: any) => void>(() => {});

  // Sidebar state persistence (tab + width + subTabs + chatFilters)
  const {
    tab: rightTab,
    setTab: setRightTab,
    width: rightSidebarWidth,
    setWidth: setRightSidebarWidth,
    getSubTab,
    setSubTab,
    chatFilters,
    toggleHiddenUser,
    toggleHiddenType,
    hotbarExpanded,
    setHotbarExpanded,
    dmSelectedCharacterId,
    setDmSelectedCharacterId,
    getSpellExpandedLevels,
    toggleSpellExpandedLevel,
    floatingChat,
    setFloatingChat,
    floatingCharPanel,
    setFloatingCharPanel
  } = useSidebarState(id, currentUserId, 'dm');

  // Unread chat tracking
  const { unreadCount } = useUnreadChat({
    userId: currentUserId,
    floatingChat,
    currentTab: rightTab,
    isSidebarExpanded: showRightSidebar,
  });

  // Fetch hotbar character on mount if persisted selection exists but CharacterPanel hasn't loaded yet
  useEffect(() => {
    if (dmSelectedCharacterId && !hotbarCharacter) {
      apiFetch(`/api/characters/${dmSelectedCharacterId}`, { userId: currentUserId })
        .then(resp => resp.ok ? resp.json() : null)
        .then(data => {
          if (data) setHotbarCharacter(data);
        })
        .catch(() => {});
    }
  }, [dmSelectedCharacterId]);

  useCampaignHotbarBindings({
    hotbarCharacter,
    sendSpellCastChatMessage: (message, spellCastData) => {
      sendMessage({ type: "chat", data: { message, meta: { spell_cast: true, spellCastData } } });
    },
    onConsumeSpellSlot: ({ level, characterId }) => {
      if (!characterId || typeof level !== "number" || level <= 0) return;
      let nextSpellSlotsState: SpellSlotsStateLike = null;
      let nextRemainingSlots: number[] | null = null;
      let nextMaxSlots: number[] | null = null;
      setHotbarCharacter((prev: any) => {
        if (!prev || prev.id !== characterId) return prev;
        const maxSlots = getMaxSpellSlots(prev.class_id, prev.level || 1, prev.subclass_id);
        const consumedState = consumeSpellSlotState(prev.spell_slots_state, level, maxSlots);
        if (consumedState === prev.spell_slots_state) return prev;
        nextSpellSlotsState = consumedState;
        nextMaxSlots = maxSlots;
        nextRemainingSlots = getRemainingSlots(consumedState, maxSlots);
        return { ...prev, spell_slots_state: consumedState };
      });
      if (nextRemainingSlots && nextMaxSlots) {
        publishAppEvent("spellSlotsChanged", {
          characterId,
          remaining: nextRemainingSlots,
          max: nextMaxSlots,
        });
      }
      if (nextSpellSlotsState) {
        apiFetch(`/api/characters/${characterId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spell_slots_state: nextSpellSlotsState,
            broadcast_campaign_id: id,
          }),
        }).catch(() => {});
      }
    },
    setHotbarTargeting,
    setAbilityConfirm,
    setArcaneRecoveryOpen,
    setFlexibleCastingOpen,
    setNaturalRecoveryOpen,
  });

  useEffect(() => {
    const handler = (detail: any) => {
      const characterId = Number(detail?.character_id);
      const nextSpellSlotsState = detail?.spell_slots_state;
      if (!characterId || !Array.isArray(nextSpellSlotsState)) return;

      setHotbarCharacter((prev: any) => (
        prev && prev.id === characterId
          ? { ...prev, spell_slots_state: nextSpellSlotsState }
          : prev
      ));
    };

    return subscribeAppEvent("spellSlotsUpdate", handler);
  }, []);

  useEffect(() => {
    const handler = ({ level, characterId }: { level?: number; characterId?: number | string }) => {
      const numericCharacterId = Number(characterId);
      if (!numericCharacterId || typeof level !== "number" || level <= 0) return;

      setHotbarCharacter((prev: any) => {
        if (!prev || prev.id !== numericCharacterId) return prev;
        const maxSlots = getMaxSpellSlots(prev.class_id, prev.level || 1, prev.subclass_id);
        const consumedState = consumeSpellSlotState(prev.spell_slots_state, level, maxSlots);
        if (consumedState === prev.spell_slots_state) return prev;
        return { ...prev, spell_slots_state: consumedState };
      });
    };

    return subscribeAppEvent("consumeSpellSlot", handler);
  }, []);

  useCampaignSidebarResize({
    isResizing,
    setIsResizing,
    setSidebarWidth: setRightSidebarWidth,
  });

  // WebSocket connection for real-time sync
  const { isConnected, connectionHealth, sendMessage } = useWebSocket({
    campaignId: id || "",
    userId: currentUserId, // Get current user ID dynamically
    role: "dm",
    onMessage: (message) => {
      // Dispatch chat messages for unread tracking
      if (message.type === "chat") {
        publishAppEvent("wsChatMessage", (message.data || message) as any);
      }

      if (message.type === "system_notice" && message.data?.message) {
        showGlobalToast({
          message: message.data.message,
          type: message.data.level || "info",
          duration: message.data.duration,
        });
        return;
      }

      // Handle connection confirmation with online users list
      if (message.type === "connection" && message.data?.online_users && id) {
        setOnlineUsers(id, message.data.online_users);
        if (message.data.time_of_day) {
          const normalized = normalizeTime(message.data.time_of_day);
          timeOfDayRef.current = normalized;
          setTimeOfDay((prev) => (isSameWorldTime(prev, normalized) ? prev : normalized));
        }
        return;
      }

      // Handle user connected/disconnected
      if (message.type === "user_connected" && message.data?.user_id && id) {
        setOnline(id, message.data.user_id);
        if (message.data.user_id !== currentUserId) {
          // Only refresh for other users. Our own page opens multiple sockets
          // (main/chat/map), which would otherwise trigger duplicate refreshes.
          fetchCampaignMembersRef.current?.();
        }
        return;
      }
      if (message.type === "user_disconnected" && message.data?.user_id && id) {
        if (message.data.user_id !== currentUserId) {
          setOffline(id, message.data.user_id);
        }
        return;
      }

      // Handle being kicked from campaign
      if (message.type === "kicked") {
				alert(message.data?.message || "You have been removed from this campaign");
        navigate("/");
        return;
      }

      // Handle voice state updates
      if (message.type === "voice_join" && message.data?.user_id) {
        addVoiceUserId(parseInt(message.data.user_id, 10));
        return;
      }
      if (message.type === "voice_leave" && message.data?.user_id) {
        removeVoiceUserId(parseInt(message.data.user_id, 10));
        return;
      }
      if (message.type === "voice_state" && message.data?.user_ids) {
        setVoiceUserIds(message.data.user_ids.map((id: string) => parseInt(id, 10)));
        return;
      }

      // Handle music control from server (excluded sender, so DM won't receive own messages)
      if (message.type === "music_play" || message.type === "music_pause" || message.type === "music_volume") {
        // DM is the controller - these are echoed messages, ignore
        return;
      }

      // Handle map updates
      if (message.type === "map_update" && message.data) {
				const { map_url, map_data, map_settings } = message.data;
				// Handle map URL change - always process if map_url is provided
				if (map_url !== undefined) {
					// Clear any pending transition timeout
					if (mapTransitionTimeoutRef.current) {
						clearTimeout(mapTransitionTimeoutRef.current);
					}

					// Start transition - this unmounts the Konva Stage
					setIsMapTransitioning(true);

					// Sequence: 1) unmount Stage 2) update URL 3) remount Stage
					// Using requestAnimationFrame to ensure React has flushed the unmount
					requestAnimationFrame(() => {
						// Now Stage should be fully unmounted, safe to update URL
						setCurrentMapUrl(map_url);
						logger.debug("[DM] Map updated to:", map_url);

						// End transition after URL is set and React has processed it
						mapTransitionTimeoutRef.current = setTimeout(() => {
							setIsMapTransitioning(false);
						}, 100);
					});
        }
        // Handle map settings (scale, rotation, flip) from other clients
				if (map_settings) {
					if (map_settings.scale !== undefined) {
						setMapImageScale(map_settings.scale);
          }
					if (map_settings.rotation !== undefined || map_settings.flipH !== undefined || map_settings.flipV !== undefined) {
            setMapTransform(prev => ({
							rotation: map_settings.rotation ?? prev.rotation,
							flipH: map_settings.flipH ?? prev.flipH,
							flipV: map_settings.flipV ?? prev.flipV,
            }));
          }
					logger.debug("[DM] Map settings updated:", map_settings);
        }
      }

      if (bridgeCampaignRealtimeMessage(message as any, {
        role: "dm",
        currentUserId,
        setIsCombatActive,
      })) {
        return;
      }

      if (message.type === "rest_grant") {
        const restType = message.data?.rest_type || "short";
        logger.debug("[DM] Rest grant received, dispatching rest event", { restType });
        publishAppEvent("restGrant", {
          restType,
          source: "dm-main",
          wsMessage: message,
        });
        return;
      }

      // Handle time of day updates
      if (message.type === "time_update" && message.data) {
        const normalized = normalizeTime(message.data);
        timeOfDayRef.current = normalized;
        setTimeOfDay((prev) => (isSameWorldTime(prev, normalized) ? prev : normalized));

        const syncSeq = Number((message.data as any).sync_seq);
        const requiresSyncAck = (message.data as any).requires_sync_ack === true;

        if (requiresSyncAck && Number.isInteger(syncSeq)) {
          // Ack only. Realtime per-round settlement is now driven server-side
          // via settlement_rounds on the outbound tick (see the realtime clock
          // effect), so receivers no longer fire an HTTP decrement here.
          sendMessageRef.current({ type: "time_update_ack", data: { sync_seq: syncSeq } });
        }
        return;
      }

      if (message.type === "time_update_committed" && message.data) {
        const committedSeq = Number((message.data as any).sync_seq);
        if (Number.isInteger(committedSeq) && realtimePendingSeqRef.current === committedSeq) {
          realtimePendingSeqRef.current = null;
          realtimePendingSinceRef.current = 0;
        }
        return;
      }

      // Handle character level up notifications
      if (message.type === "character_level_up" && message.data) {
        logger.debug("[DM] Character level up received:", message.data);

        // Dispatch event for character list refresh
        publishAppEvent("characterLevelUp", message.data as any);

        // Dispatch event for token HP update (if character is on map)
        publishAppEvent("tokenHPUpdate", {
          characterId: message.data.character_id,
          maxHp: message.data.max_hp,
          currentHp: message.data.current_hp,
        });

        // Log notification (toast component will be added later)
        logger.info(`[DM] 🎉 ${message.data.character_name} leveled up to level ${message.data.level}!`);
      }

      // Handle player character selection changes
      if (message.type === "character_selected") {
        logger.debug("[DM] Player changed character:", message);
        // Refresh campaign members list to get updated character names
        fetchCampaignMembersRef.current?.();
        // Dispatch event for CharacterPanel to refresh
        publishAppEvent("characterSelected", message as any);
      }

      // Handle DM AI character generation progress updates
      if (message.type === "dm_generate_progress") {
        logger.debug("[DM] Generation progress:", message);
        publishAppEvent("dmGenerateProgress", message as any);
      }

      // Handle character created notification
      if (message.type === "character_created") {
        logger.debug("[DM] Character created:", message);
        // Dispatch event for character list refresh
        publishAppEvent("characterCreated", message as any);
      }

      // Handle spell slots deducted by backend after spell cast
      if (message.type === "spell_slots_update" || message.type === "spell_slot_consumed") {
        logger.debug(`[DM] ${message.type} received:`, message);
        const rawMessage = message as any;
        const characterId = Number(rawMessage?.character_id);
        const nextSpellSlotsState = (
          rawMessage?.spell_slots_state
          ?? rawMessage?.new_spell_slots_state
        ) as SpellSlotsStateLike;
        if (characterId && hotbarCharacter?.id === characterId) {
          const maxSlots = getMaxSpellSlots(
            hotbarCharacter.class_id,
            hotbarCharacter.level || 1,
            hotbarCharacter.subclass_id,
          );
          setHotbarCharacter((prev: any) => (
            prev && prev.id === characterId
              ? { ...prev, spell_slots_state: nextSpellSlotsState }
              : prev
          ));
          publishAppEvent("spellSlotsChanged", {
            characterId,
            remaining: getRemainingSlots(nextSpellSlotsState, maxSlots),
            max: maxSlots,
          });
        }
        publishAppEvent("spellSlotsUpdate", {
          ...rawMessage,
          character_id: characterId,
          spell_slots_state: nextSpellSlotsState,
        } as any);
      }

      // Handle AI marker visibility sync
      if (message.type === "ai_marker_visibility" && message.data) {
        logger.debug("[DM] AI marker visibility changed:", message.data);
        setShowAIMarkers(message.data.show_ai_markers);
      }

    },
  });

  // Handle map use - broadcast to all players
  const handleMapUse = async (map: any) => {
    logger.debug("[DM] handleMapUse called with map:", map?.name, "url:", map?.url?.substring(0, 50));

    if (!map?.url) {
      logger.error("[DM] handleMapUse: map.url is empty!");
      return;
    }

    // Clear any pending transition
    if (mapTransitionTimeoutRef.current) {
      clearTimeout(mapTransitionTimeoutRef.current);
    }

    // Start transition - this will unmount the TacticalMap to avoid Konva race conditions
    setIsMapTransitioning(true);

    // Use requestAnimationFrame to ensure React has flushed the unmount
    requestAnimationFrame(() => {
      // Broadcast to all players via WebSocket
      sendMessage({
        type: "map_update",
        data: {
          map_url: map.url,
          map_data: map
        }
      });

      // Update local state - Stage is now unmounted
      setCurrentMapUrl(map.url);
      setSelectedMap(map);
      logger.debug("[DM] Map state updated to:", map.url?.substring(0, 50));

      // End transition after a short delay to allow React to reconcile
      mapTransitionTimeoutRef.current = setTimeout(() => {
        setIsMapTransitioning(false);
      }, 100);
    });

    // Persist to database (async, don't block)
    try {
      const response = await apiFetch(`/api/campaigns/${id}/current-map?map_url=${encodeURIComponent(map.url)}`, {
        method: "POST",
      });

      if (response.ok) {
        logger.debug("[DM] Map saved to database:", map.name);
      } else {
        logger.error("[DM] Failed to save map to database");
      }
    } catch (error) {
      logger.error("[DM] Error saving map to database:", error);
    }

    // Load map scale for this map
    try {
      const scaleResponse = await apiFetch(`/api/map-settings/${id}/${encodeURIComponent(map.url)}`);
      if (scaleResponse.ok) {
        const scaleData = await scaleResponse.json();
        if (scaleData.scale) {
          setMapImageScale(scaleData.scale);
          logger.debug("[DM] Loaded map scale for new map:", scaleData.scale);
        } else {
          setMapImageScale(1); // Reset to default if no scale found
        }
        // Load or detect terrain
        if (scaleData.global_terrain) {
          setGlobalTerrain(scaleData.global_terrain);
        } else {
          setGlobalTerrain(null);
          detectTerrain(map.url);
        }
      } else {
        setMapImageScale(1); // Reset to default on error
        setGlobalTerrain(null);
        detectTerrain(map.url);
      }
    } catch (scaleError) {
      logger.error("[DM] Failed to load map scale:", scaleError);
      setMapImageScale(1); // Reset to default on error
      setGlobalTerrain(null);
      detectTerrain(map.url);
    }

    logger.debug("[DM] Broadcasting map to all players:", map.name);
  };

  // Trigger async terrain detection for a map
  const detectTerrain = useCallback(async (mapUrl: string) => {
    if (!id || !mapUrl) return;
    setIsDetectingTerrain(true);
    try {
      const resp = await apiFetch(`/api/map-settings/${id}/detect-terrain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ map_url: mapUrl }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.terrain) {
          setGlobalTerrain(data.terrain);
          setIsDetectingTerrain(false);
          return;
        }
      }
      // If no immediate result, poll after delay for background detection
      setTimeout(async () => {
        try {
          const settingsResp = await apiFetch(`/api/map-settings/${id}/${encodeURIComponent(mapUrl)}`);
          if (settingsResp.ok) {
            const settings = await settingsResp.json();
            if (settings.global_terrain) {
              setGlobalTerrain(settings.global_terrain);
            }
          }
        } catch { /* ignore */ }
        setIsDetectingTerrain(false);
      }, 8000);
    } catch {
      setIsDetectingTerrain(false);
    }
  }, [id]);

  // Handle manual terrain change
  const handleGlobalTerrainChange = useCallback(async (terrain: string) => {
    setGlobalTerrain(terrain);
    if (!id || !currentMapUrl) return;
    try {
      await apiFetch(`/api/map-settings/${id}/${encodeURIComponent(currentMapUrl)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ global_terrain: terrain }),
      });
      // Broadcast terrain change to players via WebSocket
      sendMessage({
        type: "map_update",
        data: {
          map_url: currentMapUrl,
          map_settings: { global_terrain: terrain },
        },
      });
    } catch (e) {
      logger.error("[DM] Failed to save terrain:", e);
    }
  }, [id, currentMapUrl, sendMessage]);

  // === World Time handlers ===

  // Global world-time advances now settle effect durations server-side via the
  // settlement_rounds field on time_update. The legacy HTTP endpoint remains
  // available for compatibility but is no longer driven from this route.
  sendMessageRef.current = sendMessage;

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  useEffect(() => {
    timeOfDayRef.current = timeOfDay;
  }, [timeOfDay]);

  const formatWorldTimeLabel = useCallback((t: WorldTime) => {
    return `${formatDayDisplay(t)} ${formatTimeDisplay(t)}`;
  }, []);

  const broadcastSystemNotice = useCallback((message: string, level: "success" | "error" | "info" | "warning" = "info", duration = 3000) => {
    sendMessage({
      type: "system_notice",
      data: { message, level, duration },
    });
  }, [sendMessage]);

  const handleAdvanceRound = useCallback(() => {
    playRoundAdvanceSound();
    const newTime = advanceTimeByRounds(timeOfDay, 1);
    setTimeOfDay(newTime);
    // Global world-time advance: the backend settlement owner expires
    // time-bound rules for this one round. No separate HTTP decrement.
    sendMessage({ type: "time_update", data: { ...newTime, settlement_rounds: 1 } });
    broadcastSystemNotice(`DM 将时间推进了 1 轮，当前时间：${formatWorldTimeLabel(newTime)}`);
  }, [timeOfDay, sendMessage, broadcastSystemNotice, formatWorldTimeLabel]);

  const handleToggleRealTime = useCallback(() => {
    const starting = !timeOfDay.realTimeActive;
    starting ? playRealTimeStartSound() : playRealTimeStopSound();
    if (!starting) {
      realtimePendingSeqRef.current = null;
      realtimePendingSinceRef.current = 0;
    }
    const newTime = { ...timeOfDay, realTimeActive: starting };
    setTimeOfDay(newTime);
    sendMessage({ type: "time_update", data: newTime });
    broadcastSystemNotice(
      `DM ${starting ? "开启" : "暂停"}了实时计时，当前时间：${formatWorldTimeLabel(newTime)}`
    );
  }, [timeOfDay, sendMessage, broadcastSystemNotice, formatWorldTimeLabel]);

  const handleShortRest = useCallback(() => {
    setRestConfirm('short');
  }, []);

  const handleLongRest = useCallback(() => {
    setRestConfirm('long');
  }, []);

  const executeRest = useCallback(async (restType: 'short' | 'long') => {
    setRestProcessing(true);
    try {
      // 1. Advance time
      if (restType === 'short') {
        playShortRestSound();
        const { newTime, roundsElapsed } = shortRest(timeOfDay);
        setTimeOfDay(newTime);
        // Global time jump: backend settles roundsElapsed rounds once.
        sendMessage({ type: "time_update", data: { ...newTime, settlement_rounds: roundsElapsed } });
      } else {
        playLongRestSound();
        const { newTime, roundsElapsed } = longRest(timeOfDay);
        setTimeOfDay(newTime);
        sendMessage({ type: "time_update", data: { ...newTime, settlement_rounds: roundsElapsed } });
      }

      // 2. Collect all characters with selected character
      const charsToRest = campaignMembers
        .filter(m => m.selected_character_id)
        .map(m => ({
          charId: m.selected_character_id!,
          userId: m.user_id,
          name: m.character_name || '未知角色',
        }));

      // 3. Call rest API for each character in parallel
      const lines: string[] = [];
      if (charsToRest.length === 0) {
        lines.push('当前无角色需要休息，已仅推进时间。');
      } else {
        const results = await Promise.allSettled(
          charsToRest.map(async ({ charId, name }) => {
            const res = await apiFetch(`/api/characters/${charId}/rest`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rest_type: restType, campaign_id: Number(id) }),
            });
            if (!res.ok) throw new Error(`${name} 休息失败`);
            const data = await res.json();
            return { charId, name, data };
          })
        );

        // 4. Build summary
        for (const result of results) {
          if (result.status === 'fulfilled') {
            const { name, data, charId } = result.value;
            const hpInfo = restType === 'long'
              ? `HP 完全恢复（${data.current_hp}/${data.max_hp}）`
              : `d${data.hit_die}+${data.con_mod} → 恢复 ${data.healed} HP（${data.current_hp}/${data.max_hp}）`;
            lines.push(`${name}：${hpInfo}`);

            // Dispatch restGrant event for character sheet refresh
            publishAppEvent("restGrant", {
              restType,
              source: "dm-rest-all",
              characterId: charId,
              apiResponse: data,
            });
          } else {
            lines.push(`❌ ${result.reason?.message || '未知错误'}`);
          }
        }
      }

      // 5. Send chat message with results so all players see it
      const restLabel = restType === 'long' ? '长休' : '短休';
      const timeLabel = formatWorldTimeLabel(restType === 'short' ? shortRest(timeOfDay).newTime : longRest(timeOfDay).newTime);
      const chatMsg = `🛏️ **全队${restLabel}**\n时间已推进至：${timeLabel}\n${lines.join('\n')}`;
      sendMessage({ type: 'chat', data: { message: chatMsg, message_type: 'system' } });
      broadcastSystemNotice(`DM 发起了全队${restLabel}，当前时间：${timeLabel}`);
    } catch (e) {
      console.error('executeRest failed', e);
      showGlobalToast('执行休息失败', 'error');
    } finally {
      setRestProcessing(false);
      setRestConfirm(null);
    }
  }, [timeOfDay, sendMessage, campaignMembers, id, broadcastSystemNotice, formatWorldTimeLabel]);

  // Real-time clock: DM sends next second only after previous second is committed.
  const prevCombatActiveRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!timeOfDay.realTimeActive) {
      realtimePendingSeqRef.current = null;
      realtimePendingSinceRef.current = 0;
      return;
    }

    const interval = setInterval(() => {
      if (realtimePendingSeqRef.current !== null) {
        if (Date.now() - realtimePendingSinceRef.current <= 3500) return;
        realtimePendingSeqRef.current = null;
      }
      const baseTime = timeOfDayRef.current;
      if (!baseTime.realTimeActive) return;
      const newTime = advanceTimeBySeconds(baseTime, 1);
      const syncSeq = realtimeSyncSeqRef.current + 1;
      realtimeSyncSeqRef.current = syncSeq;
      realtimePendingSeqRef.current = syncSeq;
      realtimePendingSinceRef.current = Date.now();
      // One round elapses every 6 real-time seconds; tell the backend to run
      // the per-round settlement exactly when the tick crosses that boundary.
      const settlementRounds = newTime.second % 6 === 0 ? 1 : 0;
      sendMessageRef.current({
        type: "time_update",
        data: {
          ...newTime,
          sync_seq: syncSeq,
          requires_sync_ack: true,
          sync_mode: "realtime",
          settlement_rounds: settlementRounds,
        },
      });
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [timeOfDay.realTimeActive]);

  useEffect(() => {
    const prev = prevCombatActiveRef.current;
    prevCombatActiveRef.current = isCombatActive;

    if (prev === false && isCombatActive) {
      broadcastSystemNotice("进入战斗", "warning");
    }
  }, [isCombatActive, broadcastSystemNotice]);

  // Auto-pause real-time when combat starts
  useEffect(() => {
    if (isCombatActive && timeOfDay.realTimeActive) {
      const paused = { ...timeOfDay, realTimeActive: false };
      setTimeOfDay(paused);
      sendMessage({ type: "time_update", data: paused });
    }
  }, [isCombatActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Combat round advancement -> advance world time by 6 seconds
  useEffect(() => {
    const handler = () => {
      setTimeOfDay(prev => {
        const newTime = advanceTimeByRounds(prev, 1);
        // Combat round = world time +6s; backend settles this one round.
        sendMessage({ type: "time_update", data: { ...newTime, settlement_rounds: 1 } });
        return newTime;
      });
    };
    return subscribeAppEvent("combatNewRound", handler);
  }, [sendMessage]);

  useEffect(() => {
    setIsClient(true);
    return () => {
      // Cleanup campaign music on unmount
      useCampaignMusicStore.getState().cleanup();
    };
  }, []);

  useCampaignPanelOrchestration({
    isPhoneLike,
    setShowRightSidebar,
    openChatTab: () => setRightTab("chat"),
    listenForOpenRightPanelTab: true,
  });

  // Reset tool to "move" after anchor placement
  useEffect(() => {
    const handler = () => setSelectedTool("move");
    return subscribeAppEvent("anchorPlaced", handler);
  }, []);

  // Invalidate character roster cache on rest grant so spell slots / HP update
  // This runs at the route level (always mounted), unlike CharacterPanel which may be on a hidden tab
  useEffect(() => {
    const handler = () => {
      logger.debug("[DM] Rest grant received, invalidating roster cache");
      queryClient.invalidateQueries({ queryKey: ['campaign-roster'] });
    };
    return subscribeAppEvent("restGrant", handler);
  }, [queryClient]);

  // Cleanup map transition timeout on unmount
  useEffect(() => {
    return () => {
      if (mapTransitionTimeoutRef.current) {
        clearTimeout(mapTransitionTimeoutRef.current);
      }
    };
  }, []);

  useCampaignShellBootstrap({
    enabled: Boolean(isClient && id),
    campaignId: id,
    userId: currentUserId,
    notFoundMessage: "战役不存在或已被删除",
    navigateHome: () => navigate("/"),
    setCurrentMapUrl,
    setMapImageScale,
    setGridUnitLength,
    setGlobalTerrain,
    setIsCombatActive,
    onMissingTerrain: detectTerrain,
    onCampaignLoaded: (campaign) => {
      setBootstrappedCampaign(campaign);
      setCampaignData({
        name: campaign.name,
        description: campaign.description,
        cover_image: campaign.cover_image,
        metadata: campaign.metadata,
        max_players: campaign.max_players,
      });
      if (campaign.selected_module_id) {
        setSelectedModule(campaign.selected_module_id);
      }
      const mapSettings = campaign.metadata?.map_settings;
      if (mapSettings && (mapSettings.rotation !== undefined || mapSettings.flipH !== undefined || mapSettings.flipV !== undefined)) {
        setMapTransform({
          rotation: mapSettings.rotation ?? 0,
          flipH: mapSettings.flipH ?? false,
          flipV: mapSettings.flipV ?? false,
        });
        logger.debug("[DM] Loaded map transform from database:", mapSettings);
      }
      if (campaign.metadata?.show_ai_markers !== undefined) {
        setShowAIMarkers(campaign.metadata.show_ai_markers);
      }
      if (campaign.metadata?.time_of_day) {
        setTimeOfDay(normalizeTime(campaign.metadata.time_of_day));
      }
    },
    onError: (error) => {
      logger.error("[DM] Failed to load campaign state:", error);
    },
  });

  useEffect(() => {
    if (!id || !bootstrappedCampaign?.metadata?.auto_import_pending || !bootstrappedCampaign?.selected_module_id) {
      return;
    }

    let cancelled = false;

    const runAutoImport = async () => {
      logger.info("[DM] Auto import pending, starting import...");
      showGlobalToast({
        message: "正在自动导入模组资源...",
        type: "info",
        duration: 60000,
        slot: "dm-auto-import",
      });

      try {
        const importResponse = await apiFetch(`/api/campaigns/${id}/auto-import-all`, {
          method: "POST",
        });

        if (cancelled) {
          return;
        }

        if (importResponse.ok) {
          const importData = await importResponse.json();
          logger.info("[DM] Auto import completed:", importData);
          showGlobalToast({
            message: importData.message || "自动导入完成",
            type: "success",
            duration: 5000,
            slot: "dm-auto-import",
          });
          invalidateCampaignModuleMapsCache(id, currentUserId);
          setMapListRefreshTrigger((prev) => prev + 1);
        } else {
          logger.error("[DM] Auto import failed");
          showGlobalToast({
            message: "自动导入失败，请手动在模组面板中导入",
            type: "warning",
            duration: 6000,
            slot: "dm-auto-import",
          });
        }
      } catch (importError) {
        if (cancelled) {
          return;
        }
        logger.error("[DM] Auto import error:", importError);
        showGlobalToast({
          message: "自动导入出错，请手动在模组面板中导入",
          type: "warning",
          duration: 6000,
          slot: "dm-auto-import",
        });
      }
    };

    runAutoImport();

    return () => {
      cancelled = true;
    };
  }, [bootstrappedCampaign, currentUserId, id]);

  // Load campaign maps (not filtered by module - maps belong to campaign)
  useEffect(() => {
    const loadMaps = async () => {
      if (!id) return;
      try {
        const maps = await fetchCampaignModuleMapsCached(id, { userId: currentUserId });
        setModuleMaps(maps);
      } catch (error) {
        logger.error('[DM] Failed to load maps:', error);
        setModuleMaps([]);
      }
    };

    if (isClient && id) {
      loadMaps();
    }
  }, [isClient, id, currentUserId, mapListRefreshTrigger]);

  useEffect(() => {
    if (moduleMaps.length === 0) {
      setSelectedMap(null);
      return;
    }

    if (currentMapUrl) {
      const currentMap = moduleMaps.find((map: any) => map.url === currentMapUrl);
      setSelectedMap(currentMap || moduleMaps[0]);
      return;
    }

    setSelectedMap((prev: any | null) => prev || moduleMaps[0]);
  }, [moduleMaps, currentMapUrl]);

  // Handle module change and persist to database
  const handleModuleChange = async (moduleId: string) => {
    setSelectedModule(moduleId);

    // Persist to database
    try {
      const response = await apiFetch(`/api/campaigns/${id}/selected-module?module_id=${encodeURIComponent(moduleId)}`, {
        method: "POST",
      });

      if (response.ok) {
        logger.debug("[DM] Module saved to database:", moduleId);
      } else {
        logger.error("[DM] Failed to save module to database");
      }
    } catch (error) {
      logger.error("[DM] Error saving module to database:", error);
    }
  };

  // Callback when a map is added from ModuleScriptPanel
  const handleMapAdded = () => {
    logger.debug("[DM] Map added, refreshing map list...");
    if (id) {
      invalidateCampaignModuleMapsCache(id, currentUserId);
    }
    setMapListRefreshTrigger(prev => prev + 1);
  };

  // Callback when an item is added from ModuleScriptPanel
  const handleItemAdded = () => {
    logger.debug("[DM] Item added, refreshing items list...");
    setItemsRefreshTrigger(prev => prev + 1);
  };

  // Fetch campaign members function (extracted for reuse)
  const fetchCampaignMembers = useCallback(async () => {
    if (!id) return;
    try {
      const data = await fetchCampaignMembersCached(id, { userId: currentUserId });
      const membersList = (data || []).map((m: any) => ({
        user_id: m.user_id,
        role: m.role,
        character_name: m.character_name,
        display_name: m.display_name,
        selected_character_id: m.selected_character_id,
        is_virtual: m.is_virtual || false
      }));
      setCampaignMembers(membersList);
    } catch (error) {
      logger.error("[DM] Failed to load campaign members:", error);
    }
  }, [id, currentUserId]);

  // Update ref so WebSocket callback can access the latest function
  useEffect(() => {
    fetchCampaignMembersRef.current = fetchCampaignMembers;
  }, [fetchCampaignMembers]);

  // Fetch campaign members on mount
  useEffect(() => {
    fetchCampaignMembers();
  }, [fetchCampaignMembers]);

  // Fetch character details for player avatars when campaign members change
  useEffect(() => {
    const fetchPlayerAvatars = async () => {
      // Include all members with selected characters (both players and DM)
      const membersWithCharacters = campaignMembers.filter(
        m => m.selected_character_id
      );

      if (membersWithCharacters.length === 0) {
        setPlayerAvatars([]);
        return;
      }

      try {
        const avatarPromises = membersWithCharacters.map(async (member) => {
          try {
            const char = await fetchCharacterCached(member.selected_character_id!);
            if (!char) return null;
            return {
              id: char.id,
              name: char.name || member.character_name || 'Unknown',
              avatar_url: char.avatar || char.avatar_large,
              type: 'player' as const,
              userId: parseInt(member.user_id, 10),
              isOnline: id ? isOnline(id, member.user_id) : false
            };
          } catch {
            return null;
          }
        });

        const results = await Promise.all(avatarPromises);
        const validAvatars = results.filter((a): a is NonNullable<typeof a> => a !== null);
        setPlayerAvatars(validAvatars);
      } catch (error) {
        logger.error("[DM] Failed to load player avatars:", error);
      }
    };

    fetchPlayerAvatars();
  }, [campaignMembers, id, isOnline]);

  // Send image to chat handler
  const handleSendImageToChat = (imageUrl: string, description: string, recipient?: string, thumbnailUrl?: string) => {
    if (!imageUrl) {
      logger.error("[DM] Cannot send image - no URL provided");
      return;
    }

    // Build markdown: thumbnail as src, full image in title attribute for lightbox
    const thumb = thumbnailUrl || imageUrl;
    const messageContent = `![${description}](${thumb} "${imageUrl}")\n\n*${description}*`;

    const payload = {
      type: "chat",
      data: {
        message: messageContent,
        timestamp: Date.now(),
        ...(recipient ? { recipients: [recipient] } : {}),
      },
    };

    sendMessage(payload);
    logger.debug("[DM] Sent image to chat:", { description, recipient: recipient || "all" });

    // Switch to chat tab to show the sent message
    publishAppEvent("openRightPanelTab", { tab: "chat" });
  };

  // Callback when a map is deleted
  const handleMapDelete = async (mapId: string) => {
    if (!id) {
      logger.error("[DM] Cannot delete map - missing campaign id");
      return;
    }

    try {
      logger.debug("[DM] Deleting map:", mapId);
      const response = await apiFetch(
        `/api/campaigns/${id}/module-maps/remove?map_id=${mapId}`,
        {
          method: 'DELETE',
        }
      );

      if (response.ok) {
        const result = await response.json();
        logger.debug("[DM] Map deleted successfully:", result);

        // Refresh map list
        invalidateCampaignModuleMapsCache(id, currentUserId);
        setMapListRefreshTrigger(prev => prev + 1);
      } else {
        logger.error("[DM] Failed to delete map:", await response.text());
      }
    } catch (error) {
      logger.error("[DM] Error deleting map:", error);
    }
  };

  // Callback when a map is added to library
  const handleAddToLibrary = async (map: any) => {
    try {
      logger.debug("[DM] Adding map to library:", map.name);
      const response = await apiFetch(
        "/api/map-library",
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: map.name,
            url: map.url,
            source_type: map.metadata?.generated ? "ai_generated" : "module",
            environment: map.metadata?.environment,
            description: map.metadata?.source_description || map.chapter,
          }),
        }
      );

      if (response.ok) {
        logger.debug("[DM] Map added to library successfully");
        alert(`地图「${map.name}」已加入地图库`);
      } else {
        const err = await response.json();
        logger.error("[DM] Failed to add map to library:", err);
        alert(err.detail || "添加失败");
      }
    } catch (error) {
      logger.error("[DM] Error adding map to library:", error);
      alert("添加失败");
    }
  };

  // Handle map scale change (debounced persist + broadcast)
  const scaleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleMapScaleChange = useCallback((newScale: number) => {
    logger.debug("[DM] handleMapScaleChange called with scale:", newScale);
    setMapImageScale(newScale);

    if (!currentMapUrl || !id) return;

    // 防抖：拖拽滑块时只更新 UI，300ms 内无新操作才保存+广播
    if (scaleDebounceRef.current) clearTimeout(scaleDebounceRef.current);
    scaleDebounceRef.current = setTimeout(async () => {
      try {
        const response = await apiFetch(`/api/map-settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaign_id: parseInt(id),
            map_url: currentMapUrl,
            scale: newScale,
          }),
        });
        if (response.ok) {
          logger.debug("[DM] Map scale saved:", newScale);
          sendMessage({
            type: "map_scale_update",
            data: { map_url: currentMapUrl, scale: newScale },
          });
        }
      } catch (error) {
        logger.error("[DM] Error saving map scale:", error);
      }
    }, 300);
  }, [currentMapUrl, id, sendMessage]);

  // Handle map transform change (rotation, flip)
  const handleMapTransformChange = async (newTransform: { rotation: number; flipH: boolean; flipV: boolean }) => {
    logger.debug("[DM] handleMapTransformChange called with transform:", newTransform);
    setMapTransform(newTransform);

    if (!id) {
      logger.warn("[DM] Cannot save/broadcast transform change - missing campaign id");
      return;
    }

    // Persist to database
    try {
      const response = await apiFetch(`/api/campaigns/${id}/map-settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rotation: newTransform.rotation,
          flipH: newTransform.flipH,
          flipV: newTransform.flipV,
        }),
      });

      if (response.ok) {
        logger.debug("[DM] ✅ Map transform saved to database:", newTransform);

        // Broadcast transform change to all players via WebSocket
        const message = {
          type: "map_update",
          data: {
						map_url: currentMapUrl,
						map_settings: {
              rotation: newTransform.rotation,
              flipH: newTransform.flipH,
              flipV: newTransform.flipV,
            },
          },
        };
        logger.debug("[DM] 📡 Sending WebSocket transform message:", message);
        sendMessage(message);
        logger.debug("[DM] ✅ WebSocket transform message sent");
      } else {
        logger.error("[DM] ❌ Failed to save map transform to database");
      }
    } catch (error) {
      logger.error("[DM] ❌ Error saving map transform to database:", error);
    }
  };

  // Handle grid unit length change
  const handleGridUnitLengthSave = async (newValue: number) => {
    logger.debug("[DM] handleGridUnitLengthSave called with value:", newValue);
    setGridUnitLength(newValue);

    if (!currentMapUrl || !id) {
      logger.warn("[DM] Cannot save grid unit length - missing currentMapUrl or id");
      return;
    }

    // Persist to database
    try {
      const response = await apiFetch(`/api/map-settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          campaign_id: parseInt(id),
          map_url: currentMapUrl,
          scale: mapImageScale, // 保留现有 scale
          grid_unit_length: newValue,
        }),
      });

      if (response.ok) {
        logger.debug("[DM] ✅ Grid unit length saved to database:", newValue);

        // Broadcast grid unit length change to all players via WebSocket
        const message = {
          type: "grid_unit_update",
          data: {
						map_url: currentMapUrl,
						grid_unit_length: newValue,
          },
        };
        logger.debug("[DM] 📡 Sending WebSocket message:", message);
        sendMessage(message);
        logger.debug("[DM] ✅ WebSocket message sent");
      } else {
        logger.error("[DM] ❌ Failed to save grid unit length to database");
      }
    } catch (error) {
      logger.error("[DM] ❌ Error saving grid unit length to database:", error);
    }
  };

  // 全图迷雾处理
  const handleFillFogOfWar = () => {
    logger.debug("[DM] Fill entire map with fog of war");
    // 通过WebSocket通知地图进行全图迷雾
    sendMessage({
      type: "fog_fill_all",
			data: { map_url: currentMapUrl }
    });
    // 通知TacticalMap通过ref
    (window as any).__fillFogOfWar?.();
  };

  // 清除全图迷雾处理
  const handleClearFogOfWar = () => {
    logger.debug("[DM] Clear all fog of war");
    // 通过WebSocket通知地图清除全图迷雾
    sendMessage({
      type: "fog_clear_all",
			data: { map_url: currentMapUrl }
    });
    // 通知TacticalMap通过ref
    (window as any).__clearFogOfWar?.();
  };

  // 清除全图地形处理
  const handleClearAllTerrain = () => {
    logger.debug("[DM] Clear all terrain");
    sendMessage({
      type: "terrain_clear_all",
      data: { map_url: currentMapUrl }
    });
    (window as any).__clearAllTerrain?.();
  };

  // 切换地形对玩家可见性
  const handleShowTerrainToPlayersChange = (show: boolean) => {
    setShowTerrainToPlayers(show);
    sendMessage({
      type: "terrain_visibility",
      data: { visible: show }
    });
  };

  // 清除当前地图所有标记
  const handleClearAllMarkers = async () => {
    if (!currentMapUrl || !id) return;
    if (!confirm("确定要清除当前地图的所有标记吗？")) return;

    try {
      const response = await apiFetch(
        `/api/campaigns/${id}/markers?map_url=${encodeURIComponent(currentMapUrl)}`,
        { method: "DELETE", userId: currentUserId }
      );
      if (response.ok) {
        logger.debug("[DM] All markers cleared for map:", currentMapUrl);
      } else {
        logger.error("[DM] Failed to clear markers");
        alert("清除标记失败");
      }
    } catch (error) {
      logger.error("[DM] Error clearing markers:", error);
      alert("清除标记失败");
    }
  };

  // Handle AI marker visibility toggle - broadcast via WebSocket
  const handleAIMarkerToggle = (show: boolean) => {
    sendMessage({
      type: "ai_marker_toggle",
      data: { show_ai_markers: show },
    });
    logger.debug("[DM] Broadcasting AI marker visibility:", show);
  };

  // Handle saving campaign settings
  const handleSaveCampaignSettings = async (data: { name: string; description: string; cover_image: string | null; metadata?: { enable_deity_system?: boolean; enable_3d_dice?: boolean }; max_players?: number }) => {
    if (!id) return;

    // Merge new metadata with existing metadata
    const mergedMetadata = {
      ...campaignData.metadata,
      ...data.metadata,
    };

    const response = await apiFetch(`/api/campaigns/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.name,
        description: data.description,
        cover_image: data.cover_image,
        metadata: mergedMetadata,
        max_players: data.max_players,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "保存失败");
    }

    // Update local state
    setCampaignData({
      name: data.name,
      description: data.description,
      cover_image: data.cover_image || undefined,
      metadata: mergedMetadata,
      max_players: data.max_players,
    });

    // Invalidate rule-options cache so wizard picks up new toggles (e.g. deity system)
    queryClient.invalidateQueries({ queryKey: ['ruleOptions', id] });

    logger.debug("[DM] Campaign settings saved:", data);
  };

  if (!isClient) {
    return <LoadingScreen />;
  }

  return (
    <div className="h-dvh flex flex-col bg-gray-900">
      {/* Level Up Notification */}
      <LevelUpNotification />

      {/* 顶部导航栏 */}
      <CampaignHeader
        campaignId={id || ""}
        campaignName={campaignData.name}
        isConnected={isConnected}
        connectionHealth={connectionHealth}
        showGrid={showGrid}
        onShowGridChange={setShowGrid}
        showFogOfWar={showFogOfWar}
        onShowFogOfWarChange={setShowFogOfWar}
        showLeftSidebar={showLeftSidebar}
        onToggleLeftSidebar={() => setShowLeftSidebar(!showLeftSidebar)}
        showRightSidebar={showRightSidebar}
        onToggleRightSidebar={() => setShowRightSidebar(!showRightSidebar)}
        onNavigateToPlayer={() => {
          const basePath = typeof import.meta.env?.BASE_URL === 'string'
            ? import.meta.env.BASE_URL.replace(/\/$/, '')
            : '';
          window.location.href = `${basePath}/campaign/${id}/player`;
        }}
        onExit={() => {
          const basePath = typeof import.meta.env?.BASE_URL === 'string'
            ? import.meta.env.BASE_URL.replace(/\/$/, '')
            : '';
          window.location.href = `${basePath}/`;
        }}
        isDM={true}
        onOpenSettings={() => setShowSettingsDialog(true)}
        timeOfDay={timeOfDay}
        onTimeSettingClick={() => setShowTimeModal(true)}
        onAdvanceRound={handleAdvanceRound}
        onToggleRealTime={handleToggleRealTime}
        isRealTimeActive={timeOfDay.realTimeActive}
        onShortRest={handleShortRest}
        onLongRest={handleLongRest}
        globalTerrain={globalTerrain}
        onGlobalTerrainChange={handleGlobalTerrainChange}
        isDetectingTerrain={isDetectingTerrain}
        sendMessage={sendMessage}
      />

      {/* 主内容区 */}
      <div className="flex-1 relative overflow-hidden bg-gray-950">
        {/* 左侧工具栏 - fixed 定位 */}
        <div
          className={`
            fixed left-0 top-[calc(44px+var(--sat,0px))]
            ${showLeftSidebar ? 'w-16' : 'w-0'}
            transition-all duration-300
            z-[200]
            pointer-events-none
          `}
        >
          {showLeftSidebar && (
            <ToolbarV2
              selectedTool={selectedTool}
              onToolChange={(tool) => {
                setSelectedTool(tool);
                if (tool !== "draw") {
                  setDrawTool(null);
                }
                if (tool !== "ruler") {
                  setRulerMode(null);
                }
              }}
              fogMode={fogMode}
              onFogModeChange={setFogMode}
              fogBrushSize={fogBrushSize}
              onFogBrushSizeChange={setFogBrushSize}
              onFillFogOfWar={handleFillFogOfWar}
              onClearFogOfWar={handleClearFogOfWar}
              terrainType={terrainType}
              onTerrainTypeChange={setTerrainType}
              terrainBrushSize={terrainBrushSize}
              onTerrainBrushSizeChange={setTerrainBrushSize}
              terrainMode={terrainMode}
              onTerrainModeChange={setTerrainMode}
              onClearAllTerrain={handleClearAllTerrain}
              showTerrainToPlayers={showTerrainToPlayers}
              onShowTerrainToPlayersChange={handleShowTerrainToPlayersChange}
              rulerMode={rulerMode}
              onRulerModeChange={setRulerMode}
              drawTool={drawTool}
              onDrawToolChange={setDrawTool}
              drawColor={drawColor}
              onDrawColorChange={setDrawColor}
              drawStrokeWidth={drawStrokeWidth}
              onDrawStrokeWidthChange={setDrawStrokeWidth}
              onUndoLastDrawing={async () => {
                try {
                  const response = await apiFetch(
                    `/api/campaigns/${id}/drawings/undo?map_url=${encodeURIComponent(currentMapUrl || "")}`,
                    { method: "POST" }
                  );
                  if (response.ok) {
                    const result = await response.json();
                    if (result.status === "success" && result.drawing_id) {
                      logger.debug("[DM] Drawing undone:", result.drawing_id);
                      // Broadcast to all clients via WebSocket
                      sendMessage({
                        type: "drawing_removed",
                        data: { drawing_id: result.drawing_id }
                      });
                      setDrawingsRefreshVersion((version) => version + 1);
                    } else {
                      logger.debug("[DM] No drawing to undo");
                      alert("没有可撤销的绘图");
                    }
                  }
                } catch (error) {
                  logger.error("[DM] Failed to undo drawing:", error);
                  alert("撤销失败，请重试");
                }
              }}
              onGridUnitSettingsClick={() => setShowGridUnitDialog(true)}
              markerIcon={markerIcon}
              onMarkerIconChange={setMarkerIcon}
              markerColor={markerColor}
              onMarkerColorChange={setMarkerColor}
              onClearAllMarkers={handleClearAllMarkers}
              tokenMode={tokenMode}
              onTokenModeChange={setTokenMode}
              isDM={true}
              showAIMarkers={showAIMarkers}
              onShowAIMarkersChange={handleAIMarkerToggle}
              onJumpToAnchor={() => { (window as any).__jumpToAnchor?.(); setSelectedTool("move"); }}
              onSetAnchorMode={() => setSelectedTool("setAnchor")}
              onClearAnchor={() => { (window as any).__clearAnchor?.(); setSelectedTool("move"); }}
            />
          )}
        </div>

        {/* 中间地图区域 - 全宽，左右侧栏都使用 fixed 定位覆盖在上方 */}
        <div className="h-full w-full relative">
          {/* Loading overlay - shown during map switch */}
          {isMapTransitioning && (
            <div className="absolute inset-0 bg-gray-900 flex items-center justify-center z-50">
              <div className="text-white text-lg animate-pulse">切换地图中...</div>
            </div>
          )}
          <TacticalMap
            campaignId={id!}
            isDM={true}
            selectedTool={selectedTool}
            showGrid={showGrid}
            showFogOfWar={showFogOfWar}
            currentMapUrl={currentMapUrl}
            drawingsRefreshVersion={drawingsRefreshVersion}
            mapImageScale={mapImageScale}
            mapTransform={mapTransform}
            fogMode={fogMode}
            fogBrushSize={fogBrushSize}
            terrainType={terrainType}
            terrainMode={terrainMode}
            terrainBrushSize={terrainBrushSize}
            showTerrainToPlayers={showTerrainToPlayers}
            globalTerrain={globalTerrain}
            rulerMode={rulerMode}
            drawTool={drawTool}
            drawColor={drawColor}
            drawStrokeWidth={drawStrokeWidth}
            onDrawStrokeWidthChange={setDrawStrokeWidth}
            gridUnitLength={gridUnitLength}
            markerIcon={markerIcon}
            markerColor={markerColor}
            tokenMode={tokenMode}
            userId={currentUserId}
            showAIMarkers={showAIMarkers}
            onGridUnitLengthClick={() => setShowGridUnitDialog(true)}
            isTransitioning={isMapTransitioning}
            playerAvatars={playerAvatars}
            rightSidebarWidth={rightSidebarWidth}
            showRightSidebar={showRightSidebar}
            isResizing={isResizing}
            timeOfDay={timeOfDay}
            hotbarTargeting={hotbarTargeting ? {
              slot: hotbarTargeting.slot,
              sourceCharacterId: hotbarTargeting.sourceCharacterId,
              targetingType: hotbarTargeting.targetingType,
              abilityData: hotbarTargeting.abilityData,
              spellData: hotbarTargeting.spellData,
            } : null}
            onHotbarTargetSelect={(targetTokenId: number, targetName: string, distanceFeet: number, targetExtra?: {
              currentHp?: number; maxHp?: number; monsterType?: string;
            }) => {
              if (!hotbarTargeting) return;
              if (hotbarTargeting.targetingType === 'spell' && hotbarTargeting.spellData) {
                const { spell, slotLevel, sourceTokenId, illusionImageUrl, illusionDesc, illusionDisplayName, selectedOption, materialId, ritualCast, freecast, runtimeAction, isMultiTarget, maxTargets, longCast, confirmBreakConcentration } = hotbarTargeting.spellData;
                // Multi-target spell (e.g. Bless): accumulate selections until the user
                // confirms via the banner button or fills the max. Toggle off if reselected.
                if (isMultiTarget) {
                  const current = hotbarTargeting.selectedTargetIds || [];
                  const alreadyIdx = current.indexOf(targetTokenId);
                  let next: number[];
                  if (alreadyIdx >= 0) {
                    next = current.filter((tid) => tid !== targetTokenId);
                  } else {
                    if (typeof maxTargets === 'number' && current.length >= maxTargets) {
                      // At cap — replace the earliest selection so the click is meaningful.
                      next = [...current.slice(1), targetTokenId];
                    } else {
                      next = [...current, targetTokenId];
                    }
                  }
                  setHotbarTargeting({ ...hotbarTargeting, selectedTargetIds: next });
                  return;
                }
                publishAppEvent("sidebarSpellCast", {
                  spell,
                  sourceTokenId,
                  targetTokenId,
                  slotLevel,
                  characterId: hotbarTargeting.sourceCharacterId,
                  illusionImageUrl,
                  illusionDesc,
                  illusionDisplayName,
                  selectedOption,
                  materialId,
                  ritualCast,
                  freecast,
                  runtimeAction,
                  longCast,
                  confirmBreakConcentration,
                });
                setHotbarTargeting(null);
              } else if (hotbarTargeting.targetingType === 'ability' && hotbarTargeting.abilityData) {
                setAbilityConfirm({
                  abilityId: hotbarTargeting.abilityData.abilityId,
                  sourceCharacterId: hotbarTargeting.sourceCharacterId,
                  targetTokenId,
                  targetName,
                  distanceFeet,
                  targetMonsterType: targetExtra?.monsterType,
                  poolCurrent: hotbarTargeting.abilityData.poolCurrent,
                  poolMax: hotbarTargeting.abilityData.poolMax,
                  spellSlotLevel: hotbarTargeting.abilityData.spellSlotLevel,
                });
              } else {
                setHotbarConfirm({
                  slot: hotbarTargeting.slot,
                  sourceCharacterId: hotbarTargeting.sourceCharacterId,
                  targetTokenId,
                  targetName,
                  distanceFeet,
                });
              }
              setHotbarTargeting(null);
            }}
            onHotbarTargetCancel={() => setHotbarTargeting(null)}
            onStartSpellTargeting={({ spell, slotLevel, sourceTokenId, characterId, freecast, illusionImageUrl, illusionDesc, illusionDisplayName, selectedOption, materialId, ritualCast, runtimeAction, longCast, confirmBreakConcentration }) => {
              const rangeStr = spell.range || '';
              let numericRange = 999;
              if (rangeStr.includes('触及') || rangeStr.toLowerCase().includes('touch')) numericRange = 5;
              else { const m = rangeStr.match(/(\d+)/); if (m) numericRange = parseInt(m[1], 10); }

              const multi = runtimeAction ? { isMultiTarget: false, maxTargets: 1 } : resolveMultiTargetSpec(spell, slotLevel);
              setHotbarTargeting({
                slot: { type: 'spell', id: spell.id, name: spell.name, meta: { normalRange: numericRange } },
                slotIndex: spellHotbarIndexRef.current,
                sourceCharacterId: characterId,
                targetingType: 'spell',
                spellData: {
                  spell,
                  slotLevel,
                  sourceTokenId,
                  illusionImageUrl,
                  illusionDesc,
                  illusionDisplayName,
                  selectedOption,
                  materialId,
                  ritualCast,
                  freecast,
                  runtimeAction,
                  longCast,
                  confirmBreakConcentration,
                  isMultiTarget: multi.isMultiTarget,
                  maxTargets: multi.maxTargets,
                },
                selectedTargetIds: multi.isMultiTarget ? [] : undefined,
              });
              spellHotbarIndexRef.current = -1;
            }}
          />
        </div>

        <CampaignRightSidebarShell
          showRightSidebar={showRightSidebar}
          isSidebarFullscreen={isSidebarFullscreen}
          isResizing={isResizing}
          rightSidebarWidth={rightSidebarWidth}
          onCloseMobileOverlay={() => setShowRightSidebar(false)}
          onExitFullscreen={() => setIsSidebarFullscreen(false)}
          onStartResize={() => setIsResizing(true)}
        >
          <DMRightPanel
                campaignId={id || ""}
                currentUserId={currentUserId}
                moduleMaps={moduleMaps}
                selectedMap={selectedMap}
                selectedModule={selectedModule || ''}
                mapImageScale={mapImageScale}
                mapTransform={mapTransform}
                currentMapUrl={currentMapUrl}
                onSelectMap={setSelectedMap}
                onMapUse={handleMapUse}
                onModuleChange={handleModuleChange}
                onMapScaleChange={handleMapScaleChange}
                onMapTransformChange={handleMapTransformChange}
                onMapAdded={handleMapAdded}
                onMapDelete={handleMapDelete}
                onAddToLibrary={handleAddToLibrary}
                onSendImageToChat={handleSendImageToChat}
                onItemAdded={handleItemAdded}
                itemsRefreshTrigger={itemsRefreshTrigger}
                members={campaignMembers}
                rightTab={rightTab}
                setRightTab={setRightTab}
                getSubTab={getSubTab}
                setSubTab={setSubTab}
                isCollapsed={!showRightSidebar}
                onToggleCollapse={() => setShowRightSidebar(!showRightSidebar)}
                isSidebarFullscreen={isSidebarFullscreen}
                onToggleFullscreen={() => setIsSidebarFullscreen(!isSidebarFullscreen)}
                isCombatActive={isCombatActive}
                onSelectedCharacterChange={(_id, char) => setHotbarCharacter(char)}
                dmSelectedCharacterId={dmSelectedCharacterId}
                onDmSelectedCharacterIdChange={setDmSelectedCharacterId}
                getSpellExpandedLevels={getSpellExpandedLevels}
                toggleSpellExpandedLevel={toggleSpellExpandedLevel}
                unreadCount={unreadCount}
                enable3DDice={campaignData.metadata?.enable_3d_dice ?? true}
                sendMessage={sendMessage}
                floatingCharPanel={floatingCharPanel}
                setFloatingCharPanel={setFloatingCharPanel}
                globalTerrain={globalTerrain}
                timeOfDay={timeOfDay}
                showChatInSidebar={isPhoneLike}
              />
        </CampaignRightSidebarShell>

        <CampaignFloatingOverlayShell
          isPhoneLike={isPhoneLike}
          desktopChat={(
            <Suspense fallback={null}>
              <LazyFloatingChatWindow
                isDM={true}
                campaignId={id || ""}
                userId={currentUserId}
                currentMapUrl={currentMapUrl}
                activeSubTab={getSubTab('chat', 'chat')}
                onSubTabChange={(tab) => setSubTab('chat', tab)}
                floatingChat={floatingChat}
                setFloatingChat={setFloatingChat}
                unreadCount={unreadCount}
                selectedModule={selectedModule}
                enable3DDice={campaignData.metadata?.enable_3d_dice ?? true}
              />
            </Suspense>
          )}
          filterPanels={(
            <Suspense fallback={null}>
              <LazyFloatingFilterPanels campaignId={id || ""} userId={currentUserId} isDM={true} />
            </Suspense>
          )}
        />

        {/* Hotbar - 快捷操作栏 */}
        <Hotbar
          character={hotbarCharacter}
          rightSidebarWidth={rightSidebarWidth}
          showRightSidebar={showRightSidebar}
          showLeftSidebar={showLeftSidebar}
          expanded={hotbarExpanded}
          onExpandedChange={setHotbarExpanded}
          activeSlotIndex={hotbarTargeting?.slotIndex ?? null}
          onSlotActivate={(slot, index) => {
            if (!hotbarCharacter?.id) return;
            // Breath weapon feature → dispatch area attack event
            if (slot.type === 'feature' && (slot.id === 'Breath Weapon' || slot.name === '吐息武器')) {
              const race = (racesData as any).races?.find((r: any) => r.id === hotbarCharacter.race_id);
              const subrace = race?.subraces?.find((sr: any) => sr.id === hotbarCharacter.subrace_id);
              if (subrace?.breathWeapon) {
                const bw = subrace.breathWeapon;
                const level = hotbarCharacter.level || 1;
                const bwTrait = race.traits?.find((t: any) => t.nameEn === 'Breath Weapon');
                let dice = '2d6';
                if (bwTrait?.damage?.length) {
                  for (const d of bwTrait.damage) { if (d.level <= level) dice = d.dice; }
                }
                const conScore = hotbarCharacter.ability_scores?.constitution ?? 10;
                const conMod = Math.floor((conScore - 10) / 2);
                const profBonus = Math.floor((level - 1) / 4) + 2;
                publishAppEvent("startBreathWeapon", {
                  sourceCharacterId: hotbarCharacter.id,
                  breathWeapon: bw,
                  damageType: subrace.damageType,
                  damageTypeCn: subrace.damageTypeCn,
                  damageDice: dice,
                  subraceName: subrace.name,
                  saveDC: 8 + profBonus + conMod,
                });
              }
              return;
            }
            // Spell casting is handled by HotbarSlotItem's UnifiedSpellCastDialog (via onCastSpell)
            if (slot.type !== 'weapon') return;
            // Toggle off if same slot clicked again
            if (hotbarTargeting?.slotIndex === index) {
              setHotbarTargeting(null);
              return;
            }
            // Enrich slot with fresh range data from current equipment (handles stale hotbar)
            let enrichedSlot = slot;
            if (hotbarCharacter?.equipment) {
              const isMain = slot.id?.startsWith('attack_main_') || slot.id?.startsWith('throw_main_');
              const isOff = slot.id?.startsWith('attack_off_') || slot.id?.startsWith('throw_off_');
              const eqSlot = isMain ? 'main_hand' : isOff ? 'off_hand' : null;
              if (eqSlot) {
                const eqItem = (hotbarCharacter.equipment as any[]).find((eq: any) => eq.equippedSlot === eqSlot);
                if (eqItem?.range && typeof eqItem.range === 'object' && eqItem.range.normal) {
                  const nr = eqItem.range.normal;
                  const mr = eqItem.range.long || nr;
                  if (slot.meta?.normalRange !== nr || slot.meta?.maxRange !== mr) {
                    enrichedSlot = { ...slot, meta: { ...slot.meta, normalRange: nr, maxRange: mr, range: eqItem.range } };
                  }
                }
              }
            }
            setHotbarTargeting({ slot: enrichedSlot, slotIndex: index, sourceCharacterId: hotbarCharacter.id });
          }}
          onCastSpell={(castData, slotIndex) => {
            if (!hotbarCharacter?.id) return;
            spellHotbarIndexRef.current = slotIndex;
            castSpellAction(castData.spell, castData.level, hotbarCharacter.id, {
              campaignId: id, currentMapUrl, userId: currentUserId,
              freecast: castData.freecast,
              ritualCast: castData.ritualCast,
              confirmBreakConcentration: castData.confirmBreakConcentration,
              illusionImageUrl: castData.illusionData?.imageUrl,
              illusionDesc: castData.illusionData?.description,
              illusionDisplayName: castData.illusionData?.displayName,
              areaSize: castData.areaSize,
              selectedOption: castData.selectedOption,
              materialId: castData.materialId,
              targetingMode: castData.targetingMode,
            });
          }}
          userId={currentUserId}
          isDM={true}
          castingSpellName={castingSpellName}
          onConsumeMaterial={(materialId) => {
            if (!hotbarCharacter?.id) return;
            const next = consumeMaterial(hotbarCharacter.equipment || [], materialId);
            apiFetch(`/api/characters/${hotbarCharacter.id}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                equipment: next,
                broadcast_campaign_id: id,
              }),
            }).catch(() => {});
            setHotbarCharacter((prev: any) => prev ? { ...prev, equipment: next } : prev);
          }}
          onUseResource={async (resourceId, amount) => {
            if (!hotbarCharacter?.id) return null;
            // Divine Intervention: special d100 roll flow
            if (resourceId === 'divine_intervention') {
              const charLevel = hotbarCharacter?.level || 1;
              const charName = hotbarCharacter?.name || '牧师';
              const autoSuccess = charLevel >= 20;
              const roll = autoSuccess ? 1 : Math.floor(Math.random() * 100) + 1;
              const success = autoSuccess || roll <= charLevel;
              const resultEmoji = success ? '✨' : '😔';
              const msg = autoSuccess
                ? `🙏 **${charName}** 使用了 **神圣干预**！\n20级牧师——神祇自动响应！${resultEmoji}`
                : `🙏 **${charName}** 使用了 **神圣干预**！\n🎲 百分骰: **${roll}** / 需要 ≤ **${charLevel}**\n结果: ${success ? `**成功！** 神祇响应了祈祷！${resultEmoji}` : `**失败** — 神祇沉默不语 ${resultEmoji}`}`;
              sendMessage({ type: 'chat', data: { message: msg } });
              try {
                const resp = await apiFetch(`/api/characters/${hotbarCharacter.id}/resources/use`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ resource_id: resourceId, amount, campaign_id: id ? parseInt(id) : undefined }),
                });
                if (!resp.ok) return null;
                const data = await resp.json();
                publishAppEvent("classFeatureUsesUpdated", { characterId: hotbarCharacter.id });
                playResourceSound('divine_sense');
                return data.current ?? null;
              } catch { return null; }
            }
            try {
              const resp = await apiFetch(`/api/characters/${hotbarCharacter.id}/resources/use`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resource_id: resourceId, amount, campaign_id: id ? parseInt(id) : undefined }),
              });
              if (!resp.ok) return null;
              const data = await resp.json();
              publishAppEvent("classFeatureUsesUpdated", { characterId: hotbarCharacter.id });
              playResourceSound(resourceId);
              const res = findResourceByIdOrSlot(resourceId);
              showCharacterBubble({
                characterId: hotbarCharacter.id,
                characterName: hotbarCharacter?.name || '',
                message: `使用了 ${res?.name || resourceId}`,
                type: 'action',
                avatarUrl: hotbarCharacter?.avatar_url,
              });
              return data.current ?? null;
            } catch { return null; }
          }}
          onStartTargeting={(resourceId, poolCurrent, poolMax) => {
            if (!hotbarCharacter?.id) return;
            publishAppEvent("startAbilityTargeting", {
              abilityId: resourceId,
              poolCurrent,
              poolMax,
              sourceCharacterId: hotbarCharacter.id,
            });
          }}
          onStartSmiteTargeting={(resourceId, spellSlotLevel) => {
            if (!hotbarCharacter?.id) return;
            publishAppEvent("startAbilityTargeting", {
              abilityId: resourceId,
              poolCurrent: 0,
              poolMax: 0,
              sourceCharacterId: hotbarCharacter.id,
              spellSlotLevel,
            });
          }}
          onConsumeSpellSlot={(level: number, resourceId: string) => {
            if (!hotbarCharacter?.id) return;
            publishAppEvent("consumeSpellSlot", { level, characterId: hotbarCharacter.id });
            apiFetch(`/api/characters/${hotbarCharacter.id}/resources/use`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ resource_id: resourceId, amount: 1, spell_slot_level: level, campaign_id: id ? parseInt(id) : undefined }),
            }).catch(() => {});
          }}
        />

        {/* Hotbar targeting banner */}
        {hotbarTargeting && (() => {
          const isSmite = hotbarTargeting.targetingType === 'ability' && hotbarTargeting.abilityData?.abilityId === 'divine_smite';
          const isAbility = hotbarTargeting.targetingType === 'ability' && !isSmite;
          const isMultiSpell = hotbarTargeting.targetingType === 'spell' && !!hotbarTargeting.spellData?.isMultiTarget;
          const bannerClass = isAbility
            ? 'bg-emerald-900/90 border border-emerald-600/60 text-emerald-200'
            : 'bg-amber-900/90 border border-amber-600/60 text-amber-200';
          const btnClass = isAbility
            ? 'text-emerald-400 hover:text-emerald-200'
            : 'text-amber-400 hover:text-amber-200';
          const selectedCount = hotbarTargeting.selectedTargetIds?.length ?? 0;
          const maxTargets = hotbarTargeting.spellData?.maxTargets ?? 1;
          const onConfirmMulti = () => {
            if (!hotbarTargeting?.spellData?.isMultiTarget) return;
            if (selectedCount === 0) return;
            const sd = hotbarTargeting.spellData;
            publishAppEvent("sidebarSpellCast", {
              spell: sd.spell,
              sourceTokenId: sd.sourceTokenId,
              targetTokenIds: hotbarTargeting.selectedTargetIds || [],
              slotLevel: sd.slotLevel,
              characterId: hotbarTargeting.sourceCharacterId,
              illusionImageUrl: sd.illusionImageUrl,
              illusionDesc: sd.illusionDesc,
              illusionDisplayName: sd.illusionDisplayName,
              selectedOption: sd.selectedOption,
              materialId: sd.materialId,
              ritualCast: sd.ritualCast,
              freecast: sd.freecast,
              runtimeAction: sd.runtimeAction,
              longCast: sd.longCast,
              confirmBreakConcentration: sd.confirmBreakConcentration,
            });
            setHotbarTargeting(null);
          };
          return (
          <div className="fixed top-0 left-0 right-0 z-[400] flex justify-center pointer-events-none">
            <div className={`mt-2 px-4 py-2 rounded-lg text-sm shadow-lg pointer-events-auto
                          flex items-center gap-2 backdrop-blur-sm ${bannerClass}`}>
              <span className="animate-pulse">{isSmite ? '⚔' : isAbility ? '✋' : '⚔'}</span>
              {isMultiSpell
                ? `选择 ${hotbarTargeting.slot.name} 目标（已选 ${selectedCount}/${maxTargets}）`
                : isSmite
                  ? `选择惩击目标 — ${hotbarTargeting.slot.name}`
                  : isAbility
                    ? `选择治疗目标 — ${hotbarTargeting.slot.name}`
                    : `选择攻击目标 — ${hotbarTargeting.slot.name}`}
              {isMultiSpell && (
                <button
                  onClick={onConfirmMulti}
                  disabled={selectedCount === 0}
                  className={`ml-2 text-xs px-2 py-0.5 rounded border border-amber-600/60 ${selectedCount === 0 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-amber-700/50'}`}
                >确认施法</button>
              )}
              <button
                onClick={() => setHotbarTargeting(null)}
                className={`ml-2 text-xs ${btnClass}`}
              >(ESC 取消)</button>
            </div>
          </div>);
        })()}

        {/* Hotbar attack confirm modal */}
        {hotbarConfirm && (
          <HotbarAttackConfirmModal
            open={true}
            slot={hotbarConfirm.slot}
            targetName={hotbarConfirm.targetName}
            distanceFeet={hotbarConfirm.distanceFeet}
            attackInfo={hotbarCharacter ? computeAttackInfo(hotbarConfirm.slot, hotbarCharacter) : null}
            character={hotbarCharacter}
            isDM={true}
            onCancel={() => setHotbarConfirm(null)}
            onConfirm={(modifiers) => {
              const { slot, sourceCharacterId, targetTokenId } = hotbarConfirm;
              // Detect thrown weapon slots
              const isThrowSlot = slot.id?.startsWith('throw_') || slot.id?.startsWith('improvthrow_');
              const isImprovisedThrow = slot.id?.startsWith('improvthrow_');
              let thrownWeaponItem: any = undefined;
              if (isThrowSlot && hotbarCharacter?.equipment) {
                const idParts = slot.id?.replace('improvthrow_', '').replace('throw_', '') || '';
                const isOff = idParts.startsWith('off_');
                const weaponId = idParts.replace(/^(main|off)_/, '');
                const equippedSlot = isOff ? 'off_hand' : 'main_hand';
                const equipItem = hotbarCharacter.equipment.find(
                  (eq: any) => eq.equippedSlot === equippedSlot && eq.id === weaponId
                );
                if (equipItem) {
                  thrownWeaponItem = {
                    id: equipItem.id,
                    name: equipItem.name || slot.name,
                    equippedSlot,
                    iconPath: equipItem.iconPath,
                    weight: equipItem.weight,
                  };
                }
              }
              const attack = {
                key: slot.id,
                name: slot.name,
                nameEn: slot.id,
                icon: slot.icon || '⚔',
                description: '',
                weaponName: slot.name,
                damage: (slot.meta?.damage as string) || '',
                damageType: (slot.meta?.damageType as string) || '',
                properties: (slot.meta?.properties as string[]) || [],
                range: (() => {
                  const r = slot.meta?.range;
                  if (!r) return '';
                  if (typeof r === 'string') return r;
                  if (typeof r === 'object' && r.normal) return r.long ? `${r.normal}/${r.long}尺` : `${r.normal}尺`;
                  return '';
                })(),
                attackBonus: slot.meta?.attackBonus as number | undefined,
                abilityMod: slot.meta?.abilityMod as number | undefined,
                profBonus: slot.meta?.profBonus as number | undefined,
                weaponProficient: slot.meta?.weaponProficient as boolean | undefined,
                isRanged: (slot.meta?.isRanged as boolean | undefined)
                  ?? ((slot.meta?.normalRange as number) > 10 ? true : undefined),
                normalRange: slot.meta?.normalRange as number | undefined,
                maxRange: slot.meta?.maxRange as number | undefined,
                ...(isThrowSlot ? {
                  isThrown: true,
                  isImprovisedThrow,
                  thrownWeaponItem,
                } : {}),
              };
              publishAppEvent("hotbarAttackExecute", {
                sourceCharacterId,
                targetTokenId,
                attack,
                modifiers,
              });
              setHotbarConfirm(null);
            }}
          />
        )}

        {/* Lay on Hands confirm modal */}
        {abilityConfirm && abilityConfirm.abilityId === 'lay_on_hands' && (
          <LayOnHandsConfirmModal
            open={true}
            targetName={abilityConfirm.targetName}
            targetIsUndead={abilityConfirm.targetMonsterType === 'undead'}
            poolCurrent={abilityConfirm.poolCurrent}
            poolMax={abilityConfirm.poolMax}
            distanceFeet={abilityConfirm.distanceFeet}
            onCancel={() => setAbilityConfirm(null)}
            onConfirm={async (healAmount, cureDisease, curePoison) => {
              try {
                await confirmLayOnHandsAction({
                  campaignId: id!,
                  abilityConfirm,
                  hotbarCharacter,
                  healAmount,
                  cureDisease,
                  curePoison,
                });
              } catch (e) {
                console.error('Lay on Hands error:', e);
              }
              setAbilityConfirm(null);
            }}
          />
        )}

        {/* Divine Smite confirm modal */}
        {abilityConfirm && abilityConfirm.abilityId === 'divine_smite' && abilityConfirm.spellSlotLevel && (
          <DivineSmiteConfirmModal
            open={true}
            targetName={abilityConfirm.targetName}
            targetMonsterType={abilityConfirm.targetMonsterType}
            spellSlotLevel={abilityConfirm.spellSlotLevel}
            distanceFeet={abilityConfirm.distanceFeet}
            onCancel={() => setAbilityConfirm(null)}
            onConfirm={async () => {
              try {
                await confirmDivineSmiteAction({
                  campaignId: id!,
                  abilityConfirm,
                  hotbarCharacter,
                });
              } catch (e) {
                console.error('Divine Smite error:', e);
              }
              setAbilityConfirm(null);
            }}
          />
        )}

        {/* Arcane Recovery modal */}
        {arcaneRecoveryOpen && hotbarCharacter && (
          <ArcaneRecoveryModal
            open={true}
            budget={Math.ceil((hotbarCharacter.level || 1) / 2)}
            remainingSlots={Array.isArray(hotbarCharacter.spell_slots_state) ? hotbarCharacter.spell_slots_state : []}
            maxSlots={getMaxSpellSlots(hotbarCharacter.class_id || 'wizard', hotbarCharacter.level || 1)}
            onCancel={() => setArcaneRecoveryOpen(null)}
            onConfirm={async (recoveries) => {
              const { sourceCharacterId } = arcaneRecoveryOpen;
              try {
                await confirmSpellSlotRecoveryAction({
                  campaignId: id!,
                  sourceCharacterId,
                  endpoint: "arcane-recovery",
                  recoveries,
                  hotbarCharacter,
                  setHotbarCharacter,
                  defaultCharacterName: "法师",
                  bubbleMessage: "奥术恢复 — 恢复了法术位",
                  onPlaySound: () => playResourceSound("arcane_recovery"),
                });
              } catch (e) {
                console.error('Arcane Recovery error:', e);
              }
              setArcaneRecoveryOpen(null);
            }}
          />
        )}

        {/* Flexible Casting modal */}
        {flexibleCastingOpen && hotbarCharacter && (
          <FlexibleCastingModal
            open={true}
            sorceryPointsCurrent={hotbarCharacter.class_feature_uses?.sorcery_points?.current ?? 0}
            sorceryPointsMax={hotbarCharacter.class_feature_uses?.sorcery_points?.max ?? (hotbarCharacter.level || 2)}
            remainingSlots={Array.isArray(hotbarCharacter.spell_slots_state) ? hotbarCharacter.spell_slots_state : []}
            maxSlots={getMaxSpellSlots(hotbarCharacter.class_id || 'sorcerer', hotbarCharacter.level || 1)}
            onCancel={() => setFlexibleCastingOpen(null)}
            onConfirm={async (action, slotLevel) => {
              const { sourceCharacterId } = flexibleCastingOpen;
              try {
                await confirmFlexibleCastingAction({
                  campaignId: id!,
                  sourceCharacterId,
                  action,
                  slotLevel,
                  hotbarCharacter,
                  setHotbarCharacter,
                  onPlaySound: () => playResourceSound("sorcery_points"),
                });
              } catch (e) {
                console.error('Flexible Casting error:', e);
              }
              setFlexibleCastingOpen(null);
            }}
          />
        )}

        {/* Natural Recovery modal (Druid Land) */}
        {naturalRecoveryOpen && hotbarCharacter && (
          <ArcaneRecoveryModal
            open={true}
            budget={Math.ceil((hotbarCharacter.level || 1) / 2)}
            remainingSlots={Array.isArray(hotbarCharacter.spell_slots_state) ? hotbarCharacter.spell_slots_state : []}
            maxSlots={getMaxSpellSlots(hotbarCharacter.class_id || 'druid', hotbarCharacter.level || 1)}
            title="自然恢复" titleEn="Natural Recovery" icon="🌿" accent="emerald"
            onCancel={() => setNaturalRecoveryOpen(null)}
            onConfirm={async (recoveries) => {
              const { sourceCharacterId } = naturalRecoveryOpen;
              try {
                await confirmSpellSlotRecoveryAction({
                  campaignId: id!,
                  sourceCharacterId,
                  endpoint: "natural-recovery",
                  recoveries,
                  hotbarCharacter,
                  setHotbarCharacter,
                  defaultCharacterName: "德鲁伊",
                  bubbleMessage: "自然恢复 — 恢复了法术位",
                  onPlaySound: () => playResourceSound("natural_recovery"),
                });
              } catch (e) {
                console.error('Natural Recovery error:', e);
              }
              setNaturalRecoveryOpen(null);
            }}
          />
        )}

      </div>

      {/* 网格单位设置对话框 */}
      <GridUnitSettingsDialog
        open={showGridUnitDialog}
        onOpenChange={setShowGridUnitDialog}
        currentValue={gridUnitLength}
        onSave={handleGridUnitLengthSave}
      />

      {/* 时间设置模态框 */}
      {showTimeModal && (
        <Suspense fallback={null}>
          <LazyTimeSettingModal
            open={showTimeModal}
            onClose={() => setShowTimeModal(false)}
            currentTime={timeOfDay}
            onConfirm={(time, advancedSeconds) => {
              const changed =
                time.day !== timeOfDay.day ||
                time.hour !== timeOfDay.hour ||
                time.minute !== timeOfDay.minute ||
                time.second !== timeOfDay.second ||
                time.environment !== timeOfDay.environment;
              setTimeOfDay(time);
              // Forward jumps settle ceil(seconds/6) rounds server-side; a
              // zero/backward adjustment still triggers wall-clock settlement.
              const settlementRounds =
                advancedSeconds && advancedSeconds > 0 ? Math.ceil(advancedSeconds / 6) : 0;
              sendMessage({
                type: "time_update",
                data: settlementRounds > 0 ? { ...time, settlement_rounds: settlementRounds } : time,
              });
              if (changed) {
                broadcastSystemNotice(`DM 将时间调整到 ${formatWorldTimeLabel(time)}`);
              }
            }}
          />
        </Suspense>
      )}

      {/* 战役设置对话框 */}
      {showSettingsDialog && (
        <Suspense fallback={null}>
          <LazyCampaignSettingsDialog
            open={showSettingsDialog}
            onOpenChange={setShowSettingsDialog}
            campaignId={parseInt(id || '0')}
            campaignName={campaignData.name}
            campaignDescription={campaignData.description}
            coverImage={campaignData.cover_image}
            selectedModuleId={selectedModule || undefined}
            userId={currentUserId}
            enableDeitySystem={campaignData.metadata?.enable_deity_system ?? true}
            enable3DDice={campaignData.metadata?.enable_3d_dice ?? true}
            maxPlayers={campaignData.max_players}
            onSave={handleSaveCampaignSettings}
          />
        </Suspense>
      )}

      {/* Voice Chat Panel */}
      <VoicePanel campaignId={id || ""} sendMessage={sendMessage} />

      {/* Rest Confirmation Dialog */}
      {restConfirm && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => !restProcessing && setRestConfirm(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-3">
              {restConfirm === 'long' ? '🌙 全队长休' : '☀️ 全队短休'}
            </h3>
            <p className="text-sm text-gray-300 mb-2">
              {restConfirm === 'long'
                ? '将推进时间至次日 6:00，并为所有玩家角色执行长休效果：'
                : '将推进时间 2 小时，并为所有玩家角色执行短休效果：'}
            </p>
            <ul className="text-xs text-gray-400 mb-4 space-y-1 ml-4 list-disc">
              {restConfirm === 'long' ? (
                <>
                  <li>HP 完全恢复</li>
                  <li>所有法术位恢复</li>
                  <li>职业资源重置</li>
                  <li>同伴/召唤物 HP 恢复</li>
                </>
              ) : (
                <>
                  <li>消耗生命骰恢复 HP</li>
                  <li>术士契约法术位恢复</li>
                  <li>短休恢复型职业资源重置</li>
                </>
              )}
            </ul>
            {(() => {
              const chars = campaignMembers.filter(m => m.selected_character_id);
              return chars.length > 0 ? (
                <div className="text-xs text-gray-500 mb-4">
                  影响角色：{chars.map(m => m.character_name || '未知').join('、')}
                </div>
              ) : (
                <div className="text-xs text-amber-400 mb-4">当前无角色需要休息</div>
              );
            })()}
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                onClick={() => setRestConfirm(null)}
                disabled={restProcessing}
              >
                取消
              </button>
              <button
                className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${
                  restConfirm === 'long'
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    : 'bg-amber-600 hover:bg-amber-500 text-white'
                } disabled:opacity-50`}
                onClick={() => executeRest(restConfirm)}
                disabled={restProcessing}
              >
                {restProcessing ? '执行中...' : '确认'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// 右侧面板组件
function DMRightPanel({
  campaignId,
  currentUserId,
  moduleMaps,
  selectedMap,
  selectedModule,
  mapImageScale,
  mapTransform,
  currentMapUrl,
  onSelectMap,
  onMapUse,
  onModuleChange,
  onMapScaleChange,
  onMapTransformChange,
  onMapAdded,
  onMapDelete,
  onAddToLibrary,
  onSendImageToChat,
  onItemAdded,
  itemsRefreshTrigger,
  members,
  rightTab,
  setRightTab,
  getSubTab,
  setSubTab,
  isCollapsed,
  onToggleCollapse,
  isSidebarFullscreen,
  onToggleFullscreen,
  isCombatActive,
  onSelectedCharacterChange,
  dmSelectedCharacterId,
  onDmSelectedCharacterIdChange,
  getSpellExpandedLevels,
  toggleSpellExpandedLevel,
  unreadCount,
  enable3DDice,
  sendMessage,
  floatingCharPanel,
  setFloatingCharPanel,
  globalTerrain,
  timeOfDay,
  showChatInSidebar,
}: {
  campaignId: string;
  currentUserId: string;
  moduleMaps: any[];
  selectedMap: any | null;
  selectedModule: string;
  mapImageScale: number;
  mapTransform: { rotation: number; flipH: boolean; flipV: boolean };
  currentMapUrl: string | null;
  onSelectMap: (map: any) => void;
  onMapUse: (map: any) => void;
  onModuleChange: (moduleId: string) => void;
  onMapScaleChange: (scale: number) => void;
  onMapTransformChange: (transform: { rotation: number; flipH: boolean; flipV: boolean }) => void;
  onMapAdded: () => void;
  onMapDelete: (mapId: string) => void;
  onAddToLibrary: (map: any) => void;
  onSendImageToChat?: (imageUrl: string, description: string, recipient?: string) => void;
  onItemAdded?: () => void;
  itemsRefreshTrigger?: number;
  members?: Array<{ user_id: string; role: string; character_name?: string }>;
  rightTab: string;
  setRightTab: (tab: string) => void;
  getSubTab: (panelKey: string, defaultValue: string) => string;
  setSubTab: (panelKey: string, subTabValue: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  isSidebarFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  isCombatActive?: boolean;
  onSelectedCharacterChange?: (id: number | null, character: any | null) => void;
  dmSelectedCharacterId?: number | null;
  onDmSelectedCharacterIdChange?: (id: number | null) => void;
  getSpellExpandedLevels?: (characterId: number) => Set<number>;
  toggleSpellExpandedLevel?: (characterId: number, level: number) => void;
  unreadCount?: number;
  enable3DDice?: boolean;
  sendMessage?: (message: any) => void;
  floatingCharPanel?: import('~/hooks/useSidebarState').FloatingCharPanelConfig;
  setFloatingCharPanel?: (updates: Partial<import('~/hooks/useSidebarState').FloatingCharPanelConfig>) => void;
  globalTerrain?: string | null;
  timeOfDay: WorldTime;
  showChatInSidebar: boolean;
}) {
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [libraryMaps, setLibraryMaps] = useState<any[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const { handleTabClick } = useCampaignSidebarTabs({
    activeTab: rightTab,
    setActiveTab: setRightTab,
    isCollapsed,
    onToggleCollapse,
    showChatInSidebar,
  });

  // Load library maps when picker opens
  const loadLibraryMaps = async () => {
    setLoadingLibrary(true);
    try {
      const response = await apiFetch("/api/map-library");
      if (response.ok) {
        const data = await response.json();
        setLibraryMaps(data);
      }
    } catch (err) {
      logger.error("Failed to load library maps:", err);
    } finally {
      setLoadingLibrary(false);
    }
  };

  // Add map from library to campaign
  const addFromLibrary = async (libMap: any) => {
    try {
      // Add to campaign's module maps via API (POST to add map)
      const moduleId = selectedModule || 'library';
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/module-maps/add?module_id=${encodeURIComponent(moduleId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: `lib_${libMap.id}_${Date.now()}`,
            name: libMap.name,
            url: libMap.url,
            chapter: '地图库',
            metadata: {
              environment: libMap.environment,
              source: 'library'
            }
          })
        }
      );
      if (response.ok) {
        onMapAdded();
        setShowLibraryPicker(false);
      } else {
        const err = await response.json();
        alert(err.detail || "添加失败");
      }
    } catch (err) {
      logger.error("Failed to add map from library:", err);
      alert("添加失败");
    }
  };

  // Listen for map token selection → sync character selection regardless of active tab
  useEffect(() => {
    const handler = (detail: any) => {
      const { characterId } = detail || {};
      if (typeof characterId === 'number') {
        onDmSelectedCharacterIdChange?.(characterId);
      }
    };
    return subscribeAppEvent("selectCharacterFromMap", handler);
  }, [onDmSelectedCharacterIdChange]);

  return (
    <>
    <Tabs.Root value={rightTab} className={`fantasy-panel flex flex-col min-h-0 ${isCollapsed ? 'h-auto' : 'h-full'}`}>
      <CampaignSidebarTabList
        tabs={[
          { value: "characters", label: "角色", icon: "👥" },
          { value: "chat", label: "聊天", icon: "💬", hidden: !showChatInSidebar, unreadCount: unreadCount ?? 0 },
          { value: "combat", label: "战斗", icon: "⚔️", highlighted: !!isCombatActive },
          { value: "rules", label: "规则", icon: "📜" },
          { value: "resources", label: "资源", icon: "📦" },
          { value: "script", label: "模组", icon: "📖" },
          { value: "maps", label: "地图", icon: "🗺️" },
        ]}
        isCollapsed={isCollapsed}
        isSidebarFullscreen={isSidebarFullscreen}
        onTabClick={handleTabClick}
        onToggleFullscreen={onToggleFullscreen}
        showFullscreenToggle={showChatInSidebar}
      />

      <div className={isCollapsed ? 'hidden' : 'contents'}>
        <Tabs.Content value="characters" className="flex-1 min-h-0 overflow-auto p-4 data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
          {rightTab === 'characters' && (
            <CharacterPanel isDM={true} campaignId={campaignId} currentUserId={currentUserId} currentMapUrl={currentMapUrl} globalTerrain={globalTerrain} timeOfDay={timeOfDay} onSelectedCharacterChange={onSelectedCharacterChange} initialSelectedCharacterId={dmSelectedCharacterId} onSelectedCharacterIdPersist={onDmSelectedCharacterIdChange} getSpellExpandedLevels={getSpellExpandedLevels} toggleSpellExpandedLevel={toggleSpellExpandedLevel} floatingCharPanel={floatingCharPanel} setFloatingCharPanel={setFloatingCharPanel} />
          )}
        </Tabs.Content>

        {showChatInSidebar && (
          <Tabs.Content value="chat" className="flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
            {rightTab === 'chat' && (
              <Suspense fallback={<PanelFallback label="加载聊天面板中..." />}>
                <LazyChatPanel
                  isDM={true}
                  campaignId={campaignId}
                  userId={currentUserId}
                  currentMapUrl={currentMapUrl}
                  activeSubTab={getSubTab('chat', 'chat')}
                  onSubTabChange={(tab) => setSubTab('chat', tab)}
                  selectedModule={selectedModule}
                  enable3DDice={enable3DDice}
                />
              </Suspense>
            )}
          </Tabs.Content>
        )}

        <Tabs.Content
          value="combat"
          forceMount
          className="flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden data-[state=active]:animate-fade-in"
        >
          {(rightTab === 'combat' || isCombatActive) && (
            <Suspense fallback={<PanelFallback label="加载战斗面板中..." />}>
		              <LazyCombatPanel
		                campaignId={campaignId}
		                currentMapUrl={currentMapUrl}
		                isDM={true}
		                userId={currentUserId}
		                sendMessage={sendMessage}
		              />
            </Suspense>
          )}
        </Tabs.Content>

        <Tabs.Content value="rules" className="flex-1 flex flex-col overflow-hidden data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
          {rightTab === 'rules' && (
            <Suspense fallback={<PanelFallback label="加载规则面板中..." />}>
              <LazyRulesPanel
                campaignId={campaignId}
                userId={currentUserId}
                activeSubTab={getSubTab('rules', 'browse')}
                onSubTabChange={(tab) => setSubTab('rules', tab)}
              />
            </Suspense>
          )}
        </Tabs.Content>

        <Tabs.Content value="resources" className="flex-1 overflow-auto p-4 data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
          {rightTab === 'resources' && (
            <Suspense fallback={<PanelFallback label="加载资源库中..." />}>
              <LazyResourceLibraryPanel campaignId={campaignId} currentMapUrl={currentMapUrl || undefined} userId={currentUserId} itemsRefreshTrigger={itemsRefreshTrigger} />
            </Suspense>
          )}
        </Tabs.Content>

        <Tabs.Content value="script" className="flex-1 overflow-auto p-4 data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
          {rightTab === 'script' && (
            <Suspense fallback={<PanelFallback label="加载模组面板中..." />}>
              <LazyModuleScriptPanel
                campaignId={campaignId}
                selectedModule={selectedModule}
                onModuleChange={onModuleChange}
                onMapAdded={onMapAdded}
                onItemAdded={onItemAdded}
                onSendImageToChat={onSendImageToChat}
                members={members}
                activeSubTab={getSubTab('module', 'scenes')}
                onSubTabChange={(tab) => setSubTab('module', tab)}
                currentMapUrl={currentMapUrl || undefined}
              />
            </Suspense>
          )}
        </Tabs.Content>

        <Tabs.Content value="maps" className="flex-1 overflow-auto p-4 data-[state=inactive]:hidden data-[state=active]:animate-fade-in fantasy-tab-content">
          {rightTab === 'maps' && (
            <Suspense fallback={<PanelFallback label="加载地图管理中..." />}>
              <LazyMapManagementPanel
                moduleMaps={moduleMaps}
                selectedMap={selectedMap}
                mapImageScale={mapImageScale}
                mapTransform={mapTransform}
                onSelectMap={onSelectMap}
                onMapUse={onMapUse}
                onMapScaleChange={onMapScaleChange}
                onMapTransformChange={onMapTransformChange}
                onMapDelete={onMapDelete}
                onAddToLibrary={onAddToLibrary}
                onOpenLibrary={() => {
                  setShowLibraryPicker(true);
                  loadLibraryMaps();
                }}
                campaignId={campaignId}
                onMapAdded={onMapAdded}
              />
            </Suspense>
          )}
        </Tabs.Content>
      </div>

    </Tabs.Root>

    {/* Library Picker Dialog - portal to body for global positioning */}
    {showLibraryPicker && createPortal(
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowLibraryPicker(false)}>
        <div
          className="bg-[#12151a] rounded-xl border border-gray-700 w-full max-w-2xl max-h-[80dvh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          <div className="p-4 border-b border-gray-700 flex items-center justify-between">
            <h3 className="text-lg font-medium text-amber-100">从地图库选择</h3>
            <button
              onClick={() => setShowLibraryPicker(false)}
              className="text-gray-400 hover:text-gray-200 text-xl"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {loadingLibrary ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" />
              </div>
            ) : libraryMaps.length === 0 ? (
              <div className="text-center py-10 text-gray-500">
                <div className="text-4xl mb-2">🗺️</div>
                <div>地图库为空</div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {libraryMaps.map(libMap => (
                  <div
                    key={libMap.id}
                    className="bg-[#1a1d24] rounded-lg border border-gray-700 overflow-hidden hover:border-amber-600/50 cursor-pointer transition-colors"
                    onClick={() => addFromLibrary(libMap)}
                  >
                    <div className="aspect-video bg-gray-900">
                      <img src={libMap.url} alt={libMap.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="p-2">
                      <div className="text-sm font-medium text-gray-200 truncate">{libMap.name}</div>
                      {libMap.environment && (
                        <div className="text-xs text-gray-500">{libMap.environment}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}
