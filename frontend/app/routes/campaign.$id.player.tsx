import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { MetaFunction } from "react-router";
import { TacticalMap } from "~/components/map/TacticalMap";
import { MapErrorBoundary } from "~/components/map/MapErrorBoundary";
import { ToolbarV2 } from "~/components/ui/ToolbarV2";
import { ChatPanel } from "~/components/ui/ChatPanel";
import { CharacterPanel } from "~/components/character/CharacterPanel";
import { CharacterCreationWizardV2 } from "~/components/character/CharacterCreationWizardV2";
import { CharacterImportDialog } from "~/components/character/CharacterImportDialog";
import { downloadCharacterMarkdown, downloadCharacterPDF } from "~/utils/characterExport";
import { ClassicCharacterCard } from "~/components/character/ClassicCharacterCard";
import { EnhancedLevelUpModal } from "~/components/character/EnhancedLevelUpModal";
import { RulesPanel } from "~/components/ui/RulesPanel";
import { CombatPanel } from "~/components/combat/CombatPanel";
import { CampaignHeader } from "~/components/campaign/CampaignHeader";
import { CharacterJoinModal } from "~/components/campaign/CharacterJoinModal";
import { VoicePanel } from "~/components/campaign/VoicePanel";
import { showGlobalToast } from "~/components/ui/Toast";
import { useVoiceStore } from "~/stores/voiceStore";
import { useCampaignMusicStore, MUSIC_TRACKS } from "~/stores/campaignMusicStore";
import { useWebSocket } from "~/hooks/useWebSocket";
import { useSidebarState } from "~/hooks/useSidebarState";
import { useUnreadChat } from "~/hooks/useUnreadChat";
import { usePhoneLikeLayout } from "~/hooks/usePhoneLikeLayout";
import { FloatingChatWindow } from "~/components/chat/FloatingChatWindow";
import { FloatingFilterPanels } from "~/components/chat/FloatingFilterPanel";
import { useCampaignShellBootstrap } from "~/campaign-shell/bootstrap/useCampaignShellBootstrap";
import {
  type CampaignAbilityConfirm,
  type CampaignHotbarConfirm,
  type CampaignHotbarTargeting,
} from "~/campaign-shell/hotbar/hotbarTypes";
import { useCampaignHotbarBindings } from "~/campaign-shell/hotbar/useCampaignHotbarBindings";
import {
  confirmDivineSmiteAction,
  confirmLayOnHandsAction,
} from "~/campaign-shell/hotbar/hotbarModalActions";
import { useCharacterCastingState } from "~/campaign-shell/hotbar/useCharacterCastingState";
import { useCampaignPanelOrchestration } from "~/campaign-shell/panel/useCampaignPanelOrchestration";
import { CampaignFloatingOverlayShell } from "~/campaign-shell/panel/CampaignFloatingOverlayShell";
import { CampaignRightSidebarShell } from "~/campaign-shell/panel/CampaignRightSidebarShell";
import { CampaignSidebarTabList } from "~/campaign-shell/panel/CampaignSidebarTabList";
import { useCampaignSidebarResize } from "~/campaign-shell/panel/useCampaignSidebarResize";
import { useCampaignSidebarTabs } from "~/campaign-shell/panel/useCampaignSidebarTabs";
import { bridgeCampaignRealtimeMessage } from "~/campaign-shell/realtime/campaignRealtimeBridge";
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import { resolveMultiTargetSpec } from "~/components/map/utils/multiTargetSpellUtils";
import { useMyCharacters, useCharacterDetails } from "~/hooks/usePlayerCharacters";
import {
  campaignQueryKeys,
  fetchCampaignMapSettings,
} from "~/queries/campaignQueries";
import { showCharacterBubble } from "~/utils/characterBubble";
import { showDamageNumber } from "~/components/map/DamageNumberOverlay";
import type { WorldTime } from "~/utils/timeUtils";
import { normalizeTime, DEFAULT_TIME, isSameWorldTime } from "~/utils/timeUtils";
import * as Tabs from "@radix-ui/react-tabs";
import * as Select from "@radix-ui/react-select";
import * as Dialog from "@radix-ui/react-dialog";
import * as Collapsible from "@radix-ui/react-collapsible";

// Equipment dialog imports
import { CharacterProvider } from "~/components/character/CharacterDisplay/context/CharacterContext";
import { useEquipment } from "~/components/character/CharacterDisplay/hooks/useEquipment";
import { useCurrency } from "~/components/character/CharacterDisplay/hooks/useCurrency";
import { useMapToken } from "~/components/character/CharacterDisplay/hooks/useMapToken";
import { EquipDialog } from "~/components/character/CharacterDisplay/sections/Equipment/EquipDialog";
import { BagDialog } from "~/components/character/CharacterDisplay/sections/Equipment/BagDialog";
import { ItemDetailModal } from "~/components/character/CharacterDisplay/sections/Equipment/ItemDetailModal";
import { CurrencyDialog } from "~/components/character/CharacterDisplay/sections/Currency/CurrencyDialog";
import { ProficiencyHelpDialog } from "~/components/character/CharacterDisplay/sections/Info/ProficiencyHelpDialog";
import { SpellsDialog } from "~/components/character/CharacterDisplay/sections/Spells/SpellsDialog";
import { ClassFeaturesDialog } from "~/components/character/CharacterDisplay/sections/ClassFeatures/ClassFeaturesDialog";
import { FloatingCharacterPanel } from "~/components/character/FloatingCharacterPanel";
import type { FloatingCharPanelConfig } from "~/hooks/useSidebarState";
import type { EquipSlot, EquipmentItem, Currency } from "~/components/character/CharacterDisplay/types/Character";
import type { Spell } from "~/components/character/CharacterDisplay/types/Spell";
import { useCharacterSpellcasting } from "~/hooks/useCharacterSpellcasting";
import { computeAll as computeDerivedAll } from "~/components/character/CharacterDisplay/utils/derived";
import { getFeatRuleOverrides } from "~/components/character/CharacterDisplay/utils/featEffects";
import { useAvatar } from "~/components/character/CharacterDisplay/hooks/useAvatar";
import { apiFetch } from "~/utils/api-client";
import { getAssetUrl } from "~/utils/asset-url";
import { LoadingScreen } from "~/components/ui/LoadingScreen";
import { API_BASE_URL } from "~/config/api";
import { Hotbar } from "~/components/hotbar/Hotbar";
import { HotbarAttackConfirmModal, computeAttackInfo } from "~/components/hotbar/HotbarAttackConfirmModal";
import { LayOnHandsConfirmModal } from "~/components/hotbar/LayOnHandsConfirmModal";
import { DivineSmiteConfirmModal } from "~/components/hotbar/DivineSmiteConfirmModal";
import type { HotbarSlot } from "~/components/character/CharacterDisplay/types/Character";
import { useTradeStore, emptyCurrency } from "~/stores/tradeStore";
import { TradeRequestNotification } from "~/components/trade/TradeRequestNotification";
import { TradeModal } from "~/components/trade/TradeModal";
import {
  findCharacterToken, setConcentrationOnToken,
  addSpellBuffToToken, hasOnHitWeaponBuff, spellToSpellOption,
  castSpellAction,
} from "~/utils/sidebarCasting";
import type { SpellCastData } from "~/components/spell/SpellCastActions";
import { analyzeSpellTargeting } from "~/components/ui/Rules_SpellDetail";
import { fetchCharacterResourcesCached } from "~/utils/characterResourcesCache";

import racesData from "~/data/rules/races.json";
import classesData from "~/data/rules/classes_with_structured_subclass_features.json";
import classResourcesData from "~/data/rules/class_resources.json";
import backgroundsData from "~/data/rules/backgrounds.json";
import skillsData from "~/data/rules/skills.json";
import spellcastingConfig from "~/data/rules/spellcasting.json";
import { getCurrentUserId } from "~/utils/user";
import { createLogger } from '~/utils/logger';
const logger = createLogger('campaign.$id.player');

// Resource → sound mapping for hotbar feature activation
const RESOURCE_SOUND_MAP: Record<string, string> = {
  rage: 'enhance_cast.mp3', bardic_inspiration: 'inspire_cast.mp3',
  channel_divinity_cleric: 'radiant_cast.mp3', wild_shape: 'summon_cast.mp3',
  second_wind: 'heal_cast.mp3', action_surge: 'enhance_cast.mp3',
  superiority_dice: 'force_cast.mp3', ki: 'enhance_cast.mp3',
  divine_sense: 'radiant_cast.mp3', lay_on_hands: 'heal_cast.mp3',
  channel_divinity_paladin: 'radiant_cast.mp3', sorcery_points: 'magic_cast.mp3',
  arcane_recovery: 'magic_cast.mp3', portent: 'psychic_cast.mp3',
  arcane_ward: 'shield_cast.mp3', tides_of_chaos: 'magic_cast.mp3',
  natural_recovery: 'magic_cast.mp3', shadow_arts: 'necrotic_cast.mp3',
  elemental_disciplines: 'zone_cast.mp3',
};

function playResourceSound(resourceId: string) {
  const file = RESOURCE_SOUND_MAP[resourceId] || 'magic_cast.mp3';
  const audio = new Audio(getAssetUrl(`sounds/spells/${file}`));
  audio.volume = 0.5;
  audio.play().catch(() => {});
}

// Find class resource by slot or resource ID
function findResourceByIdOrSlot(resourceIdOrSlot: string | HotbarSlot): { id: string; name: string } | null {
  const res = (classResourcesData as any).classResources as any[];
  if (typeof resourceIdOrSlot === 'string') {
    return res.find((r: any) => r.id === resourceIdOrSlot) || null;
  }
  return res.find((r: any) => resourceIdOrSlot.meta?.resourceId ? r.id === resourceIdOrSlot.meta.resourceId : (r.name === resourceIdOrSlot.name || r.nameEn === resourceIdOrSlot.id)) || null;
}

// Wrapper component for ClassicCharacterCard with equipment dialogs
interface ClassicCardWithEquipmentProps {
  character: any;
  campaignId: string;
  currentMapUrl: string | null;
  userId: string;
  isDM: boolean;
  onLevelUp: () => void;
  onCharacterUpdate: () => void;
  getSpellExpandedLevels?: (characterId: number) => Set<number>;
  toggleSpellExpandedLevel?: (characterId: number, level: number) => void;
  floatingCharPanel?: FloatingCharPanelConfig;
  setFloatingCharPanel?: (updates: Partial<FloatingCharPanelConfig>) => void;
}

