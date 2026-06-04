import { create } from 'zustand';
import { getAssetUrl } from '~/utils/asset-url';
import { getAuthUser } from '~/utils/auth';
import { API_BASE_URL } from '~/config/api';

// Music track paths - URLs will be resolved at runtime to avoid SSR issues
const MUSIC_TRACK_PATHS = [
  "music/Dragon's End.mp3",
  "music/Dragon's Breath-2.mp3",
];

const TARGET_VOLUME = 0.25;
const AUDIO_KEY = '__dw_bgMusic';
const PREF_KEY = 'musicEnabled';

// 使用 window 对象存储 audio，避免 HMR 导致引用丢失
function getAudioInstance(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as Record<string, HTMLAudioElement | undefined>)[AUDIO_KEY] || null;
}

function setAudioInstance(audio: HTMLAudioElement | null) {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, HTMLAudioElement | null>)[AUDIO_KEY] = audio;
}

interface MusicState {
  isPlaying: boolean;
  isLoaded: boolean;
  preferenceLoaded: boolean;
  initialize: () => void;
  toggle: () => void;
  cleanup: () => void;
}

// Get music preference from API (only for logged-in users)
async function getMusicPreference(): Promise<boolean | null> {
  const user = getAuthUser();
  if (!user) return null; // Not logged in, no preference

  try {
    const response = await fetch(`${API_BASE_URL}/api/users/${user.id}/preferences`);
    if (response.ok) {
      const prefs = await response.json();
      if (PREF_KEY in prefs) {
        return prefs[PREF_KEY];
      }
    }
  } catch {
    // API error, treat as no preference
  }

  return null;
}

// Save music preference to API (only for logged-in users)
function saveMusicPreference(enabled: boolean): void {
  const user = getAuthUser();
  if (!user) return; // Not logged in, can't save

  fetch(`${API_BASE_URL}/api/users/${user.id}/preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences: { [PREF_KEY]: enabled } }),
  }).catch(() => {
    // Silently fail
  });
}

function createAndPlayAudio(set: (state: Partial<MusicState>) => void): void {
  const randomPath = MUSIC_TRACK_PATHS[Math.floor(Math.random() * MUSIC_TRACK_PATHS.length)];
  const randomTrack = getAssetUrl(randomPath);
  const audio = new Audio(randomTrack);
  audio.loop = true;
  audio.volume = TARGET_VOLUME;
  setAudioInstance(audio);

  audio.addEventListener('canplaythrough', () => {
    set({ isLoaded: true });
    audio.play().then(() => {
      set({ isPlaying: true });
    }).catch(() => {
      // Autoplay blocked by browser
    });
  }, { once: true });

  audio.addEventListener('error', () => {
    set({ isLoaded: true });
  }, { once: true });
}

export const useMusicStore = create<MusicState>((set, get) => ({
  isPlaying: false,
  isLoaded: false,
  preferenceLoaded: false,

  initialize: () => {
    if (typeof window === 'undefined') return;

    // 检查是否已有实例在播放
    const existing = getAudioInstance();
    if (existing) {
      set({ isLoaded: true, isPlaying: !existing.paused, preferenceLoaded: true });
      return;
    }

    // Load preference from API and decide whether to auto-play
    getMusicPreference().then((preference) => {
      set({ preferenceLoaded: true });

      // Only skip auto-play if user explicitly set preference to false
      if (preference === false) {
        set({ isLoaded: true, isPlaying: false });
        return;
      }

      // Auto-play (preference is true or null/unset)
      createAndPlayAudio(set);
    });
  },

  toggle: () => {
    const { isPlaying, isLoaded } = get();
    let audio = getAudioInstance();

    // If user tries to play but audio not created (was disabled on load)
    if (!audio && !isPlaying && isLoaded) {
      const randomPath = MUSIC_TRACK_PATHS[Math.floor(Math.random() * MUSIC_TRACK_PATHS.length)];
      const randomTrack = getAssetUrl(randomPath);
      audio = new Audio(randomTrack);
      audio.loop = true;
      audio.volume = TARGET_VOLUME;
      setAudioInstance(audio);

      audio.play().then(() => {
        set({ isPlaying: true });
        saveMusicPreference(true);
      }).catch(() => {});
      return;
    }

    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      set({ isPlaying: false });
      saveMusicPreference(false);
    } else {
      audio.volume = TARGET_VOLUME;
      audio.play().then(() => {
        set({ isPlaying: true });
        saveMusicPreference(true);
      }).catch(() => {});
    }
  },

  cleanup: () => {
    const audio = getAudioInstance();
    if (audio) {
      audio.pause();
      audio.src = '';
      setAudioInstance(null);
      set({ isPlaying: false, isLoaded: false, preferenceLoaded: false });
    }
  },
}));
