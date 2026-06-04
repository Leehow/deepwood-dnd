import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { Maneuver } from "../SelectionContextMenu";
import type { Token } from "../types/TacticalMapTypes";
import { getEdgeToEdgeDistance, parseTokenSize } from "../utils/mapCalculations";
import { publishAppEvent } from "~/events/appEventBus";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapManeuverController");

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface PendingManeuverEntry {
  maneuver: Maneuver;
  targetTokenId?: number;
  timestamp: number;
}

export type PendingManeuverState = Record<number, PendingManeuverEntry | null>;

interface UseMapManeuverControllerArgs {
  tokens: Token[];
  pendingManeuvers: PendingManeuverState;
  tokenStatusEffects: Record<number, any[]>;
  sourceCharacterData: any;
  authedFetch: AuthedFetch;
  showToast: ShowToast;
  sendMessage: (payload: any) => void;
  setTokens: Dispatch<SetStateAction<Token[]>>;
  setSourceCharacterData: Dispatch<SetStateAction<any>>;
  setSelectionContextMenu: Dispatch<SetStateAction<any>>;
  setPendingManeuvers: Dispatch<SetStateAction<PendingManeuverState>>;
  setTokenStatusEffects: Dispatch<SetStateAction<Record<number, any[]>>>;
}

const IMMEDIATE_MANEUVER_TIMINGS = new Set(["bonus_action", "attack_action"]);

const MANEUVER_TIMING_LABELS: Record<string, string> = {
  on_hit: "攻击命中时",
  on_attack: "发起攻击时",
  on_attack_roll: "攻击骰时",
  on_move: "移动时",
  reaction_on_hit: "被命中时",
  reaction_on_miss: "敌人未命中时",
};

const ABILITY_CN: Record<string, string> = {
  strength: "力量",
  dexterity: "敏捷",
  constitution: "体质",
  intelligence: "智力",
  wisdom: "感知",
  charisma: "魅力",
};

function getTokenDisplayName(token: Token | null | undefined, fallback: string) {
  return (
    token?.instance_name
    || (token as any)?.character_name
    || (token as any)?.monster_name
    || fallback
  );
}

function rollDie(die: string) {
  const dieMax = parseInt(String(die).replace("d", ""), 10) || 0;
  return dieMax > 0 ? Math.floor(Math.random() * dieMax) + 1 : 0;
}

