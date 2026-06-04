/**
 * TokenSizeSelector Component
 * A popover for selecting token size before placing on map
 * Uses React Portal to avoid overflow clipping
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

// D&D 5E token sizes
const TOKEN_SIZES = [
  { value: '1x1', label: '1×1', desc: '微型/小型/中型' },
  { value: '2x2', label: '2×2', desc: '大型' },
  { value: '3x3', label: '3×3', desc: '巨型' },
  { value: '4x4', label: '4×4', desc: '超巨型' },
];

interface TokenSizeSelectorProps {
  /** Current/default size */
  defaultSize?: string;
  /** Called when size is selected */
  onSelect: (size: string) => void;
  /** Called when selector is closed without selection */
  onCancel: () => void;
  /** Anchor element for positioning */
  anchorRef: React.RefObject<HTMLElement>;
}

export const TokenSizeSelector: React.FC<TokenSizeSelectorProps> = ({
  defaultSize = '1x1',
  onSelect,
  onCancel,
  anchorRef,
}) => {
  const [selectedSize, setSelectedSize] = useState(defaultSize);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const popoverRef = useRef<HTMLDivElement>(null);

  // Calculate position based on anchor element
  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const popoverHeight = 180; // Approximate height of popover
      const viewportHeight = window.innerHeight;

      // Check if there's enough space below
      const spaceBelow = viewportHeight - rect.bottom;
      const showAbove = spaceBelow < popoverHeight && rect.top > popoverHeight;

      setPosition({
        top: showAbove ? rect.top - popoverHeight - 4 : rect.bottom + 4,
        left: rect.right - 160, // Align right edge, popover width ~160px
      });
    }
  }, [anchorRef]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onCancel();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onCancel, anchorRef]);

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const popoverContent = (
    <div
      ref={popoverRef}
      className="fixed z-[9999] bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-2 min-w-[160px]"
      style={{ top: position.top, left: position.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-xs text-gray-400 mb-2 px-1">选择 Token 大小</div>
      <div className="flex flex-col gap-1">
        {TOKEN_SIZES.map((size) => (
          <button
            key={size.value}
            className={`flex items-center justify-between px-2 py-1.5 rounded text-sm transition-colors ${
              selectedSize === size.value
                ? 'bg-amber-500/30 text-amber-300'
                : 'hover:bg-gray-800 text-gray-300'
            }`}
            onClick={() => {
              setSelectedSize(size.value);
              onSelect(size.value);
            }}
          >
            <span className="font-medium">{size.label}</span>
            <span className="text-xs text-gray-500">{size.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );

  // Use portal to render at body level to avoid overflow clipping
  return createPortal(popoverContent, document.body);
};

export default TokenSizeSelector;
