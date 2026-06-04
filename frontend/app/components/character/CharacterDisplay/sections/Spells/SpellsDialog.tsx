import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { Spell } from "../../types/Spell";
import type { EquipmentItem } from "../../types/Character";
import type { SpellcastingAbilityId, SpellcasterType } from "~/hooks/useCharacterSpellcasting";
import { SpellAttributeTooltip, analyzeSpellTargeting, isSelfCenteredAreaSpell } from "~/components/ui/Rules_SpellDetail";
import { CornerOrnament, SlotGemRow, SCHOOL_ACCENTS, SourceBadge } from "./SpellbookSvg";
import { SpellCard } from "~/components/spell/SpellCard";
import { UpcastLevelSelector } from "~/components/spell/UpcastLevelSelector";
import { normalizeSpellData } from "~/components/spell/normalizeSpell";
import { applyCharacterSpellModifiers } from "~/utils/spellModifiers";
import { getAssetUrl } from "~/utils/asset-url";
import {
  hasMaterialComponent, needsMaterialCheck, getAvailableMaterials, ensureComponentsLoaded,
} from "~/components/spell/spellMaterialUtils";
import { getIconPath } from "~/components/character/CharacterDisplay/utils/rules";
import { needsIllusionInput, isDisguiseSpell, AreaSizeSelector } from "~/components/spell/SpellCastActions";
import type { SpellCastData } from "~/components/spell/SpellCastActions";
import { checkNeedsTeleportDestination } from "~/utils/spellCastMiddleware";
// setPendingAreaSize removed — areaSize is now passed through SpellCastData
import { apiFetch } from "~/utils/api-client";

/** Per-class spellcasting theme */
interface SpellTheme {
  title: string;
  icon: string;
  emptyText: string;
  flipSound: string;
  bookBorder: string;
  bookBg: string;
  pageL: React.CSSProperties;
  pageR: React.CSSProperties;
  accent: string; // Tailwind color token
}

const mkPages = (lR: string, lS: string, rR: string, rS: string): Pick<SpellTheme, 'pageL' | 'pageR'> => ({
  pageL: { background: lR, boxShadow: `inset -18px 0 30px -12px rgba(0,0,0,0.55), ${lS}` },
  pageR: { background: rR, boxShadow: `inset 18px 0 30px -12px rgba(0,0,0,0.55), ${rS}` },
});

const SPELL_THEMES: Record<string, SpellTheme> = {
  wizard: {
    title: '法术书', icon: '📖', emptyText: '尚无法术记录', accent: 'amber',
    flipSound: '/sounds/ui/page_flip.mp3',
    bookBorder: 'rgba(139,92,42,0.45)', bookBg: 'linear-gradient(180deg,#1a150e,#1f1812,#1a150e)',
    ...mkPages(
      'radial-gradient(ellipse at 20% 15%,rgba(65,55,38,0.5) 0%,transparent 50%),radial-gradient(ellipse at 80% 90%,rgba(40,33,22,0.3) 0%,transparent 40%),linear-gradient(135deg,#2b2319,#33291f,#2a2218)', '0 0 0 transparent',
      'radial-gradient(ellipse at 80% 15%,rgba(55,45,32,0.4) 0%,transparent 50%),radial-gradient(ellipse at 20% 85%,rgba(45,38,26,0.3) 0%,transparent 40%),linear-gradient(135deg,#2e2519,#342a20,#2b2319)', '0 0 0 transparent',
    ),
  },
  sorcerer: {
    title: '天赋法术', icon: '🔮', emptyText: '血脉之力尚未觉醒', accent: 'purple',
    flipSound: '/sounds/spells/magic_cast.mp3',
    bookBorder: 'rgba(147,51,234,0.35)', bookBg: 'linear-gradient(180deg,#140e1e,#1a1228,#140e1e)',
    ...mkPages(
      'radial-gradient(ellipse at 20% 15%,rgba(60,30,80,0.4) 0%,transparent 50%),radial-gradient(ellipse at 80% 90%,rgba(40,20,55,0.3) 0%,transparent 40%),linear-gradient(135deg,#1a1225,#201530,#1a1225)', '0 0 40px rgba(147,51,234,0.03)',
      'radial-gradient(ellipse at 80% 15%,rgba(55,28,75,0.35) 0%,transparent 50%),radial-gradient(ellipse at 20% 85%,rgba(45,22,60,0.3) 0%,transparent 40%),linear-gradient(135deg,#1c1328,#221632,#1c1328)', '0 0 40px rgba(147,51,234,0.03)',
    ),
  },
  warlock: {
    title: '契约魔典', icon: '👁️', emptyText: '契约尚未赐予力量', accent: 'emerald',
    flipSound: '/sounds/spells/necrotic_cast.mp3',
    bookBorder: 'rgba(34,197,94,0.3)', bookBg: 'linear-gradient(180deg,#0a140e,#0f1a14,#0a140e)',
    ...mkPages(
      'radial-gradient(ellipse at 20% 15%,rgba(20,50,30,0.5) 0%,transparent 50%),radial-gradient(ellipse at 80% 90%,rgba(15,35,20,0.3) 0%,transparent 40%),linear-gradient(135deg,#0f1a14,#142018,#0f1a14)', '0 0 40px rgba(34,197,94,0.03)',
      'radial-gradient(ellipse at 80% 15%,rgba(18,45,28,0.4) 0%,transparent 50%),radial-gradient(ellipse at 20% 85%,rgba(14,38,22,0.3) 0%,transparent 40%),linear-gradient(135deg,#101c15,#15221a,#101c15)', '0 0 40px rgba(34,197,94,0.03)',
    ),
  },
  bard: {
    title: '吟游秘咒', icon: '🎵', emptyText: '尚无秘咒领悟', accent: 'yellow',
    flipSound: '/sounds/spells/inspire_chime.mp3',
    bookBorder: 'rgba(234,179,8,0.35)', bookBg: 'linear-gradient(180deg,#1a160a,#201c0e,#1a160a)',
    ...mkPages(
      'radial-gradient(ellipse at 20% 15%,rgba(70,55,20,0.45) 0%,transparent 50%),radial-gradient(ellipse at 80% 90%,rgba(50,38,12,0.3) 0%,transparent 40%),linear-gradient(135deg,#241e10,#2d2514,#241e10)', '0 0 0 transparent',
      'radial-gradient(ellipse at 80% 15%,rgba(65,50,18,0.4) 0%,transparent 50%),radial-gradient(ellipse at 20% 85%,rgba(48,36,10,0.3) 0%,transparent 40%),linear-gradient(135deg,#261f11,#2f2615,#261f11)', '0 0 0 transparent',
    ),
  },
  cleric: {
    title: '祈祷书', icon: '✝️', emptyText: '神明尚未赐予启示', accent: 'amber',
    flipSound: '/sounds/spells/radiant_cast.mp3',
    bookBorder: 'rgba(251,191,36,0.35)', bookBg: 'linear-gradient(180deg,#1c1710,#221c14,#1c1710)',
    ...mkPages(
      'radial-gradient(ellipse at 20% 15%,rgba(70,60,35,0.45) 0%,transparent 50%),radial-gradient(ellipse at 80% 90%,rgba(50,42,22,0.3) 0%,transparent 40%),linear-gradient(135deg,#28201a,#302820,#28201a)', '0 0 30px rgba(251,191,36,0.02)',
      'radial-gradient(ellipse at 80% 15%,rgba(65,55,30,0.4) 0%,transparent 50%),radial-gradient(ellipse at 20% 85%,rgba(48,40,20,0.3) 0%,transparent 40%),linear-gradient(135deg,#2a221c,#322a22,#2a221c)', '0 0 30px rgba(251,191,36,0.02)',
    ),
  },
  druid: {
    title: '自然秘典', icon: '🌿', emptyText: '自然之声尚未回应', accent: 'green',
    flipSound: '/sounds/spells/vines_grow.mp3',
    bookBorder: 'rgba(74,222,128,0.3)', bookBg: 'linear-gradient(180deg,#0e180c,#141f12,#0e180c)',
    ...mkPages(
      'radial-gradient(ellipse at 20% 15%,rgba(30,55,25,0.45) 0%,transparent 50%),radial-gradient(ellipse at 80% 90%,rgba(20,40,18,0.3) 0%,transparent 40%),linear-gradient(135deg,#141f12,#1a2618,#141f12)', '0 0 40px rgba(74,222,128,0.03)',
      'radial-gradient(ellipse at 80% 15%,rgba(28,50,22,0.4) 0%,transparent 50%),radial-gradient(ellipse at 20% 85%,rgba(22,42,18,0.3) 0%,transparent 40%),linear-gradient(135deg,#16211a,#1c281e,#16211a)', '0 0 40px rgba(74,222,128,0.03)',
    ),
  },
  paladin: {
    title: '誓约圣典', icon: '⚔️', emptyText: '誓约尚未赐予神力', accent: 'slate',
    flipSound: '/sounds/spells/shield_up.mp3',
    bookBorder: 'rgba(148,163,184,0.25)', bookBg: 'linear-gradient(180deg,#14161a,#1a1c22,#14161a)',
    ...mkPages(
      'radial-gradient(ellipse at 20% 15%,rgba(50,55,65,0.4) 0%,transparent 50%),radial-gradient(ellipse at 80% 90%,rgba(35,38,45,0.3) 0%,transparent 40%),linear-gradient(135deg,#1a1c22,#20232a,#1a1c22)', '0 0 30px rgba(148,163,184,0.02)',
      'radial-gradient(ellipse at 80% 15%,rgba(48,52,60,0.35) 0%,transparent 50%),radial-gradient(ellipse at 20% 85%,rgba(38,40,48,0.3) 0%,transparent 40%),linear-gradient(135deg,#1c1e25,#22252c,#1c1e25)', '0 0 30px rgba(148,163,184,0.02)',
    ),
  },
  ranger: {
    title: '野性直觉', icon: '🏹', emptyText: '自然之力尚未感应', accent: 'lime',
    flipSound: '/sounds/spells/vines_grow.mp3',
    bookBorder: 'rgba(101,163,13,0.3)', bookBg: 'linear-gradient(180deg,#12180a,#181e10,#12180a)',
    ...mkPages(
      'radial-gradient(ellipse at 20% 15%,rgba(40,50,20,0.45) 0%,transparent 50%),radial-gradient(ellipse at 80% 90%,rgba(28,38,14,0.3) 0%,transparent 40%),linear-gradient(135deg,#181e10,#1e2516,#181e10)', '0 0 0 transparent',
      'radial-gradient(ellipse at 80% 15%,rgba(38,48,18,0.4) 0%,transparent 50%),radial-gradient(ellipse at 20% 85%,rgba(30,40,15,0.3) 0%,transparent 40%),linear-gradient(135deg,#1a2012,#202718,#1a2012)', '0 0 0 transparent',
    ),
  },
  artificer: {
    title: '工匠手册', icon: '⚙️', emptyText: '尚未记载发明方案', accent: 'orange',
    flipSound: '/sounds/ui/page_flip.mp3',
    bookBorder: 'rgba(234,138,56,0.35)', bookBg: 'linear-gradient(180deg,#1a120a,#221810,#1a120a)',
    ...mkPages(
      'radial-gradient(ellipse at 20% 15%,rgba(60,40,20,0.45) 0%,transparent 50%),radial-gradient(ellipse at 80% 90%,rgba(42,28,14,0.3) 0%,transparent 40%),linear-gradient(135deg,#221810,#2a1e14,#221810)', '0 0 0 transparent',
      'radial-gradient(ellipse at 80% 15%,rgba(55,38,18,0.4) 0%,transparent 50%),radial-gradient(ellipse at 20% 85%,rgba(45,30,15,0.3) 0%,transparent 40%),linear-gradient(135deg,#241a12,#2c2016,#241a12)', '0 0 0 transparent',
    ),
  },
};

