import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { publishAppEvent } from "../../app/events/appEventBus";
import type { Position, Token } from "../../app/components/map/types/TacticalMapTypes";
import { useMapCombatOverlays } from "../../app/components/map/hooks/useMapCombatOverlays";

function createToken(overrides: Partial<Token>): Token {
  return {
    id: 1,
    campaign_id: 1,
    map_url: "map://default",
    position_x: 0,
    position_y: 0,
    token_size: "1x1",
    ...overrides,
  } as Token;
}

function createContainer() {
  const element = document.createElement("div");
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    top: 0,
    right: 800,
    bottom: 600,
    left: 0,
    toJSON: () => ({}),
  });
  document.body.appendChild(element);
  return element;
}

describe("useMapCombatOverlays", () => {
  it("derives movement overlay cells from combat globals for the active player turn", async () => {
    const container = createContainer();
    const showToast = vi.fn();

    (window as any).__combatIsActive = true;
    (window as any).__combatActiveTokenId = 11;
    (window as any).__combatTurnUserId = "u1";
    (window as any).__combatMovementRemaining = 30;

    const { result, unmount } = renderHook(() =>
      useMapCombatOverlays({
        isDM: false,
        userId: "u1",
        selectedTokenId: null,
        selectionContextMenuOpen: false,
        tokens: [
          createToken({
            id: 11,
            user_id: "u1",
            position_x: 4,
            position_y: 4,
          }),
        ],
        gridUnitLength: 5,
        containerRef: { current: container },
        stagePosRef: { current: { x: 0, y: 0 } as Position },
        stageScaleRef: { current: 1 },
        showToast,
      }),
    );

    await waitFor(() => {
      expect(result.current.movementOverlayCells?.length).toBeGreaterThan(0);
    });

    (window as any).__combatMovementRemaining = 10;
    act(() => {
      publishAppEvent("combatMovementChanged", { changedBy: "test" });
    });

    await waitFor(() => {
      expect(result.current.movementOverlayCells?.length).toBeGreaterThan(0);
    });

    unmount();
    container.remove();
    delete (window as any).__combatIsActive;
    delete (window as any).__combatActiveTokenId;
    delete (window as any).__combatTurnUserId;
    delete (window as any).__combatMovementRemaining;
  });

  it("bridges attack distance and monster targeting events, then clears targeting on escape", async () => {
    const container = createContainer();
    const showToast = vi.fn();

    const { result, rerender, unmount } = renderHook(
      ({ selectionContextMenuOpen }) =>
        useMapCombatOverlays({
          isDM: true,
          userId: "dm",
          selectedTokenId: 21,
          selectionContextMenuOpen,
          tokens: [
            createToken({
              id: 21,
              instance_name: "Ogre",
              position_x: 1,
              position_y: 1,
            }),
          ],
          gridUnitLength: 5,
          containerRef: { current: container },
          stagePosRef: { current: { x: 0, y: 0 } as Position },
          stageScaleRef: { current: 1 },
          showToast,
        }),
      { initialProps: { selectionContextMenuOpen: true } },
    );

    act(() => {
      publishAppEvent("attackDistanceLine", {
        normalRange: 30,
        maxRange: 120,
        sourceTokenId: 21,
      });
    });

    expect(result.current.attackDistanceLine).toEqual({
      normalRange: 30,
      maxRange: 120,
      sourceTokenId: 21,
    });

    rerender({ selectionContextMenuOpen: false });
    expect(result.current.attackDistanceLine).toBeNull();

    act(() => {
      publishAppEvent("monsterActionTargeting", {
        action: {
          name: "Smash",
          description: "Heavy melee hit",
          type: "action",
          range: "10尺",
          attack_bonus: 7,
          damage: { dice: "2d8", bonus: 4, type: "bludgeoning" },
        },
        sourceTokenId: 21,
        normalRange: 5,
        maxRange: 10,
      });
    });

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        "Ogre → Smash：点击目标 token（ESC 取消）",
        "info",
        5000,
      );
      expect(result.current.monsterActionTargeting).toEqual({
        action: {
          name: "Smash",
          description: "Heavy melee hit",
          type: "action",
          range: "10尺",
          attack_bonus: 7,
          damage: { dice: "2d8", bonus: 4, type: "bludgeoning" },
        },
        sourceTokenId: 21,
        normalRange: 5,
        maxRange: 10,
      });
    });

    act(() => {
      container.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 120, clientY: 80, bubbles: true }),
      );
    });

    await waitFor(() => {
      expect(result.current.monsterActionCursorInfo).toEqual(
        expect.objectContaining({ x: 120, y: 80, gridX: 3, gridY: 2 }),
      );
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    await waitFor(() => {
      expect(result.current.monsterActionTargeting).toBeNull();
    });

    unmount();
    container.remove();
  });
});
