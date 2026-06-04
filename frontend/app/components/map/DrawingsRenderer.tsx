import { useRef, useEffect, useState, useCallback } from "react";
import { createLogger } from '~/utils/logger';
const logger = createLogger('DrawingsRenderer');


// Drawing color palette (cycles)
const DRAWING_COLORS = [
  "#ff0000", // Red
  "#00ff00", // Green
  "#0000ff", // Blue
  "#ffff00", // Yellow
  "#ff00ff", // Magenta
  "#00ffff", // Cyan
  "#ff8800", // Orange
  "#8800ff", // Purple
];

interface Point {
  x: number;
  y: number;
}

interface Drawing {
  id: number;
  type: "ruler" | "circle" | "sketch" | "arrow";
  created_by_user_id: string;

  // Ruler fields
  start_x?: number;
  start_y?: number;
  end_x?: number;
  end_y?: number;
  distance?: number;

  // Circle fields
  center_x?: number;
  center_y?: number;
  radius?: number;

  // Sketch/Arrow fields
  points?: Array<{ x: number; y: number }>;

  // Common fields
  color: string;
  stroke_color: string;
  fill_color?: string;
  stroke_width: number;
}

interface DrawingsRendererProps {
  canvasWidth: number;
  canvasHeight: number;
  gridSize: number;
  gridUnitLength: number;
  drawings: Drawing[];
  isEnabled: boolean;
  isDM: boolean;
  currentUserId: string;
  tool: "circle" | "sketch" | "arrow" | "eraser" | null;
  stageScale: number;
  stagePos: { x: number; y: number };
  drawColor?: string; // 绘图颜色
  drawStrokeWidth?: number; // 绘图笔宽
  onDrawingAdd?: (drawing: Omit<Drawing, "id" | "created_by_user_id">) => void;
  onDrawingUpdate?: (drawingId: number, updates: Partial<Drawing>) => void;
  onDrawingRemove?: (drawingId: number) => void;
}

// 橡皮擦半径范围（网格单位）
const ERASER_RADIUS_MIN = 0.3;
const ERASER_RADIUS_MAX = 3.0;
const ERASER_RADIUS_DEFAULT = 0.5;
const ERASER_RADIUS_STEP = 0.2;

