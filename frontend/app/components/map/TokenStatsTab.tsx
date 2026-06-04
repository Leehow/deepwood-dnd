/**
 * TokenStatsTab – reusable token stats content (extracted from TokenModal).
 * Renders monster or character stats, effects, auras, spell slots, features, actions, spells.
 * Used by both TokenModal (player) and FloatingTokenPanel (DM).
 */
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import type { Token, AuraVisual } from './types/TacticalMapTypes';
import type { CharacterSheet, SpellSlot } from '~/types';
import { characterService } from '~/services/character.service';
import { apiFetch } from '~/utils/api-client';
import { createLogger } from '~/utils/logger';
import { getEffectDefinition } from '~/hooks/useEffectSystem';
import { SpellDetailModal } from '~/components/spell/SpellSelectableCard';
import { getAuraPresentation } from './utils/auraPresentation';
import classesData from '~/data/rules/classes_with_structured_subclass_features.json';
import {
  formatFightingStyle, formatMetamagic, formatEldritchInvocation,
  formatFavoredEnemy, formatHumanoid, formatFavoredTerrain,
} from '~/components/character/CharacterDisplay/utils/formatting';

const logger = createLogger('TokenStatsTab');

function cleanLatex(text: string): string {
  if (!text) return text;
  return text
    .replace(/\\\(|\\\)/g, '')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\left/g, '').replace(/\\right/g, '')
    .replace(/\{([^{}]+)\}/g, '$1')
    .replace(/\s+/g, ' ').trim();
}

interface ActiveEffect {
  id: string; name: string; icon?: string; color?: string;
  duration?: number | { persistent: true };
  [key: string]: any;
}

export interface TokenStatsTabProps {
  token: Token | null;
  isDM: boolean;
  campaignId: string;
  currentUserId?: string;
  selectedCharacterId?: number | null;
  activeEffects?: ActiveEffect[];
  onRemoveEffect?: (effectId: string) => void;
  onEscapeAttempt?: (tokenId: number, effectId: string) => void;
  onOngoingSave?: (tokenId: number, effectId: string) => void;
  onConditionSave?: (tokenId: number, effectId: string) => void;
  onWakeUp?: (tokenId: number, effectId: string) => void;
  onStandUp?: (tokenId: number, effectId: string) => void;
  onDeleteToken: (tokenId?: number) => Promise<void>;
  onClose?: () => void;
  /** Externally fetched data (optional - if not provided, fetches internally) */
  targetSheet?: CharacterSheet | null;
  monsterInstance?: any;
  /** Called when data is fetched internally so parent can share it across tabs */
  onDataLoaded?: (data: { targetSheet: CharacterSheet | null; monsterInstance: any }) => void;
  /** Monster action callbacks (for floating panel attack flow) */
  onActionClick?: (action: any) => void;
  onActionHover?: (action: any | null) => void;
  auraVisuals?: any[];
}

