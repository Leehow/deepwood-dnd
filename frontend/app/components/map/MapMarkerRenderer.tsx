/**
 * MapMarkerRenderer - Renders map markers on the Konva canvas
 */

import React from "react";
import { Group, Text, Circle } from "react-konva";
import type { MapMarker } from "./types/TacticalMapTypes";
import { GRID_SIZE } from "./types/TacticalMapTypes";

interface MapMarkerRendererProps {
  markers: MapMarker[];
  isDM: boolean;
  onMarkerClick?: (marker: MapMarker) => void;
  selectedMarkerId?: number | null;
}

export const MapMarkerRenderer = React.memo(function MapMarkerRenderer({
  markers,
  isDM,
  onMarkerClick,
  selectedMarkerId
}: MapMarkerRendererProps) {
  // Filter markers based on visibility
  const visibleMarkers = isDM
    ? markers
    : markers.filter(m => m.visible_to_players === 1);

  return (
    <>
      {visibleMarkers.map((marker) => {
        const x = marker.position_x * GRID_SIZE + GRID_SIZE / 2;
        const y = marker.position_y * GRID_SIZE + GRID_SIZE / 2;
        const isSelected = selectedMarkerId === marker.id;

        return (
          <Group
            key={marker.id}
            x={x}
            y={y}
            onClick={() => onMarkerClick?.(marker)}
            onTap={() => onMarkerClick?.(marker)}
          >
            {/* Background circle for visibility */}
            <Circle
              radius={16}
              fill={marker.color}
              opacity={0.8}
              stroke={isSelected ? "#fff" : marker.color}
              strokeWidth={isSelected ? 3 : 1}
              shadowColor="#000"
              shadowBlur={4}
              shadowOpacity={0.5}
            />

            {/* Icon */}
            <Text
              text={marker.icon}
              fontSize={20}
              align="center"
              verticalAlign="middle"
              offsetX={10}
              offsetY={10}
            />

            {/* Label below the marker */}
            <Text
              text={marker.label}
              fontSize={11}
              fill="#fff"
              align="center"
              y={20}
              offsetX={marker.label.length * 3}
              stroke="#000"
              strokeWidth={2}
              fillAfterStrokeEnabled
              fontStyle="bold"
            />

            {/* DM-only indicator for hidden markers */}
            {isDM && marker.visible_to_players === 0 && (
              <Text
                text="🔒"
                fontSize={10}
                x={10}
                y={-18}
              />
            )}
          </Group>
        );
      })}
    </>
  );
});

MapMarkerRenderer.displayName = "MapMarkerRenderer";
