import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAppQueryClient } from "../../app/queries/queryClient";
import {
  fetchCampaignMembersCached,
  invalidateCampaignMembersCache,
} from "../../app/utils/campaignMembersCache";
import { apiFetch } from "../../app/utils/api-client";

vi.mock("../../app/utils/api-client", () => ({
  apiFetch: vi.fn(),
}));

describe("campaignMembersCache", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    getAppQueryClient().clear();
    invalidateCampaignMembersCache();
  });

  it("deduplicates campaign member fetches through the query client", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => [{ user_id: "u1", role: "player" }],
    } as Response);

    const first = await fetchCampaignMembersCached(7, { userId: "dm-1" });
    const second = await fetchCampaignMembersCached(7, { userId: "dm-1" });

    expect(first).toEqual([{ user_id: "u1", role: "player" }]);
    expect(second).toEqual(first);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("refetches after invalidation", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ user_id: "u1", role: "player" }],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ user_id: "u2", role: "player" }],
      } as Response);

    const first = await fetchCampaignMembersCached(7, { userId: "dm-1" });
    invalidateCampaignMembersCache(7, "dm-1");
    const second = await fetchCampaignMembersCached(7, { userId: "dm-1", force: true });

    expect(first[0].user_id).toBe("u1");
    expect(second[0].user_id).toBe("u2");
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
