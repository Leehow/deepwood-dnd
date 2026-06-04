/**
 * ShopTokenPlacementModal
 * Modal for placing shop token on map with size selection
 */

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { createLogger } from '~/utils/logger';
const logger = createLogger('ShopTokenPlacementModal');


interface Shop {
  id: number;
  name: string;
  avatar_url?: string;
}

interface ShopTokenPlacementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shop: Shop | null;
  onPlace: (shopId: number, tokenSize: string) => Promise<void>;
}

const TOKEN_SIZES = [
  { value: "1x1", label: "1×1", desc: "中型", color: "from-blue-500/20 to-blue-600/20 border-blue-500/40" },
  { value: "2x2", label: "2×2", desc: "大型", color: "from-green-500/20 to-green-600/20 border-green-500/40" },
  { value: "3x3", label: "3×3", desc: "超大", color: "from-purple-500/20 to-purple-600/20 border-purple-500/40" },
  { value: "4x4", label: "4×4", desc: "巨型", color: "from-red-500/20 to-red-600/20 border-red-500/40" },
];

export function ShopTokenPlacementModal({
  open,
  onOpenChange,
  shop,
  onPlace,
}: ShopTokenPlacementModalProps) {
  const [tokenSize, setTokenSize] = useState("1x1");
  const [placing, setPlacing] = useState(false);

  const handlePlace = async () => {
    if (!shop) return;
    setPlacing(true);
    try {
      await onPlace(shop.id, tokenSize);
      onOpenChange(false);
    } catch (e) {
      logger.error("Place shop token error:", e);
    } finally {
      setPlacing(false);
    }
  };

  if (!shop) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9998]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-br from-gray-800 to-gray-900 border border-amber-500/30 rounded-xl shadow-2xl w-[90vw] max-w-sm z-[9999] overflow-hidden">
          {/* 头部 */}
          <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-b border-amber-500/20 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-700/50 border border-gray-600/50 flex items-center justify-center flex-shrink-0">
                  {shop.avatar_url ? (
                    <img src={shop.avatar_url} alt={shop.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl">🏪</span>
                  )}
                </div>
                <div className="min-w-0">
                  <Dialog.Title className="text-base font-bold text-amber-200 truncate">
                    <span>{shop.name}</span>
                  </Dialog.Title>
                  <p className="text-xs text-gray-400 mt-0.5">选择 Token 大小并放置到地图</p>
                </div>
              </div>
              <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors flex-shrink-0">
                <span>✕</span>
              </Dialog.Close>
            </div>
          </div>

          {/* 内容 */}
          <div className="p-5">
            <p className="text-xs text-gray-400 mb-3">Token 大小</p>
            <div className="grid grid-cols-4 gap-2">
              {TOKEN_SIZES.map((size) => (
                <button
                  key={size.value}
                  onClick={() => setTokenSize(size.value)}
                  className={`relative p-3 rounded-lg border-2 transition-all duration-200 ${
                    tokenSize === size.value
                      ? `bg-gradient-to-br ${size.color} border-current scale-105 shadow-lg`
                      : 'bg-gray-800/50 border-gray-700/50 hover:border-gray-600 hover:bg-gray-700/50'
                  }`}
                >
                  <div className={`text-lg font-bold ${tokenSize === size.value ? 'text-white' : 'text-gray-300'}`}>
                    {size.label}
                  </div>
                  <div className={`text-[10px] mt-0.5 ${tokenSize === size.value ? 'text-gray-200' : 'text-gray-500'}`}>
                    {size.desc}
                  </div>
                  {tokenSize === size.value && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center">
                      <span className="text-[10px] text-white">✓</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* 底部按钮 */}
          <div className="flex gap-3 px-5 pb-5">
            <button
              onClick={() => onOpenChange(false)}
              className="flex-1 px-4 py-2.5 rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 text-sm font-medium transition-colors"
            >
              取消
            </button>
            <button
              onClick={handlePlace}
              disabled={placing}
              className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-gray-900 text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {placing ? (
                <>
                  <span className="animate-spin">⏳</span>
                  生成中...
                </>
              ) : (
                <>
                  <span>📍</span>
                  放置到地图
                </>
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

