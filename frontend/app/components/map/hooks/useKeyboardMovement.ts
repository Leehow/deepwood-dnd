/**
 * useKeyboardMovement Hook
 * Handles WASD / Arrow key movement for the player's own token
 */

import { useEffect, useCallback, useRef } from "react";
import type { Token } from "../types/TacticalMapTypes";
import { GRID_SIZE } from "../types/TacticalMapTypes";
import { apiFetch } from "~/utils/api-client";
import { publishAppEvent } from "~/events/appEventBus";
import { createLogger } from "~/utils/logger";
import { autoSettleZoneSpellsForMove } from "../utils/zoneSettlementRuntimeUtils";

const logger = createLogger("useKeyboardMovement");

/** Direction deltas for each key */
const KEY_DELTAS: Record<string, { dx: number; dy: number }> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  w: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  a: { dx: -1, dy: 0 },
  d: { dx: 1, dy: 0 },
  W: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  A: { dx: -1, dy: 0 },
  D: { dx: 1, dy: 0 },
};

interface UseKeyboardMovementProps {
  campaignId: string;
  currentMapUrl?: string | null;
  tokens: Token[];
  setTokens: (updater: (prev: Token[]) => Token[]) => void;
  userId?: string;
  selectedCharacterId?: number | null;
  isDM: boolean;
  gridUnitLength?: number;
  mapImage?: HTMLImageElement | null;
  mapImageScale?: number;
}

export function useKeyboardMovement({
  campaignId,
  currentMapUrl,
  tokens,
  setTokens,
  userId,
  selectedCharacterId,
  isDM,
  gridUnitLength = 5,
  mapImage,
  mapImageScale = 1,
}: UseKeyboardMovementProps) {
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;

  const movingRef = useRef(false);

  const authedFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) =>
      apiFetch(input, { ...init, userId }),
    [userId]
  );

  const handleKeyDown = useCallback(
    async (e: KeyboardEvent) => {
      const delta = KEY_DELTAS[e.key];
      if (!delta) return;

      // Don't capture if user is typing in an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (isDM) return;
      if (!selectedCharacterId || !userId) return;

      const myToken = tokensRef.current.find(
        (t) => t.character_id === selectedCharacterId
      );
      if (!myToken) return;

      e.preventDefault();

      if (movingRef.current) return;

      const newX = myToken.position_x + delta.dx;
      const newY = myToken.position_y + delta.dy;

      // Bounds check using actual map dimensions
      const maxGridX = mapImage
        ? Math.ceil((mapImage.width * mapImageScale) / GRID_SIZE)
        : 9999;
      const maxGridY = mapImage
        ? Math.ceil((mapImage.height * mapImageScale) / GRID_SIZE)
        : 9999;
      if (newX < 0 || newY < 0 || newX >= maxGridX || newY >= maxGridY) return;

      // Combat movement check
      const combatIsActive = (window as any).__combatIsActive;
      if (combatIsActive) {
        const participantIds: number[] =
          (window as any).__combatParticipantTokenIds ?? [];
        if (participantIds.includes(myToken.id)) {
          const turnUserId = (window as any).__combatTurnUserId;
          if (turnUserId !== userId) {
            publishAppEvent("showToast", { message: "不是你的回合", type: "warning" });
            return;
          }
          const activeTokenId = (window as any).__combatActiveTokenId;
          if (activeTokenId !== myToken.id) return;

          const movementRemaining: number =
            (window as any).__combatMovementRemaining ?? 0;
          const distanceFeet = gridUnitLength;
          if (movementRemaining <= 0 || distanceFeet > movementRemaining) {
            publishAppEvent("showToast", { message: "本回合移动力已用尽", type: "warning" });
            return;
          }
        }
      }

      // Optimistic local update
      setTokens((prev) =>
        prev.map((t) =>
          t.id === myToken.id
            ? { ...t, position_x: newX, position_y: newY }
            : t
        )
      );

      // Persist to backend
      movingRef.current = true;
      try {
        const resp = await authedFetch(`/api/tokens/${myToken.id}/position`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position_x: newX, position_y: newY }),
        });

        if (resp.ok) {
          const distanceFeet = gridUnitLength;
          publishAppEvent("combatActionUsed", {
            type: "movement",
            amount: distanceFeet,
          });
          if (currentMapUrl) {
            void autoSettleZoneSpellsForMove({
              authedFetch,
              campaignId,
              currentMapUrl,
              gridUnitLength,
              tokens: tokensRef.current,
              tokenId: myToken.id,
              newX,
              newY,
            }).catch((error) => {
              logger.error("[Keyboard] Auto zone-settle failed:", error);
            });
          }
          logger.debug(
            `[Keyboard] Token ${myToken.id} moved to (${newX}, ${newY})`
          );
        } else {
          logger.error(`[Keyboard] Failed to move token: ${resp.status}`);
          setTokens((prev) =>
            prev.map((t) =>
              t.id === myToken.id
                ? {
                    ...t,
                    position_x: myToken.position_x,
                    position_y: myToken.position_y,
                  }
                : t
            )
          );
        }
      } catch (err) {
        logger.error("[Keyboard] Failed to move token:", err);
      } finally {
        movingRef.current = false;
      }
    },
    [authedFetch, campaignId, currentMapUrl, gridUnitLength, isDM, mapImage, mapImageScale, selectedCharacterId, setTokens, userId]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
