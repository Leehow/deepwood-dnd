import { useEffect } from "react";

import type { SpellOption } from "../SelectionContextMenu";
import type { Token, TacticalMapProps } from "../types/TacticalMapTypes";
import { resolveSpellCastDistance } from "../utils/mapSpellRangeUtils";
import { apiFetch } from "~/utils/api-client";
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import { showCharacterBubble } from "~/utils/characterBubble";
import {
  castSpellViaAPI,
  formatSpellChatMessage,
  buildSpellCastData,
  startSpellCastViaAPI,
  syncCharacterSpellSlotsFromBackend,
} from "~/utils/sidebarCasting";

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface UseMapSidebarSpellControllerArgs {
  tokens: Token[];
  campaignId: string;
  gridUnitLength: number;
  isDM: boolean;
  sourceCharacterData: any;
  showToast: ShowToast;
  playCast: (spellId: string, damageType?: string) => void;
  handleAreaSpellSelect: (...args: any[]) => void;
  onStartSpellTargeting?: TacticalMapProps["onStartSpellTargeting"];
  clearCloakOfShadowsEffect: (
    tokenId: number,
    reason: "attack" | "spell" | "turn_end" | "manual",
  ) => Promise<unknown>;
  clearReadyCast: (tokenId: number) => Promise<unknown>;
  getBestInvokeDuplicityDistanceToToken: (sourceTokenId: number, targetToken: Token) => number | null;
}

