import React from "react";
import { Circle, Line, Text as KonvaText } from "react-konva";

import { type AttackDistanceLineState, type MonsterActionCursorInfo, type MonsterActionTargetingState } from "./hooks/useMapCombatOverlays";
import type { HotbarCursorInfo } from "./hooks/useMapTargetingController";
import { AttackRangeOverlay } from "./AttackRangeOverlay";
import { GRID_SIZE, type TacticalMapProps, type Token } from "./types/TacticalMapTypes";
import { getEdgeToEdgeDistance, parseTokenSize } from "./utils/mapCalculations";
import { getAttackDistanceCursorPresentation, getTargetingRangeState, parseSpellRange, resolveHotbarRange } from "./utils/mapTargetingUtils";
import { SpellAreaOverlay, getDamageTypeColor, type SpellAreaShape } from "./SpellAreaOverlay";

type AreaSpellModeState = {
  spell: {
    areaOfEffect?: { size?: number };
    range?: string;
    damageType?: string;
    name?: string;
  } | null;
  sourceTokenId: number;
  shapeType: SpellAreaShape;
  centerPos: { x: number; y: number } | null;
  previewPos: { x: number; y: number } | null;
  originPos: { x: number; y: number } | null;
  direction: number;
  placingOrigin: boolean;
} | null;

type InvokeDuplicityPlacementModeState = {
  sourceTokenId: number;
  requestedCount: number;
  positions: Array<{ x: number; y: number }>;
  previewPos: { x: number; y: number } | null;
} | null;

interface MapTargetingOverlayLayerProps {
  tokens: Token[];
  gridUnitLength: number;
  hotbarTargeting: TacticalMapProps["hotbarTargeting"];
  hotbarCursorInfo: HotbarCursorInfo | null;
  attackDistanceLine: AttackDistanceLineState | null;
  selectionContextSourceToken?: Token | null;
  selectionContextTargetToken?: Token | null;
  monsterActionTargeting: MonsterActionTargetingState | null;
  monsterActionCursorInfo: MonsterActionCursorInfo | null;
  invokeDuplicityPlacementMode: InvokeDuplicityPlacementModeState;
  areaSpellMode: AreaSpellModeState;
  areaSpellAffectedTokenIds: Set<number>;
  isReadyToCast: boolean;
  getInvokeDuplicityDuplicateTokens: (sourceTokenId: number) => Token[];
  showRangeOverlays?: boolean;
  showRuntimeOverlays?: boolean;
}

function AttackDistanceCursorLine({
  selectionContextSourceToken,
  selectionContextTargetToken,
  attackDistanceLine,
  gridUnitLength,
}: {
  selectionContextSourceToken: Token;
  selectionContextTargetToken: Token;
  attackDistanceLine: AttackDistanceLineState;
  gridUnitLength: number;
}) {
  const sourceSize = parseTokenSize(selectionContextSourceToken.token_size);
  const targetSize = parseTokenSize(selectionContextTargetToken.token_size);
  const sourceCenterX = (
    selectionContextSourceToken.position_x + Math.max(sourceSize.width, 1) / 2
  ) * GRID_SIZE;
  const sourceCenterY = (
    selectionContextSourceToken.position_y + Math.max(sourceSize.height, 1) / 2
  ) * GRID_SIZE;
  const targetCenterX = (
    selectionContextTargetToken.position_x + Math.max(targetSize.width, 1) / 2
  ) * GRID_SIZE;
  const targetCenterY = (
    selectionContextTargetToken.position_y + Math.max(targetSize.height, 1) / 2
  ) * GRID_SIZE;
  const distanceFeet = getEdgeToEdgeDistance(
    selectionContextSourceToken.position_x,
    selectionContextSourceToken.position_y,
    sourceSize.width,
    sourceSize.height,
    selectionContextTargetToken.position_x,
    selectionContextTargetToken.position_y,
    targetSize.width,
    targetSize.height,
  ) * gridUnitLength;
  const presentation = getAttackDistanceCursorPresentation(
    distanceFeet,
    attackDistanceLine.normalRange,
    attackDistanceLine.maxRange,
  );
  const midX = (sourceCenterX + targetCenterX) / 2;
  const midY = (sourceCenterY + targetCenterY) / 2;

  return (
    <>
      <Line
        points={[sourceCenterX, sourceCenterY, targetCenterX, targetCenterY]}
        stroke={presentation.lineColor}
        strokeWidth={presentation.strokeWidth}
        dash={[8, 6]}
        opacity={presentation.opacity}
        listening={false}
      />
      <KonvaText
        text={presentation.distanceLabel}
        x={midX - 80}
        y={midY - 18}
        width={160}
        align="center"
        fontSize={presentation.fontSize}
        fontStyle={presentation.fontStyle}
        fill={presentation.textColor}
        shadowColor="black"
        shadowBlur={4}
        shadowOpacity={1}
        listening={false}
      />
    </>
  );
}

