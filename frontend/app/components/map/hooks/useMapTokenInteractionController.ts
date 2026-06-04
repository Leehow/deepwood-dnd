import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { publishAppEvent } from "~/events/appEventBus";

import type { Token } from "../types/TacticalMapTypes";

export type TokenOpenAction =
  | { type: "none" }
  | { type: "remove-token"; tokenId: number }
  | { type: "edit-illusion"; tokenId: number }
  | { type: "open-item-detail"; tokenId: number }
  | { type: "open-loot-bag"; tokenId: number }
  | { type: "open-shop-token-modal"; tokenId: number }
  | { type: "open-shop-transaction"; shopId: number; tokenId: number }
  | { type: "open-chest-management"; chestId: number }
  | { type: "open-chest-interaction"; chestId: number; tokenId: number }
  | { type: "open-token-panel"; tokenId: number }
  | { type: "open-active-token"; tokenId: number }
  | { type: "open-player-note"; tokenId: number };

function canCurrentUserEditDisguiseIllusion(args: {
  token: Token;
  tokens: Token[];
  isDM: boolean;
  userId?: string;
}) {
  const { token, tokens, isDM, userId } = args;
  if (!token.disguise_data) return false;

  const casterId = token.disguise_data.caster_character_id;
  const casterToken = casterId
    ? tokens.find((candidate) => candidate.character_id === casterId) || null
    : null;
  const hasMalleable =
    casterToken?.concentration_spell?.malleable ||
    casterToken?.active_effects?.some(
      (effect) =>
        effect.spell_id === token.disguise_data!.spell_id && (effect as any).malleable,
    );
  const isCaster = !!(userId && casterToken?.user_id === userId);
  return (isDM || isCaster) && !!hasMalleable;
}

export function resolveTokenOpenAction(args: {
  token: Token | null;
  tokens: Token[];
  isDM: boolean;
  userId?: string;
  selectedCharacterId?: number | null;
  selectedTool?: string;
  tokenMode?: "place" | "delete";
}): TokenOpenAction {
  const { token, tokens, isDM, userId, selectedCharacterId, selectedTool, tokenMode } = args;
  if (!token) {
    return { type: "none" };
  }

  if (selectedTool === "token" && tokenMode === "delete" && isDM) {
    return { type: "remove-token", tokenId: token.id };
  }

  if (token.item_data?.type === "illusion") {
    const isCaster = !!(
      userId &&
      token.item_data.caster_id &&
      tokens.some(
        (candidate) =>
          candidate.character_id === token.item_data!.caster_id && candidate.user_id === userId,
      )
    );
    return isDM || isCaster ? { type: "edit-illusion", tokenId: token.id } : { type: "none" };
  }

  if (canCurrentUserEditDisguiseIllusion({ token, tokens, isDM, userId })) {
    return { type: "edit-illusion", tokenId: token.id };
  }

  if (token.loot_bag_data) {
    return { type: "open-loot-bag", tokenId: token.id };
  }

  if (token.chest_id) {
    return isDM
      ? { type: "open-chest-management", chestId: token.chest_id }
      : { type: "open-chest-interaction", chestId: token.chest_id, tokenId: token.id };
  }

  if (token.item_data) {
    return { type: "open-item-detail", tokenId: token.id };
  }

  if (token.shop_id) {
    return isDM
      ? { type: "open-shop-token-modal", tokenId: token.id }
      : { type: "open-shop-transaction", shopId: token.shop_id, tokenId: token.id };
  }

  if (isDM) {
    return { type: "open-token-panel", tokenId: token.id };
  }

  const isOwnToken = !!(
    token.character_id &&
    ((selectedCharacterId && token.character_id === selectedCharacterId) ||
      (userId && token.user_id === userId))
  );
  return isOwnToken
    ? { type: "open-active-token", tokenId: token.id }
    : { type: "open-player-note", tokenId: token.id };
}

interface UseMapTokenInteractionControllerArgs {
  isDM: boolean;
  userId?: string;
  selectedCharacterId?: number | null;
  selectedTool?: string;
  tokenMode?: "place" | "delete";
  tokens: Token[];
  longPressTriggeredRef: MutableRefObject<boolean>;
  setSelectedTokenId: Dispatch<SetStateAction<number | null>>;
  clearInteractionMenus: () => void;
  loadSourceTokenData: (token: Token | null) => Promise<void>;
  fetchCompanionData: (characterToken: Token) => void;
  setCompanionMonsterDataMap: Dispatch<SetStateAction<Record<number, any>>>;
  setSourceMonsterData: Dispatch<SetStateAction<any>>;
  setSourceCharacterData: Dispatch<SetStateAction<any>>;
  handleTargetingTokenSelection: (tokenId: number) => boolean;
  handleRemoveToken: (tokenId: number) => void;
  setItemDetailTokenId: Dispatch<SetStateAction<number | null>>;
  setIllusionEditTokenId: Dispatch<SetStateAction<number | null>>;
  setLootBagTokenId: Dispatch<SetStateAction<number | null>>;
  openTokenPanel: (tokenId: number) => void;
  setActiveTokenId: Dispatch<SetStateAction<number | null>>;
  setPlayerNoteTokenId: Dispatch<SetStateAction<number | null>>;
}

