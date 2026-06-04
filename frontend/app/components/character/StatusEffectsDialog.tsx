import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import type { ConditionType } from "~/types/effects";
import { CONDITION_NAMES } from "~/types/effects";
import { SpellDetailModal } from "~/components/spell/SpellSelectableCard";
import { formatBuffEffects, getSpellStatusSummaryLabels, SPELL_BUFF_EFFECTS } from "~/components/spell/spell-constants";
import { spellDataLoader } from "~/services/spellDataLoader";
import type { Spell } from "~/types/spell";
import { getAssetUrl } from "~/utils/asset-url";
import { doesTerrainMatch } from "./CharacterDisplay/utils/formatting";
import { getEffectDefinition } from "~/hooks/useEffectSystem";
import type { WorldTime } from "~/utils/timeUtils";
import { getKnowledgeOfTheAgesSelection } from "~/utils/specialBuffs";
import { useCurrentLocale } from "~/i18n/LocaleProvider";
import type { SupportedLocale } from "~/i18n/config";

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** Spell icon with image fallback to emoji */
function SpellIcon({ spellId, fallback, size = 20 }: { spellId: string; fallback?: string; size?: number }) {
  const [err, setErr] = React.useState(false);
  const src = getAssetUrl(`/assets/spell-icons/${spellId}.png`);
  if (err) return <span style={{ fontSize: size }}>{fallback || '✨'}</span>;
  return <img src={src} alt="" width={size} height={size} className="object-contain rounded" onError={() => setErr(true)} />;
}

// ── Time constants (D&D 5E: 1 round = 6 seconds) ──
const ROUNDS_PER_MINUTE = 10;
const ROUNDS_PER_HOUR = 600;
export const SHORT_REST_ROUNDS = ROUNDS_PER_HOUR;       // 1 hour
export const LONG_REST_ROUNDS = 8 * ROUNDS_PER_HOUR;    // 8 hours

// ── Types ──
export type Duration = {
  type: 'permanent' | 'rounds' | 'minutes' | 'hours';
  value: number;      // original value in its unit
  remaining: number;  // ALWAYS in rounds (v2)
  v?: 2;
};
export const PERMANENT_DURATION: Duration = { type: 'permanent', value: 0, remaining: 0 };

export interface StatusAuraConfig {
  enabled?: boolean;
  radius: number;
  icon?: string;
  color?: string;
  fill_color?: string;
  description?: string;
  affects_self?: boolean;
  affects_allies?: boolean;
  affects_enemies?: boolean;
  requires_conscious?: boolean;
  applies_conditions?: ConditionType[];
}

export interface CustomStatusEffect {
  id: string;
  name: string;
  modifiers: { param: string; value: number; type?: 'bonus' | 'advantage' | 'disadvantage' }[];
  duration: Duration;
  aura?: StatusAuraConfig;
}

/** Source of a condition: who/what applied it */
export type ConditionSource = {
  type: 'dm' | 'spell' | 'ability' | 'item' | 'environment';
  /** Name of the spell/ability/item that applied this condition */
  name?: string;
  /** Spell ID for linking to spell details */
  spell_id?: string;
  /** Character ID of the caster (for concentration tracking) */
  caster_id?: string;
  /** Caster display name */
  caster_name?: string;
};

/** How this condition can be removed */
export type ConditionRemoval = {
  type: 'manual' | 'concentration' | 'duration' | 'save' | 'spell_end';
  /** For 'save' type: the save DC */
  save_dc?: number;
  /** For 'save' type: the ability used for the save */
  save_ability?: string;
  /** Description of how to remove (free-form) */
  description?: string;
};

/** World-time expiration point */
export interface WorldTimeExpiry {
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function worldTimeToScalar(time: Pick<WorldTimeExpiry, "day" | "hour" | "minute" | "second">): number {
  return (((time.day * 24) + time.hour) * 60 + time.minute) * 60 + time.second;
}

function isExpiredByWorldTime(expiry: WorldTimeExpiry | undefined, currentWorldTime?: WorldTime): boolean {
  if (!expiry || !currentWorldTime) return false;
  return worldTimeToScalar(expiry) <= worldTimeToScalar(currentWorldTime);
}

function getRemainingRoundsByWorldTime(expiry: WorldTimeExpiry | undefined, currentWorldTime?: WorldTime): number | undefined {
  if (!expiry || !currentWorldTime) return undefined;
  const remainingSeconds = worldTimeToScalar(expiry) - worldTimeToScalar(currentWorldTime);
  if (remainingSeconds <= 0) return 0;
  return Math.ceil(remainingSeconds / 6);
}

export interface ConditionWithDuration {
  condition: ConditionType;
  duration: Duration;
  /** Where this condition came from */
  source?: ConditionSource;
  /** How this condition can be removed */
  removal?: ConditionRemoval;
  /** World-time expiration (calculated from campaign clock at cast time) */
  expires_at?: WorldTimeExpiry;
}

type TokenActiveEffectCondition = {
  id?: string;
  name?: string;
  icon?: string;
  color?: string;
  condition?: string | null;
  source?: string;
  spell_id?: string;
  source_token_id?: number | string | null;
  from_caster?: string;
  is_concentration?: boolean;
  ongoing_save?: { save_type?: string; dc?: number } | null;
  escape_action?: { type?: string; ability?: string; dc?: number } | null;
  escapeHint?: string;
  break_conditions?: string[] | null;
  expires_at?: WorldTimeExpiry;
  duration?: number | null;
  remaining_rounds?: number | null;
};

// ── Conversion helpers ──
export function toRounds(type: Duration['type'], value: number): number {
  if (type === 'minutes') return value * ROUNDS_PER_MINUTE;
  if (type === 'hours') return value * ROUNDS_PER_HOUR;
  return value;
}

/** Format remaining rounds into human-readable string */
function formatRounds(r: number, t: TFn): string {
  if (r <= 0) return t('statusEffectsDialog.duration.zeroRounds');
  const h = Math.floor(r / ROUNDS_PER_HOUR);
  const m = Math.floor((r % ROUNDS_PER_HOUR) / ROUNDS_PER_MINUTE);
  const rd = r % ROUNDS_PER_MINUTE;
  const hourUnit = t('statusEffectsDialog.duration.hourUnit');
  const minuteUnit = t('statusEffectsDialog.duration.minuteUnit');
  const roundUnit = t('statusEffectsDialog.duration.roundUnit');
  const sep = roundUnit === 'rd' ? ' ' : '';
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}${sep}${hourUnit}`);
  if (m > 0) parts.push(`${m}${sep}${minuteUnit}`);
  if (rd > 0 || parts.length === 0) parts.push(`${rd}${sep}${roundUnit}`);
  return parts.join(sep ? ' ' : '');
}

/** Format total in its original unit */
function formatTotal(dur: Duration, t: TFn): string {
  const u: Record<Duration['type'], string> = {
    permanent: '',
    rounds: t('statusEffectsDialog.duration.roundUnit'),
    minutes: t('statusEffectsDialog.duration.minuteUnit'),
    hours: t('statusEffectsDialog.duration.hourUnit'),
  };
  const unit = u[dur.type] ?? '';
  const sep = unit === 'rd' || unit === 'min' || unit === 'h' ? ' ' : '';
  return `${dur.value}${sep}${unit}`;
}

function durationPct(dur: Duration): number {
  const total = toRounds(dur.type, dur.value);
  return total > 0 ? (dur.remaining / total) * 100 : 0;
}

function pctColor(pct: number) {
  if (pct > 50) return 'text-green-400';
  if (pct > 20) return 'text-yellow-400';
  return 'text-red-400';
}

function pctBorderBg(pct: number) {
  if (pct > 50) return 'text-green-400 border-green-500/30 bg-green-500/5';
  if (pct > 20) return 'text-yellow-400 border-yellow-500/30 bg-yellow-500/5';
  return 'text-red-400 border-red-500/30 bg-red-500/5';
}

// ── Migration (old format: remaining was in same unit as type) ──
export function migrateDuration(dur: any): Duration {
  if (!dur || dur.type === 'permanent') return { ...PERMANENT_DURATION };
  if (dur.v === 2) return dur;
  // Old format → convert remaining to rounds
  return { type: dur.type, value: dur.value, remaining: toRounds(dur.type, dur.remaining), v: 2 };
}

export function migrateConditions(raw: unknown): ConditionWithDuration[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    // Legacy: plain string condition name
    if (typeof item === 'string') return { condition: item as ConditionType, duration: { ...PERMANENT_DURATION } };
    const obj = item as any;
    const result: ConditionWithDuration = { condition: obj.condition, duration: migrateDuration(obj.duration) };
    // Preserve source, removal & expires_at if present
    if (obj.source) result.source = obj.source;
    if (obj.removal) result.removal = obj.removal;
    if (obj.expires_at) result.expires_at = obj.expires_at;
    return result;
  });
}

export function migrateCustomEffects(raw: unknown): CustomStatusEffect[] {
  if (!Array.isArray(raw)) return [];
  return (raw as any[]).map((effect) => ({
    ...effect,
    duration: migrateDuration(effect.duration),
    aura: normalizeAuraConfig(effect.aura),
  }));
}

const DEFAULT_AURA_ICON = '🌀';
const DEFAULT_AURA_COLOR = '#38bdf8';

function colorToAuraFill(color: string | undefined): string {
  const raw = (color || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return 'rgba(56, 189, 248, 0.18)';
  const red = parseInt(raw.slice(0, 2), 16);
  const green = parseInt(raw.slice(2, 4), 16);
  const blue = parseInt(raw.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, 0.18)`;
}

function normalizeAuraConfig(raw: any): StatusAuraConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const appliesConditions = Array.isArray(raw.applies_conditions)
    ? raw.applies_conditions.filter((condition: unknown): condition is ConditionType =>
        typeof condition === 'string' && isKnownCondition(condition)
      )
    : [];
  const color = typeof raw.color === 'string' && raw.color ? raw.color : DEFAULT_AURA_COLOR;
  return {
    enabled: raw.enabled !== false,
    radius: Math.max(5, Number(raw.radius) || 10),
    icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : DEFAULT_AURA_ICON,
    color,
    fill_color: typeof raw.fill_color === 'string' && raw.fill_color ? raw.fill_color : colorToAuraFill(color),
    description: typeof raw.description === 'string' ? raw.description : '',
    affects_self: !!raw.affects_self,
    affects_allies: raw.affects_allies !== false,
    affects_enemies: !!raw.affects_enemies,
    requires_conscious: raw.requires_conscious !== false,
    applies_conditions: appliesConditions,
  };
}

function isKnownCondition(value: string | null | undefined): value is ConditionType {
  return !!value && Object.prototype.hasOwnProperty.call(CONDITION_NAMES, value);
}

