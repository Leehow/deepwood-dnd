import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Card, Text, Flex, Box, Badge, ScrollArea, Dialog, Button, TextArea, TextField, IconButton } from '@radix-ui/themes';
import * as Tabs from '@radix-ui/react-tabs';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const remarkPluginsStable = [remarkGfm];
import { tCategory, tRarity } from '~/config/item-i18n';
import { Edit2, Plus, Trash2, ChevronRight, ChevronDown, Eye, Save, X, Bold, Italic, Heading1, Heading2, Heading3, List, ListOrdered, Quote, Undo, Redo, Minus, MessageCircle, Send, CornerDownRight, Search, BookOpen, Lightbulb, FileEdit, ChevronUp, Copy, Volume2, Square, Check, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { ModuleSelector } from './ModuleSelector';
import { Module_AIQueryTab } from '~/components/ui/Module_AIQueryTab';
import { Module_NotesTab } from '~/components/ui/Module_NotesTab';
import { MonsterDetailModal as ResourceMonsterDetailModal } from './ResourceLibrary/components/MonsterDetailModal';
import type { MonsterInstance } from './ResourceLibrary/types';
import { useModuleStore } from '~/stores/moduleStore';
import { getCurrentUserId } from '~/utils/user';
import { apiFetch } from '~/utils/api-client';
import { getApiEndpoint, API_BASE_URL } from '~/config/api';
import type { Location, Quest, Faction, Encounter } from '~/stores/moduleStore';
import { createLogger } from '~/utils/logger';
import { useTTS } from '~/hooks/useTTS';
import { isClickInsideFloatingChat, useFloatingGuardedClose } from '~/utils/floatingChatGuard';
import { useModalContextStore } from '~/stores/modalContextStore';
import {
  fetchModuleAssetDataUrl,
  releaseModuleAssetBlobUrl,
  retainModuleAssetBlobUrl,
} from '~/utils/moduleAssetBlob';
import './ModuleScriptPanel.css';
const logger = createLogger('ModuleScriptPanel');

/**
 * Convert module monster data to MonsterInstance format for reusing ResourceLibrary's MonsterDetailModal
 */
function convertModuleMonsterToInstance(monster: any): MonsterInstance | null {
  if (!monster) return null;

  // DEBUG: 打印原始数据看看结构
  console.log('[convertModuleMonsterToInstance] 原始怪物数据:', monster);
  console.log('[convertModuleMonsterToInstance] speed:', monster.speed);
  console.log('[convertModuleMonsterToInstance] abilityScores:', monster.abilityScores);
  console.log('[convertModuleMonsterToInstance] str:', monster.str);

  // Handle AC - can be number or object like {value, base}
  const ac = typeof monster.ac === 'object'
    ? (monster.ac?.value || monster.ac?.base || monster.ac?.average || 0)
    : (monster.ac || 0);

  // Handle HP - can be number or object like {dice, average}
  const hp = typeof monster.hp === 'object'
    ? (monster.hp?.average || 0)
    : (monster.hp || 0);


  // Handle speed - convert to Record<string, number>, ensure we have valid data
  let speeds: Record<string, number> = { walk: 30 }; // default
  if (typeof monster.speed === 'object' && monster.speed !== null) {
    const filtered = Object.fromEntries(
      Object.entries(monster.speed)
        .filter(([, v]) => v != null && v !== 0)
        .map(([k, v]) => [k, typeof v === 'number' ? v : parseInt(String(v), 10) || 0])
    );
    if (Object.keys(filtered).length > 0) speeds = filtered;
  } else if (typeof monster.speed === 'number' && monster.speed > 0) {
    speeds = { walk: monster.speed };
  }

  // Handle ability scores - only create if there's actual data
  const hasAbilityData = monster.abilityScores ||
    monster.str !== undefined || monster.dex !== undefined || monster.con !== undefined ||
    monster.int !== undefined || monster.wis !== undefined || monster.cha !== undefined;
  let abilityScores: Record<string, any> | null = null;
  if (hasAbilityData) {
    abilityScores = monster.abilityScores || {
      str: monster.str, strMod: monster.strMod,
      dex: monster.dex, dexMod: monster.dexMod,
      con: monster.con, conMod: monster.conMod,
      int: monster.int, intMod: monster.intMod,
      wis: monster.wis, wisMod: monster.wisMod,
      cha: monster.cha, chaMod: monster.chaMod,
    };
    // Add modifiers if not present
    for (const stat of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      const score = abilityScores?.[stat];
      if (typeof score === 'number' && abilityScores?.[`${stat}Mod`] === undefined) {
        abilityScores![`${stat}Mod`] = Math.floor((score - 10) / 2);
      }
    }
  }

  // Convert skills to string format if object
  const skillsStr = (typeof monster.skills === 'object' && monster.skills !== null)
    ? Object.entries(monster.skills).map(([k, v]) => `${k} ${v}`).join(', ')
    : monster.skills || '';

  // Convert senses to string format if object
  const sensesStr = (typeof monster.senses === 'object' && monster.senses !== null)
    ? Object.entries(monster.senses).map(([k, v]) => `${k} ${v}`).join(', ')
    : monster.senses || '';

  // Convert languages array to string
  const languagesStr = Array.isArray(monster.languages)
    ? monster.languages.join(', ')
    : monster.languages || '';

  const result = {
    id: 0, // Placeholder - module monsters don't have DB IDs
    campaign_id: 0, // Placeholder
    monster_id: monster.id || monster.name || '',
    name: monster.nameEn || monster.name_en || monster.name || '',
    name_cn: monster.name || '',
    size: monster.size,
    type: monster.type,
    alignment: monster.alignment,
    challenge_rating: monster.cr,
    armor_class: typeof ac === 'number' ? ac : parseInt(String(ac), 10) || 0,
    hit_points: typeof hp === 'number' ? hp : parseInt(String(hp), 10) || 0,
    hit_dice: monster.hpFormula || monster.hp?.dice,
    current_hp: typeof hp === 'number' ? hp : parseInt(String(hp), 10) || 0,
    ability_scores: abilityScores ?? undefined,
    speeds: speeds,
    has_avatar: false,
    monster_data: {
      ...monster,
      speeds,
      skills: skillsStr,
      senses: sensesStr,
      languages: languagesStr,
      hp_formula: monster.hpFormula || monster.hp?.dice,
      ability_scores: abilityScores,
      special_abilities: monster.special_abilities || monster.specialAbilities || monster.traits,
      actions: monster.actions || monster.attacks,
      legendary_actions: monster.legendary_actions || monster.legendaryActions,
      reactions: monster.reactions,
    },
  };

  // DEBUG: 打印转换后的数据
  console.log('[convertModuleMonsterToInstance] 转换后 speeds:', result.speeds);
  console.log('[convertModuleMonsterToInstance] 转换后 monster_data.speeds:', result.monster_data.speeds);
  console.log('[convertModuleMonsterToInstance] 转换后 monster_data.ability_scores:', result.monster_data.ability_scores);

  return result;
}

// Base path for static assets
const BASE_PATH = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL.replace(/\/$/, '') : '';

/**
 * 过滤文本中的 base64 图片数据
 * 移除 markdown 格式的 base64 图片引用 ![...](data:image/...)
 */
function filterBase64Images(text: string): string {
  if (!text) return text;
  // 移除 markdown 格式的 base64 图片: ![alt](data:image/xxx;base64,...)
  let result = text.replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/g, '');
  // 移除独立的 base64 数据 URL（非 markdown 格式）
  result = result.replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]{100,}/g, '[图片]');
  // 清理多余的空行
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

// 怪物类型关键词（通常是通用怪物）
const MONSTER_TYPE_KEYWORDS = [
  'drake', 'dragon', 'gnoll', 'goblin', 'kobold', 'orc', 'troll', 'ogre', 'giant',
  'skeleton', 'zombie', 'ghoul', 'vampire', 'werewolf', 'elemental', 'demon', 'devil',
  'spider', 'rat', 'wolf', 'bear', 'bat', 'snake', 'beast', 'swarm', 'ooze', 'slime',
  '龙兽', '地精', '豺狼', '骷髅', '僵尸', '食尸鬼', '元素', '恶魔', '魔鬼',
  '蜘蛛', '狼', '熊', '蝙蝠', '蛇', '野兽', '集群', '软泥怪', '史莱姆'
];

/**
 * 判断一个怪物是NPC还是普通怪物
 * @returns 'npc' | 'monster'
 */
function classifyMonsterOrNPC(monster: { name: string; name_en?: string; nameEn?: string; type?: string }): 'npc' | 'monster' {
  const nameEn = (monster.name_en || monster.nameEn || '').toLowerCase();
  const nameEnOriginal = monster.name_en || monster.nameEn || '';
  const nameCn = monster.name || '';
  const type = (monster.type || '').toLowerCase();

  // 1. 检查英文名是否像人名（多个首字母大写的单词）
  if (nameEnOriginal) {
    const words = nameEnOriginal.trim().split(/\s+/);
    // 如果有2-4个单词，每个都是首字母大写，可能是人名
    if (words.length >= 2 && words.length <= 4) {
      const allCapitalized = words.every(w => w[0] === w[0].toUpperCase() && w.length > 1);
      const noMonsterKeyword = !MONSTER_TYPE_KEYWORDS.some(kw => nameEn.includes(kw.toLowerCase()));
      if (allCapitalized && noMonsterKeyword) {
        return 'npc';
      }
    }
  }

  // 2. 检查是否包含怪物类型关键词
  const hasMonsterKeyword = MONSTER_TYPE_KEYWORDS.some(kw =>
    nameEn.includes(kw.toLowerCase()) || nameCn.includes(kw)
  );
  if (hasMonsterKeyword) {
    return 'monster';
  }

  // 3. 检查类型是否为类人生物且名字像人名
  if (type.includes('humanoid') || type.includes('类人') || type.includes('人类')) {
    // 类人生物 + 非通用名称 = NPC
    const genericNames = ['guard', 'soldier', 'bandit', 'cultist', 'thug', '卫兵', '士兵', '强盗', '教徒', '暴徒'];
    const isGeneric = genericNames.some(g => nameEn.includes(g) || nameCn.includes(g));
    if (!isGeneric) {
      return 'npc';
    }
  }

  // 4. 中文名字长度判断（2-4个字的可能是人名）
  if (nameCn.length >= 2 && nameCn.length <= 5) {
    const hasMonsterSuffix = ['兽', '龙', '怪', '精', '魔', '鬼', '虫', '蛛'].some(s => nameCn.endsWith(s));
    if (!hasMonsterSuffix && !hasMonsterKeyword) {
      // 可能是NPC，但需要更多检查
      if (type.includes('humanoid') || type.includes('类人')) {
        return 'npc';
      }
    }
  }

  return 'monster';
}

// Member type for chat recipients
interface CampaignMember {
  user_id: string;
  role: string;
  character_name?: string;
  display_name?: string;
  is_virtual?: boolean;
}

// Known static-only modules (exist only in frontend public/rules/modules/)
// Skip backend API calls for these to avoid 404 console errors
const STATIC_ONLY_MODULES = new Set(['lost_mine_of_phandelver']);

// Module-level cache (persists across component remounts/tab switches)
const moduleDataCache = new Map<string, any>();
let loadingModuleId: string | null = null;

/**
 * Styled markdown content renderer
 */
