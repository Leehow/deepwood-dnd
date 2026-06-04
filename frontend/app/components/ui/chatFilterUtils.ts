import type { Message } from "./hooks/useChatMessages";

export type ChatFilterParams = {
  messageType?: string;
  aiConversation?: boolean;
  filterUserId?: string;
};

export function getChatFilterParams(filter: string): ChatFilterParams | null {
  if (filter === "all" || filter === "dice") return null;
  if (filter === "dice-filter") return { messageType: "dice" };
  if (filter === "chat-only") return { messageType: "chat" };
  if (filter === "ai") return { aiConversation: true };
  if (filter === "system") return { messageType: "system" };
  if (filter === "combat") return { messageType: "combat" };
  if (filter.startsWith("user-")) return { filterUserId: filter.slice(5) };
  return null;
}

export function matchesChatFilter(msg: Message, filter: string, userId: string): boolean {
  if (filter === "dice-filter") return msg.type === "dice";

  if (filter === "chat-only") {
    if (msg.type && msg.type !== "chat" && (msg.type as string) !== "text") return false;
    // Exclude old messages stored as "chat" but actually combat/spell content.
    const content = msg.content;
    if (
      content
      && (content.startsWith("🔮")
      || content.startsWith("⚔️")
      || content.startsWith("🛡️")
      || content.startsWith("💨")
      || content.startsWith("🌀"))
    ) {
      return false;
    }
    return true;
  }

  if (filter === "ai") {
    return (
      msg.senderRole === "ai"
      || msg.user === "AI"
      || (msg.senderUserId === userId && !!msg.recipients?.includes("ai"))
    );
  }

  if (filter === "system") return msg.type === "system";
  if (filter === "combat") return msg.type === "combat";

  if (filter.startsWith("user-")) {
    const targetUserId = filter.slice(5);
    return (
      msg.senderUserId === targetUserId
      || (msg.senderUserId === userId && !!msg.recipients?.includes(targetUserId))
    );
  }

  return false;
}
