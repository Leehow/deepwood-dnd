import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("campaignQueries", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("fetchCampaignMapSettings uses bearer transport without user_id query", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ scale: 1 }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("../../app/utils/auth", () => ({
      getAuthToken: () => "jwt-token",
    }));

    const { fetchCampaignMapSettings } = await import("../../app/queries/campaignQueries");

    await fetchCampaignMapSettings(7, "https://example.com/map.webp");

    const [input] = fetchMock.mock.calls[0];
    expect(String(input)).toContain("/api/map-settings/7/");
    expect(String(input)).not.toContain("user_id=");
  });

  it("fetchCampaignMapBulkData omits legacy user_id query", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tokens: [] }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("../../app/utils/auth", () => ({
      getAuthToken: () => "jwt-token",
    }));

    const { fetchCampaignMapBulkData } = await import("../../app/queries/campaignQueries");

    await fetchCampaignMapBulkData(7, "https://example.com/map.webp");

    const [input] = fetchMock.mock.calls[0];
    expect(String(input)).toContain("/api/campaigns/7/map-bulk-data?map_url=");
    expect(String(input)).not.toContain("user_id=");
  });
});
