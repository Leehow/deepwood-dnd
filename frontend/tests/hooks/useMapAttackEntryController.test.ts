import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { useMapAttackEntryController } from "../../app/components/map/hooks/useMapAttackEntryController";
import type { AttackOption } from "../../app/components/map/SelectionContextMenu";
import type { PreparedWeaponAttackAction } from "../../app/components/map/hooks/useMapWeaponAttackPreparationController";
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

describe("useMapAttackEntryController", () => {
  it("routes grapple attacks to contested checks instead of combat attack execution", async () => {
    const handleContestedCheck = vi.fn(async () => {});
    const prepareAttackAction = vi.fn(async () => null);
    const executeAttackAction = vi.fn(async () => true);

    const { result } = renderHook(() => {
      const [tokenRollModifier, setTokenRollModifier] = useState<Record<number, "advantage" | "disadvantage" | null>>({});
      return useMapAttackEntryController({
        tokens: [
          createToken({ id: 10, position_x: 0, position_y: 0 }),
          createToken({ id: 22, position_x: 1, position_y: 0 }),
        ],
        isDM: true,
        gridUnitLength: 5,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        clearSelectionContextMenu: vi.fn(),
        tokenRollModifier,
        setTokenRollModifier,
        handleContestedCheck,
        prepareAttackAction,
        executeAttackAction,
      });
    });

    await act(async () => {
      await result.current.handleAttackAction({
        key: "grapple",
        name: "擒抱",
      } as AttackOption, 10, 22);
    });

    expect(handleContestedCheck).toHaveBeenCalled();
    expect(prepareAttackAction).not.toHaveBeenCalled();
    expect(executeAttackAction).not.toHaveBeenCalled();
  });

  it("delegates validated weapon attacks and blind misses through the shared entry layer", async () => {
    const clearSelectionContextMenu = vi.fn();
    const showToast = vi.fn();
    const sendMessage = vi.fn();
    const preparedAttack = {
      sourceToken: createToken({ id: 10, character_id: 18, instance_name: "游侠" }),
      targetToken: createToken({ id: 22, instance_name: "食尸鬼" }),
      attackerData: { name: "游侠" },
      attackRequest: { target: { name: "食尸鬼" } },
      attackerEffects: [],
      cloakOfShadowsActive: false,
      isRangedAttack: true,
    } as PreparedWeaponAttackAction;
    const prepareAttackAction = vi.fn(async () => preparedAttack);
    const executeAttackAction = vi.fn(async () => true);

    const { result } = renderHook(() => {
      const [tokenRollModifier, setTokenRollModifier] = useState<Record<number, "advantage" | "disadvantage" | null>>({
        10: "advantage",
      });
      return {
        controller: useMapAttackEntryController({
          tokens: [
            createToken({ id: 10, character_id: 18, instance_name: "游侠", position_x: 0, position_y: 0 }),
            createToken({ id: 22, instance_name: "食尸鬼", position_x: 1, position_y: 0 }),
          ],
          isDM: true,
          gridUnitLength: 5,
          showToast,
          sendMessage,
          clearSelectionContextMenu,
          tokenRollModifier,
          setTokenRollModifier,
          handleContestedCheck: vi.fn(async () => {}),
          prepareAttackAction,
          executeAttackAction,
        }),
        tokenRollModifier,
      };
    });

    await act(async () => {
      await result.current.controller.handleAttackAction({
        key: "weapon_longbow_main",
        name: "长弓",
        isRanged: true,
      } as AttackOption, 10, 22);
    });

    expect(prepareAttackAction).toHaveBeenCalledWith(expect.objectContaining({
      sourceTokenId: 10,
      targetTokenId: 22,
      distanceFeet: 5,
    }));
    expect(executeAttackAction).toHaveBeenCalledWith(expect.objectContaining({
      sourceTokenId: 10,
      targetTokenId: 22,
      preparedAttack,
    }));
    expect(clearSelectionContextMenu).toHaveBeenCalled();

    await act(async () => {
      await result.current.controller.handleBlindAttack({
        key: "weapon_longbow_main",
        name: "长弓",
      } as AttackOption, 10, 9, 9);
    });

    expect(showToast).toHaveBeenCalledWith("游侠 的长弓攻击落空！未命中任何目标", "info");
    expect(sendMessage).toHaveBeenCalledWith({
      type: "chat",
      data: {
        message: "🎯 游侠 向遮蔽区域发动盲目攻击（长弓），但未命中任何目标！",
        sender_name: "System",
      },
    });
  });
});
