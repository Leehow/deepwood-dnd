import { describe, expect, it, vi } from "vitest";

import { bridgeCampaignRealtimeMessage } from "~/campaign-shell/realtime/campaignRealtimeBridge";
import { subscribeAppEvent } from "~/events/appEventBus";

describe("campaignRealtimeBridge", () => {
  it("publishes reward updates through the typed event bus", () => {
    const rewardHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("rewardUpdate", rewardHandler);
    const setIsCombatActive = vi.fn();

    const handled = bridgeCampaignRealtimeMessage(
      { type: "reward_update", data: { reward_type: "xp" } },
      { role: "player", setIsCombatActive },
    );

    expect(handled).toBe(true);
    expect(rewardHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: "reward_update" }),
    );

    unsubscribe();
  });

  it("forwards combat storage updates to legacy DOM listeners and combat state", () => {
    const combatStorageHandler = vi.fn();
    const setIsCombatActive = vi.fn();
    window.addEventListener("combatStorageUpdated", combatStorageHandler as EventListener);

    const handled = bridgeCampaignRealtimeMessage(
      {
        type: "storage_updated",
        data: {
          object: {
            object_type: "combat",
            is_active: true,
            object_id: "combat-1",
          },
        },
      },
      { role: "dm", setIsCombatActive },
    );

    expect(handled).toBe(true);
    expect(setIsCombatActive).toHaveBeenCalledWith(true);
    expect(combatStorageHandler).toHaveBeenCalledTimes(1);

    window.removeEventListener("combatStorageUpdated", combatStorageHandler as EventListener);
  });

  it("bridges resource updates into character and class-feature refresh events", () => {
    const characterUpdatedHandler = vi.fn();
    const classFeatureHandler = vi.fn();
    const unsubscribeCharacter = subscribeAppEvent("characterUpdated", characterUpdatedHandler);
    const unsubscribeClassFeature = subscribeAppEvent("classFeatureUsesUpdated", classFeatureHandler);

    bridgeCampaignRealtimeMessage(
      {
        type: "resource_update",
        data: { character_id: 12, resource_id: "lay_on_hands" },
      },
      { role: "player", setIsCombatActive: vi.fn() },
    );

    expect(characterUpdatedHandler).toHaveBeenCalledTimes(1);
    expect(classFeatureHandler).toHaveBeenCalledWith({ characterId: 12 });

    unsubscribeCharacter();
    unsubscribeClassFeature();
  });

  it("does not rebroadcast class-feature refreshes for the sender's own resource_use echo", () => {
    const characterUpdatedHandler = vi.fn();
    const classFeatureHandler = vi.fn();
    const unsubscribeCharacter = subscribeAppEvent("characterUpdated", characterUpdatedHandler);
    const unsubscribeClassFeature = subscribeAppEvent("classFeatureUsesUpdated", classFeatureHandler);

    bridgeCampaignRealtimeMessage(
      {
        type: "resource_use",
        data: {
          character_id: 12,
          resource_id: "lay_on_hands",
          user_id: "player-1",
        },
      },
      {
        role: "player",
        currentUserId: "player-1",
        setIsCombatActive: vi.fn(),
      },
    );

    expect(characterUpdatedHandler).toHaveBeenCalledTimes(1);
    expect(classFeatureHandler).not.toHaveBeenCalled();

    unsubscribeCharacter();
    unsubscribeClassFeature();
  });

  it("bridges character equipment updates through the typed event bus", () => {
    const equipmentHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("characterEquipmentUpdated", equipmentHandler);

    const handled = bridgeCampaignRealtimeMessage(
      {
        type: "character_equipment_updated",
        data: {
          character_id: 21,
          equipment: [{ id: "component-pouch", quantity: 1 }],
          currency: { gp: 3 },
          reason: "partial_update",
        },
      },
      { role: "player", setIsCombatActive: vi.fn() },
    );

    expect(handled).toBe(true);
    expect(equipmentHandler).toHaveBeenCalledWith({
      characterId: 21,
      equipment: [{ id: "component-pouch", quantity: 1 }],
      currency: { gp: 3 },
      reason: "partial_update",
    });

    unsubscribe();
  });

  it("bridges legacy spell_slot_consumed messages into spell slot update events", () => {
    const spellSlotHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("spellSlotsUpdate", spellSlotHandler);

    const handled = bridgeCampaignRealtimeMessage(
      {
        type: "spell_slot_consumed",
        character_id: 21,
        slot_level: 1,
        new_spell_slots_state: [0, 0, 0, 0],
      } as any,
      { role: "player", setIsCombatActive: vi.fn() },
    );

    expect(handled).toBe(true);
    expect(spellSlotHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        character_id: 21,
        spell_slots_state: [0, 0, 0, 0],
      }),
    );

    unsubscribe();
  });

  it("bridges character feature use updates through the typed event bus", () => {
    const featureHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("classFeatureUsesUpdated", featureHandler);

    const handled = bridgeCampaignRealtimeMessage(
      {
        type: "character_feature_uses_updated",
        data: {
          character_id: 8,
          feature_id: "lay_on_hands",
          current_uses: 12,
          max_uses: 25,
        },
      },
      { role: "player", setIsCombatActive: vi.fn() },
    );

    expect(handled).toBe(true);
    expect(featureHandler).toHaveBeenCalledWith({
      characterId: 8,
      featureId: "lay_on_hands",
      currentUses: 12,
      maxUses: 25,
    });

    unsubscribe();
  });
});