function ClassicCardWithEquipment({
  character, campaignId, currentMapUrl, userId, isDM, onLevelUp, onCharacterUpdate,
  getSpellExpandedLevels, toggleSpellExpandedLevel,
  floatingCharPanel, setFloatingCharPanel
}: ClassicCardWithEquipmentProps) {
  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    showGlobalToast({ message, type });
  }, []);

  // Compute derived stats for spellcasting
  const derived = useMemo(() => computeDerivedAll(character, { hpOptions: { includeFlatSubraceHP: true, includeSubraceLevelBonuses: true } }), [character]);
  const race = useMemo(() =>
    (racesData as any).races?.find((r: any) => r.id === character.race_id),
    [character.race_id]
  );
  const subrace = useMemo(() =>
    race?.subraces?.find((s: any) => s.id === character.subrace_id),
    [race, character.subrace_id]
  );
  const finalAbilityScores = useMemo(() => {
    const base = character.ability_scores || {};
    const bonuses = race?.ability_bonuses || {};
    const subBonuses = subrace?.ability_bonuses || {};
    return {
      strength: (base.strength || 10) + (bonuses.strength || 0) + (subBonuses.strength || 0),
      dexterity: (base.dexterity || 10) + (bonuses.dexterity || 0) + (subBonuses.dexterity || 0),
      constitution: (base.constitution || 10) + (bonuses.constitution || 0) + (subBonuses.constitution || 0),
      intelligence: (base.intelligence || 10) + (bonuses.intelligence || 0) + (subBonuses.intelligence || 0),
      wisdom: (base.wisdom || 10) + (bonuses.wisdom || 0) + (subBonuses.wisdom || 0),
      charisma: (base.charisma || 10) + (bonuses.charisma || 0) + (subBonuses.charisma || 0),
    };
  }, [character.ability_scores, race, subrace]);
  const abilityMods = useMemo(() => ({
    strength: Math.floor((finalAbilityScores.strength - 10) / 2),
    dexterity: Math.floor((finalAbilityScores.dexterity - 10) / 2),
    constitution: Math.floor((finalAbilityScores.constitution - 10) / 2),
    intelligence: Math.floor((finalAbilityScores.intelligence - 10) / 2),
    wisdom: Math.floor((finalAbilityScores.wisdom - 10) / 2),
    charisma: Math.floor((finalAbilityScores.charisma - 10) / 2),
  }), [finalAbilityScores]);

  // Load spells data
  const [spellsAll, setSpellsAll] = useState<Spell[]>([]);
  useEffect(() => {
    import('~/data/rules/spells.json')
      .then(m => setSpellsAll((m.default as any).spells || []))
      .catch(() => setSpellsAll([]));
  }, []);

  // Persist function for equipment changes
  const persistCharacterPartial = useCallback(async (
    nextEquipment?: EquipmentItem[],
    nextPreparedSpells?: string[],
    nextCurrency?: Currency
  ) => {
    try {
      const payload: any = {};
      if (nextEquipment !== undefined) payload.equipment = nextEquipment;
      if (nextPreparedSpells !== undefined) payload.prepared_spells = nextPreparedSpells;
      if (nextCurrency !== undefined) payload.currency = nextCurrency;
      if (Object.keys(payload).length === 0) return false;
      if (campaignId) payload.broadcast_campaign_id = campaignId;

      const resp = await fetch(`${API_BASE_URL}/api/characters/${character.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error("Failed to persist");
      onCharacterUpdate();
      return true;
    } catch (e) {
      logger.error("Persist character partial error:", e);
      return false;
    }
  }, [campaignId, character.id, onCharacterUpdate]);

  // Use the equipment hook
  const equipment = useEquipment({
    character,
    campaignId,
    currentMapUrl,
    persistCharacterPartial,
    showToast,
  });

  // Use the currency hook
  const currency = useCurrency({
    character,
    persistCharacterPartial,
  });

  // Use the map token hook (for hasTokenOnMap check)
  const mapToken = useMapToken({
    character,
    campaignId,
    currentMapUrl,
    userId,
  });

  // Proficiency help dialog state
  const [profHelpOpen, setProfHelpOpen] = useState(false);
  const [profHelpType, setProfHelpType] = useState<'weapon' | 'armor'>('weapon');

  // Floating character panel: status tab portal container
  const statusContainerRef = useRef<HTMLDivElement | null>(null);
  const [statusContainer, setStatusContainer] = useState<HTMLDivElement | null>(null);
  const statusContainerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    statusContainerRef.current = el;
    setStatusContainer(el);
  }, []);

  // Spellcasting state and dialog
  const [spellsDialogOpen, setSpellsDialogOpen] = useState(false);
  const [concConflict, setConcConflict] = useState<{
    spell: Spell; level: number; tokenId: number; currentSpellName: string;
  } | null>(null);
  const {
    isSpellcaster,
    isPreparedCaster,
    cantripsLocal,
    knownSpells,
    preparedLocal,
    preparedMax,
    preparedCount,
    togglePreparedWithLimit,
    setPreparedSpellsAndPersist,
    autoPrepared,
    spellcasting,
    spellSlotsState,
  } = useCharacterSpellcasting({
    character,
    abilityMods,
    proficiencyBonus: derived.proficiencyBonus,
    spellsAll,
    persistCharacterPartial,
    campaignId,
    refetchCharacter: onCharacterUpdate,
  });

  // Cast spell — delegate to unified castSpellAction (slot deduction handled by backend or legacy path)
  const handleCastSpell = useCallback(async (data: SpellCastData) => {
    await castSpellAction(data.spell, data.level, character.id, {
      campaignId, currentMapUrl, userId,
      spellSaveDC: spellcasting?.spellSaveDC ?? undefined,
      freecast: data.freecast,
      ritualCast: data.ritualCast,
      confirmBreakConcentration: data.confirmBreakConcentration,
      illusionImageUrl: data.illusionData?.imageUrl,
      illusionDesc: data.illusionData?.description,
      illusionDisplayName: data.illusionData?.displayName,
      areaSize: data.areaSize,
      selectedOption: data.selectedOption,
      materialId: data.materialId,
      targetingMode: data.targetingMode,
    });
  }, [character.id, campaignId, currentMapUrl, userId, spellcasting?.spellSaveDC]);

  const confirmConcentrationReplace = useCallback(async () => {
    if (!concConflict) return;
    const { spell, level, tokenId } = concConflict;
    setConcConflict(null);
    await setConcentrationOnToken(tokenId, spell, level, userId);
    if (hasOnHitWeaponBuff(spell)) {
      await addSpellBuffToToken(tokenId, spell, level, [], userId);
    }
  }, [concConflict, userId]);

  // Listen for consumeSpellSlot events from Hotbar (which lives in PlayerView scope)
  useEffect(() => {
    return subscribeAppEvent("consumeSpellSlot", ({ level, characterId }) => {
      if (characterId === character.id && typeof level === 'number') {
        spellSlotsState.consumeSlot(level);
      }
    });
  }, [character.id, spellSlotsState]);

  // Listen for spell_slots_update from backend (after spell cast via unified API)
  useEffect(() => {
    const maxSpellSlots = spellcasting?.spellSlots ?? [];
    const handler = (detail: any) => {
      const { character_id, spell_slots_state } = detail || {};
      if (character_id === character.id && Array.isArray(spell_slots_state)) {
        spellSlotsState.setRemainingSlots(spell_slots_state);
        publishAppEvent("spellSlotsChanged", {
          characterId: character.id,
          remaining: spell_slots_state,
          max: maxSpellSlots,
        });
      }
    };
    return subscribeAppEvent("spellSlotsUpdate", handler);
  }, [character.id, spellSlotsState, spellcasting]);

  // Somatic freedom and silenced status for SpellsDialog
  const featIds = useMemo(() => (character.feats || []).map((f: any) => typeof f === 'string' ? f : f.id || ''), [character.feats]);
  const hasSomaticFreedom = useMemo(() => getFeatRuleOverrides(featIds).has('somatic_with_hands_full'), [featIds]);
  const isSilenced = useMemo(() => {
    const raw = (character as any).status_effects || [];
    return Array.isArray(raw) ? raw.some((e: any) => (e.condition || e.id || e) === 'silenced') : false;
  }, [(character as any).status_effects]);

  // Avatar editing state and hook
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [avatarLibrary, setAvatarLibrary] = useState<string[]>([]);
  const { genLoading, regenEquipLoading, handleGenerateAvatar, handleUploadAvatar, handleRegenerateWithEquipment } = useAvatar({
    character,
    userId,
    onAvatarUpdated: onCharacterUpdate,
    equipmentLocal: equipment.equipmentLocal,
  });

  // Fetch class resources for feature usage display
  const [classResources, setClassResources] = useState<any[] | undefined>(undefined);
  const [resourceRefreshKey, setResourceRefreshKey] = useState(0);

  useEffect(() => {
    const handler = (detail: any) => {
      const charId = detail?.characterId;
      if (!charId || charId === character?.id) setResourceRefreshKey(k => k + 1);
    };
    return subscribeAppEvent("classFeatureUsesUpdated", handler);
  }, [character?.id]);

  useEffect(() => {
    if (!character?.id) { setClassResources(undefined); return; }
    let cancelled = false;
    fetchCharacterResourcesCached(character.id, { userId })
      .then((resources) => {
        if (!cancelled) setClassResources(resources);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [character.id, character.level, JSON.stringify(character.class_feature_uses || {}), userId, resourceRefreshKey]);

  // Beast companion on-map tracking
  const [companionOnMap, setCompanionOnMap] = useState(false);
  const hasBeast = !!character.subclass_choices?.beastCompanion;
  useEffect(() => {
    if (!hasBeast || !currentMapUrl || !campaignId) { setCompanionOnMap(false); return; }
    let cancelled = false;
    apiFetch(`/api/tokens/campaign/${campaignId}/map?map_url=${encodeURIComponent(currentMapUrl)}`)
      .then(async resp => {
        if (cancelled || !resp.ok) return;
        const data = await resp.json();
        const tokens: any[] = data.tokens || data;
        setCompanionOnMap(tokens.some((t: any) => t.controller_character_id === character.id && t.control_type === 'companion'));
      }).catch((e) => { logger.warn('Companion detection error:', e); });
    const onPlaced = (detail: any) => {
      const tk = detail?.token;
      if (tk?.controller_character_id === character.id && tk?.control_type === 'companion') setCompanionOnMap(true);
    };
    const onRemoved = () => {
      if (!currentMapUrl || !campaignId) return;
      apiFetch(`/api/tokens/campaign/${campaignId}/map?map_url=${encodeURIComponent(currentMapUrl)}`)
        .then(async resp => {
          if (cancelled || !resp.ok) return;
          const data = await resp.json();
          const tokens: any[] = data.tokens || data;
          setCompanionOnMap(tokens.some((t: any) => t.controller_character_id === character.id && t.control_type === 'companion'));
        }).catch(() => {});
    };
    const unsubscribePlaced = subscribeAppEvent("tokenPlaced", onPlaced);
    const unsubscribeRemoved = subscribeAppEvent("tokenRemoved", onRemoved);
    return () => {
      cancelled = true;
      unsubscribePlaced();
      unsubscribeRemoved();
    };
  }, [currentMapUrl, campaignId, character.id, hasBeast]);

  // Class features dialog state
  const [classFeaturesOpen, setClassFeaturesOpen] = useState(false);
  const charClass = useMemo(() =>
    (classesData as any).classes?.find((c: any) => c.id === character.class_id),
    [character.class_id]
  );
  const subclass = useMemo(() =>
    charClass?.subclasses?.find((s: any) => s.id === (character.subclass_id?.split(',')[0] || character.subclass_id)),
    [charClass, character.subclass_id]
  );
  const allSubclasses = useMemo(() => {
    if (!charClass?.subclasses || !character.subclass_id) return [];
    const ids = character.subclass_id.split(',').filter(Boolean);
    return ids.map((id: string) => charClass.subclasses.find((s: any) => s.id === id)).filter(Boolean);
  }, [charClass, character.subclass_id]);
  const background = useMemo(() =>
    (backgroundsData as any).backgrounds?.find((b: any) => b.id === character.background_id),
    [character.background_id]
  );
  const skillsById = useMemo(() => {
    const map = new Map<string, string>();
    ((skillsData as any).skills || []).forEach((s: any) => map.set(s.id, s.name));
    return map;
  }, []);
  const selectedSkills = useMemo(() => {
    const skills = character.selected_skills || character.selectedSkills || [];
    return skills.map((s: any) => typeof s === 'string' ? s : s.value);
  }, [character.selected_skills, character.selectedSkills]);
  const raceChoiceSkills = useMemo(() => {
    const choices = character.race_choices || character.raceChoices || {};
    return choices.skill_proficiencies || [];
  }, [character.race_choices, character.raceChoices]);
  const subclassChoiceSkillsRaw = useMemo(() => {
    const choices = character.subclass_choices || character.subclassChoices || {};
    return choices.skill_proficiencies || [];
  }, [character.subclass_choices, character.subclassChoices]);

  // Concentration tracking for SpellsDialog
  const [concentrationSpellId, setConcentrationSpellId] = useState<string | null>(null);
  const [concentrationSpellName, setConcentrationSpellName] = useState<string | null>(null);
  const [castingSpellName, setCastingSpellName] = useState<string | null>(null);
  useEffect(() => {
    if (!currentMapUrl || !campaignId) { setConcentrationSpellId(null); setConcentrationSpellName(null); setCastingSpellName(null); return; }
    findCharacterToken(character.id, campaignId, currentMapUrl, userId)
      .then(result => {
        setConcentrationSpellId(result?.data?.concentration_spell?.spell_id || null);
        setConcentrationSpellName(result?.data?.concentration_spell?.spell_name || null);
        setCastingSpellName(result?.data?.casting_in_progress?.spell_name || null);
      }).catch(() => { setConcentrationSpellId(null); setConcentrationSpellName(null); setCastingSpellName(null); });
  }, [character.id, campaignId, currentMapUrl, userId]);
  useEffect(() => {
    const handler = (detail: any) => {
      if (detail?.characterId === character.id) {
        setConcentrationSpellId(detail.concentrationSpell?.spell_id || null);
        setConcentrationSpellName(detail.concentrationSpell?.spell_name || null);
      }
    };
    return subscribeAppEvent("characterConcentrationChanged", handler);
  }, [character.id]);

  useEffect(() => {
    const handler = (detail: any) => {
      if (detail?.characterId === character.id) {
        setCastingSpellName(detail.castingInProgress?.spell_name || null);
      }
    };
    return subscribeAppEvent("characterCastingChanged", handler);
  }, [character.id]);

  return (
    <CharacterProvider
      character={character}
      campaignId={campaignId}
      currentMapUrl={currentMapUrl}
      userId={userId}
      isDM={isDM}
      showToast={showToast}
      persistCharacterPartial={persistCharacterPartial}
    >
      <ClassicCharacterCard
        character={character}
        campaignId={campaignId}
        currentMapUrl={currentMapUrl}
        classResources={classResources}
        slotStateManagedByParent
        onAvatarClick={() => setAvatarModalOpen(true)}
        onLevelUp={onLevelUp}
        onStartAbilityTargeting={(abilityId, poolCurrent, poolMax) => {
          publishAppEvent("startAbilityTargeting", {
            abilityId,
            poolCurrent,
            poolMax,
            sourceCharacterId: character.id,
          });
        }}
        onStartSmiteTargeting={(abilityId, spellSlotLevel) => {
          publishAppEvent("startAbilityTargeting", {
            abilityId,
            poolCurrent: 0,
            poolMax: 0,
            sourceCharacterId: character.id,
            spellSlotLevel,
          });
        }}
        onUseBreathWeapon={(params) => {
          publishAppEvent("startBreathWeapon", { sourceCharacterId: character.id, ...params });
        }}
        onOpenEquipment={(slot) => {
          if (slot) {
            equipment.openEquip(slot);
          }
        }}
        onOpenBag={() => {
          if (setFloatingCharPanel) {
            setFloatingCharPanel({ stage: 'open', activeTab: 'equipment' });
          } else {
            equipment.setBagOpen(true);
          }
        }}
        onOpenSpells={() => {
          if (setFloatingCharPanel) {
            setFloatingCharPanel({ stage: 'open', activeTab: 'spells' });
          } else {
            setSpellsDialogOpen(true);
          }
        }}
        onOpenFeatures={() => {
          if (setFloatingCharPanel) {
            setFloatingCharPanel({ stage: 'open', activeTab: 'features' });
          } else {
            setClassFeaturesOpen(true);
          }
        }}
        onOpenStatusEffects={setFloatingCharPanel ? () => {
          setFloatingCharPanel({ stage: 'open', activeTab: 'status' });
        } : undefined}
        floatingStatusActive={floatingCharPanel?.stage === 'open' && floatingCharPanel?.activeTab === 'status'}
        floatingStatusContainer={statusContainer}
        isSpellcaster={isSpellcaster}
        spellsAll={spellsAll}
        cantripsLocal={cantripsLocal}
        preparedLocal={preparedLocal}
        spellcasting={spellcasting}
        remainingSlots={spellSlotsState.remainingSlots}
        onConsumeSlot={spellSlotsState.consumeSlot}
        isCompanionOnMap={companionOnMap}
        onSummonCompanion={hasBeast ? async () => {
          if (!currentMapUrl) return;
          try {
            const resp = await apiFetch('/api/monster-instances/summon-companion', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ character_id: character.id, campaign_id: parseInt(campaignId), map_url: currentMapUrl }),
              userId,
            });
            if (resp.ok) setCompanionOnMap(true);
          } catch (e) { logger.error('Summon companion error:', e); }
        } : undefined}
        onDismissCompanion={hasBeast ? async () => {
          if (!currentMapUrl) return;
          try {
            const resp = await apiFetch('/api/monster-instances/dismiss-companion', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ character_id: character.id, campaign_id: parseInt(campaignId), map_url: currentMapUrl }),
              userId,
            });
            if (resp.ok) setCompanionOnMap(false);
          } catch (e) { logger.error('Dismiss companion error:', e); }
        } : undefined}
        spellExpandedLevels={getSpellExpandedLevels?.(character.id)}
        onToggleSpellLevel={toggleSpellExpandedLevel ? (level: number) => toggleSpellExpandedLevel(character.id, level) : undefined}
        castingSpellName={castingSpellName}
      />
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

      {/* Bag Dialog */}
      <BagDialog
        open={equipment.bagOpen}
        onOpenChange={equipment.setBagOpen}
        setCurrencyDialogOpen={currency.setCurrencyDialogOpen}
        currencyLocal={currency.currencyLocal}
        equipmentLocal={equipment.equipmentLocal}
        openEquip={equipment.openEquip}
        getEquipped={equipment.getEquipped}
        applyEquip={equipment.applyEquipDirect}
        onEquipmentUpdate={async (items, curr) => {
          equipment.setEquipmentLocal(items);
          currency.setCurrencyLocal(curr);
          await persistCharacterPartial(items, undefined, curr);
        }}
        isContainer={equipment.isContainer}
        getContainerContents={equipment.getContainerContents}
        handlePutInContainer={equipment.handlePutInContainer}
        handleTakeOutOfContainer={equipment.handleTakeOutOfContainer}
        handleStackItems={equipment.handleStackItems}
        handleSplitStack={equipment.splitStackDirect}
        handleMergeStacks={equipment.mergeStacksDirect}
        handleDiscardItem={equipment.discardItemDirect}
        hasTokenOnMap={mapToken.hasTokenOnMap}
        onToggleGrip={equipment.toggleGripMode}
        onRegenerateAvatar={handleRegenerateWithEquipment}
        avatarRegenerating={regenEquipLoading}
        onUseConsumable={async (item) => {
          const maxHp = derived.hp || 0;
          const currentHp = typeof character.current_hp === 'number' ? character.current_hp : maxHp;
          await equipment.useConsumableDirect(item, currentHp, maxHp);
        }}
        isPaperItem={equipment.isPaperItem}
        onWriteOnPaper={equipment.handleWriteOnPaper}
        onEditWrittenPaper={equipment.handleEditWrittenPaper}
        onCopyPaper={equipment.handleCopyPaper}
      />

      {/* Item Detail Modal */}
      <ItemDetailModal
        open={equipment.itemDetailOpen}
        onOpenChange={equipment.setItemDetailOpen}
        selectedItem={equipment.selectedItem}
        setProfHelpType={setProfHelpType}
        setProfHelpOpen={setProfHelpOpen}
        organizedPacks={equipment.selectedItem ? (equipment.organizedPacks[equipment.selectedItem.id] || []) : []}
        organizeLoading={equipment.organizeLoading}
        handleOrganizePack={async () => { if (equipment.selectedItem) { await equipment.handleOrganizePack(equipment.selectedItem); } }}
        handleExtractFromPack={(extractedItem) => { if (equipment.selectedItem) { void equipment.handleExtractFromPack(equipment.selectedItem, extractedItem); } }}
        splitQty={equipment.splitQty}
        setSplitQty={equipment.setSplitQty}
        handleSplitStack={equipment.handleSplitStack}
        splitLoading={equipment.splitLoading}
        handleMergeStacks={equipment.handleMergeStacks}
        mergeLoading={equipment.mergeLoading}
        discardQuantity={equipment.discardQuantity}
        setDiscardQuantity={equipment.setDiscardQuantity}
        hasTokenOnMap={mapToken.hasTokenOnMap}
        discardLoading={equipment.discardLoading}
        handleDiscardItem={equipment.handleDiscardItem}
        currentMapUrl={currentMapUrl}
      />

      {/* Currency Dialog */}
      <CurrencyDialog
        open={currency.currencyDialogOpen}
        onOpenChange={currency.setCurrencyDialogOpen}
        currencyLocal={currency.currencyLocal}
        setCurrencyLocal={currency.setCurrencyLocal}
        handleSaveCurrency={currency.handleSaveCurrency}
      />

      {/* Proficiency Help Dialog */}
      <ProficiencyHelpDialog
        open={profHelpOpen}
        onOpenChange={setProfHelpOpen}
        type={profHelpType}
      />

      {/* Spells Dialog */}
      {isSpellcaster && spellcasting && (
        <SpellsDialog
          open={spellsDialogOpen}
          onOpenChange={setSpellsDialogOpen}
          isPreparedCaster={isPreparedCaster}
          cantripsLocal={cantripsLocal}
          knownSpells={knownSpells}
          preparedLocal={preparedLocal}
          preparedCount={preparedCount}
          preparedMax={preparedMax}
          togglePreparedWithLimit={togglePreparedWithLimit}
          setPreparedSpellsAndPersist={setPreparedSpellsAndPersist}
          spellsAll={spellsAll}
          spellcastingAbilityLabel={spellcasting.abilityLabel}
          spellcastingAbilityId={spellcasting.abilityId}
          spellcasterType={spellcasting.type}
          spellSaveDC={spellcasting.spellSaveDC}
          spellAttackStr={spellcasting.spellAttackStr}
          spellSlots={spellcasting.spellSlots}
          remainingSlots={spellSlotsState.remainingSlots}
          autoPrepared={autoPrepared}
          onConsumeSlot={spellSlotsState.consumeSlot}
          onCastSpell={handleCastSpell}
          canPrepareSpells={spellSlotsState.canPrepareSpells}
          onPreparationFinished={spellSlotsState.markPreparationUsed}
          eldritchInvocations={
            (character.eldritch_invocations || (character as any).eldritchInvocations || [])
              .map((i: any) => typeof i === 'string' ? i : i.value || i.id || '')
          }
          charismaMod={abilityMods.charisma ?? 0}
          concentratingSpellId={concentrationSpellId}
          concentratingSpellName={concentrationSpellName}
        />
      )}

      {/* Concentration conflict confirmation */}
      {concConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-amber-700/40 rounded-lg p-5 max-w-sm mx-4">
            <p className="text-amber-200 text-sm mb-3">
              当前正在专注「{concConflict.currentSpellName}」，施放「{concConflict.spell.name}」将替换专注。
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConcConflict(null)}
                className="px-3 py-1.5 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600">取消</button>
              <button onClick={confirmConcentrationReplace}
                className="px-3 py-1.5 text-xs rounded bg-amber-700 text-white hover:bg-amber-600">替换专注</button>
            </div>
          </div>
        </div>
      )}

      {/* Class Features Dialog */}
      <ClassFeaturesDialog
        open={classFeaturesOpen}
        onOpenChange={setClassFeaturesOpen}
        character={character}
        race={race}
        subrace={subrace}
        charClass={charClass}
        subclass={subclass}
        allSubclasses={allSubclasses}
        background={background}
        selectedSkills={selectedSkills}
        raceChoiceSkills={raceChoiceSkills}
        subclassChoiceSkillsRaw={subclassChoiceSkillsRaw}
        skillsById={skillsById}
      />

      {/* Floating Character Panel */}
      {floatingCharPanel && setFloatingCharPanel && floatingCharPanel.stage !== 'closed' && (
        <FloatingCharacterPanel
          config={floatingCharPanel}
          setConfig={setFloatingCharPanel}
          characterName={character.name}
          equipmentContent={() =>
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
                currency.setCurrencyLocal(cur);
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
              hasTokenOnMap={mapToken.hasTokenOnMap}
              onToggleGrip={equipment.toggleGripMode}
              onRegenerateAvatar={handleRegenerateWithEquipment}
              avatarRegenerating={regenEquipLoading}
              onUseConsumable={async (item) => {
                const maxHp = derived.hp || 0;
                const currentHp = typeof character.current_hp === 'number' ? character.current_hp : maxHp;
                await equipment.useConsumableDirect(item, currentHp, maxHp);
              }}
              isPaperItem={equipment.isPaperItem}
              onWriteOnPaper={equipment.handleWriteOnPaper}
              onEditWrittenPaper={equipment.handleEditWrittenPaper}
              onCopyPaper={equipment.handleCopyPaper}
              embedded
            />
          }
          featuresContent={() =>
            <ClassFeaturesDialog
              open={true}
              onOpenChange={() => {}}
              character={character}
              race={race}
              subrace={subrace}
              charClass={charClass}
              subclass={subclass}
              allSubclasses={allSubclasses}
              background={background}
              selectedSkills={selectedSkills}
              raceChoiceSkills={raceChoiceSkills}
              subclassChoiceSkillsRaw={subclassChoiceSkillsRaw}
              skillsById={skillsById}
              embedded
            />
          }
          statusContent={() =>
            <div ref={statusContainerCallbackRef} className="h-full" />
          }
          spellsContent={isSpellcaster && spellcasting ? () => (
            <div className="h-full overflow-y-auto">
              <SpellsDialog
                open={true}
                onOpenChange={() => {}}
                isPreparedCaster={isPreparedCaster}
                classId={character.class_id}
                cantripsLocal={cantripsLocal}
                knownSpells={knownSpells}
                preparedLocal={preparedLocal}
                preparedCount={preparedCount}
                preparedMax={preparedMax}
                togglePreparedWithLimit={togglePreparedWithLimit}
                setPreparedSpellsAndPersist={setPreparedSpellsAndPersist}
                spellsAll={spellsAll}
                spellcastingAbilityLabel={spellcasting.abilityLabel}
                spellcastingAbilityMod={spellcasting.abilityMod}
                spellcastingAbilityId={spellcasting.abilityId}
                spellcasterType={spellcasting.type}
                spellSaveDC={spellcasting.spellSaveDC}
                spellAttackStr={spellcasting.spellAttackStr}
                spellSlots={spellcasting.spellSlots}
                remainingSlots={spellSlotsState.remainingSlots}
                autoPrepared={autoPrepared}
                onConsumeSlot={spellSlotsState.consumeSlot}
                onCastSpell={handleCastSpell}
                canPrepareSpells={spellSlotsState.canPrepareSpells}
                onPreparationFinished={spellSlotsState.markPreparationUsed}
                eldritchInvocations={
                  (character.eldritch_invocations || (character as any).eldritchInvocations || [])
                    .map((i: any) => typeof i === 'string' ? i : i.value || i.id || '')
                }
                charismaMod={abilityMods.charisma ?? 0}
                equipment={equipment.equipmentLocal}
                isSilenced={isSilenced}
                hasSomaticFreedom={hasSomaticFreedom}
                concentratingSpellId={concentrationSpellId}
                concentratingSpellName={concentrationSpellName}
                embedded
              />
            </div>
          ) : undefined}
        />
      )}

      {/* Avatar Modal */}
      <Dialog.Root open={avatarModalOpen} onOpenChange={setAvatarModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/70 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-2xl bg-gray-900 border border-gray-700 rounded p-6 space-y-4 z-50">
            <Dialog.Title className="text-lg font-semibold text-gray-300">角色头像</Dialog.Title>

            {character.avatar && (
              <div className="flex justify-center">
                <img
                  src={character.avatar}
                  alt={character.name}
                  className="max-w-md max-h-96 rounded-lg border-2 border-amber-400 object-contain"
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button
                className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                onClick={() => {
                  handleUploadAvatar();
                  setAvatarModalOpen(false);
                }}
              >
                📤 上传图片
              </button>
              <button
                className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 rounded text-sm"
                onClick={async () => {
                  await handleGenerateAvatar();
                  setAvatarModalOpen(false);
                }}
                disabled={genLoading}
              >
                {genLoading ? "生成中..." : "🎨 AI生成"}
              </button>
              <button
                className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                onClick={async () => {
                  try {
                    const resp = await apiFetch(`/api/characters/avatar-library`);
                    if (resp.ok) {
                      const entries = await resp.json();
                      const avatars = entries
                        .map((e: { avatar_url: string }) => e.avatar_url)
                        .filter((url: string) => url && url !== character.avatar);
                      setAvatarLibrary(avatars);
                    }
                  } catch (e) {
                    logger.error("Failed to load avatar library:", e);
                  }
                }}
              >
                📚 头像库
              </button>
            </div>

            {avatarLibrary.length > 0 && (
              <div>
                <div className="text-sm text-gray-400 mb-2">选择已有头像：</div>
                <div className="grid grid-cols-4 md:grid-cols-6 gap-2 max-h-64 overflow-auto">
                  {avatarLibrary.map((av, idx) => (
                    <button
                      key={idx}
                      className="aspect-square rounded border-2 border-gray-700 hover:border-amber-400 overflow-hidden transition-colors"
                      onClick={async () => {
                        try {
                          const patch = await apiFetch(`/api/characters/${character.id}/avatar`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ avatar: av })
                          });
                          if (patch.ok) {
                            onCharacterUpdate();
                            setAvatarModalOpen(false);
                            setAvatarLibrary([]);
                          }
                        } catch (e) {
                          logger.error("Failed to set avatar:", e);
                        }
                      }}
                    >
                      <img src={av} alt={`头像 ${idx + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="text-right">
              <button
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                onClick={() => {
                  setAvatarModalOpen(false);
                  setAvatarLibrary([]);
                }}
              >
                关闭
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </CharacterProvider>
  );
}

export const meta: MetaFunction = () => {
  return [{ title: "玩家视图 - DND 5E" }];
};

export default function PlayerView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loadMapSettings = useCallback(async (mapUrl: string) => {
    if (!id || !mapUrl) return null;
    return queryClient.fetchQuery({
      queryKey: campaignQueryKeys.mapSettings(id, mapUrl),
      queryFn: () => fetchCampaignMapSettings(id, mapUrl),
      staleTime: 10_000,
    }).catch(() => null);
  }, [id, queryClient]);
  const isPhoneLike = usePhoneLikeLayout();
  const [selectedTool, setSelectedTool] = useState<string>("move");
  const [showGrid, setShowGrid] = useState(true);
  const [showAIMarkers, setShowAIMarkers] = useState(true);
  const [isClient, setIsClient] = useState(false);
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [isSidebarFullscreen, setIsSidebarFullscreen] = useState(false);
  const [isDM, setIsDM] = useState(false);
  const [enableDeitySystem, setEnableDeitySystem] = useState(true);
  const [enable3DDice, setEnable3DDice] = useState(true);
  const [campaignName, setCampaignName] = useState<string>('');
  const [userId, setUserId] = useState<string>(() => getCurrentUserId());
  const [currentMapUrl, setCurrentMapUrl] = useState<string | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
  const [hotbarTargeting, setHotbarTargeting] = useState<CampaignHotbarTargeting | null>(null);
  const spellHotbarIndexRef = useRef(-1);
  const [hotbarConfirm, setHotbarConfirm] = useState<CampaignHotbarConfirm | null>(null);
  const [abilityConfirm, setAbilityConfirm] = useState<CampaignAbilityConfirm | null>(null);
  // Map transition state - completely hide TacticalMap during character switch to avoid Konva race conditions
  const [isMapTransitioning, setIsMapTransitioning] = useState(false);
  const mapTransitionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Wrapper that handles character switch with map transition
  // Two-phase approach: first unmount old TacticalMap completely, then mount new one
  // skipTransition: if true, directly set character ID without animation (used for initial load)
  const handleCharacterChange = useCallback((newCharacterId: number | null, skipTransition?: boolean) => {
    // Clear any pending transition
    if (mapTransitionTimeoutRef.current) {
      clearTimeout(mapTransitionTimeoutRef.current);
    }

    // Skip transition animation on initial load (no Konva Stage to unmount yet)
    if (skipTransition) {
      setSelectedCharacterId(newCharacterId);
      setIsMapTransitioning(false);
      return;
    }

    // Phase 1: Start transition and clear character ID to force full unmount
    setIsMapTransitioning(true);
    setSelectedCharacterId(null);

    // Phase 2: After a frame, set the new character ID
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSelectedCharacterId(newCharacterId);

        // Phase 3: After another delay, end transition
        mapTransitionTimeoutRef.current = setTimeout(() => {
          setIsMapTransitioning(false);
        }, 100);
      });
    });
  }, []);
  const [hasMyTokenOnMap, setHasMyTokenOnMap] = useState(false);
	const [tokenPresenceRefresh, setTokenPresenceRefresh] = useState(0);
  const [mapImageScale, setMapImageScale] = useState<number>(1);
  const [globalTerrain, setGlobalTerrain] = useState<string | null>(null);
  const [mapTransform, setMapTransform] = useState<{ rotation: number; flipH: boolean; flipV: boolean }>({
    rotation: 0,
    flipH: false,
    flipV: false,
  });
  const [rulerMode, setRulerMode] = useState<"measure" | "circle" | "erase" | null>(null); // 测距模式
  const [drawTool, setDrawTool] = useState<"circle" | "sketch" | "arrow" | "eraser" | null>(null); // 绘图工具
  const [drawColor, setDrawColor] = useState<string>("#ff0000"); // 绘图颜色
  const [drawStrokeWidth, setDrawStrokeWidth] = useState<number>(2); // 绘图笔宽
  const [isResizing, setIsResizing] = useState(false);
  const [isCombatActive, setIsCombatActive] = useState(false); // 战斗是否进行中
  const [timeOfDay, setTimeOfDay] = useState<WorldTime>(DEFAULT_TIME);
  const sendMessageRef = useRef<(message: any) => void>(() => {});

  // Voice store for global voice state
  const { addVoiceUserId, removeVoiceUserId, setVoiceUserIds } = useVoiceStore();

  // Spell data cache for hotbar spell casting
  const spellsCacheRef = useRef<any[]>([]);
  useEffect(() => {
    import('~/data/rules/spells.json')
      .then(m => { spellsCacheRef.current = (m.default as any).spells || []; })
      .catch(() => {});
  }, []);

  // Sidebar state persistence (tab + width + chatFilters)
  const {
    tab: activeTab,
    setTab: setActiveTab,
    width: rightSidebarWidth,
    setWidth: setRightSidebarWidth,
    chatFilters,
    toggleHiddenUser,
    toggleHiddenType,
    hotbarExpanded,
    setHotbarExpanded,
    getSpellExpandedLevels,
    toggleSpellExpandedLevel,
    floatingChat,
    setFloatingChat,
    floatingCharPanel,
    setFloatingCharPanel,
    isLoaded: sidebarStateLoaded,
  } = useSidebarState(id, userId, 'player');

  // Unread chat tracking
  const { unreadCount } = useUnreadChat({
    userId,
    floatingChat,
    currentTab: activeTab,
    isSidebarExpanded: showRightSidebar,
    sidebarStateLoaded,
  });

  // Character data for hotbar (uses React Query cache, no extra network request)
  const { character: hotbarCharacter } = useCharacterDetails(selectedCharacterId);

  // Concentration spell name for hotbar spell detail modal
  const [concentrationSpellName, setConcentrationSpellName] = useState<string | null>(null);
  const [concentrationSpellId, setConcentrationSpellId] = useState<string | null>(null);
  const [hotbarCastingSpellName, setHotbarCastingSpellName] = useState<string | null>(null);
  useCharacterCastingState({
    characterId: selectedCharacterId,
    campaignId: id,
    currentMapUrl,
    userId,
    setConcentrationSpellName,
    setCastingSpellName: setHotbarCastingSpellName,
    setConcentrationSpellId,
  });

  // Check if player's token exists on the current map
  useEffect(() => {
    // 切换角色时先重置为 false，让按钮立即显示
    setHasMyTokenOnMap(false);

    const checkMyToken = async () => {
      if (!selectedCharacterId || !currentMapUrl || !id) {
        return;
      }
      try {
        const resp = await apiFetch(`/api/tokens/campaign/${id}/map?map_url=${encodeURIComponent(currentMapUrl)}`);
        if (resp.ok) {
          const data = await resp.json();
          const myToken = (data.tokens || []).find((t: any) => t.character_id === selectedCharacterId);
          setHasMyTokenOnMap(!!myToken);
        }
      } catch (e) {
        logger.error("[Player] Error checking token existence:", e);
      }
    };
    checkMyToken();
  }, [selectedCharacterId, currentMapUrl, id, tokenPresenceRefresh]);

  useCampaignSidebarResize({
    isResizing,
    setIsResizing,
    setSidebarWidth: setRightSidebarWidth,
  });

  // WebSocket connection for real-time map updates
  const { isConnected, connectionHealth, sendMessage } = useWebSocket({
    campaignId: id || "",
    userId: userId,
    role: "player",
    onMessage: async (message) => {
      logger.debug("[Player Main] Received WebSocket message:", message);

      // Dispatch chat messages for unread tracking
      if (message.type === "chat") {
        publishAppEvent("wsChatMessage", (message.data || message) as any);
      }

      if (message.type === "system_notice" && message.data?.message) {
        showGlobalToast({
          message: message.data.message,
          type: message.data.level || "info",
          duration: message.data.duration,
        });
        return;
      }

      // Handle being kicked from campaign
      if (message.type === "kicked") {
	        alert(message.data?.message || "You have been removed from this campaign");
        navigate("/");
        return;
      }

      if (message.type === "connection" && message.data?.online_users && id) {
        if (message.data.time_of_day) {
          const normalized = normalizeTime(message.data.time_of_day);
          setTimeOfDay((prev) => (isSameWorldTime(prev, normalized) ? prev : normalized));
        }
      }

      // Handle voice state updates
      if (message.type === "voice_join" && message.data?.user_id) {
        addVoiceUserId(parseInt(message.data.user_id, 10));
        return;
      }
      if (message.type === "voice_leave" && message.data?.user_id) {
        removeVoiceUserId(parseInt(message.data.user_id, 10));
        return;
      }
      if (message.type === "voice_state" && message.data?.user_ids) {
        setVoiceUserIds(message.data.user_ids.map((id: string) => parseInt(id, 10)));
        return;
      }

      // Handle music control from DM
      if (message.type === "music_play" && message.data) {
        const { handleRemotePlay } = useCampaignMusicStore.getState();
        handleRemotePlay(message.data.trackIndex, message.data.volume ?? 0.3);
        return;
      }
      if (message.type === "music_pause") {
        const { handleRemotePause } = useCampaignMusicStore.getState();
        handleRemotePause();
        return;
      }
      if (message.type === "music_volume" && message.data) {
        const { handleRemoteVolume } = useCampaignMusicStore.getState();
        handleRemoteVolume(message.data.volume ?? 0.3);
        return;
      }

      // Handle map updates from DM
      if (message.type === "map_update" && message.data) {
	        const { map_url: mapUrl, map_settings: mapSettings } = message.data;

        // Handle map URL change - only process if URL actually changed
        if (mapUrl !== undefined && mapUrl !== currentMapUrl) {
          // Clear any pending transition timeout
          if (mapTransitionTimeoutRef.current) {
            clearTimeout(mapTransitionTimeoutRef.current);
          }

          // Skip transition animation if this is the initial map load (currentMapUrl is null)
          if (currentMapUrl === null) {
            // Initial load - directly set URL without animation
            setCurrentMapUrl(mapUrl);
            logger.debug("[Player Main] Initial map set to:", mapUrl);

            // Load map scale async
            loadMapSettings(mapUrl)
              .then((data) => {
                if (data?.scale) setMapImageScale(data.scale);
                else setMapImageScale(1);
                setGlobalTerrain(data?.global_terrain || null);
              })
              .catch(() => setMapImageScale(1));
          } else {
            // Map switch - use transition animation to avoid Konva crashes
            setIsMapTransitioning(true);

            // Sequence: 1) unmount Stage 2) update URL 3) remount Stage
            requestAnimationFrame(() => {
              setCurrentMapUrl(mapUrl);
              logger.debug("[Player Main] Map updated to:", mapUrl);

              // Load map scale async
              loadMapSettings(mapUrl)
                .then((data) => {
                  if (data?.scale) setMapImageScale(data.scale);
                  else setMapImageScale(1);
                  setGlobalTerrain(data?.global_terrain || null);
                })
                .catch(() => setMapImageScale(1));

              // End transition after URL is set
              mapTransitionTimeoutRef.current = setTimeout(() => {
                setIsMapTransitioning(false);
              }, 100);
            });
          }
        }

        // Handle map settings (scale, rotation, flip, global_terrain) from DM
        if (mapSettings) {
          if (mapSettings.scale !== undefined) {
            setMapImageScale(mapSettings.scale);
            logger.debug("[Player Main] Map scale updated to:", mapSettings.scale);
          }
          if (mapSettings.rotation !== undefined || mapSettings.flipH !== undefined || mapSettings.flipV !== undefined) {
            setMapTransform(prev => ({
              rotation: mapSettings.rotation ?? prev.rotation,
              flipH: mapSettings.flipH ?? prev.flipH,
              flipV: mapSettings.flipV ?? prev.flipV,
            }));
            logger.debug("[Player Main] Map transform updated:", mapSettings);
          }
          if (mapSettings.global_terrain !== undefined) {
            setGlobalTerrain(mapSettings.global_terrain || null);
          }
        }
      }

	      // Handle map scale updates from DM
      if (message.type === "map_scale_update") {
        logger.debug("[Player Main] Received map_scale_update message:", message);
        if (message.data) {
	          const { map_url: mapUrl, scale } = message.data;
          logger.debug("[Player Main] Scale update - mapUrl:", mapUrl, "scale:", scale, "currentMapUrl:", currentMapUrl);
          // Only update scale if it's for the current map
          if (mapUrl === currentMapUrl) {
            setMapImageScale(scale);
            logger.debug("[Player Main] ✅ Map scale updated to:", scale);
          } else {
            logger.debug("[Player Main] ⚠️ Ignoring scale update for different map");
          }
        } else {
          logger.debug("[Player Main] ⚠️ map_scale_update message has no data");
        }
      }

	      // Handle token placement updates - trigger token presence refresh
	      if (message.type === "token_placed" || message.type === "token_removed") {
	        logger.debug("[Player Main] Token change detected, refreshing token presence");
	        setTokenPresenceRefresh((v) => v + 1);
	      }

      if (bridgeCampaignRealtimeMessage(message as any, {
        role: "player",
        currentUserId: userId,
        setIsCombatActive,
      })) {
        return;
      }

      // Handle character level up/down events
      if (message.type === "character_level_up" || message.type === "character_level_down") {
        logger.debug(`[Player Main] ${message.type} received, dispatching event`);
        publishAppEvent("characterLevelChanged", message as any);
      }

      // Handle spell slots deducted by backend after spell cast
      if (message.type === "spell_slots_update" || message.type === "spell_slot_consumed") {
        logger.debug(`[Player Main] ${message.type} received`, message);
        const rawMessage = message as any;
        publishAppEvent("spellSlotsUpdate", {
          ...rawMessage,
          character_id: Number(rawMessage?.character_id),
          spell_slots_state: rawMessage?.spell_slots_state ?? rawMessage?.new_spell_slots_state,
        } as any);
      }

      // Handle other player's character selection changes
      if (message.type === "character_selected") {
        logger.debug("[Player Main] Another player changed character:", message);
        // Dispatch event for CharacterPanel to refresh party list
        publishAppEvent("characterSelected", message as any);
      }

      // Handle character created by DM for this user
      if (message.type === "character_created") {
        logger.debug("[Player Main] Character created:", message);
        // Dispatch event for character selector to refresh
        publishAppEvent("characterCreated", message as any);
      }

      // Handle AI generate progress updates
      if (message.type === "ai_generate_progress") {
        logger.debug("[Player Main] AI generate progress:", message);
        publishAppEvent("aiGenerateProgress", message as any);
      }

      // Handle rest grants from DM
      if (message.type === "rest_grant") {
	        const restType = message.data?.rest_type || "short";

        logger.debug("[Player Main] Rest grant received, dispatching events", {
          restType,
        });

	        // Notify character sheets / spellcasting state even if chat is not mounted.
	        publishAppEvent("restGrant", {
	          restType,
	          source: "player-main",
	          wsMessage: message,
	        });
	      }

      // Handle AI marker visibility sync from DM
      if (message.type === "ai_marker_visibility" && message.data) {
        logger.debug("[Player Main] AI marker visibility changed:", message.data);
        setShowAIMarkers(message.data.show_ai_markers);
      }

      // Handle time of day updates
      if (message.type === "time_update" && message.data) {
        const normalized = normalizeTime(message.data);
        setTimeOfDay((prev) => (isSameWorldTime(prev, normalized) ? prev : normalized));

        const syncSeq = Number((message.data as any).sync_seq);
        const requiresSyncAck = (message.data as any).requires_sync_ack === true;
        if (requiresSyncAck && Number.isInteger(syncSeq)) {
          sendMessageRef.current({ type: "time_update_ack", data: { sync_seq: syncSeq } });
        }
      }

      // ── Trade messages ──────────────────────────────────
      if (message.type === "trade_request_sent" && message.data) {
        // Confirmation that our trade request was delivered — update with trade_id
        const outgoing = useTradeStore.getState().pendingOutgoing;
        if (outgoing) {
          useTradeStore.getState().setPendingOutgoing({
            ...outgoing,
            tradeId: message.data.trade_id,
          });
        }
      }
      if (message.type === "trade_request" && message.data) {
        const d = message.data;
        useTradeStore.getState().setPendingRequest({
          tradeId: d.trade_id,
          fromUserId: d.from_user_id,
          fromCharacterId: d.from_character_id,
          fromCharacterName: d.from_character_name,
          targetCharacterId: d.target_character_id,
          targetCharacterName: d.target_character_name,
        });
      }
      if (message.type === "trade_accept" && message.data) {
        const d = message.data;
        const isInitiator = d.initiator.user_id === userId;
        useTradeStore.getState().setPendingOutgoing(null);
        useTradeStore.getState().setActiveTrade({
          tradeId: d.trade_id,
          status: 'active',
          myUserId: userId,
          myCharacterId: isInitiator ? d.initiator.character_id : d.target.character_id,
          myCharacterName: isInitiator ? d.initiator.character_name : d.target.character_name,
          partnerUserId: isInitiator ? d.target.user_id : d.initiator.user_id,
          partnerCharacterId: isInitiator ? d.target.character_id : d.initiator.character_id,
          partnerCharacterName: isInitiator ? d.target.character_name : d.initiator.character_name,
          myOffer: { items: [], currency: emptyCurrency() },
          partnerOffer: { items: [], currency: emptyCurrency() },
          myLocked: false,
          partnerLocked: false,
        });
        useTradeStore.getState().setPendingRequest(null);
      }
      if (message.type === "trade_reject" && message.data) {
        useTradeStore.getState().reset();
      }
      if (message.type === "trade_update" && message.data) {
        useTradeStore.getState().updatePartnerOffer(message.data.offer);
      }
      if (message.type === "trade_lock" && message.data) {
        useTradeStore.getState().setPartnerLocked(true);
      }
      if (message.type === "trade_unlock" && message.data) {
        useTradeStore.getState().setPartnerLocked(false);
      }
      if (message.type === "trade_confirm" && message.data) {
        useTradeStore.getState().reset();
        // Trigger character refresh via existing event listener
        if (selectedCharacterId !== null) {
          publishAppEvent("characterUpdated", {
            data: { character_id: selectedCharacterId },
          });
        }
      }
      if (message.type === "trade_cancel" && message.data) {
        useTradeStore.getState().reset();
      }
      if (message.type === "trade_error" && message.data) {
        logger.warn("[Player Main] Trade error:", message.data.message);
        useTradeStore.getState().reset();
      }

    },
  });
  sendMessageRef.current = sendMessage;

  useEffect(() => {
    setIsClient(true);
  }, []);

  useCampaignPanelOrchestration({
    isPhoneLike,
    setShowRightSidebar,
    openChatTab: () => setActiveTab("chat"),
    listenForPrivateMessages: true,
    listenForOpenRightPanelTab: true,
  });

  // Invalidate caches on rest grant (covers both WS broadcasts and local takeRest actions)
  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-roster'] });
      // Also invalidate character details so spell slots / HP update without page refresh
      if (selectedCharacterId) {
        queryClient.invalidateQueries({ queryKey: ['characterDetails', selectedCharacterId] });
      }
    };
    return subscribeAppEvent("restGrant", handler);
  }, [queryClient, selectedCharacterId]);

  useCampaignHotbarBindings({
    hotbarCharacter,
    sendSpellCastChatMessage: (message, spellCastData) => {
      sendMessage({ type: "chat", data: { message, meta: { spell_cast: true, spellCastData } } });
    },
    setHotbarTargeting,
    setAbilityConfirm,
  });

  useCampaignShellBootstrap({
    enabled: Boolean(isClient && id),
    campaignId: id,
    userId,
    notFoundMessage: "战役不存在",
    navigateHome: () => navigate("/"),
    setCurrentMapUrl,
    setMapImageScale,
    setGlobalTerrain,
    setIsCombatActive,
    onCampaignLoaded: (campaign) => {
      setCampaignName(campaign.name || "");
      const isCampaignDM = String(campaign.dm_user_id) === String(userId);
      const storedUser = localStorage.getItem("dnd_user");
      const hasDevDMRole = storedUser && JSON.parse(storedUser).role === "dm";
      setIsDM(Boolean(isCampaignDM || hasDevDMRole));
      setEnableDeitySystem(Boolean(campaign.metadata?.enable_deity_system));
      setEnable3DDice(campaign.metadata?.enable_3d_dice ?? true);
      const mapSettings = campaign.metadata?.map_settings;
      if (mapSettings && (mapSettings.rotation !== undefined || mapSettings.flipH !== undefined || mapSettings.flipV !== undefined)) {
        setMapTransform({
          rotation: mapSettings.rotation ?? 0,
          flipH: mapSettings.flipH ?? false,
          flipV: mapSettings.flipV ?? false,
        });
        logger.debug("[Player] Loaded map transform from database:", mapSettings);
      }
      if (campaign.metadata?.show_ai_markers !== undefined) {
        setShowAIMarkers(campaign.metadata.show_ai_markers);
        logger.debug("[Player] Loaded AI marker visibility from database:", campaign.metadata.show_ai_markers);
      }
      if (campaign.metadata?.time_of_day) {
        setTimeOfDay(normalizeTime(campaign.metadata.time_of_day));
        logger.debug("[Player] Loaded time of day from database:", campaign.metadata.time_of_day);
      }
    },
    onError: (error) => {
      logger.error("[Player] Failed to load campaign:", error);
    },
  });

  if (!isClient) {
    return <LoadingScreen />;
  }

  // 交易发起处理
  const handleInitiateTrade = (sourceCharacterId: number, targetToken: any) => {
    if (!targetToken?.user_id || !targetToken?.character_id) return;
    const targetName = targetToken.character_name || targetToken.instance_name || '对方';
    useTradeStore.getState().setPendingOutgoing({ targetName });
    sendMessage({
      type: 'trade_request',
      data: {
        target_user_id: String(targetToken.user_id),
        source_character_id: sourceCharacterId,
        target_character_id: targetToken.character_id,
        source_character_name: hotbarCharacter?.name || '',
      },
    });
  };

  const handleAcceptTrade = (tradeId: string) => {
    sendMessage({ type: 'trade_accept', data: { trade_id: tradeId } });
    useTradeStore.getState().setPendingRequest(null);
  };

  const handleRejectTrade = (tradeId: string) => {
    sendMessage({ type: 'trade_reject', data: { trade_id: tradeId } });
    useTradeStore.getState().setPendingRequest(null);
  };

  return (
    <div className="h-dvh flex flex-col bg-gray-900">
      {/* 顶部导航栏 */}
      <CampaignHeader
        campaignId={id || ""}
        campaignName={campaignName}
        isConnected={isConnected}
        connectionHealth={connectionHealth}
        showGrid={showGrid}
        onShowGridChange={setShowGrid}
        showFogOfWar={true}
        onShowFogOfWarChange={() => {}}
        showLeftSidebar={showLeftSidebar}
        onToggleLeftSidebar={() => setShowLeftSidebar(!showLeftSidebar)}
        showRightSidebar={showRightSidebar}
        onToggleRightSidebar={() => setShowRightSidebar(!showRightSidebar)}
        onNavigateToPlayer={() => {
          const basePath = typeof import.meta.env?.BASE_URL === 'string'
            ? import.meta.env.BASE_URL.replace(/\/$/, '')
            : '';
          window.location.href = `${basePath}/campaign/${id}/dm`;
        }}
        onExit={() => {
          const basePath = typeof import.meta.env?.BASE_URL === 'string'
            ? import.meta.env.BASE_URL.replace(/\/$/, '')
            : '';
          window.location.href = `${basePath}/`;
        }}
        isDM={false}
        isUserDM={isDM}
        timeOfDay={timeOfDay}
      />

      {/* 主内容区 */}
      <div className="flex-1 relative overflow-hidden bg-gray-950">
        {/* 左侧工具栏 - fixed 定位 */}
        <div
          className={`
            fixed left-0 top-[calc(44px+var(--sat,0px))]
            ${showLeftSidebar ? 'w-16' : 'w-0'}
            transition-all duration-300
            z-[200]
            pointer-events-none
          `}
        >
          {showLeftSidebar && (
            <ToolbarV2
              selectedTool={selectedTool}
              onToolChange={(tool) => {
                setSelectedTool(tool);
                if (tool !== "draw") {
                  setDrawTool(null);
                }
                if (tool !== "ruler") {
                  setRulerMode(null);
                }
              }}
              rulerMode={rulerMode}
              onRulerModeChange={setRulerMode}
              onFocusMyToken={() => {
                if ((window as any).__focusMyToken) {
                  (window as any).__focusMyToken();
                }
              }}
              drawTool={drawTool}
              onDrawToolChange={setDrawTool}
              drawColor={drawColor}
              onDrawColorChange={setDrawColor}
              drawStrokeWidth={drawStrokeWidth}
              onDrawStrokeWidthChange={setDrawStrokeWidth}
              onUndoLastDrawing={async () => {
                try {
                  const response = await apiFetch(
                    `/api/campaigns/${id}/drawings/undo?map_url=${encodeURIComponent(currentMapUrl || "")}`,
                    { method: "POST" }
                  );
                  if (response.ok) {
                    const result = await response.json();
                    if (result.status === "success" && result.drawing_id) {
                      logger.debug("[Player] Drawing undone:", result.drawing_id);
                      // Broadcast to all clients via WebSocket
                      sendMessage({
                        type: "drawing_removed",
                        data: { drawing_id: result.drawing_id }
                      });
                    } else {
                      logger.debug("[Player] No drawing to undo");
                    }
                  }
                } catch (error) {
                  logger.error("[Player] Failed to undo drawing:", error);
                }
              }}
              isDM={false}
              hasMyTokenOnMap={hasMyTokenOnMap}
              onJumpToAnchor={() => { (window as any).__jumpToAnchor?.(); setSelectedTool("move"); }}
            />
          )}
        </div>

        {/* 中间地图区域 - 全宽，左右侧栏都使用 fixed 定位覆盖在上方 */}
        {/* IMPORTANT: Always render TacticalMap to avoid Konva unmount crashes */}
        {/* Use overlay during transition instead of conditional rendering */}
        <div className="h-full w-full relative">
          {/* Spectator mode badge - shown when no character selected */}
          {!selectedCharacterId && !isMapTransitioning && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
              <div className="bg-gray-900/90 backdrop-blur-sm border border-amber-500/50 rounded-full px-4 py-2 flex items-center gap-2 shadow-lg">
                <span className="text-lg">👁️</span>
                <span className="text-amber-400 text-sm font-medium">旁观模式</span>
              </div>
            </div>
          )}
          {/* Loading overlay - shown during character switch */}
          {isMapTransitioning && (
            <div className="absolute inset-0 bg-gray-900 flex items-center justify-center z-50">
              <div className="text-white text-lg animate-pulse">切换角色中...</div>
            </div>
          )}
          {/* TacticalMap wrapped in error boundary for Konva crash recovery */}
          <MapErrorBoundary mapKey={`map-${selectedCharacterId || 'none'}`}>
            <TacticalMap
              key={`tactical-map-${selectedCharacterId || 'none'}`}
              campaignId={id!}
              isDM={false}
              selectedTool={selectedTool}
              showGrid={showGrid}
              showFogOfWar={true}
              currentMapUrl={currentMapUrl}
              userId={userId}
              selectedCharacterId={selectedCharacterId}
              mapImageScale={mapImageScale}
              mapTransform={mapTransform}
              rulerMode={rulerMode}
              drawTool={drawTool}
              drawColor={drawColor}
              drawStrokeWidth={drawStrokeWidth}
              globalTerrain={globalTerrain}
              showAIMarkers={showAIMarkers}
              isTransitioning={isMapTransitioning}
              rightSidebarWidth={rightSidebarWidth}
              showRightSidebar={showRightSidebar}
              isResizing={isResizing}
              timeOfDay={timeOfDay}
              hotbarTargeting={hotbarTargeting ? {
                slot: hotbarTargeting.slot,
                sourceCharacterId: hotbarTargeting.sourceCharacterId,
                targetingType: hotbarTargeting.targetingType,
                abilityData: hotbarTargeting.abilityData,
                spellData: hotbarTargeting.spellData,
              } : null}
              onHotbarTargetSelect={(targetTokenId: number, targetName: string, distanceFeet: number, targetExtra?: {
                currentHp?: number; maxHp?: number; monsterType?: string;
              }) => {
                if (!hotbarTargeting) return;
                if (hotbarTargeting.targetingType === 'spell' && hotbarTargeting.spellData) {
                  const { spell, slotLevel, sourceTokenId, illusionImageUrl, illusionDesc, illusionDisplayName, selectedOption, materialId, ritualCast, freecast, runtimeAction, isMultiTarget, maxTargets, longCast, confirmBreakConcentration } = hotbarTargeting.spellData;
                  if (isMultiTarget) {
                    const current = hotbarTargeting.selectedTargetIds || [];
                    const alreadyIdx = current.indexOf(targetTokenId);
                    let next: number[];
                    if (alreadyIdx >= 0) {
                      next = current.filter((tid) => tid !== targetTokenId);
                    } else if (typeof maxTargets === 'number' && current.length >= maxTargets) {
                      next = [...current.slice(1), targetTokenId];
                    } else {
                      next = [...current, targetTokenId];
                    }
                    setHotbarTargeting({ ...hotbarTargeting, selectedTargetIds: next });
                    return;
                  }
                  // Spell targeting → dispatch sidebarSpellCast event to TacticalMap
                  publishAppEvent("sidebarSpellCast", {
                    spell,
                    sourceTokenId,
                    targetTokenId,
                    slotLevel,
                    characterId: hotbarTargeting.sourceCharacterId,
                    illusionImageUrl,
                    illusionDesc,
                    illusionDisplayName,
                    selectedOption,
                    materialId,
                    ritualCast,
                    freecast,
                    runtimeAction,
                    longCast,
                    confirmBreakConcentration,
                  });
                  setHotbarTargeting(null);
                } else if (hotbarTargeting.targetingType === 'ability' && hotbarTargeting.abilityData) {
                  // Ability targeting → open ability confirm modal
                  setAbilityConfirm({
                    abilityId: hotbarTargeting.abilityData.abilityId,
                    sourceCharacterId: hotbarTargeting.sourceCharacterId,
                    targetTokenId,
                    targetName,
                    distanceFeet,
                    targetMonsterType: targetExtra?.monsterType,
                    poolCurrent: hotbarTargeting.abilityData.poolCurrent,
                    poolMax: hotbarTargeting.abilityData.poolMax,
                    spellSlotLevel: hotbarTargeting.abilityData.spellSlotLevel,
                  });
                } else {
                  // Attack targeting → open attack confirm modal
                  setHotbarConfirm({
                    slot: hotbarTargeting.slot,
                    sourceCharacterId: hotbarTargeting.sourceCharacterId,
                    targetTokenId,
                    targetName,
                    distanceFeet,
                  });
                }
                setHotbarTargeting(null);
              }}
              onHotbarTargetCancel={() => setHotbarTargeting(null)}
              onTrade={handleInitiateTrade}
              onStartSpellTargeting={({ spell, slotLevel, sourceTokenId, characterId, freecast, illusionImageUrl, illusionDesc, illusionDisplayName, selectedOption, materialId, ritualCast, runtimeAction, longCast, confirmBreakConcentration }) => {
                // Parse numeric range for distance display
                const rangeStr = spell.range || '';
                let numericRange = 999;
                if (rangeStr.includes('触及') || rangeStr.toLowerCase().includes('touch')) numericRange = 5;
                else { const m = rangeStr.match(/(\d+)/); if (m) numericRange = parseInt(m[1], 10); }

                const multi = runtimeAction ? { isMultiTarget: false, maxTargets: 1 } : resolveMultiTargetSpec(spell, slotLevel);
                setHotbarTargeting({
                  slot: { type: 'spell', id: spell.id, name: spell.name, meta: { normalRange: numericRange } },
                  slotIndex: spellHotbarIndexRef.current,
                  sourceCharacterId: characterId,
                  targetingType: 'spell',
                  spellData: {
                    spell,
                    slotLevel,
                    sourceTokenId,
                    illusionImageUrl,
                    illusionDesc,
                    illusionDisplayName,
                    selectedOption,
                    materialId,
                    ritualCast,
                    freecast,
                    runtimeAction,
                    longCast,
                    confirmBreakConcentration,
                    isMultiTarget: multi.isMultiTarget,
                    maxTargets: multi.maxTargets,
                  },
                  selectedTargetIds: multi.isMultiTarget ? [] : undefined,
                });
                spellHotbarIndexRef.current = -1;
              }}
              onLayOnHands={(sourceCharacterId, targetToken, distanceFeet, poolCurrent, poolMax) => {
                publishAppEvent("layOnHandsTarget", {
                  sourceCharacterId,
                  targetTokenId: targetToken.id,
                  targetName: targetToken.instance_name || targetToken.character_name || targetToken.monster_name || '目标',
                  distanceFeet,
                  targetMonsterType: targetToken.monster_type,
                  poolCurrent,
                  poolMax,
                });
              }}
            />
          </MapErrorBoundary>
        </div>

        {/* Hotbar - 快捷操作栏 */}
        <Hotbar
          character={hotbarCharacter ?? null}
          rightSidebarWidth={rightSidebarWidth}
          showRightSidebar={showRightSidebar}
          showLeftSidebar={showLeftSidebar}
          expanded={hotbarExpanded}
          onExpandedChange={setHotbarExpanded}
          activeSlotIndex={hotbarTargeting?.slotIndex ?? null}
          onSlotActivate={(slot, index) => {
            if (!selectedCharacterId) return;
            // Breath weapon feature → dispatch area attack event
            if (slot.type === 'feature' && (slot.id === 'Breath Weapon' || slot.name === '吐息武器') && hotbarCharacter) {
              const race = (racesData as any).races?.find((r: any) => r.id === hotbarCharacter.race_id);
              const subrace = race?.subraces?.find((sr: any) => sr.id === hotbarCharacter.subrace_id);
              if (subrace?.breathWeapon) {
                const bw = subrace.breathWeapon;
                const level = hotbarCharacter.level || 1;
                const bwTrait = race.traits?.find((t: any) => t.nameEn === 'Breath Weapon');
                let dice = '2d6';
                if (bwTrait?.damage?.length) {
                  for (const d of bwTrait.damage) { if (d.level <= level) dice = d.dice; }
                }
                const conScore = hotbarCharacter.ability_scores?.constitution ?? 10;
                const conMod = Math.floor((conScore - 10) / 2);
                const profBonus = Math.floor((level - 1) / 4) + 2;
                publishAppEvent("startBreathWeapon", {
                  sourceCharacterId: selectedCharacterId,
                  breathWeapon: bw,
                  damageType: subrace.damageType,
                  damageTypeCn: subrace.damageTypeCn,
                  damageDice: dice,
                  subraceName: subrace.name,
                  saveDC: 8 + profBonus + conMod,
                });
              }
              return;
            }
            // Spell casting is handled by HotbarSlotItem's UnifiedSpellCastDialog (via onCastSpell)
            if (slot.type !== 'weapon') return;
            if (hotbarTargeting?.slotIndex === index) {
              setHotbarTargeting(null);
              return;
            }
            // Enrich slot with fresh range data from current equipment (handles stale hotbar)
            let enrichedSlot = slot;
            if (hotbarCharacter?.equipment) {
              const isMain = slot.id?.startsWith('attack_main_') || slot.id?.startsWith('throw_main_');
              const isOff = slot.id?.startsWith('attack_off_') || slot.id?.startsWith('throw_off_');
              const eqSlot = isMain ? 'main_hand' : isOff ? 'off_hand' : null;
              if (eqSlot) {
                const eqItem = (hotbarCharacter.equipment as any[]).find((eq: any) => eq.equippedSlot === eqSlot);
                if (eqItem?.range && typeof eqItem.range === 'object' && eqItem.range.normal) {
                  const nr = eqItem.range.normal;
                  const mr = eqItem.range.long || nr;
                  if (slot.meta?.normalRange !== nr || slot.meta?.maxRange !== mr) {
                    enrichedSlot = { ...slot, meta: { ...slot.meta, normalRange: nr, maxRange: mr, range: eqItem.range } };
                  }
                }
              }
            }
            setHotbarTargeting({ slot: enrichedSlot, slotIndex: index, sourceCharacterId: selectedCharacterId });
          }}
          onCastSpell={(castData, slotIndex) => {
            if (!selectedCharacterId) return;
            spellHotbarIndexRef.current = slotIndex;
            castSpellAction(castData.spell, castData.level, selectedCharacterId, {
              campaignId: id, currentMapUrl, userId,
              freecast: castData.freecast,
              ritualCast: castData.ritualCast,
              confirmBreakConcentration: castData.confirmBreakConcentration,
              illusionImageUrl: castData.illusionData?.imageUrl,
              illusionDesc: castData.illusionData?.description,
              illusionDisplayName: castData.illusionData?.displayName,
              areaSize: castData.areaSize,
              selectedOption: castData.selectedOption,
              materialId: castData.materialId,
              targetingMode: castData.targetingMode,
            });
          }}
          concentrationSpellName={concentrationSpellName}
          castingSpellName={hotbarCastingSpellName}
          onUseResource={async (resourceId, amount) => {
            if (!selectedCharacterId) return null;
            try {
              const resp = await apiFetch(`/api/characters/${selectedCharacterId}/resources/use`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resource_id: resourceId, amount, campaign_id: id ? parseInt(id) : undefined }),
              });
              if (!resp.ok) return null;
              const data = await resp.json();
              publishAppEvent("classFeatureUsesUpdated", { characterId: selectedCharacterId });
              playResourceSound(resourceId);
              const res = findResourceByIdOrSlot(resourceId);
              showCharacterBubble({
                characterId: selectedCharacterId,
                characterName: hotbarCharacter?.name || '',
                message: `使用了 ${res?.name || resourceId}`,
                type: 'action',
                avatarUrl: hotbarCharacter?.avatar_url,
              });
              return data.current ?? null;
            } catch { return null; }
          }}
          onStartTargeting={(resourceId, poolCurrent, poolMax) => {
            if (!selectedCharacterId) return;
            publishAppEvent("startAbilityTargeting", {
              abilityId: resourceId,
              poolCurrent,
              poolMax,
              sourceCharacterId: selectedCharacterId,
            });
          }}
          onStartSmiteTargeting={(resourceId, spellSlotLevel) => {
            if (!selectedCharacterId) return;
            publishAppEvent("startAbilityTargeting", {
              abilityId: resourceId,
              poolCurrent: 0,
              poolMax: 0,
              sourceCharacterId: selectedCharacterId,
              spellSlotLevel,
            });
          }}
          onConsumeSpellSlot={(level: number, resourceId: string) => {
            if (!selectedCharacterId) return;
            // Dispatch event so ClassicCardWithEquipment can consume the slot
            publishAppEvent("consumeSpellSlot", { level, characterId: selectedCharacterId });
            // Broadcast usage in chat
            apiFetch(`/api/characters/${selectedCharacterId}/resources/use`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ resource_id: resourceId, amount: 1, spell_slot_level: level, campaign_id: id ? parseInt(id) : undefined }),
            }).catch(() => {});
          }}
        />

        {/* Hotbar targeting banner */}
        {hotbarTargeting && (() => {
          const isSmite = hotbarTargeting.targetingType === 'ability' && hotbarTargeting.abilityData?.abilityId === 'divine_smite';
          const isAbility = hotbarTargeting.targetingType === 'ability' && !isSmite;
          const isMultiSpell = hotbarTargeting.targetingType === 'spell' && !!hotbarTargeting.spellData?.isMultiTarget;
          const bannerClass = isAbility
            ? 'bg-emerald-900/90 border border-emerald-600/60 text-emerald-200'
            : 'bg-amber-900/90 border border-amber-600/60 text-amber-200';
          const btnClass = isAbility
            ? 'text-emerald-400 hover:text-emerald-200'
            : 'text-amber-400 hover:text-amber-200';
          const selectedCount = hotbarTargeting.selectedTargetIds?.length ?? 0;
          const maxTargets = hotbarTargeting.spellData?.maxTargets ?? 1;
          const onConfirmMulti = () => {
            if (!hotbarTargeting?.spellData?.isMultiTarget) return;
            if (selectedCount === 0) return;
            const sd = hotbarTargeting.spellData;
            publishAppEvent("sidebarSpellCast", {
              spell: sd.spell,
              sourceTokenId: sd.sourceTokenId,
              targetTokenIds: hotbarTargeting.selectedTargetIds || [],
              slotLevel: sd.slotLevel,
              characterId: hotbarTargeting.sourceCharacterId,
              illusionImageUrl: sd.illusionImageUrl,
              illusionDesc: sd.illusionDesc,
              illusionDisplayName: sd.illusionDisplayName,
              selectedOption: sd.selectedOption,
              materialId: sd.materialId,
              ritualCast: sd.ritualCast,
              freecast: sd.freecast,
              runtimeAction: sd.runtimeAction,
              longCast: sd.longCast,
              confirmBreakConcentration: sd.confirmBreakConcentration,
            });
            setHotbarTargeting(null);
          };
          return (
          <div className="fixed top-0 left-0 right-0 z-[400] flex justify-center pointer-events-none">
            <div className={`mt-2 px-4 py-2 rounded-lg text-sm shadow-lg pointer-events-auto
                          flex items-center gap-2 backdrop-blur-sm ${bannerClass}`}>
              <span className="animate-pulse">{isSmite ? '⚔' : isAbility ? '✋' : '⚔'}</span>
              {isMultiSpell
                ? `选择 ${hotbarTargeting.slot.name} 目标（已选 ${selectedCount}/${maxTargets}）`
                : isSmite
                  ? `选择惩击目标 — ${hotbarTargeting.slot.name}`
                  : isAbility
                    ? `选择治疗目标 — ${hotbarTargeting.slot.name}`
                    : `选择攻击目标 — ${hotbarTargeting.slot.name}`}
              {isMultiSpell && (
                <button
                  onClick={onConfirmMulti}
                  disabled={selectedCount === 0}
                  className={`ml-2 text-xs px-2 py-0.5 rounded border border-amber-600/60 ${selectedCount === 0 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-amber-700/50'}`}
                >确认施法</button>
              )}
              <button
                onClick={() => setHotbarTargeting(null)}
                className={`ml-2 text-xs ${btnClass}`}
              >(ESC 取消)</button>
            </div>
          </div>);
        })()}

        {/* Hotbar attack confirm modal */}
        {hotbarConfirm && (
          <HotbarAttackConfirmModal
            open={true}
            slot={hotbarConfirm.slot}
            targetName={hotbarConfirm.targetName}
            distanceFeet={hotbarConfirm.distanceFeet}
            attackInfo={hotbarCharacter ? computeAttackInfo(hotbarConfirm.slot, hotbarCharacter) : null}
            character={hotbarCharacter}
            isDM={isDM}
            onCancel={() => setHotbarConfirm(null)}
            onConfirm={(modifiers) => {
              const { slot, sourceCharacterId, targetTokenId } = hotbarConfirm;
              // Detect thrown weapon slots
              const isThrowSlot = slot.id?.startsWith('throw_') || slot.id?.startsWith('improvthrow_');
              const isImprovisedThrow = slot.id?.startsWith('improvthrow_');
              // Extract equipped slot from id: throw_main_xxx → main_hand, throw_off_xxx → off_hand
              let thrownWeaponItem: any = undefined;
              if (isThrowSlot && hotbarCharacter?.equipment) {
                const idParts = slot.id?.replace('improvthrow_', '').replace('throw_', '') || '';
                const isOff = idParts.startsWith('off_');
                const weaponId = idParts.replace(/^(main|off)_/, '');
                const equippedSlot = isOff ? 'off_hand' : 'main_hand';
                const equipItem = hotbarCharacter.equipment.find(
                  (eq: any) => eq.equippedSlot === equippedSlot && eq.id === weaponId
                );
                if (equipItem) {
                  thrownWeaponItem = {
                    id: equipItem.id,
                    name: equipItem.name || slot.name,
                    equippedSlot,
                    iconPath: equipItem.iconPath,
                    weight: equipItem.weight,
                  };
                }
              }
              const attack = {
                key: slot.id,
                name: slot.name,
                nameEn: slot.id,
                icon: slot.icon || '⚔',
                description: '',
                weaponName: slot.name,
                damage: (slot.meta?.damage as string) || '',
                damageType: (slot.meta?.damageType as string) || '',
                properties: (slot.meta?.properties as string[]) || [],
                range: (() => {
                  const r = slot.meta?.range;
                  if (!r) return '';
                  if (typeof r === 'string') return r;
                  if (typeof r === 'object' && r.normal) return r.long ? `${r.normal}/${r.long}尺` : `${r.normal}尺`;
                  return '';
                })(),
                attackBonus: slot.meta?.attackBonus as number | undefined,
                abilityMod: slot.meta?.abilityMod as number | undefined,
                profBonus: slot.meta?.profBonus as number | undefined,
                weaponProficient: slot.meta?.weaponProficient as boolean | undefined,
                isRanged: (slot.meta?.isRanged as boolean | undefined)
                  ?? ((slot.meta?.normalRange as number) > 10 ? true : undefined),
                normalRange: slot.meta?.normalRange as number | undefined,
                maxRange: slot.meta?.maxRange as number | undefined,
                ...(isThrowSlot ? {
                  isThrown: true,
                  isImprovisedThrow,
                  thrownWeaponItem,
                } : {}),
              };
              publishAppEvent("hotbarAttackExecute", {
                sourceCharacterId,
                targetTokenId,
                attack,
                modifiers,
              });
              setHotbarConfirm(null);
            }}
          />
        )}

        {/* Lay on Hands confirm modal */}
        {abilityConfirm && abilityConfirm.abilityId === 'lay_on_hands' && (
          <LayOnHandsConfirmModal
            open={true}
            targetName={abilityConfirm.targetName}
            targetIsUndead={abilityConfirm.targetMonsterType === 'undead'}
            poolCurrent={abilityConfirm.poolCurrent}
            poolMax={abilityConfirm.poolMax}
            distanceFeet={abilityConfirm.distanceFeet}
            onCancel={() => setAbilityConfirm(null)}
            onConfirm={async (healAmount, cureDisease, curePoison) => {
              try {
                await confirmLayOnHandsAction({
                  campaignId: id!,
                  abilityConfirm,
                  hotbarCharacter,
                  healAmount,
                  cureDisease,
                  curePoison,
                });
              } catch (e) {
                console.error('Lay on Hands error:', e);
              }
              setAbilityConfirm(null);
            }}
          />
        )}

        {/* Divine Smite confirm modal */}
        {abilityConfirm && abilityConfirm.abilityId === 'divine_smite' && abilityConfirm.spellSlotLevel && (
          <DivineSmiteConfirmModal
            open={true}
            targetName={abilityConfirm.targetName}
            targetMonsterType={abilityConfirm.targetMonsterType}
            spellSlotLevel={abilityConfirm.spellSlotLevel}
            distanceFeet={abilityConfirm.distanceFeet}
            onCancel={() => setAbilityConfirm(null)}
            onConfirm={async () => {
              try {
                await confirmDivineSmiteAction({
                  campaignId: id!,
                  abilityConfirm,
                  hotbarCharacter,
                });
              } catch (e) {
                console.error('Divine Smite error:', e);
              }
              setAbilityConfirm(null);
            }}
          />
        )}

        <CampaignRightSidebarShell
          showRightSidebar={showRightSidebar}
          isSidebarFullscreen={isSidebarFullscreen}
          isResizing={isResizing}
          rightSidebarWidth={rightSidebarWidth}
          onCloseMobileOverlay={() => setShowRightSidebar(false)}
          onExitFullscreen={() => setIsSidebarFullscreen(false)}
          onStartResize={() => setIsResizing(true)}
        >
          <PlayerRightPanel
            campaignId={id || ""}
            currentMapUrl={currentMapUrl}
            sendMessage={sendMessage}
            onSelectedCharacterChange={handleCharacterChange}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            isDM={isDM}
            isCollapsed={!showRightSidebar}
            onToggleCollapse={() => setShowRightSidebar(!showRightSidebar)}
            isSidebarFullscreen={isSidebarFullscreen}
            onToggleFullscreen={() => setIsSidebarFullscreen(!isSidebarFullscreen)}
            isCombatActive={isCombatActive}
            userId={userId}
            enableDeitySystem={enableDeitySystem}
            enable3DDice={enable3DDice}
            getSpellExpandedLevels={getSpellExpandedLevels}
            toggleSpellExpandedLevel={toggleSpellExpandedLevel}
            unreadCount={unreadCount}
            floatingCharPanel={floatingCharPanel}
            setFloatingCharPanel={setFloatingCharPanel}
            globalTerrain={globalTerrain}
            timeOfDay={timeOfDay}
            showChatInSidebar={isPhoneLike}
          />
        </CampaignRightSidebarShell>
      </div>

      <CampaignFloatingOverlayShell
        isPhoneLike={isPhoneLike}
        desktopChat={sidebarStateLoaded ? (
          <FloatingChatWindow
            isDM={false}
            campaignId={id || ""}
            userId={userId}
            sidebarStateLoaded={sidebarStateLoaded}
            currentMapUrl={currentMapUrl}
            floatingChat={floatingChat}
            setFloatingChat={setFloatingChat}
            unreadCount={unreadCount}
            enable3DDice={enable3DDice}
          />
        ) : null}
        filterPanels={<FloatingFilterPanels campaignId={id || ""} userId={userId} isDM={false} />}
      />

      {/* Voice Chat Panel */}
      <VoicePanel campaignId={id || ""} sendMessage={sendMessage} />

      {/* Player Music Indicator */}
      <PlayerMusicIndicator />

      {/* Trade UI */}
      <TradeNotificationBridge onAccept={handleAcceptTrade} onReject={handleRejectTrade} sendMessage={sendMessage} />
      <TradeModal
        myEquipment={hotbarCharacter?.equipment || []}
        myCurrency={hotbarCharacter?.currency || { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }}
        sendMessage={sendMessage}
      />
    </div>
  );
}

