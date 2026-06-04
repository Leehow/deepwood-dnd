import * as Dialog from "@radix-ui/react-dialog";

interface ResetToLevel1ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLevel: number;
  onConfirm: () => void;
}

export function ResetToLevel1ConfirmDialog({
  open,
  onOpenChange,
  currentLevel,
  onConfirm
}: ResetToLevel1ConfirmDialogProps) {
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
            <span className="text-2xl">🔄</span>
            <span>确认恢复到1级</span>
          </Dialog.Title>

          <div className="space-y-4 text-gray-300">
            <p className="text-base">
              你确定要将角色从 <span className="font-bold text-red-400">{currentLevel} 级</span> 恢复到 <span className="font-bold text-amber-400">1 级</span>吗？
            </p>

            <div className="bg-orange-900/30 border border-orange-700/50 rounded-lg p-4 space-y-2">
              <p className="text-sm text-orange-300 font-semibold">此操作将重置：</p>
              <ul className="text-sm text-orange-200 space-y-1 list-disc list-inside">
                <li>所有等级提升后选择的法术</li>
                <li>所有属性值提升（ASI）的加点</li>
                <li>所有高于1级的职业特性</li>
                <li>所有专精技能的选择</li>
                <li>生命值恢复到1级状态</li>
                <li>法术位恢复到1级状态</li>
              </ul>
            </div>

            <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-4">
              <p className="text-sm text-yellow-300 font-semibold">⚠️ 警告：</p>
              <p className="text-sm text-yellow-200">
                这是一个重大操作，将清除角色的所有成长历程。如果只是想撤销最近的升级，请使用"回退"功能。
              </p>
            </div>

            <p className="text-sm text-gray-400">
              角色将完全恢复到1级的初始状态，只保留种族、背景和初始属性。
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
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded transition-colors font-semibold"
            >
              确认恢复到1级
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