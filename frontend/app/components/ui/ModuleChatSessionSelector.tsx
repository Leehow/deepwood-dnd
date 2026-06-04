import { useState, useRef, useEffect } from "react";

interface ChatSession {
  id: number;
  title: string | null;
  message_count: number;
  updated_at: string;
}

interface Props {
  sessions: ChatSession[];
  currentSessionId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onDelete: (id: number) => void;
  onRename: (id: number, title: string) => void;
}

export function ModuleChatSessionSelector({
  sessions,
  currentSessionId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (editingId !== null) editInputRef.current?.focus();
  }, [editingId]);

  const startRename = (id: number, title: string) => {
    setEditingId(id);
    setEditTitle(title || "");
    setConfirmDeleteId(null);
  };

  const commitRename = () => {
    if (editingId !== null && editTitle.trim()) {
      onRename(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleDelete = (id: number) => {
    if (confirmDeleteId === id) {
      onDelete(id);
      setConfirmDeleteId(null);
      if (sessions.length <= 1) setOpen(false);
    } else {
      setConfirmDeleteId(id);
    }
  };

  return (
    <div className="relative flex items-center" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-stone-800/60 hover:bg-stone-700/60 border border-stone-700/50 hover:border-amber-700/30 text-stone-300 hover:text-amber-200 transition-all min-w-0"
      >
        <svg className="w-3 h-3 flex-shrink-0 text-amber-600/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
        <span className="truncate">{currentSession?.title || "新对话"}</span>
        <svg className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* New session button */}
      <button
        onClick={onCreate}
        className="ml-1 flex-shrink-0 p-1 rounded text-stone-500 hover:text-amber-400 hover:bg-stone-700/50 transition-all"
        title="新建对话"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-stone-800 border border-stone-700/80 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="max-h-60 overflow-auto py-1">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-stone-700/50 transition-colors ${
                  s.id === currentSessionId ? "bg-amber-900/20 border-l-2 border-amber-600" : ""
                }`}
                onClick={() => {
                  if (editingId !== s.id) {
                    onSelect(s.id);
                    setOpen(false);
                  }
                }}
              >
                <div className="flex-1 min-w-0">
                  {editingId === s.id ? (
                    <input
                      ref={editInputRef}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full bg-stone-900 border border-amber-700/50 rounded px-1.5 py-0.5 text-xs text-amber-100 outline-none"
                      maxLength={200}
                    />
                  ) : (
                    <div
                      className="text-xs text-stone-300 truncate"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startRename(s.id, s.title || "");
                      }}
                    >
                      {s.title || "新对话"}
                    </div>
                  )}
                  <div className="text-[10px] text-stone-500 mt-0.5">
                    {s.message_count} 条消息
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(s.id, s.title || "");
                    }}
                    className="p-0.5 text-stone-500 hover:text-amber-400 transition-colors"
                    title="重命名"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  {sessions.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(s.id);
                      }}
                      className={`p-0.5 transition-colors ${
                        confirmDeleteId === s.id
                          ? "text-red-400 bg-red-950/50 rounded"
                          : "text-stone-500 hover:text-red-400"
                      }`}
                      title={confirmDeleteId === s.id ? "再次点击确认删除" : "删除对话"}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
