/**
 * Spells Page
 * 法术列表页面 - 展示所有法术，支持搜索和筛选
 */

import { useState, useEffect, useCallback } from 'react'
import { useLoaderData, Link, useNavigate } from 'react-router'
import { spellDataLoader } from '~/services/spellDataLoader'
import type { Spell, SpellFilterOptions, SpellSortOption } from '~/types/spell'
import { SpellList } from '~/components/spell/SpellList'
import { SpellFilter } from '~/components/spell/SpellFilter'
import { SpellDetailModal } from '~/components/spell/SpellSelectableCard'
import { cn } from '~/utils/cn'
import { Box, Button, Container, Flex, Heading, Text, IconButton, Separator } from '@radix-ui/themes'
import { MagnifyingGlassIcon, GridIcon, ListBulletIcon, ArrowLeftIcon } from '@radix-ui/react-icons'

// Loader 函数 - 服务端运行
export const loader = async () => {
  return { initialData: null }
}

export default function SpellsPage() {
  const navigate = useNavigate();
  const loaderData = useLoaderData<typeof loader>()

  // 状态管理
  const [spells, setSpells] = useState<Spell[]>([])
  const [filteredSpells, setFilteredSpells] = useState<Spell[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSpell, setSelectedSpell] = useState<Spell | null>(null)

  // UI 状态
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sortBy, setSortBy] = useState<SpellSortOption>('level')
  const [filters, setFilters] = useState<SpellFilterOptions>({})

  // 统计信息
  const [statistics, setStatistics] = useState<any>(null)

  // 加载法术数据
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError(null)

      try {
        const data = await spellDataLoader.loadSpellData()
        const allSpells = spellDataLoader.getAllSpells()
        setSpells(allSpells)
        setFilteredSpells(allSpells)
        const stats = spellDataLoader.getStatistics()
        setStatistics(stats)
      } catch (err) {
        console.error('Failed to load spells:', err)
        setError('加载法术数据失败，请刷新页面重试')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  // 处理筛选变化
  const handleFilterChange = useCallback((newFilters: SpellFilterOptions) => {
    setFilters(newFilters)
    const filtered = spellDataLoader.filterSpells(newFilters)
    const sorted = spellDataLoader.sortSpells(filtered, sortBy)
    setFilteredSpells(sorted)
  }, [sortBy])

  // 处理排序变化
  const handleSortChange = (newSort: SpellSortOption) => {
    setSortBy(newSort)
    const sorted = spellDataLoader.sortSpells(filteredSpells, newSort)
    setFilteredSpells(sorted)
  }

  // 处理法术点击
  const handleSpellClick = (spell: Spell) => {
    setSelectedSpell(spell)
  }

  // 关闭法术详情
  const closeSpellDetail = () => {
    setSelectedSpell(null)
  }

  return (
    <Box className="min-h-screen bg-gray-950 text-gray-100 relative" style={{ paddingTop: 'var(--sat, 0px)' }}>
       {/* Hero Background */}
       <div
        className="fixed inset-0 z-0"
        style={{
          backgroundImage: "url('/images/ui/spells-bg.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: 0.15
        }}
      />
      
      {/* 顶部导航 */}
      <Box className="sticky z-50 border-b border-purple-500/20 bg-gray-900/90 backdrop-blur-md shadow-lg shadow-purple-900/10" style={{ top: 'var(--sat, 0px)' }}>
        <Container size="4" className="px-4 sm:px-6 md:px-8">
          <Flex justify="between" align="center" height="64px">
            <Flex align="center" gap="3">
              <IconButton variant="ghost" color="gray" onClick={() => navigate('/')}>
                 <ArrowLeftIcon />
              </IconButton>
              <Heading size="5" className="font-fantasy text-purple-100 tracking-wider">
                Arcane <span className="text-purple-400">Library</span>
              </Heading>
            </Flex>
            <Flex gap="3">
              <Button variant="ghost" color="gray" onClick={() => navigate('/character')}>
                我的角色
              </Button>
            </Flex>
          </Flex>
        </Container>
      </Box>

      {/* 主要内容 */}
      <Box className="relative z-10 py-8 px-4 sm:px-6 md:px-8">
        <Container size="4">
          
          {/* Header Section */}
          <Box mb="6" className="text-center sm:text-left">
            <Heading size="9" className="font-fantasy text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-400 mb-2">
              法术大全
            </Heading>
            <p className="text-gray-400 text-lg max-w-2xl">
              探索 {statistics?.total || 0} 个已知法术，掌握奥术的秘密。
            </p>
          </Box>

          {/* 筛选栏和工具栏 */}
          <Box className="bg-gray-900/80 backdrop-blur-md border border-gray-800 rounded-xl p-4 mb-6 shadow-xl">
            <SpellFilter onFilterChange={handleFilterChange} />
            
            <Separator size="4" className="my-4 opacity-20" />

            <Flex justify="between" align="center" wrap="wrap" gap="3">
              {/* 结果统计 */}
              <div className="text-sm text-gray-400">
                {filteredSpells.length === spells.length ? (
                  `显示全部 ${filteredSpells.length} 个法术`
                ) : (
                  `显示 ${filteredSpells.length} / ${spells.length} 个法术`
                )}
              </div>

              {/* 视图切换和排序 */}
              <Flex gap="3" align="center">
                <select
                  value={sortBy}
                  onChange={(e) => handleSortChange(e.target.value as SpellSortOption)}
                  className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-md focus:ring-purple-500 focus:border-purple-500 block p-2.5"
                >
                  <option value="level">按等级排序</option>
                  <option value="name">按名称排序</option>
                  <option value="school">按学派排序</option>
                  <option value="castingTime">按施法时间排序</option>
                </select>

                <Flex className="bg-gray-800 rounded-md p-1 border border-gray-700">
                  <IconButton
                    variant={viewMode === 'grid' ? 'solid' : 'ghost'}
                    color={viewMode === 'grid' ? 'purple' : 'gray'}
                    onClick={() => setViewMode('grid')}
                    size="2"
                  >
                    <GridIcon />
                  </IconButton>
                  <IconButton
                    variant={viewMode === 'list' ? 'solid' : 'ghost'}
                    color={viewMode === 'list' ? 'purple' : 'gray'}
                    onClick={() => setViewMode('list')}
                    size="2"
                  >
                    <ListBulletIcon />
                  </IconButton>
                </Flex>
              </Flex>
            </Flex>
          </Box>

          {/* 错误状态 */}
          {error && (
            <div className="mb-6 p-4 bg-red-900/30 border border-red-800 rounded-lg backdrop-blur-sm">
              <p className="text-red-400">{error}</p>
            </div>
          )}

          {/* 法术列表 */}
          <div className="relative min-h-[500px]">
            <SpellList
              spells={filteredSpells}
              onSpellClick={handleSpellClick}
              loading={loading}
              emptyMessage={filters.searchText ? '没有找到匹配的法术' : '正在从位面召唤数据...'}
              viewMode={viewMode}
            />
          </div>
        </Container>
      </Box>

      {/* 法术详情模态框（统一组件） */}
      <SpellDetailModal spell={selectedSpell} onClose={closeSpellDetail} />

      {/* 统计信息浮窗 */}
      {statistics && !loading && (
        <div className="hidden xl:block fixed bottom-8 right-8 p-4 bg-gray-900/90 backdrop-blur-md rounded-lg shadow-2xl border border-gray-800 max-w-xs z-50">
          <Heading size="2" mb="2" className="text-purple-300 font-fantasy">
            魔网统计
          </Heading>
          <div className="space-y-1 text-xs text-gray-400">
            <Flex justify="between"><span>戏法:</span> <span className="text-gray-200">{statistics.byLevel[0] || 0}</span></Flex>
            <Flex justify="between"><span>1-3环:</span> <span className="text-gray-200">{(statistics.byLevel[1] || 0) + (statistics.byLevel[2] || 0) + (statistics.byLevel[3] || 0)}</span></Flex>
            <Flex justify="between"><span>4-6环:</span> <span className="text-gray-200">{(statistics.byLevel[4] || 0) + (statistics.byLevel[5] || 0) + (statistics.byLevel[6] || 0)}</span></Flex>
            <Flex justify="between"><span>7-9环:</span> <span className="text-gray-200">{(statistics.byLevel[7] || 0) + (statistics.byLevel[8] || 0) + (statistics.byLevel[9] || 0)}</span></Flex>
            <Separator className="my-2 bg-gray-700" />
            <Flex justify="between"><span>仪式法术:</span> <span className="text-blue-300">{statistics.ritualSpells}</span></Flex>
            <Flex justify="between"><span>专注法术:</span> <span className="text-orange-300">{statistics.concentrationSpells}</span></Flex>
          </div>
        </div>
      )}
    </Box>
  )
}
