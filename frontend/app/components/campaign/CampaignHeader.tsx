import { useState, useRef, useEffect } from "react";
import { ConnectionStatus } from "../ui/ConnectionStatus";
import type { ConnectionHealth } from "~/hooks/useWebSocket";
import { getAssetUrl } from "~/utils/asset-url";
import { CampaignMusicPanel } from "./CampaignMusicPanel";
import { useCampaignMusicStore } from "~/stores/campaignMusicStore";
import type { WorldTime } from "~/utils/timeUtils";
import { formatTimeDisplay, formatDayDisplay } from "~/utils/timeUtils";

const TIME_ICONS: Record<string, string> = {
  dawn: "🌅",
  day: "☀️",
  dusk: "🌇",
  night: "🌙",
};

const ENV_ICONS: Record<string, string> = {
  bright: "💡",
  dark: "🕳️",
  warp: "🌀",
};

// D&D 5E global terrain types
const TERRAIN_OPTIONS: { key: string; label: string; icon: string }[] = [
  { key: "arctic", label: "极地", icon: "❄️" },
  { key: "coast", label: "海岸", icon: "🏖️" },
  { key: "desert", label: "沙漠", icon: "🏜️" },
  { key: "forest", label: "森林", icon: "🌲" },
  { key: "grassland", label: "草原", icon: "🌾" },
  { key: "hill", label: "丘陵", icon: "⛰️" },
  { key: "mountain", label: "山地", icon: "🏔️" },
  { key: "swamp", label: "沼泽", icon: "🌿" },
  { key: "underdark", label: "幽暗地域", icon: "🕳️" },
  { key: "urban", label: "城镇", icon: "🏘️" },
  { key: "dungeon", label: "地下城", icon: "🏰" },
  { key: "underwater", label: "水下", icon: "🌊" },
];

interface CampaignHeaderProps {
  campaignId: string;
  campaignName?: string;
  isConnected: boolean;
  connectionHealth?: ConnectionHealth;
  showGrid: boolean;
  onShowGridChange: (show: boolean) => void;
  showFogOfWar: boolean;
  onShowFogOfWarChange: (show: boolean) => void;
  showLeftSidebar: boolean;
  onToggleLeftSidebar: () => void;
  showRightSidebar: boolean;
  onToggleRightSidebar: () => void;
  onNavigateToPlayer: () => void;
  onExit: () => void;
  isDM?: boolean;
  isUserDM?: boolean;
  onOpenSettings?: () => void;
  timeOfDay?: WorldTime;
  onTimeSettingClick?: () => void;
  onAdvanceRound?: () => void;
  onToggleRealTime?: () => void;
  isRealTimeActive?: boolean;
  onShortRest?: () => void;
  onLongRest?: () => void;
  globalTerrain?: string | null;
  onGlobalTerrainChange?: (terrain: string) => void;
  isDetectingTerrain?: boolean;
  sendMessage?: (message: any) => void;
}

