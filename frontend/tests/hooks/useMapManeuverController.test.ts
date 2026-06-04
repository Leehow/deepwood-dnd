import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useMapManeuverController,
  type PendingManeuverState,
} from "../../app/components/map/hooks/useMapManeuverController";
import type { Maneuver } from "../../app/components/map/SelectionContextMenu";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

const publishAppEventMock = vi.fn();

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
}));

function createToken(overrides: Partial<Token>): Token {
  return {
    id: 1,
    campaign_id: 7,
    map_url: "/maps/test-map.png",
    position_x: 0,
    position_y: 0,
    token_size: "1x1",
    ...overrides,
  } as Token;
}

function createManeuver(overrides: Partial<Maneuver>): Maneuver {
  return {
    id: "rally",
    name: "激励",
    description: "测试战技",
    timing: "bonus_action",
    ...overrides,
  } as Maneuver;
}

function createControllerHarness(overrides: {
  tokens?: Token[];
  sourceCharacterData?: any;
  authedFetch?: any;
  showToast?: any;
  sendMessage?: any;
} = {}) {
  const authedFetch = overrides.authedFetch ?? vi.fn(async () => ({
    ok: true,
    json: async () => ({}),
  }));
  const showToast = overrides.showToast ?? vi.fn();
  const sendMessage = overrides.sendMessage ?? vi.fn();

  const hook = renderHook(() => {
    const [tokens, setTokens] = useState<Token[]>(
      overrides.tokens ?? [
        createToken({
          id: 1,
          character_id: 18,
          instance_name: "战士",
        }),
        createToken({
          id: 2,
          character_id: 19,
          instance_name: "目标",
          position_y: 1,
          current_hp: 20,
        }),
      ],
    );
    const [sourceCharacterData, setSourceCharacterData] = useState(
      overrides.sourceCharacterData ?? {
        level: 5,
        ability_scores: {
          strength: 16,
          dexterity: 14,
          charisma: 16,
        },
        maneuvers_data: {
          superiority_dice: {
            current: 2,
            max: 4,
            die: "d8",
          },
        },
      },
    );
    const [pendingManeuvers, setPendingManeuvers] = useState<PendingManeuverState>({});
    const [tokenStatusEffects, setTokenStatusEffects] = useState<Record<number, any[]>>({});

    const controller = useMapManeuverController({
      tokens,
      pendingManeuvers,
      tokenStatusEffects,
      sourceCharacterData,
      authedFetch,
      showToast,
      sendMessage,
      setTokens,
      setSourceCharacterData,
      setSelectionContextMenu: vi.fn() as any,
      setPendingManeuvers,
      setTokenStatusEffects,
    });

    return {
      ...controller,
      tokens,
      sourceCharacterData,
      pendingManeuvers,
      tokenStatusEffects,
    };
  });

  return {
    ...hook,
    authedFetch,
    showToast,
    sendMessage,
  };
}

describe("useMapManeuverController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
    vi.restoreAllMocks();
  });

  it("consumes superiority dice for immediate maneuvers and publishes typed updates", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const { result, authedFetch } = createControllerHarness();

    await act(async () => {
      await result.current.handleManeuverAction(
        createManeuver({ id: "rally", timing: "bonus_action" }),
        1,
        2,
      );
    });

    expect(result.current.sourceCharacterData.maneuvers_data.superiority_dice.current).toBe(1);
    expect(publishAppEventMock).toHaveBeenCalledWith("classFeatureUsesUpdated", {
      characterId: 18,
      featureId: "superiority_dice",
      currentUses: 1,
      maxUses: 4,
    });
    expect(authedFetch).toHaveBeenCalledWith(
      "/api/characters/18/feature-uses",
      expect.objectContaining({ method: "POST" }),
    );
    expect(authedFetch).toHaveBeenCalledWith(
      "/api/tokens/2/temp-hp",
      expect.objectContaining({ method: "PUT" }),
    );
    randomSpy.mockRestore();
  });

  it("stores pending maneuvers and triggers them on matching timing", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.25);
    const { result } = createControllerHarness();

    await act(async () => {
      await result.current.handleManeuverAction(
        createManeuver({ id: "trip_attack", name: "摔绊攻击", timing: "on_hit" }),
        1,
        2,
      );
    });

    expect(result.current.pendingManeuvers[1]?.maneuver.id).toBe("trip_attack");

    let triggerResult: { dieRoll: number; dieName: string } | null = null;
    await act(async () => {
      triggerResult = await result.current.triggerPendingManeuver(1, 2, "on_hit");
    });

    expect(triggerResult).toEqual({ dieRoll: 3, dieName: "d8" });
    expect(result.current.pendingManeuvers[1]).toBeNull();
    expect(result.current.sourceCharacterData.maneuvers_data.superiority_dice.current).toBe(1);
    randomSpy.mockRestore();
  });

  it("applies pushing attack secondary effects and persists token movement", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const { result, authedFetch, sendMessage } = createControllerHarness();

    await act(async () => {
      await result.current.applyManeuverSecondaryEffect(
        createManeuver({ id: "pushing_attack", name: "推击攻击" }),
        result.current.tokens[0],
        result.current.tokens[1],
        5,
      );
    });

    expect(result.current.tokens.find((token) => token.id === 2)?.position_y).toBe(4);
    expect(authedFetch).toHaveBeenCalledWith(
      "/api/tokens/2/position",
      expect.objectContaining({ method: "POST" }),
    );
    expect(sendMessage).toHaveBeenCalledWith({
      type: "token_move",
      data: { token_id: 2, position: { x: 0, y: 4 } },
    });
    randomSpy.mockRestore();
  });

  it("cancels pending maneuvers without consuming dice", async () => {
    const { result, showToast } = createControllerHarness();

    await act(async () => {
      await result.current.handleManeuverAction(
        createManeuver({ id: "trip_attack", name: "摔绊攻击", timing: "on_hit" }),
        1,
        2,
      );
    });

    act(() => {
      result.current.cancelPendingManeuver(1);
    });

    expect(result.current.pendingManeuvers[1]).toBeNull();
    expect(showToast).toHaveBeenCalledWith("战士 取消了【摔绊攻击】", "info");
  });
});