function HotbarCursorLine({
  tokens,
  gridUnitLength,
  hotbarTargeting,
  hotbarCursorInfo,
}: {
  tokens: Token[];
  gridUnitLength: number;
  hotbarTargeting: NonNullable<TacticalMapProps["hotbarTargeting"]>;
  hotbarCursorInfo: HotbarCursorInfo;
}) {
  const sourceToken =
    tokens.find((token) => token.id === hotbarCursorInfo.originTokenId)
    || tokens.find((token) => token.character_id === hotbarTargeting.sourceCharacterId);
  if (!sourceToken) return null;

  const sourceSize = parseTokenSize(sourceToken.token_size);
  const casterCenterX = (sourceToken.position_x + Math.max(sourceSize.width, 1) / 2) * GRID_SIZE;
  const casterCenterY = (sourceToken.position_y + Math.max(sourceSize.height, 1) / 2) * GRID_SIZE;
  const targetCenterX = (hotbarCursorInfo.gridX + 0.5) * GRID_SIZE;
  const targetCenterY = (hotbarCursorInfo.gridY + 0.5) * GRID_SIZE;
  const { normalR, maxR } = resolveHotbarRange(hotbarTargeting.slot, hotbarTargeting.targetingType);
  const { hasRange, inLong, outOfRange } = getTargetingRangeState(hotbarCursorInfo.dist, normalR, maxR);
  const isSpell = hotbarTargeting.targetingType === "spell";
  const lineColor = outOfRange && hasRange
    ? "#ef4444"
    : inLong
      ? "#eab308"
      : isSpell
        ? "rgba(200, 180, 255, 0.6)"
        : "rgba(74, 222, 128, 0.6)";
  const midX = (casterCenterX + targetCenterX) / 2;
  const midY = (casterCenterY + targetCenterY) / 2;
  const distLabel = outOfRange
    ? `${Math.round(hotbarCursorInfo.dist)}尺 / 超出射程(${maxR}尺)`
    : inLong
      ? `${Math.round(hotbarCursorInfo.dist)}尺 / 远程劣势`
      : `${Math.round(hotbarCursorInfo.dist)}尺${hasRange ? ` / ${maxR}尺` : ""}`;

  return (
    <>
      <Line
        points={[casterCenterX, casterCenterY, targetCenterX, targetCenterY]}
        stroke={lineColor}
        strokeWidth={outOfRange && hasRange ? 2 : 1.5}
        dash={[8, 6]}
        opacity={outOfRange && hasRange ? 0.9 : 0.7}
        listening={false}
      />
      {hasRange && (
        <KonvaText
          text={distLabel}
          x={midX - 80}
          y={midY - 18}
          width={160}
          align="center"
          fontSize={outOfRange ? 12 : 11}
          fontStyle={outOfRange || inLong ? "bold" : "normal"}
          fill={outOfRange ? "#ef4444" : inLong ? "#eab308" : "#d1d5db"}
          shadowColor="black"
          shadowBlur={4}
          shadowOpacity={1}
          listening={false}
        />
      )}
    </>
  );
}

