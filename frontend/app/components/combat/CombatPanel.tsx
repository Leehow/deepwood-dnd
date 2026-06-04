import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { apiFetch } from "~/utils/api-client";
import { fetchCampaignCombatStateCached } from "~/utils/combatStateCache";
import { fetchCampaignMapTokensCached } from "~/utils/mapTokensCache";
import { fetchCampaignChatMessagesCached } from "~/queries/chatQueries";
import { createLogger } from '~/utils/logger';
import { CombatSummaryModal } from "./CombatSummaryModal";
import { DeathSavePanel } from "./DeathSavePanel";
import {
  getBonusActionFeatures,
  getExtraAttackCount,
  getExtraAttackFeatureDetails,
  getPassiveFeatures,
} from "~/hooks/usePassiveFeatures";
import {
  publishAppEvent,
  subscribeAppEvent,
  type CombatActionUsedEventPayload,
  type CombatAttackResultEventPayload,
  type CombatBonusAttackGrantedEventPayload,
  type CombatReactionUsedEventPayload,
} from "~/events/appEventBus";
import { extractGrantedActions } from "~/utils/grantedActions";
import { getAvailableReactions, type ReactionDefinition } from "~/utils/reactionRegistry";
import { getCombatTurnIndex, withCombatTurnIndex } from "~/utils/combatTurnIndex";
const logger = createLogger('CombatPanel');

// Resource type for the explanation modal
type ResourceType = 'movement' | 'attack' | 'bonus_action' | 'reaction' | null;

type PassiveFeatureExecution = {
  trigger?: string;
  type?: string;
  conditions?: {
    requiresPositiveHp?: boolean;
    currentHpAtOrBelowMaxFraction?: number;
  };
  heal?: {
    base?: number;
    bonus?: {
      type?: string;
      ability?: string;
      value?: number;
    } | number;
  };
  toastMessage?: string;
};

type PassiveHealBonus =
  | number
  | {
      type?: string;
      ability?: string;
      value?: number;
    };

type CharacterSheetFeature = {
  id?: string;
  name?: string;
  execution?: PassiveFeatureExecution;
};

interface MapToken {
  id: number;
  character_id?: number | null;
  monster_instance_id?: number | null;
  instance_name?: string | null;
  character_name?: string | null;
  monster_name?: string | null;
  avatar?: string | null;
  current_hp?: number | null;
  max_hp?: number | null;
  temp_hp?: number | null;
  death_saves?: { successes: number; failures: number; stabilized: boolean } | null;
  user_id?: string | null;
  position_x?: number | null;
  position_y?: number | null;
  controller_character_id?: number | null;
  control_type?: string | null;
  entity_type?: string | null;
  active_effects?: any[] | null;
  concentration_spell?: { spell_id: string; [key: string]: any } | null;
}

type Faction = 1 | 2;
type ControlMode = "manual" | "ai";

interface Participant {
  token_id: number;
  name: string;
  type: "character" | "monster" | "item";
  faction: Faction;
  control_mode: ControlMode;
  surprised: boolean;
  initiative: number;
  dex_mod: number;
}

interface TurnActions {
  attacksUsed: number;
  attacksMax: number;
  bonusActionUsed: boolean;
  movementRemaining: number;
  movementMax: number;
  reactionUsed: boolean;
}

interface CombatState {
  status: "setup" | "in_progress" | "ended";
  map_url?: string | null;
  participants: Participant[];
  order: number[];
  /** Legacy field — kept in sync with current_turn_index for backend compatibility. */
  current_index: number;
  /** Backend runtime-preferred field; mirrors current_index. */
  current_turn_index?: number;
  round: number;
  surprise: { enabled: boolean; faction: Faction | null; resolved: boolean };
  monster_control: ControlMode;
  log: { round: number; token_id: number; action?: string; note?: string; ts: number }[];
  started_at: number;
  turn_actions?: TurnActions;
  /** Per-participant turn actions, keyed by token_id */
  participant_turn_actions?: Record<number, TurnActions>;
}

interface CampaignStorageObject<T = any> {
  id: number;
  campaign_id: number;
  object_type: string;
  object_id: string;
  object_name: string;
  data: T;
  is_active: boolean;
  version: number;
}

/** Check if a token has Haste-like effects that grant extra attacks */
function getSpellExtraAttacks(token: { active_effects?: any[] | null; concentration_spell?: { spell_id: string } | null }): number {
  let extra = 0;
  const checked = new Set<string>();

  // Check concentration spell
  if (token.concentration_spell?.spell_id) {
    const sid = token.concentration_spell.spell_id;
    checked.add(sid);
    const actions = extractGrantedActions(sid);
    for (const a of actions) {
      if (a.effect.actionKind === 'extra_action' && a.effect.allowedActions?.includes('attack_one')) {
        extra += 1;
      }
    }
  }

  // Check incoming spell buffs (active_effects with spell_id)
  if (token.active_effects) {
    for (const eff of token.active_effects) {
      const sid = eff.spell_id || eff.id?.replace('spell_buff_', '');
      if (!sid || checked.has(sid)) continue;
      checked.add(sid);
      const actions = extractGrantedActions(sid);
      for (const a of actions) {
        if (a.effect.actionKind === 'extra_action' && a.effect.allowedActions?.includes('attack_one')) {
          extra += 1;
        }
      }
    }
  }

  return extra;
}

function getAbilityModifier(score: unknown): number {
  const numericScore = Number(score ?? 10);
  return Math.floor((numericScore - 10) / 2);
}

function formatPassiveExecutionText(
  template: string | undefined,
  values: Record<string, string | number>,
): string {
  if (!template) {
    return '';
  }

  let formatted = template;
  for (const [key, value] of Object.entries(values)) {
    formatted = formatted.split(`{${key}}`).join(String(value));
  }
  return formatted;
}

function resolvePassiveHealBonus(
  bonus: PassiveHealBonus | undefined,
  abilityScores: Record<string, number> | null | undefined,
): number {
  if (typeof bonus === 'number') {
    return bonus;
  }
  if (!bonus || typeof bonus !== 'object') {
    return 0;
  }
  if (bonus.type === 'ability_modifier') {
    return getAbilityModifier(abilityScores?.[String(bonus.ability || '')]);
  }
  if (typeof bonus.value === 'number') {
    return bonus.value;
  }
  return 0;
}

function resolveStartOfTurnPassiveEffects({
  features,
  character,
  currentHp,
  maxHp,
  sourceName,
}: {
  features: CharacterSheetFeature[];
  character: {
    ability_scores?: Record<string, number> | null;
    abilities?: Record<string, number> | null;
  };
  currentHp: number;
  maxHp: number;
  sourceName: string;
}): {
  nextHp: number;
  totalHealing: number;
  messages: string[];
  appliedFeatureIds: string[];
} {
  if (maxHp <= 0) {
    return { nextHp: currentHp, totalHealing: 0, messages: [], appliedFeatureIds: [] };
  }

  const abilityScores = character.ability_scores || character.abilities || {};
  let nextHp = currentHp;
  let totalHealing = 0;
  const messages: string[] = [];
  const appliedFeatureIds: string[] = [];

  for (const feature of features) {
    const execution = feature.execution;
    if (!execution || execution.trigger !== 'start_of_turn') {
      continue;
    }
    if (execution.type !== 'start_of_turn_self_heal') {
      continue;
    }

    const requiresPositiveHp = execution.conditions?.requiresPositiveHp !== false;
    if (requiresPositiveHp && nextHp <= 0) {
      continue;
    }

    const hpFraction = Number(execution.conditions?.currentHpAtOrBelowMaxFraction ?? NaN);
    if (Number.isFinite(hpFraction) && hpFraction > 0 && nextHp > maxHp * hpFraction) {
      continue;
    }

    const healBase = Number(execution.heal?.base || 0);
    const healBonus = resolvePassiveHealBonus(execution.heal?.bonus, abilityScores);
    const requestedHealing = healBase + healBonus;
    if (requestedHealing <= 0) {
      continue;
    }

    const actualHealing = Math.min(requestedHealing, maxHp - nextHp);
    if (actualHealing <= 0) {
      continue;
    }

    nextHp += actualHealing;
    totalHealing += actualHealing;
    if (feature.id) {
      appliedFeatureIds.push(feature.id);
    }

    messages.push(
      formatPassiveExecutionText(execution.toastMessage, {
        source: sourceName,
        healing: actualHealing,
        feature: feature.name || '',
      }) || `${sourceName} 的${feature.name || '特性'}恢复了 ${actualHealing} 点生命值`
    );
  }

  return { nextHp, totalHealing, messages, appliedFeatureIds };
}

