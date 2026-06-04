import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  useMapAreaSpellController,
  type AreaSpellModeState,
} from "../../app/components/map/hooks/useMapAreaSpellController";
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
  };
}

describe("useMapAreaSpellController", () => {
  it("initializes self-range directional spells from the caster center", () => {
    const sourceToken = createToken({ id: 7, position_x: 4, position_y: 5 });

    const { result } = renderHook(() =>
      {
        const [areaSpellMode, setAreaSpellMode] = useState<AreaSpellModeState | null>(null);
        return useMapAreaSpellController({
          areaSpellMode,
          setAreaSpellMode,
          tokens: [sourceToken],
          sourceCharacterData: null,
          gridUnitLength: 5,
          showToast: vi.fn(),
          getTokensInArea: vi.fn(() => []),
          getBestInvokeDuplicityDistanceToGrid: vi.fn(() => null),
        });
      },
    );

    act(() => {
      result.current.handleAreaSpellSelect(
        {
          id: "burning-hands",
          name: "燃烧之手",
          level: 1,
          school: "evocation",
          range: "自身",
          areaOfEffect: { type: "cone", size: 15 },
        } as any,
        7,
        1,
      );
    });

    expect(result.current.areaSpellMode?.originPos).toEqual({ x: 4.5, y: 5.5 });
    expect(result.current.areaSpellMode?.placingOrigin).toBe(false);
    expect(result.current.isReadyToCast).toBe(false);
  });

  it("places directional spell origin before locking aim", () => {
    const sourceToken = createToken({ id: 9, position_x: 0, position_y: 0 });

    const { result } = renderHook(() => {
      const [areaSpellMode, setAreaSpellMode] = useState<AreaSpellModeState | null>(null);
      return useMapAreaSpellController({
        areaSpellMode,
        setAreaSpellMode,
        tokens: [sourceToken],
        sourceCharacterData: null,
        gridUnitLength: 5,
        showToast: vi.fn(),
        getTokensInArea: vi.fn(() => []),
        getBestInvokeDuplicityDistanceToGrid: vi.fn(() => 10),
      });
    });

    act(() => {
      result.current.handleAreaSpellSelect(
        {
          id: "lightning-breath",
          name: "闪电吐息",
          level: 0,
          school: "evocation",
          range: "30 尺",
          areaOfEffect: { type: "line", size: 30 },
        } as any,
        9,
        0,
      );
    });

    act(() => {
      result.current.handleAreaSpellConfirm(3, 2);
    });

    expect(result.current.areaSpellMode?.originPos).toEqual({ x: 3, y: 2 });
    expect(result.current.areaSpellMode?.placingOrigin).toBe(false);

    act(() => {
      result.current.handleAreaSpellConfirm(6, 2);
    });

    expect(result.current.areaSpellMode?.aimed).toBe(true);
    expect(result.current.isReadyToCast).toBe(true);
  });

  it("auto-aims a non-self line spell after the origin click so the cast button appears immediately", () => {
    // Wind Wall (range = 120 ft, line, no token in the line). Chrome QA
    // 2026-05-28 showed the 施法 button never appeared because the second
    // explicit aim click was required. After origin placement the controller
    // now derives an initial direction from caster → click and sets
    // `aimed: true` so `isReadyToCast` flips to true on the first click.
    const sourceToken = createToken({ id: 21, position_x: 10, position_y: 10, token_size: "1x1" });

    const { result } = renderHook(() => {
      const [areaSpellMode, setAreaSpellMode] = useState<AreaSpellModeState | null>(null);
      return useMapAreaSpellController({
        areaSpellMode,
        setAreaSpellMode,
        tokens: [sourceToken],
        sourceCharacterData: null,
        gridUnitLength: 5,
        showToast: vi.fn(),
        getTokensInArea: vi.fn(() => []),
        getBestInvokeDuplicityDistanceToGrid: vi.fn(() => 30),
      });
    });

    act(() => {
      result.current.handleAreaSpellSelect(
        {
          id: "wind_wall",
          name: "风墙术",
          level: 3,
          school: "evocation",
          range: "120 尺",
          damageType: "bludgeoning",
          areaOfEffect: { type: "line", size: 50 },
        } as any,
        21,
        3,
      );
    });

    expect(result.current.areaSpellMode?.placingOrigin).toBe(true);
    expect(result.current.isReadyToCast).toBe(false);

    act(() => {
      result.current.handleAreaSpellConfirm(15, 10);
    });

    expect(result.current.areaSpellMode?.originPos).toEqual({ x: 15, y: 10 });
    expect(result.current.areaSpellMode?.placingOrigin).toBe(false);
    expect(result.current.areaSpellMode?.aimed).toBe(true);
    // caster center (10.5, 10.5) → click (15, 10): vector is mostly +x, small -y
    expect(result.current.areaSpellMode?.direction).toBeCloseTo(
      (Math.atan2(10 - 10.5, 15 - 10.5) * 180) / Math.PI,
      5,
    );
    expect(result.current.isReadyToCast).toBe(true);

    // A second click should still re-aim the line in the new direction.
    act(() => {
      result.current.handleAreaSpellConfirm(15, 20);
    });
    expect(result.current.areaSpellMode?.direction).toBeCloseTo(
      (Math.atan2(20 - 10, 15 - 15) * 180) / Math.PI,
      5,
    );
  });

  it("seeds non-directional ready release from stored area and is immediately ready", () => {
    // Ready-release path for Alarm (cube). The caster picked the area at
    // ritual start-cast time and the backend stored it on
    // casting_in_progress.area_effect. Releasing must replay that area so the
    // DM doesn't need to re-click the map before 施法.
    const sourceToken = createToken({ id: 7 });

    const { result } = renderHook(() => {
      const [areaSpellMode, setAreaSpellMode] = useState<AreaSpellModeState | null>(null);
      return useMapAreaSpellController({
        areaSpellMode,
        setAreaSpellMode,
        tokens: [sourceToken],
        sourceCharacterData: null,
        gridUnitLength: 5,
        showToast: vi.fn(),
        getTokensInArea: vi.fn(() => []),
        getBestInvokeDuplicityDistanceToGrid: vi.fn(() => null),
      });
    });

    act(() => {
      result.current.handleAreaSpellSelect(
        {
          id: "alarm",
          name: "警报术",
          level: 1,
          school: "abjuration",
          range: "30 尺",
          areaOfEffect: { type: "cube", size: 20 },
        } as any,
        7,
        1,
        true, // freecast (ritual release treats slot as free)
        undefined,
        undefined,
        undefined,
        undefined,
        "component_pouch",
        true, // ritualCast
        undefined,
        undefined,
        {
          shape: "cube",
          center_x: 32,
          center_y: 40,
          radius: 20,
        },
      );
    });

    expect(result.current.areaSpellMode?.centerPos).toEqual({ x: 32, y: 40 });
    expect(result.current.areaSpellMode?.previewPos).toEqual({ x: 32, y: 40 });
    expect(result.current.areaSpellMode?.originPos).toBeNull();
    expect(result.current.areaSpellMode?.placingOrigin).toBe(false);
    expect(result.current.areaSpellMode?.longCast).toBeFalsy();
    expect(result.current.areaSpellMode?.ritualCast).toBe(true);
    expect(result.current.isReadyToCast).toBe(true);
  });

  it("seeds directional ready release from stored origin/direction and is immediately ready", () => {
    const sourceToken = createToken({ id: 11, position_x: 0, position_y: 0 });

    const { result } = renderHook(() => {
      const [areaSpellMode, setAreaSpellMode] = useState<AreaSpellModeState | null>(null);
      return useMapAreaSpellController({
        areaSpellMode,
        setAreaSpellMode,
        tokens: [sourceToken],
        sourceCharacterData: null,
        gridUnitLength: 5,
        showToast: vi.fn(),
        getTokensInArea: vi.fn(() => []),
        getBestInvokeDuplicityDistanceToGrid: vi.fn(() => null),
      });
    });

    act(() => {
      result.current.handleAreaSpellSelect(
        {
          id: "wind_wall",
          name: "风墙术",
          level: 3,
          school: "evocation",
          range: "120 尺",
          damageType: "bludgeoning",
          areaOfEffect: { type: "line", size: 50 },
        } as any,
        11,
        3,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        {
          shape: "line",
          center_x: 4,
          center_y: 6,
          origin_x: 4,
          origin_y: 6,
          direction: 45,
          radius: 50,
        },
      );
    });

    expect(result.current.areaSpellMode?.originPos).toEqual({ x: 4, y: 6 });
    expect(result.current.areaSpellMode?.centerPos).toBeNull();
    expect(result.current.areaSpellMode?.direction).toBe(45);
    expect(result.current.areaSpellMode?.aimed).toBe(true);
    expect(result.current.areaSpellMode?.placingOrigin).toBe(false);
    expect(result.current.isReadyToCast).toBe(true);
  });

  it("computes affected tokens excluding the caster for damage spells", () => {
    const sourceToken = createToken({ id: 1 });
    const targetToken = createToken({ id: 2, position_x: 2, position_y: 2 });

    const { result } = renderHook(() => {
      const [areaSpellMode, setAreaSpellMode] = useState<AreaSpellModeState | null>(null);
      return useMapAreaSpellController({
        areaSpellMode,
        setAreaSpellMode,
        tokens: [sourceToken, targetToken],
        sourceCharacterData: null,
        gridUnitLength: 5,
        showToast: vi.fn(),
        getTokensInArea: vi.fn(() => [sourceToken, targetToken]),
        getBestInvokeDuplicityDistanceToGrid: vi.fn(() => null),
      });
    });

    act(() => {
      result.current.handleAreaSpellSelect(
        {
          id: "fireball",
          name: "火球术",
          level: 3,
          school: "evocation",
          range: "150 尺",
          damageType: "fire",
          areaOfEffect: { type: "sphere", size: 20 },
        } as any,
        1,
        3,
      );
    });

    act(() => {
      result.current.handleAreaSpellConfirm(2, 2);
    });

    expect(Array.from(result.current.areaSpellAffectedTokenIds)).toEqual([2]);
    expect(result.current.areaSpellTargetStroke).toBeTruthy();
  });
});
