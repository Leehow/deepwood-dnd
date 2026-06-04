import { useState, useRef, useEffect, useCallback } from 'react';
import { getApiEndpoint } from '~/config/api';
import { createLogger } from '~/utils/logger';
import { useVoiceStore } from '~/stores/voiceStore';

const logger = createLogger('useTTS');

// Module-level cache: survives re-renders, shared across hook instances
const ttsCache = new Map<string, { audio: string; format: string }>();
const BROADCAST_DEDUPE_WINDOW_MS = 2000;
const pendingLocalBroadcastKeys = new Map<string, number>();
const recentBroadcastPlaybackKeys = new Map<string, number>();
let activeBroadcastAudio: HTMLAudioElement | null = null;
let activeBroadcastKey: string | null = null;

function pruneBroadcastState(now = Date.now()) {
  for (const [key, expiresAt] of pendingLocalBroadcastKeys) {
    if (expiresAt <= now) pendingLocalBroadcastKeys.delete(key);
  }
  for (const [key, expiresAt] of recentBroadcastPlaybackKeys) {
    if (expiresAt <= now) recentBroadcastPlaybackKeys.delete(key);
  }
}

function buildBroadcastPlaybackKey(
  campaignId?: string,
  broadcastId?: string,
  messageId?: number,
  audioUrl?: string,
) {
  if (campaignId && broadcastId) return `${campaignId}:broadcast:${broadcastId}`;
  if (campaignId && messageId) return `${campaignId}:message:${messageId}`;
  if (messageId) return `message:${messageId}`;
  if (campaignId && audioUrl) return `${campaignId}:audio:${audioUrl}`;
  if (audioUrl) return `audio:${audioUrl}`;
  return null;
}

function rememberPendingLocalBroadcast(playbackKey: string) {
  pruneBroadcastState();
  pendingLocalBroadcastKeys.set(playbackKey, Date.now() + BROADCAST_DEDUPE_WINDOW_MS);
}

function consumePendingLocalBroadcast(playbackKey: string) {
  pruneBroadcastState();
  const expiresAt = pendingLocalBroadcastKeys.get(playbackKey);
  if (!expiresAt) return false;
  pendingLocalBroadcastKeys.delete(playbackKey);
  return expiresAt > Date.now();
}

function shouldPlayBroadcastPlayback(playbackKey: string) {
  pruneBroadcastState();
  if (recentBroadcastPlaybackKeys.has(playbackKey)) return false;
  recentBroadcastPlaybackKeys.set(playbackKey, Date.now() + BROADCAST_DEDUPE_WINDOW_MS);
  return true;
}

function clearActiveBroadcastAudio(audio?: HTMLAudioElement | null) {
  if (!audio) return;
  audio.onended = null;
  audio.onerror = null;
  if (activeBroadcastAudio === audio) {
    activeBroadcastAudio = null;
    activeBroadcastKey = null;
  }
}

function playBroadcastAudio(playbackKey: string, audioUrl: string) {
  if (activeBroadcastAudio && activeBroadcastKey === playbackKey && !activeBroadcastAudio.paused) {
    return;
  }

  if (activeBroadcastAudio) {
    activeBroadcastAudio.pause();
    clearActiveBroadcastAudio(activeBroadcastAudio);
  }

  const audio = new Audio(audioUrl);
  activeBroadcastAudio = audio;
  activeBroadcastKey = playbackKey;
  audio.onended = () => clearActiveBroadcastAudio(audio);
  audio.onerror = () => clearActiveBroadcastAudio(audio);
  audio.play().catch(() => clearActiveBroadcastAudio(audio));
}

function createBroadcastId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function __resetTTSStateForTests() {
  ttsCache.clear();
  pendingLocalBroadcastKeys.clear();
  recentBroadcastPlaybackKeys.clear();
  if (activeBroadcastAudio) {
    activeBroadcastAudio.pause();
    clearActiveBroadcastAudio(activeBroadcastAudio);
  }
}

/** Parse SSE stream, yielding parsed JSON objects for each `data:` line. */
async function* parseSSE(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          yield JSON.parse(line.slice(6));
        } catch { /* skip malformed */ }
      }
    }
  }
}

