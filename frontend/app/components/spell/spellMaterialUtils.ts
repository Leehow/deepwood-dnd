/**
 * 法术材料验证 & 消耗工具函数
 * 仅验证 materialCost > 0 的法术（有 gp 价格的材料组件）
 */
import type { Spell } from '~/types/spell'
import type { EquipmentItem } from '~/components/character/CharacterDisplay/types/Character'

export interface SpellComponentDef {
  id: string
  name: string
  nameEn: string
  cost: { gp: number }
  costCopper: number
  weight: number
  description: string
  consumed: boolean
  usedBy: string[]
}

let _componentsCache: SpellComponentDef[] | null = null

/** 懒加载 spellComponents 数据 */
async function loadSpellComponents(): Promise<SpellComponentDef[]> {
  if (_componentsCache) return _componentsCache
  const mod = await import('~/data/rules/equipment.json')
  const data = mod.default as any
  _componentsCache = (data?.adventuringGear?.spellComponents || []) as SpellComponentDef[]
  return _componentsCache
}

/** 同步获取（首次 loadSpellComponents 后才可用，否则返回空数组） */
function getComponentsSync(): SpellComponentDef[] {
  return _componentsCache || []
}

/** 确保加载（组件挂载时调用一次） */
export async function ensureComponentsLoaded(): Promise<void> {
  await loadSpellComponents()
}

/** 法术是否需要材料验证（有 gp 价格的 M 成分） */
export function needsMaterialCheck(spell: Spell): boolean {
  return spell.materialCost != null && spell.materialCost > 0
}

/** 获取法术对应的 spellComponents 定义列表（通过 usedBy 匹配 spell.nameEn） */
export function getRequiredComponents(spell: Spell): SpellComponentDef[] {
  const components = getComponentsSync()
  const nameEn = spell.nameEn
  if (!nameEn) return []
  return components.filter(c => c.usedBy.includes(nameEn))
}

/** 提取材料核心名称（去掉价格标注如 "(10gp)" 用于模糊匹配） */
function extractCoreName(name: string): string {
  return name.replace(/\s*[（(]\d+\s*gp[)）]\s*/gi, '').trim()
}

/** 从背包中查找匹配的材料物品（id 精确匹配 + 名称模糊匹配，支持 DM 手动添加的物品） */
export function findMatchingMaterials(spell: Spell, equipment: EquipmentItem[]): EquipmentItem[] {
  const required = getRequiredComponents(spell)
  if (required.length === 0) return []
  const requiredIds = new Set(required.map(c => c.id))
  // 提取核心名称用于模糊匹配（去掉价格后缀）
  const requiredCoreNames = required.map(c => extractCoreName(c.name).toLowerCase())
  const requiredEnNames = required.map(c => c.nameEn.toLowerCase())
  return equipment.filter(e => {
    if ((e.quantity ?? 1) <= 0) return false
    // 1. id 精确匹配
    if (requiredIds.has(e.id)) return true
    // 2. 名称模糊匹配（DM 手动添加的物品名称可能不带价格后缀）
    const itemName = (e.name || '').toLowerCase()
    const itemNameEn = ((e as any).nameEn || '').toLowerCase()
    for (let i = 0; i < required.length; i++) {
      const coreName = requiredCoreNames[i]
      if (coreName && itemName.includes(coreName)) return true
      if (coreName && extractCoreName(itemName).includes(coreName)) return true
      const enName = requiredEnNames[i]
      if (enName && itemNameEn && itemNameEn.includes(enName)) return true
    }
    return false
  })
}

/** 获取材料是否为消耗型（从 spellComponents 定义取 consumed，支持名称匹配） */
export function isMaterialConsumed(materialId: string, materialName?: string): boolean {
  const components = getComponentsSync()
  // 1. id 精确匹配
  const comp = components.find(c => c.id === materialId)
  if (comp) return comp.consumed
  // 2. 名称模糊匹配（DM 手动添加的物品）
  if (materialName) {
    const coreName = extractCoreName(materialName).toLowerCase()
    const nameMatch = components.find(c =>
      extractCoreName(c.name).toLowerCase() === coreName
    )
    if (nameMatch) return nameMatch.consumed
  }
  return false
}

/** 法术是否含 M 成分 */
export function hasMaterialComponent(spell: Spell): boolean {
  return (spell.components as string[] | undefined)?.includes('M') ?? false
}

/**
 * 施法法器 ID 集合（可替代无 GP 价格的 M 成分）
 * 包括：材料包、奥术法器、德鲁伊法器、圣徽
 */
const SPELLCASTING_FOCUS_IDS = new Set([
  // 材料包
  'component_pouch',
  // 奥术法器
  'crystal', 'orb', 'rod', 'staff', 'wand',
  // 德鲁伊法器
  'mistletoe_sprig', 'totem', 'wooden_staff', 'yew_wand',
  // 圣徽
  'amulet', 'emblem', 'reliquary',
])

/**
 * 获取法术可用的材料列表（含法器替代逻辑）
 * - GP 法术（materialCost > 0）：只返回 spellComponents 匹配的背包物品
 * - 非 GP 的 M 成分法术：返回匹配的具体材料 + 背包中的法器/材料包
 * - 无 M 成分 → 空数组
 */
export function getAvailableMaterials(spell: Spell, equipment: EquipmentItem[]): EquipmentItem[] {
  if (!hasMaterialComponent(spell)) return []
  const isGp = spell.materialCost != null && spell.materialCost > 0
  // GP 法术：只能用具体的 spellComponents 匹配物品
  if (isGp) return findMatchingMaterials(spell, equipment)
  // 非 GP 的 M 法术：具体匹配 + 法器/材料包替代
  const specific = findMatchingMaterials(spell, equipment)
  const specificIds = new Set(specific.map(e => e.id))
  const focuses = equipment.filter(
    e => SPELLCASTING_FOCUS_IDS.has(e.id) && !specificIds.has(e.id) && (e.quantity ?? 1) > 0
  )
  return [...focuses, ...specific]
}

/** 消耗材料：返回新 equipment 数组（quantity-1，为0则删除） */
export function consumeMaterial(equipment: EquipmentItem[], materialId: string): EquipmentItem[] {
  return equipment.reduce<EquipmentItem[]>((acc, item) => {
    if (item.id !== materialId) {
      acc.push(item)
      return acc
    }
    const qty = (item.quantity ?? 1) - 1
    if (qty > 0) acc.push({ ...item, quantity: qty })
    // qty <= 0 → 不加入（删除）
    return acc
  }, [])
}
