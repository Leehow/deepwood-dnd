import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.fn();
const publishAppEventMock = vi.fn();
const fetchCampaignMapTokensCachedMock = vi.fn();
const playSpellSoundMock = vi.fn();

vi.mock("../../app/utils/api-client", () => ({
  apiFetch: (...args: any[]) => apiFetchMock(...args),
}));

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
}));

vi.mock("../../app/utils/mapTokensCache", () => ({
  fetchCampaignMapTokensCached: (...args: any[]) => fetchCampaignMapTokensCachedMock(...args),
}));

vi.mock("../../app/stores/spellSoundStore", () => ({
  useSpellSoundStore: {
    getState: () => ({ playSpellSound: playSpellSoundMock }),
  },
}));

vi.mock("../../app/components/spell/spell-constants", () => ({
  getBuffEffects: () => null,
  getSpellSummonTokenConfig: () => null,
  isQuasiRealCreatureSpell: () => false,
}));

vi.mock("../../app/utils/asset-url", () => ({
  getAssetUrl: (p: string) => p,
}));

import { castSpellAction, castSpellViaAPI, spellToSpellOption } from "../../app/utils/sidebarCasting";

describe("castSpellViaAPI", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  it("includes illusion payload for appearance illusions in the unified spell cast request", async () => {
    await castSpellViaAPI(
      "disguise_self",
      1,
      91,
      [91],
      "7",
      undefined,
      false,
      false,
      undefined,
      undefined,
      {
        imageUrl: "https://cdn.example.com/disguise.webp",
        description: "披着兜帽的旅人",
        displayName: "旅人",
      },
    );

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/spells/cast",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spell_id: "disguise_self",
          slot_level: 1,
          caster_token_id: 91,
          target_token_ids: [91],
          campaign_id: 7,
          freecast: false,
          ritual_cast: false,
          illusion_data: {
            image_url: "https://cdn.example.com/disguise.webp",
            description: "披着兜帽的旅人",
            display_name: "旅人",
          },
        }),
      }),
    );
  });

  // Misty Step destination is sent as a typed top-level field so backend
  // SpellResolver can merge it into TeleportHandler's phase context.
  it("includes teleport_destination payload when supplied", async () => {
    await castSpellViaAPI(
      "misty_step",
      2,
      91,
      [91],
      "7",
      undefined,
      false,
      false,
      undefined,
      undefined,
      undefined,
      false,
      { x: 12, y: 7 },
    );
    const call = apiFetchMock.mock.calls.find(([url]) => url === "/api/spells/cast");
    expect(call).toBeTruthy();
    const body = JSON.parse(call![1].body);
    expect(body.teleport_destination).toEqual({ x: 12, y: 7 });
  });
});

describe("spellToSpellOption — summon area synthesis", () => {
  it("synthesizes 5ft sphere areaOfEffect for summon spell without one", () => {
    const conjureAnimals = {
      id: "conjure_animals",
      name: "召唤动物",
      level: 3,
      range: "60 尺",
      effects: [
        {
          trigger: "on_cast",
          target: { type: "point" },
          effects: [{ type: "spawn_summon", summonId: "wolf" }],
        },
      ],
    };
    const opt = spellToSpellOption(conjureAnimals);
    expect(opt.areaOfEffect).toEqual({ type: "sphere", size: 5 });
  });

  it("preserves explicit areaOfEffect on summon spells", () => {
    const spell = {
      id: "weird_summon",
      name: "怪召",
      level: 4,
      range: "120 尺",
      areaOfEffect: { type: "cube", size: 30 },
      effects: [
        { trigger: "on_cast", target: { type: "point" }, effects: [{ type: "spawn_summon" }] },
      ],
    };
    const opt = spellToSpellOption(spell);
    expect(opt.areaOfEffect).toEqual({ type: "cube", size: 30 });
  });

  it("does not synthesize areaOfEffect for non-summon spells", () => {
    const firebolt = {
      id: "firebolt",
      name: "火焰箭",
      level: 0,
      range: "120 尺",
      effects: [
        { trigger: "on_cast", target: { type: "single" }, effects: [{ type: "deal_damage" }] },
      ],
    };
    const opt = spellToSpellOption(firebolt);
    expect(opt.areaOfEffect).toBeUndefined();
  });
});

