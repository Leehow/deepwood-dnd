import { describe, expect, it } from "vitest";

import {
  buildAreaSpellAppliedEffect,
  buildAreaSpellEffectChatMessage,
  getAffectedAreaSpellTargetIds,
  getAreaSpellResultToastMessage,
  getAreaSpellTargetNames,
} from "../../app/components/map/utils/mapAreaSpellResultUtils";

describe("mapAreaSpellResultUtils", () => {
  it("builds area-spell toast and failed-target ids", () => {
    expect(getAreaSpellResultToastMessage("火球术", 3, undefined, 2)).toBe("火球术 影响了 2/3 个目标");
    expect(getAreaSpellResultToastMessage("火球术", 3, "轰然爆炸！", 2)).toBe("轰然爆炸！");

    expect(getAffectedAreaSpellTargetIds([
      { target_token_id: 1, save_succeeded: true },
      { target_token_id: 2, save_succeeded: false },
      { target_token_id: 3 },
    ], [])).toEqual([2, 3]);
  });

  it("builds control-effect payloads and chat copy", () => {
    const effectDefinition = {
      id: "restrained",
      name: "束缚",
      visual: {
        icon: "🕸️",
        color: "#22c55e",
      },
      duration: { rounds: 10 },
    } as any;

    expect(buildAreaSpellAppliedEffect(effectDefinition, "纠缠术", "德鲁伊", 5)).toEqual({
      id: "restrained",
      name: "束缚",
      icon: "🕸️",
      color: "#22c55e",
      duration: 5,
      maxDuration: 5,
      metadata: { source: "纠缠术", caster: "德鲁伊" },
    });

    expect(getAreaSpellTargetNames([2, 3], [
      { id: 2, instance_name: "骷髅" },
      { id: 3, monster_name: "僵尸" },
    ] as any)).toBe("骷髅、僵尸");

    expect(buildAreaSpellEffectChatMessage("纠缠术", effectDefinition, "骷髅、僵尸")).toBe(
      "🕸️ **纠缠术** 使 骷髅、僵尸 陷入 **束缚** 状态！",
    );
  });
});
