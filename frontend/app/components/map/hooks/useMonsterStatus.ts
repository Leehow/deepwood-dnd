/**
 * useMonsterStatus — manages status effects state for a monster instance,
 * providing the same props that StatusEffectsDialog expects.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  migrateCustomEffects,
  migrateConditions,
  migrateDuration,
  PERMANENT_DURATION,
  SHORT_REST_ROUNDS,
  LONG_REST_ROUNDS,
} from '~/components/character/StatusEffectsDialog';
import type {
  CustomStatusEffect,
  ConditionWithDuration,
  Duration,
} from '~/components/character/StatusEffectsDialog';
import type { ConditionType } from '~/types/effects';
import { apiFetch } from '~/utils/api-client';
import { createLogger } from '~/utils/logger';

const logger = createLogger('useMonsterStatus');

export function useMonsterStatus(
  monsterInstance: any,
  tokenActiveEffects: any[] = [],
  currentUserId?: string,
  onDataUpdated?: (updated: any) => void,
) {
  const saved = monsterInstance?.status_effects as any;

  const [customEffects, setCustomEffects] = useState<CustomStatusEffect[]>(
    () => migrateCustomEffects(saved?.effects),
  );
  const [activeConditions, setActiveConditions] = useState<ConditionWithDuration[]>(
    () => migrateConditions(saved?.conditions),
  );
  const [exhaustionLevel, setExhaustionLevel] = useState<number>(
    saved?.exhaustion_level ?? 0,
  );
  const [exhaustionDuration, setExhaustionDuration] = useState<Duration>(
    () => migrateDuration(saved?.exhaustion_duration) ?? { ...PERMANENT_DURATION },
  );
  const [spellBuffs, setSpellBuffs] = useState<any[]>(
    () => (tokenActiveEffects || []).filter((e: any) => e?.spell_buff),
  );

  // Re-sync when monsterInstance changes
  const statusJson = JSON.stringify(monsterInstance?.status_effects);
  useEffect(() => {
    const s = monsterInstance?.status_effects as any;
    setCustomEffects(migrateCustomEffects(s?.effects));
    setActiveConditions(migrateConditions(s?.conditions));
    setExhaustionLevel(s?.exhaustion_level ?? 0);
    setExhaustionDuration(migrateDuration(s?.exhaustion_duration) ?? { ...PERMANENT_DURATION });
  }, [monsterInstance?.id, statusJson]);

  useEffect(() => {
    setSpellBuffs((tokenActiveEffects || []).filter((e: any) => e?.spell_buff));
  }, [tokenActiveEffects]);

  const persistStatusEffects = useCallback(async (
    effects: CustomStatusEffect[],
    conditions: ConditionWithDuration[],
    exhaustion: number,
    exhDuration?: Duration,
  ) => {
    const payload = {
      status_effects: {
        effects: effects || [],
        conditions: conditions || [],
        exhaustion_level: exhaustion,
        exhaustion_duration: exhDuration,
      },
    };
    try {
      const resp = await apiFetch(`/api/monster-instances/${monsterInstance.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        userId: currentUserId,
      });
      if (resp.ok) {
        const updated = await resp.json();
        onDataUpdated?.(updated);
      }
    } catch (e) {
      logger.error('Failed to persist monster status:', e);
    }
  }, [monsterInstance?.id, currentUserId, onDataUpdated]);

  const advanceTime = useCallback((rounds: number, exhaustionReduction = 0) => {
    const decrement = (dur: Duration | undefined) =>
      dur && dur.type !== 'permanent' ? { ...dur, remaining: dur.remaining - rounds } : dur;
    const alive = (dur: Duration | undefined) =>
      !dur || dur.type === 'permanent' || dur.remaining > 0;

    const nextEffects = customEffects.map(e => ({ ...e, duration: decrement(e.duration)! })).filter(e => alive(e.duration));
    setCustomEffects(nextEffects);
    const nextConditions = activeConditions.map(c => ({ ...c, duration: decrement(c.duration)! })).filter(c => alive(c.duration));
    setActiveConditions(nextConditions);

    let nextExhLv = exhaustionLevel;
    let nextExhDur = exhaustionDuration;
    if (nextExhDur?.type !== 'permanent' && nextExhDur?.remaining > 0) {
      nextExhDur = { ...nextExhDur, remaining: nextExhDur.remaining - rounds };
      if (nextExhDur.remaining <= 0) { nextExhLv = 0; nextExhDur = { ...PERMANENT_DURATION }; }
    }
    if (exhaustionReduction > 0 && nextExhLv > 0) {
      nextExhLv = Math.max(0, nextExhLv - exhaustionReduction);
      if (nextExhLv === 0) nextExhDur = { ...PERMANENT_DURATION };
    }
    setExhaustionLevel(nextExhLv);
    setExhaustionDuration(nextExhDur);
    persistStatusEffects(nextEffects, nextConditions, nextExhLv, nextExhDur);
  }, [customEffects, activeConditions, exhaustionLevel, exhaustionDuration, persistStatusEffects]);

  /** All props needed by <StatusEffectsDialog /> */
  const statusDialogProps = useMemo(() => ({
    characterName: monsterInstance?.name_cn || monsterInstance?.name || '怪物',
    incomingSpellBuffs: spellBuffs,
    customEffects,
    activeConditions,
    exhaustionLevel,
    exhaustionDuration,
    onAddEffect: (e: CustomStatusEffect) => {
      setCustomEffects(prev => {
        const next = [...prev, e];
        persistStatusEffects(next, activeConditions, exhaustionLevel, exhaustionDuration);
        return next;
      });
    },
    onRemoveEffect: (id: string) => {
      setCustomEffects(prev => {
        const next = prev.filter(x => x.id !== id);
        persistStatusEffects(next, activeConditions, exhaustionLevel, exhaustionDuration);
        return next;
      });
    },
    onUpdateEffect: (id: string, patch: Partial<CustomStatusEffect>) => {
      setCustomEffects(prev => {
        const next = prev.map(x => x.id === id ? { ...x, ...patch } : x);
        persistStatusEffects(next, activeConditions, exhaustionLevel, exhaustionDuration);
        return next;
      });
    },
    onAdvanceRound: () => advanceTime(1),
    onShortRest: () => advanceTime(SHORT_REST_ROUNDS),
    onLongRest: () => advanceTime(LONG_REST_ROUNDS, 1),
    onToggleCondition: (c: ConditionType) => {
      setActiveConditions(prev => {
        const exists = prev.find(x => x.condition === c);
        const next = exists ? prev.filter(x => x.condition !== c) : [...prev, { condition: c, duration: { ...PERMANENT_DURATION }, source: { type: 'dm' as const }, removal: { type: 'manual' as const } }];
        persistStatusEffects(customEffects, next, exhaustionLevel, exhaustionDuration);
        return next;
      });
    },
    onUpdateConditionDuration: (c: ConditionType, dur: Duration) => {
      setActiveConditions(prev => {
        const next = prev.map(x => x.condition === c ? { ...x, duration: dur } : x);
        persistStatusEffects(customEffects, next, exhaustionLevel, exhaustionDuration);
        return next;
      });
    },
    onSetExhaustion: (lv: number) => {
      setExhaustionLevel(lv);
      const dur = lv === 0 ? { ...PERMANENT_DURATION } : exhaustionDuration;
      if (lv === 0) setExhaustionDuration(dur);
      persistStatusEffects(customEffects, activeConditions, lv, dur);
    },
    onSetExhaustionDuration: (dur: Duration) => {
      setExhaustionDuration(dur);
      persistStatusEffects(customEffects, activeConditions, exhaustionLevel, dur);
    },
  }), [
    monsterInstance?.name, monsterInstance?.name_cn,
    spellBuffs, customEffects, activeConditions, exhaustionLevel, exhaustionDuration,
    persistStatusEffects, advanceTime,
  ]);

  return statusDialogProps;
}
