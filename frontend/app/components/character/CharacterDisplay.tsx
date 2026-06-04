import { useState, useEffect, useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import skillsData from "~/data/rules/skills.json";
// Note: Loading spells dynamically to match SpellSelector
import xpThresholds from "~/data/rules/xp-thresholds.json";
import godsData from "~/data/rules/gods.json";
import type { Spell } from "./CharacterDisplay/types/Spell";
import type { SkillMeta } from "./CharacterDisplay/types/Skill";
import { getAssetUrl } from "~/utils/asset-url";



import { abilityLabelMap, formatAlignment } from "./CharacterDisplay/utils/formatting";
import { spellcastingAbilityMap } from "./CharacterDisplay/utils/spellcasting";

import { computeAll as computeDerivedAll, getAbilityScoreBreakdown, getHPBreakdown, getACBreakdown, getProficiencyBonusBreakdown, getInitiativeBreakdown, getHitDiceBreakdown, getSpellSaveDCBreakdown, getSpellAttackBonusBreakdown } from "./CharacterDisplay/utils/derived";
import { checkArmorProficiencyPenalty } from "./CharacterDisplay/utils/proficiency";
import { getFeatRuleOverrides } from "./CharacterDisplay/utils/featEffects";
import { subscribeAppEvent } from "~/events/appEventBus";

import { useToast } from "./CharacterDisplay/hooks/useToast";
import { useCharacterComputed } from "./CharacterDisplay/hooks/useCharacterComputed";
import { abilityModNumber } from "./CharacterDisplay/utils/ability";
import { useCharacterSpellcasting } from "~/hooks/useCharacterSpellcasting";
import { useCurrency } from "./CharacterDisplay/hooks/useCurrency";
import { useEquipment } from "./CharacterDisplay/hooks/useEquipment";
import { useMapToken } from "./CharacterDisplay/hooks/useMapToken";
import { useAvatar } from "./CharacterDisplay/hooks/useAvatar";
import { AvatarModal } from "./CharacterDisplay/sections/Avatar/AvatarModal";
import { EquipmentPanel } from "./CharacterDisplay/sections/Equipment/EquipmentPanel";
import { EquipDialog } from "./CharacterDisplay/sections/Equipment/EquipDialog";
import { BagDialog } from "./CharacterDisplay/sections/Equipment/BagDialog";
import { ItemDetailModal } from "./CharacterDisplay/sections/Equipment/ItemDetailModal";
import { QuickSpellDialog } from "./CharacterDisplay/sections/Equipment/QuickSpellDialog";
import { SpellsDialog } from "./CharacterDisplay/sections/Spells/SpellsDialog";
import { CurrencyDialog } from "./CharacterDisplay/sections/Currency/CurrencyDialog";
import { ClassFeaturesDialog } from "./CharacterDisplay/sections/ClassFeatures/ClassFeaturesDialog";
import { ProficiencyHelpDialog } from "./CharacterDisplay/sections/Info/ProficiencyHelpDialog";
import { StatBreakdownDialog, type StatBreakdownData } from "./CharacterDisplay/sections/Info/StatBreakdownDialog";
import { RaceInfoDialog } from "./CharacterDisplay/sections/Info/RaceInfoDialog";
import { ClassInfoDialog } from "./CharacterDisplay/sections/Info/ClassInfoDialog";
import { BackgroundInfoDialog } from "./CharacterDisplay/sections/Info/BackgroundInfoDialog";
import { AlignmentInfoDialog } from "./CharacterDisplay/sections/Info/AlignmentInfoDialog";
import { DeityInfoDialog } from "./CharacterDisplay/sections/Info/DeityInfoDialog";
import { EnhancedLevelUpModal } from "./EnhancedLevelUpModal";
import { LevelDownConfirmDialog } from "./LevelDownConfirmDialog";
import { ResetToLevel1ConfirmDialog } from "./ResetToLevel1ConfirmDialog";
import { SkillsSection } from "./CharacterDisplay/sections/Info/SkillsSection";
import { AppearanceSection } from "./CharacterDisplay/sections/Info/AppearanceSection";
import { PersonalityInfoSection } from "./CharacterDisplay/sections/Info/PersonalityInfoSection";
import { BackstorySection } from "./CharacterDisplay/sections/Info/BackstorySection";
import type { Character, AbilityScores, EquipmentItem, Currency } from "./CharacterDisplay/types/Character";
import { CharacterProvider } from "./CharacterDisplay/context/CharacterContext";
import { createLogger } from '~/utils/logger';
import { useWebSocket } from "~/hooks/useWebSocket";
import { useMulticlass } from "~/hooks/useMulticlass";
import { apiFetch } from "~/utils/api-client";
import { normalizeSpellList } from "~/utils/spellHelpers";
const logger = createLogger('CharacterDisplay');









// Ability name mapping for Chinese display


interface CharacterDisplayProps {
  character: Character;
  campaignId: string;
  currentMapUrl: string | null;
  userId: string;

  onAvatarUpdated?: () => void;
  isDM?: boolean;
}

export function CharacterDisplay({ character, campaignId, currentMapUrl, userId, onAvatarUpdated, isDM = false }: CharacterDisplayProps) {
  const authedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    apiFetch(input, { ...init, userId });
  // Helper: Get XP thresholds for current level
  const getXPInfo = () => {
    const currentLevel = character.level || 1;
    const currentXP = character.experience_points || 0;
    const levels = (xpThresholds as any).levels;
    const currentLevelXP = levels[currentLevel.toString()] || 0;
    const nextLevelXP = currentLevel < 20 ? (levels[(currentLevel + 1).toString()] || 0) : currentLevelXP;
    return { currentXP, currentLevelXP, nextLevelXP };
  };

  // Check if character can level up
  const canLevelUp = () => {
    const { currentXP, nextLevelXP } = getXPInfo();
    const currentLevel = character.level || 1;
    return currentLevel < 20 && currentXP >= nextLevelXP;
  };

  // Helper: Get deity name by deity_id
  const getDeityName = () => {
    if (!character.deity_id) return null;
    const pantheons = (godsData as any).pantheons || [];
    for (const pantheon of pantheons) {
      const deity = (pantheon.deities || []).find((d: any) => d.id === character.deity_id);
      if (deity) return deity.name;
    }
    return null;
  };

  // Toast state
  const { showToast } = useToast();

  // Breakdown modal state
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownData, setBreakdownData] = useState<StatBreakdownData | null>(null);

  const [showAppearance, setShowAppearance] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showPersonality, setShowPersonality] = useState(false);
  const [showBackstory, setShowBackstory] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);


  // Spells state

  const [spellDialogOpen, setSpellDialogOpen] = useState(false);
  const [classFeatOpen, setClassFeatOpen] = useState(false);

  // Multiclass support
  const { getClassDisplay, isMulticlassed } = useMulticlass(character);

  // Subscribe to campaign WS for token HP and spell slot updates (works even if map is not open)
  useWebSocket({
    campaignId,
    userId,
    role: isDM ? "dm" : "player",
    onMessage: async (message) => {
      const msgAny = message as any;
      if (message.type === "token_hp_update") {
        // Support both formats: {data: {...}} and top-level fields
        const d = msgAny.data ?? msgAny;
        const character_id = d.character_id;
        const current_hp = d.current_hp;
        const max_hp = d.max_hp;
        const token_id = d.token_id;
        const apply = () => setHpLocal((prev) => ({ current: Number(current_hp ?? prev.current), max: Number(max_hp ?? prev.max) }));
        if (character_id === character.id) {
          apply();
        } else if (!character_id && token_id) {
          // Fallback: resolve token to character to ensure cross-page sync
          try {
            const resp = await authedFetch(`/api/tokens/${token_id}`);
            if (resp.ok) {
              const token = await resp.json();
              if (token?.character_id === character.id) apply();
            }
          } catch {}
        }
      } else if (message.type === "spell_slots_update" || message.type === "spell_slot_consumed") {
        const d = msgAny.data ?? msgAny;
        const character_id = d.character_id;
        const spell_slots_state = d.spell_slots_state ?? d.new_spell_slots_state;
        if (character_id === character.id && Array.isArray(spell_slots_state)) {
          spellSlotsState.setRemainingSlots(spell_slots_state);
        }
      }
    },
  });


  // Info modals state
  const [raceInfoOpen, setRaceInfoOpen] = useState(false);
  const [classInfoOpen, setClassInfoOpen] = useState(false);
  const [backgroundInfoOpen, setBackgroundInfoOpen] = useState(false);
  const [alignmentInfoOpen, setAlignmentInfoOpen] = useState(false);
  const [deityInfoOpen, setDeityInfoOpen] = useState(false);
  const [levelUpOpen, setLevelUpOpen] = useState(false);
  const [levelDownConfirmOpen, setLevelDownConfirmOpen] = useState(false);
  const [resetToLevel1ConfirmOpen, setResetToLevel1ConfirmOpen] = useState(false);

  const [profHelpOpen, setProfHelpOpen] = useState(false);
  const [profHelpType, setProfHelpType] = useState<'weapon' | 'armor'>('weapon');

  // Handle level up
  const handleLevelUp = async (classChoice: string, featureChoices?: any) => {
    try {
      const newLevel = (character.level || 1) + 1;

      console.log('[CharacterDisplay] Level up with choices:', { classChoice, featureChoices });

      // Send level up request to backend (backend will handle HP calculation, etc.)
      const response = await authedFetch(`/api/characters/${character.id}/level-up`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          class_choice: classChoice,
          feature_choices: featureChoices
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[CharacterDisplay] Level up failed:', errorText);
        throw new Error(`Failed to level up character: ${errorText}`);
      }

      const updatedData = await response.json();
      console.log('[CharacterDisplay] Level up successful:', updatedData);

      // Show success message
      showToast(`恭喜升级到 ${newLevel} 级！`, 'success');

      // Close modal
      setLevelUpOpen(false);

      // Refresh character data if callback provided
      if (onAvatarUpdated) {
        onAvatarUpdated(); // This will trigger parent to refresh
      }
    } catch (error) {
      console.error('Level up failed:', error);
      showToast('升级失败，请重试', 'error');
    }
  };

  const handleLevelDown = async () => {
    try {
      const response = await authedFetch(`/api/characters/${character.id}/level-down`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[CharacterDisplay] Level down failed:', errorText);
        throw new Error(`Failed to level down character: ${errorText}`);
      }

      const updatedData = await response.json();
      console.log('[CharacterDisplay] Level down successful:', updatedData);

      // Show success message
      showToast(`已回退到 ${updatedData.level} 级`, 'success');

      // Refresh character data if callback provided
      if (onAvatarUpdated) {
        onAvatarUpdated(); // This will trigger parent to refresh
      }
    } catch (error) {
      console.error('Level down failed:', error);
      showToast('回退失败，请重试', 'error');
    }
  };

  const handleResetToLevel1 = async () => {
    try {
      const response = await authedFetch(`/api/characters/${character.id}/reset-to-level-one`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[CharacterDisplay] Reset to level 1 failed:', errorText);
        throw new Error(`Failed to reset character to level 1: ${errorText}`);
      }

      const updatedData = await response.json();
      console.log('[CharacterDisplay] Reset to level 1 successful:', updatedData);

      // Show success message
      showToast('已恢复到 1 级', 'success');

      // Refresh character data if callback provided
      if (onAvatarUpdated) {
        onAvatarUpdated(); // This will trigger parent to refresh
      }
    } catch (error) {
      console.error('Reset to level 1 failed:', error);
      showToast('恢复失败，请重试', 'error');
    }
  };

  // Load spells dynamically to match SpellSelector
  const [spellsAll, setSpellsAll] = useState<Spell[]>([]);

  useEffect(() => {
    // 从唯一数据源加载法术数据
    import("~/data/rules/spells.json").then(module => {
      const data = module.default as any;
      setSpellsAll(data.spells || []);
      console.log('[CharacterDisplay] Loaded', data.spells?.length || 0, 'spells');
    }).catch(err => {
      console.error('[CharacterDisplay] Failed to load spells:', err);
    });
  }, []);



  // Derived character data via hook
  const { race, subrace, charClass, subclass, background, finalAbilityScores, abilityMods, proficiencyBonus } = useCharacterComputed(character);

  // Skills data

  const allSkills: SkillMeta[] = ((skillsData as { skills?: SkillMeta[] }).skills || []);
  const selectedSkills: string[] =
    (character.selected_skills as string[]) ||
    (character.selectedSkills as string[]) ||
    [];
  const raceChoiceSkills: string[] =
    (character.race_choices?.skills as string[]) ||
    (character.raceChoices?.skills as string[]) ||
    [];
  const subclassChoiceSkillsRaw: string[] =
    (character.subclass_choices?.skill as string[]) ||
    (character.subclass_choices?.skills as string[]) ||
    (character.subclassChoices?.skill as string[]) ||
    (character.subclassChoices?.skills as string[]) ||
    [];
  // 从种族特性中收集固定给予的技能熟练项（如精灵的"敏锐感官"）
  const raceTraitSkills: string[] = useMemo(() => {
    const skills: string[] = [];
    const traits = [...((race as any)?.traits || []), ...((subrace as any)?.traits || [])];
    traits.forEach((t: any) => {
      if (t.skillProficiencies) skills.push(...t.skillProficiencies);
      if (t.structuredData?.skillProficiencies) skills.push(...t.structuredData.skillProficiencies);
    });
    return skills;
  }, [race, subrace]);
  const proficientSet = new Set<string>([
    ...selectedSkills,
    ...raceChoiceSkills,
    ...subclassChoiceSkillsRaw,
    ...raceTraitSkills,
  ]);
  const expertiseSet = new Set<string>(
    (character.expertise_skills as string[]) ||
    (character.expertiseSkills as string[]) ||
    []
  );

  // 检查护甲/盾牌熟练惩罚
  const armorPenalty = useMemo(
    () => checkArmorProficiencyPenalty(character),
    [character.equipment, character.class_id, character.race_id, character.subrace_id, character.subclass_id]
  );

  // Skill name lookup
  const skillsById = new Map<string, string>(allSkills.map((s: SkillMeta) => [s.id, s.name]));


  // Spellcasting helpers for UI only (logic moved into hook)
  const spellcastingAbilityIdForUI = (character.class_id && (spellcastingAbilityMap as Record<string, "intelligence" | "wisdom" | "charisma">)[character.class_id]) || null;
  const spellcastingAbilityLabel = spellcastingAbilityIdForUI ? abilityLabelMap[spellcastingAbilityIdForUI as keyof typeof abilityLabelMap] : "—";
  const spellcastingAbilityScore = spellcastingAbilityIdForUI ? finalAbilityScores[spellcastingAbilityIdForUI] : undefined;
  const spellcastingAbilityMod = spellcastingAbilityIdForUI ? abilityMods[spellcastingAbilityIdForUI] : undefined;

  const calcSkillMod = (skillId: string): number => {
    const meta: SkillMeta | undefined = allSkills.find((s) => s.id === skillId);
    if (!meta) return 0;
    const abil = meta.ability as keyof AbilityScores;
    let mod = abilityMods[abil] ?? 0;
    if (expertiseSet.has(skillId)) mod += derived.proficiencyBonus * 2;
    else if (proficientSet.has(skillId)) mod += derived.proficiencyBonus;
    return mod;
  };

  // ---- Equipment summarizers for slot display & selection lists ----
  // Lookup helpers for weapons and generic equipment metadata (icons, stats)




  const persistCharacterPartial = async (nextEquipment?: EquipmentItem[], nextPreparedSpells?: string[], nextCurrency?: Currency, nextQuickSpells?: (string | null)[]) => {
    try {
      const payload: Partial<{ equipment: EquipmentItem[]; prepared_spells: string[]; currency: Currency; quick_spells: (string | null)[]; broadcast_campaign_id: string }> = {};
      if (nextEquipment !== undefined) payload.equipment = nextEquipment;
      if (nextPreparedSpells !== undefined) payload.prepared_spells = nextPreparedSpells;
      if (nextCurrency !== undefined) payload.currency = nextCurrency;
      if (nextQuickSpells !== undefined) payload.quick_spells = nextQuickSpells;
      if (Object.keys(payload).length === 0) return false;
      if (campaignId) payload.broadcast_campaign_id = campaignId;

      const resp = await authedFetch(`/api/characters/${character.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const t = await resp.text();
        logger.error("Persist character failed:", t);
        alert("保存失败，请查看控制台");
        return false;
      }
      onAvatarUpdated?.(); // 触发父级刷新
      return true;
    } catch (e) {
      logger.error("Persist character error:", e);
      alert("保存失败，请查看控制台");
      return false;
    }
  };




  // Currency state (extracted to hook)
  const { currencyLocal, setCurrencyLocal, currencyDialogOpen, setCurrencyDialogOpen, handleSaveCurrency } = useCurrency({ character, persistCharacterPartial });

  // Map token hook (defined first so we can pass handlePlaceToken to useAvatar)
  const { hasTokenOnMap, placeLoading, placeSuccess, handlePlaceToken } = useMapToken({ character, campaignId, currentMapUrl, userId });

  // Avatar hook - moved below to access equipmentLocal

  // 检查当前地图是否有该角色的 token
  // Spells state and handlers (extracted to hook)
  const {
    isSpellcaster,
    isPreparedCaster,
    knownSpells,
    cantripsLocal,
    preparedLocal,
    preparedMax,
    preparedCount,
    togglePreparedWithLimit,
    setPreparedSpellsAndPersist,
    autoPrepared,
    racialSpellIds,
    racialSpellsData,
    invocationSpellIds,
    invocationSpellsData,
    spellcasting,
    spellSlotsState,
  } = useCharacterSpellcasting({
    character,
    abilityMods,
    proficiencyBonus,
    spellsAll,
    campaignId,
    persistCharacterPartial,
  });


  const spellSaveDCForUI = spellcasting?.spellSaveDC
    ?? (spellcastingAbilityIdForUI ? 8 + proficiencyBonus + (abilityMods[spellcastingAbilityIdForUI] ?? 0) : null);

  const spellAttackStrForUI = spellcasting?.spellAttackStr
    ?? (spellcastingAbilityIdForUI
      ? (() => {
          const bonus = proficiencyBonus + (abilityMods[spellcastingAbilityIdForUI] ?? 0);
          return `${bonus >= 0 ? "+" : ""}${bonus}`;
        })()
      : null);

  const spellSlotsForUI = spellcasting?.spellSlots ?? [];

  // Build spell source map for display (spell ID -> source class)
  const spellSources = useMemo(() => {
    const sources: Record<string, string> = {};
    const defaultSource = character.class_id || 'unknown';

    // Process selected_spells
    const spellSelections = normalizeSpellList(
      character.selected_spells as any,
      1,
      defaultSource
    );
    for (const s of spellSelections) {
      sources[s.id] = s.source || defaultSource;
    }

    // Process selected_cantrips
    const cantripSelections = normalizeSpellList(
      character.selected_cantrips as any,
      1,
      defaultSource
    );
    for (const s of cantripSelections) {
      sources[s.id] = s.source || defaultSource;
    }

    // Mark racial spells
    for (const id of racialSpellIds) {
      sources[id] = 'racial';
    }

    // Mark invocation-granted spells
    for (const id of invocationSpellIds) {
      sources[id] = 'invocation';
    }

    return sources;
  }, [character.selected_spells, character.selected_cantrips, character.class_id, racialSpellIds, invocationSpellIds]);

  // Build racial spell metadata map for SpellsDialog
  const racialSpellMeta = useMemo(() => {
    const meta: Record<string, { usesPerDay?: number; traitName?: string; spellcastingAbility?: string }> = {};
    for (const rs of racialSpellsData) {
      meta[rs.id] = { usesPerDay: rs.usesPerDay, traitName: rs.traitName, spellcastingAbility: rs.spellcastingAbility };
    }
    return meta;
  }, [racialSpellsData]);

  // Build invocation spell metadata map for SpellsDialog
  const invocationSpellMeta = useMemo(() => {
    const meta: Record<string, { invocationName: string; atWill: boolean; usesPerLongRest?: number }> = {};
    for (const is of invocationSpellsData) {
      meta[is.spellId] = { invocationName: is.invocationName, atWill: is.atWill, usesPerLongRest: is.usesPerLongRest };
    }
    return meta;
  }, [invocationSpellsData]);

  // Somatic freedom (War Caster feat) and silenced status for spell casting checks
  const featIds = useMemo(() => (character.feats || []).map((f: any) => typeof f === 'string' ? f : f.id || ''), [character.feats]);
  const hasSomaticFreedom = useMemo(() => getFeatRuleOverrides(featIds).has('somatic_with_hands_full'), [featIds]);
  const isSilenced = useMemo(() => {
    const effects = (character as any).status_effects || (character as any).statusEffects || [];
    return effects.some((e: any) => (e.condition || e.id || e) === 'silenced');
  }, [(character as any).status_effects, (character as any).statusEffects]);

  const {
    equipmentLocal, setEquipmentLocal,
    equipDialogSlot,
    equipDialogOpen, setEquipDialogOpen,
    bagOpen, setBagOpen,
    itemDetailOpen, setItemDetailOpen,
    selectedItem, setSelectedItem,
    splitQty, setSplitQty,
    splitLoading, mergeLoading,
    discardQuantity, setDiscardQuantity, discardLoading,
    organizeLoading, organizedPacks,
    getEquipped,
    backpackWeapons, backpackShield,
    backpackOtherHandheld, backpackLightArmor, backpackMediumArmor, backpackHeavyArmor,
    backpackAmmo, backpackConsumables,
    backpackClothing, backpackAccessory,
    openEquip, applyEquip, applyEquipDirect, toggleGripMode, handleSplitStack, handleMergeStacks,
    handleOrganizePack, handleExtractFromPack, handleDiscardItem,
    // Direct versions for context menu
    splitStackDirect, mergeStacksDirect, discardItemDirect,
    // Container support
    availableContainers, isContainer, getContainerContents,
    handlePutInContainer, handlePutMultipleInContainer, handleTakeOutOfContainer, handleStackItems,
    // Batch operations
    handleBatchTakeOut, handleBatchDiscard, handleBatchMerge,
    // Consumable
    useConsumableDirect,
    // Paper writing
    isPaperItem, handleWriteOnPaper, handleEditWrittenPaper, handleCopyPaper,
  } = useEquipment({ character, campaignId, currentMapUrl, persistCharacterPartial, showToast });

  // Avatar hook (with auto-place token after generation)
  const { genLoading, regenEquipLoading, handleGenerateAvatar, handleUploadAvatar, handleRegenerateWithEquipment } = useAvatar({
    character,
    userId,
    onAvatarUpdated,
    onPlaceToken: handlePlaceToken,
    equipmentLocal,
  });

  // Listen for character equipment/currency updates from map (must be after useEquipment hook)
  useEffect(() => {
    const handleEquipmentUpdate = async (detail: { characterId?: number | string }) => {
      if (detail?.characterId === character.id) {
        try {
          const resp = await authedFetch(`/api/characters/${character.id}`);
          if (resp.ok) {
            const updatedChar = await resp.json();
            setEquipmentLocal(updatedChar.equipment || []);
            setCurrencyLocal(updatedChar.currency || { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
            onAvatarUpdated?.();
          }
        } catch (err) {
          logger.error("Failed to refresh character equipment/currency:", err);
        }
      }
    };

    return subscribeAppEvent('characterEquipmentUpdated', handleEquipmentUpdate);
  }, [character.id, onAvatarUpdated, authedFetch, setEquipmentLocal, setCurrencyLocal]);


  const derived = computeDerivedAll(character, { equipmentOverride: equipmentLocal, hpOptions: { includeFlatSubraceHP: true, includeSubraceLevelBonuses: true } });
  const ac = derived.ac;
  const hp = derived.hp;
  const maxHP = Number((character as any).hit_points_max ?? hp);
  const currentHP = Number((character as any).current_hp ?? (character as any).hit_points_current ?? hp);
  const [hpLocal, setHpLocal] = useState<{ current: number; max: number }>({ current: currentHP, max: maxHP });
  useEffect(() => {
    const handler = ({
      characterId,
      current_hp,
      max_hp,
    }: {
      characterId?: number | string;
      current_hp?: number | null;
      max_hp?: number | null;
    }) => {
      if (characterId === character.id) {
        setHpLocal((prev) => ({ current: Number(current_hp ?? prev.current), max: Number(max_hp ?? prev.max) }));
      }
    };
    return subscribeAppEvent("characterHPUpdated", handler);
  }, [character.id]);
  // keep in sync if props change (e.g., initial load)
  useEffect(() => {
    setHpLocal({ current: currentHP, max: maxHP });
  }, [currentHP, maxHP]);

  // Listen for character level changes (level up/down)
  useEffect(() => {
    const handler = (_detail: any) => {
      console.log('[CharacterDisplay] Character level changed, refreshing data');
      // Refresh character data
      if (onAvatarUpdated) {
        onAvatarUpdated();
      }
    };
    return subscribeAppEvent("characterLevelChanged", handler);
  }, [onAvatarUpdated]);


  // 快捷法术状态 - 从角色数据初始化
  const [quickSpells, setQuickSpells] = useState<(string | null)[]>(
    () => (character as any).quick_spells || [null, null, null, null]
  );
  const [quickSpellDialogOpen, setQuickSpellDialogOpen] = useState(false);
  const [quickSpellSlotIndex, setQuickSpellSlotIndex] = useState<number | null>(null);

  // 同步角色数据变化
  useEffect(() => {
    const charQuickSpells = (character as any).quick_spells;
    if (charQuickSpells) {
      setQuickSpells(charQuickSpells);
    }
  }, [character.id, (character as any).quick_spells]);

  const handleQuickSpellClick = (slotIndex: number) => {
    setQuickSpellSlotIndex(slotIndex);
    setQuickSpellDialogOpen(true);
  };

  const handleSelectQuickSpell = async (slotIndex: number, spellId: string | null) => {
    const newQuickSpells = [...quickSpells];
    newQuickSpells[slotIndex] = spellId;
    setQuickSpells(newQuickSpells);
    // 持久化到后端
    await persistCharacterPartial(undefined, undefined, undefined, newQuickSpells);
  };

  const getHPColorClass = (current: number, max: number) => {
    if (!max || max <= 0) return "text-gray-300";
    const percent = (current / max) * 100;
    if (percent > 70) return "text-green-400";
    if (percent > 30) return "text-yellow-400";
    return "text-red-400";
  };
  const initiative = abilityModNumber(derived.finalAbilityScores.dexterity);

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
      <div className="border border-gray-700 rounded-lg p-4 space-y-4">
      {/* Header with Avatar */}
      <div className="flex items-start gap-4">
        {character.avatar ? (
          <button
            onClick={() => setAvatarModalOpen(true)}
            className="w-20 h-20 rounded-lg overflow-hidden border-2 border-amber-400 hover:border-amber-300 transition-colors flex-shrink-0"
          >
            <img
              src={character.avatar}
              alt={character.name}
              className="w-full h-full object-cover"
            />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setAvatarModalOpen(true)}
            className="w-20 h-20 rounded-lg bg-gray-800 border-2 border-gray-600 hover:border-amber-300 transition-colors flex items-center justify-center flex-shrink-0"
          >
            <span className="text-gray-500 text-xs">无头像</span>
          </button>
        )}
        <div className="flex-1">
          {/* Line 1: Name */}
          <h4 className="text-xl font-semibold text-amber-400">{character.name}</h4>

          {/* Line 2: Gender, Race, Class */}
          <div className="text-sm text-gray-400 flex items-center gap-2 flex-wrap mt-1">
            {character.gender && (
              <>
                <span>{character.gender}</span>
                <span>•</span>
              </>
            )}
            <button
              className="hover:text-blue-300 hover:underline transition-colors"
              onClick={() => setRaceInfoOpen(true)}
              title="点击查看种族详情"
            >
              {race?.name}{subrace ? ` (${subrace.name})` : ""}
            </button>
            <span>•</span>
            <button
              className="hover:text-amber-300 hover:underline transition-colors"
              onClick={() => setClassInfoOpen(true)}
              title="点击查看职业详情"
            >
              {isMulticlassed ? (
                <span className="text-purple-400">{getClassDisplay()}</span>
              ) : (
                <span>{charClass?.name}{subclass ? ` (${subclass.name})` : ""}</span>
              )}
            </button>
          </div>

          {/* Line 3: Background, Alignment, Deity */}
          <div className="text-xs text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
            {background && (
              <>
                <button
                  className="hover:text-gray-300 hover:underline transition-colors"
                  onClick={() => setBackgroundInfoOpen(true)}
                  title="点击查看背景详情"
                >
                  {background.name}
                </button>
                <span>•</span>
              </>
            )}
            {character.alignment && (
              <>
                <button
                  className="hover:text-gray-300 hover:underline transition-colors"
                  onClick={() => setAlignmentInfoOpen(true)}
                  title="点击查看阵营详情"
                >
                  {formatAlignment(character.alignment)}
                </button>
                {(() => {
                  const deityName = getDeityName();
                  if (deityName) return <span>•</span>;
                  return null;
                })()}
              </>
            )}
            {(() => {
              const deityName = getDeityName();
              if (deityName) {
                return (
                  <span>
                    信仰{" "}
                    <button
                      className="text-amber-300 hover:text-amber-200 hover:underline transition-colors"
                      onClick={() => setDeityInfoOpen(true)}
                      title="点击查看神祇详情"
                    >
                      {deityName}
                    </button>
                  </span>
                );
              }
              return null;
            })()}
          </div>

          {/* Line 4: Level, Experience */}
          <div className="text-xs text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
            <span>{character.level}级</span>
            {(() => {
              const { currentXP, nextLevelXP } = getXPInfo();
              return (
                <>
                  <span>•</span>
                  <span>
                    经验 <span className="text-white font-medium">{currentXP}</span>
                    {character.level < 20 && (
                      <span className="text-gray-500">/{nextLevelXP}</span>
                    )}
                  </span>
                  {canLevelUp() && (
                    <>
                      <span>•</span>
                      <button
                        className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded font-semibold animate-pulse"
                        onClick={() => setLevelUpOpen(true)}
                      >
                        🎉 升级
                      </button>
                    </>
                  )}
                  {(character.level || 1) > 1 && (
                    <>
                      <span>•</span>
                      <button
                        className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded font-semibold"
                        onClick={() => setLevelDownConfirmOpen(true)}
                        title="回退到上一级"
                      >
                        ↩️ 回退
                      </button>
                      <span>•</span>
                      <button
                        className="px-2 py-0.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded font-semibold"
                        onClick={() => setResetToLevel1ConfirmOpen(true)}
                        title="恢复到1级"
                      >
                        🔄 恢复1级
                      </button>
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>
      {/* Token actions */}
      <div className="space-y-2">
        {!character.avatar ? (
          <button
            className="w-full btn-primary text-sm py-2"
            onClick={() => handleGenerateAvatar()}
            disabled={genLoading}
          >
            {genLoading ? "生成中..." : "AI生成头像"}
          </button>
        ) : (
          <>
            {!hasTokenOnMap && (
              <div className="flex gap-2">
                <button
                  className="flex-1 btn-primary text-[11px] py-1 px-2"
                  onClick={handlePlaceToken}
                  disabled={!currentMapUrl || placeLoading}
                  title={currentMapUrl ? "将头像作为Token放置到当前地图" : "当前无地图"}
                >
                  {placeLoading ? "放置中..." : "生成到战役地图"}
                </button>
              </div>
            )}
            {/* 成功提示 */}
            {placeSuccess && (
              <div className="text-sm text-green-400 bg-green-900/30 px-3 py-2 rounded border border-green-700">
                ✓ 已将头像放置到战役地图
              </div>
            )}
          </>
        )}
      </div>


      {/* Combat Stats - Compact Style */}
      <div className="grid grid-cols-4 gap-2">
        <button
          className="bg-gray-800/50 rounded p-1 text-center hover:ring-1 ring-amber-400 cursor-pointer"
          onClick={() => {
            const b = getACBreakdown(character, { equipmentOverride: equipmentLocal });
            setBreakdownData({ title: "护甲等级 (AC)", final: b.final, items: b.items, description: "AC代表你有多难被击中。敌人的攻击骰结果≥你的AC才能命中你。穿护甲、持盾牌、敏捷高都能提升AC。无护甲时AC = 10 + 敏捷调整值。" });
            setBreakdownOpen(true);
          }}
        >
          <div className="text-[9px] text-gray-500">AC</div>
          <div className="text-sm font-bold text-blue-400">{ac}</div>
        </button>
        <button
          className="bg-gray-800/50 rounded p-1 text-center hover:ring-1 ring-amber-400 cursor-pointer"
          onClick={() => {
            const b = getInitiativeBreakdown(character);
            setBreakdownData({ title: "先攻", final: b.final, items: b.items, unit: "+", description: "先攻决定战斗中的行动顺序。战斗开始时每人掷1d20+先攻加值，结果高的先行动。先攻加值 = 敏捷调整值。" });
            setBreakdownOpen(true);
          }}
        >
          <div className="text-[9px] text-gray-500">先攻</div>
          <div className="text-sm font-bold text-amber-400">{initiative}</div>
        </button>
        <button
          className="bg-gray-800/50 rounded p-1 text-center hover:ring-1 ring-amber-400 cursor-pointer"
          onClick={() => {
            const b: any = getHitDiceBreakdown(character);
            setBreakdownData({ title: "生命骰", final: b.final, items: b.items, unit: "dice", diceSize: (b as any).diceSize, description: "生命骰用于短休息时恢复生命值。短休时你可以掷生命骰（加体质调整值）来回血。骰面由职业决定（如战士d10、法师d6），骰子数量等于你的等级。长休后恢复一半已用的生命骰。" });
            setBreakdownOpen(true);
          }}
        >
          <div className="text-[9px] text-gray-500">生命骰</div>
          {(() => {
            const b: any = getHitDiceBreakdown(character);
            return <div className="text-sm font-bold text-white">{b.final}d{b.diceSize ?? 0}</div>;
          })()}
        </button>
        <button
          className="bg-gray-800/50 rounded p-1 text-center hover:ring-1 ring-amber-400 cursor-pointer"
          onClick={() => {
            const b = getProficiencyBonusBreakdown(character.level || 1);
            setBreakdownData({ title: "熟练加值", final: b.final, items: b.items, unit: "+", description: "熟练加值加到你擅长的技能检定、攻击骰和豁免检定上。1级时为+2，之后每4级增加1（5级+3，9级+4…最高20级+6）。" });
            setBreakdownOpen(true);
          }}
        >
          <div className="text-[9px] text-gray-500">熟练</div>
          <div className="text-sm font-bold text-purple-400">+{derived.proficiencyBonus}</div>
        </button>
      </div>
      {/* Extra: HP & Spellcasting stats */}
      <div className="grid grid-cols-3 gap-2 mt-1">
        <button
          className="bg-gray-800/50 rounded p-1 text-center hover:ring-1 ring-amber-400 cursor-pointer"
          onClick={() => {
            const b = getHPBreakdown(character, { includeFlatSubraceHP: true, includeSubraceLevelBonuses: true });
            setBreakdownData({ title: "生命值 (HP)", final: b.final, items: b.items });
            setBreakdownOpen(true);
          }}
        >
          <div className="text-[9px] text-gray-500">HP</div>
          <div className={`text-sm font-bold ${getHPColorClass(hpLocal.current, hpLocal.max)}`}>
            {hpLocal.current}/{hpLocal.max}
          </div>
        </button>
        <button
          className="bg-gray-800/50 rounded p-1 text-center hover:ring-1 ring-amber-400 cursor-pointer"
          onClick={() => {
            const b = getSpellSaveDCBreakdown(character);
            setBreakdownData({ title: "法术豁免DC", final: b.final, items: b.items });
            setBreakdownOpen(true);
          }}
        >
          <div className="text-[9px] text-gray-500">法术DC</div>
          <div className="text-sm font-bold text-white">{getSpellSaveDCBreakdown(character).final}</div>
        </button>
        <button
          className="bg-gray-800/50 rounded p-1 text-center hover:ring-1 ring-amber-400 cursor-pointer"
          onClick={() => {
            const b = getSpellAttackBonusBreakdown(character);
            setBreakdownData({ title: "法术攻击加值", final: b.final, items: b.items, unit: "+" });
            setBreakdownOpen(true);
          }}
        >
          <div className="text-[9px] text-gray-500">法术攻击</div>
          <div className="text-sm font-bold text-white">+{getSpellAttackBonusBreakdown(character).final}</div>
        </button>
      </div>


      {/* Ability Scores - Compact Style */}
      <div>
        <h5 className="text-xs font-semibold text-gray-300 mb-1.5">属性值</h5>
        <div className="grid grid-cols-6 gap-1">
          {Object.entries(finalAbilityScores).map(([key, value]: [string, number]) => {
            const k = key as keyof AbilityScores;
            const racialBonus = Number(finalAbilityScores[k] ?? 0) - Number((character as any).ability_scores?.[k] ?? (character as any).abilityScores?.[k] ?? 0);
            return (
              <button
                key={key}
                className="bg-gray-900/50 rounded p-1 text-center hover:ring-1 ring-amber-400 cursor-pointer"
                onClick={() => {
                  const b = getAbilityScoreBreakdown(character, k as any);
                  const labelMap: Record<string, string> = { strength: "力量", dexterity: "敏捷", constitution: "体质", intelligence: "智力", wisdom: "感知", charisma: "魅力" };
                  setBreakdownData({ title: `属性：${labelMap[k]}`, final: value, items: b.items });
                  setBreakdownOpen(true);
                }}
              >
                <div className="text-[10px] text-gray-500 uppercase">{key.slice(0, 3)}</div>
                <div className="text-sm font-bold text-white">
                  {value}
                  {racialBonus > 0 && (
                    <span className="text-[9px] text-green-400 ml-0.5">(+{racialBonus})</span>
                  )}
                </div>

                <div className="text-[10px] text-amber-400">{abilityModNumber(value as number)}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Collapsible Sections */}
      {/* Equipment (non-collapsible) */}
      <div>
        <EquipmentPanel
          setSpellDialogOpen={setSpellDialogOpen}
          setClassFeatOpen={setClassFeatOpen}
          setBagOpen={setBagOpen}
          openEquip={openEquip}
          getEquipped={getEquipped}
          isSpellcaster={isSpellcaster}
          isPreparedCaster={isPreparedCaster}
          spellsAll={spellsAll}
          cantripsLocal={cantripsLocal}
          knownSpells={knownSpells}
          preparedLocal={preparedLocal}
          quickSpells={quickSpells}
          onQuickSpellClick={handleQuickSpellClick}
        />
      </div>


      {/* Currency Panel (moved into backpack; hidden here) */}
      <div className="mb-3 hidden">
        <div className="flex items-center justify-between mb-2">
          <h5 className="text-sm font-semibold text-gray-300">钱币</h5>
          <button
            className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
            onClick={() => setCurrencyDialogOpen(true)}
          >
            编辑
          </button>
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-gray-200">
          <div>GP：<span className="text-white font-semibold">{(currencyLocal?.gp ?? 0)}</span></div>
          <div>SP：<span className="text-white font-semibold">{(currencyLocal?.sp ?? 0)}</span></div>
          <div>EP：<span className="text-white font-semibold">{(currencyLocal?.ep ?? 0)}</span></div>
          <div>CP：<span className="text-white font-semibold">{(currencyLocal?.cp ?? 0)}</span></div>
        <CurrencyDialog
          open={currencyDialogOpen}
          onOpenChange={setCurrencyDialogOpen}
          currencyLocal={currencyLocal}
          setCurrencyLocal={setCurrencyLocal}
          handleSaveCurrency={handleSaveCurrency}
        />

          <div>PP：<span className="text-white font-semibold">{(currencyLocal?.pp ?? 0)}</span></div>
        </div>

      </div>

      {/* Equipment selection dialog */}
      <EquipDialog
        open={equipDialogOpen}
        onOpenChange={setEquipDialogOpen}
        slot={equipDialogSlot}
        equipmentLocal={equipmentLocal}
        setEquipmentLocal={setEquipmentLocal}
        getEquipped={getEquipped}
        backpackWeapons={backpackWeapons}
        backpackShield={backpackShield}
        backpackOtherHandheld={backpackOtherHandheld}
        backpackLightArmor={backpackLightArmor}
        backpackMediumArmor={backpackMediumArmor}
        backpackHeavyArmor={backpackHeavyArmor}
        backpackAmmo={backpackAmmo}
        backpackConsumables={backpackConsumables}
        backpackClothing={backpackClothing}
        backpackAccessory={backpackAccessory}
        applyEquip={applyEquip}
        setProfHelpOpen={setProfHelpOpen}
        setProfHelpType={setProfHelpType}
      />

      {/* Quick spell selection dialog */}
      <QuickSpellDialog
        open={quickSpellDialogOpen}
        onOpenChange={setQuickSpellDialogOpen}
        slotIndex={quickSpellSlotIndex}
        spellsAll={spellsAll}
        cantripsLocal={cantripsLocal}
        preparedLocal={preparedLocal}
        quickSpells={quickSpells}
        onSelectSpell={handleSelectQuickSpell}
      />





      {/* Backpack dialog */}
      <BagDialog
        open={bagOpen}
        onOpenChange={setBagOpen}
        setCurrencyDialogOpen={setCurrencyDialogOpen}
        currencyLocal={currencyLocal}
        equipmentLocal={equipmentLocal}
        openEquip={openEquip}
        getEquipped={getEquipped}
        applyEquip={applyEquipDirect}
        onEquipmentUpdate={async (items, currency) => {
          setEquipmentLocal(items);
          setCurrencyLocal(currency);
          await persistCharacterPartial(items, undefined, currency);
        }}
        isContainer={isContainer}
        getContainerContents={getContainerContents}
        handlePutInContainer={handlePutInContainer}
        handlePutMultipleInContainer={handlePutMultipleInContainer}
        handleTakeOutOfContainer={handleTakeOutOfContainer}
        handleStackItems={handleStackItems}
        handleSplitStack={splitStackDirect}
        handleMergeStacks={mergeStacksDirect}
        handleDiscardItem={discardItemDirect}
        handleBatchTakeOut={handleBatchTakeOut}
        handleBatchDiscard={handleBatchDiscard}
        handleBatchMerge={handleBatchMerge}
        hasTokenOnMap={hasTokenOnMap}
        onToggleGrip={toggleGripMode}
        onRegenerateAvatar={handleRegenerateWithEquipment}
        avatarRegenerating={regenEquipLoading}
        onUseConsumable={async (item) => {
          await useConsumableDirect(item, hpLocal.current, hpLocal.max, setHpLocal);
        }}
        onCurrencyDropToMap={async (type, amount) => {
          if (!currentMapUrl || !campaignId) {
            showToast("无法丢弃：缺少地图信息", "error");
            return;
          }
          try {
            // Get character token position
            const tokensResp = await authedFetch(`/api/tokens/campaign/${campaignId}/map?map_url=${encodeURIComponent(currentMapUrl)}`);
            if (!tokensResp.ok) throw new Error("Failed to fetch tokens");
            const tokensData = await tokensResp.json();
            const charToken = (tokensData.tokens || []).find((t: any) => t.character_id === character.id);
            if (!charToken) {
              showToast("角色尚未放置到地图上", "error");
              return;
            }

            // Find empty position
            const findEmptyPos = (baseX: number, baseY: number, existing: any[]) => {
              const offsets = [[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1],[2,0],[0,2]];
              const used = new Set<string>((existing || []).map((t: any) => `${t.position_x},${t.position_y}`));
              for (const [dx,dy] of offsets) {
                const nx = baseX + dx, ny = baseY + dy;
                if (!used.has(`${nx},${ny}`)) return { x: nx, y: ny };
              }
              return { x: baseX + 1, y: baseY };
            };
            const emptyPos = findEmptyPos(charToken.position_x, charToken.position_y, tokensData.tokens);

            // Currency display info
            const currencyInfo: Record<string, { name: string; icon: string }> = {
              pp: { name: '铂金币', icon: getAssetUrl('assets/equipment-icons/coin_platinum.png') },
              gp: { name: '金币', icon: getAssetUrl('assets/equipment-icons/coin_gold.png') },
              ep: { name: '银电币', icon: getAssetUrl('assets/equipment-icons/coin_electrum.png') },
              sp: { name: '银币', icon: getAssetUrl('assets/equipment-icons/coin_silver.png') },
              cp: { name: '铜币', icon: getAssetUrl('assets/equipment-icons/coin_copper.png') },
            };
            const info = currencyInfo[type] || { name: type.toUpperCase(), icon: '' };

            // Create token
            const tokenPayload = {
              campaign_id: campaignId,
              item_data: {
                id: `currency_${type}`,
                name: info.name,
                icon: info.icon ? (info.icon.startsWith('http') ? info.icon : `${window.location.origin}${info.icon}`) : null,
                currencyType: type,
              },
              item_quantity: amount,
              user_id: character.user_id,
              map_url: currentMapUrl,
              position_x: emptyPos.x,
              position_y: emptyPos.y,
              token_size: "0.5x0.5",
              instance_name: `${info.name} ×${amount}`,
            };

            const createResp = await authedFetch("/api/tokens/", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(tokenPayload),
            });
            if (!createResp.ok) throw new Error("Failed to create currency token");

            // Update currency
            const current = currencyLocal?.[type] ?? 0;
            const newCurrency = { ...currencyLocal, [type]: current - amount };
            setCurrencyLocal(newCurrency);
            await persistCharacterPartial(equipmentLocal, undefined, newCurrency);
            showToast(`已丢弃 ${info.name} ×${amount}`, "success");
          } catch (e) {
            console.error('Currency drop error:', e);
            showToast("丢弃金币失败", "error");
          }
        }}
        isPaperItem={isPaperItem}
        onWriteOnPaper={handleWriteOnPaper}
        onEditWrittenPaper={handleEditWrittenPaper}
        onCopyPaper={handleCopyPaper}
      />


























      {/* Item Detail Modal */}
      <ItemDetailModal
        open={itemDetailOpen}
        onOpenChange={setItemDetailOpen}
        selectedItem={selectedItem}
        setProfHelpType={setProfHelpType}
        setProfHelpOpen={setProfHelpOpen}
        organizedPacks={selectedItem ? (organizedPacks[selectedItem.id] || []) : []}
        organizeLoading={organizeLoading}
        handleOrganizePack={async () => { if (selectedItem) { await handleOrganizePack(selectedItem); } }}
        handleExtractFromPack={(extractedItem) => { if (selectedItem) { void handleExtractFromPack(selectedItem, extractedItem); } }}
        splitQty={splitQty}
        setSplitQty={setSplitQty}
        handleSplitStack={handleSplitStack}
        splitLoading={splitLoading}
        handleMergeStacks={handleMergeStacks}
        mergeLoading={mergeLoading}
        discardQuantity={discardQuantity}
        setDiscardQuantity={setDiscardQuantity}
        hasTokenOnMap={hasTokenOnMap}
        discardLoading={discardLoading}
        handleDiscardItem={handleDiscardItem}
        currentMapUrl={currentMapUrl}
      />










































      {/* Spells modal */}

      {(isSpellcaster || racialSpellIds.length > 0) && (
        <SpellsDialog
          open={spellDialogOpen}
          onOpenChange={setSpellDialogOpen}
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
          spellSources={spellSources}
          racialSpellMeta={racialSpellMeta}
          invocationSpellMeta={invocationSpellMeta}
          spellcastingAbilityLabel={spellcastingAbilityLabel}
          spellcastingAbilityScore={spellcastingAbilityScore}
          spellcastingAbilityMod={spellcastingAbilityMod}
          spellcastingAbilityId={spellcasting?.abilityId ?? spellcastingAbilityIdForUI}
          spellcasterType={spellcasting?.type ?? null}
          spellSaveDC={spellSaveDCForUI}
          spellAttackStr={spellAttackStrForUI}
          spellSlots={spellSlotsForUI}
          remainingSlots={spellSlotsState.remainingSlots}
          autoPrepared={autoPrepared}
          onConsumeSlot={spellSlotsState.consumeSlot}
          canPrepareSpells={spellSlotsState.canPrepareSpells}
          onPreparationFinished={spellSlotsState.markPreparationUsed}
          eldritchInvocations={
            ((character as any).eldritch_invocations || (character as any).eldritchInvocations || [])
              .map((i: any) => typeof i === 'string' ? i : i.value || i.id || '')
          }
          charismaMod={abilityMods.charisma ?? 0}
          subclassId={(character as any).subclass_id || (character as any).subclassId}
          equipment={equipmentLocal}
          isSilenced={isSilenced}
          hasSomaticFreedom={hasSomaticFreedom}
        />
      )}

      <ClassFeaturesDialog
        open={classFeatOpen}
        onOpenChange={setClassFeatOpen}
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


      {/* Class features modal */}




      {/* Skills (moved above Appearance) */}
      <SkillsSection
        open={showSkills}
        onOpenChange={setShowSkills}
        allSkills={allSkills}
        calcSkillMod={calcSkillMod}
        proficientSet={proficientSet}
        expertiseSet={expertiseSet}
        armorPenalty={armorPenalty}
      />


      {/* Appearance */}
      {character.appearance && (
        <AppearanceSection
          open={showAppearance}
          onOpenChange={setShowAppearance}
          appearance={character.appearance}
        />
      )}

      {/* Personality */}
      {character.personality && (
        <PersonalityInfoSection
          open={showPersonality}
          onOpenChange={setShowPersonality}
          personality={character.personality}
        />
      )}







      {/* Backstory */}
      {character.backstory && (
        <BackstorySection
          open={showBackstory}
          onOpenChange={setShowBackstory}
          backstory={character.backstory}
        />
      )}

      {/* Avatar Modal */}
      <AvatarModal
        open={avatarModalOpen}
        onOpenChange={setAvatarModalOpen}
        character={character}
        userId={userId}
        genLoading={genLoading}
        handleGenerateAvatar={handleGenerateAvatar}
        handleUploadAvatar={handleUploadAvatar}
        onAvatarUpdated={onAvatarUpdated}
      />

      {/* Proficiency Help Modal */}
      <ProficiencyHelpDialog open={profHelpOpen} onOpenChange={setProfHelpOpen} type={profHelpType} />


      {/* Race Info Modal */}
      <RaceInfoDialog open={raceInfoOpen} onOpenChange={setRaceInfoOpen} race={race} subrace={subrace} />

      {/* Class Info Modal */}
      <ClassInfoDialog
        open={classInfoOpen}
        onOpenChange={setClassInfoOpen}
        character={character}
        charClass={charClass}
        subclass={subclass}
      />

      {/* Background Info Modal */}
      <BackgroundInfoDialog open={backgroundInfoOpen} onOpenChange={setBackgroundInfoOpen} background={background} />

      {/* Alignment Info Modal */}
      <AlignmentInfoDialog open={alignmentInfoOpen} onOpenChange={setAlignmentInfoOpen} currentAlignment={character.alignment || undefined} />

      {/* Deity Info Modal */}
      <DeityInfoDialog open={deityInfoOpen} onOpenChange={setDeityInfoOpen} deityId={character.deity_id || undefined} />

      {/* Level Up Modal */}
      <EnhancedLevelUpModal
        isOpen={levelUpOpen}
        character={character as any}
        newLevel={(character.level || 1) + 1}
        onConfirm={handleLevelUp}
        onCancel={() => setLevelUpOpen(false)}
      />

      {/* Level Down Confirm Dialog */}
      <LevelDownConfirmDialog
        open={levelDownConfirmOpen}
        onOpenChange={setLevelDownConfirmOpen}
        currentLevel={character.level || 1}
        onConfirm={handleLevelDown}
      />

      {/* Reset to Level 1 Confirm Dialog */}
      <ResetToLevel1ConfirmDialog
        open={resetToLevel1ConfirmOpen}
        onOpenChange={setResetToLevel1ConfirmOpen}
        currentLevel={character.level || 1}
        onConfirm={handleResetToLevel1}
      />
      {/* Stat Breakdown Modal */}
      <StatBreakdownDialog open={breakdownOpen} onOpenChange={setBreakdownOpen} data={breakdownData} />
    </div>
    </CharacterProvider>
  );
}
