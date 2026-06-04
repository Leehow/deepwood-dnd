/**
 * FloatingTokenPanel – draggable/resizable floating window for DM to inspect tokens.
 * For character tokens: reuses BagDialog, ClassFeaturesDialog, StatusEffectsDialog in embedded mode.
 * For monster tokens: reuses BagDialog + StatusEffectsDialog (same components as characters).
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';
import type { Token, AuraVisual } from './types/TacticalMapTypes';
import type { CharacterSheet } from '~/types';
import { useFloatingZIndex } from '~/stores/floatingZIndexStore';
import { useFloatingTokenPanelStore, type TokenPanelTab, type TokenPanelConfig } from '~/stores/floatingTokenPanelStore';
import { TokenStatsTab } from './TokenStatsTab';
import { characterService } from '~/services/character.service';
import { apiFetch } from '~/utils/api-client';
import { publishAppEvent, subscribeAppEvent } from '~/events/appEventBus';
import { createLogger } from '~/utils/logger';

// Reuse existing embedded components
import { CharacterProvider } from '~/components/character/CharacterDisplay/context/CharacterContext';
import { BagDialog } from '~/components/character/CharacterDisplay/sections/Equipment/BagDialog';
import { EquipDialog } from '~/components/character/CharacterDisplay/sections/Equipment/EquipDialog';
import { ClassFeaturesDialog } from '~/components/character/CharacterDisplay/sections/ClassFeatures/ClassFeaturesDialog';
import { StatusEffectsDialog, migrateConditions, migrateCustomEffects, migrateDuration, PERMANENT_DURATION, SHORT_REST_ROUNDS, LONG_REST_ROUNDS } from '~/components/character/StatusEffectsDialog';
import type { CustomStatusEffect, ConditionWithDuration, Duration, SpecialBuffs } from '~/components/character/StatusEffectsDialog';
import type { ConditionType } from '~/types/effects';
import { advanceSpecialBuffDurations } from '~/utils/specialBuffs';
import { CurrencyDialog } from '~/components/character/CharacterDisplay/sections/Currency/CurrencyDialog';
import { useEquipment } from '~/components/character/CharacterDisplay/hooks/useEquipment';
import { useCurrency } from '~/components/character/CharacterDisplay/hooks/useCurrency';
import { useMapToken } from '~/components/character/CharacterDisplay/hooks/useMapToken';
import type { EquipmentItem, Currency } from '~/components/character/CharacterDisplay/types/Character';
import { useMonsterEquipment } from './hooks/useMonsterEquipment';
import { useMonsterStatus } from './hooks/useMonsterStatus';
import { getActionRange } from './utils/rangeUtils';
import { spellcastingAbilityMap, getAlwaysPreparedSubclassSpells, isPreparedCaster as isPreparedCasterUtil, isSpellbookCaster as isSpellbookCasterUtil, preparedMax as computePreparedMax, maxSpellLevelForClass, isSpellcaster } from '~/components/character/CharacterDisplay/utils/spellcasting';
import { SpellsDialog } from '~/components/character/CharacterDisplay/sections/Spells/SpellsDialog';
import type { Spell } from '~/components/character/CharacterDisplay/types/Spell';
import type { SpellcastingAbilityId, SpellcasterType } from '~/hooks/useCharacterSpellcasting';
import spellsData from '~/data/rules/spells.json';
import spellcastingConfig from '~/data/rules/spellcasting.json';
import racesData from '~/data/rules/races.json';
import classesData from '~/data/rules/classes_with_structured_subclass_features.json';
import backgroundsData from '~/data/rules/backgrounds.json';
import skillsData from '~/data/rules/skills.json';
import type { WorldTime } from '~/utils/timeUtils';

const logger = createLogger('FloatingTokenPanel');

const MIN_W = 350;
const MIN_H = 300;
const MAX_W = 900;
const MAX_H = 750;
const PANEL_Z_MAX = 10190;
const PANEL_Z_SINK_WHEN_MODAL = 10040;
const RESIZE_EDGE_PX = 14;
const RESIZE_CORNER_PX = 18;

const resizeHandleDot = (
  <div className="w-full h-full flex items-center justify-center pointer-events-none">
    <div className="w-4 h-4 rounded-full bg-amber-400/90 border border-black/40 shadow-[0_0_10px_rgba(245,158,11,0.35)] opacity-40 group-hover:opacity-100 transition-opacity" />
  </div>
);
const resizeHandleEmpty = <div className="w-full h-full pointer-events-none" />;

interface FloatingTokenPanelProps {
  config: TokenPanelConfig;
  token: Token;
  campaignId: string;
  currentUserId?: string;
  selectedCharacterId?: number | null;
  activeEffects?: any[];
  onRemoveEffect?: (effectId: string) => void;
  onEscapeAttempt?: (tokenId: number, effectId: string) => void;
  onOngoingSave?: (tokenId: number, effectId: string) => void;
  onConditionSave?: (tokenId: number, effectId: string) => void;
  onWakeUp?: (tokenId: number, effectId: string) => void;
  onStandUp?: (tokenId: number, effectId: string) => void;
  onDeleteToken: (tokenId?: number) => Promise<void>;
  auraVisuals?: any[];
  currentWorldTime?: WorldTime;
}

function getTabsForToken(token: Token, targetSheet?: CharacterSheet | null): { key: TokenPanelTab; label: string; icon: string }[] {
  if (token.character_id) {
    const tabs: { key: TokenPanelTab; label: string; icon: string }[] = [
      { key: 'stats', label: '参数', icon: '📊' },
      { key: 'features', label: '特性', icon: '⚔️' },
      { key: 'equipment', label: '装备', icon: '🎒' },
      { key: 'status', label: '状态', icon: '✨' },
    ];
    // Add spells tab if the character is a spellcaster
    const classId = targetSheet?.character?.class_id;
    const subclassId = (targetSheet?.character as any)?.subclass_id;
    if (classId && isSpellcaster(classId, subclassId)) {
      tabs.push({ key: 'spells', label: '法术', icon: '📚' });
    }
    return tabs;
  }
  return [
    { key: 'stats', label: '参数', icon: '📊' },
    { key: 'equipment', label: '装备', icon: '🎒' },
    { key: 'status', label: '状态', icon: '✨' },
    { key: 'spells', label: '法术', icon: '📚' },
  ];
}

export function FloatingTokenPanel({
  config, token, campaignId, currentUserId, selectedCharacterId,
  activeEffects = [], onRemoveEffect, onEscapeAttempt, onOngoingSave, onConditionSave, onWakeUp, onStandUp,
  auraVisuals = [], onDeleteToken, currentWorldTime,
}: FloatingTokenPanelProps) {
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const preMaxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const rndRef = useRef<Rnd | null>(null);
  const [zIndex, setZIndex] = useState(10050);
  const [sinkForForegroundModal, setSinkForForegroundModal] = useState(false);
  const bringToFront = useFloatingZIndex(s => s.bringToFront);
  const { updatePanel, closePanel } = useFloatingTokenPanelStore();

  const [targetSheet, setTargetSheet] = useState<CharacterSheet | null>(null);
  const [monsterInstance, setMonsterInstance] = useState<any>(null);

  const normalizePanelZ = useCallback((rawZ: number) => Math.min(rawZ, PANEL_Z_MAX), []);
  const handleFocus = useCallback(() => setZIndex(normalizePanelZ(bringToFront())), [bringToFront, normalizePanelZ]);

  useEffect(() => {
    setMounted(true);
    setIsMobile(window.innerWidth < 768);
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Fetch data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (token.character_id) {
        try {
          const sheet = await characterService.getCharacterSheet(token.character_id);
          if (!cancelled) setTargetSheet(sheet);
        } catch (e) { logger.error('Failed to fetch sheet:', e); }
      } else { setTargetSheet(null); }
      if (token.monster_instance_id) {
        try {
          const resp = await apiFetch(`/api/monster-instances/${token.monster_instance_id}`, { userId: currentUserId });
          if (resp.ok && !cancelled) setMonsterInstance(await resp.json());
        } catch (e) { logger.error('Failed to fetch monster:', e); }
      } else { setMonsterInstance(null); }
    })();
    return () => { cancelled = true; };
  }, [token.id, token.character_id, token.monster_instance_id, currentUserId]);

  // Listen for monster status_effects sync from WebSocket
  useEffect(() => {
    if (!token.monster_instance_id) return;
    const handler = (detail: { monsterInstanceId?: number; statusEffects?: unknown }) => {
      if (detail?.monsterInstanceId === token.monster_instance_id) {
        setMonsterInstance((prev: any) => prev ? { ...prev, status_effects: detail.statusEffects } : prev);
      }
    };
    return subscribeAppEvent('monsterStatusEffectsChanged', handler);
  }, [token.monster_instance_id]);

  const tabs = useMemo(() => getTabsForToken(token, targetSheet), [token.character_id, token.monster_instance_id, targetSheet?.character?.class_id, (targetSheet?.character as any)?.subclass_id]);
  const displayName = token.instance_name || token.character_name || token.monster_name || `Token#${token.id}`;
  const avatarUrl = token.avatar || (targetSheet?.character.avatar_url ?? undefined);

  const handleClose = useCallback(() => closePanel(token.id), [closePanel, token.id]);
  const handleMinimize = useCallback(() => {
    setIsMaximized(false);
    updatePanel(token.id, { stage: 'minimized' });
  }, [updatePanel, token.id]);
  const handleRestore = useCallback(() => updatePanel(token.id, { stage: 'open' }), [updatePanel, token.id]);

  const handleToggleMaximize = useCallback(() => {
    if (isMaximized) {
      const prev = preMaxRef.current;
      if (prev) {
        updatePanel(token.id, { x: prev.x, y: prev.y, w: prev.w, h: prev.h });
        rndRef.current?.updatePosition({ x: prev.x, y: prev.y });
        rndRef.current?.updateSize({ width: prev.w, height: prev.h });
      }
      setIsMaximized(false);
    } else {
      preMaxRef.current = { x: config.x, y: config.y, w: config.w, h: config.h };
      const pad = 8;
      const mw = window.innerWidth - pad * 2;
      const mh = window.innerHeight - pad * 2;
      updatePanel(token.id, { x: pad, y: pad, w: mw, h: mh });
      rndRef.current?.updatePosition({ x: pad, y: pad });
      rndRef.current?.updateSize({ width: mw, height: mh });
      setIsMaximized(true);
    }
  }, [isMaximized, config, updatePanel, token.id]);

  const setActiveTab = useCallback((tab: TokenPanelTab) => updatePanel(token.id, { activeTab: tab }), [updatePanel, token.id]);

  // Bridge monster action events to TacticalMap
  const handleActionClick = useCallback((action: any) => {
    const range = getActionRange(action);
    if (!range) return;
    publishAppEvent("monsterActionTargeting", {
      action,
      sourceTokenId: token.id,
      normalRange: range.normalRange,
      maxRange: range.maxRange,
    });
  }, [token.id]);

  const handleActionHover = useCallback((action: any | null) => {
    if (action) {
      const range = getActionRange(action);
      if (range) {
        publishAppEvent("attackDistanceLine", {
          normalRange: range.normalRange,
          maxRange: range.maxRange,
          sourceTokenId: token.id,
        });
        return;
      }
    }
    publishAppEvent("attackDistanceLine", null);
  }, [token.id]);

  const { activeTab, stage } = config;
  const isOpen = stage === 'open';

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      setSinkForForegroundModal(false);
      return;
    }

    let rafId: number | null = null;
    const updateSinkState = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')) as HTMLElement[];
        const hasForegroundDialog = dialogs.some((el) => {
          if (!el.isConnected) return false;
          if (el.classList.contains('floating-char-panel-window')) return false;
          if (el.closest('.floating-char-panel-window')) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });
        setSinkForForegroundModal(hasForegroundDialog);
      });
    };

    updateSinkState();
    const observer = new MutationObserver(updateSinkState);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-state', 'aria-hidden'],
    });
    window.addEventListener('focusin', updateSinkState);

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('focusin', updateSinkState);
    };
  }, [isOpen]);

  if (!mounted) return null;

  const renderTabContent = () => {
    switch (activeTab) {
      case 'stats':
        return (
          <div className="p-3 overflow-y-auto h-full">
            <TokenStatsTab
              token={token} isDM={true} campaignId={campaignId}
              currentUserId={currentUserId} selectedCharacterId={selectedCharacterId}
              activeEffects={activeEffects} onRemoveEffect={onRemoveEffect}
              onEscapeAttempt={onEscapeAttempt} onOngoingSave={onOngoingSave} onConditionSave={onConditionSave} onWakeUp={onWakeUp} onStandUp={onStandUp}
              auraVisuals={auraVisuals} onDeleteToken={onDeleteToken} onClose={handleClose}
              targetSheet={targetSheet} monsterInstance={monsterInstance}
              onDataLoaded={({ targetSheet: ts, monsterInstance: mi }) => {
                if (ts !== undefined) setTargetSheet(ts);
                if (mi !== undefined) setMonsterInstance(mi);
              }}
              onActionClick={handleActionClick}
              onActionHover={handleActionHover}
            />
          </div>
        );
      case 'features':
        return <CharacterFeaturesTab character={targetSheet?.character} />;
      case 'equipment':
        if (token.character_id) {
          return <CharacterEquipmentTab character={targetSheet?.character} campaignId={campaignId} currentUserId={currentUserId}
            onCharacterUpdated={() => {
              if (token.character_id) characterService.getCharacterSheet(token.character_id).then(setTargetSheet).catch(() => {});
            }} />;
        }
        return <MonsterEquipmentTab monsterInstance={monsterInstance} campaignId={campaignId}
          currentUserId={currentUserId} onDataUpdated={setMonsterInstance} />;
      case 'status':
        if (token.character_id && targetSheet?.character) {
          return <CharacterStatusTab character={targetSheet.character} currentUserId={currentUserId} campaignId={campaignId}
            tokenActiveEffects={activeEffects}
            tokenSpellOverlays={token.spell_overlays || []}
            currentWorldTime={currentWorldTime}
            onCharacterUpdated={(updated: any) => setTargetSheet(prev => prev ? { ...prev, character: { ...prev.character, ...updated } } : prev)} />;
        }
        return <MonsterStatusEffectsTab monsterInstance={monsterInstance}
          currentUserId={currentUserId} tokenActiveEffects={activeEffects} tokenSpellOverlays={token.spell_overlays || []} onDataUpdated={setMonsterInstance} currentWorldTime={currentWorldTime} />;
      case 'spells':
        if (token.character_id && targetSheet?.character) {
          return <CharacterSpellsTab character={targetSheet.character}
            campaignId={campaignId} currentUserId={currentUserId}
            onRefetch={() => {
              if (token.character_id) characterService.getCharacterSheet(token.character_id).then(setTargetSheet).catch(() => {});
            }} />;
        }
        if (token.monster_instance_id && monsterInstance) {
          return <MonsterSpellsTab monsterInstance={monsterInstance}
            currentUserId={currentUserId} onDataUpdated={setMonsterInstance} />;
        }
        return null;
      default:
        return null;
    }
  };

  const renderTitleBar = (mobileMode = false) => (
    <div className="floating-char-panel-titlebar flex items-center gap-2 px-2 py-1 select-none">
      {avatarUrl && <img src={avatarUrl} alt="" className="w-6 h-6 rounded object-cover ring-1 ring-amber-500/30 flex-shrink-0" />}
      <span className="text-xs text-amber-300 font-medium truncate max-w-[80px] flex-shrink-0">{displayName}</span>
      <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto scrollbar-hide">
        {tabs.map(tab => (
          <button key={tab.key}
            className={`px-2 py-1 text-xs rounded transition-colors whitespace-nowrap ${activeTab === tab.key ? 'bg-amber-600/30 text-amber-200 font-medium' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'}`}
            onClick={() => setActiveTab(tab.key)}>
            <span className="mr-0.5">{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {!mobileMode && (
          <>
            <button onClick={handleMinimize} className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-amber-300 transition-colors rounded" title="最小化">
              <span className="text-xs leading-none">_</span>
            </button>
            <button onClick={handleToggleMaximize} className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-amber-300 transition-colors rounded" title={isMaximized ? '恢复' : '最大化'}>
              <span className="text-xs leading-none">{isMaximized ? '⧉' : '□'}</span>
            </button>
          </>
        )}
        <button onClick={handleClose} className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors rounded" title="关闭">
          <span className="text-xs leading-none">✕</span>
        </button>
      </div>
    </div>
  );

  if (isMobile) {
    if (!isOpen) return null;
    return createPortal(
      <div className="fixed inset-0 z-[10100] flex items-center justify-center" style={{ paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)' }} onClick={handleClose}>
        <div className="absolute inset-0 bg-black/60" />
        <div className="relative floating-char-panel-window flex flex-col rounded-xl shadow-2xl border border-amber-500/20"
          style={{ width: 'calc(100% - 24px)', height: 'calc(100% - 48px)' }} onClick={e => e.stopPropagation()}>
          {renderTitleBar(true)}
          <div className="flex-1 min-h-0 overflow-hidden rounded-b-xl">{renderTabContent()}</div>
        </div>
      </div>,
      document.body
    );
  }

  const pos = { x: config.x, y: config.y };
  const size = { width: config.w, height: config.h };

  return createPortal(
    <>
      {stage === 'minimized' && (
        <div className="floating-char-panel-minimized fixed z-[10100] flex items-center gap-2 px-3 py-2 rounded-t-lg shadow-lg cursor-pointer transition-all hover:brightness-110"
          style={{ bottom: 0, right: 240 + (token.id % 5) * 100 }} onClick={handleRestore}>
          {avatarUrl && <img src={avatarUrl} alt="" className="w-4 h-4 rounded object-cover" />}
          <span className="text-xs text-amber-200/80 font-medium truncate max-w-[60px]">{displayName}</span>
          <button className="ml-1 text-gray-400 hover:text-white text-xs" onClick={e => { e.stopPropagation(); handleRestore(); }} title="恢复">↗</button>
        </div>
      )}
      <Rnd
        ref={rndRef}
        default={{ ...pos, ...size }}
        position={pos} size={size}
        minWidth={MIN_W} minHeight={MIN_H}
        maxWidth={isMaximized ? undefined : MAX_W}
        maxHeight={isMaximized ? undefined : MAX_H}
        disableDragging={isMaximized} enableResizing={!isMaximized}
        dragHandleClassName="floating-char-panel-titlebar"
        bounds="window"
        className="floating-char-panel-window group"
        resizeHandleStyles={{
          top: { height: `${RESIZE_EDGE_PX}px` }, bottom: { height: `${RESIZE_EDGE_PX}px` },
          left: { width: `${RESIZE_EDGE_PX}px` }, right: { width: `${RESIZE_EDGE_PX}px` },
          topLeft: { width: `${RESIZE_CORNER_PX}px`, height: `${RESIZE_CORNER_PX}px` },
          topRight: { width: `${RESIZE_CORNER_PX}px`, height: `${RESIZE_CORNER_PX}px` },
          bottomLeft: { width: `${RESIZE_CORNER_PX}px`, height: `${RESIZE_CORNER_PX}px` },
          bottomRight: { width: `${RESIZE_CORNER_PX}px`, height: `${RESIZE_CORNER_PX}px` },
        }}
        resizeHandleComponent={{
          top: resizeHandleDot, bottom: resizeHandleEmpty, left: resizeHandleEmpty, right: resizeHandleEmpty,
          topLeft: resizeHandleDot, topRight: resizeHandleDot, bottomLeft: resizeHandleDot, bottomRight: resizeHandleDot,
        }}
        style={{
          zIndex: isOpen ? (sinkForForegroundModal ? PANEL_Z_SINK_WHEN_MODAL : zIndex) : -1,
          visibility: isOpen ? 'visible' : 'hidden',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
        onMouseDown={handleFocus}
        onDragStop={(_e, d) => { setIsMaximized(false); updatePanel(token.id, { x: d.x, y: d.y }); }}
        onResizeStop={(_e, _dir, ref, _delta, position) => {
          setIsMaximized(false);
          updatePanel(token.id, { w: parseInt(ref.style.width), h: parseInt(ref.style.height), x: position.x, y: position.y });
        }}
      >
        {renderTitleBar()}
        <div className="flex-1 min-h-0 overflow-hidden" style={{ height: 'calc(100% - 36px)' }}>
          {renderTabContent()}
        </div>
      </Rnd>
    </>,
    document.body
  );
}

/* ─── Character Features Tab: reuse ClassFeaturesDialog (embedded) ─── */
function CharacterFeaturesTab({ character }: { character: any }) {
  const char = character;
  if (!char) return <div className="flex items-center justify-center h-full text-slate-400 text-sm">暂无数据</div>;

  const race = useMemo(() => (racesData as any).races?.find((r: any) => r.id === char.race_id), [char.race_id]);
  const subrace = useMemo(() => race?.subraces?.find((s: any) => s.id === char.subrace_id), [race, char.subrace_id]);
  const charClass = useMemo(() => (classesData as any).classes?.find((c: any) => c.id === char.class_id), [char.class_id]);
  const subclass = useMemo(() => charClass?.subclasses?.find((s: any) => s.id === (char.subclass_id?.split(',')[0] || char.subclass_id)), [charClass, char.subclass_id]);
  const background = useMemo(() => (backgroundsData as any).backgrounds?.find((b: any) => b.id === char.background_id), [char.background_id]);
  const skillsById = useMemo(() => new Map<string, string>((skillsData as any).skills?.map((s: any) => [s.id, s.name]) || []), []);
  const selectedSkills: string[] = char.proficient_skills || [];
  const raceChoiceSkills: string[] = char.race_choice_skills || [];
  const subclassChoiceSkillsRaw: string[] = char.subclass_choice_skills || [];

  return (
    <div className="h-full overflow-y-auto">
      <ClassFeaturesDialog
        open={true}
        onOpenChange={() => {}}
        character={char}
        race={race}
        subrace={subrace}
        charClass={charClass}
        subclass={subclass}
        background={background}
        selectedSkills={selectedSkills}
        raceChoiceSkills={raceChoiceSkills}
        subclassChoiceSkillsRaw={subclassChoiceSkillsRaw}
        skillsById={skillsById}
        embedded
      />
    </div>
  );
}

