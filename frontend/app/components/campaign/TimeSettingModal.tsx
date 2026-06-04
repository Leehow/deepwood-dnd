import { useState, useRef } from "react";
import type { WorldTime, CycleType, EnvironmentType } from "~/utils/timeUtils";
import { hourToCycle, normalizeTime } from "~/utils/timeUtils";

interface TimeSettingModalProps {
  open: boolean;
  onClose: () => void;
  currentTime: WorldTime;
  onConfirm: (time: WorldTime, advancedSeconds?: number) => void;
}

const CYCLE_PRESETS: { cycle: CycleType; label: string; icon: string; hour: number; range: string; color: string }[] = [
  { cycle: "dawn", label: "清晨", icon: "🌅", hour: 5, range: "05:00–08:00", color: "#f59e0b" },
  { cycle: "day", label: "日间", icon: "☀️", hour: 8, range: "08:00–17:00", color: "#fbbf24" },
  { cycle: "dusk", label: "黄昏", icon: "🌇", hour: 17, range: "17:00–20:00", color: "#f97316" },
  { cycle: "night", label: "夜晚", icon: "🌙", hour: 20, range: "20:00–05:00", color: "#6366f1" },
];

const ENV_PRESETS: { env: EnvironmentType; label: string; icon: string; desc: string; color: string }[] = [
  { env: "normal", label: "正常", icon: "🌤️", desc: "按时间自动切换滤镜", color: "#9ca3af" },
  { env: "bright", label: "长亮", icon: "💡", desc: "无滤镜，如维度空间", color: "#fbbf24" },
  { env: "dark", label: "长暗", icon: "🕳️", desc: "永夜滤镜，如地下城", color: "#4b5563" },
  { env: "warp", label: "亚空间", icon: "🌀", desc: "战锤亚空间滤镜", color: "#a855f7" },
];

/** Calculate delta from origin to target, always forward (wrap to next day if needed) */
function calcDelta(
  origDay: number, origHour: number, origMin: number,
  targetDay: number, targetHour: number, targetMin: number
): { days: number; hours: number; mins: number; totalSeconds: number } {
  const origTotal = origDay * 86400 + origHour * 3600 + origMin * 60;
  const targetTotal = targetDay * 86400 + targetHour * 3600 + targetMin * 60;
  const diff = targetTotal - origTotal;
  if (diff <= 0) return { days: 0, hours: 0, mins: 0, totalSeconds: 0 };
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  return { days, hours, mins, totalSeconds: diff };
}

function formatDelta(d: { days: number; hours: number; mins: number }): string {
  const parts: string[] = [];
  if (d.days > 0) parts.push(`${d.days}天`);
  if (d.hours > 0) parts.push(`${d.hours}h`);
  if (d.mins > 0 && d.days === 0) parts.push(`${d.mins}m`);
  return parts.length > 0 ? `+${parts.join("")}` : "";
}

