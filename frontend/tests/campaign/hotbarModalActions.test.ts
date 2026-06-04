import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/api-client", () => ({
  apiFetch: vi.fn(),
}));

vi.mock("~/utils/asset-url", () => ({
  getAssetUrl: vi.fn((path: string) => `/assets/${path}`),
}));

vi.mock("~/utils/characterBubble", () => ({
  showCharacterBubble: vi.fn(),
}));

vi.mock("~/components/map/DamageNumberOverlay", () => ({
  showDamageNumber: vi.fn(),
}));

vi.mock("~/events/appEventBus", () => ({
  publishAppEvent: vi.fn(),
}));

import { showDamageNumber } from "~/components/map/DamageNumberOverlay";
import { publishAppEvent } from "~/events/appEventBus";
import {
  confirmDivineSmiteAction,
  confirmLayOnHandsAction,
  confirmSpellSlotRecoveryAction,
} from "~/campaign-shell/hotbar/hotbarModalActions";
import { apiFetch } from "~/utils/api-client";
import { showCharacterBubble } from "~/utils/characterBubble";

describe("hotbarModalActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    class MockAudio {
      volume = 1;
      play = vi.fn().mockResolvedValue(undefined);
      constructor(_src?: string) {}
    }
    vi.stubGlobal("Audio", MockAudio);
  });

  it("confirms lay on hands and shows heal feedback", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    const result = await confirmLayOnHandsAction({
      campaignId: "12",
      abilityConfirm: {
        abilityId: "lay_on_hands",
        sourceCharacterId: 7,
        targetTokenId: 99,
        targetName: "阿尔文",
        distanceFeet: 5,
        poolCurrent: 20,
        poolMax: 20,
      },
      hotbarCharacter: { name: "莱奥", avatar_url: "/avatar.png" },
      healAmount: 6,
      cureDisease: false,
      curePoison: true,
    });

    expect(apiFetch).toHaveBeenCalledWith("/api/characters/7/lay-on-hands", expect.objectContaining({
      method: "POST",
    }));
    expect(showCharacterBubble).toHaveBeenCalledWith(expect.objectContaining({
      characterId: 7,
      characterName: "莱奥",
      message: "圣疗术 — 治疗 阿尔文 6 点HP、中和毒素",
    }));
    expect(showDamageNumber).toHaveBeenCalledWith(expect.objectContaining({
      targetTokenId: 99,
      damage: 6,
      heal: true,
    }));
    expect(result.ok).toBe(true);
  });

  it("confirms divine smite and publishes class feature refresh", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ damage: 14 }),
    } as Response);

    const result = await confirmDivineSmiteAction({
      campaignId: 3,
      abilityConfirm: {
        abilityId: "divine_smite",
        sourceCharacterId: 8,
        targetTokenId: 33,
        targetName: "食尸鬼",
        distanceFeet: 5,
        poolCurrent: 0,
        poolMax: 0,
        spellSlotLevel: 2,
      },
      hotbarCharacter: { name: "凯恩", avatar_url: "/smite.png" },
    });

    expect(showCharacterBubble).toHaveBeenCalledWith(expect.objectContaining({
      characterId: 8,
      message: "神圣惩击 — 对 食尸鬼 造成 14 点光耀伤害（2环位）",
    }));
    expect(showDamageNumber).toHaveBeenCalledWith(expect.objectContaining({
      targetTokenId: 33,
      damage: 14,
    }));
    expect(publishAppEvent).toHaveBeenCalledWith("classFeatureUsesUpdated", { characterId: 8 });
    expect(result.ok).toBe(true);
  });

  it("applies spell slot recovery back into hotbar character state", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ spell_slots_state: [0, 3, 2] }),
    } as Response);

    const setHotbarCharacter = vi.fn();
    const onPlaySound = vi.fn();

    const result = await confirmSpellSlotRecoveryAction({
      campaignId: "5",
      sourceCharacterId: 18,
      endpoint: "arcane-recovery",
      recoveries: { 1: 1, 2: 1 },
      hotbarCharacter: { name: "米拉", avatar_url: "/wizard.png" },
      setHotbarCharacter,
      defaultCharacterName: "法师",
      bubbleMessage: "奥术恢复 — 恢复了法术位",
      onPlaySound,
    });

    const updater = setHotbarCharacter.mock.calls[0][0];
    expect(updater({ id: 18, spell_slots_state: [0, 2, 1] })).toEqual({
      id: 18,
      spell_slots_state: [0, 3, 2],
    });
    expect(onPlaySound).toHaveBeenCalled();
    expect(showCharacterBubble).toHaveBeenCalledWith(expect.objectContaining({
      characterId: 18,
      message: "奥术恢复 — 恢复了法术位",
    }));
    expect(publishAppEvent).toHaveBeenCalledWith("classFeatureUsesUpdated", { characterId: 18 });
    expect(result.ok).toBe(true);
  });
});
