import { describe, expect, it, vi } from 'vitest';
import type { Token } from '../../app/components/map/types/TacticalMapTypes';
import {
  loadCharactersInParallel,
  persistDefaultTokenHpInBackground,
} from '../../app/components/map/hooks/useMapData';

describe('useMapData helpers', () => {
  it('loads character details in parallel', async () => {
    const started: number[] = [];
    const resolvers = new Map<number, (value: { id: number }) => void>();

    const fetchCharacter = vi.fn((characterId: number) => {
      started.push(characterId);
      return new Promise<{ id: number }>((resolve) => {
        resolvers.set(characterId, resolve);
      });
    });

    const loadPromise = loadCharactersInParallel([101, 102, 103], fetchCharacter);

    expect(started).toEqual([101, 102, 103]);
    expect(fetchCharacter).toHaveBeenCalledTimes(3);

    resolvers.get(102)?.({ id: 102 });
    resolvers.get(101)?.({ id: 101 });
    resolvers.get(103)?.({ id: 103 });

    const characterMap = await loadPromise;
    expect(Array.from(characterMap.keys())).toEqual([101, 102, 103]);
  });

  it('persists default token hp in parallel and only for targeted tokens', async () => {
    const started: number[] = [];
    const resolvers = new Map<number, () => void>();
    const tokens = [
      { id: 1, current_hp: 12 } as Token,
      { id: 2, current_hp: 8 } as Token,
      { id: 3, current_hp: 5 } as Token,
    ];

    const persistTokenHp = vi.fn((token: Token) => {
      started.push(token.id);
      return new Promise<void>((resolve) => {
        resolvers.set(token.id, resolve);
      });
    });

    const persistPromise = persistDefaultTokenHpInBackground(
      tokens,
      new Set([1, 3]),
      persistTokenHp,
    );

    expect(started).toEqual([1, 3]);
    expect(persistTokenHp).toHaveBeenCalledTimes(2);

    resolvers.get(3)?.();
    resolvers.get(1)?.();

    await persistPromise;
  });
});