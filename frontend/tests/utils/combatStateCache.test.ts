import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAppQueryClient } from "../../app/queries/queryClient";
import {
  fetchCampaignCombatStateCached,
  invalidateCampaignCombatStateCache,
} from "../../app/utils/combatStateCache";
import { apiFetch } from "../../app/utils/api-client";

vi.mock("../../app/utils/api-client", () => ({
  apiFetch: vi.fn(),
}));

describe("combatStateCache", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    getAppQueryClient().clear();
    invalidateCampaignCombatStateCache();
  });

  it("deduplicates combat storage fetches through the query client", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        object_type: "combat",
        object_id: "current",
        is_active: true,
        data: {
          status: "in_progress",
          order: [11],
          current_index: 0,
        },
      }),
    } as Response);

    const first = await fetchCampaignCombatStateCached(7, { userId: "dm-1" });
    const second = await fetchCampaignCombatStateCached(7, { userId: "dm-1" });

    expect(first?.data?.status).toBe("in_progress");
    expect(second).toEqual(first);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("supports forced refresh after invalidation", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          object_type: "combat",
          object_id: "current",
          is_active: true,
          data: { status: "in_progress", order: [11], current_index: 0 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          object_type: "combat",
          object_id: "current",
          is_active: false,
          data: { status: "ended", order: [], current_index: 0 },
        }),
      } as Response);

    const first = await fetchCampaignCombatStateCached(7, { userId: "dm-1" });
    invalidateCampaignCombatStateCache(7, "dm-1");
    const second = await fetchCampaignCombatStateCached(7, { userId: "dm-1", force: true });

    expect(first?.is_active).toBe(true);
    expect(second?.is_active).toBe(false);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
