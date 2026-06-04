import { describe, expect, it } from "vitest";

import { getChatFilterParams, matchesChatFilter } from "../../app/components/ui/chatFilterUtils";
import type { Message } from "../../app/components/ui/hooks/useChatMessages";

function createMessage(overrides: Partial<Message>): Message {
  return {
    id: "msg-1",
    content: "hello",
    user: "Tester",
    timestamp: new Date(),
    type: "chat",
    ...overrides,
  };
}

describe("chatFilterUtils", () => {
  it("maps sidebar filters to backend params", () => {
    expect(getChatFilterParams("all")).toBeNull();
    expect(getChatFilterParams("dice")).toBeNull();
    expect(getChatFilterParams("dice-filter")).toEqual({ messageType: "dice" });
    expect(getChatFilterParams("chat-only")).toEqual({ messageType: "chat" });
    expect(getChatFilterParams("ai")).toEqual({ aiConversation: true });
    expect(getChatFilterParams("user-u1")).toEqual({ filterUserId: "u1" });
  });

  it("matches chat-only filter while excluding combat glyph content", () => {
    const normalMessage = createMessage({ type: "chat", content: "plain text" });
    const combatEmojiMessage = createMessage({ type: "chat", content: "⚔️ attack roll" });

    expect(matchesChatFilter(normalMessage, "chat-only", "self")).toBe(true);
    expect(matchesChatFilter(combatEmojiMessage, "chat-only", "self")).toBe(false);
  });

  it("matches ai filter for ai sender and private ai conversation", () => {
    const aiSender = createMessage({ senderRole: "ai", user: "AI" });
    const selfToAi = createMessage({ senderUserId: "self", recipients: ["ai"] });

    expect(matchesChatFilter(aiSender, "ai", "self")).toBe(true);
    expect(matchesChatFilter(selfToAi, "ai", "self")).toBe(true);
  });

  it("matches user filter for direct sender and self private reply", () => {
    const targetMessage = createMessage({ senderUserId: "u2" });
    const privateReply = createMessage({ senderUserId: "self", recipients: ["u2"] });
    const unrelated = createMessage({ senderUserId: "u3", recipients: ["u3"] });

    expect(matchesChatFilter(targetMessage, "user-u2", "self")).toBe(true);
    expect(matchesChatFilter(privateReply, "user-u2", "self")).toBe(true);
    expect(matchesChatFilter(unrelated, "user-u2", "self")).toBe(false);
  });
});
