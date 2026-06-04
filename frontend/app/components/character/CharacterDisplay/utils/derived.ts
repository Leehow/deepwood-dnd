import racesData from "~/data/rules/races.json";
import type { EquipmentItem } from "../types/Character";
import { calculateHP as baseCalculateHP, getModifier } from "./ability";
import { calculateAC as calculateACUtil } from "./equipment";
import { calculateSpeed as calculateSpeedUtil } from "./speed";
import skillsData from "~/data/rules/skills.json";
import { spellcastingAbilityMap } from "./spellcasting";
import { getPassiveFeatures } from "~/hooks/usePassiveFeatures";
import { getFeatPassiveBonuses } from "./featEffects";

/** 提取角色的魔能祈唤ID列表 */
function getInvocationIds(character: any): string[] {
  const inv = character?.eldritch_invocations || character?.eldritchInvocations || [];
  if (!inv.length) return [];
  return inv.map((i: any) => typeof i === 'string' ? i : i.value || i.id || '');
}

export type FinalAbilityScores = Record<
  "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma",
  number
>;

export type AbilityMods = FinalAbilityScores;

export interface ComputeHPOptions {
  includeFlatSubraceHP?: boolean;               // e.g., flat hpBonus values on subrace traits
  includeSubraceLevelBonuses?: boolean;         // e.g., hill dwarf +1 per level when trait.specialAbilities indicate hp bonus
}

export interface ComputeOptions {
  equipmentOverride?: EquipmentItem[];          // use latest local equipment state if provided
  hpOptions?: ComputeHPOptions;
  activeSpellEffects?: any[];                   // active spell buffs from token (for AC/speed modifiers)
}

export interface DerivedStats {
  finalAbilityScores: FinalAbilityScores;
  abilityMods: AbilityMods;
  proficiencyBonus: number;
  hp: number;
  ac: number;
  speed: number;
  initiative: number;
}

// Half-elf and general racial/subracial bonuses
export function computeFinalAbilityScores(character: any): FinalAbilityScores {
  const base = character?.ability_scores || character?.abilityScores || {};
  const raceId = character?.race_id ?? character?.raceId;
  const subraceId = character?.subrace_id ?? character?.subraceId;

  const race = (racesData as any)?.races?.find((r: any) => r.id === raceId);
  const subrace = race?.subraces?.find((sr: any) => sr.id === subraceId);

  const bonusFor = (abilityId: string): number => {
    let b = 0;
    const rInc = ((race as any)?.abilityScoreIncrease || {})[abilityId] ?? 0;
    const srInc = ((subrace as any)?.abilityScoreIncrease || {})[abilityId] ?? 0;
    b += Number(rInc || 0) + Number(srInc || 0);
    // Half-elf flexible +1s
    const raceChoices = character?.race_choices || character?.raceChoices;
    if (raceId === "half_elf" && raceChoices?.abilityScores) {
      if (raceChoices.abilityScores.includes(abilityId)) b += 1;
    }
    return b;
  };

  const toNum = (v: any, fallback = 10) => Number.isFinite(Number(v)) ? Number(v) : fallback;

  const finalScores: FinalAbilityScores = {
    strength: toNum(base.strength, 10) + bonusFor("strength"),
    dexterity: toNum(base.dexterity, 10) + bonusFor("dexterity"),
    constitution: toNum(base.constitution, 10) + bonusFor("constitution"),
    intelligence: toNum(base.intelligence, 10) + bonusFor("intelligence"),
    wisdom: toNum(base.wisdom, 10) + bonusFor("wisdom"),
    charisma: toNum(base.charisma, 10) + bonusFor("charisma"),
  };
  return finalScores;
}

export function computeAbilityMods(finalAbilityScores: FinalAbilityScores): AbilityMods {
  return {
    strength: getModifier(finalAbilityScores.strength),
    dexterity: getModifier(finalAbilityScores.dexterity),
    constitution: getModifier(finalAbilityScores.constitution),
    intelligence: getModifier(finalAbilityScores.intelligence),
    wisdom: getModifier(finalAbilityScores.wisdom),
    charisma: getModifier(finalAbilityScores.charisma),
  } as AbilityMods;
}

export function computeProficiencyBonus(levelOrCharacter: number | { level?: number }): number {
  const level = typeof levelOrCharacter === "number" ? levelOrCharacter : Number(levelOrCharacter?.level || 1);
  return Math.ceil(level / 4) + 1; // 1-4:+2, 5-8:+3, 9-12:+4, 13-16:+5, 17-20:+6
}

