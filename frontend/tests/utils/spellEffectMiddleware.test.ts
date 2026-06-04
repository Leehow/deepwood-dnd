import { describe, expect, it } from "vitest";
import { resolveSpellEffects } from "../../app/utils/spellEffectMiddleware";

function makeSpell(overrides: Record<string, any> = {}): any {
  return {
    id: "test", name: "测试", level: 1, school: "evocation",
    castingTime: "1 动作", range: "30 尺", components: ["V", "S"],
    duration: "瞬间", ritual: false, concentration: false,
    description: "", classes: [],
    ...overrides,
  };
}

describe("spellEffectMiddleware — resolveSpellEffects", () => {
  // ── 基础合并 ──────────────────────────────────────

  it("returns spell.effects as phases with source=spell_effects", () => {
    const spell = makeSpell({
      effects: [
        { trigger: "on_cast", target: { type: "single" }, effects: [{ type: "deal_damage", formula: "2d6", damageType: "fire" }] },
      ],
    });
    const res = resolveSpellEffects(spell);
    expect(res.phases).toHaveLength(1);
    expect(res.phases[0].source).toBe("spell_effects");
    expect(res.hasMechanicalEffects).toBe(true);
    expect(res.mechanicalTypes.has("deal_damage")).toBe(true);
  });

  it("merges castOption effects when selectedOption is provided", () => {
    const spell = makeSpell({
      effects: [
        { trigger: "on_cast", target: { type: "single" }, effects: [{ type: "narrative", description: "基础" }] },
      ],
      castOptions: [
        {
          key: "enlarge", label: "变巨",
          effects: [
            { trigger: "on_cast", target: { type: "single" }, effects: [{ type: "resize_token", sizeDelta: 1 }] },
          ],
        },
      ],
    });
    const res = resolveSpellEffects(spell, "enlarge");
    expect(res.phases).toHaveLength(2);
    expect(res.phases[0].source).toBe("spell_effects");
    expect(res.phases[1].source).toBe("cast_option");
    expect(res.visualEffects.resizeToken).toBe(1);
  });

  it("does not include castOption effects when no option selected", () => {
    const spell = makeSpell({
      effects: [{ trigger: "on_cast", target: { type: "single" }, effects: [{ type: "narrative" }] }],
      castOptions: [
        { key: "enlarge", label: "变巨", effects: [{ trigger: "on_cast", target: { type: "single" }, effects: [{ type: "resize_token", sizeDelta: 1 }] }] },
      ],
    });
    const res = resolveSpellEffects(spell);
    expect(res.phases).toHaveLength(1);
    expect(res.visualEffects.resizeToken).toBeNull();
  });

  // ── narrative-only 判断 ────────────────────────────

  it("narrative-only spell → hasMechanicalEffects = false", () => {
    const spell = makeSpell({
      effects: [
        { trigger: "on_cast", target: { type: "single" }, effects: [{ type: "narrative", description: "纯文本" }] },
      ],
    });
    const res = resolveSpellEffects(spell);
    expect(res.hasMechanicalEffects).toBe(false);
    expect(res.mechanicalTypes.size).toBe(0);
  });

  it("mixed effects → hasMechanicalEffects = true", () => {
    const spell = makeSpell({
      effects: [
        {
          trigger: "on_cast", target: { type: "single" },
          effects: [
            { type: "narrative", description: "文本" },
            { type: "heal", formula: "2d8" },
          ],
        },
      ],
    });
    const res = resolveSpellEffects(spell);
    expect(res.hasMechanicalEffects).toBe(true);
    expect(res.mechanicalTypes.has("heal")).toBe(true);
    expect(res.mechanicalTypes.has("narrative")).toBe(false);
  });

  // ── apply_token_filter 扫描 ──────────────────────────

  it("reads apply_token_filter from spell.effects", () => {
    const spell = makeSpell({
      effects: [{
        trigger: "on_cast", target: { type: "single" },
        effects: [{ type: "apply_token_filter", filter: { glow: "#22c55e", glowRadius: 6 } }],
      }],
    });
    const res = resolveSpellEffects(spell);
    expect(res.phases).toHaveLength(1);
    expect(res.phases[0].source).toBe("spell_effects");
    expect(res.visualEffects.tokenFilter).toEqual({ glow: "#22c55e", glowRadius: 6 });
    expect(res.hasMechanicalEffects).toBe(true);
  });

  it("reads apply_token_filter from castOption.effects", () => {
    const spell = makeSpell({
      effects: [{ trigger: "on_cast", target: { type: "single" }, effects: [{ type: "narrative" }] }],
      castOptions: [
        {
          key: "enlarge", label: "变巨",
          effects: [{ trigger: "on_cast", target: { type: "single" }, effects: [{ type: "apply_token_filter", filter: { glow: "#f59e0b", glowRadius: 6 } }] }],
        },
      ],
    });
    const res = resolveSpellEffects(spell, "enlarge");
    expect(res.visualEffects.tokenFilter).toEqual({ glow: "#f59e0b", glowRadius: 6 });
  });

  it("ignores legacy tokenFilter field (no longer synthesized)", () => {
    const spell = makeSpell({
      effects: [{ trigger: "on_cast", target: { type: "single" }, effects: [{ type: "narrative" }] }],
      tokenFilter: { glow: "#ff0000" },
    });
    const res = resolveSpellEffects(spell);
    expect(res.phases).toHaveLength(1);
    expect(res.visualEffects.tokenFilter).toBeNull();
  });

  // ── UI 效果扫描 ───────────────────────────────────

  it("scans resize_token", () => {
    const spell = makeSpell({
      effects: [{
        trigger: "on_cast", target: { type: "single" },
        effects: [{ type: "resize_token", sizeDelta: -1 }],
      }],
    });
    const res = resolveSpellEffects(spell);
    expect(res.visualEffects.resizeToken).toBe(-1);
  });

  it("scans set_visibility", () => {
    const spell = makeSpell({
      effects: [{
        trigger: "on_cast", target: { type: "single" },
        effects: [{ type: "set_visibility", mode: "invisible" }],
      }],
    });
    const res = resolveSpellEffects(spell);
    expect(res.visualEffects.visibility).toBe("invisible");
  });

  it("scans set_disguise", () => {
    const spell = makeSpell({
      effects: [{
        trigger: "on_cast", target: { type: "single" },
        effects: [{ type: "set_disguise", disguiseType: "appearance", requiresImage: true }],
      }],
    });
    const res = resolveSpellEffects(spell);
    expect(res.visualEffects.disguise).toBe(true);
  });

  it("scans create_zone_visual", () => {
    const spell = makeSpell({
      effects: [{
        trigger: "on_cast", target: { type: "zone" },
        effects: [{ type: "create_zone_visual", zoneType: "fog", obscurement: "heavy" }],
      }],
    });
    const res = resolveSpellEffects(spell);
    expect(res.visualEffects.zoneVisual).toBe("fog");
  });

  it("scans spawn_illusion", () => {
    const spell = makeSpell({
      effects: [{
        trigger: "on_cast", target: { type: "zone" },
        effects: [{ type: "spawn_illusion", illusionType: "visual", controllable: true }],
      }],
    });
    const res = resolveSpellEffects(spell);
    expect(res.visualEffects.illusion).toBe(true);
  });

  it("scans apply_transformation", () => {
    const spell = makeSpell({
      effects: [{
        trigger: "on_cast", target: { type: "single" },
        effects: [{ type: "apply_transformation", transformType: "polymorph" }],
      }],
    });
    const res = resolveSpellEffects(spell);
    expect(res.visualEffects.transformation).toBe("polymorph");
  });

  // ── 多 filter 合并 ───────────────────────────────

  it("merges multiple apply_token_filter effects", () => {
    const spell = makeSpell({
      effects: [
        {
          trigger: "on_cast", target: { type: "single" },
          effects: [{ type: "apply_token_filter", filter: { glow: "#ff0000", glowRadius: 6 } }],
        },
        {
          trigger: "on_cast", target: { type: "single" },
          effects: [{ type: "apply_token_filter", filter: { opacity: 0.5, glowRadius: 10 } }],
        },
      ],
    });
    const res = resolveSpellEffects(spell);
    // 后者覆盖 glowRadius，新增 opacity
    expect(res.visualEffects.tokenFilter).toEqual({
      glow: "#ff0000", glowRadius: 10, opacity: 0.5,
    });
  });

  // ── 空法术 ────────────────────────────────────────

  it("spell with no effects → empty result", () => {
    const spell = makeSpell({ effects: [] });
    const res = resolveSpellEffects(spell);
    expect(res.phases).toHaveLength(0);
    expect(res.hasMechanicalEffects).toBe(false);
    expect(res.visualEffects.tokenFilter).toBeNull();
  });

  it("spell with undefined effects → empty result", () => {
    const spell = makeSpell({});
    const res = resolveSpellEffects(spell);
    expect(res.phases).toHaveLength(0);
    expect(res.hasMechanicalEffects).toBe(false);
  });

  // ── mechanicalTypes 集合 ──────────────────────────

  it("collects all mechanical types across phases", () => {
    const spell = makeSpell({
      effects: [
        { trigger: "on_cast", target: { type: "single" }, effects: [
          { type: "deal_damage", formula: "1d6", damageType: "fire" },
          { type: "apply_condition", condition: "prone" },
          { type: "narrative", description: "text" },
        ]},
        { trigger: "on_enter_zone", target: { type: "all_in_area" }, effects: [
          { type: "deal_damage", formula: "2d4", damageType: "piercing" },
        ]},
      ],
    });
    const res = resolveSpellEffects(spell);
    expect(res.mechanicalTypes).toEqual(new Set(["deal_damage", "apply_condition"]));
  });
});