function MonsterActionCursorLine({
  tokens,
  monsterActionTargeting,
  monsterActionCursorInfo,
}: {
  tokens: Token[];
  monsterActionTargeting: MonsterActionTargetingState;
  monsterActionCursorInfo: MonsterActionCursorInfo;
}) {
  const sourceToken = tokens.find((token) => token.id === monsterActionTargeting.sourceTokenId);
  if (!sourceToken) return null;

  const sourceSize = parseTokenSize(sourceToken.token_size);
  const sourceCenterX = (sourceToken.position_x + Math.max(sourceSize.width, 1) / 2) * GRID_SIZE;
  const sourceCenterY = (sourceToken.position_y + Math.max(sourceSize.height, 1) / 2) * GRID_SIZE;
  const targetCenterX = (monsterActionCursorInfo.gridX + 0.5) * GRID_SIZE;
  const targetCenterY = (monsterActionCursorInfo.gridY + 0.5) * GRID_SIZE;
  const { inLong, outOfRange } = getTargetingRangeState(
    monsterActionCursorInfo.dist,
    monsterActionTargeting.normalRange,
    monsterActionTargeting.maxRange,
  );
  const lineColor = outOfRange ? "#ef4444" : inLong ? "#eab308" : "rgba(251, 191, 36, 0.6)";
  const midX = (sourceCenterX + targetCenterX) / 2;
  const midY = (sourceCenterY + targetCenterY) / 2;
  const distLabel = outOfRange
    ? `${Math.round(monsterActionCursorInfo.dist)}尺 / 超出射程(${monsterActionTargeting.maxRange}尺)`
    : inLong
      ? `${Math.round(monsterActionCursorInfo.dist)}尺 / 远程劣势`
      : `${Math.round(monsterActionCursorInfo.dist)}尺 / ${monsterActionTargeting.maxRange}尺`;

  return (
    <>
      <Line
        points={[sourceCenterX, sourceCenterY, targetCenterX, targetCenterY]}
        stroke={lineColor}
        strokeWidth={outOfRange ? 2 : 1.5}
        dash={[8, 6]}
        opacity={outOfRange ? 0.9 : 0.7}
        listening={false}
      />
      <KonvaText
        text={distLabel}
        x={midX - 80}
        y={midY - 18}
        width={160}
        align="center"
        fontSize={outOfRange ? 12 : 11}
        fontStyle={outOfRange || inLong ? "bold" : "normal"}
        fill={outOfRange ? "#ef4444" : inLong ? "#eab308" : "#fcd34d"}
        shadowColor="black"
        shadowBlur={4}
        shadowOpacity={1}
        listening={false}
      />
    </>
  );
}

function InvokeDuplicityOverlay({
  invokeDuplicityPlacementMode,
}: {
  invokeDuplicityPlacementMode: NonNullable<InvokeDuplicityPlacementModeState>;
}) {
  return (
    <>
      {invokeDuplicityPlacementMode.positions.map((position, index) => (
        <React.Fragment key={`invoke-duplicity-${position.x}-${position.y}-${index}`}>
          <Circle
            x={(position.x + 0.5) * GRID_SIZE}
            y={(position.y + 0.5) * GRID_SIZE}
            radius={GRID_SIZE * 0.38}
            stroke="#818cf8"
            strokeWidth={2}
            fill="rgba(129, 140, 248, 0.25)"
            listening={false}
          />
          <KonvaText
            text={String(index + 1)}
            x={(position.x + 0.5) * GRID_SIZE - 8}
            y={(position.y + 0.5) * GRID_SIZE - 9}
            fontSize={14}
            fontStyle="bold"
            fill="#e0e7ff"
            shadowColor="#000"
            shadowBlur={3}
            listening={false}
          />
        </React.Fragment>
      ))}
      {invokeDuplicityPlacementMode.previewPos
        && invokeDuplicityPlacementMode.positions.length < invokeDuplicityPlacementMode.requestedCount
        && !invokeDuplicityPlacementMode.positions.some(
          (position) =>
            position.x === invokeDuplicityPlacementMode.previewPos?.x
            && position.y === invokeDuplicityPlacementMode.previewPos?.y,
        ) && (
          <Circle
            x={(invokeDuplicityPlacementMode.previewPos.x + 0.5) * GRID_SIZE}
            y={(invokeDuplicityPlacementMode.previewPos.y + 0.5) * GRID_SIZE}
            radius={GRID_SIZE * 0.34}
            stroke="#c4b5fd"
            strokeWidth={2}
            dash={[6, 4]}
            fill="rgba(196, 181, 253, 0.16)"
            listening={false}
          />
        )}
    </>
  );
}

