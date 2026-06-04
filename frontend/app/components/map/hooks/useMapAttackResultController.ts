import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { Token } from "../types/TacticalMapTypes";
import {
  publishAppEvent,
  type CombatAttackResultEventPayload,
  type PromptDivineSmiteEventPayload,
} from "~/events/appEventBus";
import { showCharacterBubble } from "~/utils/characterBubble";

interface AttackResultLike {
  hit: boolean;
  critical?: boolean;
  fumble?: boolean;
  damage_dealt?: number;
  extra_damage_dealt?: number;
  extra_damage_type?: string;
  target_defeated?: boolean;
  target_ac?: number;
  content?: string;
  narrative?: string;
  hp_change?: number;
  new_hp?: number | null;
}

interface UseMapAttackResultControllerArgs {
  setTokens: Dispatch<SetStateAction<Token[]>>;
  setDmBubbleMessage: Dispatch<SetStateAction<string | null>>;
}

export function useMapAttackResultController({
  setTokens,
  setDmBubbleMessage,
}: UseMapAttackResultControllerArgs) {
  const showAttackOutcomeFeedback = useCallback((args: {
    sourceToken: Token;
    attackerName: string;
    targetName: string;
    result: AttackResultLike;
    maneuverBonusDamage?: number;
    outOfRange?: boolean;
    includeExtraDamageHintForDm?: boolean;
  }) => {
    const {
      sourceToken,
      attackerName,
      targetName,
      result,
      maneuverBonusDamage = 0,
      outOfRange = false,
      includeExtraDamageHintForDm = false,
    } = args;

    const totalDamage = (result.damage_dealt || 0) + (result.extra_damage_dealt || 0) + maneuverBonusDamage;
    const hitText = result.hit ? "命中" : "未命中";
    const maneuverText = maneuverBonusDamage > 0 ? `+${maneuverBonusDamage}战技` : "";
    const damageText = result.hit && totalDamage > 0 ? `，造成 ${totalDamage} 点伤害${maneuverText}` : "";
    const baseMessage = `⚔️ 攻击 ${targetName}：${hitText}${damageText}`;

    if (sourceToken.character_id) {
      showCharacterBubble({
        characterId: sourceToken.character_id,
        characterName: attackerName,
        message: baseMessage,
        type: "combat",
        avatarUrl: sourceToken.avatar ?? undefined,
      });
      return;
    }

    const extraDamageHint = includeExtraDamageHintForDm && result.extra_damage_dealt && result.extra_damage_type
      ? ` (含 ${result.extra_damage_dealt} ${result.extra_damage_type})`
      : "";
    const suffix = outOfRange ? "【超出射程】" : "";
    setDmBubbleMessage(`${baseMessage}${extraDamageHint}${suffix}`);
  }, [setDmBubbleMessage]);

  const publishCombatAttackResult = useCallback((args: {
    attackerTokenId: number;
    attackerName: string;
    targetTokenId: number;
    targetName: string;
    attackName: string;
    result: AttackResultLike;
    message?: string;
    damageOverride?: number;
    targetMonsterInstanceId?: number;
    xpValue?: number;
    autoApply?: boolean;
  }) => {
    const {
      attackerTokenId,
      attackerName,
      targetTokenId,
      targetName,
      attackName,
      result,
      message,
      damageOverride,
      targetMonsterInstanceId,
      xpValue,
      autoApply,
    } = args;

    const payload: CombatAttackResultEventPayload = {
      ...(message ? { message } : {}),
      ...(typeof targetMonsterInstanceId === "number" ? { target_monster_instance_id: targetMonsterInstanceId } : {}),
      ...(typeof xpValue === "number" ? { xp_value: xpValue } : {}),
      ...(typeof autoApply === "boolean" ? { auto_apply: autoApply } : {}),
      result: {
        ...result,
        attacker_name: attackerName,
        attacker_token_id: attackerTokenId,
        target_name: targetName,
        target_token_id: targetTokenId,
        attack_name: attackName,
        damage_dealt: damageOverride ?? result.damage_dealt ?? 0,
      },
    };

    publishAppEvent("combatAttackResult", payload);
  }, []);

  const publishCombatBonusAttackGranted = useCallback((message: string) => {
    publishAppEvent("combatBonusAttackGranted", { message });
  }, []);

  const publishPromptDivineSmite = useCallback((detail: PromptDivineSmiteEventPayload) => {
    publishAppEvent("promptDivineSmite", detail);
  }, []);

  const applyAttackHpChange = useCallback((args: {
    autoApply: boolean;
    targetTokenId: number;
    result: AttackResultLike;
  }) => {
    const { autoApply, targetTokenId, result } = args;
    if (!autoApply || !result.hp_change || result.new_hp == null) {
      return;
    }
    setTokens((previous) => previous.map((token) =>
      token.id === targetTokenId ? { ...token, current_hp: result.new_hp as number } : token,
    ));
  }, [setTokens]);

  return {
    showAttackOutcomeFeedback,
    publishCombatAttackResult,
    publishCombatBonusAttackGranted,
    publishPromptDivineSmite,
    applyAttackHpChange,
  };
}
