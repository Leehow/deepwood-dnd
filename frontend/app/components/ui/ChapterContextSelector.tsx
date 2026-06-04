import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface ChapterNode {
  title?: string;
  content?: string;
  children?: ChapterNode[];
  [key: string]: unknown;
}

interface Props {
  chapters: ChapterNode[];
  selectedTitles: Set<string>;
  onSelectionChange: (titles: Set<string>) => void;
  disabled?: boolean;
}

type SelectionMode = "cascade" | "individual";

function flattenTree(nodes: ChapterNode[]): string[] {
  const titles: string[] = [];
  for (const node of nodes) {
    if (node.title) titles.push(node.title);
    if (node.children?.length) titles.push(...flattenTree(node.children));
  }
  return titles;
}

function getDescendantTitles(node: ChapterNode): string[] {
  const titles: string[] = [];
  if (node.children?.length) {
    for (const child of node.children) {
      if (child.title) titles.push(child.title);
      titles.push(...getDescendantTitles(child));
    }
  }
  return titles;
}

/** Find a node by title in the tree */
function findNode(nodes: ChapterNode[], title: string): ChapterNode | null {
  for (const node of nodes) {
    if (node.title === title) return node;
    if (node.children?.length) {
      const found = findNode(node.children, title);
      if (found) return found;
    }
  }
  return null;
}

