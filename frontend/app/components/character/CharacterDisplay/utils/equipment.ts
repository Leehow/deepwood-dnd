import equipmentData from "~/data/rules/equipment.json";
import { findArmorMetaById, findWeaponMetaById } from "./rules";
import type { EquipmentItem } from "../types/Character";
import { getPassiveFeatures } from "~/hooks/usePassiveFeatures";
import { getFeatPassiveBonuses } from "./featEffects";

/** 判断物品是否为双手武器（two-handed），双用（versatile）不算 */
export const isTwoHandedWeapon = (item: EquipmentItem | null | undefined): boolean => {
  if (!item) return false;
  // 先检查 item 自身的 properties
  const props: string[] = (item as any)?.properties || [];
  if (props.includes("two-handed")) return true;
  // 再查 meta
  const meta = findWeaponMetaById(item.id);
  const metaProps: string[] = (meta as any)?.properties || [];
  return metaProps.includes("two-handed");
};

/** 判断物品是否为双用武器（versatile） */
export const isVersatileWeapon = (item: EquipmentItem | null | undefined): boolean => {
  if (!item) return false;
  const props: string[] = (item as any)?.properties || [];
  if (props.includes("versatile")) return true;
  const meta = findWeaponMetaById(item.id);
  const metaProps: string[] = (meta as any)?.properties || [];
  return metaProps.includes("versatile");
};

/** 获取双用武器的单手/双手伤害骰 */
export const getVersatileDamage = (item: EquipmentItem | null | undefined): { oneHand: string; twoHand: string } | null => {
  if (!item) return null;
  const meta = item?.damage ? item : findWeaponMetaById(item.id);
  if (!meta) return null;
  const d: any = meta?.damage;
  const oneHand = typeof d === "string" ? d : d?.dice;
  const twoHand = (meta as any)?.versatileDamage;
  if (!oneHand || !twoHand) return null;
  return { oneHand, twoHand };
};

export const getArmorSummary = (it: EquipmentItem): string => {
  const meta = findArmorMetaById(it.id);
  if (!meta) return "";
  if (meta.tier === "shield") return "+2 AC";
  const base = (meta as any).acBase ?? (meta as any).ac ?? undefined;
  if (base == null) {
    const map: Record<string, string> = {
      padded: "AC 11 + 敏",
      leather: "AC 11 + 敏",
      studded_leather: "AC 12 + 敏",
      hide: "AC 12 + 最多+2敏",
      chain_shirt: "AC 13 + 最多+2敏",
      scale_mail: "AC 14 + 最多+2敏",
      breastplate: "AC 14 + 最多+2敏",
      half_plate: "AC 15 + 最多+2敏",
      ring_mail: "AC 14",
      chain_mail: "AC 16",
      splint: "AC 17",
      plate: "AC 18",
    };
    return map[it.id] || "";
  }
  if (meta.tier === "light") return `AC ${base} + 敏`;
  if (meta.tier === "medium") return `AC ${base} + 最多+2敏`;
  return `AC ${base}`;
};

export const getArmorACDisplay = (it: EquipmentItem | string): string => {
  const itemId = typeof it === 'string' ? it : it.id;
  const meta = findArmorMetaById(itemId);
  if (!meta) return "";
  if (meta.tier === "shield") return "+2";
  const baseRaw: any = (meta as any).acBase ?? (meta as any).ac ?? (meta as any).acFormula?.base;
  const base = typeof baseRaw === "string" ? parseInt(baseRaw, 10) : baseRaw;
  if (base == null) {
    const map: Record<string, string> = {
      padded: "11 + 敏",
      leather: "11 + 敏",
      studded_leather: "12 + 敏",
      hide: "12 + 最多+2敏",
      chain_shirt: "13 + 最多+2敏",
      scale_mail: "14 + 最多+2敏",
      breastplate: "14 + 最多+2敏",
      half_plate: "15 + 最多+2敏",
      ring_mail: "14",
      chain_mail: "16",
      splint: "17",
      plate: "18",
    };
    return map[itemId] || "";
  }
  if (meta.tier === "light") return `${base} + 敏`;
  if (meta.tier === "medium") return `${base} + 最多+2敏`;
  return `${base}`;
};