export function computeHP(character: any, hpOptions?: ComputeHPOptions): number {
  const finalAbilityScores = computeFinalAbilityScores(character);
  let hp = baseCalculateHP({ ...character, finalAbilityScores });

  // Optional subrace-based HP adjustments
  if (hpOptions?.includeFlatSubraceHP || hpOptions?.includeSubraceLevelBonuses) {
    const raceId = character?.race_id ?? character?.raceId;
    const subraceId = character?.subrace_id ?? character?.subraceId;
    const race = (racesData as any)?.races?.find((r: any) => r.id === raceId);
    const subrace = race?.subraces?.find((sr: any) => sr.id === subraceId);
    const level = Number(character?.level || 1);

    const traits: any[] = (subrace as any)?.traits || [];
    for (const t of traits) {
      if (hpOptions?.includeFlatSubraceHP && typeof t?.hpBonus === "number") {
        hp += t.hpBonus; // flat add once
      }
      if (hpOptions?.includeSubraceLevelBonuses && Array.isArray(t?.specialAbilities)) {
        if (t.specialAbilities.some((ab: any) => ab?.type === "hp_increase" || ab?.type === "hp_bonus")) {
          hp += level;
        }
      }
    }
  }

  // Feat bonuses (e.g. Tough: +2 HP per level)
  const featBonuses = getFeatPassiveBonuses(character?.feats || []);
  if (featBonuses.hp_per_level) {
    hp += featBonuses.hp_per_level * Number(character?.level || 1);
  }

  return Math.max(1, Math.floor(hp));
}

export function computeAC(character: any, options?: ComputeOptions): number {
  const finalAbilityScores = computeFinalAbilityScores(character);
  const equipment = options?.equipmentOverride ?? character?.equipment ?? [];
  return calculateACUtil(character, finalAbilityScores, equipment);
}

export function computeSpeed(character: any): number {
  return calculateSpeedUtil(character);
}

export function computeInitiative(character: any): number {
  const finalAbilityScores = computeFinalAbilityScores(character);
  let init = getModifier(finalAbilityScores.dexterity);
  const featBonuses = getFeatPassiveBonuses(character?.feats || []);
  if (featBonuses.initiative_bonus) init += featBonuses.initiative_bonus;
  return init;
}

export function computeAll(character: any, options?: ComputeOptions): DerivedStats {
  const finalAbilityScores = computeFinalAbilityScores(character);
  const abilityMods = computeAbilityMods(finalAbilityScores);
  const proficiencyBonus = computeProficiencyBonus(character);
  const hp = computeHP({ ...character, finalAbilityScores }, options?.hpOptions);
  const ac = computeAC({ ...character, finalAbilityScores, equipment: character?.equipment }, options);
  const speed = computeSpeed(character);
  const initiative = computeInitiative(character);
  return { finalAbilityScores, abilityMods, proficiencyBonus, hp, ac, speed, initiative };
}

export type DerivedKey = keyof DerivedStats | "proficiencyBonus";

export function compute(key: DerivedKey, character: any, options?: ComputeOptions): any {
  switch (key) {
    case "finalAbilityScores": return computeFinalAbilityScores(character);
    case "abilityMods": return computeAbilityMods(computeFinalAbilityScores(character));
    case "proficiencyBonus": return computeProficiencyBonus(character);
    case "hp": return computeHP(character, options?.hpOptions);
    case "ac": return computeAC(character, options);
    case "speed": return computeSpeed(character);
    case "initiative": return computeInitiative(character);
    default: return computeAll(character, options);
  }
}

