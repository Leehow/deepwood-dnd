import { memo, useMemo } from "react";
import { Group, Line } from "react-konva";

import type { Token } from "./types/TacticalMapTypes";
import { buildRuntimeSpellLinks } from "./utils/runtimeSpellLinkUtils";

interface MapSpellRuntimeLinkOverlayProps {
  visibleTokens: Token[];
  selectedTokenId?: number | null;
  currentWorldTime?: {
    day?: number | null;
    hour?: number | null;
    minute?: number | null;
    second?: number | null;
  } | null;
}

export const MapSpellRuntimeLinkOverlay = memo(function MapSpellRuntimeLinkOverlay({
  visibleTokens,
  selectedTokenId = null,
  currentWorldTime = null,
}: MapSpellRuntimeLinkOverlayProps) {
  const links = useMemo(
    () => buildRuntimeSpellLinks(visibleTokens, currentWorldTime),
    [currentWorldTime, visibleTokens],
  );

  if (links.length === 0) return null;

  return (
    <Group listening={false}>
      {links.map((link) => {
        const isSelected =
          selectedTokenId != null
          && (link.sourceTokenId === selectedTokenId || link.targetTokenId === selectedTokenId);
        const strokeWidth = isSelected ? 2.4 : 1.8;
        const opacity = isSelected ? 0.95 : 0.58;
        return (
          <Group key={link.key} listening={false}>
            <Line
              points={link.points}
              stroke={link.color}
              strokeWidth={strokeWidth}
              dash={[10, 7]}
              lineCap="round"
              lineJoin="round"
              opacity={opacity}
              shadowColor={link.color}
              shadowBlur={isSelected ? 6 : 3}
              shadowOpacity={isSelected ? 0.28 : 0.14}
            />
          </Group>
        );
      })}
    </Group>
  );
});
