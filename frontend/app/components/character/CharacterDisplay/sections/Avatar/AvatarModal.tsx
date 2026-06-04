import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { apiFetch } from "~/utils/api-client";
import { createLogger } from '~/utils/logger';

const logger = createLogger('AvatarModal');

interface AvatarModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  character: {
    id?: number;
    name: string;
    avatar?: string | null;
  };
  userId: string;
  /** userId for querying avatar library (defaults to userId). Pass DM's real userId for virtual characters. */
  libraryUserId?: string;
  /** Extra avatar URLs to include in the library (e.g. from campaign roster). Merged with user's own avatars. */
  campaignAvatars?: string[];
  genLoading: boolean;
  handleGenerateAvatar: (expressionDesc?: string) => Promise<void>;
  handleUploadAvatar: () => void;
  onAvatarUpdated?: () => void;
  /** Wizard mode: when provided, avatar selection calls this callback instead of saving via API */
  onAvatarSelected?: (avatar: string) => void;
}

export function AvatarModal({
  open,
  onOpenChange,
  character,
  userId,
  libraryUserId,
  campaignAvatars,
  genLoading,
  handleGenerateAvatar,
  handleUploadAvatar,
  onAvatarUpdated,
  onAvatarSelected,
}: AvatarModalProps) {
  void libraryUserId;
  void userId;
  const [avatarLibrary, setAvatarLibrary] = useState<{ id?: number; url: string }[]>([]);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [expressionInput, setExpressionInput] = useState('');

  const loadAvatarLibrary = async () => {
    try {
      // Load from persistent avatar library
      const resp = await apiFetch("/api/characters/avatar-library");
      const libraryItems: { id: number; url: string }[] = [];
      if (resp.ok) {
        const entries = await resp.json();
        entries.forEach((e: { id: number; avatar_url: string }) => {
          if (e.avatar_url) libraryItems.push({ id: e.id, url: e.avatar_url });
        });
      }
      // Merge with campaign avatars (no id, can't delete), deduplicate
      const seen = new Set(libraryItems.map(i => i.url));
      const campaignItems = (campaignAvatars || [])
        .filter(url => !seen.has(url) && url !== character.avatar)
        .map(url => ({ url }));
      // Exclude current avatar
      const filtered = libraryItems.filter(i => i.url !== character.avatar);
      setAvatarLibrary([...filtered, ...campaignItems]);
    } catch (e) {
      logger.error("Failed to load avatar library:", e);
    }
  };

  const deleteAvatar = async (item: { id?: number; url: string }, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.id) return;
    if (!confirm("确定要删除这个头像吗？")) return;
    setDeleting(item.id);
    try {
      const resp = await apiFetch(`/api/characters/avatar-library/${item.id}`, { method: "DELETE" });
      if (resp.ok) {
        setAvatarLibrary(prev => prev.filter(a => a.id !== item.id));
      }
    } catch (e) {
      logger.error("Failed to delete avatar:", e);
    } finally {
      setDeleting(null);
    }
  };

  const selectAvatarFromLibrary = async (avatarUrl: string) => {
    // Wizard mode: use callback instead of API
    if (onAvatarSelected) {
      onAvatarSelected(avatarUrl);
      onOpenChange(false);
      setAvatarLibrary([]);
      return;
    }
    try {
      const patch = await apiFetch(`/api/characters/${character.id}/avatar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: avatarUrl }),
        userId,
      });
      if (patch.ok) {
        onAvatarUpdated?.();
        onOpenChange(false);
        setAvatarLibrary([]);
      }
    } catch (e) {
      logger.error("Failed to set avatar:", e);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[10198]" onClick={e => e.stopPropagation()} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-2xl bg-gray-900 border border-gray-700 rounded p-6 space-y-4 z-[10200]"
          onPointerDownOutside={e => e.stopPropagation()}
          onInteractOutside={e => e.stopPropagation()}
        >
          <Dialog.Title className="text-lg font-semibold text-gray-300">角色头像</Dialog.Title>

          {/* Current Avatar Display */}
          {character.avatar && (
            <div className="flex justify-center">
              <img
                src={character.avatar}
                alt={character.name}
                className="max-w-md max-h-96 rounded-lg border-2 border-amber-400 object-contain"
              />
            </div>
          )}

          {/* Avatar Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              className="btn-secondary text-sm py-2.5"
              onClick={() => {
                handleUploadAvatar();
                onOpenChange(false);
              }}
            >
              📤 上传图片
            </button>
            <button
              className="btn-primary text-sm py-2.5"
              onClick={async () => {
                await handleGenerateAvatar(expressionInput.trim() || undefined);
                onOpenChange(false);
                setExpressionInput('');
              }}
              disabled={genLoading}
            >
              {genLoading ? "生成中..." : "🎨 AI生成"}
            </button>
            <button
              className="btn-secondary text-sm py-2.5"
              onClick={loadAvatarLibrary}
            >
              📚 头像库
            </button>
          </div>

          {/* Expression / Mood Input */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">表情/情绪描述（可选，留空则使用默认表情）</label>
            <input
              type="text"
              className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:border-amber-500 focus:outline-none"
              placeholder="如：微笑、怒目圆睁、若有所思、战斗姿态"
              value={expressionInput}
              onChange={e => setExpressionInput(e.target.value)}
              disabled={genLoading}
            />
          </div>

          {/* Avatar Library Grid */}
          {avatarLibrary.length > 0 && (
            <div>
              <div className="text-sm text-gray-400 mb-2">选择已有头像：</div>
              <div className="grid grid-cols-4 md:grid-cols-6 gap-2 max-h-64 overflow-auto">
                {avatarLibrary.map((item, idx) => (
                  <div key={idx} className="relative group">
                    <button
                      className="aspect-square w-full rounded border-2 border-gray-700 hover:border-amber-400 overflow-hidden transition-colors"
                      onClick={() => selectAvatarFromLibrary(item.url)}
                    >
                      <img src={item.url} alt={`头像 ${idx + 1}`} className="w-full h-full object-cover" />
                    </button>
                    {item.id && (
                      <button
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow"
                        onClick={(e) => deleteAvatar(item, e)}
                        disabled={deleting === item.id}
                        title="删除头像"
                      >
                        {deleting === item.id ? "..." : "✕"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-right">
            <button
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              onClick={() => {
                onOpenChange(false);
                setAvatarLibrary([]);
                setExpressionInput('');
              }}
            >
              关闭
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
