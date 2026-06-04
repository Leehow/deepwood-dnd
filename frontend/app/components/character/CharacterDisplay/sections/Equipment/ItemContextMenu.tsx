import React, { useEffect, useRef, useState } from "react";
import type { EquipmentItem } from "../../types/Character";
import { getConsumableData } from "../../utils/consumableUtils";

interface Props {
  x: number;
  y: number;
  item: EquipmentItem;
  selectedItems?: EquipmentItem[]; // For batch operations
  onClose: () => void;
  // Single item actions
  onSplit?: (item: EquipmentItem, quantity: number) => Promise<void>;
  onMerge?: (item: EquipmentItem) => Promise<void>;
  onDiscard?: (item: EquipmentItem, quantity: number) => Promise<void>;
  onTakeOut?: (item: EquipmentItem) => Promise<void>;
  onUseConsumable?: (item: EquipmentItem) => Promise<void>;
  onAddToHotbar?: (item: EquipmentItem) => void;
  // Paper writing actions
  onWrite?: (item: EquipmentItem) => void;
  onReadPaper?: (item: EquipmentItem) => void;
  onPublishDocument?: (item: EquipmentItem) => Promise<void>;
  onDirectDelete?: (item: EquipmentItem) => Promise<void>;
  isPaperItem?: boolean;
  isDM?: boolean;
  // Batch actions
  onBatchTakeOut?: (items: EquipmentItem[]) => Promise<void>;
  onBatchDiscard?: (items: EquipmentItem[]) => Promise<void>;
  onBatchMerge?: (items: EquipmentItem[]) => Promise<void>;
  hasTokenOnMap?: boolean;
  isInContainer?: boolean;
}

