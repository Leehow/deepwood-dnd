/**
 * ItemTokenModal
 * Modal for displaying item token details and allowing pickup/delete actions
 * DM can choose which character receives the item; players pick up directly.
 */

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { Token, PlayerAvatar } from "./types/TacticalMapTypes";
import { createLogger } from '~/utils/logger';
import { resolveTokenItemImageUrl } from "~/utils/itemTokenData";
const logger = createLogger('ItemTokenModal');


interface ItemTokenModalProps {
  token: Token | null;
  isDM: boolean;
  userId?: string;
  campaignId: string;
  /** Player characters available for DM to assign item to */
  campaignCharacters?: PlayerAvatar[];
  onClose: () => void;
  onPickup: (tokenId: number) => void;
  /** DM picks up item to a specific character */
  onPickupToCharacter?: (tokenId: number, characterId: number | string) => void;
  onDelete: (tokenId: number) => void;
}

export function ItemTokenModal({
  token,
  isDM,
  userId,
  campaignId,
  campaignCharacters = [],
  onClose,
  onPickup,
  onPickupToCharacter,
  onDelete,
}: ItemTokenModalProps) {
  const [pickupLoading, setPickupLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showCharacterSelect, setShowCharacterSelect] = useState(false);

  if (!token || !token.item_data) return null;

  const itemData = token.item_data;
  const displayIcon = resolveTokenItemImageUrl(itemData);

  // Derived display fields with defensive fallbacks
  const displayName: string = token.instance_name || itemData.name || itemData.name_cn || "未命名";
  const quantityText: string | null = token.item_quantity && token.item_quantity > 1 ? `×${token.item_quantity}` : null;

  const valueText: string | null = (() => {
    if (itemData.value) return String(itemData.value);
    const cost = itemData.cost;
    if (!cost) return null;
    if (typeof cost === "string" || typeof cost === "number") return String(cost);
    if (typeof cost === "object") {
      try {
        return Object.entries(cost).map(([unit, v]) => `${v} ${unit}`).join(", ");
      } catch {
        return null;
      }
    }
    return null;
  })();

  const damageText: string | null = (() => {
    const dmg = itemData.damage;
    if (!dmg) return null;
    if (typeof dmg === "string") return dmg;
    if (Array.isArray(dmg)) return dmg.join(", ");
    if (typeof dmg === "object") {
      const dice = dmg.dice || dmg.formula;
      const type = dmg.type || dmg.damage_type;
      if (dice && type) return `${dice} ${type}`;
      if (dice) return `${dice}`;
    }
    return null;
  })();

  const armorText: string | null = (() => {
    const ac = itemData.armor_class;
    if (!ac) return null;
    if (typeof ac === "number" || typeof ac === "string") return String(ac);
    if (typeof ac === "object") {
      const base = ac.base ?? ac.ac ?? ac.value;
      if (!base) return null;
      let dexPart = "";
      if (ac.dex_bonus === true) {
        dexPart = ac.max_dex_bonus ? `(Dex最大+${ac.max_dex_bonus})` : `(Dex调整值)`;
      } else if (ac.dex_bonus === false) {
        dexPart = `(无Dex加值)`;
      }
      return `${base}${dexPart ? " " + dexPart : ""}`;
    }
    return null;
  })();

  // DM with available characters & handler → show character selection on pickup
  const dmCanChooseCharacter = isDM && onPickupToCharacter && campaignCharacters.length > 0;
  // Illusion tokens cannot be picked up
  const isIllusion = itemData.type === 'illusion';

  const handlePickup = async () => {
    if (!token) return;
    if (dmCanChooseCharacter) {
      setShowCharacterSelect(true);
      return;
    }
    setPickupLoading(true);
    try {
      await onPickup(token.id);
      onClose();
    } catch (e) {
      logger.error("Pickup error:", e);
    } finally {
      setPickupLoading(false);
    }
  };

  const handlePickupToCharacter = async (characterId: number | string) => {
    if (!token || !onPickupToCharacter) return;
    setPickupLoading(true);
    setShowCharacterSelect(false);
    try {
      await onPickupToCharacter(token.id, characterId);
      onClose();
    } catch (e) {
      logger.error("Pickup to character error:", e);
    } finally {
      setPickupLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!token) return;
    if (!confirm(`确定要删除 ${itemData.name} 吗？`)) return;

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

  // Filter to player characters only (exclude monsters)
  const playerCharacters = campaignCharacters.filter(c => c.type !== 'monster');

  return (
    <Dialog.Root open={!!token} onOpenChange={(open) => { if (!open) { setShowCharacterSelect(false); onClose(); } }} modal={false}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[9998]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-6 w-[90vw] max-w-2xl max-h-[85dvh] overflow-y-auto z-[9999]">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-amber-300 flex items-center gap-3">
              {displayIcon && (
                <img src={displayIcon} alt={displayName} className="w-12 h-12 object-contain" />
              )}
              <div>
                <div>{displayName}</div>
                {quantityText && (
                  <div className="text-sm text-gray-400 font-normal">数量: {quantityText}</div>
                )}
              </div>
            </Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          <div className="space-y-4">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              {itemData.type && (
                <div>
                  <div className="text-xs text-gray-500">类型</div>
                  <div className="text-sm text-white">{itemData.type}</div>
                </div>
              )}
              {itemData.rarity && (
                <div>
                  <div className="text-xs text-gray-500">稀有度</div>
                  <div className="text-sm text-white">{itemData.rarity}</div>
                </div>
              )}
              {itemData.weight !== undefined && (
                <div>
                  <div className="text-xs text-gray-500">重量</div>
                  <div className="text-sm text-white">{itemData.weight} 磅</div>
                </div>
              )}
              {valueText && (
                <div>
                  <div className="text-xs text-gray-500">价值</div>
                  <div className="text-sm text-white">{valueText}</div>
                </div>
              )}
            </div>

            {/* Description */}
            {itemData.description && (
              <div>
                <div className="text-xs text-gray-500 mb-1">描述</div>
                <div className="text-sm text-gray-300 bg-gray-800/40 border border-gray-700 rounded p-3">
                  {itemData.description}
                </div>
              </div>
            )}

            {/* Properties */}
            {itemData.properties && itemData.properties.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-1">属性</div>
                <div className="flex flex-wrap gap-2">
                  {itemData.properties.map((prop: string, idx: number) => (
                    <span key={idx} className="px-2 py-1 bg-blue-900/30 border border-blue-700 rounded text-xs text-blue-300">
                      {prop}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Damage (for weapons) */}
            {damageText && (
              <div>
                <div className="text-xs text-gray-500 mb-1">伤害</div>
                <div className="text-sm text-white">{damageText}</div>
              </div>
            )}

            {/* Armor Class (for armor) */}
            {armorText && (
              <div>
                <div className="text-xs text-gray-500 mb-1">护甲等级</div>
                <div className="text-sm text-white">{armorText}</div>
              </div>
            )}

            {/* DM Character Selection */}
            {showCharacterSelect && (
              <div className="pt-2 border-t border-gray-700">
                <div className="text-sm text-gray-400 mb-2">选择接收角色：</div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {playerCharacters.map((char) => (
                    <button
                      key={char.id}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-amber-600 transition-colors text-left disabled:opacity-50"
                      onClick={() => handlePickupToCharacter(char.id)}
                      disabled={pickupLoading}
                    >
                      <img
                        src={char.avatar_url || "/default-avatar.png"}
                        alt={char.name}
                        className="w-10 h-10 rounded-full object-cover border border-gray-600 flex-shrink-0"
                      />
                      <span className="text-sm text-white truncate">{char.name}</span>
                    </button>
                  ))}
                </div>
                <button
                  className="mt-2 w-full px-3 py-1.5 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded transition-colors"
                  onClick={() => setShowCharacterSelect(false)}
                >
                  取消
                </button>
              </div>
            )}

            {/* Action Buttons */}
            {!showCharacterSelect && (
              <div className="flex gap-3 pt-4 border-t border-gray-700">
                {!isIllusion && (
                  <button
                    className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white font-medium"
                    onClick={handlePickup}
                    disabled={pickupLoading || deleteLoading}
                  >
                    {pickupLoading ? "捡起中..." : "捡起"}
                  </button>
                )}

                {isDM && (
                  <button
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white font-medium"
                    onClick={handleDelete}
                    disabled={pickupLoading || deleteLoading}
                  >
                    {deleteLoading ? "删除中..." : "删除"}
                  </button>
                )}

                <button
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
                  onClick={onClose}
                  disabled={pickupLoading || deleteLoading}
                >
                  关闭
                </button>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
