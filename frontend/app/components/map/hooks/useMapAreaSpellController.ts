import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";

import type { SpellOption } from "../SelectionContextMenu";
import type { SpellAreaShape } from "../SpellAreaOverlay";
import { parseTokenSize } from "../utils/mapCalculations";
import type { Token } from "../types/TacticalMapTypes";
import { parseSpellRange } from "../utils/mapTargetingUtils";

function getAreaSpellTargetStroke(damageType?: string): string {
  const lower = String(damageType || "").toLowerCase();
  if (lower.includes("cold") || lower.includes("ice") || lower.includes("冰")) return "#3b82f6";
  if (lower.includes("lightning") || lower.includes("闪电")) return "#facc15";
  if (lower.includes("thunder") || lower.includes("雷")) return "#8b5cf6";
  if (lower.includes("acid") || lower.includes("酸")) return "#22c55e";
  if (lower.includes("force") || lower.includes("力场")) return "#ec4899";
  if (lower.includes("radiant") || lower.includes("光耀")) return "#fde047";
  if (lower.includes("necrotic") || lower.includes("黯蚀")) return "#4b5563";
  return "#ef4444";
}

export interface AreaSpellModeState {
  active: boolean;
  spell: SpellOption | null;
  slotLevel: number;
  sourceTokenId: number;
  shapeType: SpellAreaShape;
  centerPos: { x: number; y: number } | null;
  previewPos: { x: number; y: number } | null;
  originPos: { x: number; y: number } | null;
  direction: number;
  aimed: boolean;
  isSelfRange: boolean;
  placingOrigin: boolean;
  freecast?: boolean;
  ritualCast?: boolean;
  illusionImageUrl?: string;
  illusionDesc?: string;
  illusionDisplayName?: string;
  selectedOption?: string;
  materialId?: string;
  /** Long-cast / ritual cast pending placement: the non-combat handler
   *  must call `/api/spells/start-cast` with the chosen area instead of
   *  consuming the slot and creating the lasting effect immediately. */
  longCast?: boolean;
  /** Pre-confirmed concentration replacement, forwarded so the backend
   *  start-cast doesn't double-prompt. */
  confirmBreakConcentration?: boolean;
}

/** Stored placement from `Token.casting_in_progress.area_effect`, replayed
 *  when a ready long-cast / ritual is released so the DM doesn't have to
 *  re-pick the area they already chose at start-cast time. */
export interface PreselectedAreaPlacement {
  shape?: SpellAreaShape | string | null;
  center_x?: number | null;
  center_y?: number | null;
  origin_x?: number | null;
  origin_y?: number | null;
  direction?: number | null;
  // Extra fields from SpellAreaEffect (radius, color, map_url, etc.) are
  // tolerated so callers can pass the stored area_effect blob unchanged.
  [key: string]: unknown;
}

interface UseMapAreaSpellControllerArgs {
  areaSpellMode: AreaSpellModeState | null;
  setAreaSpellMode: Dispatch<SetStateAction<AreaSpellModeState | null>>;
  tokens: Token[];
  sourceCharacterData: any;
  gridUnitLength: number;
  showToast: (
    message: string,
    type?: "success" | "error" | "info" | "warning",
    duration?: number,
  ) => void;
  getTokensInArea: (params: {
    shapeType: SpellAreaShape;
    centerX?: number;
    centerY?: number;
    originX?: number;
    originY?: number;
    direction?: number;
    size: number;
    lineWidth?: number;
  }) => Token[];
  getBestInvokeDuplicityDistanceToGrid: (
    sourceTokenId: number,
    gridX: number,
    gridY: number,
  ) => number | null;
}

