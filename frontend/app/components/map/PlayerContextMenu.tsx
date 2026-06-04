/**
 * PlayerContextMenu - Right-click context menu for players
 * Supports: Move token, Cast spells, Use abilities, Toggle reactions
 */
import { useState, useEffect, useRef } from "react";
import { getAssetUrl } from "~/utils/asset-url";

interface SpellInfo {
  id: string;
  name: string;
  nameEn?: string;
  level: number;
  range: string;
  castingTime: string;
  school?: string;
  description?: string;
  iconPath?: string;
}

interface ActionInfo {
  id: string;
  name: string;
  action_type: string;
  description?: string;
  uses?: { current: number; max: number; recharge?: string };
}

interface ReactionInfo {
  id: string;
  name: string;
  icon: string;
  color: string;
  description?: string;
  armed: boolean;  // 是否已准备
  usesRemaining: number;  // 本轮剩余次数
  usesPerRound: number;   // 每轮可用次数
}

interface SpellSlots {
  [level: number]: { current: number; max: number };
}

interface PlayerContextMenuProps {
  x: number;
  y: number;
  gridX: number;
  gridY: number;
  mode: "ground" | "self"; // ground: 点击空白处, self: 点击自己token
  onClose: () => void;
  onMove: (gridX: number, gridY: number) => void;
  onCastSpell: (spell: SpellInfo) => void;
  onUseAbility: (ability: ActionInfo) => void;
  onToggleReaction?: (reactionId: string, armed: boolean) => void;
  onSettleZoneSpells?: () => void;  // 结算环境法术
  preparedSpells: SpellInfo[];
  cantrips: SpellInfo[];
  abilities: ActionInfo[];
  spellSlots: SpellSlots;
  reactions?: ReactionInfo[];
  hasActiveZoneSpells?: boolean;  // 是否有活跃的环境法术
}

// 判断法术是否可以对自己使用
function canCastOnSelf(spell: SpellInfo): boolean {
  const range = spell.range?.trim() || "";
  return range === "自身" || range.startsWith("自身") || range === "触及";
}

// 判断法术是否可以对目标位置使用（非自身法术）
function canCastOnTarget(spell: SpellInfo): boolean {
  const range = spell.range?.trim() || "";
  return !range.startsWith("自身") || range.includes("尺");
}

