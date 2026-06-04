import type { MonsterAction } from "../SelectionContextMenu";

export interface ParsedMonsterDamageProfile {
  damageStr: string;
  damageType: string;
  extraDamage: { dice: string; type: string } | null;
  damageTypeCn: string;
}

export interface ParsedMonsterRange {
  normalRange: number;
  maxRange: number;
}

const DAMAGE_TYPE_CN: Record<string, string> = {
  fire: "火焰",
  cold: "冰冷",
  lightning: "闪电",
  thunder: "雷鸣",
  poison: "毒素",
  acid: "强酸",
  necrotic: "黯蚀",
  radiant: "光耀",
  force: "力场",
  psychic: "心灵",
  piercing: "穿刺",
  slashing: "挥砍",
  bludgeoning: "钝击",
};

export function parseMonsterAttackBonus(action: Pick<MonsterAction, "attack_bonus" | "description">): number | undefined {
  if (action.attack_bonus !== undefined) {
    return action.attack_bonus;
  }

  if (!action.description) {
    return undefined;
  }

  const match =
    action.description.match(/([+-]?\d+)\s*(?:的)?命中/) ||
    action.description.match(/命中(?:加值|检定)?\s*([+-]?\s*\d+)/) ||
    action.description.match(/名字\s*([+-]?\d+)/) ||
    action.description.match(/\\\(\s*\+\s*(\d+)\s*\\\)/);

  if (!match) {
    return undefined;
  }

  return Number.parseInt(match[1].replace(/\s/g, ""), 10);
}

export function parseMonsterDamageProfile(
  action: Pick<MonsterAction, "damage" | "extra_damage" | "description">,
): ParsedMonsterDamageProfile {
  let damageStr = "";
  let damageType = "";
  let damageTypeCn = "火焰";

  if (action.damage) {
    damageStr = action.damage.dice || "";
    if (typeof action.damage.bonus === "number") {
      damageStr += action.damage.bonus > 0 ? `+${action.damage.bonus}` : `${action.damage.bonus}`;
    }
    damageType = action.damage.type || "";
    damageTypeCn = DAMAGE_TYPE_CN[damageType.toLowerCase()] || damageType || "火焰";
  } else if (action.description) {
    const baseDamageMatch =
      action.description.match(/伤害[:：]\s*\d+\s*[（(](\d+d\d+)([+-]\d+)?[)）]\s*(?:的|de|点)?\s*([^\s伤害外加]+)?伤害/i) ||
      action.description.match(/造成\s*\d+\s*[（(](\d+d\d+)([+-]\d+)?[)）]\s*(?:点)?([^\s伤害，。]+)?伤害/i) ||
      action.description.match(/造成\s*(\d+d\d+)([+-]\d+)?\s*(?:的|点)?\s*([^\s伤害]+)?伤害/i) ||
      action.description.match(/(?:单次)?(?:伤害)?\s*(?:\d+\s*)?[（(]?(\d+d\d+)([+-]\d+)?[)）]?\s*([^\s\d伤害，。()（）]+)?伤害/i) ||
      action.description.match(/(\d+d\d+)([+-]\d+)?\s*(?:点)?([^\s\d伤害，。()（）]+)?伤害/i);

    if (baseDamageMatch) {
      damageStr = baseDamageMatch[1] + (baseDamageMatch[2] || "");
      damageType = baseDamageMatch[3] || "";
      if (damageType) {
        const normalized = Object.entries(DAMAGE_TYPE_CN).find(([, cn]) => damageType.includes(cn));
        if (normalized) {
          damageType = normalized[0];
          damageTypeCn = normalized[1];
        } else {
          damageTypeCn = damageType;
        }
      }
    }
  }

  let extraDamage: { dice: string; type: string } | null = null;
  if (action.extra_damage?.dice) {
    extraDamage = {
      dice: action.extra_damage.dice,
      type: action.extra_damage.type || "",
    };
  } else if (action.description) {
    const extraDamageMatch =
      action.description.match(/外加\s*\d*\s*\((\d+d\d+(?:[+-]\d+)?)\)\s*(?:的|点)?([^\s伤害]+)?伤害/i) ||
      action.description.match(/plus\s+\d+\s*\((\d+d\d+(?:[+-]\d+)?)\)\s*(\w+)?\s*damage/i);
    if (extraDamageMatch) {
      extraDamage = {
        dice: extraDamageMatch[1],
        type: extraDamageMatch[2] || "",
      };
    }
  }

  return {
    damageStr: damageStr || "1d4",
    damageType,
    extraDamage,
    damageTypeCn,
  };
}

