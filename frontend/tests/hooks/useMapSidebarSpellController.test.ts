import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapSidebarSpellController } from "../../app/components/map/hooks/useMapSidebarSpellController";

const publishAppEventMock = vi.fn();
const castSpellViaAPIMock = vi.fn();
const formatSpellChatMessageMock = vi.fn();
const buildSpellCastDataMock = vi.fn();
const syncCharacterSpellSlotsFromBackendMock = vi.fn();
const showCharacterBubbleMock = vi.fn();
const apiFetchMock = vi.fn();

vi.mock("../../app/utils/api-client", () => ({
  apiFetch: (...args: any[]) => apiFetchMock(...args),
}));

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
  subscribeAppEvent: (eventName: string, listener: (detail: unknown) => void) => {
    const handler = (event: Event) => listener((event as CustomEvent).detail);
    window.addEventListener(eventName, handler as EventListener);
    return () => window.removeEventListener(eventName, handler as EventListener);
  },
}));

vi.mock("../../app/utils/characterBubble", () => ({
  showCharacterBubble: (...args: any[]) => showCharacterBubbleMock(...args),
}));

vi.mock("../../app/utils/sidebarCasting", () => ({
  castSpellViaAPI: (...args: any[]) => castSpellViaAPIMock(...args),
  formatSpellChatMessage: (...args: any[]) => formatSpellChatMessageMock(...args),
  buildSpellCastData: (...args: any[]) => buildSpellCastDataMock(...args),
  syncCharacterSpellSlotsFromBackend: (...args: any[]) => syncCharacterSpellSlotsFromBackendMock(...args),
}));

function makeArgs(overrides: Record<string, any> = {}) {
  return {
    tokens: [
      { id: 11, character_id: 18, instance_name: "牧师", position_x: 0, position_y: 0, token_size: "1x1" } as any,
      { id: 12, instance_name: "战士", position_x: 1, position_y: 0, token_size: "1x1" } as any,
    ],
    campaignId: "6",
    gridUnitLength: 5,
    isDM: false,
    sourceCharacterData: null,
    showToast: vi.fn(),
    playCast: vi.fn(),
    handleAreaSpellSelect: vi.fn(),
    onStartSpellTargeting: vi.fn(),
    clearCloakOfShadowsEffect: vi.fn().mockResolvedValue(undefined),
    clearReadyCast: vi.fn().mockResolvedValue(undefined),
    getBestInvokeDuplicityDistanceToToken: vi.fn(() => null),
    ...overrides,
  };
}

