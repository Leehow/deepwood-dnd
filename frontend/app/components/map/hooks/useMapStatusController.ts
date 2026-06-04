import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

import { isAppearanceIllusionSpell } from "~/components/spell/spell-constants";
import { createLogger } from "~/utils/logger";
import { buildTokenDisplayStatusEffects } from "../utils/runtimeSpellBadgeStatusUtils";

import type {
  CastingCancelConfirmState,
  CastingCompleteConfirmState,
  ConcentrationBreakConfirmState,
  ConcentrationDurationEditState,
  RitualCastingInfoState,
  StatusEffectDetailState,
  StatusEffectRemoveConfirmState,
} from "../MapStatusDialogs";
import type { Token } from "../types/TacticalMapTypes";

const logger = createLogger("useMapStatusController");

type ShowToastFn = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface UseMapStatusControllerArgs {
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  campaignId: string;
  spellList: any[];
  tokens: Token[];
  setTokens: (updater: (prev: Token[]) => Token[]) => void;
  setTokenStatusEffects: Dispatch<SetStateAction<Record<number, any[]>>>;
  showToast: ShowToastFn;
  handleAreaSpellSelect: (...args: any[]) => void;
  onStartSpellTargeting?: (payload: any) => void;
}

function findSpellByNameOrId(spellList: any[], value: string) {
  return spellList.find(
    (spell: any) =>
      spell.id === value ||
      spell.name === value ||
      spell.nameEn === value ||
      spell.name_en === value,
  );
}

function stripRuntimeSpellStateFromToken(token: Token, options: {
  runtimeInstanceId: number;
  runtimeSpellId?: string | null;
  runtimeSourceTokenId?: number | null;
  endsConcentration?: boolean;
}): Token {
  const {
    runtimeInstanceId,
    runtimeSpellId,
    runtimeSourceTokenId,
    endsConcentration,
  } = options;
  const shouldStripLegacySpellBuff = (effect: any) =>
    !!effect?.spell_buff
    && (!!runtimeSpellId ? effect.spell_id === runtimeSpellId : true)
    && (
      runtimeSourceTokenId == null
      || effect.source_token_id == null
      || String(effect.source_token_id) === String(runtimeSourceTokenId)
    );

  const nextActiveEffects = Array.isArray(token.active_effects)
    ? token.active_effects.filter((effect: any) => !shouldStripLegacySpellBuff(effect))
    : token.active_effects;
  const nextSpellOverlays = Array.isArray(token.spell_overlays)
    ? token.spell_overlays.filter((overlay: any) => overlay?.runtime_instance_id !== runtimeInstanceId)
    : token.spell_overlays;
  const nextSpellBadges = Array.isArray(token.spell_badges)
    ? token.spell_badges.filter((badge: any) => badge?.runtime_instance_id !== runtimeInstanceId)
    : token.spell_badges;
  const nextSpellVisuals = Array.isArray(token.spell_visuals)
    ? token.spell_visuals.filter((visual: any) => {
      if (visual?.runtime_instance_id === runtimeInstanceId) {
        return false;
      }
      if (
        runtimeSpellId
        && visual?.spell_id === runtimeSpellId
        && (
          runtimeSourceTokenId == null
          || visual?.source_token_id == null
          || String(visual.source_token_id) === String(runtimeSourceTokenId)
        )
      ) {
        return false;
      }
      return true;
    })
    : token.spell_visuals;
  const nextAttachedRuntimeRefs = Array.isArray(token.attached_runtime_refs)
    ? token.attached_runtime_refs.filter((ref: any) => ref?.runtime_instance_id !== runtimeInstanceId)
    : token.attached_runtime_refs;
  const nextGrantedActionsUi = Array.isArray(token.granted_actions_ui)
    ? token.granted_actions_ui.filter((action: any) => action?.runtime_instance_id !== runtimeInstanceId)
    : token.granted_actions_ui;
  const nextConcentrationSpell = (
    endsConcentration
    && runtimeSourceTokenId != null
    && String(token.id) === String(runtimeSourceTokenId)
    && token.concentration_spell
    && (!runtimeSpellId || token.concentration_spell.spell_id === runtimeSpellId)
  )
    ? null
    : token.concentration_spell;

  return {
    ...token,
    active_effects: nextActiveEffects,
    spell_overlays: nextSpellOverlays,
    spell_badges: nextSpellBadges,
    spell_visuals: nextSpellVisuals,
    attached_runtime_refs: nextAttachedRuntimeRefs,
    granted_actions_ui: nextGrantedActionsUi,
    concentration_spell: nextConcentrationSpell,
  };
}

