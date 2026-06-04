import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapAreaSpellNonCombatController } from "../../app/components/map/hooks/useMapAreaSpellNonCombatController";

const publishAppEventMock = vi.fn();
const startSpellCastViaAPIMock = vi.fn();
const syncCharacterSpellSlotsFromBackendMock = vi.fn();

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
}));

vi.mock("../../app/utils/sidebarCasting", () => ({
  startSpellCastViaAPI: (...args: any[]) => startSpellCastViaAPIMock(...args),
  syncCharacterSpellSlotsFromBackend: (...args: any[]) =>
    syncCharacterSpellSlotsFromBackendMock(...args),
}));

describe("useMapAreaSpellNonCombatController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
    startSpellCastViaAPIMock.mockReset();
    syncCharacterSpellSlotsFromBackendMock.mockReset();
  });

  it("handles utility area spells with concentration and illusion side effects", async () => {
    const consumeAreaSpellSlot = vi.fn().mockResolvedValue({
      "2": { current: 1, max: 3 },
    });
    const createIllusionToken = vi.fn().mockResolvedValue(null);
    const persistAreaEffect = vi.fn().mockResolvedValue(undefined);
    const setConcentrationOnTokenFn = vi.fn().mockResolvedValue(undefined);
    const playCast = vi.fn();
    const showToast = vi.fn();
    const sendMessage = vi.fn();
    const handleAreaSpellCancel = vi.fn();
    const clearReadyCast = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useMapAreaSpellNonCombatController({
        currentMapUrl: "/maps/test.png",
        showToast,
        sendMessage,
        playCast,
        handleAreaSpellCancel,
        clearReadyCast,
        setConcentrationOnTokenFn,
        consumeAreaSpellSlot,
        createIllusionToken,
        persistAreaEffect,
      }),
    );

    let handled = false;
    await act(async () => {
      handled = await result.current.handleNonCombatAreaSpell({
        areaSpellMode: {
          freecast: false,
          ritualCast: false,
          illusionImageUrl: "https://cdn.example.com/illusion.png",
          illusionDesc: "木箱",
          illusionDisplayName: "幻影木箱",
        },
        spell: {
          id: "fog-cloud",
          name: "云雾术",
          damageType: "cold",
          duration: "10分钟",
          concentration: true,
          zoneEffects: { color: "gray" },
        } as any,
        slotLevel: 2,
        sourceToken: {
          id: 11,
          character_id: 18,
          instance_name: "法师",
        } as any,
        sourceTokenId: 11,
        shapeType: "sphere",
        centerPos: { x: 8, y: 8 },
        originPos: null,
        effectiveCenterPos: { x: 8, y: 8 },
        followCaster: false,
        sizeFeet: 20,
        direction: 0,
        finalTargets: [],
        readyCastTokenId: 77,
        sourceCharacterSpellSlotsState: { "2": { current: 2, max: 3 } },
      });
    });

    expect(handled).toBe(true);
    expect(sendMessage).toHaveBeenCalled();
    expect(publishAppEventMock).toHaveBeenCalledWith("spellSlotsUpdate", {
      character_id: 18,
      spell_slots_state: {
        "2": { current: 1, max: 3 },
      },
    });
    expect(consumeAreaSpellSlot).toHaveBeenCalled();
    expect(setConcentrationOnTokenFn).toHaveBeenCalled();
    expect(createIllusionToken).toHaveBeenCalled();
    expect(playCast).toHaveBeenCalledWith("fog-cloud", "cold");
    expect(showToast).toHaveBeenCalledWith("法师 施放了 云雾术 (2环)", "success");
    expect(handleAreaSpellCancel).toHaveBeenCalled();
    expect(clearReadyCast).toHaveBeenCalledWith(77);
    expect(persistAreaEffect).not.toHaveBeenCalled();
  });

  it("handles empty-ground zone casts and persists the area effect", async () => {
    const persistAreaEffect = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useMapAreaSpellNonCombatController({
        currentMapUrl: "/maps/test.png",
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        playCast: vi.fn(),
        handleAreaSpellCancel: vi.fn(),
        clearReadyCast: vi.fn().mockResolvedValue(undefined),
        setConcentrationOnTokenFn: vi.fn().mockResolvedValue(undefined),
        consumeAreaSpellSlot: vi.fn().mockResolvedValue(null),
        createIllusionToken: vi.fn().mockResolvedValue(null),
        persistAreaEffect,
      }),
    );

    let handled = false;
    await act(async () => {
      handled = await result.current.handleNonCombatAreaSpell({
        areaSpellMode: {
          freecast: true,
          ritualCast: false,
          illusionImageUrl: undefined,
          illusionDesc: undefined,
          illusionDisplayName: undefined,
        },
        spell: {
          id: "grease",
          name: "油腻术",
          duration: "1分钟",
          concentration: false,
          controlEffect: { effectType: "zone" },
          // `hasZoneControlBehavior` now requires a structured zone phase
          // with an apply_condition leaf — without it the empty-ground gate
          // is closed. Reflect the current data shape so the test exercises
          // the intended path.
          effects: [
            {
              trigger: "on_enter_zone",
              target: { type: "all_in_area" },
              effects: [{ type: "apply_condition", condition: "prone" }],
            },
          ],
        } as any,
        slotLevel: 1,
        sourceToken: {
          id: 11,
          character_id: 18,
          instance_name: "法师",
        } as any,
        sourceTokenId: 11,
        shapeType: "sphere",
        centerPos: { x: 8, y: 8 },
        originPos: null,
        effectiveCenterPos: { x: 8, y: 8 },
        followCaster: false,
        sizeFeet: 20,
        direction: 0,
        finalTargets: [],
      });
    });

    expect(handled).toBe(true);
    expect(persistAreaEffect).toHaveBeenCalledWith(expect.objectContaining({
      sourceTokenId: 11,
      position: { x: 8, y: 8 },
    }));
  });

  // Chrome QA 2026-05-28: Web on empty ground spent a 2nd-level slot and
  // added `spell_area_web` but never replaced the prior Hold Person
  // concentration. The fix broadens the concentration gate to any
  // concentration zone spell, not only "utility" zones.
  it("sets concentration when a control concentration zone spell is placed on empty ground", async () => {
    const persistAreaEffect = vi.fn().mockResolvedValue(undefined);
    const setConcentrationOnTokenFn = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useMapAreaSpellNonCombatController({
        currentMapUrl: "/maps/test.png",
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        playCast: vi.fn(),
        handleAreaSpellCancel: vi.fn(),
        clearReadyCast: vi.fn().mockResolvedValue(undefined),
        setConcentrationOnTokenFn,
        consumeAreaSpellSlot: vi.fn().mockResolvedValue(null),
        createIllusionToken: vi.fn().mockResolvedValue(null),
        persistAreaEffect,
      }),
    );

    let handled = false;
    await act(async () => {
      handled = await result.current.handleNonCombatAreaSpell({
        areaSpellMode: {
          freecast: true,
          ritualCast: false,
          illusionImageUrl: undefined,
          illusionDesc: undefined,
          illusionDisplayName: undefined,
        },
        // Minimal Web-like fixture: control spell, concentration, save-based,
        // structured zone phases so `hasZoneControlBehavior` returns true and
        // empty-ground cast is allowed.
        spell: {
          id: "web",
          name: "蛛网术",
          duration: "1小时",
          concentration: true,
          attackType: "save",
          zoneEffects: { color: "web" },
          effects: [
            {
              trigger: "on_enter_zone",
              target: { type: "all_in_area" },
              effects: [{ type: "apply_condition", condition: "restrained" }],
            },
          ],
        } as any,
        slotLevel: 2,
        sourceToken: {
          id: 11,
          character_id: 18,
          instance_name: "法师",
        } as any,
        sourceTokenId: 11,
        shapeType: "cube",
        centerPos: { x: 12, y: 12 },
        originPos: null,
        effectiveCenterPos: { x: 12, y: 12 },
        followCaster: false,
        sizeFeet: 20,
        direction: 0,
        finalTargets: [],
      });
    });

    expect(handled).toBe(true);
    expect(setConcentrationOnTokenFn).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ id: "web" }),
      2,
      undefined,
      undefined,
      [],
      expect.objectContaining({ shape: "cube", center_x: 12, center_y: 12 }),
    );
    // Concentration zone spells own the area via concentration_spell.area_effect;
    // they must not also persist a parallel non-concentration spell_area_* buff.
    expect(persistAreaEffect).not.toHaveBeenCalled();
  });

  // Chrome QA 2026-05-28 third slice: Minor Illusion previously left no DB
  // trace because the persist gate required either `zoneEffects` or a
  // structured zone control phase, and a cantrip visual illusion has
  // neither. Non-concentration illusion area spells must still persist a
  // `spell_area_*` entry on the caster for visibility.
  it("persists a spell_area_* record for non-concentration illusion area spells (Minor Illusion)", async () => {
    const persistAreaEffect = vi.fn().mockResolvedValue(undefined);
    const setConcentrationOnTokenFn = vi.fn().mockResolvedValue(undefined);
    const createIllusionToken = vi.fn().mockResolvedValue(null);

    const { result } = renderHook(() =>
      useMapAreaSpellNonCombatController({
        currentMapUrl: "/maps/test.png",
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        playCast: vi.fn(),
        handleAreaSpellCancel: vi.fn(),
        clearReadyCast: vi.fn().mockResolvedValue(undefined),
        setConcentrationOnTokenFn,
        consumeAreaSpellSlot: vi.fn().mockResolvedValue(null),
        createIllusionToken,
        persistAreaEffect,
      }),
    );

    let handled = false;
    await act(async () => {
      handled = await result.current.handleNonCombatAreaSpell({
        areaSpellMode: {
          freecast: true,
          ritualCast: false,
          illusionImageUrl: undefined,
          illusionDesc: undefined,
          illusionDisplayName: undefined,
        },
        // Minor Illusion-like fixture: cantrip, no damage/healing/attack/
        // control, has illusion metadata, has a lasting duration. No
        // zoneEffects, no structured zone-control phase.
        spell: {
          id: "minor_illusion",
          name: "次级幻影",
          school: "illusion",
          duration: "1 分钟",
          concentration: false,
          illusion: { types: ["visual", "auditory"] },
        } as any,
        slotLevel: 0,
        sourceToken: {
          id: 11,
          character_id: 18,
          instance_name: "施法者",
        } as any,
        sourceTokenId: 11,
        shapeType: "cube",
        centerPos: { x: 5, y: 5 },
        originPos: null,
        effectiveCenterPos: { x: 5, y: 5 },
        followCaster: false,
        sizeFeet: 5,
        direction: 0,
        finalTargets: [],
      });
    });

    expect(handled).toBe(true);
    // Non-concentration illusion → no concentration set, but persist a
    // spell_area_* trace so the cast leaves a DB record.
    expect(setConcentrationOnTokenFn).not.toHaveBeenCalled();
    expect(persistAreaEffect).toHaveBeenCalledWith(expect.objectContaining({
      sourceTokenId: 11,
      spell: expect.objectContaining({ id: "minor_illusion" }),
      shapeType: "cube",
      position: { x: 5, y: 5 },
      sizeFeet: 5,
    }));
    // No user-supplied illusion image → don't spawn an illusion token.
    expect(createIllusionToken).not.toHaveBeenCalled();
  });

  it("keeps zone condition spells on the lasting area path even when targets are already inside", async () => {
    const persistAreaEffect = vi.fn().mockResolvedValue(undefined);
    const setConcentrationOnTokenFn = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useMapAreaSpellNonCombatController({
        currentMapUrl: "/maps/test.png",
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        playCast: vi.fn(),
        handleAreaSpellCancel: vi.fn(),
        clearReadyCast: vi.fn().mockResolvedValue(undefined),
        setConcentrationOnTokenFn,
        consumeAreaSpellSlot: vi.fn().mockResolvedValue(null),
        createIllusionToken: vi.fn().mockResolvedValue(null),
        persistAreaEffect,
      }),
    );

    let greaseHandled = false;
    let webHandled = false;
    await act(async () => {
      greaseHandled = await result.current.handleNonCombatAreaSpell({
        areaSpellMode: {
          freecast: true,
          ritualCast: false,
          illusionImageUrl: undefined,
          illusionDesc: undefined,
          illusionDisplayName: undefined,
        },
        spell: {
          id: "grease",
          name: "油腻术",
          duration: "1分钟",
          concentration: false,
          zoneEffects: { color: "oil" },
          controlEffect: { effectType: "zone", condition: "prone" },
          effects: [
            {
              trigger: "on_enter_zone",
              target: { type: "all_in_area" },
              effects: [{ type: "apply_condition", condition: "prone" }],
            },
          ],
        } as any,
        slotLevel: 1,
        sourceToken: {
          id: 11,
          character_id: 18,
          instance_name: "法师",
        } as any,
        sourceTokenId: 11,
        shapeType: "cube",
        centerPos: { x: 8, y: 8 },
        originPos: null,
        effectiveCenterPos: { x: 8, y: 8 },
        followCaster: false,
        sizeFeet: 10,
        direction: 0,
        finalTargets: [{ id: 99 }] as any,
      });

      webHandled = await result.current.handleNonCombatAreaSpell({
        areaSpellMode: {
          freecast: true,
          ritualCast: false,
          illusionImageUrl: undefined,
          illusionDesc: undefined,
          illusionDisplayName: undefined,
        },
        spell: {
          id: "web",
          name: "蛛网术",
          duration: "1小时",
          concentration: true,
          zoneEffects: { color: "web" },
          controlEffect: { effectType: "zone", condition: "restrained" },
          effects: [
            {
              trigger: "on_enter_zone",
              target: { type: "all_in_area" },
              effects: [{ type: "apply_condition", condition: "restrained" }],
            },
          ],
        } as any,
        slotLevel: 2,
        sourceToken: {
          id: 11,
          character_id: 18,
          instance_name: "法师",
        } as any,
        sourceTokenId: 11,
        shapeType: "cube",
        centerPos: { x: 12, y: 12 },
        originPos: null,
        effectiveCenterPos: { x: 12, y: 12 },
        followCaster: false,
        sizeFeet: 20,
        direction: 0,
        finalTargets: [{ id: 100 }] as any,
      });
    });

    expect(greaseHandled).toBe(true);
    expect(webHandled).toBe(true);
    expect(persistAreaEffect).toHaveBeenCalledWith(expect.objectContaining({
      spell: expect.objectContaining({ id: "grease" }),
      position: { x: 8, y: 8 },
    }));
    expect(setConcentrationOnTokenFn).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ id: "web" }),
      2,
      undefined,
      undefined,
      [],
      expect.objectContaining({
        center_x: 12,
        center_y: 12,
        shape: "cube",
      }),
    );
  });

  // Chrome QA 2026-05-28: Alarm started `casting_in_progress` with no
  // area_effect because the long-cast short-circuit fired before the area
  // placement step. After the fix, the area placement runs first and only
  // then /api/spells/start-cast is called, carrying the chosen area_effect.
  it("ritual area placement calls start-cast with area_effect and does NOT persist a lasting area", async () => {
    startSpellCastViaAPIMock.mockResolvedValue({ success: true });
    const persistAreaEffect = vi.fn().mockResolvedValue(undefined);
    const consumeAreaSpellSlot = vi.fn().mockResolvedValue(null);
    const setConcentrationOnTokenFn = vi.fn().mockResolvedValue(undefined);
    const handleAreaSpellCancel = vi.fn();
    const sendMessage = vi.fn();
    const playCast = vi.fn();
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useMapAreaSpellNonCombatController({
        currentMapUrl: "/maps/test.png",
        showToast,
        sendMessage,
        playCast,
        handleAreaSpellCancel,
        clearReadyCast: vi.fn().mockResolvedValue(undefined),
        setConcentrationOnTokenFn,
        consumeAreaSpellSlot,
        createIllusionToken: vi.fn().mockResolvedValue(null),
        persistAreaEffect,
      }),
    );

    let handled = false;
    await act(async () => {
      handled = await result.current.handleNonCombatAreaSpell({
        areaSpellMode: {
          freecast: false,
          ritualCast: true,
          illusionImageUrl: undefined,
          illusionDesc: undefined,
          illusionDisplayName: undefined,
          longCast: true,
          confirmBreakConcentration: true,
        },
        campaignId: "8",
        spell: {
          id: "alarm",
          name: "警报术",
          duration: "8 小时",
          ritual: true,
          areaOfEffect: { type: "cube", size: 20 },
        } as any,
        slotLevel: 1,
        sourceToken: {
          id: 527,
          character_id: 50,
          instance_name: "qa_all_spells_caster",
        } as any,
        sourceTokenId: 527,
        shapeType: "cube",
        centerPos: { x: 36, y: 40 },
        originPos: null,
        effectiveCenterPos: { x: 36, y: 40 },
        followCaster: false,
        sizeFeet: 20,
        direction: 0,
        finalTargets: [],
      });
    });

    expect(handled).toBe(true);
    expect(startSpellCastViaAPIMock).toHaveBeenCalledWith(
      "alarm",
      1,
      527,
      "8",
      undefined,
      expect.objectContaining({
        freecast: false,
        ritualCast: true,
        confirmBreakConcentration: true,
        areaEffect: expect.objectContaining({
          shape: "cube",
          center_x: 36,
          center_y: 40,
          radius: 20,
          map_url: "/maps/test.png",
        }),
      }),
    );
    // No slot consumption, no lasting area persistence at start-cast time.
    expect(consumeAreaSpellSlot).not.toHaveBeenCalled();
    expect(persistAreaEffect).not.toHaveBeenCalled();
    expect(setConcentrationOnTokenFn).not.toHaveBeenCalled();
    expect(handleAreaSpellCancel).toHaveBeenCalled();
  });
});
