import type { MonsterActionCursorInfo, MonsterActionTargetingState } from "./hooks/useMapCombatOverlays";
import type { HotbarCursorInfo } from "./hooks/useMapTargetingController";
import type { TacticalMapProps } from "./types/TacticalMapTypes";
import { getTargetingRangeState, resolveHotbarRange } from "./utils/mapTargetingUtils";

type AreaSpellModeState = {
  spell?: { name?: string | null } | null;
  placingOrigin?: boolean;
  shapeType?: string;
  originPos?: { x: number; y: number } | null;
} | null;

type InvokeDuplicityPlacementState = {
  positions: Array<{ x: number; y: number }>;
  requestedCount: number;
} | null;

interface MapTargetingHudProps {
  hotbarTargeting: TacticalMapProps["hotbarTargeting"];
  hotbarCursorInfo: HotbarCursorInfo | null;
  monsterActionTargeting: MonsterActionTargetingState | null;
  monsterActionCursorInfo: MonsterActionCursorInfo | null;
  invokeDuplicityPlacementMode: InvokeDuplicityPlacementState;
  areaSpellMode: AreaSpellModeState;
  isReadyToCast: boolean;
  onHotbarTargetCancel?: () => void;
  onInvokeDuplicityPlacementUndo: () => void;
  onInvokeDuplicityCreate: () => void;
  onInvokeDuplicityPlacementCancel: () => void;
  onAreaSpellCast: () => void;
  onAreaSpellCancel: () => void;
}

function HotbarCursorBadge({
  hotbarTargeting,
  hotbarCursorInfo,
}: {
  hotbarTargeting: NonNullable<TacticalMapProps["hotbarTargeting"]>;
  hotbarCursorInfo: HotbarCursorInfo;
}) {
  const dist = hotbarCursorInfo.dist;
  const { normalR, maxR } = resolveHotbarRange(hotbarTargeting.slot, hotbarTargeting.targetingType);
  const { inNormal, inLong, outOfRange } = getTargetingRangeState(dist, normalR, maxR);
  const isSpell = hotbarTargeting.targetingType === "spell";
  const isAbility = hotbarTargeting.targetingType === "ability";

  const bgClass = isSpell
    ? (inNormal
        ? "bg-purple-900/90 text-purple-200 border border-purple-600/60"
        : "bg-red-900/90 text-red-300 border border-red-700/60")
    : isAbility
      ? (inNormal
          ? "bg-emerald-900/90 text-emerald-300 border border-emerald-700/60"
          : "bg-red-900/90 text-red-300 border border-red-700/60")
      : inNormal
        ? "bg-green-900/90 text-green-300 border border-green-700/60"
        : inLong
          ? "bg-yellow-900/90 text-yellow-300 border border-yellow-700/60"
          : "bg-red-900/90 text-red-300 border border-red-700/60";

  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium shadow-lg ${bgClass}`}>
      {hotbarTargeting.slot.name} {Math.round(dist)}尺
      {inLong && <span className="ml-1 text-yellow-400">远程劣势</span>}
      {outOfRange && normalR < 999 && <span className="ml-1 text-red-400">超出射程(最大{maxR}尺)</span>}
    </span>
  );
}

function MonsterActionCursorBadge({
  monsterActionTargeting,
  monsterActionCursorInfo,
}: {
  monsterActionTargeting: MonsterActionTargetingState;
  monsterActionCursorInfo: MonsterActionCursorInfo;
}) {
  const dist = monsterActionCursorInfo.dist;
  const { inNormal, inLong, outOfRange } = getTargetingRangeState(
    dist,
    monsterActionTargeting.normalRange,
    monsterActionTargeting.maxRange,
  );
  const bgClass = inNormal
    ? "bg-amber-900/90 text-amber-200 border border-amber-600/60"
    : inLong
      ? "bg-yellow-900/90 text-yellow-300 border border-yellow-700/60"
      : "bg-gray-900/90 text-red-400 border border-red-700/60";

  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium shadow-lg ${bgClass}`}>
      {monsterActionTargeting.action.name} {Math.round(dist)}尺
      {inLong && <span className="ml-1 text-yellow-400">远程劣势</span>}
      {outOfRange && monsterActionTargeting.normalRange < 999 && (
        <span className="ml-1 text-red-400">超出射程(最大{monsterActionTargeting.maxRange}尺)</span>
      )}
    </span>
  );
}