// 伤害类型翻译
const DAMAGE_TYPE_MAP: Record<string, string> = {
  bludgeoning: "钝击",
  piercing: "穿刺",
  slashing: "挥砍",
  fire: "火焰",
  cold: "冰冷",
  lightning: "闪电",
  thunder: "雷鸣",
  acid: "强酸",
  poison: "毒素",
  psychic: "心灵",
  radiant: "光耀",
  necrotic: "黯蚀",
  force: "力场",
};

// 武器属性翻译
const PROPERTY_MAP: Record<string, string> = {
  versatile: "双用",
  light: "轻型",
  finesse: "灵巧",
  heavy: "沉重",
  reach: "长柄",
  thrown: "投掷",
  "two-handed": "双手",
  loading: "装填",
  ammunition: "弹药",
  special: "特殊",
};

export const getWeaponSummary = (it: EquipmentItem): string => {
  const meta = it?.damage ? it : findWeaponMetaById(it?.id);
  if (!meta) return "";

  const d: any = meta?.damage;
  const dmg = typeof d === "string" ? d : d?.dice;
  if (!dmg) return "";

  // 伤害类型
  const dmgType = (meta as any)?.damageType;
  const dmgTypeStr = dmgType ? DAMAGE_TYPE_MAP[dmgType] || dmgType : "";

  // 关键属性（只显示最重要的）
  const props: string[] = (meta as any)?.properties || [];
  const keyProps = props
    .filter(p => ["finesse", "versatile", "two-handed", "light", "reach", "thrown"].includes(p))
    .map(p => PROPERTY_MAP[p] || p)
    .slice(0, 2); // 最多显示2个属性

  // 双用武器根据 gripMode 自动选择伤害骰
  const versatileDmg = (meta as any)?.versatileDamage;
  let result: string;
  if (versatileDmg && it.gripMode === "two-hand") {
    result = versatileDmg;
  } else {
    result = dmg;
  }
  if (dmgTypeStr) result += ` ${dmgTypeStr}`;
  if (keyProps.length > 0) result += ` (${keyProps.join("/")})`;

  return result;
};

export const getGearSummary = (
  it: EquipmentItem,
  focusIds?: Set<string>,
  lightSourceIds?: Set<string>
): string => {
  if (focusIds && focusIds.has(it.id)) return "施法焦点";
  if (lightSourceIds && lightSourceIds.has(it.id)) return "光源";
  if (it.equipmentType === "tool") return "工具";
  return it.equipmentType || "";
};

export const getEquipmentSummary = (
  it: EquipmentItem | null | undefined,
  focusIds?: Set<string>,
  lightSourceIds?: Set<string>
): string => {
  if (!it) return "";
  if (it.id === "shield") return "+2 AC";

  // 先尝试查找武器元数据（不依赖 equipmentType 字段）
  const weapon = findWeaponMetaById(it.id);
  if (it.equipmentType === "weapon" || weapon) return getWeaponSummary(it);

  const armor = findArmorMetaById(it.id);
  if (it.equipmentType === "armor" || armor) return getArmorSummary(it);

  return getGearSummary(it, focusIds, lightSourceIds);
};

