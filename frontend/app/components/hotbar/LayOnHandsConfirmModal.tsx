/**
 * LayOnHandsConfirmModal - 圣疗术确认弹窗
 * Paladin Lay on Hands: variable HP pool, touch range (5ft), cure disease/poison (5pts each)
 * D&D 5E: deals radiant damage to undead instead of healing
 */
import { useState, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

interface Props {
  open: boolean;
  targetName: string;
  targetIsUndead: boolean;
  poolCurrent: number;
  poolMax: number;
  distanceFeet: number;
  onConfirm: (healAmount: number, cureDisease: boolean, curePoison: boolean) => void;
  onCancel: () => void;
}

export function LayOnHandsConfirmModal({
  open, targetName, targetIsUndead,
  poolCurrent, poolMax, distanceFeet, onConfirm, onCancel,
}: Props) {
  const [healAmount, setHealAmount] = useState(0);
  const [cureDisease, setCureDisease] = useState(false);
  const [curePoison, setCurePoison] = useState(false);

  const dist = Math.round(distanceFeet);
  const outOfRange = dist > 5;

  // Undead mode: no cure, only damage
  const maxHeal = useMemo(() => {
    if (targetIsUndead) return poolCurrent;
    let available = poolCurrent;
    if (cureDisease) available -= 5;
    if (curePoison) available -= 5;
    return Math.max(0, available);
  }, [poolCurrent, cureDisease, curePoison, targetIsUndead]);

  const totalCost = healAmount + (targetIsUndead ? 0 : (cureDisease ? 5 : 0) + (curePoison ? 5 : 0));
  const canConfirm = !outOfRange && totalCost > 0 && totalCost <= poolCurrent;

  const handleCureChange = (type: 'disease' | 'poison', checked: boolean) => {
    const nextDisease = type === 'disease' ? checked : cureDisease;
    const nextPoison = type === 'poison' ? checked : curePoison;
    if (type === 'disease') setCureDisease(checked);
    else setCurePoison(checked);
    const available = poolCurrent - (nextDisease ? 5 : 0) - (nextPoison ? 5 : 0);
    const newMax = Math.max(0, available);
    if (healAmount > newMax) setHealAmount(newMax);
  };

  // Theme colors based on mode
  const accent = targetIsUndead ? 'amber' : 'emerald';

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[250]" />
        <Dialog.Content className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
          w-[92vw] max-w-sm bg-gray-900 border rounded-xl shadow-2xl z-[251] p-5
          ${targetIsUndead ? 'border-amber-700/60 shadow-amber-900/20' : 'border-emerald-700/60 shadow-emerald-900/20'}`}>
          {/* Header */}
          <div className="flex items-center gap-3 mb-3">
            <span className={`w-10 h-10 flex items-center justify-center text-2xl rounded-lg border
              ${targetIsUndead ? 'bg-amber-900/40 border-amber-700/60' : 'bg-emerald-900/40 border-emerald-700/60'}`}>
              {targetIsUndead ? '☀️' : '✋'}
            </span>
            <div className="flex-1 min-w-0">
              <Dialog.Title className={`text-base font-semibold ${targetIsUndead ? 'text-amber-200' : 'text-emerald-200'}`}>
                圣疗术 — Lay on Hands
              </Dialog.Title>
              <div className="text-xs text-gray-400">
                触碰范围 · 圣疗池 {poolCurrent}/{poolMax}
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
                {dist}尺 {outOfRange && '(超出触碰范围!)'}
              </span>
            </div>
          </div>

          {/* Undead notice */}
          {targetIsUndead && (
            <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg px-3 py-2 mb-3
              text-amber-300 text-xs flex items-center gap-2">
              <span>☀️</span>
              <span>不死生物 — 圣疗之力将转化为光耀伤害</span>
            </div>
          )}

          {/* Amount control */}
          <div className="space-y-3 mb-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-300">{targetIsUndead ? '伤害量' : '治疗量'}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={maxHeal}
                    value={healAmount}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(parseInt(e.target.value) || 0, maxHeal));
                      setHealAmount(v);
                    }}
                    className={`w-16 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-center
                      text-sm focus:outline-none
                      ${targetIsUndead ? 'text-amber-300 focus:border-amber-500' : 'text-emerald-300 focus:border-emerald-500'}`}
                  />
                  <span className="text-xs text-gray-500">/ {maxHeal}</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={maxHeal}
                value={healAmount}
                onChange={(e) => setHealAmount(parseInt(e.target.value))}
                disabled={maxHeal === 0}
                className={`w-full h-1.5 rounded-full appearance-none bg-gray-700
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                  [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:cursor-pointer disabled:opacity-40
                  ${targetIsUndead
                    ? '[&::-webkit-slider-thumb]:bg-amber-400'
                    : '[&::-webkit-slider-thumb]:bg-emerald-400'}`}
              />
            </div>

            {/* Cure checkboxes - only for non-undead */}
            {!targetIsUndead && (
              <div className="space-y-2">
                <label className={`flex items-center gap-2 text-sm cursor-pointer
                  ${poolCurrent - (curePoison ? 5 : 0) < 5 && !cureDisease ? 'opacity-40 pointer-events-none' : ''}`}>
                  <input
                    type="checkbox"
                    checked={cureDisease}
                    onChange={(e) => handleCureChange('disease', e.target.checked)}
                    disabled={poolCurrent - (curePoison ? 5 : 0) < 5 && !cureDisease}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-800
                      text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
                  />
                  <span className="text-gray-300">移除一个疾病</span>
                  <span className="text-xs text-gray-500 ml-auto">-5点</span>
                </label>
                <label className={`flex items-center gap-2 text-sm cursor-pointer
                  ${poolCurrent - (cureDisease ? 5 : 0) < 5 && !curePoison ? 'opacity-40 pointer-events-none' : ''}`}>
                  <input
                    type="checkbox"
                    checked={curePoison}
                    onChange={(e) => handleCureChange('poison', e.target.checked)}
                    disabled={poolCurrent - (cureDisease ? 5 : 0) < 5 && !curePoison}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-800
                      text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
                  />
                  <span className="text-gray-300">中和一种毒素</span>
                  <span className="text-xs text-gray-500 ml-auto">-5点</span>
                </label>
              </div>
            )}
          </div>

          {/* Total cost */}
          <div className="flex items-center justify-between text-sm mb-4 px-1">
            <span className="text-gray-400">消耗圣疗池</span>
            <span className={`font-medium ${totalCost > poolCurrent ? 'text-red-400' : targetIsUndead ? 'text-amber-300' : 'text-emerald-300'}`}>
              {totalCost} / {poolCurrent} 点
            </span>
          </div>

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
              onClick={() => canConfirm && onConfirm(healAmount, cureDisease, curePoison)}
              disabled={!canConfirm}
              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors text-sm ${
                canConfirm
                  ? targetIsUndead
                    ? 'bg-amber-700 hover:bg-amber-600 text-white'
                    : 'bg-emerald-700 hover:bg-emerald-600 text-white'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              {targetIsUndead ? '确认伤害' : '确认治疗'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
