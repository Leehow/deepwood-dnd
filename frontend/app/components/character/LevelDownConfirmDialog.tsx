import * as Dialog from "@radix-ui/react-dialog";

interface LevelDownConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLevel: number;
  onConfirm: () => void;
}

export function LevelDownConfirmDialog({
  open,
  onOpenChange,
  currentLevel,
  onConfirm
}: LevelDownConfirmDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md z-50 border border-gray-700">
          <Dialog.Title className="text-xl font-bold text-white flex items-center gap-2 mb-4">
            <span className="text-2xl">⚠️</span>
            <span>确认回退等级</span>
          </Dialog.Title>

          <div className="space-y-4 text-gray-300">
            <p className="text-base">
              你确定要将角色回退到 <span className="font-bold text-amber-400">{currentLevel - 1} 级</span>吗？
            </p>

            <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-4 space-y-2">
              <p className="text-sm text-red-300 font-semibold">此操作将撤销：</p>
              <ul className="text-sm text-red-200 space-y-1 list-disc list-inside">
                <li>最近一次升级时选择的所有法术</li>
                <li>属性值提升（ASI）的加点</li>
                <li>新获得的职业特性</li>
                <li>专精技能的选择</li>
              </ul>
            </div>

            <p className="text-sm text-gray-400">
              角色将恢复到上一级的状态，包括属性、法术、技能等所有数据。
            </p>
          </div>

          <div className="flex gap-3 mt-6 justify-end">
            <button
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors font-semibold"
            >
              确认回退
            </button>
          </div>

          <Dialog.Close asChild>
            <button
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
              aria-label="关闭"
            >
              ✕
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

