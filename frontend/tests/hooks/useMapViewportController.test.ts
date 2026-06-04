import { renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Token } from "../../app/components/map/types/TacticalMapTypes";
import { useMapViewportController } from "../../app/components/map/hooks/useMapViewportController";

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

describe("useMapViewportController", () => {
  it("filters heavily obscured enemy tokens for players while keeping controlled tokens visible", async () => {
    const fetchMonsterInstance = vi.fn(async () => null);
    const tokens = [
      createToken({
        id: 1,
        character_id: 101,
        character_name: "Hero",
        user_id: "u1",
        position_x: 0,
        position_y: 0,
      }),
      createToken({
        id: 2,
        monster_instance_id: 201,
        control_type: "companion",
        controller_character_id: 101,
        instance_name: "Wolf",
        position_x: 1,
        position_y: 1,
      }),
      createToken({
        id: 3,
        character_name: "Bandit",
        position_x: 5,
        position_y: 5,
      }),
      createToken({
        id: 4,
        instance_name: "Fog Cloud",
        position_x: 5,
        position_y: 5,
        concentration_spell: {
          spell_id: "fog_cloud",
          spell_name: "Fog Cloud",
          slot_level: 1,
          con_save_bonus: 0,
          has_advantage: false,
          area_effect: {
            shape: "sphere",
            center_x: 5.5,
            center_y: 5.5,
            radius: 10,
            map_url: "map://battle",
          },
        },
      } as Token),
    ];

    const { result } = renderHook(() => {
      const [companionMonsterDataMap, setCompanionMonsterDataMap] = useState<Record<number, any>>({});
      return useMapViewportController({
        stagePos: { x: 0, y: 0 },
        stageScale: 1,
        stageSize: { width: 800, height: 600 },
        tokens,
        isDM: false,
        userId: "u1",
        selectedCharacterId: 101,
        currentMapUrl: "map://battle",
        gridUnitLength: 5,
        spellsData: [{ id: "fog_cloud", zoneEffects: { obscurement: "heavy" } }],
        playerAvatars: [],
        companionMonsterDataMap,
        setCompanionMonsterDataMap,
        fetchMonsterInstance,
      });
    });

    await waitFor(() => {
      expect(result.current.visibleTokens.map((token) => token.id)).toEqual([1, 2]);
    });
  });

  it("ignores expired obscurement zones when world time has passed", async () => {
    const fetchMonsterInstance = vi.fn(async () => null);
    const tokens = [
      createToken({
        id: 1,
        character_id: 101,
        character_name: "Hero",
        user_id: "u1",
        position_x: 0,
        position_y: 0,
      }),
      createToken({
        id: 3,
        character_name: "Bandit",
        position_x: 5,
        position_y: 5,
      }),
      createToken({
        id: 4,
        instance_name: "Fog Cloud",
        position_x: 5,
        position_y: 5,
        concentration_spell: {
          spell_id: "fog_cloud",
          spell_name: "Fog Cloud",
          slot_level: 1,
          con_save_bonus: 0,
          has_advantage: false,
          expires_at: {
            day: 123,
            hour: 12,
            minute: 0,
            second: 0,
          },
          area_effect: {
            shape: "sphere",
            center_x: 5.5,
            center_y: 5.5,
            radius: 10,
            map_url: "map://battle",
          },
        },
      } as Token),
    ];

    const { result } = renderHook(() => {
      const [companionMonsterDataMap, setCompanionMonsterDataMap] = useState<Record<number, any>>({});
      return useMapViewportController({
        stagePos: { x: 0, y: 0 },
        stageScale: 1,
        stageSize: { width: 800, height: 600 },
        tokens,
        isDM: false,
        userId: "u1",
        selectedCharacterId: 101,
        currentMapUrl: "map://battle",
        currentWorldTime: {
          day: 123,
          hour: 12,
          minute: 0,
          second: 6,
        },
        gridUnitLength: 5,
        spellsData: [{ id: "fog_cloud", zoneEffects: { obscurement: "heavy" } }],
        playerAvatars: [],
        companionMonsterDataMap,
        setCompanionMonsterDataMap,
        fetchMonsterInstance,
      });
    });

    await waitFor(() => {
      expect(result.current.visibleTokens.map((token) => token.id)).toEqual([1, 3, 4]);
    });
  });

  it("preloads missing companion monster data and derives zoom avatars from tokens", async () => {
    const fetchMonsterInstance = vi.fn(async (monsterInstanceId: number) => ({
      id: monsterInstanceId,
      hp: 22,
    }));
    const tokens = [
      createToken({
        id: 1,
        character_id: 501,
        character_name: "Cleric",
        user_id: "u9",
        avatar: "/avatars/cleric.png",
        position_x: 2,
        position_y: 2,
      }),
      createToken({
        id: 2,
        monster_instance_id: 901,
        control_type: "summon",
        controller_character_id: 501,
        instance_name: "Spiritual Guardian",
        position_x: 3,
        position_y: 3,
      }),
    ];

    const { result } = renderHook(() => {
      const [companionMonsterDataMap, setCompanionMonsterDataMap] = useState<Record<number, any>>({});
      return useMapViewportController({
        stagePos: { x: 0, y: 0 },
        stageScale: 1,
        stageSize: { width: 800, height: 600 },
        tokens,
        isDM: false,
        userId: "u9",
        selectedCharacterId: 501,
        currentMapUrl: "map://companions",
        gridUnitLength: 5,
        spellsData: [],
        playerAvatars: [],
        companionMonsterDataMap,
        setCompanionMonsterDataMap,
        fetchMonsterInstance,
      });
    });

    await waitFor(() => {
      expect(fetchMonsterInstance).toHaveBeenCalledWith(901);
    });

    await waitFor(() => {
      expect(result.current.playerCompanions).toEqual([
        {
          monster_instance_id: 901,
          name: "Spiritual Guardian",
          control_type: "summon",
        },
      ]);
      expect(result.current.zoomControlPlayerAvatars).toEqual([
        {
          id: 501,
          name: "Cleric",
          avatar_url: "/avatars/cleric.png",
          isOnline: false,
          type: "player",
          userId: undefined,
        },
      ]);
    });
  });
});
