import { useRef, useEffect, useState } from "react";

// 标尺颜色数组，循环使用
const RULER_COLORS = [
  "#ff0000", // 红色
  "#00ff00", // 绿色
  "#0000ff", // 蓝色
  "#ffff00", // 黄色
  "#ff00ff", // 洋红
  "#00ffff", // 青色
  "#ff8800", // 橙色
  "#8800ff", // 紫色
];

interface Ruler {
  id: number;
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
  distance: number;
  color: string;
  ruler_type: "line" | "circle";
}

interface RulerRendererProps {
  canvasWidth: number;
  canvasHeight: number;
  gridSize: number; // 40px per cell
  gridUnitLength: number; // e.g., 5 feet per cell
  rulers: Ruler[];
  isEnabled: boolean;
  isDM: boolean;
  mode: "measure" | "circle" | "erase" | null; // measure=直线, circle=圆形, erase=擦除
  stageScale: number;
  stagePos: { x: number; y: number };
  onRulerAdd?: (ruler: Omit<Ruler, "id">) => void;
  onRulerRemove?: (rulerId: number) => void;
  // Callbacks for forwarding multi-touch gestures to parent (for Stage zoom/pan)
  onMultiTouchMove?: (touches: { x: number; y: number }[]) => void;
  onMultiTouchEnd?: () => void;
}