function AreaSpellTargetingOverlay({
  tokens,
  gridUnitLength,
  areaSpellMode,
  areaSpellAffectedTokenIds,
  isReadyToCast,
}: {
  tokens: Token[];
  gridUnitLength: number;
  areaSpellMode: NonNullable<AreaSpellModeState>;
  areaSpellAffectedTokenIds: Set<number>;
  isReadyToCast: boolean;
}) {
  if (
    !areaSpellMode.spell
    || !(areaSpellMode.previewPos || areaSpellMode.centerPos || areaSpellMode.originPos)
  ) {
    return null;
  }

  const sourceToken = tokens.find((token) => token.id === areaSpellMode.sourceTokenId);
  const casterPos = sourceToken
    ? (() => {
        const sourceSize = parseTokenSize(sourceToken.token_size);
        return {
          x: sourceToken.position_x + Math.max(sourceSize.width, 1) / 2,
          y: sourceToken.position_y + Math.max(sourceSize.height, 1) / 2,
        };
      })()
    : undefined;
  const maxRange = parseSpellRange(areaSpellMode.spell.range);

  return (
    <SpellAreaOverlay
      centerX={
        areaSpellMode.placingOrigin
          ? (areaSpellMode.previewPos?.x ?? 0)
          : (areaSpellMode.shapeType === "cone" || areaSpellMode.shapeType === "line")
            ? (areaSpellMode.originPos?.x ?? 0)
            : ((areaSpellMode.centerPos || areaSpellMode.previewPos)?.x ?? 0)
      }
      centerY={
        areaSpellMode.placingOrigin
          ? (areaSpellMode.previewPos?.y ?? 0)
          : (areaSpellMode.shapeType === "cone" || areaSpellMode.shapeType === "line")
            ? (areaSpellMode.originPos?.y ?? 0)
            : ((areaSpellMode.centerPos || areaSpellMode.previewPos)?.y ?? 0)
      }
      radiusFeet={areaSpellMode.spell.areaOfEffect?.size || 20}
      gridSize={GRID_SIZE}
      gridUnitLength={gridUnitLength}
      ready={isReadyToCast}
      spellName={areaSpellMode.spell.name}
      targetCount={areaSpellAffectedTokenIds.size > 0 ? areaSpellAffectedTokenIds.size : undefined}
      color={getDamageTypeColor(areaSpellMode.spell.damageType)}
      shapeType={areaSpellMode.shapeType}
      originX={areaSpellMode.originPos?.x}
      originY={areaSpellMode.originPos?.y}
      direction={areaSpellMode.direction}
      placingOrigin={areaSpellMode.placingOrigin}
      casterX={casterPos?.x}
      casterY={casterPos?.y}
      maxRange={maxRange}
    />
  );
}

