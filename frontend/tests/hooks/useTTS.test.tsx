import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetTTSStateForTests, useTTS } from '~/hooks/useTTS';
import { useVoiceStore } from '~/stores/voiceStore';

class MockAudio {
  static instances: MockAudio[] = [];

  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });

  constructor(public src: string) {
    MockAudio.instances.push(this);
  }

  static reset() {
    MockAudio.instances = [];
  }
}

describe('useTTS broadcast playback', () => {
  beforeEach(() => {
    __resetTTSStateForTests();
    useVoiceStore.getState().reset();
    useVoiceStore.getState().setConnected(true);
    MockAudio.reset();
    vi.stubGlobal('Audio', MockAudio);
    vi.mocked(fetch).mockReset();
  });

  afterEach(() => {
    __resetTTSStateForTests();
    useVoiceStore.getState().reset();
    vi.unstubAllGlobals();
  });

  it('plays a broadcast only once across multiple hook instances', () => {
    const first = renderHook(() => useTTS('321'));
    const second = renderHook(() => useTTS('321'));

    act(() => {
      first.result.current.handleTTSWebSocketMessage('tts_broadcast', {
        message_id: 42,
        audio_url: 'https://example.com/tts.mp3',
        broadcast_id: 'broadcast_1',
      });
      second.result.current.handleTTSWebSocketMessage('tts_broadcast', {
        message_id: 42,
        audio_url: 'https://example.com/tts.mp3',
        broadcast_id: 'broadcast_1',
      });
    });

    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0].play).toHaveBeenCalledTimes(1);
  });

  it('ignores websocket echo for a locally initiated broadcast', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        audio_url: 'https://example.com/local-tts.mp3',
        format: 'mp3',
      }),
    } as Response);

    const sendMessage = vi.fn();
    const { result } = renderHook(() => useTTS('654', sendMessage));

    await act(async () => {
      await result.current.handleTTSBroadcast('msg_1', 'hello world', 99);
    });

    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0].play).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const payload = sendMessage.mock.calls[0][0];

    act(() => {
      result.current.handleTTSWebSocketMessage('tts_broadcast', payload.data);
    });

    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0].play).toHaveBeenCalledTimes(1);
  });
});
