import type { ReactNode } from "react";

interface CampaignRightSidebarShellProps {
  showRightSidebar: boolean;
  isSidebarFullscreen: boolean;
  isResizing: boolean;
  rightSidebarWidth: number;
  onCloseMobileOverlay: () => void;
  onExitFullscreen: () => void;
  onStartResize: () => void;
  children: ReactNode;
}

export function CampaignRightSidebarShell({
  showRightSidebar,
  isSidebarFullscreen,
  isResizing,
  rightSidebarWidth,
  onCloseMobileOverlay,
  onExitFullscreen,
  onStartResize,
  children,
}: CampaignRightSidebarShellProps) {
  return (
    <>
      {showRightSidebar && !isSidebarFullscreen && (
        <div
          className="fixed inset-0 bg-black/30 z-[199] md:hidden"
          onClick={onCloseMobileOverlay}
        />
      )}

      <div
        className={`
          fixed bottom-0
          ${
            isSidebarFullscreen
              ? "max-md:top-[var(--sat,0px)] max-md:!w-[100vw] max-md:!z-[300]"
              : "max-md:top-[calc(44px+var(--sat,0px))]"
          }
          md:top-[calc(44px+var(--sat,0px))]
          ${
            showRightSidebar
              ? "bg-gray-900/95 backdrop-blur-sm border-l border-gray-700/50 shadow-[-4px_0_24px_rgba(0,0,0,0.4)]"
              : "bg-transparent"
          }
          overflow-hidden
          flex flex-col min-h-0
          z-[200]
          ${isResizing ? "" : "transition-[width] duration-300 ease-in-out"}
          ${showRightSidebar && !isSidebarFullscreen ? "max-md:!w-[80vw]" : ""}
        `}
        style={{
          width: showRightSidebar ? `min(${rightSidebarWidth}px, 100vw)` : "48px",
          right: 0,
        }}
        {...(isSidebarFullscreen ? { "data-sidebar-fullscreen": "" } : {})}
      >
        {isSidebarFullscreen && (
          <button
            aria-label="退出全屏"
            className="absolute top-2 right-2 z-50 md:hidden w-8 h-8 flex items-center justify-center rounded-full bg-gray-700/90 text-gray-300 hover:text-white hover:bg-gray-600 transition-colors shadow-lg"
            onClick={onExitFullscreen}
            title="退出全屏"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
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
          </button>
        )}

        {showRightSidebar && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-amber-500/40 transition-colors z-50 hidden md:block"
            onMouseDown={onStartResize}
            title="拖拽调整宽度"
          />
        )}

        {children}
      </div>
    </>
  );
}
