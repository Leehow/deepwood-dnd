import type { Dispatch, SetStateAction } from "react";

import { publishAppEvent } from "~/events/appEventBus";

import {
  type SelectionContextMenuState,
  type TargetChestData,
} from "./hooks/useMapInteractionController";
import { SelectionContextMenu } from "./SelectionContextMenu";
import type { Token } from "./types/TacticalMapTypes";
import { buildSelectionCompanionTokens } from "./utils/mapMenuUtils";

interface ReactionAttackPayload {
  reactionId: string;
  sourceTokenId: number;
  targetTokenId: number;
  sourceCharData: any;
  attackOption?: any;
  targetName: string;
  targetAC: number;
  distanceFeet: number;
}

interface MapSelectionMenuLayerProps {
  selectionContextMenu: SelectionContextMenuState | null;
  isDM: boolean;
  campaignId: string;
  userId?: string;
  tokens: Token[];
  sourceMonsterData: any;
  sourceCharacterData: any;
  companionMonsterDataMap: Record<number, any>;
  tokenStatusEffects: Record<number, any[]>;
  pendingManeuvers: Record<number, any>;
  targetChestData: TargetChestData | null;
  gridUnitLength: number;
  globalTerrain: any;
  manualReactionMode: {
    sourceTokenId: number;
    sourceCharacterId?: number | null;
  } | null;
  tokenRollModifier: Record<number, "advantage" | "disadvantage" | null>;
  obscurementZones: any[];
  setTokenRollModifier: Dispatch<
    SetStateAction<Record<number, "advantage" | "disadvantage" | null>>
  >;
  sendMessage: (message: any) => void;
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  setSelectionContextMenu: (value: SelectionContextMenuState | null) => void;
  setSelectedTokenId: (tokenId: number | null) => void;
  setActiveTokenId: (tokenId: number | null) => void;
  setEditingTokenId: (tokenId: number | null) => void;
  setEditingTokenHP: (hp: number) => void;
  setEditingTokenMaxHP: (hp: number | null) => void;
  setManualReactionMode: (
    value: { sourceTokenId: number; sourceCharacterId?: number | null } | null,
  ) => void;
  openTokenPanel: (tokenId: number) => void;
  handleRemoveToken: (tokenId: number) => void;
  handleSelectionMoveTo: (...args: any[]) => void;
  handleSelectionStandardAction: (...args: any[]) => void;
  handleSelectionMonsterAction: (...args: any[]) => void;
  handleAttackAction: (...args: any[]) => void;
  handleSpellAction: (...args: any[]) => void;
  handleBonusAction: (...args: any[]) => void;
  handleManeuverAction: (...args: any[]) => void;
  cancelPendingManeuver: (...args: any[]) => void;
  handleEditEffectDuration: (...args: any[]) => void;
  handleEditActionUses: (...args: any[]) => void;
  handleSelectionPickupItem: (...args: any[]) => void;
  handleRangerAbility: (...args: any[]) => void;
  handleAreaSpellSelect: (...args: any[]) => void;
  handleWildShape: (...args: any[]) => void;
  handleEndWildShape: (...args: any[]) => void;
  handleTransform: (...args: any[]) => void;
  handleEndTransformation: (...args: any[]) => void;
  handleEscapeAttempt: (...args: any[]) => void;
  handleOngoingSave: (...args: any[]) => void;
  handleConditionSave: (...args: any[]) => void;
  handleWakeUp: (...args: any[]) => void;
  handleUseConsumable: (...args: any[]) => void;
  handleOpenToolCheck: (...args: any[]) => void;
  onTrade?: (...args: any[]) => void;
  handleBlindAttack: (...args: any[]) => void;
}

