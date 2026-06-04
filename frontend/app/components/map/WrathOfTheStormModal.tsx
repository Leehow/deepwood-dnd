import * as Dialog from '@radix-ui/react-dialog';

export type WrathOfTheStormDamageType = 'lightning' | 'thunder';

const DAMAGE_OPTIONS: Array<{
  id: WrathOfTheStormDamageType;
  label: string;
  description: string;
  icon: string;
  colorClass: string;
}> = [
  {
    id: 'lightning',
    label: '闪电',
    description: '目标进行敏捷豁免，失败受 2d8 闪电伤害，成功减半',
    icon: '⚡',
    colorClass: 'border-yellow-600/60 bg-yellow-900/20 text-yellow-100',
  },
  {
    id: 'thunder',
    label: '雷鸣',
    description: '目标进行敏捷豁免，失败受 2d8 雷鸣伤害，成功减半',
    icon: '🌩️',
    colorClass: 'border-indigo-600/60 bg-indigo-900/20 text-indigo-200',
  },
];

interface Props {
  open: boolean;
  sourceName: string;
  targetName: string;
  onCancel: () => void;
  onConfirm: (damageType: WrathOfTheStormDamageType) => void;
}

export function WrathOfTheStormModal({
  open,
  sourceName,
  targetName,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[260]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                     w-[92vw] max-w-lg max-h-[85dvh] overflow-hidden
                     bg-gray-900 border border-sky-700/60 rounded-xl shadow-2xl z-[261]
                     flex flex-col"
        >
          <div className="px-5 py-4 border-b border-gray-700 bg-sky-900/20">
            <Dialog.Title className="text-lg font-semibold text-sky-200">
              风暴之怒
            </Dialog.Title>
            <div className="text-xs text-gray-400 mt-1">
              {sourceName} 准备反击 {targetName}。选择本次要释放的伤害类型。
            </div>
          </div>

          <div className="px-5 py-4 space-y-3">
            {DAMAGE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onConfirm(option.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors hover:brightness-110 ${option.colorClass}`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{option.icon}</span>
                  <div>
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="text-xs opacity-80 mt-1">{option.description}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="px-5 py-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onCancel}
              className="w-full px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors text-sm"
            >
              取消
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
