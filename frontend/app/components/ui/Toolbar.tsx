import * as Tooltip from "@radix-ui/react-tooltip";
import { useState } from "react";

interface ToolbarProps {
  selectedTool: string;
  onToolChange: (tool: string) => void;
  onFocusMyToken?: () => void;
  fogMode?: "brush" | "eraser"; // 迷雾模式：笔刷或橡皮
  onFogModeChange?: (mode: "brush" | "eraser") => void;
  onFillFogOfWar?: () => void; // 全图迷雾
  onClearFogOfWar?: () => void; // 清除全图迷雾
  rulerMode?: "measure" | "circle" | "erase" | null; // 测距模式
  onRulerModeChange?: (mode: "measure" | "circle" | "erase" | null) => void;
  drawTool?: "circle" | "sketch" | "arrow" | "eraser" | null; // 绘图工具
  onDrawToolChange?: (tool: "circle" | "sketch" | "arrow" | "eraser" | null) => void;
  drawColor?: string; // 绘图颜色
  onDrawColorChange?: (color: string) => void;
  drawStrokeWidth?: number; // 笔宽
  onDrawStrokeWidthChange?: (width: number) => void;
  onUndoLastDrawing?: () => void; // 撤销上一次绘图
  onGridUnitSettingsClick?: () => void; // 打开网格单位设置对话框
  isDM?: boolean; // 是否为DM
  // 地图标记相关
  markerIcon?: string;
  onMarkerIconChange?: (icon: string) => void;
  markerColor?: string;
  onMarkerColorChange?: (color: string) => void;
  onClearAllMarkers?: () => void;
  // Token工具相关
  tokenMode?: "place" | "delete"; // Token模式：放置或删除
  onTokenModeChange?: (mode: "place" | "delete") => void;
}

const allTools = [
  { id: "move", icon: "✋", label: "移动", dmOnly: false },
  { id: "select", icon: "👆", label: "选择", dmOnly: false },
  { id: "ruler", icon: "📏", label: "测距", dmOnly: false },
  { id: "draw", icon: "✏️", label: "绘图", dmOnly: false },
  { id: "marker", icon: "📍", label: "地图标记", dmOnly: true },
  { id: "fog", icon: "🌫️", label: "战争迷雾", dmOnly: true },
  { id: "token", icon: "🎭", label: "添加 Token", dmOnly: true },
];

