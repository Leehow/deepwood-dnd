import racesData from "~/data/rules/races.json";
import classesData from "~/data/rules/classes.json";
import structuredClassesData from "~/data/rules/classes_with_structured_subclass_features.json";
import backgroundsData from "~/data/rules/backgrounds.json";
import { useMemo } from "react";
import type { Character, CharacterComputed } from "../types/Character";

export function useCharacterComputed(character: Character): CharacterComputed {
  // Core lookups
  const race = useMemo(() => (racesData as any).races.find((r: any) => r.id === character.race_id), [character.race_id]);
  const subrace = useMemo(() => race?.subraces?.find((sr: any) => sr.id === character.subrace_id), [race, character.subrace_id]);
  const charClass = useMemo(() => (classesData as any).classes.find((c: any) => c.id === character.class_id), [character.class_id]);
  // Prefer structured subclass data (has features, level1Features, etc.) over basic classes.json
  const subclass = useMemo(() => {
    if (!character.subclass_id) return undefined;
    const structuredClass = (structuredClassesData as any).classes?.find((c: any) => c.id === character.class_id);
    const structured = structuredClass?.subclasses?.find((sc: any) => sc.id === character.subclass_id);
    if (structured) return structured;
    return charClass?.subclasses?.find((sc: any) => sc.id === character.subclass_id);
  }, [charClass, character.class_id, character.subclass_id]);
  const background = useMemo(() => (backgroundsData as any).backgrounds.find((b: any) => b.id === character.background_id), [character.background_id]);

  // Racial bonus helper
  const getRacialBonus = (abilityId: string): number => {
    let bonus = 0;
    if ((race as any)?.abilityScoreIncrease) {
      const increase = ((race as any).abilityScoreIncrease as Record<string, number | undefined>)[abilityId] ?? 0;
      bonus += increase;
    }
    if ((subrace as any)?.abilityScoreIncrease) {
      const increase = ((subrace as any).abilityScoreIncrease as Record<string, number | undefined>)[abilityId] ?? 0;
      bonus += increase;
    }
    if (character.race_id === "half_elf" && character.race_choices?.abilityScores) {
      if (character.race_choices.abilityScores.includes(abilityId)) bonus += 1;
    }
    return bonus;
  };

  // Final ability scores (number values)
  const finalAbilityScores = useMemo(() => ({
    strength: Number(character.ability_scores?.strength ?? 10) + getRacialBonus("strength"),
    dexterity: Number(character.ability_scores?.dexterity ?? 10) + getRacialBonus("dexterity"),
    constitution: Number(character.ability_scores?.constitution ?? 10) + getRacialBonus("constitution"),
    intelligence: Number(character.ability_scores?.intelligence ?? 10) + getRacialBonus("intelligence"),
    wisdom: Number(character.ability_scores?.wisdom ?? 10) + getRacialBonus("wisdom"),
    charisma: Number(character.ability_scores?.charisma ?? 10) + getRacialBonus("charisma"),
  }), [character.ability_scores, character.race_id, character.race_choices, race, subrace]);

  // Ability modifiers (numbers)
  const abilityMods = useMemo(() => ({
    strength: Math.floor((finalAbilityScores.strength - 10) / 2),
    dexterity: Math.floor((finalAbilityScores.dexterity - 10) / 2),
    constitution: Math.floor((finalAbilityScores.constitution - 10) / 2),
    intelligence: Math.floor((finalAbilityScores.intelligence - 10) / 2),
    wisdom: Math.floor((finalAbilityScores.wisdom - 10) / 2),
    charisma: Math.floor((finalAbilityScores.charisma - 10) / 2),
  }), [finalAbilityScores]);

  // Proficiency bonus
  const proficiencyBonus = useMemo(() => Math.ceil((Number(character.level || 1)) / 4) + 1, [character.level]);

  return {
    race,
    subrace,
    charClass,
    subclass,
    background,
    finalAbilityScores,
    abilityMods,
    proficiencyBonus,
  } as const;
}

