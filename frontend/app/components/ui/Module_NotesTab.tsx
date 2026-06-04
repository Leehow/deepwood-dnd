/**
 * Module_NotesTab - DM备团笔记组件
 * 支持Markdown渲染和折叠功能
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, Flex, Button, TextArea, IconButton, ScrollArea } from '@radix-ui/themes';
import { PlusIcon, Pencil1Icon, TrashIcon, CheckIcon, Cross1Icon, ChevronDownIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { apiFetch } from '~/utils/api-client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTTS } from '~/hooks/useTTS';

interface Note {
  id: number;
  module_id: string;
  user_id: string;
  content: string;
  is_collapsed: boolean;
  created_at: string;
  updated_at: string;
}

interface Props {
  moduleId: string;
  userId: string;
  campaignId?: string;
}

interface Section {
  level: number;
  title: string;
  content: string;
  id: string;
}

// 将markdown按标题分割成sections
function parseMarkdownSections(content: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  let contentLines: string[] = [];
  let sectionId = 0;

  const flushSection = () => {
    if (currentSection) {
      currentSection.content = contentLines.join('\n').trim();
      sections.push(currentSection);
      contentLines = [];
    }
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushSection();
      currentSection = {
        level: headingMatch[1].length,
        title: headingMatch[2],
        content: '',
        id: `section-${sectionId++}`
      };
    } else if (currentSection) {
      contentLines.push(line);
    } else {
      // 标题前的内容，创建一个level 0的section
      if (!currentSection && line.trim()) {
        currentSection = {
          level: 0,
          title: '',
          content: '',
          id: `section-${sectionId++}`
        };
      }
      if (currentSection) {
        contentLines.push(line);
      }
    }
  }
  flushSection();

  return sections;
}

// Markdown渲染组件配置
const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="my-2 leading-relaxed text-stone-300 break-words">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="my-2 space-y-1 ml-1">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="my-2 space-y-1 ml-1 list-decimal list-inside">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="flex items-start gap-2 text-stone-300 break-words">
      <span className="text-green-500 mt-1.5 text-[6px]">●</span>
      <span className="flex-1 min-w-0">{children}</span>
    </li>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-gray-800 border-b border-gray-700">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => <tbody className="divide-y divide-gray-700/50">{children}</tbody>,
  tr: ({ children }: { children?: React.ReactNode }) => <tr className="hover:bg-gray-800/50 transition-colors">{children}</tr>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-2 text-left text-xs font-semibold text-green-300 uppercase tracking-wider">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-3 py-2 text-stone-300 break-words">{children}</td>
  ),
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const isInline = !className;
    return isInline ? (
      <code className="px-1.5 py-0.5 bg-gray-900 border border-gray-700 rounded text-green-300 text-xs font-mono break-all">{children}</code>
    ) : (
      <code className="block bg-gray-900 border border-gray-700 p-3 rounded my-2 text-xs font-mono text-stone-300 overflow-x-auto whitespace-pre-wrap break-words">{children}</code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="bg-gray-900 border border-gray-700 rounded my-2 overflow-x-auto">{children}</pre>,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-green-600/50 pl-3 my-3 py-1 bg-green-950/20 rounded-r text-stone-400 italic">{children}</blockquote>
  ),
  hr: () => (
    <div className="my-4 flex items-center gap-2">
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-600 to-transparent" />
      <span className="text-green-600 text-xs">✦</span>
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-600 to-transparent" />
    </div>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-bold text-green-200">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic text-stone-400">{children}</em>,
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => <a href={href} className="text-green-400 hover:text-green-300 underline decoration-green-600/30">{children}</a>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-base font-bold text-amber-400 mt-4 mb-2 pb-1 border-b border-amber-900/30">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-sm font-bold text-amber-300 mt-3 mb-2">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-sm font-semibold text-amber-200/90 mt-2 mb-1">{children}</h3>,
};

// 可折叠Section组件
function CollapsibleSection({ section, defaultCollapsed = false }: { section: Section; defaultCollapsed?: boolean }) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  if (section.level === 0) {
    // 无标题的内容，直接渲染
    return (
      <Box className="text-sm text-stone-300 break-words">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {section.content}
        </ReactMarkdown>
      </Box>
    );
  }

  const levelStyles = {
    1: "text-base font-bold text-amber-400 pb-1 border-b border-amber-900/30",
    2: "text-sm font-bold text-amber-300",
    3: "text-sm font-semibold text-amber-200/90",
  };

  return (
    <Box className="mt-2">
      {/* 可折叠标题 */}
      <Flex
        align="center"
        gap="1"
        className={`cursor-pointer hover:opacity-80 transition-opacity ${levelStyles[section.level as keyof typeof levelStyles] || levelStyles[3]}`}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {isCollapsed ? (
          <ChevronRightIcon className="w-4 h-4 flex-shrink-0" />
        ) : (
          <ChevronDownIcon className="w-4 h-4 flex-shrink-0" />
        )}
        <span>{section.title}</span>
      </Flex>
      {/* 内容区域 */}
      {!isCollapsed && section.content && (
        <Box className="ml-5 text-sm text-stone-300 break-words">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {section.content}
          </ReactMarkdown>
        </Box>
      )}
    </Box>
  );
}

