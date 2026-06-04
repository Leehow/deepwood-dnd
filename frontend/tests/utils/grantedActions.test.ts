import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: vi.fn(),
}));

import { publishAppEvent } from "../../app/events/appEventBus";
import {
  actionNeedsTarget,
  executeGrantedAction,
  extractAllGrantedActions,
  extractGrantedActions,
  grantedActionToSpellOption,
} from "../../app/utils/grantedActions";

describe("grantedActions runtime integration", () => {
  it("prefers runtime granted actions over static spell JSON actions for runtime-backed spells", () => {
    const staticHexActions = extractGrantedActions("hex", 1);
    expect(staticHexActions).toHaveLength(1);

    const actions = extractAllGrantedActions(
      { spell_id: "hex", slot_level: 1 },
      undefined,
      [
        {
          runtime_instance_id: 77,
          action_id: "transfer_hex",
          spell_id: "hex",
          spell_name: "脆弱诅咒",
          slot_level: 1,
          action_type: "bonus_action",
          action_name: "转移诅咒",
          action_kind: "move_effect",
          requires_target: true,
          available: true,
          source: "runtime",
        },
      ],
      [
        {
          runtime_instance_id: 77,
          spell_id: "hex",
          role: "source",
        },
      ],
    );

    expect(actions).toHaveLength(1);
    expect(actions[0].runtimeAction).toMatchObject({
      runtimeInstanceId: 77,
      actionId: "transfer_hex",
      requiresTarget: true,
    });
    expect(actions[0].spellId).toBe("hex");
    expect(actions[0].effect.actionName).toBe("转移诅咒");
  });

  it("keeps runtime metadata when converting to a spell option", () => {
    const [action] = extractAllGrantedActions(
      undefined,
      undefined,
      [
        {
          runtime_instance_id: 88,
          action_id: "transfer_hex",
          spell_id: "hex",
          spell_name: "脆弱诅咒",
          slot_level: 3,
          action_type: "bonus_action",
          action_name: "转移诅咒",
          action_kind: "move_effect",
          requires_target: true,
          available: true,
          source: "runtime",
        },
      ],
      [
        {
          runtime_instance_id: 88,
          spell_id: "hex",
          role: "source",
        },
      ],
    );

    const option = grantedActionToSpellOption(action);

    expect(option.range).toBeTruthy();
    expect(String(option.range)).toContain("90");
    expect(option.__runtimeAction).toMatchObject({
      runtimeInstanceId: 88,
      actionId: "transfer_hex",
    });
  });

  it("respects runtime target requirements instead of guessing from action kind", () => {
    const [dashLikeRuntimeAction] = extractAllGrantedActions(
      undefined,
      undefined,
      [
        {
          runtime_instance_id: 99,
          action_id: "retarget_hex",
          spell_id: "hex",
          spell_name: "脆弱诅咒",
          slot_level: 1,
          action_type: "bonus_action",
          action_name: "转移诅咒",
          action_kind: "dash",
          requires_target: true,
          available: true,
          source: "runtime",
        },
      ],
      null,
    );

    expect(actionNeedsTarget(dashLikeRuntimeAction)).toBe(true);
  });

  it("surfaces grant_action entries persisted on the caster's active_effects (Witch Bolt path)", () => {
    // Shape persisted by backend `GrantActionHandler` (see Chrome QA
    // 2026-05-28 third slice — `effect_type === 'grant_action'` with
    // `action_kind: 'repeat_damage'`).
    const actions = extractAllGrantedActions(
      { spell_id: "witch_bolt", slot_level: 1 },
      undefined,
      null,
      null,
      [
        {
          id: "witch_bolt_grant_action_巫术箭伤害",
          name: "巫术箭伤害",
          source: "巫术箭",
          source_token_id: 527,
          spell_id: "witch_bolt",
          is_concentration: true,
          effect_type: "grant_action",
          action_type: "action",
          action_name: "巫术箭伤害",
          action_kind: "repeat_damage",
          damage: { formula: "1d12", damage_type: "lightning" },
          target_token_id: 535,
        },
      ],
    );

    const witchBoltAction = actions.find((a) => a.spellId === "witch_bolt" && a.effect.actionKind === "repeat_damage");
    expect(witchBoltAction).toBeTruthy();
    expect(witchBoltAction?.effect.actionName).toBe("巫术箭伤害");
    expect(witchBoltAction?.effect.damage).toEqual({ formula: "1d12", damageType: "lightning" });
    expect(witchBoltAction?.runtimeAction).toBeUndefined();
    expect(witchBoltAction?.spellName).toBe("巫术箭");
  });

  it("attaches __activeEffectGrantAction metadata to the spell option for backend-persisted grants", () => {
    const actions = extractAllGrantedActions(
      { spell_id: "witch_bolt", slot_level: 1 },
      undefined,
      null,
      null,
      [
        {
          id: "witch_bolt_grant_action_巫术箭伤害",
          name: "巫术箭伤害",
          source: "巫术箭",
          source_token_id: 527,
          spell_id: "witch_bolt",
          effect_type: "grant_action",
          action_type: "action",
          action_name: "巫术箭伤害",
          action_kind: "repeat_damage",
          damage: { formula: "1d12", damage_type: "lightning" },
          target_token_id: 534,
        },
      ],
    );

    const witchBolt = actions.find(
      (a) => a.spellId === "witch_bolt" && a.effect.actionKind === "repeat_damage",
    );
    expect(witchBolt).toBeTruthy();
    expect(witchBolt!.activeEffectGrantAction).toMatchObject({
      effectId: "witch_bolt_grant_action_巫术箭伤害",
      spellId: "witch_bolt",
      spellName: "巫术箭",
      actionKind: "repeat_damage",
      actionName: "巫术箭伤害",
      targetTokenId: 534,
      sourceTokenId: 527,
    });

    const option = grantedActionToSpellOption(witchBolt!) as any;
    expect(option.__activeEffectGrantAction).toMatchObject({
      effectId: "witch_bolt_grant_action_巫术箭伤害",
      spellId: "witch_bolt",
      actionKind: "repeat_damage",
      targetTokenId: 534,
    });
    // Runtime-action metadata must not be forged for active-effect grants.
    expect(option.__runtimeAction).toBeUndefined();
  });

  it("ignores grant_action active effects without a spell_id and dedupes against runtime/spell-derived actions", () => {
    const noSpellId = extractAllGrantedActions(
      null,
      undefined,
      null,
      null,
      [{ effect_type: "grant_action", action_name: "x" }],
    );
    expect(noSpellId).toHaveLength(0);

    // If the same action is already projected by the runtime, the
    // active_effect copy must not produce a duplicate menu entry.
    const dedup = extractAllGrantedActions(
      null,
      undefined,
      [
        {
          runtime_instance_id: 1,
          action_id: "witch_bolt_repeat",
          spell_id: "witch_bolt",
          spell_name: "巫术箭",
          slot_level: 1,
          action_type: "action",
          action_name: "巫术箭伤害",
          action_kind: "repeat_damage",
          requires_target: true,
          available: true,
          source: "runtime",
        },
      ],
      null,
      [
        {
          spell_id: "witch_bolt",
          source: "巫术箭",
          effect_type: "grant_action",
          action_type: "action",
          action_name: "巫术箭伤害",
          action_kind: "repeat_damage",
          damage: { formula: "1d12", damage_type: "lightning" },
        },
      ],
    );
    expect(dedup).toHaveLength(1);
    expect(dedup[0].runtimeAction).toBeTruthy();
  });

  it("lets a token active_effect grant action win over a duplicate legacy projection so __activeEffectGrantAction survives", () => {
    // Chrome QA 2026-05-28: backend projected both a `legacy` `granted_actions_ui` entry
    // (runtime_instance_id: 0, action_id starts with `legacy:`) and an `active_effects`
    // `grant_action` entry. The active-effect copy is the only one that carries the
    // locked `target_token_id` and `effect_id`, so it must beat the projection or the
    // sidebar controller cannot route to `/api/spells/granted-actions/execute`.
    const actions = extractAllGrantedActions(
      { spell_id: "witch_bolt", slot_level: 1 },
      undefined,
      [
        {
          runtime_instance_id: 0,
          action_id: "legacy:witch_bolt:repeat_damage:巫术箭伤害",
          spell_id: "witch_bolt",
          spell_name: "巫术箭",
          slot_level: 1,
          action_type: "action",
          action_name: "巫术箭伤害",
          action_kind: "repeat_damage",
          requires_target: true,
          available: true,
          source: "legacy",
        },
      ],
      null,
      [
        {
          id: "witch_bolt_grant_action_巫术箭伤害",
          name: "巫术箭伤害",
          source: "巫术箭",
          source_token_id: 527,
          spell_id: "witch_bolt",
          effect_type: "grant_action",
          action_type: "action",
          action_name: "巫术箭伤害",
          action_kind: "repeat_damage",
          damage: { formula: "1d12", damage_type: "lightning" },
          target_token_id: 535,
        },
      ],
    );

    expect(actions).toHaveLength(1);
    expect(actions[0].runtimeAction).toBeUndefined();
    expect(actions[0].activeEffectGrantAction).toMatchObject({
      effectId: "witch_bolt_grant_action_巫术箭伤害",
      spellId: "witch_bolt",
      targetTokenId: 535,
      sourceTokenId: 527,
    });
    const option = grantedActionToSpellOption(actions[0]) as any;
    expect(option.__activeEffectGrantAction).toBeTruthy();
    expect(option.__runtimeAction).toBeUndefined();
  });

  it("gives a move_effect grant the source spell's top-level area shape (Moonbeam)", () => {
    // Moonbeam's grant_action entry omits area_of_effect, but the spell has a
    // top-level cylinder/5. The move_effect option must inherit that shape so it
    // enters the area placement flow instead of single-target.
    const [moveAction] = extractGrantedActions("moonbeam");
    expect(moveAction).toBeTruthy();
    expect(moveAction.effect.actionKind).toBe("move_effect");
    expect(moveAction.effect.areaOfEffect).toBeFalsy();

    const option = grantedActionToSpellOption(moveAction);
    expect(option.areaOfEffect).toEqual({ type: "cylinder", size: 5 });
  });

  it("gives a move_effect grant a concrete fallback shape when the spell has none (Flaming Sphere)", () => {
    // Flaming Sphere has neither a grant-entry area nor a top-level area shape.
    // Without a fallback the placement flow would default to a 20ft sphere, so
    // the move_effect option must inherit the per-spell fallback (sphere/5)
    // while still being treated as an area grant for context-menu routing.
    const [moveAction] = extractGrantedActions("flaming_sphere");
    expect(moveAction).toBeTruthy();
    expect(moveAction.effect.actionKind).toBe("move_effect");
    expect(moveAction.effect.areaOfEffect).toBeFalsy();

    const option = grantedActionToSpellOption(moveAction);
    expect(option.areaOfEffect).toEqual({ type: "sphere", size: 5 });
    // Still an area/move grant so the menu does not take the single-target path.
    expect(actionNeedsTarget(moveAction)).toBe(true);
    expect(option.id).toContain("move_effect");
  });

  it("lets an explicit grant-entry area shape win over the Flaming Sphere fallback", () => {
    // If a grant entry ever carries an explicit area_of_effect, it must beat the
    // per-spell fallback rather than be overwritten by sphere/5.
    const explicit = extractGrantedActions("flaming_sphere")[0];
    explicit.effect.areaOfEffect = { type: "cube", size: 10 };
    const option = grantedActionToSpellOption(explicit);
    expect(option.areaOfEffect).toEqual({ type: "cube", size: 10 });
  });

  it("uses backend-projected legacy granted actions without treating them as runtime actions", () => {
    const actions = extractAllGrantedActions(
      { spell_id: "expeditious_retreat", slot_level: 1 },
      undefined,
      [
        {
          runtime_instance_id: 0,
          action_id: "legacy:expeditious_retreat:dash:疾走",
          spell_id: "expeditious_retreat",
          spell_name: "脚底抹油",
          slot_level: 1,
          action_type: "bonus_action",
          action_name: "疾走",
          action_kind: "dash",
          requires_target: false,
          available: true,
          source: "legacy",
        },
      ],
      null,
    );

    expect(actions).toHaveLength(1);
    expect(actions[0].spellId).toBe("expeditious_retreat");
    expect(actions[0].runtimeAction).toBeUndefined();
    expect(actions[0].effect.actionName).toBe("疾走");
  });
});

