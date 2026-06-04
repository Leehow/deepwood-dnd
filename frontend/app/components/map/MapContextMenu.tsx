/**
 * MapContextMenu - Right-click context menu for DM to place tokens on the map
 */
import { useState, useEffect, useRef } from "react";

interface CampaignItem {
  id: number;
  name: string;
  name_cn?: string;
  category?: string;
  rarity?: string;
  iconPath?: string;
}

interface NPC {
  id: number;
  name: string;
  name_cn?: string;
  avatar_url?: string;
}

interface Shop {
  id: number;
  name: string;
  avatar_url?: string;
}

interface PlayerCharacter {
  id: number | string;
  name: string;
  avatar_url?: string;
}

interface ContextMenuProps {
  x: number;
  y: number;
  gridX: number;
  gridY: number;
  onClose: () => void;
  onPlaceMonster: (monsterId: string, monsterName: string) => void;
  onPlaceCurrency: (type: string, amount: number) => void;
  onPlaceItem: (itemId: string, itemName: string, icon?: string) => void;
  onPlaceNPC: (npcId: string, npcName: string) => void;
  onPlaceShop: (shopId: number, shopName: string) => void;
  onPlaceCharacter?: (characterId: number | string, characterName: string) => void;
  monsters?: Array<{ id: string; name: string; challenge_rating?: string; avatar_url?: string }>;
  campaignItems?: CampaignItem[];
  npcs?: NPC[];
  shops?: Shop[];
  playerCharacters?: PlayerCharacter[];
}

const CURRENCY_TYPES = [
  { type: "pp", name: "铂金币", color: "text-purple-300" },
  { type: "gp", name: "金币", color: "text-amber-300" },
  { type: "ep", name: "银电币", color: "text-gray-300" },
  { type: "sp", name: "银币", color: "text-gray-400" },
  { type: "cp", name: "铜币", color: "text-orange-400" },
];

