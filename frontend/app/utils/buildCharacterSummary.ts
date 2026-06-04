import racesData from '~/data/rules/races.json';
import classesData from '~/data/rules/classes_with_structured_subclass_features.json';
import spellsData from '~/data/rules/spells.json';

// Build spell ID → Chinese name lookup
const spellNameMap: Record<string, string> = {};
for (const sp of (spellsData as any).spells || []) {
  if (sp.id && sp.name) spellNameMap[sp.id] = sp.name;
}
function spellCN(id: string): string { return spellNameMap[id] || id; }

/**
 * 将角色关键参数序列化为 AI 可读的文本摘要。
 * 用于模态框上下文，让 AI 了解当前角色的能力和限制。
 */
export function buildCharacterSummary(character: any): string {
  if (!character) return '';
  const parts: string[] = [];

  // 基本信息
  if (character.name) parts.push(`角色：${character.name}`);

  const race = (racesData as any).races?.find((r: any) => r.id === character.race_id);
  const cls = (classesData as any).classes?.find((c: any) => c.id === (character.class_id || character.classId));
  if (race) parts.push(`种族：${race.name}`);
  if (cls) parts.push(`职业：${cls.name} ${character.level || 1}级`);
  if (character.subclass_id) {
    const sc = cls?.subclasses?.find((s: any) => s.id === character.subclass_id);
    if (sc) parts.push(`子职业：${sc.name}`);
  }

  // 属性值
  const as = character.ability_scores;
  if (as) {
    parts.push(`属性：力${as.strength} 敏${as.dexterity} 体${as.constitution} 智${as.intelligence} 感${as.wisdom} 魅${as.charisma}`);
  }

  // 技能熟练
  const skills = extractStringArray(character.selected_skills || character.selectedSkills);
  if (skills.length > 0) parts.push(`技能熟练：${skills.join('、')}`);

  const expertise = extractStringArray(character.expertise_skills || character.expertiseSkills);
  if (expertise.length > 0) parts.push(`专精：${expertise.join('、')}`);

  // 武器/护甲熟练（从职业数据读取）
  if (cls) {
    const armorProfs = cls.proficiencies?.armor;
    const weaponProfs = cls.proficiencies?.weapons;
    if (armorProfs?.length > 0) parts.push(`护甲熟练：${armorProfs.join('、')}`);
    if (weaponProfs?.length > 0) parts.push(`武器熟练：${weaponProfs.join('、')}`);
  }

  // 已有装备（前10件）
  const equipment = character.equipment;
  if (Array.isArray(equipment) && equipment.length > 0) {
    const names = equipment.slice(0, 10).map((e: any) => e.name || e.id).filter(Boolean);
    const extra = equipment.length > 10 ? `…等共${equipment.length}件` : '';
    if (names.length > 0) parts.push(`已有装备：${names.join('、')}${extra}`);
  }

  // 职业特性
  if (character.fighting_style) parts.push(`战斗风格：${extractString(character.fighting_style)}`);
  const feats = extractStringArray(character.feats);
  if (feats.length > 0) parts.push(`已选专长：${feats.join('、')}`);

  // 法术信息（翻译为中文名）
  const cantrips = extractStringArray(character.selected_cantrips || character.selectedCantrips);
  if (cantrips.length > 0) parts.push(`已知戏法：${cantrips.map(spellCN).join('、')}`);
  const knownSpells = extractStringArray(character.selected_spells || character.selectedSpells);
  if (knownSpells.length > 0) parts.push(`已知法术：${knownSpells.map(spellCN).join('、')}`);
  const prepared = character.prepared_spells || character.preparedSpells;
  if (Array.isArray(prepared) && prepared.length > 0) parts.push(`已准备法术：${prepared.map(spellCN).join('、')}`);

  return parts.join('。');
}

/** 从可能是 LevelTrackedSelection[] 或 string[] 的字段提取字符串列表 */
function extractStringArray(val: any): string[] {
  if (!Array.isArray(val)) return [];
  return val.map((v: any) => (typeof v === 'string' ? v : v?.value || v?.id || '')).filter(Boolean);
}

/** 从可能是 LevelTrackedSelection 或 string 的字段提取字符串 */
function extractString(val: any): string {
  if (typeof val === 'string') return val;
  return val?.value || val?.id || '';
}