/** Content preview modal */
function ContentPreviewModal({
  node,
  onClose,
}: {
  node: ChapterNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const content = node.content || "（无内容）";
  // Truncate very long content for display
  const displayContent =
    content.length > 5000 ? content.slice(0, 5000) + "\n\n...（内容过长，已截断）" : content;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-stone-900 border border-stone-700/50 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-700/50 flex-shrink-0">
          <h3 className="text-sm font-medium text-stone-200 truncate pr-2">
            {node.title}
          </h3>
          <button
            onClick={onClose}
            className="text-stone-500 hover:text-stone-300 transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Content */}
        <div className="overflow-y-auto px-4 py-3 flex-1">
          <pre className="text-xs text-stone-300 whitespace-pre-wrap break-words font-sans leading-relaxed">
            {displayContent}
          </pre>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ChapterContextSelector({ chapters, selectedTitles, onSelectionChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SelectionMode>("cascade");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [previewNode, setPreviewNode] = useState<ChapterNode | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      // Don't close dropdown when interacting with the preview modal
      if (previewNode) return;
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, previewNode]);

  // Default all top-level nodes to collapsed on first open
  useEffect(() => {
    if (open && collapsed.size === 0 && chapters.length > 0) {
      const topTitles = new Set<string>();
      for (const ch of chapters) {
        if (ch.title && ch.children?.length) topTitles.add(ch.title);
      }
      setCollapsed(topTitles);
    }
  }, [open, chapters]);

  const toggleNode = (node: ChapterNode) => {
    const title = node.title;
    if (!title) return;
    const next = new Set(selectedTitles);
    const isSelected = next.has(title);

    if (mode === "cascade") {
      const descendants = getDescendantTitles(node);
      const all = [title, ...descendants];
      if (isSelected) {
        all.forEach((t) => next.delete(t));
      } else {
        all.forEach((t) => next.add(t));
      }
    } else {
      if (isSelected) next.delete(title);
      else next.add(title);
    }
    onSelectionChange(next);
  };

  const toggleCollapse = useCallback((title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }, []);

  const selectAll = () => {
    onSelectionChange(new Set(flattenTree(chapters)));
  };

  const clearAll = () => {
    onSelectionChange(new Set());
  };

  const count = selectedTitles.size;
  const hasChildren = (node: ChapterNode) => !!(node.children?.length);

  const renderNode = (node: ChapterNode, level: number, index: number) => {
    const title = node.title || "";
    if (!title) return null;
    const paddings = ["pl-1", "pl-5", "pl-9", "pl-12"];
    const pl = paddings[Math.min(level, paddings.length - 1)];
    const checked = selectedTitles.has(title);
    const isCollapsed = collapsed.has(title);
    const hasKids = hasChildren(node);
    const hasContent = !!(node.content);

    return (
      <div key={`${level}-${index}-${title}`}>
        <div className={`flex items-center gap-1 px-1 py-0.5 hover:bg-stone-700/40 transition-colors ${pl}`}>
          {/* Collapse toggle */}
          {hasKids ? (
            <button
              onClick={(e) => toggleCollapse(title, e)}
              className="w-4 h-4 flex items-center justify-center text-stone-500 hover:text-stone-300 flex-shrink-0"
            >
              <svg
                className={`w-3 h-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <span className="w-4 flex-shrink-0" />
          )}

          {/* Checkbox + title */}
          <label className="flex items-center gap-1.5 cursor-pointer flex-1 min-w-0">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggleNode(node)}
              className="w-3 h-3 rounded border-stone-600 bg-stone-800 text-amber-600 focus:ring-amber-600/50 focus:ring-offset-0 cursor-pointer flex-shrink-0"
            />
            <span className={`text-xs truncate ${level === 0 ? "text-stone-200 font-medium" : "text-stone-400"}`}>
              {title}
            </span>
          </label>

          {/* Eye preview button */}
          {hasContent && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPreviewNode(node);
              }}
              className="w-5 h-5 flex items-center justify-center text-stone-600 hover:text-amber-400 flex-shrink-0 transition-colors"
              title="预览内容"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
        </div>

        {/* Children (collapsible) */}
        {hasKids && !isCollapsed && node.children!.map((child, i) => renderNode(child, level + 1, i))}
      </div>
    );
  };

  if (!chapters.length) return null;

  return (
    <div className="relative flex-shrink-0" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="relative flex items-center gap-1 px-2 py-1 text-xs text-stone-500 hover:text-amber-400 hover:bg-stone-800/50 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
        title="选择章节作为上下文"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
        <span>章节引用</span>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center px-1 text-[10px] leading-none bg-amber-700/80 text-amber-200 rounded-full">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-1 w-72 max-w-[calc(100vw-1rem)] bg-stone-800 border border-stone-700/50 rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Mode toggle */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-stone-700/50">
            <span className="text-[10px] text-stone-500 mr-1">模式:</span>
            <button
              onClick={() => setMode("cascade")}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                mode === "cascade"
                  ? "bg-amber-700/50 text-amber-200"
                  : "text-stone-500 hover:text-stone-300 hover:bg-stone-700/50"
              }`}
            >
              遍历
            </button>
            <button
              onClick={() => setMode("individual")}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                mode === "individual"
                  ? "bg-amber-700/50 text-amber-200"
                  : "text-stone-500 hover:text-stone-300 hover:bg-stone-700/50"
              }`}
            >
              单选
            </button>
            {/* Expand all / Collapse all */}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setCollapsed(new Set())}
                className="text-[10px] text-stone-500 hover:text-stone-300 transition-colors"
                title="全部展开"
              >
                展开
              </button>
              <button
                onClick={() => {
                  const all = new Set<string>();
                  const collectParents = (nodes: ChapterNode[]) => {
                    for (const n of nodes) {
                      if (n.title && n.children?.length) all.add(n.title);
                      if (n.children?.length) collectParents(n.children);
                    }
                  };
                  collectParents(chapters);
                  setCollapsed(all);
                }}
                className="text-[10px] text-stone-500 hover:text-stone-300 transition-colors"
                title="全部折叠"
              >
                折叠
              </button>
            </div>
          </div>

          {/* Chapter tree */}
          <div className="max-h-64 overflow-y-auto py-1">
            {chapters.map((ch, i) => renderNode(ch, 0, i))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 px-2 py-1.5 border-t border-stone-700/50">
            <button
              onClick={selectAll}
              className="text-[10px] text-stone-500 hover:text-amber-400 transition-colors"
            >
              全选
            </button>
            <button
              onClick={clearAll}
              className="text-[10px] text-stone-500 hover:text-amber-400 transition-colors"
            >
              清除
            </button>
            <span className="ml-auto text-[10px] text-stone-600">
              {count} 项已选
            </span>
          </div>
        </div>
      )}

      {/* Content preview modal */}
      {previewNode && (
        <ContentPreviewModal
          node={previewNode}
          onClose={() => setPreviewNode(null)}
        />
      )}
    </div>
  );
}
