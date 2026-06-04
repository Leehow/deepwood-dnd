import type { ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { ChatUnreadBadge } from "~/components/chat/ChatUnreadBadge";

export interface CampaignSidebarTabConfig {
  value: string;
  label: string;
  icon: ReactNode;
  hidden?: boolean;
  unreadCount?: number;
  highlighted?: boolean;
}

interface CampaignSidebarTabListProps {
  tabs: CampaignSidebarTabConfig[];
  isCollapsed?: boolean;
  isSidebarFullscreen?: boolean;
  onTabClick: (tab: string) => void;
  onToggleFullscreen?: () => void;
  showFullscreenToggle?: boolean;
}

export function CampaignSidebarTabList({
  tabs,
  isCollapsed = false,
  isSidebarFullscreen = false,
  onTabClick,
  onToggleFullscreen,
  showFullscreenToggle = false,
}: CampaignSidebarTabListProps) {
  return (
    <Tabs.List
      className={`flex-shrink-0 ${isCollapsed ? "flex flex-col bg-gray-800 border-l border-gray-700 rounded-bl-lg" : "fantasy-tabs-list"}`}
    >
      {tabs
        .filter((tab) => !tab.hidden)
        .map((tab) => (
          <Tabs.Trigger
            key={tab.value}
            value={tab.value}
            className={`fantasy-tab ${isCollapsed ? "collapsed-tab" : ""} ${tab.highlighted ? "combat-active" : ""}`}
            onClick={() => onTabClick(tab.value)}
          >
            <span className={tab.unreadCount && tab.unreadCount > 0 ? "tab-icon relative" : "tab-icon"}>
              {tab.icon}
              {(tab.unreadCount ?? 0) > 0 && (
                <ChatUnreadBadge count={tab.unreadCount ?? 0} className="absolute -top-1 -right-2" />
              )}
            </span>
            {!isCollapsed && <span className="tab-label">{tab.label}</span>}
            {tab.highlighted && <span className="ml-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
          </Tabs.Trigger>
        ))}

      {!isCollapsed && showFullscreenToggle && (
        <button
          className="flex flex-col items-center justify-center gap-0.5 px-2 text-gray-400 hover:text-amber-400 transition-colors"
          onClick={(event) => {
            event.stopPropagation();
            onToggleFullscreen?.();
          }}
          title={isSidebarFullscreen ? "退出全屏" : "全屏"}
        >
          {isSidebarFullscreen ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>
      )}
    </Tabs.List>
  );
}
