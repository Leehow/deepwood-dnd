import type { SpellOption } from "../SelectionContextMenu";
import type { AreaSpellModeState } from "../hooks/useMapAreaSpellController";
import type { Token } from "../types/TacticalMapTypes";
import { createLogger } from "~/utils/logger";

const logger = createLogger("mapAreaSpellCombatPayload");

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface SpellBuffEffects {
  acBonus: number;
  resistances: string[];
  immunities: string[];
}

interface AreaSpellCasterData {
  name: string;
  token_id: number;
  character_id: number | null;
  level: number;
  class_id: string | null;
  ability_scores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  proficiency_bonus: number;
  spellcasting_ability: string;
}

interface AreaSpellTargetData {
  name: string;
  token_id: number;
  character_id: number | null;
  monster_instance_id: number | null;
  ac: number;
  ability_scores: Record<string, unknown> | null;
  saving_throw_override: number | null;
  level: number;
  proficiency_bonus: number;
  current_hp: number | null;
  max_hp: number | null;
  damage_resistances: string[];
  damage_immunities: string[];
}

interface BuildAreaSpellTargetsDataArgs {
  targets: Token[];
  spell: SpellOption & { saveType?: string | null };
  authedFetch: AuthedFetch;
  getSpellBuffEffects: (token: Token) => SpellBuffEffects;
}

interface BuildAreaSpellRequestArgs {
  campaignId: string;
  casterData: AreaSpellCasterData;
  targetsData: AreaSpellTargetData[];
  spell: SpellOption & Record<string, any>;
  slotLevel: number;
  centerPos: { x: number; y: number } | null;
  originPos: { x: number; y: number } | null;
  direction: number;
  shapeType: NonNullable<AreaSpellModeState["shapeType"]>;
  currentMapUrl?: string | null;
  maximizeDamage: boolean;
}

function getMonsterSavingThrowOverride(monsterData: any, saveType: string): number | null {
  const saveMap: Record<string, string> = {
    str: "strength",
    dex: "dexterity",
    con: "constitution",
    int: "intelligence",
    wis: "wisdom",
    cha: "charisma",
  };
  const shortKey = saveType.substring(0, 3).toLowerCase();
  const longKey = saveMap[shortKey] || saveType;

  if (monsterData.saving_throws && typeof monsterData.saving_throws[longKey] === "number") {
    return monsterData.saving_throws[longKey];
  }

  const modKey = `${shortKey}Mod`;
  const mod = monsterData.abilityScores?.[modKey] ?? monsterData[modKey];
  if (typeof mod === "number") {
    return mod;
  }

  const score = monsterData.abilityScores?.[shortKey] ?? monsterData[shortKey];
  if (typeof score === "number") {
    return Math.floor((score - 10) / 2);
  }

  return null;
}

export function buildAreaSpellCasterData(sourceToken: Token, sourceCharacterData: any): AreaSpellCasterData {
  return {
    name: sourceToken.instance_name || sourceToken.character_name || "施法者",
    token_id: sourceToken.id,
    character_id: sourceToken.character_id || null,
    level: sourceCharacterData?.level || 1,
    class_id: sourceCharacterData?.class_id || null,
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
    spellcasting_ability: sourceCharacterData?.spellcasting_ability
      || (sourceCharacterData?.class_id === "wizard"
        ? "intelligence"
        : sourceCharacterData?.class_id === "cleric" || sourceCharacterData?.class_id === "druid"
          ? "wisdom"
          : "charisma"),
  };
}

