import { useEffect, useState, lazy, Suspense } from "react";
import type { HotbarSlot } from "~/components/character/CharacterDisplay/types/Character";
import type { Token } from "./types/TacticalMapTypes";
import type { WorldTime } from "~/utils/timeUtils";

interface PlayerAvatar {
  id: number | string;  // character_id 或 monster_instance_id（带前缀 "m_"）
  name: string;
  avatar_url?: string;
  isOnline?: boolean;
  type?: 'player' | 'monster';  // 区分玩家角色和怪物
}

export interface MapTransform {
  rotation: number;      // 0, 90, 180, 270
  flipH: boolean;        // 水平翻转
  flipV: boolean;        // 垂直翻转
}

interface TacticalMapProps {
  campaignId: string;
  isDM: boolean;
  selectedTool: string;
  showGrid: boolean;
  showFogOfWar: boolean;
  currentMapUrl?: string | null;
  userId?: string;
  selectedCharacterId?: number | null;
  onFocusMyToken?: () => void;
  mapImageScale?: number;
  mapTransform?: MapTransform;
  fogMode?: "brush" | "eraser"; // 迷雾绘制模式
  fogBrushSize?: number; // 迷雾笔刷大小
  // 地形工具
  terrainType?: string;
  terrainMode?: "brush" | "eraser";
  terrainBrushSize?: number;
  showTerrainToPlayers?: boolean;
  globalTerrain?: string | null;
  rulerMode?: "measure" | "circle" | "erase" | null; // 测距模式
  drawTool?: "circle" | "sketch" | "arrow" | "eraser" | null; // 绘图工具
  drawColor?: string; // 绘图颜色
  drawStrokeWidth?: number; // 绘图笔宽
  onDrawStrokeWidthChange?: (width: number) => void; // 绘图笔宽变更回调
  gridUnitLength?: number; // Grid unit length in pixels
  markerIcon?: string; // 标记图标
  markerColor?: string; // 标记颜色
  tokenMode?: "place" | "delete"; // Token模式
  showAIMarkers?: boolean; // 是否显示AI标记
  onGridUnitLengthClick?: () => void; // DM点击设置网格单位长度
  playerAvatars?: PlayerAvatar[]; // 玩家角色头像
  isTransitioning?: boolean; // 是否正在切换角色/地图
  drawingsRefreshVersion?: number;
  rightSidebarWidth?: number;
  showRightSidebar?: boolean;
  isResizing?: boolean;
  // 快捷栏瞄准模式
  hotbarTargeting?: {
    slot: HotbarSlot;
    sourceCharacterId: number;
    targetingType?: 'attack' | 'ability' | 'spell';
    abilityData?: { abilityId: string; poolCurrent: number; poolMax: number };
    spellData?: {
      spell: any;
      slotLevel: number;
      sourceTokenId: number;
      illusionImageUrl?: string;
      illusionDesc?: string;
      illusionDisplayName?: string;
      selectedOption?: string;
      materialId?: string;
      ritualCast?: boolean;
      runtimeAction?: Record<string, any>;
      longCast?: boolean;
      confirmBreakConcentration?: boolean;
    };
  } | null;
  onHotbarTargetSelect?: (targetTokenId: number, targetName: string, distanceFeet: number, targetExtra?: {
    currentHp?: number; maxHp?: number; monsterType?: string;
  }) => void;
  onHotbarTargetCancel?: () => void;
  onTrade?: (sourceCharacterId: number, targetToken: Token) => void;
  onLayOnHands?: (sourceCharacterId: number, targetToken: Token, distanceFeet: number, poolCurrent: number, poolMax: number) => void;
  onStartSpellTargeting?: (data: {
    spell: any;
    slotLevel: number;
    sourceTokenId: number;
    characterId: number;
    freecast?: boolean;
    ritualCast?: boolean;
    illusionImageUrl?: string;
    illusionDesc?: string;
    illusionDisplayName?: string;
    selectedOption?: string;
    materialId?: string;
    runtimeAction?: Record<string, any>;
    longCast?: boolean;
    confirmBreakConcentration?: boolean;
  }) => void;
  timeOfDay?: WorldTime;
}

// 动态导入客户端组件
const TacticalMapClient = lazy(() =>
  import("./TacticalMap.client").then((mod) => ({
    default: mod.TacticalMapClient,
  }))
);

export function TacticalMap(props: TacticalMapProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-950">
        <div className="text-gray-400">加载地图中...</div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="w-full h-full flex items-center justify-center bg-gray-950">
          <div className="text-gray-400">加载地图中...</div>
        </div>
      }
    >
      <TacticalMapClient {...props} />
    </Suspense>
  );
}