// ---------- Breakdown helpers for clickable explanations ----------
export function getAbilityScoreBreakdown(character: any, abilityId: keyof FinalAbilityScores) {
  // Get the current ability score (which includes ASI from level ups)
  const currentScore = character?.ability_scores?.[abilityId] ?? character?.abilityScores?.[abilityId] ?? 10;

  // Try to find the original score from level history (level 1 snapshot)
  let originalScore = currentScore;
  let asiDetails: { level: number; amount: number }[] = [];

  const levelHistory = character?.level_history || character?.levelHistory || [];
  if (levelHistory.length > 0) {
    // Sort history by level to track progression
    const sortedHistory = [...levelHistory].sort((a, b) => (a.level || 0) - (b.level || 0));

    // Find the earliest level snapshot (should be level 1)
    const earliestSnapshot = sortedHistory[0];

    if (earliestSnapshot && earliestSnapshot.ability_scores) {
      originalScore = earliestSnapshot.ability_scores[abilityId] || 10;
    }

    // Track ASI changes through level progression
    let previousScore = originalScore;
    for (let i = 1; i < sortedHistory.length; i++) {
      const snapshot = sortedHistory[i];
      if (snapshot.ability_scores && snapshot.ability_scores[abilityId]) {
        const currentLevelScore = snapshot.ability_scores[abilityId];
        const increase = currentLevelScore - previousScore;
        if (increase > 0) {
          asiDetails.push({ level: snapshot.level, amount: increase });
        }
        previousScore = currentLevelScore;
      }
    }

    // Check if current score is higher than last snapshot (recent ASI not yet in history)
    const lastSnapshot = sortedHistory[sortedHistory.length - 1];
    if (lastSnapshot && lastSnapshot.ability_scores) {
      const lastScore = lastSnapshot.ability_scores[abilityId] || originalScore;
      const recentIncrease = currentScore - lastScore;
      if (recentIncrease > 0) {
        asiDetails.push({ level: character.level || sortedHistory.length, amount: recentIncrease });
      }
    }
  } else {
    // Fallback: try to use original_ability_scores if available
    originalScore = character?.original_ability_scores?.[abilityId] ??
                   character?.originalAbilityScores?.[abilityId] ??
                   currentScore;
    const asiBonus = currentScore - originalScore;
    if (asiBonus > 0) {
      // If we don't have history, just show the total ASI bonus without level details
      asiDetails.push({ level: 0, amount: asiBonus });
    }
  }

  const totalAsiBonus = asiDetails.reduce((sum, detail) => sum + detail.amount, 0);

  const raceId = character?.race_id ?? character?.raceId;
  const subraceId = character?.subrace_id ?? character?.subraceId;
  const race = (racesData as any)?.races?.find((r: any) => r.id === raceId);
  const subrace = race?.subraces?.find((sr: any) => sr.id === subraceId);
  const finalScores = computeFinalAbilityScores(character);
  const items: { label: string; value: number }[] = [];

  // Calculate the base value (before any bonuses)
  const rInc = Number(((race as any)?.abilityScoreIncrease || {})[abilityId] || 0);
  const srInc = Number(((subrace as any)?.abilityScoreIncrease || {})[abilityId] || 0);
  const raceChoices = character?.race_choices || character?.raceChoices;
  const flexCount = (raceId === "half_elf" && Array.isArray(raceChoices?.abilityScores)) ?
                    raceChoices.abilityScores.filter((x: string)=>x===abilityId).length : 0;

  const totalRacialBonus = rInc + srInc + flexCount;
  const baseValue = originalScore - totalAsiBonus;

  // Show the base rolled/standard array value (without racial bonuses)
  items.push({ label: "初始骰点/标准", value: Number(baseValue) });

  // Show racial bonuses
  if (rInc) items.push({ label: `种族：${race?.name || raceId}`, value: rInc });
  if (srInc) items.push({ label: `亚种：${subrace?.name || subraceId}`, value: srInc });
  if (flexCount > 0) items.push({ label: `半精灵自选 ×${flexCount}`, value: flexCount });

  // Show ASI from level ups with specific levels
  if (asiDetails.length > 0) {
    for (const detail of asiDetails) {
      if (detail.level === 0) {
        // No level history available
        items.push({ label: `属性提升（升级）`, value: detail.amount });
      } else {
        items.push({ label: `属性提升（${detail.level}级）`, value: detail.amount });
      }
    }
  }

  return { final: finalScores[abilityId], items };
}

export function getProficiencyBonusBreakdown(levelOrCharacter: number | { level?: number }) {
  const level = typeof levelOrCharacter === "number" ? levelOrCharacter : Number(levelOrCharacter?.level || 1);
  const pb = computeProficiencyBonus(level);
  const items = [
    { label: `规则：每4级+1`, value: 0 },
    { label: `等级 ${level} → 熟练加值`, value: pb },
  ];
  return { final: pb, items };
}

export function getInitiativeBreakdown(character: any) {
  const fas = computeFinalAbilityScores(character);
  const dexMod = getModifier(fas.dexterity);
  const items: { label: string; value: number }[] = [{ label: "敏捷调整值", value: dexMod }];
  let final = dexMod;

  const featBonuses = getFeatPassiveBonuses(character?.feats || []);
  if (featBonuses.initiative_bonus) {
    final += featBonuses.initiative_bonus;
    items.push({ label: "专长：警觉", value: featBonuses.initiative_bonus });
  }

  return { final, items };
}

