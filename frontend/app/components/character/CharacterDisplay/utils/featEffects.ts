import featsData from "~/data/rules/feats.json";

export interface ACBonus {
  value: number;
  condition: string; // "dual_wielding" | "light_armor"
  featName: string;
}

export interface DamageReduction {
  amount: number;
  types: string[];
  condition: string;
}

export interface FeatPassiveBonuses {
  initiative_bonus: number;
  speed_bonus: number;
  hp_per_level: number;
  passive_perception_bonus: number;
  passive_investigation_bonus: number;
  medium_armor_dex_cap_bonus: number;
  light_armor_dex_cap_bonus: number;
  ac_bonuses: ACBonus[];
  advantage: string[];
  damage_reduction: DamageReduction | null;
  /** 盾牌大师: 将盾牌AC加到敏捷豁免 */
  has_shield_dex_save_bonus: boolean;
  /** 酒馆斗殴者: 徒手攻击伤害骰 */
  unarmed_damage_die: string | null;
}

const EMPTY_BONUSES: FeatPassiveBonuses = {
  initiative_bonus: 0,
  speed_bonus: 0,
  hp_per_level: 0,
  passive_perception_bonus: 0,
  passive_investigation_bonus: 0,
  medium_armor_dex_cap_bonus: 0,
  light_armor_dex_cap_bonus: 0,
  ac_bonuses: [],
  advantage: [],
  damage_reduction: null,
  has_shield_dex_save_bonus: false,
  unarmed_damage_die: null,
};

const feats = (featsData as any).feats || {};

/** 优势标记的中文说明 */
export const ADVANTAGE_LABELS: Record<string, string> = {
  concentration_save: "专注豁免有优势",
  save_vs_spell_within_5ft: "5尺内法术豁免有优势",
  deception_disguise: "伪装时欺瞒有优势",
  performance_disguise: "伪装时表演有优势",
  attack_grappled_creature: "攻击被擒抱生物有优势",
  attack_smaller_unmounted: "攻击比坐骑小的生物有优势",
  perception_secret_doors: "察觉检定侦测秘门有优势",
  investigation_secret_doors: "调查检定侦测秘门有优势",
  save_vs_traps: "陷阱豁免有优势",
};

/** 从 feats.json 读取被动效果，聚合所有已选专长的数值加成 */
export function getFeatPassiveBonuses(featIds: string[]): FeatPassiveBonuses {
  if (!featIds || featIds.length === 0) return { ...EMPTY_BONUSES, ac_bonuses: [], advantage: [] };

  const result: FeatPassiveBonuses = {
    ...EMPTY_BONUSES,
    ac_bonuses: [],
    advantage: [],
  };

  for (const id of featIds) {
    const feat = feats[id];
    if (!feat?.effects?.passive) continue;
    const p = feat.effects.passive;

    if (typeof p.initiative_bonus === "number") result.initiative_bonus += p.initiative_bonus;
    if (typeof p.speed_bonus === "number") result.speed_bonus += p.speed_bonus;
    if (typeof p.hp_per_level === "number") result.hp_per_level += p.hp_per_level;
    if (typeof p.passive_perception_bonus === "number") result.passive_perception_bonus += p.passive_perception_bonus;
    if (typeof p.passive_investigation_bonus === "number") result.passive_investigation_bonus += p.passive_investigation_bonus;
    if (typeof p.medium_armor_dex_cap_bonus === "number") result.medium_armor_dex_cap_bonus += p.medium_armor_dex_cap_bonus;
    if (typeof p.light_armor_dex_cap_bonus === "number") result.light_armor_dex_cap_bonus += p.light_armor_dex_cap_bonus;

    // ac_bonus: { value, condition }
    if (p.ac_bonus && typeof p.ac_bonus === "object" && typeof p.ac_bonus.value === "number") {
      result.ac_bonuses.push({ value: p.ac_bonus.value, condition: p.ac_bonus.condition || "", featName: feat.name });
    }

    // advantage: string[]
    if (Array.isArray(p.advantage)) {
      result.advantage.push(...p.advantage);
    }

    // damage_reduction: { amount, types, condition }
    if (p.damage_reduction && typeof p.damage_reduction === "object" && typeof p.damage_reduction.amount === "number") {
      result.damage_reduction = p.damage_reduction;
    }

    // shield_master: dex_save_bonus
    if (p.dex_save_bonus) {
      result.has_shield_dex_save_bonus = true;
    }

    // tavern_brawler: unarmed_damage_die
    if (typeof p.unarmed_damage_die === "string") {
      result.unarmed_damage_die = p.unarmed_damage_die;
    }
  }

  return result;
}

