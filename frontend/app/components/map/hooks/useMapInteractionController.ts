import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
  type TouchEvent as ReactTouchEvent,
} from "react";

import { subscribeAppEvent } from "~/events/appEventBus";
import spellsData from "~/data/rules/spells.json";
import { fetchCampaignMonsterInstancesCached } from "~/utils/campaignMonsterInstancesCache";
import { fetchCampaignShopsCached } from "~/utils/campaignShopsCache";
import { createLogger } from "~/utils/logger";

import { GRID_SIZE, type Position, type Token } from "../types/TacticalMapTypes";
import {
  findTokenAtGrid,
  getGridCoordinatesFromClientPoint,
  isPlayerContextMenuBlockedByTurn,
  resolvePlayerContextSourceToken,
} from "../utils/mapInteractionUtils";

const logger = createLogger("useMapInteractionController");

export interface ContextMenuState {
  x: number;
  y: number;
  gridX: number;
  gridY: number;
}

export interface MobileActionModalState {
  gridX: number;
  gridY: number;
}

export interface TokenContextMenuState {
  x: number;
  y: number;
  tokenId: number;
}

export interface PlayerContextMenuState {
  x: number;
  y: number;
  gridX: number;
  gridY: number;
  mode: "ground" | "self";
}

export interface SelectionContextMenuState {
  x: number;
  y: number;
  sourceToken: Token;
  targetToken: Token | null;
  targetGridPos: { x: number; y: number } | null;
}

export interface TargetChestData {
  is_locked: boolean;
  lock_dc: number;
  state: string;
  is_trapped?: boolean;
  trap_detected?: boolean;
}

export interface MenuMonster {
  id: string;
  name: string;
  challenge_rating?: string;
  avatar_url?: string;
}

export interface CampaignItemSummary {
  id: number;
  name: string;
  name_cn?: string;
  category?: string;
  rarity?: string;
  iconPath?: string;
}

export interface MenuNpc {
  id: number;
  name: string;
  name_cn?: string;
  avatar_url?: string;
}

export interface MenuShop {
  id: number;
  name: string;
  avatar_url?: string;
}

export interface ShopTransactionShop {
  id: number;
  name: string;
  discount_rate: number;
  accepts_selling?: boolean;
}

export interface PlayerSpellDataState {
  preparedSpells: any[];
  cantrips: any[];
  spellSlots: { [level: number]: { current: number; max: number } };
}

export interface PlayerReactionState {
  id: string;
  name: string;
  icon: string;
  color: string;
  description?: string;
  armed: boolean;
  usesRemaining: number;
  usesPerRound: number;
}

type ShowToastFn = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface UseMapInteractionControllerArgs {
  isDM: boolean;
  campaignId: string;
  userId?: string;
  selectedCharacterId?: number | null;
  selectedTokenId: number | null;
  tokens: Token[];
  controlledCharacterIds: Set<number>;
  containerRef: RefObject<HTMLDivElement>;
  stagePos: Position;
  stageScale: number;
  stagePosRef: MutableRefObject<Position>;
  stageScaleRef: MutableRefObject<number>;
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  getCharacterMovementData: (characterData: any) => { speed: number; fly_speed: number };
  showToast: ShowToastFn;
  openTokenPanel: (tokenId: number) => void;
  areaSpellMode: any;
  hotbarTargeting: any;
  invokeDuplicityPlacementMode: any;
  manualReactionMode: {
    sourceTokenId: number;
    sourceCharacterId?: number | null;
  } | null;
  sourceCharacterData: any;
  setSourceMonsterData: Dispatch<SetStateAction<any>>;
  setSourceCharacterData: Dispatch<SetStateAction<any>>;
}

