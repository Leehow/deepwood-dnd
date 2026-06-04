import { useCallback } from "react";

import { publishAppEvent } from "~/events/appEventBus";
import { mergeTokenItemIntoEquipment } from "~/utils/itemTokenData";
import { createLogger } from "~/utils/logger";

import type { Token } from "../types/TacticalMapTypes";

const logger = createLogger("useMapInventoryController");

interface UseMapInventoryControllerArgs {
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  tokens: Token[];
  userId?: string;
  selectedCharacterId?: number | null;
  setTokens: (updater: (prev: Token[]) => Token[]) => void;
  setLootBagTokenId: (tokenId: number | null) => void;
  showToast: (
    message: string,
    type?: "success" | "error" | "info" | "warning",
    duration?: number,
  ) => void;
}

export function useMapInventoryController({
  authedFetch,
  tokens,
  userId: _userId,
  selectedCharacterId,
  setTokens,
  setLootBagTokenId,
  showToast,
}: UseMapInventoryControllerArgs) {
  const publishEquipmentRefresh = useCallback((characterId: number | string) => {
    publishAppEvent("characterEquipmentUpdated", { characterId });
  }, []);

  const handlePickupItem = useCallback(
    async (tokenId: number, targetCharacterId?: number | string) => {
      const token = tokens.find((candidate) => candidate.id === tokenId);
      if (!token || !token.item_data) {
        showToast("无法捡起物品：缺少必要信息", "error");
        return;
      }

      try {
        let characterId: number | string;

        if (targetCharacterId) {
          characterId = targetCharacterId;
        } else {
          const listResponse = await authedFetch(`/api/characters`);
          if (!listResponse.ok) {
            showToast("无法获取角色列表", "error");
            return;
          }
          const characters = await listResponse.json();
          if (!characters || characters.length === 0) {
            showToast("您还没有角色", "error");
            return;
          }
          characterId = selectedCharacterId || characters[0].id;
        }

        const characterResponse = await authedFetch(`/api/characters/${characterId}`);
        if (!characterResponse.ok) {
          showToast("无法获取角色信息", "error");
          return;
        }
        const character = await characterResponse.json();

        const currencyType = (token.item_data as any).currencyType;
        if (currencyType && ["pp", "gp", "ep", "sp", "cp"].includes(currencyType)) {
          const currency = character.currency || { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
          const amount = token.item_quantity || 1;
          const newCurrency = {
            ...currency,
            [currencyType]: (currency[currencyType] || 0) + amount,
          };

          await authedFetch(`/api/characters/${character.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currency: newCurrency }),
          });

          await authedFetch(`/api/tokens/${tokenId}`, { method: "DELETE" });
          setTokens((prev) => prev.filter((candidate) => candidate.id !== tokenId));
          publishEquipmentRefresh(characterId);

          const currencyNames: Record<string, string> = {
            pp: "铂金币",
            gp: "金币",
            ep: "银电币",
            sp: "银币",
            cp: "铜币",
          };
          showToast(`已捡起 ${currencyNames[currencyType] || currencyType} ×${amount}`, "success");
          return;
        }

        const equipment = character.equipment || [];
        const { equipment: newEquipment } = mergeTokenItemIntoEquipment(
          equipment,
          token.item_data as any,
          token.item_quantity || 1,
        );

        await authedFetch(`/api/characters/${character.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ equipment: newEquipment }),
        });

        await authedFetch(`/api/tokens/${tokenId}`, {
          method: "DELETE",
        });

        setTokens((prev) => prev.filter((candidate) => candidate.id !== tokenId));
        publishEquipmentRefresh(characterId);
        showToast(`已捡起 ${token.item_data.name} ×${token.item_quantity || 1}`, "success");
      } catch (error) {
        logger.error("Pickup item error:", error);
        showToast("捡起物品失败", "error");
        throw error;
      }
    },
    [
      authedFetch,
      publishEquipmentRefresh,
      selectedCharacterId,
      setTokens,
      showToast,
      tokens,
    ],
  );

  const handleDeleteItem = useCallback(
    async (tokenId: number) => {
      try {
        await authedFetch(`/api/tokens/${tokenId}`, {
          method: "DELETE",
        });
        setTokens((prev) => prev.filter((candidate) => candidate.id !== tokenId));
      } catch (error) {
        logger.error("Delete item error:", error);
        throw error;
      }
    },
    [authedFetch, setTokens],
  );

  const handleDeleteShopToken = useCallback(
    async (tokenId: number) => {
      try {
        await authedFetch(`/api/tokens/${tokenId}`, {
          method: "DELETE",
        });
        setTokens((prev) => prev.filter((candidate) => candidate.id !== tokenId));
        showToast("商店 Token 已从地图删除", "success");
      } catch (error) {
        logger.error("Delete shop token error:", error);
        showToast("删除失败", "error");
        throw error;
      }
    },
    [authedFetch, setTokens, showToast],
  );

  const handleLootFromBag = useCallback(
    async (
      tokenId: number,
      characterId: number,
      itemIndices: number[] | null,
      takeCurrency: boolean,
    ) => {
      try {
        const response = await authedFetch(`/api/tokens/loot-bag/${tokenId}/loot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            character_id: characterId,
            item_indices: itemIndices,
            take_currency: takeCurrency,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || "Loot failed");
        }

        const result = await response.json();

        if (result.bag_empty) {
          setTokens((prev) => prev.filter((candidate) => candidate.id !== tokenId));
          setLootBagTokenId(null);
          showToast("战利品已全部拾取", "success");
        } else {
          setTokens((prev) =>
            prev.map((candidate) =>
              candidate.id === tokenId && candidate.loot_bag_data
                ? {
                    ...candidate,
                    loot_bag_data: {
                      ...candidate.loot_bag_data,
                      items: result.remaining_items,
                      currency: result.remaining_currency,
                    },
                  }
                : candidate,
            ),
          );
          showToast("拾取成功", "success");
        }

        publishEquipmentRefresh(characterId);
      } catch (error) {
        logger.error("Loot from bag error:", error);
        showToast("拾取失败: " + (error instanceof Error ? error.message : "未知错误"), "error");
        throw error;
      }
    },
    [authedFetch, publishEquipmentRefresh, setLootBagTokenId, setTokens, showToast],
  );

  const handleDeleteLootBag = useCallback(
    async (tokenId: number) => {
      try {
        await authedFetch(`/api/tokens/loot-bag/${tokenId}`, {
          method: "DELETE",
        });

        setTokens((prev) => prev.filter((candidate) => candidate.id !== tokenId));
        setLootBagTokenId(null);
        showToast("战利品袋已删除", "success");
      } catch (error) {
        logger.error("Delete loot bag error:", error);
        showToast("删除失败", "error");
        throw error;
      }
    },
    [authedFetch, setLootBagTokenId, setTokens, showToast],
  );

  return {
    handleDeleteItem,
    handleDeleteLootBag,
    handleDeleteShopToken,
    handleLootFromBag,
    handlePickupItem,
  };
}
