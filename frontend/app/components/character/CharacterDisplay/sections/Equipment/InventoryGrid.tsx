import React, { useCallback, useMemo, useState } from "react";
import { InventoryGridItem } from "./InventoryGridItem";
import { getIconPath } from "../../utils/rules";
import type { EquipmentItem } from "../../types/Character";

interface Props {
  items: EquipmentItem[];
  isContainer: (itemId: string) => boolean;
  getContainerContents: (containerId: string) => EquipmentItem[];
  getItemDisplayName: (item: EquipmentItem) => string;
  getItemKey: (item: EquipmentItem) => string;
  getItemWeight: (item: EquipmentItem) => number;
  canDropToGroundOnMainArea?: boolean;
  // Selection
  multiSelectMode: boolean;
  selectedItemKeys: Set<string>;
  toggleItemSelection: (item: EquipmentItem) => void;
  // Drag
  draggedItem: EquipmentItem | null;
  onDragStart: (e: React.DragEvent, item: EquipmentItem) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, item: EquipmentItem) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, item: EquipmentItem) => void;
  onDropToMainInventory?: (e: React.DragEvent) => void;
  dragOverTarget: string | null;
  // Interaction
  onItemClick: (e: React.MouseEvent, item: EquipmentItem) => void;
  onContextMenu: (e: React.MouseEvent, item: EquipmentItem) => void;
  onTouchStart: (e: React.TouchEvent, item: EquipmentItem) => void;
  onTouchEnd: () => void;
  onItemMouseDown?: (e: React.MouseEvent, item: EquipmentItem) => void;
  // Helpers
  checkIsContainer: (item: EquipmentItem) => boolean;
  canStack: (source: EquipmentItem | null, target: EquipmentItem) => boolean;
  canDropInContainer: (source: EquipmentItem | null, target: EquipmentItem) => boolean;
}

