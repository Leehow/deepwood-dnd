/**
 * SpellFilter Component
 * 法术筛选器组件 - 提供搜索和多维度筛选功能
 */

import { useState, useCallback } from 'react'
import type { SpellFilterOptions, SpellSchool, SpellClass } from '~/types/spell'
import { cn } from '~/utils/cn'

interface SpellFilterProps {
  onFilterChange: (filters: SpellFilterOptions) => void
  className?: string
}

// 法术等级选项
const levelOptions = [
  { value: 0, label: '戏法' },
  { value: 1, label: '1环' },
  { value: 2, label: '2环' },
  { value: 3, label: '3环' },
  { value: 4, label: '4环' },
  { value: 5, label: '5环' },
  { value: 6, label: '6环' },
  { value: 7, label: '7环' },
  { value: 8, label: '8环' },
  { value: 9, label: '9环' }
]

// 法术学派选项
const schoolOptions: { value: SpellSchool; label: string }[] = [
  { value: 'abjuration', label: '防护' },
  { value: 'conjuration', label: '咒法' },
  { value: 'divination', label: '预言' },
  { value: 'enchantment', label: '惑控' },
  { value: 'evocation', label: '塑能' },
  { value: 'illusion', label: '幻术' },
  { value: 'necromancy', label: '死灵' },
  { value: 'transmutation', label: '变化' }
]

// 职业选项
const classOptions: { value: SpellClass; label: string }[] = [
  { value: 'bard', label: '吟游诗人' },
  { value: 'cleric', label: '牧师' },
  { value: 'druid', label: '德鲁伊' },
  { value: 'paladin', label: '圣骑士' },
  { value: 'ranger', label: '游侠' },
  { value: 'sorcerer', label: '术士' },
  { value: 'warlock', label: '邪术师' },
  { value: 'wizard', label: '法师' }
]

