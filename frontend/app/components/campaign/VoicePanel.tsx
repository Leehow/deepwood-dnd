import { useEffect, useRef } from "react";
import { useVoiceChat } from "~/hooks/useVoiceChat";

const PhoneIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const PhoneOffIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
    <line x1="22" x2="2" y1="2" y2="22" />
  </svg>
);

const MicIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" x2="12" y1="19" y2="22" />
  </svg>
);

const MicOffIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="2" x2="22" y1="2" y2="22" />
    <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
    <path d="M5 10v2a7 7 0 0 0 12 5" />
    <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
    <line x1="12" x2="12" y1="19" y2="22" />
  </svg>
);

function AudioBars({ level }: { level: number }) {
  const barCount = 4;
  const bars = [];
  for (let i = 0; i < barCount; i++) {
    const phase = (i / barCount) * Math.PI * 2;
    const factor = 0.4 + 0.6 * Math.abs(Math.sin(phase + level * 8));
    const h = Math.max(3, level * factor * 18);
    bars.push(
      <div
        key={i}
        className="w-[3px] rounded-full bg-green-400 transition-[height] duration-75"
        style={{ height: `${h}px` }}
      />
    );
  }
  return (
    <div className="flex items-center gap-[2px] h-5">
      {bars}
    </div>
  );
}

interface VoicePanelProps {
  campaignId: string;
  sendMessage?: (message: any) => void;
}

export function VoicePanel({ campaignId, sendMessage }: VoicePanelProps) {
  const {
    connectToRoom,
    disconnect,
    toggleMute,
    isConnected,
    isConnecting,
    isMuted,
    participants,
    localAudioLevel,
  } = useVoiceChat();

  const wasConnectedRef = useRef(false);

  // 广播语音状态变化
  useEffect(() => {
    if (!sendMessage) return;

    if (isConnected && !wasConnectedRef.current) {
      // 刚加入语音
      sendMessage({ type: "voice_join", data: {} });
      wasConnectedRef.current = true;
    } else if (!isConnected && wasConnectedRef.current) {
      // 刚离开语音
      sendMessage({ type: "voice_leave", data: {} });
      wasConnectedRef.current = false;
    }
  }, [isConnected, sendMessage]);

  // 组件卸载时发送离开消息
  useEffect(() => {
    return () => {
      if (wasConnectedRef.current && sendMessage) {
        sendMessage({ type: "voice_leave", data: {} });
      }
    };
  }, [sendMessage]);

  const handleConnect = async () => {
    const authToken = localStorage.getItem("dnd_auth_token");
    if (!authToken) {
      console.error("Not authenticated");
      return;
    }
    await connectToRoom(campaignId, authToken, true);
  };

  const handleDisconnect = () => {
    disconnect();
  };

  // 未连接：绿色电话按钮
  if (!isConnected && !isConnecting) {
    return (
      <button
        onClick={handleConnect}
        className="fixed bottom-4 left-20 z-[120] w-10 h-10 rounded-full bg-green-600 hover:bg-green-500 text-white shadow-lg flex items-center justify-center transition-all hover:scale-105"
        title="加入语音"
      >
        <PhoneIcon className="w-5 h-5" />
      </button>
    );
  }

  // 连接中：加载状态
  if (isConnecting) {
    return (
      <button
        disabled
        className="fixed bottom-4 left-20 z-[120] w-10 h-10 rounded-full bg-gray-600 text-white shadow-lg flex items-center justify-center"
      >
        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </button>
    );
  }

  // 已连接：显示控制按钮
  return (
    <div className="fixed bottom-4 left-20 z-[120] flex items-center gap-1">
      <button
        onClick={toggleMute}
        className={`w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 ${
          isMuted
            ? "bg-red-600 hover:bg-red-500 text-white"
            : "bg-green-600 hover:bg-green-500 text-white"
        }`}
        title={isMuted ? "取消静音" : "静音"}
      >
        {isMuted ? <MicOffIcon className="w-5 h-5" /> : <MicIcon className="w-5 h-5" />}
      </button>

      {!isMuted && localAudioLevel > 0.01 && (
        <AudioBars level={localAudioLevel} />
      )}

      {participants.length > 1 && (
        <span className="text-xs text-green-400 bg-gray-900/80 px-1.5 py-0.5 rounded-full">
          {participants.length}
        </span>
      )}

      <button
        onClick={handleDisconnect}
        className="w-10 h-10 rounded-full bg-red-600 hover:bg-red-500 text-white shadow-lg flex items-center justify-center transition-all hover:scale-105"
        title="离开语音"
      >
        <PhoneOffIcon className="w-5 h-5" />
      </button>
    </div>
  );
}