export function TokenStatsTab(props: TokenStatsTabProps) {
  const {
    token, isDM, campaignId, currentUserId, selectedCharacterId,
    activeEffects = [], onRemoveEffect, onEscapeAttempt, onOngoingSave, onConditionSave, onWakeUp, onStandUp,
    auraVisuals = [], onDeleteToken, onClose,
    targetSheet: externalTargetSheet, monsterInstance: externalMonsterInstance,
    onDataLoaded, onActionClick, onActionHover,
  } = props;

  const authedFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) =>
      apiFetch(input, { ...init, userId: currentUserId }),
    [currentUserId]
  );

  // Internal data state (used when external data not provided)
  const [internalTargetSheet, setInternalTargetSheet] = useState<CharacterSheet | null>(null);
  const [internalMonsterInstance, setInternalMonsterInstance] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [spellDetail, setSpellDetail] = useState<SpellSlot | null>(null);

  const targetSheet = externalTargetSheet !== undefined ? externalTargetSheet : internalTargetSheet;
  const monsterInstance = externalMonsterInstance !== undefined ? externalMonsterInstance : internalMonsterInstance;

  // Helper to update targetSheet in both internal state and parent
  const updateTargetSheet = useCallback((updater: (prev: CharacterSheet | null) => CharacterSheet | null) => {
    setInternalTargetSheet(updater);
    if (externalTargetSheet !== undefined) {
      const updated = updater(externalTargetSheet);
      if (updated) onDataLoaded?.({ targetSheet: updated, monsterInstance: externalMonsterInstance ?? null });
    }
  }, [externalTargetSheet, externalMonsterInstance, onDataLoaded]);

  // HP editing
  const [editableHP, setEditableHP] = useState('');
  const [isSavingHP, setIsSavingHP] = useState(false);
  const hpDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Temp HP editing (DM only)
  const [editableTempHP, setEditableTempHP] = useState('');
  const tempHPDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Action uses editing (DM)
  const [editingActionId, setEditingActionId] = useState<number | null>(null);
  const [editableUses, setEditableUses] = useState('');
  const [isSavingUses, setIsSavingUses] = useState(false);
  const [isConvertingToChest, setIsConvertingToChest] = useState(false);
  const [showChestSelector, setShowChestSelector] = useState(true);
  const [chestSelectedItems, setChestSelectedItems] = useState<Set<string>>(new Set());
  const [chestIncludeCurrency, setChestIncludeCurrency] = useState(true);

  // Spell slots editing (DM)
  const [editingSlotLevel, setEditingSlotLevel] = useState<string | null>(null);
  const [editableSlotValue, setEditableSlotValue] = useState('');
  const [isSavingSlots, setIsSavingSlots] = useState(false);

  // Aura state
  const [availableAuras, setAvailableAuras] = useState<any[]>([]);

  // Sync HP
  useEffect(() => {
    if (token?.current_hp != null) setEditableHP(String(token.current_hp));
    else setEditableHP('');
  }, [token?.id, token?.current_hp]);

  // Sync Temp HP
  useEffect(() => {
    setEditableTempHP(token?.temp_hp != null && token.temp_hp > 0 ? String(token.temp_hp) : '');
  }, [token?.id, token?.temp_hp]);

  useEffect(() => {
    return () => { if (hpDebounceRef.current) clearTimeout(hpDebounceRef.current); };
  }, []);

  const isSelf = useMemo(() => {
    if (!token) return false;
    if (currentUserId && token.user_id && token.user_id === currentUserId) return true;
    if (selectedCharacterId && token.character_id && token.character_id === selectedCharacterId) return true;
    return false;
  }, [token, currentUserId, selectedCharacterId]);

  const selfOrDM = isSelf || isDM;

  // Fetch data internally only if external data not provided
  useEffect(() => {
    if (externalTargetSheet !== undefined && externalMonsterInstance !== undefined) return;
    let cancelled = false;
    (async () => {
      if (!token) return;
      setLoading(true);
      try {
        let sheet: CharacterSheet | null = null;
        let monster: any = null;
        if (token.character_id) {
          sheet = await characterService.getCharacterSheet(token.character_id);
          if (!cancelled) setInternalTargetSheet(sheet);
        } else { if (!cancelled) setInternalTargetSheet(null); }
        if (token.monster_instance_id) {
          try {
            const resp = await authedFetch(`/api/monster-instances/${token.monster_instance_id}`);
            if (resp.ok) { monster = await resp.json(); if (!cancelled) setInternalMonsterInstance(monster); }
          } catch (e) { logger.error('Failed to fetch monster instance:', e); }
        } else { if (!cancelled) setInternalMonsterInstance(null); }
        if (!cancelled) onDataLoaded?.({ targetSheet: sheet, monsterInstance: monster });
      } catch (e) { logger.error('Failed to fetch data:', e); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [token?.id, token?.character_id, token?.monster_instance_id, externalTargetSheet, externalMonsterInstance]);

  // Fetch auras
  useEffect(() => {
    if (!token?.id || !token?.character_id) { setAvailableAuras([]); return; }
    (async () => {
      try {
        const resp = await authedFetch(`/api/tokens/${token.id}/available-auras`);
        if (resp.ok) { const d = await resp.json(); setAvailableAuras(d.available_auras || []); }
      } catch (e) { logger.error('Failed to fetch auras:', e); }
    })();
  }, [token?.id, token?.character_id, authedFetch]);

  // Debounced HP save
  const saveHP = useCallback(async (newHP: number) => {
    if (!token) return;
    setIsSavingHP(true);
    try {
      const resp = await authedFetch(`/api/tokens/${token.id}/hp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_hp: newHP, force: true }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch (e) { logger.error('HP update failed:', e); }
    finally { setIsSavingHP(false); }
  }, [token, authedFetch]);

  const handleHPChange = useCallback((value: string) => {
    setEditableHP(value);
    if (hpDebounceRef.current) clearTimeout(hpDebounceRef.current);
    const numVal = Number(value);
    if (!Number.isNaN(numVal) && numVal >= 0) {
      hpDebounceRef.current = setTimeout(() => saveHP(numVal), 800);
    }
  }, [saveHP]);

  // Temp HP save (DM force-set)
  const saveTempHP = useCallback(async (value: number) => {
    if (!token) return;
    try {
      await authedFetch(`/api/tokens/${token.id}/temp-hp`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temp_hp: value, force: true }),
      });
    } catch (e) { logger.error('Temp HP update failed:', e); }
  }, [token, authedFetch]);

  const handleTempHPChange = useCallback((value: string) => {
    setEditableTempHP(value);
    if (tempHPDebounceRef.current) clearTimeout(tempHPDebounceRef.current);
    const numVal = Number(value);
    if (!Number.isNaN(numVal) && numVal >= 0) {
      tempHPDebounceRef.current = setTimeout(() => saveTempHP(numVal), 800);
    }
  }, [saveTempHP]);

  // Toggle aura
  const toggleAura = useCallback(async (auraId: string, enabled: boolean) => {
    if (!token?.id) return;
    try {
      await authedFetch(`/api/tokens/${token.id}/toggle-aura?aura_id=${auraId}&enabled=${enabled}`, { method: 'POST' });
    } catch (e) { logger.error('Failed to toggle aura:', e); }
  }, [token?.id, authedFetch]);

  // Save action uses
  const saveActionUses = useCallback(async (actionId: number, newCurrent: number, maxUses: number) => {
    if (!token?.character_id) return;
    setIsSavingUses(true);
    try {
      await authedFetch(`/api/characters/${token.character_id}/feature-uses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_id: String(actionId),
          current_uses: newCurrent,
          max_uses: maxUses,
        }),
      });
      updateTargetSheet((prev: any) => {
        if (!prev?.actions) return prev;
        return { ...prev, actions: prev.actions.map((a: any) => a.id === actionId && a.uses ? { ...a, uses: { ...a.uses, current: newCurrent } } : a) };
      });
    } catch (e) { logger.error('Failed to save action uses:', e); }
    finally { setIsSavingUses(false); setEditingActionId(null); }
  }, [token?.character_id, authedFetch, updateTargetSheet]);

  // Save spell slots
  const saveSpellSlots = useCallback(async (slotLevel: string, newCurrent: number) => {
    if (!token?.character_id || !targetSheet) return;
    setIsSavingSlots(true);
    try {
      const currentSlots = targetSheet.character.spell_slots_state;
      let updatedSlots: number[] | Record<string, any>;
      if (Array.isArray(currentSlots)) {
        const arr = [...currentSlots]; arr[parseInt(slotLevel, 10)] = newCurrent; updatedSlots = arr;
      } else if (typeof currentSlots === 'object' && currentSlots?.slots) {
        const slots = [...(currentSlots.slots as number[])]; slots[parseInt(slotLevel, 10)] = newCurrent;
        updatedSlots = { ...currentSlots, slots };
      } else {
        const arr = [0,0,0,0,0,0,0,0,0,0]; arr[parseInt(slotLevel, 10)] = newCurrent; updatedSlots = arr;
      }
      await authedFetch(`/api/characters/${token.character_id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spell_slots_state: updatedSlots,
          broadcast_campaign_id: campaignId,
        }),
      });
      updateTargetSheet((prev: any) => prev ? { ...prev, character: { ...prev.character, spell_slots_state: updatedSlots } } : null);
    } catch (e) { logger.error('Failed to save spell slots:', e); }
    finally { setIsSavingSlots(false); setEditingSlotLevel(null); }
  }, [token?.character_id, targetSheet, authedFetch, campaignId, updateTargetSheet]);

  // Build loot items list for chest conversion
  const buildLootItems = useCallback(() => {
    if (!monsterInstance) return [];
    const items: Array<{ key: string; name: string; quantity: number; equipped?: string; source: string; raw: any }> = [];
    // Equipment items
    for (const [index, eq] of (monsterInstance.equipment || []).entries()) {
      const key = `eq_${eq.libraryItemId ?? eq.id ?? eq.name ?? index}`;
      items.push({
        key, name: eq.name_cn || eq.name || '未知物品',
        quantity: eq.quantity || 1,
        equipped: eq.equippedSlot ? '已装备' : undefined,
        source: 'equipment', raw: eq,
      });
    }
    // Inventory items
    for (const [index, inv] of (monsterInstance.inventory || []).entries()) {
      const key = `inv_${inv.libraryItemId ?? inv.id ?? inv.name ?? inv.name_cn ?? index}`;
      items.push({
        key, name: inv.name_cn || inv.name || '未知物品',
        quantity: inv.quantity || 1, source: 'inventory',
        raw: inv,
      });
    }
    return items;
  }, [monsterInstance]);

  const openChestSelector = useCallback(() => {
    const items = buildLootItems();
    setChestSelectedItems(new Set(items.map(i => i.key)));
    setChestIncludeCurrency(true);
    setShowChestSelector(true);
  }, [buildLootItems]);

  // Auto-select all loot items when monster changes
  useEffect(() => {
    if (monsterInstance) {
      const items = buildLootItems();
      if (items.length > 0) setChestSelectedItems(new Set(items.map(i => i.key)));
    }
  }, [monsterInstance?.id]);

  const toggleChestItem = useCallback((key: string) => {
    setChestSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Convert to chest with selected items
  const convertToChest = async () => {
    if (!token || !monsterInstance) return;
    const allItems = buildLootItems();
    const selected = allItems.filter(i => chestSelectedItems.has(i.key));
    if (!selected.length && !chestIncludeCurrency) { alert('请至少选择一项物品或金钱'); return; }
    setIsConvertingToChest(true);
    try {
      const selectedPayload = selected.map((i) => ({
        ...i.raw,
        quantity: i.quantity,
        source: i.source,
      }));
      const resp = await authedFetch('/api/monster-instances/convert-to-chest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token_id: token.id,
          selected_items: selectedPayload,
          include_currency: chestIncludeCurrency,
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(typeof result?.detail === 'string' ? result.detail : JSON.stringify(result?.detail || result));
      if (result.success) { setShowChestSelector(false); onClose?.(); } else { alert(result.message || '转换失败'); }
    } catch (e) {
      logger.error('Convert to chest failed:', e);
      alert(`转换失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally { setIsConvertingToChest(false); }
  };

  if (!token) return null;
  if (loading && !targetSheet && !monsterInstance) {
    return <div className="flex items-center justify-center p-8 text-slate-400">加载中...</div>;
  }

  // Build aura effects (shared between monster & character paths)
  const emittedAuras = (token.active_auras || []).filter((aura) => aura.enabled !== false).map(aura => {
    const presentation = getAuraPresentation(aura);
    return {
      id: `emit_${aura.id}`,
      name: `${presentation.name}（施放中）`,
      icon: presentation.icon,
      color: presentation.color,
      description: presentation.description,
      isAura: true,
      isEmitting: true,
      radius: aura.radius,
      duration: { persistent: true as const },
    };
  });
  const receivedAuras = auraVisuals
    .filter(av => av.affected_token_ids.includes(token.id) && av.source_token_id !== token.id)
    .map(av => {
      const presentation = getAuraPresentation(av);
      return {
        id: `recv_${av.aura_id}_${av.source_token_id}`,
        name: presentation.name,
        icon: presentation.icon,
        color: presentation.color,
        description: presentation.description,
        isAura: true,
        isReceiving: true,
        radius: av.radius,
        duration: { persistent: true as const },
      };
    });
  const allEffects = [
    ...activeEffects.filter((effect) => !effect.aura_emitter),
    ...emittedAuras,
    ...receivedAuras,
  ];

  return (
    <div className="space-y-3">
      {/* Monster Stats */}
      {monsterInstance ? (
        <MonsterStatsSection
          token={token} monsterInstance={monsterInstance} isDM={isDM}
          editableHP={editableHP} isSavingHP={isSavingHP} handleHPChange={handleHPChange}
          editableTempHP={editableTempHP} handleTempHPChange={handleTempHPChange}
          allEffects={allEffects} onRemoveEffect={onRemoveEffect}
          onEscapeAttempt={onEscapeAttempt} onOngoingSave={onOngoingSave} onConditionSave={onConditionSave} onWakeUp={onWakeUp} onStandUp={onStandUp}
          isConvertingToChest={isConvertingToChest} convertToChest={convertToChest}
          showChestSelector={showChestSelector} openChestSelector={openChestSelector}
          setShowChestSelector={setShowChestSelector}
          chestSelectedItems={chestSelectedItems} toggleChestItem={toggleChestItem}
          chestIncludeCurrency={chestIncludeCurrency} setChestIncludeCurrency={setChestIncludeCurrency}
          buildLootItems={buildLootItems} setChestSelectedItems={setChestSelectedItems}
          onActionClick={onActionClick} onActionHover={onActionHover}
        />
      ) : (
        <CharacterStatsSection
          token={token} targetSheet={targetSheet} isDM={isDM} campaignId={campaignId}
          editableHP={editableHP} isSavingHP={isSavingHP} handleHPChange={handleHPChange}
          editableTempHP={editableTempHP} handleTempHPChange={handleTempHPChange}
          allEffects={allEffects} onRemoveEffect={onRemoveEffect}
          onEscapeAttempt={onEscapeAttempt} onOngoingSave={onOngoingSave} onConditionSave={onConditionSave} onWakeUp={onWakeUp} onStandUp={onStandUp}
          availableAuras={availableAuras} toggleAura={toggleAura}
          editingSlotLevel={editingSlotLevel} setEditingSlotLevel={setEditingSlotLevel}
          editableSlotValue={editableSlotValue} setEditableSlotValue={setEditableSlotValue}
          isSavingSlots={isSavingSlots} saveSpellSlots={saveSpellSlots}
          editingActionId={editingActionId} setEditingActionId={setEditingActionId}
          editableUses={editableUses} setEditableUses={setEditableUses}
          isSavingUses={isSavingUses} saveActionUses={saveActionUses}
          authedFetch={authedFetch} setTargetSheet={updateTargetSheet}
        />
      )}

      {/* Spell Detail Sub-dialog */}
      <SpellDetailModal
        spell={spellDetail ? { ...spellDetail, id: spellDetail.name, castingTime: spellDetail.casting_time } : null}
        onClose={() => setSpellDetail(null)}
        zOverlay="z-[10200]" zContent="z-[10201]"
      />
    </div>
  );
}

/* ─── Effects Block (shared) ─── */
function EffectsBlock({ allEffects, isDM, token, onRemoveEffect, onEscapeAttempt, onOngoingSave, onConditionSave, onWakeUp, onStandUp }: {
  allEffects: any[]; isDM: boolean; token: Token;
  onRemoveEffect?: (id: string) => void;
  onEscapeAttempt?: (tid: number, eid: string) => void;
  onOngoingSave?: (tid: number, eid: string) => void;
  onConditionSave?: (tid: number, eid: string) => void;
  onWakeUp?: (tid: number, eid: string) => void;
  onStandUp?: (tid: number, eid: string) => void;
}) {
  if (allEffects.length === 0) return null;
  return (
    <div className="bg-slate-800/50 rounded-lg p-3 border border-emerald-500/30">
      <div className="text-[10px] uppercase tracking-wider text-emerald-400 mb-2 flex items-center gap-2">
        <span>✨</span><span>当前状态效果</span>
        <span className="ml-auto text-slate-500">({allEffects.length})</span>
      </div>
      <div className="space-y-2">
        {allEffects.map((effect: any) => {
          const isPersistent = typeof effect.duration === 'object' && effect.duration?.persistent;
          const effectDef = !effect.isAura ? getEffectDefinition(effect.id) : null;
          const description = effect.description || effectDef?.description;
          return (
            <div key={effect.id} className={`rounded-lg p-2.5 ${effect.isAura ? 'bg-amber-500/10 border border-amber-500/30' : isPersistent ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-blue-500/10 border border-blue-500/30'}`}
              style={effect.color ? { borderColor: `${effect.color}40`, backgroundColor: `${effect.color}10` } : {}}>
              <div className="flex items-center gap-2">
                {effect.icon && <span className="text-lg">{effect.icon}</span>}
                <span className={`font-medium ${effect.isAura ? 'text-amber-300' : isPersistent ? 'text-emerald-300' : 'text-blue-300'}`} style={effect.color ? { color: effect.color } : {}}>
                  {effect.name}
                </span>
                {effect.isAura && effect.isEmitting && <span className="text-[10px] text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded">施放中 {effect.radius}尺</span>}
                {effect.isAura && effect.isReceiving && <span className="text-[10px] text-cyan-400 bg-cyan-500/20 px-1.5 py-0.5 rounded">受益</span>}
                {!effect.isAura && isPersistent && <span className="text-[10px] text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded">持久</span>}
                {typeof effect.duration === 'number' && <span className="text-[10px] text-slate-400 bg-slate-700/50 px-1.5 py-0.5 rounded">{effect.duration}{effect.duration_unit === 'day' ? '日' : '回合'}</span>}
                {isDM && onRemoveEffect && !effect.isAura && (
                  <button className="ml-auto w-5 h-5 flex items-center justify-center rounded-full bg-red-500/30 hover:bg-red-500/50 text-red-300 text-xs transition-colors"
                    onClick={() => onRemoveEffect(effect.id)} title="移除此效果">✕</button>
                )}
              </div>
              {description && <div className="mt-1.5 text-xs text-slate-400 leading-relaxed pl-7">{description}</div>}
              {effect.source && <div className="mt-1 text-xs text-slate-500 pl-7">来源：{effect.source}</div>}
              {effect.escapeHint && <div className="mt-1 text-xs text-amber-400 leading-relaxed pl-7 flex items-center gap-1"><span>💡</span><span>{effect.escapeHint}</span></div>}
              {isDM && (
                <div className="mt-2 pl-7 flex flex-wrap gap-2">
                  {effect.escape_action && onEscapeAttempt && <button className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded flex items-center gap-1" onClick={() => onEscapeAttempt(token.id, effect.id)}>🎲 尝试挣脱</button>}
                  {effect.ongoing_save && onOngoingSave && <button className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded flex items-center gap-1" onClick={() => { onOngoingSave(token.id, effect.id); }}>🎲 回合豁免</button>}
                  {effect.condition && !effect.escape_action && !effect.ongoing_save && onConditionSave && (
                    <button className="px-2 py-1 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded flex items-center gap-1" onClick={() => { onConditionSave(token.id, effect.id); }}>🎲 豁免</button>
                  )}
                  {effect.break_conditions?.includes('shaken') && onWakeUp && <button className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded flex items-center gap-1" onClick={() => onWakeUp(token.id, effect.id)}>👋 摇醒</button>}
                </div>
              )}
              {effect.condition === 'prone' && onStandUp && (
                <div className={`${isDM ? '' : 'mt-2'} pl-7 flex flex-wrap gap-2`}>
                  <button className="px-2 py-1 text-xs bg-teal-600 hover:bg-teal-500 text-white rounded flex items-center gap-1" onClick={() => onStandUp(token.id, effect.id)}>🦶 站起来</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Action Card with structured fields ─── */
const DAMAGE_TYPE_CN: Record<string, string> = {
  slashing: '挥砍', piercing: '穿刺', bludgeoning: '钝击',
  fire: '火焰', cold: '寒冷', lightning: '闪电',
  thunder: '雷鸣', acid: '强酸', poison: '毒素',
  necrotic: '黯蚀', radiant: '光辉', force: '力场', psychic: '心灵',
};
const DAMAGE_TYPE_REV: Record<string, string> = Object.fromEntries(
  Object.entries(DAMAGE_TYPE_CN).map(([k, v]) => [v, k])
);
const ABILITY_CN: Record<string, string> = {
  str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力',
};
const ABILITY_REV: Record<string, string> = Object.fromEntries(
  Object.entries(ABILITY_CN).map(([k, v]) => [v, k])
);
const ACTION_CATEGORY_STYLE: Record<string, { label: string; cls: string }> = {
  weapon_attack: { label: '武器攻击', cls: 'bg-red-900/40 text-red-400 border-red-800/40' },
  special_attack: { label: '特殊攻击', cls: 'bg-cyan-900/40 text-cyan-400 border-cyan-800/40' },
  multiattack: { label: '多重攻击', cls: 'bg-purple-900/40 text-purple-400 border-purple-800/40' },
  spell: { label: '法术', cls: 'bg-indigo-900/40 text-indigo-400 border-indigo-800/40' },
  other: { label: '其他', cls: 'bg-slate-800/40 text-slate-400 border-slate-700/40' },
};
// Legacy ACTION_TYPE_STYLE for backward compat with old data
const ACTION_TYPE_STYLE: Record<string, { label: string; cls: string }> = {
  melee: { label: '近战', cls: 'bg-red-900/40 text-red-400 border-red-800/40' },
  ranged: { label: '远程', cls: 'bg-blue-900/40 text-blue-400 border-blue-800/40' },
  multiattack: { label: '多重攻击', cls: 'bg-purple-900/40 text-purple-400 border-purple-800/40' },
  ability: { label: '特殊', cls: 'bg-cyan-900/40 text-cyan-400 border-cyan-800/40' },
};

/** 从中文 description 中解析结构化字段（fallback） */
function parseActionFromDesc(desc: string, name: string) {
  const result: {
    actionType?: string; attackBonus?: number; reach?: number;
    range?: { normal: number; long?: number };
    damage?: { dice: string; avg?: number; type: string }[];
    dc?: { value: number; ability: string };
  } = {};

  // actionType
  if (/多重攻击|Multiattack/i.test(name)) {
    result.actionType = 'multiattack';
    return result;
  }
  if (/近战武器攻击|近战法术攻击/.test(desc)) result.actionType = 'melee';
  else if (/远程武器攻击|远程法术攻击/.test(desc)) result.actionType = 'ranged';
  else if (/DC\s*\d+/.test(desc) && !/[+＋]\d+\s*命中/.test(desc)) result.actionType = 'ability';

  // attackBonus
  const bonusM = desc.match(/(?:命中[加值]*\s*)?[+＋](\d+)\s*命中|命中\s*[+＋](\d+)/);
  if (bonusM) result.attackBonus = parseInt(bonusM[1] || bonusM[2]);

  // reach
  const reachM = desc.match(/触及\s*(\d+)\s*尺|范围\s*(\d+)\s*尺/);
  if (reachM) result.reach = parseInt(reachM[1] || reachM[2]);

  // range
  const rangeM = desc.match(/射程\s*(\d+)\s*[/／]\s*(\d+)\s*尺/);
  if (rangeM) result.range = { normal: parseInt(rangeM[1]), long: parseInt(rangeM[2]) };

  // damage — "12（2d6+5）点钝击伤害" or "2d6+3穿刺伤害"
  const dmgTypes = '钝击|穿刺|挥砍|火焰|寒冷|闪电|雷鸣|强酸|毒素|黯蚀|光辉|力场|心灵';
  const dmgRe1 = new RegExp(`(\\d+)\\s*[（(]\\s*(\\d+d\\d+\\s*[+＋-]?\\s*\\d*)\\s*[)）]\\s*点?\\s*(${dmgTypes})\\s*伤害`, 'g');
  const dmgRe2 = new RegExp(`(\\d+d\\d+\\s*[+＋-]?\\s*\\d*)\\s*点?\\s*(${dmgTypes})\\s*伤害`, 'g');
  const damages: { dice: string; avg?: number; type: string }[] = [];
  let m;
  while ((m = dmgRe1.exec(desc)) !== null) {
    const dice = m[2].replace(/\s+/g, '').replace('＋', '+');
    damages.push({ dice, avg: parseInt(m[1]), type: DAMAGE_TYPE_REV[m[3]] || m[3] });
  }
  if (damages.length === 0) {
    while ((m = dmgRe2.exec(desc)) !== null) {
      const dice = m[1].replace(/\s+/g, '').replace('＋', '+');
      damages.push({ dice, type: DAMAGE_TYPE_REV[m[2]] || m[2] });
    }
  }
  if (damages.length > 0) result.damage = damages;

  // dc
  const dcM = desc.match(/DC\s*(\d+)\s*(?:的?\s*)?(力量|敏捷|体质|智力|感知|魅力)/);
  if (dcM) result.dc = { value: parseInt(dcM[1]), ability: ABILITY_REV[dcM[2]] || dcM[2] };

  return result;
}

/** 格式化伤害类型显示（兼容中英文） */
function formatDamageType(t: string | undefined): string {
  if (!t) return '';
  return DAMAGE_TYPE_CN[t] || t; // 已是中文则直接返回
}

/** CR → 熟练加值 (D&D 5E) */
function profBonusFromCR(cr: number | string | undefined): number {
  const n = typeof cr === 'string' ? (cr.includes('/') ? 0.5 : parseFloat(cr)) : (cr ?? 0);
  if (n < 5) return 2;
  if (n < 9) return 3;
  if (n < 13) return 4;
  if (n < 17) return 5;
  if (n < 21) return 6;
  if (n < 25) return 7;
  if (n < 29) return 8;
  return 9;
}

/** 从已装备武器生成 ActionSchema 格式的武器攻击动作 */
function generateEquipmentWeaponActions(
  equipment: any[] | undefined,
  abilityScores: Record<string, number> | undefined,
  cr: number | string | undefined,
): any[] {
  if (!equipment?.length || !abilityScores) return [];
  const mod = (score: number) => Math.floor((score - 10) / 2);
  const strMod = mod(abilityScores.strength ?? 10);
  const dexMod = mod(abilityScores.dexterity ?? 10);
  const prof = profBonusFromCR(cr);

  const actions: any[] = [];
  for (const item of equipment) {
    const slot = item.equippedSlot;
    if (slot !== 'main_hand' && slot !== 'off_hand') continue;
    if (item.equipmentType !== 'weapon' && !item.damage) continue;

    const props: string[] = item.properties || item.weapon?.properties || [];
    const isAmmunition = props.includes('ammunition');
    const isFinesse = props.includes('finesse');
    const isThrown = props.includes('thrown');
    const isVersatile = props.includes('versatile');

    // 决定使用哪个属性调整值
    let abilityMod: number;
    if (isFinesse) abilityMod = Math.max(strMod, dexMod);
    else if (isAmmunition) abilityMod = dexMod;
    else abilityMod = strMod;

    const attackBonus = abilityMod + prof;

    // 伤害骰
    const rawDmg = item.damage || item.weapon?.damage;
    const dmgDice = typeof rawDmg === 'string' ? rawDmg : rawDmg?.dice || '1d4';
    const versatileDmg = item.versatileDamage || item.weapon?.versatileDamage;
    const useTwoHand = isVersatile && item.gripMode === 'two-hand' && versatileDmg;
    const finalDice = useTwoHand ? versatileDmg : dmgDice;

    const dmgType = item.damageType || item.weapon?.damageType || 'bludgeoning';
    const avg = computeDiceAvg(finalDice, abilityMod);

    // 攻击类型 & 触及/射程
    const isMelee = !isAmmunition;
    const attackType = isAmmunition ? 'ranged' : 'melee';
    const reach = isMelee ? '5尺' : undefined;
    const range = (isAmmunition || isThrown) && item.range
      ? (typeof item.range === 'string' ? item.range
        : `${item.range.normal}/${item.range.long || item.range.normal}尺`)
      : undefined;

    const desc = `${isMelee ? '近战' : '远程'}武器攻击：+${attackBonus} 命中，${reach ? `触及${reach}` : ''}${range ? `射程 ${range}` : ''}，单一目标。命中：${avg}(${finalDice}${abilityMod >= 0 ? '+' : ''}${abilityMod}) ${formatDamageType(dmgType)}伤害。${useTwoHand ? '（双手）' : ''}`;

    actions.push({
      name: item.name,
      description: desc,
      action_category: 'weapon_attack',
      attack_type: attackType,
      attack_bonus: attackBonus,
      reach,
      range: (isAmmunition || isThrown) && item.range && typeof item.range === 'object'
        ? item.range : undefined,
      damage: { dice: finalDice, bonus: abilityMod, average: avg, type: dmgType },
      _fromEquipment: true,
    });
  }
  return actions;
}

/** 简易骰子平均值计算: "XdY" → X*(Y+1)/2 + bonus */
function computeDiceAvg(dice: string, bonus: number): number {
  const m = dice.match(/(\d+)d(\d+)/);
  if (!m) return bonus;
  return Math.floor(parseInt(m[1]) * (parseInt(m[2]) + 1) / 2) + bonus;
}

function ActionCard({ action, onActionClick, onActionHover }: {
  action: any;
  onActionClick?: (action: any) => void;
  onActionHover?: (action: any | null) => void;
}) {
  // Prefer ActionSchema fields (snake_case), fallback to legacy or description parsing
  const parsed = (!action.action_category && !action.actionType && action.description)
    ? parseActionFromDesc(action.description, action.name) : null;

  // action_category (new) or actionType (legacy)
  const cat = action.action_category;
  const legacyType = action.actionType || parsed?.actionType;
  const style = cat ? ACTION_CATEGORY_STYLE[cat] : (legacyType ? ACTION_TYPE_STYLE[legacyType] : null);
  const isAttackType = cat === 'weapon_attack' || cat === 'special_attack'
    || (legacyType && legacyType !== 'multiattack');

  // attack_bonus
  const attackBonus = action.attack_bonus ?? action.attackBonus ?? parsed?.attackBonus;

  // reach/range (ActionSchema uses string like "5尺", legacy uses number)
  const reach = action.reach ?? parsed?.reach;
  const range = action.range ?? parsed?.range;

  // damage — ActionSchema: object {dice, bonus, average, type}; legacy: array [{dice, avg, type}]
  const dmgObj = (action.damage && !Array.isArray(action.damage)) ? action.damage : null;
  const dmgArr = Array.isArray(action.damage) ? action.damage : parsed?.damage;
  const extraDmg = action.extra_damage;

  // save (ActionSchema) or dc (legacy)
  const save = action.save;
  const dc = action.dc ?? parsed?.dc;

  const hasStats = (isAttackType || cat === 'special_attack')
    && (attackBonus != null || dmgObj || dmgArr?.length || save || dc);
  const canAttack = onActionClick && hasStats;

  return (
    <div
      className={`bg-slate-900/50 rounded-lg p-3 border border-slate-700/20 ${canAttack ? 'hover:border-amber-500/40 transition-colors' : ''}`}
      onPointerEnter={() => onActionHover?.(action)}
      onPointerLeave={() => onActionHover?.(null)}
    >
      {/* Name + type tag + attack button */}
      <div className="flex items-center gap-2">
        <div className="text-white font-medium text-sm flex-1">{cleanLatex(action.name)}</div>
        {action._fromEquipment && (
          <span className="px-1.5 py-0.5 rounded text-[10px] border bg-emerald-900/40 text-emerald-400 border-emerald-800/40">
            🗡️装备
          </span>
        )}
        {style && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] border ${style.cls}`}>
            {style.label}
          </span>
        )}
        {canAttack && (
          <button
            onClick={(e) => { e.stopPropagation(); onActionClick(action); }}
            className="px-1.5 py-0.5 rounded text-[10px] bg-amber-900/40 border border-amber-500/30 text-amber-300 hover:bg-amber-800/50 hover:text-amber-200 transition-colors"
            title="点击选择目标发起攻击"
          >
            {(action.attack_type === 'ranged' || legacyType === 'ranged') ? '🏹' : '⚔️'} 攻击
          </button>
        )}
      </div>

      {/* Structured stats */}
      {hasStats && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs">
          {attackBonus != null && (
            <span className="text-emerald-400 font-medium">+{attackBonus} 命中</span>
          )}
          {reach && (
            <span className="text-slate-400">
              {typeof reach === 'number' ? `触及 ${reach}尺` : `触及 ${reach}`}
            </span>
          )}
          {range && (
            <span className="text-slate-400">
              {typeof range === 'string' ? `射程 ${range}`
                : `射程 ${range.normal}${range.long ? `/${range.long}` : ''}尺`}
            </span>
          )}
          {/* ActionSchema damage object */}
          {dmgObj && (
            <span className="text-red-400 font-medium">
              {dmgObj.average ? `${dmgObj.average}(${dmgObj.dice}${dmgObj.bonus ? `+${dmgObj.bonus}` : ''})` : `${dmgObj.dice}${dmgObj.bonus ? `+${dmgObj.bonus}` : ''}`}
              {' '}{formatDamageType(dmgObj.type)}
            </span>
          )}
          {/* ActionSchema extra_damage */}
          {extraDmg && (
            <span className="text-red-400 font-medium">
              + {extraDmg.dice} {formatDamageType(extraDmg.type)}
            </span>
          )}
          {/* Legacy damage array (from description parsing) */}
          {!dmgObj && dmgArr?.map((d: any, i: number) => (
            <span key={i} className="text-red-400 font-medium">
              {i > 0 && '+ '}{d.avg ? `${d.avg}(${d.dice})` : d.dice} {formatDamageType(d.type)}
            </span>
          ))}
          {/* ActionSchema save */}
          {save && (
            <span className="text-yellow-400">
              DC {save.dc} {save.ability}
            </span>
          )}
          {/* Legacy dc */}
          {!save && dc && (
            <span className="text-yellow-400">
              DC {dc.value} {ABILITY_CN[dc.ability] || dc.ability}
            </span>
          )}
        </div>
      )}

      {/* Description */}
      <div className="text-xs text-slate-400 mt-1.5 leading-relaxed">{cleanLatex(action.description)}</div>
    </div>
  );
}

/* ─── Monster Stats ─── */
function MonsterStatsSection({ token, monsterInstance, isDM, editableHP, isSavingHP, handleHPChange, editableTempHP, handleTempHPChange, allEffects, onRemoveEffect, onEscapeAttempt, onOngoingSave, onConditionSave, onWakeUp, onStandUp, isConvertingToChest, convertToChest, showChestSelector, openChestSelector, setShowChestSelector, chestSelectedItems, toggleChestItem, chestIncludeCurrency, setChestIncludeCurrency, buildLootItems, setChestSelectedItems, onActionClick, onActionHover }: any) {
  // --- Status effect calculations (mirrors ClassicCharacterCard logic) ---
  const saved = monsterInstance?.status_effects as any;

  // Merge native actions + equipment weapon actions
  const allActions = useMemo(() => {
    const native = monsterInstance?.monster_data?.actions || [];
    const equipActions = generateEquipmentWeaponActions(
      monsterInstance?.equipment,
      monsterInstance?.ability_scores,
      monsterInstance?.challenge_rating ?? monsterInstance?.monster_data?.challengeRating,
    );
    // 过滤掉与原生动作同名的装备动作（避免重复）
    const nativeNames = new Set(native.map((a: any) => a.name));
    const deduped = equipActions.filter(a => !nativeNames.has(a.name));
    return deduped.length ? [...native, ...deduped] : native;
  }, [monsterInstance?.monster_data?.actions, monsterInstance?.equipment, monsterInstance?.ability_scores, monsterInstance?.challenge_rating]);
  const customEffects: Array<{ modifiers: Array<{ type: string; param: string; value: number }> }> = saved?.effects || [];
  const activeConditions: Array<{ condition: string }> = saved?.conditions || [];
  const exhaustionLevel: number = saved?.exhaustion_level ?? 0;

  const getEffectMod = (param: string) => {
    let total = 0;
    for (const e of customEffects) {
      for (const m of e.modifiers) {
        if (m.type === 'advantage' || m.type === 'disadvantage') continue;
        if (m.param === param) total += m.value;
        if (m.param === 'all_saves' && param.endsWith('_save')) total += m.value;
        if (m.param === 'all_checks' && !['ac','hp_max','attack','damage','speed','initiative'].includes(param) && !param.endsWith('_save')) total += m.value;
      }
    }
    return total;
  };

  const activeConditionTypes = activeConditions.map(c => c.condition);
  const speedZeroConditions = ['paralyzed', 'petrified', 'unconscious', 'grappled', 'restrained', 'stunned'];
  const isSpeedZero = exhaustionLevel >= 5 || speedZeroConditions.some(c => activeConditionTypes.includes(c));
  const isProne = activeConditionTypes.includes('prone');
  const isSpeedHalved = !isSpeedZero && (exhaustionLevel >= 2 || isProne);
  const isHPHalved = exhaustionLevel >= 4;
  const applySpeedEffects = (base: number) => isSpeedZero ? 0 : isSpeedHalved ? Math.floor(base / 2) : base;
  const applyHPMaxEffects = (base: number) => isHPHalved ? Math.floor(base / 2) : base;
  const modColor = (mod: number) => mod > 0 ? 'text-green-400' : mod < 0 ? 'text-red-400' : 'text-white';

  const acMod = getEffectMod('ac');
  // Compute AC from equipped armor (if any)
  const armorInfo = useMemo(() => {
    const equipment = monsterInstance?.equipment || [];
    const armor = equipment.find((it: any) => it?.equippedSlot === 'armor');
    if (!armor) return null;
    const armorACTable: Record<string, { base: number; dexBonus?: boolean; maxDexBonus?: number }> = {
      padded: { base: 11, dexBonus: true },
      leather: { base: 11, dexBonus: true },
      studded_leather: { base: 12, dexBonus: true },
      hide: { base: 12, dexBonus: true, maxDexBonus: 2 },
      chain_shirt: { base: 13, dexBonus: true, maxDexBonus: 2 },
      scale_mail: { base: 14, dexBonus: true, maxDexBonus: 2 },
      breastplate: { base: 14, dexBonus: true, maxDexBonus: 2 },
      half_plate: { base: 15, dexBonus: true, maxDexBonus: 2 },
      ring_mail: { base: 14 },
      chain_mail: { base: 16 },
      splint: { base: 17 },
      plate: { base: 18 },
    };
    const a = armorACTable[armor.id];
    if (!a) return { name: armor.name || armor.id, ac: 0, detail: '' };
    const dexScore = monsterInstance?.ability_scores?.dexterity ?? 10;
    const dexMod = Math.floor((dexScore - 10) / 2);
    let ac = a.base;
    let detail = `${a.base}`;
    if (a.dexBonus) {
      const dexAdded = Math.min(dexMod, a.maxDexBonus ?? Infinity);
      ac += dexAdded;
      detail += `${dexAdded >= 0 ? '+' : ''}${dexAdded}DEX`;
    }
    const shield = equipment.find((it: any) => it?.equippedSlot === 'off_hand' && it.id === 'shield');
    if (shield) { ac += 2; detail += '+2盾'; }
    return { name: armor.name || armor.id, ac, detail };
  }, [monsterInstance?.equipment, monsterInstance?.ability_scores]);
  const equipmentAC = armorInfo?.ac ?? 0;
  const baseAC = monsterInstance.armor_class ?? 0;
  const effectiveAC = equipmentAC > 0 ? Math.max(baseAC, equipmentAC) : baseAC;
  const hpMaxMod = getEffectMod('hp_max');
  const baseHP = monsterInstance.hit_points ?? 0;
  const finalHPMax = applyHPMaxEffects(baseHP + hpMaxMod);
  const hpChanged = finalHPMax !== baseHP;

  return (
    <>
      {/* Summary grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className={`bg-slate-800/50 rounded-lg p-3 border ${isDM ? 'border-amber-500/30 cursor-text' : 'border-slate-700/30'} ${hpChanged ? 'border-red-500/30' : ''}`}>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">HP{isHPHalved ? ' ½' : ''} {isSavingHP && <span className="text-amber-400 animate-pulse">保存中...</span>}</div>
          {isDM ? (
            <div className="flex items-baseline flex-wrap gap-x-1">
              <input type="number" value={editableHP} onChange={(e) => handleHPChange(e.target.value)}
                className="w-12 bg-transparent text-lg font-bold text-white border-b border-amber-500/50 focus:outline-none focus:border-amber-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              <span className={`font-normal text-sm ${hpChanged ? 'text-red-400' : 'text-slate-500'}`}>/{finalHPMax}</span>
              <span className="text-amber-400 font-bold text-sm ml-1">+</span>
              <input type="number" value={editableTempHP} onChange={(e) => handleTempHPChange(e.target.value)}
                placeholder="0"
                className="w-8 bg-transparent text-sm font-bold text-amber-400 border-b border-amber-500/50 focus:outline-none focus:border-amber-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              <span className="text-amber-400/70 text-xs">临时</span>
            </div>
          ) : (
            <div className="text-lg font-bold text-white">{token?.current_hp ?? monsterInstance.current_hp ?? '-'}<span className={`font-normal text-sm ${hpChanged ? 'text-red-400' : 'text-slate-500'}`}>/{finalHPMax}</span>
              {token?.temp_hp != null && token.temp_hp > 0 && (
                <span className="text-amber-400 font-bold text-sm ml-1">+{token.temp_hp} 临时</span>
              )}
            </div>
          )}
        </div>
        <div className={`bg-slate-800/50 rounded-lg p-3 border ${armorInfo ? (equipmentAC > baseAC ? 'border-green-500/40' : 'border-amber-500/30') : 'border-slate-700/30'}`}>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">AC</div>
          <div className={`text-lg font-bold ${modColor(acMod + (equipmentAC > baseAC ? equipmentAC - baseAC : 0))}`}>{effectiveAC + acMod || '-'}</div>
          {armorInfo && (
            <div className={`text-[10px] mt-1 ${equipmentAC > baseAC ? 'text-green-400' : equipmentAC < baseAC ? 'text-amber-400' : 'text-slate-400'}`}>
              {equipmentAC > baseAC
                ? `${armorInfo.name}(${armorInfo.detail}=${equipmentAC}) > 天生${baseAC}`
                : equipmentAC < baseAC
                  ? `${armorInfo.name}(${armorInfo.detail}=${equipmentAC}) < 天生${baseAC}，取高`
                  : `${armorInfo.name}(${armorInfo.detail}=${equipmentAC}) = 天生${baseAC}`}
            </div>
          )}
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">挑战等级</div>
          <div className="text-lg font-bold text-white">{monsterInstance.challenge_rating ?? '-'}</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">类型</div>
          <div className="text-sm font-medium text-white truncate">{monsterInstance.size ?? ''} {monsterInstance.type ?? '-'}</div>
        </div>
      </div>

      {/* Effects */}
      <EffectsBlock allEffects={allEffects} isDM={isDM} token={token} onRemoveEffect={onRemoveEffect} onEscapeAttempt={onEscapeAttempt} onOngoingSave={onOngoingSave} onConditionSave={onConditionSave} onWakeUp={onWakeUp} onStandUp={onStandUp} />

      {/* Speeds */}
      {monsterInstance.speeds && Object.keys(monsterInstance.speeds).length > 0 && (
        <div className={`bg-slate-800/50 rounded-lg p-3 border ${(isSpeedZero || isSpeedHalved) ? 'border-red-500/30' : 'border-slate-700/30'}`}>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">速度{isSpeedZero ? ' ⛔' : isSpeedHalved ? ' ½' : ''}</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(monsterInstance.speeds).map(([type, speed]) => {
              const finalSpeed = applySpeedEffects((speed as number) + getEffectMod('speed'));
              const speedChanged = finalSpeed !== (speed as number);
              return (
                <span key={type} className={`inline-flex items-center gap-1 bg-slate-700/50 px-2 py-1 rounded text-sm ${speedChanged ? (finalSpeed < (speed as number) ? 'text-red-400' : 'text-green-400') : 'text-white'}`}>
                  <span className="text-slate-400">{type === 'walk' ? '🚶' : type === 'fly' ? '🦅' : type === 'swim' ? '🏊' : type === 'climb' ? '🧗' : type === 'burrow' ? '🕳️' : '•'}</span>
                  {finalSpeed}尺
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Ability Scores */}
      {monsterInstance.ability_scores && (
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">属性值</div>
          <div className="grid grid-cols-6 gap-1.5">
            {(['str','dex','con','int','wis','cha'] as const).map(attr => {
              const baseVal = monsterInstance.ability_scores[attr];
              const eMod = getEffectMod(attr);
              const val = baseVal ? baseVal + eMod : baseVal;
              const mod = val ? Math.floor((val - 10) / 2) : 0;
              return (
                <div key={attr} className="bg-slate-700/50 rounded-lg p-2 text-center">
                  <div className="text-[10px] uppercase text-slate-400">{attr === 'str' ? '力量' : attr === 'dex' ? '敏捷' : attr === 'con' ? '体质' : attr === 'int' ? '智力' : attr === 'wis' ? '感知' : '魅力'}</div>
                  <div className={`text-lg font-bold ${modColor(eMod)}`}>{val ?? '-'}</div>
                  <div className={`text-xs ${eMod !== 0 ? modColor(eMod) : 'text-amber-400'}`}>{mod >= 0 ? `+${mod}` : mod}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Special Abilities */}
      {monsterInstance.monster_data?.special_abilities?.length > 0 && (
        <details className="group bg-slate-800/50 rounded-lg border border-slate-700/30 overflow-hidden">
          <summary className="cursor-pointer px-4 py-2.5 text-amber-400 font-medium flex items-center gap-2 hover:bg-slate-700/30 transition-colors">
            <span className="text-xs transition-transform group-open:rotate-90">▶</span>特殊能力
          </summary>
          <div className="p-3 pt-0 space-y-2">
            {monsterInstance.monster_data.special_abilities.map((ability: any, idx: number) => (
              <div key={idx} className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/20">
                <div className="text-white font-medium text-sm">{cleanLatex(ability.name)}</div>
                <div className="text-xs text-slate-400 mt-1 leading-relaxed">{cleanLatex(ability.description)}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Actions */}
      {allActions.length > 0 && (
        <details open className="group bg-slate-800/50 rounded-lg border border-slate-700/30 overflow-hidden">
          <summary className="cursor-pointer px-4 py-2.5 text-amber-400 font-medium flex items-center gap-2 hover:bg-slate-700/30 transition-colors">
            <span className="text-xs transition-transform group-open:rotate-90">▶</span>动作
          </summary>
          <div className="p-3 pt-0 space-y-2">
            {allActions.map((action: any, idx: number) => (
              <ActionCard key={idx} action={action} onActionClick={onActionClick} onActionHover={onActionHover} />
            ))}
          </div>
        </details>
      )}

      {/* Legendary Actions */}
      {monsterInstance.monster_data?.legendary_actions?.length > 0 && (
        <details className="group bg-slate-800/50 rounded-lg border border-slate-700/30 overflow-hidden">
          <summary className="cursor-pointer px-4 py-2.5 text-yellow-400 font-medium flex items-center gap-2 hover:bg-slate-700/30 transition-colors">
            <span className="text-xs transition-transform group-open:rotate-90">▶</span>传奇动作
          </summary>
          <div className="p-3 pt-0 space-y-2">
            {monsterInstance.monster_data.legendary_actions.map((action: any, idx: number) => (
              <ActionCard key={idx} action={action} onActionClick={onActionClick} onActionHover={onActionHover} />
            ))}
          </div>
        </details>
      )}

      {/* Description */}
      {monsterInstance.monster_data?.description && (
        <details className="group bg-slate-800/50 rounded-lg border border-slate-700/30 overflow-hidden">
          <summary className="cursor-pointer px-4 py-2.5 text-amber-400 font-medium flex items-center gap-2 hover:bg-slate-700/30 transition-colors">
            <span className="text-xs transition-transform group-open:rotate-90">▶</span>描述
          </summary>
          <div className="p-4 pt-0 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{monsterInstance.monster_data.description}</div>
        </details>
      )}

      {/* Convert to Chest */}
      {isDM && (monsterInstance.inventory?.length > 0 || monsterInstance.equipment?.length > 0 || (monsterInstance.currency && Object.values(monsterInstance.currency).some((v: any) => v > 0))) && (
        <div className="bg-amber-500/10 rounded-lg p-3 border border-amber-500/30">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-amber-400 flex items-center gap-2"><span>📦</span> 战利品</div>
              <div className="text-xs text-slate-400 mt-1">
                {(monsterInstance.equipment?.length || 0) + (monsterInstance.inventory?.length || 0)} 件物品
                {monsterInstance.currency && Object.entries(monsterInstance.currency).filter(([_, v]) => v as number > 0).map(([k, v]) => ` · ${v}${k}`).join('')}
              </div>
            </div>
            {!showChestSelector && (
              <button onClick={openChestSelector} disabled={isConvertingToChest}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 disabled:opacity-50">
                转为宝箱
              </button>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            ⚠️ 转化后怪物token将被替换为宝箱，仅在怪物死亡后使用。此操作不可撤销，请谨慎操作。
          </div>

          {/* Selection panel */}
          {showChestSelector && (() => {
            const lootItems = buildLootItems();
            return (
              <div className="mt-3 space-y-2">
                {/* Select all / none */}
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <button onClick={() => setChestSelectedItems(new Set(lootItems.map((i: any) => i.key)))}
                    className="hover:text-amber-300 transition-colors">全选</button>
                  <button onClick={() => setChestSelectedItems(new Set())}
                    className="hover:text-amber-300 transition-colors">全不选</button>
                </div>

                {/* Item list */}
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {lootItems.map((item: any) => (
                    <label key={item.key}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-700/40 cursor-pointer transition-colors">
                      <input type="checkbox" checked={chestSelectedItems.has(item.key)}
                        onChange={() => toggleChestItem(item.key)}
                        className="rounded border-slate-600 text-amber-500 focus:ring-amber-500/30 bg-slate-800" />
                      <span className="text-sm text-slate-200 truncate flex-1">{item.name}</span>
                      {item.quantity > 1 && <span className="text-xs text-slate-500">×{item.quantity}</span>}
                      {item.equipped && <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-300">{item.equipped}</span>}
                      <span className="text-[10px] text-slate-600">{item.source === 'equipment' ? '装备' : '战利品'}</span>
                    </label>
                  ))}
                </div>

                {/* Currency checkbox */}
                {monsterInstance.currency && Object.values(monsterInstance.currency).some((v: any) => v > 0) && (
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-700/40 cursor-pointer transition-colors">
                    <input type="checkbox" checked={chestIncludeCurrency}
                      onChange={() => setChestIncludeCurrency(!chestIncludeCurrency)}
                      className="rounded border-slate-600 text-amber-500 focus:ring-amber-500/30 bg-slate-800" />
                    <span className="text-sm text-amber-300">💰 金钱</span>
                    <span className="text-xs text-slate-400">
                      {Object.entries(monsterInstance.currency).filter(([_, v]) => v as number > 0).map(([k, v]) => `${v}${k}`).join(' · ')}
                    </span>
                  </label>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={convertToChest} disabled={isConvertingToChest}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 disabled:opacity-50">
                    {isConvertingToChest ? '转换中...' : '确认转换'}
                  </button>
                  <button onClick={() => setShowChestSelector(false)} disabled={isConvertingToChest}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all bg-slate-700/50 hover:bg-slate-700/80 text-slate-300 disabled:opacity-50">
                    取消
                  </button>
                  <span className="text-xs text-slate-500 ml-auto">{chestSelectedItems.size} 项已选</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
}

/* ─── Character Stats ─── */
function CharacterStatsSection({ token, targetSheet, isDM, campaignId, editableHP, isSavingHP, handleHPChange, editableTempHP, handleTempHPChange, allEffects, onRemoveEffect, onEscapeAttempt, onOngoingSave, onConditionSave, onWakeUp, onStandUp, availableAuras, toggleAura, editingSlotLevel, setEditingSlotLevel, editableSlotValue, setEditableSlotValue, isSavingSlots, saveSpellSlots, editingActionId, setEditingActionId, editableUses, setEditableUses, isSavingUses, saveActionUses, authedFetch, setTargetSheet }: any) {
  return (
    <>
      {/* Summary grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className={`bg-slate-800/50 rounded-lg p-3 border ${isDM ? 'border-amber-500/30 cursor-text' : 'border-slate-700/30'}`}>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">HP {isSavingHP && <span className="text-amber-400 animate-pulse">保存中...</span>}</div>
          {isDM ? (
            <div className="flex items-baseline flex-wrap gap-x-1">
              <input type="number" value={editableHP} onChange={(e: any) => handleHPChange(e.target.value)}
                className="w-12 bg-transparent text-lg font-bold text-white border-b border-amber-500/50 focus:outline-none focus:border-amber-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              <span className="text-slate-500 font-normal text-sm">/{token?.max_hp ?? '-'}</span>
              <span className="text-amber-400 font-bold text-sm ml-1">+</span>
              <input type="number" value={editableTempHP} onChange={(e: any) => handleTempHPChange(e.target.value)}
                placeholder="0"
                className="w-8 bg-transparent text-sm font-bold text-amber-400 border-b border-amber-500/50 focus:outline-none focus:border-amber-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              <span className="text-amber-400/70 text-xs">临时</span>
            </div>
          ) : (
            <div className="text-lg font-bold text-white">{token?.current_hp ?? '-'}<span className="text-slate-500 font-normal text-sm">/{token?.max_hp ?? '-'}</span>
              {token?.temp_hp != null && token.temp_hp > 0 && (
                <span className="text-amber-400 font-bold text-sm ml-1">+{token.temp_hp} 临时</span>
              )}
            </div>
          )}
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">AC</div>
          <div className="text-lg font-bold text-white">{targetSheet?.character.armor_class ?? '-'}</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">等级</div>
          <div className="text-lg font-bold text-white">{targetSheet?.character.level ?? '-'}</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">职业</div>
          <div className="text-sm font-medium text-white truncate">{(targetSheet?.character as any)?.class ?? '-'}</div>
        </div>
      </div>

      {/* Wild Shape */}
      {token?.transformation_data && <WildShapeBlock data={token.transformation_data} />}

      {/* Effects */}
      <EffectsBlock allEffects={allEffects} isDM={isDM} token={token} onRemoveEffect={onRemoveEffect} onEscapeAttempt={onEscapeAttempt} onOngoingSave={onOngoingSave} onConditionSave={onConditionSave} onWakeUp={onWakeUp} onStandUp={onStandUp} />

      {/* Available Auras */}
      {availableAuras.length > 0 && (
        <div className="bg-slate-800/50 rounded-lg p-3 border border-amber-500/30">
          <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-2 flex items-center gap-2">
            <span>🛡️</span><span>光环</span>
            <span className="ml-auto text-slate-500">({availableAuras.length})</span>
          </div>
          <div className="space-y-2">
            {availableAuras.map((aura: any) => {
              const isActive = token?.active_auras?.some((a: any) => a.id === aura.id);
              return (
                <div key={aura.id} className={`rounded-lg p-2.5 flex items-center gap-2 transition-colors ${isActive ? 'bg-amber-500/20 border border-amber-500/50' : 'bg-slate-700/30 border border-slate-700/50 hover:bg-slate-700/50'}`}>
                  {aura.visual?.icon && <span className="text-lg">{aura.visual.icon}</span>}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm" style={isActive && aura.visual?.color ? { color: aura.visual.color } : {}}>{aura.name || aura.nameEn}</div>
                    <div className="text-[10px] text-slate-400">{aura.radius}尺范围</div>
                  </div>
                  <button onClick={() => toggleAura(aura.id, !isActive)} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${isActive ? 'bg-amber-500/30 text-amber-300' : 'bg-slate-600/50 text-slate-300'}`}>
                    {isActive ? '关闭' : '开启'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Spell Slots */}
      <SpellSlotsBlock
        targetSheet={targetSheet} isDM={isDM} campaignId={campaignId} token={token}
        editingSlotLevel={editingSlotLevel} setEditingSlotLevel={setEditingSlotLevel}
        editableSlotValue={editableSlotValue} setEditableSlotValue={setEditableSlotValue}
        isSavingSlots={isSavingSlots} saveSpellSlots={saveSpellSlots}
        authedFetch={authedFetch} setTargetSheet={setTargetSheet}
      />

      {/* Features */}
      {targetSheet?.features?.length ? (
        <details className="bg-slate-800/50 rounded-lg border border-slate-700/30 overflow-hidden">
          <summary className="cursor-pointer px-4 py-2.5 text-amber-400 font-medium flex items-center gap-2 hover:bg-slate-700/30 transition-colors">特性</summary>
          <div className="p-3 space-y-2">
            {(() => {
              const char = targetSheet.character as any;
              const vc = (classesData as any).classes?.find((c: any) => c.id === char?.class_id);
              const ev = (field: any): string | undefined => { if (!field) return undefined; if (typeof field === 'string') return field; if (typeof field === 'object' && field.value) return field.value; return undefined; };
              const ea = (field: any): string[] => { if (!field) return []; if (Array.isArray(field)) return field.map((item: any) => typeof item === 'string' ? item : item?.value).filter(Boolean); return []; };
              const fightingStyle = ev(char?.fighting_style || char?.fightingStyle);
              const enemy = ev(char?.favored_enemy || char?.favoredEnemy);
              const humanoids = (char?.favored_humanoid_races || char?.favoredHumanoidRaces as string[]) || [];
              const terrain = ev(char?.favored_terrain || char?.favoredTerrain);
              const metamagics = ea(char?.metamagic_options || char?.metamagicOptions);
              const invocations = ea(char?.eldritch_invocations || char?.eldritchInvocations);
              return targetSheet.features.map((f: any, idx: number) => {
                const featureName = f.name || '';
                const classFeature = vc?.features?.find((cf: any) => cf.name === featureName);
                return (
                  <div key={`${f.id}_${idx}`} className="text-sm text-slate-300">
                    <span className="text-white font-medium">{f.name}</span>  {f.description}
                    {/战斗风格|Fighting Style/.test(featureName) && classFeature?.options?.length > 0 && (
                      <details className="mt-1"><summary className="text-xs text-green-300 cursor-pointer hover:text-green-200">{fightingStyle ? `已选择：${formatFightingStyle(fightingStyle)}` : '未选择'} <span className="text-green-500 text-[10px]">▶ 查看全部</span></summary>
                        <div className="mt-2 pl-2 border-l-2 border-green-800 space-y-1.5">
                          {classFeature.options.map((opt: any) => { const isSel = opt.id === fightingStyle; return (<div key={opt.id} className={`rounded px-2 py-1.5 ${isSel ? 'bg-green-900/40 border border-green-700' : 'bg-slate-800/60'}`}><span className={isSel ? 'text-green-300 font-medium' : 'text-slate-300'}>{isSel && '✦ '}{opt.name}</span><span className="text-slate-500 ml-1">({opt.nameEn})</span><div className="text-slate-400 mt-0.5 text-xs">{opt.description}</div></div>); })}
                        </div>
                      </details>
                    )}
                    {/宿敌|Favored Enemy/.test(featureName) && classFeature?.choices?.length > 0 && (
                      <details className="mt-1"><summary className="text-xs text-green-300 cursor-pointer hover:text-green-200">{enemy ? `已选择：${enemy === 'humanoids' ? `类人生物（${humanoids.map(formatHumanoid).join('、')}）` : formatFavoredEnemy(enemy)}` : '未选择'} <span className="text-green-500 text-[10px]">▶ 查看全部</span></summary>
                        <div className="mt-2 pl-2 border-l-2 border-green-800 flex flex-wrap gap-1.5">
                          {classFeature.choices.map((id: string) => { const isSel = id === enemy; return (<span key={id} className={`rounded px-2 py-1 text-xs ${isSel ? 'bg-green-900/40 border border-green-700 text-green-300 font-medium' : 'bg-slate-800/60 text-slate-400'}`}>{isSel && '✦ '}{formatFavoredEnemy(id)}</span>); })}
                        </div>
                      </details>
                    )}
                    {/偏好地形|天生探险家|自然探险家|自然探索者|Natural Explorer/.test(featureName) && classFeature?.terrainChoices?.length > 0 && (
                      <details className="mt-1"><summary className="text-xs text-green-300 cursor-pointer hover:text-green-200">{terrain ? `已选择：${formatFavoredTerrain(terrain)}` : '未选择'} <span className="text-green-500 text-[10px]">▶ 查看全部</span></summary>
                        <div className="mt-2 pl-2 border-l-2 border-green-800 flex flex-wrap gap-1.5">
                          {classFeature.terrainChoices.map((id: string) => { const isSel = id === terrain; return (<span key={id} className={`rounded px-2 py-1 text-xs ${isSel ? 'bg-green-900/40 border border-green-700 text-green-300 font-medium' : 'bg-slate-800/60 text-slate-400'}`}>{isSel && '✦ '}{formatFavoredTerrain(id)}</span>); })}
                        </div>
                      </details>
                    )}
                    {/超魔|Metamagic/.test(featureName) && classFeature?.options?.length > 0 && (
                      <details className="mt-1"><summary className="text-xs text-green-300 cursor-pointer hover:text-green-200">{metamagics.length > 0 ? `已选择：${metamagics.map(formatMetamagic).join('、')}` : '未选择'} <span className="text-green-500 text-[10px]">▶ 查看全部</span></summary>
                        <div className="mt-2 pl-2 border-l-2 border-green-800 space-y-1.5">
                          {classFeature.options.map((opt: any) => { const isSel = metamagics.includes(opt.id); return (<div key={opt.id} className={`rounded px-2 py-1.5 ${isSel ? 'bg-green-900/40 border border-green-700' : 'bg-slate-800/60'}`}><span className={isSel ? 'text-green-300 font-medium' : 'text-slate-300'}>{isSel && '✦ '}{opt.name}</span><span className="text-slate-500 ml-1">({opt.nameEn})</span>{opt.cost && <span className="text-amber-400/70 ml-1">- {opt.cost}点</span>}<div className="text-slate-400 mt-0.5 text-xs">{opt.description}</div></div>); })}
                        </div>
                      </details>
                    )}
                    {/魔能祈唤|Eldritch Invocations/.test(featureName) && invocations.length > 0 && (
                      <div className="text-xs text-green-300 mt-1">已选择：{invocations.map(formatEldritchInvocation).join('、')}</div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </details>
      ) : null}

      {/* Actions */}
      {targetSheet?.actions?.length ? (
        <details className="bg-slate-800/50 rounded-lg border border-slate-700/30 overflow-hidden">
          <summary className="cursor-pointer px-4 py-2.5 text-amber-400 font-medium flex items-center gap-2 hover:bg-slate-700/30 transition-colors">武器/动作</summary>
          <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {targetSheet.actions.map((a: any, idx: number) => (
              <div key={`${a.id}_${idx}`} className="text-sm text-slate-300 bg-slate-900/50 rounded-lg p-3 border border-slate-700/20">
                <div className="flex items-center justify-between">
                  <div className="text-white font-medium">{a.name}</div>
                  {a.uses && (
                    <div className="flex items-center gap-1">
                      {isDM && editingActionId === a.id ? (
                        <div className="flex items-center gap-1">
                          <input type="number" value={editableUses} onChange={(e: any) => setEditableUses(e.target.value)}
                            onBlur={() => { const n = Number(editableUses); if (!Number.isNaN(n) && n >= 0 && n <= a.uses.max) saveActionUses(a.id, n, a.uses.max); else setEditingActionId(null); }}
                            onKeyDown={(e: any) => { if (e.key === 'Enter') { const n = Number(editableUses); if (!Number.isNaN(n) && n >= 0 && n <= a.uses.max) saveActionUses(a.id, n, a.uses.max); else setEditingActionId(null); } else if (e.key === 'Escape') setEditingActionId(null); }}
                            autoFocus className="w-8 bg-slate-800 border border-amber-500/50 rounded px-1 py-0.5 text-center text-xs text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                          <span className="text-xs text-slate-400">/{a.uses.max}</span>
                        </div>
                      ) : (
                        <button onClick={() => { if (isDM) { setEditingActionId(a.id); setEditableUses(String(a.uses.current)); } }}
                          className={`text-xs px-1.5 py-0.5 rounded ${isDM ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 cursor-pointer' : 'bg-slate-700/50 text-slate-400 cursor-default'}`}>
                          {isSavingUses && editingActionId === a.id ? <span className="animate-pulse">保存...</span> : <>{a.uses.current}/{a.uses.max}<span className="ml-1 text-[10px] text-slate-500">/{a.uses.recharge === 'short_rest' ? '短休' : '长休'}</span></>}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {a.attack_bonus != null && <div className="text-xs text-slate-400">命中加值: {a.attack_bonus >= 0 ? `+${a.attack_bonus}` : a.attack_bonus}</div>}
                {a.damage_dice && <div className="text-xs text-slate-400">伤害: {typeof a.damage_dice === 'object' ? `${a.damage_dice.dice || a.damage_dice.formula || ''} ${a.damage_dice.type || ''}` : a.damage_dice}{a.damage_type ? ` ${a.damage_type}` : ''}</div>}
                {a.description && <div className="text-xs text-slate-500 mt-1">{a.description}</div>}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {/* Spells */}
      {targetSheet?.character?.spells?.length > 0 && (() => {
        const spells = targetSheet.character.spells;
        const prepared = spells.filter((s: any) => s.prepared === true);
        const show = prepared.length > 0 ? prepared : spells;
        return (
          <details className="bg-slate-800/50 rounded-lg border border-slate-700/30 overflow-hidden">
            <summary className="cursor-pointer px-4 py-2.5 text-amber-400 font-medium flex items-center gap-2 hover:bg-slate-700/30 transition-colors">法术{prepared.length ? '（已准备）' : ''}</summary>
            <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              {show.map((s: any, idx: number) => (
                <div key={idx} className="text-left text-sm text-slate-300 bg-slate-900/50 rounded-lg p-3 border border-slate-700/20">
                  <div className="text-white font-medium">{s.name}</div>
                  <div className="text-xs text-slate-400">{s.school} · {s.casting_time} · {s.range}</div>
                </div>
              ))}
            </div>
          </details>
        );
      })()}
    </>
  );
}

/* ─── Wild Shape Block ─── */
function WildShapeBlock({ data }: { data: any }) {
  return (
    <div className="bg-green-900/30 border border-green-600/50 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-green-400 font-semibold flex items-center gap-2">
          <span>🐺</span> 野性形态 - {data.beast_name}
          <span className="text-xs text-green-600">({data.beast_name_en})</span>
        </h4>
        <span className="text-xs text-green-600">{data.size}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="bg-green-950/50 rounded p-2 text-center"><div className="text-[10px] text-green-600 uppercase">野兽HP</div><div className="text-green-400 font-bold">{data.current_hp} / {data.max_hp}</div></div>
        <div className="bg-green-950/50 rounded p-2 text-center"><div className="text-[10px] text-green-600 uppercase">AC</div><div className="text-green-400 font-bold">{data.ac}</div></div>
        <div className="bg-green-950/50 rounded p-2 text-center"><div className="text-[10px] text-green-600 uppercase">速度</div><div className="text-green-400 font-bold">{Object.entries(data.speed || {}).map(([type, val]) => type === 'walk' ? `${val}尺` : `${type === 'fly' ? '飞行' : type === 'swim' ? '游泳' : type === 'climb' ? '攀爬' : type}${val}尺`).join(' ')}</div></div>
      </div>
      {data.ability_scores && (
        <div className="grid grid-cols-3 gap-1 text-xs">
          {['str','dex','con'].map(attr => (
            <div key={attr} className="bg-green-950/30 rounded p-1.5 text-center">
              <span className="text-green-600">{attr === 'str' ? '力量' : attr === 'dex' ? '敏捷' : '体质'}</span>{' '}
              <span className="text-green-400 font-medium">{data.ability_scores[attr]} ({data.ability_scores[`${attr}Mod`] >= 0 ? '+' : ''}{data.ability_scores[`${attr}Mod`]})</span>
            </div>
          ))}
        </div>
      )}
      {data.actions?.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-green-600 uppercase">动作</div>
          {data.actions.map((action: any, idx: number) => (<div key={idx} className="bg-green-950/30 rounded p-2 text-xs"><span className="text-green-400 font-medium">{action.name}</span><span className="text-green-600 ml-2">{action.description}</span></div>))}
        </div>
      )}
      {data.special_abilities?.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-green-600 uppercase">特殊能力</div>
          {data.special_abilities.map((ability: any, idx: number) => (<div key={idx} className="bg-green-950/30 rounded p-2 text-xs"><span className="text-green-400 font-medium">{ability.name}</span><span className="text-green-600 ml-2">{ability.description}</span></div>))}
        </div>
      )}
    </div>
  );
}

/* ─── Spell Slots Block ─── */
interface SpellSlotsBlockProps {
  targetSheet: any;
  isDM: boolean;
  campaignId: string;
  token: Token | null;
  editingSlotLevel: string | null;
  setEditingSlotLevel: (level: string | null) => void;
  editableSlotValue: string;
  setEditableSlotValue: (value: string) => void;
  isSavingSlots: boolean;
  saveSpellSlots: (level: string, value: number) => void;
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  setTargetSheet: (updater: (prev: any) => any) => void;
}

function SpellSlotsBlock({
  targetSheet,
  isDM,
  campaignId,
  token,
  editingSlotLevel,
  setEditingSlotLevel,
  editableSlotValue,
  setEditableSlotValue,
  isSavingSlots,
  saveSpellSlots,
  authedFetch,
  setTargetSheet,
}: SpellSlotsBlockProps) {
  const spellSlotsState = targetSheet?.character?.spell_slots_state;
  if (!spellSlotsState) return null;

  const classId = targetSheet?.character?.class_id;
  const level = targetSheet?.character?.level || 1;

  const FULL_CASTER_SLOTS: Record<number, number[]> = {
    1:[0,2,0,0,0,0,0,0,0,0],2:[0,3,0,0,0,0,0,0,0,0],3:[0,4,2,0,0,0,0,0,0,0],4:[0,4,3,0,0,0,0,0,0,0],
    5:[0,4,3,2,0,0,0,0,0,0],6:[0,4,3,3,0,0,0,0,0,0],7:[0,4,3,3,1,0,0,0,0,0],8:[0,4,3,3,2,0,0,0,0,0],
    9:[0,4,3,3,3,1,0,0,0,0],10:[0,4,3,3,3,2,0,0,0,0],11:[0,4,3,3,3,2,1,0,0,0],12:[0,4,3,3,3,2,1,0,0,0],
    13:[0,4,3,3,3,2,1,1,0,0],14:[0,4,3,3,3,2,1,1,0,0],15:[0,4,3,3,3,2,1,1,1,0],16:[0,4,3,3,3,2,1,1,1,0],
    17:[0,4,3,3,3,2,1,1,1,1],18:[0,4,3,3,3,3,1,1,1,1],19:[0,4,3,3,3,3,2,1,1,1],20:[0,4,3,3,3,3,2,2,1,1],
  };
  const HALF_CASTER_SLOTS: Record<number, number[]> = {
    1:[0,0,0,0,0,0,0,0,0,0],2:[0,2,0,0,0,0,0,0,0,0],3:[0,3,0,0,0,0,0,0,0,0],4:[0,3,0,0,0,0,0,0,0,0],
    5:[0,4,2,0,0,0,0,0,0,0],6:[0,4,2,0,0,0,0,0,0,0],7:[0,4,3,0,0,0,0,0,0,0],8:[0,4,3,0,0,0,0,0,0,0],
    9:[0,4,3,2,0,0,0,0,0,0],10:[0,4,3,2,0,0,0,0,0,0],11:[0,4,3,3,0,0,0,0,0,0],12:[0,4,3,3,0,0,0,0,0,0],
    13:[0,4,3,3,1,0,0,0,0,0],14:[0,4,3,3,1,0,0,0,0,0],15:[0,4,3,3,2,0,0,0,0,0],16:[0,4,3,3,2,0,0,0,0,0],
    17:[0,4,3,3,3,1,0,0,0,0],18:[0,4,3,3,3,1,0,0,0,0],19:[0,4,3,3,3,2,0,0,0,0],20:[0,4,3,3,3,2,0,0,0,0],
  };

  const fullCasters = ['wizard','cleric','druid','sorcerer','bard'];
  const halfCasters = ['paladin','ranger','artificer'];
  let maxSlots: number[] = [0,0,0,0,0,0,0,0,0,0];
  if (fullCasters.includes(classId || '')) maxSlots = FULL_CASTER_SLOTS[level] || maxSlots;
  else if (halfCasters.includes(classId || '')) maxSlots = HALF_CASTER_SLOTS[level] || maxSlots;

  let currentSlots: number[] = [0,0,0,0,0,0,0,0,0,0];
  if (Array.isArray(spellSlotsState)) currentSlots = spellSlotsState;
  else if (typeof spellSlotsState === 'object' && spellSlotsState.slots) currentSlots = spellSlotsState.slots as number[];

  const slotData: Array<{ level: number; current: number; max: number }> = [];
  for (let lvl = 1; lvl <= 9; lvl++) {
    const max = maxSlots[lvl] || 0;
    if (max > 0) slotData.push({ level: lvl, current: currentSlots[lvl] ?? max, max });
  }
  if (slotData.length === 0) return null;

  return (
    <details className="bg-slate-800/50 rounded-lg border border-purple-500/30 overflow-hidden" open>
      <summary className="cursor-pointer px-4 py-2.5 text-purple-400 font-medium flex items-center gap-2 hover:bg-slate-700/30 transition-colors">
        <span>✨</span>法术位{isSavingSlots && <span className="text-amber-400 animate-pulse text-xs ml-2">保存中...</span>}
      </summary>
      <div className="p-3">
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          {slotData.map(({ level: lvl, current, max }) => (
            <div key={lvl} className={`bg-slate-900/50 rounded-lg p-2.5 border text-center ${isDM ? 'border-purple-500/30 cursor-pointer hover:bg-slate-800/50' : 'border-slate-700/20'}`}
              onClick={() => { if (isDM && editingSlotLevel !== String(lvl)) { setEditingSlotLevel(String(lvl)); setEditableSlotValue(String(current)); } }}>
              <div className="text-[10px] uppercase text-slate-400 mb-1">{lvl}环</div>
              {isDM && editingSlotLevel === String(lvl) ? (
                <div className="flex items-center justify-center gap-1">
                  <input type="number" min="0" max={max} value={editableSlotValue} onChange={(e: any) => setEditableSlotValue(e.target.value)}
                    onBlur={() => { const n = Number(editableSlotValue); if (!Number.isNaN(n) && n >= 0 && n <= max) saveSpellSlots(String(lvl), n); else setEditingSlotLevel(null); }}
                    onKeyDown={(e: any) => { if (e.key === 'Enter') { const n = Number(editableSlotValue); if (!Number.isNaN(n) && n >= 0 && n <= max) saveSpellSlots(String(lvl), n); else setEditingSlotLevel(null); } else if (e.key === 'Escape') setEditingSlotLevel(null); }}
                    autoFocus className="w-8 bg-slate-800 border border-purple-500/50 rounded px-1 py-0.5 text-center text-sm text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    onClick={(e: any) => e.stopPropagation()} />
                  <span className="text-slate-500 text-sm">/{max}</span>
                </div>
              ) : (
                <div className={`text-lg font-bold ${current > 0 ? 'text-purple-300' : 'text-slate-500'}`}>{current}<span className="text-slate-500 font-normal text-sm">/{max}</span></div>
              )}
            </div>
          ))}
        </div>
        {isDM && (
          <div className="mt-2 flex justify-end">
            <button onClick={async () => {
              if (!token?.character_id) return;
              try {
                const restoredSlots = [...maxSlots];
                await authedFetch(`/api/characters/${token.character_id}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    spell_slots_state: restoredSlots,
                    broadcast_campaign_id: campaignId,
                  }),
                });
                setTargetSheet((prev: any) => prev ? { ...prev, character: { ...prev.character, spell_slots_state: restoredSlots } } : null);
              } catch (e) { console.error('Failed to restore spell slots:', e); }
            }} className="px-2 py-1 text-xs bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 rounded transition-colors">
              全部恢复
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