export function Toolbar({
  selectedTool,
  onToolChange,
  onFocusMyToken,
  fogMode = "brush",
  onFogModeChange,
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
}: ToolbarProps) {
  const [showFogOptions, setShowFogOptions] = useState(false);
  const [showRulerOptions, setShowRulerOptions] = useState(false);
  const [showDrawOptions, setShowDrawOptions] = useState(false);
  const [showDrawSettings, setShowDrawSettings] = useState(false);
  const [showMarkerOptions, setShowMarkerOptions] = useState(false);
  const [showTokenOptions, setShowTokenOptions] = useState(false);

  const markerIcons = ["📍", "⚠️", "💀", "🏠", "⭐", "🔥", "💎", "🗝️", "📦", "🎯", "🚩", "❓"];

  // 根据角色过滤工具
  const tools = isDM ? allTools : allTools.filter(tool => !tool.dmOnly);

  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={100}>
      <div className="flex flex-col gap-2 p-2">
        {tools.map((tool) => (
          <div key={tool.id}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={() => {
                    onToolChange(tool.id);
                    if (tool.id === "fog") {
                      setShowFogOptions(!showFogOptions);
                      setShowRulerOptions(false);
                      setShowDrawOptions(false);
                      setShowMarkerOptions(false);
                      setShowTokenOptions(false);
                    } else if (tool.id === "ruler") {
                      setShowRulerOptions(!showRulerOptions);
                      setShowFogOptions(false);
                      setShowDrawOptions(false);
                      setShowMarkerOptions(false);
                      setShowTokenOptions(false);
                    } else if (tool.id === "draw") {
                      setShowDrawOptions(!showDrawOptions);
                      setShowFogOptions(false);
                      setShowRulerOptions(false);
                      setShowMarkerOptions(false);
                      setShowTokenOptions(false);
                    } else if (tool.id === "marker") {
                      setShowMarkerOptions(!showMarkerOptions);
                      setShowFogOptions(false);
                      setShowRulerOptions(false);
                      setShowDrawOptions(false);
                      setShowTokenOptions(false);
                    } else if (tool.id === "token") {
                      setShowTokenOptions(!showTokenOptions);
                      setShowFogOptions(false);
                      setShowRulerOptions(false);
                      setShowDrawOptions(false);
                      setShowMarkerOptions(false);
                    } else {
                      setShowFogOptions(false);
                      setShowRulerOptions(false);
                      setShowDrawOptions(false);
                      setShowMarkerOptions(false);
                      setShowTokenOptions(false);
                    }
                  }}
                  className={`
                    w-12 h-12 rounded-lg flex items-center justify-center
                    text-2xl transition-colors
                    ${
                      selectedTool === tool.id
                        ? "bg-amber-600 hover:bg-amber-700"
                        : "bg-gray-700 hover:bg-gray-600"
                    }
                  `}
                >
                  {tool.icon}
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="right"
                  className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                >
                  {tool.label}
                  <Tooltip.Arrow className="fill-gray-800" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>

            {/* 战争迷雾子菜单 */}
            {tool.id === "fog" && showFogOptions && (
              <div className="mt-1 bg-gray-800 rounded-lg p-1 space-y-1">
                {/* 笔刷模式 */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => onFogModeChange?.("brush")}
                      className={`
                        w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors
                        ${fogMode === "brush" ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-700 hover:bg-gray-600"}
                      `}
                    >
                      🖌️
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                    >
                      添加迷雾 (笔刷)
                      <Tooltip.Arrow className="fill-gray-800" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>

                {/* 橡皮模式 */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => onFogModeChange?.("eraser")}
                      className={`
                        w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors
                        ${fogMode === "eraser" ? "bg-red-600 hover:bg-red-700" : "bg-gray-700 hover:bg-gray-600"}
                      `}
                    >
                      🧹
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                    >
                      移除迷雾 (橡皮)
                      <Tooltip.Arrow className="fill-gray-800" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>

                {/* 全图迷雾 */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => {
                        onFillFogOfWar?.();
                        setShowFogOptions(false);
                      }}
                      className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors bg-gray-700 hover:bg-gray-600"
                    >
                      ⬛
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                    >
                      全图迷雾
                      <Tooltip.Arrow className="fill-gray-800" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>

                {/* 清除全图迷雾 */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => {
                        onClearFogOfWar?.();
                        setShowFogOptions(false);
                      }}
                      className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors bg-gray-700 hover:bg-gray-600"
                    >
                      ⬜
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                    >
                      清除迷雾
                      <Tooltip.Arrow className="fill-gray-800" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </div>
            )}

            {/* 测距工具子菜单 - 所有用户可见 */}
            {tool.id === "ruler" && showRulerOptions && (
              <div className="mt-1 bg-gray-800 rounded-lg p-1 space-y-1">
                {/* 测量模式 */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => onRulerModeChange?.("measure")}
                      className={`
                        w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors
                        ${rulerMode === "measure" ? "bg-green-600 hover:bg-green-700" : "bg-gray-700 hover:bg-gray-600"}
                      `}
                    >
                      📐
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                    >
                      测量距离
                      <Tooltip.Arrow className="fill-gray-800" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>

                {/* 橡皮模式 */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => onRulerModeChange?.("erase")}
                      className={`
                        w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors
                        ${rulerMode === "erase" ? "bg-red-600 hover:bg-red-700" : "bg-gray-700 hover:bg-gray-600"}
                      `}
                    >
                      🧹
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                    >
                      删除标尺
                      <Tooltip.Arrow className="fill-gray-800" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>

                {/* 设置单位长度 - 仅 DM 可见 */}
                {isDM && (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <button
                        onClick={() => onGridUnitSettingsClick?.()}
                        className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors bg-gray-700 hover:bg-gray-600"
                      >
                        ⚙️
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        side="right"
                        className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                      >
                        设置单位长度
                        <Tooltip.Arrow className="fill-gray-800" />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                )}
              </div>
            )}

            {/* 绘图工具子菜单 */}
            {tool.id === "draw" && showDrawOptions && (
              <div className="mt-1 bg-gray-800 rounded-lg p-1 space-y-1">
                {/* 圆形工具 */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => onDrawToolChange?.("circle")}
                      className={`
                        w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors
                        ${drawTool === "circle" ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-700 hover:bg-gray-600"}
                      `}
                    >
                      ⭕
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                    >
                      画圆
                      <Tooltip.Arrow className="fill-gray-800" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>

                {/* 手绘工具 */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => onDrawToolChange?.("sketch")}
                      className={`
                        w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors
                        ${drawTool === "sketch" ? "bg-purple-600 hover:bg-purple-700" : "bg-gray-700 hover:bg-gray-600"}
                      `}
                    >
                      ✏️
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                    >
                      <div>手绘</div>
                      <div className="text-xs text-gray-400 mt-1">Ctrl+滚轮调整笔宽</div>
                      <Tooltip.Arrow className="fill-gray-800" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>

                {/* 箭头工具 */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => onDrawToolChange?.("arrow")}
                      className={`
                        w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors
                        ${drawTool === "arrow" ? "bg-orange-600 hover:bg-orange-700" : "bg-gray-700 hover:bg-gray-600"}
                      `}
                    >
                      ➡️
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                    >
                      <div>画箭头</div>
                      <div className="text-xs text-gray-400 mt-1">Ctrl+滚轮调整笔宽</div>
                      <Tooltip.Arrow className="fill-gray-800" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>

                {/* 擦除工具 */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => onDrawToolChange?.("eraser")}
                      className={`
                        w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors
                        ${drawTool === "eraser" ? "bg-red-600 hover:bg-red-700" : "bg-gray-700 hover:bg-gray-600"}
                      `}
                    >
                      🗑️
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                    >
                      <div>删除绘图 (拖动删除)</div>
                      <div className="text-xs text-gray-400 mt-1">Ctrl+滚轮调整大小</div>
                      <Tooltip.Arrow className="fill-gray-800" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>

                {/* 分隔线 */}
                <div className="h-px bg-gray-600 my-1" />

                {/* 颜色选择 */}
                <div className="p-1 bg-gray-700 rounded-lg">
                  <label className="text-xs text-gray-300 block mb-1 px-2">颜色</label>
                  <input
                    type="color"
                    value={drawColor}
                    onChange={(e) => onDrawColorChange?.(e.target.value)}
                    className="w-full h-8 rounded cursor-pointer"
                  />
                </div>

                {/* 笔宽设置 */}
                <div className="p-1 bg-gray-700 rounded-lg">
                  <label className="text-xs text-gray-300 block mb-1 px-2">笔宽: {drawStrokeWidth}px</label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={drawStrokeWidth}
                    onChange={(e) => onDrawStrokeWidthChange?.(parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>

                {/* 撤销上一次绘图 */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => {
                        onUndoLastDrawing?.();
                      }}
                      className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors bg-amber-700 hover:bg-amber-600"
                    >
                      ↶
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                    >
                      撤销
                      <Tooltip.Arrow className="fill-gray-800" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </div>
            )}

            {/* 地图标记子菜单 - 弹出框形式 */}
            {tool.id === "marker" && showMarkerOptions && (
              <div className="absolute left-full ml-2 top-0 bg-gray-800 rounded-lg p-2 shadow-xl border border-gray-700 z-50 w-48">
                {/* 图标选择 */}
                <div className="mb-2">
                  <label className="text-xs text-gray-400 block mb-1">图标</label>
                  <div className="grid grid-cols-6 gap-1">
                    {markerIcons.map((icon) => (
                      <button
                        key={icon}
                        onClick={() => onMarkerIconChange?.(icon)}
                        className={`
                          w-6 h-6 rounded flex items-center justify-center text-sm transition-colors
                          ${markerIcon === icon ? "bg-amber-600" : "bg-gray-700 hover:bg-gray-600"}
                        `}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 颜色选择 */}
                <div className="mb-2">
                  <label className="text-xs text-gray-400 block mb-1">颜色</label>
                  <input
                    type="color"
                    value={markerColor}
                    onChange={(e) => onMarkerColorChange?.(e.target.value)}
                    className="w-full h-6 rounded cursor-pointer"
                  />
                </div>

                {/* 清除所有标记 */}
                <button
                  onClick={() => onClearAllMarkers?.()}
                  className="w-full py-1.5 rounded text-xs transition-colors bg-red-700 hover:bg-red-600 flex items-center justify-center gap-1"
                >
                  🗑️ 清除所有
                </button>
              </div>
            )}

            {/* Token工具子菜单 */}
            {tool.id === "token" && showTokenOptions && (
              <div className="mt-1 bg-gray-800 rounded-lg p-1 space-y-1">
                {/* 放置模式 */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => onTokenModeChange?.("place")}
                      className={`
                        w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors
                        ${tokenMode === "place" ? "bg-green-600 hover:bg-green-700" : "bg-gray-700 hover:bg-gray-600"}
                      `}
                    >
                      ➕
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                    >
                      放置Token（右键菜单）
                      <Tooltip.Arrow className="fill-gray-800" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>

                {/* 删除模式 */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => onTokenModeChange?.("delete")}
                      className={`
                        w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors
                        ${tokenMode === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-gray-700 hover:bg-gray-600"}
                      `}
                    >
                      🗑️
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                    >
                      删除Token（点击即删）
                      <Tooltip.Arrow className="fill-gray-800" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </div>
            )}
          </div>
        ))}

        {/* 分隔线 */}
        {onFocusMyToken && (
          <>
            <div className="h-px bg-gray-600 my-1" />

            {/* 聚焦到我的 Token 按钮 */}
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={onFocusMyToken}
                  className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-colors bg-blue-600 hover:bg-blue-700"
                >
                  🎯
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="right"
                  className="bg-gray-800 text-white px-3 py-2 rounded text-sm"
                >
                  聚焦我的Token
                  <Tooltip.Arrow className="fill-gray-800" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </>
        )}
      </div>
    </Tooltip.Provider>
  );
}

