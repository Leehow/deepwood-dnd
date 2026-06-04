import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CampaignRightSidebarShell } from "~/campaign-shell/panel/CampaignRightSidebarShell";

describe("CampaignRightSidebarShell", () => {
  it("renders the mobile overlay and closes it on click", () => {
    const onCloseMobileOverlay = vi.fn();

    const { container } = render(
      <CampaignRightSidebarShell
        showRightSidebar={true}
        isSidebarFullscreen={false}
        isResizing={false}
        rightSidebarWidth={420}
        onCloseMobileOverlay={onCloseMobileOverlay}
        onExitFullscreen={vi.fn()}
        onStartResize={vi.fn()}
      >
        <div>Panel body</div>
      </CampaignRightSidebarShell>,
    );

    const overlay = container.querySelector(".bg-black\\/30");
    expect(overlay).not.toBeNull();

    fireEvent.click(overlay!);
    expect(onCloseMobileOverlay).toHaveBeenCalledTimes(1);
  });

  it("shows the fullscreen exit button and resize handle when expanded", () => {
    const onExitFullscreen = vi.fn();
    const onStartResize = vi.fn();

    const { container } = render(
      <CampaignRightSidebarShell
        showRightSidebar={true}
        isSidebarFullscreen={true}
        isResizing={false}
        rightSidebarWidth={420}
        onCloseMobileOverlay={vi.fn()}
        onExitFullscreen={onExitFullscreen}
        onStartResize={onStartResize}
      >
        <div>Panel body</div>
      </CampaignRightSidebarShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "退出全屏" }));
    expect(onExitFullscreen).toHaveBeenCalledTimes(1);

    const resizeHandle = container.querySelector('[title="拖拽调整宽度"]');
    expect(resizeHandle).not.toBeNull();

    fireEvent.mouseDown(resizeHandle!);
    expect(onStartResize).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-sidebar-fullscreen]")).not.toBeNull();
  });

  it("keeps a collapsed sidebar at tab-strip width", () => {
    const { container } = render(
      <CampaignRightSidebarShell
        showRightSidebar={false}
        isSidebarFullscreen={false}
        isResizing={false}
        rightSidebarWidth={420}
        onCloseMobileOverlay={vi.fn()}
        onExitFullscreen={vi.fn()}
        onStartResize={vi.fn()}
      >
        <div>Panel body</div>
      </CampaignRightSidebarShell>,
    );

    const shell = container.querySelector(".fixed.bottom-0") as HTMLDivElement | null;
    expect(shell?.style.width).toBe("48px");
    expect(container.querySelector('[title="拖拽调整宽度"]')).toBeNull();
  });
});