function buildCharacterContextData(
  sheetData: any,
  getCharacterMovementData: (characterData: any) => { speed: number; fly_speed: number },
) {
  if (!sheetData?.character) return null;

  const character = sheetData.character;
  const movementData = getCharacterMovementData(character);

  return {
    id: character.id,
    name: character.name,
    equipment: character.equipment || [],
    ability_scores: character.abilities,
    level: character.level,
    race_id: character.race_id,
    subrace_id: character.subrace_id,
    class_id: character.class_id,
    subclass_id: character.subclass_id,
    actions: sheetData.actions || [],
    maneuvers_data: sheetData.maneuvers_data,
    favored_enemy: character.favored_enemy,
    favored_terrain: character.favored_terrain,
    selected_cantrips: character.selected_cantrips,
    prepared_spells: character.prepared_spells,
    spell_slots_state: character.spell_slots_state,
    proficient_skills: character.proficient_skills || sheetData.derived?.proficient_skills || [],
    proficient_tools: character.proficient_tools || sheetData.derived?.proficient_tools || [],
    fighting_style: character.fighting_style,
    feats: character.feats,
    class_feature_uses: character.class_feature_uses,
    speed: sheetData.derived?.speed || movementData.speed,
    fly_speed: sheetData.derived?.fly_speed ?? movementData.fly_speed,
    status_effects: character.status_effects,
  };
}

function buildPlayerContextMenuData(sheetData: any, activeEffects: any[]) {
  if (!sheetData?.character) {
    return {
      spellData: { preparedSpells: [], cantrips: [], spellSlots: {} },
      abilities: [],
      reactions: [] as PlayerReactionState[],
    };
  }

  const character = sheetData.character;
  const allSpells = (spellsData as any).spells || [];

  const preparedSpellIds = character.prepared_spells || [];
  const preparedSpells = preparedSpellIds
    .map((id: string) => allSpells.find((spell: any) => spell.id === id) || null)
    .filter(Boolean);

  const cantripIds = character.selected_cantrips || [];
  const cantrips = cantripIds
    .map((id: string) => allSpells.find((spell: any) => spell.id === id) || null)
    .filter(Boolean);

  const actions = sheetData.actions || [];
  const abilities = actions.filter((action: any) => action.uses && action.uses.max > 0);

  const classId = character.class_id?.toLowerCase() || "";
  const subclassId = character.subclass_id?.toLowerCase() || "";
  const level = character.level || 1;

  const reactions: PlayerReactionState[] = [];

  if (classId === "rogue" && level >= 5) {
    const existing = activeEffects.find((effect: any) => effect.id === "uncanny_dodge");
    reactions.push({
      id: "uncanny_dodge",
      name: "灵巧闪避",
      icon: "🏃",
      color: "#6366f1",
      description: "被攻击命中时，伤害减半",
      armed: existing?.armed || false,
      usesRemaining: existing?.uses_remaining ?? 1,
      usesPerRound: 1,
    });
  }

  if (classId === "monk" && level >= 3) {
    const existing = activeEffects.find((effect: any) => effect.id === "deflect_missiles");
    reactions.push({
      id: "deflect_missiles",
      name: "落石偏转",
      icon: "🤚",
      color: "#14b8a6",
      description: "被远程武器攻击命中时，减少伤害",
      armed: existing?.armed || false,
      usesRemaining: existing?.uses_remaining ?? 1,
      usesPerRound: 1,
    });
  }

  if (classId === "fighter" && subclassId === "battle_master" && level >= 3) {
    const existing = activeEffects.find((effect: any) => effect.id === "parry");
    reactions.push({
      id: "parry",
      name: "招架",
      icon: "⚔️",
      color: "#f59e0b",
      description: "被近战攻击命中时，消耗优势骰减少伤害",
      armed: existing?.armed || false,
      usesRemaining: existing?.uses_remaining ?? 1,
      usesPerRound: 1,
    });
  }

  return {
    spellData: {
      preparedSpells,
      cantrips,
      spellSlots: character.spell_slots || {},
    },
    abilities,
    reactions,
  };
}

function withCampaignItemIcons(items: any[]) {
  return (items || []).map((item: any) => {
    if (item.avatar_url) {
      return { ...item, iconPath: item.avatar_url };
    }
    return item;
  });
}