/* ─── Character Equipment Tab: reuse BagDialog (embedded) with full hooks ─── */
function CharacterEquipmentTab({ character, campaignId, currentUserId, onCharacterUpdated }: {
  character: any; campaignId: string; currentUserId?: string;
  onCharacterUpdated?: () => void;
}) {
  if (!character) return <div className="flex items-center justify-center h-full text-slate-400 text-sm">暂无数据</div>;

  const showToast = useCallback((msg: string) => {
    logger.info('[toast]', msg);
  }, []);

  const persistCharacterPartial = useCallback(async (
    nextEquipment?: EquipmentItem[],
    _nextPreparedSpells?: string[],
    nextCurrency?: Currency
  ) => {
    const payload: any = {};
    if (nextEquipment !== undefined) payload.equipment = nextEquipment;
    if (nextCurrency !== undefined) payload.currency = nextCurrency;
    if (Object.keys(payload).length === 0) return false;
    if (campaignId) payload.broadcast_campaign_id = campaignId;
    try {
      const resp = await apiFetch(`/api/characters/${character.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        userId: currentUserId,
      });
      if (resp.ok) { onCharacterUpdated?.(); return true; }
      return false;
    } catch (e) {
      logger.error('Failed to persist character:', e);
      return false;
    }
  }, [campaignId, character.id, currentUserId, onCharacterUpdated]);

  const equipment = useEquipment({
    character, campaignId,
    currentMapUrl: null,
    persistCharacterPartial, showToast,
  });

  const currency = useCurrency({ character, persistCharacterPartial });

  const { hasTokenOnMap } = useMapToken({
    character, campaignId,
    currentMapUrl: null,
    userId: currentUserId || '',
  });

  const calcMaxHP = useCallback(() => {
    const conMod = Math.floor(((character.ability_scores?.constitution || 10) - 10) / 2);
    const cd = (classesData as any).classes?.find((c: any) => c.id === character.class_id);
    const hitDie = cd?.hitDie ? (typeof cd.hitDie === 'number' ? cd.hitDie : parseInt(cd.hitDie.replace('d', ''))) : 8;
    return Math.max(1, hitDie + conMod + (character.level - 1) * (Math.floor(hitDie / 2) + 1 + conMod));
  }, [character]);

  return (
    <CharacterProvider
      character={character}
      campaignId={campaignId}
      currentMapUrl={null}
      userId={currentUserId || ''}
      isDM={true}
    >
      <div className="h-full overflow-y-auto">
        <BagDialog
          open={true}
          onOpenChange={() => {}}
          setCurrencyDialogOpen={currency.setCurrencyDialogOpen}
          currencyLocal={currency.currencyLocal}
          equipmentLocal={equipment.equipmentLocal}
          openEquip={equipment.openEquip}
          getEquipped={equipment.getEquipped}
          applyEquip={equipment.applyEquipDirect}
          onEquipmentUpdate={async (items, cur) => {
            equipment.setEquipmentLocal(items);
            await persistCharacterPartial(items, undefined, cur);
          }}
          isContainer={equipment.isContainer}
          getContainerContents={equipment.getContainerContents}
          handlePutInContainer={equipment.handlePutInContainer}
          handlePutMultipleInContainer={equipment.handlePutMultipleInContainer}
          handleTakeOutOfContainer={equipment.handleTakeOutOfContainer}
          handleStackItems={equipment.handleStackItems}
          handleSplitStack={equipment.splitStackDirect}
          handleMergeStacks={equipment.mergeStacksDirect}
          handleDiscardItem={equipment.discardItemDirect}
          handleBatchTakeOut={equipment.handleBatchTakeOut}
          handleBatchDiscard={equipment.handleBatchDiscard}
          handleBatchMerge={equipment.handleBatchMerge}
          hasTokenOnMap={hasTokenOnMap}
          onToggleGrip={equipment.toggleGripMode}
          onUseConsumable={async (item) => {
            const maxHp = calcMaxHP();
            const currentHp = typeof character.current_hp === 'number' ? character.current_hp : maxHp;
            await equipment.useConsumableDirect(item, currentHp, maxHp);
          }}
          isPaperItem={equipment.isPaperItem}
          onWriteOnPaper={equipment.handleWriteOnPaper}
          onEditWrittenPaper={equipment.handleEditWrittenPaper}
          onCopyPaper={equipment.handleCopyPaper}
          embedded
          isDMAddItem
        />
        <CurrencyDialog
          open={currency.currencyDialogOpen}
          onOpenChange={currency.setCurrencyDialogOpen}
          currencyLocal={currency.currencyLocal}
          setCurrencyLocal={currency.setCurrencyLocal}
          handleSaveCurrency={currency.handleSaveCurrency}
        />
      </div>
    </CharacterProvider>
  );
}

/* ─── Character Status Tab: reuse StatusEffectsDialog (embedded, with full DM editing) ─── */
function CharacterStatusTab({ character, currentUserId, campaignId, onCharacterUpdated, tokenActiveEffects, tokenSpellOverlays, currentWorldTime }: {
  character: any; currentUserId?: string; campaignId?: string;
  onCharacterUpdated?: (updated: any) => void;
  tokenActiveEffects?: any[];
  tokenSpellOverlays?: any[];
  currentWorldTime?: WorldTime;
}) {
  const savedStatus = character.status_effects as any;
  const [customEffects, setCustomEffects] = useState<CustomStatusEffect[]>(
    () => migrateCustomEffects(savedStatus?.custom_effects),
  );
  const [activeConditions, setActiveConditions] = useState<ConditionWithDuration[]>(
    () => migrateConditions(savedStatus?.active_conditions),
  );
  const [exhaustionLevel, setExhaustionLevel] = useState<number>(savedStatus?.exhaustion_level ?? 0);
  const [exhaustionDuration, setExhaustionDuration] = useState<Duration>(
    () => migrateDuration(savedStatus?.exhaustion_duration) ?? { ...PERMANENT_DURATION },
  );
  const [specialBuffs, setSpecialBuffs] = useState<SpecialBuffs>(savedStatus?.special_buffs ?? {});
  const [tokenStatusEffects, setTokenStatusEffects] = useState<any[]>(() => tokenActiveEffects || []);

  // Spell buff effects from token's active_effects
  const [spellBuffs, setSpellBuffs] = useState<any[]>(() =>
    (tokenActiveEffects || []).filter((e: any) => e.spell_buff)
  );
  useEffect(() => {
    setTokenStatusEffects(tokenActiveEffects || []);
    setSpellBuffs((tokenActiveEffects || []).filter((e: any) => e.spell_buff));
  }, [tokenActiveEffects]);
  // Listen for real-time spell buff updates
  useEffect(() => {
    const handler = ({
      characterId,
      activeEffects,
    }: {
      characterId?: number | string;
      activeEffects?: any[];
    }) => {
      if (characterId === character.id && Array.isArray(activeEffects)) {
        setTokenStatusEffects(activeEffects);
        setSpellBuffs(activeEffects.filter((eff: any) => eff.spell_buff));
      }
    };
    return subscribeAppEvent("characterActiveEffectsChanged", handler);
  }, [character.id]);

  // Re-sync when character data changes externally
  const statusJson = JSON.stringify(character.status_effects);
  useEffect(() => {
    const s = character.status_effects as any;
    setCustomEffects(migrateCustomEffects(s?.custom_effects));
    setActiveConditions(migrateConditions(s?.active_conditions));
    setExhaustionLevel(s?.exhaustion_level ?? 0);
    setExhaustionDuration(migrateDuration(s?.exhaustion_duration) ?? { ...PERMANENT_DURATION });
    setSpecialBuffs(s?.special_buffs ?? {});
  }, [character.id, statusJson]);

  const persistStatusEffects = useCallback(async (
    effects: CustomStatusEffect[], conditions: ConditionWithDuration[],
    exhaustion: number, exhDuration?: Duration,
    buffs?: SpecialBuffs,
  ) => {
    const payload: any = {
      status_effects: {
        custom_effects: effects || [],
        active_conditions: conditions || [],
        exhaustion_level: exhaustion,
        exhaustion_duration: exhDuration,
        special_buffs: buffs ?? specialBuffs,
      },
    };
    if (campaignId) payload.broadcast_campaign_id = campaignId;
    try {
      const resp = await apiFetch(`/api/characters/${character.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        userId: currentUserId,
      });
      if (resp.ok) {
        const updated = await resp.json();
        onCharacterUpdated?.(updated);
      }
    } catch (e) { /* silent */ }
  }, [character.id, currentUserId, campaignId, specialBuffs, onCharacterUpdated]);

  const advanceTime = useCallback((rounds: number, exhaustionReduction = 0) => {
    const decrement = (dur: Duration | undefined) =>
      dur && dur.type !== 'permanent' ? { ...dur, remaining: dur.remaining - rounds } : dur;
    const alive = (dur: Duration | undefined) =>
      !dur || dur.type === 'permanent' || dur.remaining > 0;
    const nextEffects = customEffects.map(e => ({ ...e, duration: decrement(e.duration)! })).filter(e => alive(e.duration));
    setCustomEffects(nextEffects);
    const nextConditions = activeConditions.map(c => ({ ...c, duration: decrement(c.duration)! })).filter(c => alive(c.duration));
    setActiveConditions(nextConditions);
    let nextExhLv = exhaustionLevel;
    let nextExhDur = exhaustionDuration;
    if (nextExhDur?.type !== 'permanent' && nextExhDur?.remaining > 0) {
      nextExhDur = { ...nextExhDur, remaining: nextExhDur.remaining - rounds };
      if (nextExhDur.remaining <= 0) { nextExhLv = 0; nextExhDur = { ...PERMANENT_DURATION }; }
    }
    if (exhaustionReduction > 0 && nextExhLv > 0) {
      nextExhLv = Math.max(0, nextExhLv - exhaustionReduction);
      if (nextExhLv === 0) nextExhDur = { ...PERMANENT_DURATION };
    }
    setExhaustionLevel(nextExhLv);
    setExhaustionDuration(nextExhDur);
    const nextBuffs = advanceSpecialBuffDurations(specialBuffs, rounds) as SpecialBuffs;
    setSpecialBuffs(nextBuffs);
    persistStatusEffects(nextEffects, nextConditions, nextExhLv, nextExhDur, nextBuffs);
  }, [customEffects, activeConditions, exhaustionLevel, exhaustionDuration, specialBuffs, persistStatusEffects]);

  const favoredEnemy = (() => {
    const val = character.favored_enemy || character.favoredEnemy;
    return typeof val === 'string' ? val : val?.value;
  })();
  const favoredHumanoidRaces = (character.favored_humanoid_races || character.favoredHumanoidRaces) as string[] | undefined;
  const favoredTerrain = (() => {
    const val = character.favored_terrain || character.favoredTerrain;
    return typeof val === 'string' ? val : val?.value;
  })();

  return (
    <div className="h-full overflow-y-auto">
      <StatusEffectsDialog
        open={true}
        onOpenChange={() => {}}
        isDM={true}
        characterName={character.name}
        customEffects={customEffects}
        activeConditions={activeConditions}
        exhaustionLevel={exhaustionLevel}
        exhaustionDuration={exhaustionDuration}
        favoredEnemy={favoredEnemy}
        favoredHumanoidRaces={favoredHumanoidRaces}
        favoredTerrain={favoredTerrain}
        specialBuffs={specialBuffs}
        tokenActiveEffects={tokenStatusEffects}
        incomingSpellBuffs={spellBuffs}
        runtimeSpellOverlays={tokenSpellOverlays}
        currentWorldTime={currentWorldTime}
        onAddEffect={(e: CustomStatusEffect) => {
          setCustomEffects(prev => { const next = [...prev, e]; persistStatusEffects(next, activeConditions, exhaustionLevel, exhaustionDuration); return next; });
        }}
        onRemoveEffect={(id: string) => {
          setCustomEffects(prev => { const next = prev.filter(x => x.id !== id); persistStatusEffects(next, activeConditions, exhaustionLevel, exhaustionDuration); return next; });
        }}
        onUpdateEffect={(id: string, patch: Partial<CustomStatusEffect>) => {
          setCustomEffects(prev => { const next = prev.map(x => x.id === id ? { ...x, ...patch } : x); persistStatusEffects(next, activeConditions, exhaustionLevel, exhaustionDuration); return next; });
        }}
        onToggleCondition={(c: ConditionType) => {
          setActiveConditions(prev => {
            const exists = prev.find(x => x.condition === c);
            const next = exists ? prev.filter(x => x.condition !== c) : [...prev, { condition: c, duration: { ...PERMANENT_DURATION }, source: { type: 'dm' as const }, removal: { type: 'manual' as const } }];
            persistStatusEffects(customEffects, next, exhaustionLevel, exhaustionDuration);
            return next;
          });
        }}
        onUpdateConditionDuration={(c: ConditionType, dur: Duration) => {
          setActiveConditions(prev => { const next = prev.map(x => x.condition === c ? { ...x, duration: dur } : x); persistStatusEffects(customEffects, next, exhaustionLevel, exhaustionDuration); return next; });
        }}
        onSetExhaustion={(lv: number) => {
          setExhaustionLevel(lv);
          const dur = lv === 0 ? { ...PERMANENT_DURATION } : exhaustionDuration;
          if (lv === 0) setExhaustionDuration(dur);
          persistStatusEffects(customEffects, activeConditions, lv, dur);
        }}
        onSetExhaustionDuration={(dur: Duration) => {
          setExhaustionDuration(dur);
          persistStatusEffects(customEffects, activeConditions, exhaustionLevel, dur);
        }}
        onAdvanceRound={() => advanceTime(1)}
        onShortRest={() => advanceTime(SHORT_REST_ROUNDS)}
        onLongRest={() => advanceTime(LONG_REST_ROUNDS, 1)}
        embedded
      />
    </div>
  );
}

