/**
 * MobileActionModal - Modal replacement for context menu on touch devices
 * Provides a stable, mobile-friendly interface for placing tokens
 */

import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";

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

interface Monster {
  id: string;
  name: string;
  challenge_rating?: string;
  avatar_url?: string;
}

interface PlayerCharacter {
  id: number | string;
  name: string;
  avatar_url?: string;
}

const CURRENCY_TYPES = [
  { type: "pp", name: "铂金币", color: "text-purple-300", bgColor: "bg-purple-900/30" },
  { type: "gp", name: "金币", color: "text-amber-300", bgColor: "bg-amber-900/30" },
  { type: "ep", name: "银电币", color: "text-gray-300", bgColor: "bg-gray-700/30" },
  { type: "sp", name: "银币", color: "text-gray-400", bgColor: "bg-gray-600/30" },
  { type: "cp", name: "铜币", color: "text-orange-400", bgColor: "bg-orange-900/30" },
];

interface MobileActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  gridX: number;
  gridY: number;
  onPlaceMonster: (monsterId: string, monsterName: string) => void;
  onPlaceCurrency: (type: string, amount: number) => void;
  onPlaceItem: (itemId: string, itemName: string, icon?: string) => void;
  onPlaceNPC: (npcId: string, npcName: string) => void;
  onPlaceShop: (shopId: number, shopName: string) => void;
  onPlaceCharacter?: (characterId: number | string, characterName: string) => void;
  monsters?: Monster[];
  campaignItems?: CampaignItem[];
  npcs?: NPC[];
  shops?: Shop[];
  playerCharacters?: PlayerCharacter[];
}

type TabType = "monster" | "player" | "npc" | "currency" | "item" | "shop";