export function parseMonsterActionRange(action: Pick<MonsterAction, "reach" | "range" | "description">): ParsedMonsterRange {
  const raw = action.reach || action.range;
  if (raw != null) {
    const match = String(raw).match(/(\d+)(?:\/(\d+))?/);
    if (match) {
      const normalRange = Number.parseInt(match[1], 10);
      return {
        normalRange,
        maxRange: match[2] ? Number.parseInt(match[2], 10) : normalRange,
      };
    }
  }

  if (action.description) {
    const rangedMatch = action.description.match(/(?:射程|range)\s*(\d+)\/(\d+)/i);
    if (rangedMatch) {
      return {
        normalRange: Number.parseInt(rangedMatch[1], 10),
        maxRange: Number.parseInt(rangedMatch[2], 10),
      };
    }

    const singleRangeMatch = action.description.match(/(?:射程|range)\s*(\d+)/i);
    if (singleRangeMatch) {
      const range = Number.parseInt(singleRangeMatch[1], 10);
      return { normalRange: range, maxRange: range };
    }

    const reachMatch = action.description.match(/触及\s*(\d+)\s*尺/);
    if (reachMatch) {
      const reach = Number.parseInt(reachMatch[1], 10);
      return { normalRange: reach, maxRange: reach };
    }
  }

  return { normalRange: 5, maxRange: 5 };
}

export function parseMonsterAreaAction(action: Pick<MonsterAction, "area" | "save" | "damage" | "description">) {
  const saveAbilityToEn: Record<string, string> = {
    力量: "str",
    敏捷: "dex",
    体质: "con",
    智力: "int",
    感知: "wis",
    魅力: "cha",
    strength: "str",
    dexterity: "dex",
    constitution: "con",
    intelligence: "int",
    wisdom: "wis",
    charisma: "cha",
  };
  const saveAbilityToCn: Record<string, string> = {
    str: "力量",
    dex: "敏捷",
    con: "体质",
    int: "智力",
    wis: "感知",
    cha: "魅力",
    力量: "力量",
    敏捷: "敏捷",
    体质: "体质",
    智力: "智力",
    感知: "感知",
    魅力: "魅力",
  };

  const rawAbility = (action.save?.ability || "dex").toLowerCase();
  const saveTypeEn = saveAbilityToEn[rawAbility] || rawAbility.substring(0, 3);
  const saveTypeCn = saveAbilityToCn[rawAbility] || saveAbilityToCn[saveTypeEn] || rawAbility;
  const shape = action.area?.shape?.toLowerCase() === "line" ? "line" : "cone";

  let sizeFeet = 15;
  if (action.area?.size) {
    const sizeMatch = String(action.area.size).match(/(\d+)/);
    if (sizeMatch) {
      sizeFeet = Number.parseInt(sizeMatch[1], 10);
    }
  }

  const { damageStr, damageType, damageTypeCn } = parseMonsterDamageProfile(action);

  return {
    saveTypeEn,
    saveTypeCn,
    shape,
    sizeFeet,
    damageStr,
    damageType: damageType || "fire",
    damageTypeCn,
    saveDC: action.save?.dc || 13,
    saveEffect: action.save?.success_effect === "none" ? "none" : "half",
  };
}
