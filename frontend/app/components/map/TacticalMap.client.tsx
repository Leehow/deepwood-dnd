/**
 * TacticalMapClient - Refactored Main Component
 * Orchestrates all map functionality using extracted modules
 *
 * ⚠️ IMPORTANT: This file was refactored on 2025-01-07 (commit de746a1)
 * - Original: 1,804 lines (monolithic)
 * - Refactored: 410 lines (modular)
 * - All functionality extracted to: hooks/, utils/, and component files
 * - DO NOT restore old version from git history
 * - Refer to hooks/useMapEvents.ts, useMapState.ts, useMapData.ts, useMapWebSocket.ts
 */

import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Stage, Layer, Rect, Image as KonvaImage } from "react-konva";
import { FogOfWarRenderer } from "./FogOfWarRenderer";
import { TerrainLayer } from "./TerrainLayer";
import { TerrainBrushOverlay } from "./TerrainBrushOverlay";
import { TerrainManager, type TerrainData, type TerrainType } from "./TerrainManager";
import { RulerRenderer } from "./RulerRenderer";
import { DrawingsLayer } from "./DrawingsLayer";
import { AIMapMarkerOverlay } from "./AIMapMarkerOverlay";
import { AuraLayer } from "./AuraLayer";
import { IlluminationLayer } from "./IlluminationLayer";
import { NightOverlayLayer } from "./NightOverlayLayer";
import { ActiveSpellAreasLayer } from "./ActiveSpellAreasLayer";
import { ObscurementOverlayLayer } from "./ObscurementOverlayLayer";
import { showGlobalToast } from "../ui/Toast";
import { getAssetUrl } from "~/utils/asset-url";

// Extracted modules
import type { TacticalMapProps, Token, AuraVisual, Position } from "./types/TacticalMapTypes";
import { GRID_SIZE, MAP_WIDTH, MAP_HEIGHT } from "./types/TacticalMapTypes";
import { parseTokenSize, getEdgeToEdgeDistance } from "./utils/mapCalculations";
import {
  getAbilityModifier,
  getMonsterAbilityScores,
  getMonsterSavingThrowOverride,
  getProficiencyBonus,
  normalizeStringList,
  toFiniteNumber,
} from "./utils/mapMonsterRuntimeUtils";
import { useMapState } from "./hooks/useMapState";
import { useMapData } from "./hooks/useMapData";
import { useMapWebSocket, type CombatAttackData } from "./hooks/useMapWebSocket";
import { useMapForcedMovementConsumer } from "./hooks/useMapForcedMovementConsumer";
import { useMapEvents } from "./hooks/useMapEvents";
import { useKeyboardMovement } from "./hooks/useKeyboardMovement";
import { useMapCombatOverlays } from "./hooks/useMapCombatOverlays";
import { useMapCombatRuntimeController } from "./hooks/useMapCombatRuntimeController";
import { useMapExternalSyncController } from "./hooks/useMapExternalSyncController";
import { useMapInventoryAndPlacementController } from "./hooks/useMapInventoryAndPlacementController";
import { useMapMovementRuntimeController } from "./hooks/useMapMovementRuntimeController";
import { useMapSelectionActionController } from "./hooks/useMapSelectionActionController";
import { useMapTerrainController } from "./hooks/useMapTerrainController";
import { useMapTokenDragController } from "./hooks/useMapTokenDragController";
import { useMapTargetingController } from "./hooks/useMapTargetingController";
import { useMapTouchGestureController } from "./hooks/useMapTouchGestureController";
import { useMapInventoryController } from "./hooks/useMapInventoryController";
import { useMapModalData } from "./hooks/useMapModalData";
import { useMapAreaSpellController, type AreaSpellModeState } from "./hooks/useMapAreaSpellController";
import { useMapAreaSpellRuntimeController } from "./hooks/useMapAreaSpellRuntimeController";
import { useMapAreaSpellPersistence } from "./hooks/useMapAreaSpellPersistence";
import { useMapAreaSpellNonCombatController } from "./hooks/useMapAreaSpellNonCombatController";
import { useMapAreaSpellResultController } from "./hooks/useMapAreaSpellResultController";
import { useMapAreaSpellCombatDispatchController } from "./hooks/useMapAreaSpellCombatDispatchController";
import { useMapAreaSpellCastExecutionController } from "./hooks/useMapAreaSpellCastExecutionController";
import { useMapSidebarSpellController } from "./hooks/useMapSidebarSpellController";
import { useMapReactionSpellController } from "./hooks/useMapReactionSpellController";
import { useMapSupportActionController } from "./hooks/useMapSupportActionController";
import { useMapInvokeDuplicityController } from "./hooks/useMapInvokeDuplicityController";
import { useMapClericDomainActionController } from "./hooks/useMapClericDomainActionController";
import { useMapTrickeryLightActionController } from "./hooks/useMapTrickeryLightActionController";
import { useMapReadThoughtsActionController } from "./hooks/useMapReadThoughtsActionController";
import { useMapChannelDivinityActionController } from "./hooks/useMapChannelDivinityActionController";
import { useMapBonusUtilityActionController } from "./hooks/useMapBonusUtilityActionController";
import { useMapTransformationController } from "./hooks/useMapTransformationController";
import { useMapTargetSaveEffectController } from "./hooks/useMapTargetSaveEffectController";
import { useMapBonusActionActivationController } from "./hooks/useMapBonusActionActivationController";
import { useMapBonusActionRoutingController } from "./hooks/useMapBonusActionRoutingController";
import { useMapFeatureAdminController } from "./hooks/useMapFeatureAdminController";
import { useMapManeuverController } from "./hooks/useMapManeuverController";
import { useMapAttackResultController } from "./hooks/useMapAttackResultController";
import { useMapAttackEntryController } from "./hooks/useMapAttackEntryController";
import { useMapMonsterActionController } from "./hooks/useMapMonsterActionController";
import { useMapWeaponAttackExecutionController } from "./hooks/useMapWeaponAttackExecutionController";
import { useMapWeaponAttackPreparationController } from "./hooks/useMapWeaponAttackPreparationController";
import { useMapWeaponAttackCleanupController } from "./hooks/useMapWeaponAttackCleanupController";
import { useMapHotbarAttackBridge } from "./hooks/useMapHotbarAttackBridge";
import { useMapInteractionController } from "./hooks/useMapInteractionController";
import { useMapFocusController } from "./hooks/useMapFocusController";
import { useMapMarkerController } from "./hooks/useMapMarkerController";
import { useMapDueCastResolution } from "./hooks/useMapDueCastResolution";
import { useMapPlacementController } from "./hooks/useMapPlacementController";
import { useMapPlayerActionController } from "./hooks/useMapPlayerActionController";
import { useMapStatusController } from "./hooks/useMapStatusController";
import { useMapTokenInteractionController } from "./hooks/useMapTokenInteractionController";
import { useMapUiChromeController } from "./hooks/useMapUiChromeController";
import { useMapViewportController } from "./hooks/useMapViewportController";
import { useMapViewStateController } from "./hooks/useMapViewStateController";
import { MapGrid } from "./MapGrid";
import {
  MapMarkerAndConfirmDialogs,
  type MoveConfirmModalState,
  type RangeConfirmModalState,
} from "./MapMarkerAndConfirmDialogs";
import { MapTokenLayer } from "./MapTokenLayer";
import { MapActionMenus } from "./MapActionMenus";
import { MapPlayerSpellDialog, type PlayerSpellDialogState } from "./MapPlayerSpellDialog";
import { MapSpecialActionDialogs } from "./MapSpecialActionDialogs";
import { MapTargetingHud } from "./MapTargetingHud";
import { MapTargetingOverlayLayer } from "./MapTargetingOverlayLayer";
import { ZoomControls } from "./ZoomControls";
import { Minimap } from "./Minimap";
import { MapSelectionMenuLayer } from "./MapSelectionMenuLayer";
import { MapStatusDialogs } from "./MapStatusDialogs";
import { TokenModal } from "./TokenModal";
import { PlayerTokenOverlay } from "./PlayerTokenOverlay";
import { type PendingToolCheckRequest } from "./ToolCheckModal";

import { TokenParamsEditor } from "./TokenParamsEditor";
import { FloatingTokenPanel } from "./FloatingTokenPanel";
import { useFloatingTokenPanelStore } from "~/stores/floatingTokenPanelStore";

import { type MonsterAction, type AttackOption, type Maneuver, type SpellOption, type CharacterClassAction } from "./SelectionContextMenu";
import { calculateFlyingSpeed, calculateSpeed, getEffectiveMovementSpeed } from "~/components/character/CharacterDisplay/utils/speed";
import { InitiativeTracker } from "../combat/InitiativeTracker";
import { DamageNumberOverlay, showDamageNumber } from "./DamageNumberOverlay";
import { DiceRollingOverlay } from "./DiceRollingOverlay";
import { type SpellAreaShape } from "./SpellAreaOverlay";
// CombatActionModal removed temporarily per request
import equipmentData from "~/data/rules/equipment.json";
import spellsData from "~/data/rules/spells.json";
import racesData from "~/data/rules/races.json";
import classesData from "~/data/rules/classes_with_structured_subclass_features.json";
import { apiFetch } from "~/utils/api-client";
import { createLogger } from '~/utils/logger';
import { fetchCampaignCombatStateCached } from "~/utils/combatStateCache";
import { getEffectDefinition, getAllEffects } from '~/hooks/useEffectSystem';
import { getAuraPresentation } from "./utils/auraPresentation";
import type { EffectDefinition } from '~/types/effects';
import { setConcentrationOnToken } from '~/utils/sidebarCasting';
import { SPELL_BUFF_EFFECTS, isAppearanceIllusionSpell } from '~/components/spell/spell-constants';
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import { useSpellSound } from '~/stores/spellSoundStore';
import { useAttackSound } from '~/stores/attackSoundStore';
import {
  getInvokeDuplicityLinkedTokenIds,
  isInvokeDuplicityConcentration,
  type InvokeDuplicityModalState,
  type InvokeDuplicityPlacementMode,
} from "./utils/mapInvokeDuplicityUtils";
const logger = createLogger('TacticalMap.client');

// Map action names (Chinese/English) to effect IDs
const ACTION_NAME_TO_EFFECT_ID: Record<string, string> = {
  '狂乱': 'frenzy', 'Frenzy': 'frenzy',
  '激励': 'bardic_inspiration', 'Bardic Inspiration': 'bardic_inspiration',
  '驱散不死生物': 'turn_undead', 'Turn Undead': 'turn_undead',
};

const GUIDED_STRIKE_BONUS_EFFECT_ID = 'guided_strike_bonus';
const WAR_GODS_BLESSING_BONUS_EFFECT_ID = 'war_gods_blessing_bonus';
const BLESSING_OF_THE_TRICKSTER_EFFECT_PREFIX = 'blessing_of_the_trickster_';
const BLESSING_OF_THE_TRICKSTER_DURATION_ROUNDS = 600;
const CLOAK_OF_SHADOWS_EFFECT_ID = 'cloak_of_shadows';
const CLOAK_OF_SHADOWS_DURATION_ROUNDS = 2;
const CLOAK_OF_SHADOWS_SOURCE_NAME = '诡术斗篷';
const WARDING_FLARE_PENDING_EFFECT_ID = 'warding_flare_pending';
const CORONA_OF_LIGHT_EFFECT_ID = 'corona_of_light';
const DAMPEN_ELEMENTS_PENDING_EFFECT_PREFIX = 'dampen_elements_pending_';
const DESTRUCTIVE_WRATH_PENDING_EFFECT_ID = 'destructive_wrath_pending';
const KNOWLEDGE_OF_THE_AGES_FEATURE_ID = 'knowledge_of_the_ages';
const LONG_PRESS_INDICATOR_ANIM_DURATION = 900;
const TEMPEST_DAMAGE_LABEL: Record<'lightning' | 'thunder', string> = {
  lightning: '闪电',
  thunder: '雷鸣',
};
const EXECUTION_SAVE_ABILITY_TO_EN: Record<string, 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma'> = {
  str: 'strength',
  strength: 'strength',
  dex: 'dexterity',
  dexterity: 'dexterity',
  con: 'constitution',
  constitution: 'constitution',
  int: 'intelligence',
  intelligence: 'intelligence',
  wis: 'wisdom',
  wisdom: 'wisdom',
  cha: 'charisma',
  charisma: 'charisma',
};
const EXECUTION_SAVE_ABILITY_TO_CN: Record<string, string> = {
  strength: '力量',
  dexterity: '敏捷',
  constitution: '体质',
  intelligence: '智力',
  wisdom: '感知',
  charisma: '魅力',
};

function isWarDomainAttackBonusEffect(effect: any): boolean {
  return Boolean(
    effect
    && (
      effect.id === GUIDED_STRIKE_BONUS_EFFECT_ID
      || effect.id === WAR_GODS_BLESSING_BONUS_EFFECT_ID
      || Number(effect.metadata?.attackBonusAdd || 0) > 0
    )
  );
}

function isWardingFlareDefenseEffect(effect: any): boolean {
  return Boolean(
    effect
    && (
      effect.id === WARDING_FLARE_PENDING_EFFECT_ID
      || effect.metadata?.wardingFlarePending
      || (
        effect.spell_buff
        && Array.isArray(effect.buff_effects?.grantDisadvantage)
        && effect.buff_effects.grantDisadvantage.some((entry: string) => String(entry).toLowerCase().includes('attack'))
      )
    )
  );
}

function isPendingDamageResistanceEffect(effect: any): boolean {
  return Boolean(
    effect
    && effect.metadata?.pendingTrigger === 'damage_received'
    && (
      effect.metadata?.pendingEffectType === 'grant_resistance'
      || effect.id?.startsWith(DAMPEN_ELEMENTS_PENDING_EFFECT_PREFIX)
    )
  );
}

function isBlessingOfTheTricksterEffect(effect: any, sourceCharacterId?: number | null): boolean {
  if (!effect) return false;
  const matchesSource = sourceCharacterId == null
    || Number(effect.metadata?.sourceCharacterId) === Number(sourceCharacterId)
    || Number(effect.source_character_id) === Number(sourceCharacterId);
  return Boolean(
    matchesSource && (
      effect.metadata?.sourceFeatureId === 'blessing_of_the_trickster'
      || effect.source_feature_id === 'blessing_of_the_trickster'
      || String(effect.id || '').startsWith(BLESSING_OF_THE_TRICKSTER_EFFECT_PREFIX)
    )
  );
}

function isCloakOfShadowsEffect(effect: any): boolean {
  if (!effect) return false;
  return Boolean(
    effect.id === CLOAK_OF_SHADOWS_EFFECT_ID
    || effect.metadata?.sourceFeatureId === 'cloak_of_shadows'
    || effect.source_feature_id === 'cloak_of_shadows'
    || effect.name === CLOAK_OF_SHADOWS_SOURCE_NAME
  );
}

function normalizeTempestDamageType(value: unknown): 'lightning' | 'thunder' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'lightning' || normalized === '闪电') return 'lightning';
  if (normalized === 'thunder' || normalized === '雷鸣') return 'thunder';
  return null;
}

function isDestructiveWrathEligibleDamageType(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(entry => isDestructiveWrathEligibleDamageType(entry));
  }
  return normalizeTempestDamageType(value) !== null;
}

function isDestructiveWrathPendingEffect(effect: any): boolean {
  return Boolean(
    effect
    && (
      effect.id === DESTRUCTIVE_WRATH_PENDING_EFFECT_ID
      || effect.metadata?.sourceFeatureId === 'destructive_wrath'
      || (
        effect.metadata?.pendingTrigger === 'deal_damage'
        && effect.metadata?.pendingEffectType === 'maximize_damage'
      )
    )
  );
}

// Map spell IDs to their applied effect IDs (for control/condition spells)
const SPELL_TO_EFFECT_MAP: Record<string, { effectId: string; duration?: number }> = {
  'sleep': { effectId: 'unconscious', duration: 10 },          // 1 minute = 10 rounds
  'web': { effectId: 'webbed' },                               // Until escaped or spell ends
  'entangle': { effectId: 'entangled' },                       // Until escaped or spell ends
  'grease': { effectId: 'grease_prone' },                      // Until end of turn
  'faerie-fire': { effectId: 'faerie_fire', duration: 10 },    // 1 minute
  'faerie_fire': { effectId: 'faerie_fire', duration: 10 },
  'hypnotic-pattern': { effectId: 'hypnotic_pattern', duration: 10 },
  'hypnotic_pattern': { effectId: 'hypnotic_pattern', duration: 10 },
  'stinking-cloud': { effectId: 'stinking_cloud' },
  'stinking_cloud': { effectId: 'stinking_cloud' },
  'slow': { effectId: 'slowed', duration: 10 },
  'confusion': { effectId: 'confused', duration: 10 },
  'hold-person': { effectId: 'paralyzed', duration: 10 },
  'hold_person': { effectId: 'paralyzed', duration: 10 },
  'hold-monster': { effectId: 'paralyzed', duration: 10 },
  'hold_monster': { effectId: 'paralyzed', duration: 10 },
};

type PreserveLifeModalState = {
  sourceTokenId: number;
  sourceCharacterId: number;
  sourceName: string;
  totalPool: number;
  channelDivinityCurrent: number;
  channelDivinityMax: number;
  targets: Array<{
    tokenId: number;
    name: string;
    currentHp: number;
    maxHp: number;
    maxHealable: number;
    distanceFeet: number;
  }>;
};

type DampenElementsModalState = {
  reactionId: string;
  sourceTokenId: number;
  targetTokenId: number;
  sourceName: string;
  targetName: string;
};

type WrathOfTheStormModalState = {
  reactionId: string;
  sourceTokenId: number;
  targetTokenId: number;
  sourceName: string;
  targetName: string;
};

type KnowledgeOfTheAgesModalState = {
  sourceTokenId: number;
  sourceCharacterId: number;
  sourceName: string;
  action: CharacterClassAction;
};

type VisionsOfThePastModalState = {
  sourceTokenId: number;
  sourceCharacterId: number;
  sourceName: string;
  action: CharacterClassAction;
  suggestedMode: "object" | "area";
  suggestedFocus: string;
};

// Get effect visual info from unified effect system
function getEffectVisual(effectKey: string): { icon: string; color: string; duration?: number } | undefined {
  const effectId = ACTION_NAME_TO_EFFECT_ID[effectKey] || effectKey;
  if (!effectId) return undefined;

  const def = getEffectDefinition(effectId);
  if (!def) return undefined;

  // Calculate duration in rounds (1 minute = 10 rounds)
  let duration: number | undefined;
  if (def.duration?.rounds) {
    duration = def.duration.rounds;
  } else if (def.duration?.minutes) {
    duration = def.duration.minutes * 10;
  }

  return {
    icon: def.visual.icon,
    color: def.visual.color,
    duration,
  };
}

