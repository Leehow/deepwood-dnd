/**
 * 全屏加载界面 - 龙+D20 logo 带呼吸动画
 */
import { getAssetUrl } from '~/utils/asset-url';

export function LoadingScreen({ message = "正在进入冒险..." }: { message?: string }) {
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-gray-900 overflow-hidden">
      {/* 龙+D20 Logo */}
      <div className="mb-6 animate-[breathe_3s_ease-in-out_infinite]">
        <img
          src={getAssetUrl('logo.png')}
          alt="深渊小屋"
          className="w-32 h-auto drop-shadow-[0_0_24px_rgba(124,58,237,0.5)]"
        />
      </div>

      {/* 标题 */}
      <h1 className="text-xl font-bold text-amber-400/90 tracking-widest mb-3 font-serif animate-[fadeIn_0.8s_ease-out]">
        深渊小屋
      </h1>

      {/* 滚动的加载点 */}
      <div className="flex gap-1.5 mb-4">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-purple-500/80"
            style={{ animation: `dotBounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
      </div>

      <p className="text-sm text-gray-500">{message}</p>

      <style>{`
        @keyframes breathe {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 20px rgba(124,58,237,0.4)); }
          50% { transform: scale(1.06); filter: drop-shadow(0 0 32px rgba(124,58,237,0.6)); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes dotBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
