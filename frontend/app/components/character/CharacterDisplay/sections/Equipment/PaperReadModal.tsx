import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { ScrollFrame, SpellDivider } from "../Spells/SpellbookSvg";
import type { EquipmentItem } from "../../types/Character";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: EquipmentItem;
  onEdit?: () => void;
  onCopy?: () => void;
}

const mdComponents = {
  h1: (p: any) => <h1 className="text-amber-100/85 text-base font-bold mt-2 mb-1" {...p} />,
  h2: (p: any) => <h2 className="text-amber-100/80 text-sm font-bold mt-2 mb-1" {...p} />,
  h3: (p: any) => <h3 className="text-amber-100/75 text-sm font-semibold mt-1.5 mb-0.5" {...p} />,
  p: (p: any) => <p className="text-amber-100/65 text-sm leading-relaxed mb-2" {...p} />,
  ul: (p: any) => <ul className="list-disc list-inside text-amber-100/65 text-sm space-y-0.5 mb-2" {...p} />,
  ol: (p: any) => <ol className="list-decimal list-inside text-amber-100/65 text-sm space-y-0.5 mb-2" {...p} />,
  li: (p: any) => <li className="text-amber-100/65" {...p} />,
  strong: (p: any) => <strong className="text-amber-200/80 font-semibold" {...p} />,
  em: (p: any) => <em className="text-amber-100/70 italic" {...p} />,
  blockquote: (p: any) => <blockquote className="border-l-2 border-amber-700/50 pl-3 my-2 text-amber-100/50 italic text-sm" {...p} />,
  hr: () => <SpellDivider />,
  code: (p: any) => <code className="bg-amber-950/40 px-1 py-0.5 rounded text-amber-200/70 text-xs" {...p} />,
};

export function PaperReadModal({ open, onOpenChange, item, onEdit, onCopy }: Props) {
  const content = item.writtenContent || item.description || '';
  const lines = content.trim().split('\n');
  const title = lines[0] || '';
  const body = lines.slice(1).join('\n').trim();

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onOpenChange]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10200] flex items-center justify-center"
      onMouseDown={e => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div className="fixed inset-0 bg-black/60" />
      <div
        className="relative w-[92vw] max-w-md z-[10201]"
        onMouseDown={e => e.stopPropagation()}
      >
        <ScrollFrame className="bg-[#2a1f14] border border-amber-900/40 rounded-xl p-5 max-h-[80vh] overflow-auto">
          {/* Title */}
          <h2 className="text-amber-100/85 font-serif text-lg text-center mb-1 leading-snug">
            {title}
          </h2>
          <SpellDivider />

          {/* Body - rendered as Markdown */}
          {body ? (
            <div className="mt-3 mb-3 paper-read-content">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={mdComponents}>
                {body}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="text-amber-100/40 text-sm text-center italic mt-3 mb-3">
              （无正文内容）
            </div>
          )}

          <SpellDivider />

          {/* Source info */}
          {item.sourceItemName && (
            <div className="text-center text-[11px] text-amber-100/30 mt-2 mb-2">
              书写于{item.sourceItemName}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-center gap-3 mt-3">
            {onEdit && (
              <button
                className="px-3 py-1.5 text-xs bg-amber-800/60 hover:bg-amber-700/60 text-amber-200 rounded border border-amber-700/40"
                onClick={onEdit}
              >
                ✏️ 编辑
              </button>
            )}
            {onCopy && (
              <button
                className="px-3 py-1.5 text-xs bg-amber-800/60 hover:bg-amber-700/60 text-amber-200 rounded border border-amber-700/40"
                onClick={onCopy}
              >
                📋 复制
              </button>
            )}
            <button
              className="px-3 py-1.5 text-xs bg-gray-700/60 hover:bg-gray-600/60 text-gray-300 rounded border border-gray-600/40"
              onClick={() => onOpenChange(false)}
            >
              关闭
            </button>
          </div>
        </ScrollFrame>
      </div>
    </div>,
    document.body
  );
}
