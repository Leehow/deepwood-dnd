import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMapTargetingController } from "../../app/components/map/hooks/useMapTargetingController";
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

describe("useMapTargetingController", () => {
  it("tracks hovered tokens and forwards monster-action targeting to the selection handler", () => {
    const handleSelectionMonsterAction = vi.fn();
    const setMonsterActionTargeting = vi.fn();

    const { result } = renderHook(() =>
      useMapTargetingController({
        containerRef: { current: document.createElement("div") },
        stagePosRef: { current: { x: 0, y: 0 } },
        stageScaleRef: { current: 1 },
        tokens: [],
        gridUnitLength: 5,
        hotbarTargeting: null,
        monsterActionTargeting: {
          action: { name: "Claw" },
          sourceTokenId: 7,
        },
        getBestInvokeDuplicityOriginTokenToGrid: vi.fn(),
        getBestInvokeDuplicityOriginTokenToToken: vi.fn(),
        handleSelectionMonsterAction,
        setMonsterActionTargeting,
        onHotbarTargetSelect: vi.fn(),
        onHotbarTargetCancel: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleHoveredTokenEnter(12);
    });
    expect(result.current.hoveredTokenId).toBe(12);

    act(() => {
      result.current.handleHoveredTokenLeave();
    });
    expect(result.current.hoveredTokenId).toBeNull();

    act(() => {
      expect(result.current.handleTargetingTokenSelection(99)).toBe(true);
    });

    expect(handleSelectionMonsterAction).toHaveBeenCalledWith({ name: "Claw" }, 7, 99);
    expect(setMonsterActionTargeting).toHaveBeenCalledWith(null);
  });

  it("computes hotbar cursor info and target metadata for hotbar targeting", () => {
    const container = document.createElement("div");
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      right: 400,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const sourceToken = createToken({
      id: 10,
      character_id: 77,
      position_x: 0,
      position_y: 0,
    });
    const targetToken = createToken({
      id: 22,
      position_x: 3,
      position_y: 0,
      current_hp: 12,
      max_hp: 18,
      monster_type: "beast",
      monster_name: "Wolf",
    });
    const onHotbarTargetSelect = vi.fn();

    const { result } = renderHook(() =>
      useMapTargetingController({
        containerRef: { current: container },
        stagePosRef: { current: { x: 0, y: 0 } },
        stageScaleRef: { current: 1 },
        tokens: [sourceToken, targetToken],
        gridUnitLength: 5,
        hotbarTargeting: {
          sourceCharacterId: 77,
          targetingType: "spell",
        },
        monsterActionTargeting: null,
        getBestInvokeDuplicityOriginTokenToGrid: vi.fn(() => sourceToken),
        getBestInvokeDuplicityOriginTokenToToken: vi.fn(() => sourceToken),
        handleSelectionMonsterAction: vi.fn(),
        setMonsterActionTargeting: vi.fn(),
        onHotbarTargetSelect,
        onHotbarTargetCancel: vi.fn(),
      }),
    );

    act(() => {
      container.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: 120,
          clientY: 40,
          bubbles: true,
        }),
      );
    });

    expect(result.current.hotbarCursorInfo).toEqual({
      x: 120,
      y: 40,
      dist: 15,
      gridX: 3,
      gridY: 1,
      originTokenId: 10,
    });

    act(() => {
      expect(result.current.handleTargetingTokenSelection(22)).toBe(true);
    });

    expect(onHotbarTargetSelect).toHaveBeenCalledWith(22, "Wolf", 15, {
      currentHp: 12,
      maxHp: 18,
      monsterType: "beast",
    });
  });
});