/* ─── Monster Equipment Tab: reuse BagDialog (embedded) via useMonsterEquipment ─── */
function MonsterEquipmentTab({ monsterInstance, campaignId, currentUserId, onDataUpdated }: {
  monsterInstance: any; campaignId: string; currentUserId?: string;
  onDataUpdated?: (updated: any) => void;
}) {
  if (!monsterInstance) return <div className="flex items-center justify-center h-full text-slate-400 text-sm">暂无数据</div>;

  const { equipment, currency, persistCharacterPartial } = useMonsterEquipment(
    monsterInstance, campaignId, currentUserId, onDataUpdated,
  );

  const [avatarRegenerating, setAvatarRegenerating] = useState(false);

  const handleRegenerateAvatar = useCallback(async () => {
    if (avatarRegenerating || !monsterInstance.avatar_url) return;
    setAvatarRegenerating(true);
    try {
      // Build equipment description from equipped items (same pattern as useAvatar.ts)
      const equipped = (equipment.equipmentLocal || []).filter((it: EquipmentItem) => it.equippedSlot);
      if (equipped.length === 0) {
        alert('当前没有装备任何物品');
        return;
      }
      // Build equipment description in English to avoid AI rendering Chinese text
      const SLOT_EN: Record<string, string> = {
        main_hand: 'wielding', off_hand: 'holding in off-hand', armor: 'wearing',
        ammo: 'carrying', quick_item: 'carrying', clothing: 'dressed in', accessory: 'adorned with',
      };
      const desc = equipped
        .map(it => {
          const verb = SLOT_EN[it.equippedSlot!] || 'equipped with';
          const name = it.nameEn || it.name || it.id;
          return `${verb} ${name}`;
        })
        .join(', ');

      // Only use visual appearance, never use 'description' (contains stat block text)
      const md = monsterInstance.monster_data || {};
      const appearance = md.appearanceEn || md.appearance || '';

      // Use same API as player character: img2img with reference_image + equipment_description
      console.log('[MonsterEquip] Generating avatar with equipment:', desc, 'reference:', monsterInstance.avatar_url);
      const resp = await apiFetch('/api/ai-settings/generate-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUserId || '',
          race: md.type || 'monster',
          character_class: 'monster',
          name: monsterInstance.name_cn || monsterInstance.name,
          appearance_description: appearance,
          reference_image: monsterInstance.avatar_url,
          equipment_description: desc,
        }),
      });
      if (!resp.ok) {
        alert('根据装备重新生成头像失败');
        return;
      }
      const data = await resp.json();
      console.log('[MonsterEquip] Avatar generated, saving...', data.image?.slice(0, 80));

      // Save avatar back to monster instance via new endpoint
      const patch = await apiFetch(`/api/monster-instances/${monsterInstance.id}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        userId: currentUserId,
        body: JSON.stringify({ avatar: data.image }),
      });
      if (patch.ok) {
        const saved = await patch.json();
        onDataUpdated?.({ ...monsterInstance, avatar_url: saved.avatar_url });
        // Notify map to refresh token avatar
        publishAppEvent("monsterAvatarUpdated", {
          monsterInstanceId: monsterInstance.id,
          avatarUrl: saved.avatar_url,
        });
      }
    } catch (e) {
      console.error('Failed to regenerate avatar', e);
      alert('换装生成异常');
    } finally {
      setAvatarRegenerating(false);
    }
  }, [avatarRegenerating, equipment.equipmentLocal, monsterInstance, currentUserId, onDataUpdated]);

  // Build a minimal Character shape for CharacterProvider
  const fakeChar = useMemo(() => ({
    id: monsterInstance.id,
    user_id: '',
    name: monsterInstance.name_cn || monsterInstance.name,
    avatar: monsterInstance.avatar_url || '',
    race_id: '', class_id: '', level: 1,
    equipment: monsterInstance.equipment || [],
    currency: monsterInstance.currency || { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    ability_scores: monsterInstance.ability_scores || {},
  }), [monsterInstance?.id, monsterInstance?.equipment, monsterInstance?.currency, monsterInstance?.ability_scores, monsterInstance?.name_cn, monsterInstance?.name, monsterInstance?.avatar_url]);

  const [profHelpOpen, setProfHelpOpen] = useState(false);
  const [profHelpType, setProfHelpType] = useState<'weapon' | 'armor'>('weapon');

  return (
    <CharacterProvider
      character={fakeChar as any}
      campaignId={campaignId}
      currentMapUrl={null}
      userId={currentUserId || ''}
      isDM={true}
      persistCharacterPartial={persistCharacterPartial}
    >
      <div className="h-full overflow-y-auto">
        <EquipDialog
          open={equipment.equipDialogOpen}
          onOpenChange={equipment.setEquipDialogOpen}
          slot={equipment.equipDialogSlot}
          equipmentLocal={equipment.equipmentLocal}
          setEquipmentLocal={equipment.setEquipmentLocal}
          getEquipped={equipment.getEquipped}
          backpackWeapons={equipment.backpackWeapons}
          backpackShield={equipment.backpackShield}
          backpackOtherHandheld={equipment.backpackOtherHandheld}
          backpackLightArmor={equipment.backpackLightArmor}
          backpackMediumArmor={equipment.backpackMediumArmor}
          backpackHeavyArmor={equipment.backpackHeavyArmor}
          backpackAmmo={equipment.backpackAmmo}
          backpackConsumables={equipment.backpackConsumables}
          backpackClothing={equipment.backpackClothing}
          backpackAccessory={equipment.backpackAccessory}
          applyEquip={equipment.applyEquip}
          setProfHelpOpen={setProfHelpOpen}
          setProfHelpType={setProfHelpType}
        />
        <BagDialog
          open={true}
          onOpenChange={() => {}}
          setCurrencyDialogOpen={currency.setCurrencyDialogOpen}
          currencyLocal={currency.currencyLocal}
          equipmentLocal={equipment.equipmentLocal}
          openEquip={equipment.openEquip}
          getEquipped={equipment.getEquipped}
          applyEquip={equipment.applyEquipDirect}
          onEquipmentUpdate={async (items, cur) => {
            equipment.setEquipmentLocal(items);
            await persistCharacterPartial(items, undefined, cur);
          }}
          isContainer={equipment.isContainer}
          getContainerContents={equipment.getContainerContents}
          handlePutInContainer={equipment.handlePutInContainer}
          handlePutMultipleInContainer={equipment.handlePutMultipleInContainer}
          handleTakeOutOfContainer={equipment.handleTakeOutOfContainer}
          handleStackItems={equipment.handleStackItems}
          handleSplitStack={equipment.splitStackDirect}
          handleMergeStacks={equipment.mergeStacksDirect}
          handleDiscardItem={equipment.discardItemDirect}
          handleBatchTakeOut={equipment.handleBatchTakeOut}
          handleBatchDiscard={equipment.handleBatchDiscard}
          handleBatchMerge={equipment.handleBatchMerge}
          hasTokenOnMap={false}
          onToggleGrip={equipment.toggleGripMode}
          onUseConsumable={async (item) => {
            const hp = monsterInstance.current_hp ?? monsterInstance.hit_points ?? 10;
            const maxHp = monsterInstance.hit_points ?? 10;
            await equipment.useConsumableDirect(item, hp, maxHp);
          }}
          isPaperItem={equipment.isPaperItem}
          onWriteOnPaper={equipment.handleWriteOnPaper}
          onEditWrittenPaper={equipment.handleEditWrittenPaper}
          onCopyPaper={equipment.handleCopyPaper}
          onRegenerateAvatar={handleRegenerateAvatar}
          avatarRegenerating={avatarRegenerating}
          embedded
          isDMAddItem
        />
        <CurrencyDialog
          open={currency.currencyDialogOpen}
          onOpenChange={currency.setCurrencyDialogOpen}
          currencyLocal={currency.currencyLocal}
          setCurrencyLocal={currency.setCurrencyLocal}
          handleSaveCurrency={currency.handleSaveCurrency}
        />
      </div>
    </CharacterProvider>
  );
}

/* ─── Character Spells Tab: reuse SpellsDialog (embedded) ─── */
function CharacterSpellsTab({ character, campaignId, currentUserId, onRefetch }: {
  character: any; campaignId: string; currentUserId?: string;
  onRefetch: () => void;
}) {
  const allSpells: Spell[] = useMemo(() => (spellsData as any).spells || [], []);
  const classId = character.class_id;
  const subclassId = character.subclass_id;

  const isPrepared = isPreparedCasterUtil(classId);
  const preparedIds: string[] = useMemo(() =>
    (character.prepared_spells || []).map((s: any) => typeof s === 'string' ? s : s.id),
    [character.prepared_spells]);

  const spellcastingInfo = useMemo(() => {
    const abilityId = (spellcastingAbilityMap as Record<string, string>)[classId] as SpellcastingAbilityId | undefined;
    if (!abilityId) return null;

    const race = (racesData as any).races?.find((r: any) => r.id === character.race_id);
    const subrace = race?.subraces?.find((s: any) => s.id === character.subrace_id);
    const baseScores = character.ability_scores || {};
    const raceBonuses = race?.abilityScoreIncrease || {};
    const subBonuses = subrace?.abilityScoreIncrease || {};

    const finalScores: Record<string, number> = {
      strength: (baseScores.strength || 10) + (raceBonuses.strength || 0) + (subBonuses.strength || 0),
      dexterity: (baseScores.dexterity || 10) + (raceBonuses.dexterity || 0) + (subBonuses.dexterity || 0),
      constitution: (baseScores.constitution || 10) + (raceBonuses.constitution || 0) + (subBonuses.constitution || 0),
      intelligence: (baseScores.intelligence || 10) + (raceBonuses.intelligence || 0) + (subBonuses.intelligence || 0),
      wisdom: (baseScores.wisdom || 10) + (raceBonuses.wisdom || 0) + (subBonuses.wisdom || 0),
      charisma: (baseScores.charisma || 10) + (raceBonuses.charisma || 0) + (subBonuses.charisma || 0),
    };

    const abilityMod = Math.floor((finalScores[abilityId] - 10) / 2);
    const profBonus = Math.ceil((character.level || 1) / 4) + 1;
    const spellSaveDC = 8 + profBonus + abilityMod;
    const spellAttackMod = profBonus + abilityMod;

    let spellcasterType: SpellcasterType = 'full';
    if (classId === 'warlock') spellcasterType = 'pact';
    else if (classId === 'paladin' || classId === 'ranger') spellcasterType = 'half';

    const config: any = spellcastingConfig;
    let spellSlots: number[] = new Array(10).fill(0);

    if (spellcasterType === 'pact') {
      const pactCfg = config?.pactMagic?.warlock || {};
      const levelKey = String(character.level || 1);
      const pactEntry = pactCfg[levelKey];
      if (pactEntry && typeof pactEntry.slots === 'number') {
        const slotLevel = pactEntry.level ?? 1;
        if (slotLevel >= 1 && slotLevel <= 9) spellSlots[slotLevel] = pactEntry.slots;
      }
    } else {
      const tableKey = spellcasterType === 'full' ? 'fullCaster' : 'halfCaster';
      const table = config?.slotTables?.[tableKey] || {};
      const rawSlots: number[] = table[String(character.level || 1)] || [];
      spellSlots = [0, ...rawSlots];
      while (spellSlots.length < 10) spellSlots.push(0);
    }

    let pMax = 0;
    if (isPrepared) {
      const abilityMods: Record<string, number> = {};
      for (const [k, v] of Object.entries(finalScores)) abilityMods[k] = Math.floor((v - 10) / 2);
      pMax = computePreparedMax(character, abilityMods);
    }

    const abilityLabels: Record<string, string> = { intelligence: '智力', wisdom: '感知', charisma: '魅力' };

    return {
      cantripsLocal: (character.selected_cantrips || []).map((s: any) => typeof s === 'string' ? s : s.id),
      knownSpells: isSpellbookCasterUtil(classId)
        ? (character.selected_spells || []).map((s: any) => typeof s === 'string' ? s : s.id)
        : isPrepared
          ? allSpells.filter((s: Spell) => s.level > 0 && s.level <= maxSpellLevelForClass(classId, character.level || 1, subclassId) && s.classes?.includes(classId)).map((s: Spell) => s.id)
          : (character.selected_spells || []).map((s: any) => typeof s === 'string' ? s : s.id),
      preparedLocal: preparedIds,
      preparedCount: preparedIds.length,
      preparedMax: pMax,
      spellcastingAbilityLabel: abilityLabels[abilityId] || abilityId,
      spellcastingAbilityScore: finalScores[abilityId],
      spellcastingAbilityMod: abilityMod,
      spellcastingAbilityId: abilityId as SpellcastingAbilityId,
      spellcasterType,
      spellSaveDC,
      spellAttackStr: `+${spellAttackMod}`,
      spellSlots,
      remainingSlots: character.spell_slots_state || spellSlots,
      autoPrepared: getAlwaysPreparedSubclassSpells(character),
    };
  }, [character, preparedIds, isPrepared, classId, subclassId, allSpells]);

  const handleConsumeSlot = useCallback((level: number) => {
    if (!spellcastingInfo) return;
    const newSlots = [...spellcastingInfo.remainingSlots];
    if (newSlots[level] > 0) {
      newSlots[level]--;
      const payload: Record<string, unknown> = { spell_slots_state: newSlots };
      if (campaignId) payload.broadcast_campaign_id = campaignId;
      apiFetch(`/api/characters/${character.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        userId: currentUserId,
      }).then(() => onRefetch());
    }
  }, [spellcastingInfo, campaignId, character.id, currentUserId, onRefetch]);

  if (!spellcastingInfo) return <div className="flex items-center justify-center h-full text-slate-400 text-sm">暂无施法能力</div>;

  return (
    <div className="h-full overflow-y-auto">
      <SpellsDialog
        open={true}
        onOpenChange={() => {}}
        isPreparedCaster={isPrepared}
        classId={classId}
        cantripsLocal={spellcastingInfo.cantripsLocal}
        knownSpells={spellcastingInfo.knownSpells}
        preparedLocal={spellcastingInfo.preparedLocal}
        preparedCount={spellcastingInfo.preparedCount}
        preparedMax={spellcastingInfo.preparedMax}
        togglePreparedWithLimit={() => {}}
        setPreparedSpellsAndPersist={async (spells: string[]) => {
          const payload: Record<string, unknown> = { prepared_spells: spells };
          if (campaignId) payload.broadcast_campaign_id = campaignId;
          await apiFetch(`/api/characters/${character.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            userId: currentUserId,
          });
          onRefetch();
        }}
        spellsAll={allSpells}
        spellcastingAbilityLabel={spellcastingInfo.spellcastingAbilityLabel}
        spellcastingAbilityScore={spellcastingInfo.spellcastingAbilityScore}
        spellcastingAbilityMod={spellcastingInfo.spellcastingAbilityMod}
        spellcastingAbilityId={spellcastingInfo.spellcastingAbilityId}
        spellcasterType={spellcastingInfo.spellcasterType}
        spellSaveDC={spellcastingInfo.spellSaveDC}
        spellAttackStr={spellcastingInfo.spellAttackStr}
        spellSlots={spellcastingInfo.spellSlots}
        remainingSlots={spellcastingInfo.remainingSlots}
        autoPrepared={spellcastingInfo.autoPrepared}
        onConsumeSlot={handleConsumeSlot}
        canPrepareSpells={true}
        onPreparationFinished={() => {}}
        embedded
      />
    </div>
  );
}
function MonsterStatusEffectsTab({ monsterInstance, currentUserId, tokenActiveEffects, tokenSpellOverlays, onDataUpdated, currentWorldTime }: {
  monsterInstance: any; currentUserId?: string;
  tokenActiveEffects?: any[];
  tokenSpellOverlays?: any[];
  onDataUpdated?: (updated: any) => void;
  currentWorldTime?: WorldTime;
}) {
  if (!monsterInstance) return <div className="flex items-center justify-center h-full text-slate-400 text-sm">暂无数据</div>;

  const statusProps = useMonsterStatus(monsterInstance, tokenActiveEffects, currentUserId, onDataUpdated);

  return (
    <div className="h-full overflow-y-auto">
      <StatusEffectsDialog
        open={true}
        onOpenChange={() => {}}
        isDM={true}
        {...statusProps}
        tokenActiveEffects={tokenActiveEffects}
        runtimeSpellOverlays={tokenSpellOverlays}
        currentWorldTime={currentWorldTime}
        embedded
      />
    </div>
  );
}

/* ─── Monster Spells Tab: SpellsDialog in monsterMode ─── */
function MonsterSpellsTab({ monsterInstance, currentUserId, onDataUpdated }: {
  monsterInstance: any; currentUserId?: string;
  onDataUpdated?: (updated: any) => void;
}) {
  const allSpells: Spell[] = useMemo(() => (spellsData as any).spells || [], []);
  const allSpellIds = useMemo(() => allSpells.map(s => s.id), [allSpells]);

  const selectedSpells: string[] = monsterInstance.selected_spells || [];
  const spellSlots: number[] = useMemo(() => {
    const s = monsterInstance.spell_slots || [];
    while (s.length < 10) s.push(0);
    return s;
  }, [monsterInstance.spell_slots]);
  const remainingSlots: number[] = useMemo(() => {
    const s = monsterInstance.spell_slots_state || [...spellSlots];
    while (s.length < 10) s.push(0);
    return s;
  }, [monsterInstance.spell_slots_state, spellSlots]);

  const cantrips = useMemo(() =>
    selectedSpells.filter(id => { const sp = allSpells.find(s => s.id === id); return sp && (sp as any).level === 0; }),
    [selectedSpells, allSpells]);

  const persistMonster = useCallback(async (payload: Record<string, any>) => {
    try {
      const resp = await apiFetch(`/api/monster-instances/${monsterInstance.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        userId: currentUserId,
      });
      if (resp.ok) {
        const updated = await resp.json();
        onDataUpdated?.(updated);
      }
    } catch (e) { logger.error('Failed to persist monster spells:', e); }
  }, [monsterInstance.id, currentUserId, onDataUpdated]);

  const handleSetPrepared = useCallback(async (spells: string[]) => {
    await persistMonster({ selected_spells: spells });
  }, [persistMonster]);

  const handleConsumeSlot = useCallback((level: number) => {
    const newSlots = [...remainingSlots];
    if (newSlots[level] > 0) {
      newSlots[level]--;
      persistMonster({ spell_slots_state: newSlots });
    }
  }, [remainingSlots, persistMonster]);

  const handleUpdateSpellSlots = useCallback((newMax: number[]) => {
    // Adjust remaining: for each level, remaining = min(oldRemaining, newMax)
    const newRemaining = newMax.map((max, i) => Math.min(remainingSlots[i] ?? 0, max));
    persistMonster({ spell_slots: newMax, spell_slots_state: newRemaining });
  }, [remainingSlots, persistMonster]);

  return (
    <div className="h-full overflow-y-auto">
      <SpellsDialog
        open={true}
        onOpenChange={() => {}}
        isPreparedCaster={true}
        cantripsLocal={cantrips}
        knownSpells={allSpellIds}
        preparedLocal={selectedSpells}
        preparedCount={selectedSpells.length}
        preparedMax={9999}
        togglePreparedWithLimit={() => {}}
        setPreparedSpellsAndPersist={handleSetPrepared}
        spellsAll={allSpells}
        spellcastingAbilityLabel=""
        spellcastingAbilityId={null}
        spellcasterType={null}
        spellSaveDC={null}
        spellAttackStr={null}
        spellSlots={spellSlots}
        remainingSlots={remainingSlots}
        autoPrepared={[]}
        onConsumeSlot={handleConsumeSlot}
        canPrepareSpells={true}
        onPreparationFinished={() => {}}
        embedded
        monsterMode
        onUpdateSpellSlots={handleUpdateSpellSlots}
      />
    </div>
  );
}