export async function buildAreaSpellTargetsData({
  targets,
  spell,
  authedFetch,
  getSpellBuffEffects,
}: BuildAreaSpellTargetsDataArgs): Promise<AreaSpellTargetData[]> {
  return Promise.all(targets.map(async (targetToken) => {
    let targetAC = 10;
    let targetCurrentHP = targetToken.current_hp ?? null;
    let targetMaxHP = targetToken.max_hp ?? null;
    let targetAbilityScores: Record<string, unknown> | null = null;
    let targetDamageResistances: string[] = [];
    let targetDamageImmunities: string[] = [];
    let targetSavingThrowOverride: number | null = null;

    if (targetToken.transformation_data) {
      targetAC = targetToken.transformation_data.ac || 10;
      targetCurrentHP = targetToken.transformation_data.current_hp ?? targetCurrentHP;
      targetMaxHP = targetToken.transformation_data.max_hp ?? targetMaxHP;
    } else if (targetToken.monster_instance_id) {
      try {
        const response = await authedFetch(`/api/monster-instances/${targetToken.monster_instance_id}`);
        if (response.ok) {
          const monsterData = await response.json();
          targetAC = monsterData.ac || monsterData.monster_data?.ac || 10;
          if (targetCurrentHP === null) targetCurrentHP = monsterData.current_hp;
          if (targetMaxHP === null) targetMaxHP = monsterData.max_hp;

          const normalizedMonster = monsterData.monster_data || monsterData;
          if (normalizedMonster.damage_resistances) {
            targetDamageResistances = Array.isArray(normalizedMonster.damage_resistances)
              ? normalizedMonster.damage_resistances
              : [normalizedMonster.damage_resistances];
          }
          if (normalizedMonster.damage_immunities) {
            targetDamageImmunities = Array.isArray(normalizedMonster.damage_immunities)
              ? normalizedMonster.damage_immunities
              : [normalizedMonster.damage_immunities];
          }
          if (spell.saveType) {
            targetSavingThrowOverride = getMonsterSavingThrowOverride(normalizedMonster, spell.saveType);
          }
        }
      } catch (error) {
        logger.warn("[Area Spell] Failed to fetch monster data", error);
      }
    }

    if (targetToken.character_id) {
      try {
        const response = await authedFetch(`/api/characters/${targetToken.character_id}/sheet`);
        if (response.ok) {
          const data = await response.json();
          const character = data?.character;
          if (character) {
            targetAbilityScores = character.abilities;
            if (character.race_id === "tiefling") targetDamageResistances.push("fire");
            if (character.race_id === "dwarf") targetDamageResistances.push("poison");
          }
        }
      } catch (error) {
        logger.warn("[Area Spell] Failed to fetch character data", error);
      }
    }

    const spellBuffs = getSpellBuffEffects(targetToken);
    targetAC += spellBuffs.acBonus;
    if (spellBuffs.resistances.length > 0) targetDamageResistances.push(...spellBuffs.resistances);
    if (spellBuffs.immunities.length > 0) targetDamageImmunities.push(...spellBuffs.immunities);

    return {
      name: targetToken.instance_name || targetToken.monster_name || "目标",
      token_id: targetToken.id,
      character_id: targetToken.character_id || null,
      monster_instance_id: targetToken.monster_instance_id || null,
      ac: targetAC,
      ability_scores: targetAbilityScores,
      saving_throw_override: targetSavingThrowOverride,
      level: targetToken.character_level || 1,
      proficiency_bonus: 2,
      current_hp: targetCurrentHP,
      max_hp: targetMaxHP,
      damage_resistances: targetDamageResistances,
      damage_immunities: targetDamageImmunities,
    };
  }));
}

export function buildAreaSpellRequest({
  campaignId,
  casterData,
  targetsData,
  spell,
  slotLevel,
  centerPos,
  originPos,
  direction,
  shapeType,
  currentMapUrl,
  maximizeDamage,
}: BuildAreaSpellRequestArgs) {
  const isDirectional = shapeType === "cone" || shapeType === "line";

  return {
    campaign_id: parseInt(campaignId, 10),
    caster: casterData,
    targets: targetsData,
    spell: {
      id: spell.id,
      name: spell.name,
      name_en: spell.nameEn,
      level: spell.level,
      school: spell.school,
      concentration: spell.concentration || false,
      damage: spell.damage,
      damage_type: spell.damageType,
      damage_type_cn: spell.damageTypeCn,
      damage_at_slot_level: spell.damageAtSlotLevel,
      healing: spell.healing,
      healing_at_slot_level: spell.healingAtSlotLevel,
      attack_type: spell.attackType,
      save_type: spell.saveType,
      save_type_cn: spell.saveTypeCn,
      save_effect: spell.saveEffect,
      range: spell.range,
      spell_attack_bonus: spell.spellAttackBonus,
      spell_save_dc: spell.spellSaveDC,
      area_of_effect: spell.areaOfEffect,
      control_effect: spell.controlEffect || null,
      effects: spell.effects || null,
    },
    slot_level: slotLevel,
    center_position: isDirectional ? originPos : centerPos,
    origin_position: originPos,
    direction,
    shape_type: shapeType,
    map_url: currentMapUrl || "",
    auto_apply: true,
    maximize_damage: maximizeDamage,
  };
}
