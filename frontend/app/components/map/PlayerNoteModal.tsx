/**
 * PlayerNoteModal - Simple modal for players to record notes about tokens
 * Notes are stored in localStorage per campaign/token
 */
import { useState, useEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { Token } from "./types/TacticalMapTypes";

interface PlayerNoteModalProps {
  token: Token | null;
  isOpen: boolean;
  campaignId: string;
  onClose: () => void;
}

// LocalStorage key format: player_notes_{campaignId}_{tokenId}
function getNoteKey(campaignId: string, tokenId: number): string {
  return `player_notes_${campaignId}_${tokenId}`;
}

export function PlayerNoteModal({ token, isOpen, campaignId, onClose }: PlayerNoteModalProps) {
  const [note, setNote] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load note from localStorage when modal opens
  useEffect(() => {
    if (isOpen && token) {
      const key = getNoteKey(campaignId, token.id);
      const savedNote = localStorage.getItem(key) || "";
      setNote(savedNote);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen, token, campaignId]);

  // Save note to localStorage
  const handleSave = () => {
    if (token) {
      const key = getNoteKey(campaignId, token.id);
      if (note.trim()) {
        localStorage.setItem(key, note);
      } else {
        localStorage.removeItem(key);
      }
    }
    onClose();
  };

  if (!token) return null;

  const tokenName = token.instance_name ||
    (token as any).character_name ||
    (token as any).monster_name ||
    "未命名";

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) handleSave(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[9998]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-md bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-[9999]"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
            <Dialog.Title className="text-lg font-medium text-white">
              关于 <span className="text-amber-400">{tokenName}</span> 的笔记
            </Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors">
              ✕
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className="p-4">
            <textarea
              ref={textareaRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="记录你对这个角色/怪物的观察、猜测、策略..."
              className="w-full h-48 bg-gray-800 border border-gray-600 rounded-lg p-3 text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-amber-500"
            />
            <p className="mt-2 text-xs text-gray-500">
              笔记仅保存在本地浏览器，其他玩家无法看到
            </p>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-gray-700 flex justify-end gap-2">
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium"
            >
              保存
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
