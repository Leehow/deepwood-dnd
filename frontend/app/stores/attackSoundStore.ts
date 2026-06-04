/**
 * Attack Sound Effects Store
 * Manages audio playback for physical attacks (slash, pierce, bludgeon, bite, claw, etc.)
 */
import { create } from 'zustand';
import { getAssetUrl } from '~/utils/asset-url';
import attackSoundsConfig from '~/data/attack-sounds.json';

interface AttackSoundState {
  enabled: boolean;
  masterVolume: number;
  audioCache: Map<string, HTMLAudioElement>;

  // Actions
  setEnabled: (enabled: boolean) => void;
  setMasterVolume: (volume: number) => void;
  playAttackSound: (attackName: string, damageType: string, event: 'swing' | 'hit' | 'miss' | 'critical') => void;
  preloadSounds: () => void;
}

// Find which category an attack belongs to based on keywords
function findAttackCategory(attackName: string, damageType: string): string {
  const searchText = `${attackName} ${damageType}`.toLowerCase();

  for (const [categoryId, category] of Object.entries(attackSoundsConfig.categories)) {
    const keywords = (category as any).keywords || [];
    for (const keyword of keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        return categoryId;
      }
    }
  }

  // Default based on damage type
  if (damageType.includes('劈砍') || damageType.includes('slashing')) return 'slashing';
  if (damageType.includes('穿刺') || damageType.includes('piercing')) return 'piercing';
  if (damageType.includes('钝击') || damageType.includes('bludgeoning')) return 'bludgeoning';

  return 'bludgeoning'; // Default fallback
}

// Get sound file for a category and event
function getSoundFile(categoryId: string, event: 'swing' | 'hit' | 'miss' | 'critical'): string | null {
  const category = (attackSoundsConfig.categories as any)[categoryId];
  if (!category?.sounds?.length) return null;

  // sounds[0] = swing/attack sound, sounds[1] = hit sound
  // For miss, use swing sound; for critical, use hit sound
  const soundIndex = (event === 'swing' || event === 'miss') ? 0 : 1;
  return category.sounds[Math.min(soundIndex, category.sounds.length - 1)];
}

export const useAttackSoundStore = create<AttackSoundState>((set, get) => ({
  enabled: attackSoundsConfig.settings.enabled,
  masterVolume: attackSoundsConfig.settings.masterVolume,
  audioCache: new Map(),

  setEnabled: (enabled) => set({ enabled }),

  setMasterVolume: (volume) => set({ masterVolume: Math.max(0, Math.min(1, volume)) }),

  playAttackSound: (attackName, damageType, event) => {
    const state = get();
    if (!state.enabled) return;

    // Find category for this attack
    const categoryId = findAttackCategory(attackName, damageType);
    const soundFile = getSoundFile(categoryId, event);
    if (!soundFile) return;

    // Use getAssetUrl for local/OSS path resolution
    const localPath = `sounds/attacks/${soundFile}`;
    const soundUrl = getAssetUrl(localPath);

    // Check cache first
    let audio = state.audioCache.get(soundUrl);

    if (!audio) {
      audio = new Audio(soundUrl);
      state.audioCache.set(soundUrl, audio);
    }

    // Get event-specific volume
    const eventConfig = (attackSoundsConfig.events as any)[event];
    const eventVolume = eventConfig?.volume || 0.5;

    // Set volume and play
    audio.volume = state.masterVolume * eventVolume;
    audio.currentTime = 0;
    audio.play().catch(err => {
      // Silently fail - user might not have interacted with page yet
      console.debug(`[AttackSound] Failed to play: ${soundUrl}`, err);
    });
  },

  preloadSounds: () => {
    const state = get();

    for (const [categoryId, category] of Object.entries(attackSoundsConfig.categories)) {
      const sounds = (category as any).sounds || [];
      for (const soundFile of sounds) {
        const localPath = `sounds/attacks/${soundFile}`;
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
export function useAttackSound() {
  const { playAttackSound, enabled, masterVolume, setEnabled, setMasterVolume } = useAttackSoundStore();

  return {
    playAttackSound,
    enabled,
    masterVolume,
    setEnabled,
    setMasterVolume,

    // Convenience methods
    playSwing: (attackName: string, damageType: string) => playAttackSound(attackName, damageType, 'swing'),
    playHit: (attackName: string, damageType: string) => playAttackSound(attackName, damageType, 'hit'),
    playMiss: (attackName: string, damageType: string) => playAttackSound(attackName, damageType, 'miss'),
    playCritical: (attackName: string, damageType: string) => playAttackSound(attackName, damageType, 'critical'),
  };
}