export function getHPBreakdown(character: any, hpOptions?: ComputeHPOptions) {
  const fas = computeFinalAbilityScores(character);
  const conMod = getModifier(fas.constitution);
  const level = Number(character?.level || 1);
  // Determine hit die
  const cls = character?.class_id || character?.classId;
  const classDie: Record<string, number> = {
    barbarian: 12, fighter: 10, paladin: 10, ranger: 10,
    bard: 8, cleric: 8, druid: 8, monk: 8, rogue: 8, warlock: 8,
    sorcerer: 6, wizard: 6, artificer: 8,
  };
  const hitDieValue = classDie[cls] || 8;
  const perLevelAvg = Math.ceil(hitDieValue / 2) + 1;
  const providedBase = Number(character?.base_hp ?? character?.baseHp);
  const baseL1 = Number.isFinite(providedBase) && providedBase > 0 ? providedBase : (hitDieValue + conMod);

  let total = baseL1 + Math.max(0, level - 1) * (perLevelAvg + conMod);
  const items: { label: string; value: number }[] = [];
  items.push({ label: `1级：生命骰${hitDieValue} + 体质(${conMod>=0?`+${conMod}`:conMod})`, value: baseL1 });
  if (level > 1) items.push({ label: `2-${level}级：每级${perLevelAvg} + 体质(${conMod>=0?`+${conMod}`:conMod})`, value: Math.max(0, level - 1) * (perLevelAvg + conMod) });

  // Subrace bonuses
  if (hpOptions?.includeFlatSubraceHP || hpOptions?.includeSubraceLevelBonuses) {
    const raceId = character?.race_id ?? character?.raceId;
    const subraceId = character?.subrace_id ?? character?.subraceId;
    const race = (racesData as any)?.races?.find((r: any) => r.id === raceId);
    const subrace = race?.subraces?.find((sr: any) => sr.id === subraceId);
    const traits: any[] = (subrace as any)?.traits || [];
    for (const t of traits) {
      if (hpOptions?.includeFlatSubraceHP && typeof t?.hpBonus === "number") {
        total += t.hpBonus;
        items.push({ label: `亚种特性：${t.name}`, value: t.hpBonus });
      }
      if (hpOptions?.includeSubraceLevelBonuses && Array.isArray(t?.specialAbilities)) {
        if (t.specialAbilities.some((ab: any) => ab?.type === "hp_increase" || ab?.type === "hp_bonus")) {
          total += level;
          items.push({ label: `亚种特性：${t.name}（每级+1 ×${level}）`, value: level });
        }
      }
    }
  }

  // Feat bonuses (e.g. Tough: +2 HP per level)
  const featBonuses = getFeatPassiveBonuses(character?.feats || []);
  if (featBonuses.hp_per_level) {
    const hpBonus = featBonuses.hp_per_level * level;
    total += hpBonus;
    items.push({ label: `专长：坚韧（每级+${featBonuses.hp_per_level} ×${level}）`, value: hpBonus });
  }

  return { final: Math.max(1, Math.floor(total)), items };
}

