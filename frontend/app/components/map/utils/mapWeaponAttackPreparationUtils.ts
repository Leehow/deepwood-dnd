import type { AttackOption, SourceCharacterData } from "../SelectionContextMenu";
import type { Token } from "../types/TacticalMapTypes";
import { getEdgeToEdgeDistance, parseTokenSize } from "./mapCalculations";
import { favoredEnemyMap } from "~/components/character/CharacterDisplay/utils/formatting";

export type AttackRollModifier = "advantage" | "disadvantage" | null;

export interface SpellBuffEffects {
  acBonus: number;
  attackBonus: number;
  damageBonus: string[];
  speedBonus: number;
  resistances: string[];
  immunities: string[];
  advantageOn: string[];
  disadvantageOn: string[];
  grantDisadvantage: string[];
}

export interface WeaponAttackTargetSnapshot {
  targetAC: number;
  targetCurrentHP: number | null;
  targetMaxHP: number | null;
  targetHasShield?: boolean;
  targetEquippedWeapon?: string;
  targetBuffs: SpellBuffEffects;
}

interface ToastInstruction {
  message: string;
  type: "success" | "error" | "info" | "warning";
}

interface ResolveWeaponAttackRollContextArgs {
  attack: AttackOption;
  sourceCharacterData?: SourceCharacterData | null;
  sourceTokenId: number;
  targetTokenId: number;
  targetToken: Token;
  tokens: Token[];
  gridUnitLength: number;
  sourceBuffs: SpellBuffEffects;
  targetBuffs: SpellBuffEffects;
  distanceFeet: number;
  initialRollModifier: AttackRollModifier;
  pendingAttackBonusAdd: number;
  pendingAttackBonusSource?: string;
  modifiers?: { powerAttack?: boolean; useLucky?: boolean };
}

interface BuildWeaponAttackRequestArgs {
  campaignId: string;
  attack: AttackOption;
  sourceToken: Token;
  sourceTokenId: number;
  targetTokenId: number;
  distanceFeet: number;
  attackerData: Record<string, unknown>;
  targetName: string;
  targetSnapshot: WeaponAttackTargetSnapshot;
  rollModifier: AttackRollModifier;
  advantageReasons: string[];
  pendingAttackBonusAdd: number;
  pendingAttackBonusSource?: string;
  inspirationDie?: string | null;
  sourceBuffs: SpellBuffEffects;
  modifiers?: { powerAttack?: boolean; useLucky?: boolean };
  sneakAttackEligible: boolean;
}

function matchesFavoredEnemy(enemyValue: string, monsterType: string) {
  const monsterTypeLower = monsterType.toLowerCase();
  const enemyLower = enemyValue.toLowerCase();
  return (
    enemyLower === monsterTypeLower
    || enemyLower === `${monsterTypeLower}s`
    || enemyLower === `${monsterTypeLower}es`
    || enemyLower.replace(/s$/, "") === monsterTypeLower
  );
}

export function buildWeaponAttackAttackerData(
  sourceToken: Token,
  sourceCharacterData?: SourceCharacterData | null,
) {
  let critRange = 20;
  if (sourceCharacterData?.class_id === "fighter" && sourceCharacterData?.subclass_id === "champion") {
    const level = sourceCharacterData?.level || 1;
    if (level >= 15) {
      critRange = 18;
    } else if (level >= 3) {
      critRange = 19;
    }
  }

  return {
    name: sourceToken.instance_name || sourceToken.character_name || "攻击者",
    level: sourceToken.character_level || 1,
    class_id: sourceToken.character_class || null,
    class_name: null,
    race_id: sourceCharacterData?.race_id || null,
    ability_scores: sourceCharacterData?.ability_scores || {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    },
    proficiency_bonus: sourceCharacterData?.level
      ? Math.floor((sourceCharacterData.level - 1) / 4) + 2
      : 2,
    crit_range: critRange,
    fighting_style: (() => {
      const fightingStyle = sourceCharacterData?.fighting_style;
      if (!fightingStyle) return null;
      return typeof fightingStyle === "object" ? fightingStyle.value : fightingStyle;
    })(),
  };
}