// Bridge component: connects trade store to notification UI
function TradeNotificationBridge({ onAccept, onReject, sendMessage }: {
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  sendMessage: (msg: any) => void;
}) {
  const pendingRequest = useTradeStore((s) => s.pendingRequest);
  const pendingOutgoing = useTradeStore((s) => s.pendingOutgoing);

  if (pendingRequest) {
    return <TradeRequestNotification request={pendingRequest} onAccept={onAccept} onReject={onReject} />;
  }

  if (pendingOutgoing) {
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999]">
        <div className="bg-gray-900 border border-blue-500/50 rounded-lg shadow-2xl px-5 py-4 min-w-[280px]">
          <div className="flex items-center gap-3">
            <span className="text-2xl animate-pulse">🤝</span>
            <div>
              <p className="text-sm text-gray-200">
                正在向 <span className="text-amber-400">{pendingOutgoing.targetName}</span> 发起交易...
              </p>
              <p className="text-xs text-gray-500 mt-0.5">等待对方回应</p>
            </div>
          </div>
          <button
            onClick={() => {
              if (pendingOutgoing.tradeId) {
                sendMessage({ type: 'trade_cancel', data: { trade_id: pendingOutgoing.tradeId } });
              }
              useTradeStore.getState().reset();
            }}
            className="mt-3 w-full px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// 玩家端音乐状态指示器
function PlayerMusicIndicator() {
  const { isPlaying, currentTrackIndex, localMuted, setLocalMuted, cleanup } = useCampaignMusicStore();

  // 组件卸载时清理音乐
  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);

  if (!isPlaying || currentTrackIndex === null) return null;

  const track = MUSIC_TRACKS[currentTrackIndex];
  if (!track) return null;

  return (
    <>
      <div className="player-music-indicator">
        <span className="player-music-bars">
          <span className="player-music-bar" />
          <span className="player-music-bar" />
          <span className="player-music-bar" />
        </span>
        <span className="player-music-name">{track.name}</span>
        <button
          className="player-music-mute"
          onClick={() => setLocalMuted(!localMuted)}
          title={localMuted ? '取消静音' : '静音'}
        >
          {localMuted ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
            </svg>
          )}
        </button>
      </div>
      <style>{`
        .player-music-indicator {
          position: fixed;
          bottom: 14px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 120;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          background: rgba(15, 12, 10, 0.85);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(245, 158, 11, 0.25);
          border-radius: 20px;
          color: #f59e0b;
          font-size: 12px;
        }
        .player-music-bars {
          display: flex;
          align-items: flex-end;
          gap: 1.5px;
          height: 12px;
        }
        .player-music-bar {
          display: block;
          width: 2px;
          background: #f59e0b;
          border-radius: 1px;
          animation: playerMusicBar 0.7s ease-in-out infinite;
        }
        .player-music-bar:nth-child(1) { animation-delay: 0s; }
        .player-music-bar:nth-child(2) { animation-delay: 0.2s; }
        .player-music-bar:nth-child(3) { animation-delay: 0.4s; }
        @keyframes playerMusicBar {
          0%, 100% { height: 3px; }
          50% { height: 12px; }
        }
        .player-music-name {
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .player-music-mute {
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: #9ca3af;
          cursor: pointer;
          padding: 2px;
        }
        .player-music-mute:hover {
          color: #f59e0b;
        }
      `}</style>
    </>
  );
}