// 笔记卡片组件
function NoteCard({
  note,
  isEditing,
  editContent,
  onEdit,
  onDelete,
  onStartEdit,
  onCancelEdit,
  onEditChange,
  onToggleCollapse,
  formatTime,
  onTTS,
  ttsPlayingId,
  ttsLoading,
  pendingDelete,
}: {
  note: Note;
  isEditing: boolean;
  editContent: string;
  onEdit: () => void;
  onDelete: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onEditChange: (value: string) => void;
  onToggleCollapse: (collapsed: boolean) => void;
  formatTime: (dateStr: string) => string;
  onTTS: (msgId: string, text: string) => void;
  ttsPlayingId: string | null;
  ttsLoading: string | null;
  pendingDelete: boolean;
}) {
  const isCollapsed = note.is_collapsed;

  const handleToggle = () => {
    onToggleCollapse(!isCollapsed);
  };

  // 获取笔记标题（第一行或前60字符）
  const noteTitle = useMemo(() => {
    const firstLine = note.content.split('\n')[0];
    const cleanTitle = firstLine.replace(/^#+\s*/, '').replace(/\*\*/g, '');
    return cleanTitle.length > 60 ? cleanTitle.slice(0, 60) + '...' : cleanTitle;
  }, [note.content]);

  // 解析markdown sections
  const sections = useMemo(() => parseMarkdownSections(note.content), [note.content]);

  if (isEditing) {
    return (
      <Box className="p-3 bg-gray-800/60 rounded-lg border border-green-600/50">
        <Flex direction="column" gap="2">
          <TextArea
            value={editContent}
            onChange={(e) => onEditChange(e.target.value)}
            className="bg-gray-900 border-gray-600 min-h-[200px]"
            rows={8}
            autoFocus
          />
          <Flex gap="2" justify="end">
            <Button size="1" variant="soft" color="gray" onClick={onCancelEdit}>
              <Cross1Icon /> 取消
            </Button>
            <Button size="1" color="green" onClick={onEdit}>
              <CheckIcon /> 保存
            </Button>
          </Flex>
        </Flex>
      </Box>
    );
  }

  return (
    <Box className="bg-gray-800/60 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors overflow-hidden">
      {/* 折叠头部 */}
      <Flex
        align="center"
        justify="between"
        className="px-3 py-2 cursor-pointer hover:bg-gray-700/30 transition-colors"
        onClick={handleToggle}
      >
        <Flex align="center" gap="2" className="flex-1 min-w-0">
          {isCollapsed ? (
            <ChevronRightIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
          ) : (
            <ChevronDownIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
          )}
          <Text size="2" className="text-gray-200 truncate">{noteTitle}</Text>
        </Flex>
        <Flex align="center" gap="2" onClick={(e) => e.stopPropagation()}>
          <Text size="1" color="gray" className="hidden sm:block">
            {formatTime(note.created_at)}
          </Text>
          <button
            onClick={() => onTTS(`note_${note.id}`, note.content)}
            disabled={ttsLoading === `note_${note.id}`}
            className={`p-1 rounded transition-colors ${
              ttsPlayingId === `note_${note.id}`
                ? 'text-amber-400'
                : ttsLoading === `note_${note.id}`
                  ? 'text-gray-500 cursor-wait'
                  : 'text-gray-400 hover:text-amber-400'
            }`}
            title={ttsPlayingId === `note_${note.id}` ? '停止朗读' : '朗读'}
          >
            {ttsLoading === `note_${note.id}` ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : ttsPlayingId === `note_${note.id}` ? (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
            )}
          </button>
          <IconButton size="1" variant="ghost" color="gray" onClick={onStartEdit}>
            <Pencil1Icon />
          </IconButton>
          <IconButton
            size="1"
            variant="ghost"
            color="red"
            onClick={onDelete}
            title={pendingDelete ? '再次点击确认删除' : '删除笔记'}
            className={pendingDelete ? '!bg-red-950/50' : ''}
          >
            <TrashIcon />
          </IconButton>
        </Flex>
      </Flex>

      {/* 展开内容 - 按section渲染 */}
      {!isCollapsed && (
        <Box className="px-3 pb-3 border-t border-gray-700/50 break-words">
          <Box className="mt-2">
            {sections.map((section) => (
              <CollapsibleSection key={section.id} section={section} />
            ))}
          </Box>
          <Flex justify="between" align="center" className="mt-3 pt-2 border-t border-gray-700/30">
            <Text size="1" color="gray">
              {formatTime(note.created_at)}
              {note.updated_at !== note.created_at && ' (已编辑)'}
            </Text>
            <Flex align="center" gap="3">
              <button
                onClick={() => {
                  const noteId = `note_${note.id}`;
                  onTTS(noteId, note.content);
                }}
                disabled={ttsLoading === `note_${note.id}`}
                className={`text-[10px] transition-colors flex items-center gap-1 ${
                  ttsPlayingId === `note_${note.id}`
                    ? 'text-amber-400'
                    : ttsLoading === `note_${note.id}`
                      ? 'text-gray-500 cursor-wait'
                      : 'text-stone-500 hover:text-amber-400'
                }`}
                title={ttsPlayingId === `note_${note.id}` ? '停止朗读' : '朗读'}
              >
                {ttsLoading === `note_${note.id}` ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    加载中
                  </>
                ) : ttsPlayingId === `note_${note.id}` ? (
                  <>
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                    停止
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                    </svg>
                    朗读
                  </>
                )}
              </button>
              <button
                onClick={() => onToggleCollapse(true)}
                className="text-[10px] text-stone-500 hover:text-amber-400 transition-colors flex items-center gap-1"
              >
                <ChevronDownIcon className="w-3 h-3 rotate-180" />
                收起
              </button>
            </Flex>
          </Flex>
        </Box>
      )}
    </Box>
  );
}

