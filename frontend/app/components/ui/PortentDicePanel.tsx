/**
 * PortentDicePanel — 预言骰显示面板（占卜系法师）
 * 显示已预投的 d20 值，可点击选择用于替换投骰
 */
import { useState } from "react";

export interface PortentDicePanelProps {
  values: number[];
  onUse: (value: number) => void;
  onRoll?: () => void;
  canRoll?: boolean;
  compact?: boolean;
}

export function PortentDicePanel({
  values,
  onUse,
  onRoll,
  canRoll,
  compact,
}: PortentDicePanelProps) {
  const [confirmValue, setConfirmValue] = useState<number | null>(null);

  if (values.length === 0 && !canRoll) return null;

  const handleClick = (v: number) => {
    if (confirmValue === v) {
      onUse(v);
      setConfirmValue(null);
    } else {
      setConfirmValue(v);
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-indigo-400 font-medium whitespace-nowrap">预言骰</span>
        {values.map((v, i) => (
          <button
            key={i}
            onClick={() => handleClick(v)}
            className={`w-7 h-7 rounded text-xs font-bold border transition-colors ${
              confirmValue === v
                ? "border-indigo-400 bg-indigo-500/30 text-indigo-200"
                : "border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
            }`}
            title={confirmValue === v ? "再次点击确认使用" : `使用预言骰 ${v}`}
          >
            {v}
          </button>
        ))}
        {values.length === 0 && canRoll && (
          <button
            onClick={onRoll}
            className="px-2 py-1 text-xs rounded border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
          >
            投掷
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-gray-800/90 rounded-lg border border-indigo-500/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-indigo-400">预言骰 (Portent)</span>
        {canRoll && values.length === 0 && (
          <button
            onClick={onRoll}
            className="px-2 py-1 text-xs rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30"
          >
            长休投掷
          </button>
        )}
      </div>
      {values.length > 0 ? (
        <div className="flex items-center gap-2">
          {values.map((v, i) => (
            <button
              key={i}
              onClick={() => handleClick(v)}
              className={`w-10 h-10 rounded-lg text-lg font-bold border-2 transition-all ${
                confirmValue === v
                  ? "border-indigo-400 bg-indigo-500/30 text-indigo-100 scale-110 shadow-lg shadow-indigo-500/20"
                  : "border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 hover:border-indigo-500/60"
              }`}
              title={confirmValue === v ? "再次点击确认使用" : `点击选择预言骰 ${v}`}
            >
              {v}
            </button>
          ))}
          {confirmValue !== null && (
            <span className="text-xs text-indigo-400 animate-pulse ml-1">
              再次点击确认
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-500">长休后自动投掷</p>
      )}
    </div>
  );
}

/** 用于 CheckTypeSelectModal 内的预言骰选择条 */
export function PortentSelector({
  values,
  selectedValue,
  onSelect,
}: {
  values: number[];
  selectedValue: number | null;
  onSelect: (value: number | null) => void;
}) {
  if (values.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-indigo-400 font-medium">预言骰:</span>
      {values.map((v, i) => (
        <button
          key={i}
          onClick={() => onSelect(selectedValue === v ? null : v)}
          className={`w-7 h-7 rounded text-xs font-bold border transition-colors ${
            selectedValue === v
              ? "border-indigo-400 bg-indigo-500/30 text-indigo-200"
              : "border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
          }`}
        >
          {v}
        </button>
      ))}
      {selectedValue !== null && (
        <span className="text-xs text-indigo-300">= {selectedValue}</span>
      )}
    </div>
  );
}