// 右侧面板组件（客户端渲染）
function PlayerRightPanel({
  campaignId,
  currentMapUrl,
  sendMessage,
  onSelectedCharacterChange,
  activeTab,
  setActiveTab,
  isDM = false,
  isCollapsed = false,
  onToggleCollapse,
  isSidebarFullscreen,
  onToggleFullscreen,
  isCombatActive,
  userId: propUserId,
  enableDeitySystem = true,
  enable3DDice = true,
  getSpellExpandedLevels,
  toggleSpellExpandedLevel,
  unreadCount,
  floatingCharPanel,
  setFloatingCharPanel,
  globalTerrain,
  timeOfDay,
  showChatInSidebar,
}: {
  campaignId: string;
  currentMapUrl: string | null;
  sendMessage?: (message: any) => void;
  onSelectedCharacterChange?: (characterId: number | null, skipTransition?: boolean) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isDM?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  isSidebarFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  isCombatActive?: boolean;
  userId?: string;
  enableDeitySystem?: boolean;
  enable3DDice?: boolean;
  getSpellExpandedLevels?: (characterId: number) => Set<number>;
  toggleSpellExpandedLevel?: (characterId: number, level: number) => void;
  unreadCount?: number;
  floatingCharPanel?: import('~/hooks/useSidebarState').FloatingCharPanelConfig;
  setFloatingCharPanel?: (updates: Partial<import('~/hooks/useSidebarState').FloatingCharPanelConfig>) => void;
  globalTerrain?: string | null;
  timeOfDay: WorldTime;
  showChatInSidebar: boolean;
}) {
  const [selectedCharacter, setSelectedCharacter] = useState<string>("");
  const isInitialMountRef = useRef(true);  // Track initial mount to skip transition animation
  const { handleTabClick } = useCampaignSidebarTabs({
    activeTab,
    setActiveTab,
    isCollapsed,
    onToggleCollapse,
    showChatInSidebar,
  });

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAIGenerateDialog, setShowAIGenerateDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiDescription, setAiDescription] = useState("");
  const [aiGenerateProgress, setAiGenerateProgress] = useState<{
    stage: number;
    totalStages: number;
    stageName: string;
    detail: string;
  } | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(true);
  const [levelUpOpen, setLevelUpOpen] = useState(false); // 升级弹窗
  const [restoreChecked, setRestoreChecked] = useState(false); // 角色恢复接口是否完成
  const [spectatorDismissed, setSpectatorDismissed] = useState(false); // 用户是否选了旁观模式
  useEffect(() => {
    if (selectedCharacter) setSelectorOpen(false);
  }, [selectedCharacter]);

  const userId = propUserId || getCurrentUserId();

  // Use React Query hooks for cached data
  const { characters: myCharacters, refetch: refetchCharacters } = useMyCharacters(userId);
  const selectedCharId = selectedCharacter ? parseInt(selectedCharacter) : null;
  const {
    character: selectedCharacterData,
    isLoading: loading,
    silentRefetch: silentRefetchCharacter
  } = useCharacterDetails(selectedCharId);

  // Notify parent when selected character is cleared (e.g., deleted)
  // Note: Selection notifications are handled directly in handleCharacterSelect for better timing
  // Skip initial mount to avoid triggering transition animation
  useEffect(() => {
    if (isInitialMountRef.current) {
      return;  // Skip on initial mount
    }
    if (!selectedCharacter) {
      onSelectedCharacterChange?.(null, true);  // skipTransition=true to avoid "切换角色中..."
    }
  }, [selectedCharacter, onSelectedCharacterChange]);

  // Restore selected character from backend persistence (per campaign+user)
  useEffect(() => {
    const restoreSelection = async () => {
      if (!campaignId || !userId) return;
      try {
        const resp = await apiFetch(`/api/campaigns/${campaignId}/members/me/selected-character`);
        if (resp.ok) {
          const data = await resp.json();
          const savedId = data.selected_character_id;
          if (savedId) {
            // On initial load, directly set character without transition animation
            setSelectedCharacter(String(savedId));
            // Notify parent directly without transition (no animation needed on restore)
            onSelectedCharacterChange?.(savedId, true);  // skipTransition=true for initial load
          }
        }
      } catch (e) {
        logger.error("Failed to restore selected character:", e);
      } finally {
        // Mark initial mount as complete after restore attempt
        isInitialMountRef.current = false;
        setRestoreChecked(true);
      }
    };
    restoreSelection();
  }, [campaignId, userId]);

  // Listen for character_created event (when DM creates a character for this user)
  useEffect(() => {
    const handleCharacterCreated = (detail: any) => {
      const { user_id: targetUserId, character_id, character_name } = detail;
      logger.debug("[CharacterSelector] Character created event:", detail);
      // Refresh character list if the character was created for this user
      if (targetUserId === userId) {
        logger.info(`[CharacterSelector] New character "${character_name}" created for me, refreshing list`);
        refetchCharacters();
      }
    };
    return subscribeAppEvent("characterCreated", handleCharacterCreated);
  }, [userId, refetchCharacters]);

  // Listen for AI generate progress updates
  useEffect(() => {
    const handleProgress = (detail: any) => {
      const { stage, total_stages, stage_name, detail: progressDetail } = detail;
      setAiGenerateProgress({
        stage,
        totalStages: total_stages,
        stageName: stage_name,
        detail: progressDetail,
      });
    };
    return subscribeAppEvent("aiGenerateProgress", handleProgress);
  }, []);

  // Persist selected character to backend (per campaign+user)
  useEffect(() => {
    const persistSelection = async () => {
      if (!campaignId || !userId || !selectedCharacter) return;
      try {
        await apiFetch(`/api/campaigns/${campaignId}/members/me/selected-character`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ character_id: parseInt(selectedCharacter) })
        });
      } catch (e) {
        logger.error("Failed to persist selected character:", e);
      }
    };
    persistSelection();
  }, [campaignId, userId, selectedCharacter]);

  // Listen for reward updates to refresh character data
  useEffect(() => {
    const handler = (e: any) => {
      const message = e.detail;
      logger.debug("[Player Panel] Reward update event received:", message);

      if (!message?.data?.characters || !selectedCharacter) {
        logger.debug("[Player Panel] No characters or no selected character");
        return;
      }

      // Check if current character is affected
      const affectedCharacterIds = message.data.characters.map((c: any) => c.id);
      const currentCharId = parseInt(selectedCharacter);

      logger.debug(`[Player Panel] Checking if character ${currentCharId} is affected. Affected IDs:`, affectedCharacterIds);

      if (affectedCharacterIds.includes(currentCharId)) {
        logger.debug("[Player Panel] Current character received reward, refreshing data");
        silentRefetchCharacter();
      }
    };
    return subscribeAppEvent("rewardUpdate", handler);
  }, [selectedCharacter, silentRefetchCharacter]);

  // Listen for character updated events (e.g., XP/currency from rewards)
  useEffect(() => {
    const handler = (message: any) => {
      if (!selectedCharacter || !message?.data) return;

      const updatedCharacterId = message.data.character_id;
      const currentCharId = parseInt(selectedCharacter);

      if (updatedCharacterId === currentCharId) {
        logger.debug("[Player Panel] Current character updated, refreshing data");
        silentRefetchCharacter();
      }
    };
    return subscribeAppEvent("characterUpdated", handler);
  }, [selectedCharacter, silentRefetchCharacter]);

  // Listen for character equipment updates (e.g., when DM picks up items for player)
  useEffect(() => {
    const handler = (detail: any) => {
      const { characterId } = detail || {};
      if (!selectedCharacter) return;

      const currentCharId = parseInt(selectedCharacter);

      if (characterId === currentCharId) {
        logger.debug("[Player Panel] Character equipment updated via WebSocket, refreshing data");
        silentRefetchCharacter();
      }
    };
    return subscribeAppEvent("characterEquipmentUpdated", handler);
  }, [selectedCharacter, silentRefetchCharacter]);

  // Listen for character list refresh requests (e.g., avatar generated)
  useEffect(() => {
    const handler = () => {
      logger.debug("[Player Panel] Character list refresh triggered");
      refetchCharacters();
    };
    return subscribeAppEvent("characterListNeedsRefresh", handler);
  }, [refetchCharacters]);

  // Show join modal when player enters campaign without a selected character
  const showJoinModal = restoreChecked && !selectedCharacter && !spectatorDismissed && !isDM;

  const handleCharacterCreated = async (character: any): Promise<boolean> => {
    logger.debug("Character created:", character);

    try {
      // Save to backend
      const response = await fetch(`${API_BASE_URL}/api/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          ...character
        })
      });

      if (response.ok) {
        const savedCharacter = await response.json();
        logger.debug("Character saved:", savedCharacter);
        // Equipment normalization and avatar generation happen asynchronously in backend
        // Frontend will be notified via WebSocket when complete

        // Refresh character list
        refetchCharacters();

        // Select the newly created character - notify parent first for transition
        onSelectedCharacterChange?.(savedCharacter.id);
        setSelectedCharacter(savedCharacter.id.toString());

        // Close dialog
        setShowCreateDialog(false);
        return true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        logger.error("Failed to save character:", errorData);
        alert(errorData.detail || "保存角色失败，请重试");
        return false;
      }
    } catch (error) {
      logger.error("Error saving character:", error);
      alert("网络错误，请检查网络连接后重试");
      return false;
    }
  };

  const handleCharacterSelect = async (characterId: string) => {
    // Handle spectator mode selection
    if (characterId === "spectator") {
      // Clear selection - enter spectator mode
      setSelectedCharacter("");
      onSelectedCharacterChange?.(null, true);  // skipTransition for spectator mode
      // Clear backend selection
      try {
        await apiFetch(`/api/campaigns/${campaignId}/members/me/selected-character`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ character_id: null }),
        });
      } catch (e) {
        logger.error("Failed to clear selected character:", e);
      }
      return;
    }

    // CRITICAL: Notify parent FIRST to set isMapTransitioning before any state changes
    // This prevents Konva from rendering during the transition
    onSelectedCharacterChange?.(parseInt(characterId));

    // 先移除该用户在当前地图上的所有角色 Token（按 user_id 删除，确保同一地图同一用户只有一个角色）
    if (currentMapUrl) {
      try {
        const tokensResp = await fetch(
          `${API_BASE_URL}/api/tokens/campaign/${campaignId}/map?map_url=${encodeURIComponent(currentMapUrl)}`
        );
        if (tokensResp.ok) {
          const data = await tokensResp.json();
          // 删除该用户在当前地图上的所有角色 token（character_id 不为空的）
          const toDelete = (data.tokens || []).filter((t: any) =>
            t.user_id === userId && t.character_id != null
          );
          for (const tk of toDelete) {
            const del = await fetch(`${API_BASE_URL}/api/tokens/${tk.id}`, { method: "DELETE" });
            if (del.ok) {
              // 触发本地事件以便 useMapData 及时刷新
              publishAppEvent("tokenRemoved", { tokenId: tk.id });
            } else {
              logger.warn("[Player] Failed to delete token", tk.id);
            }
          }
          if (toDelete.length) {
            logger.debug(`[Player] Removed ${toDelete.length} character token(s) for user ${userId}`);
          }
        }
      } catch (e) {
        logger.error("[Player] Error removing tokens for user:", e);
      }
    }

    setSelectedCharacter(characterId);

    // 同步到后端并通知其他玩家
    try {
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/members/me/selected-character`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ character_id: parseInt(characterId) }),
        }
      );

      if (!response.ok) {
        logger.error("Failed to sync selected character to backend");
        return;
      }

      // 通过WebSocket通知其他玩家
      if (sendMessage) {
        sendMessage({
				type: "character_selected",
				data: { character_id: parseInt(characterId) },
        });
      }

      // 本地派发事件刷新队伍列表（因为WebSocket不会广播回自己）
      publishAppEvent("characterSelected", {
        user_id: userId,
        character_id: parseInt(characterId),
      });

      // 自动创建角色Token到当前地图（如果有地图）
      if (currentMapUrl) {
        try {
          const tokenResp = await fetch(`${API_BASE_URL}/api/tokens`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campaign_id: parseInt(campaignId),
              character_id: parseInt(characterId),
              user_id: userId,
              map_url: currentMapUrl,
              position_x: 500,
              position_y: 400,
              token_size: "1x1",
            }),
          });
          if (tokenResp.ok) {
            logger.debug(`[Player] Token auto-created for character ${characterId}`);
          }
        } catch (e) {
          logger.error("[Player] Error creating token:", e);
        }
      }

      logger.debug(`✅ Character ${characterId} selected and synced`);
    } catch (error) {
      logger.error("Error syncing selected character:", error);
    }
  };

  // 角色升级处理
  const handleLevelUp = async (classChoice: string, featureChoices?: any) => {
    if (!selectedCharacterData) return;
    try {
      const newLevel = (selectedCharacterData.level || 1) + 1;
      const response = await fetch(`${API_BASE_URL}/api/characters/${selectedCharacterData.id}/level-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          class_choice: classChoice,
          feature_choices: featureChoices
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Level up failed:', errorText);
        alert('升级失败，请重试');
        return;
      }

      logger.debug(`Character ${selectedCharacterData.id} leveled up to ${newLevel}`);
      setLevelUpOpen(false);
      silentRefetchCharacter(); // 刷新角色数据
    } catch (error) {
      logger.error('Level up error:', error);
      alert('升级失败，请重试');
    }
  };

  const handleAIGenerateCharacter = async () => {
    if (!aiDescription.trim()) {
      return;
    }
    try {
      setAiGenerating(true);
      setAiGenerateProgress(null); // Reset progress
      const resp = await fetch(`${API_BASE_URL}/api/characters/generate-from-description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          description: aiDescription,
          campaign_id: campaignId // Pass campaign_id for progress broadcasts
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        logger.error("AI生成失败:", t);
        alert("AI生成失败，请检查后端日志或API设置");
        return;
      }
      const created = await resp.json();
      refetchCharacters();
      await handleCharacterSelect(created.id.toString());
      setShowAIGenerateDialog(false);
      setAiDescription("");
      setAiGenerateProgress(null); // Clear progress
      alert(`已创建角色：${created.name}`);
    } catch (err) {
      logger.error("AI生成异常:", err);
      alert("AI生成异常，请打开控制台查看详情");
    } finally {
      setAiGenerating(false);
      setAiGenerateProgress(null);
    }
  };

  const handleDeleteCharacter = async () => {
    if (!selectedCharacter) return;
    try {
      setDeleteLoading(true);
      const resp = await fetch(`${API_BASE_URL}/api/characters/${selectedCharacter}`, {
        method: "DELETE",
      });
      if (!resp.ok && resp.status !== 204) {
        const t = await resp.text();
        logger.error("删除角色失败:", t);
        alert("删除失败，请重试");
        return;
      }
      logger.debug(`[Player] Character ${selectedCharacter} deleted`);
      setShowDeleteConfirm(false);
      setSelectedCharacter("");
      refetchCharacters();
    } catch (err) {
      logger.error("删除角色异常:", err);
      alert("删除失败，请查看控制台");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <>
    <Tabs.Root value={activeTab} className={`fantasy-panel flex flex-col min-h-0 ${isCollapsed ? 'h-auto' : 'h-full'}`}>
      <CampaignSidebarTabList
        tabs={[
          { value: "characters", label: "角色", icon: "🧙" },
          { value: "chat", label: "聊天", icon: "💬", hidden: !showChatInSidebar, unreadCount: unreadCount ?? 0 },
          { value: "combat", label: "战斗", icon: "⚔️", highlighted: !!isCombatActive },
          { value: "party", label: "队伍", icon: "👥" },
          { value: "rules", label: "规则", icon: "📜" },
          { value: "notes", label: "笔记", icon: "📝" },
        ]}
        isCollapsed={isCollapsed}
        isSidebarFullscreen={isSidebarFullscreen}
        onTabClick={handleTabClick}
        onToggleFullscreen={onToggleFullscreen}
        showFullscreenToggle={showChatInSidebar}
      />

      <div className={isCollapsed ? 'hidden' : 'contents'}>
      <Tabs.Content value="characters" forceMount className="flex-1 min-h-0 overflow-auto p-4 data-[state=inactive]:hidden fantasy-tab-content">
        <div className="space-y-3">
          {/* Character Selection Header - 紧凑布局 */}
          <div className="flex items-center justify-between">
            <Collapsible.Root open={selectorOpen} onOpenChange={setSelectorOpen} className="flex-1">
              <Collapsible.Trigger className="flex items-center gap-2 text-sm text-amber-400/90 hover:text-amber-400 transition-colors">
                <span>{selectorOpen ? "▼" : "▶"}</span>
                <span className="font-medium">
                  {selectedCharacterData?.name || "👁️ 旁观模式"}
                </span>
              </Collapsible.Trigger>
            </Collapsible.Root>
          </div>

          {/* Character Selection (collapsible content) */}
          <Collapsible.Root open={selectorOpen} onOpenChange={setSelectorOpen}>
            <Collapsible.Content>
              <div className="space-y-2 bg-gray-800/30 rounded-lg p-2 border border-gray-700/30">
                <Select.Root value={selectedCharacter || "spectator"} onValueChange={handleCharacterSelect}>
                  <Select.Trigger className="w-full px-2 py-1.5 bg-gray-900/50 border border-gray-700/50 rounded text-xs text-gray-300 hover:border-amber-500/30 transition-colors flex justify-between items-center">
                    <Select.Value placeholder="选择一个角色..." />
                    <Select.Icon className="ml-2 text-amber-400/60 text-[10px]">▼</Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
                      <Select.Viewport className="p-1">
                        {/* Spectator mode option */}
                        <Select.Item
                          value="spectator"
                          className="px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-700/50 hover:text-gray-200 rounded cursor-pointer outline-none transition-colors flex items-center gap-2 border-b border-gray-700/50 mb-1"
                        >
                          <Select.ItemText>
                            <span className="flex items-center gap-2">
                              <span>👁️</span>
                              <span>旁观模式</span>
                            </span>
                          </Select.ItemText>
                        </Select.Item>
                        {myCharacters.map((char: any) => {
                          const race = racesData.races.find((r: any) => r.id === char.race_id);
                          const charClass = classesData.classes.find((c: any) => c.id === char.class_id);
                          return (
                            <Select.Item
                              key={char.id}
                              value={char.id.toString()}
                              className="px-2 py-1.5 text-xs text-gray-300 hover:bg-amber-500/10 hover:text-amber-400 rounded cursor-pointer outline-none transition-colors"
                            >
                              <Select.ItemText>
                                {char.name} ({race?.name || char.race_id} {charClass?.name || char.class_id} {char.level}级)
                              </Select.ItemText>
                            </Select.Item>
                          );
                        })}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>

                {/* 创建角色按钮 - 更紧凑 */}
                <div className="flex gap-1">
                  <button
                    className="flex-1 fantasy-btn text-xs py-1"
                    onClick={() => setShowCreateDialog(true)}
                  >
                    创建
                  </button>
                  <button
                    className="flex-1 fantasy-btn text-xs py-1"
                    onClick={() => setShowImportDialog(true)}
                  >
                    📄 导入
                  </button>
                  <button
                    className="flex-1 fantasy-btn-primary text-xs py-1"
                    onClick={() => setShowAIGenerateDialog(true)}
                  >
                    ✨ AI
                  </button>
                  {selectedCharacter && (
                    <button
                      className="px-2 py-1 bg-gray-700/50 hover:bg-red-600/80 text-gray-400 hover:text-white text-xs rounded transition-colors border border-gray-600/50 hover:border-red-500/50"
                      onClick={() => setShowDeleteConfirm(true)}
                      title="删除"
                    >
                      🗑️
                    </button>
                  )}
                </div>
                {selectedCharacter && selectedCharacterData && (
                  <div className="flex gap-1 mt-1">
                    <button
                      className="flex-1 fantasy-btn text-xs py-1"
                      onClick={() => downloadCharacterMarkdown(selectedCharacterData)}
                    >
                      导出 Markdown
                    </button>
                    <button
                      className="flex-1 fantasy-btn text-xs py-1"
                      onClick={() => downloadCharacterPDF(selectedCharacterData)}
                    >
                      导出 PDF
                    </button>
                  </div>
                )}
              </div>
            </Collapsible.Content>
          </Collapsible.Root>

          {/* Selected Character Display or Spectator Mode */}
          {selectedCharacter ? (
            loading ? (
              <div className="fantasy-card text-center py-4">
                <div className="animate-spin text-2xl mb-2">⚙️</div>
                <p className="text-xs text-gray-400">加载中...</p>
              </div>
            ) : selectedCharacterData ? (
              <ClassicCardWithEquipment
                character={selectedCharacterData}
                campaignId={campaignId}
                currentMapUrl={currentMapUrl}
                userId={userId}
                isDM={false}
                onLevelUp={() => setLevelUpOpen(true)}
                onCharacterUpdate={() => silentRefetchCharacter()}
                getSpellExpandedLevels={getSpellExpandedLevels}
                toggleSpellExpandedLevel={toggleSpellExpandedLevel}
                floatingCharPanel={floatingCharPanel}
                setFloatingCharPanel={setFloatingCharPanel}
              />
            ) : (
              <div className="fantasy-card text-center py-4">
                <p className="text-xs text-gray-400">无法加载角色数据</p>
              </div>
            )
          ) : (
            /* Spectator Mode - no character selected */
            <div className="fantasy-card text-center py-6 border-2 border-dashed border-amber-500/30">
              <div className="text-3xl mb-3">👁️</div>
              <h3 className="text-amber-400 font-medium mb-2">旁观模式</h3>
              <p className="text-xs text-gray-400">
                你正在以旁观者身份查看地图<br/>
                在上方选择角色以加入游戏
              </p>
            </div>
          )}

        </div>

        {/* Character Join Modal - shown on first entry without selected character */}
        <CharacterJoinModal
          open={showJoinModal}
          onClose={() => setSpectatorDismissed(true)}
          characters={myCharacters}
          isLoading={!restoreChecked}
          onSelectCharacter={handleCharacterSelect}
          onCreateCharacter={() => {
            setSpectatorDismissed(true);
            setShowCreateDialog(true);
          }}
        />

        {/* Character Creation Wizard */}
        <CharacterCreationWizardV2
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onCharacterCreated={handleCharacterCreated}
          campaignId={campaignId}
          enableDeitySystem={enableDeitySystem}
        />

        {/* 导入角色卡对话框 */}
        <CharacterImportDialog
          open={showImportDialog}
          onOpenChange={setShowImportDialog}
          onCharacterCreated={handleCharacterCreated}
        />

        {/* AI生成角色对话框 */}
        <Dialog.Root open={showAIGenerateDialog} onOpenChange={setShowAIGenerateDialog}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
            <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-6 w-[90vw] max-w-md z-50">
              <Dialog.Title className="text-xl font-semibold text-amber-400 mb-4">
                AI一键生成角色
              </Dialog.Title>

              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">
                    角色描述
                  </label>
                  <textarea
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-300 resize-none focus:outline-none focus:border-amber-500 transition-colors"
                    rows={6}
                    placeholder="输入一段描述，例如：&#10;&#10;'希望是一个善良的精灵游侠，擅长弓箭，有着悲伤的过去。'&#10;&#10;若未指定则AI将自行决断。"
                    value={aiDescription}
                    onChange={(e) => setAiDescription(e.target.value)}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    提示：描述越详细，生成的角色越符合你的期望
                  </p>
                </div>

                {/* Progress display */}
                {aiGenerating && (
                  <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-amber-400 font-medium">
                        {aiGenerateProgress?.stageName || "准备中"}
                      </span>
                      {aiGenerateProgress && (
                        <span className="text-gray-500 text-sm">
                          ({aiGenerateProgress.stage}/{aiGenerateProgress.totalStages})
                        </span>
                      )}
                    </div>
                    {aiGenerateProgress?.detail && (
                      <p className="text-sm text-gray-400 pl-8">
                        {aiGenerateProgress.detail}
                      </p>
                    )}
                    {/* Progress bar */}
                    {aiGenerateProgress && (
                      <div className="mt-3 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 transition-all duration-300 ease-out"
                          style={{ width: `${(aiGenerateProgress.stage / aiGenerateProgress.totalStages) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-3 justify-end">
                  <button
                    className="btn-secondary text-sm px-4 py-2"
                    onClick={() => {
                      setShowAIGenerateDialog(false);
                      setAiDescription("");
                    }}
                    disabled={aiGenerating}
                  >
                    取消
                  </button>
                  <button
                    className="btn-primary text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleAIGenerateCharacter}
                    disabled={aiGenerating || !aiDescription.trim()}
                  >
                    {aiGenerating ? "生成中..." : "生成角色"}
                  </button>
                </div>
              </div>

              <Dialog.Close asChild>
                <button
                  className="absolute top-4 right-4 text-gray-500 hover:text-gray-300 transition-colors"
                  aria-label="关闭"
                >
                  ✕
                </button>
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* 删除确认对话框 */}
        <Dialog.Root open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/70 z-50" />
            <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-6 w-full max-w-md z-50">
              <Dialog.Title className="text-xl font-bold text-white flex items-center gap-2 mb-4">
                <span className="text-2xl">🗑️</span>
                <span>确认删除角色</span>
              </Dialog.Title>

              <div className="space-y-4 text-gray-300">
                <p>
                  确定要删除角色 <span className="font-bold text-amber-400">{selectedCharacterData?.name || "未知"}</span> 吗？
                </p>
                <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-4">
                  <p className="text-sm text-red-300 font-semibold">此操作不可逆，将永久删除：</p>
                  <ul className="text-sm text-red-200 mt-2 space-y-1 list-disc list-inside">
                    <li>角色的所有属性和数据</li>
                    <li>装备和物品信息</li>
                    <li>法术和技能选择</li>
                  </ul>
                </div>
              </div>

              <div className="flex gap-3 mt-6 justify-end">
                <button
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleteLoading}
                >
                  取消
                </button>
                <button
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors font-semibold disabled:opacity-50"
                  onClick={handleDeleteCharacter}
                  disabled={deleteLoading}
                >
                  {deleteLoading ? "删除中..." : "确认删除"}
                </button>
              </div>

              <Dialog.Close asChild>
                <button
                  className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                  aria-label="关闭"
                  disabled={deleteLoading}
                >
                  ✕
                </button>
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

      </Tabs.Content>

      {/* 队伍标签页 - 显示所有玩家的角色 */}
      <Tabs.Content value="party" forceMount className="flex-1 min-h-0 overflow-auto p-4 data-[state=inactive]:hidden fantasy-tab-content">
          <div className="space-y-4">
            <div className="fantasy-section-header">
              <h3>队伍成员</h3>
            </div>
            <CharacterPanel
              isDM={false}
              campaignId={campaignId}
              currentUserId={userId}
              currentMapUrl={currentMapUrl}
              globalTerrain={globalTerrain}
              timeOfDay={timeOfDay}
              getSpellExpandedLevels={getSpellExpandedLevels}
              toggleSpellExpandedLevel={toggleSpellExpandedLevel}
            />
          </div>
      </Tabs.Content>

      <Tabs.Content value="rules" className="flex-1 flex flex-col overflow-hidden data-[state=inactive]:hidden">
        {activeTab === 'rules' && (
          <RulesPanel campaignId={campaignId} userId={userId} />
        )}
      </Tabs.Content>

      {showChatInSidebar && (
        <Tabs.Content value="chat" forceMount className="flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
            <ChatPanel
              isDM={false}
              campaignId={campaignId}
              userId={userId}
              currentMapUrl={currentMapUrl}
              enable3DDice={enable3DDice}
            />
        </Tabs.Content>
      )}

      <Tabs.Content value="combat" forceMount className="flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
          <CombatPanel
            campaignId={campaignId}
            currentMapUrl={currentMapUrl}
            isDM={false}
            userId={userId}
            sendMessage={sendMessage}
          />
      </Tabs.Content>

      <Tabs.Content value="notes" className="flex-1 min-h-0 overflow-auto p-4 data-[state=inactive]:hidden">
        {activeTab === 'notes' && (
          <NotesPanel campaignId={campaignId} userId={userId} />
        )}
      </Tabs.Content>
      </div>

    </Tabs.Root>

    {/* 升级弹窗 - 放在 Tabs 外部避免 overflow 裁剪 */}
    {selectedCharacterData && (
      <EnhancedLevelUpModal
        isOpen={levelUpOpen}
        character={selectedCharacterData}
        newLevel={(selectedCharacterData.level || 1) + 1}
        onConfirm={handleLevelUp}
        onCancel={() => setLevelUpOpen(false)}
      />
    )}
    </>
  );
}

// Notes Panel Component
function NotesPanel({ campaignId, userId }: { campaignId: string; userId: string }) {
  const [quests, setQuests] = useState("");
  const [npcs, setNpcs] = useState("");
  const [personal, setPersonal] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

  // Load notes on mount
  useEffect(() => {
    const loadNotes = async () => {
      try {
        const response = await apiFetch(`/api/campaigns/${campaignId}/members/me/notes`);
        if (response.ok) {
          const data = await response.json();
          setQuests(data.quests || "");
          setNpcs(data.npcs || "");
          setPersonal(data.personal || "");
        }
      } catch (error) {
        logger.error("Failed to load notes:", error);
      } finally {
        setLoading(false);
      }
    };
    loadNotes();
  }, [campaignId, userId]);

  // Save notes
  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/members/me/notes`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quests, npcs, personal }),
        }
      );
      if (response.ok) {
        setHasChanges(false);
      } else {
        logger.error("Failed to save notes");
      }
    } catch (error) {
      logger.error("Error saving notes:", error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="text-gray-400">加载笔记中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 fantasy-tab-content">
      <div className="fantasy-section-header">
        <h3>冒险笔记</h3>
        <button
          className={`fantasy-btn text-xs ml-auto ${hasChanges ? "!border-amber-500 ring-1 ring-amber-500/30" : ""}`}
          onClick={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? "保存中..." : hasChanges ? "保存 *" : "已保存"}
        </button>
      </div>

      <div className="space-y-4">
        <div className="fantasy-card">
          <label className="text-sm text-amber-400/80 mb-2 flex items-center gap-2">
            <span>📜</span>
            任务记录
          </label>
          <textarea
            className="w-full bg-gray-900/50 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-amber-500/50 transition-colors min-h-[100px] resize-none"
            placeholder="记录当前任务和线索..."
            value={quests}
            onChange={(e) => {
              setQuests(e.target.value);
              setHasChanges(true);
            }}
          />
        </div>

        <div className="fantasy-card">
          <label className="text-sm text-amber-400/80 mb-2 flex items-center gap-2">
            <span>👥</span>
            重要NPC
          </label>
          <textarea
            className="w-full bg-gray-900/50 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-amber-500/50 transition-colors min-h-[80px] resize-none"
            placeholder="记录遇到的重要角色..."
            value={npcs}
            onChange={(e) => {
              setNpcs(e.target.value);
              setHasChanges(true);
            }}
          />
        </div>

        <div className="fantasy-card">
          <label className="text-sm text-amber-400/80 mb-2 flex items-center gap-2">
            <span>💭</span>
            个人笔记
          </label>
          <textarea
            className="w-full bg-gray-900/50 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-amber-500/50 transition-colors min-h-[120px] resize-none"
            placeholder="记录你的想法和计划..."
            value={personal}
            onChange={(e) => {
              setPersonal(e.target.value);
              setHasChanges(true);
            }}
          />
        </div>
      </div>
    </div>
  );
}