function getTheme(classId?: string): SpellTheme {
  return (classId && SPELL_THEMES[classId]) || SPELL_THEMES.wizard;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isPreparedCaster: boolean;
  classId?: string;
  cantripsLocal: string[];
  knownSpells: string[];
  preparedLocal: string[];
  preparedCount: number;
  preparedMax: number;
  togglePreparedWithLimit: (id: string) => void;
  setPreparedSpellsAndPersist: (spells: string[]) => Promise<void>;
  spellsAll: Spell[];
  spellSources?: Record<string, string>;
  /** Maps racial spell ID to usesPerDay (undefined = at will) */
  racialSpellMeta?: Record<string, { usesPerDay?: number; traitName?: string; spellcastingAbility?: string }>;
  spellcastingAbilityLabel: string;
  spellcastingAbilityScore?: number;
  spellcastingAbilityMod?: number;
  spellcastingAbilityId: SpellcastingAbilityId | null;
  spellcasterType: SpellcasterType | null;
  spellSaveDC: number | null;
  spellAttackStr: string | null;
  spellSlots: number[];
  remainingSlots: number[];
  autoPrepared: string[];
  onConsumeSlot: (level: number) => void;
  onCastSpell?: (data: SpellCastData) => void;
  canPrepareSpells: boolean;
  onPreparationFinished: () => void;
  /** 邪术师魔能祈唤ID列表，用于修改EB法术展示 */
  eldritchInvocations?: string[];
  /** 魅力调整值，用于agonizing_blast显示 */
  charismaMod?: number;
  /** 角色子职业ID，用于子职业特性增强法术展示 */
  subclassId?: string;
  /** 祈唤赐予法术的元数据 */
  invocationSpellMeta?: Record<string, { invocationName: string; atWill: boolean; usesPerLongRest?: number }>;
  /** 角色装备列表（用于材料验证） */
  equipment?: EquipmentItem[];
  /** 角色是否沉默状态 */
  isSilenced?: boolean;
  /** 角色是否拥有战斗施法者等能力 */
  hasSomaticFreedom?: boolean;
  /** embedded 模式：直接渲染内容，不使用 Dialog 包裹 */
  embedded?: boolean;
  /** 怪物模式：自由选法术、无上限、可编辑法术位 */
  monsterMode?: boolean;
  /** 怪物模式下修改法术位上限的回调 */
  onUpdateSpellSlots?: (slots: number[]) => void;
  /** 当前正在专注的法术ID */
  concentratingSpellId?: string | null;
  /** 当前正在专注的法术名称 */
  concentratingSpellName?: string | null;
  /** 是否为DM视图 */
  isDM?: boolean;
  /** DM添加法术回调 */
  onDMAddSpell?: (spellIds: string[]) => void | Promise<void>;
  /** 战役ID（用于幻象图片生成） */
  campaignId?: string;
}

const SCHOOL_CN: Record<string, string> = {
  abjuration: '防护', conjuration: '咒法', divination: '预言', enchantment: '惑控',
  evocation: '塑能', illusion: '幻术', necromancy: '死灵', transmutation: '变化',
};
const SCHOOL_ICON: Record<string, string> = {
  abjuration: '🛡️', conjuration: '🌀', divination: '👁️', enchantment: '💫',
  evocation: '🔥', illusion: '🌫️', necromancy: '💀', transmutation: '⚗️',
};
const levelLabel = (lv: number) => lv === 0 ? '戏法' : `${lv}环`;
const ABILITY_CN: Record<string, string> = {
  strength: '力量', dexterity: '敏捷', constitution: '体质',
  intelligence: '智力', wisdom: '感知', charisma: '魅力',
};

