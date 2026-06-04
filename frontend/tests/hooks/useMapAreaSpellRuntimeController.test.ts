import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { publishAppEvent } from "../../app/events/appEventBus";
import { useMapAreaSpellRuntimeController } from "../../app/components/map/hooks/useMapAreaSpellRuntimeController";
import type { AreaSpellModeState } from "../../app/components/map/hooks/useMapAreaSpellController";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

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

describe("useMapAreaSpellRuntimeController", () => {
  it("turns breath weapon events into area spell selection", () => {
    const handleAreaSpellSelect = vi.fn();

    renderHook(() =>
      useMapAreaSpellRuntimeController({
        areaSpellMode: null,
        setAreaSpellMode: vi.fn(),
        tokens: [createToken({ id: 7, character_id: 99 })],
        containerRef: { current: null },
        stagePosRef: { current: { x: 0, y: 0 } },
        stageScaleRef: { current: 1 },
        showToast: vi.fn(),
        handleAreaSpellSelect,
        handleAreaSpellMouseMove: vi.fn(),
        handleTouchMoveForContextMenu: vi.fn(),
        snapAreaSpellPos: vi.fn((x, y) => ({ x, y })),
      }),
    );

    act(() => {
      publishAppEvent("startBreathWeapon", {
        sourceCharacterId: 99,
        breathWeapon: {
          shape: "line",
          size: "30尺",
          save: "dexterity",
          saveCn: "敏捷",
          shapeCn: "线状",
        },
        damageType: "lightning",
        damageTypeCn: "闪电",
        damageDice: "4d6",
        subraceName: "blue",
        saveDC: 15,
      });
    });

    expect(handleAreaSpellSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "吐息武器（闪电）",
        attackType: "save",
        range: "自身",
        areaOfEffect: { type: "line", size: 30 },
      }),
      7,
      0,
    );
  });

  it("turns monster area action events into area spell selection", () => {
    const handleAreaSpellSelect = vi.fn();

    renderHook(() =>
      useMapAreaSpellRuntimeController({
        areaSpellMode: null,
        setAreaSpellMode: vi.fn(),
        tokens: [createToken({ id: 10, monster_instance_id: 88 })],
        containerRef: { current: null },
        stagePosRef: { current: { x: 0, y: 0 } },
        stageScaleRef: { current: 1 },
        showToast: vi.fn(),
        handleAreaSpellSelect,
        handleAreaSpellMouseMove: vi.fn(),
        handleTouchMoveForContextMenu: vi.fn(),
        snapAreaSpellPos: vi.fn((x, y) => ({ x, y })),
      }),
    );

    act(() => {
      publishAppEvent("startMonsterAreaAction", {
        sourceTokenId: 10,
        actionName: "火焰吐息",
        breathWeapon: {
          shape: "cone",
          size: "60尺",
          save: "dexterity",
          saveCn: "敏捷",
          shapeCn: "锥",
        },
        damageType: "fire",
        damageTypeCn: "火焰",
        damageDice: "12d8",
        saveDC: 21,
        saveEffect: "half",
      });
    });

    expect(handleAreaSpellSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "火焰吐息",
        attackType: "save",
        areaOfEffect: { type: "cone", size: 60 },
      }),
      10,
      0,
    );
  });

  it("snaps touch-move center updates for non-directional area spells", () => {
    const areaSpellMode: AreaSpellModeState = {
      active: true,
      spell: {
        id: "fireball",
        name: "火球术",
        level: 3,
        school: "evocation",
        areaOfEffect: { type: "sphere", size: 20 },
      } as any,
      slotLevel: 3,
      sourceTokenId: 1,
      shapeType: "sphere",
      centerPos: { x: 3, y: 3 },
      previewPos: { x: 3, y: 3 },
      originPos: null,
      direction: 0,
      aimed: false,
      isSelfRange: false,
      placingOrigin: false,
    };
    const setAreaSpellMode = vi.fn();
    const snapAreaSpellPos = vi.fn(() => ({ x: 4, y: 5 }));

    const { result } = renderHook(() =>
      useMapAreaSpellRuntimeController({
        areaSpellMode,
        setAreaSpellMode,
        tokens: [],
        containerRef: {
          current: {
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
          } as any,
        },
        stagePosRef: { current: { x: 0, y: 0 } },
        stageScaleRef: { current: 1 },
        showToast: vi.fn(),
        handleAreaSpellSelect: vi.fn(),
        handleAreaSpellMouseMove: vi.fn(),
        handleTouchMoveForContextMenu: vi.fn(),
        snapAreaSpellPos,
      }),
    );

    act(() => {
      result.current.handleMapTouchMove({
        touches: [{ clientX: 80, clientY: 100 }],
      } as any);
    });

    expect(snapAreaSpellPos).toHaveBeenCalledWith(2, 2.5, "sphere", 20);
    expect(setAreaSpellMode).toHaveBeenCalledWith(expect.any(Function));
    const updater = setAreaSpellMode.mock.calls[0][0];
    expect(updater(areaSpellMode)).toMatchObject({
      centerPos: { x: 4, y: 5 },
      previewPos: { x: 4, y: 5 },
    });
  });

  it("forwards directional touch movement to area spell aiming", () => {
    const handleAreaSpellMouseMove = vi.fn();
    const handleTouchMoveForContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapAreaSpellRuntimeController({
        areaSpellMode: {
          active: true,
          spell: {
            id: "burning-hands",
            name: "燃烧之手",
            level: 1,
            school: "evocation",
            areaOfEffect: { type: "cone", size: 15 },
          } as any,
          slotLevel: 1,
          sourceTokenId: 1,
          shapeType: "cone",
          centerPos: null,
          previewPos: null,
          originPos: { x: 2, y: 2 },
          direction: 0,
          aimed: false,
          isSelfRange: true,
          placingOrigin: false,
        },
        setAreaSpellMode: vi.fn(),
        tokens: [],
        containerRef: {
          current: {
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
          } as any,
        },
        stagePosRef: { current: { x: 0, y: 0 } },
        stageScaleRef: { current: 1 },
        showToast: vi.fn(),
        handleAreaSpellSelect: vi.fn(),
        handleAreaSpellMouseMove,
        handleTouchMoveForContextMenu,
        snapAreaSpellPos: vi.fn((x, y) => ({ x, y })),
      }),
    );

    act(() => {
      result.current.handleMapTouchMove({
        touches: [{ clientX: 120, clientY: 80 }],
      } as any);
    });

    expect(handleAreaSpellMouseMove).toHaveBeenCalledWith(3, 2);
    expect(handleTouchMoveForContextMenu).not.toHaveBeenCalled();
  });
});
