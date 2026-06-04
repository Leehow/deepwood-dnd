/**
 * Konva-based Drawings Layer
 * Renders circles, sketches, arrows on the tactical map using Konva shapes
 */
import { useRef, useState, useCallback, useEffect } from "react";
import { Layer, Circle, Line, Arrow, Group, Rect } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";

interface Point {
  x: number;
  y: number;
}

interface Drawing {
  id: number;
  type: "ruler" | "circle" | "sketch" | "arrow";
  created_by_user_id: string;
  start_x?: number;
  start_y?: number;
  end_x?: number;
  end_y?: number;
  distance?: number;
  center_x?: number;
  center_y?: number;
  radius?: number;
  points?: Array<{ x: number; y: number }>;
  color: string;
  stroke_color: string;
  fill_color?: string;
  stroke_width: number;
}

interface DrawingsLayerProps {
  canvasWidth: number;
  canvasHeight: number;
  gridSize: number;
  drawings: Drawing[];
  isEnabled: boolean;
  isDM: boolean;
  currentUserId: string;
  tool: "circle" | "sketch" | "arrow" | "eraser" | null;
  drawColor?: string;
  drawStrokeWidth?: number;
  onDrawingAdd?: (drawing: Omit<Drawing, "id" | "created_by_user_id">) => void;
  onDrawingRemove?: (drawingId: number) => void;
  onDrawStrokeWidthChange?: (width: number) => void;
}

// Eraser radius settings (grid units)
const ERASER_RADIUS_MIN = 0.3;
const ERASER_RADIUS_MAX = 3.0;
const ERASER_RADIUS_DEFAULT = 0.5;
const ERASER_RADIUS_STEP = 0.2;

// Stroke width settings (pixels)
const STROKE_WIDTH_MIN = 1;
const STROKE_WIDTH_MAX = 20;
const STROKE_WIDTH_STEP = 1;

