import { useEffect } from "react";
import { subscribeAppEvent } from "~/events/appEventBus";
import { onStartPrivateMessage } from "~/utils/characterBubble";

interface UseCampaignPanelOrchestrationOptions {
  isPhoneLike: boolean;
  setShowRightSidebar: (open: boolean) => void;
  openChatTab?: () => void;
  listenForPrivateMessages?: boolean;
  listenForOpenRightPanelTab?: boolean;
}

export function useCampaignPanelOrchestration({
  isPhoneLike,
  setShowRightSidebar,
  openChatTab,
  listenForPrivateMessages = false,
  listenForOpenRightPanelTab = false,
}: UseCampaignPanelOrchestrationOptions): void {
  useEffect(() => {
    if (isPhoneLike) {
      setShowRightSidebar(false);
    }
  }, [isPhoneLike, setShowRightSidebar]);

  useEffect(() => {
    if (!listenForPrivateMessages || !openChatTab) {
      return;
    }
    return onStartPrivateMessage(() => {
      setShowRightSidebar(true);
      openChatTab();
    });
  }, [listenForPrivateMessages, openChatTab, setShowRightSidebar]);

  useEffect(() => {
    if (!listenForOpenRightPanelTab || !openChatTab) {
      return;
    }

    const handler = (detail: { tab?: string } | string) => {
      const tab = typeof detail === "string" ? detail : detail?.tab;
      if (tab === "chat") {
        setShowRightSidebar(true);
        openChatTab();
      }
    };

    return subscribeAppEvent("openRightPanelTab", handler);
  }, [listenForOpenRightPanelTab, openChatTab, setShowRightSidebar]);
}
