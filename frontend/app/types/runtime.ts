export interface RuntimeActiveEffect {
  id?: string | null;
  name?: string | null;
  icon?: string | null;
  color?: string | null;
  source?: string | null;
  spell_id?: string | null;
  spell_buff?: boolean | null;
  is_concentration?: boolean | null;
  duration?: number | null;
  expires_at?: {
    day?: number | null;
    hour?: number | null;
    minute?: number | null;
    second?: number | null;
  } | null;
  condition?: string | null;
  source_token_id?: number | null;
  uses_remaining?: number | null;
  armed?: boolean | null;
  ongoing_save?: {
    timing?: string | null;
    save_type?: string | null;
    dc?: number | null;
  } | null;
  escape_action?: {
    type?: string | null;
    ability?: string | null;
    dc?: number | null;
  } | null;
  break_conditions?: string[] | null;
  spell_save_dc?: number | null;
  [key: string]: unknown;
}

export interface RuntimeActiveAura {
  id?: string | null;
  radius?: number | null;
  source_cha_mod?: number | null;
  enabled?: boolean | null;
  [key: string]: unknown;
}

export interface RuntimeTransformationData {
  source?: Record<string, unknown> | null;
  type?: string | null;
  form?: Record<string, unknown> | null;
  modifiers?: Record<string, unknown>[] | null;
  formOverrides?: Record<string, unknown> | null;
  retainedStats?: Record<string, unknown> | null;
  started_at?: string | null;
  current_hp?: number | null;
  activeMode?: string | null;
  [key: string]: unknown;
}

export interface RuntimeConcentrationSpell {
  spell_id?: string | null;
  spell_name?: string | null;
  slot_level?: number | null;
  duration_rounds?: number | null;
  current_round?: number | null;
  affected_token_ids?: number[] | null;
  linked_token_ids?: number[] | null;
  con_save_bonus?: number | null;
  has_advantage?: boolean | null;
  extra_bonus_source?: string | null;
  area_effect?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface RuntimeCastingInProgress {
  spell_id?: string | null;
  spell_name?: string | null;
  slot_level?: number | null;
  cast_mode?: "normal" | "ritual" | string | null;
  total_cast_seconds?: number | null;
  target_token_ids?: number[] | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface RuntimeDisguiseData {
  spell_id?: string | null;
  spell_name?: string | null;
  disguise_avatar?: string | null;
  description?: string | null;
  caster_character_id?: number | null;
  [key: string]: unknown;
}

export interface RuntimeDeathSaves {
  successes?: number;
  failures?: number;
  stabilized?: boolean;
  [key: string]: unknown;
}

export interface RuntimeCharacterFeatureUseState {
  current?: number | null;
  max?: number | null;
}

export type RuntimeCharacterFeatureUses = Record<string, RuntimeCharacterFeatureUseState>;

export interface RuntimeCharacterStatusEffects {
  custom_effects?: RuntimeActiveEffect[];
  active_conditions?: Array<Record<string, unknown>>;
  exhaustion_level?: number;
  [key: string]: unknown;
}

export interface RuntimeCombatEventSummary {
  type?: string | null;
  token_id?: number | null;
  target_token_id?: number | null;
  character_id?: number | null;
  result?: string | null;
  message?: string | null;
  round_number?: number | null;
  [key: string]: unknown;
}

export interface RuntimeCombatTurnState {
  token_id?: number | null;
  character_id?: number | null;
  monster_instance_id?: number | null;
  movement_used?: number | null;
  action_used?: boolean | null;
  bonus_action_used?: boolean | null;
  reaction_used?: boolean | null;
  [key: string]: unknown;
}

export interface RuntimeCombatParticipant {
  token_id?: number | null;
  character_id?: number | null;
  monster_instance_id?: number | null;
  initiative?: number | null;
  name?: string | null;
  faction?: number | null;
  is_active?: boolean | null;
  [key: string]: unknown;
}

export interface RuntimeCombatStorage {
  in_combat?: boolean;
  round_number?: number;
  current_turn_index?: number;
  current_turn_token_id?: number;
  initiative_order?: RuntimeCombatParticipant[] | null;
  combatants?: RuntimeCombatParticipant[] | null;
  active_turn?: RuntimeCombatTurnState | null;
  movement_state?: Record<string, unknown> | null;
  last_attack_result?: RuntimeCombatEventSummary | null;
  last_move_result?: RuntimeCombatEventSummary | null;
  status?: string | null;
  order?: number[] | null;
  current_index?: number | null;
  participants?: RuntimeCombatParticipant[] | null;
  round?: number | null;
  turn_actions?: Record<string, unknown> | null;
  participant_turn_actions?: Record<string, unknown> | null;
  map_url?: string | null;
  log?: Array<Record<string, unknown>> | null;
  [key: string]: unknown;
}

export interface RuntimeCampaignStorageRecord<TData = Record<string, unknown>> {
  id?: number;
  campaign_id?: number;
  object_type?: string;
  object_id?: string;
  object_name?: string;
  category?: string | null;
  tags?: string[] | null;
  data?: TData | null;
  source?: string | null;
  source_id?: string | null;
  visibility?: string;
  is_active?: boolean;
  version?: number;
  created_at?: string;
  updated_at?: string | null;
  created_by?: string;
  updated_by?: string | null;
  [key: string]: unknown;
}