export function InventoryGrid({
  items, isContainer, getContainerContents, getItemDisplayName, getItemKey, getItemWeight, canDropToGroundOnMainArea = false,
  multiSelectMode, selectedItemKeys, toggleItemSelection,
  draggedItem, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, onDropToMainInventory, dragOverTarget,
  onItemClick, onContextMenu, onTouchStart, onTouchEnd, onItemMouseDown,
  checkIsContainer, canStack, canDropInContainer,
}: Props) {
  const [expandedContainers, setExpandedContainers] = useState<Set<string>>(new Set());

  const toggleContainer = useCallback((containerId: string) => {
    setExpandedContainers(prev => {
      const next = new Set(prev);
      if (next.has(containerId)) next.delete(containerId);
      else next.add(containerId);
      return next;
    });
  }, []);

  const getDragHighlight = useCallback((item: EquipmentItem): 'stack' | 'container' | 'hover-stack' | 'hover-container' | null => {
    if (!draggedItem) return null;
    const targetKey = getItemKey(item);
    const isHovered = dragOverTarget === targetKey;
    if (canStack(draggedItem, item)) return isHovered ? 'hover-stack' : 'stack';
    if (canDropInContainer(draggedItem, item)) return isHovered ? 'hover-container' : 'container';
    return null;
  }, [draggedItem, dragOverTarget, canStack, canDropInContainer, getItemKey]);

  const topLevelItems = useMemo(() => items.filter(it => !it.containerId), [items]);

  // Track expanded description state for containers
  const [expandedDescs, setExpandedDescs] = useState<Set<string>>(new Set());

  // Build render list: items + expanded container content rows
  const renderList: { type: 'item' | 'container-contents'; item?: EquipmentItem; containerId?: string; containerItem?: EquipmentItem; contents?: EquipmentItem[] }[] = [];

  for (const item of topLevelItems) {
    renderList.push({ type: 'item', item });
    if (checkIsContainer(item) && expandedContainers.has(item.id)) {
      const contents = getContainerContents(item.id);
      renderList.push({ type: 'container-contents', containerId: item.id, containerItem: item, contents });
    }
  }

  const renderGridItem = (item: EquipmentItem, idx: number) => {
    const itemKey = getItemKey(item);
    const isDragging = draggedItem ? getItemKey(draggedItem) === itemKey : false;
    return (
      <InventoryGridItem
        key={`${itemKey}-${idx}`}
        item={item}
        itemKey={itemKey}
        isSelected={selectedItemKeys.has(itemKey)}
        isContainer={false}
        isDragging={isDragging}
        dragHighlight={getDragHighlight(item)}
        displayName={getItemDisplayName(item)}
        weight={getItemWeight(item) * (item.quantity || 1)}
        multiSelectMode={multiSelectMode}
        onDragStart={e => onDragStart(e, item)}
        onDragEnd={onDragEnd}
        onDragOver={e => onDragOver(e, item)}
        onDragLeave={onDragLeave}
        onDrop={e => onDrop(e, item)}
        onClick={e => onItemClick(e, item)}
        onContextMenu={e => onContextMenu(e, item)}
        onTouchStart={e => onTouchStart(e, item)}
        onTouchEnd={onTouchEnd}
        onMouseDown={onItemMouseDown ? e => onItemMouseDown(e, item) : undefined}
      />
    );
  };

  const [mainDragOver, setMainDragOver] = useState(false);
  const mainDropMode = draggedItem?.containerId ? 'takeout' : 'ground';

  // Handle drop to main inventory area (for dragging items out of containers)
  const handleMainDragOver = useCallback((e: React.DragEvent) => {
    if (!draggedItem || !onDropToMainInventory) return;
    if (!draggedItem.containerId && !canDropToGroundOnMainArea) {
      setMainDragOver(false);
      return;
    }
    if ((e.target as HTMLElement | null)?.closest('[data-item-key]')) {
      setMainDragOver(false);
      return;
    }
    if ((e.target as HTMLElement | null)?.closest('[data-container-contents]')) {
      setMainDragOver(false);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setMainDragOver(true);
  }, [draggedItem, onDropToMainInventory, canDropToGroundOnMainArea]);

  const handleMainDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setMainDragOver(false);
    if (!draggedItem?.containerId && !canDropToGroundOnMainArea) return;
    if ((e.target as HTMLElement | null)?.closest('[data-item-key]')) return;
    if ((e.target as HTMLElement | null)?.closest('[data-container-contents]')) return;
    if (onDropToMainInventory && draggedItem) {
      onDropToMainInventory(e);
    }
  }, [draggedItem, onDropToMainInventory, canDropToGroundOnMainArea]);

  return (
    <div className="space-y-1.5">
      <div
        className="relative"
      >
        <div
        data-inventory-grid
        className={`grid grid-cols-5 sm:grid-cols-6 gap-1.5 justify-items-center min-h-[60px] rounded-lg transition-colors ${
          mainDragOver
            ? (
                mainDropMode === 'takeout'
                  ? 'bg-green-900/20 ring-1 ring-green-500/40'
                  : 'bg-red-900/20 ring-1 ring-red-500/40'
              )
            : ''
        }`}
        onDragOver={handleMainDragOver}
        onDragLeave={() => setMainDragOver(false)}
        onDrop={handleMainDrop}
      >
        {renderList.map((entry, idx) => {
          if (entry.type === 'container-contents') {
            const desc = entry.containerItem?.description;
            const descExpanded = entry.containerId ? expandedDescs.has(entry.containerId) : false;
            return (
              <div key={`cc-${entry.containerId}`} className="col-span-full w-full" data-container-contents>
                <div className="bg-gray-800/30 border border-gray-700/30 rounded-lg p-1.5">
                  {desc && (
                    <div
                      className="mb-1.5 px-1 text-[11px] text-gray-400 cursor-pointer hover:text-gray-300 transition-colors flex items-start gap-1"
                      onClick={() => setExpandedDescs(prev => {
                        const next = new Set(prev);
                        if (next.has(entry.containerId!)) next.delete(entry.containerId!);
                        else next.add(entry.containerId!);
                        return next;
                      })}
                    >
                      <span className={`flex-1 min-w-0 ${descExpanded ? '' : 'line-clamp-1'}`}>{desc}</span>
                      {!descExpanded && (
                        <span className="text-gray-500 shrink-0">展开</span>
                      )}
                    </div>
                  )}
                  {entry.contents && entry.contents.length > 0 ? (
                    <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5 justify-items-center">
                      {entry.contents.map((cItem, ci) => renderGridItem(cItem, ci))}
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 text-[10px] py-2">空</div>
                  )}
                </div>
              </div>
            );
          }

          const item = entry.item!;
          const isContainerItem = checkIsContainer(item);
          const itemKey = getItemKey(item);
          const isExpanded = isContainerItem && expandedContainers.has(item.id);

          if (isContainerItem) {
            const contents = getContainerContents(item.id);
            const highlight = getDragHighlight(item);
            const containerWeight = getItemWeight(item) + contents.reduce((s, c) => s + getItemWeight(c) * (c.quantity || 1), 0);
            const totalW = Math.round(containerWeight * 10) / 10;
            return (
              <div
                key={`${itemKey}-${idx}`}
                className={`relative w-14 h-14 border rounded-lg overflow-hidden cursor-grab select-none transition-all bg-cover bg-center ${
                  isExpanded ? "border-blue-500/50" : "border-gray-600"
                } ${highlight === 'hover-container' ? 'border-amber-400 border-2 scale-[1.03]' : highlight === 'container' ? 'border-blue-500/50' : ''}`}
                style={getIconPath(item) ? { backgroundImage: `url(${getIconPath(item)})` } : undefined}
                data-item-key={itemKey}
                draggable
                onDragStart={e => onDragStart(e, item)}
                onDragEnd={onDragEnd}
                onClick={() => toggleContainer(item.id)}
                onDragOver={e => onDragOver(e, item)}
                onDragLeave={onDragLeave}
                onDrop={e => onDrop(e, item)}
                onContextMenu={e => onContextMenu(e, item)}
                onMouseDown={onItemMouseDown ? e => onItemMouseDown(e, item) : undefined}
              >
                {!getIconPath(item) && (
                  <div className="absolute inset-0 flex items-center justify-center text-lg opacity-50 pointer-events-none">📦</div>
                )}
                {contents.length > 0 && (
                  <div className="absolute top-0.5 right-0.5 px-1 min-w-[16px] h-4 bg-black/70 rounded text-[9px] text-blue-300 font-medium flex items-center justify-center pointer-events-none">
                    {contents.length}
                  </div>
                )}
                <div className="absolute top-0.5 left-0.5 text-[10px] text-gray-400 pointer-events-none">
                  {isExpanded ? "▼" : "▶"}
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 to-transparent px-0.5 pt-2 pb-0.5 pointer-events-none">
                  <div className="text-[9px] text-gray-200 truncate text-center leading-tight">
                    {getItemDisplayName(item)}
                  </div>
                  {totalW > 0 && (
                    <div className="text-[8px] text-gray-400 text-center leading-tight">
                      {totalW}lb
                    </div>
                  )}
                </div>
              </div>
            );
          }

          return renderGridItem(item, idx);
        })}
        </div>
        {mainDragOver && draggedItem && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 flex justify-center">
            <div className={`px-2 py-1 rounded border text-[11px] font-medium ${
              mainDropMode === 'takeout'
                ? 'bg-green-950/85 border-green-500/40 text-green-300'
                : 'bg-red-950/85 border-red-500/40 text-red-300'
            }`}>
              {mainDropMode === 'takeout' ? '松开取出到主背包' : '松开丢到地图'}
            </div>
          </div>
        )}
      </div>

      {topLevelItems.length === 0 && (
        <div className="text-center text-gray-500 text-xs py-4">背包为空</div>
      )}
    </div>
  );
}