function buildConditionDurationFromEffect(
  effect: {
    expires_at?: WorldTimeExpiry;
    duration?: number | null;
    remaining_rounds?: number | null;
  },
  currentWorldTime?: WorldTime,
): Duration {
  const remainingFromExpiry = getRemainingRoundsByWorldTime(effect.expires_at, currentWorldTime);
  if (remainingFromExpiry != null) {
    const totalRounds = Number(effect.duration ?? effect.remaining_rounds ?? remainingFromExpiry) || remainingFromExpiry;
    return {
      type: 'rounds',
      value: totalRounds,
      remaining: remainingFromExpiry,
      v: 2,
    };
  }

  const rounds = Number(effect.remaining_rounds ?? effect.duration ?? 0);
  if (rounds > 0) {
    return { type: 'rounds', value: rounds, remaining: rounds, v: 2 };
  }
  return { ...PERMANENT_DURATION };
}

function formatConditionDurationLabel(
  condition: ConditionWithDuration,
  t: TFn,
  currentWorldTime?: WorldTime,
): string | null {
  const remainingFromExpiry = getRemainingRoundsByWorldTime(condition.expires_at, currentWorldTime);
  if (remainingFromExpiry != null) {
    return formatRounds(remainingFromExpiry, t);
  }
  if (condition.duration?.type && condition.duration.type !== 'permanent' && condition.duration.remaining > 0) {
    return formatRounds(condition.duration.remaining, t);
  }
  return null;
}

function formatBreakConditionDescription(
  t: TFn,
  breakConditions?: string[] | null,
): string | undefined {
  if (!breakConditions?.length) return undefined;
  const labels = breakConditions.map((item) =>
    t(`statusEffectsDialog.breakConditions.${item}`, { defaultValue: item }),
  );
  const sep = t('statusEffectsDialog.listSeparator');
  return t('statusEffectsDialog.breakConditions.template', { list: labels.join(sep) });
}

function mergeConditionEntries(
  existing: ConditionWithDuration,
  incoming: ConditionWithDuration,
): ConditionWithDuration {
  const existingHasTimedDuration =
    existing.expires_at ||
    (existing.duration?.type && existing.duration.type !== 'permanent' && existing.duration.remaining > 0);

  return {
    ...existing,
    source: existing.source ?? incoming.source,
    removal: existing.removal ?? incoming.removal,
    expires_at: existing.expires_at ?? incoming.expires_at,
    duration: existingHasTimedDuration ? existing.duration : incoming.duration,
  };
}

function projectTokenActiveEffectConditions(
  tokenActiveEffects: TokenActiveEffectCondition[],
  t: TFn,
  conditionNameLookup: (c: ConditionType) => string,
  currentWorldTime?: WorldTime,
): ConditionWithDuration[] {
  const byCondition = new Map<ConditionType, ConditionWithDuration>();

  for (const effect of tokenActiveEffects) {
    if (!effect || isExpiredByWorldTime(effect.expires_at, currentWorldTime)) continue;
    if (!isKnownCondition(effect.condition)) continue;

    const description = [
      effect.escapeHint,
      formatBreakConditionDescription(t, effect.break_conditions),
    ].filter(Boolean).join(' · ') || undefined;

    let removal: ConditionRemoval | undefined;
    if (effect.is_concentration) {
      removal = { type: 'concentration', description };
    } else if (effect.ongoing_save) {
      removal = {
        type: 'save',
        save_dc: effect.ongoing_save.dc,
        save_ability: effect.ongoing_save.save_type,
        description,
      };
    } else if (effect.expires_at || Number(effect.duration ?? effect.remaining_rounds ?? 0) > 0) {
      removal = { type: 'duration', description };
    } else if (effect.spell_id || effect.source) {
      removal = { type: 'spell_end', description };
    } else if (description) {
      removal = { type: 'manual', description };
    }

    const projected: ConditionWithDuration = {
      condition: effect.condition,
      duration: buildConditionDurationFromEffect(effect, currentWorldTime),
      source: effect.spell_id || effect.source || effect.from_caster ? {
        type: effect.spell_id || effect.source ? 'spell' : 'environment',
        name: effect.source || conditionNameLookup(effect.condition),
        spell_id: effect.spell_id,
        caster_id: effect.source_token_id != null ? String(effect.source_token_id) : undefined,
        caster_name: effect.from_caster,
      } : undefined,
      removal,
      expires_at: effect.expires_at,
    };

    const existing = byCondition.get(effect.condition);
    byCondition.set(
      effect.condition,
      existing ? mergeConditionEntries(existing, projected) : projected,
    );
  }

  return Array.from(byCondition.values());
}

// ── Save ability display names ──
const SAVE_ABILITY_KEY_TO_TKEY: Record<string, string> = {
  strength: 'strength', dexterity: 'dexterity', constitution: 'constitution',
  intelligence: 'intelligence', wisdom: 'wisdom', charisma: 'charisma',
  str: 'strength', dex: 'dexterity', con: 'constitution',
  int: 'intelligence', wis: 'wisdom', cha: 'charisma',
};
function resolveSaveAbilityName(t: TFn, raw?: string): string {
  if (!raw) return t('statusEffectsDialog.saveAbilities.fallback');
  const key = SAVE_ABILITY_KEY_TO_TKEY[raw];
  if (key) return t(`statusEffectsDialog.saveAbilities.${key}`);
  return raw;
}

// ── UI data ──
type ParamItem = { id: string; label: string };
type ParamGroup = { label: string; items: ParamItem[] };
const PARAM_IDS = {
  core: ['ac', 'hp_max', 'attack', 'being_attacked', 'damage', 'speed', 'initiative'],
  abilities: ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'],
  saves: ['str_save', 'dex_save', 'con_save', 'int_save', 'wis_save', 'cha_save', 'all_saves'],
  skills: [
    'athletics', 'acrobatics', 'sleight_of_hand', 'stealth', 'arcana', 'history',
    'investigation', 'nature', 'religion', 'animal_handling', 'insight', 'medicine',
    'perception', 'survival', 'deception', 'intimidation', 'performance', 'persuasion',
    'all_checks',
  ],
};
function buildModifierGroups(t: TFn): ParamGroup[] {
  return [
    { label: t('statusEffectsDialog.modifierGroups.core'), items: PARAM_IDS.core.map(id => ({ id, label: t(`statusEffectsDialog.params.${id}`) })) },
    { label: t('statusEffectsDialog.modifierGroups.abilities'), items: PARAM_IDS.abilities.map(id => ({ id, label: t(`statusEffectsDialog.params.${id}`) })) },
    { label: t('statusEffectsDialog.modifierGroups.saves'), items: PARAM_IDS.saves.map(id => ({ id, label: t(`statusEffectsDialog.params.${id}`) })) },
    { label: t('statusEffectsDialog.modifierGroups.skills'), items: PARAM_IDS.skills.map(id => ({ id, label: t(`statusEffectsDialog.params.${id}`) })) },
  ];
}
function paramLabel(t: TFn, id: string): string {
  return t(`statusEffectsDialog.params.${id}`, { defaultValue: id });
}
// Params that are not d20 rolls (excluded for advantage/disadvantage)
const NON_D20_PARAMS = new Set(['ac', 'hp_max', 'damage', 'speed']);

const CONDITION_ICONS: Record<ConditionType, string> = {
  blinded: "🙈", charmed: "💖", deafened: "🔇", exhaustion: "😫",
  frightened: "😨", grappled: "🤼", incapacitated: "💫", invisible: "👻",
  paralyzed: "⚡", petrified: "🪨", poisoned: "🤢", prone: "🧎",
  restrained: "⛓️", stunned: "😵", unconscious: "💀", silenced: "🤐",
  diseased: "🦠", sleep: "😴", aging: "👴", confused: "🌀",
};
function localizedConditionName(t: TFn, c: ConditionType): string {
  return t(`statusEffectsDialog.conditionNames.${c}`, { defaultValue: CONDITION_NAMES[c] });
}
function localizedConditionDesc(t: TFn, c: ConditionType): string {
  return t(`statusEffectsDialog.conditionDesc.${c}`, { defaultValue: '' });
}

const STANDARD_CONDITIONS: ConditionType[] = [
  'blinded','charmed','deafened','frightened','grappled','incapacitated',
  'invisible','paralyzed','petrified','poisoned','prone','restrained',
  'stunned','unconscious','silenced','confused',
];

// ── Special Buffs type ──
export interface SpecialBuffs {
  favored_enemy_active?: boolean;
  favored_terrain_active?: boolean;
  circle_land_terrain_active?: boolean;
  knowledge_of_the_ages_kind?: "skill" | "tool";
  knowledge_of_the_ages_id?: string;
  knowledge_of_the_ages_label?: string;
  knowledge_of_the_ages_duration?: Duration;
  granted_skill_proficiencies?: string[];
  granted_tool_proficiencies?: string[];
  temporary_skill_proficiencies?: string[];
  temporary_tool_proficiencies?: string[];
  skill_proficiencies?: string[];
  tool_proficiencies?: string[];
}