export function getACBreakdown(character: any, options?: ComputeOptions) {
  const fas = computeFinalAbilityScores(character);
  const dexMod = getModifier(fas.dexterity);
  const wisMod = getModifier(fas.wisdom);
  const conMod = getModifier(fas.constitution);
  const equipment = options?.equipmentOverride ?? character?.equipment ?? [];
  const armor = equipment.find((it: any) => it?.equippedSlot === "armor") || equipment.find((it: any) => it?.id && [
    "padded","leather","studded_leather","hide","chain_shirt","scale_mail","breastplate","half_plate","ring_mail","chain_mail","splint","plate"
  ].includes(it.id));
  const shield = equipment.find((it: any) => it?.equippedSlot === "off_hand" && it.id === "shield");
  const items: { label: string; value: number }[] = [];
  let ac = 10;

  // Pre-scan active spell effects for AC modifications
  // Three types:
  //   "set" / "set_base" = base AC replacement + DEX (Mage Armor: AC = 13 + DEX, unarmored only)
  //   "set_floor" = AC minimum floor, no DEX (Barkskin: AC ≥ 16, works even with armor)
  //   "add" / "bonus" = additive bonus (Shield +5, Shield of Faith +2)
  const AC_BASE_REPLACE_SPELLS = new Set(['mage_armor']);
  const AC_FLOOR_SPELLS = new Set(['barkskin']);
  const spellEffects = options?.activeSpellEffects || [];
  let spellSetAC = 0, spellSetName = "";     // base replacement (unarmored only)
  let spellFloorAC = 0, spellFloorName = ""; // AC floor (always applies)
  const spellAddBonuses: { name: string; value: number }[] = []; // additive bonuses
  for (const eff of spellEffects) {
    const spellId = eff.spell_id || '';
    for (const m of eff.modifiers || []) {
      const stat = m.stat || (m.target === 'incoming_attack' || m.target === 'ac' ? 'ac' : '');
      if (stat !== 'ac') continue;
      const val = Number(m.value) || 0;
      const isFloor = m.operation === 'set_floor' || AC_FLOOR_SPELLS.has(spellId);
      const isBaseReplace = !isFloor && (m.operation === 'set' || m.type === 'set_base' || AC_BASE_REPLACE_SPELLS.has(spellId));
      if (isFloor) {
        if (val > spellFloorAC) { spellFloorAC = val; spellFloorName = eff.name || spellId || '法术'; }
      } else if (isBaseReplace) {
        const setAC = val + dexMod;
        if (setAC > spellSetAC) { spellSetAC = setAC; spellSetName = eff.name || spellId || '法术'; }
      } else if (val !== 0) {
        spellAddBonuses.push({ name: eff.name || '法术', value: val });
      }
    }
  }

  if (armor) {
    const armorAC: Record<string, { base: number; dexBonus?: boolean; maxDexBonus?: number }> = {
      padded: { base: 11, dexBonus: true },
      leather: { base: 11, dexBonus: true },
      studded_leather: { base: 12, dexBonus: true },
      hide: { base: 12, dexBonus: true, maxDexBonus: 2 },
      chain_shirt: { base: 13, dexBonus: true, maxDexBonus: 2 },
      scale_mail: { base: 14, dexBonus: true, maxDexBonus: 2 },
      breastplate: { base: 14, dexBonus: true, maxDexBonus: 2 },
      half_plate: { base: 15, dexBonus: true, maxDexBonus: 2 },
      ring_mail: { base: 14 },
      chain_mail: { base: 16 },
      splint: { base: 17 },
      plate: { base: 18 },
    };
    const a = (armorAC as any)[armor.id];
    if (a) {
      ac = a.base;
      items.push({ label: `护甲基础`, value: a.base });
      if (a.dexBonus) {
        const dexAdded = Math.min(dexMod, a.maxDexBonus ?? Infinity);
        items.push({ label: `敏捷调整值（上限${a.maxDexBonus ?? '无'}）`, value: dexAdded });
        ac += dexAdded;
      }
    } else if (armor.ac !== undefined && armor.ac !== null) {
      // Custom/generated armor: handle both object {base, dex_bonus} and number formats
      const acVal = armor.ac as any;
      let baseAC: number;
      if (typeof acVal === 'object' && acVal.base !== undefined) {
        baseAC = Number(acVal.base) || 10;
        ac = baseAC;
        items.push({ label: `${armor.name || '护甲'}基础`, value: baseAC });
        if (acVal.dex_bonus || acVal.dexBonus) {
          const maxBonus = acVal.max_dex_bonus ?? acVal.maxDexBonus ?? Infinity;
          const dexAdded = Math.min(dexMod, maxBonus);
          items.push({ label: `敏捷调整值${maxBonus !== Infinity ? `（上限+${maxBonus}）` : ''}`, value: dexAdded });
          ac += dexAdded;
        }
      } else {
        baseAC = Number(acVal) || 10;
        ac = baseAC;
        items.push({ label: `${armor.name || '护甲'}基础`, value: baseAC });
      }
      if (armor.acBonus) {
        const bonus = Number(armor.acBonus);
        ac += bonus;
        items.push({ label: '护甲加值', value: bonus });
      }
      // Apply magic_bonus for custom armor
      if (armor.magic_bonus) {
        const mb = Number(armor.magic_bonus);
        ac += mb;
        items.push({ label: '魔法加值', value: mb });
      }
    }
  } else {
    // Use passive features system for Unarmored Defense
    const classId = character?.class_id || character?.classId || "";
    const subclassId = character?.subclass_id || character?.subclassId;
    const level = character?.level || 1;
    const passiveFeatures = getPassiveFeatures({ classId, subclassId, level, raceId: character?.race_id || character?.raceId, subraceId: character?.subrace_id || character?.subraceId });

    // armor_of_shadows 祈唤：无甲时 AC = 13 + DEX（法师护甲）
    const invIds = getInvocationIds(character);
    const hasArmorOfShadows = invIds.includes('armor_of_shadows');
    const mageArmorAC = hasArmorOfShadows ? 13 + dexMod : 0;

    if (passiveFeatures.acFormula) {
      const formula = passiveFeatures.acFormula.effect.formula || "";
      const featureName = passiveFeatures.acFormula.name;

      let unarmoredAC = 10 + dexMod;
      if (formula.includes("wis")) {
        unarmoredAC = 10 + dexMod + wisMod;
      } else if (formula.includes("con")) {
        unarmoredAC = 10 + dexMod + conMod;
      }

      // Pick highest: unarmored defense, armor_of_shadows, or active spell set AC
      const best = Math.max(unarmoredAC, mageArmorAC, spellSetAC);

      if (spellSetAC === best && spellSetAC > 0) {
        ac = spellSetAC;
        const baseVal = spellSetAC - dexMod;
        items.push({ label: `${spellSetName}：${baseVal}`, value: baseVal });
        items.push({ label: "敏捷调整值", value: dexMod });
      } else if (hasArmorOfShadows && mageArmorAC === best) {
        ac = mageArmorAC;
        items.push({ label: "幽影护甲（法师护甲）：13", value: 13 });
        items.push({ label: "敏捷调整值", value: dexMod });
      } else if (formula.includes("wis")) {
        ac = unarmoredAC;
        items.push({ label: `${featureName}：10`, value: 10 });
        items.push({ label: "敏捷调整值", value: dexMod });
        items.push({ label: "感知调整值", value: wisMod });
      } else if (formula.includes("con")) {
        ac = unarmoredAC;
        items.push({ label: `${featureName}：10`, value: 10 });
        items.push({ label: "敏捷调整值", value: dexMod });
        items.push({ label: "体质调整值", value: conMod });
      } else {
        ac = unarmoredAC;
        items.push({ label: "基础 10", value: 10 });
        items.push({ label: "敏捷调整值", value: dexMod });
      }
    } else if (spellSetAC > 0 && spellSetAC >= mageArmorAC && spellSetAC > 10 + dexMod) {
      ac = spellSetAC;
      const baseVal = spellSetAC - dexMod;
      items.push({ label: `${spellSetName}：${baseVal}`, value: baseVal });
      items.push({ label: "敏捷调整值", value: dexMod });
    } else if (hasArmorOfShadows) {
      ac = mageArmorAC;
      items.push({ label: "幽影护甲（法师护甲）：13", value: 13 });
      items.push({ label: "敏捷调整值", value: dexMod });
    } else {
      ac = 10 + dexMod;
      items.push({ label: "基础 10", value: 10 });
      items.push({ label: "敏捷调整值", value: dexMod });
    }
  }

  // Apply AC "add" bonuses from active spell effects (e.g. Shield +5, Shield of Faith +2)
  for (const bonus of spellAddBonuses) {
    ac += bonus.value;
    items.push({ label: bonus.name, value: bonus.value });
  }

  // Shield check - Monk's Unarmored Defense doesn't work with shield
  const classId = character?.class_id || character?.classId || "";
  const isMonk = classId.toLowerCase() === "monk";
  if (shield && !(isMonk && !armor)) {
    ac += 2;
    items.push({ label: "盾牌", value: 2 });
  }

  // Fighting Style: Defense — +1 AC when wearing armor
  const fs = (character as any).fighting_style || (character as any).fightingStyle;
  const fsValue = fs && typeof fs === 'object' ? fs.value : fs;
  if (fsValue === "defense" && armor) {
    ac += 1;
    items.push({ label: "战斗风格：防御", value: 1 });
  }

  // Feat AC bonuses
  const featBonuses = getFeatPassiveBonuses(character?.feats || []);
  const mainHand = equipment.find((it: any) => it?.equippedSlot === "main_hand");
  const offHand = equipment.find((it: any) => it?.equippedSlot === "off_hand");

  for (const acb of featBonuses.ac_bonuses) {
    if (acb.condition === "dual_wielding") {
      // Dual Wielder: +1 AC when wielding two melee weapons
      if (mainHand && offHand && offHand.id !== "shield") {
        ac += acb.value;
        items.push({ label: `专长：${acb.featName}`, value: acb.value });
      }
    } else if (acb.condition === "light_armor") {
      // Light Armor Master: +1 AC when wearing light armor
      const lightArmorIds = ["padded", "leather", "studded_leather"];
      if (armor && lightArmorIds.includes(armor.id)) {
        ac += acb.value;
        items.push({ label: `专长：${acb.featName}`, value: acb.value });
      }
    }
  }

  // Medium Armor Master: dex cap +1 already handled via maxDexBonus adjustment
  if (featBonuses.medium_armor_dex_cap_bonus && armor) {
    const mediumArmorIds = ["hide", "chain_shirt", "scale_mail", "breastplate", "half_plate"];
    if (mediumArmorIds.includes(armor.id)) {
      // The armor section capped dex at +2, but this feat raises cap to +3
      const extraDex = Math.min(featBonuses.medium_armor_dex_cap_bonus, Math.max(0, dexMod - 2));
      if (extraDex > 0) {
        ac += extraDex;
        items.push({ label: "专长：中甲大师（敏捷上限+1）", value: extraDex });
      }
    }
  }

  // AC floor from spells like Barkskin (AC can't be less than X, works with any armor)
  if (spellFloorAC > 0 && spellFloorAC > ac) {
    const diff = spellFloorAC - ac;
    ac = spellFloorAC;
    items.push({ label: `${spellFloorName}（下限${spellFloorAC}）`, value: diff });
  }

  return { final: ac, items };
}

