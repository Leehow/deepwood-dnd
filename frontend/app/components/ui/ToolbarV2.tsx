import * as Tooltip from "@radix-ui/react-tooltip";
import { useState, useRef, useEffect } from "react";
import { Anchor } from "lucide-react";

interface ToolbarV2Props {
  selectedTool: string;
  onToolChange: (tool: string) => void;
  onFocusMyToken?: () => void;
  fogMode?: "brush" | "eraser";
  onFogModeChange?: (mode: "brush" | "eraser") => void;
  fogBrushSize?: number;
  onFogBrushSizeChange?: (size: number) => void;
  onFillFogOfWar?: () => void;
  onClearFogOfWar?: () => void;
  rulerMode?: "measure" | "circle" | "erase" | null;
  onRulerModeChange?: (mode: "measure" | "circle" | "erase" | null) => void;
  drawTool?: "circle" | "sketch" | "arrow" | "eraser" | null;
  onDrawToolChange?: (tool: "circle" | "sketch" | "arrow" | "eraser" | null) => void;
  drawColor?: string;
  onDrawColorChange?: (color: string) => void;
  drawStrokeWidth?: number;
  onDrawStrokeWidthChange?: (width: number) => void;
  onUndoLastDrawing?: () => void;
  onGridUnitSettingsClick?: () => void;
  isDM?: boolean;
  markerIcon?: string;
  onMarkerIconChange?: (icon: string) => void;
  markerColor?: string;
  onMarkerColorChange?: (color: string) => void;
  onClearAllMarkers?: () => void;
  tokenMode?: "place" | "delete";
  onTokenModeChange?: (mode: "place" | "delete") => void;
  hasMyTokenOnMap?: boolean; // 玩家的Token是否已在地图上
  onPlaceMyTokenAtCenter?: () => void; // 一键放置Token到视野中心
  // AI标记可见性
  showAIMarkers?: boolean;
  onShowAIMarkersChange?: (show: boolean) => void;
  // 锚点
  onJumpToAnchor?: () => void;
  onSetAnchorMode?: () => void;
  onClearAnchor?: () => void;
  // 地形
  terrainType?: string;
  onTerrainTypeChange?: (type: string) => void;
  terrainBrushSize?: number;
  onTerrainBrushSizeChange?: (size: number) => void;
  terrainMode?: "brush" | "eraser";
  onTerrainModeChange?: (mode: "brush" | "eraser") => void;
  onClearAllTerrain?: () => void;
  showTerrainToPlayers?: boolean;
  onShowTerrainToPlayersChange?: (show: boolean) => void;
}

// SVG Icons
const Icons = {
  move: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M7 11V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v6M11 9V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v5"/>
      <path d="M15 8V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v9a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6v-4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2"/>
    </svg>
  ),
  select: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5 3l14 9-6 1 3 7-3 1-3-7-5 3V3z"/>
    </svg>
  ),
  ruler: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 6H3v12h18V6z"/>
      <path d="M6 6v4M9 6v2M12 6v4M15 6v2M18 6v4"/>
    </svg>
  ),
  draw: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 19l7-7 3 3-7 7-3-3z"/>
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
      <path d="M2 2l7.586 7.586"/>
      <circle cx="11" cy="11" r="2"/>
    </svg>
  ),
  marker: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 21c-4-4-8-7.5-8-11a8 8 0 0 1 16 0c0 3.5-4 7-8 11z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  fog: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M17.5 19H9a5.5 5.5 0 0 1-.5-11 7 7 0 0 1 13.5 3 4.5 4.5 0 0 1-4.5 8z"/>
      <path d="M5.5 16.5A4 4 0 1 1 9 9"/>
    </svg>
  ),
  token: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="8" r="5"/>
      <path d="M3 21v-2a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2"/>
    </svg>
  ),
  brush: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M18.37 2.63L14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3z"/>
      <path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-10"/>
    </svg>
  ),
  eraser: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8l10-10c.8-.8 2-.8 2.8 0l5.6 5.6c.8.8.8 2 0 2.8L14 19"/>
      <path d="M6.5 13.5L12 8"/>
    </svg>
  ),
  fillAll: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
    </svg>
  ),
  clearAll: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
    </svg>
  ),
  measure: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 12h5l3-9 4 18 3-9h5"/>
    </svg>
  ),
  circleRuler: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9"/>
      <line x1="12" y1="12" x2="21" y2="12" strokeDasharray="2 2"/>
      <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>
  ),
  circle: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9"/>
    </svg>
  ),
  sketch: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 7v6h6M3 13a9 9 0 1 0 2.5-6.5L3 9"/>
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  ),
  focus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
    </svg>
  ),
  aiMarker: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
      <circle cx="12" cy="9" r="2.5"/>
      <path d="M9 7l1-2M15 7l-1-2M12 11v2" strokeWidth="1.2"/>
    </svg>
  ),
  placeMyToken: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="8" r="4"/>
      <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
      <path d="M12 14v4M10 16h4" strokeWidth="2"/>
    </svg>
  ),
  anchor: <Anchor size={20} />,
  terrain: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 22L8 8l4 6 4-10 6 18H2z"/>
      <path d="M2 22h20" strokeWidth="2"/>
    </svg>
  ),
};

