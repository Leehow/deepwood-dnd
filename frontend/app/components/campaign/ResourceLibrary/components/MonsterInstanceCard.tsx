/**
 * MonsterInstanceCard Component
 * Displays a monster instance with avatar, stats, and actions
 */

import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Flex, Text } from '@radix-ui/themes';
import type { MonsterInstance } from '../types';
import { getAssetUrl } from '~/utils/asset-url';
import { dndSizeToTokenSize } from '~/components/map/utils/mapCalculations';
import { TokenSizeSelector } from './TokenSizeSelector';

interface MonsterInstanceCardProps {
  monsterInstance: MonsterInstance;
  onGenerateAvatar: (id: number) => void;
  onPlaceToken: (id: number, tokenSize?: string) => void;
  onUpdateSize: (id: number, size: string) => void;
  onDelete: (id: number) => void;
  onOpenDetail?: (monster: MonsterInstance) => void;
  isGeneratingAvatar?: boolean;
  hasTokenOnMap?: boolean;
}

export const MonsterInstanceCard = React.memo(({
  monsterInstance,
  onGenerateAvatar,
  onPlaceToken,
  onDelete,
  onOpenDetail,
  isGeneratingAvatar = false,
}: MonsterInstanceCardProps) => {
  const [showPlaceSuccess, setShowPlaceSuccess] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showSizeSelector, setShowSizeSelector] = useState(false);
  const placeButtonRef = useRef<HTMLButtonElement>(null);
  const isNpc = monsterInstance.entity_type === 'npc';

  // Auto-place token using creature size, or show selector if size unknown
  const handlePlaceClick = useCallback(async () => {
    if (monsterInstance.size) {
      const tokenSize = dndSizeToTokenSize(monsterInstance.size);
      await onPlaceToken(monsterInstance.id, tokenSize);
      setShowPlaceSuccess(true);
      setTimeout(() => setShowPlaceSuccess(false), 2000);
    } else {
      setShowSizeSelector(true);
    }
  }, [monsterInstance.id, monsterInstance.size, onPlaceToken]);

  // Resolve avatar URL - handles both OSS URLs and local asset paths
  const avatarUrl = useMemo(() => {
    if (!monsterInstance.avatar_url) return null;
    // If it's a local asset path (starts with /assets/), resolve via getAssetUrl
    if (monsterInstance.avatar_url.startsWith('/assets/')) {
      return getAssetUrl(monsterInstance.avatar_url.slice(1)); // Remove leading slash
    }
    // Otherwise it's already a full URL (OSS or other)
    return monsterInstance.avatar_url;
  }, [monsterInstance.avatar_url]);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete(monsterInstance.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div
      className="group relative bg-gradient-to-br from-gray-800/80 to-gray-900/80 rounded-lg border border-red-500/20 hover:border-red-500/50 transition-all duration-200 cursor-pointer overflow-hidden"
      onClick={() => onOpenDetail?.(monsterInstance)}
    >
      <Flex gap="3" p="3">
        {/* 左侧头像 */}
        <div className="flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-gray-700/50 border border-gray-600/50 flex items-center justify-center">
          {avatarUrl ? (
            <img src={avatarUrl} alt={monsterInstance.name_cn || monsterInstance.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl opacity-50">👹</span>
          )}
        </div>

        {/* 右侧信息 */}
        <div className="flex-1 min-w-0">
          <div className="min-w-0 flex-1">
            <Text size="2" weight="bold" className="text-red-200 truncate block">
              {monsterInstance.name_cn || monsterInstance.name}
            </Text>
            {/* Compact stats - single line with dot separators */}
            <p className="text-[10px] text-stone-400 mt-1 truncate">
              {[
                monsterInstance.challenge_rating ? `CR ${monsterInstance.challenge_rating}` : null,
                `HP ${monsterInstance.current_hp || monsterInstance.hit_points}/${monsterInstance.hit_points}`,
                `AC ${monsterInstance.armor_class}`,
                monsterInstance.alignment,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>

          {/* 操作按钮组 - bottom row */}
          <Flex gap="1" mt="1" className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              className="w-7 h-7 rounded flex items-center justify-center bg-purple-500/20 hover:bg-purple-500/40 text-purple-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={monsterInstance.has_avatar ? '更换头像' : '选择或生成头像'}
              disabled={isGeneratingAvatar}
              onClick={() => onGenerateAvatar(monsterInstance.id)}
            >
              {isGeneratingAvatar ? <span className="animate-spin">⏳</span> : '🎨'}
            </button>
            <button
              ref={placeButtonRef}
              className="w-7 h-7 rounded flex items-center justify-center bg-amber-500/20 hover:bg-amber-500/40 text-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="生成到地图"
              disabled={!monsterInstance.has_avatar}
              onClick={handlePlaceClick}
            >
              📍
            </button>
            {showSizeSelector && (
              <TokenSizeSelector
                defaultSize={monsterInstance.token_size || '1x1'}
                anchorRef={placeButtonRef}
                onSelect={async (size) => {
                  setShowSizeSelector(false);
                  await onPlaceToken(monsterInstance.id, size);
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
              title={confirmDelete ? '再次点击确认删除' : '删除怪物'}
              onClick={handleDeleteClick}
            >
              {confirmDelete ? '!' : '🗑'}
            </button>
          </Flex>

          {/* 类型信息 */}
          {(monsterInstance.size || monsterInstance.type) && (
            <Text size="1" className="text-gray-500 mt-1 truncate block">
              {[monsterInstance.size, monsterInstance.type].filter(Boolean).join(' · ')}
            </Text>
          )}

          {/* NPC角色和描述 */}
          {isNpc && monsterInstance.monster_data?.role && (
            <Text size="1" className="text-emerald-400/80 mt-1 truncate block">
              {monsterInstance.monster_data.role}
            </Text>
          )}
          {isNpc && monsterInstance.monster_data?.description && (
            <Text size="1" className="text-gray-400 mt-1 line-clamp-2">
              {monsterInstance.monster_data.description}
            </Text>
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
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-red-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
});

MonsterInstanceCard.displayName = 'MonsterInstanceCard';
