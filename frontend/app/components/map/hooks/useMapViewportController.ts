import {
  useDeferredValue,
  useEffect,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { PlayerAvatar, Position, Token } from "../types/TacticalMapTypes";
import { getViewportBounds, isTokenInViewport } from "../utils/mapCalculations";
import {
  getActiveObscurementZones,
  isTokenInObscuredZone,
  type ObscurementZone,
} from "../utils/obscurementUtils";

export interface PlayerCompanion {
  monster_instance_id: number;
  name: string;
  control_type: string;
}

interface UseMapViewportControllerArgs {
  stagePos: Position;
  stageScale: number;
  stageSize: { width: number; height: number };
  tokens: Token[];
  isDM: boolean;
  userId?: string;
  selectedCharacterId?: number | null;
  currentMapUrl?: string | null;
  currentWorldTime?: { day?: number | null; hour?: number | null; minute?: number | null; second?: number | null } | null;
  gridUnitLength: number;
  spellsData: any;
  playerAvatars: PlayerAvatar[];
  companionMonsterDataMap: Record<number, any>;
  setCompanionMonsterDataMap: Dispatch<SetStateAction<Record<number, any>>>;
  fetchMonsterInstance: (monsterInstanceId: number) => Promise<any | null>;
}

export function buildPlayerCompanions(
  tokens: Token[],
  isDM: boolean,
  userId?: string,
): PlayerCompanion[] {
  if (isDM || !userId) return [];

  return tokens
    .filter(
      (token) =>
        token.monster_instance_id &&
        token.control_type &&
        token.controller_character_id &&
        tokens.some(
          (controllerToken) =>
            controllerToken.character_id === token.controller_character_id &&
            controllerToken.user_id === userId,
        ),
    )
    .map((token) => ({
      monster_instance_id: token.monster_instance_id!,
      name: token.instance_name || token.monster_name_cn || token.monster_name || "伙伴",
      control_type: token.control_type!,
    }));
}

export function buildControlledCharacterIds(
  tokens: Token[],
  isDM: boolean,
  userId?: string,
): Set<number> {
  if (isDM || !userId) return new Set<number>();

  return new Set(
    tokens
      .filter((token) => token.character_id && token.user_id === userId)
      .map((token) => token.character_id!),
  );
}

export function filterVisibleTokens(args: {
  tokens: Token[];
  viewportBounds: ReturnType<typeof getViewportBounds>;
  isDM: boolean;
  selectedCharacterId?: number | null;
  controlledCharacterIds: Set<number>;
  obscurementZones: ObscurementZone[];
  gridUnitLength: number;
}): Token[] {
  const {
    tokens,
    viewportBounds,
    isDM,
    selectedCharacterId,
    controlledCharacterIds,
    obscurementZones,
    gridUnitLength,
  } = args;

  return tokens.filter((token) => {
    if (!token || typeof token !== "object" || !token.id) return false;
    if (!isTokenInViewport(token, viewportBounds)) return false;
    if (isDM) return true;
    if (token.character_id && token.character_id === selectedCharacterId) return true;
    if (token.controller_character_id && controlledCharacterIds.has(token.controller_character_id)) {
      return true;
    }
    if (obscurementZones.length > 0) {
      const obscurementLevel = isTokenInObscuredZone(token, obscurementZones, gridUnitLength);
      if (obscurementLevel === "heavy") return false;
    }
    return true;
  });
}

export function buildZoomControlPlayerAvatars(
  playerAvatars: PlayerAvatar[],
  tokens: Token[],
): PlayerAvatar[] {
  if (playerAvatars.length > 0) return playerAvatars;

  return tokens
    .filter((token) => token.character_id && token.character_name)
    .reduce((avatars, token) => {
      if (!avatars.find((avatar) => avatar.id === token.character_id)) {
        const parsedUserId = token.user_id ? parseInt(token.user_id, 10) : undefined;
        avatars.push({
          id: token.character_id!,
          name: token.character_name!,
          avatar_url: token.avatar || undefined,
          isOnline: false,
          type: "player",
          userId: Number.isNaN(parsedUserId) ? undefined : parsedUserId,
        });
      }
      return avatars;
    }, [] as PlayerAvatar[]);
}

export function useMapViewportController({
  stagePos,
  stageScale,
  stageSize,
  tokens,
  isDM,
  userId,
  selectedCharacterId,
  currentMapUrl,
  currentWorldTime,
  gridUnitLength,
  spellsData,
  playerAvatars,
  companionMonsterDataMap,
  setCompanionMonsterDataMap,
  fetchMonsterInstance,
}: UseMapViewportControllerArgs) {
  const deferredStagePos = useDeferredValue(stagePos);
  const deferredStageScale = useDeferredValue(stageScale);

  const viewportBounds = useMemo(
    () => getViewportBounds(deferredStagePos, stageSize, deferredStageScale, 8),
    [
      deferredStagePos.x,
      deferredStagePos.y,
      deferredStageScale,
      stageSize.height,
      stageSize.width,
    ],
  );

  const playerCompanions = useMemo(
    () => buildPlayerCompanions(tokens, isDM, userId),
    [tokens, isDM, userId],
  );

  const obscurementZones = useMemo(
    () => getActiveObscurementZones(tokens, currentMapUrl, spellsData, currentWorldTime),
    [tokens, currentMapUrl, spellsData, currentWorldTime],
  );

  const controlledCharacterIds = useMemo(
    () => buildControlledCharacterIds(tokens, isDM, userId),
    [tokens, isDM, userId],
  );

  const visibleTokens = useMemo(
    () =>
      filterVisibleTokens({
        tokens,
        viewportBounds,
        isDM,
        selectedCharacterId,
        controlledCharacterIds,
        obscurementZones,
        gridUnitLength,
      }),
    [
      controlledCharacterIds,
      gridUnitLength,
      isDM,
      obscurementZones,
      selectedCharacterId,
      tokens,
      viewportBounds,
    ],
  );

  const zoomControlPlayerAvatars = useMemo(
    () => buildZoomControlPlayerAvatars(playerAvatars, tokens),
    [playerAvatars, tokens],
  );

  useEffect(() => {
    if (isDM || playerCompanions.length === 0) return;

    const missingCompanions = playerCompanions.filter(
      (companion) => !(companion.monster_instance_id in companionMonsterDataMap),
    );
    if (missingCompanions.length === 0) return;

    let cancelled = false;
    const preloadMissingCompanions = async () => {
      const companionEntries = await Promise.all(
        missingCompanions.map(async (companion) => [
          companion.monster_instance_id,
          await fetchMonsterInstance(companion.monster_instance_id),
        ] as const),
      );

      if (cancelled) return;

      setCompanionMonsterDataMap((previousMap) => {
        let changed = false;
        const nextMap = { ...previousMap };
        for (const [monsterInstanceId, monsterData] of companionEntries) {
          if (!(monsterInstanceId in nextMap)) {
            nextMap[monsterInstanceId] = monsterData;
            changed = true;
          }
        }
        return changed ? nextMap : previousMap;
      });
    };

    preloadMissingCompanions();
    return () => {
      cancelled = true;
    };
  }, [
    companionMonsterDataMap,
    fetchMonsterInstance,
    isDM,
    playerCompanions,
    setCompanionMonsterDataMap,
  ]);

  return {
    controlledCharacterIds,
    obscurementZones,
    playerCompanions,
    viewportBounds,
    visibleTokens,
    zoomControlPlayerAvatars,
  };
}
