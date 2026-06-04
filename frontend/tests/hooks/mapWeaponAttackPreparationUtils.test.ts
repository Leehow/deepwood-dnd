import { describe, expect, it } from "vitest";

import type { AttackOption, SourceCharacterData } from "../../app/components/map/SelectionContextMenu";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";
import {
  buildWeaponAttackAttackerData,
  resolveWeaponAttackRollContext,
  type SpellBuffEffects,
} from "../../app/components/map/utils/mapWeaponAttackPreparationUtils";

function createToken(overrides: Partial<Token>): Token {
  return {
    id: 1,
    campaign_id: 7,
    map_url: "/maps/test-map.png",
    position_x: 0,
    position_y: 0,
    token_size: "1x1",
    ...overrides,
  } as Token;
}

function createBuffs(overrides: Partial<SpellBuffEffects> = {}): SpellBuffEffects {
  return {
    acBonus: 0,
    attackBonus: 0,
    damageBonus: [],
    speedBonus: 0,
    resistances: [],
    immunities: [],
    advantageOn: [],
    disadvantageOn: [],
    grantDisadvantage: [],
    ...overrides,
  };
}

describe("mapWeaponAttackPreparationUtils", () => {
  it("builds attacker data with champion crit range", () => {
    const attackerData = buildWeaponAttackAttackerData(
      createToken({ id: 10, instance_name: "冠军战士", character_level: 15, character_class: "fighter" }),
      {
        id: 18,
        name: "冠军战士",
        level: 15,
        class_id: "fighter",
        subclass_id: "champion",
        race_id: "human",
        ability_scores: {
          strength: 18,
          dexterity: 14,
          constitution: 16,
          intelligence: 10,
          wisdom: 12,
          charisma: 8,
        },
      } as SourceCharacterData,
    );

    expect(attackerData.crit_range).toBe(18);
    expect(attackerData.proficiency_bonus).toBe(5);
    expect(attackerData.race_id).toBe("human");
  });

  it("grants favored-enemy advantage and emits a toast when monster type matches", () => {
    const context = resolveWeaponAttackRollContext({
      attack: {
        key: "weapon_longsword_main",
        name: "长剑",
        properties: ["versatile"],
      } as AttackOption,
      sourceCharacterData: {
        id: 18,
        name: "游侠",
        class_id: "ranger",
        favored_enemy: "undead",
      } as SourceCharacterData,
      sourceTokenId: 10,
      targetTokenId: 22,
      targetToken: createToken({ id: 22, monster_type: "undead" } as any),
      tokens: [
        createToken({ id: 10, faction: "ally" }),
        createToken({ id: 22, faction: "enemy" }),
      ],
      gridUnitLength: 5,
      sourceBuffs: createBuffs(),
      targetBuffs: createBuffs(),
      distanceFeet: 5,
      initialRollModifier: null,
      pendingAttackBonusAdd: 0,
    });

    expect(context.computedRollModifier).toBe("advantage");
    expect(context.advantageReasons).toContain("🏹 宿敌：不死生物");
    expect(context.toastMessages).toEqual([
      {
        message: "🏹 宿敌匹配！目标为不死生物，攻击获得优势",
        type: "success",
      },
    ]);
  });

  it("computes sneak attack eligibility from nearby allies without direct advantage", () => {
    const context = resolveWeaponAttackRollContext({
      attack: {
        key: "weapon_rapier_main",
        name: "刺剑",
        properties: ["finesse"],
      } as AttackOption,
      sourceCharacterData: {
        id: 18,
        name: "盗贼",
        class_id: "rogue",
      } as SourceCharacterData,
      sourceTokenId: 10,
      targetTokenId: 22,
      targetToken: createToken({ id: 22, position_x: 1, position_y: 0, faction: "enemy" }),
      tokens: [
        createToken({ id: 10, position_x: 0, position_y: 0, faction: "ally" }),
        createToken({ id: 22, position_x: 1, position_y: 0, faction: "enemy" }),
        createToken({ id: 33, position_x: 1, position_y: 1, faction: "ally", current_hp: 12 }),
      ],
      gridUnitLength: 5,
      sourceBuffs: createBuffs(),
      targetBuffs: createBuffs(),
      distanceFeet: 5,
      initialRollModifier: null,
      pendingAttackBonusAdd: 0,
    });

    expect(context.sneakAttackEligible).toBe(true);
  });
});
