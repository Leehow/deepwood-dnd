import type { Dispatch, SetStateAction } from "react";

import { getFeatRuleOverrides } from "~/components/character/CharacterDisplay/utils/featEffects";
import { UnifiedSpellCastDialog } from "~/components/spell/UnifiedSpellCastDialog";

import type { PlayerSpellDataState } from "./hooks/useMapInteractionController";
import type { Token } from "./types/TacticalMapTypes";
import { findPlayerControlledToken } from "./utils/mapMenuUtils";

export interface PlayerSpellDialogState {
  spell: any;
  selectedCastLevel: number;
}

interface BuildPlayerSpellDialogDataArgs {
  playerSpellData: PlayerSpellDataState;
  sourceCharacterData: any;
  tokens: Token[];
  selectedCharacterId?: number | null;
  userId?: string;
  tokenStatusEffects: Record<number, any[]>;
}

interface MapPlayerSpellDialogProps extends BuildPlayerSpellDialogDataArgs {
  playerSpellDialog: PlayerSpellDialogState | null;
  setPlayerSpellDialog: Dispatch<SetStateAction<PlayerSpellDialogState | null>>;
  campaignId: string;
  handlePlayerSpellDialogCast: (castData: any) => void;
}

export function buildPlayerSpellDialogData({
  playerSpellData,
  sourceCharacterData,
  tokens,
  selectedCharacterId,
  userId,
  tokenStatusEffects,
}: BuildPlayerSpellDialogDataArgs) {
  const spellSlots = new Array(10).fill(0);
  const remainingSlots = new Array(10).fill(0);

  for (const [levelKey, slot] of Object.entries(playerSpellData.spellSlots || {})) {
    const level = Number(levelKey);
    if (!Number.isFinite(level) || level < 0 || level > 9) {
      continue;
    }
    spellSlots[level] = slot?.max || 0;
    remainingSlots[level] = slot?.current ?? slot?.max ?? 0;
  }

  const featIds = (sourceCharacterData?.feats || [])
    .map((feat: any) =>
      typeof feat === "string" ? feat : feat?.value || feat?.id || "",
    )
    .filter(Boolean);
  const playerToken = findPlayerControlledToken(tokens, selectedCharacterId, userId);

  return {
    spellSlots,
    remainingSlots,
    concentrationSpellName: playerToken?.concentration_spell?.spell_name || null,
    castingSpellName: playerToken?.casting_in_progress?.spell_name || null,
    isWarlock: sourceCharacterData?.class_id === "warlock",
    equipment: sourceCharacterData?.equipment || [],
    isSilenced: !!tokenStatusEffects[playerToken?.id || -1]?.some(
      (effect: any) => effect.id === "silenced" || effect.condition === "silenced",
    ),
    hasSomaticFreedom: getFeatRuleOverrides(featIds).has("somatic_with_hands_full"),
  };
}

export function MapPlayerSpellDialog({
  playerSpellDialog,
  setPlayerSpellDialog,
  playerSpellData,
  sourceCharacterData,
  tokens,
  selectedCharacterId,
  userId,
  tokenStatusEffects,
  campaignId,
  handlePlayerSpellDialogCast,
}: MapPlayerSpellDialogProps) {
  if (!playerSpellDialog) {
    return null;
  }

  const dialogData = buildPlayerSpellDialogData({
    playerSpellData,
    sourceCharacterData,
    tokens,
    selectedCharacterId,
    userId,
    tokenStatusEffects,
  });

  return (
    <UnifiedSpellCastDialog
      spell={playerSpellDialog.spell}
      onClose={() => setPlayerSpellDialog(null)}
      spellSlots={dialogData.spellSlots}
      remainingSlots={dialogData.remainingSlots}
      selectedCastLevel={playerSpellDialog.selectedCastLevel}
      onSelectCastLevel={(level) =>
        setPlayerSpellDialog((previous) =>
          previous ? { ...previous, selectedCastLevel: level } : previous,
        )
      }
      concentrationSpellName={dialogData.concentrationSpellName}
      castingSpellName={dialogData.castingSpellName}
      isWarlock={dialogData.isWarlock}
      equipment={dialogData.equipment}
      isSilenced={dialogData.isSilenced}
      hasSomaticFreedom={dialogData.hasSomaticFreedom}
      campaignId={campaignId}
      onCast={(castData) => {
        const selectedLevel =
          castData.spell.level > 0 ? playerSpellDialog.selectedCastLevel : 0;
        handlePlayerSpellDialogCast({ ...castData, level: selectedLevel });
      }}
    />
  );
}