export function TimeSettingModal({ open, onClose, currentTime, onConfirm }: TimeSettingModalProps) {
  const t = normalizeTime(currentTime);
  const [selectedCycle, setSelectedCycle] = useState<CycleType>(t.cycle);
  const [day, setDay] = useState(t.day);
  const [hour, setHour] = useState(t.hour);
  const [minute, setMinute] = useState(t.minute);
  const [environment, setEnvironment] = useState<EnvironmentType>(t.environment);
  const [advanceHours, setAdvanceHours] = useState(1);
  const [showUnsavedHint, setShowUnsavedHint] = useState(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout>>();

  if (!open) return null;

  const hasChanges = day !== t.day || hour !== t.hour || minute !== t.minute || environment !== t.environment;

  const handleClose = () => {
    if (hasChanges) {
      // Flash a hint, auto-dismiss after 2s
      setShowUnsavedHint(true);
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => setShowUnsavedHint(false), 2000);
      return;
    }
    onClose();
  };

  // Compute target day for a preset (forward-only logic)
  function presetTargetDay(preset: typeof CYCLE_PRESETS[number]): number {
    // Current cycle: stay on same day, no advance
    if (preset.cycle === t.cycle) return t.day;
    // Other presets: wrap to next day if target hour <= current
    if (preset.hour * 60 <= t.hour * 60 + t.minute) return t.day + 1;
    return t.day;
  }

  function presetDelta(preset: typeof CYCLE_PRESETS[number]) {
    const targetDay = presetTargetDay(preset);
    const delta = calcDelta(t.day, t.hour, t.minute, targetDay, preset.hour, 0);
    return { ...delta, targetDay };
  }

  function formatPresetDelta(d: { totalSeconds: number; targetDay: number }): string {
    if (d.totalSeconds <= 0) return "";
    const daysCrossed = d.targetDay - t.day;
    const totalHours = Math.floor(d.totalSeconds / 3600);
    const parts: string[] = [];
    if (daysCrossed > 0) parts.push(`${daysCrossed}天`);
    if (totalHours > 0) parts.push(`${totalHours}h`);
    return parts.length > 0 ? `+${parts.join("")}` : "";
  }

  const handlePreset = (preset: typeof CYCLE_PRESETS[number]) => {
    setSelectedCycle(preset.cycle);
    setHour(preset.hour);
    setMinute(0);
    setDay(presetTargetDay(preset));
  };

  const handleEnvPreset = (preset: typeof ENV_PRESETS[number]) => {
    setEnvironment(preset.env);
  };

  const handleHourChange = (newHour: number) => {
    setHour(newHour);
    setSelectedCycle(hourToCycle(newHour));
    // Auto-wrap day: if slider goes before original time, bump to next day
    // If slider goes forward again, restore original day
    setDay(prevDay => {
      const goingBackward = newHour * 60 < t.hour * 60 + t.minute;
      if (goingBackward && prevDay === t.day) return t.day + 1;
      if (!goingBackward && prevDay === t.day + 1) return t.day;
      return prevDay;
    });
  };

  const handleAdvanceHours = () => {
    if (advanceHours <= 0) return;
    const totalMin = minute + 0;
    const totalHour = hour + advanceHours;
    const extraDay = Math.floor(totalHour / 24);
    const newHour = totalHour % 24;
    setDay(d => d + extraDay);
    setHour(newHour);
    setMinute(totalMin);
    setSelectedCycle(hourToCycle(newHour));
  };

  // Current selection delta from original
  const currentDelta = calcDelta(t.day, t.hour, t.minute, day, hour, minute);

  const handleConfirm = () => {
    onConfirm({
      cycle: hourToCycle(hour),
      day,
      hour,
      minute,
      second: 0,
      realTimeActive: currentTime.realTimeActive ?? false,
      environment,
    }, currentDelta.totalSeconds);
    onClose();
  };

  return (
    <div className="time-modal-overlay" onClick={handleClose}>
      <div className="time-modal" onClick={(e) => e.stopPropagation()}>
        <div className="time-modal-header">
          <span>🕐 设置时间</span>
          <button className="time-modal-close" onClick={handleClose}>✕</button>
        </div>

        <div className="time-modal-body">
          {/* Day input */}
          <div className="time-day-section">
            <label className="time-slider-label">日期</label>
            <div className="time-day-input">
              <button className="day-btn" onClick={() => setDay(Math.max(1, day - 1))}>−</button>
              <span className="day-display">第 <strong>{day}</strong> 天</span>
              <button className="day-btn" onClick={() => setDay(day + 1)}>+</button>
            </div>
          </div>

          {/* Hour/minute sliders */}
          <div className="time-slider-section">
            <div className="time-main-row">
              <label className="time-slider-label" style={{ marginBottom: 0 }}>
                时间：<strong style={{ fontSize: 18 }}>{String(hour).padStart(2, "0")}:{String(minute).padStart(2, "0")}</strong>
                {currentDelta.totalSeconds > 0 && (
                  <span className="time-delta-badge">{formatDelta(currentDelta)}</span>
                )}
              </label>
              {/* +N hours quick advance */}
              <div className="time-advance-row">
                <input
                  type="number" min={1} max={240} value={advanceHours}
                  onChange={(e) => setAdvanceHours(Math.max(1, parseInt(e.target.value) || 1))}
                  className="advance-input"
                />
                <button className="advance-btn" onClick={handleAdvanceHours}>+{advanceHours}h</button>
              </div>
            </div>
            <div className="time-slider-row">
              <span className="slider-label-mini">时</span>
              <input
                type="range" min={0} max={23} value={hour}
                onChange={(e) => handleHourChange(parseInt(e.target.value))}
                className="time-slider"
              />
            </div>
            <div className="time-slider-marks">
              <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
            </div>
            <div className="time-slider-row" style={{ marginTop: 10 }}>
              <span className="slider-label-mini">分</span>
              <input
                type="range" min={0} max={59} value={minute}
                onChange={(e) => setMinute(parseInt(e.target.value))}
                className="time-slider time-slider-minute"
              />
            </div>
            <div className="time-slider-marks">
              <span>00</span><span>15</span><span>30</span><span>45</span><span>59</span>
            </div>
          </div>

          {/* Time of day presets */}
          <div className="time-presets">
            {CYCLE_PRESETS.map((p) => {
              const d = presetDelta(p);
              const deltaStr = formatPresetDelta(d);
              return (
                <button
                  key={p.cycle}
                  className={`time-preset-btn ${selectedCycle === p.cycle ? "active" : ""}`}
                  onClick={() => handlePreset(p)}
                  style={{ "--preset-color": p.color } as React.CSSProperties}
                >
                  <span className="preset-icon">{p.icon}</span>
                  <span className="preset-label">{p.label}</span>
                  <span className="preset-hour">{p.range}</span>
                  {deltaStr && <span className="preset-badge">{deltaStr}</span>}
                </button>
              );
            })}
          </div>

          {/* Environment presets */}
          <div className="time-env-presets">
            {ENV_PRESETS.map((p) => (
              <button
                key={p.env}
                className={`time-env-btn ${environment === p.env ? "active" : ""}`}
                onClick={() => handleEnvPreset(p)}
                style={{ "--preset-color": p.color } as React.CSSProperties}
              >
                <span className="env-icon">{p.icon}</span>
                <span className="env-label">{p.label}</span>
                <span className="env-desc">{p.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="time-modal-footer">
          {showUnsavedHint && (
            <div className="unsaved-hint">
              <span>未确认的修改不会生效</span>
              <button className="discard-btn" onClick={onClose}>放弃修改</button>
            </div>
          )}
          <button className="time-btn-cancel" onClick={handleClose}>取消</button>
          <button className="time-btn-confirm" onClick={handleConfirm}>
            确认
            {currentDelta.totalSeconds > 0 && (
              <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.8 }}>
                ({Math.ceil(currentDelta.totalSeconds / 6)}轮)
              </span>
            )}
          </button>
        </div>
      </div>

      <style>{`
        .time-modal-overlay {
          position: fixed; inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex; align-items: center; justify-content: center;
          z-index: 9999;
        }
        .time-modal {
          background: #1f2937; border: 1px solid #374151;
          border-radius: 12px; width: 420px; max-width: 92vw;
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
          max-height: 90vh; overflow-y: auto;
        }
        .time-modal-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 18px; border-bottom: 1px solid #374151;
          font-size: 15px; font-weight: 600; color: #f3f4f6;
        }
        .time-modal-close {
          background: none; border: none; color: #6b7280;
          font-size: 16px; cursor: pointer; padding: 2px 6px; border-radius: 4px;
        }
        .time-modal-close:hover { color: #d1d5db; background: #374151; }
        .time-modal-body { padding: 18px; }

        /* Day input */
        .time-day-section { margin-bottom: 16px; }
        .time-day-input {
          display: flex; align-items: center; justify-content: center; gap: 16px;
        }
        .day-btn {
          width: 32px; height: 32px; border-radius: 6px;
          background: #374151; border: 1px solid #4b5563; color: #d1d5db;
          font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center;
        }
        .day-btn:hover { background: #4b5563; color: #f3f4f6; }
        .day-display { font-size: 15px; color: #d1d5db; min-width: 80px; text-align: center; }
        .day-display strong { color: #f3f4f6; font-size: 20px; }

        /* Time main row with advance */
        .time-main-row {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 8px; gap: 8px;
        }
        .time-delta-badge {
          font-size: 11px; font-weight: 600; margin-left: 6px;
          padding: 1px 6px; border-radius: 4px;
          background: rgba(34, 197, 94, 0.15); color: #4ade80;
          vertical-align: middle;
        }
        .time-advance-row {
          display: flex; align-items: center; gap: 4px; flex-shrink: 0;
        }
        .advance-input {
          width: 44px; height: 26px; border-radius: 5px;
          background: #111827; border: 1px solid #4b5563;
          color: #f3f4f6; font-size: 12px; text-align: center;
          outline: none;
          -moz-appearance: textfield;
        }
        .advance-input::-webkit-inner-spin-button,
        .advance-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .advance-input:focus { border-color: #6b7280; }
        .advance-btn {
          height: 26px; padding: 0 8px; border-radius: 5px;
          background: #065f46; border: 1px solid #059669;
          color: #6ee7b7; font-size: 11px; font-weight: 600;
          cursor: pointer; white-space: nowrap;
        }
        .advance-btn:hover { background: #047857; color: #a7f3d0; }

        /* Time presets */
        .time-presets {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 8px; margin-bottom: 12px;
        }
        .time-preset-btn {
          display: flex; flex-direction: column; align-items: center; gap: 3px;
          padding: 8px 6px; background: #111827; border: 2px solid #374151;
          border-radius: 8px; cursor: pointer; transition: all 0.2s; color: #9ca3af;
          position: relative;
        }
        .time-preset-btn:hover { border-color: #6b7280; color: #e5e7eb; }
        .time-preset-btn.active {
          border-color: var(--preset-color);
          background: rgba(245, 158, 11, 0.1); color: #f3f4f6;
        }
        .preset-icon { font-size: 20px; }
        .preset-label { font-size: 12px; font-weight: 600; }
        .preset-hour { font-size: 10px; opacity: 0.6; }
        .preset-badge {
          font-size: 9px; font-weight: 600;
          padding: 1px 5px; border-radius: 3px;
          background: rgba(34, 197, 94, 0.15); color: #4ade80;
        }

        /* Environment presets */
        .time-env-presets {
          display: grid; grid-template-columns: 1fr 1fr 1fr 1fr;
          gap: 6px;
        }
        .time-env-btn {
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          padding: 8px 4px; background: #111827; border: 2px solid #374151;
          border-radius: 8px; cursor: pointer; transition: all 0.2s; color: #9ca3af;
        }
        .time-env-btn:hover { border-color: #6b7280; color: #e5e7eb; }
        .time-env-btn.active {
          border-color: var(--preset-color);
          background: rgba(168, 85, 247, 0.08); color: #f3f4f6;
        }
        .env-icon { font-size: 18px; }
        .env-label { font-size: 12px; font-weight: 600; }
        .env-desc { font-size: 9px; opacity: 0.5; text-align: center; line-height: 1.2; }

        /* Sliders */
        .time-slider-section { margin-bottom: 16px; }
        .time-slider-label {
          display: inline-flex; align-items: center;
          font-size: 13px; color: #9ca3af;
        }
        .time-slider-label strong { color: #f3f4f6; }
        .time-slider-row {
          display: flex; align-items: center; gap: 8px;
        }
        .slider-label-mini {
          font-size: 11px; color: #6b7280; width: 16px; text-align: right; flex-shrink: 0;
        }
        .time-slider {
          flex: 1; height: 6px;
          -webkit-appearance: none; appearance: none;
          background: linear-gradient(to right, #1e3a5f, #f59e0b, #fbbf24, #f97316, #1e3a5f);
          border-radius: 3px; outline: none;
        }
        .time-slider-minute {
          background: linear-gradient(to right, #374151, #6b7280, #374151);
        }
        .time-slider::-webkit-slider-thumb {
          -webkit-appearance: none; width: 18px; height: 18px;
          border-radius: 50%; background: #f3f4f6;
          border: 2px solid #f59e0b; cursor: pointer;
        }
        .time-slider-minute::-webkit-slider-thumb { border-color: #6b7280; }
        .time-slider-marks {
          display: flex; justify-content: space-between;
          margin-top: 4px; font-size: 10px; color: #6b7280;
          padding-left: 24px;
        }

        /* Footer */
        .time-modal-footer {
          display: flex; justify-content: flex-end; align-items: center; gap: 8px;
          padding: 12px 18px; border-top: 1px solid #374151;
          flex-wrap: wrap;
        }
        .unsaved-hint {
          display: flex; align-items: center; gap: 8px;
          margin-right: auto; font-size: 12px; color: #f59e0b;
          animation: hintFadeIn 0.2s ease-out;
        }
        .discard-btn {
          font-size: 11px; padding: 2px 8px; border-radius: 4px;
          background: transparent; border: 1px solid #6b7280; color: #9ca3af;
          cursor: pointer;
        }
        .discard-btn:hover { background: #374151; color: #f3f4f6; }
        @keyframes hintFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .time-btn-cancel, .time-btn-confirm {
          padding: 7px 18px; border-radius: 6px;
          font-size: 13px; font-weight: 500; cursor: pointer;
          border: 1px solid transparent;
        }
        .time-btn-cancel { background: #374151; color: #d1d5db; border-color: #4b5563; }
        .time-btn-cancel:hover { background: #4b5563; }
        .time-btn-confirm { background: #f59e0b; color: #111827; border-color: #f59e0b; }
        .time-btn-confirm:hover { background: #d97706; }
      `}</style>
    </div>
  );
}
