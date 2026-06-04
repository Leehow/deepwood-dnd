import * as Dialog from "@radix-ui/react-dialog";

interface Item { label: string; value: number; }

export interface StatBreakdownData {
  title: string;
  final: number;
  items: Item[];
  unit?: string; // e.g., "尺", or prefix like "+"; or "dice" to show XdY
  diceSize?: number; // used when unit === "dice"
  description?: string; // 说明文字，帮助新手理解该属性
  warning?: string; // 醒目警告（力竭/状态条件等）
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: StatBreakdownData | null;
}

export function StatBreakdownDialog({ open, onOpenChange, data }: Props) {
  const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  if (!data) return null;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[10198]" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-xl bg-gray-900 border border-gray-700 rounded p-6 space-y-4 z-[10200]">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold text-amber-300">{data.title}</Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          {data.description && (
            <p className="text-xs text-gray-400 leading-relaxed">{data.description}</p>
          )}

          <div className="bg-gray-800/50 rounded p-3">
            <div className="text-xs text-gray-400">最终结果</div>
            <div className="text-2xl font-bold text-white">
              {data.unit === "ft"
                ? `${data.final} 尺`
                : data.unit === "+"
                  ? fmt(data.final)
                  : data.unit === "dice"
                    ? `${data.final}d${data.diceSize ?? ''}`
                    : data.final}
            </div>
          </div>

          <div className="space-y-2 text-sm">
            {data.items.map((it, idx) => (
              <div key={idx} className="flex items-center justify-between bg-gray-800/30 border border-gray-700/50 rounded px-3 py-2">
                <span className="text-gray-300">{it.label}</span>
                <span className={`font-mono ${it.value >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(it.value)}</span>
              </div>
            ))}
          </div>

          {data.warning && (
            <div className="flex items-start gap-2 bg-red-900/30 border border-red-700/50 rounded px-3 py-2 text-sm text-red-300">
              <span className="shrink-0">⚠️</span>
              <span>{data.warning}</span>
            </div>
          )}

          <div className="flex justify-end">
            <button className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm" onClick={() => onOpenChange(false)}>关闭</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

