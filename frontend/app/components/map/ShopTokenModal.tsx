/**
 * ShopTokenModal
 * Modal for DM to manage shop tokens on the map (delete, view info)
 */

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { Token } from "./types/TacticalMapTypes";
import { createLogger } from '~/utils/logger';
const logger = createLogger('ShopTokenModal');


interface ShopTokenModalProps {
  token: Token | null;
  isDM: boolean;
  onClose: () => void;
  onDelete: (tokenId: number) => void;
}

export function ShopTokenModal({
  token,
  isDM,
  onClose,
  onDelete,
}: ShopTokenModalProps) {
  const [deleteLoading, setDeleteLoading] = useState(false);

  if (!token || !(token as any).shop_id) return null;

  const shopId = (token as any).shop_id;
  const displayName = token.instance_name || "未命名商店";

  const handleDelete = async () => {
    if (!token) return;
    if (!confirm(`确定要从地图上删除 ${displayName} 吗？`)) return;

    setDeleteLoading(true);
    try {
      await onDelete(token.id);
      onClose();
    } catch (e) {
      logger.error("Delete shop token error:", e);
      alert("删除失败");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <Dialog.Root open={!!token} onOpenChange={(open) => !open && onClose()} modal={false}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[9998]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-6 w-[90vw] max-w-md max-h-[85dvh] overflow-y-auto z-[9999]">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-amber-300 flex items-center gap-3">
              <div>
                <div>{displayName}</div>
                <div className="text-sm text-gray-400 font-normal mt-1">商店 Token (DM 管理)</div>
              </div>
            </Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          <div className="space-y-4">
            {/* Shop Info */}
            <div className="bg-gray-800/50 rounded-lg p-4 space-y-2">
              <div className="text-sm">
                <span className="text-gray-400">商店ID:</span>
                <span className="ml-2 text-white">{shopId}</span>
              </div>
              <div className="text-sm">
                <span className="text-gray-400">Token大小:</span>
                <span className="ml-2 text-white">{token.token_size || '1x1'}</span>
              </div>
              <div className="text-sm">
                <span className="text-gray-400">位置:</span>
                <span className="ml-2 text-white">({token.position_x}, {token.position_y})</span>
              </div>
            </div>

            {/* DM Actions */}
            {isDM && (
              <div className="space-y-2">
                <div className="text-sm text-gray-400 mb-2">DM 操作:</div>
                <button
                  onClick={handleDelete}
                  disabled={deleteLoading}
                  className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  {deleteLoading ? "删除中..." : "🗑️ 从地图删除"}
                </button>
                <div className="text-xs text-gray-500 mt-1">
                  提示：删除 Token 不会删除商店本身，只是从地图上移除
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => onClose()}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              关闭
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

