/**
 * IllusionEditModal — 允许施法者或DM修改幻象token的外观图片
 * 支持AI生成新图片或从历史幻象库选择
 * disguiseMode: 支持修改易容术等伪装外观（可塑幻象特性）
 */
import { useState, useEffect, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { apiFetch } from "~/utils/api-client";
import type { Token } from "./types/TacticalMapTypes";

interface IllusionEditModalProps {
  token: Token | null;
  campaignId: string;
  disguiseMode?: boolean;
  onClose: () => void;
  onUpdated: (tokenId: number, imageUrl: string, displayName?: string) => void;
}

export function IllusionEditModal({ token, campaignId, disguiseMode, onClose, onUpdated }: IllusionEditModalProps) {
  const [mode, setMode] = useState<'generate' | 'library'>('generate');
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [libraryImages, setLibraryImages] = useState<{ id: number; url: string; name: string }[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const itemData = token?.item_data;
  const disguiseData = token?.disguise_data;
  const currentImage = disguiseMode
    ? disguiseData?.disguise_avatar
    : (itemData?.avatar_url || itemData?.icon);
  const currentDesc = disguiseMode
    ? disguiseData?.description
    : (itemData?.description || token?.instance_name);
  const spellId = disguiseMode
    ? disguiseData?.spell_id
    : (itemData?.spell_id || 'silent_image');

  // Load library on tab switch
  const loadLibrary = useCallback(async () => {
    if (libraryLoaded) return;
    try {
      const resp = await apiFetch('/api/spells/illusion-library');
      if (resp.ok) {
        const data = await resp.json();
        setLibraryImages(data.avatars || []);
      }
    } catch { /* ignore */ }
    setLibraryLoaded(true);
  }, [libraryLoaded]);

  useEffect(() => {
    if (mode === 'library') loadLibrary();
  }, [mode, loadLibrary]);

  const handleGenerate = async () => {
    if (!description.trim() || isGenerating) return;
    setIsGenerating(true);
    try {
      const resp = await apiFetch('/api/spells/generate-illusion-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          spell_id: spellId,
          campaign_id: campaignId ? parseInt(campaignId) : 0,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setPreviewUrl(data.image_url);
        if (data.display_name) setDisplayName(data.display_name);
      }
    } catch { /* ignore */ }
    setIsGenerating(false);
  };

  const handleSave = async () => {
    if (!token || !previewUrl) return;
    setSaving(true);
    try {
      const endpoint = disguiseMode
        ? `/api/tokens/${token.id}/disguise-image`
        : `/api/tokens/${token.id}/illusion-image`;
      const resp = await apiFetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: previewUrl,
          description: description.trim() || undefined,
          display_name: displayName.trim() || undefined,
        }),
      });
      if (resp.ok) {
        onUpdated(token.id, previewUrl, displayName.trim() || undefined);
        onClose();
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  // Guard: illusion token or disguise token
  if (!token) return null;
  if (!disguiseMode && (!itemData || itemData.type !== 'illusion')) return null;
  if (disguiseMode && !disguiseData) return null;

  const title = disguiseMode ? '改变伪装外观' : '改变幻象外观';
  const icon = disguiseMode ? '🎭' : '🌀';

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[9999]" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10000]
          w-[360px] max-h-[80vh] overflow-y-auto
          bg-gradient-to-b from-[#1a1025] to-[#0d0a14] border border-purple-700/30
          rounded-xl shadow-2xl shadow-purple-900/30 p-4">

          <Dialog.Title className="text-sm font-semibold text-purple-200 mb-3 flex items-center gap-2">
            <span className="text-base">{icon}</span>
            {title}
            <span className="text-[10px] text-purple-400/50 ml-auto">{token.instance_name || token.character_name}</span>
          </Dialog.Title>

          {/* Current image */}
          <div className="flex items-center gap-3 mb-3 p-2 rounded-lg bg-black/20 border border-purple-800/20">
            {currentImage && (
              <img src={currentImage} alt="当前外观" className="w-14 h-14 rounded-lg object-cover border border-purple-700/30" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-purple-400/60">当前外观</div>
              <div className="text-xs text-purple-200/80 truncate">{currentDesc}</div>
            </div>
            {previewUrl && (
              <>
                <span className="text-purple-500/50 text-lg">→</span>
                <img src={previewUrl} alt="新外观" className="w-14 h-14 rounded-lg object-cover border-2 border-purple-500/50" />
              </>
            )}
          </div>

          {/* Mode tabs */}
          <div className="flex gap-1 mb-3">
            {(['generate', 'library'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-1 rounded text-[11px] font-medium transition-all
                  ${mode === m
                    ? 'bg-purple-700/30 text-purple-200 border border-purple-500/30'
                    : 'bg-black/20 text-purple-400/50 border border-transparent hover:text-purple-300/70'
                  }`}
              >
                {m === 'generate' ? '✨ AI 生成' : '📚 历史图库'}
              </button>
            ))}
          </div>

          {/* Generate mode */}
          {mode === 'generate' && (
            <div className="space-y-2">
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={disguiseMode ? "描述新的伪装外观..." : "描述新的幻象外观..."}
                rows={2}
                className="w-full px-2.5 py-2 rounded-md text-xs bg-black/20 border border-purple-700/20
                  text-purple-100/90 placeholder-purple-400/30 resize-none
                  focus:border-purple-500/40 focus:outline-none focus:ring-1 focus:ring-purple-500/20"
              />
              <button
                onClick={handleGenerate}
                disabled={!description.trim() || isGenerating}
                className="w-full py-1.5 rounded-md text-[11px] font-medium transition-all
                  bg-gradient-to-r from-purple-800/25 via-purple-700/30 to-purple-800/25
                  border border-purple-600/25 text-purple-200/70
                  hover:from-purple-700/30 hover:via-purple-600/35 hover:to-purple-700/30
                  hover:border-purple-500/35 hover:text-purple-100
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isGenerating ? '生成中...' : '✨ 生成新外观'}
              </button>
            </div>
          )}

          {/* Library mode */}
          {mode === 'library' && (
            <div>
              {libraryImages.length === 0 ? (
                <p className="text-[10px] text-purple-400/40 text-center py-4">暂无历史幻象图片</p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5 max-h-[200px] overflow-y-auto">
                  {libraryImages.map(img => (
                    <button
                      key={img.id}
                      onClick={() => { setPreviewUrl(img.url); setDisplayName(img.name || ''); }}
                      className={`relative rounded-md overflow-hidden border transition-all aspect-square
                        ${previewUrl === img.url
                          ? 'border-purple-400 ring-1 ring-purple-400/50'
                          : 'border-purple-800/30 hover:border-purple-600/40'
                        }`}
                    >
                      <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Display name */}
          {previewUrl && (
            <div className="mt-3">
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder={disguiseMode ? "伪装名称（可选）" : "幻象名称（可选）"}
                className="w-full px-2.5 py-1.5 rounded-md text-xs bg-black/20 border border-purple-700/20
                  text-purple-100/90 placeholder-purple-400/30
                  focus:border-purple-500/40 focus:outline-none focus:ring-1 focus:ring-purple-500/20"
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={onClose}
              className="flex-1 py-1.5 rounded-md text-[11px] font-medium
                bg-black/20 border border-gray-700/30 text-gray-400
                hover:bg-black/30 hover:text-gray-300 transition-all"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!previewUrl || saving}
              className="flex-1 py-1.5 rounded-md text-[11px] font-medium transition-all
                bg-gradient-to-r from-purple-700/40 to-violet-700/40
                border border-purple-500/30 text-purple-100
                hover:from-purple-600/50 hover:to-violet-600/50
                disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {saving ? '保存中...' : '确认变更'}
            </button>
          </div>

          <Dialog.Close asChild>
            <button className="absolute top-3 right-3 text-purple-400/40 hover:text-purple-300 transition-colors"
              aria-label="Close">
              ✕
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
