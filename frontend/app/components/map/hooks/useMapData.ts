/**
 * useMapData Hook
 * Handles all data loading for the TacticalMap component.
 * Uses bulk endpoint for initial load (1 request instead of 8+).
 */

import { useEffect, useRef } from "react";
import type { Token, Ruler, Drawing, MapMarker } from "../types/TacticalMapTypes";
import type { FogData } from "../FogOfWarManager";
import type { TerrainData } from "../TerrainManager";
import { MAP_WIDTH, MAP_HEIGHT } from "../types/TacticalMapTypes";
import { apiFetch } from "~/utils/api-client";
import {
  campaignQueryKeys,
  fetchCampaignMapBulkData,
} from "~/queries/campaignQueries";
import { getAppQueryClient } from "~/queries/queryClient";
import { fetchCharacterCached } from "~/utils/characterCache";
import {
  fetchCampaignMapTokensCached,
  primeCampaignMapTokensCache,
} from "~/utils/mapTokensCache";
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import { getCanvasImageUrl } from "~/utils/canvas-image-url";
import { loadDrawings } from "~/utils/drawingAPI";
import { createLogger } from '~/utils/logger';
import { computeAll } from "../../character/CharacterDisplay/utils/derived";
const logger = createLogger('useMapData');

type CharacterMapEntry = readonly [number, any];
type AuthedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface MapBulkDataPayload {
  tokens?: Token[];
  fog?: FogData | null;
  terrain?: TerrainData | null;
  rulers?: Ruler[];
  drawings?: Drawing[];
  markers?: MapMarker[];
  map_settings?: {
    grid_unit_length?: number;
    anchor_x?: number | null;
    anchor_y?: number | null;
  } | null;
  view_state?: {
    position_x: number;
    position_y: number;
    scale: number;
    minimap_collapsed?: boolean;
  } | null;
}

const BULK_DATA_TTL_MS = 10_000;

async function fetchMapBulkData(
  campaignId: string,
  currentMapUrl: string,
): Promise<MapBulkDataPayload> {
  const queryClient = getAppQueryClient();
  return queryClient.fetchQuery({
    queryKey: campaignQueryKeys.mapBulkData(campaignId, currentMapUrl),
    queryFn: async () => {
      const data = await fetchCampaignMapBulkData(campaignId, currentMapUrl);
      if (!data) {
        throw new Error("Bulk load returned empty payload");
      }
      return data as MapBulkDataPayload;
    },
    staleTime: BULK_DATA_TTL_MS,
  });
}

export async function loadCharactersInParallel(
  characterIds: number[],
  fetchCharacter: (characterId: number) => Promise<any | null>,
): Promise<Map<number, any>> {
  const characterEntries = await Promise.all(
    characterIds.map(async (characterId): Promise<CharacterMapEntry | null> => {
      try {
        const character = await fetchCharacter(characterId);
        return character ? [characterId, character] as const : null;
      } catch (error) {
        logger.warn("[useMapData] Failed to load character", characterId, error);
        return null;
      }
    })
  );

  return new Map(
    characterEntries.filter((entry): entry is CharacterMapEntry => entry !== null)
  );
}

export function persistDefaultTokenHpInBackground(
  tokens: Token[],
  persistHPTokenIds: Set<number>,
  persistTokenHp: (token: Token) => Promise<unknown>,
) {
  const persistTasks = tokens
    .filter((token) => persistHPTokenIds.has(token.id))
    .map(async (token) => {
      try {
        await persistTokenHp(token);
      } catch (error) {
        logger.warn("[useMapData] Failed to persist default HP for token", token.id, error);
      }
    });

  return Promise.allSettled(persistTasks);
}