export function useMapManeuverController({
  tokens,
  pendingManeuvers,
  tokenStatusEffects,
  sourceCharacterData,
  authedFetch,
  showToast,
  sendMessage,
  setTokens,
  setSourceCharacterData,
  setSelectionContextMenu,
  setPendingManeuvers,
  setTokenStatusEffects,
}: UseMapManeuverControllerArgs) {
  const consumeSuperiorityDie = useCallback(async (characterId: number) => {
    const maneuversData = sourceCharacterData?.maneuvers_data;
    if (!maneuversData || maneuversData.superiority_dice.current <= 0) {
      showToast("没有可用的战技骰", "error");
      return null;
    }

    const newDiceCount = maneuversData.superiority_dice.current - 1;
    const maxUses = maneuversData.superiority_dice.max;
    const response = await authedFetch(`/api/characters/${characterId}/feature-uses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature_id: "superiority_dice",
        current_uses: newDiceCount,
        max_uses: maxUses,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      showToast(error.detail || "消耗战技骰失败", "error");
      return null;
    }

    setSourceCharacterData((previous: any) => ({
      ...previous,
      maneuvers_data: {
        ...previous?.maneuvers_data,
        superiority_dice: {
          ...previous?.maneuvers_data?.superiority_dice,
          current: newDiceCount,
        },
      },
    }));
    publishAppEvent("classFeatureUsesUpdated", {
      characterId,
      featureId: "superiority_dice",
      currentUses: newDiceCount,
      maxUses,
    });

    const dieName = maneuversData.superiority_dice.die;
    return {
      dieName,
      dieRoll: rollDie(dieName),
      newDiceCount,
      maxUses,
    };
  }, [authedFetch, setSourceCharacterData, showToast, sourceCharacterData]);

  const handleManeuverAction = useCallback(async (
    maneuver: Maneuver,
    sourceTokenId: number,
    targetTokenId?: number,
  ) => {
    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    const targetToken = targetTokenId ? tokens.find((token) => token.id === targetTokenId) : null;
    const sourceName = getTokenDisplayName(sourceToken, "攻击者");
    const targetName = targetToken ? getTokenDisplayName(targetToken, "目标") : "无目标";

    const maneuversData = sourceCharacterData?.maneuvers_data;
    if (!maneuversData || maneuversData.superiority_dice.current <= 0) {
      showToast("没有可用的战技骰", "error");
      return;
    }

    const characterId = sourceToken?.character_id;
    if (!characterId) {
      showToast("找不到角色信息", "error");
      return;
    }

    const timing = maneuver.timing || "on_hit";
    const isImmediateAction = IMMEDIATE_MANEUVER_TIMINGS.has(timing);

    if (isImmediateAction) {
      try {
        const dieResult = await consumeSuperiorityDie(characterId);
        if (!dieResult) return;

        const { dieName, dieRoll, newDiceCount, maxUses } = dieResult;
        const rollText = `${dieName}=${dieRoll}`;
        const diceRemainingText = `(剩余战技骰 ${newDiceCount}/${maxUses})`;

        showToast(
          `${sourceName} 使用【${maneuver.name}】${targetName !== "无目标" ? `对 ${targetName}` : ""}，战技骰 ${rollText} ${diceRemainingText}`,
          "info",
          5000,
        );

        sendMessage({
          type: "chat",
          data: {
            sender: sourceName,
            message: `使用【${maneuver.name}】${targetName !== "无目标" ? `对 ${targetName}` : ""}，战技骰 ${rollText} ${diceRemainingText}\n${maneuver.description}`,
            message_type: "action",
          },
        });

        if (maneuver.id === "rally" && targetTokenId) {
          const charismaScore = sourceCharacterData?.ability_scores?.charisma ?? 10;
          const charismaMod = Math.floor((charismaScore - 10) / 2);
          const tempHP = dieRoll + charismaMod;
          if (targetToken) {
            setTokens((previous) => previous.map((token) =>
              token.id === targetTokenId
                ? { ...token, temp_hp: Math.max(token.temp_hp || 0, tempHP) }
                : token,
            ));
            try {
              await authedFetch(`/api/tokens/${targetTokenId}/temp-hp`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ temp_hp: tempHP }),
              });
            } catch (error) {
              logger.error("[Maneuver] Failed to set temp HP:", error);
            }
            sendMessage({
              type: "chat",
              data: {
                message: `🛡️ **${sourceName}** 的【激励】为 **${targetName}** 提供 ${tempHP} 点临时生命值！(${dieName}=${dieRoll}+魅力${charismaMod >= 0 ? "+" : ""}${charismaMod})`,
                message_type: "action",
              },
            });
          }
        } else if (maneuver.id === "feinting_attack") {
          const currentEffects = tokenStatusEffects[sourceTokenId] || [];
          const nextEffects = [
            ...currentEffects,
            {
              id: "feinted",
              name: "佯攻",
              icon: "🎭",
              color: "#8b5cf6",
              duration: 1,
              maxDuration: 1,
              metadata: { target_token_id: targetTokenId },
            },
          ];
          setTokenStatusEffects((previous) => ({ ...previous, [sourceTokenId]: nextEffects }));
          try {
            await authedFetch(`/api/tokens/${sourceTokenId}/active-effects`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ active_effects: nextEffects }),
            });
          } catch (error) {
            logger.error("[Maneuver] Failed to persist feint effect:", error);
          }
          sendMessage({
            type: "chat",
            data: {
              message: `🎭 **${sourceName}** 的【佯攻】成功！对 **${targetName}** 的下次攻击具有优势`,
              message_type: "action",
            },
          });
        } else if (maneuver.id === "commanders_strike") {
          sendMessage({
            type: "chat",
            data: {
              message: `⚔️ **${sourceName}** 使用【指挥打击】！一个盟友可以用反应进行一次武器攻击，命中额外造成 ${rollText} 伤害`,
              message_type: "action",
            },
          });
        }
      } catch (error) {
        logger.error("[Maneuver Action] Immediate execution failed:", error);
        showToast("使用战技失败", "error");
      }
    } else {
      setPendingManeuvers((previous) => ({
        ...previous,
        [sourceTokenId]: {
          maneuver,
          targetTokenId,
          timestamp: Date.now(),
        },
      }));

      const timingText = MANEUVER_TIMING_LABELS[timing] || "触发时";
      showToast(`${sourceName} 准备【${maneuver.name}】- ${timingText}生效`, "info", 4000);
      sendMessage({
        type: "chat",
        data: {
          sender: sourceName,
          message: `准备战技【${maneuver.name}】- ${timingText}触发`,
          message_type: "action",
        },
      });
    }

    setSelectionContextMenu(null);
  }, [
    authedFetch,
    consumeSuperiorityDie,
    sendMessage,
    setPendingManeuvers,
    setSelectionContextMenu,
    setTokenStatusEffects,
    setTokens,
    showToast,
    sourceCharacterData,
    tokenStatusEffects,
    tokens,
  ]);

  const triggerPendingManeuver = useCallback(async (
    sourceTokenId: number,
    targetTokenId: number,
    triggerTiming: string,
  ): Promise<{ dieRoll: number; dieName: string } | null> => {
    const pending = pendingManeuvers[sourceTokenId];
    if (!pending) return null;

    const maneuverTiming = pending.maneuver.timing || "on_hit";
    if (maneuverTiming !== triggerTiming) return null;

    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    const targetToken = tokens.find((token) => token.id === targetTokenId);
    const sourceName = getTokenDisplayName(sourceToken, "攻击者");
    const targetName = getTokenDisplayName(targetToken, "目标");

    const characterId = sourceToken?.character_id;
    if (!characterId) return null;

    try {
      const dieResult = await consumeSuperiorityDie(characterId);
      if (!dieResult) {
        setPendingManeuvers((previous) => ({ ...previous, [sourceTokenId]: null }));
        return null;
      }

      const { dieName, dieRoll, newDiceCount, maxUses } = dieResult;
      const rollText = `${dieName}=${dieRoll}`;
      const diceRemainingText = `(剩余战技骰 ${newDiceCount}/${maxUses})`;

      showToast(`${sourceName}【${pending.maneuver.name}】触发！战技骰 ${rollText} ${diceRemainingText}`, "info", 5000);
      sendMessage({
        type: "chat",
        data: {
          sender: sourceName,
          message: `【${pending.maneuver.name}】触发！对 ${targetName}，战技骰 ${rollText} ${diceRemainingText}\n${pending.maneuver.description}`,
          message_type: "action",
        },
      });
      setPendingManeuvers((previous) => ({ ...previous, [sourceTokenId]: null }));

      return { dieRoll, dieName };
    } catch (error) {
      logger.error("[Trigger Maneuver] Failed:", error);
      showToast("触发战技失败", "error");
      return null;
    }
  }, [consumeSuperiorityDie, pendingManeuvers, sendMessage, setPendingManeuvers, showToast, tokens]);

  const cancelPendingManeuver = useCallback((sourceTokenId: number) => {
    const pending = pendingManeuvers[sourceTokenId];
    if (!pending) return;

    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    const sourceName = getTokenDisplayName(sourceToken, "角色");

    showToast(`${sourceName} 取消了【${pending.maneuver.name}】`, "info");
    setPendingManeuvers((previous) => ({ ...previous, [sourceTokenId]: null }));
  }, [pendingManeuvers, setPendingManeuvers, showToast, tokens]);

  const applyManeuverSecondaryEffect = useCallback(async (
    maneuver: Maneuver,
    sourceToken: Token,
    targetToken: Token,
    dieRoll: number,
  ) => {
    const sourceName = getTokenDisplayName(sourceToken, "攻击者");
    const targetName = getTokenDisplayName(targetToken, "目标");

    const abilityScores = sourceCharacterData?.ability_scores;
    const level = sourceCharacterData?.level || 1;
    const proficiencyBonus = level < 5 ? 2 : level < 9 ? 3 : level < 13 ? 4 : level < 17 ? 5 : 6;
    const strengthMod = abilityScores ? Math.floor((abilityScores.strength - 10) / 2) : 0;
    const dexterityMod = abilityScores ? Math.floor((abilityScores.dexterity - 10) / 2) : 0;
    const saveDc = 8 + proficiencyBonus + Math.max(strengthMod, dexterityMod);

    const applyEffect = async (tokenId: number, effect: {
      id: string;
      name: string;
      icon: string;
      color: string;
      duration?: number;
      maxDuration?: number;
      metadata?: Record<string, unknown>;
    }) => {
      const currentEffects = tokenStatusEffects[tokenId] || [];
      if (currentEffects.find((entry) => entry.id === effect.id)) return;
      const nextEffects = [...currentEffects, effect];
      setTokenStatusEffects((previous) => ({ ...previous, [tokenId]: nextEffects }));
      try {
        await authedFetch(`/api/tokens/${tokenId}/active-effects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active_effects: nextEffects }),
        });
      } catch (error) {
        logger.error("[Maneuver] Failed to persist effect:", error);
      }
    };

    const doSave = (saveAbility: string) => {
      const roll = Math.floor(Math.random() * 20) + 1;
      const saveMod = 0;
      const total = roll + saveMod;
      const success = total >= saveDc;
      const abilityName = ABILITY_CN[saveAbility] || saveAbility;
      sendMessage({
        type: "chat",
        data: {
          message: `🎯 **${targetName}** 进行${abilityName}豁免: 🎲 ${roll}${saveMod !== 0 ? `+${saveMod}` : ""} = ${total} vs DC ${saveDc} → **${success ? "成功" : "失败"}**`,
          message_type: "action",
        },
      });
      return { success };
    };

    try {
      switch (maneuver.id) {
        case "trip_attack": {
          const { success } = doSave("strength");
          if (!success) {
            await applyEffect(targetToken.id, {
              id: "prone",
              name: "倒地",
              icon: "🦶",
              color: "#ef4444",
              duration: 99,
              maxDuration: 99,
            });
            sendMessage({
              type: "chat",
              data: {
                message: `⚔️ **${sourceName}** 的【摔绊攻击】将 **${targetName}** 击倒在地！`,
                message_type: "action",
              },
            });
          }
          break;
        }
        case "menacing_attack": {
          const { success } = doSave("wisdom");
          if (!success) {
            await applyEffect(targetToken.id, {
              id: "frightened",
              name: "恐惧",
              icon: "😨",
              color: "#7c3aed",
              duration: 1,
              maxDuration: 1,
              metadata: { source_token_id: sourceToken.id },
            });
            sendMessage({
              type: "chat",
              data: {
                message: `⚔️ **${sourceName}** 的【威慑攻击】令 **${targetName}** 陷入恐惧！(1轮)`,
                message_type: "action",
              },
            });
          }
          break;
        }
        case "disarming_attack": {
          const { success } = doSave("strength");
          if (!success) {
            sendMessage({
              type: "chat",
              data: {
                message: `⚔️ **${sourceName}** 的【缴械攻击】成功！**${targetName}** 的武器被击落！`,
                message_type: "action",
              },
            });
          }
          break;
        }
        case "pushing_attack": {
          const { success } = doSave("strength");
          if (!success) {
            const dx = targetToken.position_x - sourceToken.position_x;
            const dy = targetToken.position_y - sourceToken.position_y;
            const distance = Math.sqrt(dx * dx + dy * dy) || 1;
            const newX = Math.round(targetToken.position_x + (dx / distance) * 3);
            const newY = Math.round(targetToken.position_y + (dy / distance) * 3);

            setTokens((previous) => previous.map((token) =>
              token.id === targetToken.id ? { ...token, position_x: newX, position_y: newY } : token,
            ));
            try {
              const response = await authedFetch(`/api/tokens/${targetToken.id}/position`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ position_x: newX, position_y: newY }),
              });
              if (response.ok) {
                sendMessage({
                  type: "token_move",
                  data: { token_id: targetToken.id, position: { x: newX, y: newY } },
                });
              }
            } catch (error) {
              logger.error("[Maneuver] Failed to push token:", error);
            }
            sendMessage({
              type: "chat",
              data: {
                message: `⚔️ **${sourceName}** 的【推击攻击】将 **${targetName}** 推开15尺！`,
                message_type: "action",
              },
            });
          }
          break;
        }
        case "goading_attack": {
          const { success } = doSave("wisdom");
          if (!success) {
            await applyEffect(targetToken.id, {
              id: "goaded",
              name: "嘲讽",
              icon: "😤",
              color: "#f59e0b",
              duration: 1,
              maxDuration: 1,
              metadata: { source_token_id: sourceToken.id },
            });
            sendMessage({
              type: "chat",
              data: {
                message: `⚔️ **${sourceName}** 的【激怒攻击】嘲讽了 **${targetName}**！攻击其他目标具有劣势(1轮)`,
                message_type: "action",
              },
            });
          }
          break;
        }
        case "distracting_strike": {
          await applyEffect(targetToken.id, {
            id: "distracted",
            name: "分心",
            icon: "👁️",
            color: "#06b6d4",
            duration: 1,
            maxDuration: 1,
            metadata: { source_token_id: sourceToken.id },
          });
          sendMessage({
            type: "chat",
            data: {
              message: `⚔️ **${sourceName}** 的【扰心打击】使 **${targetName}** 分心！下一次盟友攻击具有优势`,
              message_type: "action",
            },
          });
          break;
        }
        case "maneuvering_attack": {
          sendMessage({
            type: "chat",
            data: {
              message: `⚔️ **${sourceName}** 的【策略攻击】命中！一个盟友可以用反应移动至多半速，且不会引发借机攻击`,
              message_type: "action",
            },
          });
          break;
        }
        case "sweeping_attack": {
          const targetSize = parseTokenSize(targetToken.token_size);
          const nearbyEnemies = tokens.filter((token) => {
            if (token.id === targetToken.id || token.id === sourceToken.id) return false;
            if (!token.monster_instance_id && !token.character_id) return false;
            const targetIsMonster = !!targetToken.monster_instance_id;
            const tokenIsMonster = !!token.monster_instance_id;
            if (targetIsMonster !== tokenIsMonster) return false;
            const tokenSize = parseTokenSize(token.token_size);
            const distance = getEdgeToEdgeDistance(
              targetToken.position_x,
              targetToken.position_y,
              targetSize.width,
              targetSize.height,
              token.position_x,
              token.position_y,
              tokenSize.width,
              tokenSize.height,
            );
            return distance <= 1;
          });

          if (nearbyEnemies.length > 0) {
            const victim = nearbyEnemies[0];
            const victimName = getTokenDisplayName(victim, "敌人");
            const nextHp = Math.max(0, (victim.current_hp || 0) - dieRoll);
            setTokens((previous) => previous.map((token) =>
              token.id === victim.id ? { ...token, current_hp: nextHp } : token,
            ));
            try {
              await authedFetch(`/api/tokens/${victim.id}/hp`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ current_hp: nextHp }),
              });
            } catch (error) {
              logger.error("[Maneuver] Failed to apply sweeping damage:", error);
            }
            sendMessage({
              type: "chat",
              data: {
                message: `⚔️ **${sourceName}** 的【横扫攻击】波及 **${victimName}**，造成 ${dieRoll} 点伤害！`,
                message_type: "action",
              },
            });
          } else {
            sendMessage({
              type: "chat",
              data: {
                message: `⚔️ **${sourceName}** 使用【横扫攻击】，但附近没有其他敌人可波及`,
                message_type: "action",
              },
            });
          }
          break;
        }
        case "precision_attack": {
          sendMessage({
            type: "chat",
            data: {
              message: `⚔️ **${sourceName}** 使用【精准攻击】将战技骰(${dieRoll})加到攻击骰上`,
              message_type: "action",
            },
          });
          break;
        }
        case "lunging_attack": {
          sendMessage({
            type: "chat",
            data: {
              message: `⚔️ **${sourceName}** 使用【突刺攻击】增加5尺触及范围！`,
              message_type: "action",
            },
          });
          break;
        }
        default:
          break;
      }
    } catch (error) {
      logger.error("[Maneuver] Failed to apply secondary effect:", error);
    }
  }, [authedFetch, sendMessage, setTokenStatusEffects, setTokens, sourceCharacterData, tokenStatusEffects, tokens]);

  return {
    handleManeuverAction,
    triggerPendingManeuver,
    cancelPendingManeuver,
    applyManeuverSecondaryEffect,
  };
}
