import subclassSpellsData from "~/data/rules/subclass-spells.json";
import racesData from "~/data/rules/races.json";

export interface RacialSpell {
  id: string;
  source: "racial";
  usesPerDay?: number;
  spellcastingAbility: string;
  level: number;
  traitName: string;
}

export const spellcastingAbilityMap: Record<string, "intelligence" | "wisdom" | "charisma"> = {
  artificer: "intelligence",
  wizard: "intelligence",
  cleric: "wisdom",
  druid: "wisdom",
  paladin: "charisma",
  ranger: "wisdom",
  bard: "charisma",
  sorcerer: "charisma",
  warlock: "charisma",
  // Subclass casters (resolved via subclass_id)
  eldritch_knight: "intelligence",
  arcane_trickster: "intelligence",
};

export const isSpellcaster = (charClassId?: string, subclassId?: string): boolean => {
  if (!charClassId) return false;
  if ([
    "artificer", "wizard", "cleric", "druid",
    "paladin", "ranger", "bard", "sorcerer", "warlock",
  ].includes(charClassId)) return true;
  // Subclass casters
  if (charClassId === "fighter" && subclassId === "eldritch_knight") return true;
  if (charClassId === "rogue" && subclassId === "arcane_trickster") return true;
  return false;
};

export const isPreparedCaster = (charClassId?: string): boolean => {
  if (!charClassId) return false;
  // Ranger is NOT a prepared caster - they use "spells known" system like sorcerer/bard
  return ["artificer", "wizard", "cleric", "druid", "paladin"].includes(charClassId);
};

/**
 * 法术书型准备施法者：虽然是准备型施法者，但只能从法术书(selected_spells)中准备法术，
 * 而非像牧师/德鲁伊那样从完整职业法术列表中准备。
 * 目前只有法师属于此类型，未来新职业如有类似机制只需加入此列表。
 */
export const isSpellbookCaster = (charClassId?: string): boolean => {
  if (!charClassId) return false;
  return ["wizard"].includes(charClassId);
};

export const preparedMax = (character: any, abilityMods: Record<string, number>): number => {
  const clsId = character.class_id || character.classId;
  if (!isPreparedCaster(clsId)) return 0;
  const level = character.level || 1;
  // Paladin: level/2 + CHA mod (min 1)
  if (clsId === "paladin") return Math.max(1, Math.floor(level / 2) + (abilityMods.charisma || 0));
  // Artificer: level/2 + INT mod, rounded up (min 1)
  if (clsId === "artificer") return Math.max(1, Math.ceil(level / 2) + (abilityMods.intelligence || 0));
  // Wizard/Cleric/Druid: level + ability mod
  const abi = spellcastingAbilityMap[clsId] || "wisdom";
  return Math.max(1, level + (abilityMods[abi] || 0));
};

/** 根据职业和职业等级，计算可用最高法术环数 */
export const maxSpellLevelForClass = (classId: string, classLevel: number, subclassId?: string): number => {
  if (classLevel < 1) return 0;

  // 1/3 施法者 (Eldritch Knight / Arcane Trickster): 3级才获得施法能力
  if (
    (classId === "fighter" && subclassId === "eldritch_knight") ||
    (classId === "rogue" && subclassId === "arcane_trickster") ||
    classId === "eldritch_knight" || classId === "arcane_trickster"
  ) {
    if (classLevel < 3) return 0;
    if (classLevel < 7) return 1;
    if (classLevel < 13) return 2;
    if (classLevel < 19) return 3;
    return 4;
  }

  // 半施法者 (Paladin / Ranger): 2级才获得施法能力
  if (classId === "paladin" || classId === "ranger") {
    if (classLevel < 2) return 0;
    if (classLevel < 5) return 1;
    if (classLevel < 9) return 2;
    if (classLevel < 13) return 3;
    if (classLevel < 17) return 4;
    return 5;
  }

  // Warlock 契约魔法
  if (classId === "warlock") {
    if (classLevel < 1) return 0;
    if (classLevel < 3) return 1;
    if (classLevel < 5) return 2;
    if (classLevel < 7) return 3;
    if (classLevel < 9) return 4;
    return 5;
  }

  // 全施法者 (Wizard / Cleric / Druid / Bard / Sorcerer / Artificer)
  return Math.min(9, Math.ceil(classLevel / 2));
};

