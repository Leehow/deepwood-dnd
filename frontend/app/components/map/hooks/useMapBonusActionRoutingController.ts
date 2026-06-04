import { useCallback } from "react";

import type { Token } from "../types/TacticalMapTypes";
import { dispatchOpenEvent } from "~/utils/openEventBridge";

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

type ActionResourceType = "bonus_action" | "action" | "reaction" | "free";

interface UseMapBonusActionRoutingControllerArgs {
  sourceCharacterData: any;
  showToast: ShowToast;
  clearSelectionContextMenu: () => void;
  handleTransform: (sourceTokenId: number, configId: string) => void;
  handleTargetSaveEffect: (args: {
    action: any;
    execution: any;
    actionResourceType: ActionResourceType;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
    targetTokenId?: number;
  }) => Promise<boolean>;
  openPreserveLifeModal: (action: any, sourceTokenId: number) => void;
  openInvokeDuplicityModal: (args: {
    action: any;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
  }) => void;
  handleWardingFlareAction: (args: any) => Promise<unknown>;
  handleDampenElementsAction: (args: any) => void;
  handleWrathOfTheStormAction: (args: any) => void;
  handleGuidedStrikeAction: (args: any) => Promise<unknown>;
  handleWarGodsBlessingAction: (args: any) => Promise<unknown>;
  handleDestructiveWrathAction: (args: any) => Promise<unknown>;
  openKnowledgeOfTheAgesModal: (args: any) => boolean;
  openVisionsOfThePastModal: (args: any) => boolean;
  handleReadThoughtsAction: (args: any) => Promise<unknown>;
  handleCharmAnimalsAndPlantsAction: (args: any) => Promise<unknown>;
  handleMasterOfNatureAction: (args: any) => Promise<unknown>;
  handleTurnUndeadAction: (args: any) => Promise<unknown>;
  handleCloakOfShadowsAction: (args: any) => Promise<unknown>;
  handleBlessingOfTheTricksterAction: (args: any) => Promise<unknown>;
  handleRadianceOfTheDawnAction: (args: any) => Promise<unknown>;
  handleCoronaOfLightAction: (args: any) => Promise<unknown>;
  knowledgeOfTheAgesFeatureId: string;
}

function getActionText(action: any) {
  return `${action?.id || ""} ${action?.passive_feature_id || ""} ${action?.name || ""}`.toLowerCase();
}