describe("useMapSidebarSpellController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
    castSpellViaAPIMock.mockReset();
    formatSpellChatMessageMock.mockReset();
    buildSpellCastDataMock.mockReset();
    syncCharacterSpellSlotsFromBackendMock.mockReset();
    showCharacterBubbleMock.mockReset();
    apiFetchMock.mockReset();
  });

  it("routes sidebar spell targeting into area or single-target flows", async () => {
    const handleAreaSpellSelect = vi.fn();
    const onStartSpellTargeting = vi.fn();

    renderHook(() =>
      useMapSidebarSpellController(makeArgs({
        tokens: [{ id: 11, character_id: 7 } as any],
        isDM: true,
        handleAreaSpellSelect,
        onStartSpellTargeting,
      })),
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent("startSpellTargeting", {
        detail: {
          spell: { id: "fireball", name: "火球术" },
          slotLevel: 3,
          characterId: 7,
          mode: "area",
        },
      }));
      await Promise.resolve();
    });

    expect(handleAreaSpellSelect).toHaveBeenCalledWith(
      { id: "fireball", name: "火球术" }, 11, 3,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined,
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent("startSpellTargeting", {
        detail: {
          spell: { id: "guiding-bolt", name: "引导箭" },
          slotLevel: 1,
          characterId: 7,
          mode: "single",
          freecast: true,
        },
      }));
      await Promise.resolve();
    });

    expect(onStartSpellTargeting).toHaveBeenCalledWith(expect.objectContaining({
      spell: { id: "guiding-bolt", name: "引导箭" },
      slotLevel: 1,
      sourceTokenId: 11,
      characterId: 7,
      freecast: true,
    }));
  });

  it("casts spells through unified castSpellViaAPI path", async () => {
    const showToast = vi.fn();
    const playCast = vi.fn();
    const clearCloakOfShadowsEffect = vi.fn().mockResolvedValue(undefined);
    const clearReadyCast = vi.fn().mockResolvedValue(undefined);

    castSpellViaAPIMock.mockResolvedValue({
      success: true,
      total_damage: 0,
      results: [],
    });
    formatSpellChatMessageMock.mockReturnValue("chat msg");
    buildSpellCastDataMock.mockReturnValue({ spellName: "祝福术" });

    renderHook(() =>
      useMapSidebarSpellController(makeArgs({
        showToast, playCast, clearCloakOfShadowsEffect, clearReadyCast,
      })),
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent("sidebarSpellCast", {
        detail: {
          spell: {
            id: "bless",
            name: "祝福术",
            range: "30尺",
            effects: [{ trigger: "on_cast", effects: [{ type: "narrative" }] }],
            __readyCastTokenId: 77,
          },
          sourceTokenId: 11,
          targetTokenId: 12,
          slotLevel: 1,
          characterId: 18,
        },
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(castSpellViaAPIMock).toHaveBeenCalledWith(
      "bless", 1, 11, [12], "6",
      undefined, undefined, undefined, undefined, undefined,
      { imageUrl: undefined, description: undefined, displayName: undefined },
    );
    expect(syncCharacterSpellSlotsFromBackendMock).toHaveBeenCalledWith(18, { delayMs: 50 });
    expect(playCast).toHaveBeenCalledWith("bless", undefined);
    expect(showCharacterBubbleMock).toHaveBeenCalled();
    expect(clearCloakOfShadowsEffect).toHaveBeenCalledWith(11, "spell");
    expect(clearReadyCast).toHaveBeenCalledWith(77);
  });

  it("shows error toast when castSpellViaAPI fails", async () => {
    const showToast = vi.fn();
    castSpellViaAPIMock.mockResolvedValue({ success: false });

    renderHook(() =>
      useMapSidebarSpellController(makeArgs({ showToast })),
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent("sidebarSpellCast", {
        detail: {
          spell: { id: "bless", name: "祝福术", range: "30尺", effects: [{ trigger: "on_cast", effects: [] }] },
          sourceTokenId: 11,
          targetTokenId: 12,
          slotLevel: 1,
          characterId: 18,
        },
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(showToast).toHaveBeenCalledWith("施法失败", "error");
  });

  it("routes illusion spells through unified spell cast with illusion data", async () => {
    const showToast = vi.fn();
    const playCast = vi.fn();
    castSpellViaAPIMock.mockResolvedValue({
      success: true,
      narrative: "战士的外貌发生了变化",
      total_damage: 0,
      results: [],
    });
    formatSpellChatMessageMock.mockReturnValue("chat");
    buildSpellCastDataMock.mockReturnValue({ spellName: "易容术" });

    renderHook(() =>
      useMapSidebarSpellController(makeArgs({ showToast, playCast })),
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent("sidebarSpellCast", {
        detail: {
          spell: {
            id: "disguise_self",
            name: "易容术",
            range: "30尺",
            effects: [{ trigger: "on_cast", target: { type: "single" }, effects: [{ type: "narrative" }] }],
          },
          sourceTokenId: 11,
          targetTokenId: 12,
          slotLevel: 1,
          characterId: 18,
          illusionImageUrl: "https://cdn.example.com/disguise.webp",
          illusionDesc: "披着兜帽的旅人",
          illusionDisplayName: "旅人",
        },
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(castSpellViaAPIMock).toHaveBeenCalledWith(
      "disguise_self", 1, 11, [12], "6",
      undefined, undefined, undefined, undefined, undefined,
      { imageUrl: "https://cdn.example.com/disguise.webp", description: "披着兜帽的旅人", displayName: "旅人" },
    );
    expect(syncCharacterSpellSlotsFromBackendMock).toHaveBeenCalledWith(18, { delayMs: 50 });
    expect(showToast).toHaveBeenCalledWith("战士的外貌发生了变化", "info", 4000);
  });

  it("routes active-effect granted actions to /api/spells/granted-actions/execute, skipping castSpellViaAPI", async () => {
    const showToast = vi.fn();
    const playCast = vi.fn();
    buildSpellCastDataMock.mockReturnValue({ spellName: "巫术箭" });
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        total_damage: 7,
        narrative: "目标 受到 7 点伤害",
        results: [],
      }),
    });

    renderHook(() =>
      useMapSidebarSpellController(makeArgs({ showToast, playCast })),
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent("sidebarSpellCast", {
        detail: {
          spell: {
            id: "granted_witch_bolt_repeat_damage",
            name: "✦ 巫术箭伤害",
            range: "30尺",
            damage: "1d12",
            damageType: "lightning",
            __activeEffectGrantAction: {
              effectId: "witch_bolt_grant_action_巫术箭伤害",
              spellId: "witch_bolt",
              spellName: "巫术箭",
              actionKind: "repeat_damage",
              actionName: "巫术箭伤害",
              targetTokenId: 12,
              sourceTokenId: 11,
            },
          },
          sourceTokenId: 11,
          targetTokenId: 12,
          slotLevel: 0,
          characterId: 18,
          freecast: true,
        },
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetchMock.mock.calls[0];
    expect(url).toBe("/api/spells/granted-actions/execute");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      campaign_id: 6,
      caster_token_id: 11,
      target_token_id: 12,
      effect_id: "witch_bolt_grant_action_巫术箭伤害",
      spell_id: "witch_bolt",
      action_kind: "repeat_damage",
      action_name: "巫术箭伤害",
    });
    // Active-effect grants must NOT fall through to the normal cast path.
    expect(castSpellViaAPIMock).not.toHaveBeenCalled();
    expect(syncCharacterSpellSlotsFromBackendMock).not.toHaveBeenCalled();
    expect(playCast).toHaveBeenCalledWith("witch_bolt", "lightning");
  });

  it("casts multi-target spells via castSpellViaAPI when sidebarSpellCast carries targetTokenIds", async () => {
    const showToast = vi.fn();
    const playCast = vi.fn();
    castSpellViaAPIMock.mockResolvedValue({
      success: true,
      total_damage: 0,
      results: [
        { target_name: "战士", target_token_id: 12 },
        { target_name: "盗贼", target_token_id: 13 },
        { target_name: "法师", target_token_id: 14 },
      ],
    });
    formatSpellChatMessageMock.mockReturnValue("chat");
    buildSpellCastDataMock.mockReturnValue({ spellName: "祝福术" });

    renderHook(() =>
      useMapSidebarSpellController(makeArgs({
        showToast,
        playCast,
        tokens: [
          { id: 11, character_id: 18, instance_name: "牧师", position_x: 0, position_y: 0, token_size: "1x1" } as any,
          { id: 12, instance_name: "战士", position_x: 1, position_y: 0, token_size: "1x1" } as any,
          { id: 13, instance_name: "盗贼", position_x: 2, position_y: 0, token_size: "1x1" } as any,
          { id: 14, instance_name: "法师", position_x: 3, position_y: 0, token_size: "1x1" } as any,
        ],
      })),
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent("sidebarSpellCast", {
        detail: {
          spell: {
            id: "bless",
            name: "祝福术",
            range: "30尺",
            effects: [
              {
                trigger: "on_cast",
                target: { type: "multiple", max_targets: 3 },
                effects: [{ type: "narrative" }],
              },
            ],
          },
          sourceTokenId: 11,
          targetTokenIds: [12, 13, 14],
          slotLevel: 1,
          characterId: 18,
        },
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining("需要选择"), "error");
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining("无法找到"), "error");
    expect(castSpellViaAPIMock).toHaveBeenCalledTimes(1);
    expect(castSpellViaAPIMock).toHaveBeenCalledWith(
      "bless",
      1,
      11,
      [12, 13, 14],
      "6",
      undefined, undefined, undefined, undefined, undefined,
      { imageUrl: undefined, description: undefined, displayName: undefined },
    );
    expect(syncCharacterSpellSlotsFromBackendMock).toHaveBeenCalledWith(18, { delayMs: 50 });
    expect(playCast).toHaveBeenCalledWith("bless", undefined);
  });

  it("coerces stringified targetTokenIds so the multi-target hotbar bridge still reaches castSpellViaAPI", async () => {
    // Matches the real DM-hotbar Bless symptom (2026-05-28): the click pipeline
    // stamps target ids onto `selectedTargetIds`, and when those ids arrive as
    // strings (e.g. dragged through a JSON snapshot or stored on a non-number
    // map source), a strict `typeof === "number"` filter silently dropped every
    // selection, leaving the banner "已选 3/3" but never POSTing /api/spells/cast.
    const showToast = vi.fn();
    castSpellViaAPIMock.mockResolvedValue({ success: true, total_damage: 0, results: [] });
    formatSpellChatMessageMock.mockReturnValue("chat");
    buildSpellCastDataMock.mockReturnValue({ spellName: "祝福术" });

    renderHook(() =>
      useMapSidebarSpellController(makeArgs({
        showToast,
        tokens: [
          { id: 11, character_id: 18, position_x: 0, position_y: 0, token_size: "1x1" } as any,
          { id: 12, position_x: 1, position_y: 0, token_size: "1x1" } as any,
          { id: 13, position_x: 2, position_y: 0, token_size: "1x1" } as any,
          { id: 14, position_x: 3, position_y: 0, token_size: "1x1" } as any,
        ],
      })),
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent("sidebarSpellCast", {
        detail: {
          spell: {
            id: "bless",
            name: "祝福术",
            range: "30尺",
            effects: [
              { trigger: "on_cast", target: { type: "multiple", max_targets: 3 }, effects: [{ type: "narrative" }] },
            ],
          },
          sourceTokenId: 11,
          targetTokenIds: ["12", "13", "14"],
          slotLevel: 1,
          characterId: 18,
        },
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(showToast).not.toHaveBeenCalledWith("需要选择法术目标", "error");
    expect(showToast).not.toHaveBeenCalledWith("无法找到部分法术目标", "error");
    expect(castSpellViaAPIMock).toHaveBeenCalledTimes(1);
    expect(castSpellViaAPIMock).toHaveBeenCalledWith(
      "bless", 1, 11, [12, 13, 14], "6",
      undefined, undefined, undefined, undefined, undefined,
      { imageUrl: undefined, description: undefined, displayName: undefined },
    );
  });

  it("deduplicates targetTokenIds and ignores stray targetTokenId when both supplied", async () => {
    castSpellViaAPIMock.mockResolvedValue({ success: true, total_damage: 0, results: [] });
    formatSpellChatMessageMock.mockReturnValue("chat");
    buildSpellCastDataMock.mockReturnValue({ spellName: "祝福术" });

    renderHook(() =>
      useMapSidebarSpellController(makeArgs({
        tokens: [
          { id: 11, character_id: 18, position_x: 0, position_y: 0, token_size: "1x1" } as any,
          { id: 12, position_x: 1, position_y: 0, token_size: "1x1" } as any,
          { id: 13, position_x: 2, position_y: 0, token_size: "1x1" } as any,
        ],
      })),
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent("sidebarSpellCast", {
        detail: {
          spell: {
            id: "bless",
            name: "祝福术",
            range: "30尺",
            effects: [
              { trigger: "on_cast", target: { type: "multiple", max_targets: 3 }, effects: [{ type: "narrative" }] },
            ],
          },
          sourceTokenId: 11,
          // duplicate + stray legacy targetTokenId — multi-target list wins, duplicates collapsed
          targetTokenId: 99,
          targetTokenIds: [12, 13, 12],
          slotLevel: 1,
          characterId: 18,
        },
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(castSpellViaAPIMock).toHaveBeenCalledWith(
      "bless", 1, 11, [12, 13], "6",
      undefined, undefined, undefined, undefined, undefined,
      { imageUrl: undefined, description: undefined, displayName: undefined },
    );
  });

  it("rejects active-effect granted actions when the selected target is not the locked target", async () => {
    const showToast = vi.fn();

    renderHook(() =>
      useMapSidebarSpellController(makeArgs({ showToast })),
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent("sidebarSpellCast", {
        detail: {
          spell: {
            id: "granted_witch_bolt_repeat_damage",
            name: "✦ 巫术箭伤害",
            range: "30尺",
            __activeEffectGrantAction: {
              effectId: "witch_bolt_grant_action_巫术箭伤害",
              spellId: "witch_bolt",
              spellName: "巫术箭",
              actionKind: "repeat_damage",
              actionName: "巫术箭伤害",
              targetTokenId: 99,  // locked target — different from selection
              sourceTokenId: 11,
            },
          },
          sourceTokenId: 11,
          targetTokenId: 12,
          slotLevel: 0,
          characterId: 18,
          freecast: true,
        },
      }));
      await Promise.resolve();
    });

    expect(showToast).toHaveBeenCalledWith("该法术动作只能对原始目标使用", "error");
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(castSpellViaAPIMock).not.toHaveBeenCalled();
  });
});
