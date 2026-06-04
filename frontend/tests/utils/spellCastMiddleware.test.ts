import { describe, expect, it } from "vitest";
import { resolveSpellCastUI } from "../../app/utils/spellCastMiddleware";
import type { SpellCastContext } from "../../app/types/spellCastUI";

/** 默认上下文 — 无任何限制 */
function baseCtx(overrides: Partial<SpellCastContext> = {}): SpellCastContext {
  return {
    isSilenced: false,
    hasSomaticFreedom: false,
    equipMainHand: false,
    equipOffHand: false,
    hasMaterialAvailable: true,
    materialSelected: true,
    selectedCastLevel: 1,
    remainingSlots: 2,
    maxSlotsArray: [0, 4, 3, 2, 0, 0, 0, 0, 0, 0],
    remainingSlotsArray: [0, 2, 2, 1, 0, 0, 0, 0, 0, 0],
    concentrationSpellName: null,
    castingSpellName: null,
    isWarlock: false,
    isInvocationFree: false,
    hasIllusionImage: false,
    selectedOptionKey: null,
    isDM: false,
    ...overrides,
  };
}

/** 快速构造法术对象 */
function makeSpell(overrides: Record<string, any> = {}): any {
  return {
    id: "test_spell",
    name: "测试法术",
    level: 1,
    school: "evocation",
    castingTime: "1 动作",
    range: "30 尺",
    components: ["V", "S"],
    duration: "瞬间",
    ritual: false,
    concentration: false,
    description: "",
    classes: [],
    ...overrides,
  };
}

