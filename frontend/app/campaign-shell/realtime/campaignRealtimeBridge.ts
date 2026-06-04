import type { WebSocketMessage } from "~/hooks/useWebSocket";
import {
  publishAppEvent,
  type CharacterUpdatedEventPayload,
  type RewardUpdateEventPayload,
} from "~/events/appEventBus";

type CampaignRole = "dm" | "player";

interface CampaignRealtimeBridgeOptions {
  role: CampaignRole;
  currentUserId?: string;
  setIsCombatActive: (active: boolean) => void;
}

function getCharacterId(message: WebSocketMessage<Record<string, any>>): number | string | undefined {
  return message.data?.character_id ?? (message as Record<string, any>).character_id;
}

function getMessagePayload(message: WebSocketMessage<Record<string, any>>): Record<string, any> {
  return (message.data ?? message) as Record<string, any>;
}

function isCurrentUserEcho(messageUserId: unknown, currentUserId?: string): boolean {
  return typeof messageUserId === "string" && currentUserId !== undefined && messageUserId === currentUserId;
}

export function bridgeCampaignRealtimeMessage(
  message: WebSocketMessage<Record<string, any>>,
  options: CampaignRealtimeBridgeOptions,
): boolean {
  const data = getMessagePayload(message);

  if ((message.type === "storage_created" || message.type === "storage_updated") && data.object?.object_type === "combat") {
    publishAppEvent("combatStorageUpdated", data.object);
    options.setIsCombatActive(data.object?.is_active !== false);
    return true;
  }

  if (message.type === "storage_deleted" && data.object_type === "combat") {
    publishAppEvent("combatStorageDeleted", message as any);
    options.setIsCombatActive(false);
    return true;
  }

  if (message.type === "reward_update") {
    publishAppEvent("rewardUpdate", message as unknown as RewardUpdateEventPayload);
    return true;
  }

  if (
    message.type === "character_updated"
    || message.type === "character_status_effects_update"
    || message.type === "character_xp_update"
    || message.type === "character_spell_slots_update"
  ) {
    const characterId = getCharacterId(message);
    publishAppEvent("characterUpdated", {
      character_id: characterId,
      data: { ...message, character_id: characterId },
    });
    return true;
  }

  if (message.type === "spell_slots_update" || message.type === "spell_slot_consumed") {
    publishAppEvent("spellSlotsUpdate", {
      ...(message as any),
      character_id: getCharacterId(message),
      spell_slots_state: data.spell_slots_state ?? data.new_spell_slots_state,
    });
    return true;
  }

  if (message.type === "character_equipment_updated") {
    publishAppEvent("characterEquipmentUpdated", {
      characterId: getCharacterId(message),
      equipment: data.equipment,
      currency: data.currency,
      reason: data.reason,
    });
    return true;
  }

  if (message.type === "character_feature_uses_updated") {
    publishAppEvent("classFeatureUsesUpdated", {
      characterId: getCharacterId(message),
      featureId: data.feature_id,
      currentUses: data.current_uses,
      maxUses: data.max_uses,
    });
    return true;
  }

  if (message.type === "character_avatar_updated") {
    const characterId = getCharacterId(message);
    publishAppEvent("characterUpdated", {
      character_id: characterId,
      data: { ...message, character_id: characterId },
    });
    return true;
  }

  if (message.type === "resource_update") {
    const characterId = getCharacterId(message);
    publishAppEvent("characterUpdated", {
      character_id: characterId,
      data: { ...message, character_id: characterId },
    });
    if (characterId !== undefined) {
      publishAppEvent("classFeatureUsesUpdated", { characterId });
    }
    return true;
  }

  if (message.type === "resource_use" && data) {
    publishAppEvent("characterUpdated", { data });
    if (data.character_id !== undefined && !isCurrentUserEcho(data.user_id, options.currentUserId)) {
      publishAppEvent("classFeatureUsesUpdated", { characterId: data.character_id });
    }
    return true;
  }

  if (message.type === "character_post_creation_complete") {
    publishAppEvent("characterUpdated", message as unknown as CharacterUpdatedEventPayload);
    if (options.role === "player") {
      publishAppEvent("characterListNeedsRefresh", message as any);
    }
    return true;
  }

  return false;
}