export function CampaignHeader({
  campaignId,
  campaignName,
  isConnected,
  connectionHealth,
  showGrid,
  onShowGridChange,
  showFogOfWar,
  onShowFogOfWarChange,
  showLeftSidebar,
  onToggleLeftSidebar,
  showRightSidebar,
  onToggleRightSidebar,
  onNavigateToPlayer,
  onExit,
  isDM = true,
  isUserDM,
  onOpenSettings,
  timeOfDay,
  onTimeSettingClick,
  onAdvanceRound,
  onToggleRealTime,
  isRealTimeActive,
  onShortRest,
  onLongRest,
  globalTerrain,
  onGlobalTerrainChange,
  isDetectingTerrain,
  sendMessage,
}: CampaignHeaderProps) {
  const defaultHealth: ConnectionHealth = { latency: null, lastHeartbeat: null, isHealthy: true };
  const health = connectionHealth || defaultHealth;
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [desktopMoreOpen, setDesktopMoreOpen] = useState(false);
  const [terrainDropdownOpen, setTerrainDropdownOpen] = useState(false);
  const [musicPanelOpen, setMusicPanelOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const terrainRef = useRef<HTMLDivElement>(null);
  const musicRef = useRef<HTMLDivElement>(null);
  const desktopMoreRef = useRef<HTMLDivElement>(null);
  const isMusicPlaying = useCampaignMusicStore(s => s.isPlaying);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (terrainRef.current && !terrainRef.current.contains(e.target as Node)) {
        setTerrainDropdownOpen(false);
      }
      if (desktopMoreRef.current && !desktopMoreRef.current.contains(e.target as Node)) {
        setDesktopMoreOpen(false);
      }
    };
    if (menuOpen || terrainDropdownOpen || desktopMoreOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [menuOpen, terrainDropdownOpen, desktopMoreOpen]);

  return (
    <header className="campaign-header">
      <div className="header-content">
        {/* 左侧区域 */}
        <div className="header-left">
          {/* 工具栏切换按钮 */}
          <button
            className="header-icon-btn"
            onClick={onToggleLeftSidebar}
            aria-label="工具栏"
            title={showLeftSidebar ? "隐藏工具栏" : "显示工具栏"}
          >
            <svg
              className={`header-icon ${showLeftSidebar ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>

          {/* Logo */}
          <span className="title-icon hidden sm:flex">
            <img
              src={getAssetUrl('logo.png')}
              alt="Deepwood"
              className="h-5 w-auto"
            />
          </span>

          {/* 房间名称（优先显示）或 DM控制台/玩家视图 */}
          <h1 className="header-title">
            {campaignName || (isDM ? "DM 控制台" : "玩家视图")}
          </h1>

          {/* 连接状态指示器 - 只显示圆点 */}
          <ConnectionStatus
            isConnected={isConnected}
            health={health}
            compact={true}
          />
        </div>

        {/* 右侧区域 */}
        <div className="header-right">
          {/* 控制选项 - 仅大屏显示 */}
          <div className="header-controls">
            {/* Time of day indicator / button */}
            {timeOfDay && (
              <div className="time-control-group">
                <button
                  className="time-indicator-btn"
                  onClick={onTimeSettingClick}
                  disabled={!onTimeSettingClick}
                  title={`${formatDayDisplay(timeOfDay)} ${formatTimeDisplay(timeOfDay)}`}
                >
                  <span className="time-icon">{TIME_ICONS[timeOfDay.cycle] || "☀️"}</span>
                  {timeOfDay.environment && timeOfDay.environment !== "normal" && (
                    <span className="time-icon" style={{ marginLeft: -3 }}>{ENV_ICONS[timeOfDay.environment] || ""}</span>
                  )}
                  <span className="checkbox-label">{formatDayDisplay(timeOfDay)}</span>
                  <span className="time-separator">·</span>
                  <span className="checkbox-label">{formatTimeDisplay(timeOfDay)}</span>
                </button>
                {isDM && onAdvanceRound && (
                  <button
                    className="time-ctrl-btn time-ctrl-round"
                    onClick={onAdvanceRound}
                    title="过一轮 (+6秒)"
                  >
                    +1轮
                  </button>
                )}
                {isDM && onToggleRealTime && (
                  <button
                    className={`time-ctrl-btn${isRealTimeActive ? ' time-ctrl-active' : ''}`}
                    onClick={onToggleRealTime}
                    title={isRealTimeActive ? "暂停实时走时" : "开始实时走时"}
                  >
                    ⏱
                  </button>
                )}
              </div>
            )}

            {/* Current terrain indicator */}
            {isDM && globalTerrain && (() => {
              const t = TERRAIN_OPTIONS.find(o => o.key === globalTerrain);
              return t ? (
                <button
                  className="terrain-indicator-btn"
                  onClick={() => setDesktopMoreOpen(!desktopMoreOpen)}
                  title={`当前地形: ${t.label}`}
                >
                  <span className="terrain-indicator-icon">{t.icon}</span>
                  <span className="checkbox-label">{t.label}</span>
                </button>
              ) : null;
            })()}

            {/* Campaign settings button */}
            {isDM && onOpenSettings && (
              <button
                className="time-ctrl-btn"
                onClick={onOpenSettings}
                title="战役设置"
              >
                ⚙️
              </button>
            )}

            {/* Desktop "more" dropdown — 网格/迷雾/短休/长休/地形/音乐 */}
            {isDM && (
              <div className="desktop-more-wrapper" ref={desktopMoreRef}>
                <button
                  className={`time-ctrl-btn desktop-more-btn${desktopMoreOpen ? ' desktop-more-open' : ''}`}
                  onClick={() => setDesktopMoreOpen(!desktopMoreOpen)}
                  title="更多选项"
                >
                  ···
                </button>
                {desktopMoreOpen && (
                  <div className="desktop-more-dropdown">
                    {/* Grid & Fog toggles */}
                    <label className="desktop-more-toggle">
                      <input type="checkbox" checked={showGrid} onChange={(e) => onShowGridChange(e.target.checked)} />
                      <span className="dmi-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
                          <path d="M3 3h18v18H3V3z M3 9h18 M3 15h18 M9 3v18 M15 3v18"/>
                        </svg>
                      </span>
                      <span>网格</span>
                    </label>
                    <label className="desktop-more-toggle">
                      <input type="checkbox" checked={showFogOfWar} onChange={(e) => onShowFogOfWarChange(e.target.checked)} />
                      <span className="dmi-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 14, height: 14 }}>
                          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
                        </svg>
                      </span>
                      <span>迷雾</span>
                    </label>
                    <div className="dmi-divider" />
                    {onShortRest && (
                      <button className="desktop-more-item" onClick={() => { onShortRest(); setDesktopMoreOpen(false); }}>
                        <span className="dmi-icon">☕</span>
                        <span>短休</span>
                        <span className="dmi-hint">+2小时</span>
                      </button>
                    )}
                    {onLongRest && (
                      <button className="desktop-more-item" onClick={() => { onLongRest(); setDesktopMoreOpen(false); }}>
                        <span className="dmi-icon">🛏️</span>
                        <span>长休</span>
                        <span className="dmi-hint">至次日6:00</span>
                      </button>
                    )}

                    {onGlobalTerrainChange && (
                      <>
                        <div className="dmi-divider" />
                        <div className="dmi-section-label">全局地形{isDetectingTerrain ? " (识别中...)" : ""}</div>
                        <div className="dmi-terrain-grid">
                          {TERRAIN_OPTIONS.map(t => (
                            <button
                              key={t.key}
                              className={`dmi-terrain${globalTerrain === t.key ? " dmi-terrain-active" : ""}`}
                              onClick={() => { onGlobalTerrainChange(t.key); setDesktopMoreOpen(false); }}
                              title={t.label}
                            >
                              <span>{t.icon}</span>
                              <span>{t.label}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    <div className="dmi-divider" />

                    <div style={{ position: 'relative' }} ref={musicRef}>
                      <button className="desktop-more-item" onClick={() => { setMusicPanelOpen(!musicPanelOpen); setDesktopMoreOpen(false); }}>
                        <span className="dmi-icon">🎵</span>
                        <span>背景音乐</span>
                        {isMusicPlaying && <span className="dmi-hint" style={{ color: '#f59e0b' }}>▶</span>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 桌面端操作按钮 */}
          <div className="header-actions">
            {/* 视图切换按钮 - 只有DM用户才能看到 */}
            {(isUserDM ?? isDM) && (
              <button
                className="action-btn action-btn-secondary"
                onClick={onNavigateToPlayer}
                title={isDM ? "切换到玩家视图" : "切换到DM视图"}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="action-icon">
                  <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                </svg>
                <span>{isDM ? "Player" : "DM"}</span>
              </button>
            )}

            <button
              className="action-btn action-btn-exit"
              onClick={onExit}
              title="返回大厅"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="action-icon">
                <path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/>
              </svg>
              <span>大厅</span>
            </button>
          </div>

          {/* 移动端菜单按钮 */}
          <div className="mobile-menu-wrapper" ref={menuRef}>
            <button
              className="header-icon-btn"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="菜单"
            >
              <svg className="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* 下拉菜单 */}
            {menuOpen && (
              <div className="mobile-menu">
                {/* === 常用区：紧凑双列 === */}
                <div className="mm-compact-row">
                  <label className="mm-toggle">
                    <input type="checkbox" checked={showGrid} onChange={(e) => onShowGridChange(e.target.checked)} />
                    <span>网格</span>
                  </label>
                  <label className="mm-toggle">
                    <input type="checkbox" checked={showFogOfWar} onChange={(e) => onShowFogOfWarChange(e.target.checked)} />
                    <span>迷雾</span>
                  </label>
                </div>

                {/* Time display + quick actions */}
                {timeOfDay && (
                  <div className="mm-time-row">
                    <button className="mm-time-display" onClick={() => { onTimeSettingClick?.(); setMenuOpen(false); }}>
                      <span>
                        {TIME_ICONS[timeOfDay.cycle] || "☀️"}
                        {timeOfDay.environment && timeOfDay.environment !== "normal" ? ENV_ICONS[timeOfDay.environment] || "" : ""}
                      </span>
                      <span>{formatDayDisplay(timeOfDay)} {formatTimeDisplay(timeOfDay)}</span>
                    </button>
                    {isDM && (
                      <div className="mm-time-actions">
                        {onAdvanceRound && (
                          <button className="mm-action-btn" onClick={() => { onAdvanceRound(); setMenuOpen(false); }} title="+6秒">+1轮</button>
                        )}
                        {onToggleRealTime && (
                          <button className={`mm-action-btn${isRealTimeActive ? ' mm-active' : ''}`} onClick={() => { onToggleRealTime(); setMenuOpen(false); }}>
                            ⏱
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="menu-divider" />

                {/* 导航区 */}
                {(isUserDM ?? isDM) && (
                  <button className="mobile-menu-item" onClick={() => { onNavigateToPlayer(); setMenuOpen(false); }}>
                    <svg viewBox="0 0 24 24" fill="currentColor" className="menu-icon">
                      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                    </svg>
                    <span>{isDM ? "玩家视图" : "DM 视图"}</span>
                  </button>
                )}

                <button className="mobile-menu-item menu-item-danger" onClick={() => { onExit(); setMenuOpen(false); }}>
                  <svg viewBox="0 0 24 24" fill="currentColor" className="menu-icon">
                    <path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/>
                  </svg>
                  <span>返回大厅</span>
                </button>

                {/* === 折叠区：更多选项 === */}
                {isDM && (
                  <>
                    <button className="mm-more-toggle" onClick={() => setMobileMoreOpen(!mobileMoreOpen)}>
                      <span>更多选项</span>
                      <svg className={`mm-more-arrow${mobileMoreOpen ? ' mm-more-open' : ''}`} viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M1 1l4 4 4-4" />
                      </svg>
                    </button>

                    {mobileMoreOpen && (
                      <div className="mm-more-content">
                        {/* 休息 */}
                        {(onShortRest || onLongRest) && (
                          <div className="mm-compact-row">
                            {onShortRest && (
                              <button className="mm-rest-btn" onClick={() => { onShortRest(); setMenuOpen(false); }}>短休 +2h</button>
                            )}
                            {onLongRest && (
                              <button className="mm-rest-btn" onClick={() => { onLongRest(); setMenuOpen(false); }}>长休 → 6:00</button>
                            )}
                          </div>
                        )}

                        {/* 地形 */}
                        {onGlobalTerrainChange && (
                          <>
                            <div className="mobile-menu-terrain-label">
                              <span style={{ fontSize: 16 }}>🌍</span>
                              <span>全局地形{isDetectingTerrain ? " (识别中...)" : ""}</span>
                            </div>
                            <div className="mobile-terrain-grid">
                              {TERRAIN_OPTIONS.map(t => (
                                <button
                                  key={t.key}
                                  className={`mobile-terrain-item${globalTerrain === t.key ? " mobile-terrain-active" : ""}`}
                                  onClick={() => { onGlobalTerrainChange(t.key); setMenuOpen(false); }}
                                >
                                  <span>{t.icon}</span>
                                  <span>{t.label}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}

                        <div className="menu-divider" />

                        {/* 音乐 & 设置 */}
                        <button className="mobile-menu-item" onClick={() => { setMusicPanelOpen(!musicPanelOpen); setMenuOpen(false); }}>
                          <svg viewBox="0 0 24 24" fill="currentColor" className="menu-icon">
                            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                          </svg>
                          <span>背景音乐{isMusicPlaying ? ' ▶' : ''}</span>
                        </button>

                        {onOpenSettings && (
                          <button className="mobile-menu-item" onClick={() => { onOpenSettings(); setMenuOpen(false); }}>
                            <svg viewBox="0 0 24 24" fill="currentColor" className="menu-icon">
                              <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                            </svg>
                            <span>战役设置</span>
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* 右侧面板切换 */}
          <button
            className="header-icon-btn"
            onClick={onToggleRightSidebar}
            aria-label="角色面板"
            title={showRightSidebar ? "隐藏面板" : "显示面板"}
          >
            <svg
              className={`header-icon ${!showRightSidebar ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Music panel - responsive positioning */}
      {isDM && musicPanelOpen && (
        <div className="music-panel-wrapper">
          <CampaignMusicPanel
            onClose={() => setMusicPanelOpen(false)}
            sendMessage={sendMessage}
          />
        </div>
      )}

      <style>{`
        .campaign-header {
          position: relative;
          z-index: 250;
          background: #1f2937;
          border-bottom: 1px solid #374151;
          height: calc(44px + var(--sat, 0px));
          padding-top: var(--sat, 0px);
          user-select: none;
        }

        .header-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 100%;
          padding: 0 12px;
          position: relative;
          z-index: 1;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          flex: 1;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .header-icon-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 6px;
          background: linear-gradient(145deg, #374151, #1f2937);
          border: 1px solid #4b5563;
          color: #9ca3af;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .header-icon-btn:hover {
          background: linear-gradient(145deg, #4b5563, #374151);
          border-color: #6b7280;
          color: #e5e7eb;
        }

        .header-icon {
          width: 16px;
          height: 16px;
          transition: transform 0.3s ease;
        }

        .title-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .header-title {
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 15px;
          font-weight: 600;
          color: #f59e0b;
          letter-spacing: 0.3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        .header-controls {
          display: none;
          align-items: center;
          gap: 12px;
          padding: 0 12px;
          margin-right: 8px;
          border-right: 1px solid #374151;
        }

        @media (min-width: 768px) {
          .header-controls {
            display: flex;
          }
        }

        .checkbox-label {
          font-size: 12px;
          color: #9ca3af;
          font-weight: 500;
        }

        .time-indicator-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 3px 8px;
          border-radius: 5px;
          background: #111827;
          border: 1px solid #4b5563;
          color: #9ca3af;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 12px;
        }
        .time-indicator-btn:hover:not(:disabled) {
          background: #374151;
          border-color: #6b7280;
          color: #e5e7eb;
        }
        .time-indicator-btn:disabled {
          cursor: default;
        }
        .time-icon { font-size: 14px; }

        .time-control-group {
          display: flex; align-items: center; gap: 3px;
        }
        .time-separator {
          color: #6b7280; font-size: 12px; margin: 0 1px;
        }
        .time-ctrl-btn {
          display: flex; align-items: center; justify-content: center;
          min-width: 26px; height: 26px; border-radius: 5px;
          background: #111827; border: 1px solid #4b5563;
          color: #9ca3af; cursor: pointer; transition: all 0.2s;
          font-size: 12px; padding: 0 4px;
        }
        .time-ctrl-round {
          font-size: 10px; font-weight: 600; letter-spacing: -0.3px;
        }
        .time-ctrl-btn:hover {
          background: #374151; border-color: #6b7280; color: #e5e7eb;
        }
        .time-ctrl-active {
          background: #1e3a5f; border-color: #3b82f6; color: #60a5fa;
          animation: realTimePulse 2s ease-in-out infinite;
        }
        @keyframes realTimePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.3); }
          50% { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0); }
        }

        /* Terrain indicator in main bar */
        .terrain-indicator-btn {
          display: flex; align-items: center; gap: 4px;
          padding: 3px 8px; border-radius: 5px;
          background: #111827; border: 1px solid #4b5563;
          color: #9ca3af; cursor: pointer; transition: all 0.2s;
          font-size: 12px;
        }
        .terrain-indicator-btn:hover {
          background: #374151; border-color: #6b7280; color: #e5e7eb;
        }
        .terrain-indicator-icon { font-size: 14px; }

        /* Desktop more dropdown */
        .desktop-more-wrapper { position: relative; }
        .desktop-more-btn {
          font-size: 14px; letter-spacing: 2px; font-weight: 700;
          min-width: 30px;
        }
        .desktop-more-open {
          background: #374151; border-color: #6b7280; color: #e5e7eb;
        }
        .desktop-more-dropdown {
          position: absolute; top: 100%; right: 0;
          margin-top: 6px; background: #1f2937;
          border: 1px solid #374151; border-radius: 8px;
          padding: 4px 0; box-shadow: 0 10px 25px rgba(0,0,0,0.5);
          z-index: 1000; min-width: 220px;
        }
        .desktop-more-toggle {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 7px 14px;
          background: none; border: none; color: #d1d5db;
          font-size: 12px; cursor: pointer; text-align: left;
        }
        .desktop-more-toggle:hover { background: #374151; }
        .desktop-more-toggle input {
          width: 14px; height: 14px; accent-color: #f59e0b;
        }
        .desktop-more-toggle input:checked ~ span { color: #f3f4f6; }
        .desktop-more-item {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 7px 14px;
          background: none; border: none; color: #d1d5db;
          font-size: 12px; cursor: pointer; text-align: left;
        }
        .desktop-more-item:hover { background: #374151; }
        .dmi-icon { font-size: 14px; width: 18px; text-align: center; flex-shrink: 0; }
        .dmi-hint { margin-left: auto; font-size: 10px; color: #6b7280; }
        .dmi-divider { height: 1px; background: #374151; margin: 4px 0; }
        .dmi-section-label {
          padding: 4px 14px 2px; font-size: 10px; color: #6b7280; font-weight: 500;
        }
        .dmi-terrain-grid {
          display: grid; grid-template-columns: 1fr 1fr 1fr;
          gap: 2px; padding: 2px 8px 4px;
        }
        .dmi-terrain {
          display: flex; align-items: center; gap: 4px;
          padding: 4px 6px; border-radius: 4px;
          font-size: 11px; color: #d1d5db;
          background: none; border: none; cursor: pointer;
        }
        .dmi-terrain:hover { background: #374151; }
        .dmi-terrain-active { background: #374151; color: #f59e0b; font-weight: 600; }

        /* Mobile terrain */
        .mobile-menu-terrain-label {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px 4px;
          font-size: 12px;
          color: #6b7280;
          font-weight: 500;
        }
        .mobile-terrain-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2px;
          padding: 2px 8px 6px;
        }
        .mobile-terrain-item {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 8px;
          border-radius: 4px;
          font-size: 12px;
          color: #d1d5db;
          background: transparent;
          border: none;
          cursor: pointer;
        }
        .mobile-terrain-item:hover {
          background: #374151;
        }
        .mobile-terrain-active {
          background: #374151;
          color: #f59e0b;
        }

        .header-actions {
          display: none;
          align-items: center;
          gap: 6px;
        }

        @media (min-width: 768px) {
          .header-actions {
            display: flex;
          }
        }

        .action-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          border-radius: 5px;
          font-size: 12px;
          font-weight: 500;
          transition: all 0.2s ease;
          border: 1px solid transparent;
        }

        .action-icon {
          width: 14px;
          height: 14px;
        }

        .action-btn-secondary {
          background: linear-gradient(145deg, #374151, #1f2937);
          border-color: #4b5563;
          color: #9ca3af;
        }

        .action-btn-secondary:hover {
          background: linear-gradient(145deg, #4b5563, #374151);
          border-color: #6b7280;
          color: #e5e7eb;
        }

        .action-btn-exit {
          background: linear-gradient(145deg, #991b1b, #7f1d1d);
          border-color: #dc2626;
          color: #fca5a5;
        }

        .action-btn-exit:hover {
          background: linear-gradient(145deg, #b91c1c, #991b1b);
          border-color: #ef4444;
          color: #fecaca;
        }

        .action-btn-secondary.music-playing {
          color: #f59e0b;
          border-color: #f59e0b;
          animation: musicPulse 2s ease-in-out infinite;
        }
        @keyframes musicPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.3); }
          50% { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0); }
        }

        /* Music panel - responsive */
        .music-panel-wrapper {
          position: fixed;
          top: 48px;
          right: 8px;
          z-index: 1001;
        }
        .music-panel-wrapper .music-panel {
          position: static;
          margin-top: 0;
        }

        /* Mobile menu */
        .mobile-menu-wrapper {
          position: relative;
          display: block;
        }

        @media (min-width: 768px) {
          .mobile-menu-wrapper {
            display: none;
          }
        }

        .mobile-menu {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 8px;
          background: #1f2937;
          border: 1px solid #374151;
          border-radius: 8px;
          min-width: 160px;
          padding: 6px 0;
          box-shadow: 0 10px 25px rgba(0,0,0,0.4);
          z-index: 1000;
        }

        .mobile-menu-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 14px;
          font-size: 13px;
          color: #d1d5db;
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: left;
          transition: background 0.15s;
        }

        .mobile-menu-item:hover {
          background: #374151;
        }

        .mobile-menu-item input[type="checkbox"] {
          width: 16px;
          height: 16px;
          accent-color: #f59e0b;
        }

        .menu-icon {
          width: 16px;
          height: 16px;
          flex-shrink: 0;
        }

        .menu-divider {
          height: 1px;
          background: #374151;
          margin: 6px 0;
        }

        .menu-item-danger {
          color: #fca5a5;
        }

        .menu-item-danger:hover {
          background: #7f1d1d;
        }

        /* Mobile menu compact components */
        .mm-compact-row {
          display: flex; gap: 6px; padding: 6px 10px;
        }
        .mm-toggle {
          flex: 1; display: flex; align-items: center; gap: 6px;
          padding: 6px 10px; border-radius: 6px;
          background: #111827; border: 1px solid #374151;
          font-size: 12px; color: #d1d5db; cursor: pointer;
        }
        .mm-toggle input { width: 14px; height: 14px; accent-color: #f59e0b; }
        .mm-toggle input:checked ~ span { color: #f3f4f6; }

        .mm-time-row {
          display: flex; align-items: center; gap: 6px; padding: 4px 10px;
        }
        .mm-time-display {
          flex: 1; display: flex; align-items: center; gap: 6px;
          padding: 6px 10px; border-radius: 6px;
          background: #111827; border: 1px solid #374151;
          font-size: 12px; color: #d1d5db; cursor: pointer;
          text-align: left;
        }
        .mm-time-display:hover { background: #1f2937; border-color: #4b5563; }
        .mm-time-actions { display: flex; gap: 4px; flex-shrink: 0; }
        .mm-action-btn {
          padding: 4px 8px; border-radius: 5px;
          background: #111827; border: 1px solid #4b5563;
          color: #d1d5db; font-size: 11px; font-weight: 600;
          cursor: pointer; white-space: nowrap;
        }
        .mm-action-btn:hover { background: #374151; color: #f3f4f6; }
        .mm-active {
          background: #1e3a5f; border-color: #3b82f6; color: #60a5fa;
        }

        .mm-more-toggle {
          display: flex; align-items: center; justify-content: center;
          gap: 6px; width: 100%; padding: 8px 14px;
          background: rgba(245, 158, 11, 0.06); border: none;
          border-top: 1px solid #374151;
          color: #f59e0b; font-size: 12px; font-weight: 500; cursor: pointer;
        }
        .mm-more-toggle:hover { background: rgba(245, 158, 11, 0.12); color: #fbbf24; }
        .mm-more-arrow {
          width: 10px; height: 6px; transition: transform 0.2s;
        }
        .mm-more-arrow.mm-more-open { transform: rotate(180deg); }
        .mm-more-content {
          border-top: 1px solid #374151;
        }

        .mm-rest-btn {
          flex: 1; padding: 6px 8px; border-radius: 6px;
          background: #111827; border: 1px solid #065f46;
          color: #6ee7b7; font-size: 11px; font-weight: 600;
          cursor: pointer;
        }
        .mm-rest-btn:hover { background: #064e3b; border-color: #059669; }

        @media (max-width: 768px) {
          .header-content {
            padding: 0 8px;
          }

          .header-left {
            gap: 8px;
          }

          .header-title {
            font-size: 14px;
            max-width: 120px;
          }

          .header-icon-btn {
            width: 30px;
            height: 30px;
          }

          .header-icon {
            width: 14px;
            height: 14px;
          }
        }

        @media (min-width: 768px) and (max-width: 1023px) {
          .header-controls {
            gap: 8px;
            padding: 0 8px;
            margin-right: 6px;
          }

          .time-indicator-btn,
          .terrain-indicator-btn {
            padding: 3px 6px;
            gap: 4px;
          }

          .checkbox-label,
          .time-indicator-btn,
          .terrain-indicator-btn,
          .time-separator,
          .time-ctrl-btn,
          .action-btn {
            font-size: 11px;
          }

          .action-btn {
            padding: 5px 8px;
          }
        }

        @media (max-width: 480px) {
          .header-content {
            padding: 0 6px;
          }

          .header-left {
            gap: 6px;
          }

          .header-title {
            font-size: 13px;
            max-width: 100px;
          }

          .header-icon-btn {
            width: 28px;
            height: 28px;
          }

          .header-icon {
            width: 13px;
            height: 13px;
          }
        }
      `}</style>
    </header>
  );
}
