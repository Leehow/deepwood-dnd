import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapAttackResultController } from "../../app/components/map/hooks/useMapAttackResultController";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

const publishAppEventMock = vi.fn();
const showCharacterBubbleMock = vi.fn();

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
}));

vi.mock("../../app/utils/characterBubble", () => ({
  showCharacterBubble: (...args: any[]) => showCharacterBubbleMock(...args),
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

describe("useMapAttackResultController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
    showCharacterBubbleMock.mockReset();
  });

  it("shows character bubbles for player attacks", () => {
    const { result } = renderHook(() => {
      const [tokens, setTokens] = useState<Token[]>([]);
      const [dmBubbleMessage, setDmBubbleMessage] = useState<string | null>(null);
      return {
        controller: useMapAttackResultController({ setTokens, setDmBubbleMessage }),
        tokens,
        dmBubbleMessage,
      };
    });

    act(() => {
      result.current.controller.showAttackOutcomeFeedback({
        sourceToken: createToken({ id: 11, character_id: 18, avatar: "/avatar.png" }),
        attackerName: "战士",
        targetName: "食人魔",
        result: { hit: true, damage_dealt: 9 },
        maneuverBonusDamage: 3,
      });
    });

    expect(showCharacterBubbleMock).toHaveBeenCalledWith({
      characterId: 18,
      characterName: "战士",
      message: "⚔️ 攻击 食人魔：命中，造成 12 点伤害+3战技",
      type: "combat",
      avatarUrl: "/avatar.png",
    });
    expect(result.current.dmBubbleMessage).toBeNull();
  });

  it("shows dm bubbles and publishes attack-related events", () => {
    const { result } = renderHook(() => {
      const [tokens, setTokens] = useState<Token[]>([]);
      const [dmBubbleMessage, setDmBubbleMessage] = useState<string | null>(null);
      return {
        controller: useMapAttackResultController({ setTokens, setDmBubbleMessage }),
        dmBubbleMessage,
      };
    });

    act(() => {
      result.current.controller.showAttackOutcomeFeedback({
        sourceToken: createToken({ id: 21, monster_instance_id: 99 }),
        attackerName: "巨魔",
        targetName: "牧师",
        result: { hit: true, damage_dealt: 7, extra_damage_dealt: 4, extra_damage_type: "毒素" },
        includeExtraDamageHintForDm: true,
        outOfRange: true,
      });
      result.current.controller.publishCombatAttackResult({
        attackerTokenId: 21,
        attackerName: "巨魔",
        targetTokenId: 22,
        targetName: "牧师",
        attackName: "利爪",
        result: { hit: true, damage_dealt: 7, target_defeated: false },
        damageOverride: 11,
      });
      result.current.controller.publishCombatBonusAttackGranted("额外攻击");
      result.current.controller.publishPromptDivineSmite({
        characterId: 18,
        targetTokenId: 22,
        targetName: "食尸鬼",
      });
    });

    expect(result.current.dmBubbleMessage).toBe("⚔️ 攻击 牧师：命中，造成 11 点伤害 (含 4 毒素)【超出射程】");
    expect(publishAppEventMock).toHaveBeenNthCalledWith(1, "combatAttackResult", {
      result: {
        hit: true,
        damage_dealt: 11,
        target_defeated: false,
        attacker_name: "巨魔",
        attacker_token_id: 21,
        target_name: "牧师",
        target_token_id: 22,
        attack_name: "利爪",
      },
    });
    expect(publishAppEventMock).toHaveBeenNthCalledWith(2, "combatBonusAttackGranted", { message: "额外攻击" });
    expect(publishAppEventMock).toHaveBeenNthCalledWith(3, "promptDivineSmite", {
      characterId: 18,
      targetTokenId: 22,
      targetName: "食尸鬼",
    });
  });

  it("applies hp changes only when auto apply is enabled", () => {
    const { result } = renderHook(() => {
      const [tokens, setTokens] = useState<Token[]>([
        createToken({ id: 1, current_hp: 20 }),
        createToken({ id: 2, current_hp: 14 }),
      ]);
      const [dmBubbleMessage, setDmBubbleMessage] = useState<string | null>(null);
      return {
        controller: useMapAttackResultController({ setTokens, setDmBubbleMessage }),
        tokens,
      };
    });

    act(() => {
      result.current.controller.applyAttackHpChange({
        autoApply: true,
        targetTokenId: 2,
        result: { hit: true, hp_change: 6, new_hp: 8 },
      });
    });

    expect(result.current.tokens.find((token) => token.id === 2)?.current_hp).toBe(8);

    act(() => {
      result.current.controller.applyAttackHpChange({
        autoApply: false,
        targetTokenId: 2,
        result: { hit: true, hp_change: 6, new_hp: 2 },
      });
    });

    expect(result.current.tokens.find((token) => token.id === 2)?.current_hp).toBe(8);
  });
});