export function getSpeedBreakdown(character: any) {
  const raceId = character?.race_id ?? character?.raceId;
  const subraceId = character?.subrace_id ?? character?.subraceId;
  const race = (racesData as any)?.races?.find((r: any) => r.id === raceId);
  const subrace = race?.subraces?.find((sr: any) => sr.id === subraceId);
  let speed = typeof race?.speed === "number" ? race.speed : 30;
  const items: { label: string; value: number }[] = [];
  items.push({ label: `种族基础`, value: speed });

  if (typeof (subrace as any)?.speed === "number") {
    const delta = (subrace as any).speed - speed;
    items.push({ label: `亚种速度覆盖`, value: delta });
    speed = (subrace as any).speed;
  }

  const traits: any[] = (subrace as any)?.traits || [];
  for (const t of traits) {
    if (typeof t?.speedBonus === "number") {
      items.push({ label: `亚种特性：${t.name}`, value: t.speedBonus });
      speed += t.speedBonus;
    }
    if (typeof t?.speed === "number") {
      const delta = t.speed - speed;
      items.push({ label: `亚种特性覆盖：${t.name}` , value: delta });
      speed = t.speed;
    }
  }

  // Class passive features (Fast Movement, Unarmored Movement)
  const classId = character?.class_id || character?.classId || "";
  const subclassId = character?.subclass_id || character?.subclassId;
  const level = character?.level || 1;

  if (classId) {
    const raceId = character?.race_id || character?.raceId;
    const subraceId = character?.subrace_id || character?.subraceId;
    const passiveFeatures = getPassiveFeatures({ classId, subclassId, level, raceId, subraceId });
    if (passiveFeatures.speedBonus > 0) {
      const equipment = character?.equipment || [];
      const armor = equipment.find((it: any) =>
        it?.equippedSlot === "armor" ||
        ["padded","leather","studded_leather","hide","chain_shirt","scale_mail",
         "breastplate","half_plate","ring_mail","chain_mail","splint","plate"].includes(it?.id)
      );
      const shield = equipment.find((it: any) => it?.equippedSlot === "off_hand" && it?.id === "shield");

      const isMonk = classId.toLowerCase() === "monk";
      const isBarbarian = classId.toLowerCase() === "barbarian";
      const heavyArmorIds = ["ring_mail", "chain_mail", "splint", "plate"];
      const hasHeavyArmor = armor && heavyArmorIds.includes(armor.id);

      // Find the speed bonus feature for label
      const speedFeature = passiveFeatures.allFeatures.find(f => f.type === "speed_bonus");
      const featureName = speedFeature?.name || "职业特性";

      if (isMonk && !armor && !shield) {
        items.push({ label: featureName, value: passiveFeatures.speedBonus });
        speed += passiveFeatures.speedBonus;
      } else if (isBarbarian && !hasHeavyArmor) {
        items.push({ label: featureName, value: passiveFeatures.speedBonus });
        speed += passiveFeatures.speedBonus;
      }
    }
  }

  // Feat speed bonuses (e.g. Mobile: +10)
  const featBonuses = getFeatPassiveBonuses(character?.feats || []);
  if (featBonuses.speed_bonus) {
    items.push({ label: "专长：机动", value: featBonuses.speed_bonus });
    speed += featBonuses.speed_bonus;
  }

  return { final: speed, items };
}

