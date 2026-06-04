/**
 * useMonsterEquipment — adapts monster instance data to work with
 * the player's useEquipment + useCurrency hooks, so monsters can
 * reuse BagDialog with full functionality.
 */
import { useCallback, useMemo } from 'react';
import { useEquipment } from '~/components/character/CharacterDisplay/hooks/useEquipment';
import { useCurrency } from '~/components/character/CharacterDisplay/hooks/useCurrency';
import type { EquipmentItem, Currency, Character } from '~/components/character/CharacterDisplay/types/Character';
import { apiFetch } from '~/utils/api-client';
import { createLogger } from '~/utils/logger';

const logger = createLogger('useMonsterEquipment');

/** Map a monster instance to a minimal Character shape for the equipment hooks. */
function monsterAsCharacter(mi: any): Character {
  return {
    id: mi.id,
    user_id: '',
    name: mi.name_cn || mi.name,
    race_id: '',
    class_id: '',
    level: 1,
    equipment: mi.equipment || [],
    currency: mi.currency || { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    ability_scores: mi.ability_scores || {},
  } as unknown as Character;
}

export function useMonsterEquipment(
  monsterInstance: any,
  campaignId: string,
  currentUserId?: string,
  onDataUpdated?: (updated: any) => void,
) {
  const char = useMemo(() => monsterAsCharacter(monsterInstance), [monsterInstance?.id, monsterInstance?.equipment, monsterInstance?.currency]);

  const persistCharacterPartial = useCallback(async (
    nextEquipment?: EquipmentItem[],
    _nextPreparedSpells?: string[],
    nextCurrency?: Currency,
  ) => {
    const payload: any = {};
    if (nextEquipment !== undefined) payload.equipment = nextEquipment;
    if (nextCurrency !== undefined) payload.currency = nextCurrency;
    if (Object.keys(payload).length === 0) return false;
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
        return true;
      }
      return false;
    } catch (e) {
      logger.error('Failed to persist monster equipment:', e);
      return false;
    }
  }, [monsterInstance.id, currentUserId, onDataUpdated]);

  const showToast = useCallback((msg: string) => {
    logger.info('[toast]', msg);
  }, []);

  const equipment = useEquipment({
    character: char,
    campaignId,
    currentMapUrl: null,
    persistCharacterPartial,
    showToast,
  });

  const currency = useCurrency({ character: char, persistCharacterPartial });

  return { equipment, currency, persistCharacterPartial };
}
