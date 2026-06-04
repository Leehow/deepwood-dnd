import { beforeEach, describe, expect, it, vi } from "vitest";

import { publishAppEvent } from "../../app/events/appEventBus";
import {
  fetchCharacterResourcesCached,
  invalidateCharacterResourcesCache,
} from "../../app/utils/characterResourcesCache";
import { apiFetch } from "../../app/utils/api-client";

vi.mock("../../app/utils/api-client", () => ({
  apiFetch: vi.fn(),
}));

describe("characterResourcesCache", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    invalidateCharacterResourcesCache();
  });

  it("invalidates cached resources when class feature uses update through the typed bus", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ resources: [{ id: "channel_divinity", current: 1 }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ resources: [{ id: "channel_divinity", current: 0 }] }),
      } as Response);

    const first = await fetchCharacterResourcesCached(18);
    publishAppEvent("classFeatureUsesUpdated", { characterId: 18 });
    const second = await fetchCharacterResourcesCached(18);

    expect(first).toEqual([{ id: "channel_divinity", current: 1 }]);
    expect(second).toEqual([{ id: "channel_divinity", current: 0 }]);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
