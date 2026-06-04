import { describe, expect, it } from "vitest";

import {
  buildAreaSpellCombatQueryString,
  buildAreaSpellCombatStartMessage,
  getAreaSpellCombatErrorMessage,
  getAreaSpellCombatTargetLabel,
  getAreaSpellUnexpectedResponseMessage,
  shouldUseBreathWeaponSound,
} from "../../app/components/map/utils/mapAreaSpellCombatDispatchUtils";

describe("mapAreaSpellCombatDispatchUtils", () => {
  it("builds query params, start messages, and target labels", () => {
    expect(buildAreaSpellCombatQueryString({
      userId: "gm-1",
      isDM: true,
    })).toBe("user_id=gm-1&role=dm");

    expect(buildAreaSpellCombatStartMessage({
      casterName: "法师",
      spellName: "火球术",
      slotLevel: 3,
      targetCount: 4,
    })).toBe("法师 施放 火球术 (3环)，影响 4 个目标...");

    expect(getAreaSpellCombatTargetLabel(4)).toBe("4个目标");
  });

  it("derives sound/error copy helpers", () => {
    expect(shouldUseBreathWeaponSound("breath_weapon_fire")).toBe(true);
    expect(shouldUseBreathWeaponSound("fireball")).toBe(false);
    expect(getAreaSpellCombatErrorMessage("boom")).toBe("范围法术施放失败: boom");
    expect(getAreaSpellCombatErrorMessage("")).toBe("范围法术施放失败");
    expect(getAreaSpellUnexpectedResponseMessage("火球术")).toBe("火球术 施放返回了无效结果");
  });
});