export function MapSelectionMenuLayer({
  selectionContextMenu,
  isDM,
  campaignId,
  userId,
  tokens,
  sourceMonsterData,
  sourceCharacterData,
  companionMonsterDataMap,
  tokenStatusEffects,
  pendingManeuvers,
  targetChestData,
  gridUnitLength,
  globalTerrain,
  manualReactionMode,
  tokenRollModifier,
  obscurementZones,
  setTokenRollModifier,
  sendMessage,
  authedFetch,
  setSelectionContextMenu,
  setSelectedTokenId,
  setActiveTokenId,
  setEditingTokenId,
  setEditingTokenHP,
  setEditingTokenMaxHP,
  setManualReactionMode,
  openTokenPanel,
  handleRemoveToken,
  handleSelectionMoveTo,
  handleSelectionStandardAction,
  handleSelectionMonsterAction,
  handleAttackAction,
  handleSpellAction,
  handleBonusAction,
  handleManeuverAction,
  cancelPendingManeuver,
  handleEditEffectDuration,
  handleEditActionUses,
  handleSelectionPickupItem,
  handleRangerAbility,
  handleAreaSpellSelect,
  handleWildShape,
  handleEndWildShape,
  handleTransform,
  handleEndTransformation,
  handleEscapeAttempt,
  handleOngoingSave,
  handleConditionSave,
  handleWakeUp,
  handleUseConsumable,
  handleOpenToolCheck,
  onTrade,
  handleBlindAttack,
}: MapSelectionMenuLayerProps) {
  void userId;
  if (!selectionContextMenu) {
    return null;
  }

  const companionTokens = buildSelectionCompanionTokens(isDM, selectionContextMenu, tokens);
  const sourceActiveEffects = tokenStatusEffects[selectionContextMenu.sourceToken.id] || [];
  const targetActiveEffects = selectionContextMenu.targetToken
    ? tokenStatusEffects[selectionContextMenu.targetToken.id] || []
    : undefined;
  const pendingManeuver = pendingManeuvers[selectionContextMenu.sourceToken.id] || null;
  const reactionOnlyMode =
    !!manualReactionMode &&
    manualReactionMode.sourceTokenId === selectionContextMenu.sourceToken.id;
  const rollModifier = tokenRollModifier[selectionContextMenu.sourceToken.id] || null;

  const handleSetRollModifier = (
    tokenId: number,
    modifier: "advantage" | "disadvantage" | null,
  ) => {
    setTokenRollModifier((previous) => ({ ...previous, [tokenId]: modifier }));
    sendMessage({
      type: "roll_modifier_update",
      data: { token_id: tokenId, modifier },
    });
  };

  const handleClose = () => {
    setSelectionContextMenu(null);
  };

  const handleDeselect = () => {
    setSelectedTokenId(null);
    setSelectionContextMenu(null);
  };

  const handleViewDetails = (tokenId: number) => {
    if (isDM) {
      openTokenPanel(tokenId);
    } else {
      setActiveTokenId(tokenId);
    }
    setSelectionContextMenu(null);
  };

  const handleEditToken = (tokenId: number) => {
    const token = tokens.find((item) => item.id === tokenId);
    if (token) {
      setEditingTokenId(tokenId);
      setEditingTokenHP(token.current_hp || 0);
      setEditingTokenMaxHP((token as any).max_hp ?? null);
    }
    setSelectionContextMenu(null);
  };

  const handleDeleteToken = (tokenId: number) => {
    handleRemoveToken(tokenId);
    setSelectedTokenId(null);
    setSelectionContextMenu(null);
  };

  const handleLayOnHands = (
    sourceCharacterId: number,
    targetToken: Token,
    distanceFeet: number,
    poolCurrent: number,
    poolMax: number,
  ) => {
    publishAppEvent("layOnHandsTarget", {
      sourceCharacterId,
      targetTokenId: targetToken.id,
      targetName:
        targetToken.instance_name ||
        (targetToken as any).character_name ||
        (targetToken as any).monster_name ||
        "目标",
      targetCurrentHp: targetToken.current_hp,
      targetMaxHp: targetToken.max_hp,
      targetMonsterType: targetToken.monster_type,
      distanceFeet,
      poolCurrent,
      poolMax,
    });
  };

  const handleReactionAttack = async (data: ReactionAttackPayload) => {
    const {
      reactionId,
      sourceTokenId,
      targetTokenId,
      sourceCharData,
      attackOption,
      targetName,
      targetAC,
      distanceFeet,
    } = data;

    try {
      const scores = sourceCharData.ability_scores;
      const body: Record<string, any> = {
        campaign_id: parseInt(campaignId, 10),
        reactor_token_id: sourceTokenId,
        reactor_character_id: sourceCharData.id,
        target_token_id: targetTokenId,
        reaction_id: reactionId,
        category: "attack",
        reactor_name: sourceCharData.name,
        reactor_level: sourceCharData.level || 1,
        reactor_class_id: sourceCharData.class_id,
        reactor_subclass_id: sourceCharData.subclass_id,
        reactor_ability_scores: scores,
        reactor_proficiency_bonus: Math.ceil(1 + (sourceCharData.level || 1) / 4),
        distance_feet: distanceFeet,
        target_data: { name: targetName, ac: targetAC },
      };

      if (attackOption) {
        body.attack = {
          key: attackOption.key,
          name: attackOption.name,
          weapon_name: attackOption.weaponName || attackOption.name,
          damage: attackOption.damage,
          damage_type: attackOption.damageType,
          properties: attackOption.properties,
          normal_range: attackOption.normalRange,
          max_range: attackOption.maxRange,
          weapon_proficient: true,
        };

        const fightingStyle =
          typeof sourceCharData.fighting_style === "string"
            ? sourceCharData.fighting_style
            : sourceCharData.fighting_style?.value;
        body.attacker_data = {
          name: sourceCharData.name,
          level: sourceCharData.level || 1,
          class_id: sourceCharData.class_id,
          race_id: sourceCharData.race_id,
          ability_scores: scores,
          proficiency_bonus: body.reactor_proficiency_bonus,
          crit_range: 20,
          fighting_style: fightingStyle,
        };
      }

      const response = await authedFetch(`/api/combat/reaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        publishAppEvent("combatReactionUsed", {
          reactor_token_id: sourceTokenId,
          reaction_id: reactionId,
        });
        setManualReactionMode(null);
      }
    } catch (error) {
      console.error("[MapSelectionMenuLayer] Reaction attack failed:", error);
    }
  };

  return (
    <SelectionContextMenu
      x={selectionContextMenu.x}
      y={selectionContextMenu.y}
      sourceToken={selectionContextMenu.sourceToken}
      targetToken={selectionContextMenu.targetToken}
      targetGridPos={selectionContextMenu.targetGridPos}
      sourceMonsterData={sourceMonsterData}
      sourceCharacterData={sourceCharacterData}
      companionTokens={companionTokens}
      companionMonsterDataMap={companionMonsterDataMap}
      sourceActiveEffects={sourceActiveEffects}
      targetActiveEffects={targetActiveEffects}
      pendingManeuver={pendingManeuver}
      targetChestData={targetChestData}
      gridUnitLength={gridUnitLength}
      isDM={isDM}
      globalTerrain={globalTerrain}
      reactionOnlyMode={reactionOnlyMode}
      rollModifier={rollModifier}
      onSetRollModifier={handleSetRollModifier}
      onClose={handleClose}
      onDeselect={handleDeselect}
      onViewDetails={handleViewDetails}
      onEditToken={handleEditToken}
      onDeleteToken={handleDeleteToken}
      onMoveTo={handleSelectionMoveTo}
      onStandardAction={handleSelectionStandardAction}
      onMonsterAction={handleSelectionMonsterAction}
      onAttackAction={handleAttackAction}
      onSpellAction={handleSpellAction}
      onBonusAction={handleBonusAction}
      onManeuverAction={handleManeuverAction}
      onCancelManeuver={cancelPendingManeuver}
      onEditEffectDuration={handleEditEffectDuration}
      onEditActionUses={handleEditActionUses}
      onPickupItem={handleSelectionPickupItem}
      onRangerAbility={handleRangerAbility}
      onAreaSpellSelect={handleAreaSpellSelect}
      onWildShape={handleWildShape}
      onEndWildShape={handleEndWildShape}
      onTransform={handleTransform}
      onEndTransformation={handleEndTransformation}
      onEscapeAttempt={handleEscapeAttempt}
      onOngoingSave={handleOngoingSave}
      onConditionSave={handleConditionSave}
      onWakeUp={handleWakeUp}
      onUseConsumable={handleUseConsumable}
      onOpenToolCheck={handleOpenToolCheck}
      onTrade={onTrade}
      onLayOnHands={handleLayOnHands}
      obscurementZones={obscurementZones}
      onBlindAttack={handleBlindAttack}
      onReactionAttack={handleReactionAttack}
    />
  );
}
