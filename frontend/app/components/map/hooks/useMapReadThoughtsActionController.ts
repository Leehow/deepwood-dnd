import { useCallback } from "react";

import type { SpellOption } from "../SelectionContextMenu";
import type { Token } from "../types/TacticalMapTypes";
import { getEdgeToEdgeDistance, parseTokenSize } from "../utils/mapCalculations";
import spellsData from "~/data/rules/spells.json";
import { publishAppEvent } from "~/events/appEventBus";
import type { WebSocketMessage } from "~/hooks/useWebSocket";
import { castSpellViaAPI } from "~/utils/sidebarCasting";

const READ_THOUGHTS_EFFECT_PREFIX = "read_thoughts_link_";
const READ_THOUGHTS_DURATION_ROUNDS = 10;

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

function getAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function getProficiencyBonus(level: number): number {
  return Math.floor((Math.max(level, 1) - 1) / 4) + 2;
}

function isReadThoughtsEffect(effect: any, targetTokenId?: number | null): boolean {
  if (!effect) return false;
  const matchesFeature = (
    String(effect.id || "").startsWith(READ_THOUGHTS_EFFECT_PREFIX)
    || effect.metadata?.sourceFeatureId === "read_thoughts"
    || effect.source_feature_id === "read_thoughts"
  );
  if (!matchesFeature) return false;
  if (targetTokenId == null) return true;
  return Number(effect.metadata?.targetTokenId) === Number(targetTokenId);
}

function buildSpellOptionFromData(spellData: any): SpellOption {
  return {
    id: spellData.id,
    name: spellData.name,
    nameEn: spellData.nameEn || spellData.name_en,
    level: Number(spellData.level || 0),
    school: spellData.school,
    damage: spellData.damage,
    damageType: spellData.damageType || spellData.damage_type,
    damageTypeCn: spellData.damageTypeCn || spellData.damage_type_cn,
    damageAtCharacterLevel: spellData.damageAtCharacterLevel || spellData.damage_at_character_level,
    damageAtSlotLevel: spellData.damageAtSlotLevel || spellData.damage_at_slot_level,
    healing: spellData.healing,
    healingAtSlotLevel: spellData.healingAtSlotLevel || spellData.healing_at_slot_level,
    attackType: spellData.attackType || spellData.attack_type,
    saveType: spellData.saveType || spellData.save_type,
    saveTypeCn: spellData.saveTypeCn || spellData.save_type_cn,
    saveEffect: spellData.saveEffect || spellData.save_effect,
    range: spellData.range,
    castingTime: spellData.castingTime || spellData.casting_time,
    areaOfEffect: spellData.areaOfEffect || spellData.area_of_effect,
    iconPath: spellData.iconPath || spellData.icon_path,
  };
}

function buildSuggestionSpell(): (SpellOption & Record<string, any>) | null {
  const allSpells = (spellsData as any).spells || spellsData;
  const rawSuggestionSpell = Array.isArray(allSpells)
    ? allSpells.find((spell: any) => spell.id === "suggestion")
    : null;

  if (!rawSuggestionSpell) return null;

  return {
    ...buildSpellOptionFromData(rawSuggestionSpell),
    range: "60尺",
    concentration: Boolean(rawSuggestionSpell.concentration),
    isControlSpell: Boolean(rawSuggestionSpell.isControlSpell || rawSuggestionSpell.is_control_spell),
    controlEffect: rawSuggestionSpell.controlEffect || rawSuggestionSpell.control_effect || null,
    effects: Array.isArray(rawSuggestionSpell.effects) ? rawSuggestionSpell.effects : undefined,
  };
}

