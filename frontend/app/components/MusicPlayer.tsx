import { useEffect, useState } from 'react';
import { useMusicStore } from '~/stores/musicStore';

export function MusicPlayer() {
  const { isLoaded, isPlaying, preferenceLoaded, initialize, toggle, cleanup } = useMusicStore();
  // Use mounted state to avoid SSR/CSR hydration mismatch
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    initialize();
    // Cleanup when component unmounts (user navigates away from login/home)
    return () => {
      cleanup();
    };
  }, [initialize, cleanup]);

  // Return null consistently on SSR and initial CSR to avoid hydration mismatch
  // Also wait for preference to be loaded before showing the button
  if (!mounted || !preferenceLoaded || !isLoaded) return null;

  return (
    <>
      <style>{`
        .music-toggle {
          position: fixed;
          bottom: 1.5rem;
          left: 1.5rem;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: rgba(15, 12, 10, 0.8);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(212, 168, 83, 0.3);
          color: #d4a853;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s ease;
          z-index: 9999;
          opacity: 0;
          animation: fadeInMusic 1s ease-out forwards;
        }
        @keyframes fadeInMusic {
          to { opacity: 1; }
        }
        .music-toggle:hover {
          background: rgba(212, 168, 83, 0.2);
          border-color: #d4a853;
          transform: scale(1.05);
          box-shadow: 0 0 20px rgba(212, 168, 83, 0.3);
        }
        .music-toggle.playing {
          animation: fadeInMusic 1s ease-out forwards, pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(212, 168, 83, 0.4); }
          50% { box-shadow: 0 0 0 8px rgba(212, 168, 83, 0); }
        }
        .music-toggle .bars {
          display: flex;
          align-items: flex-end;
          gap: 2px;
          height: 16px;
        }
        .music-toggle .bar {
          width: 3px;
          background: #d4a853;
          border-radius: 1px;
        }
        .music-toggle.playing .bar {
          animation: musicBar 0.8s ease-in-out infinite;
        }
        .music-toggle.playing .bar:nth-child(1) { animation-delay: 0s; }
        .music-toggle.playing .bar:nth-child(2) { animation-delay: 0.2s; }
        .music-toggle.playing .bar:nth-child(3) { animation-delay: 0.4s; }
        .music-toggle.playing .bar:nth-child(4) { animation-delay: 0.1s; }
        @keyframes musicBar {
          0%, 100% { height: 4px; }
          50% { height: 16px; }
        }
        .music-toggle:not(.playing) .bar {
          height: 8px;
        }
      `}</style>
      <button
        onClick={toggle}
        className={`music-toggle ${isPlaying ? 'playing' : ''}`}
        title={isPlaying ? '关闭音乐' : '播放音乐'}
        aria-label={isPlaying ? '关闭音乐' : '播放音乐'}
      >
        <div className="bars">
          <div className="bar" />
          <div className="bar" />
          <div className="bar" />
          <div className="bar" />
        </div>
      </button>
    </>
  );
}
