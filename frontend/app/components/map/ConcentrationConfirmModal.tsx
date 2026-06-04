/**
 * ConcentrationConfirmModal
 * Shown when a caster tries to cast a new concentration spell while already concentrating
 */

import { Dialog } from "@radix-ui/react-dialog";
import type { ConcentrationSpell } from "./types/TacticalMapTypes";

interface ConcentrationConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  currentSpell: ConcentrationSpell;
  newSpellName: string;
  newSpellLevel: number;
}

export function ConcentrationConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  currentSpell,
  newSpellName,
  newSpellLevel,
}: ConcentrationConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-900 border-2 border-purple-500/50 rounded-xl shadow-2xl shadow-purple-500/20 p-6 max-w-md w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">⚠️</span>
          <h2 className="text-xl font-bold text-yellow-400">专注将被打断</h2>
        </div>

        {/* Current Spell */}
        <div className="bg-gray-800/50 rounded-lg p-4 mb-4 border border-purple-500/30">
          <div className="text-sm text-gray-400 mb-1">当前专注</div>
          <div className="flex items-center gap-2">
            <span className="text-xl">👁️</span>
            <span className="text-lg font-semibold text-purple-400">
              {currentSpell.spell_name}
            </span>
            {currentSpell.slot_level > 0 && (
              <span className="text-sm text-gray-500">
                ({currentSpell.slot_level}环)
              </span>
            )}
          </div>
        </div>

        {/* New Spell */}
        <div className="bg-gray-800/50 rounded-lg p-4 mb-4 border border-blue-500/30">
          <div className="text-sm text-gray-400 mb-1">即将施放</div>
          <div className="flex items-center gap-2">
            <span className="text-xl">✨</span>
            <span className="text-lg font-semibold text-blue-400">
              {newSpellName}
            </span>
            {newSpellLevel > 0 && (
              <span className="text-sm text-gray-500">({newSpellLevel}环)</span>
            )}
          </div>
        </div>

        {/* Warning */}
        <p className="text-gray-400 text-sm mb-6">
          施放新的专注法术将<span className="text-red-400 font-medium">终止</span>当前的专注效果。
          确定要继续吗？
        </p>

        {/* Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors"
          >
            确认施放
          </button>
        </div>
      </div>
    </div>
  );
}
