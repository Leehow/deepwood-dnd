import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { WebSocketMessage } from "~/hooks/useWebSocket";
import { castSpellAction } from "~/utils/sidebarCasting";
import { createLogger } from "~/utils/logger";

import type { PlayerSpellDialogState } from "../MapPlayerSpellDialog";
import type {
  PlayerReactionState,
} from "./useMapInteractionController";
import type { Token } from "../types/TacticalMapTypes";
import type { SpellCastData } from "~/components/spell/SpellCastActions";

const logger = createLogger("useMapPlayerActionController");

type ShowToastFn = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface UseMapPlayerActionControllerArgs {
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  campaignId: string;
  currentMapUrl?: string | null;
  selectedCharacterId?: number | null;
  userId?: string;
  sourceCharacterData: any;
  tokens: Token[];
  playerReactions: PlayerReactionState[];
  setPlayerReactions: Dispatch<SetStateAction<PlayerReactionState[]>>;
  setPlayerSpellDialog: Dispatch<SetStateAction<PlayerSpellDialogState | null>>;
  sendMessage: (payload: WebSocketMessage) => void;
  setTokens: (updater: (prev: Token[]) => Token[]) => void;
  showToast: ShowToastFn;
}

export function useMapPlayerActionController({
  authedFetch,
  campaignId,
  currentMapUrl,
  selectedCharacterId,
  userId,
  sourceCharacterData,
  tokens,
  playerReactions,
  setPlayerReactions,
  setPlayerSpellDialog,
  sendMessage,
  setTokens,
  showToast,
}: UseMapPlayerActionControllerArgs) {
  const handlePlayerMove = useCallback(
    (gridX: number, gridY: number) => {
      const myToken = tokens.find(
        (token) =>
          token.character_id &&
          ((selectedCharacterId && token.character_id === selectedCharacterId) ||
            (userId && token.user_id === userId)),
      );
      if (!myToken) {
        showToast("找不到您的角色Token", "error");
        return;
      }

      sendMessage({
        type: "token_move",
        data: { token_id: myToken.id, position: { x: gridX, y: gridY } },
      });

      setTokens((prev) =>
        prev.map((token) =>
          token.id === myToken.id ? { ...token, position_x: gridX, position_y: gridY } : token,
        ),
      );

      logger.debug("[TacticalMap] Player moved token to:", gridX, gridY);
    },
    [selectedCharacterId, sendMessage, setTokens, showToast, tokens, userId],
  );

  const handlePlayerCastSpell = useCallback((spell: any) => {
    setPlayerSpellDialog({
      spell,
      selectedCastLevel: Number(spell?.level ?? 0),
    });
  }, [setPlayerSpellDialog]);

  const handlePlayerSpellDialogCast = useCallback(
    async (castData: SpellCastData) => {
      if (!selectedCharacterId) {
        showToast("未选择角色", "error");
        return;
      }

      await castSpellAction(castData.spell, castData.level, selectedCharacterId, {
        campaignId,
        currentMapUrl,
        userId,
        spellSaveDC: sourceCharacterData?.spell_save_dc,
        freecast: castData.freecast,
        ritualCast: castData.ritualCast,
        confirmBreakConcentration: castData.confirmBreakConcentration,
        illusionImageUrl: castData.illusionData?.imageUrl,
        illusionDesc: castData.illusionData?.description,
        illusionDisplayName: castData.illusionData?.displayName,
        areaSize: castData.areaSize,
        selectedOption: castData.selectedOption,
        materialId: castData.materialId,
        targetingMode: castData.targetingMode,
      });

      setPlayerSpellDialog(null);
    },
    [
      campaignId,
      currentMapUrl,
      selectedCharacterId,
      setPlayerSpellDialog,
      showToast,
      sourceCharacterData?.spell_save_dc,
      userId,
    ],
  );

  const handlePlayerUseAbility = useCallback(
    async (ability: any) => {
      if (!selectedCharacterId) {
        showToast("未选择角色", "error");
        return;
      }

      try {
        sendMessage({
          type: "chat",
          data: { message: `⚡ 使用技能【${ability.name}】`, message_type: "combat" },
        });

        showToast(`使用${ability.name}成功`, "success");
        logger.debug("[TacticalMap] Player used ability:", ability.name);
      } catch (error) {
        logger.error("[TacticalMap] Failed to use ability:", error);
        showToast("使用技能失败", "error");
      }
    },
    [selectedCharacterId, sendMessage, showToast],
  );

  const handlePlayerToggleReaction = useCallback(
    async (reactionId: string, armed: boolean) => {
      const myToken = tokens.find((token) => token.character_id === selectedCharacterId);
      if (!myToken) {
        showToast("未找到角色Token", "error");
        return;
      }

      try {
        const response = await authedFetch(
          `/api/tokens/${myToken.id}/toggle-reaction?reaction_id=${reactionId}&armed=${armed}`,
          { method: "POST" },
        );

        if (!response.ok) {
          throw new Error("Failed to toggle reaction");
        }

        setPlayerReactions((prev) =>
          prev.map((reaction) =>
            reaction.id === reactionId
              ? {
                  ...reaction,
                  armed,
                  usesRemaining: armed ? reaction.usesPerRound : reaction.usesRemaining,
                }
              : reaction,
          ),
        );

        const reactionName = playerReactions.find((reaction) => reaction.id === reactionId)?.name || reactionId;
        showToast(`${armed ? "准备" : "取消"}${reactionName}`, armed ? "success" : "info");
        logger.debug("[TacticalMap] Player toggled reaction:", reactionId, "armed:", armed);
      } catch (error) {
        logger.error("[TacticalMap] Failed to toggle reaction:", error);
        showToast("操作失败", "error");
      }
    },
    [authedFetch, playerReactions, selectedCharacterId, setPlayerReactions, showToast, tokens],
  );

  return {
    handlePlayerCastSpell,
    handlePlayerMove,
    handlePlayerSpellDialogCast,
    handlePlayerToggleReaction,
    handlePlayerUseAbility,
  };
}
