import { useCallback } from "react";

import {
  broadcastConsumableUsed,
  formatConsumableResult,
  getConsumableData,
  rollConsumableDice,
} from "~/components/character/CharacterDisplay/utils/consumableUtils";
import { publishAppEvent } from "~/events/appEventBus";
import { mergeTokenItemIntoEquipment, serializeItemToTokenData } from "~/utils/itemTokenData";
import { createLogger } from "~/utils/logger";

import type { Token } from "../types/TacticalMapTypes";
import type {
  ContextMenuState,
  MobileActionModalState,
} from "./useMapInteractionController";

const logger = createLogger("useMapInventoryAndPlacementController");

type ShowToastFn = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface UseMapInventoryAndPlacementControllerArgs {
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  campaignId: string;
  currentMapUrl?: string | null;
  userId?: string;
  isDM: boolean;
  contextMenu: ContextMenuState | null;
  mobileActionModal: MobileActionModalState | null;
  tokens: Token[];
  campaignItems?: any[];
  sourceCharacterData: any;
  setSourceCharacterData: React.Dispatch<React.SetStateAction<any>>;
  sendMessage: (payload: any) => void;
  setTokens: React.Dispatch<React.SetStateAction<Token[]>>;
  showToast: ShowToastFn;
}

export function useMapInventoryAndPlacementController({
  authedFetch,
  campaignId,
  currentMapUrl,
  userId,
  isDM,
  contextMenu,
  mobileActionModal,
  tokens,
  campaignItems,
  sourceCharacterData,
  setSourceCharacterData,
  sendMessage,
  setTokens,
  showToast,
}: UseMapInventoryAndPlacementControllerArgs) {
  const resolveGridPosition = useCallback(
    () => contextMenu || mobileActionModal,
    [contextMenu, mobileActionModal],
  );

  const handleUseConsumable = useCallback(async (item: any, sourceTokenId: number) => {
    const consumable = getConsumableData(item);
    if (!consumable) return;

    const token = tokens.find((current) => current.id === sourceTokenId);
    if (!token) return;

    let toastMessage = "";
    let diceResult: ReturnType<typeof rollConsumableDice> | undefined;

    if (consumable.healing) {
      diceResult = rollConsumableDice(consumable.healing.formula);
      const currentHp = token.current_hp ?? 0;
      const maxHp = token.max_hp ?? currentHp;
      const newHp = Math.min(currentHp + diceResult.total, maxHp);
      toastMessage = formatConsumableResult(item.name, consumable, diceResult, {
        before: currentHp,
        after: newHp,
        max: maxHp,
      });

      setTokens((prev) =>
        prev.map((current) =>
          current.id === sourceTokenId ? { ...current, current_hp: newHp } : current,
        ),
      );

      try {
        await authedFetch(`/api/tokens/${sourceTokenId}/hp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ current_hp: newHp }),
        });
      } catch (error) {
        logger.error("[useMapInventoryAndPlacementController] Failed to persist token HP:", error);
      }
    } else {
      toastMessage = formatConsumableResult(item.name, consumable);
    }

    if (consumable.consumed !== false && token.character_id && sourceCharacterData) {
      const equipment = sourceCharacterData.equipment || [];
      const quantity = item.quantity || 1;
      const nextEquipment =
        quantity <= 1
          ? equipment.filter((candidate: any) => !(candidate.id === item.id && candidate.quantity === item.quantity))
          : equipment.map((candidate: any) =>
              candidate.id === item.id && candidate.quantity === item.quantity
                ? { ...candidate, quantity: quantity - 1 }
                : candidate,
            );

      setSourceCharacterData((previous: any) =>
        previous ? { ...previous, equipment: nextEquipment } : previous,
      );

      try {
        await authedFetch(`/api/characters/${token.character_id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ equipment: nextEquipment }),
        });
      } catch (error) {
        logger.error("[useMapInventoryAndPlacementController] Failed to persist equipment:", error);
      }

      publishAppEvent("characterEquipmentUpdated", {
        characterId: token.character_id,
        equipment: nextEquipment,
        needsBroadcast: true,
      });
    }

    const characterName = sourceCharacterData?.name || token.instance_name || "角色";
    void broadcastConsumableUsed(
      authedFetch,
      String(campaignId),
      userId || "",
      isDM ? "dm" : "player",
      characterName,
      item.name,
      toastMessage,
      consumable,
      diceResult,
    );

    showToast(toastMessage, "success");
  }, [
    authedFetch,
    campaignId,
    isDM,
    setSourceCharacterData,
    setTokens,
    showToast,
    sourceCharacterData,
    tokens,
    userId,
  ]);

  const handleSelectionPickupItem = useCallback(async (characterId: number, itemTokenId: number) => {
    try {
      const itemToken = tokens.find((token) => token.id === itemTokenId);
      if (!itemToken || !itemToken.item_data) {
        showToast("无法找到物品", "error");
        return;
      }

      const itemData = itemToken.item_data;
      const itemQuantity = (itemToken as any).item_quantity || 1;
      const itemName = itemToken.instance_name || itemData.name || "物品";

      const characterResponse = await authedFetch(`/api/characters/${characterId}`);
      if (!characterResponse.ok) {
        showToast("无法获取角色信息", "error");
        return;
      }

      const characterData = await characterResponse.json();
      const currentEquipment = characterData.equipment || [];
      const { equipment: updatedEquipment } = mergeTokenItemIntoEquipment(
        currentEquipment,
        itemData,
        itemQuantity,
      );

      const updateResponse = await authedFetch(`/api/characters/${characterId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipment: updatedEquipment }),
      });

      if (!updateResponse.ok) {
        const error = await updateResponse.json();
        showToast(error.detail || "添加物品失败", "error");
        return;
      }

      try {
        const deleteResponse = await authedFetch(`/api/tokens/${itemTokenId}`, { method: "DELETE" });
        if (deleteResponse.ok) {
          setTokens((prev) => prev.filter((token) => token.id !== itemTokenId));
        }
      } catch (error) {
        logger.warn("[useMapInventoryAndPlacementController] Failed to remove picked item token:", error);
      }

      const quantityText = itemQuantity > 1 ? ` x${itemQuantity}` : "";
      showToast(`${characterData.name || "角色"} 捡起了 ${itemName}${quantityText}`, "success");

      sendMessage({
        type: "character_equipment_updated",
        data: {
          character_id: characterId,
          equipment: updatedEquipment,
        },
      });

      publishAppEvent("characterEquipmentUpdated", {
        characterId,
        equipment: updatedEquipment,
      });
    } catch (error) {
      logger.error("[useMapInventoryAndPlacementController] Failed to pick up item:", error);
      showToast("捡起物品失败", "error");
    }
  }, [authedFetch, sendMessage, setTokens, showToast, tokens]);

  const handlePlaceMonster = useCallback(async (monsterId: string, monsterName: string) => {
    const gridPos = resolveGridPosition();
    if (!gridPos || !currentMapUrl) return;

    try {
      const response = await authedFetch("/api/tokens/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId, 10),
          position_x: gridPos.gridX,
          position_y: gridPos.gridY,
          token_size: "1x1",
          monster_instance_id: parseInt(monsterId, 10),
          map_url: currentMapUrl,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("[useMapInventoryAndPlacementController] Failed to place monster:", errorText);
        showToast("放置怪物失败", "error");
        return;
      }

      const newToken = await response.json();
      setTokens((prev) => {
        const exists = prev.some((token) => token.id === newToken.id);
        return exists ? prev : [...prev, newToken];
      });
      showToast(`已放置 ${monsterName}`, "success");
    } catch (error) {
      logger.error("[useMapInventoryAndPlacementController] Failed to place monster:", error);
      showToast("放置怪物失败", "error");
    }
  }, [authedFetch, campaignId, currentMapUrl, resolveGridPosition, setTokens, showToast]);

  const handlePlaceCurrency = useCallback(async (type: string, amount: number) => {
    const gridPos = resolveGridPosition();
    if (!gridPos || !currentMapUrl) return;

    const currencyNames: Record<string, string> = {
      pp: "铂金币",
      gp: "金币",
      ep: "银电币",
      sp: "银币",
      cp: "铜币",
    };
    const currencyIcons: Record<string, string> = {
      pp: "/assets/equipment-icons/coin_platinum.png",
      gp: "/assets/equipment-icons/coin_gold.png",
      ep: "/assets/equipment-icons/coin_electrum.png",
      sp: "/assets/equipment-icons/coin_silver.png",
      cp: "/assets/equipment-icons/coin_copper.png",
    };

    try {
      const response = await authedFetch("/api/tokens/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId, 10),
          position_x: gridPos.gridX,
          position_y: gridPos.gridY,
          token_size: "0.5x0.5",
          item_data: {
            id: `coin_${type}`,
            name: currencyNames[type] || type,
            currencyType: type,
            icon: currencyIcons[type],
          },
          item_quantity: amount,
          map_url: currentMapUrl,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("[useMapInventoryAndPlacementController] Failed to place currency:", errorText);
        showToast("放置钱币失败", "error");
        return;
      }

      const newToken = await response.json();
      setTokens((prev) => {
        const exists = prev.some((token) => token.id === newToken.id);
        return exists ? prev : [...prev, newToken];
      });
      showToast(`已放置 ${currencyNames[type] || type} ×${amount}`, "success");
    } catch (error) {
      logger.error("[useMapInventoryAndPlacementController] Failed to place currency:", error);
      showToast("放置钱币失败", "error");
    }
  }, [authedFetch, campaignId, currentMapUrl, resolveGridPosition, setTokens, showToast]);

  const handlePlaceItem = useCallback(async (itemId: string, itemName: string, icon?: string) => {
    const gridPos = resolveGridPosition();
    if (!gridPos || !currentMapUrl) return;

    try {
      const campaignItem = (campaignItems || []).find(
        (item: any) =>
          String(item.id) === String(itemId) || item.name === itemName || item.name_cn === itemName,
      );
      const serializedCampaignItem = campaignItem
        ? serializeItemToTokenData({
            ...campaignItem,
            name: campaignItem.name_cn || campaignItem.name,
          })
        : null;
      const itemData = campaignItem
        ? {
            ...serializedCampaignItem,
            icon: icon || serializedCampaignItem?.icon,
          }
        : { id: itemId, name: itemName, icon };

      const response = await authedFetch("/api/tokens/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId, 10),
          position_x: gridPos.gridX,
          position_y: gridPos.gridY,
          token_size: "0.5x0.5",
          item_data: itemData,
          item_quantity: 1,
          map_url: currentMapUrl,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("[useMapInventoryAndPlacementController] Failed to place item:", errorText);
        showToast("放置物品失败", "error");
        return;
      }

      const newToken = await response.json();
      setTokens((prev) => {
        const exists = prev.some((token) => token.id === newToken.id);
        return exists ? prev : [...prev, newToken];
      });
      showToast(`已放置 ${itemName}`, "success");
    } catch (error) {
      logger.error("[useMapInventoryAndPlacementController] Failed to place item:", error);
      showToast("放置物品失败", "error");
    }
  }, [authedFetch, campaignId, campaignItems, currentMapUrl, resolveGridPosition, setTokens, showToast]);

  const handlePlaceNPC = useCallback(async (npcId: string, npcName: string) => {
    const gridPos = resolveGridPosition();
    if (!gridPos || !currentMapUrl) return;

    try {
      const response = await authedFetch("/api/tokens/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId, 10),
          position_x: gridPos.gridX,
          position_y: gridPos.gridY,
          token_size: "1x1",
          monster_instance_id: parseInt(npcId, 10),
          map_url: currentMapUrl,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("[useMapInventoryAndPlacementController] Failed to place NPC:", errorText);
        showToast("放置NPC失败", "error");
        return;
      }

      const newToken = await response.json();
      setTokens((prev) => {
        const exists = prev.some((token) => token.id === newToken.id);
        return exists ? prev : [...prev, newToken];
      });
      showToast(`已放置 ${npcName}`, "success");
    } catch (error) {
      logger.error("[useMapInventoryAndPlacementController] Failed to place NPC:", error);
      showToast("放置NPC失败", "error");
    }
  }, [authedFetch, campaignId, currentMapUrl, resolveGridPosition, setTokens, showToast]);

  return {
    handlePlaceCurrency,
    handlePlaceItem,
    handlePlaceMonster,
    handlePlaceNPC,
    handleSelectionPickupItem,
    handleUseConsumable,
  };
}