// ── Advantage/Disadvantage computation ──
function computeAdvDisadv(t: TFn, conditions: ConditionType[], exhLv: number, effects: CustomStatusEffect[] = [], specialBuffs?: SpecialBuffs) {
  type Entry = { adv: boolean; disadv: boolean; advSrc: string[]; disadvSrc: string[] };
  const e = (): Entry => ({ adv: false, disadv: false, advSrc: [], disadvSrc: [] });
  const r = { checks: e(), attacks: e(), beingAttacked: e(), saves: e() };
  const has = (c: ConditionType) => conditions.includes(c);
  const src = (key: string, opts?: Record<string, unknown>) => t(`statusEffectsDialog.advDisadv.sources.${key}`, opts);

  // Helper: map param to broad category
  const categorize = (param: string): (keyof typeof r)[] => {
    if (param === 'attack') return ['attacks'];
    if (param === 'being_attacked') return ['beingAttacked'];
    if (param === 'all_saves' || param.endsWith('_save')) return ['saves'];
    if (param === 'all_checks' || param === 'initiative') return ['checks'];
    if (!NON_D20_PARAMS.has(param)) return ['checks'];
    return [];
  };

  if (exhLv >= 1) { r.checks.disadv = true; r.checks.disadvSrc.push(src('exhaustion', { lv: exhLv })); }
  if (exhLv >= 3) {
    r.attacks.disadv = true; r.attacks.disadvSrc.push(src('exhaustion', { lv: exhLv }));
    r.saves.disadv = true; r.saves.disadvSrc.push(src('exhaustion', { lv: exhLv }));
  }
  if (has('blinded'))    { r.attacks.disadv = true; r.attacks.disadvSrc.push(src('blinded')); r.beingAttacked.adv = true; r.beingAttacked.advSrc.push(src('blinded')); }
  if (has('frightened'))  { r.checks.disadv = true; r.checks.disadvSrc.push(src('frightened')); r.attacks.disadv = true; r.attacks.disadvSrc.push(src('frightened')); }
  if (has('invisible'))   { r.attacks.adv = true; r.attacks.advSrc.push(src('invisible')); r.beingAttacked.disadv = true; r.beingAttacked.disadvSrc.push(src('invisible')); }
  if (has('poisoned'))    { r.checks.disadv = true; r.checks.disadvSrc.push(src('poisoned')); r.attacks.disadv = true; r.attacks.disadvSrc.push(src('poisoned')); }
  if (has('prone'))       { r.attacks.disadv = true; r.attacks.disadvSrc.push(src('prone')); r.beingAttacked.adv = true; r.beingAttacked.advSrc.push(src('proneMelee')); }
  if (has('restrained'))  { r.attacks.disadv = true; r.attacks.disadvSrc.push(src('restrained')); r.beingAttacked.adv = true; r.beingAttacked.advSrc.push(src('restrained')); r.saves.disadv = true; r.saves.disadvSrc.push(src('restrainedDex')); }
  if (has('stunned'))     { r.beingAttacked.adv = true; r.beingAttacked.advSrc.push(src('stunned')); }
  if (has('unconscious')) { r.beingAttacked.adv = true; r.beingAttacked.advSrc.push(src('unconscious')); }
  if (has('paralyzed'))   { r.beingAttacked.adv = true; r.beingAttacked.advSrc.push(src('paralyzed')); }
  if (has('petrified'))   { r.beingAttacked.adv = true; r.beingAttacked.advSrc.push(src('petrified')); }

  for (const eff of effects) {
    for (const m of eff.modifiers) {
      if (m.type !== 'advantage' && m.type !== 'disadvantage') continue;
      const label = paramLabel(t, m.param);
      const entry = src('effectParam', { name: eff.name, param: label });
      for (const cat of categorize(m.param)) {
        if (m.type === 'advantage') { r[cat].adv = true; r[cat].advSrc.push(entry); }
        else { r[cat].disadv = true; r[cat].disadvSrc.push(entry); }
      }
    }
  }

  if (specialBuffs?.favored_enemy_active) { r.checks.adv = true; r.checks.advSrc.push(src('favoredEnemy')); }
  if (specialBuffs?.favored_terrain_active) { r.checks.adv = true; r.checks.advSrc.push(src('favoredTerrain')); }
  if (specialBuffs?.circle_land_terrain_active) { r.checks.adv = true; r.checks.advSrc.push(src('circleLand')); }

  return r;
}

