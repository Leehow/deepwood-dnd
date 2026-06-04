/**
 * DivineSmiteConfirmModal - 神圣惩击确认弹窗
 * Paladin Divine Smite: consume spell slot to deal extra radiant damage, +1d8 vs undead/fiend
 */
import { useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

interface Props {
  open: boolean;
  targetName: string;
  targetMonsterType?: string;
  spellSlotLevel: number;
  distanceFeet: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DivineSmiteConfirmModal({
  open, targetName, targetMonsterType,
  spellSlotLevel, distanceFeet, onConfirm, onCancel,
}: Props) {
  const dist = Math.round(distanceFeet);
  const outOfRange = dist > 5;

  const isUndeadOrFiend = useMemo(() => {
    if (!targetMonsterType) return false;
    const t = targetMonsterType.toLowerCase();
    return t === 'undead' || t === 'fiend';
  }, [targetMonsterType]);

  // Damage dice: min(1 + slot_level, 5)d8, +1d8 vs undead/fiend
  const baseDice = Math.min(1 + spellSlotLevel, 5);
  const bonusDice = isUndeadOrFiend ? 1 : 0;
  const totalDice = baseDice + bonusDice;

  const canConfirm = !outOfRange;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[250]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
          w-[92vw] max-w-sm bg-gray-900 border border-amber-700/60 rounded-xl
          shadow-2xl shadow-amber-900/20 z-[251] p-5">
          {/* Header */}
          <div className="flex items-center gap-3 mb-3">
            <span className="w-10 h-10 flex items-center justify-center text-2xl
                           bg-amber-900/40 rounded-lg border border-amber-700/60">
              ⚔
            </span>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-base font-semibold text-amber-200">
                神圣惩击 — Divine Smite
              </Dialog.Title>
              <div className="text-xs text-gray-400">
                近战范围 · {spellSlotLevel}环法术位
              </div>
            </div>
          </div>

          {/* Target info */}
          <div className="bg-gray-800/60 rounded-lg px-3 py-2 mb-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">目标：</span>
              <span className="text-gray-100 font-medium">{targetName}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">距离</span>
              <span className={outOfRange ? 'text-red-400 font-medium' : 'text-green-400'}>
                {dist}尺 {outOfRange && '(超出近战范围!)'}
              </span>
            </div>
          </div>

          {/* Out of range warning */}
          {outOfRange && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 mb-3
              text-red-300 text-xs flex items-center gap-2">
              <span>⚠</span>
              <span>目标超出近战范围（5尺），无法使用神圣惩击</span>
            </div>
          )}

          {/* Damage preview */}
          <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2.5 mb-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-300">伤害骰</span>
              <span className="text-amber-300 font-bold">{totalDice}d8</span>
            </div>
            <div className="text-xs space-y-1">
              <div className="flex items-center justify-between text-gray-400">
                <span>基础伤害（{spellSlotLevel}环位）</span>
                <span>{baseDice}d8</span>
              </div>
              {isUndeadOrFiend && (
                <div className="flex items-center justify-between text-yellow-400">
                  <span>额外（亡灵/邪魔）</span>
                  <span>+1d8</span>
                </div>
              )}
              <div className="flex items-center justify-between text-amber-400/80 pt-1 border-t border-amber-800/30">
                <span>伤害类型</span>
                <span>光耀 (Radiant)</span>
              </div>
              <div className="flex items-center justify-between text-gray-500">
                <span>期望伤害</span>
                <span>{totalDice * 4.5}</span>
              </div>
            </div>
          </div>

          {/* Undead/Fiend bonus hint */}
          {isUndeadOrFiend && (
            <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg px-3 py-2 mb-3
              text-yellow-300 text-xs flex items-center gap-2">
              <span>✦</span>
              <span>目标为{targetMonsterType === 'undead' ? '亡灵' : '邪魔'}生物，额外 +1d8 光耀伤害</span>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-600
                       text-gray-300 hover:bg-gray-800 transition-colors text-sm"
            >
              取消
            </button>
            <button
              onClick={() => canConfirm && onConfirm()}
              disabled={!canConfirm}
              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors text-sm ${
                canConfirm
                  ? 'bg-amber-700 hover:bg-amber-600 text-white'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              确认惩击
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
