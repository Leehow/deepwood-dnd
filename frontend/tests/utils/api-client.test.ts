import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("api-client", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("injects bearer auth but not X-User-ID by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("../../app/utils/auth", () => ({
      getAuthToken: () => "jwt-token",
    }));

    const { apiFetch } = await import("../../app/utils/api-client");

    await apiFetch("/api/campaigns/7");

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Headers;

    expect(headers.get("Authorization")).toBe("Bearer jwt-token");
    expect(headers.get("X-User-ID")).toBeNull();
  });

  it("ignores legacy userId transport opt-in and stays bearer-only", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("../../app/utils/auth", () => ({
      getAuthToken: () => "jwt-token",
    }));

    const { apiFetch } = await import("../../app/utils/api-client");

    await apiFetch("/api/campaigns/7", { userId: "legacy-user" });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Headers;

    expect(headers.get("Authorization")).toBe("Bearer jwt-token");
    expect(headers.get("X-User-ID")).toBeNull();
  });
});