export function useMapSidebarSpellController({
  tokens,
  campaignId,
  gridUnitLength,
  isDM,
  sourceCharacterData,
  showToast,
  playCast,
  handleAreaSpellSelect,
  onStartSpellTargeting,
  clearCloakOfShadowsEffect,
  clearReadyCast,
  getBestInvokeDuplicityDistanceToToken,
}: UseMapSidebarSpellControllerArgs) {
  useEffect(() => {
    const handler = ({
        spell,
        slotLevel,
        characterId,
        sourceTokenId,
        mode,
        freecast,
        ritualCast,
        illusionImageUrl,
        illusionDesc,
        illusionDisplayName,
        selectedOption,
        materialId,
        runtimeAction,
        longCast,
        confirmBreakConcentration,
      }: {
        spell: SpellOption;
        slotLevel: number;
        characterId: number;
        sourceTokenId?: number;
        mode?: "area" | "single";
        freecast?: boolean;
        ritualCast?: boolean;
        illusionImageUrl?: string;
        illusionDesc?: string;
        illusionDisplayName?: string;
        selectedOption?: string;
        materialId?: string;
        runtimeAction?: Record<string, any>;
        longCast?: boolean;
        confirmBreakConcentration?: boolean;
      }) => {
      const sourceToken = (sourceTokenId
        ? tokens.find((token) => token.id === sourceTokenId)
        : undefined) || tokens.find((token) => token.character_id === characterId);
      if (!sourceToken) {
        showToast("找不到角色的地图标记", "warning");
        return;
      }

      if (mode === "area") {
        handleAreaSpellSelect(
          spell,
          sourceToken.id,
          slotLevel,
          freecast,
          illusionImageUrl,
          illusionDesc,
          illusionDisplayName,
          selectedOption,
          materialId,
          ritualCast,
          longCast,
          confirmBreakConcentration,
        );
        return;
      }

      onStartSpellTargeting?.({
        spell,
        slotLevel,
        sourceTokenId: sourceToken.id,
        characterId,
        freecast,
        ritualCast,
        illusionImageUrl,
        illusionDesc,
        illusionDisplayName,
        selectedOption,
        materialId,
        runtimeAction,
        longCast,
        confirmBreakConcentration,
      });
    };

    return subscribeAppEvent("startSpellTargeting", handler);
  }, [handleAreaSpellSelect, onStartSpellTargeting, showToast, tokens]);

  useEffect(() => {
    const handler = async ({
      spell,
      sourceTokenId,
      targetTokenId,
      targetTokenIds,
      slotLevel,
      characterId,
      freecast,
      ritualCast,
      illusionImageUrl,
      illusionDesc,
      illusionDisplayName,
      materialId,
      selectedOption: singleSelectedOption,
      runtimeAction,
      longCast,
      confirmBreakConcentration,
    }: {
      spell: SpellOption & Record<string, any>;
      sourceTokenId: number;
      targetTokenId?: number;
      targetTokenIds?: number[];
      slotLevel: number;
      characterId: number;
      freecast?: boolean;
      ritualCast?: boolean;
      illusionImageUrl?: string;
      illusionDesc?: string;
      illusionDisplayName?: string;
      materialId?: string;
      selectedOption?: string;
      runtimeAction?: Record<string, any>;
      longCast?: boolean;
      confirmBreakConcentration?: boolean;
    }) => {
      const readyCastTokenId = (spell as any).__readyCastTokenId as number | undefined;
      const runtimeActionMeta = ((spell as any).__runtimeAction || runtimeAction) as Record<string, any> | undefined;
      const activeEffectGrantMeta = (spell as any).__activeEffectGrantAction as
        | {
            effectId?: string;
            spellId: string;
            spellName?: string;
            actionKind: string;
            actionName: string;
            targetTokenId?: number;
            sourceTokenId?: number;
          }
        | undefined;

      // Normalise targets: prefer the multi-target list, fall back to the
      // singular id. Coerce numeric strings (e.g. token ids that survived a
      // JSON round-trip) so a string-typed selection from the DM hotbar's
      // multi-target banner still reaches /api/spells/cast instead of being
      // silently dropped by a strict `typeof === "number"` filter.
      const toNumericId = (value: unknown): number | null => {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string" && value.trim() !== "") {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
      };
      const resolvedTargetIds: number[] = (() => {
        if (Array.isArray(targetTokenIds) && targetTokenIds.length > 0) {
          const ids = targetTokenIds
            .map(toNumericId)
            .filter((value): value is number => value !== null);
          return Array.from(new Set(ids));
        }
        const single = toNumericId(targetTokenId);
        return single !== null ? [single] : [];
      })();

      if (resolvedTargetIds.length === 0) {
        showToast("需要选择法术目标", "error");
        return;
      }

      const sourceToken = tokens.find((token) => token.id === sourceTokenId);
      if (!sourceToken) {
        showToast("无法找到施法者", "error");
        return;
      }

      const resolvedTargets = resolvedTargetIds
        .map((tid) => tokens.find((token) => token.id === tid))
        .filter((t): t is NonNullable<typeof t> => !!t);

      if (resolvedTargets.length !== resolvedTargetIds.length) {
        showToast("无法找到部分法术目标", "error");
        return;
      }

      // Runtime-action path is always single-target; reject silently if expanded.
      if (runtimeActionMeta && resolvedTargetIds.length !== 1) {
        showToast("运行时动作仅支持单个目标", "error");
        return;
      }

      // Range-validate each selected target using the shared distance helper.
      for (const targetToken of resolvedTargets) {
        const { rangeError } = resolveSpellCastDistance({
          spell,
          sourceToken,
          targetToken,
          sourceTokenId,
          gridUnitLength,
          sourceCharacterData,
          isDM,
          getBestInvokeDuplicityDistanceToToken,
        });
        if (rangeError) {
          showToast(rangeError, "error");
          return;
        }
      }

      // Backwards-compatible single-target name shortcut for downstream toast text.
      const targetToken = resolvedTargets[0];
      const targetTokenIdFinal = resolvedTargetIds[0];

      if (activeEffectGrantMeta) {
        // Locked-target enforcement: when the persisted grant_action entry
        // carries a target_token_id (e.g. Witch Bolt's continuous link), the
        // selected target must match. The backend re-validates, but failing
        // fast here keeps the chat clean and avoids a wasted round trip.
        if (
          typeof activeEffectGrantMeta.targetTokenId === "number"
          && activeEffectGrantMeta.targetTokenId !== targetTokenIdFinal
        ) {
          showToast("该法术动作只能对原始目标使用", "error");
          return;
        }
        try {
          const response = await apiFetch("/api/spells/granted-actions/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campaign_id: Number(campaignId),
              caster_token_id: sourceTokenId,
              target_token_id: targetTokenIdFinal,
              effect_id: activeEffectGrantMeta.effectId,
              spell_id: activeEffectGrantMeta.spellId,
              action_kind: activeEffectGrantMeta.actionKind,
              action_name: activeEffectGrantMeta.actionName,
            }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data?.success) {
            showToast(data?.error || "法术动作执行失败", "error");
            return;
          }

          const casterName = sourceToken.instance_name || sourceToken.character_name || "施法者";
          const targetName = targetToken.instance_name || targetToken.monster_name || "目标";
          const actionName = activeEffectGrantMeta.actionName || spell.name;
          const sourceSpellName = activeEffectGrantMeta.spellName || spell.name;
          playCast(activeEffectGrantMeta.spellId, spell.damageType);
          if (data.narrative) {
            showToast(data.narrative, data.total_damage > 0 ? "success" : "info", 4000);
          } else {
            showToast(`${casterName} 对 ${targetName} 执行了 ${actionName}`, "success");
          }
          publishAppEvent("spellCastChat", {
            message: data.narrative
              || `🔮 **${casterName}** 对 **${targetName}** 执行了 **${actionName}**（${sourceSpellName}）`,
            characterId,
            spellCastData: buildSpellCastData(sourceSpellName, 0, data),
          });
          if (sourceToken.character_id) {
            showCharacterBubble({
              characterId: sourceToken.character_id,
              characterName: casterName,
              message: `🔮 ${actionName}`,
              type: "combat",
            });
          }
          if (readyCastTokenId) {
            await clearReadyCast(readyCastTokenId);
          }
          return;
        } catch {
          showToast("法术动作执行失败", "error");
          return;
        }
      }

      if (runtimeActionMeta) {
        try {
          const response = await apiFetch("/api/spells/runtime-actions/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              runtime_instance_id: runtimeActionMeta.runtimeInstanceId ?? runtimeActionMeta.runtime_instance_id,
              action_id: runtimeActionMeta.actionId ?? runtimeActionMeta.action_id,
              actor_token_id: sourceTokenId,
              target_token_id: targetTokenIdFinal,
            }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data?.success) {
            showToast(data?.error || "运行时法术动作执行失败", "error");
            return;
          }

          const casterName = sourceToken.instance_name || sourceToken.character_name || "施法者";
          const targetName = targetToken.instance_name || targetToken.monster_name || "目标";
          const actionName = runtimeActionMeta.actionName ?? runtimeActionMeta.action_name ?? spell.name;
          showToast(`${casterName} 对 ${targetName} 执行了 ${actionName}`, "success");
          publishAppEvent("spellCastChat", {
            message: `🔮 **${casterName}** 对 **${targetName}** 执行了 **${actionName}**`,
            characterId,
          });
          await clearCloakOfShadowsEffect(sourceTokenId, "spell");
          if (readyCastTokenId) {
            await clearReadyCast(readyCastTokenId);
          }
          return;
        } catch {
          showToast("运行时法术动作执行失败", "error");
          return;
        }
      }

      // Long-cast / ritual cast: target token chosen — record it on
      // `casting_in_progress.target_token_ids` via /api/spells/start-cast
      // instead of resolving the spell now. Slot semantics handled at release.
      if (longCast) {
        const startResult = await startSpellCastViaAPI(
          spell.id,
          slotLevel,
          sourceTokenId,
          campaignId,
          undefined,
          {
            freecast,
            ritualCast,
            confirmBreakConcentration,
            selectedOption: singleSelectedOption,
            materialId,
            targetTokenIds: resolvedTargetIds,
          },
        );
        if (!startResult || !startResult.success) {
          showToast(startResult?.error || "开始施法失败", "error");
          return;
        }
        const casterName = sourceToken.instance_name || sourceToken.character_name || "施法者";
        const prefix = ritualCast ? "开始进行仪式施法" : "开始长时间施法";
        playCast(spell.id, spell.damageType);
        showToast(`${casterName} ${prefix}「${spell.name}」`, "info");
        publishAppEvent("spellCastChat", {
          message: `⏳ ${prefix}【${spell.name}】`,
          characterId,
        });
        if (readyCastTokenId) {
          await clearReadyCast(readyCastTokenId);
        }
        return;
      }

      // 所有法术均已迁移至结构化 effects[]，统一走 castSpellViaAPI → 后端 SpellResolver
      const apiResult = await castSpellViaAPI(
        spell.id,
        slotLevel,
        sourceTokenId,
        resolvedTargetIds,
        campaignId,
        undefined,
        freecast,
        ritualCast,
        singleSelectedOption,
        materialId,
        {
          imageUrl: illusionImageUrl || undefined,
          description: illusionDesc || undefined,
          displayName: illusionDisplayName || undefined,
        },
      );

      if (!apiResult?.success) {
        showToast("施法失败", "error");
        return;
      }

      // 后端已扣除法术位，同步权威状态
      void syncCharacterSpellSlotsFromBackend(characterId, { delayMs: 50 });
      const casterName = sourceToken.instance_name || sourceToken.character_name || "施法者";
      const slotText = slotLevel > 0 ? `(${slotLevel}环)` : "(戏法)";
      playCast(spell.id, spell.damageType);

      if (apiResult.narrative) {
        showToast(apiResult.narrative, apiResult.total_damage > 0 ? "success" : "info", 4000);
      } else {
        const targetName = targetToken.instance_name || targetToken.monster_name || "目标";
        showToast(`${casterName} 对 ${targetName} 施放了 ${spell.name} ${slotText}`, "success");
      }

      publishAppEvent("spellCastChat", {
        message: formatSpellChatMessage(spell.name, slotLevel, apiResult),
        characterId,
        spellCastData: buildSpellCastData(spell.name, slotLevel, apiResult),
      });

      if (sourceToken.character_id) {
        showCharacterBubble({
          characterId: sourceToken.character_id,
          characterName: casterName,
          message: `🔮 ${spell.name}`,
          type: "combat",
        });
      }

      await clearCloakOfShadowsEffect(sourceTokenId, "spell");

      if (readyCastTokenId) {
        await clearReadyCast(readyCastTokenId);
      }
    };

    return subscribeAppEvent("sidebarSpellCast", handler);
  }, [
    campaignId,
    clearCloakOfShadowsEffect,
    clearReadyCast,
    getBestInvokeDuplicityDistanceToToken,
    gridUnitLength,
    isDM,
    playCast,
    showToast,
    sourceCharacterData,
    tokens,
  ]);
}
