import * as Dialog from "@radix-ui/react-dialog";
import { useState, useEffect } from "react";

interface GridUnitSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentValue: number;
  onSave: (value: number) => void;
}

export function GridUnitSettingsDialog({
  open,
  onOpenChange,
  currentValue,
  onSave,
}: GridUnitSettingsDialogProps) {
  const [value, setValue] = useState(currentValue);

  // 当对话框打开时，重置为当前值
  useEffect(() => {
    if (open) {
      setValue(currentValue);
    }
  }, [open, currentValue]);

  const handleSave = () => {
    if (value > 0) {
      onSave(value);
      onOpenChange(false);
    }
  };

  const presetValues = [5, 10, 15, 30]; // 常用值

  // 英尺转米（1 ft ≈ 0.3048 m）
  const toMeters = (feet: number) => (feet * 0.3048).toFixed(1);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[200]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gray-800 rounded-lg p-6 shadow-xl z-[201] w-96">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-white">
              设置网格单位长度
            </Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          {/* 说明文字 */}
          <div className="mb-4 p-3 bg-gray-700/50 rounded text-sm text-gray-300">
            <p className="mb-1">💡 <strong>网格比例说明：</strong></p>
            <p>设置每个网格格子代表的实际距离。</p>
            <p className="mt-1 text-xs text-gray-400">
              • 标准室内战斗：5英尺/格<br/>
              • 中大型场景：10-15英尺/格<br/>
              • 超大型场景：30英尺/格
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-2">
                每格代表多少英尺？（公制单位见下方）
              </label>
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={value}
                onChange={(e) => setValue(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">
                常用值：
              </label>
              <div className="grid grid-cols-2 gap-2">
                {presetValues.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setValue(preset)}
                    className={`px-3 py-2 rounded transition-colors flex flex-col items-center ${
                      value === preset
                        ? "bg-amber-600 hover:bg-amber-700 text-white"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                    }`}
                  >
                    <span className="font-bold">{preset} ft</span>
                    <span className="text-xs opacity-75">≈ {toMeters(preset)} m</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="text-sm bg-gray-700/30 p-3 rounded">
              <div className="text-gray-300 mb-1">
                <strong>当前设置:</strong>
              </div>
              <div className="text-amber-400 font-bold">
                每格 = {value} 英尺 (≈ {toMeters(value)} 米)
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Dialog.Close asChild>
              <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors">
                取消
              </button>
            </Dialog.Close>
            <button
              onClick={handleSave}
              disabled={value <= 0}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              保存
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
