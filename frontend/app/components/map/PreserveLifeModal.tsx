import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

export interface PreserveLifeTargetOption {
  tokenId: number;
  name: string;
  currentHp: number;
  maxHp: number;
  maxHealable: number;
  distanceFeet: number;
}

interface Props {
  open: boolean;
  sourceName: string;
  totalPool: number;
  channelDivinityCurrent: number;
  channelDivinityMax: number;
  targets: PreserveLifeTargetOption[];
  onCancel: () => void;
  onConfirm: (allocations: Array<{ targetTokenId: number; healAmount: number }>) => void;
}

export function PreserveLifeModal({
  open,
  sourceName,
  totalPool,
  channelDivinityCurrent,
  channelDivinityMax,
  targets,
  onCancel,
  onConfirm,
}: Props) {
  const [allocations, setAllocations] = useState<Record<number, number>>({});

  useEffect(() => {
    if (!open) return;
    setAllocations(Object.fromEntries(targets.map((target) => [target.tokenId, 0])));
  }, [open, targets]);

  const totalAssigned = useMemo(
    () => Object.values(allocations).reduce((sum, value) => sum + value, 0),
    [allocations]
  );
  const remaining = totalPool - totalAssigned;
  const canConfirm = totalAssigned > 0 && totalAssigned <= totalPool;

  const setAllocation = (targetId: number, nextValue: number) => {
    const target = targets.find((entry) => entry.tokenId === targetId);
    if (!target) return;
    const current = allocations[targetId] || 0;
    const safeValue = Math.max(
      0,
      Math.min(target.maxHealable, nextValue, current + remaining)
    );
    setAllocations((prev) => ({ ...prev, [targetId]: safeValue }));
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[260]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                     w-[92vw] max-w-2xl max-h-[85dvh] overflow-hidden
                     bg-gray-900 border border-emerald-700/60 rounded-xl shadow-2xl z-[261]
                     flex flex-col"
        >
          <div className="px-5 py-4 border-b border-gray-700 bg-emerald-900/20">
            <Dialog.Title className="text-lg font-semibold text-emerald-200">
              保命通道
            </Dialog.Title>
            <div className="text-xs text-gray-400 mt-1">
              {sourceName} 使用引导神力。总治疗量 {totalPool}，且每个目标治疗后不能超过其生命值上限的一半。
            </div>
            <div className="text-xs text-amber-300 mt-1">
              引导神力 {channelDivinityCurrent}/{channelDivinityMax}
            </div>
          </div>

          <div className="px-5 py-3 border-b border-gray-700 bg-gray-800/40 flex items-center justify-between text-sm">
            <span className="text-gray-300">剩余可分配治疗</span>
            <span className={`font-semibold ${remaining < 0 ? 'text-red-400' : 'text-emerald-300'}`}>
              {remaining} / {totalPool}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {targets.length === 0 ? (
              <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 text-sm text-gray-400">
                30尺内没有可被保命通道治疗的目标。
              </div>
            ) : (
              targets.map((target) => {
                const assigned = allocations[target.tokenId] || 0;
                const halfCap = Math.floor(target.maxHp / 2);
                return (
                  <div key={target.tokenId} className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-gray-100">{target.name}</div>
                        <div className="text-xs text-gray-400 mt-1">
                          HP {target.currentHp}/{target.maxHp}，半血上限 {halfCap}，距离 {Math.round(target.distanceFeet)}尺
                        </div>
                        <div className="text-xs text-emerald-300 mt-1">
                          最多可治疗 {target.maxHealable}
                        </div>
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={target.maxHealable}
                        value={assigned}
                        onChange={(e) => setAllocation(target.tokenId, parseInt(e.target.value || '0', 10))}
                        className="w-20 px-2 py-1 rounded border border-gray-600 bg-gray-900 text-center text-sm text-emerald-200"
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={target.maxHealable}
                      value={assigned}
                      onChange={(e) => setAllocation(target.tokenId, parseInt(e.target.value, 10))}
                      className="w-full mt-3 h-1.5 rounded-full appearance-none bg-gray-700
                                 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                                 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
                                 [&::-webkit-slider-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:cursor-pointer"
                    />
                  </div>
                );
              })
            )}
          </div>

          <div className="px-5 py-4 border-t border-gray-700 flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors text-sm"
            >
              取消
            </button>
            <button
              disabled={!canConfirm}
              onClick={() => {
                const result = targets
                  .map((target) => ({
                    targetTokenId: target.tokenId,
                    healAmount: allocations[target.tokenId] || 0,
                  }))
                  .filter((entry) => entry.healAmount > 0);
                onConfirm(result);
              }}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                canConfirm
                  ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              确认分配
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
