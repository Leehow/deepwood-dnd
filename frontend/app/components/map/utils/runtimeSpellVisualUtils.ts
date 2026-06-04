import type {
  SpellVisualProjection,
  TokenFilterVisual,
} from "../types/TacticalMapTypes";
import { isExpiredByWorldTime } from "./runtimeSpellBadgeStatusUtils";

type WorldTimeLike = {
  day?: number | null;
  hour?: number | null;
  minute?: number | null;
  second?: number | null;
} | null | undefined;

export type MergedTokenFilterVisual = TokenFilterVisual & {
  overlays: string[];
};

/** Legacy active_effects entry that carries a token visual filter
 *  (effect_engine `apply_token_filter` verb). Only a loose shape is needed here. */
type LegacyTokenFilterEffect = {
  effect_type?: string;
  filter?: TokenFilterVisual | null;
  expires_at?: WorldTimeLike;
};

export function mergeProjectedTokenVisuals(
  spellVisuals: SpellVisualProjection[] | null | undefined,
  currentWorldTime?: WorldTimeLike,
  activeEffects?: LegacyTokenFilterEffect[] | null,
): MergedTokenFilterVisual | null {
  const filters: TokenFilterVisual[] = (spellVisuals || [])
    .filter((visual) => !isExpiredByWorldTime(visual?.expires_at, currentWorldTime))
    .map((visual) => visual?.token_filter)
    .filter((filter): filter is TokenFilterVisual => Boolean(filter));

  // Legacy path: spells that pre-date the v2 spell_visuals projection (e.g.
  // faerie_fire) surface their token glow/outline as an `apply_token_filter`
  // entry in active_effects instead. Merge those too so their visuals render.
  for (const eff of activeEffects || []) {
    if (eff?.effect_type !== "apply_token_filter" || !eff.filter) continue;
    if (isExpiredByWorldTime(eff.expires_at, currentWorldTime)) continue;
    filters.push(eff.filter);
  }

  if (filters.length === 0) {
    return null;
  }

  const result: MergedTokenFilterVisual = { overlays: [] };
  for (const filter of filters) {
    if (filter.blur != null) {
      result.blur = Math.max(result.blur ?? 0, filter.blur);
    }
    if (filter.opacity != null) {
      result.opacity = Math.min(result.opacity ?? 1, filter.opacity);
    }
    if (filter.glow) {
      const nextGlowRadius = filter.glowRadius ?? 10;
      if (!result.glowRadius || nextGlowRadius > result.glowRadius) {
        result.glow = filter.glow;
        result.glowRadius = nextGlowRadius;
      }
    }
    if (filter.glowAnimation) {
      result.glowAnimation = filter.glowAnimation;
    }
    if (filter.overlay) {
      result.overlays.push(filter.overlay);
    }
    if (filter.saturate != null) {
      result.saturate = Math.min(result.saturate ?? 1, filter.saturate);
    }
    if (filter.brightness != null) {
      result.brightness = Math.max(-1, Math.min(1, (result.brightness ?? 0) + filter.brightness));
    }
  }
  return result;
}