export function Module_NotesTab({ moduleId, userId, campaignId }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [adding, setAdding] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const { handleTTS, ttsPlayingId, ttsLoading } = useTTS(campaignId);

  const authedFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) =>
      apiFetch(input, { ...init, userId }),
    [userId]
  );

  const loadNotes = useCallback(async () => {
    if (!moduleId) return;
    setLoading(true);
    try {
      const resp = await authedFetch(`/api/modules/${moduleId}/notes`);
      if (resp.ok) {
        const data = await resp.json();
        setNotes(data.notes || []);
      }
    } catch (e) {
      console.error('Failed to load notes:', e);
    } finally {
      setLoading(false);
    }
  }, [moduleId, authedFetch]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const handleAdd = async () => {
    if (!newNote.trim()) return;
    setAdding(true);
    try {
      const resp = await authedFetch(`/api/modules/${moduleId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newNote.trim() }),
      });
      if (resp.ok) {
        setNewNote('');
        loadNotes();
      }
    } catch (e) {
      console.error('Failed to add note:', e);
    } finally {
      setAdding(false);
    }
  };

  const handleUpdate = async (noteId: number) => {
    if (!editContent.trim()) return;
    try {
      const resp = await authedFetch(`/api/modules/${moduleId}/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent.trim() }),
      });
      if (resp.ok) {
        setEditingId(null);
        setEditContent('');
        loadNotes();
      }
    } catch (e) {
      console.error('Failed to update note:', e);
    }
  };

  const handleDelete = async (noteId: number) => {
    // First click: show confirmation
    if (pendingDeleteId !== noteId) {
      setPendingDeleteId(noteId);
      setTimeout(() => {
        setPendingDeleteId(prev => prev === noteId ? null : prev);
      }, 3000);
      return;
    }
    // Second click: actually delete
    try {
      const resp = await authedFetch(`/api/modules/${moduleId}/notes/${noteId}`, {
        method: 'DELETE',
      });
      if (resp.ok) {
        setPendingDeleteId(null);
        loadNotes();
      }
    } catch (e) {
      console.error('Failed to delete note:', e);
    }
  };

  const handleToggleCollapse = async (noteId: number, collapsed: boolean) => {
    // 先乐观更新本地状态
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, is_collapsed: collapsed } : n));
    try {
      await authedFetch(`/api/modules/${moduleId}/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_collapsed: collapsed }),
      });
    } catch (e) {
      // 失败时回滚
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, is_collapsed: !collapsed } : n));
      console.error('Failed to update collapse state:', e);
    }
  };

  const startEdit = (note: Note) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!moduleId) {
    return (
      <Box className="h-full flex items-center justify-center">
        <Text color="gray">请先选择一个模组</Text>
      </Box>
    );
  }

  return (
    <Flex direction="column" className="h-full w-full overflow-hidden">
      {/* 标题区域 */}
      <Box className="p-4 border-b border-gray-700">
        <Flex align="center" gap="3">
          <Box className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-600 to-emerald-700 flex items-center justify-center">
            <span className="text-lg">📝</span>
          </Box>
          <Box>
            <Text size="4" weight="bold" className="text-green-400">备团笔记</Text>
            <Text size="1" color="gray" className="block">记录你的备团思路</Text>
          </Box>
          <Box className="ml-auto">
            <Text size="1" color="gray">{notes.length} 条笔记</Text>
          </Box>
        </Flex>
      </Box>

      {/* 新建笔记输入框 */}
      <Box className="p-3 border-b border-gray-700 bg-gray-800/50">
        <Flex gap="2">
          <TextArea
            placeholder="添加新笔记...（支持 Markdown）"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="flex-1 bg-gray-900 border-gray-700 text-sm"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.metaKey) {
                handleAdd();
              }
            }}
          />
          <Button
            size="2"
            color="green"
            onClick={handleAdd}
            disabled={!newNote.trim() || adding}
          >
            <PlusIcon />
            {adding ? '添加中...' : '添加'}
          </Button>
        </Flex>
        <Text size="1" color="gray" className="mt-1">⌘+Enter 快速添加</Text>
      </Box>

      {/* 笔记列表 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea scrollbars="vertical" type="always" style={{ height: '100%', width: '100%' }}>
          <div className="p-2 pr-4">
            {loading ? (
              <Box className="p-4 text-center">
                <Text color="gray">加载中...</Text>
              </Box>
            ) : notes.length === 0 ? (
              <Box className="p-8 text-center">
                <Text color="gray">暂无笔记，开始记录你的备团思路吧！</Text>
              </Box>
            ) : (
              <Flex direction="column" gap="2">
                {notes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    isEditing={editingId === note.id}
                    editContent={editContent}
                    onEdit={() => handleUpdate(note.id)}
                    onDelete={() => handleDelete(note.id)}
                    onStartEdit={() => startEdit(note)}
                    onCancelEdit={cancelEdit}
                    onEditChange={setEditContent}
                    onToggleCollapse={(collapsed) => handleToggleCollapse(note.id, collapsed)}
                    formatTime={formatTime}
                    onTTS={handleTTS}
                    ttsPlayingId={ttsPlayingId}
                    ttsLoading={ttsLoading}
                    pendingDelete={pendingDeleteId === note.id}
                  />
                ))}
              </Flex>
            )}
          </div>
        </ScrollArea>
      </div>
    </Flex>
  );
}
