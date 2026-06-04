import * as Dialog from "@radix-ui/react-dialog";

interface ProficiencyHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "weapon" | "armor";
}

export function ProficiencyHelpDialog({ open, onOpenChange, type }: ProficiencyHelpDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[10198]" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-xl bg-gray-900 border border-gray-700 rounded p-6 space-y-4 z-[10200]">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold text-amber-300">
              {type === "weapon" ? "武器熟练说明" : "护甲/盾牌熟练说明"}
            </Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          <div className="text-sm text-gray-300 space-y-2">
            {type === "weapon" ? (
              <>
                <p>熟练使用某类武器时，使用该武器进行攻击检定可以添加熟练加值。</p>
                <p>如果未熟练，则不能添加熟练加值，命中率会降低。</p>
                <p>• 提示：职业、种族、专长、背景等可能授予不同武器的熟练。</p>
              </>
            ) : (
              <>
                <p>熟练穿戴某类护甲或使用盾牌时，穿戴它们不会造成施法或行动上的不利影响。</p>
                <p>如果未熟练穿戴护甲/盾牌，可能在进行敏捷检定、体质(专注)检定时处于劣势等。</p>
                <p>• 提示：不同护甲类别需要分别获得熟练，部分职业/子职业/专长可授予。</p>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              onClick={() => onOpenChange(false)}
            >
              知道了
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

