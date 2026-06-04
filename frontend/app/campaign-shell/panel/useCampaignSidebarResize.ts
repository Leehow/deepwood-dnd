import { useEffect, type Dispatch, type SetStateAction } from "react";

interface UseCampaignSidebarResizeOptions {
  isResizing: boolean;
  setIsResizing: Dispatch<SetStateAction<boolean>>;
  setSidebarWidth: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
}

export function useCampaignSidebarResize({
  isResizing,
  setIsResizing,
  setSidebarWidth,
  minWidth = 300,
  maxWidth = 800,
}: UseCampaignSidebarResizeOptions): void {
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizing) {
        return;
      }
      const newWidth = window.innerWidth - event.clientX;
      setSidebarWidth(Math.max(minWidth, Math.min(maxWidth, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, maxWidth, minWidth, setIsResizing, setSidebarWidth]);
}
