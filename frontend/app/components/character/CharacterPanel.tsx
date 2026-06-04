import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import racesData from "~/data/rules/races.json";
import classesData from "~/data/rules/classes_with_structured_subclass_features.json";
import { formatAlignment, formatFightingStyle, formatMetamagic, formatEldritchInvocation, formatFavoredEnemy, formatHumanoid, formatFavoredTerrain } from "./CharacterDisplay/utils/formatting";
import skillsData from "~/data/rules/skills.json";
import xpThresholds from "~/data/rules/xp-thresholds.json";
import companionsData from "~/data/rules/companions.json";
import godsData from "~/data/rules/gods.json";
import spellsData from "~/data/rules/spells.json";
import { HelpTooltip } from "../shared/HelpTooltip";
import { DND_HELP_TEXTS } from "~/data/dnd-help-texts";
import { AlignmentInfoDialog } from "./CharacterDisplay/sections/Info/AlignmentInfoDialog";
import { DeityInfoDialog } from "./CharacterDisplay/sections/Info/DeityInfoDialog";
import { StatBreakdownDialog, type StatBreakdownData } from "./CharacterDisplay/sections/Info/StatBreakdownDialog";
import { getACBreakdown, getInitiativeBreakdown, getHitDiceBreakdown, getProficiencyBonusBreakdown, getHPBreakdown, getSpeedBreakdown } from "./CharacterDisplay/utils/derived";
import { getFeatRuleOverrides } from "./CharacterDisplay/utils/featEffects";
import { SpellsDialog } from "./CharacterDisplay/sections/Spells/SpellsDialog";
import { ClassFeaturesDialog } from "./CharacterDisplay/sections/ClassFeatures/ClassFeaturesDialog";
import backgroundsData from "~/data/rules/backgrounds.json";
import { CharacterProvider } from "./CharacterDisplay/context/CharacterContext";
import { useEquipment } from "./CharacterDisplay/hooks/useEquipment";
import { useCurrency } from "./CharacterDisplay/hooks/useCurrency";
import { useMapToken } from "./CharacterDisplay/hooks/useMapToken";
import { subscribeAppEvent } from "~/events/appEventBus";
import { useAvatar } from "./CharacterDisplay/hooks/useAvatar";
import { AvatarModal } from "./CharacterDisplay/sections/Avatar/AvatarModal";
import { EquipDialog } from "./CharacterDisplay/sections/Equipment/EquipDialog";
import { BagDialog } from "./CharacterDisplay/sections/Equipment/BagDialog";
import { CurrencyDialog } from "./CharacterDisplay/sections/Currency/CurrencyDialog";
import { EnhancedLevelUpModal } from "./EnhancedLevelUpModal";
import { createLogger } from '~/utils/logger';
import { publishAppEvent } from "~/events/appEventBus";
import { spellcastingAbilityMap, getAlwaysPreparedSubclassSpells, isPreparedCaster as isPreparedCasterUtil, isSpellbookCaster as isSpellbookCasterUtil, preparedMax as computePreparedMax, maxSpellLevelForClass, getRacialSpells } from "~/components/character/CharacterDisplay/utils/spellcasting";
import spellcastingConfig from "~/data/rules/spellcasting.json";
import { campaignQueryKeys, useCampaignRosterQuery } from "~/queries/campaignQueries";
import { apiFetch } from "~/utils/api-client";
import { invalidateCharacterCache, clearCharacterCache } from "~/utils/characterCache";
import { fetchCampaignMapTokensCached } from "~/utils/mapTokensCache";
import { fetchCharacterResourcesCached } from "~/utils/characterResourcesCache";
import { getApiEndpoint } from "~/config/api";
import { extractValues } from "~/utils/levelTrackingHelpers";
import { ClassicCharacterCard } from "./ClassicCharacterCard";
import { CharacterCreationWizardV2 } from "./CharacterCreationWizardV2";
import { CharacterImportDialog } from "./CharacterImportDialog";
import { FloatingCharacterPanel } from "./FloatingCharacterPanel";
import type { Spell } from "./CharacterDisplay/types/Spell";
import type { EquipmentItem, Currency, EquipSlot } from "./CharacterDisplay/types/Character";
import type { SpellcastingAbilityId, SpellcasterType } from "~/hooks/useCharacterSpellcasting";
import { characterQueryKeys } from "~/queries/characterQueries";
import {
  findCharacterToken, setConcentrationOnToken,
  addSpellBuffToToken, hasOnHitWeaponBuff,
  spellToSpellOption,
  castSpellAction,
} from "~/utils/sidebarCasting";
import type { SpellCastData } from "~/components/spell/SpellCastActions";
import { useSpellSoundStore } from "~/stores/spellSoundStore";
import { analyzeSpellTargeting } from "~/components/ui/Rules_SpellDetail";
import type { WorldTime } from "~/utils/timeUtils";

const logger = createLogger('CharacterPanel');


interface CharacterPanelProps {
  isDM: boolean;
  campaignId?: string;
  currentUserId?: string; // 当前用户ID，用于玩家视图判断是否显示完整数据
  currentMapUrl?: string | null; // 当前地图URL，用于丢弃物品到地图
  globalTerrain?: string | null; // 全局地形，用于自动匹配游侠/德鲁伊地形增益
  timeOfDay?: WorldTime;
  onSelectedCharacterChange?: (id: number | null, character: any | null) => void;
  initialSelectedCharacterId?: number | null; // DM view: restored from sidebar state
  onSelectedCharacterIdPersist?: (id: number | null) => void; // DM view: persist selection
  getSpellExpandedLevels?: (characterId: number) => Set<number>;
  toggleSpellExpandedLevel?: (characterId: number, level: number) => void;
  floatingCharPanel?: import('~/hooks/useSidebarState').FloatingCharPanelConfig;
  setFloatingCharPanel?: (updates: Partial<import('~/hooks/useSidebarState').FloatingCharPanelConfig>) => void;
}

// 辅助计算函数
function calculateProficiencyBonus(level: number): number {
  return Math.ceil(level / 4) + 1;
}

// 获取能力值的帮助文本
function getAbilityHelpText(abilityKey: string) {
  const map: Record<string, keyof typeof DND_HELP_TEXTS> = {
    strength: "strength",
    dexterity: "dexterity",
    constitution: "constitution",
    intelligence: "intelligence",
    wisdom: "wisdom",
    charisma: "charisma",
  };
  return DND_HELP_TEXTS[map[abilityKey]];
}

// 计算技能调整值
function calculateSkillModifier(
  character: any,
  skillId: string
): { modifier: number; isProficient: boolean; isExpertise: boolean } {
  const skill = (skillsData as any).skills.find((s: any) => s.id === skillId);
  if (!skill) return { modifier: 0, isProficient: false, isExpertise: false };

  // 获取对应属性值
  const abilityScore = character.ability_scores?.[skill.ability] || 10;
  const abilityModifier = Math.floor((abilityScore - 10) / 2);

  // 检查是否熟练或专精
  const isProficient = extractValues<string>(character.selected_skills).includes(skillId);
  const isExpertise = extractValues<string>(character.expertise_skills).includes(skillId);

  // 计算熟练加值
  const proficiencyBonus = calculateProficiencyBonus(character.level || 1);
  let skillBonus = 0;
  if (isExpertise) {
    skillBonus = proficiencyBonus * 2; // 专精 = 熟练加值 × 2
  } else if (isProficient) {
    skillBonus = proficiencyBonus; // 熟练 = 熟练加值
  }

  return {
    modifier: abilityModifier + skillBonus,
    isProficient,
    isExpertise,
  };
}

function calculateMaxHP(character: any): number {
  if (!character) return 0;
  const conMod = Math.floor(((character.ability_scores?.constitution || 10) - 10) / 2);
  const classData = classesData.classes.find((c: any) => c.id === character.class_id);
  const hitDie = classData?.hitDie ? (typeof classData.hitDie === 'number' ? classData.hitDie : parseInt(classData.hitDie.replace('d', ''))) : 8;

  // 1级 = 最大生命骰 + 体质调整值
  // 之后每级 = 平均生命骰值 + 体质调整值
  const level1HP = hitDie + conMod;
  const additionalHP = (character.level - 1) * (Math.floor(hitDie / 2) + 1 + conMod);
  return Math.max(1, level1HP + additionalHP);
}

function calculateAC(character: any): number {
  if (!character) return 10;
  const dexMod = Math.floor(((character.ability_scores?.dexterity || 10) - 10) / 2);
  // 基础AC = 10 + 敏捷调整值（简化版，未考虑护甲）
  return 10 + dexMod;
}

function calculateSpeed(character: any): number {
  if (!character) return 30;
  const race = racesData.races.find((r: any) => r.id === character.race_id);
  return race?.speed || 30;
}

function getSpellcastingType(classId?: string | null): "full" | "half" | "pact" | null {
  if (!classId) return null;
  if (classId === "warlock") return "pact";
  if (classId === "paladin" || classId === "ranger") return "half";
  const abilityId = (spellcastingAbilityMap as Record<string, string>)[classId];
  if (!abilityId) return null;
  return "full";
}

function getMaxSpellSlots(character: any): number[] {
  const clsId = character?.class_id;
  const type = getSpellcastingType(clsId);
  if (!type) return new Array(10).fill(0);

  const config: any = spellcastingConfig as any;
  let spellSlots: number[] = [];

  if (type === "pact") {
    const pactCfg = config?.pactMagic?.warlock || {};
    const levelKey = String(character.level || 1);
    const pactLevelEntry = pactCfg[levelKey];
    spellSlots = new Array(10).fill(0);
    if (pactLevelEntry && typeof pactLevelEntry.slots === "number") {
      const slotLevel = pactLevelEntry.level ?? 1;
      if (slotLevel >= 1 && slotLevel <= 9) {
        spellSlots[slotLevel] = pactLevelEntry.slots;
      }
    }
  } else {
    const slotTables = config?.slotTables || {};
    const tableKey = type === "full" ? "fullCaster" : "halfCaster";
    const table = slotTables[tableKey] || {};
    const levelKey = String(character.level || 1);
    const rawSlots: number[] = table[levelKey] || [];
    spellSlots = [0, ...rawSlots];
    while (spellSlots.length < 10) spellSlots.push(0);
  }

  return spellSlots;
}

type SpellSlotsStateLike =
  | number[]
  | {
      slots?: unknown;
      pact_slots?: unknown;
      pact_level?: number;
      pact_count?: number;
    }
  | null
  | undefined;

function normalizeSpellSlotArray(values: unknown): number[] {
  const slots = new Array(10).fill(0);
  if (!Array.isArray(values)) return slots;
  for (let index = 0; index < Math.min(values.length, 10); index += 1) {
    const raw = values[index];
    const value = typeof raw === "number" ? raw : Number(raw ?? 0);
    slots[index] = Number.isFinite(value) ? Math.max(0, value) : 0;
  }
  return slots;
}

function consumeSpellSlotsState(
  state: SpellSlotsStateLike,
  level: number,
  fallbackMaxSlots: number[],
): SpellSlotsStateLike {
  if (level <= 0 || level >= 10) return state;

  if (Array.isArray(state) || state == null) {
    const next = normalizeSpellSlotArray(Array.isArray(state) ? state : fallbackMaxSlots);
    if ((next[level] ?? 0) <= 0) return state;
    next[level] -= 1;
    return next;
  }

  const regularSlots = normalizeSpellSlotArray(state.slots);
  const pactSlots = normalizeSpellSlotArray(state.pact_slots);
  if ((regularSlots[level] ?? 0) > 0) {
    regularSlots[level] -= 1;
  } else if ((pactSlots[level] ?? 0) > 0) {
    pactSlots[level] -= 1;
  } else {
    return state;
  }

  return {
    ...state,
    slots: regularSlots,
    pact_slots: pactSlots,
  };
}

type RosterItem = {
  user_id: string;
  role: string;
  selected_character_id: number | null;
  character?: any | null;
  is_virtual?: boolean;
  display_name?: string | null;
  member_id?: number;
};

// Helper to check if a class is a spellcaster
function isSpellcasterClass(classId: string | null, subclassId?: string | null): boolean {
  if (!classId) return false;
  const spellcasterClasses = ['wizard', 'sorcerer', 'cleric', 'druid', 'bard', 'warlock', 'paladin', 'ranger'];
  if (spellcasterClasses.includes(classId)) return true;
  if (classId === 'fighter' && subclassId === 'eldritch_knight') return true;
  if (classId === 'rogue' && subclassId === 'arcane_trickster') return true;
  return false;
}

