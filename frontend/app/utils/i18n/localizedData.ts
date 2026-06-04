/**
 * Rule-data localized field helper.
 *
 * Compatibility layer that resolves localized `name` / `description` (and
 * arbitrary string fields) on rule-data entities. Supports both the current
 * legacy shape (Chinese in canonical `name`/`description`, English in
 * `nameEn`/`name_en` / `descriptionEn`/`description_en`) and the future
 * canonical shape (English in canonical fields, locale overlays under
 * `locales: { "zh-CN": { name, description }, "en-US": { ... } }`).
 *
 * Behavior contract:
 * - Pure: never imports React, never mutates input.
 * - Defensive: null / undefined / non-object input returns the supplied
 *   fallback (default `""`) and never throws.
 * - Locale normalization: unknown / empty locale falls back to the frontend
 *   `DEFAULT_LOCALE`.
 * - For `en-US`: prefer `locales["en-US"]`, then English-specific suffixed
 *   fields (`nameEn`/`name_en`), then canonical, then Chinese-specific
 *   suffixed fields as last resort.
 * - For `zh-CN`: prefer `locales["zh-CN"]`, then Chinese-specific suffixed
 *   fields (`nameCn`/`name_cn`), then canonical `name`/`description` (which
 *   today still hold Chinese), then English fields as last resort.
 */

import {
  DEFAULT_LOCALE,
  normalizeLocale,
  type SupportedLocale,
} from '~/i18n/config';

export interface LocalizedEntity {
  name?: string;
  description?: string;
  // Legacy English-suffixed fields (current rule data).
  nameEn?: string;
  name_en?: string;
  descriptionEn?: string;
  description_en?: string;
  // Legacy Chinese-suffixed fields (e.g. magic-items: rarityCn etc.).
  nameCn?: string;
  name_cn?: string;
  descriptionCn?: string;
  description_cn?: string;
  // Future canonical overlay shape.
  locales?: Partial<
    Record<SupportedLocale, Partial<Record<string, string>> | undefined>
  >;
  // Allow arbitrary additional fields for getLocalizedField.
  [extra: string]: unknown;
}

type LocaleInput = SupportedLocale | string | null | undefined;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOverlay(
  entity: Record<string, unknown>,
  locale: SupportedLocale,
  field: string,
): string | undefined {
  const localesRaw = entity['locales'];
  if (!isObjectRecord(localesRaw)) return undefined;
  const overlay = localesRaw[locale];
  if (!isObjectRecord(overlay)) return undefined;
  const value = overlay[field];
  return isNonEmptyString(value) ? value : undefined;
}

function readField(
  entity: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = entity[key];
  return isNonEmptyString(value) ? value : undefined;
}

/**
 * Build the suffixed-field fallback list for a given canonical field and
 * locale. Both camelCase (`nameEn`) and snake_case (`name_en`) variants are
 * checked so the helper works across both `rules/*` (camelCase) and
 * `backend/*` / `modules/*` (snake_case) datasets.
 */
function suffixedKeys(
  field: string,
  variant: 'en' | 'cn',
): readonly string[] {
  const camelSuffix = variant === 'en' ? 'En' : 'Cn';
  const snakeSuffix = variant === 'en' ? '_en' : '_cn';
  return [`${field}${camelSuffix}`, `${field}${snakeSuffix}`];
}

/**
 * Resolve a single localized string field on `entity`.
 *
 * Returns `fallback` (default `""`) if no value is found. Never throws.
 */
export function getLocalizedField(
  entity: unknown,
  field: string,
  locale?: LocaleInput,
  fallback: string = '',
): string {
  if (!isObjectRecord(entity)) return fallback;
  if (typeof field !== 'string' || field.length === 0) return fallback;

  const normalized: SupportedLocale = locale
    ? normalizeLocale(locale)
    : DEFAULT_LOCALE;

  const overlay = readOverlay(entity, normalized, field);
  if (overlay !== undefined) return overlay;

  if (normalized === 'en-US') {
    for (const key of suffixedKeys(field, 'en')) {
      const value = readField(entity, key);
      if (value !== undefined) return value;
    }
    const canonical = readField(entity, field);
    if (canonical !== undefined) return canonical;
    // Last resort: zh-suffixed fields (so callers still see *something*).
    for (const key of suffixedKeys(field, 'cn')) {
      const value = readField(entity, key);
      if (value !== undefined) return value;
    }
    return fallback;
  }

  // zh-CN (and any other future locale we treat as Chinese-preferring today).
  for (const key of suffixedKeys(field, 'cn')) {
    const value = readField(entity, key);
    if (value !== undefined) return value;
  }
  const canonical = readField(entity, field);
  if (canonical !== undefined) return canonical;
  for (const key of suffixedKeys(field, 'en')) {
    const value = readField(entity, key);
    if (value !== undefined) return value;
  }
  return fallback;
}

/**
 * Resolve the localized display name of a rule-data entity.
 */
export function getLocalizedName(
  entity: unknown,
  locale?: LocaleInput,
  fallback: string = '',
): string {
  return getLocalizedField(entity, 'name', locale, fallback);
}

/**
 * Resolve the localized long-form description of a rule-data entity.
 */
export function getLocalizedDescription(
  entity: unknown,
  locale?: LocaleInput,
  fallback: string = '',
): string {
  return getLocalizedField(entity, 'description', locale, fallback);
}
