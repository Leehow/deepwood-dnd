/**
 * Minimap Component
 * Displays a thumbnail overview of the full map with viewport rectangle,
 * token dots, and fog overlay. Supports click-to-navigate and drag viewport.
 */

import React, { useEffect, useRef, useCallback, useMemo } from "react";
import { Stage, Layer, Rect, Image as KonvaImage, Circle } from "react-konva";
import type Konva from "konva";
import type { MapTransform, Token, FogData } from "./types/TacticalMapTypes";

const MINIMAP_MAX_W = 200;
const MINIMAP_MAX_H = 150;
const THUMB_MAX_W = 64;
const THUMB_MAX_H = 48;

interface MinimapProps {
  mapImage: HTMLImageElement | null;
  mapImageScale: number;
  mapTransform: MapTransform;
  stagePos: { x: number; y: number };
  stageScale: number;
  stageSize: { width: number; height: number };
  tokens: Token[];
  fogData: FogData | null;
  isDM: boolean;
  showFogOfWar: boolean;
  onNavigate: (canvasX: number, canvasY: number) => void;
  rightOffset: number;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  timeOfDay?: { cycle: string; hour: number; environment?: string };
}

/** Get token dot color based on type */
function getTokenColor(token: Token): string {
  if (token.character_id) return "#22c55e";
  if (token.monster_instance_id) {
    if (token.entity_type === 'npc') return "#06b6d4";  // cyan for NPC
    return "#ef4444";  // red for monster
  }
  if (token.shop_id) return "#f59e0b";
  return "#3b82f6";
}

/**
 * Build fog overlay as offscreen canvas with warm parchment-style fog.
 * fogData.cells = fogged (dark) cells. Renders a warm hatched overlay
 * instead of solid black to keep the minimap visually appealing.
 */
function buildFogCanvas(
  fogData: FogData,
  minimapW: number,
  minimapH: number,
  minimapScale: number,
  gridSize: number,
  isDM: boolean
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = minimapW;
  canvas.height = minimapH;
  const ctx = canvas.getContext("2d")!;

  const cellSize = gridSize * minimapScale;

  // 1) Base fog layer: warm dark brown instead of black
  ctx.fillStyle = isDM ? "rgba(20, 14, 8, 0.35)" : "rgba(20, 14, 8, 0.65)";
  for (const [cx, cy] of fogData.cells) {
    ctx.fillRect(cx * cellSize, cy * cellSize, cellSize + 0.5, cellSize + 0.5);
  }

  // 2) Crosshatch pattern over fog cells for "unexplored" map feel
  ctx.strokeStyle = isDM ? "rgba(139, 115, 85, 0.15)" : "rgba(139, 115, 85, 0.2)";
  ctx.lineWidth = 0.5;

  // Build a set for O(1) lookup
  const fogSet = new Set<string>();
  for (const [cx, cy] of fogData.cells) {
    fogSet.add(`${cx},${cy}`);
  }

  // Draw diagonal lines across fog cells
  const step = Math.max(2, Math.round(cellSize * 0.6));
  for (const [cx, cy] of fogData.cells) {
    const px = cx * cellSize;
    const py = cy * cellSize;

    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, cellSize, cellSize);
    ctx.clip();

    // Diagonal lines (top-left to bottom-right)
    for (let d = -cellSize; d < cellSize * 2; d += step) {
      ctx.moveTo(px + d, py);
      ctx.lineTo(px + d + cellSize, py + cellSize);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 3) Subtle border glow between fog and revealed areas
  ctx.strokeStyle = isDM ? "rgba(180, 140, 80, 0.2)" : "rgba(180, 140, 80, 0.35)";
  ctx.lineWidth = 1;
  for (const [cx, cy] of fogData.cells) {
    const px = cx * cellSize;
    const py = cy * cellSize;
    // Only draw border edges adjacent to revealed cells
    if (!fogSet.has(`${cx},${cy - 1}`)) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + cellSize, py); ctx.stroke(); }
    if (!fogSet.has(`${cx},${cy + 1}`)) { ctx.beginPath(); ctx.moveTo(px, py + cellSize); ctx.lineTo(px + cellSize, py + cellSize); ctx.stroke(); }
    if (!fogSet.has(`${cx - 1},${cy}`)) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + cellSize); ctx.stroke(); }
    if (!fogSet.has(`${cx + 1},${cy}`)) { ctx.beginPath(); ctx.moveTo(px + cellSize, py); ctx.lineTo(px + cellSize, py + cellSize); ctx.stroke(); }
  }

  return canvas;
}

