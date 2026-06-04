import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { publishAppEvent } from "../../app/events/appEventBus";
import { useMapHotbarAttackBridge } from "../../app/components/map/hooks/useMapHotbarAttackBridge";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

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

describe("useMapHotbarAttackBridge", () => {
  it("routes hotbar attack execute events through the shared attack entry handler", async () => {
    const handleAttackAction = vi.fn(async () => {});

    renderHook(() => useMapHotbarAttackBridge({
      tokens: [
        createToken({ id: 11, character_id: 101, instance_name: "战士" }),
        createToken({ id: 22, monster_instance_id: 303, instance_name: "食尸鬼" }),
      ],
      handleAttackAction,
    }));

    publishAppEvent("hotbarAttackExecute", {
      sourceCharacterId: 101,
      targetTokenId: 22,
      attack: {
        key: "weapon_longsword_main",
        name: "长剑",
        nameEn: "Longsword",
        icon: "⚔️",
        description: "挥砍攻击",
      },
      modifiers: { powerAttack: true, useLucky: false },
    });

    await waitFor(() => {
      expect(handleAttackAction).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "weapon_longsword_main",
          name: "长剑",
          nameEn: "Longsword",
          icon: "⚔️",
          description: "挥砍攻击",
        }),
        11,
        22,
        null,
        { powerAttack: true, useLucky: false },
      );
    });
  });
});