// Wrapper that auto-fetches classResources for ClassicCharacterCard
function ClassicCardWithResources({ character, campaignId, currentMapUrl, currentUserId, ...rest }: {
  character: any; campaignId?: string; currentMapUrl?: string | null; currentUserId?: string; [key: string]: any;
}) {
  const [classResources, setClassResources] = useState<any[] | undefined>(undefined);
  const [resourceRefreshKey, setResourceRefreshKey] = useState(0);
  const classFeatureUsesKey = JSON.stringify((character as any).class_feature_uses || {});

  // Spell cast handler — delegate to unified castSpellAction (slot deduction handled by backend or legacy path)
  const handleCastSpell = useCallback(async (data: SpellCastData) => {
    await castSpellAction(data.spell, data.level, character.id, {
      campaignId: campaignId || '', currentMapUrl, userId: currentUserId,
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
  }, [character.id, campaignId, currentMapUrl, currentUserId]);

  useEffect(() => {
    const handler = (detail: { characterId?: number | string }) => {
      const charId = detail?.characterId;
      if (!charId || charId === character.id) setResourceRefreshKey(k => k + 1);
    };
    return subscribeAppEvent('classFeatureUsesUpdated', handler);
  }, [character.id]);

  useEffect(() => {
    let cancelled = false;
    fetchCharacterResourcesCached(character.id, { userId: currentUserId })
      .then((resources) => {
        if (!cancelled) setClassResources(resources);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [character.id, character.level, classFeatureUsesKey, currentUserId, resourceRefreshKey]);

  // Companion on-map tracking
  const [companionOnMap, setCompanionOnMap] = useState(false);
  const hasBeast = !!character.subclass_choices?.beastCompanion;
  const hasFamiliar = !!character.subclass_choices?.familiarForm;
  const hasCompanionOrFamiliar = hasBeast || hasFamiliar;
  useEffect(() => {
    if (!hasCompanionOrFamiliar || !currentMapUrl || !campaignId) { setCompanionOnMap(false); return; }
    let cancelled = false;
    fetchCampaignMapTokensCached(campaignId, currentMapUrl, { userId: currentUserId })
      .then(data => {
        if (cancelled) return;
        const tokens: any[] = data.tokens || data;
        setCompanionOnMap(tokens.some((t: any) => t.controller_character_id === character.id && (t.control_type === 'companion' || t.control_type === 'familiar')));
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentMapUrl, campaignId, character.id, currentUserId, hasCompanionOrFamiliar]);

  return (
    <ClassicCharacterCard
      {...rest}
      character={character}
      campaignId={campaignId}
      currentMapUrl={currentMapUrl}
      userId={currentUserId}
      currentWorldTime={rest.timeOfDay}
      classResources={classResources}
      slotStateManagedByParent
      isCompanionOnMap={companionOnMap}
      onSummonCompanion={hasCompanionOrFamiliar && campaignId ? async () => {
        if (!currentMapUrl) return;
        try {
          const resp = await apiFetch('/api/monster-instances/summon-companion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ character_id: character.id, campaign_id: parseInt(campaignId), map_url: currentMapUrl }),
            userId: currentUserId,
          });
          if (resp.ok) setCompanionOnMap(true);
        } catch (e) { logger.error('Summon companion error:', e); }
      } : undefined}
      onDismissCompanion={hasCompanionOrFamiliar && campaignId ? async () => {
        if (!currentMapUrl) return;
        try {
          const resp = await apiFetch('/api/monster-instances/dismiss-companion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ character_id: character.id, campaign_id: parseInt(campaignId), map_url: currentMapUrl }),
            userId: currentUserId,
          });
          if (resp.ok) setCompanionOnMap(false);
        } catch (e) { logger.error('Dismiss companion error:', e); }
      } : undefined}
      onCastSpell={rest.onCastSpell || handleCastSpell}
    />
  );
}

// DM Character View - handles equipment and spells dialogs for selected character
interface DMCharacterViewProps {
  character: any;
  campaignId: string;
  currentUserId?: string;
  currentMapUrl?: string | null;
  globalTerrain?: string | null;
  timeOfDay?: WorldTime;
  onRefetch: () => void;
  onEdit: (char: any) => void;
  onKick: (userId: string, name?: string) => void;
  onDeleteVP?: (memberId: number, displayName?: string) => void;
  rosterItem?: { user_id: string; is_virtual?: boolean; display_name?: string | null; member_id?: number };
  wildShapeData?: any;
  tempHP?: number | null;
  campaignAvatars?: string[];
  getSpellExpandedLevels?: (characterId: number) => Set<number>;
  toggleSpellExpandedLevel?: (characterId: number, level: number) => void;
  floatingCharPanel?: import('~/hooks/useSidebarState').FloatingCharPanelConfig;
  setFloatingCharPanel?: (updates: Partial<import('~/hooks/useSidebarState').FloatingCharPanelConfig>) => void;
}

function DMCharacterView({ character, campaignId, currentUserId, currentMapUrl, globalTerrain, timeOfDay, onRefetch, onEdit, onKick, onDeleteVP, rosterItem, wildShapeData, tempHP, campaignAvatars, getSpellExpandedLevels, toggleSpellExpandedLevel, floatingCharPanel, setFloatingCharPanel }: DMCharacterViewProps) {
  const [spellsDialogOpen, setSpellsDialogOpen] = useState(false);
  const [levelUpOpen, setLevelUpOpen] = useState(false);
  const [profHelpOpen, setProfHelpOpen] = useState(false);
  const [profHelpType, setProfHelpType] = useState<"weapon" | "armor">("weapon");
  const [classFeaturesOpen, setClassFeaturesOpen] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [classResources, setClassResources] = useState<any[] | undefined>(undefined);
  const [resourceVersion, setResourceVersion] = useState(0);

  // Floating character panel: status tab portal container
  const statusContainerRef = useRef<HTMLDivElement | null>(null);
  const [statusContainer, setStatusContainer] = useState<HTMLDivElement | null>(null);
  const statusContainerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    statusContainerRef.current = el;
    setStatusContainer(el);
  }, []);

  const [concConflict, setConcConflict] = useState<{
    spell: Spell; level: number; tokenId: number; currentSpellName: string;
  } | null>(null);

  // Track concentration spell for spellbook display
  const [concentrationSpellId, setConcentrationSpellId] = useState<string | null>(null);
  const [concentrationSpellName, setConcentrationSpellName] = useState<string | null>(null);
  const [castingSpellName, setCastingSpellName] = useState<string | null>(null);
  useEffect(() => {
    if (!currentMapUrl || !campaignId) {
      setConcentrationSpellId(null);
      setConcentrationSpellName(null);
      setCastingSpellName(null);
      return;
    }
    findCharacterToken(character.id, campaignId, currentMapUrl, currentUserId)
      .then(result => {
        const conc = result?.data?.concentration_spell;
        setConcentrationSpellId(conc?.spell_id || null);
        setConcentrationSpellName(conc?.spell_name || null);
        setCastingSpellName(result?.data?.casting_in_progress?.spell_name || null);
      })
      .catch(() => { setConcentrationSpellId(null); setConcentrationSpellName(null); setCastingSpellName(null); });
  }, [character.id, campaignId, currentMapUrl, currentUserId]);

  // Sync concentration from WebSocket updates
  useEffect(() => {
    const handler = (detail: { characterId?: number | string; concentrationSpell?: { spell_id?: string; spell_name?: string } | null }) => {
      if (detail?.characterId === character.id) {
        setConcentrationSpellId(detail.concentrationSpell?.spell_id || null);
        setConcentrationSpellName(detail.concentrationSpell?.spell_name || null);
      }
    };
    return subscribeAppEvent('characterConcentrationChanged', handler);
  }, [character.id]);

  useEffect(() => {
    const handler = (detail: { characterId?: number | string; castingInProgress?: { spell_name?: string } | null }) => {
      if (detail?.characterId === character.id) {
        setCastingSpellName(detail.castingInProgress?.spell_name || null);
      }
    };
    return subscribeAppEvent('characterCastingChanged', handler);
  }, [character.id]);

  // Track whether companion token is on the current map
  const [companionOnMap, setCompanionOnMap] = useState(false);
  const dmHasCompanionOrFamiliar = !!(character.subclass_choices?.beastCompanion || character.subclass_choices?.familiarForm);
  useEffect(() => {
    if (!currentMapUrl || !campaignId || !dmHasCompanionOrFamiliar) {
      setCompanionOnMap(false);
      return;
    }
    let cancelled = false;
    fetchCampaignMapTokensCached(campaignId, currentMapUrl, { userId: currentUserId })
      .then(data => {
        if (cancelled) return;
        const tokens: any[] = data.tokens || data;
        const found = tokens.some((t: any) => t.controller_character_id === character.id && (t.control_type === 'companion' || t.control_type === 'familiar'));
        setCompanionOnMap(found);
      }).catch((e) => { logger.warn('Companion detection error:', e); });
    const onRemoved = () => {
      // Re-query to check if companion is still on the map
      if (!currentMapUrl || !campaignId) return;
      fetchCampaignMapTokensCached(campaignId, currentMapUrl, { userId: currentUserId, force: true })
        .then(data => {
          if (cancelled) return;
          const tokens: any[] = data.tokens || data;
          setCompanionOnMap(tokens.some((t: any) => t.controller_character_id === character.id && (t.control_type === 'companion' || t.control_type === 'familiar')));
        }).catch(() => {});
    };
    const unsubscribePlaced = subscribeAppEvent("tokenPlaced", (detail) => {
      const tk = detail?.token as any;
      if (tk?.controller_character_id === character.id && (tk?.control_type === 'companion' || tk?.control_type === 'familiar')) {
        setCompanionOnMap(true);
      }
    });
    const unsubscribeRemoved = subscribeAppEvent("tokenRemoved", () => {
      onRemoved();
    });
    return () => {
      cancelled = true;
      unsubscribePlaced();
      unsubscribeRemoved();
    };
  }, [currentMapUrl, campaignId, character.id, currentUserId, dmHasCompanionOrFamiliar]);

  // Listen for resource changes from other clients (WebSocket)
  useEffect(() => {
    const handler = (detail: { characterId?: number | string }) => {
      const charId = detail?.characterId;
      if (!charId || charId === character.id) setResourceVersion(v => v + 1);
    };
    return subscribeAppEvent('classFeatureUsesUpdated', handler);
  }, [character.id]);

  // Fetch class resources (for display in ClassicCharacterCard)
  const classFeatureUsesKey = JSON.stringify((character as any).class_feature_uses || {});
  useEffect(() => {
    let cancelled = false;
    const fetchResources = async () => {
      try {
        const resources = await fetchCharacterResourcesCached(character.id, { userId: currentUserId });
        if (!cancelled) setClassResources(resources);
      } catch (_) { /* silent */ }
    };
    fetchResources();
    return () => { cancelled = true; };
  }, [character.id, character.level, classFeatureUsesKey, currentUserId, resourceVersion]);

  const showToast = useCallback((msg: string) => {
    // Simple toast - could be improved
    logger.info(msg);
  }, []);

  // Handle level up
  const handleLevelUp = useCallback(async (classChoice: string, featureChoices?: any) => {
    try {
      const response = await apiFetch(`/api/characters/${character.id}/level-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          class_choice: classChoice,
          feature_choices: featureChoices,
          campaign_id: campaignId ? parseInt(campaignId) : undefined,
        }),
        userId: currentUserId,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Level up failed:', errorText);
        return;
      }

      setLevelUpOpen(false);
      onRefetch();
    } catch (error) {
      logger.error('Level up error:', error);
    }
  }, [character.id, currentUserId, campaignId, onRefetch]);

  // Handle level reset
  const handleResetLevel = useCallback(async () => {
    if (!confirm(`确定要将 ${character.name} 的等级重置为 1 级吗？\n\n这将清除所有升级选择（子职业、法术、战斗风格、专精等），恢复到 1 级初始状态。`)) {
      return;
    }
    try {
      const response = await apiFetch(`/api/characters/${character.id}/reset-to-level-one`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        userId: currentUserId,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Reset level failed:', errorText);
        alert(`重置等级失败: ${errorText}`);
        return;
      }

      alert(`${character.name} 的等级已重置为 1 级`);
      onRefetch();
    } catch (error) {
      logger.error('Reset level error:', error);
      alert(`重置等级失败: ${error}`);
    }
  }, [character.id, character.name, currentUserId, onRefetch]);

  const persistCharacterPartial = useCallback(async (
    nextEquipment?: EquipmentItem[],
    nextPreparedSpells?: string[],
    nextCurrency?: Currency
  ) => {
    const payload: any = {};
    if (nextEquipment !== undefined) payload.equipment = nextEquipment;
    if (nextPreparedSpells !== undefined) payload.prepared_spells = nextPreparedSpells;
    if (nextCurrency !== undefined) payload.currency = nextCurrency;

    if (Object.keys(payload).length === 0) return false;
    if (campaignId) payload.broadcast_campaign_id = campaignId;

    try {
      const resp = await apiFetch(`/api/characters/${character.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        userId: currentUserId,
      });
      if (resp.ok) {
        onRefetch();
        return true;
      }
      return false;
    } catch (e) {
      logger.error("Failed to persist character:", e);
      return false;
    }
  }, [character.id, currentUserId, onRefetch, campaignId]);

  const equipment = useEquipment({
    character,
    campaignId,
    currentMapUrl: currentMapUrl || null,
    persistCharacterPartial,
    showToast,
  });

  const currency = useCurrency({ character, persistCharacterPartial });

  // Somatic freedom and silenced status for SpellsDialog
  const featIds = useMemo(() => (character.feats || (character as any).featIds || []).map((f: any) => typeof f === 'string' ? f : f.id || ''), [character.feats]);
  const hasSomaticFreedom = useMemo(() => getFeatRuleOverrides(featIds).has('somatic_with_hands_full'), [featIds]);
  const isSilenced = useMemo(() => {
    const raw = (character as any).status_effects || (character as any).statusEffects || [];
    const effects = Array.isArray(raw) ? raw : [];
    return effects.some((e: any) => (e.condition || e.id || e) === 'silenced');
  }, [(character as any).status_effects, (character as any).statusEffects]);

  // Check if character has token on map (for discard to map feature)
  const { hasTokenOnMap } = useMapToken({
    character,
    campaignId,
    currentMapUrl: currentMapUrl || null,
    userId: currentUserId,
  });

  // Listen for equipment consumable use events (from ClassicCharacterCard context menu)
  useEffect(() => {
    const handler = (detail: any) => {
      const { characterId, item } = detail;
      if (characterId !== character.id) return;
      const maxHp = calculateMaxHP(character);
      const currentHp = typeof character.current_hp === 'number' ? character.current_hp : maxHp;
      equipment.useConsumableDirect(item, currentHp, maxHp);
    };
    return subscribeAppEvent("equipmentConsumableUse", handler);
  }, [character.id, character.current_hp, equipment]);

  // Avatar generation for DM
  const { genLoading, regenEquipLoading, handleGenerateAvatar, handleUploadAvatar, handleRegenerateWithEquipment } = useAvatar({
    character,
    userId: character.user_id || currentUserId || '',
    onAvatarUpdated: onRefetch,
    equipmentLocal: equipment.equipmentLocal,
  });

  // Compute spell data
  const allSpells = useMemo(() => (spellsData as any).spells || [], []);
  const preparedCasters = ['wizard', 'cleric', 'druid', 'paladin'];
  const isPreparedCaster = preparedCasters.includes(character.class_id);

  const preparedIds = useMemo(() => {
    const spells = isPreparedCaster
      ? (character.prepared_spells || [])
      : (character.selected_spells || []);
    return spells.map((s: any) => typeof s === 'string' ? s : s.id);
  }, [character, isPreparedCaster]);

  // Compute spellcasting info
  const spellcastingInfo = useMemo(() => {
    const classId = character.class_id;
    const abilityId = (spellcastingAbilityMap as Record<string, string>)[classId] as SpellcastingAbilityId | undefined;
    if (!abilityId) return null;

    const race = (racesData as any).races?.find((r: any) => r.id === character.race_id);
    const subrace = race?.subraces?.find((s: any) => s.id === character.subrace_id);
    const baseScores = character.ability_scores || {};
    const raceBonuses = race?.abilityScoreIncrease || {};
    const subBonuses = subrace?.abilityScoreIncrease || {};

    const finalScores = {
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
        if (slotLevel >= 1 && slotLevel <= 9) {
          spellSlots[slotLevel] = pactEntry.slots;
        }
      }
    } else {
      const tableKey = spellcasterType === 'full' ? 'fullCaster' : 'halfCaster';
      const table = config?.slotTables?.[tableKey] || {};
      const levelKey = String(character.level || 1);
      const rawSlots: number[] = table[levelKey] || [];
      spellSlots = [0, ...rawSlots];
      while (spellSlots.length < 10) spellSlots.push(0);
    }

    let preparedMax = 0;
    if (isPreparedCaster) {
      const abilityMods: Record<string, number> = {
        strength: Math.floor((finalScores.strength - 10) / 2),
        dexterity: Math.floor((finalScores.dexterity - 10) / 2),
        constitution: Math.floor((finalScores.constitution - 10) / 2),
        intelligence: Math.floor((finalScores.intelligence - 10) / 2),
        wisdom: Math.floor((finalScores.wisdom - 10) / 2),
        charisma: Math.floor((finalScores.charisma - 10) / 2),
      };
      preparedMax = computePreparedMax(character, abilityMods);
    }

    const abilityLabels: Record<string, string> = {
      intelligence: '智力',
      wisdom: '感知',
      charisma: '魅力',
    };

    // Compute racial spells (cantrips + leveled)
    const racialSpells = getRacialSpells(character.race_id, character.subrace_id ?? null, character.level || 1, character.race_choices || (character as any).raceChoices);
    const racialCantripIds = racialSpells.filter(rs => rs.level === 0).map(rs => rs.id);
    const racialLeveledIds = racialSpells.filter(rs => rs.level > 0).map(rs => rs.id);

    return {
      isPreparedCaster,
      cantripsLocal: (() => {
        const base = (character.selected_cantrips || []).map((s: any) => typeof s === 'string' ? s : s.id);
        return Array.from(new Set([...base, ...racialCantripIds]));
      })(),
      knownSpells: (() => {
        let base: string[];
        if (isSpellbookCasterUtil(classId)) {
          base = (character.selected_spells || []).map((s: any) => typeof s === 'string' ? s : s.id);
        } else if (isPreparedCaster) {
          base = allSpells.filter((s: Spell) => s.level > 0 && s.level <= maxSpellLevelForClass(classId, character.level || 1) && s.classes?.includes(classId)).map((s: Spell) => s.id);
        } else {
          base = (character.selected_spells || []).map((s: any) => typeof s === 'string' ? s : s.id);
        }
        return Array.from(new Set([...base, ...racialLeveledIds]));
      })(),
      preparedLocal: Array.from(new Set([...preparedIds, ...racialLeveledIds])),
      preparedCount: preparedIds.length,
      preparedMax,
      spellcastingAbilityLabel: abilityLabels[abilityId] || abilityId,
      spellcastingAbilityScore: finalScores[abilityId],
      spellcastingAbilityMod: abilityMod,
      spellcastingAbilityId: abilityId,
      spellcasterType,
      spellSaveDC,
      spellAttackStr: `+${spellAttackMod}`,
      spellSlots,
      remainingSlots: character.spell_slots_state || spellSlots,
      autoPrepared: getAlwaysPreparedSubclassSpells(character),
      racialSpellMeta: Object.fromEntries(racialSpells.map(rs => [rs.id, { usesPerDay: rs.usesPerDay, traitName: rs.traitName, spellcastingAbility: rs.spellcastingAbility }])),
      // SpellcastingInfo interface fields
      abilityId,
      abilityLabel: abilityLabels[abilityId] || abilityId,
      abilityMod,
      spellAttackBonus: spellAttackMod,
      type: spellcasterType,
    };
  }, [character, preparedIds, isPreparedCaster]);

  // Spell slot consumption handler (shared between ClassicCharacterCard and SpellsDialog)
  const handleConsumeSlot = useCallback((level: number) => {
    if (!spellcastingInfo) return;
    const newSlots = [...spellcastingInfo.remainingSlots];
    if (newSlots[level] > 0) {
      newSlots[level]--;
      const payload: Record<string, unknown> = { spell_slots_state: newSlots };
      if (campaignId) payload.broadcast_campaign_id = campaignId;
      apiFetch(`/api/characters/${character.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        userId: currentUserId,
      }).then(() => onRefetch());
    }
  }, [spellcastingInfo, campaignId, character.id, currentUserId, onRefetch]);

  // DM: set a specific spell slot level to a specific value
  const handleSetSlot = useCallback((level: number, value: number) => {
    if (!spellcastingInfo) return;
    const newSlots = [...spellcastingInfo.remainingSlots];
    newSlots[level] = value;
    const payload: Record<string, unknown> = { spell_slots_state: newSlots };
    if (campaignId) payload.broadcast_campaign_id = campaignId;
    apiFetch(`/api/characters/${character.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      userId: currentUserId,
    }).then(() => onRefetch());
  }, [spellcastingInfo, campaignId, character.id, currentUserId, onRefetch]);

  // Cast spell — delegate to unified castSpellAction (slot deduction handled by backend or legacy path)
  const handleCastSpell = useCallback(async (data: SpellCastData) => {
    await castSpellAction(data.spell, data.level, character.id, {
      campaignId, currentMapUrl, userId: currentUserId,
      spellSaveDC: spellcastingInfo?.spellSaveDC ?? undefined,
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
  }, [character.id, campaignId, currentMapUrl, currentUserId, spellcastingInfo?.spellSaveDC]);

  const confirmConcentrationReplace = useCallback(async () => {
    if (!concConflict) return;
    const { spell, level, tokenId } = concConflict;
    setConcConflict(null);
    await setConcentrationOnToken(tokenId, spell, level, currentUserId);
    if (hasOnHitWeaponBuff(spell)) {
      await addSpellBuffToToken(tokenId, spell, level, [], currentUserId);
    }
  }, [concConflict, currentUserId]);

  // Computed values for ClassFeaturesDialog
  const race = useMemo(() =>
    racesData.races.find((r: any) => r.id === character.race_id),
    [character.race_id]
  );
  const subrace = useMemo(() =>
    race?.subraces?.find((s: any) => s.id === character.subrace_id),
    [race, character.subrace_id]
  );
  const charClass = useMemo(() =>
    classesData.classes.find((c: any) => c.id === character.class_id),
    [character.class_id]
  );
  const subclass = useMemo(() =>
    charClass?.subclasses?.find((s: any) => s.id === character.subclass_id),
    [charClass, character.subclass_id]
  );
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
    return extractValues<string>(character.selected_skills);
  }, [character.selected_skills]);
  const raceChoiceSkills = useMemo(() => {
    const choices = character.race_choices || {};
    return choices.skill_proficiencies || [];
  }, [character.race_choices]);
  const subclassChoiceSkillsRaw = useMemo(() => {
    const choices = character.subclass_choices || {};
    return choices.skill_proficiencies || [];
  }, [character.subclass_choices]);

  return (
    <CharacterProvider
      character={character}
      campaignId={campaignId}
      currentMapUrl={null}
      userId={character.user_id}
      isDM={true}
      showToast={showToast}
      persistCharacterPartial={persistCharacterPartial}
    >
      <div className="space-y-3">
        <ClassicCharacterCard
          character={character}
          campaignId={campaignId}
          currentMapUrl={currentMapUrl}
          userId={currentUserId}
          isDM={true}
          globalTerrain={globalTerrain}
          currentWorldTime={timeOfDay}
          classResources={classResources}
          slotStateManagedByParent
          onResourceChanged={() => setResourceVersion(v => v + 1)}
          isSpellcaster={isSpellcasterClass(character.class_id, character.subclass_id)}
          spellsAll={allSpells}
          cantripsLocal={character.selected_cantrips?.map((s: any) => typeof s === 'string' ? s : s.id) || []}
          preparedLocal={preparedIds}
          spellcasting={spellcastingInfo}
          remainingSlots={character.spell_slots_state || []}
          onLevelUp={() => setLevelUpOpen(true)}
          onConsumeSlot={handleConsumeSlot}
          onSetSlot={handleSetSlot}
          onCastSpell={handleCastSpell}
          castingSpellName={castingSpellName}
          onOpenSpells={() => {
            if (setFloatingCharPanel && spellcastingInfo) {
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
          onAvatarClick={() => setAvatarModalOpen(true)}
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
          wildShapeData={wildShapeData}
          tempHP={tempHP}
          onSummonCompanion={dmHasCompanionOrFamiliar ? async () => {
            if (!currentMapUrl) { logger.warn('No map loaded, cannot summon companion'); return; }
            try {
              const resp = await apiFetch('/api/monster-instances/summon-companion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  character_id: character.id,
                  campaign_id: parseInt(campaignId),
                  map_url: currentMapUrl,
                }),
                userId: currentUserId,
              });
              if (resp.ok) setCompanionOnMap(true);
            } catch (e) {
              logger.error('Summon companion error:', e);
            }
          } : undefined}
          onDismissCompanion={dmHasCompanionOrFamiliar ? async () => {
            if (!currentMapUrl) { logger.warn('No map loaded, cannot dismiss companion'); return; }
            try {
              const resp = await apiFetch('/api/monster-instances/dismiss-companion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  character_id: character.id,
                  campaign_id: parseInt(campaignId),
                  map_url: currentMapUrl,
                }),
                userId: currentUserId,
              });
              if (resp.ok) setCompanionOnMap(false);
            } catch (e) {
              logger.error('Dismiss companion error:', e);
            }
          } : undefined}
          isCompanionOnMap={companionOnMap}
          spellExpandedLevels={getSpellExpandedLevels?.(character.id)}
          onToggleSpellLevel={toggleSpellExpandedLevel ? (level: number) => toggleSpellExpandedLevel(character.id, level) : undefined}
          onOpenStatusEffects={setFloatingCharPanel ? () => {
            setFloatingCharPanel({ stage: 'open', activeTab: 'status' });
          } : undefined}
          floatingStatusActive={floatingCharPanel?.stage === 'open' && floatingCharPanel?.activeTab === 'status'}
          floatingStatusContainer={statusContainer}
        />
        {/* DM Actions */}
        <div className="flex gap-2 pt-2 flex-wrap">
          <button
            className="fantasy-btn text-xs flex-1"
            onClick={() => onEdit(character)}
          >
            <span>✏️</span> 编辑
          </button>
          {character.level > 1 && (
            <button
              className="fantasy-btn text-xs flex-1 !text-orange-400 !border-orange-700/50 hover:!bg-orange-900/20 hover:!border-orange-600"
              onClick={handleResetLevel}
              title="重置等级为1级"
            >
              <span>🔄</span> 重置等级
            </button>
          )}
          {rosterItem && rosterItem.is_virtual && rosterItem.member_id && onDeleteVP && (
            <button
              className="fantasy-btn text-xs flex-1 !text-red-400 !border-red-700/50 hover:!bg-red-900/20 hover:!border-red-600"
              onClick={() => onDeleteVP(rosterItem.member_id!, rosterItem.display_name || character.name)}
            >
              <span>🗑</span> 删除虚拟玩家
            </button>
          )}
          {rosterItem && !rosterItem.is_virtual && rosterItem.user_id !== currentUserId && (
            <button
              className="fantasy-btn text-xs flex-1 !text-red-400 !border-red-700/50 hover:!bg-red-900/20 hover:!border-red-600"
              onClick={() => onKick(rosterItem.user_id, character.name)}
            >
              <span>🚫</span> 踢出
            </button>
          )}
        </div>

        {/* Beast Companion Card */}
        {character.subclass_choices?.beastCompanion && (() => {
          const beastId = character.subclass_choices.beastCompanion;
          const beast = companionsData.categories.beast_master.creatures.find((c: any) => c.id === beastId);
          if (!beast) return null;
          return (
            <div className="p-3 bg-green-900/20 border border-green-700/50 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-green-400 font-bold text-sm">🐾 {beast.name}</span>
                <span className="text-green-300/60 text-xs">{beast.nameEn}</span>
              </div>
              <div className="text-xs text-gray-300 flex gap-3 flex-wrap">
                <span>AC {beast.ac}</span>
                <span>HP {beast.hp}</span>
                <span>CR {beast.cr}</span>
                <span>{beast.size}</span>
              </div>
              {beast.actions?.map((a: any, i: number) => (
                <div key={i} className="text-xs text-gray-400 mt-1">
                  <span className="text-green-300">{a.name}</span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Familiar Card */}
        {character.subclass_choices?.familiarForm && (() => {
          const familiarId = character.subclass_choices.familiarForm;
          const familiar = (companionsData as any).categories.find_familiar?.creatures?.find((c: any) => c.id === familiarId);
          if (!familiar) return null;
          return (
            <div className="p-3 bg-purple-900/20 border border-purple-700/50 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-purple-400 font-bold text-sm">🔮 {familiar.name}</span>
                <span className="text-purple-300/60 text-xs">{familiar.nameEn}</span>
              </div>
              <div className="text-xs text-gray-300 flex gap-3 flex-wrap">
                <span>AC {familiar.ac}</span>
                <span>HP {familiar.hp}</span>
                <span>CR {familiar.cr}</span>
                <span>{familiar.size}</span>
              </div>
              {familiar.actions?.map((a: any, i: number) => (
                <div key={i} className="text-xs text-gray-400 mt-1">
                  <span className="text-purple-300">{a.name}</span>
                </div>
              ))}
            </div>
          );
        })()}

      </div>

      {/* Equipment Dialog */}
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
        onEquipmentUpdate={async (items, currency) => {
          equipment.setEquipmentLocal(items);
          await persistCharacterPartial(items, undefined, currency);
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
        onRegenerateAvatar={handleRegenerateWithEquipment}
        avatarRegenerating={regenEquipLoading}
        onUseConsumable={async (item) => {
          const maxHp = calculateMaxHP(character);
          const currentHp = typeof character.current_hp === 'number' ? character.current_hp : maxHp;
          await equipment.useConsumableDirect(item, currentHp, maxHp);
        }}
        isPaperItem={equipment.isPaperItem}
        onWriteOnPaper={equipment.handleWriteOnPaper}
        onEditWrittenPaper={equipment.handleEditWrittenPaper}
        onCopyPaper={equipment.handleCopyPaper}
        isDMAddItem
      />

      {/* Currency Dialog */}
      <CurrencyDialog
        open={currency.currencyDialogOpen}
        onOpenChange={currency.setCurrencyDialogOpen}
        currencyLocal={currency.currencyLocal}
        setCurrencyLocal={currency.setCurrencyLocal}
        handleSaveCurrency={currency.handleSaveCurrency}
      />

      {/* Spells Dialog */}
      {spellcastingInfo && (
        <SpellsDialog
          open={spellsDialogOpen}
          onOpenChange={setSpellsDialogOpen}
          isPreparedCaster={spellcastingInfo.isPreparedCaster}
          classId={character.class_id}
          cantripsLocal={spellcastingInfo.cantripsLocal}
          knownSpells={spellcastingInfo.knownSpells}
          preparedLocal={spellcastingInfo.preparedLocal}
          preparedCount={spellcastingInfo.preparedCount}
          preparedMax={spellcastingInfo.preparedMax}
          togglePreparedWithLimit={() => {}}
          setPreparedSpellsAndPersist={async (spells: string[]) => {
            await persistCharacterPartial(undefined, spells, undefined);
          }}
          spellsAll={allSpells}
          racialSpellMeta={spellcastingInfo.racialSpellMeta}
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
          onCastSpell={handleCastSpell}
          canPrepareSpells={true}
          onPreparationFinished={() => {}}
          eldritchInvocations={
            (character.eldritch_invocations || character.eldritchInvocations || [])
              .map((i: any) => typeof i === 'string' ? i : i.value || i.id || '')
          }
          charismaMod={spellcastingInfo.spellcastingAbilityMod ?? 0}
          subclassId={character.subclass_id}
          equipment={equipment.equipmentLocal}
          isSilenced={isSilenced}
          hasSomaticFreedom={hasSomaticFreedom}
          concentratingSpellId={concentrationSpellId}
          concentratingSpellName={concentrationSpellName}
          campaignId={campaignId}
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

      {/* Level Up Modal */}
      <EnhancedLevelUpModal
        isOpen={levelUpOpen}
        character={character}
        newLevel={(character.level || 1) + 1}
        onConfirm={handleLevelUp}
        onCancel={() => setLevelUpOpen(false)}
      />

      {/* Class Features Dialog */}
      <ClassFeaturesDialog
        open={classFeaturesOpen}
        onOpenChange={setClassFeaturesOpen}
        character={character}
        race={race}
        subrace={subrace}
        charClass={charClass}
        subclass={subclass}
        background={background}
        selectedSkills={selectedSkills}
        raceChoiceSkills={raceChoiceSkills}
        subclassChoiceSkillsRaw={subclassChoiceSkillsRaw}
        skillsById={skillsById}
      />

      {/* Avatar Modal for DM - reusing the same UI as player view */}
      <AvatarModal
        open={avatarModalOpen}
        onOpenChange={setAvatarModalOpen}
        character={character}
        userId={character.user_id || currentUserId || ''}
        libraryUserId={currentUserId || ''}
        campaignAvatars={campaignAvatars}
        genLoading={genLoading}
        handleGenerateAvatar={handleGenerateAvatar}
        handleUploadAvatar={handleUploadAvatar}
        onAvatarUpdated={onRefetch}
      />

      {/* Floating Character Panel (Equipment/Features/Status) */}
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
              onRegenerateAvatar={handleRegenerateWithEquipment}
              avatarRegenerating={regenEquipLoading}
              onUseConsumable={async (item) => {
                const maxHp = calculateMaxHP(character);
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
          spellsContent={spellcastingInfo ? () => (
            <div className="h-full overflow-y-auto">
              <SpellsDialog
                open={true}
                onOpenChange={() => {}}
                isPreparedCaster={spellcastingInfo.isPreparedCaster}
                classId={character.class_id}
                cantripsLocal={spellcastingInfo.cantripsLocal}
                knownSpells={spellcastingInfo.knownSpells}
                preparedLocal={spellcastingInfo.preparedLocal}
                preparedCount={spellcastingInfo.preparedCount}
                preparedMax={spellcastingInfo.preparedMax}
                togglePreparedWithLimit={() => {}}
                setPreparedSpellsAndPersist={async (spells: string[]) => {
                  await persistCharacterPartial(undefined, spells, undefined);
                }}
                spellsAll={allSpells}
                racialSpellMeta={spellcastingInfo.racialSpellMeta}
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
                onCastSpell={handleCastSpell}
                canPrepareSpells={true}
                onPreparationFinished={() => {}}
                eldritchInvocations={
                  (character.eldritch_invocations || character.eldritchInvocations || [])
                    .map((i: any) => typeof i === 'string' ? i : i.value || i.id || '')
                }
                charismaMod={spellcastingInfo.spellcastingAbilityMod ?? 0}
                subclassId={character.subclass_id}
                equipment={equipment.equipmentLocal}
                isSilenced={isSilenced}
                hasSomaticFreedom={hasSomaticFreedom}
                concentratingSpellId={concentrationSpellId}
                concentratingSpellName={concentrationSpellName}
                isDM={true}
                onDMAddSpell={async (spellIds: string[]) => {
                  if (spellIds.length === 0) return;
                  const currentCantrips = character.selected_cantrips || [];
                  const currentSpells = character.selected_spells || [];
                  const currentCantripIds = currentCantrips.map((s: any) => typeof s === 'string' ? s : s.id);
                  const currentSpellIds = currentSpells.map((s: any) => typeof s === 'string' ? s : s.id);
                  const body: Record<string, any> = {};
                  if (campaignId) body.broadcast_campaign_id = campaignId;
                  const cantripIdsToAdd = spellIds.filter((id) => {
                    const spell = allSpells.find((s: Spell) => s.id === id);
                    return spell?.level === 0;
                  });
                  const spellIdsToAdd = spellIds.filter((id) => {
                    const spell = allSpells.find((s: Spell) => s.id === id);
                    return spell && spell.level > 0;
                  });
                  if (cantripIdsToAdd.length > 0) {
                    body.selected_cantrips = Array.from(new Set([...currentCantripIds, ...cantripIdsToAdd]));
                  }
                  if (spellIdsToAdd.length > 0) {
                    body.selected_spells = Array.from(new Set([...currentSpellIds, ...spellIdsToAdd]));
                  }
                  await apiFetch(`/api/characters/${character.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    userId: currentUserId,
                  });
                  onRefetch();
                }}
                campaignId={campaignId}
                embedded
              />
            </div>
          ) : undefined}
        />
      )}
    </CharacterProvider>
  );
}

// Player Floating Panel — lightweight wrapper for the player's own character
function PlayerFloatingPanel({ character, campaignId, currentUserId, currentMapUrl, floatingCharPanel, setFloatingCharPanel, onRefetch, statusContainerRef, statusContainerCallbackRef }: {
  character: any;
  campaignId?: string;
  currentUserId?: string;
  currentMapUrl?: string | null;
  floatingCharPanel: import('~/hooks/useSidebarState').FloatingCharPanelConfig;
  setFloatingCharPanel: (updates: Partial<import('~/hooks/useSidebarState').FloatingCharPanelConfig>) => void;
  onRefetch: () => void;
  statusContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  statusContainerCallbackRef: (el: HTMLDivElement | null) => void;
}) {
  const showToast = useCallback((msg: string) => {
    publishAppEvent("showToast", { message: msg });
  }, []);

  const persistCharacterPartial = useCallback(async (
    nextEquipment?: EquipmentItem[],
    nextPreparedSpells?: string[],
    nextCurrency?: Currency
  ) => {
    const payload: any = {};
    if (nextEquipment !== undefined) payload.equipment = nextEquipment;
    if (nextPreparedSpells !== undefined) payload.prepared_spells = nextPreparedSpells;
    if (nextCurrency !== undefined) payload.currency = nextCurrency;
    if (Object.keys(payload).length === 0) return false;
    if (campaignId) payload.broadcast_campaign_id = campaignId;
    try {
      const resp = await apiFetch(`/api/characters/${character.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), userId: currentUserId,
      });
      if (resp.ok) { onRefetch(); return true; }
      return false;
    } catch (_) { return false; }
  }, [character.id, currentUserId, onRefetch, campaignId]);

  const equipment = useEquipment({
    character, campaignId: campaignId || '', currentMapUrl: currentMapUrl || null,
    persistCharacterPartial, showToast,
  });
  const currency = useCurrency({ character, persistCharacterPartial });

  const { hasTokenOnMap } = useMapToken({
    character, campaignId: campaignId || '', currentMapUrl: currentMapUrl || null, userId: currentUserId,
  });

  // Spellcasting
  const allSpells = useMemo(() => (spellsData as any).spells || [], []);
  const preparedCasters = ['wizard', 'cleric', 'druid', 'paladin'];
  const isPreparedCaster = preparedCasters.includes(character.class_id);
  const preparedIds = useMemo(() => {
    const spells = isPreparedCaster ? (character.prepared_spells || []) : (character.selected_spells || []);
    return spells.map((s: any) => typeof s === 'string' ? s : s.id);
  }, [character, isPreparedCaster]);

  const spellcastingInfo = useMemo(() => {
    const classId = character.class_id;
    const abilityId = (spellcastingAbilityMap as Record<string, string>)[classId] as SpellcastingAbilityId | undefined;
    if (!abilityId) return null;
    const race = (racesData as any).races?.find((r: any) => r.id === character.race_id);
    const subrace = race?.subraces?.find((s: any) => s.id === character.subrace_id);
    const baseScores = character.ability_scores || {};
    const raceBonuses = race?.abilityScoreIncrease || {};
    const subBonuses = subrace?.abilityScoreIncrease || {};
    const finalScores: Record<string, number> = {};
    for (const ab of ['strength','dexterity','constitution','intelligence','wisdom','charisma']) {
      finalScores[ab] = (baseScores[ab] || 10) + (raceBonuses[ab] || 0) + (subBonuses[ab] || 0);
    }
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
      const pactEntry = pactCfg[String(character.level || 1)];
      if (pactEntry && typeof pactEntry.slots === 'number') {
        const slotLevel = pactEntry.level ?? 1;
        if (slotLevel >= 1 && slotLevel <= 9) spellSlots[slotLevel] = pactEntry.slots;
      }
    } else {
      const tableKey = spellcasterType === 'full' ? 'fullCaster' : 'halfCaster';
      const rawSlots: number[] = (config?.slotTables?.[tableKey] || {})[String(character.level || 1)] || [];
      spellSlots = [0, ...rawSlots];
      while (spellSlots.length < 10) spellSlots.push(0);
    }
    let preparedMax = 0;
    if (isPreparedCaster) {
      const abilityMods: Record<string, number> = {};
      for (const ab of ['strength','dexterity','constitution','intelligence','wisdom','charisma']) {
        abilityMods[ab] = Math.floor((finalScores[ab] - 10) / 2);
      }
      preparedMax = computePreparedMax(character, abilityMods);
    }
    const abilityLabels: Record<string, string> = { intelligence: '智力', wisdom: '感知', charisma: '魅力' };

    // Compute racial spells (cantrips + leveled)
    const racialSpells = getRacialSpells(character.race_id, character.subrace_id ?? null, character.level || 1, character.race_choices || (character as any).raceChoices);
    const racialCantripIds = racialSpells.filter(rs => rs.level === 0).map(rs => rs.id);
    const racialLeveledIds = racialSpells.filter(rs => rs.level > 0).map(rs => rs.id);

    return {
      isPreparedCaster,
      cantripsLocal: (() => {
        const base = (character.selected_cantrips || []).map((s: any) => typeof s === 'string' ? s : s.id);
        return Array.from(new Set([...base, ...racialCantripIds]));
      })(),
      knownSpells: (() => {
        let base: string[];
        if (isSpellbookCasterUtil(classId)) {
          base = (character.selected_spells || []).map((s: any) => typeof s === 'string' ? s : s.id);
        } else if (isPreparedCaster) {
          base = allSpells.filter((s: Spell) => s.level > 0 && s.level <= maxSpellLevelForClass(classId, character.level || 1) && s.classes?.includes(classId)).map((s: Spell) => s.id);
        } else {
          base = (character.selected_spells || []).map((s: any) => typeof s === 'string' ? s : s.id);
        }
        return Array.from(new Set([...base, ...racialLeveledIds]));
      })(),
      preparedLocal: Array.from(new Set([...preparedIds, ...racialLeveledIds])),
      preparedCount: preparedIds.length, preparedMax,
      spellcastingAbilityLabel: abilityLabels[abilityId] || abilityId,
      spellcastingAbilityScore: finalScores[abilityId],
      spellcastingAbilityMod: abilityMod,
      spellcastingAbilityId: abilityId,
      spellcasterType, spellSaveDC, spellAttackStr: `+${spellAttackMod}`,
      spellSlots, remainingSlots: character.spell_slots_state || spellSlots,
      autoPrepared: getAlwaysPreparedSubclassSpells(character),
      racialSpellMeta: Object.fromEntries(racialSpells.map(rs => [rs.id, { usesPerDay: rs.usesPerDay, traitName: rs.traitName, spellcastingAbility: rs.spellcastingAbility }])),
    };
  }, [character, preparedIds, isPreparedCaster]);

  const handleConsumeSlot = useCallback((level: number) => {
    if (!spellcastingInfo) return;
    const newSlots = [...spellcastingInfo.remainingSlots];
    if (newSlots[level] > 0) {
      newSlots[level]--;
      const payload: Record<string, unknown> = { spell_slots_state: newSlots };
      if (campaignId) payload.broadcast_campaign_id = campaignId;
      apiFetch(`/api/characters/${character.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), userId: currentUserId,
      }).then(() => onRefetch());
    }
  }, [spellcastingInfo, campaignId, character.id, currentUserId, onRefetch]);

  const handleCastSpell = useCallback(async (data: SpellCastData) => {
    await castSpellAction(data.spell, data.level, character.id, {
      campaignId, currentMapUrl, userId: currentUserId,
      spellSaveDC: spellcastingInfo?.spellSaveDC ?? undefined,
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
  }, [character.id, campaignId, currentMapUrl, currentUserId, spellcastingInfo?.spellSaveDC]);

  // Concentration tracking
  const [concentrationSpellId, setConcentrationSpellId] = useState<string | null>(null);
  const [concentrationSpellName, setConcentrationSpellName] = useState<string | null>(null);
  const [castingSpellName, setCastingSpellName] = useState<string | null>(null);
  useEffect(() => {
    if (!currentMapUrl || !campaignId) { setConcentrationSpellId(null); setConcentrationSpellName(null); setCastingSpellName(null); return; }
    findCharacterToken(character.id, campaignId, currentMapUrl, currentUserId)
      .then(result => {
        setConcentrationSpellId(result?.data?.concentration_spell?.spell_id || null);
        setConcentrationSpellName(result?.data?.concentration_spell?.spell_name || null);
        setCastingSpellName(result?.data?.casting_in_progress?.spell_name || null);
      }).catch(() => { setConcentrationSpellId(null); setConcentrationSpellName(null); setCastingSpellName(null); });
  }, [character.id, campaignId, currentMapUrl, currentUserId]);

  useEffect(() => {
    const handler = (detail: { characterId?: number | string; concentrationSpell?: { spell_id?: string; spell_name?: string } | null }) => {
      if (detail?.characterId === character.id) {
        setConcentrationSpellId(detail.concentrationSpell?.spell_id || null);
        setConcentrationSpellName(detail.concentrationSpell?.spell_name || null);
      }
    };
    return subscribeAppEvent('characterConcentrationChanged', handler);
  }, [character.id]);

  useEffect(() => {
    const handler = (detail: { characterId?: number | string; castingInProgress?: { spell_name?: string } | null }) => {
      if (detail?.characterId === character.id) {
        setCastingSpellName(detail.castingInProgress?.spell_name || null);
      }
    };
    return subscribeAppEvent('characterCastingChanged', handler);
  }, [character.id]);

  // Somatic / silenced
  const featIds = useMemo(() => (character.feats || []).map((f: any) => typeof f === 'string' ? f : f.id || ''), [character.feats]);
  const hasSomaticFreedom = useMemo(() => getFeatRuleOverrides(featIds).has('somatic_with_hands_full'), [featIds]);
  const isSilenced = useMemo(() => {
    const raw = (character as any).status_effects || [];
    return Array.isArray(raw) ? raw.some((e: any) => (e.condition || e.id || e) === 'silenced') : false;
  }, [(character as any).status_effects]);

  // Class features data
  const cfRace = useMemo(() => racesData.races.find((r: any) => r.id === character.race_id), [character.race_id]);
  const cfSubrace = useMemo(() => cfRace?.subraces?.find((s: any) => s.id === character.subrace_id), [cfRace, character.subrace_id]);
  const charClass = useMemo(() => classesData.classes.find((c: any) => c.id === character.class_id), [character.class_id]);
  const subclass = useMemo(() => charClass?.subclasses?.find((s: any) => s.id === character.subclass_id), [charClass, character.subclass_id]);
  const background = useMemo(() => (backgroundsData as any).backgrounds?.find((b: any) => b.id === character.background_id), [character.background_id]);
  const skillsById = useMemo(() => {
    const map = new Map<string, string>();
    ((skillsData as any).skills || []).forEach((s: any) => map.set(s.id, s.name));
    return map;
  }, []);
  const selectedSkills = useMemo(() => extractValues<string>(character.selected_skills), [character.selected_skills]);
  const raceChoiceSkills = useMemo(() => (character.race_choices || {}).skill_proficiencies || [], [character.race_choices]);
  const subclassChoiceSkillsRaw = useMemo(() => (character.subclass_choices || {}).skill_proficiencies || [], [character.subclass_choices]);

  if (floatingCharPanel.stage === 'closed') return null;

  return (
    <CharacterProvider character={character} campaignId={campaignId || ''} currentMapUrl={null} userId={character.user_id} isDM={false} showToast={showToast} persistCharacterPartial={persistCharacterPartial}>
      <FloatingCharacterPanel
        config={floatingCharPanel}
        setConfig={setFloatingCharPanel}
        characterName={character.name}
        equipmentContent={() =>
          <BagDialog
            open={true} onOpenChange={() => {}}
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
              const maxHp = calculateMaxHP(character);
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
            open={true} onOpenChange={() => {}}
            character={character} race={cfRace} subrace={cfSubrace}
            charClass={charClass} subclass={subclass} background={background}
            selectedSkills={selectedSkills} raceChoiceSkills={raceChoiceSkills}
            subclassChoiceSkillsRaw={subclassChoiceSkillsRaw} skillsById={skillsById}
            embedded
          />
        }
        statusContent={() =>
          <div ref={statusContainerCallbackRef} className="h-full" />
        }
        spellsContent={spellcastingInfo ? () => (
          <div className="h-full overflow-y-auto">
            <SpellsDialog
              open={true} onOpenChange={() => {}}
              isPreparedCaster={spellcastingInfo.isPreparedCaster}
              classId={character.class_id}
              cantripsLocal={spellcastingInfo.cantripsLocal}
              knownSpells={spellcastingInfo.knownSpells}
              preparedLocal={spellcastingInfo.preparedLocal}
              preparedCount={spellcastingInfo.preparedCount}
              preparedMax={spellcastingInfo.preparedMax}
              togglePreparedWithLimit={() => {}}
              setPreparedSpellsAndPersist={async (spells: string[]) => {
                await persistCharacterPartial(undefined, spells, undefined);
              }}
              spellsAll={allSpells}
              racialSpellMeta={spellcastingInfo.racialSpellMeta}
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
              onCastSpell={handleCastSpell}
              canPrepareSpells={true}
              onPreparationFinished={() => {}}
              eldritchInvocations={
                (character.eldritch_invocations || []).map((i: any) => typeof i === 'string' ? i : i.value || i.id || '')
              }
              charismaMod={spellcastingInfo.spellcastingAbilityMod ?? 0}
              subclassId={character.subclass_id}
              equipment={equipment.equipmentLocal}
              isSilenced={isSilenced}
              hasSomaticFreedom={hasSomaticFreedom}
              concentratingSpellId={concentrationSpellId}
              concentratingSpellName={concentrationSpellName}
              campaignId={campaignId}
              embedded
            />
          </div>
        ) : undefined}
      />
    </CharacterProvider>
  );
}

export function CharacterPanel({ isDM, campaignId, currentUserId, currentMapUrl, globalTerrain, timeOfDay, onSelectedCharacterChange, initialSelectedCharacterId, onSelectedCharacterIdPersist, getSpellExpandedLevels, toggleSpellExpandedLevel, floatingCharPanel, setFloatingCharPanel }: CharacterPanelProps) {
  const queryClient = useQueryClient();
  const authedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    apiFetch(input, { ...init, userId: currentUserId });

  const applySpellSlotStateToCaches = useCallback((characterId: number, spellSlotsState: any) => {
    if (!characterId) return;

    queryClient.setQueryData(characterQueryKeys.detail(characterId), (prev: any) => {
      if (!prev) return prev;
      return { ...prev, spell_slots_state: spellSlotsState };
    });

    if (campaignId) {
      queryClient.setQueryData(
        campaignQueryKeys.roster(campaignId, currentUserId),
        (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((item: any) => {
            if (item?.character?.id !== characterId) return item;
            return {
              ...item,
              character: {
                ...item.character,
                spell_slots_state: spellSlotsState,
              },
            };
          });
        },
      );
    }
  }, [campaignId, currentUserId, queryClient]);

  const consumeSpellSlotInCaches = useCallback((characterId: number, level: number) => {
    if (!characterId || level <= 0) return;

    queryClient.setQueryData(characterQueryKeys.detail(characterId), (prev: any) => {
      if (!prev) return prev;
      const nextSpellSlotsState = consumeSpellSlotsState(
        prev.spell_slots_state,
        level,
        getMaxSpellSlots(prev),
      );
      if (nextSpellSlotsState === prev.spell_slots_state) return prev;
      return { ...prev, spell_slots_state: nextSpellSlotsState };
    });

    if (campaignId) {
      queryClient.setQueryData(
        campaignQueryKeys.roster(campaignId, currentUserId),
        (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          let changed = false;
          const next = prev.map((item: any) => {
            if (item?.character?.id !== characterId) return item;
            const nextSpellSlotsState = consumeSpellSlotsState(
              item.character?.spell_slots_state,
              level,
              getMaxSpellSlots(item.character),
            );
            if (nextSpellSlotsState === item.character?.spell_slots_state) return item;
            changed = true;
            return {
              ...item,
              character: {
                ...item.character,
                spell_slots_state: nextSpellSlotsState,
              },
            };
          });
          return changed ? next : prev;
        },
      );
    }
  }, [campaignId, currentUserId, queryClient]);

  // Selected character for DM view (shows ClassicCharacterCard on left)
  const [selectedCharacterId, setSelectedCharacterIdInternal] = useState<number | null>(initialSelectedCharacterId ?? null);
  // Track whether persisted value has been applied (to prevent auto-select override)
  const persistedAppliedRef = useRef(!!initialSelectedCharacterId);

  // Sync when initialSelectedCharacterId changes (from parent/map token selection)
  useEffect(() => {
    if (initialSelectedCharacterId != null && initialSelectedCharacterId !== selectedCharacterId) {
      setSelectedCharacterIdInternal(initialSelectedCharacterId);
      persistedAppliedRef.current = true;
    }
  }, [initialSelectedCharacterId]);

  // Wrap setter to also persist to sidebar state
  const setSelectedCharacterId = useCallback((id: number | null) => {
    setSelectedCharacterIdInternal(id);
    persistedAppliedRef.current = true;
    onSelectedCharacterIdPersist?.(id);
  }, [onSelectedCharacterIdPersist]);

  // 折叠状态管理 - 默认全部折叠 (for non-DM view)
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // Player floating panel: status tab portal container
  const playerStatusContainerRef = useRef<HTMLDivElement | null>(null);
  const [playerStatusContainer, setPlayerStatusContainer] = useState<HTMLDivElement | null>(null);
  const playerStatusContainerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    playerStatusContainerRef.current = el;
    setPlayerStatusContainer(el);
  }, []);

  const toggleCard = useCallback((userId: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  // Helper: Get XP info
  const getXPInfo = (character: any) => {
    const currentLevel = character?.level || 1;
    const currentXP = character?.experience_points || 0;
    const levels = (xpThresholds as any).levels;
    const currentLevelXP = levels[currentLevel.toString()] || 0;
    const nextLevelXP = currentLevel < 20 ? (levels[(currentLevel + 1).toString()] || 0) : currentLevelXP;
    return { currentXP, currentLevelXP, nextLevelXP };
  };

  // Helper: Get deity name
  const getDeityName = (deityId?: string) => {
    if (!deityId) return null;
    const pantheons = (godsData as any).pantheons || [];
    for (const pantheon of pantheons) {
      const deity = (pantheon.deities || []).find((d: any) => d.id === deityId);
      if (deity) return deity.name;
    }
    return null;
  };

  // 使用 React Query 加载角色列表
  const {
    data: roster = [],
    isLoading: loading,
    error: queryError,
    refetch,
  } = useCampaignRosterQuery(campaignId, currentUserId);

  const error = queryError ? (queryError as Error).message : null;

  const [viewing, setViewing] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownData, setBreakdownData] = useState<StatBreakdownData | null>(null);

  // DM AI Generate High-Level Character states
  const [dmAiDialogOpen, setDmAiDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [dmAiDescription, setDmAiDescription] = useState("");
  const [dmAiTargetLevel, setDmAiTargetLevel] = useState(5);
  const [dmAiGenerating, setDmAiGenerating] = useState(false);
  const [dmAiTargetUserId, setDmAiTargetUserId] = useState<string>(""); // Target player to assign character
  const [dmAiProgress, setDmAiProgress] = useState<{ stage: number; stageName: string; detail: string } | null>(null);

  // Virtual player dialog states
  const [vpDialogOpen, setVpDialogOpen] = useState(false);
  const [kickConfirm, setKickConfirm] = useState<{ userId: string; name: string } | null>(null);
  const [vpName, setVpName] = useState("");
  const [vpCreating, setVpCreating] = useState(false);
  const [vpShowAiFields, setVpShowAiFields] = useState(false);
  const [vpAiDescription, setVpAiDescription] = useState("");
  const [vpAiLevel, setVpAiLevel] = useState(5);
  const [vpAiProgress, setVpAiProgress] = useState<{ stage: number; stageName: string; detail: string } | null>(null);
  const [vpManualWizardOpen, setVpManualWizardOpen] = useState(false);
  const [vpPendingUserId, setVpPendingUserId] = useState<string | null>(null);
  const [vpPendingMemberId, setVpPendingMemberId] = useState<number | null>(null);
  const [vpLibrary, setVpLibrary] = useState<any[]>([]);
  const [vpLibraryLoading, setVpLibraryLoading] = useState(false);
  const [vpSelectedLibraryChar, setVpSelectedLibraryChar] = useState<number | null>(null);

  // Dialog states for alignment and deity
  const [alignmentInfoOpen, setAlignmentInfoOpen] = useState(false);
  const [alignmentInfoTarget, setAlignmentInfoTarget] = useState<string | undefined>(undefined);
  const [deityInfoOpen, setDeityInfoOpen] = useState(false);
  const [deityInfoTarget, setDeityInfoTarget] = useState<string | undefined>(undefined);

  // Wild Shape state - maps character_id to wild shape data
  const [wildShapeByCharacter, setWildShapeByCharacter] = useState<Record<number, any>>({});

  // Temporary HP state - maps character_id to temp_hp value
  const [tempHpByCharacter, setTempHpByCharacter] = useState<Record<number, number | null>>({});

  // Listen for reward updates to refresh character roster
  useEffect(() => {
    const handler = (_detail: any) => {
      logger.debug("[CharacterPanel] Reward update received, refreshing roster");
      clearCharacterCache();
      refetch();
    };
    return subscribeAppEvent("rewardUpdate", handler);
  }, [refetch]);

  // Listen for character level up events to refresh character roster
  useEffect(() => {
    const handler = (data: any) => {
      logger.debug(`[CharacterPanel] Character level up received: ${data.character_name} -> Level ${data.level}`);
      if (data.character_id) invalidateCharacterCache(data.character_id);
      refetch();
    };
    return subscribeAppEvent("characterLevelUp", handler);
  }, [refetch]);

  // Listen for player character selection changes to refresh roster
  useEffect(() => {
    const handler = (detail: any) => {
      logger.debug("[CharacterPanel] Player changed character, invalidating cache and refreshing roster", detail);
      // Use invalidateQueries instead of refetch to force cache clear
      queryClient.invalidateQueries({ queryKey: ['campaign-roster', campaignId] });
    };
    return subscribeAppEvent("characterSelected", handler);
  }, [queryClient, campaignId]);

  // Listen for character equipment updates (e.g., when picking up items)
  useEffect(() => {
    const handler = (detail: { characterId?: number | string; character_id?: number | string }) => {
      const charId = detail?.characterId ?? detail?.character_id;
      const normalizedCharId = typeof charId === "number"
        ? charId
        : typeof charId === "string" && charId.trim() !== ""
          ? Number(charId)
          : undefined;
      logger.debug("[CharacterPanel] Character equipment updated, refreshing roster", detail);
      if (normalizedCharId !== undefined && Number.isFinite(normalizedCharId)) {
        const numericCharId = normalizedCharId;
        invalidateCharacterCache(numericCharId);
      }
      else clearCharacterCache();
      refetch();
    };
    return subscribeAppEvent('characterEquipmentUpdated', handler);
  }, [refetch]);

  // Listen for rest grant events to refresh character roster (spell slots, HP, resources)
  useEffect(() => {
    const handler = () => {
      logger.debug("[CharacterPanel] Rest grant received, refreshing roster");
      clearCharacterCache();
      refetch();
    };
    return subscribeAppEvent('restGrant', handler);
  }, [refetch]);

  useEffect(() => {
    const handler = (detail: { characterId?: number | string; remaining?: number[] }) => {
      const rawCharacterId = detail?.characterId;
      const characterId = typeof rawCharacterId === "number"
        ? rawCharacterId
        : typeof rawCharacterId === "string" && rawCharacterId.trim() !== ""
          ? Number(rawCharacterId)
          : NaN;
      if (!Number.isFinite(characterId) || !Array.isArray(detail?.remaining)) {
        return;
      }

      applySpellSlotStateToCaches(characterId, detail.remaining);
    };

    return subscribeAppEvent("spellSlotsChanged", handler);
  }, [applySpellSlotStateToCaches]);

  useEffect(() => {
    const handler = (detail: { characterId?: number | string; level?: number }) => {
      const rawCharacterId = detail?.characterId;
      const characterId = typeof rawCharacterId === "number"
        ? rawCharacterId
        : typeof rawCharacterId === "string" && rawCharacterId.trim() !== ""
          ? Number(rawCharacterId)
          : NaN;
      const level = typeof detail?.level === "number" ? detail.level : Number(detail?.level);
      if (!Number.isFinite(characterId) || !Number.isFinite(level) || level <= 0) {
        return;
      }

      consumeSpellSlotInCaches(characterId, level);
    };

    return subscribeAppEvent("consumeSpellSlot", handler);
  }, [consumeSpellSlotInCaches]);

  useEffect(() => {
    const handler = (detail: { character_id?: number | string; spell_slots_state?: any }) => {
      const rawCharacterId = detail?.character_id;
      const characterId = typeof rawCharacterId === "number"
        ? rawCharacterId
        : typeof rawCharacterId === "string" && rawCharacterId.trim() !== ""
          ? Number(rawCharacterId)
          : NaN;
      if (!Number.isFinite(characterId)) {
        return;
      }

      applySpellSlotStateToCaches(characterId, detail?.spell_slots_state);
      invalidateCharacterCache(characterId);
    };

    return subscribeAppEvent("spellSlotsUpdate", handler);
  }, [applySpellSlotStateToCaches]);

  // Listen for character avatar/general updates
  useEffect(() => {
    const handler = (detail: { character_id?: number | string; data?: { character_id?: number | string } }) => {
      const charId = detail?.character_id ?? detail?.data?.character_id;
      logger.debug("[CharacterPanel] Character updated (avatar/status), refreshing roster", { charId });
      // Invalidate in-memory cache so refetch gets fresh data from API
      if (typeof charId === "number") invalidateCharacterCache(charId);
      else if (typeof charId === "string" && charId.trim() !== "" && Number.isFinite(Number(charId))) invalidateCharacterCache(Number(charId));
      refetch();
    };
    return subscribeAppEvent('characterUpdated', handler);
  }, [refetch]);

  // Listen for wild shape updates (Druid transformation)
  useEffect(() => {
    const handler = ({
      characterId,
      wildShapeData,
    }: {
      characterId?: number | string;
      wildShapeData?: any;
    }) => {
      // Only treat full_replace (wild shape/polymorph) as wild shape, not modifier (enlarge/reduce)
      if (wildShapeData?.type === 'modifier') return;
      logger.debug("[CharacterPanel] Wild shape update received:", { characterId, beastName: wildShapeData?.beast_name });
      if (characterId) {
        setWildShapeByCharacter(prev => ({
          ...prev,
          [characterId]: wildShapeData || null
        }));
      }
    };
    return subscribeAppEvent("transformationUpdate", handler);
  }, []);

  // Listen for HP updates (includes temp_hp changes)
  useEffect(() => {
    const handler = ({
      characterId,
      temp_hp,
    }: {
      characterId?: number | string;
      temp_hp?: number | null;
    }) => {
      if (characterId && temp_hp !== undefined) {
        setTempHpByCharacter(prev => ({
          ...prev,
          [characterId]: temp_hp ?? null
        }));
      }
    };
    return subscribeAppEvent("characterHPUpdated", handler);
  }, []);

  // Fetch initial wild shape data from tokens when map URL changes
  useEffect(() => {
    if (!campaignId || !currentMapUrl) return;

    const fetchWildShapeData = async () => {
      try {
        const data = await fetchCampaignMapTokensCached(campaignId, currentMapUrl, { userId: currentUserId });
        const tokens = data.tokens || data;

        // Extract wild shape data and temp_hp from tokens
        const wildShapeMap: Record<number, any> = {};
        const tempHpMap: Record<number, number | null> = {};
        for (const token of tokens) {
          if (token.character_id && token.transformation_data && token.transformation_data.type !== 'modifier') {
            wildShapeMap[token.character_id] = token.transformation_data;
          }
          if (token.character_id && token.temp_hp) {
            tempHpMap[token.character_id] = token.temp_hp;
          }
        }

        if (Object.keys(wildShapeMap).length > 0) {
          logger.debug("[CharacterPanel] Loaded initial wild shape data:", wildShapeMap);
          setWildShapeByCharacter(wildShapeMap);
        }
        setTempHpByCharacter(tempHpMap);
      } catch (err) {
        logger.error("[CharacterPanel] Failed to fetch wild shape data:", err);
      }
    };

    fetchWildShapeData();
  }, [campaignId, currentMapUrl, currentUserId]); // Remove authedFetch, use stable deps

  // Listen for DM AI character generation progress updates via WebSocket
  useEffect(() => {
    const handler = (data: any) => {
      if (data?.type === 'dm_generate_progress') {
        setDmAiProgress({
          stage: data.stage,
          stageName: data.stage_name,
          detail: data.detail || ''
        });
      }
    };
    return subscribeAppEvent("dmGenerateProgress", handler);
  }, []);

  const saveEdit = async () => {
    if (!editing) return;
    try {
      const payload = { ...editForm };
      // ensure required fields
      payload.user_id = editing.user_id;
      const resp = await authedFetch(`/api/characters/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const t = await resp.text();
        alert(`保存失败: ${t}`);
        return;
      }
      setEditing(null);
      await refetch();
    } catch (e) {
      logger.error("保存失败", e);
      alert("保存失败，请查看控制台");
    }
  };

  const kickMember = async (userId: string, characterName?: string) => {
    if (!isDM || !campaignId || !currentUserId) return;
    setKickConfirm({ userId, name: characterName || userId });
  };

  const confirmKick = async () => {
    if (!kickConfirm || !campaignId || !currentUserId) return;
    const { userId, name } = kickConfirm;
    try {
      const resp = await authedFetch(getApiEndpoint(`/api/campaigns/${campaignId}/members/${userId}`), {
        method: "DELETE",
      });

      if (!resp.ok) {
        const text = await resp.text();
        alert(`踢出失败: ${text}`);
        return;
      }

      // 踢出成功后，通知地图删除该角色的 Token
      const kicked = roster.find(m => m.user_id === userId);
      if (kicked?.character?.id) {
        publishAppEvent("removeCharacterTokens", { characterId: kicked.character.id });
      }

      await refetch();
    } catch (e) {
      logger.error("踢出失败", e);
      alert("踢出失败，请查看控制台");
    } finally {
      setKickConfirm(null);
    }
  };

  // Fetch virtual character library
  const fetchVpLibrary = async () => {
    if (!currentUserId) return;
    setVpLibraryLoading(true);
    try {
      const resp = await authedFetch(getApiEndpoint(`/api/campaigns/virtual-library/characters`));
      if (resp.ok) {
        setVpLibrary(await resp.json());
      }
    } catch (e) {
      logger.error("加载角色库失败", e);
    } finally {
      setVpLibraryLoading(false);
    }
  };

  // Create virtual player (shared first step: create the member)
  const createVpMember = async (displayName: string): Promise<{ userId: string; memberId: number } | null> => {
    if (!campaignId || !currentUserId) return null;
    const url = new URL(getApiEndpoint(`/api/campaigns/${campaignId}/virtual-players`), window.location.origin);
    const resp = await authedFetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: displayName }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      alert(`创建虚拟玩家失败: ${text}`);
      return null;
    }
    const member = await resp.json();
    return { userId: member.user_id as string, memberId: member.id as number };
  };

  // Create virtual player with AI generated character
  const handleCreateVirtualPlayer = async () => {
    if (!campaignId || !currentUserId) return;

    // Library import mode — uses a different API endpoint (no need to create member separately)
    if (vpSelectedLibraryChar) {
      if (!vpName.trim()) { alert("请输入玩家名称"); return; }
      setVpCreating(true);
      try {
        const url = new URL(getApiEndpoint(`/api/campaigns/${campaignId}/virtual-players/import`), window.location.origin);
        const resp = await authedFetch(url.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_character_id: vpSelectedLibraryChar, display_name: vpName.trim() }),
        });
        if (!resp.ok) {
          const text = await resp.text();
          alert(`导入失败: ${text}`);
          return;
        }
        setVpDialogOpen(false);
        setVpName("");
        setVpSelectedLibraryChar(null);
        await refetch();
      } catch (e) {
        logger.error("导入虚拟角色失败", e);
        alert("导入失败");
      } finally {
        setVpCreating(false);
      }
      return;
    }

    // AI generation mode
    setVpCreating(true);
    setVpAiProgress(null);
    let vpMemberToCleanup: { userId: string; memberId: number } | null = null;
    try {
      // Step 1: Create virtual player member with placeholder name
      const result = await createVpMember(vpName.trim() || "虚拟玩家");
      if (!result) return;
      vpMemberToCleanup = result;

      // Step 2: AI generate character
      const desc = vpAiDescription.trim() || vpName.trim() || "随机生成一个角色";
      const resp = await apiFetch("/api/characters/dm-generate-high-level", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: result.userId,
          description: desc,
          target_level: vpAiLevel,
          campaign_id: campaignId,
        }),
        userId: currentUserId,
      });
      if (!resp.ok) {
        const text = await resp.text();
        alert(`AI生成角色失败: ${text}`);
        await refetch();
        return;
      }
      const newChar = await resp.json();

      // Step 3: Auto-assign character
      try {
        await authedFetch(getApiEndpoint(`/api/campaigns/${campaignId}/members/${result.userId}/selected-character`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ character_id: newChar.id }),
        });
      } catch (assignErr) {
        logger.warn("[VP] Auto-assign failed", assignErr);
      }

      // Step 4: Update VP display name to character name (if user didn't provide one)
      if (!vpName.trim() && newChar.name) {
        try {
          const updateUrl = new URL(getApiEndpoint(`/api/campaigns/${campaignId}/virtual-players/${result.memberId}`), window.location.origin);
          await authedFetch(updateUrl.toString(), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ display_name: newChar.name }),
          });
        } catch (_) {}
      }

      vpMemberToCleanup = null; // Character created successfully, no cleanup needed
      setVpDialogOpen(false);
      setVpName("");
      setVpAiDescription("");
      setVpAiLevel(5);
      setVpAiProgress(null);
      await refetch();
      if (newChar.id) setSelectedCharacterId(newChar.id);
    } catch (e) {
      logger.error("创建虚拟玩家失败", e);
      alert("创建虚拟玩家失败");
    } finally {
      // Clean up orphan virtual player member if character was never created
      if (vpMemberToCleanup) {
        try {
          const delUrl = new URL(getApiEndpoint(`/api/campaigns/${campaignId}/virtual-players/${vpMemberToCleanup.memberId}`), window.location.origin);
          await authedFetch(delUrl.toString(), { method: "DELETE" });
          logger.info("[VP] Cleaned up orphan member", vpMemberToCleanup.memberId);
        } catch (cleanupErr) {
          logger.warn("[VP] Failed to clean up orphan member", cleanupErr);
        }
      }
      setVpCreating(false);
      setVpAiProgress(null);
    }
  };

  // Handle manual character creation completed for virtual player
  const handleVpManualCharCreated = async (character: any): Promise<boolean> => {
    if (!vpPendingUserId || !campaignId) return false;
    try {
      const resp = await apiFetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: vpPendingUserId, ...character }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert(err.detail || "保存角色失败");
        return false;
      }
      const newChar = await resp.json();
      // Auto-assign
      try {
        await authedFetch(getApiEndpoint(`/api/campaigns/${campaignId}/members/${vpPendingUserId}/selected-character`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ character_id: newChar.id }),
        });
      } catch (_) {}
      // Update VP display name to character name
      if (vpPendingMemberId && newChar.name) {
        try {
          const updateUrl = new URL(getApiEndpoint(`/api/campaigns/${campaignId}/virtual-players/${vpPendingMemberId}`), window.location.origin);
          await authedFetch(updateUrl.toString(), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ display_name: newChar.name }),
          });
        } catch (_) {}
      }
      setVpManualWizardOpen(false);
      setVpPendingUserId(null);
      setVpPendingMemberId(null);
      setVpName("");
      await refetch();
      if (newChar.id) setSelectedCharacterId(newChar.id);
      return true;
    } catch (e) {
      logger.error("手动创建角色失败", e);
      alert("创建失败");
      return false;
    }
  };

  // Handle imported character creation
  const handleImportCharCreated = async (character: any): Promise<boolean> => {
    if (!currentUserId) return false;
    try {
      const resp = await apiFetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: currentUserId, ...character }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert(err.detail || "导入角色失败");
        return false;
      }
      setImportDialogOpen(false);
      await refetch();
      return true;
    } catch (e) {
      logger.error("导入角色失败", e);
      alert("导入角色失败");
      return false;
    }
  };

  // Delete virtual player
  const deleteVirtualPlayer = async (memberId: number, displayName?: string) => {
    if (!campaignId || !currentUserId) return;
    if (!confirm(`确定要删除虚拟玩家 ${displayName || "未命名"} 吗？关联的角色也会被删除。`)) return;
    try {
      const url = new URL(getApiEndpoint(`/api/campaigns/${campaignId}/virtual-players/${memberId}`), window.location.origin);
      const resp = await authedFetch(url.toString(), { method: "DELETE" });
      if (!resp.ok) {
        const text = await resp.text();
        alert(`删除失败: ${text}`);
        return;
      }
      setSelectedCharacterId(null);
      await refetch();
    } catch (e) {
      logger.error("删除虚拟玩家失败", e);
      alert("删除虚拟玩家失败");
    }
  };

  // DM AI Generate High-Level Character
  const handleDmAiGenerate = async () => {
    if (!dmAiDescription.trim() || !dmAiTargetUserId) return;
    setDmAiGenerating(true);
    setDmAiProgress(null);
    try {
      const resp = await apiFetch("/api/characters/dm-generate-high-level", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: dmAiTargetUserId,
          description: dmAiDescription.trim(),
          target_level: dmAiTargetLevel,
          campaign_id: campaignId, // For progress broadcast
        }),
        userId: currentUserId,
      });
      if (!resp.ok) {
        const text = await resp.text();
        alert(`生成失败: ${text}`);
        return;
      }
      const newChar = await resp.json();
      logger.info(`[DM AI Gen] Created character: ${newChar.name}, Level ${newChar.level}`);

      // Auto-assign character to the target player (especially useful for virtual players)
      if (newChar.id && dmAiTargetUserId) {
        try {
          await authedFetch(getApiEndpoint(`/api/campaigns/${campaignId}/members/${dmAiTargetUserId}/selected-character`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ character_id: newChar.id }),
          });
          logger.info(`[DM AI Gen] Auto-assigned character ${newChar.id} to ${dmAiTargetUserId}`);
        } catch (assignErr) {
          logger.warn("[DM AI Gen] Auto-assign failed, user can manually select", assignErr);
        }
      }

      setDmAiDialogOpen(false);
      setDmAiDescription("");
      setDmAiTargetLevel(5);
      setDmAiTargetUserId("");
      setDmAiProgress(null);
      await refetch();
      // Auto-select the new character in DM view
      if (newChar.id) setSelectedCharacterId(newChar.id);
      alert(`成功生成角色: ${newChar.name} (${newChar.level}级)`);
    } catch (e) {
      logger.error("DM AI生成失败", e);
      alert("生成失败，请查看控制台");
    } finally {
      setDmAiGenerating(false);
      setDmAiProgress(null);
    }
  };

  const races = (racesData as any).races;
  const classes = (classesData as any).classes;

  const labelFor = (char: any) => {
    if (!char) return "未选择角色";
    const race = races.find((r: any) => r.id === char.race_id);
    const klass = classes.find((c: any) => c.id === char.class_id);
    return `${char.name}（${race?.name || char.race_id} ${klass?.name || char.class_id} ${char.level}级）`;
  };

  // Get selected character for DM view
  const selectedCharacter = useMemo(() => {
    if (!selectedCharacterId) return null;
    return roster.find(item => item.character?.id === selectedCharacterId)?.character || null;
  }, [roster, selectedCharacterId]);

  // Collect all campaign character avatars for the avatar library
  const campaignAvatars = useMemo(() => {
    return roster
      .map(item => item.character?.avatar)
      .filter((av): av is string => !!av);
  }, [roster]);

  // Auto-select first character if none selected and roster loaded
  // Skip if persisted value is pending (not yet loaded from backend)
  useEffect(() => {
    if (isDM && roster.length > 0 && !selectedCharacterId && persistedAppliedRef.current) {
      const firstWithChar = roster.find(item => item.character);
      if (firstWithChar?.character) {
        setSelectedCharacterId(firstWithChar.character.id);
      }
    }
  }, [isDM, roster, selectedCharacterId]);

  // Notify parent of selected character changes
  useEffect(() => {
    onSelectedCharacterChange?.(selectedCharacterId, selectedCharacter);
  }, [selectedCharacterId, selectedCharacter, onSelectedCharacterChange]);

  // Map token selection is handled by RightSidebar (always mounted) via onSelectedCharacterIdPersist
  // CharacterPanel syncs via initialSelectedCharacterId prop

  // DM View: Two-column layout with avatars on right, card on left
  if (isDM) {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="fantasy-section-header !mb-3 flex-shrink-0">
          <h3>角色列表</h3>
          <div className="flex gap-2 ml-auto">
            {campaignId && (
              <button className="fantasy-btn text-xs" onClick={() => refetch()}>
                <span>🔄</span>
                <span>刷新</span>
              </button>
            )}
          </div>
        </div>

        {/* DM AI Generate High-Level Character Dialog */}
        <Dialog.Root open={dmAiDialogOpen} onOpenChange={setDmAiDialogOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
            <Dialog.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 border border-amber-500/30 rounded-lg p-6 w-[90vw] max-w-md z-50 shadow-xl">
              <Dialog.Title className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
                <span>✨</span> AI生成高等级角色
              </Dialog.Title>
              <Dialog.Description className="text-sm text-gray-400 mb-4">
                输入角色描述，AI将自动选择种族、职业、技能并生成完整角色。适合调试使用。
              </Dialog.Description>

              <div className="space-y-4">
                {/* Player Selector */}
                <div>
                  <label className="block text-sm text-gray-300 mb-1">分配给玩家</label>
                  <select
                    value={dmAiTargetUserId}
                    onChange={(e) => setDmAiTargetUserId(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:border-amber-500 focus:outline-none"
                  >
                    <option value="">-- 选择玩家 --</option>
                    {roster.map((item) => (
                      <option key={item.user_id} value={item.user_id}>
                        {item.is_virtual ? `[虚拟] ${item.display_name || item.user_id}` : (item.character?.name || item.user_id)} ({item.user_id})
                      </option>
                    ))}
                    {/* Also allow assigning to DM (current user) */}
                    {currentUserId && !roster.find(r => r.user_id === currentUserId) && (
                      <option value={currentUserId}>DM ({currentUserId})</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">目标等级</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={dmAiTargetLevel}
                    onChange={(e) => setDmAiTargetLevel(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">角色描述</label>
                  <textarea
                    value={dmAiDescription}
                    onChange={(e) => setDmAiDescription(e.target.value)}
                    placeholder="例如：一个狡猾的半精灵盗贼，擅长潜行和开锁，曾是城市黑帮的成员..."
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:border-amber-500 focus:outline-none resize-none h-32"
                  />
                </div>

                {/* Progress Display */}
                {dmAiGenerating && dmAiProgress && (
                  <div className="bg-gray-800/50 border border-purple-500/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-amber-400">阶段 {dmAiProgress.stage}/6</span>
                      <span className="text-sm text-gray-400">{dmAiProgress.stageName}</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
                      <div
                        className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(dmAiProgress.stage / 6) * 100}%` }}
                      />
                    </div>
                    {dmAiProgress.detail && (
                      <p className="text-xs text-gray-500">{dmAiProgress.detail}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <Dialog.Close asChild>
                  <button className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors" disabled={dmAiGenerating}>
                    取消
                  </button>
                </Dialog.Close>
                <button
                  onClick={handleDmAiGenerate}
                  disabled={dmAiGenerating || !dmAiDescription.trim() || !dmAiTargetUserId}
                  className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-500 text-black rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {dmAiGenerating ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      <span>{dmAiProgress ? `阶段 ${dmAiProgress.stage}/6...` : '生成中...'}</span>
                    </>
                  ) : (
                    <>
                      <span>✨</span>
                      <span>生成角色</span>
                    </>
                  )}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* Virtual Player Dialog - Combined name + character creation */}
        <Dialog.Root open={vpDialogOpen} onOpenChange={(open) => { if (!vpCreating) { setVpDialogOpen(open); if (open) { setVpSelectedLibraryChar(null); setVpName(""); setVpShowAiFields(false); fetchVpLibrary(); } } }}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
            <Dialog.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 border border-purple-500/30 rounded-lg p-6 w-[90vw] max-w-md z-50 shadow-xl">
              <Dialog.Title className="text-lg font-bold text-purple-400 mb-4">
                添加虚拟玩家
              </Dialog.Title>
              <Dialog.Description className="text-sm text-gray-400 mb-4">
                创建DM控制的虚拟玩家，可从角色库导入或新建。
              </Dialog.Description>
              <div className="space-y-4">
                {/* Character source dropdown - shown immediately */}
                <div>
                  <label className="block text-sm text-gray-300 mb-1">角色来源</label>
                  {vpLibraryLoading ? (
                    <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-500 text-sm">加载角色库...</div>
                  ) : (
                    <select
                      value={vpSelectedLibraryChar ? String(vpSelectedLibraryChar) : "new"}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "new") {
                          setVpSelectedLibraryChar(null);
                        } else {
                          const charId = parseInt(val);
                          setVpSelectedLibraryChar(charId);
                          const ch = vpLibrary.find((c: any) => c.id === charId);
                          if (ch && !vpName.trim()) setVpName(ch.display_name || ch.name);
                        }
                      }}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:border-purple-500 focus:outline-none"
                    >
                      <option value="new">+ 新建角色</option>
                      {vpLibrary.map((ch: any) => (
                        <option key={ch.id} value={String(ch.id)}>
                          {ch.name} - {ch.race_id} {ch.class_id} Lv.{ch.level} ({ch.campaign_name})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Selected library character preview + name input */}
                {vpSelectedLibraryChar && (() => {
                  const ch = vpLibrary.find((c: any) => c.id === vpSelectedLibraryChar);
                  if (!ch) return null;
                  return (
                    <>
                      <div className="flex items-center gap-3 p-3 bg-purple-600/10 border border-purple-500/30 rounded">
                        {ch.avatar ? (
                          <img src={ch.avatar} alt={ch.name} className="w-10 h-10 rounded object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded bg-gray-700 flex items-center justify-center flex-shrink-0 text-sm">🎭</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white">{ch.name}</div>
                          <div className="text-xs text-gray-400">{ch.race_id} {ch.class_id} Lv.{ch.level} · 来自 {ch.campaign_name}</div>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm text-gray-300 mb-1">玩家名称</label>
                        <input
                          value={vpName}
                          onChange={(e) => setVpName(e.target.value)}
                          placeholder="例如：旅行商人、酒馆老板..."
                          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:border-purple-500 focus:outline-none"
                        />
                      </div>
                    </>
                  );
                })()}

                {/* Creation method - only for new characters */}
                {!vpSelectedLibraryChar && (
                  <>
                    <div>
                      <label className="block text-sm text-gray-300 mb-2">创建方式</label>
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            setVpCreating(true);
                            try {
                              const result = await createVpMember("虚拟玩家");
                              if (!result) return;
                              setVpPendingUserId(result.userId);
                              setVpPendingMemberId(result.memberId);
                              setVpDialogOpen(false);
                              setVpManualWizardOpen(true);
                            } catch (e) {
                              logger.error("创建虚拟玩家失败", e);
                              alert("创建虚拟玩家失败");
                            } finally {
                              setVpCreating(false);
                            }
                          }}
                          disabled={vpCreating}
                          className="flex-1 px-3 py-2 text-xs rounded border transition-colors bg-gray-800 border-gray-700 text-gray-400 hover:border-purple-500 hover:text-purple-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          手动车卡
                        </button>
                        <button
                          onClick={() => {
                            setVpDialogOpen(false);
                            setImportDialogOpen(true);
                          }}
                          disabled={vpCreating}
                          className="flex-1 px-3 py-2 text-xs rounded border transition-colors bg-gray-800 border-gray-700 text-gray-400 hover:border-purple-500 hover:text-purple-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          📄 导入
                        </button>
                        <button
                          onClick={() => setVpShowAiFields(v => !v)}
                          className={`flex-1 px-3 py-2 text-xs rounded border transition-colors ${vpShowAiFields ? "bg-purple-600/30 border-purple-500 text-purple-300" : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"}`}
                        >
                          AI 生成
                        </button>
                      </div>
                    </div>

                    {/* AI Generation Fields */}
                    {vpShowAiFields && (
                      <>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">角色名称 <span className="text-gray-500">（选填，留空由AI生成）</span></label>
                          <input
                            value={vpName}
                            onChange={(e) => setVpName(e.target.value)}
                            placeholder="留空则由AI自动生成"
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:border-purple-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">目标等级</label>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={vpAiLevel}
                            onChange={(e) => setVpAiLevel(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:border-purple-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">角色描述 <span className="text-gray-500">（选填）</span></label>
                          <textarea
                            value={vpAiDescription}
                            onChange={(e) => setVpAiDescription(e.target.value)}
                            placeholder="例如：一个狡猾的半精灵盗贼，擅长潜行和开锁..."
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:border-purple-500 focus:outline-none resize-none h-24"
                          />
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* Progress Display */}
                {vpCreating && vpAiProgress && (
                  <div className="bg-gray-800/50 border border-purple-500/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-purple-400">阶段 {vpAiProgress.stage}/6</span>
                      <span className="text-sm text-gray-400">{vpAiProgress.stageName}</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
                      <div
                        className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(vpAiProgress.stage / 6) * 100}%` }}
                      />
                    </div>
                    {vpAiProgress.detail && (
                      <p className="text-xs text-gray-500">{vpAiProgress.detail}</p>
                    )}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <Dialog.Close asChild>
                  <button className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors" disabled={vpCreating}>
                    取消
                  </button>
                </Dialog.Close>
                {(vpSelectedLibraryChar || vpShowAiFields) && (
                  <button
                    onClick={handleCreateVirtualPlayer}
                    disabled={vpCreating || (vpSelectedLibraryChar ? !vpName.trim() : false)}
                    className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {vpCreating ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        <span>{vpAiProgress ? `阶段 ${vpAiProgress.stage}/6...` : '创建中...'}</span>
                      </>
                    ) : (
                      <span>{vpSelectedLibraryChar ? "导入角色" : "AI 生成并创建"}</span>
                    )}
                  </button>
                )}
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* Virtual Player Manual Character Creation Wizard */}
        <CharacterCreationWizardV2
          open={vpManualWizardOpen}
          onOpenChange={(open) => {
            if (!open) {
              setVpManualWizardOpen(false);
              setVpPendingUserId(null);
              setVpPendingMemberId(null);
              refetch();
            }
          }}
          onCharacterCreated={handleVpManualCharCreated}
          campaignId={campaignId}
        />

        {/* 导入角色卡对话框 */}
        <CharacterImportDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
          onCharacterCreated={handleImportCharCreated}
        />

        {loading && <div className="text-sm text-gray-400 animate-pulse p-2">✨ 加载中...</div>}
        {error && <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded px-3 py-2 mb-2">❌ {error}</div>}

        {roster.length === 0 && !loading ? (
          <div className="fantasy-card !p-6 text-center">
            <div className="text-4xl mb-2 opacity-50">🎭</div>
            <div className="text-sm text-gray-500">暂无玩家或未选择角色</div>
          </div>
        ) : (
          <div className="flex gap-3 flex-1 min-h-0">
            {/* Left: Character Display with Equipment & Spells Dialogs */}
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              {selectedCharacter ? (
                <DMCharacterView
                  key={selectedCharacter.id}
                  character={selectedCharacter}
                  campaignId={campaignId || ""}
                  currentUserId={currentUserId}
                  currentMapUrl={currentMapUrl}
                  globalTerrain={globalTerrain}
                  timeOfDay={timeOfDay}
                  onRefetch={refetch}
                  onEdit={(char) => { setEditing(char); setEditForm(char); }}
                  onKick={kickMember}
                  onDeleteVP={deleteVirtualPlayer}
                  rosterItem={roster.find(r => r.character?.id === selectedCharacter.id)}
                  wildShapeData={wildShapeByCharacter[selectedCharacter.id]}
                  tempHP={tempHpByCharacter[selectedCharacter.id]}
                  campaignAvatars={campaignAvatars}
                  getSpellExpandedLevels={getSpellExpandedLevels}
                  toggleSpellExpandedLevel={toggleSpellExpandedLevel}
                  floatingCharPanel={floatingCharPanel}
                  setFloatingCharPanel={setFloatingCharPanel}
                />
              ) : (
                <div className="fantasy-card !p-6 text-center h-full flex flex-col items-center justify-center">
                  <div className="text-4xl mb-2 opacity-50">👈</div>
                  <div className="text-sm text-gray-500">点击右侧头像查看角色</div>
                </div>
              )}
            </div>

            {/* Right: Arcane Portrait Gallery */}
            <div className="w-12 flex-shrink-0 flex flex-col items-center gap-2 py-1 pl-1 relative">
              {/* Mystical vertical line */}
              <div className="absolute left-0 top-2 bottom-2 w-px bg-gradient-to-b from-transparent via-amber-500/20 to-transparent" />

              {/* Add Virtual Player button - always at top */}
              {isDM && (
                <div
                  className="relative group cursor-pointer"
                  onClick={() => { setVpDialogOpen(true); setVpSelectedLibraryChar(null); setVpName(""); fetchVpLibrary(); }}
                  title="添加虚拟玩家"
                >
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:shadow-purple-500/20 ring-1 ring-dashed ring-purple-600/40 hover:ring-purple-500/60">
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900/60 via-gray-800 to-gray-900">
                      <span className="text-purple-400 text-lg font-light">+</span>
                    </div>
                  </div>
                </div>
              )}

              {roster.filter(item => !!item.character).map((item, index) => {
                const isSelected = item.character ? item.character.id === selectedCharacterId : false;
                const isVP = item.is_virtual;

                return (
                  <div
                    key={item.user_id}
                    className="relative group"
                    style={{ animationDelay: `${index * 50}ms` }}
                    onClick={() => {
                      if (item.character) {
                        setSelectedCharacterId(item.character.id);
                        publishAppEvent("selectTokenByCharacterId", { characterId: item.character.id });
                      }
                    }}
                    onDoubleClick={() => {
                      if (isDM && item.character) {
                        publishAppEvent("focusOrCreateToken", {
                          characterId: item.character.id,
                          name: item.character.name || item.display_name || item.user_id,
                        });
                      }
                    }}
                    title={isVP ? `[虚拟] ${item.display_name || item.user_id}${item.character ? ` - ${item.character.name}` : ' (未分配角色)'}` : (item.character?.name || `玩家: ${item.user_id}`)}
                  >
                    {/* Outer glow ring for selected */}
                    {isSelected && (
                      <div
                        className="absolute -inset-1 rounded-lg opacity-60 animate-pulse"
                        style={{
                          background: `radial-gradient(circle, ${isVP ? 'rgba(168,85,247,0.4)' : 'rgba(251,191,36,0.4)'} 0%, transparent 70%)`,
                        }}
                      />
                    )}

                    {/* Avatar Container */}
                    <div
                      className={`
                        relative w-10 h-10 rounded-lg overflow-hidden cursor-pointer
                        transition-all duration-300 ease-out
                        hover:-translate-y-0.5 hover:shadow-lg ${isVP ? 'hover:shadow-purple-500/20' : 'hover:shadow-amber-500/20'}
                        ${isSelected ? (isVP ? 'shadow-lg shadow-purple-500/30' : 'shadow-lg shadow-amber-500/30') : ''}
                      `}
                    >
                      {/* Border frame */}
                      <div
                        className={`
                          absolute inset-0 rounded-lg pointer-events-none z-10
                          transition-all duration-300
                          ${isSelected
                            ? (isVP ? 'ring-2 ring-purple-400/90 ring-offset-1 ring-offset-gray-900' : 'ring-2 ring-amber-400/90 ring-offset-1 ring-offset-gray-900')
                            : (isVP ? 'ring-1 ring-purple-600/50 group-hover:ring-purple-500/40' : 'ring-1 ring-gray-600/50 group-hover:ring-amber-500/40')
                          }
                        `}
                      />

                      {/* Avatar Image */}
                      {item.character?.avatar ? (
                        <img
                          src={item.character.avatar}
                          alt={item.character.name}
                          className={`
                            w-full h-full object-cover
                            transition-all duration-300
                            ${isSelected ? 'brightness-110' : 'brightness-90 group-hover:brightness-100'}
                          `}
                        />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center ${isVP ? 'bg-gradient-to-br from-purple-900 via-gray-800 to-gray-900' : 'bg-gradient-to-br from-gray-700 via-gray-800 to-gray-900'}`}>
                          <span className="text-base opacity-60">{isVP && !item.character ? '+' : '🎭'}</span>
                        </div>
                      )}

                      {/* Bottom vignette for depth */}
                      <div
                        className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none"
                        style={{
                          background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%)',
                        }}
                      />
                    </div>

                    {/* Level Badge or VP Badge */}
                    {item.character ? (
                      <div
                        className={`
                          absolute -bottom-1 -right-1 min-w-[18px] h-[18px]
                          flex items-center justify-center
                          text-[9px] font-bold tracking-tight
                          rounded-md border
                          transition-all duration-300
                          ${isSelected
                            ? (isVP ? 'bg-gradient-to-br from-purple-400 to-purple-600 text-white border-purple-300/50 shadow-sm shadow-purple-500/50' : 'bg-gradient-to-br from-amber-400 to-amber-600 text-gray-900 border-amber-300/50 shadow-sm shadow-amber-500/50')
                            : (isVP ? 'bg-purple-800/90 text-purple-300 border-purple-600/50' : 'bg-gray-800/90 text-gray-400 border-gray-600/50 group-hover:text-amber-400 group-hover:border-amber-500/30')
                          }
                        `}
                      >
                        {item.character.level}
                      </div>
                    ) : isVP ? (
                      <div className="absolute -bottom-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[8px] font-bold rounded-md border bg-purple-800/90 text-purple-300 border-purple-600/50">
                        VP
                      </div>
                    ) : null}

                    {/* Selection indicator dot */}
                    {isSelected && (
                      <div className={`absolute -left-2.5 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full ${isVP ? 'bg-purple-400 shadow-sm shadow-purple-400/50' : 'bg-amber-400 shadow-sm shadow-amber-400/50'}`} />
                    )}

                    {/* Kick button - top-right, hover visible, DM only */}
                    {isDM && item.user_id !== currentUserId && (
                      <div
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-900/90 border border-red-600/50
                                   flex items-center justify-center cursor-pointer z-20
                                   opacity-0 group-hover:opacity-100 transition-opacity duration-200
                                   hover:bg-red-700 hover:scale-110"
                        onClick={(e) => {
                          e.stopPropagation();
                          kickMember(item.user_id, item.character?.name || item.display_name || item.user_id);
                        }}
                        title="踢出"
                      >
                        <svg width="8" height="8" viewBox="0 0 8 8" className="text-red-300">
                          <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {/* 查看对话框 - 结构化显示 */}
      <Dialog.Root open={!!viewing} onOpenChange={(o)=>!o && setViewing(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40" />
          <Dialog.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-b from-gray-800 to-gray-900 border border-amber-500/20 rounded-xl shadow-2xl shadow-black/50 z-50 w-[95vw] max-w-4xl max-h-[85dvh] overflow-y-auto p-6">
            <Dialog.Title className="text-amber-400 font-fantasy font-semibold text-xl mb-4 flex items-center gap-2">
              <span>📜</span> 角色详情
            </Dialog.Title>

            {viewing && (
              <div className="space-y-6">
                {/* 基本信息 */}
                <div className="fantasy-card !p-4">
                  <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                    <span>👤</span> 基本信息
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <div className="text-gray-500 text-xs">姓名</div>
                      <div className="text-white font-medium">{viewing.name || "未命名"}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">种族</div>
                      <div className="text-white">{racesData.races.find((r: any) => r.id === viewing.race_id)?.name || viewing.race_id}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">职业</div>
                      <div className="text-white">{classesData.classes.find((c: any) => c.id === viewing.class_id)?.name || viewing.class_id}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">等级</div>
                      <div className="text-amber-400 font-medium">{viewing.level}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">阵营</div>
                      <div className="text-white">{formatAlignment(viewing.alignment) || "未设置"}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">背景</div>
                      <div className="text-white">{viewing.background_id || "未设置"}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">性别</div>
                      <div className="text-white">{viewing.gender || "未设置"}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">年龄</div>
                      <div className="text-white">{viewing.age || "未设置"}</div>
                    </div>
                  </div>
                </div>

                {/* HP 和战斗属性 */}
                <div className="fantasy-card !p-4">
                  <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                    <span>⚔️</span> 战斗属性
                    {/* Wild Shape Indicator */}
                    {wildShapeByCharacter[viewing.id] && (
                      <span className="ml-2 px-2 py-0.5 bg-green-900/50 border border-green-600 rounded text-green-400 text-xs">
                        🐺 {wildShapeByCharacter[viewing.id].beast_name}
                      </span>
                    )}
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <button
                      className={`bg-gray-800/50 rounded-lg p-3 border text-left hover:ring-1 ring-amber-400 cursor-pointer ${wildShapeByCharacter[viewing.id] ? 'border-green-600/50' : 'border-gray-700/50'}`}
                      onClick={() => {
                        const b = getHPBreakdown(viewing, { includeFlatSubraceHP: true, includeSubraceLevelBonuses: true });
                        setBreakdownData({ title: "生命值 (HP)", final: b.final, items: b.items, description: "生命值代表你的角色能承受多少伤害。当HP降到0时角色濒死。HP由职业生命骰+体质调整值决定，每次升级会增加。可通过休息、治疗法术、药水恢复。" });
                        setBreakdownOpen(true);
                      }}
                    >
                      <div className="text-gray-500 text-xs flex items-center gap-1">
                        <span className="text-red-400">❤️</span> {wildShapeByCharacter[viewing.id] ? '野兽HP' : '生命值 (HP)'}
                      </div>
                      <div className={`font-medium text-lg ${wildShapeByCharacter[viewing.id] ? 'text-green-400' : 'text-white'}`}>
                        {wildShapeByCharacter[viewing.id]
                          ? `${wildShapeByCharacter[viewing.id].current_hp} / ${wildShapeByCharacter[viewing.id].max_hp}`
                          : `${typeof viewing.current_hp === "number" ? viewing.current_hp : calculateMaxHP(viewing)} / ${calculateMaxHP(viewing)}`
                        }
                        {tempHpByCharacter[viewing.id] != null && tempHpByCharacter[viewing.id]! > 0 && (
                          <span className="text-amber-400 ml-1">+{tempHpByCharacter[viewing.id]}</span>
                        )}
                      </div>
                      {wildShapeByCharacter[viewing.id] && (
                        <div className="text-xs text-gray-500 mt-1">
                          原形态: {typeof viewing.current_hp === "number" ? viewing.current_hp : calculateMaxHP(viewing)} / {calculateMaxHP(viewing)}
                        </div>
                      )}
                    </button>
                    <button
                      className={`bg-gray-800/50 rounded-lg p-3 border text-left hover:ring-1 ring-amber-400 cursor-pointer ${wildShapeByCharacter[viewing.id] ? 'border-green-600/50' : 'border-gray-700/50'}`}
                      onClick={() => {
                        const b = getACBreakdown(viewing);
                        setBreakdownData({ title: "护甲等级 (AC)", final: b.final, items: b.items, description: "AC代表你有多难被击中。敌人的攻击骰结果≥你的AC才能命中你。穿护甲、持盾牌、敏捷高都能提升AC。无护甲时AC = 10 + 敏捷调整值。" });
                        setBreakdownOpen(true);
                      }}
                    >
                      <div className="text-gray-500 text-xs flex items-center gap-1">
                        <span className="text-blue-400">🛡️</span> 护甲等级 (AC)
                      </div>
                      <div className={`font-medium text-lg ${wildShapeByCharacter[viewing.id] ? 'text-green-400' : 'text-white'}`}>
                        {wildShapeByCharacter[viewing.id]?.ac ?? calculateAC(viewing)}
                      </div>
                    </button>
                    <button
                      className={`bg-gray-800/50 rounded-lg p-3 border text-left hover:ring-1 ring-amber-400 cursor-pointer ${wildShapeByCharacter[viewing.id] ? 'border-green-600/50' : 'border-gray-700/50'}`}
                      onClick={() => {
                        const b = getSpeedBreakdown(viewing);
                        setBreakdownData({ title: "速度", final: b.final, items: b.items, unit: "ft", description: "速度代表每回合能移动多远（单位：尺，1尺≈0.3米）。大多数种族基础30尺。在战术地图上5尺=1格。穿重甲可能降低速度，某些职业特性可提升速度。" });
                        setBreakdownOpen(true);
                      }}
                    >
                      <div className="text-gray-500 text-xs flex items-center gap-1">
                        <span className="text-green-400">👟</span> 速度
                      </div>
                      <div className={`font-medium text-lg ${wildShapeByCharacter[viewing.id] ? 'text-green-400' : 'text-white'}`}>
                        {wildShapeByCharacter[viewing.id]?.speed?.walk ?? calculateSpeed(viewing)} 尺
                      </div>
                    </button>
                    <button
                      className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50 text-left hover:ring-1 ring-amber-400 cursor-pointer"
                      onClick={() => {
                        const b = getProficiencyBonusBreakdown(viewing.level || 1);
                        setBreakdownData({ title: "熟练加值", final: b.final, items: b.items, unit: "+", description: "熟练加值加到你擅长的技能检定、攻击骰和豁免检定上。1级时为+2，之后每4级增加1（5级+3，9级+4…最高20级+6）。" });
                        setBreakdownOpen(true);
                      }}
                    >
                      <div className="text-gray-500 text-xs flex items-center gap-1">
                        <span className="text-amber-400">⭐</span> 熟练加值
                      </div>
                      <div className="text-amber-400 font-medium text-lg">+{calculateProficiencyBonus(viewing.level)}</div>
                    </button>
                  </div>
                </div>

                {/* 能力值 */}
                <div className="fantasy-card !p-4">
                  <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                    <span>💪</span> 能力值
                    {wildShapeByCharacter[viewing.id] && (
                      <span className="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded">野性形态</span>
                    )}
                  </h3>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                    {[
                      { key: "strength", label: "力量", wsKey: "str" },
                      { key: "dexterity", label: "敏捷", wsKey: "dex" },
                      { key: "constitution", label: "体质", wsKey: "con" },
                      { key: "intelligence", label: "智力", wsKey: null },
                      { key: "wisdom", label: "感知", wsKey: null },
                      { key: "charisma", label: "魅力", wsKey: null }
                    ].map(({ key, label, wsKey }) => {
                      const wsData = wildShapeByCharacter[viewing.id];
                      const isWildShapePhysical = wsData && wsKey; // STR/DEX/CON use beast stats
                      const score = isWildShapePhysical
                        ? (wsData.ability_scores?.[wsKey] || 10)
                        : (viewing.ability_scores?.[key] || 10);
                      const modifier = isWildShapePhysical
                        ? (wsData.ability_scores?.[`${wsKey}Mod`] ?? Math.floor((score - 10) / 2))
                        : Math.floor((score - 10) / 2);
                      const helpText = getAbilityHelpText(key);
                      return (
                        <div key={key} className={`text-center bg-gradient-to-b from-gray-800/80 to-gray-900/80 rounded-lg p-3 border ${isWildShapePhysical ? 'border-green-600/50' : 'border-gray-700/50'}`}>
                          <div className={`text-xs mb-1 flex items-center justify-center gap-1 ${isWildShapePhysical ? 'text-green-500' : 'text-gray-500'}`}>
                            {label}
                            <HelpTooltip title={helpText.title} content={helpText.content} size="1" />
                          </div>
                          <div className={`font-bold text-xl ${isWildShapePhysical ? 'text-green-400' : 'text-white'}`}>{score}</div>
                          <div className={`text-sm font-medium ${modifier >= 0 ? (isWildShapePhysical ? 'text-green-400' : 'text-emerald-400') : 'text-red-400'}`}>
                            {modifier >= 0 ? "+" : ""}{modifier}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 技能 */}
                {(() => {
                  const viewingSelectedSkills = extractValues<string>(viewing.selected_skills);
                  if (viewingSelectedSkills.length === 0) return null;

                  return (
                    <div className="fantasy-card !p-4">
                      <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                        <span>🎯</span> 技能
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {viewingSelectedSkills.map((skill, index) => (
                          <span key={`${skill}-${index}`} className="px-3 py-1.5 bg-gradient-to-r from-gray-700/80 to-gray-800/80 rounded-full text-sm text-white border border-gray-600/50">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* 职业特性 */}
                {(() => {
                  const vc = (classesData as any).classes?.find((c: any) => c.id === viewing.class_id);
                  if (!vc?.features) return null;
                  const features = vc.features.filter((f: any) => (f.level ?? 0) <= (viewing.level || 1));
                  if (features.length === 0) return null;

                  const ev = (field: any): string | undefined => {
                    if (!field) return undefined;
                    if (typeof field === 'string') return field;
                    if (typeof field === 'object' && field.value) return field.value;
                    return undefined;
                  };
                  const ea = (field: any): string[] => {
                    if (!field) return [];
                    if (Array.isArray(field)) return field.map((item: any) => typeof item === 'string' ? item : item?.value).filter(Boolean);
                    return [];
                  };

                  const fightingStyle = ev(viewing.fighting_style || viewing.fightingStyle);
                  const enemy = ev(viewing.favored_enemy || viewing.favoredEnemy);
                  const humanoids = (viewing.favored_humanoid_races || viewing.favoredHumanoidRaces as string[]) || [];
                  const terrain = ev(viewing.favored_terrain || viewing.favoredTerrain);
                  const metamagics = ea(viewing.metamagic_options || viewing.metamagicOptions);
                  const invocations = ea(viewing.eldritch_invocations || viewing.eldritchInvocations);

                  return (
                    <div className="fantasy-card !p-4">
                      <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                        <span>✨</span> 职业特性（{viewing.level}级）
                      </h3>
                      <div className="space-y-2 max-h-60 overflow-auto">
                        {features.map((feat: any, idx: number) => {
                          const featureName = feat.name || "";
                          return (
                            <div key={idx} className="text-xs">
                              <div className="text-amber-300 font-medium">
                                {featureName}{feat.level ? ` (${feat.level}级)` : ""}
                              </div>
                              <div className="text-gray-400 whitespace-pre-wrap">{feat.description}</div>

                              {/* Fighting Style */}
                              {/战斗风格|Fighting Style/.test(featureName) && feat.options?.length > 0 && (
                                <details className="mt-1">
                                  <summary className="text-xs text-green-300 cursor-pointer hover:text-green-200">
                                    {fightingStyle ? `已选择：${formatFightingStyle(fightingStyle)}` : "未选择"} <span className="text-green-500 text-[10px]">▶ 查看全部</span>
                                  </summary>
                                  <div className="mt-2 pl-2 border-l-2 border-green-800 space-y-1.5">
                                    {feat.options.map((opt: any) => {
                                      const isSel = opt.id === fightingStyle;
                                      return (
                                        <div key={opt.id} className={`rounded px-2 py-1.5 ${isSel ? "bg-green-900/40 border border-green-700" : "bg-gray-800/60"}`}>
                                          <span className={isSel ? "text-green-300 font-medium" : "text-gray-300"}>{isSel && "✦ "}{opt.name}</span>
                                          <span className="text-gray-500 ml-1">({opt.nameEn})</span>
                                          <div className="text-gray-400 mt-0.5">{opt.description}</div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </details>
                              )}

                              {/* Favored Enemy */}
                              {/宿敌|Favored Enemy/.test(featureName) && feat.choices?.length > 0 && (
                                <details className="mt-1">
                                  <summary className="text-xs text-green-300 cursor-pointer hover:text-green-200">
                                    {enemy
                                      ? `已选择：${enemy === "humanoids" ? `类人生物（${humanoids.map(formatHumanoid).join("、")}）` : formatFavoredEnemy(enemy)}`
                                      : "未选择"
                                    } <span className="text-green-500 text-[10px]">▶ 查看全部</span>
                                  </summary>
                                  <div className="mt-2 pl-2 border-l-2 border-green-800 flex flex-wrap gap-1.5">
                                    {feat.choices.map((id: string) => {
                                      const isSel = id === enemy;
                                      return (
                                        <span key={id} className={`rounded px-2 py-1 ${isSel ? "bg-green-900/40 border border-green-700 text-green-300 font-medium" : "bg-gray-800/60 text-gray-400"}`}>
                                          {isSel && "✦ "}{formatFavoredEnemy(id)}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </details>
                              )}

                              {/* Favored Terrain */}
                              {/偏好地形|天生探险家|自然探险家|自然探索者|Natural Explorer/.test(featureName) && feat.terrainChoices?.length > 0 && (
                                <details className="mt-1">
                                  <summary className="text-xs text-green-300 cursor-pointer hover:text-green-200">
                                    {terrain ? `已选择：${formatFavoredTerrain(terrain)}` : "未选择"} <span className="text-green-500 text-[10px]">▶ 查看全部</span>
                                  </summary>
                                  <div className="mt-2 pl-2 border-l-2 border-green-800 flex flex-wrap gap-1.5">
                                    {feat.terrainChoices.map((id: string) => {
                                      const isSel = id === terrain;
                                      return (
                                        <span key={id} className={`rounded px-2 py-1 ${isSel ? "bg-green-900/40 border border-green-700 text-green-300 font-medium" : "bg-gray-800/60 text-gray-400"}`}>
                                          {isSel && "✦ "}{formatFavoredTerrain(id)}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </details>
                              )}

                              {/* Metamagic */}
                              {/超魔|Metamagic/.test(featureName) && feat.options?.length > 0 && (
                                <details className="mt-1">
                                  <summary className="text-xs text-green-300 cursor-pointer hover:text-green-200">
                                    {metamagics.length > 0 ? `已选择：${metamagics.map(formatMetamagic).join("、")}` : "未选择"} <span className="text-green-500 text-[10px]">▶ 查看全部</span>
                                  </summary>
                                  <div className="mt-2 pl-2 border-l-2 border-green-800 space-y-1.5">
                                    {feat.options.map((opt: any) => {
                                      const isSel = metamagics.includes(opt.id);
                                      return (
                                        <div key={opt.id} className={`rounded px-2 py-1.5 ${isSel ? "bg-green-900/40 border border-green-700" : "bg-gray-800/60"}`}>
                                          <span className={isSel ? "text-green-300 font-medium" : "text-gray-300"}>{isSel && "✦ "}{opt.name}</span>
                                          <span className="text-gray-500 ml-1">({opt.nameEn})</span>
                                          {opt.cost && <span className="text-amber-400/70 ml-1">- {opt.cost}点</span>}
                                          <div className="text-gray-400 mt-0.5">{opt.description}</div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </details>
                              )}

                              {/* Eldritch Invocations */}
                              {/魔能祈唤|Eldritch Invocations/.test(featureName) && invocations.length > 0 && (
                                <div className="text-xs text-green-300 mt-1">已选择：{invocations.map(formatEldritchInvocation).join("、")}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* 装备 */}
                {viewing.equipment && viewing.equipment.length > 0 && (
                  <div className="fantasy-card !p-4">
                    <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                      <span>🎒</span> 装备
                    </h3>
                    <div className="space-y-2">
                      {viewing.equipment.map((item: any, idx: number) => {
                        const itemName = typeof item === 'string' ? item : (item.name || item.id || '未知物品');
                        const quantity = typeof item === 'object' ? item.quantity : null;
                        return (
                          <div key={idx} className="flex justify-between items-center text-sm border-b border-gray-700/30 pb-2 last:border-0 last:pb-0">
                            <span className="text-white">{itemName}</span>
                            {quantity && <span className="text-gray-400 bg-gray-800 px-2 py-0.5 rounded">x{quantity}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 法术 */}
                <div className="fantasy-card !p-4">
                  <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                    <span>✨</span> 法术
                  </h3>
                  {viewing.selected_cantrips && viewing.selected_cantrips.length > 0 ? (
                    <div className="mb-3">
                      <div className="text-gray-400 text-xs mb-2 flex items-center gap-1">
                        <span>🔮</span> 戏法
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {viewing.selected_cantrips.map((spell: any, idx: number) => (
                          <span key={idx} className="px-2.5 py-1 bg-purple-900/40 border border-purple-700/50 rounded-lg text-xs text-purple-300">
                            {typeof spell === 'string' ? spell : (spell?.id || spell?.name || '未知')}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-gray-500 text-xs mb-3">无戏法</div>
                  )}
                  {viewing.selected_spells && viewing.selected_spells.length > 0 ? (
                    <div>
                      <div className="text-gray-400 text-xs mb-2 flex items-center gap-1">
                        <span>📖</span> 已知法术
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {viewing.selected_spells.map((spell: any, idx: number) => (
                          <span key={idx} className="px-2.5 py-1 bg-blue-900/40 border border-blue-700/50 rounded-lg text-xs text-blue-300">
                            {typeof spell === 'string' ? spell : (spell?.id || spell?.name || '未知')}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-gray-500 text-xs">无已知法术</div>
                  )}
                </div>

                {/* 个性与外貌 */}
                <div className="grid md:grid-cols-2 gap-4">
                  {viewing.personality && (
                    <div className="fantasy-card !p-4">
                      <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                        <span>💭</span> 个性
                      </h3>
                      <div className="space-y-3 text-sm">
                        {viewing.personality.traits && (
                          <div className="bg-gray-800/30 rounded p-2">
                            <div className="text-gray-500 text-xs mb-1">特质</div>
                            <div className="text-white">{Array.isArray(viewing.personality.traits) ? viewing.personality.traits.join(", ") : viewing.personality.traits}</div>
                          </div>
                        )}
                        {viewing.personality.ideals && (
                          <div className="bg-gray-800/30 rounded p-2">
                            <div className="text-gray-500 text-xs mb-1">理想</div>
                            <div className="text-white">{viewing.personality.ideals}</div>
                          </div>
                        )}
                        {viewing.personality.bonds && (
                          <div className="bg-gray-800/30 rounded p-2">
                            <div className="text-gray-500 text-xs mb-1">羁绊</div>
                            <div className="text-white">{viewing.personality.bonds}</div>
                          </div>
                        )}
                        {viewing.personality.flaws && (
                          <div className="bg-gray-800/30 rounded p-2">
                            <div className="text-gray-500 text-xs mb-1">缺陷</div>
                            <div className="text-white">{viewing.personality.flaws}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {viewing.appearance && (
                    <div className="fantasy-card !p-4">
                      <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                        <span>👁️</span> 外貌
                      </h3>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {viewing.appearance.height && (
                          <div className="bg-gray-800/30 rounded p-2">
                            <div className="text-gray-500 text-xs mb-1">身高</div>
                            <div className="text-white">{viewing.appearance.height}</div>
                          </div>
                        )}
                        {viewing.appearance.weight && (
                          <div className="bg-gray-800/30 rounded p-2">
                            <div className="text-gray-500 text-xs mb-1">体重</div>
                            <div className="text-white">{viewing.appearance.weight}</div>
                          </div>
                        )}
                        {viewing.appearance.eyes && (
                          <div className="bg-gray-800/30 rounded p-2">
                            <div className="text-gray-500 text-xs mb-1">眼睛</div>
                            <div className="text-white">{viewing.appearance.eyes}</div>
                          </div>
                        )}
                        {viewing.appearance.hair && (
                          <div className="bg-gray-800/30 rounded p-2">
                            <div className="text-gray-500 text-xs mb-1">头发</div>
                            <div className="text-white">{viewing.appearance.hair}</div>
                          </div>
                        )}
                        {viewing.appearance.skin && (
                          <div className="bg-gray-800/30 rounded p-2 col-span-2">
                            <div className="text-gray-500 text-xs mb-1">肤色</div>
                            <div className="text-white">{viewing.appearance.skin}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 背景故事 */}
                {viewing.backstory && (
                  <div className="fantasy-card !p-4">
                    <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                      <span>📚</span> 背景故事
                    </h3>
                    <div className="text-sm text-gray-300 whitespace-pre-wrap bg-gray-800/30 rounded-lg p-3 leading-relaxed">{viewing.backstory}</div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-700/30">
              <Dialog.Close className="fantasy-btn">
                <span>✖️</span> 关闭
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* 编辑对话框 */}
      <Dialog.Root open={!!editing} onOpenChange={(o)=>!o && setEditing(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40" />
          <Dialog.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-b from-gray-800 to-gray-900 border border-amber-500/20 rounded-xl shadow-2xl shadow-black/50 z-50 w-[95vw] max-w-4xl max-h-[85dvh] overflow-y-auto p-5">
            <Dialog.Title className="text-amber-400 font-fantasy font-semibold text-lg flex items-center gap-2">
              <span>✏️</span> 编辑角色（基础字段）
            </Dialog.Title>
            {editing && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="text-xs text-gray-400">名字</label>
                  <input className="input" value={editForm.name || ""} onChange={(e)=>setEditForm({ ...editForm, name: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-gray-400">等级</label>
                  <input type="number" className="input" value={editForm.level ?? 1} onChange={(e)=>setEditForm({ ...editForm, level: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="text-xs text-gray-400">种族ID</label>
                  <input className="input" value={editForm.race_id || ""} onChange={(e)=>setEditForm({ ...editForm, race_id: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-gray-400">职业ID</label>
                  <input className="input" value={editForm.class_id || ""} onChange={(e)=>setEditForm({ ...editForm, class_id: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-gray-400">阵营</label>
                  <input className="input" value={editForm.alignment || ""} onChange={(e)=>setEditForm({ ...editForm, alignment: e.target.value })} />
                </div>

                {/* 能力值 */}
                <div className="md:col-span-2 border-t border-gray-700 pt-2">
                  <div className="text-xs text-gray-400 mb-2">能力值</div>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {["strength","dexterity","constitution","intelligence","wisdom","charisma"].map((k)=>(
                      <div key={k}>
                        <label className="text-[10px] text-gray-500">{k}</label>
                        <input
                          type="number"
                          className="input"
                          value={editForm.ability_scores?.[k] ?? 10}
                          onChange={(e)=>
                            setEditForm({
                              ...editForm,
                              ability_scores: {
                                ...(editForm.ability_scores || {}),
                                [k]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* HP 编辑 */}
                <div className="md:col-span-2 border-t border-gray-700 pt-2">
                  <div className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                    生命值 (HP)
                    <HelpTooltip title={DND_HELP_TEXTS.hp.title} content={DND_HELP_TEXTS.hp.content} size="1" />
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500">当前 HP</span>
                      <input
                        type="number"
                        className="input w-24"
                        value={typeof editForm.current_hp === "number" ? editForm.current_hp : calculateMaxHP(editForm as any)}
                        onChange={(e)=>
                          setEditForm({
                            ...editForm,
                            current_hp: e.target.value === "" ? undefined : Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="text-gray-400">
                      / 最大 HP {calculateMaxHP(editForm as any)}
                    </div>
                    <button
                      type="button"
                      className="btn-secondary text-[11px] px-2 py-1"
                      onClick={()=>
                        setEditForm({
                          ...editForm,
                          current_hp: calculateMaxHP(editForm as any),
                        })
                      }
                    >
                      回满
                    </button>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1">
                    清空该字段则会在角色卡中使用规则计算的最大生命值。
                  </div>
                </div>

                {/* 法术位编辑（仅施法者显示） */}
                <div className="md:col-span-2 border-t border-gray-700 pt-2">
                  <div className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                    法术位 / 契约位
                    <HelpTooltip
                      title="法术位管理"
                      content="DM 可以在这里直接修改该角色各环法术位的当前剩余值。最大值基于职业和等级自动计算。"
                      size="1"
                    />
                  </div>
                  {(() => {
                    const slots = getMaxSpellSlots(editForm as any);
                    const type = getSpellcastingType(editForm.class_id);
                    if (!type) {
                      return <div className="text-[11px] text-gray-500">当前职业不是施法者，暂无法术位。</div>;
                    }
                    const isWarlock = type === "pact";
                    return (
                      <>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                          {slots.map((maxSlots, level) => {
                            if (level === 0 || maxSlots <= 0) return null;
                            const current = Array.isArray(editForm.spell_slots_state)
                              ? editForm.spell_slots_state[level] ?? maxSlots
                              : maxSlots;
                            return (
                              <div key={level} className="flex items-center gap-1">
                                <span className="text-gray-400">{level}环</span>
                                <input
                                  type="number"
                                  className="input w-16"
                                  min={0}
                                  max={maxSlots}
                                  value={current}
                                  onChange={(e)=>{
                                    const raw = Number(e.target.value);
                                    const clamped = Number.isFinite(raw)
                                      ? Math.min(Math.max(raw, 0), maxSlots)
                                      : 0;
                                    const next = Array.isArray(editForm.spell_slots_state)
                                      ? [...editForm.spell_slots_state]
                                      : new Array(10).fill(0);
                                    next[level] = clamped;
                                    setEditForm({ ...editForm, spell_slots_state: next });
                                  }}
                                />
                                <span className="text-gray-500">/ {maxSlots}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            type="button"
                            className="btn-secondary text-[11px] px-2 py-1"
                            onClick={() => {
                              const maxSlots = getMaxSpellSlots(editForm as any);
                              setEditForm({ ...editForm, spell_slots_state: maxSlots });
                            }}
                          >
                            回满所有{isWarlock ? "契约位" : "法术位"}
                          </button>
                          <div className="text-[10px] text-gray-500">
                            左侧为当前剩余值，右侧为规则计算的最大值。
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* 其他JSON字段（可选） */}
                <div className="md:col-span-2">
                  <label className="text-xs text-gray-400">个性(JSON)</label>
                  <textarea className="input min-h-[80px]" value={JSON.stringify(editForm.personality || {}, null, 2)} onChange={(e)=>{ try { setEditForm({ ...editForm, personality: JSON.parse(e.target.value) }); } catch (_) {} }} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-gray-400">外貌(JSON)</label>
                  <textarea className="input min-h-[80px]" value={JSON.stringify(editForm.appearance || {}, null, 2)} onChange={(e)=>{ try { setEditForm({ ...editForm, appearance: JSON.parse(e.target.value) }); } catch (_) {} }} />
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-700/30">
              <button className="fantasy-btn" onClick={() => setEditing(null)}>
                <span>✖️</span> 取消
              </button>
              <button className="fantasy-btn-primary" onClick={saveEdit}>
                <span>💾</span> 保存
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Alignment Info Dialog */}
      <AlignmentInfoDialog
        open={alignmentInfoOpen}
        onOpenChange={setAlignmentInfoOpen}
        currentAlignment={alignmentInfoTarget}
      />

      {/* Deity Info Dialog */}
      <DeityInfoDialog
        open={deityInfoOpen}
        onOpenChange={setDeityInfoOpen}
        deityId={deityInfoTarget}
      />

      {/* Kick Confirmation Dialog */}
      <Dialog.Root open={!!kickConfirm} onOpenChange={(o) => !o && setKickConfirm(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60]" />
          <Dialog.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-b from-gray-800 to-gray-900 border border-red-500/30 rounded-xl shadow-2xl shadow-black/50 z-[61] w-[90vw] max-w-sm p-5">
            <Dialog.Title className="text-red-400 font-semibold text-base flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 16 16" className="text-red-400">
                <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5 5L11 11M11 5L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              踢出玩家
            </Dialog.Title>
            <p className="text-gray-300 text-sm mt-3">
              确定要将 <span className="text-white font-medium">{kickConfirm?.name}</span> 移出战役吗？角色数据不会被删除。
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                onClick={() => setKickConfirm(null)}
              >
                取消
              </button>
              <button
                className="px-3 py-1.5 text-sm rounded-lg bg-red-700 hover:bg-red-600 text-white transition-colors"
                onClick={confirmKick}
              >
                确认踢出
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
    );
  }

  // Player View: Original collapsible card layout
  return (
    <div className="space-y-4">
      <div className="fantasy-section-header !mb-4">
        <h3>角色列表</h3>
      </div>

      {loading && <div className="text-sm text-gray-400 animate-pulse">✨ 加载中...</div>}
      {error && <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded px-3 py-2">❌ {error}</div>}

      <div className="space-y-3">
        {roster.length === 0 && !loading ? (
          <div className="fantasy-card !p-6 text-center">
            <div className="text-4xl mb-2 opacity-50">🎭</div>
            <div className="text-sm text-gray-500">暂无玩家或未选择角色</div>
          </div>
        ) : (
          roster
            .filter((item) => item.character || item.user_id === currentUserId)
            .map((item) => {
            const isOwnCharacter = item.user_id === currentUserId;
            const canViewFull = isOwnCharacter;
            const isExpanded = expandedCards.has(item.user_id);

            return (
              <div key={item.user_id} className="fantasy-card !p-4 space-y-3 group">
                {/* 可点击的头部区域 */}
                <div
                  className="flex justify-between items-start cursor-pointer"
                  onClick={() => item.character && canViewFull && toggleCard(item.user_id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      {item.character?.avatar && (
                        <img
                          src={item.character.avatar}
                          alt={item.character.name}
                          className="w-12 h-12 rounded-full object-cover border-2 border-amber-500/60 shadow-lg shadow-amber-500/20 group-hover:border-amber-400 transition-colors"
                        />
                      )}
                      {!item.character?.avatar && item.character && (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center border-2 border-gray-600 shadow-lg">
                          <span className="text-xl">🎭</span>
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">玩家：{item.user_id}</div>
                      <h4 className="font-semibold text-amber-300">
                        {item.character ? item.character.name : "未选择角色"}
                      </h4>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.character && canViewFull && (
                      <div className="text-right text-sm text-gray-400">等级 {item.character.level}</div>
                    )}
                    {item.character && canViewFull && (
                      <span className={`text-gray-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                        ▼
                      </span>
                    )}
                  </div>
                </div>

                {/* 只有自己的角色才显示详细属性，且需要展开状态 */}
                {item.character && canViewFull && isExpanded && (
                  <ClassicCardWithResources
                    character={item.character}
                    campaignId={campaignId}
                    isDM={isDM}
                    currentMapUrl={currentMapUrl}
                    currentUserId={currentUserId}
                    globalTerrain={globalTerrain}
                    onAvatarClick={() => refetch()}
                    wildShapeData={wildShapeByCharacter[item.character.id]}
                    tempHP={tempHpByCharacter[item.character.id]}
                    spellExpandedLevels={getSpellExpandedLevels?.(item.character.id)}
                    onToggleSpellLevel={toggleSpellExpandedLevel ? (level: number) => toggleSpellExpandedLevel(item.character!.id, level) : undefined}
                    isSpellcaster={isSpellcasterClass(item.character.class_id, item.character.subclass_id)}
                    onOpenStatusEffects={setFloatingCharPanel ? () => {
                      setFloatingCharPanel({ stage: 'open', activeTab: 'status' });
                    } : undefined}
                    floatingStatusActive={floatingCharPanel?.stage === 'open' && floatingCharPanel?.activeTab === 'status'}
                    floatingStatusContainer={playerStatusContainer}
                    onOpenSpells={setFloatingCharPanel ? () => {
                      setFloatingCharPanel({ stage: 'open', activeTab: 'spells' });
                    } : undefined}
                    onOpenFeatures={setFloatingCharPanel ? () => {
                      setFloatingCharPanel({ stage: 'open', activeTab: 'features' });
                    } : undefined}
                    onOpenBag={setFloatingCharPanel ? () => {
                      setFloatingCharPanel({ stage: 'open', activeTab: 'equipment' });
                    } : undefined}
                  />
                )}

                {/* 其他玩家的角色：显示种族和外貌信息 */}
                {item.character && !canViewFull && (
                  <div className="space-y-3 bg-gray-900/30 rounded-lg p-3">
                    {/* 种族信息 */}
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-sm">种族：</span>
                      <span className="text-amber-300 text-sm">
                        {racesData.races.find((r: any) => r.id === item.character?.race_id)?.name || item.character?.race_id || '未知'}
                      </span>
                    </div>

                    {/* 外貌信息 */}
                    {item.character.appearance && Object.keys(item.character.appearance).length > 0 ? (
                      <div className="space-y-2">
                        <div className="text-gray-400 text-xs flex items-center gap-1">
                          <span>👁️</span> 外貌
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          {item.character.appearance.height && (
                            <div className="bg-gray-800/50 rounded px-2 py-1">
                              <span className="text-gray-500 text-xs">身高：</span>
                              <span className="text-white">{item.character.appearance.height}</span>
                            </div>
                          )}
                          {item.character.appearance.weight && (
                            <div className="bg-gray-800/50 rounded px-2 py-1">
                              <span className="text-gray-500 text-xs">体重：</span>
                              <span className="text-white">{item.character.appearance.weight}</span>
                            </div>
                          )}
                          {item.character.appearance.eyes && (
                            <div className="bg-gray-800/50 rounded px-2 py-1">
                              <span className="text-gray-500 text-xs">眼睛：</span>
                              <span className="text-white">{item.character.appearance.eyes}</span>
                            </div>
                          )}
                          {item.character.appearance.hair && (
                            <div className="bg-gray-800/50 rounded px-2 py-1">
                              <span className="text-gray-500 text-xs">头发：</span>
                              <span className="text-white">{item.character.appearance.hair}</span>
                            </div>
                          )}
                          {item.character.appearance.skin && (
                            <div className="bg-gray-800/50 rounded px-2 py-1 col-span-2">
                              <span className="text-gray-500 text-xs">肤色：</span>
                              <span className="text-white">{item.character.appearance.skin}</span>
                            </div>
                          )}
                          {item.character.appearance.description && (
                            <div className="bg-gray-800/50 rounded px-2 py-1 col-span-2">
                              <span className="text-gray-500 text-xs">描述：</span>
                              <span className="text-gray-300 text-xs">{item.character.appearance.description}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 italic">
                        <span className="opacity-50">👁️</span> 暂无外貌描述
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Player Floating Character Panel */}
      {floatingCharPanel && setFloatingCharPanel && floatingCharPanel.stage !== 'closed' && (() => {
        const ownItem = roster.find(item => item.user_id === currentUserId);
        if (!ownItem?.character) return null;
        return (
          <PlayerFloatingPanel
            character={ownItem.character}
            campaignId={campaignId}
            currentUserId={currentUserId}
            currentMapUrl={currentMapUrl}
            floatingCharPanel={floatingCharPanel}
            setFloatingCharPanel={setFloatingCharPanel}
            onRefetch={() => refetch()}
            statusContainerRef={playerStatusContainerRef}
            statusContainerCallbackRef={playerStatusContainerCallbackRef}
          />
        );
      })()}

      {/* Alignment Info Dialog */}
      <AlignmentInfoDialog
        open={alignmentInfoOpen}
        onOpenChange={setAlignmentInfoOpen}
        currentAlignment={alignmentInfoTarget}
      />

      {/* Deity Info Dialog */}
      <DeityInfoDialog
        open={deityInfoOpen}
        onOpenChange={setDeityInfoOpen}
        deityId={deityInfoTarget}
      />

      {/* Stat Breakdown Dialog */}
      <StatBreakdownDialog open={breakdownOpen} onOpenChange={setBreakdownOpen} data={breakdownData} />
    </div>
  );
}
