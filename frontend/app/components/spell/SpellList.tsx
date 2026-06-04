/**
 * SpellList Component
 * 法术列表组件 - 显示法术卡片列表（简化版，暂不使用虚拟滚动）
 */

import { useRef, useEffect, useState } from 'react'
import type { Spell } from '~/types/spell'
import { SpellCard } from './SpellCard'
import { cn } from '~/utils/cn'

interface SpellListProps {
  spells: Spell[]
  onSpellClick?: (spell: Spell) => void
  loading?: boolean
  emptyMessage?: string
  className?: string
  viewMode?: 'grid' | 'list'
}

export function SpellList({
  spells,
  onSpellClick,
  loading = false,
  emptyMessage = '没有找到法术',
  className,
  viewMode = 'grid'
}: SpellListProps) {
  // 加载状态
  if (loading) {
    return (
      <div className={cn('flex items-center justify-center h-64', className)}>
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">加载法术数据中...</p>
        </div>
      </div>
    )
  }

  // 空状态
  if (!spells || spells.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-64', className)}>
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">{emptyMessage}</p>
        </div>
      </div>
    )
  }

  // 列表视图
  if (viewMode === 'list') {
    return (
      <div className={cn('space-y-4', className)}>
        {spells.map(spell => (
          <SpellCard
            key={spell.id}
            spell={spell}
            onClick={onSpellClick}
            variant="compact"
          />
        ))}
      </div>
    )
  }

  // 网格视图（简化版，不使用虚拟滚动）
  return (
    <div className={cn('grid gap-4', className, {
      'grid-cols-1': true,
      'sm:grid-cols-2': viewMode === 'grid',
      'lg:grid-cols-3': viewMode === 'grid',
      'xl:grid-cols-4': viewMode === 'grid'
    })}>
      {spells.map(spell => (
        <SpellCard
          key={spell.id}
          spell={spell}
          onClick={onSpellClick}
          variant="compact"
          className="h-full"
        />
      ))}
    </div>
  )
}