describe("grantedActions no-target action kinds (weapon_attack / custom)", () => {
  it("treats weapon_attack (Swift Quiver) as a no-target declaration", () => {
    // Swift Quiver's grant entry carries no damage/attack/save metadata, so the
    // damage-only target picker was the wrong V1 behavior — it must be a
    // declaration action instead.
    const [action] = extractGrantedActions("swift_quiver");
    expect(action).toBeTruthy();
    expect(action.effect.actionKind).toBe("weapon_attack");
    expect(actionNeedsTarget(action)).toBe(false);
  });

  it("treats custom (Compulsion) as a no-target declaration", () => {
    const [action] = extractGrantedActions("compulsion");
    expect(action).toBeTruthy();
    expect(action.effect.actionKind).toBe("custom");
    expect(actionNeedsTarget(action)).toBe(false);
  });

  it("keeps remove_condition (Dispel Evil and Good) target-required", () => {
    // remove_condition still resolves against a chosen target on the backend, so
    // it must keep entering the target flow (regression guard for the new
    // NO_TARGET_KINDS additions not over-reaching).
    const [action] = extractGrantedActions("dispel_evil_and_good");
    expect(action).toBeTruthy();
    expect(action.effect.actionKind).toBe("remove_condition");
    expect(actionNeedsTarget(action)).toBe(true);
  });

  it("publishes a declaration chat (no target picker) for weapon_attack", () => {
    vi.mocked(publishAppEvent).mockClear();
    const [swift] = extractGrantedActions("swift_quiver");
    executeGrantedAction(swift, 1, "8", 100);
    const events = vi.mocked(publishAppEvent).mock.calls.map((c) => c[0]);
    expect(events).toContain("spellCastChat");
    expect(events).not.toContain("startSpellTargeting");
    const chatCall = vi
      .mocked(publishAppEvent)
      .mock.calls.find((c) => c[0] === "spellCastChat");
    expect(String((chatCall?.[1] as any)?.message)).toContain("迅捷射击");
  });

  it("publishes a declaration chat (no target picker) for custom", () => {
    vi.mocked(publishAppEvent).mockClear();
    const [compulsion] = extractGrantedActions("compulsion");
    executeGrantedAction(compulsion, 1, "8", 100);
    const events = vi.mocked(publishAppEvent).mock.calls.map((c) => c[0]);
    expect(events).toContain("spellCastChat");
    expect(events).not.toContain("startSpellTargeting");
    const chatCall = vi
      .mocked(publishAppEvent)
      .mock.calls.find((c) => c[0] === "spellCastChat");
    expect(String((chatCall?.[1] as any)?.message)).toContain("指定移动方向");
  });
});
