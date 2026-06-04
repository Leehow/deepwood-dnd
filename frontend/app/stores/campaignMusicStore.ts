import { create } from 'zustand';
import { getAssetUrl } from '~/utils/asset-url';

// 曲目列表
export interface MusicTrack {
  path: string;
  name: string;
}

export const MUSIC_TRACKS: MusicTrack[] = [
  { path: "music/Dragon's End.mp3", name: "Dragon's End" },
  { path: "music/Dragon's Breath-2.mp3", name: "Dragon's Breath" },
  { path: "music/fastsoloist240 - Dragon's Fury.mp3", name: "Dragon's Fury" },
  { path: "music/fastsoloist240 - Dragon's Fury (1).mp3", name: "Dragon's Fury II" },
];

const AUDIO_KEY = '__dw_campaignMusic';
const DEFAULT_VOLUME = 0.3;

function getAudioInstance(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as Record<string, HTMLAudioElement | undefined>)[AUDIO_KEY] || null;
}

function setAudioInstance(audio: HTMLAudioElement | null) {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, HTMLAudioElement | null>)[AUDIO_KEY] = audio;
}

export type BroadcastMode = 'local' | 'broadcast';

interface CampaignMusicState {
  currentTrackIndex: number | null;
  isPlaying: boolean;
  volume: number;
  broadcastMode: BroadcastMode;
  // 玩家端本地静音
  localMuted: boolean;

  play: (trackIndex: number) => void;
  pause: () => void;
  resume: () => void;
  setVolume: (volume: number) => void;
  setBroadcastMode: (mode: BroadcastMode) => void;
  setLocalMuted: (muted: boolean) => void;
  // 远程控制（收到 WebSocket 消息后调用）
  handleRemotePlay: (trackIndex: number, volume: number) => void;
  handleRemotePause: () => void;
  handleRemoteVolume: (volume: number) => void;
  cleanup: () => void;
}

export const useCampaignMusicStore = create<CampaignMusicState>((set, get) => ({
  currentTrackIndex: null,
  isPlaying: false,
  volume: DEFAULT_VOLUME,
  broadcastMode: 'local',
  localMuted: false,

  play: (trackIndex: number) => {
    const track = MUSIC_TRACKS[trackIndex];
    if (!track) return;

    let audio = getAudioInstance();
    if (audio) {
      audio.pause();
      audio.src = '';
    }

    const url = getAssetUrl(track.path);
    audio = new Audio(url);
    audio.loop = true;
    audio.volume = get().volume;
    setAudioInstance(audio);

    audio.play().then(() => {
      set({ currentTrackIndex: trackIndex, isPlaying: true });
    }).catch(() => {
      set({ currentTrackIndex: trackIndex, isPlaying: false });
    });
  },

  pause: () => {
    const audio = getAudioInstance();
    if (audio) {
      audio.pause();
      set({ isPlaying: false });
    }
  },

  resume: () => {
    const audio = getAudioInstance();
    if (audio) {
      audio.play().then(() => {
        set({ isPlaying: true });
      }).catch(() => {});
    }
  },

  setVolume: (volume: number) => {
    const audio = getAudioInstance();
    if (audio) {
      audio.volume = volume;
    }
    set({ volume });
  },

  setBroadcastMode: (mode: BroadcastMode) => {
    set({ broadcastMode: mode });
  },

  setLocalMuted: (muted: boolean) => {
    const audio = getAudioInstance();
    if (audio) {
      audio.muted = muted;
    }
    set({ localMuted: muted });
  },

  handleRemotePlay: (trackIndex: number, volume: number) => {
    const track = MUSIC_TRACKS[trackIndex];
    if (!track) return;

    let audio = getAudioInstance();
    if (audio) {
      audio.pause();
      audio.src = '';
    }

    const { localMuted } = get();
    const url = getAssetUrl(track.path);
    audio = new Audio(url);
    audio.loop = true;
    audio.volume = volume;
    audio.muted = localMuted;
    setAudioInstance(audio);

    audio.play().then(() => {
      set({ currentTrackIndex: trackIndex, isPlaying: true, volume });
    }).catch(() => {
      set({ currentTrackIndex: trackIndex, isPlaying: false, volume });
    });
  },

  handleRemotePause: () => {
    const audio = getAudioInstance();
    if (audio) {
      audio.pause();
      set({ isPlaying: false });
    }
  },

  handleRemoteVolume: (volume: number) => {
    const audio = getAudioInstance();
    if (audio) {
      audio.volume = volume;
      if (get().localMuted) audio.muted = true;
    }
    set({ volume });
  },

  cleanup: () => {
    const audio = getAudioInstance();
    if (audio) {
      audio.pause();
      audio.src = '';
      setAudioInstance(null);
    }
    set({ currentTrackIndex: null, isPlaying: false, localMuted: false });
  },
}));
