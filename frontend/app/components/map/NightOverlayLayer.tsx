/**
 * NightOverlayLayer - Time-of-day tint overlay rendered inside Konva Stage.
 * Punches radial-gradient holes at light source positions so illuminated areas
 * appear as daylight even during night/dawn/dusk cycles.
 *
 * Uses globalCompositeOperation="destination-out" on gradient circles to
 * remove the overlay where light sources exist.
 */
import React, { useMemo } from "react";
import { Rect, Circle } from "react-konva";
import type { Token, IlluminationData } from "./types/TacticalMapTypes";
import type { EnvironmentType } from "~/utils/timeUtils";
import { isExpiredByWorldTime } from "./utils/runtimeSpellBadgeStatusUtils";

interface NightOverlayLayerProps {
  tokens: Token[];
  gridSize: number;
  gridUnitLength: number;
  currentMapUrl: string | null | undefined;
  timeOfDay: { cycle: string; hour: number; environment?: EnvironmentType | string };
  stagePos: { x: number; y: number };
  stageScale: number;
  stageSize: { width: number; height: number };
}

/** Cycle-based colors (only used when environment=normal) */
const CYCLE_COLORS: Record<string, string> = {
  dawn: "rgba(251, 191, 36, 0.12)",
  dusk: "rgba(249, 115, 22, 0.2)",
  night: "rgba(15, 23, 42, 0.55)",
};

/** Environment-forced colors */
const ENV_COLORS: Record<string, string> = {
  dark: "rgba(15, 23, 42, 0.55)",
  warp: "rgba(88, 28, 135, 0.45)",
};

function feetToPx(feet: number, gridSize: number, gridUnitLength: number): number {
  return (feet / gridUnitLength) * gridSize;
}

function parseTokenSize(sizeStr?: string): { width: number; height: number } {
  if (!sizeStr) return { width: 1, height: 1 };
  const parts = sizeStr.split("x");
  return {
    width: parseInt(parts[0]) || 1,
    height: parseInt(parts[1]) || parseInt(parts[0]) || 1,
  };
}

interface LightHole {
  id: string;
  x: number;
  y: number;
  brightRadius: number;  // px
  totalRadius: number;   // px (bright + dim)
}

export function NightOverlayLayer({
  tokens,
  gridSize,
  gridUnitLength,
  currentMapUrl,
  timeOfDay,
  stagePos,
  stageScale,
  stageSize,
}: NightOverlayLayerProps) {
  const env = timeOfDay.environment || "normal";
  // Determine effective overlay color
  let fillColor: string | undefined;
  if (env === "bright") {
    return null; // no overlay
  } else if (env === "dark" || env === "warp") {
    fillColor = ENV_COLORS[env];
  } else {
    // normal: use cycle-based color (day has no overlay)
    fillColor = CYCLE_COLORS[timeOfDay.cycle];
  }
  if (!fillColor) return null;

  // Compute light source holes
  const holes = useMemo(() => {
    const result: LightHole[] = [];
    for (const token of tokens) {
      if (token.map_url !== currentMapUrl) continue;
      const size = parseTokenSize(token.token_size);
      const centerX = token.position_x * gridSize + (Math.max(size.width, 1) * gridSize) / 2;
      const centerY = token.position_y * gridSize + (Math.max(size.height, 1) * gridSize) / 2;

      // Concentration spell illumination
      const conc = token.concentration_spell;
      if (
        conc?.illumination &&
        !conc.illumination.trigger &&
        !isExpiredByWorldTime(conc.expires_at, timeOfDay)
      ) {
        const illum = conc.illumination;
        if (illum.type === "light") {
          let x = centerX, y = centerY;
          if (illum.attach_to === "point" && conc.area_effect) {
            x = conc.area_effect.center_x * gridSize + gridSize / 2;
            y = conc.area_effect.center_y * gridSize + gridSize / 2;
          }
          const brightR = feetToPx(illum.bright_radius || 0, gridSize, gridUnitLength);
          const dimR = feetToPx(illum.dim_radius || 0, gridSize, gridUnitLength);
          if (brightR + dimR > 0) {
            result.push({ id: `conc-${token.id}`, x, y, brightRadius: brightR, totalRadius: brightR + dimR });
          }
        }
      }

      // Active effects illumination
      for (const eff of token.active_effects || []) {
        const illum = (eff as any).illumination as IlluminationData | undefined;
        if (
          !illum ||
          illum.trigger ||
          illum.type !== "light" ||
          isExpiredByWorldTime((eff as any).expires_at, timeOfDay)
        ) continue;
        const brightR = feetToPx(illum.bright_radius || 0, gridSize, gridUnitLength);
        const dimR = feetToPx(illum.dim_radius || 0, gridSize, gridUnitLength);
        if (brightR + dimR > 0) {
          result.push({ id: `eff-${token.id}-${eff.id}`, x: centerX, y: centerY, brightRadius: brightR, totalRadius: brightR + dimR });
        }
      }
    }
    return result;
  }, [tokens, gridSize, gridUnitLength, currentMapUrl]);

  // Calculate world-space bounds that cover the full visible viewport
  const coverRect = useMemo(() => {
    const x = -stagePos.x / stageScale;
    const y = -stagePos.y / stageScale;
    const w = stageSize.width / stageScale;
    const h = stageSize.height / stageScale;
    // Add generous padding to avoid edge artifacts during pan
    const pad = 500;
    return { x: x - pad, y: y - pad, width: w + pad * 2, height: h + pad * 2 };
  }, [stagePos.x, stagePos.y, stageScale, stageSize.width, stageSize.height]);

  return (
    <>
      {/* Full-viewport tinted overlay */}
      <Rect
        x={coverRect.x}
        y={coverRect.y}
        width={coverRect.width}
        height={coverRect.height}
        fill={fillColor}
      />
      {/* Punch holes at light source positions */}
      {holes.map((hole) => {
        const brightRatio = hole.totalRadius > 0 ? hole.brightRadius / hole.totalRadius : 0;
        return (
          <Circle
            key={hole.id}
            x={hole.x}
            y={hole.y}
            radius={hole.totalRadius}
            fillRadialGradientStartPoint={{ x: 0, y: 0 }}
            fillRadialGradientEndPoint={{ x: 0, y: 0 }}
            fillRadialGradientStartRadius={0}
            fillRadialGradientEndRadius={hole.totalRadius}
            fillRadialGradientColorStops={[
              0, "rgba(0,0,0,1)",
              Math.max(brightRatio * 0.7, 0.01), "rgba(0,0,0,0.9)",
              brightRatio, "rgba(0,0,0,0.4)",
              1, "rgba(0,0,0,0)",
            ]}
            globalCompositeOperation="destination-out"
          />
        );
      })}
    </>
  );
}
