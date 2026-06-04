/**
 * useMapWebSocket Hook
 * Handles WebSocket communication for real-time map updates
 */

import { useWebSocket } from "~/hooks/useWebSocket";
import { useEffect } from "react";
import type { Token, Ruler, Drawing, MapMarker, AuraVisual } from "../types/TacticalMapTypes";
import type { FogData } from "../FogOfWarManager";
import type { TerrainData } from "../TerrainManager";
import { handleDrawingWebSocketMessage } from "~/utils/drawingAPI";
import { showDamageNumber } from "../DamageNumberOverlay";
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import { showCharacterBubble } from "~/utils/characterBubble";
import { findForcedMovementIntents } from "~/utils/forcedMovement";
import { createLogger } from '~/utils/logger';
const logger = createLogger('useMapWebSocket');

const CLASS_FEATURE_UPDATE_DEDUPE_WINDOW_MS = 2500;
const recentClassFeatureUpdateKeys = new Map<string, number>();

type ClassFeatureUsesUpdateDetail = {
  characterId?: number | string;
  featureId?: string;
  currentUses?: number;
  maxUses?: number;
};

function buildClassFeatureUpdateKey(detail: ClassFeatureUsesUpdateDetail): string | null {
  const { characterId, featureId, currentUses, maxUses } = detail;
  if ((typeof characterId !== "number" && typeof characterId !== "string") || !featureId) {
    return null;
  }
  if (typeof currentUses !== "number" || typeof maxUses !== "number") {
    return null;
  }
  return `${characterId}:${featureId}:${currentUses}:${maxUses}`;
}

function pruneRecentClassFeatureUpdateKeys(now: number) {
  for (const [key, timestamp] of recentClassFeatureUpdateKeys.entries()) {
    if (now - timestamp > CLASS_FEATURE_UPDATE_DEDUPE_WINDOW_MS) {
      recentClassFeatureUpdateKeys.delete(key);
    }
  }
}

function rememberClassFeatureUpdate(detail: ClassFeatureUsesUpdateDetail, now: number = Date.now()) {
  pruneRecentClassFeatureUpdateKeys(now);
  const key = buildClassFeatureUpdateKey(detail);
  if (key) {
    recentClassFeatureUpdateKeys.set(key, now);
  }
}

function shouldSuppressRemoteClassFeatureUpdate(detail: ClassFeatureUsesUpdateDetail, now: number = Date.now()) {
  pruneRecentClassFeatureUpdateKeys(now);
  const key = buildClassFeatureUpdateKey(detail);
  return key ? recentClassFeatureUpdateKeys.has(key) : false;
}

export function __resetMapWebSocketStateForTests() {
  recentClassFeatureUpdateKeys.clear();
}

export function __rememberClassFeatureUpdateForTests(detail: ClassFeatureUsesUpdateDetail) {
  rememberClassFeatureUpdate(detail);
}

export function __shouldSuppressRemoteClassFeatureUpdateForTests(detail: ClassFeatureUsesUpdateDetail) {
  return shouldSuppressRemoteClassFeatureUpdate(detail);
}


interface CombatAttackResult {
  attacker_name: string;
  target_name: string;
  attack_name: string;
  hit: boolean;
  critical: boolean;
  fumble: boolean;
  narrative: string;
  damage_dealt: number;
  extra_damage_dealt?: number;
  extra_damage_type?: string;
  hp_change?: number;
  new_hp?: number;
  target_defeated: boolean;
}

export interface CombatAttackData {
  attacker_token_id: number;
  target_token_id: number;
  result: CombatAttackResult;
  auto_apply: boolean;
}

interface UseMapWebSocketProps {
  campaignId: string;
  userId?: string;
  isDM: boolean;
  currentMapUrl?: string | null;
  setTokens: (updater: (prev: Token[]) => Token[]) => void;
  setFogData: (data: FogData | null) => void;
  setTerrainData: (data: TerrainData | null) => void;
  setShowTerrainToPlayers?: (visible: boolean) => void;
  setRulers: (updater: (prev: Ruler[]) => Ruler[]) => void;
  setDrawings: (updater: (prev: Drawing[]) => Drawing[]) => void;
  setMarkers: (updater: (prev: MapMarker[]) => MapMarker[]) => void;
  setAuraVisuals?: (visuals: AuraVisual[]) => void;
  setGridUnitLength: (length: number) => void;
  setAnchorPosition?: (pos: { x: number; y: number } | null) => void;
  onCombatResult?: (data: CombatAttackData) => void;
}

