import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("chatService", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("loads messages without legacy user_id and role params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => [],
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("../../app/utils/auth", () => ({
      getAuthToken: () => "jwt-token",
    }));

    const { chatService } = await import("../../app/services/chat.service");

    await chatService.getMessages(7, "legacy-user", "dm", { messageType: "dice", limit: 50 });

    const [input, init] = fetchMock.mock.calls[0];
    expect(String(input)).toContain("/api/campaigns/7/chat/messages");
    expect(String(input)).toContain("message_type=dice");
    expect(String(input)).not.toContain("user_id=");
    expect(String(input)).not.toContain("role=");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer jwt-token");
  });
});