export function Minimap({
  mapImage,
  mapImageScale,
  mapTransform,
  stagePos,
  stageScale,
  stageSize,
  tokens,
  fogData,
  isDM,
  showFogOfWar,
  onNavigate,
  rightOffset,
  collapsed,
  onCollapsedChange,
  timeOfDay,
}: MinimapProps) {
  const viewportRef = useRef<Konva.Rect>(null);
  const fogImageRef = useRef<Konva.Image>(null);
  const miniStageRef = useRef<Konva.Stage>(null);

  const mapPixelW = mapImage ? mapImage.width * mapImageScale : 0;
  const mapPixelH = mapImage ? mapImage.height * mapImageScale : 0;

  const isRotated90or270 = mapTransform.rotation === 90 || mapTransform.rotation === 270;
  const effectiveW = isRotated90or270 ? mapPixelH : mapPixelW;
  const effectiveH = isRotated90or270 ? mapPixelW : mapPixelH;

  const minimapScale = effectiveW > 0 && effectiveH > 0
    ? Math.min(MINIMAP_MAX_W / effectiveW, MINIMAP_MAX_H / effectiveH)
    : 0;
  const minimapW = Math.ceil(effectiveW * minimapScale);
  const minimapH = Math.ceil(effectiveH * minimapScale);

  const thumbScale = effectiveW > 0 && effectiveH > 0
    ? Math.min(THUMB_MAX_W / effectiveW, THUMB_MAX_H / effectiveH)
    : 0;
  const thumbW = Math.ceil(effectiveW * thumbScale);
  const thumbH = Math.ceil(effectiveH * thumbScale);

  // Debounced fog canvas — avoid rebuilding on every brush stroke
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fogTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!fogData || !showFogOfWar || fogData.cells.length === 0 || minimapW <= 0) {
      fogCanvasRef.current = null;
      if (fogImageRef.current) {
        fogImageRef.current.image(undefined as any);
        fogImageRef.current.getLayer()?.batchDraw();
      }
      return;
    }

    clearTimeout(fogTimerRef.current);
    fogTimerRef.current = setTimeout(() => {
      fogCanvasRef.current = buildFogCanvas(fogData, minimapW, minimapH, minimapScale, 40, isDM);
      if (fogImageRef.current) {
        fogImageRef.current.image(fogCanvasRef.current);
        fogImageRef.current.getLayer()?.batchDraw();
      }
    }, 300);

    return () => clearTimeout(fogTimerRef.current);
  }, [fogData, showFogOfWar, isDM, minimapW, minimapH, minimapScale]);

  // Viewport rectangle — direct Konva ref update
  useEffect(() => {
    const rect = viewportRef.current;
    if (!rect || minimapScale <= 0 || stageScale <= 0) return;

    rect.x((-stagePos.x / stageScale) * minimapScale);
    rect.y((-stagePos.y / stageScale) * minimapScale);
    rect.width(Math.max(1, (stageSize.width / stageScale) * minimapScale));
    rect.height(Math.max(1, (stageSize.height / stageScale) * minimapScale));
    rect.getLayer()?.batchDraw();
  }, [stagePos, stageScale, stageSize, minimapScale]);

  const minimapToCanvas = useCallback(
    (mx: number, my: number) => {
      if (minimapScale <= 0) return;
      onNavigate(mx / minimapScale, my / minimapScale);
    },
    [minimapScale, onNavigate]
  );

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (e.target === viewportRef.current) return;
      const pos = miniStageRef.current?.getPointerPosition();
      if (!pos) return;
      minimapToCanvas(pos.x, pos.y);
    },
    [minimapToCanvas]
  );

  const handleViewportDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      minimapToCanvas(node.x() + node.width() / 2, node.y() + node.height() / 2);
    },
    [minimapToCanvas]
  );

  const tokenDots = useMemo(() => {
    if (minimapScale <= 0) return [];
    const half = 40 * minimapScale / 2;

    // For players, build a fog cell set to hide tokens inside fog
    let fogSet: Set<string> | null = null;
    if (!isDM && showFogOfWar && fogData && fogData.cells.length > 0) {
      fogSet = new Set<string>();
      for (const [cx, cy] of fogData.cells) {
        fogSet.add(`${cx},${cy}`);
      }
    }

    return tokens
      .filter(t => {
        if (t.loot_bag_data) return false;
        // Players can't see tokens hidden in fog
        if (fogSet && fogSet.has(`${t.position_x},${t.position_y}`)) return false;
        return true;
      })
      .map(t => ({
        key: t.id,
        x: t.position_x * 40 * minimapScale + half,
        y: t.position_y * 40 * minimapScale + half,
        color: getTokenColor(t),
      }));
  }, [tokens, minimapScale, isDM, showFogOfWar, fogData]);

  if (!mapImage || minimapW <= 0 || minimapH <= 0) return null;

  const TIME_ICONS: Record<string, string> = { dawn: "🌅", day: "☀️", dusk: "🌇", night: "🌙" };
  const ENV_ICONS: Record<string, string> = { bright: "💡", dark: "🕳️", warp: "🌀" };
  const timeIcon = timeOfDay ? (TIME_ICONS[timeOfDay.cycle] || "☀️") : null;
  const envIcon = timeOfDay?.environment && timeOfDay.environment !== "normal" ? (ENV_ICONS[timeOfDay.environment] || "") : null;
  const timeLabel = timeOfDay ? `${String(timeOfDay.hour).padStart(2, "0")}:${String((timeOfDay as any).minute ?? 0).padStart(2, "0")}:${String((timeOfDay as any).second ?? 0).padStart(2, "0")}` : null;

  return (
    <div
      className="absolute top-4 z-[150]"
      style={{ right: rightOffset + "px" }}
    >
      {/* Collapsed: small map thumbnail */}
      {collapsed && (
        <div
          className="group relative cursor-pointer rounded overflow-hidden shadow-md border border-gray-600/40 hover:border-amber-500/50 transition-all"
          style={{ width: thumbW, height: thumbH }}
          onClick={() => onCollapsedChange(false)}
          title="展开小地图"
        >
          <img
            src={mapImage.src}
            alt="minimap"
            className="w-full h-full object-cover"
            draggable={false}
          />
          <div className="absolute inset-0 bg-black/25 group-hover:bg-black/5 transition-colors flex items-center justify-center">
            <svg className="w-4 h-4 text-white/70 group-hover:text-white drop-shadow" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3 3h4v2H5v2H3V3zm10 0h4v4h-2V5h-2V3zM3 13h2v2h2v2H3v-4zm12 2v2h-4v-2h2v-2h2v2z" />
            </svg>
          </div>
          {/* Time badge on collapsed thumbnail */}
          {(timeIcon || envIcon) && (
            <div className="absolute bottom-0 right-0 px-1 text-[9px] leading-tight bg-black/60 text-white/90 rounded-tl" style={{ fontSize: 9 }}>
              {timeIcon}{envIcon}
            </div>
          )}
        </div>
      )}

      {/* Expanded: full minimap */}
      {!collapsed && (
        <div className="relative">
          <button
            onClick={() => onCollapsedChange(true)}
            className="absolute -top-1.5 -left-1.5 z-20 w-5 h-5 rounded-full bg-gray-800/90 hover:bg-gray-600 border border-gray-500/50 flex items-center justify-center text-gray-300 hover:text-white transition-colors shadow"
            title="折叠小地图"
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </button>

          <div
            className="rounded-lg overflow-hidden border border-amber-900/40 shadow-lg"
            style={{
              width: minimapW,
              height: minimapH,
              background: "linear-gradient(135deg, #1a1510 0%, #0f0d0a 100%)",
            }}
          >
            <Stage
              ref={miniStageRef}
              width={minimapW}
              height={minimapH}
              onClick={handleStageClick}
              onTap={handleStageClick}
              style={{ cursor: "pointer" }}
            >
              {/* Layer 1: Background + map image */}
              <Layer listening={false}>
                <KonvaImage
                  image={mapImage}
                  x={0}
                  y={0}
                  width={minimapW}
                  height={minimapH}
                  scaleX={mapTransform.flipH ? -1 : 1}
                  scaleY={mapTransform.flipV ? -1 : 1}
                  offsetX={mapTransform.flipH ? minimapW : 0}
                  offsetY={mapTransform.flipV ? minimapH : 0}
                />
              </Layer>

              {/* Layer 2: Fog overlay (updated via ref with debounce) */}
              <Layer listening={false}>
                <KonvaImage
                  ref={fogImageRef}
                  image={fogCanvasRef.current ?? undefined}
                  x={0}
                  y={0}
                  width={minimapW}
                  height={minimapH}
                />
              </Layer>

              {/* Layer 3: Token dots */}
              <Layer listening={false}>
                {tokenDots.map(dot => (
                  <Circle
                    key={dot.key}
                    x={dot.x}
                    y={dot.y}
                    radius={3}
                    fill={dot.color}
                  />
                ))}
              </Layer>

              {/* Layer 4: Viewport rectangle (draggable) */}
              <Layer>
                <Rect
                  ref={viewportRef}
                  x={0}
                  y={0}
                  width={50}
                  height={30}
                  stroke="rgba(255, 255, 255, 0.8)"
                  strokeWidth={1.5}
                  fill="rgba(255, 255, 255, 0.1)"
                  draggable
                  onDragMove={handleViewportDragMove}
                />
              </Layer>
            </Stage>
          </div>

          {/* Time of day badge */}
          {(timeIcon || envIcon) && (
            <div
              className="absolute bottom-1 right-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-black/70 text-white/90 backdrop-blur-sm border border-white/10"
              style={{ fontSize: 10, lineHeight: 1.2 }}
            >
              <span>{timeIcon}{envIcon}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{timeLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
