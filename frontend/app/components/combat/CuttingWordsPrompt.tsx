/**
 * CuttingWordsPrompt — 辛辣嘲讽反应提示（博识吟游诗人）
 * DM 侧在敌方投攻击/检定/伤害后弹出，可消耗激励骰削减结果
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { getApiEndpoint } from "~/config/api";

export interface CuttingWordsTarget {
  targetTokenId: number;
  targetName: string;
  rollType: "attack" | "check" | "damage";
  rollTypeLabel: string;
  originalTotal: number;
}

interface CuttingWordsPromptProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: number;
  bardCharacterId: number;
  bardName: string;
  inspirationDieSize: string; // e.g. 'd8'
  inspirationCharges: number;
  target: CuttingWordsTarget;
  onResult?: (dieRolled: number, newTotal: number) => void;
}

export function CuttingWordsPrompt({
  isOpen,
  onClose,
  campaignId,
  bardCharacterId,
  bardName,
  inspirationDieSize,
  inspirationCharges,
  target,
  onResult,
}: CuttingWordsPromptProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ dieRolled: number; newTotal: number } | null>(null);

  if (!isOpen) return null;

  const handleApply = async () => {
    setLoading(true);
    try {
      const resp = await fetch(getApiEndpoint("/api/combat/cutting-words"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaignId,
          bard_character_id: bardCharacterId,
          target_token_id: target.targetTokenId,
          roll_type: target.rollType,
          original_total: target.originalTotal,
          inspiration_die_size: inspirationDieSize,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setResult({ dieRolled: data.die_rolled, newTotal: data.new_total });
        onResult?.(data.die_rolled, data.new_total);
      }
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 z-[10400] flex items-end justify-center pb-24"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg border border-rose-500/40 shadow-lg shadow-rose-500/10 p-4 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-rose-400 text-lg">🎵</span>
          <span className="font-semibold text-rose-300">辛辣嘲讽</span>
          <span className="text-xs text-gray-500 ml-auto">反应</span>
        </div>

        <p className="text-sm text-gray-300 mb-3">
          <span className="text-amber-300">{bardName}</span>
          {" 可消耗激励骰 ({inspirationDieSize}) 削减 "}
          <span className="text-red-300">{target.targetName}</span>
          {" 的{target.rollTypeLabel}。"}
        </p>

        <div className="flex items-center justify-between text-sm mb-3">
          <span className="text-gray-400">当前结果: <span className="text-white font-mono">{target.originalTotal}</span></span>
          <span className="text-gray-500">剩余激励: {inspirationCharges}</span>
        </div>

        {result ? (
          <div className="bg-gray-900 rounded p-3 text-center space-y-1">
            <div className="text-rose-300">
              投出 {inspirationDieSize} = <span className="font-bold text-lg">{result.dieRolled}</span>
            </div>
            <div className="text-gray-400 text-sm">
              {target.originalTotal} - {result.dieRolled} = <span className="text-white font-bold">{result.newTotal}</span>
            </div>
            <button
              onClick={onClose}
              className="mt-2 px-4 py-1.5 rounded text-sm bg-gray-700 text-gray-300 hover:bg-gray-600"
            >
              关闭
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleApply}
              disabled={loading || inspirationCharges <= 0}
              className="flex-1 px-3 py-2 rounded text-sm font-medium bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "投掷中..." : `使用辛辣嘲讽 (${inspirationDieSize})`}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-2 rounded text-sm bg-gray-700 text-gray-400 hover:bg-gray-600"
            >
              跳过
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
