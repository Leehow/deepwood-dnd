import type { ReactNode } from "react";

interface CampaignFloatingOverlayShellProps {
  isPhoneLike: boolean;
  desktopChat: ReactNode;
  filterPanels: ReactNode;
}

export function CampaignFloatingOverlayShell({
  isPhoneLike,
  desktopChat,
  filterPanels,
}: CampaignFloatingOverlayShellProps) {
  return (
    <>
      <div className={isPhoneLike ? "hidden" : "block"}>
        {desktopChat}
      </div>
      {filterPanels}
    </>
  );
}