export function MapTargetingOverlayLayer({
  tokens,
  gridUnitLength,
  hotbarTargeting,
  hotbarCursorInfo,
  attackDistanceLine,
  selectionContextSourceToken,
  selectionContextTargetToken,
  monsterActionTargeting,
  monsterActionCursorInfo,
  invokeDuplicityPlacementMode,
  areaSpellMode,
  areaSpellAffectedTokenIds,
  isReadyToCast,
  getInvokeDuplicityDuplicateTokens,
  showRangeOverlays = true,
  showRuntimeOverlays = true,
}: MapTargetingOverlayLayerProps) {
  return (
    <>
      {showRangeOverlays && hotbarTargeting && (() => {
        const { normalR, maxR } = resolveHotbarRange(hotbarTargeting.slot, hotbarTargeting.targetingType);
        if (normalR >= 999) return null;
        const sourceToken = tokens.find((token) => token.character_id === hotbarTargeting.sourceCharacterId);
        if (!sourceToken) return null;
        const rangeOriginTokens = hotbarTargeting.targetingType === "spell"
          ? [sourceToken, ...getInvokeDuplicityDuplicateTokens(sourceToken.id)]
          : [sourceToken];

        return (
          <>
            {rangeOriginTokens.map((originToken) => (
              <AttackRangeOverlay
                key={`hotbar-range-${hotbarTargeting.targetingType}-${originToken.id}`}
                tokenX={originToken.position_x}
                tokenY={originToken.position_y}
                tokenSize={originToken.token_size || "1x1"}
                normalRangeFeet={normalR}
                maxRangeFeet={maxR}
                gridSize={GRID_SIZE}
                gridUnitLength={gridUnitLength}
              />
            ))}
          </>
        );
      })()}

      {showRangeOverlays && attackDistanceLine && !hotbarTargeting && !monsterActionTargeting && (() => {
        const sourceToken = selectionContextSourceToken
          || (attackDistanceLine.sourceTokenId
            ? tokens.find((token) => token.id === attackDistanceLine.sourceTokenId)
            : null);
        if (!sourceToken) return null;

        return (
          <AttackRangeOverlay
            tokenX={sourceToken.position_x}
            tokenY={sourceToken.position_y}
            tokenSize={sourceToken.token_size || "1x1"}
            normalRangeFeet={attackDistanceLine.normalRange}
            maxRangeFeet={attackDistanceLine.maxRange}
            gridSize={GRID_SIZE}
            gridUnitLength={gridUnitLength}
          />
        );
      })()}

      {showRangeOverlays && monsterActionTargeting && (() => {
        const sourceToken = tokens.find((token) => token.id === monsterActionTargeting.sourceTokenId);
        if (!sourceToken) return null;

        return (
          <AttackRangeOverlay
            tokenX={sourceToken.position_x}
            tokenY={sourceToken.position_y}
            tokenSize={sourceToken.token_size || "1x1"}
            normalRangeFeet={monsterActionTargeting.normalRange}
            maxRangeFeet={monsterActionTargeting.maxRange}
            gridSize={GRID_SIZE}
            gridUnitLength={gridUnitLength}
          />
        );
      })()}

      {showRangeOverlays && invokeDuplicityPlacementMode && (() => {
        const sourceToken = tokens.find((token) => token.id === invokeDuplicityPlacementMode.sourceTokenId);
        if (!sourceToken) return null;

        return (
          <AttackRangeOverlay
            tokenX={sourceToken.position_x}
            tokenY={sourceToken.position_y}
            tokenSize={sourceToken.token_size || "1x1"}
            normalRangeFeet={30}
            maxRangeFeet={30}
            gridSize={GRID_SIZE}
            gridUnitLength={gridUnitLength}
          />
        );
      })()}

      {showRuntimeOverlays && hotbarTargeting && hotbarCursorInfo && (
        <HotbarCursorLine
          tokens={tokens}
          gridUnitLength={gridUnitLength}
          hotbarTargeting={hotbarTargeting}
          hotbarCursorInfo={hotbarCursorInfo}
        />
      )}

      {showRuntimeOverlays && monsterActionTargeting && monsterActionCursorInfo && (
        <MonsterActionCursorLine
          tokens={tokens}
          monsterActionTargeting={monsterActionTargeting}
          monsterActionCursorInfo={monsterActionCursorInfo}
        />
      )}

      {showRuntimeOverlays && invokeDuplicityPlacementMode && (
        <InvokeDuplicityOverlay invokeDuplicityPlacementMode={invokeDuplicityPlacementMode} />
      )}

      {showRuntimeOverlays
        && attackDistanceLine
        && selectionContextSourceToken
        && selectionContextTargetToken
        && !hotbarTargeting
        && !monsterActionTargeting && (
          <AttackDistanceCursorLine
            selectionContextSourceToken={selectionContextSourceToken}
            selectionContextTargetToken={selectionContextTargetToken}
            attackDistanceLine={attackDistanceLine}
            gridUnitLength={gridUnitLength}
          />
        )}

      {showRuntimeOverlays && areaSpellMode && (
        <AreaSpellTargetingOverlay
          tokens={tokens}
          gridUnitLength={gridUnitLength}
          areaSpellMode={areaSpellMode}
          areaSpellAffectedTokenIds={areaSpellAffectedTokenIds}
          isReadyToCast={isReadyToCast}
        />
      )}
    </>
  );
}
