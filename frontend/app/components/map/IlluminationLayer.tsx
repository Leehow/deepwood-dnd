/**
 * IlluminationLayer - Renders light/darkness effects from spells with illumination data.
 * Light spells show radial gradients (bright center → dim edge → transparent).
 * Darkness spells show dark semi-transparent circles.
 * Pulse animation matches ActiveSpellAreasLayer pattern (5fps breathing).
 */
import React, { useEffect, useState, useMemo } from "react";
import { Circle } from "react-konva";
import type { Token, IlluminationData } from "./types/TacticalMapTypes";
import { isExpiredByWorldTime } from "./utils/runtimeSpellBadgeStatusUtils";

interface LightSource {
  id: string;
  x: number;           // pixel x (center)
  y: number;           // pixel y (center)
  illumination: IlluminationData;
  tokenId: number;
  tokenName: string;
}

interface IlluminationLayerProps {
  tokens: Token[];
  gridSize: number;
  gridUnitLength: number;    // feet per grid cell (default 5)
  currentMapUrl: string | null | undefined;
  currentWorldTime?: { day?: number | null; hour?: number | null; minute?: number | null; second?: number | null } | null;
}

// Spell color mapping based on school/spell characteristics
const LIGHT_COLORS: Record<string, { inner: string; outer: string }> = {
  fire:    { inner: "rgba(255, 160, 60, 0.45)",  outer: "rgba(255, 120, 30, 0.08)" },
  radiant: { inner: "rgba(255, 240, 140, 0.45)", outer: "rgba(255, 220, 80, 0.08)" },
  moon:    { inner: "rgba(180, 210, 255, 0.4)",  outer: "rgba(140, 180, 255, 0.06)" },
  custom:  { inner: "rgba(255, 230, 160, 0.4)",  outer: "rgba(255, 200, 100, 0.06)" },
};
const DEFAULT_LIGHT = { inner: "rgba(255, 230, 160, 0.4)", outer: "rgba(255, 200, 100, 0.06)" };

function getLightColor(illumination: IlluminationData) {
  const c = illumination.color?.split("|")[0]?.toLowerCase() || "";
  if (c === "fire" || c === "orange" || c === "red") return LIGHT_COLORS.fire;
  if (c === "radiant" || c === "yellow" || c === "gold") return LIGHT_COLORS.radiant;
  if (c === "moon" || c === "blue" || c === "white" || c === "silver") return LIGHT_COLORS.moon;
  if (c === "custom") return LIGHT_COLORS.custom;
  if (illumination.is_sunlight) return LIGHT_COLORS.radiant;
  return DEFAULT_LIGHT;
}

/** Convert feet to pixels */
function feetToPx(feet: number, gridSize: number, gridUnitLength: number): number {
  return (feet / gridUnitLength) * gridSize;
}

/** Parse token size string like "2x2" */
function parseTokenSize(sizeStr?: string): { width: number; height: number } {
  if (!sizeStr) return { width: 1, height: 1 };
  const parts = sizeStr.split("x");
  return {
    width: parseInt(parts[0]) || 1,
    height: parseInt(parts[1]) || parseInt(parts[0]) || 1,
  };
}

/** Single light source rendered as a Konva Circle with radial gradient */
const LightSourceCircle = React.memo(function LightSourceCircle({
  source,
  gridSize,
  gridUnitLength,
  pulseScale,
}: {
  source: LightSource;
  gridSize: number;
  gridUnitLength: number;
  pulseScale: number;
}) {
  const { illumination: illum } = source;

  // Skip triggered illumination (e.g., "on_hit") — rendered only after trigger
  if (illum.trigger) return null;

  if (illum.type === "darkness") {
    const darkRadius = feetToPx(illum.darkness_radius || 15, gridSize, gridUnitLength);
    const r = darkRadius * pulseScale;
    return (
      <Circle
        x={source.x}
        y={source.y}
        radius={r}
        fill="rgba(10, 5, 20, 0.7)"
        shadowColor="#000000"
        shadowBlur={darkRadius * 0.4}
        shadowOpacity={0.8}
        listening={false}
      />
    );
  }

  // type === "light"
  const brightR = feetToPx(illum.bright_radius || 0, gridSize, gridUnitLength);
  const dimR = feetToPx(illum.dim_radius || 0, gridSize, gridUnitLength);
  const totalRadius = brightR + dimR;
  if (totalRadius <= 0) return null;

  const r = totalRadius * pulseScale;
  const colors = getLightColor(illum);
  // Gradient stops: center → bright edge → dim edge
  const brightRatio = brightR / totalRadius;

  return (
    <Circle
      x={source.x}
      y={source.y}
      radius={r}
      fillRadialGradientStartPoint={{ x: 0, y: 0 }}
      fillRadialGradientEndPoint={{ x: 0, y: 0 }}
      fillRadialGradientStartRadius={0}
      fillRadialGradientEndRadius={r}
      fillRadialGradientColorStops={[
        0, colors.inner,
        brightRatio * 0.6, colors.inner,
        brightRatio, colors.outer.replace(/[\d.]+\)$/, "0.2)"),
        1, "rgba(0,0,0,0)",
      ]}
      listening={false}
    />
  );
});

