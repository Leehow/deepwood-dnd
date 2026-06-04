import { memo, useMemo } from "react";
import { Circle, Layer, Line, Text as KonvaText } from "react-konva";

import { MapMarkerRenderer } from "./MapMarkerRenderer";
import { MapSpellRuntimeLinkOverlay } from "./MapSpellRuntimeLinkOverlay";
import { TokenComponent } from "./TokenComponent";
import { GRID_SIZE, type MapMarker, type Token } from "./types/TacticalMapTypes";

const EMPTY_STATUS_EFFECTS: any[] = [];

interface MapTokenLayerProps {
  visibleTokens: Token[];
  tokens: Token[];
  markers: MapMarker[];
  isDM: boolean;
  userId?: string;
  selectedTool?: string;
  tokenMode?: "place" | "delete";
  disableDrag: boolean;
  selectedTokenId: number | null;
  combatActiveTokenId: number | null;
  tokenStatusEffects: Record<number, any[]>;
  pendingManeuvers: Record<number, any>;
  hotbarTargeting: any;
  hoveredTokenId: number | null;
  areaSpellAffectedTokenIds: Set<number>;
  areaSpellTargetStroke: string | null;
  onHoveredTokenEnter?: (tokenId: number) => void;
  onHoveredTokenLeave?: () => void;
  onTokenStatusEffectClick?: (effect: any) => void;
  onTokenConcentrationSpellClick?: (spellName: string) => void;
  onTokenCastingSpellClick?: (spellName: string) => void;
  onTokenCastingModeInfoClick?: (tokenId: number) => void;
  onTokenConcentrationInfoClick?: () => void;
  onTokenConcentrationDurationChange?: (tokenId: number, delta: number) => void;
  onTokenConcentrationDurationEdit?: (tokenId: number, currentRemaining: number) => void;
  onTokenConcentrationBreak?: (tokenId: number) => void;
  onTokenCastingCancel?: (tokenId: number) => void;
  onTokenCastingCompleteNow?: (tokenId: number) => void;
  onTokenStatusEffectRemove?: (tokenId: number, effect: { id: string; [key: string]: any }) => void;
  onOngoingSave?: (tokenId: number, effectId: string) => void;
  onConditionSave?: (tokenId: number, effectId: string) => void;
  onEscapeAttempt?: (tokenId: number, effectId: string) => void;
  onStandUp?: (tokenId: number, effectId: string) => void;
  onTokenSelect: (tokenId: number) => void;
  onTokenDragEnd: (tokenId: number, e: any) => void;
  onTokenOpen: (tokenId: number) => void;
  currentTime?: any;
  selectedMarkerId?: number | null;
  onMarkerClick?: (marker: MapMarker) => void;
  anchorPosition?: { x: number; y: number } | null;
  areaSpellMode?: any;
  invokeDuplicityPlacementMode?: any;
}

