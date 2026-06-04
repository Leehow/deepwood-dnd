import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAppQueryClient } from "../../app/queries/queryClient";
import {
  fetchCampaignModuleMapsCached,
  invalidateCampaignModuleMapsCache,
  setCampaignModuleMapsCache,
} from "../../app/utils/moduleMapsCache";
import { apiFetch } from "../../app/utils/api-client";

vi.mock("../../app/utils/api-client", () => ({
  apiFetch: vi.fn(),
}));

describe("moduleMapsCache", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    getAppQueryClient().clear();
    invalidateCampaignModuleMapsCache();
  });

  it("deduplicates module map fetches through the query client", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        maps: [{ id: "map-1", name: "地城入口", url: "/maps/1.png" }],
      }),
    } as Response);

    const first = await fetchCampaignModuleMapsCached(7, { userId: "dm-1" });
    const second = await fetchCampaignModuleMapsCached(7, { userId: "dm-1" });

    expect(first[0].id).toBe("map-1");
    expect(second).toEqual(first);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("allows direct cache priming for realtime refresh paths", async () => {
    setCampaignModuleMapsCache(7, [{ id: "map-2", name: "大厅", url: "/maps/2.png" }], "dm-1");

    const result = await fetchCampaignModuleMapsCached(7, { userId: "dm-1" });

    expect(result).toEqual([{ id: "map-2", name: "大厅", url: "/maps/2.png" }]);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
