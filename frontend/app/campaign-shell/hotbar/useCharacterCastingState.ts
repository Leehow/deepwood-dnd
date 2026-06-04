import { useEffect, type Dispatch, type SetStateAction } from "react";
import { subscribeAppEvent } from "~/events/appEventBus";
import { findCharacterToken } from "~/utils/sidebarCasting";

function sameCharacterId(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
) {
  return left != null && right != null && String(left) === String(right);
}

interface UseCharacterCastingStateOptions {
  characterId?: number | null;
  campaignId?: string | null;
  currentMapUrl?: string | null;
  userId?: string;
  setConcentrationSpellName: Dispatch<SetStateAction<string | null>>;
  setCastingSpellName: Dispatch<SetStateAction<string | null>>;
  setConcentrationSpellId?: Dispatch<SetStateAction<string | null>>;
}

export function useCharacterCastingState({
  characterId,
  campaignId,
  currentMapUrl,
  userId,
  setConcentrationSpellName,
  setCastingSpellName,
  setConcentrationSpellId,
}: UseCharacterCastingStateOptions): void {
  useEffect(() => {
    if (!characterId || !campaignId || !currentMapUrl || !userId) {
      setConcentrationSpellName(null);
      setCastingSpellName(null);
      setConcentrationSpellId?.(null);
      return;
    }

    let cancelled = false;

    findCharacterToken(characterId, campaignId, currentMapUrl, userId)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setConcentrationSpellId?.(result?.data?.concentration_spell?.spell_id || null);
        setConcentrationSpellName(result?.data?.concentration_spell?.spell_name || null);
        setCastingSpellName(result?.data?.casting_in_progress?.spell_name || null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setConcentrationSpellId?.(null);
        setConcentrationSpellName(null);
        setCastingSpellName(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    campaignId,
    characterId,
    currentMapUrl,
    setCastingSpellName,
    setConcentrationSpellId,
    setConcentrationSpellName,
    userId,
  ]);

  useEffect(() => {
    return subscribeAppEvent("characterConcentrationChanged", (detail) => {
      if (!sameCharacterId(detail.characterId, characterId)) {
        return;
      }
      setConcentrationSpellId?.((detail.concentrationSpell as any)?.spell_id || null);
      setConcentrationSpellName((detail.concentrationSpell as any)?.spell_name || null);
    });
  }, [characterId, setConcentrationSpellId, setConcentrationSpellName]);

  useEffect(() => {
    return subscribeAppEvent("characterCastingChanged", (detail) => {
      if (!sameCharacterId(detail.characterId, characterId)) {
        return;
      }
      setCastingSpellName((detail.castingInProgress as any)?.spell_name || null);
    });
  }, [characterId, setCastingSpellName]);
}
