import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { publishAppEvent } from "../../app/events/appEventBus";
import { useMapExternalSyncController } from "../../app/components/map/hooks/useMapExternalSyncController";

describe("useMapExternalSyncController", () => {
  it("syncs class feature uses from the typed app event bus", () => {
    const setSourceCharacterData = vi.fn();
    const setTokenRollModifier = vi.fn();

    renderHook(() =>
      useMapExternalSyncController({
        sourceCharacterData: {
          id: 18,
          actions: [
            { id: "second_wind", uses: { current: 2, max: 2 } },
            { id: "action_surge", uses: { current: 1, max: 1 } },
          ],
        },
        setSourceCharacterData,
        setTokenRollModifier,
      }),
    );

    publishAppEvent("classFeatureUsesUpdated", {
      characterId: 18,
      featureId: "second_wind",
      currentUses: 1,
      maxUses: 2,
    });

    expect(setSourceCharacterData).toHaveBeenCalledWith(expect.any(Function));
    const updater = setSourceCharacterData.mock.calls[0][0];
    const nextState = updater({
      id: 18,
      actions: [
        { id: "second_wind", uses: { current: 2, max: 2 } },
        { id: "action_surge", uses: { current: 1, max: 1 } },
      ],
    });
    expect(nextState.actions).toEqual([
      { id: "second_wind", uses: { current: 1, max: 2 } },
      { id: "action_surge", uses: { current: 1, max: 1 } },
    ]);
  });

  it("keeps roll modifier sync on the typed app event bus", () => {
    const setTokenRollModifier = vi.fn();

    renderHook(() =>
      useMapExternalSyncController({
        sourceCharacterData: null,
        setSourceCharacterData: vi.fn(),
        setTokenRollModifier,
      }),
    );

    publishAppEvent("rollModifierUpdated", {
      tokenId: 77,
      modifier: "advantage",
    });

    expect(setTokenRollModifier).toHaveBeenCalledWith(expect.any(Function));
    const updater = setTokenRollModifier.mock.calls[0][0];
    expect(updater({ 11: null })).toEqual({ 11: null, 77: "advantage" });
  });

  it("publishes selected token sync and character selection through the typed bus", () => {
    const mapTokenSelectedListener = vi.fn();
    const selectCharacterListener = vi.fn();
    window.addEventListener("mapTokenSelected", mapTokenSelectedListener as EventListener);
    window.addEventListener("selectCharacterFromMap", selectCharacterListener as EventListener);

    renderHook(() =>
      useMapExternalSyncController({
        sourceCharacterData: null,
        setSourceCharacterData: vi.fn(),
        setTokenRollModifier: vi.fn(),
        isDM: true,
        tokens: [{ id: 11, character_id: 18 } as any],
        selectedTokenId: 11,
      }),
    );

    expect((mapTokenSelectedListener.mock.calls.at(-1)?.[0] as CustomEvent | undefined)?.detail).toEqual({
      tokenId: 11,
    });
    expect((selectCharacterListener.mock.calls.at(-1)?.[0] as CustomEvent | undefined)?.detail).toEqual({
      characterId: 18,
    });

    window.removeEventListener("mapTokenSelected", mapTokenSelectedListener as EventListener);
    window.removeEventListener("selectCharacterFromMap", selectCharacterListener as EventListener);
  });

  it("handles token params editor and legacy token selection bridges", () => {
    const setEditingParamsTokenId = vi.fn();
    const setSelectedTokenId = vi.fn();

    renderHook(() =>
      useMapExternalSyncController({
        sourceCharacterData: null,
        setSourceCharacterData: vi.fn(),
        setTokenRollModifier: vi.fn(),
        tokens: [{ id: 22, character_id: 18 } as any],
        setEditingParamsTokenId,
        setSelectedTokenId,
      }),
    );

    act(() => {
      publishAppEvent("openTokenParamsEditor", { tokenId: 44 });
      publishAppEvent("selectTokenByCharacterId", { characterId: 18 });
    });

    expect(setEditingParamsTokenId).toHaveBeenCalledWith(44);
    expect(setSelectedTokenId).toHaveBeenCalledWith(22);
  });

  it("applies token hp updates through the typed bus", () => {
    const setTokens = vi.fn();

    renderHook(() =>
      useMapExternalSyncController({
        sourceCharacterData: null,
        setSourceCharacterData: vi.fn(),
        setTokenRollModifier: vi.fn(),
        setTokens,
      }),
    );

    act(() => {
      publishAppEvent("tokenHPUpdate", {
        characterId: 18,
        currentHp: 9,
        maxHp: 20,
      });
    });

    expect(setTokens).toHaveBeenCalledWith(expect.any(Function));
    const updater = setTokens.mock.calls[0][0];
    expect(
      updater([
        { id: 11, character_id: 18, params: { current_hp: 14, max_hp: 22 } },
        { id: 12, character_id: 19, params: { current_hp: 7, max_hp: 7 } },
      ]),
    ).toEqual([
      { id: 11, character_id: 18, params: { current_hp: 9, max_hp: 20 } },
      { id: 12, character_id: 19, params: { current_hp: 7, max_hp: 7 } },
    ]);
  });

  it("deletes character tokens through the typed bus bridge", async () => {
    const authedFetch = vi.fn().mockResolvedValue({ ok: true } as Response);

    renderHook(() =>
      useMapExternalSyncController({
        sourceCharacterData: null,
        setSourceCharacterData: vi.fn(),
        setTokenRollModifier: vi.fn(),
        authedFetch,
        tokens: [
          { id: 11, character_id: 18 } as any,
          { id: 12, character_id: 19 } as any,
          { id: 13, character_id: 18 } as any,
        ],
      }),
    );

    await act(async () => {
      publishAppEvent("removeCharacterTokens", { characterId: 18 });
      await Promise.resolve();
    });

    expect(authedFetch).toHaveBeenCalledTimes(2);
    expect(authedFetch).toHaveBeenNthCalledWith(1, "/api/tokens/11", { method: "DELETE" });
    expect(authedFetch).toHaveBeenNthCalledWith(2, "/api/tokens/13", { method: "DELETE" });
  });

  it("focuses an existing token through the typed bus bridge", async () => {
    const setSelectedTokenId = vi.fn();
    const setStagePos = vi.fn();
    const showToast = vi.fn();

    renderHook(() =>
      useMapExternalSyncController({
        sourceCharacterData: null,
        setSourceCharacterData: vi.fn(),
        setTokenRollModifier: vi.fn(),
        authedFetch: vi.fn(),
        showToast,
        stageScale: 1,
        stageSize: { width: 1000, height: 800 },
        setStagePos,
        setTokens: vi.fn(),
        setSelectedTokenId,
        tokens: [{ id: 22, character_id: 18, position_x: 3, position_y: 4, instance_name: "牧师" } as any],
      }),
    );

    await act(async () => {
      publishAppEvent("focusOrCreateToken", { characterId: 18, name: "牧师" });
      await Promise.resolve();
    });

    expect(setStagePos).toHaveBeenCalledWith(expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
    }));
    expect(setSelectedTokenId).toHaveBeenCalledWith(22);
    expect(showToast).toHaveBeenCalledWith("已定位到 牧师", "success");
  });

  it("creates and focuses a token when none exists", async () => {
    const authedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 33,
        character_id: 18,
        position_x: 6,
        position_y: 7,
      }),
    } as Response);
    const setSelectedTokenId = vi.fn();
    const setStagePos = vi.fn();
    const showToast = vi.fn();
    const setTokens = vi.fn();
    (window as any).__getViewportCenterGridPosition = vi.fn(() => ({ x: 5, y: 6 }));

    renderHook(() =>
      useMapExternalSyncController({
        sourceCharacterData: null,
        setSourceCharacterData: vi.fn(),
        setTokenRollModifier: vi.fn(),
        authedFetch,
        campaignId: "7",
        currentMapUrl: "/maps/test-map.png",
        showToast,
        stageScale: 1,
        stageSize: { width: 1000, height: 800 },
        setStagePos,
        setTokens,
        setSelectedTokenId,
        tokens: [],
      }),
    );

    await act(async () => {
      publishAppEvent("focusOrCreateToken", { characterId: 18, name: "游侠" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authedFetch).toHaveBeenCalledWith("/api/tokens/", expect.objectContaining({
      method: "POST",
    }));
    expect(setTokens).toHaveBeenCalledWith(expect.any(Function));
    const updater = setTokens.mock.calls[0][0];
    expect(updater([])).toEqual([{ id: 33, character_id: 18, position_x: 6, position_y: 7 }]);
    expect(setSelectedTokenId).toHaveBeenCalledWith(33);
    expect(showToast).toHaveBeenCalledWith("已为 游侠 创建Token", "success");
    delete (window as any).__getViewportCenterGridPosition;
  });
});