export function MobileActionModal({
  isOpen,
  onClose,
  gridX,
  gridY,
  onPlaceMonster,
  onPlaceCurrency,
  onPlaceItem,
  onPlaceNPC,
  onPlaceShop,
  onPlaceCharacter,
  monsters = [],
  campaignItems = [],
  npcs = [],
  shops = [],
  playerCharacters = [],
}: MobileActionModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("monster");
  const [currencyAmount, setCurrencyAmount] = useState(10);

  // Delay allowing close to prevent ghost clicks from closing the modal
  const [allowClose, setAllowClose] = useState(false);
  useEffect(() => {
    if (isOpen) {
      setAllowClose(false);
      const timer = setTimeout(() => setAllowClose(true), 400);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const tabs: { key: TabType; label: string; icon: string }[] = [
    { key: "monster", label: "怪物", icon: "👹" },
    { key: "player", label: "玩家", icon: "🎭" },
    { key: "npc", label: "NPC", icon: "🧑" },
    { key: "currency", label: "钱币", icon: "💰" },
    { key: "item", label: "物品", icon: "📦" },
    { key: "shop", label: "商店", icon: "🏪" },
  ];

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open && allowClose) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 bg-black/60 z-[9998]"
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md max-h-[80dvh] bg-gray-900 rounded-xl border border-gray-700 shadow-2xl z-[9999] overflow-hidden flex flex-col"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between bg-gray-800/50">
            <div>
              <Dialog.Title className="text-base font-semibold text-gray-100">
                放置到地图
              </Dialog.Title>
              <p className="text-xs text-gray-500 mt-0.5">
                位置: ({gridX}, {gridY})
              </p>
            </div>
            <Dialog.Close className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded-lg transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Dialog.Close>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-700 bg-gray-800/30">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                  activeTab === tab.key
                    ? "text-amber-400 border-b-2 border-amber-400 bg-gray-800/50"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                <span className="mr-1">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3">
            {/* Monster Tab */}
            {activeTab === "monster" && (
              <div className="space-y-1">
                {monsters.length > 0 ? (
                  monsters.map((m) => (
                    <button
                      key={m.id}
                      className="w-full px-3 py-2.5 flex items-center gap-3 bg-gray-800/50 hover:bg-gray-700 rounded-lg transition-colors"
                      onClick={() => { onPlaceMonster(m.id, m.name); onClose(); }}
                    >
                      {m.avatar_url ? (
                        <img src={m.avatar_url} alt={m.name} className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-red-900/50 flex items-center justify-center text-lg">👹</div>
                      )}
                      <span className="flex-1 text-left text-sm text-gray-200">{m.name}</span>
                      {m.challenge_rating && (
                        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">CR {m.challenge_rating}</span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-3xl mb-2">👹</div>
                    <div className="text-sm">暂无怪物</div>
                    <div className="text-xs mt-1">请先在资源面板添加怪物</div>
                  </div>
                )}
              </div>
            )}

            {/* Player Tab */}
            {activeTab === "player" && (
              <div className="space-y-1">
                {playerCharacters.length > 0 ? (
                  playerCharacters.map((pc) => (
                    <button
                      key={pc.id}
                      className="w-full px-3 py-2.5 flex items-center gap-3 bg-gray-800/50 hover:bg-gray-700 rounded-lg transition-colors"
                      onClick={() => { onPlaceCharacter?.(pc.id, pc.name); onClose(); }}
                    >
                      {pc.avatar_url ? (
                        <img src={pc.avatar_url} alt={pc.name} className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm text-white font-medium">
                          {pc.name.charAt(0)}
                        </div>
                      )}
                      <span className="flex-1 text-left text-sm text-gray-200">{pc.name}</span>
                    </button>
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-3xl mb-2">🎭</div>
                    <div className="text-sm">暂无玩家角色</div>
                    <div className="text-xs mt-1">战役中没有玩家角色</div>
                  </div>
                )}
              </div>
            )}

            {/* NPC Tab */}
            {activeTab === "npc" && (
              <div className="space-y-1">
                {npcs.length > 0 ? (
                  npcs.map((npc) => (
                    <button
                      key={npc.id}
                      className="w-full px-3 py-2.5 flex items-center gap-3 bg-gray-800/50 hover:bg-gray-700 rounded-lg transition-colors"
                      onClick={() => { onPlaceNPC(String(npc.id), npc.name_cn || npc.name); onClose(); }}
                    >
                      {npc.avatar_url ? (
                        <img src={npc.avatar_url} alt={npc.name_cn || npc.name} className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-blue-900/50 flex items-center justify-center text-lg">🧑</div>
                      )}
                      <span className="flex-1 text-left text-sm text-gray-200">{npc.name_cn || npc.name}</span>
                    </button>
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-3xl mb-2">🧑</div>
                    <div className="text-sm">暂无NPC</div>
                    <div className="text-xs mt-1">请先在资源面板添加NPC</div>
                  </div>
                )}
              </div>
            )}

            {/* Currency Tab */}
            {activeTab === "currency" && (
              <div className="space-y-3">
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <label className="text-xs text-gray-400 block mb-1.5">数量</label>
                  <input
                    type="number"
                    min={1}
                    value={currencyAmount}
                    onChange={(e) => setCurrencyAmount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {CURRENCY_TYPES.map((c) => (
                    <button
                      key={c.type}
                      className={`px-4 py-3 ${c.bgColor} hover:opacity-80 rounded-lg transition-opacity flex items-center justify-between`}
                      onClick={() => { onPlaceCurrency(c.type, currencyAmount); onClose(); }}
                    >
                      <span className={`font-medium ${c.color}`}>{c.name}</span>
                      <span className="text-gray-400 text-sm">×{currencyAmount}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Item Tab */}
            {activeTab === "item" && (
              <div className="space-y-1">
                {campaignItems.length > 0 ? (
                  campaignItems.map((item) => (
                    <button
                      key={item.id}
                      className="w-full px-3 py-2.5 flex items-center gap-3 bg-gray-800/50 hover:bg-gray-700 rounded-lg transition-colors"
                      onClick={() => { onPlaceItem(String(item.id), item.name_cn || item.name, item.iconPath); onClose(); }}
                    >
                      {item.iconPath ? (
                        <img src={item.iconPath} alt={item.name_cn || item.name} className="w-8 h-8 rounded object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded bg-green-900/50 flex items-center justify-center text-lg">📦</div>
                      )}
                      <span className="flex-1 text-left text-sm text-gray-200">{item.name_cn || item.name}</span>
                      {item.rarity && (
                        <span className="text-xs text-gray-500">{item.rarity}</span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-3xl mb-2">📦</div>
                    <div className="text-sm">暂无物品</div>
                    <div className="text-xs mt-1">请先在资源面板添加物品</div>
                  </div>
                )}
              </div>
            )}

            {/* Shop Tab */}
            {activeTab === "shop" && (
              <div className="space-y-1">
                {shops.length > 0 ? (
                  shops.map((shop) => (
                    <button
                      key={shop.id}
                      className="w-full px-3 py-2.5 flex items-center gap-3 bg-gray-800/50 hover:bg-gray-700 rounded-lg transition-colors"
                      onClick={() => { onPlaceShop(shop.id, shop.name); onClose(); }}
                    >
                      {shop.avatar_url ? (
                        <img src={shop.avatar_url} alt={shop.name} className="w-8 h-8 rounded object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded bg-yellow-900/50 flex items-center justify-center text-lg">🏪</div>
                      )}
                      <span className="flex-1 text-left text-sm text-gray-200">{shop.name}</span>
                    </button>
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-3xl mb-2">🏪</div>
                    <div className="text-sm">暂无商店</div>
                    <div className="text-xs mt-1">请先在资源面板添加商店</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