export function useMapBonusActionRoutingController({
  sourceCharacterData,
  showToast,
  clearSelectionContextMenu,
  handleTransform,
  handleTargetSaveEffect,
  openPreserveLifeModal,
  openInvokeDuplicityModal,
  handleWardingFlareAction,
  handleDampenElementsAction,
  handleWrathOfTheStormAction,
  handleGuidedStrikeAction,
  handleWarGodsBlessingAction,
  handleDestructiveWrathAction,
  openKnowledgeOfTheAgesModal,
  openVisionsOfThePastModal,
  handleReadThoughtsAction,
  handleCharmAnimalsAndPlantsAction,
  handleMasterOfNatureAction,
  handleTurnUndeadAction,
  handleCloakOfShadowsAction,
  handleBlessingOfTheTricksterAction,
  handleRadianceOfTheDawnAction,
  handleCoronaOfLightAction,
  knowledgeOfTheAgesFeatureId,
}: UseMapBonusActionRoutingControllerArgs) {
  const handleBonusActionRoute = useCallback(async (args: {
    action: any;
    execution: any;
    actionResourceType: ActionResourceType;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
    targetTokenId?: number;
  }) => {
    const {
      action,
      execution,
      actionResourceType,
      sourceTokenId,
      sourceToken,
      sourceName,
      targetTokenId,
    } = args;

    if (execution.type === "transform") {
      if (sourceToken.transformation_data) {
        showToast(`${sourceName} 已经处于变形状态`, "warning");
        return true;
      }
      handleTransform(sourceTokenId, execution.configId || "wild_shape");
      return true;
    }

    if (execution.openEvent && sourceToken.character_id) {
      const detail = {
        sourceCharacterId: sourceToken.character_id,
        resourceId: action.resourceId,
        execution,
      };
      dispatchOpenEvent(execution.openEvent, detail);
      clearSelectionContextMenu();
      return true;
    }

    if (execution.type === "target_save_effect") {
      await handleTargetSaveEffect({
        action,
        execution,
        actionResourceType,
        sourceTokenId,
        sourceToken,
        sourceName,
        targetTokenId,
      });
      return true;
    }

    if (action.name === "保命通道" || action.name === "Preserve Life" || action.id === "preserve_life") {
      openPreserveLifeModal(action, sourceTokenId);
      return true;
    }

    const actionText = getActionText(action);

    if (
      actionText.includes("invoke_duplicity")
      || action.name === "诡术通道"
      || action.name === "Invoke Duplicity"
    ) {
      openInvokeDuplicityModal({
        action,
        sourceTokenId,
        sourceToken,
        sourceName,
      });
      return true;
    }

    if (actionText.includes("warding_flare") || action.name === "护卫闪光" || action.name === "Warding Flare") {
      await handleWardingFlareAction({
        action,
        sourceTokenId,
        sourceToken,
        sourceName,
        targetTokenId,
      });
      return true;
    }

    if (actionText.includes("dampen_elements") || action.name === "自然之怒" || action.name === "Dampen Elements") {
      handleDampenElementsAction({
        action,
        sourceTokenId,
        sourceToken,
        sourceName,
        targetTokenId,
      });
      return true;
    }

    if (
      actionText.includes("wrath_of_the_storm")
      || action.name === "风暴之怒"
      || action.name === "Wrath of the Storm"
    ) {
      handleWrathOfTheStormAction({
        action,
        sourceTokenId,
        sourceToken,
        sourceName,
        targetTokenId,
      });
      return true;
    }

    if (actionText.includes("guided_strike") || actionText.includes("引导打击")) {
      await handleGuidedStrikeAction({
        action,
        sourceTokenId,
        sourceToken,
        sourceName,
      });
      return true;
    }

    if (actionText.includes("war_gods_blessing") || actionText.includes("战神祝福")) {
      await handleWarGodsBlessingAction({
        action,
        sourceTokenId,
        sourceToken,
        sourceName,
        targetTokenId,
      });
      return true;
    }

    if (
      actionText.includes("destructive_wrath")
      || action.name === "破坏之怒通道"
      || action.name === "Destructive Wrath"
    ) {
      await handleDestructiveWrathAction({
        action,
        sourceTokenId,
        sourceToken,
        sourceName,
      });
      return true;
    }

    if (
      actionText.includes(knowledgeOfTheAgesFeatureId)
      || action.name === "知识通道"
      || action.name === "Knowledge of the Ages"
    ) {
      openKnowledgeOfTheAgesModal({
        action,
        sourceTokenId,
        sourceToken,
        sourceName,
      });
      return true;
    }

    if (
      actionText.includes("visions_of_the_past")
      || action.name === "异象"
      || action.name === "Visions of the Past"
    ) {
      openVisionsOfThePastModal({
        action,
        sourceTokenId,
        sourceToken,
        sourceName,
        targetTokenId,
      });
      return true;
    }

    if (
      actionText.includes("read_thoughts")
      || action.name === "阅读思想"
      || action.name === "Read Thoughts"
    ) {
      await handleReadThoughtsAction({
        action,
        sourceTokenId,
        sourceToken,
        sourceName,
        targetTokenId,
      });
      return true;
    }

    if (
      actionText.includes("charm_animals_and_plants")
      || action.name === "魅惑动植物通道"
      || action.name === "Charm Animals and Plants"
    ) {
      await handleCharmAnimalsAndPlantsAction({
        sourceTokenId,
        sourceToken,
        sourceName,
      });
      return true;
    }

    if (
      actionText.includes("master_of_nature")
      || action.name === "自然大师"
      || action.name === "Master of Nature"
    ) {
      await handleMasterOfNatureAction({
        action,
        sourceTokenId,
        sourceToken,
        sourceName,
      });
      return true;
    }

    if (action.name === "驱散不死生物" || action.name === "Turn Undead" || action.id === "turn_undead") {
      await handleTurnUndeadAction({
        action,
        sourceTokenId,
        sourceToken,
        sourceName,
      });
      return true;
    }

    if (
      sourceCharacterData?.class_id === "cleric"
      && (
        actionText.includes("cloak_of_shadows")
        || action.name === "诡术斗篷"
        || action.name === "Cloak of Shadows"
      )
    ) {
      await handleCloakOfShadowsAction({
        action,
        sourceTokenId,
        sourceToken,
        sourceName,
      });
      return true;
    }

    if (
      actionText.includes("blessing_of_the_trickster")
      || action.name === "诡术祝福"
      || action.name === "Blessing of the Trickster"
    ) {
      await handleBlessingOfTheTricksterAction({
        sourceTokenId,
        sourceToken,
        targetTokenId,
        sourceName,
      });
      return true;
    }

    if (
      actionText.includes("radiance_of_the_dawn")
      || action.name === "光辉通道"
      || action.name === "Radiance of the Dawn"
    ) {
      await handleRadianceOfTheDawnAction({
        sourceTokenId,
        sourceToken,
        sourceName,
      });
      return true;
    }

    if (
      actionText.includes("corona_of_light")
      || action.name === "日冕"
      || action.name === "Corona of Light"
    ) {
      await handleCoronaOfLightAction({
        sourceTokenId,
        sourceToken,
        sourceName,
      });
      return true;
    }

    return false;
  }, [
    clearSelectionContextMenu,
    handleBlessingOfTheTricksterAction,
    handleCharmAnimalsAndPlantsAction,
    handleCloakOfShadowsAction,
    handleCoronaOfLightAction,
    handleDampenElementsAction,
    handleDestructiveWrathAction,
    handleGuidedStrikeAction,
    handleMasterOfNatureAction,
    handleRadianceOfTheDawnAction,
    handleReadThoughtsAction,
    handleTargetSaveEffect,
    handleTransform,
    handleTurnUndeadAction,
    handleWardingFlareAction,
    handleWarGodsBlessingAction,
    handleWrathOfTheStormAction,
    knowledgeOfTheAgesFeatureId,
    openInvokeDuplicityModal,
    openKnowledgeOfTheAgesModal,
    openPreserveLifeModal,
    openVisionsOfThePastModal,
    showToast,
    sourceCharacterData?.class_id,
  ]);

  return { handleBonusActionRoute };
}