const markerIconsList = ["📍", "⚠️", "💀", "🏠", "⭐", "🔥", "💎", "🗝️", "📦", "🎯", "🚩", "❓"];

const allTools = [
  { id: "move", icon: Icons.move, label: "移动画布", dmOnly: false, playerOnly: false },
  { id: "select", icon: Icons.select, label: "选择 Token", dmOnly: false, playerOnly: false },
  { id: "placeMyToken", icon: Icons.placeMyToken, label: "放置我的Token", dmOnly: false, playerOnly: true },
  { id: "ruler", icon: Icons.ruler, label: "测量距离", dmOnly: false, playerOnly: false },
  { id: "draw", icon: Icons.draw, label: "绘图工具", dmOnly: false, playerOnly: false },
  { id: "anchor", icon: Icons.anchor, label: "锚点", dmOnly: false, playerOnly: false },
  { id: "fog", icon: Icons.fog, label: "战争迷雾", dmOnly: true, playerOnly: false },
  { id: "terrain", icon: Icons.terrain, label: "地形编辑", dmOnly: true, playerOnly: false },
];

export function ToolbarV2(props: ToolbarV2Props) {
  const {
    selectedTool,
    onToolChange,
    onFocusMyToken,
    fogMode = "brush",
    onFogModeChange,
    fogBrushSize = 1,
    onFogBrushSizeChange,
    onFillFogOfWar,
    onClearFogOfWar,
    rulerMode = null,
    onRulerModeChange,
    drawTool = null,
    onDrawToolChange,
    drawColor = "#ff0000",
    onDrawColorChange,
    drawStrokeWidth = 2,
    onDrawStrokeWidthChange,
    onUndoLastDrawing,
    onGridUnitSettingsClick,
    isDM = true,
    markerIcon = "📍",
    onMarkerIconChange,
    markerColor = "#ef4444",
    onMarkerColorChange,
    onClearAllMarkers,
    tokenMode = "place",
    onTokenModeChange,
    hasMyTokenOnMap = false,
    onPlaceMyTokenAtCenter,
    showAIMarkers = true,
    onShowAIMarkersChange,
    onJumpToAnchor,
    onSetAnchorMode,
    onClearAnchor,
    terrainType = "difficult",
    onTerrainTypeChange,
    terrainBrushSize = 1,
    onTerrainBrushSizeChange,
    terrainMode = "brush",
    onTerrainModeChange,
    onClearAllTerrain,
    showTerrainToPlayers = false,
    onShowTerrainToPlayersChange,
  } = props;

  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setExpandedTool(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const tools = isDM
    ? allTools.filter(tool => !tool.playerOnly)
    : allTools.filter(tool => {
        if (tool.dmOnly) return false;
        // 如果玩家Token已在地图上，隐藏放置按钮
        if (tool.id === "placeMyToken" && hasMyTokenOnMap) return false;
        return true;
      });

  const handleToolClick = (toolId: string) => {
    // Player clicks anchor → jump directly
    if (toolId === "anchor" && !isDM) {
      onJumpToAnchor?.();
      return;
    }
    const isSubMenuTool = ["fog", "terrain", "ruler", "draw", "marker", "anchor"].includes(toolId);
    if (isSubMenuTool && selectedTool === toolId) {
      // Already selected: toggle off → switch to "move"
      onToolChange("move");
      setExpandedTool(null);
    } else {
      onToolChange(toolId);
      if (isSubMenuTool) {
        setExpandedTool(toolId);
      } else {
        setExpandedTool(null);
      }
    }
  };

  const renderSubMenu = (toolId: string) => {
    switch (toolId) {
      case "fog":
        return (
          <div className="sub-menu">
            <SubButton
              icon={Icons.brush}
              label="添加迷雾"
              active={fogMode === "brush"}
              onClick={() => onFogModeChange?.("brush")}
              variant="blue"
            />
            <SubButton
              icon={Icons.eraser}
              label="移除迷雾"
              active={fogMode === "eraser"}
              onClick={() => onFogModeChange?.("eraser")}
              variant="red"
            />
            <div className="stroke-slider">
              <label>{fogBrushSize}格</label>
              <input
                type="range"
                min="1"
                max="5"
                value={fogBrushSize}
                onChange={(e) => onFogBrushSizeChange?.(parseInt(e.target.value))}
              />
            </div>
            <div className="sub-divider" />
            <SubButton
              icon={Icons.fillAll}
              label="全图迷雾"
              onClick={() => { onFillFogOfWar?.(); setExpandedTool(null); }}
            />
            <SubButton
              icon={Icons.clearAll}
              label="清除迷雾"
              onClick={() => { onClearFogOfWar?.(); setExpandedTool(null); }}
            />
          </div>
        );

      case "ruler":
        return (
          <div className="sub-menu">
            <SubButton
              icon={Icons.measure}
              label="直线测量"
              active={rulerMode === "measure"}
              onClick={() => onRulerModeChange?.("measure")}
              variant="green"
            />
            <SubButton
              icon={Icons.circleRuler}
              label="圆形测量"
              active={rulerMode === "circle"}
              onClick={() => onRulerModeChange?.("circle")}
              variant="blue"
            />
            <SubButton
              icon={Icons.eraser}
              label="删除标尺"
              active={rulerMode === "erase"}
              onClick={() => onRulerModeChange?.("erase")}
              variant="red"
            />
            {isDM && (
              <>
                <div className="sub-divider" />
                <SubButton
                  icon={Icons.settings}
                  label="单位设置"
                  onClick={() => onGridUnitSettingsClick?.()}
                />
              </>
            )}
          </div>
        );

      case "draw":
        return (
          <div className="sub-menu">
            <SubButton
              icon={Icons.circle}
              label="画圆"
              active={drawTool === "circle"}
              onClick={() => onDrawToolChange?.("circle")}
              variant="blue"
            />
            <SubButton
              icon={Icons.sketch}
              label="手绘"
              active={drawTool === "sketch"}
              onClick={() => onDrawToolChange?.("sketch")}
              variant="purple"
            />
            <SubButton
              icon={Icons.arrow}
              label="箭头"
              active={drawTool === "arrow"}
              onClick={() => onDrawToolChange?.("arrow")}
              variant="orange"
            />
            <SubButton
              icon={Icons.eraser}
              label="擦除"
              active={drawTool === "eraser"}
              onClick={() => onDrawToolChange?.("eraser")}
              variant="red"
            />
            <div className="sub-divider" />
            <div className="color-picker">
              <label>颜色</label>
              <input
                type="color"
                value={drawColor}
                onChange={(e) => onDrawColorChange?.(e.target.value)}
              />
            </div>
            <div className="stroke-slider">
              <label>笔宽: {drawStrokeWidth}px</label>
              <input
                type="range"
                min="1"
                max="10"
                value={drawStrokeWidth}
                onChange={(e) => onDrawStrokeWidthChange?.(parseInt(e.target.value))}
              />
            </div>
            <div className="sub-divider" />
            <SubButton
              icon={Icons.undo}
              label="撤销"
              onClick={() => onUndoLastDrawing?.()}
              variant="amber"
            />
          </div>
        );

      case "marker":
        return (
          <div className="sub-menu marker-menu">
            <div className="marker-icons">
              <label>图标</label>
              <div className="icon-grid">
                {markerIconsList.map((icon) => (
                  <button
                    key={icon}
                    className={`icon-btn ${markerIcon === icon ? 'active' : ''}`}
                    onClick={() => onMarkerIconChange?.(icon)}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
            <div className="color-picker">
              <label>颜色</label>
              <input
                type="color"
                value={markerColor}
                onChange={(e) => onMarkerColorChange?.(e.target.value)}
              />
            </div>
            <div className="sub-divider" />
            <SubButton
              icon={Icons.trash}
              label="清除全部"
              onClick={() => onClearAllMarkers?.()}
              variant="red"
            />
          </div>
        );

      case "anchor":
        return (
          <div className="sub-menu">
            <SubButton
              icon={Icons.marker}
              label="设置锚点"
              onClick={() => { onSetAnchorMode?.(); setExpandedTool(null); }}
              variant="blue"
            />
            <SubButton
              icon={Icons.focus}
              label="跳转到锚点"
              onClick={() => { onJumpToAnchor?.(); setExpandedTool(null); }}
              variant="green"
            />
            <SubButton
              icon={Icons.trash}
              label="清除锚点"
              onClick={() => { onClearAnchor?.(); setExpandedTool(null); }}
              variant="red"
            />
          </div>
        );

      case "terrain":
        return (
          <div className="sub-menu terrain-menu">
            <SubButton
              icon={Icons.brush}
              label="绘制地形"
              active={terrainMode === "brush"}
              onClick={() => onTerrainModeChange?.("brush")}
              variant="blue"
            />
            <SubButton
              icon={Icons.eraser}
              label="擦除地形"
              active={terrainMode === "eraser"}
              onClick={() => onTerrainModeChange?.("eraser")}
              variant="red"
            />
            <div className="terrain-type-grid">
              {[
                { type: "difficult", icon: "🪨", color: "#92400e" },
                { type: "hazardous", icon: "🔥", color: "#dc2626" },
                { type: "water_shallow", icon: "💧", color: "#38bdf8" },
                { type: "water_deep", icon: "🌊", color: "#1e40af" },
                { type: "impassable", icon: "🚫", color: "#374151" },
                { type: "lightly_obscured", icon: "🌫️", color: "#9ca3af" },
                { type: "heavily_obscured", icon: "🌑", color: "#4b5563" },
                { type: "half_cover", icon: "🛡️", color: "#d97706" },
                { type: "three_quarter_cover", icon: "🏰", color: "#b45309" },
              ].map(t => (
                <button
                  key={t.type}
                  className={`terrain-type-btn ${terrainType === t.type ? 'active' : ''}`}
                  style={{ borderColor: terrainType === t.type ? t.color : undefined }}
                  onClick={() => { onTerrainTypeChange?.(t.type); onTerrainModeChange?.("brush"); }}
                  title={t.type}
                >
                  {t.icon}
                </button>
              ))}
            </div>
            <div className="stroke-slider">
              <label>{terrainBrushSize}格</label>
              <input
                type="range"
                min="1"
                max="5"
                value={terrainBrushSize}
                onChange={(e) => onTerrainBrushSizeChange?.(parseInt(e.target.value))}
              />
            </div>
            <div className="sub-divider" />
            <SubButton
              icon={showTerrainToPlayers ? Icons.focus : Icons.fog}
              label={showTerrainToPlayers ? "玩家可见" : "玩家不可见"}
              active={showTerrainToPlayers}
              onClick={() => onShowTerrainToPlayersChange?.(!showTerrainToPlayers)}
              variant="green"
            />
            <SubButton
              icon={Icons.clearAll}
              label="清除全部"
              onClick={() => { onClearAllTerrain?.(); setExpandedTool(null); }}
              variant="red"
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="toolbar-v2" ref={toolbarRef}>
        <div className="toolbar-main">
          {tools.map((tool) => (
            <div key={tool.id} className="tool-wrapper">
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    className={`tool-btn ${selectedTool === tool.id ? 'active' : ''}`}
                    onClick={() => handleToolClick(tool.id)}
                  >
                    <span className="tool-icon">{tool.icon}</span>
                    {expandedTool === tool.id && (
                      <span className="expand-indicator" />
                    )}
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content side="right" className="tooltip-content">
                    {tool.label}
                    <Tooltip.Arrow className="tooltip-arrow" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>

              {expandedTool === tool.id && renderSubMenu(tool.id)}
            </div>
          ))}
        </div>

        {onFocusMyToken && (
          <>
            <div className="toolbar-divider" />
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button className="tool-btn focus-btn" onClick={
                  hasMyTokenOnMap ? onFocusMyToken : (onPlaceMyTokenAtCenter || onFocusMyToken)
                }>
                  <span className="tool-icon">
                    {hasMyTokenOnMap ? Icons.focus : Icons.placeMyToken}
                  </span>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" className="tooltip-content">
                  {hasMyTokenOnMap ? "聚焦我的Token" : "放置Token到视野中心"}
                  <Tooltip.Arrow className="tooltip-arrow" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </>
        )}

        {/* AI标记显示/隐藏按钮 - 仅DM可见 */}
        {isDM && onShowAIMarkersChange && (
          <>
            <div className="toolbar-divider" />
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  className={`tool-btn ai-marker-btn ${showAIMarkers ? 'active' : ''}`}
                  onClick={() => onShowAIMarkersChange(!showAIMarkers)}
                >
                  <span className="tool-icon">{Icons.aiMarker}</span>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" className="tooltip-content">
                  {showAIMarkers ? '隐藏AI标记' : '显示AI标记'}
                  <Tooltip.Arrow className="tooltip-arrow" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </>
        )}

        <style>{`
          .toolbar-v2 {
            display: flex;
            flex-direction: column;
            padding: 8px;
            gap: 8px;
            background: transparent;
            height: auto;
            pointer-events: auto;
          }

          .toolbar-main {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .tool-wrapper {
            position: relative;
          }

          .tool-btn {
            position: relative;
            width: 44px;
            height: 44px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(145deg, #374151, #1f2937);
            border: 1px solid #4b5563;
            color: #9ca3af;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.05),
              0 2px 8px rgba(0,0,0,0.4);
          }

          .tool-btn:hover {
            background: linear-gradient(145deg, #4b5563, #374151);
            border-color: #6b7280;
            color: #e5e7eb;
            transform: translateY(-1px);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.08),
              0 4px 12px rgba(0,0,0,0.5);
          }

          .tool-btn.active {
            background: linear-gradient(145deg, #f59e0b, #d97706);
            border-color: #fbbf24;
            color: #fff;
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.2),
              0 0 12px rgba(245,158,11,0.4),
              0 2px 8px rgba(0,0,0,0.4);
          }

          .tool-btn:active {
            transform: translateY(0);
            box-shadow:
              inset 0 2px 4px rgba(0,0,0,0.3),
              0 1px 2px rgba(0,0,0,0.2);
          }

          .tool-icon {
            width: 22px;
            height: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .tool-icon svg {
            width: 20px;
            height: 20px;
          }

          .expand-indicator {
            position: absolute;
            right: 4px;
            top: 50%;
            transform: translateY(-50%);
            width: 4px;
            height: 4px;
            background: #fbbf24;
            border-radius: 50%;
            box-shadow: 0 0 6px #fbbf24;
          }

          .toolbar-divider {
            height: 1px;
            background: linear-gradient(90deg, transparent, #4b5563, transparent);
            margin: 4px 0;
          }

          .focus-btn {
            background: linear-gradient(145deg, #1e40af, #1e3a8a);
            border-color: #3b82f6;
            color: #93c5fd;
          }

          .focus-btn:hover {
            background: linear-gradient(145deg, #2563eb, #1e40af);
            border-color: #60a5fa;
            color: #bfdbfe;
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.1),
              0 0 12px rgba(59,130,246,0.3),
              0 4px 12px rgba(0,0,0,0.4);
          }

          .ai-marker-btn {
            background: linear-gradient(145deg, #374151, #1f2937);
            border-color: #4b5563;
            color: #9ca3af;
          }

          .ai-marker-btn:hover {
            background: linear-gradient(145deg, #4b5563, #374151);
            border-color: #f59e0b;
            color: #fbbf24;
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.1),
              0 0 12px rgba(245,158,11,0.3),
              0 4px 12px rgba(0,0,0,0.4);
          }

          .ai-marker-btn.active {
            background: linear-gradient(145deg, #b45309, #92400e);
            border-color: #f59e0b;
            color: #fef3c7;
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.15),
              0 0 12px rgba(245,158,11,0.4),
              0 2px 8px rgba(0,0,0,0.4);
          }

          /* Mobile styles */
          @media (max-width: 768px) {
            .toolbar-v2 {
              padding: 4px;
              gap: 6px;
            }

            .toolbar-main {
              gap: 8px;
            }

            .tool-btn {
              width: 36px;
              height: 36px;
              border-radius: 8px;
            }

            .tool-icon {
              width: 18px;
              height: 18px;
            }

            .tool-icon svg {
              width: 16px;
              height: 16px;
            }
          }

          /* Sub Menu Styles */
          .sub-menu {
            position: absolute;
            left: 100%;
            top: 0;
            margin-left: 8px;
            background: #1f2937;
            border: 1px solid #4b5563;
            border-radius: 12px;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 52px;
            box-shadow:
              0 8px 24px rgba(0,0,0,0.4),
              0 0 1px rgba(0,0,0,0.1);
            z-index: 1000;
          }

          .marker-menu {
            min-width: 160px;
            padding: 12px;
          }

          .sub-divider {
            height: 1px;
            background: linear-gradient(90deg, transparent, #4b5563, transparent);
            margin: 4px 0;
          }

          /* Sub Button */
          .sub-btn {
            width: 44px;
            height: 44px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(145deg, #374151, #1f2937);
            border: 1px solid #4b5563;
            color: #9ca3af;
            transition: all 0.15s ease;
          }

          .sub-btn:hover {
            background: linear-gradient(145deg, #4b5563, #374151);
            border-color: #6b7280;
            color: #e5e7eb;
            transform: scale(1.05);
          }

          .sub-btn.active {
            color: #fff;
            transform: scale(1.05);
          }

          .sub-btn.active.blue {
            background: linear-gradient(145deg, #2563eb, #1d4ed8);
            border-color: #3b82f6;
            box-shadow: 0 0 10px rgba(59,130,246,0.4);
          }

          .sub-btn.active.red {
            background: linear-gradient(145deg, #dc2626, #b91c1c);
            border-color: #ef4444;
            box-shadow: 0 0 10px rgba(239,68,68,0.4);
          }

          .sub-btn.active.green {
            background: linear-gradient(145deg, #16a34a, #15803d);
            border-color: #22c55e;
            box-shadow: 0 0 10px rgba(34,197,94,0.4);
          }

          .sub-btn.active.purple {
            background: linear-gradient(145deg, #9333ea, #7e22ce);
            border-color: #a855f7;
            box-shadow: 0 0 10px rgba(168,85,247,0.4);
          }

          .sub-btn.active.orange {
            background: linear-gradient(145deg, #ea580c, #c2410c);
            border-color: #f97316;
            box-shadow: 0 0 12px rgba(249,115,22,0.4);
          }

          .sub-btn.amber {
            background: linear-gradient(145deg, #92400e, #78350f);
            border-color: #b45309;
            color: #fbbf24;
          }

          .sub-btn.amber:hover {
            background: linear-gradient(145deg, #b45309, #92400e);
            border-color: #d97706;
            box-shadow: 0 0 10px rgba(251,191,36,0.3);
          }

          .sub-icon {
            width: 20px;
            height: 20px;
          }

          /* Color Picker */
          .color-picker {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          .color-picker label,
          .stroke-slider label,
          .marker-icons label {
            font-size: 10px;
            color: #9ca3af;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .color-picker input[type="color"] {
            width: 100%;
            height: 28px;
            border-radius: 6px;
            border: 1px solid #4b5563;
            background: #111827;
            cursor: pointer;
            padding: 2px;
          }

          .color-picker input[type="color"]::-webkit-color-swatch-wrapper {
            padding: 2px;
          }

          .color-picker input[type="color"]::-webkit-color-swatch {
            border-radius: 4px;
            border: none;
          }

          /* Stroke Slider */
          .stroke-slider {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          .stroke-slider input[type="range"] {
            -webkit-appearance: none;
            width: 100%;
            height: 6px;
            border-radius: 3px;
            background: #374151;
            outline: none;
          }

          .stroke-slider input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: linear-gradient(145deg, #f59e0b, #d97706);
            cursor: pointer;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          }

          /* Marker Icons Grid */
          .marker-icons {
            margin-bottom: 8px;
          }

          .icon-grid {
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            gap: 4px;
            margin-top: 6px;
          }

          .icon-btn {
            width: 24px;
            height: 24px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            background: #111827;
            border: 1px solid #4b5563;
            transition: all 0.15s ease;
            cursor: pointer;
          }

          .icon-btn:hover {
            background: #374151;
            border-color: #6b7280;
            transform: scale(1.1);
          }

          .icon-btn.active {
            background: linear-gradient(145deg, #f59e0b, #d97706);
            border-color: #fbbf24;
            box-shadow: 0 0 8px rgba(245,158,11,0.4);
          }

          /* Terrain Type Grid */
          .terrain-menu {
            min-width: 140px;
            padding: 8px;
          }

          .terrain-type-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 4px;
            margin: 4px 0;
          }

          .terrain-type-btn {
            width: 36px;
            height: 36px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            background: #111827;
            border: 2px solid #4b5563;
            transition: all 0.15s ease;
            cursor: pointer;
          }

          .terrain-type-btn:hover {
            background: #374151;
            transform: scale(1.1);
          }

          .terrain-type-btn.active {
            background: #1f2937;
            border-width: 2px;
            box-shadow: 0 0 8px rgba(255,255,255,0.15);
          }

          /* Tooltip */
          .tooltip-content {
            background: #1f2937;
            border: 1px solid #4b5563;
            color: #e5e7eb;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 500;
            box-shadow: 0 8px 16px rgba(0,0,0,0.4);
            animation: tooltipIn 0.15s ease;
          }

          @keyframes tooltipIn {
            from {
              opacity: 0;
              transform: translateX(-4px);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }

          .tooltip-arrow {
            fill: #1f2937;
          }
        `}</style>
      </div>
    </Tooltip.Provider>
  );
}

interface SubButtonProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  variant?: "blue" | "red" | "green" | "purple" | "orange" | "amber";
}

function SubButton({ icon, label, active, onClick, variant }: SubButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          className={`sub-btn ${active ? 'active' : ''} ${variant || ''}`}
          onClick={onClick}
        >
          <span className="sub-icon">{icon}</span>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="right" className="tooltip-content">
          {label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
