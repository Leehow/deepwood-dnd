import { useState, useRef, useCallback, useEffect } from "react";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8174";

interface VoiceInputProps {
  onTranscribed: (text: string) => void;
  disabled?: boolean;
  compact?: boolean;
  showCancel?: boolean;
}

type Status = "idle" | "recording" | "transcribing" | "success" | "error";

export function VoiceInput({ onTranscribed, disabled, compact, showCancel }: VoiceInputProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [audioLevel, setAudioLevel] = useState(0); // 0-1 音量级别
  const cancelledRef = useRef(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // 清理音频分析器
  const cleanupAudioAnalyser = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  // 分析音频电平
  const analyzeAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // 计算平均音量
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const normalizedLevel = Math.min(average / 128, 1); // 归一化到 0-1
    setAudioLevel(normalizedLevel);

    animationFrameRef.current = requestAnimationFrame(analyzeAudioLevel);
  }, []);

  const startRecording = useCallback(async () => {
    if (disabled) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 设置音频分析器
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      // 开始分析音频电平
      analyzeAudioLevel();

      // Use webm format with opus codec for better compatibility
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // 清理
        cleanupAudioAnalyser();
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        // 如果是取消操作，直接回到 idle
        if (cancelledRef.current) {
          cancelledRef.current = false;
          chunksRef.current = [];
          setStatus("idle");
          return;
        }

        if (chunksRef.current.length === 0) {
          setStatus("idle");
          return;
        }

        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        // Convert to base64 and send to server
        setStatus("transcribing");
        try {
          const base64 = await blobToBase64(blob);
          const format = mimeType.includes("webm") ? "webm" : "mp4";
          const text = await transcribeAudio(base64, format);
          if (text) {
            setStatus("success");
            onTranscribed(text);
            // 1.5秒后重置状态
            setTimeout(() => setStatus("idle"), 1500);
          } else {
            setStatus("error");
            setErrorMsg("未识别到语音");
            setTimeout(() => setStatus("idle"), 2000);
          }
        } catch (error) {
          console.error("Transcription error:", error);
          setStatus("error");
          setErrorMsg(error instanceof Error ? error.message : "识别失败");
          setTimeout(() => setStatus("idle"), 2000);
        }
      };

      mediaRecorder.start();
      setStatus("recording");
      setErrorMsg("");
    } catch (error) {
      console.error("Failed to start recording:", error);
      setStatus("error");
      setErrorMsg("无法访问麦克风");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }, [disabled, onTranscribed, analyzeAudioLevel, cleanupAudioAnalyser]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && status === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, [status]);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && status === "recording") {
      cancelledRef.current = true;
      mediaRecorderRef.current.stop();
    }
  }, [status]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cleanupAudioAnalyser();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cleanupAudioAnalyser]);

  const handleClick = useCallback(() => {
    if (status === "idle") {
      startRecording();
    } else if (status === "recording") {
      stopRecording();
    }
  }, [startRecording, stopRecording, status]);

  // 生成声波条
  const renderWaveBars = () => {
    const bars = [];
    const barCount = 5;
    for (let i = 0; i < barCount; i++) {
      // 每个条的高度基于音量，加上一些随机偏移让动画更自然
      const baseHeight = 4;
      const maxExtraHeight = 16;
      const offset = Math.sin((i / barCount) * Math.PI); // 中间条更高
      const height = baseHeight + audioLevel * maxExtraHeight * (0.5 + offset * 0.5);
      bars.push(
        <div
          key={i}
          className="w-1 bg-red-400 rounded-full transition-all duration-75"
          style={{ height: `${height}px` }}
        />
      );
    }
    return bars;
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={handleClick}
          disabled={disabled || status === "transcribing"}
          title={status === "recording" ? "点击停止并发送" : "点击录音"}
          className={`w-9 h-9 rounded flex items-center justify-center shrink-0 transition-all select-none ${
            status === "recording"
              ? "bg-red-600/80 text-white"
              : status === "transcribing"
              ? "bg-gray-700 text-gray-400 cursor-wait"
              : status === "success"
              ? "bg-green-600/30 text-green-400"
              : status === "error"
              ? "bg-red-900/80 text-red-300"
              : disabled
              ? "bg-gray-800 text-gray-600 cursor-not-allowed"
              : "bg-gray-700 text-gray-300 hover:bg-emerald-600/40 hover:text-emerald-200 active:bg-red-600 active:text-white border border-gray-600"
          }`}
        >
          {status === "transcribing" ? (
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          ) : status === "recording" ? (
            <div className="flex items-center gap-0.5 h-4">
              {renderWaveBars()}
            </div>
          ) : status === "success" ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : status === "error" ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <MicIcon className="w-4 h-4" />
          )}
        </button>
        {showCancel && status === "recording" && (
          <button
            onClick={cancelRecording}
            title="取消录音"
            className="w-7 h-7 rounded flex items-center justify-center shrink-0 text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled || status === "transcribing"}
      className={`flex-1 h-10 rounded-lg flex items-center justify-center gap-2 transition-all select-none ${
        status === "recording"
          ? "bg-red-600/80 text-white"
          : status === "transcribing"
          ? "bg-gray-700 text-gray-400 cursor-wait"
          : status === "success"
          ? "bg-green-600/80 text-white"
          : status === "error"
          ? "bg-red-900/80 text-red-300"
          : disabled
          ? "bg-gray-800 text-gray-600 cursor-not-allowed"
          : "bg-emerald-700/60 text-emerald-200 hover:bg-emerald-600/60 active:bg-red-600 active:text-white border border-emerald-600/40"
      }`}
    >
      {status === "transcribing" ? (
        <>
          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">识别中...</span>
        </>
      ) : status === "recording" ? (
        <>
          <div className="flex items-center gap-0.5 h-5">
            {renderWaveBars()}
          </div>
          <span className="text-sm">点击停止</span>
        </>
      ) : status === "success" ? (
        <>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm">识别成功</span>
        </>
      ) : status === "error" ? (
        <>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="text-sm">{errorMsg || "识别失败"}</span>
        </>
      ) : (
        <>
          <MicIcon className="w-5 h-5" />
          <span className="text-sm">点击录音</span>
        </>
      )}
    </button>
  );
}

// Helper to convert Blob to base64
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      // Remove data URL prefix (e.g., "data:audio/webm;base64,")
      const base64Data = base64.split(",")[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// API call to transcribe audio
async function transcribeAudio(
  audioBase64: string,
  format: string
): Promise<string> {
  const token = localStorage.getItem("dnd_auth_token");
  if (!token) throw new Error("未登录");

  const response = await fetch(`${API_BASE_URL}/api/voice/transcribe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      audio_base64: audioBase64,
      format: format,
      language: "zh",
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "识别失败");
  }

  const result = await response.json();
  return result.text;
}

// Mic icon component
function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}
