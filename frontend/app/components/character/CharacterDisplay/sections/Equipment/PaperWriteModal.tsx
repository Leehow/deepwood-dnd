import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { EquipmentItem } from "../../types/Character";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  paper: EquipmentItem;
  /** If provided, we're editing an existing written paper */
  initialContent?: string;
  onConfirm: (content: string) => Promise<void>;
}

export function PaperWriteModal({ open, onOpenChange, paper, initialContent, onConfirm }: Props) {
  const [content, setContent] = useState(initialContent || '');
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const isEditing = !!initialContent;

  useEffect(() => {
    if (open) setContent(initialContent || '');
  }, [open, initialContent]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onOpenChange]);

  const firstLine = content.trim().split('\n')[0]?.slice(0, 30) || '';
  const baseName = (paper.sourceItemName || paper.name || '').replace(/\s*[xX×]\s*\d+$/i, '').trim();
  const previewName = firstLine ? `${firstLine}（${baseName}）` : '';

  const handleSave = async () => {
    if (!content.trim() || saving) return;
    setSaving(true);
    try {
      await onConfirm(content);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10200] flex items-center justify-center"
      onMouseDown={e => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div className="fixed inset-0 bg-black/60" />
      <div
        ref={panelRef}
        className="relative w-[92vw] max-w-md bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3 z-[10201]"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-amber-300 flex items-center gap-2">
          <span>✏️</span>
          <span>{isEditing ? '编辑内容' : `在 ${baseName} 上书写`}</span>
        </div>

        {previewName && (
          <div className="text-xs text-gray-400">
            物品名称预览: <span className="text-amber-200/70">{previewName}</span>
          </div>
        )}

        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={"在此书写内容...\n第一行将作为文件标题"}
          className="w-full h-40 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-amber-500/50"
          autoFocus
        />

        <div className="text-[11px] text-gray-500">
          第一行将作为文件标题显示在物品名称中，支持 Markdown 格式
        </div>

        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
            onClick={() => onOpenChange(false)}
          >
            取消
          </button>
          <button
            className="px-4 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 text-white rounded disabled:opacity-50"
            onClick={handleSave}
            disabled={!content.trim() || saving}
          >
            {saving ? '保存中...' : isEditing ? '保存' : '书写'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