function AdvDisadvSummary({ t, conditions, exhaustionLevel, customEffects, specialBuffs }: {
  t: TFn; conditions: ConditionType[]; exhaustionLevel: number; customEffects: CustomStatusEffect[]; specialBuffs?: SpecialBuffs;
}) {
  const a = computeAdvDisadv(t, conditions, exhaustionLevel, customEffects, specialBuffs);
  const cats = [
    { key: 'checks', label: t('statusEffectsDialog.advDisadv.categories.checks'), icon: '🎯', ...a.checks },
    { key: 'attacks', label: t('statusEffectsDialog.advDisadv.categories.attacks'), icon: '⚔️', ...a.attacks },
    { key: 'beingAttacked', label: t('statusEffectsDialog.advDisadv.categories.beingAttacked'), icon: '🛡️', ...a.beingAttacked },
    { key: 'saves', label: t('statusEffectsDialog.advDisadv.categories.saves'), icon: '🔰', ...a.saves },
  ];
  const active = cats.filter(c => c.adv || c.disadv);
  if (active.length === 0) return null;

  return (
    <section>
      <h3 className="text-xs font-medium text-purple-400 mb-2 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
        {t('statusEffectsDialog.advDisadv.title')}
      </h3>
      <div className="grid grid-cols-2 gap-1.5">
        {active.map(cat => {
          const both = cat.adv && cat.disadv;
          const tips = [
            ...cat.advSrc.map(s => t('statusEffectsDialog.advDisadv.tipAdv', { src: s })),
            ...cat.disadvSrc.map(s => t('statusEffectsDialog.advDisadv.tipDisadv', { src: s })),
          ];
          return (
            <div key={cat.key} className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] border ${
              both ? 'bg-yellow-500/10 border-yellow-500/25 text-yellow-300'
                : cat.adv ? 'bg-green-500/10 border-green-500/25 text-green-300'
                : 'bg-red-500/10 border-red-500/25 text-red-300'
            }`} title={tips.join('\n')}>
              <span className="text-sm flex-shrink-0">{cat.icon}</span>
              <div className="min-w-0">
                <div className="font-medium leading-tight">{cat.label}</div>
                <div className="text-[9px] opacity-70 leading-tight">
                  {both ? t('statusEffectsDialog.advDisadv.states.both')
                    : cat.adv ? t('statusEffectsDialog.advDisadv.states.adv')
                    : t('statusEffectsDialog.advDisadv.states.disadv')}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Props ──
interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isDM?: boolean;
  characterName?: string;
  /** Active concentration spell from the token on the map */
  concentrationSpell?: {
    spell_id: string;
    spell_name: string;
    slot_level: number;
    duration_rounds?: number;
    current_round?: number;
    target_name?: string;
    expires_at?: WorldTimeExpiry;
  } | null;
  /** Callback to break concentration */
  onConcentrationBreak?: () => void;
  /** Incoming spell buffs from other casters (from token active_effects) */
  incomingSpellBuffs?: Array<{
    id: string;
    name: string;
    icon: string;
    color: string;
    from_caster?: string;
    spell_id?: string;
    icon_path?: string;
    duration_rounds?: number | null;
    expires_at?: WorldTimeExpiry;
    selected_option?: string;
    selected_option_label?: string;
  }>;
  tokenActiveEffects?: TokenActiveEffectCondition[];
  runtimeSpellOverlays?: Array<{
    spell_id?: string;
    role?: string;
    selected_option?: string;
    selected_option_label?: string;
  }>;
  /** Computed proficiency warnings from equipped items (passive, non-removable) */
  proficiencyWarnings?: { label: string; desc: string }[];
  customEffects?: CustomStatusEffect[];
  onAddEffect?: (e: CustomStatusEffect) => void;
  onRemoveEffect?: (id: string) => void;
  onUpdateEffect?: (id: string, patch: Partial<CustomStatusEffect>) => void;
  /** Advance 1 round (6 seconds) */
  onAdvanceRound?: () => void;
  /** Short rest: advance 1 hour */
  onShortRest?: () => void;
  /** Long rest: advance 8 hours + exhaustion -1 */
  onLongRest?: () => void;
  activeConditions?: ConditionWithDuration[];
  onToggleCondition?: (c: ConditionType) => void;
  onUpdateConditionDuration?: (c: ConditionType, dur: Duration) => void;
  exhaustionLevel?: number;
  onSetExhaustion?: (lv: number) => void;
  exhaustionDuration?: Duration;
  onSetExhaustionDuration?: (dur: Duration) => void;
  currentWorldTime?: WorldTime;
  // Ranger special buffs
  favoredEnemy?: string;
  favoredHumanoidRaces?: string[];
  favoredTerrain?: string;
  // Druid Circle of the Land
  circleLandTerrain?: string;
  // Global terrain for match indicator
  globalTerrain?: string | null;
  specialBuffs?: SpecialBuffs;
  onToggleSpecialBuff?: (key: string, active: boolean) => void;
  formatFavoredEnemy?: (v: string) => string;
  formatFavoredTerrain?: (v: string) => string;
  formatHumanoid?: (v: string) => string;
  /** 嵌入浮动面板模式 */
  embedded?: boolean;
}

// ── Main Component ──
export function StatusEffectsDialog({
  open, onOpenChange, isDM, characterName,
  concentrationSpell, onConcentrationBreak,
  incomingSpellBuffs = [],
  tokenActiveEffects = [],
  runtimeSpellOverlays = [],
  proficiencyWarnings = [],
  customEffects = [], onAddEffect, onRemoveEffect, onUpdateEffect,
  onAdvanceRound, onShortRest, onLongRest,
  activeConditions = [], onToggleCondition, onUpdateConditionDuration,
  exhaustionLevel = 0, onSetExhaustion,
  exhaustionDuration = PERMANENT_DURATION, onSetExhaustionDuration,
  currentWorldTime,
  favoredEnemy, favoredHumanoidRaces, favoredTerrain,
  circleLandTerrain, globalTerrain,
  specialBuffs, onToggleSpecialBuff,
  formatFavoredEnemy: fmtEnemy, formatFavoredTerrain: fmtTerrain, formatHumanoid: fmtHumanoid,
  embedded,
}: Props) {
  const { t: tRaw } = useTranslation('common');
  const t: TFn = tRaw as unknown as TFn;
  const locale = useCurrentLocale();
  const conditionName = React.useCallback((c: ConditionType) => localizedConditionName(t, c), [t]);
  const conditionDesc = React.useCallback((c: ConditionType) => localizedConditionDesc(t, c), [t]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showConcentrationHelp, setShowConcentrationHelp] = useState(false);
  const [concSpellDetail, setConcSpellDetail] = useState<Spell | null>(null);
  const [, setRealtimeTick] = useState(0);

  useEffect(() => {
    if (!open || !currentWorldTime?.realTimeActive) return;
    const timer = window.setInterval(() => {
      setRealtimeTick((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, currentWorldTime?.realTimeActive]);

  const effectiveIncomingSpellBuffs = React.useMemo(
    () => incomingSpellBuffs
      .filter((buff) => !isExpiredByWorldTime(buff.expires_at, currentWorldTime))
      .map((buff) => {
        if (buff.selected_option || buff.selected_option_label) return buff;
        const sid = (buff as any).spell_id || buff.id.replace('spell_buff_', '');
        const overlay = runtimeSpellOverlays.find((entry) => entry?.spell_id === sid && entry?.role === 'target');
        if (!overlay) return buff;
        return {
          ...buff,
          selected_option: overlay.selected_option,
          selected_option_label: overlay.selected_option_label,
        };
      }),
    [currentWorldTime, incomingSpellBuffs, runtimeSpellOverlays],
  );
  const visibleConcentrationSpell = React.useMemo(
    () => (
      concentrationSpell && !isExpiredByWorldTime(concentrationSpell.expires_at, currentWorldTime)
        ? concentrationSpell
        : null
    ),
    [concentrationSpell, currentWorldTime],
  );

  const visibleActiveConditions = React.useMemo(
    () => activeConditions.filter((condition) => !isExpiredByWorldTime(condition.expires_at, currentWorldTime)),
    [activeConditions, currentWorldTime],
  );
  const tokenProjectedConditions = React.useMemo(
    () => projectTokenActiveEffectConditions(tokenActiveEffects, t, conditionName, currentWorldTime),
    [currentWorldTime, tokenActiveEffects, t, conditionName],
  );
  const spellGrantedConditions = React.useMemo(() => {
    const byCondition = new Map<ConditionType, ConditionWithDuration>();
    for (const buff of effectiveIncomingSpellBuffs) {
      const conditions = ((buff as any).conditions || []) as ConditionType[];
      const sid = (buff as any).spell_id || buff.id.replace('spell_buff_', '');
      for (const condition of conditions) {
        const projected: ConditionWithDuration = {
          condition,
          duration: buildConditionDurationFromEffect({
            expires_at: buff.expires_at,
            duration: (buff as any).duration ?? buff.duration_rounds,
          }, currentWorldTime),
          source: {
            type: 'spell',
            name: buff.name,
            spell_id: sid,
            caster_name: buff.from_caster,
          },
          removal: buff.expires_at || (buff.duration_rounds != null || (buff as any).duration != null)
            ? { type: 'duration' }
            : { type: 'spell_end' },
          expires_at: buff.expires_at,
        };
        const existing = byCondition.get(condition);
        byCondition.set(condition, existing ? mergeConditionEntries(existing, projected) : projected);
      }
    }
    return Array.from(byCondition.values());
  }, [currentWorldTime, effectiveIncomingSpellBuffs]);
  const displayedConditions = React.useMemo(() => {
    const mergedByCondition = new Map<ConditionType, ConditionWithDuration>();

    for (const cond of visibleActiveConditions) {
      mergedByCondition.set(cond.condition, cond);
    }
    for (const cond of tokenProjectedConditions) {
      const existing = mergedByCondition.get(cond.condition);
      mergedByCondition.set(cond.condition, existing ? mergeConditionEntries(existing, cond) : cond);
    }
    for (const cond of spellGrantedConditions) {
      const existing = mergedByCondition.get(cond.condition);
      mergedByCondition.set(cond.condition, existing ? mergeConditionEntries(existing, cond) : cond);
    }
    return Array.from(mergedByCondition.values());
  }, [spellGrantedConditions, tokenProjectedConditions, visibleActiveConditions]);
  const knowledgeOfTheAges = React.useMemo(
    () => getKnowledgeOfTheAgesSelection(specialBuffs),
    [specialBuffs],
  );
  const hasAnyActive = !!visibleConcentrationSpell || effectiveIncomingSpellBuffs.length > 0 || proficiencyWarnings.length > 0 || customEffects.length > 0 || displayedConditions.length > 0 || exhaustionLevel > 0
    || specialBuffs?.favored_enemy_active || specialBuffs?.favored_terrain_active || specialBuffs?.circle_land_terrain_active
    || !!knowledgeOfTheAges;
  const hasTimedDurations =
    customEffects.some(e => e.duration?.type !== 'permanent' && e.duration?.remaining > 0) ||
    displayedConditions.some(c => (c.duration?.type !== 'permanent' && c.duration?.remaining > 0) || !!c.expires_at) ||
    (exhaustionLevel > 0 && exhaustionDuration?.type !== 'permanent' && exhaustionDuration?.remaining > 0) ||
    !!(knowledgeOfTheAges?.duration?.type !== 'permanent' && Number(knowledgeOfTheAges?.duration?.remaining || 0) > 0);

  // --- Inner content (shared between dialog and embedded modes) ---
  const statusContent = (
    <div className={embedded ? "p-3 flex flex-col h-full" : undefined}>
      {/* Header */}
      {!embedded && (
        <div className="flex items-center justify-between flex-shrink-0 mb-2">
          <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 text-cyan-400">
              <path d="M8 1l2.12 4.3 4.74.69-3.43 3.34.81 4.72L8 11.77l-4.24 2.28.81-4.72L1.14 5.99l4.74-.69L8 1z" fill="currentColor" opacity="0.8"/>
            </svg>
            {t('statusEffectsDialog.title')}
            {characterName && <span className="text-xs text-gray-500 font-normal">— {characterName}</span>}
          </h3>
          <Dialog.Close
            title={t('statusEffectsDialog.closeTitle')}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </Dialog.Close>
        </div>
      )}
      {embedded && characterName && (
        <div className="text-xs text-gray-500 mb-2">— {characterName}</div>
      )}

      {/* Time advance toolbar (DM only) */}
      {isDM && hasAnyActive && (
        <div className="flex items-center gap-1.5 mb-3 flex-shrink-0">
          {hasTimedDurations && (
            <button
              onClick={onAdvanceRound}
              title={t('statusEffectsDialog.toolbar.advanceRoundHint')}
              aria-label={t('statusEffectsDialog.toolbar.advanceRoundHint')}
              className="text-[10px] px-2 py-1 rounded border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-colors"
            >
              {t('statusEffectsDialog.toolbar.advanceRound')}
            </button>
          )}
          <button onClick={onShortRest} className="text-[10px] px-2 py-1 rounded border border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors">
            {t('statusEffectsDialog.toolbar.shortRest')}
          </button>
          <button onClick={onLongRest} className="text-[10px] px-2 py-1 rounded border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors">
            {t('statusEffectsDialog.toolbar.longRest')}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-4">
        {/* Concentration Spell */}
        {visibleConcentrationSpell && (
              <section>
                <h3 className="text-xs font-medium text-purple-400 mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                  {t('statusEffectsDialog.concentration.label')}
                  <button
                    onClick={() => setShowConcentrationHelp(v => !v)}
                    className="w-3.5 h-3.5 rounded-full border border-purple-500/50 text-[9px] text-purple-400/70
                               hover:text-purple-300 hover:border-purple-400 transition-colors flex items-center justify-center"
                    title={t('statusEffectsDialog.concentration.helpTitle')}
                  >?</button>
                </h3>
                {showConcentrationHelp && (
                  <div className="mb-2 px-3 py-2 rounded-lg bg-purple-900/20 border border-purple-500/20 text-[11px] text-purple-300/80 leading-relaxed">
                    <p>{t('statusEffectsDialog.concentration.helpBody1')}</p>
                    <p className="mt-1">{t('statusEffectsDialog.concentration.helpBody2')}</p>
                  </div>
                )}
                <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-purple-500/15 border-purple-500/30">
                  <SpellIcon spellId={visibleConcentrationSpell.spell_id} fallback="🔮" size={24} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-purple-200">{visibleConcentrationSpell.spell_name}</div>
                    <div className="text-[10px] text-purple-400/70">
                      {visibleConcentrationSpell.slot_level > 0
                        ? t('statusEffectsDialog.concentration.levelN', { n: visibleConcentrationSpell.slot_level })
                        : t('statusEffectsDialog.concentration.cantrip')}
                      {visibleConcentrationSpell.target_name && (
                        <span className="ml-1.5">→ {visibleConcentrationSpell.target_name}</span>
                      )}
                      {(() => {
                        const remainingFromExpiry = getRemainingRoundsByWorldTime(
                          visibleConcentrationSpell.expires_at,
                          currentWorldTime,
                        );
                        const remainingRounds = remainingFromExpiry ??
                          (visibleConcentrationSpell.duration_rounds != null
                            ? visibleConcentrationSpell.duration_rounds - (visibleConcentrationSpell.current_round ?? 0)
                            : null);
                        if (remainingRounds == null) return null;
                        return (
                        <span className="ml-1.5">
                          {visibleConcentrationSpell.duration_rounds != null
                            ? t('statusEffectsDialog.concentration.roundsOf', { n: remainingRounds, total: visibleConcentrationSpell.duration_rounds })
                            : t('statusEffectsDialog.concentration.rounds', { n: remainingRounds })}
                        </span>
                        );
                      })()}
                    </div>
                    {(() => {
                      const concEffectDef = getEffectDefinition(visibleConcentrationSpell.spell_id);
                      return concEffectDef?.description ? (
                        <div className="mt-1 text-[10px] text-purple-300/60 leading-relaxed">{concEffectDef.description}</div>
                      ) : null;
                    })()}
                  </div>
                  <button
                        onClick={async () => {
                          await spellDataLoader.loadSpellData();
                          const spell = spellDataLoader.getSpellById(visibleConcentrationSpell.spell_id);
                          if (spell) setConcSpellDetail(spell);
                        }}
                    className="w-5 h-5 rounded-full bg-purple-600/50 hover:bg-purple-500/60 text-[10px]
                               text-purple-200 flex items-center justify-center transition-colors flex-shrink-0"
                    title={t('statusEffectsDialog.concentration.viewSpellDetail')}
                  >!</button>
                  {onConcentrationBreak && (
                    <button
                      onClick={onConcentrationBreak}
                      className="px-2 py-0.5 rounded bg-red-600/70 hover:bg-red-500/80 text-[10px]
                                 text-white font-medium transition-colors flex-shrink-0"
                      title={t('statusEffectsDialog.concentration.breakTitle')}
                    >{t('statusEffectsDialog.concentration.break')}</button>
                  )}
                </div>
              </section>
            )}

            {/* Incoming Spell Buffs (from other casters) */}
            {effectiveIncomingSpellBuffs.length > 0 && (
              <section>
                <h3 className="text-xs font-medium text-blue-400 mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  {t('statusEffectsDialog.incomingBuffs.title')}
                </h3>
                <div className="space-y-1.5">
                  {effectiveIncomingSpellBuffs.map(buff => {
                    const sid = (buff as any).spell_id || buff.id.replace('spell_buff_', '');
                    const be = (buff as any).buff_effects || SPELL_BUFF_EFFECTS[sid];
                    const buffConditions = ((buff as any).conditions || []) as ConditionType[];
                    const runtimeSummaryLabels = getSpellStatusSummaryLabels(
                      sid,
                      (buff as any).selected_option,
                      'target',
                      locale,
                    );
                    const effectLabels = Array.from(new Set([
                      ...formatBuffEffects(be, (buff as any).modifiers, buffConditions, locale),
                      ...runtimeSummaryLabels,
                    ]));
                    const effectDef = getEffectDefinition(sid);
                    const description = effectDef?.description;
                    const optionLabel = (buff as any).selected_option_label;
                    const title = optionLabel
                      ? (locale === 'en-US'
                        ? `${buff.name} (${optionLabel})`
                        : `${buff.name}（${optionLabel}）`)
                      : buff.name;
                    return (
                    <div key={buff.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-blue-500/10 border-blue-500/25">
                      <SpellIcon spellId={sid} fallback={buff.icon} size={24} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-blue-200">{title}</div>
                        <div className="text-[10px] text-blue-400/60">
                          {buff.from_caster && <span>{t('statusEffectsDialog.incomingBuffs.fromCaster', { name: buff.from_caster })}</span>}
                          {(() => {
                            const remainingFromExpiry = getRemainingRoundsByWorldTime(buff.expires_at, currentWorldTime);
                            const durationLabel = remainingFromExpiry ?? ((buff as any).duration ?? buff.duration_rounds);
                            return durationLabel != null ? (
                              <span className={buff.from_caster ? 'ml-1.5' : ''}>
                                {t('statusEffectsDialog.incomingBuffs.rounds', { n: durationLabel })}
                              </span>
                            ) : null;
                          })()}
                        </div>
                        {effectLabels.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {effectLabels.map(l => (
                              <span key={l} className="px-1.5 py-0.5 rounded text-[9px] bg-blue-500/20 text-blue-300/80 border border-blue-500/15">{l}</span>
                            ))}
                          </div>
                        )}
                        {description && (
                          <div className="mt-1 text-[10px] text-blue-300/60 leading-relaxed">{description}</div>
                        )}
                      </div>
                      <button
                        onClick={async () => {
                          await spellDataLoader.loadSpellData();
                          const spell = spellDataLoader.getSpellById(sid);
                          if (spell) setConcSpellDetail(spell);
                        }}
                        className="w-5 h-5 rounded-full bg-blue-600/50 hover:bg-blue-500/60 text-[10px]
                                   text-blue-200 flex items-center justify-center transition-colors flex-shrink-0"
                        title={t('statusEffectsDialog.concentration.viewSpellDetail')}
                      >!</button>
                    </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Advantage/Disadvantage Summary */}
            <AdvDisadvSummary t={t} conditions={displayedConditions.map(c => c.condition)} exhaustionLevel={exhaustionLevel} customEffects={customEffects} specialBuffs={specialBuffs} />

            {/* Ranger / Druid Special Buffs */}
            {(favoredEnemy || favoredTerrain || circleLandTerrain || knowledgeOfTheAges) && (
              <section>
                <h3 className="text-xs font-medium text-green-400 mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  {t('statusEffectsDialog.specialBuffs.title')}
                </h3>
                <div className="space-y-1.5">
                  {knowledgeOfTheAges && (() => {
                    const kindLabel = knowledgeOfTheAges.kind === 'skill'
                      ? t('statusEffectsDialog.specialBuffs.skill')
                      : t('statusEffectsDialog.specialBuffs.tool');
                    const remaining = Number(knowledgeOfTheAges.duration?.remaining || 0);
                    const showRemaining = knowledgeOfTheAges.duration?.type !== 'permanent';
                    const suffix = showRemaining
                      ? t('statusEffectsDialog.specialBuffs.knowledgeRemainingSuffix', { remaining: formatRounds(remaining, t) })
                      : '';
                    return (
                      <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-indigo-500/15 border-indigo-500/30 text-indigo-200">
                        <span className="text-base flex-shrink-0">🧠</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-indigo-200">
                            {t('statusEffectsDialog.specialBuffs.knowledgeTitle', { label: knowledgeOfTheAges.label })}
                          </div>
                          <div className="text-[9px] text-indigo-300/80">
                            {t('statusEffectsDialog.specialBuffs.knowledgeDesc', { kind: kindLabel })}{suffix}
                          </div>
                        </div>
                        <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-200">
                          {kindLabel}
                        </span>
                      </div>
                    );
                  })()}
                  {favoredEnemy && (() => {
                    const active = !!specialBuffs?.favored_enemy_active;
                    const enemyLabel = fmtEnemy?.(favoredEnemy) ?? favoredEnemy;
                    const races = favoredHumanoidRaces?.map(r => fmtHumanoid?.(r) ?? r) ?? [];
                    const detail = favoredEnemy === 'humanoids' && races.length
                      ? t('statusEffectsDialog.specialBuffs.favoredEnemyHumanoidDetail', {
                          label: enemyLabel,
                          races: races.join(t('statusEffectsDialog.listSeparator')),
                        })
                      : enemyLabel;
                    return (
                      <div
                        onClick={() => isDM && onToggleSpecialBuff?.('favored_enemy_active', !active)}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors ${isDM ? 'cursor-pointer' : ''} ${
                          active
                            ? 'bg-green-500/15 border-green-500/30 text-green-300'
                            : 'bg-gray-800/40 border-gray-600/30 text-gray-500'
                        }`}
                      >
                        <span className="text-base flex-shrink-0">🏹</span>
                        <div className="min-w-0 flex-1">
                          <div className={`text-xs font-medium ${active ? 'text-green-300' : 'text-gray-400'}`}>
                            {t('statusEffectsDialog.specialBuffs.favoredEnemyTitle', { detail })}
                          </div>
                          <div className="text-[9px] text-gray-500">{t('statusEffectsDialog.specialBuffs.favoredEnemyDesc')}</div>
                        </div>
                        {isDM && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${active ? 'bg-green-500/20 text-green-400' : 'bg-gray-700/50 text-gray-500'}`}>
                            {active ? t('statusEffectsDialog.specialBuffs.on') : t('statusEffectsDialog.specialBuffs.off')}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  {favoredTerrain && (() => {
                    const active = !!specialBuffs?.favored_terrain_active;
                    const terrainLabel = fmtTerrain?.(favoredTerrain) ?? favoredTerrain;
                    const matched = doesTerrainMatch(favoredTerrain, globalTerrain);
                    return (
                      <div
                        onClick={() => isDM && onToggleSpecialBuff?.('favored_terrain_active', !active)}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors ${isDM ? 'cursor-pointer' : ''} ${
                          active
                            ? 'bg-green-500/15 border-green-500/30 text-green-300'
                            : 'bg-gray-800/40 border-gray-600/30 text-gray-500'
                        }`}
                      >
                        <span className="text-base flex-shrink-0">🌲</span>
                        <div className="min-w-0 flex-1">
                          <div className={`text-xs font-medium ${active ? 'text-green-300' : 'text-gray-400'}`}>
                            {t('statusEffectsDialog.specialBuffs.favoredTerrainTitle', { label: terrainLabel })}
                            {matched && <span className="ml-1 text-[10px] text-emerald-400">{t('statusEffectsDialog.specialBuffs.match')}</span>}
                          </div>
                          <div className="text-[9px] text-gray-500">{t('statusEffectsDialog.specialBuffs.favoredTerrainDesc')}</div>
                        </div>
                        {isDM && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${active ? 'bg-green-500/20 text-green-400' : 'bg-gray-700/50 text-gray-500'}`}>
                            {active ? t('statusEffectsDialog.specialBuffs.on') : t('statusEffectsDialog.specialBuffs.off')}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  {circleLandTerrain && (() => {
                    const active = !!specialBuffs?.circle_land_terrain_active;
                    const terrainLabel = fmtTerrain?.(circleLandTerrain) ?? circleLandTerrain;
                    const matched = doesTerrainMatch(circleLandTerrain, globalTerrain);
                    return (
                      <div
                        onClick={() => isDM && onToggleSpecialBuff?.('circle_land_terrain_active', !active)}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors ${isDM ? 'cursor-pointer' : ''} ${
                          active
                            ? 'bg-green-500/15 border-green-500/30 text-green-300'
                            : 'bg-gray-800/40 border-gray-600/30 text-gray-500'
                        }`}
                      >
                        <span className="text-base flex-shrink-0">🌿</span>
                        <div className="min-w-0 flex-1">
                          <div className={`text-xs font-medium ${active ? 'text-green-300' : 'text-gray-400'}`}>
                            {t('statusEffectsDialog.specialBuffs.circleLandTitle', { label: terrainLabel })}
                            {matched && <span className="ml-1 text-[10px] text-emerald-400">{t('statusEffectsDialog.specialBuffs.match')}</span>}
                          </div>
                          <div className="text-[9px] text-gray-500">{t('statusEffectsDialog.specialBuffs.circleLandDesc')}</div>
                        </div>
                        {isDM && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${active ? 'bg-green-500/20 text-green-400' : 'bg-gray-700/50 text-gray-500'}`}>
                            {active ? t('statusEffectsDialog.specialBuffs.on') : t('statusEffectsDialog.specialBuffs.off')}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </section>
            )}

            {/* DM: Add Effect */}
            {isDM && !showAddForm && (
              <button
                className="w-full py-2 text-xs rounded-lg border border-dashed border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-500/60 transition-colors"
                onClick={() => setShowAddForm(true)}
              >
                {t('statusEffectsDialog.addEffect')}
              </button>
            )}
            {isDM && showAddForm && (
              <AddEffectForm
                t={t}
                conditionName={conditionName}
                onAdd={(e) => { onAddEffect?.(e); setShowAddForm(false); }}
                onCancel={() => setShowAddForm(false)}
              />
            )}

            {/* Proficiency Warnings (computed, non-removable) */}
            {proficiencyWarnings.length > 0 && (
              <section>
                <h3 className="text-xs font-medium text-amber-400 mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  {t('statusEffectsDialog.proficiencyWarnings.title')}
                </h3>
                <div className="space-y-1.5">
                  {proficiencyWarnings.map((w, i) => (
                    <div key={i} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <span className="text-base flex-shrink-0">⚠️</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-amber-300">{w.label}</div>
                        <div className="text-[9px] text-gray-400">{w.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Custom Effects */}
            {customEffects.length > 0 && (
              <section>
                <h3 className="text-xs font-medium text-cyan-400 mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  {t('statusEffectsDialog.customEffects.title')}
                </h3>
                <div className="space-y-1.5">
                  {customEffects.map(eff => (
                    <CustomEffectRow
                      key={eff.id} effect={eff} isDM={isDM}
                      t={t}
                      conditionName={conditionName}
                      onRemove={() => onRemoveEffect?.(eff.id)}
                      onUpdateDuration={(dur) => onUpdateEffect?.(eff.id, { duration: dur })}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Active Conditions */}
            {displayedConditions.length > 0 && (
              <section>
                <h3 className="text-xs font-medium text-red-400 mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  {t('statusEffectsDialog.conditions.title')}
                </h3>
                <div className="space-y-1.5">
                  {displayedConditions.filter(c => c.condition !== 'exhaustion').map(cond => {
                    const icon = CONDITION_ICONS[cond.condition];
                    const desc = conditionDesc(cond.condition);
                    const isPersistedCondition = visibleActiveConditions.some(c => c.condition === cond.condition);
                    const src = cond.source;
                    const rmv = cond.removal;
                    const durationLabel = formatConditionDurationLabel(cond, t, currentWorldTime);
                    const sourceFallback = src && (src.type === 'dm'
                      ? t('statusEffectsDialog.conditions.sourceLabels.dm')
                      : t(`statusEffectsDialog.conditions.sourceLabels.${src.type}`, { defaultValue: src.type }));
                    return (
                      <div key={cond.condition} className="px-2.5 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                        <div className="flex items-center gap-2">
                          <span className="text-base flex-shrink-0">{icon}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-red-300">{conditionName(cond.condition)}</div>
                            <div className="text-[9px] text-gray-400 truncate">{desc}</div>
                          </div>
                          {isDM && isPersistedCondition && (
                            <button
                              onClick={() => onToggleCondition?.(cond.condition)}
                              className="text-gray-500 hover:text-red-400 text-xs flex-shrink-0"
                              title={t('statusEffectsDialog.conditions.removeTitle')}
                            >✕</button>
                          )}
                        </div>
                        {(src || rmv || durationLabel) && (
                          <div className="flex flex-wrap gap-1 mt-1.5 ml-7">
                            {src && (
                              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                src.type === 'spell' ? 'bg-purple-500/15 border-purple-500/30 text-purple-300' :
                                src.type === 'dm' ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300' :
                                src.type === 'ability' ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' :
                                src.type === 'item' ? 'bg-teal-500/15 border-teal-500/30 text-teal-300' :
                                'bg-gray-500/15 border-gray-500/30 text-gray-300'
                              }`}>
                                {src.type === 'spell' ? '✨' : src.type === 'dm' ? '🎲' : src.type === 'ability' ? '⚡' : src.type === 'item' ? '🎒' : '🌍'}
                                {src.name || sourceFallback}
                                {src.caster_name && <span className="text-[9px] opacity-70 ml-0.5">· {src.caster_name}</span>}
                              </span>
                            )}
                            {rmv && rmv.type === 'concentration' && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 border border-purple-400/25 text-purple-300">
                                🔮 {t('statusEffectsDialog.removal.concentration')}
                              </span>
                            )}
                            {rmv && rmv.type === 'save' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/10 border border-yellow-400/25 text-yellow-300">
                                🛡️ {resolveSaveAbilityName(t, rmv.save_ability)}
                                <span className="bg-yellow-500/20 px-1 rounded text-yellow-200 font-bold">{t('statusEffectsDialog.removal.saveDC', { dc: rmv.save_dc ?? '?' })}</span>
                              </span>
                            )}
                            {rmv && rmv.type === 'duration' && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/10 border border-green-400/25 text-green-300">
                                ⏳ {cond.expires_at
                                  ? t('statusEffectsDialog.removal.expiresAt', {
                                      day: cond.expires_at.day,
                                      hour: String(cond.expires_at.hour).padStart(2, '0'),
                                      minute: String(cond.expires_at.minute).padStart(2, '0'),
                                      second: String(cond.expires_at.second).padStart(2, '0'),
                                    })
                                  : cond.duration?.type === 'rounds' && cond.duration.value
                                    ? t('statusEffectsDialog.removal.roundsValue', { n: cond.duration.value })
                                    : t('statusEffectsDialog.removal.duration')}
                              </span>
                            )}
                            {rmv && rmv.type === 'spell_end' && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 border border-blue-400/25 text-blue-300">
                                🔚 {t('statusEffectsDialog.removal.spellEnd')}
                              </span>
                            )}
                            {rmv && rmv.type === 'manual' && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-500/10 border border-gray-500/25 text-gray-400">
                                ✋ {t('statusEffectsDialog.removal.manual')}
                              </span>
                            )}
                            {rmv?.description && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] bg-gray-700/30 border border-gray-600/20 text-gray-400">
                                {rmv.description}
                              </span>
                            )}
                            {durationLabel && rmv?.type !== 'duration' && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/10 border border-green-400/25 text-green-300">
                                ⏳ {t('statusEffectsDialog.removal.remainingPrefix', { label: durationLabel })}
                              </span>
                            )}
                          </div>
                        )}
                        {isPersistedCondition && (
                          <div className="ml-7 mt-1">
                            {isDM ? (
                              <DurationEditor t={t} dur={cond.duration ?? PERMANENT_DURATION} onChange={(d) => onUpdateConditionDuration?.(cond.condition, d)} />
                            ) : (cond.duration?.type && cond.duration.type !== 'permanent') && (
                              <DurationReadonly t={t} dur={cond.duration} />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Exhaustion */}
            {exhaustionLevel > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-amber-400 flex items-center gap-2">
                    <span className="text-base">😫</span>
                    {t('statusEffectsDialog.exhaustion.title', { n: exhaustionLevel })}
                    {exhaustionLevel >= 5 && <span className="text-red-400 text-xs">{t('statusEffectsDialog.exhaustion.dying')}</span>}
                  </h3>
                  {isDM && (
                    <span className="flex items-center gap-1.5">
                      <button onClick={() => onSetExhaustion?.(Math.max(0, exhaustionLevel - 1))} className="w-7 h-7 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-bold">−</button>
                      <button onClick={() => onSetExhaustion?.(Math.min(6, exhaustionLevel + 1))} className="w-7 h-7 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-bold">+</button>
                    </span>
                  )}
                </div>
                {isDM ? (
                  <div className="mb-2"><DurationEditor t={t} dur={exhaustionDuration} onChange={(d) => onSetExhaustionDuration?.(d)} /></div>
                ) : (exhaustionDuration?.type && exhaustionDuration.type !== 'permanent') && (
                  <div className="mb-2"><DurationReadonly t={t} dur={exhaustionDuration} /></div>
                )}
                <ExhaustionTracker t={t} level={exhaustionLevel} />
              </section>
            )}

            {/* Empty state */}
            {!hasAnyActive && !showAddForm && (
              <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                <span className="text-3xl mb-2">✨</span>
                <span className="text-sm">{t('statusEffectsDialog.empty.title')}</span>
                {!isDM && <span className="text-[10px] text-gray-600 mt-1">{t('statusEffectsDialog.empty.hint')}</span>}
              </div>
            )}

            {/* Condition Grid */}
            <section>
              <h3 className="text-xs font-medium text-gray-400 mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                  {t('statusEffectsDialog.conditions.quickRef')} {isDM && <span className="text-[9px] text-gray-600 font-normal">{t('statusEffectsDialog.conditions.quickRefHint')}</span>}
                </span>
                {isDM && exhaustionLevel === 0 && (
                  <button onClick={() => onSetExhaustion?.(1)} className="text-[9px] text-amber-500/60 hover:text-amber-400 transition-colors">{t('statusEffectsDialog.conditions.addExhaustion')}</button>
                )}
              </h3>
              <div className="grid grid-cols-3 gap-1">
                {STANDARD_CONDITIONS.map(cond => {
                  const icon = CONDITION_ICONS[cond];
                  const desc = conditionDesc(cond);
                  const isActive = displayedConditions.some(c => c.condition === cond);
                  const isSpellProjectedOnly =
                    isActive && !visibleActiveConditions.some((entry) => entry.condition === cond);
                  const title = isSpellProjectedOnly
                    ? `${desc}${t('statusEffectsDialog.conditions.spellProjectedSuffix')}`
                    : desc;
                  return (
                    <div
                      key={cond}
                      onClick={() => isDM && !isSpellProjectedOnly && onToggleCondition?.(cond)}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] transition-colors ${(isDM && !isSpellProjectedOnly) ? 'cursor-pointer' : ''} ${
                        isActive ? "bg-red-500/15 border border-red-500/30 text-red-300" : "bg-gray-800/40 text-gray-500 hover:text-gray-400 hover:bg-gray-800/60"
                      }`}
                      title={title}
                    >
                      <span className="text-xs">{icon}</span>
                      <span>{conditionName(cond)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
    </div>
  );

  // --- Embedded mode ---
  if (embedded) {
    return (
      <>
        {statusContent}
        {concSpellDetail && <SpellDetailModal spell={concSpellDetail} onClose={() => setConcSpellDetail(null)} />}
      </>
    );
  }

  // --- Dialog mode ---
  return (
    <>
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) setShowAddForm(false); onOpenChange(v); }} modal={false}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-lg max-h-[85dvh] bg-gray-900 border border-gray-700 rounded-lg p-4 flex flex-col z-50">
          <Dialog.Title className="sr-only">{t('statusEffectsDialog.title')}</Dialog.Title>
          {statusContent}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    {concSpellDetail && (
      <SpellDetailModal spell={concSpellDetail} onClose={() => setConcSpellDetail(null)} />
    )}
    </>
  );
}

// ── Add Effect Form ──
type ModType = 'bonus' | 'advantage' | 'disadvantage';
function AddEffectForm({ t, conditionName, onAdd, onCancel }: {
  t: TFn;
  conditionName: (c: ConditionType) => string;
  onAdd: (e: CustomStatusEffect) => void;
  onCancel: () => void;
}) {
  const modifierGroups = React.useMemo(() => buildModifierGroups(t), [t]);
  const [name, setName] = useState('');
  const [modifiers, setModifiers] = useState([{ param: 'ac', value: 0, type: 'bonus' as ModType }]);
  const [showHelp, setShowHelp] = useState(false);
  const [durationType, setDurationType] = useState<Duration['type']>('permanent');
  const [durationValue, setDurationValue] = useState(10);
  const [auraEnabled, setAuraEnabled] = useState(false);
  const [auraRadius, setAuraRadius] = useState(10);
  const [auraIcon, setAuraIcon] = useState(DEFAULT_AURA_ICON);
  const [auraColor, setAuraColor] = useState(DEFAULT_AURA_COLOR);
  const [auraDescription, setAuraDescription] = useState('');
  const [auraAffectsSelf, setAuraAffectsSelf] = useState(false);
  const [auraAffectsAllies, setAuraAffectsAllies] = useState(true);
  const [auraAffectsEnemies, setAuraAffectsEnemies] = useState(false);
  const [auraRequiresConscious, setAuraRequiresConscious] = useState(true);
  const [auraConditions, setAuraConditions] = useState<ConditionType[]>([]);

  const updateMod = (i: number, field: string, val: any) =>
    setModifiers(prev => prev.map((m, idx) => {
      if (idx !== i) return m;
      const u = { ...m, [field]: val };
      // Switching to adv/disadv → clear value, fix param if non-d20
      if (field === 'type' && val !== 'bonus') {
        u.value = 0;
        if (NON_D20_PARAMS.has(u.param)) u.param = 'attack';
      }
      return u;
    }));
  const removeMod = (i: number) => setModifiers(prev => prev.filter((_, idx) => idx !== i));
  const toggleAuraCondition = (condition: ConditionType) =>
    setAuraConditions((prev) =>
      prev.includes(condition)
        ? prev.filter((item) => item !== condition)
        : [...prev, condition]
    );

  const handleSubmit = () => {
    if (!name.trim()) return;
    const valid = modifiers.filter(m => m.type !== 'bonus' || m.value !== 0);
    const aura = auraEnabled
      ? normalizeAuraConfig({
          enabled: true,
          radius: auraRadius,
          icon: auraIcon,
          color: auraColor,
          fill_color: colorToAuraFill(auraColor),
          description: auraDescription.trim(),
          affects_self: auraAffectsSelf,
          affects_allies: auraAffectsAllies,
          affects_enemies: auraAffectsEnemies,
          requires_conscious: auraRequiresConscious,
          applies_conditions: auraConditions,
        })
      : undefined;
    if (valid.length === 0 && !aura) return;
    const dur: Duration = durationType === 'permanent'
      ? { ...PERMANENT_DURATION }
      : { type: durationType, value: durationValue, remaining: toRounds(durationType, durationValue), v: 2 };
    onAdd({
      id: `custom_${Date.now()}`,
      name: name.trim(),
      modifiers: valid,
      duration: dur,
      ...(aura ? { aura } : {}),
    });
  };

  // Filter non-d20 params for advantage/disadvantage
  const getParamGroups = (type: ModType) =>
    type === 'bonus' ? modifierGroups : modifierGroups.map(g => ({
      ...g, items: g.items.filter(p => !NON_D20_PARAMS.has(p.id))
    })).filter(g => g.items.length > 0);

  return (
    <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 space-y-3">
      <input type="text" placeholder={t('statusEffectsDialog.form.namePlaceholder')} value={name} onChange={e => setName(e.target.value)}
        className="w-full px-2.5 py-1.5 text-xs bg-gray-800 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:border-cyan-500/50 focus:outline-none" autoFocus />
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400">{t('statusEffectsDialog.form.modifiersLabel')}</span>
          <button onClick={() => setShowHelp(h => !h)}
            className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center transition-colors ${showHelp ? 'bg-cyan-500/30 text-cyan-300' : 'bg-gray-700/60 text-gray-500 hover:text-gray-300'}`}
            title={t('statusEffectsDialog.form.helpTitle')}>?</button>
        </div>
        {showHelp && (
          <div className="text-[10px] text-gray-400 bg-gray-800/60 rounded px-2.5 py-2 space-y-1 border border-gray-700/50">
            <div>{t('statusEffectsDialog.form.helpIntro')}</div>
            <div className="flex items-center gap-1.5"><span className="text-blue-300 font-bold">±</span> <span>{t('statusEffectsDialog.form.helpBonus')}</span></div>
            <div className="flex items-center gap-1.5"><span className="text-green-300 font-bold">⬆</span> <span>{t('statusEffectsDialog.form.helpAdv')}</span></div>
            <div className="flex items-center gap-1.5"><span className="text-red-300 font-bold">⬇</span> <span>{t('statusEffectsDialog.form.helpDisadv')}</span></div>
            <div className="text-gray-500 mt-1">{t('statusEffectsDialog.form.helpRight')}</div>
          </div>
        )}
        {modifiers.map((mod, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="flex border border-gray-600 rounded overflow-hidden flex-shrink-0">
              <button onClick={() => updateMod(i, 'type', 'bonus')}
                className={`px-1.5 py-1 text-[9px] ${mod.type === 'bonus' ? 'bg-blue-500/20 text-blue-300' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
                title={t('statusEffectsDialog.form.bonusTitle')}>±</button>
              <button onClick={() => updateMod(i, 'type', 'advantage')}
                className={`px-1.5 py-1 text-[9px] ${mod.type === 'advantage' ? 'bg-green-500/20 text-green-300' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
                title={t('statusEffectsDialog.form.advTitle')}>⬆</button>
              <button onClick={() => updateMod(i, 'type', 'disadvantage')}
                className={`px-1.5 py-1 text-[9px] ${mod.type === 'disadvantage' ? 'bg-red-500/20 text-red-300' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
                title={t('statusEffectsDialog.form.disadvTitle')}>⬇</button>
            </div>
            <select value={mod.param} onChange={e => updateMod(i, 'param', e.target.value)}
              className="flex-1 min-w-[70px] px-2 py-1 text-[10px] bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none">
              {getParamGroups(mod.type).map(g => (
                <optgroup key={g.label} label={g.label}>{g.items.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
              ))}
            </select>
            {mod.type === 'bonus' ? (
              <>
                <div className="flex items-center border border-gray-600 rounded overflow-hidden">
                  <button onClick={() => updateMod(i, 'value', Math.abs(mod.value) || 1)}
                    className={`px-1.5 py-1 text-[10px] ${mod.value >= 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}>+</button>
                  <button onClick={() => updateMod(i, 'value', -(Math.abs(mod.value) || 1))}
                    className={`px-1.5 py-1 text-[10px] ${mod.value < 0 ? 'bg-red-500/20 text-red-300' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}>−</button>
                </div>
                <input type="number" value={Math.abs(mod.value) || ''} onChange={e => { const v = parseInt(e.target.value) || 0; updateMod(i, 'value', mod.value < 0 ? -v : v); }}
                  className="w-12 px-1.5 py-1 text-[10px] text-center bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none" min={0} />
              </>
            ) : (
              <span className={`text-[10px] px-2 py-1 rounded flex-shrink-0 ${mod.type === 'advantage' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                {mod.type === 'advantage' ? t('statusEffectsDialog.form.advShort') : t('statusEffectsDialog.form.disadvShort')}
              </span>
            )}
            {modifiers.length > 1 && (
              <button onClick={() => removeMod(i)} className="text-gray-500 hover:text-red-400 text-xs" title={t('statusEffectsDialog.form.deleteRow')}>✕</button>
            )}
          </div>
        ))}
        <button onClick={() => setModifiers(prev => [...prev, { param: 'attack', value: 0, type: 'bonus' as ModType }])} className="text-[10px] text-cyan-500/70 hover:text-cyan-400 transition-colors">{t('statusEffectsDialog.form.addRow')}</button>
      </div>
      <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium text-sky-300">{t('statusEffectsDialog.form.auraToggleTitle')}</div>
            <div className="text-[10px] text-gray-500">{t('statusEffectsDialog.form.auraToggleDesc')}</div>
          </div>
          <button
            type="button"
            onClick={() => setAuraEnabled((prev) => !prev)}
            className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
              auraEnabled
                ? 'bg-sky-500/25 text-sky-200 border border-sky-400/40'
                : 'bg-gray-800 text-gray-400 border border-gray-600/60'
            }`}
          >
            {auraEnabled ? t('statusEffectsDialog.specialBuffs.on') : t('statusEffectsDialog.specialBuffs.off')}
          </button>
        </div>
        {auraEnabled && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-400">{t('statusEffectsDialog.form.auraRadius')}</span>
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={auraRadius}
                  onChange={(event) => setAuraRadius(Math.max(5, parseInt(event.target.value) || 5))}
                  className="px-2 py-1 text-[10px] bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-400">{t('statusEffectsDialog.form.auraIcon')}</span>
                <input
                  type="text"
                  value={auraIcon}
                  maxLength={2}
                  onChange={(event) => setAuraIcon(event.target.value || DEFAULT_AURA_ICON)}
                  className="px-2 py-1 text-[10px] bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-400">{t('statusEffectsDialog.form.auraColor')}</span>
                <input
                  type="color"
                  value={auraColor}
                  onChange={(event) => setAuraColor(event.target.value)}
                  className="h-[30px] w-full rounded border border-gray-600 bg-gray-800"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-400">{t('statusEffectsDialog.form.auraDescription')}</span>
              <input
                type="text"
                value={auraDescription}
                onChange={(event) => setAuraDescription(event.target.value)}
                placeholder={t('statusEffectsDialog.form.auraDescPlaceholder')}
                className="px-2.5 py-1.5 text-[10px] bg-gray-800 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none"
              />
            </label>
            <div className="space-y-1.5">
              <div className="text-[10px] text-gray-400">{t('statusEffectsDialog.form.auraAffects')}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { key: 'self', label: t('statusEffectsDialog.form.auraSelf'), active: auraAffectsSelf, toggle: () => setAuraAffectsSelf((prev) => !prev) },
                  { key: 'allies', label: t('statusEffectsDialog.form.auraAllies'), active: auraAffectsAllies, toggle: () => setAuraAffectsAllies((prev) => !prev) },
                  { key: 'enemies', label: t('statusEffectsDialog.form.auraEnemies'), active: auraAffectsEnemies, toggle: () => setAuraAffectsEnemies((prev) => !prev) },
                  { key: 'conscious', label: t('statusEffectsDialog.form.auraConscious'), active: auraRequiresConscious, toggle: () => setAuraRequiresConscious((prev) => !prev) },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={item.toggle}
                    className={`px-2 py-1.5 rounded text-[10px] border transition-colors ${
                      item.active
                        ? 'bg-sky-500/20 border-sky-400/40 text-sky-200'
                        : 'bg-gray-800/70 border-gray-600/60 text-gray-400'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400">{t('statusEffectsDialog.form.applyConditions')}</span>
                <span className="text-[9px] text-gray-500">{t('statusEffectsDialog.form.applyConditionsCount', { n: auraConditions.length })}</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {STANDARD_CONDITIONS.map((condition) => (
                  <button
                    key={condition}
                    type="button"
                    onClick={() => toggleAuraCondition(condition)}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] transition-colors ${
                      auraConditions.includes(condition)
                        ? 'bg-sky-500/15 border border-sky-400/30 text-sky-200'
                        : 'bg-gray-800/50 border border-gray-700/60 text-gray-500'
                    }`}
                  >
                    <span>{CONDITION_ICONS[condition]}</span>
                    <span>{conditionName(condition)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      {/* Duration */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-400 flex-shrink-0">{t('statusEffectsDialog.form.durationLabel')}</span>
        <select value={durationType} onChange={e => setDurationType(e.target.value as Duration['type'])}
          className="px-2 py-1 text-[10px] bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none">
          <option value="permanent">{t('statusEffectsDialog.form.durPermanent')}</option>
          <option value="rounds">{t('statusEffectsDialog.form.durRounds')}</option>
          <option value="minutes">{t('statusEffectsDialog.form.durMinutes')}</option>
          <option value="hours">{t('statusEffectsDialog.form.durHours')}</option>
        </select>
        {durationType !== 'permanent' && (
          <input type="number" value={durationValue} onChange={e => setDurationValue(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-14 px-1.5 py-1 text-[10px] text-center bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none" min={1} />
        )}
        {durationType !== 'permanent' && durationType !== 'rounds' && (
          <span className="text-[9px] text-gray-500">{t('statusEffectsDialog.form.equalsRounds', { n: toRounds(durationType, durationValue) })}</span>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1 text-[10px] text-gray-400 hover:text-gray-200 rounded border border-gray-600 hover:border-gray-500 transition-colors">{t('statusEffectsDialog.form.cancel')}</button>
        <button onClick={handleSubmit} disabled={!name.trim() || (modifiers.every(m => m.type === 'bonus' && m.value === 0) && !auraEnabled)}
          className="px-3 py-1 text-[10px] text-cyan-300 rounded border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">{t('statusEffectsDialog.form.confirm')}</button>
      </div>
    </div>
  );
}

// ── Custom Effect Row ──
function CustomEffectRow({ t, conditionName, effect, isDM, onRemove, onUpdateDuration }: {
  t: TFn;
  conditionName: (c: ConditionType) => string;
  effect: CustomStatusEffect; isDM?: boolean; onRemove: () => void; onUpdateDuration: (dur: Duration) => void;
}) {
  const hasAura = !!effect.aura;
  const bonusMods = effect.modifiers.filter(m => !m.type || m.type === 'bonus');
  const advMods = effect.modifiers.filter(m => m.type === 'advantage' || m.type === 'disadvantage');
  const sum = bonusMods.reduce((s, m) => s + m.value, 0);
  const hasAdv = advMods.some(m => m.type === 'advantage');
  const hasDisadv = advMods.some(m => m.type === 'disadvantage');
  const icon = hasAura
    ? (effect.aura?.icon || DEFAULT_AURA_ICON)
    : hasAdv && !hasDisadv ? '⬆' : hasDisadv && !hasAdv ? '⬇' : sum > 0 ? '▲' : sum < 0 ? '▼' : advMods.length > 0 ? '◇' : '◆';
  const borderColor = hasAura ? 'border-sky-500/25' : hasAdv ? 'border-green-500/25' : hasDisadv ? 'border-red-500/25' : sum > 0 ? 'border-emerald-500/25' : sum < 0 ? 'border-red-500/25' : 'border-gray-600/40';
  const bgColor = hasAura ? 'bg-sky-500/5' : hasAdv ? 'bg-green-500/5' : hasDisadv ? 'bg-red-500/5' : sum > 0 ? 'bg-emerald-500/5' : sum < 0 ? 'bg-red-500/5' : 'bg-gray-800/30';
  const dur = effect.duration;
  const auraTargets = [
    effect.aura?.affects_self ? t('statusEffectsDialog.form.auraSelf') : null,
    effect.aura?.affects_allies ? t('statusEffectsDialog.form.auraAllies') : null,
    effect.aura?.affects_enemies ? t('statusEffectsDialog.form.auraEnemies') : null,
  ].filter(Boolean).join(' / ');
  const appliesList = effect.aura?.applies_conditions
    ?.map((c) => conditionName(c))
    .join(t('statusEffectsDialog.listSeparator'));

  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${borderColor} ${bgColor}`}>
      <span className="text-sm flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-200">{effect.name}</span>
          <DurationBadge t={t} dur={dur} isDM={isDM} onChange={onUpdateDuration} />
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
          {effect.modifiers.map((m, i) => {
            const label = paramLabel(t, m.param);
            if (m.type === 'advantage') return <span key={i} className="text-[9px] text-green-400">{label} {t('statusEffectsDialog.customEffects.advShort')}</span>;
            if (m.type === 'disadvantage') return <span key={i} className="text-[9px] text-red-400">{label} {t('statusEffectsDialog.customEffects.disadvShort')}</span>;
            return <span key={i} className={`text-[9px] ${m.value > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{label} {m.value > 0 ? '+' : ''}{m.value}</span>;
          })}
          {hasAura && (
            <span className="text-[9px] text-sky-300">
              {auraTargets
                ? t('statusEffectsDialog.customEffects.auraWithTargets', { radius: effect.aura?.radius, targets: auraTargets })
                : t('statusEffectsDialog.customEffects.aura', { radius: effect.aura?.radius })}
            </span>
          )}
          {hasAura && !!effect.aura?.applies_conditions?.length && (
            <span className="text-[9px] text-sky-200/80">
              {t('statusEffectsDialog.customEffects.applies', { list: appliesList })}
            </span>
          )}
        </div>
      </div>
      {isDM && (
        <button onClick={onRemove} className="text-gray-500 hover:text-red-400 text-xs flex-shrink-0 p-1" title={t('statusEffectsDialog.customEffects.removeTitle')}>✕</button>
      )}
    </div>
  );
}

// ── Duration Badge (inline, for custom effects) ──
function DurationBadge({ t, dur, isDM, onChange }: { t: TFn; dur: Duration; isDM?: boolean; onChange?: (d: Duration) => void }) {
  if (!dur || dur.type === 'permanent') {
    return <span className="text-[9px] text-gray-500 px-1.5 py-0.5 rounded bg-gray-700/40">{t('statusEffectsDialog.duration.permanent')}</span>;
  }
  const pct = durationPct(dur);
  const color = pct > 50 ? 'text-green-400 bg-green-500/10' : pct > 20 ? 'text-yellow-400 bg-yellow-500/10' : 'text-red-400 bg-red-500/10';
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 ${color}`}>
      {isDM && <button onClick={() => onChange?.({ ...dur, remaining: Math.max(0, dur.remaining - 1) })} className="hover:opacity-70">−</button>}
      <span title={`${formatRounds(dur.remaining, t)} / ${formatTotal(dur, t)}`}>{formatRounds(dur.remaining, t)}</span>
      {isDM && <button onClick={() => onChange?.({ ...dur, remaining: dur.remaining + 1 })} className="hover:opacity-70">+</button>}
    </span>
  );
}

// ── Duration Editor (button + inline edit, for conditions & exhaustion) ──
function DurationEditor({ t, dur, onChange }: { t: TFn; dur: Duration; onChange: (d: Duration) => void }) {
  const [editing, setEditing] = useState(false);
  const [editType, setEditType] = useState<Duration['type']>(dur.type === 'permanent' ? 'rounds' : dur.type);
  const [editValue, setEditValue] = useState(dur.type === 'permanent' ? 10 : dur.value);

  if (!editing) {
    if (!dur || dur.type === 'permanent') {
      return (
        <button onClick={() => { setEditType('rounds'); setEditValue(10); setEditing(true); }}
          className="mt-1 text-[10px] px-2 py-0.5 rounded border border-gray-600/50 text-gray-400 hover:text-gray-200 hover:border-gray-500 bg-gray-800/40 transition-colors">
          {t('statusEffectsDialog.duration.permanentLabel')}
        </button>
      );
    }
    const pct = durationPct(dur);
    return (
      <span className={`mt-1 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border ${pctBorderBg(pct)}`}>
        <button onClick={() => onChange({ ...dur, remaining: Math.max(0, dur.remaining - 1) })} className="hover:opacity-70 font-bold">−</button>
        <button onClick={() => { setEditType(dur.type); setEditValue(dur.value); setEditing(true); }} className="hover:opacity-70">
          {t('statusEffectsDialog.duration.label', { remaining: formatRounds(dur.remaining, t), total: formatTotal(dur, t) })}
        </button>
        <button onClick={() => onChange({ ...dur, remaining: dur.remaining + 1 })} className="hover:opacity-70 font-bold">+</button>
      </span>
    );
  }

  const handleConfirm = () => {
    if (editType === 'permanent') onChange({ ...PERMANENT_DURATION });
    else onChange({ type: editType, value: editValue, remaining: toRounds(editType, editValue), v: 2 });
    setEditing(false);
  };

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <select value={editType} onChange={e => setEditType(e.target.value as Duration['type'])}
        className="px-1.5 py-0.5 text-[10px] bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none" autoFocus>
        <option value="permanent">{t('statusEffectsDialog.duration.permanent')}</option>
        <option value="rounds">{t('statusEffectsDialog.duration.rounds')}</option>
        <option value="minutes">{t('statusEffectsDialog.duration.minutes')}</option>
        <option value="hours">{t('statusEffectsDialog.duration.hours')}</option>
      </select>
      {editType !== 'permanent' && (
        <>
          <input type="number" value={editValue} onChange={e => setEditValue(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-12 px-1 py-0.5 text-[10px] text-center bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none" min={1} />
          {editType !== 'rounds' && <span className="text-[9px] text-gray-500">{t('statusEffectsDialog.duration.equalsRounds', { n: toRounds(editType, editValue) })}</span>}
        </>
      )}
      <button onClick={handleConfirm} className="text-[10px] text-cyan-400 hover:text-cyan-300 px-1">✓</button>
      <button onClick={() => setEditing(false)} className="text-[10px] text-gray-500 hover:text-gray-300 px-1">✕</button>
    </div>
  );
}

// ── Player-facing read-only display ──
function DurationReadonly({ t, dur }: { t: TFn; dur: Duration }) {
  if (!dur || dur.type === 'permanent') return null;
  const pct = durationPct(dur);
  const color = pct > 50 ? 'text-green-400 bg-green-500/10' : pct > 20 ? 'text-yellow-400 bg-yellow-500/10' : 'text-red-400 bg-red-500/10';
  return (
    <span className={`mt-1 inline-block text-[10px] px-2 py-0.5 rounded ${color}`} title={formatRounds(dur.remaining, t)}>
      {formatRounds(dur.remaining, t)} / {formatTotal(dur, t)}
    </span>
  );
}

// ── Exhaustion Tracker ──
function ExhaustionTracker({ t, level }: { t: TFn; level: number }) {
  const levels = [1, 2, 3, 4, 5, 6].map((lv) => ({
    lv,
    desc: t(`statusEffectsDialog.exhaustion.levels.${lv}.desc`),
    tag: t(`statusEffectsDialog.exhaustion.levels.${lv}.tag`),
  }));
  return (
    <div className="space-y-1.5">
      {levels.map(l => {
        const active = level >= l.lv;
        return (
          <div key={l.lv} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors ${
            active
              ? l.lv === 6
                ? "bg-red-500/25 text-red-200 border border-red-500/40 font-medium"
                : "bg-amber-500/20 text-amber-200 border border-amber-500/30"
              : "bg-gray-800/30 text-gray-600 border border-transparent"
          }`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
              active
                ? l.lv === 6 ? "bg-red-500/50 text-red-100" : "bg-amber-500/40 text-amber-100"
                : "bg-gray-700/50 text-gray-600"
            }`}>{l.lv}</span>
            <span className="flex-1">{l.desc}</span>
            {active && <span className="text-[10px] opacity-70 flex-shrink-0">{l.tag}</span>}
          </div>
        );
      })}
    </div>
  );
}
