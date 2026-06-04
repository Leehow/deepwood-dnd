import { describe, expect, it } from "vitest";

import type { Token } from "../../app/components/map/types/TacticalMapTypes";
import {
  findTokenAtGrid,
  getGridCoordinatesFromClientPoint,
  isPlayerContextMenuBlockedByTurn,
  resolvePlayerContextSourceToken,
} from "../../app/components/map/utils/mapInteractionUtils";

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

describe("mapInteractionUtils", () => {
  it("converts client coordinates into grid coordinates", () => {
    expect(
      getGridCoordinatesFromClientPoint({
        clientX: 160,
        clientY: 120,
        containerRect: { left: 20, top: 10 },
        stagePos: { x: 60, y: 30 },
        stageScale: 2,
        gridSize: 40,
      }),
    ).toEqual(
      expect.objectContaining({
        gridX: 1,
        gridY: 1,
        localX: 140,
        localY: 110,
      }),
    );
  });

  it("finds the clicked token with transformation size applied", () => {
    const token = createToken({
      id: 7,
      position_x: 4,
      position_y: 5,
      token_size: "1x1",
      transformation_data: { size: "Large" } as any,
    });

    expect(findTokenAtGrid([token], 5, 6)?.id).toBe(7);
    expect(findTokenAtGrid([token], 7, 7)).toBeNull();
  });

  it("prefers a controlled companion as the player context-menu source token", () => {
    const hero = createToken({
      id: 10,
      character_id: 501,
      character_name: "Hero",
      user_id: "u1",
    });
    const wolf = createToken({
      id: 11,
      monster_instance_id: 900,
      control_type: "companion",
      controller_character_id: 501,
      instance_name: "Wolf",
    });

    expect(
      resolvePlayerContextSourceToken({
        tokens: [hero, wolf],
        selectedCharacterId: 501,
        userId: "u1",
        clickedToken: wolf,
        controlledCharacterIds: new Set([501]),
      }),
    ).toEqual({
      controlledSourceToken: wolf,
      myToken: hero,
      sourceTokenForMenu: wolf,
    });
  });

  it("blocks player context menus when combat turn belongs to another user and no reaction override exists", () => {
    const hero = createToken({ id: 10, character_id: 501, user_id: "u1" });

    expect(
      isPlayerContextMenuBlockedByTurn({
        sourceToken: hero,
        combatIsActive: true,
        participantTokenIds: [10],
        turnUserId: "u2",
        currentUserId: "u1",
        reactionSourceTokenId: null,
      }),
    ).toBe(true);

    expect(
      isPlayerContextMenuBlockedByTurn({
        sourceToken: hero,
        combatIsActive: true,
        participantTokenIds: [10],
        turnUserId: "u2",
        currentUserId: "u1",
        reactionSourceTokenId: 10,
      }),
    ).toBe(false);
  });
});
