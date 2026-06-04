import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useHotbar } from './useHotbar';
import { HotbarSlotItem } from './HotbarSlotItem';
import { HotbarPickerModal } from './HotbarPickerModal';
import { apiFetch } from '~/utils/api-client';
import type { Character, HotbarSlot, EquipmentItem } from '~/components/character/CharacterDisplay/types/Character';
import type { Spell } from '~/types/spell';
import type { SpellCastData } from '~/components/spell/SpellCastActions';
import { fetchCharacterResourcesCached } from '~/utils/characterResourcesCache';
import spellcastingConfig from '~/data/rules/spellcasting.json';
import equipmentRulesData from '~/data/rules/equipment.json';
import { spellcastingAbilityMap, isPreparedCaster } from '~/components/character/CharacterDisplay/utils/spellcasting';
import { getFeatRuleOverrides } from '~/components/character/CharacterDisplay/utils/featEffects';
import { extractAllGrantedActions, executeGrantedAction, getActionTypeLabel, getActionSummary, actionNeedsTarget } from '~/utils/grantedActions';
import { findCharacterToken } from '~/utils/sidebarCasting';
import { getAssetUrl } from '~/utils/asset-url';
import { getIconPath } from '~/components/character/CharacterDisplay/utils/rules';
import { subscribeAppEvent } from '~/events/appEventBus';
import type { AttachedRuntimeRef, GrantedRuntimeAction } from '~/components/map/types/TacticalMapTypes';

interface HotbarProps {
  character: Character | null;
  rightSidebarWidth: number;
  showRightSidebar: boolean;
  showLeftSidebar: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  activeSlotIndex?: number | null;
  onSlotActivate?: (slot: HotbarSlot, index: number) => void;
  onUseResource?: (resourceId: string, amount: number) => Promise<number | null>;
  onStartTargeting?: (resourceId: string, poolCurrent: number, poolMax: number) => void;
  onStartSmiteTargeting?: (resourceId: string, spellSlotLevel: number) => void;
  onConsumeSpellSlot?: (level: number, resourceId: string) => void;
  /** External spell slot info (from live spellSlotsState). Overrides internal computation. */
  externalSpellSlotInfo?: SpellSlotInfo | null;
  /** Callback when a spell is cast from the hotbar detail modal */
  onCastSpell?: (data: SpellCastData, slotIndex: number) => void;
  /** Name of the spell the character is currently concentrating on */
  concentrationSpellName?: string | null;
  /** Name of the spell the character is currently long-casting */
  castingSpellName?: string | null;
  /** Material consumption callback */
  onConsumeMaterial?: (materialId: string) => void;
  /** DM 模式 */
  isDM?: boolean;
  /** Campaign ID for initial token fetch */
  campaignId?: string;
  /** Current map URL for initial token fetch */
  currentMapUrl?: string | null;
  /** User ID for auth */
  userId?: string;
}

export interface SpellSlotInfo {
  max: number[];      // index = spell level (0-9), 0 unused
  remaining: number[];
}

function computeSpellSlots(classId: string | undefined, level: number): number[] {
  if (!classId || !(classId in spellcastingAbilityMap)) return [];
  const config = spellcastingConfig as any;
  if (classId === 'warlock') {
    const pactCfg = config?.pactMagic?.warlock || {};
    const entry = pactCfg[String(level)];
    const slots = new Array(10).fill(0);
    if (entry && typeof entry.slots === 'number') {
      const slotLevel = entry.level ?? 1;
      if (slotLevel >= 1 && slotLevel <= 9) slots[slotLevel] = entry.slots;
    }
    return slots;
  }
  const tableKey = (classId === 'paladin' || classId === 'ranger') ? 'halfCaster' : 'fullCaster';
  const table = config?.slotTables?.[tableKey] || {};
  const rawSlots: number[] = table[String(level)] || [];
  const result = [0, ...rawSlots];
  while (result.length < 10) result.push(0);
  return result;
}

// ── Weapon rules lookup for building attack slots ──
const weaponRulesLookup: Record<string, any> = (() => {
  const map: Record<string, any> = {};
  const rules = equipmentRulesData as any;
  for (const prof of ['simple', 'martial']) {
    for (const type of ['melee', 'ranged']) {
      ((rules.weapons?.[prof]?.[type]) || []).forEach((w: any) => {
        if (w.id) map[w.id.toLowerCase()] = { ...w, _isMelee: type === 'melee' };
      });
    }
  }
  return map;
})();

function formatDamage(d: string | { dice: string } | undefined): string {
  if (!d) return '';
  return typeof d === 'string' ? d : d.dice;
}