export const RulerRenderer = ({
  canvasWidth,
  canvasHeight,
  gridSize,
  gridUnitLength,
  rulers,
  isEnabled,
  isDM,
  mode,
  stageScale,
  stagePos,
  onRulerAdd,
  onRulerRemove,
  onMultiTouchMove,
  onMultiTouchEnd,
}: RulerRendererProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentPoint, setCurrentPoint] = useState<{ x: number; y: number } | null>(null);

  // 获取下一个标尺的颜色
  const getNextColor = () => {
    return RULER_COLORS[rulers.length % RULER_COLORS.length];
  };

  // 计算两点之间的距离（D&D 5E网格距离，切比雪夫距离）
  const calculateDistance = (x1: number, y1: number, x2: number, y2: number): number => {
    return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  };

  // 计算欧几里得距离（用于圆形标尺半径）
  const calculateEuclideanDistance = (x1: number, y1: number, x2: number, y2: number): number => {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  };

  // 绘制标尺
  const drawRulers = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // 绘制已保存的标尺
    rulers.forEach((ruler) => {
      if (ruler.ruler_type === "circle") {
        drawCircleRuler(ctx, ruler.start_x, ruler.start_y, ruler.distance, ruler.color);
      } else {
        drawRuler(ctx, ruler.start_x, ruler.start_y, ruler.end_x, ruler.end_y, ruler.distance, ruler.color);
      }
    });

    // 绘制正在绘制的标尺
    if (isDrawing && startPoint && currentPoint) {
      const nextColor = getNextColor();
      if (mode === "measure") {
        const distance = calculateDistance(startPoint.x, startPoint.y, currentPoint.x, currentPoint.y);
        drawRuler(ctx, startPoint.x, startPoint.y, currentPoint.x, currentPoint.y, distance, nextColor);
      } else if (mode === "circle") {
        const radius = calculateEuclideanDistance(startPoint.x, startPoint.y, currentPoint.x, currentPoint.y);
        drawCircleRuler(ctx, startPoint.x, startPoint.y, radius, nextColor);
      }
    }
  };

  // 绘制单个直线标尺
  const drawRuler = (
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    distance: number,
    color: string
  ) => {
    const pixelX1 = x1 * gridSize;
    const pixelY1 = y1 * gridSize;
    const pixelX2 = x2 * gridSize;
    const pixelY2 = y2 * gridSize;

    // 绘制线条
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pixelX1, pixelY1);
    ctx.lineTo(pixelX2, pixelY2);
    ctx.stroke();

    // 绘制起点和终点圆圈
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pixelX1, pixelY1, 6, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pixelX2, pixelY2, 6, 0, 2 * Math.PI);
    ctx.fill();

    // 绘制距离标签
    const midX = (pixelX1 + pixelX2) / 2;
    const midY = (pixelY1 + pixelY2) / 2;
    const realDistance = distance * gridUnitLength;
    const text = `${realDistance.toFixed(1)} ft`;

    ctx.fillStyle = "#000000";
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // 背景矩形
    const metrics = ctx.measureText(text);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillRect(midX - metrics.width / 2 - 4, midY - 10, metrics.width + 8, 20);
    // 文字
    ctx.fillStyle = "#000000";
    ctx.fillText(text, midX, midY);
  };

  // 绘制圆形标尺
  const drawCircleRuler = (
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    radius: number,
    color: string
  ) => {
    const pixelCX = centerX * gridSize;
    const pixelCY = centerY * gridSize;
    const pixelRadius = radius * gridSize;

    // 绘制圆形（半透明填充）
    ctx.fillStyle = color + "1a"; // 约10%不透明度
    ctx.beginPath();
    ctx.arc(pixelCX, pixelCY, pixelRadius, 0, 2 * Math.PI);
    ctx.fill();

    // 绘制圆形边框
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.arc(pixelCX, pixelCY, pixelRadius, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);

    // 绘制中心点
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pixelCX, pixelCY, 5, 0, 2 * Math.PI);
    ctx.fill();

    // 绘制半径线（虚线从中心到右侧边缘）
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(pixelCX, pixelCY);
    ctx.lineTo(pixelCX + pixelRadius, pixelCY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 绘制半径标签
    const realRadius = radius * gridUnitLength;
    const text = `r=${realRadius.toFixed(1)} ft`;
    const labelX = pixelCX + pixelRadius / 2;
    const labelY = pixelCY - 12;

    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const metrics = ctx.measureText(text);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillRect(labelX - metrics.width / 2 - 4, labelY - 10, metrics.width + 8, 20);
    ctx.fillStyle = "#000000";
    ctx.fillText(text, labelX, labelY);
  };

  // 初始化Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    drawRulers();
  }, [canvasWidth, canvasHeight]);

  // 重绘标尺
  useEffect(() => {
    drawRulers();
  }, [rulers, isDrawing, startPoint, currentPoint, mode]);

  // 鼠标事件处理
  useEffect(() => {
    if (!mode) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const getGridCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const canvasX = clientX - rect.left;
      const canvasY = clientY - rect.top;

      const stageX = canvasX / stageScale;
      const stageY = canvasY / stageScale;

      const gridX = stageX / gridSize;
      const gridY = stageY / gridSize;

      return { gridX, gridY };
    };

    const handleStart = (clientX: number, clientY: number) => {
      const { gridX, gridY } = getGridCoords(clientX, clientY);

      if (mode === "measure" || mode === "circle") {
        setIsDrawing(true);
        setStartPoint({ x: gridX, y: gridY });
        setCurrentPoint({ x: gridX, y: gridY });
      } else if (mode === "erase") {
        // 擦除标尺：查找点击位置附近的标尺
        const clickThreshold = 0.5; // 网格单位
        for (const ruler of rulers) {
          if (ruler.ruler_type === "circle") {
            // 圆形标尺：检查点击点是否在圆边附近或中心附近
            const distToCenter = calculateEuclideanDistance(gridX, gridY, ruler.start_x, ruler.start_y);
            const distToEdge = Math.abs(distToCenter - ruler.distance);
            if (distToCenter < clickThreshold || distToEdge < clickThreshold) {
              onRulerRemove?.(ruler.id);
              break;
            }
          } else {
            // 直线标尺：原有逻辑
            const distToStart = calculateDistance(gridX, gridY, ruler.start_x, ruler.start_y);
            const distToEnd = calculateDistance(gridX, gridY, ruler.end_x, ruler.end_y);
            const distToLine = pointToLineDistance(
              gridX, gridY, ruler.start_x, ruler.start_y, ruler.end_x, ruler.end_y
            );
            if (distToStart < clickThreshold || distToEnd < clickThreshold || distToLine < clickThreshold) {
              onRulerRemove?.(ruler.id);
              break;
            }
          }
        }
      }
    };

    const handleMove = (clientX: number, clientY: number) => {
      if (!isDrawing || (mode !== "measure" && mode !== "circle")) return;

      const { gridX, gridY } = getGridCoords(clientX, clientY);
      setCurrentPoint({ x: gridX, y: gridY });
    };

    const handleEnd = (clientX: number, clientY: number) => {
      if (!isDrawing || (mode !== "measure" && mode !== "circle")) return;

      const { gridX, gridY } = getGridCoords(clientX, clientY);

      if (mode === "measure") {
        const distance = calculateDistance(startPoint!.x, startPoint!.y, gridX, gridY);
        if (distance > 0.1) {
          onRulerAdd?.({
            start_x: startPoint!.x,
            start_y: startPoint!.y,
            end_x: gridX,
            end_y: gridY,
            distance,
            color: getNextColor(),
            ruler_type: "line",
          });
        }
      } else if (mode === "circle") {
        const radius = calculateEuclideanDistance(startPoint!.x, startPoint!.y, gridX, gridY);
        if (radius > 0.1) {
          onRulerAdd?.({
            start_x: startPoint!.x,
            start_y: startPoint!.y,
            end_x: gridX,
            end_y: gridY,
            distance: radius,
            color: getNextColor(),
            ruler_type: "circle",
          });
        }
      }

      setIsDrawing(false);
      setStartPoint(null);
      setCurrentPoint(null);
    };

    // Mouse event handlers
    const handleMouseDown = (e: MouseEvent) => handleStart(e.clientX, e.clientY);
    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const handleMouseUp = (e: MouseEvent) => handleEnd(e.clientX, e.clientY);

    // Touch event handlers
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];
        handleStart(touch.clientX, touch.clientY);
      }
      // Multi-touch: don't prevent default, let parent handle zoom/pan
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];
        handleMove(touch.clientX, touch.clientY);
      } else if (e.touches.length >= 2 && onMultiTouchMove) {
        // Forward multi-touch to parent for zoom/pan
        e.preventDefault();
        const touches = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));
        onMultiTouchMove(touches);
      }
    };
    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        // All fingers lifted
        if (isDrawing && e.changedTouches.length > 0) {
          e.preventDefault();
          const touch = e.changedTouches[0];
          handleEnd(touch.clientX, touch.clientY);
        }
        // Notify parent that multi-touch ended
        onMultiTouchEnd?.();
      }
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isDM, mode, isDrawing, startPoint, rulers, stageScale, gridSize, onMultiTouchMove, onMultiTouchEnd]);

  // 计算点到线段的距离
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

  const isDrawMode = mode === "measure" || mode === "circle";

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        zIndex: 110, // Above fog (100) but below controls (150)
        cursor: isDrawMode ? "crosshair" : mode === "erase" ? "pointer" : "default",
        display: isEnabled ? "block" : "none",
        pointerEvents: mode ? "auto" : "none",
        transform: `translate(${stagePos.x}px, ${stagePos.y}px) scale(${stageScale})`,
        transformOrigin: "0 0",
      }}
    />
  );
};
