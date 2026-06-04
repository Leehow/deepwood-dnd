/**
 * ObscurementOverlayLayer - Visual fog effects for obscured spell zones
 * Renders above ActiveSpellAreasLayer, before token layer
 * Heavy obscurement: thick fog (DM sees reduced opacity)
 * Light obscurement: thin haze
 */
import React, { useEffect, useState } from "react";
import { Circle, Rect } from "react-konva";
import type { ObscurementZone } from "./utils/obscurementUtils";

interface ObscurementOverlayLayerProps {
  zones: ObscurementZone[];
  gridSize: number;
  gridUnitLength: number;
  isDM: boolean;
}

const ObscurementShape = React.memo(function ObscurementShape({
  zone,
  gridSize,
  gridUnitLength,
  isDM,
  pulseOpacity,
}: {
  zone: ObscurementZone;
  gridSize: number;
  gridUnitLength: number;
  isDM: boolean;
  pulseOpacity: number;
}) {
  const isHeavy = zone.obscurement === "heavy";

  // Base opacity modulated by pulse
  const baseOp = isHeavy ? pulseOpacity : pulseOpacity * 0.4;
  const opacity = isDM ? baseOp * 0.2 : baseOp;

  const fillColor = isHeavy
    ? `rgba(220, 220, 230, ${opacity})`
    : `rgba(200, 200, 210, ${opacity})`;

  const radiusGrids = zone.radius / gridUnitLength;
  const radiusPixels = radiusGrids * gridSize;
  const cx = zone.center_x * gridSize;
  const cy = zone.center_y * gridSize;

  switch (zone.shape) {
    case "sphere":
    case "cylinder":
      return (
        <Circle
          x={cx}
          y={cy}
          radius={radiusPixels}
          fill={fillColor}
          // Edge fade via radial gradient
          fillRadialGradientStartPoint={{ x: 0, y: 0 }}
          fillRadialGradientEndPoint={{ x: 0, y: 0 }}
          fillRadialGradientStartRadius={0}
          fillRadialGradientEndRadius={radiusPixels}
          fillRadialGradientColorStops={[
            0, isHeavy
              ? `rgba(220, 220, 230, ${opacity})`
              : `rgba(200, 200, 210, ${opacity})`,
            0.7, isHeavy
              ? `rgba(220, 220, 230, ${opacity * 0.9})`
              : `rgba(200, 200, 210, ${opacity * 0.8})`,
            1, isHeavy
              ? `rgba(220, 220, 230, ${opacity * 0.3})`
              : `rgba(200, 200, 210, ${opacity * 0.2})`,
          ]}
          listening={false}
        />
      );

    case "cube": {
      const half = radiusPixels / 2;
      return (
        <Rect
          x={cx - half}
          y={cy - half}
          width={radiusPixels}
          height={radiusPixels}
          fill={fillColor}
          listening={false}
        />
      );
    }

    default:
      return null;
  }
});

export function ObscurementOverlayLayer({
  zones,
  gridSize,
  gridUnitLength,
  isDM,
}: ObscurementOverlayLayerProps) {
  // Pulse animation (slow throb)
  const [pulseOpacity, setPulseOpacity] = useState(0.7);

  useEffect(() => {
    if (zones.length === 0) return;
    const start = performance.now();
    const interval = setInterval(() => {
      const elapsed = (performance.now() - start) / 1000;
      // Pulse between 0.6 and 0.8
      const op = 0.7 + Math.sin(elapsed * Math.PI * 0.5) * 0.1;
      setPulseOpacity(op);
    }, 200);
    return () => clearInterval(interval);
  }, [zones.length === 0]);

  if (zones.length === 0) return null;

  return (
    <>
      {zones.map((zone, i) => (
        <ObscurementShape
          key={`obsc-${zone.spellId}-${zone.casterId}-${i}`}
          zone={zone}
          gridSize={gridSize}
          gridUnitLength={gridUnitLength}
          isDM={isDM}
          pulseOpacity={pulseOpacity}
        />
      ))}
    </>
  );
}
