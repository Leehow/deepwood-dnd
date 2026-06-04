import { describe, expect, it } from "vitest";

import {
  getAbilityModifier,
  getMonsterAbilityScores,
  getMonsterSavingThrowOverride,
  getProficiencyBonus,
  normalizeStringList,
  toFiniteNumber,
} from "../../app/components/map/utils/mapMonsterRuntimeUtils";

describe("mapMonsterRuntimeUtils", () => {
  it("normalizes string lists by trimming and deduplicating", () => {
    expect(normalizeStringList([" a ", "a", "", null, "b"])).toEqual(["a", "b"]);
  });

  it("parses finite numbers from number and string values", () => {
    expect(toFiniteNumber(12)).toBe(12);
    expect(toFiniteNumber("+14")).toBe(14);
    expect(toFiniteNumber("not-number")).toBeNull();
  });

  it("calculates ability modifier and proficiency bonus", () => {
    expect(getAbilityModifier(18)).toBe(4);
    expect(getProficiencyBonus(1)).toBe(2);
    expect(getProficiencyBonus(9)).toBe(4);
  });

  it("resolves monster ability scores from mixed key naming", () => {
    const scores = getMonsterAbilityScores({
      ability_scores: { str: "16", dexterity: 14, con: 12 },
      stats: { intelligence: 8, wisdom: 10, charisma: 13 },
    });
    expect(scores).toEqual({
      strength: 16,
      dexterity: 14,
      constitution: 12,
      intelligence: 8,
      wisdom: 10,
      charisma: 13,
    });
  });

  it("returns default score and null save override when absent", () => {
    expect(getMonsterAbilityScores({})).toEqual({
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    });
    expect(getMonsterSavingThrowOverride({}, "wisdom")).toBeNull();
  });

  it("resolves saving throw overrides from alias fields", () => {
    expect(
      getMonsterSavingThrowOverride(
        { saving_throws: { dex: "+5" } },
        "dexterity",
      ),
    ).toBe(5);
    expect(
      getMonsterSavingThrowOverride(
        { savingThrows: { wisdom: 7 } },
        "wisdom",
      ),
    ).toBe(7);
  });
});