export const calculateAC = (
  character: any,
  finalAbilityScores: Record<string, number>,
  equipmentLocal: EquipmentItem[]
): number => {
  let ac = 10;
  const dexMod = Math.floor((finalAbilityScores.dexterity - 10) / 2);
  const equipment = equipmentLocal || [];

  const armor =
    equipment.find((it: any) => it?.equippedSlot === "armor") ||
    equipment.find((item: any) => {
      const itemId = String(item?.id || '');
      return itemId && (
        itemId.includes("armor") ||
        itemId === "padded" ||
        itemId === "leather" ||
        itemId === "studded_leather" ||
        itemId === "hide" ||
        itemId === "chain_shirt" ||
        itemId === "scale_mail" ||
        itemId === "breastplate" ||
        itemId === "half_plate" ||
        itemId === "ring_mail" ||
        itemId === "chain_mail" ||
        itemId === "splint" ||
        itemId === "plate"
      );
    });

  let usedUnarmoredDefense = false;

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

    const armorData = (armorAC as any)[armor.id];
    if (armorData) {
      ac = armorData.base;
      if (armorData.dexBonus) {
        const maxBonus = armorData.maxDexBonus ?? Infinity;
        ac += Math.min(dexMod, maxBonus);
      }
    } else if (armor.ac !== undefined && armor.ac !== null) {
      // Custom/generated armor: handle both object {base, dex_bonus} and number formats
      const acVal = armor.ac as any;
      if (typeof acVal === 'object' && acVal.base !== undefined) {
        ac = Number(acVal.base) || 10;
        if (acVal.dex_bonus || acVal.dexBonus) {
          const maxBonus = acVal.max_dex_bonus ?? acVal.maxDexBonus ?? Infinity;
          ac += Math.min(dexMod, maxBonus);
        }
      } else {
        ac = Number(acVal) || 10;
      }
      if (armor.acBonus) ac += Number(armor.acBonus);
      // Apply magic_bonus for custom armor
      if (armor.magic_bonus) ac += Number(armor.magic_bonus);
    }
  } else {
    // Check for Unarmored Defense via passive features system
    const classId = character.class_id || character.classId || "";
    const subclassId = character.subclass_id || character.subclassId;
    const level = character.level || 1;
    const raceId = character.race_id || character.raceId;
    const subraceId = character.subrace_id || character.subraceId;
    const passiveFeatures = getPassiveFeatures({ classId, subclassId, level, raceId, subraceId });

    // armor_of_shadows 祈唤：无甲时 AC = 13 + DEX（法师护甲）
    const invocations = character.eldritch_invocations || character.eldritchInvocations || [];
    const invIds = invocations.map((i: any) => typeof i === 'string' ? i : i.value || i.id || '');
    const hasArmorOfShadows = invIds.includes('armor_of_shadows');
    const mageArmorAC = hasArmorOfShadows ? 13 + dexMod : 0;

    if (passiveFeatures.acFormula) {
      const formula = passiveFeatures.acFormula.effect.formula || "";
      let unarmoredAC = 10 + dexMod;
      if (formula.includes("con")) {
        const conMod = Math.floor((finalAbilityScores.constitution - 10) / 2);
        unarmoredAC = 10 + dexMod + conMod;
      } else if (formula.includes("wis")) {
        const wisMod = Math.floor((finalAbilityScores.wisdom - 10) / 2);
        unarmoredAC = 10 + dexMod + wisMod;
      }
      // 取无甲防御和法师护甲中较高者
      ac = Math.max(unarmoredAC, mageArmorAC);
      usedUnarmoredDefense = true;
    } else if (hasArmorOfShadows) {
      ac = mageArmorAC;
    } else {
      ac = 10 + dexMod;
    }
  }

  const offhandShield = equipment.find((it: any) => it?.equippedSlot === "off_hand" && it.id === "shield");
  if (offhandShield) {
    // Monk's Unarmored Defense doesn't work with shield
    const classId = character.class_id || character.classId || "";
    const isMon = classId.toLowerCase() === "monk";
    if (!(usedUnarmoredDefense && isMon)) {
      ac += 2;
    }
  }

  // Fighting Style: Defense — +1 AC when wearing armor
  const fs = (character as any).fighting_style || (character as any).fightingStyle;
  const fsValue = fs && typeof fs === 'object' ? fs.value : fs;
  if (fsValue === "defense" && armor) {
    ac += 1;
  }

  // Feat AC bonuses
  const featBonuses = getFeatPassiveBonuses(character?.feats || []);
  const mainHand = equipment.find((it: any) => it?.equippedSlot === "main_hand");
  const offHand = equipment.find((it: any) => it?.equippedSlot === "off_hand");

  for (const acb of featBonuses.ac_bonuses) {
    if (acb.condition === "dual_wielding" && mainHand && offHand && offHand.id !== "shield") {
      ac += acb.value;
    } else if (acb.condition === "light_armor") {
      const lightArmorIds = ["padded", "leather", "studded_leather"];
      if (armor && lightArmorIds.includes(armor.id)) ac += acb.value;
    }
  }

  // Medium Armor Master: dex cap +1
  if (featBonuses.medium_armor_dex_cap_bonus && armor) {
    const mediumArmorIds = ["hide", "chain_shirt", "scale_mail", "breastplate", "half_plate"];
    if (mediumArmorIds.includes(armor.id)) {
      const extraDex = Math.min(featBonuses.medium_armor_dex_cap_bonus, Math.max(0, dexMod - 2));
      if (extraDex > 0) ac += extraDex;
    }
  }

  return ac;
};

