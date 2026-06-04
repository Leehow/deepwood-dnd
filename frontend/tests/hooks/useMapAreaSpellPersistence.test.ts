import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMapAreaSpellPersistence } from "../../app/components/map/hooks/useMapAreaSpellPersistence";

describe("useMapAreaSpellPersistence", () => {
  it("persists slot consumption through fetched character sheet data", async () => {
    const authedFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ spell_slots_state: [0, 3, 2] }),
      })
      .mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() =>
      useMapAreaSpellPersistence({
        authedFetch: authedFetch as any,
        campaignId: "7",
        currentMapUrl: "/maps/test.png",
        gridUnitLength: 5,
        setSourceCharacterData: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.consumeAreaSpellSlot({
        slotLevel: 2,
        characterId: 18,
        freecast: false,
        ritualCast: false,
      });
    });

    expect(authedFetch).toHaveBeenNthCalledWith(1, "/api/characters/18");
    expect(authedFetch).toHaveBeenNthCalledWith(
      2,
      "/api/characters/18",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ spell_slots_state: [0, 3, 1] }),
      }),
    );
  });

  it("updates local structured spell slots before persisting", async () => {
    const authedFetch = vi.fn().mockResolvedValue({ ok: true });
    const setSourceCharacterData = vi.fn();

    const { result } = renderHook(() =>
      useMapAreaSpellPersistence({
        authedFetch: authedFetch as any,
        campaignId: "7",
        currentMapUrl: "/maps/test.png",
        gridUnitLength: 5,
        setSourceCharacterData,
      }),
    );

    await act(async () => {
      await result.current.consumeAreaSpellSlot({
        slotLevel: 3,
        characterId: 18,
        freecast: false,
        ritualCast: false,
        localSpellSlotsState: {
          "1": { current: 4, max: 4 },
          "3": { current: 2, max: 3 },
        },
      });
    });

    expect(setSourceCharacterData).toHaveBeenCalledWith(expect.any(Function));
    const updater = setSourceCharacterData.mock.calls[0][0];
    expect(updater({
      id: 18,
      spell_slots_state: {
        "1": { current: 4, max: 4 },
        "3": { current: 2, max: 3 },
      },
    })).toEqual({
      id: 18,
      spell_slots_state: {
        "1": { current: 4, max: 4 },
        "3": { current: 1, max: 3 },
      },
    });
    expect(authedFetch).toHaveBeenCalledWith(
      "/api/characters/18",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          spell_slots_state: {
            "1": { current: 4, max: 4 },
            "3": { current: 1, max: 3 },
          },
        }),
      }),
    );
  });

  it("persists area effects and illusion token linkage", async () => {
    const authedFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 801 }),
      })
      .mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() =>
      useMapAreaSpellPersistence({
        authedFetch: authedFetch as any,
        campaignId: "7",
        currentMapUrl: "/maps/test.png",
        gridUnitLength: 5,
        setSourceCharacterData: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.persistAreaEffect({
        sourceTokenId: 55,
        spell: {
          id: "fog-cloud",
          name: "云雾术",
          school: "conjuration",
          duration: "10分钟",
        } as any,
        shapeType: "sphere",
        position: { x: 8, y: 6 },
        sizeFeet: 20,
        fromCaster: "法师",
      });
      await result.current.createIllusionToken({
        sourceTokenId: 55,
        sourceCharacterId: 99,
        spell: {
          id: "minor-illusion",
          name: "次级幻影",
          concentration: true,
        } as any,
        position: { x: 5, y: 5 },
        sizeFeet: 15,
        areaSpellMode: {
          illusionImageUrl: "https://cdn.example.com/illusion.png",
          illusionDesc: "木箱",
          illusionDisplayName: "幻影木箱",
        },
      });
    });

    expect(authedFetch).toHaveBeenNthCalledWith(
      1,
      "/api/tokens/55/add-effect",
      expect.objectContaining({ method: "POST" }),
    );
    expect(authedFetch).toHaveBeenNthCalledWith(
      2,
      "/api/tokens",
      expect.objectContaining({ method: "POST" }),
    );
    expect(authedFetch).toHaveBeenNthCalledWith(
      3,
      "/api/tokens/55/area-effect-position",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ illusion_token_id: 801 }),
      }),
    );
  });
});
