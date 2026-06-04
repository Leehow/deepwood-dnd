import racesData from "~/data/rules/races.json";
import classesData from "~/data/rules/classes_with_structured_subclass_features.json";
import { findArmorMetaById, findWeaponMetaById, getWeaponGroupAndType } from "./rules";
import { getFeatProficiencyGrants } from "./featEffects";

export const getCharacterWeaponArmorProfs = (character: any) => {
  const weapon = new Set<string>();
  const armor = new Set<string>();
  const tool = new Set<string>();
  const addArr = (set: Set<string>, arr?: string[]) => (arr || []).forEach((x) => set.add(x));

  const race = (racesData as any).races.find((r: any) => r.id === character.race_id);
  const subrace = race?.subraces?.find((sr: any) => sr.id === character.subrace_id);
  const raceTraits = [...(race?.traits || []), ...(((subrace as any)?.traits) || [])];
  raceTraits.forEach((t: any) => {
    addArr(weapon, (t.weaponProficiencies as string[]) || []);
    addArr(armor, (t.armorProficiencies as string[]) || []);
    addArr(tool, (t.toolProficiencies as string[]) || []);
    if (t.structuredData) {
      addArr(weapon, (t.structuredData.weaponProficiencies as string[]) || []);
      addArr(armor, (t.structuredData.armorProficiencies as string[]) || []);
      addArr(tool, (t.structuredData.toolProficiencies as string[]) || []);
    }
  });

  const charClass = (classesData as any).classes.find((c: any) => c.id === character.class_id);
  const subclass = charClass?.subclasses?.find((sc: any) => sc.id === character.subclass_id);
  addArr(armor, ((charClass as any)?.proficiencies?.armor as string[]) || []);
  addArr(weapon, ((charClass as any)?.proficiencies?.weapons as string[]) || []);
  addArr(tool, ((charClass as any)?.proficiencies?.tools as string[]) || []);
  (((subclass as any)?.level1Features || []) as any[]).forEach((f: any) => {
    if (f.structuredData) {
      addArr(armor, (f.structuredData.armorProficiencies as string[]) || []);
      addArr(weapon, (f.structuredData.weaponProficiencies as string[]) || []);
      addArr(tool, (f.structuredData.toolProficiencies as string[]) || []);
    }
  });

  // Feat-granted armor proficiencies (heavily_armored, moderately_armored, lightly_armored)
  const featGrants = getFeatProficiencyGrants(
    character?.feats || [], character?.feat_choices
  );
  for (const at of featGrants.armorTypes) armor.add(at);
  for (const w of featGrants.weapons) weapon.add(w);
  for (const wt of featGrants.weaponTypes) weapon.add(wt);

  return { weapon, armor } as const;
};

export const isProficientWithWeaponId = (id: string, character: any): boolean => {
  const info = getWeaponGroupAndType(id);
  const { weapon } = getCharacterWeaponArmorProfs(character);
  if (!info) return weapon.has(id) || weapon.has(id + "s"); // handle singular/plural
  if (info.group === "martial" && weapon.has("martial_weapons")) return true;
  if (info.group === "simple" && weapon.has("simple_weapons")) return true;
  // Check both singular and plural forms (quarterstaff vs quarterstaffs)
  return weapon.has(id) || weapon.has(id + "s");
};

export const isProficientWithArmorId = (id: string, character: any): boolean => {
  const meta = findArmorMetaById(id);
  const { armor } = getCharacterWeaponArmorProfs(character);
  if (!meta) return armor.has(id);
  if (meta.tier === "shield") return armor.has("shields") || armor.has(id);
  if (meta.tier === "light") return armor.has("light_armor") || armor.has(id);
  if (meta.tier === "medium") return armor.has("medium_armor") || armor.has(id);
  if (meta.tier === "heavy") return armor.has("heavy_armor") || armor.has(id);
  return armor.has(id);
};

/**
 * 检查角色当前装备的护甲/盾牌是否不熟练
 * 返回不熟练装备的惩罚信息
 */
