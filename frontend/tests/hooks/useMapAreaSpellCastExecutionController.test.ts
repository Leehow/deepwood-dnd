import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapAreaSpellCastExecutionController } from "../../app/components/map/hooks/useMapAreaSpellCastExecutionController";
import type { AreaSpellModeState } from "../../app/components/map/hooks/useMapAreaSpellController";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

const prepareAreaSpellCombatMock = vi.fn();
const castSpellViaAPIMock = vi.fn();
const syncCharacterSpellSlotsFromBackendMock = vi.fn();
const formatSpellChatMessageMock = vi.fn(() => "chat");
const buildSpellCastDataMock = vi.fn(() => ({}));
const publishAppEventMock = vi.fn();

vi.mock("../../app/components/map/utils/mapAreaSpellCombatPreparation", () => ({
  prepareAreaSpellCombat: (...args: any[]) => prepareAreaSpellCombatMock(...args),
}));

vi.mock("../../app/utils/sidebarCasting", () => ({
  castSpellViaAPI: (...args: any[]) => (castSpellViaAPIMock as any)(...args),
  syncCharacterSpellSlotsFromBackend: (...args: any[]) =>
    (syncCharacterSpellSlotsFromBackendMock as any)(...args),
  formatSpellChatMessage: (...args: any[]) => (formatSpellChatMessageMock as any)(...args),
  buildSpellCastData: (...args: any[]) => (buildSpellCastDataMock as any)(...args),
}));

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
}));

function createToken(overrides: Partial<Token>): Token {
  return {
    id: 1,
    campaign_id: 1,
    map_url: "/maps/test-map.png",
    position_x: 0,
    position_y: 0,
    token_size: "1x1",
    ...overrides,
  } as Token;
}

function createAreaSpellMode(overrides: Partial<AreaSpellModeState> = {}): AreaSpellModeState {
  return {
    active: true,
    spell: {
      id: "fireball",
      name: "火球术",
      level: 3,
      school: "evocation",
      damageType: "fire",
      areaOfEffect: { type: "sphere", size: 20 },
    } as any,
    slotLevel: 3,
    sourceTokenId: 1,
    shapeType: "sphere",
    centerPos: { x: 8, y: 8 },
    previewPos: { x: 8, y: 8 },
    originPos: null,
    direction: 0,
    aimed: true,
    isSelfRange: false,
    placingOrigin: false,
    ...overrides,
  };
}

