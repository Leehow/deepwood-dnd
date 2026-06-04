/**
 * LevelUpNotification Component
 *
 * Displays a notification when a character levels up
 * Shows character name, new level, and key stat changes (HP, ability scores)
 */

import { useEffect } from "react";
import { subscribeAppEvent, type CharacterLevelUpEventPayload } from "~/events/appEventBus";
import { createLogger } from "~/utils/logger";
import { showGlobalToast } from "~/components/ui/Toast";

const logger = createLogger("LevelUpNotification");

export function LevelUpNotification() {
  useEffect(() => {
    const handler = (data: CharacterLevelUpEventPayload) => {
      logger.debug("[LevelUpNotification] Received level up event:", data);

      const className = data.class_id
        .split("_")
        .map(w => w[0].toUpperCase() + w.slice(1))
        .join(" ");
      const hpText = data.max_hp ? `，最大生命值 ${data.max_hp}` : '';

      showGlobalToast({
        message: `🎉 ${data.character_name} 升到 ${data.level} 级（${className}${hpText}）`,
        type: 'success',
        duration: 8000,
      });
    };

    return subscribeAppEvent("characterLevelUp", handler);
  }, []);

  return null;
}
