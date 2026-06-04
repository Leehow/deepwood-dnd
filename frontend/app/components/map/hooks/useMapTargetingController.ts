import { useCallback, useEffect, useState, type MutableRefObject, type RefObject } from "react";

import { GRID_SIZE, type Token } from "../types/TacticalMapTypes";
import { getEdgeToEdgeDistance, parseTokenSize } from "../utils/mapCalculations";

export type HotbarTargetingState = {
  sourceCharacterId: number;
  targetingType?: "spell" | "ability" | "attack";
};

export interface HotbarCursorInfo {
  x: number;
  y: number;
  dist: number;
  gridX: number;
  gridY: number;
  originTokenId: number;
}

interface UseMapTargetingControllerArgs {
  containerRef: RefObject<HTMLDivElement | null>;
  stagePosRef: MutableRefObject<{ x: number; y: number }>;
  stageScaleRef: MutableRefObject<number>;
  tokens: Token[];
  gridUnitLength: number;
  hotbarTargeting: HotbarTargetingState | null;
  monsterActionTargeting: any;
  getBestInvokeDuplicityOriginTokenToGrid: (
    sourceTokenId: number,
    gridX: number,
    gridY: number,
  ) => Token | null | undefined;
  getBestInvokeDuplicityOriginTokenToToken: (
    sourceTokenId: number,
    targetToken: Token,
  ) => Token | null | undefined;
  handleSelectionMonsterAction: (action: any, sourceTokenId: number, targetTokenId: number) => void;
  setMonsterActionTargeting: (targeting: any) => void;
  onHotbarTargetSelect?: (
    tokenId: number,
    name: string,
    distanceFeet: number,
    meta: {
      currentHp?: number;
      maxHp?: number;
      monsterType?: string;
    },
  ) => void;
  onHotbarTargetCancel?: () => void;
}

export function useMapTargetingController({
  containerRef,
  stagePosRef,
  stageScaleRef,
  tokens,
  gridUnitLength,
  hotbarTargeting,
  monsterActionTargeting,
  getBestInvokeDuplicityOriginTokenToGrid,
  getBestInvokeDuplicityOriginTokenToToken,
  handleSelectionMonsterAction,
  setMonsterActionTargeting,
  onHotbarTargetSelect,
  onHotbarTargetCancel,
}: UseMapTargetingControllerArgs) {
  const [hoveredTokenId, setHoveredTokenId] = useState<number | null>(null);
  const [hotbarCursorInfo, setHotbarCursorInfo] = useState<HotbarCursorInfo | null>(null);

  useEffect(() => {
    if (!hotbarTargeting) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onHotbarTargetCancel?.();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [hotbarTargeting, onHotbarTargetCancel]);

  useEffect(() => {
    if (!hotbarTargeting || !containerRef.current) {
      setHotbarCursorInfo(null);
      return;
    }

    const sourceToken = tokens.find((token) => token.character_id === hotbarTargeting.sourceCharacterId);
    if (!sourceToken) return;
    const container = containerRef.current;

    const handleMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const currentStagePos = stagePosRef.current;
      const currentStageScale = stageScaleRef.current;
      const canvasX = (event.clientX - rect.left - currentStagePos.x) / currentStageScale;
      const canvasY = (event.clientY - rect.top - currentStagePos.y) / currentStageScale;
      const gridX = Math.floor(canvasX / GRID_SIZE);
      const gridY = Math.floor(canvasY / GRID_SIZE);
      const rangeOriginToken =
        hotbarTargeting.targetingType === "spell"
          ? getBestInvokeDuplicityOriginTokenToGrid(sourceToken.id, gridX, gridY) || sourceToken
          : sourceToken;
      const originSize = parseTokenSize(rangeOriginToken.token_size || "1x1");
      const dist =
        getEdgeToEdgeDistance(
          rangeOriginToken.position_x,
          rangeOriginToken.position_y,
          originSize.width,
          originSize.height,
          gridX,
          gridY,
          1,
          1,
        ) * gridUnitLength;

      setHotbarCursorInfo({
        x: event.clientX,
        y: event.clientY,
        dist,
        gridX,
        gridY,
        originTokenId: rangeOriginToken.id,
      });
    };

    container.addEventListener("mousemove", handleMove);
    return () => container.removeEventListener("mousemove", handleMove);
  }, [
    containerRef,
    getBestInvokeDuplicityOriginTokenToGrid,
    gridUnitLength,
    hotbarTargeting,
    stagePosRef,
    stageScaleRef,
    tokens,
  ]);

  const handleHoveredTokenEnter = useCallback((tokenId: number) => {
    setHoveredTokenId(tokenId);
  }, []);

  const handleHoveredTokenLeave = useCallback(() => {
    setHoveredTokenId(null);
  }, []);

  const handleTargetingTokenSelection = useCallback(
    (tokenId: number) => {
      if (monsterActionTargeting) {
        handleSelectionMonsterAction(monsterActionTargeting.action, monsterActionTargeting.sourceTokenId, tokenId);
        setMonsterActionTargeting(null);
        return true;
      }

      if (!hotbarTargeting) return false;

      const targetToken = tokens.find((candidate) => candidate.id === tokenId);
      const name =
        targetToken?.instance_name ||
        targetToken?.character_name ||
        targetToken?.monster_name ||
        "目标";
      const sourceToken = tokens.find(
        (candidate) => candidate.character_id === hotbarTargeting.sourceCharacterId,
      );
      let distanceFeet = 0;

      if (sourceToken && targetToken) {
        const rangeOriginToken =
          hotbarTargeting.targetingType === "spell"
            ? getBestInvokeDuplicityOriginTokenToToken(sourceToken.id, targetToken) || sourceToken
            : sourceToken;
        const sourceSize = parseTokenSize(rangeOriginToken.token_size || "1x1");
        const targetSize = parseTokenSize(targetToken.token_size || "1x1");
        distanceFeet =
          getEdgeToEdgeDistance(
            rangeOriginToken.position_x,
            rangeOriginToken.position_y,
            sourceSize.width,
            sourceSize.height,
            targetToken.position_x,
            targetToken.position_y,
            targetSize.width,
            targetSize.height,
          ) * gridUnitLength;
      }

      onHotbarTargetSelect?.(tokenId, name, distanceFeet, {
        currentHp: targetToken?.current_hp ?? undefined,
        maxHp: targetToken?.max_hp ?? undefined,
        monsterType: targetToken?.monster_type ?? undefined,
      });
      return true;
    },
    [
      getBestInvokeDuplicityOriginTokenToToken,
      gridUnitLength,
      handleSelectionMonsterAction,
      hotbarTargeting,
      monsterActionTargeting,
      onHotbarTargetSelect,
      setMonsterActionTargeting,
      tokens,
    ],
  );

  return {
    handleHoveredTokenEnter,
    handleHoveredTokenLeave,
    handleTargetingTokenSelection,
    hotbarCursorInfo,
    hoveredTokenId,
  };
}
