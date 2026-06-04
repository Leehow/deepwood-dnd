import { afterEach, describe, expect, it } from "vitest";

import {
  __rememberClassFeatureUpdateForTests,
  __resetMapWebSocketStateForTests,
  __shouldSuppressRemoteClassFeatureUpdateForTests,
} from "~/components/map/hooks/useMapWebSocket";

describe("useMapWebSocket class feature dedupe", () => {
  afterEach(() => {
    __resetMapWebSocketStateForTests();
  });

  it("suppresses a websocket echo that matches a recent local class-feature update", () => {
    __rememberClassFeatureUpdateForTests({
      characterId: 12,
      featureId: "superiority_dice",
      currentUses: 3,
      maxUses: 4,
    });

    expect(__shouldSuppressRemoteClassFeatureUpdateForTests({
      characterId: 12,
      featureId: "superiority_dice",
      currentUses: 3,
      maxUses: 4,
    })).toBe(true);
  });

  it("does not suppress a different class-feature payload", () => {
    __rememberClassFeatureUpdateForTests({
      characterId: 12,
      featureId: "superiority_dice",
      currentUses: 3,
      maxUses: 4,
    });

    expect(__shouldSuppressRemoteClassFeatureUpdateForTests({
      characterId: 12,
      featureId: "second_wind",
      currentUses: 0,
      maxUses: 1,
    })).toBe(false);
  });
});
