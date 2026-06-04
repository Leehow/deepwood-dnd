/**
 * useMapState Hook
 * Manages all state variables for the TacticalMap component
 */

import { useState, useRef } from "react";
import type { Token, Ruler, Drawing, MapMarker } from "../types/TacticalMapTypes";
import type { FogData } from "../FogOfWarManager";
import type { TerrainData } from "../TerrainManager";

export function useMapState() {
  // Container and stage refs
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<any>(null);
  const saveViewStateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const viewStateLoadedRef = useRef(false);
  const lastDist = useRef(0);
  const lastCenter = useRef({ x: 0, y: 0 });

  // Canvas size
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });

  // Tokens
  const [tokens, setTokens] = useState<Token[]>([]);

  // Map viewport state
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState(1);

  // HP editing dialog state
  const [editingTokenId, setEditingTokenId] = useState<number | null>(null);
  const [editingTokenHP, setEditingTokenHP] = useState<number>(0);
  const [editingTokenMaxHP, setEditingTokenMaxHP] = useState<number | null>(null);

  // Params editor state
  const [editingParamsTokenId, setEditingParamsTokenId] = useState<number | null>(null);

  // Item detail modal state
  const [itemDetailTokenId, setItemDetailTokenId] = useState<number | null>(null);

  // Loot bag modal state
  const [lootBagTokenId, setLootBagTokenId] = useState<number | null>(null);

  // RTS-style selection state (DM only)
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);

  // Fog of war state
  const [fogBrushSize, setFogBrushSize] = useState(1);
  const [fogData, setFogData] = useState<FogData | null>(null);

  // Terrain state
  const [terrainData, setTerrainData] = useState<TerrainData | null>(null);

  // Ruler state
  const [rulers, setRulers] = useState<Ruler[]>([]);
  const [gridUnitLength, setGridUnitLength] = useState(5.0);

  // Drawing state
  const [drawings, setDrawings] = useState<Drawing[]>([]);

  // Map marker state
  const [markers, setMarkers] = useState<MapMarker[]>([]);

  // Anchor position state
  const [anchorPosition, setAnchorPosition] = useState<{ x: number; y: number } | null>(null);

  // Map image state
  const [mapImage, setMapImage] = useState<HTMLImageElement | null>(null);
  const [mapImageLoaded, setMapImageLoaded] = useState(false);

  // Minimap collapsed state (persisted with view state)
  const [minimapCollapsed, setMinimapCollapsed] = useState(false);

  return {
    // Refs
    containerRef,
    stageRef,
    saveViewStateTimerRef,
    viewStateLoadedRef,
    lastDist,
    lastCenter,

    // Stage state
    stageSize,
    setStageSize,
    stagePos,
    setStagePos,
    stageScale,
    setStageScale,

    // Token state
    tokens,
    setTokens,
    editingTokenId,
    setEditingTokenId,
    editingTokenHP,
    setEditingTokenHP,
    editingTokenMaxHP,
    setEditingTokenMaxHP,
    editingParamsTokenId,
    setEditingParamsTokenId,
    itemDetailTokenId,
    setItemDetailTokenId,
    lootBagTokenId,
    setLootBagTokenId,
    selectedTokenId,
    setSelectedTokenId,

    // Fog state
    fogBrushSize,
    setFogBrushSize,
    fogData,
    setFogData,

    // Terrain state
    terrainData,
    setTerrainData,

    // Ruler state
    rulers,
    setRulers,
    gridUnitLength,
    setGridUnitLength,

    // Drawing state
    drawings,
    setDrawings,

    // Map marker state
    markers,
    setMarkers,

    // Anchor state
    anchorPosition,
    setAnchorPosition,

    // Map image state
    mapImage,
    setMapImage,
    mapImageLoaded,
    setMapImageLoaded,

    // Minimap state
    minimapCollapsed,
    setMinimapCollapsed,
  };
}
