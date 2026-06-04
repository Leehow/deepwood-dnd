/**
 * FlexibleCastingModal - 灵活施法确认弹窗
 * Sorcerer Flexible Casting: convert sorcery points ↔ spell slots (bonus action)
 * Create slot: spend points → gain slot (1→2, 2→3, 3→5, 4→6, 5→7)
 * Convert slot: spend slot → gain points equal to slot level
 */
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

interface Props {
  open: boolean;
  sorceryPointsCurrent: number;
  sorceryPointsMax: number;
  remainingSlots: number[];
  maxSlots: number[];
  onConfirm: (action: 'create_slot' | 'convert_slot', slotLevel: number) => void;
  onCancel: () => void;
}

const SLOT_TO_POINTS: Record<number, number> = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 };
const LEVEL_LABELS = ['—', '1环', '2环', '3环', '4环', '5环'];

export function FlexibleCastingModal({
  open, sorceryPointsCurrent, sorceryPointsMax,
  remainingSlots, maxSlots, onConfirm, onCancel,
}: Props) {
  const [tab, setTab] = useState<'create' | 'convert'>('create');

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[250]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
          w-[92vw] max-w-sm bg-gray-900 border border-purple-700/60 rounded-xl shadow-2xl shadow-purple-900/20 z-[251] p-5">
          {/* Header */}
          <div className="flex items-center gap-3 mb-3">
            <span className="w-10 h-10 flex items-center justify-center text-2xl rounded-lg border bg-purple-900/40 border-purple-700/60">
              ✨
            </span>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-base font-semibold text-purple-200">
                灵活施法 — Flexible Casting
              </Dialog.Title>
              <div className="text-xs text-gray-400">
                附赠动作 · 术法点 {sorceryPointsCurrent}/{sorceryPointsMax}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex mb-3 bg-gray-800/60 rounded-lg p-0.5">
            <button
              onClick={() => setTab('create')}
              className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${
                tab === 'create' ? 'bg-purple-700/60 text-purple-200' : 'text-gray-400 hover:text-gray-300'
              }`}
            >创造法术位</button>
            <button
              onClick={() => setTab('convert')}
              className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${
                tab === 'convert' ? 'bg-purple-700/60 text-purple-200' : 'text-gray-400 hover:text-gray-300'
              }`}
            >转化法术位</button>
          </div>

          {/* Create slot tab */}
          {tab === 'create' && (
            <div className="space-y-2 mb-4">
              <div className="text-xs text-gray-500 mb-2">消耗术法点 → 获得法术位</div>
              {([1, 2, 3, 4, 5] as const).map(level => {
                const cost = SLOT_TO_POINTS[level];
                const canAfford = sorceryPointsCurrent >= cost;
                return (
                  <button
                    key={level}
                    onClick={() => canAfford && onConfirm('create_slot', level)}
                    disabled={!canAfford}
                    className={`w-full flex items-center justify-between bg-gray-800/40 rounded-lg px-3 py-2.5 transition-colors ${
                      canAfford ? 'hover:bg-purple-900/30 cursor-pointer' : 'opacity-40 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-purple-300">{LEVEL_LABELS[level]}</span>
                      <span className="text-xs text-gray-500">法术位</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs ${canAfford ? 'text-purple-400' : 'text-gray-600'}`}>
                        消耗 {cost} 术法点
                      </span>
                      <span className="text-gray-600">→</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Convert slot tab */}
          {tab === 'convert' && (
            <div className="space-y-2 mb-4">
              <div className="text-xs text-gray-500 mb-2">消耗法术位 → 获得等级数的术法点</div>
              {([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map(level => {
                const max = maxSlots[level] ?? 0;
                const rem = remainingSlots[level] ?? 0;
                if (max === 0) return null;
                const hasSlot = rem > 0;
                const wouldOverflow = sorceryPointsCurrent + level > sorceryPointsMax;
                const canDo = hasSlot && !wouldOverflow;
                return (
                  <button
                    key={level}
                    onClick={() => canDo && onConfirm('convert_slot', level)}
                    disabled={!canDo}
                    className={`w-full flex items-center justify-between bg-gray-800/40 rounded-lg px-3 py-2.5 transition-colors ${
                      canDo ? 'hover:bg-purple-900/30 cursor-pointer' : 'opacity-40 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-purple-300">{level}环</span>
                      <span className="text-xs text-gray-500">{rem}/{max}</span>
                      {!hasSlot && <span className="text-xs text-gray-600">(空)</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-600">→</span>
                      <span className={`text-xs ${canDo ? 'text-purple-400' : 'text-gray-600'}`}>
                        +{level} 术法点
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Cancel button */}
          <button
            onClick={onCancel}
            className="w-full px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors text-sm"
          >取消</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
