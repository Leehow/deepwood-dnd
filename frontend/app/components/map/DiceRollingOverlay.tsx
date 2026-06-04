/**
 * DiceRollingOverlay - 攻击时显示的骰子滚动动画
 * 在等待LLM生成叙事期间显示，让用户知道正在进行骰子判定
 */
import { useEffect, useState } from 'react';
import { D20Icon } from '~/components/ui/DiceIcons';

interface DiceRollingOverlayProps {
  visible: boolean;
  attackerName?: string;
  targetName?: string;
}

export function DiceRollingOverlay({
  visible,
  attackerName,
  targetName
}: DiceRollingOverlayProps) {
  const [dots, setDots] = useState('');

  // 动态省略号动画
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 400);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center">
      {/* 半透明背景 */}
      <div className="absolute inset-0 bg-black/30" />

      {/* 骰子动画容器 */}
      <div className="relative flex flex-col items-center gap-4">
        {/* 单个骰子动画 */}
        <div className="dice-roll-container">
          <D20Icon size={64} className="text-amber-400 dice-icon" />
        </div>

        {/* 攻击信息 */}
        <div className="text-center text-white drop-shadow-lg">
          {attackerName && targetName ? (
            <p className="text-lg font-semibold">
              <span className="text-red-400">{attackerName}</span>
              <span className="mx-2">⚔️</span>
              <span className="text-blue-400">{targetName}</span>
            </p>
          ) : null}
          <p className="text-amber-300 text-sm mt-1 font-medium">
            投掷攻击骰{dots}
          </p>
        </div>
      </div>

      {/* 内联样式 - 骰子滚动动画 */}
      <style>{`
        .dice-roll-container {
          animation: dice-bounce 1s ease-in-out infinite;
        }

        .dice-icon {
          animation: dice-spin 1.5s linear infinite;
          filter: drop-shadow(0 0 12px rgba(251, 191, 36, 0.6));
        }

        @keyframes dice-bounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-12px);
          }
        }

        @keyframes dice-spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

export default DiceRollingOverlay;
