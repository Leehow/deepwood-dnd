/**
 * Spell Sound Effects Store
 * Manages audio playback for spell casting, hits, and effects
 */
import { create } from 'zustand';
import { getAssetUrl } from '~/utils/asset-url';
import spellSoundsConfig from '~/data/spell-sounds.json';

interface SpellSoundState {
  enabled: boolean;
  masterVolume: number;
  audioCache: Map<string, HTMLAudioElement>;

  // Actions
  setEnabled: (enabled: boolean) => void;
  setMasterVolume: (volume: number) => void;
  playSpellSound: (spellId: string, event: 'cast' | 'hit' | 'effect' | 'fail', damageType?: string) => void;
  preloadSounds: (spellIds: string[]) => void;
}

// Damage type (English) → category mapping for fallback
const DAMAGE_TYPE_CATEGORY: Record<string, string> = {
  fire: 'damage_fire',
  cold: 'damage_cold',
  lightning: 'damage_lightning',
  thunder: 'damage_thunder',
  acid: 'damage_acid',
  poison: 'damage_poison',
  necrotic: 'damage_necrotic',
  radiant: 'damage_radiant',
  force: 'damage_force',
  psychic: 'damage_psychic',
};

// Chinese damage type → English mapping
const DAMAGE_TYPE_CN_MAP: Record<string, string> = {
  '火焰': 'fire', '冰冷': 'cold', '闪电': 'lightning', '雷鸣': 'thunder',
  '强酸': 'acid', '毒素': 'poison', '黯蚀': 'necrotic', '光耀': 'radiant',
  '力场': 'force', '心灵': 'psychic',
};

// Find which category a spell belongs to
function findSpellCategory(spellId: string): string | null {
  for (const [categoryId, category] of Object.entries(spellSoundsConfig.categories)) {
    if ((category as any).spells?.includes(spellId)) {
      return categoryId;
    }
  }
  return null;
}

/** Resolve category: spell ID match → damage type fallback → utility */
function resolveCategory(spellId: string, damageType?: string): string {
  const byId = findSpellCategory(spellId);
  if (byId) return byId;

  if (damageType) {
    // Normalize: accept both English and Chinese damage types
    const normalized = DAMAGE_TYPE_CN_MAP[damageType] || damageType.toLowerCase();
    const cat = DAMAGE_TYPE_CATEGORY[normalized];
    if (cat) return cat;
  }

  return 'utility';
}

// Get sound file for a category and event
function getSoundFile(categoryId: string, event: 'cast' | 'hit' | 'effect' | 'fail'): string | null {
  const category = (spellSoundsConfig.categories as any)[categoryId];
  if (!category?.sounds?.length) return null;

  // Map event to sound index
  // sounds[0] = cast sound, sounds[1] = hit/effect sound
  const soundIndex = event === 'cast' ? 0 : 1;
  return category.sounds[Math.min(soundIndex, category.sounds.length - 1)];
}

export const useSpellSoundStore = create<SpellSoundState>((set, get) => ({
  enabled: spellSoundsConfig.settings.enabled,
  masterVolume: spellSoundsConfig.settings.masterVolume,
  audioCache: new Map(),

  setEnabled: (enabled) => set({ enabled }),

  setMasterVolume: (volume) => set({ masterVolume: Math.max(0, Math.min(1, volume)) }),

  playSpellSound: (spellId, event, damageType?) => {
    const state = get();
    if (!state.enabled) return;

    const categoryId = resolveCategory(spellId, damageType);

    const soundFile = getSoundFile(categoryId, event);
    if (!soundFile) return;

    // Use getAssetUrl for local/OSS path resolution
    const localPath = `sounds/spells/${soundFile}`;
    const soundUrl = getAssetUrl(localPath);

    // Check cache first
    let audio = state.audioCache.get(soundUrl);

    if (!audio) {
      audio = new Audio(soundUrl);
      state.audioCache.set(soundUrl, audio);
    }

    // Get event-specific volume
    const eventConfig = (spellSoundsConfig.events as any)[event];
    const eventVolume = eventConfig?.volume || 0.5;

    // Set volume and play
    audio.volume = state.masterVolume * eventVolume;
    audio.currentTime = 0;
    audio.play().catch(err => {
      // Silently fail - user might not have interacted with page yet
      console.debug(`[SpellSound] Failed to play: ${soundUrl}`, err);
    });
  },

  preloadSounds: (spellIds) => {
    const state = get();

    for (const spellId of spellIds) {
      const categoryId = findSpellCategory(spellId);
      if (!categoryId) continue;

      const category = (spellSoundsConfig.categories as any)[categoryId];
      if (!category?.sounds) continue;

      for (const soundFile of category.sounds) {
        const localPath = `sounds/spells/${soundFile}`;
        const soundUrl = getAssetUrl(localPath);

        if (!state.audioCache.has(soundUrl)) {
          const audio = new Audio();
          audio.preload = 'auto';
          audio.src = soundUrl;
          state.audioCache.set(soundUrl, audio);
        }
      }
    }
  }
}));

// Helper hook for components
export function useSpellSound() {
  const { playSpellSound, enabled, masterVolume, setEnabled, setMasterVolume } = useSpellSoundStore();

  return {
    playSpellSound,
    enabled,
    masterVolume,
    setEnabled,
    setMasterVolume,

    // Convenience methods — pass optional damageType for fallback matching
    playCast: (spellId: string, damageType?: string) => playSpellSound(spellId, 'cast', damageType),
    playHit: (spellId: string, damageType?: string) => playSpellSound(spellId, 'hit', damageType),
    playEffect: (spellId: string, damageType?: string) => playSpellSound(spellId, 'effect', damageType),
    playFail: (spellId: string, damageType?: string) => playSpellSound(spellId, 'fail', damageType),
  };
}