function stripRuntimeSpellStateFromEffects(
  effects: any[] | undefined,
  options: {
    effectId: string;
    runtimeInstanceId: number;
    runtimeSpellId?: string | null;
    runtimeSourceTokenId?: number | null;
  },
): any[] {
  const {
    effectId,
    runtimeInstanceId,
    runtimeSpellId,
    runtimeSourceTokenId,
  } = options;
  return (effects || []).filter((effect) => {
    if (!effect) return false;
    if (effect.id === effectId) return false;
    if (effect.runtime_instance_id === runtimeInstanceId) return false;
    if (
      effect.spell_buff
      && runtimeSpellId
      && effect.spell_id === runtimeSpellId
      && (
        runtimeSourceTokenId == null
        || effect.source_token_id == null
        || String(effect.source_token_id) === String(runtimeSourceTokenId)
      )
    ) {
      return false;
    }
    return true;
  });
}

export function useMapStatusController({
  authedFetch,
  campaignId,
  spellList,
  tokens,
  setTokens,
  setTokenStatusEffects,
  showToast,
  handleAreaSpellSelect,
  onStartSpellTargeting,
}: UseMapStatusControllerArgs) {
  const [concentrationSpellDetail, setConcentrationSpellDetail] = useState<any | null>(null);
  const [showConcentrationRulesInfo, setShowConcentrationRulesInfo] = useState(false);
  const [ritualCastingInfo, setRitualCastingInfo] = useState<RitualCastingInfoState | null>(null);
  const [statusEffectDetail, setStatusEffectDetail] = useState<StatusEffectDetailState | null>(null);
  const [statusEffectRemoveConfirm, setStatusEffectRemoveConfirm] =
    useState<StatusEffectRemoveConfirmState | null>(null);
  const [concBreakConfirm, setConcBreakConfirm] =
    useState<ConcentrationBreakConfirmState | null>(null);
  const [castingCancelConfirm, setCastingCancelConfirm] =
    useState<CastingCancelConfirmState | null>(null);
  const [castingCompleteConfirm, setCastingCompleteConfirm] =
    useState<CastingCompleteConfirmState | null>(null);
  const [concDurationEdit, setConcDurationEdit] =
    useState<ConcentrationDurationEditState | null>(null);
  const [concDurationInput, setConcDurationInput] = useState("");

  const handleTokenStatusEffectClick = useCallback((effect: any) => {
    if (effect.spell_buff && effect.spell_id) {
      const found = findSpellByNameOrId(spellList, effect.spell_id) || findSpellByNameOrId(spellList, effect.name);
      if (found) {
        setConcentrationSpellDetail(found);
        return;
      }
    }
    setStatusEffectDetail(effect);
  }, [spellList]);

  const handleTokenConcentrationSpellClick = useCallback((spellName: string) => {
    const found = findSpellByNameOrId(spellList, spellName);
    if (found) setConcentrationSpellDetail(found);
  }, [spellList]);

  const handleTokenCastingSpellClick = useCallback((spellName: string) => {
    const found = findSpellByNameOrId(spellList, spellName);
    if (found) setConcentrationSpellDetail(found);
  }, [spellList]);

  const handleTokenCastingModeInfoClick = useCallback((tokenId: number) => {
    const token = tokens.find((candidate) => candidate.id === tokenId);
    const casting = token?.casting_in_progress;
    if (!token || !casting || casting.cast_mode !== "ritual") return;
    setRitualCastingInfo({
      tokenName: token.instance_name || token.character_name || token.monster_name || "该单位",
      spellName: casting.spell_name || "该法术",
    });
  }, [tokens]);

  const handleTokenConcentrationInfoClick = useCallback(() => {
    setShowConcentrationRulesInfo(true);
  }, []);

  const handleTokenConcentrationDurationChange = useCallback(async (tokenId: number, delta: number) => {
    const token = tokens.find((candidate) => candidate.id === tokenId);
    if (!token?.concentration_spell) return;

    const durationRounds = token.concentration_spell.duration_rounds ?? 0;
    const currentRound = token.concentration_spell.current_round ?? 0;
    const remaining = durationRounds - currentRound;
    const newRemaining = remaining + delta;

    if (newRemaining <= 0) {
      const spellId = token.concentration_spell.spell_id;
      try {
        await authedFetch(`/api/tokens/${tokenId}/concentration?reason=duration_expired`, {
          method: "DELETE",
        });

        let newEffects = token.active_effects;
        if (
          spellId &&
          token.active_effects?.some((effect: any) => effect.spell_buff && effect.spell_id === spellId)
        ) {
          newEffects = token.active_effects.filter(
            (effect: any) => !(effect.spell_buff && effect.spell_id === spellId),
          );
          await authedFetch(`/api/tokens/${tokenId}/active-effects`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active_effects: newEffects }),
          });
          setTokenStatusEffects((previous) => ({
            ...previous,
            [tokenId]: (previous[tokenId] || []).filter((effect) => effect.id !== `${spellId}_buff`),
          }));
        }

        setTokens((previous) =>
          previous.map((candidate) =>
            candidate.id === tokenId
              ? { ...candidate, concentration_spell: null, active_effects: newEffects }
              : candidate,
          ),
        );
        showToast(`${token.instance_name || token.character_name || "Token"} 的专注已结束`, "info");
      } catch (error) {
        logger.error("Failed to break concentration:", error);
      }
      return;
    }

    const newDurationRounds = currentRound + newRemaining;
    try {
      await authedFetch(`/api/tokens/${tokenId}/concentration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concentration_spell: { ...token.concentration_spell, duration_rounds: newDurationRounds },
        }),
      });
      setTokens((previous) =>
        previous.map((candidate) =>
          candidate.id === tokenId
            ? {
                ...candidate,
                concentration_spell: {
                  ...candidate.concentration_spell!,
                  duration_rounds: newDurationRounds,
                },
              }
            : candidate,
        ),
      );
    } catch (error) {
      logger.error("Failed to update concentration duration:", error);
    }
  }, [authedFetch, setTokenStatusEffects, setTokens, showToast, tokens]);

  const handleTokenConcentrationDurationEdit = useCallback((tokenId: number, currentRemaining: number) => {
    setConcDurationEdit({ tokenId, currentRemaining });
    setConcDurationInput(String(currentRemaining));
  }, []);

  const handleTokenConcentrationBreak = useCallback((tokenId: number) => {
    const token = tokens.find((candidate) => candidate.id === tokenId);
    const name = token?.instance_name || token?.character_name || token?.monster_name || "Token";
    const spellName = token?.concentration_spell?.spell_name || "未知法术";
    setConcBreakConfirm({ tokenId, name, spellName });
  }, [tokens]);

  const executeTokenCastingCancel = useCallback(async (tokenId: number) => {
    try {
      const response = await authedFetch(`/api/spells/cast/${tokenId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("取消施法失败");
      setTokens((previous) =>
        previous.map((token) => (token.id === tokenId ? { ...token, casting_in_progress: null } : token)),
      );
      showToast("已取消施法", "info");
    } catch (error: any) {
      showToast(error.message || "取消施法失败", "error");
    }
  }, [authedFetch, setTokens, showToast]);

  const handleTokenCastingCancel = useCallback((tokenId: number) => {
    const token = tokens.find((candidate) => candidate.id === tokenId);
    const casting = token?.casting_in_progress;
    if (!token || !casting) return;
    setCastingCancelConfirm({
      tokenId,
      tokenName: token.instance_name || token.character_name || token.monster_name || "该单位",
      spellName: casting.spell_name || "该法术",
    });
  }, [tokens]);

  const executeTokenCastingCompleteNow = useCallback(async (tokenId: number) => {
    try {
      const token = tokens.find((candidate) => candidate.id === tokenId);
      const casting = token?.casting_in_progress;
      if (!token || !casting) return;
      const resolveAsFreecast = !!casting.freecast || casting.cast_mode === "ritual";

      if (casting.status === "ready") {
        const spell =
          findSpellByNameOrId(spellList, casting.spell_id) ||
          findSpellByNameOrId(spellList, casting.spell_name);
        if (!spell) {
          showToast("找不到待释放法术的数据", "error");
          return;
        }

        const releaseSpell = { ...spell, __readyCastTokenId: token.id } as any;
        if (releaseSpell.areaOfEffect || releaseSpell.area_of_effect) {
          // Replay the area the caster chose at start-cast time
          // (stored on casting_in_progress.area_effect) so the DM
          // doesn't have to re-pick the placement at release time.
          const preselectedArea = (casting as any).area_effect ?? null;
          handleAreaSpellSelect(
            releaseSpell,
            token.id,
            casting.slot_level,
            resolveAsFreecast,
            undefined,
            undefined,
            undefined,
            casting.selected_option || undefined,
            casting.material_id || undefined,
            casting.cast_mode === "ritual",
            undefined, // longCast: release uses the normal resolution path
            undefined, // confirmBreakConcentration handled at start-cast time
            preselectedArea,
          );
          showToast(
            preselectedArea
              ? `「${casting.spell_name}」已就绪，请确认施法`
              : `请选择「${casting.spell_name}」的释放区域`,
            "info",
          );
          return;
        }

        if (token.character_id && onStartSpellTargeting) {
          onStartSpellTargeting({
            spell: releaseSpell,
            slotLevel: casting.slot_level,
            sourceTokenId: token.id,
            characterId: token.character_id,
            freecast: resolveAsFreecast,
            ritualCast: casting.cast_mode === "ritual",
            selectedOption: casting.selected_option || undefined,
            materialId: casting.material_id || undefined,
          });
          showToast(`请选择「${casting.spell_name}」的目标`, "info");
          return;
        }

        showToast("该法术需要先指定目标或区域，但当前无法进入选择模式", "error");
        return;
      }

      const response = await authedFetch("/api/spells/complete-cast-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spell_id: casting.spell_id,
          slot_level: casting.slot_level,
          caster_token_id: tokenId,
          campaign_id: parseInt(campaignId, 10),
          target_token_ids: casting.target_token_ids || [],
          freecast: resolveAsFreecast,
          ritual_cast: casting.cast_mode === "ritual",
          selected_option: casting.selected_option,
          material_id: casting.material_id,
        }),
      });
      if (!response.ok) throw new Error("立即完成施法失败");
      setTokens((previous) =>
        previous.map((item) => (item.id === tokenId ? { ...item, casting_in_progress: null } : item)),
      );
      showToast("长时间施法已立即完成", "success");
    } catch (error: any) {
      showToast(error.message || "立即完成施法失败", "error");
    }
  }, [authedFetch, campaignId, handleAreaSpellSelect, onStartSpellTargeting, setTokens, showToast, spellList, tokens]);

  const handleTokenCastingCompleteNow = useCallback((tokenId: number) => {
    const token = tokens.find((candidate) => candidate.id === tokenId);
    const casting = token?.casting_in_progress;
    if (!token || !casting) return;
    setCastingCompleteConfirm({
      tokenId,
      tokenName: token.instance_name || token.character_name || token.monster_name || "该单位",
      spellName: casting.spell_name || "该法术",
      isReadyToRelease: casting.status === "ready",
    });
  }, [tokens]);

  const executeTokenStatusEffectRemove = useCallback(async (payload: StatusEffectRemoveConfirmState) => {
    try {
      const tokenId = payload.tokenId;
      const effectId = payload.effectId;
      const token = tokens.find((candidate) => candidate.id === tokenId);

      if (payload.runtimeInstanceId) {
        if (payload.runtimeEndsConcentration && payload.runtimeSourceTokenId) {
          const response = await authedFetch(
            `/api/tokens/${payload.runtimeSourceTokenId}/concentration?reason=manual_break`,
            { method: "DELETE" },
          );
          if (!response.ok) throw new Error("解除专注失败");
        } else {
          const response = await authedFetch(
            `/api/spells/runtime-instances/${payload.runtimeInstanceId}`,
            { method: "DELETE" },
          );
          if (!response.ok) throw new Error("移除法术失败");
        }

        setTokenStatusEffects((previous) => {
          const nextEntries = Object.entries(previous).map(([key, effects]) => [
            key,
            stripRuntimeSpellStateFromEffects(effects, {
              effectId: payload.effectId,
              runtimeInstanceId: payload.runtimeInstanceId!,
              runtimeSpellId: payload.runtimeSpellId,
              runtimeSourceTokenId: payload.runtimeSourceTokenId,
            }),
          ]);
          return Object.fromEntries(nextEntries);
        });
        setTokens((previous) =>
          previous.map((candidate) =>
            stripRuntimeSpellStateFromToken(candidate, {
              runtimeInstanceId: payload.runtimeInstanceId!,
              runtimeSpellId: payload.runtimeSpellId,
              runtimeSourceTokenId: payload.runtimeSourceTokenId,
              endsConcentration: payload.runtimeEndsConcentration,
            }),
          ),
        );
        showToast(
          payload.runtimeEndsConcentration ? "已解除专注并移除法术" : "已移除法术",
          "success",
        );
        return;
      }

      const currentEffects = token?.active_effects || [];
      const removedEffect = currentEffects.find((effect: any) => effect.id === effectId);
      const filtered = currentEffects.filter((effect: any) => effect.id !== effectId);

      setTokenStatusEffects((previous) => ({
        ...previous,
        [tokenId]: filtered,
      }));
      setTokens((previous) =>
        previous.map((candidate) =>
          candidate.id === tokenId
            ? { ...candidate, active_effects: filtered.length > 0 ? filtered : null }
            : candidate,
        ),
      );

      const response = await authedFetch(`/api/tokens/${tokenId}/active-effects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_effects: filtered }),
      });
      if (!response.ok) throw new Error("删除效果失败");

      if (token?.concentration_spell) {
        const concentrationSpellId = token.concentration_spell.spell_id;
        if (effectId === `spell_buff_${concentrationSpellId}` || effectId === `${concentrationSpellId}_buff`) {
          await authedFetch(`/api/tokens/${tokenId}/concentration`, { method: "DELETE" });
        }
      }

      if (removedEffect?.spell_buff && isAppearanceIllusionSpell(removedEffect.spell_id)) {
        setTokens((previous) =>
          previous.map((candidate) =>
            candidate.id === tokenId ? { ...candidate, disguise_data: null } : candidate,
          ),
        );
        try {
          await authedFetch(`/api/tokens/${tokenId}/disguise`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ disguise_data: null }),
          });
        } catch (error) {
          logger.error("[onStatusEffectRemove] Failed to clear disguise:", error);
        }
      }

      showToast("已移除效果", "success");
    } catch (error: any) {
      showToast(error.message || "删除效果失败", "error");
    }
  }, [authedFetch, setTokenStatusEffects, setTokens, showToast, tokens]);

  const handleTokenStatusEffectRemove = useCallback((tokenId: number, effect: any) => {
    const token = tokens.find((candidate) => candidate.id === tokenId);
    const displayEffect = token
      ? buildTokenDisplayStatusEffects({
          activeEffects: Array.isArray(token.active_effects) ? token.active_effects : [],
          spellBadges: token.spell_badges,
          spellOverlays: token.spell_overlays,
        }).find((candidate) => candidate.id === effect?.id)
      : null;
    const resolvedEffect = displayEffect || effect || (token?.active_effects || []).find((candidate: any) => candidate.id === effect?.id);
    const runtimeInstanceId = resolvedEffect?.runtime_instance_id ?? null;
    const runtimeSourceToken = runtimeInstanceId
      ? tokens.find((candidate) =>
          (candidate.spell_overlays || []).some(
            (overlay: any) =>
              overlay?.runtime_instance_id === runtimeInstanceId
              && overlay?.role === "source",
          ),
        )
      : null;
    const runtimeSourceTokenId = runtimeSourceToken?.id ?? null;
    const runtimeEndsConcentration = !!(
      runtimeInstanceId
      && runtimeSourceToken?.concentration_spell
      && (!resolvedEffect?.spell_id || runtimeSourceToken.concentration_spell.spell_id === resolvedEffect.spell_id)
    );
    if (!token || !resolvedEffect) return;
    setStatusEffectRemoveConfirm({
      tokenId,
      effectId: resolvedEffect.id,
      tokenName: token.instance_name || token.character_name || token.monster_name || "该单位",
      effectName: resolvedEffect.name || "该效果",
      runtimeInstanceId,
      runtimeSourceTokenId,
      runtimeSpellId: resolvedEffect.spell_id ?? null,
      runtimeEndsConcentration,
    });
  }, [tokens]);

  const handleConfirmStatusEffectRemove = useCallback(async () => {
    const payload = statusEffectRemoveConfirm;
    if (!payload) return;
    setStatusEffectRemoveConfirm(null);
    await executeTokenStatusEffectRemove(payload);
  }, [executeTokenStatusEffectRemove, statusEffectRemoveConfirm]);

  const handleConfirmCastingCancel = useCallback(async () => {
    const payload = castingCancelConfirm;
    if (!payload) return;
    setCastingCancelConfirm(null);
    await executeTokenCastingCancel(payload.tokenId);
  }, [castingCancelConfirm, executeTokenCastingCancel]);

  const handleConfirmCastingComplete = useCallback(async () => {
    const payload = castingCompleteConfirm;
    if (!payload) return;
    setCastingCompleteConfirm(null);
    await executeTokenCastingCompleteNow(payload.tokenId);
  }, [castingCompleteConfirm, executeTokenCastingCompleteNow]);

  const handleConfirmConcentrationBreak = useCallback(async () => {
    const payload = concBreakConfirm;
    if (!payload) return;

    const { tokenId, name } = payload;
    const token = tokens.find((item) => item.id === tokenId);
    const spellId = token?.concentration_spell?.spell_id;
    const affectedIds = token?.concentration_spell?.affected_token_ids || [];
    setConcBreakConfirm(null);

    try {
      await authedFetch(`/api/tokens/${tokenId}/concentration?reason=manual_break`, {
        method: "DELETE",
      });

      if (spellId && token?.active_effects?.some((effect: any) => effect.spell_buff && effect.spell_id === spellId)) {
        const newEffects = token.active_effects.filter(
          (effect: any) => !(effect.spell_buff && effect.spell_id === spellId),
        );
        await authedFetch(`/api/tokens/${tokenId}/active-effects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active_effects: newEffects }),
        });
        setTokens((previous) =>
          previous.map((item) =>
            item.id === tokenId ? { ...item, concentration_spell: null, active_effects: newEffects } : item,
          ),
        );
        setTokenStatusEffects((previous) => ({
          ...previous,
          [tokenId]: (previous[tokenId] || []).filter((effect) => effect.id !== `${spellId}_buff`),
        }));
      } else {
        setTokens((previous) =>
          previous.map((item) => (item.id === tokenId ? { ...item, concentration_spell: null } : item)),
        );
      }

      if (spellId && affectedIds.length > 0) {
        for (const affectedId of affectedIds) {
          const affectedToken = tokens.find((item) => item.id === affectedId);
          if (
            affectedToken?.active_effects?.some(
              (effect: any) => effect.spell_buff && effect.spell_id === spellId,
            )
          ) {
            const newEffects = affectedToken.active_effects.filter(
              (effect: any) => !(effect.spell_buff && effect.spell_id === spellId),
            );
            await authedFetch(`/api/tokens/${affectedId}/active-effects`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ active_effects: newEffects }),
            });
          }
        }
      }

      showToast(`${name} 的专注已解除`, "info");
    } catch (error) {
      logger.error("Failed to break concentration:", error);
    }
  }, [authedFetch, concBreakConfirm, setTokenStatusEffects, setTokens, showToast, tokens]);

  const handleConfirmConcentrationDurationEdit = useCallback(async () => {
    const newRemaining = parseInt(concDurationInput, 10);
    if (Number.isNaN(newRemaining) || newRemaining < 0 || !concDurationEdit) {
      return;
    }

    const { tokenId } = concDurationEdit;
    const token = tokens.find((item) => item.id === tokenId);
    if (!token?.concentration_spell) {
      setConcDurationEdit(null);
      return;
    }

    const currentRound = token.concentration_spell.current_round ?? 0;
    setConcDurationEdit(null);

    if (newRemaining <= 0) {
      const spellId = token.concentration_spell.spell_id;
      try {
        await authedFetch(`/api/tokens/${tokenId}/concentration?reason=duration_expired`, {
          method: "DELETE",
        });
        let newEffects = token.active_effects;
        if (
          spellId &&
          token.active_effects?.some((effect: any) => effect.spell_buff && effect.spell_id === spellId)
        ) {
          newEffects = token.active_effects.filter(
            (effect: any) => !(effect.spell_buff && effect.spell_id === spellId),
          );
          await authedFetch(`/api/tokens/${tokenId}/active-effects`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active_effects: newEffects }),
          });
          setTokenStatusEffects((previous) => ({
            ...previous,
            [tokenId]: (previous[tokenId] || []).filter((effect) => effect.id !== `${spellId}_buff`),
          }));
        }
        setTokens((previous) =>
          previous.map((item) =>
            item.id === tokenId ? { ...item, concentration_spell: null, active_effects: newEffects } : item,
          ),
        );
        showToast("专注已结束", "info");
      } catch (error) {
        logger.error("Failed to break concentration:", error);
      }
      return;
    }

    const durationRounds = currentRound + newRemaining;
    try {
      await authedFetch(`/api/tokens/${tokenId}/concentration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concentration_spell: { ...token.concentration_spell, duration_rounds: durationRounds },
        }),
      });
      setTokens((previous) =>
        previous.map((item) =>
          item.id === tokenId
            ? {
                ...item,
                concentration_spell: {
                  ...item.concentration_spell!,
                  duration_rounds: durationRounds,
                },
              }
            : item,
        ),
      );
    } catch (error) {
      logger.error("Failed to update concentration duration:", error);
    }
  }, [authedFetch, concDurationEdit, concDurationInput, setTokenStatusEffects, setTokens, showToast, tokens]);

  return {
    castingCancelConfirm,
    castingCompleteConfirm,
    concBreakConfirm,
    concDurationEdit,
    concDurationInput,
    concentrationSpellDetail,
    handleConfirmCastingCancel,
    handleConfirmCastingComplete,
    handleConfirmConcentrationBreak,
    handleConfirmConcentrationDurationEdit,
    handleConfirmStatusEffectRemove,
    handleTokenCastingCancel,
    handleTokenCastingCompleteNow,
    handleTokenCastingModeInfoClick,
    handleTokenCastingSpellClick,
    handleTokenConcentrationBreak,
    handleTokenConcentrationDurationChange,
    handleTokenConcentrationDurationEdit,
    handleTokenConcentrationInfoClick,
    handleTokenConcentrationSpellClick,
    handleTokenStatusEffectClick,
    handleTokenStatusEffectRemove,
    ritualCastingInfo,
    setCastingCancelConfirm,
    setCastingCompleteConfirm,
    setConcBreakConfirm,
    setConcDurationEdit,
    setConcDurationInput,
    setConcentrationSpellDetail,
    setRitualCastingInfo,
    setShowConcentrationRulesInfo,
    setStatusEffectDetail,
    setStatusEffectRemoveConfirm,
    showConcentrationRulesInfo,
    statusEffectDetail,
    statusEffectRemoveConfirm,
  };
}