export const MapTokenLayer = memo(function MapTokenLayer({
  visibleTokens,
  tokens,
  markers,
  isDM,
  userId,
  selectedTool,
  tokenMode = "place",
  disableDrag,
  selectedTokenId,
  combatActiveTokenId,
  tokenStatusEffects,
  pendingManeuvers,
  hotbarTargeting,
  hoveredTokenId,
  areaSpellAffectedTokenIds,
  areaSpellTargetStroke,
  onHoveredTokenEnter,
  onHoveredTokenLeave,
  onTokenStatusEffectClick,
  onTokenConcentrationSpellClick,
  onTokenCastingSpellClick,
  onTokenCastingModeInfoClick,
  onTokenConcentrationInfoClick,
  onTokenConcentrationDurationChange,
  onTokenConcentrationDurationEdit,
  onTokenConcentrationBreak,
  onTokenCastingCancel,
  onTokenCastingCompleteNow,
  onTokenStatusEffectRemove,
  onOngoingSave,
  onConditionSave,
  onEscapeAttempt,
  onStandUp,
  onTokenSelect,
  onTokenDragEnd,
  onTokenOpen,
  currentTime,
  selectedMarkerId,
  onMarkerClick,
  anchorPosition,
  areaSpellMode,
  invokeDuplicityPlacementMode,
}: MapTokenLayerProps) {
  const renderedTokens = useMemo(
    () =>
      visibleTokens.map((token) => (
        <TokenComponent
          key={token.id}
          token={token}
          isDM={isDM}
          userId={userId}
          selectedTool={selectedTool}
          tokenMode={tokenMode}
          disableDrag={disableDrag}
          isSelected={selectedTokenId === token.id}
          isActiveTurn={combatActiveTokenId === token.id}
          isInCombat={combatActiveTokenId !== null}
          statusEffects={tokenStatusEffects[token.id] ?? EMPTY_STATUS_EFFECTS}
          pendingManeuver={pendingManeuvers[token.id] || null}
          targetingMode={!!hotbarTargeting}
          targetedColor={
            areaSpellAffectedTokenIds.has(token.id)
              ? areaSpellTargetStroke
              : hotbarTargeting && hoveredTokenId === token.id
                ? "#a78bfa"
                : null
          }
          onMouseEnter={hotbarTargeting ? onHoveredTokenEnter : undefined}
          onMouseLeave={hotbarTargeting ? onHoveredTokenLeave : undefined}
          onStatusEffectClick={onTokenStatusEffectClick}
          onConcentrationSpellClick={onTokenConcentrationSpellClick}
          onCastingSpellClick={onTokenCastingSpellClick}
          onCastingModeInfoClick={onTokenCastingModeInfoClick}
          onConcentrationInfoClick={onTokenConcentrationInfoClick}
          onConcentrationDurationChange={isDM ? onTokenConcentrationDurationChange : undefined}
          onConcentrationDurationEdit={isDM ? onTokenConcentrationDurationEdit : undefined}
          onConcentrationBreak={onTokenConcentrationBreak}
          onCastingCancel={onTokenCastingCancel}
          onCastingCompleteNow={isDM ? onTokenCastingCompleteNow : undefined}
          onStatusEffectRemove={isDM ? onTokenStatusEffectRemove : undefined}
          onOngoingSave={isDM ? onOngoingSave : undefined}
          onConditionSave={isDM ? onConditionSave : undefined}
          onEscapeAttempt={isDM ? onEscapeAttempt : undefined}
          onStandUp={onStandUp}
          onSelect={onTokenSelect}
          onDragEnd={onTokenDragEnd}
          onClick={onTokenOpen}
          currentTime={currentTime}
        />
      )),
    [
      areaSpellAffectedTokenIds,
      areaSpellTargetStroke,
      combatActiveTokenId,
      currentTime,
      disableDrag,
      hotbarTargeting,
      hoveredTokenId,
      isDM,
      onConditionSave,
      onEscapeAttempt,
      onHoveredTokenEnter,
      onHoveredTokenLeave,
      onOngoingSave,
      onStandUp,
      onTokenCastingCancel,
      onTokenCastingCompleteNow,
      onTokenCastingModeInfoClick,
      onTokenCastingSpellClick,
      onTokenConcentrationBreak,
      onTokenConcentrationDurationChange,
      onTokenConcentrationDurationEdit,
      onTokenConcentrationInfoClick,
      onTokenConcentrationSpellClick,
      onTokenDragEnd,
      onTokenOpen,
      onTokenSelect,
      onTokenStatusEffectClick,
      onTokenStatusEffectRemove,
      pendingManeuvers,
      selectedTokenId,
      selectedTool,
      tokenMode,
      tokenStatusEffects,
      userId,
      visibleTokens,
    ],
  );

  return (
    <Layer key="token-layer" listening={!areaSpellMode && !invokeDuplicityPlacementMode}>
      <MapSpellRuntimeLinkOverlay
        visibleTokens={visibleTokens}
        selectedTokenId={selectedTokenId}
        currentWorldTime={currentTime}
      />
      {renderedTokens}
      <MapMarkerRenderer
        markers={markers}
        isDM={isDM}
        selectedMarkerId={selectedMarkerId}
        onMarkerClick={onMarkerClick}
      />
      {anchorPosition && (() => {
        const cx = anchorPosition.x * GRID_SIZE + GRID_SIZE / 2;
        const cy = anchorPosition.y * GRID_SIZE + GRID_SIZE / 2;
        const r = GRID_SIZE * 0.38;
        return (
          <>
            <Circle
              x={cx}
              y={cy}
              radius={r}
              stroke="#3b82f6"
              strokeWidth={2.5}
              fill="rgba(59,130,246,0.15)"
            />
            <Line points={[cx - r * 0.6, cy, cx + r * 0.6, cy]} stroke="#3b82f6" strokeWidth={1.5} />
            <Line points={[cx, cy - r * 0.6, cx, cy + r * 0.6]} stroke="#3b82f6" strokeWidth={1.5} />
            <Circle x={cx} y={cy} radius={3} fill="#3b82f6" />
            <KonvaText
              x={cx - 14}
              y={cy - r - 16}
              text="锚点"
              fontSize={12}
              fill="#93c5fd"
              fontStyle="bold"
              shadowColor="#000"
              shadowBlur={3}
              shadowOffsetX={1}
              shadowOffsetY={1}
            />
          </>
        );
      })()}
    </Layer>
  );
});

MapTokenLayer.displayName = "MapTokenLayer";
