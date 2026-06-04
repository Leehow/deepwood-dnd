/**
 * useMapForcedMovementConsumer
 *
 * Subscribes to `forcedMovementPending` events emitted by useMapWebSocket
 * whenever a token receives a transient `forced_movement` active effect
 * (Thorn Whip pull, Thunderwave push, etc.). Computes the destination from
 * the caster position, persists the token move, and clears the transient
 * entry so it is not re-consumed.
 *
 * Gated to DM clients so a multi-client session only moves the token once;
 * the existing DM-driven Chrome QA flow is the canonical actor.
 */
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { subscribeAppEvent, type ForcedMovementPendingEventPayload } from "~/events/appEventBus";
import {
  computeForcedMovementDestination,
  isForcedMovementIntentEntry,
} from "~/utils/forcedMovement";
import { createLogger } from "~/utils/logger";
import type { Token } from "../types/TacticalMapTypes";

const logger = createLogger("useMapForcedMovementConsumer");

const INFLIGHT_TTL_MS = 5000;

type AuthedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface UseMapForcedMovementConsumerArgs {
  isDM: boolean;
  tokens: Token[];
  gridUnitLength: number;
  authedFetch: AuthedFetch;
  setTokens: Dispatch<SetStateAction<Token[]>>;
}

function makeInflightKey(targetTokenId: number, effectId: string): string {
  return `${targetTokenId}:${effectId}`;
}

export function useMapForcedMovementConsumer({
  isDM,
  tokens,
  gridUnitLength,
  authedFetch,
  setTokens,
}: UseMapForcedMovementConsumerArgs) {
  // Refs keep the subscription stable while still letting `consume` read the
  // latest closures. `authedFetch` is recreated on every TacticalMap render
  // (not memoized) so depending on it directly would re-subscribe each render
  // and reset the inflight dedupe map — losing once-only semantics.
  const tokensRef = useRef(tokens);
  const gridRef = useRef(gridUnitLength);
  const isDmRef = useRef(isDM);
  const authedFetchRef = useRef(authedFetch);
  const setTokensRef = useRef(setTokens);
  const inflightRef = useRef<Map<string, number>>(new Map());

  useEffect(() => { tokensRef.current = tokens; }, [tokens]);
  useEffect(() => { gridRef.current = gridUnitLength; }, [gridUnitLength]);
  useEffect(() => { isDmRef.current = isDM; }, [isDM]);
  useEffect(() => { authedFetchRef.current = authedFetch; }, [authedFetch]);
  useEffect(() => { setTokensRef.current = setTokens; }, [setTokens]);

  useEffect(() => {
    const inflight = inflightRef.current;

    const consume = async (detail: ForcedMovementPendingEventPayload) => {
      if (!isDmRef.current) return;
      const { targetTokenId, effectId } = detail;
      const key = makeInflightKey(targetTokenId, effectId);
      const now = Date.now();
      const previouslyAt = inflight.get(key);
      if (previouslyAt && now - previouslyAt < INFLIGHT_TTL_MS) {
        return;
      }
      inflight.set(key, now);

      const currentTokens = tokensRef.current;
      const target = currentTokens.find((t) => t.id === targetTokenId);
      if (!target) {
        logger.debug(`[forcedMovement] target token ${targetTokenId} not loaded; skipping`);
        // Don't leave the inflight gate latched if we never actually processed.
        inflight.delete(key);
        return;
      }

      const sourceToken = detail.sourceTokenId != null
        ? currentTokens.find((t) => t.id === detail.sourceTokenId)
        : null;
      const sourcePos = sourceToken
        ? { x: sourceToken.position_x ?? 0, y: sourceToken.position_y ?? 0 }
        : null;
      const targetPos = { x: target.position_x ?? 0, y: target.position_y ?? 0 };

      const destination = computeForcedMovementDestination({
        sourcePos,
        targetPos,
        intent: {
          direction: detail.direction,
          distanceFeet: detail.distanceFeet,
          point: detail.point,
        },
        gridUnitLength: gridRef.current,
      });

      // Use the WS-supplied snapshot (server truth at publish time) rather
      // than the React-state target.active_effects, which may not have been
      // committed yet by the time this callback runs.
      const snapshot = Array.isArray(detail.activeEffectsSnapshot)
        ? (detail.activeEffectsSnapshot as unknown[])
        : (target.active_effects as unknown[] | null | undefined) ?? [];
      const remaining = snapshot.filter(
        (entry: unknown) => !(
          isForcedMovementIntentEntry(entry)
          && (entry as { id?: unknown }).id === effectId
        ),
      );

      const persistClearedEffects = async () => {
        try {
          setTokensRef.current((prev) => prev.map((t) =>
            t.id === targetTokenId
              ? { ...t, active_effects: remaining.length > 0 ? (remaining as Token["active_effects"]) : null }
              : t,
          ));
          await authedFetchRef.current(`/api/tokens/${targetTokenId}/active-effects`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active_effects: remaining }),
          });
        } catch (error) {
          logger.error("[forcedMovement] failed to clear transient effect", error);
        }
      };

      if (!destination) {
        // Nothing we can do (e.g. missing source position); still clear the
        // intent so it does not keep replaying.
        logger.debug(
          `[forcedMovement] no valid destination for effect ${effectId} on token ${targetTokenId}`,
        );
        await persistClearedEffects();
        return;
      }

      if (destination.x === targetPos.x && destination.y === targetPos.y) {
        await persistClearedEffects();
        return;
      }

      try {
        setTokensRef.current((prev) => prev.map((t) =>
          t.id === targetTokenId
            ? { ...t, position_x: destination.x, position_y: destination.y }
            : t,
        ));
        const moveResponse = await authedFetchRef.current(
          `/api/tokens/${targetTokenId}/position`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ position_x: destination.x, position_y: destination.y }),
          },
        );
        if (!moveResponse.ok) {
          logger.error(
            `[forcedMovement] move failed (${moveResponse.status}) for token ${targetTokenId}`,
          );
          // Roll back local position if the server rejected the move.
          setTokensRef.current((prev) => prev.map((t) =>
            t.id === targetTokenId
              ? { ...t, position_x: targetPos.x, position_y: targetPos.y }
              : t,
          ));
        }
      } catch (error) {
        logger.error("[forcedMovement] move request threw", error);
        setTokensRef.current((prev) => prev.map((t) =>
          t.id === targetTokenId
            ? { ...t, position_x: targetPos.x, position_y: targetPos.y }
            : t,
        ));
      } finally {
        await persistClearedEffects();
        setTimeout(() => {
          const at = inflight.get(key);
          if (at && Date.now() - at >= INFLIGHT_TTL_MS) {
            inflight.delete(key);
          }
        }, INFLIGHT_TTL_MS + 500);
      }
    };

    const unsubscribe = subscribeAppEvent("forcedMovementPending", (detail) => {
      void consume(detail);
    });
    return () => {
      unsubscribe();
      inflight.clear();
    };
  }, []);
}