describe("castSpellAction — summon dispatch routing", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    publishAppEventMock.mockReset();
    fetchCampaignMapTokensCachedMock.mockReset();
    playSpellSoundMock.mockReset();
  });

  it("dispatches short-cast summon (no areaOfEffect, no targetingMode hint) via area mode", async () => {
    const conjureAnimals = {
      id: "conjure_animals",
      name: "召唤动物",
      level: 3,
      range: "60 尺",
      castingTime: "1 动作",
      concentration: true,
      effects: [
        {
          trigger: "on_cast",
          target: { type: "point" },
          effects: [{ type: "spawn_summon", summonId: "wolf" }],
        },
      ],
    };
    await castSpellAction(conjureAnimals, 3, 42, {
      campaignId: "7",
      currentMapUrl: "map.png",
    });
    const startCall = publishAppEventMock.mock.calls.find(
      ([type]) => type === "startSpellTargeting",
    );
    expect(startCall).toBeTruthy();
    const payload = startCall![1];
    expect(payload.mode).toBe("area");
    expect(payload.spell.areaOfEffect).toEqual({ type: "sphere", size: 5 });
  });

  it("respects explicit targetingMode='area' from middleware for summon spell", async () => {
    const conjureAnimals = {
      id: "conjure_animals",
      name: "召唤动物",
      level: 3,
      range: "60 尺",
      castingTime: "1 动作",
      effects: [
        {
          trigger: "on_cast",
          target: { type: "point" },
          effects: [{ type: "spawn_summon" }],
        },
      ],
    };
    await castSpellAction(conjureAnimals, 3, 42, {
      campaignId: "7",
      currentMapUrl: "map.png",
      targetingMode: "area",
    });
    const startCall = publishAppEventMock.mock.calls.find(
      ([type]) => type === "startSpellTargeting",
    );
    expect(startCall).toBeTruthy();
    expect(startCall![1].mode).toBe("area");
  });

  // Chrome QA 2026-05-28: Identify started `casting_in_progress` with no
  // target_token_ids because castSpellAction short-circuited every long cast
  // straight into /api/spells/start-cast before the single-target picker
  // could run. The fixed flow routes the user through map targeting first
  // and only calls start-cast after a target has been picked.
  it("ritual touch single-target spell routes to single targeting and does NOT call start-cast", async () => {
    const identify = {
      id: "identify",
      name: "鉴定术",
      level: 1,
      range: "触及",
      castingTime: "1 minute",
      ritual: true,
      components: ["V", "S", "M"],
      effects: [
        { trigger: "on_cast", target: { type: "single" }, effects: [{ type: "narrative" }] },
      ],
    };
    await castSpellAction(identify, 1, 42, {
      campaignId: "8",
      currentMapUrl: "map.png",
      ritualCast: true,
      materialId: "pearl_100gp",
    });
    // Did NOT POST to start-cast yet — picker has not finished.
    expect(apiFetchMock).not.toHaveBeenCalled();
    const startCall = publishAppEventMock.mock.calls.find(
      ([type]) => type === "startSpellTargeting",
    );
    expect(startCall).toBeTruthy();
    const payload = startCall![1];
    expect(payload.mode).toBe("single");
    expect(payload.longCast).toBe(true);
    expect(payload.ritualCast).toBe(true);
    expect(payload.materialId).toBe("pearl_100gp");
  });

  it("ritual area spell routes to area placement and does NOT call start-cast yet", async () => {
    const alarm = {
      id: "alarm",
      name: "警报术",
      level: 1,
      range: "30 尺",
      areaOfEffect: { type: "cube", size: 20 },
      castingTime: "1 minute",
      ritual: true,
      components: ["V", "S", "M"],
      effects: [
        { trigger: "on_cast", target: { type: "area" }, effects: [{ type: "narrative" }] },
      ],
    };
    await castSpellAction(alarm, 1, 42, {
      campaignId: "8",
      currentMapUrl: "map.png",
      ritualCast: true,
      materialId: "component_pouch",
    });
    expect(apiFetchMock).not.toHaveBeenCalled();
    const startCall = publishAppEventMock.mock.calls.find(
      ([type]) => type === "startSpellTargeting",
    );
    expect(startCall).toBeTruthy();
    expect(startCall![1].mode).toBe("area");
    expect(startCall![1].longCast).toBe(true);
    expect(startCall![1].ritualCast).toBe(true);
  });

  it("self long-cast self-buff still starts immediately without placement", async () => {
    fetchCampaignMapTokensCachedMock.mockResolvedValue({
      tokens: [{ id: 99, character_id: 42, position_x: 0, position_y: 0 }],
    });
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    const selfLong = {
      id: "longstrider",
      name: "长足术",
      level: 1,
      range: "自身",
      castingTime: "1 minute",
      effects: [
        { trigger: "on_cast", target: { type: "single" }, effects: [{ type: "narrative" }] },
      ],
    };
    await castSpellAction(selfLong, 1, 42, { campaignId: "8", currentMapUrl: "map.png" });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/spells/start-cast",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // Chrome QA 2026-05-28: Misty Step must route to the area picker as a
  // destination picker, NOT short-circuit as a self buff. The picker spell
  // option carries a synthetic 5ft sphere, the teleport range as `range`,
  // and the `__teleportDestination` marker so the area execution controller
  // can identify it later.
  it("misty step routes to area mode with synthetic sphere + teleport marker", async () => {
    const mistyStep = {
      id: "misty_step",
      name: "迷踪步",
      level: 2,
      range: "自身",
      castingTime: "1 附赠动作",
      effects: [
        {
          trigger: "on_cast",
          target: { type: "self" },
          effects: [
            { type: "narrative", description: "..." },
            { type: "teleport", range: 30, mode: "self", mustSee: true },
          ],
        },
      ],
    };
    await castSpellAction(mistyStep, 2, 42, {
      campaignId: "7",
      currentMapUrl: "map.png",
      targetingMode: "teleport_destination",
    });
    // No start-cast / self-buff API call — picker has not finished yet.
    expect(apiFetchMock).not.toHaveBeenCalled();
    const startCall = publishAppEventMock.mock.calls.find(
      ([type]) => type === "startSpellTargeting",
    );
    expect(startCall).toBeTruthy();
    const payload = startCall![1];
    expect(payload.mode).toBe("area");
    expect(payload.spell.areaOfEffect).toEqual({ type: "sphere", size: 5 });
    expect(payload.spell.range).toBe("30 尺");
    expect(payload.spell.__teleportDestination).toBe(true);
    expect(payload.spell.__teleportRange).toBe(30);
  });

  it("non-summon ranged spell remains single mode (regression guard)", async () => {
    const firebolt = {
      id: "firebolt",
      name: "火焰箭",
      level: 0,
      range: "120 尺",
      castingTime: "1 动作",
      effects: [
        { trigger: "on_cast", target: { type: "single" }, effects: [{ type: "deal_damage" }] },
      ],
    };
    await castSpellAction(firebolt, 0, 42, {
      campaignId: "7",
      currentMapUrl: "map.png",
    });
    const startCall = publishAppEventMock.mock.calls.find(
      ([type]) => type === "startSpellTargeting",
    );
    expect(startCall).toBeTruthy();
    expect(startCall![1].mode).toBe("single");
  });
});