/**
 * Play PCM chunks via Web Audio API as they arrive.
 * Returns an object to control/stop playback.
 */
function createStreamPlayer(sampleRate: number) {
  const ctx = new AudioContext({ sampleRate });
  let nextTime = 0;
  let stopped = false;
  const sources: AudioBufferSourceNode[] = [];
  let lastSource: AudioBufferSourceNode | null = null;
  let onEndCallback: (() => void) | null = null;

  return {
    /** Enqueue a PCM Int16 chunk for playback */
    enqueue(pcmBytes: Uint8Array) {
      if (stopped) return;
      const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
      const numSamples = pcmBytes.byteLength / 2;
      const float32 = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        float32[i] = view.getInt16(i * 2, true) / 32768;
      }

      const audioBuffer = ctx.createBuffer(1, numSamples, sampleRate);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      sources.push(source);
      lastSource = source;

      const now = ctx.currentTime;
      if (nextTime < now) nextTime = now;
      source.start(nextTime);
      nextTime += audioBuffer.duration;
    },

    /** Mark stream finished — attach onended to the last enqueued source */
    markFinished(cb: () => void) {
      if (stopped) { cb(); return; }
      onEndCallback = cb;
      if (lastSource) {
        lastSource.onended = () => { if (!stopped) cb(); };
      } else {
        cb();
      }
    },

    /** Stop playback and release resources */
    stop() {
      stopped = true;
      onEndCallback = null;
      for (const s of sources) {
        try { s.stop(); } catch { /* already stopped */ }
      }
      sources.length = 0;
      ctx.close().catch(() => {});
    },

    get isStopped() { return stopped; },
  };
}

