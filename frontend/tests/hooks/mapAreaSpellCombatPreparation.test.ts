import { describe, expect, it, vi } from "vitest";

import { prepareAreaSpellCombat } from "../../app/components/map/utils/mapAreaSpellCombatPreparation";

describe("mapAreaSpellCombatPreparation", () => {
  it("builds caster/request data and derives cloak/maximize flags", async () => {
    const authedFetch = vi.fn();
    const prepared = await prepareAreaSpellCombat({
      campaignId: "7",
      currentMapUrl: "/maps/test.png",
      sourceToken: {
        id: 11,
        character_id: 18,
        instance_name: "法师",
      } as any,
      sourceCharacterData: {
        level: 5,
        class_id: "cleric",
        ability_scores: {
          strength: 10,
          dexterity: 12,
          constitution: 14,
          intelligence: 10,
          wisdom: 18,
          charisma: 13,
        },
      },
      sourceTokenId: 11,
      finalTargets: [
        {
          id: 21,
          instance_name: "食尸鬼",
          current_hp: 22,
          max_hp: 22,
        } as any,
      ],
      spell: {
        id: "lightning-burst",
        name: "闪电爆发",
        damageType: "lightning",
      } as any,
      slotLevel: 3,
      centerPos: { x: 8, y: 8 },
      originPos: null,
      direction: 0,
      shapeType: "sphere",
      tokenStatusEffects: {
        11: [
          { id: "cloak_of_shadows" },
          { id: "destructive_wrath_pending" },
        ],
      },
      authedFetch: authedFetch as any,
      getSpellBuffEffects: vi.fn(() => ({
        acBonus: 0,
        resistances: [],
        immunities: [],
      })),
      isCloakOfShadowsEffect: (effect) => effect.id === "cloak_of_shadows",
      isDestructiveWrathPendingEffect: (effect) => effect.id === "destructive_wrath_pending",
      isDestructiveWrathEligibleDamageType: (value) => value === "lightning",
    });

    expect(prepared.casterData).toEqual(expect.objectContaining({
      name: "法师",
      token_id: 11,
      character_id: 18,
    }));
    expect(prepared.cloakOfShadowsActive).toBe(true);
    expect(prepared.maximizeDamage).toBe(true);
    expect(prepared.areaSpellRequest).toEqual(expect.objectContaining({
      campaign_id: 7,
      slot_level: 3,
      spell: expect.objectContaining({
        id: "lightning-burst",
        name: "闪电爆发",
      }),
      targets: [
        expect.objectContaining({
          token_id: 21,
          current_hp: 22,
          max_hp: 22,
        }),
      ],
    }));
    expect(authedFetch).not.toHaveBeenCalled();
  });
});
