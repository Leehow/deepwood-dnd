/**
 * ArcaneRecoveryModal - 法术位恢复确认弹窗
 * Shared by Wizard Arcane Recovery & Druid Natural Recovery
 * Recover spell slots on short rest, total levels ≤ ceil(class_level/2), max 5th level
 */
import { useState, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

interface Props {
  open: boolean;
  /** Max spell slot budget = ceil(classLevel / 2) */
  budget: number;
  /** Remaining spell slots per level (index 0 = cantrip, 1-9 = levels) */
  remainingSlots: number[];
  /** Max spell slots per level */
  maxSlots: number[];
  onConfirm: (recoveries: Record<number, number>) => void;
  onCancel: () => void;
  /** Customization for different classes */
  title?: string;
  titleEn?: string;
  icon?: string;
  /** Tailwind color name: 'indigo' | 'emerald' etc. */
  accent?: 'indigo' | 'emerald';
}

const LEVEL_LABELS = ['—', '1环', '2环', '3环', '4环', '5环'];

const ACCENT_STYLES = {
  indigo: {
    border: 'border-indigo-700/60', shadow: 'shadow-indigo-900/20',
    iconBg: 'bg-indigo-900/40', iconBorder: 'border-indigo-700/60',
    title: 'text-indigo-200', badge: 'text-indigo-300',
    bar: 'bg-indigo-500', selected: 'text-indigo-400',
    btn: 'bg-indigo-700 hover:bg-indigo-600',
  },
  emerald: {
    border: 'border-emerald-700/60', shadow: 'shadow-emerald-900/20',
    iconBg: 'bg-emerald-900/40', iconBorder: 'border-emerald-700/60',
    title: 'text-emerald-200', badge: 'text-emerald-300',
    bar: 'bg-emerald-500', selected: 'text-emerald-400',
    btn: 'bg-emerald-700 hover:bg-emerald-600',
  },
};

export function ArcaneRecoveryModal({
  open, budget, remainingSlots, maxSlots, onConfirm, onCancel,
  title = '奥术恢复', titleEn = 'Arcane Recovery', icon = '🔮', accent = 'indigo',
}: Props) {
  const s = ACCENT_STYLES[accent];
  // recoveries[level] = number of slots to recover at that level
  const [recoveries, setRecoveries] = useState<Record<number, number>>({});

  const totalLevels = useMemo(() => {
    return Object.entries(recoveries).reduce((sum, [lvl, count]) => sum + Number(lvl) * count, 0);
  }, [recoveries]);

  const remaining = budget - totalLevels;
  const canConfirm = totalLevels > 0 && totalLevels <= budget;

  const handleChange = (level: number, delta: number) => {
    setRecoveries(prev => {
      const current = prev[level] || 0;
      const next = Math.max(0, current + delta);
      // Can't recover more than consumed slots
      const consumed = (maxSlots[level] ?? 0) - (remainingSlots[level] ?? 0);
      const clamped = Math.min(next, consumed);
      // Check budget
      const newTotal = totalLevels + (clamped - current) * level;
      if (newTotal > budget) return prev;
      const copy = { ...prev };
      if (clamped === 0) delete copy[level];
      else copy[level] = clamped;
      return copy;
    });
  };

  // Build rows for levels 1-5
  const rows = useMemo(() => {
    const result: { level: number; max: number; remaining: number; consumed: number }[] = [];
    for (let lvl = 1; lvl <= 5; lvl++) {
      const max = maxSlots[lvl] ?? 0;
      if (max === 0) continue;
      result.push({ level: lvl, max, remaining: remainingSlots[lvl] ?? 0, consumed: max - (remainingSlots[lvl] ?? 0) });
    }
    return result;
  }, [maxSlots, remainingSlots]);

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(recoveries);
    setRecoveries({});
  };

  const handleCancel = () => {
    setRecoveries({});
    onCancel();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) handleCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[250]" />
        <Dialog.Content className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
          w-[92vw] max-w-sm bg-gray-900 border rounded-xl shadow-2xl z-[251] p-5 ${s.border} ${s.shadow}`}>
          {/* Header */}
          <div className="flex items-center gap-3 mb-3">
            <span className={`w-10 h-10 flex items-center justify-center text-2xl rounded-lg border ${s.iconBg} ${s.iconBorder}`}>
              {icon}
            </span>
            <div className="flex-1 min-w-0">
              <Dialog.Title className={`text-base font-semibold ${s.title}`}>
                {title} — {titleEn}
              </Dialog.Title>
              <div className="text-xs text-gray-400">
                短休 · 恢复法术位
              </div>
            </div>
          </div>

          {/* Budget bar */}
          <div className="bg-gray-800/60 rounded-lg px-3 py-2 mb-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">恢复预算：</span>
              <span className={`font-medium ${remaining < 0 ? 'text-red-400' : s.badge}`}>
                已选 {totalLevels} / {budget} 级
              </span>
            </div>
            <div className="mt-1.5 h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${s.bar}`}
                style={{ width: `${Math.min(100, (totalLevels / budget) * 100)}%` }}
              />
            </div>
          </div>

          {/* Slot rows */}
          <div className="space-y-2 mb-4">
            {rows.length === 0 && (
              <div className="text-sm text-gray-500 text-center py-2">没有可恢复的法术位</div>
            )}
            {rows.map(({ level, max, remaining: rem, consumed }) => {
              const selected = recoveries[level] || 0;
              const canAdd = consumed > selected && totalLevels + level <= budget;
              const canSub = selected > 0;
              return (
                <div key={level} className="flex items-center justify-between bg-gray-800/40 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium w-10 ${s.badge}`}>{LEVEL_LABELS[level]}</span>
                    <span className="text-xs text-gray-500">{rem}/{max}</span>
                    {consumed === 0 && <span className="text-xs text-gray-600">(满)</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {selected > 0 && (
                      <span className={`text-xs ${s.selected}`}>+{selected}</span>
                    )}
                    <button
                      onClick={() => handleChange(level, -1)}
                      disabled={!canSub}
                      className="w-7 h-7 rounded border border-gray-600 text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-sm flex items-center justify-center"
                    >−</button>
                    <button
                      onClick={() => handleChange(level, 1)}
                      disabled={!canAdd}
                      className="w-7 h-7 rounded border border-gray-600 text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-sm flex items-center justify-center"
                    >+</button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleCancel}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors text-sm"
            >取消</button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors text-sm ${
                canConfirm ? `${s.btn} text-white` : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >确认恢复</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