export const getAlwaysPreparedSubclassSpells = (character: any | null | undefined): string[] => {
  if (!character) return [];

  const classId = character.class_id || character.classId;
  const subclassIdRaw = character.subclass_id || character.subclassId;
  const level = character.level || 1;

  if (!classId || !subclassIdRaw || !level) return [];

  const data: any = subclassSpellsData as any;
  // Support comma-separated subclass IDs (multi-subclass debug mode)
  const subclassIds = subclassIdRaw.split(',').filter(Boolean);
  const allSpells: string[] = [];

  for (const subclassId of subclassIds) {
    if (classId === "cleric") {
      const conf = data.cleric?.[subclassId];
      if (conf?.domainSpells) allSpells.push(...collectSubclassSpellsUpToLevel(conf.domainSpells, level));
    } else if (classId === "paladin") {
      const conf = data.paladin?.[subclassId];
      if (conf?.oathSpells) allSpells.push(...collectSubclassSpellsUpToLevel(conf.oathSpells, level));
    }
  }

  return Array.from(new Set(allSpells));
};

const collectSubclassSpellsUpToLevel = (
  byLevel: Record<string, string[]>,
  characterLevel: number,
): string[] => {
  const result: string[] = [];

  Object.entries(byLevel).forEach(([lvlStr, spells]) => {
    const lvl = Number(lvlStr);
    if (!Number.isNaN(lvl) && lvl <= characterLevel) {
      result.push(...spells);
    }
  });

  return Array.from(new Set(result));
};

/**
 * Get racial spells from race/subrace traits (e.g., Drow Magic, Infernal Legacy).
 * Filters by character level and returns spell metadata.
 * Also supports cantripChoice traits (e.g., High Elf) when raceChoices is provided.
 */
export function getRacialSpells(
  raceId: string | undefined,
  subraceId: string | null | undefined,
  level: number,
  raceChoices?: Record<string, any>,
): RacialSpell[] {
  if (!raceId) return [];

  const races = (racesData as any).races as any[];
  const race = races?.find(
    (r: any) => r.id === raceId || r.nameEn?.toLowerCase() === raceId.toLowerCase(),
  );
  if (!race) return [];

  // Collect traits from race + matching subrace
  const traits: any[] = [...(race.traits || [])];
  if (subraceId) {
    const subrace = (race.subraces || []).find((sr: any) => sr.id === subraceId);
    if (subrace) traits.push(...(subrace.traits || []));
  }

  const result: RacialSpell[] = [];
  for (const trait of traits) {
    const ability = trait.spellcastingAbility || "charisma";

    // Handle fixed spells array (e.g., Drow Magic, Forest Gnome)
    const spells = trait.spells as any[] | undefined;
    if (spells) {
      for (const sp of spells) {
        const minLevel = sp.minCharacterLevel ?? 1;
        if (level >= minLevel) {
          result.push({
            id: sp.name,
            source: "racial",
            usesPerDay: sp.usesPerDay,
            spellcastingAbility: ability,
            level: sp.level ?? 0,
            traitName: trait.name || "",
          });
        }
      }
    }

    // Handle cantripChoice traits (e.g., High Elf: user-chosen wizard cantrip)
    if (trait.cantripChoice && raceChoices?.cantrip) {
      const chosenId = raceChoices.cantrip;
      if (chosenId && !result.some(r => r.id === chosenId)) {
        result.push({
          id: chosenId,
          source: "racial",
          spellcastingAbility: ability,
          level: 0,
          traitName: trait.name || "",
        });
      }
    }
  }
  return result;
}