function equipIconUrl(eq: EquipmentItem): string {
  if (eq.avatar_url) return eq.avatar_url;
  return getIconPath(eq) || getAssetUrl(`assets/equipment-icons/${eq.id}.png`);
}

/** 根据角色装备构建固定的主手攻击槽位 */
function buildMainHandSlot(character: Character): HotbarSlot {
  const equipment = character.equipment || [];
  const mainHand = equipment.find(eq => eq.equippedSlot === 'main_hand');

  if (!mainHand || (!mainHand.damage && mainHand.equipmentType !== 'weapon')) {
    return {
      type: 'weapon', id: 'unarmed_strike',
      name: '徒手打击', icon: '👊',
      meta: { cost: '动作', damage: '1+力量', damageType: '钝击', normalRange: 5, maxRange: 5 },
    };
  }

  const grip = mainHand.gripMode === 'two-hand' ? '(双手)' : '';
  const getProps = (item: any): string[] => {
    if (item.properties?.length) return item.properties;
    const rulesW = item.id ? weaponRulesLookup[String(item.id).toLowerCase()] : null;
    return rulesW?.properties || [];
  };
  const props = getProps(mainHand);
  const hasReach = props.some((p: string) => p === 'reach' || p.includes('长柄'));
  const isThrown = props.some((p: string) => p === 'thrown' || p.includes('投掷'));
  let normalRange = hasReach ? 10 : 5;
  let maxRange = normalRange;
  if (!isThrown) {
    if (typeof mainHand.range === 'object' && mainHand.range) {
      normalRange = mainHand.range.normal || normalRange;
      maxRange = mainHand.range.long || normalRange;
    } else if (typeof mainHand.range === 'string') {
      const rm = mainHand.range.match(/(\d+)(?:\/(\d+))?/);
      if (rm) { normalRange = parseInt(rm[1], 10); maxRange = rm[2] ? parseInt(rm[2], 10) : normalRange; }
    }
  }
  return {
    type: 'weapon', id: `attack_main_${mainHand.id}`,
    name: `主手攻击${grip}：${mainHand.name}`, icon: '⚔',
    meta: {
      cost: '动作', damage: formatDamage(mainHand.damage), damageType: mainHand.damageType,
      avatar_url: equipIconUrl(mainHand), normalRange, maxRange, range: mainHand.range, properties: props,
    },
  };
}

const LEFT_SIDEBAR_WIDTH = 64; // w-16
const SCROLL_AMOUNT = 120; // px per arrow click