/** 根据专长ID列表返回 id → 中文名 的映射 */
export function getFeatNames(featIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of featIds) {
    const feat = feats[id];
    if (feat) map.set(id, feat.name);
  }
  return map;
}

// --- proficiency_grant 实装 ---

export interface FeatProficiencyGrants {
  savingThrows: string[];   // e.g. ["constitution"] from resilient
  armorTypes: string[];     // e.g. ["heavy"] from heavily_armored
  weapons: string[];        // specific weapon IDs from weapon_master
  weaponTypes: string[];    // "unarmed"/"improvised" from tavern_brawler
  skills: string[];         // skill IDs from skilled
}

/**
 * 解析专长授予的熟练项（豁免/护甲）
 * 需要 feat_choices 来解析需要选择的专长（如 resilient 选了哪个属性）
 */
export function getFeatProficiencyGrants(
  featIds: string[],
  featChoices?: Record<string, any> | null
): FeatProficiencyGrants {
  const result: FeatProficiencyGrants = { savingThrows: [], armorTypes: [], weapons: [], weaponTypes: [], skills: [] };
  if (!featIds || featIds.length === 0) return result;

  for (const id of featIds) {
    const feat = feats[id];
    if (!feat?.effects?.proficiency_grant) continue;
    const pg = feat.effects.proficiency_grant;

    // 豁免熟练 (resilient: saving_throw = "chosen_ability")
    if (pg.saving_throw === "chosen_ability") {
      const choice = featChoices?.[id]?.abilityChoice;
      if (choice) result.savingThrows.push(choice);
    }

    // 护甲熟练 (heavily_armored, moderately_armored, lightly_armored)
    if (Array.isArray(pg.armor)) {
      for (const tier of pg.armor) {
        if (tier === "heavy") result.armorTypes.push("heavy_armor");
        else if (tier === "medium") result.armorTypes.push("medium_armor");
        else if (tier === "light") result.armorTypes.push("light_armor");
        else if (tier === "shield") result.armorTypes.push("shields");
      }
    }

    // 武器类型熟练 (tavern_brawler: weapon = ["unarmed", "improvised"])
    if (Array.isArray(pg.weapon)) {
      for (const w of pg.weapon) result.weaponTypes.push(w);
    }

    // 具体武器熟练 (weapon_master: choices from feat_choices)
    if (typeof pg.weapons === "number") {
      const chosen = featChoices?.[id]?.weapons;
      if (Array.isArray(chosen)) {
        for (const w of chosen) result.weapons.push(w);
      }
    }

    // 技能熟练 (skilled: choices from feat_choices)
    if (pg.skills_or_tools) {
      const chosen = featChoices?.[id]?.skills;
      if (Array.isArray(chosen)) {
        for (const s of chosen) result.skills.push(s);
      }
    }
  }

  return result;
}

/** 获取角色所有专长的 rule_override 集合（用于跨模块检查规则覆写） */
export function getFeatRuleOverrides(featIds: string[]): Set<string> {
  const overrides = new Set<string>();
  if (!featIds || featIds.length === 0) return overrides;
  for (const id of featIds) {
    const feat = feats[id];
    if (Array.isArray(feat?.effects?.rule_override)) {
      for (const ro of feat.effects.rule_override) overrides.add(ro);
    }
  }
  return overrides;
}

// --- 战斗选项/触发/规则覆写 标签 ---

interface FeatCombatLabel {
  label: string;
  color: string; // tailwind color classes
  featName: string;
}