function calculateDirection(originX: number, originY: number, targetX: number, targetY: number): number {
  const dx = targetX - originX;
  const dy = targetY - originY;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function useMapAreaSpellController({
  areaSpellMode,
  setAreaSpellMode,
  tokens,
  sourceCharacterData,
  gridUnitLength,
  showToast,
  getTokensInArea,
  getBestInvokeDuplicityDistanceToGrid,
}: UseMapAreaSpellControllerArgs) {
  const areaSpellAffectedTokenIds = useMemo(() => {
    if (!areaSpellMode?.active || areaSpellMode.placingOrigin) return new Set<number>();
    const hasPosition = areaSpellMode.centerPos || areaSpellMode.previewPos || areaSpellMode.originPos;
    if (!hasPosition) return new Set<number>();

    const ids = getTokensInArea({
      shapeType: areaSpellMode.shapeType,
      centerX: areaSpellMode.centerPos?.x ?? areaSpellMode.previewPos?.x,
      centerY: areaSpellMode.centerPos?.y ?? areaSpellMode.previewPos?.y,
      originX: areaSpellMode.originPos?.x,
      originY: areaSpellMode.originPos?.y,
      direction: areaSpellMode.direction,
      size: areaSpellMode.spell?.areaOfEffect?.size || 20,
    })
      .filter((token) => (!areaSpellMode.spell?.healing ? token.id !== areaSpellMode.sourceTokenId : true))
      .map((token) => token.id);

    return new Set(ids);
  }, [areaSpellMode, getTokensInArea]);

  const areaSpellTargetStroke = useMemo(() => {
    return getAreaSpellTargetStroke(areaSpellMode?.spell?.damageType);
  }, [areaSpellMode?.spell?.damageType]);

  const handleAreaSpellSelect = useCallback((
    spell: SpellOption,
    sourceTokenId: number,
    slotLevel: number,
    freecast?: boolean,
    illusionImageUrl?: string,
    illusionDesc?: string,
    illusionDisplayName?: string,
    selectedOption?: string,
    materialId?: string,
    ritualCast?: boolean,
    longCast?: boolean,
    confirmBreakConcentration?: boolean,
    preselectedArea?: PreselectedAreaPlacement | null,
  ) => {
    if (slotLevel > 0 && !freecast && !ritualCast && sourceCharacterData?.spell_slots_state) {
      const slotKey = String(slotLevel);
      const slotData = sourceCharacterData.spell_slots_state[slotKey];
      if (!slotData || slotData.current <= 0) {
        showToast(`没有可用的 ${slotLevel} 环法术位`, "warning");
        return;
      }
    }

    const aoeType = spell.areaOfEffect?.type?.toLowerCase() || "sphere";
    const shapeType: SpellAreaShape = ["sphere", "cone", "line", "cube", "cylinder"].includes(aoeType)
      ? (aoeType as SpellAreaShape)
      : "sphere";
    const spellRange = spell.range || "";
    const isSelfRange = spellRange.includes("自身") || spellRange.toLowerCase().includes("self");

    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    const sourcePos = sourceToken
      ? (() => {
          const sourceSize = parseTokenSize(sourceToken.token_size);
          return {
            x: sourceToken.position_x + Math.max(sourceSize.width, 1) / 2,
            y: sourceToken.position_y + Math.max(sourceSize.height, 1) / 2,
          };
        })()
      : null;

    const isDirectional = shapeType === "cone" || shapeType === "line";

    // Ready-release replay: the caster already picked an area at start-cast
    // time and the backend stored it on `casting_in_progress.area_effect`.
    // When the DM clicks 释放, seed the picker so 施法 is available without
    // a second map click.
    if (preselectedArea) {
      const centerFromArea =
        preselectedArea.center_x != null && preselectedArea.center_y != null
          ? { x: preselectedArea.center_x, y: preselectedArea.center_y }
          : null;
      const originFromArea =
        preselectedArea.origin_x != null && preselectedArea.origin_y != null
          ? { x: preselectedArea.origin_x, y: preselectedArea.origin_y }
          : isDirectional
            ? centerFromArea
            : null;
      setAreaSpellMode({
        active: true,
        spell,
        slotLevel,
        sourceTokenId,
        shapeType,
        centerPos: isDirectional ? null : centerFromArea,
        previewPos: isDirectional ? (originFromArea ?? centerFromArea) : centerFromArea,
        originPos: isDirectional ? originFromArea : null,
        direction: preselectedArea.direction ?? 0,
        aimed: isDirectional,
        isSelfRange,
        placingOrigin: false,
        freecast,
        ritualCast,
        illusionImageUrl,
        illusionDesc,
        illusionDisplayName,
        selectedOption,
        materialId,
        longCast,
        confirmBreakConcentration,
      });
      return;
    }

    const originPos = isDirectional && isSelfRange ? sourcePos : null;
    const centerPos = !isDirectional && isSelfRange ? sourcePos : null;
    const placingOrigin = isDirectional && !isSelfRange;

    setAreaSpellMode({
      active: true,
      spell,
      slotLevel,
      sourceTokenId,
      shapeType,
      centerPos,
      previewPos: centerPos,
      originPos,
      direction: 0,
      aimed: false,
      isSelfRange,
      placingOrigin,
      freecast,
      ritualCast,
      illusionImageUrl,
      illusionDesc,
      illusionDisplayName,
      selectedOption,
      materialId,
      longCast,
      confirmBreakConcentration,
    });
  }, [showToast, sourceCharacterData, tokens]);

  const handleAreaSpellCancel = useCallback(() => {
    setAreaSpellMode(null);
  }, []);

  const snapAreaSpellPos = useCallback((rawX: number, rawY: number, shape: SpellAreaShape, sizeFeet: number) => {
    const sizeGrids = sizeFeet / gridUnitLength;
    if (shape === "cube") {
      if (Math.round(sizeGrids) % 2 === 1) {
        return { x: Math.floor(rawX) + 0.5, y: Math.floor(rawY) + 0.5 };
      }
      return { x: Math.round(rawX), y: Math.round(rawY) };
    }
    return { x: Math.round(rawX), y: Math.round(rawY) };
  }, [gridUnitLength]);

  const handleAreaSpellMouseMove = useCallback((gridX: number, gridY: number) => {
    if (!areaSpellMode) return;

    const isDirectional = areaSpellMode.shapeType === "cone" || areaSpellMode.shapeType === "line";
    const isLockedToCaster = areaSpellMode.isSelfRange && !isDirectional;
    if (isLockedToCaster) return;

    if (isDirectional && areaSpellMode.placingOrigin) {
      setAreaSpellMode((previous) => (previous ? { ...previous, previewPos: { x: gridX, y: gridY } } : null));
      return;
    }

    if (isDirectional && areaSpellMode.originPos) {
      const newDirection = calculateDirection(
        areaSpellMode.originPos.x,
        areaSpellMode.originPos.y,
        gridX,
        gridY,
      );
      setAreaSpellMode((previous) => (
        previous ? { ...previous, direction: newDirection, previewPos: { x: gridX, y: gridY } } : null
      ));
      return;
    }

    setAreaSpellMode((previous) => (previous ? { ...previous, previewPos: { x: gridX, y: gridY } } : null));
  }, [areaSpellMode]);

  const handleAreaSpellConfirm = useCallback((gridX: number, gridY: number) => {
    if (!areaSpellMode || !areaSpellMode.spell) return;

    const isDirectional = areaSpellMode.shapeType === "cone" || areaSpellMode.shapeType === "line";
    const isLockedToCaster = areaSpellMode.isSelfRange && !isDirectional;
    const sizeFeet = areaSpellMode.spell.areaOfEffect?.size || 20;
    const maxRange = parseSpellRange(areaSpellMode.spell.range);

    if (isLockedToCaster) {
      return;
    }

    if (!areaSpellMode.isSelfRange && maxRange != null && (!isDirectional || areaSpellMode.placingOrigin)) {
      const snappedForRange = isDirectional
        ? { x: Math.floor(gridX), y: Math.floor(gridY) }
        : snapAreaSpellPos(gridX, gridY, areaSpellMode.shapeType, sizeFeet);
      const distanceFeet = getBestInvokeDuplicityDistanceToGrid(
        areaSpellMode.sourceTokenId,
        snappedForRange.x,
        snappedForRange.y,
      );
      if (distanceFeet != null && distanceFeet > maxRange) {
        showToast(`超出法术射程 (${Math.round(distanceFeet)}尺 > 射程${maxRange}尺)`, "error");
        return;
      }
    }

    if (isDirectional && areaSpellMode.placingOrigin) {
      const snapped = snapAreaSpellPos(gridX, gridY, areaSpellMode.shapeType, sizeFeet);
      // Auto-aim: extend the line/cone away from the caster through the
      // click point. Without this, the user has to click a second time on
      // the map to "aim" before the 施法 button appears — Chrome QA on
      // Wind Wall showed this was easy to miss and looked like the spell
      // never entered pending-cast state. Re-clicking still re-aims via
      // the originPos branch below.
      const caster = tokens.find((token) => token.id === areaSpellMode.sourceTokenId);
      let initialDirection = areaSpellMode.direction;
      if (caster) {
        const casterSize = parseTokenSize(caster.token_size);
        const casterCenter = {
          x: caster.position_x + Math.max(casterSize.width, 1) / 2,
          y: caster.position_y + Math.max(casterSize.height, 1) / 2,
        };
        initialDirection = calculateDirection(casterCenter.x, casterCenter.y, snapped.x, snapped.y);
      }
      setAreaSpellMode((previous) => (
        previous
          ? { ...previous, originPos: snapped, placingOrigin: false, direction: initialDirection, aimed: true }
          : null
      ));
      return;
    }

    if (isDirectional && areaSpellMode.originPos) {
      const finalDirection = calculateDirection(
        areaSpellMode.originPos.x,
        areaSpellMode.originPos.y,
        gridX,
        gridY,
      );
      setAreaSpellMode((previous) => (
        previous ? { ...previous, direction: finalDirection, aimed: true } : null
      ));
      return;
    }

    const snapped = snapAreaSpellPos(gridX, gridY, areaSpellMode.shapeType, sizeFeet);
    setAreaSpellMode((previous) => (
      previous ? { ...previous, centerPos: snapped, previewPos: snapped } : null
    ));
  }, [
    areaSpellMode,
    getBestInvokeDuplicityDistanceToGrid,
    showToast,
    snapAreaSpellPos,
    tokens,
  ]);

  const isReadyToCast = useMemo(() => {
    if (!areaSpellMode) return false;
    const { shapeType, centerPos, originPos, placingOrigin, isSelfRange } = areaSpellMode;
    if (shapeType === "cone" || shapeType === "line") {
      return !!originPos && !placingOrigin && areaSpellMode.aimed;
    }
    if (isSelfRange) return true;
    return !!centerPos;
  }, [areaSpellMode]);

  return {
    areaSpellAffectedTokenIds,
    areaSpellMode,
    areaSpellTargetStroke,
    handleAreaSpellCancel,
    handleAreaSpellConfirm,
    handleAreaSpellMouseMove,
    handleAreaSpellSelect,
    isReadyToCast,
    setAreaSpellMode,
    snapAreaSpellPos,
  };
}