export const DrawingsRenderer = ({
  canvasWidth,
  canvasHeight,
  gridSize,
  gridUnitLength,
  drawings,
  isEnabled,
  isDM,
  currentUserId,
  tool,
  stageScale,
  stagePos,
  drawColor = "#ff0000",
  drawStrokeWidth = 2,
  onDrawingAdd,
  onDrawingUpdate,
  onDrawingRemove,
}: DrawingsRendererProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null);
  const [sketchPoints, setSketchPoints] = useState<Point[]>([]);
  const [eraserPos, setEraserPos] = useState<Point | null>(null); // 橡皮擦位置
  const [eraserRadius, setEraserRadius] = useState(ERASER_RADIUS_DEFAULT); // 橡皮擦半径

  // Use refs to ensure event handlers always have access to latest values
  const drawingsRef = useRef(drawings);
  const onDrawingRemoveRef = useRef(onDrawingRemove);

  // Keep refs in sync with props
  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

  useEffect(() => {
    onDrawingRemoveRef.current = onDrawingRemove;
  }, [onDrawingRemove]);

  // Get next drawing color
  const getNextColor = () => {
    return DRAWING_COLORS[drawings.length % DRAWING_COLORS.length];
  };

  // Calculate distance between two points
  const calculateDistance = (x1: number, y1: number, x2: number, y2: number): number => {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  };

  // Draw sketch (freehand)
  const drawSketch = useCallback((ctx: CanvasRenderingContext2D, points: Point[], color: string, strokeWidth: number) => {
    if (points.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();

    const pixelPoint0 = { x: points[0].x * gridSize, y: points[0].y * gridSize };
    ctx.moveTo(pixelPoint0.x, pixelPoint0.y);

    for (let i = 1; i < points.length; i++) {
      const pixelPoint = { x: points[i].x * gridSize, y: points[i].y * gridSize };
      ctx.lineTo(pixelPoint.x, pixelPoint.y);
    }

    ctx.stroke();
  }, [gridSize]);

  // Draw circle
  const drawCircle = useCallback((
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    radius: number,
    strokeColor: string,
    fillColor: string,
    strokeWidth: number
  ) => {
    const pixelCenterX = centerX * gridSize;
    const pixelCenterY = centerY * gridSize;
    const pixelRadius = radius * gridSize;

    // Draw fill
    if (fillColor && fillColor !== "#ffffff00") {
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.arc(pixelCenterX, pixelCenterY, pixelRadius, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Draw stroke
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    ctx.arc(pixelCenterX, pixelCenterY, pixelRadius, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw center point
    ctx.fillStyle = strokeColor;
    ctx.beginPath();
    ctx.arc(pixelCenterX, pixelCenterY, 4, 0, 2 * Math.PI);
    ctx.fill();
  }, [gridSize]);

  // Draw arrow
  const drawArrow = useCallback((
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    strokeWidth: number
  ) => {
    const pixelX1 = x1 * gridSize;
    const pixelY1 = y1 * gridSize;
    const pixelX2 = x2 * gridSize;
    const pixelY2 = y2 * gridSize;

    const headlen = 15;
    const angle = Math.atan2(pixelY2 - pixelY1, pixelX2 - pixelX1);

    // Draw line
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    ctx.moveTo(pixelX1, pixelY1);
    ctx.lineTo(pixelX2, pixelY2);
    ctx.stroke();

    // Draw arrowhead
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(pixelX2, pixelY2);
    ctx.lineTo(pixelX2 - headlen * Math.cos(angle - Math.PI / 6), pixelY2 - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(pixelX2 - headlen * Math.cos(angle + Math.PI / 6), pixelY2 - headlen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();

    // Draw start point
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pixelX1, pixelY1, 4, 0, 2 * Math.PI);
    ctx.fill();
  }, [gridSize]);

  // Draw ruler line helper
  const drawRulerLine = (
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    distance: number,
    color: string,
    strokeWidth: number
  ) => {
    const pixelX1 = x1 * gridSize;
    const pixelY1 = y1 * gridSize;
    const pixelX2 = x2 * gridSize;
    const pixelY2 = y2 * gridSize;

    // Draw line
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    ctx.moveTo(pixelX1, pixelY1);
    ctx.lineTo(pixelX2, pixelY2);
    ctx.stroke();

    // Draw endpoints
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pixelX1, pixelY1, 6, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pixelX2, pixelY2, 6, 0, 2 * Math.PI);
    ctx.fill();

    // Draw distance label
    const midX = (pixelX1 + pixelX2) / 2;
    const midY = (pixelY1 + pixelY2) / 2;
    const realDistance = distance * gridUnitLength;
    const text = `${realDistance.toFixed(1)} ft`;

    ctx.fillStyle = "#000000";
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const metrics = ctx.measureText(text);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillRect(midX - metrics.width / 2 - 4, midY - 10, metrics.width + 8, 20);
    ctx.fillStyle = "#000000";
    ctx.fillText(text, midX, midY);
  };

  // Draw all drawings
  const drawDrawings = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw saved drawings
    drawings.forEach((drawing) => {
      switch (drawing.type) {
        case "ruler":
          if (drawing.start_x !== undefined && drawing.start_y !== undefined &&
              drawing.end_x !== undefined && drawing.end_y !== undefined) {
            drawRulerLine(ctx, drawing.start_x, drawing.start_y, drawing.end_x, drawing.end_y,
                         drawing.distance || 0, drawing.color, drawing.stroke_width);
          }
          break;
        case "circle":
          if (drawing.center_x !== undefined && drawing.center_y !== undefined &&
              drawing.radius !== undefined) {
            drawCircle(ctx, drawing.center_x, drawing.center_y, drawing.radius,
                      drawing.stroke_color, drawing.fill_color || "#ffffff00", drawing.stroke_width);
          }
          break;
        case "sketch":
          if (drawing.points && drawing.points.length > 0) {
            drawSketch(ctx, drawing.points, drawing.stroke_color, drawing.stroke_width);
          }
          break;
        case "arrow":
          if (drawing.points && drawing.points.length === 2) {
            drawArrow(ctx, drawing.points[0].x, drawing.points[0].y,
                     drawing.points[1].x, drawing.points[1].y,
                     drawing.stroke_color, drawing.stroke_width);
          }
          break;
      }
    });

    // Draw in-progress drawing
    if (isDrawing && startPoint && tool) {
      if (tool === "circle" && currentPoint) {
        const radius = calculateDistance(startPoint.x, startPoint.y, currentPoint.x, currentPoint.y);
        drawCircle(ctx, startPoint.x, startPoint.y, radius, drawColor, "#ffffff00", drawStrokeWidth);
      } else if (tool === "arrow" && currentPoint) {
        drawArrow(ctx, startPoint.x, startPoint.y, currentPoint.x, currentPoint.y, drawColor, drawStrokeWidth);
      } else if (tool === "sketch" && sketchPoints.length > 0) {
        drawSketch(ctx, sketchPoints, drawColor, drawStrokeWidth);
      }
    }

    // 绘制橡皮擦圆圈
    if (tool === "eraser" && eraserPos) {
      const pixelX = eraserPos.x * gridSize;
      const pixelY = eraserPos.y * gridSize;
      const pixelRadius = eraserRadius * gridSize;

      // 半透明红色填充
      ctx.fillStyle = "rgba(255, 0, 0, 0.15)";
      ctx.beginPath();
      ctx.arc(pixelX, pixelY, pixelRadius, 0, 2 * Math.PI);
      ctx.fill();

      // 红色虚线边框
      ctx.strokeStyle = "rgba(255, 0, 0, 0.6)";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.arc(pixelX, pixelY, pixelRadius, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]); // 重置虚线
    }
  }, [canvasWidth, canvasHeight, drawings, isDrawing, startPoint, currentPoint, sketchPoints, tool, drawColor, drawStrokeWidth, eraserPos, eraserRadius, gridSize, drawCircle, drawArrow, drawSketch]);

  // Calculate point to line segment distance (same as RulerRenderer)
  const pointToLineDistance = (
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
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

    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Check if point is on a drawing and return the drawing id
  // radius: 检测半径（用于橡皮擦），默认0.5
  // Uses drawingsRef to ensure we always check against latest drawings
  const getDrawingsInRadius = (gridX: number, gridY: number, radius: number = 0.5): number[] => {
    const result: number[] = [];
    const currentDrawings = drawingsRef.current;

    for (let i = currentDrawings.length - 1; i >= 0; i--) {
      const drawing = currentDrawings[i];

      if (drawing.type === "circle" && drawing.center_x !== undefined && drawing.center_y !== undefined && drawing.radius !== undefined) {
        // 检测橡皮圈是否与绘制的圆相交
        const distToCenter = calculateDistance(drawing.center_x, drawing.center_y, gridX, gridY);
        // 如果橡皮圈触碰到圆的边缘或内部
        if (distToCenter <= drawing.radius + radius || Math.abs(distToCenter - drawing.radius) <= radius) {
          result.push(drawing.id);
        }
      } else if (drawing.type === "arrow" && drawing.points && drawing.points.length === 2) {
        const distToLine = pointToLineDistance(
          gridX, gridY,
          drawing.points[0].x, drawing.points[0].y,
          drawing.points[1].x, drawing.points[1].y
        );
        if (distToLine <= radius) {
          result.push(drawing.id);
        }
      } else if (drawing.type === "sketch" && drawing.points && drawing.points.length > 1) {
        let found = false;
        for (let j = 0; j < drawing.points.length - 1; j++) {
          const distToSegment = pointToLineDistance(
            gridX, gridY,
            drawing.points[j].x, drawing.points[j].y,
            drawing.points[j + 1].x, drawing.points[j + 1].y
          );
          if (distToSegment <= radius) {
            found = true;
            break;
          }
        }
        if (found) result.push(drawing.id);
      } else if (drawing.type === "ruler" && drawing.start_x !== undefined && drawing.start_y !== undefined && drawing.end_x !== undefined && drawing.end_y !== undefined) {
        const distToLine = pointToLineDistance(
          gridX, gridY,
          drawing.start_x, drawing.start_y,
          drawing.end_x, drawing.end_y
        );
        if (distToLine <= radius) {
          result.push(drawing.id);
        }
      }
    }
    return result;
  };

  // 兼容旧接口
  const getDrawingAtPoint = (gridX: number, gridY: number): number | null => {
    const results = getDrawingsInRadius(gridX, gridY, 0.5);
    return results.length > 0 ? results[0] : null;
  };

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    drawDrawings();
  }, [canvasWidth, canvasHeight]);

  // Redraw when drawings change
  useEffect(() => {
    drawDrawings();
  }, [drawDrawings]);

  // Mouse event handling
  useEffect(() => {
    if (!isEnabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const getGridCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const canvasX = clientX - rect.left;
      const canvasY = clientY - rect.top;

      // Canvas 有 transform: translate(stagePos.x, stagePos.y) scale(stageScale)
      // getBoundingClientRect 返回的是变换后的边界框
      // 需要反向变换来获取实际的 canvas 坐标
      const stageX = canvasX / stageScale;
      const stageY = canvasY / stageScale;

      const gridX = stageX / gridSize;
      const gridY = stageY / gridSize;

      logger.debug(`[DrawingsRenderer] getGridCoords: client(${clientX}, ${clientY}) -> canvas(${canvasX.toFixed(1)}, ${canvasY.toFixed(1)}) -> stage(${stageX.toFixed(1)}, ${stageY.toFixed(1)}) -> grid(${gridX.toFixed(2)}, ${gridY.toFixed(2)}), stageScale=${stageScale}, stagePos=(${stagePos.x}, ${stagePos.y})`);

      return { gridX, gridY };
    };

    const handleMouseDown = (e: MouseEvent) => {
      const { gridX, gridY } = getGridCoords(e.clientX, e.clientY);
      const currentDrawings = drawingsRef.current;

      if (tool === "eraser") {
        // Start erasing mode (drag to delete)
        setIsErasing(true);
        setEraserPos({ x: gridX, y: gridY });

        // 使用橡皮擦半径检测并删除所有在范围内的绘图
        const drawingIds = getDrawingsInRadius(gridX, gridY, eraserRadius);
        if (drawingIds.length > 0) {
          drawingIds.forEach(drawingId => {
            const drawing = currentDrawings.find((d) => d.id === drawingId);
            if (drawing && (isDM || drawing.created_by_user_id === currentUserId)) {
              onDrawingRemoveRef.current?.(drawingId);
            }
          });
        }
      } else if (tool === "circle" || tool === "arrow") {
        setIsDrawing(true);
        setStartPoint({ x: gridX, y: gridY });
        setCurrentPoint({ x: gridX, y: gridY });
      } else if (tool === "sketch") {
        setIsDrawing(true);
        setSketchPoints([{ x: gridX, y: gridY }]);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const { gridX, gridY } = getGridCoords(e.clientX, e.clientY);

      // 橡皮擦模式 - 始终更新位置以显示圆圈
      if (tool === "eraser") {
        setEraserPos({ x: gridX, y: gridY });

        // 如果正在擦除（鼠标按下状态），删除范围内的绘图
        if (isErasing) {
          const drawingIds = getDrawingsInRadius(gridX, gridY, eraserRadius);
          const currentDrawings = drawingsRef.current;
          drawingIds.forEach(drawingId => {
            const drawing = currentDrawings.find((d) => d.id === drawingId);
            if (drawing && (isDM || drawing.created_by_user_id === currentUserId)) {
              logger.debug(`[DrawingsRenderer] Drag-deleting drawing ${drawingId}`);
              onDrawingRemoveRef.current?.(drawingId);
            }
          });
        }
        return; // Don't process drawing when in eraser mode
      }

      // Handle drawing tools
      if (!isDrawing) return;

      if (tool === "circle" || tool === "arrow") {
        setCurrentPoint({ x: gridX, y: gridY });
      } else if (tool === "sketch") {
        setSketchPoints((prev) => [...prev, { x: gridX, y: gridY }]);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      // End erasing mode
      if (isErasing && tool === "eraser") {
        setIsErasing(false);
        return;
      }

      if (!isDrawing) return;

      const { gridX, gridY } = getGridCoords(e.clientX, e.clientY);

      // Allow both DM and players to create drawings (server enforces deletion permissions)
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
            points: [
              { x: startPoint.x, y: startPoint.y },
              { x: gridX, y: gridY },
            ],
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
    };

    const handleMouseLeave = () => {
      // 鼠标离开时清除橡皮擦位置
      if (tool === "eraser") {
        setEraserPos(null);
      }
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isEnabled, isDM, tool, isDrawing, isErasing, startPoint, sketchPoints, stageScale, gridSize, currentUserId, eraserRadius]);

  // 当工具改变时清除橡皮擦位置
  useEffect(() => {
    if (tool !== "eraser") {
      setEraserPos(null);
    }
  }, [tool]);

  // 滚轮调整橡皮擦大小
  useEffect(() => {
    if (!isEnabled || tool !== "eraser") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // 向上滚动（deltaY < 0）增大，向下滚动减小
      const delta = e.deltaY < 0 ? ERASER_RADIUS_STEP : -ERASER_RADIUS_STEP;
      setEraserRadius(prev => {
        const newRadius = Math.max(ERASER_RADIUS_MIN, Math.min(ERASER_RADIUS_MAX, prev + delta));
        return newRadius;
      });
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [isEnabled, tool]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        zIndex: 120, // Above ruler (110) and fog (100) but below controls (150) and modals (9999)
        cursor: tool === "eraser" ? "none" : (tool ? "crosshair" : "default"),
        display: "block",
        pointerEvents: isEnabled ? "auto" : "none",
        transform: `translate(${stagePos.x}px, ${stagePos.y}px) scale(${stageScale})`,
        transformOrigin: "0 0",
      }}
    />
  );
};