export function useMapTokenInteractionController({
  isDM,
  userId,
  selectedCharacterId,
  selectedTool,
  tokenMode,
  tokens,
  longPressTriggeredRef,
  setSelectedTokenId,
  clearInteractionMenus,
  loadSourceTokenData,
  fetchCompanionData,
  setCompanionMonsterDataMap,
  setSourceMonsterData,
  setSourceCharacterData,
  handleTargetingTokenSelection,
  handleRemoveToken,
  setItemDetailTokenId,
  setIllusionEditTokenId,
  setLootBagTokenId,
  openTokenPanel,
  setActiveTokenId,
  setPlayerNoteTokenId,
}: UseMapTokenInteractionControllerArgs) {
  const handleExternalTokenSelect = useCallback(
    (tokenId: number | null) => {
      setSelectedTokenId(tokenId);
      clearInteractionMenus();

      if (!tokenId) {
        setSourceMonsterData(null);
        setSourceCharacterData(null);
        setCompanionMonsterDataMap({});
        return;
      }

      const selectedToken = tokens.find((token) => token.id === tokenId) || null;
      void loadSourceTokenData(selectedToken);
      if (selectedToken?.character_id && !isDM) {
        fetchCompanionData(selectedToken);
        return;
      }
      if (!selectedToken?.character_id) {
        setCompanionMonsterDataMap({});
      }
    },
    [
      clearInteractionMenus,
      fetchCompanionData,
      isDM,
      loadSourceTokenData,
      setCompanionMonsterDataMap,
      setSelectedTokenId,
      setSourceCharacterData,
      setSourceMonsterData,
      tokens,
    ],
  );

  const handleTokenSelect = useCallback(
    (tokenId: number) => {
      if (handleTargetingTokenSelection(tokenId)) return;
      if (!isDM || longPressTriggeredRef.current) return;
      handleExternalTokenSelect(tokenId);
    },
    [handleExternalTokenSelect, handleTargetingTokenSelection, isDM, longPressTriggeredRef],
  );

  const handleTokenOpen = useCallback(
    (tokenId: number) => {
      if (longPressTriggeredRef.current) return;
      if (handleTargetingTokenSelection(tokenId)) return;

      const token = tokens.find((candidate) => candidate.id === tokenId) || null;
      const action = resolveTokenOpenAction({
        token,
        tokens,
        isDM,
        userId,
        selectedCharacterId,
        selectedTool,
        tokenMode,
      });

      if (action.type === "remove-token") {
        handleRemoveToken(action.tokenId);
        return;
      }

      if (action.type === "edit-illusion") {
        setIllusionEditTokenId(action.tokenId);
        return;
      }

      if (!token) return;

      switch (action.type) {
        case "open-item-detail":
          setItemDetailTokenId(action.tokenId);
          return;
        case "open-loot-bag":
          setLootBagTokenId(action.tokenId);
          return;
        case "open-shop-token-modal":
          publishAppEvent("openShopTokenModal", { tokenId: action.tokenId });
          return;
        case "open-shop-transaction":
          publishAppEvent("openShopTransaction", {
            shopId: action.shopId,
            tokenId: action.tokenId,
          });
          return;
        case "open-chest-management":
          publishAppEvent("openChestManagement", { chestId: action.chestId, tokenId });
          return;
        case "open-chest-interaction":
          publishAppEvent("openChestInteraction", {
            chestId: action.chestId,
            tokenId: action.tokenId,
          });
          return;
        case "open-token-panel":
          openTokenPanel(action.tokenId);
          return;
        case "open-active-token":
          setActiveTokenId(action.tokenId);
          return;
        case "open-player-note":
          setPlayerNoteTokenId(action.tokenId);
          return;
        default:
          return;
      }
    },
    [
      handleRemoveToken,
      handleTargetingTokenSelection,
      isDM,
      longPressTriggeredRef,
      openTokenPanel,
      selectedCharacterId,
      selectedTool,
      setActiveTokenId,
      setItemDetailTokenId,
      setIllusionEditTokenId,
      setLootBagTokenId,
      setPlayerNoteTokenId,
      tokenMode,
      tokens,
      userId,
    ],
  );

  return {
    handleExternalTokenSelect,
    handleTokenOpen,
    handleTokenSelect,
  };
}
