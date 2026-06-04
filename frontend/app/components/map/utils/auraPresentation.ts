import type { AuraEffect, AuraVisual } from "../types/TacticalMapTypes";

type AuraLike = Partial<AuraEffect> & Partial<AuraVisual> & {
  id?: string;
  aura_id?: string;
  name?: string;
  aura_name?: string;
};

const BUILTIN_AURAS: Record<string, {
  name: string;
  icon: string;
  color: string;
  fillColor: string;
  description: string;
}> = {
  aura_of_protection: {
    name: "护卫灵光",
    icon: "🛡️",
    color: "#fbbf24",
    fillColor: "rgba(251, 191, 36, 0.15)",
    description: "10尺内友方豁免检定+魅力调整值",
  },
  aura_of_courage: {
    name: "勇气灵光",
    icon: "🦁",
    color: "#ef4444",
    fillColor: "rgba(239, 68, 68, 0.15)",
    description: "10尺内友方对恐惧免疫",
  },
  aura_of_devotion: {
    name: "虔诚灵光",
    icon: "✨",
    color: "#a855f7",
    fillColor: "rgba(168, 85, 247, 0.15)",
    description: "10尺内友方对魅惑免疫",
  },
  aura_of_warding: {
    name: "守护灵光",
    icon: "🌿",
    color: "#22c55e",
    fillColor: "rgba(34, 197, 94, 0.15)",
    description: "10尺内友方对法术伤害抗性",
  },
};

const DEFAULT_AURA = {
  name: "光环",
  icon: "🌀",
  color: "#38bdf8",
  fillColor: "rgba(56, 189, 248, 0.18)",
  description: "",
};

function hexToFillColor(color: string | undefined): string {
  const raw = (color || "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    return DEFAULT_AURA.fillColor;
  }
  const red = Number.parseInt(raw.slice(0, 2), 16);
  const green = Number.parseInt(raw.slice(2, 4), 16);
  const blue = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, 0.18)`;
}

export function getAuraPresentation(aura: AuraLike | null | undefined) {
  const auraId = String(aura?.id || aura?.aura_id || "");
  const builtin = BUILTIN_AURAS[auraId] || DEFAULT_AURA;
  const color = String(aura?.color || builtin.color || DEFAULT_AURA.color);
  return {
    name: String(aura?.name || aura?.aura_name || builtin.name || DEFAULT_AURA.name),
    icon: String(aura?.icon || builtin.icon || DEFAULT_AURA.icon),
    color,
    fillColor: String(aura?.fill_color || builtin.fillColor || hexToFillColor(color)),
    description: String(aura?.description || builtin.description || ""),
  };
}
