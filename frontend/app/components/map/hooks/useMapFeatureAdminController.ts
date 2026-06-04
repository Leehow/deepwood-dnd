import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { Token } from "../types/TacticalMapTypes";
import { publishAppEvent } from "~/events/appEventBus";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapFeatureAdminController");

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface UseMapFeatureAdminControllerArgs {
  tokens: Token[];
  tokenStatusEffects: Record<number, any[]>;
  sourceCharacterData: any;
  authedFetch: AuthedFetch;
  showToast: ShowToast;
  sendMessage: (payload: any) => void;
  setTokens: Dispatch<SetStateAction<Token[]>>;
  setTokenStatusEffects: Dispatch<SetStateAction<Record<number, any[]>>>;
  clearSelectionContextMenu: () => void;
  isAppearanceIllusionSpell: (spellId: unknown) => boolean;
}

export function useMapFeatureAdminController({
  tokens,
  tokenStatusEffects,
  sourceCharacterData,
  authedFetch,
  showToast,
  sendMessage,
  setTokens,
  setTokenStatusEffects,
  clearSelectionContextMenu,
  isAppearanceIllusionSpell,
}: UseMapFeatureAdminControllerArgs) {
  const handleEditEffectDuration = useCallback(async (sourceTokenId: number, effectId: string, newDuration: number) => {
    const currentEffects = tokenStatusEffects[sourceTokenId] || [];
    const effectIndex = currentEffects.findIndex((effect) => effect.id === effectId);

    if (effectIndex < 0) {
      showToast("未找到该状态效果", "error");
      return;
    }

    const effectName = currentEffects[effectIndex].name;

    if (newDuration <= 0) {
      const removedEffect = currentEffects[effectIndex];
      const nextEffects = currentEffects.filter((effect) => effect.id !== effectId);
      setTokenStatusEffects((previous) => ({
        ...previous,
        [sourceTokenId]: nextEffects,
      }));
      setTokens((previous) => previous.map((token) =>
        token.id === sourceTokenId
          ? { ...token, active_effects: nextEffects.length > 0 ? nextEffects : null }
          : token,
      ));
      showToast(`${effectName} 已结束`, "info");

      try {
        await authedFetch(`/api/tokens/${sourceTokenId}/active-effects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active_effects: nextEffects }),
        });
      } catch (error) {
        logger.error("[Edit Effect Duration] Failed to persist:", error);
      }

      if (removedEffect?.spell_buff && isAppearanceIllusionSpell(removedEffect.spell_id)) {
        setTokens((previous) => previous.map((token) =>
          token.id === sourceTokenId ? { ...token, disguise_data: null } : token,
        ));
        try {
          await authedFetch(`/api/tokens/${sourceTokenId}/disguise`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ disguise_data: null }),
          });
        } catch (error) {
          logger.error("[Edit Effect Duration] Failed to clear disguise:", error);
        }
      }
      return;
    }

    const nextEffects = currentEffects.map((effect) =>
      effect.id === effectId ? { ...effect, duration: newDuration } : effect,
    );
    setTokenStatusEffects((previous) => ({
      ...previous,
      [sourceTokenId]: nextEffects,
    }));
    setTokens((previous) => previous.map((token) =>
      token.id === sourceTokenId ? { ...token, active_effects: nextEffects } : token,
    ));
    showToast(`${effectName} 剩余${currentEffects[effectIndex]?.duration_unit === "day" ? "天数" : "轮数"}修改为 ${newDuration}`, "success");

    try {
      await authedFetch(`/api/tokens/${sourceTokenId}/active-effects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_effects: nextEffects }),
      });
    } catch (error) {
      logger.error("[Edit Effect Duration] Failed to persist:", error);
    }
  }, [authedFetch, isAppearanceIllusionSpell, setTokenStatusEffects, setTokens, showToast, tokenStatusEffects]);

  const handleEditActionUses = useCallback(async (characterId: number, actionId: string, newUses: number, maxUses: number) => {
    try {
      const response = await authedFetch(`/api/characters/${characterId}/feature-uses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feature_id: actionId,
          current_uses: newUses,
          max_uses: maxUses,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        showToast(error.detail || "更新使用次数失败", "error");
        return;
      }

      showToast(`使用次数已更新为 ${newUses}/${maxUses}`, "success");
      publishAppEvent("classFeatureUsesUpdated", {
        characterId,
        featureId: actionId,
        currentUses: newUses,
        maxUses,
      });
    } catch (error) {
      logger.error("[Edit Action Uses] Failed to update:", error);
      showToast("更新使用次数失败", "error");
    }
  }, [authedFetch, showToast]);

  const handleRangerAbility = useCallback(async (
    abilityType: "favored_enemy" | "natural_explorer",
    sourceTokenId: number,
    isActivating: boolean,
  ) => {
    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    const sourceName = sourceToken?.instance_name || "游侠";
    const currentEffects = tokenStatusEffects[sourceTokenId] || [];

    const effectDefs: Record<string, { id: string; name: string; icon: string; color: string }> = {
      favored_enemy: { id: "favored_enemy", name: "宿敌", icon: "🎯", color: "#22c55e" },
      natural_explorer: { id: "natural_explorer", name: "自然探索者", icon: "🌲", color: "#16a34a" },
    };

    const effectDef = effectDefs[abilityType];
    if (!effectDef) return;

    let nextEffects: typeof currentEffects;
    let chatMessage: string;

    if (isActivating) {
      nextEffects = [
        ...currentEffects,
        {
          id: effectDef.id,
          name: effectDef.name,
          icon: effectDef.icon,
          color: effectDef.color,
        },
      ];

      let specificValue = "";
      if (abilityType === "favored_enemy" && sourceCharacterData?.favored_enemy) {
        const enemy = typeof sourceCharacterData.favored_enemy === "object"
          ? sourceCharacterData.favored_enemy.value
          : sourceCharacterData.favored_enemy;
        specificValue = enemy ? ` (${enemy})` : "";
      } else if (abilityType === "natural_explorer" && sourceCharacterData?.favored_terrain) {
        const terrain = typeof sourceCharacterData.favored_terrain === "object"
          ? sourceCharacterData.favored_terrain.value
          : sourceCharacterData.favored_terrain;
        specificValue = terrain ? ` (${terrain})` : "";
      }

      chatMessage = `${effectDef.icon} **${sourceName}** 激活了【${effectDef.name}】${specificValue}！`;
      if (abilityType === "favored_enemy") {
        chatMessage += "\n> 追踪宿敌时感知(求生)检定和回忆宿敌信息的智力检定具有**优势**";
      } else {
        chatMessage += "\n> 在偏好地形中，智力和感知检定熟练加值**翻倍**";
      }
      showToast(`${sourceName} 激活了 ${effectDef.name}`, "success");
    } else {
      nextEffects = currentEffects.filter((effect) => effect.id !== effectDef.id);
      chatMessage = `${effectDef.icon} **${sourceName}** 结束了【${effectDef.name}】`;
      showToast(`${sourceName} 结束了 ${effectDef.name}`, "info");
    }

    sendMessage({
      type: "chat",
      data: { message: chatMessage, message_type: "combat" },
    });

    setTokenStatusEffects((previous) => ({
      ...previous,
      [sourceTokenId]: nextEffects,
    }));

    try {
      await authedFetch(`/api/tokens/${sourceTokenId}/active-effects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_effects: nextEffects }),
      });
    } catch (error) {
      logger.error("[Ranger Ability] Failed to persist active effects:", error);
    }

    logger.info("[Ranger Ability]", {
      ability: abilityType,
      source: sourceTokenId,
      activated: isActivating,
    });
    clearSelectionContextMenu();
  }, [
    authedFetch,
    clearSelectionContextMenu,
    sendMessage,
    setTokenStatusEffects,
    showToast,
    sourceCharacterData,
    tokenStatusEffects,
    tokens,
  ]);

  return {
    handleEditEffectDuration,
    handleEditActionUses,
    handleRangerAbility,
  };
}