function StyledMarkdown({ content }: { content: string }) {
  return (
    <div style={{ fontSize: '1.1rem', lineHeight: '1.9', color: 'var(--gray-12)' }}>
      <ReactMarkdown
        remarkPlugins={remarkPluginsStable}
        components={{
          h1: ({children}) => (
            <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '1.5rem', marginBottom: '0.75rem', color: 'var(--gray-12)' }}>{children}</h1>
          ),
          h2: ({children}) => (
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginTop: '1.25rem', marginBottom: '0.5rem', color: 'var(--gray-12)' }}>{children}</h2>
          ),
          h3: ({children}) => (
            <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginTop: '1rem', marginBottom: '0.5rem', color: 'var(--gray-12)' }}>{children}</h3>
          ),
          p: ({children}) => (
            <p style={{ marginTop: '0.5rem', marginBottom: '0.75rem', lineHeight: '1.7' }}>{children}</p>
          ),
          ul: ({children}) => (
            <ul style={{ listStyleType: 'disc', paddingLeft: '1.5rem', marginTop: '0.5rem', marginBottom: '0.75rem' }}>{children}</ul>
          ),
          ol: ({children}) => (
            <ol style={{ listStyleType: 'decimal', paddingLeft: '1.5rem', marginTop: '0.5rem', marginBottom: '0.75rem' }}>{children}</ol>
          ),
          li: ({children}) => (
            <li style={{ marginTop: '0.25rem', marginBottom: '0.25rem', lineHeight: '1.6' }}>{children}</li>
          ),
          blockquote: ({children}) => (
            <blockquote style={{ borderLeft: '4px solid var(--gray-6)', paddingLeft: '1rem', marginTop: '0.75rem', marginBottom: '0.75rem', fontStyle: 'italic', color: 'var(--gray-11)' }}>{children}</blockquote>
          ),
          code: ({children, className}) => {
            const isBlock = className?.includes('language-');
            if (isBlock) {
              return (
                <pre style={{ backgroundColor: 'var(--gray-3)', padding: '1rem', borderRadius: '0.5rem', marginTop: '0.75rem', marginBottom: '0.75rem', overflowX: 'auto' }}>
                  <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}>{children}</code>
                </pre>
              );
            }
            return (
              <code style={{ backgroundColor: 'var(--gray-4)', padding: '0.125rem 0.375rem', borderRadius: '0.25rem', fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}>{children}</code>
            );
          },
          table: ({children}) => (
            <div style={{ overflowX: 'auto', marginTop: '0.75rem', marginBottom: '0.75rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>{children}</table>
            </div>
          ),
          th: ({children}) => (
            <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '2px solid var(--gray-6)', backgroundColor: 'var(--gray-3)' }}>{children}</th>
          ),
          td: ({children}) => (
            <td style={{ padding: '0.625rem 0.75rem', borderBottom: '1px solid var(--gray-5)' }}>{children}</td>
          ),
          img: ({src, alt, ...props}) => (
            <img
              src={src}
              alt={alt || ''}
              style={{ maxWidth: '100%', height: 'auto', borderRadius: '0.5rem', marginTop: '0.75rem', marginBottom: '0.75rem' }}
              {...props}
            />
          ),
          hr: () => (
            <hr style={{ margin: '1.5rem 0', border: 'none', borderTop: '1px solid var(--gray-6)' }} />
          ),
          a: ({href, children}) => (
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-10)', textDecoration: 'underline' }}>{children}</a>
          ),
          strong: ({children}) => (
            <strong style={{ fontWeight: '600', color: 'var(--gray-12)' }}>{children}</strong>
          ),
          em: ({children}) => (
            <em style={{ fontStyle: 'italic' }}>{children}</em>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Replace image references in markdown with OSS URLs
 */
function injectImageData(
  markdown: string,
  images: Array<{image_id: string; oss_url?: string; thumbnail_url?: string; image_base64?: string}>
): string {
  if (!markdown || !images?.length) return markdown;

  let result = markdown;
  for (const img of images) {
    const imageUrl = img.oss_url || img.thumbnail_url;
    if (img.image_id && imageUrl) {
      // Pattern: ![alt](img-X.jpeg) or ![img-X.jpeg](data:image/...)
      const patterns = [
        new RegExp(`!\\[([^\\]]*)\\]\\(${img.image_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'),
        new RegExp(`!\\[${img.image_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\([^)]+\\)`, 'g'),
      ];
      for (const pattern of patterns) {
        result = result.replace(pattern, `![${img.image_id}](${imageUrl})`);
      }
    }
  }

  // Also replace any remaining inline base64 data URLs with a placeholder
  result = result.replace(/!\[([^\]]*)\]\(data:image\/[^)]+\)/g, '![$1]()');

  return result;
}

// 富文本编辑器工具栏（精简版）
function EditorToolbar({ editor }: { editor: any }) {
  if (!editor) return null;

  return (
    <Flex className="msp-editor-toolbar" gap="1" wrap="wrap" align="center">
      {/* 撤销/重做 */}
      <IconButton
        size="1"
        variant="ghost"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="撤销"
      >
        <Undo size={16} />
      </IconButton>
      <IconButton
        size="1"
        variant="ghost"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="重做"
      >
        <Redo size={16} />
      </IconButton>

      <div className="msp-toolbar-divider" />

      {/* 文本格式 */}
      <IconButton
        size="1"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={editor.isActive('bold') ? 'msp-toolbar-btn--active' : ''}
        title="加粗"
      >
        <Bold size={16} />
      </IconButton>
      <IconButton
        size="1"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={editor.isActive('italic') ? 'msp-toolbar-btn--active' : ''}
        title="斜体"
      >
        <Italic size={16} />
      </IconButton>

      <div className="msp-toolbar-divider" />

      {/* 列表 */}
      <IconButton
        size="1"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={editor.isActive('bulletList') ? 'msp-toolbar-btn--active' : ''}
        title="无序列表"
      >
        <List size={16} />
      </IconButton>
      <IconButton
        size="1"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={editor.isActive('orderedList') ? 'msp-toolbar-btn--active' : ''}
        title="有序列表"
      >
        <ListOrdered size={16} />
      </IconButton>

      <div className="msp-toolbar-divider" />

      {/* 引用和分隔线 */}
      <IconButton
        size="1"
        variant="ghost"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={editor.isActive('blockquote') ? 'msp-toolbar-btn--active' : ''}
        title="引用"
      >
        <Quote size={16} />
      </IconButton>
      <IconButton
        size="1"
        variant="ghost"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="分隔线"
      >
        <Minus size={16} />
      </IconButton>
    </Flex>
  );
}

// 章节内容模态框 - 支持查看和编辑（自动保存）
function ChapterContentModal({
  node,
  open,
  onClose,
  images,
  isEditable = false,
  onSave,
  onSaveTitle,
  moduleId
}: {
  node: any | null;
  open: boolean;
  onClose: () => void;
  images?: Array<{image_id: string; oss_url?: string; thumbnail_url?: string; image_base64?: string}>;
  isEditable?: boolean;
  onSave?: (content: string) => Promise<void>;
  onSaveTitle?: (title: string) => Promise<void>;
  moduleId?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);

  // Prevent closing when clicking floating windows (chat, character panel)
  const handleOpenChange = useFloatingGuardedClose(onClose);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>('');

  // AI 内联助手状态
  const [isAiPromptMode, setIsAiPromptMode] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const aiPromptStartPosRef = useRef<number | null>(null); // `/` 在文档中的位置
  const aiAbortRef = useRef<AbortController | null>(null);
  const aiStreamBufferRef = useRef<string>('');
  const aiInsertPosRef = useRef<number | null>(null);

  // Chat 侧边栏状态
  interface RangeEdit {
    start_line: number;
    end_line: number;
    content: string;
  }
  interface ChatMsg {
    id?: number;
    role: string;
    content: string;
    isStreaming?: boolean;
    edits?: RangeEdit[];
    editsApplied?: boolean;
    toolCalls?: { name: string; summary?: string }[];
  }
  const [showChatSidebar, setShowChatSidebar] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [collapsedChatMsgs, setCollapsedChatMsgs] = useState<Set<number>>(new Set());
  const [expandedThinking, setExpandedThinking] = useState<Set<number>>(new Set());
  const [expandedEdits, setExpandedEdits] = useState<Set<string>>(new Set());
  const [chatReplyTo, setChatReplyTo] = useState<string | null>(null);
  const [chatWidth, setChatWidth] = useState(340);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatUiSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const [copiedChatMsgId, setCopiedChatMsgId] = useState<number | null>(null);
  const { handleTTS, ttsPlayingId, ttsLoading } = useTTS();

  // authedFetch for API calls
  const userId = getCurrentUserId();
  const authedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    apiFetch(input, { ...init, userId });

  // Sync module content → modal context for AI assistant
  const setModalCtx = useModalContextStore(s => s.setModalContext);
  const clearModalCtx = useModalContextStore(s => s.clearModalContext);
  useEffect(() => {
    if (open && node) {
      const title = node.title || node.name || '';
      const content = node.content || '';
      setModalCtx('module-content', `DM正在阅读模组章节「${title}」，内容：${content}`);
    } else {
      clearModalCtx('module-content');
    }
  }, [open, node?.title, node?.name, node?.content, setModalCtx, clearModalCtx]);

  // 将 Markdown 转换为 HTML
  const markdownToHtml = useCallback((markdown: string) => {
    if (!markdown) return '';
    // 先清理空列表项和多余空行
    let result = markdown.replace(/^- \s*$/gm, '');
    result = result.replace(/\n{3,}/g, '\n\n').trim();
    return result
      // 图片语法 ![alt](url)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>')
      .replace(/^- (.*$)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\s*)+/g, (match) => `<ul>${match.trim()}</ul>`)
      .replace(/^---$/gm, '<hr>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }, []);

  // 将 HTML 转换回 Markdown
  const htmlToMarkdown = useCallback((html: string) => {
    if (!html) return '';
    return html
      // 图片标签转回 Markdown
      .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/g, '![$2]($1)')
      .replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/g, '![$1]($2)')
      .replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/g, '![]($1)')
      .replace(/<h1>(.*?)<\/h1>/g, '# $1\n')
      .replace(/<h2>(.*?)<\/h2>/g, '## $1\n')
      .replace(/<h3>(.*?)<\/h3>/g, '### $1\n')
      .replace(/<strong><em>(.*?)<\/em><\/strong>/g, '***$1***')
      .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
      .replace(/<em>(.*?)<\/em>/g, '*$1*')
      .replace(/<blockquote>(.*?)<\/blockquote>/g, '> $1\n')
      // 先去掉 <li> 内的 <p> 标签（Tiptap 输出 <li><p>text</p></li>）
      .replace(/<li>\s*<p>(.*?)<\/p>\s*<\/li>/gs, '<li>$1</li>')
      .replace(/<ul>(.*?)<\/ul>/gs, (_, content) => content.replace(/<li>(.*?)<\/li>/g, '- $1\n'))
      .replace(/<ol>(.*?)<\/ol>/gs, (_, content) => {
        let i = 1;
        return content.replace(/<li>(.*?)<\/li>/g, () => `${i++}. $1\n`);
      })
      .replace(/<hr\s*\/?>/g, '---\n')
      .replace(/<p>(.*?)<\/p>/gs, '$1\n\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<[^>]+>/g, '')
      // 清理：合并连续空行为最多一个空行
      .replace(/\n{3,}/g, '\n\n')
      // 清理：去掉只有 - 的空列表项
      .replace(/^- \s*$/gm, '')
      .trim();
  }, []);

  // 自动保存函数
  const doAutoSave = useCallback(async (editorInstance: any) => {
    if (!editorInstance || !onSave) return;

    const html = editorInstance.getHTML();
    const markdown = htmlToMarkdown(html);

    // 内容未变化则跳过
    if (markdown === lastSavedRef.current) return;

    setSaveStatus('saving');
    try {
      await onSave(markdown);
      lastSavedRef.current = markdown;
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch (error) {
      logger.error('Auto-save failed:', error);
      setSaveStatus('idle');
    }
  }, [onSave, htmlToMarkdown]);

  // Tiptap 编辑器
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: ({ node, editor: ed }) => {
          if (ed.isEmpty) return '输入章节内容... (输入 / 调用AI续写)';
          return '输入 / 调用AI续写';
        },
        showOnlyCurrent: true,
      }),
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'msp-tiptap-editor',
      },
    },
    onUpdate: ({ editor: ed }) => {
      // 500ms 防抖自动保存
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        doAutoSave(ed);
      }, 500);
    },
  });

  // 追踪是否已加载内容，避免重复设置
  const contentLoadedRef = useRef(false);

  // 进入编辑模式时加载内容（只在首次进入时加载）
  useEffect(() => {
    if (editor && isEditing && !contentLoadedRef.current) {
      const htmlContent = markdownToHtml(node?.content || '');
      editor.commands.setContent(htmlContent);
      lastSavedRef.current = node?.content || '';
      contentLoadedRef.current = true;
    }
    // 退出编辑模式时重置标志
    if (!isEditing) {
      contentLoadedRef.current = false;
    }
  }, [editor, isEditing, markdownToHtml]); // 移除 node?.content 依赖

  // 关闭模态框时重置状态
  useEffect(() => {
    if (!open) {
      setIsEditing(false);
      setSaveStatus('idle');
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    }
  }, [open]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // 监听光标变化：如果光标移到 `/` 之前，退出 prompt 模式
  useEffect(() => {
    if (!editor || !isAiPromptMode) return;
    const handleSelectionUpdate = () => {
      const startPos = aiPromptStartPosRef.current;
      if (startPos === null) return;
      const cursorPos = editor.state.selection.anchor;
      if (cursorPos < startPos) {
        setIsAiPromptMode(false);
        aiPromptStartPosRef.current = null;
      }
    };
    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => { editor.off('selectionUpdate', handleSelectionUpdate); };
  }, [editor, isAiPromptMode]);

  const processedContent = useMemo(() => {
    if (!node?.content) return '';
    return injectImageData(node.content, images || []);
  }, [node?.content, images]);

  // AI 内联助手：从编辑器提取 prompt 并调用后端 SSE 流式生成
  const handleAiGenerate = async () => {
    if (!editor || aiPromptStartPosRef.current === null) return;

    const startPos = aiPromptStartPosRef.current;
    const cursorPos = editor.state.selection.anchor;

    // 提取 `/` 到光标之间的文本作为 prompt（不含开头的 `/`）
    const docText = editor.state.doc.textBetween(startPos, cursorPos, '\n');
    const prompt = docText.trim();
    if (!prompt) {
      setIsAiPromptMode(false);
      aiPromptStartPosRef.current = null;
      return;
    }

    setIsAiLoading(true);
    const abortController = new AbortController();
    aiAbortRef.current = abortController;
    aiStreamBufferRef.current = '';

    try {
      // 上下文：/ 前 500 字符 + 光标后 500 字符
      const fullText = editor.state.doc.textContent;
      const slashOffset = editor.state.doc.textBetween(0, startPos > 1 ? startPos - 1 : 0, '\n').length;
      const cursorOffset = slashOffset + docText.length + 1;
      const beforeContext = fullText.substring(Math.max(0, slashOffset - 500), slashOffset);
      const afterContext = fullText.substring(cursorOffset, cursorOffset + 500);

      // 立即删除 "/prompt" 文本，记录插入位置
      const deleteFrom = startPos - 1; // `/` 字符的位置
      editor.chain().focus().deleteRange({ from: deleteFrom, to: cursorPos }).run();
      aiInsertPosRef.current = deleteFrom;

      const context = {
        chapterTitle: node?.title || '',
        chapterTitleEn: node?.title_en || '',
        currentContent: beforeContext + afterContext,
        userPrompt: prompt,
      };

      const response = await apiFetch('/api/modules/ai-assist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(context),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) throw new Error(data.error);
            if (data.done) break;
            if (data.content) {
              aiStreamBufferRef.current += data.content;
              // 逐 chunk 插入纯文本（光标自动前进）
              editor.commands.insertContent(data.content);
            }
          } catch (parseErr: any) {
            if (parseErr.message && !parseErr.message.startsWith('Unexpected')) throw parseErr;
          }
        }
      }

      // 流结束：用格式化 HTML 替换已插入的纯文本
      const fullMarkdown = aiStreamBufferRef.current;
      if (fullMarkdown && aiInsertPosRef.current !== null) {
        const insertStart = aiInsertPosRef.current;
        const insertEnd = insertStart + fullMarkdown.length;
        const generatedHtml = markdownToHtml(fullMarkdown);
        editor.chain()
          .focus()
          .deleteRange({ from: insertStart, to: insertEnd })
          .insertContentAt(insertStart, generatedHtml)
          .run();
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // Esc 取消 — 清理已插入的纯文本
        const buf = aiStreamBufferRef.current;
        if (buf && aiInsertPosRef.current !== null) {
          const insertStart = aiInsertPosRef.current;
          const insertEnd = insertStart + buf.length;
          editor.chain().focus().deleteRange({ from: insertStart, to: insertEnd }).run();
        }
      } else {
        logger.error('AI generation error:', error);
      }
    } finally {
      setIsAiLoading(false);
      setIsAiPromptMode(false);
      aiPromptStartPosRef.current = null;
      aiInsertPosRef.current = null;
      aiAbortRef.current = null;
      aiStreamBufferRef.current = '';
      editor?.commands.focus();
    }
  };

  // Chat 侧边栏：发送消息（SSE 流式 — chapter-agent 端点）
  const handleChatSend = async () => {
    if (!chatInput.trim() || !moduleId || isChatLoading) return;

    const userMsg = chatInput.trim();
    const sendContent = chatReplyTo ? `> ${chatReplyTo}\n\n${userMsg}` : userMsg;
    setChatInput('');
    setChatReplyTo(null);
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setChatMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true }]);
    setIsChatLoading(true);

    const abortController = new AbortController();
    chatAbortRef.current = abortController;

    try {
      const { getAuthToken } = await import('~/utils/auth');
      const token = getAuthToken();

      const response = await fetch(
        `${API_BASE_URL}/api/modules/${moduleId}/chapter-agent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            content: sendContent,
            chapter_title: node?.title || '',
            chapter_content: node?.content || '',
          }),
          signal: abortController.signal,
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              // New agent SSE format uses { type, content, edits, ... }
              const evtType = data.type;

              if (evtType === 'text') {
                if (data.user_message_id) {
                  setChatMessages(prev => {
                    const msgs = [...prev];
                    for (let j = msgs.length - 1; j >= 0; j--) {
                      if (msgs[j].role === 'user' && !msgs[j].id) {
                        msgs[j] = { ...msgs[j], id: data.user_message_id };
                        break;
                      }
                    }
                    return msgs;
                  });
                }
                if (data.content) {
                  setChatMessages(prev => {
                    const msgs = [...prev];
                    const last = msgs.length - 1;
                    if (last >= 0 && msgs[last].role === 'assistant') {
                      msgs[last] = { ...msgs[last], content: msgs[last].content + data.content };
                    }
                    return msgs;
                  });
                }
              } else if (evtType === 'edit' && data.edits) {
                setChatMessages(prev => {
                  const msgs = [...prev];
                  const last = msgs.length - 1;
                  if (last >= 0 && msgs[last].role === 'assistant') {
                    msgs[last] = { ...msgs[last], edits: data.edits };
                  }
                  return msgs;
                });
              } else if (evtType === 'tool_call') {
                setChatMessages(prev => {
                  const msgs = [...prev];
                  const last = msgs.length - 1;
                  if (last >= 0 && msgs[last].role === 'assistant') {
                    const tc = msgs[last].toolCalls || [];
                    msgs[last] = { ...msgs[last], toolCalls: [...tc, { name: data.tool_name, summary: data.content }] };
                  }
                  return msgs;
                });
              } else if (evtType === 'done') {
                setChatMessages(prev => {
                  const msgs = [...prev];
                  const last = msgs.length - 1;
                  if (last >= 0 && msgs[last].role === 'assistant') {
                    msgs[last] = { ...msgs[last], id: data.message_id, isStreaming: false };
                  }
                  return msgs;
                });
              } else if (evtType === 'error') {
                setChatMessages(prev => {
                  const msgs = [...prev];
                  const last = msgs.length - 1;
                  if (last >= 0 && msgs[last].role === 'assistant') {
                    msgs[last] = { ...msgs[last], content: msgs[last].content + `\n\n> 错误: ${data.content}`, isStreaming: false };
                  }
                  return msgs;
                });
              }

              // Fallback: handle legacy format (no type field)
              if (!evtType) {
                if (data.user_message_id) {
                  setChatMessages(prev => {
                    const msgs = [...prev];
                    for (let j = msgs.length - 1; j >= 0; j--) {
                      if (msgs[j].role === 'user' && !msgs[j].id) {
                        msgs[j] = { ...msgs[j], id: data.user_message_id };
                        break;
                      }
                    }
                    return msgs;
                  });
                }
                if (data.content) {
                  setChatMessages(prev => {
                    const msgs = [...prev];
                    const last = msgs.length - 1;
                    if (last >= 0 && msgs[last].role === 'assistant') {
                      msgs[last] = { ...msgs[last], content: msgs[last].content + data.content };
                    }
                    return msgs;
                  });
                }
                if (data.done) {
                  setChatMessages(prev => {
                    const msgs = [...prev];
                    const last = msgs.length - 1;
                    if (last >= 0 && msgs[last].role === 'assistant') {
                      msgs[last] = {
                        ...msgs[last],
                        id: data.message_id,
                        isStreaming: false,
                        ...(data.processed_content ? { content: data.processed_content } : {}),
                      };
                    }
                    return msgs;
                  });
                }
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setChatMessages(prev => {
          const msgs = [...prev];
          const last = msgs.length - 1;
          if (last >= 0 && msgs[last].role === 'assistant' && !msgs[last].content) {
            msgs[last] = { ...msgs[last], content: '请求失败，请重试。' };
          }
          return msgs;
        });
      }
    } finally {
      setIsChatLoading(false);
      setChatMessages(prev => prev.map(m => ({ ...m, isStreaming: false })));
      chatAbortRef.current = null;
    }
  };

  // Chat auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // 删除单条聊天消息
  const handleChatDelete = async (msgId: number, idx: number) => {
    if (!moduleId) return;
    try {
      const res = await apiFetch(`/api/modules/${moduleId}/chat/${msgId}`, { method: 'DELETE' });
      if (res.ok) {
        setChatMessages(prev => prev.filter((_, i) => i !== idx));
      }
    } catch (err) {
      logger.error('Failed to delete chat message:', err);
    }
  };

  // 清空当前章节的聊天历史
  const handleChatClear = async () => {
    if (!moduleId || !confirm('确定要清空聊天记录吗？')) return;
    try {
      const res = await apiFetch(`/api/modules/${moduleId}/chat`, { method: 'DELETE' });
      if (res.ok) setChatMessages([]);
    } catch (err) {
      logger.error('Failed to clear chat history:', err);
    }
  };

  // 应用 AI Agent 的编辑操作到编辑器（行范围编辑）
  const applyEditOperations = (editorInst: any, edits: RangeEdit[]) => {
    if (!editorInst || edits.length === 0) return;

    // 1. Get current content as markdown
    const currentHtml = editorInst.getHTML();
    const markdown = htmlToMarkdown(currentHtml);
    const lines = markdown.split('\n');

    // 2. Sort edits by start_line descending (apply bottom-up to preserve line numbers)
    const sorted = [...edits].sort((a, b) => b.start_line - a.start_line);

    // 3. Apply each edit
    for (const edit of sorted) {
      const startIdx = Math.max(0, edit.start_line - 1);
      const deleteCount = Math.max(0, edit.end_line - edit.start_line + 1);
      const newLines = edit.content.split('\n');
      lines.splice(startIdx, deleteCount, ...newLines);
    }

    // 4. Convert back to HTML and set content
    const newMarkdown = lines.join('\n');
    const newHtml = markdownToHtml(newMarkdown);
    editorInst.commands.setContent(newHtml);
  };

  const handleApplyEdits = (msgIdx: number) => {
    const msg = chatMessages[msgIdx];
    if (!msg?.edits || !editor) return;
    applyEditOperations(editor, msg.edits);
    setChatMessages(prev => {
      const msgs = [...prev];
      msgs[msgIdx] = { ...msgs[msgIdx], editsApplied: true };
      return msgs;
    });
  };

  // === Chat UI 状态持久化（DB preferences） ===
  const chatUiKey = moduleId && node?.title ? `chat_ui_${moduleId}_${node.title}` : '';

  const saveChatUiState = useCallback((width: number, open: boolean) => {
    if (!userId || !chatUiKey) return;
    if (chatUiSaveTimer.current) clearTimeout(chatUiSaveTimer.current);
    chatUiSaveTimer.current = setTimeout(async () => {
      try {
        await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}/preferences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferences: { [chatUiKey]: { width, open } } }),
        });
      } catch { /* silently ignore */ }
    }, 500);
  }, [userId, chatUiKey]);

  // 切换章节时从 DB 恢复 sidebar 状态
  useEffect(() => {
    if (!userId || !chatUiKey) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}/preferences`);
        if (!res.ok || cancelled) return;
        const prefs = await res.json();
        const saved = prefs[chatUiKey];
        if (saved) {
          if (typeof saved.width === 'number') {
            const w = Math.max(260, Math.min(700, saved.width));
            setChatWidth(w);
            chatWidthRef.current = w;
          }
          if (typeof saved.open === 'boolean') setShowChatSidebar(saved.open);
        }
      } catch { /* silently ignore */ }
    })();
    return () => { cancelled = true; };
  }, [userId, chatUiKey]);

  // sidebar 展开/收起时保存
  useEffect(() => {
    if (!chatUiKey) return;
    saveChatUiState(chatWidthRef.current, showChatSidebar);
  }, [showChatSidebar, chatUiKey, saveChatUiState]);

  // Chat 侧边栏拖拽调整宽度
  const chatWidthRef = useRef(chatWidth);
  const handleChatResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = chatWidthRef.current;
    const saveRef = saveChatUiState;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(260, Math.min(700, startW + (startX - ev.clientX)));
      chatWidthRef.current = w;
      setChatWidth(w);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveRef(chatWidthRef.current, true);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [saveChatUiState]);

  // 关闭 sidebar 时取消请求
  useEffect(() => {
    if (!showChatSidebar && chatAbortRef.current) {
      chatAbortRef.current.abort();
    }
  }, [showChatSidebar]);

  // 打开 sidebar 或切换章节时加载聊天历史
  useEffect(() => {
    if (!showChatSidebar || !moduleId || !node?.title) return;
    const loadHistory = async () => {
      try {
        const params = new URLSearchParams({
          chapter_title: node.title,
          limit: '100',
        });
        const res = await apiFetch(`/api/modules/${moduleId}/chat?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages?.length) {
          setChatMessages(data.messages.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            toolCalls: m.tool_calls,
          })));
        } else {
          setChatMessages([]);
        }
      } catch {
        // silently ignore
      }
    };
    loadHistory();
  }, [showChatSidebar, moduleId, node?.title]);

  // Textarea 自动增高
  const autoResizeTextarea = useCallback(() => {
    const el = chatInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  useEffect(() => {
    autoResizeTextarea();
  }, [chatInput, autoResizeTextarea]);

  // 退出编辑模式（先保存未保存的内容）
  const handleExitEdit = async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (editor && onSave) {
      await doAutoSave(editor);
    }
    setIsEditing(false);
  };

  // 双击标题进入编辑模式
  const handleTitleDoubleClick = () => {
    if (isEditable && node) {
      setEditingTitle(node.title || '');
      setIsEditingTitle(true);
    }
  };

  // 保存标题
  const handleSaveTitle = async () => {
    if (!onSaveTitle || !editingTitle.trim()) return;
    try {
      await onSaveTitle(editingTitle.trim());
      setIsEditingTitle(false);
    } catch (error) {
      logger.error('Failed to save title:', error);
    }
  };

  // 标题输入框按键处理
  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false);
    }
  };

  return (
    <Dialog.Root open={open && !!node} onOpenChange={handleOpenChange}>
      <Dialog.Content
        aria-describedby={undefined}
        style={{
          maxWidth: showChatSidebar && isEditing ? '1440px' : '1000px',
          maxHeight: '90vh',
          padding: '28px',
          transition: 'max-width 0.3s ease',
          position: 'relative',
        }}
      >
        {/* Close button */}
        <Dialog.Close>
          <IconButton
            size="2"
            variant="ghost"
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              zIndex: 20,
              color: 'var(--gray-a11)',
            }}
            aria-label="关闭"
          >
            <X size={18} />
          </IconButton>
        </Dialog.Close>
        {node && (
          <Flex style={{ position: 'relative' }}>
            {/* 左侧：编辑区 */}
            <div style={{ flex: 1, minWidth: 0 }}>
            <Dialog.Title>
              <Flex align="center" justify="between" gap="2">
                <Flex align="center" gap="2" style={{ flex: 1 }}>
                  {node.emoji && <Text size="6"><span>{node.emoji}</span></Text>}
                  {isEditingTitle ? (
                    <TextField.Root
                      size="3"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={handleTitleKeyDown}
                      onBlur={handleSaveTitle}
                      autoFocus
                      style={{ flex: 1, fontWeight: 'bold' }}
                      placeholder="输入章节标题"
                    />
                  ) : (
                    <Text
                      size="6"
                      weight="bold"
                      onDoubleClick={handleTitleDoubleClick}
                      style={{ cursor: isEditable ? 'pointer' : 'default' }}
                      title={isEditable ? '双击修改标题' : undefined}
                      className={isEditable ? 'msp-editable-title' : ''}
                    >
                      <span>{node.title}</span>
                    </Text>
                  )}
                </Flex>
                {isEditable && !isEditing && !isEditingTitle && (
                  <IconButton
                    size="2"
                    variant="ghost"
                    onClick={() => setIsEditing(true)}
                    title="编辑内容"
                    className="msp-edit-btn"
                  >
                    <Edit2 size={18} />
                  </IconButton>
                )}
                {isEditing && (
                  <Flex gap="3" align="center">
                    <Text size="1" className={`msp-save-status ${saveStatus}`}>
                      {saveStatus === 'saving' && '保存中...'}
                      {saveStatus === 'saved' && '✓ 已保存'}
                    </Text>
                    <Button size="1" variant="soft" onClick={handleExitEdit}>
                      完成
                    </Button>
                  </Flex>
                )}
              </Flex>
            </Dialog.Title>

            {node.title_en && (
              <Dialog.Description size="2" color="gray" mt="1">
                <span>{node.title_en}</span>
              </Dialog.Description>
            )}

            {isEditing ? (
              <div
                className="msp-editor-container"
                style={{ position: 'relative', marginTop: '16px' }}
                onKeyDown={(e) => {
                  if (!editor) return;

                  if (isAiPromptMode) {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      // Enter → 触发 AI 生成
                      e.preventDefault();
                      handleAiGenerate();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      if (isAiLoading && aiAbortRef.current) {
                        // 流式生成中 → 中止请求（catch 中会清理已插入文本）
                        aiAbortRef.current.abort();
                      } else {
                        // 未开始生成 → 删除 /prompt 文本，退出
                        const startPos = aiPromptStartPosRef.current;
                        if (startPos !== null) {
                          const cursorPos = editor.state.selection.anchor;
                          editor.chain().focus().deleteRange({ from: startPos - 1, to: cursorPos }).run();
                        }
                        setIsAiPromptMode(false);
                        aiPromptStartPosRef.current = null;
                      }
                    }
                  } else if (e.key === '/' && !isAiLoading) {
                    // 进入 prompt 模式，让 `/` 正常插入到编辑器
                    setTimeout(() => {
                      if (!editor) return;
                      const pos = editor.state.selection.anchor;
                      // 检查是否输入了 `//`（前一个字符也是 `/`）
                      if (pos >= 2) {
                        const textBefore = editor.state.doc.textBetween(pos - 2, pos, '\n');
                        if (textBefore === '//') {
                          // `//` → 替换为单个 `/`
                          editor.chain().focus().deleteRange({ from: pos - 2, to: pos }).insertContent('/').run();
                          return;
                        }
                      }
                      aiPromptStartPosRef.current = pos;
                      setIsAiPromptMode(true);
                    }, 0);
                  }
                }}
              >
                <EditorToolbar editor={editor} />
                <ScrollArea style={{ maxHeight: '60vh' }}>
                  <EditorContent editor={editor} />
                </ScrollArea>

                {/* AI 内联提示条 */}
                {(isAiPromptMode || isAiLoading) && (
                  <div className="msp-ai-hint">
                    {isAiLoading
                      ? <><span className="msp-loading-spinner" style={{ width: 12, height: 12 }} /> AI 生成中... · Esc 取消</>
                      : <>AI 模式 · Enter 生成 · Esc 取消</>
                    }
                  </div>
                )}
              </div>
            ) : (
              <ScrollArea style={{ maxHeight: '75vh', marginTop: '24px' }}>
                {processedContent ? (
                  <StyledMarkdown content={processedContent} />
                ) : (
                  <Text size="2" color="gray">
                    <span>该章节暂无内容</span>
                  </Text>
                )}
              </ScrollArea>
            )}

            {node.content_length && !isEditing && (
              <Flex gap="2" mt="3">
                <Badge size="1" variant="soft">{node.content_length} 字</Badge>
              </Flex>
            )}
            </div>

            {/* 右侧 AI Chat Tab 按钮 */}
            {isEditing && moduleId && (
              <button
                className={`msp-chat-tab ${showChatSidebar ? 'msp-chat-tab--active' : ''}`}
                onClick={() => setShowChatSidebar(!showChatSidebar)}
                title={showChatSidebar ? '收起 AI Chat' : '展开 AI Chat'}
              >
                <MessageCircle size={14} />
                <span>AI</span>
              </button>
            )}

            {/* 右侧 Chat 侧边栏 */}
            {isEditing && showChatSidebar && moduleId && (
              <div className="msp-chat-sidebar" style={{ width: chatWidth }}>
                <div className="msp-chat-resize-handle" onMouseDown={handleChatResize} />
                <Flex direction="column" style={{ height: '100%' }}>
                  {/* Header */}
                  <Flex align="center" justify="between" className="msp-chat-sidebar-header">
                    <Flex align="center" gap="2">
                      <MessageCircle size={14} style={{ color: 'var(--msp-amber)' }} />
                      <Text size="2" weight="bold" style={{ color: 'var(--msp-amber)' }}>AI Chat</Text>
                    </Flex>
                    <Flex align="center" gap="1">
                      {chatMessages.length > 0 && (
                        <IconButton size="1" variant="ghost" onClick={handleChatClear} title="清空聊天记录">
                          <Trash2 size={13} style={{ opacity: 0.5 }} />
                        </IconButton>
                      )}
                      <IconButton size="1" variant="ghost" onClick={() => setShowChatSidebar(false)}>
                        <X size={14} />
                      </IconButton>
                    </Flex>
                  </Flex>

                  {/* Messages */}
                  <div className="msp-chat-messages">
                    {chatMessages.length === 0 && (
                      <div className="msp-chat-empty">
                        <MessageCircle size={24} style={{ opacity: 0.3 }} />
                        <Text size="1" color="gray" style={{ marginTop: 8 }}>
                          关于「{node.title}」的问题，随时提问
                        </Text>
                      </div>
                    )}
                    {chatMessages.map((msg, i) => {
                      // 清理 AI 回复中的实体标签（<!--NPC-->等）
                      const displayContent = msg.role === 'assistant'
                        ? (msg.content || (msg.isStreaming ? '...' : ''))
                            .replace(/<!--MAP_MARKERS-->\s*[\s\S]*?\s*<!--\/MAP_MARKERS-->/gi, '')
                            .replace(/<!--\s?(?:NPC|SHOP|ITEM|ENCOUNTER|BOSS|MAP)(?:[^>]*)-->/gi, '')
                            .replace(/<!--HAS:[A-Z,]+-->/gi, '')
                            .trim()
                        : msg.content;
                      const isCollapsed = msg.id ? collapsedChatMsgs.has(msg.id) : false;
                      const isLong = msg.role === 'assistant' && displayContent.length > 200;
                      return (
                        <div key={msg.id || i} className={`msp-chat-msg msp-chat-msg--${msg.role}`}>
                          {/* Thinking steps for assistant messages with tool calls */}
                          {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (() => {
                            const toolNameMap: Record<string, string> = {
                              search_module_content: '搜索模组内容',
                              search_rules: '查询D&D规则',
                              get_creator_guide: '查阅创作指南',
                              edit_content: '编辑内容',
                            };
                            const toolIconMap: Record<string, React.ReactNode> = {
                              search_module_content: <Search size={12} />,
                              search_rules: <BookOpen size={12} />,
                              get_creator_guide: <Lightbulb size={12} />,
                              edit_content: <FileEdit size={12} />,
                            };
                            const hasContent = !!msg.content;
                            const isExpanded = !hasContent || expandedThinking.has(i);
                            return (
                              <div className={`msp-chat-thinking ${!isExpanded ? 'msp-chat-thinking--collapsed' : ''}`}>
                                <button
                                  className="msp-chat-thinking-header"
                                  onClick={() => {
                                    if (hasContent) {
                                      setExpandedThinking(prev => {
                                        const s = new Set(prev);
                                        s.has(i) ? s.delete(i) : s.add(i);
                                        return s;
                                      });
                                    }
                                  }}
                                >
                                  <span className="msp-chat-thinking-icon">
                                    {!hasContent ? <span className="msp-loading-spinner" style={{ width: 12, height: 12 }} /> : isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                  </span>
                                  <span>{!hasContent ? '正在思考...' : `思考过程 (${msg.toolCalls.length})`}</span>
                                </button>
                                {isExpanded && (
                                  <div className="msp-chat-thinking-steps">
                                    {msg.toolCalls.map((tc, ti) => (
                                      <div key={ti} className="msp-chat-thinking-step">
                                        <span className="msp-chat-thinking-step-icon">{toolIconMap[tc.name] || <Search size={12} />}</span>
                                        <span className="msp-chat-thinking-step-name">{toolNameMap[tc.name] || tc.name}</span>
                                        {tc.summary && <span className="msp-chat-thinking-step-summary">{tc.summary}</span>}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          <div className={`msp-chat-msg-bubble ${isCollapsed ? 'msp-chat-msg-bubble--collapsed' : ''}`}>
                            {isCollapsed ? (
                              <Text size="1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                                {displayContent.slice(0, 80)}...
                              </Text>
                            ) : msg.role === 'assistant' ? (
                              <ReactMarkdown remarkPlugins={remarkPluginsStable}>{displayContent}</ReactMarkdown>
                            ) : (
                              <Text size="2">{displayContent}</Text>
                            )}
                          </div>
                          {/* Edit operations confirmation card */}
                          {msg.edits && msg.edits.length > 0 && !msg.isStreaming && (
                            <div className="msp-chat-edit-card">
                              <Text size="1" weight="bold" style={{ color: 'var(--msp-amber)', marginBottom: 4 }}>
                                {msg.editsApplied ? '✓ 修改已应用' : `${msg.edits.length} 项修改操作`}
                              </Text>
                              {msg.edits.map((edit, ei) => {
                                const isLong = edit.content.length > 60;
                                const editKey = `edit-${i}-${ei}`;
                                const isExpanded = expandedEdits.has(editKey);
                                return (
                                <div key={ei} className="msp-chat-edit-item" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                                    <Badge size="1" variant="soft" style={{ fontSize: '10px', flexShrink: 0 }}>
                                      L{edit.start_line}{edit.end_line >= edit.start_line ? `-${edit.end_line}` : '+'}
                                    </Badge>
                                    <Text size="1" style={{ color: 'rgba(255,255,255,0.6)', marginLeft: 4, flex: 1 }}>
                                      {edit.content.slice(0, 60)}{!isExpanded && isLong ? '...' : ''}
                                    </Text>
                                    {isLong && (
                                      <button
                                        style={{ background: 'none', border: 'none', color: 'var(--msp-amber)', cursor: 'pointer', fontSize: 11, padding: '0 4px', flexShrink: 0 }}
                                        onClick={() => setExpandedEdits(prev => {
                                          const next = new Set(prev);
                                          if (next.has(editKey)) next.delete(editKey); else next.add(editKey);
                                          return next;
                                        })}
                                      >
                                        {isExpanded ? '收起' : '展开'}
                                      </button>
                                    )}
                                  </div>
                                  {isExpanded && (
                                    <pre style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, lineHeight: 1.5, margin: '6px 0 2px', padding: '8px', background: 'rgba(0,0,0,0.3)', borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', width: '100%', maxHeight: 300, overflow: 'auto' }}>
                                      {edit.content}
                                    </pre>
                                  )}
                                </div>
                                );
                              })}
                              {!msg.editsApplied && (
                                <Flex gap="2" mt="2">
                                  <button
                                    className="msp-chat-edit-apply-btn"
                                    onClick={() => handleApplyEdits(i)}
                                  >
                                    应用修改
                                  </button>
                                  <button
                                    className="msp-chat-edit-dismiss-btn"
                                    onClick={() => setChatMessages(prev => {
                                      const msgs = [...prev];
                                      msgs[i] = { ...msgs[i], edits: undefined };
                                      return msgs;
                                    })}
                                  >
                                    忽略
                                  </button>
                                </Flex>
                              )}
                            </div>
                          )}
                          {msg.id && !msg.isStreaming && (
                            <div className="msp-chat-msg-actions">
                              {msg.role === 'assistant' && (
                                <button
                                  className="msp-chat-action-btn"
                                  onClick={() => {
                                    const plain = displayContent.replace(/[#*`>|]/g, '').trim();
                                    setChatReplyTo(plain.length > 80 ? plain.slice(0, 77) + '...' : plain);
                                  }}
                                  title="回复"
                                >
                                  <CornerDownRight size={11} />
                                </button>
                              )}
                              {msg.role === 'assistant' && (
                                <button
                                  className={`msp-chat-action-btn ${copiedChatMsgId === msg.id ? 'msp-chat-action-btn--success' : ''}`}
                                  onClick={() => {
                                    navigator.clipboard.writeText(displayContent);
                                    setCopiedChatMsgId(msg.id!);
                                    setTimeout(() => setCopiedChatMsgId(null), 1500);
                                  }}
                                  title={copiedChatMsgId === msg.id ? '已复制' : '复制'}
                                >
                                  {copiedChatMsgId === msg.id ? <Check size={11} /> : <Copy size={11} />}
                                </button>
                              )}
                              {msg.role === 'assistant' && (
                                <button
                                  className={`msp-chat-action-btn ${ttsPlayingId === String(msg.id) ? 'msp-chat-action-btn--active' : ''}`}
                                  onClick={() => handleTTS(String(msg.id), displayContent, msg.id)}
                                  disabled={ttsLoading === String(msg.id)}
                                  title={ttsPlayingId === String(msg.id) ? '停止朗读' : '朗读'}
                                >
                                  {ttsLoading === String(msg.id) ? <Loader2 size={11} className="animate-spin" /> : ttsPlayingId === String(msg.id) ? <Square size={11} /> : <Volume2 size={11} />}
                                </button>
                              )}
                              {isLong && (
                                <button
                                  className="msp-chat-action-btn"
                                  onClick={() => setCollapsedChatMsgs(prev => {
                                    const s = new Set(prev);
                                    s.has(msg.id!) ? s.delete(msg.id!) : s.add(msg.id!);
                                    return s;
                                  })}
                                  title={isCollapsed ? '展开' : '折叠'}
                                >
                                  {isCollapsed ? <ChevronDown size={11} /> : <Minus size={11} />}
                                </button>
                              )}
                              <button
                                className="msp-chat-action-btn msp-chat-action-btn--danger"
                                onClick={() => handleChatDelete(msg.id!, i)}
                                title="删除"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Input */}
                  <div className="msp-chat-input-area">
                    {chatReplyTo && (
                      <div className="msp-chat-reply-bar">
                        <div className="msp-chat-reply-text">{chatReplyTo}</div>
                        <button className="msp-chat-reply-dismiss" onClick={() => setChatReplyTo(null)}>
                          <X size={12} />
                        </button>
                      </div>
                    )}
                    <Flex gap="2" align="end">
                      <textarea
                        ref={chatInputRef}
                        className="msp-chat-textarea"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleChatSend();
                          }
                        }}
                        placeholder="输入问题..."
                        rows={1}
                        disabled={isChatLoading}
                      />
                      <IconButton
                        size="2"
                        onClick={handleChatSend}
                        disabled={isChatLoading || !chatInput.trim()}
                        style={{
                          background: 'linear-gradient(135deg, var(--msp-amber) 0%, var(--msp-amber-dim) 100%)',
                          color: '#000',
                          flexShrink: 0,
                        }}
                      >
                        <Send size={14} />
                      </IconButton>
                    </Flex>
                  </div>
                </Flex>
              </div>
            )}
          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

// 物品详情模态框
function ItemDetailModal({
  item,
  open,
  onClose
}: {
  item: any | null;
  open: boolean;
  onClose: () => void;
}) {
  const handleOpenChange = useFloatingGuardedClose(onClose);
  return (
    <Dialog.Root open={open && !!item} onOpenChange={handleOpenChange}>
      <Dialog.Content aria-describedby={undefined}
        style={{ maxWidth: '800px', maxHeight: '80vh' }}>
        {item && (
          <>
            <Dialog.Title>
              <Flex align="center" gap="2">
                <Text><span>{item.name}</span></Text>
              </Flex>
            </Dialog.Title>

            {item.name_en && (
              <Dialog.Description size="2" color="gray" mt="1">
                <span>{item.name_en}</span>
              </Dialog.Description>
            )}

            <ScrollArea style={{ maxHeight: '60vh', marginTop: '16px' }}>
              <Flex direction="column" gap="3">
                {/* 基础信息标签 */}
                <Flex gap="2" wrap="wrap">
                  {item.category && (
                    <Badge size="2" variant="soft"><span>{tCategory(item.category)}</span></Badge>
                  )}
                  {item.rarity && (
                    <Badge size="2" color="purple"><span>{tRarity(item.rarity)}</span></Badge>
                  )}
                  {item.requires_attunement && (
                    <Badge size="2" color="amber">需要调谐</Badge>
                  )}
                </Flex>

                {/* 完整描述 */}
                {item.description && (
                  <Box>
                    <Text size="2" weight="bold">描述</Text>
                    <Box mt="1">
                      <StyledMarkdown content={item.description} />
                    </Box>
                  </Box>
                )}

                {/* 其他属性 */}
                {item.weight && (
                  <Box>
                    <Text size="2" weight="bold">Weight:</Text>
                    <Text size="2" style={{ marginLeft: '8px' }}>{item.weight}</Text>
                  </Box>
                )}

                {item.value && (
                  <Box>
                    <Text size="2" weight="bold">Value:</Text>
                    <Text size="2" style={{ marginLeft: '8px' }}>{item.value}</Text>
                  </Box>
                )}

                {item.properties && item.properties.length > 0 && (
                  <Box>
                    <Text size="2" weight="bold">Properties:</Text>
                    <Flex gap="1" wrap="wrap" mt="2">
                      {item.properties.map((prop: string, idx: number) => (
                        <Badge key={idx} size="1" variant="outline">{prop}</Badge>
                      ))}
                    </Flex>
                  </Box>
                )}

                {/* 动作/特殊能力 - 兼容新格式 */}
                {item.actions && (
                  <Box>
                    <Text size="2" weight="bold">特殊能力:</Text>
                    <Text size="2" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', marginTop: '4px' }}>
                      {item.actions}
                    </Text>
                  </Box>
                )}
              </Flex>
            </ScrollArea>
          </>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

// 章节树节点组件
function ChapterTreeNode({
  node,
  depth = 0,
  images = [],
  moduleId,
  path = [],
  onEditChapter,
  onSaveContent,
  onSaveTitle,
  onAddSubChapter,
  isEditable = false
}: {
  node: any;
  depth?: number;
  images?: Array<{image_id: string; oss_url?: string; thumbnail_url?: string; image_base64?: string}>;
  moduleId?: string;
  path?: number[];
  onEditChapter?: (path: number[], node: any) => void;
  onSaveContent?: (path: number[], content: string) => Promise<void>;
  onSaveTitle?: (path: number[], title: string) => Promise<void>;
  onAddSubChapter?: (path: number[]) => void;
  isEditable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false); // 默认全部收起
  const [showModal, setShowModal] = useState(false);

  const hasChildren = node.children && node.children.length > 0;
  const indent = depth * 16; // 每层缩进16px

  // 点击整行：展开/收起子菜单（如果有子节点）
  const handleRowClick = () => {
    if (hasChildren) {
      setExpanded(!expanded);
    } else {
      // 没有子节点时，点击直接打开内容
      setShowModal(true);
    }
  };

  // 点击查看按钮：打开模态框
  const handleShowContent = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowModal(true);
  };

  // 添加子章节
  const handleAddSubChapter = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAddSubChapter) {
      onAddSubChapter(path);
    }
  };

  // 保存内容（从模态框内编辑）
  const handleSaveContent = async (content: string) => {
    if (onSaveContent) {
      await onSaveContent(path, content);
    }
  };

  // 保存标题（从模态框内编辑）
  const handleSaveTitle = async (title: string) => {
    if (onSaveTitle) {
      await onSaveTitle(path, title);
    }
  };

  return (
    <>
      <Box style={{ marginLeft: `${indent}px` }}>
        <div
          className={`msp-chapter-node ${depth === 0 ? 'msp-chapter-node--depth-0' : ''} ${hasChildren ? 'msp-chapter-node--expandable' : ''} msp-animate-in`}
          onClick={handleRowClick}
        >
          <Flex align="center" gap="2">
            {/* 展开/收起指示器 - 更大更明显 */}
            <div className={`msp-chapter-expand-indicator ${hasChildren ? 'msp-chapter-expand-indicator--has-children' : ''} ${expanded ? 'msp-chapter-expand-indicator--expanded' : ''}`}>
              {hasChildren ? (
                <ChevronRight size={16} className={`msp-chapter-chevron ${expanded ? 'msp-chapter-chevron--expanded' : ''}`} />
              ) : (
                <span className="msp-chapter-dot" />
              )}
            </div>
            {node.emoji && <Text size="2">{node.emoji}</Text>}
            <Box style={{ flex: 1 }}>
              <span className={`msp-chapter-title ${depth === 0 ? 'text-sm' : 'text-xs'}`}>
                {node.title}
              </span>
              {node.title_en && (
                <span className="msp-chapter-title-en ml-2">
                  ({node.title_en})
                </span>
              )}
            </Box>
            {node.content_length && (
              <span className="msp-sub-tab-count">{node.content_length} 字</span>
            )}
            {/* 查看内容按钮 - 有子节点时显示，便于查看当前章节内容 */}
            {hasChildren && node.content && (
              <IconButton size="1" variant="ghost" onClick={handleShowContent} title="查看内容">
                <Eye size={14} />
              </IconButton>
            )}
            {/* 添加子章节按钮 */}
            {isEditable && (
              <IconButton
                size="1"
                variant="ghost"
                onClick={handleAddSubChapter}
                title="添加子章节"
                className="msp-add-sub-btn"
              >
                <Plus size={14} />
              </IconButton>
            )}
          </Flex>
        </div>

        {expanded && hasChildren && (
          <Box className="msp-animate-in">
            {node.children.map((child: any, index: number) => (
              <ChapterTreeNode
                key={index}
                node={child}
                depth={depth + 1}
                images={images}
                moduleId={moduleId}
                path={[...path, index]}
                onEditChapter={onEditChapter}
                onSaveContent={onSaveContent}
                onSaveTitle={onSaveTitle}
                onAddSubChapter={onAddSubChapter}
                isEditable={isEditable}
              />
            ))}
          </Box>
        )}
      </Box>

      {/* 章节内容模态框 */}
      <ChapterContentModal
        node={node}
        open={showModal}
        onClose={() => setShowModal(false)}
        images={images}
        isEditable={isEditable}
        onSave={handleSaveContent}
        onSaveTitle={handleSaveTitle}
        moduleId={moduleId}
      />
    </>
  );
}

// 构建章节标题到父章节的映射
function buildChapterParentMap(chapterTree: any[]): Map<string, string> {
  const map = new Map<string, string>();

  function traverse(nodes: any[], parentChapter: string = '') {
    for (const node of nodes) {
      const title = node.title || '';
      // 判断是否是顶级章节（第X章 或 附录）
      const isTopLevel = /^(第\d+章|附录|简介|前言|目录|制作组|HOARD)/.test(title);

      if (isTopLevel) {
        // 这是顶级章节，记录为自己的父章节
        map.set(title, '');
        // 递归处理子节点
        if (node.children && node.children.length > 0) {
          traverse(node.children, title);
        }
      } else {
        // 这是子节点，记录父章节
        map.set(title, parentChapter);
        // 递归处理子节点，继续传递父章节
        if (node.children && node.children.length > 0) {
          traverse(node.children, parentChapter || title);
        }
      }
    }
  }

  traverse(chapterTree);
  return map;
}

// 按章节分组的图片组件
function ImagesByChapter({
  images,
  selectedModule,
  userId,
  addingMapId,
  addedMaps,
  onAddMap,
  chapterTree,
  onSendToChat,
  members
}: {
  images: any[];
  selectedModule: string | null;
  userId: string;
  addingMapId: string | number | null;
  addedMaps: Set<number>;
  onAddMap: (image: any, index: number) => void;
  chapterTree: any[];
  onSendToChat?: (imageUrl: string, description: string, recipient?: string, thumbnailUrl?: string) => void;
  members?: CampaignMember[];
}) {
  // 构建章节父级映射
  const chapterParentMap = useMemo(() => buildChapterParentMap(chapterTree), [chapterTree]);

  // 按章节分组，并附带父章节信息
  const groupedByChapter = useMemo(() => {
    const groups: Record<string, { images: any[]; parentChapter: string }> = {};
    images.forEach((img, index) => {
      const chapter = img.chapter || img.bound_to?.title || '未分类';
      if (!groups[chapter]) {
        const parentChapter = chapterParentMap.get(chapter) || '';
        groups[chapter] = { images: [], parentChapter };
      }
      groups[chapter].images.push({ ...img, originalIndex: index });
    });
    return groups;
  }, [images, chapterParentMap]);

  // 按父章节排序，然后按章节名排序
  const sortedChapters = useMemo(() => {
    return Object.entries(groupedByChapter).sort((a, b) => {
      const parentA = a[1].parentChapter || a[0];
      const parentB = b[1].parentChapter || b[0];
      if (parentA !== parentB) {
        return parentA.localeCompare(parentB, 'zh-CN');
      }
      return a[0].localeCompare(b[0], 'zh-CN');
    });
  }, [groupedByChapter]);

  return (
    <Flex direction="column" gap="2">
      {sortedChapters.map(([chapter, data]) => (
        <ChapterImageGroup
          key={chapter}
          chapter={chapter}
          parentChapter={data.parentChapter}
          images={data.images}
          selectedModule={selectedModule}
          userId={userId}
          addingMapId={addingMapId}
          addedMaps={addedMaps}
          onAddMap={onAddMap}
          onSendToChat={onSendToChat}
          members={members}
        />
      ))}
    </Flex>
  );
}

// 单个章节的图片组
function ChapterImageGroup({
  chapter,
  parentChapter,
  images,
  selectedModule,
  userId,
  addingMapId,
  addedMaps,
  onAddMap,
  onSendToChat,
  members
}: {
  chapter: string;
  parentChapter: string;
  images: any[];
  selectedModule: string | null;
  userId: string;
  addingMapId: string | number | null;
  addedMaps: Set<number>;
  onAddMap: (image: any, index: number) => void;
  onSendToChat?: (imageUrl: string, description: string, recipient?: string, thumbnailUrl?: string) => void;
  members?: CampaignMember[];
}) {
  const [expanded, setExpanded] = useState(false);

  // 按类别分组: 地图, 场景, 立绘
  const categorized = useMemo(() => {
    const maps: any[] = [];
    const scenes: any[] = [];
    const portraits: any[] = [];

    images.forEach((img) => {
      const cat = img.category || img.type || 'unknown';
      if (cat === 'map' || cat === '地图') {
        maps.push(img);
      } else if (cat === 'character' || cat === 'portrait' || cat === '立绘' || cat === '角色') {
        portraits.push(img);
      } else {
        scenes.push(img); // 场景、插图等
      }
    });

    return { maps, scenes, portraits };
  }, [images]);

  const totalCount = images.length;

  return (
    <div className="msp-image-group msp-animate-in">
      <div
        className="msp-image-group-header"
        onClick={() => setExpanded(!expanded)}
      >
        <Flex align="center" gap="2">
          <span className="msp-chapter-expand-btn">
            {expanded ? '▼' : '▶'}
          </span>
          <Flex direction="column" gap="0" style={{ flex: 1 }}>
            {parentChapter && (
              <span className="msp-image-group-parent">{parentChapter}</span>
            )}
            <span className="msp-image-group-title">{chapter}</span>
          </Flex>
          <span className="msp-image-count-badge">📷 {totalCount}</span>
        </Flex>
      </div>

      {expanded && (
        <Box p="3">
          {/* 地图 */}
          {categorized.maps.length > 0 && (
            <Box mb="3">
              <span className="msp-image-category msp-image-category--map">
                🗺️ 地图 ({categorized.maps.length})
              </span>
              <ImageGrid
                images={categorized.maps}
                selectedModule={selectedModule}
                userId={userId}
                addingMapId={addingMapId}
                addedMaps={addedMaps}
                onAddMap={onAddMap}
                parentChapter={parentChapter}
                sectionName={chapter}
                onSendToChat={onSendToChat}
                members={members}
              />
            </Box>
          )}

          {/* 场景 */}
          {categorized.scenes.length > 0 && (
            <Box mb="3">
              <span className="msp-image-category msp-image-category--scene">
                🎨 场景/插图 ({categorized.scenes.length})
              </span>
              <ImageGrid
                images={categorized.scenes}
                selectedModule={selectedModule}
                userId={userId}
                addingMapId={addingMapId}
                addedMaps={addedMaps}
                onAddMap={onAddMap}
                parentChapter={parentChapter}
                sectionName={chapter}
                onSendToChat={onSendToChat}
                members={members}
              />
            </Box>
          )}

          {/* 立绘 */}
          {categorized.portraits.length > 0 && (
            <Box>
              <span className="msp-image-category msp-image-category--portrait">
                👤 立绘 ({categorized.portraits.length})
              </span>
              <ImageGrid
                images={categorized.portraits}
                selectedModule={selectedModule}
                userId={userId}
                addingMapId={addingMapId}
                addedMaps={addedMaps}
                onAddMap={onAddMap}
                parentChapter={parentChapter}
                sectionName={chapter}
                onSendToChat={onSendToChat}
                members={members}
              />
            </Box>
          )}
        </Box>
      )}
    </div>
  );
}

// 图片网格组件
function ModuleAssetPreviewImage({
  moduleId,
  assetPath,
  sourceUrl,
  alt,
}: {
  moduleId: string | null;
  assetPath: string | null;
  sourceUrl: string | null;
  alt: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    setBlobUrl(null);
    if (sourceUrl || !moduleId || !assetPath) return;

    let active = true;
    retainModuleAssetBlobUrl(moduleId, assetPath)
      .then((url) => {
        if (!active) {
          releaseModuleAssetBlobUrl(moduleId, assetPath);
          return;
        }
        setBlobUrl(url);
      })
      .catch((error) => {
        logger.error('[ModuleScriptPanel] Failed to load module asset blob:', error);
      });

    return () => {
      active = false;
      releaseModuleAssetBlobUrl(moduleId, assetPath);
    };
  }, [moduleId, assetPath, sourceUrl]);

  const resolvedUrl = sourceUrl || blobUrl;
  if (!resolvedUrl) return null;

  return (
    <img
      src={resolvedUrl}
      alt={alt}
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
    />
  );
}

function ImageGrid({
  images,
  selectedModule,
  userId,
  addingMapId,
  addedMaps,
  onAddMap,
  parentChapter,
  sectionName,
  onSendToChat,
  members
}: {
  images: any[];
  selectedModule: string | null;
  userId: string;
  addingMapId: string | number | null;
  addedMaps: Set<number>;
  onAddMap: (image: any, index: number) => void;
  parentChapter: string;
  sectionName: string;
  onSendToChat?: (imageUrl: string, description: string, recipient?: string, thumbnailUrl?: string) => void;
  members?: CampaignMember[];
}) {
  const description = (image: any) => image.description || image.chapter || sectionName || '图片';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px' }}>
      {images.map((image) => {
        const assetPath = image.path || image.filename || null;
        const inlineImageUrl = image.thumbnail_url || image.oss_url ||
          (image.image_base64 ? (image.image_base64.startsWith('data:') ? image.image_base64 : `data:image/png;base64,${image.image_base64}`) : null);
        const imageUrl = inlineImageUrl ||
          (assetPath ? getApiEndpoint(`/api/modules/parsed/${selectedModule}/asset?path=${encodeURIComponent(assetPath)}`) : null);
        const fullImageUrl = image.oss_url || imageUrl;
        const idx = image.originalIndex;
        const isAdded = addedMaps.has(idx);
        const imgDescription = description(image);

        // 构建带章节信息的图片对象
        const imageWithChapterInfo = {
          ...image,
          parentChapter,
          sectionName
        };

        return (
          <div key={idx} className="msp-image-thumb">
            {(inlineImageUrl || (selectedModule && assetPath)) && (
              <ModuleAssetPreviewImage
                moduleId={selectedModule}
                assetPath={assetPath}
                sourceUrl={inlineImageUrl}
                alt={image.description || ''}
              />
            )}
            {/* 按钮容器 */}
            <div style={{ position: 'absolute', bottom: '4px', right: '4px', display: 'flex', gap: '2px' }}>
              {/* 发送到聊天按钮 */}
              {onSendToChat && (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      style={{
                        padding: '4px 6px',
                        fontSize: '10px',
                        backgroundColor: 'rgba(139, 92, 246, 0.9)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        backdropFilter: 'blur(4px)'
                      }}
                      title="发送到聊天"
                    >
                      💬
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="bg-gray-800 border border-gray-600 rounded-md shadow-lg py-1 min-w-[120px] z-50"
                      sideOffset={5}
                    >
                      <DropdownMenu.Item
                        className="px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 cursor-pointer outline-none"
                        onSelect={() => onSendToChat(fullImageUrl || '', imgDescription, undefined, imageUrl || '')}
                      >
                        📢 发送给所有人
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className="h-px bg-gray-600 my-1" />
                      <DropdownMenu.Label className="px-3 py-1 text-[10px] text-gray-400">
                        私信给...
                      </DropdownMenu.Label>
                      {members?.filter(m => !m.is_virtual && m.user_id !== userId).map((member) => (
                        <DropdownMenu.Item
                          key={member.user_id}
                          className="px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 cursor-pointer outline-none"
                          onSelect={() => onSendToChat(fullImageUrl || '', imgDescription, member.user_id, imageUrl || '')}
                        >
                          🔒 {member.character_name || member.display_name || member.user_id} {member.role === 'dm' ? '(DM)' : ''}
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              )}
              {/* 添加到地图按钮 */}
              <button
                onClick={() => onAddMap(imageWithChapterInfo, idx)}
                disabled={addingMapId !== null || isAdded}
                style={{
                  padding: '4px 6px',
                  fontSize: '10px',
                  backgroundColor: isAdded ? 'rgba(16, 185, 129, 0.9)' : 'rgba(59, 130, 246, 0.9)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: addingMapId !== null || isAdded ? 'not-allowed' : 'pointer',
                  backdropFilter: 'blur(4px)'
                }}
                title="添加到地图"
              >
                {isAdded ? '✓' : '+'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 地点卡片组件
function LocationCard({ location }: { location: Location }) {
  const [expanded, setExpanded] = useState(false);
  const selectLocation = useModuleStore(state => state.selectLocation);

  return (
    <Card variant="surface" style={{ cursor: 'pointer' }} onClick={() => selectLocation(location.id)}>
      <Flex direction="column" gap="2">
        <Flex justify="between" align="start">
          <Box>
            <Flex align="center" gap="2">
              <Text size="2" weight="bold">{location.name}</Text>
              <Text size="1" color="gray">({location.name_en})</Text>
            </Flex>
            <Badge size="1" variant="soft" mt="1">{location.type}</Badge>
          </Box>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'inherit' }}
          >
            {expanded ? '▼' : '▶'}
          </button>
        </Flex>

        {expanded && (
          <Box mt="2">
            {location.description && (
              <Text size="1" color="gray">{location.description}</Text>
            )}

            {location.atmosphere && (
              <Box mt="2">
                <Text size="1" weight="bold">氛围:</Text>
                <Text size="1">{location.atmosphere}</Text>
              </Box>
            )}

            {(location.lighting || location.sounds || location.smells) && (
              <Box mt="2">
                <Text size="1" weight="bold">环境细节:</Text>
                {location.lighting && <Text size="1" style={{ display: 'block' }}>• 光线: {location.lighting}</Text>}
                {location.sounds && <Text size="1" style={{ display: 'block' }}>• 声音: {location.sounds}</Text>}
                {location.smells && <Text size="1" style={{ display: 'block' }}>• 气味: {location.smells}</Text>}
              </Box>
            )}

            {location.room_features && location.room_features.length > 0 && (
              <Box mt="2">
                <Text size="1" weight="bold">房间特征:</Text>
                {location.room_features.map((feature, idx) => (
                  <Text key={idx} size="1" style={{ display: 'block' }}>• {feature}</Text>
                ))}
              </Box>
            )}

            {location.connections && location.connections.length > 0 && (
              <Box mt="2">
                <Text size="1" weight="bold">连接:</Text>
                <Flex gap="1" wrap="wrap">
                  {location.connections.map((conn, idx) => (
                    <Badge key={idx} size="1" variant="outline">{conn}</Badge>
                  ))}
                </Flex>
              </Box>
            )}
          </Box>
        )}
      </Flex>
    </Card>
  );
}

// 任务卡片组件
function QuestCard({ quest, campaignId }: { quest: Quest; campaignId: string }) {
  const selectQuest = useModuleStore(state => state.selectQuest);
  const getQuestProgress = useModuleStore(state => state.getQuestProgress);
  const updateQuestProgress = useModuleStore(state => state.updateQuestProgress);
  
  const status = getQuestProgress(campaignId, quest.id);
  
  const statusColors = {
    not_started: 'gray',
    in_progress: 'blue',
    completed: 'green',
  } as const;
  
  const statusLabels = {
    not_started: '未开始',
    in_progress: '进行中',
    completed: '已完成',
  };

  return (
    <Card variant="surface" style={{ cursor: 'pointer' }} onClick={() => selectQuest(quest.id)}>
      <Flex direction="column" gap="2">
        <Flex justify="between" align="start">
          <Box style={{ flex: 1 }}>
            <Text size="2" weight="bold">{quest.name}</Text>
            <Flex gap="2" mt="1">
              <Badge size="1" variant={quest.type === 'main' ? 'solid' : 'soft'}>
                {quest.type === 'main' ? '主线' : '支线'}
              </Badge>
              <Badge size="1" color={statusColors[status]}>
                {statusLabels[status]}
              </Badge>
            </Flex>
            {quest.rewards?.gold && (
              <Text size="1" color="amber" mt="1" style={{ display: 'block' }}>
                奖励: {quest.rewards.gold} 金币
              </Text>
            )}
          </Box>
          <Flex direction="column" gap="1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                updateQuestProgress(campaignId, quest.id, 'in_progress');
              }}
              className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded"
              disabled={status === 'completed'}
            >
              开始
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                updateQuestProgress(campaignId, quest.id, 'completed');
              }}
              className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 rounded"
              disabled={status === 'completed'}
            >
              完成
            </button>
          </Flex>
        </Flex>
      </Flex>
    </Card>
  );
}

// 派系卡片组件
function FactionCard({ faction }: { faction: Faction }) {
  return (
    <Card variant="surface">
      <Box>
        <Text size="2" weight="bold">{faction.name}</Text>
        <Text size="1" color="gray" style={{ display: 'block' }}>{faction.name_en}</Text>
        <Text size="1" mt="1" style={{ display: 'block' }}>{faction.description}</Text>
        {faction.goals && faction.goals.length > 0 && (
          <Box mt="2">
            <Text size="1" weight="bold">目标:</Text>
            {faction.goals.map((goal, idx) => (
              <Text key={idx} size="1" style={{ display: 'block' }}>• {goal}</Text>
            ))}
          </Box>
        )}
      </Box>
    </Card>
  );
}

// 遭遇卡片组件
function EncounterCard({ encounter }: { encounter: Encounter }) {
  const [expanded, setExpanded] = useState(false);
  const getMonstersForEncounter = useModuleStore(state => state.getMonstersForEncounter);
  
  const monsters = getMonstersForEncounter(encounter.id);

  return (
    <Card variant="surface">
      <Flex direction="column" gap="2">
        <Flex justify="between" align="start">
          <Box>
            <Text size="2" weight="bold">{encounter.name}</Text>
            <Flex gap="2" mt="1">
              <Badge size="1" variant="soft" color="red">
                {encounter.monsters.length} 个敌人
              </Badge>
              {encounter.location_ref && (
                <Badge size="1" variant="outline">{encounter.location_ref}</Badge>
              )}
            </Flex>
          </Box>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'inherit' }}
          >
            {expanded ? '▼' : '▶'}
          </button>
        </Flex>

        {expanded && (
          <Box mt="2">
            <Box>
              <Text size="1" weight="bold">怪物列表:</Text>
              {encounter.monsters.map((m, idx) => (
                <Text key={idx} size="1" style={{ display: 'block' }}>
                  • {m.ref} x{m.qty} ({m.type === 'npc' ? 'NPC' : '怪物'})
                </Text>
              ))}
            </Box>

            {encounter.terrain && (
              <Box mt="2">
                <Text size="1" weight="bold">地形:</Text>
                <Text size="1">{encounter.terrain}</Text>
              </Box>
            )}

            {encounter.trigger && (
              <Box mt="2">
                <Text size="1" weight="bold">触发条件:</Text>
                <Text size="1">{encounter.trigger}</Text>
              </Box>
            )}

            {encounter.tactics && (
              <Box mt="2">
                <Text size="1" weight="bold" color="purple">战术建议:</Text>
                <Text size="1" color="purple">{encounter.tactics}</Text>
              </Box>
            )}

            {monsters.length > 0 && (
              <Box mt="2">
                <Text size="1" weight="bold">怪物详情:</Text>
                {monsters.map((monster, idx) => (
                  <Flex key={idx} gap="2" mt="1">
                    <Badge size="1" color="orange">CR {monster.cr}</Badge>
                    <Badge size="1" color="red">HP {typeof monster.hp === 'object' ? ((monster.hp as any)?.average || (monster.hp as any)?.dice || '') : monster.hp}</Badge>
                    <Badge size="1" color="blue">AC {typeof monster.ac === 'object' ? ((monster.ac as any)?.value || (monster.ac as any)?.base || '') : monster.ac}</Badge>
                    <Text size="1">{monster.name}</Text>
                  </Flex>
                ))}
              </Box>
            )}
          </Box>
        )}
      </Flex>
    </Card>
  );
}

// 模组剧本面板主组件
export function ModuleScriptPanel({
  campaignId,
  selectedModule,
  onModuleChange,
  onMapAdded,
  onSendImageToChat,
  onItemAdded,
  members,
  activeSubTab,
  onSubTabChange,
  currentMapUrl
}: {
  campaignId: string;
  selectedModule: string;
  onModuleChange: (moduleId: string) => void;
  onMapAdded?: () => void;
  onSendImageToChat?: (imageUrl: string, description: string, recipient?: string, thumbnailUrl?: string) => void;
  onItemAdded?: () => void;
  members?: CampaignMember[];
  activeSubTab?: string;
  onSubTabChange?: (tab: string) => void;
  currentMapUrl?: string;
}) {
  const userId = getCurrentUserId();
  const queryClient = useQueryClient();
  const authedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    apiFetch(input, { ...init, userId });
  const [activeTab, setActiveTabInternal] = useState(activeSubTab || 'scenes');
  const [chapterTree, setChapterTree] = useState<any[]>([]);
  const [moduleMonsters, setModuleMonsters] = useState<any[]>([]);
  const [moduleItems, setModuleItems] = useState<any[]>([]);
  const [moduleImages, setModuleImages] = useState<any[]>([]);
  const [isLoadingChapters, setIsLoadingChapters] = useState(false);
  const [addingMapId, setAddingMapId] = useState<string | number | null>(null);
  const [addedMaps, setAddedMaps] = useState<Set<number>>(new Set()); // 跟踪已添加的图片索引
  const [isAddingAllMaps, setIsAddingAllMaps] = useState(false); // 一键加入所有地图的加载状态
  const [batchAddResult, setBatchAddResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedMonster, setSelectedMonster] = useState<any | null>(null);
  const [showMonsterModal, setShowMonsterModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [showItemModal, setShowItemModal] = useState(false);
  const [globalMonsters, setGlobalMonsters] = useState<any[]>([]);
  const [addedMonsterId, setAddedMonsterId] = useState<string | null>(null);
  const [addedMonsterIndices, setAddedMonsterIndices] = useState<Set<number>>(new Set());
  const [failedMonsterIndices, setFailedMonsterIndices] = useState<Map<number, string>>(new Map());
  const [addedItemId, setAddedItemId] = useState<string | null>(null);
  const [importingItemIndex, setImportingItemIndex] = useState<number | null>(null);
  const [importingMonsterIndex, setImportingMonsterIndex] = useState<number | null>(null);
  const [isAddingAllItems, setIsAddingAllItems] = useState(false);
  const [isAddingAllMonsters, setIsAddingAllMonsters] = useState(false);
  const [itemBatchResult, setItemBatchResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [monsterBatchResult, setMonsterBatchResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 编辑相关状态
  const [isModuleOwner, setIsModuleOwner] = useState(false);
  const [isCustomModule, setIsCustomModule] = useState(false);  // 跟踪当前模组是否是自定义模组
  const [editingChapter, setEditingChapter] = useState<{ path: number[]; node: any } | null>(null);
  const [editChapterTitle, setEditChapterTitle] = useState('');
  const [editChapterContent, setEditChapterContent] = useState('');
  const [isSavingChapter, setIsSavingChapter] = useState(false);
  const [showAddChapterDialog, setShowAddChapterDialog] = useState(false);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [newChapterContent, setNewChapterContent] = useState('');

  // 处理编辑章节
  const handleEditChapter = (path: number[], node: any) => {
    setEditingChapter({ path, node });
    setEditChapterTitle(node.title || '');
    setEditChapterContent(node.content || '');
  };

  // 保存章节编辑
  const handleSaveChapter = async () => {
    if (!editingChapter || !selectedModule) return;
    setIsSavingChapter(true);
    try {
      // 深拷贝章节树
      const updatedChapters = JSON.parse(JSON.stringify(chapterTree));

      // 根据路径找到并更新节点
      const { path } = editingChapter;
      let target = updatedChapters;
      for (let i = 0; i < path.length - 1; i++) {
        target = target[path[i]].children;
      }
      const lastIndex = path[path.length - 1];
      target[lastIndex] = {
        ...target[lastIndex],
        title: editChapterTitle,
        content: editChapterContent,
        content_length: editChapterContent.length,
      };

      // 根据模组类型调用不同的 API
      const apiPath = isCustomModule
        ? `/api/custom-modules/${selectedModule}/chapters`
        : `/api/modules/parsed/${selectedModule}/chapters`;

      const response = await authedFetch(apiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedChapters),
      });

      if (response.ok) {
        setChapterTree(updatedChapters);
        setEditingChapter(null);
      }
    } catch (error) {
      logger.error('Failed to save chapter:', error);
    } finally {
      setIsSavingChapter(false);
    }
  };

  // 保存章节内容（从模态框内编辑）
  const handleSaveChapterContent = async (path: number[], content: string) => {
    if (!selectedModule) return;
    try {
      // 深拷贝章节树
      const updatedChapters = JSON.parse(JSON.stringify(chapterTree));

      // 根据路径找到并更新节点
      let target = updatedChapters;
      for (let i = 0; i < path.length - 1; i++) {
        target = target[path[i]].children;
      }
      const lastIndex = path[path.length - 1];
      target[lastIndex] = {
        ...target[lastIndex],
        content: content,
        content_length: content.length,
      };

      // 根据模组类型调用不同的 API
      const apiPath = isCustomModule
        ? `/api/custom-modules/${selectedModule}/chapters`
        : `/api/modules/parsed/${selectedModule}/chapters`;

      const response = await authedFetch(apiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedChapters),
      });

      if (response.ok) {
        setChapterTree(updatedChapters);
      } else {
        throw new Error('Failed to save');
      }
    } catch (error) {
      logger.error('Failed to save chapter content:', error);
      throw error;
    }
  };

  // 保存章节标题
  const handleSaveChapterTitle = async (path: number[], title: string) => {
    if (!selectedModule) return;
    try {
      const updatedChapters = JSON.parse(JSON.stringify(chapterTree));

      // 根据路径找到并更新节点
      let target = updatedChapters;
      for (let i = 0; i < path.length - 1; i++) {
        target = target[path[i]].children;
      }
      const lastIndex = path[path.length - 1];
      target[lastIndex] = {
        ...target[lastIndex],
        title: title,
      };

      // 根据模组类型调用不同的 API
      const apiPath = isCustomModule
        ? `/api/custom-modules/${selectedModule}/chapters`
        : `/api/modules/parsed/${selectedModule}/chapters`;

      const response = await authedFetch(apiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedChapters),
      });

      if (response.ok) {
        setChapterTree(updatedChapters);
      } else {
        throw new Error('Failed to save title');
      }
    } catch (error) {
      logger.error('Failed to save chapter title:', error);
      throw error;
    }
  };

  // 添加子章节（弹出输入框）
  const [subChapterParentPath, setSubChapterParentPath] = useState<number[] | null>(null);
  const [newSubChapterTitle, setNewSubChapterTitle] = useState('');

  const handleAddSubChapter = (parentPath: number[]) => {
    setSubChapterParentPath(parentPath);
    setNewSubChapterTitle('');
  };

  const handleSaveSubChapter = async () => {
    if (!selectedModule || !subChapterParentPath || !newSubChapterTitle.trim()) return;
    setIsSavingChapter(true);
    try {
      const updatedChapters = JSON.parse(JSON.stringify(chapterTree));

      // 找到父节点并添加子章节
      let parent = updatedChapters;
      for (let i = 0; i < subChapterParentPath.length - 1; i++) {
        parent = parent[subChapterParentPath[i]].children;
      }
      const targetNode = parent[subChapterParentPath[subChapterParentPath.length - 1]];

      if (!targetNode.children) {
        targetNode.children = [];
      }
      targetNode.children.push({
        title: newSubChapterTitle.trim(),
        content: '',
        content_length: 0,
        children: [],
      });

      // 根据模组类型调用不同的 API
      const apiPath = isCustomModule
        ? `/api/custom-modules/${selectedModule}/chapters`
        : `/api/modules/parsed/${selectedModule}/chapters`;

      const response = await authedFetch(apiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedChapters),
      });

      if (response.ok) {
        setChapterTree(updatedChapters);
        setSubChapterParentPath(null);
        setNewSubChapterTitle('');
      }
    } catch (error) {
      logger.error('Failed to add sub-chapter:', error);
    } finally {
      setIsSavingChapter(false);
    }
  };

  // 添加新章节
  const handleAddChapter = async () => {
    if (!selectedModule || !newChapterTitle.trim()) return;
    setIsSavingChapter(true);
    try {
      const newChapter = {
        title: newChapterTitle.trim(),
        content: newChapterContent,
        content_length: newChapterContent.length,
        children: [],
      };

      const updatedChapters = [...chapterTree, newChapter];

      // 根据模组类型调用不同的 API
      const apiPath = isCustomModule
        ? `/api/custom-modules/${selectedModule}/chapters`
        : `/api/modules/parsed/${selectedModule}/chapters`;

      const response = await authedFetch(apiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedChapters),
      });

      if (response.ok) {
        setChapterTree(updatedChapters);
        setShowAddChapterDialog(false);
        setNewChapterTitle('');
        setNewChapterContent('');
      }
    } catch (error) {
      logger.error('Failed to add chapter:', error);
    } finally {
      setIsSavingChapter(false);
    }
  };

  // 删除章节
  const handleDeleteChapter = async (path: number[]) => {
    if (!selectedModule || !confirm('确定要删除这个章节吗？')) return;
    try {
      // 深拷贝章节树
      const updatedChapters = JSON.parse(JSON.stringify(chapterTree));

      // 根据路径找到父节点并删除目标节点
      if (path.length === 1) {
        // 顶层节点
        updatedChapters.splice(path[0], 1);
      } else {
        // 嵌套节点
        let target = updatedChapters;
        for (let i = 0; i < path.length - 1; i++) {
          target = target[path[i]].children;
        }
        target.splice(path[path.length - 1], 1);
      }

      // 根据模组类型调用不同的 API
      const apiPath = isCustomModule
        ? `/api/custom-modules/${selectedModule}/chapters`
        : `/api/modules/parsed/${selectedModule}/chapters`;

      const response = await authedFetch(apiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedChapters),
      });

      if (response.ok) {
        setChapterTree(updatedChapters);
      }
    } catch (error) {
      logger.error('Failed to delete chapter:', error);
    }
  };

  // 怪物/NPC 编辑状态
  const [editingMonster, setEditingMonster] = useState<{ index: number; monster: any } | null>(null);
  const [editMonsterName, setEditMonsterName] = useState('');
  const [editMonsterNameEn, setEditMonsterNameEn] = useState('');
  const [editMonsterType, setEditMonsterType] = useState('');
  const [editMonsterCr, setEditMonsterCr] = useState('');
  const [editMonsterHp, setEditMonsterHp] = useState('');
  const [editMonsterAc, setEditMonsterAc] = useState('');
  const [editMonsterDescription, setEditMonsterDescription] = useState('');
  const [isSavingMonster, setIsSavingMonster] = useState(false);
  const [showAddMonsterDialog, setShowAddMonsterDialog] = useState(false);

  // 处理编辑怪物
  const handleEditMonster = (index: number, monster: any) => {
    setEditingMonster({ index, monster });
    setEditMonsterName(monster.name || '');
    setEditMonsterNameEn(monster.name_en || '');
    setEditMonsterType(monster.type || '');
    setEditMonsterCr(monster.cr?.toString() || '');
    // HP 和 AC 可能是对象格式 {dice, average} 或字符串/数字
    const hpValue = typeof monster.hp === 'object'
      ? (monster.hp?.average?.toString() || monster.hp?.dice || '')
      : (monster.hp?.toString() || '');
    const acValue = typeof monster.ac === 'object'
      ? (monster.ac?.value?.toString() || monster.ac?.base?.toString() || '')
      : (monster.ac?.toString() || '');
    setEditMonsterHp(hpValue);
    setEditMonsterAc(acValue);
    setEditMonsterDescription(monster.description || '');
  };

  // 保存怪物编辑
  const handleSaveMonster = async () => {
    if (!editingMonster || !selectedModule) return;
    setIsSavingMonster(true);
    try {
      const updatedMonsters = [...moduleMonsters];
      updatedMonsters[editingMonster.index] = {
        ...updatedMonsters[editingMonster.index],
        name: editMonsterName,
        name_en: editMonsterNameEn,
        type: editMonsterType,
        cr: editMonsterCr || undefined,
        hp: editMonsterHp ? parseInt(editMonsterHp) : undefined,
        ac: editMonsterAc ? parseInt(editMonsterAc) : undefined,
        description: editMonsterDescription,
      };

      const response = await authedFetch(`/api/modules/parsed/${selectedModule}/monsters`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedMonsters),
      });

      if (response.ok) {
        setModuleMonsters(updatedMonsters);
        setEditingMonster(null);
      }
    } catch (error) {
      logger.error('Failed to save monster:', error);
    } finally {
      setIsSavingMonster(false);
    }
  };

  // 添加新怪物
  const handleAddMonster = async () => {
    if (!selectedModule || !editMonsterName.trim()) return;
    setIsSavingMonster(true);
    try {
      const newMonster = {
        name: editMonsterName.trim(),
        name_en: editMonsterNameEn,
        type: editMonsterType,
        cr: editMonsterCr || undefined,
        hp: editMonsterHp ? parseInt(editMonsterHp) : undefined,
        ac: editMonsterAc ? parseInt(editMonsterAc) : undefined,
        description: editMonsterDescription,
      };

      const updatedMonsters = [...moduleMonsters, newMonster];

      const response = await authedFetch(`/api/modules/parsed/${selectedModule}/monsters`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedMonsters),
      });

      if (response.ok) {
        setModuleMonsters(updatedMonsters);
        setShowAddMonsterDialog(false);
        // Reset form
        setEditMonsterName('');
        setEditMonsterNameEn('');
        setEditMonsterType('');
        setEditMonsterCr('');
        setEditMonsterHp('');
        setEditMonsterAc('');
        setEditMonsterDescription('');
      }
    } catch (error) {
      logger.error('Failed to add monster:', error);
    } finally {
      setIsSavingMonster(false);
    }
  };

  // 删除怪物
  const handleDeleteMonster = async (index: number) => {
    if (!selectedModule || !confirm('确定要删除这个怪物/NPC吗？')) return;
    try {
      const updatedMonsters = moduleMonsters.filter((_, i) => i !== index);

      const response = await authedFetch(`/api/modules/parsed/${selectedModule}/monsters`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedMonsters),
      });

      if (response.ok) {
        setModuleMonsters(updatedMonsters);
      }
    } catch (error) {
      logger.error('Failed to delete monster:', error);
    }
  };

  // 物品编辑状态
  const [editingItem, setEditingItem] = useState<{ index: number; item: any } | null>(null);
  const [editItemName, setEditItemName] = useState('');
  const [editItemNameEn, setEditItemNameEn] = useState('');
  const [editItemCategory, setEditItemCategory] = useState('');
  const [editItemRarity, setEditItemRarity] = useState('');
  const [editItemDescription, setEditItemDescription] = useState('');
  const [isSavingItem, setIsSavingItem] = useState(false);
  const [showAddItemDialog, setShowAddItemDialog] = useState(false);

  // 处理编辑物品
  const handleEditItem = (index: number, item: any) => {
    setEditingItem({ index, item });
    setEditItemName(item.name || '');
    setEditItemNameEn(item.name_en || '');
    setEditItemCategory(item.category || '');
    setEditItemRarity(item.rarity || '');
    setEditItemDescription(item.description || '');
  };

  // 保存物品编辑
  const handleSaveItem = async () => {
    if (!editingItem || !selectedModule) return;
    setIsSavingItem(true);
    try {
      const updatedItems = [...moduleItems];
      updatedItems[editingItem.index] = {
        ...updatedItems[editingItem.index],
        name: editItemName,
        name_en: editItemNameEn,
        category: editItemCategory,
        rarity: editItemRarity,
        description: editItemDescription,
      };

      const response = await authedFetch(`/api/modules/parsed/${selectedModule}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedItems),
      });

      if (response.ok) {
        setModuleItems(updatedItems);
        setEditingItem(null);
      }
    } catch (error) {
      logger.error('Failed to save item:', error);
    } finally {
      setIsSavingItem(false);
    }
  };

  // 添加新物品
  const handleAddItem = async () => {
    if (!selectedModule || !editItemName.trim()) return;
    setIsSavingItem(true);
    try {
      const newItem = {
        name: editItemName.trim(),
        name_en: editItemNameEn,
        category: editItemCategory,
        rarity: editItemRarity,
        description: editItemDescription,
      };

      const updatedItems = [...moduleItems, newItem];

      const response = await authedFetch(`/api/modules/parsed/${selectedModule}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedItems),
      });

      if (response.ok) {
        setModuleItems(updatedItems);
        setShowAddItemDialog(false);
        // Reset form
        setEditItemName('');
        setEditItemNameEn('');
        setEditItemCategory('');
        setEditItemRarity('');
        setEditItemDescription('');
      }
    } catch (error) {
      logger.error('Failed to add item:', error);
    } finally {
      setIsSavingItem(false);
    }
  };

  // 删除物品
  const handleDeleteItem = async (index: number) => {
    if (!selectedModule || !confirm('确定要删除这个物品吗？')) return;
    try {
      const updatedItems = moduleItems.filter((_, i) => i !== index);

      const response = await authedFetch(`/api/modules/parsed/${selectedModule}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedItems),
      });

      if (response.ok) {
        setModuleItems(updatedItems);
      }
    } catch (error) {
      logger.error('Failed to delete item:', error);
    }
  };

  // Sync external activeSubTab with internal state
  useEffect(() => {
    if (activeSubTab && activeSubTab !== activeTab) {
      setActiveTabInternal(activeSubTab);
    }
  }, [activeSubTab]);

  // Wrapper to notify parent when tab changes
  const setActiveTab = useCallback((tab: string) => {
    setActiveTabInternal(tab);
    onSubTabChange?.(tab);
  }, [onSubTabChange]);

  const currentModule = useModuleStore(state => state.currentModule);
  const loadModule = useModuleStore(state => state.loadModule);
  const loadQuestProgress = useModuleStore(state => state.loadQuestProgress);

  // Note: Using module-level cache (moduleDataCache) instead of useRef
  // to persist across component remounts when switching tabs

  // 添加怪物到资源库 - 使用后端统一 API (包含 LLM 解析 + RAG 外观搜索 + 头像生成)
  const handleAddMonsterToLibrary = async (monster: any, monsterIndex?: number, skipDuplicateCheck?: boolean): Promise<{ success: boolean; error?: string; skipped?: boolean }> => {
    // 如果怪物有 config_id 且在全局配置中，从全局配置获取完整数据
    let fullMonsterData = monster;
    if (monster.config_id && monster.in_configs) {
      const globalMonster = globalMonsters.find((m: any) => m.id === monster.config_id);
      if (globalMonster) {
        fullMonsterData = globalMonster;
        logger.debug('[ModuleScriptPanel] Using global monster data for:', monster.name);
      }
    }

    const monsterName = fullMonsterData.name || monster.name;

    // 设置导入状态
    if (monsterIndex !== undefined) {
      setImportingMonsterIndex(monsterIndex);
    }

    // 检查资源库是否已存在同名怪物（单个导入时检查，批量导入已在外部检查过）
    if (!skipDuplicateCheck) {
      try {
        const existingResponse = await authedFetch(`/api/monster-instances/campaign/${campaignId}`);
        if (existingResponse.ok) {
          const existingMonsters: any[] = await existingResponse.json();
          const exists = existingMonsters.some(m => m.name?.toLowerCase() === monsterName?.toLowerCase());
          if (exists) {
            if (monsterIndex !== undefined) {
              setAddedMonsterIndices(prev => new Set(prev).add(monsterIndex));
              setImportingMonsterIndex(null);
            }
            return { success: true, skipped: true, error: '已导入' };
          }
        }
      } catch (e) {
        logger.warn('[ModuleScriptPanel] Failed to check existing monsters:', e);
      }
    }

    try {
      // 使用后端统一的 create-entity API
      // 后端会处理：LLM 解析、RAG 外观搜索、头像生成
      const entityData = {
        ...fullMonsterData,
        // 标记是否为 NPC（影响头像风格）
        is_npc: classifyMonsterOrNPC(fullMonsterData) === 'npc'
      };

      logger.debug('[ModuleScriptPanel] Creating entity via unified API:', entityData);

      const response = await authedFetch(
        `/api/modules/${selectedModule}/chat/create-entity?campaign_id=${campaignId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entity_type: entityData.is_npc ? 'npc' : 'monster',
            data: entityData
          })
        }
      );

      if (response.ok) {
        const result = await response.json();
        logger.debug('[ModuleScriptPanel] Monster instance created:', result);

        // 刷新资源库缓存
        queryClient.invalidateQueries({ queryKey: ['monsterInstances', campaignId] });

        // 显示成功状态 - 使用后端返回的 ID
        setAddedMonsterId(result.id || result.name);
        // 记录成功索引
        if (monsterIndex !== undefined) {
          setAddedMonsterIndices(prev => new Set(prev).add(monsterIndex));
        }
        // 清除导入中状态
        setImportingMonsterIndex(null);

        // 3秒后清除成功状态
        setTimeout(() => {
          setAddedMonsterId(null);
        }, 3000);

        return { success: true };
      } else {
        let errorMsg = `HTTP ${response.status}`;
        try {
          const error = await response.json();
          logger.error('[ModuleScriptPanel] Failed to create monster instance:', error);
          // 处理各种错误格式
          if (typeof error.detail === 'string') {
            errorMsg = error.detail;
          } else if (Array.isArray(error.detail)) {
            // Pydantic 验证错误格式: [{loc: [...], msg: "...", type: "..."}]
            errorMsg = error.detail.map((e: any) => `${e.loc?.join('.')}: ${e.msg}`).join('; ');
          } else if (error.message) {
            errorMsg = error.message;
          } else if (error.error) {
            errorMsg = error.error;
          } else {
            errorMsg = JSON.stringify(error);
          }
        } catch {
          errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        }
        // 记录失败索引
        if (monsterIndex !== undefined) {
          setFailedMonsterIndices(prev => new Map(prev).set(monsterIndex, errorMsg));
        }
        if (monsterIndex === undefined) {
          alert(`添加怪物失败：${errorMsg}`);
        }
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      logger.error('[ModuleScriptPanel] Error creating monster instance:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      // 记录失败索引
      if (monsterIndex !== undefined) {
        setFailedMonsterIndices(prev => new Map(prev).set(monsterIndex, errorMsg));
      }
      if (monsterIndex === undefined) {
        alert('添加怪物到资源库时发生错误');
      }
      return { success: false, error: errorMsg };
    } finally {
      if (monsterIndex !== undefined) {
        setImportingMonsterIndex(null);
      }
    }
  };

  // 添加物品到资源库 - 使用后端AI格式化API
  const handleAddItemToLibrary = async (item: any, itemIndex: number) => {
    const itemId = item.id || `item_${Date.now()}`;
    setImportingItemIndex(itemIndex);

    try {
      // 使用后端的AI格式化导入API
      const response = await authedFetch(`/api/items/ai-import-single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: selectedModule,
          campaign_id: parseInt(campaignId),
          item_index: itemIndex
        })
      });

      if (response.ok) {
        const result = await response.json();
        logger.debug('[ModuleScriptPanel] Item imported:', result);

        // 刷新资源库缓存
        queryClient.invalidateQueries({ queryKey: ['items', campaignId] });

        setAddedItemId(itemId);
        // 通知资源库刷新
        onItemAdded?.();
        setTimeout(() => {
          setAddedItemId(null);
        }, 3000);
      } else {
        const error = await response.json();
        logger.error('[ModuleScriptPanel] Failed to import item:', error);
        alert(`导入失败: ${error.detail || '未知错误'}`);
      }
    } catch (error) {
      logger.error('[ModuleScriptPanel] Error importing item:', error);
      alert('导入物品时发生错误');
    } finally {
      setImportingItemIndex(null);
    }
  };

  // 一键添加所有物品到资源库 - 使用后端批量API
  const handleAddAllItemsToLibrary = async () => {
    if (!selectedModule || moduleItems.length === 0) return;

    setIsAddingAllItems(true);
    setItemBatchResult({ type: 'success', message: '正在检查资源库...' });

    let successCount = 0;
    let skippedCount = 0;
    const failedItems: { name: string; error: string }[] = [];

    try {
      // 先获取资源库中已有的物品列表
      const existingResponse = await authedFetch(`/api/items/campaign/${campaignId}`);
      const existingItems: any[] = existingResponse.ok ? await existingResponse.json() : [];
      const existingNames = new Set(existingItems.map(item => item.name?.toLowerCase() || ''));
      logger.debug('[ModuleScriptPanel] Existing items in library:', existingNames.size);

      for (let i = 0; i < moduleItems.length; i++) {
        const item = moduleItems[i];
        const itemName = item.name || item.name_cn || `物品${i + 1}`;

        // 检查是否已存在
        if (existingNames.has(itemName?.toLowerCase())) {
          skippedCount++;
          setItemBatchResult({
            type: 'success',
            message: `跳过 (${i + 1}/${moduleItems.length}): ${itemName} (已导入)`
          });
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }

        setItemBatchResult({
          type: 'success',
          message: `正在导入 (${i + 1}/${moduleItems.length}): ${itemName}`
        });

        try {
          const response = await authedFetch(`/api/items/ai-import-single`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              module_id: selectedModule,
              campaign_id: parseInt(campaignId),
              item_index: i
            })
          });

          if (response.ok) {
            successCount++;
          } else if (response.status === 400) {
            const error = await response.json();
            // 检查是否是"已存在"的错误
            if (error.detail && error.detail.includes('已存在')) {
              skippedCount++;
            } else {
              failedItems.push({ name: itemName, error: error.detail || '导入失败' });
            }
          } else {
            const error = await response.json();
            failedItems.push({ name: itemName, error: error.detail || '导入失败' });
          }
        } catch (err) {
          failedItems.push({ name: itemName, error: '网络错误' });
        }

        // 短暂延迟避免请求过快
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // 构建结果消息
      let message = `导入完成: 成功 ${successCount} 个`;
      if (skippedCount > 0) {
        message += `, 跳过 ${skippedCount} 个 (已存在)`;
      }
      if (failedItems.length > 0) {
        message += `, 失败 ${failedItems.length} 个`;
        if (failedItems.length <= 3) {
          message += `\n失败: ${failedItems.map(f => `${f.name}(${f.error})`).join(', ')}`;
        }
      }

      setItemBatchResult({
        type: failedItems.length > 0 ? 'error' : 'success',
        message
      });
      // 通知资源库刷新
      onItemAdded?.();
      setTimeout(() => setItemBatchResult(null), failedItems.length > 0 ? 10000 : 5000);
    } catch (error) {
      logger.error('[ModuleScriptPanel] Error batch importing items:', error);
      setItemBatchResult({ type: 'error', message: '批量导入失败' });
      setTimeout(() => setItemBatchResult(null), 5000);
    } finally {
      // 刷新资源库缓存
      queryClient.invalidateQueries({ queryKey: ['items', campaignId] });
      setIsAddingAllItems(false);
    }
  };

  // 一键添加所有怪物到资源库
  const handleAddAllMonstersToLibrary = async () => {
    if (!selectedModule || moduleMonsters.length === 0) return;

    setIsAddingAllMonsters(true);
    setMonsterBatchResult({ type: 'success', message: '正在检查资源库...' });

    let successCount = 0;
    let skippedCount = 0;
    const failedMonsters: { name: string; error: string }[] = [];

    try {
      // 先获取资源库中已有的怪物列表
      const existingResponse = await authedFetch(`/api/monster-instances/campaign/${campaignId}`);
      const existingMonsters: any[] = existingResponse.ok ? await existingResponse.json() : [];
      const existingNames = new Set(existingMonsters.map(m => m.name?.toLowerCase() || ''));
      logger.debug('[ModuleScriptPanel] Existing monsters in library:', existingNames.size);

      for (let i = 0; i < moduleMonsters.length; i++) {
        const monster = moduleMonsters[i];
        // 尝试从全局配置获取完整数据
        const globalMonster = monster.config_id && monster.in_configs
          ? globalMonsters.find((m: any) => m.id === monster.config_id)
          : null;
        const displayMonster = globalMonster || monster;
        const monsterName = displayMonster.name || monster.name;

        // 检查是否已存在
        if (existingNames.has(monsterName?.toLowerCase())) {
          skippedCount++;
          setAddedMonsterIndices(prev => new Set(prev).add(i));
          setMonsterBatchResult({
            type: 'success',
            message: `跳过 (${i + 1}/${moduleMonsters.length}): ${monsterName} (已导入)`
          });
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }

        setMonsterBatchResult({
          type: 'success',
          message: `正在导入 (${i + 1}/${moduleMonsters.length}): ${monsterName}`
        });

        const result = await handleAddMonsterToLibrary(displayMonster, i, true); // skipDuplicateCheck=true
        if (result.success) {
          successCount++;
        } else {
          failedMonsters.push({ name: monsterName, error: result.error || `导入失败` });
        }

        // 短暂延迟避免请求过快
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // 构建结果消息
      let message = `导入完成: 成功 ${successCount} 个`;
      if (skippedCount > 0) {
        message += `, 跳过 ${skippedCount} 个 (已存在)`;
      }
      if (failedMonsters.length > 0) {
        message += `, 失败 ${failedMonsters.length} 个`;
        // 显示失败详情
        const failDetails = failedMonsters.map(f => `${f.name}: ${f.error}`).join('\n');
        logger.warn('[ModuleScriptPanel] Failed monsters:', failDetails);
        // 如果失败数量较少，直接在消息中显示
        if (failedMonsters.length <= 3) {
          message += `\n失败: ${failedMonsters.map(f => `${f.name}(${f.error})`).join(', ')}`;
        } else {
          message += `\n失败怪物: ${failedMonsters.map(f => f.name).join(', ')}`;
        }
      }

      setMonsterBatchResult({
        type: failedMonsters.length > 0 ? 'error' : 'success',
        message
      });
      setTimeout(() => setMonsterBatchResult(null), failedMonsters.length > 0 ? 10000 : 5000);
    } catch (error) {
      logger.error('[ModuleScriptPanel] Error batch importing monsters:', error);
      setMonsterBatchResult({ type: 'error', message: '批量导入失败' });
      setTimeout(() => setMonsterBatchResult(null), 5000);
    } finally {
      // 刷新资源库缓存
      queryClient.invalidateQueries({ queryKey: ['monsterInstances', campaignId] });
      setIsAddingAllMonsters(false);
    }
  };

  // 加载全局怪物配置
  React.useEffect(() => {
    const loadGlobalMonsters = async () => {
      try {
        const module = await import('~/data/npc/monsters.json');
        const data = module.default;
        // 全局配置是 {overview: {...}, monsters: [...]} 结构
        const monstersList = data.monsters || data;
        setGlobalMonsters(Array.isArray(monstersList) ? monstersList : []);
        logger.debug('[ModuleScriptPanel] Loaded global monsters:', monstersList.length);
      } catch (error) {
        logger.error('[ModuleScriptPanel] Failed to load global monsters:', error);
      }
    };
    loadGlobalMonsters();
  }, []);

  // 加载任务进度
  React.useEffect(() => {
    if (campaignId) {
      loadQuestProgress(campaignId);
    }
  }, [campaignId]);

  // 加载章节树和模组资源 (合并为一个函数，使用缓存)
  React.useEffect(() => {
    if (selectedModule) {
      loadModuleData();
    }
  }, [selectedModule]);

  const loadModuleData = async () => {
    if (!selectedModule) return;

    // Prevent duplicate API calls (React Strict Mode double-invoking)
    if (loadingModuleId === selectedModule) {
      logger.debug('[ModuleScriptPanel] Already loading module, skipping:', selectedModule);
      return;
    }

    // Check module-level cache first (persists across tab switches)
    const cached = moduleDataCache.get(selectedModule);
    if (cached) {
      logger.debug('[ModuleScriptPanel] Using cached module data for:', selectedModule);
      if (cached.chapter_tree) setChapterTree(cached.chapter_tree);
      if (cached.monsters) setModuleMonsters(cached.monsters);
      if (cached.items) setModuleItems(cached.items);
      if (cached.images) setModuleImages(cached.images);
      return;
    }

    // Mark as loading
    loadingModuleId = selectedModule;
    setIsLoadingChapters(true);
    try {
      // Skip backend API for known static-only modules to avoid 404 console errors
      if (!STATIC_ONLY_MODULES.has(selectedModule)) {
        const moduleResponse = await authedFetch(
          `/api/modules/parsed/${selectedModule}`
        );

        if (moduleResponse.ok) {
          const moduleData = await moduleResponse.json();
          logger.debug('[ModuleScriptPanel] Fetched module data from API:', selectedModule);

          // 这是 parsed module
          setIsCustomModule(false);

          // 检查是否是模组所有者
          setIsModuleOwner(moduleData.created_by === userId);

          // Cache the data
          moduleDataCache.set(selectedModule, moduleData);

          // Update all state from single API call
          if (moduleData.chapter_tree) {
            setChapterTree(moduleData.chapter_tree);
          }
          if (moduleData.monsters) {
            setModuleMonsters(moduleData.monsters);
          }
          if (moduleData.items) {
            setModuleItems(moduleData.items);
          }
          if (moduleData.images) {
            setModuleImages(moduleData.images);
          }

          return; // 成功加载，直接返回
        }
      }

      // 2. 如果解析模组没有，尝试从自定义模组API获取
      const customResponse = await authedFetch(
        `/api/custom-modules/${selectedModule}`
      );

      if (customResponse.ok) {
        const customData = await customResponse.json();
        logger.debug('[ModuleScriptPanel] Fetched from custom API:', selectedModule);

        // 这是 custom module
        setIsCustomModule(true);

        // 转换自定义模组数据格式
        const moduleData = {
          chapter_tree: customData.chapters || [],
          monsters: customData.npcs || [],
          items: customData.treasures || [],
          images: [],
          created_by: customData.created_by,
        };

        setIsModuleOwner(moduleData.created_by === userId);
        moduleDataCache.set(selectedModule, moduleData);

        if (moduleData.chapter_tree) setChapterTree(moduleData.chapter_tree);
        if (moduleData.monsters) setModuleMonsters(moduleData.monsters);
        if (moduleData.items) setModuleItems(moduleData.items);
        if (moduleData.images) setModuleImages(moduleData.images);

        return;
      }

      // 3. 从前端静态文件加载
      logger.debug('[ModuleScriptPanel] Loading from static files');
      try {
        const chaptersModule = await import(`~/data/modules/${selectedModule}/chapters.json`);
        const chapters = chaptersModule.default;
        setChapterTree(chapters);
      } catch {
        logger.debug('[ModuleScriptPanel] No static chapters file');
      }

      try {
        const staticModule = await import(`~/data/modules/${selectedModule}/complete_module_data.json`);
        const moduleData = staticModule.default;
        if (moduleData.monsters) setModuleMonsters(moduleData.monsters);
        if (moduleData.items) setModuleItems(moduleData.items);
        if (moduleData.images) setModuleImages(moduleData.images);
      } catch {
        logger.debug('[ModuleScriptPanel] No static module data');
      }

    } catch (error) {
      logger.error('[ModuleScriptPanel] Failed to load module data:', error);
    } finally {
      loadingModuleId = null;
      setIsLoadingChapters(false);
    }
  };

  const handleModuleLoad = React.useCallback((moduleData: any) => {
    loadModule(moduleData);
  }, [loadModule]);

  // 添加地图到战役
  const handleAddMapToCampaign = async (image: any, index: number) => {
    if (!selectedModule) return;

    const mapId = `map_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setAddingMapId(mapId);

  try {
    // 兼容新旧格式：优先使用 oss_url，然后 path，最后 image_base64
    const imagePath = image.path || image.filename || image.image_id;
    let mapUrl = image.oss_url || image.thumbnail_url;
    if (!mapUrl && imagePath && selectedModule) {
      mapUrl = await fetchModuleAssetDataUrl(selectedModule, imagePath);
    }
    if (!mapUrl && image.image_base64) {
      mapUrl = image.image_base64.startsWith('data:') ? image.image_base64 : `data:image/png;base64,${image.image_base64}`;
    }
    if (!mapUrl) {
      throw new Error('No usable map URL');
    }

    // 构建地图名称：章节 > 段落 > 描述
    let mapName = '';
    if (image.parentChapter) {
      mapName = image.parentChapter;
    }
    if (image.sectionName && image.sectionName !== image.parentChapter) {
      mapName = mapName ? `${mapName} > ${image.sectionName}` : image.sectionName;
    }
    if (!mapName) {
      mapName = image.chapter || image.description || '未命名地图';
    }
    const mapType = image.category || image.type || 'illustration';
    const pageIndex = image.page_index || image.line;
    const imageDescription = image.description || image.alt;

    const response = await authedFetch(
      `/api/campaigns/${campaignId}/module-maps/add?module_id=${selectedModule}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
          body: JSON.stringify({
            id: mapId,
            name: mapName,
            url: mapUrl,
            chapter: image.chapter || '',
            metadata: {
              type: mapType,
              section: image.section,
              line: pageIndex,
              alt: imageDescription,
              original_path: imagePath,
              image_id: image.image_id
            }
          })
        }
      );

      if (response.ok) {
        const result = await response.json();
        logger.debug('[ModuleScriptPanel] Map added successfully:', result);

        // 标记为已添加
        setAddedMaps(prev => new Set([...prev, index]));

        // 触发地图列表刷新
        if (onMapAdded) {
          onMapAdded();
        }

        // 3秒后清除"已添加"状态
        setTimeout(() => {
          setAddedMaps(prev => {
            const newSet = new Set(prev);
            newSet.delete(index);
            return newSet;
          });
        }, 3000);
      } else {
        const error = await response.json();
        logger.error('[ModuleScriptPanel] Failed to add map:', error);
      }
    } catch (error) {
      logger.error('[ModuleScriptPanel] Error adding map:', error);
    } finally {
      setAddingMapId(null);
    }
  };

  // 一键添加所有地图图片
  const handleAddAllMapsToCampaign = async () => {
    if (!selectedModule || moduleImages.length === 0) return;

    // 构建章节父级映射
    const chapterParentMap = buildChapterParentMap(chapterTree);

    // 筛选出所有地图类型的图片，并按章节排序
    const mapImages = moduleImages
      .filter((img) => {
        const cat = img.category || img.type || 'unknown';
        return cat === 'map' || cat === '地图';
      })
      .map((img, idx) => ({ ...img, originalIndex: moduleImages.indexOf(img) }));

    if (mapImages.length === 0) {
      logger.info('[ModuleScriptPanel] No map images found');
      return;
    }

    setIsAddingAllMaps(true);

    try {
      // 构建地图数据数组
      const mapsData = (await Promise.all(mapImages.map(async (image) => {
        const mapId = `map_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const imagePath = image.path || image.filename || image.image_id;
        let mapUrl = image.oss_url || image.thumbnail_url;
        if (!mapUrl && imagePath && selectedModule) {
          mapUrl = await fetchModuleAssetDataUrl(selectedModule, imagePath);
        }
        if (!mapUrl && image.image_base64) {
          mapUrl = image.image_base64.startsWith('data:') ? image.image_base64 : `data:image/png;base64,${image.image_base64}`;
        }
        if (!mapUrl) {
          return null;
        }

        // 获取图片所属章节和父章节
        const imageChapter = image.chapter || image.bound_to?.title || '';
        const parentChapter = chapterParentMap.get(imageChapter) || '';

        // 构建地图名称：父章节 > 子章节
        let mapName = '';
        if (parentChapter) {
          mapName = parentChapter;
          if (imageChapter && imageChapter !== parentChapter) {
            mapName = `${mapName} > ${imageChapter}`;
          }
        } else if (imageChapter) {
          mapName = imageChapter;
        }
        if (!mapName) {
          mapName = image.description || '未命名地图';
        }

        return {
          id: mapId,
          name: mapName,
          url: mapUrl,
          chapter: image.chapter || '',
          metadata: {
            type: image.category || image.type || 'map',
            section: image.section,
            line: image.page_index || image.line,
            alt: image.description || image.alt,
            original_path: imagePath,
            image_id: image.image_id
          }
        };
      }))).filter((item): item is NonNullable<typeof item> => item !== null);
      if (mapsData.length === 0) {
        throw new Error("No valid map URLs resolved");
      }

      const response = await authedFetch(
        `/api/campaigns/${campaignId}/module-maps/add-batch?module_id=${selectedModule}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mapsData)
        }
      );

      if (response.ok) {
        const result = await response.json();
        logger.debug('[ModuleScriptPanel] All maps added:', result);

        // 显示成功提示
        setBatchAddResult({
          type: 'success',
          message: `成功添加 ${result.added_count} 张地图`
        });

        // 标记所有地图为已添加
        const addedIndices = new Set(mapImages.map((img) => img.originalIndex));
        setAddedMaps(addedIndices);

        // 触发地图列表刷新
        if (onMapAdded) {
          onMapAdded();
        }

        // 3秒后清除已添加状态和提示
        setTimeout(() => {
          setAddedMaps(new Set());
          setBatchAddResult(null);
        }, 3000);
      } else {
        const error = await response.json();
        logger.error('[ModuleScriptPanel] Failed to add all maps:', error);
        setBatchAddResult({
          type: 'error',
          message: error.detail || '添加地图失败'
        });
        setTimeout(() => setBatchAddResult(null), 5000);
      }
    } catch (error) {
      logger.error('[ModuleScriptPanel] Error adding all maps:', error);
      setBatchAddResult({
        type: 'error',
        message: '网络错误，请重试'
      });
      setTimeout(() => setBatchAddResult(null), 5000);
    } finally {
      setIsAddingAllMaps(false);
    }
  };

  const [mainTab, setMainTab] = useState<'browse' | 'ai' | 'notes'>('browse');

  return (
    <div className="module-script-panel h-full flex flex-col overflow-hidden rounded-xl">
      {/* 顶层 Tab: 模组 / AI / 笔记 */}
      <Tabs.Root value={mainTab} onValueChange={(v) => setMainTab(v as 'browse' | 'ai' | 'notes')} className="h-full flex flex-col min-w-0 relative z-10">
        <Tabs.List className="msp-main-tabs flex-shrink-0">
          <Tabs.Trigger value="browse" className="msp-main-tab">
            <span className="tab-ornament-left" />
            <span className="tab-ornament-right" />
            📜 模组
          </Tabs.Trigger>
          <Tabs.Trigger value="ai" className="msp-main-tab">
            <span className="tab-ornament-left" />
            <span className="tab-ornament-right" />
            🔮 AI
          </Tabs.Trigger>
          <Tabs.Trigger value="notes" className="msp-main-tab">
            <span className="tab-ornament-left" />
            <span className="tab-ornament-right" />
            📝 笔记
          </Tabs.Trigger>
        </Tabs.List>

        {/* 模组浏览 Tab Content */}
        <Tabs.Content value="browse" className="flex-1 flex flex-col overflow-hidden data-[state=inactive]:hidden data-[state=active]:animate-fade-in p-2">
          <Flex direction="column" gap="3" className="msp-browse-content" style={{ height: '100%' }}>
            {/* 顶部模组选择器 */}
            <Box>
              <ModuleSelector
                selectedModule={selectedModule}
                onModuleChange={onModuleChange}
                onModuleLoad={handleModuleLoad}
              />
            </Box>

            {/* 仅在模组加载后显示子 Tab */}
            {currentModule || selectedModule ? (
              <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
                <Tabs.List className="msp-sub-tabs flex-shrink-0">
                  <Tabs.Trigger value="scenes" className="msp-sub-tab">
                    <span className="msp-sub-tab-icon">📖</span>
                    场景/章节
                    <span className="msp-sub-tab-count">{chapterTree.length}</span>
                  </Tabs.Trigger>
                  <Tabs.Trigger value="monsters" className="msp-sub-tab">
                    <span className="msp-sub-tab-icon">👹</span>
                    怪物/NPC
                    <span className="msp-sub-tab-count">{moduleMonsters.length}</span>
                  </Tabs.Trigger>
                  <Tabs.Trigger value="items" className="msp-sub-tab">
                    <span className="msp-sub-tab-icon">⚔️</span>
                    物品
                    <span className="msp-sub-tab-count">{moduleItems.length}</span>
                  </Tabs.Trigger>
                  <Tabs.Trigger value="images" className="msp-sub-tab">
                    <span className="msp-sub-tab-icon">🖼️</span>
                    图片
                    <span className="msp-sub-tab-count">{moduleImages.length}</span>
                  </Tabs.Trigger>
                </Tabs.List>

            {/* 场景/章节 Tab */}
            <Tabs.Content value="scenes" className="flex-1 min-h-0 overflow-auto p-2 data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
              {isLoadingChapters ? (
                <Text size="2" color="gray">加载章节树...</Text>
              ) : chapterTree.length > 0 ? (
                <Flex direction="column" gap="2">
                  {/* 添加章节按钮（仅模组所有者可见） */}
                  {isModuleOwner && (
                    <Flex justify="end" mb="2">
                      <Button size="1" variant="soft" onClick={() => setShowAddChapterDialog(true)}>
                        <Plus size={14} /> 添加章节
                      </Button>
                    </Flex>
                  )}
                  {chapterTree.map((node, index) => (
                    <ChapterTreeNode
                      key={index}
                      node={node}
                      images={moduleImages}
                      moduleId={selectedModule}
                      path={[index]}
                      onEditChapter={handleEditChapter}
                      onSaveContent={handleSaveChapterContent}
                      onSaveTitle={handleSaveChapterTitle}
                      onAddSubChapter={handleAddSubChapter}
                      isEditable={isModuleOwner}
                    />
                  ))}
                </Flex>
              ) : (
                <Flex direction="column" align="center" gap="3" py="4">
                  <Text size="2" color="gray">
                    {selectedModule ? '该模组没有章节数据' : '请先选择一个模组'}
                  </Text>
                  {selectedModule && isModuleOwner && (
                    <Button size="1" variant="soft" onClick={() => setShowAddChapterDialog(true)}>
                      <Plus size={14} /> 添加第一个章节
                    </Button>
                  )}
                </Flex>
              )}
            </Tabs.Content>

            {/* 怪物 Tab */}
            <Tabs.Content value="monsters" className="flex-1 min-h-0 overflow-auto p-2 data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
              {moduleMonsters.length > 0 ? (
                <Flex direction="column" gap="2">
                  {/* 添加怪物按钮和一键加入按钮 */}
                  <Flex justify="between" align="center" gap="2" mb="2">
                    {isModuleOwner && (
                      <Button size="1" variant="soft" onClick={() => setShowAddMonsterDialog(true)}>
                        <Plus size={14} /> 添加怪物/NPC
                      </Button>
                    )}
                    <Flex align="center" gap="2">
                      {monsterBatchResult && (
                        <Text
                          size="1"
                          color={monsterBatchResult.type === 'success' ? 'green' : 'red'}
                          style={{ fontWeight: 500, whiteSpace: 'pre-line', textAlign: 'right', maxWidth: '70%' }}
                        >
                          {monsterBatchResult.message}
                        </Text>
                      )}
                      <button
                        className="msp-batch-btn msp-batch-btn--amber"
                        onClick={handleAddAllMonstersToLibrary}
                        disabled={isAddingAllMonsters}
                    >
                      {isAddingAllMonsters ? (
                        <>
                          <span className="msp-loading-spinner" />
                          添加中...
                        </>
                      ) : (
                        `⚡ 一键加入 (${moduleMonsters.length})`
                      )}
                    </button>
                    </Flex>
                  </Flex>

                  {moduleMonsters.map((monster, index) => {
                    // 尝试从全局配置获取完整数据
                    const globalMonster = monster.config_id && monster.in_configs
                      ? globalMonsters.find((m: any) => m.id === monster.config_id)
                      : null;

                    // 使用全局数据或模组数据
                    const displayMonster = globalMonster || monster;
                    const isAdded = addedMonsterIndices.has(index);
                    const isFailed = failedMonsterIndices.has(index);
                    const failError = failedMonsterIndices.get(index);
                    const isImporting = importingMonsterIndex === index;

                    // 兼容新旧格式：从 description 中提取信息
                    const hasStructuredData = displayMonster.cr || displayMonster.hp || displayMonster.ac;
                    const descPreview = displayMonster.description
                      ? displayMonster.description.substring(0, 80) + (displayMonster.description.length > 80 ? '...' : '')
                      : '';

                    return (
                      <div
                        key={index}
                        className={`msp-card ${classifyMonsterOrNPC(monster) === 'npc' ? 'msp-monster-card--npc' : 'msp-monster-card'} msp-animate-in`}
                        onClick={() => {
                          setSelectedMonster(displayMonster);
                          setShowMonsterModal(true);
                        }}
                      >
                        <Flex direction="column" gap="2">
                          {/* 怪物名称和属性 */}
                          <Flex direction="column" gap="1">
                            <Flex align="center" gap="2">
                              <span className="msp-monster-name">{monster.name}</span>
                              {monster.name_en && (
                                <Text size="1" color="gray">({monster.name_en})</Text>
                              )}
                              {/* NPC/怪物分类标签 */}
                              <span className={`msp-monster-type-badge ${classifyMonsterOrNPC(monster) === 'npc' ? 'msp-monster-type-badge--npc' : 'msp-monster-type-badge--monster'}`}>
                                {classifyMonsterOrNPC(monster) === 'npc' ? 'NPC' : '怪物'}
                              </span>
                            </Flex>
                            {hasStructuredData ? (
                              <Flex gap="2" wrap="wrap" mt="1">
                                {displayMonster.cr && <span className="msp-stat-badge msp-stat-badge--cr">⚔️ CR {displayMonster.cr}</span>}
                                {displayMonster.type && <span className="msp-stat-badge msp-stat-badge--type">{displayMonster.type}</span>}
                                {displayMonster.hp && (
                                  <span className="msp-stat-badge msp-stat-badge--hp">
                                    ❤️ {typeof displayMonster.hp === 'object' ? (displayMonster.hp.average || displayMonster.hp.dice || JSON.stringify(displayMonster.hp)) : displayMonster.hp}
                                  </span>
                                )}
                                {displayMonster.ac && (
                                  <span className="msp-stat-badge msp-stat-badge--ac">
                                    🛡️ {typeof displayMonster.ac === 'object' ? (displayMonster.ac.value || displayMonster.ac.base || JSON.stringify(displayMonster.ac)) : displayMonster.ac}
                                  </span>
                                )}
                              </Flex>
                            ) : descPreview && (
                              <Text size="1" color="gray" style={{ whiteSpace: 'pre-wrap' }}>
                                {descPreview}
                              </Text>
                            )}
                          </Flex>

                          {/* 加入资源库按钮单独一排 */}
                          <Flex align="center" gap="2" wrap="wrap">
                            {isAdded && (
                              <Text size="1" color="green" weight="medium">
                                ✓ 已加入
                              </Text>
                            )}
                            {isFailed && (
                              <Text size="1" color="red" weight="medium" title={failError}>
                                ✗ {failError && failError.length > 20 ? failError.substring(0, 20) + '...' : failError}
                              </Text>
                            )}
                            <button
                              onClick={async (e) => {
                                e.stopPropagation(); // 防止触发卡片的 onClick
                                if (!isImporting && !isAddingAllMonsters) {
                                  // 清除之前的失败状态
                                  if (isFailed) {
                                    setFailedMonsterIndices(prev => {
                                      const newMap = new Map(prev);
                                      newMap.delete(index);
                                      return newMap;
                                    });
                                  }
                                  const result = await handleAddMonsterToLibrary(displayMonster, index);
                                  if (result.skipped) {
                                    // 已存在，显示提示
                                    setMonsterBatchResult({ type: 'success', message: `${displayMonster.name} 已在资源库中` });
                                    setTimeout(() => setMonsterBatchResult(null), 2000);
                                  }
                                }
                              }}
                              className={`msp-add-btn ${
                                isImporting
                                  ? 'msp-add-btn--disabled'
                                  : isAdded
                                    ? 'msp-add-btn--success'
                                    : isFailed
                                      ? 'bg-red-600 hover:bg-red-700 text-white'
                                      : 'msp-add-btn--primary'
                              }`}
                              title={isFailed ? `重试: ${failError}` : '加入资源库'}
                              disabled={isAdded || isImporting || isAddingAllMonsters}
                            >
                              {isImporting ? '...' : isAdded ? '✓' : isFailed ? '!' : '+'}
                            </button>
                            {/* 编辑按钮（仅模组所有者可见） */}
                            {isModuleOwner && (
                              <IconButton
                                size="1"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditMonster(index, monster);
                                }}
                                title="编辑怪物"
                              >
                                <Edit2 size={14} />
                              </IconButton>
                            )}
                          </Flex>
                        </Flex>
                      </div>
                    );
                  })}
                </Flex>
              ) : (
                <Flex direction="column" align="center" gap="3" py="4">
                  <Text size="2" color="gray">该模组没有怪物数据</Text>
                  {selectedModule && isModuleOwner && (
                    <Button size="1" variant="soft" onClick={() => setShowAddMonsterDialog(true)}>
                      <Plus size={14} /> 添加第一个怪物/NPC
                    </Button>
                  )}
                </Flex>
              )}
            </Tabs.Content>

            {/* 物品 Tab */}
            <Tabs.Content value="items" className="flex-1 min-h-0 overflow-auto p-2 data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
              {moduleItems.length > 0 ? (
                <Flex direction="column" gap="2">
                  {/* 添加物品按钮和一键加入按钮 */}
                  <Flex justify="between" align="center" gap="2" mb="2">
                    {isModuleOwner && (
                      <Button size="1" variant="soft" onClick={() => setShowAddItemDialog(true)}>
                        <Plus size={14} /> 添加物品
                      </Button>
                    )}
                    <Flex align="center" gap="2">
                      {itemBatchResult && (
                        <Text
                          size="1"
                          color={itemBatchResult.type === 'success' ? 'green' : 'red'}
                          style={{ fontWeight: 500 }}
                        >
                          {itemBatchResult.message}
                        </Text>
                      )}
                      <button
                        className="msp-batch-btn msp-batch-btn--amber"
                        onClick={handleAddAllItemsToLibrary}
                        disabled={isAddingAllItems}
                      >
                        {isAddingAllItems ? (
                          <>
                            <span className="msp-loading-spinner" />
                            添加中...
                          </>
                        ) : (
                          `⚡ 一键加入 (${moduleItems.length})`
                        )}
                      </button>
                    </Flex>
                  </Flex>

                  {moduleItems.map((item, index) => {
                    const itemId = item.id || `item_${index}`;
                    const isAdded = addedItemId === itemId;
                    const isImporting = importingItemIndex === index;

                    // Get rarity class
                    const rarityClass = item.rarity ? `msp-item-rarity--${(item.rarity || '').toLowerCase().replace(/\s+/g, '-')}` : '';

                    return (
                      <div
                        key={index}
                        className="msp-card msp-item-card msp-animate-in"
                        onClick={() => {
                          setSelectedItem(item);
                          setShowItemModal(true);
                        }}
                      >
                        <Flex direction="column" gap="2">
                          <Flex align="center" gap="2">
                            <span className="msp-item-name">{item.name}</span>
                            {item.name_en && (
                              <Text size="1" color="gray">({item.name_en})</Text>
                            )}
                          </Flex>
                          <Flex gap="2" wrap="wrap">
                            {item.category && <span className="msp-stat-badge msp-stat-badge--type">{tCategory(item.category)}</span>}
                            {item.rarity && <span className={`msp-item-rarity ${rarityClass}`}>{tRarity(item.rarity)}</span>}
                            {item.requires_attunement && <span className="msp-stat-badge msp-stat-badge--cr">✨ 需调谐</span>}
                          </Flex>
                          {item.description && (
                            <Text size="1" color="gray">
                              {item.description.substring(0, 100)}{item.description.length > 100 ? '...' : ''}
                            </Text>
                          )}

                          {/* 加入资源库按钮和编辑按钮 */}
                          <Flex align="center" gap="2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isImporting) {
                                  handleAddItemToLibrary(item, index);
                                }
                              }}
                              className={`msp-batch-btn ${
                                isImporting
                                  ? 'msp-add-btn--disabled'
                                  : isAdded
                                    ? 'msp-add-btn--success'
                                    : 'msp-batch-btn--amber'
                              }`}
                              title="加入资源库"
                              disabled={isImporting}
                            >
                              {isImporting ? '导入中...' : isAdded ? '✓ 已加入' : '+ 加入资源库'}
                            </button>
                            {/* 编辑按钮（仅模组所有者可见） */}
                            {isModuleOwner && (
                              <IconButton
                                size="1"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditItem(index, item);
                                }}
                                title="编辑物品"
                              >
                                <Edit2 size={14} />
                              </IconButton>
                            )}
                          </Flex>
                        </Flex>
                      </div>
                    );
                  })}
                </Flex>
              ) : (
                <Flex direction="column" align="center" gap="3" py="4">
                  <Text size="2" color="gray">该模组没有物品数据</Text>
                  {selectedModule && isModuleOwner && (
                    <Button size="1" variant="soft" onClick={() => setShowAddItemDialog(true)}>
                      <Plus size={14} /> 添加第一个物品
                    </Button>
                  )}
                </Flex>
              )}
            </Tabs.Content>

            {/* 图片 Tab - 按章节和类别分组 */}
            <Tabs.Content value="images" className="flex-1 min-h-0 overflow-auto p-2 data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
              {moduleImages.length > 0 ? (
                <Flex direction="column" gap="3">
                  {/* 一键加入所有地图按钮 */}
                  {(() => {
                    const mapCount = moduleImages.filter(img => {
                      const cat = img.category || img.type || 'unknown';
                      return cat === 'map' || cat === '地图';
                    }).length;
                    return mapCount > 0 ? (
                      <Flex justify="end" align="center" gap="2">
                        {batchAddResult && (
                          <Text
                            size="1"
                            color={batchAddResult.type === 'success' ? 'green' : 'red'}
                            style={{ fontWeight: 500 }}
                          >
                            {batchAddResult.message}
                          </Text>
                        )}
                        <button
                          className="msp-batch-btn msp-batch-btn--blue"
                          onClick={handleAddAllMapsToCampaign}
                          disabled={isAddingAllMaps}
                        >
                          {isAddingAllMaps ? (
                            <>
                              <span className="msp-loading-spinner" />
                              添加中...
                            </>
                          ) : (
                            `🗺️ 一键加入地图 (${mapCount})`
                          )}
                        </button>
                      </Flex>
                    ) : null;
                  })()}
                  <ImagesByChapter
                    images={moduleImages}
                    selectedModule={selectedModule}
                    userId={userId}
                    addingMapId={addingMapId}
                    addedMaps={addedMaps}
                    onAddMap={handleAddMapToCampaign}
                    chapterTree={chapterTree}
                    onSendToChat={onSendImageToChat}
                    members={members}
                  />
                </Flex>
              ) : (
                <Text size="2" color="gray">该模组没有图片数据</Text>
              )}
            </Tabs.Content>
          </Tabs.Root>
        ) : (
          <Box p="4">
            <Text size="2" color="gray">请在上方选择一个模组以查看剧本内容</Text>
          </Box>
        )}
          </Flex>
        </Tabs.Content>

        {/* AI询问 Tab Content */}
        <Tabs.Content value="ai" className="flex-1 flex flex-col overflow-hidden data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
          <Module_AIQueryTab
            moduleId={selectedModule}
            userId={userId}
            moduleTitle={currentModule?.module?.title || '请先选择模组'}
            campaignId={parseInt(campaignId)}
            mapUrl={currentMapUrl}
          />
        </Tabs.Content>

        {/* 备团笔记 Tab Content */}
        <Tabs.Content value="notes" className="flex-1 flex flex-col overflow-hidden min-w-0 data-[state=inactive]:hidden data-[state=active]:animate-fade-in">
          <Module_NotesTab
            moduleId={selectedModule}
            userId={userId}
            campaignId={campaignId}
          />
        </Tabs.Content>
      </Tabs.Root>

      {/* 怪物详情模态框 - 复用资源库的组件 */}
      <ResourceMonsterDetailModal
        monster={convertModuleMonsterToInstance(selectedMonster)}
        open={showMonsterModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowMonsterModal(false);
            setSelectedMonster(null);
          }
        }}
      />

      {/* 物品详情模态框 */}
      <ItemDetailModal
        item={selectedItem}
        open={showItemModal}
        onClose={() => {
          setShowItemModal(false);
          setSelectedItem(null);
        }}
      />

      {/* 编辑章节对话框 */}
      <Dialog.Root open={!!editingChapter} onOpenChange={(open) => !open && setEditingChapter(null)}>
        <Dialog.Content aria-describedby={undefined} style={{ maxWidth: 700 }}>
          <Dialog.Title>编辑章节</Dialog.Title>
          <Flex direction="column" gap="3" mt="3">
            <Box>
              <Text size="2" weight="medium" mb="1">章节标题</Text>
              <TextField.Root
                value={editChapterTitle}
                onChange={(e) => setEditChapterTitle(e.target.value)}
                placeholder="章节标题"
              />
            </Box>
            <Box>
              <Text size="2" weight="medium" mb="1">章节内容 (Markdown)</Text>
              <TextArea
                value={editChapterContent}
                onChange={(e) => setEditChapterContent(e.target.value)}
                placeholder="在此输入章节内容..."
                style={{ minHeight: 300, fontFamily: 'monospace' }}
              />
            </Box>
            <Flex gap="3" justify="end">
              <Button variant="soft" color="gray" onClick={() => setEditingChapter(null)}>取消</Button>
              <Button variant="soft" color="red" onClick={() => {
                if (editingChapter) {
                  handleDeleteChapter(editingChapter.path);
                  setEditingChapter(null);
                }
              }}>删除章节</Button>
              <Button onClick={handleSaveChapter} disabled={isSavingChapter}>
                {isSavingChapter ? '保存中...' : '保存'}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* 添加章节对话框 */}
      <Dialog.Root open={showAddChapterDialog} onOpenChange={setShowAddChapterDialog}>
        <Dialog.Content aria-describedby={undefined} style={{ maxWidth: 700 }}>
          <Dialog.Title>添加新章节</Dialog.Title>
          <Flex direction="column" gap="3" mt="3">
            <Box>
              <Text size="2" weight="medium" mb="1">章节标题</Text>
              <TextField.Root
                value={newChapterTitle}
                onChange={(e) => setNewChapterTitle(e.target.value)}
                placeholder="章节标题"
              />
            </Box>
            <Box>
              <Text size="2" weight="medium" mb="1">章节内容 (Markdown)</Text>
              <TextArea
                value={newChapterContent}
                onChange={(e) => setNewChapterContent(e.target.value)}
                placeholder="在此输入章节内容..."
                style={{ minHeight: 300, fontFamily: 'monospace' }}
              />
            </Box>
            <Flex gap="3" justify="end">
              <Button variant="soft" color="gray" onClick={() => setShowAddChapterDialog(false)}>取消</Button>
              <Button onClick={handleAddChapter} disabled={isSavingChapter || !newChapterTitle.trim()}>
                {isSavingChapter ? '添加中...' : '添加章节'}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* 添加子章节对话框 */}
      <Dialog.Root open={subChapterParentPath !== null} onOpenChange={(open) => !open && setSubChapterParentPath(null)}>
        <Dialog.Content aria-describedby={undefined} style={{ maxWidth: 500 }}>
          <Dialog.Title>添加子章节</Dialog.Title>
          <Flex direction="column" gap="3" mt="3">
            <Box>
              <Text size="2" weight="medium" mb="1">子章节标题</Text>
              <TextField.Root
                value={newSubChapterTitle}
                onChange={(e) => setNewSubChapterTitle(e.target.value)}
                placeholder="输入子章节标题"
                autoFocus
              />
            </Box>
            <Flex gap="3" justify="end">
              <Button variant="soft" color="gray" onClick={() => setSubChapterParentPath(null)}>取消</Button>
              <Button onClick={handleSaveSubChapter} disabled={isSavingChapter || !newSubChapterTitle.trim()}>
                {isSavingChapter ? '添加中...' : '添加子章节'}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* 编辑怪物对话框 */}
      <Dialog.Root open={!!editingMonster} onOpenChange={(open) => !open && setEditingMonster(null)}>
        <Dialog.Content aria-describedby={undefined} style={{ maxWidth: 600 }}>
          <Dialog.Title>编辑怪物/NPC</Dialog.Title>
          <Flex direction="column" gap="3" mt="3">
            <Flex gap="3">
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">名称</Text>
                <TextField.Root
                  value={editMonsterName}
                  onChange={(e) => setEditMonsterName(e.target.value)}
                  placeholder="怪物名称"
                />
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">英文名</Text>
                <TextField.Root
                  value={editMonsterNameEn}
                  onChange={(e) => setEditMonsterNameEn(e.target.value)}
                  placeholder="English name"
                />
              </Box>
            </Flex>
            <Flex gap="3">
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">类型</Text>
                <TextField.Root
                  value={editMonsterType}
                  onChange={(e) => setEditMonsterType(e.target.value)}
                  placeholder="如: 龙类, 不死生物"
                />
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">挑战等级 (CR)</Text>
                <TextField.Root
                  value={editMonsterCr}
                  onChange={(e) => setEditMonsterCr(e.target.value)}
                  placeholder="如: 1/4, 1, 5"
                />
              </Box>
            </Flex>
            <Flex gap="3">
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">生命值 (HP)</Text>
                <TextField.Root
                  value={editMonsterHp}
                  onChange={(e) => setEditMonsterHp(e.target.value)}
                  placeholder="如: 52 (7d10 + 14)"
                />
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">护甲等级 (AC)</Text>
                <TextField.Root
                  value={editMonsterAc}
                  onChange={(e) => setEditMonsterAc(e.target.value)}
                  placeholder="如: 15 (天生护甲)"
                />
              </Box>
            </Flex>
            <Box>
              <Text size="2" weight="medium" mb="1">描述</Text>
              <TextArea
                value={editMonsterDescription}
                onChange={(e) => setEditMonsterDescription(e.target.value)}
                placeholder="怪物描述、能力、战术等..."
                style={{ minHeight: 150 }}
              />
            </Box>
            <Flex gap="3" justify="end">
              <Button variant="soft" color="gray" onClick={() => setEditingMonster(null)}>取消</Button>
              <Button variant="soft" color="red" onClick={() => {
                if (editingMonster) {
                  handleDeleteMonster(editingMonster.index);
                  setEditingMonster(null);
                }
              }}>删除怪物</Button>
              <Button onClick={handleSaveMonster} disabled={isSavingMonster}>
                {isSavingMonster ? '保存中...' : '保存'}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* 添加怪物对话框 */}
      <Dialog.Root open={showAddMonsterDialog} onOpenChange={setShowAddMonsterDialog}>
        <Dialog.Content aria-describedby={undefined} style={{ maxWidth: 600 }}>
          <Dialog.Title>添加怪物/NPC</Dialog.Title>
          <Flex direction="column" gap="3" mt="3">
            <Flex gap="3">
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">名称 *</Text>
                <TextField.Root
                  value={editMonsterName}
                  onChange={(e) => setEditMonsterName(e.target.value)}
                  placeholder="怪物名称"
                />
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">英文名</Text>
                <TextField.Root
                  value={editMonsterNameEn}
                  onChange={(e) => setEditMonsterNameEn(e.target.value)}
                  placeholder="English name"
                />
              </Box>
            </Flex>
            <Flex gap="3">
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">类型</Text>
                <TextField.Root
                  value={editMonsterType}
                  onChange={(e) => setEditMonsterType(e.target.value)}
                  placeholder="如: 龙类, 不死生物"
                />
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">挑战等级 (CR)</Text>
                <TextField.Root
                  value={editMonsterCr}
                  onChange={(e) => setEditMonsterCr(e.target.value)}
                  placeholder="如: 1/4, 1, 5"
                />
              </Box>
            </Flex>
            <Flex gap="3">
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">生命值 (HP)</Text>
                <TextField.Root
                  value={editMonsterHp}
                  onChange={(e) => setEditMonsterHp(e.target.value)}
                  placeholder="如: 52 (7d10 + 14)"
                />
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">护甲等级 (AC)</Text>
                <TextField.Root
                  value={editMonsterAc}
                  onChange={(e) => setEditMonsterAc(e.target.value)}
                  placeholder="如: 15 (天生护甲)"
                />
              </Box>
            </Flex>
            <Box>
              <Text size="2" weight="medium" mb="1">描述</Text>
              <TextArea
                value={editMonsterDescription}
                onChange={(e) => setEditMonsterDescription(e.target.value)}
                placeholder="怪物描述、能力、战术等..."
                style={{ minHeight: 150 }}
              />
            </Box>
            <Flex gap="3" justify="end">
              <Button variant="soft" color="gray" onClick={() => {
                setShowAddMonsterDialog(false);
                setEditMonsterName('');
                setEditMonsterNameEn('');
                setEditMonsterType('');
                setEditMonsterCr('');
                setEditMonsterHp('');
                setEditMonsterAc('');
                setEditMonsterDescription('');
              }}>取消</Button>
              <Button onClick={handleAddMonster} disabled={isSavingMonster || !editMonsterName.trim()}>
                {isSavingMonster ? '添加中...' : '添加怪物'}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* 编辑物品对话框 */}
      <Dialog.Root open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <Dialog.Content aria-describedby={undefined} style={{ maxWidth: 600 }}>
          <Dialog.Title>编辑物品</Dialog.Title>
          <Flex direction="column" gap="3" mt="3">
            <Flex gap="3">
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">名称</Text>
                <TextField.Root
                  value={editItemName}
                  onChange={(e) => setEditItemName(e.target.value)}
                  placeholder="物品名称"
                />
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">英文名</Text>
                <TextField.Root
                  value={editItemNameEn}
                  onChange={(e) => setEditItemNameEn(e.target.value)}
                  placeholder="English name"
                />
              </Box>
            </Flex>
            <Flex gap="3">
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">类别</Text>
                <TextField.Root
                  value={editItemCategory}
                  onChange={(e) => setEditItemCategory(e.target.value)}
                  placeholder="如: 武器, 护甲, 药水"
                />
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">稀有度</Text>
                <TextField.Root
                  value={editItemRarity}
                  onChange={(e) => setEditItemRarity(e.target.value)}
                  placeholder="如: 普通, 精良, 稀有"
                />
              </Box>
            </Flex>
            <Box>
              <Text size="2" weight="medium" mb="1">描述</Text>
              <TextArea
                value={editItemDescription}
                onChange={(e) => setEditItemDescription(e.target.value)}
                placeholder="物品描述、效果、使用方法等..."
                style={{ minHeight: 150 }}
              />
            </Box>
            <Flex gap="3" justify="end">
              <Button variant="soft" color="gray" onClick={() => setEditingItem(null)}>取消</Button>
              <Button variant="soft" color="red" onClick={() => {
                if (editingItem) {
                  handleDeleteItem(editingItem.index);
                  setEditingItem(null);
                }
              }}>删除物品</Button>
              <Button onClick={handleSaveItem} disabled={isSavingItem}>
                {isSavingItem ? '保存中...' : '保存'}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* 添加物品对话框 */}
      <Dialog.Root open={showAddItemDialog} onOpenChange={setShowAddItemDialog}>
        <Dialog.Content aria-describedby={undefined} style={{ maxWidth: 600 }}>
          <Dialog.Title>添加物品</Dialog.Title>
          <Flex direction="column" gap="3" mt="3">
            <Flex gap="3">
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">名称 *</Text>
                <TextField.Root
                  value={editItemName}
                  onChange={(e) => setEditItemName(e.target.value)}
                  placeholder="物品名称"
                />
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">英文名</Text>
                <TextField.Root
                  value={editItemNameEn}
                  onChange={(e) => setEditItemNameEn(e.target.value)}
                  placeholder="English name"
                />
              </Box>
            </Flex>
            <Flex gap="3">
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">类别</Text>
                <TextField.Root
                  value={editItemCategory}
                  onChange={(e) => setEditItemCategory(e.target.value)}
                  placeholder="如: 武器, 护甲, 药水"
                />
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="2" weight="medium" mb="1">稀有度</Text>
                <TextField.Root
                  value={editItemRarity}
                  onChange={(e) => setEditItemRarity(e.target.value)}
                  placeholder="如: 普通, 精良, 稀有"
                />
              </Box>
            </Flex>
            <Box>
              <Text size="2" weight="medium" mb="1">描述</Text>
              <TextArea
                value={editItemDescription}
                onChange={(e) => setEditItemDescription(e.target.value)}
                placeholder="物品描述、效果、使用方法等..."
                style={{ minHeight: 150 }}
              />
            </Box>
            <Flex gap="3" justify="end">
              <Button variant="soft" color="gray" onClick={() => {
                setShowAddItemDialog(false);
                setEditItemName('');
                setEditItemNameEn('');
                setEditItemCategory('');
                setEditItemRarity('');
                setEditItemDescription('');
              }}>取消</Button>
              <Button onClick={handleAddItem} disabled={isSavingItem || !editItemName.trim()}>
                {isSavingItem ? '添加中...' : '添加物品'}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