function rollSimpleDice(formula: string): { total: number; rolls: number[] } | null {
  const match = String(formula || "").trim().match(/^(\d+)d(\d+)$/i);
  if (!match) return null;
  const count = Number(match[1]);
  const sides = Number(match[2]);
  if (!count || !sides) return null;

  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
  return {
    total: rolls.reduce((sum, value) => sum + value, 0),
    rolls,
  };
}

function resolveExecutionScalar(spec: any, context: { classLevel: number }): number {
  if (typeof spec === 'number') return spec;
  if (!spec || typeof spec !== 'object') return 0;
  if (spec.type === 'class_level') return context.classLevel;
  return 0;
}

function normalizeExecutionSaveAbility(value: unknown): 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma' {
  const raw = String(value || '').trim().toLowerCase();
  return EXECUTION_SAVE_ABILITY_TO_EN[raw] || 'wisdom';
}

function resolveExecutionSaveDc(
  spec: any,
  context: {
    abilityScores?: Record<string, number> | null;
    proficiencyBonus: number;
  },
): number {
  if (typeof spec === 'number' && Number.isFinite(spec)) {
    return Math.max(1, Math.floor(spec));
  }
  if (!spec || typeof spec !== 'object') {
    return 10;
  }

  const fixed = Number(spec.fixed);
  if (Number.isFinite(fixed) && fixed > 0) {
    return Math.floor(fixed);
  }

  let total = Number.isFinite(Number(spec.base)) ? Number(spec.base) : 0;
  if (spec.proficiencyBonus) {
    total += context.proficiencyBonus;
  }
  if (spec.abilityModifier) {
    const abilityKey = String(spec.abilityModifier || '').trim().toLowerCase();
    const abilityScore = Number(context.abilityScores?.[abilityKey] || 10);
    total += getAbilityModifier(abilityScore);
  }

  return Math.max(1, Math.floor(total || 10));
}

function resolveExecutionDurationRounds(
  durationSpec: unknown,
  effectDef?: EffectDefinition,
): number | undefined {
  const explicit = Number(durationSpec);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  if (effectDef?.duration?.rounds) {
    return effectDef.duration.rounds;
  }
  if (effectDef?.duration?.minutes) {
    return effectDef.duration.minutes * 10;
  }
  return undefined;
}

function resolveExecutionEffectId(effectId: unknown): string {
  const raw = String(effectId || '').trim();
  if (!raw) return '';
  return ACTION_NAME_TO_EFFECT_ID[raw] || raw;
}

function formatExecutionText(template: unknown, values: Record<string, string | number>): string {
  if (typeof template !== 'string' || !template.trim()) return '';
  return template.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ''));
}

