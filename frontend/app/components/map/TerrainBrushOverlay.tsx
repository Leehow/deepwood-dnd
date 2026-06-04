/**
 * TerrainBrushOverlay - HTML Canvas overlay for terrain painting
 * Only active when selectedTool === "terrain"
 * Displays brush cursor preview; actual terrain rendering is in TerrainLayer (Konva)
 */

import { useRef, useEffect } from "react";
import { TerrainManager, TERRAIN_TYPE_MAP, type TerrainType, type TerrainData } from "./TerrainManager";
import { createLogger } from '~/utils/logger';
const logger = createLogger('TerrainBrushOverlay');

interface TerrainBrushOverlayProps {
  canvasWidth: number;
  canvasHeight: number;
  gridSize: number;
  isEditable: boolean;
  terrainType: TerrainType;
  mode: "brush" | "eraser";
  brushSize: number;
  stageScale: number;
  stagePos: { x: number; y: number };
  terrainManager: TerrainManager;
  onTerrainUpdate?: (data: TerrainData) => void;
  onWheel?: (e: WheelEvent) => void;
}

export const TerrainBrushOverlay = ({
  canvasWidth,
  canvasHeight,
  gridSize,
  isEditable,
  terrainType,
  mode,
  brushSize,
  stageScale,
  stagePos,
  terrainManager,
  onTerrainUpdate,
  onWheel: onWheelProp,
}: TerrainBrushOverlayProps) => {
  const cursorDivRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isEditable) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    let isDrawing = false;

    const getGridCoords = (clientX: number, clientY: number) => {
      const rect = overlay.getBoundingClientRect();
      const canvasX = clientX - rect.left;
      const canvasY = clientY - rect.top;
      const stageX = canvasX / stageScale;
      const stageY = canvasY / stageScale;
      return {
        gridX: Math.floor(stageX / gridSize),
        gridY: Math.floor(stageY / gridSize),
      };
    };

    const applyTerrain = (clientX: number, clientY: number) => {
      const { gridX, gridY } = getGridCoords(clientX, clientY);
      if (mode === "brush") {
        terrainManager.paintTerrain(gridX, gridY, terrainType, brushSize);
      } else {
        terrainManager.eraseTerrain(gridX, gridY, brushSize);
      }
      onTerrainUpdate?.(terrainManager.getData());
    };

    const handleMouseDown = (e: MouseEvent) => {
      isDrawing = true;
      applyTerrain(e.clientX, e.clientY);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const div = cursorDivRef.current;
      if (div) {
        const diameter = brushSize * gridSize * stageScale;
        const half = diameter / 2;
        div.style.left = `${e.clientX - half}px`;
        div.style.top = `${e.clientY - half}px`;
        div.style.width = `${diameter}px`;
        div.style.height = `${diameter}px`;
        div.style.display = "block";
      }
      if (!isDrawing) return;
      applyTerrain(e.clientX, e.clientY);
    };

    const handleMouseUp = () => { isDrawing = false; };
    const handleMouseLeave = () => {
      const div = cursorDivRef.current;
      if (div) div.style.display = "none";
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        isDrawing = true;
        applyTerrain(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDrawing || e.touches.length !== 1) return;
      e.preventDefault();
      applyTerrain(e.touches[0].clientX, e.touches[0].clientY);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) isDrawing = false;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      onWheelProp?.(e);
    };

    overlay.addEventListener("mousedown", handleMouseDown);
    overlay.addEventListener("mousemove", handleMouseMove);
    overlay.addEventListener("mouseleave", handleMouseLeave);
    overlay.addEventListener("wheel", handleWheel, { passive: false });
    document.addEventListener("mouseup", handleMouseUp);
    overlay.addEventListener("touchstart", handleTouchStart, { passive: false });
    overlay.addEventListener("touchmove", handleTouchMove, { passive: false });
    overlay.addEventListener("touchend", handleTouchEnd, { passive: false });

    // Expose clearAll for toolbar button
    (window as any).__clearAllTerrain = () => {
      terrainManager.clearAll();
      onTerrainUpdate?.(terrainManager.getData());
      logger.debug("[TerrainBrush] Cleared all terrain");
    };

    return () => {
      overlay.removeEventListener("mousedown", handleMouseDown);
      overlay.removeEventListener("mousemove", handleMouseMove);
      overlay.removeEventListener("mouseleave", handleMouseLeave);
      overlay.removeEventListener("wheel", handleWheel);
      document.removeEventListener("mouseup", handleMouseUp);
      overlay.removeEventListener("touchstart", handleTouchStart);
      overlay.removeEventListener("touchmove", handleTouchMove);
      overlay.removeEventListener("touchend", handleTouchEnd);
      delete (window as any).__clearAllTerrain;
      const div = cursorDivRef.current;
      if (div) div.style.display = "none";
    };
  }, [isEditable, mode, brushSize, terrainType, stageScale, gridSize]);

  // Cursor color based on mode and terrain type
  const cursorColor = mode === "eraser"
    ? "rgba(255,100,100,0.8)"
    : (TERRAIN_TYPE_MAP.get(terrainType)?.color || "#888") + "cc";

  return (
    <>
      {/* Invisible overlay div to capture pointer events */}
      <div
        ref={overlayRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: canvasWidth * stageScale,
          height: canvasHeight * stageScale,
          zIndex: 99,  // Below fog (100)
          cursor: "default",
          display: isEditable ? "block" : "none",
          pointerEvents: isEditable ? "auto" : "none",
          transform: `translate(${stagePos.x}px, ${stagePos.y}px)`,
          transformOrigin: "0 0",
        }}
      />
      {/* Brush cursor preview */}
      <div
        ref={cursorDivRef}
        style={{
          position: "fixed",
          display: "none",
          pointerEvents: "none",
          borderRadius: "50%",
          border: `2px dashed ${cursorColor}`,
          zIndex: 9999,
          boxSizing: "border-box",
        }}
      />
    </>
  );
};
