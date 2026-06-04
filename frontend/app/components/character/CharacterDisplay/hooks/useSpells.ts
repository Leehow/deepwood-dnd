import { useEffect, useMemo, useState, useCallback } from "react";
import {
  isSpellcaster as isSpellcasterUtil,
  isPreparedCaster as isPreparedCasterUtil,
  isSpellbookCaster as isSpellbookCasterUtil,
  preparedMax as computePreparedMax,
  getAlwaysPreparedSubclassSpells,
  maxSpellLevelForClass,
  getRacialSpells,
} from "../utils/spellcasting";
import { extractSpellIds } from "~/utils/spellHelpers";
import invocationsData from "~/data/rules/eldritch_invocations.json";

import type { Spell } from "../types/Spell";
import type { Character, AbilityScores, EquipmentItem, Currency } from "../types/Character";

export interface UseSpellsArgs {
  character: Character;
  abilityMods: AbilityScores;
  spellsAll: Spell[];
  persistCharacterPartial: (
    nextEquipment?: EquipmentItem[] | undefined,
    nextPreparedSpells?: string[] | undefined,
    nextCurrency?: Currency | undefined
  ) => Promise<boolean | any>;
}

export function useSpells({ character, abilityMods, spellsAll, persistCharacterPartial }: UseSpellsArgs) {
  const isSpellcaster = useMemo(
    () => isSpellcasterUtil(character.class_id, character.subclass_id ?? undefined),
    [character.class_id, character.subclass_id],
  );

  const isPreparedCaster = useMemo(
    () => isPreparedCasterUtil(character.class_id),
    [character.class_id],
  );

  const autoPrepared = useMemo(
    () => getAlwaysPreparedSubclassSpells(character),
    [character.class_id, character.subclass_id, character.level],
  );

  // Racial spells (e.g., Drow Magic, Infernal Legacy, High Elf cantrip)
  const raceChoices = character.race_choices || character.raceChoices;
  const racialSpellsData = useMemo(
    () => getRacialSpells(character.race_id, character.subrace_id ?? null, character.level || 1, raceChoices),
    [character.race_id, character.subrace_id, character.level, raceChoices],
  );
  const racialSpellIds = useMemo(
    () => racialSpellsData.map((rs) => rs.id),
    [racialSpellsData],
  );

  // Invocation-granted spells (Eldritch Invocations with grantedSpell)
  const invocationSpellsData = useMemo(() => {
    const invocations = (character as any).eldritch_invocations || (character as any).eldritchInvocations || [];
    if (!invocations.length) return [];
    const invIds = invocations.map((i: any) => typeof i === 'string' ? i : i.value || i.id || '');
    const results: { spellId: string; invocationName: string; atWill: boolean; usesPerLongRest?: number }[] = [];
    for (const invId of invIds) {
      const inv = (invocationsData as any).invocations?.find((x: any) => x.id === invId);
      if (inv?.grantedSpell) {
        results.push({
          spellId: inv.grantedSpell.id,
          invocationName: inv.name,
          atWill: inv.grantedSpell.atWill ?? false,
          usesPerLongRest: inv.grantedSpell.usesPerLongRest,
        });
      }
    }
    return results;
  }, [(character as any).eldritch_invocations, (character as any).eldritchInvocations]);

  const invocationSpellIds = useMemo(
    () => invocationSpellsData.map((is) => is.spellId),
    [invocationSpellsData],
  );

  // Feat-granted spells (Magic Initiate, Ritual Caster, Spell Sniper)
  const featSpellIds = useMemo(() => {
    const fc = character.feat_choices || (character as any).featChoices;
    if (!fc) return { cantrips: [] as string[], spells: [] as string[] };
    const cantrips: string[] = [];
    const spells: string[] = [];
    if (fc.magic_initiate) {
      if (Array.isArray(fc.magic_initiate.cantrips)) cantrips.push(...fc.magic_initiate.cantrips);
      if (fc.magic_initiate.spell) spells.push(fc.magic_initiate.spell);
    }
    if (fc.spell_sniper?.cantrip) cantrips.push(fc.spell_sniper.cantrip);
    if (fc.ritual_caster && Array.isArray(fc.ritual_caster.ritualSpells)) {
      spells.push(...fc.ritual_caster.ritualSpells);
    }
    return { cantrips, spells };
  }, [character.feat_choices, (character as any).featChoices]);

  const knownSpells = useMemo(
    () => {
      let baseSpells: string[];
      // 法术书型准备施法者（如法师）：只能从法术书(selected_spells)中准备法术
      if (isSpellbookCasterUtil(character.class_id)) {
        const spells = (character.selected_spells || character.selectedSpells || []);
        baseSpells = extractSpellIds(spells);
      } else if (isPreparedCaster && character.class_id) {
        // 全列表准备型施法者（牧师/德鲁伊/圣骑士/奇械师）：从完整职业法术列表中获取可用法术
        const maxLevel = maxSpellLevelForClass(character.class_id, character.level || 1);
        baseSpells = spellsAll
          .filter((s) => s.level > 0 && s.level <= maxLevel && s.classes?.includes(character.class_id))
          .map((s) => s.id);
      } else {
        // 已知型施法者：使用 selected_spells
        const spells = (character.selected_spells || character.selectedSpells || []);
        baseSpells = extractSpellIds(spells);
      }
      // Merge racial leveled spells (level > 0)
      const racialLeveled = racialSpellIds.filter((id) => {
        const rs = racialSpellsData.find((r) => r.id === id);
        return rs && rs.level > 0;
      });
      // Merge invocation-granted leveled spells
      const invocationLeveled = invocationSpellIds.filter((id) => {
        const sp = spellsAll.find((s) => s.id === id);
        return sp && ((sp as any).level ?? 0) > 0;
      });
      return Array.from(new Set([...baseSpells, ...racialLeveled, ...invocationLeveled, ...featSpellIds.spells]));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPreparedCaster, character.class_id, character.level, spellsAll, JSON.stringify(character.selected_spells), JSON.stringify(character.selectedSpells), racialSpellIds, racialSpellsData, invocationSpellIds, featSpellIds.spells],
  );

  const cantripsLocal = useMemo(
    () => {
      const cantrips = (character.selected_cantrips || character.selectedCantrips || []);
      const base = extractSpellIds(cantrips);
      // Merge racial cantrips (level === 0)
      const racialCantrips = racialSpellIds.filter((id) => {
        const rs = racialSpellsData.find((r) => r.id === id);
        return rs && rs.level === 0;
      });
      return Array.from(new Set([...base, ...racialCantrips, ...featSpellIds.cantrips]));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(character.selected_cantrips), JSON.stringify(character.selectedCantrips), racialSpellIds, racialSpellsData, featSpellIds.cantrips],
  );

  const [rawPreparedLocal, setRawPreparedLocal] = useState<string[]>(
    (character.prepared_spells as string[]) ||
      (character.preparedSpells as string[]) ||
      [],
  );

  useEffect(() => {
    setRawPreparedLocal(
      ((character.prepared_spells as string[]) ||
        (character.preparedSpells as string[]) ||
        []),
    );
  }, [character.id, character.prepared_spells, character.preparedSpells]);

  // Racial leveled spells are always prepared (not counted against preparedMax)
  const racialLeveledIds = useMemo(
    () => racialSpellsData.filter((rs) => rs.level > 0).map((rs) => rs.id),
    [racialSpellsData],
  );

  // Invocation leveled spells are always prepared (not counted against preparedMax)
  const invocationLeveledIds = useMemo(
    () => invocationSpellsData.filter((is) => {
      const sp = spellsAll.find((s) => s.id === is.spellId);
      return sp && ((sp as any).level ?? 0) > 0;
    }).map((is) => is.spellId),
    [invocationSpellsData, spellsAll],
  );

  // Feat-granted leveled spells are always prepared (not counted against preparedMax)
  const featLeveledIds = useMemo(
    () => featSpellIds.spells,
    [featSpellIds.spells],
  );

  const preparedLocal = useMemo(
    () => {
      if (!isPreparedCaster) {
        // Known casters (ranger, bard, sorcerer, warlock): all known spells are always available
        return Array.from(new Set([...knownSpells, ...autoPrepared, ...racialLeveledIds, ...invocationLeveledIds, ...featLeveledIds]));
      }
      return Array.from(new Set([...rawPreparedLocal, ...autoPrepared, ...racialLeveledIds, ...invocationLeveledIds, ...featLeveledIds]));
    },
    [isPreparedCaster, rawPreparedLocal, knownSpells, autoPrepared, racialLeveledIds, invocationLeveledIds, featLeveledIds],
  );

  const preparedMax = useMemo(
    () => computePreparedMax(character, abilityMods),
    [character, abilityMods],
  );

  const preparedCount = useMemo(() => {
    const autoSet = new Set([...autoPrepared, ...racialLeveledIds, ...invocationLeveledIds, ...featLeveledIds]);
    return preparedLocal
      .filter((id) => !autoSet.has(id))
      .map((id) => (spellsAll as any[]).find((s) => s.id === id))
      .filter((sp) => sp && (((sp as any).level ?? 0) as number) > 0).length;
  }, [preparedLocal, autoPrepared, racialLeveledIds, invocationLeveledIds, featLeveledIds, spellsAll]);

  const togglePreparedSpell = useCallback(
    async (spellId: string) => {
      if (autoPrepared.includes(spellId) || racialLeveledIds.includes(spellId) || invocationLeveledIds.includes(spellId) || featLeveledIds.includes(spellId)) {
        // 领域/誓约/种族/祈唤/专长法术总是准备，UI 点击时忽略切换
        return;
      }

      const has = rawPreparedLocal.includes(spellId);
      const next = has
        ? rawPreparedLocal.filter((id) => id !== spellId)
        : [...rawPreparedLocal, spellId];
      setRawPreparedLocal(next);
      await persistCharacterPartial(undefined, next);
    },
    [rawPreparedLocal, persistCharacterPartial, autoPrepared, racialLeveledIds, invocationLeveledIds, featLeveledIds],
  );

  const togglePreparedWithLimit = useCallback(
    async (spellId: string) => {
      const sp = (spellsAll as any[]).find((s) => s.id === spellId);
      if (!sp || (((sp as any).level ?? 0) as number) === 0) {
        await togglePreparedSpell(spellId);
        return;
      }
      const already = preparedLocal.includes(spellId);
      if (!already && preparedMax > 0 && preparedCount >= preparedMax) {
        alert(`已达准备上限：${preparedCount}/${preparedMax}`);
        return;
      }
      await togglePreparedSpell(spellId);
    },
    [spellsAll, preparedLocal, preparedMax, preparedCount, togglePreparedSpell],
  );

  // 批量设置准备法术（一次性保存，避免竞态条件）
  const setPreparedSpellsAndPersist = useCallback(
    async (newPreparedSpells: string[]) => {
      // 过滤掉自动准备的法术，只保存手动选择的
      const manual = newPreparedSpells.filter((id) => !autoPrepared.includes(id));
      setRawPreparedLocal(manual);
      await persistCharacterPartial(undefined, manual);
    },
    [autoPrepared, persistCharacterPartial],
  );

  return {
    isSpellcaster,
    isPreparedCaster,
    knownSpells,
    cantripsLocal,
    preparedLocal,
    setPreparedLocal: setRawPreparedLocal,
    preparedMax,
    preparedCount,
    togglePreparedSpell,
    togglePreparedWithLimit,
    setPreparedSpellsAndPersist,
    autoPrepared,
    racialSpellIds,
    racialSpellsData,
    invocationSpellIds,
    invocationSpellsData,
    featSpellIds,
  } as const;
}

