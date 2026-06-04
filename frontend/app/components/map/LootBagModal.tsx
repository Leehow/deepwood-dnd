/**
 * LootBagModal
 * Modal for displaying loot bag contents and allowing players to loot items/currency
 */

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { Token } from "./types/TacticalMapTypes";
import { createLogger } from '~/utils/logger';
import { tCategory } from '~/config/item-i18n';
const logger = createLogger('LootBagModal');

interface LootBagData {
  source_monster_id: number;
  source_name: string;
  items: Array<{
    id?: number | string;
    name: string;
    name_cn?: string;
    icon?: string;
    quantity: number;
    category?: string;
  }>;
  currency: {
    cp: number;
    sp: number;
    ep: number;
    gp: number;
    pp: number;
  };
  looted_by?: string[];
}

interface LootBagModalProps {
  token: Token | null;
  isDM: boolean;
  characterId?: number;  // The player's selected character ID
  campaignId: string;
  onClose: () => void;
  onLoot: (tokenId: number, characterId: number, itemIndices: number[] | null, takeCurrency: boolean) => Promise<void>;
  onDelete: (tokenId: number) => Promise<void>;
}

export function LootBagModal({
  token,
  isDM,
  characterId,
  campaignId,
  onClose,
  onLoot,
  onDelete,
}: LootBagModalProps) {
  const [lootLoading, setLootLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [takeCurrency, setTakeCurrency] = useState(true);

  if (!token || !token.loot_bag_data) return null;

  const lootData = token.loot_bag_data as LootBagData;
  const items = lootData.items || [];
  const currency = lootData.currency || { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

  const hasCurrency = Object.values(currency).some(v => v > 0);
  const hasItems = items.length > 0;
  const hasAnything = hasCurrency || hasItems;

  const toggleItem = (index: number) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedItems(newSelected);
  };

  const selectAll = () => {
    setSelectedItems(new Set(items.map((_, i) => i)));
    setTakeCurrency(true);
  };

  const handleLoot = async () => {
    if (!token || !characterId) return;

    // Determine what to loot
    const itemIndices = selectedItems.size > 0 ? Array.from(selectedItems) : null;
    const shouldTakeCurrency = takeCurrency && hasCurrency;

    if (!itemIndices && !shouldTakeCurrency) {
      alert("请选择要拾取的物品或金钱");
      return;
    }

    setLootLoading(true);
    try {
      await onLoot(token.id, characterId, itemIndices, shouldTakeCurrency);
      // Clear selection after successful loot
      setSelectedItems(new Set());
      setTakeCurrency(true);
      // Modal may close automatically if bag becomes empty
    } catch (e) {
      logger.error("Loot error:", e);
    } finally {
      setLootLoading(false);
    }
  };

  const handleLootAll = async () => {
    if (!token || !characterId) return;

    setLootLoading(true);
    try {
      await onLoot(token.id, characterId, null, true);
      onClose();
    } catch (e) {
      logger.error("Loot all error:", e);
    } finally {
      setLootLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!token) return;
    if (!confirm(`确定要删除这个战利品袋吗？里面的物品将会消失。`)) return;

    setDeleteLoading(true);
    try {
      await onDelete(token.id);
      onClose();
    } catch (e) {
      logger.error("Delete error:", e);
    } finally {
      setDeleteLoading(false);
    }
  };

  // Currency display config
  const currencyConfig = [
    { key: 'pp', label: '白金', color: '#E5E5E5', bgColor: 'bg-gray-300/20' },
    { key: 'gp', label: '金币', color: '#FFD700', bgColor: 'bg-yellow-500/20' },
    { key: 'ep', label: '银金', color: '#C0C0C0', bgColor: 'bg-gray-400/20' },
    { key: 'sp', label: '银币', color: '#A8A8A8', bgColor: 'bg-gray-500/20' },
    { key: 'cp', label: '铜币', color: '#B87333', bgColor: 'bg-orange-700/20' },
  ];

  return (
    <Dialog.Root open={!!token} onOpenChange={(open) => !open && onClose()} modal={false}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[9998]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 border border-amber-700/50 rounded-lg shadow-2xl p-6 w-[90vw] max-w-lg max-h-[85dvh] overflow-y-auto z-[9999]">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-amber-300 flex items-center gap-3">
              <span className="text-2xl">💰</span>
              <div>
                <div>战利品袋</div>
                <div className="text-sm text-gray-400 font-normal">
                  来源: {lootData.source_name}
                </div>
              </div>
            </Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          <div className="space-y-4">
            {/* Currency Section */}
            {hasCurrency && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium text-amber-400">💰 金钱</div>
                  {characterId && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={takeCurrency}
                        onChange={(e) => setTakeCurrency(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-amber-500 focus:ring-amber-500"
                      />
                      <span className="text-xs text-gray-400">拾取</span>
                    </label>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {currencyConfig.map(({ key, label, color, bgColor }) => {
                    const value = currency[key as keyof typeof currency];
                    if (value <= 0) return null;
                    return (
                      <div
                        key={key}
                        className={`px-3 py-1.5 rounded ${bgColor} border border-gray-600`}
                        style={{ color }}
                      >
                        <span className="font-medium">{value}</span>
                        <span className="text-xs ml-1 opacity-80">{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Items Section */}
            {hasItems && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium text-orange-400">📦 物品</div>
                  {characterId && items.length > 1 && (
                    <button
                      onClick={() => setSelectedItems(
                        selectedItems.size === items.length
                          ? new Set()
                          : new Set(items.map((_, i) => i))
                      )}
                      className="text-xs text-gray-400 hover:text-white"
                    >
                      {selectedItems.size === items.length ? '取消全选' : '全选'}
                    </button>
                  )}
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {items.map((item, index) => (
                    <div
                      key={index}
                      className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
                        selectedItems.has(index)
                          ? 'bg-amber-900/30 border border-amber-600'
                          : 'bg-gray-700/30 border border-transparent hover:bg-gray-700/50'
                      }`}
                      onClick={() => characterId && toggleItem(index)}
                    >
                      {characterId && (
                        <input
                          type="checkbox"
                          checked={selectedItems.has(index)}
                          onChange={() => toggleItem(index)}
                          className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-amber-500 focus:ring-amber-500"
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      {item.icon && (
                        <img
                          src={item.icon}
                          alt={item.name}
                          className="w-8 h-8 object-contain rounded"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white truncate">
                          {item.name_cn || item.name}
                        </div>
                        {item.category && (
                          <div className="text-xs text-gray-500">{tCategory(item.category)}</div>
                        )}
                      </div>
                      {item.quantity > 1 && (
                        <div className="text-sm text-gray-400">×{item.quantity}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {!hasAnything && (
              <div className="text-center py-8 text-gray-500">
                战利品袋是空的
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col gap-2 pt-4 border-t border-gray-700">
              {characterId && hasAnything && (
                <>
                  <button
                    className="w-full px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-medium flex items-center justify-center gap-2"
                    onClick={handleLootAll}
                    disabled={lootLoading || deleteLoading}
                  >
                    <span>🎁</span>
                    {lootLoading ? "拾取中..." : "拾取全部"}
                  </button>

                  {(selectedItems.size > 0 || (takeCurrency && hasCurrency)) && (
                    <button
                      className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-medium"
                      onClick={handleLoot}
                      disabled={lootLoading || deleteLoading}
                    >
                      {lootLoading ? "拾取中..." : `拾取选中 (${selectedItems.size}物品${takeCurrency && hasCurrency ? ' + 金钱' : ''})`}
                    </button>
                  )}
                </>
              )}

              {!characterId && !isDM && (
                <div className="text-center text-gray-500 text-sm py-2">
                  选择一个角色才能拾取物品
                </div>
              )}

              <div className="flex gap-2">
                {isDM && (
                  <button
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-medium"
                    onClick={handleDelete}
                    disabled={lootLoading || deleteLoading}
                  >
                    {deleteLoading ? "删除中..." : "删除"}
                  </button>
                )}
                <button
                  className={`${isDM ? 'flex-1' : 'w-full'} px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white`}
                  onClick={onClose}
                  disabled={lootLoading || deleteLoading}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