export function MapContextMenu({
  x, y, gridX, gridY, onClose, onPlaceMonster, onPlaceCurrency, onPlaceItem, onPlaceNPC, onPlaceShop, onPlaceCharacter, monsters = [], campaignItems = [], npcs = [], shops = [], playerCharacters = []
}: ContextMenuProps) {
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [currencyAmount, setCurrencyAmount] = useState(10);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click/touch
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleTouchOutside = (e: TouchEvent) => {
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
      document.addEventListener("touchstart", handleTouchOutside, { passive: true });
      document.addEventListener("keydown", handleEscape);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleTouchOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Toggle submenu (for touch devices)
  const toggleSubmenu = (submenu: string) => {
    setActiveSubmenu(prev => prev === submenu ? null : submenu);
  };

  // Adjust position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 220);
  const adjustedY = Math.min(y, window.innerHeight - 300);

  return (
    <div
      ref={menuRef}
      className="fixed bg-gray-900 border border-gray-600 rounded-lg shadow-xl z-[10000] min-w-[180px]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-700">
        放置位置: ({gridX}, {gridY})
      </div>

      {/* Place Monster */}
      <div
        className="relative"
        onMouseEnter={() => setActiveSubmenu("monster")}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <div
          className="px-3 py-2 hover:bg-gray-700 cursor-pointer flex items-center justify-between text-sm text-gray-200"
          onClick={(e) => { e.stopPropagation(); toggleSubmenu("monster"); }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <span>放置怪物</span>
          <span className="text-gray-500">▶</span>
        </div>
        {activeSubmenu === "monster" && (
          <div
            className="absolute left-full top-0 bg-gray-900 border border-gray-600 rounded-lg shadow-xl min-w-[200px] max-h-[300px] overflow-y-auto"
            onTouchEnd={(e) => e.stopPropagation()}
          >
            {monsters.length > 0 ? (
              monsters.map((m) => (
                <div
                  key={m.id}
                  className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm text-gray-200 flex items-center gap-2"
                  onClick={(e) => { e.stopPropagation(); onPlaceMonster(m.id, m.name); onClose(); }}
                  onTouchEnd={(e) => e.stopPropagation()}
                >
                  {m.avatar_url && (
                    <img src={m.avatar_url} alt={m.name} className="w-5 h-5 rounded-full" />
                  )}
                  <span>{m.name}</span>
                  {m.challenge_rating && (
                    <span className="ml-auto text-xs text-gray-500">CR {m.challenge_rating}</span>
                  )}
                </div>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-gray-500">暂无怪物数据</div>
            )}
          </div>
        )}
      </div>

      {/* Place Player Character */}
      <div
        className="relative"
        onMouseEnter={() => setActiveSubmenu("player")}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <div
          className="px-3 py-2 hover:bg-gray-700 cursor-pointer flex items-center justify-between text-sm text-gray-200"
          onClick={(e) => { e.stopPropagation(); toggleSubmenu("player"); }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <span>放置玩家</span>
          <span className="text-gray-500">▶</span>
        </div>
        {activeSubmenu === "player" && (
          <div
            className="absolute left-full top-0 bg-gray-900 border border-gray-600 rounded-lg shadow-xl min-w-[200px] max-h-[300px] overflow-y-auto"
            onTouchEnd={(e) => e.stopPropagation()}
          >
            {playerCharacters.length > 0 ? (
              playerCharacters.map((pc) => (
                <div
                  key={pc.id}
                  className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm text-gray-200 flex items-center gap-2"
                  onClick={(e) => { e.stopPropagation(); onPlaceCharacter?.(pc.id, pc.name); onClose(); }}
                  onTouchEnd={(e) => e.stopPropagation()}
                >
                  {pc.avatar_url ? (
                    <img src={pc.avatar_url} alt={pc.name} className="w-5 h-5 rounded-full" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-[10px] text-white">
                      {pc.name.charAt(0)}
                    </div>
                  )}
                  <span>{pc.name}</span>
                </div>
              ))
            ) : (
              <div className="px-3 py-3 text-sm text-gray-400">
                <div className="text-center mb-2">暂无玩家角色</div>
                <div className="text-xs text-gray-500 text-center">
                  战役中没有玩家角色
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Place NPC */}
      <div
        className="relative"
        onMouseEnter={() => setActiveSubmenu("npc")}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <div
          className="px-3 py-2 hover:bg-gray-700 cursor-pointer flex items-center justify-between text-sm text-gray-200"
          onClick={(e) => { e.stopPropagation(); toggleSubmenu("npc"); }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <span>放置NPC</span>
          <span className="text-gray-500">▶</span>
        </div>
        {activeSubmenu === "npc" && (
          <div
            className="absolute left-full top-0 bg-gray-900 border border-gray-600 rounded-lg shadow-xl min-w-[200px] max-h-[300px] overflow-y-auto"
            onTouchEnd={(e) => e.stopPropagation()}
          >
            {npcs.length > 0 ? (
              npcs.map((npc) => (
                <div
                  key={npc.id}
                  className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm text-gray-200 flex items-center gap-2"
                  onClick={(e) => { e.stopPropagation(); onPlaceNPC(String(npc.id), npc.name_cn || npc.name); onClose(); }}
                  onTouchEnd={(e) => e.stopPropagation()}
                >
                  {npc.avatar_url && (
                    <img src={npc.avatar_url} alt={npc.name_cn || npc.name} className="w-5 h-5 rounded-full" />
                  )}
                  <span>{npc.name_cn || npc.name}</span>
                </div>
              ))
            ) : (
              <div className="px-3 py-3 text-sm text-gray-400">
                <div className="text-center mb-2">暂无NPC</div>
                <div className="text-xs text-gray-500 text-center">
                  请先在右侧「资源」面板的<br/>「NPC」标签中添加NPC
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Place Currency */}
      <div
        className="relative"
        onMouseEnter={() => setActiveSubmenu("currency")}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <div
          className="px-3 py-2 hover:bg-gray-700 cursor-pointer flex items-center justify-between text-sm text-gray-200"
          onClick={(e) => { e.stopPropagation(); toggleSubmenu("currency"); }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <span>放置钱币</span>
          <span className="text-gray-500">▶</span>
        </div>
        {activeSubmenu === "currency" && (
          <div
            className="absolute left-full top-0 bg-gray-900 border border-gray-600 rounded-lg shadow-xl min-w-[160px]"
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-gray-700">
              <label className="text-xs text-gray-400">数量</label>
              <input
                type="number"
                min={1}
                value={currencyAmount}
                onChange={(e) => setCurrencyAmount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full mt-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white"
                onClick={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
              />
            </div>
            {CURRENCY_TYPES.map((c) => (
              <div
                key={c.type}
                className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm flex items-center gap-2"
                onClick={(e) => { e.stopPropagation(); onPlaceCurrency(c.type, currencyAmount); onClose(); }}
                onTouchEnd={(e) => e.stopPropagation()}
              >
                <span className={c.color}>{c.name}</span>
                <span className="text-gray-500 text-xs">×{currencyAmount}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Place Item */}
      <div
        className="relative"
        onMouseEnter={() => setActiveSubmenu("item")}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <div
          className="px-3 py-2 hover:bg-gray-700 cursor-pointer flex items-center justify-between text-sm text-gray-200"
          onClick={(e) => { e.stopPropagation(); toggleSubmenu("item"); }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <span>放置物品</span>
          <span className="text-gray-500">▶</span>
        </div>
        {activeSubmenu === "item" && (
          <div
            className="absolute left-full top-0 bg-gray-900 border border-gray-600 rounded-lg shadow-xl min-w-[200px] max-h-[300px] overflow-y-auto"
            onTouchEnd={(e) => e.stopPropagation()}
          >
            {campaignItems.length > 0 ? (
              campaignItems.map((item) => (
                <div
                  key={item.id}
                  className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm text-gray-200 flex items-center gap-2"
                  onClick={(e) => { e.stopPropagation(); onPlaceItem(String(item.id), item.name_cn || item.name, item.iconPath); onClose(); }}
                  onTouchEnd={(e) => e.stopPropagation()}
                >
                  {item.iconPath && (
                    <img src={item.iconPath} alt={item.name_cn || item.name} className="w-5 h-5 rounded" />
                  )}
                  <span>{item.name_cn || item.name}</span>
                  {item.rarity && (
                    <span className="ml-auto text-xs text-gray-500">{item.rarity}</span>
                  )}
                </div>
              ))
            ) : (
              <div className="px-3 py-3 text-sm text-gray-400">
                <div className="text-center mb-2">暂无物品</div>
                <div className="text-xs text-gray-500 text-center">
                  请先在右侧「资源」面板的<br/>「物品」标签中添加物品
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Place Shop */}
      <div
        className="relative"
        onMouseEnter={() => setActiveSubmenu("shop")}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <div
          className="px-3 py-2 hover:bg-gray-700 cursor-pointer flex items-center justify-between text-sm text-gray-200"
          onClick={(e) => { e.stopPropagation(); toggleSubmenu("shop"); }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <span>放置商店</span>
          <span className="text-gray-500">▶</span>
        </div>
        {activeSubmenu === "shop" && (
          <div
            className="absolute left-full top-0 bg-gray-900 border border-gray-600 rounded-lg shadow-xl min-w-[200px] max-h-[300px] overflow-y-auto"
            onTouchEnd={(e) => e.stopPropagation()}
          >
            {shops.length > 0 ? (
              shops.map((shop) => (
                <div
                  key={shop.id}
                  className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm text-gray-200 flex items-center gap-2"
                  onClick={(e) => { e.stopPropagation(); onPlaceShop(shop.id, shop.name); onClose(); }}
                  onTouchEnd={(e) => e.stopPropagation()}
                >
                  {shop.avatar_url && (
                    <img src={shop.avatar_url} alt={shop.name} className="w-5 h-5 rounded" />
                  )}
                  <span>{shop.name}</span>
                </div>
              ))
            ) : (
              <div className="px-3 py-3 text-sm text-gray-400">
                <div className="text-center mb-2">暂无商店</div>
                <div className="text-xs text-gray-500 text-center">
                  请先在右侧「资源」面板的<br/>「商店」标签中添加商店
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cancel */}
      <div className="border-t border-gray-700">
        <div
          className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm text-gray-400"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          取消
        </div>
      </div>
    </div>
  );
}
