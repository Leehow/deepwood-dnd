import React, { useState, useEffect, useCallback } from "react";
import { useCharacterContext } from "../../context/CharacterContext";
import { apiFetch } from "~/utils/api-client";
import { getEdgeToEdgeDistance } from "~/components/map/utils/mapCalculations";
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import { mergeTokenItemIntoEquipment, resolveTokenItemImageUrl } from "~/utils/itemTokenData";

interface GroundItemsSectionProps {
  currentMapUrl: string | null;
}

interface GroundItem {
  tokenId: number;
  name: string;
  quantity: number;
  itemData: any;
  iconUrl: string | null;
}

/** Parse token_size like "0.5x0.5" or "2x2" into [w, h] */
function parseTokenSize(size?: string): [number, number] {
  if (!size) return [1, 1];
  const parts = size.split("x").map(Number);
  return [parts[0] || 1, parts[1] || 1];
}

export function GroundItemsSection({ currentMapUrl }: GroundItemsSectionProps) {
  const { character, campaignId, showToast } = useCharacterContext();
  const [groundItems, setGroundItems] = useState<GroundItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickingUp, setPickingUp] = useState<number | null>(null);

  const authedFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) =>
      apiFetch(input, { ...init, userId: character.user_id }),
    [character.user_id]
  );

  const fetchGroundItems = useCallback(async () => {
    if (!currentMapUrl || !campaignId) { setGroundItems([]); return; }
    try {
      const resp = await authedFetch(
        `/api/tokens/campaign/${campaignId}/map?map_url=${encodeURIComponent(currentMapUrl)}`
      );
      if (!resp.ok) return;
      const data = await resp.json();
      const tokens: any[] = data.tokens || [];

      // Find character's token on the map
      const charToken = tokens.find((t: any) => t.character_id === character.id);
      if (!charToken) { setGroundItems([]); return; }

      const [cw, ch] = parseTokenSize(charToken.token_size);

      // Filter item tokens within 1 grid distance
      const items: GroundItem[] = [];
      for (const t of tokens) {
        if (!t.item_data) continue;
        const [tw, th] = parseTokenSize(t.token_size);
        const dist = getEdgeToEdgeDistance(
          charToken.position_x, charToken.position_y, cw, ch,
          t.position_x, t.position_y, tw, th
        );
        if (dist <= 1) {
          items.push({
            tokenId: t.id,
            name: t.item_data.name || t.instance_name || "未知物品",
            quantity: t.item_quantity || 1,
            itemData: t.item_data,
            iconUrl: resolveTokenItemImageUrl(t.item_data) || resolveTokenItemImageUrl({ icon: t.avatar }),
          });
        }
      }
      setGroundItems(items);
    } catch (e) {
      console.error("Failed to fetch ground items:", e);
    }
  }, [currentMapUrl, campaignId, character.id, authedFetch]);

  // Initial fetch
  useEffect(() => { fetchGroundItems(); }, [fetchGroundItems]);

  // Listen for WebSocket token events to refresh
  useEffect(() => {
    const handler = () => fetchGroundItems();
    const unsubscribePlaced = subscribeAppEvent("tokenPlaced", handler);
    const unsubscribeRemoved = subscribeAppEvent("tokenRemoved", handler);
    return () => {
      unsubscribePlaced();
      unsubscribeRemoved();
    };
  }, [fetchGroundItems]);

  const handlePickup = useCallback(async (item: GroundItem) => {
    setPickingUp(item.tokenId);
    try {
      // Fetch latest character data
      const charResp = await authedFetch(`/api/characters/${character.id}`);
      if (!charResp.ok) { showToast?.("无法获取角色信息", "error"); return; }
      const charData = await charResp.json();
      const equipment: any[] = charData.equipment || [];

      const { equipment: newEquipment } = mergeTokenItemIntoEquipment(equipment, item.itemData, item.quantity);

      // Save character
      const saveResp = await authedFetch(`/api/characters/${character.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipment: newEquipment }),
      });
      if (!saveResp.ok) { showToast?.("保存失败", "error"); return; }

      // Delete token
      await authedFetch(`/api/tokens/${item.tokenId}`, { method: "DELETE" });

      // Refresh UI
      publishAppEvent("characterEquipmentUpdated", { characterId: character.id });
      setGroundItems((prev) => prev.filter((g) => g.tokenId !== item.tokenId));
      showToast?.(`捡起 ${item.name} ×${item.quantity}`, "success");
    } catch (e) {
      console.error("Pickup error:", e);
      showToast?.("捡起失败", "error");
    } finally {
      setPickingUp(null);
    }
  }, [character.id, authedFetch, showToast]);

  if (groundItems.length === 0 && !loading) return null;

  return (
    <div className="mt-2 p-2 bg-amber-900/15 border border-amber-700/40 rounded">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-xs font-semibold text-amber-400">地面物品</span>
        <span className="text-[10px] text-gray-500">({groundItems.length})</span>
      </div>
      <div className="space-y-1">
        {groundItems.map((item) => (
          <div
            key={item.tokenId}
            className="flex items-center gap-2 px-2 py-1 bg-gray-800/60 rounded hover:bg-gray-700/60 transition-colors"
          >
            {item.iconUrl ? (
              <img src={item.iconUrl} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
            ) : (
              <div className="w-6 h-6 rounded bg-gray-700 flex items-center justify-center text-[10px] text-gray-400 shrink-0">◆</div>
            )}
            <span className="text-xs text-gray-200 flex-1 truncate">{item.name}</span>
            {item.quantity > 1 && (
              <span className="text-[10px] text-gray-400">×{item.quantity}</span>
            )}
            <button
              className="px-2 py-0.5 text-[11px] bg-amber-600 hover:bg-amber-500 text-white rounded disabled:opacity-50 shrink-0"
              onClick={() => handlePickup(item)}
              disabled={pickingUp === item.tokenId}
            >
              {pickingUp === item.tokenId ? "..." : "捡起"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
