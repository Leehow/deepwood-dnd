import { useEffect } from "react";

import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import type { Token } from "~/components/map/types/TacticalMapTypes";
import { GRID_SIZE } from "~/components/map/types/TacticalMapTypes";

type RollModifier = "advantage" | "disadvantage" | null;

interface UseMapExternalSyncControllerArgs {
  sourceCharacterData: any;
  setSourceCharacterData: (updater: (previous: any) => any) => void;
  setTokenRollModifier: (
    updater: (previous: Record<number, RollModifier>) => Record<number, RollModifier>,
  ) => void;
  isDM?: boolean;
  tokens?: Token[];
  selectedTokenId?: number | null;
  setSelectedTokenId?: (tokenId: number | null) => void;
  setEditingParamsTokenId?: (tokenId: number | null) => void;
  setTokens?: (updater: (previous: Token[]) => Token[]) => void;
  authedFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  campaignId?: string;
  currentMapUrl?: string | null;
  showToast?: (
    message: string,
    type?: "success" | "error" | "info" | "warning",
    duration?: number,
  ) => void;
  stageSize?: { width: number; height: number };
  stageScale?: number;
  setStagePos?: (value: { x: number; y: number }) => void;
}

export function useMapExternalSyncController({
  sourceCharacterData,
  setSourceCharacterData,
  setTokenRollModifier,
  isDM = false,
  tokens = [],
  selectedTokenId = null,
  setSelectedTokenId,
  setEditingParamsTokenId,
  setTokens,
  authedFetch,
  campaignId,
  currentMapUrl,
  showToast,
  stageSize,
  stageScale,
  setStagePos,
}: UseMapExternalSyncControllerArgs) {
  useEffect(() => {
    const unsubscribe = subscribeAppEvent("classFeatureUsesUpdated", (detail) => {
      const { characterId, featureId, currentUses, maxUses } = detail;
      if (sourceCharacterData?.id === characterId && sourceCharacterData?.actions) {
        setSourceCharacterData((previous: any) => ({
          ...previous,
          actions: previous.actions.map((action: any) =>
            featureId && action.id === featureId && action.uses
              ? { ...action, uses: { ...action.uses, current: currentUses, max: maxUses } }
              : action,
          ),
        }));
      }
    });
    return () => {
      unsubscribe();
    };
  }, [setSourceCharacterData, sourceCharacterData?.actions, sourceCharacterData?.id]);

  useEffect(() => {
    const handleRollModifierUpdate = ({
      tokenId,
      modifier,
    }: {
      tokenId: number;
      modifier: RollModifier;
    }) => {
      if (tokenId) {
        setTokenRollModifier((previous) => ({ ...previous, [tokenId]: modifier }));
      }
    };

    return subscribeAppEvent("rollModifierUpdated", handleRollModifierUpdate);
  }, [setTokenRollModifier]);

  useEffect(() => {
    if (!setEditingParamsTokenId) {
      return;
    }
    return subscribeAppEvent("openTokenParamsEditor", ({ tokenId }) => {
      if (typeof tokenId === "number") {
        setEditingParamsTokenId(tokenId);
      }
    });
  }, [setEditingParamsTokenId]);

  useEffect(() => {
    publishAppEvent("mapTokenSelected", { tokenId: selectedTokenId });
    if (!isDM || !selectedTokenId) {
      return;
    }
    const token = tokens.find((candidate) => candidate.id === selectedTokenId);
    if (token?.character_id) {
      publishAppEvent("selectCharacterFromMap", {
        characterId: token.character_id,
      });
    }
  }, [isDM, selectedTokenId, tokens]);

  useEffect(() => {
    if (!setTokens) {
      return;
    }
    return subscribeAppEvent("tokenHPUpdate", ({ characterId, currentHp, maxHp }) => {
      if (typeof characterId !== "number") {
        return;
      }
      setTokens((previous) =>
        previous.map((token) =>
          token.character_id === characterId
            ? {
                ...token,
                params: {
                  ...(token as any).params,
                  current_hp: currentHp ?? (token as any).params?.current_hp,
                  max_hp: maxHp ?? (token as any).params?.max_hp,
                },
              }
            : token,
        ),
      );
    });
  }, [setTokens]);

  useEffect(() => {
    if (!setSelectedTokenId || tokens.length === 0) {
      return;
    }
    return subscribeAppEvent("selectTokenByCharacterId", ({ characterId }) => {
      if (typeof characterId !== "number") {
        return;
      }
      const token = tokens.find((candidate) => candidate.character_id === characterId);
      if (token) {
        setSelectedTokenId(token.id);
      }
    });
  }, [setSelectedTokenId, tokens]);

  useEffect(() => {
    if (!authedFetch || tokens.length === 0) {
      return;
    }
    return subscribeAppEvent("removeCharacterTokens", async ({ characterId }) => {
      if (typeof characterId !== "number") {
        return;
      }
      const toRemove = tokens.filter((token) => token.character_id === characterId);
      for (const token of toRemove) {
        try {
          await authedFetch(`/api/tokens/${token.id}`, { method: "DELETE" });
        } catch (error) {
          console.error("Failed to remove token after kick:", error);
        }
      }
    });
  }, [authedFetch, tokens]);

  useEffect(() => {
    if (
      !setSelectedTokenId
      || !setStagePos
      || !showToast
      || !authedFetch
      || !setTokens
      || !stageSize
      || stageScale == null
    ) {
      return;
    }

    const focusGridPosition = (position: { x: number; y: number }) => {
      const tokenX = position.x * GRID_SIZE + GRID_SIZE / 2;
      const tokenY = position.y * GRID_SIZE + GRID_SIZE / 2;
      setStagePos({
        x: stageSize.width / 2 - tokenX * stageScale,
        y: stageSize.height / 2 - tokenY * stageScale,
      });
    };

    return subscribeAppEvent("focusOrCreateToken", async ({ characterId, name }) => {
      if (typeof characterId !== "number") {
        return;
      }

      const token = tokens.find((candidate) => candidate.character_id === characterId);
      if (token) {
        focusGridPosition({ x: token.position_x, y: token.position_y });
        setSelectedTokenId(token.id);
        showToast(`已定位到 ${token.character_name || token.instance_name || name}`, "success");
        return;
      }

      if (!currentMapUrl || !campaignId) {
        return;
      }

      const center = (window as any).__getViewportCenterGridPosition?.();
      if (!center) {
        return;
      }

      try {
        const response = await authedFetch("/api/tokens/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaign_id: parseInt(campaignId, 10),
            character_id: characterId,
            map_url: currentMapUrl,
            position_x: center.x,
            position_y: center.y,
            token_size: "1x1",
          }),
        });
        if (!response.ok) {
          return;
        }
        const newToken = await response.json();
        setTokens((previous) => (
          previous.some((candidate) => candidate.id === newToken.id)
            ? previous
            : [...previous, newToken]
        ));
        focusGridPosition({ x: newToken.position_x, y: newToken.position_y });
        setSelectedTokenId(newToken.id);
        showToast(`已为 ${name} 创建Token`, "success");
      } catch (error) {
        console.error("Failed to create token:", error);
        showToast("创建Token失败", "error");
      }
    });
  }, [
    authedFetch,
    campaignId,
    currentMapUrl,
    setSelectedTokenId,
    setStagePos,
    setTokens,
    showToast,
    stageScale,
    stageSize,
    tokens,
  ]);
}
