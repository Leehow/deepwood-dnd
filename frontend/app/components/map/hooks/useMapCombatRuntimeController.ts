import { useEffect, useState } from "react";

import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import { fetchCampaignCombatStateCached } from "~/utils/combatStateCache";
import { getCombatTurnIndex } from "~/utils/combatTurnIndex";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapCombatRuntimeController");

type ShowToastFn = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface ManualReactionModeState {
  sourceTokenId: number;
  sourceCharacterId?: number | null;
}

interface UseMapCombatRuntimeControllerArgs {
  campaignId: string;
  userId?: string | null;
  showToast: ShowToastFn;
}

export function useMapCombatRuntimeController({
  campaignId,
  userId,
  showToast,
}: UseMapCombatRuntimeControllerArgs) {
  const [manualReactionMode, setManualReactionMode] = useState<ManualReactionModeState | null>(null);
  const [combatActiveTokenId, setCombatActiveTokenId] = useState<number | null>(null);

  useEffect(() => {
    const handleStart = (detail: ManualReactionModeState) => {
      setManualReactionMode({
        sourceTokenId: detail.sourceTokenId,
        sourceCharacterId: detail.sourceCharacterId,
      });
      showToast("反应行动模式已开启，右键地图目标以选择反应。", "info");
    };

    const handleEnd = () => {
      setManualReactionMode(null);
    };

    const unsubscribeStart = subscribeAppEvent("manualReactionModeStart", handleStart);
    const unsubscribeEnd = subscribeAppEvent("manualReactionModeEnd", handleEnd);
    return () => {
      unsubscribeStart();
      unsubscribeEnd();
    };
  }, [showToast]);

  useEffect(() => {
    publishAppEvent("manualReactionModeChanged", {
      active: !!manualReactionMode,
      sourceTokenId: manualReactionMode?.sourceTokenId,
    });
  }, [manualReactionMode]);

  useEffect(() => {
    return subscribeAppEvent("combatReactionUsed", (detail) => {
      const reactorTokenId = detail?.reactor_token_id;
      if (reactorTokenId && manualReactionMode?.sourceTokenId === reactorTokenId) {
        setManualReactionMode(null);
      }
    });
  }, [manualReactionMode]);

  useEffect(() => {
    const loadCombatState = async () => {
      try {
        const combatState = await fetchCampaignCombatStateCached(campaignId, {
          userId: userId ?? undefined,
        });
        if (
          combatState &&
          combatState.is_active !== false &&
          combatState.data?.status === "in_progress" &&
          combatState.data?.order?.length
        ) {
          const idx = getCombatTurnIndex(combatState.data, combatState.data.order.length);
          setCombatActiveTokenId(combatState.data.order[idx] ?? null);
        }
      } catch {
        // Combat not active or unavailable, ignore.
      }
    };

    loadCombatState();
  }, [campaignId, userId]);

  useEffect(() => {
    const handleUpdate = (object: any) => {
      if (object?.object_type === "combat" && object?.object_id === "current") {
        const combat = object.data;
        if (object.is_active !== false && combat?.status === "in_progress" && combat?.order?.length) {
          const idx = getCombatTurnIndex(combat, combat.order.length);
          setCombatActiveTokenId(combat.order[idx] ?? null);
        } else {
          setCombatActiveTokenId(null);
        }
      }
    };

    const handleDelete = (object: any) => {
      if (!object || object.data?.object_type === "combat" || object.object_type === "combat") {
        logger.debug("[Combat] Combat deleted, clearing active token");
        setCombatActiveTokenId(null);
      }
    };

    const unsubscribeStorageUpdated = subscribeAppEvent("combatStorageUpdated", handleUpdate as any);
    const unsubscribeStorageDeleted = subscribeAppEvent("combatStorageDeleted", handleDelete as any);
    return () => {
      unsubscribeStorageUpdated();
      unsubscribeStorageDeleted();
    };
  }, []);

  return {
    combatActiveTokenId,
    manualReactionMode,
    setManualReactionMode,
  };
}