export function CombatPanel({
  campaignId,
  currentMapUrl,
  isDM,
  userId,
  sendMessage,
}: {
  campaignId: string;
  currentMapUrl: string | null;
  isDM: boolean;
  userId?: string;
  sendMessage?: (message: any) => void;
}) {
  const authedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    apiFetch(input, init);
  const [loading, setLoading] = useState(false);
  const [tokens, setTokens] = useState<MapToken[]>([]);
  const [setupOpen, setSetupOpen] = useState(false);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [factionMap, setFactionMap] = useState<Record<number, Faction>>({});
  const [surpriseEnabled, setSurpriseEnabled] = useState(false);
  const [surpriseFaction, setSurpriseFaction] = useState<Faction>(2);
  const [monsterControl, setMonsterControl] = useState<ControlMode>("manual");
  const [combatObj, setCombatObj] = useState<CampaignStorageObject<CombatState> | null>(null);
  const [actorDetails, setActorDetails] = useState<{
    type: "monster" | "character";
    name?: string;
    hp?: number;
    maxHp?: number;
    ac?: number;
    speed?: string | { walk?: number; fly?: number; swim?: number; climb?: number; burrow?: number };
    actions?: Array<{ name: string; description: string }> | string;
    specialAbilities?: Array<{ name: string; description: string }>;
    legendaryActions?: Array<{ name: string; description: string }>;
    reactions?: Array<{ name: string; description: string }>;
    spellcasting?: any;
    classInfo?: string;
    classId?: string;
    subclassId?: string;
    level?: number;
    spells?: Array<{ name: string; level: number }>;
    features?: Array<{ name: string; description?: string }>;
    // Character actions with action_type from /sheet endpoint
    characterActions?: Array<{ name: string; description?: string; action_type: string; uses?: { current: number; max: number; recharge?: string } }>;
    availableReactions?: ReactionDefinition[];
    conditions?: string[];
  } | null>(null);
  const [dmSelectedActorDetails, setDmSelectedActorDetails] = useState<typeof actorDetails>(null);
  const [hintsExpanded, setHintsExpanded] = useState(false);
  const [basicActionsExpanded, setBasicActionsExpanded] = useState(false);
  const [bonusActionsExpanded, setBonusActionsExpanded] = useState(false);
  const [reactionsExpanded, setReactionsExpanded] = useState(false);
  const [reactionHint, setReactionHint] = useState('');
  const [manualReactionMode, setManualReactionMode] = useState(false);
  const [monsterActionsExpanded, setMonsterActionsExpanded] = useState(false);
  const [specialAbilitiesExpanded, setSpecialAbilitiesExpanded] = useState(false);
  const [logExpanded, setLogExpanded] = useState(true);
  const [helpExpanded, setHelpExpanded] = useState(true);  // Default to expanded when no combat

  // Turn action tracking state
  const [turnActions, setTurnActions] = useState<TurnActions>({
    attacksUsed: 0,
    attacksMax: 1,
    bonusActionUsed: false,
    movementRemaining: 30,  // Default 30ft, will be updated when actorDetails loads
    movementMax: 30,
    reactionUsed: false,
  });

  // Resource explanation modal state
  const [resourceModalType, setResourceModalType] = useState<ResourceType>(null);

  // DM: track which token is selected on the map (for showing non-current participant resources)
  const [dmSelectedTokenId, setDmSelectedTokenId] = useState<number | null>(null);

  // Local action log for displaying combat events (attacks and movements)
  type AttackLogEntry = {
    type: 'attack';
    round: number;
    attackerName: string;
    attackerId: number;
    targetName: string;
    targetId: number;
    attackName: string;
    hit: boolean;
    critical: boolean;
    fumble: boolean;
    damage: number;
    targetDefeated: boolean;
    targetAc?: number;
    content: string;
    ts: number;
  };
  type MoveLogEntry = {
    type: 'move';
    round: number;
    tokenId: number;
    tokenName: string;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    distance: number;
    ts: number;
  };
  type BonusActionLogEntry = {
    type: 'bonus_action';
    round: number;
    tokenId: number;
    tokenName: string;
    actionName: string;
    actionIcon: string;
    ts: number;
  };
  type ActionLogEntry = AttackLogEntry | MoveLogEntry | BonusActionLogEntry;

  const [attackLog, setAttackLog] = useState<ActionLogEntry[]>([]);

  // Track defeated participants for combat summary
  const [defeatedParticipants, setDefeatedParticipants] = useState<Array<{
    token_id: number;
    name: string;
    type: "character" | "monster";
    faction: Faction;
    monster_instance_id?: number;
    xp_value?: number;
  }>>([]);

  // Track damage stats per participant
  const [damageStats, setDamageStats] = useState<Record<number, {
    damage_dealt: number;
    damage_taken: number;
    kills: number;
  }>>({});

  // Skip message for dead participants
  const [skipMessage, setSkipMessage] = useState<string | null>(null);

  // Show summary modal before ending combat
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  // Selected basic action for info modal
  const [selectedBasicAction, setSelectedBasicAction] = useState<{
    key: string; name: string; icon: string; description: string; rules: string; cost: string;
  } | null>(null);

  const abilityMod = (score?: number | null) => {
    if (!score && score !== 0) return 0;
    return Math.floor((Number(score) - 10) / 2);
  };

  const currentTokenId = useMemo(() => {
    if (!combatObj?.data?.order?.length) return null;
    const idx = getCombatTurnIndex(combatObj.data, combatObj.data.order.length);
    return combatObj.data.order[idx] ?? null;
  }, [combatObj]);

  const currentParticipant = useMemo(() => {
    if (!combatObj?.data?.participants) return null;
    return combatObj.data.participants.find((p) => p.token_id === currentTokenId) || null;
  }, [combatObj, currentTokenId]);

  const isCurrentActorSurprised = useMemo(() => {
    const cs = combatObj?.data;
    if (!cs || cs.round !== 1 || !cs.surprise?.enabled || !currentParticipant) return false;
    return cs.surprise.faction === currentParticipant.faction;
  }, [combatObj, currentParticipant]);

  // DM: derive selected participant info (only when selecting a non-current combatant)
  const dmSelectedParticipant = useMemo(() => {
    if (!isDM || !combatObj?.data?.participants || !dmSelectedTokenId || dmSelectedTokenId === currentTokenId) return null;
    return combatObj.data.participants.find(p => p.token_id === dmSelectedTokenId) || null;
  }, [isDM, combatObj, dmSelectedTokenId, currentTokenId]);

  const dmSelectedTurnActions = useMemo<TurnActions | null>(() => {
    if (!dmSelectedParticipant || !dmSelectedTokenId || !combatObj) return null;
    return combatObj.data.participant_turn_actions?.[dmSelectedTokenId] || {
      attacksUsed: 0, attacksMax: 1,
      bonusActionUsed: false,
      movementRemaining: 30, movementMax: 30,
      reactionUsed: false,
    };
  }, [dmSelectedParticipant, dmSelectedTokenId, combatObj]);

  const loadTokens = useCallback(async () => {
    if (!currentMapUrl) return;
    try {
      const data = await fetchCampaignMapTokensCached(campaignId, currentMapUrl, { userId });
      const list: MapToken[] = data.tokens || [];
      setTokens(list);
      const nextSel: Record<number, boolean> = {};
      const nextFac: Record<number, Faction> = {};
      for (const t of list) {
        const isMonster = !!t.monster_instance_id;
        const isCompanion = !!t.control_type;  // companion/familiar/summon/mount
        const isNpc = t.entity_type === 'npc';
        if (isMonster || t.character_id) {
          nextSel[t.id] = !isNpc;  // NPC默认不参与战斗
          nextFac[t.id] = (isMonster && !isCompanion) ? 2 : 1;
        }
      }
      setSelected(nextSel);
      setFactionMap(nextFac);
    } catch (e) { logger.error("[CombatPanel] Failed to load tokens:", e); }
  }, [campaignId, currentMapUrl, userId]);

  const loadCombat = useCallback(async (force = false) => {
    try {
      const obj = await fetchCampaignCombatStateCached(campaignId, { force }) as CampaignStorageObject<CombatState> | null;
      if (obj && obj.is_active !== false) setCombatObj(obj);
      else setCombatObj(null);
    } catch (e) { logger.error("[CombatPanel] Failed to load combat state:", e); }
  }, [campaignId]);

  // Debounced save for turn actions
  const saveTurnActionsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTurnActions = useCallback((actions: TurnActions) => {
    if (!combatObj) return;
    if (saveTurnActionsTimer.current) clearTimeout(saveTurnActionsTimer.current);
    saveTurnActionsTimer.current = setTimeout(async () => {
      try {
        // Save both current turn_actions and per-participant actions
        const participantActions = { ...(combatObj.data.participant_turn_actions || {}) };
        if (currentTokenId) {
          participantActions[currentTokenId] = actions;
        }
        const newData = { ...combatObj.data, turn_actions: actions, participant_turn_actions: participantActions };
        const resp = await authedFetch(`/api/campaigns/${campaignId}/storage/combat/current`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: newData, version: combatObj.version, updated_by: userId || "system" }),
        });
        if (resp.ok) {
          setCombatObj(await resp.json() as CampaignStorageObject<CombatState>);
        } else if (resp.status === 409) {
          await loadCombat(true);
        }
      } catch (e) { logger.error("[CombatPanel] Failed to save turn actions:", e); }
    }, 300);
  }, [combatObj, campaignId, userId, currentTokenId, loadCombat, authedFetch]);

  // Save turn actions for a specific (non-current) participant
  const saveParticipantTurnActionsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveParticipantTurnActions = useCallback((tokenId: number, actions: TurnActions) => {
    if (!combatObj) return;
    if (saveParticipantTurnActionsTimer.current) clearTimeout(saveParticipantTurnActionsTimer.current);
    saveParticipantTurnActionsTimer.current = setTimeout(async () => {
      try {
        const participantActions = { ...(combatObj.data.participant_turn_actions || {}), [tokenId]: actions };
        const newData = { ...combatObj.data, participant_turn_actions: participantActions };
        const resp = await authedFetch(`/api/campaigns/${campaignId}/storage/combat/current`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: newData, version: combatObj.version, updated_by: userId || "system" }),
        });
        if (resp.ok) {
          setCombatObj(await resp.json() as CampaignStorageObject<CombatState>);
        } else if (resp.status === 409) {
          await loadCombat(true);
        }
      } catch (e) { logger.error("[CombatPanel] Failed to save participant turn actions:", e); }
    }, 300);
  }, [combatObj, campaignId, userId, loadCombat, authedFetch]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (saveTurnActionsTimer.current) clearTimeout(saveTurnActionsTimer.current);
      if (saveParticipantTurnActionsTimer.current) clearTimeout(saveParticipantTurnActionsTimer.current);
    };
  }, []);

  // Load persisted combat messages from chat API
  const loadCombatMessages = useCallback(async () => {
    if (!combatObj) return;
    try {
      const response = await fetchCampaignChatMessagesCached(campaignId, {
        limit: 50,
        messageType: "combat",
      });
      const messages = Array.isArray(response?.messages) ? response.messages : [];
        // Get combat start time to filter only current combat's messages
        const combatStartTime = combatObj.data.started_at || 0;

        // Convert combat messages to attack log format, only include messages from current combat
        const attacks = (messages || [])
          .filter((msg: any) => {
            if (msg.meta?.combat_type !== 'attack') return false;
            // Only include messages created after combat started
            const msgTime = new Date(msg.created_at).getTime();
            return msgTime >= combatStartTime;
          })
          .map((msg: any) => ({
            type: 'attack' as const,
            round: msg.meta?.round || 1,
            attackerName: msg.meta?.attacker_name || '???',
            attackerId: msg.meta?.attacker_token_id || 0,
            targetName: msg.meta?.target_name || '???',
            targetId: msg.meta?.target_token_id || 0,
            targetMonsterInstanceId: msg.meta?.target_monster_instance_id || null,
            targetXpValue: msg.meta?.xp_value || 0,
            attackName: msg.meta?.attack_name || '攻击',
            hit: msg.meta?.hit ?? false,
            critical: msg.meta?.critical ?? false,
            fumble: msg.meta?.fumble ?? false,
            damage: msg.meta?.damage_dealt || 0,
            targetDefeated: msg.meta?.target_defeated ?? false,
            targetAc: msg.meta?.target_ac,
            content: msg.content || '',
            ts: new Date(msg.created_at).getTime()
          }))
          .sort((a: any, b: any) => a.ts - b.ts);
        setAttackLog(attacks);

        // Rebuild damageStats and defeatedParticipants from historical attacks
        const newDamageStats: Record<number, { damage_dealt: number; damage_taken: number; kills: number }> = {};
        const defeatedTokenIds = new Set<number>();
        const defeatedList: Array<{
          token_id: number;
          name: string;
          type: "character" | "monster";
          faction: Faction;
          monster_instance_id?: number;
          xp_value?: number;
        }> = [];

        for (const atk of attacks) {
          if (atk.hit && atk.damage > 0) {
            // Update attacker damage_dealt
            if (!newDamageStats[atk.attackerId]) {
              newDamageStats[atk.attackerId] = { damage_dealt: 0, damage_taken: 0, kills: 0 };
            }
            newDamageStats[atk.attackerId].damage_dealt += atk.damage;

            // Update target damage_taken
            if (!newDamageStats[atk.targetId]) {
              newDamageStats[atk.targetId] = { damage_dealt: 0, damage_taken: 0, kills: 0 };
            }
            newDamageStats[atk.targetId].damage_taken += atk.damage;

            if (atk.targetDefeated) {
              newDamageStats[atk.attackerId].kills += 1;
              defeatedTokenIds.add(atk.targetId);
            }
          }
        }
        setDamageStats(newDamageStats);

        // Build defeatedParticipants with XP values from metadata
        for (const atk of attacks) {
          if (atk.targetDefeated && !defeatedList.some(d => d.token_id === atk.targetId)) {
            const targetParticipant = combatObj.data.participants.find(p => p.token_id === atk.targetId);
            // Use metadata values - these are persisted even if token is deleted
            const isMonster = !!atk.targetMonsterInstanceId;

            defeatedList.push({
              token_id: atk.targetId,
              name: atk.targetName,
              type: isMonster ? "monster" : "character",
              faction: targetParticipant?.faction || 2,
              monster_instance_id: atk.targetMonsterInstanceId || undefined,
              xp_value: atk.targetXpValue || 0
            });
          }
        }
        setDefeatedParticipants(defeatedList);
    } catch (e) { logger.error("[CombatPanel] Failed to load combat messages:", e); }
  }, [campaignId, combatObj]);

  // Load combat messages when combat object changes
  useEffect(() => {
    if (combatObj) {
      loadCombatMessages();
    }
  }, [combatObj?.id]);

  // Ref to track current combatObj for WebSocket handler without re-registering
  const combatObjRef = useRef(combatObj);
  const processedStartOfTurnKeyRef = useRef<string | null>(null);
  useEffect(() => { combatObjRef.current = combatObj; }, [combatObj]);

  useEffect(() => {
    const onUpdate = (ev: any) => {
      const obj = ev.detail as CampaignStorageObject<CombatState>;
      if (obj?.object_type === "combat" && obj.object_id === "current") {
        // If combat is no longer active (e.g., all participants removed), clear it
        if (obj.is_active === false) {
          setCombatObj(null);
          setAttackLog([]);
        } else {
          const prevObj = combatObjRef.current;
          setCombatObj(obj);
          // Only sync turnActions from remote if the turn changed (current_index or round changed)
          // Don't overwrite local turnActions from remote echoes of our own saves
          const turnChanged = !prevObj
            || getCombatTurnIndex(obj.data) !== getCombatTurnIndex(prevObj.data)
            || obj.data.round !== prevObj.data.round;
          if (turnChanged) {
            if (obj.data.turn_actions) {
              setTurnActions(obj.data.turn_actions);
            } else {
              setTurnActions({
                attacksUsed: 0, attacksMax: 1,
                bonusActionUsed: false,
                movementRemaining: 30, movementMax: 30,
                reactionUsed: false,
              });
            }
          }
        }
      }
    };
    const onDelete = () => {
      setCombatObj(null);
      setAttackLog([]);  // Clear attack log when combat ends
    };
    const unsubscribeUpdated = subscribeAppEvent("combatStorageUpdated", onUpdate as any);
    const unsubscribeDeleted = subscribeAppEvent("combatStorageDeleted", onDelete as any);
    return () => {
      unsubscribeUpdated();
      unsubscribeDeleted();
    };
  }, []);

  useEffect(() => {
    if (!isDM || !combatObj || !currentTokenId) return;

    const activeToken = tokens.find(token => token.id === currentTokenId);
    if (!activeToken) return;

    const turnKey = `${combatObj.data.round}:${currentTokenId}`;
    if (processedStartOfTurnKeyRef.current === turnKey) {
      return;
    }
    processedStartOfTurnKeyRef.current = turnKey;

    if (!activeToken.character_id) {
      return;
    }

    let cancelled = false;

    const applyStartOfTurnPassives = async () => {
      try {
        const resp = await authedFetch(`/api/characters/${activeToken.character_id}/sheet`);
        if (!resp.ok) {
          return;
        }

        const sheetData = await resp.json();
        const character = sheetData.character || {};
        const actorName = character.name || activeToken.instance_name || activeToken.character_name || '该角色';
        const passiveResult = resolveStartOfTurnPassiveEffects({
          features: Array.isArray(sheetData.features) ? sheetData.features : [],
          character,
          currentHp: Number(activeToken.current_hp ?? character.hit_points_current ?? 0),
          maxHp: Number(activeToken.max_hp ?? character.hit_points_max ?? activeToken.current_hp ?? 0),
          sourceName: actorName,
        });
        if (passiveResult.totalHealing <= 0) {
          return;
        }

        const hpResp = await authedFetch(`/api/tokens/${activeToken.id}/hp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ current_hp: passiveResult.nextHp, force: true }),
        });
        if (!hpResp.ok) {
          return;
        }

        const updatedToken = await hpResp.json();
        if (cancelled) {
          return;
        }

        setTokens(prev => prev.map(token => (
          token.id === activeToken.id
            ? {
                ...token,
                current_hp: updatedToken.current_hp ?? token.current_hp,
                temp_hp: updatedToken.temp_hp ?? token.temp_hp,
                max_hp: updatedToken.max_hp ?? token.max_hp,
              }
            : token
        )));

        for (const message of passiveResult.messages) {
          publishAppEvent("showToast", {
            message,
            type: 'success',
          });
        }
        logger.info('[CombatPanel] Start-of-turn passive applied', {
          tokenId: activeToken.id,
          totalHealing: passiveResult.totalHealing,
          featureIds: passiveResult.appliedFeatureIds,
        });
      } catch (e) {
        logger.error('[CombatPanel] Failed to apply start-of-turn passives:', e);
      }
    };

    void applyStartOfTurnPassives();

    return () => {
      cancelled = true;
    };
  }, [isDM, combatObj, currentTokenId, tokens, authedFetch]);

  // Listen for combat attack results via WebSocket
  useEffect(() => {
    const handleCombatAttack = async (data: CombatAttackResultEventPayload) => {
      if (!data?.result || !combatObj) return;
      const { result } = data;
      const currentRound = combatObj.data.round || 1;

      // Get token IDs from the result
      const attackerId = result.attacker_token_id as number;
      const targetId = result.target_token_id as number;
      const damageDealt = result.damage_dealt || 0;
      const targetDefeated = result.target_defeated || false;

      setAttackLog(prev => [...prev, {
        type: 'attack' as const,
        round: currentRound,
        attackerName: result.attacker_name,
        attackerId: attackerId || 0,
        targetName: result.target_name,
        targetId: targetId || 0,
        attackName: result.attack_name,
        hit: result.hit,
        critical: !!result.critical,
        fumble: !!result.fumble,
        damage: damageDealt,
        targetDefeated,
        targetAc: result.target_ac,
        content: data.message || result.content || '',
        ts: Date.now()
      }]);

      // Update damage stats if hit
      if (result.hit && damageDealt > 0) {
        setDamageStats(prev => {
          const newStats = { ...prev };
          // Update attacker's damage_dealt
          if (!newStats[attackerId]) {
            newStats[attackerId] = { damage_dealt: 0, damage_taken: 0, kills: 0 };
          }
          newStats[attackerId].damage_dealt += damageDealt;
          if (targetDefeated) {
            newStats[attackerId].kills += 1;
          }
          // Update target's damage_taken
          if (!newStats[targetId]) {
            newStats[targetId] = { damage_dealt: 0, damage_taken: 0, kills: 0 };
          }
          newStats[targetId].damage_taken += damageDealt;
          return newStats;
        });
      }

      // Track defeated participant using broadcast data (no need to fetch)
      if (targetDefeated) {
        const targetParticipant = combatObj.data.participants.find(p => p.token_id === targetId);
        // Use values from broadcast data - these are already fetched by backend
        const targetMonsterInstanceId = data.target_monster_instance_id;
        const xpValue = data.xp_value || 0;

        setDefeatedParticipants(prev => {
          // Avoid duplicates
          if (prev.some(p => p.token_id === targetId)) return prev;
          return [...prev, {
            token_id: targetId,
            name: result.target_name,
            type: targetMonsterInstanceId ? "monster" : "character",
            faction: targetParticipant?.faction || 2,
            monster_instance_id: targetMonsterInstanceId || undefined,
            xp_value: xpValue
          }];
        });
      }
    };
    return subscribeAppEvent("combatAttackResult", (detail) => {
      void handleCombatAttack(detail);
    });
  }, [combatObj]);

  // Listen for movement events
  useEffect(() => {
    const handleCombatMove = ({
      tokenId,
      tokenName,
      fromX,
      fromY,
      toX,
      toY,
      distance,
    }: {
      tokenId: number;
      tokenName: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      distance: number;
    }) => {
      if (!combatObj) return;
      const currentRound = combatObj.data.round || 1;

      setAttackLog(prev => [...prev, {
        type: 'move' as const,
        round: currentRound,
        tokenId,
        tokenName,
        fromX,
        fromY,
        toX,
        toY,
        distance,
        ts: Date.now()
      }]);
    };
    return subscribeAppEvent("combatMoveResult", handleCombatMove);
  }, [combatObj]);

  // Listen for bonus action events
  useEffect(() => {
    const unsubscribe = subscribeAppEvent("combatBonusActionResult", ({ tokenId, tokenName, actionName, actionIcon }) => {
      if (!combatObj) return;
      const currentRound = combatObj.data.round || 1;

      setAttackLog(prev => [...prev, {
        type: 'bonus_action' as const,
        round: currentRound,
        tokenId,
        tokenName,
        actionName,
        actionIcon,
        ts: Date.now()
      }]);
    });
    return unsubscribe;
  }, [combatObj]);

  // Player's own character token in combat
  const myToken = useMemo(() => {
    if (isDM || !userId || !tokens.length || !combatObj) return null;
    const participantIds = new Set(combatObj.data.participants.map(p => p.token_id));
    return tokens.find(t => t.user_id === userId && t.character_id && participantIds.has(t.id)) || null;
  }, [isDM, userId, tokens, combatObj]);

  const isMyTurn = useMemo(() => {
    return !!(myToken && currentTokenId === myToken.id);
  }, [myToken, currentTokenId]);

  // Player's own turn actions (persisted across other participants' turns)
  const [myTurnActions, setMyTurnActions] = useState<TurnActions>({
    attacksUsed: 0, attacksMax: 1, bonusActionUsed: false,
    movementRemaining: 30, movementMax: 30, reactionUsed: false,
  });

  // Player's own character actions (for displaying in separate resource card)
  const [myCharacterActions, setMyCharacterActions] = useState<Array<{ name: string; description?: string; action_type: string; uses?: { current: number; max: number; recharge?: string } }>>([]);
  const [myReactions, setMyReactions] = useState<ReactionDefinition[]>([]);
  const [myConditions, setMyConditions] = useState<string[]>([]);

  // Track whether turnActions were restored from saved state (skip actorDetails override)
  const restoredFromSaved = useRef(false);

  // Reset turn actions when current participant changes
  useEffect(() => {
    // Try to restore from per-participant saved actions first, then fall back to turn_actions
    const perParticipant = currentTokenId ? combatObj?.data?.participant_turn_actions?.[currentTokenId] : null;
    const saved = perParticipant || combatObj?.data?.turn_actions;
    if (saved) {
      logger.info('[CombatPanel] Restoring saved turn actions for currentTokenId:', currentTokenId);
      setTurnActions(saved);
      restoredFromSaved.current = true;
    } else {
      logger.info('[CombatPanel] Resetting turn actions due to currentTokenId change:', currentTokenId);
      setTurnActions({
        attacksUsed: 0,
        attacksMax: 1,
        bonusActionUsed: false,
        movementRemaining: 30,
        movementMax: 30,
        reactionUsed: false,
      });
      restoredFromSaved.current = false;
    }
  }, [currentTokenId]);

  // Restore player's own turn actions from saved participant_turn_actions
  useEffect(() => {
    if (!myToken || !combatObj) return;
    const saved = combatObj.data.participant_turn_actions?.[myToken.id];
    if (saved) {
      setMyTurnActions(saved);
    }
  }, [myToken?.id, combatObj?.data?.participant_turn_actions]);

  // Reset myTurnActions when a new round starts (participant_turn_actions gets cleared)
  const prevRoundRef = useRef<number | null>(null);
  useEffect(() => {
    const currentRound = combatObj?.data?.round ?? null;
    if (prevRoundRef.current !== null && currentRound !== null && currentRound > prevRoundRef.current) {
      setMyTurnActions(prev => ({
        attacksUsed: 0,
        attacksMax: prev.attacksMax,
        bonusActionUsed: false,
        movementRemaining: prev.movementMax,
        movementMax: prev.movementMax,
        reactionUsed: false,
      }));
    }
    prevRoundRef.current = currentRound;
  }, [combatObj?.data?.round]);

  // Sync manual reaction targeting state with TacticalMap
  useEffect(() => {
    const handler = ({ active, sourceTokenId }: { active: boolean; sourceTokenId?: number }) => {
      if (!myToken) {
        setManualReactionMode(false);
        return;
      }
      if (!active) {
        setManualReactionMode(false);
        return;
      }
      setManualReactionMode(sourceTokenId === myToken.id);
    };
    return subscribeAppEvent("manualReactionModeChanged", handler);
  }, [myToken?.id]);

  // Exit manual reaction mode once reaction is spent or your turn begins
  useEffect(() => {
    if (!manualReactionMode || !myToken) return;
    if (!myTurnActions.reactionUsed && !isMyTurn) return;
    setManualReactionMode(false);
    publishAppEvent("manualReactionModeEnd", { sourceTokenId: myToken.id });
  }, [manualReactionMode, myToken?.id, myTurnActions.reactionUsed, isMyTurn]);

  // Initialize myTurnActions with correct max values from player's character
  const myTurnInitialized = useRef(false);
  useEffect(() => {
    if (!myToken || !myToken.character_id || isDM) return;
    // Always fetch character actions (they may change), but only init turn actions once
    const fetchMyCharData = async () => {
      try {
        const resp = await authedFetch(`/api/characters/${myToken.character_id}/sheet`);
        if (resp.ok) {
          const sheetData = await resp.json();
          const char = sheetData.character || {};
          const actions = sheetData.actions || [];
          setMyCharacterActions(actions);
          setMyConditions((char.status_effects?.active_conditions || []).map((c: any) => c.condition || c));
          // Compute available reactions for this character
          setMyReactions(getAvailableReactions({
            class_id: char.class_id || '',
            subclass_id: char.subclass_id,
            level: char.level || 1,
            feats: char.feats,
            prepared_spells: char.prepared_spells,
            selected_spells: char.selected_spells,
            selected_cantrips: char.selected_cantrips,
          }));
          if (!myTurnInitialized.current) {
            const saved = combatObj?.data?.participant_turn_actions?.[myToken.id];
            if (saved) { myTurnInitialized.current = true; return; }
            const speedValue = char.speed ? parseInt(char.speed) || 30 : 30;
            const baseAttacks = char.class_id && char.level
              ? getExtraAttackCount(char.class_id, char.level, char.subclass_id)
              : 1;
            const spellExtra = getSpellExtraAttacks(myToken);
            setMyTurnActions(prev => ({
              ...prev,
              attacksMax: baseAttacks + spellExtra,
              movementRemaining: speedValue,
              movementMax: speedValue,
            }));
            myTurnInitialized.current = true;
          }
        }
      } catch (e) { logger.error("[CombatPanel] Failed to fetch player char data:", e); }
    };
    fetchMyCharData();
  }, [myToken?.id, myToken?.character_id, isDM]);

  // Sync myTurnActions when it's the player's turn and turnActions change
  useEffect(() => {
    if (isMyTurn) {
      setMyTurnActions(turnActions);
    }
  }, [isMyTurn, turnActions]);

  // Update attacksMax and movement when actorDetails loads
  useEffect(() => {
    if (actorDetails) {
      // Parse speed value
      const speedValue = typeof actorDetails.speed === 'string'
        ? parseInt(actorDetails.speed) || 30
        : actorDetails.speed?.walk || 30;

      // If we restored from saved state, only update attacksMax (to include spell effects)
      // but preserve attacksUsed, movementRemaining, etc.
      if (restoredFromSaved.current) {
        restoredFromSaved.current = false;
        if (actorDetails.type === 'character' && actorDetails.classId && actorDetails.level) {
          const baseAttacks = getExtraAttackCount(actorDetails.classId, actorDetails.level, actorDetails.subclassId);
          const spellExtra = currentToken ? getSpellExtraAttacks(currentToken) : 0;
          const newMax = baseAttacks + spellExtra;
          setTurnActions(prev => prev.attacksMax !== newMax ? { ...prev, attacksMax: newMax } : prev);
        }
        return;
      }

      // Update both attacksMax and movement
      if (actorDetails.type === 'character' && actorDetails.classId && actorDetails.level) {
        const baseAttacks = getExtraAttackCount(actorDetails.classId, actorDetails.level, actorDetails.subclassId);
        const spellExtra = currentToken ? getSpellExtraAttacks(currentToken) : 0;
        setTurnActions(prev => ({
          ...prev,
          attacksMax: baseAttacks + spellExtra,
          movementRemaining: speedValue,
          movementMax: speedValue,
        }));
      } else {
        // Monster or character without class info - update movement and check spell extra attacks
        const spellExtra = currentToken ? getSpellExtraAttacks(currentToken) : 0;
        setTurnActions(prev => ({
          ...prev,
          attacksMax: spellExtra > 0 ? prev.attacksMax + spellExtra : prev.attacksMax,
          movementRemaining: speedValue,
          movementMax: speedValue,
        }));
      }
    }
  }, [actorDetails]);

  // Expose movement & attack state globally so TacticalMap can check before acting
  useEffect(() => {
    (window as any).__combatMovementRemaining = turnActions.movementRemaining;
    (window as any).__combatMovementMax = turnActions.movementMax;
    (window as any).__combatAttacksUsed = turnActions.attacksUsed;
    (window as any).__combatAttacksMax = turnActions.attacksMax;
    (window as any).__combatBonusActionUsed = turnActions.bonusActionUsed;
    // Expose movement deduction function for external callers (e.g. stand up from prone)
    (window as any).__combatDeductMovement = (amount: number) => {
      setTurnActions(prev => {
        const next = { ...prev, movementRemaining: Math.max(0, prev.movementRemaining - amount) };
        saveTurnActions(next);
        return next;
      });
    };
    // Clear dash flag when turn resets (bonusAction becomes available again)
    if (!turnActions.bonusActionUsed) {
      (window as any).__combatDashedThisTurn = false;
    }
    publishAppEvent("combatMovementChanged", { changedBy: "turnActions" });
    return () => {
      delete (window as any).__combatMovementRemaining;
      delete (window as any).__combatMovementMax;
      delete (window as any).__combatAttacksUsed;
      delete (window as any).__combatAttacksMax;
      delete (window as any).__combatBonusActionUsed;
      delete (window as any).__combatDashedThisTurn;
      delete (window as any).__combatDeductMovement;
    };
  }, [turnActions.movementRemaining, turnActions.movementMax, turnActions.attacksUsed, turnActions.attacksMax, turnActions.bonusActionUsed, saveTurnActions]);

  // Expose combat turn ownership info globally for turn-based restrictions
  useEffect(() => {
    const isActive = combatObj?.data?.status === "in_progress";
    (window as any).__combatIsActive = isActive;
    (window as any).__combatActiveTokenId = currentTokenId;
    (window as any).__combatRound = combatObj?.data?.round ?? 0;
    // Find the user_id of the current turn's token
    const activeToken = currentTokenId ? tokens.find(t => t.id === currentTokenId) : null;
    (window as any).__combatTurnUserId = activeToken?.user_id ?? null;
    logger.info('[CombatPanel] Turn ownership:', { currentTokenId, tokensLen: tokens.length, activeTokenUserId: activeToken?.user_id, userId });
    // Expose participant token IDs so non-combat players are not restricted
    const participantTokenIds = combatObj?.data?.participants?.map(p => p.token_id) ?? [];
    (window as any).__combatParticipantTokenIds = participantTokenIds;
    // Notify listeners (e.g., TokenComponent) that combat state changed
    publishAppEvent("combatTurnChanged", {
      activeTokenId: currentTokenId,
      round: combatObj?.data?.round ?? 0,
    });
    return () => {
      delete (window as any).__combatIsActive;
      delete (window as any).__combatActiveTokenId;
      delete (window as any).__combatRound;
      delete (window as any).__combatTurnUserId;
      delete (window as any).__combatParticipantTokenIds;
    };
  }, [combatObj?.data?.status, currentTokenId, tokens, combatObj?.data?.participants]);

  // Expose DM-selected token's movement info for MovementRangeOverlay
  useEffect(() => {
    if (isDM && dmSelectedTokenId && dmSelectedTurnActions) {
      (window as any).__combatDmSelectedTokenId = dmSelectedTokenId;
      (window as any).__combatDmSelectedMovement = dmSelectedTurnActions.movementRemaining;
    } else {
      delete (window as any).__combatDmSelectedTokenId;
      delete (window as any).__combatDmSelectedMovement;
    }
    publishAppEvent("combatMovementChanged", { changedBy: "dmSelection" });
    return () => {
      delete (window as any).__combatDmSelectedTokenId;
      delete (window as any).__combatDmSelectedMovement;
    };
  }, [isDM, dmSelectedTokenId, dmSelectedTurnActions]);

  // Auto-select current participant's token on map (DM only)
  useEffect(() => {
    if (!isDM || !currentTokenId) return;
    // Give a short delay to ensure map is ready
    const timer = setTimeout(() => {
      if ((window as any).__selectToken) {
        // Pass true to skip focusing - only select, don't pan the view
        (window as any).__selectToken(currentTokenId, true);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [isDM, currentTokenId]);

  // DM: listen for map token selection to show non-current participant resources
  useEffect(() => {
    if (!isDM) return;
    const handler = ({ tokenId }: { tokenId: number | null }) => {
      setDmSelectedTokenId(tokenId ?? null);
    };
    return subscribeAppEvent("mapTokenSelected", handler);
  }, [isDM]);

  // Auto-expand monster actions when current participant is a monster
  useEffect(() => {
    if (currentParticipant?.type === "monster") {
      setMonsterActionsExpanded(true);
      setSpecialAbilitiesExpanded(true);
    } else {
      setMonsterActionsExpanded(false);
      setSpecialAbilitiesExpanded(false);
    }
  }, [currentParticipant]);

  // Listen for action usage events from TacticalMap
  useEffect(() => {
    const handleActionUsed = ({
      type,
      amount,
    }: CombatActionUsedEventPayload) => {
      if (!type) return;
      setTurnActions(prev => {
        let next: TurnActions;
        switch (type) {
          case 'action':
            next = { ...prev, attacksUsed: prev.attacksMax };
            break;
          case 'attack':
            next = { ...prev, attacksUsed: prev.attacksUsed + 1 };
            break;
          case 'bonus_action':
            next = { ...prev, bonusActionUsed: true };
            break;
          case 'reaction':
            next = { ...prev, reactionUsed: true };
            break;
          case 'movement': {
            const moveAmount = amount || 0;
            const newRemaining = Math.min(prev.movementMax, Math.max(0, prev.movementRemaining - moveAmount));
            next = { ...prev, movementRemaining: newRemaining };
            break;
          }
          case 'dash': {
            const dashBonus = amount || prev.movementMax;
            next = { ...prev, movementRemaining: prev.movementRemaining + dashBonus };
            break;
          }
          default:
            return prev;
        }
        saveTurnActions(next);
        return next;
      });
    };
    return subscribeAppEvent("combatActionUsed", handleActionUsed);
  }, [saveTurnActions]);

  // GWM: 暴击/击杀后恢复一次攻击 + 消耗 bonus action
  useEffect(() => {
    return subscribeAppEvent("combatBonusAttackGranted", ({ message }: CombatBonusAttackGrantedEventPayload) => {
      setTurnActions(prev => {
        if (prev.bonusActionUsed) return prev;
        const next = {
          ...prev,
          attacksUsed: Math.max(0, prev.attacksUsed - 1),
          bonusActionUsed: true,
        };
        saveTurnActions(next);
        return next;
      });
      publishAppEvent("showToast", { message, type: 'success' });
    });
  }, [saveTurnActions]);

  // Listen for WebSocket reaction-used broadcasts (sync across clients)
  useEffect(() => {
    return subscribeAppEvent("combatReactionUsed", ({ reactor_token_id }: CombatReactionUsedEventPayload) => {
      if (!reactor_token_id) return;
      // Update the participant_turn_actions for this reactor
      if (myToken && reactor_token_id === myToken.id) {
        setMyTurnActions(prev => ({ ...prev, reactionUsed: true }));
      }
    });
  }, [myToken]);

  useEffect(() => { loadCombat(); }, [loadCombat]);
  useEffect(() => { if (setupOpen || combatObj?.data?.status === "in_progress") loadTokens(); }, [setupOpen, loadTokens, combatObj?.data?.status]);

  // Collapse help when combat starts, expand when combat ends
  useEffect(() => {
    if (combatObj) setHelpExpanded(false);
    else setHelpExpanded(true);
  }, [!!combatObj]);

  const currentToken = useMemo(() => {
    if (!currentTokenId || !tokens.length) return null;
    return tokens.find(t => t.id === currentTokenId) || null;
  }, [currentTokenId, tokens]);

  const canViewHints = useMemo(() => {
    if (!currentToken) return false;
    if (isDM) return true;
    if (currentToken.character_id && currentToken.user_id === userId) return true;
    return false;
  }, [isDM, currentToken, userId]);

  useEffect(() => {
    if (!canViewHints || !currentToken) { setActorDetails(null); return; }
    const fetchDetails = async () => {
      try {
        if (currentToken.monster_instance_id) {
          const resp = await authedFetch(`/api/monster-instances/${currentToken.monster_instance_id}`);
          if (resp.ok) {
            const data = await resp.json();
            const md = data.monster_data || {};
            const monsterConditions = (data.status_effects?.active_conditions || []).map((c: any) => c.condition || c);
            setActorDetails({
              type: "monster", name: data.name, hp: data.current_hp, maxHp: data.hit_points,
              ac: data.armor_class, speed: md.speed, actions: md.actions,
              specialAbilities: md.specialAbilities, legendaryActions: md.legendaryActions,
              reactions: md.reactions, spellcasting: md.spellcasting,
              conditions: monsterConditions,
            });
          }
        } else if (currentToken.character_id) {
          // Use /sheet endpoint to get character actions with action_type
          const resp = await authedFetch(`/api/characters/${currentToken.character_id}/sheet`);
          if (resp.ok) {
            const sheetData = await resp.json();
            const char = sheetData.character || {};
            const actions = sheetData.actions || [];
            const charConditions = (char.status_effects?.active_conditions || []).map((c: any) => c.condition || c);
            setActorDetails({
              type: "character",
              name: char.name,
              hp: char.hit_points_current,
              maxHp: char.hit_points_max,
              ac: char.armor_class,
              speed: char.speed ? `${char.speed}尺` : "30尺",
              classInfo: char.class ? `${char.class} Lv.${char.level || 1}` : undefined,
              classId: char.class_id,
              subclassId: char.subclass_id,
              level: char.level,
              spells: char.spells?.slice(0, 10),
              features: sheetData.features?.slice(0, 10),
              characterActions: actions,
              availableReactions: getAvailableReactions({
                class_id: char.class_id || '', subclass_id: char.subclass_id,
                level: char.level || 1, feats: char.feats,
                prepared_spells: char.prepared_spells,
                selected_spells: char.selected_spells,
                selected_cantrips: char.selected_cantrips,
              }),
              conditions: charConditions,
            });
          }
        }
      } catch (e) { logger.error("[CombatPanel] Failed to fetch actor details:", e); }
    };
    fetchDetails();
  }, [canViewHints, currentToken]);

  // DM: load details for selected non-current participant
  useEffect(() => {
    if (!isDM || !dmSelectedParticipant || !dmSelectedTokenId) {
      setDmSelectedActorDetails(null);
      return;
    }
    const selectedToken = tokens.find(t => t.id === dmSelectedTokenId);
    if (!selectedToken) { setDmSelectedActorDetails(null); return; }
    const fetchSelected = async () => {
      try {
        if (selectedToken.monster_instance_id) {
          const resp = await authedFetch(`/api/monster-instances/${selectedToken.monster_instance_id}`);
          if (resp.ok) {
            const data = await resp.json();
            const md = data.monster_data || {};
            const monsterConditions = (data.status_effects?.active_conditions || []).map((c: any) => c.condition || c);
            setDmSelectedActorDetails({
              type: "monster", name: data.name, hp: data.current_hp, maxHp: data.hit_points,
              ac: data.armor_class, speed: md.speed, actions: md.actions,
              specialAbilities: md.specialAbilities, legendaryActions: md.legendaryActions,
              reactions: md.reactions, spellcasting: md.spellcasting,
              conditions: monsterConditions,
            });
          }
        } else if (selectedToken.character_id) {
          const resp = await authedFetch(`/api/characters/${selectedToken.character_id}/sheet`);
          if (resp.ok) {
            const sheetData = await resp.json();
            const char = sheetData.character || {};
            const actions = sheetData.actions || [];
            const charConditions = (char.status_effects?.active_conditions || []).map((c: any) => c.condition || c);
            setDmSelectedActorDetails({
              type: "character", name: char.name,
              hp: char.hit_points_current, maxHp: char.hit_points_max,
              ac: char.armor_class, speed: char.speed ? `${char.speed}尺` : "30尺",
              classInfo: char.class ? `${char.class} Lv.${char.level || 1}` : undefined,
              classId: char.class_id, subclassId: char.subclass_id, level: char.level,
              spells: char.spells?.slice(0, 10), features: sheetData.features?.slice(0, 10),
              characterActions: actions,
              availableReactions: getAvailableReactions({
                class_id: char.class_id || '', subclass_id: char.subclass_id,
                level: char.level || 1, feats: char.feats,
                prepared_spells: char.prepared_spells,
                selected_spells: char.selected_spells,
                selected_cantrips: char.selected_cantrips,
              }),
              conditions: charConditions,
            });
          }
        }
      } catch (e) { logger.error("[CombatPanel] Failed to fetch DM selected actor details:", e); }
    };
    fetchSelected();
  }, [isDM, dmSelectedParticipant, dmSelectedTokenId, tokens]);

  const tokenDisplayName = (t: MapToken) => t.instance_name || t.character_name || t.monster_name || `#${t.id}`;

  const startCombat = useCallback(async () => {
    if (!isDM || !currentMapUrl) { if (!currentMapUrl) alert("请先选择地图"); return; }
    const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => Number(k));
    if (selectedIds.length === 0) { alert("请选择参战单位"); return; }
    setLoading(true);
    try {
      const participants: Participant[] = [];
      for (const tid of selectedIds) {
        const tk = tokens.find((t) => t.id === tid);
        if (!tk) continue;
        let dexScore: number | null = null;
        let hasAlertFeat = false;
        let alertInitiativeBonus = 0;
        if (tk.character_id) {
          const r = await authedFetch(`/api/characters/${tk.character_id}`);
          if (r.ok) {
            const c = await r.json();
            dexScore = c?.ability_scores?.dexterity ?? null;
            const feats = c?.feats || [];
            hasAlertFeat = feats.some((f: any) => (typeof f === 'string' ? f : f?.value) === 'alert');
            if (hasAlertFeat) alertInitiativeBonus = 5;
            const passiveFeatures = getPassiveFeatures({
              classId: c?.class_id || '',
              subclassId: c?.subclass_id || undefined,
              level: c?.level || 1,
              raceId: c?.race_id || undefined,
              subraceId: c?.subrace_id || undefined,
            });
            const hasInitiativeAdvantage = !!passiveFeatures?.advantageOn?.some(
              adv => adv.target === 'on_initiative'
            );
            const roll1 = Math.floor(Math.random() * 20) + 1;
            const roll2 = Math.floor(Math.random() * 20) + 1;
            const roll = hasInitiativeAdvantage ? Math.max(roll1, roll2) : roll1;
            participants.push({
              token_id: tid, name: tokenDisplayName(tk),
              type: tk.monster_instance_id ? "monster" : tk.character_id ? "character" : "item",
              faction: factionMap[tid] || 1,
              control_mode: (tk.monster_instance_id && !tk.control_type) ? monsterControl : "manual",
              surprised: hasAlertFeat ? false : (surpriseEnabled && surpriseFaction ? (factionMap[tid] === surpriseFaction) : false),
              initiative: roll + abilityMod(dexScore) + alertInitiativeBonus,
              dex_mod: abilityMod(dexScore),
            });
            continue;
          }
        } else if (tk.monster_instance_id) {
          const r = await authedFetch(`/api/monster-instances/${tk.monster_instance_id}`);
          if (r.ok) { const m = await r.json(); dexScore = (m?.ability_scores?.dex ?? m?.ability_scores?.dexterity) ?? null; }
        }
        const dexMod = abilityMod(dexScore);
        const roll = Math.floor(Math.random() * 20) + 1;
        participants.push({
          token_id: tid, name: tokenDisplayName(tk),
          type: tk.monster_instance_id ? "monster" : tk.character_id ? "character" : "item",
          faction: factionMap[tid] || 1,
          control_mode: (tk.monster_instance_id && !tk.control_type) ? monsterControl : "manual",
          surprised: hasAlertFeat ? false : (surpriseEnabled && surpriseFaction ? (factionMap[tid] === surpriseFaction) : false),
          initiative: roll + dexMod + alertInitiativeBonus, dex_mod: dexMod,
        });
      }
      const order = participants.slice()
        .sort((a, b) => (b.initiative - a.initiative) || (b.dex_mod - a.dex_mod) || a.name.localeCompare(b.name))
        .map((p) => p.token_id);
      const state: CombatState = {
        status: "in_progress", map_url: currentMapUrl, participants, order,
        current_index: 0, current_turn_index: 0, round: 1,
        surprise: { enabled: surpriseEnabled, faction: surpriseEnabled ? surpriseFaction : null, resolved: false },
        monster_control: monsterControl, log: [], started_at: Date.now(),
      };
      const existing = await fetchCampaignCombatStateCached(campaignId, { force: true }) as CampaignStorageObject<CombatState> | null;
      if (existing) {
        const putResp = await authedFetch(`/api/campaigns/${campaignId}/storage/combat/current`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ object_name: `战斗 @ ${new Date().toLocaleTimeString()}`, data: state, visibility: "all_players", is_active: true, version: existing.version, updated_by: userId || "system" }),
        });
        if (putResp.ok) setCombatObj((await putResp.json()) as CampaignStorageObject<CombatState>);
        else if (putResp.status === 409) { await loadCombat(true); alert("有其他人更新了战斗状态，请重试"); }
      } else {
        const postResp = await authedFetch(`/api/campaigns/${campaignId}/storage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ object_type: "combat", object_id: "current", object_name: `战斗 @ ${new Date().toLocaleTimeString()}`, data: state, visibility: "all_players", created_by: userId || "system" }),
        });
        if (postResp.ok) setCombatObj((await postResp.json()) as CampaignStorageObject<CombatState>);
        else if (postResp.status === 409) await loadCombat(true);
      }
      setSetupOpen(false);
      setAttackLog([]);  // Clear attack log for new combat
      setDefeatedParticipants([]);  // Reset defeated tracking
      setDamageStats({});  // Reset damage stats
    } catch (e) { logger.error("[CombatPanel] startCombat error:", e); alert("开始战斗失败"); }
    finally { setLoading(false); }
  }, [isDM, currentMapUrl, selected, tokens, factionMap, surpriseEnabled, surpriseFaction, monsterControl, campaignId, userId, loadCombat]);

  // Helper to check if a token is alive (HP > 0)
  const isTokenAlive = useCallback((tokenId: number): boolean => {
    const token = tokens.find(t => t.id === tokenId);
    // If no HP info available, assume alive
    if (token?.current_hp === undefined || token?.current_hp === null) return true;
    return token.current_hp > 0;
  }, [tokens]);

  // Check if all faction members are dead
  const checkFactionWiped = useCallback((faction: Faction): boolean => {
    if (!combatObj) return false;
    const factionParticipants = combatObj.data.participants.filter(p => p.faction === faction);
    return factionParticipants.length > 0 && factionParticipants.every(p => !isTokenAlive(p.token_id));
  }, [combatObj, isTokenAlive]);

  const endTurn = useCallback(async () => {
    if (!combatObj) return;
    const cs = combatObj.data;
    if (!cs?.order?.length) return;
    const currentIdx = getCombatTurnIndex(cs, cs.order.length);
    const actorId = cs.order[currentIdx];

    // Find next alive participant
    let nextIdx = (currentIdx + 1) % cs.order.length;
    let nextRound = nextIdx === 0 ? cs.round + 1 : cs.round;
    let loopCount = 0;
    const maxLoops = cs.order.length;

    // Skip dead participants
    while (loopCount < maxLoops) {
      const nextTokenId = cs.order[nextIdx];
      if (isTokenAlive(nextTokenId)) {
        break; // Found an alive participant
      }
      // Move to next
      nextIdx = (nextIdx + 1) % cs.order.length;
      if (nextIdx === 0) {
        nextRound += 1;
      }
      loopCount++;
    }

    // If we looped through everyone and none are alive, end combat
    if (loopCount >= maxLoops) {
      setShowSummaryModal(true);
      return;
    }

    // Check if either faction is completely wiped
    if (checkFactionWiped(1) || checkFactionWiped(2)) {
      setShowSummaryModal(true);
      return;
    }

    // If a new round is starting, decrement effect durations
    const isNewRound = nextRound > cs.round;
    if (isNewRound) {
      // Advance world time by 1 round (6 seconds)
      publishAppEvent("combatNewRound", { round: nextRound });
    }
    if (isNewRound && currentMapUrl) {
      try {
        const resp = await authedFetch(
          `/api/tokens/campaign/${campaignId}/decrement-effect-durations?map_url=${encodeURIComponent(currentMapUrl)}`,
          { method: 'POST' }
        );
        if (resp.ok) {
          const result = await resp.json();
          if (result.updates?.length > 0) {
            // Show toast for expired effects
            for (const update of result.updates) {
              if (update.expired_effects?.length > 0) {
                const token = tokens.find(t => t.id === update.token_id);
                const tokenName = token?.instance_name || token?.character_name || token?.monster_name || '未知';
                for (const effectName of update.expired_effects) {
                  publishAppEvent("showToast", {
                    message: `${tokenName} 的 ${effectName} 效果已结束`,
                    type: 'info',
                  });
                }
              }
            }
            logger.info(`[CombatPanel] Round ${nextRound}: Decremented ${result.updated_count} token effect durations`);
          }
        }
      } catch (e) {
        logger.error('[CombatPanel] Failed to decrement effect durations:', e);
      }
    }

    if (actorId) {
      publishAppEvent("combatTurnEnding", {
        tokenId: actorId,
        round: cs.round,
      });
    }

    // Auto-roll ongoing saves for current token (end_of_turn timing)
    try {
      const saveResp = await authedFetch('/api/combat/batch-ongoing-saves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: Number(campaignId), token_id: actorId, timing: 'end_of_turn' }),
      });
      if (saveResp.ok) {
        const saveResult = await saveResp.json();
        if (saveResult.results?.length > 0) {
          for (const r of saveResult.results) {
            const emoji = r.success ? '✅' : '❌';
            publishAppEvent("showToast", {
              message: `${emoji} ${r.effect_name}: ${r.narrative}`,
              type: r.success ? 'success' : 'warning',
            });
          }
          logger.info(`[CombatPanel] End-of-turn saves for token ${actorId}: ${saveResult.results.length} saves rolled`);
        }
      }
    } catch (e) {
      logger.error('[CombatPanel] batch-ongoing-saves error:', e);
    }

    const newLog = [...(cs.log || []), { round: cs.round, token_id: actorId, action: "end_turn", ts: Date.now() }];
    // Clear turn_actions for current turn; reset participant_turn_actions for the next actor (their reaction resets at the start of their turn)
    const nextTokenId = cs.order[nextIdx];
    const newParticipantActions = isNewRound ? undefined : (() => {
      const pa = { ...(cs.participant_turn_actions || {}) };
      // Reset the next participant's reactionUsed (D&D 5E: reaction resets at start of your turn)
      if (pa[nextTokenId]) {
        pa[nextTokenId] = { ...pa[nextTokenId], reactionUsed: false };
      }
      return pa;
    })();
    const newState = withCombatTurnIndex(
      { ...cs, round: nextRound, log: newLog, turn_actions: undefined, participant_turn_actions: newParticipantActions },
      nextIdx,
    ) as CombatState;
    try {
      const resp = await authedFetch(`/api/campaigns/${campaignId}/storage/combat/current`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: newState, version: combatObj.version, updated_by: userId || "system" }),
      });
      if (resp.ok) {
        setCombatObj((await resp.json()) as CampaignStorageObject<CombatState>);
        // Notify map layer to check zone spells for the new active token
        const nextTokenIdForZone = newState.order[getCombatTurnIndex(newState, newState.order.length)];
        if (nextTokenIdForZone) {
          publishAppEvent("combatTurnStarted", {
            tokenId: nextTokenIdForZone,
            round: nextRound,
          });
        }
      }
      else if (resp.status === 409) { await loadCombat(true); alert("状态冲突，已刷新"); }
    } catch (e) { logger.error("[CombatPanel] endTurn error:", e); }
  }, [combatObj, campaignId, userId, loadCombat, isTokenAlive, checkFactionWiped, currentMapUrl, authedFetch, tokens]);

  useEffect(() => {
    const handler = () => endTurn();
    return subscribeAppEvent("combatEndTurn", handler);
  }, [endTurn]);

  // Auto-skip dead participants when it becomes their turn (DM only)
  useEffect(() => {
    if (!isDM || !combatObj || !currentTokenId) return;
    // If current participant is dead, show message and auto-skip
    if (!isTokenAlive(currentTokenId)) {
      const participant = combatObj.data.participants.find(p => p.token_id === currentTokenId);
      const name = participant?.name || '未知单位';
      setSkipMessage(`💀 ${name} 已阵亡，跳过回合...`);

      const timer = setTimeout(() => {
        setSkipMessage(null);
        endTurn();
      }, 1200); // Show message for 1.2s then skip
      return () => {
        clearTimeout(timer);
        setSkipMessage(null);
      };
    }
  }, [isDM, combatObj, currentTokenId, isTokenAlive, endTurn]);

  const endCombat = useCallback(() => {
    if (!isDM) return;
    // Show summary modal instead of immediately ending
    setShowSummaryModal(true);
  }, [isDM]);

  // Actually end combat after summary modal confirmation
  const finalizeEndCombat = useCallback(async () => {
    try {
      const resp = await authedFetch(`/api/campaigns/${campaignId}/storage/combat/current`, { method: "DELETE" });
      if (resp.ok) {
        setCombatObj(null);
        setShowSummaryModal(false);
        setAttackLog([]);
        setDefeatedParticipants([]);
        setDamageStats({});
      }
    } catch (e) { logger.error("[CombatPanel] finalizeEndCombat error:", e); }
  }, [campaignId]);

  // Distribute XP to surviving characters (uses same format as ChatPanel reward_grant)
  const handleDistributeXP = useCallback(async (tokenIds: number[], xpPerCharacter: number) => {
    if (xpPerCharacter <= 0) return;

    // Get character IDs from token IDs
    const characterIds: number[] = [];
    for (const tokenId of tokenIds) {
      const token = tokens.find(t => t.id === tokenId);
      if (token?.character_id) {
        characterIds.push(token.character_id);
      }
    }

    if (characterIds.length === 0 || !sendMessage) return;

    try {
      // Use the reward_grant WebSocket message format (same as ChatPanel)
      sendMessage({
        type: 'reward_grant',
        user_id: userId,
        role: 'dm',
        campaign_id: campaignId,
        data: {
          reward_type: 'xp',
          recipients: characterIds,
          amount: xpPerCharacter,
          source: 'Combat',
          description: '战斗胜利奖励',
          is_private: false
        },
        timestamp: Date.now()
      });
    } catch (e) { logger.error("[CombatPanel] Failed to distribute XP:", e); }
  }, [campaignId, sendMessage, tokens, userId]);

  // Remove current participant from combat (DM only)
  const removeFromCombat = useCallback(async () => {
    if (!isDM || !combatObj || !currentTokenId) return;
    const cs = combatObj.data;
    const newParticipants = cs.participants.filter(p => p.token_id !== currentTokenId);
    const newOrder = cs.order.filter(id => id !== currentTokenId);
    // If no participants left, end combat
    if (newOrder.length === 0) {
      await endCombat();
      return;
    }
    // Adjust current_index if needed
    let newIndex = getCombatTurnIndex(cs, newOrder.length);
    if (newIndex >= newOrder.length) {
      newIndex = 0;
    }
    const newState = withCombatTurnIndex(
      { ...cs, participants: newParticipants, order: newOrder },
      newIndex,
    ) as CombatState;
    try {
      const resp = await authedFetch(`/api/campaigns/${campaignId}/storage/combat/current`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: newState, version: combatObj.version, updated_by: userId || "system" }),
      });
      if (resp.ok) setCombatObj((await resp.json()) as CampaignStorageObject<CombatState>);
      else if (resp.status === 409) { await loadCombat(true); alert("状态冲突，已刷新"); }
    } catch (e) { logger.error("[CombatPanel] removeFromCombat error:", e); }
  }, [isDM, combatObj, currentTokenId, campaignId, userId, loadCombat, endCombat]);

  const basicActions = [
    { key: 'attack', name: '攻击', icon: '⚔️',
      description: '进行一次近战或远程武器攻击。高等级战士等职业可获得额外攻击次数。',
      rules: '投d20+攻击加值，命中后投武器伤害骰。',
      cost: '动作' },
    { key: 'cast', name: '施法', icon: '✨',
      description: '施放一个施法时间为"1动作"的法术。注意集中类法术需要维持专注。',
      rules: '消耗法术位（戏法除外），按法术描述执行效果。',
      cost: '动作' },
    { key: 'dash', name: '疾走', icon: '💨',
      description: '本回合获得等于你速度的额外移动力。可叠加困难地形等效果。',
      rules: '移动距离翻倍，不消耗反应或额外攻击。',
      cost: '动作' },
    { key: 'disengage', name: '撤离', icon: '🏃',
      description: '本回合移动不会引发借机攻击。适合安全撤退或重新站位。',
      rules: '整个回合内移动不触发借机攻击。',
      cost: '动作' },
    { key: 'dodge', name: '闪避', icon: '🛡️',
      description: '专注于躲避攻击。针对你的攻击检定有劣势，敏捷豁免有优势。',
      rules: '持续到下回合开始，失去行动能力或速度为0时失效。',
      cost: '动作' },
    { key: 'help', name: '援助', icon: '🤝',
      description: '帮助盟友进行能力检定或攻击。被帮助者在下次相关检定时获得优势。',
      rules: '距离5尺内，协助攻击或技能检定获得优势。',
      cost: '动作' },
    { key: 'hide', name: '躲藏', icon: '👤',
      description: '尝试隐藏自己。进行敏捷（隐匿）检定对抗敌人的被动感知。',
      rules: '需要遮蔽物，成功后获得隐身状态直到被发现。',
      cost: '动作' },
    { key: 'ready', name: '预备', icon: '⏳',
      description: '预备一个动作在特定触发条件下执行。使用反应来执行预备的动作。',
      rules: '声明触发条件和动作，触发时消耗反应执行。预备法术需保持专注。',
      cost: '动作+反应' },
    { key: 'search', name: '搜索', icon: '🔍',
      description: '专注于搜寻事物。进行感知（察觉）或智力（调查）检定。',
      rules: '根据情境选择察觉（发现隐藏）或调查（寻找线索）。',
      cost: '动作' },
    { key: 'use', name: '物品', icon: '📦',
      description: '使用一件物品，如喝药水、启动魔法物品或使用工具。',
      rules: '复杂物品需要此动作，简单物品可作为"自由交互"使用。',
      cost: '动作' },
    { key: 'improvise', name: '即兴', icon: '🎭',
      description: 'DM可以允许的任何创意行动，如推开敌人、打翻物体、威吓等。',
      rules: '由DM裁定具体效果和所需检定。',
      cost: '动作' },
  ];

  // Parse monster attack description to extract formatted parameters
  const parseAttackDescription = (desc: string) => {
    if (!desc) return null;

    // Check if it's an attack action
    const isAttack = desc.includes('武器攻击') || desc.includes('Weapon Attack') ||
                     desc.includes('攻击:') || desc.includes('to hit');
    if (!isAttack) return null;

    const result: {
      type?: string;      // 近战/远程
      attackBonus?: string;
      reach?: string;
      range?: string;
      target?: string;
      damage?: string;
      damageType?: string;
      extraDamage?: string;
      effect?: string;
    } = {};

    // Extract attack type
    if (desc.includes('近战') || desc.includes('Melee')) {
      result.type = '近战';
    } else if (desc.includes('远程') || desc.includes('Ranged')) {
      result.type = '远程';
    }

    // Extract attack bonus: 命中+X 或 +X to hit
    const bonusMatch = desc.match(/命中\s*[+\-]?\s*(\d+)|[+\-](\d+)\s*to hit|攻击:\s*[+\-]?(\d+)/i);
    if (bonusMatch) {
      result.attackBonus = '+' + (bonusMatch[1] || bonusMatch[2] || bonusMatch[3]);
    }

    // Extract reach: 触及 X 尺
    const reachMatch = desc.match(/触及\s*(\d+)\s*尺|reach\s*(\d+)\s*ft/i);
    if (reachMatch) {
      result.reach = (reachMatch[1] || reachMatch[2]) + '尺';
    }

    // Extract range: 射程 X/Y 尺
    const rangeMatch = desc.match(/射程\s*(\d+(?:\/\d+)?)\s*尺|range\s*(\d+(?:\/\d+)?)\s*ft/i);
    if (rangeMatch) {
      result.range = (rangeMatch[1] || rangeMatch[2]) + '尺';
    }

    // Extract target
    const targetMatch = desc.match(/单一目标|one target|一个目标/i);
    if (targetMatch) {
      result.target = '单一目标';
    }

    // Extract damage: 伤害:X(YdZ+W) 或 Hit: X (YdZ+W)
    const damageMatch = desc.match(/伤害:\s*(\d+)\s*\(([^)]+)\)|Hit:\s*(\d+)\s*\(([^)]+)\)/i);
    if (damageMatch) {
      result.damage = damageMatch[2] || damageMatch[4];
    } else {
      // Alternative: just dice notation
      const diceMatch = desc.match(/(\d+d\d+\s*[+\-]\s*\d+|\d+d\d+)/);
      if (diceMatch) {
        result.damage = diceMatch[1];
      }
    }

    // Extract damage type
    const typeMatch = desc.match(/(钝击|穿刺|挥砍|火焰|冰冷|闪电|强酸|毒素|精神|力场|光耀|黯蚀|雷鸣|bludgeoning|piercing|slashing|fire|cold|lightning|acid|poison|psychic|force|radiant|necrotic|thunder)/i);
    if (typeMatch) {
      result.damageType = typeMatch[1];
    }

    // Check for extra damage (外加/plus)
    const extraMatch = desc.match(/外加\s*(\d+)\s*\(([^)]+)\)\s*的?\s*(\S+?)(?:伤害|damage)/i);
    if (extraMatch) {
      result.extraDamage = `+${extraMatch[2]} ${extraMatch[3]}`;
    }

    return result;
  };

  // 紧凑样式
  const cardStyle = { background: 'linear-gradient(180deg, rgba(35,30,25,0.95) 0%, rgba(20,18,15,0.98) 100%)', border: '1px solid rgba(184,134,11,0.3)' };
  const headerStyle = { background: 'linear-gradient(90deg, rgba(184,134,11,0.15) 0%, transparent 100%)' };

  // DM选中非当前角色时，动作面板和信息栏显示选中角色的数据
  const displayParticipant = (isDM && dmSelectedParticipant) ? dmSelectedParticipant : currentParticipant;
  const displayActorDetails = (isDM && dmSelectedParticipant && dmSelectedActorDetails) ? dmSelectedActorDetails : actorDetails;

  // Check if current actor is incapacitated (can't take actions or reactions)
  const INCAPACITATING = ['incapacitated', 'stunned', 'paralyzed', 'unconscious', 'petrified'];
  const isActorIncapacitated = displayActorDetails?.conditions?.some(c => INCAPACITATING.includes(c)) ?? false;

  return (
    <div className="relative rounded-lg overflow-hidden flex-1 min-h-0 flex flex-col" style={{ background: '#0d0b08', boxShadow: 'inset 0 0 30px rgba(0,0,0,0.8)' }}>
      {/* 金边 */}
      <div className="h-0.5 w-full flex-shrink-0" style={{ background: 'linear-gradient(90deg, transparent, #b8860b 30%, #ffd700 50%, #b8860b 70%, transparent)' }} />

      <div className="p-3 space-y-2 overflow-y-auto flex-1 min-h-0">
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚔️</span>
            <span className="font-bold text-amber-400" style={{ textShadow: '0 0 8px rgba(255,215,0,0.4)' }}>战斗</span>
            {combatObj && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
            <button
              onClick={() => setHelpExpanded(!helpExpanded)}
              className="w-4 h-4 flex items-center justify-center rounded-full text-[10px] hover:bg-white/10 transition-colors"
              style={{ color: helpExpanded ? '#fbbf24' : '#6b7280', border: '1px solid currentColor' }}
              title="操作帮助"
            >
              ?
            </button>
          </div>
          {isDM && !combatObj && (
            <button onClick={() => setSetupOpen((v) => !v)}
              className="px-3 py-1 rounded text-xs font-medium transition-all"
              style={{ background: setupOpen ? '#2d1f14' : 'linear-gradient(180deg, #b8860b, #8b6914)', color: setupOpen ? '#888' : '#fff', border: '1px solid rgba(184,134,11,0.5)' }}>
              {setupOpen ? "收起" : "开始战斗"}
            </button>
          )}
          {combatObj && isDM && (
            <button onClick={endCombat} className="px-3 py-1 rounded text-xs" style={{ background: '#4a0000', color: '#ff6b6b', border: '1px solid #8b0000' }}>
              结束战斗
            </button>
          )}
        </div>

        {/* 操作帮助提示 */}
        {helpExpanded && (
          <div className="rounded p-2 text-[10px] space-y-1.5" style={{ ...cardStyle, borderColor: 'rgba(59,130,246,0.3)' }}>
            <div className="flex items-center gap-1.5 text-blue-400 font-medium">
              <span>💡</span>
              <span>操作说明</span>
            </div>
            <div className="text-gray-400 space-y-1 pl-4">
              {isDM ? (
                <>
                  {/* DM 战斗设置教程 */}
                  <div className="text-amber-400 font-medium">开始战斗：</div>
                  <div className="pl-2 space-y-0.5">
                    <div>1. 点击<span className="text-amber-400">「开始战斗」</span>按钮</div>
                    <div>2. 勾选参战单位，设置<span className="text-blue-400">友方</span>/<span className="text-red-400">敌方</span>阵营</div>
                    <div>3. 如有偷袭，勾选并选择被偷袭方</div>
                    <div>4. 点击<span className="text-amber-400">「⚔️ 开始」</span>，系统自动计算先攻顺序</div>
                  </div>
                  <div className="text-amber-400 font-medium mt-1">战斗进行：</div>
                  <div className="pl-2 space-y-0.5">
                    <div>• 在<span className="text-cyan-400">地图上</span>操作：左键选中单位 → 右键打开行动菜单</div>
                    <div>• 轮到的角色执行完毕后，点击<span className="text-green-400">「结束回合」</span></div>
                    <div>• 玩家也可以自己点击结束回合</div>
                  </div>
                  <div className="text-amber-400 font-medium mt-1">结束战斗：</div>
                  <div className="pl-2 space-y-0.5">
                    <div>• 点击<span className="text-red-400">「退出战斗」</span>可将当前单位移出战斗</div>
                    <div>• 战斗结束后点击<span className="text-red-400">「结束战斗」</span>进行结算</div>
                  </div>
                </>
              ) : (
                <>
                  <div>• 在<span className="text-cyan-400">地图上</span>右键点击目标进行操作</div>
                  <div>• 只能操作自己控制的角色</div>
                  <div>• 执行完毕后点击<span className="text-green-400">「结束回合」</span></div>
                </>
              )}
            </div>
          </div>
        )}

        {/* 设置面板 */}
        {isDM && !combatObj && setupOpen && (
          <div className="rounded p-2 space-y-2" style={cardStyle}>
            {!currentMapUrl ? (
              <div className="text-xs text-gray-500">需要先选择地图</div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" className="rounded w-3 h-3" checked={surpriseEnabled} onChange={(e) => setSurpriseEnabled(e.target.checked)} />
                    <span className="text-gray-400">偷袭</span>
                  </label>
                  {surpriseEnabled && (
                    <select className="px-1.5 py-0.5 rounded text-[11px] bg-black/30 border border-gray-700 text-amber-400"
                      value={surpriseFaction} onChange={(e) => setSurpriseFaction(Number(e.target.value) as Faction)}
                      title="被偷袭的阵营将在第一轮无法行动">
                      <option value={1}>友方被偷袭</option>
                      <option value={2}>敌方被偷袭</option>
                    </select>
                  )}
                  <span className="text-gray-600">|</span>
                  <span className="text-gray-500">怪物控制:</span>
                  <select className="px-1.5 py-0.5 rounded text-[11px] bg-black/30 border border-gray-700 text-amber-400"
                    value={monsterControl} onChange={(e) => setMonsterControl(e.target.value as ControlMode)}>
                    <option value="manual">手动</option>
                    <option value="ai">AI</option>
                  </select>
                </div>
                {/* 阵营说明 */}
                <div className="flex items-center gap-3 text-[10px] px-1">
                  <span className="text-gray-500">阵营:</span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    <span className="text-blue-400">友方</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500"></span>
                    <span className="text-red-400">敌方</span>
                  </span>
                </div>
                <div className="rounded bg-black/20 border border-gray-800">
                  {tokens.filter(t => t.character_id || t.monster_instance_id).length === 0 ? (
                    <div className="p-2 text-[11px] text-gray-500 text-center">无角色/怪物</div>
                  ) : (
                    <>
                      {/* 表头：全选复选框 */}
                      <div className="flex items-center gap-2 px-2 py-1 border-b border-gray-700 bg-black/30">
                        <input
                          type="checkbox"
                          className="rounded w-3 h-3 flex-shrink-0"
                          checked={tokens.filter(t => t.character_id || t.monster_instance_id).every(t => selected[t.id])}
                          onChange={(e) => {
                            const combatTokens = tokens.filter(t => t.character_id || t.monster_instance_id);
                            const newSelected: Record<number, boolean> = { ...selected };
                            combatTokens.forEach(t => { newSelected[t.id] = e.target.checked; });
                            setSelected(newSelected);
                          }}
                        />
                        <span className="text-[10px] text-gray-500">全选</span>
                      </div>
                      {/* 列表 */}
                      <div className="max-h-36 overflow-auto divide-y divide-gray-800/50">
                        {tokens.filter(t => t.character_id || t.monster_instance_id).map((t) => {
                        const isMonster = !!t.monster_instance_id;
                        const isNpc = t.entity_type === 'npc';
                        return (
                          <div key={t.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-white/5">
                            <input type="checkbox" className="rounded w-3 h-3 flex-shrink-0" checked={!!selected[t.id]}
                              onChange={(e) => setSelected((s) => ({ ...s, [t.id]: e.target.checked }))} />
                            {/* 头像 */}
                            <div className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0 border"
                              style={{ borderColor: isNpc ? '#0e7490' : (isMonster ? '#7f1d1d' : '#1e3a5f'), background: '#1a1a1a' }}>
                              {t.avatar ? (
                                <img src={t.avatar} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[10px]"
                                  style={{ color: isNpc ? '#22d3ee' : (isMonster ? '#f87171' : '#93c5fd') }}>
                                  {isNpc ? '🧑' : (isMonster ? '👹' : '👤')}
                                </div>
                              )}
                            </div>
                            <span className="flex-1 text-[11px] truncate" style={{ color: selected[t.id] ? '#ffd700' : '#888' }}>
                              {tokenDisplayName(t)}{isNpc ? ' (NPC)' : ''}
                            </span>
                            {/* 阵营选择 */}
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setFactionMap((m) => ({ ...m, [t.id]: 1 }))}
                                className={`w-5 h-5 rounded text-[10px] transition-all ${
                                  (factionMap[t.id] || 1) === 1
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-black/30 text-gray-500 hover:bg-blue-900/30'
                                }`}
                                title="友方">
                                友
                              </button>
                              <button
                                onClick={() => setFactionMap((m) => ({ ...m, [t.id]: 2 }))}
                                className={`w-5 h-5 rounded text-[10px] transition-all ${
                                  factionMap[t.id] === 2
                                    ? 'bg-red-600 text-white'
                                    : 'bg-black/30 text-gray-500 hover:bg-red-900/30'
                                }`}
                                title="敌方">
                                敌
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex justify-end">
                  <button disabled={loading || !tokens.filter(t => t.character_id || t.monster_instance_id).length} onClick={startCombat}
                    className="px-4 py-1 rounded text-xs font-medium disabled:opacity-50"
                    style={{ background: 'linear-gradient(180deg, #b8860b, #8b6914)', color: '#fff', border: '1px solid #ffd700' }}>
                    {loading ? "..." : "⚔️ 开始"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 战斗进行中 */}
        {combatObj && (
          <div className="space-y-2">
            {/* 回合信息 + 先攻列表 */}
            <div className="rounded overflow-hidden" style={cardStyle}>
              <div className="flex items-center justify-between px-2 py-1.5" style={headerStyle}>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 text-[11px]">回合</span>
                  <span className="text-xl font-bold text-amber-400">{combatObj.data.round}</span>
                </div>
                <div className="flex items-center gap-2">
                  {displayActorDetails && (
                    <>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-400">
                        {typeof displayActorDetails.speed === "string" ? displayActorDetails.speed : `${displayActorDetails.speed?.walk || 30}尺`}
                      </span>
                      {displayActorDetails.ac && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400">AC{displayActorDetails.ac}</span>}
                      {displayActorDetails.hp !== undefined && displayActorDetails.maxHp && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          (displayActorDetails.hp / displayActorDetails.maxHp) < 0.3 ? 'bg-red-900/30 text-red-400' :
                          (displayActorDetails.hp / displayActorDetails.maxHp) < 0.6 ? 'bg-yellow-900/30 text-yellow-400' : 'bg-green-900/30 text-green-400'
                        }`}>{displayActorDetails.hp}/{displayActorDetails.maxHp}</span>
                      )}
                    </>
                  )}
                </div>
              </div>
              {/* Skip message for dead participants */}
              {skipMessage && (
                <div className="px-2 py-1.5 bg-gray-800/80 border-b border-gray-700/50 flex items-center gap-2 animate-pulse">
                  <span className="text-sm text-gray-300">{skipMessage}</span>
                </div>
              )}
              <div className="max-h-28 overflow-auto">
                {combatObj.data.order.map((tid, idx) => {
                  const p = combatObj.data.participants.find((x) => x.token_id === tid)!;
                  const isActive = idx === getCombatTurnIndex(combatObj.data, combatObj.data.order.length);
                  const isEnemy = p.faction === 2; // Use faction instead of monster type
                  const token = tokens.find(t => t.id === tid);
                  const isDead = !isTokenAlive(tid);
                  return (
                    <div key={tid} className={`flex items-center gap-2 px-2 py-1 ${isActive ? 'bg-amber-500/10' : ''} ${isDead ? 'opacity-40' : ''}`}
                      style={{ borderLeft: isActive ? '2px solid #ffd700' : '2px solid transparent' }}>
                      {/* Faction indicator */}
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: isDead ? '#374151' : isEnemy ? '#ef4444' : '#3b82f6' }}
                        title={isEnemy ? '敌方' : '友方'}
                      />
                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                        style={{ background: isDead ? '#374151' : isActive ? '#ffd700' : isEnemy ? '#7f1d1d' : '#1e3a5f', color: isActive && !isDead ? '#000' : '#fff' }}>
                        {isDead ? '💀' : idx + 1}
                      </span>
                      <span className={`flex-1 text-[11px] truncate ${isActive && !isDead ? 'font-bold text-amber-400' : ''} ${isDead ? 'line-through' : ''}`}
                        style={{ color: isDead ? '#6b7280' : isActive ? undefined : isEnemy ? '#f87171' : '#93c5fd' }}>
                        {p.name}
                      </span>
                      <span className="text-[10px] text-gray-600">{p.initiative}</span>
                      <button
                        onClick={() => {
                          if (token && token.position_x != null && token.position_y != null && (window as any).__focusToken) {
                            (window as any).__focusToken(tid, { x: token.position_x, y: token.position_y });
                          }
                        }}
                        className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 text-gray-500 hover:text-amber-400 transition-colors"
                        title="定位到该单位"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                          <path fillRule="evenodd" d="M8.75 3.5V1h-1.5v2.5h1.5Zm0 11V17h-1.5v-2.5h1.5ZM3.5 7.25H1v1.5h2.5v-1.5Zm11 0H17v1.5h-2.5v-1.5ZM8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm0 1.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" clipRule="evenodd" />
                        </svg>
                      </button>
                      {isActive && !isDead && <span className="text-amber-400 text-xs animate-pulse">◀</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 动作面板 */}
            {currentParticipant && (
              <div className="rounded overflow-hidden" style={cardStyle}>
                <div className="flex items-center justify-between px-2 py-1" style={headerStyle}>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[11px] text-gray-400">轮到</span>
                    <span className="text-xs font-bold text-amber-400">{currentParticipant.name}</span>
                  </div>
                  {isDM && (
                    <button onClick={removeFromCombat} className="px-2 py-0.5 rounded text-[10px] font-medium"
                      style={{ background: 'linear-gradient(180deg, #7f1d1d, #991b1b)', color: '#fca5a5', border: '1px solid #dc2626' }}>
                      退出战斗
                    </button>
                  )}
                  {/* 结束回合 - DM 可见，或者轮到玩家自己的角色时可见 */}
                  {(isDM || (currentToken?.character_id && currentToken?.user_id === userId)) && (
                    <button onClick={endTurn} className="px-2 py-0.5 rounded text-[10px] font-medium"
                      style={{ background: 'linear-gradient(180deg, #16a34a, #15803d)', color: '#fff' }}>
                      结束回合 →
                    </button>
                  )}
                </div>

                {/* 行动资源追踪 - DM始终可见，玩家仅自己回合可见 */}
                {!isCurrentActorSurprised && (isDM || isMyTurn) && (
                  <div className="flex items-center gap-1 px-2 py-1 bg-black/30 border-b border-gray-800/50">
                    {/* 移动 - 显示剩余/最大 */}
                    <div className="flex items-center gap-0">
                      {isDM && (
                        <button onClick={(e) => { e.stopPropagation(); setTurnActions(prev => { const next = { ...prev, movementRemaining: Math.max(0, prev.movementRemaining - 5) }; saveTurnActions(next); return next; }); }}
                          className="px-1 py-0.5 text-[9px] text-gray-500 hover:text-white hover:bg-gray-600/50 rounded-l transition-colors">−</button>
                      )}
                      <button
                        onClick={() => setResourceModalType('movement')}
                        className={`flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] cursor-pointer hover:ring-1 hover:ring-white/30 transition-all ${
                          isDM ? '' : 'rounded'
                        } ${
                          turnActions.movementRemaining <= 0
                            ? 'bg-gray-700/50 text-gray-500'
                            : 'bg-green-900/30 text-green-400'
                        }`}>
                        <span>🦶</span>
                        <span>{turnActions.movementRemaining}/{turnActions.movementMax}尺</span>
                      </button>
                      {isDM && (
                        <button onClick={(e) => { e.stopPropagation(); setTurnActions(prev => { const next = { ...prev, movementRemaining: Math.min(prev.movementMax, prev.movementRemaining + 5) }; saveTurnActions(next); return next; }); }}
                          className="px-1 py-0.5 text-[9px] text-gray-500 hover:text-white hover:bg-gray-600/50 rounded-r transition-colors">+</button>
                      )}
                    </div>
                    {isActorIncapacitated ? (
                      /* 失能状态下：攻击/附赠/反应全部显示为不可用 */
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-purple-900/30 border border-purple-500/30">
                        <span className="text-[10px] text-purple-300">💫 失能 — 无法行动或反应</span>
                      </div>
                    ) : (
                      <>
                    {/* 动作/攻击次数 */}
                    <div className="flex items-center gap-0">
                      {isDM && (
                        <button onClick={(e) => { e.stopPropagation(); setTurnActions(prev => { const next = { ...prev, attacksUsed: Math.min(prev.attacksMax, prev.attacksUsed + 1) }; saveTurnActions(next); return next; }); }}
                          className="px-1 py-0.5 text-[9px] text-gray-500 hover:text-white hover:bg-gray-600/50 rounded-l transition-colors">−</button>
                      )}
                      <button
                        onClick={() => setResourceModalType('attack')}
                        className={`flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] cursor-pointer hover:ring-1 hover:ring-white/30 transition-all ${
                          isDM ? '' : 'rounded'
                        } ${
                          turnActions.attacksUsed >= turnActions.attacksMax ? 'bg-gray-700/50 text-gray-500' : 'bg-red-900/30 text-red-400'
                        }`}>
                        <span>⚔️</span>
                        <span>攻击 {turnActions.attacksMax - turnActions.attacksUsed}/{turnActions.attacksMax}</span>
                      </button>
                      {isDM && (
                        <button onClick={(e) => { e.stopPropagation(); setTurnActions(prev => { const next = { ...prev, attacksUsed: Math.max(0, prev.attacksUsed - 1) }; saveTurnActions(next); return next; }); }}
                          className="px-1 py-0.5 text-[9px] text-gray-500 hover:text-white hover:bg-gray-600/50 rounded-r transition-colors">+</button>
                      )}
                    </div>
                    {/* 附赠动作 */}
                    <div className="flex items-center gap-0">
                      <button
                        onClick={() => isDM ? setTurnActions(prev => { const next = { ...prev, bonusActionUsed: !prev.bonusActionUsed }; saveTurnActions(next); return next; }) : setResourceModalType('bonus_action')}
                        onContextMenu={(e) => { e.preventDefault(); setResourceModalType('bonus_action'); }}
                        className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] cursor-pointer hover:ring-1 hover:ring-white/30 transition-all ${
                          turnActions.bonusActionUsed ? 'bg-gray-700/50 text-gray-500' : 'bg-yellow-900/30 text-yellow-400'
                        }`}>
                        <span>🔥</span>
                        <span>附赠 {turnActions.bonusActionUsed ? '0/1' : '1/1'}</span>
                      </button>
                    </div>
                    {/* 反应 */}
                    <div className="flex items-center gap-0">
                      <button
                        onClick={() => isDM ? setTurnActions(prev => { const next = { ...prev, reactionUsed: !prev.reactionUsed }; saveTurnActions(next); return next; }) : setResourceModalType('reaction')}
                        onContextMenu={(e) => { e.preventDefault(); setResourceModalType('reaction'); }}
                        className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] cursor-pointer hover:ring-1 hover:ring-white/30 transition-all ${
                          turnActions.reactionUsed ? 'bg-gray-700/50 text-gray-500' : 'bg-blue-900/30 text-blue-400'
                        }`}>
                        <span>⚡</span>
                        <span>反应 {turnActions.reactionUsed ? '0/1' : '1/1'}</span>
                      </button>
                    </div>
                      </>
                    )}
                  </div>
                )}

                {/* DM: 选中非当前行动角色时，显示其本回合资源 */}
                {isDM && dmSelectedParticipant && dmSelectedTurnActions && (() => {
                  const sa = dmSelectedTurnActions;
                  const tid = dmSelectedTokenId!;
                  const update = (fn: (prev: TurnActions) => TurnActions) => {
                    const next = fn(sa);
                    saveParticipantTurnActions(tid, next);
                    // Optimistic update via combatObj
                    setCombatObj(prev => {
                      if (!prev) return prev;
                      const pa = { ...(prev.data.participant_turn_actions || {}), [tid]: next };
                      return { ...prev, data: { ...prev.data, participant_turn_actions: pa } };
                    });
                  };
                  return (
                  <div className="flex items-center gap-1 px-2 py-0.5 bg-purple-900/10 border-b border-purple-800/30">
                    <span className="text-[9px] text-purple-400 mr-0.5 truncate max-w-[60px]" title={dmSelectedParticipant.name}>{dmSelectedParticipant.name}</span>
                    <div className="flex items-center gap-0">
                      <button onClick={() => update(p => ({ ...p, movementRemaining: Math.max(0, p.movementRemaining - 5) }))}
                        className="px-1 py-0.5 text-[9px] text-gray-500 hover:text-white hover:bg-gray-600/50 rounded-l transition-colors">−</button>
                      <span className={`px-1 py-0.5 text-[10px] ${sa.movementRemaining <= 0 ? 'text-gray-500' : 'text-green-400'}`}>
                        🦶{sa.movementRemaining}/{sa.movementMax}
                      </span>
                      <button onClick={() => update(p => ({ ...p, movementRemaining: Math.min(p.movementMax, p.movementRemaining + 5) }))}
                        className="px-1 py-0.5 text-[9px] text-gray-500 hover:text-white hover:bg-gray-600/50 rounded-r transition-colors">+</button>
                    </div>
                    <div className="flex items-center gap-0">
                      <button onClick={() => update(p => ({ ...p, attacksUsed: Math.min(p.attacksMax, p.attacksUsed + 1) }))}
                        className="px-1 py-0.5 text-[9px] text-gray-500 hover:text-white hover:bg-gray-600/50 rounded-l transition-colors">−</button>
                      <span className={`px-1 py-0.5 text-[10px] ${sa.attacksUsed >= sa.attacksMax ? 'text-gray-500' : 'text-red-400'}`}>
                        ⚔️{sa.attacksMax - sa.attacksUsed}/{sa.attacksMax}
                      </span>
                      <button onClick={() => update(p => ({ ...p, attacksUsed: Math.max(0, p.attacksUsed - 1) }))}
                        className="px-1 py-0.5 text-[9px] text-gray-500 hover:text-white hover:bg-gray-600/50 rounded-r transition-colors">+</button>
                    </div>
                    <button onClick={() => update(p => ({ ...p, bonusActionUsed: !p.bonusActionUsed }))}
                      className={`px-1 py-0.5 rounded text-[10px] hover:ring-1 hover:ring-white/30 transition-all ${sa.bonusActionUsed ? 'text-gray-500' : 'text-yellow-400'}`}>
                      🔥{sa.bonusActionUsed ? '0' : '1'}
                    </button>
                    <button onClick={() => update(p => ({ ...p, reactionUsed: !p.reactionUsed }))}
                      className={`px-1 py-0.5 rounded text-[10px] hover:ring-1 hover:ring-white/30 transition-all ${sa.reactionUsed ? 'text-gray-500' : 'text-blue-400'}`}>
                      ⚡{sa.reactionUsed ? '0' : '1'}
                    </button>
                  </div>
                  );
                })()}

                {isCurrentActorSurprised ? (
                  <div className="p-2 text-center text-[11px] text-red-400 bg-red-900/20">⚠️ 被偷袭！本轮无法行动</div>
                ) : !isDM && !isMyTurn ? (
                  <div className="p-2 text-center text-[11px] text-gray-500">
                    {currentParticipant?.type === "monster" ? '等待DM...' : `等待 ${currentParticipant?.name || ''} 行动...`}
                  </div>
                ) : (
                  <div className="p-1.5 space-y-1">
                    {/* Death Saving Throws panel for characters at 0 HP */}
                    {(() => {
                      const currentToken = currentTokenId ? tokens.find(t => t.id === currentTokenId) : null;
                      if (currentToken?.character_id && (currentToken.current_hp ?? 1) <= 0 && currentToken.death_saves) {
                        return (
                          <div className="mb-1.5">
                            <DeathSavePanel
                              tokenId={currentToken.id}
                              deathSaves={currentToken.death_saves}
                              campaignId={campaignId}
                              tokenName={currentToken.instance_name || undefined}
                              userId={userId}
                              isDM={isDM}
                            />
                          </div>
                        );
                      }
                      return null;
                    })()}
                    {/* 基础动作 */}
                    <div className={`rounded overflow-hidden border border-red-900/30 ${isActorIncapacitated ? 'relative' : ''}`}>
                      {isActorIncapacitated && (
                        <div className="absolute inset-0 bg-black/60 z-10 flex items-center justify-center rounded">
                          <span className="text-[10px] text-purple-300">💫 失能</span>
                        </div>
                      )}
                      <button className="w-full flex items-center justify-between px-2 py-1 text-left"
                        onClick={() => setBasicActionsExpanded(!basicActionsExpanded)}
                        style={{ background: basicActionsExpanded ? 'rgba(220,38,38,0.1)' : 'rgba(0,0,0,0.2)' }}>
                        <span className="text-[11px] font-medium text-red-400">⚔️ 基础动作</span>
                        <span className="text-gray-600 text-[10px]">{basicActionsExpanded ? '▼' : '▶'}</span>
                      </button>
                      {basicActionsExpanded && (
                        <div className="grid grid-cols-6 gap-0.5 p-1 bg-black/20">
                          {basicActions.map((a) => (
                            <button key={a.key}
                              onClick={() => setSelectedBasicAction(a)}
                              className="flex flex-col items-center py-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
                              title={a.description}>
                              <span className="text-sm">{a.icon}</span>
                              <span className="text-[9px] text-gray-400">{a.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 附赠动作 (角色) */}
                    {displayParticipant?.type === "character" && (
                      <div className={`rounded overflow-hidden border border-yellow-900/30 ${isActorIncapacitated ? 'relative' : ''}`}>
                        {isActorIncapacitated && (
                          <div className="absolute inset-0 bg-black/60 z-10 flex items-center justify-center rounded">
                            <span className="text-[10px] text-purple-300">💫 失能</span>
                          </div>
                        )}
                        <button className="w-full flex items-center justify-between px-2 py-1 text-left"
                          onClick={() => setBonusActionsExpanded(!bonusActionsExpanded)}
                          style={{ background: bonusActionsExpanded ? 'rgba(234,179,8,0.1)' : 'rgba(0,0,0,0.2)' }}>
                          <span className="text-[11px] font-medium text-yellow-400">
                            🔥 附赠动作
                            {displayActorDetails?.characterActions?.filter(a => a.action_type === 'bonus_action').length ? (
                              <span className="text-gray-500 ml-1">
                                ({displayActorDetails.characterActions.filter(a => a.action_type === 'bonus_action').length})
                              </span>
                            ) : null}
                          </span>
                          <span className="text-gray-600 text-[10px]">{bonusActionsExpanded ? '▼' : '▶'}</span>
                        </button>
                        {bonusActionsExpanded && (
                          <div className="p-1.5 space-y-1 bg-black/20">
                            {displayActorDetails?.characterActions?.filter(a => a.action_type === 'bonus_action').length ? (
                              displayActorDetails.characterActions.filter(a => a.action_type === 'bonus_action').map((action, i) => (
                                <div key={i} className="px-2 py-1.5 rounded bg-yellow-900/10 border border-yellow-900/20">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-medium text-yellow-400">{action.name}</span>
                                    {action.uses && (
                                      <span className="text-[9px] text-gray-400">
                                        {action.uses.current}/{action.uses.max}次
                                        {action.uses.recharge && ` (${action.uses.recharge === 'short_rest' ? '短休' : '长休'})`}
                                      </span>
                                    )}
                                  </div>
                                  {action.description && (
                                    <div className="text-[9px] text-gray-400 mt-0.5 leading-relaxed line-clamp-2">
                                      {action.description}
                                    </div>
                                  )}
                                </div>
                              ))
                            ) : (
                              <div className="text-[10px] text-gray-500 italic px-1">暂无附赠动作</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ⚡ 反应动作 */}
                    {displayActorDetails?.availableReactions && displayActorDetails.availableReactions.length > 0 && (
                      <div className={`rounded overflow-hidden border ${isActorIncapacitated ? 'border-gray-700/30 opacity-50 relative' : turnActions.reactionUsed ? 'border-gray-700/30 opacity-50' : 'border-blue-900/30'}`}>
                        {isActorIncapacitated && (
                          <div className="absolute inset-0 bg-black/60 z-10 flex items-center justify-center rounded">
                            <span className="text-[10px] text-purple-300">💫 失能</span>
                          </div>
                        )}
                        <button className="w-full flex items-center justify-between px-2 py-1 text-left"
                          onClick={() => setReactionsExpanded(!reactionsExpanded)}
                          style={{ background: reactionsExpanded ? 'rgba(59,130,246,0.1)' : 'rgba(0,0,0,0.2)' }}>
                          <span className="text-[11px] font-medium text-blue-400">
                            ⚡ 反应动作
                            <span className="text-gray-500 ml-1">({displayActorDetails.availableReactions.length})</span>
                            {turnActions.reactionUsed && <span className="text-gray-500 ml-1">已使用</span>}
                          </span>
                          <span className="text-gray-600 text-[10px]">{reactionsExpanded ? '▼' : '▶'}</span>
                        </button>
                        {reactionsExpanded && (
                          <div className="p-1.5 space-y-1 bg-black/20">
                            {reactionHint && (
                              <div className="text-[10px] text-blue-300 bg-blue-900/30 px-2 py-1 rounded animate-pulse">{reactionHint}</div>
                            )}
                            {displayActorDetails.availableReactions.map((r) => (
                              <button key={r.id} disabled={turnActions.reactionUsed}
                                onClick={() => {
                                  if (r.category === 'attack') {
                                    setReactionHint(`请在地图上右键点击敌方token，选择「${r.name}」`);
                                    setTimeout(() => setReactionHint(''), 4000);
                                  }
                                }}
                                className={`w-full text-left px-2 py-1.5 rounded border transition-colors ${
                                  turnActions.reactionUsed
                                    ? 'bg-gray-800/30 border-gray-700/20 cursor-not-allowed'
                                    : r.category === 'attack'
                                      ? 'bg-blue-900/10 border-blue-900/20 hover:bg-blue-900/20 cursor-pointer'
                                      : 'bg-blue-900/10 border-blue-900/20 cursor-default'
                                }`}>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm">{r.icon}</span>
                                  <span className="text-[11px] font-medium text-blue-400">{r.name}</span>
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-blue-900/30 text-blue-300">{r.category === 'attack' ? '攻击' : r.category === 'defense' ? '防御' : '法术'}</span>
                                  <span className="text-[8px] text-gray-500 ml-auto">{r.category === 'attack' ? '右键地图目标' : '聊天中触发'}</span>
                                </div>
                                <div className="text-[9px] text-gray-400 mt-0.5 leading-relaxed">{r.triggerDesc}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 怪物动作 */}
                    {displayParticipant?.type === "monster" && displayActorDetails?.actions && (
                      <div className="rounded overflow-hidden border border-orange-900/30">
                        <button className="w-full flex items-center justify-between px-2 py-1 text-left"
                          onClick={() => setMonsterActionsExpanded(!monsterActionsExpanded)}
                          style={{ background: monsterActionsExpanded ? 'rgba(249,115,22,0.1)' : 'rgba(0,0,0,0.2)' }}>
                          <span className="text-[11px] font-medium text-orange-400">
                            💀 怪物动作
                            {typeof displayActorDetails.actions !== "string" && <span className="text-gray-500 ml-1">({displayActorDetails.actions.length})</span>}
                          </span>
                          <span className="text-gray-600 text-[10px]">{monsterActionsExpanded ? '▼' : '▶'}</span>
                        </button>
                        {monsterActionsExpanded && (
                          <div className="p-1.5 space-y-1.5 bg-black/20">
                            {typeof displayActorDetails.actions === "string" ? (
                              <div className="text-[10px] text-gray-400 px-1">{displayActorDetails.actions}</div>
                            ) : (
                              displayActorDetails.actions.map((action, i) => {
                                const parsed = parseAttackDescription(action.description || '');
                                return (
                                  <div key={i} className="px-2 py-1.5 rounded bg-orange-900/10 border border-orange-900/20">
                                    <div className="text-[11px] font-medium text-orange-400 mb-1">{action.name}</div>
                                    {parsed ? (
                                      // 攻击动作 - 格式化显示
                                      <div className="space-y-1">
                                        <div className="flex flex-wrap gap-1.5">
                                          {parsed.type && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-300">
                                              {parsed.type}
                                            </span>
                                          )}
                                          {parsed.attackBonus && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300">
                                              命中 {parsed.attackBonus}
                                            </span>
                                          )}
                                          {parsed.reach && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-300">
                                              触及 {parsed.reach}
                                            </span>
                                          )}
                                          {parsed.range && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-300">
                                              射程 {parsed.range}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                          {parsed.damage && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-300">
                                              💥 {parsed.damage} {parsed.damageType || ''}
                                            </span>
                                          )}
                                          {parsed.extraDamage && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-300">
                                              {parsed.extraDamage}
                                            </span>
                                          )}
                                        </div>
                                        {action.description && (
                                          <div className="text-[9px] text-gray-400 mt-1 leading-relaxed">
                                            {action.description}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      // 非攻击动作 - 显示完整描述
                                      action.description && (
                                        <div className="text-[9px] text-gray-400 leading-relaxed">
                                          {action.description}
                                        </div>
                                      )
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 特殊能力 */}
                    {displayParticipant?.type === "monster" && displayActorDetails?.specialAbilities && displayActorDetails.specialAbilities.length > 0 && (
                      <div className="rounded overflow-hidden border border-purple-900/30">
                        <button className="w-full flex items-center justify-between px-2 py-1 text-left"
                          onClick={() => setSpecialAbilitiesExpanded(!specialAbilitiesExpanded)}
                          style={{ background: specialAbilitiesExpanded ? 'rgba(147,51,234,0.1)' : 'rgba(0,0,0,0.2)' }}>
                          <span className="text-[11px] font-medium text-purple-400">
                            ✨ 特殊能力
                            <span className="text-gray-500 ml-1">({displayActorDetails.specialAbilities.length})</span>
                          </span>
                          <span className="text-gray-600 text-[10px]">{specialAbilitiesExpanded ? '▼' : '▶'}</span>
                        </button>
                        {specialAbilitiesExpanded && (
                          <div className="p-1.5 space-y-1.5 bg-black/20">
                            {displayActorDetails.specialAbilities.map((ability, i) => (
                              <div key={i} className="px-2 py-1.5 rounded bg-purple-900/10 border border-purple-900/20">
                                <div className="text-[11px] font-medium text-purple-400 mb-1">{ability.name}</div>
                                {ability.description && (
                                  <div className="text-[9px] text-gray-400 leading-relaxed">
                                    {ability.description}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 反应动作 */}
                    {displayParticipant?.type === "monster" && displayActorDetails?.reactions && displayActorDetails.reactions.length > 0 && (
                      <div className="rounded overflow-hidden border border-blue-900/30">
                        <div className="px-2 py-1 text-[11px] font-medium text-blue-400" style={{ background: 'rgba(59,130,246,0.1)' }}>
                          ⚡ 反应 <span className="text-gray-500">({displayActorDetails.reactions.length})</span>
                        </div>
                        <div className="p-1.5 space-y-1.5 bg-black/20">
                          {displayActorDetails.reactions.map((r, i) => (
                            <div key={i} className="px-2 py-1.5 rounded bg-blue-900/10 border border-blue-900/20">
                              <div className="text-[11px] font-medium text-blue-400 mb-1">{r.name}</div>
                              {r.description && (
                                <div className="text-[9px] text-gray-400 leading-relaxed">
                                  {r.description}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 传奇动作 */}
                    {displayParticipant?.type === "monster" && displayActorDetails?.legendaryActions && displayActorDetails.legendaryActions.length > 0 && (
                      <div className="rounded overflow-hidden border border-amber-600/40">
                        <div className="px-2 py-1 text-[11px] font-medium text-amber-400" style={{ background: 'rgba(251,191,36,0.1)' }}>
                          👑 传奇动作 <span className="text-gray-500 font-normal">({displayActorDetails.legendaryActions.length})</span>
                        </div>
                        <div className="p-1.5 space-y-1.5 bg-black/20">
                          {displayActorDetails?.legendaryActions?.map((a, i) => (
                            <div key={i} className="px-2 py-1.5 rounded bg-amber-900/10 border border-amber-900/20">
                              <div className="text-[11px] font-medium text-amber-400 mb-1">{a.name}</div>
                              {a.description && (
                                <div className="text-[9px] text-gray-400 leading-relaxed">
                                  {a.description}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 行动提示 (折叠) */}
            {canViewHints && actorDetails && (
              <div className="rounded overflow-hidden" style={{ ...cardStyle, borderColor: 'rgba(251,191,36,0.2)' }}>
                <button className="w-full flex items-center justify-between px-2 py-1" onClick={() => setHintsExpanded(!hintsExpanded)}
                  style={{ background: 'rgba(251,191,36,0.05)' }}>
                  <span className="text-[11px] text-amber-400">📜 详细提示</span>
                  <span className="text-[10px] text-gray-600">{hintsExpanded ? '收起' : '展开'}</span>
                </button>
                {hintsExpanded && (
                  <div className="p-2 space-y-2 text-[10px] bg-black/20">
                    <div className="grid grid-cols-4 gap-1">
                      <div className="p-1.5 rounded text-center bg-green-900/20"><div className="text-green-400">移动</div><div className="text-white">{typeof actorDetails.speed === "string" ? actorDetails.speed : `${actorDetails.speed?.walk || 30}尺`}</div></div>
                      <div className="p-1.5 rounded text-center bg-red-900/20">
                        <div className="text-red-400">动作</div>
                        <div className="text-white">
                          {actorDetails.type === "character" && getExtraAttackCount(actorDetails.classId, actorDetails.level, actorDetails.subclassId) > 1
                            ? `${getExtraAttackCount(actorDetails.classId, actorDetails.level, actorDetails.subclassId)}次攻击`
                            : "1次"}
                        </div>
                      </div>
                      <div className="p-1.5 rounded text-center bg-yellow-900/20"><div className="text-yellow-400">附赠</div><div className="text-white">{actorDetails.type === "monster" ? "视能力" : "1次"}</div></div>
                      <div className="p-1.5 rounded text-center bg-blue-900/20"><div className="text-blue-400">反应</div><div className="text-white">1次/轮</div></div>
                    </div>
                    <div className="text-gray-500 border-t border-gray-800 pt-1">
                      <div>• 动作前/后/之间可分段移动</div>
                      <div>• 困难地形: 1尺=2尺移动力</div>
                      <div>• 离开敌人触及→借机攻击</div>
                      {actorDetails.type === "character" && getExtraAttackCount(actorDetails.classId, actorDetails.level, actorDetails.subclassId) > 1 && (
                        <div className="text-amber-400">• 额外攻击: 使用攻击动作时可攻击{getExtraAttackCount(actorDetails.classId, actorDetails.level, actorDetails.subclassId)}次</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 玩家视角：非自己回合时，独立卡片显示自己的行动资源 */}
            {!isDM && myToken && !isMyTurn && combatObj.data.status === 'in_progress' && (() => {
              const da = myTurnActions;
              const myName = myToken.character_name || combatObj.data.participants.find(p => p.token_id === myToken.id)?.name || '我';
              const myBonusActions = myCharacterActions.filter(a => a.action_type === 'bonus_action');
              const myReactionActions = myCharacterActions.filter(a => a.action_type === 'reaction');
              const isMyIncapacitated = myConditions.some(c => INCAPACITATING.includes(c));
              const canEnterManualReactionMode = !da.reactionUsed && !isMyIncapacitated && (myReactions.length > 0 || myReactionActions.length > 0);
              return (
              <div className="rounded overflow-hidden" style={cardStyle}>
                <div className="flex items-center justify-between px-2 py-1" style={headerStyle}>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    <span className="text-xs font-medium text-blue-300">{myName}</span>
                    <span className="text-[10px] text-gray-500">本轮资源</span>
                  </div>
                  {canEnterManualReactionMode && (
                    <button
                      onClick={() => {
                        const next = !manualReactionMode;
                        setManualReactionMode(next);
                        if (next) {
                          publishAppEvent("manualReactionModeStart", {
                            sourceTokenId: myToken.id,
                            sourceCharacterId: myToken.character_id,
                          });
                        } else {
                          publishAppEvent("manualReactionModeEnd", {
                            sourceTokenId: myToken.id,
                          });
                        }
                        if (next) {
                          setReactionsExpanded(true);
                          setReactionHint('已进入反应行动模式：现在可以在非自己回合右键地图目标，只显示反应相关选项。');
                        } else {
                          setReactionHint('');
                        }
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        manualReactionMode
                          ? 'bg-blue-500/20 text-blue-200 border border-blue-400/40'
                          : 'bg-blue-900/20 text-blue-300 border border-blue-900/30 hover:bg-blue-900/30'
                      }`}
                    >
                      {manualReactionMode ? '取消反应' : '⚡ 反应行动'}
                    </button>
                  )}
                </div>
                {/* 资源条 */}
                <div className="flex items-center gap-1.5 px-2 py-1.5 bg-black/20 border-b border-gray-800/30">
                  <button onClick={() => setResourceModalType('movement')}
                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] cursor-pointer hover:ring-1 hover:ring-white/30 transition-all ${
                      da.movementRemaining <= 0 ? 'bg-gray-700/50 text-gray-500' : 'bg-green-900/30 text-green-400'
                    }`}>
                    <span>🦶</span>
                    <span>{da.movementRemaining}/{da.movementMax}尺</span>
                  </button>
                  <button onClick={() => setResourceModalType('attack')}
                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] cursor-pointer hover:ring-1 hover:ring-white/30 transition-all ${
                      da.attacksUsed >= da.attacksMax ? 'bg-gray-700/50 text-gray-500' : 'bg-red-900/30 text-red-400'
                    }`}>
                    <span>⚔️</span>
                    <span>攻击 {da.attacksMax - da.attacksUsed}/{da.attacksMax}</span>
                  </button>
                  <button onClick={() => setResourceModalType('bonus_action')}
                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] cursor-pointer hover:ring-1 hover:ring-white/30 transition-all ${
                      da.bonusActionUsed ? 'bg-gray-700/50 text-gray-500' : 'bg-yellow-900/30 text-yellow-400'
                    }`}>
                    <span>🔥</span>
                    <span>附赠 {da.bonusActionUsed ? '0/1' : '1/1'}</span>
                  </button>
                  <button onClick={() => setResourceModalType('reaction')}
                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] cursor-pointer hover:ring-1 hover:ring-white/30 transition-all ${
                      da.reactionUsed ? 'bg-gray-700/50 text-gray-500' : 'bg-blue-900/30 text-blue-400'
                    }`}>
                    <span>⚡</span>
                    <span>反应 {da.reactionUsed ? '0/1' : '1/1'}</span>
                  </button>
                </div>
                {/* 基础动作 */}
                <div className="p-1.5 space-y-1">
                  <div className="rounded overflow-hidden border border-red-900/30">
                    <button className="w-full flex items-center justify-between px-2 py-1 text-left"
                      onClick={() => setBasicActionsExpanded(!basicActionsExpanded)}
                      style={{ background: basicActionsExpanded ? 'rgba(220,38,38,0.1)' : 'rgba(0,0,0,0.2)' }}>
                      <span className="text-[11px] font-medium text-red-400">⚔️ 基础动作</span>
                      <span className="text-gray-600 text-[10px]">{basicActionsExpanded ? '▼' : '▶'}</span>
                    </button>
                    {basicActionsExpanded && (
                      <div className="grid grid-cols-6 gap-0.5 p-1 bg-black/20">
                        {basicActions.map((a) => (
                          <button key={a.key}
                            onClick={() => setSelectedBasicAction(a)}
                            className="flex flex-col items-center py-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
                            title={a.description}>
                            <span className="text-sm">{a.icon}</span>
                            <span className="text-[9px] text-gray-400">{a.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* 附赠动作 */}
                  <div className="rounded overflow-hidden border border-yellow-900/30">
                    <button className="w-full flex items-center justify-between px-2 py-1 text-left"
                      onClick={() => setBonusActionsExpanded(!bonusActionsExpanded)}
                      style={{ background: bonusActionsExpanded ? 'rgba(234,179,8,0.1)' : 'rgba(0,0,0,0.2)' }}>
                      <span className="text-[11px] font-medium text-yellow-400">
                        🔥 附赠动作
                        {myBonusActions.length > 0 && <span className="text-gray-500 ml-1">({myBonusActions.length})</span>}
                      </span>
                      <span className="text-gray-600 text-[10px]">{bonusActionsExpanded ? '▼' : '▶'}</span>
                    </button>
                    {bonusActionsExpanded && (
                      <div className="p-1.5 space-y-1 bg-black/20">
                        {myBonusActions.length > 0 ? (
                          myBonusActions.map((action, i) => (
                            <div key={i} className="px-2 py-1.5 rounded bg-yellow-900/10 border border-yellow-900/20">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-yellow-400">{action.name}</span>
                                {action.uses && (
                                  <span className="text-[9px] text-gray-400">
                                    {action.uses.current}/{action.uses.max}次
                                    {action.uses.recharge && ` (${action.uses.recharge === 'short_rest' ? '短休' : '长休'})`}
                                  </span>
                                )}
                              </div>
                              {action.description && (
                                <div className="text-[9px] text-gray-400 mt-0.5 leading-relaxed line-clamp-2">{action.description}</div>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="text-[10px] text-gray-500 italic px-1">暂无附赠动作</div>
                        )}
                      </div>
                    )}
                  </div>
                  {/* ⚡ 反应动作 (非自己回合) */}
                  {(myReactions.length > 0 || myReactionActions.length > 0) && (
                    <div className={`rounded overflow-hidden border ${isMyIncapacitated ? 'border-purple-500/30 relative' : da.reactionUsed ? 'border-gray-700/30 opacity-50' : 'border-blue-900/30'}`}>
                      {isMyIncapacitated && (
                        <div className="absolute inset-0 bg-black/60 z-10 flex items-center justify-center rounded">
                          <span className="text-[10px] text-purple-300">💫 失能 — 无法反应</span>
                        </div>
                      )}
                      <button className="w-full flex items-center justify-between px-2 py-1 text-left"
                        onClick={() => setReactionsExpanded(!reactionsExpanded)}
                        style={{ background: reactionsExpanded ? 'rgba(59,130,246,0.1)' : 'rgba(0,0,0,0.2)' }}>
                        <span className="text-[11px] font-medium text-blue-400">
                          ⚡ 反应动作
                          <span className="text-gray-500 ml-1">({myReactions.length + myReactionActions.length})</span>
                          {da.reactionUsed && <span className="text-gray-500 ml-1">已使用</span>}
                        </span>
                        <span className="text-gray-600 text-[10px]">{reactionsExpanded ? '▼' : '▶'}</span>
                      </button>
                      {reactionsExpanded && (
                        <div className="p-1.5 space-y-1 bg-black/20">
                          {(manualReactionMode || reactionHint) && (
                            <div className={`text-[10px] px-2 py-1 rounded ${manualReactionMode ? 'text-cyan-200 bg-cyan-900/30 border border-cyan-700/30' : 'text-blue-300 bg-blue-900/30 animate-pulse'}`}>
                              {manualReactionMode
                                ? '⚡ 反应行动模式已开启：右键地图上的目标，只会显示反应相关选项。'
                                : reactionHint}
                            </div>
                          )}
                          {myReactionActions.length > 0 && (
                            <div className="text-[10px] text-gray-400 bg-gray-800/40 px-2 py-1 rounded">
                              角色/领域反应会在“反应行动模式”下的目标菜单中显示。
                            </div>
                          )}
                          {myReactions.map((r) => (
                            <button key={r.id} disabled={da.reactionUsed}
                              onClick={() => {
                                if (r.category === 'attack') {
                                  if (!manualReactionMode) {
                                    setManualReactionMode(true);
                                    publishAppEvent("manualReactionModeStart", {
                                      sourceTokenId: myToken.id,
                                      sourceCharacterId: myToken.character_id,
                                    });
                                  }
                                  setReactionHint(`已准备主动反应：请右键地图目标，然后选择「${r.name}」`);
                                  setTimeout(() => setReactionHint(''), 4000);
                                }
                              }}
                              className={`w-full text-left px-2 py-1.5 rounded border transition-colors ${da.reactionUsed ? 'bg-gray-800/30 border-gray-700/20 cursor-not-allowed' : 'bg-blue-900/10 border-blue-900/20 hover:bg-blue-900/20 cursor-pointer'}`}>
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm">{r.icon}</span>
                                <span className="text-[11px] font-medium text-blue-400">{r.name}</span>
                                <span className="text-[9px] px-1 py-0.5 rounded bg-blue-900/30 text-blue-300">{r.category === 'attack' ? '攻击' : r.category === 'defense' ? '防御' : '法术'}</span>
                                <span className="text-[8px] text-gray-500 ml-auto">{r.category === 'attack' ? '右键地图目标' : '聊天中触发'}</span>
                              </div>
                              <div className="text-[9px] text-gray-400 mt-0.5 leading-relaxed">{r.triggerDesc}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              );
            })()}

            {/* 战斗记录 (折叠) */}
            {(combatObj.data.log?.length > 0 || attackLog.length > 0) && (
              <div className="rounded overflow-hidden" style={{ ...cardStyle, borderColor: 'rgba(100,100,100,0.2)' }}>
                <button className="w-full flex items-center justify-between px-2 py-1" onClick={() => setLogExpanded(!logExpanded)}
                  style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <span className="text-[11px] text-gray-400">📋 记录 ({(combatObj.data.log?.length || 0) + attackLog.length})</span>
                  <span className="text-[10px] text-gray-600">{logExpanded ? '收起' : '展开'}</span>
                </button>
                {logExpanded && (
                  <div className="max-h-64 overflow-auto p-1.5 space-y-1.5 bg-black/20">
                    {/* Combine and sort logs by timestamp */}
                    {(() => { const fmtTime = (ts: number) => { const d = new Date(ts); return `${String(d.getFullYear()).slice(2)}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }; return [
                      ...(combatObj.data.log || []).map(e => ({
                        type: 'turn' as const,
                        round: e.round,
                        token_id: e.token_id,
                        action: e.action,
                        ts: e.ts
                      })),
                      ...attackLog.map(e => {
                        if (e.type === 'attack') {
                          return {
                            type: 'attack' as const,
                            round: e.round,
                            attackerName: e.attackerName,
                            targetName: e.targetName,
                            attackName: e.attackName,
                            hit: e.hit,
                            critical: e.critical,
                            fumble: e.fumble,
                            damage: e.damage,
                            targetAc: e.targetAc,
                            content: e.content,
                            ts: e.ts
                          };
                        } else if (e.type === 'bonus_action') {
                          return {
                            type: 'bonus_action' as const,
                            round: e.round,
                            tokenId: e.tokenId,
                            tokenName: e.tokenName,
                            actionName: e.actionName,
                            actionIcon: e.actionIcon,
                            ts: e.ts
                          };
                        } else {
                          return {
                            type: 'move' as const,
                            round: e.round,
                            tokenId: e.tokenId,
                            tokenName: e.tokenName,
                            fromX: e.fromX,
                            fromY: e.fromY,
                            toX: e.toX,
                            toY: e.toY,
                            distance: e.distance,
                            ts: e.ts
                          };
                        }
                      })
                    ].sort((a, b) => b.ts - a.ts).slice(0, 15).map((e, i) => {
                      if (e.type === 'turn') {
                        const p = combatObj.data.participants.find((x) => x.token_id === e.token_id);
                        return (
                          <div key={`turn-${i}`} className="flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 rounded bg-black/20">
                            <span className="text-gray-600 w-5">R{e.round}</span>
                            <span style={{ color: p?.type === "monster" ? '#f87171' : '#93c5fd' }}>{p?.name || `#${e.token_id}`}</span>
                            <span className="text-gray-600">-</span>
                            <span className="text-gray-500">{e.action === 'end_turn' ? '结束回合' : e.action || '动作'}</span>
                            <span className="ml-auto text-gray-600 text-[9px]">{fmtTime(e.ts)}</span>
                          </div>
                        );
                      } else if (e.type === 'move') {
                        // Movement log entry
                        const p = combatObj.data.participants.find((x) => x.token_id === e.tokenId);
                        const isCurrentToken = combatObj.data.order[getCombatTurnIndex(combatObj.data, combatObj.data.order.length)] === e.tokenId;
                        const handleRestore = () => {
                          publishAppEvent("combatRestoreMovement", {
                            tokenId: e.tokenId,
                            toX: e.fromX,
                            toY: e.fromY,
                            restoreDistance: e.distance,
                          });
                          // Remove this movement log entry
                          setAttackLog(prev => prev.filter(log => log.ts !== e.ts));
                        };
                        return (
                          <div key={`move-${i}`} className="flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 rounded bg-black/20 border border-blue-500/20">
                            <span className="text-blue-400">🏃</span>
                            <span style={{ color: p?.type === "monster" ? '#f87171' : '#93c5fd' }}>{e.tokenName}</span>
                            <span className="text-gray-400">({e.fromX},{e.fromY})→({e.toX},{e.toY})</span>
                            <span className="text-green-400">{e.distance}尺</span>
                            {isCurrentToken && isDM && (
                              <button
                                onClick={handleRestore}
                                className="ml-1 px-1 py-0.5 text-[9px] bg-blue-600/50 hover:bg-blue-500/70 rounded text-white"
                                title="恢复到移动前的位置"
                              >
                                ↩撤回
                              </button>
                            )}
                            <span className="ml-auto text-gray-600 text-[9px]">{fmtTime(e.ts)}</span>
                          </div>
                        );
                      } else if (e.type === 'bonus_action') {
                        // Bonus action log entry
                        const p = combatObj.data.participants.find((x) => x.token_id === e.tokenId);
                        return (
                          <div key={`bonus-${i}`} className="flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 rounded bg-black/20 border border-orange-500/20">
                            <span className="text-orange-400">{e.actionIcon}</span>
                            <span style={{ color: p?.type === "monster" ? '#f87171' : '#93c5fd' }}>{e.tokenName}</span>
                            <span className="text-gray-500">附赠</span>
                            <span className="text-orange-300">{e.actionName}</span>
                            <span className="ml-auto text-gray-600 text-[9px]">{fmtTime(e.ts)}</span>
                          </div>
                        );
                      } else {
                        // Attack log entry - show full formatted content
                        const borderColor = e.critical ? 'border-amber-500/30' : (e.fumble ? 'border-purple-500/30' : (e.hit ? 'border-green-500/20' : 'border-red-500/20'));
                        const bgColor = e.critical ? 'bg-amber-900/10' : (e.fumble ? 'bg-purple-900/10' : (e.hit ? 'bg-green-900/10' : 'bg-red-900/10'));

                        // Parse markdown-style content: **bold** and _italic_
                        const formatContent = (text: string) => {
                          if (!text) return null;
                          // Split by lines and render each
                          return text.split('\n').map((line, lineIdx) => {
                            // Replace **bold** with styled spans
                            const parts = line.split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
                            return (
                              <div key={lineIdx} className="leading-tight">
                                {parts.map((part, partIdx) => {
                                  if (part.startsWith('**') && part.endsWith('**')) {
                                    return <span key={partIdx} className="font-bold text-amber-300">{part.slice(2, -2)}</span>;
                                  } else if (part.startsWith('_') && part.endsWith('_')) {
                                    return <span key={partIdx} className="italic text-gray-400">{part.slice(1, -1)}</span>;
                                  }
                                  return <span key={partIdx}>{part}</span>;
                                })}
                              </div>
                            );
                          });
                        };

                        return (
                          <div key={`atk-${i}`} className={`text-[11px] px-2 py-1.5 rounded border ${borderColor} ${bgColor} relative`}>
                            <span className="absolute top-1 right-1.5 text-gray-600 text-[9px]">{fmtTime(e.ts)}</span>
                            {e.content ? formatContent(e.content) : (
                              <div className="flex items-center gap-1">
                                <span className="text-orange-400">⚔️</span>
                                <span className="text-amber-300">{e.attackerName}</span>
                                <span className="text-gray-600">→</span>
                                <span className="text-red-300">{e.targetName}</span>
                                <span className={e.hit ? 'text-green-400' : 'text-red-400'}>{e.hit ? '✓' : '✗'}</span>
                                {e.hit && <span className="text-red-400">-{e.damage}</span>}
                              </div>
                            )}
                            {isDM && e.targetAc != null && (
                              <div className="mt-0.5 text-[10px] text-gray-500">
                                <span className="px-1 py-0.5 rounded bg-gray-700/50 border border-gray-600/50">
                                  🛡️ AC: {e.targetAc}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      }
                    }); })()}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, transparent, #b8860b 30%, #ffd700 50%, #b8860b 70%, transparent)' }} />

      {/* Combat Summary Modal */}
      {combatObj && (
        <CombatSummaryModal
          isOpen={showSummaryModal}
          participants={combatObj.data.participants}
          defeatedParticipants={defeatedParticipants}
          damageStats={damageStats}
          round={combatObj.data.round}
          onClose={() => setShowSummaryModal(false)}
          onConfirmEnd={finalizeEndCombat}
          onDistributeXP={handleDistributeXP}
        />
      )}

      {/* Basic Action Info Modal */}
      <Dialog.Root open={!!selectedBasicAction} onOpenChange={(open) => { if (!open) setSelectedBasicAction(null); }} modal={false}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[9998]" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-sm bg-gray-900 border border-amber-700/50 rounded-lg shadow-2xl z-[9999]"
          >
          <Dialog.Description className="sr-only">
            基础动作规则说明对话框。
          </Dialog.Description>
          {selectedBasicAction && (<>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-amber-700/30"
              style={{ background: 'linear-gradient(180deg, rgba(139,69,19,0.3) 0%, rgba(0,0,0,0) 100%)' }}>
              <Dialog.Title className="flex items-center gap-2">
                <span className="text-2xl">{selectedBasicAction.icon}</span>
                <span className="text-lg font-bold text-amber-200">{selectedBasicAction.name}</span>
              </Dialog.Title>
              <span className="text-xs px-2 py-0.5 rounded bg-red-900/50 text-red-300 border border-red-700/50">
                {selectedBasicAction.cost}
              </span>
            </div>
            {/* Content */}
            <div className="p-4 space-y-3">
              <div>
                <p className="text-sm text-gray-300 leading-relaxed">{selectedBasicAction.description}</p>
              </div>
              <div className="bg-black/30 rounded p-2 border border-gray-700/50">
                <p className="text-xs text-gray-500 mb-1">规则说明</p>
                <p className="text-xs text-gray-400">{selectedBasicAction.rules}</p>
              </div>
              <div className="bg-amber-900/20 rounded p-2 border border-amber-700/30">
                <p className="text-xs text-amber-300/80">
                  💡 提示：要对目标施展此动作，请在地图上<span className="font-bold text-amber-200">右键点击目标</span>打开操作菜单。
                </p>
              </div>
            </div>
            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-700/50 flex justify-end">
              <Dialog.Close className="px-4 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors">
                知道了
              </Dialog.Close>
            </div>
          </>)}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Resource Explanation Modal */}
      <Dialog.Root open={!!resourceModalType} onOpenChange={(open) => { if (!open) setResourceModalType(null); }} modal={false}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[9998]" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-md max-h-[80dvh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-[9999]"
          >
          <Dialog.Description className="sr-only">
            战斗资源说明对话框。
          </Dialog.Description>
          {resourceModalType && (<>
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-700/50 flex items-center justify-between">
              <Dialog.Title className="text-lg font-semibold text-amber-400 flex items-center gap-2">
                {resourceModalType === 'movement' && <>🦶 移动力</>}
                {resourceModalType === 'attack' && <>⚔️ 攻击次数</>}
                {resourceModalType === 'bonus_action' && <>🔥 附赠动作</>}
                {resourceModalType === 'reaction' && <>⚡ 反应</>}
              </Dialog.Title>
              <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors">
                ✕
              </Dialog.Close>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3 text-sm">
              {resourceModalType === 'movement' && (
                <>
                  <div className="bg-green-900/20 border border-green-700/30 rounded p-3">
                    <div className="text-green-400 font-medium mb-1">当前状态</div>
                    <div className="text-white">剩余 {turnActions.movementRemaining} 尺 / 总计 {turnActions.movementMax} 尺</div>
                  </div>
                  <div className="text-gray-300">
                    <p className="mb-2"><strong>移动力</strong>是你在一个回合内可以移动的最大距离。</p>
                    <p className="mb-2">移动力来源：</p>
                    <ul className="list-disc list-inside space-y-1 text-gray-400">
                      <li>基础速度：由种族决定（通常为30尺）</li>
                      {actorDetails?.type === 'character' && actorDetails.classId?.toLowerCase() === 'monk' && (
                        <li className="text-yellow-400">武僧·无甲移动：不穿甲时速度提升</li>
                      )}
                      {actorDetails?.type === 'character' && actorDetails.classId?.toLowerCase() === 'barbarian' && (actorDetails.level || 0) >= 5 && (
                        <li className="text-red-400">野蛮人·快速移动（5级）：不穿重甲时+10尺</li>
                      )}
                    </ul>
                  </div>
                  <div className="text-gray-500 text-xs border-t border-gray-700/50 pt-2">
                    提示：你可以在回合中随时移动，可以在攻击前后分段使用移动力。
                  </div>
                </>
              )}

              {resourceModalType === 'attack' && (() => {
                const attackDetails = actorDetails?.type === 'character'
                  ? getExtraAttackFeatureDetails(actorDetails.classId, actorDetails.level, actorDetails.subclassId)
                  : { count: 1, feature: null, reason: '怪物：由怪物数据决定' };
                return (
                  <>
                    <div className="bg-red-900/20 border border-red-700/30 rounded p-3">
                      <div className="text-red-400 font-medium mb-1">当前状态</div>
                      <div className="text-white">
                        已用 {turnActions.attacksUsed} 次 / 总计 {turnActions.attacksMax} 次
                      </div>
                    </div>
                    <div className="text-gray-300">
                      <p className="mb-2"><strong>攻击次数</strong>是你使用攻击动作时可以进行的攻击次数。</p>
                      <p className="mb-2">攻击次数来源：</p>
                      <ul className="list-disc list-inside space-y-1 text-gray-400">
                        {attackDetails.feature ? (
                          <li className="text-amber-400">
                            <span className="font-medium">{attackDetails.feature.name}</span>
                            {attackDetails.feature.level && `（${attackDetails.feature.level}级获得）`}
                            <p className="ml-5 text-xs text-gray-500 mt-1">{attackDetails.feature.description}</p>
                          </li>
                        ) : (
                          <li>基础：每次攻击动作可进行1次攻击</li>
                        )}
                      </ul>
                    </div>
                    {attackDetails.feature && (
                      <div className="text-gray-500 text-xs border-t border-gray-700/50 pt-2">
                        {actorDetails?.classInfo && `${actorDetails.classInfo} - `}
                        {attackDetails.reason}
                      </div>
                    )}
                  </>
                );
              })()}

              {resourceModalType === 'bonus_action' && (() => {
                const bonusActions = actorDetails?.type === 'character'
                  ? getBonusActionFeatures(actorDetails.classId, actorDetails.level, actorDetails.subclassId)
                  : [];
                return (
                  <>
                    <div className="bg-yellow-900/20 border border-yellow-700/30 rounded p-3">
                      <div className="text-yellow-400 font-medium mb-1">当前状态</div>
                      <div className="text-white">{turnActions.bonusActionUsed ? '已使用' : '可用'} (1/1)</div>
                    </div>
                    <div className="text-gray-300">
                      <p className="mb-2"><strong>附赠动作</strong>是你在回合中可以进行的额外快速动作。</p>
                      {bonusActions.length > 0 ? (
                        <>
                          <p className="mb-2 text-amber-400">你拥有的附赠动作能力：</p>
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {bonusActions.map(feature => (
                              <div key={feature.id} className="bg-black/30 rounded p-2 border-l-2" style={{ borderColor: feature.color }}>
                                <div className="flex items-center gap-1.5 text-white font-medium text-xs">
                                  <span>{feature.icon}</span>
                                  <span>{feature.name}</span>
                                  <span className="text-gray-500 text-[10px]">({feature.level}级)</span>
                                </div>
                                <p className="text-gray-400 text-xs mt-1">{feature.description}</p>
                                {feature.cost && feature.cost !== 'bonus_action' && feature.cost !== 'none' && (
                                  <p className="text-yellow-500/70 text-[10px] mt-1">消耗：{feature.cost}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="mb-2">常见附赠动作用途：</p>
                          <ul className="list-disc list-inside space-y-1 text-gray-400">
                            <li>双武器战斗：使用副手武器攻击（需要双持轻型武器）</li>
                            <li>施放某些法术（如治疗祷言、迷踪步）</li>
                            <li>职业特性（如盗贼狡猾动作、武僧疾风连击）</li>
                          </ul>
                        </>
                      )}
                    </div>
                    <div className="text-gray-500 text-xs border-t border-gray-700/50 pt-2">
                      提示：每回合只能使用一次附赠动作，且必须有特定能力才能使用。
                    </div>
                  </>
                );
              })()}

              {resourceModalType === 'reaction' && (
                <>
                  <div className="bg-blue-900/20 border border-blue-700/30 rounded p-3">
                    <div className="text-blue-400 font-medium mb-1">当前状态</div>
                    <div className="text-white">{turnActions.reactionUsed ? '已使用' : '可用'} (1/1)</div>
                  </div>
                  <div className="text-gray-300">
                    <p className="mb-2"><strong>反应</strong>是你对特定触发条件做出的即时响应，可以在任何人的回合使用。</p>
                    <p className="mb-2">常见反应用途：</p>
                    <ul className="list-disc list-inside space-y-1 text-gray-400">
                      <li>借机攻击：敌人离开你的触及范围时</li>
                      <li>盾牌术：受到攻击时+5AC</li>
                      <li>反制法术：敌人施法时尝试打断</li>
                      {actorDetails?.type === 'character' && actorDetails.classId?.toLowerCase() === 'rogue' && (actorDetails.level || 0) >= 5 && (
                        <li className="text-purple-400">盗贼·灵巧闪避（5级）：受到攻击时伤害减半</li>
                      )}
                    </ul>
                  </div>
                  <div className="text-gray-500 text-xs border-t border-gray-700/50 pt-2">
                    提示：反应在每轮开始时恢复，你每轮只能使用一次反应。
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-700/50 flex justify-end">
              <Dialog.Close className="px-4 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors">
                知道了
              </Dialog.Close>
            </div>
          </>)}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
