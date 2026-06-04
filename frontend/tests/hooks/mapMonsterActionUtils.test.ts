import { describe, expect, it } from "vitest";

import {
  parseMonsterActionRange,
  parseMonsterAreaAction,
  parseMonsterAttackBonus,
  parseMonsterDamageProfile,
} from "../../app/components/map/utils/mapMonsterActionUtils";

describe("mapMonsterActionUtils", () => {
  it("parses attack bonus from localized descriptions", () => {
    expect(parseMonsterAttackBonus({
      description: "近战武器攻击：命中 +7，触及 5 尺，单一目标。",
    })).toBe(7);
    expect(parseMonsterAttackBonus({
      description: "远程武器攻击：+9 命中，射程 80/320 尺。",
    })).toBe(9);
  });

  it("parses damage and extra damage from descriptions", () => {
    expect(parseMonsterDamageProfile({
      description: "造成 15（2d8+6）点挥砍伤害，外加 4(1d8)的毒素伤害",
    })).toEqual({
      damageStr: "2d8+6",
      damageType: "slashing",
      damageTypeCn: "挥砍",
      extraDamage: {
        dice: "1d8",
        type: "毒素",
      },
    });
  });

  it("parses range and area payloads", () => {
    expect(parseMonsterActionRange({
      description: "远程武器攻击：射程 30/120 尺，单一目标。",
    })).toEqual({
      normalRange: 30,
      maxRange: 120,
    });

    expect(parseMonsterAreaAction({
      description: "",
      area: { shape: "line", size: "60 尺" },
      save: { ability: "dexterity", dc: 18, success_effect: "half" },
      damage: { dice: "12d8", type: "lightning" },
    })).toEqual({
      saveTypeEn: "dex",
      saveTypeCn: "敏捷",
      shape: "line",
      sizeFeet: 60,
      damageStr: "12d8",
      damageType: "lightning",
      damageTypeCn: "闪电",
      saveDC: 18,
      saveEffect: "half",
    });
  });
});
