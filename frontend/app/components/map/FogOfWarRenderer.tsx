import { useRef, useEffect, useState } from "react";
import { FogOfWarManager, type FogData } from "./FogOfWarManager";

interface FogOfWarRendererProps {
  canvasWidth: number;
  canvasHeight: number;
  mapWidth: number; // 地图像素宽度
  mapHeight: number; // 地图像素高度
  gridSize: number; // 网格大小（40px）
  isEnabled: boolean; // 是否显示迷雾
  isEditable?: boolean; // 是否可编辑（默认false）
  isDM: boolean;
  mode: "brush" | "eraser";
  brushSize: number; // 笔刷大小（网格数）
  stageScale: number; // 当前Stage缩放级别
  stagePos: { x: number; y: number }; // Stage位置
  initialFogData?: FogData;
  onFogUpdate?: (fogData: FogData) => void;
  onWheel?: (e: WheelEvent) => void; // 滚轮缩放穿透
  currentMapUrl?: string | null;
}

export const FogOfWarRenderer = ({
  canvasWidth,
  canvasHeight,
  mapWidth,
  mapHeight,
  gridSize,
  isEnabled,
  isEditable = false,
  isDM,
  mode,
  brushSize,
  stageScale,
  stagePos,
  initialFogData,
  onFogUpdate,
  onWheel: onWheelProp,
  currentMapUrl,
}: FogOfWarRendererProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorDivRef = useRef<HTMLDivElement>(null);
  const [fogManager] = useState(() => {
    const manager = new FogOfWarManager(currentMapUrl || "");
    if (initialFogData) {
      manager.setMapUrl(initialFogData.mapUrl);
      // 重新初始化迷雾数据
      const cells = initialFogData.cells;
      cells.forEach(([x, y]) => {
        manager.addFog(x, y, 1);
      });
    }
    return manager;
  });

  // 重绘迷雾Canvas
  const redrawFog = (affectedOnly = false) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 清空整个Canvas或仅清除受影响的区域
    if (!affectedOnly) {
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    }

    // 根据角色设置不同的迷雾透明度
    // DM: 半透明黑色 (可以看到地图)
    // 玩家: 完全不透明黑色 (完全遮挡)
    ctx.fillStyle = isDM ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 1)";
    const fogCells = fogManager.getAllCells();

    fogCells.forEach((cellKey) => {
      const [x, y] = cellKey.split(",").map(Number);
      const pixelX = x * gridSize;
      const pixelY = y * gridSize;

      ctx.fillRect(pixelX, pixelY, gridSize, gridSize);
    });
  };

  // 初始化Canvas并绘制迷雾
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    redrawFog();
  }, [canvasWidth, canvasHeight]);

  // 处理地图URL变化
  useEffect(() => {
    if (currentMapUrl) {
      fogManager.setMapUrl(currentMapUrl);
      redrawFog();
    }
  }, [currentMapUrl]);

  // 处理初始迷雾数据变化（切换地图时重新加载迷雾）
  useEffect(() => {
    // 清空当前迷雾
    fogManager.clearAll();

    // 重新加载迷雾数据
    if (initialFogData && initialFogData.cells && initialFogData.cells.length > 0) {
      initialFogData.cells.forEach(([x, y]) => {
        fogManager.addFog(x, y, 1);
      });
    }

    redrawFog();
  }, [initialFogData]);

  // 迷雾数据变化时重绘
  useEffect(() => {
    redrawFog();
  }, [mode, brushSize]);

  // 鼠标/触摸事件处理 - 只有可编辑时才监听
  useEffect(() => {
    if (!isEditable) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let isDrawing = false;

    const getGridCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const canvasX = clientX - rect.left;
      const canvasY = clientY - rect.top;

      // canvasX/Y are in transformed canvas space (after CSS transform)
      // getBoundingClientRect() already accounts for CSS translate/scale
      // So we only need to divide by scale to get back to canvas drawing coordinates
      const stageX = canvasX / stageScale;
      const stageY = canvasY / stageScale;

      // 转换为网格坐标
      const gridX = Math.floor(stageX / gridSize);
      const gridY = Math.floor(stageY / gridSize);

      return { gridX, gridY };
    };

    const applyFog = (clientX: number, clientY: number) => {
      const { gridX, gridY } = getGridCoords(clientX, clientY);

      if (mode === "brush") {
        fogManager.addFog(gridX, gridY, brushSize);
      } else {
        fogManager.removeFog(gridX, gridY, brushSize);
      }

      redrawFog();
      onFogUpdate?.(fogManager.getData());
    };

    // Mouse event handlers
    const handleMouseDown = (e: MouseEvent) => {
      isDrawing = true;
      applyFog(e.clientX, e.clientY);
    };

    const handleMouseMove = (e: MouseEvent) => {
      // 更新笔刷预览圆圈位置（DOM 操作，无 canvas 重绘开销）
      const div = cursorDivRef.current;
      if (div) {
        const diameter = brushSize * gridSize * stageScale;
        const half = diameter / 2;
        div.style.left = `${e.clientX - half}px`;
        div.style.top = `${e.clientY - half}px`;
        div.style.width = `${diameter}px`;
        div.style.height = `${diameter}px`;
        div.style.display = 'block';
      }
      if (!isDrawing) return;
      applyFog(e.clientX, e.clientY);
    };

    const handleMouseUp = () => {
      isDrawing = false;
    };

    const handleMouseLeave = () => {
      const div = cursorDivRef.current;
      if (div) div.style.display = 'none';
    };

    // Touch event handlers
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        isDrawing = true;
        const touch = e.touches[0];
        applyFog(touch.clientX, touch.clientY);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDrawing || e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      applyFog(touch.clientX, touch.clientY);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        isDrawing = false;
      }
    };

    // Wheel 事件穿透：fog canvas 在 Stage 上层，转发给父组件处理缩放
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      onWheelProp?.(e);
    };

    // Add mouse event listeners
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    document.addEventListener("mouseup", handleMouseUp);

    // Add touch event listeners
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: false });

    // 暴露到全局用于外部调用
    (window as any).__fillFogOfWar = () => {
      const mapGridWidth = Math.ceil(mapWidth / gridSize);
      const mapGridHeight = Math.ceil(mapHeight / gridSize);
      fogManager.fillAll(mapGridWidth, mapGridHeight);
      redrawFog();
      onFogUpdate?.(fogManager.getData());
    };

    (window as any).__clearFogOfWar = () => {
      fogManager.clearAll();
      redrawFog();
      onFogUpdate?.(fogManager.getData());
    };

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      canvas.removeEventListener("wheel", handleWheel);
      document.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      delete (window as any).__fillFogOfWar;
      delete (window as any).__clearFogOfWar;
      // 隐藏光标预览
      const div = cursorDivRef.current;
      if (div) div.style.display = 'none';
    };
  }, [isEditable, mode, brushSize, stageScale, gridSize, mapWidth, mapHeight]);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: 100,
          cursor: "default",
          display: isEnabled ? "block" : "none",
          pointerEvents: isEditable ? "auto" : "none",
          transform: `translate(${stagePos.x}px, ${stagePos.y}px) scale(${stageScale})`,
          transformOrigin: "0 0",
        }}
      />
      {/* 笔刷预览圆圈 — 轻量 DOM div，position:fixed 跟随鼠标 */}
      <div
        ref={cursorDivRef}
        style={{
          position: "fixed",
          display: "none",
          pointerEvents: "none",
          borderRadius: "50%",
          border: `2px dashed ${mode === "brush" ? "rgba(100,180,255,0.8)" : "rgba(255,100,100,0.8)"}`,
          zIndex: 9999,
          boxSizing: "border-box",
        }}
      />
    </>
  );
};