export function useMapInteractionController({
  isDM,
  campaignId,
  userId,
  selectedCharacterId,
  selectedTokenId,
  tokens,
  controlledCharacterIds,
  containerRef,
  stagePos,
  stageScale,
  stagePosRef,
  stageScaleRef,
  authedFetch,
  getCharacterMovementData,
  showToast,
  openTokenPanel,
  areaSpellMode,
  hotbarTargeting,
  invokeDuplicityPlacementMode,
  manualReactionMode,
  sourceCharacterData,
  setSourceMonsterData,
  setSourceCharacterData,
}: UseMapInteractionControllerArgs) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [mobileActionModal, setMobileActionModal] = useState<MobileActionModalState | null>(null);
  const [tokenContextMenu, setTokenContextMenu] = useState<TokenContextMenuState | null>(null);
  const [playerContextMenu, setPlayerContextMenu] = useState<PlayerContextMenuState | null>(null);
  const [selectionContextMenu, setSelectionContextMenu] =
    useState<SelectionContextMenuState | null>(null);
  const [targetChestData, setTargetChestData] = useState<TargetChestData | null>(null);

  const [monsters, setMonsters] = useState<MenuMonster[]>([]);
  const [campaignItems, setCampaignItems] = useState<CampaignItemSummary[]>([]);
  const [npcs, setNpcs] = useState<MenuNpc[]>([]);
  const [shops, setShops] = useState<MenuShop[]>([]);

  const [playerSpellData, setPlayerSpellData] = useState<PlayerSpellDataState>({
    preparedSpells: [],
    cantrips: [],
    spellSlots: {},
  });
  const [playerAbilities, setPlayerAbilities] = useState<any[]>([]);
  const [playerReactions, setPlayerReactions] = useState<PlayerReactionState[]>([]);

  const [shopTxnOpen, setShopTxnOpen] = useState(false);
  const [shopTxnShop, setShopTxnShop] = useState<ShopTransactionShop | null>(null);
  const [shopTxnTokenId, setShopTxnTokenId] = useState<number | null>(null);
  const [shopTokenModalId, setShopTokenModalId] = useState<number | null>(null);
  const [chestModalOpen, setChestModalOpen] = useState(false);
  const [chestModalChest, setChestModalChest] = useState<any | null>(null);
  const [chestManageModalOpen, setChestManageModalOpen] = useState(false);
  const [chestManageChest, setChestManageChest] = useState<any | null>(null);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const indicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [longPressIndicator, setLongPressIndicator] = useState<{ x: number; y: number } | null>(
    null,
  );

  const TOUCH_MOVE_THRESHOLD = 10;
  const LONG_PRESS_DURATION = 1500;
  const INDICATOR_DELAY = 500;

  const clearInteractionMenus = useCallback(() => {
    setContextMenu(null);
    setMobileActionModal(null);
    setTokenContextMenu(null);
    setPlayerContextMenu(null);
    setSelectionContextMenu(null);
  }, []);

  const resetLongPressState = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (indicatorTimerRef.current) {
      clearTimeout(indicatorTimerRef.current);
      indicatorTimerRef.current = null;
    }
    touchStartPosRef.current = null;
    setLongPressIndicator(null);
  }, []);

  const loadTargetChestData = useCallback(
    async (token: Token | null) => {
      if (!(token as any)?.chest_id) {
        setTargetChestData(null);
        return;
      }

      try {
        const response = await authedFetch(`/api/chests/${(token as any).chest_id}`);
        if (!response.ok) {
          setTargetChestData(null);
          return;
        }
        const data = await response.json();
        setTargetChestData({
          is_locked: data.is_locked,
          lock_dc: data.lock_dc,
          state: data.state,
          is_trapped: data.is_trapped,
          trap_detected: data.trap_detected,
        });
      } catch {
        setTargetChestData(null);
      }
    },
    [authedFetch],
  );

  const loadSourceTokenData = useCallback(
    async (token: Token | null) => {
      if (!token) {
        setSourceMonsterData(null);
        setSourceCharacterData(null);
        return;
      }

      if (token.monster_instance_id) {
        try {
          const response = await authedFetch(`/api/monster-instances/${token.monster_instance_id}`);
          const data = response.ok ? await response.json() : null;
          setSourceMonsterData(data?.monster_data || null);
        } catch {
          setSourceMonsterData(null);
        }
        setSourceCharacterData(null);
        return;
      }

      if (token.character_id) {
        if (sourceCharacterData?.id === token.character_id) {
          setSourceMonsterData(null);
          return;
        }
        try {
          const response = await authedFetch(`/api/characters/${token.character_id}/sheet`);
          const data = response.ok ? await response.json() : null;
          setSourceCharacterData(buildCharacterContextData(data, getCharacterMovementData));
        } catch {
          setSourceCharacterData(null);
        }
        setSourceMonsterData(null);
        return;
      }

      setSourceMonsterData(null);
      setSourceCharacterData(null);
    },
    [
      authedFetch,
      getCharacterMovementData,
      setSourceCharacterData,
      setSourceMonsterData,
      sourceCharacterData,
    ],
  );

  useEffect(() => {
    if (!isDM || !campaignId) return;

    let cancelled = false;
    const loadMonsters = async () => {
      try {
        const data = await fetchCampaignMonsterInstancesCached(campaignId, { userId });
        if (cancelled) return;

        const nextMonsters: MenuMonster[] = [];
        const nextNpcs: MenuNpc[] = [];
        (data || []).forEach((entry: any) => {
          if (entry.entity_type === "npc") {
            nextNpcs.push({
              id: entry.id,
              name: entry.name || entry.name_cn || String(entry.id),
              name_cn: entry.name_cn,
              avatar_url: entry.avatar_url,
            });
            return;
          }
          nextMonsters.push({
            id: String(entry.id),
            name: entry.name || entry.name_cn || String(entry.id),
            challenge_rating: entry.challenge_rating,
            avatar_url: entry.avatar_url,
          });
        });
        setMonsters(nextMonsters);
        setNpcs(nextNpcs);
      } catch (error) {
        logger.error("[useMapInteractionController] Failed to load monsters:", error);
      }
    };

    loadMonsters();
    return () => {
      cancelled = true;
    };
  }, [campaignId, isDM, userId]);

  useEffect(() => {
    if (!isDM || !campaignId) return;

    let cancelled = false;
    const loadShops = async () => {
      try {
        const data = await fetchCampaignShopsCached(campaignId, { userId });
        if (cancelled) return;
        setShops(
          (data || []).map((shop: any) => ({
            id: shop.id,
            name: shop.name,
            avatar_url: shop.avatar_url,
          })),
        );
      } catch (error) {
        logger.error("[useMapInteractionController] Failed to load shops:", error);
      }
    };

    loadShops();
    return () => {
      cancelled = true;
    };
  }, [campaignId, isDM, userId]);

  useEffect(() => {
    if (!isDM || !campaignId || !contextMenu) return;

    let cancelled = false;
    const loadItems = async () => {
      try {
        const response = await authedFetch(`/api/items/campaign/${campaignId}`);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) {
          setCampaignItems(withCampaignItemIcons(data));
        }
      } catch (error) {
        logger.error("[useMapInteractionController] Failed to load campaign items:", error);
      }
    };

    loadItems();
    return () => {
      cancelled = true;
    };
  }, [authedFetch, campaignId, contextMenu, isDM]);

  useEffect(() => {
    if (!tokenContextMenu) return;

    const handleClickAway = () => setTokenContextMenu(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTokenContextMenu(null);
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener("click", handleClickAway);
      document.addEventListener("keydown", handleEscape);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClickAway);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [tokenContextMenu]);

  useEffect(() => {
    if (isDM || !playerContextMenu || !selectedCharacterId) return;

    let cancelled = false;
    const loadPlayerData = async () => {
      try {
        const response = await authedFetch(`/api/characters/${selectedCharacterId}/sheet`);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (cancelled) return;

        const myToken = tokens.find((token) => token.character_id === selectedCharacterId);
        const activeEffects = myToken?.active_effects || [];
        const next = buildPlayerContextMenuData(data, activeEffects);

        setPlayerSpellData(next.spellData);
        setPlayerAbilities(next.abilities);
        setPlayerReactions(next.reactions);
      } catch (error) {
        logger.error("[useMapInteractionController] Failed to load player data:", error);
      }
    };

    loadPlayerData();
    return () => {
      cancelled = true;
    };
  }, [authedFetch, isDM, playerContextMenu, selectedCharacterId, tokens]);

  useEffect(() => {
    const handleOpenShopTransaction = async (detail: { shopId?: number; tokenId?: number }) => {
      if (!detail?.shopId) return;

      try {
        const response = await authedFetch(`/api/shops/${detail.shopId}`);
        if (!response.ok) return;
        const data = await response.json();
        setShopTxnShop({
          id: data.id,
          name: data.name,
          discount_rate: data.discount_rate ?? 0.5,
          accepts_selling: data.accepts_selling,
        });
        setShopTxnTokenId(typeof detail.tokenId === "number" ? detail.tokenId : null);
        setShopTxnOpen(true);
      } catch (error) {
        logger.error("[useMapInteractionController] Failed to open shop transaction:", error);
      }
    };

    const handleOpenShopTokenModal = (detail: { tokenId?: number }) => {
      if (typeof detail?.tokenId === "number") {
        setShopTokenModalId(detail.tokenId);
      }
    };

    const handleOpenChestInteraction = async (detail: { chestId?: number }) => {
      if (!detail?.chestId) return;

      try {
        const response = await authedFetch(`/api/chests/${detail.chestId}`);
        if (!response.ok) return;
        setChestModalChest(await response.json());
        setChestModalOpen(true);
      } catch (error) {
        logger.error("[useMapInteractionController] Failed to open chest interaction:", error);
      }
    };

    const handleOpenChestManagement = async (detail: { chestId?: number }) => {
      if (!detail?.chestId) return;

      try {
        const response = await authedFetch(`/api/chests/${detail.chestId}`);
        if (!response.ok) return;
        setChestManageChest(await response.json());
        setChestManageModalOpen(true);
      } catch (error) {
        logger.error("[useMapInteractionController] Failed to open chest management:", error);
      }
    };

    const handleChestOpen = async (detail: { chestId?: number; characterId?: number }) => {
      if (!detail?.chestId) return;

      try {
        const openResponse = await authedFetch(`/api/chests/${detail.chestId}/open`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ character_id: detail.characterId }),
        });

        if (!openResponse.ok) {
          const data = await openResponse.json();
          showToast(data.message || "打开失败", "error");
          return;
        }

        const response = await authedFetch(`/api/chests/${detail.chestId}`);
        if (!response.ok) return;
        setChestModalChest(await response.json());
        setChestModalOpen(true);
      } catch (error) {
        logger.error("[useMapInteractionController] Failed to open chest:", error);
        showToast("打开宝箱失败", "error");
      }
    };

    const unsubscribeOpenShopTransaction = subscribeAppEvent(
      "openShopTransaction",
      handleOpenShopTransaction,
    );
    const unsubscribeOpenShopTokenModal = subscribeAppEvent(
      "openShopTokenModal",
      handleOpenShopTokenModal,
    );
    const unsubscribeOpenChestInteraction = subscribeAppEvent(
      "openChestInteraction",
      handleOpenChestInteraction,
    );
    const unsubscribeOpenChestManagement = subscribeAppEvent(
      "openChestManagement",
      handleOpenChestManagement,
    );
    const unsubscribeChestOpen = subscribeAppEvent("chestOpen", handleChestOpen);

    return () => {
      unsubscribeOpenShopTransaction();
      unsubscribeOpenShopTokenModal();
      unsubscribeOpenChestInteraction();
      unsubscribeOpenChestManagement();
      unsubscribeChestOpen();
    };
  }, [authedFetch, showToast]);

  useEffect(() => () => resetLongPressState(), [resetLongPressState]);

  const openSelectionMenu = useCallback(
    async (args: {
      x: number;
      y: number;
      sourceToken: Token;
      targetToken: Token | null;
      targetGridPos: { x: number; y: number } | null;
    }) => {
      setSelectionContextMenu(args);
      setContextMenu(null);
      setMobileActionModal(null);
      setTokenContextMenu(null);
      setPlayerContextMenu(null);
      void loadTargetChestData(args.targetToken);
      void loadSourceTokenData(args.sourceToken);
    },
    [loadSourceTokenData, loadTargetChestData],
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent | Pick<MouseEvent, "preventDefault" | "clientX" | "clientY">) => {
      event.preventDefault();
      if (mobileActionModal || selectionContextMenu || invokeDuplicityPlacementMode) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const { gridX, gridY } = getGridCoordinatesFromClientPoint({
        clientX: event.clientX,
        clientY: event.clientY,
        containerRect: rect,
        stagePos,
        stageScale,
        gridSize: GRID_SIZE,
      });
      const clickedToken = findTokenAtGrid(tokens, gridX, gridY);

      if (isDM) {
        if (selectedTokenId) {
          const sourceToken = tokens.find((token) => token.id === selectedTokenId);
          if (sourceToken) {
            void openSelectionMenu({
              x: event.clientX,
              y: event.clientY,
              sourceToken,
              targetToken: clickedToken,
              targetGridPos: clickedToken ? null : { x: gridX, y: gridY },
            });
          }
          return;
        }

        if (clickedToken) {
          setTokenContextMenu({ x: event.clientX, y: event.clientY, tokenId: clickedToken.id });
          setContextMenu(null);
          return;
        }

        setContextMenu({ x: event.clientX, y: event.clientY, gridX, gridY });
        setTokenContextMenu(null);
        return;
      }

      const { controlledSourceToken, sourceTokenForMenu } = resolvePlayerContextSourceToken({
        tokens,
        selectedCharacterId,
        userId,
        clickedToken,
        controlledCharacterIds,
      });

      if (
        isPlayerContextMenuBlockedByTurn({
          sourceToken: sourceTokenForMenu,
          combatIsActive: !!(window as any).__combatIsActive,
          participantTokenIds: (window as any).__combatParticipantTokenIds ?? [],
          turnUserId: (window as any).__combatTurnUserId,
          currentUserId: userId,
          reactionSourceTokenId: manualReactionMode?.sourceTokenId,
        })
      ) {
        showToast("当前不是你的回合", "warning");
        return;
      }

      if (sourceTokenForMenu) {
        void openSelectionMenu({
          x: event.clientX,
          y: event.clientY,
          sourceToken: sourceTokenForMenu,
          targetToken: controlledSourceToken ? null : clickedToken,
          targetGridPos: clickedToken ? null : { x: gridX, y: gridY },
        });
      }
    },
    [
      containerRef,
      controlledCharacterIds,
      invokeDuplicityPlacementMode,
      isDM,
      manualReactionMode?.sourceTokenId,
      mobileActionModal,
      openSelectionMenu,
      selectedCharacterId,
      selectedTokenId,
      selectionContextMenu,
      showToast,
      stagePos,
      stageScale,
      tokens,
      userId,
    ],
  );

  const handleTouchStart = useCallback(
    (event: ReactTouchEvent | { touches: ArrayLike<{ clientX: number; clientY: number }> }) => {
      if (mobileActionModal || selectionContextMenu) return;
      if (hotbarTargeting || invokeDuplicityPlacementMode || areaSpellMode) return;

      const touches = Array.from(event.touches || []);
      if (touches.length !== 1) {
        resetLongPressState();
        return;
      }

      const touch = touches[0];
      touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

      indicatorTimerRef.current = setTimeout(() => {
        if (touchStartPosRef.current) {
          setLongPressIndicator({
            x: touchStartPosRef.current.x,
            y: touchStartPosRef.current.y,
          });
        }
      }, INDICATOR_DELAY);

      longPressTimerRef.current = setTimeout(async () => {
        if (!touchStartPosRef.current) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const { x: touchX, y: touchY } = touchStartPosRef.current;
        const clientX = touchX - rect.left;
        const clientY = touchY - rect.top;
        const mapX = (clientX - stagePosRef.current.x) / stageScaleRef.current;
        const mapY = (clientY - stagePosRef.current.y) / stageScaleRef.current;
        const gridX = Math.floor(mapX / GRID_SIZE);
        const gridY = Math.floor(mapY / GRID_SIZE);
        const clickedToken = findTokenAtGrid(tokens, gridX, gridY);

        if (isDM) {
          if (selectedTokenId) {
            const sourceToken = tokens.find((token) => token.id === selectedTokenId);
            if (sourceToken) {
              await openSelectionMenu({
                x: touchX,
                y: touchY,
                sourceToken,
                targetToken: clickedToken,
                targetGridPos: clickedToken ? null : { x: gridX, y: gridY },
              });
            }
          } else if (clickedToken) {
            openTokenPanel(clickedToken.id);
            setContextMenu(null);
            setMobileActionModal(null);
          } else {
            setMobileActionModal({ gridX, gridY });
            setContextMenu(null);
            setTokenContextMenu(null);
          }
        } else {
          const { controlledSourceToken, sourceTokenForMenu } = resolvePlayerContextSourceToken({
            tokens,
            selectedCharacterId,
            userId,
            clickedToken,
            controlledCharacterIds,
          });

          if (
            isPlayerContextMenuBlockedByTurn({
              sourceToken: sourceTokenForMenu,
              combatIsActive: !!(window as any).__combatIsActive,
              participantTokenIds: (window as any).__combatParticipantTokenIds ?? [],
              turnUserId: (window as any).__combatTurnUserId,
              currentUserId: userId,
              reactionSourceTokenId: manualReactionMode?.sourceTokenId,
            })
          ) {
            showToast("当前不是你的回合", "warning");
            resetLongPressState();
            return;
          }

          if (sourceTokenForMenu) {
            await openSelectionMenu({
              x: touchX,
              y: touchY,
              sourceToken: sourceTokenForMenu,
              targetToken: controlledSourceToken ? null : clickedToken,
              targetGridPos: clickedToken ? null : { x: gridX, y: gridY },
            });
          }
        }

        setLongPressIndicator(null);
        touchStartPosRef.current = null;
        longPressTriggeredRef.current = true;
        setTimeout(() => {
          longPressTriggeredRef.current = false;
        }, 500);
      }, LONG_PRESS_DURATION);
    },
    [
      areaSpellMode,
      containerRef,
      controlledCharacterIds,
      hotbarTargeting,
      invokeDuplicityPlacementMode,
      isDM,
      manualReactionMode?.sourceTokenId,
      mobileActionModal,
      openSelectionMenu,
      openTokenPanel,
      resetLongPressState,
      selectedCharacterId,
      selectedTokenId,
      selectionContextMenu,
      showToast,
      stagePosRef,
      stageScaleRef,
      tokens,
      userId,
    ],
  );

  const handleTouchMoveForContextMenu = useCallback(
    (event: ReactTouchEvent | { touches: ArrayLike<{ clientX: number; clientY: number }> }) => {
      if (areaSpellMode || invokeDuplicityPlacementMode) return;

      const touches = Array.from(event.touches || []);
      if (touches.length > 1) {
        resetLongPressState();
        return;
      }

      if (touchStartPosRef.current && touches.length === 1) {
        const touch = touches[0];
        const dx = touch.clientX - touchStartPosRef.current.x;
        const dy = touch.clientY - touchStartPosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > TOUCH_MOVE_THRESHOLD) {
          resetLongPressState();
        }
      }
    },
    [areaSpellMode, invokeDuplicityPlacementMode, resetLongPressState],
  );

  const handleTouchEndForContextMenu = useCallback(() => {
    resetLongPressState();
  }, [resetLongPressState]);

  const handleShopTxnOpenChange = useCallback((open: boolean) => {
    setShopTxnOpen(open);
    if (!open) {
      setShopTxnShop(null);
      setShopTxnTokenId(null);
    }
  }, []);

  const handleChestModalOpenChange = useCallback((open: boolean) => {
    setChestModalOpen(open);
    if (!open) {
      setChestModalChest(null);
    }
  }, []);

  const handleChestManageModalOpenChange = useCallback((open: boolean) => {
    setChestManageModalOpen(open);
    if (!open) {
      setChestManageChest(null);
    }
  }, []);

  return {
    campaignItems,
    chestManageChest,
    chestManageModalOpen,
    chestModalChest,
    chestModalOpen,
    clearInteractionMenus,
    contextMenu,
    handleChestManageModalOpenChange,
    handleChestModalOpenChange,
    handleContextMenu,
    handleShopTxnOpenChange,
    handleTouchEndForContextMenu,
    handleTouchMoveForContextMenu,
    handleTouchStart,
    loadSourceTokenData,
    longPressIndicator,
    longPressTriggeredRef,
    mobileActionModal,
    monsters,
    npcs,
    playerAbilities,
    playerContextMenu,
    playerReactions,
    playerSpellData,
    selectionContextMenu,
    setCampaignItems,
    setChestManageChest,
    setChestManageModalOpen,
    setChestModalChest,
    setChestModalOpen,
    setContextMenu,
    setMobileActionModal,
    setPlayerContextMenu,
    setPlayerReactions,
    setSelectionContextMenu,
    setShopTxnOpen,
    setShopTxnShop,
    setShopTxnTokenId,
    setShopTokenModalId,
    setSourceCharacterData,
    setTokenContextMenu,
    shopTokenModalId,
    shops,
    shopTxnOpen,
    shopTxnShop,
    shopTxnTokenId,
    targetChestData,
    tokenContextMenu,
  };
}