export function resolveWeaponAttackRollContext({
  attack,
  sourceCharacterData,
  sourceTokenId,
  targetTokenId,
  targetToken,
  tokens,
  gridUnitLength,
  sourceBuffs,
  targetBuffs,
  distanceFeet,
  initialRollModifier,
  pendingAttackBonusAdd,
  pendingAttackBonusSource,
  modifiers,
}: ResolveWeaponAttackRollContextArgs) {
  const advantageReasons: string[] = [];
  const toastMessages: ToastInstruction[] = [];
  let computedRollModifier = initialRollModifier;

  if (sourceCharacterData?.favored_enemy && targetToken.monster_type) {
    const enemy = typeof sourceCharacterData.favored_enemy === "object"
      ? sourceCharacterData.favored_enemy.value
      : sourceCharacterData.favored_enemy;
    if (enemy && matchesFavoredEnemy(enemy, targetToken.monster_type)) {
      const displayName = favoredEnemyMap[enemy] || enemy;
      advantageReasons.push(`🏹 宿敌：${displayName}`);
      if (computedRollModifier === "disadvantage") {
        computedRollModifier = null;
        toastMessages.push({
          message: `🏹 宿敌匹配（${displayName}）优势与劣势相互抵消，正常投骰`,
          type: "info",
        });
      } else if (!computedRollModifier) {
        computedRollModifier = "advantage";
        toastMessages.push({
          message: `🏹 宿敌匹配！目标为${displayName}，攻击获得优势`,
          type: "success",
        });
      }
    }
  }

  const isRangedAttack = Boolean(attack.isRanged || (attack.normalRange && attack.normalRange > 10));
  if (isRangedAttack && !attack.isSpecial) {
    let autoDisadvantage = false;
    let disadvantageReason = "";

    if (distanceFeet <= 5) {
      const hasCrossbowExpert = sourceCharacterData?.feats?.some((feat: any) => {
        const featValue = typeof feat === "string" ? feat : feat?.value;
        return featValue === "crossbow_expert";
      });
      if (!hasCrossbowExpert) {
        autoDisadvantage = true;
        disadvantageReason = "近身远程攻击（5尺内）";
      }
    }

    if (!autoDisadvantage && attack.normalRange && attack.maxRange && attack.normalRange < attack.maxRange) {
      if (distanceFeet > attack.normalRange && distanceFeet <= attack.maxRange) {
        autoDisadvantage = true;
        disadvantageReason = `超出常规射程（${Math.round(distanceFeet)}尺 > ${attack.normalRange}尺）`;
      }
    }

    if (autoDisadvantage) {
      if (computedRollModifier === "advantage") {
        computedRollModifier = null;
        toastMessages.push({
          message: `${disadvantageReason}劣势与优势相互抵消，正常投骰`,
          type: "info",
        });
      } else if (!computedRollModifier) {
        computedRollModifier = "disadvantage";
        toastMessages.push({
          message: `⚠️ ${disadvantageReason}，自动劣势`,
          type: "warning",
        });
      }
    }
  }

  if (sourceBuffs.attackBonus) {
    advantageReasons.push(`✨ 法术加值 攻击+${sourceBuffs.attackBonus}`);
  }

  if (sourceBuffs.advantageOn.some((value) => value.toLowerCase().includes("attack"))) {
    if (!computedRollModifier) computedRollModifier = "advantage";
    advantageReasons.push("✨ 法术效果：攻击优势");
  }

  if (targetBuffs.grantDisadvantage.length > 0) {
    if (computedRollModifier === "advantage") {
      computedRollModifier = null;
    } else if (!computedRollModifier) {
      computedRollModifier = "disadvantage";
    }
  }

  const shouldConsumeLucky = Boolean(modifiers?.useLucky);
  if (shouldConsumeLucky) {
    advantageReasons.push("🍀 幸运");
    if (computedRollModifier === "disadvantage") {
      computedRollModifier = null;
    } else if (!computedRollModifier) {
      computedRollModifier = "advantage";
    }
  }

  if (pendingAttackBonusAdd > 0) {
    advantageReasons.push(`🎯 ${pendingAttackBonusSource || "额外命中"} +${pendingAttackBonusAdd}`);
  }

  let sneakAttackEligible = false;
  if (sourceCharacterData?.class_id === "rogue") {
    const props = (attack.properties || []).map((property) => property.toLowerCase());
    const isFinesse = props.some((property) => property.includes("finesse") || property.includes("灵巧"));
    if (isFinesse || isRangedAttack) {
      const hasAdvantage = computedRollModifier === "advantage";
      const hasAllyNearTarget = tokens.some((token) => {
        if (token.id === sourceTokenId || token.id === targetTokenId) return false;
        if (token.faction === "enemy") return false;
        if ((token.current_hp ?? 1) <= 0) return false;

        const tokenSize = parseTokenSize(token.token_size || "1x1");
        const targetSize = parseTokenSize(targetToken.token_size || "1x1");
        const distance = getEdgeToEdgeDistance(
          token.position_x,
          token.position_y,
          tokenSize.width,
          tokenSize.height,
          targetToken.position_x,
          targetToken.position_y,
          targetSize.width,
          targetSize.height,
        ) * gridUnitLength;
        return distance <= 5;
      });

      sneakAttackEligible = hasAdvantage || (hasAllyNearTarget && computedRollModifier !== "disadvantage");
    }
  }

  return {
    isRangedAttack,
    computedRollModifier,
    advantageReasons,
    sneakAttackEligible,
    toastMessages,
    shouldConsumeLucky,
  };
}

