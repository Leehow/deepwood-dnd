import { describe, expect, it, vi } from "vitest";

import {
  buildAreaSpellCasterData,
  buildAreaSpellRequest,
  buildAreaSpellTargetsData,
} from "../../app/components/map/utils/mapAreaSpellCombatPayload";

describe("mapAreaSpellCombatPayload", () => {
  it("builds caster data and spell-area request payloads", () => {
    const casterData = buildAreaSpellCasterData({
      id: 7,
      instance_name: "法师",
      character_id: 18,
    } as any, {
      level: 5,
      class_id: "wizard",
      ability_scores: {
        strength: 8,
        dexterity: 14,
        constitution: 12,
        intelligence: 18,
        wisdom: 10,
        charisma: 11,
      },
      spellcasting_ability: "intelligence",
    });

    expect(casterData).toMatchObject({
      name: "法师",
      token_id: 7,
      character_id: 18,
      proficiency_bonus: 3,
      spellcasting_ability: "intelligence",
    });

    expect(buildAreaSpellRequest({
      campaignId: "9",
      casterData,
      targetsData: [],
      spell: {
        id: "fireball",
        name: "火球术",
        nameEn: "Fireball",
        level: 3,
        school: "evocation",
        concentration: false,
        damage: "8d6",
        damageType: "fire",
        damageTypeCn: "火焰",
        saveType: "dexterity",
        saveTypeCn: "敏捷",
        saveEffect: "half",
        range: "150尺",
        spellSaveDC: 15,
        areaOfEffect: { type: "sphere", size: 20 },
      } as any,
      slotLevel: 3,
      centerPos: { x: 8, y: 8 },
      originPos: null,
      direction: 0,
      shapeType: "sphere",
      currentMapUrl: "/maps/test.png",
      maximizeDamage: true,
    })).toMatchObject({
      campaign_id: 9,
      slot_level: 3,
      shape_type: "sphere",
      map_url: "/maps/test.png",
      maximize_damage: true,
      spell: {
        id: "fireball",
        damage_type: "fire",
      },
    });
  });

  it("builds target payloads from monster and character data plus spell buffs", async () => {
    const authedFetch = vi.fn(async (input: string) => {
      if (input === "/api/monster-instances/44") {
        return {
          ok: true,
          json: async () => ({
            ac: 13,
            current_hp: 22,
            max_hp: 22,
            monster_data: {
              damage_resistances: ["cold"],
              damage_immunities: ["poison"],
              saving_throws: { dexterity: 5 },
            },
          }),
        } as Response;
      }
      if (input === "/api/characters/18/sheet") {
        return {
          ok: true,
          json: async () => ({
            character: {
              abilities: { dexterity: 16 },
              race_id: "tiefling",
            },
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${input}`);
    });

    const targets = await buildAreaSpellTargetsData({
      targets: [
        {
          id: 2,
          instance_name: "怪物A",
          monster_instance_id: 44,
          character_level: 4,
          active_effects: [{ spell_buff: true, spell_id: "shield-of-faith" }],
        },
        {
          id: 3,
          instance_name: "队友B",
          character_id: 18,
          active_effects: [],
        },
      ] as any,
      spell: { saveType: "dexterity" } as any,
      authedFetch: authedFetch as any,
      getSpellBuffEffects: (token) => (
        token.id === 2
          ? {
              acBonus: 2,
              resistances: ["fire"],
              immunities: [],
            }
          : {
              acBonus: 0,
              resistances: [],
              immunities: [],
            }
      ),
    });

    expect(targets[0]).toMatchObject({
      token_id: 2,
      ac: 15,
      current_hp: 22,
      damage_resistances: ["cold", "fire"],
      damage_immunities: ["poison"],
      saving_throw_override: 5,
    });
    expect(targets[1]).toMatchObject({
      token_id: 3,
      ability_scores: { dexterity: 16 },
      damage_resistances: ["fire"],
    });
  });
});