export function SpellsDialog({
  open, onOpenChange, isPreparedCaster, classId, cantripsLocal, knownSpells,
  preparedLocal, preparedCount, preparedMax,
  setPreparedSpellsAndPersist, spellsAll, spellSources = {}, racialSpellMeta = {},
  spellcastingAbilityId, spellcastingAbilityLabel, spellcastingAbilityMod,
  spellcasterType, spellSaveDC, spellAttackStr,
  spellSlots, remainingSlots, autoPrepared, onConsumeSlot, onCastSpell,
  canPrepareSpells, onPreparationFinished,
  eldritchInvocations = [], charismaMod = 0, subclassId, invocationSpellMeta = {},
  equipment, isSilenced, hasSomaticFreedom, embedded,
  monsterMode, onUpdateSpellSlots,
  concentratingSpellId, concentratingSpellName,
  isDM, onDMAddSpell, campaignId,
}: Props) {
  const theme = React.useMemo(() => monsterMode ? SPELL_THEMES.wizard : getTheme(classId), [classId, monsterMode]);
  const [selectedSpell, setSelectedSpell] = React.useState<Spell | null>(null);
  const [selectedCastLevel, setSelectedCastLevel] = React.useState<number>(0);
  const [mode, setMode] = React.useState<"use" | "prepare" | "dmAdd">("use");
  const [pendingPrepared, setPendingPrepared] = React.useState<string[]>([]);
  const [dmAddPending, setDmAddPending] = React.useState<string[]>([]);
  const [pageIdx, setPageIdx] = React.useState(0);
  const [isFlipping, setIsFlipping] = React.useState(false);
  const [flipDir, setFlipDir] = React.useState<'fwd' | 'bwd'>('fwd');
  const [contentKey, setContentKey] = React.useState(0);
  const touchRef = React.useRef<{ x: number; t: number } | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [componentsReady, setComponentsReady] = React.useState(false);
  const [selectedMaterial, setSelectedMaterial] = React.useState<string | null>(null);
  const [showMaterialPanel, setShowMaterialPanel] = React.useState(false);
  const materialSlotRef = React.useRef<HTMLDivElement>(null);
  const [editingSlots, setEditingSlots] = React.useState(false);
  const [editSlotValues, setEditSlotValues] = React.useState<number[]>([]);
  const [selectedAreaSize, setSelectedAreaSize] = React.useState<number>(0);

  // Illusion image state for disguise/illusion spells
  const [illusionDesc, setIllusionDesc] = React.useState('');
  const [illusionUrl, setIllusionUrl] = React.useState<string | null>(null);
  const [illusionDisplayName, setIllusionDisplayName] = React.useState('');
  const [illusionMode, setIllusionMode] = React.useState<'generate' | 'library'>('generate');
  const [illusionGenerating, setIllusionGenerating] = React.useState(false);
  const [illusionLibrary, setIllusionLibrary] = React.useState<{ id: string | number; url: string; name: string }[]>([]);
  const [illusionLibraryLoaded, setIllusionLibraryLoaded] = React.useState(false);

  React.useEffect(() => { ensureComponentsLoaded().then(() => setComponentsReady(true)) }, []);

  // 点击外部关闭材料面板
  React.useEffect(() => {
    if (!showMaterialPanel) return;
    const handler = (e: MouseEvent) => {
      if (materialSlotRef.current && !materialSlotRef.current.contains(e.target as Node))
        setShowMaterialPanel(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMaterialPanel]);

  // 选中法术变化时，重置升环等级为法术本身等级 & 重置材料选择 & 重置幻象
  React.useEffect(() => {
    setSelectedCastLevel((selectedSpell as any)?.level ?? 0);
    setSelectedMaterial(null);
    setShowMaterialPanel(false);
    setIllusionUrl(null);
    setIllusionDesc('');
    setIllusionDisplayName('');
  }, [selectedSpell]);

  // Load illusion library when switching to library tab
  const loadIllusionLibrary = React.useCallback(async () => {
    if (illusionLibraryLoaded) return;
    try {
      const resp = await apiFetch('/api/spells/illusion-library');
      if (resp.ok) {
        const data = await resp.json();
        setIllusionLibrary(data.avatars || []);
      }
    } catch { /* ignore */ }
    setIllusionLibraryLoaded(true);
  }, [illusionLibraryLoaded]);

  React.useEffect(() => {
    if (selectedSpell && needsIllusionInput(selectedSpell as any) && illusionMode === 'library') {
      loadIllusionLibrary();
    }
  }, [selectedSpell, illusionMode, loadIllusionLibrary]);

  const handleGenerateIllusion = React.useCallback(async () => {
    if (!illusionDesc.trim() || illusionGenerating) return;
    setIllusionGenerating(true);
    try {
      const resp = await apiFetch('/api/spells/generate-illusion-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: illusionDesc.trim(),
          spell_id: selectedSpell?.id,
          campaign_id: campaignId ? parseInt(campaignId) : 0,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setIllusionUrl(data.image_url);
        if (data.display_name) setIllusionDisplayName(data.display_name);
        setIllusionLibraryLoaded(false);
      }
    } catch { /* ignore */ }
    setIllusionGenerating(false);
  }, [illusionDesc, illusionGenerating, selectedSpell, campaignId]);

  const playPageFlip = React.useCallback(() => {
    try {
      if (!audioRef.current || audioRef.current.src !== theme.flipSound) {
        audioRef.current = new Audio(theme.flipSound);
      }
      const a = audioRef.current;
      a.currentTime = 0;
      a.volume = 0.35;
      a.play().catch(() => {});
    } catch {}
  }, [theme.flipSound]);

  React.useEffect(() => {
    if (!open) { setMode("use"); setPendingPrepared([]); setDmAddPending([]); setSelectedSpell(null); setPageIdx(0); setIsFlipping(false); }
    // 准备型施法者没有已准备法术时，自动进入准备模式（怪物模式除外）
    if (open && !monsterMode && isPreparedCaster && preparedLocal.length === 0 && knownSpells.length > 0) {
      setMode("prepare");
    }
  }, [open]);
  React.useEffect(() => { if (mode === "prepare") setPendingPrepared([...preparedLocal]); }, [mode, preparedLocal]);
  React.useEffect(() => { setPageIdx(0); setSelectedSpell(null); }, [mode]);

  // Reset area size when spell changes
  React.useEffect(() => {
    if (selectedSpell?.areaOfEffect?.size) setSelectedAreaSize(selectedSpell.areaOfEffect.size);
  }, [selectedSpell]);

  const togglePending = (id: string) => {
    if (autoPrepared.includes(id)) return;
    setPendingPrepared(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.filter(x => !autoPrepared.includes(x)).length >= preparedMax) return prev;
      return [...prev, id];
    });
  };
  const confirmPreparation = async () => {
    await setPreparedSpellsAndPersist(pendingPrepared);
    onPreparationFinished(); setMode("use");
  };
  const pendingCount = pendingPrepared.filter(x => !autoPrepared.includes(x)).length;
  const slotLabel = spellcasterType === "pact" ? "契约位" : "法术位";

  // 邪术师契约魔法：所有法术位都是同一等级，低环法术也用高环位施放
  // pactSlot: { level, max, cur } — 如果是契约施法者，找到唯一的契约位等级
  const pactSlot = React.useMemo(() => {
    if (spellcasterType !== 'pact') return null;
    for (let i = 9; i >= 1; i--) {
      if ((spellSlots?.[i] ?? 0) > 0) {
        return { level: i, max: spellSlots[i], cur: remainingSlots?.[i] ?? spellSlots[i] };
      }
    }
    return null;
  }, [spellcasterType, spellSlots, remainingSlots]);

  /** 获取某个法术等级可用的法术位 max/cur（邪术师用契约位） */
  const getSlotInfo = (spellLv: number) => {
    if (spellLv <= 0) return { max: 0, cur: 0, slotLv: 0 };
    if (pactSlot && spellLv <= pactSlot.level) {
      return { max: pactSlot.max, cur: pactSlot.cur, slotLv: pactSlot.level };
    }
    const max = spellSlots?.[spellLv] ?? 0;
    return { max, cur: remainingSlots?.[spellLv] ?? max, slotLv: spellLv };
  };
  const profBonus = (spellSaveDC != null && spellcastingAbilityMod != null) ? spellSaveDC - 8 - spellcastingAbilityMod : null;
  const modStr = spellcastingAbilityMod != null ? (spellcastingAbilityMod >= 0 ? `+${spellcastingAbilityMod}` : `${spellcastingAbilityMod}`) : null;

  /** 法术修正上下文（祈唤等职业特性） */
  const spellModCtx = React.useMemo(() => ({
    eldritchInvocations,
    charismaMod,
    subclassId,
  }), [eldritchInvocations, charismaMod, subclassId]);

  const availableLevels = React.useMemo(() => {
    // DM Add mode: show all spell levels 0-9
    if (mode === 'dmAdd') {
      return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    }
    const levels = new Set<number>();
    if (cantripsLocal.length > 0) levels.add(0);
    const ids = mode === 'prepare' ? knownSpells : (isPreparedCaster ? preparedLocal : knownSpells);
    ids.forEach(id => {
      const sp = spellsAll.find(s => s.id === id);
      if (!sp) return;
      const lv = (sp as any).level ?? 0;
      if (lv === 0) {
        // In monsterMode prepare, show cantrip page from knownSpells
        if (monsterMode && mode === 'prepare') levels.add(0);
      } else {
        // 邪术师：所有有环法术归到契约位等级
        levels.add(pactSlot ? pactSlot.level : lv);
      }
    });
    return [...levels].sort((a, b) => a - b);
  }, [cantripsLocal, knownSpells, preparedLocal, isPreparedCaster, mode, spellsAll, pactSlot, monsterMode]);

  React.useEffect(() => {
    if (pageIdx >= availableLevels.length && availableLevels.length > 0) setPageIdx(availableLevels.length - 1);
  }, [pageIdx, availableLevels.length]);

  const currentLevel = availableLevels[pageIdx] ?? 0;
  const pageSpells = React.useMemo(() => {
    // DM Add mode: show all spells for current level, excluding already known
    if (mode === 'dmAdd') {
      const existingIds = new Set([...cantripsLocal, ...knownSpells]);
      return spellsAll.filter(sp => {
        const lv = (sp as any).level ?? 0;
        return lv === currentLevel && !existingIds.has(sp.id);
      });
    }
    const ids = currentLevel === 0
      ? (monsterMode && mode === 'prepare' ? knownSpells : cantripsLocal)
      : (mode === 'prepare' ? knownSpells : (isPreparedCaster ? preparedLocal : knownSpells));
    return ids.map(id => spellsAll.find(s => s.id === id))
      .filter((sp): sp is Spell => {
        if (!sp) return false;
        const lv = (sp as any).level ?? 0;
        if (currentLevel === 0) return lv === 0;
        if (pactSlot) return lv > 0 && lv <= pactSlot.level;
        return lv === currentLevel;
      });
  }, [currentLevel, cantripsLocal, knownSpells, preparedLocal, isPreparedCaster, mode, spellsAll, pactSlot]);

  // Auto-select first spell when page has spells but nothing is selected
  React.useEffect(() => {
    if (!selectedSpell && pageSpells.length > 0) setSelectedSpell(pageSpells[0]);
  }, [pageSpells, selectedSpell]);

  const goToPage = React.useCallback((idx: number) => {
    if (isFlipping || idx === pageIdx || idx < 0 || idx >= availableLevels.length) return;
    setFlipDir(idx > pageIdx ? 'fwd' : 'bwd');
    setIsFlipping(true);
    setSelectedSpell(null);
    setPageIdx(idx);
    setContentKey(k => k + 1);
    playPageFlip();
    setTimeout(() => setIsFlipping(false), 600);
  }, [isFlipping, pageIdx, availableLevels.length, playPageFlip]);

  const sel = selectedSpell as any;
  const detailLv = sel?.level ?? 0;
  const detailSlot = getSlotInfo(detailLv);
  const detailSlotMax = detailSlot.max;
  const detailSlotCur = detailSlot.cur;
  const detailSlotLv = detailSlot.slotLv; // 实际消耗的法术位等级（邪术师可能高于法术等级）

  const PAGE_L = theme.pageL;
  const PAGE_R = theme.pageR;

  if (availableLevels.length === 0 && !(isPreparedCaster && !monsterMode && knownSpells.length > 0) && (open || embedded)) {
    const emptyContent = (
      <div className="spellbook p-8 text-center" style={{ background: theme.bookBg, borderColor: theme.bookBorder }}>
        <div className="text-amber-300/80 text-sm mb-2">{monsterMode ? '📜' : theme.icon} {monsterMode ? '法术列表' : theme.title}</div>
        <p className="text-amber-500/40 text-xs italic">{monsterMode ? '暂无法术' : theme.emptyText}</p>
        {monsterMode && (
          <button className="mt-4 px-4 py-1.5 text-xs rounded border border-amber-600/30 text-amber-300/70 hover:text-amber-100 hover:bg-amber-700/25 transition-colors"
            onClick={() => setMode("prepare")}>
            添加法术
          </button>
        )}
        {!embedded && !monsterMode && (
          <button className="mt-4 px-4 py-1.5 text-xs rounded border border-amber-700/30 text-amber-400/60 hover:text-amber-200"
            onClick={() => onOpenChange(false)}>关闭</button>
        )}
      </div>
    );
    if (embedded) return <>{emptyContent}</>;
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/80 z-[10198]" />
          <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10200] w-80">
            {emptyContent}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  const spellbookContent = (
          <div className={`spellbook relative ${embedded ? 'flex flex-col h-full' : ''}`} style={{ background: theme.bookBg, borderColor: theme.bookBorder }}>
            {/* Corner ornaments on the book frame */}
            <CornerOrnament className="absolute top-0 left-0 z-30 pointer-events-none" color={theme.bookBorder} />
            <CornerOrnament className="absolute top-0 right-0 z-30 -scale-x-100 pointer-events-none" color={theme.bookBorder} />
            <CornerOrnament className="absolute bottom-0 left-0 z-30 -scale-y-100 pointer-events-none" color={theme.bookBorder} />
            <CornerOrnament className="absolute bottom-0 right-0 z-30 scale-[-1] pointer-events-none" color={theme.bookBorder} />

            {/* ── Header ── */}
            <div className="px-4 sm:px-6 py-2 border-b border-amber-800/25 bg-gradient-to-r from-transparent via-amber-900/8 to-transparent flex-shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base flex-shrink-0">{monsterMode ? '📜' : theme.icon}</span>
                  {embedded
                    ? <span className="text-sm font-medium text-amber-200/70 tracking-[0.2em] uppercase">{monsterMode ? '法术列表' : theme.title}</span>
                    : <Dialog.Title className="text-sm font-medium text-amber-200/70 tracking-[0.2em] uppercase">{monsterMode ? '法术列表' : theme.title}</Dialog.Title>}
                  {monsterMode && mode === 'use' && (
                    <>
                      <span className="text-[10px] text-amber-600/35 tabular-nums">已选 {preparedCount} 个</span>
                      <button className="px-2.5 py-1 text-[10px] rounded transition-all bg-amber-700/30 border border-amber-500/30 text-amber-200/80 hover:bg-amber-600/35 hover:text-amber-100 hover:border-amber-400/40 shadow-[0_0_8px_rgba(180,140,50,0.1)]"
                        onClick={() => setMode("prepare")}>
                        选择法术
                      </button>
                    </>
                  )}
                  {!monsterMode && isPreparedCaster && mode === 'use' && (
                    <>
                      <span className="text-[10px] text-amber-600/35 tabular-nums">已准备 {preparedCount}/{preparedMax}</span>
                      <button className={`px-2.5 py-1 text-[10px] rounded transition-all ${
                        canPrepareSpells ? 'bg-amber-700/30 border border-amber-500/30 text-amber-200/80 hover:bg-amber-600/35 hover:text-amber-100 hover:border-amber-400/40 shadow-[0_0_8px_rgba(180,140,50,0.1)]' : 'border border-amber-900/10 text-amber-700/25 cursor-not-allowed'}`}
                        disabled={!canPrepareSpells} onClick={() => canPrepareSpells && setMode("prepare")}>
                        准备法术{!canPrepareSpells && '(需长休)'}
                      </button>
                    </>
                  )}
                  {isDM && onDMAddSpell && mode === 'use' && (
                    <button className="px-2.5 py-1 text-[10px] rounded transition-all bg-emerald-700/30 border border-emerald-500/30 text-emerald-200/80 hover:bg-emerald-600/35 hover:text-emerald-100 hover:border-emerald-400/40"
                      onClick={() => { setMode("dmAdd"); setDmAddPending([]); }}>
                      添加法术
                    </button>
                  )}
                </div>
                {!embedded && (
                <Dialog.Close className="relative z-40 w-9 h-9 flex items-center justify-center rounded-lg text-amber-500/50 hover:text-amber-200 hover:bg-amber-900/40 transition-colors flex-shrink-0 cursor-pointer">
                  <svg viewBox="0 0 16 16" className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4L12 12M12 4L4 12" /></svg>
                </Dialog.Close>
                )}
              </div>
              {!monsterMode && (
              <div className="flex items-center gap-1.5 mt-1.5 text-[11px]">
                <SpellAttributeTooltip attributeKey="spellcastingAbility">
                  <span className="px-2 py-0.5 rounded bg-amber-900/15 border border-amber-800/15 text-amber-300/60 cursor-help">
                    {spellcastingAbilityLabel}{spellcastingAbilityMod != null && ` (${modStr})`} <span className="text-amber-500/25 text-[8px]">ⓘ</span>
                  </span>
                </SpellAttributeTooltip>
                {spellSaveDC != null && (
                  <SpellAttributeTooltip attributeKey="spellSaveDC" extra={profBonus != null && modStr != null ? (
                    <div className="text-xs text-amber-300/80 font-mono">
                      DC {spellSaveDC} = 8(基础) + {profBonus}(熟练) + {modStr}({spellcastingAbilityLabel})
                    </div>
                  ) : undefined}>
                    <span className="px-2 py-0.5 rounded bg-amber-900/15 border border-amber-800/15 text-amber-300/60 cursor-help">DC {spellSaveDC} <span className="text-amber-500/25 text-[8px]">ⓘ</span></span>
                  </SpellAttributeTooltip>
                )}
                {spellAttackStr && (
                  <SpellAttributeTooltip attributeKey="spellAttackBonus" extra={profBonus != null && modStr != null ? (
                    <div className="text-xs text-amber-300/80 font-mono">
                      {spellAttackStr} = {profBonus}(熟练) + {modStr}({spellcastingAbilityLabel})
                    </div>
                  ) : undefined}>
                    <span className="px-2 py-0.5 rounded bg-amber-900/15 border border-amber-800/15 text-amber-300/60 cursor-help">{spellAttackStr} <span className="text-amber-500/25 text-[8px]">ⓘ</span></span>
                  </SpellAttributeTooltip>
                )}
              </div>
              )}
            </div>

            {/* ── Concentration banner ── */}
            {concentratingSpellName && (
              <div className="px-4 sm:px-6 py-1.5 border-b border-purple-700/20 bg-purple-900/15">
                <div className="flex items-center gap-1.5 text-[11px] text-purple-300/80">
                  <span className="w-2 h-2 rounded-full bg-purple-400/60 animate-pulse flex-shrink-0" />
                  <span>正在专注：<span className="font-medium text-purple-200/90">{concentratingSpellName}</span></span>
                </div>
              </div>
            )}

            {/* ── Prepare banner ── */}
            {mode === 'prepare' && (
              <div className="flex items-center justify-between px-6 py-2 bg-amber-900/12 border-b border-amber-800/15">
                <span className="text-[11px] text-amber-400/50">{monsterMode ? '从全部法术中选择' : '选择要准备的法术'}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-amber-300/60 tabular-nums">{monsterMode ? `已选 ${pendingCount} 个` : `${pendingCount} / ${preparedMax}`}</span>
                  <button className="px-2.5 py-1 text-[10px] rounded border border-amber-700/20 text-amber-400/40 hover:bg-amber-900/15 transition-colors"
                    onClick={() => { setPendingPrepared([...preparedLocal]); setMode("use"); }}>取消</button>
                  <button className="px-2.5 py-1 text-[10px] rounded bg-amber-700/35 border border-amber-600/25 text-amber-100 hover:bg-amber-600/35 transition-colors"
                    onClick={confirmPreparation}>确认{monsterMode ? '选择' : '准备'}</button>
                </div>
              </div>
            )}

            {/* ── DM Add Spell banner ── */}
            {mode === 'dmAdd' && onDMAddSpell && (
              <div className="flex items-center justify-between px-6 py-2 bg-emerald-900/12 border-b border-emerald-800/20">
                <span className="text-[11px] text-emerald-400/60">从全部法术中选择添加</span>
                <div className="flex items-center gap-2">
                  {dmAddPending.length > 0 && <span className="text-[11px] text-emerald-300/60 tabular-nums">已选 {dmAddPending.length} 个</span>}
                  <button className="px-2.5 py-1 text-[10px] rounded border border-amber-700/20 text-amber-400/50 hover:bg-amber-900/15 transition-colors"
                    onClick={() => { setDmAddPending([]); setMode("use"); }}>取消</button>
                  <button className={`px-2.5 py-1 text-[10px] rounded border transition-colors ${
                    dmAddPending.length > 0
                      ? 'bg-emerald-700/35 border-emerald-600/25 text-emerald-100 hover:bg-emerald-600/35'
                      : 'border-amber-700/15 text-amber-500/25 cursor-not-allowed'}`}
                    disabled={dmAddPending.length === 0}
                    onClick={async () => {
                      await onDMAddSpell(dmAddPending);
                      setDmAddPending([]);
                      setMode("use");
                    }}>
                    确认添加
                  </button>
                </div>
              </div>
            )}

            {/* ── Pages (fixed height) ── */}
            {<div className={`relative overflow-hidden ${embedded ? 'flex-1 min-h-0' : ''}`} style={{ perspective: '2000px' }}
              onTouchStart={e => { touchRef.current = { x: e.touches[0].clientX, t: Date.now() }; }}
              onTouchEnd={e => {
                if (!touchRef.current) return;
                const dx = e.changedTouches[0].clientX - touchRef.current.x;
                const dt = Date.now() - touchRef.current.t;
                touchRef.current = null;
                if (Math.abs(dx) > 50 && dt < 400) {
                  if (dx < 0) goToPage(pageIdx + 1);
                  else goToPage(pageIdx - 1);
                }
              }}>
              {isFlipping && (
                <div className="absolute top-0 z-20 pointer-events-none"
                  style={{
                    [flipDir === 'fwd' ? 'right' : 'left']: 0,
                    width: 'calc(50% - 4px)', height: '100%',
                    transformOrigin: flipDir === 'fwd' ? 'left center' : 'right center',
                    transformStyle: 'preserve-3d',
                    animation: `${flipDir === 'fwd' ? 'sbFlipFwd' : 'sbFlipBwd'} 0.6s ease-in-out forwards`,
                  }}>
                  <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', ...PAGE_L, boxShadow: '-6px 0 25px rgba(0,0,0,0.7)' }} />
                  <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', ...PAGE_R, boxShadow: '6px 0 25px rgba(0,0,0,0.7)' }} />
                </div>
              )}

              <div className="flex min-h-0" style={{ height: embedded ? '100%' : '65vh' }}>
                {/* ── Left Page ── */}
                <div key={`L${contentKey}`} className="flex-1 flex flex-col p-6 min-h-0 spellbook-page-texture spellbook-page-enter" style={PAGE_L}>
                  {/* Level heading with ornamental divider */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex-1 h-px bg-gradient-to-r from-amber-600/30 to-transparent" />
                    <div className="flex items-center gap-2.5">
                      <svg viewBox="0 0 10 10" className="w-1.5 h-1.5 text-amber-500/40"><path d="M5 0L10 5L5 10L0 5Z" fill="currentColor" /></svg>
                      <span className="text-sm font-medium text-amber-300/70 tracking-[0.15em]">{pactSlot && currentLevel > 0 ? `${currentLevel}环 契约` : levelLabel(currentLevel)}</span>
                      <svg viewBox="0 0 10 10" className="w-1.5 h-1.5 text-amber-500/40"><path d="M5 0L10 5L5 10L0 5Z" fill="currentColor" /></svg>
                    </div>
                    <div className="flex-1 h-px bg-gradient-to-l from-amber-600/30 to-transparent" />
                  </div>
                  {(() => {
                    const si = getSlotInfo(currentLevel);
                    return currentLevel > 0 && si.max > 0 && (
                    <div className="flex items-center justify-center gap-2.5 mb-3">
                      <SlotGemRow current={si.cur} max={si.max} />
                      <span className="text-[9px] text-amber-500/35 tabular-nums">
                        {si.cur}/{si.max} {si.slotLv !== currentLevel ? `${si.slotLv}环` : ''}{slotLabel}
                      </span>
                      {monsterMode && onUpdateSpellSlots && !editingSlots && (
                        <button className="text-amber-500/40 hover:text-amber-300 transition-colors" title="编辑法术位"
                          onClick={() => { setEditingSlots(true); setEditSlotValues([...spellSlots]); }}>
                          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" /></svg>
                        </button>
                      )}
                    </div>
                  );
                  })()}
                  {/* Monster mode: inline slot editor */}
                  {monsterMode && editingSlots && (
                    <div className="mb-3 p-2 rounded bg-amber-900/15 border border-amber-700/20">
                      <div className="text-[10px] text-amber-400/60 mb-1.5">编辑法术位上限（每环）</div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[1,2,3,4,5,6,7,8,9].map(lv => (
                          <div key={lv} className="flex items-center gap-1">
                            <span className="text-[9px] text-amber-500/40 w-5">{lv}环</span>
                            <input type="number" min={0} max={20}
                              className="w-10 px-1 py-0.5 text-[10px] text-amber-200 bg-black/30 border border-amber-700/25 rounded text-center"
                              value={editSlotValues[lv] ?? 0}
                              onChange={e => {
                                const v = Math.max(0, Math.min(20, parseInt(e.target.value) || 0));
                                setEditSlotValues(prev => { const n = [...prev]; while(n.length < 10) n.push(0); n[lv] = v; return n; });
                              }} />
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-end gap-1.5 mt-2">
                        <button className="px-2 py-0.5 text-[10px] rounded border border-amber-700/20 text-amber-400/50 hover:bg-amber-900/15"
                          onClick={() => setEditingSlots(false)}>取消</button>
                        <button className="px-2 py-0.5 text-[10px] rounded bg-amber-700/35 border border-amber-600/25 text-amber-100 hover:bg-amber-600/35"
                          onClick={() => { onUpdateSpellSlots!(editSlotValues); setEditingSlots(false); }}>保存</button>
                      </div>
                    </div>
                  )}

                  <div className="flex-1 overflow-y-auto space-y-0.5 spellbook-scroll pr-1">
                    {pageSpells.map(sp => {
                      const isActive = selectedSpell?.id === sp.id;
                      const isPrep = mode === 'prepare';
                      const isDmAdd = mode === 'dmAdd';
                      const isAuto = autoPrepared.includes(sp.id);
                      const isChecked = isPrep ? pendingPrepared.includes(sp.id) : isDmAdd ? dmAddPending.includes(sp.id) : false;
                      const isConcentrating = concentratingSpellId === sp.id;
                      return (
                        <div key={sp.id} onClick={() => setSelectedSpell(sp)}
                          className={`group flex items-center gap-2 px-3 py-2.5 rounded-md cursor-pointer border transition-all duration-200 ${
                            isConcentrating
                              ? 'bg-purple-900/20 border-purple-500/30 shadow-[0_0_12px_rgba(168,85,247,0.08)]'
                              : isActive
                              ? 'bg-amber-800/18 border-amber-600/25 shadow-[0_0_12px_rgba(180,140,50,0.06)]'
                              : 'border-transparent hover:bg-amber-900/12 hover:border-amber-800/10'}`}>
                          {isPrep && (currentLevel > 0 || monsterMode) && <input type="checkbox" className="accent-amber-500 w-3.5 h-3.5 flex-shrink-0"
                            checked={isChecked} disabled={isAuto} onChange={() => togglePending(sp.id)} onClick={e => e.stopPropagation()} />}
                          {isDmAdd && <input type="checkbox" className="accent-emerald-500 w-3.5 h-3.5 flex-shrink-0"
                            checked={isChecked} onChange={() => setDmAddPending(prev => prev.includes(sp.id) ? prev.filter(x => x !== sp.id) : [...prev, sp.id])} onClick={e => e.stopPropagation()} />}
                          {(sp as any).iconPath ? (
                            <img src={getAssetUrl((sp as any).iconPath.replace(/^\//, ''))} alt=""
                              className="w-8 h-8 rounded-sm object-cover flex-shrink-0"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          ) : (
                            <span className="text-sm flex-shrink-0 w-6 text-center">{SCHOOL_ICON[sp.school ?? ''] || '✨'}</span>
                          )}
                          <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${SCHOOL_ACCENTS[sp.school ?? ''] || 'bg-gray-500/30'}`} />
                          <div className="flex-1 min-w-0">
                            <span className={`text-[13px] truncate block group-hover:text-amber-100/90 transition-colors ${isConcentrating ? 'text-purple-200/90' : 'text-amber-100/75'}`}>{sp.name}</span>
                            {sp.school && <span className="text-[9px] text-amber-600/30">{SCHOOL_CN[sp.school]}</span>}
                          </div>
                          {isConcentrating && <span className="text-[8px] text-purple-300/70 border border-purple-500/30 rounded px-1 py-0.5 bg-purple-900/20 flex-shrink-0">专注中</span>}
                          {isAuto && <span className="text-[8px] text-amber-500/35 border border-amber-700/15 rounded px-1 py-0.5">自动</span>}
                          {sp.id === 'eldritch_blast' && eldritchInvocations.some(inv =>
                            ['agonizing_blast', 'repelling_blast', 'eldritch_spear'].includes(inv)
                          ) && <span className="text-[8px] text-purple-300/50 border border-purple-700/20 rounded px-1 py-0.5">祈唤强化</span>}
                          {!isPrep && spellSources[sp.id] && <SourceBadge source={spellSources[sp.id]} />}
                          {!isPrep && racialSpellMeta[sp.id]?.usesPerDay && (
                            <span className="text-[8px] text-violet-300/50 border border-violet-700/20 rounded px-1 py-0.5">每日{racialSpellMeta[sp.id].usesPerDay}次</span>
                          )}
                          {!isPrep && racialSpellMeta[sp.id]?.spellcastingAbility && racialSpellMeta[sp.id].spellcastingAbility !== spellcastingAbilityId && (
                            <span className="text-[8px] text-cyan-300/50 border border-cyan-700/20 rounded px-1 py-0.5" title={`种族法术施法属性：${ABILITY_CN[racialSpellMeta[sp.id].spellcastingAbility!] || racialSpellMeta[sp.id].spellcastingAbility}`}>
                              {ABILITY_CN[racialSpellMeta[sp.id].spellcastingAbility!] || racialSpellMeta[sp.id].spellcastingAbility}施法
                            </span>
                          )}
                          {!isPrep && invocationSpellMeta[sp.id] && (
                            <span className="text-[8px] text-teal-300/50 border border-teal-700/20 rounded px-1 py-0.5">
                              {invocationSpellMeta[sp.id].atWill ? '随意' : `1/长休`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {pageSpells.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-16 text-amber-700/20">
                        <svg viewBox="0 0 24 24" className="w-8 h-8 mb-2" fill="none" stroke="currentColor" strokeWidth="1"><path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25v14.25" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <span className="text-xs italic">此页尚无法术记录</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Spine ── */}
                <div className="w-2 flex-shrink-0 relative">
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #12100a, #181410, #12100a)' }} />
                  <div className="absolute inset-y-0 left-0 w-px bg-amber-700/10" />
                  <div className="absolute inset-y-0 right-0 w-px bg-amber-700/10" />
                  <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-amber-800/15" />
                </div>

                {/* ── Right Page ── */}
                <div key={`R${contentKey}`} className="flex-1 flex flex-col p-6 spellbook-page-texture spellbook-page-enter" style={PAGE_R}>
                  {selectedSpell ? (() => {
                    const modifiedSpell = applyCharacterSpellModifiers(normalizeSpellData(selectedSpell), spellModCtx) as any;
                    const slotCost: number = modifiedSpell._slotCost ?? 1;
                    // 升环相关：使用 selectedCastLevel 代替 detailSlotLv
                    const castLv = selectedCastLevel;
                    const castSlotInfo = getSlotInfo(castLv);
                    return (<>
                    <div className="flex-1 overflow-y-auto spellbook-scroll pr-1 min-h-0">
                      <SpellCard spell={modifiedSpell} variant="full" theme="spellbook" showTargeting />

                      {/* 幻象图像区域 — 伪装/幻术法术 */}
                      {needsIllusionInput(modifiedSpell) && mode === 'use' && (
                        <SpellbookIllusionSection
                          mode={illusionMode}
                          onModeChange={setIllusionMode}
                          description={illusionDesc}
                          onDescriptionChange={setIllusionDesc}
                          imageUrl={illusionUrl}
                          onImageChange={setIllusionUrl}
                          isGenerating={illusionGenerating}
                          onGenerate={handleGenerateIllusion}
                          libraryImages={illusionLibrary}
                          required={isDisguiseSpell(modifiedSpell)}
                        />
                      )}
                    </div>

                    {/* 升环选择器 — 非邪术师、非戏法、非随意施法 */}
                    {!pactSlot && detailLv > 0 && slotCost > 0 && (
                      <UpcastLevelSelector
                        spellLevel={detailLv}
                        spellSlots={spellSlots}
                        remainingSlots={remainingSlots}
                        selectedLevel={selectedCastLevel}
                        onSelectLevel={setSelectedCastLevel}
                        damageAtSlotLevel={modifiedSpell.damageAtSlotLevel}
                        healingAtSlotLevel={modifiedSpell.healingAtSlotLevel}
                        damageTypeCn={modifiedSpell.damageTypeCn}
                        atHigherLevels={modifiedSpell.atHigherLevels}
                        description={modifiedSpell.description}
                        theme="spellbook"
                      />
                    )}

                    {/* 施法条件提示 */}
                    <SpellConditionHints
                      spell={modifiedSpell}
                      equipment={equipment}
                      isSilenced={isSilenced}
                      hasSomaticFreedom={hasSomaticFreedom}
                      componentsReady={componentsReady}
                    />

                    {/* Cast button - fixed at bottom, outside scroll */}
                    {mode === 'use' && (() => {
                      // Attach illusion data to spell for downstream casting
                      const castSpell = (sp: Spell, lv: number, freecast?: boolean) => {
                        const illusionData = (illusionUrl && needsIllusionInput(sp as any))
                          ? { imageUrl: illusionUrl, description: illusionDesc, displayName: illusionDisplayName || undefined }
                          : undefined;
                        const castData: SpellCastData = {
                          spell: sp as any,
                          level: lv,
                          illusionData,
                          areaSize: (canChooseArea && selectedAreaSize > 0) ? selectedAreaSize : undefined,
                          freecast,
                          // Misty Step / self-teleport: parent castSpellAction
                          // must see this so it routes to the destination
                          // picker instead of the default self-buff path.
                          // See Chrome QA revision 2026-05-28.
                          targetingMode: checkNeedsTeleportDestination(sp as any)
                            ? 'teleport_destination'
                            : undefined,
                        };
                        if (onCastSpell) onCastSpell(castData);
                        else onConsumeSlot(lv);
                      };
                      const targeting = selectedSpell ? analyzeSpellTargeting(selectedSpell) : null;
                      const castVerb = !targeting ? '施放'
                        : targeting.targetLabel === '自身增益' ? '施放'
                        : isSelfCenteredAreaSpell(selectedSpell) ? '施放'
                        : targeting.areaDetail ? '选择范围并施放'
                        : '选择目标并施放';

                      // 材料槽位逻辑
                      const hasM = hasMaterialComponent(modifiedSpell);
                      const availMats = componentsReady && equipment ? getAvailableMaterials(modifiedSpell, equipment) : [];
                      const matMissing = hasM && componentsReady && equipment != null && availMats.length === 0;
                      // auto-select if only one
                      const effectiveMat = selectedMaterial
                        ?? (hasM && availMats.length === 1 ? availMats[0].id : null);
                      const selMatItem = effectiveMat
                        ? availMats.find(e => e.id === effectiveMat) ?? null : null;

                      const renderMaterialSlot = () => {
                        if (!hasM || !equipment) return null;
                        return (
                          <SpellbookMaterialSlot
                            ref={materialSlotRef}
                            selectedItem={selMatItem}
                            materialMissing={matMissing}
                            isConsumed={!!modifiedSpell.materialConsumed}
                            isOpen={showMaterialPanel}
                            availableMaterials={availMats}
                            selectedMaterial={effectiveMat}
                            onTogglePanel={() => !matMissing && setShowMaterialPanel(v => !v)}
                            onSelectMaterial={(id) => { setSelectedMaterial(id); setShowMaterialPanel(false); }}
                          />
                        );
                      };

                      const aoe = modifiedSpell.areaOfEffect;
                      const canChooseArea = !!(aoe && aoe.sizeIsMax && aoe.size > 5);
                      // Disguise spells require illusion image
                      const disguiseNoImage = isDisguiseSpell(modifiedSpell) && needsIllusionInput(modifiedSpell) && !illusionUrl;
                      const areaSizeSelector = canChooseArea ? (
                        <AreaSizeSelector
                          maxSize={aoe!.size}
                          areaType={aoe!.type}
                          selectedSize={selectedAreaSize || aoe!.size}
                          onChange={setSelectedAreaSize}
                        />
                      ) : null;

                      // slotCost === 0 → at-will invocation spell, free cast
                      if (slotCost === 0 && detailLv > 0) return (
                        <>
                        {areaSizeSelector}
                        <div className="flex-shrink-0 pt-1.5 flex items-stretch gap-2">
                          {renderMaterialSlot()}
                          <button className="flex-1 py-2.5 rounded-md text-xs font-medium transition-all
                            bg-gradient-to-r from-teal-900/25 via-teal-800/30 to-teal-900/25
                            border border-teal-600/25 text-teal-200/70
                            hover:from-teal-800/30 hover:via-teal-700/35 hover:to-teal-800/30
                            hover:border-teal-500/35 hover:text-teal-100/90 hover:shadow-[0_0_15px_rgba(80,200,180,0.08)]
                            disabled:opacity-20 disabled:cursor-not-allowed"
                            disabled={disguiseNoImage}
                            onClick={() => castSpell(selectedSpell!, detailLv, true)}>
                            {disguiseNoImage ? '🎭 请先选择幻象图像' : `${castVerb} · 随意施放（无限次）`}
                          </button>
                        </div>
                        </>
                      );

                      // Normal leveled spell — consumes spell slot (升环时使用 selectedCastLevel)
                      if (detailLv > 0 && detailSlotMax > 0) {
                        const useLv = pactSlot ? detailSlotLv : castLv;
                        const useMax = pactSlot ? detailSlotMax : castSlotInfo.max;
                        const useCur = pactSlot ? detailSlotCur : castSlotInfo.cur;
                        return (
                        <>
                        {areaSizeSelector}
                        <div className="flex-shrink-0 pt-1.5 flex items-stretch gap-2">
                          {renderMaterialSlot()}
                          <button className="flex-1 py-2.5 rounded-md text-xs font-medium transition-all
                            bg-gradient-to-r from-amber-800/18 via-amber-700/22 to-amber-800/18
                            border border-amber-600/20 text-amber-200/65
                            hover:from-amber-700/22 hover:via-amber-600/28 hover:to-amber-700/22
                            hover:border-amber-500/30 hover:text-amber-100/85 hover:shadow-[0_0_15px_rgba(180,140,50,0.08)]
                            disabled:opacity-20 disabled:cursor-not-allowed"
                            disabled={useCur <= 0 || disguiseNoImage} onClick={() => {
                              castSpell(selectedSpell!, useLv);
                            }}>
                            {disguiseNoImage ? '🎭 请先选择幻象图像' : `${castVerb} · 消耗${useLv !== detailLv ? `${useLv}环` : ''}${slotLabel} (${useCur}/${useMax})`}
                          </button>
                        </div>
                        </>
                        );
                      }

                      // Cantrip — unlimited
                      if (detailLv === 0) return (
                        <>
                        {areaSizeSelector}
                        <div className="flex-shrink-0 pt-1.5 flex items-stretch gap-2">
                          {renderMaterialSlot()}
                          <button className="flex-1 py-2.5 rounded-md text-xs font-medium transition-all
                            bg-gradient-to-r from-amber-800/18 via-amber-700/22 to-amber-800/18
                            border border-amber-600/20 text-amber-200/65
                            hover:from-amber-700/22 hover:via-amber-600/28 hover:to-amber-700/22
                            hover:border-amber-500/30 hover:text-amber-100/85 hover:shadow-[0_0_15px_rgba(180,140,50,0.08)]"
                            onClick={() => castSpell(selectedSpell!, 0)}>
                            施放戏法（无限次）
                          </button>
                        </div>
                        </>
                      );

                      return null;
                    })()}
                  </>);
                  })() : (
                    /* Empty state - arcane circle decoration */
                    <div className="flex-1 flex flex-col items-center justify-center select-none">
                      <svg viewBox="0 0 120 120" className="w-32 h-32 text-amber-700/10" fill="none" stroke="currentColor" strokeLinecap="round">
                        <circle cx="60" cy="60" r="50" strokeWidth="0.5" />
                        <circle cx="60" cy="60" r="38" strokeWidth="0.4" strokeDasharray="4 3" />
                        <circle cx="60" cy="60" r="26" strokeWidth="0.3" />
                        <circle cx="60" cy="60" r="8" strokeWidth="0.6" />
                        <path d="M60 10V110M10 60H110" strokeWidth="0.25" />
                        <path d="M24.5 24.5L95.5 95.5M95.5 24.5L24.5 95.5" strokeWidth="0.2" />
                        {/* Rune marks */}
                        <circle cx="60" cy="10" r="2" strokeWidth="0.4" />
                        <circle cx="60" cy="110" r="2" strokeWidth="0.4" />
                        <circle cx="10" cy="60" r="2" strokeWidth="0.4" />
                        <circle cx="110" cy="60" r="2" strokeWidth="0.4" />
                        {/* Inner runes */}
                        <path d="M48 35L60 22L72 35" strokeWidth="0.4" />
                        <path d="M48 85L60 98L72 85" strokeWidth="0.4" />
                        <path d="M35 48L22 60L35 72" strokeWidth="0.4" />
                        <path d="M85 48L98 60L85 72" strokeWidth="0.4" />
                      </svg>
                      <p className="mt-3 text-[11px] text-amber-700/18 italic tracking-wider">选择左页法术以查阅详情</p>
                    </div>
                  )}
                </div>
              </div>
            </div>}

            {/* ── Level Navigation ── */}
            <div className="flex items-center justify-center gap-1.5 px-5 py-3 border-t border-amber-800/20 bg-gradient-to-r from-transparent via-amber-900/5 to-transparent flex-shrink-0">
              <button className="w-7 h-7 flex items-center justify-center rounded text-amber-600/30 hover:text-amber-300 hover:bg-amber-900/15 disabled:opacity-15 disabled:cursor-not-allowed transition-all"
                disabled={pageIdx <= 0 || isFlipping} onClick={() => goToPage(pageIdx - 1)}>
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 3L5 8L10 13" /></svg>
              </button>
              {availableLevels.map((lv, idx) => (
                <button key={lv} disabled={isFlipping}
                  className={`px-3.5 py-1.5 text-[11px] rounded-md transition-all duration-250 ${
                    idx === pageIdx
                      ? 'text-amber-200/85 bg-amber-800/18 border border-amber-600/20 shadow-[0_0_12px_rgba(180,140,50,0.1)]'
                      : 'text-amber-600/35 border border-transparent hover:text-amber-300/65 hover:bg-amber-900/8'}`}
                  onClick={() => goToPage(idx)}>
                  {levelLabel(lv)}
                </button>
              ))}
              <button className="w-7 h-7 flex items-center justify-center rounded text-amber-600/30 hover:text-amber-300 hover:bg-amber-900/15 disabled:opacity-15 disabled:cursor-not-allowed transition-all"
                disabled={pageIdx >= availableLevels.length - 1 || isFlipping} onClick={() => goToPage(pageIdx + 1)}>
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3L11 8L6 13" /></svg>
              </button>
            </div>
          </div>
  );

  if (embedded) return <>{spellbookContent}</>;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/80 z-[10198] backdrop-blur-sm" />
        <Dialog.Content aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10200] w-[95vw] max-w-[1100px] outline-none">
          {spellbookContent}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 法术书施法条件提示：材料、沉默、双手占用 */
function SpellConditionHints({ spell, equipment, isSilenced, hasSomaticFreedom, componentsReady }: {
  spell: any;
  equipment?: EquipmentItem[];
  isSilenced?: boolean;
  hasSomaticFreedom?: boolean;
  componentsReady: boolean;
}) {
  const comps: string[] = spell.components || [];
  const hasV = comps.includes('V');
  const hasS = comps.includes('S');
  const hasM = hasMaterialComponent(spell);
  const materialsText = spell.materials || '';

  const availableMats = React.useMemo(
    () => componentsReady && equipment ? getAvailableMaterials(spell, equipment) : [],
    [componentsReady, spell, equipment],
  );
  const materialMissing = hasM && componentsReady && equipment && availableMats.length === 0;
  const hasPouch = availableMats.some(e => e.id === 'component_pouch');

  const silencedBlock = hasV && !!isSilenced;
  // 判断物品是否实际占用双手（仅 gripMode=two-hand 且非 versatile 武器算双手占用）
  // versatile 武器可以随时单手持握，施法时腾出一只手
  // 纯 two-handed 武器（如长弓）按 5E 规则只在攻击时需要双手，施法时可单手持握
  const isTwoHanded = (item: EquipmentItem | null) => {
    if (!item) return false;
    if ((item as any).gripMode === 'two-hand') {
      // versatile 武器即使选择双手握持，施法时也可以切换为单手
      const props: string[] = (item as any)?.properties || [];
      if (props.includes('versatile')) return false;
      return true;
    }
    return false;
  };
  const noFreeHand = hasS && !hasSomaticFreedom && equipment != null && (() => {
    const mainHand = equipment.find(e => e.equippedSlot === 'main_hand') ?? null;
    const offHand = equipment.find(e => e.equippedSlot === 'off_hand') ?? null;
    if (isTwoHanded(mainHand)) return true;
    if (mainHand && offHand) return true;
    return false;
  })();

  const hints: React.ReactNode[] = [];

  // 沉默警告
  if (silencedBlock) {
    hints.push(
      <div key="silence" className="flex items-center gap-1.5 text-[11px] text-red-300/80">
        <span>🤐</span>
        <span>沉默状态，无法使用言语成分（V）</span>
      </div>
    );
  }

  // 双手占用警告
  if (noFreeHand) {
    hints.push(
      <div key="hand" className="flex items-center gap-1.5 text-[11px] text-red-300/80">
        <span>🤚</span>
        <span>双手被占用，无法施展姿势成分（S）</span>
      </div>
    );
  }

  // 材料提示
  if (hasM && materialsText) {
    const isGp = needsMaterialCheck(spell);
    hints.push(
      <div key="material" className="flex items-start gap-1.5 text-[11px] text-amber-300/70">
        <span className="flex-shrink-0 mt-0.5">💎</span>
        <span>
          材料：{materialsText}
          {componentsReady && equipment && !materialMissing && availableMats.length > 0 && (
            <span className="ml-1.5 text-emerald-400/80">
              ✓ {hasPouch ? '材料包可替代' : '已持有'}
            </span>
          )}
          {materialMissing && (
            <span className="ml-1.5 text-red-400/80">
              ⚠ {isGp ? `缺少材料（${spell.materialCost}gp）` : '缺少材料包或对应材料'}
            </span>
          )}
        </span>
      </div>
    );
  }

  if (hints.length === 0) return null;

  return (
    <div className="flex-shrink-0 pt-1.5 space-y-1">
      {hints}
    </div>
  );
}

/** 法术书施法按钮旁的材料槽位 */
const SpellbookMaterialSlot = React.forwardRef<HTMLDivElement, {
  selectedItem: EquipmentItem | null;
  materialMissing: boolean;
  isConsumed: boolean;
  isOpen: boolean;
  availableMaterials: EquipmentItem[];
  selectedMaterial: string | null;
  onTogglePanel: () => void;
  onSelectMaterial: (id: string | null) => void;
}>(({ selectedItem, materialMissing, isConsumed, isOpen, availableMaterials, selectedMaterial, onTogglePanel, onSelectMaterial }, ref) => {
  const isEmpty = !selectedItem;
  const isPouch = selectedItem?.id === 'component_pouch';
  const icon = selectedItem ? getIconPath(selectedItem) : null;

  const slotContent = materialMissing ? (
    <div className="w-10 h-10 rounded-md border border-dashed border-red-500/40
      bg-red-900/15 flex flex-col items-center justify-center cursor-not-allowed"
      title="缺少材料">
      <span className="text-[9px] text-red-400/50">M</span>
      <span className="text-[7px] text-red-400/60 leading-none">缺少</span>
    </div>
  ) : isEmpty ? (
    <button onClick={onTogglePanel}
      className={`w-10 h-10 rounded-md border border-dashed transition-all flex flex-col items-center justify-center
        ${isOpen ? 'border-amber-400/50 bg-amber-900/25' : 'border-amber-600/30 bg-amber-900/10 hover:border-amber-500/40'}`}
      title="选择材料">
      <span className="text-[9px] text-amber-400/40 font-medium">M</span>
      <span className="text-[7px] text-amber-400/50 leading-none">放入</span>
    </button>
  ) : (
    <button onClick={onTogglePanel}
      className={`w-10 h-10 rounded-md border transition-all relative flex flex-col items-center justify-center overflow-hidden
        ${isOpen ? 'border-amber-400/50 bg-amber-800/30' : 'border-amber-600/40 bg-amber-900/20 hover:border-amber-500/40'}`}
      title={selectedItem.name}>
      {icon ? (
        <img src={icon} alt="" className="w-6 h-6 rounded object-cover"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
      ) : (
        <span className="text-[9px] text-amber-300/60 font-medium leading-tight text-center px-0.5 truncate max-w-full">
          {isPouch ? '材料包' : (selectedItem.name || '').slice(0, 3)}
        </span>
      )}
      <span className="text-[6px] text-amber-300/50 leading-none mt-0.5 px-0.5 truncate max-w-full">
        {isPouch ? '材料包' : (selectedItem.name || '').slice(0, 3)}
      </span>
      {isConsumed && !isPouch && (
        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500/80" />
      )}
    </button>
  );

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {slotContent}
      {isOpen && availableMaterials.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 w-48 max-h-40 overflow-y-auto
          rounded-lg border border-amber-600/30 bg-[#1a1510] shadow-xl z-50">
          <div className="p-1 space-y-0.5">
            {availableMaterials.map(item => {
              const isSel = selectedMaterial === item.id;
              const itemIcon = getIconPath(item);
              return (
                <button key={item.id}
                  onClick={() => onSelectMaterial(isSel ? null : item.id)}
                  className={`w-full text-left px-2 py-1.5 rounded text-[11px] transition-all
                    flex items-center justify-between gap-1.5
                    ${isSel
                      ? 'bg-amber-700/30 border border-amber-500/40 text-amber-200'
                      : 'border border-transparent text-gray-300 hover:bg-amber-900/25 hover:text-amber-200'
                    }`}>
                  <span className="flex items-center gap-1.5 min-w-0">
                    {itemIcon ? (
                      <img src={itemIcon} alt="" className="w-4 h-4 rounded object-cover flex-shrink-0"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                    ) : <span className="w-4 text-center opacity-40">?</span>}
                    <span className="truncate">{item.name}</span>
                  </span>
                  <span className="text-[9px] text-gray-500 flex-shrink-0">x{item.quantity ?? 1}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

/** 法术书内的幻象图像区域（紧凑版） */
function SpellbookIllusionSection({
  mode, onModeChange, description, onDescriptionChange,
  imageUrl, onImageChange, isGenerating, onGenerate, libraryImages, required,
}: {
  mode: 'generate' | 'library';
  onModeChange: (m: 'generate' | 'library') => void;
  description: string;
  onDescriptionChange: (d: string) => void;
  imageUrl: string | null;
  onImageChange: (url: string | null) => void;
  isGenerating: boolean;
  onGenerate: () => void;
  libraryImages: { id: string | number; url: string; name: string }[];
  required?: boolean;
}) {
  return (
    <div className={`mt-2 rounded-md border overflow-hidden ${
      required && !imageUrl ? 'border-amber-500/40 bg-amber-900/8' : 'border-purple-600/20 bg-purple-900/8'
    }`}>
      <div className="flex items-center justify-between px-2.5 py-1 border-b border-purple-700/15">
        <span className={`text-[10px] ${required ? 'text-amber-300/90 font-medium' : 'text-purple-300/70'}`}>
          🌀 幻象图像（{required ? '必选' : '可选'}）
        </span>
        <div className="flex gap-1">
          {(['generate', 'library'] as const).map(m => (
            <button key={m} onClick={() => onModeChange(m)}
              className={`px-1.5 py-0.5 rounded text-[9px] transition-all ${
                mode === m ? 'bg-purple-700/25 text-purple-200 border border-purple-500/25'
                  : 'text-purple-400/40 hover:text-purple-300/60'}`}>
              {m === 'generate' ? 'AI生成' : '图库'}
            </button>
          ))}
        </div>
      </div>
      <div className="p-2">
        {imageUrl ? (
          <div className="flex items-center gap-2">
            <div className="w-14 h-14 flex-shrink-0 rounded overflow-hidden border border-purple-500/25
              shadow-[0_0_8px_rgba(168,85,247,0.12)]">
              <img src={imageUrl} alt="幻象" className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] text-purple-300/50 truncate">{description || '已选择'}</p>
              <button onClick={() => { onImageChange(null); onModeChange('generate'); }}
                className="mt-1 px-1.5 py-0.5 text-[9px] rounded border border-purple-700/20
                  text-purple-300/50 hover:text-purple-200/70 transition-all">
                重选
              </button>
            </div>
          </div>
        ) : mode === 'generate' ? (
          <div className="space-y-1.5">
            <textarea value={description} onChange={e => onDescriptionChange(e.target.value)}
              placeholder="描述你想创造的幻象..."
              rows={2}
              className="w-full px-2 py-1.5 rounded text-[11px] bg-black/15 border border-purple-700/15
                text-purple-100/80 placeholder-purple-400/25 resize-none
                focus:border-purple-500/30 focus:outline-none" />
            <button onClick={onGenerate} disabled={!description.trim() || isGenerating}
              className="w-full py-1 rounded text-[10px] font-medium transition-all
                bg-gradient-to-r from-purple-800/20 via-purple-700/25 to-purple-800/20
                border border-purple-600/20 text-purple-200/60
                hover:text-purple-100 hover:border-purple-500/30
                disabled:opacity-25 disabled:cursor-not-allowed">
              {isGenerating ? '生成中...' : '✨ 生成幻象'}
            </button>
          </div>
        ) : (
          <div>
            {libraryImages.length === 0 ? (
              <p className="text-[9px] text-purple-400/35 text-center py-2">暂无历史图片</p>
            ) : (
              <div className="grid grid-cols-5 gap-1 max-h-24 overflow-y-auto">
                {libraryImages.map(img => (
                  <button key={img.id} onClick={() => onImageChange(img.url)}
                    className="aspect-square rounded overflow-hidden border border-purple-700/15
                      hover:border-purple-500/35 transition-all" title={img.name}>
                    <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
