import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import * as Tabs from "@radix-ui/react-tabs";
import { describe, expect, it, vi } from "vitest";
import {
  CampaignSidebarTabList,
  type CampaignSidebarTabConfig,
} from "~/campaign-shell/panel/CampaignSidebarTabList";
import { useCampaignSidebarTabs } from "~/campaign-shell/panel/useCampaignSidebarTabs";

describe("useCampaignSidebarTabs", () => {
  it("redirects desktop chat tabs back to the fallback tab", () => {
    const setActiveTab = vi.fn();

    renderHook(() =>
      useCampaignSidebarTabs({
        activeTab: "chat",
        setActiveTab,
        showChatInSidebar: false,
      }),
    );

    expect(setActiveTab).toHaveBeenCalledWith("characters");
  });

  it("expands collapsed sidebars when clicking a tab", () => {
    const setActiveTab = vi.fn();
    const onToggleCollapse = vi.fn();

    const { result } = renderHook(() =>
      useCampaignSidebarTabs({
        activeTab: "characters",
        setActiveTab,
        isCollapsed: true,
        onToggleCollapse,
        showChatInSidebar: true,
      }),
    );

    result.current.handleTabClick("combat");

    expect(setActiveTab).toHaveBeenCalledWith("combat");
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });
});

describe("CampaignSidebarTabList", () => {
  const tabs: CampaignSidebarTabConfig[] = [
    { value: "characters", label: "角色", icon: "🧙" },
    { value: "chat", label: "聊天", icon: "💬", unreadCount: 3 },
    { value: "combat", label: "战斗", icon: "⚔️", highlighted: true },
    { value: "hidden", label: "隐藏", icon: "🙈", hidden: true },
  ];

  it("renders visible tabs, unread badges, and combat highlight", () => {
    render(
      <Tabs.Root value="characters">
        <CampaignSidebarTabList tabs={tabs} onTabClick={vi.fn()} />
      </Tabs.Root>,
    );

    expect(screen.getByText("角色")).toBeInTheDocument();
    expect(screen.getByText("聊天")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("隐藏")).not.toBeInTheDocument();
    expect(document.querySelector(".combat-active")).not.toBeNull();
  });

  it("shows the fullscreen toggle only when requested", () => {
    const onToggleFullscreen = vi.fn();

    render(
      <Tabs.Root value="characters">
        <CampaignSidebarTabList
          tabs={tabs}
          onTabClick={vi.fn()}
          showFullscreenToggle={true}
          isSidebarFullscreen={false}
          onToggleFullscreen={onToggleFullscreen}
        />
      </Tabs.Root>,
    );

    fireEvent.click(screen.getByTitle("全屏"));
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
  });
});
