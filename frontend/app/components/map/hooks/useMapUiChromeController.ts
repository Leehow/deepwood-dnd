import { useEffect, useRef, useState } from "react";

interface UseMapUiChromeControllerArgs {
  isResizing?: boolean;
  showRightSidebar?: boolean;
  rightSidebarWidth?: number | null;
}

export function useMapUiChromeController({
  isResizing,
  showRightSidebar,
  rightSidebarWidth,
}: UseMapUiChromeControllerArgs) {
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [rightOffset, setRightOffset] = useState(16);
  const [dmBubbleMessage, setDmBubbleMessage] = useState<string | null>(null);
  const prevIsResizingRef = useRef(false);

  useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  useEffect(() => {
    if (prevIsResizingRef.current && !isResizing) {
      const sidebarWidth = showRightSidebar ? (rightSidebarWidth ?? 384) : 48;
      setRightOffset(sidebarWidth + 16);
    }
    prevIsResizingRef.current = isResizing ?? false;
  }, [isResizing, showRightSidebar, rightSidebarWidth]);

  useEffect(() => {
    if (!isResizing) {
      const sidebarWidth = showRightSidebar ? (rightSidebarWidth ?? 384) : 48;
      setRightOffset(sidebarWidth + 16);
    }
  }, [isResizing, showRightSidebar, rightSidebarWidth]);

  useEffect(() => {
    const sidebarWidth = showRightSidebar !== false ? (rightSidebarWidth ?? 384) : 48;
    setRightOffset(sidebarWidth + 16);
  }, [showRightSidebar, rightSidebarWidth]);

  useEffect(() => {
    if (!dmBubbleMessage) return;
    const timer = setTimeout(() => setDmBubbleMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [dmBubbleMessage]);

  return {
    dmBubbleMessage,
    isTouchDevice,
    rightOffset,
    setDmBubbleMessage,
  };
}