export function useTTS(campaignId?: string, sendMessage?: (msg: { type: string; data: Record<string, unknown> }) => void) {
  const [ttsPlayingId, setTtsPlayingId] = useState<string | null>(null);
  const [ttsLoading, setTtsLoading] = useState<string | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamPlayerRef = useRef<ReturnType<typeof createStreamPlayer> | null>(null);

  const playAudio = useCallback((msgId: string, audioSrc: string) => {
    const audio = new Audio(audioSrc);
    audio.onended = () => { setTtsPlayingId(null); ttsAudioRef.current = null; };
    audio.onerror = () => { setTtsPlayingId(null); ttsAudioRef.current = null; };
    ttsAudioRef.current = audio;
    setTtsPlayingId(msgId);
    audio.play().catch(() => { setTtsPlayingId(null); ttsAudioRef.current = null; });
  }, []);

  /** Strip markdown formatting for TTS */
  const cleanForTTS = useCallback((text: string) => {
    return text
      .replace(/:::\w*\s*/g, '')
      .replace(/^[\s]*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*{1,3}(.*?)\*{1,3}/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^>\s*/gm, '')
      .replace(/[#`~>|[\]()!]/g, '')
      .replace(/\n+/g, '。')
      .replace(/。{2,}/g, '。')
      .trim();
  }, []);

  /** Call synthesize API (non-streaming) */
  const synthesize = useCallback(async (
    text: string, dbId?: number, forceRegenerate = false,
  ): Promise<{ audioSrc: string; audioUrl?: string; format: string }> => {
    const body: Record<string, unknown> = { text };
    if (dbId) body.message_id = dbId;
    if (dbId && campaignId) body.campaign_id = Number(campaignId);
    if (forceRegenerate) body.force_regenerate = true;

    const res = await fetch(getApiEndpoint('/api/voice/synthesize'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('TTS failed');
    const data = await res.json();

    if (data.audio_url) {
      return { audioSrc: data.audio_url, audioUrl: data.audio_url, format: data.format || 'wav' };
    } else if (data.audio_base64) {
      const fmt = data.format || 'mp3';
      return { audioSrc: `data:audio/${fmt};base64,${data.audio_base64}`, format: fmt };
    }
    throw new Error('No audio data');
  }, [campaignId]);

  /** Stream TTS via SSE + Web Audio API. Returns true if streaming was used. */
  const synthesizeStream = useCallback(async (
    msgId: string, text: string,
  ): Promise<boolean> => {
    const res = await fetch(getApiEndpoint('/api/voice/synthesize-stream'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok || !res.body) return false;

    let player: ReturnType<typeof createStreamPlayer> | null = null;
    let usedStreaming = false;

    for await (const event of parseSSE(res)) {
      if (event.type === 'start') {
        // WebSocket streaming mode — create player
        player = createStreamPlayer(event.sample_rate || 24000);
        streamPlayerRef.current = player;
        setTtsPlayingId(msgId);
        usedStreaming = true;
      } else if (event.type === 'audio' && player) {
        // Decode base64 PCM chunk and enqueue
        const raw = atob(event.data);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        player.enqueue(bytes);
      } else if (event.type === 'audio_url') {
        // REST model fallback: got a complete audio URL
        playAudio(msgId, event.url);
        return true;
      } else if (event.type === 'audio_complete') {
        // REST model fallback: got complete base64 audio
        const fmt = event.format || 'mp3';
        playAudio(msgId, `data:audio/${fmt};base64,${event.audio}`);
        return true;
      } else if (event.type === 'error') {
        logger.error('Stream TTS error:', event.message);
        player?.stop();
        return false;
      } else if (event.type === 'done' && player) {
        // Use onended event on last audio node for reliable cleanup
        player.markFinished(() => {
          setTtsPlayingId(null);
          streamPlayerRef.current = null;
        });
      }
    }

    return usedStreaming;
  }, [playAudio]);

  /** Stop current playback (both regular and streaming) */
  const stopPlayback = useCallback(() => {
    ttsAudioRef.current?.pause();
    ttsAudioRef.current = null;
    streamPlayerRef.current?.stop();
    streamPlayerRef.current = null;
    setTtsPlayingId(null);
  }, []);

  /** Local playback: cache → stream → fallback to regular */
  const handleTTS = useCallback(async (msgId: string, text: string, dbId?: number) => {
    if (ttsPlayingId === msgId) { stopPlayback(); return; }
    if (ttsAudioRef.current || streamPlayerRef.current) stopPlayback();

    const cleanText = cleanForTTS(text);
    if (!cleanText) return;

    // Check cache first
    const cacheKey = dbId ? `db_${dbId}` : msgId;
    const cached = ttsCache.get(cacheKey);
    if (cached) {
      const src = cached.audio.startsWith('http')
        ? cached.audio
        : `data:audio/${cached.format || 'mp3'};base64,${cached.audio}`;
      playAudio(msgId, src);
      return;
    }

    setTtsLoading(msgId);
    try {
      // Try streaming first
      const streamed = await synthesizeStream(msgId, cleanText);
      if (streamed) return;

      // Fallback to regular synthesis
      const result = await synthesize(cleanText, dbId);
      ttsCache.set(cacheKey, {
        audio: result.audioUrl || result.audioSrc,
        format: result.format,
      });
      playAudio(msgId, result.audioSrc);
    } catch (e) {
      logger.error('TTS error', e);
      setTtsPlayingId(null);
    } finally {
      setTtsLoading(null);
    }
  }, [ttsPlayingId, stopPlayback, cleanForTTS, synthesizeStream, synthesize, playAudio]);

  /** Force re-synthesize (clear cache, call API with force_regenerate) */
  const handleTTSRegenerate = useCallback(async (msgId: string, text: string, dbId?: number) => {
    if (ttsAudioRef.current || streamPlayerRef.current) stopPlayback();

    const cleanText = cleanForTTS(text);
    if (!cleanText) return;

    const cacheKey = dbId ? `db_${dbId}` : msgId;
    ttsCache.delete(cacheKey);

    setTtsLoading(msgId);
    try {
      const result = await synthesize(cleanText, dbId, true);
      ttsCache.set(cacheKey, {
        audio: result.audioUrl || result.audioSrc,
        format: result.format,
      });
      playAudio(msgId, result.audioSrc);
    } catch (e) {
      logger.error('TTS regenerate error', e);
      setTtsPlayingId(null);
    } finally {
      setTtsLoading(null);
    }
  }, [stopPlayback, cleanForTTS, synthesize, playAudio]);

  /** Synthesize + local play + broadcast audio_url to campaign via WS */
  const handleTTSBroadcast = useCallback(async (msgId: string, text: string, dbId?: number) => {
    if (ttsAudioRef.current || streamPlayerRef.current) stopPlayback();

    const cleanText = cleanForTTS(text);
    if (!cleanText) return;

    setTtsLoading(msgId);
    try {
      const cacheKey = dbId ? `db_${dbId}` : msgId;
      const cached = ttsCache.get(cacheKey);
      let audioSrc: string;
      let audioUrl: string | undefined;
      let format: string;

      if (cached && cached.audio.startsWith('http')) {
        audioSrc = cached.audio;
        audioUrl = cached.audio;
        format = cached.format;
      } else {
        // Broadcast needs a URL, so use regular (non-streaming) synthesis
        const result = await synthesize(cleanText, dbId);
        ttsCache.set(cacheKey, {
          audio: result.audioUrl || result.audioSrc,
          format: result.format,
        });
        audioSrc = result.audioSrc;
        audioUrl = result.audioUrl;
        format = result.format;
      }

      playAudio(msgId, audioSrc);

      if (audioUrl && sendMessage) {
        const broadcastId = createBroadcastId();
        const playbackKey = buildBroadcastPlaybackKey(campaignId, broadcastId, dbId, audioUrl);
        if (playbackKey) {
          rememberPendingLocalBroadcast(playbackKey);
        }
        sendMessage({
          type: 'tts_broadcast',
          data: { message_id: dbId, audio_url: audioUrl, format, broadcast_id: broadcastId },
        });
      }
    } catch (e) {
      logger.error('TTS broadcast error', e);
      setTtsPlayingId(null);
    } finally {
      setTtsLoading(null);
    }
  }, [stopPlayback, cleanForTTS, synthesize, playAudio, sendMessage]);

  const handleTTSWebSocketMessage = useCallback((type: string, data: Record<string, unknown>) => {
    const messageId = data.message_id as number | undefined;
    const cacheKey = messageId ? `db_${messageId}` : null;

    if (type === 'tts_generating') {
      if (!messageId) return;
      setTtsLoading((prev) => prev ?? `ws_${messageId}`);
    } else if (type === 'tts_ready') {
      if (!messageId || !cacheKey) return;
      const audioBase64 = data.audio_base64 as string | undefined;
      const audioUrl = data.audio_url as string | undefined;
      const format = (data.format as string) || 'wav';

      if (audioBase64) {
        ttsCache.set(cacheKey, { audio: audioBase64, format });
      } else if (audioUrl) {
        ttsCache.set(cacheKey, { audio: audioUrl, format });
      }
      setTtsLoading((prev) => prev === `ws_${messageId}` ? null : prev);
    } else if (type === 'tts_broadcast') {
      const voiceConnected = useVoiceStore.getState().isConnected;
      if (!voiceConnected) return;
      const audioUrl = data.audio_url as string | undefined;
      const broadcastId = data.broadcast_id as string | undefined;
      const playbackKey = buildBroadcastPlaybackKey(campaignId, broadcastId, messageId, audioUrl);
      if (!audioUrl || !playbackKey) return;
      if (consumePendingLocalBroadcast(playbackKey)) return;
      if (!shouldPlayBroadcastPlayback(playbackKey)) return;
      playBroadcastAudio(playbackKey, audioUrl);
    }
  }, [campaignId]);

  useEffect(() => {
    return () => {
      ttsAudioRef.current?.pause();
      ttsAudioRef.current = null;
      streamPlayerRef.current?.stop();
      streamPlayerRef.current = null;
    };
  }, []);

  const clearTtsCache = useCallback((dbId?: number, msgId?: string) => {
    if (dbId) ttsCache.delete(`db_${dbId}`);
    if (msgId) ttsCache.delete(msgId);
  }, []);

  return {
    handleTTS, handleTTSRegenerate, handleTTSBroadcast,
    ttsPlayingId, ttsLoading, stopPlayback,
    handleTTSWebSocketMessage, clearTtsCache,
  };
}