export function getSkillBreakdown(character: any, skillId: string) {
  const skill = (skillsData as any)?.skills?.find((s: any) => s.id === skillId);
  if (!skill) return { final: 0, items: [] };
  const fas = computeFinalAbilityScores(character);
  const mods = computeAbilityMods(fas);
  const abilityMod = (mods as any)[skill.ability] ?? 0;
  const profSet: Set<string> = new Set(
    (character.selected_skills as string[]) || (character.selectedSkills as string[]) || []
  );
  // beguiling_influence 祈唤：获得欺瞒和游说熟练
  const invIds = getInvocationIds(character);
  if (invIds.includes('beguiling_influence')) {
    profSet.add('deception');
    profSet.add('persuasion');
  }
  const expSet: Set<string> = new Set(
    (character.expertise_skills as string[]) || (character.expertiseSkills as string[]) || []
  );
  const pb = computeProficiencyBonus(character);
  let total = abilityMod;
  const items: { label: string; value: number }[] = [];
  items.push({ label: `${skill.name} 关联属性(${skill.ability.toUpperCase()})调整值`, value: abilityMod });
  if (expSet.has(skillId)) {
    items.push({ label: "专精 ×2 熟练", value: pb * 2 });
    total += pb * 2;
  } else if (profSet.has(skillId)) {
    const isFromInvocation = invIds.includes('beguiling_influence') &&
      (skillId === 'deception' || skillId === 'persuasion') &&
      !((character.selected_skills as string[]) || (character.selectedSkills as string[]) || []).includes(skillId);
    items.push({ label: isFromInvocation ? "熟练加值（诱导话术）" : "熟练加值", value: pb });
    total += pb;
  }
  return { final: total, items };
}

