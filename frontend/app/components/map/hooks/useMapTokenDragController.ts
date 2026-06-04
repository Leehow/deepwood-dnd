import { useCallback, useEffect, useRef } from "react";

import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import { apiFetch } from "~/utils/api-client";
import { createLogger } from "~/utils/logger";

import { GRID_SIZE, type Token } from "../types/TacticalMapTypes";
import {
  autoSettleZoneSpellsForMove,
  collectActiveZones as collectActiveZonesForMap,
  isPointInArea,
  settleZoneForToken as settleZoneForTokenRequest,
  type ZoneInfo,
  type ZoneSettlementTiming,
} from "../utils/zoneSettlementRuntimeUtils";

const logger = createLogger("useMapTokenDragController");

interface UseMapTokenDragControllerArgs {
  campaignId: string;
  currentMapUrl?: string | null;
  userId?: string;
  isDM: boolean;
  gridUnitLength?: number;
  tokens: Token[];
  setTokens: (updater: (prev: Token[]) => Token[]) => void;
}

export function useMapTokenDragController({
  campaignId,
  currentMapUrl,
  userId,
  isDM,
  gridUnitLength = 5,
  tokens,
  setTokens,
}: UseMapTokenDragControllerArgs) {
  const authedFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => apiFetch(input, { ...init, userId }),
    [userId],
  );

  const getActiveZones = useCallback((): ZoneInfo[] => {
    return collectActiveZonesForMap(tokens, currentMapUrl);
  }, [currentMapUrl, tokens]);

  const zoneSettleLog = useRef<Map<string, number>>(new Map());

  const settleZoneForToken = useCallback(
    async (tokenId: number, zone: ZoneInfo, timing: ZoneSettlementTiming, dedupeRound?: number) => {
      if (dedupeRound !== undefined) {
        const key = `${tokenId}-${zone.spellId}-${timing}-${dedupeRound}`;
        if (zoneSettleLog.current.has(key)) return;
        zoneSettleLog.current.set(key, Date.now());
      }

      try {
        const response = await settleZoneForTokenRequest({
          authedFetch,
          campaignId,
          tokenId,
          zone,
          timing,
        });
        if (!response.ok) {
          logger.error(`[useMapTokenDragController] Zone-settle API error: ${response.status}`);
          return;
        }
        const result = await response.json();
        logger.debug(
          `[useMapTokenDragController] Zone-settle: ${result.spell_name} -> ${result.target_results?.[0]?.target_name}`,
        );
      } catch (error) {
        logger.error("[useMapTokenDragController] Zone-settle failed:", error);
      }
    },
    [authedFetch, campaignId],
  );

  const checkTurnStartZoneSpells = useCallback(
    async (tokenId: number, round: number) => {
      if (!isDM || !currentMapUrl) return;
      const token = tokens.find((candidate) => candidate.id === tokenId);
      if (!token) return;

      const size = token.token_size?.split("x").map(Number) || [1, 1];
      const cx = (token.position_x ?? 0) + size[0] / 2;
      const cy = (token.position_y ?? 0) + size[1] / 2;

      const zones = getActiveZones();
      if (zones.length === 0) return;

      const matchingZones = zones.filter(
        (zone) => zone.casterTokenId !== tokenId && isPointInArea(cx, cy, zone.area, gridUnitLength),
      );
      if (matchingZones.length === 0) return;

      logger.debug(
        `[useMapTokenDragController] Turn-start zone check: token ${tokenId} in ${matchingZones.length} zone(s)`,
      );
      for (const zone of matchingZones) {
        await settleZoneForToken(tokenId, zone, "start_turn", round);
      }
    },
    [currentMapUrl, getActiveZones, gridUnitLength, isDM, settleZoneForToken, tokens],
  );

  const checkTurnEndZoneSpells = useCallback(
    async (tokenId: number, round: number) => {
      if (!isDM || !currentMapUrl) return;
      const token = tokens.find((candidate) => candidate.id === tokenId);
      if (!token) return;

      const size = token.token_size?.split("x").map(Number) || [1, 1];
      const cx = (token.position_x ?? 0) + size[0] / 2;
      const cy = (token.position_y ?? 0) + size[1] / 2;

      const zones = getActiveZones();
      if (zones.length === 0) return;

      const matchingZones = zones.filter(
        (zone) => zone.casterTokenId !== tokenId && isPointInArea(cx, cy, zone.area, gridUnitLength),
      );
      if (matchingZones.length === 0) return;

      logger.debug(
        `[useMapTokenDragController] Turn-end zone check: token ${tokenId} in ${matchingZones.length} zone(s)`,
      );
      for (const zone of matchingZones) {
        await settleZoneForToken(tokenId, zone, "end_turn", round);
      }
    },
    [currentMapUrl, getActiveZones, gridUnitLength, isDM, settleZoneForToken, tokens],
  );

  useEffect(() => {
    const handler = ({ tokenId, round }: { tokenId: number; round: number }) => {
      if (!tokenId) return;
      zoneSettleLog.current.clear();
      void checkTurnStartZoneSpells(tokenId, round ?? 0);
    };

    return subscribeAppEvent("combatTurnStarted", handler);
  }, [checkTurnStartZoneSpells]);

  useEffect(() => {
    const handler = ({ tokenId, round }: { tokenId: number; round: number }) => {
      if (!tokenId) return;
      void checkTurnEndZoneSpells(tokenId, round ?? 0);
    };

    return subscribeAppEvent("combatTurnEnding", handler);
  }, [checkTurnEndZoneSpells]);

  useEffect(() => {
    return subscribeAppEvent("tokenPerformedAction", ({ tokenId }) => {
      if (!tokenId || !isDM) return;
      const combatIsActive = Boolean((window as any).__combatIsActive);
      if (combatIsActive) return;
      const combatRound = (window as any).__combatIsActive ? ((window as any).__combatRound ?? 0) : undefined;
      void checkTurnStartZoneSpells(tokenId, combatRound ?? -Date.now());
    });
  }, [checkTurnStartZoneSpells, isDM]);

  const handleTokenDragEnd = useCallback(
    async (tokenId: number, event: any) => {
      const tokenX = event.target.x();
      const tokenY = event.target.y();

      const newX = Math.round(tokenX / GRID_SIZE);
      const newY = Math.round(tokenY / GRID_SIZE);

      const token = tokens.find((candidate) => candidate.id === tokenId);
      const oldX = token?.position_x ?? newX;
      const oldY = token?.position_y ?? newY;

      const dx = newX - oldX;
      const dy = newY - oldY;
      const distanceFeet = Math.round(Math.max(Math.abs(dx), Math.abs(dy)) * gridUnitLength);

      logger.debug(
        `[useMapTokenDragController] Token ${tokenId} dragged to grid position (${newX}, ${newY}), moved ${distanceFeet}ft`,
      );

      const combatIsActive = (window as any).__combatIsActive;
      if (combatIsActive && !isDM && distanceFeet > 0) {
        const participantTokenIds: number[] = (window as any).__combatParticipantTokenIds ?? [];
        if (participantTokenIds.includes(tokenId)) {
          const movementRemaining = (window as any).__combatMovementRemaining ?? 0;
          if (movementRemaining <= 0 || distanceFeet > movementRemaining) {
            event.target.x(oldX * GRID_SIZE);
            event.target.y(oldY * GRID_SIZE);
            const message =
              movementRemaining <= 0
                ? "本回合移动力已用尽"
                : `移动距离(${distanceFeet}尺)超出剩余移动力(${movementRemaining}尺)`;
            publishAppEvent("showToast", { message, type: "warning" });
            return;
          }
        }
      }

      setTokens((prev) =>
        prev.map((candidate) =>
          candidate.id === tokenId
            ? { ...candidate, position_x: newX, position_y: newY }
            : candidate,
        ),
      );

      try {
        const response = await authedFetch(`/api/tokens/${tokenId}/position`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position_x: newX, position_y: newY }),
        });

        if (!response.ok) {
          logger.error(
            `[useMapTokenDragController] Failed to update token position: ${response.status}`,
          );
          return;
        }

        if (distanceFeet > 0) {
          publishAppEvent("combatActionUsed", {
            type: "movement",
            amount: distanceFeet,
            tokenId,
          });
        }

        if (distanceFeet > 0 && currentMapUrl && token) {
          const zones = getActiveZones();
          logger.debug(
            `[useMapTokenDragController] Auto zone-settle check: ${zones.length} zones found, token ${tokenId} moved (${oldX},${oldY})->(${newX},${newY})`,
          );
          void autoSettleZoneSpellsForMove({
            authedFetch,
            campaignId,
            currentMapUrl,
            gridUnitLength,
            tokens,
            tokenId,
            newX,
            newY,
          }).catch((error) => {
            logger.error("[useMapTokenDragController] Auto zone-settle failed:", error);
          });
        }
      } catch (error) {
        logger.error("[useMapTokenDragController] Failed to persist token position:", error);
      }
    },
    [authedFetch, campaignId, currentMapUrl, getActiveZones, gridUnitLength, isDM, setTokens, tokens],
  );

  return {
    handleTokenDragEnd,
  };
}
