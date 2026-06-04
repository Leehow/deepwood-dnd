import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '~/utils/api-client';
import type { HotbarSlot } from '~/components/character/CharacterDisplay/types/Character';

const MAX_SLOTS = 12;
const SAVE_DEBOUNCE_MS = 800;

export function useHotbar(
  characterId: number | null,
  initialHotbar: (HotbarSlot | null)[] | null | undefined,
) {
  const [slots, setSlots] = useState<(HotbarSlot | null)[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  const slotCount = MAX_SLOTS;

  // Load hotbar when character changes
  useEffect(() => {
    if (!characterId) {
      setSlots([]);
      return;
    }
    const data = initialHotbar || [];
    const padded = Array.from({ length: slotCount }, (_, i) => data[i] ?? null);
    setSlots(padded);
  }, [characterId, initialHotbar, slotCount]);

  // Debounced save to backend
  const persistSlots = useCallback((newSlots: (HotbarSlot | null)[]) => {
    if (!characterId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await apiFetch(`/api/characters/${characterId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hotbar: newSlots }),
        });
      } catch (e) {
        console.error('Failed to save hotbar:', e);
      }
    }, SAVE_DEBOUNCE_MS);
  }, [characterId]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const setSlot = useCallback((index: number, item: HotbarSlot | null) => {
    setSlots(prev => {
      const next = [...prev];
      next[index] = item;
      persistSlots(next);
      return next;
    });
  }, [persistSlots]);

  const clearSlot = useCallback((index: number) => {
    setSlot(index, null);
  }, [setSlot]);

  return { slots, slotCount, setSlot, clearSlot };
}