describe("spellCastMiddleware — resolveSpellCastUI", () => {
  // ── 目标模式 ──────────────────────────────────────

  it("self buff: range=自身, no area → mode=self, 施放", () => {
    const d = resolveSpellCastUI(makeSpell({ range: "自身" }), baseCtx());
    expect(d.targetingMode).toBe("self");
    expect(d.castButtonText).toBe("施放");
    expect(d.targetingLabel).toBe("自身增益");
    expect(d.targetingIcon).toBe("👤");
  });

  it("self_area: range=自身 + sphere area → mode=self_area, 施放", () => {
    const d = resolveSpellCastUI(
      makeSpell({ range: "自身", areaOfEffect: { type: "sphere", size: 10 } }),
      baseCtx(),
    );
    expect(d.targetingMode).toBe("self_area");
    expect(d.castButtonText).toBe("施放");
    expect(d.rangeLabel).toBe("自身为中心");
    expect(d.areaDetail).toBe("10尺球形");
  });

  it("self_emanation: range=自身 + cone area → mode=self_emanation", () => {
    const d = resolveSpellCastUI(
      makeSpell({ range: "自身", areaOfEffect: { type: "cone", size: 15 } }),
      baseCtx(),
    );
    expect(d.targetingMode).toBe("self_emanation");
    expect(d.castButtonText).toBe("选择范围并施放");
  });

  it("self_emanation: range=自身 15 尺锥状", () => {
    const d = resolveSpellCastUI(makeSpell({ range: "自身 15 尺锥状" }), baseCtx());
    expect(d.targetingMode).toBe("self_emanation");
    expect(d.areaDetail).toBe("15尺锥");
  });

  it("touch: range=触及 → mode=touch, 选择目标并施放", () => {
    const d = resolveSpellCastUI(makeSpell({ range: "触及" }), baseCtx());
    expect(d.targetingMode).toBe("touch");
    expect(d.castButtonText).toBe("选择目标并施放");
  });

  it("touch_area: range=触及 + area", () => {
    const d = resolveSpellCastUI(
      makeSpell({ range: "触及", areaOfEffect: { type: "cube", size: 5 } }),
      baseCtx(),
    );
    expect(d.targetingMode).toBe("touch_area");
    expect(d.castButtonText).toBe("选择范围并施放");
  });

  it("area: ranged + area → mode=area, 选择范围并施放", () => {
    const d = resolveSpellCastUI(
      makeSpell({ range: "120 尺", areaOfEffect: { type: "sphere", size: 20 } }),
      baseCtx(),
    );
    expect(d.targetingMode).toBe("area");
    expect(d.castButtonText).toBe("选择范围并施放");
    expect(d.areaDetail).toBe("20尺球形");
  });

  it("single_target: ranged, no area → 选择目标并施放", () => {
    const d = resolveSpellCastUI(makeSpell({ range: "60 尺" }), baseCtx());
    expect(d.targetingMode).toBe("single_target");
    expect(d.castButtonText).toBe("选择目标并施放");
  });

  it("special: range=视野", () => {
    const d = resolveSpellCastUI(makeSpell({ range: "视野内" }), baseCtx());
    expect(d.targetingMode).toBe("special");
  });

  it("sizeIsMax shows areaDetail with 至多 prefix", () => {
    const d = resolveSpellCastUI(
      makeSpell({ range: "自身", areaOfEffect: { type: "sphere", size: 30, sizeIsMax: true } }),
      baseCtx(),
    );
    expect(d.areaDetail).toBe("至多30尺球形");
    expect(d.canChooseAreaSize).toBe(true);
    expect(d.areaSizeMax).toBe(30);
  });

  // ── 施法选项 ──────────────────────────────────────

  it("castOptions present → hasCastOptions + requiresOptionSelection", () => {
    const d = resolveSpellCastUI(
      makeSpell({ castOptions: [{ key: "enlarge", label: "变巨" }, { key: "reduce", label: "缩小" }] }),
      baseCtx(),
    );
    expect(d.hasCastOptions).toBe(true);
    expect(d.castOptions).toEqual([{ key: "enlarge", label: "变巨" }, { key: "reduce", label: "缩小" }]);
    expect(d.requiresOptionSelection).toBe(true);
    // 未选中 → disabled
    expect(d.isCastDisabled).toBe(true);
    expect(d.castDisabledReasons).toContainEqual({ type: "option_not_selected" });
  });

  it("castOption selected → not disabled", () => {
    const d = resolveSpellCastUI(
      makeSpell({ castOptions: [{ key: "enlarge", label: "变巨" }] }),
      baseCtx({ selectedOptionKey: "enlarge" }),
    );
    expect(d.isCastDisabled).toBe(false);
  });

  // ── 成分警告 ──────────────────────────────────────

  it("V component + silenced → blocked", () => {
    const d = resolveSpellCastUI(
      makeSpell({ components: ["V", "S"] }),
      baseCtx({ isSilenced: true }),
    );
    expect(d.blockedBySilence).toBe(true);
    expect(d.isCastDisabled).toBe(true);
    expect(d.castDisabledReasons).toContainEqual({ type: "silenced" });
  });

  it("S component + both hands full → blocked", () => {
    const d = resolveSpellCastUI(
      makeSpell({ components: ["V", "S"] }),
      baseCtx({ equipMainHand: true, equipOffHand: true }),
    );
    expect(d.blockedByNoFreeHand).toBe(true);
    expect(d.isCastDisabled).toBe(true);
  });

  it("S component + hasSomaticFreedom → not blocked", () => {
    const d = resolveSpellCastUI(
      makeSpell({ components: ["V", "S"] }),
      baseCtx({ equipMainHand: true, equipOffHand: true, hasSomaticFreedom: true }),
    );
    expect(d.blockedByNoFreeHand).toBe(false);
  });

  // ── 材料 ──────────────────────────────────────────

  it("M component, no material available → disabled", () => {
    const d = resolveSpellCastUI(
      makeSpell({ components: ["V", "S", "M"], materials: "一颗珍珠" }),
      baseCtx({ hasMaterialAvailable: false }),
    );
    expect(d.hasMaterialComponent).toBe(true);
    expect(d.materialText).toBe("一颗珍珠");
    expect(d.isCastDisabled).toBe(true);
    expect(d.castDisabledReasons).toContainEqual({ type: "material_missing" });
  });

  it("M component, material available but not selected → disabled", () => {
    const d = resolveSpellCastUI(
      makeSpell({ components: ["M"] }),
      baseCtx({ hasMaterialAvailable: true, materialSelected: false }),
    );
    expect(d.castDisabledReasons).toContainEqual({ type: "material_not_selected" });
  });

  it("materialCost > 0 → needsGpValidation", () => {
    const d = resolveSpellCastUI(
      makeSpell({ components: ["M"], materialCost: 100 }),
      baseCtx(),
    );
    expect(d.needsGpValidation).toBe(true);
  });

  // ── 专注 ──────────────────────────────────────────

  it("concentration spell + existing concentration → conflict", () => {
    const d = resolveSpellCastUI(
      makeSpell({ concentration: true }),
      baseCtx({ concentrationSpellName: "祝福术" }),
    );
    expect(d.isConcentration).toBe(true);
    expect(d.hasConcentrationConflict).toBe(true);
  });

  // ── 长施法 / 仪式 ─────────────────────────────────

  it("1 minute casting time → isLongCast", () => {
    const d = resolveSpellCastUI(
      makeSpell({ castingTime: "1 分钟" }),
      baseCtx(),
    );
    expect(d.isLongCast).toBe(true);
  });

  it("1 action → not long cast", () => {
    const d = resolveSpellCastUI(makeSpell({ castingTime: "1 动作" }), baseCtx());
    expect(d.isLongCast).toBe(false);
  });

  it("ritual + level > 0 → canRitualCast", () => {
    const d = resolveSpellCastUI(
      makeSpell({ ritual: true, level: 1 }),
      baseCtx(),
    );
    expect(d.canRitualCast).toBe(true);
    expect(d.isRitualLongCast).toBe(true); // ritual 加 600 秒 >= 60
  });

  it("invocation free → no ritual", () => {
    const d = resolveSpellCastUI(
      makeSpell({ ritual: true, level: 1 }),
      baseCtx({ isInvocationFree: true }),
    );
    expect(d.canRitualCast).toBe(false);
  });

  // ── 幻象 ──────────────────────────────────────────

  it("visual illusion → needsIllusionInput", () => {
    const d = resolveSpellCastUI(
      makeSpell({ illusion: { types: ["visual"], subtype: "static_object" } }),
      baseCtx(),
    );
    expect(d.needsIllusionInput).toBe(true);
    expect(d.isDisguiseSpell).toBe(false);
    expect(d.illusionRequired).toBe(false);
  });

  it("appearance subtype → disguise + illusionRequired", () => {
    const d = resolveSpellCastUI(
      makeSpell({ illusion: { types: ["visual"], subtype: "appearance" } }),
      baseCtx(),
    );
    expect(d.isDisguiseSpell).toBe(true);
    expect(d.illusionRequired).toBe(true);
    // 没有图片 → disabled
    expect(d.isCastDisabled).toBe(true);
    expect(d.castDisabledReasons).toContainEqual({ type: "disguise_no_image" });
  });

  it("appearance + has image → not disabled", () => {
    const d = resolveSpellCastUI(
      makeSpell({ illusion: { types: ["visual"], subtype: "appearance" } }),
      baseCtx({ hasIllusionImage: true }),
    );
    expect(d.isCastDisabled).toBe(false);
  });

  it("self_duplicate subtype → no illusion input needed", () => {
    const d = resolveSpellCastUI(
      makeSpell({ illusion: { types: ["visual"], subtype: "self_duplicate" } }),
      baseCtx(),
    );
    expect(d.needsIllusionInput).toBe(false);
  });

  // ── 升环 ──────────────────────────────────────────

  it("level > 0 → showUpcastSelector", () => {
    const d = resolveSpellCastUI(makeSpell({ level: 2 }), baseCtx());
    expect(d.showUpcastSelector).toBe(true);
    expect(d.baseSpellLevel).toBe(2);
  });

  it("cantrip → no upcast", () => {
    const d = resolveSpellCastUI(makeSpell({ level: 0 }), baseCtx());
    expect(d.showUpcastSelector).toBe(false);
  });

  it("warlock → no upcast selector", () => {
    const d = resolveSpellCastUI(makeSpell({ level: 1 }), baseCtx({ isWarlock: true }));
    expect(d.showUpcastSelector).toBe(false);
  });

  // ── 施法中 ────────────────────────────────────────

  it("casting in progress → disabled", () => {
    const d = resolveSpellCastUI(
      makeSpell(),
      baseCtx({ castingSpellName: "召唤元素" }),
    );
    expect(d.isCastDisabled).toBe(true);
    expect(d.castDisabledReasons).toContainEqual({ type: "casting_in_progress", spellName: "召唤元素" });
  });

  // ── DM ────────────────────────────────────────────

  it("DM + disabled → showDmForceCast", () => {
    const d = resolveSpellCastUI(
      makeSpell({ components: ["V"] }),
      baseCtx({ isSilenced: true, isDM: true }),
    );
    expect(d.showDmForceCast).toBe(true);
  });

  it("DM + not disabled → no force cast", () => {
    const d = resolveSpellCastUI(makeSpell(), baseCtx({ isDM: true }));
    expect(d.showDmForceCast).toBe(false);
  });

  // ── 无限制 → 全部可用 ──────────────────────────────

  it("clean state → no disabled, no warnings", () => {
    const d = resolveSpellCastUI(makeSpell(), baseCtx());
    expect(d.isCastDisabled).toBe(false);
    expect(d.castDisabledReasons).toEqual([]);
    expect(d.blockedBySilence).toBe(false);
    expect(d.blockedByNoFreeHand).toBe(false);
    expect(d.hasConcentrationConflict).toBe(false);
  });

  // Chrome QA 2026-05-28: self-teleport spells (Misty Step) now route to a
  // dedicated destination picker. The cast button must remain enabled and
  // its label must invite the user to pick a destination on the map.
  it("self-teleport spell → teleport_destination mode, enabled, picker label", () => {
    const mistyStep = makeSpell({
      id: "misty_step",
      name: "迷踪步",
      range: "自身",
      level: 2,
      effects: [
        {
          trigger: "on_cast",
          target: { type: "self" },
          effects: [
            { type: "narrative", description: "..." },
            { type: "teleport", range: 30, mode: "self", mustSee: true },
          ],
        },
      ],
    });
    const d = resolveSpellCastUI(mistyStep, baseCtx());
    expect(d.targetingMode).toBe("teleport_destination");
    expect(d.castButtonText).toBe("选择目的地并施放");
    expect(d.isCastDisabled).toBe(false);
    expect(d.castDisabledReasons).toEqual([]);
  });

  // Chrome QA 2026-05-28: Conjure Animals 没有 areaOfEffect，默认路径会把它路由到
  // single_target，从而无法进入空地放置流程。短施法的召唤系应改写为 area 模式。
  it("short-cast summon with no areaOfEffect → routed to area mode with stable areaDetail", () => {
    const conjureAnimals = makeSpell({
      id: "conjure_animals",
      name: "召唤动物",
      range: "60 尺",
      level: 3,
      castingTime: "1 动作",
      concentration: true,
      effects: [
        {
          trigger: "on_cast",
          target: { type: "point" },
          effects: [{ type: "spawn_summon", summonId: "wolf", count: 2 }],
        },
      ],
    });
    const d = resolveSpellCastUI(conjureAnimals, baseCtx({ selectedCastLevel: 3 }));
    expect(d.targetingMode).toBe("area");
    expect(d.castButtonText).toBe("选择范围并施放");
    expect(d.areaDetail).toBeTruthy();
    expect(d.areaDetail).not.toBeNull();
  });

  // 长施法的召唤系 (Find Familiar / 仪式 Conjure Animals 等) 不在本切片范围；
  // 弹窗不应承诺 area 放置，避免在计时开始前误导玩家。
  it("long-cast summon spell → keeps single_target mode (long-cast UX preserved)", () => {
    const findFamiliar = makeSpell({
      id: "find_familiar",
      name: "寻找魔宠",
      range: "10 尺",
      level: 1,
      castingTime: "1 小时",
      ritual: true,
      effects: [
        {
          trigger: "on_cast",
          target: { type: "point" },
          effects: [{ type: "spawn_summon", summonId: "familiar" }],
        },
      ],
    });
    const d = resolveSpellCastUI(findFamiliar, baseCtx());
    expect(d.isLongCast).toBe(true);
    expect(d.targetingMode).toBe("single_target");
  });

  // 非召唤系 single_target 法术不受 override 影响 (避免回归)。
  it("non-summon single_target spell unaffected by summon override", () => {
    const firebolt = makeSpell({
      id: "firebolt",
      range: "120 尺",
      level: 0,
      effects: [
        {
          trigger: "on_cast",
          target: { type: "single" },
          effects: [{ type: "deal_damage", formula: "1d10" }],
        },
      ],
    });
    const d = resolveSpellCastUI(firebolt, baseCtx());
    expect(d.targetingMode).toBe("single_target");
  });

  it("self-buff with no teleport effect → no teleport_destination routing", () => {
    const mageArmor = makeSpell({
      id: "mage_armor",
      range: "触及",
      effects: [{ trigger: "on_cast", target: { type: "single" }, effects: [{ type: "modify_stat" }] }],
    });
    const d = resolveSpellCastUI(mageArmor, baseCtx());
    expect(d.targetingMode).not.toBe("teleport_destination");
  });
});