describe("useMapAreaSpellCastExecutionController", () => {
  beforeEach(() => {
    prepareAreaSpellCombatMock.mockReset();
    castSpellViaAPIMock.mockReset();
    syncCharacterSpellSlotsFromBackendMock.mockReset();
    publishAppEventMock.mockReset();
    formatSpellChatMessageMock.mockClear();
    buildSpellCastDataMock.mockClear();
  });

  it("short-circuits non-combat area spells before combat preparation", async () => {
    const handleNonCombatAreaSpell = vi.fn().mockResolvedValue(true);
    const dispatchAreaSpellCombat = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() =>
      useMapAreaSpellCastExecutionController({
        areaSpellMode: createAreaSpellMode(),
        tokens: [createToken({ id: 1, character_id: 18, instance_name: "法师" })],
        sourceCharacterData: { spell_slots_state: { "3": { current: 2, max: 3 } } },
        campaignId: "7",
        currentMapUrl: "/maps/test.png",
        authedFetch: vi.fn() as any,
        showToast: vi.fn(),
        getTokensInArea: vi.fn(() => []),
        tokenStatusEffects: {},
        getSpellBuffEffects: vi.fn(() => ({ acBonus: 0, resistances: [], immunities: [] })),
        handleAreaSpellCancel: vi.fn(),
        handleNonCombatAreaSpell,
        dispatchAreaSpellCombat,
        isCloakOfShadowsEffect: vi.fn(() => false),
        isDestructiveWrathPendingEffect: vi.fn(() => false),
        isDestructiveWrathEligibleDamageType: vi.fn(() => false),
        getSpellEffectMapping: vi.fn(() => undefined),
      }),
    );

    await act(async () => {
      await result.current.handleAreaSpellCast();
    });

    expect(handleNonCombatAreaSpell).toHaveBeenCalled();
    expect(prepareAreaSpellCombatMock).not.toHaveBeenCalled();
    expect(dispatchAreaSpellCombat).not.toHaveBeenCalled();
  });

  it("warns and cancels when no valid targets remain", async () => {
    const showToast = vi.fn();
    const handleAreaSpellCancel = vi.fn();

    const { result } = renderHook(() =>
      useMapAreaSpellCastExecutionController({
        areaSpellMode: createAreaSpellMode(),
        tokens: [createToken({ id: 1, character_id: 18, instance_name: "法师" })],
        sourceCharacterData: null,
        campaignId: "7",
        currentMapUrl: "/maps/test.png",
        authedFetch: vi.fn() as any,
        showToast,
        getTokensInArea: vi.fn(() => [createToken({ id: 1 })]),
        tokenStatusEffects: {},
        getSpellBuffEffects: vi.fn(() => ({ acBonus: 0, resistances: [], immunities: [] })),
        handleAreaSpellCancel,
        handleNonCombatAreaSpell: vi.fn().mockResolvedValue(false),
        dispatchAreaSpellCombat: vi.fn().mockResolvedValue(true),
        isCloakOfShadowsEffect: vi.fn(() => false),
        isDestructiveWrathPendingEffect: vi.fn(() => false),
        isDestructiveWrathEligibleDamageType: vi.fn(() => false),
        getSpellEffectMapping: vi.fn(() => undefined),
      }),
    );

    await act(async () => {
      await result.current.handleAreaSpellCast();
    });

    expect(showToast).toHaveBeenCalledWith("范围内没有目标", "warning");
    expect(handleAreaSpellCancel).toHaveBeenCalled();
    expect(prepareAreaSpellCombatMock).not.toHaveBeenCalled();
  });

  // Lead review gap (spell-move-effect-empty-target-v1): granted move_effect
  // area actions (Moonbeam / Flaming Sphere relocation) reposition an existing
  // area and must be allowed to cast on an empty cell. The backend accepts
  // empty targets for move_effect, so the frontend must skip the
  // "范围内没有目标" warning and continue to the combat dispatch path.
  describe("granted move_effect empty-target casting", () => {
    function moveEffectMode(spellOverrides: Record<string, any> = {}): AreaSpellModeState {
      return createAreaSpellMode({
        spell: {
          id: "granted_moonbeam_move_effect",
          name: "月华束",
          level: 0,
          school: "evocation",
          areaOfEffect: { type: "sphere", size: 5 },
          ...spellOverrides,
        } as any,
      });
    }

    it("skips the zero-target warning and dispatches when id ends in _move_effect", async () => {
      prepareAreaSpellCombatMock.mockResolvedValue({
        areaSpellRequest: { spell: { id: "granted_moonbeam_move_effect" } },
        casterData: { name: "牧师" },
        cloakOfShadowsActive: false,
        maximizeDamage: false,
      });
      const showToast = vi.fn();
      const handleAreaSpellCancel = vi.fn();
      const dispatchAreaSpellCombat = vi.fn().mockResolvedValue(true);

      const { result } = renderHook(() =>
        useMapAreaSpellCastExecutionController({
          areaSpellMode: moveEffectMode(),
          tokens: [createToken({ id: 1, character_id: 18, instance_name: "牧师" })],
          sourceCharacterData: { spell_slots_state: {} },
          campaignId: "7",
          currentMapUrl: "/maps/test.png",
          authedFetch: vi.fn() as any,
          showToast,
          getTokensInArea: vi.fn(() => []),
          tokenStatusEffects: {},
          getSpellBuffEffects: vi.fn(() => ({ acBonus: 0, resistances: [], immunities: [] })),
          handleAreaSpellCancel,
          handleNonCombatAreaSpell: vi.fn().mockResolvedValue(false),
          dispatchAreaSpellCombat,
          isCloakOfShadowsEffect: vi.fn(() => false),
          isDestructiveWrathPendingEffect: vi.fn(() => false),
          isDestructiveWrathEligibleDamageType: vi.fn(() => false),
          getSpellEffectMapping: vi.fn(() => undefined),
        }),
      );

      await act(async () => {
        await result.current.handleAreaSpellCast();
      });

      expect(showToast).not.toHaveBeenCalledWith("范围内没有目标", "warning");
      expect(handleAreaSpellCancel).not.toHaveBeenCalled();
      expect(prepareAreaSpellCombatMock).toHaveBeenCalledWith(expect.objectContaining({
        finalTargets: [],
      }));
      expect(dispatchAreaSpellCombat).toHaveBeenCalledWith(expect.objectContaining({
        finalTargets: [],
      }));
    });

    it("skips the zero-target warning via __activeEffectGrantAction metadata", async () => {
      prepareAreaSpellCombatMock.mockResolvedValue({
        areaSpellRequest: { spell: { id: "flaming_sphere" } },
        casterData: { name: "法师" },
        cloakOfShadowsActive: false,
        maximizeDamage: false,
      });
      const showToast = vi.fn();
      const handleAreaSpellCancel = vi.fn();
      const dispatchAreaSpellCombat = vi.fn().mockResolvedValue(true);

      const { result } = renderHook(() =>
        useMapAreaSpellCastExecutionController({
          // Non-granted id, but grant metadata flags it as move_effect.
          areaSpellMode: moveEffectMode({
            id: "flaming_sphere",
            __activeEffectGrantAction: { actionKind: "move_effect" },
          }),
          tokens: [createToken({ id: 1, character_id: 18, instance_name: "法师" })],
          sourceCharacterData: { spell_slots_state: {} },
          campaignId: "7",
          currentMapUrl: "/maps/test.png",
          authedFetch: vi.fn() as any,
          showToast,
          getTokensInArea: vi.fn(() => []),
          tokenStatusEffects: {},
          getSpellBuffEffects: vi.fn(() => ({ acBonus: 0, resistances: [], immunities: [] })),
          handleAreaSpellCancel,
          handleNonCombatAreaSpell: vi.fn().mockResolvedValue(false),
          dispatchAreaSpellCombat,
          isCloakOfShadowsEffect: vi.fn(() => false),
          isDestructiveWrathPendingEffect: vi.fn(() => false),
          isDestructiveWrathEligibleDamageType: vi.fn(() => false),
          getSpellEffectMapping: vi.fn(() => undefined),
        }),
      );

      await act(async () => {
        await result.current.handleAreaSpellCast();
      });

      expect(showToast).not.toHaveBeenCalledWith("范围内没有目标", "warning");
      expect(handleAreaSpellCancel).not.toHaveBeenCalled();
      expect(dispatchAreaSpellCombat).toHaveBeenCalledWith(expect.objectContaining({
        finalTargets: [],
      }));
    });
  });

  it("prepares combat payloads and dispatches the combat path", async () => {
    prepareAreaSpellCombatMock.mockResolvedValue({
      areaSpellRequest: { spell: { id: "fireball" } },
      casterData: { name: "法师" },
      cloakOfShadowsActive: true,
      maximizeDamage: false,
    });
    const dispatchAreaSpellCombat = vi.fn().mockResolvedValue(true);
    const getSpellEffectMapping = vi.fn(() => ({ effectId: "burning", duration: 2 }));
    const sourceToken = createToken({ id: 1, character_id: 18, instance_name: "法师" });
    const targetToken = createToken({ id: 2, instance_name: "骷髅", position_x: 2, position_y: 2 });

    const { result } = renderHook(() =>
      useMapAreaSpellCastExecutionController({
        areaSpellMode: createAreaSpellMode(),
        tokens: [sourceToken, targetToken],
        sourceCharacterData: { spell_slots_state: { "3": { current: 2, max: 3 } } },
        campaignId: "7",
        currentMapUrl: "/maps/test.png",
        authedFetch: vi.fn() as any,
        showToast: vi.fn(),
        getTokensInArea: vi.fn(() => [sourceToken, targetToken]),
        tokenStatusEffects: { 1: [{ id: "cloak" }] },
        getSpellBuffEffects: vi.fn(() => ({ acBonus: 0, resistances: [], immunities: [] })),
        handleAreaSpellCancel: vi.fn(),
        handleNonCombatAreaSpell: vi.fn().mockResolvedValue(false),
        dispatchAreaSpellCombat,
        isCloakOfShadowsEffect: vi.fn((effect) => effect.id === "cloak"),
        isDestructiveWrathPendingEffect: vi.fn(() => false),
        isDestructiveWrathEligibleDamageType: vi.fn(() => false),
        getSpellEffectMapping,
      }),
    );

    await act(async () => {
      await result.current.handleAreaSpellCast();
    });

    expect(prepareAreaSpellCombatMock).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: "7",
      sourceTokenId: 1,
      finalTargets: [targetToken],
    }));
    expect(dispatchAreaSpellCombat).toHaveBeenCalledWith(expect.objectContaining({
      areaSpellRequest: { spell: { id: "fireball" } },
      sourceToken,
      finalTargets: [targetToken],
      spellEffectMapping: { effectId: "burning", duration: 2 },
      cloakOfShadowsActive: true,
    }));
    expect(getSpellEffectMapping).toHaveBeenCalledWith("fireball");
  });

  // Chrome QA 2026-05-28: Misty Step uses the area picker as a destination
  // picker. The controller must call /api/spells/cast with a typed
  // `teleport_destination` (caster token id used as the synthetic target)
  // and skip the combat preparation path entirely.
  describe("teleport destination picker", () => {
    function teleportMode(overrides: Partial<AreaSpellModeState> = {}): AreaSpellModeState {
      return {
        active: true,
        spell: {
          id: "misty_step",
          name: "迷踪步",
          level: 2,
          range: "30 尺",
          areaOfEffect: { type: "sphere", size: 5 },
          __teleportDestination: true,
          __teleportRange: 30,
        } as any,
        slotLevel: 2,
        sourceTokenId: 1,
        shapeType: "sphere",
        centerPos: { x: 6, y: 4 },
        previewPos: { x: 6, y: 4 },
        originPos: null,
        direction: 0,
        aimed: true,
        isSelfRange: false,
        placingOrigin: false,
        ...overrides,
      };
    }

    it("calls /api/spells/cast with teleport_destination and skips combat path", async () => {
      castSpellViaAPIMock.mockResolvedValue({ success: true });
      const dispatchAreaSpellCombat = vi.fn();
      const handleAreaSpellCancel = vi.fn();
      const handleNonCombatAreaSpell = vi.fn();

      const { result } = renderHook(() =>
        useMapAreaSpellCastExecutionController({
          areaSpellMode: teleportMode(),
          tokens: [{ id: 1, character_id: 18, instance_name: "法师", position_x: 0, position_y: 0, token_size: "1x1" } as any],
          sourceCharacterData: null,
          campaignId: "7",
          currentMapUrl: "/maps/test.png",
          authedFetch: vi.fn() as any,
          showToast: vi.fn(),
          getTokensInArea: vi.fn(() => []),
          tokenStatusEffects: {},
          getSpellBuffEffects: vi.fn(() => ({ acBonus: 0, resistances: [], immunities: [] })),
          handleAreaSpellCancel,
          handleNonCombatAreaSpell,
          dispatchAreaSpellCombat,
          isCloakOfShadowsEffect: vi.fn(() => false),
          isDestructiveWrathPendingEffect: vi.fn(() => false),
          isDestructiveWrathEligibleDamageType: vi.fn(() => false),
          getSpellEffectMapping: vi.fn(() => undefined),
        }),
      );

      await act(async () => {
        await result.current.handleAreaSpellCast();
      });

      expect(castSpellViaAPIMock).toHaveBeenCalled();
      const args = castSpellViaAPIMock.mock.calls[0];
      // (spellId, slot, casterTokenId, targets, campaignId, userId, freecast, ritual, opt, mat, illusion, autoFail, teleportDest)
      expect(args[0]).toBe("misty_step");
      expect(args[2]).toBe(1);
      expect(args[3]).toEqual([1]);
      expect(args[12]).toEqual({ x: 6, y: 4 });
      expect(handleNonCombatAreaSpell).not.toHaveBeenCalled();
      expect(dispatchAreaSpellCombat).not.toHaveBeenCalled();
      expect(handleAreaSpellCancel).toHaveBeenCalled();
      expect(publishAppEventMock).toHaveBeenCalledWith("spellCastChat", expect.objectContaining({
        message: "chat",
      }));
      expect(syncCharacterSpellSlotsFromBackendMock).toHaveBeenCalledWith(18, expect.objectContaining({ delayMs: 50 }));
    });

    it("rejects occupied destination cells and does NOT call the API", async () => {
      const showToast = vi.fn();
      const handleAreaSpellCancel = vi.fn();
      const occupant = { id: 2, instance_name: "战士", position_x: 6, position_y: 4, token_size: "1x1" } as any;
      const caster = { id: 1, character_id: 18, instance_name: "法师", position_x: 0, position_y: 0, token_size: "1x1" } as any;

      const { result } = renderHook(() =>
        useMapAreaSpellCastExecutionController({
          areaSpellMode: teleportMode(),
          tokens: [caster, occupant],
          sourceCharacterData: null,
          campaignId: "7",
          currentMapUrl: "/maps/test.png",
          authedFetch: vi.fn() as any,
          showToast,
          getTokensInArea: vi.fn(() => []),
          tokenStatusEffects: {},
          getSpellBuffEffects: vi.fn(() => ({ acBonus: 0, resistances: [], immunities: [] })),
          handleAreaSpellCancel,
          handleNonCombatAreaSpell: vi.fn(),
          dispatchAreaSpellCombat: vi.fn(),
          isCloakOfShadowsEffect: vi.fn(() => false),
          isDestructiveWrathPendingEffect: vi.fn(() => false),
          isDestructiveWrathEligibleDamageType: vi.fn(() => false),
          getSpellEffectMapping: vi.fn(() => undefined),
        }),
      );

      await act(async () => {
        await result.current.handleAreaSpellCast();
      });

      expect(castSpellViaAPIMock).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith("目标位置已被占据", "error");
      // Picker stays open so the user can pick another cell.
      expect(handleAreaSpellCancel).not.toHaveBeenCalled();
    });
  });
});
