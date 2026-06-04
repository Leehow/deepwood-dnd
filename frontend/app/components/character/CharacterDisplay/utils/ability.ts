export const getModifier = (score: number): number => Math.floor((Number(score || 10) - 10) / 2);
export const abilityModNumber = (score: number): string => {
  const m = getModifier(score);
  return m >= 0 ? `+${m}` : `${m}`;
};

export const calculateHP = (character: any): number => {
  const level = Number(character.level || 1);
  const conMod = getModifier(Number(character?.finalAbilityScores?.constitution ?? character?.constitution ?? 10));
  const hitDieValue = (() => {
    const classDie: Record<string, number> = {
      barbarian: 12,
      fighter: 10,
      paladin: 10,
      ranger: 10,
      bard: 8,
      cleric: 8,
      druid: 8,
      monk: 8,
      rogue: 8,
      warlock: 8,
      sorcerer: 6,
      wizard: 6,
      artificer: 8,
    };
    return classDie[character.class_id || character.classId] || 8;
  })();
  const perLevelAvg = Math.ceil(hitDieValue / 2) + 1; // 5e average per level after 1st
  // Prefer provided base HP if present (>0); otherwise compute level-1 base as full hit die + CON mod
  const providedBase = Number(character.base_hp ?? character.baseHp);
  const base = Number.isFinite(providedBase) && providedBase > 0 ? providedBase : (hitDieValue + conMod);
  const hp = base + Math.max(0, level - 1) * (perLevelAvg + conMod);
  return Math.max(hp, 1);
};