interface UseMapReadThoughtsActionControllerArgs {
  tokens: Token[];
  tokenStatusEffects: Record<number, any[]>;
  sourceCharacterData: any;
  campaignId: string;
  userId?: string | null;
  isDM: boolean;
  gridUnitLength: number;
  authedFetch: AuthedFetch;
  showToast: ShowToast;
  sendMessage: (payload: WebSocketMessage) => void;
  persistTokenActiveEffects: (tokenId: number, newEffects: any[]) => Promise<void>;
  consumeCharacterResource: (
    characterId: number,
    resourceId: string,
    action: any,
    failureLabel: string,
  ) => Promise<{ current: number; max: number } | null>;
  buildSavingThrowTargetData: (
    targetToken: Token,
    ability: "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma",
  ) => Promise<any>;
  clearSelectionContextMenu: () => void;
}

export function useMapReadThoughtsActionController({
  tokens,
  tokenStatusEffects,
  sourceCharacterData,
  campaignId,
  userId,
  isDM,
  gridUnitLength,
  authedFetch,
  showToast,
  sendMessage,
  persistTokenActiveEffects,
  consumeCharacterResource,
  buildSavingThrowTargetData,
  clearSelectionContextMenu,
}: UseMapReadThoughtsActionControllerArgs) {
  const handleReadThoughtsAction = useCallback(async (args: {
    action: any;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
    targetTokenId?: number;
  }) => {
    const {
      action,
      sourceTokenId,
      sourceToken,
      sourceName,
      targetTokenId,
    } = args;

    const characterId = sourceToken.character_id;
    const targetToken = targetTokenId ? tokens.find((token) => token.id === targetTokenId) : null;
    const targetDisplayName = targetToken?.instance_name || targetToken?.character_name || targetToken?.monster_name || "目标";

    if (!characterId) {
      showToast("只有角色 token 才能使用阅读思想", "error");
      return false;
    }
    if (!targetToken) {
      showToast("需要选择一个目标来读取思想", "warning");
      return false;
    }
    if (targetToken.id === sourceTokenId) {
      showToast("阅读思想不能以自己为目标", "warning");
      return false;
    }
    if (!targetToken.character_id && !targetToken.monster_instance_id) {
      showToast("阅读思想只能对生物目标使用", "warning");
      return false;
    }

    const sourceSize = parseTokenSize(sourceToken.token_size);
    const targetSize = parseTokenSize(targetToken.token_size);
    const distanceFeet = getEdgeToEdgeDistance(
      sourceToken.position_x,
      sourceToken.position_y,
      sourceSize.width,
      sourceSize.height,
      targetToken.position_x,
      targetToken.position_y,
      targetSize.width,
      targetSize.height,
    ) * gridUnitLength;
    if (distanceFeet > 60) {
      showToast(`目标超出阅读思想范围（${Math.round(distanceFeet)}尺 > 60尺）`, "error");
      return false;
    }

    const currentEffects = tokenStatusEffects[sourceTokenId] || sourceToken.active_effects || [];
    const existingLink = currentEffects.find((effect) => isReadThoughtsEffect(effect, targetToken.id));
    if (existingLink) {
      const suggestionSpell = buildSuggestionSpell();
      if (!suggestionSpell) {
        showToast("未找到暗示术数据", "error");
        return false;
      }

      const apiResult = await castSpellViaAPI(
        "suggestion",
        0,
        sourceTokenId,
        [targetToken.id],
        campaignId,
        undefined,
        true, // freecast
        false,
        undefined,
        undefined,
        undefined,
        true, // targetAutoFailSave
      );

      if (!apiResult?.success) {
        showToast("暗示术施放失败", "error");
        return false;
      }

      try {
        await persistTokenActiveEffects(
          sourceTokenId,
          currentEffects.filter((effect) => !isReadThoughtsEffect(effect, targetToken.id)),
        );
      } catch (error) {
        console.error("[Action] Failed to clear Read Thoughts link after Suggestion:", error);
        showToast("暗示术已施放，但阅读思想链接同步失败", "warning");
      }

      showToast(`${sourceName} 借助阅读思想对 ${targetDisplayName} 施放了暗示术`, "success");
      publishAppEvent("combatActionUsed", { type: "action" });
      clearSelectionContextMenu();
      return true;
    }

    if ((action.uses?.current ?? 0) <= 0) {
      showToast("引导神力已用完！需要短休后恢复", "warning");
      return false;
    }

    let saveTargetData: any;
    try {
      saveTargetData = await buildSavingThrowTargetData(targetToken, "wisdom");
    } catch (error) {
      console.error("[Action] Failed to load Read Thoughts target data:", error);
      showToast("读取目标豁免数据失败", "error");
      return false;
    }

    const resourceResult = await consumeCharacterResource(
      characterId,
      "channel_divinity_cleric",
      action,
      action.name || "阅读思想",
    );
    if (!resourceResult) return false;

    const wisdomScore = Number(sourceCharacterData?.ability_scores?.wisdom || 10);
    const casterLevel = Number(sourceCharacterData?.level || sourceToken.character_level || 1);
    const spellSaveDC = 8 + getProficiencyBonus(casterLevel) + getAbilityModifier(wisdomScore);

    try {
      const queryParams = new URLSearchParams({
        user_id: userId || "anonymous",
        role: isDM ? "dm" : "player",
      });
      const response = await authedFetch(`/api/combat/saving-throw?${queryParams}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId, 10),
          source_name: sourceName,
          source_token_id: sourceTokenId,
          effect_name: "阅读思想",
          effect_description: "读取目标表层思想",
          save_type: "wisdom",
          save_dc: spellSaveDC,
          targets: [saveTargetData],
          auto_apply: false,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) {
        showToast(result?.detail || result?.error || "执行阅读思想豁免失败", "error");
        return false;
      }

      const targetResult = Array.isArray(result.result?.target_results)
        ? result.result.target_results[0]
        : null;
      if (!targetResult) {
        showToast("阅读思想结果无效", "error");
        return false;
      }

      if (!targetResult.success) {
        const nextEffects = [
          ...currentEffects,
          {
            id: `${READ_THOUGHTS_EFFECT_PREFIX}${targetToken.id}`,
            name: `阅读思想（${targetDisplayName}）`,
            icon: "🔮",
            color: "#8b5cf6",
            duration: READ_THOUGHTS_DURATION_ROUNDS,
            maxDuration: READ_THOUGHTS_DURATION_ROUNDS,
            description: "已读取该目标的表层思想。1分钟内再次对同一目标使用此能力，可免费施放暗示术，且目标自动豁免失败。",
            metadata: {
              sourceFeatureId: "read_thoughts",
              sourceTokenId,
              sourceName,
              targetTokenId: targetToken.id,
              targetName: targetDisplayName,
            },
          },
        ];

        try {
          await persistTokenActiveEffects(sourceTokenId, nextEffects);
        } catch (error) {
          console.error("[Action] Failed to persist Read Thoughts link:", error);
          showToast("保存阅读思想状态失败", "error");
        }

        sendMessage({
          type: "chat",
          data: {
            message: `🔮 **${sourceName}** 成功读取了 **${targetDisplayName}** 的表层思想！\n> DM 现在可以描述其最表层、最明显的想法。\n> 在接下来 **1分钟** 内，再次对同一目标使用【阅读思想】可免费施放 **暗示术**，且目标自动豁免失败。\n> 剩余引导神力: ${resourceResult.current}/${resourceResult.max}`,
            message_type: "combat",
          },
        });
        showToast(`${sourceName} 已读取 ${targetDisplayName} 的表层思想`, "success");
      } else {
        showToast(`${targetDisplayName} 抵抗了阅读思想`, "warning");
      }

      publishAppEvent("combatActionUsed", { type: "action" });
      clearSelectionContextMenu();
      return true;
    } catch (error) {
      console.error("[Action] Read Thoughts failed:", error);
      showToast("使用阅读思想失败", "error");
      return false;
    }
  }, [
    authedFetch,
    buildSavingThrowTargetData,
    campaignId,
    clearSelectionContextMenu,
    consumeCharacterResource,
    gridUnitLength,
    isDM,
    persistTokenActiveEffects,
    sendMessage,
    showToast,
    sourceCharacterData,
    tokenStatusEffects,
    tokens,
    userId,
  ]);

  return {
    handleReadThoughtsAction,
  };
}
