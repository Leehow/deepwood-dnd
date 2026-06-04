import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { AttackOption } from "../SelectionContextMenu";
import type { PreparedWeaponAttackAction } from "./useMapWeaponAttackPreparationController";
import type { Token } from "../types/TacticalMapTypes";
import { findTokenOccupyingGrid, getWeaponAttackDistanceFeet } from "../utils/mapAttackEntryUtils";

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

type SendMessage = (payload: any) => void;

interface UseMapAttackEntryControllerArgs {
  tokens: Token[];
  isDM: boolean;
  gridUnitLength: number;
  showToast: ShowToast;
  sendMessage: SendMessage;
  clearSelectionContextMenu: () => void;
  tokenRollModifier: Record<number, "advantage" | "disadvantage" | null>;
  setTokenRollModifier: Dispatch<
    SetStateAction<Record<number, "advantage" | "disadvantage" | null>>
  >;
  handleContestedCheck: (
    attack: AttackOption,
    sourceToken: Token,
    targetToken: Token,
    distanceFeet: number,
  ) => Promise<void>;
  prepareAttackAction: (args: {
    attack: AttackOption;
    sourceTokenId: number;
    targetTokenId: number;
    distanceFeet: number;
    inspirationDie?: string | null;
    modifiers?: { powerAttack?: boolean; useLucky?: boolean };
  }) => Promise<PreparedWeaponAttackAction | null>;
  executeAttackAction: (args: {
    attack: AttackOption;
    sourceTokenId: number;
    targetTokenId: number;
    distanceFeet: number;
    inspirationDie?: string | null;
    preparedAttack: PreparedWeaponAttackAction;
  }) => Promise<boolean>;
}

export function useMapAttackEntryController({
  tokens,
  isDM,
  gridUnitLength,
  showToast,
  sendMessage,
  clearSelectionContextMenu,
  tokenRollModifier,
  setTokenRollModifier,
  handleContestedCheck,
  prepareAttackAction,
  executeAttackAction,
}: UseMapAttackEntryControllerArgs) {
  const handleAttackAction = useCallback(async (
    attack: AttackOption,
    sourceTokenId: number,
    targetTokenId?: number,
    inspirationDie?: string | null,
    modifiers?: { powerAttack?: boolean; useLucky?: boolean },
  ) => {
    if (!targetTokenId) {
      showToast("需要选择攻击目标", "error");
      clearSelectionContextMenu();
      return;
    }

    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    const targetToken = tokens.find((token) => token.id === targetTokenId);

    if (!sourceToken || !targetToken) {
      showToast("无法找到攻击者或目标", "error");
      clearSelectionContextMenu();
      return;
    }

    const combatBonusActionUsed = typeof window !== "undefined"
      ? Boolean((window as any).__combatBonusActionUsed)
      : false;
    if (attack.isBonusAction && combatBonusActionUsed && !isDM) {
      showToast("本回合附赠动作已用尽", "warning");
      return;
    }

    if (attack.needsAmmo && (attack.ammoCount === 0 || attack.ammoCount === undefined) && !isDM) {
      showToast(`无法攻击：缺少${attack.ammoName || "弹药"}`, "error");
      clearSelectionContextMenu();
      return;
    }

    const distanceFeet = getWeaponAttackDistanceFeet({
      sourceToken,
      targetToken,
      gridUnitLength,
    });

    if (!isDM && attack.maxRange && distanceFeet > attack.maxRange) {
      showToast(`超出攻击距离 (${Math.round(distanceFeet)}尺 > 最大射程${attack.maxRange}尺)`, "error");
      clearSelectionContextMenu();
      return;
    }

    if (attack.key === "grapple" || attack.key === "shove") {
      await handleContestedCheck(attack, sourceToken, targetToken, distanceFeet);
      return;
    }

    try {
      const preparedAttack = await prepareAttackAction({
        attack,
        sourceTokenId,
        targetTokenId,
        distanceFeet,
        inspirationDie,
        modifiers,
      });

      if (!preparedAttack) {
        return;
      }

      if (tokenRollModifier[sourceTokenId]) {
        setTokenRollModifier((previous) => ({ ...previous, [sourceTokenId]: null }));
      }

      clearSelectionContextMenu();
      await executeAttackAction({
        attack,
        sourceTokenId,
        targetTokenId,
        distanceFeet,
        inspirationDie,
        preparedAttack,
      });
    } catch (error) {
      showToast(`攻击准备失败: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [
    clearSelectionContextMenu,
    executeAttackAction,
    gridUnitLength,
    handleContestedCheck,
    isDM,
    prepareAttackAction,
    setTokenRollModifier,
    showToast,
    tokenRollModifier,
    tokens,
  ]);

  const handleBlindAttack = useCallback(async (
    attack: AttackOption,
    sourceTokenId: number,
    gridX: number,
    gridY: number,
  ) => {
    const targetToken = findTokenOccupyingGrid({
      tokens,
      sourceTokenId,
      gridX,
      gridY,
    });

    if (targetToken) {
      await handleAttackAction(attack, sourceTokenId, targetToken.id, null, { useLucky: false });
      return;
    }

    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    const sourceName = sourceToken?.instance_name || sourceToken?.character_name || "攻击者";
    showToast(`${sourceName} 的${attack.weaponName || attack.name}攻击落空！未命中任何目标`, "info");
    sendMessage({
      type: "chat",
      data: {
        message: `🎯 ${sourceName} 向遮蔽区域发动盲目攻击（${attack.weaponName || attack.name}），但未命中任何目标！`,
        sender_name: "System",
      },
    });
    clearSelectionContextMenu();
  }, [clearSelectionContextMenu, handleAttackAction, sendMessage, showToast, tokens]);

  return {
    handleAttackAction,
    handleBlindAttack,
  };
}
