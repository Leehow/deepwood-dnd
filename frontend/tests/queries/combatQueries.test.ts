import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("combatQueries", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("fetchCampaignCombatState omits legacy user_id query", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ object_id: "current", data: { status: "in_progress" } }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("../../app/utils/auth", () => ({
      getAuthToken: () => "jwt-token",
    }));

    const { fetchCampaignCombatState } = await import("../../app/queries/combatQueries");

    await fetchCampaignCombatState(7);

    const [input] = fetchMock.mock.calls[0];
    expect(String(input)).toContain("/api/campaigns/7/storage/combat/current");
    expect(String(input)).not.toContain("user_id=");
  });
});
