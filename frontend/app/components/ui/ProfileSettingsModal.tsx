import * as Dialog from "@radix-ui/react-dialog";
import { Cross2Icon, ShuffleIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import { apiFetch } from "~/utils/api-client";

const PRESET_NAMES = [
  "艾尔文", "索拉丝", "莱格拉斯", "甘道夫", "崔斯特",
  "布琳达", "阿拉贡", "金妮", "坦尼斯", "沃金",
  "暗影刃", "星辉", "铁锤", "月影", "霜刃",
  "龙息", "风语者", "石心", "灵火", "冰狼",
  "深渊行者", "奥术师", "银角", "暮光", "晨曦",
  "荆棘", "蛛网", "裂隙", "幽灵", "战歌",
];

interface ProfileSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  userId: string;
  onSave: (newName: string) => void;
}

export function ProfileSettingsModal({
  open,
  onOpenChange,
  currentName,
  userId,
  onSave,
}: ProfileSettingsModalProps) {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleRandomPick = () => {
    const idx = Math.floor(Math.random() * PRESET_NAMES.length);
    setName(PRESET_NAMES[idx]);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("名称不能为空");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/users/${userId}/display-name`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "保存失败");
        return;
      }
      onSave(trimmed);
      onOpenChange(false);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[100]" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-[90vw] max-w-md rounded-xl p-6"
          style={{
            background: "linear-gradient(180deg, #1a1d24 0%, #14161b 100%)",
            border: "1px solid rgba(212,175,105,0.2)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }}
        >
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-lg font-semibold text-amber-100">
              个人设置
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-gray-500 hover:text-gray-300 transition-colors">
                <Cross2Icon width={18} height={18} />
              </button>
            </Dialog.Close>
          </div>

          {/* Name input */}
          <label className="block text-sm text-gray-400 mb-2">
            显示名称
          </label>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              maxLength={100}
              placeholder="输入你的冒险者名称..."
              className="flex-1 px-3 py-2 rounded-lg text-sm text-gray-100 placeholder-gray-600 outline-none transition-colors focus:border-amber-600"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
            <button
              type="button"
              onClick={handleRandomPick}
              title="随机抽取"
              className="px-3 py-2 rounded-lg text-amber-400 hover:text-amber-300 hover:bg-amber-900/20 transition-colors"
              style={{ border: "1px solid rgba(212,175,105,0.2)" }}
            >
              <ShuffleIcon width={16} height={16} />
            </button>
          </div>

          {/* Preset names */}
          <label className="block text-sm text-gray-400 mb-2">
            预设名称
          </label>
          <div className="flex flex-wrap gap-1.5 mb-5 max-h-36 overflow-y-auto pr-1">
            {PRESET_NAMES.map((preset) => (
              <button
                key={preset}
                onClick={() => { setName(preset); setError(""); }}
                className={`px-2.5 py-1 rounded text-xs transition-all ${
                  name === preset
                    ? "bg-amber-600/30 text-amber-200 border-amber-500/50"
                    : "text-gray-400 hover:text-amber-200 hover:bg-gray-800/80 border-gray-700/50"
                }`}
                style={{ border: "1px solid" }}
              >
                {preset}
              </button>
            ))}
          </div>

          {error && (
            <p className="text-red-400 text-xs mb-3">{error}</p>
          )}

          {/* Action buttons */}
          <div className="flex justify-end gap-2">
            <Dialog.Close asChild>
              <button className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-colors">
                取消
              </button>
            </Dialog.Close>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium text-black transition-colors disabled:opacity-50"
              style={{
                background: "linear-gradient(135deg, #d4af69 0%, #b8860b 100%)",
              }}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