export function Hotbar({
  character,
  rightSidebarWidth,
  showRightSidebar,
  showLeftSidebar,
  expanded: controlledExpanded,
  onExpandedChange,
  activeSlotIndex,
  onSlotActivate,
  onUseResource,
  onStartTargeting,
  onStartSmiteTargeting,
  onConsumeSpellSlot,
  externalSpellSlotInfo,
  onCastSpell,
  concentrationSpellName,
  castingSpellName,
  onConsumeMaterial,
  campaignId,
  currentMapUrl,
  userId,
  isDM,
}: HotbarProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const setExpanded = onExpandedChange ?? setInternalExpanded;

  // Check if character is silenced (from status_effects.active_conditions)
  const isSilenced = useMemo(() => {
    const status = character?.status_effects as { active_conditions?: { condition: string }[] } | null;
    return status?.active_conditions?.some(c => c.condition === 'silenced') ?? false;
  }, [character?.status_effects]);

  // Check if character is incapacitated (can't take actions or reactions)
  const isIncapacitated = useMemo(() => {
    const INCAPACITATING = ['incapacitated', 'stunned', 'paralyzed', 'unconscious', 'petrified'];
    const status = character?.status_effects as { active_conditions?: { condition: string }[] } | null;
    return status?.active_conditions?.some(c => INCAPACITATING.includes(c.condition)) ?? false;
  }, [character?.status_effects]);

  // Check if character has somatic freedom from feats (e.g. War Caster)
  const hasSomaticFreedom = useMemo(() => {
    const featIds = (character?.feats || []).map((f: any) => typeof f === 'string' ? f : f.value || f.id || '').filter(Boolean);
    return getFeatRuleOverrides(featIds).has('somatic_with_hands_full');
  }, [character?.feats]);
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isMobile = windowWidth < 768;

  // Calculate available width between left sidebar and right sidebar
  const leftW = isMobile ? 0 : (showLeftSidebar ? LEFT_SIDEBAR_WIDTH : 0);
  const rightW = isMobile ? 0 : (showRightSidebar ? rightSidebarWidth : 48);

  const { slots, slotCount, setSlot, clearSlot } = useHotbar(
    character?.id ?? null,
    character?.hotbar,
  );

  // ── Slot 0: 固定为主手武器攻击（或徒手打击） ──
  const fixedSlot0 = useMemo(() => {
    if (!character) return null;
    return buildMainHandSlot(character);
  }, [character?.equipment, character?.id]);

  // 合成显示用槽位列表：slot 0 始终使用计算值
  const displaySlots = useMemo(() => {
    const result = [...slots];
    if (fixedSlot0) result[0] = fixedSlot0;
    return result;
  }, [slots, fixedSlot0]);

  // Center position: on mobile, center of full screen; on desktop, between sidebars
  // Use padding instead of transform to avoid creating a new containing block
  // (transform breaks position:fixed of child dialogs)
  const centerPadding = useMemo(() => {
    if (isMobile) return { left: 0, right: 0 };
    return { left: leftW, right: rightW };
  }, [isMobile, leftW, rightW]);

  // Scroll state for arrows - use callback ref for reliable setup
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  const scrollCallbackRef = useCallback((node: HTMLDivElement | null) => {
    // Cleanup old listeners
    if (scrollRef.current) {
      scrollRef.current.removeEventListener('scroll', updateScrollState);
      observerRef.current?.disconnect();
    }
    scrollRef.current = node;
    if (node) {
      node.addEventListener('scroll', updateScrollState, { passive: true });
      observerRef.current = new ResizeObserver(updateScrollState);
      observerRef.current.observe(node);
      // Initial check after a tick (DOM layout settled)
      requestAnimationFrame(updateScrollState);
    }
  }, [updateScrollState]);

  // Also update on window resize (use rAF to wait for layout)
  useEffect(() => {
    requestAnimationFrame(updateScrollState);
  }, [windowWidth, updateScrollState]);

  const scrollBy = useCallback((dir: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: dir * SCROLL_AMOUNT, behavior: 'smooth' });
  }, []);

  // Picker modal state: which slot index to fill
  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(null);

  // Listen for "add item to hotbar" events from BagDialog context menu
  useEffect(() => {
    const handler = (item: any) => {
      if (!item) return;
      // Find first empty slot (skip slot 0 which is locked)
      const emptyIndex = slots.findIndex((s, i) => i > 0 && s === null);
      if (emptyIndex >= 0) {
        setSlot(emptyIndex, item);
      }
    };
    return subscribeAppEvent('hotbarAddItem', handler);
  }, [slots, setSlot]);

  // Listen for mouse-drag drop to specific slot
  useEffect(() => {
    const handler = ({ slotIdx, item }: { slotIdx?: number; item?: any }) => {
      if (item && typeof slotIdx === 'number' && slotIdx !== 0) {
        setSlot(slotIdx, item);
      }
    };
    return subscribeAppEvent('hotbarDropToSlot', handler);
  }, [setSlot]);

  // Fetch class resources once for the character (for feature usage display)
  const [classResources, setClassResources] = useState<any[]>([]);
  const [resourceRefreshKey, setResourceRefreshKey] = useState(0);

  // Listen for resource changes (from DM +/- buttons or WebSocket broadcasts)
  useEffect(() => {
    const handler = (detail: { characterId?: number | string }) => {
      const charId = detail?.characterId;
      if (!charId || charId === character?.id) {
        setResourceRefreshKey(k => k + 1);
      }
    };
    return subscribeAppEvent('classFeatureUsesUpdated', handler);
  }, [character?.id]);

  useEffect(() => {
    if (!character?.id) { setClassResources([]); return; }
    let cancelled = false;
    fetchCharacterResourcesCached(character.id, { userId })
      .then((resources) => {
        if (!cancelled) setClassResources(resources);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [character?.id, character?.level, JSON.stringify(character?.class_feature_uses || {}), userId, resourceRefreshKey]);

  // Compute spell slot info for spell-type hotbar slots
  // Use external (live) data if provided, otherwise compute from character prop
  const computedSpellSlotInfo = useMemo<SpellSlotInfo | null>(() => {
    if (externalSpellSlotInfo) return externalSpellSlotInfo;
    if (!character) return null;
    const maxSlots = computeSpellSlots(character.class_id, character.level || 1);
    if (!maxSlots.length) return null;
    const backendRemaining = character.spell_slots_state as number[] | undefined;
    const remaining = maxSlots.map((max, idx) => {
      if (!Array.isArray(backendRemaining)) return max;
      const v = backendRemaining[idx];
      return (typeof v === 'number' && v >= 0 && v <= max) ? v : max;
    });
    return { max: maxSlots, remaining };
  }, [externalSpellSlotInfo, character?.class_id, character?.level, character?.spell_slots_state]);

  // Live spell slot info that updates from custom events
  const [liveSpellSlotInfo, setLiveSpellSlotInfo] = useState<SpellSlotInfo | null>(null);

  useEffect(() => {
    const handler = (detail: { characterId?: number | string; remaining?: number[]; max?: number[] }) => {
      const { characterId, remaining, max } = detail || {};
      if (characterId && characterId === character?.id && Array.isArray(remaining) && Array.isArray(max)) {
        setLiveSpellSlotInfo({ max, remaining });
      }
    };
    return subscribeAppEvent('spellSlotsChanged', handler);
  }, [character?.id]);

  // Reset live override when character changes or computed info changes
  useEffect(() => { setLiveSpellSlotInfo(null); }, [character?.id, character?.spell_slots_state]);

  const spellSlotInfo = liveSpellSlotInfo ?? computedSpellSlotInfo;

  // Reset when character changes
  useEffect(() => {
    setPickerSlotIndex(null);
  }, [character?.id]);

  // Auto-clear weapon slots when equipped weapons change
  // (e.g. swapping javelin → crossbow should remove stale "attack_main_javelin" slots)
  const equipment = character?.equipment;
  const mainHandId = useMemo(() => equipment?.find((e: any) => e.equippedSlot === 'main_hand')?.id, [equipment]);
  const offHandId = useMemo(() => equipment?.find((e: any) => e.equippedSlot === 'off_hand')?.id, [equipment]);

  // Build current available spell ID set for staleness detection
  const availableSpellIds = useMemo(() => {
    if (!character) return new Set<string>();
    const ids = new Set<string>();
    const addId = (v: any) => { const id = typeof v === 'string' ? v : v?.id; if (id) ids.add(id); };
    // Cantrips always included
    (character.selected_cantrips || (character as any).selectedCantrips || []).forEach(addId);
    if (isPreparedCaster(character.class_id)) {
      // Prepared casters: only prepared spells count as available
      (character.prepared_spells || (character as any).preparedSpells || []).forEach(addId);
    } else {
      // Known casters: all selected/prepared spells are available
      (character.prepared_spells || (character as any).preparedSpells || []).forEach(addId);
      (character.selected_spells || (character as any).selectedSpells || []).forEach(addId);
    }
    const fc = character.feat_choices || (character as any).featChoices;
    if (fc) {
      if (fc.magic_initiate) {
        (fc.magic_initiate.cantrips || []).forEach((id: string) => ids.add(id));
        if (fc.magic_initiate.spell) ids.add(fc.magic_initiate.spell);
      }
      if (fc.spell_sniper?.cantrip) ids.add(fc.spell_sniper.cantrip);
      if (fc.ritual_caster?.ritualSpells) {
        fc.ritual_caster.ritualSpells.forEach((id: string) => ids.add(id));
      }
    }
    return ids;
  }, [
    character?.prepared_spells, (character as any)?.preparedSpells,
    character?.selected_cantrips, (character as any)?.selectedCantrips,
    character?.selected_spells, (character as any)?.selectedSpells,
    character?.feat_choices,
  ]);

  const charLevel = character?.level || 1;

  // Auto-clear stale hotbar slots when equipment, spells, or level change
  useEffect(() => {
    slots.forEach((slot, i) => {
      if (!slot || i === 0) return; // Skip slot 0 (fixed main-hand)
      const sid = slot.id;

      // Weapon slots: clear if referenced weapon is no longer equipped
      if (slot.type === 'weapon') {
        if (sid.startsWith('attack_main_') || sid.startsWith('throw_main_') || sid.startsWith('improvthrow_main_')) {
          const refId = sid.replace(/^(attack_main_|throw_main_|improvthrow_main_)/, '');
          if (refId !== mainHandId) clearSlot(i);
        }
        if (sid.startsWith('attack_off_') || sid.startsWith('throw_off_') || sid.startsWith('improvthrow_off_')) {
          const refId = sid.replace(/^(attack_off_|throw_off_|improvthrow_off_)/, '');
          if (refId !== offHandId) clearSlot(i);
        }
      }

      // Spell slots: clear if spell no longer in available list
      if (slot.type === 'spell' && availableSpellIds.size > 0 && !availableSpellIds.has(sid)) {
        clearSlot(i);
      }

      // Feature slots: clear if feature level exceeds current character level
      if (slot.type === 'feature' && typeof slot.meta?.level === 'number' && slot.meta.level > charLevel) {
        clearSlot(i);
      }
    });
  }, [mainHandId, offHandId, availableSpellIds, charLevel]);

  // Expose hotbar height via CSS variable for ZoomControls positioning
  const hotbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = hotbarRef.current;
    if (!el) return;
    const update = () => {
      const h = expanded ? el.offsetHeight : 0;
      document.documentElement.style.setProperty('--hotbar-height', h + 'px');
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--hotbar-height');
    };
  }, [expanded]);

  const handleSlotClick = useCallback((index: number) => {
    const slot = displaySlots[index];
    if (slot) {
      onSlotActivate?.(slot, index);
      return;
    }
    // Slot 0 is locked, never open picker for it
    if (index === 0) return;
    setPickerSlotIndex(index);
  }, [displaySlots, onSlotActivate]);

  const handlePickerSelect = useCallback((item: HotbarSlot) => {
    if (pickerSlotIndex !== null) {
      setSlot(pickerSlotIndex, item);
    }
    setPickerSlotIndex(null);
  }, [pickerSlotIndex, setSlot]);

  // When an equipment item avatar is generated, update the hotbar slot meta
  const handleEquipmentAvatarGenerated = useCallback((itemId: string, avatarUrl: string) => {
    slots.forEach((slot, i) => {
      if (slot?.type === 'item' && slot.id === itemId) {
        setSlot(i, { ...slot, meta: { ...slot.meta, avatar_url: avatarUrl } });
      }
    });
  }, [slots, setSlot]);

  // Sync weapon attack slot range when equipment changes (handles stale hotbar data)
  useEffect(() => {
    if (!character?.equipment) return;
    const equipment = character.equipment as any[];
    const mainHand = equipment.find((eq: any) => eq.equippedSlot === 'main_hand');
    const offHand = equipment.find((eq: any) => eq.equippedSlot === 'off_hand');
    let changed = false;
    slots.forEach((slot, i) => {
      if (!slot || slot.type !== 'weapon' || i === 0) return; // Skip slot 0 (fixed)
      const isMainAttack = slot.id?.startsWith('attack_main_');
      const isOffAttack = slot.id?.startsWith('attack_off_');
      const isThrow = slot.id?.startsWith('throw_main_') || slot.id?.startsWith('improvthrow_main_');
      const isOffThrow = slot.id?.startsWith('throw_off_') || slot.id?.startsWith('improvthrow_off_');
      const item = isMainAttack || isThrow ? mainHand : (isOffAttack || isOffThrow ? offHand : null);
      if (!item || !item.range || typeof item.range !== 'object') return;
      // For throw slots, update thrown range; for attack slots of non-melee weapons, update weapon range
      if (isThrow || isOffThrow) {
        const newNR = item.range.normal;
        const newMR = item.range.long || newNR;
        if (slot.meta?.normalRange !== newNR || slot.meta?.maxRange !== newMR) {
          setSlot(i, { ...slot, meta: { ...slot.meta, normalRange: newNR, maxRange: newMR, range: item.range } });
          changed = true;
        }
      } else if (isMainAttack || isOffAttack) {
        // Only update if this weapon has ranged properties (non-melee)
        const props: string[] = slot.meta?.properties || item.properties || [];
        const hasAmmo = props.some((p: string) => p === 'ammunition' || p.includes('弹药'));
        const hasRangeObj = item.range.normal > 10;
        if (hasAmmo || hasRangeObj) {
          const newNR = item.range.normal;
          const newMR = item.range.long || newNR;
          if (slot.meta?.normalRange !== newNR || slot.meta?.maxRange !== newMR) {
            setSlot(i, { ...slot, meta: { ...slot.meta, normalRange: newNR, maxRange: newMR, range: item.range } });
            changed = true;
          }
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character?.equipment]);

  // ── Spell actions tab: concentration tracking ──
  const [activeTab, setActiveTab] = useState<'slots' | 'spell_actions'>('slots');
  const [concentrationSpell, setConcentrationSpell] = useState<{ spell_id: string; slot_level: number } | null>(null);
  const [incomingSpellBuffs, setIncomingSpellBuffs] = useState<any[]>([]);
  const [boundTokenId, setBoundTokenId] = useState<number | null>(null);
  const [runtimeGrantedActions, setRuntimeGrantedActions] = useState<GrantedRuntimeAction[]>([]);
  const [attachedRuntimeRefs, setAttachedRuntimeRefs] = useState<AttachedRuntimeRef[]>([]);
  // Backend-persisted `grant_action` entries on the source token's own active_effects
  // (e.g. Witch Bolt repeat-damage). These carry the locked target + effect_id needed
  // for the dedicated /api/spells/granted-actions/execute route.
  const [selfActiveEffectGrants, setSelfActiveEffectGrants] = useState<any[]>([]);
  const [dragOverSlotIdx, setDragOverSlotIdx] = useState<number | null>(null);

  useEffect(() => {
    const handler = (detail: {
      characterId?: number | string;
      concentrationSpell?: { spell_id?: string; slot_level?: number | null } | null;
    }) => {
      if (detail?.characterId === character?.id) {
        const cs = detail.concentrationSpell;
        setConcentrationSpell(cs?.spell_id ? { spell_id: cs.spell_id, slot_level: cs.slot_level ?? 0 } : null);
      }
    };
    return subscribeAppEvent('characterConcentrationChanged', handler);
  }, [character?.id]);

  useEffect(() => {
    const handler = ({
      characterId,
      activeEffects,
    }: {
      characterId?: number | string;
      activeEffects?: any[];
    }) => {
      if (characterId === character?.id) {
        const effects = activeEffects || [];
        setIncomingSpellBuffs(effects.filter((eff: any) => eff.spell_buff));
        setSelfActiveEffectGrants(effects.filter((eff: any) => eff?.effect_type === 'grant_action'));
      }
    };
    return subscribeAppEvent("characterActiveEffectsChanged", handler);
  }, [character?.id]);

  useEffect(() => {
    const applyTokenUpdate = (token: any) => {
      if (!token) return;
      const matchesCharacter = token.character_id === character?.id;
      const matchesBoundToken = boundTokenId != null && token.id === boundTokenId;
      if (!matchesCharacter && !matchesBoundToken) return;
      if (matchesCharacter && token.id) {
        setBoundTokenId(token.id);
      }
      if ('concentration_spell' in token) {
        const cs = token.concentration_spell;
        setConcentrationSpell(cs?.spell_id ? { spell_id: cs.spell_id, slot_level: cs.slot_level ?? 0 } : null);
      }
      if ('active_effects' in token) {
        const effects = token.active_effects || [];
        setIncomingSpellBuffs(effects.filter((eff: any) => eff.spell_buff));
        setSelfActiveEffectGrants(effects.filter((eff: any) => eff?.effect_type === 'grant_action'));
      }
      if ('granted_actions_ui' in token) {
        setRuntimeGrantedActions(token.granted_actions_ui || []);
      }
      if ('attached_runtime_refs' in token) {
        setAttachedRuntimeRefs(token.attached_runtime_refs || []);
      }
    };

    const unsubscribeTokenUpdated = subscribeAppEvent("tokenUpdated", ({ token }) => {
      applyTokenUpdate(token);
    });
    const unsubscribeTokenPlaced = subscribeAppEvent("tokenPlaced", ({ token }) => {
      applyTokenUpdate(token);
    });

    return () => {
      unsubscribeTokenUpdated();
      unsubscribeTokenPlaced();
    };
  }, [boundTokenId, character?.id]);

  // Fetch initial concentration + spell buffs from token (handles race condition on page load)
  useEffect(() => {
    if (!character?.id || !campaignId || !currentMapUrl) return;
    findCharacterToken(character.id, campaignId, currentMapUrl, userId)
      .then(result => {
        setBoundTokenId(result?.id ?? null);
        const cs = result?.data?.concentration_spell;
        setConcentrationSpell(cs?.spell_id ? { spell_id: cs.spell_id, slot_level: cs.slot_level ?? 0 } : null);
        const effects = result?.data?.active_effects || [];
        const buffs = effects.filter((e: any) => e.spell_buff);
        setIncomingSpellBuffs(buffs);
        setSelfActiveEffectGrants(effects.filter((e: any) => e?.effect_type === 'grant_action'));
        setRuntimeGrantedActions(result?.data?.granted_actions_ui || []);
        setAttachedRuntimeRefs(result?.data?.attached_runtime_refs || []);
      })
      .catch(() => {});
  }, [character?.id, campaignId, currentMapUrl, userId]);

  const grantedActions = useMemo(
    () => extractAllGrantedActions(
      concentrationSpell,
      incomingSpellBuffs,
      runtimeGrantedActions,
      attachedRuntimeRefs,
      selfActiveEffectGrants,
    ),
    [attachedRuntimeRefs, concentrationSpell, incomingSpellBuffs, runtimeGrantedActions, selfActiveEffectGrants],
  );

  useEffect(() => {
    if (grantedActions.length === 0 && activeTab === 'spell_actions') setActiveTab('slots');
  }, [grantedActions.length, activeTab]);

  // No character selected
  if (!character) return null;

  // Max width: on mobile nearly full width, on desktop between sidebars
  const maxBarWidth = isMobile
    ? windowWidth - 16
    : Math.max(200, windowWidth - leftW - rightW - 80);

  return (
    <div
      ref={hotbarRef}
      data-hotbar-root="true"
      className="fixed bottom-0 left-0 right-0 z-[160] flex flex-col items-center pointer-events-none pb-[var(--sab,0px)]"
      style={{ paddingLeft: centerPadding.left, paddingRight: centerPadding.right }}
    >
      {/* Expanded hotbar */}
      {expanded && (
        <div
          className="mb-1 flex flex-col items-center relative pointer-events-auto"
          data-hotbar
          style={{ maxWidth: maxBarWidth }}
        >
          {/* Tab switcher — only show when there are granted actions */}
          {grantedActions.length > 0 && (
            <div className="flex items-center gap-1 mb-1">
              <button
                onClick={() => setActiveTab('slots')}
                className={`text-[10px] px-2.5 py-1 rounded-t-md border border-b-0 transition-colors
                  ${activeTab === 'slots'
                    ? 'bg-gray-900/95 text-amber-400 border-gray-700/60'
                    : 'bg-gray-800/60 text-gray-500 border-gray-700/30 hover:text-gray-300'}`}
              >
                快捷栏
              </button>
              <button
                onClick={() => setActiveTab('spell_actions')}
                className={`text-[10px] px-2.5 py-1 rounded-t-md border border-b-0 transition-colors flex items-center gap-1
                  ${activeTab === 'spell_actions'
                    ? 'bg-gray-900/95 text-amber-400 border-gray-700/60'
                    : 'bg-gray-800/60 text-gray-500 border-gray-700/30 hover:text-gray-300'}`}
              >
                <span>✦</span> 法术动作
                <span className="text-[8px] bg-amber-900/40 text-amber-400/80 px-1 rounded">{grantedActions.length}</span>
              </button>
            </div>
          )}

          {/* Slots tab content */}
          {activeTab === 'slots' && (
            <div className="flex items-center relative w-full">
              {canScrollLeft && (
                <button
                  onClick={() => scrollBy(-1)}
                  className="flex-shrink-0 w-7 h-14 flex items-center justify-center
                             bg-gray-800/95 hover:bg-gray-700 border border-gray-600/60
                             border-r-0 rounded-l-lg text-gray-400 hover:text-amber-400
                             transition-colors z-10"
                  aria-label="向左滚动"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              <div
                ref={scrollCallbackRef}
                className={`flex items-center gap-2 md:gap-2.5 px-2.5 md:px-3 py-2 md:py-2.5
                            bg-gray-900/95 backdrop-blur-sm border border-gray-700/60
                            shadow-xl shadow-black/40 overflow-x-auto scrollbar-hide
                            ${canScrollLeft ? 'rounded-r-xl' : 'rounded-xl'}
                            ${canScrollRight ? '!rounded-r-none' : ''}`}
              >
                {!canScrollLeft && (
                  <div className="hidden md:block absolute -left-1 top-1/2 -translate-y-1/2 w-1.5 h-8
                                  bg-gradient-to-b from-amber-600/60 via-amber-500/40 to-amber-600/60 rounded-full z-10" />
                )}
                {!canScrollRight && (
                  <div className="hidden md:block absolute -right-1 top-1/2 -translate-y-1/2 w-1.5 h-8
                                  bg-gradient-to-b from-amber-600/60 via-amber-500/40 to-amber-600/60 rounded-full z-10" />
                )}
                {displaySlots.map((slot, i) => (
                  <div key={i} className={`relative flex-shrink-0 rounded-lg transition-all duration-100 ${dragOverSlotIdx === i ? 'ring-2 ring-amber-400 scale-105' : ''}`}
                    data-hotbar-slot={i}
                    onDragOver={(e) => {
                      if (i === 0) return; // Slot 0 locked
                      if (e.dataTransfer.types.includes('application/hotbar-item')) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDragOverSlotIdx(i);
                      }
                    }}
                    onDragLeave={() => setDragOverSlotIdx(null)}
                    onDrop={(e) => {
                      if (i === 0) return; // Slot 0 locked
                      const raw = e.dataTransfer.getData('application/hotbar-item');
                      setDragOverSlotIdx(null);
                      if (!raw) return;
                      e.preventDefault();
                      e.stopPropagation();
                      try {
                        const item = JSON.parse(raw) as HotbarSlot;
                        setSlot(i, item);
                      } catch { /* ignore */ }
                    }}
                  >
                    <HotbarSlotItem
                      slot={slot}
                      index={i}
                      characterId={character?.id}
                      classResources={classResources}
                      spellSlotInfo={spellSlotInfo}
                      abilityScores={character?.ability_scores}
                      characterLevel={character?.level}
                      eldritchInvocations={
                        (character?.eldritch_invocations || [])
                          .map((i: any) => typeof i === 'string' ? i : i.value || i.id || '')
                      }
                      isActive={activeSlotIndex === i}
                      onClear={() => { if (i !== 0) clearSlot(i); }}
                      onClick={() => handleSlotClick(i)}
                      onUseResource={onUseResource}
                      onStartTargeting={onStartTargeting}
                      onStartSmiteTargeting={onStartSmiteTargeting}
                      onConsumeSpellSlot={onConsumeSpellSlot}
                      onCastSpell={onCastSpell}
                      concentrationSpellName={concentrationSpellName}
                      castingSpellName={castingSpellName}
                      classId={character?.class_id}
                      equipment={character?.equipment}
                      onConsumeMaterial={onConsumeMaterial}
                      isDM={isDM}
                      isSilenced={isSilenced}
                      isIncapacitated={isIncapacitated}
                      hasSomaticFreedom={hasSomaticFreedom}
                      onEquipmentAvatarGenerated={handleEquipmentAvatarGenerated}
                      locked={i === 0}
                    />
                    {!isMobile && i < 9 && (
                      <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2
                                       text-[9px] text-gray-500 font-mono">
                        {i + 1}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {canScrollRight && (
                <button
                  onClick={() => scrollBy(1)}
                  className="flex-shrink-0 w-7 h-14 flex items-center justify-center
                             bg-gray-800/95 hover:bg-gray-700 border border-gray-600/60
                             border-l-0 rounded-r-lg text-gray-400 hover:text-amber-400
                             transition-colors z-10"
                  aria-label="向右滚动"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* Spell Actions tab content */}
          {activeTab === 'spell_actions' && (() => {
            const byType: Record<string, typeof grantedActions> = {};
            for (const a of grantedActions) {
              const t = a.effect.actionType;
              (byType[t] ||= []).push(a);
            }
            const typeOrder = ['action', 'bonus_action', 'reaction'];
            const typeIcons: Record<string, string> = { action: '⚔️', bonus_action: '⚡', reaction: '🛡️' };
            return (
              <div className="w-full flex items-center gap-2 px-3 py-2 bg-gray-900/95 backdrop-blur-sm border border-gray-700/60
                              shadow-xl shadow-black/40 rounded-xl overflow-x-auto scrollbar-hide">
                {typeOrder.filter(t => byType[t]).map((t, ti) => (
                  <div key={t} className="flex items-center gap-1.5 flex-shrink-0">
                    {ti > 0 && <div className="w-px h-8 bg-gray-700/50 mx-1" />}
                    <span className="text-[8px] text-gray-500 whitespace-nowrap">{typeIcons[t]}</span>
                    {byType[t].map((action, i) => {
                      const needsTarget = actionNeedsTarget(action);
                      return (
                        <button
                          key={`${action.spellId}-${action.effect.actionKind}-${i}`}
                          className="flex-shrink-0 flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-lg
                                     bg-gray-800/60 border border-gray-700/40 hover:bg-amber-900/25
                                     hover:border-amber-700/40 transition-all group"
                          onClick={() => executeGrantedAction(action, character.id)}
                          title={getActionSummary(action)}
                        >
                          <span className="text-base">{action.effect.icon || '✦'}</span>
                          <div className="text-left min-w-0">
                            <div className="text-[10px] text-gray-200 group-hover:text-amber-300 whitespace-nowrap font-medium transition-colors">
                              {action.effect.actionName}
                            </div>
                            <div className="text-[8px] text-gray-500 whitespace-nowrap">{action.spellName}</div>
                          </div>
                          <span className="text-[9px] text-gray-600 group-hover:text-amber-400/70 transition-colors">
                            {needsTarget ? '🎯' : '▶'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-14 md:w-12 h-8 md:h-6 flex items-center justify-center pointer-events-auto
                   bg-gray-800/90 hover:bg-gray-700/90
                   border border-amber-700/50 border-b-0 hover:border-amber-600/70
                   rounded-t-md transition-colors duration-150"
        title={expanded ? '收起快捷栏' : '展开快捷栏'}
      >
        <svg
          className={`w-4 md:w-3.5 h-4 md:h-3.5 text-amber-500/80 hover:text-amber-400 transition-transform duration-200
                      ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {/* Picker modal */}
      {character && (
        <HotbarPickerModal
          open={pickerSlotIndex !== null}
          onClose={() => setPickerSlotIndex(null)}
          character={character}
          onSelect={handlePickerSelect}
        />
      )}
    </div>
  );
}