export function useMapWebSocket({
  campaignId,
  userId,
  isDM,
  currentMapUrl,
  setTokens,
  setFogData,
  setTerrainData,
  setShowTerrainToPlayers,
  setRulers,
  setDrawings,
  setMarkers,
  setAuraVisuals,
  setGridUnitLength,
  setAnchorPosition,
  onCombatResult,
}: UseMapWebSocketProps) {
  const { isConnected, sendMessage } = useWebSocket({
    campaignId,
    userId,
    role: isDM ? "dm" : "player",
    onConnect: () => {
      logger.debug("[useMapWebSocket] Connected successfully");
    },
    onDisconnect: () => {
      logger.debug("[useMapWebSocket] Disconnected");
    },
    onMessage: (message) => {
      if (!message || !message.type) return;
	      const data: Record<string, any> = message.data;

      // Token messages
      if (message.type === "token_placed") {
        // Support both formats: {data: {token: ...}} and {token: ...}
        const token = (data?.token || (message as any).token) as Token | undefined;
        if (!token) return;
        if (currentMapUrl && token.map_url !== currentMapUrl) return;

        logger.debug("[useMapWebSocket] Token placed:", token.character_name, "at", token.position_x, token.position_y);
        setTokens((prev) => {
          const exists = prev.some((t) => t.id === token.id);
          return exists ? prev.map((t) => (t.id === token.id ? token : t)) : [...prev, token];
        });
        const placedCharacterId = token.character_id;
        if (placedCharacterId != null && token.casting_in_progress) {
          queueMicrotask(() => {
            publishAppEvent("characterCastingChanged", {
              characterId: placedCharacterId,
              tokenId: token.id,
              castingInProgress: token.casting_in_progress,
            });
          });
        }
        publishAppEvent("tokenPlaced", { token });
      } else if (message.type === "token_move") {
        // Support both formats: {data: {token_id, position}} and {token_id, position}
        const token_id = data?.token_id || (message as any).token_id;
        const position = data?.position || (message as any).position;
        logger.debug(`[useMapWebSocket] Token ${token_id} moved to (${position?.x}, ${position?.y})`);
        setTokens((prev) => prev.map((t) => (t.id === token_id ? { ...t, position_x: position?.x ?? t.position_x, position_y: position?.y ?? t.position_y } : t)));
      } else if (message.type === "token_removed") {
        // Support both formats: {data: {token_id: ...}} and {token_id: ...}
        const token_id = data?.token_id || (message as any).token_id;
        logger.debug("[useMapWebSocket] Removing token:", token_id);
        setTokens((prev) => {
          const newTokens = prev.filter((t) => t.id !== token_id);
          logger.debug("[useMapWebSocket] Tokens after removal:", newTokens.length);
          return newTokens;
        });
        publishAppEvent("tokenRemoved", { tokenId: token_id });
      } else if (message.type === "token_update") {
        // Partial token update (e.g. illusion image change)
        const tokenData = data?.token || (message as any).token;
        if (tokenData?.id) {
          let mergedToken: Token | null = null;
          setTokens(prev => prev.map(t =>
            t.id === tokenData.id ? (mergedToken = { ...t, ...tokenData }) : t
          ));
          queueMicrotask(() => {
            publishAppEvent("tokenUpdated", { token: mergedToken || tokenData });
          });
        }
      } else if (message.type === "token_hp_update") {
        // Support both formats: {data: {...}} and direct fields
        const msgAny = message as any;
        const token_id = data?.token_id ?? msgAny.token_id;
        const current_hp = data?.current_hp ?? msgAny.current_hp;
        const max_hp = data?.max_hp ?? msgAny.max_hp;
        const character_id = data?.character_id ?? msgAny.character_id;
        const hp_change = data?.hp_change ?? msgAny.hp_change;
        const target_defeated = data?.target_defeated ?? msgAny.target_defeated;
        const transformation_data = data?.transformation_data ?? data?.wild_shape_data ?? msgAny.transformation_data ?? msgAny.wild_shape_data;
        const temp_hp = data?.temp_hp ?? msgAny.temp_hp;
        const active_effects = data?.active_effects ?? msgAny.active_effects;
        logger.debug(`[useMapWebSocket] Token ${token_id} HP updated to ${current_hp}${max_hp !== undefined ? "/" + max_hp : ""}, temp_hp: ${temp_hp}, change: ${hp_change}, defeated: ${target_defeated}, wild_shape: ${transformation_data ? 'active' : 'none'}`);
        setTokens((prev) => prev.map((t) => (t.id === token_id ? {
          ...t,
          current_hp,
          ...(max_hp !== undefined ? { max_hp } : {}),
          ...(temp_hp !== undefined ? { temp_hp: temp_hp ?? null } : {}),
          ...(active_effects !== undefined ? { active_effects } : {}),
          // Update transformation_data if provided (may be null to indicate wild shape ended)
          ...(transformation_data !== undefined ? { transformation_data } : {})
        } : t)));
        // If this token is linked to a character, broadcast a DOM event so character UIs can refresh
        if (character_id) {
          publishAppEvent("characterHPUpdated", {
            characterId: character_id,
            current_hp,
            max_hp,
            temp_hp,
          });
          // Also broadcast transformation update if it changed
          if (transformation_data !== undefined) {
            publishAppEvent("transformationUpdate", {
              characterId: character_id,
              wildShapeData: transformation_data,
            });
          }
        }
        // Show floating healing number if HP increased (positive hp_change)
        if (hp_change && hp_change > 0 && token_id) {
          showDamageNumber({
            targetTokenId: token_id,
            damage: hp_change,
            hit: true,
            critical: false,
            fumble: false,
            heal: true,
          });
        }
      } else if (message.type === "token_params_update") {
	        const { token_id, params } = data || {};
        logger.debug(`[useMapWebSocket] Token ${token_id} params update`, params);
        setTokens((prev) => prev.map((t) => (t.id === token_id ? { ...t, params: { ...(t as any).params, ...(params || {}) } } : t)));
      } else if (message.type === "token_active_effects_update") {
        // Handle active status effects update (e.g., Rage, Bardic Inspiration)
	        const msgAny = message as any;
	        const token_id = data?.token_id ?? msgAny.token_id;
	        const rawEffects = data?.active_effects ?? msgAny.active_effects;
        // Normalize null → [] so downstream useEffect doesn't preserve stale local state
        const active_effects = rawEffects || [];
        logger.debug(`[useMapWebSocket] Token ${token_id} active effects updated`, active_effects);
        // Dispatch event outside setTokens to avoid setState-during-render warning
        setTokens((prev) => {
          const t = prev.find(tk => tk.id === token_id);
          const characterId = t?.character_id;
          if (characterId !== undefined && characterId !== null) {
            queueMicrotask(() => {
              publishAppEvent("characterActiveEffectsChanged", {
                characterId,
                activeEffects: active_effects,
              });
            });
          }
          return prev.map((t) => (t.id === token_id ? { ...t, active_effects: active_effects.length > 0 ? active_effects : null } : t));
        });
        // Transient forced-movement intents (Thorn Whip etc.) must be consumed
        // into actual coordinate movement by the map layer.
        const forcedMovementIntents = findForcedMovementIntents(active_effects);
        if (forcedMovementIntents.length > 0 && typeof token_id === "number") {
          const snapshot: ReadonlyArray<Record<string, unknown>> = Array.isArray(active_effects)
            ? (active_effects as Record<string, unknown>[]).slice()
            : [];
          queueMicrotask(() => {
            for (const intent of forcedMovementIntents) {
              publishAppEvent("forcedMovementPending", {
                targetTokenId: token_id,
                effectId: intent.effectId,
                sourceTokenId: intent.sourceTokenId,
                direction: intent.direction,
                distanceFeet: intent.distanceFeet,
                relativeTo: intent.relativeTo,
                point: intent.point,
                activeEffectsSnapshot: snapshot,
              });
            }
          });
        }
        // Sync expired condition cleanup to status_effects
        const monsterInstanceId = msgAny.monster_instance_id;
        const monsterStatusEffects = msgAny.monster_status_effects;
        const characterId = msgAny.character_id;
        const characterStatusEffects = msgAny.character_status_effects;
        if (monsterInstanceId && monsterStatusEffects !== undefined) {
          publishAppEvent("monsterStatusEffectsChanged", {
            monsterInstanceId,
            statusEffects: monsterStatusEffects,
          });
        }
        if (characterId && characterStatusEffects !== undefined) {
          publishAppEvent("characterStatusEffectsChanged", {
            characterId,
            statusEffects: characterStatusEffects,
          });
        }
      } else if (message.type === "token_auras_update") {
        // Handle aura toggle (e.g., Paladin's Aura of Protection)
	        const { token_id, active_auras } = data || {};
        logger.debug(`[useMapWebSocket] Token ${token_id} auras updated`, active_auras);
        setTokens((prev) => prev.map((t) => (t.id === token_id ? { ...t, active_auras } : t)));
      } else if (message.type === "aura_update") {
        // Handle aura visualization update (recalculated after token movement)
	        const auras = data?.auras as AuraVisual[] | undefined;
        if (auras && setAuraVisuals) {
          logger.debug(`[useMapWebSocket] Aura visualization updated with ${auras.length} auras`);
          setAuraVisuals(auras);
        }
      } else if (message.type === "token_faction_update") {
        // Handle faction update (player, enemy, neutral)
	        const { token_id, faction } = data || {};
        logger.debug(`[useMapWebSocket] Token ${token_id} faction updated to ${faction}`);
        setTokens((prev) => prev.map((t) => (t.id === token_id ? { ...t, faction } : t)));
      } else if (message.type === "death_save_update") {
        // Handle death saving throw update
        const msgAny = message as any;
        const token_id = data?.token_id ?? msgAny.token_id;
        const death_saves = data?.death_saves ?? msgAny.death_saves;
        const revived = data?.revived ?? msgAny.revived;
        logger.debug(`[useMapWebSocket] Death save update for token ${token_id}:`, death_saves);
        setTokens((prev) => prev.map((t) => {
          if (t.id !== token_id) return t;
          return {
            ...t,
            death_saves: death_saves ?? null,
            ...(revived ? { current_hp: 1 } : {}),
          };
        }));
        // Dispatch DOM event for DeathSavePanel
        publishAppEvent("death_save_update", {
          token_id,
          death_saves,
          revived,
          roll: data?.roll ?? msgAny.roll,
        });
      } else if (message.type === "transformation_update" || message.type === "wild_shape_update") {
        // Handle wild shape / polymorph transformation update (backward compat: wild_shape_update)
        const msgAny = message as any;
        const token_id = data?.token_id ?? msgAny.token_id;
        const transformation_data = data?.transformation_data ?? msgAny.transformation_data;
        const wild_shape_data = data?.wild_shape_data ?? msgAny.wild_shape_data;
        const token_size = data?.token_size ?? msgAny.token_size;
        const active_effects = data?.active_effects ?? msgAny.active_effects;
        const tData = transformation_data ?? wild_shape_data;
        logger.debug(`[useMapWebSocket] Token ${token_id} transformation updated:`, tData?.beast_name || tData?.activeMode || 'ended');
        setTokens((prev) => {
          const updatedTokens = prev.map((t) => (t.id === token_id ? {
            ...t,
            transformation_data: tData,
            ...(token_size !== undefined ? { token_size } : {}),
            ...(active_effects !== undefined ? { active_effects } : {}),
          } : t));
          // Find the token to get character_id for dispatching event
          const token = updatedTokens.find(t => t.id === token_id);
          if (token?.character_id) {
            publishAppEvent("transformationUpdate", {
              characterId: token.character_id,
              wildShapeData: tData,
            });
          }
          return updatedTokens;
        });
      } else if (message.type === "transformation_narrative" || message.type === "wild_shape_narrative") {
        // Handle AI-generated transformation narrative (backward compat: wild_shape_narrative)
        const { token_id, character_id, character_name, beast_name, is_transforming, narrative } = data || {};
        logger.debug(`[useMapWebSocket] Wild shape narrative for ${character_name}:`, narrative);
        // Show the narrative as a character bubble (use character_id for bubble matching)
        if (narrative && character_id) {
          showCharacterBubble({
            characterId: character_id,
            characterName: character_name || "德鲁伊",
            message: narrative,
            type: "action",
          });
        }
      } else if (message.type === "token_disguise_update") {
        // Handle disguise/illusion appearance update
        const { token_id, disguise_data, active_effects } = data || {};
        logger.debug(`[useMapWebSocket] Token ${token_id} disguise updated:`, disguise_data?.spell_name || 'dismissed');
        setTokens((prev) => {
          const matchedToken = prev.find(t => t.id === token_id);
          if (matchedToken?.character_id && active_effects !== undefined) {
            const charId = matchedToken.character_id;
            queueMicrotask(() => {
              publishAppEvent("characterActiveEffectsChanged", {
                characterId: charId,
                activeEffects: active_effects,
              });
            });
          }
          return prev.map((t) => (t.id === token_id
            ? { ...t, disguise_data, ...(active_effects !== undefined ? { active_effects } : {}) }
            : t
          ));
        });
      } else if (message.type === "token_concentration_update") {
        // Handle concentration spell update
	        const msgAny = message as any;
	        const token_id = data?.token_id ?? msgAny.token_id;
	        const concentration_spell = data?.concentration_spell ?? msgAny.concentration_spell;
	        const reason = data?.reason ?? msgAny.reason;
	        const broken_spell = data?.broken_spell ?? msgAny.broken_spell;
	        const active_effects = data?.active_effects ?? msgAny.active_effects;
	        const temp_hp = data?.temp_hp ?? msgAny.temp_hp;
        logger.debug(`[useMapWebSocket] Token ${token_id} concentration updated:`, concentration_spell?.spell_name || 'broken', reason);
        setTokens((prev) => {
          const matchedToken = prev.find(t => t.id === token_id);
          if (matchedToken?.character_id != null) {
            // Use queueMicrotask to avoid setState-during-render warning
            const charId = matchedToken.character_id;
            queueMicrotask(() => {
              publishAppEvent("characterConcentrationChanged", {
                characterId: charId,
                tokenId: token_id,
                concentrationSpell: concentration_spell || null,
              });
              if (active_effects !== undefined) {
                publishAppEvent("characterActiveEffectsChanged", {
                  characterId: charId,
                  activeEffects: active_effects,
                });
              }
              if (temp_hp !== undefined) {
                publishAppEvent("characterHPUpdated", {
                  characterId: charId,
                  temp_hp,
                });
              }
            });
          }
          return prev.map((t) => {
            if (t.id !== token_id) return t;
            const update: any = { ...t, concentration_spell };
            if (active_effects !== undefined) update.active_effects = active_effects;
            if (temp_hp !== undefined) update.temp_hp = temp_hp ?? null;
            return update;
          });
        });
      } else if (message.type === "token_casting_update"
        || message.type === "token_casting_completed"
        || message.type === "token_casting_interrupted") {
        const msgAny = message as any;
        const token_id = data?.token_id ?? msgAny.token_id;
        const casting_in_progress = data?.casting_in_progress ?? msgAny.casting_in_progress ?? null;
        logger.debug(`[useMapWebSocket] Token ${token_id} casting updated:`, casting_in_progress?.spell_name || 'none');
        setTokens((prev) => {
          const matchedToken = prev.find(t => t.id === token_id);
          const matchedCharacterId = matchedToken?.character_id;
          if (matchedCharacterId != null) {
            queueMicrotask(() => {
              publishAppEvent("characterCastingChanged", {
                characterId: matchedCharacterId,
                tokenId: token_id,
                castingInProgress: casting_in_progress,
              });
            });
          }
          return prev.map((t) => (
            t.id === token_id ? { ...t, casting_in_progress } : t
          ));
        });
      } else if (message.type === "token_effect_added") {
        // Handle control effect added (from control spells like Hold Person, Sleep, etc.)
        // Support both formats: {data: {...}} and direct fields
        const msgAny = message as any;
        const token_id = data?.token_id ?? msgAny.token_id;
        const effect = data?.effect ?? msgAny.effect;
        const target_name = data?.target_name ?? msgAny.target_name;
        const spell_name = data?.spell_name ?? msgAny.spell_name;
        logger.debug(`[useMapWebSocket] Token ${token_id} (${target_name}) got effect from ${spell_name}:`, effect?.name);
        setTokens((prev) => prev.map((t) => {
          if (t.id !== token_id) return t;
          const currentEffects = t.active_effects || [];
          // Avoid duplicates
          if (currentEffects.some((e: any) => e.id === effect?.id)) return t;
          return { ...t, active_effects: [...currentEffects, effect] };
        }));
        // Show a bubble notification for the effect
        if (target_name && effect?.name) {
          showCharacterBubble({
            characterId: token_id,
            characterName: target_name,
            message: `受到 ${effect.name} 效果`,
            type: "combat"
          });
        }
      } else if (message.type === "token_effects_update") {
        // Handle control effects update (when concentration is broken)
        // Support both formats: {data: {...}} and direct fields
        const msgAny = message as any;
        const token_id = data?.token_id ?? msgAny.token_id;
        const active_effects = data?.active_effects ?? msgAny.active_effects;
        const reason = data?.reason ?? msgAny.reason;
        logger.debug(`[useMapWebSocket] Token ${token_id} effects updated (${reason}):`, active_effects?.length || 0, 'effects');
        setTokens((prev) => {
          const t = prev.find(tk => tk.id === token_id);
          if (t?.character_id) {
            publishAppEvent("characterActiveEffectsChanged", {
              characterId: t.character_id,
              activeEffects: active_effects || [],
            });
          }
          return prev.map((t) => (t.id === token_id ? { ...t, active_effects } : t));
        });
        // Sync status_effects to FloatingTokenPanel ("状态" tab)
        const monsterInstanceId = data?.monster_instance_id ?? msgAny.monster_instance_id;
        const monsterStatusEffects = data?.monster_status_effects ?? msgAny.monster_status_effects;
        const characterId = data?.character_id ?? msgAny.character_id;
        const characterStatusEffects = data?.character_status_effects ?? msgAny.character_status_effects;
        if (monsterInstanceId && monsterStatusEffects !== undefined) {
          publishAppEvent("monsterStatusEffectsChanged", {
            monsterInstanceId,
            statusEffects: monsterStatusEffects,
          });
        }
        if (characterId && characterStatusEffects !== undefined) {
          publishAppEvent("characterStatusEffectsChanged", {
            characterId,
            statusEffects: characterStatusEffects,
          });
        }
      } else if (message.type === "loot_bag_created") {
        // A new loot bag was created (monster died and dropped loot)
	        const token = data?.token as Token | undefined;
        if (!token) return;
        if (currentMapUrl && token.map_url !== currentMapUrl) return;
	        logger.debug("[useMapWebSocket] Loot bag created:", data?.source_name);
        setTokens((prev) => {
          const exists = prev.some((t) => t.id === token.id);
          return exists ? prev.map((t) => (t.id === token.id ? token : t)) : [...prev, token];
        });
      } else if (message.type === "loot_bag_looted") {
        // Someone looted from a loot bag
	        const { token_id, character_name, items_taken, currency_taken, remaining_items, remaining_currency } = data || {};
        logger.debug(`[useMapWebSocket] ${character_name} looted from bag ${token_id}`);
        // Update the loot bag token's data
        setTokens((prev) => prev.map((t) => {
          if (t.id === token_id && t.loot_bag_data) {
            return {
              ...t,
              loot_bag_data: {
                ...t.loot_bag_data,
                items: remaining_items || [],
                currency: remaining_currency || { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
              }
            };
          }
          return t;
        }));
      } else if (message.type === "loot_bag_removed") {
        // Loot bag was emptied or deleted
	        const { token_id } = data || {};
        logger.debug("[useMapWebSocket] Loot bag removed:", token_id);
        setTokens((prev) => prev.filter((t) => t.id !== token_id));
      } else if (message.type === "monster_converted_to_chest") {
        // Monster was converted to a loot chest
        const { token_id, chest_id, chest, position_x, position_y, map_url } = data || {};
        logger.debug(`[useMapWebSocket] Monster converted to chest: token ${token_id} -> chest ${chest_id}`);
        // Update the token to be a chest token
        setTokens((prev) => prev.map((t) => {
          if (t.id === token_id) {
            return {
              ...t,
              monster_instance_id: null,
              loot_bag_data: null,
              chest_id: chest_id,
              instance_name: chest?.name || '战利品',
              avatar: chest?.avatar_url,
              token_size: '1x1',
              current_hp: undefined,
            };
          }
          return t;
        }));
        publishAppEvent("chestCreated", { chest });
      } else if (message.type === "character_avatar_updated") {
	        const { character_id, avatar } = data || {};
        logger.debug(`[useMapWebSocket] Character ${character_id} avatar updated`);
        // Update all tokens for this character with the new avatar
        setTokens((prev) => prev.map((t) => (t.character_id === character_id ? { ...t, avatar } : t)));
      } else if (message.type === "character_feature_uses_updated") {
	        const { character_id, feature_id, current_uses, max_uses } = data || {};
        const featureUpdateDetail = {
          characterId: character_id,
          featureId: feature_id,
          currentUses: current_uses,
          maxUses: max_uses,
        };
        logger.debug(`[useMapWebSocket] Character ${character_id} feature ${feature_id} uses updated to ${current_uses}/${max_uses}`);
        if (!shouldSuppressRemoteClassFeatureUpdate(featureUpdateDetail)) {
          publishAppEvent("classFeatureUsesUpdated", featureUpdateDetail);
        }
      } else if (message.type === "character_equipment_updated") {
        const equipmentUpdate = (message.data ?? message) as Record<string, any>;
	        const { character_id, equipment, currency, reason } = equipmentUpdate || {};
        logger.debug(`[useMapWebSocket] Character ${character_id} equipment updated`);
        publishAppEvent("characterEquipmentUpdated", {
          characterId: character_id,
          equipment,
          currency,
          reason,
        });
      } else if (message.type === "roll_modifier_update") {
        // Handle roll modifier (advantage/disadvantage) updates from DM
        const { token_id, modifier, user_id: senderId } = data || {};
        logger.debug(`[useMapWebSocket] Roll modifier updated for token ${token_id}: ${modifier}`);
        publishAppEvent("rollModifierUpdated", {
          tokenId: token_id,
          modifier,
          senderId,
        });
      }

      // Combat attack result
      else if (message.type === "combat_attack_result") {
        const { target_token_id, result, auto_apply } = data;
        logger.debug(`[useMapWebSocket] Combat attack result received`, { target_token_id, hit: result?.hit, damage: result?.damage_dealt });

        // Update target HP if auto_apply is true
        if (auto_apply && result?.new_hp !== null && result?.new_hp !== undefined && target_token_id) {
          setTokens((prev) => prev.map((t) =>
            t.id === target_token_id ? { ...t, current_hp: result.new_hp } : t
          ));
        }

        // Show floating damage number on the target token
        if (target_token_id && result) {
          const totalDamage = (result.damage_dealt || 0) + (result.extra_damage_dealt || 0);
          showDamageNumber({
            targetTokenId: target_token_id,
            damage: totalDamage,
            hit: result.hit,
            critical: result.critical,
            fumble: result.fumble,
          });
        }

        publishAppEvent("combatAttackResult", data as any);
        // Notify zone spell check for the attacker (non-combat action trigger)
        if (data.attacker_token_id) {
          publishAppEvent("tokenPerformedAction", { tokenId: data.attacker_token_id });
        }

        // Notify callback for UI display (toast/narrative/bubbles)
        if (onCombatResult) {
          onCombatResult(data as CombatAttackData);
        }
      }

      // Combat reaction used - notify CombatPanel
      else if (message.type === "combat_reaction_used") {
        publishAppEvent("combatReactionUsed", data as any);
      }

      // Spell cast result from unified /api/spells/cast
      else if (message.type === "spell_cast_result") {
        const d = data || {};
        logger.debug(`[useMapWebSocket] spell_cast_result:`, d.spell_name, d.narrative);

        // Refresh affected token states (HP, active_effects, concentration)
        const affectedIds: number[] = d.affected_token_ids || [];
        if (affectedIds.length > 0) {
          setTokens((prev) => {
            // We don't have the exact new values here (they were written by resolver),
            // so dispatch a reload event for each affected token
            for (const tid of affectedIds) {
              const t = prev.find(tk => tk.id === tid);
              if (t?.character_id) {
                publishAppEvent("characterActiveEffectsChanged", {
                  characterId: t.character_id,
                  reload: true,
                });
              }
            }
            return prev;
          });
        }

        // Show floating damage/healing numbers on affected tokens
        for (const er of (d.results || [])) {
          if (er.damage_dealt > 0 && er.target_token_id) {
            showDamageNumber({
              targetTokenId: er.target_token_id,
              damage: er.damage_dealt,
              hit: true,
              critical: er.critical_hit || false,
              fumble: false,
            });
          }
          if (er.healing_done > 0 && er.target_token_id) {
            showDamageNumber({
              targetTokenId: er.target_token_id,
              damage: er.healing_done,
              hit: true,
              critical: false,
              fumble: false,
              heal: true,
            });
          }
        }

        // Notify zone spell check for the caster (non-combat action trigger)
        if (d.caster_token_id) {
          publishAppEvent("tokenPerformedAction", { tokenId: d.caster_token_id });
        }

        // Show toast for generated items
        const itemsGenerated = d.items_generated || [];
        if (itemsGenerated.length > 0) {
          for (const ig of itemsGenerated) {
            publishAppEvent("showToast", {
              message: `${ig.item_name} 已出现在背包中`,
              type: 'success',
              duration: 4000,
            });
          }
        }
      }

      // Fog messages
      else if (message.type === "fog_update") {
	        const messageUserId = data?.user_id;
        // DM绘制时忽略自己发送的消息，避免闪烁
        if (isDM && messageUserId === userId) {
          logger.debug(`[useMapWebSocket] Ignoring own fog update`);
          return;
        }
				const { fog_data: newFogData, map_url } = data || {};
			logger.debug(`[useMapWebSocket] Fog updated for map ${map_url} from user ${messageUserId}`);
			if (map_url === currentMapUrl) {
          setFogData(newFogData);
        }
      } else if (message.type === "fog_fill_all") {
	        const messageUserId = data?.user_id;
        // DM操作时忽略自己发送的消息，避免闪烁
        if (isDM && messageUserId === userId) {
          logger.debug(`[useMapWebSocket] Ignoring own fog fill all`);
          return;
        }
				const { map_url } = data || {};
			if (map_url === currentMapUrl) {
          logger.debug(`[useMapWebSocket] Fill all fog received from user ${messageUserId}`);
          (window as any).__fillFogOfWar?.();
        }
      } else if (message.type === "fog_clear_all") {
	        const messageUserId = data?.user_id;
        // DM操作时忽略自己发送的消息，避免闪烁
        if (isDM && messageUserId === userId) {
          logger.debug(`[useMapWebSocket] Ignoring own fog clear all`);
          return;
        }
				const { map_url } = data || {};
			if (map_url === currentMapUrl) {
          logger.debug(`[useMapWebSocket] Clear all fog received from user ${messageUserId}`);
          (window as any).__clearFogOfWar?.();
        }
      }

      // Terrain messages
      else if (message.type === "terrain_update") {
        const messageUserId = data?.user_id;
        if (isDM && messageUserId === userId) {
          logger.debug(`[useMapWebSocket] Ignoring own terrain update`);
          return;
        }
        const { terrain_data, map_url } = data || {};
        if (map_url === currentMapUrl && terrain_data) {
          logger.debug(`[useMapWebSocket] Terrain updated for map ${map_url}`);
          setTerrainData(terrain_data);
        }
      } else if (message.type === "terrain_clear_all") {
        const messageUserId = data?.user_id;
        if (isDM && messageUserId === userId) {
          logger.debug(`[useMapWebSocket] Ignoring own terrain clear all`);
          return;
        }
        const { map_url } = data || {};
        if (map_url === currentMapUrl) {
          logger.debug(`[useMapWebSocket] Clear all terrain received`);
          setTerrainData({ mapUrl: currentMapUrl || "", cells: [] });
          (window as any).__clearAllTerrain?.();
        }
      }
      // Terrain visibility toggle (DM → players)
      else if (message.type === "terrain_visibility") {
        const { visible } = data || {};
        logger.debug(`[useMapWebSocket] Terrain visibility changed to ${visible}`);
        setShowTerrainToPlayers?.(!!visible);
      }

      // Ruler messages
      else if (message.type === "ruler_added") {
	        const messageUserId = data?.user_id;
        // DM操作时忽略自己发送的消息，避免重复添加
        if (isDM && messageUserId === userId) {
          logger.debug(`[useMapWebSocket] Ignoring own ruler_added`);
          return;
        }
	        const { ruler } = data || {};
        if (ruler && ruler.map_url === currentMapUrl) {
          logger.debug(`[useMapWebSocket] Ruler added from user ${messageUserId}`);
          setRulers((prev) => [...prev, ruler]);
        }
      } else if (message.type === "ruler_removed") {
	        const messageUserId = data?.user_id;
        // DM操作时忽略自己发送的消息，避免重复移除
        if (isDM && messageUserId === userId) {
          logger.debug(`[useMapWebSocket] Ignoring own ruler_removed`);
          return;
        }
	        const { ruler_id } = data || {};
        logger.debug(`[useMapWebSocket] Ruler removed from user ${messageUserId}:`, ruler_id);
        setRulers((prev) => prev.filter((r) => r.id !== ruler_id));
      } else if (message.type === "rulers_cleared") {
	        const messageUserId = data?.user_id;
        // DM操作时忽略自己发送的消息，避免重复清除
        if (isDM && messageUserId === userId) {
          logger.debug(`[useMapWebSocket] Ignoring own rulers_cleared`);
          return;
        }
				const { map_url } = data || {};
			if (map_url === currentMapUrl) {
          logger.debug(`[useMapWebSocket] Rulers cleared from user ${messageUserId}`);
          setRulers(() => []);
        }
      }

      // Shop transactions/inventory updates
      else if (message.type === "shop_transaction") {
        try {
	          const shopId = data?.shop_id;
	          const inventory = data?.inventory;
	          const characterId = data?.character_id;
	          const characterCurrency = data?.character_currency;

          // Trigger character panels to refresh equipment/currency
          if (characterId) {
            publishAppEvent("characterEquipmentUpdated", { characterId, currency: characterCurrency });
            logger.debug(`[useMapWebSocket] Dispatched characterEquipmentUpdated for char ${characterId}`);
          }
        } catch (e) {
          logger.warn("[useMapWebSocket] Failed to dispatch shop events", e);
        }
      }

      // Grid unit update (DM also processes own echo to sync internal state)
      else if (message.type === "grid_unit_update") {
			const { map_url, grid_unit_length: newGridUnitLength } = data || {};
			if (map_url === currentMapUrl && newGridUnitLength != null) {
          logger.debug(`[useMapWebSocket] Grid unit length updated to ${newGridUnitLength}`);
          setGridUnitLength(newGridUnitLength);
        }
      }

      // Anchor update
      else if (message.type === "anchor_update") {
        const messageUserId = data?.user_id;
        if (messageUserId === userId) {
          return;
        }
        const { map_url, anchor_x, anchor_y } = data || {};
        if (map_url === currentMapUrl && setAnchorPosition) {
          if (anchor_x != null && anchor_y != null) {
            logger.debug(`[useMapWebSocket] Anchor set at (${anchor_x}, ${anchor_y}) from user ${messageUserId}`);
            setAnchorPosition({ x: anchor_x, y: anchor_y });
          } else {
            logger.debug(`[useMapWebSocket] Anchor cleared from user ${messageUserId}`);
            setAnchorPosition(null);
          }
        }
      }

      // Marker messages
      else if (message.type === "marker_created") {
	        const marker = data?.marker as MapMarker | undefined;
        if (marker && marker.map_url === currentMapUrl) {
          logger.debug(`[useMapWebSocket] Marker created:`, marker.label, "at", marker.position_x, marker.position_y);
          setMarkers((prev) => [...prev, marker]);
        }
      } else if (message.type === "marker_updated") {
	        const marker = data?.marker as MapMarker | undefined;
        if (marker && marker.map_url === currentMapUrl) {
          logger.debug(`[useMapWebSocket] Marker updated:`, marker.id, marker.label);
          setMarkers((prev) => prev.map((m) => (m.id === marker.id ? marker : m)));
        }
      } else if (message.type === "marker_deleted") {
	        const marker_id = data?.marker_id;
	        const map_url = data?.map_url;
        if (map_url === currentMapUrl) {
          logger.debug(`[useMapWebSocket] Marker deleted:`, marker_id);
          setMarkers((prev) => prev.filter((m) => m.id !== marker_id));
        }
      } else if (message.type === "markers_cleared") {
	        const map_url = data?.map_url;
        if (map_url === currentMapUrl) {
          logger.debug(`[useMapWebSocket] All markers cleared for map:`, map_url);
          setMarkers(() => []);
        }
      }

      // Dice result messages - show bubbles globally regardless of ChatPanel state
      else if (message.type === "chat" && data?.msg_type === "dice_result") {
        const results = data?.results || [];
        const actor = data?.actor;
        const dc = data?.dc;
        const success = data?.success;
        const context = data?.context;

        for (const r of results) {
          // Determine character ID for bubble
          const actorCharacterId = actor?.character_id;
          const actorMonsterInstanceId = actor?.monster_instance_id;
          const bubbleCharacterId = actorCharacterId || (actorMonsterInstanceId ? `m_${actorMonsterInstanceId}` : null);

          if (bubbleCharacterId) {
            // Build message with success/failure for pick-lock and other DC checks
            let bubbleMessage = r.description || r.skill || r.ability || '投骰';
            if (dc !== undefined && success !== undefined) {
              // Add success/failure info to the message
              const successText = success ? '✓ 成功' : '✗ 失败';
              bubbleMessage = `${bubbleMessage} ${successText}`;

              // Special handling for pick-lock
              if (context?.action === 'pick_lock') {
                bubbleMessage = success ? '🔓 撬锁成功!' : '🔒 撬锁失败';
              }
            }

            showCharacterBubble({
              characterId: bubbleCharacterId,
              characterName: actor?.name || '未知',
              message: bubbleMessage,
              type: 'dice',
              diceResult: r.total,
              diceExpression: r.expression,
              messageId: data?.message_id,
              senderUserId: actor?.user_id || data?.user_id,
            });
          }
        }
      }

      // Chest unlocked notification
      else if (message.type === "chest_unlocked") {
        const chestName = data?.chest?.name || '宝箱';
        logger.debug(`[useMapWebSocket] Chest unlocked: ${chestName}`);
        publishAppEvent("chestStateChanged", { chest: data?.chest });
      }

      // Chest state changes (opened, looted, updated, etc.)
      else if (message.type === "chest_opened" || message.type === "chest_looted" ||
               message.type === "chest_updated" || message.type === "chest_inventory_updated" ||
               message.type === "chest_trap_detected" || message.type === "chest_trap_disarmed" ||
               message.type === "chest_trap_triggered") {
        logger.debug(`[useMapWebSocket] Chest state changed: ${message.type}`, data?.chest);
        publishAppEvent("chestStateChanged", { chest: data?.chest, eventType: message.type });
      }

      // Drawing messages
      else {
        handleDrawingWebSocketMessage(
          message,
          currentMapUrl || "",
          userId || "",
          isDM,
          setDrawings
        );
      }
    },
  });

  useEffect(() => subscribeAppEvent("classFeatureUsesUpdated", (detail) => {
    rememberClassFeatureUpdate(detail);
  }), []);

  // Listen for monster avatar updates from FloatingTokenPanel
  useEffect(() => {
    const handler = ({
      monsterInstanceId,
      avatarUrl,
    }: {
      monsterInstanceId?: number;
      avatarUrl?: string;
    }) => {
      if (monsterInstanceId && avatarUrl) {
        setTokens((prev) => prev.map((t) =>
          t.monster_instance_id === monsterInstanceId ? { ...t, avatar: avatarUrl } : t
        ));
      }
    };
    return subscribeAppEvent("monsterAvatarUpdated", handler);
  }, [setTokens]);

  return { isConnected, sendMessage };
}