export function MapTargetingHud({
  hotbarTargeting,
  hotbarCursorInfo,
  monsterActionTargeting,
  monsterActionCursorInfo,
  invokeDuplicityPlacementMode,
  areaSpellMode,
  isReadyToCast,
  onHotbarTargetCancel,
  onInvokeDuplicityPlacementUndo,
  onInvokeDuplicityCreate,
  onInvokeDuplicityPlacementCancel,
  onAreaSpellCast,
  onAreaSpellCancel,
}: MapTargetingHudProps) {
  return (
    <>
      {hotbarTargeting && (
        <button
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[301] px-4 py-2 rounded-full bg-red-600/90 hover:bg-red-500 text-white text-sm font-medium shadow-lg backdrop-blur-sm flex items-center gap-2 border border-red-500/50"
          onClick={() => onHotbarTargetCancel?.()}
        >
          <span>✕</span>
          <span>取消{hotbarTargeting.targetingType === "spell" ? "施法" : "攻击"}</span>
          <span className="text-xs opacity-70 hidden sm:inline">(ESC)</span>
        </button>
      )}

      {invokeDuplicityPlacementMode && !hotbarTargeting && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[301] flex items-center gap-2">
          <div className="px-4 py-2 rounded-full bg-black/70 text-white text-sm font-medium shadow-lg backdrop-blur-sm border border-white/20">
            诡术通道
            <span className="ml-2 opacity-80">
              点击地图放置分身 {invokeDuplicityPlacementMode.positions.length}/{invokeDuplicityPlacementMode.requestedCount}
            </span>
          </div>
          <button
            className="px-3 py-2 rounded-full bg-gray-700/90 hover:bg-gray-600 text-white text-sm shadow-lg backdrop-blur-sm border border-gray-500/50 disabled:opacity-40"
            onClick={onInvokeDuplicityPlacementUndo}
            disabled={invokeDuplicityPlacementMode.positions.length === 0}
          >
            撤销
          </button>
          <button
            className="px-4 py-2 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold shadow-lg backdrop-blur-sm border border-indigo-400/50 disabled:opacity-40"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onInvokeDuplicityCreate();
            }}
            disabled={invokeDuplicityPlacementMode.positions.length !== invokeDuplicityPlacementMode.requestedCount}
          >
            创建分身
          </button>
          <button
            className="px-3 py-2 rounded-full bg-gray-700/90 hover:bg-gray-600 text-white text-sm shadow-lg backdrop-blur-sm border border-gray-500/50"
            onClick={onInvokeDuplicityPlacementCancel}
          >
            取消
          </button>
        </div>
      )}

      {areaSpellMode && !hotbarTargeting && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[301] flex items-center gap-2">
          <div className="px-4 py-2 rounded-full bg-black/70 text-white text-sm font-medium shadow-lg backdrop-blur-sm border border-white/20">
            {areaSpellMode.spell?.name}
            <span className="ml-2 opacity-80">
              {areaSpellMode.placingOrigin
                ? "点击地图选择起点"
                : isReadyToCast
                  ? "滑动可调整"
                  : (areaSpellMode.shapeType === "cone" || areaSpellMode.shapeType === "line") && areaSpellMode.originPos
                    ? "滑动选择方向"
                    : "点击地图选择位置"}
            </span>
          </div>
          {isReadyToCast && (
            <button
              className="px-4 py-2 rounded-full bg-red-600 hover:bg-red-500 text-white text-sm font-bold shadow-lg backdrop-blur-sm border border-red-400/50 animate-pulse"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onAreaSpellCast();
              }}
            >
              施法
            </button>
          )}
          <button
            className="px-3 py-2 rounded-full bg-gray-700/90 hover:bg-gray-600 text-white text-sm shadow-lg backdrop-blur-sm border border-gray-500/50"
            onClick={onAreaSpellCancel}
          >
            取消
          </button>
        </div>
      )}

      {hotbarTargeting && hotbarCursorInfo && (
        <div
          className="fixed pointer-events-none z-[300]"
          style={{ left: hotbarCursorInfo.x + 18, top: hotbarCursorInfo.y - 12 }}
        >
          <HotbarCursorBadge hotbarTargeting={hotbarTargeting} hotbarCursorInfo={hotbarCursorInfo} />
        </div>
      )}

      {monsterActionTargeting && monsterActionCursorInfo && (
        <div
          className="fixed pointer-events-none z-[300]"
          style={{ left: monsterActionCursorInfo.x + 18, top: monsterActionCursorInfo.y - 12 }}
        >
          <MonsterActionCursorBadge
            monsterActionTargeting={monsterActionTargeting}
            monsterActionCursorInfo={monsterActionCursorInfo}
          />
        </div>
      )}
    </>
  );
}
