import { useState, useCallback, useRef, useEffect } from "react";
import {
  Room,
  RoomEvent,
  ConnectionState,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";
import { useVoiceStore, extractUserId, type VoiceParticipant } from "~/stores/voiceStore";

const API_BASE_URL = import.meta.env.VITE_API_URL || "";

export function useVoiceChat(): {
  getToken: (campaignId: string) => Promise<{ token: string; url: string; room_name: string }>;
  connectToRoom: (campaignId: string, authToken: string, enableMic?: boolean) => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  isConnected: boolean;
  isConnecting: boolean;
  isMuted: boolean;
  participants: VoiceParticipant[];
  localAudioLevel: number;
  error: string | null;
} {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const [localAudioLevel, setLocalAudioLevel] = useState(0);

  // Zustand store
  const { setConnected: setStoreConnected, setParticipants: setStoreParticipants, reset: resetStore } = useVoiceStore();

  const updateParticipants = useCallback(() => {
    if (!roomRef.current) return;

    const room = roomRef.current;
    const allParticipants: VoiceParticipant[] = [];

    // Add local participant
    if (room.localParticipant) {
      const identity = room.localParticipant.identity;
      allParticipants.push({
        identity,
        name: room.localParticipant.name || identity,
        userId: extractUserId(identity) || 0,
        isSpeaking: room.localParticipant.isSpeaking,
        isMuted: !room.localParticipant.isMicrophoneEnabled,
      });
    }

    // Add remote participants
    room.remoteParticipants.forEach((participant) => {
      const identity = participant.identity;
      allParticipants.push({
        identity,
        name: participant.name || identity,
        userId: extractUserId(identity) || 0,
        isSpeaking: participant.isSpeaking,
        isMuted: !participant.isMicrophoneEnabled,
      });
    });

    setParticipants(allParticipants);
    setStoreParticipants(allParticipants); // 同步到 store
  }, [setStoreParticipants]);

  const getToken = useCallback(
    async (campaignId: string): Promise<{ token: string; url: string; room_name: string }> => {
      const authToken = localStorage.getItem("dnd_auth_token");
      if (!authToken) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(`${API_BASE_URL}/api/voice/token/${campaignId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Failed to get voice token");
      }

      return response.json();
    },
    []
  );

  const connectToRoom = useCallback(
    async (campaignId: string, authToken: string, enableMic: boolean = false) => {
      if (roomRef.current?.state === ConnectionState.Connected) {
        return;
      }

      setIsConnecting(true);
      setError(null);

      try {
        const { token, url } = await getToken(campaignId);

        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
        });

        room.on(RoomEvent.ParticipantConnected, updateParticipants);
        room.on(RoomEvent.ParticipantDisconnected, updateParticipants);
        room.on(RoomEvent.ActiveSpeakersChanged, updateParticipants);
        room.on(RoomEvent.LocalTrackPublished, updateParticipants);
        room.on(RoomEvent.LocalTrackUnpublished, updateParticipants);

        // 远程音频轨道订阅：attach 到 DOM 以播放
        room.on(
          RoomEvent.TrackSubscribed,
          (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
            if (track.kind === Track.Kind.Audio) {
              const el = track.attach();
              el.id = `lk-audio-${participant.identity}`;
              el.style.display = "none";
              document.body.appendChild(el);
            }
            updateParticipants();
          },
        );

        room.on(
          RoomEvent.TrackUnsubscribed,
          (track: RemoteTrack) => {
            track.detach().forEach((el) => el.remove());
            updateParticipants();
          },
        );

        room.on(RoomEvent.Disconnected, () => {
          setIsConnected(false);
          setParticipants([]);
          setStoreConnected(false);
          setStoreParticipants([]);
        });

        await room.connect(url, token);

        // 解除浏览器 autoplay 限制，允许播放远程音频
        await room.startAudio();

        roomRef.current = room;
        setIsConnected(true);
        setStoreConnected(true); // 同步到 store

        if (enableMic) {
          await room.localParticipant.setMicrophoneEnabled(true);
          setIsMuted(false);
        } else {
          setIsMuted(true);
        }

        updateParticipants();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to connect";
        setError(message);
        console.error("Voice chat connection error:", err);
      } finally {
        setIsConnecting(false);
      }
    },
    [getToken, updateParticipants, setStoreConnected, setStoreParticipants]
  );

  const disconnect = useCallback(() => {
    if (roomRef.current) {
      // 清理所有远程音频元素
      document.querySelectorAll("[id^='lk-audio-']").forEach((el) => el.remove());
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    setIsConnected(false);
    setParticipants([]);
    setIsMuted(true);
    setError(null);
    resetStore(); // 重置 store
  }, [resetStore]);

  const toggleMute = useCallback(async () => {
    if (!roomRef.current) return;

    const room = roomRef.current;
    const newMuted = !isMuted;

    try {
      await room.localParticipant.setMicrophoneEnabled(!newMuted);
      setIsMuted(newMuted);
      updateParticipants();
    } catch (err) {
      console.error("Failed to toggle mute:", err);
      setError("Failed to toggle microphone");
    }
  }, [isMuted, updateParticipants]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
      resetStore();
    };
  }, [resetStore]);

  // Poll local audio level for visualization
  useEffect(() => {
    if (!isConnected || !roomRef.current) {
      setLocalAudioLevel(0);
      return;
    }

    const interval = setInterval(() => {
      if (roomRef.current?.localParticipant) {
        setLocalAudioLevel(roomRef.current.localParticipant.audioLevel);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [isConnected]);

  return {
    getToken,
    connectToRoom,
    disconnect,
    toggleMute,
    isConnected,
    isConnecting,
    isMuted,
    participants,
    localAudioLevel,
    error,
  };
}
