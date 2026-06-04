import {
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";

import { GRID_SIZE, type Position, type Token } from "../types/TacticalMapTypes";
import { getEdgeToEdgeDistance, parseTokenSize } from "../utils/mapCalculations";
import { subscribeAppEvent } from "~/events/appEventBus";

export interface MovementOverlayState {
  tokenId: number;
  movementFeet: number;
}

export interface AttackDistanceLineState {
  normalRange: number;
  maxRange: number;
  sourceTokenId?: number;
}

export interface MonsterActionTargetingState {
  action: any;
  sourceTokenId: number;
  normalRange: number;
  maxRange: number;
}

export interface MonsterActionCursorInfo {
  x: number;
  y: number;
  dist: number;
  gridX: number;
  gridY: number;
}

export interface MovementOverlayCell {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

interface UseMapCombatOverlaysArgs {
  isDM: boolean;
  userId?: string;
  selectedTokenId: number | null;
  selectionContextMenuOpen: boolean;
  tokens: Token[];
  gridUnitLength: number;
  containerRef: RefObject<HTMLDivElement>;
  stagePosRef: MutableRefObject<Position>;
  stageScaleRef: MutableRefObject<number>;
  showToast: (
    message: string,
    type?: "success" | "error" | "info" | "warning",
    duration?: number,
  ) => void;
}

function readMovementOverlayState(
  isDM: boolean,
  userId: string | undefined,
  selectedTokenId: number | null,
): MovementOverlayState | null {
  const runtimeWindow = window as typeof window & {
    __combatIsActive?: boolean;
    __combatActiveTokenId?: number;
    __combatTurnUserId?: string | number;
    __combatMovementRemaining?: number;
    __combatDmSelectedTokenId?: number | string;
    __combatDmSelectedMovement?: number;
  };

  if (!runtimeWindow.__combatIsActive) {
    return null;
  }

  if (!isDM) {
    const activeTokenId = runtimeWindow.__combatActiveTokenId;
    const turnUserId = runtimeWindow.__combatTurnUserId;
    const remaining = runtimeWindow.__combatMovementRemaining ?? 0;
    if (activeTokenId && String(turnUserId) === String(userId)) {
      return { tokenId: activeTokenId, movementFeet: remaining };
    }
    return null;
  }

  if (!selectedTokenId) {
    return null;
  }

  const activeTokenId = runtimeWindow.__combatActiveTokenId;
  if (selectedTokenId == activeTokenId) {
    return {
      tokenId: selectedTokenId,
      movementFeet: runtimeWindow.__combatMovementRemaining ?? 0,
    };
  }

  if (runtimeWindow.__combatDmSelectedTokenId == selectedTokenId) {
    return {
      tokenId: selectedTokenId,
      movementFeet: runtimeWindow.__combatDmSelectedMovement ?? 0,
    };
  }

  return null;
}

export function buildMovementOverlayCells(
  movementOverlay: MovementOverlayState | null,
  tokens: Token[],
  gridUnitLength: number,
): MovementOverlayCell[] | null {
  if (!movementOverlay) return null;

  const token = tokens.find((candidate) => candidate.id === movementOverlay.tokenId);
  if (!token) return null;

  const moveFeet = movementOverlay.movementFeet;
  if (moveFeet <= 0 || gridUnitLength <= 0) return null;

  const rangeInGrids = Math.floor(moveFeet / gridUnitLength);
  if (rangeInGrids <= 0) return null;

  const sizeMatch = (token.token_size || "1x1").match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
  const tokenWidth = Math.max(1, sizeMatch ? Math.round(parseFloat(sizeMatch[1])) : 1);
  const tokenHeight = Math.max(1, sizeMatch ? Math.round(parseFloat(sizeMatch[2])) : 1);
  const occupied = new Set<string>();
  for (let offsetX = 0; offsetX < tokenWidth; offsetX += 1) {
    for (let offsetY = 0; offsetY < tokenHeight; offsetY += 1) {
      occupied.add(`${token.position_x + offsetX},${token.position_y + offsetY}`);
    }
  }

  const cells: MovementOverlayCell[] = [];
  for (
    let gridX = token.position_x - rangeInGrids;
    gridX <= token.position_x + tokenWidth - 1 + rangeInGrids;
    gridX += 1
  ) {
    for (
      let gridY = token.position_y - rangeInGrids;
      gridY <= token.position_y + tokenHeight - 1 + rangeInGrids;
      gridY += 1
    ) {
      if (occupied.has(`${gridX},${gridY}`)) continue;

      let minDistance = Number.POSITIVE_INFINITY;
      for (let offsetX = 0; offsetX < tokenWidth; offsetX += 1) {
        for (let offsetY = 0; offsetY < tokenHeight; offsetY += 1) {
          minDistance = Math.min(
            minDistance,
            Math.max(
              Math.abs(gridX - (token.position_x + offsetX)),
              Math.abs(gridY - (token.position_y + offsetY)),
            ),
          );
        }
      }

      if (minDistance <= rangeInGrids) {
        cells.push({
          key: `mr-${gridX}-${gridY}`,
          x: gridX * GRID_SIZE,
          y: gridY * GRID_SIZE,
          width: GRID_SIZE,
          height: GRID_SIZE,
          fill: "rgba(34,197,94,0.2)",
          stroke: "rgba(34,197,94,0.45)",
          strokeWidth: 1,
        });
      }
    }
  }

  return cells.length > 0 ? cells : null;
}

export function useMapCombatOverlays({
  isDM,
  userId,
  selectedTokenId,
  selectionContextMenuOpen,
  tokens,
  gridUnitLength,
  containerRef,
  stagePosRef,
  stageScaleRef,
  showToast,
}: UseMapCombatOverlaysArgs) {
  const [movementOverlay, setMovementOverlay] = useState<MovementOverlayState | null>(null);
  const [attackDistanceLine, setAttackDistanceLine] = useState<AttackDistanceLineState | null>(
    null,
  );
  const [monsterActionTargeting, setMonsterActionTargeting] =
    useState<MonsterActionTargetingState | null>(null);
  const [monsterActionCursorInfo, setMonsterActionCursorInfo] =
    useState<MonsterActionCursorInfo | null>(null);

  useEffect(() => {
    const updateOverlay = () => {
      setMovementOverlay(readMovementOverlayState(isDM, userId, selectedTokenId));
    };

    const unsubscribeTurnChanged = subscribeAppEvent("combatTurnChanged", updateOverlay);
    const unsubscribeMovementChanged = subscribeAppEvent("combatMovementChanged", updateOverlay);
    const unsubscribeTokenSelected = subscribeAppEvent("mapTokenSelected", updateOverlay);
    updateOverlay();

    return () => {
      unsubscribeTurnChanged();
      unsubscribeMovementChanged();
      unsubscribeTokenSelected();
    };
  }, [isDM, userId, selectedTokenId]);

  useEffect(() => subscribeAppEvent("attackDistanceLine", (detail) => {
    setAttackDistanceLine(
      detail
        ? {
            normalRange: detail.normalRange,
            maxRange: detail.maxRange,
            sourceTokenId: detail.sourceTokenId,
          }
        : null,
    );
  }), []);

  useEffect(() => {
    return subscribeAppEvent("monsterActionTargeting", (detail) => {
      setMonsterActionTargeting(
        detail
          ? {
              action: detail.action,
              sourceTokenId: detail.sourceTokenId,
              normalRange: detail.normalRange,
              maxRange: detail.maxRange,
          }
          : null,
      );
    });
  }, []);

  useEffect(() => {
    if (!selectionContextMenuOpen) {
      setAttackDistanceLine(null);
    }
  }, [selectionContextMenuOpen]);

  useEffect(() => {
    if (!monsterActionTargeting) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMonsterActionTargeting(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [monsterActionTargeting]);

  useEffect(() => {
    if (!monsterActionTargeting) return;

    const sourceToken = tokens.find((candidate) => candidate.id === monsterActionTargeting.sourceTokenId);
    const sourceName = sourceToken?.instance_name || sourceToken?.monster_name || "怪物";
    showToast(`${sourceName} → ${monsterActionTargeting.action.name}：点击目标 token（ESC 取消）`, "info", 5000);
  }, [monsterActionTargeting, showToast, tokens]);

  useEffect(() => {
    if (!monsterActionTargeting || !containerRef.current) {
      setMonsterActionCursorInfo(null);
      return;
    }

    const sourceToken = tokens.find((candidate) => candidate.id === monsterActionTargeting.sourceTokenId);
    if (!sourceToken) {
      setMonsterActionCursorInfo(null);
      return;
    }

    const sourceSize = parseTokenSize(sourceToken.token_size);
    const container = containerRef.current;
    const handleMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const currentStagePos = stagePosRef.current;
      const currentStageScale = stageScaleRef.current;
      const canvasX = (event.clientX - rect.left - currentStagePos.x) / currentStageScale;
      const canvasY = (event.clientY - rect.top - currentStagePos.y) / currentStageScale;
      const gridX = Math.floor(canvasX / GRID_SIZE);
      const gridY = Math.floor(canvasY / GRID_SIZE);
      const dist =
        getEdgeToEdgeDistance(
          sourceToken.position_x,
          sourceToken.position_y,
          sourceSize.width,
          sourceSize.height,
          gridX,
          gridY,
          1,
          1,
        ) * gridUnitLength;

      setMonsterActionCursorInfo({
        x: event.clientX,
        y: event.clientY,
        dist,
        gridX,
        gridY,
      });
    };

    container.addEventListener("mousemove", handleMove);
    return () => container.removeEventListener("mousemove", handleMove);
  }, [containerRef, gridUnitLength, monsterActionTargeting, stagePosRef, stageScaleRef, tokens]);

  const movementOverlayCells = useMemo(
    () => buildMovementOverlayCells(movementOverlay, tokens, gridUnitLength),
    [gridUnitLength, movementOverlay, tokens],
  );

  return {
    attackDistanceLine,
    monsterActionCursorInfo,
    monsterActionTargeting,
    movementOverlayCells,
    setMonsterActionTargeting,
  };
}