interface UseMapDataProps {
  campaignId: string;
  currentMapUrl?: string | null;
  userId?: string;
  selectedCharacterId?: number | null;
  isDM?: boolean;
  drawingsRefreshVersion?: number;
  setTokens: (tokens: Token[] | ((prev: Token[]) => Token[])) => void;
  setFogData: (data: FogData | null) => void;
  setTerrainData: (data: TerrainData | null) => void;
  setRulers: (rulers: Ruler[]) => void;
  setDrawings: (drawings: Drawing[]) => void;
  setMarkers: (markers: MapMarker[]) => void;
  setMapImage: (img: HTMLImageElement | null) => void;
  setMapImageLoaded: (loaded: boolean) => void;
  setGridUnitLength: (length: number) => void;
  setAnchorPosition: (pos: { x: number; y: number } | null) => void;
  setStagePos: (pos: { x: number; y: number }) => void;
  setStageScale: (scale: number) => void;
  setMinimapCollapsed: (collapsed: boolean) => void;
  viewStateLoadedRef: React.MutableRefObject<boolean>;
}

/** Process raw token data: enrich character tokens with derived HP */
function processTokens(
  tokensRaw: Token[],
  charMap: Map<number, any>,
): { enriched: Token[]; persistHPTokenIds: Set<number> } {
  const persistHPTokenIds = new Set<number>(
    tokensRaw.filter(t => !!t.character_id && (t.current_hp === null || t.current_hp === undefined)).map(t => t.id)
  );

  const enriched = tokensRaw.map(t => {
    if (t.character_id && charMap.has(Number(t.character_id))) {
      const char = charMap.get(Number(t.character_id));
      const derived = computeAll(char, { hpOptions: { includeFlatSubraceHP: true, includeSubraceLevelBonuses: true } });
      const maxHP = Number(derived.hp || 0);
      const curHP = (t.current_hp === null || t.current_hp === undefined) ? maxHP : Number(t.current_hp);
      return { ...t, max_hp: maxHP, current_hp: curHP } as Token;
    }
    return t;
  });

  return { enriched, persistHPTokenIds };
}

/** Notify concentration spells on initial load */
function notifyConcentration(tokens: Token[]) {
  for (const t of tokens) {
    if (t.character_id && t.concentration_spell) {
      publishAppEvent("characterConcentrationChanged", {
        characterId: t.character_id,
        tokenId: t.id,
        concentrationSpell: t.concentration_spell,
      });
    }
    if (t.character_id && t.casting_in_progress) {
      publishAppEvent("characterCastingChanged", {
        characterId: t.character_id,
        tokenId: t.id,
        castingInProgress: t.casting_in_progress,
      });
    }
  }
}

