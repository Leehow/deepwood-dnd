/**
 * normalizeSpellData - 统一法术数据格式
 * 处理后端 snake_case 与前端 camelCase 字段映射
 */
import type { Spell } from '~/types/spell'

/**
 * 将任意来源的法术数据（snake_case / camelCase / 混合）标准化为 Spell 类型。
 * 替代各处的 normalizeSpell / convertToSpell / detailData 本地转换。
 */
export function normalizeSpellData(raw: any): Spell {
  if (!raw) return raw
  return {
    id: raw.id || '',
    name: raw.name || '',
    nameEn: raw.nameEn || raw.name_en || '',
    level: raw.level ?? 0,
    school: (raw.school || 'evocation') as Spell['school'],
    castingTime: raw.castingTime || raw.casting_time || '',
    range: raw.range || '',
    components: Array.isArray(raw.components)
      ? raw.components
      : typeof raw.components === 'string'
        ? raw.components.split(/,\s*/).filter(Boolean) as any
        : [],
    duration: raw.duration || '',
    ritual: raw.ritual || false,
    concentration: raw.concentration || false,
    description: raw.description || '',
    classes: raw.classes || [],
    materials: raw.materials,
    iconPath: raw.iconPath || raw.icon_path,
    damage: raw.damage,
    damageType: raw.damageType || raw.damage_type,
    damageTypeCn: raw.damageTypeCn || raw.damage_type_cn,
    damageAtSlotLevel: raw.damageAtSlotLevel || raw.damage_at_slot_level,
    damageAtCharacterLevel: raw.damageAtCharacterLevel || raw.damage_at_character_level,
    attackType: raw.attackType || raw.attack_type,
    saveType: raw.saveType || raw.save_type,
    saveTypeCn: raw.saveTypeCn || raw.save_type_cn,
    saveEffect: raw.saveEffect || raw.save_effect,
    healing: raw.healing,
    healingAtSlotLevel: raw.healingAtSlotLevel || raw.healing_at_slot_level,
    areaOfEffect: raw.areaOfEffect || raw.area_of_effect,
    conditions: raw.conditions,
    atHigherLevels: raw.atHigherLevels || raw.at_higher_levels || raw.higher_levels || raw.higherLevels,
    atHigherLevelsEn: raw.atHigherLevelsEn || raw.at_higher_levels_en,
    cantripScaling: raw.cantripScaling || raw.cantrip_scaling,
    descriptionEn: raw.descriptionEn || raw.description_en,
    isControlSpell: raw.isControlSpell || raw.is_control_spell,
    controlEffect: raw.controlEffect || raw.control_effect,
    zoneEffects: raw.zoneEffects || raw.zone_effects,
    affectedCreatureTypes: raw.affectedCreatureTypes || raw.affected_creature_types,
    buffEffects: raw.buffEffects || raw.buff_effects,
    effects: raw.effects,
    castOptions: raw.castOptions,
    materialCost: raw.materialCost ?? raw.material_cost ?? undefined,
    materialConsumed: raw.materialConsumed ?? raw.material_consumed ?? undefined,
    illusion: raw.illusion,
    source: raw.source,
  }
}
