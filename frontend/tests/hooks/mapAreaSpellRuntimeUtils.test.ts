import { describe, expect, it } from "vitest";

import {
  buildAreaEffectData,
  buildIllusionTokenPayload,
  buildPersistentAreaEffectPayload,
  decrementLegacySpellSlots,
  decrementStructuredSpellSlotsState,
  getAreaSpellSlotText,
  isLastingAreaSpellDuration,
  shouldConsumeAreaSpellSlot,
} from "../../app/components/map/utils/mapAreaSpellRuntimeUtils";

describe("mapAreaSpellRuntimeUtils", () => {
  it("formats slot text and slot-consumption guards", () => {
    expect(getAreaSpellSlotText(3)).toBe("(3环)");
    expect(getAreaSpellSlotText(0)).toBe("(戏法)");
    expect(shouldConsumeAreaSpellSlot({
      slotLevel: 2,
      characterId: 18,
      freecast: false,
      ritualCast: false,
    })).toBe(true);
    expect(shouldConsumeAreaSpellSlot({
      slotLevel: 2,
      characterId: 18,
      freecast: true,
      ritualCast: false,
    })).toBe(false);
  });

  it("recognizes lasting durations and decrements both slot shapes", () => {
    expect(isLastingAreaSpellDuration("10分钟")).toBe(true);
    expect(isLastingAreaSpellDuration("Instantaneous")).toBe(false);

    expect(decrementLegacySpellSlots([0, 3, 2], 2)).toEqual([0, 3, 1]);
    expect(decrementLegacySpellSlots([0, 3, 0], 2)).toBeNull();

    expect(
      decrementStructuredSpellSlotsState({
        "1": { current: 2, max: 4 },
        "3": { current: 1, max: 2 },
      }, 3),
    ).toEqual({
      "1": { current: 2, max: 4 },
      "3": { current: 0, max: 2 },
    });
  });

  it("builds area-effect and illusion payloads with map-friendly geometry", () => {
    expect(buildAreaEffectData({
      shapeType: "sphere",
      position: { x: 5, y: 7 },
      sizeFeet: 20,
      currentMapUrl: "/maps/a.png",
      color: "fire",
      followCaster: true,
      direction: 90,
      originPos: { x: 4, y: 6 },
    })).toEqual({
      shape: "sphere",
      center_x: 5,
      center_y: 7,
      radius: 20,
      map_url: "/maps/a.png",
      color: "fire",
      followCaster: true,
      direction: 90,
      origin_x: 4,
      origin_y: 6,
    });

    expect(buildPersistentAreaEffectPayload({
      spell: {
        id: "fog-cloud",
        name: "云雾术",
        school: "conjuration",
        duration: "10分钟",
      },
      shapeType: "sphere",
      position: { x: 5, y: 7 },
      sizeFeet: 20,
      currentMapUrl: "/maps/a.png",
      fromCaster: "法师",
    })).toMatchObject({
      effect: {
        id: "spell_area_fog-cloud",
        icon: "✨",
        color: "#facc15",
        duration: 100,
        from_caster: "法师",
      },
    });

    expect(buildIllusionTokenPayload({
      campaignId: "7",
      currentMapUrl: "/maps/a.png",
      position: { x: 5, y: 7 },
      sizeFeet: 15,
      gridUnitLength: 5,
      spell: { id: "minor-illusion", name: "次级幻影" },
      sourceCharacterId: 99,
      illusionImageUrl: "https://cdn.example.com/illusion.png",
      illusionDesc: "木箱",
      illusionDisplayName: "幻影木箱",
    })).toEqual({
      campaign_id: 7,
      map_url: "/maps/a.png",
      position_x: 4,
      position_y: 6,
      instance_name: "幻影木箱",
      item_data: {
        type: "illusion",
        spell_id: "minor-illusion",
        icon: "https://cdn.example.com/illusion.png",
        avatar_url: "https://cdn.example.com/illusion.png",
        avatar_url_large: "https://cdn.example.com/illusion.png",
        description: "木箱",
        caster_id: 99,
      },
      token_size: "3x3",
    });
  });
});
