import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

interface InvokeDuplicityModalProps {
  open: boolean;
  sourceName?: string;
  maxDuplicates: number;
  onCancel: () => void;
  onConfirm: (count: number) => void;
}

export function InvokeDuplicityModal({
  open,
  sourceName,
  maxDuplicates,
  onCancel,
  onConfirm,
}: InvokeDuplicityModalProps) {
  const [count, setCount] = useState(1);

  useEffect(() => {
    if (!open) return;
    setCount(1);
  }, [open, maxDuplicates]);

  const normalizedCount = Math.min(Math.max(count, 1), Math.max(maxDuplicates, 1));

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[1200]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-indigo-700/40 bg-gray-900 shadow-2xl z-[1201] p-4 text-gray-100">
          <Dialog.Title className="text-lg font-semibold text-indigo-300">
            诡术通道
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-400">
            {sourceName || "该角色"} 将在 30 尺内创造幻影分身，并以专注维持 1 分钟。
          </Dialog.Description>

          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: maxDuplicates }, (_, index) => {
                const value = index + 1;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCount(value)}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                      normalizedCount === value
                        ? "border-indigo-500 bg-indigo-500/20 text-indigo-200"
                        : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    {value} 个
                  </button>
                );
              })}
            </div>

            <label className="block">
              <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">分身数量</div>
              <input
                type="number"
                min={1}
                max={maxDuplicates}
                value={normalizedCount}
                onChange={(event) => setCount(parseInt(event.target.value || "1", 10))}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
              />
            </label>

            <div className="rounded-lg border border-indigo-700/30 bg-indigo-950/30 px-3 py-2 text-sm text-gray-300">
              <div className="text-indigo-200">下一步会进入地图放置模式</div>
              <div className="mt-1 text-xs text-gray-400">
                逐个点击地图格子放置分身。分身创建后可由玩家拖动，并会在专注结束时自动消失。
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => onConfirm(normalizedCount)}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
            >
              开始放置
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