export function useMapData({
  campaignId,
  currentMapUrl,
  userId,
  selectedCharacterId,
  isDM = false,
  drawingsRefreshVersion = 0,
  setTokens,
  setFogData,
  setTerrainData,
  setRulers,
  setDrawings,
  setMarkers,
  setMapImage,
  setMapImageLoaded,
  setGridUnitLength,
  setAnchorPosition,
  setStagePos,
  setStageScale,
  setMinimapCollapsed,
  viewStateLoadedRef,
}: UseMapDataProps) {
  const authedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    apiFetch(input, init);

  // Track if bulk data has loaded for this map (to avoid re-fetching on token events)
  const bulkLoadedMapRef = useRef<string | null>(null);

  // 加载背景地图图片
  useEffect(() => {
    if (!currentMapUrl) {
      setMapImage(null);
      setMapImageLoaded(false);
      return;
    }

    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setMapImage(img);
      setMapImageLoaded(true);
    };
    img.onerror = (err) => {
      logger.error(`[useMapData] Failed to load map image: ${currentMapUrl}`, err);
      setMapImage(null);
      setMapImageLoaded(false);
    };
    img.src = getCanvasImageUrl(currentMapUrl) || currentMapUrl;
  }, [currentMapUrl, setMapImage, setMapImageLoaded]);

  // ========== BULK LOAD: 一次请求加载所有地图数据 ==========
  useEffect(() => {
    viewStateLoadedRef.current = false;

    const loadBulkData = async () => {
      if (!campaignId || !currentMapUrl) {
        setTokens([]);
        setFogData(null);
        setTerrainData(null);
        setRulers([]);
        setDrawings([]);
        setMarkers([]);
        setGridUnitLength(5.0);
        setAnchorPosition(null);
        return;
      }

      try {
        const startTime = performance.now();
        const bulk = await fetchMapBulkData(campaignId, currentMapUrl);
        const elapsed = Math.round(performance.now() - startTime);
        if (elapsed > 1500) {
          logger.warn(`[useMapData] Bulk data load is slow: ${elapsed}ms`);
        }

        // --- Tokens ---
        const tokensRaw: Token[] = bulk.tokens || [];
        const needCharHP = tokensRaw.filter(t => !!t.character_id && (
          t.current_hp === null || t.current_hp === undefined ||
          t.max_hp === null || t.max_hp === undefined
        ));
        const uniqueCharIds = Array.from(new Set(needCharHP.map(t => Number(t.character_id)))).filter(Boolean) as number[];

        const charMap = await loadCharactersInParallel(
          uniqueCharIds,
          (cid) => fetchCharacterCached(cid, { userId }),
        );

        const { enriched, persistHPTokenIds } = processTokens(tokensRaw, charMap);
        setTokens(enriched);
        primeCampaignMapTokensCache(campaignId, currentMapUrl, { tokens: enriched });
        notifyConcentration(enriched);

        if (isDM) {
          void persistDefaultTokenHpInBackground(enriched, persistHPTokenIds, (token) =>
            authedFetch(`/api/tokens/${token.id}/hp`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ current_hp: token.current_hp ?? 0 }),
            })
          );
        }

        // --- Fog ---
        setFogData(bulk.fog || null);

        // --- Terrain ---
        setTerrainData(bulk.terrain || null);

        // --- Rulers ---
        setRulers(bulk.rulers || []);

        // --- Drawings ---
        setDrawings(bulk.drawings || []);

        // --- Markers ---
        setMarkers(bulk.markers || []);

        // --- Map Settings ---
        const ms = bulk.map_settings;
        if (ms) {
          setGridUnitLength(ms.grid_unit_length || 5.0);
          if (ms.anchor_x != null && ms.anchor_y != null) {
            setAnchorPosition({ x: ms.anchor_x, y: ms.anchor_y });
          } else {
            setAnchorPosition(null);
          }
        } else {
          setGridUnitLength(5.0);
          setAnchorPosition(null);
        }

        // --- View State ---
        const vs = bulk.view_state;
        if (vs) {
          setStagePos({ x: vs.position_x, y: vs.position_y });
          setStageScale(vs.scale);
          if (vs.minimap_collapsed !== undefined) setMinimapCollapsed(vs.minimap_collapsed);
        } else if (userId) {
          // No saved view state - try DM fallback
          try {
            const dmResp = await authedFetch(
              `/api/map-view-state/${campaignId}/dm?map_url=${encodeURIComponent(currentMapUrl)}`
            );
            if (dmResp.ok) {
              const dmData = await dmResp.json();
              if (dmData) {
                setStagePos({ x: dmData.position_x, y: dmData.position_y });
                setStageScale(dmData.scale);
                if (dmData.minimap_collapsed !== undefined) setMinimapCollapsed(dmData.minimap_collapsed);
              } else {
                setStagePos({ x: 0, y: 0 });
                setStageScale(1);
              }
            } else {
              setStagePos({ x: 0, y: 0 });
              setStageScale(1);
            }
          } catch {
            setStagePos({ x: 0, y: 0 });
            setStageScale(1);
          }
        }

        viewStateLoadedRef.current = true;
        bulkLoadedMapRef.current = currentMapUrl;
      } catch (error) {
        logger.error("[useMapData] Bulk load error:", error);
        viewStateLoadedRef.current = true;
      }
    };

    loadBulkData();
  }, [campaignId, currentMapUrl, isDM, userId]);

  useEffect(() => {
    if (!campaignId || !currentMapUrl || drawingsRefreshVersion <= 0) return;

    const refreshDrawings = async () => {
      try {
        const drawings = await loadDrawings(campaignId, currentMapUrl);
        setDrawings(drawings as Drawing[]);
      } catch (error) {
        logger.error("[useMapData] Drawings refresh error:", error);
      }
    };

    void refreshDrawings();
  }, [campaignId, currentMapUrl, drawingsRefreshVersion, setDrawings]);

  // ========== Token 增量重载（事件驱动，仅 reload tokens） ==========
  useEffect(() => {
    if (!campaignId || !currentMapUrl) return;

    const reloadTokens = async () => {
      try {
        const data = await fetchCampaignMapTokensCached(campaignId, currentMapUrl, {
          userId,
          force: true,
        });
        const tokensRaw: Token[] = data.tokens || [];

        const needCharHP = tokensRaw.filter(t => !!t.character_id && (
          t.current_hp === null || t.current_hp === undefined ||
          t.max_hp === null || t.max_hp === undefined
        ));
        const uniqueCharIds = Array.from(new Set(needCharHP.map(t => Number(t.character_id)))).filter(Boolean) as number[];
        const charMap = await loadCharactersInParallel(
          uniqueCharIds,
          (cid) => fetchCharacterCached(cid, { userId }),
        );

        const { enriched } = processTokens(tokensRaw, charMap);
        setTokens(enriched);
        primeCampaignMapTokensCache(campaignId, currentMapUrl, { tokens: enriched });
        notifyConcentration(enriched);
      } catch (e) {
        logger.error("[useMapData] Token reload error:", e);
      }
    };

    const handleTokenEvent = (detail: unknown) => {
      logger.debug("[useMapData] Token event:", detail);
      reloadTokens();
    };

    const unsubscribeRemoved = subscribeAppEvent("tokenRemoved", handleTokenEvent);
    const unsubscribePlaced = subscribeAppEvent("tokenPlaced", handleTokenEvent);
    return () => {
      unsubscribeRemoved();
      unsubscribePlaced();
    };
  }, [campaignId, currentMapUrl, isDM, setTokens]);

  // ========== 自动在地图上放置 token ==========
  useEffect(() => {
    const ensureTokenOnMap = async () => {
      if (!campaignId || !currentMapUrl || !userId || !selectedCharacterId) return;
      try {
        const listData = await fetchCampaignMapTokensCached(campaignId, currentMapUrl, { userId });
        const tokensList: Token[] = listData.tokens || [];
        const exists = tokensList.some((t) => Number(t.character_id) === Number(selectedCharacterId));
        if (exists) return;

        const used = new Set<string>(tokensList.map((t) => `${t.position_x},${t.position_y}`));
        const cx = Math.floor(MAP_WIDTH / 2);
        const cy = Math.floor(MAP_HEIGHT / 2);
        const deltas: Array<[number, number]> = [
          [0,0],[1,0],[0,1],[-1,0],[0,-1],
          [1,1],[-1,1],[1,-1],[-1,-1],
          [2,0],[0,2],[-2,0],[0,-2],
          [2,1],[1,2],[-1,2],[-2,1],[-2,-1],[-1,-2],[1,-2],[2,-1]
        ];
        let nx = cx, ny = cy;
        for (const [dx, dy] of deltas) {
          const x = cx + dx, y = cy + dy;
          if (!used.has(`${x},${y}`)) { nx = x; ny = y; break; }
        }

        let initHP: number | null = null;
        try {
          const character = await fetchCharacterCached(Number(selectedCharacterId), { userId });
          if (character) {
            const derived = computeAll(character, { hpOptions: { includeFlatSubraceHP: true, includeSubraceLevelBonuses: true } });
            initHP = Number(derived.hp || 0);
          }
        } catch (err) {
          logger.warn("[useMapData] Failed to precompute HP for new token:", err);
        }

        const createResp = await authedFetch("/api/tokens/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaign_id: Number(campaignId),
            character_id: Number(selectedCharacterId),
            user_id: userId,
            map_url: currentMapUrl,
            position_x: nx,
            position_y: ny,
            ...(initHP !== null ? { current_hp: initHP } : {}),
          }),
        });

        if (createResp.ok) {
          await new Promise(resolve => setTimeout(resolve, 300));
          const refreshData = await fetchCampaignMapTokensCached(campaignId, currentMapUrl, {
            userId,
            force: true,
          });
          requestAnimationFrame(() => {
            setTokens(refreshData.tokens || []);
          });
        }
      } catch (e) {
        logger.error("[useMapData] ensureTokenOnMap error:", e);
      }
    };
    ensureTokenOnMap();
  }, [campaignId, currentMapUrl, userId, selectedCharacterId, setTokens]);
}