export function getHitDiceBreakdown(character: any) {
  const cls = character?.class_id || character?.classId;
  const classDie: Record<string, number> = {
    barbarian: 12, fighter: 10, paladin: 10, ranger: 10,
    bard: 8, cleric: 8, druid: 8, monk: 8, rogue: 8, warlock: 8,
    sorcerer: 6, wizard: 6, artificer: 8,
  };
  const die = classDie[cls] || 8;
  const level = Number(character?.level || 1);
  const items: { label: string; value: number }[] = [];
  items.push({ label: `职业生命骰`, value: die });
  items.push({ label: `等级 → 骰数量`, value: level });
  // final 表示骰子数量，diceSize 表示骰面数，由弹窗负责渲染成 XdY
  return { final: level, items, diceSize: die } as any;
}

export function getSpellSaveDCBreakdown(character: any) {
  const level = Number(character?.level || 1);
  const pb = computeProficiencyBonus(level);
  const cls = character?.class_id || character?.classId;
  const fas = computeFinalAbilityScores(character);
  const abilityKey = (spellcastingAbilityMap as any)[cls] || character?.spellcasting_ability || character?.spellcastingAbility;
  const abilityMod = abilityKey ? getModifier((fas as any)[abilityKey] ?? 10) : 0;
  const total = 8 + pb + abilityMod;
  const label = abilityKey ? `${String(abilityKey).toUpperCase()} 调整值` : "施法属性调整值";
  const items = [
    { label: "基础 DC", value: 8 },
    { label: "熟练加值", value: pb },
    { label, value: abilityMod },
  ];
  return { final: total, items };
}

export function getSpellAttackBonusBreakdown(character: any) {
  const level = Number(character?.level || 1);
  const pb = computeProficiencyBonus(level);
  const cls = character?.class_id || character?.classId;
  const fas = computeFinalAbilityScores(character);
  const abilityKey = (spellcastingAbilityMap as any)[cls] || character?.spellcasting_ability || character?.spellcastingAbility;
  const abilityMod = abilityKey ? getModifier((fas as any)[abilityKey] ?? 10) : 0;
  const total = pb + abilityMod;
  const label = abilityKey ? `${String(abilityKey).toUpperCase()} 调整值` : "施法属性调整值";
  const items = [
    { label: "熟练加值", value: pb },
    { label, value: abilityMod },
  ];
  return { final: total, items };
}
