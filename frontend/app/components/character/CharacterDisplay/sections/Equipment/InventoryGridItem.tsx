import React from "react";
import { getIconPath, findWeaponMetaByKey, findArmorMetaByKey, getWeaponGroupByKey } from "../../utils/rules";
import type { EquipmentItem } from "../../types/Character";

/** 返回与熟练项对应的分类标签，方便玩家对照 */
const getItemTypeTag = (item: EquipmentItem): { label: string; color: string } | null => {
  const key = item.id || item.name || '';
  // 护甲 / 盾牌
  const armorMeta = findArmorMetaByKey(key) || (item.name ? findArmorMetaByKey(item.name) : null);
  if (armorMeta?.tier === 'shield' || item.id === 'shield') return { label: '盾牌', color: 'bg-sky-700' };
  if (armorMeta || item.equipmentType === 'armor') {
    const tier = armorMeta?.tier;
    if (tier === 'light') return { label: '轻甲', color: 'bg-teal-700' };
    if (tier === 'medium') return { label: '中甲', color: 'bg-blue-700' };
    if (tier === 'heavy') return { label: '重甲', color: 'bg-indigo-700' };
    return { label: '护甲', color: 'bg-blue-700' };
  }
  // 武器
  const weaponMeta = findWeaponMetaByKey(key) || (item.name ? findWeaponMetaByKey(item.name) : null);
  if (weaponMeta || item.equipmentType === 'weapon') {
    const info = getWeaponGroupByKey(key) || (item.name ? getWeaponGroupByKey(item.name) : null);
    if (info?.group === 'simple') return { label: '简易', color: 'bg-orange-700' };
    if (info?.group === 'martial') return { label: '军用', color: 'bg-red-700' };
    return { label: '武器', color: 'bg-red-700' };
  }
  return null;
};

interface Props {
  item: EquipmentItem;
  itemKey: string;
  isSelected: boolean;
  isContainer: boolean;
  isDragging: boolean;
  dragHighlight: 'stack' | 'container' | 'hover-stack' | 'hover-container' | null;
  displayName: string;
  weight: number;
  multiSelectMode: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
}

export function InventoryGridItem({
  item, itemKey, isSelected, isContainer, isDragging,
  dragHighlight, displayName, weight, multiSelectMode,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
  onClick, onContextMenu, onTouchStart, onTouchEnd, onMouseDown,
}: Props) {
  const iconPath = getIconPath(item);
  const qty = item.quantity || 1;
  const typeTag = getItemTypeTag(item);

  let borderClass = "border-gray-700/50";
  let bgClass = "bg-gray-800/50";
  let scaleClass = "";
  let opacityClass = "";

  if (isDragging) {
    opacityClass = "opacity-40 scale-95";
  } else if (dragHighlight === 'hover-stack') {
    borderClass = "border-green-400 border-2";
    bgClass = "bg-green-900/40";
    scaleClass = "scale-[1.03]";
  } else if (dragHighlight === 'hover-container') {
    borderClass = "border-amber-400 border-2";
    bgClass = "bg-amber-900/40";
    scaleClass = "scale-[1.03]";
  } else if (dragHighlight === 'stack') {
    borderClass = "border-green-500/50";
    bgClass = "bg-green-900/20";
  } else if (dragHighlight === 'container') {
    borderClass = "border-blue-500/50";
    bgClass = "bg-blue-900/20";
  } else if (isSelected) {
    borderClass = "border-amber-400";
    bgClass = "bg-amber-900/20";
  }

  return (
    <div
      className={`relative w-14 h-14 border rounded-lg overflow-hidden cursor-grab select-none transition-all duration-100 bg-cover bg-center ${borderClass} ${scaleClass} ${opacityClass}`}
      style={iconPath ? { backgroundImage: `url(${iconPath})` } : undefined}
      data-item-key={itemKey}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchEnd}
      onMouseDown={onMouseDown}
    >
      {/* Background color layer (behind the background-image) */}
      {!iconPath && (
        <div className={`absolute inset-0 ${bgClass} pointer-events-none`} />
      )}
      {!iconPath && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-lg opacity-30">📦</span>
        </div>
      )}

      {/* Multi-select checkbox indicator */}
      {multiSelectMode && (
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded border flex items-center justify-center z-10 ${
          isSelected ? "bg-amber-500 border-amber-400" : "bg-black/50 border-gray-500"
        }`}>
          {isSelected && <span className="text-[10px] text-black font-bold">✓</span>}
        </div>
      )}

      {/* Equipped slot indicator (top-left gold triangle) - only when not in multi-select */}
      {!multiSelectMode && item.equippedSlot && (
        <div className="absolute top-0 left-0 w-0 h-0 pointer-events-none" style={{
          borderLeft: "12px solid rgb(251 191 36)",
          borderBottom: "12px solid transparent",
        }} />
      )}

      {/* Type tag (top-right) */}
      {!multiSelectMode && typeTag && (
        <div className={`absolute top-0 right-0 px-0.5 ${typeTag.color} rounded-bl text-[7px] text-white/90 font-medium leading-none py-[2px] pointer-events-none`}>
          {typeTag.label}
        </div>
      )}

      {/* Quantity badge (top-right, below type tag) */}
      {qty > 1 && (
        <div className={`absolute ${typeTag && !multiSelectMode ? 'top-3' : 'top-0.5'} right-0.5 px-0.5 min-w-[16px] h-3.5 bg-black/70 rounded text-[9px] text-amber-300 font-medium flex items-center justify-center pointer-events-none`}>
          x{qty}
        </div>
      )}

      {/* Container badge */}
      {isContainer && !multiSelectMode && (
        <div className="absolute top-0.5 left-0.5 w-4 h-4 flex items-center justify-center text-[10px] pointer-events-none">
          📁
        </div>
      )}

      {/* Written paper pencil badge */}
      {item.writtenContent && !multiSelectMode && (
        <div className="absolute bottom-5 right-0.5 w-3.5 h-3.5 bg-amber-900/80 rounded-full flex items-center justify-center pointer-events-none">
          <svg className="w-2.5 h-2.5 text-amber-300" viewBox="0 0 16 16" fill="currentColor">
            <path d="M12.146.854a.5.5 0 00-.707 0L3.5 8.793 3 13l4.207-.5 7.939-7.939a.5.5 0 000-.707l-3-3zM4.5 11.5l-.354-.354L10.793 4.5l.707.707L4.854 11.854 4.5 11.5z" />
          </svg>
        </div>
      )}

      {/* Bottom overlay: name + weight */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 to-transparent px-0.5 pt-2 pb-0.5 pointer-events-none">
        <div className="text-[9px] text-gray-200 truncate text-center leading-tight">
          {displayName}
        </div>
        {weight > 0 && (
          <div className="text-[8px] text-gray-400 text-center leading-tight">
            {weight}lb
          </div>
        )}
      </div>
    </div>
  );
}
