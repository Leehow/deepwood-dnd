/**
 * CoinFlip - D2 硬币翻转动画
 * @3d-dice/dice-box 不支持 d2，单独用 CSS 3D 实现
 */
import { useEffect, useState, useCallback, useRef } from 'react';

interface CoinFlipProps {
  visible: boolean;
  onResult?: (value: 1 | 2) => void;
  onClose?: () => void;
  autoCloseDelay?: number;
}

export function CoinFlip({
  visible,
  onResult,
  onClose,
  autoCloseDelay = 2500,
}: CoinFlipProps) {
  const [flipping, setFlipping] = useState(false);
  const [result, setResult] = useState<1 | 2 | null>(null);
  const [rotation, setRotation] = useState(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!visible) {
      setFlipping(false);
      setResult(null);
      setRotation(0);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      return;
    }

    // 开始翻转
    setFlipping(true);
    setResult(null);
    const value: 1 | 2 = Math.random() < 0.5 ? 1 : 2;

    // 正面(1) = 偶数个半圈停, 反面(2) = 奇数个半圈停
    const fullRotations = 4 + Math.floor(Math.random() * 3); // 4-6 圈
    const finalDeg = fullRotations * 360 + (value === 2 ? 180 : 0);
    setRotation(finalDeg);

    // 动画结束后显示结果
    const timer = setTimeout(() => {
      setFlipping(false);
      setResult(value);
      onResult?.(value);

      if (autoCloseDelay > 0) {
        closeTimerRef.current = setTimeout(() => onClose?.(), autoCloseDelay);
      }
    }, 1800);

    return () => clearTimeout(timer);
  }, [visible]);

  const handleBackdropClick = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    onClose?.();
  }, [onClose]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={handleBackdropClick}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* 硬币容器 */}
      <div
        className="relative"
        style={{ perspective: '800px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="w-28 h-28 relative"
          style={{
            transformStyle: 'preserve-3d',
            transform: `rotateX(${rotation}deg)`,
            transition: flipping ? 'transform 1.8s cubic-bezier(0.2, 0.8, 0.3, 1)' : 'none',
          }}
        >
          {/* 正面 - 1 */}
          <div
            className="absolute inset-0 rounded-full flex items-center justify-center text-3xl font-bold border-4"
            style={{
              backfaceVisibility: 'hidden',
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              borderColor: '#92400e',
              color: '#451a03',
              boxShadow: '0 0 20px rgba(245, 158, 11, 0.5), inset 0 2px 4px rgba(255,255,255,0.3)',
            }}
          >
            <div className="flex flex-col items-center">
              <span className="text-4xl leading-none">1</span>
              <span className="text-xs mt-1 opacity-70">HEAD</span>
            </div>
          </div>

          {/* 反面 - 2 */}
          <div
            className="absolute inset-0 rounded-full flex items-center justify-center text-3xl font-bold border-4"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateX(180deg)',
              background: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
              borderColor: '#5b21b6',
              color: '#f5f3ff',
              boxShadow: '0 0 20px rgba(167, 139, 250, 0.5), inset 0 2px 4px rgba(255,255,255,0.3)',
            }}
          >
            <div className="flex flex-col items-center">
              <span className="text-4xl leading-none">2</span>
              <span className="text-xs mt-1 opacity-70">TAIL</span>
            </div>
          </div>
        </div>
      </div>

      {/* 结果 */}
      {result !== null && (
        <div className="absolute bottom-[15vh] left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="bg-black/70 backdrop-blur-md border border-amber-500/50 rounded-xl px-6 py-3 text-center">
            <div className="text-amber-400 text-sm font-medium mb-1">1d2</div>
            <div className="text-white text-3xl font-bold">{result}</div>
            <div className="text-gray-400 text-xs mt-1">{result === 1 ? '正面 (Head)' : '反面 (Tail)'}</div>
          </div>
        </div>
      )}

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-gray-400 text-xs pointer-events-none">
        {flipping ? '硬币翻转中...' : '点击空白处关闭'}
      </div>
    </div>
  );
}

export default CoinFlip;
