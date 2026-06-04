import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CampaignFloatingOverlayShell } from "~/campaign-shell/panel/CampaignFloatingOverlayShell";

describe("CampaignFloatingOverlayShell", () => {
  it("shows desktop chat when not on phone-like layouts", () => {
    render(
      <CampaignFloatingOverlayShell
        isPhoneLike={false}
        desktopChat={<div>Desktop Chat</div>}
        filterPanels={<div>Filter Panels</div>}
      />,
    );

    expect(screen.getByText("Desktop Chat")).toBeInTheDocument();
    expect(screen.getByText("Filter Panels")).toBeInTheDocument();
  });

  it("keeps the desktop chat wrapper hidden on phone-like layouts", () => {
    const { container } = render(
      <CampaignFloatingOverlayShell
        isPhoneLike={true}
        desktopChat={<div>Desktop Chat</div>}
        filterPanels={<div>Filter Panels</div>}
      />,
    );

    expect(screen.getByText("Desktop Chat")).toBeInTheDocument();
    expect(screen.getByText("Filter Panels")).toBeInTheDocument();
    expect(container.querySelector(".hidden")).not.toBeNull();
  });
});
