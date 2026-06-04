import { useCallback, useEffect } from "react";

interface UseCampaignSidebarTabsOptions {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  showChatInSidebar: boolean;
  fallbackTab?: string;
}

export function useCampaignSidebarTabs({
  activeTab,
  setActiveTab,
  isCollapsed = false,
  onToggleCollapse,
  showChatInSidebar,
  fallbackTab = "characters",
}: UseCampaignSidebarTabsOptions) {
  useEffect(() => {
    if (!showChatInSidebar && activeTab === "chat") {
      setActiveTab(fallbackTab);
    }
  }, [activeTab, fallbackTab, setActiveTab, showChatInSidebar]);

  const handleTabClick = useCallback(
    (tabValue: string) => {
      if (isCollapsed) {
        setActiveTab(tabValue);
        onToggleCollapse?.();
        return;
      }

      if (tabValue === activeTab) {
        onToggleCollapse?.();
        return;
      }

      setActiveTab(tabValue);
    },
    [activeTab, isCollapsed, onToggleCollapse, setActiveTab],
  );

  return {
    handleTabClick,
  };
}