export function PlayerContextMenu({
  x, y, gridX, gridY, mode, onClose, onMove, onCastSpell, onUseAbility, onToggleReaction, onSettleZoneSpells,
  preparedSpells, cantrips, abilities, spellSlots, reactions = [], hasActiveZoneSpells = false
}: PlayerContextMenuProps) {
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 根据模式筛选法术
  const filteredSpells = mode === "self"
    ? [...cantrips, ...preparedSpells].filter(canCastOnSelf)
    : [...cantrips, ...preparedSpells].filter(canCastOnTarget);

  // 筛选可用技能（有次数限制且还有剩余次数的）
  const usableAbilities = abilities.filter(a =>
    a.uses && a.uses.current > 0
  );

  // 按法术等级分组
  const spellsByLevel: { [level: number]: SpellInfo[] } = {};
  filteredSpells.forEach(spell => {
    const lvl = spell.level || 0;
    if (!spellsByLevel[lvl]) spellsByLevel[lvl] = [];
    spellsByLevel[lvl].push(spell);
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Use setTimeout to avoid immediate close on the same touch that opened the menu
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const adjustedX = Math.min(x, window.innerWidth - 240);
  const adjustedY = Math.min(y, window.innerHeight - 350);

  const handleSpellClick = (spell: SpellInfo) => {
    onCastSpell(spell);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed bg-gray-900 border border-gray-600 rounded-lg shadow-xl z-[10000] min-w-[200px]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-700">
        {mode === "self" ? "对自己" : `目标: (${gridX}, ${gridY})`}
      </div>

      {/* 移动选项 - 只在地面模式显示 */}
      {mode === "ground" && (
        <div
          className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm text-gray-200 flex items-center gap-2"
          onClick={() => { onMove(gridX, gridY); onClose(); }}
        >
          <span>🚶</span>
          <span>移动到此处</span>
        </div>
      )}

      {/* 施法选项 */}
      {filteredSpells.length > 0 && (
        <div
          className="relative"
          onMouseEnter={() => setActiveSubmenu("spells")}
          onMouseLeave={() => setActiveSubmenu(null)}
        >
          <div className="px-3 py-2 hover:bg-gray-700 cursor-pointer flex items-center justify-between text-sm text-gray-200">
            <span className="flex items-center gap-2">
              <span>✨</span>
              <span>施放法术</span>
            </span>
            <span className="text-gray-500">▶</span>
          </div>
          {activeSubmenu === "spells" && (
            <div className="absolute left-full top-0 bg-gray-900 border border-gray-600 rounded-lg shadow-xl min-w-[220px] max-h-[350px] overflow-y-auto">
              {Object.entries(spellsByLevel)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([level, spells]) => (
                  <div key={level}>
                    <div className="px-3 py-1 text-xs text-gray-500 bg-gray-800 sticky top-0">
                      {Number(level) === 0 ? "戏法" : `${level}环`}
                      {Number(level) > 0 && spellSlots[Number(level)] && (
                        <span className="ml-2">
                          ({spellSlots[Number(level)].current}/{spellSlots[Number(level)].max})
                        </span>
                      )}
                    </div>
                    {spells.map(spell => {
                      return (
                        <div key={spell.id}>
                          <div
                            className="px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-700 cursor-pointer text-gray-200"
                            onClick={() => handleSpellClick(spell)}
                          >
                            {spell.iconPath && (
                              <img src={getAssetUrl(spell.iconPath.replace(/^\//, ''))} alt="" className="w-5 h-5 rounded" />
                            )}
                            <span>{spell.name}</span>
                            <span className="ml-auto text-xs text-gray-500">{spell.range}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* 技能选项 - 只在自身模式显示 */}
      {mode === "self" && usableAbilities.length > 0 && (
        <div
          className="relative"
          onMouseEnter={() => setActiveSubmenu("abilities")}
          onMouseLeave={() => setActiveSubmenu(null)}
        >
          <div className="px-3 py-2 hover:bg-gray-700 cursor-pointer flex items-center justify-between text-sm text-gray-200">
            <span className="flex items-center gap-2">
              <span>⚡</span>
              <span>使用技能</span>
            </span>
            <span className="text-gray-500">▶</span>
          </div>
          {activeSubmenu === "abilities" && (
            <div className="absolute left-full top-0 bg-gray-900 border border-gray-600 rounded-lg shadow-xl min-w-[200px] max-h-[300px] overflow-y-auto">
              {usableAbilities.map(ability => (
                <div
                  key={ability.id}
                  className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm text-gray-200"
                  onClick={() => { onUseAbility(ability); onClose(); }}
                >
                  <div className="flex items-center justify-between">
                    <span>{ability.name}</span>
                    {ability.uses && (
                      <span className="text-xs text-gray-500">
                        {ability.uses.current}/{ability.uses.max}
                      </span>
                    )}
                  </div>
                  {ability.description && (
                    <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {ability.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 反应选项 - 只在自身模式显示 */}
      {mode === "self" && reactions.length > 0 && (
        <div
          className="relative"
          onMouseEnter={() => setActiveSubmenu("reactions")}
          onMouseLeave={() => setActiveSubmenu(null)}
        >
          <div className="px-3 py-2 hover:bg-gray-700 cursor-pointer flex items-center justify-between text-sm text-gray-200">
            <span className="flex items-center gap-2">
              <span>⚡</span>
              <span>准备反应</span>
            </span>
            <span className="text-gray-500">▶</span>
          </div>
          {activeSubmenu === "reactions" && (
            <div className="absolute left-full top-0 bg-gray-900 border border-gray-600 rounded-lg shadow-xl min-w-[220px] max-h-[300px] overflow-y-auto">
              <div className="px-3 py-1 text-xs text-gray-500 border-b border-gray-700">
                勾选后，被攻击命中时自动触发
              </div>
              {reactions.map(reaction => {
                const canUse = reaction.usesRemaining > 0;
                return (
                  <div
                    key={reaction.id}
                    className={`px-3 py-2 text-sm flex items-center gap-2 ${
                      canUse ? "hover:bg-gray-700 cursor-pointer" : "opacity-50 cursor-not-allowed"
                    }`}
                    onClick={() => {
                      if (canUse && onToggleReaction) {
                        onToggleReaction(reaction.id, !reaction.armed);
                      }
                    }}
                  >
                    {/* 勾选框 */}
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center ${
                        reaction.armed
                          ? "bg-indigo-500 border-indigo-500"
                          : "border-gray-500"
                      }`}
                    >
                      {reaction.armed && <span className="text-white text-xs">✓</span>}
                    </div>
                    {/* 图标和名称 */}
                    <span style={{ color: reaction.color }}>{reaction.icon}</span>
                    <span className={reaction.armed ? "text-indigo-300" : "text-gray-200"}>
                      {reaction.name}
                    </span>
                    {/* 次数 */}
                    <span className="ml-auto text-xs text-gray-500">
                      {reaction.usesRemaining}/{reaction.usesPerRound}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 无可用选项提示 */}
      {filteredSpells.length === 0 && (mode !== "self" || usableAbilities.length === 0) && mode === "self" && (
        <div className="px-3 py-2 text-sm text-gray-500">
          暂无可用法术或技能
        </div>
      )}

      {/* 环境法术结算选项 - 只在自身模式且有活跃环境法术时显示 */}
      {mode === "self" && hasActiveZoneSpells && onSettleZoneSpells && (
        <div
          className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm text-gray-200 flex items-center gap-2 border-t border-gray-700"
          onClick={() => { onSettleZoneSpells(); onClose(); }}
        >
          <span>🌫️</span>
          <span>结算环境法术</span>
        </div>
      )}

      {/* 取消 */}
      <div className="border-t border-gray-700">
        <div
          className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm text-gray-400"
          onClick={onClose}
        >
          取消
        </div>
      </div>
    </div>
  );
}
