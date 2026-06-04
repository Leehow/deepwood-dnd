import type {
  SpellRuntimeBadge,
  SpellRuntimeOverlay,
  StatusEffect,
} from "../types/TacticalMapTypes";

type WorldTimeLike = {
  day?: number | null;
  hour?: number | null;
  minute?: number | null;
  second?: number | null;
} | null | undefined;

type RuntimeDisplayStatusEffect = StatusEffect & {
  runtime_display_only?: boolean;
  runtime_instance_id?: number | null;
};

const DEFAULT_RUNTIME_COLOR = "#7c3aed";
const DEFAULT_RUNTIME_ICON = "✦";

function worldTimeToScalar(time: WorldTimeLike): number | null {
  if (!time) {
    return null;
  }
  return (((((time.day ?? 123) * 24) + (time.hour ?? 0)) * 60 + (time.minute ?? 0)) * 60 + (time.second ?? 0));
}

export function getRemainingRoundsFromExpiry(
  expiresAt: WorldTimeLike,
  currentWorldTime?: WorldTimeLike,
): number | undefined {
  const expiryScalar = worldTimeToScalar(expiresAt);
  const currentScalar = worldTimeToScalar(currentWorldTime);
  if (expiryScalar == null || currentScalar == null) {
    return undefined;
  }
  const remainingSeconds = expiryScalar - currentScalar;
  if (remainingSeconds <= 0) {
    return 0;
  }
  return Math.ceil(remainingSeconds / 6);
}

export function isExpiredByWorldTime(
  expiresAt: WorldTimeLike,
  currentWorldTime?: WorldTimeLike,
): boolean {
  const remainingRounds = getRemainingRoundsFromExpiry(expiresAt, currentWorldTime);
  return remainingRounds === 0;
}

function getDisplayDuration(
  effect: {
    expires_at?: WorldTimeLike;
    remaining_rounds?: number | null;
    duration_rounds?: number | null;
    duration?: number | null;
    roundsRemaining?: number | null;
  },
  currentWorldTime?: WorldTimeLike,
): number | undefined {
  const remainingFromExpiry = getRemainingRoundsFromExpiry(effect.expires_at, currentWorldTime);
  if (remainingFromExpiry != null) {
    return remainingFromExpiry;
  }
  return (
    effect.remaining_rounds ??
    effect.duration ??
    effect.duration_rounds ??
    effect.roundsRemaining ??
    undefined
  );
}

function buildRuntimeBadgeEffects(
  spellBadges: SpellRuntimeBadge[] | null | undefined,
  spellOverlays: SpellRuntimeOverlay[] | null | undefined,
  currentWorldTime?: WorldTimeLike,
): RuntimeDisplayStatusEffect[] {
  if (!spellBadges?.length || !spellOverlays?.length) {
    return [];
  }

  const targetOverlays = new Map<number, SpellRuntimeOverlay>();
  for (const overlay of spellOverlays) {
    if (!overlay || overlay.role !== "target") {
      continue;
    }
    targetOverlays.set(overlay.runtime_instance_id, overlay);
  }

  return spellBadges.flatMap((badge) => {
    if (!badge) {
      return [];
    }

    const overlay = targetOverlays.get(badge.runtime_instance_id);
    if (!overlay) {
      return [];
    }
    if (isExpiredByWorldTime(overlay.expires_at ?? badge.expires_at, currentWorldTime)) {
      return [];
    }

    const duration = getDisplayDuration(
      {
        expires_at: overlay.expires_at ?? badge.expires_at,
        remaining_rounds: overlay.remaining_rounds ?? badge.remaining_rounds,
        duration_rounds: overlay.duration_rounds ?? badge.duration_rounds,
      },
      currentWorldTime,
    );

    return [
      {
        id: `runtime_spell_badge_${badge.runtime_instance_id}`,
        name: overlay.label || badge.label,
        icon: badge.icon || overlay.icon || DEFAULT_RUNTIME_ICON,
        color: badge.color || overlay.color || DEFAULT_RUNTIME_COLOR,
        duration,
        maxDuration:
          overlay.duration_rounds ??
          badge.duration_rounds ??
          undefined,
        expires_at: overlay.expires_at ?? badge.expires_at ?? undefined,
        spell_buff: true,
        spell_id: badge.spell_id,
        runtime_display_only: true,
        runtime_instance_id: badge.runtime_instance_id,
      },
    ];
  });
}

export function buildTokenDisplayStatusEffects({
  activeEffects,
  spellBadges,
  spellOverlays,
  currentWorldTime,
}: {
  activeEffects?: StatusEffect[] | null;
  spellBadges?: SpellRuntimeBadge[] | null;
  spellOverlays?: SpellRuntimeOverlay[] | null;
  currentWorldTime?: WorldTimeLike;
}): RuntimeDisplayStatusEffect[] {
  const runtimeBadgeEffects = buildRuntimeBadgeEffects(spellBadges, spellOverlays, currentWorldTime);
  const legacyEffects = (Array.isArray(activeEffects) ? activeEffects : [])
    .filter((effect) => !isExpiredByWorldTime(effect?.expires_at, currentWorldTime))
    .map((effect) => {
      const duration = getDisplayDuration(effect, currentWorldTime);
      if (duration == null || duration === effect.duration) {
        return effect;
      }
      return {
        ...effect,
        duration,
      };
    });

  if (runtimeBadgeEffects.length === 0) {
    return legacyEffects;
  }

  const runtimeSpellIds = new Set(
    runtimeBadgeEffects
      .map((effect) => effect.spell_id)
      .filter((spellId): spellId is string => Boolean(spellId)),
  );

  const filteredLegacyEffects = legacyEffects.filter((effect) => {
    if (!effect?.spell_buff) {
      return true;
    }
    if (!effect.spell_id) {
      return true;
    }
    return !runtimeSpellIds.has(effect.spell_id);
  });

  return [...runtimeBadgeEffects, ...filteredLegacyEffects];
}