export const IlluminationLayer = React.memo(function IlluminationLayer({
  tokens,
  gridSize,
  gridUnitLength,
  currentMapUrl,
  currentWorldTime,
}: IlluminationLayerProps) {
  // Collect all light sources from tokens on the current map
  const lightSources = useMemo(() => {
    const sources: LightSource[] = [];
    for (const token of tokens) {
      if (token.map_url !== currentMapUrl) continue;

      const size = parseTokenSize(token.token_size);
      const centerX = token.position_x * gridSize + (Math.max(size.width, 1) * gridSize) / 2;
      const centerY = token.position_y * gridSize + (Math.max(size.height, 1) * gridSize) / 2;

      // 1) Concentration spell illumination
      const conc = token.concentration_spell;
      if (
        conc?.illumination &&
        !conc.illumination.trigger &&
        !isExpiredByWorldTime(conc.expires_at, currentWorldTime)
      ) {
        const illum = conc.illumination;
        let x = centerX, y = centerY;
        // "point" attach uses area_effect center if available
        if (illum.attach_to === "point" && conc.area_effect) {
          x = conc.area_effect.center_x * gridSize + gridSize / 2;
          y = conc.area_effect.center_y * gridSize + gridSize / 2;
        }
        sources.push({
          id: `conc-${token.id}-${conc.spell_id}`,
          x, y,
          illumination: illum,
          tokenId: token.id,
          tokenName: token.instance_name || token.character_name || token.monster_name_cn || "Unknown",
        });
      }

      // 2) Active effects with illumination
      const effects = token.active_effects || [];
      for (const eff of effects) {
        const illum = (eff as any).illumination as IlluminationData | undefined;
        if (
          !illum ||
          illum.trigger ||
          isExpiredByWorldTime((eff as any).expires_at, currentWorldTime)
        ) continue;
        sources.push({
          id: `eff-${token.id}-${eff.id}`,
          x: centerX,
          y: centerY,
          illumination: illum,
          tokenId: token.id,
          tokenName: token.instance_name || token.character_name || token.monster_name_cn || "Unknown",
        });
      }
    }
    return sources;
  }, [tokens, gridSize, gridUnitLength, currentMapUrl, currentWorldTime]);

  // Pulse animation (5fps breathing) — shared with ActiveSpellAreasLayer pattern
  const [pulseScale, setPulseScale] = useState(1.0);
  useEffect(() => {
    if (lightSources.length === 0) return;
    const start = performance.now();
    const interval = setInterval(() => {
      const elapsed = (performance.now() - start) / 1000;
      // Subtle scale oscillation: 0.97 – 1.03
      const scale = 1.0 + Math.sin(elapsed * Math.PI / 2) * 0.03;
      setPulseScale(scale);
    }, 200);
    return () => clearInterval(interval);
  }, [lightSources.length === 0]);

  if (lightSources.length === 0) return null;

  return (
    <>
      {lightSources.map((src) => (
        <LightSourceCircle
          key={src.id}
          source={src}
          gridSize={gridSize}
          gridUnitLength={gridUnitLength}
          pulseScale={pulseScale}
        />
      ))}
    </>
  );
});

IlluminationLayer.displayName = "IlluminationLayer";