/** rule_override key → 中文标签 */
const RULE_OVERRIDE_LABELS: Record<string, string> = {
  cannot_be_surprised: "不会被突袭",
  invisible_no_advantage_against_you: "隐形生物攻击你无优势",
  climbing_no_extra_movement: "攀爬不消耗额外移动",
  running_jump_5ft_start: "助跑跳跃只需5尺",
  dash_ignores_difficult_terrain: "疾走忽略困难地形",
  no_opportunity_attack_after_melee: "近战攻击后不引发借机攻击",
  lip_reading: "可以读唇语",
  somatic_with_hands_full: "双手持物可施法",
  cantrip_as_opportunity_attack: "借机攻击可用戏法",
  ignore_half_and_three_quarters_cover_ranged: "忽略半掩护和3/4掩护(远程)",
  no_long_range_disadvantage: "远程远距无劣势",
  twf_no_light_requirement: "双持无需轻武器",
  draw_stow_two_weapons: "可同时拔收两把武器",
  no_stealth_disadvantage_medium_armor: "中甲无潜行劣势",
  double_spell_attack_range: "法术攻击射程翻倍",
  ignore_half_and_three_quarters_cover_spell: "忽略半掩护和3/4掩护(法术)",
  ignore_resistance_chosen_element: "忽略所选元素抗性",
  min_damage_die_2_chosen_element: "所选元素最小伤害骰为2",
  ignore_loading_crossbow: "忽略弩装填",
  no_disadvantage_ranged_within_5ft: "5尺内远程攻击无劣势",
  search_traps_normal_speed: "正常速度搜索陷阱",
  hit_die_min_double_con_mod: "生命骰恢复最低为体质调整值×2",
  mimic_speech: "可模仿他人语音",
  always_know_north: "总是知道北方",
  know_sunrise_sunset: "精确知道日出日落",
  perfect_recall_1_month: "完美记忆（1个月内）",
  create_cipher: "可创造密文",
  mount_evasion: "坐骑获得类反射闪避",
  ritual_casting_from_book: "仪式书施法",
  copy_ritual_spells_to_book: "可抄录仪式法术",
  reroll_melee_damage_once_per_turn: "每轮可重投一次近战伤害",
  hide_in_light_obscurement: "可在轻度遮蔽中躲藏",
  ranged_miss_no_reveal: "远程未命中不暴露位置",
  no_perception_disadvantage_in_darkness: "黑暗中察觉无劣势",
};

/**
 * 提取专长的战斗选项/触发/规则覆写标签
 * 用于在角色卡上显示提醒信息
 */
export function getFeatCombatLabels(featIds: string[]): FeatCombatLabel[] {
  if (!featIds || featIds.length === 0) return [];
  const labels: FeatCombatLabel[] = [];

  for (const id of featIds) {
    const feat = feats[id];
    if (!feat?.effects) continue;
    const e = feat.effects;
    const name = feat.name;

    // combat_option: 主动战斗选项
    if (Array.isArray(e.combat_option)) {
      for (const opt of e.combat_option) {
        const desc = opt.attack_mod ? `${opt.name}(${opt.attack_mod}命中/${opt.damage_mod}伤害)` : opt.name;
        labels.push({ label: desc, color: "text-red-400 border-red-500/30", featName: name });
      }
    }

    // combat_trigger: 被动触发
    if (Array.isArray(e.combat_trigger)) {
      for (const ct of e.combat_trigger) {
        const triggerLabels: Record<string, string> = {
          crit_or_reduce_to_0: "重击/击杀→附赠动作攻击",
          opportunity_attack_hit: "借机攻击命中→速度降为0",
          creature_within_5ft_attacks_ally: "5尺内攻击盟友→反应攻击",
          disengage_still_provokes: "脱离仍可借机攻击",
          creature_enters_reach: "进入触及范围→借机攻击",
          unarmed_or_improvised_hit: "徒手/简易命中→附赠动作擒抱",
          creature_casts_within_5ft: "5尺内施法→反应攻击",
          hit_concentrating_caster: "命中专注→DC+5",
          mount_targeted_by_attack: "坐骑被攻击→转移至自身",
          dex_save_success: "敏捷豁免成功→无伤害",
        };
        const label = triggerLabels[ct.trigger] || `${ct.trigger}→${ct.effect}`;
        labels.push({ label, color: "text-yellow-400 border-yellow-500/30", featName: name });
      }
    }

    // rule_override: 规则覆写
    if (Array.isArray(e.rule_override)) {
      for (const ro of e.rule_override) {
        const label = RULE_OVERRIDE_LABELS[ro];
        if (label) labels.push({ label, color: "text-gray-300 border-gray-500/30", featName: name });
      }
    }
  }

  return labels;
}