export function ItemContextMenu({
  x, y, item, selectedItems, onClose,
  onSplit, onMerge, onDiscard, onTakeOut, onUseConsumable, onAddToHotbar,
  onWrite, onReadPaper, onPublishDocument, onDirectDelete, isPaperItem, isDM,
  onBatchTakeOut, onBatchDiscard, onBatchMerge,
  hasTokenOnMap, isInContainer
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [splitQty, setSplitQty] = useState(1);
  const [discardQty, setDiscardQty] = useState(1);
  const [showSplitInput, setShowSplitInput] = useState(false);
  const [showDiscardInput, setShowDiscardInput] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  // Check if we're in batch mode (multiple items selected)
  const isBatchMode = selectedItems && selectedItems.length > 1;
  const batchCount = selectedItems?.length || 1;

  // For batch mode, check if any items are in containers
  const batchHasContainerItems = isBatchMode && selectedItems?.some(it => it.containerId);

  // Position adjustment
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (menuRef.current) {
        const rect = menuRef.current.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let nx = x, ny = y;
        if (x + rect.width > vw - 10) nx = vw - rect.width - 10;
        if (y + rect.height > vh - 10) ny = vh - rect.height - 10;
        if (nx < 10) nx = 10;
        if (ny < 10) ny = 10;
        setPos({ x: nx, y: ny });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [x, y, showDiscardInput, showSplitInput]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    const menu = menuRef.current;
    const stopPropagation = (e: Event) => e.stopPropagation();
    if (menu) {
      menu.addEventListener("mousedown", stopPropagation);
      menu.addEventListener("touchstart", stopPropagation);
    }

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      if (menu) {
        menu.removeEventListener("mousedown", stopPropagation);
        menu.removeEventListener("touchstart", stopPropagation);
      }
    };
  }, [onClose]);

  // Single item handlers
  const handleSplit = async () => {
    if (!onSplit || loading) return;
    setLoading('split');
    try {
      await onSplit(item, splitQty);
      onClose();
    } catch (e) {
      console.error("[ItemContextMenu] onSplit error:", e);
    } finally {
      setLoading(null);
    }
  };

  const handleMerge = async () => {
    if (!onMerge || loading) return;
    setLoading('merge');
    try {
      await onMerge(item);
      onClose();
    } catch (e) {
      console.error("[ItemContextMenu] onMerge error:", e);
    } finally {
      setLoading(null);
    }
  };

  const handleDiscard = async () => {
    if (!onDiscard || loading) return;
    setLoading('discard');
    try {
      await onDiscard(item, discardQty);
      onClose();
    } catch (e) {
      console.error("[ItemContextMenu] onDiscard error:", e);
    } finally {
      setLoading(null);
    }
  };

  const handleTakeOut = async () => {
    if (!onTakeOut || loading) return;
    setLoading('takeout');
    try {
      await onTakeOut(item);
      onClose();
    } catch (e) {
      console.error("[ItemContextMenu] onTakeOut error:", e);
    } finally {
      setLoading(null);
    }
  };

  const handleUseConsumable = async () => {
    if (!onUseConsumable || loading) return;
    setLoading('use');
    try {
      await onUseConsumable(item);
      onClose();
    } catch (e) {
      console.error("[ItemContextMenu] onUseConsumable error:", e);
    } finally {
      setLoading(null);
    }
  };

  const handlePublish = async () => {
    if (!onPublishDocument || loading) return;
    setLoading('publish');
    try {
      await onPublishDocument(item);
      onClose();
    } catch (e) {
      console.error("[ItemContextMenu] onPublishDocument error:", e);
    } finally {
      setLoading(null);
    }
  };

  const handleDirectDelete = async () => {
    if (!onDirectDelete || loading) return;
    setLoading('direct-delete');
    try {
      await onDirectDelete(item);
      onClose();
    } catch (e) {
      console.error("[ItemContextMenu] onDirectDelete error:", e);
    } finally {
      setLoading(null);
    }
  };

  // Batch handlers
  const handleBatchTakeOut = async () => {
    if (!onBatchTakeOut || !selectedItems || loading) return;
    setLoading('batch-takeout');
    try {
      await onBatchTakeOut(selectedItems.filter(it => it.containerId));
      onClose();
    } catch (e) {
      console.error("[ItemContextMenu] onBatchTakeOut error:", e);
    } finally {
      setLoading(null);
    }
  };

  const handleBatchDiscard = async () => {
    if (!onBatchDiscard || !selectedItems || loading) return;
    setLoading('batch-discard');
    try {
      await onBatchDiscard(selectedItems);
      onClose();
    } catch (e) {
      console.error("[ItemContextMenu] onBatchDiscard error:", e);
    } finally {
      setLoading(null);
    }
  };

  const handleBatchMerge = async () => {
    if (!onBatchMerge || !selectedItems || loading) return;
    setLoading('batch-merge');
    try {
      await onBatchMerge(selectedItems);
      onClose();
    } catch (e) {
      console.error("[ItemContextMenu] onBatchMerge error:", e);
    } finally {
      setLoading(null);
    }
  };

  const quantity = item.quantity || 1;
  const canSplit = quantity > 1 && onSplit;
  const isConsumable = !!getConsumableData(item);

  // Batch mode UI
  if (isBatchMode) {
    return (
      <div
        ref={menuRef}
        className="fixed z-[10200] bg-gray-900 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[160px] pointer-events-auto"
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-3 py-1.5 text-sm text-amber-400 border-b border-gray-700">
          已选择 {batchCount} 件物品
        </div>

        {/* Batch take out of container */}
        {batchHasContainerItems && onBatchTakeOut && (
          <button
            className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2 disabled:opacity-50"
            onClick={handleBatchTakeOut}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={!!loading}
          >
            <span>📤</span>
            <span>{loading === 'batch-takeout' ? '取出中...' : '批量取出容器'}</span>
          </button>
        )}

        {/* Batch merge stacks */}
        {onBatchMerge && (
          <button
            className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2 disabled:opacity-50"
            onClick={handleBatchMerge}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={!!loading}
          >
            <span>🔗</span>
            <span>{loading === 'batch-merge' ? '合并中...' : '批量合并同类'}</span>
          </button>
        )}

        {/* Batch discard */}
        {onBatchDiscard && (
          <button
            className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2 disabled:opacity-50"
            onClick={handleBatchDiscard}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={!!loading}
          >
            <span>🗑️</span>
            <span>{loading === 'batch-discard' ? '丢弃中...' : (hasTokenOnMap ? '批量丢弃到地图' : '批量丢弃')}</span>
          </button>
        )}
      </div>
    );
  }

  // Single item mode UI
  return (
    <div
      ref={menuRef}
      className="fixed z-[10200] bg-gray-900 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[140px] pointer-events-auto"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-3 py-1.5 text-sm text-gray-300 border-b border-gray-700 truncate">
        {item.name || item.id}
      </div>

      {/* Add to hotbar */}
      {onAddToHotbar && (
        <button
          className="w-full px-3 py-2 text-left text-sm text-amber-300 hover:bg-gray-700 flex items-center gap-2"
          onClick={() => { onAddToHotbar(item); onClose(); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span>⚡</span>
          <span>添加到快捷栏</span>
        </button>
      )}

      {/* Use consumable */}
      {isConsumable && onUseConsumable && (
        <button
          className="w-full px-3 py-2 text-left text-sm text-green-400 hover:bg-gray-700 flex items-center gap-2 disabled:opacity-50"
          onClick={handleUseConsumable}
          onMouseDown={(e) => e.stopPropagation()}
          disabled={!!loading}
        >
          <span>🧪</span>
          <span>{loading === 'use' ? '使用中...' : '使用'}</span>
        </button>
      )}

      {/* Write on paper (blank paper only) */}
      {isPaperItem && !item.writtenContent && onWrite && (
        <button
          className="w-full px-3 py-2 text-left text-sm text-amber-300 hover:bg-gray-700 flex items-center gap-2"
          onClick={() => { onWrite(item); onClose(); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span>✏️</span>
          <span>书写</span>
        </button>
      )}

      {/* Read written paper */}
      {item.writtenContent && onReadPaper && (
        <button
          className="w-full px-3 py-2 text-left text-sm text-amber-200 hover:bg-gray-700 flex items-center gap-2"
          onClick={() => { onReadPaper(item); onClose(); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span>📜</span>
          <span>阅读</span>
        </button>
      )}

      {/* DM publish to resource library */}
      {isDM && item.writtenContent && onPublishDocument && (
        <button
          className="w-full px-3 py-2 text-left text-sm text-blue-300 hover:bg-gray-700 flex items-center gap-2 disabled:opacity-50"
          onClick={handlePublish}
          onMouseDown={(e) => e.stopPropagation()}
          disabled={!!loading}
        >
          <span>📋</span>
          <span>{loading === 'publish' ? '发布中...' : '发布到资源库'}</span>
        </button>
      )}

      {/* Take out of container */}
      {isInContainer && onTakeOut && (
        <button
          className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2 disabled:opacity-50"
          onClick={handleTakeOut}
          onMouseDown={(e) => e.stopPropagation()}
          disabled={!!loading}
        >
          <span>📤</span>
          <span>{loading === 'takeout' ? '取出中...' : '从容器取出'}</span>
        </button>
      )}

      {/* Split stack */}
      {canSplit && !showSplitInput && (
        <button
          className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
          onClick={() => setShowSplitInput(true)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span>✂️</span>
          <span>拆分</span>
        </button>
      )}
      {showSplitInput && (
        <div className="px-3 py-2 space-y-2 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={quantity - 1}
              value={splitQty}
              onChange={(e) => setSplitQty(Math.min(quantity - 1, Math.max(1, Number(e.target.value) || 1)))}
              className="w-16 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-center"
              autoFocus
            />
            <span className="text-xs text-gray-400">/ {quantity}</span>
          </div>
          <div className="flex gap-2">
            <button
              className="flex-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-50"
              onClick={handleSplit}
              onMouseDown={(e) => e.stopPropagation()}
              disabled={!!loading}
            >
              {loading === 'split' ? '拆分中...' : '确认'}
            </button>
            <button
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
              onClick={() => setShowSplitInput(false)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Merge stacks */}
      {onMerge && (
        <button
          className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2 disabled:opacity-50"
          onClick={handleMerge}
          onMouseDown={(e) => e.stopPropagation()}
          disabled={!!loading}
        >
          <span>🔗</span>
          <span>{loading === 'merge' ? '合并中...' : '合并相同物品'}</span>
        </button>
      )}

      {/* Discard */}
      {onDiscard && !showDiscardInput && (
        <button
          className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2"
          onClick={() => setShowDiscardInput(true)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span>🗑️</span>
          <span>{hasTokenOnMap ? '丢弃到地图' : '丢弃'}</span>
        </button>
      )}
      {showDiscardInput && (
        <div className="px-3 py-2 space-y-2 border-t border-gray-700">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={quantity}
              value={discardQty}
              onChange={(e) => setDiscardQty(Math.min(quantity, Math.max(1, Number(e.target.value) || 1)))}
              className="w-16 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-center"
              autoFocus
            />
            <span className="text-xs text-gray-400">/ {quantity}</span>
          </div>
          <div className="flex gap-2">
            <button
              className="flex-1 px-2 py-1 text-xs bg-red-600 hover:bg-red-500 rounded disabled:opacity-50"
              onClick={handleDiscard}
              onMouseDown={(e) => e.stopPropagation()}
              disabled={!!loading}
            >
              {loading === 'discard' ? '丢弃中...' : '确认丢弃'}
            </button>
            <button
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
              onClick={() => setShowDiscardInput(false)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* DM direct delete (skip quantity confirmation) */}
      {isDM && onDirectDelete && (
        <button
          className="w-full px-3 py-2 text-left text-sm text-red-500 hover:bg-red-900/30 flex items-center gap-2 disabled:opacity-50 border-t border-gray-700"
          onClick={handleDirectDelete}
          onMouseDown={(e) => e.stopPropagation()}
          disabled={!!loading}
        >
          <span>❌</span>
          <span>{loading === 'direct-delete' ? '删除中...' : '直接删除'}</span>
        </button>
      )}
    </div>
  );
}
