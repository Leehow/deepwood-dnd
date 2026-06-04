import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { publishAppEvent } from "../../app/events/appEventBus";
import { useMapForcedMovementConsumer } from "../../app/components/map/hooks/useMapForcedMovementConsumer";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

const TARGET_ID = 535;
const SOURCE_ID = 527;
const EFFECT_ID = "thorn_whip_forced_movement";

function thornWhipEffect() {
  return {
    id: EFFECT_ID,
    spell_id: "thorn_whip",
    effect_type: "forced_movement",
    direction: "pull",
    distance: 10,
    relative_to: "caster",
    source_token_id: SOURCE_ID,
    transient: true,
  } as unknown as Token["active_effects"] extends Array<infer U> | null | undefined ? U : never;
}

function createTokens(): Token[] {
  return [
    {
      id: SOURCE_ID,
      campaign_id: 8,
      map_url: "/maps/test.png",
      position_x: 30,
      position_y: 38,
      token_size: "1x1",
    } as Token,
    {
      id: TARGET_ID,
      campaign_id: 8,
      map_url: "/maps/test.png",
      position_x: 35,
      position_y: 38,
      token_size: "1x1",
      active_effects: [thornWhipEffect()] as unknown as Token["active_effects"],
    } as Token,
  ];
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useMapForcedMovementConsumer", () => {
  let authedFetch: any;
  let setTokens: any;

  beforeEach(() => {
    authedFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    setTokens = vi.fn();
  });

  it("moves token 535 from (35,38) to (33,38) and clears the transient effect exactly once for a Thorn Whip pull", async () => {
    const tokens = createTokens();
    renderHook(() =>
      useMapForcedMovementConsumer({
        isDM: true,
        tokens,
        gridUnitLength: 5,
        authedFetch,
        setTokens,
      }),
    );

    await act(async () => {
      publishAppEvent("forcedMovementPending", {
        targetTokenId: TARGET_ID,
        effectId: EFFECT_ID,
        sourceTokenId: SOURCE_ID,
        direction: "pull",
        distanceFeet: 10,
        relativeTo: "caster",
        point: null,
        activeEffectsSnapshot: [thornWhipEffect() as unknown as Record<string, unknown>],
      });
      await flush();
    });

    const positionCalls = authedFetch.mock.calls.filter((call: any[]) =>
      String(call[0]).endsWith("/position"),
    );
    expect(positionCalls).toHaveLength(1);
    expect(JSON.parse(positionCalls[0][1].body)).toEqual({ position_x: 33, position_y: 38 });

    const activeEffectsCalls = authedFetch.mock.calls.filter((call: any[]) =>
      String(call[0]).endsWith("/active-effects"),
    );
    expect(activeEffectsCalls).toHaveLength(1);
    expect(JSON.parse(activeEffectsCalls[0][1].body)).toEqual({ active_effects: [] });
  });

  it("does not re-fire when the same effectId arrives a second time within the inflight TTL", async () => {
    const tokens = createTokens();
    renderHook(() =>
      useMapForcedMovementConsumer({
        isDM: true,
        tokens,
        gridUnitLength: 5,
        authedFetch,
        setTokens,
      }),
    );

    const fire = () =>
      publishAppEvent("forcedMovementPending", {
        targetTokenId: TARGET_ID,
        effectId: EFFECT_ID,
        sourceTokenId: SOURCE_ID,
        direction: "pull",
        distanceFeet: 10,
        relativeTo: "caster",
        point: null,
        activeEffectsSnapshot: [thornWhipEffect() as unknown as Record<string, unknown>],
      });

    await act(async () => {
      fire();
      await flush();
    });
    await act(async () => {
      fire();
      await flush();
    });

    const positionCalls = authedFetch.mock.calls.filter((call: any[]) =>
      String(call[0]).endsWith("/position"),
    );
    expect(positionCalls).toHaveLength(1);
  });

  it("ignores events when not running as DM", async () => {
    const tokens = createTokens();
    renderHook(() =>
      useMapForcedMovementConsumer({
        isDM: false,
        tokens,
        gridUnitLength: 5,
        authedFetch,
        setTokens,
      }),
    );

    await act(async () => {
      publishAppEvent("forcedMovementPending", {
        targetTokenId: TARGET_ID,
        effectId: EFFECT_ID,
        sourceTokenId: SOURCE_ID,
        direction: "pull",
        distanceFeet: 10,
        relativeTo: "caster",
        point: null,
        activeEffectsSnapshot: [thornWhipEffect() as unknown as Record<string, unknown>],
      });
      await flush();
    });

    expect(authedFetch).not.toHaveBeenCalled();
  });

  it("clears the transient effect without moving when source position is unknown", async () => {
    const tokens: Token[] = [
      {
        id: TARGET_ID,
        campaign_id: 8,
        map_url: "/maps/test.png",
        position_x: 35,
        position_y: 38,
        token_size: "1x1",
        active_effects: [thornWhipEffect()] as unknown as Token["active_effects"],
      } as Token,
    ];
    renderHook(() =>
      useMapForcedMovementConsumer({
        isDM: true,
        tokens,
        gridUnitLength: 5,
        authedFetch,
        setTokens,
      }),
    );

    await act(async () => {
      publishAppEvent("forcedMovementPending", {
        targetTokenId: TARGET_ID,
        effectId: EFFECT_ID,
        // sourceTokenId is set but the token isn't in the local list
        sourceTokenId: SOURCE_ID,
        direction: "pull",
        distanceFeet: 10,
        relativeTo: "caster",
        point: null,
        activeEffectsSnapshot: [thornWhipEffect() as unknown as Record<string, unknown>],
      });
      await flush();
    });

    const positionCalls = authedFetch.mock.calls.filter((call: any[]) =>
      String(call[0]).endsWith("/position"),
    );
    expect(positionCalls).toHaveLength(0);
    const activeEffectsCalls = authedFetch.mock.calls.filter((call: any[]) =>
      String(call[0]).endsWith("/active-effects"),
    );
    expect(activeEffectsCalls).toHaveLength(1);
    expect(JSON.parse(activeEffectsCalls[0][1].body)).toEqual({ active_effects: [] });
  });
});
