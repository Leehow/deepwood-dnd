import { useEffect } from "react";

import { subscribeAppEvent } from "~/events/appEventBus";

import type { AttackOption } from "../SelectionContextMenu";
import type { Token } from "../types/TacticalMapTypes";

interface UseMapHotbarAttackBridgeArgs {
  tokens: Token[];
  handleAttackAction: (
    attack: AttackOption,
    sourceTokenId: number,
    targetTokenId?: number,
    inspirationDie?: string | null,
    modifiers?: { powerAttack?: boolean; useLucky?: boolean },
  ) => Promise<void>;
}

export function useMapHotbarAttackBridge({
  tokens,
  handleAttackAction,
}: UseMapHotbarAttackBridgeArgs) {
  useEffect(() => subscribeAppEvent("hotbarAttackExecute", (detail) => {
    const sourceToken = tokens.find(
      (token) => String(token.character_id) === String(detail.sourceCharacterId),
    );
    if (!sourceToken) {
      return;
    }

    void handleAttackAction(
      detail.attack,
      sourceToken.id,
      detail.targetTokenId,
      null,
      detail.modifiers,
    );
  }), [handleAttackAction, tokens]);
}