export interface ArmorProficiencyPenalty {
  hasNonProficientArmor: boolean;
  hasNonProficientShield: boolean;
  nonProficientItems: { id: string; name: string; slot: string }[];
  // D&D 5E 规则：穿戴不熟练护甲/盾牌的惩罚
  penalties: {
    disadvantageOnStrDexChecks: boolean;  // 力量/敏捷的属性检定劣势
    disadvantageOnStrDexSaves: boolean;   // 力量/敏捷的豁免检定劣势
    disadvantageOnAttackRolls: boolean;   // 攻击检定劣势
    cannotCastSpells: boolean;            // 无法施法
  };
}

export const checkArmorProficiencyPenalty = (character: any): ArmorProficiencyPenalty => {
  const equipment = character?.equipment || [];
  const nonProficientItems: { id: string; name: string; slot: string }[] = [];
  let hasNonProficientArmor = false;
  let hasNonProficientShield = false;

  // 检查护甲槽
  const equippedArmor = equipment.find((it: any) => it?.equippedSlot === "armor");
  if (equippedArmor && equippedArmor.id) {
    const meta = findArmorMetaById(equippedArmor.id);
    // 只检查实际护甲，不检查普通衣物
    if (meta && (meta.tier === "light" || meta.tier === "medium" || meta.tier === "heavy")) {
      if (!isProficientWithArmorId(equippedArmor.id, character)) {
        hasNonProficientArmor = true;
        nonProficientItems.push({
          id: equippedArmor.id,
          name: equippedArmor.name || equippedArmor.id,
          slot: "armor",
        });
      }
    }
  }

  // 检查副手槽（盾牌）
  const equippedOffhand = equipment.find((it: any) => it?.equippedSlot === "off_hand");
  if (equippedOffhand && equippedOffhand.id === "shield") {
    if (!isProficientWithArmorId("shield", character)) {
      hasNonProficientShield = true;
      nonProficientItems.push({
        id: "shield",
        name: equippedOffhand.name || "盾牌",
        slot: "off_hand",
      });
    }
  }

  const hasPenalty = hasNonProficientArmor || hasNonProficientShield;

  return {
    hasNonProficientArmor,
    hasNonProficientShield,
    nonProficientItems,
    penalties: {
      disadvantageOnStrDexChecks: hasPenalty,
      disadvantageOnStrDexSaves: hasPenalty,
      disadvantageOnAttackRolls: hasPenalty,
      cannotCastSpells: hasPenalty,
    },
  };
};

/**
 * 检查角色当前装备的武器是否不熟练
 * 武器不熟练的惩罚：攻击检定不加熟练加值（但没有其他惩罚）
 */
export interface WeaponProficiencyInfo {
  mainHand: { id: string; name: string; proficient: boolean } | null;
  offHand: { id: string; name: string; proficient: boolean } | null;
  hasNonProficientWeapon: boolean;
}

export const checkWeaponProficiency = (character: any): WeaponProficiencyInfo => {
  const equipment = character?.equipment || [];
  let hasNonProficientWeapon = false;
  let mainHand: { id: string; name: string; proficient: boolean } | null = null;
  let offHand: { id: string; name: string; proficient: boolean } | null = null;

  // 检查主手武器
  const equippedMainHand = equipment.find((it: any) => it?.equippedSlot === "main_hand");
  if (equippedMainHand && equippedMainHand.id) {
    const weaponMeta = findWeaponMetaById(equippedMainHand.id);
    // 只有是武器才检查熟练
    if (weaponMeta) {
      const proficient = isProficientWithWeaponId(equippedMainHand.id, character);
      mainHand = {
        id: equippedMainHand.id,
        name: equippedMainHand.name || equippedMainHand.id,
        proficient,
      };
      if (!proficient) hasNonProficientWeapon = true;
    }
  }

  // 检查副手武器（不是盾牌的情况）
  const equippedOffHand = equipment.find((it: any) => it?.equippedSlot === "off_hand");
  if (equippedOffHand && equippedOffHand.id && equippedOffHand.id !== "shield") {
    const weaponMeta = findWeaponMetaById(equippedOffHand.id);
    if (weaponMeta) {
      const proficient = isProficientWithWeaponId(equippedOffHand.id, character);
      offHand = {
        id: equippedOffHand.id,
        name: equippedOffHand.name || equippedOffHand.id,
        proficient,
      };
      if (!proficient) hasNonProficientWeapon = true;
    }
  }

  return { mainHand, offHand, hasNonProficientWeapon };
};