export function TacticalMapClient({
  campaignId,
  isDM,
  selectedTool,
  showGrid,
  showFogOfWar,
  currentMapUrl,
  userId,
  selectedCharacterId,
  mapImageScale: externalMapImageScale = 1,
  mapTransform = { rotation: 0, flipH: false, flipV: false },
  onFocusMyToken,
  fogMode = "brush",
  fogBrushSize: externalFogBrushSize,
  terrainType = "difficult",
  terrainMode = "brush",
  terrainBrushSize = 1,
  showTerrainToPlayers = false,
  globalTerrain,
  rulerMode = null,
  drawTool = null,
  drawColor = "#ff0000",
  drawStrokeWidth = 2,
  onDrawStrokeWidthChange,
  markerIcon = "📍",
  markerColor = "#ef4444",
  tokenMode = "place",
  showAIMarkers = true,
  onGridUnitLengthClick,
  playerAvatars = [],
  isTransitioning = false,
  drawingsRefreshVersion = 0,
  rightSidebarWidth,
  showRightSidebar,
  isResizing,
  hotbarTargeting = null,
  onHotbarTargetSelect,
  onHotbarTargetCancel,
  onTrade,
  onStartSpellTargeting,
  timeOfDay,
}: TacticalMapProps) {
  const authedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    apiFetch(input, { ...init, userId });

  const getCharacterMovementData = useCallback((characterData: any) => {
    const speed =
      typeof characterData?.speed === "number"
        ? characterData.speed
        : calculateSpeed(characterData);
    const flySpeed =
      typeof characterData?.fly_speed === "number"
        ? characterData.fly_speed
        : calculateFlyingSpeed({ ...characterData, speed });
    return { speed, fly_speed: flySpeed };
  }, []);

  /** Aggregate all spell buff effects from a token's active_effects */
  const getSpellBuffEffects = (token: any) => {
    const r = { acBonus: 0, attackBonus: 0, damageBonus: [] as string[], speedBonus: 0, resistances: [] as string[], immunities: [] as string[], advantageOn: [] as string[], disadvantageOn: [] as string[], grantDisadvantage: [] as string[] };
    if (!token?.active_effects) return r;
    for (const e of token.active_effects) {
      if (!e.spell_buff) continue;
      const b = e.buff_effects || SPELL_BUFF_EFFECTS[e.spell_id];
      if (!b) continue;
      if (b.acBonus) r.acBonus += b.acBonus;
      if (b.attackBonus) r.attackBonus += b.attackBonus;
      if (b.damageBonus) r.damageBonus.push(b.damageBonus);
      if (b.speedBonus) r.speedBonus += b.speedBonus;
      if (b.resistances) r.resistances.push(...b.resistances);
      if (b.immunities) r.immunities.push(...b.immunities);
      if (b.advantageOn) r.advantageOn.push(...b.advantageOn);
      if (b.disadvantageOn) r.disadvantageOn.push(...b.disadvantageOn);
      if (b.grantDisadvantage) r.grantDisadvantage.push(...b.grantDisadvantage);
    }
    return r;
  };

  // Spell sound effects
  const { playCast, playHit, playFail, playEffect } = useSpellSound();

  // Attack sound effects
  const { playSwing: playAttackSwing, playHit: playAttackHit, playMiss: playAttackMiss, playCritical: playAttackCritical } = useAttackSound();

  // ==================== Toast State ====================
  const showToast = useCallback((
    message: string,
    type: 'success' | 'error' | 'info' | 'warning' = 'success',
    duration: number = 3000
  ) => {
    showGlobalToast({ message, type, duration });
  }, []);

  const fetchViewportCompanionMonsterData = useCallback(async (monsterInstanceId: number) => {
    try {
      const response = await apiFetch(`/api/monster-instances/${monsterInstanceId}`, { userId });
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      return data?.monster_data || null;
    } catch {
      return null;
    }
  }, [userId]);

  const clearReadyCast = useCallback(async (tokenId: number) => {
    const response = await authedFetch(`/api/spells/ready-cast/${tokenId}/clear`, {
      method: 'POST',
    });
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(message || '清理待释放施法状态失败');
    }
  }, [authedFetch, showToast]);
  // New universal token modal state
  const [activeTokenId, setActiveTokenId] = useState<number | null>(null);

  // Floating token panels (DM only)
  const floatingTokenPanels = useFloatingTokenPanelStore(s => s.panels);
  const openTokenPanel = useFloatingTokenPanelStore(s => s.openPanel);

  // Aura visualization state - updated via WebSocket or computed from tokens
  const [auraVisuals, setAuraVisuals] = useState<AuraVisual[]>([]);

  // Player note modal state (for player double-click on other tokens)
  const [playerNoteTokenId, setPlayerNoteTokenId] = useState<number | null>(null);
  const [illusionEditTokenId, setIllusionEditTokenId] = useState<number | null>(null);

  // Middle mouse button panning state
  const [isMiddleDragging, setIsMiddleDragging] = useState(false);
  const middleDragStartRef = useRef<{ x: number; y: number; stageX: number; stageY: number } | null>(null);

  // Track last attack we initiated (to prevent duplicate WebSocket toasts)
  const lastInitiatedAttackRef = useRef<{ attackerTokenId: number; targetTokenId: number; timestamp: number } | null>(null);
  const previousCastingStatusRef = useRef<Record<number, string | null>>({});
  const castingReadyChatNotifiedRef = useRef<Record<number, boolean>>({});

  const {
    dmBubbleMessage,
    isTouchDevice,
    rightOffset,
    setDmBubbleMessage,
  } = useMapUiChromeController({
    isResizing,
    showRightSidebar,
    rightSidebarWidth,
  });

  const [playerSpellDialog, setPlayerSpellDialog] = useState<PlayerSpellDialogState | null>(null);

  const [preserveLifeModal, setPreserveLifeModal] = useState<PreserveLifeModalState | null>(null);
  const [dampenElementsModal, setDampenElementsModal] = useState<DampenElementsModalState | null>(null);
  const [wrathOfTheStormModal, setWrathOfTheStormModal] = useState<WrathOfTheStormModalState | null>(null);
  const [sourceMonsterData, setSourceMonsterData] = useState<any>(null);
  const [sourceCharacterData, setSourceCharacterData] = useState<any>(null);
  const [companionMonsterDataMap, setCompanionMonsterDataMap] = useState<Record<number, any>>({});

  useEffect(() => {
    const unsubscribeCharacter = subscribeAppEvent("characterStatusEffectsChanged", ({
      characterId,
      statusEffects,
    }: {
      characterId?: number | string;
      statusEffects?: any;
    }) => {
      setSourceCharacterData((prev: any) => (
        prev?.id === characterId
          ? { ...prev, status_effects: statusEffects }
          : prev
      ));
    });
    const unsubscribeMonster = subscribeAppEvent("monsterStatusEffectsChanged", ({
      monsterInstanceId,
      statusEffects,
    }: {
      monsterInstanceId?: number | string;
      statusEffects?: any;
    }) => {
      setSourceMonsterData((prev: any) => (
        prev?.id === monsterInstanceId
          ? { ...prev, status_effects: statusEffects }
          : prev
      ));
    });
    return () => {
      unsubscribeCharacter();
      unsubscribeMonster();
    };
  }, []);

  const getTokenMovementSpeed = useCallback((token: Token): number => {
    const transformedSpeed = token.transformation_data?.speed;
    if (transformedSpeed) {
      return Math.max(transformedSpeed.walk || 0, transformedSpeed.fly || 0, 30);
    }

    if (token.monster_instance_id) {
      const monsterSpeed = sourceMonsterData?.speeds || sourceMonsterData?.speed;
      if (monsterSpeed) {
        if (typeof monsterSpeed === "object") {
          return monsterSpeed.walk || monsterSpeed.fly || 30;
        }
        const match = String(monsterSpeed).match(/(\d+)/);
        return match ? parseInt(match[1], 10) : 30;
      }
    }

    if (token.character_id && sourceCharacterData) {
      return getEffectiveMovementSpeed(sourceCharacterData, globalTerrain);
    }

    return 30;
  }, [sourceMonsterData, sourceCharacterData, globalTerrain]);

  // Token status effects (e.g., rage, bless, etc.)
  // Map of token_id -> array of active effects with duration tracking
  const [tokenStatusEffects, setTokenStatusEffects] = useState<Record<number, Array<{
    id: string;
    name: string;
    icon: string;
    color: string;
    duration?: number;     // Remaining rounds
    maxDuration?: number;  // Max duration in rounds
    usesRemaining?: number; // For effects that can be used a limited number of times
    metadata?: Record<string, unknown>; // Additional effect-specific data
    spell_buff?: boolean;
    spell_id?: string;
    duration_unit?: string;
    description?: string;
    from_caster?: string;
    is_concentration?: boolean;
    ongoing_save?: { timing: string; save_type: string; dc: number } | null;
    escape_action?: { type: string; ability: string; dc: number } | null;
    break_conditions?: string[] | null;
    spell_save_dc?: number | null;
    source_token_id?: number | null;
    condition?: string | null;
    armed?: boolean;
    illumination?: any;
    tokenFilter?: any;
    area_effect?: any;
    malleable?: boolean;
    [key: string]: any;
  }>>>({});

  // Pending maneuvers for Battle Master (prepared but not yet triggered)
  // Map of token_id -> pending maneuver info
  const [pendingManeuvers, setPendingManeuvers] = useState<Record<number, {
    maneuver: Maneuver;
    targetTokenId?: number;
    timestamp: number;
  } | null>>({});

  // Advantage/Disadvantage for next roll (DM granted)
  // Map of token_id -> 'advantage' | 'disadvantage' | null
  const [tokenRollModifier, setTokenRollModifier] = useState<Record<number, 'advantage' | 'disadvantage' | null>>({});

  const {
    combatActiveTokenId,
    manualReactionMode,
    setManualReactionMode,
  } = useMapCombatRuntimeController({
    campaignId,
    userId,
    showToast,
  });

  // Range confirmation modal state for out-of-range attacks
  const [rangeConfirmModal, setRangeConfirmModal] = useState<RangeConfirmModalState | null>(null);

  // Movement confirmation modal state for out-of-range movement
  const [moveConfirmModal, setMoveConfirmModal] = useState<MoveConfirmModalState | null>(null);

  // Dice rolling animation state (shown during attack API call)
  const [diceRolling, setDiceRolling] = useState<{
    visible: boolean;
    attackerName?: string;
    targetName?: string;
  }>({ visible: false });

  const [areaSpellMode, setAreaSpellMode] = useState<AreaSpellModeState | null>(null);
  const [invokeDuplicityPlacementMode, setInvokeDuplicityPlacementMode] = useState<InvokeDuplicityPlacementMode | null>(null);

  // ==================== State Management ====================
  const {
    containerRef,
    stageRef,
    saveViewStateTimerRef,
    viewStateLoadedRef,
    lastDist,
    lastCenter,
    stageSize,
    setStageSize,
    stagePos,
    setStagePos,
    stageScale,
    setStageScale,
    tokens,
    setTokens,
    editingTokenId,
    setEditingTokenId,
    editingTokenHP,
    setEditingTokenHP,
    editingTokenMaxHP,
    setEditingTokenMaxHP,
    editingParamsTokenId,
    setEditingParamsTokenId,
    itemDetailTokenId,
    setItemDetailTokenId,
    lootBagTokenId,
    setLootBagTokenId,
    selectedTokenId,
    setSelectedTokenId,
    fogBrushSize,
    setFogBrushSize,
    fogData,
    setFogData,
    terrainData,
    setTerrainData,
    rulers,
    setRulers,
    gridUnitLength,
    setGridUnitLength,
    drawings,
    setDrawings,
    markers,
    setMarkers,
    anchorPosition,
    setAnchorPosition,
    mapImage,
    setMapImage,
    mapImageLoaded,
    setMapImageLoaded,
    minimapCollapsed,
    setMinimapCollapsed,
  } = useMapState();

  useMapExternalSyncController({
    sourceCharacterData,
    setSourceCharacterData,
    setTokenRollModifier,
    isDM,
    tokens,
    selectedTokenId,
    setSelectedTokenId,
    setEditingParamsTokenId,
    setTokens,
    authedFetch,
    campaignId,
    currentMapUrl,
    showToast,
    stageSize,
    stageScale,
    setStagePos,
  });

  const {
    showAttackOutcomeFeedback,
    publishCombatAttackResult,
    publishCombatBonusAttackGranted,
    publishPromptDivineSmite,
    applyAttackHpChange,
  } = useMapAttackResultController({
    setTokens,
    setDmBubbleMessage,
  });

  const pendingStagePosRef = useRef<Position | null>(null);
  const stagePosFrameRef = useRef<number | null>(null);
  const renderedStagePos = pendingStagePosRef.current ?? stagePos;

  const getInvokeDuplicityDuplicateTokens = useCallback((sourceTokenId: number): Token[] => {
    const sourceToken = tokens.find(token => token.id === sourceTokenId);
    if (!sourceToken || !isInvokeDuplicityConcentration(sourceToken.concentration_spell)) {
      return [];
    }
    const linkedIds = getInvokeDuplicityLinkedTokenIds(sourceToken.concentration_spell);
    return linkedIds
      .map(tokenId => tokens.find(token => token.id === tokenId) || null)
      .filter((token): token is Token => Boolean(token));
  }, [tokens]);

  const getBestInvokeDuplicityOriginTokenToToken = useCallback((sourceTokenId: number, targetToken: Token): Token | null => {
    const sourceToken = tokens.find(token => token.id === sourceTokenId);
    if (!sourceToken) return null;

    const originTokens = [sourceToken, ...getInvokeDuplicityDuplicateTokens(sourceTokenId)];
    const targetSize = parseTokenSize(targetToken.token_size);
    let bestToken: Token | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const originToken of originTokens) {
      const originSize = parseTokenSize(originToken.token_size);
      const distanceFeet = getEdgeToEdgeDistance(
        originToken.position_x,
        originToken.position_y,
        originSize.width,
        originSize.height,
        targetToken.position_x,
        targetToken.position_y,
        targetSize.width,
        targetSize.height,
      ) * gridUnitLength;
      if (distanceFeet < bestDistance) {
        bestDistance = distanceFeet;
        bestToken = originToken;
      }
    }

    return Number.isFinite(bestDistance) ? bestToken : null;
  }, [tokens, gridUnitLength, getInvokeDuplicityDuplicateTokens]);

  const getBestInvokeDuplicityOriginTokenToGrid = useCallback((sourceTokenId: number, gridX: number, gridY: number): Token | null => {
    const sourceToken = tokens.find(token => token.id === sourceTokenId);
    if (!sourceToken) return null;

    const originTokens = [sourceToken, ...getInvokeDuplicityDuplicateTokens(sourceTokenId)];
    let bestToken: Token | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const originToken of originTokens) {
      const originSize = parseTokenSize(originToken.token_size);
      const distanceFeet = getEdgeToEdgeDistance(
        originToken.position_x,
        originToken.position_y,
        originSize.width,
        originSize.height,
        gridX,
        gridY,
        1,
        1,
      ) * gridUnitLength;
      if (distanceFeet < bestDistance) {
        bestDistance = distanceFeet;
        bestToken = originToken;
      }
    }

    return Number.isFinite(bestDistance) ? bestToken : null;
  }, [tokens, gridUnitLength, getInvokeDuplicityDuplicateTokens]);

  const getBestInvokeDuplicityDistanceToToken = useCallback((sourceTokenId: number, targetToken: Token): number | null => {
    const originToken = getBestInvokeDuplicityOriginTokenToToken(sourceTokenId, targetToken);
    if (!originToken) return null;
    const targetSize = parseTokenSize(targetToken.token_size);
    const originSize = parseTokenSize(originToken.token_size);
    return getEdgeToEdgeDistance(
      originToken.position_x,
      originToken.position_y,
      originSize.width,
      originSize.height,
      targetToken.position_x,
      targetToken.position_y,
      targetSize.width,
      targetSize.height,
    ) * gridUnitLength;
  }, [gridUnitLength, getBestInvokeDuplicityOriginTokenToToken]);

  const getBestInvokeDuplicityDistanceToGrid = useCallback((sourceTokenId: number, gridX: number, gridY: number): number | null => {
    const originToken = getBestInvokeDuplicityOriginTokenToGrid(sourceTokenId, gridX, gridY);
    if (!originToken) return null;

    const originSize = parseTokenSize(originToken.token_size);
    return getEdgeToEdgeDistance(
      originToken.position_x,
      originToken.position_y,
      originSize.width,
      originSize.height,
      gridX,
      gridY,
      1,
      1,
    ) * gridUnitLength;
  }, [gridUnitLength, getBestInvokeDuplicityOriginTokenToGrid]);

  const stagePosRef = useRef<Position>(renderedStagePos);
  stagePosRef.current = renderedStagePos;

  const stageScaleRef = useRef(stageScale);
  stageScaleRef.current = stageScale;

  const applyStagePosState = useCallback((nextPos: Position) => {
    setStagePos((prev) => (prev.x === nextPos.x && prev.y === nextPos.y ? prev : nextPos));
  }, [setStagePos]);

  const scheduleStagePosSync = useCallback((nextPos: Position, immediate: boolean = false) => {
    stagePosRef.current = nextPos;

    if (immediate) {
      pendingStagePosRef.current = null;
      if (stagePosFrameRef.current !== null) {
        cancelAnimationFrame(stagePosFrameRef.current);
        stagePosFrameRef.current = null;
      }
      applyStagePosState(nextPos);
      return;
    }

    pendingStagePosRef.current = nextPos;
    if (stagePosFrameRef.current !== null) return;

    stagePosFrameRef.current = requestAnimationFrame(() => {
      stagePosFrameRef.current = null;
      const pendingPos = pendingStagePosRef.current;
      pendingStagePosRef.current = null;
      if (!pendingPos) return;
      applyStagePosState(pendingPos);
    });
  }, [applyStagePosState]);

  useEffect(() => {
    return () => {
      if (stagePosFrameRef.current !== null) {
        cancelAnimationFrame(stagePosFrameRef.current);
      }
    };
  }, []);

  // Terrain manager ref
  const terrainManagerRef = useRef(new TerrainManager(currentMapUrl || ""));

  // For players: terrain visibility controlled by WS from DM. For DM: always from prop.
  const [localShowTerrain, setLocalShowTerrain] = useState(showTerrainToPlayers);
  useEffect(() => { setLocalShowTerrain(showTerrainToPlayers); }, [showTerrainToPlayers]);
  const terrainVisible = isDM || localShowTerrain;

  // Sync terrain manager when terrainData changes (from server or WS)
  useEffect(() => {
    if (terrainData) {
      terrainManagerRef.current.loadData(terrainData);
      terrainManagerRef.current.setMapUrl(terrainData.mapUrl);
    } else {
      terrainManagerRef.current.clearAll();
    }
  }, [terrainData]);

  // Update terrain manager map URL on map change
  useEffect(() => {
    if (currentMapUrl) {
      terrainManagerRef.current.setMapUrl(currentMapUrl);
    }
  }, [currentMapUrl]);

  const mapImageScale = externalMapImageScale;

  // Character switching loading state - prevents Konva race conditions
  // IMPORTANT: Must detect change synchronously during render, not in useEffect
  // because useEffect runs AFTER render, causing Konva crash on first render
  // Initialize to null so that when TacticalMap remounts (due to key change),
  // the first render always detects a "change" and blocks Stage rendering
  const prevCharacterIdRef = useRef<number | null>(null);
  const transitionEndTimeRef = useRef<number>(0);
  const [, forceRenderUpdate] = useState(0);

  // Synchronously detect ANY character change during render phase
  // This catches both: switching to a new character AND intermediate null states
  const effectiveCharacterId = selectedCharacterId ?? null;
  const characterJustChanged = prevCharacterIdRef.current !== effectiveCharacterId;
  if (characterJustChanged) {
    prevCharacterIdRef.current = effectiveCharacterId;
    // Only start transition timer when switching to a valid character
    if (selectedCharacterId) {
      transitionEndTimeRef.current = Date.now() + 500; // 500ms transition period
    }
  }

  // Block Stage rendering when:
  // 1. During transition period (just switched to a new character)
  // Note: Removed "player mode without character" condition to allow spectator mode
  // where players can view the map without selecting a character
  const isCharacterSwitching = Date.now() < transitionEndTimeRef.current;

  // Schedule force update when transition ends to re-enable Stage rendering
  useEffect(() => {
    if (isCharacterSwitching) {
      const remaining = transitionEndTimeRef.current - Date.now();
      if (remaining > 0) {
        const timer = setTimeout(() => forceRenderUpdate(n => n + 1), remaining + 50);
        return () => clearTimeout(timer);
      }
    }
  }, [isCharacterSwitching]);

  const {
    controlledCharacterIds,
    obscurementZones,
    playerCompanions,
    viewportBounds,
    visibleTokens,
    zoomControlPlayerAvatars,
  } = useMapViewportController({
    stagePos,
    stageScale,
    stageSize,
    tokens,
    isDM,
    userId,
    selectedCharacterId,
    currentMapUrl,
    currentWorldTime: timeOfDay,
    gridUnitLength,
    spellsData,
    playerAvatars,
    companionMonsterDataMap,
    setCompanionMonsterDataMap,
    fetchMonsterInstance: fetchViewportCompanionMonsterData,
  });

  const {
    campaignItems,
    chestManageChest,
    chestManageModalOpen,
    chestModalChest,
    chestModalOpen,
    clearInteractionMenus,
    contextMenu,
    handleChestManageModalOpenChange,
    handleChestModalOpenChange,
    handleContextMenu,
    handleShopTxnOpenChange,
    handleTouchEndForContextMenu,
    handleTouchMoveForContextMenu,
    handleTouchStart,
    loadSourceTokenData,
    longPressIndicator,
    longPressTriggeredRef,
    mobileActionModal,
    monsters,
    npcs,
    playerAbilities,
    playerContextMenu,
    playerReactions,
    playerSpellData,
    selectionContextMenu,
    setChestModalChest,
    setChestModalOpen,
    setContextMenu,
    setMobileActionModal,
    setPlayerContextMenu,
    setPlayerReactions,
    setSelectionContextMenu,
    setShopTokenModalId,
    setTokenContextMenu,
    shopTokenModalId,
    shops,
    shopTxnOpen,
    shopTxnShop,
    shopTxnTokenId,
    targetChestData,
    tokenContextMenu,
  } = useMapInteractionController({
    isDM,
    campaignId,
    userId,
    selectedCharacterId,
    selectedTokenId,
    tokens,
    controlledCharacterIds,
    containerRef,
    stagePos,
    stageScale,
    stagePosRef,
    stageScaleRef,
    authedFetch,
    getCharacterMovementData,
    showToast,
    openTokenPanel,
    areaSpellMode,
    hotbarTargeting,
    invokeDuplicityPlacementMode,
    manualReactionMode,
    sourceCharacterData,
    setSourceMonsterData,
    setSourceCharacterData,
  });

  const {
    attackDistanceLine,
    monsterActionCursorInfo,
    monsterActionTargeting,
    movementOverlayCells,
    setMonsterActionTargeting,
  } = useMapCombatOverlays({
    isDM,
    userId,
    selectedTokenId,
    selectionContextMenuOpen: !!selectionContextMenu,
    tokens,
    gridUnitLength,
    containerRef,
    stagePosRef,
    stageScaleRef,
    showToast,
  });

  // Initialize tokenStatusEffects from loaded tokens (persisted active_effects)
  useEffect(() => {
    // Only initialize from tokens if we don't have local state yet
    // This prevents overwriting locally added effects before they're synced
    setTokenStatusEffects(prev => {
      const newEffectsMap: Record<number, Array<{ id: string; name: string; icon: string; color: string; duration?: number; maxDuration?: number }>> = {};

      for (const token of tokens) {
        if (token.active_effects && token.active_effects.length > 0) {
          // Default visuals for D&D 5E conditions
          const conditionVisuals: Record<string, { icon: string; color: string }> = {
            'paralyzed': { icon: '😵', color: '#dc2626' },
            'restrained': { icon: '🕸️', color: '#92400e' },
            'frightened': { icon: '😨', color: '#7c3aed' },
            'charmed': { icon: '💕', color: '#ec4899' },
            'unconscious': { icon: '💤', color: '#1e40af' },
            'incapacitated': { icon: '🚫', color: '#6b7280' },
            'blinded': { icon: '🙈', color: '#374151' },
            'deafened': { icon: '🙉', color: '#374151' },
            'poisoned': { icon: '🤢', color: '#16a34a' },
            'stunned': { icon: '⚡', color: '#eab308' },
            'petrified': { icon: '🗿', color: '#78716c' },
            'prone': { icon: '⬇️', color: '#92400e' },
            'grappled': { icon: '🤝', color: '#d97706' },
            'confused': { icon: '🌀', color: '#f59e0b' },
          };
          // Convert effects to visual format
          const visualEffects = token.active_effects.map((effect: any) => {
            if (effect.icon && effect.color) return effect;
            const conditionId = effect.condition || effect.id;
            const effectDef = getEffectDefinition(conditionId);
            if (effectDef?.visual) {
              return { ...effect, icon: effectDef.visual.icon || '❓', color: effectDef.visual.color || '#6b7280', ...(!effect.spell_id && effectDef.spell_id ? { spell_id: effectDef.spell_id } : {}) };
            }
            const visual = conditionVisuals[effect.condition] || { icon: '❓', color: '#6b7280' };
            return { ...effect, icon: visual.icon, color: visual.color };
          });
          newEffectsMap[token.id] = visualEffects;
        } else if (token.active_effects === undefined && prev[token.id] && prev[token.id].length > 0) {
          // Preserve locally added effects only if server hasn't sent active_effects yet
          // If active_effects is null or [] (empty), server cleared them — don't preserve
          newEffectsMap[token.id] = prev[token.id];
        }
      }

      return newEffectsMap;
    });
  }, [tokens]);

  // Compute auraVisuals from tokens when tokens change (for initial load and local updates)
  useEffect(() => {
    // Find tokens with active auras
    const auraSources = tokens.filter(t => t.active_auras && t.active_auras.length > 0);
    if (auraSources.length === 0) {
      if (auraVisuals.length > 0) setAuraVisuals([]);
      return;
    }

    // Calculate distance between two tokens (grid-based, in feet)
    const calcDistance = (t1: Token, t2: Token): number => {
      const parseSize = (s?: string) => { const p = (s || '1x1').split('x'); return [parseInt(p[0]) || 1, parseInt(p[1] || p[0]) || 1]; };
      const [w1, h1] = parseSize(t1.token_size);
      const [w2, h2] = parseSize(t2.token_size);
      const c1x = t1.position_x + w1 / 2, c1y = t1.position_y + h1 / 2;
      const c2x = t2.position_x + w2 / 2, c2y = t2.position_y + h2 / 2;
      return Math.max(Math.abs(c1x - c2x), Math.abs(c1y - c2y)) * 5; // 5 feet per grid
    };

    const newAuraVisuals: AuraVisual[] = [];
    for (const source of auraSources) {
      for (const aura of source.active_auras!) {
        if (!aura?.enabled) continue;
        const presentation = getAuraPresentation(aura);
        const radius = aura.radius || 10;
        // Find affected tokens (within range, character/monster only)
        const affected = tokens.filter(t =>
          (t.character_id || t.monster_instance_id) &&
          calcDistance(source, t) <= radius
        );
        newAuraVisuals.push({
          source_token_id: source.id,
          aura_id: aura.id,
          aura_name: presentation.name,
          radius,
          color: presentation.color,
          fill_color: presentation.fillColor,
          icon: presentation.icon,
          description: presentation.description,
          affected_token_ids: affected.map(t => t.id),
          source_cha_mod: aura.source_cha_mod,
          source_effect_id: aura.source_effect_id,
          applies_conditions: aura.applies_conditions,
        });
      }
    }
    setAuraVisuals(newAuraVisuals);
  }, [tokens]);

  // ==================== WebSocket ====================
  const { isConnected, sendMessage } = useMapWebSocket({
    campaignId,
    userId,
    isDM,
    currentMapUrl,
    setTokens,
    setFogData,
    setTerrainData,
    setShowTerrainToPlayers: setLocalShowTerrain,
    setRulers,
    setDrawings,
    setMarkers,
    setAuraVisuals,
    setGridUnitLength,
    setAnchorPosition,
    onCombatResult: (data: CombatAttackData) => {
      const { attacker_token_id, result } = data;

      // Check if this is an attack we just initiated (within 5 seconds)
      // to avoid showing duplicate toast/bubble
      const lastAttack = lastInitiatedAttackRef.current;
      const now = Date.now();
      if (lastAttack && (now - lastAttack.timestamp) < 5000) {
        // Skip toast/bubble for our own attack
        logger.debug('[Combat Result via WS] Skipping duplicate for own attack');
        return;
      }

      // Show the narrative as a toast (other players/DM will see this)
      const toastType = result.hit ? (result.critical ? 'success' : 'info') : 'warning';
      showToast(result.narrative, toastType, 5000);

      // Show bubble on attacker's avatar
      const attackerToken = tokens.find(t => t.id === attacker_token_id);
      if (attackerToken) {
        showAttackOutcomeFeedback({
          sourceToken: attackerToken,
          attackerName: result.attacker_name,
          targetName: result.target_name,
          result,
        });
      }

      logger.info('[Combat Result via WS]', { attacker: result.attacker_name, target: result.target_name, hit: result.hit });
    },
  });

  useMapForcedMovementConsumer({
    isDM,
    tokens,
    gridUnitLength,
    authedFetch,
    setTokens,
  });

  useEffect(() => {
    const previousStatuses = previousCastingStatusRef.current;
    const nextStatuses: Record<number, string | null> = {};
    const nextChatNotified = { ...castingReadyChatNotifiedRef.current };

    for (const token of tokens) {
      const casting = token.casting_in_progress;
      const currentStatus = casting?.status || null;
      const previousStatus = previousStatuses[token.id] ?? null;
      nextStatuses[token.id] = currentStatus;

      if (!casting) {
        delete nextChatNotified[token.id];
        continue;
      }

      if (currentStatus !== 'ready') {
        nextChatNotified[token.id] = false;
        continue;
      }

      if (previousStatus === null) {
        continue;
      }

      if (previousStatus !== 'ready') {
        const tokenName = token.instance_name || token.character_name || token.monster_name || '施法者';
        const spellName = casting.spell_name || '法术';
        const toastMessage = `⏳ ${tokenName} 的「${spellName}」已准备完成，等待释放`;
        const canManageCasting = isDM || (!!userId && (
          token.user_id === userId || casting.started_by_user_id === userId
        ));

        if (canManageCasting) {
          showToast(toastMessage, 'info', 5000);
        }

        if (isDM && !nextChatNotified[token.id]) {
          publishAppEvent("spellCastChat", {
            message: `⏳ 【${tokenName}】的【${spellName}】已准备完成，请选择释放区域或目标。`,
          });
          nextChatNotified[token.id] = true;
        }
      }
    }

    previousCastingStatusRef.current = nextStatuses;
    castingReadyChatNotifiedRef.current = nextChatNotified;
  }, [isDM, showToast, tokens, userId]);

  // ESC key to cancel selection (RTS-style)
  useEffect(() => {
    if (!isDM) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedTokenId) {
        setSelectedTokenId(null);
        setSelectionContextMenu(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDM, selectedTokenId, setSelectedTokenId]);

  // Clear selection if selected token no longer exists
  useEffect(() => {
    if (selectedTokenId && !tokens.find(t => t.id === selectedTokenId)) {
      setSelectedTokenId(null);
    }
  }, [tokens, selectedTokenId, setSelectedTokenId]);

  // ==================== Data Loading ====================
  useMapData({
    campaignId,
    currentMapUrl,
    userId,
    selectedCharacterId,
    isDM,
    drawingsRefreshVersion,
    setTokens,
    setFogData,
    setTerrainData,
    setRulers,
    setDrawings,
    setMarkers,
    setMapImage,
    setMapImageLoaded,
    setGridUnitLength,
    setAnchorPosition,
    setStagePos,
    setStageScale,
    setMinimapCollapsed,
    viewStateLoadedRef,
  });

  const {
    handleMoveCancel,
    handleMoveConfirm,
    handleMoveSpellArea,
    handleSelectionMoveTo,
  } = useMapMovementRuntimeController({
    authedFetch,
    campaignId,
    currentMapUrl,
    gridUnitLength,
    combatActiveTokenId,
    moveConfirmModal,
    tokens,
    sourceCharacterData,
    showToast,
    sendMessage,
    setTokens,
    setMoveConfirmModal,
    setSourceCharacterData,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
    getTokenMovementSpeed,
  });

  // ==================== Zone Spell Settlement Modal State ====================
  const [zoneSpellSettlementOpen, setZoneSpellSettlementOpen] = useState(false);
  const [zoneSpellSettlementCasterId, setZoneSpellSettlementCasterId] = useState<number | undefined>();
  const [knowledgeOfTheAgesModal, setKnowledgeOfTheAgesModal] = useState<KnowledgeOfTheAgesModalState | null>(null);
  const [visionsOfThePastModal, setVisionsOfThePastModal] = useState<VisionsOfThePastModalState | null>(null);
  const [invokeDuplicityModal, setInvokeDuplicityModal] = useState<InvokeDuplicityModalState | null>(null);
  const [toolCheckRequest, setToolCheckRequest] = useState<PendingToolCheckRequest | null>(null);

  const consumeCharacterResource = useCallback(async (
    characterId: number,
    resourceId: string,
    action: any,
    failureLabel: string,
  ) => {
    try {
      const resp = await authedFetch(`/api/characters/${characterId}/resources/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource_id: resourceId,
          amount: 1,
          campaign_id: parseInt(campaignId, 10),
        }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        showToast(errData.detail || `使用 ${failureLabel} 失败`, 'error');
        return null;
      }

      const result = await resp.json();
      setSourceCharacterData((prev: any) => {
        if (!prev?.actions) return prev;
        return {
          ...prev,
          actions: prev.actions.map((actionItem: any) =>
            (
              actionItem.id === action?.id
              || actionItem.id === resourceId
              || actionItem.resourceId === resourceId
            ) && actionItem.uses
              ? {
                  ...actionItem,
                  uses: {
                    ...actionItem.uses,
                    current: result.current,
                    max: result.max ?? actionItem.uses.max,
                  },
                }
              : actionItem
          )
        };
      });

      return result as { current: number; max: number };
    } catch (err) {
      logger.error('[Action] Failed to use resource:', err);
      showToast(`使用 ${failureLabel} 失败`, 'error');
      return null;
    }
  }, [authedFetch, campaignId, showToast]);

  const {
    openInvokeDuplicityModal,
    handleInvokeDuplicityModalConfirm,
    handleInvokeDuplicityPlacementCancel,
    handleInvokeDuplicityPlacementUndo,
    handleInvokeDuplicityPlacementMouseMove,
    handleInvokeDuplicityPlacementConfirm,
    handleInvokeDuplicityCreate,
  } = useMapInvokeDuplicityController({
    sourceCharacterData,
    tokens,
    campaignId,
    currentMapUrl,
    userId,
    gridUnitLength,
    invokeDuplicityModal,
    setInvokeDuplicityModal,
    invokeDuplicityPlacementMode,
    setInvokeDuplicityPlacementMode,
    authedFetch,
    showToast,
    sendMessage,
    setTokens,
    consumeCharacterResource,
    setConcentrationOnTokenFn: setConcentrationOnToken,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
  });

  const {
    transformModalOpen,
    setTransformModalOpen,
    transformTokenId,
    setTransformTokenId,
    transformConfigId,
    transformTokenIdRef,
    handleTransform,
    handleWildShape,
    handleTransformComplete,
    handleEndTransformation,
    handleEndWildShape,
  } = useMapTransformationController({
    tokens,
    sourceCharacterData,
    campaignId,
    authedFetch,
    showToast,
    sendMessage,
    setTokens,
    setSourceCharacterData,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
  });

  const {
    handleOpenToolCheck,
    handleSubmitToolCheck,
    openPreserveLifeModal,
    openKnowledgeOfTheAgesModal,
    openVisionsOfThePastModal,
    handlePreserveLifeConfirm,
    handleKnowledgeOfTheAgesConfirm,
    handleVisionsOfThePastConfirm,
  } = useMapSupportActionController({
    tokens,
    sourceCharacterData,
    campaignId,
    currentMapUrl,
    gridUnitLength,
    isConnected,
    authedFetch,
    showToast,
    sendMessage,
    setTokens,
    setSourceCharacterData,
    preserveLifeModal,
    setPreserveLifeModal,
    knowledgeOfTheAgesModal,
    setKnowledgeOfTheAgesModal,
    visionsOfThePastModal,
    setVisionsOfThePastModal,
    setToolCheckRequest,
    consumeCharacterResource,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
  });

  const {
    handleConditionSave,
    handleContestedCheck,
    handleEscapeAttempt,
    handleOngoingSave,
    handleSelectionStandardAction,
    handleStandUp,
    handleWakeUp,
  } = useMapSelectionActionController({
    authedFetch,
    campaignId,
    userId,
    isDM,
    tokens,
    tokenStatusEffects,
    sourceCharacterData,
    showToast,
    sendMessage,
    setTokenStatusEffects,
    setTokens,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
  });

  const persistTokenActiveEffects = useCallback(async (tokenId: number, newEffects: any[]) => {
    setTokenStatusEffects(prev => ({
      ...prev,
      [tokenId]: newEffects
    }));
    setTokens(prev => prev.map(token =>
      token.id === tokenId
        ? { ...token, active_effects: newEffects.length > 0 ? newEffects : null }
        : token
    ));
    await authedFetch(`/api/tokens/${tokenId}/active-effects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active_effects: newEffects }),
    });
  }, [authedFetch, setTokens]);

  const {
    handleWardingFlareAction,
    handleDampenElementsAction,
    handleWrathOfTheStormAction,
    handleGuidedStrikeAction,
    handleWarGodsBlessingAction,
    handleDestructiveWrathAction,
  } = useMapClericDomainActionController({
    tokens,
    tokenStatusEffects,
    sourceCharacterData,
    gridUnitLength,
    showToast,
    sendMessage,
    persistTokenActiveEffects,
    consumeCharacterResource,
    setDampenElementsModal,
    setWrathOfTheStormModal,
    setManualReactionMode,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
    isWardingFlareDefenseEffect,
    isPendingDamageResistanceEffect,
    isWarDomainAttackBonusEffect,
    isDestructiveWrathPendingEffect,
  });

  const consumePendingIncomingAttackDisadvantage = useCallback(async (protectedTokenId?: number | null) => {
    if (!protectedTokenId) return;
    const currentEffects = tokenStatusEffects[protectedTokenId] || [];
    if (!currentEffects.some(effect => isWardingFlareDefenseEffect(effect))) {
      return;
    }

    const updatedEffects = currentEffects.filter(effect => !isWardingFlareDefenseEffect(effect));
    try {
      await persistTokenActiveEffects(protectedTokenId, updatedEffects);
    } catch (err) {
      logger.error('[Attack] Failed to consume Warding Flare effect:', err);
    }
  }, [tokenStatusEffects, persistTokenActiveEffects]);

  const consumePendingDestructiveWrath = useCallback(async (
    sourceTokenId: number,
    sourceName: string,
    damageType?: unknown,
  ) => {
    const currentEffects = tokenStatusEffects[sourceTokenId] || [];
    if (!currentEffects.some(effect => isDestructiveWrathPendingEffect(effect))) {
      return false;
    }

    const updatedEffects = currentEffects.filter(effect => !isDestructiveWrathPendingEffect(effect));
    try {
      await persistTokenActiveEffects(sourceTokenId, updatedEffects);
      const damageTypeKey = normalizeTempestDamageType(damageType);
      const damageLabel = damageTypeKey ? TEMPEST_DAMAGE_LABEL[damageTypeKey] : '闪电或雷鸣';
      sendMessage({
        type: 'chat',
        data: {
          message: `🌩️ **${sourceName}** 引动【破坏之怒通道】！\n> 本次 **${damageLabel}** 伤害骰取最大值。`,
          message_type: 'combat',
        },
      });
      showToast(`${sourceName} 的破坏之怒已触发`, 'success');
      return true;
    } catch (err) {
      logger.error('[Action] Failed to consume Destructive Wrath effect:', err);
      return false;
    }
  }, [tokenStatusEffects, persistTokenActiveEffects, sendMessage, showToast]);

  const buildSavingThrowTargetData = useCallback(async (
    targetToken: Token,
    saveType: 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma',
  ) => {
    const defaultAbilityScores = {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    };
    let abilityScores = defaultAbilityScores;
    let level = targetToken.character_level || 1;
    let classId: string | null = null;
    let proficiencyBonus = getProficiencyBonus(level);
    let savingThrowOverride: number | null = null;
    let currentHp = targetToken.current_hp ?? null;
    let maxHp = targetToken.max_hp ?? null;

    if (targetToken.character_id) {
      const resp = await authedFetch(`/api/characters/${targetToken.character_id}/sheet`);
      if (!resp.ok) {
        throw new Error('读取目标角色数据失败');
      }
      const data = await resp.json();
      const character = data?.character;
      if (character) {
        abilityScores = {
          ...defaultAbilityScores,
          ...(character.abilities || {}),
        };
        level = Number(character.level || level || 1);
        classId = character.class_id || null;
        proficiencyBonus = getProficiencyBonus(level);
        currentHp = currentHp ?? character.current_hp ?? null;
        maxHp = maxHp ?? character.max_hp ?? null;
      }
    } else if (targetToken.monster_instance_id) {
      const resp = await authedFetch(`/api/monster-instances/${targetToken.monster_instance_id}`);
      if (!resp.ok) {
        throw new Error('读取目标怪物数据失败');
      }
      const monsterInstance = await resp.json();
      const monsterData = monsterInstance?.monster_data || monsterInstance || {};
      abilityScores = {
        ...defaultAbilityScores,
        ...getMonsterAbilityScores(monsterData),
      };
      savingThrowOverride = getMonsterSavingThrowOverride(monsterData, saveType);
      currentHp = currentHp ?? monsterInstance.current_hp ?? null;
      maxHp = maxHp ?? monsterInstance.max_hp ?? null;
    }

    return {
      name: targetToken.instance_name || targetToken.character_name || targetToken.monster_name || '目标',
      token_id: targetToken.id,
      character_id: targetToken.character_id || null,
      monster_instance_id: targetToken.monster_instance_id || null,
      ability_scores: abilityScores,
      level,
      class_id: classId,
      proficiency_bonus: proficiencyBonus,
      saving_throw_override: savingThrowOverride,
      current_hp: currentHp,
      max_hp: maxHp,
    };
  }, [authedFetch]);

  const { handleTargetSaveEffect } = useMapTargetSaveEffectController({
    tokens,
    tokenStatusEffects,
    sourceCharacterData,
    campaignId,
    gridUnitLength,
    authedFetch,
    showToast,
    sendMessage,
    persistTokenActiveEffects,
    buildSavingThrowTargetData,
    getEffectDefinitionFn: getEffectDefinition,
    normalizeExecutionSaveAbility,
    resolveExecutionSaveDc,
    resolveExecutionDurationRounds,
    resolveExecutionEffectId,
    formatExecutionText,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
  });

  const upsertBlessingOfTheTricksterStatus = useCallback(async (
    characterId: number,
    sourceCharacterId: number,
    sourceName: string,
    apply: boolean,
  ) => {
    const charResp = await authedFetch(`/api/characters/${characterId}`);
    if (!charResp.ok) {
      throw new Error('加载角色状态失败');
    }

    const charData = await charResp.json();
    const currentStatus = { ...(charData.status_effects || {}) } as any;
    const currentCustomEffects = Array.isArray(currentStatus.custom_effects) ? currentStatus.custom_effects : [];
    const filteredCustomEffects = currentCustomEffects.filter((effect: any) =>
      !isBlessingOfTheTricksterEffect(effect, sourceCharacterId)
    );

    const nextCustomEffects = apply
      ? [
          ...filteredCustomEffects,
          {
            id: `${BLESSING_OF_THE_TRICKSTER_EFFECT_PREFIX}${sourceCharacterId}`,
            name: '诡术祝福',
            modifiers: [{ param: 'stealth', value: 0, type: 'advantage' }],
            duration: { type: 'hours', value: 1, remaining: BLESSING_OF_THE_TRICKSTER_DURATION_ROUNDS, v: 2 },
            source_feature_id: 'blessing_of_the_trickster',
            source_character_id: sourceCharacterId,
            source_name: sourceName,
          }
        ]
      : filteredCustomEffects;

    const nextStatus = {
      ...currentStatus,
      custom_effects: nextCustomEffects,
      active_conditions: Array.isArray(currentStatus.active_conditions) ? currentStatus.active_conditions : [],
      exhaustion_level: typeof currentStatus.exhaustion_level === 'number' ? currentStatus.exhaustion_level : 0,
      special_buffs: currentStatus.special_buffs || {},
    };

    const updateResp = await authedFetch(`/api/characters/${characterId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status_effects: nextStatus,
        broadcast_campaign_id: campaignId,
      }),
    });
    if (!updateResp.ok) {
      throw new Error('保存角色状态失败');
    }
  }, [authedFetch, campaignId]);

  const upsertCloakOfShadowsCondition = useCallback(async (
    characterId: number,
    apply: boolean,
  ) => {
    const charResp = await authedFetch(`/api/characters/${characterId}`);
    if (!charResp.ok) {
      throw new Error('加载角色状态失败');
    }

    const charData = await charResp.json();
    const currentStatus = { ...(charData.status_effects || {}) } as any;
    const currentConditions = Array.isArray(currentStatus.active_conditions) ? currentStatus.active_conditions : [];
    const filteredConditions = currentConditions.filter((condition: any) => !(
      (condition?.condition || condition) === 'invisible'
      && (
        condition?.source?.name === CLOAK_OF_SHADOWS_SOURCE_NAME
        || condition?.source_feature_id === 'cloak_of_shadows'
      )
    ));

    const nextConditions = apply
      ? [
          ...filteredConditions,
          {
            condition: 'invisible',
            duration: { type: 'rounds', value: CLOAK_OF_SHADOWS_DURATION_ROUNDS, remaining: CLOAK_OF_SHADOWS_DURATION_ROUNDS, v: 2 },
            source: { type: 'ability', name: CLOAK_OF_SHADOWS_SOURCE_NAME },
            removal: { type: 'duration', description: '你的下一回合结束，或当你进行攻击/施放法术时结束。' },
            source_feature_id: 'cloak_of_shadows',
          },
        ]
      : filteredConditions;

    const nextStatus = {
      ...currentStatus,
      custom_effects: Array.isArray(currentStatus.custom_effects) ? currentStatus.custom_effects : [],
      active_conditions: nextConditions,
      exhaustion_level: typeof currentStatus.exhaustion_level === 'number' ? currentStatus.exhaustion_level : 0,
      special_buffs: currentStatus.special_buffs || {},
    };

    const updateResp = await authedFetch(`/api/characters/${characterId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status_effects: nextStatus,
        broadcast_campaign_id: campaignId,
      }),
    });
    if (!updateResp.ok) {
      throw new Error('保存角色状态失败');
    }
  }, [authedFetch, campaignId]);

  const applyCharacterStatusDelta = useCallback(async (
    characterId: number,
    statusDelta?: Record<string, any> | null,
  ) => {
    if (!statusDelta || typeof statusDelta !== 'object') {
      return null;
    }

    const exhaustionLevelDelta = Number(statusDelta.exhaustionLevelDelta || 0);
    if (!Number.isFinite(exhaustionLevelDelta) || exhaustionLevelDelta === 0) {
      return null;
    }

    const charResp = await authedFetch(`/api/characters/${characterId}`);
    if (!charResp.ok) {
      throw new Error('加载角色状态失败');
    }

    const charData = await charResp.json();
    const currentStatus = { ...(charData.status_effects || {}) } as any;
    const currentExhaustion = typeof currentStatus.exhaustion_level === 'number'
      ? currentStatus.exhaustion_level
      : 0;
    const nextStatus = {
      ...currentStatus,
      custom_effects: Array.isArray(currentStatus.custom_effects) ? currentStatus.custom_effects : [],
      active_conditions: Array.isArray(currentStatus.active_conditions) ? currentStatus.active_conditions : [],
      exhaustion_level: Math.max(0, Math.min(6, currentExhaustion + exhaustionLevelDelta)),
      special_buffs: currentStatus.special_buffs || {},
    };

    const updateResp = await authedFetch(`/api/characters/${characterId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status_effects: nextStatus,
        broadcast_campaign_id: campaignId,
      }),
    });
    if (!updateResp.ok) {
      throw new Error('保存角色状态失败');
    }

    setSourceCharacterData((prev: any) => (
      prev?.id === characterId
        ? { ...prev, status_effects: nextStatus }
        : prev
    ));

    return nextStatus;
  }, [authedFetch, campaignId]);

  const clearCloakOfShadowsEffect = useCallback(async (
    tokenId: number,
    reason: 'attack' | 'spell' | 'turn_end' | 'manual',
  ): Promise<boolean> => {
    const token = tokens.find(candidate => candidate.id === tokenId);
    if (!token) return false;

    const currentEffects = tokenStatusEffects[tokenId] || token.active_effects || [];
    if (!currentEffects.some(effect => isCloakOfShadowsEffect(effect))) {
      return false;
    }

    try {
      const nextEffects = currentEffects.filter(effect => !isCloakOfShadowsEffect(effect));
      await persistTokenActiveEffects(tokenId, nextEffects);
      if (token.character_id) {
        await upsertCloakOfShadowsCondition(token.character_id, false);
      }

      const tokenName = token.instance_name || token.character_name || token.monster_name || '目标';
      if (reason === 'attack') {
        showToast(`${tokenName} 的诡术斗篷因攻击而结束`, 'info');
      } else if (reason === 'spell') {
        showToast(`${tokenName} 的诡术斗篷因施法而结束`, 'info');
      } else if (reason === 'turn_end') {
        showToast(`${tokenName} 的诡术斗篷已结束`, 'info');
      }
      return true;
    } catch (err) {
      logger.error('[Action] Failed to clear Cloak of Shadows:', err);
      return false;
    }
  }, [tokens, tokenStatusEffects, persistTokenActiveEffects, upsertCloakOfShadowsCondition, showToast]);

  const {
    handleCloakOfShadowsAction,
    handleBlessingOfTheTricksterAction,
    handleRadianceOfTheDawnAction,
    handleCoronaOfLightAction,
  } = useMapTrickeryLightActionController({
    tokens,
    tokenStatusEffects,
    sourceCharacterData,
    campaignId,
    gridUnitLength,
    authedFetch,
    showToast,
    sendMessage,
    setTokens,
    setTokenStatusEffects,
    setSourceCharacterData,
    persistTokenActiveEffects,
    consumeCharacterResource,
    upsertBlessingOfTheTricksterStatus,
    upsertCloakOfShadowsCondition,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
    isCloakOfShadowsEffect,
    isBlessingOfTheTricksterEffect,
  });

  const { handleReadThoughtsAction } = useMapReadThoughtsActionController({
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
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
  });

  const {
    handleCharmAnimalsAndPlantsAction,
    handleMasterOfNatureAction,
    handleTurnUndeadAction,
  } = useMapChannelDivinityActionController({
    tokens,
    tokenStatusEffects,
    sourceCharacterData,
    campaignId,
    authedFetch,
    showToast,
    sendMessage,
    setTokens,
    setSourceCharacterData,
    persistTokenActiveEffects,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
  });

  const {
    handleInstantSelfHealAction,
    handleBardicInspirationAction,
  } = useMapBonusUtilityActionController({
    tokens,
    tokenStatusEffects,
    sourceCharacterData,
    campaignId,
    authedFetch,
    showToast,
    sendMessage,
    setTokens,
    setSourceCharacterData,
    persistTokenActiveEffects,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
    rollSimpleDice,
    resolveExecutionScalar,
  });

  const { handleGenericBonusActionActivation } = useMapBonusActionActivationController({
    campaignId,
    authedFetch,
    showToast,
    sendMessage,
    setSourceCharacterData,
    persistTokenActiveEffects,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
    clearManualReactionMode: () => setManualReactionMode(null),
    handleInstantSelfHealAction,
    handleBardicInspirationAction,
  });

  const { handleBonusActionRoute } = useMapBonusActionRoutingController({
    sourceCharacterData,
    showToast,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
    handleTransform,
    handleTargetSaveEffect,
    openPreserveLifeModal,
    openInvokeDuplicityModal,
    handleWardingFlareAction,
    handleDampenElementsAction,
    handleWrathOfTheStormAction,
    handleGuidedStrikeAction,
    handleWarGodsBlessingAction,
    handleDestructiveWrathAction,
    openKnowledgeOfTheAgesModal,
    openVisionsOfThePastModal,
    handleReadThoughtsAction,
    handleCharmAnimalsAndPlantsAction,
    handleMasterOfNatureAction,
    handleTurnUndeadAction,
    handleCloakOfShadowsAction,
    handleBlessingOfTheTricksterAction,
    handleRadianceOfTheDawnAction,
    handleCoronaOfLightAction,
    knowledgeOfTheAgesFeatureId: KNOWLEDGE_OF_THE_AGES_FEATURE_ID,
  });

  const {
    handleEditEffectDuration,
    handleEditActionUses,
    handleRangerAbility,
  } = useMapFeatureAdminController({
    tokens,
    tokenStatusEffects,
    sourceCharacterData,
    authedFetch,
    showToast,
    sendMessage,
    setTokens,
    setTokenStatusEffects,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
    isAppearanceIllusionSpell,
  });

  const {
    handleManeuverAction,
    triggerPendingManeuver,
    cancelPendingManeuver,
    applyManeuverSecondaryEffect,
  } = useMapManeuverController({
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
  });

  const {
    handleSelectionMonsterAction,
    executeMonsterAttack,
  } = useMapMonsterActionController({
    tokens,
    campaignId,
    gridUnitLength,
    userId,
    isDM,
    authedFetch,
    showToast,
    setSelectionContextMenu,
    setRangeConfirmModal,
    setDiceRolling,
    lastInitiatedAttackRef,
    getSpellBuffEffects,
    showAttackOutcomeFeedback,
    publishCombatAttackResult,
    applyAttackHpChange,
    consumePendingIncomingAttackDisadvantage,
    playAttackCritical,
    playAttackHit,
    playAttackMiss,
  });

  const { runAttackCleanup } = useMapWeaponAttackCleanupController({
    authedFetch,
    campaignId,
    currentMapUrl,
    showToast,
    setTokens,
    setSourceCharacterData,
    persistTokenActiveEffects,
    clearCloakOfShadowsEffect,
  });

  const { prepareAttackAction } = useMapWeaponAttackPreparationController({
    tokens,
    sourceCharacterData,
    tokenStatusEffects,
    tokenRollModifier,
    campaignId,
    authedFetch,
    showToast,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
    setSourceCharacterData,
    getSpellBuffEffects,
    isWarDomainAttackBonusEffect,
    isCloakOfShadowsEffect,
    gridUnitLength,
  });

  const { executeAttackAction } = useMapWeaponAttackExecutionController({
    authedFetch,
    userId,
    isDM,
    showToast,
    setDiceRolling,
    lastInitiatedAttackRef,
    tokens,
    pendingManeuvers,
    sourceCharacterData,
    triggerPendingManeuver,
    applyManeuverSecondaryEffect,
    showAttackOutcomeFeedback,
    publishCombatBonusAttackGranted,
    publishPromptDivineSmite,
    publishCombatAttackResult,
    applyAttackHpChange,
    consumePendingIncomingAttackDisadvantage,
    runAttackCleanup,
    playAttackCritical,
    playAttackHit,
    playAttackMiss,
  });


  // Handler for bonus actions from class features
  const handleBonusAction = useCallback(async (action: any, sourceTokenId: number, targetTokenId?: number) => {
    const sourceToken = tokens.find(t => t.id === sourceTokenId);
    if (!sourceToken) {
      showToast('未找到来源 token', 'error');
      return;
    }
    const sourceName = sourceToken?.instance_name || '源';
    const targetName = targetTokenId
      ? tokens.find(t => t.id === targetTokenId)?.instance_name || '目标'
      : '无目标';
    const actionResourceType = action.action_type === 'reaction'
      ? 'reaction'
      : action.action_type === 'action'
        ? 'action'
        : action.action_type === 'free'
          ? 'free'
        : 'bonus_action';
    const actionUsageLabel = actionResourceType === 'reaction'
      ? '反应'
      : actionResourceType === 'action'
        ? '动作'
        : actionResourceType === 'free'
          ? '自由动作'
        : '附赠动作';
    const execution = action.execution || {};
    const effectKey = execution.effectId || action.name;

    // Check if this action has a visual effect that can be toggled (using unified effect system)
    const effectDef = getEffectVisual(effectKey);
    const currentEffects = tokenStatusEffects[sourceTokenId] || [];
    // Use effectId to check for existing effects (consistent with how we store them)
    const checkEffectId = resolveExecutionEffectId(effectKey) || action.id;
    const existingEffectIndex = currentEffects.findIndex(e => e.id === checkEffectId);
    const isEffectActive = existingEffectIndex >= 0;

    // If effect is already active, just remove it (end early) - no uses check needed
    if (effectDef && isEffectActive) {
      if (execution.allowDeactivate === false) {
        showToast(`${action.name} 当前不能手动结束`, 'warning');
        return;
      }

      const dependentEffects = currentEffects.filter(effect =>
        effect.id !== checkEffectId
        && resolveExecutionEffectId((effect as any).metadata?.parentEffectId) === checkEffectId
      );
      const newEffects = currentEffects.filter(effect =>
        effect.id !== checkEffectId
        && resolveExecutionEffectId((effect as any).metadata?.parentEffectId) !== checkEffectId
      );
      const dependentMessages: string[] = [];

      for (const childEffect of dependentEffects) {
        const onParentEffectEnd = (childEffect as any).metadata?.onParentEffectEnd;
        if (sourceToken.character_id && onParentEffectEnd?.statusDelta) {
          try {
            await applyCharacterStatusDelta(sourceToken.character_id, onParentEffectEnd.statusDelta);
          } catch (err) {
            logger.error('[Bonus Action] Failed to apply status delta after parent effect ended:', err);
            showToast('保存角色状态失败', 'error');
          }
        }
        const childChat = formatExecutionText(onParentEffectEnd?.chatMessage, {
          source: sourceName,
          effect: childEffect.name || '',
          parentEffect: action.name || '',
        });
        if (childChat) {
          dependentMessages.push(childChat);
        }
        const childToast = formatExecutionText(onParentEffectEnd?.toastMessage, {
          source: sourceName,
          effect: childEffect.name || '',
          parentEffect: action.name || '',
        });
        if (childToast) {
          showToast(childToast, 'warning');
        }
      }

      let chatMessage = `${effectDef.icon} **${sourceName}** 结束了【${action.name}】`;
      if (dependentMessages.length > 0) {
        chatMessage += `\n${dependentMessages.join('\n')}`;
      }

      showToast(`${sourceName} 结束了 ${action.name}`, 'info');

      // Send chat message for ending effect
      sendMessage({
        type: "chat",
	        data: { message: chatMessage, message_type: 'combat' },
      });

      try {
        await persistTokenActiveEffects(sourceTokenId, newEffects);
      } catch (err) {
        logger.error('[Bonus Action] Failed to persist active effects:', err);
        showToast('保存状态效果失败', 'error');
        return;
      }

      logger.info('[Bonus Action] Ended', { action: action.name, source: sourceTokenId });
      setSelectionContextMenu(null);
      return;
    }

    const requiredActiveEffects = normalizeStringList(execution?.requirements?.activeEffects)
      .map(resolveExecutionEffectId)
      .filter(Boolean);
    if (requiredActiveEffects.length > 0) {
      const activeEffectIds = new Set(
        currentEffects
          .map(effect => resolveExecutionEffectId(effect.id))
          .filter(Boolean)
      );
      const missingRequirement = requiredActiveEffects.find(requiredId => !activeEffectIds.has(requiredId));
      if (missingRequirement) {
        showToast(execution?.requirements?.errorMessage || `${action.name} 当前无法使用`, 'error');
        return;
      }
    }

    if (await handleBonusActionRoute({
      action,
      execution,
      actionResourceType,
      sourceTokenId,
      sourceToken,
      sourceName,
      targetTokenId,
    })) {
      return;
    }

    await handleGenericBonusActionActivation({
      action,
      execution,
      effectKey,
      effectDef,
      currentEffects,
      actionResourceType,
      actionUsageLabel,
      sourceTokenId,
      sourceToken,
      sourceName,
      targetTokenId,
      resolveExecutionEffectId,
    });
  }, [tokens, tokenStatusEffects, showToast, sourceCharacterData, consumeCharacterResource, applyCharacterStatusDelta, handleBonusActionRoute, handleGenericBonusActionActivation]);

  useEffect(() => {
    const handler = () => {
      const activeTokenId = Number((window as any).__combatActiveTokenId || 0);
      const currentRound = Number((window as any).__combatRound || 0);
      if (!activeTokenId || !currentRound) return;

      const effects = tokenStatusEffects[activeTokenId] || [];
      const cloakEffect = effects.find(effect => isCloakOfShadowsEffect(effect));
      if (!cloakEffect) return;

      const activatedRound = Number(cloakEffect.metadata?.activatedRound || 0);
      if (currentRound > activatedRound) {
        void clearCloakOfShadowsEffect(activeTokenId, 'turn_end');
      }
    };

    return subscribeAppEvent("combatEndTurn", handler);
  }, [tokenStatusEffects, clearCloakOfShadowsEffect]);

  // Handle range confirmation
  const handleRangeConfirm = useCallback(() => {
    if (rangeConfirmModal?.attackData) {
      void executeMonsterAttack(rangeConfirmModal.attackData, { outOfRange: true });
    }
    setRangeConfirmModal(null);
  }, [rangeConfirmModal, executeMonsterAttack]);

  const handleRangeCancel = useCallback(() => {
    setRangeConfirmModal(null);
  }, []);

  const { handleAttackAction, handleBlindAttack } = useMapAttackEntryController({
    tokens,
    isDM,
    gridUnitLength,
    showToast,
    sendMessage,
    clearSelectionContextMenu: () => setSelectionContextMenu(null),
    tokenRollModifier,
    setTokenRollModifier,
    handleContestedCheck,
    prepareAttackAction,
    executeAttackAction,
  });

  useMapHotbarAttackBridge({
    tokens,
    handleAttackAction,
  });

  // Context menu spell cast → route through sidebarSpellCast event → useMapSidebarSpellController
  const handleSpellAction = useCallback((spell: any, sourceTokenId: number, targetTokenId?: number, slotLevel?: number) => {
    const sourceToken = tokens.find((t) => t.id === sourceTokenId);
    const characterId = sourceToken?.character_id;
    publishAppEvent("sidebarSpellCast", {
      spell,
      sourceTokenId,
      targetTokenId,
      slotLevel: slotLevel ?? spell.level ?? 0,
      characterId: characterId || 0,
    });
  }, [tokens]);

  const {
    handleDampenElementsConfirm,
    handleWrathOfTheStormConfirm,
  } = useMapReactionSpellController({
    dampenElementsModal,
    wrathOfTheStormModal,
    tokens,
    campaignId,
    gridUnitLength,
    tokenStatusEffects,
    persistTokenActiveEffects,
    sendMessage,
    showToast,
    consumeCharacterResource,
    isPendingDamageResistanceEffect,
    closeDampenElementsModal: () => setDampenElementsModal(null),
    closeWrathOfTheStormModal: () => setWrathOfTheStormModal(null),
    clearReactionUi: () => {
      setSelectionContextMenu(null);
      setManualReactionMode(null);
    },
    clearCloakOfShadowsEffect,
  });

  // ==================== Area Spell Mode Handlers ====================

  // Helper: Normalize angle to -180 to 180 range
  const normalizeAngle = (angle: number): number => {
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    return angle;
  };

  // Helper: Get tokens within area based on shape type
  // D&D 5E rule: if ANY part of a creature's space overlaps the area, they're affected
  const getTokensInArea = useCallback((params: {
    shapeType: SpellAreaShape;
    centerX?: number;
    centerY?: number;
    originX?: number;
    originY?: number;
    direction?: number;
    size: number;  // radius for sphere/cone, side length for cube, length for line
    lineWidth?: number;
  }): Token[] => {
    const { shapeType, centerX, centerY, originX, originY, direction = 0, size, lineWidth = 10 } = params;
    const sizeGrids = size / gridUnitLength;
    const lineWidthGrids = lineWidth / gridUnitLength;

    return tokens.filter(token => {
      // Skip item/chest tokens (they don't take spell damage)
      if (token.item_data) return false;
      // Only include creature tokens (monsters or characters)
      if (!token.monster_instance_id && !token.character_id) return false;

      // Use actual token size to collect grid squares it occupies
      const tSize = parseTokenSize(token.token_size);

      // D&D 5E: creature is affected if ANY part of its space overlaps the area
      // For multi-grid tokens, collect all grid square centers to test
      const testPoints: { x: number; y: number }[] = [];
      for (let gx = 0; gx < tSize.width; gx++) {
        for (let gy = 0; gy < tSize.height; gy++) {
          testPoints.push({
            x: token.position_x + gx + 0.5,
            y: token.position_y + gy + 0.5,
          });
        }
      }

      switch (shapeType) {
        case "sphere":
        case "cylinder": {
          // Any grid square center within radius → hit
          return testPoints.some(p => {
            const dx = p.x - (centerX ?? 0);
            const dy = p.y - (centerY ?? 0);
            return Math.sqrt(dx * dx + dy * dy) <= sizeGrids;
          });
        }

        case "cube": {
          const halfSize = sizeGrids / 2;
          const cx = centerX ?? 0;
          const cy = centerY ?? 0;
          return testPoints.some(p =>
            Math.abs(p.x - cx) <= halfSize && Math.abs(p.y - cy) <= halfSize
          );
        }

        case "cone": {
          const ox = originX ?? 0;
          const oy = originY ?? 0;
          const coneHalfAngle = 53 / 2;
          return testPoints.some(p => {
            const dx = p.x - ox;
            const dy = p.y - oy;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > sizeGrids) return false;
            if (distance < 0.01) return true;
            const pointAngle = Math.atan2(dy, dx) * 180 / Math.PI;
            const angleDiff = normalizeAngle(pointAngle - direction);
            return Math.abs(angleDiff) <= coneHalfAngle;
          });
        }

        case "line": {
          const ox = originX ?? 0;
          const oy = originY ?? 0;
          const rad = -direction * Math.PI / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const halfWidth = lineWidthGrids / 2;
          return testPoints.some(p => {
            const dx = p.x - ox;
            const dy = p.y - oy;
            const localX = dx * cos - dy * sin;
            const localY = dx * sin + dy * cos;
            return localX >= 0 && localX <= sizeGrids && Math.abs(localY) <= halfWidth;
          });
        }

        default:
          return false;
      }
    });
  }, [tokens, gridUnitLength]);

  // Legacy helper for backward compatibility (still used in some places)
  const getTokensInRadius = useCallback((centerX: number, centerY: number, radiusFeet: number): Token[] => {
    return getTokensInArea({
      shapeType: "sphere",
      centerX,
      centerY,
      size: radiusFeet
    });
  }, [getTokensInArea]);

  const {
    areaSpellAffectedTokenIds,
    areaSpellTargetStroke,
    handleAreaSpellCancel,
    handleAreaSpellConfirm,
    handleAreaSpellMouseMove,
    handleAreaSpellSelect,
    isReadyToCast,
    snapAreaSpellPos,
  } = useMapAreaSpellController({
    areaSpellMode,
    setAreaSpellMode,
    tokens,
    sourceCharacterData,
    gridUnitLength,
    showToast,
    getTokensInArea,
    getBestInvokeDuplicityDistanceToGrid,
  });

  useMapSidebarSpellController({
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
  });

  // Area spell runtime side-effects: breath weapons, monster area actions, touch preview
  const { handleMapTouchMove } = useMapAreaSpellRuntimeController({
    areaSpellMode,
    setAreaSpellMode,
    tokens,
    containerRef,
    stagePosRef,
    stageScaleRef,
    showToast,
    handleAreaSpellSelect,
    handleAreaSpellMouseMove,
    handleTouchMoveForContextMenu,
    snapAreaSpellPos,
  });

  const {
    consumeAreaSpellSlot,
    createIllusionToken,
    persistAreaEffect,
  } = useMapAreaSpellPersistence({
    authedFetch,
    campaignId,
    currentMapUrl,
    gridUnitLength,
    setSourceCharacterData,
  });

  const { processAreaSpellSuccess } = useMapAreaSpellResultController({
    authedFetch,
    showToast,
    sendMessage,
    playEffect,
    playHit,
    clearCloakOfShadowsEffect,
    clearReadyCast,
    consumePendingDestructiveWrath,
    consumeAreaSpellSlot,
    persistAreaEffect,
    setTokens,
    setTokenStatusEffects,
    tokenStatusEffects,
    resolveEffectDefinition: getEffectDefinition,
  });

  const { handleNonCombatAreaSpell } = useMapAreaSpellNonCombatController({
    currentMapUrl,
    showToast,
    sendMessage,
    playCast,
    handleAreaSpellCancel,
    clearReadyCast,
    setConcentrationOnTokenFn: setConcentrationOnToken,
    consumeAreaSpellSlot,
    createIllusionToken,
    persistAreaEffect,
  });

  const { dispatchAreaSpellCombat } = useMapAreaSpellCombatDispatchController({
    authedFetch,
    userId,
    isDM,
    showToast,
    playAttackSwing,
    playCast,
    setDiceRolling,
    handleAreaSpellCancel,
    processAreaSpellSuccess,
  });

  const { handleAreaSpellCast } = useMapAreaSpellCastExecutionController({
    areaSpellMode,
    tokens,
    sourceCharacterData,
    campaignId,
    currentMapUrl,
    authedFetch,
    showToast,
    getTokensInArea,
    tokenStatusEffects,
    getSpellBuffEffects,
    handleAreaSpellCancel,
    handleNonCombatAreaSpell,
    dispatchAreaSpellCombat,
    isCloakOfShadowsEffect,
    isDestructiveWrathPendingEffect,
    isDestructiveWrathEligibleDamageType,
    getSpellEffectMapping: (spellId) => SPELL_TO_EFFECT_MAP[spellId],
  });

  // ESC key handler for area spell mode
  useEffect(() => {
    if (!areaSpellMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleAreaSpellCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [areaSpellMode, handleAreaSpellCancel]);

  // 加载当前角色的伙伴/召唤物的 monster_data
  const fetchCompanionData = useCallback((characterToken: Token) => {
    if (!characterToken.character_id) return;
    const companions = tokens.filter(t =>
      t.monster_instance_id &&
      t.control_type &&
      t.controller_character_id === characterToken.character_id
    );
    if (companions.length === 0) {
      setCompanionMonsterDataMap({});
      return;
    }
    const newMap: Record<number, any> = {};
    Promise.all(companions.map(async (ct) => {
      try {
        const res = await authedFetch(`/api/monster-instances/${ct.monster_instance_id}`);
        if (res.ok) {
          const data = await res.json();
          newMap[ct.monster_instance_id!] = data?.monster_data || null;
        }
      } catch { /* ignore */ }
    })).then(() => setCompanionMonsterDataMap(newMap));
  }, [tokens, authedFetch]);

  // ==================== Event Handlers ====================
  const {
    handleFogUpdate,
    handleRulerAdd,
    handleRulerRemove,
    handleDrawingAdd,
    handleDrawingRemove,
    handleUpdateHP,
    handleRemoveToken,
    handleNativeTouchMove,
    handleNativeTouchEnd,
    handleWheel,
    handleZoomIn,
    handleZoomOut,
    handleZoomReset,
    handleZoomSet,
  } = useMapEvents({
    campaignId,
    currentMapUrl,
    userId,
    isDM,
    drawTool,
    setFogData,
    setRulers,
    setDrawings,
    setTokens,
    setEditingTokenId,
    setEditingTokenHP,
    setEditingTokenMaxHP,
    setStagePos,
    setStageScale,
    tokens,
    editingTokenId,
    editingTokenHP,
    editingTokenMaxHP,
    stagePos,
    stageScale,
    stageSize,
    stageRef,
    lastDist,
    lastCenter,
    sendMessage,
  });

  const { handleTokenDragEnd } = useMapTokenDragController({
    campaignId,
    currentMapUrl,
    userId,
    isDM,
    gridUnitLength,
    tokens,
    setTokens,
  });

  const { handleTerrainUpdate } = useMapTerrainController({
    campaignId,
    isDM,
    currentMapUrl,
    authedFetch,
    sendMessage,
    setTerrainData,
  });

  // Keyboard movement (WASD / Arrow keys) for player tokens
  useKeyboardMovement({
    campaignId,
    currentMapUrl,
    tokens,
    setTokens,
    userId,
    selectedCharacterId: selectedCharacterId ?? undefined,
    isDM,
    gridUnitLength,
    mapImage,
    mapImageScale,
  });

  const {
    handleRulerMultiTouchEnd,
    handleRulerMultiTouchMove,
  } = useMapTouchGestureController({
    containerRef,
    stageRef,
    handleNativeTouchMove,
    handleNativeTouchEnd,
    lastDist,
    lastCenter,
    setStageScale,
    setStagePos,
  });

  // Delete key to remove selected token (DM only)
  useEffect(() => {
    if (!isDM) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input, textarea, or contenteditable
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      // Delete or Backspace to remove selected token
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTokenId) {
        // Prevent browser back navigation on Backspace
        e.preventDefault();
        handleRemoveToken(selectedTokenId);
        setSelectedTokenId(null);
        setSelectionContextMenu(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDM, selectedTokenId, handleRemoveToken, setSelectedTokenId]);

  const {
    handlePlayerCastSpell,
    handlePlayerMove,
    handlePlayerSpellDialogCast,
    handlePlayerToggleReaction,
    handlePlayerUseAbility,
  } = useMapPlayerActionController({
    authedFetch,
    campaignId,
    currentMapUrl,
    selectedCharacterId,
    userId,
    sourceCharacterData,
    tokens,
    playerReactions,
    setPlayerReactions,
    setPlayerSpellDialog,
    sendMessage,
    setTokens,
    showToast,
  });

  const {
    handleCreateMarker,
    handleDeleteMarker,
    handleMarkerClick,
    markerLabelInput,
    pendingMarkerPos,
    selectedMarkerId,
    setMarkerLabelInput,
    setPendingMarkerPos,
    setSelectedMarkerId,
    setShowMarkerDialog,
    showMarkerDialog,
  } = useMapMarkerController({
    isDM,
    campaignId,
    currentMapUrl,
    markerIcon,
    markerColor,
    authedFetch,
    setMarkers,
    showToast,
  });

  // ==================== Item Token Actions ====================
  const {
    handlePickupItem,
    handleDeleteItem,
    handleDeleteShopToken,
    handleLootFromBag,
    handleDeleteLootBag,
  } = useMapInventoryController({
    authedFetch,
    tokens,
    userId,
    selectedCharacterId,
    setTokens,
    setLootBagTokenId,
    showToast,
  });

  const {
    playerNoteToken,
    illusionEditToken,
    itemDetailToken,
    lootBagToken,
    shopToken,
    chestModalCharacters,
  } = useMapModalData({
    tokens,
    playerAvatars,
    playerNoteTokenId,
    illusionEditTokenId,
    itemDetailTokenId,
    lootBagTokenId,
    shopTokenModalId,
  });

  useMapViewStateController({
    containerRef,
    stagePos,
    stageScale,
    stageSize,
    setStageSize,
    minimapCollapsed,
    currentMapUrl,
    campaignId,
    userId,
    viewStateLoadedRef,
    saveViewStateTimerRef,
    authedFetch,
  });

  const spellList = useMemo(() => {
    const allSpells = (spellsData as any).spells || spellsData;
    return Array.isArray(allSpells) ? allSpells : [];
  }, []);

  const {
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
  } = useMapStatusController({
    authedFetch,
    campaignId,
    spellList,
    tokens,
    setTokens,
    setTokenStatusEffects,
    showToast,
    handleAreaSpellSelect,
    onStartSpellTargeting,
  });

  useMapDueCastResolution({
    authedFetch,
    campaignId,
    timeOfDay,
    tokens,
  });

  const {
    handleHoveredTokenEnter,
    handleHoveredTokenLeave,
    handleTargetingTokenSelection,
    hotbarCursorInfo,
    hoveredTokenId,
  } = useMapTargetingController({
    containerRef,
    stagePosRef,
    stageScaleRef,
    tokens,
    gridUnitLength,
    hotbarTargeting,
    monsterActionTargeting,
    getBestInvokeDuplicityOriginTokenToGrid,
    getBestInvokeDuplicityOriginTokenToToken,
    handleSelectionMonsterAction,
    setMonsterActionTargeting,
    onHotbarTargetSelect,
    onHotbarTargetCancel,
  });

  const {
    handleExternalTokenSelect,
    handleTokenOpen,
    handleTokenSelect,
  } = useMapTokenInteractionController({
    isDM,
    userId,
    selectedCharacterId,
    selectedTool,
    tokenMode,
    tokens,
    longPressTriggeredRef,
    setSelectedTokenId,
    clearInteractionMenus,
    loadSourceTokenData,
    fetchCompanionData,
    setCompanionMonsterDataMap,
    setSourceMonsterData,
    setSourceCharacterData,
    handleTargetingTokenSelection,
    handleRemoveToken,
    setItemDetailTokenId,
    setIllusionEditTokenId,
    setLootBagTokenId,
    openTokenPanel,
    setActiveTokenId,
    setPlayerNoteTokenId,
  });

  const {
    handleMinimapNavigate,
    focusMyToken,
    jumpToAnchor,
    clearAnchor,
    focusToken,
    focusAllPlayers,
    handleAvatarClick,
  } = useMapFocusController({
    authedFetch,
    campaignId,
    currentMapUrl,
    userId,
    isDM,
    selectedCharacterId,
    tokens,
    anchorPosition,
    stagePos,
    stageScale,
    stageSize,
    setAnchorPosition,
    setStagePos,
    setStageScale,
    setSelectedTokenId,
    showToast,
    sendMessage,
    handleExternalTokenSelect,
  });

  const {
    handlePlaceCharacter,
    handlePlaceMyToken,
    handlePlaceShop,
  } = useMapPlacementController({
    authedFetch,
    campaignId,
    currentMapUrl,
    contextMenu,
    mobileActionModal,
    selectedCharacterId,
    tokens,
    setTokens,
    showToast,
    focusToken,
  });

  const {
    handlePlaceCurrency,
    handlePlaceItem,
    handlePlaceMonster,
    handlePlaceNPC,
    handleSelectionPickupItem,
    handleUseConsumable,
  } = useMapInventoryAndPlacementController({
    authedFetch,
    campaignId,
    currentMapUrl,
    userId,
    isDM,
    contextMenu,
    mobileActionModal,
    tokens,
    campaignItems,
    sourceCharacterData,
    setSourceCharacterData,
    sendMessage,
    setTokens,
    showToast,
  });

  // ==================== Prevent Invalid Canvas Render ====================
  if (stageSize.width <= 0 || stageSize.height <= 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-950">
        <div className="text-gray-400">初始化地图...</div>
      </div>
    );
  }

  // ==================== Render ====================
  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden bg-gray-950 relative"
      style={{
        touchAction: 'none',
        cursor: invokeDuplicityPlacementMode
          ? 'crosshair'
          : monsterActionTargeting
          ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cpath d='M6 26l2 2 4-4-2-2zm7-5l2 2L27 5l-2-2z' fill='%23fbbf24' stroke='%23000' stroke-width='1'/%3E%3Ccircle cx='16' cy='16' r='2' fill='none' stroke='%23fbbf24' stroke-width='1.5' opacity='0.8'/%3E%3Cline x1='16' y1='11' x2='16' y2='13' stroke='%23fbbf24' stroke-width='1' opacity='0.6'/%3E%3Cline x1='16' y1='19' x2='16' y2='21' stroke='%23fbbf24' stroke-width='1' opacity='0.6'/%3E%3Cline x1='11' y1='16' x2='13' y2='16' stroke='%23fbbf24' stroke-width='1' opacity='0.6'/%3E%3Cline x1='19' y1='16' x2='21' y2='16' stroke='%23fbbf24' stroke-width='1' opacity='0.6'/%3E%3C/svg%3E") 16 16, crosshair`
          : hotbarTargeting
          ? hotbarTargeting.targetingType === 'spell'
            ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cpath d='M8 24l3-7 4 4-7 3z' fill='%23a78bfa' stroke='%237c3aed' stroke-width='1'/%3E%3Cpath d='M14 18l10-10' stroke='%23a78bfa' stroke-width='2' stroke-linecap='round'/%3E%3Ccircle cx='25' cy='7' r='2' fill='%23e9d5ff' opacity='0.9'/%3E%3Cpath d='M25 3v2M25 10v2M21 7h2M26 7h2' stroke='%23c4b5fd' stroke-width='1' opacity='0.7'/%3E%3C/svg%3E") 4 28, crosshair`
            : hotbarTargeting.targetingType === 'ability'
              ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cpath d='M16 6v6M16 20v6M6 16h6M20 16h6' stroke='%234ade80' stroke-width='1.5' opacity='0.7'/%3E%3Ccircle cx='16' cy='16' r='5' fill='none' stroke='%234ade80' stroke-width='1.5'/%3E%3Ccircle cx='16' cy='16' r='2' fill='%234ade80' opacity='0.6'/%3E%3C/svg%3E") 16 16, crosshair`
              : `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cpath d='M6 26l2 2 4-4-2-2zm7-5l2 2L27 5l-2-2z' fill='%23fbbf24' stroke='%23000' stroke-width='1'/%3E%3Ccircle cx='16' cy='16' r='2' fill='none' stroke='%23fbbf24' stroke-width='1.5' opacity='0.8'/%3E%3Cline x1='16' y1='11' x2='16' y2='13' stroke='%23fbbf24' stroke-width='1' opacity='0.6'/%3E%3Cline x1='16' y1='19' x2='16' y2='21' stroke='%23fbbf24' stroke-width='1' opacity='0.6'/%3E%3Cline x1='11' y1='16' x2='13' y2='16' stroke='%23fbbf24' stroke-width='1' opacity='0.6'/%3E%3Cline x1='19' y1='16' x2='21' y2='16' stroke='%23fbbf24' stroke-width='1' opacity='0.6'/%3E%3C/svg%3E") 16 16, crosshair`
          : undefined,
      }}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleMapTouchMove}
      onTouchEnd={handleTouchEndForContextMenu}
      onTouchCancel={handleTouchEndForContextMenu}
    >
      <MapTargetingHud
        hotbarTargeting={hotbarTargeting}
        hotbarCursorInfo={hotbarCursorInfo}
        monsterActionTargeting={monsterActionTargeting}
        monsterActionCursorInfo={monsterActionCursorInfo}
        invokeDuplicityPlacementMode={invokeDuplicityPlacementMode}
        areaSpellMode={areaSpellMode}
        isReadyToCast={isReadyToCast}
        onHotbarTargetCancel={onHotbarTargetCancel}
        onInvokeDuplicityPlacementUndo={handleInvokeDuplicityPlacementUndo}
        onInvokeDuplicityCreate={handleInvokeDuplicityCreate}
        onInvokeDuplicityPlacementCancel={handleInvokeDuplicityPlacementCancel}
        onAreaSpellCast={handleAreaSpellCast}
        onAreaSpellCancel={handleAreaSpellCancel}
      />
      {/* Long Press Indicator */}
      {longPressIndicator && (
        <div
          className="fixed pointer-events-none z-[9999]"
          style={{
            left: longPressIndicator.x - 30,
            top: longPressIndicator.y - 30,
          }}
        >
          <svg width="60" height="60" viewBox="0 0 60 60">
            {/* Background circle */}
            <circle
              cx="30"
              cy="30"
              r="25"
              fill="none"
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="4"
            />
            {/* Animated progress circle */}
            <circle
              cx="30"
              cy="30"
              r="25"
              fill="none"
              stroke="#f59e0b"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="157"
              strokeDashoffset="157"
              transform="rotate(-90 30 30)"
              style={{
                animation: `longPressProgress ${LONG_PRESS_INDICATOR_ANIM_DURATION}ms linear forwards`,
              }}
            />
            {/* Center dot */}
            <circle cx="30" cy="30" r="4" fill="#f59e0b" opacity="0.8" />
          </svg>
        </div>
      )}

      {/* CSS Animation */}
      <style>{`
        @keyframes longPressProgress {
          from { stroke-dashoffset: 157; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>

      {/* Zoom Controls (includes zoom display) */}
      <ZoomControls
        stageScale={stageScale}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        onZoomSet={handleZoomSet}
        onAvatarClick={handleAvatarClick}
        isDM={isDM}
        dmBubbleMessage={dmBubbleMessage}
        gridUnitLength={gridUnitLength}
        onGridUnitLengthClick={onGridUnitLengthClick}
        rightOffset={rightOffset}
        playerCompanions={playerCompanions}
        playerAvatars={zoomControlPlayerAvatars}
      />

      {/* Minimap (top-right corner) */}
      <Minimap
        mapImage={mapImage}
        mapImageScale={mapImageScale}
        mapTransform={mapTransform}
        stagePos={stagePos}
        stageScale={stageScale}
        stageSize={stageSize}
        tokens={tokens}
        fogData={fogData}
        isDM={isDM}
        showFogOfWar={showFogOfWar}
        onNavigate={handleMinimapNavigate}
        rightOffset={rightOffset}
        collapsed={minimapCollapsed}
        onCollapsedChange={setMinimapCollapsed}
        timeOfDay={timeOfDay}
      />

      {/* Fog of War Canvas */}
      <FogOfWarRenderer
        canvasWidth={mapImage ? mapImage.width * mapImageScale : MAP_WIDTH * GRID_SIZE}
        canvasHeight={mapImage ? mapImage.height * mapImageScale : MAP_HEIGHT * GRID_SIZE}
        mapWidth={mapImage ? mapImage.width * mapImageScale : MAP_WIDTH * GRID_SIZE}
        mapHeight={mapImage ? mapImage.height * mapImageScale : MAP_HEIGHT * GRID_SIZE}
        gridSize={GRID_SIZE}
        isEnabled={showFogOfWar}
        isEditable={isDM && selectedTool === "fog"}
        isDM={isDM}
        mode={fogMode}
        brushSize={externalFogBrushSize ?? fogBrushSize}
        stageScale={stageScale}
        stagePos={stagePos}
        initialFogData={fogData || undefined}
        onFogUpdate={handleFogUpdate}
        onWheel={(e) => {
          const stage = stageRef.current;
          if (!stage) return;
          const oldScale = stage.scaleX();
          const container = stage.container().getBoundingClientRect();
          const pointerX = e.clientX - container.left;
          const pointerY = e.clientY - container.top;
          const mousePointTo = {
            x: (pointerX - stage.x()) / oldScale,
            y: (pointerY - stage.y()) / oldScale,
          };
          const scaleBy = 1.05;
          const newScale = e.deltaY > 0
            ? Math.max(0.1, oldScale / scaleBy)
            : Math.min(5, oldScale * scaleBy);
          setStageScale(newScale);
          setStagePos({
            x: pointerX - mousePointTo.x * newScale,
            y: pointerY - mousePointTo.y * newScale,
          });
        }}
        currentMapUrl={currentMapUrl}
      />

      {/* Terrain Brush Overlay - only active when terrain tool selected */}
      <TerrainBrushOverlay
        canvasWidth={mapImage ? mapImage.width * mapImageScale : MAP_WIDTH * GRID_SIZE}
        canvasHeight={mapImage ? mapImage.height * mapImageScale : MAP_HEIGHT * GRID_SIZE}
        gridSize={GRID_SIZE}
        isEditable={isDM && selectedTool === "terrain"}
        terrainType={terrainType as TerrainType}
        mode={terrainMode}
        brushSize={terrainBrushSize}
        stageScale={stageScale}
        stagePos={stagePos}
        terrainManager={terrainManagerRef.current}
        onTerrainUpdate={handleTerrainUpdate}
        onWheel={(e) => {
          const stage = stageRef.current;
          if (!stage) return;
          const oldScale = stage.scaleX();
          const container = stage.container().getBoundingClientRect();
          const pointerX = e.clientX - container.left;
          const pointerY = e.clientY - container.top;
          const mousePointTo = {
            x: (pointerX - stage.x()) / oldScale,
            y: (pointerY - stage.y()) / oldScale,
          };
          const scaleBy = 1.05;
          const newScale = e.deltaY > 0
            ? Math.max(0.1, oldScale / scaleBy)
            : Math.min(5, oldScale * scaleBy);
          setStageScale(newScale);
          setStagePos({
            x: pointerX - mousePointTo.x * newScale,
            y: pointerY - mousePointTo.y * newScale,
          });
        }}
      />

      {/* Ruler Canvas */}
      <RulerRenderer
        canvasWidth={mapImage ? mapImage.width * mapImageScale : MAP_WIDTH * GRID_SIZE}
        canvasHeight={mapImage ? mapImage.height * mapImageScale : MAP_HEIGHT * GRID_SIZE}
        gridSize={GRID_SIZE}
        gridUnitLength={gridUnitLength}
        rulers={rulers}
        isEnabled={true}
        isDM={isDM}
        mode={rulerMode}
        stageScale={stageScale}
        stagePos={stagePos}
        onRulerAdd={handleRulerAdd}
        onRulerRemove={handleRulerRemove}
        onMultiTouchMove={handleRulerMultiTouchMove}
        onMultiTouchEnd={handleRulerMultiTouchEnd}
      />

      {/* Player Token Overlay (above fog) - only shows when token is covered by fog */}
      <PlayerTokenOverlay
        isDM={isDM}
        showFogOfWar={showFogOfWar}
        tokens={tokens}
        selectedCharacterId={selectedCharacterId}
        userId={userId}
        stageScale={stageScale}
        stagePos={stagePos}
        fogData={fogData}
      />

      {/* Initiative Tracker Bar (CRPG-style turn order) */}
      <InitiativeTracker
        isDM={isDM}
        campaignId={campaignId}
        userId={userId || ""}
        selectedCharacterId={selectedCharacterId}
        tokens={tokens}
      />

      {/* Floating Damage Numbers Overlay */}
      <DamageNumberOverlay
        tokens={tokens}
        stageScale={stageScale}
        stagePos={stagePos}
      />

      {/* Dice Rolling Animation Overlay */}
      <DiceRollingOverlay
        visible={diceRolling.visible}
        attackerName={diceRolling.attackerName}
        targetName={diceRolling.targetName}
      />

      {/* Combat Action Modal removed per request */}

      {/* Character switching loading overlay - shown when either parent or internal state indicates transition */}
      {(isTransitioning || isCharacterSwitching) && (
        <div className="absolute inset-0 bg-gray-900 flex items-center justify-center z-50">
          <div className="text-white text-lg animate-pulse">切换角色中...</div>
        </div>
      )}

      {/* Konva Stage - SKIP rendering completely during transition to avoid Konva reconciliation crashes */}
      {/* The isTransitioning prop from parent takes precedence and completely prevents Stage rendering */}
      {!isTransitioning && !isCharacterSwitching && (
      <Stage
        key={`stage-${campaignId}-${currentMapUrl || 'no-map'}`}
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        x={renderedStagePos.x}
        y={renderedStagePos.y}
        scaleX={stageScale}
        scaleY={stageScale}
        draggable={
          // On touch devices, disable dragging when drawing/ruler/fog tools are active
          // so touch events can be captured by the appropriate layer
          // Also disable during area spell targeting to prevent pan conflicts
          !areaSpellMode &&
          !invokeDuplicityPlacementMode &&
          ((isTouchDevice && selectedTool !== "draw" && selectedTool !== "fog" && selectedTool !== "terrain" && !rulerMode) ||
          selectedTool === "move" ||
          selectedTool === "pan")
        }
        onWheel={handleWheel}
        onMouseDown={(e) => {
          // Hotbar targeting - click on blank area to cancel
          if (e.evt.button === 0 && hotbarTargeting && e.target === e.target.getStage()) {
            onHotbarTargetCancel?.();
            return;
          }
          if (e.evt.button === 2 && invokeDuplicityPlacementMode) {
            e.evt.preventDefault();
            handleInvokeDuplicityPlacementCancel();
            return;
          }
          // Area spell targeting - right-click to cancel
          if (e.evt.button === 2 && areaSpellMode) {
            e.evt.preventDefault();
            handleAreaSpellCancel();
            return;
          }
          // Middle mouse button (button === 1) for panning
          if (e.evt.button === 1) {
            e.evt.preventDefault();
            setIsMiddleDragging(true);
            const liveStagePos = stageRef.current
              ? { x: stageRef.current.x(), y: stageRef.current.y() }
              : stagePosRef.current;
            middleDragStartRef.current = {
              x: e.evt.clientX,
              y: e.evt.clientY,
              stageX: liveStagePos.x,
              stageY: liveStagePos.y,
            };
          }
          // Right-click (button === 2) for context menu
          if (e.evt.button === 2) {
            e.evt.preventDefault();
            // Create a synthetic event-like object for handleContextMenu
            const fakeEvent = {
              preventDefault: () => {},
              clientX: e.evt.clientX,
              clientY: e.evt.clientY,
            };
            handleContextMenu(fakeEvent as React.MouseEvent);
          }
        }}
        onMouseMove={(e) => {
          // Desktop: stop tracking once position/direction is ready (so user can reach cast button)
          // Click on map to re-place/re-aim
          if (invokeDuplicityPlacementMode) {
            const stage = e.target.getStage();
            if (stage) {
              const pointerPos = stage.getPointerPosition();
              if (pointerPos) {
                const stageX = (pointerPos.x - stagePos.x) / stageScale;
                const stageY = (pointerPos.y - stagePos.y) / stageScale;
                const gridX = stageX / GRID_SIZE;
                const gridY = stageY / GRID_SIZE;
                handleInvokeDuplicityPlacementMouseMove(gridX, gridY);
              }
            }
          } else if (areaSpellMode && !isReadyToCast) {
            const stage = e.target.getStage();
            if (stage) {
              const pointerPos = stage.getPointerPosition();
              if (pointerPos) {
                const stageX = (pointerPos.x - stagePos.x) / stageScale;
                const stageY = (pointerPos.y - stagePos.y) / stageScale;
                const gridX = stageX / GRID_SIZE;
                const gridY = stageY / GRID_SIZE;
                handleAreaSpellMouseMove(gridX, gridY);
              }
            }
          }
          // Handle middle mouse dragging
          if (isMiddleDragging && middleDragStartRef.current) {
            const dx = e.evt.clientX - middleDragStartRef.current.x;
            const dy = e.evt.clientY - middleDragStartRef.current.y;
            const nextPos = {
              x: middleDragStartRef.current.stageX + dx,
              y: middleDragStartRef.current.stageY + dy,
            };
            const stage = stageRef.current;
            if (stage) {
              stage.position(nextPos);
              stage.batchDraw();
            }
            scheduleStagePosSync(nextPos);
          }
        }}
        onMouseUp={(e) => {
          // Skip if we just triggered a context menu via long-press (prevent ghost clicks)
          if (longPressTriggeredRef.current) return;

          // End middle mouse dragging
          if (e.evt.button === 1) {
            const stage = stageRef.current;
            if (stage) {
              scheduleStagePosSync({ x: stage.x(), y: stage.y() }, true);
            }
            setIsMiddleDragging(false);
            middleDragStartRef.current = null;
          }
        }}
        onMouseLeave={() => {
          // End middle dragging if mouse leaves stage
          if (isMiddleDragging) {
            const stage = stageRef.current;
            if (stage) {
              scheduleStagePosSync({ x: stage.x(), y: stage.y() }, true);
            }
            setIsMiddleDragging(false);
            middleDragStartRef.current = null;
          }
        }}
        onClick={(e) => {
          // Skip if we just triggered a context menu via long-press (prevent ghost clicks)
          if (longPressTriggeredRef.current) return;

          // Handle area spell targeting
          if (invokeDuplicityPlacementMode) {
            const stage = e.target.getStage();
            if (stage) {
              const pointerPos = stage.getPointerPosition();
              if (pointerPos) {
                const stageX = (pointerPos.x - stagePos.x) / stageScale;
                const stageY = (pointerPos.y - stagePos.y) / stageScale;
                const gridX = stageX / GRID_SIZE;
                const gridY = stageY / GRID_SIZE;
                handleInvokeDuplicityPlacementConfirm(gridX, gridY);
              }
            }
            return;
          }

          if (areaSpellMode) {
            const stage = e.target.getStage();
            if (stage) {
              const pointerPos = stage.getPointerPosition();
              if (pointerPos) {
                const stageX = (pointerPos.x - stagePos.x) / stageScale;
                const stageY = (pointerPos.y - stagePos.y) / stageScale;
                const gridX = stageX / GRID_SIZE;
                const gridY = stageY / GRID_SIZE;
                handleAreaSpellConfirm(gridX, gridY);
              }
            }
            return; // Don't process other click handlers
          }

          // Handle marker placement
          if (selectedTool === "marker" && isDM) {
            const stage = e.target.getStage();
            if (!stage) return;
            const pointerPos = stage.getPointerPosition();
            if (!pointerPos) return;
            // Convert screen position to stage (canvas) coordinates
            const stageX = (pointerPos.x - stagePos.x) / stageScale;
            const stageY = (pointerPos.y - stagePos.y) / stageScale;
            // Convert to grid coordinates
            const gridX = Math.floor(stageX / GRID_SIZE);
            const gridY = Math.floor(stageY / GRID_SIZE);
            setPendingMarkerPos({ x: gridX, y: gridY });
            setShowMarkerDialog(true);
            return;
          }

          // Handle anchor placement
          if (selectedTool === "setAnchor" && isDM) {
            const stage = e.target.getStage();
            if (!stage) return;
            const pointerPos = stage.getPointerPosition();
            if (!pointerPos) return;
            const stageX = (pointerPos.x - stagePos.x) / stageScale;
            const stageY = (pointerPos.y - stagePos.y) / stageScale;
            const gridX = Math.floor(stageX / GRID_SIZE);
            const gridY = Math.floor(stageY / GRID_SIZE);

            authedFetch(`/api/map-settings/${campaignId}/${encodeURIComponent(currentMapUrl!)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ anchor_x: gridX, anchor_y: gridY }),
            }).then(() => {
              setAnchorPosition({ x: gridX, y: gridY });
              showToast("锚点已设置", "success");
              publishAppEvent("anchorPlaced", {});
              sendMessage({
                type: "anchor_update",
                data: { map_url: currentMapUrl, anchor_x: gridX, anchor_y: gridY },
              });
            }).catch(() => showToast("锚点设置失败", "error"));
            return;
          }

          // Handle token placement - left click opens context menu for placing tokens
          if (selectedTool === "token" && tokenMode === "place" && isDM) {
            const clickedOnBackground = e.target === e.target.getStage() ||
              (e.target.className === 'Rect' && !e.target.attrs.tokenId) ||
              (e.target.className === 'Image' && !e.target.attrs.tokenId); // Map image is also background
            if (clickedOnBackground) {
              const stage = e.target.getStage();
              if (!stage) return;
              const pointerPos = stage.getPointerPosition();
              if (!pointerPos) return;
              // Convert screen position to stage (canvas) coordinates
              const stageX = (pointerPos.x - stagePos.x) / stageScale;
              const stageY = (pointerPos.y - stagePos.y) / stageScale;
              // Convert to grid coordinates
              const gridX = Math.floor(stageX / GRID_SIZE);
              const gridY = Math.floor(stageY / GRID_SIZE);
              // Open context menu for token placement - use original event coordinates for menu position
              setContextMenu({
                x: e.evt.clientX,
                y: e.evt.clientY,
                gridX,
                gridY,
              });
              return;
            }
          }

          // Handle player placing their own token
          if (selectedTool === "placeMyToken" && !isDM && selectedCharacterId) {
            const clickedOnBackground = e.target === e.target.getStage() ||
              (e.target.className === 'Rect' && !e.target.attrs.tokenId) ||
              (e.target.className === 'Image' && !e.target.attrs.tokenId); // Map image is also background
            if (clickedOnBackground) {
              const stage = e.target.getStage();
              if (!stage) return;
              const pointerPos = stage.getPointerPosition();
              if (!pointerPos) return;
              // Convert screen position to stage (canvas) coordinates
              const stageX = (pointerPos.x - stagePos.x) / stageScale;
              const stageY = (pointerPos.y - stagePos.y) / stageScale;
              // Convert to grid coordinates
              const gridX = Math.floor(stageX / GRID_SIZE);
              const gridY = Math.floor(stageY / GRID_SIZE);
              // Place player's character token
              handlePlaceMyToken(gridX, gridY);
              return;
            }
          }

          // DM deselects token via ESC key or by clicking another token
          // Do NOT deselect on background click — DM needs selection to persist
        }}
        onTap={(e) => {
          // Mobile tap: handle area spell targeting (Konva fires onTap for touch, onClick for mouse)
          if (longPressTriggeredRef.current) return;
          if (invokeDuplicityPlacementMode) {
            const stage = e.target.getStage();
            if (stage) {
              const pointerPos = stage.getPointerPosition();
              if (pointerPos) {
                const stageX = (pointerPos.x - stagePos.x) / stageScale;
                const stageY = (pointerPos.y - stagePos.y) / stageScale;
                const gridX = stageX / GRID_SIZE;
                const gridY = stageY / GRID_SIZE;
                handleInvokeDuplicityPlacementConfirm(gridX, gridY);
              }
            }
            return;
          }
          if (areaSpellMode) {
            const stage = e.target.getStage();
            if (stage) {
              const pointerPos = stage.getPointerPosition();
              if (pointerPos) {
                const stageX = (pointerPos.x - stagePos.x) / stageScale;
                const stageY = (pointerPos.y - stagePos.y) / stageScale;
                const gridX = stageX / GRID_SIZE;
                const gridY = stageY / GRID_SIZE;
                handleAreaSpellConfirm(gridX, gridY);
              }
            }
            return;
          }
        }}
        onDragMove={(e) => {
          scheduleStagePosSync({
            x: e.target.x(),
            y: e.target.y(),
          });
        }}
        onDragEnd={(e) => {
          scheduleStagePosSync({
            x: e.target.x(),
            y: e.target.y(),
          }, true);
        }}
      >
        {/* Background + Grid Layer */}
        <Layer key="bg-layer" listening={false}>
          <Rect
            x={0}
            y={0}
            width={mapImage ? mapImage.width * mapImageScale : MAP_WIDTH * GRID_SIZE}
            height={mapImage ? mapImage.height * mapImageScale : MAP_HEIGHT * GRID_SIZE}
            fill="#1a1a1a"
          />

          {mapImageLoaded && mapImage && (() => {
            const imgWidth = mapImage.width * mapImageScale;
            const imgHeight = mapImage.height * mapImageScale;

            // Konva rotates around the top-left corner by default
            // We need to adjust position to keep the image in the same place after rotation
            let x = 0, y = 0;
            const scaleX = mapTransform.flipH ? -1 : 1;
            const scaleY = mapTransform.flipV ? -1 : 1;

            // Handle rotation positioning
            switch (mapTransform.rotation) {
              case 90:
                x = imgHeight;
                y = 0;
                break;
              case 180:
                x = imgWidth;
                y = imgHeight;
                break;
              case 270:
                x = 0;
                y = imgWidth;
                break;
              default: // 0
                x = 0;
                y = 0;
            }

            // Adjust for horizontal flip
            if (mapTransform.flipH) {
              if (mapTransform.rotation === 0 || mapTransform.rotation === 180) {
                x += imgWidth * (mapTransform.rotation === 0 ? 1 : -1);
              } else {
                y += imgWidth * (mapTransform.rotation === 90 ? 1 : -1);
              }
            }

            // Adjust for vertical flip
            if (mapTransform.flipV) {
              if (mapTransform.rotation === 0 || mapTransform.rotation === 180) {
                y += imgHeight * (mapTransform.rotation === 0 ? 1 : -1);
              } else {
                x += imgHeight * (mapTransform.rotation === 270 ? 1 : -1);
              }
            }

            return (
              <KonvaImage
                image={mapImage}
                x={x}
                y={y}
                width={imgWidth}
                height={imgHeight}
                rotation={mapTransform.rotation}
                scaleX={scaleX}
                scaleY={scaleY}
                opacity={0.8}
              />
            );
          })()}

          <MapGrid showGrid={showGrid} mapImage={mapImage} mapImageScale={mapImageScale} viewportBounds={viewportBounds} />
        </Layer>

        <Layer key="effects-layer">
          {/* Terrain Layer - DM always sees; players only when DM enables visibility */}
          {terrainVisible && (
            <TerrainLayer
              terrainData={terrainData}
              gridSize={GRID_SIZE}
              stageScale={stageScale}
            />
          )}

          {/* Aura Layer - below tokens, above grid */}
          <AuraLayer
            tokens={tokens}
            auraVisuals={auraVisuals}
            gridSize={GRID_SIZE}
            stageScale={stageScale}
          />

          {/* Illumination Layer - light/darkness effects from spells */}
          <IlluminationLayer
            tokens={tokens}
            gridSize={GRID_SIZE}
            gridUnitLength={gridUnitLength}
            currentMapUrl={currentMapUrl}
            currentWorldTime={timeOfDay}
          />

          {/* Active Spell Areas Layer - persistent concentration spell effects */}
          <ActiveSpellAreasLayer
            tokens={tokens}
            gridSize={GRID_SIZE}
            gridUnitLength={gridUnitLength}
            currentMapUrl={currentMapUrl}
            currentWorldTime={timeOfDay}
            isDM={isDM}
            userId={userId}
            onMoveArea={handleMoveSpellArea}
          />

          {/* Obscurement Overlay - fog/cloud visual effects from spells */}
          <ObscurementOverlayLayer
            zones={obscurementZones}
            gridSize={GRID_SIZE}
            gridUnitLength={gridUnitLength}
            isDM={isDM}
          />

          {/* Movement Range Overlay */}
          {movementOverlayCells?.map((cell) => (
            <Rect
              key={cell.key}
              x={cell.x}
              y={cell.y}
              width={cell.width}
              height={cell.height}
              fill={cell.fill}
              stroke={cell.stroke}
              strokeWidth={cell.strokeWidth}
              listening={false}
            />
          ))}

          <MapTargetingOverlayLayer
            tokens={tokens}
            gridUnitLength={gridUnitLength}
            hotbarTargeting={hotbarTargeting}
            hotbarCursorInfo={hotbarCursorInfo}
            attackDistanceLine={attackDistanceLine}
            selectionContextSourceToken={selectionContextMenu?.sourceToken}
            selectionContextTargetToken={selectionContextMenu?.targetToken}
            monsterActionTargeting={monsterActionTargeting}
            monsterActionCursorInfo={monsterActionCursorInfo}
            invokeDuplicityPlacementMode={invokeDuplicityPlacementMode}
            areaSpellMode={areaSpellMode}
            areaSpellAffectedTokenIds={areaSpellAffectedTokenIds}
            isReadyToCast={isReadyToCast}
            getInvokeDuplicityDuplicateTokens={getInvokeDuplicityDuplicateTokens}
            showRuntimeOverlays={false}
          />

        </Layer>

        {/* Token layer also carries markers so the Stage stays within Konva's layer guideline. */}
        <MapTokenLayer
          visibleTokens={visibleTokens}
          tokens={tokens}
          markers={markers}
          isDM={isDM}
          userId={userId}
          selectedTool={selectedTool}
          tokenMode={tokenMode}
          disableDrag={!!mobileActionModal || !!selectionContextMenu}
          selectedTokenId={selectedTokenId}
          combatActiveTokenId={combatActiveTokenId}
          tokenStatusEffects={tokenStatusEffects}
          pendingManeuvers={pendingManeuvers}
          hotbarTargeting={hotbarTargeting}
          hoveredTokenId={hoveredTokenId}
          areaSpellAffectedTokenIds={areaSpellAffectedTokenIds}
          areaSpellTargetStroke={areaSpellTargetStroke}
          onHoveredTokenEnter={handleHoveredTokenEnter}
          onHoveredTokenLeave={handleHoveredTokenLeave}
          onTokenStatusEffectClick={handleTokenStatusEffectClick}
          onTokenConcentrationSpellClick={handleTokenConcentrationSpellClick}
          onTokenCastingSpellClick={handleTokenCastingSpellClick}
          onTokenCastingModeInfoClick={handleTokenCastingModeInfoClick}
          onTokenConcentrationInfoClick={handleTokenConcentrationInfoClick}
          onTokenConcentrationDurationChange={handleTokenConcentrationDurationChange}
          onTokenConcentrationDurationEdit={handleTokenConcentrationDurationEdit}
          onTokenConcentrationBreak={handleTokenConcentrationBreak}
          onTokenCastingCancel={handleTokenCastingCancel}
          onTokenCastingCompleteNow={handleTokenCastingCompleteNow}
          onTokenStatusEffectRemove={handleTokenStatusEffectRemove}
          onOngoingSave={handleOngoingSave}
          onConditionSave={handleConditionSave}
          onEscapeAttempt={handleEscapeAttempt}
          onStandUp={handleStandUp}
          onTokenSelect={handleTokenSelect}
          onTokenDragEnd={handleTokenDragEnd}
          onTokenOpen={handleTokenOpen}
          currentTime={timeOfDay}
          selectedMarkerId={selectedMarkerId}
          onMarkerClick={handleMarkerClick}
          anchorPosition={anchorPosition}
          areaSpellMode={areaSpellMode}
          invokeDuplicityPlacementMode={invokeDuplicityPlacementMode}
        />

        {/* Drawings Layer (above markers for visibility) */}
        <DrawingsLayer
          canvasWidth={mapImage ? mapImage.width * mapImageScale : MAP_WIDTH * GRID_SIZE}
          canvasHeight={mapImage ? mapImage.height * mapImageScale : MAP_HEIGHT * GRID_SIZE}
          gridSize={GRID_SIZE}
          drawings={drawings}
          isEnabled={selectedTool === "draw"}
          isDM={isDM}
          currentUserId={userId || ""}
          tool={drawTool}
          drawColor={drawColor}
          drawStrokeWidth={drawStrokeWidth}
          onDrawingAdd={handleDrawingAdd}
          onDrawingRemove={handleDrawingRemove}
          onDrawStrokeWidthChange={onDrawStrokeWidthChange}
        />

        <Layer key="ui-overlay-layer" listening={false}>
          {/* Night/Dawn/Dusk overlay with environment mode support */}
          {timeOfDay && (
            <NightOverlayLayer
              tokens={tokens}
              gridSize={GRID_SIZE}
              gridUnitLength={gridUnitLength}
              currentMapUrl={currentMapUrl}
              timeOfDay={timeOfDay}
              stagePos={stagePos}
              stageScale={stageScale}
              stageSize={stageSize}
            />
          )}

          <MapTargetingOverlayLayer
            tokens={tokens}
            gridUnitLength={gridUnitLength}
            hotbarTargeting={hotbarTargeting}
            hotbarCursorInfo={hotbarCursorInfo}
            attackDistanceLine={attackDistanceLine}
            selectionContextSourceToken={selectionContextMenu?.sourceToken}
            selectionContextTargetToken={selectionContextMenu?.targetToken}
            monsterActionTargeting={monsterActionTargeting}
            monsterActionCursorInfo={monsterActionCursorInfo}
            invokeDuplicityPlacementMode={invokeDuplicityPlacementMode}
            areaSpellMode={areaSpellMode}
            areaSpellAffectedTokenIds={areaSpellAffectedTokenIds}
            isReadyToCast={isReadyToCast}
            getInvokeDuplicityDuplicateTokens={getInvokeDuplicityDuplicateTokens}
            showRangeOverlays={false}
          />
        </Layer>
      </Stage>
      )}

      {/* AI-generated Map Marker Overlay */}
      {showAIMarkers && mapImage && (
        <AIMapMarkerOverlay
          campaignId={parseInt(campaignId) || undefined}
          mapUrl={currentMapUrl || undefined}
          mapWidth={mapImage.width * mapImageScale}
          mapHeight={mapImage.height * mapImageScale}
          stageScale={stageScale}
          stageX={stagePos.x}
          stageY={stagePos.y}
        />
      )}

      {/* Universal Token Modal */}
      <TokenModal
        token={tokens.find((t) => t.id === activeTokenId) || null}
        isOpen={activeTokenId !== null}
        onClose={() => setActiveTokenId(null)}
        isDM={isDM}
        campaignId={campaignId}
        currentUserId={userId}
        selectedCharacterId={selectedCharacterId}
        activeEffects={activeTokenId ? (tokenStatusEffects[activeTokenId] || []) : []}
        onRemoveEffect={activeTokenId ? (effectId) => handleEditEffectDuration(activeTokenId, effectId, 0) : undefined}
        onEscapeAttempt={handleEscapeAttempt}
        onOngoingSave={handleOngoingSave}
        onConditionSave={handleConditionSave}
        onWakeUp={handleWakeUp}
        onStandUp={handleStandUp}
        setEditingTokenId={setEditingTokenId}
        setEditingTokenHP={setEditingTokenHP}
        onUpdateHP={handleUpdateHP}
        onDeleteToken={handleRemoveToken}
      />

      {/* DM Floating Token Panels */}
      {isDM && floatingTokenPanels.map(panelConfig => {
        const panelToken = tokens.find(t => t.id === panelConfig.tokenId);
        if (!panelToken) return null;
        return (
          <FloatingTokenPanel
            key={panelConfig.tokenId}
            config={panelConfig}
            token={panelToken}
            campaignId={campaignId}
            currentUserId={userId}
            currentWorldTime={timeOfDay as any}
            selectedCharacterId={selectedCharacterId}
            activeEffects={tokenStatusEffects[panelConfig.tokenId] || []}
            onRemoveEffect={(effectId) => handleEditEffectDuration(panelConfig.tokenId, effectId, 0)}
            onEscapeAttempt={handleEscapeAttempt}
            onOngoingSave={handleOngoingSave}
            onConditionSave={handleConditionSave}
            onWakeUp={handleWakeUp}
            onStandUp={handleStandUp}
            auraVisuals={auraVisuals}
            onDeleteToken={handleRemoveToken}
          />
        );
      })}

      {/* Token Params Editor (DM-only) */}
      {isDM && (
        <TokenParamsEditor
          token={tokens.find((t) => t.id === (editingParamsTokenId ?? -1)) || null}
          open={editingParamsTokenId !== null}
          onClose={() => setEditingParamsTokenId(null)}
          onSave={(params) => {
            const tid = editingParamsTokenId;
            if (tid == null) return;
            // Update local state
            setTokens((prev) => prev.map((t) => (t.id === tid ? { ...t, params: { ...(t as any).params, ...params } } : t)));
            // Broadcast via WS
	            sendMessage({ type: 'token_params_update', data: { token_id: tid, params } });
            setEditingParamsTokenId(null);
          }}
        />
      )}

      <MapSpecialActionDialogs
        isDM={isDM}
        campaignId={campaignId}
        userId={userId}
        selectedCharacterId={selectedCharacterId}
        currentMapUrl={currentMapUrl}
        gridUnitLength={gridUnitLength}
        tokens={tokens}
        playerAvatars={playerAvatars}
        playerNoteTokenId={playerNoteTokenId}
        playerNoteToken={playerNoteToken}
        setPlayerNoteTokenId={setPlayerNoteTokenId}
        illusionEditTokenId={illusionEditTokenId}
        illusionEditToken={illusionEditToken}
        setIllusionEditTokenId={setIllusionEditTokenId}
        setTokens={setTokens}
        itemDetailToken={itemDetailToken}
        setItemDetailTokenId={setItemDetailTokenId}
        handlePickupItem={handlePickupItem}
        handleDeleteItem={handleDeleteItem}
        lootBagToken={lootBagToken}
        setLootBagTokenId={setLootBagTokenId}
        handleLootFromBag={handleLootFromBag}
        handleDeleteLootBag={handleDeleteLootBag}
        shopToken={shopToken}
        setShopTokenModalId={setShopTokenModalId}
        handleDeleteShopToken={handleDeleteShopToken}
        shopTxnOpen={shopTxnOpen}
        handleShopTxnOpenChange={handleShopTxnOpenChange}
        shopTxnShop={shopTxnShop}
        shopTxnTokenId={shopTxnTokenId}
        chestModalOpen={chestModalOpen}
        handleChestModalOpenChange={handleChestModalOpenChange}
        chestModalChest={chestModalChest}
        chestModalCharacters={chestModalCharacters}
        setChestModalChest={setChestModalChest}
        chestManageModalOpen={chestManageModalOpen}
        handleChestManageModalOpenChange={handleChestManageModalOpenChange}
        chestManageChest={chestManageChest}
        transformModalOpen={transformModalOpen}
        setTransformModalOpen={setTransformModalOpen}
        transformTokenId={transformTokenId}
        setTransformTokenId={setTransformTokenId}
        transformTokenIdRef={transformTokenIdRef}
        transformConfigId={transformConfigId}
        handleTransformComplete={handleTransformComplete}
        sourceCharacterData={sourceCharacterData}
        preserveLifeModal={preserveLifeModal}
        setPreserveLifeModal={setPreserveLifeModal}
        handlePreserveLifeConfirm={handlePreserveLifeConfirm}
        dampenElementsModal={dampenElementsModal}
        setDampenElementsModal={setDampenElementsModal}
        handleDampenElementsConfirm={handleDampenElementsConfirm}
        wrathOfTheStormModal={wrathOfTheStormModal}
        setWrathOfTheStormModal={setWrathOfTheStormModal}
        handleWrathOfTheStormConfirm={handleWrathOfTheStormConfirm}
        toolCheckRequest={toolCheckRequest}
        setToolCheckRequest={setToolCheckRequest}
        handleSubmitToolCheck={handleSubmitToolCheck}
        knowledgeOfTheAgesModal={knowledgeOfTheAgesModal}
        setKnowledgeOfTheAgesModal={setKnowledgeOfTheAgesModal}
        handleKnowledgeOfTheAgesConfirm={handleKnowledgeOfTheAgesConfirm}
        visionsOfThePastModal={visionsOfThePastModal}
        setVisionsOfThePastModal={setVisionsOfThePastModal}
        handleVisionsOfThePastConfirm={handleVisionsOfThePastConfirm}
        invokeDuplicityModal={invokeDuplicityModal}
        setInvokeDuplicityModal={setInvokeDuplicityModal}
        handleInvokeDuplicityModalConfirm={handleInvokeDuplicityModalConfirm}
        zoneSpellSettlementOpen={zoneSpellSettlementOpen}
        setZoneSpellSettlementOpen={setZoneSpellSettlementOpen}
        zoneSpellSettlementCasterId={zoneSpellSettlementCasterId}
        setZoneSpellSettlementCasterId={setZoneSpellSettlementCasterId}
        sendMessage={sendMessage}
        concentrationSpellDetail={concentrationSpellDetail}
        setConcentrationSpellDetail={setConcentrationSpellDetail}
      />

      <MapStatusDialogs
        showConcentrationRulesInfo={showConcentrationRulesInfo}
        ritualCastingInfo={ritualCastingInfo}
        statusEffectDetail={statusEffectDetail}
        statusEffectRemoveConfirm={statusEffectRemoveConfirm}
        castingCancelConfirm={castingCancelConfirm}
        castingCompleteConfirm={castingCompleteConfirm}
        concBreakConfirm={concBreakConfirm}
        concDurationEdit={concDurationEdit}
        concDurationInput={concDurationInput}
        setShowConcentrationRulesInfo={setShowConcentrationRulesInfo}
        setRitualCastingInfo={setRitualCastingInfo}
        setStatusEffectDetail={setStatusEffectDetail}
        setStatusEffectRemoveConfirm={setStatusEffectRemoveConfirm}
        setCastingCancelConfirm={setCastingCancelConfirm}
        setCastingCompleteConfirm={setCastingCompleteConfirm}
        setConcBreakConfirm={setConcBreakConfirm}
        setConcDurationEdit={setConcDurationEdit}
        setConcDurationInput={setConcDurationInput}
        onConfirmStatusEffectRemove={handleConfirmStatusEffectRemove}
        onConfirmCastingCancel={handleConfirmCastingCancel}
        onConfirmCastingComplete={handleConfirmCastingComplete}
        onConfirmConcentrationBreak={handleConfirmConcentrationBreak}
        onConfirmConcentrationDurationEdit={handleConfirmConcentrationDurationEdit}
      />

      <MapActionMenus
        isDM={isDM}
        userId={userId}
        selectedCharacterId={selectedCharacterId}
        currentMapUrl={currentMapUrl}
        tokens={tokens}
        contextMenu={contextMenu}
        mobileActionModal={mobileActionModal}
        tokenContextMenu={tokenContextMenu}
        playerContextMenu={playerContextMenu}
        monsters={monsters}
        campaignItems={campaignItems}
        npcs={npcs}
        shops={shops}
        playerCharacters={playerAvatars}
        playerSpellData={playerSpellData}
        playerAbilities={playerAbilities}
        playerReactions={playerReactions}
        openTokenPanel={openTokenPanel}
        setContextMenu={setContextMenu}
        setMobileActionModal={setMobileActionModal}
        setTokenContextMenu={setTokenContextMenu}
        setPlayerContextMenu={setPlayerContextMenu}
        setZoneSpellSettlementCasterId={setZoneSpellSettlementCasterId}
        setZoneSpellSettlementOpen={setZoneSpellSettlementOpen}
        handlePlaceMonster={handlePlaceMonster}
        handlePlaceCurrency={handlePlaceCurrency}
        handlePlaceItem={handlePlaceItem}
        handlePlaceNPC={handlePlaceNPC}
        handlePlaceShop={handlePlaceShop}
        handlePlaceCharacter={handlePlaceCharacter}
        handleRemoveToken={handleRemoveToken}
        handlePlayerMove={handlePlayerMove}
        handlePlayerCastSpell={handlePlayerCastSpell}
        handlePlayerUseAbility={handlePlayerUseAbility}
        handlePlayerToggleReaction={handlePlayerToggleReaction}
      />

      <MapSelectionMenuLayer
        selectionContextMenu={selectionContextMenu}
        isDM={isDM}
        campaignId={campaignId}
        userId={userId}
        tokens={tokens}
        sourceMonsterData={sourceMonsterData}
        sourceCharacterData={sourceCharacterData}
        companionMonsterDataMap={companionMonsterDataMap}
        tokenStatusEffects={tokenStatusEffects}
        pendingManeuvers={pendingManeuvers}
        targetChestData={targetChestData}
        gridUnitLength={gridUnitLength}
        globalTerrain={globalTerrain}
        manualReactionMode={manualReactionMode}
        tokenRollModifier={tokenRollModifier}
        obscurementZones={obscurementZones}
        setTokenRollModifier={setTokenRollModifier}
        sendMessage={sendMessage}
        authedFetch={authedFetch}
        setSelectionContextMenu={setSelectionContextMenu}
        setSelectedTokenId={setSelectedTokenId}
        setActiveTokenId={setActiveTokenId}
        setEditingTokenId={setEditingTokenId}
        setEditingTokenHP={setEditingTokenHP}
        setEditingTokenMaxHP={setEditingTokenMaxHP}
        setManualReactionMode={setManualReactionMode}
        openTokenPanel={openTokenPanel}
        handleRemoveToken={handleRemoveToken}
        handleSelectionMoveTo={handleSelectionMoveTo}
        handleSelectionStandardAction={handleSelectionStandardAction}
        handleSelectionMonsterAction={handleSelectionMonsterAction}
        handleAttackAction={handleAttackAction}
        handleSpellAction={handleSpellAction}
        handleBonusAction={handleBonusAction}
        handleManeuverAction={handleManeuverAction}
        cancelPendingManeuver={cancelPendingManeuver}
        handleEditEffectDuration={handleEditEffectDuration}
        handleEditActionUses={handleEditActionUses}
        handleSelectionPickupItem={handleSelectionPickupItem}
        handleRangerAbility={handleRangerAbility}
        handleAreaSpellSelect={handleAreaSpellSelect}
        handleWildShape={handleWildShape}
        handleEndWildShape={handleEndWildShape}
        handleTransform={handleTransform}
        handleEndTransformation={handleEndTransformation}
        handleEscapeAttempt={handleEscapeAttempt}
        handleOngoingSave={handleOngoingSave}
        handleConditionSave={handleConditionSave}
        handleWakeUp={handleWakeUp}
        handleUseConsumable={handleUseConsumable}
        handleOpenToolCheck={handleOpenToolCheck}
        onTrade={onTrade}
        handleBlindAttack={handleBlindAttack}
      />

      <MapPlayerSpellDialog
        playerSpellDialog={playerSpellDialog}
        setPlayerSpellDialog={setPlayerSpellDialog}
        playerSpellData={playerSpellData}
        sourceCharacterData={sourceCharacterData}
        tokens={tokens}
        selectedCharacterId={selectedCharacterId}
        userId={userId}
        tokenStatusEffects={tokenStatusEffects}
        campaignId={campaignId}
        handlePlayerSpellDialogCast={handlePlayerSpellDialogCast}
      />

      <MapMarkerAndConfirmDialogs
        isDM={isDM}
        showMarkerDialog={showMarkerDialog}
        pendingMarkerPos={pendingMarkerPos}
        markerIcon={markerIcon}
        markerColor={markerColor}
        markerLabelInput={markerLabelInput}
        selectedMarkerId={selectedMarkerId}
        rangeConfirmModal={rangeConfirmModal}
        moveConfirmModal={moveConfirmModal}
        setShowMarkerDialog={setShowMarkerDialog}
        setPendingMarkerPos={setPendingMarkerPos}
        setMarkerLabelInput={setMarkerLabelInput}
        setSelectedMarkerId={setSelectedMarkerId}
        handleCreateMarker={handleCreateMarker}
        handleDeleteMarker={handleDeleteMarker}
        handleRangeCancel={handleRangeCancel}
        handleRangeConfirm={handleRangeConfirm}
        handleMoveCancel={handleMoveCancel}
        handleMoveConfirm={handleMoveConfirm}
      />
    </div>
  );
}
