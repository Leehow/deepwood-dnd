import { afterEach, describe, expect, it, vi } from "vitest";

import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";

describe("appEventBus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers sidebarSpellCast with targetTokenIds to a real subscriber exactly once", () => {
    // Locks in the contract that the DM-hotbar onConfirmMulti flow relies on:
    // publishAppEvent("sidebarSpellCast", {... targetTokenIds: [...] })
    // must reach the controller's subscriber synchronously and exactly once,
    // even when the publisher omits the singular targetTokenId field.
    const calls: Array<Record<string, unknown>> = [];
    const unsubscribe = subscribeAppEvent("sidebarSpellCast", (detail) => {
      calls.push(detail as Record<string, unknown>);
    });

    publishAppEvent("sidebarSpellCast", {
      spell: { id: "bless", name: "祝福术" },
      sourceTokenId: 527,
      targetTokenIds: [533, 534, 535],
      slotLevel: 1,
      characterId: 50,
    } as any);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      sourceTokenId: 527,
      targetTokenIds: [533, 534, 535],
    });

    unsubscribe();
  });

  it("publishes to typed subscribers and legacy DOM listeners without duplicate typed callbacks", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("spellCastChat", typedHandler);
    window.addEventListener("spellCastChat", domHandler as EventListener);

    const detail = { message: "test message", characterId: 7 };
    publishAppEvent("spellCastChat", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("spellCastChat", domHandler as EventListener);
  });

  it("bridges legacy DOM events into typed subscribers", () => {
    const typedHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("consumeSpellSlot", typedHandler);

    const legacyDetail = { level: 3, characterId: 42 };
    window.dispatchEvent(new CustomEvent("consumeSpellSlot", { detail: legacyDetail }));

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(legacyDetail);

    unsubscribe();
  });

  it("publishes character update events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("characterUpdated", typedHandler);
    window.addEventListener("characterUpdated", domHandler as EventListener);

    const detail = { character_id: 7, experience_points: 900 };
    publishAppEvent("characterUpdated", detail);

    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("characterUpdated", domHandler as EventListener);
  });

  it("publishes character level-up events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("characterLevelUp", typedHandler);
    window.addEventListener("characterLevelUp", domHandler as EventListener);

    const detail = {
      character_id: 7,
      character_name: "艾拉",
      level: 5,
      class_id: "wizard",
      max_hp: 32,
    };
    publishAppEvent("characterLevelUp", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("characterLevelUp", domHandler as EventListener);
  });

  it("publishes combat action usage events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("combatActionUsed", typedHandler);
    window.addEventListener("combatActionUsed", domHandler as EventListener);

    const detail = { type: "movement", amount: 15, tokenId: 11 };
    publishAppEvent("combatActionUsed", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("combatActionUsed", domHandler as EventListener);
  });

  it("publishes spell targeting events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("startSpellTargeting", typedHandler);
    window.addEventListener("startSpellTargeting", domHandler as EventListener);

    const detail = {
      spell: { id: "guiding-bolt", name: "引导箭" },
      slotLevel: 1,
      characterId: 18,
      mode: "single" as const,
      freecast: true,
    };
    publishAppEvent("startSpellTargeting", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("startSpellTargeting", domHandler as EventListener);
  });

  it("publishes sidebar spell cast events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("sidebarSpellCast", typedHandler);
    window.addEventListener("sidebarSpellCast", domHandler as EventListener);

    const detail = {
      spell: { id: "guiding-bolt", name: "引导箭" },
      sourceTokenId: 11,
      targetTokenId: 12,
      slotLevel: 1,
      characterId: 7,
    };
    publishAppEvent("sidebarSpellCast", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("sidebarSpellCast", domHandler as EventListener);
  });

  it("publishes spell cast started events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("spellCastStarted", typedHandler);
    window.addEventListener("spellCastStarted", domHandler as EventListener);

    const detail = {
      characterId: 18,
      tokenId: 11,
      spell: { id: "glyph-of-warding", name: "守护结界" },
      level: 3,
      ritualCast: false,
      response: { success: true },
    };
    publishAppEvent("spellCastStarted", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("spellCastStarted", domHandler as EventListener);
  });

  it("publishes equipment weapon use events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("equipmentWeaponUse", typedHandler);
    window.addEventListener("equipmentWeaponUse", domHandler as EventListener);

    const detail = {
      characterId: 7,
      item: { id: "longsword", name: "长剑", damage: "1d8" },
      slot: "main_hand",
    };
    publishAppEvent("equipmentWeaponUse", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("equipmentWeaponUse", domHandler as EventListener);
  });

  it("publishes ws chat message events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("wsChatMessage", typedHandler);
    window.addEventListener("ws-chat-message", domHandler as EventListener);

    const detail = {
      message_id: 99,
      user_id: "other-user",
      text: "你好",
    };
    publishAppEvent("wsChatMessage", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("ws-chat-message", domHandler as EventListener);
  });

  it("publishes anchor placed events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("anchorPlaced", typedHandler);
    window.addEventListener("anchorPlaced", domHandler as EventListener);

    const detail = {};
    publishAppEvent("anchorPlaced", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("anchorPlaced", domHandler as EventListener);
  });

  it("publishes equipment consumable use events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("equipmentConsumableUse", typedHandler);
    window.addEventListener("equipmentConsumableUse", domHandler as EventListener);

    const detail = {
      characterId: 18,
      item: { id: "healing_potion", name: "治疗药水" },
    };
    publishAppEvent("equipmentConsumableUse", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("equipmentConsumableUse", domHandler as EventListener);
  });

  it("publishes hotbar add item events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("hotbarAddItem", typedHandler);
    window.addEventListener("hotbar-add-item", domHandler as EventListener);

    const detail = {
      type: "item",
      id: "rope",
      name: "麻绳",
      icon: "◆",
      meta: { quantity: 1 },
    };
    publishAppEvent("hotbarAddItem", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("hotbar-add-item", domHandler as EventListener);
  });

  it("publishes hotbar drop to slot events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("hotbarDropToSlot", typedHandler);
    window.addEventListener("hotbar-drop-to-slot", domHandler as EventListener);

    const detail = {
      slotIdx: 4,
      item: {
        type: "item",
        id: "torch",
        name: "火把",
        icon: "◆",
        meta: { quantity: 2 },
      },
    };
    publishAppEvent("hotbarDropToSlot", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("hotbar-drop-to-slot", domHandler as EventListener);
  });

  it("publishes open-right-panel-tab events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("openRightPanelTab", typedHandler);
    window.addEventListener("openRightPanelTab", domHandler as EventListener);

    const detail = { tab: "chat" };
    publishAppEvent("openRightPanelTab", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("openRightPanelTab", domHandler as EventListener);
  });

  it("publishes open-combat-action-modal events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("openCombatActionModal", typedHandler);
    window.addEventListener("openCombatActionModal", domHandler as EventListener);

    const detail = { tokenId: 42 };
    publishAppEvent("openCombatActionModal", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("openCombatActionModal", domHandler as EventListener);
  });

  it("publishes toast events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("showToast", typedHandler);
    window.addEventListener("showToast", domHandler as EventListener);

    const detail = { message: "toast message", type: "warning" as const, duration: 1800 };
    publishAppEvent("showToast", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("showToast", domHandler as EventListener);
  });

  it("publishes combat storage events to typed and legacy listeners", () => {
    const typedUpdatedHandler = vi.fn();
    const typedDeletedHandler = vi.fn();
    const domUpdatedHandler = vi.fn();
    const domDeletedHandler = vi.fn();
    const unsubscribeUpdated = subscribeAppEvent("combatStorageUpdated", typedUpdatedHandler);
    const unsubscribeDeleted = subscribeAppEvent("combatStorageDeleted", typedDeletedHandler);
    window.addEventListener("combatStorageUpdated", domUpdatedHandler as EventListener);
    window.addEventListener("combatStorageDeleted", domDeletedHandler as EventListener);

    const updatedDetail = {
      object_type: "combat",
      object_id: "current",
      is_active: true,
      data: { status: "in_progress" },
    };
    const deletedDetail = {
      data: { object_type: "combat" },
    };

    publishAppEvent("combatStorageUpdated", updatedDetail);
    publishAppEvent("combatStorageDeleted", deletedDetail);

    expect(typedUpdatedHandler).toHaveBeenCalledWith(updatedDetail);
    expect(typedDeletedHandler).toHaveBeenCalledWith(deletedDetail);
    expect(domUpdatedHandler).toHaveBeenCalledTimes(1);
    expect(domDeletedHandler).toHaveBeenCalledTimes(1);

    unsubscribeUpdated();
    unsubscribeDeleted();
    window.removeEventListener("combatStorageUpdated", domUpdatedHandler as EventListener);
    window.removeEventListener("combatStorageDeleted", domDeletedHandler as EventListener);
  });

  it("publishes map interaction events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("openChestInteraction", typedHandler);
    window.addEventListener("openChestInteraction", domHandler as EventListener);

    const detail = { chestId: 12, tokenId: 45 };
    publishAppEvent("openChestInteraction", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("openChestInteraction", domHandler as EventListener);
  });

  it("publishes map token selection events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("mapTokenSelected", typedHandler);
    window.addEventListener("mapTokenSelected", domHandler as EventListener);

    const detail = { tokenId: 12 };
    publishAppEvent("mapTokenSelected", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("mapTokenSelected", domHandler as EventListener);
  });

  it("publishes monster avatar update events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("monsterAvatarUpdated", typedHandler);
    window.addEventListener("monsterAvatarUpdated", domHandler as EventListener);

    const detail = { monsterInstanceId: 77, avatarUrl: "/avatars/ogre.png" };
    publishAppEvent("monsterAvatarUpdated", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("monsterAvatarUpdated", domHandler as EventListener);
  });

  it("publishes roll modifier update events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("rollModifierUpdated", typedHandler);
    window.addEventListener("rollModifierUpdated", domHandler as EventListener);

    const detail = { tokenId: 77, modifier: "advantage" as const, senderId: "dm" };
    publishAppEvent("rollModifierUpdated", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("rollModifierUpdated", domHandler as EventListener);
  });

  it("publishes character HP update events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("characterHPUpdated", typedHandler);
    window.addEventListener("characterHPUpdated", domHandler as EventListener);

    const detail = { characterId: 18, current_hp: 12, max_hp: 24, temp_hp: 3 };
    publishAppEvent("characterHPUpdated", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("characterHPUpdated", domHandler as EventListener);
  });

  it("publishes character active effects change events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("characterActiveEffectsChanged", typedHandler);
    window.addEventListener("characterActiveEffectsChanged", domHandler as EventListener);

    const detail = {
      characterId: 18,
      activeEffects: [{ spell_buff: { spell_name: "Bless" } }],
    };
    publishAppEvent("characterActiveEffectsChanged", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("characterActiveEffectsChanged", domHandler as EventListener);
  });

  it("publishes transformation update events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("transformationUpdate", typedHandler);
    window.addEventListener("transformationUpdate", domHandler as EventListener);

    const detail = { characterId: 18, wildShapeData: { beast_name: "棕熊" } };
    publishAppEvent("transformationUpdate", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("transformationUpdate", domHandler as EventListener);
  });

  it("publishes token placement events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("tokenPlaced", typedHandler);
    window.addEventListener("tokenPlaced", domHandler as EventListener);

    const detail = { token: { id: 99, character_id: 18, map_url: "/maps/test" } };
    publishAppEvent("tokenPlaced", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("tokenPlaced", domHandler as EventListener);
  });

  it("publishes token removal events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("tokenRemoved", typedHandler);
    window.addEventListener("tokenRemoved", domHandler as EventListener);

    const detail = { tokenId: 99 };
    publishAppEvent("tokenRemoved", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("tokenRemoved", domHandler as EventListener);
  });

  it("publishes chest lifecycle events to typed and legacy listeners", () => {
    const createdTypedHandler = vi.fn();
    const createdDomHandler = vi.fn();
    const changedTypedHandler = vi.fn();
    const changedDomHandler = vi.fn();
    const unsubscribeCreated = subscribeAppEvent("chestCreated", createdTypedHandler);
    const unsubscribeChanged = subscribeAppEvent("chestStateChanged", changedTypedHandler);
    window.addEventListener("chestCreated", createdDomHandler as EventListener);
    window.addEventListener("chestStateChanged", changedDomHandler as EventListener);

    const createdDetail = { chest: { id: 7, name: "古旧宝箱" } };
    const changedDetail = { chest: { id: 7, state: "open" }, eventType: "chest_opened" };
    publishAppEvent("chestCreated", createdDetail);
    publishAppEvent("chestStateChanged", changedDetail);

    expect(createdTypedHandler).toHaveBeenCalledWith(createdDetail);
    expect(createdDomHandler).toHaveBeenCalledTimes(1);
    expect(changedTypedHandler).toHaveBeenCalledWith(changedDetail);
    expect(changedDomHandler).toHaveBeenCalledTimes(1);

    unsubscribeCreated();
    unsubscribeChanged();
    window.removeEventListener("chestCreated", createdDomHandler as EventListener);
    window.removeEventListener("chestStateChanged", changedDomHandler as EventListener);
  });

  it("publishes status effect sync events to typed and legacy listeners", () => {
    const monsterTypedHandler = vi.fn();
    const monsterDomHandler = vi.fn();
    const characterTypedHandler = vi.fn();
    const characterDomHandler = vi.fn();
    const unsubscribeMonster = subscribeAppEvent("monsterStatusEffectsChanged", monsterTypedHandler);
    const unsubscribeCharacter = subscribeAppEvent("characterStatusEffectsChanged", characterTypedHandler);
    window.addEventListener("monsterStatusEffectsChanged", monsterDomHandler as EventListener);
    window.addEventListener("characterStatusEffectsChanged", characterDomHandler as EventListener);

    const monsterDetail = { monsterInstanceId: 21, statusEffects: [{ key: "poisoned" }] };
    const characterDetail = { characterId: 7, statusEffects: [{ key: "blessed" }] };
    publishAppEvent("monsterStatusEffectsChanged", monsterDetail);
    publishAppEvent("characterStatusEffectsChanged", characterDetail);

    expect(monsterTypedHandler).toHaveBeenCalledWith(monsterDetail);
    expect(monsterDomHandler).toHaveBeenCalledTimes(1);
    expect(characterTypedHandler).toHaveBeenCalledWith(characterDetail);
    expect(characterDomHandler).toHaveBeenCalledTimes(1);

    unsubscribeMonster();
    unsubscribeCharacter();
    window.removeEventListener("monsterStatusEffectsChanged", monsterDomHandler as EventListener);
    window.removeEventListener("characterStatusEffectsChanged", characterDomHandler as EventListener);
  });

  it("publishes death save update events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("death_save_update", typedHandler);
    window.addEventListener("death_save_update", domHandler as EventListener);

    const detail = {
      token_id: 31,
      death_saves: { successes: 1, failures: 2, stabilized: false },
      revived: false,
      roll: 13,
    };
    publishAppEvent("death_save_update", detail);

    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("death_save_update", domHandler as EventListener);
  });

  it("publishes spell slot sync events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("spellSlotsChanged", typedHandler);
    window.addEventListener("spellSlotsChanged", domHandler as EventListener);

    const detail = {
      characterId: 12,
      remaining: [4, 3, 2],
      max: [4, 3, 3],
    };
    publishAppEvent("spellSlotsChanged", detail);

    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("spellSlotsChanged", domHandler as EventListener);
  });

  it("publishes character creation events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("characterCreated", typedHandler);
    window.addEventListener("characterCreated", domHandler as EventListener);

    const detail = {
      user_id: "player-1",
      character_id: 77,
      character_name: "Mira",
    };
    publishAppEvent("characterCreated", detail);

    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("characterCreated", domHandler as EventListener);
  });

  it("publishes AI generation progress events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("aiGenerateProgress", typedHandler);
    window.addEventListener("aiGenerateProgress", domHandler as EventListener);

    const detail = {
      stage: 2,
      total_stages: 5,
      stage_name: "生成画像",
      detail: "正在生成角色立绘",
    };
    publishAppEvent("aiGenerateProgress", detail);

    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("aiGenerateProgress", domHandler as EventListener);
  });

  it("publishes DM AI generation progress events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("dmGenerateProgress", typedHandler);
    window.addEventListener("dmGenerateProgress", domHandler as EventListener);

    const detail = {
      type: "dm_generate_progress",
      stage: 2,
      stage_name: "生成角色草稿",
      detail: "正在整理角色背景",
    };
    publishAppEvent("dmGenerateProgress", detail);

    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("dmGenerateProgress", domHandler as EventListener);
  });

  it("publishes character selection events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("characterSelected", typedHandler);
    window.addEventListener("characterSelected", domHandler as EventListener);

    const detail = {
      user_id: "player-1",
      character_id: 42,
    };
    publishAppEvent("characterSelected", detail);

    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("characterSelected", domHandler as EventListener);
  });

  it("publishes spell slot update bridge events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("spellSlotsUpdate", typedHandler);
    window.addEventListener("spellSlotsUpdate", domHandler as EventListener);

    const detail = {
      character_id: 12,
      spell_slots_state: [4, 2, 1],
    };
    publishAppEvent("spellSlotsUpdate", detail);

    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("spellSlotsUpdate", domHandler as EventListener);
  });

  it("publishes character level change bridge events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("characterLevelChanged", typedHandler);
    window.addEventListener("characterLevelChanged", domHandler as EventListener);

    const detail = {
      character_id: 12,
      character_name: "Mira",
      level: 6,
      class_id: "wizard",
    };
    publishAppEvent("characterLevelChanged", detail);

    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("characterLevelChanged", domHandler as EventListener);
  });

  it("publishes character list refresh bridge events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("characterListNeedsRefresh", typedHandler);
    window.addEventListener("characterListNeedsRefresh", domHandler as EventListener);

    const detail = {
      type: "character_post_creation_complete",
      data: { character_id: 12 },
    };
    publishAppEvent("characterListNeedsRefresh", detail);

    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("characterListNeedsRefresh", domHandler as EventListener);
  });

  it("publishes rest grant events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("restGrant", typedHandler);
    window.addEventListener("restGrant", domHandler as EventListener);

    const detail = { restType: "short" as const };
    publishAppEvent("restGrant", detail);

    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("restGrant", domHandler as EventListener);
  });

  it("publishes attack distance preview events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("attackDistanceLine", typedHandler);
    window.addEventListener("attackDistanceLine", domHandler as EventListener);

    const detail = { normalRange: 30, maxRange: 120, sourceTokenId: 21 };
    publishAppEvent("attackDistanceLine", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("attackDistanceLine", domHandler as EventListener);
  });

  it("publishes hotbar attack execute events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("hotbarAttackExecute", typedHandler);
    window.addEventListener("hotbarAttackExecute", domHandler as EventListener);

    const detail = {
      sourceCharacterId: 9,
      targetTokenId: 12,
      attack: {
        key: "weapon_longsword_main",
        name: "长剑",
        nameEn: "Longsword",
        icon: "⚔️",
        description: "挥砍攻击",
      },
      modifiers: { powerAttack: true },
    };
    publishAppEvent("hotbarAttackExecute", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("hotbarAttackExecute", domHandler as EventListener);
  });

  it("publishes monster action targeting events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("monsterActionTargeting", typedHandler);
    window.addEventListener("monsterActionTargeting", domHandler as EventListener);

    const detail = {
      action: {
        name: "利爪",
        description: "近战武器攻击",
        type: "action" as const,
        range: "5尺",
        attack_bonus: 6,
        damage: { dice: "1d8", bonus: 4, type: "slashing" },
      },
      sourceTokenId: 44,
      normalRange: 5,
      maxRange: 5,
    };
    publishAppEvent("monsterActionTargeting", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("monsterActionTargeting", domHandler as EventListener);
  });

  it("publishes monster area action events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("startMonsterAreaAction", typedHandler);
    window.addEventListener("startMonsterAreaAction", domHandler as EventListener);

    const detail = {
      sourceTokenId: 31,
      actionName: "火焰吐息",
      breathWeapon: {
        shape: "cone",
        size: "60尺",
        save: "dexterity",
        saveCn: "敏捷",
        shapeCn: "锥",
      },
      damageType: "fire",
      damageTypeCn: "火焰",
      damageDice: "12d8",
      saveDC: 21,
      saveEffect: "half",
    };
    publishAppEvent("startMonsterAreaAction", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("startMonsterAreaAction", domHandler as EventListener);
  });

  it("publishes breath weapon events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("startBreathWeapon", typedHandler);
    window.addEventListener("startBreathWeapon", domHandler as EventListener);

    const detail = {
      sourceCharacterId: 8,
      breathWeapon: {
        shape: "line",
        size: "30尺",
        save: "dexterity",
        saveCn: "敏捷",
        shapeCn: "线状",
      },
      damageType: "lightning",
      damageTypeCn: "闪电",
      damageDice: "4d6",
      subraceName: "blue",
      saveDC: 15,
    };
    publishAppEvent("startBreathWeapon", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("startBreathWeapon", domHandler as EventListener);
  });

  it("publishes combat move result events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("combatMoveResult", typedHandler);
    window.addEventListener("combatMoveResult", domHandler as EventListener);

    const detail = {
      tokenId: 5,
      tokenName: "游侠",
      fromX: 1,
      fromY: 2,
      toX: 4,
      toY: 2,
      distance: 15,
    };
    publishAppEvent("combatMoveResult", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("combatMoveResult", domHandler as EventListener);
  });

  it("publishes token performed action events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("tokenPerformedAction", typedHandler);
    window.addEventListener("tokenPerformedAction", domHandler as EventListener);

    const detail = { tokenId: 42 };
    publishAppEvent("tokenPerformedAction", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("tokenPerformedAction", domHandler as EventListener);
  });

  it("publishes combat movement changed events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("combatMovementChanged", typedHandler);
    window.addEventListener("combatMovementChanged", domHandler as EventListener);

    const detail = { changedBy: "turnActions" };
    publishAppEvent("combatMovementChanged", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("combatMovementChanged", domHandler as EventListener);
  });

  it("publishes combat turn changed events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("combatTurnChanged", typedHandler);
    window.addEventListener("combatTurnChanged", domHandler as EventListener);

    const detail = { activeTokenId: 22, round: 5 };
    publishAppEvent("combatTurnChanged", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("combatTurnChanged", domHandler as EventListener);
  });

  it("publishes combat turn started events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("combatTurnStarted", typedHandler);
    window.addEventListener("combatTurnStarted", domHandler as EventListener);

    const detail = { tokenId: 33, round: 6 };
    publishAppEvent("combatTurnStarted", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("combatTurnStarted", domHandler as EventListener);
  });

  it("publishes combat end turn events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("combatEndTurn", typedHandler);
    window.addEventListener("combatEndTurn", domHandler as EventListener);

    const detail = { source: "initiative-tracker" };
    publishAppEvent("combatEndTurn", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("combatEndTurn", domHandler as EventListener);
  });

  it("publishes combat restore movement events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("combatRestoreMovement", typedHandler);
    window.addEventListener("combatRestoreMovement", domHandler as EventListener);

    const detail = { tokenId: 11, toX: 4, toY: 5, restoreDistance: 15 };
    publishAppEvent("combatRestoreMovement", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("combatRestoreMovement", domHandler as EventListener);
  });

  it("publishes combat new round events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("combatNewRound", typedHandler);
    window.addEventListener("combatNewRound", domHandler as EventListener);

    const detail = { round: 6 };
    publishAppEvent("combatNewRound", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("combatNewRound", domHandler as EventListener);
  });

  it("publishes combat turn notification events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("combatTurnNotification", typedHandler);
    window.addEventListener("combatTurnNotification", domHandler as EventListener);

    const detail = { name: "游侠", round: 6 };
    publishAppEvent("combatTurnNotification", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("combatTurnNotification", domHandler as EventListener);
  });

  it("publishes manual reaction mode change events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("manualReactionModeChanged", typedHandler);
    window.addEventListener("manualReactionModeChanged", domHandler as EventListener);

    const detail = { active: true, sourceTokenId: 18 };
    publishAppEvent("manualReactionModeChanged", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("manualReactionModeChanged", domHandler as EventListener);
  });

  it("publishes manual reaction mode start events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("manualReactionModeStart", typedHandler);
    window.addEventListener("manualReactionModeStart", domHandler as EventListener);

    const detail = { sourceTokenId: 18, sourceCharacterId: 101 };
    publishAppEvent("manualReactionModeStart", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("manualReactionModeStart", domHandler as EventListener);
  });

  it("publishes manual reaction mode end events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("manualReactionModeEnd", typedHandler);
    window.addEventListener("manualReactionModeEnd", domHandler as EventListener);

    const detail = { sourceTokenId: 18 };
    publishAppEvent("manualReactionModeEnd", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("manualReactionModeEnd", domHandler as EventListener);
  });

  it("publishes combat bonus action results to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("combatBonusActionResult", typedHandler);
    window.addEventListener("combatBonusActionResult", domHandler as EventListener);

    const detail = { tokenId: 7, tokenName: "德鲁伊", actionName: "自然大师", actionIcon: "🌳" };
    publishAppEvent("combatBonusActionResult", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("combatBonusActionResult", domHandler as EventListener);
  });

  it("publishes wild shape target requests to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("wildShapeTarget", typedHandler);
    window.addEventListener("wildShapeTarget", domHandler as EventListener);

    const detail = {
      sourceCharacterId: 18,
      execution: { configId: "wild_shape" },
    };
    publishAppEvent("wildShapeTarget", detail);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("wildShapeTarget", domHandler as EventListener);
  });
});