export function buildWeaponAttackRequest({
  campaignId,
  attack,
  sourceToken,
  sourceTokenId,
  targetTokenId,
  distanceFeet,
  attackerData,
  targetName,
  targetSnapshot,
  rollModifier,
  advantageReasons,
  pendingAttackBonusAdd,
  pendingAttackBonusSource,
  inspirationDie,
  sourceBuffs,
  modifiers,
  sneakAttackEligible,
}: BuildWeaponAttackRequestArgs) {
  return {
    campaign_id: parseInt(campaignId, 10),
    attacker_token_id: sourceTokenId,
    attacker_character_id: sourceToken.character_id || null,
    attacker_monster_instance_id: sourceToken.monster_instance_id || null,
    target_token_id: targetTokenId,
    attack: {
      key: attack.key,
      name: attack.name,
      name_en: attack.nameEn,
      icon: attack.icon,
      description: attack.description,
      weapon_name: attack.weaponName,
      damage: attack.damage,
      damage_type: attack.damageType,
      properties: attack.properties,
      range: attack.range,
      normal_range: attack.normalRange,
      max_range: attack.maxRange,
      needs_ammo: attack.needsAmmo,
      ammo_count: attack.ammoCount,
      is_special: attack.isSpecial,
      weapon_proficient: attack.weaponProficient ?? true,
      is_off_hand: attack.isBonusAction || attack.key?.startsWith("attack_off_") || false,
      magic_bonus: attack.magicBonus || undefined,
      extra_damage: attack.extraDamage || undefined,
    },
    distance_feet: distanceFeet,
    attacker: attackerData,
    target: {
      name: targetName,
      ac: targetSnapshot.targetAC,
      current_hp: targetSnapshot.targetCurrentHP,
      max_hp: targetSnapshot.targetMaxHP,
      has_shield: targetSnapshot.targetHasShield,
      equipped_weapon: targetSnapshot.targetEquippedWeapon,
      damage_resistances: targetSnapshot.targetBuffs.resistances.length > 0
        ? targetSnapshot.targetBuffs.resistances
        : undefined,
      damage_immunities: targetSnapshot.targetBuffs.immunities.length > 0
        ? targetSnapshot.targetBuffs.immunities
        : undefined,
    },
    auto_apply: true as const,
    roll_modifier: rollModifier,
    advantage_reasons: advantageReasons.length > 0 ? advantageReasons : undefined,
    attack_bonus_add: pendingAttackBonusAdd || 0,
    attack_bonus_add_source: pendingAttackBonusSource,
    inspiration_die: inspirationDie,
    spell_attack_bonus: sourceBuffs.attackBonus || undefined,
    power_attack: modifiers?.powerAttack || false,
    sneak_attack: sneakAttackEligible,
  };
}
