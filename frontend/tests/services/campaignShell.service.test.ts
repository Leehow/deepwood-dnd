import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/queries/campaignQueries", () => ({
  campaignQueryKeys: {
    detail: (campaignId: string | number) => ["campaign-detail", String(campaignId)],
    mapSettings: (campaignId: string | number, mapUrl: string) => [
      "campaign-map-settings",
      String(campaignId),
      mapUrl,
    ],
    mapBulkData: (campaignId: string | number, mapUrl: string) => [
      "campaign-map-bulk-data",
      String(campaignId),
      mapUrl,
    ],
  },
  fetchCampaignDetail: vi.fn(),
  fetchCampaignMapSettings: vi.fn(),
  fetchCampaignMapBulkData: vi.fn(),
}));

vi.mock("~/utils/combatStateCache", () => ({
  fetchCampaignCombatStateCached: vi.fn(),
}));

vi.mock("~/utils/mapTokensCache", () => ({
  primeCampaignMapTokensCache: vi.fn(),
}));

import { getAppQueryClient } from "~/queries/queryClient";
import {
  fetchCampaignDetail,
  fetchCampaignMapBulkData,
  fetchCampaignMapSettings,
} from "~/queries/campaignQueries";
import { fetchCampaignCombatStateCached } from "~/utils/combatStateCache";
import { primeCampaignMapTokensCache } from "~/utils/mapTokensCache";
import { campaignShellService } from "~/services/campaignShell.service";

describe("campaignShellService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAppQueryClient().clear();
  });

  it("returns status-only result when campaign request fails", async () => {
    vi.mocked(fetchCampaignDetail).mockResolvedValueOnce(null);

    const result = await campaignShellService.loadState("42", { userId: "u1" });

    expect(result).toEqual({
      status: 404,
      campaign: null,
      mapSettings: null,
      combatState: null,
      mapBulkData: null,
    });
  });

  it("hydrates campaign, map settings, and combat state", async () => {
    vi.mocked(fetchCampaignDetail).mockResolvedValueOnce({
      id: 42,
      name: "Deepwood",
      current_map_url: "/maps/deepwood.png",
    });
    vi.mocked(fetchCampaignMapSettings).mockResolvedValueOnce({
      scale: 1.25,
      global_terrain: "difficult",
      campaign_id: 42,
      map_url: "/maps/deepwood.png",
    });
    vi.mocked(fetchCampaignMapBulkData).mockResolvedValueOnce({
      tokens: [{ id: 1 }],
    });

    vi.mocked(fetchCampaignCombatStateCached).mockResolvedValueOnce({
      object_type: "combat",
      is_active: true,
    });

    const result = await campaignShellService.loadState(42, { userId: "u1" });

    expect(fetchCampaignDetail).toHaveBeenCalledWith(42);
    expect(fetchCampaignMapSettings).toHaveBeenCalledWith(42, "/maps/deepwood.png");
    expect(fetchCampaignMapBulkData).toHaveBeenCalledWith(42, "/maps/deepwood.png");
    expect(fetchCampaignCombatStateCached).toHaveBeenCalledWith(42);
    expect(primeCampaignMapTokensCache).toHaveBeenCalledWith(42, "/maps/deepwood.png", { tokens: [{ id: 1 }] });
    expect(result).toEqual({
      status: 200,
      campaign: {
        id: 42,
        name: "Deepwood",
        current_map_url: "/maps/deepwood.png",
      },
      mapSettings: {
        campaign_id: 42,
        map_url: "/maps/deepwood.png",
        scale: 1.25,
        global_terrain: "difficult",
      },
      combatState: {
        object_type: "combat",
        is_active: true,
      },
      mapBulkData: {
        tokens: [{ id: 1 }],
      },
    });
  });
});
