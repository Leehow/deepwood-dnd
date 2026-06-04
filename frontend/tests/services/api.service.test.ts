import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("BaseAPIService", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("injects bearer auth on service requests by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ ok: true }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("../../app/utils/auth", () => ({
      getAuthToken: () => "jwt-token",
    }));

    const { BaseAPIService } = await import("../../app/services/api.service");
    const service = new BaseAPIService("http://localhost:8174");

    await service.get("/api/ping");

    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer jwt-token");
    expect((init?.headers as Record<string, string>)["X-User-ID"]).toBeUndefined();
  });
});
