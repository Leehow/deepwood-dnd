import { useEffect, useRef, useState } from 'react';
import type { PendingRequest } from '~/stores/tradeStore';

/** Play a short notification chime using Web Audio API */
function playTradeChime() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    // Two-tone chime: C5 → E5
    osc.frequency.setValueAtTime(523, ctx.currentTime);
    osc.frequency.setValueAtTime(659, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch { /* ignore if audio context unavailable */ }
}

interface TradeRequestNotificationProps {
  request: PendingRequest;
  onAccept: (tradeId: string) => void;
  onReject: (tradeId: string) => void;
}

export function TradeRequestNotification({ request, onAccept, onReject }: TradeRequestNotificationProps) {
  const [timeLeft, setTimeLeft] = useState(30);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  // Play chime on mount
  useEffect(() => {
    playTradeChime();
  }, []);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          onReject(request.tradeId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [request.tradeId, onReject]);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] animate-in slide-in-from-top duration-300">
      <div className="bg-gray-900 border border-amber-500/50 rounded-lg shadow-2xl px-5 py-4 min-w-[320px]">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">🤝</span>
          <div>
            <p className="text-sm text-gray-200 font-medium">
              <span className="text-amber-400">{request.fromCharacterName}</span> 想与你交易
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {timeLeft}秒后自动拒绝
            </p>
          </div>
        </div>

        {/* Timer bar */}
        <div className="w-full h-1 bg-gray-700 rounded-full mb-3 overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all duration-1000 ease-linear"
            style={{ width: `${(timeLeft / 30) * 100}%` }}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => { clearInterval(timerRef.current); onAccept(request.tradeId); }}
            className="flex-1 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-sm rounded transition-colors"
          >
            接受
          </button>
          <button
            onClick={() => { clearInterval(timerRef.current); onReject(request.tradeId); }}
            className="flex-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors"
          >
            拒绝
          </button>
        </div>
      </div>
    </div>
  );
}
