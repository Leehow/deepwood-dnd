/**
 * Spell Data Loader Service
 * 法术数据加载和管理服务
 */

import type {
  Spell,
  SpellData,
  SpellFilterOptions,
  SpellSortOption,
  SpellSchool,
  SpellClass
} from '~/types/spell'

class SpellDataLoader {
  private static instance: SpellDataLoader
  private spellData: SpellData | null = null
  private spellMap: Map<string, Spell> = new Map()
  private spellsByLevel: Map<number, Spell[]> = new Map()
  private spellsByClass: Map<SpellClass, Spell[]> = new Map()
  private spellsBySchool: Map<SpellSchool, Spell[]> = new Map()
  private isLoading = false
  private loadPromise: Promise<SpellData> | null = null

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): SpellDataLoader {
    if (!SpellDataLoader.instance) {
      SpellDataLoader.instance = new SpellDataLoader()
    }
    return SpellDataLoader.instance
  }

  /**
   * 加载法术数据
   */
  async loadSpellData(): Promise<SpellData> {
    // 如果正在加载，返回现有的 promise
    if (this.isLoading && this.loadPromise) {
      return this.loadPromise
    }

    // 如果已经加载，直接返回数据
    if (this.spellData) {
      return this.spellData
    }

    this.isLoading = true
    this.loadPromise = this.fetchAndProcessData()

    try {
      const data = await this.loadPromise
      return data
    } finally {
      this.isLoading = false
      this.loadPromise = null
    }
  }

  private async fetchAndProcessData(): Promise<SpellData> {
    try {
      // 从唯一数据源 app/data/rules/ 加载
      const module = await import('~/data/rules/spells.json')
      const data: SpellData = module.default as any
      this.spellData = data

      // 构建索引
      this.buildIndexes(data.spells)

      // 缓存到 localStorage (可选)
      this.cacheToLocalStorage(data)

      return data
    } catch (error) {
      console.error('Error loading spell data:', error)

      // 尝试从 localStorage 恢复
      const cachedData = this.loadFromLocalStorage()
      if (cachedData) {
        this.spellData = cachedData
        this.buildIndexes(cachedData.spells)
        return cachedData
      }

      throw error
    }
  }

  /**
   * 构建索引以加快查询速度
   */
  private buildIndexes(spells: Spell[]) {
    // 清空现有索引
    this.spellMap.clear()
    this.spellsByLevel.clear()
    this.spellsByClass.clear()
    this.spellsBySchool.clear()

    // 构建各种索引
    for (const spell of spells) {
      // ID 索引
      this.spellMap.set(spell.id, spell)

      // 等级索引
      if (!this.spellsByLevel.has(spell.level)) {
        this.spellsByLevel.set(spell.level, [])
      }
      this.spellsByLevel.get(spell.level)!.push(spell)

      // 学派索引
      if (!this.spellsBySchool.has(spell.school)) {
        this.spellsBySchool.set(spell.school, [])
      }
      this.spellsBySchool.get(spell.school)!.push(spell)

      // 职业索引
      for (const cls of spell.classes) {
        if (!this.spellsByClass.has(cls)) {
          this.spellsByClass.set(cls, [])
        }
        this.spellsByClass.get(cls)!.push(spell)
      }
    }
  }

  /**
   * 缓存到 localStorage
   */
  private cacheToLocalStorage(data: SpellData) {
    try {
      const cacheData = {
        version: '1.0.0',
        timestamp: Date.now(),
        data: data
      }
      localStorage.setItem('dnd_spells_cache', JSON.stringify(cacheData))
    } catch (error) {
      console.warn('Failed to cache spell data to localStorage:', error)
    }
  }

  /**
   * 从 localStorage 加载
   */
  private loadFromLocalStorage(): SpellData | null {
    try {
      const cached = localStorage.getItem('dnd_spells_cache')
      if (!cached) return null

      const cacheData = JSON.parse(cached)

      // 检查缓存是否过期（24小时）
      const now = Date.now()
      const cacheAge = now - cacheData.timestamp
      const maxAge = 24 * 60 * 60 * 1000 // 24 hours

      if (cacheAge > maxAge) {
        localStorage.removeItem('dnd_spells_cache')
        return null
      }

      return cacheData.data
    } catch (error) {
      console.warn('Failed to load spell data from localStorage:', error)
      return null
    }
  }

  /**
   * 获取所有法术
   */
  getAllSpells(): Spell[] {
    return this.spellData?.spells || []
  }

  /**
   * 根据 ID 获取法术
   */
  getSpellById(id: string): Spell | undefined {
    return this.spellMap.get(id)
  }

  /**
   * 根据等级获取法术
   */
  getSpellsByLevel(level: number): Spell[] {
    return this.spellsByLevel.get(level) || []
  }

  /**
   * 根据职业获取法术
   */
  getSpellsByClass(className: SpellClass): Spell[] {
    return this.spellsByClass.get(className) || []
  }

  /**
   * 根据学派获取法术
   */
  getSpellsBySchool(school: SpellSchool): Spell[] {
    return this.spellsBySchool.get(school) || []
  }

  /**
   * 搜索法术
   */
  searchSpells(query: string): Spell[] {
    if (!query.trim()) return []

    const searchTerm = query.toLowerCase()
    return this.getAllSpells().filter(spell =>
      spell.name.toLowerCase().includes(searchTerm) ||
      spell.nameEn.toLowerCase().includes(searchTerm) ||
      spell.description.toLowerCase().includes(searchTerm)
    )
  }

  /**
   * 筛选法术
   */
  filterSpells(options: SpellFilterOptions): Spell[] {
    let results = this.getAllSpells()

    // 文本搜索
    if (options.searchText) {
      const searchTerm = options.searchText.toLowerCase()
      results = results.filter(spell =>
        spell.name.toLowerCase().includes(searchTerm) ||
        spell.nameEn.toLowerCase().includes(searchTerm) ||
        spell.description.toLowerCase().includes(searchTerm)
      )
    }

    // 等级筛选
    if (options.levels && options.levels.length > 0) {
      results = results.filter(spell => options.levels!.includes(spell.level))
    }

    // 学派筛选
    if (options.schools && options.schools.length > 0) {
      results = results.filter(spell => options.schools!.includes(spell.school))
    }

    // 职业筛选
    if (options.classes && options.classes.length > 0) {
      results = results.filter(spell =>
        spell.classes.some(cls => options.classes!.includes(cls))
      )
    }

    // 仪式法术筛选
    if (options.ritual !== undefined) {
      results = results.filter(spell => spell.ritual === options.ritual)
    }

    // 专注法术筛选
    if (options.concentration !== undefined) {
      results = results.filter(spell => spell.concentration === options.concentration)
    }

    return results
  }

  /**
   * 排序法术
   */
  sortSpells(spells: Spell[], sortBy: SpellSortOption): Spell[] {
    const sorted = [...spells]

    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'level':
        sorted.sort((a, b) => a.level - b.level)
        break
      case 'school':
        sorted.sort((a, b) => a.school.localeCompare(b.school))
        break
      case 'castingTime':
        sorted.sort((a, b) => a.castingTime.localeCompare(b.castingTime))
        break
    }

    return sorted
  }

  /**
   * 获取系统概览信息
   */
  getSystemOverview() {
    return this.spellData?.overview
  }

  /**
   * 获取所有法术学派
   */
  getSchools() {
    return this.spellData?.spellSystem.schools || []
  }

  /**
   * 获取所有法术等级
   */
  getSpellLevels() {
    return this.spellData?.spellSystem.spellLevels || []
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    const allSpells = this.getAllSpells()

    return {
      total: allSpells.length,
      byLevel: Object.fromEntries(
        Array.from(this.spellsByLevel.entries()).map(([level, spells]) => [
          level,
          spells.length
        ])
      ),
      bySchool: Object.fromEntries(
        Array.from(this.spellsBySchool.entries()).map(([school, spells]) => [
          school,
          spells.length
        ])
      ),
      byClass: Object.fromEntries(
        Array.from(this.spellsByClass.entries()).map(([cls, spells]) => [
          cls,
          spells.length
        ])
      ),
      ritualSpells: allSpells.filter(s => s.ritual).length,
      concentrationSpells: allSpells.filter(s => s.concentration).length
    }
  }
}

// 导出单例实例
export const spellDataLoader = SpellDataLoader.getInstance()