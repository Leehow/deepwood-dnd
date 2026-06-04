import { describe, expect, it } from "vitest";

import {
  canCastAreaSpellOnEmptyGround,
  getAreaSpellCasterCenterPosition,
  getAreaSpellEffectiveCenterPosition,
  isDirectionalAreaSpell,
  isSummonSpell,
  isUtilityAreaSpell,
  resolveAreaSpellFinalTargets,
} from "../../app/components/map/utils/mapAreaSpellCastPrelude";

describe("mapAreaSpellCastPrelude", () => {
  it("derives directional/follow-caster geometry", () => {
    expect(isDirectionalAreaSpell("cone")).toBe(true);
    expect(isDirectionalAreaSpell("sphere")).toBe(false);

    expect(getAreaSpellCasterCenterPosition({
      position_x: 4,
      position_y: 6,
      token_size: "2x2",
    } as any)).toEqual({ x: 5, y: 7 });

    expect(getAreaSpellEffectiveCenterPosition({
      isSelfRange: true,
      centerPos: { x: 9, y: 9 },
    } as any, "sphere", {
      position_x: 4,
      position_y: 6,
      token_size: "2x2",
    } as any)).toEqual({
      followCaster: true,
      effectiveCenterPos: { x: 5, y: 7 },
    });
  });

  it("classifies utility/empty-ground spells and filters caster target", () => {
    expect(isUtilityAreaSpell({
      damage: null,
      healing: null,
      attackType: null,
      effects: [
        { trigger: "on_enter_zone", target: { type: "all_in_area" }, effects: [{ type: "apply_condition", condition: "prone" }] },
      ],
    })).toBe(true);
    expect(isUtilityAreaSpell({
      damage: null,
      healing: null,
      attackType: null,
      effects: [
        {
          trigger: "on_enter_zone",
          target: { type: "single" },
          effects: [{ type: "apply_condition", condition: "restrained" }],
        },
      ],
    })).toBe(true);
    expect(canCastAreaSpellOnEmptyGround({
      duration: "10分钟",
      effects: [
        { trigger: "start_of_target_turn", target: { type: "all_in_area" }, effects: [{ type: "deal_damage" }] },
      ],
    })).toBe(true);
    expect(canCastAreaSpellOnEmptyGround({
      duration: "1分钟",
      effects: [
        {
          trigger: "end_of_target_turn",
          target: { type: "single" },
          effects: [{ type: "apply_condition", condition: "prone" }],
        },
      ],
    })).toBe(true);
    expect(canCastAreaSpellOnEmptyGround({
      duration: "Instantaneous",
      effects: [
        { trigger: "on_enter_zone", target: { type: "all_in_area" }, effects: [{ type: "deal_damage" }] },
      ],
    })).toBe(false);
    expect(isUtilityAreaSpell({
      damage: null,
      healing: null,
      attackType: null,
      effects: [
        { trigger: "on_enter_zone", target: { type: "all_in_area" }, effects: [{ type: "apply_condition", condition: "restrained" }] },
      ],
    })).toBe(true);

    expect(resolveAreaSpellFinalTargets(
      { healing: null } as any,
      1,
      [{ id: 1 }, { id: 2 }, { id: 3 }] as any,
    )).toEqual([{ id: 2 }, { id: 3 }]);
  });

  it("treats spawn_summon spells as summon spells that can place on empty ground", () => {
    const conjureAnimals = {
      duration: "专注, 至多 1 小时",
      effects: [
        { trigger: "on_cast", target: { type: "multiple" }, effects: [{ type: "narrative" }] },
        { trigger: "on_cast", target: { type: "self" }, effects: [{ type: "spawn_summon", instanceName: "野兽" }] },
      ],
    };
    expect(isSummonSpell(conjureAnimals)).toBe(true);
    // A lasting summon spell with no zone-control behavior should still be
    // allowed to place on empty ground so we record concentration + placement
    // metadata instead of silently failing.
    expect(canCastAreaSpellOnEmptyGround(conjureAnimals)).toBe(true);

    expect(isSummonSpell({ effects: [{ trigger: "on_cast", effects: [{ type: "deal_damage" }] }] })).toBe(false);
    expect(isSummonSpell({})).toBe(false);
    expect(isSummonSpell(null)).toBe(false);
  });
});
