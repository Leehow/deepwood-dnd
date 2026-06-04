import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EquipmentItem, EquipSlot } from "../../types/Character";
import { getConsumableData } from "../../utils/consumableUtils";
import { findWeaponMetaById } from "../../utils/rules";

interface Props {
  x: number;
  y: number;
  item: EquipmentItem;
  slot: EquipSlot;
  onClose: () => void;
  onUse: () => void;
  onReplace: () => void;
  onDetail: () => void;
}

/** Determine if the item can be "used" and what the label should be */
function getUseInfo(item: EquipmentItem, slot: EquipSlot): { canUse: boolean; label: string } {
  // Weapon in hand slots - match standard weapons, magic weapons (by equipmentType), or items with damage
  if (
    (slot === "main_hand" || slot === "off_hand") &&
    (findWeaponMetaById(item.id) || item.equipmentType === "weapon" || item.damage)
  ) {
    return { canUse: true, label: "攻击" };
  }
  // Consumable (potion, etc.)
  if (getConsumableData(item)) {
    return { canUse: true, label: "使用" };
  }
  return { canUse: false, label: "" };
}

export function EquippedItemMenu({ x, y, item, slot, onClose, onUse, onReplace, onDetail }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const { canUse, label: useLabel } = getUseInfo(item, slot);

  // Boundary detection
  useEffect(() => {
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
  }, [x, y]);

  // Close on outside click / Escape
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

  const menu = (
    <div
      ref={menuRef}
      className="fixed z-[10200] bg-gray-900 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[120px] pointer-events-auto"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      {canUse && (
        <button
          className="w-full px-3 py-1.5 text-left text-sm text-amber-400 hover:bg-gray-700 flex items-center gap-2"
          onClick={() => { onUse(); onClose(); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span>{useLabel === "攻击" ? "⚔️" : "🧪"}</span>
          <span>{useLabel}</span>
        </button>
      )}
      <button
        className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
        onClick={() => { onReplace(); onClose(); }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span>🔄</span>
        <span>替换</span>
      </button>
      <button
        className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
        onClick={() => { onDetail(); onClose(); }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span>📋</span>
        <span>详情</span>
      </button>
    </div>
  );

  return createPortal(menu, document.body);
}