export function SpellFilter({ onFilterChange, className }: SpellFilterProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [filters, setFilters] = useState<SpellFilterOptions>({})
  const [searchText, setSearchText] = useState('')

  // 更新筛选条件
  const updateFilters = useCallback((newFilters: SpellFilterOptions) => {
    setFilters(newFilters)
    onFilterChange(newFilters)
  }, [onFilterChange])

  // 处理搜索文本变化
  const handleSearchChange = (text: string) => {
    setSearchText(text)
    updateFilters({ ...filters, searchText: text })
  }

  // 切换等级筛选
  const toggleLevel = (level: number) => {
    const currentLevels = filters.levels || []
    const newLevels = currentLevels.includes(level)
      ? currentLevels.filter(l => l !== level)
      : [...currentLevels, level]

    updateFilters({ ...filters, levels: newLevels.length > 0 ? newLevels : undefined })
  }

  // 切换学派筛选
  const toggleSchool = (school: SpellSchool) => {
    const currentSchools = filters.schools || []
    const newSchools = currentSchools.includes(school)
      ? currentSchools.filter(s => s !== school)
      : [...currentSchools, school]

    updateFilters({ ...filters, schools: newSchools.length > 0 ? newSchools : undefined })
  }

  // 切换职业筛选
  const toggleClass = (cls: SpellClass) => {
    const currentClasses = filters.classes || []
    const newClasses = currentClasses.includes(cls)
      ? currentClasses.filter(c => c !== cls)
      : [...currentClasses, cls]

    updateFilters({ ...filters, classes: newClasses.length > 0 ? newClasses : undefined })
  }

  // 清除所有筛选
  const clearFilters = () => {
    setSearchText('')
    setFilters({})
    onFilterChange({})
  }

  // 获取活跃的筛选数量
  const activeFilterCount = [
    filters.levels?.length || 0,
    filters.schools?.length || 0,
    filters.classes?.length || 0,
    filters.ritual ? 1 : 0,
    filters.concentration ? 1 : 0
  ].reduce((sum, count) => sum + (count > 0 ? 1 : 0), 0)

  return (
    <div className={cn('space-y-4', className)}>
      {/* 搜索栏 */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">🔍</span>
          <input
            type="text"
            value={searchText}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="搜索法术名称或描述..."
            className={cn(
              'w-full pl-10 pr-3 py-2 border rounded-lg',
              'bg-gray-900/60 text-gray-200 placeholder-gray-500', // Dark translucent input
              'border-gray-700 focus:border-purple-500',
              'focus:outline-none focus:ring-2 focus:ring-purple-500/50'
            )}
          />
        </div>

        {/* 筛选器按钮 */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            'px-4 py-2 border rounded-lg flex items-center gap-2',
            'bg-gray-800/60 text-gray-300', // Dark button
            'border-gray-700 hover:bg-gray-700/60 hover:text-white',
            'transition-colors backdrop-blur-sm'
          )}
        >
          <span>⚙️</span>
          <span>筛选</span>
          {activeFilterCount > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-purple-600 text-white rounded-full">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* 清除按钮 */}
        {(searchText || activeFilterCount > 0) && (
          <button
            onClick={clearFilters}
            className={cn(
              'px-4 py-2 border rounded-lg flex items-center gap-2',
              'bg-gray-800/60 text-gray-300',
              'border-gray-700 hover:bg-red-900/30 hover:text-red-300 hover:border-red-800',
              'transition-colors backdrop-blur-sm'
            )}
          >
            <span>❌</span>
            <span>清除</span>
          </button>
        )}
      </div>

      {/* 展开的筛选选项 */}
      {isExpanded && (
        <div className={cn(
          'p-4 border rounded-lg space-y-4 backdrop-blur-md',
          'bg-gray-900/40 border-gray-700/50' // Dark translucent panel
        )}>
          {/* 法术等级 */}
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2">
              法术等级
            </h4>
            <div className="flex flex-wrap gap-2">
              {levelOptions.map(option => (
                <button
                  key={option.value}
                  onClick={() => toggleLevel(option.value)}
                  className={cn(
                    'px-3 py-1 text-sm rounded-full border transition-colors',
                    filters.levels?.includes(option.value)
                      ? 'bg-purple-600 text-white border-purple-500'
                      : 'bg-gray-800/50 text-gray-400 border-gray-700 hover:border-gray-500 hover:text-gray-200'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* 法术学派 */}
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2">
              法术学派
            </h4>
            <div className="flex flex-wrap gap-2">
              {schoolOptions.map(option => (
                <button
                  key={option.value}
                  onClick={() => toggleSchool(option.value)}
                  className={cn(
                    'px-3 py-1 text-sm rounded-full border transition-colors',
                    filters.schools?.includes(option.value)
                      ? 'bg-purple-600 text-white border-purple-500'
                      : 'bg-gray-800/50 text-gray-400 border-gray-700 hover:border-gray-500 hover:text-gray-200'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* 职业 */}
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2">
              职业
            </h4>
            <div className="flex flex-wrap gap-2">
              {classOptions.map(option => (
                <button
                  key={option.value}
                  onClick={() => toggleClass(option.value)}
                  className={cn(
                    'px-3 py-1 text-sm rounded-full border transition-colors',
                    filters.classes?.includes(option.value)
                      ? 'bg-purple-600 text-white border-purple-500'
                      : 'bg-gray-800/50 text-gray-400 border-gray-700 hover:border-gray-500 hover:text-gray-200'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* 特殊筛选 */}
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2">
              特殊属性
            </h4>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer hover:text-gray-200 transition-colors">
                <input
                  type="checkbox"
                  checked={filters.ritual === true}
                  onChange={(e) => updateFilters({ ...filters, ritual: e.target.checked || undefined })}
                  className="w-4 h-4 text-purple-600 border-gray-600 rounded focus:ring-purple-500 bg-gray-800"
                />
                <span className="text-sm text-gray-400">仪式法术</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:text-gray-200 transition-colors">
                <input
                  type="checkbox"
                  checked={filters.concentration === true}
                  onChange={(e) => updateFilters({ ...filters, concentration: e.target.checked || undefined })}
                  className="w-4 h-4 text-purple-600 border-gray-600 rounded focus:ring-purple-500 bg-gray-800"
                />
                <span className="text-sm text-gray-400">专注法术</span>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
