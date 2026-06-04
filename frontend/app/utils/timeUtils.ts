/**
 * World Time System utilities for D&D campaign time tracking
 */

export type CycleType = "dawn" | "day" | "dusk" | "night";
export type EnvironmentType = "normal" | "bright" | "dark" | "warp";

export interface WorldTime {
  cycle: CycleType;
  day: number;       // >= 1
  hour: number;      // 0-23
  minute: number;    // 0-59
  second: number;    // 0-59
  realTimeActive: boolean;
  environment: EnvironmentType;  // overlay mode, independent of cycle
}

export const DEFAULT_TIME: WorldTime = {
  cycle: "day",
  day: 123,
  hour: 12,
  minute: 0,
  second: 0,
  realTimeActive: false,
  environment: "normal",
};

export function hourToCycle(hour: number): CycleType {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

/** Fill defaults for old data missing new fields */
export function normalizeTime(t: Record<string, any> | null | undefined): WorldTime {
  if (!t) return { ...DEFAULT_TIME };
  const hour = t.hour ?? 12;
  // Old data might have bright/dark/warp as cycle — migrate to environment
  const oldCycle = t.cycle as string | undefined;
  let environment: EnvironmentType = (t.environment as EnvironmentType) ?? "normal";
  if (oldCycle === "bright" || oldCycle === "dark" || oldCycle === "warp") {
    environment = oldCycle;
  }
  return {
    cycle: hourToCycle(hour),
    day: t.day ?? DEFAULT_TIME.day,
    hour,
    minute: t.minute ?? 0,
    second: t.second ?? 0,
    realTimeActive: t.realTimeActive ?? false,
    environment,
  };
}

export function isSameWorldTime(a: WorldTime | null | undefined, b: WorldTime | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.cycle === b.cycle
    && a.day === b.day
    && a.hour === b.hour
    && a.minute === b.minute
    && a.second === b.second
    && a.realTimeActive === b.realTimeActive
    && a.environment === b.environment
  );
}

export function advanceTimeBySeconds(t: WorldTime, seconds: number): WorldTime {
  let totalSec = t.second + seconds;
  let extraMin = Math.floor(totalSec / 60);
  totalSec = ((totalSec % 60) + 60) % 60; // handle negative

  let totalMin = t.minute + extraMin;
  let extraHour = Math.floor(totalMin / 60);
  totalMin = ((totalMin % 60) + 60) % 60;

  let totalHour = t.hour + extraHour;
  let extraDay = Math.floor(totalHour / 24);
  totalHour = ((totalHour % 24) + 24) % 24;

  const newDay = Math.max(1, t.day + extraDay);

  return {
    ...t,
    day: newDay,
    hour: totalHour,
    minute: totalMin,
    second: totalSec,
    cycle: hourToCycle(totalHour),
  };
}

export function advanceTimeByRounds(t: WorldTime, rounds: number): WorldTime {
  return advanceTimeBySeconds(t, rounds * 6);
}

export function formatTimeDisplay(t: WorldTime): string {
  return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}:${String(t.second).padStart(2, "0")}`;
}

export function formatDayDisplay(t: WorldTime): string {
  return `第${t.day}天`;
}

/** Short rest: advance 2 hours, return { newTime, roundsElapsed } */
export function shortRest(t: WorldTime): { newTime: WorldTime; roundsElapsed: number } {
  const seconds = 2 * 3600; // 2 hours
  return { newTime: advanceTimeBySeconds(t, seconds), roundsElapsed: seconds / 6 };
}

/** Long rest: advance to next day 6:00 AM, return { newTime, roundsElapsed } */
export function longRest(t: WorldTime): { newTime: WorldTime; roundsElapsed: number } {
  // Calculate seconds until next 6:00 AM
  const currentSeconds = t.hour * 3600 + t.minute * 60 + t.second;
  const targetSeconds = 6 * 3600; // 06:00:00
  let delta = targetSeconds - currentSeconds;
  if (delta <= 0) delta += 24 * 3600; // next day
  return {
    newTime: { ...advanceTimeBySeconds(t, delta), second: 0, realTimeActive: false },
    roundsElapsed: Math.ceil(delta / 6),
  };
}

/** Get effective overlay filter color based on environment + cycle */
export function getEffectiveOverlayColor(t: WorldTime): string | null {
  const env = t.environment || "normal";
  if (env === "bright") return null; // no overlay at all
  if (env === "dark") return "rgba(15, 23, 42, 0.55)"; // permanent night
  if (env === "warp") return "rgba(88, 28, 135, 0.45)"; // warp purple

  // normal: use cycle-based
  const CYCLE_COLORS: Record<string, string> = {
    dawn: "rgba(251, 191, 36, 0.12)",
    dusk: "rgba(249, 115, 22, 0.2)",
    night: "rgba(15, 23, 42, 0.55)",
  };
  return CYCLE_COLORS[t.cycle] ?? null; // day = no overlay
}

// === Simple sound effects via Web Audio API ===
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!_audioCtx) _audioCtx = new AudioContext();
  return _audioCtx;
}

function playTone(freq: number, duration: number, type: OscillatorType = "sine", volume = 0.15) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + duration);
  } catch { /* silent fail */ }
}

/** Tick sound for advancing a round */
export function playRoundAdvanceSound() {
  playTone(880, 0.08, "sine", 0.12);
  setTimeout(() => playTone(1100, 0.06, "sine", 0.1), 60);
}

/** Chime for starting real-time clock */
export function playRealTimeStartSound() {
  playTone(660, 0.15, "sine", 0.1);
  setTimeout(() => playTone(880, 0.15, "sine", 0.1), 120);
  setTimeout(() => playTone(1100, 0.12, "sine", 0.08), 240);
}

/** Low tone for stopping real-time clock */
export function playRealTimeStopSound() {
  playTone(880, 0.12, "sine", 0.1);
  setTimeout(() => playTone(660, 0.15, "sine", 0.1), 100);
}

/** Gentle chime for short rest */
export function playShortRestSound() {
  playTone(523, 0.2, "sine", 0.1);
  setTimeout(() => playTone(659, 0.2, "sine", 0.1), 180);
  setTimeout(() => playTone(784, 0.3, "sine", 0.08), 360);
}

/** Melodic sequence for long rest */
export function playLongRestSound() {
  [523, 659, 784, 1047].forEach((f, i) => {
    setTimeout(() => playTone(f, 0.25, "sine", 0.09), i * 160);
  });
}
