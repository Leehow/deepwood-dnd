import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { Currency } from "../../types/Character";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currencyLocal: Currency;
  setCurrencyLocal: (updater: (prev: Currency) => Currency) => void;
  handleSaveCurrency: () => void;
}

export function CurrencyDialog({ open, onOpenChange, currencyLocal, setCurrencyLocal, handleSaveCurrency }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[10198]" />
        <Dialog.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl z-[10200] w-[95vw] max-w-[420px] p-4">
          <div className="flex items-center justify-between mb-3">
            <Dialog.Title className="text-lg font-semibold text-gray-200">编辑钱币</Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>
          <div className="grid grid-cols-2 gap-3">
          {(["gp","sp","ep","cp","pp"] as const).map((u) => (
            <label key={u} className="text-sm text-gray-300">
              {u.toUpperCase()}：
              <input
                type="number"
                min={0}
                value={(currencyLocal?.[u] ?? 0)}
                onChange={(e) => setCurrencyLocal((prev) => ({ ...(prev || {}), [u]: Math.max(0, parseInt(e.target.value || "0")) }))}
                className="mt-1 w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
              />
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Dialog.Close asChild>
            <button className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded">取消</button>
          </Dialog.Close>
          <button className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 rounded text-white" onClick={handleSaveCurrency}>
保存
          </button>
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