export const DrawingsLayer = ({
  canvasWidth,
  canvasHeight,
  gridSize,
  drawings,
  isEnabled,
  isDM,
  currentUserId,
  tool,
  drawColor = "#ff0000",
  drawStrokeWidth = 2,
  onDrawingAdd,
  onDrawingRemove,
  onDrawStrokeWidthChange,
}: DrawingsLayerProps) => {
  const layerRef = useRef<Konva.Layer>(null);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null);
  const [sketchPoints, setSketchPoints] = useState<Point[]>([]);

  // Eraser state
  const [isErasing, setIsErasing] = useState(false);
  const [eraserPos, setEraserPos] = useState<Point | null>(null);
  const [eraserRadius, setEraserRadius] = useState(ERASER_RADIUS_DEFAULT);

  // Brush cursor position (for showing brush size indicator)
  const [brushPos, setBrushPos] = useState<Point | null>(null);

  // Refs for stable access in handlers
  const drawingsRef = useRef(drawings);
  const onDrawingRemoveRef = useRef(onDrawingRemove);

  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

  useEffect(() => {
    onDrawingRemoveRef.current = onDrawingRemove;
  }, [onDrawingRemove]);

  // Calculate distance between two points
  const calculateDistance = (x1: number, y1: number, x2: number, y2: number): number => {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  };

  // Point to line segment distance
  const pointToLineDistance = (
    px: number, py: number,
    x1: number, y1: number,
    x2: number, y2: number
  ): number => {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;
    if (param < 0) { xx = x1; yy = y1; }
    else if (param > 1) { xx = x2; yy = y2; }
    else { xx = x1 + param * C; yy = y1 + param * D; }

    return Math.sqrt((px - xx) ** 2 + (py - yy) ** 2);
  };

  // Get drawings within radius (for eraser)
  const getDrawingsInRadius = useCallback((gridX: number, gridY: number, radius: number): number[] => {
    const result: number[] = [];
    const currentDrawings = drawingsRef.current;

    for (let i = currentDrawings.length - 1; i >= 0; i--) {
      const drawing = currentDrawings[i];

      if (drawing.type === "circle" && drawing.center_x !== undefined && drawing.center_y !== undefined && drawing.radius !== undefined) {
        const distToCenter = calculateDistance(drawing.center_x, drawing.center_y, gridX, gridY);
        if (distToCenter <= drawing.radius + radius || Math.abs(distToCenter - drawing.radius) <= radius) {
          result.push(drawing.id);
        }
      } else if (drawing.type === "arrow" && drawing.points && drawing.points.length === 2) {
        const p = drawing.points;
        if (p[0]?.x !== undefined && p[0]?.y !== undefined && p[1]?.x !== undefined && p[1]?.y !== undefined) {
          const dist = pointToLineDistance(gridX, gridY, p[0].x, p[0].y, p[1].x, p[1].y);
          if (dist <= radius) result.push(drawing.id);
        }
      } else if (drawing.type === "sketch" && drawing.points && drawing.points.length > 1) {
        const points = drawing.points;
        let found = false;
        for (let j = 0; j < points.length - 1; j++) {
          const p1 = points[j];
          const p2 = points[j + 1];
          if (p1?.x !== undefined && p1?.y !== undefined && p2?.x !== undefined && p2?.y !== undefined) {
            const dist = pointToLineDistance(gridX, gridY, p1.x, p1.y, p2.x, p2.y);
            if (dist <= radius) {
              found = true;
              break;
            }
          }
        }
        if (found) result.push(drawing.id);
      } else if (drawing.type === "ruler" && drawing.start_x !== undefined && drawing.start_y !== undefined && drawing.end_x !== undefined && drawing.end_y !== undefined) {
        const dist = pointToLineDistance(gridX, gridY, drawing.start_x, drawing.start_y, drawing.end_x, drawing.end_y);
        if (dist <= radius) result.push(drawing.id);
      }
    }

    return result;
  }, []);

  // Track drawings being erased to prevent duplicate calls
  const erasingIdsRef = useRef<Set<number>>(new Set());

  // Erase drawings at position
  const eraseAtPosition = useCallback((gridX: number, gridY: number) => {
    const drawingIds = getDrawingsInRadius(gridX, gridY, eraserRadius);
    const currentDrawings = drawingsRef.current;

    drawingIds.forEach(drawingId => {
      // Skip if already being erased
      if (erasingIdsRef.current.has(drawingId)) return;

      const drawing = currentDrawings.find(d => d.id === drawingId);
      if (drawing && (isDM || drawing.created_by_user_id === currentUserId)) {
        erasingIdsRef.current.add(drawingId);
        onDrawingRemoveRef.current?.(drawingId);
      }
    });
  }, [eraserRadius, isDM, currentUserId, getDrawingsInRadius]);

  // Clear erasing IDs when drawings change
  useEffect(() => {
    erasingIdsRef.current.clear();
  }, [drawings]);

  // Get grid coordinates from Konva event
  const getGridCoords = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>): Point => {
    const stage = e.target.getStage();
    if (!stage) return { x: 0, y: 0 };

    const pos = stage.getPointerPosition();
    if (!pos) return { x: 0, y: 0 };

    // Convert screen position to stage coordinates (account for pan and zoom)
    const stageX = (pos.x - stage.x()) / stage.scaleX();
    const stageY = (pos.y - stage.y()) / stage.scaleY();

    // Convert pixel position to grid coordinates
    return {
      x: stageX / gridSize,
      y: stageY / gridSize,
    };
  }, [gridSize]);

  // Unified start/move/end handlers for both mouse and touch
  const handleStart = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!isEnabled) return;

    const { x: gridX, y: gridY } = getGridCoords(e);

    if (tool === "eraser") {
      setIsErasing(true);
      setEraserPos({ x: gridX, y: gridY });
      eraseAtPosition(gridX, gridY);
    } else if (tool === "circle" || tool === "arrow") {
      setIsDrawing(true);
      setStartPoint({ x: gridX, y: gridY });
      setCurrentPoint({ x: gridX, y: gridY });
    } else if (tool === "sketch") {
      setIsDrawing(true);
      setSketchPoints([{ x: gridX, y: gridY }]);
    }
  }, [isEnabled, tool, getGridCoords, eraseAtPosition]);

  const handleMove = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!isEnabled) return;

    const { x: gridX, y: gridY } = getGridCoords(e);

    if (tool === "eraser") {
      setEraserPos({ x: gridX, y: gridY });
      if (isErasing) {
        eraseAtPosition(gridX, gridY);
      }
      return;
    }

    // Track brush position for sketch tool cursor
    if (tool === "sketch") {
      setBrushPos({ x: gridX, y: gridY });
    }

    if (!isDrawing) return;

    if (tool === "circle" || tool === "arrow") {
      setCurrentPoint({ x: gridX, y: gridY });
    } else if (tool === "sketch") {
      setSketchPoints(prev => [...prev, { x: gridX, y: gridY }]);
    }
  }, [isEnabled, tool, isDrawing, isErasing, getGridCoords, eraseAtPosition]);

  const handleEnd = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (isErasing && tool === "eraser") {
      setIsErasing(false);
      return;
    }

    if (!isDrawing) return;

    const { x: gridX, y: gridY } = getGridCoords(e);

    if (tool === "circle" && startPoint) {
      const radius = calculateDistance(startPoint.x, startPoint.y, gridX, gridY);
      if (radius > 0.1) {
        onDrawingAdd?.({
          type: "circle",
          center_x: startPoint.x,
          center_y: startPoint.y,
          radius,
          color: drawColor,
          stroke_color: drawColor,
          stroke_width: drawStrokeWidth,
        });
      }
    } else if (tool === "arrow" && startPoint) {
      const distance = calculateDistance(startPoint.x, startPoint.y, gridX, gridY);
      if (distance > 0.1) {
        onDrawingAdd?.({
          type: "arrow",
          points: [{ x: startPoint.x, y: startPoint.y }, { x: gridX, y: gridY }],
          color: drawColor,
          stroke_color: drawColor,
          stroke_width: drawStrokeWidth,
        });
      }
    } else if (tool === "sketch" && sketchPoints.length > 1) {
      onDrawingAdd?.({
        type: "sketch",
        points: sketchPoints,
        color: drawColor,
        stroke_color: drawColor,
        stroke_width: drawStrokeWidth,
      });
    }

    setIsDrawing(false);
    setStartPoint(null);
    setCurrentPoint(null);
    setSketchPoints([]);
  }, [isDrawing, isErasing, tool, startPoint, sketchPoints, drawColor, drawStrokeWidth, getGridCoords, onDrawingAdd]);

  // Mouse event handlers
  const handleMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => handleStart(e), [handleStart]);
  const handleMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => handleMove(e), [handleMove]);
  const handleMouseUp = useCallback((e: KonvaEventObject<MouseEvent>) => handleEnd(e), [handleEnd]);

  // Touch event handlers
  const handleTouchStart = useCallback((e: KonvaEventObject<TouchEvent>) => handleStart(e), [handleStart]);
  const handleTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => handleMove(e), [handleMove]);
  const handleTouchEnd = useCallback((e: KonvaEventObject<TouchEvent>) => handleEnd(e), [handleEnd]);

  const handleMouseLeave = useCallback(() => {
    if (tool === "eraser") {
      setEraserPos(null);
    }
    if (tool === "sketch") {
      setBrushPos(null);
    }
  }, [tool]);

  // Wheel handler for eraser size and brush width (Ctrl+wheel)
  const handleWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    if (!isEnabled) return;
    if (!e.evt.ctrlKey) return; // Only handle Ctrl+wheel

    if (tool === "eraser") {
      e.evt.preventDefault();
      const delta = e.evt.deltaY < 0 ? ERASER_RADIUS_STEP : -ERASER_RADIUS_STEP;
      setEraserRadius(prev => Math.max(ERASER_RADIUS_MIN, Math.min(ERASER_RADIUS_MAX, prev + delta)));
    } else if (tool === "sketch" || tool === "arrow") {
      e.evt.preventDefault();
      const delta = e.evt.deltaY < 0 ? STROKE_WIDTH_STEP : -STROKE_WIDTH_STEP;
      const newWidth = Math.max(STROKE_WIDTH_MIN, Math.min(STROKE_WIDTH_MAX, drawStrokeWidth + delta));
      onDrawStrokeWidthChange?.(newWidth);
    }
  }, [isEnabled, tool, drawStrokeWidth, onDrawStrokeWidthChange]);

  // Clear cursor position when tool changes
  useEffect(() => {
    if (tool !== "eraser") {
      setEraserPos(null);
      setIsErasing(false);
    }
    if (tool !== "sketch") {
      setBrushPos(null);
    }
  }, [tool]);

  // Convert grid coordinates to pixels for Konva
  const toPixels = (val: number) => val * gridSize;

  // Flatten points array for Konva Line
  const flattenPoints = (points: Point[]): number[] => {
    return points.flatMap(p => [toPixels(p.x), toPixels(p.y)]);
  };

  // Deduplicate drawings by ID to prevent key conflicts
  const uniqueDrawings = drawings.filter((drawing, index, self) =>
    index === self.findIndex(d => d.id === drawing.id)
  );

  return (
    <Layer
      ref={layerRef}
      listening={isEnabled}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
    >
      {/* Hit region to capture touch/mouse events - needs minimal opacity to be interactive */}
      <Rect
        x={0}
        y={0}
        width={canvasWidth}
        height={canvasHeight}
        fill="rgba(0,0,0,0.001)"
        listening={true}
      />

      {/* Render saved drawings */}
      {uniqueDrawings.map(drawing => {
        if (drawing.type === "circle" && drawing.center_x !== undefined && drawing.center_y !== undefined && drawing.radius !== undefined) {
          return (
            <Group key={drawing.id}>
              {/* Circle fill */}
              {drawing.fill_color && drawing.fill_color !== "#ffffff00" && (
                <Circle
                  x={toPixels(drawing.center_x)}
                  y={toPixels(drawing.center_y)}
                  radius={toPixels(drawing.radius)}
                  fill={drawing.fill_color}
                />
              )}
              {/* Circle stroke */}
              <Circle
                x={toPixels(drawing.center_x)}
                y={toPixels(drawing.center_y)}
                radius={toPixels(drawing.radius)}
                stroke={drawing.stroke_color}
                strokeWidth={drawing.stroke_width}
              />
              {/* Center point */}
              <Circle
                x={toPixels(drawing.center_x)}
                y={toPixels(drawing.center_y)}
                radius={4}
                fill={drawing.stroke_color}
              />
            </Group>
          );
        }

        if (drawing.type === "arrow" && drawing.points && drawing.points.length === 2) {
          const p = drawing.points;
          return (
            <Group key={drawing.id}>
              <Arrow
                points={[toPixels(p[0].x), toPixels(p[0].y), toPixels(p[1].x), toPixels(p[1].y)]}
                stroke={drawing.stroke_color}
                strokeWidth={drawing.stroke_width}
                fill={drawing.stroke_color}
                pointerLength={15}
                pointerWidth={12}
              />
              {/* Start point */}
              <Circle
                x={toPixels(p[0].x)}
                y={toPixels(p[0].y)}
                radius={4}
                fill={drawing.stroke_color}
              />
            </Group>
          );
        }

        if (drawing.type === "sketch" && drawing.points && drawing.points.length > 1) {
          return (
            <Line
              key={drawing.id}
              points={flattenPoints(drawing.points)}
              stroke={drawing.stroke_color}
              strokeWidth={drawing.stroke_width}
              lineCap="round"
              lineJoin="round"
              tension={0}
            />
          );
        }

        if (drawing.type === "ruler" && drawing.start_x !== undefined && drawing.start_y !== undefined && drawing.end_x !== undefined && drawing.end_y !== undefined) {
          return (
            <Group key={drawing.id}>
              <Line
                points={[toPixels(drawing.start_x), toPixels(drawing.start_y), toPixels(drawing.end_x), toPixels(drawing.end_y)]}
                stroke={drawing.color}
                strokeWidth={drawing.stroke_width}
              />
              {/* Endpoints */}
              <Circle x={toPixels(drawing.start_x)} y={toPixels(drawing.start_y)} radius={6} fill={drawing.color} />
              <Circle x={toPixels(drawing.end_x)} y={toPixels(drawing.end_y)} radius={6} fill={drawing.color} />
            </Group>
          );
        }

        return null;
      })}

      {/* In-progress drawing preview */}
      {isDrawing && startPoint && tool === "circle" && currentPoint && (
        <Group>
          <Circle
            x={toPixels(startPoint.x)}
            y={toPixels(startPoint.y)}
            radius={toPixels(calculateDistance(startPoint.x, startPoint.y, currentPoint.x, currentPoint.y))}
            stroke={drawColor}
            strokeWidth={drawStrokeWidth}
          />
          <Circle x={toPixels(startPoint.x)} y={toPixels(startPoint.y)} radius={4} fill={drawColor} />
        </Group>
      )}

      {isDrawing && startPoint && tool === "arrow" && currentPoint && (
        <Group>
          <Arrow
            points={[toPixels(startPoint.x), toPixels(startPoint.y), toPixels(currentPoint.x), toPixels(currentPoint.y)]}
            stroke={drawColor}
            strokeWidth={drawStrokeWidth}
            fill={drawColor}
            pointerLength={15}
            pointerWidth={12}
          />
          <Circle x={toPixels(startPoint.x)} y={toPixels(startPoint.y)} radius={4} fill={drawColor} />
        </Group>
      )}

      {isDrawing && tool === "sketch" && sketchPoints.length > 1 && (
        <Line
          points={flattenPoints(sketchPoints)}
          stroke={drawColor}
          strokeWidth={drawStrokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={0}
        />
      )}

      {/* Eraser cursor */}
      {tool === "eraser" && eraserPos && (
        <Group>
          <Circle
            x={toPixels(eraserPos.x)}
            y={toPixels(eraserPos.y)}
            radius={toPixels(eraserRadius)}
            fill="rgba(255, 0, 0, 0.15)"
            stroke="rgba(255, 0, 0, 0.6)"
            strokeWidth={2}
            dash={[8, 4]}
          />
        </Group>
      )}

      {/* Brush cursor for sketch tool */}
      {tool === "sketch" && brushPos && !isDrawing && (
        <Group>
          <Circle
            x={toPixels(brushPos.x)}
            y={toPixels(brushPos.y)}
            radius={drawStrokeWidth / 2}
            fill={drawColor}
            opacity={0.5}
          />
          <Circle
            x={toPixels(brushPos.x)}
            y={toPixels(brushPos.y)}
            radius={drawStrokeWidth / 2}
            stroke={drawColor}
            strokeWidth={1}
          />
        </Group>
      )}
    </Layer>
  );
};
