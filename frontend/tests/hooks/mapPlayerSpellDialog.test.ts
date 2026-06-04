import { describe, expect, it } from "vitest";

import { buildPlayerSpellDialogData } from "~/components/map/MapPlayerSpellDialog";

describe("buildPlayerSpellDialogData", () => {
  it("builds slot arrays and derives player token spell state", () => {
    const result = buildPlayerSpellDialogData({
      playerSpellData: {
        preparedSpells: [],
        cantrips: [],
        spellSlots: {
          1: { current: 2, max: 4 },
          3: { current: 1, max: 2 },
        },
      },
      sourceCharacterData: {
        class_id: "warlock",
        feats: ["war_caster"],
        equipment: [{ id: "wand" }],
      },
      tokens: [
        {
          id: 77,
          character_id: 101,
          user_id: "42",
          concentration_spell: { spell_name: "Bless" },
          casting_in_progress: { spell_name: "Fireball" },
        },
      ] as any,
      selectedCharacterId: 101,
      userId: "42",
      tokenStatusEffects: {
        77: [{ id: "silenced" }],
      },
    });

    expect(result.spellSlots[1]).toBe(4);
    expect(result.remainingSlots[1]).toBe(2);
    expect(result.spellSlots[3]).toBe(2);
    expect(result.remainingSlots[3]).toBe(1);
    expect(result.concentrationSpellName).toBe("Bless");
    expect(result.castingSpellName).toBe("Fireball");
    expect(result.isWarlock).toBe(true);
    expect(result.isSilenced).toBe(true);
    expect(result.equipment).toHaveLength(1);
  });

  it("keeps somatic freedom false when feat support is absent", () => {
    const result = buildPlayerSpellDialogData({
      playerSpellData: {
        preparedSpells: [],
        cantrips: [],
        spellSlots: {},
      },
      sourceCharacterData: {
        class_id: "wizard",
        feats: [],
      },
      tokens: [],
      selectedCharacterId: null,
      userId: undefined,
      tokenStatusEffects: {},
    });

    expect(result.hasSomaticFreedom).toBe(false);
    expect(result.concentrationSpellName).toBeNull();
    expect(result.castingSpellName).toBeNull();
    expect(result.isSilenced).toBe(false);
  });
});
