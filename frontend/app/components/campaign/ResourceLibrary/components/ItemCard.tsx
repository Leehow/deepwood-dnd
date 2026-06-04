/**
 * ItemCard Component
 * Displays an item with icon, basic info, and actions (place token, delete)
 */

import React, { useState, useEffect, useRef } from 'react';
import { Flex, Text } from '@radix-ui/themes';
import type { Item } from '../types';
import { loadItemIcon } from '../utils/helpers';
import { TokenSizeSelector } from './TokenSizeSelector';
import { tCategory } from '~/config/item-i18n';

// 稀有度配置
const RARITY_CONFIG: Record<string, { label: string; color: string }> = {
  common: { label: '普通', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
  uncommon: { label: '非凡', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  rare: { label: '稀有', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  very_rare: { label: '极稀有', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  legendary: { label: '传奇', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  artifact: { label: '神器', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

interface ItemCardProps {
  item: Item;
  onPlaceToken: (id: number, tokenSize?: string) => void;
  onDelete: (id: number) => void;
  onOpenDetail?: (item: Item) => void;
  onChooseAvatarFromLibrary?: (item: Item) => void;
}

export const ItemCard = React.memo(({ item, onPlaceToken, onDelete, onOpenDetail, onChooseAvatarFromLibrary }: ItemCardProps) => {
  const [iconPath, setIconPath] = useState<string | null>(null);
  const [showPlaceSuccess, setShowPlaceSuccess] = useState(false);
  const [isGeneratingIcon, setIsGeneratingIcon] = useState(false);
  const [localAvatarUrl, setLocalAvatarUrl] = useState<string | null>(item.avatar_url || null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showSizeSelector, setShowSizeSelector] = useState(false);
  const placeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setLocalAvatarUrl(item.avatar_url || null);
  }, [item.avatar_url]);

  useEffect(() => {
    if (!item.avatar_url && !localAvatarUrl) {
      loadItemIcon(item).then(setIconPath);
    }
  }, [item.name, item.name_cn, item.avatar_url, localAvatarUrl]);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete(item.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  const handleGenerateIcon = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsGeneratingIcon(true);
    try {
      const response = await fetch(`/api/items/${item.id}/generate-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to generate icon');
      }
      const updatedItem = await response.json();
      setLocalAvatarUrl(updatedItem.avatar_url);
    } catch (error) {
      console.error('Failed to generate icon:', error);
    } finally {
      setIsGeneratingIcon(false);
    }
  };

  const rarityConfig = item.rarity ? RARITY_CONFIG[item.rarity] : null;
  const displayIcon = localAvatarUrl || iconPath;

  return (
    <div
      className="group relative bg-gradient-to-br from-gray-800/80 to-gray-900/80 rounded-lg border border-blue-500/20 hover:border-blue-500/50 transition-all duration-200 cursor-pointer overflow-hidden"
      onClick={() => onOpenDetail?.(item)}
    >
      <Flex gap="3" p="3">
        {/* 左侧图标 */}
        <div className="flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-gray-700/50 border border-gray-600/50 flex items-center justify-center">
          {displayIcon ? (
            <img
              src={displayIcon}
              alt={item.name_cn || item.name}
              className="w-full h-full object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <span className="text-2xl opacity-50">🎒</span>
          )}
        </div>

        {/* 右侧信息 */}
        <div className="flex-1 min-w-0">
          <Flex justify="between" align="start">
            <div className="min-w-0 flex-1">
              <Flex align="center" gap="1">
                <Text size="2" weight="bold" className="text-blue-200 truncate">{item.name_cn || item.name}</Text>
                {item.quantity && item.quantity > 1 && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/30 text-blue-300">×{item.quantity}</span>
                )}
              </Flex>
              <Flex gap="1" mt="1" wrap="wrap">
                {item.category && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-500/20 text-gray-400 border border-gray-500/30">
                    {tCategory(item.category)}
                  </span>
                )}
                {rarityConfig && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${rarityConfig.color}`}>
                    {rarityConfig.label}
                  </span>
                )}
                {/* 武器伤害 */}
                {item.damage && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                    ⚔️ {item.damage.dice} {item.damage.type}
                  </span>
                )}
                {/* 护甲AC */}
                {item.armor_class && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    🛡️ AC {item.armor_class.base}{item.armor_class.dex_bonus ? '+DEX' : ''}{item.armor_class.max_dex_bonus ? `(max ${item.armor_class.max_dex_bonus})` : ''}
                  </span>
                )}
                {/* 魔法加值 */}
                {item.magic_bonus && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30">
                    +{item.magic_bonus}
                  </span>
                )}
                {item.cost && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                    💰 {Object.entries(item.cost).map(([unit, value]) => `${value}${unit}`).join(' ')}
                  </span>
                )}
              </Flex>
            </div>

            {/* 操作按钮组 */}
            <Flex gap="1" className="flex-shrink-0 ml-2 relative" onClick={(e) => e.stopPropagation()}>
              <button
                className="w-7 h-7 rounded flex items-center justify-center bg-sky-500/20 hover:bg-sky-500/40 text-sky-300 transition-colors"
                title="从图库选择图片"
                onClick={(e) => {
                  e.stopPropagation();
                  onChooseAvatarFromLibrary?.(item);
                }}
              >
                🖼
              </button>
              {/* 只有没有AI生成头像且没有预设图标时才显示AI生成按钮 */}
              {!localAvatarUrl && !iconPath && (
                <button
                  className="w-7 h-7 rounded flex items-center justify-center bg-purple-500/20 hover:bg-purple-500/40 text-purple-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="AI生成图标"
                  disabled={isGeneratingIcon}
                  onClick={handleGenerateIcon}
                >
                  {isGeneratingIcon ? <span className="animate-spin">⏳</span> : '🎨'}
                </button>
              )}
              <button
                ref={placeButtonRef}
                className="w-7 h-7 rounded flex items-center justify-center bg-amber-500/20 hover:bg-amber-500/40 text-amber-400 transition-colors"
                title="生成到地图"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSizeSelector(true);
                }}
              >
                📍
              </button>
              {showSizeSelector && (
                <TokenSizeSelector
                  defaultSize="1x1"
                  anchorRef={placeButtonRef}
                  onSelect={async (size) => {
                    setShowSizeSelector(false);
                    await onPlaceToken(item.id, size);
                    setShowPlaceSuccess(true);
                    setTimeout(() => setShowPlaceSuccess(false), 2000);
                  }}
                  onCancel={() => setShowSizeSelector(false)}
                />
              )}
              <button
                className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                  confirmDelete
                    ? 'bg-red-500 text-white animate-pulse'
                    : 'bg-red-500/20 hover:bg-red-500/40 text-red-400'
                }`}
                title={confirmDelete ? '再次点击确认删除' : '删除物品'}
                onClick={handleDeleteClick}
              >
                {confirmDelete ? '!' : '🗑'}
              </button>
            </Flex>
          </Flex>

          {/* 英文名 */}
          {item.name_cn && item.name && (
            <Text size="1" className="text-gray-500 mt-0.5 truncate block">{item.name}</Text>
          )}
        </div>
      </Flex>

      {/* 成功提示 */}
      {showPlaceSuccess && (
        <div className="absolute bottom-0 left-0 right-0 bg-green-500/90 text-white text-xs text-center py-1">
          ✓ 已生成到地图
        </div>
      )}

      {/* hover 底部光条 */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
});

ItemCard.displayName = 'ItemCard';
