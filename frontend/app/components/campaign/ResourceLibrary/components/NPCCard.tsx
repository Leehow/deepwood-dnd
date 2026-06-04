/**
 * NPCCard Component
 * Displays an NPC with their basic info
 */

import React from 'react';
import { Flex, Text } from '@radix-ui/themes';
import type { NPC } from '../types';

interface NPCCardProps {
  npc: NPC;
  onSelect: (id: string) => void;
  onOpenDetail?: (npc: NPC) => void;
}

export const NPCCard = React.memo(({ npc, onOpenDetail }: NPCCardProps) => {
  return (
    <div
      className="group relative bg-gradient-to-br from-gray-800/80 to-gray-900/80 rounded-lg border border-violet-500/20 hover:border-violet-500/50 transition-all duration-200 cursor-pointer overflow-hidden"
      onClick={() => onOpenDetail?.(npc)}
    >
      <Flex gap="3" p="3">
        {/* 左侧头像占位 */}
        <div className="flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-gray-700/50 border border-gray-600/50 flex items-center justify-center">
          <span className="text-2xl opacity-50">👤</span>
        </div>

        {/* 右侧信息 */}
        <div className="flex-1 min-w-0">
          <Flex justify="between" align="start">
            <div className="min-w-0 flex-1">
              <Flex align="center" gap="1">
                <Text size="2" weight="bold" className="text-violet-200 truncate">{npc.name}</Text>
                {npc.name_en && (
                  <Text size="1" className="text-gray-500 truncate">({npc.name_en})</Text>
                )}
              </Flex>
              <Flex gap="1" mt="1" wrap="wrap">
                {npc.race && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-500/20 text-violet-400 border border-violet-500/30">
                    {npc.race}
                  </span>
                )}
                {npc.occupation && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-500/20 text-gray-400 border border-gray-500/30">
                    {npc.occupation}
                  </span>
                )}
                {npc.alignment && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30">
                    {npc.alignment}
                  </span>
                )}
                {npc.faction && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    {npc.faction}
                  </span>
                )}
                {npc.is_combatant && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                    战斗
                  </span>
                )}
              </Flex>
            </div>

            {/* 战斗数据 */}
            {npc.is_combatant && (npc.hp || npc.ac) && (
              <Flex gap="1" className="flex-shrink-0 ml-2">
                {npc.hp && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                    HP {typeof npc.hp === 'object' ? ((npc.hp as any)?.average || (npc.hp as any)?.dice || '') : npc.hp}
                  </span>
                )}
                {npc.ac && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    AC {typeof npc.ac === 'object' ? ((npc.ac as any)?.value || (npc.ac as any)?.base || '') : npc.ac}
                  </span>
                )}
              </Flex>
            )}
          </Flex>

          {/* 描述预览 */}
          {npc.description && (
            <Text size="1" className="text-gray-400 mt-1.5 line-clamp-2">{npc.description}</Text>
          )}
        </div>
      </Flex>

      {/* hover 底部光条 */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-violet-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
});

NPCCard.displayName = 'NPCCard';
