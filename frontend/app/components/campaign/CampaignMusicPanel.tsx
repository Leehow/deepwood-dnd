import { useRef, useEffect } from 'react';
import { useCampaignMusicStore, MUSIC_TRACKS } from '~/stores/campaignMusicStore';
import type { BroadcastMode } from '~/stores/campaignMusicStore';

interface CampaignMusicPanelProps {
  onClose: () => void;
  sendMessage?: (message: any) => void;
}

export function CampaignMusicPanel({ onClose, sendMessage }: CampaignMusicPanelProps) {
  const {
    currentTrackIndex, isPlaying, volume, broadcastMode,
    play, pause, resume, setVolume, setBroadcastMode,
  } = useCampaignMusicStore();
  const panelRef = useRef<HTMLDivElement>(null);

  // 点击面板外关闭
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [onClose]);

  const handlePlay = (index: number) => {
    play(index);
    if (broadcastMode === 'broadcast' && sendMessage) {
      sendMessage({ type: 'music_play', data: { trackIndex: index, volume } });
    }
  };

  const handlePause = () => {
    pause();
    if (broadcastMode === 'broadcast' && sendMessage) {
      sendMessage({ type: 'music_pause', data: {} });
    }
  };

  const handleResume = () => {
    resume();
    if (broadcastMode === 'broadcast' && sendMessage) {
      sendMessage({ type: 'music_play', data: { trackIndex: currentTrackIndex, volume } });
    }
  };

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    if (broadcastMode === 'broadcast' && sendMessage) {
      sendMessage({ type: 'music_volume', data: { volume: v } });
    }
  };

  const handleModeChange = (mode: BroadcastMode) => {
    setBroadcastMode(mode);
    // 切换到广播模式时，如果正在播放，立即广播当前状态
    if (mode === 'broadcast' && isPlaying && currentTrackIndex !== null && sendMessage) {
      sendMessage({ type: 'music_play', data: { trackIndex: currentTrackIndex, volume } });
    }
    // 切换到本地模式时，通知玩家端暂停
    if (mode === 'local' && sendMessage) {
      sendMessage({ type: 'music_pause', data: {} });
    }
  };

  return (
    <div ref={panelRef} className="music-panel">
      <div className="music-panel-header">
        <span>背景音乐</span>
        <button className="music-panel-close" onClick={onClose}>&times;</button>
      </div>

      {/* 曲目列表 */}
      <div className="music-track-list">
        {MUSIC_TRACKS.map((track, i) => (
          <button
            key={track.path}
            className={`music-track-item${currentTrackIndex === i ? ' active' : ''}`}
            onClick={() => {
              if (currentTrackIndex === i && isPlaying) {
                handlePause();
              } else if (currentTrackIndex === i && !isPlaying) {
                handleResume();
              } else {
                handlePlay(i);
              }
            }}
          >
            <span className="music-track-icon">
              {currentTrackIndex === i && isPlaying ? (
                <span className="music-bars">
                  <span className="music-bar" />
                  <span className="music-bar" />
                  <span className="music-bar" />
                </span>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              )}
            </span>
            <span className="music-track-name">{track.name}</span>
            {currentTrackIndex === i && (
              <span className="music-track-status">
                {isPlaying ? '▶' : '⏸'}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 音量控制 */}
      <div className="music-volume-row">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" style={{ flexShrink: 0, color: '#9ca3af' }}>
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
        </svg>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
          className="music-volume-slider"
        />
        <span className="music-volume-value">{Math.round(volume * 100)}%</span>
      </div>

      {/* 广播模式切换 */}
      <div className="music-mode-row">
        <button
          className={`music-mode-btn${broadcastMode === 'local' ? ' active' : ''}`}
          onClick={() => handleModeChange('local')}
          title="仅自己听到"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M3 9v6h4l5 5V4L7 9H3z"/>
          </svg>
          <span>本地</span>
        </button>
        <button
          className={`music-mode-btn${broadcastMode === 'broadcast' ? ' active' : ''}`}
          onClick={() => handleModeChange('broadcast')}
          title="所有玩家都能听到"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M3.24 6.15C2.51 6.43 2 7.17 2 8v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8c0-.83-.49-1.57-1.24-1.85L12 2 3.24 6.15zM12 4.53l6.76 3.23H5.24L12 4.53zM6 18v-6h4v6H6zm6 0v-8h6v8h-6z"/>
          </svg>
          <span>全员</span>
        </button>
      </div>

      <style>{`
        .music-panel {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 4px;
          background: #1f2937;
          border: 1px solid #374151;
          border-radius: 10px;
          width: 220px;
          padding: 0;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
          z-index: 1000;
          overflow: hidden;
        }

        .music-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          font-size: 13px;
          font-weight: 600;
          color: #f59e0b;
          border-bottom: 1px solid #374151;
        }

        .music-panel-close {
          background: none;
          border: none;
          color: #6b7280;
          font-size: 18px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }
        .music-panel-close:hover {
          color: #d1d5db;
        }

        .music-track-list {
          padding: 6px 0;
        }

        .music-track-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          background: transparent;
          border: none;
          color: #d1d5db;
          font-size: 13px;
          cursor: pointer;
          text-align: left;
          transition: background 0.15s;
        }
        .music-track-item:hover {
          background: #374151;
        }
        .music-track-item.active {
          color: #f59e0b;
          background: rgba(245, 158, 11, 0.08);
        }

        .music-track-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          flex-shrink: 0;
        }

        .music-track-name {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .music-track-status {
          font-size: 10px;
          flex-shrink: 0;
        }

        /* 音波动画 */
        .music-bars {
          display: flex;
          align-items: flex-end;
          gap: 1.5px;
          height: 14px;
        }
        .music-bar {
          display: block;
          width: 2.5px;
          background: #f59e0b;
          border-radius: 1px;
          animation: musicBarAnim 0.7s ease-in-out infinite;
        }
        .music-bar:nth-child(1) { animation-delay: 0s; }
        .music-bar:nth-child(2) { animation-delay: 0.2s; }
        .music-bar:nth-child(3) { animation-delay: 0.4s; }
        @keyframes musicBarAnim {
          0%, 100% { height: 3px; }
          50% { height: 14px; }
        }

        /* 音量 */
        .music-volume-row {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border-top: 1px solid #374151;
        }

        .music-volume-slider {
          flex: 1;
          height: 4px;
          -webkit-appearance: none;
          appearance: none;
          background: #374151;
          border-radius: 2px;
          outline: none;
        }
        .music-volume-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #f59e0b;
          cursor: pointer;
        }

        .music-volume-value {
          font-size: 11px;
          color: #6b7280;
          min-width: 30px;
          text-align: right;
        }

        /* 广播模式 */
        .music-mode-row {
          display: flex;
          gap: 4px;
          padding: 8px 12px;
          border-top: 1px solid #374151;
        }

        .music-mode-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 6px 0;
          font-size: 12px;
          border-radius: 6px;
          background: #111827;
          border: 1px solid #374151;
          color: #6b7280;
          cursor: pointer;
          transition: all 0.2s;
        }
        .music-mode-btn:hover {
          border-color: #4b5563;
          color: #9ca3af;
        }
        .music-mode-btn.active {
          background: rgba(245, 158, 11, 0.15);
          border-color: #f59e0b;
          color: #f59e0b;
        }
      `}</style>
    </div>
  );
}
