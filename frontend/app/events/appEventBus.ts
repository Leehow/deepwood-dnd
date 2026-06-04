import type { AttackOption, MonsterAction } from "~/components/map/SelectionContextMenu";

export interface CharacterUpdatedEventPayload {
  character_id?: number | string;
  user_id?: string;
  updates?: Record<string, unknown>;
  reason?: string;
  data?: {
    character_id?: number | string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CharacterLevelUpEventPayload {
  character_id: number | string;
  character_name: string;
  user_id?: string;
  level: number;
  class_id: string;
  subclass_id?: string;
  ability_scores?: Record<string, number>;
  current_hp?: number;
  max_hp?: number;
  timestamp?: string;
  [key: string]: unknown;
}

export interface CharacterLevelChangedEventPayload {
  character_id?: number | string;
  character_name?: string;
  user_id?: string;
  level?: number;
  class_id?: string;
  subclass_id?: string;
  data?: {
    character_id?: number | string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CharacterListNeedsRefreshEventPayload {
  type?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CharacterCreatedEventPayload {
  user_id?: string;
  character_id?: number | string;
  character_name?: string;
  [key: string]: unknown;
}

export interface CharacterSelectedEventPayload {
  user_id?: string;
  character_id?: number | string;
  data?: {
    character_id?: number | string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface AiGenerateProgressEventPayload {
  stage?: number;
  total_stages?: number;
  stage_name?: string;
  detail?: string;
  [key: string]: unknown;
}

export interface DmGenerateProgressEventPayload {
  stage?: number;
  stage_name?: string;
  detail?: string;
  [key: string]: unknown;
}

export interface SpellSlotsUpdateEventPayload {
  character_id?: number | string;
  spell_slots_state?: unknown;
  data?: {
    character_id?: number | string;
    spell_slots_state?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CharacterEquipmentUpdatedEventPayload {
  characterId?: number | string;
  equipment?: unknown;
  currency?: Record<string, number>;
  needsBroadcast?: boolean;
  [key: string]: unknown;
}

export interface EquipmentConsumableUseEventPayload {
  characterId: number | string;
  item: unknown;
  [key: string]: unknown;
}

export interface ClassFeatureUsesUpdatedEventPayload {
  characterId?: number | string;
  featureId?: string;
  currentUses?: number;
  maxUses?: number;
  [key: string]: unknown;
}

export interface CharacterConcentrationChangedEventPayload {
  characterId?: number | string;
  tokenId?: number | string;
  concentrationSpell?: {
    spell_id?: string;
    spell_name?: string;
    slot_level?: number | null;
  } | null;
  [key: string]: unknown;
}

export interface CharacterCastingChangedEventPayload {
  characterId?: number | string;
  tokenId?: number | string;
  castingInProgress?: {
    spell_name?: string;
  } | null;
  [key: string]: unknown;
}

export interface CharacterActiveEffectsChangedEventPayload {
  characterId: number | string;
  activeEffects?: unknown[];
  reload?: boolean;
}

export interface CharacterHpUpdatedEventPayload {
  characterId: number | string;
  current_hp?: number | null;
  max_hp?: number | null;
  temp_hp?: number | null;
}

export interface TransformationUpdateEventPayload {
  characterId: number | string;
  wildShapeData?: unknown;
}

export interface TokenPlacedEventPayload {
  token: unknown;
}

export interface TokenUpdatedEventPayload {
  token: unknown;
}

export interface TokenRemovedEventPayload {
  tokenId: number;
}

export interface ChestCreatedEventPayload {
  chest?: unknown;
}

export interface ChestStateChangedEventPayload {
  chest?: unknown;
  eventType?: string;
}

export interface MonsterStatusEffectsChangedEventPayload {
  monsterInstanceId: number;
  statusEffects: unknown;
}

export interface CharacterStatusEffectsChangedEventPayload {
  characterId: number | string;
  statusEffects: unknown;
}

export interface DeathSaveUpdateEventPayload {
  token_id: number;
  death_saves?: {
    successes: number;
    failures: number;
    stabilized: boolean;
  };
  revived?: boolean;
  roll?: number;
}

export interface SpellSlotsChangedEventPayload {
  characterId: number | string;
  remaining: number[];
  max: number[];
}

export interface RestGrantEventPayload {
  restType?: "short" | "long";
  type?: "short" | "long";
  rest_type?: "short" | "long";
  [key: string]: unknown;
}

export interface ConsumeSpellSlotEventPayload {
  level: number;
  characterId: number | string;
  [key: string]: unknown;
}

export interface StartAbilityTargetingEventPayload {
  abilityId?: string;
  poolCurrent?: number;
  poolMax?: number;
  sourceCharacterId?: number;
  spellSlotLevel?: number;
  [key: string]: unknown;
}

export interface StartSpellTargetingEventPayload {
  spell: any;
  slotLevel: number;
  characterId: number;
  mode?: "area" | "single";
  freecast?: boolean;
  ritualCast?: boolean;
  illusionImageUrl?: string;
  illusionDesc?: string;
  illusionDisplayName?: string;
  selectedOption?: string;
  materialId?: string;
  isGrantedAction?: boolean;
  sourceSpellName?: string;
  /** Long-cast / ritual cast: instead of resolving the spell when targeting
   *  completes, the controllers must POST `/api/spells/start-cast` with the
   *  selected target_token_ids or area_effect so `casting_in_progress` keeps
   *  the placement and the ready-cast release flow can use it later. */
  longCast?: boolean;
  /** Forwarded confirmation that an existing concentration may be replaced
   *  by the new long cast (the user already accepted in SpellCastActions). */
  confirmBreakConcentration?: boolean;
  [key: string]: unknown;
}

export interface SidebarSpellCastEventPayload {
  spell: any;
  sourceTokenId: number;
  targetTokenId?: number;
  /** Multi-target spell ids (additive — supersedes targetTokenId when provided). */
  targetTokenIds?: number[];
  slotLevel: number;
  characterId: number;
  freecast?: boolean;
  ritualCast?: boolean;
  illusionImageUrl?: string;
  illusionDesc?: string;
  illusionDisplayName?: string;
  selectedOption?: string;
  materialId?: string;
  /** Long-cast / ritual cast: see StartSpellTargetingEventPayload.longCast. */
  longCast?: boolean;
  confirmBreakConcentration?: boolean;
  [key: string]: unknown;
}

export interface SpellCastStartedEventPayload {
  characterId: number | string;
  tokenId: number;
  spell: any;
  level: number;
  ritualCast?: boolean;
  response?: unknown;
  [key: string]: unknown;
}

export interface HotbarBridgeItemPayload {
  type: string;
  id: string | number;
  name: string;
  icon?: string;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HotbarAddItemEventPayload extends HotbarBridgeItemPayload {}

export interface HotbarDropToSlotEventPayload {
  slotIdx: number;
  item: HotbarBridgeItemPayload;
  [key: string]: unknown;
}

export interface CombatActionUsedEventPayload {
  type?: string;
  amount?: number;
  tokenId?: number;
  [key: string]: unknown;
}

export interface AttackDistanceLineEventPayload {
  normalRange: number;
  maxRange: number;
  sourceTokenId?: number;
}

export interface HotbarAttackExecuteEventPayload {
  sourceCharacterId: number | string;
  targetTokenId: number;
  attack: AttackOption;
  modifiers?: {
    powerAttack?: boolean;
    useLucky?: boolean;
    [key: string]: unknown;
  };
}

export interface MonsterActionTargetingEventPayload {
  action: MonsterAction;
  sourceTokenId: number;
  normalRange: number;
  maxRange: number;
}

export interface StartMonsterAreaActionEventPayload {
  sourceTokenId: number;
  actionName: string;
  breathWeapon: {
    shape: string;
    size: string;
    save: string;
    saveCn: string;
    shapeCn: string;
  };
  damageType: string;
  damageTypeCn: string;
  damageDice: string;
  saveDC: number;
  saveEffect: string;
}

export interface StartBreathWeaponEventPayload {
  sourceCharacterId: number;
  breathWeapon: {
    shape: string;
    size: string;
    save: string;
    saveCn: string;
    shapeCn: string;
  };
  damageType: string;
  damageTypeCn: string;
  damageDice: string;
  subraceName: string;
  saveDC: number;
}

export interface CombatMoveResultEventPayload {
  tokenId: number;
  tokenName: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  distance: number;
}

export interface TokenPerformedActionEventPayload {
  tokenId: number;
}

export interface CombatMovementChangedEventPayload {
  changedBy?: string;
}

export interface CombatTurnChangedEventPayload {
  activeTokenId?: number | null;
  round?: number;
}

export interface CombatTurnStartedEventPayload {
  tokenId: number;
  round: number;
}

export interface CombatTurnEndingEventPayload {
  tokenId: number;
  round: number;
}

export interface CombatEndTurnEventPayload {
  source?: string;
}

export interface CombatRestoreMovementEventPayload {
  tokenId: number;
  toX: number;
  toY: number;
  restoreDistance: number;
}

export interface CombatNewRoundEventPayload {
  round: number;
}

export interface CombatTurnNotificationEventPayload {
  name: string;
  round: number;
}

export interface CombatStorageUpdatedEventPayload {
  object_type?: string;
  object_id?: string;
  is_active?: boolean;
  data?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface CombatStorageDeletedEventPayload {
  data?: {
    object_type?: string;
    object_id?: string;
    [key: string]: unknown;
  };
  object_type?: string;
  object_id?: string;
  [key: string]: unknown;
}

export interface MapTokenSelectedEventPayload {
  tokenId: number | null;
}

export interface SelectCharacterFromMapEventPayload {
  characterId: number;
}

export interface OpenTokenParamsEditorEventPayload {
  tokenId: number;
}

export interface TokenHPUpdateEventPayload {
  characterId: number;
  currentHp?: number;
  maxHp?: number;
}

export interface SelectTokenByCharacterIdEventPayload {
  characterId: number;
}

export interface RemoveCharacterTokensEventPayload {
  characterId: number;
}

export interface FocusOrCreateTokenEventPayload {
  characterId: number;
  name?: string;
}

export interface AnchorPlacedEventPayload {
  [key: string]: unknown;
}

export interface MonsterAvatarUpdatedEventPayload {
  monsterInstanceId: number;
  avatarUrl: string;
}

export interface RollModifierUpdatedEventPayload {
  tokenId: number;
  modifier: "advantage" | "disadvantage" | null;
  senderId?: string;
}

export interface ManualReactionModeChangedEventPayload {
  active: boolean;
  sourceTokenId?: number;
}

export interface ManualReactionModeStartEventPayload {
  sourceTokenId: number;
  sourceCharacterId?: number | null;
}

export interface ManualReactionModeEndEventPayload {
  sourceTokenId?: number;
}

export interface RewardUpdateEventPayload {
  [key: string]: unknown;
}

export interface CharacterBubbleEventPayload {
  characterId: number | string;
  characterName: string;
  message: string;
  type: "chat" | "dice" | "action" | "combat";
  diceResult?: number;
  diceExpression?: string;
  messageId?: string;
  senderUserId?: string;
  avatarUrl?: string;
  timestamp: number;
}

export interface ReplyToMessageEventPayload {
  messageId: string;
  senderUserId: string;
  senderName: string;
  content: string;
}

export interface StartPrivateMessageEventPayload {
  targetUserId: string;
  targetName: string;
}

export interface DmDiceRequestEventPayload {
  requestId: string;
  messageId: string;
  checkType: "check" | "save" | "contest";
  skill?: string;
  ability?: string;
  dc?: number;
  dice?: string;
  description?: string;
  isPrivate: boolean;
  timestamp: number;
}

export interface DmDiceRequestRespondEventPayload {
  requestId: string;
  messageId: string;
  companionActor?: {
    type: "monster";
    monster_instance_id: number;
    name: string;
  };
}

export interface DmDiceRequestDismissEventPayload {
  requestId: string;
}

export interface SpellCastChatEventPayload {
  message: string;
  characterId?: number | string;
  [key: string]: unknown;
}

export interface WsChatMessageEventPayload {
  user_id?: number | string;
  [key: string]: unknown;
}

export interface OpenShopTransactionEventPayload {
  shopId: number;
  tokenId?: number;
}

export interface OpenShopTokenModalEventPayload {
  tokenId: number;
}

export interface OpenChestInteractionEventPayload {
  chestId: number;
  tokenId?: number;
}

export interface OpenChestManagementEventPayload {
  chestId: number;
  tokenId?: number;
}

export interface ChestOpenEventPayload {
  chestId: number;
  tokenId?: number;
  characterId?: number;
}

export interface OpenRightPanelTabEventPayload {
  tab?: string;
  [key: string]: unknown;
}

export interface OpenCombatActionModalEventPayload {
  tokenId: number;
  [key: string]: unknown;
}

export interface ShowToastEventPayload {
  message: string;
  type?: "success" | "error" | "info" | "warning";
  duration?: number;
  slot?: string;
  [key: string]: unknown;
}

export interface LayOnHandsTargetEventPayload {
  sourceCharacterId: number;
  targetTokenId: number;
  targetName: string;
  targetCurrentHp?: number | null;
  targetMaxHp?: number | null;
  targetMonsterType?: string | null;
  distanceFeet: number;
  poolCurrent: number;
  poolMax: number;
}

export interface CombatReactionUsedEventPayload {
  reactor_token_id?: number;
  reaction_id?: string;
  [key: string]: unknown;
}

export interface CombatBonusActionResultEventPayload {
  tokenId: number;
  tokenName: string;
  actionName: string;
  actionIcon: string;
  [key: string]: unknown;
}

export interface CombatAttackResultEventPayload {
  message?: string;
  target_monster_instance_id?: number;
  xp_value?: number;
  auto_apply?: boolean;
  result: {
    attacker_name: string;
    attacker_token_id?: number;
    target_name: string;
    target_token_id?: number;
    attack_name: string;
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
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CombatBonusAttackGrantedEventPayload {
  message: string;
  [key: string]: unknown;
}

export interface PromptOnHitFeatureEventPayload {
  attackerTokenId: number;
  attackerName: string;
  attackerCharacterId: number;
  targetTokenId: number;
  targetName: string;
  classId: string;
  subclassId?: string | null;
  level: number;
  resources: Record<string, { current: number; max: number }>;
  hit: boolean;
  critical?: boolean;
}

export interface TriggeredFeatureUsedEventPayload {
  featureId: string;
  sourceName: string;
  targetName?: string;
  chatMessage: string;
  resourceId: string;
  amount: number;
}

export interface PromptDivineSmiteEventPayload {
  characterId: number;
  targetTokenId: number;
  targetName: string;
  baseDamage?: number;
  distanceFeet?: number;
  targetMonsterType?: string;
  [key: string]: unknown;
}

export interface WildShapeTargetEventPayload {
  sourceCharacterId: number;
  resourceId?: string;
  execution?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ArcaneRecoveryTargetEventPayload {
  sourceCharacterId: number;
  [key: string]: unknown;
}

export interface FlexibleCastingTargetEventPayload {
  sourceCharacterId: number;
  [key: string]: unknown;
}

export interface NaturalRecoveryTargetEventPayload {
  sourceCharacterId: number;
  [key: string]: unknown;
}

export interface EquipmentWeaponUseEventPayload {
  characterId: number | string;
  item: unknown;
  slot?: string;
  [key: string]: unknown;
}

export interface ForcedMovementPendingEventPayload {
  targetTokenId: number;
  effectId: string;
  sourceTokenId: number | null;
  direction: "push" | "pull" | "toward_point";
  distanceFeet: number;
  relativeTo: string | null;
  point: { x: number; y: number } | null;
  /** Server-truth active_effects list at the moment the intent was published.
   *  Consumers must use this when computing the cleared list so the POST is
   *  not racing against a stale React state snapshot. */
  activeEffectsSnapshot: ReadonlyArray<Record<string, unknown>>;
}

export interface AppEventMap {
  characterUpdated: CharacterUpdatedEventPayload;
  characterLevelUp: CharacterLevelUpEventPayload;
  characterLevelChanged: CharacterLevelChangedEventPayload;
  characterListNeedsRefresh: CharacterListNeedsRefreshEventPayload;
  characterCreated: CharacterCreatedEventPayload;
  characterSelected: CharacterSelectedEventPayload;
  aiGenerateProgress: AiGenerateProgressEventPayload;
  dmGenerateProgress: DmGenerateProgressEventPayload;
  spellSlotsUpdate: SpellSlotsUpdateEventPayload;
  characterEquipmentUpdated: CharacterEquipmentUpdatedEventPayload;
  equipmentConsumableUse: EquipmentConsumableUseEventPayload;
  classFeatureUsesUpdated: ClassFeatureUsesUpdatedEventPayload;
  characterConcentrationChanged: CharacterConcentrationChangedEventPayload;
  characterCastingChanged: CharacterCastingChangedEventPayload;
  characterActiveEffectsChanged: CharacterActiveEffectsChangedEventPayload;
  characterHPUpdated: CharacterHpUpdatedEventPayload;
  transformationUpdate: TransformationUpdateEventPayload;
  tokenPlaced: TokenPlacedEventPayload;
  tokenUpdated: TokenUpdatedEventPayload;
  tokenRemoved: TokenRemovedEventPayload;
  chestCreated: ChestCreatedEventPayload;
  chestStateChanged: ChestStateChangedEventPayload;
  monsterStatusEffectsChanged: MonsterStatusEffectsChangedEventPayload;
  characterStatusEffectsChanged: CharacterStatusEffectsChangedEventPayload;
  death_save_update: DeathSaveUpdateEventPayload;
  spellSlotsChanged: SpellSlotsChangedEventPayload;
  restGrant: RestGrantEventPayload;
  consumeSpellSlot: ConsumeSpellSlotEventPayload;
  startAbilityTargeting: StartAbilityTargetingEventPayload;
  startSpellTargeting: StartSpellTargetingEventPayload;
  sidebarSpellCast: SidebarSpellCastEventPayload;
  spellCastStarted: SpellCastStartedEventPayload;
  hotbarAddItem: HotbarAddItemEventPayload;
  hotbarDropToSlot: HotbarDropToSlotEventPayload;
  combatActionUsed: CombatActionUsedEventPayload;
  attackDistanceLine: AttackDistanceLineEventPayload | null;
  hotbarAttackExecute: HotbarAttackExecuteEventPayload;
  monsterActionTargeting: MonsterActionTargetingEventPayload | null;
  startMonsterAreaAction: StartMonsterAreaActionEventPayload;
  startBreathWeapon: StartBreathWeaponEventPayload;
  combatMoveResult: CombatMoveResultEventPayload;
  tokenPerformedAction: TokenPerformedActionEventPayload;
  combatMovementChanged: CombatMovementChangedEventPayload;
  combatTurnChanged: CombatTurnChangedEventPayload;
  combatTurnStarted: CombatTurnStartedEventPayload;
  combatTurnEnding: CombatTurnEndingEventPayload;
  combatEndTurn: CombatEndTurnEventPayload;
  combatRestoreMovement: CombatRestoreMovementEventPayload;
  combatNewRound: CombatNewRoundEventPayload;
  combatTurnNotification: CombatTurnNotificationEventPayload;
  combatStorageUpdated: CombatStorageUpdatedEventPayload;
  combatStorageDeleted: CombatStorageDeletedEventPayload;
  mapTokenSelected: MapTokenSelectedEventPayload;
  selectCharacterFromMap: SelectCharacterFromMapEventPayload;
  openTokenParamsEditor: OpenTokenParamsEditorEventPayload;
  tokenHPUpdate: TokenHPUpdateEventPayload;
  selectTokenByCharacterId: SelectTokenByCharacterIdEventPayload;
  removeCharacterTokens: RemoveCharacterTokensEventPayload;
  focusOrCreateToken: FocusOrCreateTokenEventPayload;
  anchorPlaced: AnchorPlacedEventPayload;
  monsterAvatarUpdated: MonsterAvatarUpdatedEventPayload;
  rollModifierUpdated: RollModifierUpdatedEventPayload;
  manualReactionModeStart: ManualReactionModeStartEventPayload;
  manualReactionModeEnd: ManualReactionModeEndEventPayload;
  manualReactionModeChanged: ManualReactionModeChangedEventPayload;
  characterBubble: CharacterBubbleEventPayload;
  replyToMessage: ReplyToMessageEventPayload;
  startPrivateMessage: StartPrivateMessageEventPayload;
  dmDiceRequest: DmDiceRequestEventPayload;
  dmDiceRequestRespond: DmDiceRequestRespondEventPayload;
  dmDiceRequestDismiss: DmDiceRequestDismissEventPayload;
  rewardUpdate: RewardUpdateEventPayload;
  spellCastChat: SpellCastChatEventPayload;
  wsChatMessage: WsChatMessageEventPayload;
  openShopTransaction: OpenShopTransactionEventPayload;
  openShopTokenModal: OpenShopTokenModalEventPayload;
  openChestInteraction: OpenChestInteractionEventPayload;
  openChestManagement: OpenChestManagementEventPayload;
  chestOpen: ChestOpenEventPayload;
  openRightPanelTab: OpenRightPanelTabEventPayload;
  openCombatActionModal: OpenCombatActionModalEventPayload;
  showToast: ShowToastEventPayload;
  layOnHandsTarget: LayOnHandsTargetEventPayload;
  combatReactionUsed: CombatReactionUsedEventPayload;
  combatBonusActionResult: CombatBonusActionResultEventPayload;
  combatAttackResult: CombatAttackResultEventPayload;
  combatBonusAttackGranted: CombatBonusAttackGrantedEventPayload;
  promptDivineSmite: PromptDivineSmiteEventPayload;
  wildShapeTarget: WildShapeTargetEventPayload;
  arcaneRecoveryTarget: ArcaneRecoveryTargetEventPayload;
  flexibleCastingTarget: FlexibleCastingTargetEventPayload;
  naturalRecoveryTarget: NaturalRecoveryTargetEventPayload;
  equipmentWeaponUse: EquipmentWeaponUseEventPayload;
  promptOnHitFeature: PromptOnHitFeatureEventPayload;
  triggeredFeatureUsed: TriggeredFeatureUsedEventPayload;
  forcedMovementPending: ForcedMovementPendingEventPayload;
}

export type AppEventName = keyof AppEventMap;
type AppEventListener<K extends AppEventName> = (detail: AppEventMap[K]) => void;

const listeners = new Map<AppEventName, Set<AppEventListener<any>>>();
const legacyEchoes = new WeakMap<object, Set<AppEventName>>();
const legacyEventNameOverrides: Partial<Record<AppEventName, string>> = {
  hotbarAddItem: "hotbar-add-item",
  hotbarDropToSlot: "hotbar-drop-to-slot",
  wsChatMessage: "ws-chat-message",
  characterLevelChanged: "characterLevelChanged",
  characterListNeedsRefresh: "characterListNeedsRefresh",
  characterCreated: "characterCreated",
  characterSelected: "characterSelected",
  aiGenerateProgress: "aiGenerateProgress",
  dmGenerateProgress: "dmGenerateProgress",
  spellSlotsUpdate: "spellSlotsUpdate",
};

function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function markLegacyEcho<K extends AppEventName>(eventName: K, detail: AppEventMap[K]) {
  if (!isObjectLike(detail)) {
    return;
  }
  const echoedNames = legacyEchoes.get(detail) ?? new Set<AppEventName>();
  echoedNames.add(eventName);
  legacyEchoes.set(detail, echoedNames);
  queueMicrotask(() => {
    const current = legacyEchoes.get(detail);
    if (!current) {
      return;
    }
    current.delete(eventName);
    if (current.size === 0) {
      legacyEchoes.delete(detail);
    }
  });
}

function wasEchoedFromBus<K extends AppEventName>(eventName: K, detail: AppEventMap[K]) {
  return isObjectLike(detail) && legacyEchoes.get(detail)?.has(eventName) === true;
}

function getLegacyEventNames<K extends AppEventName>(eventName: K): string[] {
  const overridden = legacyEventNameOverrides[eventName];
  return overridden && overridden !== eventName ? [eventName, overridden] : [eventName];
}

function notifyListeners<K extends AppEventName>(eventName: K, detail: AppEventMap[K]) {
  const eventListeners = listeners.get(eventName);
  if (!eventListeners || eventListeners.size === 0) {
    return;
  }
  for (const listener of eventListeners) {
    listener(detail);
  }
}

export function publishAppEvent<K extends AppEventName>(
  eventName: K,
  detail: AppEventMap[K],
): void {
  notifyListeners(eventName, detail);

  if (typeof window === "undefined") {
    return;
  }

  markLegacyEcho(eventName, detail);
  for (const legacyEventName of getLegacyEventNames(eventName)) {
    window.dispatchEvent(new CustomEvent(legacyEventName, { detail }));
  }
}

export function subscribeAppEvent<K extends AppEventName>(
  eventName: K,
  listener: AppEventListener<K>,
): () => void {
  const eventListeners = listeners.get(eventName) ?? new Set<AppEventListener<any>>();
  eventListeners.add(listener);
  listeners.set(eventName, eventListeners);

  let legacyHandler: ((event: Event) => void) | null = null;
  if (typeof window !== "undefined") {
    legacyHandler = (event: Event) => {
      const detail = (event as CustomEvent<AppEventMap[K]>).detail;
      if (wasEchoedFromBus(eventName, detail)) {
        return;
      }
      listener(detail);
    };
    for (const legacyEventName of getLegacyEventNames(eventName)) {
      window.addEventListener(legacyEventName, legacyHandler as EventListener);
    }
  }

  return () => {
    const currentListeners = listeners.get(eventName);
    currentListeners?.delete(listener);
    if (currentListeners && currentListeners.size === 0) {
      listeners.delete(eventName);
    }
    if (legacyHandler && typeof window !== "undefined") {
      for (const legacyEventName of getLegacyEventNames(eventName)) {
        window.removeEventListener(legacyEventName, legacyHandler as EventListener);
      }
    }
  };
}
